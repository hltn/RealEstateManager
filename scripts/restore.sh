#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/restore.sh — khôi phục DB Mongo + CODE về phiên bản TRƯỚC một lần deploy (dùng backup do deploy.sh tạo).
#
# Chạy ở máy chủ (Ubuntu 24.04), trong repo:   bash scripts/restore.sh <chế-độ> [tùy chọn]
# (Dùng `bash scripts/restore.sh`, không phụ thuộc bit thực thi.) Tài liệu: docs/01_Infrastructure/06_Production_Deploy.md (mục 6 và 11).
#
# Chọn bản backup (đúng MỘT trong):
#   --list              liệt kê các manifest trong backups/ (chỉ đọc, không cần Docker)
#   --latest            dùng manifest mới nhất (deploy-pre-<TS>.manifest, TS lớn nhất) CÓ backup Mongo; manifest không có MONGO_BACKUP_FILE bị bỏ qua
#                       (có cảnh báo) trừ khi --code-only. Deploy bị chạy lại nhiều lần: xem tài liệu mục 6.1 để chọn đúng manifest (--list rồi --manifest).
#   --manifest <file>   dùng manifest cụ thể (phải nằm trong thư mục backups)
# Tùy chọn:
#   --apply --yes       CHẠY THẬT. Mặc định là DRY-RUN: chỉ kiểm tra + in kế hoạch, KHÔNG đổi gì. `--yes` là cờ tường minh duy nhất
#                       (KHÔNG có biến môi trường thay thế, giống `restore-dump` của scripts/staging.sh); thiếu --yes thì từ chối, không đổi gì.
#   --db-only           chỉ khôi phục DB (không đụng code/image)
#   --code-only         chỉ khôi phục code + image (không đụng DB)
#   --use-image-tag     dùng image backend dự phòng pre-<TS> trong manifest (--no-build) thay vì build lại từ code đã khôi phục; chưa có image đó thì DỪNG
#   --skip-safety-db    (cùng --apply --yes) KHÔNG dump lại DB hiện tại: dùng khi chạy lại sau lần restore bị ngắt giữa mongorestore (DB dở dang không
#                       dump được). Chốt chặn: backup an toàn MỚI NHẤT phải còn nguyên (> 0 byte, gzip, mongorestore --dryRun thấy users) VÀ DB hiện tại phải thật
#                       sự dở dang (không có users nhưng có dữ liệu khác); DB khỏe hoặc trống thì TỪ CHỐI. In rõ backup/tag an toàn đã có. Không đi với --code-only.
#   --allow-infra-change  chấp nhận khôi phục code làm ĐỔI docker-compose*.yml/Dockerfile/nginx.conf/docker/ so với HEAD hiện tại (mặc định DỪNG, chưa đổi gì)
#   -h, --help
#
# Manifest + bundle + tag do deploy.sh tạo TRƯỚC `git pull` (xem deploy.sh, bước 2b). Nhánh/commit lấy từ manifest: KHÔNG giả định tên nhánh.
#
# Kiểm TRƯỚC khi đổi bất cứ gì (dry-run cũng chạy; hỏng thì --apply dừng, chưa đổi gì): manifest hợp lệ; backup Mongo > 0 byte, gzip -t,
# `mongorestore --dryRun` thấy realestate.users (verify_backup_archive); bundle qua `git bundle verify` và chứa đúng commit; working tree sạch;
# không có deploy/restore khác đang chạy (cùng khóa <git-dir>/realestate-deploy.lock với deploy.sh); đủ đĩa; (--use-image-tag) image còn tồn tại;
# khôi phục không làm đổi file hạ tầng (docker-compose*.yml, Dockerfile, nginx.conf, docker/) trừ --allow-infra-change; không có file untracked bị git reset --hard đè.
#
# --apply làm lần lượt:
#   1) chuẩn bị (CHƯA đổi gì): commit đã mất khỏi repo thì nạp lại từ bundle bằng `git fetch <bundle>` rồi kiểm lại hạ tầng/untracked; lỗi = dừng, DB và backend nguyên vẹn
#   2) dừng backend (Mongo giữ chạy) — dừng TRƯỚC backup để không còn ai ghi DB trong lúc dump
#   3) backup AN TOÀN trạng thái HIỆN TẠI: mongodump backups/restore-safety-<TS>.archive.gz + tag git cục bộ pre-restore-<TS> tại HEAD hiện tại.
#      Lỗi (hay bị ngắt) ở bước 2-3: dữ liệu chưa đổi nên script tự BẬT LẠI backend rồi thoát, không in hướng dẫn "dừng giữa chừng"
#   4) DB: xóa DB realestate rồi `mongorestore --archive --gzip --drop --nsInclude 'realestate.*'` (mật khẩu root chỉ qua pipe/env TRONG container)
#   5) code: `git switch <nhánh>` + `git reset --hard <commit>` (hoặc `git switch --detach <commit>` khi manifest DETACHED=1)
#   6) image: mặc định `compose up -d --build` từ code đã khôi phục; --use-image-tag: gắn lại thẻ image dự phòng rồi `up --no-build`
#   7) chờ mongo healthy + backend liveness
#   8) kiểm sau: `system.version` của DB khớp manifest, và code (commit + version) khớp manifest; in số liệu
# Lỗi từ bước 4 trở đi (hoặc SIGTERM/SIGINT/SIGHUP): IN hướng dẫn, KHÔNG tự rollback tiếp, thoát mã khác 0 (143/130/129 khi bị tín hiệu).
#
# Chạy từ BẢN SAO ngoài repo (khi bản code đã khôi phục không còn scripts/restore.sh): chép restore.sh + thư mục lib/ ra chỗ khác rồi đặt
# RESTORE_REPO_DIR=<repo>. Thư viện lấy từ lib/ cạnh script, repo lấy từ RESTORE_REPO_DIR (mặc định: thư mục cha của scripts/).
#
# CẢNH BÁO MỘT CHIỀU: nếu deploy đã qua điểm hậu-migrate (manifest POST_UP_REACHED=1: bước 90 = migration 011 một chiều có thể đã chạy) thì khôi phục DB
# là đường quay lại DUY NHẤT, và MỌI dữ liệu phát sinh sau thời điểm backup Mongo sẽ MẤT. Script in cảnh báo ĐỎ (và vẫn chỉ chạy thật khi có --yes).
#
# Mã thoát: 0 ok | 1 lỗi/kiểm hỏng | 2 sai cách dùng (thiếu --yes cũng là 2).
#
# Staging: cùng hợp đồng biến với deploy.sh (DEPLOY_ENV_FILE, DEPLOY_RUNTIME_ENV_FILE, DEPLOY_LOGS_DIR, DEPLOY_BACKUP_DIR, NINE_ROUTER_CONTAINER, MONGO_CONTAINER,
# BACKEND_CONTAINER; hợp lệ chỉ khi COMPOSE_PROJECT_NAME=realestate-staging và COMPOSE_FILE có docker-compose.staging.yml). Production KHÔNG đặt các biến này.
# Biến tùy chọn: MONGO_TIMEOUT, HEALTH_TIMEOUT, HEALTH_URL, DEPLOY_MIN_FREE_GB, DUMP_TIMEOUT (backup an toàn), RESTORE_TIMEOUT (mongorestore, mặc định 1800 giây),
# OPS_EXEC_TIMEOUT.
#
# Bí mật: script KHÔNG chứa bí mật; mật khẩu root Mongo chỉ đọc từ biến môi trường BÊN TRONG container (như deploy.sh), không nằm trên dòng lệnh/log.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="restore"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[restore] LỖI: không resolve được đường dẫn thật của restore.sh (cần readlink -f)." >&2; exit 1; }
# Thư viện nằm cạnh script (scripts/lib), KHÔNG phụ thuộc repo: nhờ vậy chạy được từ BẢN SAO ngoài repo (xem RESTORE_REPO_DIR). Repo đích:
# RESTORE_REPO_DIR nếu đặt (dùng khi bản code đã khôi phục không còn scripts/restore.sh), mặc định là thư mục cha của scripts/.
LIB_DIR="$(cd "$(dirname "$_self")/lib" 2>/dev/null && pwd)" || { echo "[restore] LỖI: không thấy thư mục lib/ cạnh restore.sh (cần scripts/lib/ops-common.sh)." >&2; exit 1; }
# shellcheck source=scripts/lib/ops-common.sh
source "$LIB_DIR/ops-common.sh"
if [[ -n "${RESTORE_REPO_DIR:-}" ]]; then
  ROOT_DIR="$(cd "$RESTORE_REPO_DIR" 2>/dev/null && pwd)" || die "RESTORE_REPO_DIR='$RESTORE_REPO_DIR' không phải thư mục."
else
  ROOT_DIR="$(cd "$(dirname "$_self")/.." && pwd)"
fi

# Hợp đồng biến giống deploy.sh (staging dùng đường dẫn tương đối riêng; production giữ mặc định).
readonly ENV_FILE="${DEPLOY_ENV_FILE:-.env.docker}"
readonly RUNTIME_ENV_FILE="${DEPLOY_RUNTIME_ENV_FILE:-.env}"
readonly LOGS_DIR="${DEPLOY_LOGS_DIR:-logs}"
readonly BACKUP_DIR="${DEPLOY_BACKUP_DIR:-backups}"
readonly NINE_ROUTER_CONTAINER="${NINE_ROUTER_CONTAINER-realestate_9router}"
readonly MONGO_CONTAINER="${MONGO_CONTAINER:-realestate_mongo}"
readonly BACKEND_CONTAINER="${BACKEND_CONTAINER:-realestate_backend}"
readonly DOC="docs/01_Infrastructure/06_Production_Deploy.md"
check_staging_vars

MONGO_TIMEOUT="${MONGO_TIMEOUT:-120}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
HEALTH_URL="${HEALTH_URL:-http://localhost/api/v1/health/liveness}"
DEPLOY_MIN_FREE_GB="${DEPLOY_MIN_FREE_GB:-5}"
DUMP_TIMEOUT="${DUMP_TIMEOUT:-900}"
RESTORE_TIMEOUT="${RESTORE_TIMEOUT:-1800}"

RTS="$(date +%Y%m%d-%H%M%S)"   # thời gian của LẦN RESTORE này (khác TS của deploy trong manifest)
ACTION=""            # list | latest | manifest
MANIFEST_ARG=""
APPLY=0
YES=0
DB_ONLY=0
CODE_ONLY=0
USE_IMAGE_TAG=0
SKIP_SAFETY_DB=0     # --skip-safety-db: không dump lại DB hiện tại (chạy lại sau khi mongorestore bị ngắt: DB đang dở dang)
ALLOW_INFRA_CHANGE=0 # --allow-infra-change: chấp nhận khôi phục làm đổi file hạ tầng (docker-compose/Dockerfile/nginx)
TOUCHED=0            # =1 từ lúc bắt đầu đổi dữ liệu/code (sau backup an toàn): lỗi thì in hướng dẫn
SAFE_PHASE=0         # =1 khi backend đã dừng nhưng DB/code CHƯA bị đổi (dừng backend -> backup an toàn -> tag): lỗi thì BẬT LẠI backend
EFFECTS_CHECKED=0    # =1 khi đã kiểm xong "khôi phục có đổi file hạ tầng / đè file untracked không" (cần commit đích có trong repo)
STEP="chuẩn bị"
SAFETY_FILE=""
SAFETY_TAG=""
MANIFEST_PATH=""     # đường dẫn tuyệt đối của manifest đang dùng
BUNDLE_PATH=""       # đường dẫn tuyệt đối đã resolve của bundle
DB_ARCHIVE=""        # đường dẫn tuyệt đối đã resolve của backup Mongo
PRE_FAIL=0
declare -A MF=()

# Khóa manifest được chấp nhận (whitelist; khóa lạ bị bỏ qua, KHÔNG `source` manifest).
readonly MANIFEST_KEYS="MANIFEST_VERSION BACKUP_KIND TS CREATED_AT HOST COMPOSE_PROJECT BRANCH DETACHED OLD_COMMIT OLD_COMMIT_SHORT NEW_COMMIT APP_VERSION_OLD APP_VERSION_NEW DB_VERSION_BEFORE DB_VERSION_READ MONGO_BACKUP_FILE MONGO_CONTAINER BACKEND_CONTAINER CODE_BUNDLE CODE_BUNDLE_REF CODE_TAG PREV_IMAGE_REPO PREV_IMAGE_TAG TRACKED_DIRTY NO_PULL STACK_TOUCHED POST_UP_REACHED DEPLOY_STATUS FINISHED_AT"

usage() {
  cat <<'EOF'
Cách dùng: bash scripts/restore.sh (--list | --latest | --manifest <file>) [--apply --yes] [--db-only | --code-only] [--use-image-tag] [--skip-safety-db] [--allow-infra-change] [--help]

Khôi phục DB Mongo + code về phiên bản TRƯỚC một lần deploy, theo manifest/bundle/backup do deploy.sh tạo trong backups/.

  --list              Liệt kê manifest trong backups/ (chỉ đọc).
  --latest            Dùng manifest mới nhất CÓ backup Mongo (bản không có bị bỏ qua, trừ khi --code-only).
  --manifest <file>   Dùng manifest cụ thể (file trong thư mục backups).
  --apply --yes       CHẠY THẬT (mặc định chỉ dry-run: kiểm + in kế hoạch, không đổi gì). Bắt buộc có CẢ HAI; không có biến môi trường thay --yes.
  --db-only           Chỉ khôi phục DB.
  --code-only         Chỉ khôi phục code + image.
  --use-image-tag     Dùng image backend dự phòng pre-<TS> (--no-build) thay vì build lại từ code đã khôi phục.
  --skip-safety-db    Không dump lại DB hiện tại (chạy lại sau lần restore bị ngắt giữa mongorestore); chỉ nhận khi backup an toàn mới nhất còn nguyên và DB hiện tại dở dang (không users, có dữ liệu khác).
  --allow-infra-change  Chấp nhận khôi phục làm đổi docker-compose*.yml/Dockerfile/nginx.conf/docker/ (mặc định dừng).
  -h, --help          Hiện trợ giúp này.

Khi chạy thật: (1) chuẩn bị, chưa đổi gì (nạp commit từ bundle nếu repo đã mất) -> (2) dừng backend -> (3) backup an toàn trạng thái hiện tại (mongodump
restore-safety-<TS> + tag git pre-restore-<TS>; lỗi ở bước 2-3 thì tự bật lại backend) -> (4) khôi phục DB (xóa DB realestate rồi mongorestore --drop
--nsInclude 'realestate.*') -> (5) git switch <nhánh> + git reset --hard <commit> -> (6) up -d --build (hoặc --use-image-tag: up --no-build)
-> (7) chờ mongo healthy + backend liveness -> (8) kiểm DB version + code version khớp manifest.
Chạy từ bản sao ngoài repo: RESTORE_REPO_DIR=<repo> bash <bản-sao>/scripts/restore.sh ... (cần kèm thư mục lib/).
Lỗi từ bước 4 (hoặc bị tín hiệu): in hướng dẫn, KHÔNG tự rollback tiếp. Deploy đã qua bước 90 (migration 011 một chiều): khôi phục DB là đường quay lại DUY NHẤT và mất dữ liệu
phát sinh sau backup (cảnh báo đỏ). Chi tiết: tài liệu mục 6 và 11.
EOF
}

# Mọi lệnh compose đều kèm --env-file (giống deploy.sh).
compose() { docker compose --env-file "$ENV_FILE" "$@"; }
red() { printf '\033[1;31m[%s] %s\033[0m\n' "$LOG_PREFIX" "$*" >&2; }
pass() { printf '[%s]   [ĐẠT]  %s\n' "$LOG_PREFIX" "$*"; }
bad()  { printf '\033[1;31m[%s]   [HỎNG] %s\033[0m\n' "$LOG_PREFIX" "$*" >&2; PRE_FAIL=$(( PRE_FAIL + 1 )); }

# Đường dẫn tuyệt đối đã resolve của $1; die nếu không nằm TRONG thư mục backups (chặn manifest bị sửa trỏ ra file lạ).
resolve_in_backup_dir() { # <đường dẫn> <nhãn>
  local given="$1" label="$2" real base
  [[ -n "$given" ]] || die "$label rỗng."
  real="$(readlink -f -- "$given" 2>/dev/null || true)"
  base="$(readlink -f -- "$ROOT_DIR/$BACKUP_DIR" 2>/dev/null || true)"
  [[ -n "$real" && -n "$base" && "$real" == "$base"/* ]] \
    || die "$label '$given' nằm NGOÀI thư mục $BACKUP_DIR/. Từ chối (chỉ đọc file trong thư mục backup của deploy). Chép file vào $BACKUP_DIR/ rồi chạy lại."
  printf '%s' "$real"
}

# Đường dẫn trong manifest là tương đối repo (vd backups/xxx) hoặc tuyệt đối; tương đối thì tính từ gốc repo.
manifest_path_abs() { [[ "$1" == /* ]] && printf '%s' "$1" || printf '%s/%s' "$ROOT_DIR" "$1"; }

# ── Đọc + kiểm manifest ──────────────────────────────────────────────────────
# Bỏ ký tự điều khiển (ASCII 0-31, 127) trước khi in dữ liệu không tin cậy (tên file, dòng manifest) ra terminal.
strip_ctl() { printf '%s' "$1" | LC_ALL=C tr -d '\000-\037\177'; }

read_manifest() { # <file>: nạp vào MF[...]; die nếu sai
  local f="$1" line key val n=0
  [[ -f "$f" && -s "$f" ]] || die "Không thấy manifest '$f' (hoặc rỗng)."
  MF=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ -z "$line" || "$line" == \#* ]]; then continue; fi
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || die "Manifest '$f' có dòng sai định dạng KEY=VALUE: '$(strip_ctl "${line:0:60}")'."
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    # Giá trị manifest được in ra màn hình (--list, kế hoạch) và có khóa dùng cho lệnh docker/git: ký tự điều khiển (ESC, ...) chỉ có thể là manifest bị
    # sửa/giả mạo (deploy.sh/backup.sh không bao giờ ghi) nên TỪ CHỐI, không in lại giá trị (tránh chèn chuỗi điều khiển terminal vào đầu ra).
    [[ ! "$val" =~ [[:cntrl:]] ]] || die "Manifest '$(strip_ctl "$f")' có ký tự điều khiển trong giá trị của khóa $key: từ chối (manifest bị sửa tay/hỏng)."
    n=$(( n + 1 ))
    case " $MANIFEST_KEYS " in *" $key "*) MF[$key]="$val" ;; *) : ;; esac
  done < "$f"
  (( n > 0 )) || die "Manifest '$f' không có dòng KEY=VALUE nào."
  validate_manifest "$f"
}

validate_manifest() { # <file>
  local f="$1" k b
  for k in MANIFEST_VERSION TS DETACHED OLD_COMMIT CODE_BUNDLE CODE_BUNDLE_REF CODE_TAG DEPLOY_STATUS; do
    [[ -n "${MF[$k]:-}" ]] || die "Manifest '$f' thiếu khóa bắt buộc $k."
  done
  [[ "${MF[MANIFEST_VERSION]}" == "1" ]] || die "Manifest '$f' có MANIFEST_VERSION=${MF[MANIFEST_VERSION]} (script này chỉ hiểu bản 1): dùng restore.sh khớp phiên bản deploy.sh đã tạo nó."
  [[ "${MF[TS]}" =~ ^[0-9]{8}-[0-9]{6}$ ]] || die "Manifest '$f': TS không đúng dạng YYYYMMDD-HHMMSS."
  [[ "${MF[OLD_COMMIT]}" =~ ^[0-9a-f]{40}$ ]] || die "Manifest '$f': OLD_COMMIT không phải SHA-1 40 ký tự thường."
  [[ "${MF[DETACHED]}" =~ ^[01]$ ]] || die "Manifest '$f': DETACHED phải là 0 hoặc 1."
  [[ "${MF[CODE_TAG]}" =~ ^pre-deploy-[0-9]{8}-[0-9]{6}$ ]] || die "Manifest '$f': CODE_TAG không đúng dạng pre-deploy-<TS>."
  # CODE_BUNDLE_REF: HEAD hoặc refs/heads/<tên nhánh hợp lệ> (cùng quy tắc tên nhánh, chặn '..' trong ref).
  [[ "${MF[CODE_BUNDLE_REF]}" == "HEAD" || ( "${MF[CODE_BUNDLE_REF]}" == refs/heads/* && "${MF[CODE_BUNDLE_REF]}" != *..* ) ]] \
    && { [[ "${MF[CODE_BUNDLE_REF]}" == "HEAD" ]] || valid_branch_name "${MF[CODE_BUNDLE_REF]#refs/heads/}"; } \
    || die "Manifest '$f': CODE_BUNDLE_REF không hợp lệ."
  [[ "${MF[DEPLOY_STATUS]}" =~ ^(started|succeeded|failed)$ ]] || die "Manifest '$f': DEPLOY_STATUS phải là started|succeeded|failed."
  # DETACHED=1 thì BỎ QUA BRANCH (manifest có cả hai thì DETACHED thắng: khôi phục bằng `git switch --detach`, không đụng nhánh).
  if [[ "${MF[DETACHED]}" == "1" ]]; then MF[BRANCH]=""; fi
  b="${MF[BRANCH]:-}"
  if [[ "${MF[DETACHED]}" == "0" ]]; then
    valid_branch_name "$b" || die "Manifest '$f': tên nhánh '$b' không hợp lệ."
  fi
  [[ "${MF[DB_VERSION_BEFORE]:-}" =~ ^[0-9A-Za-z.+-]*$ ]] || die "Manifest '$f': DB_VERSION_BEFORE có ký tự lạ."
  [[ "${MF[DB_VERSION_READ]:-0}" =~ ^[01]$ ]] || die "Manifest '$f': DB_VERSION_READ phải là 0 hoặc 1."
  [[ "${MF[POST_UP_REACHED]:-0}" =~ ^[01]$ ]] || die "Manifest '$f': POST_UP_REACHED phải là 0 hoặc 1."
  [[ "${MF[APP_VERSION_OLD]:-}" =~ ^[0-9A-Za-z.+-]*$ ]] || die "Manifest '$f': APP_VERSION_OLD có ký tự lạ."
  if [[ -n "${MF[MONGO_BACKUP_FILE]:-}" ]]; then
    DB_ARCHIVE="$(resolve_in_backup_dir "$(manifest_path_abs "${MF[MONGO_BACKUP_FILE]}")" "MONGO_BACKUP_FILE")"
  else
    DB_ARCHIVE=""
  fi
  BUNDLE_PATH="$(resolve_in_backup_dir "$(manifest_path_abs "${MF[CODE_BUNDLE]}")" "CODE_BUNDLE")"
}

# Có cờ một chiều không: deploy đã tới điểm hậu-migrate (bước 90 có thể đã chạy).
one_way_risk() { [[ "${MF[POST_UP_REACHED]:-0}" == "1" ]]; }

# ── --list ───────────────────────────────────────────────────────────────────
# Mỗi manifest in một khối ngắn. Manifest hỏng chỉ báo hỏng (không dừng cả danh sách).
list_manifests() {
  local base="$ROOT_DIR/$BACKUP_DIR" f n=0
  local -a files=()
  for f in "$base"/deploy-pre-*.manifest; do
    [[ -f "$f" ]] && files+=("$f")
  done
  if (( ${#files[@]} == 0 )); then
    log "Chưa có manifest nào trong $BACKUP_DIR/ (deploy.sh tạo manifest ở mỗi lần deploy thật; bản deploy cũ hơn chưa có)."
    return 0
  fi
  log "Các bản backup trước deploy trong $BACKUP_DIR/ (cũ -> mới, mới nhất ở cuối):"
  for f in "${files[@]}"; do
    n=$(( n + 1 ))
    ( list_one "$f" "$n" ) || printf '  %s) %s  [MANIFEST HỎNG: không đọc/kiểm được, xem lỗi ở trên]\n' "$n" "$(strip_ctl "$(basename "$f")")"
  done
  log "Xem kế hoạch (dry-run):  bash scripts/restore.sh --manifest $BACKUP_DIR/<tên manifest>   |   mới nhất: --latest"
}
list_one() { # <file> <số thứ tự> (chạy trong subshell)
  local f="$1" i="$2" db="THIẾU" bu="THIẾU" dbn=""
  read_manifest "$f"
  if [[ -z "$DB_ARCHIVE" ]]; then
    db="KHÔNG CÓ (DB trống lúc deploy hoặc backup bị bỏ qua; --latest sẽ bỏ qua bản này, chỉ dùng được với --code-only)"
  elif [[ -s "$DB_ARCHIVE" ]]; then
    db="có ($(du -h "$DB_ARCHIVE" | cut -f1))"
  fi
  if [[ -s "$BUNDLE_PATH" ]]; then bu="có ($(du -h "$BUNDLE_PATH" | cut -f1))"; fi
  dbn="${MF[DB_VERSION_BEFORE]:-}"
  [[ "${MF[DB_VERSION_READ]:-0}" == "1" ]] || dbn="(không đọc được)"
  [[ -n "$dbn" ]] || dbn="(chưa có version)"
  # Nhãn chỉ khi BACKUP_KIND đúng `manual` (khóa này chỉ scripts/backup.sh ghi); giá trị khác không được hiện lại ra màn hình.
  printf '  %s) %s%s\n' "$i" "$(strip_ctl "$(basename "$f")")" "$([[ "${MF[BACKUP_KIND]:-}" == "manual" ]] && printf '  [loại: manual (backup thủ công bằng scripts/backup.sh)]')"
  printf '       thời gian: %s | trạng thái deploy: %s | nhánh: %s | commit trước: %s -> sau: %s\n' \
    "${MF[CREATED_AT]:-${MF[TS]}}" "${MF[DEPLOY_STATUS]}" "${MF[BRANCH]:-(detached)}" "${MF[OLD_COMMIT]:0:12}" "${MF[NEW_COMMIT]:+${MF[NEW_COMMIT]:0:12}}"
  printf '       version app: %s -> %s | version DB trước deploy: %s\n' "${MF[APP_VERSION_OLD]:-?}" "${MF[APP_VERSION_NEW]:-?}" "$dbn"
  printf '       backup Mongo: %s | bundle code: %s | tag: %s | image dự phòng: %s\n' "$db" "$bu" "${MF[CODE_TAG]}" "${MF[PREV_IMAGE_TAG]:-(không có)}"
  if one_way_risk; then
    printf '       LƯU Ý: đã qua điểm hậu-migrate (bước 90, migration 011 một chiều): restore DB là đường quay lại duy nhất, mất dữ liệu sau backup.\n'
  fi
}

# Manifest MỚI NHẤT dùng được. Khôi phục DB (không --code-only) bỏ qua manifest không có backup Mongo (MONGO_BACKUP_FILE rỗng: vd lần deploy bị
# dừng trước bước backup), có cảnh báo; --code-only không cần backup Mongo nên lấy manifest mới nhất bất kể.
latest_manifest() {
  local base="$ROOT_DIR/$BACKUP_DIR" f i
  local -a files=()
  for f in "$base"/deploy-pre-*.manifest; do
    [[ -f "$f" ]] && files+=("$f")    # glob đã sắp theo tên; TS dạng YYYYMMDD-HHMMSS nên tên lớn nhất = mới nhất
  done
  (( ${#files[@]} > 0 )) || die "Không có manifest nào trong $BACKUP_DIR/ (bản deploy cũ chưa tạo manifest). Dùng: bash scripts/restore.sh --list"
  for (( i=${#files[@]}-1; i>=0; i-- )); do
    f="${files[i]}"
    if (( CODE_ONLY == 0 )) && ! grep -q '^MONGO_BACKUP_FILE=.' "$f" 2>/dev/null; then
      warn "--latest: bỏ qua $(strip_ctl "$(basename "$f")") vì không có backup Mongo (MONGO_BACKUP_FILE rỗng); sẽ chọn bản CŨ HƠN có backup (DB + code về lần đó, KHÔNG về điểm mới nhất này). Chỉ khôi phục code thì thêm --code-only; hoặc chọn tay: --list rồi --manifest <file>."
      continue
    fi
    printf '%s' "$f"
    return 0
  done
  die "Không manifest nào trong $BACKUP_DIR/ có backup Mongo để khôi phục DB. Dùng --code-only (chỉ code), hoặc --list rồi --manifest <file>."
}

# ── Tiền điều kiện chung ─────────────────────────────────────────────────────
check_prereqs() {
  local cmd
  for cmd in docker gzip git; do
    command -v "$cmd" >/dev/null 2>&1 || die "Thiếu lệnh '$cmd'."
  done
  (( APPLY == 0 )) || command -v curl >/dev/null 2>&1 || die "Thiếu lệnh 'curl'."
  docker compose version >/dev/null 2>&1 || die "Thiếu 'docker compose' (plugin v2)."
  docker info >/dev/null 2>&1 || die "Không nói chuyện được với Docker daemon (daemon chưa chạy, hoặc user thiếu quyền: thêm vào nhóm 'docker')."
  require_private_file "$ENV_FILE"
  require_no_placeholders "$ENV_FILE"
  in_git_repo || die "Không phải git repo: restore.sh cần repo git (bundle/tag/reset). Chạy trong repo, hoặc đặt RESTORE_REPO_DIR trỏ tới repo."
}

# Có deploy/restore khác đang chạy không. Chạy thật: GIỮ khóa đến hết tiến trình (cùng khóa với deploy.sh). Dry-run: chỉ THỬ khóa (mở file chỉ-đọc,
# không tạo/ghi gì) để báo trạng thái.
check_lock() {
  # Thư mục git thật qua `git rev-parse --git-dir` (đúng cả worktree, nơi `.git` là FILE): cùng đường dẫn với acquire_lock của deploy.sh.
  local gd lock
  gd="$(git rev-parse --git-dir)"; lock="$gd/realestate-deploy.lock"
  if (( APPLY == 1 )); then
    acquire_lock
    pass "không có deploy/restore khác đang chạy (đã giữ khóa $lock)"
    return 0
  fi
  if [[ ! -f "$lock" ]] || ! command -v flock >/dev/null 2>&1; then
    pass "khóa deploy/restore: chưa có tiến trình nào giữ (hoặc máy không có flock: bỏ qua)"
  elif ( flock -n 8 ) 8<"$lock" 2>/dev/null; then
    pass "không có deploy/restore khác đang chạy"
  else
    bad "một deploy/restore khác đang chạy (khóa $lock đang bị giữ)"
  fi
}

mongo_state() { inspect_field "$MONGO_CONTAINER" '{{.State.Status}}'; }

# Đường dẫn "hạ tầng" mà khôi phục code không nên âm thầm làm đổi (docker-compose, Dockerfile, nginx, docker/). Pathspec git (không glob theo thư mục:
# `*` khớp cả dấu `/`), nên khớp cả file lồng trong thư mục con.
readonly INFRA_PATHSPECS=('*docker-compose*.yml' '*Dockerfile' '*nginx.conf' 'docker/')

# Khôi phục code sẽ (a) làm đổi file hạ tầng so với HEAD hiện tại? (b) đè file CHƯA theo dõi (untracked, không bị .gitignore) mà commit đích có theo dõi
# (git reset --hard sẽ ghi đè chúng mất)? Cần commit đích CÓ trong repo: trả 2 (không làm gì) nếu chưa. Đặt EFFECTS_CHECKED=1 khi đã kiểm. Mỗi lỗi là `bad`.
check_target_commit_effects() {
  local commit="${MF[OLD_COMMIT]}" infra overlap n
  git cat-file -e "${commit}^{commit}" 2>/dev/null || return 2
  EFFECTS_CHECKED=1
  infra="$(git diff --stat "${commit}..HEAD" -- "${INFRA_PATHSPECS[@]}" 2>/dev/null || true)"
  if [[ -z "$infra" ]]; then
    pass "khôi phục code không làm đổi file hạ tầng (docker-compose*.yml, Dockerfile, nginx.conf, docker/) so với HEAD hiện tại"
  elif (( ALLOW_INFRA_CHANGE == 1 )); then
    warn "khôi phục code SẼ ĐỔI file hạ tầng (đã cho phép bằng --allow-infra-change):"
    printf '%s\n' "$infra" >&2
  else
    printf '%s\n' "$infra" >&2
    bad "khôi phục code ${commit:0:12} SẼ ĐỔI file hạ tầng so với HEAD hiện tại (liệt kê ở trên): compose/Dockerfile/nginx cũ có thể không chạy đúng với DB/stack hiện tại. Xem xét kỹ rồi thêm --allow-infra-change nếu CHẮC CHẮN"
  fi
  overlap="$(comm -12 <(git ls-files --others --exclude-standard 2>/dev/null | LC_ALL=C sort) <(git ls-tree -r --name-only "$commit" 2>/dev/null | LC_ALL=C sort) || true)"
  if [[ -z "$overlap" ]]; then
    pass "không có file chưa theo dõi (untracked) nào bị git reset --hard ghi đè"
  else
    n="$(printf '%s\n' "$overlap" | wc -l | tr -d ' ')"
    printf '%s\n' "$overlap" | head -n 10 >&2
    bad "$n file CHƯA theo dõi (untracked) trùng đường dẫn với file của commit ${commit:0:12} nên git reset --hard sẽ GHI ĐÈ chúng (liệt kê tối đa 10 ở trên). Di chuyển/đổi tên chúng ra ngoài repo rồi chạy lại"
  fi
  return 0
}

# Backup an toàn MỚI NHẤT (theo tên: TS tăng dần) kể cả khi rỗng/hỏng, để chốt chặn --skip-safety-db thấy và từ chối nó (không lặng lẽ bỏ qua file hỏng).
# Chỉ nhận đúng mẫu restore-safety-YYYYMMDD-HHMMSS.archive.gz (file lạ như restore-safety-x.archive.gz bị bỏ qua, không làm "mới nhất" sai).
latest_safety_file() {
  local f last="" b
  for f in "$BACKUP_DIR"/restore-safety-*.archive.gz; do
    [[ -e "$f" ]] || continue
    b="$(basename "$f")"
    [[ "$b" =~ ^restore-safety-[0-9]{8}-[0-9]{6}\.archive\.gz$ ]] && last="$f"
  done
  printf '%s' "$last"
}

# --skip-safety-db chỉ an toàn khi cả hai điều kiện đúng (mỗi điều kiện sai = [HỎNG], --apply dừng, chưa đổi gì):
#  (a) backup an toàn MỚI NHẤT còn nguyên: > 0 byte, gzip -t, mongorestore --dryRun thấy realestate.users (verify_backup_archive);
#  (b) DB hiện tại thật sự DỞ DANG: không có collection users nhưng có collection khác có dữ liệu (đúng điều kiện làm dump an toàn bị từ chối).
#      DB khỏe (có users) thì phải dump an toàn mới; DB trống thì không có gì để bỏ qua.
check_skip_safety_db() {
  local f present busy
  f="$(latest_safety_file)"
  if [[ -z "$f" ]]; then
    # DB trống (không users, không dữ liệu) thì restore tự bỏ qua dump an toàn vì không có gì để mất: nói rõ để khỏi hiểu lầm là thiếu file.
    if [[ "$(mongo_state)" == "running" ]]; then
      present="$(existing_collections "$MONGO_CONTAINER" users 2>/dev/null)" || present="?"
      busy="$(nonempty_collections "$MONGO_CONTAINER" 2>/dev/null)" || busy="?"
      if [[ -z "$present" && ( -z "$busy" || "$busy" == "system" ) ]]; then
        bad "--skip-safety-db không cần thiết: DB hiện tại chưa có dữ liệu nghiệp vụ (restore tự bỏ qua dump an toàn vì không có gì để mất) và cũng chưa có $BACKUP_DIR/restore-safety-*.archive.gz nào. Bỏ --skip-safety-db"
        return 0
      fi
    fi
    bad "--skip-safety-db nhưng chưa có $BACKUP_DIR/restore-safety-YYYYMMDD-HHMMSS.archive.gz nào (chưa từng có lần restore bị ngắt?): bỏ --skip-safety-db để tạo backup an toàn"
    return 0
  fi
  if [[ "$(mongo_state)" != "running" ]]; then
    bad "--skip-safety-db: container $MONGO_CONTAINER không chạy (trạng thái: $(mongo_state)) nên chưa kiểm được backup an toàn và tình trạng DB. Khởi động: docker compose --env-file $ENV_FILE up -d mongo"
    return 0
  fi
  if ! verify_backup_archive "$f" "$MONGO_CONTAINER"; then
    bad "--skip-safety-db: backup an toàn MỚI NHẤT '$f' rỗng/hỏng/không phải dump DB realestate (xem cảnh báo ở trên) nên không được dùng làm chỗ dựa; bỏ --skip-safety-db (nếu DB hiện tại dump được) hoặc xử lý file đó"
    return 0
  fi
  present="$(existing_collections "$MONGO_CONTAINER" users)" || { bad "--skip-safety-db: không hỏi được Mongo xem DB hiện tại có collection users không (mongosh lỗi hoặc quá ${OPS_EXEC_TIMEOUT}s)"; return 0; }
  if [[ -n "$present" ]]; then
    bad "--skip-safety-db bị TỪ CHỐI: DB hiện tại KHỎE (có collection users), nên phải dump an toàn lại để không mất dữ liệu hiện có. Bỏ --skip-safety-db"
    return 0
  fi
  busy="$(nonempty_collections "$MONGO_CONTAINER")" || { bad "--skip-safety-db: không hỏi được Mongo xem DB hiện tại có dữ liệu không"; return 0; }
  if [[ -z "$busy" || "$busy" == "system" ]]; then
    bad "--skip-safety-db bị TỪ CHỐI: DB hiện tại chưa có dữ liệu nghiệp vụ (không phải DB dở dang), restore tự bỏ qua dump an toàn mà không cần cờ này. Bỏ --skip-safety-db"
    return 0
  fi
  pass "--skip-safety-db: DB hiện tại dở dang (không có users, có dữ liệu: ${busy}) và đã có backup an toàn hợp lệ $f (sẽ KHÔNG dump lại DB hiện tại)"
}

# ── Các kiểm trước (dry-run và apply đều chạy; mỗi mục [ĐẠT]/[HỎNG], không đổi gì) ───────────────────────────────────────
run_prechecks() {
  log "Kiểm trước khi khôi phục (chưa đổi gì):"
  PRE_FAIL=0
  check_lock

  if (( CODE_ONLY == 0 )); then
    if [[ -z "$DB_ARCHIVE" ]]; then
      bad "manifest không có backup Mongo (MONGO_BACKUP_FILE rỗng: DB trống lúc deploy hoặc backup bị bỏ qua) -> không khôi phục DB được; chỉ dùng --code-only"
    elif [[ ! -s "$DB_ARCHIVE" ]]; then
      bad "backup Mongo '$DB_ARCHIVE' không tồn tại hoặc rỗng (0 byte)"
    elif ! gzip -t "$DB_ARCHIVE" 2>/dev/null; then
      bad "backup Mongo '$DB_ARCHIVE' không phải gzip hợp lệ (hỏng/cụt)"
    elif [[ "$(mongo_state)" != "running" ]]; then
      bad "container $MONGO_CONTAINER không chạy (trạng thái: $(mongo_state)) nên chưa kiểm được nội dung backup. Khởi động: docker compose --env-file $ENV_FILE up -d mongo"
    elif verify_backup_archive "$DB_ARCHIVE" "$MONGO_CONTAINER"; then
      pass "backup Mongo $DB_ARCHIVE: > 0 byte, gzip hợp lệ, mongorestore --dryRun thấy realestate.users"
    else
      bad "backup Mongo $DB_ARCHIVE không đạt kiểm nội dung (xem cảnh báo ở trên)"
    fi
  fi

  if (( DB_ONLY == 0 )); then
    if [[ ! -s "$BUNDLE_PATH" ]]; then
      bad "bundle code '$BUNDLE_PATH' không tồn tại hoặc rỗng"
    elif ! git bundle verify "$BUNDLE_PATH" >/dev/null 2>&1; then
      bad "bundle code '$BUNDLE_PATH' không qua 'git bundle verify' (hỏng, hoặc repo thiếu commit nền)"
    elif ! git bundle list-heads "$BUNDLE_PATH" 2>/dev/null | awk '{print $1}' | grep -qxF "${MF[OLD_COMMIT]}"; then
      bad "bundle KHÔNG chứa commit ${MF[OLD_COMMIT]:0:12} của manifest (manifest và bundle không khớp nhau)"
    else
      pass "bundle code $BUNDLE_PATH qua 'git bundle verify' và chứa commit ${MF[OLD_COMMIT]:0:12}"
    fi
    if [[ -n "${MF[BRANCH]:-}" ]] && ! git check-ref-format --branch "${MF[BRANCH]}" >/dev/null 2>&1; then
      bad "tên nhánh '${MF[BRANCH]}' không phải tên nhánh git hợp lệ"
    fi
    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
      git status --short --untracked-files=no >&2
      bad "working tree có thay đổi chưa commit (file đã theo dõi): git reset --hard sẽ xóa chúng. Lưu bản sửa tay ra NGOÀI repo (quyền 600, xem $DOC mục 5.0a) rồi git checkout -- <file>; KHÔNG git stash"
    else
      pass "working tree sạch (file đã theo dõi)"
    fi
    # Hạ tầng đổi / untracked bị đè (cần commit đích trong repo). Chưa có trong repo (đã bị gc): dry-run chỉ BÁO (không ghi gì); --apply kiểm lại
    # ngay sau khi nạp commit từ bundle, TRƯỚC mọi bước phá hủy.
    local eff_rc=0
    check_target_commit_effects || eff_rc=$?
    if (( eff_rc == 2 && APPLY == 0 )); then
      warn "commit ${MF[OLD_COMMIT]:0:12} chưa có trong repo (sẽ nạp từ bundle khi --apply): CHƯA kiểm được việc đổi file hạ tầng / đè file untracked; --apply sẽ kiểm lại trước khi đổi gì."
    fi
    if (( USE_IMAGE_TAG == 1 )); then
      if [[ -z "${MF[PREV_IMAGE_TAG]:-}" || -z "${MF[PREV_IMAGE_REPO]:-}" ]]; then
        bad "--use-image-tag: manifest không có image dự phòng (PREV_IMAGE_TAG rỗng, lần deploy đó chưa có container backend). Bỏ --use-image-tag để build lại từ code"
      elif ! [[ "${MF[PREV_IMAGE_REPO]}" =~ ^[a-z0-9][a-z0-9._-]*-backend$ && "${MF[PREV_IMAGE_TAG]}" == "${MF[PREV_IMAGE_REPO]}":pre-[0-9]* ]]; then
        bad "--use-image-tag: PREV_IMAGE_REPO/PREV_IMAGE_TAG trong manifest sai dạng"
      elif ! docker image inspect "${MF[PREV_IMAGE_TAG]}" >/dev/null 2>&1; then
        bad "--use-image-tag: image ${MF[PREV_IMAGE_TAG]} KHÔNG còn trên máy (đã bị docker image prune?). Bỏ --use-image-tag để build lại từ code đã khôi phục"
      else
        pass "image dự phòng ${MF[PREV_IMAGE_TAG]} còn trên máy"
      fi
    fi
    if [[ ! -e "$RUNTIME_ENV_FILE" || -d "$RUNTIME_ENV_FILE" ]]; then
      bad "./$RUNTIME_ENV_FILE không tồn tại hoặc là THƯ MỤC (backend bind-mount file này): tạo file rỗng 'touch $RUNTIME_ENV_FILE' (xóa thư mục trước nếu có)"
    fi
  fi

  # --skip-safety-db: chốt chặn chặt (xem check_skip_safety_db): backup an toàn mới nhất phải còn nguyên VÀ DB hiện tại phải thật sự dở dang.
  if (( SKIP_SAFETY_DB == 1 && CODE_ONLY == 0 )); then check_skip_safety_db; fi

  # Đĩa: backup an toàn + build lại cần chỗ. require_free_disk_gb tự die khi thiếu: chạy trong subshell để biến thành [HỎNG].
  if ( require_free_disk_gb "$DEPLOY_MIN_FREE_GB" ) >/dev/null 2>&1; then
    pass "đủ dung lượng đĩa (>= ${DEPLOY_MIN_FREE_GB} GB)"
  else
    bad "không đủ dung lượng đĩa (< ${DEPLOY_MIN_FREE_GB} GB ở repo hoặc thư mục dữ liệu Docker): chạy lại 'bash scripts/check-disk.sh' để xem chi tiết"
  fi
}

# Cảnh báo/ghi chú rút ra từ manifest (không phải lỗi kiểm).
print_warnings() {
  if one_way_risk && (( CODE_ONLY == 0 )); then
    red "CẢNH BÁO MỘT CHIỀU: lần deploy này đã tới điểm hậu-migrate (bước 90 = migration 011 MỘT CHIỀU có thể đã chạy). Khôi phục DB từ backup là đường quay lại DUY NHẤT;"
    red "MỌI dữ liệu phát sinh sau thời điểm backup Mongo (${MF[CREATED_AT]:-${MF[TS]}}) SẼ MẤT (đã có backup an toàn của trạng thái hiện tại ở bước 1, nhưng không tự gộp lại được)."
  fi
  if one_way_risk && (( CODE_ONLY == 1 )); then
    red "CẢNH BÁO: --code-only trên deploy đã qua bước 90 (011 một chiều): code cũ + DB MỚI có thể không tương thích (phone null/trùng, index đã đổi). Thường nên khôi phục cả DB, hoặc sửa tiến."
  fi
  case "${MF[DEPLOY_STATUS]}" in
    started) warn "Manifest ở trạng thái 'started': lần deploy đó bị ngắt giữa chừng (hoặc đang chạy) nên manifest chưa được chốt (commit mới/version mới có thể thiếu)." ;;
    failed)  warn "Lần deploy đó đã THẤT BẠI (DEPLOY_STATUS=failed): khôi phục sẽ đưa về đúng trạng thái trước khi deploy bắt đầu." ;;
    *) : ;;
  esac
  if [[ "${MF[STACK_TOUCHED]:-0}" == "0" ]] && (( DB_ONLY == 0 || CODE_ONLY == 0 )); then
    warn "Manifest ghi STACK_TOUCHED=0: lần deploy đó dừng TRƯỚC khi đụng stack/DB, nên DB thường chưa bị đổi; có thể chỉ cần --code-only (hoặc không cần khôi phục)."
  fi
  if [[ "${MF[TRACKED_DIRTY]:-0}" == "1" ]]; then
    warn "Lúc backup, working tree có sửa tay chưa commit (TRACKED_DIRTY=1): bundle/tag chỉ chứa commit, KHÔNG chứa các sửa tay đó."
  fi
  if (( CODE_ONLY == 0 )) && [[ "${MF[DB_VERSION_READ]:-0}" != "1" ]]; then
    warn "Manifest không có version DB trước deploy (DB_VERSION_READ=0): bước kiểm sau sẽ bỏ qua so khớp version DB."
  fi
}

print_plan() {
  local mode="DB + code"
  (( DB_ONLY == 1 )) && mode="chỉ DB"
  (( CODE_ONLY == 1 )) && mode="chỉ code + image"
  echo
  log "Manifest: $MANIFEST_PATH"
  log "  deploy ngày ${MF[CREATED_AT]:-${MF[TS]}} | nhánh '${MF[BRANCH]:-(detached)}' | commit TRƯỚC deploy ${MF[OLD_COMMIT]} | version app ${MF[APP_VERSION_OLD]:-?} | version DB ${MF[DB_VERSION_BEFORE]:-(không có)}"
  log "  chế độ khôi phục: $mode$( (( USE_IMAGE_TAG == 1 )) && printf ' | image dự phòng %s' "${MF[PREV_IMAGE_TAG]:-?}" || printf ' | build lại từ code' )"
  log "Kế hoạch (--apply --yes):"
  (( DB_ONLY == 1 )) || log "  1) chuẩn bị (CHƯA đổi gì): nạp commit đích từ bundle nếu repo đã mất nó, kiểm lại hạ tầng/untracked; lỗi ở đây = dừng, DB và backend nguyên vẹn"
  log "  2) dừng backend (giữ Mongo chạy) -> không còn ai ghi DB trong lúc backup"
  if (( CODE_ONLY == 1 )); then log "  3) tag git an toàn pre-restore-${RTS}"
  elif (( SKIP_SAFETY_DB == 1 )); then log "  3) --skip-safety-db: KHÔNG dump lại DB (dùng backup an toàn đã có từ lần trước)$( (( DB_ONLY == 1 )) || printf ' + tag git pre-restore-%s' "$RTS" )"
  else log "  3) backup AN TOÀN trạng thái hiện tại: ${BACKUP_DIR}/restore-safety-${RTS}.archive.gz$( (( DB_ONLY == 1 )) || printf ' + tag git pre-restore-%s' "$RTS" ). Lỗi ở bước 2-3: tự BẬT LẠI backend, dữ liệu chưa đổi"; fi
  (( CODE_ONLY == 1 )) || log "  4) DB: xóa DB realestate rồi mongorestore --drop --nsInclude 'realestate.*' từ ${MF[MONGO_BACKUP_FILE]:-?}"
  (( DB_ONLY == 1 )) || log "  5) code: git switch ${MF[BRANCH]:---detach} && git reset --hard ${MF[OLD_COMMIT]:0:12}"
  if (( DB_ONLY == 1 )); then log "  6) khởi động lại backend (image hiện có, không build)"
  elif (( USE_IMAGE_TAG == 1 )); then log "  6) gắn lại thẻ ${MF[PREV_IMAGE_TAG]:-?} -> ${MF[PREV_IMAGE_REPO]:-?}:latest rồi up --no-build backend"
  else log "  6) docker compose up -d --build (build lại từ code đã khôi phục)"; fi
  log "  7) chờ mongo healthy + backend liveness; 8) kiểm version DB + code khớp manifest"
}

# ── Bước chạy thật ───────────────────────────────────────────────────────────
# Cần mongo chạy. Lệnh dump y hệt deploy.sh: mật khẩu đọc từ env BÊN TRONG container, qua `--config <(...)`, không lên dòng lệnh.
safety_backup_db() {
  local present busy out part rc=0
  present="$(existing_collections "$MONGO_CONTAINER" users)" || die "Không hỏi được Mongo xem DB hiện tại có dữ liệu không (mongosh lỗi hoặc quá ${OPS_EXEC_TIMEOUT}s). Chưa đổi gì."
  if [[ -z "$present" ]]; then
    busy="$(nonempty_collections "$MONGO_CONTAINER")" || die "Không hỏi được Mongo xem DB hiện tại có dữ liệu không. Chưa đổi gì."
    if [[ -z "$busy" || "$busy" == "system" ]]; then
      warn "DB realestate hiện tại chưa có dữ liệu nghiệp vụ (không có users): bỏ qua backup an toàn bằng mongodump (không có gì để mất)."
      return 0
    fi
    die "DB realestate hiện tại không có collection users nhưng có dữ liệu (${busy}): không tạo được backup an toàn hợp lệ nên KHÔNG khôi phục (sẽ mất dữ liệu đó). Kiểm bằng mongosh và xử lý theo $DOC mục 6. Chưa đổi gì."
  fi
  [[ -d "$BACKUP_DIR" ]] || install -d -m 700 "$BACKUP_DIR"   # thư mục backup đã có (chứa manifest); không chmod lại thư mục sẵn có
  out="${BACKUP_DIR}/restore-safety-${RTS}.archive.gz"
  part="${out}.partial"
  [[ ! -e "$out" ]] || die "Đã có $out (chạy chồng cùng giây?). Không ghi đè backup: chạy lại sau."
  log "Backup an toàn trạng thái HIỆN TẠI: mongodump DB realestate -> $out ..."
  # shellcheck disable=SC2016  # biến phải được mở rộng BÊN TRONG container, nên dùng nháy đơn có chủ ý
  local dump_cmd='mongodump --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --db realestate --archive --gzip'
  ( umask 077; timeout "$DUMP_TIMEOUT" docker exec "$MONGO_CONTAINER" bash -c "$dump_cmd" > "$part" ) || rc=$?
  if (( rc != 0 )); then
    rm -f "$part"
    die "mongodump (backup an toàn) thất bại (mã $rc; 124 = quá ${DUMP_TIMEOUT}s). KHÔNG khôi phục khi không có backup an toàn. Chưa đổi gì."
  fi
  if ! verify_backup_archive "$part" "$MONGO_CONTAINER"; then
    rm -f "$part"
    die "Backup an toàn vừa tạo không đạt kiểm tra nội dung. KHÔNG khôi phục. Chưa đổi gì."
  fi
  mv "$part" "$out"
  SAFETY_FILE="$out"
  log "Backup an toàn OK: $out"
}

# Các backup an toàn (restore-safety-*.archive.gz, > 0 byte) đã có trong backups/ từ các lần restore trước; mỗi file một dòng, cũ -> mới.
list_safety_files() {
  local f
  for f in "$BACKUP_DIR"/restore-safety-*.archive.gz; do
    [[ -s "$f" ]] && printf '%s\n' "$f"
  done
  return 0
}

# --skip-safety-db: không dump lại; in rõ backup an toàn + tag pre-restore-* ĐÃ CÓ để người chạy biết bản nào giữ trạng thái trước restore.
report_existing_safety() {
  local f t
  warn "--skip-safety-db: KHÔNG dump lại DB hiện tại (DB có thể đang dở dang do restore trước bị ngắt). Bản giữ trạng thái trước restore là các backup an toàn đã có:"
  while IFS= read -r f; do log "  backup an toàn có sẵn: $f"; done < <(list_safety_files)
  while IFS= read -r t; do log "  tag git an toàn có sẵn: $t"; done < <(git tag -l 'pre-restore-*' 2>/dev/null)
}

# Nạp commit đích từ bundle NGAY ĐẦU --apply (CHƯA đổi gì: lỗi = dừng, DB và backend nguyên vẹn). Dry-run KHÔNG gọi (không ghi gì vào repo).
prepare_target_commit() {
  local commit="${MF[OLD_COMMIT]}"
  if ! git cat-file -e "${commit}^{commit}" 2>/dev/null; then
    log "Commit ${commit:0:12} không còn trong repo: nạp lại từ bundle $BUNDLE_PATH ..."
    git fetch --quiet "$BUNDLE_PATH" "${MF[CODE_BUNDLE_REF]}" || die "git fetch từ bundle thất bại. Chưa đổi gì (DB và backend nguyên vẹn)."
    git cat-file -e "${commit}^{commit}" 2>/dev/null || die "Đã fetch bundle nhưng vẫn không có commit ${commit:0:12}. Chưa đổi gì (DB và backend nguyên vẹn)."
  fi
}

safety_tag_code() {
  SAFETY_TAG="pre-restore-${RTS}"
  if git rev-parse -q --verify "refs/tags/$SAFETY_TAG" >/dev/null 2>&1; then die "Đã có tag $SAFETY_TAG. Không ghi đè: chạy lại sau."; fi
  git tag "$SAFETY_TAG" HEAD || die "Không tạo được tag an toàn $SAFETY_TAG tại HEAD hiện tại."
  log "Đã tạo tag cục bộ $SAFETY_TAG tại HEAD hiện tại ($(git rev-parse --short HEAD)); KHÔNG push tag này."
}

restore_db() {
  local rc=0
  log "Khôi phục DB: xóa DB realestate rồi nạp từ $DB_ARCHIVE ..."
  # Xóa hẳn DB trước (như staging restore-dump): --drop chỉ xóa collection CÓ trong dump, collection sinh thêm sau backup (migration mới) sẽ còn sót
  # và làm DB không còn giống đúng thời điểm backup. Chỉ đụng DB `realestate`, không đụng `admin` (user root). Xác thực TRONG script mongosh.
  timeout "$OPS_EXEC_TIMEOUT" docker exec -i "$MONGO_CONTAINER" mongosh --quiet --norc --file /dev/stdin <<'JS' || die "Không xóa được DB realestate trước khi khôi phục (mongosh lỗi hoặc quá ${OPS_EXEC_TIMEOUT}s). Xem hướng dẫn bên dưới."
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
db.getSiblingDB('realestate').dropDatabase();
print('DROPPED realestate');
JS
  # shellcheck disable=SC2016  # biến phải được mở rộng BÊN TRONG container, nên dùng nháy đơn có chủ ý
  local restore_cmd='mongorestore --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --drop --gzip --archive --nsInclude "realestate.*"'
  timeout "$RESTORE_TIMEOUT" docker exec -i "$MONGO_CONTAINER" bash -c "$restore_cmd" < "$DB_ARCHIVE" || rc=$?
  if (( rc != 0 )); then
    die "mongorestore thất bại (mã $rc; 124 = quá ${RESTORE_TIMEOUT}s). DB realestate có thể đang DỞ DANG: xem hướng dẫn bên dưới."
  fi
  log "Đã nạp DB từ backup."
}

restore_code() {
  local commit="${MF[OLD_COMMIT]}" branch="${MF[BRANCH]:-}" tip cur
  # Commit đã được nạp từ bundle ở prepare_target_commit (trước mọi bước phá hủy); ở đây chỉ chốt chặn phòng hờ.
  git cat-file -e "${commit}^{commit}" 2>/dev/null || die "Commit ${commit:0:12} không có trong repo (lẽ ra đã nạp từ bundle ở bước chuẩn bị)."
  if [[ -n "$branch" ]]; then
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      tip="$(git rev-parse "refs/heads/$branch")"
      cur="$(git symbolic-ref --short -q HEAD || true)"
      # reset --hard sẽ dời đầu nhánh về commit cũ; nếu nhánh đích không phải nhánh hiện tại thì đầu nhánh cũ chưa có thẻ an toàn: gắn thêm.
      if [[ "$tip" != "$commit" && "$branch" != "$cur" ]]; then
        git tag "pre-restore-${RTS}-branch-tip" "$tip" || die "Không tạo được tag pre-restore-${RTS}-branch-tip."
        log "Đầu nhánh '$branch' hiện tại (${tip:0:12}) được giữ bằng tag pre-restore-${RTS}-branch-tip."
      fi
      git switch "$branch" || die "git switch $branch thất bại."
    else
      log "Nhánh '$branch' không còn trong repo: tạo lại tại ${commit:0:12}."
      git switch -c "$branch" "$commit" || die "git switch -c $branch thất bại."
    fi
    git reset --hard "$commit" || die "git reset --hard ${commit:0:12} thất bại."
  else
    git switch --detach "$commit" || die "git switch --detach ${commit:0:12} thất bại."
  fi
  log "Code đã về nhánh '${branch:-(detached)}' tại $(git rev-parse --short HEAD)."
}

# Chờ mongo healthy / backend liveness dùng hàm chung (ops-common).
post_check() { # in số liệu; trả 1 nếu có chỗ không khớp
  local bad_n=0 want got commit_now ver_now
  log "Kiểm sau khôi phục:"
  if (( CODE_ONLY == 0 )); then
    if [[ "${MF[DB_VERSION_READ]:-0}" == "1" ]]; then
      want="${MF[DB_VERSION_BEFORE]:-}"
      if got="$(read_system_version "$MONGO_CONTAINER")"; then
        if [[ "$got" == "$want" ]]; then log "  [KHỚP] version DB (system.version): ${got:-(trống)} = manifest ${want:-(trống)}"
        else red "  [LỆCH] version DB (system.version): ${got:-(trống)} khác manifest ${want:-(trống)}"; bad_n=$(( bad_n + 1 )); fi
      else
        red "  [LỖI] không đọc được system.version để so khớp (manifest: ${want:-(trống)})"; bad_n=$(( bad_n + 1 ))
      fi
    else
      warn "  [BỎ QUA] version DB: manifest không có DB_VERSION_BEFORE (DB_VERSION_READ=0)."
    fi
  fi
  if (( DB_ONLY == 0 )); then
    commit_now="$(git rev-parse HEAD)"
    if [[ "$commit_now" == "${MF[OLD_COMMIT]}" ]]; then log "  [KHỚP] commit code: ${commit_now:0:12} = manifest"
    else red "  [LỆCH] commit code: ${commit_now:0:12} khác manifest ${MF[OLD_COMMIT]:0:12}"; bad_n=$(( bad_n + 1 )); fi
    if [[ -n "${MF[APP_VERSION_OLD]:-}" ]]; then
      ver_now="$(read_pkg_version || true)"
      if [[ "$ver_now" == "${MF[APP_VERSION_OLD]}" ]]; then log "  [KHỚP] version app (package.json): ${ver_now} = manifest"
      else red "  [LỆCH] version app (package.json): ${ver_now:-?} khác manifest ${MF[APP_VERSION_OLD]}"; bad_n=$(( bad_n + 1 )); fi
    fi
  fi
  (( bad_n == 0 ))
}

# Sau khi khôi phục CODE, nhánh local nằm LÙI so với upstream (commit lỗi vẫn ở upstream).
lag_warning_text() {
  printf '%s' "CẢNH BÁO: sau restore code nằm LÙI so với upstream. Lần 'bash deploy.sh' kế tiếp sẽ 'git pull --ff-only' kéo lại ĐÚNG commit lỗi vừa lùi khỏi. Dùng 'bash deploy.sh --no-pull' cho tới khi sửa xong ở upstream."
}

# Lỗi SAU KHI đã bắt đầu đổi trạng thái: in hướng dẫn, KHÔNG tự rollback tiếp.
print_guidance() {
  {
    echo
    echo "════════════ RESTORE DỪNG GIỮA CHỪNG — script KHÔNG tự rollback thêm ════════════"
    echo "Bước đang chạy: $STEP"
    [[ -z "$SAFETY_FILE" ]] || echo "Backup an toàn trạng thái TRƯỚC restore (DB): $SAFETY_FILE"
    [[ -z "$SAFETY_TAG" ]] || echo "Tag an toàn của code TRƯỚC restore: $SAFETY_TAG (đưa code về: git switch <nhánh> && git reset --hard $SAFETY_TAG)"
    echo "Manifest đang khôi phục: $MANIFEST_PATH"
    echo
    echo "1) Xem tình trạng:"
    echo "     docker compose --env-file $ENV_FILE ps -a"
    echo "     docker compose --env-file $ENV_FILE logs --tail 100 backend"
    echo "2) Sửa nguyên nhân rồi chạy lại cùng lệnh restore (idempotent: nạp lại từ cùng backup). Backend có thể đang DỪNG:"
    echo "     docker compose --env-file $ENV_FILE up -d --no-build --no-deps backend   # khi DB đã ổn và muốn bật lại"
    echo "3) Nếu DB đang DỞ DANG sau mongorestore bị ngắt/lỗi: chạy lại restore (xóa DB rồi nạp lại), hoặc nạp tay bằng $DOC mục 6"
    echo "   (luôn kèm --nsInclude 'realestate.*'). Không dùng 'docker compose down -v' (xóa vĩnh viễn dữ liệu)."
    echo "   LƯU Ý khi chạy lại: DB lúc này dở dang nên backup an toàn mới sẽ KHÔNG hợp lệ (thiếu users) và làm restore từ chối. Thêm --skip-safety-db"
    echo "   (vẫn cần --apply --yes): bỏ qua bước dump lại, dùng backup an toàn ĐÃ CÓ ở trên; lệnh đầy đủ:"
    echo "     bash scripts/restore.sh --manifest ${MANIFEST_PATH#"$ROOT_DIR"/} --apply --yes --skip-safety-db"
    echo "   (nếu lần chạy trước dùng thêm --db-only/--code-only/--use-image-tag thì giữ nguyên các cờ đó)"
    (( DB_ONLY == 1 )) || { echo; echo "4) $(lag_warning_text)"; }
  } >&2
}

# Mọi lối thoát (kể cả SIGTERM/SIGINT/SIGHUP, nhờ trap bên dưới đổi thành `exit 128+N`): on_exit nhận mã khác 0.
#  - SAFE_PHASE=1 (backend đã dừng nhưng DB/code CHƯA đổi): BẬT LẠI backend (best effort) rồi báo dữ liệu chưa đổi; KHÔNG in hướng dẫn "dừng giữa chừng".
#  - TOUCHED=1 (đã bắt đầu đổi DB/code): in hướng dẫn, KHÔNG tự rollback tiếp.
on_exit() {
  local code=$?
  trap - EXIT
  # Handler PHẢI chạy hết dù `set -e` đang bật và stderr/stdout đã chết (SSH rớt, SIGHUP): tắt -e, bỏ qua SIGPIPE, và mọi lệnh IN đều `|| true`.
  # Việc quan trọng (bật lại backend) chạy TRƯỚC các lệnh in và có output ra /dev/null: `>&2` vào fd đã đóng làm docker KHÔNG được chạy.
  set +e
  trap '' PIPE
  if (( code != 0 )); then
    if (( SAFE_PHASE == 1 )); then
      local restarted=0
      compose up -d --no-build --no-deps backend >/dev/null 2>&1 && restarted=1
      red "Dừng TRƯỚC khi đổi dữ liệu (mã $code): DB và code CHƯA bị đổi." || true
      if (( restarted == 1 )); then
        red "Đã bật lại backend (DB, code nguyên vẹn). Sửa nguyên nhân rồi chạy lại restore." || true
      else
        red "KHÔNG bật lại được backend tự động. Bật tay: docker compose --env-file $ENV_FILE up -d --no-build --no-deps backend (DB, code nguyên vẹn)." || true
      fi
    elif (( TOUCHED == 1 )); then
      print_guidance || true
    fi
  fi
  exit "$code"
}
trap on_exit EXIT
# Tín hiệu: `exit N` trong trap bảo đảm on_exit nhận mã 128+N (khác 0) nên SAFE_PHASE/TOUCHED được xử lý; không có trap, bash thoát ngay theo tín hiệu và
# on_exit vẫn chạy nhưng mã không được kiểm soát. (Lệnh con đang chạy dở thì bash chờ nó xong rồi mới xử lý tín hiệu.)
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

apply_restore() {
  # 1) Chuẩn bị: CHƯA đổi gì. Nạp commit đích từ bundle rồi kiểm lại (hạ tầng đổi / untracked bị đè) nếu lúc kiểm trước commit chưa có trong repo.
  if (( DB_ONLY == 0 )); then
    STEP="1) chuẩn bị: nạp commit đích từ bundle"
    prepare_target_commit
    if (( EFFECTS_CHECKED == 0 )); then
      PRE_FAIL=0
      check_target_commit_effects || true
      (( PRE_FAIL == 0 )) || die "$PRE_FAIL mục kiểm HỎNG sau khi nạp commit từ bundle: DỪNG, chưa đổi gì (DB và backend nguyên vẹn)."
    fi
  fi

  # 2-3) Dừng backend TRƯỚC khi backup an toàn: không còn ai ghi DB nên bản dump khớp đúng trạng thái trước restore. Từ đây đến hết bước 3 (SAFE_PHASE=1)
  # DB/code CHƯA đổi: lỗi hay tín hiệu thì on_exit BẬT LẠI backend rồi thoát (không in "dừng giữa chừng").
  SAFE_PHASE=1
  STEP="2) dừng backend"
  log "2) Dừng backend (giữ $MONGO_CONTAINER chạy) ..."
  compose stop backend

  STEP="3) backup an toàn trạng thái hiện tại"
  if (( CODE_ONLY == 0 )); then
    if (( SKIP_SAFETY_DB == 1 )); then report_existing_safety; else safety_backup_db; fi
  fi
  if (( DB_ONLY == 0 )); then safety_tag_code; fi
  SAFE_PHASE=0
  TOUCHED=1   # từ đây DB/code bắt đầu bị đổi: lỗi thì in hướng dẫn

  if (( CODE_ONLY == 0 )); then
    STEP="4) khôi phục DB"
    log "4) Khôi phục DB ..."
    restore_db
  fi

  if (( DB_ONLY == 0 )); then
    STEP="5) khôi phục code"
    log "5) Khôi phục code ..."
    restore_code
  fi

  STEP="6) khởi động lại backend/image"
  if (( DB_ONLY == 1 )); then
    log "6) Khởi động lại backend (image hiện có) ..."
    compose up -d --no-build --no-deps backend
  elif (( USE_IMAGE_TAG == 1 )); then
    log "6) Dùng image dự phòng ${MF[PREV_IMAGE_TAG]} (--no-build) ..."
    docker tag "${MF[PREV_IMAGE_TAG]}" "${MF[PREV_IMAGE_REPO]}:latest"
    compose up -d --no-build --no-deps backend
  else
    # Commit ngắn ghi vào dist/version.json của image (build arg GIT_COMMIT), giống deploy.sh.
    export GIT_COMMIT
    GIT_COMMIT="$(git rev-parse --short HEAD)"
    log "6) docker compose up -d --build (GIT_COMMIT=$GIT_COMMIT) ..."
    compose up -d --build
  fi

  STEP="7) chờ mongo/backend sống"
  wait_mongo_healthy
  wait_backend_liveness

  STEP="8) kiểm sau khôi phục"
  echo
  if post_check; then
    log "KHÔI PHỤC XONG: DB + code khớp manifest."
  else
    TOUCHED=0   # đã chạy hết các bước; chỉ báo lệch (không in 'dừng giữa chừng')
    die "Khôi phục đã chạy hết nhưng có chỗ KHÔNG khớp manifest (xem [LỆCH]/[LỖI] ở trên). Kiểm tra thủ công trước khi cho dùng."
  fi
  [[ -z "$SAFETY_FILE" ]] || log "Backup an toàn (trạng thái trước restore): $SAFETY_FILE"
  [[ -z "$SAFETY_TAG" ]]  || log "Tag an toàn của code trước restore: $SAFETY_TAG"
  if (( DB_ONLY == 0 )); then red "$(lag_warning_text)"; fi
  log "Đưa lại bản trước restore nếu cần: DB từ $SAFETY_FILE (tài liệu mục 6, --nsInclude 'realestate.*'); code: git switch <nhánh> && git reset --hard ${SAFETY_TAG:-<tag>}."
  log "Nhắc: bản code cũ có thể không có scripts/restore.sh (hoặc có bản cũ hơn). Khi cần chạy lại: (a) đưa code về bản mới (git reset --hard $( [[ -n "$SAFETY_TAG" ]] && echo "$SAFETY_TAG" || echo '<commit mới>')) rồi chạy scripts/restore.sh; hoặc (b) chạy từ BẢN SAO ngoài repo đã chép từ trước: RESTORE_REPO_DIR=$ROOT_DIR bash <bản-sao>/scripts/restore.sh ... (bản sao gồm restore.sh + thư mục lib/; xem $DOC mục 6.1)."
}

# ── Chạy ─────────────────────────────────────────────────────────────────────
main() {
  local arg
  while (( $# > 0 )); do
    arg="$1"
    case "$arg" in
      --list) ACTION="list" ;;
      --latest) ACTION="latest" ;;
      --manifest)
        shift
        [[ $# -gt 0 && "$1" != -* ]] || { trap - EXIT; echo "[restore] --manifest cần một đường dẫn file." >&2; exit 2; }
        ACTION="manifest"; MANIFEST_ARG="$1" ;;
      --manifest=*) ACTION="manifest"; MANIFEST_ARG="${arg#--manifest=}" ;;
      --apply) APPLY=1 ;;
      --yes) YES=1 ;;
      --db-only) DB_ONLY=1 ;;
      --code-only) CODE_ONLY=1 ;;
      --use-image-tag) USE_IMAGE_TAG=1 ;;
      --skip-safety-db) SKIP_SAFETY_DB=1 ;;
      --allow-infra-change) ALLOW_INFRA_CHANGE=1 ;;
      -h|--help) trap - EXIT; usage; exit 0 ;;
      *) trap - EXIT; printf '[restore] Tham số không hợp lệ: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done
  local bad_usage=""
  [[ -n "$ACTION" ]] || bad_usage="Thiếu một trong --list | --latest | --manifest <file>."
  if (( DB_ONLY == 1 && CODE_ONLY == 1 )); then bad_usage="--db-only và --code-only loại trừ nhau."; fi
  if (( USE_IMAGE_TAG == 1 && DB_ONLY == 1 )); then bad_usage="--use-image-tag chỉ dùng khi khôi phục code (không đi với --db-only)."; fi
  if (( SKIP_SAFETY_DB == 1 && CODE_ONLY == 1 )); then bad_usage="--skip-safety-db chỉ liên quan backup DB an toàn, không đi với --code-only."; fi
  if (( ALLOW_INFRA_CHANGE == 1 && DB_ONLY == 1 )); then bad_usage="--allow-infra-change chỉ liên quan khôi phục code, không đi với --db-only."; fi
  if [[ "$ACTION" == "list" ]] && (( APPLY == 1 || DB_ONLY == 1 || CODE_ONLY == 1 || USE_IMAGE_TAG == 1 || SKIP_SAFETY_DB == 1 || ALLOW_INFRA_CHANGE == 1 )); then
    bad_usage="--list chỉ để liệt kê, không đi kèm --apply/--db-only/--code-only/--use-image-tag/--skip-safety-db/--allow-infra-change."
  fi
  if [[ -n "$bad_usage" ]]; then trap - EXIT; printf '[restore] %s\n\n' "$bad_usage" >&2; usage >&2; exit 2; fi
  # Chạy thật BẮT BUỘC --apply kèm --yes (cờ tường minh, không nhận biến môi trường). --apply thiếu --yes: từ chối TRƯỚC mọi lệnh Docker/git.
  if (( APPLY == 1 && YES == 0 )); then
    trap - EXIT
    echo "[restore] --apply XÓA DB realestate và ĐẶT LẠI code về bản trước deploy: bắt buộc thêm --yes (không có biến môi trường thay thế). Chưa đổi gì." >&2
    exit 2
  fi
  if (( YES == 1 && APPLY == 0 )); then warn "--yes bị bỏ qua vì không có --apply (đang là dry-run)."; fi

  # Phân giải đường dẫn manifest TRƯỚC khi đổi thư mục (người dùng có thể đưa đường dẫn tương đối theo cwd).
  local given=""
  [[ "$ACTION" != "manifest" ]] || { given="$(readlink -f -- "$MANIFEST_ARG" 2>/dev/null || true)"; [[ -n "$given" ]] || die "Không resolve được đường dẫn manifest '$MANIFEST_ARG'."; }

  [[ "$MONGO_TIMEOUT" =~ ^[0-9]+$ && "$HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || die "MONGO_TIMEOUT/HEALTH_TIMEOUT phải là số nguyên (giây)."
  [[ "$DUMP_TIMEOUT" =~ ^[0-9]+$ && "$RESTORE_TIMEOUT" =~ ^[0-9]+$ && "$OPS_EXEC_TIMEOUT" =~ ^[0-9]+$ ]] || die "DUMP_TIMEOUT/RESTORE_TIMEOUT/OPS_EXEC_TIMEOUT phải là số nguyên (giây)."

  cd "$ROOT_DIR"
  [[ -f docker-compose.yml ]] || die "Không thấy docker-compose.yml: chạy script từ repo (scripts/restore.sh nằm trong repo)."

  if [[ "$ACTION" == "list" ]]; then list_manifests; return 0; fi

  if [[ "$ACTION" == "latest" ]]; then given="$(latest_manifest)"; log "--latest: dùng $(strip_ctl "$(basename "$given")")"; fi
  MANIFEST_PATH="$(resolve_in_backup_dir "$given" "Manifest")"
  [[ "$(basename "$MANIFEST_PATH")" == deploy-pre-*.manifest ]] || die "Tên manifest phải dạng deploy-pre-<TS>.manifest (nhận '$(basename "$MANIFEST_PATH")')."

  check_prereqs
  read_manifest "$MANIFEST_PATH"
  print_plan
  print_warnings
  echo
  run_prechecks

  if (( PRE_FAIL > 0 )); then
    echo
    if (( APPLY == 1 )); then
      die "$PRE_FAIL mục kiểm HỎNG: DỪNG, chưa đổi gì. Sửa rồi chạy lại."
    fi
    warn "DRY-RUN: $PRE_FAIL mục kiểm HỎNG: chưa thể khôi phục. Chưa đổi gì."
    return 1
  fi

  if (( APPLY == 0 )); then
    echo
    log "DRY-RUN: mọi kiểm ĐẠT, CHƯA đổi gì. Chạy thật (nhớ đọc kỹ cảnh báo ở trên):"
    log "  bash scripts/restore.sh --manifest ${MANIFEST_PATH#"$ROOT_DIR"/}$( (( DB_ONLY == 1 )) && printf ' --db-only'; (( CODE_ONLY == 1 )) && printf ' --code-only'; (( USE_IMAGE_TAG == 1 )) && printf ' --use-image-tag'; (( SKIP_SAFETY_DB == 1 )) && printf ' --skip-safety-db'; (( ALLOW_INFRA_CHANGE == 1 )) && printf ' --allow-infra-change' ) --apply --yes"
    return 0
  fi

  echo
  apply_restore
}

# Bọc toàn bộ trong main + `exit`: `git reset --hard` có thể thay/xóa chính file này giữa chừng (bản code cũ có thể không có restore.sh), nên bash
# không được đọc tiếp phần lệnh lạ sau main.
main "$@"
exit 0
