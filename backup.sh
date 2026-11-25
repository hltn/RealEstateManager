#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup.sh — backup THỦ CÔNG DB + thẻ image dự phòng (tách từ deploy.sh: backup Mongo + gắn thẻ image pre-<TS>). KHÔNG dùng git.
#
# Chạy ở máy chủ, trong thư mục deploy (nơi có docker-compose.yml, .env):
#   bash backup.sh [--db-only] [--no-image] [--help]
# (Dùng `bash backup.sh`, không phụ thuộc bit thực thi.) Không pull, không build, không up, không migrate, KHÔNG đụng stack đang chạy:
# chỉ ĐỌC từ Mongo (mongodump) và Docker (inspect/tag), ghi file vào ./backups (quyền 600/700) và gắn thẻ image.
#
# Mặc định tạo ĐỦ BỘ, cùng định dạng (manifest bản 2) với deploy.sh nên restore.sh dùng được ngay (--list / --manifest / --latest):
#   backups/deploy-pre-<TS>.archive.gz        mongodump DB realestate (kiểm cả nội dung: > 0 byte, gzip hợp lệ, có realestate.users)
#   image  <tên>-backend:pre-<TS>, <tên>-frontend:pre-<TS>   thẻ gắn vào image ĐANG CHẠY của hai container (bỏ bằng --no-image)
#   backups/deploy-pre-<TS>.manifest          KEY=VALUE, không bí mật (ghi CUỐI CÙNG: có manifest = backup đã đủ)
#
#   --db-only    chỉ mongodump. KHÔNG ghi manifest/thẻ image (quyết định có chủ ý) => bản này KHÔNG hiện trong `restore.sh --list` và restore.sh
#                không dùng được; khôi phục TAY bằng mongorestore (lệnh mẫu: tài liệu mục 6.2).
#   --no-image   không gắn thẻ image (manifest có BACKEND_PRE_IMAGE/FRONTEND_PRE_IMAGE rỗng => restore.sh chỉ dùng được với --db-only).
#   (Các cờ khôi phục code bằng git của bản cũ đã BỎ ở v1.0.6: không còn bản sao code git, code nay là image; tham số lạ thoát mã 2.)
#
# Manifest ghi: MANIFEST_VERSION=2, BACKUP_KIND=manual, PRE_TAG=pre-<TS>, BACKEND_/FRONTEND_PRE_IMAGE, RELEASE_VERSION/RELEASE_COMMIT (đọc từ release.env nếu có;
# CHỈ để tham khảo, có thể khác image đang chạy), CD_RUN_ID (từ DEPLOY_CD_RUN_ID/GITHUB_RUN_ID nếu có), DEPLOY_STATUS=succeeded, STACK_TOUCHED=1 (để restore.sh
# không gợi ý "DB chưa bị đổi, bỏ qua"), POST_UP_REACHED=0. Lỗi/ngắt giữa chừng: xóa các file và thẻ image vừa tạo ở lần chạy này.
# Dùng CHUNG khóa `.deploy.lock` (flock) với deploy.sh/restore.sh: không chạy chồng.
#
# Bí mật: script KHÔNG chứa bí mật. Mật khẩu root Mongo chỉ được đọc từ biến môi trường BÊN TRONG container và đưa cho mongodump qua pipe.
# Backup nằm cùng ổ đĩa không phải backup thật: chép ra NGOÀI máy chủ (scp/rclone).
#
# Biến môi trường tùy chọn (không bí mật): DUMP_TIMEOUT (giây, mặc định 900), OPS_EXEC_TIMEOUT (mặc định 300), BACKUP_MIN_FREE_GB (mặc định 2),
#   MONGO_CONTAINER, BACKEND_CONTAINER, FRONTEND_CONTAINER, DEPLOY_ENV_FILE (mặc định .env) và các biến staging DEPLOY_* (do ops/staging.sh đặt, như deploy.sh).
# Mã thoát: 0 ok | 1 lỗi (kể cả --db-only khi DB trống) | 2 sai tham số. Bị ngắt: 143 (TERM) / 130 (INT) / 129 (HUP), có dọn file/thẻ đã tạo.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="backup"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[backup] LỖI: không resolve được đường dẫn thật của backup.sh (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")" && pwd)"
# shellcheck source=ops/lib/ops-common.sh
source "$ROOT_DIR/ops/lib/ops-common.sh"

# Hợp đồng môi trường giống deploy.sh (staging.sh đặt các biến DEPLOY_*; production không đặt gì). Cả 4 biến + NINE_ROUTER_CONTAINER đều được
# check_staging_vars (ops-common) đọc để chặn biến staging đặt ngoài wrapper, nên KHÔNG xóa dù backup.sh không dùng trực tiếp.
readonly ENV_FILE="${DEPLOY_ENV_FILE:-.env}"
readonly RUNTIME_ENV_FILE="${DEPLOY_RUNTIME_ENV_FILE:-.env}"
readonly LOGS_DIR="${DEPLOY_LOGS_DIR:-logs}"
readonly BACKUP_DIR="${DEPLOY_BACKUP_DIR:-backups}"
readonly NINE_ROUTER_CONTAINER="${NINE_ROUTER_CONTAINER-realestate_9router}"
readonly MONGO_CONTAINER="${MONGO_CONTAINER:-realestate_mongo}"
readonly BACKEND_CONTAINER="${BACKEND_CONTAINER:-realestate_backend}"
readonly FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-realestate_frontend}"
readonly DEFAULT_PROJECT="realestatemanager"
readonly DEFAULT_BE_IMAGE="realestatemanager-backend"    # trùng mặc định ${BACKEND_IMAGE:-...:current} trong docker-compose.yml
readonly DEFAULT_FE_IMAGE="realestatemanager-frontend"
readonly RELEASE_ENV_FILE="release.env"
readonly DOC="docs/01_Infrastructure/06_Production_Deploy.md"
OPS_DEFAULT_ENV_FILE=".env"   # check_staging_vars so ENV_FILE với giá trị này (file env cũ khác tên đã bỏ ở v1.0.6)
check_staging_vars

DUMP_TIMEOUT="${DUMP_TIMEOUT:-900}"
BACKUP_MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-2}"
TS="$(date +%Y%m%d-%H%M%S)"
DB_ONLY=0; DO_IMAGE=1
ARCHIVE_FILE=""; MANIFEST_FILE=""
BE_PRE=""; FE_PRE=""   # thẻ image đã gắn ở lần chạy này (để on_exit gỡ khi lỗi)
DONE=0   # =1 khi manifest (hoặc archive ở --db-only) đã ghi xong: lúc đó on_exit KHÔNG dọn

usage() {
  cat <<'EOF'
Cách dùng: bash backup.sh [--db-only] [--no-image] [--help]

Backup THỦ CÔNG (không pull/build/up/migrate, không đụng stack đang chạy, không dùng git). Mặc định tạo đủ bộ trong ./backups, cùng định dạng với deploy.sh:
  deploy-pre-<TS>.archive.gz   mongodump DB realestate (đã kiểm nội dung)
  image <tên>-backend:pre-<TS> và <tên>-frontend:pre-<TS>  (gắn thẻ vào image đang chạy của hai container)
  deploy-pre-<TS>.manifest     KEY=VALUE (bản 2), không bí mật; ghi cuối cùng

  --db-only    chỉ mongodump. KHÔNG ghi manifest/thẻ image: bản này không hiện trong `restore.sh --list`, khôi phục TAY bằng mongorestore (mục 6.2).
  --no-image   không gắn thẻ image (restore.sh sau đó chỉ dùng được với --db-only).
  -h, --help   Hiện trợ giúp này.
(Các cờ code bằng git của bản cũ đã bỏ ở v1.0.6; tham số lạ thoát mã 2.)

Khôi phục: bash restore.sh --list ; bash restore.sh --latest   (mặc định dry-run; chạy thật cần --apply --yes).
Biến tùy chọn: DUMP_TIMEOUT (900), OPS_EXEC_TIMEOUT (300), BACKUP_MIN_FREE_GB (2). Chi tiết: tài liệu mục 6.2.
EOF
}

# Lỗi/ngắt giữa chừng: xóa những gì lần chạy NÀY đã tạo (file .partial, archive, manifest, thẻ image) khi chưa chốt manifest. Không đụng file cũ.
on_exit() {
  local code=$?
  trap - EXIT
  set +e
  trap '' PIPE TERM INT HUP   # dọn dẹp không bị ngắt giữa chừng (tín hiệu thứ hai không được bỏ dở việc dọn); như deploy.sh
  if (( code != 0 && DONE == 0 )); then
    [[ -z "$ARCHIVE_FILE" ]] || rm -f -- "${ARCHIVE_FILE}.partial" "$ARCHIVE_FILE"
    [[ -z "$MANIFEST_FILE" ]] || rm -f -- "${MANIFEST_FILE}.tmp" "$MANIFEST_FILE"   # MANIFEST_FILE chỉ được đặt SAU khi đã kiểm nó chưa tồn tại => không xóa nhầm file cũ
    # rmi một thẻ (không xóa layer nếu còn thẻ khác/container dùng); thẻ chưa gắn thì rmi chỉ báo lỗi, đã bỏ qua.
    if [[ -n "$BE_PRE" ]]; then docker rmi "$BE_PRE" >/dev/null 2>&1; fi
    if [[ -n "$FE_PRE" ]]; then docker rmi "$FE_PRE" >/dev/null 2>&1; fi
    warn "Backup THẤT BẠI (mã $code): đã dọn các file/thẻ image vừa tạo ở lần chạy này. Không có gì bị đổi ở stack/DB."
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

check_prereqs() {
  command -v gzip >/dev/null 2>&1 || die "Thiếu lệnh 'gzip'."
  command -v docker >/dev/null 2>&1 || die "Thiếu lệnh 'docker'."
  docker info >/dev/null 2>&1 || die "Không nói chuyện được với Docker daemon (daemon chưa chạy, hoặc user thiếu quyền: thêm vào nhóm 'docker')."
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
  [[ "$state" == "running" ]] || die "Container $MONGO_CONTAINER ở trạng thái '$state'. Khởi động Mongo trước."
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

# Đọc một khóa từ release.env (chỉ để tham khảo; KHÔNG `source`). Rỗng nếu không có file/khóa.
release_get() { { grep -m1 "^$1=" "$RELEASE_ENV_FILE" 2>/dev/null || true; } | cut -d= -f2- | tr -d '\r'; }

# Tên image: lấy từ release.env nếu hợp lệ (cùng dạng deploy.sh/restore.sh chấp nhận), không thì tên mặc định của docker-compose.yml.
pick_image_name() { # <KEY trong release.env> <tên mặc định>
  local n; n="$(release_get "$1")"
  if [[ "$n" =~ ^[a-z0-9][a-z0-9._/-]*$ && "$n" != *..* ]]; then printf '%s' "$n"; else printf '%s' "$2"; fi
}

# Gắn thẻ <tên>:pre-<TS> vào image ĐANG CHẠY của container $1 (cùng cách deploy.sh làm). In tên đầy đủ ra stdout nếu đã gắn, rỗng nếu container chưa có.
# Đặt BE_PRE/FE_PRE TRƯỚC `docker tag` (qua tham số $3: tên biến): bị ngắt ngay lúc tag thì on_exit vẫn gỡ được thẻ.
tag_running_image() { # <container> <tên image> <tên biến lưu ref>
  local container="$1" name="$2" var="$3" id ref="${2}:pre-${TS}"
  id="$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null || true)"
  if [[ -z "$id" ]]; then
    log "Chưa có container $container: không có image để dự phòng (manifest sẽ ghi rỗng; restore.sh chỉ dùng được --db-only)."
    return 0
  fi
  if docker image inspect "$ref" >/dev/null 2>&1; then
    die "Đã có thẻ image $ref (chạy chồng cùng giây?). Không ghi đè: chạy lại sau."
  fi
  printf -v "$var" '%s' "$ref"
  docker tag "$id" "$ref" || die "Không gắn được thẻ $ref."
  log "Đã gắn thẻ image $container hiện tại: $ref"
}

# Ghi manifest bản 2 (cuối cùng) và chốt DONE.
write_manifest() {
  local dbv="" got=0 host proj be_name fe_name rel_ver rel_commit cd_run
  be_name="$(pick_image_name BACKEND_IMAGE_NAME "$DEFAULT_BE_IMAGE")"
  fe_name="$(pick_image_name FRONTEND_IMAGE_NAME "$DEFAULT_FE_IMAGE")"
  if [[ "$(inspect_field "$MONGO_CONTAINER" '{{.State.Status}}')" == "running" ]] && dbv="$(read_system_version "$MONGO_CONTAINER")"; then
    got=1
  else
    dbv=""
  fi
  rel_ver="$(release_get RELEASE_VERSION)"; [[ "$rel_ver" =~ ^[0-9A-Za-z.+-]*$ ]] || rel_ver=""
  rel_commit="$(release_get GIT_COMMIT)";   [[ "$rel_commit" =~ ^[0-9a-f]{0,40}$ ]] || rel_commit=""
  cd_run="${DEPLOY_CD_RUN_ID:-${GITHUB_RUN_ID:-}}"
  [[ "$cd_run" =~ ^[A-Za-z0-9._-]{0,64}$ ]] || die "DEPLOY_CD_RUN_ID/GITHUB_RUN_ID sai dạng (chỉ A-Z a-z 0-9 . _ -, tối đa 64 ký tự)."
  proj="$(compose_label_project)"
  host="$(hostname 2>/dev/null || true)"
  # Đã kiểm ở main rằng manifest chưa tồn tại; đặt MANIFEST_FILE ngay trước khi ghi để on_exit dọn được cả manifest "mồ côi" nếu bị ngắt sát lúc này.
  MANIFEST_FILE="${BACKUP_DIR}/deploy-pre-${TS}.manifest"
  manifest_write "$MANIFEST_FILE" \
    "# Backup THỦ CÔNG bằng backup.sh (không phải lần deploy). Khôi phục: bash restore.sh --manifest ${MANIFEST_FILE}" \
    "MANIFEST_VERSION=2" \
    "BACKUP_KIND=manual" \
    "TS=${TS}" \
    "CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "HOST=${host:-unknown}" \
    "COMPOSE_PROJECT=${proj}" \
    "RELEASE_VERSION=${rel_ver}" \
    "RELEASE_COMMIT=${rel_commit}" \
    "CD_RUN_ID=${cd_run}" \
    "BACKEND_IMAGE_NAME=${be_name}" \
    "BACKEND_IMAGE_TAG=" \
    "FRONTEND_IMAGE_NAME=${fe_name}" \
    "FRONTEND_IMAGE_TAG=" \
    "PRE_TAG=pre-${TS}" \
    "BACKEND_PRE_IMAGE=${BE_PRE}" \
    "FRONTEND_PRE_IMAGE=${FE_PRE}" \
    "DB_VERSION_BEFORE=${dbv}" \
    "DB_VERSION_READ=${got}" \
    "MONGO_BACKUP_FILE=${ARCHIVE_FILE}" \
    "ENV_BACKUP_FILE=" \
    "MONGO_CONTAINER=${MONGO_CONTAINER}" \
    "BACKEND_CONTAINER=${BACKEND_CONTAINER}" \
    "FRONTEND_CONTAINER=${FRONTEND_CONTAINER}" \
    "STACK_TOUCHED=1" \
    "POST_UP_REACHED=0" \
    "DEPLOY_STATUS=succeeded" \
    "FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    || die "Không ghi được manifest $MANIFEST_FILE."
  DONE=1
  log "Manifest: $MANIFEST_FILE (khôi phục: bash restore.sh --manifest $MANIFEST_FILE)"
}

# Project compose của container backend (nhãn compose), không có thì COMPOSE_PROJECT_NAME rồi mặc định. Chỉ để ghi thông tin vào manifest.
compose_label_project() {
  local p
  p="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
  [[ -n "$p" ]] || p="${COMPOSE_PROJECT_NAME:-$DEFAULT_PROJECT}"
  printf '%s' "$p"
}

main() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --db-only)   DB_ONLY=1 ;;
      --no-image)  DO_IMAGE=0 ;;
      -h|--help)   trap - EXIT; usage; exit 0 ;;
      *) trap - EXIT; printf '[backup] Tham số không hợp lệ: %s\n(Các cờ code bằng git của bản cũ đã bỏ ở v1.0.6: code nay là image pre-<TS>; chỉ DB thì dùng --db-only.)\n\n' "$arg" >&2; usage >&2; exit 2 ;;
    esac
  done
  [[ "$DUMP_TIMEOUT" =~ ^[0-9]+$ && "$OPS_EXEC_TIMEOUT" =~ ^[0-9]+$ ]] || die "DUMP_TIMEOUT/OPS_EXEC_TIMEOUT phải là số nguyên (giây)."
  [[ "$BACKUP_MIN_FREE_GB" =~ ^[0-9]+$ ]] || die "BACKUP_MIN_FREE_GB phải là số nguyên (GB)."

  cd "$ROOT_DIR"
  check_prereqs
  require_free_disk_gb "$BACKUP_MIN_FREE_GB"
  acquire_dir_lock "$ROOT_DIR"
  [[ ! -e "${BACKUP_DIR}/deploy-pre-${TS}.archive.gz" ]] || die "Đã có ${BACKUP_DIR}/deploy-pre-${TS}.archive.gz (chạy chồng cùng giây?). Không ghi đè backup: chạy lại sau."
  [[ ! -e "${BACKUP_DIR}/deploy-pre-${TS}.manifest" ]] || die "Đã có ${BACKUP_DIR}/deploy-pre-${TS}.manifest. Không ghi đè: chạy lại sau."
  # Thư mục backup 700: ưu tiên `install -d -m 700` (như deploy.sh); Git Bash/NTFS báo lỗi chmod nên fallback mkdir + chmod có chịu lỗi.
  install -d -m 700 "$BACKUP_DIR" 2>/dev/null || { mkdir -p "$BACKUP_DIR" || die "Không tạo được thư mục $BACKUP_DIR."; chmod 700 "$BACKUP_DIR" 2>/dev/null || warn "Không đặt được quyền 700 cho $BACKUP_DIR (hệ file không hỗ trợ chmod?). Kiểm tay: ls -ld $BACKUP_DIR (backup chứa dữ liệu khách hàng)." || true; }
  [[ -d "$BACKUP_DIR" ]] || die "Không tạo được thư mục $BACKUP_DIR."

  local rc=0
  backup_mongo || rc=$?
  if (( rc == 3 )); then
    (( DB_ONLY == 0 )) || die "DB trống nên không có gì để backup (--db-only)."
  elif (( rc != 0 )); then
    exit "$rc"
  fi

  if (( DB_ONLY == 1 )); then
    DONE=1   # --db-only: archive đã nằm đúng chỗ, không manifest, không dọn
  else
    if (( DO_IMAGE == 1 )); then
      tag_running_image "$BACKEND_CONTAINER" "$(pick_image_name BACKEND_IMAGE_NAME "$DEFAULT_BE_IMAGE")" BE_PRE
      tag_running_image "$FRONTEND_CONTAINER" "$(pick_image_name FRONTEND_IMAGE_NAME "$DEFAULT_FE_IMAGE")" FE_PRE
    fi
    write_manifest
  fi

  echo
  log "Backup xong. ${ARCHIVE_FILE:+DB: $ARCHIVE_FILE. }${BE_PRE:+Image: $BE_PRE${FE_PRE:+ + $FE_PRE}. }${MANIFEST_FILE:+Manifest: $MANIFEST_FILE.}"
  log "Hãy chép ./$BACKUP_DIR ra NGOÀI máy chủ (scp/rclone); backup cùng ổ đĩa không phải backup thật."
}

main "$@"
exit 0
