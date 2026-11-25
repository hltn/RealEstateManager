#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/compose.test.sh — kiểm tĩnh docker-compose.yml gốc (v1.0.6, T-28, FR-17/FR-18/FR-19).
# Không chạy container; chỉ đọc file và (nếu có docker) gọi `docker compose config` với file env điền từ .env.example.
#   [1]  hình dạng: `name: realestatemanager`; không `build:`, `env_file`, bind-mount `./.env`; không còn FEATURE_CRM_* / .env.docker(.example).
#   [2]  image app `realestatemanager-{backend,frontend}:current`; `container_name: realestate_*` đủ 7 service.
#   [3]  volume: đúng 5 tên cũ, đều được mount; không volume lạ.
#   [4]  khóa bắt buộc dạng ${KEY:?...}; MONGODB_URI/REDIS_URL từ `.env`; hai khóa S3 có fallback S3_APP_* và vẫn bắt buộc.
#   [5]  các khóa chuỗi-rỗng-không-fallback (gồm EMBEDDING_MODEL/EMBEDDING_DIMENSIONS) có ${KEY:-mặc định}; LOG_DIR cố định /app/logs; CRON/SETTINGS_CONFIG_FILE ở /app/state.
#   [6]  cờ CRM: BE và FE cùng tên (CRM_ENABLED, CRM_ATTACHMENTS_ENABLED, CRM_PUSH_ENABLED, CRM_IMPORT_ENABLED); FE có đủ khóa mà
#        entrypoint 40-runtime-config.sh đọc.
#   [7]  TRUSTED_PROXY_IP: cùng một nguồn cho nginx (FE) và ipv4_address của cloudflared; cổng host FE đặt được (FRONTEND_PORT, mặc định 80).
#   [8]  đồng bộ với .env.example: mọi ${VAR} của compose có trong .env.example; mọi khóa .env.example hoặc có trong `environment:` hoặc
#        thuộc danh sách "chỉ để nội suy/dev"; mặc định ${KEY:-D} khớp giá trị mẫu của .env.example.
#   [9]  mọi khóa backend đọc trong RealEstateBackendApp/src (nếu có thư mục; quét NHIỀU DÒNG, bắt cả lời gọi config.get bị ngắt dòng) đều có trong `environment:` của backend.
#   [10] `docker compose config` (nếu có docker): hợp lệ với env điền từ .env.example; thiếu khóa bắt buộc thì báo lỗi nêu tên khóa;
#        cờ CRM truyền sang cả BE lẫn FE; mặc định áp khi khóa rỗng; S3_APP_* ghi đè; FRONTEND_PORT đổi được cổng publish.
#
# Biến điều khiển (dùng cho kiểm thử đột biến, không đụng file thật):
#   COMPOSE_UNDER_TEST=<đường dẫn compose>   ENV_EXAMPLE_UNDER_TEST=<đường dẫn .env.example>
#
# Chạy:  bash ops/tests/compose.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
COMPOSE="${COMPOSE_UNDER_TEST:-$ROOT_DIR/docker-compose.yml}"
ENV_EXAMPLE="${ENV_EXAMPLE_UNDER_TEST:-$ROOT_DIR/.env.example}"
ENTRYPOINT_SH="$ROOT_DIR/RealEstateAdminApp/docker-entrypoint.d/40-runtime-config.sh"
BE_SRC="$ROOT_DIR/RealEstateBackendApp/src"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: thiếu chuỗi [$2]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: KHÔNG được chứa [$2]"; fi; }
# $1 nhãn, $2 danh sách (mỗi dòng một mục) phải RỖNG.
expect_empty() { if [[ -z "$2" ]]; then ok; else fail "$1: $(printf '%s' "$2" | tr '\n' ' ')"; fi; }

if [[ ! -f "$COMPOSE" ]]; then fail "thiếu $COMPOSE"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; fi
if [[ ! -f "$ENV_EXAMPLE" ]]; then fail "thiếu $ENV_EXAMPLE"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Bản LF của compose (file thật là CRLF) để grep/awk theo dòng.
COMPOSE_LF="$WORK/compose.lf.yml"
tr -d '\r' < "$COMPOSE" > "$COMPOSE_LF"
EXAMPLE_LF="$WORK/env.example.lf"
tr -d '\r' < "$ENV_EXAMPLE" > "$EXAMPLE_LF"

# Dòng KHÔNG phải comment toàn dòng.
code_lines() { grep -vE '^[[:space:]]*#' "$COMPOSE_LF"; }

# Nội dung khối service $1 (thân giữa `  <svc>:` và service/khối top-level kế tiếp).
service_block() {
  awk -v svc="$1" '
    $0 ~ ("^  " svc ":[[:space:]]*$") { f = 1; next }
    f && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { f = 0 }
    f && /^[^ #]/ { f = 0 }
    f { print }
  ' "$COMPOSE_LF"
}

# Khóa dạng danh sách `      - KEY=value` trong khối service $1: in "KEY=value" (giữ nguyên phần value).
env_items() { service_block "$1" | grep -E '^      - [A-Z][A-Z0-9_]*=' | sed -E 's/^      - //'; }
env_item() { env_items "$1" | grep -E "^$2=" | head -n 1; }
env_keys() { env_items "$1" | sed -E 's/=.*$//' | sort -u; }

SERVICES="mongo redis minio minio-init nine-router backend frontend cloudflared"

echo "== 1) hình dạng chung =="
expect_eq "[1] name project" "name: realestatemanager" "$(grep -E '^name:' "$COMPOSE_LF")"
expect_empty "[1] không còn build:" "$(code_lines | grep -nE '^[[:space:]]*build:')"
expect_empty "[1] không còn env_file" "$(code_lines | grep -nE '^[[:space:]]*env_file:')"
expect_empty "[1] không bind-mount ./.env" "$(code_lines | grep -nE '^[[:space:]]*-[[:space:]]*"?\./\.env(:|"|$)')"
expect_empty "[1] không còn FEATURE_CRM_*" "$(grep -n 'FEATURE_CRM_' "$COMPOSE_LF")"
expect_empty "[1] không còn .env.docker / .env.docker.example" "$(grep -nE '\.env\.docker' "$COMPOSE_LF")"
expect_empty "[1] không còn MONGO_APP_* (nội suy đã bỏ)" "$(grep -n 'MONGO_APP_' "$COMPOSE_LF")"
expect_empty "[1] không còn GIT_COMMIT (build arg đã bỏ)" "$(code_lines | grep -n 'GIT_COMMIT')"

echo "== 2) image + container_name =="
expect_eq "[2] image backend" 'image: ${BACKEND_IMAGE:-realestatemanager-backend:current}' "$(service_block backend | grep -E '^    image:' | sed -E 's/^ +//')"
expect_eq "[2] image frontend" 'image: ${FRONTEND_IMAGE:-realestatemanager-frontend:current}' "$(service_block frontend | grep -E '^    image:' | sed -E 's/^ +//')"
for svc in $SERVICES; do
  cn="$(service_block "$svc" | grep -E '^    container_name:' | sed -E 's/^ +container_name: //')"
  case "$cn" in realestate_*) ok ;; *) fail "[2] service $svc: container_name phải là realestate_* (nhận [$cn])" ;; esac
done
SERVICES_DECLARED="$(awk '/^services:/ {f=1; next} f && /^[^ #]/ {f=0} f && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {sub(/^  /,""); sub(/:.*/,""); print}' "$COMPOSE_LF" | sort | tr '\n' ' ')"
expect_eq "[2] đúng 8 service (7 + minio-init)" "$(printf '%s\n' $SERVICES | sort | tr '\n' ' ')" "$SERVICES_DECLARED"

echo "== 3) volume =="
VOLUMES_DECLARED="$(awk '/^volumes:/ {f=1; next} f && /^[^ #]/ {f=0} f && /^  [A-Za-z0-9_]+:/ {sub(/^  /,""); sub(/:.*/,""); print}' "$COMPOSE_LF" | sort | tr '\n' ' ')"
expect_eq "[3] volume khai báo" "backend_state minio_data mongo_data nine_router_data redis_data " "$VOLUMES_DECLARED"
expect_contains "[3] mongo mount mongo_data" "- mongo_data:/data/db" "$(service_block mongo)"
expect_contains "[3] redis mount redis_data" "- redis_data:/data" "$(service_block redis)"
expect_contains "[3] minio mount minio_data" "- minio_data:/data" "$(service_block minio)"
expect_contains "[3] nine-router mount nine_router_data" "- nine_router_data:/app/data" "$(service_block nine-router)"
expect_contains "[3] backend mount backend_state" "- backend_state:/app/state" "$(service_block backend)"
expect_contains "[3] backend bind logs" "- ./logs:/app/logs" "$(service_block backend)"

echo "== 4) khóa bắt buộc =="
REQUIRED_BE="MONGODB_URI REDIS_URL JWT_SECRET COOKIE_SECRET FRONTEND_URL ADMIN_EMAIL ADMIN_PASSWORD S3_BUCKET_ATTACHMENTS S3_BUCKET_EXPORTS"
for k in $REQUIRED_BE; do
  item="$(env_item backend "$k")"
  case "$item" in "$k"='${'"$k"':?'*'}') ok ;; *) fail "[4] backend $k phải là \${$k:?thông báo} (nhận [$item])" ;; esac
done
for k in S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  item="$(env_item backend "$k")"
  expect_contains "[4] backend $k có fallback S3_APP_*" "\${S3_APP_${k#S3_}:-" "$item"
  expect_contains "[4] backend $k vẫn bắt buộc" "\${$k:?" "$item"
done
expect_contains "[4] frontend FRONTEND_URL bắt buộc" 'FRONTEND_URL=${FRONTEND_URL:?' "$(env_item frontend FRONTEND_URL)"
expect_contains "[4] MONGODB_URI lấy từ .env (không ghép từ MONGO_ROOT_*)" 'MONGODB_URI=${MONGODB_URI:?' "$(env_item backend MONGODB_URI)"
expect_not_contains "[4] MONGODB_URI không nội suy MONGO_ROOT_*" "MONGO_ROOT" "$(env_item backend MONGODB_URI)"
SVC_MONGO="$(service_block mongo)"
for k in MONGO_ROOT_USERNAME MONGO_ROOT_PASSWORD MONGO_KEYFILE; do expect_contains "[4] mongo $k bắt buộc" "\${$k:?" "$SVC_MONGO"; done
expect_contains "[4] redis REDIS_PASSWORD bắt buộc" '${REDIS_PASSWORD:?' "$(service_block redis)"
SVC_MINIO="$(service_block minio)"
for k in S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do expect_contains "[4] minio $k bắt buộc" "\${$k:?" "$SVC_MINIO"; done
SVC_INIT="$(service_block minio-init)"
for k in S3_BUCKET_ATTACHMENTS S3_BUCKET_EXPORTS; do expect_contains "[4] minio-init $k bắt buộc" "\${$k:?" "$SVC_INIT"; done
expect_contains "[4] 9router INITIAL_PASSWORD bắt buộc" '${NINE_ROUTER_INITIAL_PASSWORD:?' "$(service_block nine-router)"
expect_contains "[4] cloudflared token bắt buộc" '${CLOUDFLARE_TUNNEL_TOKEN:?' "$(service_block cloudflared)"
# Thông báo lỗi chỉ về .env.example.
expect_empty "[4] thông báo của khóa bắt buộc đều trỏ .env.example" "$(code_lines | grep -E '\$\{[A-Z_0-9]+:\?' | grep -v '\.env\.example')"

echo "== 5) bảy khóa chuỗi-rỗng-không-fallback + file trạng thái + log =="
expect_eq "[5] REDIS_KEY_PREFIX" 'REDIS_KEY_PREFIX=${REDIS_KEY_PREFIX:-rem:}' "$(env_item backend REDIS_KEY_PREFIX)"
expect_eq "[5] CRM_PII_KEY_VERSION" 'CRM_PII_KEY_VERSION=${CRM_PII_KEY_VERSION:-1}' "$(env_item backend CRM_PII_KEY_VERSION)"
expect_eq "[5] LOG_LEVEL" 'LOG_LEVEL=${LOG_LEVEL:-info}' "$(env_item backend LOG_LEVEL)"
expect_eq "[5] DEDUP_THRESHOLD" 'DEDUP_THRESHOLD=${DEDUP_THRESHOLD:-0.90}' "$(env_item backend DEDUP_THRESHOLD)"
expect_eq "[5] DEDUP_WINDOW_DAYS" 'DEDUP_WINDOW_DAYS=${DEDUP_WINDOW_DAYS:-30}' "$(env_item backend DEDUP_WINDOW_DAYS)"
expect_eq "[5] EMBEDDING_MODEL" 'EMBEDDING_MODEL=${EMBEDDING_MODEL:-openai/text-embedding-3-small}' "$(env_item backend EMBEDDING_MODEL)"
expect_eq "[5] EMBEDDING_DIMENSIONS" 'EMBEDDING_DIMENSIONS=${EMBEDDING_DIMENSIONS:-512}' "$(env_item backend EMBEDDING_DIMENSIONS)"
expect_eq "[5] LOG_DIR cố định cho container" 'LOG_DIR=/app/logs' "$(env_item backend LOG_DIR)"
expect_eq "[5] CRON_CONFIG_FILE" 'CRON_CONFIG_FILE=/app/state/cron.env' "$(env_item backend CRON_CONFIG_FILE)"
expect_eq "[5] SETTINGS_CONFIG_FILE" 'SETTINGS_CONFIG_FILE=/app/state/ai.env' "$(env_item backend SETTINGS_CONFIG_FILE)"
expect_eq "[5] NODE_ENV production cố định" 'NODE_ENV=production' "$(env_item backend NODE_ENV)"
expect_eq "[5] TRUST_PROXY=1" 'TRUST_PROXY=1' "$(env_item backend TRUST_PROXY)"
expect_eq "[5] PORT=3000" 'PORT=3000' "$(env_item backend PORT)"
expect_eq "[5] S3_ENDPOINT nội bộ" 'S3_ENDPOINT=http://minio:9000' "$(env_item backend S3_ENDPOINT)"
expect_eq "[5] NINEROUTER_BASE_URL mặc định" 'NINEROUTER_BASE_URL=${NINEROUTER_BASE_URL:-http://nine-router:20128/v1}' "$(env_item backend NINEROUTER_BASE_URL)"

echo "== 6) cờ CRM BE/FE + khóa entrypoint FE =="
for k in CRM_ENABLED CRM_ATTACHMENTS_ENABLED CRM_PUSH_ENABLED CRM_IMPORT_ENABLED; do
  expect_eq "[6] backend $k" "$k=\${$k:-false}" "$(env_item backend "$k")"
  expect_eq "[6] frontend $k" "$k=\${$k:-false}" "$(env_item frontend "$k")"
done
expect_eq "[6] backend CRM_SWAGGER_ENABLED" 'CRM_SWAGGER_ENABLED=${CRM_SWAGGER_ENABLED:-false}' "$(env_item backend CRM_SWAGGER_ENABLED)"
if [[ -f "$ENTRYPOINT_SH" ]]; then
  FLAG_KEYS_LINE="$(grep -E '^FLAG_KEYS=' "$ENTRYPOINT_SH" | head -n 1 | sed -E 's/^FLAG_KEYS="//; s/"$//')"
  [[ -n "$FLAG_KEYS_LINE" ]] && ok || fail "[6] không đọc được FLAG_KEYS từ 40-runtime-config.sh"
  for k in $FLAG_KEYS_LINE; do
    expect_eq "[6] frontend truyền khóa cờ $k (entrypoint đọc)" "$k=\${$k:-false}" "$(env_item frontend "$k")"
  done
  expect_eq "[6] frontend API_URL" 'API_URL=${API_URL:-/api/v1}' "$(env_item frontend API_URL)"
else
  fail "[6] thiếu $ENTRYPOINT_SH"
fi
for k in BACKEND_UPSTREAM TRUSTED_PROXY_IP CLIENT_MAX_BODY; do
  [[ -n "$(env_item frontend "$k")" ]] && ok || fail "[6] frontend thiếu $k (biến nginx envsubst)"
done

echo "== 7) TRUSTED_PROXY_IP + cổng host FE =="
expect_eq "[7] frontend TRUSTED_PROXY_IP" 'TRUSTED_PROXY_IP=${TRUSTED_PROXY_IP:-10.213.77.250}' "$(env_item frontend TRUSTED_PROXY_IP)"
expect_contains "[7] cloudflared ipv4_address cùng biến" 'ipv4_address: ${TRUSTED_PROXY_IP:-10.213.77.250}' "$(service_block cloudflared)"
expect_contains "[7] frontend publish cổng host cấu hình được" '- "${FRONTEND_PORT:-80}:80"' "$(service_block frontend)"
expect_contains "[7] subnet realestate_net chứa 10.213.77.250" "subnet: 10.213.77.0/24" "$(cat "$COMPOSE_LF")"

echo "== 8) đồng bộ với .env.example =="
# Khóa trong .env.example (đang hiệu lực hoặc bị comment dạng `# KEY=`).
EXAMPLE_KEYS="$(grep -oE '^#? ?[A-Z][A-Z0-9_]*=' "$EXAMPLE_LF" | sed -E 's/^#? ?//; s/=$//' | sort -u)"
[[ -n "$EXAMPLE_KEYS" ]] && ok || fail "[8] không đọc được khóa nào từ .env.example"
# Mọi ${VAR} của compose phải là khóa của .env.example.
COMPOSE_VARS="$(code_lines | grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*' | sed 's/^\${//' | sort -u)"
# Ngoại lệ: CRM_PII_ENCRYPTION_KEY_V2..V5 (compose truyền sẵn 5 khóa PII cũ; .env.example chỉ nêu V1 làm mẫu).
UNKNOWN_VARS="$(comm -23 <(printf '%s\n' "$COMPOSE_VARS") <(printf '%s\n' "$EXAMPLE_KEYS") | grep -vE '^CRM_PII_ENCRYPTION_KEY_V[2-5]$')"
expect_empty "[8] \${VAR} trong compose không có trong .env.example" "$UNKNOWN_VARS"
# Khóa .env.example không xuất hiện ở đâu trong compose: chỉ được thuộc nhóm "chỉ dành cho host/dev/ops".
#   - PORT, LOG_DIR: compose đặt cứng (có trong environment); AUTH_LOGIN_THROTTLE_LIMIT: bị bỏ qua khi NODE_ENV=production.
#   - DEV_*: docker-compose.dev.yml / docker-compose.dev-watch.yml (T-29; xem DEV_VARS bên dưới). TRUST_PROXY, S3_ENDPOINT, CRON_CONFIG_FILE, SETTINGS_CONFIG_FILE, NODE_ENV: compose đặt cứng.
ALL_ENV_KEYS="$( { for s in $SERVICES; do env_keys "$s"; done; } | sort -u)"
ALLOWED_NOT_PASSED="AUTH_LOGIN_THROTTLE_LIMIT"
# ${VAR} của hai override dev (docker-compose.dev.yml, docker-compose.dev-watch.yml; T-29) cũng tính là "được compose dùng" (DEV_*_PORT, DEV_NODE_ENV...);
# ops/tests/compose-dev.test.sh kiểm chi tiết hai file đó, ở đây chỉ để khóa của chúng không bị coi là mồ côi trong .env.example.
DEV_VARS=""
for f in "$ROOT_DIR/docker-compose.dev.yml" "$ROOT_DIR/docker-compose.dev-watch.yml"; do
  [[ -f "$f" ]] && DEV_VARS+="$(tr -d '\r' < "$f" | grep -vE '^[[:space:]]*#' | grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*' | sed 's/^\${//')"$'\n'
done
MISSING_FROM_COMPOSE=""
while IFS= read -r k; do
  [[ -z "$k" ]] && continue
  grep -qxF "$k" <<<"$COMPOSE_VARS" && continue
  grep -qxF "$k" <<<"$ALL_ENV_KEYS" && continue
  grep -qxF "$k" <<<"$DEV_VARS" && continue
  case " $ALLOWED_NOT_PASSED " in *" $k "*) continue ;; esac
  MISSING_FROM_COMPOSE="$MISSING_FROM_COMPOSE$k"$'\n'
done <<<"$EXAMPLE_KEYS"
expect_empty "[8] khóa .env.example không được compose dùng/truyền" "$MISSING_FROM_COMPOSE"
# Mặc định ${KEY:-D} của compose khớp giá trị mẫu đang hiệu lực trong .env.example (bỏ qua giá trị mẫu dạng <...> và khóa có dòng lồng).
for svc in backend frontend; do
  while IFS= read -r item; do
    [[ -z "$item" ]] && continue
    key="${item%%=*}"; val="${item#*=}"
    [[ "$val" =~ ^\$\{"$key":-([^\$]*)\}$ ]] || continue
    dflt="${BASH_REMATCH[1]}"
    ex_line="$(grep -E "^$key=" "$EXAMPLE_LF" | head -n 1)"
    [[ -z "$ex_line" ]] && continue
    ex_val="${ex_line#*=}"
    [[ "$ex_val" == *'<'* ]] && continue
    # VAPID_SUBJECT: .env.example ghi giá trị MẪU (bắt buộc khi push bật), không phải mặc định; compose để rỗng.
    [[ "$key" == "VAPID_SUBJECT" ]] && continue
    expect_eq "[8] $svc $key: mặc định compose = giá trị mẫu .env.example" "$ex_val" "$dflt"
  done < <(env_items "$svc")
done

echo "== 9) khóa backend đọc trong source đều được truyền =="
if [[ -d "$BE_SRC" ]]; then
  # Gộp mọi file nguồn thành MỘT dòng (xuống dòng -> khoảng trắng) để bắt cả lời gọi `config.get<T>(\n  'KEY',\n  mặc định)` bị Prettier
  # ngắt nhiều dòng (vd EMBEDDING_MODEL/EMBEDDING_DIMENSIONS ở embedding.service.ts); regex theo dòng sẽ sót chúng. `awk 1` bảo đảm mỗi file
  # kết thúc bằng xuống dòng để token cuối file này không dính token đầu file kế.
  BE_TEXT="$(find "$BE_SRC" -type f -name '*.ts' ! -name '*.spec.ts' ! -name '*.fixture.ts' -print0 2>/dev/null | xargs -0 awk '1' 2>/dev/null | tr '\r\n' '  ')"
  BE_KEYS="$(printf '%s' "$BE_TEXT" | grep -oE "(configService|config|this\.config|cfg)\.(get|getOrThrow)(<[^>]*>)?\([[:space:]]*['\"][A-Z][A-Z0-9_]+['\"]|process\.env\.[A-Z][A-Z0-9_]+|process\.env\[['\"][A-Z][A-Z0-9_]+['\"]\]" 2>/dev/null \
    | sed -E "s/.*['\"]([A-Z][A-Z0-9_]+)['\"].*/\1/; s/^process\.env\.//" | sort -u)"
  [[ -n "$BE_KEYS" ]] && ok || fail "[9] không quét được khóa nào từ RealEstateBackendApp/src"
  # Khóa mẫu bị ngắt nhiều dòng: chứng minh bộ quét không còn sót (regress về regex theo dòng thì ca này hỏng).
  if [[ -f "$BE_SRC/modules/news-fire-crawl-manager/services/embedding.service.ts" ]]; then
    expect_contains "[9] bộ quét nhiều dòng bắt EMBEDDING_MODEL" "EMBEDDING_MODEL" "$BE_KEYS"
    expect_contains "[9] bộ quét nhiều dòng bắt EMBEDDING_DIMENSIONS" "EMBEDDING_DIMENSIONS" "$BE_KEYS"
  fi
  # Khóa chỉ dùng trong test/công cụ hoặc bị bỏ qua có chủ đích khi chạy trong container production.
  # LOG_ là phần dư của comment `process.env.LOG_*` trong main.ts (không phải khóa).
  BE_IGNORED="DOTENV_CONFIG_QUIET LOADENV_TEST_MONGO PERF_ASSERT_FACTOR AUTH_LOGIN_THROTTLE_LIMIT GIT_COMMIT LOG_"
  BE_ENV_KEYS="$(env_keys backend)"
  BE_MISSING=""
  while IFS= read -r k; do
    [[ -z "$k" ]] && continue
    grep -qxF "$k" <<<"$BE_ENV_KEYS" && continue
    case " $BE_IGNORED " in *" $k "*) continue ;; esac
    BE_MISSING="$BE_MISSING$k"$'\n'
  done <<<"$BE_KEYS"
  expect_empty "[9] khóa backend đọc nhưng compose không truyền" "$BE_MISSING"
else
  echo "  (bỏ qua: không có RealEstateBackendApp/src, vd gói release)"
fi

echo "== 10) docker compose config =="
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "  (bỏ qua: không có docker compose)"
else
  # Env mẫu: điền mọi placeholder <...> của .env.example bằng giá trị giả (KHÔNG bí mật thật).
  FILLED="$WORK/filled.env"
  sed -E 's/<[^>]*>/fake0123456789abcdef/g' "$EXAMPLE_LF" > "$FILLED"
  # Env của shell có thể đè env-file: bỏ đặt mọi khóa mẫu trong subshell.
  compose_cfg() {
    local envfile="$1"; shift
    ( for k in $EXAMPLE_KEYS; do unset "$k"; done
      env "$@" docker compose -f "$COMPOSE" --env-file "$envfile" config 2>&1 )
  }
  OUT="$(compose_cfg "$FILLED")"; RC=$?
  if [[ "$OUT" == *"services:"* ]]; then ok; else fail "[10] config với env mẫu không hợp lệ: ${OUT:0:300}"; fi
  expect_not_contains "[10] config không có build" "build:" "$OUT"
  expect_not_contains "[10] config không có env_file" "env_file" "$OUT"
  expect_contains "[10] project name" "name: realestatemanager" "$OUT"
  expect_contains "[10] image backend" "image: realestatemanager-backend:current" "$OUT"
  expect_contains "[10] image frontend" "image: realestatemanager-frontend:current" "$OUT"
  expect_contains "[10] volume backend_state" "name: realestatemanager_backend_state" "$OUT"
  expect_contains "[10] SETTINGS_CONFIG_FILE" "SETTINGS_CONFIG_FILE: /app/state/ai.env" "$OUT"
  expect_contains "[10] cloudflared ipv4" "ipv4_address: 10.213.77.250" "$OUT"
  expect_contains "[10] cổng FE mặc định 80" 'published: "80"' "$OUT"

  # Thiếu từng khóa bắt buộc -> lỗi nêu tên khóa.
  for k in JWT_SECRET COOKIE_SECRET MONGODB_URI REDIS_URL FRONTEND_URL ADMIN_EMAIL ADMIN_PASSWORD S3_BUCKET_ATTACHMENTS S3_BUCKET_EXPORTS S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY MONGO_ROOT_PASSWORD CLOUDFLARE_TUNNEL_TOKEN; do
    grep -vE "^$k=" "$FILLED" > "$WORK/missing.env"
    OUT_M="$(compose_cfg "$WORK/missing.env")"; RC_M=$?
    if [[ "$OUT_M" == *"$k"* && "$OUT_M" != *"services:"* ]]; then ok; else fail "[10] thiếu $k phải báo lỗi nêu tên khóa (nhận: ${OUT_M:0:160})"; fi
    # Khóa có giá trị rỗng cũng bị chặn (`:?` chặn cả rỗng).
    sed -E "s/^$k=.*/$k=/" "$FILLED" > "$WORK/empty.env"
    OUT_E="$(compose_cfg "$WORK/empty.env")"
    if [[ "$OUT_E" == *"$k"* && "$OUT_E" != *"services:"* ]]; then ok; else fail "[10] $k rỗng phải báo lỗi (nhận: ${OUT_E:0:160})"; fi
  done

  # Mặc định áp khi khóa rỗng (bảy khóa chuỗi-rỗng-không-fallback + cờ).
  sed -E 's/^(REDIS_KEY_PREFIX|CRM_PII_KEY_VERSION|LOG_LEVEL|DEDUP_THRESHOLD|DEDUP_WINDOW_DAYS|EMBEDDING_MODEL|EMBEDDING_DIMENSIONS|CRM_ENABLED|CRM_PUSH_ENABLED)=.*/\1=/' "$FILLED" > "$WORK/blank.env"
  OUT_B="$(compose_cfg "$WORK/blank.env")"
  if printf '%s\n' "$OUT_B" | grep -qE '^      REDIS_KEY_PREFIX: ["'"'"']?rem:["'"'"']?$'; then ok; else fail "[10] REDIS_KEY_PREFIX rỗng phải về rem:"; fi
  expect_contains "[10] CRM_PII_KEY_VERSION rỗng -> 1" 'CRM_PII_KEY_VERSION: "1"' "$OUT_B"
  expect_contains "[10] LOG_LEVEL rỗng -> info" "LOG_LEVEL: info" "$OUT_B"
  expect_contains "[10] DEDUP_THRESHOLD rỗng -> 0.90" 'DEDUP_THRESHOLD: "0.90"' "$OUT_B"
  expect_contains "[10] DEDUP_WINDOW_DAYS rỗng -> 30" 'DEDUP_WINDOW_DAYS: "30"' "$OUT_B"
  expect_contains "[10] EMBEDDING_MODEL rỗng -> openai/text-embedding-3-small" "EMBEDDING_MODEL: openai/text-embedding-3-small" "$OUT_B"
  expect_contains "[10] EMBEDDING_DIMENSIONS rỗng -> 512" 'EMBEDDING_DIMENSIONS: "512"' "$OUT_B"
  expect_contains "[10] LOG_DIR cố định" "LOG_DIR: /app/logs" "$OUT_B"

  # Cờ CRM bật -> cả BE lẫn FE nhận true (không còn tên FEATURE_CRM_* làm CRM luôn tắt).
  sed -E 's/^(CRM_ENABLED|CRM_ATTACHMENTS_ENABLED|CRM_PUSH_ENABLED)=.*/\1=true/' "$FILLED" > "$WORK/crm.env"
  OUT_C="$(compose_cfg "$WORK/crm.env")"
  for k in CRM_ENABLED CRM_ATTACHMENTS_ENABLED CRM_PUSH_ENABLED; do
    n="$(printf '%s\n' "$OUT_C" | grep -cE "^      $k: \"true\"$")"
    expect_eq "[10] $k=true xuất hiện ở cả backend và frontend" "2" "$n"
  done
  expect_not_contains "[10] không có FEATURE_CRM_ trong config" "FEATURE_CRM_" "$OUT_C"

  # S3_APP_* ghi đè; cổng FE đổi được; image đổi được.
  { cat "$FILLED"; printf 'S3_APP_ACCESS_KEY_ID=appuser\nS3_APP_SECRET_ACCESS_KEY=appsecret\nFRONTEND_PORT=8080\nBACKEND_IMAGE=realestatemanager-backend:1.0.6-abc1234\n'; } > "$WORK/over.env"
  OUT_O="$(compose_cfg "$WORK/over.env")"
  expect_contains "[10] S3_APP_ACCESS_KEY_ID ghi đè cho backend" "S3_ACCESS_KEY_ID: appuser" "$OUT_O"
  expect_contains "[10] FRONTEND_PORT=8080 -> published 8080" 'published: "8080"' "$OUT_O"
  expect_contains "[10] BACKEND_IMAGE ghi đè tag" "image: realestatemanager-backend:1.0.6-abc1234" "$OUT_O"
  # Khóa lạ trong env file không lọt vào container (danh sách tường minh).
  { cat "$FILLED"; printf 'LEAK_CANARY_KEY=canary-value-123\n'; } > "$WORK/leak.env"
  OUT_L="$(compose_cfg "$WORK/leak.env")"
  expect_not_contains "[10] khóa lạ không lọt vào container" "LEAK_CANARY_KEY" "$OUT_L"
fi

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
