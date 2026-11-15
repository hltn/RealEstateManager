#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/nginx-cache-headers.test.sh — kiểm TĨNH header Cache-Control trong RealEstateAdminApp/nginx.conf (T-41, B-1).
# Không chạy nginx/Docker; chỉ đọc file (strip CR vì nginx.conf là CRLF), trích từng khối `location` rồi so khớp.
#   [1] /env.js    : đúng MỘT add_header Cache-Control "no-store"; KHÔNG có no-cache (Cloudflare từng ghi đè no-cache thành max-age=3600).
#   [2] /healthz   : no-store.
#   [3] index.html, sw/registerSW/workbox, manifest.webmanifest, offline.html : vẫn "no-cache" (KHÔNG no-store: giữ revalidate 304).
#   [4] location / : fallback try_files về /index.html (để route SPA rơi vào khối index.html và nhận no-cache).
#   [5] tự kiểm đột biến: bản nginx.conf bị sửa (env.js về no-cache, thêm cả hai, mất add_header, sw.js/index.html/manifest/offline
#       thành no-store, healthz thành no-cache, bỏ fallback của `location /`) PHẢI bị bắt; không bắt được thì chính test này hỏng.
#
# Biến điều khiển (dùng cho kiểm thử đột biến ngoài, không đụng file thật):
#   NGINX_CONF_UNDER_TEST=<đường dẫn nginx.conf>
#
# Chạy:  bash ops/tests/nginx-cache-headers.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
CONF="${NGINX_CONF_UNDER_TEST:-$ROOT_DIR/RealEstateAdminApp/nginx.conf}"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }

if [[ ! -f "$CONF" ]]; then fail "thiếu $CONF"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Trích khối `location` có dòng mở khớp ERE $2 trong file $1 (strip CR; đếm độ sâu ngoặc nên chịu được `types { }` lồng bên trong).
# Bỏ dòng comment toàn dòng. In nội dung khối (cả dòng mở và đóng); không khớp thì in rỗng.
extract_block() {
  tr -d '\r' < "$1" | RE="$2" awk '
    !inblk && $0 ~ /^[[:space:]]*location[[:space:]]/ && $0 ~ ENVIRON["RE"] { inblk = 1; depth = 0 }
    inblk {
      if ($0 !~ /^[[:space:]]*#/) print
      line = $0; sub(/#.*/, "", line)
      n = gsub(/[{]/, "{", line); m = gsub(/[}]/, "}", line)
      depth += n - m
      if (depth <= 0) { inblk = 0; exit }
    }'
}

# Số dòng add_header Cache-Control trong khối $1.
count_cc() { printf '%s\n' "$1" | grep -cE '^[[:space:]]*add_header[[:space:]]+Cache-Control[[:space:]]'; }

# Kiểm một nginx.conf: in mỗi lỗi một dòng ra stdout; in rỗng nếu đạt.
check_conf() {
  local f="$1" blk name re
  local -a errs=()

  # [1] /env.js
  blk="$(extract_block "$f" '=[[:space:]]*/env[.]js[[:space:]]*[{]')"
  if [[ -z "$blk" ]]; then errs+=("thiếu khối location = /env.js")
  else
    [[ "$blk" == *'add_header Cache-Control "no-store"'* ]] || errs+=("/env.js phải có add_header Cache-Control \"no-store\"")
    [[ "$blk" != *no-cache* ]] || errs+=("/env.js KHÔNG được có no-cache")
    [[ "$(count_cc "$blk")" == "1" ]] || errs+=("/env.js phải có đúng một add_header Cache-Control")
    [[ "$blk" == *'try_files $uri =404'* ]] || errs+=('/env.js phải try_files $uri =404 (thiếu file trả 404 thật)')
  fi

  # [2] /healthz
  blk="$(extract_block "$f" '=[[:space:]]*/healthz[[:space:]]*[{]')"
  if [[ -z "$blk" ]]; then errs+=("thiếu khối location = /healthz")
  else [[ "$blk" == *'add_header Cache-Control "no-store"'* ]] || errs+=("/healthz phải no-store"); fi

  # [3] nhóm no-cache: mỗi dòng "tên@regex dòng mở"
  while IFS='@' read -r name re; do
    blk="$(extract_block "$f" "$re")"
    if [[ -z "$blk" ]]; then errs+=("thiếu khối location của $name"); continue; fi
    [[ "$blk" == *'add_header Cache-Control "no-cache"'* ]] || errs+=("$name phải add_header Cache-Control \"no-cache\"")
    [[ "$blk" != *no-store* ]] || errs+=("$name KHÔNG được no-store (giữ revalidate 304)")
    [[ "$(count_cc "$blk")" == "1" ]] || errs+=("$name phải có đúng một add_header Cache-Control")
  done <<'EOF'
index.html@=[[:space:]]*/index[.]html[[:space:]]*[{]
sw.js/registerSW/workbox@[~][[:space:]]+[\^]/[(]sw
manifest.webmanifest@=[[:space:]]*/manifest[.]webmanifest[[:space:]]*[{]
offline.html@=[[:space:]]*/offline[.]html[[:space:]]*[{]
EOF

  # [4] location / : fallback về /index.html, không tự gắn Cache-Control (nhận no-cache từ khối index.html)
  blk="$(extract_block "$f" 'location[[:space:]]+/[[:space:]]*[{]')"
  if [[ -z "$blk" ]]; then errs+=("thiếu khối location /")
  else
    [[ "$blk" == *'try_files $uri $uri/ /index.html'* ]] || errs+=("location / phải fallback try_files về /index.html")
    [[ "$(count_cc "$blk")" == "0" ]] || errs+=("location / không được tự gắn Cache-Control (phải nhận từ khối index.html)")
  fi

  if ((${#errs[@]})); then printf '%s\n' "${errs[@]}"; fi
}

echo "== 1) nginx.conf thật phải đạt mọi kiểm tra =="
ERRS="$(check_conf "$CONF")"
if [[ -z "$ERRS" ]]; then ok; else fail "nginx.conf: $(printf '%s' "$ERRS" | tr '\n' ';')"; fi

# Chống trích rỗng làm test đạt giả.
BLK_ENV="$(extract_block "$CONF" '=[[:space:]]*/env[.]js[[:space:]]*[{]')"
[[ "$BLK_ENV" == *'location = /env.js {'* && "$BLK_ENV" == *'add_header Cache-Control "no-store"'* ]] && ok || fail "trích khối /env.js hỏng"
BLK_MANIFEST="$(extract_block "$CONF" '=[[:space:]]*/manifest[.]webmanifest[[:space:]]*[{]')"
# Khối manifest có `types { }` lồng: phải trích tới dấu đóng của chính location, gồm cả add_header phía sau.
[[ "$BLK_MANIFEST" == *'types { }'* && "$BLK_MANIFEST" == *'add_header Cache-Control "no-cache"'* ]] && ok || fail "trích khối manifest không qua khối types { } lồng"

echo "== 2) tự kiểm đột biến: bản sửa sai PHẢI bị bắt =="
LF="$WORK/nginx.lf.conf"
tr -d '\r' < "$CONF" > "$LF"

# mutant <tên> <biểu thức sed -E trên bản LF>; kỳ vọng bản đột biến khác bản gốc và check_conf báo lỗi.
mutant() {
  local label="$1" expr="$2" out
  if ! sed -E "$expr" "$LF" > "$WORK/mut.conf" 2>"$WORK/mut.err"; then fail "đột biến [$label]: sed lỗi: $(cat "$WORK/mut.err")"; return; fi
  if cmp -s "$LF" "$WORK/mut.conf"; then fail "đột biến [$label] không thay đổi gì (biểu thức sed hỏng)"; return; fi
  out="$(check_conf "$WORK/mut.conf")"
  if [[ -n "$out" ]]; then ok; else fail "đột biến [$label] KHÔNG bị bắt"; fi
}

# Dải sed: từ dòng mở của location đến dòng `}` đứng riêng đầu tiên sau đó.
END_R='/^[[:space:]]*\}[[:space:]]*$/'
mutant "env.js về no-cache"        "/location = \/env\.js \{/,$END_R s/\"no-store\"/\"no-cache\"/"
mutant "env.js thêm cả no-cache"   "/location = \/env\.js \{/,$END_R s/^([[:space:]]*)add_header Cache-Control \"no-store\";/&\n\1add_header Cache-Control \"no-cache\";/"
mutant "env.js mất add_header"     "/location = \/env\.js \{/,$END_R {/add_header/d}"
mutant "env.js đổi tên location"   's/location = \/env\.js \{/location = \/envx.js {/'
mutant "sw.js thành no-store"      "/location ~ \^\/\(sw\|/,$END_R s/\"no-cache\"/\"no-store\"/"
mutant "index.html thành no-store" "/location = \/index\.html \{/,$END_R s/\"no-cache\"/\"no-store\"/"
mutant "manifest thành no-store"   "/location = \/manifest\.webmanifest \{/,$END_R s/\"no-cache\"/\"no-store\"/"
mutant "offline thành no-store"    "/location = \/offline\.html \{/,$END_R s/\"no-cache\"/\"no-store\"/"
mutant "healthz thành no-cache"    "/location = \/healthz \{/,$END_R s/\"no-store\"/\"no-cache\"/"
mutant "location / bỏ fallback"    's#try_files \$uri \$uri/ /index\.html;#try_files $uri $uri/ =404;#'

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
