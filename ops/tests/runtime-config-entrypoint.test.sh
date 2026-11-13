#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/runtime-config-entrypoint.test.sh — kiểm FR-15 (T-23): entrypoint FE sinh /env.js từ biến môi trường.
# Chạy script RealEstateAdminApp/docker-entrypoint.d/40-runtime-config.sh với thư mục đích tạm (RUNTIME_CONFIG_DIR), env sạch (`env -i`).
# Không cần Docker/Mongo.
#   [1] không đặt gì          -> mặc định: mọi cờ false, API_URL=/api/v1, KHÔNG có appUrl.
#   [2] giá trị hợp lệ        -> env.js phản ánh đúng; appUrl lấy từ FRONTEND_URL; thoát 0.
#   [3] cờ sai                -> thoát khác 0, log TÊN khóa, không tạo env.js; phân biệt hoa thường; chuỗi rỗng = mặc định.
#   [4] API_URL / FRONTEND_URL sai, ký tự cấm -> thoát khác 0, log tên khóa.
#   [5] khóa ngoài allowlist / bí mật không lọt vào env.js.
#   [6] log và env.js không chứa GIÁ TRỊ sai/nhạy cảm (kể cả khi sai).
#   [7] chạy lại ghi đè file cũ; không để lại file tạm; thư mục đích thiếu -> thoát khác 0.
#
# Chạy:  bash ops/tests/runtime-config-entrypoint.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
SCRIPT="$ROOT_DIR/RealEstateAdminApp/docker-entrypoint.d/40-runtime-config.sh"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: thiếu chuỗi [$2]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: KHÔNG được chứa [$2]"; fi; }

[[ -f "$SCRIPT" ]] && ok || { fail "thiếu $SCRIPT"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Chạy entrypoint với env sạch + các cặp KEY=VALUE truyền vào. Kết quả: RC, LOG (stdout+stderr gộp), ENVJS (nội dung env.js hoặc rỗng).
# Mỗi lần dùng một thư mục đích mới.
run_entry() {
  local dir
  dir="$(mktemp -d "$WORK/out.XXXXXX")"
  LOG="$(env -i PATH="$PATH" RUNTIME_CONFIG_DIR="$dir" "$@" sh "$SCRIPT" 2>&1)"
  RC=$?
  OUT_DIR_LAST="$dir"
  if [[ -f "$dir/env.js" ]]; then ENVJS="$(cat "$dir/env.js")"; else ENVJS=""; fi
}

# Nội dung env.js có khóa JSON "$1" với giá trị literal "$2" (đã gồm nháy nếu chuỗi) không?
has_entry() { [[ "$ENVJS" == *"\"$1\": $2"* ]]; }

ALL_FLAGS=(CRM_ENABLED CRM_ATTACHMENTS_ENABLED CRM_PUSH_ENABLED CRM_IMPORT_ENABLED CRM_FEATURE_ZALO_ZNS CRM_FEATURE_IN_APP_CALL CRM_FEATURE_APPOINTMENT_SYNC CRM_MOCK_REPORTS CRM_MOCK_IMPORT_EXPORT)

echo "== 1) không đặt biến nào -> mặc định =="
run_entry
expect_eq "[1] mã thoát" "0" "$RC"
for f in "${ALL_FLAGS[@]}"; do has_entry "$f" false && ok || fail "[1] $f phải mặc định false"; done
has_entry API_URL '"/api/v1"' && ok || fail "[1] API_URL phải mặc định /api/v1"
expect_not_contains "[1] không có appUrl khi FRONTEND_URL trống" "appUrl" "$ENVJS"
expect_contains "[1] gán đúng global" "window.__APP_CONFIG__ = {" "$ENVJS"
# JSON-like: dòng khóa cuối không có dấu phẩy thừa, đóng "};"
expect_eq "[1] kết thúc bằng };" "};" "$(printf '%s\n' "$ENVJS" | tail -n 1)"
LAST_KEY_LINE="$(printf '%s\n' "$ENVJS" | tail -n 2 | head -n 1)"
[[ "$LAST_KEY_LINE" != *, ]] && ok || fail "[1] dòng khóa cuối còn dấu phẩy thừa: $LAST_KEY_LINE"
# Phần giữa dấu { và } phải là JSON hợp lệ khi bọc lại (kiểm bằng node nếu có).
if command -v node >/dev/null 2>&1; then
  JSON="$(printf '%s\n' "$ENVJS" | sed -e '1d' -e '2s/^window.__APP_CONFIG__ = //' -e '$ s/;$//')"
  if printf '%s' "$JSON" | node -e 'const s=require("fs").readFileSync(0,"utf8");const o=JSON.parse(s);process.exit(o.API_URL==="/api/v1"&&o.CRM_ENABLED===false?0:1)'; then ok; else fail "[1] env.js không phải JSON hợp lệ"; fi
fi

echo "== 2) giá trị hợp lệ =="
run_entry API_URL=https://api.example.com/api/v1 CRM_ENABLED=true CRM_ATTACHMENTS_ENABLED=true CRM_PUSH_ENABLED=false \
  CRM_IMPORT_ENABLED=true CRM_FEATURE_ZALO_ZNS=true CRM_FEATURE_IN_APP_CALL=false CRM_FEATURE_APPOINTMENT_SYNC=true \
  CRM_MOCK_REPORTS=true CRM_MOCK_IMPORT_EXPORT=false FRONTEND_URL=https://admin.example.com
expect_eq "[2] mã thoát" "0" "$RC"
has_entry API_URL '"https://api.example.com/api/v1"' && ok || fail "[2] API_URL tuyệt đối"
has_entry appUrl '"https://admin.example.com"' && ok || fail "[2] appUrl lấy từ FRONTEND_URL"
for f in CRM_ENABLED CRM_ATTACHMENTS_ENABLED CRM_IMPORT_ENABLED CRM_FEATURE_ZALO_ZNS CRM_FEATURE_APPOINTMENT_SYNC CRM_MOCK_REPORTS; do
  has_entry "$f" true && ok || fail "[2] $f phải true"
done
for f in CRM_PUSH_ENABLED CRM_FEATURE_IN_APP_CALL CRM_MOCK_IMPORT_EXPORT; do
  has_entry "$f" false && ok || fail "[2] $f phải false"
done
# Quyết định: CRM_PUSH_ENABLED / CRM_IMPORT_ENABLED có trong allowlist và được phát (FE chưa dùng nhưng nhất quán).
expect_contains "[2] phát CRM_PUSH_ENABLED" '"CRM_PUSH_ENABLED"' "$ENVJS"
expect_contains "[2] phát CRM_IMPORT_ENABLED" '"CRM_IMPORT_ENABLED"' "$ENVJS"
[[ "$(stat -c '%a' "$OUT_DIR_LAST/env.js" 2>/dev/null || echo 644)" == "644" ]] && ok || fail "[2] env.js phải quyền 644 (nginx worker đọc được)"

run_entry API_URL=/ FRONTEND_URL=http://localhost:5173/x?a=1
expect_eq "[2] API_URL '/' hợp lệ, URL có query/cổng hợp lệ" "0" "$RC"
run_entry API_URL=/api/v1 FRONTEND_URL=
expect_eq "[2] FRONTEND_URL rỗng hợp lệ" "0" "$RC"
expect_not_contains "[2] FRONTEND_URL rỗng -> không phát appUrl" "appUrl" "$ENVJS"
run_entry API_URL= CRM_ENABLED=
expect_eq "[2] chuỗi rỗng = chưa đặt (mặc định)" "0" "$RC"
has_entry API_URL '"/api/v1"' && ok || fail "[2] API_URL rỗng -> mặc định"
has_entry CRM_ENABLED false && ok || fail "[2] CRM_ENABLED rỗng -> false"

echo "== 3) cờ sai -> dừng, log tên khóa =="
bad_flags=("TRUE" "True" "1" "0" "yes" "on" "false " " true" "tru" "true;" "null" "[]")
for v in "${bad_flags[@]}"; do
  run_entry "CRM_ENABLED=$v"
  [[ "$RC" -ne 0 ]] && ok || fail "[3] CRM_ENABLED='$v' phải thoát khác 0"
  expect_contains "[3] log nêu tên khóa (giá trị '$v')" "CRM_ENABLED" "$LOG"
  expect_eq "[3] không tạo env.js khi sai ('$v')" "" "$ENVJS"
done
# Mỗi khóa cờ đều bị kiểm (không chỉ CRM_ENABLED).
for f in "${ALL_FLAGS[@]}"; do
  run_entry "$f=maybe"
  [[ "$RC" -ne 0 ]] && ok || fail "[3] $f=maybe phải thoát khác 0"
  expect_contains "[3] log nêu $f" "$f" "$LOG"
done
# Nhiều khóa sai: nêu đủ cả hai.
run_entry CRM_ENABLED=x CRM_MOCK_REPORTS=y
expect_contains "[3] nêu khóa sai thứ nhất" "CRM_ENABLED" "$LOG"
expect_contains "[3] nêu khóa sai thứ hai" "CRM_MOCK_REPORTS" "$LOG"

echo "== 4) URL sai / ký tự cấm =="
bad_api=("//evil.example.com/x" "api/v1" "ftp://x.example.com" "javascript:alert(1)" "http://" "https://" "/a b" "/a\"b" "/a'b" "/a<b" "/a>b" '/a\b' '/a`b' "https://x.example.com/ a" "http://x.com/é")
for v in "${bad_api[@]}"; do
  run_entry "API_URL=$v"
  [[ "$RC" -ne 0 ]] && ok || fail "[4] API_URL='$v' phải thoát khác 0"
  expect_contains "[4] log nêu API_URL ('$v')" "API_URL" "$LOG"
  expect_eq "[4] không tạo env.js ('$v')" "" "$ENVJS"
done
bad_app=("/relative" "//x.example.com" "ftp://x.example.com" "admin.example.com" "http://" "https://x.com/\"" "https://x.com/'" "https://x.com/<s>" 'https://x.com/\' 'https://x.com/`' "https://x.com/a b")
for v in "${bad_app[@]}"; do
  run_entry "FRONTEND_URL=$v"
  [[ "$RC" -ne 0 ]] && ok || fail "[4] FRONTEND_URL='$v' phải thoát khác 0"
  expect_contains "[4] log nêu FRONTEND_URL ('$v')" "FRONTEND_URL" "$LOG"
done
# Xuống dòng / tab trong giá trị (có thể chèn câu lệnh JS ở dòng mới).
run_entry "API_URL=$(printf '/api\nalert(1)')"
[[ "$RC" -ne 0 ]] && ok || fail "[4] API_URL có xuống dòng phải thoát khác 0"
run_entry "API_URL=$(printf '/api\tv1')"
[[ "$RC" -ne 0 ]] && ok || fail "[4] API_URL có tab phải thoát khác 0"

echo "== 5) khóa ngoài allowlist không lọt =="
run_entry VITE_API_URL=https://leak.example.com VITE_CRM_ENABLED=true FEATURE_CRM_ENABLED=true FEATURE_CRM_PUSH=true \
  JWT_SECRET=s3cr3t-jwt-value MONGO_ROOT_PASSWORD=hunter2-mongo AWS_SECRET_ACCESS_KEY=aws-secret-value CRM_ENABLED=true \
  CRM_PII_ENCRYPTION_KEY=pii-key-value VAPID_PRIVATE_KEY=vapid-private-value BACKEND_UPSTREAM=http://backend:3000
expect_eq "[5] mã thoát" "0" "$RC"
for needle in VITE_ FEATURE_CRM JWT_SECRET MONGO_ROOT PASSWORD AWS_ s3cr3t hunter2 aws-secret pii-key vapid-private leak.example.com BACKEND_UPSTREAM backend:3000 PATH; do
  expect_not_contains "[5] env.js không chứa [$needle]" "$needle" "$ENVJS"
done
has_entry CRM_ENABLED true && ok || fail "[5] khóa allowlist vẫn được phát"
# Chỉ đúng các khóa allowlist: đếm số dòng khóa = 10 (9 cờ + API_URL), không appUrl.
KEY_LINES="$(printf '%s\n' "$ENVJS" | grep -c '^  "')"
expect_eq "[5] số khóa phát ra" "10" "$KEY_LINES"

echo "== 6) không in giá trị =="
SECRET_BAD="Sup3rS3cretValue-xyz"
run_entry "CRM_ENABLED=$SECRET_BAD" "API_URL=//$SECRET_BAD" "FRONTEND_URL=$SECRET_BAD"
[[ "$RC" -ne 0 ]] && ok || fail "[6] phải thoát khác 0"
expect_not_contains "[6] log không chứa giá trị sai" "$SECRET_BAD" "$LOG"
expect_contains "[6] log vẫn nêu tên khóa" "CRM_ENABLED" "$LOG"
run_entry JWT_SECRET="$SECRET_BAD" CRM_ENABLED=true
expect_not_contains "[6] log thành công không chứa bí mật env khác" "$SECRET_BAD" "$LOG"
expect_not_contains "[6] env.js không chứa bí mật env khác" "$SECRET_BAD" "$ENVJS"
# Log thành công cũng không in giá trị URL đã cấu hình.
run_entry API_URL=https://private-host.example.com/api FRONTEND_URL=https://private-app.example.com
expect_not_contains "[6] log thành công không in API_URL" "private-host" "$LOG"
expect_not_contains "[6] log thành công không in FRONTEND_URL" "private-app" "$LOG"

echo "== 7) ghi đè / dọn / thư mục thiếu =="
DIR="$(mktemp -d "$WORK/rerun.XXXXXX")"
env -i PATH="$PATH" RUNTIME_CONFIG_DIR="$DIR" CRM_ENABLED=true sh "$SCRIPT" >/dev/null 2>&1
first="$(cat "$DIR/env.js")"
env -i PATH="$PATH" RUNTIME_CONFIG_DIR="$DIR" CRM_ENABLED=false sh "$SCRIPT" >/dev/null 2>&1
second="$(cat "$DIR/env.js")"
[[ "$first" != "$second" ]] && ok || fail "[7] chạy lại với cờ khác phải đổi nội dung (restart là đủ, không build lại)"
expect_contains "[7] bản đầu CRM_ENABLED true" '"CRM_ENABLED": true' "$first"
expect_contains "[7] bản sau CRM_ENABLED false" '"CRM_ENABLED": false' "$second"
expect_eq "[7] chỉ có env.js, không còn file tạm" "env.js" "$(ls "$DIR")"
# Chạy sai không phá file cũ đang phục vụ.
env -i PATH="$PATH" RUNTIME_CONFIG_DIR="$DIR" CRM_ENABLED=oops sh "$SCRIPT" >/dev/null 2>&1
expect_eq "[7] chạy sai không đụng env.js cũ" "$second" "$(cat "$DIR/env.js")"
env -i PATH="$PATH" RUNTIME_CONFIG_DIR="$WORK/khong-ton-tai" sh "$SCRIPT" >/dev/null 2>&1
[[ $? -ne 0 ]] && ok || fail "[7] thư mục đích thiếu phải thoát khác 0"

echo "== 8) quy ước script =="
head -n 1 "$SCRIPT" | grep -qx '#!/bin/sh' && ok || fail "[8] shebang phải #!/bin/sh (POSIX, không bash)"
! grep -qE '\bjq\b|\[\[|bash' <(grep -vE '^\s*#' "$SCRIPT") && ok || fail "[8] script không được dùng jq/[[/bash"
! grep -q $'\r' "$SCRIPT" && ok || fail "[8] script phải EOL LF (CRLF làm hỏng shebang trong container)"
! grep -qE '^\s*(set -x|env\b|printenv|export -p)' "$SCRIPT" && ok || fail "[8] script không được dump env"

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
