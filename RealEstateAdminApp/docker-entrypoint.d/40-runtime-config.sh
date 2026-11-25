#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# 40-runtime-config.sh — sinh /usr/share/nginx/html/env.js (window.__APP_CONFIG__) từ biến môi trường container (FR-15, T-23).
#
# Chạy tự động bởi entrypoint của image nginx chính thức (/docker-entrypoint.d/*.sh, sau 20-envsubst...), MỖI LẦN container
# khởi động: đổi cờ chỉ cần đặt lại env rồi tạo lại/restart container, KHÔNG build lại image.
# File đọc bởi RealEstateAdminApp/src/config/runtimeConfig.ts (nguồn duy nhất đọc window.__APP_CONFIG__).
#
# Quy tắc:
#   - POSIX sh (busybox ash của alpine), không jq, không bash. Không bao giờ dump toàn bộ env: CHỈ đọc đúng các khóa allowlist.
#   - Khóa ngoài allowlist (VITE_*, FEATURE_CRM_*, bí mật...) không bao giờ lọt vào file.
#   - Khóa chưa đặt hoặc rỗng -> mặc định: mọi cờ "false", API_URL="/api/v1"; appUrl (từ FRONTEND_URL) không phát nếu trống
#     để FE tự dùng window.location.origin.
#   - Giá trị sai -> DỪNG (exit 1), chỉ log TÊN khóa sai, KHÔNG in giá trị (giá trị có thể nhạy cảm / ký tự lạ).
#     Sai định dạng nghĩa là đặt cấu hình nhầm; để container chạy với cờ lệch âm thầm nguy hiểm hơn là dừng hẳn.
#   - Ghi atomic (file tạm rồi mv) để nginx không bao giờ phục vụ file dở dang.
#
# Biến điều khiển (không đưa vào env.js): RUNTIME_CONFIG_DIR — thư mục đích, mặc định /usr/share/nginx/html (test dùng thư mục tạm).
# ─────────────────────────────────────────────────────────────────────────────
set -eu

# Locale C: lớp ký tự [:graph:] theo byte (từ chối cả byte ngoài ASCII), kết quả không phụ thuộc locale máy.
LC_ALL=C
export LC_ALL

OUT_DIR="${RUNTIME_CONFIG_DIR:-/usr/share/nginx/html}"
OUT_FILE="$OUT_DIR/env.js"
TAG="40-runtime-config"

# Khóa cờ boolean (allowlist) — khớp BOOLEAN_KEYS của runtimeConfig.ts. Mặc định "false".
FLAG_KEYS="CRM_ENABLED CRM_ATTACHMENTS_ENABLED CRM_PUSH_ENABLED CRM_IMPORT_ENABLED CRM_FEATURE_ZALO_ZNS CRM_FEATURE_IN_APP_CALL CRM_FEATURE_APPOINTMENT_SYNC CRM_MOCK_REPORTS CRM_MOCK_IMPORT_EXPORT"

BAD_KEYS=""

# Ghi nhận khóa sai (chỉ tên). Không in giá trị.
mark_bad() {
  BAD_KEYS="${BAD_KEYS:+$BAD_KEYS }$1"
}

# Lấy giá trị env theo TÊN khóa (tên lấy từ danh sách cố định trong file này, không phải đầu vào người dùng nên eval an toàn).
get_env() {
  eval "printf '%s' \"\${$1:-}\""
}

# Giá trị URL có chứa ký tự bị cấm không? Cấm: mọi ký tự không phải "graph" (khoảng trắng, xuống dòng, điều khiển, byte
# ngoài ASCII) cùng " ' < > \ và backtick -> an toàn để nhúng vào chuỗi JS và vào chỗ dùng URL. Trả 0 (true) nếu CÓ ký tự cấm.
has_forbidden_char() {
  case "$1" in
    *[![:graph:]]* | *\"* | *\'* | *\<* | *\>* | *\\* | *\`*) return 0 ;;
  esac
  return 1
}

# Kiểm URL tuyệt đối http(s):// (có ít nhất 1 ký tự sau "://") và không có ký tự cấm.
is_absolute_http_url() {
  has_forbidden_char "$1" && return 1
  case "$1" in
    http://?* | https://?*) return 0 ;;
  esac
  return 1
}

# Kiểm API_URL: đường dẫn tương đối bắt đầu bằng "/" nhưng KHÔNG "//" (tránh protocol-relative đẩy request sang origin lạ),
# hoặc URL tuyệt đối http(s). Không có ký tự cấm.
is_valid_api_url() {
  has_forbidden_char "$1" && return 1
  case "$1" in
    //*) return 1 ;;
    /*) return 0 ;;
  esac
  is_absolute_http_url "$1"
}

# ── Nạp + kiểm từng khóa ──────────────────────────────────────────────────────
FLAG_LINES=""
for key in $FLAG_KEYS; do
  value="$(get_env "$key")"
  [ -n "$value" ] || value="false"
  case "$value" in
    true | false) FLAG_LINES="$FLAG_LINES  \"$key\": $value,
" ;;
    *) mark_bad "$key" ;;
  esac
done

API_URL_VALUE="$(get_env API_URL)"
[ -n "$API_URL_VALUE" ] || API_URL_VALUE="/api/v1"
is_valid_api_url "$API_URL_VALUE" || mark_bad API_URL

APP_URL_VALUE="$(get_env FRONTEND_URL)"
if [ -n "$APP_URL_VALUE" ] && ! is_absolute_http_url "$APP_URL_VALUE"; then
  mark_bad FRONTEND_URL
fi

if [ -n "$BAD_KEYS" ]; then
  echo "$TAG: ERROR: giá trị không hợp lệ ở khóa: $BAD_KEYS (cờ chỉ nhận true|false; API_URL bắt đầu bằng / hoặc http(s)://; FRONTEND_URL là http(s):// tuyệt đối; không khoảng trắng và \" ' < > \\ backtick). Không tạo env.js." >&2
  exit 1
fi

# ── Sinh file (atomic) ────────────────────────────────────────────────────────
if [ ! -d "$OUT_DIR" ] || [ ! -w "$OUT_DIR" ]; then
  echo "$TAG: ERROR: thư mục đích không tồn tại hoặc không ghi được. Không tạo env.js." >&2
  exit 1
fi

TMP_FILE="$OUT_FILE.tmp.$$"
{
  printf '// Sinh tự động lúc container khởi động bởi 40-runtime-config.sh. Không sửa tay.\n'
  printf 'window.__APP_CONFIG__ = {\n'
  printf '  "API_URL": "%s",\n' "$API_URL_VALUE"
  if [ -n "$APP_URL_VALUE" ]; then
    printf '  "appUrl": "%s",\n' "$APP_URL_VALUE"
  fi
  # FLAG_LINES kết thúc bằng ",\n" ở dòng cuối: bỏ dấu phẩy cuối để JS hợp lệ ở mọi trình duyệt cũ.
  printf '%s' "$FLAG_LINES" | sed '$ s/,$//'
  printf '};\n'
} > "$TMP_FILE"
chmod 644 "$TMP_FILE"
mv -f "$TMP_FILE" "$OUT_FILE"

echo "$TAG: đã tạo env.js từ biến môi trường (allowlist)."
