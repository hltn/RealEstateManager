#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — cập nhật stack production ĐANG CHẠY ổn định lên commit mới nhất của nhánh `production`.
#
# Chạy ở máy chủ (Ubuntu 24.04), trong thư mục repo:   bash deploy.sh [--no-pull] [--migrate] [--help]
# (Dùng `bash deploy.sh`, không phụ thuộc bit thực thi: commit từ Windows có thể làm mất bit này.)
# Tài liệu: docs/01_Infrastructure/06_Production_Deploy.md (mục 11). Chạy trong tmux/nohup để rớt SSH không làm
# gián đoạn giữa chừng.
#
# KHÔNG phải công cụ nâng cấp standalone lần đầu (Mongo cũ không xác thực -> replica set + auth):
# lần đó làm theo mục 5 của tài liệu, từng bước bằng tay. Script này từ chối chạy nếu thấy Mongo cũ.
#
# Các bước: tiền điều kiện (+ dung lượng đĩa) -> git pull (ff-only) -> `compose config -q` -> kiểm tra migration 005
# -> chuẩn bị logs/ -> mongodump ra ./backups (kiểm cả nội dung) -> gắn thẻ image backend hiện tại làm bản dự phòng
# -> build backend (kèm GIT_COMMIT) -> `status` của runner migration (PT-027): còn migration chờ thì DỪNG trước `up` và
# in lệnh, có cờ --migrate thì `up --apply` ngay sau backup -> `up -d --build` -> chờ mongo healthy + backend liveness.
#
# KHÔNG rollback bằng `git checkout`: khi dữ liệu Mongo đã được nâng cấp (replica set/auth, migration),
# compose và code cũ không đọc được volume mới, nên quay code về commit cũ có thể làm hỏng thêm.
# Khi lỗi, script chỉ IN hướng dẫn (log, image dự phòng, mục 5.8 khi dữ liệu đã đổi) rồi thoát mã khác 0.
#
# Bí mật: script KHÔNG chứa bí mật. Mọi lệnh compose kèm `--env-file .env.docker`. Mật khẩu root Mongo chỉ được đọc
# từ biến môi trường BÊN TRONG container và đưa cho mongodump/mongorestore qua pipe (không nằm trên dòng lệnh, không
# ghi ra đĩa, không in ra màn hình/log). Healthcheck Mongo của compose cũng xác thực trong script mongosh (PT-002),
# không có `-p` trên dòng lệnh. Runner migration nhận MONGODB_URI từ môi trường của container backend (compose dựng).
#
# Biến môi trường tùy chọn (không bí mật):
#   MONGO_TIMEOUT       giây chờ mongo healthy           (mặc định 120)
#   HEALTH_TIMEOUT      giây chờ backend liveness        (mặc định 120)
#   HEALTH_URL          URL liveness (qua nginx cổng 80) (mặc định http://localhost/api/v1/health/liveness)
#   DEPLOY_MIN_FREE_GB  dung lượng trống tối thiểu (GB) ở thư mục repo và thư mục dữ liệu Docker (mặc định 5: build backend + frontend
#                       cần image + build cache vài GB)
#   DUMP_TIMEOUT        giây tối đa cho mongodump (mặc định 900); OPS_EXEC_TIMEOUT giây tối đa cho bước kiểm nội dung backup (mặc định 300)
#   MONGO_CONTAINER, BACKEND_CONTAINER  tên container (mặc định realestate_mongo, realestate_backend; chỉ đổi khi thử nghiệm)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="deploy"
# Resolve symlink bằng `readlink -f` (GNU coreutils, có trên Ubuntu): gọi qua symlink vẫn tìm đúng thư mục repo.
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[deploy] LỖI: không resolve được đường dẫn thật của deploy.sh (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")" && pwd)"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

readonly PROD_BRANCH="production"
readonly ENV_FILE=".env.docker"
readonly MONGO_CONTAINER="${MONGO_CONTAINER:-realestate_mongo}"
readonly BACKEND_CONTAINER="${BACKEND_CONTAINER:-realestate_backend}"
readonly DEFAULT_PROJECT="realestatemanager"   # tên project compose = tên thư mục repo (không đổi, xem docker-compose.yml)
readonly DOC="docs/01_Infrastructure/06_Production_Deploy.md"

MONGO_TIMEOUT="${MONGO_TIMEOUT:-120}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
HEALTH_URL="${HEALTH_URL:-http://localhost/api/v1/health/liveness}"
DEPLOY_MIN_FREE_GB="${DEPLOY_MIN_FREE_GB:-5}"
DUMP_TIMEOUT="${DUMP_TIMEOUT:-900}"

NO_PULL=0
TS="$(date +%Y%m%d-%H%M%S)"
OLD_COMMIT=""
NEW_COMMIT=""
BACKUP_FILE=""
PREV_IMAGE_TAG=""
PREV_IMAGE_REPO=""
STACK_TOUCHED=0   # =1 ngay trước `up` (hoặc trước `up --apply` của migration): từ đây stack/dữ liệu có thể đã bị thay đổi
MIGRATE=0         # =1 khi có --migrate: tự chạy migration chờ (up --apply) sau backup
MIGRATION_GATE_RAN=0   # =1 khi đã đọc được trạng thái migration (Mongo healthy): chỉ khi đó mới ghi phiên bản sau deploy

usage() {
  cat <<'EOF'
Cách dùng: bash deploy.sh [--no-pull] [--migrate] [--help]

Cập nhật stack production đang chạy lên bản mới nhất của nhánh `production`.

  --no-pull   Không git pull; build và deploy đúng commit đang checkout.
  --migrate   Có migration chờ (collection `system`, runner trong image backend) thì tự `up --apply` SAU backup, TRƯỚC `up`.
              Không có cờ này: còn migration chờ thì script DỪNG trước `up` (stack không đổi) và in lệnh để chạy tay.
  -h, --help  Hiện trợ giúp này.

Điều kiện: chạy trong thư mục repo; có .env.docker với quyền không rộng hơn 600 (chmod 600 .env.docker) và đã điền
hết giá trị mẫu <...>; đủ dung lượng đĩa (DEPLOY_MIN_FREE_GB, mặc định 5 GB); working tree sạch (với git pull);
đang ở nhánh production; chạy trong tmux/nohup.

Script làm: git pull --ff-only -> docker compose config -q -> kiểm tra không còn user chưa migrate 005
-> mongodump ra ./backups (bắt buộc > 0 byte, gzip hợp lệ, có realestate.users) -> gắn thẻ image backend hiện tại thành
<project>-backend:pre-<thời-gian> -> build backend (ghi GIT_COMMIT vào image) -> runner migration `status` (dừng nếu còn
migration chờ và không có --migrate; cần `baseline` một lần thì dừng và in lệnh) -> up -d --build -> chờ mongo healthy và
backend liveness -> ghi phiên bản vào collection `system`.

KHÔNG dùng cho lần nâng cấp standalone đầu tiên (xem mục 5 tài liệu). KHÔNG rollback bằng git checkout.
Biến tùy chọn: MONGO_TIMEOUT, HEALTH_TIMEOUT (giây, mặc định 120), HEALTH_URL, DEPLOY_MIN_FREE_GB, DUMP_TIMEOUT.
EOF
}

# Mọi lệnh compose đều kèm --env-file (thiếu là biến ${...} bắt buộc báo lỗi hoặc mật khẩu bị rỗng).
compose() { docker compose --env-file "$ENV_FILE" "$@"; }

# In hướng dẫn xử lý khi thất bại SAU KHI stack có thể đã bị thay đổi. Không rollback tự động.
print_recovery() {
  {
    echo
    echo "════════════ DEPLOY THẤT BẠI — script KHÔNG tự rollback ════════════"
    echo "Commit trước deploy: ${OLD_COMMIT:-?}  |  commit đang checkout: ${NEW_COMMIT:-?}"
    [[ -n "$BACKUP_FILE" ]] && echo "Backup Mongo trước deploy: $BACKUP_FILE"
    echo
    echo "1) Xem nguyên nhân:"
    echo "     docker compose --env-file $ENV_FILE ps -a"
    echo "     docker compose --env-file $ENV_FILE logs --tail 100 backend"
    echo "     docker compose --env-file $ENV_FILE logs --tail 50 mongo"
    echo
    if [[ -n "$PREV_IMAGE_TAG" ]]; then
      echo "2) Chỉ khi dữ liệu Mongo CHƯA bị đổi (chưa chạy migration --apply, chưa nâng cấp Mongo) mới được dùng lại"
      echo "   image backend cũ đã gắn thẻ:"
      echo "     docker tag $PREV_IMAGE_TAG ${PREV_IMAGE_REPO}:latest"
      echo "     docker compose --env-file $ENV_FILE up -d --no-build --no-deps backend"
    else
      echo "2) Không có image backend dự phòng (lần deploy đầu, chưa có container backend)."
    fi
    echo
    echo "3) Nếu dữ liệu ĐÃ đổi (migration 005/006, nâng cấp Mongo...): KHÔNG quay về code/image cũ, bản cũ có thể"
    echo "   không đọc được dữ liệu mới. Với deploy thường lệ (lâu sau lần nâng cấp standalone) CHỈ dùng mongorestore"
    echo "   từ file deploy-pre-* ($DOC mục 6, luôn kèm --nsInclude 'realestate.*'). Mục 5.8 (khôi phục volume) chỉ dành"
    echo "   cho sự cố NGAY sau lần nâng cấp standalone: nó đưa cả DB về ngày nâng cấp, mất mọi dữ liệu phát sinh sau đó."
    echo "   Không dùng 'docker compose down -v' (xóa vĩnh viễn dữ liệu)."
  } >&2
}

on_exit() {
  local code=$?
  trap - EXIT
  if (( code != 0 )); then
    if (( STACK_TOUCHED == 1 )); then
      print_recovery
    else
      warn "Dừng TRƯỚC khi đụng tới stack đang chạy (stack không đổi). Commit trước: ${OLD_COMMIT:-?}, hiện tại: ${NEW_COMMIT:-?}."
    fi
  fi
  exit "$code"
}
trap on_exit EXIT

# ── 1) Tiền điều kiện ────────────────────────────────────────────────────────
check_prereqs() {
  local cmd
  for cmd in docker curl gzip; do
    command -v "$cmd" >/dev/null 2>&1 || die "Thiếu lệnh '$cmd'."
  done
  (( NO_PULL == 1 )) || command -v git >/dev/null 2>&1 || die "Thiếu lệnh 'git'."
  docker compose version >/dev/null 2>&1 || die "Thiếu 'docker compose' (plugin v2)."
  docker info >/dev/null 2>&1 || die "Không nói chuyện được với Docker daemon (daemon chưa chạy, hoặc user thiếu quyền: thêm vào nhóm 'docker')."

  # .env.docker chứa mật khẩu Mongo/Redis/MinIO, token Cloudflare...: quyền rộng hơn 600 là dừng.
  require_private_file "$ENV_FILE"
  require_no_placeholders "$ENV_FILE"

  # backend bind-mount ./.env; thiếu thì Docker tự tạo THƯ MỤC .env làm backend lỗi.
  if [[ -d .env ]]; then
    die "./.env là THƯ MỤC (Docker tự tạo khi file thiếu). Xóa nó (rmdir .env), rồi 'touch .env'."
  fi
  [[ -e .env ]] || { touch .env; log "Đã tạo ./.env rỗng (backend bind-mount file này)."; }
}

# Khóa chống hai lần deploy chạy chồng nhau. Đặt trong .git (không hiện ở git status, không phải file repo).
acquire_lock() {
  [[ -d .git ]] || return 0
  command -v flock >/dev/null 2>&1 || { warn "Không có 'flock': bỏ qua khóa chống chạy chồng."; return 0; }
  exec 9>".git/realestate-deploy.lock"
  flock -n 9 || die "Một lần deploy khác đang chạy (khóa .git/realestate-deploy.lock)."
}

# ── 2) Git ───────────────────────────────────────────────────────────────────
git_update() {
  if (( NO_PULL == 1 )); then
    if [[ -d .git ]]; then OLD_COMMIT="$(git rev-parse --short HEAD)"; NEW_COMMIT="$OLD_COMMIT"; fi
    log "--no-pull: bỏ qua git pull${NEW_COMMIT:+, deploy commit hiện tại $NEW_COMMIT}."
    return 0
  fi
  [[ -d .git ]] || die "Không phải git repo (dùng --no-pull nếu cố ý)."

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$branch" == "$PROD_BRANCH" ]] || die "Đang ở '$branch' (HEAD detached nếu in 'HEAD'), cần nhánh '$PROD_BRANCH'. Script không tự đổi nhánh: xử lý theo $DOC mục 5.0a (git fetch origin && git checkout $PROD_BRANCH)."

  # File chưa theo dõi (logs/, backups/...) không tính; chỉ chặn khi file đã theo dõi bị sửa.
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    git status --short --untracked-files=no >&2
    die "Working tree có thay đổi chưa commit (vd docker-compose.yml sửa tay). Không pull để tránh ghi đè/xung đột. Xử lý theo $DOC mục 5.0a (lưu bản sửa tay ra NGOÀI repo với quyền 600 rồi git checkout -- <file>; KHÔNG git stash vì mật khẩu sẽ nằm lại trong .git), rồi chạy lại."
  fi

  OLD_COMMIT="$(git rev-parse --short HEAD)"
  log "Commit hiện tại: $OLD_COMMIT. Đang git pull --ff-only origin $PROD_BRANCH ..."
  git pull --ff-only origin "$PROD_BRANCH"
  NEW_COMMIT="$(git rev-parse --short HEAD)"
  if [[ "$OLD_COMMIT" == "$NEW_COMMIT" ]]; then
    log "Không có commit mới (vẫn $NEW_COMMIT); tiếp tục build/up (idempotent)."
  else
    log "Đã cập nhật $OLD_COMMIT -> $NEW_COMMIT."
  fi
}

# ── 3) Kiểm tra cú pháp + biến bắt buộc của compose (chưa đụng stack) ────────
check_compose() {
  log "Kiểm tra docker compose config (cú pháp + biến bắt buộc)..."
  compose config -q || die "docker compose config lỗi: thiếu/sai biến trong $ENV_FILE (đối chiếu .env.docker.example). Stack chưa bị đổi."
  check_credential_pair MONGO_APP_USERNAME MONGO_APP_PASSWORD
  check_credential_pair S3_APP_ACCESS_KEY_ID S3_APP_SECRET_ACCESS_KEY
}

# Cặp thông tin đăng nhập tùy chọn (PT-016) phải đặt CẢ HAI hoặc KHÔNG đặt: compose ghép từng biến với giá trị dự phòng
# riêng (`${A:-root}`), nên đặt lệch một nửa sẽ tạo cặp user-app + mật khẩu-root và backend xác thực lỗi khi khởi động.
# Chỉ kiểm có/không (không đọc giá trị ra màn hình).
check_credential_pair() {
  local first="$1" second="$2" has_first=0 has_second=0
  grep -qE "^${first}=[^[:space:]]" "$ENV_FILE" && has_first=1
  grep -qE "^${second}=[^[:space:]]" "$ENV_FILE" && has_second=1
  (( has_first == has_second )) || die "$ENV_FILE đặt $first và $second lệch nhau (chỉ một trong hai có giá trị). Đặt cả hai hoặc xóa cả hai. Stack chưa bị đổi."
}

# ── 3b) Cổng migration 005: code mới không khởi động nếu còn user chưa có roles[]/teamIds[] ──
# Đếm CHỈ ĐỌC bằng cùng bộ lọc với UserRolesMigrationGuard. Không đếm được thì cảnh báo, không chặn.
check_users_migrated() {
  local health out pending js
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$MONGO_CONTAINER" 2>/dev/null || echo missing)"
  if [[ "$health" != "healthy" ]]; then
    warn "Mongo không ở trạng thái healthy ($health): bỏ qua kiểm tra migration 005."
    return 0
  fi
  # Mật khẩu root xác thực TRONG script (đọc biến môi trường container), không đưa lên dòng lệnh.
  read -r -d '' js <<'EOF' || true
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const pending = db.getSiblingDB('realestate').users.countDocuments({ $or: [
  { roles: { $not: { $type: 'array' } } }, { roles: { $size: 0 } }, { teamIds: { $not: { $type: 'array' } } } ] });
print('PENDING_USERS=' + pending);
EOF
  if ! out="$(docker exec -i "$MONGO_CONTAINER" mongosh --quiet --norc --file /dev/stdin <<<"$js" 2>&1)"; then
    warn "Không đếm được user chưa migrate 005 (mongosh lỗi): bỏ qua kiểm tra này. Nếu backend mới crash-loop, xem UserRolesMigrationGuard ($DOC mục 5.4a)."
    return 0
  fi
  pending="$(grep -oE 'PENDING_USERS=[0-9]+' <<<"$out" | tail -n 1 | cut -d= -f2 || true)"
  if [[ -z "$pending" ]]; then
    warn "Không đọc được kết quả đếm user chưa migrate 005: bỏ qua kiểm tra này."
    return 0
  fi
  if (( pending > 0 )); then
    die "Còn $pending tài khoản chưa migrate 005 (roles[]/teamIds[]). Backend mới sẽ KHÔNG khởi động (UserRolesMigrationGuard). Chạy trước: bash scripts/run-migration.sh 005 (dry-run), rồi backup và bash scripts/run-migration.sh 005 --apply, sau đó chạy lại deploy (khuyến nghị 'bash deploy.sh --no-pull' nếu đã pull). Xem $DOC mục 5.4a."
  fi
  log "Không còn user chưa migrate 005."
}

# ── 4) logs/: backend chạy USER node (uid 1000) cần quyền ghi ────────────────
# docker-compose.yml chỉ bind-mount ./logs (không mount ./tmp; tmp nằm trong image), nên chỉ chuẩn bị logs/.
ensure_runtime_dirs() {
  mkdir -p logs
  local need=0 stray
  [[ "$(stat -c '%u' logs)" == "1000" ]] || need=1
  stray="$(find logs ! -uid 1000 -print -quit)"
  [[ -z "$stray" ]] || need=1
  (( need == 1 )) || return 0

  log "logs/ chưa thuộc uid 1000 (backend cần ghi); đang chown..."
  if [[ "$(id -u)" == "0" ]]; then
    chown -R 1000:1000 logs
  elif chown -R 1000:1000 logs 2>/dev/null; then
    :   # user hiện tại chính là uid 1000 (vd user đầu tiên trên Ubuntu): chown về chính mình thành công
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -n chown -R 1000:1000 logs
  else
    die "Không chown được logs/ (không có sudo không mật khẩu). Chạy rồi chạy lại script:  sudo chown -R 1000:1000 \"$PWD/logs\""
  fi
}

# ── 5) Backup Mongo (bắt buộc trước khi up) ──────────────────────────────────
backup_mongo() {
  local state
  state="$(docker inspect -f '{{.State.Status}}' "$MONGO_CONTAINER" 2>/dev/null || true)"
  if [[ -z "$state" ]]; then
    warn "Chưa có container $MONGO_CONTAINER (triển khai mới?): bỏ qua mongodump vì chưa có dữ liệu để sao lưu."
    return 0
  fi
  [[ "$state" == "running" ]] || die "Container $MONGO_CONTAINER ở trạng thái '$state'. Khởi động nó trước (docker compose --env-file $ENV_FILE up -d mongo) để sao lưu được; không deploy khi không có backup."

  # Mongo cũ standalone (không xác thực) không có biến root: đó là việc của mục 5, không phải của deploy.sh.
  docker exec "$MONGO_CONTAINER" sh -c 'test -n "$MONGO_INITDB_ROOT_USERNAME" && test -n "$MONGO_INITDB_ROOT_PASSWORD"' \
    || die "Mongo đang chạy cấu hình cũ (không có user root/xác thực). deploy.sh KHÔNG dùng để nâng cấp standalone: làm theo $DOC mục 5."

  install -d -m 700 backups
  local out="backups/deploy-pre-${TS}.archive.gz"
  local part="${out}.partial"
  log "mongodump DB realestate -> $out ..."
  # Mật khẩu: đọc từ biến môi trường BÊN TRONG container, đưa cho mongodump qua pipe `--config <(...)` (không có trên dòng
  # lệnh, không ghi ra đĩa). --archive không tên = ghi ra stdout, chuyển thẳng vào file quyền 600 trên host.
  # shellcheck disable=SC2016  # biến phải được mở rộng BÊN TRONG container, nên dùng nháy đơn có chủ ý
  local dump_cmd='mongodump --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --db realestate --archive --gzip'
  local dump_rc=0
  ( umask 077; timeout "$DUMP_TIMEOUT" docker exec "$MONGO_CONTAINER" bash -c "$dump_cmd" > "$part" ) || dump_rc=$?
  if (( dump_rc != 0 )); then
    rm -f "$part"
    if (( dump_rc == 124 )); then
      die "mongodump quá ${DUMP_TIMEOUT}s (Mongo quá tải/treo?). Tăng DUMP_TIMEOUT nếu DB lớn. Không deploy khi không có backup."
    fi
    die "mongodump thất bại (mã $dump_rc). Không deploy khi không có backup."
  fi
  # Kiểm cả nội dung (không chỉ định dạng): > 0 byte, gzip hợp lệ, mongorestore --dryRun thấy realestate.users.
  if ! verify_backup_archive "$part" "$MONGO_CONTAINER"; then
    rm -f "$part"
    die "Backup vừa tạo không đạt kiểm tra nội dung. Không deploy."
  fi
  mv "$part" "$out"
  BACKUP_FILE="$out"
  ls -l "$out"
  log "Backup OK (đã kiểm nội dung). Hãy chép nó ra NGOÀI máy chủ (scp/rclone); backup nằm cùng ổ đĩa không phải backup thật."
}

# ── 6) Gắn thẻ image backend đang chạy làm bản dự phòng ──────────────────────
tag_current_backend_image() {
  local image_id project
  image_id="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
  if [[ -z "$image_id" ]]; then
    log "Chưa có container $BACKEND_CONTAINER: không có image để dự phòng."
    return 0
  fi
  project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
  [[ -n "$project" ]] || project="$DEFAULT_PROJECT"
  PREV_IMAGE_REPO="${project}-backend"
  PREV_IMAGE_TAG="${PREV_IMAGE_REPO}:pre-${TS}"
  docker tag "$image_id" "$PREV_IMAGE_TAG"
  log "Đã gắn thẻ image backend hiện tại: $PREV_IMAGE_TAG"
}

# ── 6b) Build backend + kiểm tra migration chờ (PT-027) ──────────────────────
# Runner nằm TRONG image backend (dist/migrations/cli.js, không cần ts-node) nên chạy bằng `compose run --rm --no-deps
# backend`: dùng image vừa build, MONGODB_URI do compose dựng (mật khẩu không nằm trên dòng lệnh host), cùng network
# với mongo. `-T` tắt TTY để chạy được trong nohup/tmux. Mã thoát của runner: 0 ok | 1 lỗi | 3 đang có khóa | 4 cần baseline.
run_migration_cli() { compose run --rm --no-deps -T backend node dist/migrations/cli.js "$@"; }

mongo_is_healthy() {
  [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$MONGO_CONTAINER" 2>/dev/null || echo missing)" == "healthy" ]]
}

# Build image backend MỚI (gắn GIT_COMMIT). Chưa đụng stack đang chạy: container cũ giữ image cũ theo ID; thẻ :latest
# bị ghi đè nhưng bản cũ đã gắn thẻ pre-<thời-gian> ở bước 6.
build_backend() {
  log "docker compose build backend (GIT_COMMIT=${GIT_COMMIT:-unknown}) ..."
  compose build backend
}

# Đọc `status --json` (chỉ đọc). Còn migration chờ: không có --migrate thì DỪNG (stack không đổi) và in lệnh; có --migrate
# thì đặt STACK_TOUCHED=1 rồi `up --apply`. Cần baseline hoặc đang có khóa: dừng và in lệnh. Không đọc được trạng thái:
# dừng (không đoán), vì deploy mù với migration là rủi ro lớn hơn một lần chạy lại.
migration_gate() {
  local cli="docker compose --env-file $ENV_FILE run --rm --no-deps backend node dist/migrations/cli.js"
  if ! mongo_is_healthy; then
    # Container Mongo ĐÃ TỒN TẠI mà không healthy (đang khởi động, mất primary...): không đoán, không deploy mù với
    # migration (backup_mongo đã bắt buộc nó đang chạy). Chỉ khi chưa có container (triển khai mới) mới bỏ qua.
    if docker inspect "$MONGO_CONTAINER" >/dev/null 2>&1; then
      die "Mongo ($MONGO_CONTAINER) đang chạy nhưng chưa healthy: không đọc được trạng thái migration. Chờ nó healthy (docker compose --env-file $ENV_FILE ps) rồi chạy lại. Stack chưa bị đổi."
    fi
    warn "Chưa có container $MONGO_CONTAINER (triển khai mới?): bỏ qua kiểm tra migration. Sau khi stack lên, xem: $cli status"
    (( MIGRATE == 0 )) || warn "--migrate bị bỏ qua vì chưa có Mongo lúc này."
    return 0
  fi

  log "Kiểm tra migration chờ (runner: status, chỉ đọc) ..."
  local out rc=0 json ids
  out="$(run_migration_cli status --json 2>&1)" || rc=$?
  case "$rc" in
    0) ;;
    3)
      printf '%s\n' "$out" >&2
      die "Runner migration báo đang có KHÓA (có runner khác đang chạy, hoặc tiến trình chết để lại khóa). Chắc chắn không còn runner nào chạy rồi gỡ: $cli unlock . Stack chưa bị đổi."
      ;;
    4)
      printf '%s\n' "$out" >&2
      {
        echo "Collection \`system\` chưa có phiên bản nhưng DB đã có dữ liệu: cần chạy \`baseline\` MỘT LẦN (ghi sổ 002..006 đã áp dụng, không chạy lại)."
        echo "  Dry-run:  $cli baseline --version <x.y.z> --commit <sha>"
        echo "  Ghi thật: $cli baseline --apply --version <x.y.z> --commit <sha>"
        echo "Làm đúng thứ tự ở $DOC mục 11.1 (kiểm chỉ-đọc 005/006, backup, dry-run, rồi baseline), sau đó chạy lại: bash deploy.sh --no-pull"
      } >&2
      die "Cần baseline. Stack chưa bị đổi."
      ;;
    *)
      printf '%s\n' "$out" >&2
      die "Không đọc được trạng thái migration (mã $rc; xem output ở trên: kết nối Mongo, image backend thiếu dist/migrations/cli.js?). Stack chưa bị đổi."
      ;;
  esac

  json="$(grep -m1 '^{' <<<"$out" || true)"
  if [[ -z "$json" ]]; then
    printf '%s\n' "$out" >&2
    die "Runner không trả JSON trạng thái. Stack chưa bị đổi."
  fi
  MIGRATION_GATE_RAN=1

  # JSON.stringify không có khoảng trắng: danh sách rỗng là đúng chuỗi "pending":[]
  if grep -q '"pending":\[\]' <<<"$json"; then
    log "Không có migration chờ."
    return 0
  fi
  ids="$(grep -oE '"pending":\[.*\]' <<<"$json" | grep -oE '"id":"[^"]+"' | cut -d'"' -f4 | paste -sd ' ' - || true)"
  warn "Có migration chờ: ${ids:-?}"

  if (( MIGRATE == 0 )); then
    {
      echo
      echo "════════════ DỪNG TRƯỚC KHI CẬP NHẬT: còn migration chờ (${ids:-?}) ════════════"
      echo "Đã backup: ${BACKUP_FILE:-không có}. Stack đang chạy CHƯA bị đổi (image backend mới đã build nhưng chưa chạy)."
      echo "Chọn một cách:"
      echo "  A) Tự động:  bash deploy.sh --no-pull --migrate     (backup mới -> up --apply -> up)"
      echo "  B) Bằng tay: $cli up            # dry-run, đọc kỹ"
      echo "               $cli up --apply --by cli"
      echo "               rồi: bash deploy.sh --no-pull"
      echo "Chi tiết: $DOC mục 11.1."
    } >&2
    exit 1
  fi

  [[ -n "$BACKUP_FILE" ]] || die "--migrate cần backup Mongo vừa tạo ở bước trước (BACKUP_FILE rỗng). Dừng, chưa chạy migration."
  # Từ đây dữ liệu có thể đổi: lỗi sau điểm này in hướng dẫn "không quay code cũ" (print_recovery).
  STACK_TOUCHED=1
  log "--migrate: chạy up --apply (backup: $BACKUP_FILE) ..."
  if ! run_migration_cli up --apply --by deploy; then
    die "Migration thất bại, runner đã dừng (không chạy migration sau, không ghi sổ cho migration lỗi, không tự rollback). Dữ liệu có thể đã đổi MỘT PHẦN. Xem: $cli status . Sửa nguyên nhân rồi chạy lại; KHÔNG quay về code cũ."
  fi
  log "Migration xong."
}

# Sau khi backend sống: ghi phiên bản app vào collection `system` (nếu chưa khớp). Không có migration chờ nên chỉ ghi `version`.
# Không làm deploy thất bại: lỗi chỉ cảnh báo (backend vẫn chạy bình thường).
sync_system_version() {
  (( MIGRATION_GATE_RAN == 1 )) || { log "Bỏ qua ghi phiên bản vào \`system\` (chưa đọc được trạng thái migration trước deploy)."; return 0; }
  mongo_is_healthy || return 0
  if ! run_migration_cli up --apply --by deploy; then
    warn "Không ghi được phiên bản vào collection \`system\` (backend vẫn chạy). Ghi lại sau: docker compose --env-file $ENV_FILE run --rm --no-deps backend node dist/migrations/cli.js up --apply --by cli"
  fi
}

# ── 7) Chờ healthy ───────────────────────────────────────────────────────────
wait_mongo_healthy() {
  log "Chờ $MONGO_CONTAINER healthy (tối đa ${MONGO_TIMEOUT}s)..."
  local status
  SECONDS=0
  while (( SECONDS < MONGO_TIMEOUT )); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$MONGO_CONTAINER" 2>/dev/null || echo missing)"
    if [[ "$status" == "healthy" ]]; then log "Mongo healthy."; return 0; fi
    sleep 3
  done
  die "Mongo chưa healthy sau ${MONGO_TIMEOUT}s (trạng thái cuối: ${status:-?})."
}

wait_backend_liveness() {
  log "Chờ backend liveness $HEALTH_URL (tối đa ${HEALTH_TIMEOUT}s)..."
  local state
  SECONDS=0
  while (( SECONDS < HEALTH_TIMEOUT )); do
    if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL" 2>/dev/null; then
      log "Backend liveness OK sau ~${SECONDS}s."
      return 0
    fi
    state="$(docker inspect -f '{{.State.Status}}' "$BACKEND_CONTAINER" 2>/dev/null || echo missing)"
    if [[ "$state" == "exited" || "$state" == "dead" || "$state" == "missing" ]]; then
      die "Container backend ở trạng thái '$state' (không chạy)."
    fi
    sleep 3
  done
  die "Backend không trả liveness 200 sau ${HEALTH_TIMEOUT}s."
}

# ── Chạy ─────────────────────────────────────────────────────────────────────
main() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --no-pull) NO_PULL=1 ;;
      --migrate) MIGRATE=1 ;;
      -h|--help) trap - EXIT; usage; exit 0 ;;
      *) trap - EXIT; printf '[deploy] Tham số không hợp lệ: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
    esac
  done

  [[ "$MONGO_TIMEOUT" =~ ^[0-9]+$ ]]  || die "MONGO_TIMEOUT phải là số nguyên (giây)."
  [[ "$HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || die "HEALTH_TIMEOUT phải là số nguyên (giây)."
  [[ "$DUMP_TIMEOUT" =~ ^[0-9]+$ && "$OPS_EXEC_TIMEOUT" =~ ^[0-9]+$ ]] || die "DUMP_TIMEOUT/OPS_EXEC_TIMEOUT phải là số nguyên (giây)."

  # Luôn chạy tại thư mục gốc repo để đường dẫn tương đối ./logs ./backups luôn đúng.
  cd "$ROOT_DIR"
  [[ -f docker-compose.yml ]] || die "Không thấy docker-compose.yml: chạy script từ thư mục gốc repo."

  check_prereqs
  require_free_disk_gb "$DEPLOY_MIN_FREE_GB"
  acquire_lock
  git_update
  # Commit ngắn ghi vào dist/version.json của image (build arg GIT_COMMIT trong docker-compose.yml); phải export TRƯỚC mọi
  # lệnh compose build/run để cache khớp. Không có .git (--no-pull) thì để compose dùng `unknown`.
  export GIT_COMMIT="${NEW_COMMIT:-unknown}"
  check_compose
  check_users_migrated
  ensure_runtime_dirs
  backup_mongo
  tag_current_backend_image
  build_backend
  migration_gate

  STACK_TOUCHED=1
  log "docker compose up -d --build ..."
  compose up -d --build

  wait_mongo_healthy
  wait_backend_liveness
  sync_system_version

  echo
  compose ps
  if [[ "$(docker inspect -f '{{.State.Status}}' realestate_9router 2>/dev/null || echo missing)" != "running" ]]; then
    warn "Container realestate_9router không chạy (AI qua 9Router sẽ lỗi). Xem: docker compose --env-file $ENV_FILE logs nine-router"
  fi
  log "Deploy xong (commit ${NEW_COMMIT:-?}). Image dự phòng: ${PREV_IMAGE_TAG:-không có}. Backup: ${BACKUP_FILE:-không có}."
}

# Bọc toàn bộ trong main + `exit`: bash đọc script theo từng đoạn, nên bắt buộc dừng ở đây để việc `git pull` thay
# đổi chính file này giữa chừng không làm bash đọc tiếp phần lệnh lạ.
main "$@"
exit 0
