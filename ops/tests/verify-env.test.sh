#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/verify-env.test.sh — test shell KHÔNG cần Docker/Mongo cho ops/verify-env.sh (v1.0.6, T-27, FR-18, FR-21).
#
# Cơ sở: chép `.env.example` gốc sang thư mục tạm, thay mọi placeholder bằng giá trị GIẢ hợp lệ => file nền "đã điền".
# Mỗi ca sửa/xóa/thêm một vài khóa của file nền rồi chạy verify-env, kiểm mã thoát và thông báo. Ca nền đạt (mã 0) chứng minh
# verify-env ăn khớp mẫu thật; ca `.env.example` nguyên bản (còn placeholder) phải báo lỗi. Mọi lần chạy đều kiểm stdout+stderr
# KHÔNG chứa giá trị bí mật nào của file nền (giá trị giả có tiền tố "zq7" để dò).
#
# Ca quyền file 600 chỉ chạy khi hệ tệp thật sự hỗ trợ chmod (Linux/CI); trên Windows (git-bash) bị bỏ qua có ghi chú, các ca còn lại
# chạy với VERIFY_ENV_OS giả MINGW64 để không phụ thuộc quyền.
#
# Chạy:  bash ops/tests/verify-env.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2016  # nháy đơn có chủ ý (chuỗi chứa $ ` \ là dữ liệu test)
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
# VERIFY_ENV_SCRIPT: chạy bộ test trên một bản script khác (dùng cho mutation test; bản đó phải nằm trong cây có ops/lib/ops-common.sh).
SCRIPT="${VERIFY_ENV_SCRIPT:-$ROOT_DIR/ops/verify-env.sh}"
EXAMPLE="$ROOT_DIR/.env.example"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/cwd"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: không thấy [$2] trong [${3:0:600}]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: KHÔNG được chứa [$2] (đầu ra: ${3:0:600})"; fi; }

[[ -f "$SCRIPT" ]] && ok || { fail "thiếu $SCRIPT"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; }
[[ -f "$EXAMPLE" ]] && ok || { fail "thiếu $EXAMPLE"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; }

# ── Giá trị giả (bí mật có tiền tố zq7 để dò rò rỉ) ──────────────────────────
PW_M="zq7MongoPwA91x"
PW_R="zq7RedisPwB22y"
PW_WRONG="zq7WrongPwC33z"
KEYFILE="zq7KeyfileD44w"
S3_SECRET="zq7S3SecretE55v"
JWT="zq7JwtSecretF66u"
COOKIE="zq7CookieSecG77t"
ADMIN_PW="zq7AdminPwH88s"
CF_TOKEN="zq7CfTokenI99r"
NINE_PW="zq7NinePwJ00q"
PII_KEY="zq7PiiKeyK11p"
SECRETS=("$PW_M" "$PW_R" "$PW_WRONG" "$KEYFILE" "$S3_SECRET" "$JWT" "$COOKIE" "$ADMIN_PW" "$CF_TOKEN" "$NINE_PW" "$PII_KEY")

# Giá trị giả cho từng khóa có placeholder trong .env.example. Khóa mới có placeholder mà chưa có ở đây => test hỏng (cố ý, để cập nhật).
fake_for() {
  case "$1" in
    MONGO_ROOT_USERNAME) printf 'remroot' ;;
    MONGO_ROOT_PASSWORD) printf '%s' "$PW_M" ;;
    MONGO_KEYFILE) printf '%s' "$KEYFILE" ;;
    MONGODB_URI) printf 'mongodb://remroot:%s@mongo:27017/realestate?authSource=admin&replicaSet=rs0' "$PW_M" ;;
    REDIS_PASSWORD) printf '%s' "$PW_R" ;;
    REDIS_URL) printf 'redis://:%s@redis:6379' "$PW_R" ;;
    S3_ACCESS_KEY_ID) printf 'remstorage' ;;
    S3_SECRET_ACCESS_KEY) printf '%s' "$S3_SECRET" ;;
    JWT_SECRET) printf '%s' "$JWT" ;;
    COOKIE_SECRET) printf '%s' "$COOKIE" ;;
    FRONTEND_URL) printf 'https://admin.example.test' ;;
    ADMIN_EMAIL) printf 'admin@example.test' ;;
    ADMIN_PASSWORD) printf '%s' "$ADMIN_PW" ;;
    CLOUDFLARE_TUNNEL_TOKEN) printf '%s' "$CF_TOKEN" ;;
    NINE_ROUTER_INITIAL_PASSWORD) printf '%s' "$NINE_PW" ;;
    *) return 1 ;;
  esac
}

# Sinh file nền: mọi dòng KEY=VALUE (không comment) có <...> trong VALUE được thay bằng giá trị giả.
BASE="$TMP/base.env"
UNMAPPED=""
: > "$BASE"
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ && "${BASH_REMATCH[2]}" == *'<'*'>'* ]]; then
    k="${BASH_REMATCH[1]}"
    if v="$(fake_for "$k")"; then line="$k=$v"; else UNMAPPED+=" $k"; fi
  fi
  printf '%s\n' "$line" >> "$BASE"
done < "$EXAMPLE"
[[ -z "$UNMAPPED" ]] && ok || fail "[0] .env.example có placeholder chưa có giá trị giả trong test:$UNMAPPED"

# make_env <file> [op...]: chép file nền rồi áp dụng:  KEY=VAL (đặt/ghi đè)   -KEY (xóa)   +DÒNG (thêm nguyên văn).  Quyền 600.
make_env() {
  local out="$1" line k op; shift
  local -A OV=() DEL=() DONE=()
  local -a EXTRA=()
  for op in "$@"; do
    case "$op" in
      -*) DEL["${op:1}"]=1 ;;
      +*) EXTRA+=("${op:1}") ;;
      *=*) OV["${op%%=*}"]="${op#*=}" ;;
    esac
  done
  : > "$out"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      k="${BASH_REMATCH[1]}"
      [[ -n "${DEL[$k]:-}" ]] && continue
      if [[ -v "OV[$k]" ]]; then line="$k=${OV[$k]}"; DONE["$k"]=1; fi
    fi
    printf '%s\n' "$line" >> "$out"
  done < "$BASE"
  for k in "${!OV[@]}"; do [[ -n "${DONE[$k]:-}" ]] || printf '%s=%s\n' "$k" "${OV[$k]}" >> "$out"; done
  for line in "${EXTRA[@]}"; do printf '%s\n' "$line" >> "$out"; done
  chmod 600 "$out"
}

# Hệ tệp có tôn trọng chmod không? (Linux: có; git-bash/NTFS: thường không)
probe="$TMP/probe"; : > "$probe"; chmod 644 "$probe"
if [[ "$(stat -c '%a' "$probe" 2>/dev/null)" == "644" ]]; then chmod 600 "$probe"; [[ "$(stat -c '%a' "$probe")" == "600" ]] && PERM_OK=1 || PERM_OK=0; else PERM_OK=0; fi
if (( PERM_OK == 1 )); then OSVAL="Linux"; else OSVAL="MINGW64"; fi

# run_ve <file> [đối số/ENV bổ sung qua VE_ENV]: chạy script trong môi trường sạch từ cwd KHÁC; đặt RC và OUT (stdout+stderr gộp).
# Mọi lần chạy đều kiểm không rò giá trị bí mật.
VE_ENV=()
run_ve() {
  OUT="$(cd "$TMP/cwd" && env -i PATH="$PATH" HOME="${HOME:-/}" VERIFY_ENV_OS="$OSVAL" "${VE_ENV[@]}" bash "$SCRIPT" "$@" 2>&1)"
  RC=$?
  local s
  for s in "${SECRETS[@]}"; do
    [[ "$OUT" != *"$s"* ]] || { fail "RÒ BÍ MẬT: đầu ra chứa giá trị bí mật ($s) khi chạy: $*"; return 0; }
  done
  ok
}

# case_rc <mô tả> <rc mong đợi> <file> : chạy rồi kiểm mã thoát (đầu ra để kiểm tiếp bằng expect_*).
case_rc() { run_ve "$3"; expect_eq "$1 (mã thoát)" "$2" "$RC"; }
# line_has <cụm> <từ>: dòng đầu ra có <cụm> phải chứa <từ> nguyên (word) — tránh khớp nhầm tên khóa là chuỗi con của khóa khác.
expect_line_word() {
  local desc="$1" phrase="$2" word="$3" l
  l="$(grep -F -- "$phrase" <<<"$OUT" | head -n 1 || true)"
  if [[ -n "$l" ]] && grep -qw -- "$word" <<<"$l"; then ok; else fail "$desc: dòng chứa [$phrase] không có từ [$word]; đầu ra: ${OUT:0:500}"; fi
}

F="$TMP/case.env"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 1) .env.example đã điền => đạt; .env.example nguyên bản => lỗi placeholder =="
cp "$BASE" "$F"; chmod 600 "$F"
case_rc "[1] file nền (mẫu đã điền)" 0 "$F"
expect_contains "[1] báo OK" "OK" "$OUT"
expect_not_contains "[1] không có LỖI" "LỖI" "$OUT"
expect_not_contains "[1] không có khóa lạ trong mẫu thật" "khóa lạ" "$OUT"
cp "$EXAMPLE" "$TMP/orig.env"; chmod 600 "$TMP/orig.env"
case_rc "[1] .env.example nguyên bản" 1 "$TMP/orig.env"
expect_contains "[1] báo placeholder" "placeholder" "$OUT"
for k in MONGODB_URI REDIS_URL FRONTEND_URL MONGO_ROOT_PASSWORD JWT_SECRET CLOUDFLARE_TUNNEL_TOKEN; do
  expect_line_word "[1] nguyên bản: $k bị gọi tên là placeholder" "placeholder" "$k"
done

# ─────────────────────────────────────────────────────────────────────────────
echo "== 2) cách dùng: --help, sai cú pháp, thiếu file, chạy từ cwd khác, mặc định .env ở gốc =="
OUT="$(cd "$TMP/cwd" && env -i PATH="$PATH" HOME="${HOME:-/}" bash "$SCRIPT" --help 2>&1)"; RC=$?
expect_eq "[2] --help thoát 0" 0 "$RC"; expect_contains "[2] --help có Cách dùng" "Cách dùng" "$OUT"
run_ve --bogus; expect_eq "[2] cờ lạ thoát 2" 2 "$RC"
run_ve "$F" "$F"; expect_eq "[2] hai đối số thoát 2" 2 "$RC"
run_ve "$TMP/khong-co.env"; expect_eq "[2] thiếu file thoát 1" 1 "$RC"; expect_contains "[2] thiếu file nói rõ" "Không thấy" "$OUT"
# Mặc định = .env ở gốc repo chứa script: dựng cây tạm (script + ops/lib) rồi chạy từ cwd khác, không truyền đường dẫn.
T="$TMP/tree"; mkdir -p "$T/ops/lib"; cp "$SCRIPT" "$T/ops/verify-env.sh"; cp "$ROOT_DIR/ops/lib/ops-common.sh" "$T/ops/lib/"
cp "$BASE" "$T/.env"; chmod 600 "$T/.env"
OUT="$(cd "$TMP/cwd" && env -i PATH="$PATH" HOME="${HOME:-/}" VERIFY_ENV_OS="$OSVAL" bash "$T/ops/verify-env.sh" 2>&1)"; RC=$?
expect_eq "[2] mặc định đọc .env cạnh script, đạt" 0 "$RC"
expect_contains "[2] nêu đúng .env của cây tạm" "$T/.env" "$OUT"
rm "$T/.env"
OUT="$(cd "$TMP/cwd" && env -i PATH="$PATH" HOME="${HOME:-/}" VERIFY_ENV_OS="$OSVAL" bash "$T/ops/verify-env.sh" 2>&1)"; RC=$?
expect_eq "[2] không có .env => lỗi" 1 "$RC"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 3) khóa bắt buộc: thiếu / rỗng (mọi khóa bắt buộc) =="
REQUIRED_KEYS=(); CONDITIONAL_KEYS=(); OPTIONAL_KEYS=(); BOOLEAN_KEYS=()
eval "$(awk '/^(REQUIRED_KEYS|CONDITIONAL_KEYS|OPTIONAL_KEYS|BOOLEAN_KEYS)=\(/{p=1} p{print} p&&/\)[[:space:]]*$/{p=0}' "$SCRIPT")"
(( ${#REQUIRED_KEYS[@]} >= 15 )) && ok || fail "[3] không trích được REQUIRED_KEYS từ script (${#REQUIRED_KEYS[@]})"
for k in "${REQUIRED_KEYS[@]}"; do
  make_env "$F" "-$k"
  case_rc "[3] thiếu $k" 1 "$F"
  expect_line_word "[3] thiếu $k" "thiếu khóa bắt buộc" "$k"
  make_env "$F" "$k="
  case_rc "[3] rỗng $k" 1 "$F"
  expect_line_word "[3] rỗng $k" "đang để rỗng" "$k"
done
make_env "$F" "JWT_SECRET=   "
case_rc "[3] chỉ khoảng trắng coi như rỗng" 1 "$F"
expect_line_word "[3] khoảng trắng" "đang để rỗng" "JWT_SECRET"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 4) khóa cũ => lỗi (chỉ tên khóa) =="
for k in FEATURE_CRM_ENABLED FEATURE_CRM_PUSH VITE_API_URL VITE_CRM_ENABLED WP_API_URL WP_USERNAME WP_APP_PASSWORD GEMINI_API_KEY CRAWL_TARGET_URL; do
  make_env "$F" "$k=zq7old"
  case_rc "[4] khóa cũ $k" 1 "$F"
  expect_line_word "[4] khóa cũ $k" "khóa cũ" "$k"
  expect_not_contains "[4] $k không bị báo thêm là khóa lạ" "khóa lạ" "$OUT"
done
make_env "$F" "# FEATURE_CRM_ENABLED=true" "# VITE_X=1"
case_rc "[4] khóa cũ nằm trong comment thì bỏ qua" 0 "$F"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 5) placeholder, kể cả BÊN TRONG URL =="
make_env "$F" 'REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379'
case_rc "[5] <REDIS_PASSWORD> trong REDIS_URL" 1 "$F"; expect_line_word "[5] redis url" "placeholder" "REDIS_URL"
make_env "$F" 'MONGODB_URI=mongodb://<MONGO_ROOT_USERNAME>:<MONGO_ROOT_PASSWORD>@mongo:27017/realestate?authSource=admin&replicaSet=rs0'
case_rc "[5] cả user/pass mẫu trong MONGODB_URI" 1 "$F"; expect_line_word "[5] mongo uri" "placeholder" "MONGODB_URI"
make_env "$F" "MONGODB_URI=mongodb://remroot:${PW_M}@mongo:27017/<ten-db>?authSource=admin"
case_rc "[5] <...> ở đoạn đường dẫn của URI" 1 "$F"; expect_line_word "[5] mongo path" "placeholder" "MONGODB_URI"
make_env "$F" 'JWT_SECRET=<openssl rand -base64 48>'
case_rc "[5] giá trị toàn <...>" 1 "$F"; expect_line_word "[5] jwt" "placeholder" "JWT_SECRET"
make_env "$F" 'FRONTEND_URL=https://<domain-admin>'
case_rc "[5] host mẫu trong FRONTEND_URL" 1 "$F"; expect_line_word "[5] frontend" "placeholder" "FRONTEND_URL"
make_env "$F" 'MONGO_IMAGE=mongo@sha256:<digest>'
case_rc "[5] digest mẫu của *_IMAGE" 1 "$F"; expect_line_word "[5] image" "placeholder" "MONGO_IMAGE"
make_env "$F" 'BACKEND_IMAGE=realestatemanager-backend:<version>-<commit>'
case_rc "[5] tag mẫu của BACKEND_IMAGE" 1 "$F"; expect_line_word "[5] backend image" "placeholder" "BACKEND_IMAGE"
# Không báo nhầm: mật khẩu lạ có <...> không phải URL; fragment URL; placeholder nằm trong comment.
make_env "$F" 'ADMIN_PASSWORD=Ab<c>d9' 'GOOGLE_REDIRECT_URI=https://x.test/cb#frag<z>' '# MONGO_IMAGE=mongo@sha256:<digest>'
case_rc "[5] không báo nhầm mật khẩu Ab<c>d9, fragment, comment" 0 "$F"
expect_not_contains "[5] không nhắc placeholder" "placeholder" "$OUT"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 6) MONGODB_URI / REDIS_URL khớp MONGO_ROOT_*/REDIS_PASSWORD =="
make_env "$F" "MONGODB_URI=mongodb://remroot:${PW_WRONG}@mongo:27017/realestate?authSource=admin&replicaSet=rs0"
case_rc "[6] lệch mật khẩu Mongo" 1 "$F"
expect_contains "[6] nêu MONGO_ROOT_PASSWORD" "MONGODB_URI: mật khẩu KHÔNG khớp MONGO_ROOT_PASSWORD" "$OUT"
make_env "$F" "MONGODB_URI=mongodb://khac:${PW_M}@mongo:27017/realestate?authSource=admin&replicaSet=rs0"
case_rc "[6] lệch tên user Mongo" 1 "$F"; expect_contains "[6] nêu MONGO_ROOT_USERNAME" "MONGO_ROOT_USERNAME" "$OUT"
make_env "$F" "MONGODB_URI=mongodb://mongo:27017/realestate"
case_rc "[6] URI Mongo không có thông tin đăng nhập" 1 "$F"; expect_contains "[6] nêu thiếu đăng nhập" "thiếu thông tin đăng nhập" "$OUT"
make_env "$F" "MONGODB_URI=mongodb+srv://remroot:${PW_M}@cluster.example.test/db"
case_rc "[6] mongodb+srv bị từ chối" 1 "$F"
make_env "$F" "MONGODB_URI=http://remroot:${PW_M}@mongo:27017/realestate"
case_rc "[6] sai scheme Mongo" 1 "$F"
make_env "$F" "REDIS_URL=redis://:${PW_WRONG}@redis:6379"
case_rc "[6] lệch mật khẩu Redis" 1 "$F"; expect_contains "[6] nêu REDIS_PASSWORD" "REDIS_URL: mật khẩu KHÔNG khớp REDIS_PASSWORD" "$OUT"
make_env "$F" "REDIS_URL=redis://redis:6379"
case_rc "[6] Redis URL không có mật khẩu" 1 "$F"; expect_contains "[6] nêu thiếu mật khẩu" "thiếu mật khẩu" "$OUT"
make_env "$F" "REDIS_URL=redis://default:${PW_R}@redis:6379/0"
case_rc "[6] Redis URL có user default + db => khớp" 0 "$F"
make_env "$F" "REDIS_URL=rediss://:${PW_R}@redis:6380"
case_rc "[6] rediss:// khớp" 0 "$F"
# URL-encode: mật khẩu chứa ký tự đặc biệt, URI dùng bản %XX.
make_env "$F" 'MONGO_ROOT_PASSWORD=p@ss/w:rd#1' 'MONGODB_URI=mongodb://remroot:p%40ss%2Fw%3Ard%231@mongo:27017/realestate?authSource=admin&replicaSet=rs0'
case_rc "[6] mật khẩu đặc biệt, URI mã hóa %XX => khớp" 0 "$F"
make_env "$F" 'MONGO_ROOT_PASSWORD=p@ss/w:rd#1' 'MONGODB_URI=mongodb://remroot:p%40ss%2Fw%3Ard%232@mongo:27017/realestate?authSource=admin&replicaSet=rs0'
case_rc "[6] mật khẩu đặc biệt, URI mã hóa sai 1 ký tự => lệch" 1 "$F"
make_env "$F" 'MONGO_ROOT_PASSWORD=p%40ss' 'MONGODB_URI=mongodb://remroot:p%2540ss@mongo:27017/realestate?authSource=admin&replicaSet=rs0'
case_rc "[6] biến chứa sẵn %40, URI mã hóa lại (%2540) => khớp" 0 "$F"
make_env "$F" 'MONGO_ROOT_PASSWORD=abc123' 'MONGODB_URI=mongodb://remroot:abc123@mongo:27017/realestate?authSource=admin&replicaSet=rs0'
case_rc "[6] mật khẩu thường khớp nguyên văn" 0 "$F"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 7) FRONTEND_URL, NODE_ENV =="
for v in 'https://admin.example.test/' 'http://localhost:8080/'; do
  make_env "$F" "FRONTEND_URL=$v"; case_rc "[7] FRONTEND_URL có '/' cuối ($v)" 1 "$F"; expect_contains "[7] báo '/' cuối" "dấu '/' ở cuối" "$OUT"
done
for v in 'https://admin.example.test/admin' 'ftp://admin.example.test' 'admin.example.test' 'https://admin.example.test?x=1'; do
  make_env "$F" "FRONTEND_URL=$v"; case_rc "[7] FRONTEND_URL không phải origin ($v)" 1 "$F"; expect_line_word "[7] ($v)" "FRONTEND_URL phải là origin" "FRONTEND_URL"
done
for v in 'https://admin.example.test' 'http://localhost' 'http://localhost:8080' 'https://staging.stnd.vn'; do
  make_env "$F" "FRONTEND_URL=$v"; case_rc "[7] FRONTEND_URL hợp lệ ($v)" 0 "$F"
done
for v in development staging test Production; do
  make_env "$F" "NODE_ENV=$v"; case_rc "[7] NODE_ENV=$v" 1 "$F"; expect_line_word "[7] NODE_ENV=$v" "NODE_ENV phải là production" "NODE_ENV"
done

# ─────────────────────────────────────────────────────────────────────────────
echo "== 8) cờ boolean chỉ true|false =="
(( ${#BOOLEAN_KEYS[@]} >= 10 )) && ok || fail "[8] không trích được BOOLEAN_KEYS từ script"
for k in "${BOOLEAN_KEYS[@]}"; do
  make_env "$F" "$k=TRUE"; case_rc "[8] $k=TRUE (viết hoa)" 1 "$F"; expect_line_word "[8] $k" "cờ boolean" "$k"
  # =true hợp lệ (CRM_ENABLED/CRM_PUSH_ENABLED=true cần thêm khóa có điều kiện, nếu không sẽ lỗi vì lý do khác).
  make_env "$F" "$k=true" "CRM_PII_ENCRYPTION_KEY=$PII_KEY" "VAPID_PUBLIC_KEY=zq7pub" "VAPID_PRIVATE_KEY=zq7priv"; case_rc "[8] $k=true hợp lệ" 0 "$F"
done
for v in 1 0 yes no on off True False ' ' 'tru' 'true,'; do
  make_env "$F" "CRM_ENABLED=$v" "CRM_PII_ENCRYPTION_KEY=$PII_KEY"
  case_rc "[8] CRM_ENABLED=[$v]" 1 "$F"; expect_line_word "[8] CRM_ENABLED=[$v]" "cờ boolean" "CRM_ENABLED"
done
make_env "$F" "CRM_FEATURE_IN_APP_CALL="
case_rc "[8] cờ để rỗng" 1 "$F"
# Mọi khóa trong mẫu có giá trị true/false phải nằm trong BOOLEAN_KEYS (khóa cờ mới không được lọt khỏi kiểm tra).
MISSING_BOOL=""
while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(true|false)$ ]]; then
    printf '%s\n' "${BOOLEAN_KEYS[@]}" | grep -qx -- "${BASH_REMATCH[1]}" || MISSING_BOOL+=" ${BASH_REMATCH[1]}"
  fi
done < "$BASE"
expect_eq "[8] mọi khóa true/false của .env.example nằm trong BOOLEAN_KEYS" "" "$MISSING_BOOL"
make_env "$F" "CRM_MOCK_REPORTS=true"
case_rc "[8] CRM_MOCK_REPORTS=true chỉ cảnh báo" 0 "$F"; expect_contains "[8] cảnh báo mock" "CRM_MOCK_REPORTS=true" "$OUT"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 9) TRUSTED_PROXY_IP: một IPv4 đơn =="
for v in '10.213.77.0/24' '10.213.77.250/32' '300.1.1.1' '10.0.0' '10.0.0.1.5' 'proxy.local' '::1' '10.0.0.1,10.0.0.2' ''; do
  make_env "$F" "TRUSTED_PROXY_IP=$v"; case_rc "[9] TRUSTED_PROXY_IP=[$v]" 1 "$F"; expect_line_word "[9] [$v]" "TRUSTED_PROXY_IP phải là" "TRUSTED_PROXY_IP"
done
for v in 10.213.77.250 1.2.3.4 255.255.255.255 0.0.0.0 192.168.1.1; do
  make_env "$F" "TRUSTED_PROXY_IP=$v"; case_rc "[9] TRUSTED_PROXY_IP=$v hợp lệ" 0 "$F"
done
make_env "$F" "-TRUSTED_PROXY_IP"
case_rc "[9] không đặt TRUSTED_PROXY_IP (tùy chọn) => đạt" 0 "$F"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 10) khóa có điều kiện: CRM_PII_ENCRYPTION_KEY, VAPID_* =="
make_env "$F" "CRM_ENABLED=true" "CRM_PII_ENCRYPTION_KEY="
case_rc "[10] CRM bật, thiếu khóa PII" 1 "$F"; expect_line_word "[10] PII" "CRM_ENABLED=true nhưng" "CRM_PII_ENCRYPTION_KEY"
make_env "$F" "CRM_ENABLED=true" "-CRM_PII_ENCRYPTION_KEY"
case_rc "[10] CRM bật, không có dòng khóa PII" 1 "$F"
make_env "$F" "CRM_ENABLED=true" "CRM_PII_ENCRYPTION_KEY=$PII_KEY"
case_rc "[10] CRM bật, có khóa PII" 0 "$F"
make_env "$F" "CRM_ENABLED=false" "CRM_PII_ENCRYPTION_KEY="
case_rc "[10] CRM tắt, khóa PII rỗng" 0 "$F"
make_env "$F" "CRM_PUSH_ENABLED=true"
case_rc "[10] Push bật, thiếu cả hai VAPID" 1 "$F"
expect_line_word "[10] thiếu public" "CRM_PUSH_ENABLED=true nhưng" "VAPID_PUBLIC_KEY"; expect_line_word "[10] thiếu private" "CRM_PUSH_ENABLED=true nhưng" "VAPID_PRIVATE_KEY"
make_env "$F" "CRM_PUSH_ENABLED=true" "VAPID_PUBLIC_KEY=zq7pub"
case_rc "[10] Push bật, chỉ thiếu private" 1 "$F"
expect_line_word "[10] thiếu private" "CRM_PUSH_ENABLED=true nhưng" "VAPID_PRIVATE_KEY"
expect_not_contains "[10] public đã có không bị nêu" "VAPID_PUBLIC_KEY" "$(grep -F 'CRM_PUSH_ENABLED=true nhưng' <<<"$OUT")"
make_env "$F" "CRM_PUSH_ENABLED=true" "VAPID_PUBLIC_KEY=zq7pub" "VAPID_PRIVATE_KEY=zq7priv"
case_rc "[10] Push bật, đủ VAPID" 0 "$F"
make_env "$F" "CRM_PUSH_ENABLED=false"
case_rc "[10] Push tắt, VAPID rỗng" 0 "$F"
make_env "$F" "CRM_ENABLED=true" "CRM_PII_ENCRYPTION_KEY=$PII_KEY" "CRM_PUSH_ENABLED=true" "VAPID_PUBLIC_KEY=zq7pub" "VAPID_PRIVATE_KEY=zq7priv" "CRM_ATTACHMENTS_ENABLED=true"
case_rc "[10] bật CRM + attachments + push đủ khóa" 0 "$F"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 11) khóa lạ => chỉ cảnh báo; khóa tùy chọn đã biết thì không =="
make_env "$F" "FOO_BAR=zq7x" "CRM_ENABELD=true"
case_rc "[11] khóa lạ không làm hỏng" 0 "$F"
expect_contains "[11] cảnh báo khóa lạ" "khóa lạ" "$OUT"
expect_line_word "[11] gọi tên FOO_BAR" "khóa lạ" "FOO_BAR"; expect_line_word "[11] gọi tên CRM_ENABELD (gõ sai)" "khóa lạ" "CRM_ENABELD"
make_env "$F" "CRM_PII_ENCRYPTION_KEY_V1=zq7a" "CRM_PII_ENCRYPTION_KEY_V12=zq7b"
case_rc "[11] CRM_PII_ENCRYPTION_KEY_V<n> hợp lệ" 0 "$F"; expect_not_contains "[11] V<n> không bị coi là lạ" "khóa lạ" "$OUT"
KNOWN_OPT=(SETTINGS_CONFIG_FILE=/app/state/ai.env CRON_CONFIG_FILE=/app/state/cron.env DEV_MONGO_PORT=27017 DEV_REDIS_PORT=6379 DEV_MINIO_CONSOLE_PORT=9001
  S3_APP_ACCESS_KEY_ID=app S3_APP_SECRET_ACCESS_KEY=zq7s3app MINIO_IMAGE=cgr.dev/chainguard/minio@sha256:abc MONGO_IMAGE=mongo@sha256:abc
  REDIS_IMAGE=redis@sha256:abc NINE_ROUTER_IMAGE=x@sha256:abc CLOUDFLARED_IMAGE=y@sha256:abc BACKEND_IMAGE=realestatemanager-backend:current
  FRONTEND_IMAGE=realestatemanager-frontend:current FRONTEND_PORT=8080 TRUST_PROXY=1 AUTH_LOGIN_THROTTLE_LIMIT=100 NINE_ROUTER_BIND_ADDR=127.0.0.1 S3_ENDPOINT=http://minio:9000)
make_env "$F" "${KNOWN_OPT[@]}"
case_rc "[11] khóa tùy chọn đã biết (SETTINGS_CONFIG_FILE, CRON_CONFIG_FILE, DEV_*_PORT, *_IMAGE, S3_APP_*...) không bị cảnh báo" 0 "$F"
expect_not_contains "[11] không cảnh báo khóa lạ" "khóa lạ" "$OUT"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 12) quyền file 600 =="
# (a) Mô phỏng Linux bằng stub `stat` (in FAKE_STAT_MODE) + VERIFY_ENV_OS=Linux: chạy được cả trên Windows, không phụ thuộc hệ tệp.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/stat" <<'STUB'
#!/usr/bin/env bash
echo "${FAKE_STAT_MODE:-600}"
STUB
chmod +x "$TMP/bin/stat"
cp "$BASE" "$F"
OSVAL_SAVE="$OSVAL"; OSVAL="Linux"
for m in 644 640 604 660 666 755 777 601 070; do
  VE_ENV=(PATH="$TMP/bin:$PATH" FAKE_STAT_MODE="$m"); case_rc "[12] quyền $m (stub stat)" 1 "$F"
  expect_contains "[12] nêu quyền rộng ($m)" "rộng hơn 600" "$OUT"
done
for m in 600 400 700 500; do
  VE_ENV=(PATH="$TMP/bin:$PATH" FAKE_STAT_MODE="$m"); case_rc "[12] quyền $m hợp lệ (stub stat)" 0 "$F"
done
VE_ENV=(PATH="$TMP/bin:$PATH" FAKE_STAT_MODE="rac-roi"); case_rc "[12] không đọc được quyền: chỉ cảnh báo" 0 "$F"; expect_contains "[12] cảnh báo không đọc được quyền" "không đọc được quyền" "$OUT"
VE_ENV=(); OSVAL="$OSVAL_SAVE"
# (b) Hệ tệp thật (chỉ khi tôn trọng chmod: Linux/CI).
if (( PERM_OK == 1 )); then
  cp "$BASE" "$F"
  for m in 644 640 666 777; do
    chmod "$m" "$F"; case_rc "[12] quyền thật $m" 1 "$F"; expect_contains "[12] nêu quyền rộng ($m)" "rộng hơn 600" "$OUT"
  done
  for m in 600 400; do chmod "$m" "$F"; case_rc "[12] quyền thật $m hợp lệ" 0 "$F"; done
else
  echo "  (bỏ qua ca chmod thật: hệ tệp này không tôn trọng chmod, vd git-bash/NTFS; đã có ca stub stat ở trên)"
fi
# Trên Windows (giả bằng VERIFY_ENV_OS) quyền rộng không phải lỗi, chỉ cảnh báo bỏ qua.
cp "$BASE" "$F"; chmod 644 "$F"
OSVAL_SAVE="$OSVAL"; for os in MINGW64_NT-10.0 MSYS_NT-10.0 CYGWIN_NT-10.0; do
  OSVAL="$os"; case_rc "[12] $os: không kiểm quyền" 0 "$F"; expect_contains "[12] $os: có cảnh báo bỏ qua" "bỏ qua kiểm quyền" "$OUT"
done; OSVAL="$OSVAL_SAVE"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 13) khai báo trùng, định dạng dòng =="
make_env "$F" "+JWT_SECRET=$JWT"
case_rc "[13] khóa trùng cùng giá trị: cảnh báo" 0 "$F"; expect_contains "[13] cảnh báo trùng" "nhiều lần (cùng giá trị)" "$OUT"
make_env "$F" "+JWT_SECRET=zq7khac"
case_rc "[13] khóa trùng khác giá trị: lỗi" 1 "$F"; expect_line_word "[13] gọi tên JWT_SECRET" "giá trị KHÁC nhau" "JWT_SECRET"
make_env "$F" "+đây không phải dòng KEY=VALUE"
case_rc "[13] dòng rác: cảnh báo" 0 "$F"; expect_contains "[13] nêu dòng không hợp lệ" "không phải KEY=VALUE" "$OUT"
make_env "$F" 'ADMIN_EMAIL="admin@example.test"' 'ADMIN_DISPLAY_NAME=Admin # ghi chu' 'LOG_DIR=a$b'
case_rc "[13] nháy bao / chú thích cuối dòng / ký tự \$: cảnh báo" 0 "$F"
expect_contains "[13] cảnh báo giá trị rủi ro" "nháy bao" "$OUT"
for k in ADMIN_EMAIL ADMIN_DISPLAY_NAME LOG_DIR; do expect_line_word "[13] gọi tên $k" "nháy bao" "$k"; done
make_env "$F" 'MONGO_ROOT_PASSWORD="abc123"' 'MONGODB_URI=mongodb://remroot:abc123@mongo:27017/realestate?authSource=admin&replicaSet=rs0'
case_rc "[13] giá trị bọc nháy vẫn so khớp URI theo giá trị bên trong" 0 "$F"
# CRLF: chuyển file nền sang CRLF; vẫn đạt nhưng cảnh báo.
sed 's/$/\r/' "$BASE" > "$F"; chmod 600 "$F"
case_rc "[13] CRLF: cảnh báo, vẫn đạt" 0 "$F"; expect_contains "[13] nêu CRLF" "CRLF" "$OUT"
# Nhiều lỗi cùng lúc: báo đủ, không dừng ở lỗi đầu.
make_env "$F" "-JWT_SECRET" "NODE_ENV=dev" "FRONTEND_URL=https://a.test/" "CRM_ENABLED=1" "VITE_X=1"
case_rc "[13] nhiều lỗi cùng lúc" 1 "$F"
for phrase in "thiếu khóa bắt buộc" "NODE_ENV phải là" "dấu '/' ở cuối" "cờ boolean" "khóa cũ"; do expect_contains "[13] gom đủ lỗi: $phrase" "$phrase" "$OUT"; done
expect_contains "[13] tổng kết số lỗi" "KHÔNG ĐẠT: 5 lỗi" "$OUT"

# ─────────────────────────────────────────────────────────────────────────────
echo "== 14) không rò bí mật: mọi lần chạy ở trên đã dò; thêm ca lệch mật khẩu + sai mọi thứ, quét thẳng stdout và stderr riêng =="
make_env "$F" "MONGODB_URI=mongodb://remroot:${PW_WRONG}@mongo:27017/realestate" "REDIS_URL=redis://:${PW_WRONG}@redis:6379" "NODE_ENV=dev" "CRM_ENABLED=yes" \
  "TRUSTED_PROXY_IP=${ADMIN_PW}" "FRONTEND_URL=${JWT}/" "JWT_SECRET=${JWT}"
STDOUT="$(cd "$TMP/cwd" && env -i PATH="$PATH" HOME="${HOME:-/}" VERIFY_ENV_OS="$OSVAL" bash "$SCRIPT" "$F" 2>"$TMP/stderr.txt")"; RC=$?
STDERR="$(cat "$TMP/stderr.txt")"
expect_eq "[14] mã thoát 1" 1 "$RC"
for s in "${SECRETS[@]}"; do
  expect_not_contains "[14] stdout không chứa $s" "$s" "$STDOUT"
  expect_not_contains "[14] stderr không chứa $s" "$s" "$STDERR"
done

# ─────────────────────────────────────────────────────────────────────────────
echo "== 15) đồng bộ danh sách khóa của script với .env.example (chống lệch) =="
# Phân loại theo quy ước của mẫu: khóa có dòng `# optional` ở khối chú thích NGAY TRƯỚC (kể cả khóa bị comment `# KEY=`) là tùy chọn;
# khóa không comment, không có `# optional` là bắt buộc (gồm 3 khóa có điều kiện CRM_PII_ENCRYPTION_KEY, VAPID_PUBLIC/PRIVATE_KEY).
EX_REQ=(); EX_OPT=(); opt=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  if [[ "$line" == "# optional" ]]; then opt=1; continue; fi
  if [[ "$line" =~ ^#[[:space:]]([A-Z][A-Z0-9_]*)= ]]; then
    ck="${BASH_REMATCH[1]}"
    [[ "$ck" =~ ^CRM_PII_ENCRYPTION_KEY_V[0-9]+$ ]] || EX_OPT+=("$ck"); opt=0; continue
  fi
  [[ "$line" == \#* ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
    if (( opt == 1 )); then EX_OPT+=("${BASH_REMATCH[1]}"); else EX_REQ+=("${BASH_REMATCH[1]}"); fi
  fi
  opt=0
done < "$EXAMPLE"
srt() { printf '%s\n' "$@" | LC_ALL=C sort -u | paste -sd ' ' -; }
SC_REQ="$(srt "${REQUIRED_KEYS[@]}" "${CONDITIONAL_KEYS[@]}")"; MZ_REQ="$(srt "${EX_REQ[@]}")"
expect_eq "[15] khóa bắt buộc của script (gồm có điều kiện) = khóa không-optional của .env.example" "$MZ_REQ" "$SC_REQ"
expect_eq "[15] khóa tùy chọn của script = khóa optional của .env.example" "$(srt "${EX_OPT[@]}")" "$(srt "${OPTIONAL_KEYS[@]}")"
expect_eq "[15] 3 khóa có điều kiện" "CRM_PII_ENCRYPTION_KEY VAPID_PRIVATE_KEY VAPID_PUBLIC_KEY" "$(srt "${CONDITIONAL_KEYS[@]}")"
for k in "${BOOLEAN_KEYS[@]}"; do
  printf '%s\n' "${OPTIONAL_KEYS[@]}" | grep -qx -- "$k" && ok || fail "[15] BOOLEAN_KEYS có $k nhưng không phải khóa tùy chọn của mẫu"
done

# ─────────────────────────────────────────────────────────────────────────────
echo "== 16) tĩnh: cú pháp, EOL LF, tái dùng ops-common, không in giá trị =="
bash -n "$SCRIPT" 2>/dev/null && ok || fail "[16] bash -n verify-env.sh lỗi cú pháp"
bash -n "$TEST_DIR/verify-env.test.sh" 2>/dev/null && ok || fail "[16] bash -n verify-env.test.sh lỗi cú pháp"
for f in "$SCRIPT" "$TEST_DIR/verify-env.test.sh"; do
  expect_eq "[16] $(basename "$f") không có CR (EOL LF)" "0" "$(tr -cd '\r' < "$f" | wc -c | tr -d '[:space:]')"
done
expect_eq "[16] dòng đầu là shebang bash" "#!/usr/bin/env bash" "$(head -n 1 "$SCRIPT")"
expect_contains "[16] source ops-common.sh" 'source "$ROOT_DIR/ops/lib/ops-common.sh"' "$(cat "$SCRIPT")"
expect_contains "[16] tái dùng list_placeholder_vars" "list_placeholder_vars" "$(cat "$SCRIPT")"
expect_contains "[16] tái dùng file_mode" "file_mode" "$(cat "$SCRIPT")"
# Không có lệnh in giá trị biến bí mật: không có dòng nào in "${VAL[...]}" / "$URI_PASS" / "$URI_USER" qua err/warning/log/echo/printf.
LEAKY="$(grep -nE '(err|warning|log|warn|die|echo|printf)[^#]*(\$\{VAL\[|\$URI_PASS|\$URI_USER|\$raw\b|\$ip\b|\$\(get )' "$SCRIPT" | grep -vE 'printf -v|printf .%s. "\$out|local |get\(\)|^\s*#' || true)"
expect_eq "[16] không có chỗ nào in giá trị biến ra màn hình" "" "$LEAKY"

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
