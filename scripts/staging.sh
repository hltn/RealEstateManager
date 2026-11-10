#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/staging.sh — "STAGING LOCAL": chạy stack giống production (docker-compose.yml + deploy.sh THẬT) trên máy dev
# để diễn tập deploy/migration trước khi lên VPS. Tài liệu: docs/01_Infrastructure/06_Production_Deploy.md mục 11.3.
#
#   bash scripts/staging.sh init [--force]          sinh .staging/env (secret GIẢ ngẫu nhiên), kiểm tiền đề
#   bash scripts/staging.sh seed-prod102 [--yes]    nạp DB giả "production 1.0.2" (XÓA DB realestate của staging trước)
#   bash scripts/staging.sh deploy [args...]        chạy ĐÚNG deploy.sh của repo với biến môi trường staging (mặc định --no-pull;
#                                                   thêm --pull của wrapper nếu muốn git pull; --plan-only, --no-migrate... chuyển nguyên)
#   bash scripts/staging.sh status                  docker compose ps + `status` của runner migration
#   bash scripts/staging.sh down                    dừng và gỡ container (GIỮ dữ liệu/volume)
#   bash scripts/staging.sh reset [--images] [--yes]  XÓA DỮ LIỆU staging về trống (container + volume; --images: cả image staging)
#   bash scripts/staging.sh restore-dump <archive> --yes  XÓA DB realestate của staging rồi nạp bản sao dump (mongodump --archive --gzip);
#                                                   <archive> BẮT BUỘC nằm trong .staging/ (gitignore), BẮT BUỘC --yes. Quy trình: scripts/staging/REHEARSAL.md
#   bash scripts/staging.sh runner <lệnh...>        chạy runner migration (node dist/migrations/cli.js ...) trên staging, vd: runner reconcile --apply --skip-version --phase pre-up
#   bash scripts/staging.sh step3                   diễn tập bước 3: chèn 2 khách không mã (phải được) + 1 khách trùng SĐT (phải lỗi) trên staging
#   bash scripts/staging.sh snapshot [nhãn]         chụp CHỈ ĐỌC số đếm/index/sổ system của staging -> .staging/snapshots/<nhãn>-<giờ>.json
#
# AN TOÀN: chỉ nhắm project `realestate-staging` và container `rhstg_*`. Từ chối chạy nếu tên project/container (kể cả biến môi
# trường MONGO_CONTAINER/BACKEND_CONTAINER/COMPOSE_PROJECT_NAME đặt sẵn) trùng `realestate_*`, `realestate-dev*` hay stack production,
# và kiểm lại cấu hình compose đã phủ (tên container, tên volume/mạng, cổng chỉ 127.0.0.1) trước mọi lệnh đụng Docker.
# Windows/Git Bash: wrapper tự bật các shim trong scripts/staging/shims (stat/chown/install/docker); VPS Ubuntu không dùng chúng.
# Biến tùy chọn: STAGING_BACKEND_PORT (mặc định 13100), STAGING_FRONTEND=1 (bật frontend, cổng STAGING_FRONTEND_PORT, mặc định 18080),
#   STAGING_ASSUME_YES=1 (bỏ hỏi xác nhận; KHÔNG áp dụng cho restore-dump, lệnh đó chỉ nhận cờ --yes), STAGING_ALLOW_DOCKER_HOST=1 (cho phép DOCKER_HOST/DOCKER_CONTEXT từ xa).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="staging"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[staging] LỖI: không resolve được đường dẫn thật của staging.sh." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")/.." && pwd)"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"
cd "$ROOT_DIR"

readonly STG_PROJECT="realestate-staging"
readonly STG_DIR=".staging"
readonly STG_ENV="$STG_DIR/env"
readonly STG_MONGO="rhstg_mongo"
readonly STG_BACKEND="rhstg_backend"
readonly STG_IMAGE_PREFIX="realestate-staging-"   # image do compose dựng: <project>-<service>
# Cổng staging được phép: backend 13100-13199, frontend 18080-18099. Các cổng của dev/prod bị chặn tường minh (kiểm trước dải).
readonly STG_ALLOWED_PORTS_RE='^(131[0-9]{2}|180[89][0-9])$'
readonly STG_BLOCKED_PORTS=" 80 443 3000 6379 9000 9001 20128 27017 "
# Biến ép riêng của wrapper (KHÔNG đọc từ môi trường): chỉ cờ --yes hoặc STAGING_ASSUME_YES=1 mới bỏ qua xác nhận.
STG_YES=0

usage() {
  sed -n '3,22p' "$_self" | sed 's/^# \{0,1\}//'
}

is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

# ── Rào chắn tên ──────────────────────────────────────────────────────────────
# Chỉ chấp nhận ĐÚNG tên staging. Mọi tên khác (đặc biệt realestate_*, realestate-dev*, realestate_mongo) bị từ chối.
assert_staging_name() { # <loại> <giá trị> <regex cho phép>
  [[ "$2" =~ $3 ]] || die "Từ chối: $1 '$2' không phải tên staging (chỉ cho phép $3). Wrapper này không bao giờ chạm realestate_*, realestate-dev* hay stack production."
  if [[ "$2" =~ ^realestate(_|-dev|$) ]]; then die "Từ chối: $1 '$2' trùng tên stack dev/production."; fi
}

guard_environment() {
  assert_staging_name "project" "$STG_PROJECT" '^realestate-staging$'
  assert_staging_name "container mongo" "$STG_MONGO" '^rhstg_[a-z0-9_]+$'
  assert_staging_name "container backend" "$STG_BACKEND" '^rhstg_[a-z0-9_]+$'
  local v want
  for v in MONGO_CONTAINER BACKEND_CONTAINER; do
    case "$v" in MONGO_CONTAINER) want="$STG_MONGO" ;; *) want="$STG_BACKEND" ;; esac
    [[ -z "${!v:-}" || "${!v}" == "$want" ]] || die "Từ chối: biến môi trường $v='${!v}' khác tên staging '$want'. Bỏ biến này (wrapper tự đặt)."
  done
  [[ -z "${COMPOSE_PROJECT_NAME:-}" || "${COMPOSE_PROJECT_NAME}" == "$STG_PROJECT" ]] \
    || die "Từ chối: COMPOSE_PROJECT_NAME='${COMPOSE_PROJECT_NAME}' khác '$STG_PROJECT'. Bỏ biến này."
  [[ -z "${DOCKER_HOST:-}" || "${STAGING_ALLOW_DOCKER_HOST:-0}" == "1" ]] \
    || die "Từ chối: DOCKER_HOST đã đặt ('${DOCKER_HOST}'), staging sẽ chạy trên Docker từ xa. Bỏ biến, hoặc đặt STAGING_ALLOW_DOCKER_HOST=1 nếu cố ý."
  # Docker context: DOCKER_CONTEXT đặt sẵn hoặc context hiện tại trỏ tới endpoint từ xa (ssh://, tcp://...) là từ chối, kẻo staging
  # chạy trên Docker của máy khác (có thể là VPS production).
  [[ -z "${DOCKER_CONTEXT:-}" || "${STAGING_ALLOW_DOCKER_HOST:-0}" == "1" ]] \
    || die "Từ chối: DOCKER_CONTEXT đã đặt ('${DOCKER_CONTEXT}'). Bỏ biến, hoặc đặt STAGING_ALLOW_DOCKER_HOST=1 nếu cố ý."
  if [[ "${STAGING_ALLOW_DOCKER_HOST:-0}" != "1" ]] && command -v docker >/dev/null 2>&1; then
    local ctx_host
    ctx_host="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null | head -n 1)" || ctx_host=""
    ctx_host="${ctx_host%$'\r'}"
    case "$ctx_host" in
      unix://*|npipe://*) ;;
      *) die "Từ chối: endpoint của Docker context hiện tại là '${ctx_host:-không xác định}', không phải unix:// hoặc npipe:// (máy này). Đổi về context local (docker context use default), hoặc đặt STAGING_ALLOW_DOCKER_HOST=1 nếu cố ý." ;;
    esac
  fi
  local p
  for p in "${STAGING_BACKEND_PORT:-13100}" "${STAGING_FRONTEND_PORT:-18080}"; do
    [[ "$p" =~ ^[0-9]+$ ]] || die "Cổng '$p' không phải số."
    [[ "$STG_BLOCKED_PORTS" != *" $p "* ]] || die "Cổng $p thuộc dev/prod (80/443/3000/6379/9000/9001/20128/27017): staging không được dùng."
    [[ "$p" =~ $STG_ALLOWED_PORTS_RE ]] || die "Cổng $p ngoài dải staging (backend 13100-13199, frontend 18080-18099)."
  done
  [[ "${STAGING_BACKEND_PORT:-13100}" != "${STAGING_FRONTEND_PORT:-18080}" ]] || die "STAGING_BACKEND_PORT và STAGING_FRONTEND_PORT trùng nhau."
}

# Đặt môi trường cho compose/deploy.sh (chỉ trong tiến trình wrapper và con của nó).
prepare_env() {
  guard_environment
  unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR
  # Biến shell của dev (JWT_SECRET, MONGO_ROOT_PASSWORD, PORT...) THẮNG --env-file trong compose: gỡ mọi khóa của .env.staging.example
  # (và vài biến tùy chọn compose đọc) khỏi môi trường để staging chỉ dùng .staging/env.
  local k
  while IFS= read -r k; do
    [[ -n "$k" ]] && unset "$k"
  done < <(sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*$/\1/p' .env.staging.example 2>/dev/null | tr -d '\r')
  unset MONGO_APP_USERNAME MONGO_APP_PASSWORD S3_APP_ACCESS_KEY_ID S3_APP_SECRET_ACCESS_KEY S3_BUCKET_ATTACHMENTS S3_BUCKET_EXPORTS GIT_COMMIT
  local sep=':'
  is_windows && sep=';'
  export COMPOSE_PATH_SEPARATOR="$sep"
  export COMPOSE_FILE="docker-compose.yml${sep}docker-compose.staging.yml"
  export COMPOSE_PROJECT_NAME="$STG_PROJECT"
  if [[ "${STAGING_FRONTEND:-0}" == "1" ]]; then export COMPOSE_PROFILES="frontend"; fi
  export STAGING_BACKEND_PORT="${STAGING_BACKEND_PORT:-13100}" STAGING_FRONTEND_PORT="${STAGING_FRONTEND_PORT:-18080}"
  export MONGO_CONTAINER="$STG_MONGO" BACKEND_CONTAINER="$STG_BACKEND"
  export HEALTH_URL="http://127.0.0.1:${STAGING_BACKEND_PORT}/api/v1/health/liveness"
  export DEPLOY_ENV_FILE="$STG_ENV" DEPLOY_RUNTIME_ENV_FILE="$STG_DIR/backend.env"
  export DEPLOY_LOGS_DIR="$STG_DIR/logs" DEPLOY_BACKUP_DIR="$STG_DIR/backups"
  export NINE_ROUTER_CONTAINER=""
  export DEPLOY_MIN_FREE_GB="${DEPLOY_MIN_FREE_GB:-1}"
  if is_windows; then
    export STAGING_SHIM_DIR="$ROOT_DIR/scripts/staging/shims"
    export STAGING_ENV_FILE="$STG_ENV"
    export PATH="$STAGING_SHIM_DIR:$PATH"
  fi
}

compose() { docker compose --env-file "$STG_ENV" "$@"; }

need_docker() {
  command -v docker >/dev/null 2>&1 || die "Thiếu lệnh 'docker'."
  docker compose version >/dev/null 2>&1 || die "Thiếu 'docker compose' (plugin v2)."
  docker info >/dev/null 2>&1 || die "Không nói chuyện được với Docker daemon (Docker Desktop đã chạy chưa?)."
}

need_env_file() { [[ -f "$STG_ENV" ]] || die "Chưa có $STG_ENV. Chạy trước: bash scripts/staging.sh init"; }

# Kiểm cấu hình compose ĐÃ PHỦ trước khi đụng Docker: tên project/container/volume/mạng đúng staging, cổng chỉ 127.0.0.1.
preflight_config() {
  need_env_file
  local cfg bad
  cfg="$(compose config 2>&1)" || { printf '%s\n' "$cfg" >&2; die "docker compose config lỗi (xem trên). Thiếu biến trong $STG_ENV? Thử: bash scripts/staging.sh init --force (chỉ khi chưa có dữ liệu staging)."; }
  cfg="${cfg//$'\r'/}"
  grep -qxF "name: $STG_PROJECT" <<<"$cfg" || die "Cấu hình compose không có 'name: $STG_PROJECT' (docker-compose.staging.yml chưa được phủ?). Từ chối chạy."
  bad="$(grep -E '^\s+container_name:' <<<"$cfg" | grep -vE 'container_name: rhstg_[a-z0-9_]+$' || true)"
  [[ -z "$bad" ]] || die "Có container_name không phải rhstg_*: $bad. Từ chối chạy."
  bad="$(grep -E '^\s+name:' <<<"$cfg" | grep -vE 'name: realestate-staging(_[a-z0-9_]+)?$' || true)"
  [[ -z "$bad" ]] || die "Có tên volume/mạng không thuộc project staging: $bad. Từ chối chạy."
  bad="$(grep -E '^\s+host_ip:' <<<"$cfg" | grep -vE 'host_ip: 127\.0\.0\.1$' || true)"
  [[ -z "$bad" ]] || die "Có cổng publish không bind 127.0.0.1: $bad. Từ chối chạy."
  bad="$(grep -E '^\s+published:' <<<"$cfg" | sed -E 's/.*published: *"?([0-9]+)"?.*/\1/' | grep -vE "$STG_ALLOWED_PORTS_RE" || true)"
  [[ -z "$bad" ]] || die "Có cổng publish ngoài dải staging: $bad. Từ chối chạy."
}

confirm() { # <câu hỏi>
  # KHÔNG đọc biến môi trường ASSUME_YES (tên chung chung, dễ do công cụ khác đặt): chỉ --yes hoặc STAGING_ASSUME_YES=1.
  if [[ "${STAGING_ASSUME_YES:-0}" == "1" || "$STG_YES" == "1" ]]; then return 0; fi
  [[ -t 0 ]] || die "Cần xác nhận nhưng không có terminal. Thêm --yes (hoặc STAGING_ASSUME_YES=1) nếu chắc chắn."
  local ans
  read -r -p "$1 [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || die "Đã hủy."
}

rand_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

# ── init ─────────────────────────────────────────────────────────────────────
cmd_init() {
  local force=0 a
  for a in "$@"; do [[ "$a" == "--force" ]] && force=1; done
  guard_environment
  # CRLF trong script chạy bằng bash làm hỏng (`\r`): git trên Windows (autocrlf) có thể tạo ra. .gitattributes ép LF cho *.sh.
  # (Đếm ký tự CR bằng tr: grep GNU trên Git Bash bỏ CR trước khi so khớp nên không dùng được.)
  local crlf="" f
  for f in deploy.sh scripts/lib/ops-common.sh scripts/staging.sh scripts/staging/shims/*; do
    [[ "$(tr -d -c '\r' < "$f" | wc -c)" -eq 0 ]] || crlf+="$f "
  done
  [[ -z "$crlf" ]] || die "Các file sau có CRLF (bash không chạy được): $crlf. Sửa: sed -i 's/\r\$//' <file> (hoặc git add --renormalize rồi checkout lại)."
  [[ -f docker-compose.staging.yml && -f .env.staging.example ]] || die "Thiếu docker-compose.staging.yml hoặc .env.staging.example."
  prepare_env
  need_docker
  # umask 077 quanh việc tạo thư mục/file bí mật: không có khoảng hở quyền rộng trước chmod (đặt lại umask cũ ở cuối).
  local old_umask
  old_umask="$(umask)"
  umask 077
  mkdir -p "$STG_DIR/logs" "$STG_DIR/backups"
  [[ -e "$STG_DIR/backend.env" ]] || : > "$STG_DIR/backend.env"
  if [[ -f "$STG_ENV" && $force -eq 0 ]]; then
    log "$STG_ENV đã có: giữ nguyên (bí mật đã gắn với volume Mongo/MinIO nếu staging đã chạy). Dùng 'init --force' để sinh lại."
  else
    if [[ -n "$(docker volume ls -q --filter "name=${STG_PROJECT}_" 2>/dev/null)" ]]; then
      die "Đã có volume staging (${STG_PROJECT}_*): sinh lại bí mật sẽ làm Mongo/MinIO hiện có không đăng nhập được. Chạy 'reset' trước rồi 'init --force'."
    fi
    local line n token
    : > "$STG_ENV"
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      while [[ "$line" =~ __HEX([0-9]+)__ ]]; do
        token="${BASH_REMATCH[0]}"; n="${BASH_REMATCH[1]}"
        line="${line/"$token"/$(rand_hex "$n")}"
      done
      printf '%s\n' "$line" >> "$STG_ENV"
    done < .env.staging.example
    chmod 600 "$STG_ENV" 2>/dev/null || true
    log "Đã sinh $STG_ENV (bí mật GIẢ ngẫu nhiên, nằm ngoài git). Admin web: ADMIN_EMAIL/ADMIN_PASSWORD trong file đó."
  fi
  umask "$old_umask"
  local img
  for img in "${MONGO_IMAGE:-mongo:7}" "${REDIS_IMAGE:-redis:7-alpine}" "${MINIO_IMAGE:-cgr.dev/chainguard/minio:latest}"; do
    docker image inspect "$img" >/dev/null 2>&1 || warn "Chưa có image '$img' trên máy: docker compose sẽ phải TẢI nó khi up (wrapper không tự pull)."
  done
  is_windows && log "Windows/Git Bash: sẽ dùng shim trong scripts/staging/shims (stat/chown/install/docker). Không có flock: khóa chống chạy chồng của deploy.sh bị bỏ qua."
  preflight_config
  log "init xong. Tiếp: seed-prod102 (hoặc deploy thẳng để thử cài mới), rồi deploy --plan-only / deploy."
}

# ── seed-prod102 ─────────────────────────────────────────────────────────────
wait_mongo_healthy() {
  local i st
  for (( i = 0; i < 60; i++ )); do
    st="$(inspect_field "$STG_MONGO" '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
    [[ "$st" == "healthy" ]] && return 0
    sleep 3
  done
  die "$STG_MONGO chưa healthy sau 180s (trạng thái: $st)."
}

cmd_seed() {
  local a
  for a in "$@"; do [[ "$a" == "--yes" || "$a" == "-y" ]] && STG_YES=1; done
  prepare_env; need_docker; preflight_config
  confirm "Nạp DB giả production 1.0.2: XÓA DB 'realestate' trong $STG_MONGO (staging) rồi nạp lại. Tiếp tục?"
  log "Khởi động $STG_MONGO (nếu chưa chạy) ..."
  compose up -d mongo
  wait_mongo_healthy
  docker exec -i "$STG_MONGO" mongosh --quiet --norc --file /dev/stdin < scripts/staging/seed-prod102.js
  log "Đã nạp DB giả production 1.0.2 (system trống). Tiếp: deploy --plan-only."
}

# ── restore-dump (FR-21, Architecture 5.10) ──────────────────────────────────
# Trả (in) đường dẫn tuyệt đối đã resolve (symlink, `..`) của archive; die nếu: không phải file thường, rỗng, nằm NGOÀI $ROOT_DIR/.staging/
# (dump production chứa dữ liệu cá nhân thật: chỉ được để trong thư mục đã gitignore, không rải ở nơi khác), hay không phải gzip hợp lệ.
# Không đọc NỘI DUNG dump ở đây (chỉ `gzip -t` kiểm toàn vẹn luồng nén).
resolve_dump_archive() { # <đường dẫn>
  local given="$1" real stg_real
  [[ -n "$given" ]] || die "Thiếu đường dẫn archive."
  real="$(readlink -f -- "$given" 2>/dev/null || true)"
  stg_real="$(readlink -f -- "$ROOT_DIR/$STG_DIR" 2>/dev/null || true)"
  [[ -n "$real" && -f "$real" ]] || die "Không thấy file archive '$given' (phải là file thường)."
  [[ -n "$stg_real" && "$real" == "$stg_real"/* ]] \
    || die "Từ chối: archive '$given' nằm NGOÀI $STG_DIR/. Chép bản sao dump vào $STG_DIR/ (thư mục đã gitignore) rồi chạy lại; không đọc dump từ nơi khác."
  [[ -s "$real" ]] || die "Archive '$given' rỗng (0 byte)."
  gzip -t "$real" 2>/dev/null || die "Archive '$given' không phải gzip hợp lệ (hỏng/cụt, hoặc dump không dùng --gzip: mongodump --archive --gzip)."
  printf '%s' "$real"
}

# Chạy mongosh script (stdin) TRONG container staging, xác thực root từ biến môi trường của container.
stg_mongosh_stdin() { docker exec -i "$STG_MONGO" mongosh --quiet --norc --file /dev/stdin; }

cmd_restore_dump() {
  local archive="" a
  for a in "$@"; do
    case "$a" in
      --yes|-y) STG_YES=1 ;;
      -*) die "Tùy chọn không hợp lệ: $a (dùng: restore-dump <archive> --yes)." ;;
      *) [[ -z "$archive" ]] || die "Chỉ nhận MỘT đường dẫn archive."; archive="$a" ;;
    esac
  done
  [[ -n "$archive" ]] || die "Thiếu đường dẫn archive. Dùng: bash scripts/staging.sh restore-dump <archive trong $STG_DIR/> --yes"
  # Lệnh phá hủy DB: KHÔNG hỏi tương tác, chỉ chấp nhận cờ --yes tường minh (không nhận biến môi trường STAGING_ASSUME_YES) để tránh chạy nhầm.
  [[ "$STG_YES" == "1" ]] \
    || die "restore-dump XÓA DB 'realestate' của $STG_MONGO (staging) rồi nạp lại từ dump: bắt buộc thêm --yes."
  prepare_env   # gồm guard_environment: từ chối tên/cổng/Docker từ xa không phải staging, TRƯỚC mọi lệnh đụng Docker
  archive="$(resolve_dump_archive "$archive")"
  need_docker; preflight_config
  # Phòng thủ thêm: container Mongo đích (nếu đã có) phải thuộc project compose staging.
  local proj
  proj="$(inspect_field "$STG_MONGO" '{{index .Config.Labels "com.docker.compose.project"}}' none)"
  [[ "$proj" == "none" || "$proj" == "$STG_PROJECT" ]] || die "Từ chối: container $STG_MONGO thuộc project '$proj', không phải $STG_PROJECT."
  log "Khởi động $STG_MONGO (nếu chưa chạy) ..."
  compose up -d mongo
  wait_mongo_healthy
  proj="$(inspect_field "$STG_MONGO" '{{index .Config.Labels "com.docker.compose.project"}}' none)"
  [[ "$proj" == "$STG_PROJECT" ]] || die "Từ chối: container $STG_MONGO thuộc project '$proj', không phải $STG_PROJECT."
  # Kiểm nội dung archive bằng mongorestore --dryRun (KHÔNG ghi gì; chỉ liệt kê namespace) TRƯỚC khi xóa DB: archive hỏng thì dừng, DB còn nguyên.
  verify_backup_archive "$archive" "$STG_MONGO" || die "Archive không đạt kiểm tra nội dung: không xóa gì."
  log "Xóa DB 'realestate' của $STG_MONGO (staging) rồi nạp từ $archive ..."
  # Xóa hẳn DB trước: --drop của mongorestore chỉ xóa collection CÓ trong dump, collection/doc `system` còn sót từ lần deploy staging trước sẽ
  # làm sai kết quả diễn tập (sổ migration "đã chạy" giả). Chỉ đụng DB `realestate`, không đụng `admin` (user root).
  stg_mongosh_stdin <<'JS'
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
db.getSiblingDB('realestate').dropDatabase();
print('DROPPED realestate');
JS
  # --nsInclude "realestate.*": dù dump có chứa DB khác (vd admin, user root) cũng chỉ nạp realestate. Mật khẩu qua pipe trong container.
  # shellcheck disable=SC2016  # biến phải được mở rộng BÊN TRONG container, nên dùng nháy đơn có chủ ý
  local restore_cmd='mongorestore --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --drop --gzip --archive --nsInclude "realestate.*"'
  docker exec -i "$STG_MONGO" bash -c "$restore_cmd" < "$archive"
  log "Đã nạp dump vào $STG_MONGO. Tiếp: bash scripts/staging.sh snapshot truoc  (rồi theo scripts/staging/REHEARSAL.md bước 2 trở đi)."
}

# ── snapshot (CHỈ ĐỌC) ───────────────────────────────────────────────────────
cmd_snapshot() {
  local label="${1:-snapshot}"
  [[ "$label" =~ ^[A-Za-z0-9._-]{1,40}$ ]] || die "Nhãn snapshot chỉ gồm chữ/số/._- (tối đa 40 ký tự)."
  prepare_env; need_docker; preflight_config
  [[ "$(inspect_field "$STG_MONGO" '{{.State.Running}}' false)" == "true" ]] || die "$STG_MONGO chưa chạy (chạy restore-dump hoặc deploy trước)."
  local out ts
  ts="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$STG_DIR/snapshots"
  out="$STG_DIR/snapshots/${label}-${ts}.json"
  ( umask 077; stg_mongosh_stdin < scripts/staging/rehearsal-snapshot.js > "$out" ) || { rm -f "$out"; die "Chụp snapshot thất bại."; }
  cat "$out"
  log "Đã lưu $out (chỉ số đếm/index/sổ system, không có dữ liệu cá nhân). So sánh: diff <trước> <sau>."
}

# ── runner / step3 (phục vụ diễn tập thủ công, scripts/staging/REHEARSAL.md) ──
cmd_runner() {
  [[ $# -gt 0 ]] || die "Thiếu lệnh runner. Vd: bash scripts/staging.sh runner status"
  prepare_env; need_docker; preflight_config
  compose run --rm --no-deps -T backend node dist/migrations/cli.js "$@"
}

cmd_step3() {
  prepare_env; need_docker; preflight_config
  [[ "$(inspect_field "$STG_MONGO" '{{.State.Running}}' false)" == "true" ]] || die "$STG_MONGO chưa chạy (chạy restore-dump trước)."
  stg_mongosh_stdin < scripts/staging/rehearsal-step3.js
}

# ── deploy ───────────────────────────────────────────────────────────────────
cmd_deploy() {
  local pull=0 a
  local -a args=()
  for a in "$@"; do
    if [[ "$a" == "--pull" ]]; then pull=1; else args+=("$a"); fi
  done
  prepare_env; need_docker; preflight_config
  (( pull == 1 )) || args=(--no-pull "${args[@]+"${args[@]}"}")
  log "bash deploy.sh ${args[*]}  (project $STG_PROJECT, backend http://127.0.0.1:${STAGING_BACKEND_PORT})"
  local rc=0
  bash deploy.sh "${args[@]}" || rc=$?
  log "deploy.sh thoát mã $rc"
  return "$rc"
}

# ── status ───────────────────────────────────────────────────────────────────
cmd_status() {
  prepare_env; need_docker; preflight_config
  compose ps -a
  if [[ "$(inspect_field "$STG_MONGO" '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')" == "healthy" ]] \
     && docker image inspect "${STG_IMAGE_PREFIX}backend:latest" >/dev/null 2>&1; then
    local rc=0
    echo "--- runner migration status:"
    compose run --rm --no-deps -T backend node dist/migrations/cli.js status || rc=$?
    log "runner status thoát mã $rc"
    return "$rc"
  fi
  log "Mongo chưa healthy hoặc chưa có image backend staging: bỏ qua runner status."
}

# ── down / reset ─────────────────────────────────────────────────────────────
cmd_down() {
  prepare_env; need_docker; preflight_config
  compose down --remove-orphans
  log "Đã gỡ container staging (volume/dữ liệu GIỮ nguyên). Xóa dữ liệu: reset."
}

cmd_reset() {
  local images=0 a
  for a in "$@"; do
    case "$a" in --images) images=1 ;; --yes|-y) STG_YES=1 ;; esac
  done
  prepare_env; need_docker; preflight_config
  local what="container + volume Mongo/Redis/MinIO"
  (( images == 0 )) || what="$what + image staging"
  confirm "XÓA TOÀN BỘ dữ liệu staging ($what) của project $STG_PROJECT. Không ảnh hưởng dev/prod. Tiếp tục?"
  compose down -v --remove-orphans
  rm -rf "${STG_DIR:?}/logs" "${STG_DIR:?}/backups"
  mkdir -p "$STG_DIR/logs" "$STG_DIR/backups"
  if (( images == 1 )); then
    local ref
    while IFS= read -r ref; do
      [[ "$ref" == "${STG_IMAGE_PREFIX}"* ]] && { docker rmi "$ref" >/dev/null 2>&1 && log "Đã xóa image $ref"; }
    done < <(docker images --format '{{.Repository}}:{{.Tag}}')
  fi
  log "Staging đã về trống. Bí mật $STG_ENV giữ nguyên (dùng lại được). Cài mới: deploy."
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    init) cmd_init "$@" ;;
    seed-prod102) cmd_seed "$@" ;;
    restore-dump) cmd_restore_dump "$@" ;;
    snapshot) cmd_snapshot "$@" ;;
    runner) cmd_runner "$@" ;;
    step3) cmd_step3 "$@" ;;
    deploy) cmd_deploy "$@" ;;
    status) cmd_status "$@" ;;
    down) cmd_down "$@" ;;
    reset) cmd_reset "$@" ;;
    help|-h|--help) usage ;;
    *) printf '[staging] Lệnh không hợp lệ: %s\n\n' "$cmd" >&2; usage >&2; exit 2 ;;
  esac
}

main "$@"
