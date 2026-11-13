#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/verify-env.sh — kiểm tra file `.env` (mẫu duy nhất: .env.example, v1.0.6 FR-18) TRƯỚC khi deploy/khởi động stack.
#
#   bash ops/verify-env.sh [FILE]      # mặc định: .env ở gốc repo; chạy được từ mọi thư mục làm việc
#   bash ops/verify-env.sh --help
#
# Kiểm (lỗi => thoát 1):
#   1. đủ khóa bắt buộc và không rỗng; có điều kiện: CRM_PII_ENCRYPTION_KEY khi CRM_ENABLED=true,
#      VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT khi CRM_PUSH_ENABLED=true (compose để VAPID_* tùy chọn, nên cùng một quy tắc);
#   2. không còn khóa cũ: FEATURE_CRM_*, VITE_*, WP_API_URL, WP_USERNAME, WP_APP_PASSWORD, GEMINI_API_KEY, CRAWL_TARGET_URL;
#   3. không placeholder `<...>` (kể cả BÊN TRONG URL: redis://:<REDIS_PASSWORD>@redis:6379) và digest mẫu của `*_IMAGE`;
#   4. FRONTEND_URL là origin (scheme://host[:port]) không có `/` cuối; NODE_ENV=production;
#   5. cờ boolean chỉ nhận đúng `true` hoặc `false` (chữ thường; không 1/yes/on);
#   6. TRUSTED_PROXY_IP (nếu có) là MỘT IPv4 đơn, không CIDR, không phải 0.0.0.0; các khóa cổng (FRONTEND_PORT, DEV_*_PORT) là số nguyên 1..65535;
#   7. MONGODB_URI/REDIS_URL khớp MONGO_ROOT_USERNAME/MONGO_ROOT_PASSWORD/REDIS_PASSWORD (xử lý URL-encode);
#   8. không khai báo trùng khóa với hai giá trị khác nhau;
#   9. quyền file 600 (group/other không được đọc). Trên Windows (git-bash/msys) không có quyền POSIX nên chỉ cảnh báo.
# Chỉ cảnh báo (vẫn thoát 0): khóa lạ (không thuộc tập đã biết của .env.example), dòng không phải KEY=VALUE, giá trị có nháy bao /
# chú thích cuối dòng / ký tự $ ` \ , cờ CRM_MOCK_* bật, khóa trùng cùng giá trị, file CRLF.
#
# BÍ MẬT: chỉ in TÊN khóa, KHÔNG bao giờ in giá trị (kể cả khi lệch mật khẩu trong URI).
# Mã thoát: 0 = hợp lệ (cảnh báo vẫn 0), 1 = có lỗi, 2 = dùng sai cú pháp lệnh.
# Danh sách khóa dưới đây phải khớp .env.example (ops/tests/verify-env.test.sh đối chiếu hai bên).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="verify-env"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[verify-env] LỖI: không resolve được đường dẫn thật của script (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")/.." && pwd)"
# shellcheck source=ops/lib/ops-common.sh
source "$ROOT_DIR/ops/lib/ops-common.sh"

usage() {
  cat <<'EOF'
Cách dùng: bash ops/verify-env.sh [FILE]
  FILE   đường dẫn file env cần kiểm (mặc định: .env ở gốc repo).
Kiểm đủ khóa bắt buộc, khóa cũ, placeholder, FRONTEND_URL, NODE_ENV, cờ boolean, TRUSTED_PROXY_IP, khớp mật khẩu Mongo/Redis,
quyền file 600, khóa lạ (cảnh báo). Không in giá trị bí mật. Thoát 0 = hợp lệ, 1 = có lỗi, 2 = sai cú pháp lệnh.
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  -*) usage >&2; exit 2 ;;
esac
(( $# <= 1 )) || { usage >&2; exit 2; }
ENV_FILE="${1:-$ROOT_DIR/.env}"

# ── Danh sách khóa (khớp .env.example) ───────────────────────────────────────
# Bắt buộc, không rỗng.
REQUIRED_KEYS=(
  NODE_ENV
  MONGO_ROOT_USERNAME MONGO_ROOT_PASSWORD MONGO_KEYFILE MONGODB_URI
  REDIS_PASSWORD REDIS_URL
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET_ATTACHMENTS S3_BUCKET_EXPORTS
  JWT_SECRET COOKIE_SECRET FRONTEND_URL ADMIN_EMAIL ADMIN_PASSWORD
  CLOUDFLARE_TUNNEL_TOKEN NINE_ROUTER_INITIAL_PASSWORD
)
# Có mặt trong mẫu nhưng được phép rỗng (bắt buộc có điều kiện, hoặc rỗng = tắt).
CONDITIONAL_KEYS=(CRM_PII_ENCRYPTION_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT)
# Tùy chọn (có dòng `# optional` trong mẫu, kể cả khi bị comment).
OPTIONAL_KEYS=(
  REDIS_KEY_PREFIX
  S3_APP_ACCESS_KEY_ID S3_APP_SECRET_ACCESS_KEY S3_ENDPOINT S3_PUBLIC_ENDPOINT S3_REGION S3_FORCE_PATH_STYLE S3_SIGNED_URL_TTL_SECONDS
  PORT JWT_ACCESS_EXPIRES_IN JWT_REFRESH_EXPIRES_IN ADMIN_DISPLAY_NAME TRUST_PROXY AUTH_LOGIN_THROTTLE_LIMIT
  HELMET_CSP_ENABLED QUEUE_WORKERS_ENABLED IDEMPOTENCY_TTL_MS IDEMPOTENCY_INFLIGHT_TTL_MS APP_TIMEZONE_OFFSET_HOURS
  CRM_ENABLED CRM_ATTACHMENTS_ENABLED CRM_PUSH_ENABLED CRM_IMPORT_ENABLED
  CRM_FEATURE_ZALO_ZNS CRM_FEATURE_IN_APP_CALL CRM_FEATURE_APPOINTMENT_SYNC CRM_MOCK_REPORTS CRM_MOCK_IMPORT_EXPORT CRM_SWAGGER_ENABLED
  CRM_PII_KEY_VERSION PUSH_ENDPOINT_HOST_ALLOWLIST
  BACKEND_UPSTREAM TRUSTED_PROXY_IP CLIENT_MAX_BODY FRONTEND_PORT API_URL
  NINE_ROUTER_BIND_ADDR DEV_MONGO_PORT DEV_REDIS_PORT DEV_MINIO_CONSOLE_PORT DEV_BACKEND_PORT DEV_NODE_ENV
  BACKEND_IMAGE FRONTEND_IMAGE MINIO_IMAGE MONGO_IMAGE REDIS_IMAGE NINE_ROUTER_IMAGE CLOUDFLARED_IMAGE
  DAILY_CRAWLER_ACTIVE DAILY_CRAWLER_FREQUENCY CRON_CONFIG_FILE SETTINGS_CONFIG_FILE
  ACTIVE_AI_PLATFORM OPENROUTER_API_KEY OPENROUTER_AI_PROVIDER OPENROUTER_AI_MODEL MUST1C_API_KEY MUST1C_API_URL MUST1C_MODEL
  NINEROUTER_BASE_URL NINEROUTER_API_KEY NINEROUTER_MODEL COMFYUI_URL FIRECRAWL_API_KEY
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI GOOGLE_OAUTH_STATE_SECRET
  DEDUP_THRESHOLD DEDUP_WINDOW_DAYS EMBEDDING_MODEL EMBEDDING_DIMENSIONS
  LOG_LEVEL LOG_DIR LOG_RETENTION_DAYS ENABLE_EXTERNAL_LOGGING MAX_LOG_BODY_BYTES
)
# Khóa cổng host: số nguyên 1..65535.
PORT_KEYS=(FRONTEND_PORT DEV_MONGO_PORT DEV_REDIS_PORT DEV_MINIO_CONSOLE_PORT DEV_BACKEND_PORT)
# Khóa xoay PII theo phiên bản: CRM_PII_ENCRYPTION_KEY_V<n> (không liệt kê hết được).
PII_VERSIONED_RE='^CRM_PII_ENCRYPTION_KEY_V[0-9]+$'
# Cờ boolean: chỉ nhận đúng true|false (frontend/entrypoint kiểm chặt; backend nhận thêm 1/yes/on nhưng KHÔNG được dùng).
BOOLEAN_KEYS=(
  CRM_ENABLED CRM_ATTACHMENTS_ENABLED CRM_PUSH_ENABLED CRM_IMPORT_ENABLED
  CRM_FEATURE_ZALO_ZNS CRM_FEATURE_IN_APP_CALL CRM_FEATURE_APPOINTMENT_SYNC CRM_MOCK_REPORTS CRM_MOCK_IMPORT_EXPORT CRM_SWAGGER_ENABLED
  HELMET_CSP_ENABLED QUEUE_WORKERS_ENABLED S3_FORCE_PATH_STYLE DAILY_CRAWLER_ACTIVE ENABLE_EXTERNAL_LOGGING
)
# Khóa đã bỏ (chính xác) và tiền tố đã bỏ: còn trong .env nghĩa là chưa chuyển sang mẫu mới.
OLD_EXACT_KEYS=(WP_API_URL WP_USERNAME WP_APP_PASSWORD GEMINI_API_KEY CRAWL_TARGET_URL)
OLD_KEY_RE='^(FEATURE_CRM_|VITE_)'

# ── Báo lỗi/cảnh báo: chỉ tên khóa ───────────────────────────────────────────
ERRORS=0
WARNINGS=0
err()  { ERRORS=$((ERRORS + 1)); printf '[%s] LỖI: %s\n' "$LOG_PREFIX" "$*" >&2; }
warning() { WARNINGS=$((WARNINGS + 1)); warn "$*"; }

in_list() { # in_list <giá trị> <phần tử...>
  local needle="$1" x; shift
  for x in "$@"; do [[ "$x" == "$needle" ]] && return 0; done
  return 1
}

# Giải mã %XX của URL (chỉ dùng để SO SÁNH, không in).
urldecode() {
  local s="$1" out="" hex ch
  while [[ "$s" =~ ^([^%]*)%([0-9A-Fa-f]{2})(.*)$ ]]; do
    out+="${BASH_REMATCH[1]}"; hex="${BASH_REMATCH[2]}"; s="${BASH_REMATCH[3]}"
    printf -v ch "\\x${hex}"
    out+="$ch"
  done
  printf '%s' "$out$s"
}

# Mã hóa %XX theo RFC 3986 (giữ A-Za-z0-9._~-), duyệt theo byte.
urlencode() {
  local LC_ALL=C s="$1" out="" i c
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    if [[ "$c" =~ ^[A-Za-z0-9._~-]$ ]]; then out+="$c"; else out+="$(printf '%%%02X' "'$c")"; fi
  done
  printf '%s' "$out"
}

# secret_matches <phần trong URI> <giá trị biến>: khớp khi bằng nguyên văn, hoặc sau khi giải mã %XX, hoặc bằng bản mã hóa của biến.
secret_matches() {
  local in_uri="$1" var="$2"
  [[ "$in_uri" == "$var" ]] && return 0
  [[ "$(urldecode "$in_uri")" == "$var" ]] && return 0
  [[ "$in_uri" == "$(urlencode "$var")" ]] && return 0
  return 1
}

# ── Đọc file ─────────────────────────────────────────────────────────────────
[[ -f "$ENV_FILE" ]] || die "Không thấy file env: $ENV_FILE (tạo từ .env.example: cp .env.example .env && chmod 600 .env)."
[[ -r "$ENV_FILE" ]] || die "Không đọc được file env: $ENV_FILE."

declare -A VAL=()        # khóa -> giá trị (đã trim, đã bỏ nháy bao)
declare -A RISKY=()      # khóa có nháy bao / chú thích cuối dòng / ký tự $ ` \
declare -A PLACEHOLDER=() # khóa còn giá trị mẫu
LINE_NO=0
CRLF_SEEN=0
BAD_LINES=""
DUP_SAME=""
DUP_DIFF=""
while IFS= read -r line || [[ -n "$line" ]]; do
  LINE_NO=$((LINE_NO + 1))
  if [[ "$line" == *$'\r' ]]; then CRLF_SEEN=1; line="${line%$'\r'}"; fi
  [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
  if [[ ! "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    BAD_LINES+="${BAD_LINES:+, }$LINE_NO"
    continue
  fi
  key="${BASH_REMATCH[1]}"; raw="${BASH_REMATCH[2]}"
  # Trim hai đầu.
  raw="${raw#"${raw%%[![:space:]]*}"}"; raw="${raw%"${raw##*[![:space:]]}"}"
  if [[ "$raw" =~ ^\"(.*)\"$ || "$raw" =~ ^\'(.*)\'$ ]]; then
    RISKY[$key]=1; raw="${BASH_REMATCH[1]}"
  elif [[ "$raw" =~ [[:space:]]# || "$raw" == *'$'* || "$raw" == *'`'* || "$raw" == *'\'* ]]; then
    RISKY[$key]=1
  fi
  if [[ -v "VAL[$key]" ]]; then
    if [[ "${VAL[$key]}" == "$raw" ]]; then DUP_SAME+="${DUP_SAME:+ }$key"; else DUP_DIFF+="${DUP_DIFF:+ }$key"; fi
  fi
  VAL[$key]="$raw"
done < "$ENV_FILE"

get() { if [[ -v "VAL[$1]" ]]; then printf '%s' "${VAL[$1]}"; fi; }   # in giá trị ra biến nội bộ, KHÔNG in ra màn hình
has() { [[ -v "VAL[$1]" ]]; }
nonempty() { has "$1" && [[ -n "${VAL[$1]}" ]]; }

(( CRLF_SEEN == 0 )) || warning "$ENV_FILE dùng xuống dòng CRLF; nên chuyển sang LF (dos2unix) để mọi công cụ đọc giống nhau."
[[ -z "$BAD_LINES" ]] || warning "$ENV_FILE có dòng không phải KEY=VALUE/chú thích (bị bỏ qua) ở số dòng: $BAD_LINES."
[[ -z "$DUP_SAME" ]] || warning "khóa khai báo nhiều lần (cùng giá trị): $DUP_SAME."
[[ -z "$DUP_DIFF" ]] || err "khóa khai báo nhiều lần với giá trị KHÁC nhau (dotenv lấy dòng đầu, compose lấy dòng cuối): $DUP_DIFF."

# ── 1) Quyền file ────────────────────────────────────────────────────────────
OS_NAME="${VERIFY_ENV_OS:-$(uname -s 2>/dev/null || echo unknown)}"
case "$OS_NAME" in
  MINGW*|MSYS*|CYGWIN*)
    warning "bỏ qua kiểm quyền 600 trên $OS_NAME (không có quyền POSIX); trên máy chủ Linux phải là 600." ;;
  *)
    mode="$(file_mode "$ENV_FILE" 2>/dev/null || true)"
    if [[ ! "$mode" =~ ^[0-7]+$ ]]; then
      warning "không đọc được quyền của $ENV_FILE."
    elif (( (8#$mode & 8#077) != 0 )); then
      err "$ENV_FILE có quyền $mode, rộng hơn 600 (chứa bí mật). Chạy: chmod 600 $ENV_FILE"
    fi ;;
esac

# ── 2) Khóa cũ ───────────────────────────────────────────────────────────────
OLD_FOUND=""
for k in "${!VAL[@]}"; do
  if [[ "$k" =~ $OLD_KEY_RE ]] || in_list "$k" "${OLD_EXACT_KEYS[@]}"; then OLD_FOUND+="$k"$'\n'; fi
done
if [[ -n "$OLD_FOUND" ]]; then
  err "còn khóa cũ đã bỏ ở mẫu mới (xóa hoặc đổi tên, đối chiếu .env.example): $(sort <<<"${OLD_FOUND%$'\n'}" | paste -sd ' ' -)"
fi

# ── 3) Khóa bắt buộc ─────────────────────────────────────────────────────────
MISSING=""; EMPTY=""
for k in "${REQUIRED_KEYS[@]}"; do
  if ! has "$k"; then MISSING+="${MISSING:+ }$k"
  elif [[ -z "${VAL[$k]}" ]]; then EMPTY+="${EMPTY:+ }$k"; fi
done
[[ -z "$MISSING" ]] || err "thiếu khóa bắt buộc: $MISSING"
[[ -z "$EMPTY" ]] || err "khóa bắt buộc đang để rỗng: $EMPTY"

# Có điều kiện (chỉ xét khi cờ đúng `true`; cờ sai giá trị thì đã báo ở bước boolean).
if [[ "$(get CRM_ENABLED)" == "true" ]] && ! nonempty CRM_PII_ENCRYPTION_KEY; then
  err "CRM_ENABLED=true nhưng CRM_PII_ENCRYPTION_KEY thiếu hoặc rỗng (sinh bằng: openssl rand -base64 32, và SAO LƯU trước khi bật)."
fi
if [[ "$(get CRM_PUSH_ENABLED)" == "true" ]]; then
  PUSH_MISSING=""
  for k in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT; do nonempty "$k" || PUSH_MISSING+="${PUSH_MISSING:+ }$k"; done
  [[ -z "$PUSH_MISSING" ]] || err "CRM_PUSH_ENABLED=true nhưng thiếu hoặc rỗng: $PUSH_MISSING"
fi

# ── 4) Placeholder (dùng lại list_placeholder_vars của ops-common; gom lỗi thay vì dừng ngay) ──
PH_NAMES="$(list_placeholder_vars "$ENV_FILE" | sort -u)"
# Digest mẫu của *_IMAGE (vd @sha256:<digest>) mà list_placeholder_vars không bắt (không dạng URL).
for k in "${!VAL[@]}"; do
  if [[ "$k" == *_IMAGE && "${VAL[$k]}" == *'<'*'>'* ]]; then PH_NAMES+="${PH_NAMES:+$'\n'}$k"; fi
done
PH_NAMES="$(sort -u <<<"$PH_NAMES" | sed '/^$/d')"
if [[ -n "$PH_NAMES" ]]; then
  while IFS= read -r k; do PLACEHOLDER[$k]=1; done <<<"$PH_NAMES"
  err "còn giá trị mẫu (placeholder dạng <...>) ở: $(paste -sd ' ' - <<<"$PH_NAMES") (điền giá trị thật, đối chiếu .env.example)."
fi

# ── 5) NODE_ENV, FRONTEND_URL ────────────────────────────────────────────────
if nonempty NODE_ENV && [[ "${VAL[NODE_ENV]}" != "production" ]]; then
  err "NODE_ENV phải là production ở MỌI môi trường (kể cả dev); hiện là giá trị khác."
fi
if nonempty FRONTEND_URL && [[ -z "${PLACEHOLDER[FRONTEND_URL]:-}" ]]; then
  if [[ "${VAL[FRONTEND_URL]}" == */ ]]; then
    err "FRONTEND_URL không được có dấu '/' ở cuối (CORS khớp nguyên văn origin)."
  elif [[ ! "${VAL[FRONTEND_URL]}" =~ ^https?://[^/?#[:space:]]+$ ]]; then
    err "FRONTEND_URL phải là origin dạng http(s)://host[:port], không đường dẫn/query."
  fi
fi

# ── 6) Cờ boolean ────────────────────────────────────────────────────────────
BAD_BOOL=""
for k in "${BOOLEAN_KEYS[@]}"; do
  has "$k" || continue
  [[ "${VAL[$k]}" == "true" || "${VAL[$k]}" == "false" ]] || BAD_BOOL+="${BAD_BOOL:+ }$k"
done
[[ -z "$BAD_BOOL" ]] || err "cờ boolean chỉ nhận đúng 'true' hoặc 'false' (chữ thường; không 1/yes/on/True), sai ở: $BAD_BOOL"
for k in CRM_MOCK_REPORTS CRM_MOCK_IMPORT_EXPORT; do
  [[ "$(get "$k")" != "true" ]] || warning "$k=true: chỉ dùng cho DEV (dữ liệu mẫu); production/staging phải để false."
done

# ── 7) TRUSTED_PROXY_IP: một IPv4 đơn ────────────────────────────────────────
if has TRUSTED_PROXY_IP && [[ -z "${PLACEHOLDER[TRUSTED_PROXY_IP]:-}" ]]; then
  ip="${VAL[TRUSTED_PROXY_IP]}"
  octet='(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
  if [[ ! "$ip" =~ ^$octet\.$octet\.$octet\.$octet$ ]]; then
    err "TRUSTED_PROXY_IP phải là MỘT địa chỉ IPv4 đơn (vd 10.213.77.250), không CIDR/dải/hostname."
  elif [[ "$ip" == "0.0.0.0" ]]; then
    err "TRUSTED_PROXY_IP không được là 0.0.0.0 (địa chỉ không xác định; phải là IP tĩnh của cloudflared trong subnet realestate_net)."
  fi
fi

# Cổng host: số nguyên 1..65535 (chuỗi rỗng bỏ qua: compose rơi về mặc định).
BAD_PORT=""
for k in "${PORT_KEYS[@]}"; do
  nonempty "$k" || continue
  [[ "${VAL[$k]}" =~ ^[0-9]{1,5}$ ]] && (( 10#${VAL[$k]} >= 1 && 10#${VAL[$k]} <= 65535 )) || BAD_PORT+="${BAD_PORT:+ }$k"
done
[[ -z "$BAD_PORT" ]] || err "khóa cổng phải là số nguyên 1..65535, sai ở: $BAD_PORT"

# ── 8) MONGODB_URI/REDIS_URL khớp biến thành phần ────────────────────────────
# Tách userinfo của URI: authority = phần sau `://` đến `/`, `?` hoặc hết; userinfo = phần trước `@` CUỐI của authority.
# In ra hai biến toàn cục URI_USER, URI_PASS (không in màn hình); trả 1 nếu URI không có userinfo/không đúng dạng.
URI_USER=""; URI_PASS=""
parse_uri_userinfo() {
  local uri="$1" rest auth info
  URI_USER=""; URI_PASS=""
  [[ "$uri" =~ ^[A-Za-z][A-Za-z0-9+.-]*://(.*)$ ]] || return 1
  rest="${BASH_REMATCH[1]}"
  auth="${rest%%[/?#]*}"
  [[ "$auth" == *@* ]] || return 1
  info="${auth%@*}"
  if [[ "$info" == *:* ]]; then URI_USER="${info%%:*}"; URI_PASS="${info#*:}"; else URI_USER="$info"; fi
  return 0
}

if nonempty MONGODB_URI && [[ -z "${PLACEHOLDER[MONGODB_URI]:-}" ]]; then
  if [[ ! "${VAL[MONGODB_URI]}" =~ ^mongodb:// ]]; then
    err "MONGODB_URI phải bắt đầu bằng mongodb:// (replica set rs0, không dùng mongodb+srv)."
  elif ! parse_uri_userinfo "${VAL[MONGODB_URI]}"; then
    err "MONGODB_URI thiếu thông tin đăng nhập user:mật-khẩu@ (MongoDB bật xác thực)."
  else
    if nonempty MONGO_ROOT_USERNAME && [[ -z "${PLACEHOLDER[MONGO_ROOT_USERNAME]:-}" ]] \
       && ! secret_matches "$URI_USER" "${VAL[MONGO_ROOT_USERNAME]}"; then
      err "MONGODB_URI: tên đăng nhập KHÔNG khớp MONGO_ROOT_USERNAME."
    fi
    if nonempty MONGO_ROOT_PASSWORD && [[ -z "${PLACEHOLDER[MONGO_ROOT_PASSWORD]:-}" ]] \
       && ! secret_matches "$URI_PASS" "${VAL[MONGO_ROOT_PASSWORD]}"; then
      err "MONGODB_URI: mật khẩu KHÔNG khớp MONGO_ROOT_PASSWORD."
    fi
  fi
fi

if nonempty REDIS_URL && [[ -z "${PLACEHOLDER[REDIS_URL]:-}" ]]; then
  if [[ ! "${VAL[REDIS_URL]}" =~ ^rediss?:// ]]; then
    err "REDIS_URL phải bắt đầu bằng redis:// hoặc rediss://."
  elif ! parse_uri_userinfo "${VAL[REDIS_URL]}"; then
    err "REDIS_URL thiếu mật khẩu (dạng redis://:mật-khẩu@host:cổng)."
  elif nonempty REDIS_PASSWORD && [[ -z "${PLACEHOLDER[REDIS_PASSWORD]:-}" ]] \
       && ! secret_matches "$URI_PASS" "${VAL[REDIS_PASSWORD]}"; then
    err "REDIS_URL: mật khẩu KHÔNG khớp REDIS_PASSWORD."
  fi
fi

# ── 9) Khóa lạ, giá trị rủi ro (cảnh báo) ────────────────────────────────────
UNKNOWN=""
for k in "${!VAL[@]}"; do
  if in_list "$k" "${REQUIRED_KEYS[@]}" "${CONDITIONAL_KEYS[@]}" "${OPTIONAL_KEYS[@]}" "${OLD_EXACT_KEYS[@]}"; then continue; fi
  [[ "$k" =~ $PII_VERSIONED_RE || "$k" =~ $OLD_KEY_RE ]] && continue   # khóa cũ đã báo LỖI ở bước 2
  UNKNOWN+="$k"$'\n'
done
if [[ -n "$UNKNOWN" ]]; then
  warning "khóa lạ (không có trong .env.example; có thể gõ sai tên, backend sẽ bỏ qua): $(sort <<<"${UNKNOWN%$'\n'}" | paste -sd ' ' -)"
fi
if (( ${#RISKY[@]} > 0 )); then
  warning "giá trị có nháy bao, chú thích cuối dòng hoặc ký tự \$ \` \\ (compose/dotenv/nginx đọc khác nhau; bỏ đi) ở: $(printf '%s\n' "${!RISKY[@]}" | sort | paste -sd ' ' -)"
fi

# ── Kết quả ──────────────────────────────────────────────────────────────────
if (( ERRORS > 0 )); then
  printf '[%s] KHÔNG ĐẠT: %d lỗi, %d cảnh báo (%s).\n' "$LOG_PREFIX" "$ERRORS" "$WARNINGS" "$ENV_FILE" >&2
  exit 1
fi
log "OK: $ENV_FILE hợp lệ ($WARNINGS cảnh báo)."
