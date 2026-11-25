#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/nginx-security-headers.test.sh — header bảo mật của nginx FE (T-41 D-1, B-2):
#   RealEstateAdminApp/nginx.conf + RealEstateAdminApp/nginx-security-headers.conf (snippet) + Dockerfile.
#
# Bẫy cần canh: `add_header` trong một `location` THAY toàn bộ add_header cấp cha. Header bảo mật nằm ở snippet, `include`
# ở cấp server VÀ trong từng location có add_header riêng; location nào quên include sẽ mất header (test này bắt).
#
#   Phần A (TĨNH, không cần Docker):
#     [A1] server_tokens off ở cấp server.
#     [A2] snippet có đủ 4 header, mỗi header có `always`, KHÔNG có HSTS (Cloudflare bật ở edge).
#     [A3] nginx.conf include snippet ở cấp server; MỌI location có add_header đều include lại; /api/ ẩn 4 header của backend (tránh lặp).
#     [A4] Dockerfile COPY snippet đúng đường dẫn mà nginx.conf include.
#     [A5] tự kiểm đột biến: bản sửa sai PHẢI bị bắt.
#   Phần B (nginx THẬT, bỏ qua nếu thiếu docker/image nginx:1.27-alpine hoặc đặt SKIP_DOCKER=1; KHÔNG build image):
#     container tạm mount nginx.conf (đã envsubst như image) + snippet + dist giả, curl -I từng đường dẫn: đủ header đúng MỘT lần,
#     Cache-Control giữ nguyên, Server không lộ phiên bản, /api/ không lặp header của backend (backend giả trong container),
#     `nginx -t` đạt; rồi một bản đột biến (location mất include) PHẢI bị bắt.
#
# Biến điều khiển: NGINX_CONF_UNDER_TEST, SNIPPET_UNDER_TEST, DOCKERFILE_UNDER_TEST, SKIP_DOCKER=1, NGINX_TEST_IMAGE (mặc định nginx:1.27-alpine).
# Chạy:  bash ops/tests/nginx-security-headers.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
FE_DIR="$ROOT_DIR/RealEstateAdminApp"
CONF="${NGINX_CONF_UNDER_TEST:-$FE_DIR/nginx.conf}"
SNIP="${SNIPPET_UNDER_TEST:-$FE_DIR/nginx-security-headers.conf}"
DOCKERFILE="${DOCKERFILE_UNDER_TEST:-$FE_DIR/Dockerfile}"
IMAGE="${NGINX_TEST_IMAGE:-nginx:1.27-alpine}"
SNIP_IMAGE_PATH="/etc/nginx/snippets/security-headers.conf"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }

for f in "$CONF" "$SNIP" "$DOCKERFILE"; do
  if [[ ! -f "$f" ]]; then fail "thiếu $f"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; fi
done

WORK="$(mktemp -d)"
CONTAINER=""
cleanup() {
  # Chỉ xóa container do chính test này tạo.
  if [[ -n "$CONTAINER" ]]; then MSYS_NO_PATHCONV=1 docker rm -f "$CONTAINER" >/dev/null 2>&1; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# Bỏ comment toàn dòng + bỏ CR. In ra stdout.
strip() { tr -d '\r' < "$1" | grep -vE '^[[:space:]]*#' ; }

# ── Phân tích tĩnh ───────────────────────────────────────────────────────────
# Liệt kê mọi location trong nginx.conf: mỗi dòng "<dòng mở>TAB<số add_header>TAB<số include snippet>TAB<số proxy_hide_header>"
# (dòng mở có thể chứa dấu | trong regex nên dùng TAB làm dấu phân cách).
list_locations() {
  strip "$1" | awk -v inc="$SNIP_IMAGE_PATH" '
    function flush() { printf "%s\t%d\t%d\t%d\n", head, nadd, ninc, nhide }
    !inblk && $0 ~ /^[[:space:]]*location[[:space:]]/ {
      inblk = 1; depth = 0; head = $0; nadd = 0; ninc = 0; nhide = 0
      gsub(/^[[:space:]]+|[[:space:]]*[{][[:space:]]*$/, "", head)
    }
    inblk {
      if ($0 ~ /^[[:space:]]*add_header[[:space:]]/) nadd++
      if (index($0, "include " inc ";") > 0) ninc++
      if ($0 ~ /^[[:space:]]*proxy_hide_header[[:space:]]/) nhide++
      line = $0; n = gsub(/[{]/, "{", line); m = gsub(/[}]/, "}", line); depth += n - m
      if (depth <= 0) { flush(); inblk = 0 }
    }'
}

# Dòng cấp server (không nằm trong location): các dòng ở độ sâu 1 (trực tiếp trong server{}) không mở khối.
server_level() {
  strip "$1" | awk '
    { line = $0; opens = gsub(/[{]/, "{", line); closes = gsub(/[}]/, "}", line)
      if (depth == 1 && $0 !~ /[{]/) print
      depth += opens - closes }'
}

check_conf() {
  local f="$1" sl locs head nadd ninc nhide h
  local -a errs=()
  sl="$(server_level "$f")"

  # [A1]
  printf '%s\n' "$sl" | grep -qE '^[[:space:]]*server_tokens[[:space:]]+off[[:space:]]*;' || errs+=("thiếu server_tokens off ở cấp server")
  # [A3] include ở cấp server
  printf '%s\n' "$sl" | grep -qE "^[[:space:]]*include[[:space:]]+$SNIP_IMAGE_PATH[[:space:]]*;" || errs+=("thiếu include $SNIP_IMAGE_PATH ở cấp server")
  if printf '%s\n' "$sl" | grep -qE '^[[:space:]]*add_header[[:space:]]'; then errs+=("cấp server không được có add_header trực tiếp (đưa vào snippet)"); fi

  locs="$(list_locations "$f")"
  [[ -n "$locs" ]] || errs+=("không đọc được location nào")
  while IFS=$'\t' read -r head nadd ninc nhide; do
    [[ -n "$head" ]] || continue
    # Location có add_header riêng mà không include snippet => mất header bảo mật.
    if ((nadd > 0)) && ((ninc != 1)); then errs+=("location [$head] có add_header riêng nhưng không include snippet đúng 1 lần"); fi
    if [[ "$head" == "location /api/" ]]; then
      ((nadd == 0)) || errs+=("location /api/ không được có add_header riêng (sẽ mất header cấp server)")
    fi
  done <<< "$locs"
  for h in X-Content-Type-Options X-Frame-Options Referrer-Policy Permissions-Policy; do
    strip "$f" | grep -qiE "^[[:space:]]*proxy_hide_header[[:space:]]+$h[[:space:]]*;" || errs+=("thiếu proxy_hide_header $h ở /api/")
  done
  if ((${#errs[@]})); then printf '%s\n' "${errs[@]}"; fi
}

check_snippet() {
  local f="$1" body h
  local -a errs=()
  body="$(strip "$f")"
  for h in 'X-Content-Type-Options "nosniff"' 'X-Frame-Options "SAMEORIGIN"' 'Referrer-Policy "strict-origin-when-cross-origin"'; do
    printf '%s\n' "$body" | grep -qE "^[[:space:]]*add_header[[:space:]]+$h[[:space:]]+always;" || errs+=("snippet thiếu: add_header $h always;")
  done
  printf '%s\n' "$body" | grep -qE '^[[:space:]]*add_header[[:space:]]+Permissions-Policy[[:space:]]+"[^"]+"[[:space:]]+always;' || errs+=("snippet thiếu Permissions-Policy (có always)")
  if printf '%s\n' "$body" | grep -qiE 'Strict-Transport-Security'; then errs+=("snippet KHÔNG được có HSTS (Cloudflare bật ở edge)"); fi
  # Không chặn thứ app đang dùng: push/notification/clipboard/fullscreen không được nằm trong Permissions-Policy.
  if printf '%s\n' "$body" | grep -iE 'Permissions-Policy' | grep -qiE 'notifications|push|clipboard|fullscreen|web-share'; then
    errs+=("Permissions-Policy không được chặn notifications/push/clipboard/fullscreen/web-share (app đang dùng)")
  fi
  if ((${#errs[@]})); then printf '%s\n' "${errs[@]}"; fi
}

check_dockerfile() {
  local f="$1"
  local -a errs=()
  strip "$f" | grep -qE "^COPY[[:space:]]+nginx-security-headers[.]conf[[:space:]]+$SNIP_IMAGE_PATH[[:space:]]*$" || errs+=("Dockerfile thiếu COPY nginx-security-headers.conf $SNIP_IMAGE_PATH")
  strip "$f" | grep -qE "^COPY[[:space:]]+nginx[.]conf[[:space:]]+/etc/nginx/templates/default[.]conf[.]template" || errs+=("Dockerfile phải vẫn COPY nginx.conf làm template envsubst")
  if ((${#errs[@]})); then printf '%s\n' "${errs[@]}"; fi
}

echo "== A) kiểm tĩnh trên file thật =="
E="$(check_conf "$CONF")";             if [[ -z "$E" ]]; then ok; else fail "nginx.conf: $(printf '%s' "$E" | tr '\n' ';')"; fi
E="$(check_snippet "$SNIP")";          if [[ -z "$E" ]]; then ok; else fail "snippet: $(printf '%s' "$E" | tr '\n' ';')"; fi
E="$(check_dockerfile "$DOCKERFILE")"; if [[ -z "$E" ]]; then ok; else fail "Dockerfile: $(printf '%s' "$E" | tr '\n' ';')"; fi

# Chống phân tích rỗng làm test đạt giả: phải thấy đủ các location đã biết, và /env.js có include.
LOCS="$(list_locations "$CONF")"
NLOC="$(printf '%s\n' "$LOCS" | grep -c .)"
if ((NLOC >= 9)); then ok; else fail "list_locations chỉ thấy $NLOC location (kỳ vọng >= 9)"; fi
if printf '%s\n' "$LOCS" | grep -qE $'^location = /env[.]js\t1\t1\t0$'; then ok; else fail "location = /env.js phải có đúng 1 add_header và 1 include"; fi
if printf '%s\n' "$LOCS" | grep -qE $'^location = /manifest[.]webmanifest\t1\t1\t0$'; then ok; else fail "location manifest (khối có types { } lồng) phải có 1 add_header và 1 include"; fi
if printf '%s\n' "$LOCS" | grep -qE $'^location /api/\t0\t0\t4$'; then ok; else fail "location /api/ phải có 0 add_header, 0 include, 4 proxy_hide_header"; fi

echo "== A5) tự kiểm đột biến: bản sửa sai PHẢI bị bắt =="
LF="$WORK/nginx.lf.conf";    tr -d '\r' < "$CONF" > "$LF"
SLF="$WORK/snippet.lf.conf"; tr -d '\r' < "$SNIP" > "$SLF"
DLF="$WORK/Dockerfile.lf";   tr -d '\r' < "$DOCKERFILE" > "$DLF"
END_R='/^[[:space:]]*\}[[:space:]]*$/'

# mutant <loại: conf|snippet|dockerfile> <tên> <biểu thức sed -E>
mutant() {
  local kind="$1" label="$2" expr="$3" src out
  case "$kind" in conf) src="$LF";; snippet) src="$SLF";; dockerfile) src="$DLF";; esac
  if ! sed -E "$expr" "$src" > "$WORK/mut" 2>"$WORK/mut.err"; then fail "đột biến [$label]: sed lỗi: $(cat "$WORK/mut.err")"; return; fi
  if cmp -s "$src" "$WORK/mut"; then fail "đột biến [$label] không thay đổi gì (biểu thức sed hỏng)"; return; fi
  case "$kind" in conf) out="$(check_conf "$WORK/mut")";; snippet) out="$(check_snippet "$WORK/mut")";; dockerfile) out="$(check_dockerfile "$WORK/mut")";; esac
  if [[ -n "$out" ]]; then ok; else fail "đột biến [$label] KHÔNG bị bắt"; fi
}

mutant conf "env.js mất include"        "/location = \/env\.js \{/,$END_R {/include/d}"
mutant conf "healthz mất include"       "/location = \/healthz \{/,$END_R {/include/d}"
mutant conf "sw.js mất include"         "/location ~ \^\/\(sw\|/,$END_R {/include/d}"
mutant conf "manifest mất include"      "/location = \/manifest\.webmanifest \{/,$END_R {/include/d}"
mutant conf "offline mất include"       "/location = \/offline\.html \{/,$END_R {/include/d}"
mutant conf "assets mất include"        "/location \^~ \/assets\/ \{/,$END_R {/include/d}"
mutant conf "index.html mất include"    "/location = \/index\.html \{/,$END_R {/include/d}"
mutant conf "icon mất include"          "/location ~ \^\/\(pwa-/,$END_R {/include/d}"
mutant conf "location / thêm add_header riêng" "/^    location \/ \{/,$END_R s/^([[:space:]]*)try_files.*/&\n\1add_header X-Foo \"1\";/"
mutant conf "mất include cấp server"   's#^    include /etc/nginx/snippets/security-headers\.conf;##'
mutant conf "server_tokens on"          's/server_tokens off;/server_tokens on;/'
mutant conf "mất server_tokens"         '/server_tokens off;/d'
mutant conf "đổi đường dẫn include"     's#include /etc/nginx/snippets/security-headers\.conf;#include /etc/nginx/snippets/khac.conf;#'
mutant conf "/api/ bỏ hide X-Frame-Options" '/proxy_hide_header +X-Frame-Options;/d'
mutant conf "/api/ bỏ hide Referrer-Policy" '/proxy_hide_header +Referrer-Policy;/d'
mutant conf "add_header cấp server"     's/^    server_tokens off;/&\n    add_header X-Foo "1";/'
mutant snippet "snippet mất nosniff"     '/X-Content-Type-Options/d'
mutant snippet "snippet mất XFO"         '/X-Frame-Options/d'
mutant snippet "snippet mất Referrer"    '/Referrer-Policy/d'
mutant snippet "snippet mất Permissions" '/Permissions-Policy/d'
mutant snippet "nosniff mất always"      '/X-Content-Type-Options/ s/ always;/;/'
mutant snippet "XFO mất always"          '/X-Frame-Options/ s/ always;/;/'
mutant snippet "thêm HSTS"               's/^add_header X-Frame-Options.*/&\nadd_header Strict-Transport-Security "max-age=1" always;/'
mutant snippet "PP chặn notifications"   's/(Permissions-Policy ")/\1notifications=(), /'
mutant dockerfile "Dockerfile mất COPY snippet" '/^COPY nginx-security-headers\.conf/d'
mutant dockerfile "Dockerfile COPY sai đích"    's#/etc/nginx/snippets/security-headers\.conf#/etc/nginx/conf.d/security-headers.conf#'

# ── Phần B: nginx thật ───────────────────────────────────────────────────────
# Đường dẫn cho docker -v: Git Bash trên Windows cần đường dẫn Windows (cygpath -m), Linux dùng nguyên.
hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# real_check <nginx.conf> <snippet>: chạy nginx thật, in mỗi lỗi một dòng; rỗng nếu đạt.
real_check() {
  local conf="$1" snip="$2" dir="$WORK/real" port base p code want hdrs got n h etag
  local -a errs=()
  rm -rf "$dir"; mkdir -p "$dir/html/assets" "$dir/conf"
  printf '<html>i</html>\n' > "$dir/html/index.html"; printf 'window.__APP_CONFIG__={}\n' > "$dir/html/env.js"
  printf 'self\n' > "$dir/html/sw.js"; printf 'self\n' > "$dir/html/workbox-xyz.js"; printf '{}\n' > "$dir/html/manifest.webmanifest"
  printf 'off\n' > "$dir/html/offline.html"; printf 'a\n' > "$dir/html/assets/app-abc.js"
  printf 'x\n' > "$dir/html/pwa-192x192.png"; printf '<svg/>\n' > "$dir/html/favicon.svg"
  # Như image: envsubst đúng 3 biến (BACKEND_UPSTREAM, TRUSTED_PROXY_IP, CLIENT_MAX_BODY), giữ nguyên mọi $ của nginx.
  tr -d '\r' < "$conf" | sed -e 's#\${BACKEND_UPSTREAM}#http://backend:3000#g' -e 's#\${TRUSTED_PROXY_IP}#127.0.0.1#g' -e 's#\${CLIENT_MAX_BODY}#6m#g' > "$dir/conf/default.conf"
  # Backend giả (127.0.0.1:3000 trong chính container, qua --add-host backend:127.0.0.1) gửi header kiểu helmet để thử việc ẩn/lặp.
  cat > "$dir/conf/fake-backend.conf" <<'EOF'
server {
    listen 127.0.0.1:3000;
    location / {
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Strict-Transport-Security "max-age=15552000" always;
        default_type application/json;
        return 200 '{}';
    }
}
EOF
  tr -d '\r' < "$snip" > "$dir/conf/security-headers.conf"

  CONTAINER="neptune-sechdr-$$"
  MSYS_NO_PATHCONV=1 docker rm -f "$CONTAINER" >/dev/null 2>&1
  if ! MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" -p 127.0.0.1::80 --add-host backend:127.0.0.1 \
      -v "$(hostpath "$dir/html"):/usr/share/nginx/html:ro" \
      -v "$(hostpath "$dir/conf/default.conf"):/etc/nginx/conf.d/default.conf:ro" \
      -v "$(hostpath "$dir/conf/fake-backend.conf"):/etc/nginx/conf.d/fake-backend.conf:ro" \
      -v "$(hostpath "$dir/conf/security-headers.conf"):$SNIP_IMAGE_PATH:ro" "$IMAGE" >/dev/null 2>"$dir/run.err"; then
    errs+=("không chạy được container nginx: $(tr '\n' ' ' < "$dir/run.err")"); printf '%s\n' "${errs[@]}"; return
  fi
  if ! MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" nginx -t >"$dir/t.out" 2>&1; then errs+=("nginx -t hỏng: $(tr '\n' ' ' < "$dir/t.out")"); fi
  port="$(MSYS_NO_PATHCONV=1 docker port "$CONTAINER" 80/tcp | head -n 1 | sed -E 's/.*:([0-9]+)$/\1/' | tr -d '\r')"
  base="http://127.0.0.1:$port"
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do curl -s -o /dev/null "$base/healthz" && break; sleep 0.5; done

  # <đường dẫn> <mã> <Cache-Control mong đợi, "-" = không có; "_" thay cho dấu cách>
  while read -r p code want; do
    [[ -n "$p" ]] || continue
    hdrs="$(curl -sI "$base$p" | tr -d '\r')"
    got="$(printf '%s\n' "$hdrs" | sed -n '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p')"
    [[ "$got" == "$code" ]] || errs+=("$p: mã '$got', kỳ vọng $code")
    for h in X-Content-Type-Options X-Frame-Options Referrer-Policy Permissions-Policy; do
      n="$(printf '%s\n' "$hdrs" | grep -ciE "^$h:")"
      [[ "$n" == "1" ]] || errs+=("$p: header $h xuất hiện $n lần (kỳ vọng đúng 1)")
    done
    printf '%s\n' "$hdrs" | grep -qiE '^X-Content-Type-Options: nosniff$' || errs+=("$p: X-Content-Type-Options sai giá trị")
    printf '%s\n' "$hdrs" | grep -qiE '^X-Frame-Options: SAMEORIGIN$' || errs+=("$p: X-Frame-Options sai giá trị (phải SAMEORIGIN, kể cả /api/)")
    printf '%s\n' "$hdrs" | grep -qiE '^Referrer-Policy: strict-origin-when-cross-origin$' || errs+=("$p: Referrer-Policy sai giá trị")
    printf '%s\n' "$hdrs" | grep -qiE '^Server: nginx$' || errs+=("$p: header Server lộ phiên bản hoặc thiếu ($(printf '%s\n' "$hdrs" | grep -i '^Server:'))")
    if [[ "$p" != /api/* ]] && printf '%s\n' "$hdrs" | grep -qiE '^Strict-Transport-Security'; then errs+=("$p: origin FE không được gửi HSTS"); fi
    got="$(printf '%s\n' "$hdrs" | sed -n 's/^[Cc]ache-[Cc]ontrol: //p')"
    if [[ "$want" == "-" ]]; then [[ -z "$got" ]] || errs+=("$p: không được có Cache-Control, có '$got'")
    else [[ "$got" == "${want//_/ }" ]] || errs+=("$p: Cache-Control '$got', kỳ vọng '${want//_/ }'"); fi
  done <<'EOF'
/ 200 no-cache
/index.html 200 no-cache
/customers/123 200 no-cache
/env.js 200 no-store
/healthz 200 no-store
/sw.js 200 no-cache
/sw.js.map 404 -
/workbox-xyz.js 200 no-cache
/manifest.webmanifest 200 no-cache
/offline.html 200 no-cache
/assets/app-abc.js 200 public,_max-age=31536000,_immutable
/assets/khong-co.js 404 -
/pwa-192x192.png 200 public,_max-age=86400
/favicon.svg 200 public,_max-age=86400
/favicon.ico 404 -
/api/ 200 -
/api/v1/x 200 -
EOF
  # /api/: HSTS của backend phải còn (không ẩn); X-Frame-Options của backend (DENY) không được lọt qua.
  hdrs="$(curl -sI "$base/api/v1/x" | tr -d '\r')"
  printf '%s\n' "$hdrs" | grep -qiE '^Strict-Transport-Security: max-age=15552000$' || errs+=("/api/: HSTS của backend bị mất")
  if printf '%s\n' "$hdrs" | grep -qi 'DENY'; then errs+=("/api/: X-Frame-Options của backend (DENY) lọt qua, header bị lặp"); fi
  # manifest vẫn đúng kiểu MIME (types { } lồng không bị ảnh hưởng).
  curl -sI "$base/manifest.webmanifest" | tr -d '\r' | grep -qiE '^Content-Type: application/manifest\+json' || errs+=("manifest.webmanifest sai Content-Type")
  # 304 vẫn có header bảo mật.
  etag="$(curl -sI "$base/env.js" | tr -d '\r' | sed -n 's/^[Ee][Tt]ag: //p')"
  hdrs="$(curl -sI -H "If-None-Match: $etag" "$base/env.js" | tr -d '\r')"
  printf '%s\n' "$hdrs" | head -n 1 | grep -q ' 304' || errs+=("/env.js với If-None-Match không trả 304")
  printf '%s\n' "$hdrs" | grep -qiE '^X-Content-Type-Options: nosniff$' || errs+=("/env.js 304 thiếu header bảo mật")

  MSYS_NO_PATHCONV=1 docker rm -f "$CONTAINER" >/dev/null 2>&1; CONTAINER=""
  if ((${#errs[@]})); then printf '%s\n' "${errs[@]}"; fi
}

echo "== B) nginx thật (không build image) =="
if [[ "${SKIP_DOCKER:-0}" == "1" ]]; then
  echo "  (bỏ qua: SKIP_DOCKER=1)"
elif ! command -v docker >/dev/null 2>&1 || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "  (bỏ qua: không có docker hoặc image $IMAGE; không tự pull)"
else
  E="$(real_check "$CONF" "$SNIP")"
  if [[ -z "$E" ]]; then ok; else fail "nginx thật: $(printf '%s' "$E" | tr '\n' ';')"; fi
  # Đột biến trên nginx thật: location /env.js mất include thì header bảo mật phải mất và bị bắt.
  sed -E "/location = \/env\.js \{/,$END_R {/include/d}" "$LF" > "$WORK/real-mut.conf"
  E="$(real_check "$WORK/real-mut.conf" "$SNIP")"
  if [[ -n "$E" ]] && printf '%s' "$E" | grep -q '^/env.js:'; then ok; else fail "đột biến nginx thật (env.js mất include) KHÔNG bị bắt: [$E]"; fi
fi

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
