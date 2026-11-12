#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/backup.sh — backup THỦ CÔNG DB + code của nhánh đang checkout (tách từ deploy.sh: backup_mongo + backup_code + tag image).
#
# Chạy ở máy chủ, trong thư mục repo:
#   bash scripts/backup.sh [--db-only | --code-only] [--no-image] [--help]
# (Dùng `bash scripts/backup.sh`, không phụ thuộc bit thực thi.) Không git pull, không build, không up, không migrate, KHÔNG đụng stack đang chạy:
# chỉ ĐỌC từ Mongo (mongodump) và git (bundle), ghi file vào ./backups (quyền 600/700) và gắn thẻ image/tag.
#
# Mặc định tạo ĐỦ BỘ, cùng định dạng với deploy.sh nên scripts/restore.sh dùng được ngay (--list / --manifest / --latest):
#   backups/deploy-pre-<TS>.archive.gz        mongodump DB realestate (kiểm cả nội dung: > 0 byte, gzip hợp lệ, có realestate.users)
#   backups/deploy-code-pre-<TS>.bundle       git bundle của nhánh/HEAD hiện tại (đã `git bundle verify`)
#   tag cục bộ  pre-deploy-<TS>               tại commit hiện tại (KHÔNG push)
#   image       <project>-backend:pre-<TS>    gắn thẻ image backend đang chạy (bỏ bằng --no-image)
#   backups/deploy-pre-<TS>.manifest          KEY=VALUE, không bí mật (ghi CUỐI CÙNG: có manifest = backup đã đủ)
#
#   --db-only    chỉ mongodump. KHÔNG ghi manifest/bundle/tag (quyết định có chủ ý) => bản này KHÔNG hiện trong `restore.sh --list` và restore.sh
#                không dùng được; khôi phục TAY bằng mongorestore (lệnh mẫu: tài liệu mục 6.2).
#   --code-only  chỉ bundle + tag + manifest (MONGO_BACKUP_FILE rỗng => chỉ dùng với restore.sh --code-only).
#   --no-image   không gắn thẻ image backend.
#
# Manifest do script này tạo ghi DEPLOY_STATUS=succeeded, STACK_TOUCHED=1 (để restore.sh không gợi ý "DB chưa bị đổi, bỏ qua"), POST_UP_REACHED=0,
# NEW_COMMIT = OLD_COMMIT, cùng khóa BACKUP_KIND=manual (restore.sh bỏ qua khóa lạ). Lỗi giữa chừng: xóa các file/tag vừa tạo ở lần chạy này.
# Thứ tự: mọi kiểm tiền điều kiện phía code (commit, tên nhánh, bundle/tag/manifest chưa tồn tại) chạy TRƯỚC khi đọc Mongo/ghi/dump, để lỗi phía code
# không làm dump DB (vừa tốn thời gian) bị dọn bỏ.
# Dùng chung khóa với deploy.sh/restore.sh (không chạy chồng). Thay đổi chưa commit ở file đã theo dõi KHÔNG nằm trong bundle (chỉ ghi TRACKED_DIRTY=1).
#
# Bí mật: script KHÔNG chứa bí mật. Mật khẩu root Mongo chỉ được đọc từ biến môi trường BÊN TRONG container và đưa cho mongodump qua pipe.
# Backup nằm cùng ổ đĩa không phải backup thật: chép ra NGOÀI máy chủ (scp/rclone).
#
# Biến môi trường tùy chọn (không bí mật): DUMP_TIMEOUT (giây, mặc định 900), OPS_EXEC_TIMEOUT (mặc định 300), BACKUP_MIN_FREE_GB (mặc định 2),
#   MONGO_CONTAINER, BACKEND_CONTAINER, và các biến staging DEPLOY_* (do scripts/staging.sh đặt, như deploy.sh).
# Mã thoát: 0 ok | 1 lỗi (kể cả --db-only khi DB trống) | 2 sai tham số. Bị ngắt: 143 (TERM) / 130 (INT) / 129 (HUP), có dọn file/tag đã tạo.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="backup"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[backup] LỖI: không resolve được đường dẫn thật của backup.sh (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")/.." && pwd)"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

# Hợp đồng môi trường giống deploy.sh (staging.sh đặt các biến DEPLOY_*; production không đặt gì). Cả 4 biến + NINE_ROUTER_CONTAINER đều được
# check_staging_vars (ops-common) đọc để chặn biến staging đặt ngoài wrapper, nên KHÔNG xóa dù backup.sh không dùng trực tiếp.
readonly ENV_FILE="${DEPLOY_ENV_FILE:-.env.docker}"
readonly RUNTIME_ENV_FILE="${DEPLOY_RUNTIME_ENV_FILE:-.env}"
readonly LOGS_DIR="${DEPLOY_LOGS_DIR:-logs}"
readonly BACKUP_DIR="${DEPLOY_BACKUP_DIR:-backups}"
readonly NINE_ROUTER_CONTAINER="${NINE_ROUTER_CONTAINER-realestate_9router}"
readonly MONGO_CONTAINER="${MONGO_CONTAINER:-realestate_mongo}"
readonly BACKEND_CONTAINER="${BACKEND_CONTAINER:-realestate_backend}"
readonly DEFAULT_PROJECT="realestatemanager"
readonly DOC="docs/01_Infrastructure/06_Production_Deploy.md"
check_staging_vars

DUMP_TIMEOUT="${DUMP_TIMEOUT:-900}"
BACKUP_MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-2}"
TS="$(date +%Y%m%d-%H%M%S)"
DO_DB=1; DO_CODE=1; DO_IMAGE=1
ARCHIVE_FILE=""; BUNDLE_FILE=""; TAG_NAME=""; MANIFEST_FILE=""; PREV_IMAGE_REPO=""; PREV_IMAGE_TAG=""
DONE=0   # =1 khi manifest (hoặc archive ở --db-only) đã ghi xong: lúc đó on_exit KHÔNG dọn

usage() {
  cat <<'EOF'
Cách dùng: bash scripts/backup.sh [--db-only | --code-only] [--no-image] [--help]

Backup THỦ CÔNG (không pull/build/up/migrate, không đụng stack đang chạy). Mặc định tạo đủ bộ trong ./backups, cùng định dạng với deploy.sh:
  deploy-pre-<TS>.archive.gz   mongodump DB realestate (đã kiểm nội dung)
  deploy-code-pre-<TS>.bundle  git bundle của nhánh đang checkout (đã verify) + tag cục bộ pre-deploy-<TS> (không push)
  deploy-pre-<TS>.manifest     KEY=VALUE, không bí mật; ghi cuối cùng
  image <project>-backend:pre-<TS> (gắn thẻ image backend đang chạy)

  --db-only    chỉ mongodump. KHÔNG ghi manifest/bundle/tag: bản này không hiện trong `restore.sh --list`, khôi phục TAY bằng mongorestore (lệnh mẫu: mục 6.2).
  --code-only  chỉ bundle + tag + manifest (dùng với restore.sh --code-only).
  --no-image   không gắn thẻ image backend.
  -h, --help   Hiện trợ giúp này.

Khôi phục: bash scripts/restore.sh --list ; bash scripts/restore.sh --latest   (mặc định dry-run; chạy thật cần --apply --yes).
Biến tùy chọn: DUMP_TIMEOUT (900), OPS_EXEC_TIMEOUT (300), BACKUP_MIN_FREE_GB (2). Chi tiết: tài liệu mục 6.2.
EOF
}

# Lỗi/ngắt giữa chừng: xóa những gì lần chạy NÀY đã tạo (file .partial, archive, bundle, tag) khi chưa chốt manifest. Không đụng file cũ.
on_exit() {
  local code=$?
  trap - EXIT
  set +e
  trap '' PIPE
  if (( code != 0 && DONE == 0 )); then
    [[ -z "$ARCHIVE_FILE" ]] || rm -f -- "${ARCHIVE_FILE}.partial" "$ARCHIVE_FILE"
    [[ -z "$BUNDLE_FILE" ]]  || rm -f -- "${BUNDLE_FILE}.partial" "$BUNDLE_FILE"
    [[ -z "$MANIFEST_FILE" ]] || rm -f -- "${MANIFEST_FILE}.tmp" "$MANIFEST_FILE"   # MANIFEST_FILE chỉ được đặt SAU khi đã kiểm nó chưa tồn tại => không xóa nhầm file cũ
    if [[ -n "$TAG_NAME" ]]; then git tag -d "$TAG_NAME" >/dev/null 2>&1; fi
    if [[ -n "$PREV_IMAGE_TAG" ]]; then docker rmi "$PREV_IMAGE_TAG" >/dev/null 2>&1; fi
    warn "Backup THẤT BẠI (mã $code): đã dọn các file/tag vừa tạo ở lần chạy này. Không có gì bị đổi ở stack/DB."
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

check_prereqs() {
  local cmd
  command -v gzip >/dev/null 2>&1 || die "Thiếu lệnh 'gzip'."
  if (( DO_DB == 1 || DO_IMAGE == 1 )); then
    command -v docker >/dev/null 2>&1 || die "Thiếu lệnh 'docker'."
    docker info >/dev/null 2>&1 || die "Không nói chuyện được với Docker daemon (daemon chưa chạy, hoặc user thiếu quyền: thêm vào nhóm 'docker')."
  fi
  if (( DO_CODE == 1 )); then
    command -v git >/dev/null 2>&1 || die "Thiếu lệnh 'git'."
    in_git_repo || die "Không phải git repo: không backup được code (dùng --db-only nếu chỉ cần DB)."
  fi
}

# Phân loại DB `realestate` (CHỈ ĐỌC), giống deploy.sh: HAS_USERS | EMPTY | EMPTY_SYSTEM_ONLY | AMBIGUOUS:<tên...>; trả 1 nếu không hỏi được Mongo.
classify_db() {
  local present busy
  present="$(existing_collections "$MONGO_CONTAINER" users)" || return 1
  if [[ -n "$present" ]]; then echo HAS_USERS; return 0; fi
  busy="$(nonempty_collections "$MONGO_CONTAINER")" || return 1
  case "$busy" in
    "") echo EMPTY ;;
    system) echo EMPTY_SYSTEM_ONLY ;;
    *) echo "AMBIGUOUS:${busy}" ;;
  esac
}

# Trả 0 và đặt ARCHIVE_FILE khi đã tạo backup; trả 3 khi DB chưa có dữ liệu (bỏ qua, ARCHIVE_FILE rỗng); die khi lỗi.
backup_mongo() {
  local state
  state="$(inspect_field "$MONGO_CONTAINER" '{{.State.Status}}')"
  [[ "$state" == "running" ]] || die "Container $MONGO_CONTAINER ở trạng thái '$state'. Khởi động Mongo trước (hoặc dùng --code-only nếu chỉ cần code)."
  docker exec "$MONGO_CONTAINER" sh -c 'test -n "$MONGO_INITDB_ROOT_USERNAME" && test -n "$MONGO_INITDB_ROOT_PASSWORD"' \
    || die "Mongo đang chạy cấu hình cũ (không có user root/xác thực): backup.sh không hỗ trợ. Làm theo $DOC mục 5/6."

  local db_class
  db_class="$(classify_db)" || die "Không hỏi được Mongo xem DB realestate có dữ liệu hay chưa (mongosh lỗi hoặc quá ${OPS_EXEC_TIMEOUT}s). Kiểm container $MONGO_CONTAINER rồi chạy lại."
  case "$db_class" in
    HAS_USERS) ;;
    EMPTY|EMPTY_SYSTEM_ONLY)
      warn "DB realestate trong $MONGO_CONTAINER chưa có dữ liệu nghiệp vụ (${db_class}): bỏ qua mongodump vì không có gì để sao lưu."
      return 3
      ;;
    *) die "DB realestate chưa có collection users nhưng có collection có dữ liệu (${db_class#AMBIGUOUS:}): không tạo được backup hợp lệ (backup phải chứa realestate.users). Kiểm bằng mongosh rồi xử lý theo $DOC mục 6." ;;
  esac

  local out="${BACKUP_DIR}/deploy-pre-${TS}.archive.gz" part rc=0
  part="${out}.partial"
  [[ ! -e "$out" ]] || die "Đã có $out (chạy chồng cùng giây?). Không ghi đè backup: chạy lại sau."
  ARCHIVE_FILE="$out"
  log "mongodump DB realestate -> $out ..."
  # Mật khẩu đọc từ biến môi trường BÊN TRONG container, đưa cho mongodump qua pipe (không lên dòng lệnh, không ghi ra đĩa).
  # shellcheck disable=SC2016  # biến phải được mở rộng BÊN TRONG container, nên dùng nháy đơn có chủ ý
  local dump_cmd='mongodump --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --db realestate --archive --gzip'
  ( umask 077; timeout "$DUMP_TIMEOUT" docker exec "$MONGO_CONTAINER" bash -c "$dump_cmd" > "$part" ) || rc=$?
  if (( rc != 0 )); then
    rm -f "$part"
    if (( rc == 124 )); then die "mongodump quá ${DUMP_TIMEOUT}s (Mongo quá tải/treo?). Tăng DUMP_TIMEOUT nếu DB lớn."; fi
    die "mongodump thất bại (mã $rc)."
  fi
  verify_backup_archive "$part" "$MONGO_CONTAINER" || { rm -f "$part"; die "Backup vừa tạo không đạt kiểm tra nội dung."; }
  mv "$part" "$out" || die "Không đổi tên được $part."
  ls -l "$out"
  log "Backup DB OK (đã kiểm nội dung)."
}

# Kiểm TIỀN ĐIỀU KIỆN phía code (chỉ ĐỌC, không ghi gì): chạy TRƯỚC mọi thao tác đọc Mongo/dump/ghi file, để lỗi phía code (tên nhánh lạ, tag/bundle
# trùng...) dừng sớm, không làm dump DB đã tốn thời gian bị dọn bỏ. Đặt P_COMMIT/P_BRANCH/P_REF/P_DETACHED/P_DIRTY cho backup_code.
P_COMMIT=""; P_BRANCH=""; P_REF=""; P_DETACHED=0; P_DIRTY=0
precheck() {
  if (( DO_DB == 1 )); then
    [[ ! -e "${BACKUP_DIR}/deploy-pre-${TS}.archive.gz" ]] || die "Đã có ${BACKUP_DIR}/deploy-pre-${TS}.archive.gz (chạy chồng cùng giây?). Không ghi đè backup: chạy lại sau."
  fi
  (( DO_CODE == 1 )) || return 0
  local commit branch=""
  commit="$(git rev-parse HEAD)" || die "Không đọc được commit hiện tại (git rev-parse HEAD)."
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die "Commit hiện tại không phải SHA-1 40 ký tự ('$commit'); backup code chưa hỗ trợ."
  P_COMMIT="$commit"
  if branch="$(git symbolic-ref --short -q HEAD)" && [[ -n "$branch" ]]; then
    P_BRANCH="$branch"; P_REF="refs/heads/$branch"
  else
    P_BRANCH=""; P_DETACHED=1; P_REF="HEAD"
    warn "HEAD đang detached tại ${commit:0:12}: bundle/tag vẫn tạo theo commit này, manifest ghi DETACHED=1."
  fi
  if (( P_DETACHED == 0 )) && ! valid_branch_name "$P_BRANCH"; then
    die "Tên nhánh '$P_BRANCH' có ký tự/dạng mà scripts/restore.sh không chấp nhận (chỉ A-Z a-z 0-9 . _ - /, không bắt đầu bằng - hoặc /, không chứa '..', '//', không kết thúc bằng '.lock' hay '/'). Đổi tên nhánh (git branch -m) rồi chạy lại. Chưa tạo gì."
  fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    P_DIRTY=1
    warn "Working tree có thay đổi chưa commit ở file đã theo dõi: bundle/tag chỉ chứa commit ${commit:0:12}, KHÔNG chứa các thay đổi đó."
  fi
  [[ ! -e "${BACKUP_DIR}/deploy-code-pre-${TS}.bundle" ]] || die "Đã có ${BACKUP_DIR}/deploy-code-pre-${TS}.bundle (chạy chồng cùng giây?). Không ghi đè backup: chạy lại sau."
  [[ ! -e "${BACKUP_DIR}/deploy-pre-${TS}.manifest" ]] || die "Đã có ${BACKUP_DIR}/deploy-pre-${TS}.manifest. Không ghi đè: chạy lại sau."
  if git rev-parse -q --verify "refs/tags/pre-deploy-${TS}" >/dev/null 2>&1; then die "Đã có tag pre-deploy-${TS}. Không ghi đè: chạy lại sau."; fi
}

# Tạo bundle + tag cục bộ + ghi manifest (đã qua precheck). Đặt BUNDLE_FILE/TAG_NAME/MANIFEST_FILE.
backup_code() {
  local commit="$P_COMMIT" branch="$P_BRANCH" detached="$P_DETACHED" dirty="$P_DIRTY" ref="$P_REF" part tag host
  local bundle="${BACKUP_DIR}/deploy-code-pre-${TS}.bundle"
  part="${bundle}.partial"
  tag="pre-deploy-${TS}"

  BUNDLE_FILE="$bundle"
  log "Backup code: nhánh '${branch:-(detached)}' commit ${commit:0:12} -> $bundle ..."
  if ! ( umask 077; git bundle create "$part" "$ref" ) >/dev/null 2>&1; then
    rm -f "$part"
    die "git bundle create thất bại (repo shallow? hết đĩa?). Thử tay: git bundle create /tmp/x.bundle HEAD"
  fi
  git bundle verify "$part" >/dev/null 2>&1 || { rm -f "$part"; die "Bundle vừa tạo không qua 'git bundle verify'."; }
  chmod 600 "$part"
  mv "$part" "$bundle" || die "Không đổi tên được $part."
  git tag "$tag" "$commit" || die "Không tạo được tag cục bộ $tag."
  TAG_NAME="$tag"
  log "Đã tạo bundle (đã verify) và tag cục bộ $tag (KHÔNG push tag này)."

  # Image dự phòng (cùng quy ước đặt tên với deploy.sh: <project>-backend:pre-<TS>).
  if (( DO_IMAGE == 1 )); then
    local image_id project
    image_id="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
    if [[ -z "$image_id" ]]; then
      log "Chưa có container $BACKEND_CONTAINER: không có image để dự phòng."
    else
      project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
      [[ -n "$project" ]] || project="$DEFAULT_PROJECT"
      PREV_IMAGE_REPO="${project}-backend"
      # Đặt PREV_IMAGE_TAG TRƯỚC `docker tag`: bị ngắt (TERM/HUP) ngay lúc tag thì on_exit vẫn gỡ được thẻ vừa gắn (rmi thẻ chưa có chỉ báo lỗi, đã bỏ qua).
      PREV_IMAGE_TAG="${PREV_IMAGE_REPO}:pre-${TS}"
      docker tag "$image_id" "$PREV_IMAGE_TAG"
      log "Đã gắn thẻ image backend hiện tại: $PREV_IMAGE_TAG"
    fi
  fi

  # Phiên bản DB (chỉ đọc; không đọc được thì DB_VERSION_READ=0).
  local dbv="" got=0
  if (( DO_DB == 1 )) && [[ "$(inspect_field "$MONGO_CONTAINER" '{{.State.Status}}')" == "running" ]] && dbv="$(read_system_version "$MONGO_CONTAINER")"; then
    got=1
  else
    dbv=""
  fi

  local app_ver proj
  app_ver="$(read_pkg_version || true)"
  proj="${PREV_IMAGE_REPO%-backend}"; [[ -n "$proj" ]] || proj="${COMPOSE_PROJECT_NAME:-$DEFAULT_PROJECT}"
  host="$(hostname 2>/dev/null || true)"
  # Đã kiểm ở precheck rằng manifest chưa tồn tại; đặt MANIFEST_FILE ngay trước khi ghi để on_exit dọn được cả manifest "mồ côi" nếu bị ngắt sát lúc này.
  MANIFEST_FILE="${BACKUP_DIR}/deploy-pre-${TS}.manifest"
  manifest_write "$MANIFEST_FILE" \
    "# Backup THỦ CÔNG bằng scripts/backup.sh (không phải lần deploy). Khôi phục: bash scripts/restore.sh --manifest ${MANIFEST_FILE}" \
    "MANIFEST_VERSION=1" \
    "BACKUP_KIND=manual" \
    "TS=${TS}" \
    "CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "HOST=${host:-unknown}" \
    "COMPOSE_PROJECT=${proj}" \
    "BRANCH=${branch}" \
    "DETACHED=${detached}" \
    "OLD_COMMIT=${commit}" \
    "OLD_COMMIT_SHORT=${commit:0:7}" \
    "NEW_COMMIT=${commit}" \
    "APP_VERSION_OLD=${app_ver}" \
    "APP_VERSION_NEW=${app_ver}" \
    "DB_VERSION_BEFORE=${dbv}" \
    "DB_VERSION_READ=${got}" \
    "MONGO_BACKUP_FILE=${ARCHIVE_FILE}" \
    "MONGO_CONTAINER=${MONGO_CONTAINER}" \
    "BACKEND_CONTAINER=${BACKEND_CONTAINER}" \
    "CODE_BUNDLE=${bundle}" \
    "CODE_BUNDLE_REF=${ref}" \
    "CODE_TAG=${tag}" \
    "PREV_IMAGE_REPO=${PREV_IMAGE_REPO}" \
    "PREV_IMAGE_TAG=${PREV_IMAGE_TAG}" \
    "TRACKED_DIRTY=${dirty}" \
    "NO_PULL=1" \
    "STACK_TOUCHED=1" \
    "POST_UP_REACHED=0" \
    "DEPLOY_STATUS=succeeded" \
    "FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    || die "Không ghi được manifest $MANIFEST_FILE."
  DONE=1
  log "Manifest: $MANIFEST_FILE (khôi phục: bash scripts/restore.sh --manifest $MANIFEST_FILE)"
}

main() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --db-only)   DO_CODE=0 ;;
      --code-only) DO_DB=0 ;;
      --no-image)  DO_IMAGE=0 ;;
      -h|--help)   trap - EXIT; usage; exit 0 ;;
      *) trap - EXIT; printf '[backup] Tham số không hợp lệ: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
    esac
  done
  if (( DO_DB == 0 && DO_CODE == 0 )); then
    trap - EXIT; echo "[backup] --db-only và --code-only loại trừ nhau." >&2; exit 2
  fi
  [[ "$DUMP_TIMEOUT" =~ ^[0-9]+$ && "$OPS_EXEC_TIMEOUT" =~ ^[0-9]+$ ]] || die "DUMP_TIMEOUT/OPS_EXEC_TIMEOUT phải là số nguyên (giây)."
  [[ "$BACKUP_MIN_FREE_GB" =~ ^[0-9]+$ ]] || die "BACKUP_MIN_FREE_GB phải là số nguyên (GB)."

  cd "$ROOT_DIR"
  check_prereqs
  require_free_disk_gb "$BACKUP_MIN_FREE_GB"
  acquire_lock
  precheck   # TRƯỚC mọi thao tác đọc Mongo/ghi/dump: lỗi phía code dừng ở đây, chưa có gì để dọn
  # Thư mục backup 700: ưu tiên `install -d -m 700` (như deploy.sh); Git Bash/NTFS báo lỗi chmod nên fallback mkdir + chmod có chịu lỗi.
  install -d -m 700 "$BACKUP_DIR" 2>/dev/null || { mkdir -p "$BACKUP_DIR" || die "Không tạo được thư mục $BACKUP_DIR."; chmod 700 "$BACKUP_DIR" 2>/dev/null || warn "Không đặt được quyền 700 cho $BACKUP_DIR (hệ file không hỗ trợ chmod?). Kiểm tay: ls -ld $BACKUP_DIR (backup chứa dữ liệu khách hàng)." || true; }
  [[ -d "$BACKUP_DIR" ]] || die "Không tạo được thư mục $BACKUP_DIR."

  local rc=0
  if (( DO_DB == 1 )); then
    backup_mongo || rc=$?
    if (( rc == 3 )); then
      (( DO_CODE == 1 )) || die "DB trống nên không có gì để backup (--db-only)."
      rc=0
    elif (( rc != 0 )); then
      exit "$rc"
    fi
  fi
  if (( DO_CODE == 1 )); then
    backup_code
  else
    DONE=1   # --db-only: archive đã nằm đúng chỗ, không dọn
  fi

  echo
  log "Backup xong. ${ARCHIVE_FILE:+DB: $ARCHIVE_FILE. }${BUNDLE_FILE:+Code: $BUNDLE_FILE (tag $TAG_NAME). }${MANIFEST_FILE:+Manifest: $MANIFEST_FILE.}"
  log "Hãy chép ./$BACKUP_DIR ra NGOÀI máy chủ (scp/rclone); backup cùng ổ đĩa không phải backup thật."
}

main "$@"
exit 0
