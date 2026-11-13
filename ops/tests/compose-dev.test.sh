#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/compose-dev.test.sh — kiểm hai override dev của docker-compose.yml gốc (v1.0.6, T-29, FR-17).
#   docker-compose.dev.yml        publish mongo/redis/minio-console ra 127.0.0.1 (đổi cổng qua DEV_*_PORT)
#   docker-compose.dev-watch.yml  tùy chọn: backend chạy `nest start --watch` từ stage `dev` của Dockerfile BE
# Không chạy container. Phần `docker compose config` bị bỏ qua nếu không có docker compose.
#   [1] tĩnh: file tồn tại, LF, dev.yml không `build:`, chỉ publish 127.0.0.1, không bí mật cứng.
#   [2] Dockerfile BE: có stage `dev` (trước `production`), `production` vẫn là stage CUỐI (build mặc định không đổi).
#   [3] .env.example ghi DEV_* kèm `# optional`.
#   [4] config (gốc + dev.yml): hợp lệ; 27017/6379/9001 chỉ ở 127.0.0.1; đổi cổng được; KHÔNG publish 9000.
#   [5] config (gốc + dev.yml + dev-watch.yml): build target dev, image :dev-watch, 127.0.0.1:3000,
#       FRONTEND_URL localhost:5173, mount src, NODE_ENV mặc định production / đổi được bằng DEV_NODE_ENV.
#   [6] compose gốc một mình KHÔNG publish mongo/redis/minio (không rò cổng ra ngoài ở prod).
#
# Chạy:  bash ops/tests/compose-dev.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
BASE="$ROOT_DIR/docker-compose.yml"
DEV="$ROOT_DIR/docker-compose.dev.yml"
WATCH="$ROOT_DIR/docker-compose.dev-watch.yml"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
DOCKERFILE="$ROOT_DIR/RealEstateBackendApp/Dockerfile"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: thiếu chuỗi [$2]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: KHÔNG được chứa [$2]"; fi; }

for f in "$BASE" "$DEV" "$WATCH" "$ENV_EXAMPLE" "$DOCKERFILE"; do
  [[ -f "$f" ]] || { fail "thiếu $f"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

lf() { tr -d '\r' < "$1"; }
code_of() { lf "$1" | grep -vE '^[[:space:]]*#'; }
# Thân khối service $2 trong đầu ra `docker compose config` $1; service ở mức thụt 2 dấu cách.
cfg_service() {
  printf '%s\n' "$1" | awk -v svc="$2" '
    $0 ~ "^  " svc ":$" { on = 1; next }
    on && /^  [^ ]/ { on = 0 }
    on && /^[^ ]/   { on = 0 }
    on { print }'
}
# "host_ip:published" của cổng đích $2 trong khối service $1 (compose xuất theo thứ tự mode, host_ip, target, published).
port_of() {
  printf '%s\n' "$1" | awk -v t="$2" '
    /^ *- mode:/ { hip = ""; tgt = "" }
    /host_ip:/ { hip = $2 }
    /target:/ { tgt = $2 }
    /published:/ { pub = $2; gsub(/"/, "", pub); if (tgt == t) print hip ":" pub }'
}

echo "== 1) tĩnh: hai file override =="
for f in "$DEV" "$WATCH"; do
  n="$(basename "$f")"
  if grep -q $'\r' "$f"; then fail "[1] $n phải là LF (không CRLF)"; else ok; fi
done
DEV_CODE="$(code_of "$DEV")"
WATCH_CODE="$(code_of "$WATCH")"
expect_not_contains "[1] dev.yml không có build" "build:" "$DEV_CODE"
expect_not_contains "[1] dev.yml không có env_file" "env_file" "$DEV_CODE"
# Mọi cổng publish trong dev.yml phải gắn 127.0.0.1 (không bind 0.0.0.0).
PORT_LINES="$(printf '%s\n' "$DEV_CODE" | grep -E '^[[:space:]]*-[[:space:]]*"[^"]*:[0-9]+"')"
BAD_PORTS="$(printf '%s\n' "$PORT_LINES" | grep -vE '"127\.0\.0\.1:' | grep -v '^$')"
if [[ -z "$BAD_PORTS" ]]; then ok; else fail "[1] dev.yml có cổng không gắn 127.0.0.1: $BAD_PORTS"; fi
expect_eq "[1] dev.yml publish đúng 3 cổng" "3" "$(printf '%s\n' "$PORT_LINES" | grep -c .)"
for p in 27017 6379 9001; do expect_contains "[1] dev.yml publish $p" ":$p\"" "$DEV_CODE"; done
expect_not_contains "[1] dev.yml không publish 9000 (S3 API)" ":9000" "$DEV_CODE"
expect_not_contains "[1] dev-watch không đụng cổng mongo" "27017" "$WATCH_CODE"
expect_not_contains "[1] dev-watch không đụng cổng redis" "6379" "$WATCH_CODE"
expect_contains "[1] dev-watch publish 127.0.0.1" '"127.0.0.1:${DEV_BACKEND_PORT:-3000}:3000"' "$WATCH_CODE"
expect_contains "[1] dev-watch build target dev" "target: dev" "$WATCH_CODE"
expect_contains "[1] dev-watch tag :dev-watch" "realestatemanager-backend:dev-watch" "$WATCH_CODE"
expect_contains "[1] dev-watch mount src" "./RealEstateBackendApp/src:/app/src" "$WATCH_CODE"
expect_contains "[1] dev-watch FRONTEND_URL" "FRONTEND_URL=http://localhost:5173" "$WATCH_CODE"
expect_contains "[1] dev-watch NODE_ENV mặc định production" 'NODE_ENV=${DEV_NODE_ENV:-production}' "$WATCH_CODE"
expect_contains "[1] dev-watch command nest --watch" '"nest", "start", "--watch"' "$WATCH_CODE"
# Không đặt bí mật cứng trong override (khóa dạng *PASSWORD/SECRET/TOKEN/KEY nhận giá trị không phải ${...}).
for f in "$DEV" "$WATCH"; do
  if code_of "$f" | grep -qiE '(password|secret|token|api_?key)[A-Za-z_]*[:=][[:space:]]*[^$[:space:]]'; then fail "[1] $(basename "$f") có giá trị bí mật cứng"; else ok; fi
done

echo "== 2) Dockerfile backend: stage dev, production vẫn cuối =="
DF="$(lf "$DOCKERFILE")"
STAGES="$(printf '%s\n' "$DF" | grep -iE '^FROM ' | sed -E 's/.*[[:space:]][Aa][Ss][[:space:]]+([A-Za-z0-9_-]+).*/\1/')"
expect_eq "[2] có stage dev" "dev" "$(printf '%s\n' "$STAGES" | grep -x dev)"
expect_eq "[2] stage cuối là production" "production" "$(printf '%s\n' "$STAGES" | tail -1)"
expect_contains "[2] stage dev từ builder" "FROM builder AS dev" "$DF"
expect_contains "[2] dev chạy nest start --watch" '"nest", "start", "--watch"' "$DF"
DEV_AT="$(printf '%s\n' "$STAGES" | grep -nx dev | cut -d: -f1)"
PROD_AT="$(printf '%s\n' "$STAGES" | grep -nx production | cut -d: -f1)"
if [[ -n "$DEV_AT" && -n "$PROD_AT" && "$DEV_AT" -lt "$PROD_AT" ]]; then ok; else fail "[2] stage dev phải đứng TRƯỚC production"; fi

echo "== 3) .env.example ghi khóa DEV_* tùy chọn =="
EX="$(lf "$ENV_EXAMPLE")"
for k in DEV_MONGO_PORT DEV_REDIS_PORT DEV_MINIO_CONSOLE_PORT DEV_BACKEND_PORT DEV_NODE_ENV; do
  line_no="$(printf '%s\n' "$EX" | grep -nE "^#? *$k=" | head -1 | cut -d: -f1)"
  if [[ -z "$line_no" ]]; then fail "[3] .env.example thiếu $k"; continue; fi
  ok
  from=$((line_no > 6 ? line_no - 6 : 1))
  ctx="$(printf '%s\n' "$EX" | sed -n "${from},${line_no}p")"
  expect_contains "[3] $k có chú thích optional" "optional" "$ctx"
done

echo "== 4..6) docker compose config =="
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "  (bỏ qua: không có docker compose)"
else
  FILLED="$WORK/filled.env"
  lf "$ENV_EXAMPLE" | sed -E 's/<[^>]*>/fake0123456789abcdef/g' > "$FILLED"
  KEYS="$(grep -oE '^#? *[A-Z][A-Z0-9_]*=' "$FILLED" | tr -d '#= ')"
  # $1 danh sách file compose (cách nhau bằng dấu cách), $2 file env, còn lại: VAR=giá trị ghi đè.
  cfg() {
    local files="$1" envfile="$2"; shift 2
    local args=() f
    for f in $files; do args+=(-f "$f"); done
    ( for k in $KEYS DEV_MONGO_PORT DEV_REDIS_PORT DEV_MINIO_CONSOLE_PORT DEV_BACKEND_PORT DEV_NODE_ENV; do unset "$k"; done
      env "$@" docker compose "${args[@]}" --env-file "$envfile" config 2>&1 )
  }

  OUT_BASE="$(cfg "$BASE" "$FILLED")"
  OUT_DEV="$(cfg "$BASE $DEV" "$FILLED")"
  if [[ "$OUT_DEV" == *"services:"* ]]; then ok; else fail "[4] config gốc+dev lỗi: ${OUT_DEV:0:300}"; fi

  echo "-- [6] compose gốc một mình"
  for s in mongo redis minio backend; do
    expect_not_contains "[6] gốc không publish cổng của $s" "published" "$(cfg_service "$OUT_BASE" "$s")"
  done

  echo "-- [4] gốc + dev.yml"
  expect_eq "[4] mongo 127.0.0.1:27017" "127.0.0.1:27017" "$(port_of "$(cfg_service "$OUT_DEV" mongo)" 27017)"
  expect_eq "[4] redis 127.0.0.1:6379"  "127.0.0.1:6379"  "$(port_of "$(cfg_service "$OUT_DEV" redis)" 6379)"
  expect_eq "[4] minio console 127.0.0.1:9001" "127.0.0.1:9001" "$(port_of "$(cfg_service "$OUT_DEV" minio)" 9001)"
  expect_eq "[4] minio không publish 9000" "" "$(port_of "$(cfg_service "$OUT_DEV" minio)" 9000)"
  expect_not_contains "[4] backend không publish cổng khi chỉ có dev.yml" "published" "$(cfg_service "$OUT_DEV" backend)"
  expect_not_contains "[4] dev.yml không kéo build vào" "build:" "$OUT_DEV"
  expect_contains "[4] image backend vẫn :current" "image: realestatemanager-backend:current" "$OUT_DEV"
  # Mọi cổng publish của mongo/redis/minio phải có host_ip 127.0.0.1.
  for s in mongo redis minio; do
    blk="$(cfg_service "$OUT_DEV" "$s")"
    expect_eq "[4] $s: số host_ip 127.0.0.1 = số published" "$(printf '%s\n' "$blk" | grep -c published)" "$(printf '%s\n' "$blk" | grep -c 'host_ip: 127.0.0.1')"
  done

  OUT_DEV2="$(cfg "$BASE $DEV" "$FILLED" DEV_MONGO_PORT=27117 DEV_REDIS_PORT=6479 DEV_MINIO_CONSOLE_PORT=9101)"
  expect_eq "[4] DEV_MONGO_PORT đổi cổng host" "127.0.0.1:27117" "$(port_of "$(cfg_service "$OUT_DEV2" mongo)" 27017)"
  expect_eq "[4] DEV_REDIS_PORT đổi cổng host" "127.0.0.1:6479" "$(port_of "$(cfg_service "$OUT_DEV2" redis)" 6379)"
  expect_eq "[4] DEV_MINIO_CONSOLE_PORT đổi cổng host" "127.0.0.1:9101" "$(port_of "$(cfg_service "$OUT_DEV2" minio)" 9001)"
  # Đặt rỗng (dòng `DEV_X=` trong .env) -> về mặc định.
  OUT_DEV3="$(cfg "$BASE $DEV" "$FILLED" DEV_MONGO_PORT= DEV_REDIS_PORT= DEV_MINIO_CONSOLE_PORT=)"
  expect_eq "[4] DEV_MONGO_PORT rỗng -> 27017" "127.0.0.1:27017" "$(port_of "$(cfg_service "$OUT_DEV3" mongo)" 27017)"
  expect_eq "[4] DEV_REDIS_PORT rỗng -> 6379" "127.0.0.1:6379" "$(port_of "$(cfg_service "$OUT_DEV3" redis)" 6379)"
  expect_eq "[4] DEV_MINIO_CONSOLE_PORT rỗng -> 9001" "127.0.0.1:9001" "$(port_of "$(cfg_service "$OUT_DEV3" minio)" 9001)"

  echo "-- [5] gốc + dev.yml + dev-watch.yml"
  OUT_W="$(cfg "$BASE $DEV $WATCH" "$FILLED")"
  if [[ "$OUT_W" == *"services:"* ]]; then ok; else fail "[5] config gộp ba file lỗi: ${OUT_W:0:300}"; fi
  BE="$(cfg_service "$OUT_W" backend)"
  expect_contains "[5] build target dev" "target: dev" "$BE"
  expect_contains "[5] build context là RealEstateBackendApp" "RealEstateBackendApp" "$(printf '%s\n' "$BE" | grep -A3 'build:')"
  expect_contains "[5] image :dev-watch" "image: realestatemanager-backend:dev-watch" "$BE"
  expect_not_contains "[5] không dùng tag :current" ":current" "$BE"
  expect_eq "[5] backend 127.0.0.1:3000" "127.0.0.1:3000" "$(port_of "$BE" 3000)"
  expect_contains "[5] FRONTEND_URL localhost:5173" "FRONTEND_URL: http://localhost:5173" "$BE"
  expect_contains "[5] mount src" "target: /app/src" "$BE"
  expect_contains "[5] vẫn mount volume state" "target: /app/state" "$BE"
  expect_contains "[5] NODE_ENV mặc định production" "NODE_ENV: production" "$BE"
  expect_contains "[5] chokidar polling" 'CHOKIDAR_USEPOLLING: "true"' "$BE"
  expect_contains "[5] start_period dài" "start_period: 5m0s" "$BE"
  expect_contains "[5] command nest start --watch" "- --watch" "$BE"
  expect_contains "[5] MONGODB_URI vẫn truyền từ compose gốc" "MONGODB_URI:" "$BE"
  expect_contains "[5] frontend không đổi tag" "image: realestatemanager-frontend:current" "$OUT_W"

  OUT_W2="$(cfg "$BASE $DEV $WATCH" "$FILLED" DEV_NODE_ENV=development DEV_BACKEND_PORT=13000)"
  BE2="$(cfg_service "$OUT_W2" backend)"
  expect_contains "[5] DEV_NODE_ENV=development" "NODE_ENV: development" "$BE2"
  expect_eq "[5] DEV_BACKEND_PORT=13000" "127.0.0.1:13000" "$(port_of "$BE2" 3000)"
  OUT_W3="$(cfg "$BASE $DEV $WATCH" "$FILLED" DEV_NODE_ENV= DEV_BACKEND_PORT=)"
  BE3="$(cfg_service "$OUT_W3" backend)"
  expect_contains "[5] DEV_NODE_ENV rỗng -> production" "NODE_ENV: production" "$BE3"
  expect_eq "[5] DEV_BACKEND_PORT rỗng -> 3000" "127.0.0.1:3000" "$(port_of "$BE3" 3000)"
fi

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
