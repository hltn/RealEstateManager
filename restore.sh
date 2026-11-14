#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore.sh — khôi phục DB Mongo + IMAGE (backend, frontend) về phiên bản TRƯỚC một lần deploy (dùng backup do deploy.sh/backup.sh tạo).
#
# Chạy ở máy chủ (Ubuntu 24.04), trong thư mục deploy (nơi có docker-compose.yml và .env):   bash restore.sh <chế-độ> [tùy chọn]
# (Dùng `bash restore.sh`, không phụ thuộc bit thực thi.) KHÔNG cần git, KHÔNG build. Tài liệu: docs/01_Infrastructure/06_Production_Deploy.md (mục 6 và 11).
#
# Mô hình lùi bản (FR-21): deploy.sh gắn thẻ `<tên image>:pre-<TS>` cho image đang chạy TRƯỚC khi promote bản mới thành `<tên image>:current`. Restore =
# khôi phục DB từ backup rồi gắn lại `<tên image>:pre-<TS>` thành `<tên image>:current` (backend + frontend) và `docker compose up -d --no-build`.
#
# Chọn bản backup (đúng MỘT trong):
#   --list              liệt kê các manifest trong backups/ (chỉ đọc, không cần Docker)
#   --latest            dùng manifest mới nhất (deploy-pre-<TS>.manifest, TS lớn nhất) CÓ backup Mongo; manifest không có MONGO_BACKUP_FILE bị bỏ qua (có cảnh báo).
#                       Deploy bị chạy lại nhiều lần: xem tài liệu mục 6.1 để chọn đúng manifest (--list rồi --manifest).
#   --manifest <file>   dùng manifest cụ thể (phải nằm trong thư mục backups)
# Tùy chọn:
#   --apply --yes       CHẠY THẬT. Mặc định là DRY-RUN: chỉ kiểm tra + in kế hoạch, KHÔNG đổi gì. `--yes` là cờ tường minh duy nhất
#                       (KHÔNG có biến môi trường thay thế, giống `restore-dump` của ops/staging.sh); thiếu --yes thì từ chối, không đổi gì.
#   --db-only           chỉ khôi phục DB (không đổi thẻ image): dùng khi manifest không có image dự phòng, hoặc chỉ cần dữ liệu cũ với image hiện tại
#   --skip-safety-db    (cùng --apply --yes) KHÔNG dump lại DB hiện tại: dùng khi chạy lại sau lần restore bị ngắt giữa mongorestore (DB dở dang không
#                       dump được). Chốt chặn: backup an toàn MỚI NHẤT phải còn nguyên (> 0 byte, gzip, mongorestore --dryRun thấy users) VÀ DB hiện tại phải thật
#                       sự dở dang (không có users nhưng có dữ liệu khác); DB khỏe hoặc trống thì TỪ CHỐI. In rõ backup/thẻ an toàn đã có.
#   -h, --help
# Cờ khôi phục code bằng git của bản cũ đã BỎ ở v1.0.6: tham số nào không liệt kê ở trên đều bị từ chối (mã 2); thẻ image pre-<TS> thành `current` là hành vi mặc định.
#
# Manifest do deploy.sh (trước khi promote bản mới) hoặc backup.sh tạo, MANIFEST_VERSION=2. Manifest bản 1 (gói code git, trước v1.0.6) bị TỪ CHỐI kèm hướng dẫn.
#
# Kiểm TRƯỚC khi đổi bất cứ gì (dry-run cũng chạy; hỏng thì --apply dừng, chưa đổi gì): manifest hợp lệ; backup Mongo > 0 byte, gzip -t,
# `mongorestore --dryRun` thấy realestate.users (verify_backup_archive); (trừ --db-only) hai image `pre-<TS>` còn trên máy; không có deploy/backup/restore khác
# đang chạy (cùng khóa <thư mục deploy>/.deploy.lock với deploy.sh); đủ đĩa.
#
# --apply làm lần lượt:
#   1) dừng backend (Mongo giữ chạy) — dừng TRƯỚC backup để không còn ai ghi DB trong lúc dump
#   2) backup AN TOÀN trạng thái HIỆN TẠI: mongodump backups/restore-safety-<TS>.archive.gz + (trừ --db-only) gắn thẻ <tên image>:pre-restore-<TS> cho image
#      đang chạy. Lỗi (hay bị ngắt) ở bước 1-2: dữ liệu chưa đổi nên script tự BẬT LẠI backend rồi thoát, không in hướng dẫn "dừng giữa chừng"
#   3) DB: xóa DB realestate rồi `mongorestore --archive --gzip --drop --nsInclude 'realestate.*'` (mật khẩu root chỉ qua pipe/env TRONG container)
#   4) image: `docker tag <tên>:pre-<TS> <tên>:current` cho backend và frontend (bỏ qua khi --db-only)
#   5) `docker compose up -d --no-build --no-deps backend frontend` (--db-only: chỉ backend)
#   6) chờ mongo healthy + backend liveness
#   7) kiểm sau: `system.version` của DB khớp manifest; image đang chạy của backend/frontend đúng là bản pre-<TS>; in số liệu
# Lỗi từ bước 3 trở đi (hoặc SIGTERM/SIGINT/SIGHUP): IN hướng dẫn, KHÔNG tự rollback tiếp, thoát mã khác 0 (143/130/129 khi bị tín hiệu).
#
# Chạy từ BẢN SAO ngoài thư mục deploy (khi gói phát hành mới chép đè restore.sh, hoặc muốn giữ một bản restore.sh cố định): chép restore.sh + thư mục ops/lib/ ra chỗ khác
# (giữ cấu trúc <bản-sao>/restore.sh và <bản-sao>/ops/lib/) rồi đặt RESTORE_REPO_DIR=<thư mục deploy>. Thư viện lấy từ ops/lib/ cạnh script, thư mục deploy
# lấy từ RESTORE_REPO_DIR (mặc định: thư mục chứa restore.sh).
#
# CẢNH BÁO MỘT CHIỀU: nếu deploy đã qua điểm hậu-migrate (manifest POST_UP_REACHED=1: bước 90 = migration 011 một chiều có thể đã chạy) thì khôi phục DB
# là đường quay lại DUY NHẤT, và MỌI dữ liệu phát sinh sau thời điểm backup Mongo sẽ MẤT. Script in cảnh báo ĐỎ (và vẫn chỉ chạy thật khi có --yes).
#
# Sau khi lùi bản: release.env trong thư mục deploy vẫn là bản MỚI. `bash deploy.sh` kế tiếp sẽ deploy lại đúng bản đó; chỉ chạy khi đã sửa xong
# (hoặc cài lại gói bản cũ bằng ops/install-release.sh).
#
# Mã thoát: 0 ok | 1 lỗi/kiểm hỏng | 2 sai cách dùng (thiếu --yes cũng là 2).
#
# Staging: cùng hợp đồng biến với deploy.sh (DEPLOY_ENV_FILE, DEPLOY_RUNTIME_ENV_FILE, DEPLOY_LOGS_DIR, DEPLOY_BACKUP_DIR, NINE_ROUTER_CONTAINER, MONGO_CONTAINER,
# BACKEND_CONTAINER, FRONTEND_CONTAINER; hợp lệ chỉ khi COMPOSE_PROJECT_NAME=realestate-staging và COMPOSE_FILE có docker-compose.staging.yml). Production KHÔNG đặt các biến này.
# Biến tùy chọn: MONGO_TIMEOUT, HEALTH_TIMEOUT, HEALTH_URL, DEPLOY_MIN_FREE_GB, DUMP_TIMEOUT (backup an toàn), RESTORE_TIMEOUT (mongorestore, mặc định 1800 giây),
# OPS_EXEC_TIMEOUT.
#
# Bí mật: script KHÔNG chứa bí mật; mật khẩu root Mongo chỉ đọc từ biến môi trường BÊN TRONG container (như deploy.sh), không nằm trên dòng lệnh/log.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="restore"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[restore] LỖI: không resolve được đường dẫn thật của restore.sh (cần readlink -f)." >&2; exit 1; }
# Thư viện nằm cạnh script (ops/lib), KHÔNG phụ thuộc thư mục deploy: nhờ vậy chạy được từ BẢN SAO ngoài thư mục deploy (xem RESTORE_REPO_DIR). Thư mục deploy:
# RESTORE_REPO_DIR nếu đặt, mặc định là thư mục chứa restore.sh.
LIB_DIR="$(cd "$(dirname "$_self")/ops/lib" 2>/dev/null && pwd)" || { echo "[restore] LỖI: không thấy thư mục ops/lib/ cạnh restore.sh (cần ops/lib/ops-common.sh)." >&2; exit 1; }
# shellcheck source=ops/lib/ops-common.sh
source "$LIB_DIR/ops-common.sh"
if [[ -n "${RESTORE_REPO_DIR:-}" ]]; then
  ROOT_DIR="$(cd "$RESTORE_REPO_DIR" 2>/dev/null && pwd)" || die "RESTORE_REPO_DIR='$RESTORE_REPO_DIR' không phải thư mục."
else
  ROOT_DIR="$(cd "$(dirname "$_self")" && pwd)"
fi

# Hợp đồng biến giống deploy.sh (staging dùng đường dẫn tương đối riêng; production giữ mặc định). File env mặc định là `.env` (một file duy nhất).
readonly ENV_FILE="${DEPLOY_ENV_FILE:-.env}"
readonly RUNTIME_ENV_FILE="${DEPLOY_RUNTIME_ENV_FILE:-.env}"   # chỉ để check_staging_vars (ops-common); restore.sh không còn đọc file này riêng
readonly LOGS_DIR="${DEPLOY_LOGS_DIR:-logs}"
readonly BACKUP_DIR="${DEPLOY_BACKUP_DIR:-backups}"
readonly NINE_ROUTER_CONTAINER="${NINE_ROUTER_CONTAINER-realestate_9router}"
readonly MONGO_CONTAINER="${MONGO_CONTAINER:-realestate_mongo}"
readonly BACKEND_CONTAINER="${BACKEND_CONTAINER:-realestate_backend}"
readonly FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-realestate_frontend}"
readonly DOC="docs/01_Infrastructure/06_Production_Deploy.md"
OPS_DEFAULT_ENV_FILE=".env"
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
SKIP_SAFETY_DB=0     # --skip-safety-db: không dump lại DB hiện tại (chạy lại sau khi mongorestore bị ngắt: DB đang dở dang)
TOUCHED=0            # =1 từ lúc bắt đầu đổi dữ liệu/image (sau backup an toàn): lỗi thì in hướng dẫn
SAFE_PHASE=0         # =1 khi backend đã dừng nhưng DB/image CHƯA bị đổi (dừng backend -> backup an toàn -> thẻ an toàn): lỗi thì BẬT LẠI backend
STEP="chuẩn bị"
SAFETY_FILE=""
SAFETY_TAGS=()       # các thẻ <tên image>:pre-restore-<RTS> đã gắn (image đang chạy TRƯỚC restore)
MANIFEST_PATH=""     # đường dẫn tuyệt đối của manifest đang dùng
DB_ARCHIVE=""        # đường dẫn tuyệt đối đã resolve của backup Mongo
PRE_FAIL=0
declare -A MF=()

# Khóa manifest được chấp nhận (whitelist; khóa lạ bị bỏ qua, KHÔNG `source` manifest).
readonly MANIFEST_KEYS="MANIFEST_VERSION BACKUP_KIND TS CREATED_AT HOST COMPOSE_PROJECT RELEASE_VERSION RELEASE_COMMIT CD_RUN_ID BACKEND_IMAGE_NAME BACKEND_IMAGE_TAG FRONTEND_IMAGE_NAME FRONTEND_IMAGE_TAG PRE_TAG BACKEND_PRE_IMAGE FRONTEND_PRE_IMAGE DB_VERSION_BEFORE DB_VERSION_READ MONGO_BACKUP_FILE ENV_BACKUP_FILE MONGO_CONTAINER BACKEND_CONTAINER FRONTEND_CONTAINER STACK_TOUCHED POST_UP_REACHED DEPLOY_STATUS FINISHED_AT"

usage() {
  cat <<'EOF'
Cách dùng: bash restore.sh (--list | --latest | --manifest <file>) [--apply --yes] [--db-only] [--skip-safety-db] [--help]

Khôi phục DB Mongo + image (backend, frontend) về phiên bản TRƯỚC một lần deploy, theo manifest/backup do deploy.sh hoặc backup.sh tạo trong backups/.

  --list              Liệt kê manifest trong backups/ (chỉ đọc).
  --latest            Dùng manifest mới nhất CÓ backup Mongo (bản không có bị bỏ qua).
  --manifest <file>   Dùng manifest cụ thể (file trong thư mục backups).
  --apply --yes       CHẠY THẬT (mặc định chỉ dry-run: kiểm + in kế hoạch, không đổi gì). Bắt buộc có CẢ HAI; không có biến môi trường thay --yes.
  --db-only           Chỉ khôi phục DB (không đổi thẻ image).
  --skip-safety-db    Không dump lại DB hiện tại (chạy lại sau lần restore bị ngắt giữa mongorestore); chỉ nhận khi backup an toàn mới nhất còn nguyên và DB hiện tại dở dang (không users, có dữ liệu khác).
  -h, --help          Hiện trợ giúp này.
Đã bỏ ở v1.0.6: các cờ khôi phục code/compose bằng git của bản cũ (tham số không liệt kê ở trên bị từ chối, mã 2); đặt image pre-<TS> thành current nay là mặc định.

Khi chạy thật: (1) dừng backend -> (2) backup an toàn trạng thái hiện tại (mongodump restore-safety-<TS> + thẻ image <tên>:pre-restore-<TS>; lỗi ở bước 1-2 thì tự bật lại
backend) -> (3) khôi phục DB (xóa DB realestate rồi mongorestore --drop --nsInclude 'realestate.*') -> (4) gắn thẻ <tên>:pre-<TS> thành <tên>:current (backend + frontend)
-> (5) up -d --no-build -> (6) chờ mongo healthy + backend liveness -> (7) kiểm DB version + image đang chạy khớp manifest.
Chạy từ bản sao ngoài thư mục deploy: RESTORE_REPO_DIR=<thư mục deploy> bash <bản-sao>/restore.sh ... (cần kèm thư mục ops/lib/).
Lỗi từ bước 3 (hoặc bị tín hiệu): in hướng dẫn, KHÔNG tự rollback tiếp. Deploy đã qua bước 90 (migration 011 một chiều): khôi phục DB là đường quay lại DUY NHẤT và mất dữ liệu
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

# Đường dẫn trong manifest là tương đối thư mục deploy (vd backups/xxx) hoặc tuyệt đối; tương đối thì tính từ thư mục deploy.
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
    # Giá trị manifest được in ra màn hình (--list, kế hoạch) và có khóa dùng cho lệnh docker: ký tự điều khiển (ESC, ...) chỉ có thể là manifest bị
    # sửa/giả mạo (deploy.sh/backup.sh không bao giờ ghi) nên TỪ CHỐI, không in lại giá trị (tránh chèn chuỗi điều khiển terminal vào đầu ra).
    [[ ! "$val" =~ [[:cntrl:]] ]] || die "Manifest '$(strip_ctl "$f")' có ký tự điều khiển trong giá trị của khóa $key: từ chối (manifest bị sửa tay/hỏng)."
    n=$(( n + 1 ))
    case " $MANIFEST_KEYS " in *" $key "*) MF[$key]="$val" ;; *) : ;; esac
  done < "$f"
  (( n > 0 )) || die "Manifest '$f' không có dòng KEY=VALUE nào."
  validate_manifest "$f"
}

# Tên image hợp lệ (cùng dạng deploy.sh kiểm ở release.env); chặn '..'.
valid_image_name() { [[ "${1:-}" =~ ^[a-z0-9][a-z0-9._/-]*$ && "$1" != *..* ]]; }

validate_manifest() { # <file>
  local f="$1" k role name pre
  # Phiên bản kiểm TRƯỚC các khóa khác: manifest bản 1 (trước v1.0.6) không có PRE_TAG nên phải báo đúng nguyên nhân thay vì "thiếu khóa".
  [[ -n "${MF[MANIFEST_VERSION]:-}" ]] || die "Manifest '$f' thiếu khóa bắt buộc MANIFEST_VERSION."
  if [[ "${MF[MANIFEST_VERSION]}" == "1" ]]; then
    die "Manifest '$f' là bản 1 (backup/deploy trước v1.0.6: dùng gói code git + tag git, không có image pre-<TS>). restore.sh này chỉ hiểu bản 2 (image) nên KHÔNG khôi phục được từ nó. Khôi phục DB bằng tay từ file backup Mongo ghi trong manifest (mongorestore --nsInclude 'realestate.*', xem $DOC mục 6.2), hoặc dùng restore.sh của bản v1.0.5 (git) cho manifest này."
  fi
  [[ "${MF[MANIFEST_VERSION]}" == "2" ]] || die "Manifest '$f' có MANIFEST_VERSION=${MF[MANIFEST_VERSION]} (script này chỉ hiểu bản 2): dùng restore.sh khớp phiên bản deploy.sh đã tạo nó."
  for k in TS PRE_TAG DEPLOY_STATUS; do
    [[ -n "${MF[$k]:-}" ]] || die "Manifest '$f' thiếu khóa bắt buộc $k."
  done
  [[ "${MF[TS]}" =~ ^[0-9]{8}-[0-9]{6}$ ]] || die "Manifest '$f': TS không đúng dạng YYYYMMDD-HHMMSS."
  [[ "${MF[PRE_TAG]}" == "pre-${MF[TS]}" ]] || die "Manifest '$f': PRE_TAG phải đúng dạng pre-<TS> (pre-${MF[TS]})."
  [[ "${MF[DEPLOY_STATUS]}" =~ ^(started|succeeded|failed)$ ]] || die "Manifest '$f': DEPLOY_STATUS phải là started|succeeded|failed."
  [[ "${MF[DB_VERSION_BEFORE]:-}" =~ ^[0-9A-Za-z.+-]*$ ]] || die "Manifest '$f': DB_VERSION_BEFORE có ký tự lạ."
  [[ "${MF[DB_VERSION_READ]:-0}" =~ ^[01]$ ]] || die "Manifest '$f': DB_VERSION_READ phải là 0 hoặc 1."
  [[ "${MF[POST_UP_REACHED]:-0}" =~ ^[01]$ ]] || die "Manifest '$f': POST_UP_REACHED phải là 0 hoặc 1."
  [[ "${MF[STACK_TOUCHED]:-0}" =~ ^[01]$ ]] || die "Manifest '$f': STACK_TOUCHED phải là 0 hoặc 1."
  [[ "${MF[RELEASE_VERSION]:-}" =~ ^[0-9A-Za-z.+-]*$ ]] || die "Manifest '$f': RELEASE_VERSION có ký tự lạ."
  [[ "${MF[RELEASE_COMMIT]:-}" =~ ^[0-9a-f]{0,40}$ ]] || die "Manifest '$f': RELEASE_COMMIT không phải SHA thường (tối đa 40 ký tự hex)."
  [[ "${MF[CD_RUN_ID]:-}" =~ ^[A-Za-z0-9._-]{0,64}$ ]] || die "Manifest '$f': CD_RUN_ID sai dạng."
  # Image dự phòng: rỗng (chưa có container lúc backup) hoặc đúng <tên image>:<PRE_TAG>; tên image chặt như release.env (chặn manifest bị sửa trỏ image lạ).
  for role in BACKEND FRONTEND; do
    name="${MF[${role}_IMAGE_NAME]:-}"; pre="${MF[${role}_PRE_IMAGE]:-}"
    [[ -z "$pre" ]] && continue
    valid_image_name "$name" || die "Manifest '$f': ${role}_IMAGE_NAME '$name' sai dạng (cần khi có ${role}_PRE_IMAGE)."
    [[ "$pre" == "${name}:${MF[PRE_TAG]}" ]] || die "Manifest '$f': ${role}_PRE_IMAGE phải là ${name}:${MF[PRE_TAG]} (nhận '$(strip_ctl "$pre")')."
  done
  if [[ -n "${MF[MONGO_BACKUP_FILE]:-}" ]]; then
    DB_ARCHIVE="$(resolve_in_backup_dir "$(manifest_path_abs "${MF[MONGO_BACKUP_FILE]}")" "MONGO_BACKUP_FILE")"
  else
    DB_ARCHIVE=""
  fi
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
    log "Chưa có manifest nào trong $BACKUP_DIR/ (deploy.sh/backup.sh tạo manifest ở mỗi lần deploy/backup thật)."
    return 0
  fi
  log "Các bản backup trước deploy trong $BACKUP_DIR/ (cũ -> mới, mới nhất ở cuối):"
  for f in "${files[@]}"; do
    n=$(( n + 1 ))
    ( list_one "$f" "$n" ) || printf '  %s) %s  [MANIFEST HỎNG: không đọc/kiểm được, xem lỗi ở trên]\n' "$n" "$(strip_ctl "$(basename "$f")")"
  done
  log "Xem kế hoạch (dry-run):  bash restore.sh --manifest $BACKUP_DIR/<tên manifest>   |   mới nhất: --latest"
}
list_one() { # <file> <số thứ tự> (chạy trong subshell)
  local f="$1" i="$2" db="THIẾU" dbn="" img
  read_manifest "$f"
  if [[ -z "$DB_ARCHIVE" ]]; then
    db="KHÔNG CÓ (DB trống lúc deploy hoặc backup bị bỏ qua; --latest sẽ bỏ qua bản này, restore.sh không dùng được)"
  elif [[ -s "$DB_ARCHIVE" ]]; then
    db="có ($(du -h "$DB_ARCHIVE" | cut -f1))"
  fi
  dbn="${MF[DB_VERSION_BEFORE]:-}"
  [[ "${MF[DB_VERSION_READ]:-0}" == "1" ]] || dbn="(không đọc được)"
  [[ -n "$dbn" ]] || dbn="(chưa có version)"
  if [[ -n "${MF[BACKEND_PRE_IMAGE]:-}" && -n "${MF[FRONTEND_PRE_IMAGE]:-}" ]]; then img="${MF[BACKEND_PRE_IMAGE]} + ${MF[FRONTEND_PRE_IMAGE]}"
  else img="(không đủ: chỉ dùng được --db-only)"; fi
  # Nhãn chỉ khi BACKUP_KIND đúng `manual` (khóa này chỉ backup.sh ghi); giá trị khác không được hiện lại ra màn hình.
  printf '  %s) %s%s\n' "$i" "$(strip_ctl "$(basename "$f")")" "$([[ "${MF[BACKUP_KIND]:-}" == "manual" ]] && printf '  [loại: manual (backup thủ công bằng backup.sh)]')"
  printf '       thời gian: %s | trạng thái deploy: %s | bản phát hành: %s%s\n' \
    "${MF[CREATED_AT]:-${MF[TS]}}" "${MF[DEPLOY_STATUS]}" "${MF[RELEASE_VERSION]:-?}" "${MF[CD_RUN_ID]:+ | CD run: ${MF[CD_RUN_ID]}}"
  printf '       version DB trước deploy: %s | backup Mongo: %s | thẻ: %s\n' "$dbn" "$db" "${MF[PRE_TAG]}"
  printf '       image dự phòng: %s\n' "$img"
  if one_way_risk; then
    printf '       LƯU Ý: đã qua điểm hậu-migrate (bước 90, migration 011 một chiều): restore DB là đường quay lại duy nhất, mất dữ liệu sau backup.\n'
  fi
}

# Manifest MỚI NHẤT dùng được: bỏ qua manifest không có backup Mongo (MONGO_BACKUP_FILE rỗng: vd lần deploy bị dừng trước bước backup), có cảnh báo.
latest_manifest() {
  local base="$ROOT_DIR/$BACKUP_DIR" f i
  local -a files=()
  for f in "$base"/deploy-pre-*.manifest; do
    [[ -f "$f" ]] && files+=("$f")    # glob đã sắp theo tên; TS dạng YYYYMMDD-HHMMSS nên tên lớn nhất = mới nhất
  done
  (( ${#files[@]} > 0 )) || die "Không có manifest nào trong $BACKUP_DIR/. Dùng: bash restore.sh --list"
  for (( i=${#files[@]}-1; i>=0; i-- )); do
    f="${files[i]}"
    if ! grep -q '^MONGO_BACKUP_FILE=.' "$f" 2>/dev/null; then
      warn "--latest: bỏ qua $(strip_ctl "$(basename "$f")") vì không có backup Mongo (MONGO_BACKUP_FILE rỗng); sẽ chọn bản CŨ HƠN có backup (DB + image về lần đó, KHÔNG về điểm mới nhất này). Chọn tay: --list rồi --manifest <file>."
      continue
    fi
    printf '%s' "$f"
    return 0
  done
  die "Không manifest nào trong $BACKUP_DIR/ có backup Mongo để khôi phục. Dùng --list rồi --manifest <file>."
}

# ── Tiền điều kiện chung ─────────────────────────────────────────────────────
check_prereqs() {
  local cmd
  for cmd in docker gzip; do
    command -v "$cmd" >/dev/null 2>&1 || die "Thiếu lệnh '$cmd'."
  done
  (( APPLY == 0 )) || command -v curl >/dev/null 2>&1 || die "Thiếu lệnh 'curl'."
  docker compose version >/dev/null 2>&1 || die "Thiếu 'docker compose' (plugin v2)."
  docker info >/dev/null 2>&1 || die "Không nói chuyện được với Docker daemon (daemon chưa chạy, hoặc user thiếu quyền: thêm vào nhóm 'docker')."
  require_private_file "$ENV_FILE"
  require_no_placeholders "$ENV_FILE"
}

# Có deploy/backup/restore khác đang chạy không. Chạy thật: GIỮ khóa đến hết tiến trình (cùng file <thư mục deploy>/.deploy.lock với deploy.sh và backup.sh).
# Dry-run: chỉ THỬ khóa (mở file chỉ-đọc, không tạo/ghi gì) để báo trạng thái.
check_lock() {
  local lock="$ROOT_DIR/.deploy.lock"
  if (( APPLY == 1 )); then
    acquire_dir_lock "$ROOT_DIR"
    pass "không có deploy/backup/restore khác đang chạy (đã giữ khóa $lock)"
    return 0
  fi
  if [[ ! -f "$lock" ]] || ! command -v flock >/dev/null 2>&1; then
    pass "khóa deploy/backup/restore: chưa có tiến trình nào giữ (hoặc máy không có flock: bỏ qua)"
  elif ( flock -n 8 ) 8<"$lock" 2>/dev/null; then
    pass "không có deploy/backup/restore khác đang chạy"
  else
    bad "một deploy/backup/restore khác đang chạy (khóa $lock đang bị giữ)"
  fi
}

mongo_state() { inspect_field "$MONGO_CONTAINER" '{{.State.Status}}'; }

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

# Hai image dự phòng pre-<TS> (backend + frontend) phải có trong manifest VÀ còn trên máy (chưa bị docker image prune). Thiếu = [HỎNG].
check_pre_images() {
  local role ref missing=0
  if [[ -z "${MF[BACKEND_PRE_IMAGE]:-}" || -z "${MF[FRONTEND_PRE_IMAGE]:-}" ]]; then
    bad "manifest không có đủ image dự phòng (BACKEND_PRE_IMAGE='${MF[BACKEND_PRE_IMAGE]:-}', FRONTEND_PRE_IMAGE='${MF[FRONTEND_PRE_IMAGE]:-}': lần deploy đó chưa có container backend/frontend, hoặc backup chạy --no-image) nên không lùi được image. Thêm --db-only để chỉ khôi phục DB"
    return 0
  fi
  for role in BACKEND FRONTEND; do
    ref="${MF[${role}_PRE_IMAGE]}"
    if docker image inspect "$ref" >/dev/null 2>&1; then
      :
    else
      bad "image dự phòng $ref KHÔNG còn trên máy (đã bị docker image prune?). Nạp lại image đó (docker load) hoặc dùng --db-only"
      missing=1
    fi
  done
  (( missing == 0 )) && pass "hai image dự phòng ${MF[BACKEND_PRE_IMAGE]} và ${MF[FRONTEND_PRE_IMAGE]} còn trên máy"
  return 0
}

# ── Các kiểm trước (dry-run và apply đều chạy; mỗi mục [ĐẠT]/[HỎNG], không đổi gì) ───────────────────────────────────────
run_prechecks() {
  log "Kiểm trước khi khôi phục (chưa đổi gì):"
  PRE_FAIL=0
  check_lock

  if [[ -z "$DB_ARCHIVE" ]]; then
    bad "manifest không có backup Mongo (MONGO_BACKUP_FILE rỗng: DB trống lúc deploy hoặc backup bị bỏ qua) -> không khôi phục được. Nếu chỉ cần lùi image: docker tag <tên image>:${MF[PRE_TAG]} <tên image>:current rồi docker compose --env-file $ENV_FILE up -d --no-build --no-deps backend frontend"
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

  if (( DB_ONLY == 0 )); then check_pre_images; fi

  # --skip-safety-db: chốt chặn chặt (xem check_skip_safety_db): backup an toàn mới nhất phải còn nguyên VÀ DB hiện tại phải thật sự dở dang.
  if (( SKIP_SAFETY_DB == 1 )); then check_skip_safety_db; fi

  # Đĩa: backup an toàn cần chỗ. require_free_disk_gb tự die khi thiếu: chạy trong subshell để biến thành [HỎNG].
  if ( require_free_disk_gb "$DEPLOY_MIN_FREE_GB" ) >/dev/null 2>&1; then
    pass "đủ dung lượng đĩa (>= ${DEPLOY_MIN_FREE_GB} GB)"
  else
    bad "không đủ dung lượng đĩa (< ${DEPLOY_MIN_FREE_GB} GB ở thư mục deploy hoặc thư mục dữ liệu Docker): chạy lại 'bash ops/check-disk.sh' để xem chi tiết"
  fi
}

# Cảnh báo/ghi chú rút ra từ manifest (không phải lỗi kiểm).
print_warnings() {
  if one_way_risk; then
    red "CẢNH BÁO MỘT CHIỀU: lần deploy này đã tới điểm hậu-migrate (bước 90 = migration 011 MỘT CHIỀU có thể đã chạy). Khôi phục DB từ backup là đường quay lại DUY NHẤT;"
    red "MỌI dữ liệu phát sinh sau thời điểm backup Mongo (${MF[CREATED_AT]:-${MF[TS]}}) SẼ MẤT (đã có backup an toàn của trạng thái hiện tại ở bước 2, nhưng không tự gộp lại được)."
  fi
  case "${MF[DEPLOY_STATUS]}" in
    started) warn "Manifest ở trạng thái 'started': lần deploy đó bị ngắt giữa chừng (hoặc đang chạy) nên manifest chưa được chốt." ;;
    failed)  warn "Lần deploy đó đã THẤT BẠI (DEPLOY_STATUS=failed): khôi phục sẽ đưa về đúng trạng thái trước khi deploy bắt đầu." ;;
    *) : ;;
  esac
  if [[ "${MF[STACK_TOUCHED]:-0}" == "0" ]]; then
    warn "Manifest ghi STACK_TOUCHED=0: lần deploy đó dừng TRƯỚC khi đụng stack/DB, nên DB và image thường chưa bị đổi; có thể không cần khôi phục."
  fi
  if [[ "${MF[DB_VERSION_READ]:-0}" != "1" ]]; then
    warn "Manifest không có version DB trước deploy (DB_VERSION_READ=0): bước kiểm sau sẽ bỏ qua so khớp version DB."
  fi
}

print_plan() {
  local mode="DB + image"
  (( DB_ONLY == 1 )) && mode="chỉ DB"
  echo
  log "Manifest: $MANIFEST_PATH"
  log "  deploy ngày ${MF[CREATED_AT]:-${MF[TS]}} | bản phát hành ${MF[RELEASE_VERSION]:-?}${MF[CD_RUN_ID]:+ | CD run ${MF[CD_RUN_ID]}} | version DB ${MF[DB_VERSION_BEFORE]:-(không có)}"
  log "  chế độ khôi phục: $mode$( (( DB_ONLY == 1 )) || printf ' | image dự phòng %s + %s' "${MF[BACKEND_PRE_IMAGE]:-?}" "${MF[FRONTEND_PRE_IMAGE]:-?}" )"
  log "Kế hoạch (--apply --yes):"
  log "  1) dừng backend (giữ Mongo chạy) -> không còn ai ghi DB trong lúc backup"
  if (( SKIP_SAFETY_DB == 1 )); then log "  2) --skip-safety-db: KHÔNG dump lại DB (dùng backup an toàn đã có từ lần trước)$( (( DB_ONLY == 1 )) || printf ' + gắn thẻ image pre-restore-%s' "$RTS" )"
  else log "  2) backup AN TOÀN trạng thái hiện tại: ${BACKUP_DIR}/restore-safety-${RTS}.archive.gz$( (( DB_ONLY == 1 )) || printf ' + gắn thẻ image <tên>:pre-restore-%s' "$RTS" ). Lỗi ở bước 1-2: tự BẬT LẠI backend, dữ liệu chưa đổi"; fi
  log "  3) DB: xóa DB realestate rồi mongorestore --drop --nsInclude 'realestate.*' từ ${MF[MONGO_BACKUP_FILE]:-?}"
  if (( DB_ONLY == 1 )); then
    log "  4) (bỏ qua: --db-only không đổi thẻ image)"
    log "  5) docker compose up -d --no-build --no-deps backend (image hiện có)"
  else
    log "  4) gắn thẻ ${MF[BACKEND_PRE_IMAGE]:-?} -> ${MF[BACKEND_IMAGE_NAME]:-?}:current và ${MF[FRONTEND_PRE_IMAGE]:-?} -> ${MF[FRONTEND_IMAGE_NAME]:-?}:current"
    log "  5) docker compose up -d --no-build --no-deps backend frontend"
  fi
  log "  6) chờ mongo healthy + backend liveness; 7) kiểm version DB + image đang chạy khớp manifest"
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

# --skip-safety-db: không dump lại; in rõ backup an toàn + thẻ image pre-restore-* ĐÃ CÓ để người chạy biết bản nào giữ trạng thái trước restore.
report_existing_safety() {
  local f t
  warn "--skip-safety-db: KHÔNG dump lại DB hiện tại (DB có thể đang dở dang do restore trước bị ngắt). Bản giữ trạng thái trước restore là các backup an toàn đã có:"
  while IFS= read -r f; do log "  backup an toàn có sẵn: $f"; done < <(list_safety_files)
  while IFS= read -r t; do log "  thẻ image an toàn có sẵn: $t"; done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E ':pre-restore-[0-9]{8}-[0-9]{6}$' || true)
}

# Gắn `<tên>:pre-restore-<RTS>` cho image mà container $1 ĐANG chạy (như deploy.sh tag_pre_image: lấy theo container, không theo thẻ), để đưa lại được bản
# trước restore. Chưa có container: bỏ qua. Chạy trong SAFE_PHASE (lỗi = bật lại backend, chưa đổi gì).
safety_tag_image() { # <container> <tên image>
  local container="$1" name="$2" image_id ref
  image_id="$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null || true)"
  image_id="${image_id%%$'\n'*}"; image_id="${image_id%$'\r'}"
  if [[ -z "$image_id" ]]; then log "Chưa có container $container: không gắn thẻ an toàn cho image của nó."; return 0; fi
  ref="${name}:pre-restore-${RTS}"
  docker tag "$image_id" "$ref" || die "Không gắn được thẻ an toàn $ref cho image của $container. Chưa đổi gì."
  SAFETY_TAGS+=("$ref")
  log "Đã gắn thẻ an toàn $ref (image $container đang chạy TRƯỚC restore); KHÔNG push thẻ này."
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

# Đặt lại bản trước deploy làm `current` (chỉ restore.sh/deploy.sh được đổi `current`; compose dùng <tên>:current). Image đã được kiểm còn trên máy ở run_prechecks.
restore_image_tags() {
  local ref
  for ref in BACKEND FRONTEND; do
    docker tag "${MF[${ref}_PRE_IMAGE]}" "${MF[${ref}_IMAGE_NAME]}:current" || die "Không đặt được ${MF[${ref}_PRE_IMAGE]} thành ${MF[${ref}_IMAGE_NAME]}:current."
    log "Đã đặt ${MF[${ref}_PRE_IMAGE]} thành ${MF[${ref}_IMAGE_NAME]}:current."
  done
}

# ID image của tham chiếu $1 (rỗng nếu không có).
image_id_of() { local v; v="$(docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true)"; v="${v%%$'\n'*}"; printf '%s' "${v%$'\r'}"; }
# ID image mà container $1 đang chạy (rỗng nếu không có container).
container_image_id() { local v; v="$(docker inspect -f '{{.Image}}' "$1" 2>/dev/null || true)"; v="${v%%$'\n'*}"; printf '%s' "${v%$'\r'}"; }

# Chờ mongo healthy / backend liveness dùng hàm chung (ops-common).
post_check() { # in số liệu; trả 1 nếu có chỗ không khớp
  local bad_n=0 want got role container pre
  log "Kiểm sau khôi phục:"
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
  if (( DB_ONLY == 0 )); then
    for role in BACKEND FRONTEND; do
      pre="${MF[${role}_PRE_IMAGE]}"
      if [[ "$role" == "BACKEND" ]]; then container="$BACKEND_CONTAINER"; else container="$FRONTEND_CONTAINER"; fi
      want="$(image_id_of "$pre")"; got="$(container_image_id "$container")"
      if [[ -z "$want" || -z "$got" ]]; then
        red "  [LỖI] không đọc được image ID để so khớp $container với $pre"; bad_n=$(( bad_n + 1 ))
      elif [[ "$got" == "$want" ]]; then
        log "  [KHỚP] image $container đang chạy = $pre"
      else
        red "  [LỆCH] image $container đang chạy (${got:0:19}) khác $pre (${want:0:19})"; bad_n=$(( bad_n + 1 ))
      fi
    done
  fi
  (( bad_n == 0 ))
}

# Sau khi lùi bản, release.env vẫn là bản MỚI: deploy.sh kế tiếp sẽ deploy lại đúng bản vừa lùi khỏi.
release_warning_text() {
  printf '%s' "CẢNH BÁO: release.env trong thư mục deploy vẫn là bản MỚI. Lần 'bash deploy.sh' kế tiếp sẽ deploy lại ĐÚNG bản vừa lùi khỏi (promote lại thành current). Chỉ chạy deploy.sh khi đã sửa xong bản đó, hoặc cài lại gói bản cũ (ops/install-release.sh) trước."
}

# Lỗi SAU KHI đã bắt đầu đổi trạng thái: in hướng dẫn, KHÔNG tự rollback tiếp.
print_guidance() {
  local t
  {
    echo
    echo "════════════ RESTORE DỪNG GIỮA CHỪNG — script KHÔNG tự rollback thêm ════════════"
    echo "Bước đang chạy: $STEP"
    [[ -z "$SAFETY_FILE" ]] || echo "Backup an toàn trạng thái TRƯỚC restore (DB): $SAFETY_FILE"
    for t in "${SAFETY_TAGS[@]+"${SAFETY_TAGS[@]}"}"; do
      echo "Thẻ image an toàn TRƯỚC restore: $t (đưa image về: docker tag $t ${t%%:*}:current rồi up -d --no-build --no-deps backend frontend)"
    done
    echo "Manifest đang khôi phục: $MANIFEST_PATH"
    echo
    echo "1) Xem tình trạng:"
    echo "     docker compose --env-file $ENV_FILE ps -a"
    echo "     docker compose --env-file $ENV_FILE logs --tail 100 backend"
    echo "2) Sửa nguyên nhân rồi chạy lại cùng lệnh restore (idempotent: nạp lại từ cùng backup). Backend có thể đang DỪNG:"
    echo "     docker compose --env-file $ENV_FILE up -d --no-build --no-deps backend frontend   # khi DB đã ổn và muốn bật lại"
    echo "3) Nếu DB đang DỞ DANG sau mongorestore bị ngắt/lỗi: chạy lại restore (xóa DB rồi nạp lại), hoặc nạp tay bằng $DOC mục 6"
    echo "   (luôn kèm --nsInclude 'realestate.*'). Không dùng 'docker compose down -v' (xóa vĩnh viễn dữ liệu)."
    echo "   LƯU Ý khi chạy lại: DB lúc này dở dang nên backup an toàn mới sẽ KHÔNG hợp lệ (thiếu users) và làm restore từ chối. Thêm --skip-safety-db"
    echo "   (vẫn cần --apply --yes): bỏ qua bước dump lại, dùng backup an toàn ĐÃ CÓ ở trên; lệnh đầy đủ:"
    echo "     bash restore.sh --manifest ${MANIFEST_PATH#"$ROOT_DIR"/} --apply --yes --skip-safety-db"
    echo "   (nếu lần chạy trước dùng thêm --db-only thì giữ nguyên cờ đó)"
    (( DB_ONLY == 1 )) || { echo; echo "4) $(release_warning_text)"; }
  } >&2
}

# Mọi lối thoát (kể cả SIGTERM/SIGINT/SIGHUP, nhờ trap bên dưới đổi thành `exit 128+N`): on_exit nhận mã khác 0.
#  - SAFE_PHASE=1 (backend đã dừng nhưng DB/image CHƯA đổi): BẬT LẠI backend (best effort) rồi báo dữ liệu chưa đổi; KHÔNG in hướng dẫn "dừng giữa chừng".
#  - TOUCHED=1 (đã bắt đầu đổi DB/image): in hướng dẫn, KHÔNG tự rollback tiếp.
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
      red "Dừng TRƯỚC khi đổi dữ liệu (mã $code): DB và image CHƯA bị đổi." || true
      if (( restarted == 1 )); then
        red "Đã bật lại backend (DB, image nguyên vẹn). Sửa nguyên nhân rồi chạy lại restore." || true
      else
        red "KHÔNG bật lại được backend tự động. Bật tay: docker compose --env-file $ENV_FILE up -d --no-build --no-deps backend (DB, image nguyên vẹn)." || true
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
  # 1-2) Dừng backend TRƯỚC khi backup an toàn: không còn ai ghi DB nên bản dump khớp đúng trạng thái trước restore. Từ đây đến hết bước 2 (SAFE_PHASE=1)
  # DB/image CHƯA đổi: lỗi hay tín hiệu thì on_exit BẬT LẠI backend rồi thoát (không in "dừng giữa chừng").
  SAFE_PHASE=1
  STEP="1) dừng backend"
  log "1) Dừng backend (giữ $MONGO_CONTAINER chạy) ..."
  compose stop backend

  STEP="2) backup an toàn trạng thái hiện tại"
  if (( SKIP_SAFETY_DB == 1 )); then report_existing_safety; else safety_backup_db; fi
  if (( DB_ONLY == 0 )); then
    safety_tag_image "$BACKEND_CONTAINER" "${MF[BACKEND_IMAGE_NAME]}"
    safety_tag_image "$FRONTEND_CONTAINER" "${MF[FRONTEND_IMAGE_NAME]}"
  fi
  SAFE_PHASE=0
  TOUCHED=1   # từ đây DB/image bắt đầu bị đổi: lỗi thì in hướng dẫn

  STEP="3) khôi phục DB"
  log "3) Khôi phục DB ..."
  restore_db

  if (( DB_ONLY == 0 )); then
    STEP="4) đặt image pre-${MF[TS]} thành current"
    log "4) Đặt image dự phòng thành current ..."
    restore_image_tags
  fi

  STEP="5) khởi động lại backend/frontend"
  if (( DB_ONLY == 1 )); then
    log "5) Khởi động lại backend (image hiện có) ..."
    compose up -d --no-build --no-deps backend
  else
    log "5) docker compose up -d --no-build --no-deps backend frontend ..."
    compose up -d --no-build --no-deps backend frontend
  fi

  STEP="6) chờ mongo/backend sống"
  wait_mongo_healthy
  wait_backend_liveness

  STEP="7) kiểm sau khôi phục"
  echo
  if post_check; then
    log "KHÔI PHỤC XONG: DB$( (( DB_ONLY == 1 )) || printf ' + image' ) khớp manifest."
  else
    TOUCHED=0   # đã chạy hết các bước; chỉ báo lệch (không in 'dừng giữa chừng')
    die "Khôi phục đã chạy hết nhưng có chỗ KHÔNG khớp manifest (xem [LỆCH]/[LỖI] ở trên). Kiểm tra thủ công trước khi cho dùng."
  fi
  [[ -z "$SAFETY_FILE" ]] || log "Backup an toàn (trạng thái trước restore): $SAFETY_FILE"
  local t
  for t in "${SAFETY_TAGS[@]+"${SAFETY_TAGS[@]}"}"; do log "Thẻ image an toàn của trạng thái trước restore: $t"; done
  if (( DB_ONLY == 0 )); then red "$(release_warning_text)"; fi
  log "Đưa lại bản trước restore nếu cần: DB từ ${SAFETY_FILE:-<backup an toàn>} (tài liệu mục 6, --nsInclude 'realestate.*'); image: docker tag <thẻ pre-restore ở trên> <tên>:current rồi up -d --no-build --no-deps backend frontend."
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
      --skip-safety-db) SKIP_SAFETY_DB=1 ;;
      -h|--help) trap - EXIT; usage; exit 0 ;;
      *) trap - EXIT; printf '[restore] Tham số không hợp lệ: %s\n(Các cờ khôi phục code bằng git của bản cũ đã bỏ ở v1.0.6: restore.sh nay đặt image pre-<TS> thành current theo mặc định; chỉ DB thì dùng --db-only.)\n\n' "$arg" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done
  local bad_usage=""
  [[ -n "$ACTION" ]] || bad_usage="Thiếu một trong --list | --latest | --manifest <file>."
  if [[ "$ACTION" == "list" ]] && (( APPLY == 1 || DB_ONLY == 1 || SKIP_SAFETY_DB == 1 )); then
    bad_usage="--list chỉ để liệt kê, không đi kèm --apply/--db-only/--skip-safety-db."
  fi
  if [[ -n "$bad_usage" ]]; then trap - EXIT; printf '[restore] %s\n\n' "$bad_usage" >&2; usage >&2; exit 2; fi
  # Chạy thật BẮT BUỘC --apply kèm --yes (cờ tường minh, không nhận biến môi trường). --apply thiếu --yes: từ chối TRƯỚC mọi lệnh Docker.
  if (( APPLY == 1 && YES == 0 )); then
    trap - EXIT
    echo "[restore] --apply XÓA DB realestate và ĐẶT LẠI image về bản trước deploy: bắt buộc thêm --yes (không có biến môi trường thay thế). Chưa đổi gì." >&2
    exit 2
  fi
  if (( YES == 1 && APPLY == 0 )); then warn "--yes bị bỏ qua vì không có --apply (đang là dry-run)."; fi

  # Phân giải đường dẫn manifest TRƯỚC khi đổi thư mục (người dùng có thể đưa đường dẫn tương đối theo cwd).
  local given=""
  [[ "$ACTION" != "manifest" ]] || { given="$(readlink -f -- "$MANIFEST_ARG" 2>/dev/null || true)"; [[ -n "$given" ]] || die "Không resolve được đường dẫn manifest '$MANIFEST_ARG'."; }

  [[ "$MONGO_TIMEOUT" =~ ^[0-9]+$ && "$HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || die "MONGO_TIMEOUT/HEALTH_TIMEOUT phải là số nguyên (giây)."
  [[ "$DUMP_TIMEOUT" =~ ^[0-9]+$ && "$RESTORE_TIMEOUT" =~ ^[0-9]+$ && "$OPS_EXEC_TIMEOUT" =~ ^[0-9]+$ ]] || die "DUMP_TIMEOUT/RESTORE_TIMEOUT/OPS_EXEC_TIMEOUT phải là số nguyên (giây)."

  cd "$ROOT_DIR"
  [[ -f docker-compose.yml ]] || die "Không thấy docker-compose.yml: chạy script từ thư mục deploy (hoặc đặt RESTORE_REPO_DIR=<thư mục deploy>)."

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
    log "  bash restore.sh --manifest ${MANIFEST_PATH#"$ROOT_DIR"/}$( (( DB_ONLY == 1 )) && printf ' --db-only'; (( SKIP_SAFETY_DB == 1 )) && printf ' --skip-safety-db' ) --apply --yes"
    return 0
  fi

  echo
  apply_restore
}

# Bọc toàn bộ trong main + `exit`: bash không được đọc tiếp phần lệnh lạ sau main nếu file này bị thay giữa chừng (gói phát hành mới chép đè restore.sh).
main "$@"
