#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/release-send.test.sh — test shell KHÔNG cần Docker/ssh/VPS thật cho `release.sh send` (v1.0.6, T-32, FR-14).
#
# `docker`, `ssh`, `scp` (và `gzip` khi cần ép lỗi) là bản giả đặt đầu PATH:
#   - ssh giả THỰC THI lệnh phía "VPS" ngay trên máy này (bash -c, cwd = HOME giả, STUB_SIDE=remote) nên bộ cài THẬT ops/install-release.sh,
#     sha256sum, tar, mktemp thật chạy; chỉ docker/check-disk/deploy.sh là giả. Nhờ vậy ca "cài đầu bằng bộ cài trong gói" được kiểm thật.
#   - scp giả chép file vào đường dẫn "VPS" (cùng máy); docker giả giữ "image" ở hai thư mục (img = máy build, rimg = VPS).
#   - Mọi sự kiện có thứ tự ghi vào $STATE/events.log (scp, check-disk-new, docker-save, docker-load, deploy) để kiểm thứ tự (1)-(4).
#
# Phủ: bước 0 từ chối (bản -local/-dirty, thiếu/lệch release.env/gói/.sha256, thiếu hoặc lệch ID image), `--to`/`--dir` độc hại (không chạm mạng),
# luồng đạt (thứ tự, .env/backups/logs nguyên vẹn, lần cài đầu VPS chưa có bộ cài, --init, chạy lại, dọn thư mục tạm, không lộ bí mật),
# dừng ở lỗi ĐẦU TIÊN của từng bước (1a..1d, 2, 3 gồm lỗi giữa pipe docker save|gzip|ssh, 4), không rollback, không docker login/push/pull,
# --dry-run, RELEASE_SSH_OPTS, kiểm tĩnh release.sh.
#
# Mutation tự kiểm: RELEASE_SH=<bản release.sh đã sửa> [ONLY="happy fail"] bash ops/tests/release-send.test.sh  (phải hỏng).
#
# Chạy:  bash ops/tests/release-send.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2016  # nháy đơn có chủ ý
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: không thấy [$2] trong [${3:0:900}]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: KHÔNG được chứa [$2] (đầu ra: ${3:0:900})"; fi; }
expect_rc() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mã thoát mong đợi $2, nhận $3 (đầu ra: ${OUT:0:900})"; fi; }
expect_nonzero() { if [[ "$2" != "0" ]]; then ok; else fail "$1: mong đợi mã thoát khác 0 (đầu ra: ${OUT:0:900})"; fi; }
expect_file() { if [[ -e "$2" ]]; then ok; else fail "$1: thiếu $2"; fi; }
expect_no_file() { if [[ ! -e "$2" && ! -L "$2" ]]; then ok; else fail "$1: $2 không được tồn tại"; fi; }
want() { [[ -z "${ONLY:-}" || " $ONLY " == *" $1 "* ]]; }

SECRET_LOCAL="zq7LocalSecretValue"
SECRET_VPS="zq7VpsSecretValue"
RELEASE_SH_SRC="${RELEASE_SH:-$ROOT_DIR/release.sh}"
INSTALL_SH_SRC="${INSTALL_SH:-$ROOT_DIR/ops/install-release.sh}"
REAL_GZIP="$(command -v gzip)"

# ── docker / ssh / scp / gzip giả ────────────────────────────────────────────
STUB="$TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/docker" <<'EOS'
#!/usr/bin/env bash
# docker giả: "image" = file chứa ID; $S/img = máy build, $S/rimg = VPS (STUB_SIDE=remote do ssh giả đặt).
S="${STUB_STATE:?}"; SIDE="${STUB_SIDE:-local}"; mkdir -p "$S/img" "$S/rimg"
echo "[$SIDE] $*" >> "$S/docker.log"
dir="$S/img"; [[ "$SIDE" == remote ]] && dir="$S/rimg"
case "${1:-}" in
  info) exit 0 ;;
  image)
    [[ "${2:-}" == inspect ]] || exit 1
    ref="${*: -1}"; f="$dir/${ref//[\/:]/_}"
    [[ -f "$f" ]] || { echo "Error: No such image: $ref" >&2; exit 1; }
    cat "$f" ;;
  save)
    echo "docker-save" >> "$S/events.log"
    [[ "${STUB_SAVE_FAIL:-}" != early ]] || { echo "docker save lỗi giả (sớm)" >&2; exit 1; }
    shift; n=0
    for ref in "$@"; do
      printf 'IMG %s %s\n' "$ref" "$(cat "$S/img/${ref//[\/:]/_}")"
      n=$((n + 1))
      if [[ "${STUB_SAVE_FAIL:-}" == mid && $n -ge 1 ]]; then echo "docker save lỗi giả (giữa luồng)" >&2; exit 1; fi
      head -c 3000 /dev/zero | tr '\0' 'x'; echo
    done ;;
  load)
    echo "docker-load" >> "$S/events.log"
    data="$(cat)"
    [[ -z "${STUB_LOAD_FAIL:-}" ]] || { echo "docker load lỗi giả" >&2; exit 1; }
    if [[ -z "${STUB_LOAD_SKIP:-}" ]]; then
      while read -r tag ref id; do
        if [[ "$tag" == IMG ]]; then echo "${STUB_LOAD_ID:-$id}" > "$S/rimg/${ref//[\/:]/_}"; fi
      done <<<"$data"
    fi ;;
  *) exit 0 ;;
esac
EOS
cat > "$STUB/ssh" <<'EOS'
#!/usr/bin/env bash
# ssh giả: ghi nhật ký (kèm cờ có `--` trước host), tiêm lỗi theo STUB_SSH_FAIL_MATCH (khớp lệnh + script stdin), rồi THỰC THI lệnh phía VPS.
S="${STUB_STATE:?}"; a=("$@"); i=0; opts=(); dd=0
while (( i < ${#a[@]} )); do x="${a[i]}"; i=$((i + 1)); if [[ "$x" == -- ]]; then dd=1; break; fi; opts+=("$x"); done
host="${a[i]:-}"; cmd="${a[*]:i+1}"
n=$(( $(cat "$S/ssh.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/ssh.count"
f="$S/ssh.$n.stdin"
if [[ -t 0 ]]; then : > "$f"; else cat > "$f"; fi
echo "ssh opts=[${opts[*]}] dashdash=$dd host=[$host] cmd=[$cmd]" >> "$S/net.log"
blob="$(printf '%s\n' "$cmd"; head -c 6000 "$f" | tr -d '\0')"
if [[ -n "${STUB_SSH_REPLY_MATCH:-}" ]] && grep -aqE -- "$STUB_SSH_REPLY_MATCH" <<<"$blob"; then printf '%s\n' "${STUB_SSH_REPLY:-}"; exit 0; fi
if [[ -n "${STUB_SSH_FAIL_MATCH:-}" ]] && grep -aqE -- "$STUB_SSH_FAIL_MATCH" <<<"$blob"; then echo "ssh: lỗi giả (tiêm)" >&2; exit "${STUB_SSH_FAIL_RC:-255}"; fi
cd "${FAKE_HOME:?}" || exit 99
STUB_SIDE=remote exec bash -c "$cmd" < "$f"
EOS
cat > "$STUB/scp" <<'EOS'
#!/usr/bin/env bash
# scp giả: chép file vào đường dẫn "VPS" cùng máy; STUB_SCP_FAIL=1 lỗi, STUB_SCP_CORRUPT=1 làm hỏng bản đã chép.
S="${STUB_STATE:?}"; a=("$@"); i=0; opts=(); dd=0
while (( i < ${#a[@]} )); do x="${a[i]}"; i=$((i + 1)); if [[ "$x" == -- ]]; then dd=1; break; fi; opts+=("$x"); done
rest=("${a[@]:i}"); dest="${rest[${#rest[@]}-1]}"; unset 'rest[${#rest[@]}-1]'
host="${dest%%:*}"; path="${dest#*:}"
echo "scp opts=[${opts[*]}] dashdash=$dd host=[$host] files=[${rest[*]}] dest=[$path]" >> "$S/net.log"
echo "scp" >> "$S/events.log"
if [[ -n "${STUB_SCP_HANG:-}" ]]; then : > "$S/scp.started"; sleep "$STUB_SCP_HANG"; fi
[[ -z "${STUB_SCP_FAIL:-}" ]] || { echo "scp: lỗi giả" >&2; exit 1; }
for f in "${rest[@]}"; do cp -- "$f" "$path" || exit 1; done
[[ -z "${STUB_SCP_CORRUPT:-}" ]] || echo "rác" >> "${path%/}/release.tgz"
exit 0
EOS
# gzip giả: chỉ khi `gzip -c` (khâu nén của pipe send) mới ép lỗi; mọi lời gọi khác (tar -z, gunzip) chuyển cho gzip thật.
cat > "$STUB/gzip" <<EOS
#!/usr/bin/env bash
if [[ -n "\${STUB_GZIP_FAIL:-}" && "\$*" == "-c" ]]; then cat >/dev/null; echo "gzip lỗi giả" >&2; exit 1; fi
exec "$REAL_GZIP" "\$@"
EOS
# gunzip giả (chỉ phía "VPS" trong pipe nạp image): STUB_GUNZIP_FAIL=1 -> in rác/cắt luồng rồi thoát khác 0; còn lại chuyển cho gunzip thật.
REAL_GUNZIP="$(command -v gunzip)"
cat > "$STUB/gunzip" <<EOS
#!/usr/bin/env bash
if [[ -n "\${STUB_GUNZIP_FAIL:-}" ]]; then head -c 64 >/dev/null; printf 'IMG rác cắt ngang'; echo "gunzip: luồng bị cắt giả" >&2; exit 1; fi
exec "$REAL_GUNZIP" "\$@"
EOS
chmod +x "$STUB/docker" "$STUB/ssh" "$STUB/scp" "$STUB/gzip" "$STUB/gunzip"

# ── Dựng một ca: gói thật (bộ cài thật + file giả), release.env, image giả, "VPS" có sẵn bản cũ ──
fake_id() { printf 'sha256:%s' "$(printf '%s' "$1" | sha256sum | cut -d' ' -f1)"; }
BE_TAG="1.2.3-abc1234"
BE_REF="realestatemanager-backend:$BE_TAG"; FE_REF="realestatemanager-frontend:$BE_TAG"
# make_case <tên> [OMIT=<file whitelist bỏ khỏi gói>]: đặt LOCAL (thư mục repo build), STATE, VHOME (HOME "VPS"), VDIR (thư mục deploy có sẵn).
make_case() {
  local n="$1" omit="" kv; shift
  for kv in "$@"; do case "$kv" in OMIT=*) omit="${kv#OMIT=}" ;; esac; done
  LOCAL="$TMP/$n/local"; STATE="$TMP/$n/state"; VHOME="$TMP/$n/vhome"; VDIR="$VHOME/RealEstateManager"
  local pkg="$TMP/$n/pkg"
  mkdir -p "$LOCAL/ops/lib" "$STATE/img" "$STATE/rimg" "$VHOME/tmp" "$pkg/ops/lib" "$pkg/scripts"
  cp "$RELEASE_SH_SRC" "$LOCAL/release.sh"; cp "$ROOT_DIR/ops/lib/ops-common.sh" "$LOCAL/ops/lib/ops-common.sh"
  cp "$INSTALL_SH_SRC" "$pkg/ops/install-release.sh"; cp "$ROOT_DIR/ops/lib/ops-common.sh" "$pkg/ops/lib/ops-common.sh"
  printf '#!/usr/bin/env bash\necho "check-disk-new args=$* v=$(sed -n "s/^RELEASE_VERSION=//p" release.env)" >> "$STUB_STATE/events.log"\nexit "${FAKE_DISK_RC:-0}"\n' > "$pkg/ops/check-disk.sh"
  printf '#!/usr/bin/env bash\necho "deploy pwd=$(pwd -P) v=$(sed -n "s/^RELEASE_VERSION=//p" release.env)" >> "$STUB_STATE/events.log"\nexit "${FAKE_DEPLOY_RC:-0}"\n' > "$pkg/deploy.sh"
  echo '#!/usr/bin/env bash' > "$pkg/backup.sh"; echo '#!/usr/bin/env bash' > "$pkg/restore.sh"
  echo '#!/usr/bin/env bash' > "$pkg/scripts/run-migration.sh"; echo 'name: realestatemanager' > "$pkg/docker-compose.yml"
  {
    echo "RELEASE_VERSION=1.2.3"; echo "RELEASE_LOCAL=0"; echo "GIT_COMMIT=abc1234"
    echo "BACKEND_IMAGE_NAME=realestatemanager-backend"; echo "BACKEND_IMAGE_TAG=$BE_TAG"; echo "BACKEND_IMAGE_ID=$(fake_id "$BE_REF")"
    echo "FRONTEND_IMAGE_NAME=realestatemanager-frontend"; echo "FRONTEND_IMAGE_TAG=$BE_TAG"; echo "FRONTEND_IMAGE_ID=$(fake_id "$FE_REF")"
  } > "$pkg/release.env"
  local -a files=(docker-compose.yml deploy.sh backup.sh restore.sh release.env ops/install-release.sh ops/lib/ops-common.sh ops/check-disk.sh scripts/run-migration.sh)
  if [[ -n "$omit" ]]; then local -a kept=() f; for f in "${files[@]}"; do [[ "$f" == "$omit" ]] || kept+=("$f"); done; files=("${kept[@]}"); fi
  printf '%s\n' "${files[@]}" > "$pkg/.list"
  tar --owner=0 --group=0 --numeric-owner --mode=644 -czf "$LOCAL/release.tgz" -C "$pkg" -T "$pkg/.list"
  cp "$pkg/release.env" "$LOCAL/release.env"
  ( cd "$LOCAL" && sha256sum release.tgz > release.tgz.sha256 )
  fake_id "$BE_REF" > "$STATE/img/${BE_REF//[\/:]/_}"; fake_id "$FE_REF" > "$STATE/img/${FE_REF//[\/:]/_}"
  echo "DB_PASSWORD=$SECRET_LOCAL" > "$LOCAL/.env"
  # "VPS" có sẵn bản cũ (KHÔNG có ops/install-release.sh: bố cục trước v1.0.6) + dữ liệu phải giữ nguyên
  mkdir -p "$VDIR/ops" "$VDIR/backups" "$VDIR/logs"
  echo "DB_PASSWORD=$SECRET_VPS" > "$VDIR/.env"; echo "dump" > "$VDIR/backups/old.archive"; echo "log" > "$VDIR/logs/app.log"
  printf '#!/usr/bin/env bash\necho "deploy-OLD" >> "$STUB_STATE/events.log"\n' > "$VDIR/deploy.sh"; chmod +x "$VDIR/deploy.sh"
  printf '#!/usr/bin/env bash\necho "check-disk-OLD" >> "$STUB_STATE/events.log"\n' > "$VDIR/ops/check-disk.sh"
  echo "RELEASE_VERSION=0.0.1" > "$VDIR/release.env"; echo 'name: old' > "$VDIR/docker-compose.yml"
  echo '#!/usr/bin/env bash' > "$VDIR/backup.sh"; echo '#!/usr/bin/env bash' > "$VDIR/restore.sh"; mkdir -p "$VDIR/scripts"
}

# run_send [KEY=VAL ...] -- <đối số của send>: kết quả ở OUT (stdout+stderr) và RC.
OUT=""; RC=0
run_send() {
  local -a envs=()
  while (( $# > 0 )) && [[ "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  OUT="$(cd "$LOCAL" && env -u CI -u GITHUB_ACTIONS -u RELEASE_SSH_OPTS "${envs[@]}" PATH="$STUB:$PATH" STUB_STATE="$STATE" FAKE_HOME="$VHOME" TMPDIR="$VHOME/tmp" bash release.sh send "$@" 2>&1)"; RC=$?
}
net_log() { cat "$STATE/net.log" 2>/dev/null || true; }
events() { cat "$STATE/events.log" 2>/dev/null || true; }
dkr_log() { cat "$STATE/docker.log" 2>/dev/null || true; }
# Số thứ tự dòng đầu tiên khớp $1 trong events.log (0 nếu không có).
ev_line() { grep -n -m1 -- "$1" "$STATE/events.log" 2>/dev/null | cut -d: -f1 || true; }
env_val() { sed -n "s/^$2=//p" "$1" | head -n 1; }
no_net() { expect_eq "$1: không chạm ssh/scp" "" "$(net_log)"; expect_eq "$1: không chạy docker save/load" "" "$(events)"; }
vps_tmp_left() { find "$VHOME/tmp" -maxdepth 1 -name 'release-send.*' 2>/dev/null | wc -l | tr -d ' '; }
BASE_ARGS=(--to vps-test)

# ── 1) Bước 0: từ chối, không chạm mạng ──────────────────────────────────────
if want pre; then
echo "== 1) bước 0: từ chối bản -local/-dirty, thiếu hoặc lệch gói/ID image =="
make_case p1
sed -i 's/^RELEASE_LOCAL=0/RELEASE_LOCAL=1/' "$LOCAL/release.env"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] RELEASE_LOCAL=1 bị từ chối" "$RC"; expect_contains "[1] thông báo từ chối" "TỪ CHỐI" "$OUT"; no_net "[1] RELEASE_LOCAL=1"

make_case p2
sed -i 's/^RELEASE_LOCAL=.*//; s/^\(BACKEND_IMAGE_TAG\)=.*/\1=1.2.3-local/' "$LOCAL/release.env"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] tag -local (thiếu cờ) bị từ chối" "$RC"; expect_contains "[1] thông báo" "TỪ CHỐI" "$OUT"; no_net "[1] tag -local"

make_case p3
sed -i 's/^GIT_COMMIT=.*/GIT_COMMIT=abc1234-dirty/' "$LOCAL/release.env"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] commit -dirty bị từ chối" "$RC"; expect_contains "[1] thông báo" "TỪ CHỐI" "$OUT"; no_net "[1] -dirty"

make_case p4
sed -i '/^RELEASE_LOCAL=/d' "$LOCAL/release.env"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] thiếu cờ RELEASE_LOCAL (tag thường) bị từ chối" "$RC"; expect_contains "[1] nêu RELEASE_LOCAL" "RELEASE_LOCAL" "$OUT"; no_net "[1] thiếu cờ"

make_case p5; rm -f "$LOCAL/release.env"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] thiếu release.env" "$RC"; expect_contains "[1] nhắc build" "build" "$OUT"; no_net "[1] thiếu release.env"

make_case p6; rm -f "$LOCAL/release.tgz"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] thiếu release.tgz" "$RC"; expect_contains "[1] nêu release.tgz" "release.tgz" "$OUT"; no_net "[1] thiếu tgz"

make_case p7; rm -f "$LOCAL/release.tgz.sha256"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] thiếu .sha256" "$RC"; expect_contains "[1] nêu .sha256" "sha256" "$OUT"; no_net "[1] thiếu sha256"

make_case p8; echo "rác" >> "$LOCAL/release.tgz"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] gói bị sửa (sha256 sai)" "$RC"; expect_contains "[1] nêu không khớp" "không khớp" "$OUT"; no_net "[1] sha256 sai"

make_case p9; sed -i 's/^GIT_COMMIT=.*/GIT_COMMIT=def5678/' "$LOCAL/release.env"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] release.env cạnh gói khác bản trong gói" "$RC"; expect_contains "[1] nêu lẫn hai lần build" "khác" "$OUT"; no_net "[1] release.env lệch"

make_case p10; rm -f "$STATE/img/${FE_REF//[\/:]/_}"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] image FE không có trên máy build" "$RC"; expect_contains "[1] nêu image" "$FE_REF" "$OUT"; no_net "[1] thiếu image"

make_case p11; fake_id "khac" > "$STATE/img/${BE_REF//[\/:]/_}"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[1] ID image BE lệch release.env" "$RC"; expect_contains "[1] nêu ID khác" "Build lại" "$OUT"; no_net "[1] ID lệch"

make_case p12
run_send -- ; expect_nonzero "[1] thiếu --to" "$RC"; expect_contains "[1] nêu --to" "--to" "$OUT"; no_net "[1] thiếu --to"
run_send -- --to vps-test --bogus; expect_nonzero "[1] cờ lạ" "$RC"; no_net "[1] cờ lạ"
run_send -- --to; expect_nonzero "[1] --to thiếu giá trị" "$RC"; no_net "[1] --to rỗng"
run_send -- --help; expect_rc "[1] --help" 0 "$RC"; expect_contains "[1] --help nêu send" "send --to" "$OUT"
expect_not_contains "[1] dùng sai/--help không lộ bí mật" "$SECRET_LOCAL" "$OUT"
fi

# ── 2) --to / --dir độc hại ──────────────────────────────────────────────────
if want host; then
echo "== 2) --to và --dir độc hại: từ chối trước khi chạm mạng =="
make_case h1
for bad in '-oProxyCommand=touch${IFS}/tmp/pwn' '-F/etc/passwd' '-l' 'a;rm -rf x' 'a b' 'a$(id)' 'a`id`' 'host:22' 'a|b' 'a&b' 'a>b' "a'b" 'a"b' 'a\b' '../x' 'a/b' '~' '*' $'a\nb' ''; do
  run_send -- --to "$bad"
  expect_nonzero "[2] --to [${bad:0:30}] bị từ chối" "$RC"
  no_net "[2] --to [${bad:0:30}]"
done
for badd in '-x' '--init' 'a b' '../x' 'a/../b' 'a;b' '$HOME' '~/x' 'a`id`' "a'b" 'a"b' '/' 'a:b' 'a*' $'a\nb'; do
  run_send -- --to vps-test --dir "$badd"
  expect_nonzero "[2] --dir [${badd:0:30}] bị từ chối" "$RC"
  no_net "[2] --dir [${badd:0:30}]"
done
expect_contains "[2] thông báo nêu --dir" "--dir" "$OUT"
# Hợp lệ: user@host, alias có gạch, IP, tên miền (dry-run: chỉ kiểm chấp nhận cú pháp, không chạm mạng)
for good in vps-1 user@vps.example.com ubuntu@203.0.113.10 prod_vps; do
  run_send -- --to "$good" --dry-run
  expect_rc "[2] --to [$good] hợp lệ (dry-run)" 0 "$RC"
done
for goodd in RealEstateManager /opt/realestate/app a/b_c-d.e; do
  run_send -- --to vps-test --dir "$goodd" --dry-run
  expect_rc "[2] --dir [$goodd] hợp lệ (dry-run)" 0 "$RC"
done
no_net "[2] dry-run hợp lệ"
fi

# ── 3) Luồng đạt ────────────────────────────────────────────────────────────
if want happy; then
echo "== 3) luồng đạt: thứ tự (1)-(4), nội dung VPS, dọn tạm, không lộ bí mật =="
make_case g1
run_send -- "${BASE_ARGS[@]}"
expect_rc "[3] send đạt" 0 "$RC"
EV="$(events)"
L_SCP="$(ev_line '^scp')"; L_DISK="$(ev_line 'check-disk-new')"; L_SAVE="$(ev_line 'docker-save')"; L_LOAD="$(ev_line 'docker-load')"; L_DEP="$(ev_line '^deploy pwd=')"
[[ -n "$L_SCP" && -n "$L_DISK" && -n "$L_SAVE" && -n "$L_LOAD" && -n "$L_DEP" ]] && ok || fail "[3] thiếu sự kiện: scp=$L_SCP disk=$L_DISK save=$L_SAVE load=$L_LOAD deploy=$L_DEP ($EV)"
[[ -n "$L_SCP" && -n "$L_DISK" && -n "$L_SAVE" && -n "$L_LOAD" && -n "$L_DEP" ]] \
  && (( L_SCP < L_DISK && L_DISK < L_SAVE && L_SAVE < L_LOAD && L_LOAD < L_DEP )) && ok || fail "[3] sai thứ tự scp<disk<save<load<deploy: $EV"
expect_eq "[3] mỗi bước đúng 1 lần" "5" "$(grep -cE '^(scp|check-disk-new|docker-save|docker-load|deploy pwd=)' <<<"$EV")"
expect_not_contains "[3] không chạy bản CŨ của check-disk/deploy" "OLD" "$EV"
expect_contains "[3] check-disk-new thấy release.env mới (đã cài trước bước 2)" "check-disk-new args= v=1.2.3" "$EV"
expect_contains "[3] deploy chạy trong thư mục deploy" "deploy pwd=$(cd "$VDIR" && pwd -P) v=1.2.3" "$EV"
# Dữ liệu người dùng nguyên vẹn, gói đã cài, bộ cài có mặt (lần cài đầu: VPS chưa có install-release.sh)
expect_eq "[3] .env VPS nguyên vẹn" "DB_PASSWORD=$SECRET_VPS" "$(cat "$VDIR/.env")"
expect_eq "[3] backups/ nguyên vẹn" "dump" "$(cat "$VDIR/backups/old.archive")"
expect_eq "[3] logs/ nguyên vẹn" "log" "$(cat "$VDIR/logs/app.log")"
expect_eq "[3] release.env trên VPS = bản local" "$(cat "$LOCAL/release.env")" "$(cat "$VDIR/release.env")"
expect_file "[3] ops/install-release.sh đã có trên VPS" "$VDIR/ops/install-release.sh"
expect_eq "[3] không để lại thư mục tạm/khóa của bộ cài" "0" "$(find "$VDIR" -maxdepth 1 -name '.install-release.*' | wc -l | tr -d ' ')"
expect_eq "[3] thư mục tạm release-send trên VPS đã xóa" "0" "$(vps_tmp_left)"
expect_eq "[3] không có .env của local trên VPS ngoài .env của VPS" "$SECRET_VPS" "$(grep -rl "$SECRET_LOCAL" "$VDIR" "$VHOME" 2>/dev/null | head -n1 | sed 's/.*/&/' | { read -r x; [[ -z "$x" ]] && echo "$SECRET_VPS" || echo "LỘ: $x"; })"
# Image đã sang VPS đúng tag/ID
expect_eq "[3] BE đã nạp lên VPS" "$(fake_id "$BE_REF")" "$(cat "$STATE/rimg/${BE_REF//[\/:]/_}")"
expect_eq "[3] FE đã nạp lên VPS" "$(fake_id "$FE_REF")" "$(cat "$STATE/rimg/${FE_REF//[\/:]/_}")"
DK="$(dkr_log)"
expect_eq "[3] docker save: đúng MỘT lần, dòng lệnh khớp CHÍNH XÁC hai tag (không thêm tham số/tag nào khác)" "[local] save $BE_REF $FE_REF" "$(grep -F '] save ' <<<"$DK")"
expect_not_contains "[3] không docker login" "login" "$DK"
expect_not_contains "[3] không docker push" "push" "$DK"
expect_not_contains "[3] không docker pull" "pull" "$DK"
expect_not_contains "[3] không build trong send" "build" "$DK"
# ssh/scp: host sau `--`, BatchMode, scp đúng tệp
NL="$(net_log)"
expect_eq "[3] mọi ssh/scp có dấu -- trước host" "0" "$(grep -c 'dashdash=0' <<<"$NL")"
expect_eq "[3] mọi ssh/scp tới đúng host" "0" "$(grep -vc 'host=\[vps-test\]' <<<"$NL")"
expect_eq "[3] mọi ssh/scp có BatchMode=yes" "0" "$(grep -vc 'BatchMode=yes' <<<"$NL")"
expect_contains "[3] scp gửi gói + .sha256" "files=[release.tgz release.tgz.sha256]" "$NL"
expect_contains "[3] pipe nhận dùng pipefail" "set -o pipefail; gunzip -c | docker load" "$NL"
# Không lộ bí mật
expect_not_contains "[3] đầu ra không lộ .env local" "$SECRET_LOCAL" "$OUT"; expect_not_contains "[3] đầu ra không lộ .env VPS" "$SECRET_VPS" "$OUT"
expect_not_contains "[3] ssh không mang .env local" "$SECRET_LOCAL" "$NL"
expect_contains "[3] báo xong" "Xong" "$OUT"
# Chạy lại (idempotent): vẫn đạt, VPS giữ nguyên kết quả
: > "$STATE/events.log"
run_send -- "${BASE_ARGS[@]}"
expect_rc "[3] chạy lại cùng gói đạt" 0 "$RC"
expect_eq "[3] chạy lại: release.env vẫn đúng" "$(cat "$LOCAL/release.env")" "$(cat "$VDIR/release.env")"
expect_eq "[3] chạy lại: .env vẫn nguyên" "DB_PASSWORD=$SECRET_VPS" "$(cat "$VDIR/.env")"

# --dir tuyệt đối + user@host
make_case g2; ABS="$VHOME/srv/app"; mkdir -p "$ABS"; cp -a "$VDIR/." "$ABS/"
run_send -- --to ubuntu@vps.example.com --dir "$ABS"
expect_rc "[3] --dir tuyệt đối + user@host" 0 "$RC"
expect_contains "[3] deploy chạy ở --dir" "deploy pwd=$(cd "$ABS" && pwd -P)" "$(events)"
expect_contains "[3] ssh tới user@host" "host=[ubuntu@vps.example.com]" "$(net_log)"

# Lần cài đầu thật sự: thư mục deploy chưa có
make_case g3; rm -rf "$VDIR"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[3] thư mục deploy chưa có, không --init: dừng ở bước 1" "$RC"
expect_contains "[3] gợi ý --init" "--init" "$OUT"
expect_contains "[3] nêu bước 1" "Bước 1" "$OUT"
expect_no_file "[3] không tự tạo thư mục khi thiếu --init" "$VDIR"
expect_eq "[3] chưa check-disk/save/load/deploy" "1" "$(grep -c . <<<"$(events)")"   # chỉ có sự kiện scp
run_send -- "${BASE_ARGS[@]}" --init
expect_rc "[3] --init tạo thư mục rồi cài" 0 "$RC"
expect_file "[3] --init: release.env đã cài" "$VDIR/release.env"
expect_file "[3] --init: deploy.sh chạy được" "$VDIR/deploy.sh"
expect_contains "[3] --init: deploy chạy" "deploy pwd=" "$(events)"
expect_eq "[3] --init: thư mục tạm VPS đã xóa" "0" "$(vps_tmp_left)"
# Thư mục deploy có sẵn nhưng KHÔNG giống thư mục deploy (không deploy.sh/.env): dừng ở bước 1, không đụng gì; --init thì cho qua
make_case g4; rm -rf "$VDIR"; mkdir -p "$VDIR"; echo "của người khác" > "$VDIR/ghi-chu.txt"
run_send -- "${BASE_ARGS[@]}"
expect_nonzero "[3] thư mục có sẵn nhưng không phải thư mục deploy: dừng" "$RC"
expect_contains "[3] nêu bước 1" "Bước 1" "$OUT"
expect_contains "[3] gợi ý sai --dir/--init" "--dir" "$OUT"
expect_no_file "[3] không cài gì vào thư mục lạ" "$VDIR/release.env"
expect_eq "[3] thư mục tạm VPS đã xóa" "0" "$(vps_tmp_left)"
expect_eq "[3] chưa check-disk/save/load/deploy" "1" "$(grep -c . <<<"$(events)")"
run_send -- "${BASE_ARGS[@]}" --init
expect_rc "[3] --init cho phép cài vào thư mục có sẵn chưa phải deploy" 0 "$RC"
expect_file "[3] --init: release.env đã cài" "$VDIR/release.env"
# Chỉ có .env (chưa có deploy.sh) vẫn được coi là thư mục deploy
make_case g5; rm -rf "$VDIR"; mkdir -p "$VDIR"; echo "DB_PASSWORD=$SECRET_VPS" > "$VDIR/.env"
run_send -- "${BASE_ARGS[@]}"
expect_rc "[3] thư mục chỉ có .env vẫn là thư mục deploy" 0 "$RC"

# Bị ngắt (TERM) giữa lúc scp: trap dọn thư mục tạm trên VPS, thoát 143, không chạy bước kế tiếp.
# (SIGINT không kiểm được ở đây: tiến trình nền của shell không tương tác bỏ qua SIGINT từ lúc khởi động; INT dùng chung trap `exit 130` + EXIT.)
make_case g6
rm -f "$STATE/scp.started"
env -u CI -u GITHUB_ACTIONS -u RELEASE_SSH_OPTS PATH="$STUB:$PATH" STUB_STATE="$STATE" FAKE_HOME="$VHOME" TMPDIR="$VHOME/tmp" STUB_SCP_HANG=4 \
  bash "$LOCAL/release.sh" send --to vps-test >"$TMP/g6.out" 2>&1 &
G6=$!
for _ in $(seq 1 100); do [[ -e "$STATE/scp.started" ]] && break; sleep 0.1; done
expect_file "[3] scp giả đã bắt đầu treo" "$STATE/scp.started"
expect_eq "[3] khi scp treo, thư mục tạm VPS đang tồn tại" "1" "$(vps_tmp_left)"
kill -TERM "$G6" 2>/dev/null || true
wait "$G6"; G6_RC=$?
expect_eq "[3] bị TERM: thoát 143" "143" "$G6_RC"
expect_eq "[3] bị TERM: thư mục tạm VPS đã được dọn" "0" "$(vps_tmp_left)"
expect_eq "[3] bị TERM: không chạy check-disk/save/load/deploy" "0" "$(grep -cE 'check-disk|docker-save|docker-load|^deploy pwd=' <<<"$(events)")"
expect_eq "[3] bị TERM: VPS giữ nguyên bản cũ" "RELEASE_VERSION=0.0.1" "$(cat "$VDIR/release.env")"
fi

# ── 4) Dừng ở lỗi đầu tiên của từng bước ─────────────────────────────────────
# stop_case <tên ca> <chuỗi phải có trong thông báo> <regex sự kiện KHÔNG được xuất hiện> [KEY=VAL ... cho run_send] -- [tham số make_case]
stop_case() {
  local name="$1" must="$2" absent="$3"; shift 3
  local -a envs=() mk=()
  while (( $# > 0 )) && [[ "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift; mk=("$@")
  make_case "$name" "${mk[@]}"
  run_send "${envs[@]}" -- "${BASE_ARGS[@]}"
  expect_nonzero "[4] $name: send thất bại" "$RC"
  expect_contains "[4] $name: nêu bước" "$must" "$OUT"
  expect_contains "[4] $name: nói rõ KHÔNG tự rollback" "KHÔNG tự rollback" "$OUT"
  expect_contains "[4] $name: có lệnh kế tiếp gợi ý" "Lệnh kế tiếp gợi ý" "$OUT"
  if [[ -n "$absent" ]]; then expect_eq "[4] $name: không có sự kiện [$absent] sau chỗ lỗi" "0" "$(grep -cE "$absent" <<<"$(events)")"; fi
  expect_not_contains "[4] $name: không docker login/push/pull" "login" "$(dkr_log)"
  expect_not_contains "[4] $name: không push" "push" "$(dkr_log)"
  expect_not_contains "[4] $name: không pull" "pull" "$(dkr_log)"
  expect_not_contains "[4] $name: không lộ bí mật" "$SECRET_LOCAL" "$OUT"
  expect_not_contains "[4] $name: không lộ bí mật VPS" "$SECRET_VPS" "$OUT"
  expect_not_contains "[4] $name: không chạy restore" "restore" "$(events)"
}
if want fail; then
echo "== 4) dừng ở lỗi đầu tiên của từng bước, không rollback =="
ALL_AFTER1='check-disk|docker-save|docker-load|^deploy pwd='
# 1a: ssh/mktemp lỗi
stop_case f1a "Bước 1 (tạo thư mục tạm" "^scp|$ALL_AFTER1" STUB_SSH_FAIL_MATCH='mktemp'
# 1a: VPS trả đường dẫn lạ -> không bao giờ rm -rf thứ gì
for reply in '/' '/home/ubuntu' '/etc/release-send.x/../..' 'tmp/release-send.abc' '/tmp/../etc/release-send.abc' '/tmp/x/../release-send.abc'; do
  stop_case f1a2 "Bước 1 (tạo thư mục tạm" "^scp|$ALL_AFTER1" STUB_SSH_REPLY_MATCH='mktemp' STUB_SSH_REPLY="$reply"
  expect_not_contains "[4] f1a2 [$reply]: không rm -rf đường dẫn lạ" "rm -rf" "$(net_log)"
done
# 1b: scp lỗi -> thư mục tạm vẫn được dọn
stop_case f1b "Bước 1 (scp" "check-disk|docker-save|docker-load|^deploy pwd=" STUB_SCP_FAIL=1
expect_contains "[4] f1b: vẫn dọn thư mục tạm" "rm -rf" "$(net_log)"
expect_eq "[4] f1b: thư mục tạm VPS đã xóa" "0" "$(vps_tmp_left)"
# 1c: gói hỏng khi truyền -> sha256 phía VPS bắt, chưa cài gì
stop_case f1c "Bước 1 (xác minh sha256 phía VPS" "check-disk|docker-save|docker-load|^deploy pwd=" STUB_SCP_CORRUPT=1
expect_eq "[4] f1c: VPS chưa bị đổi (release.env cũ)" "RELEASE_VERSION=0.0.1" "$(cat "$VDIR/release.env")"
expect_no_file "[4] f1c: chưa có bộ cài" "$VDIR/ops/install-release.sh"
expect_eq "[4] f1c: thư mục tạm VPS đã xóa" "0" "$(vps_tmp_left)"
# 1d: ssh chết đúng lúc chạy bộ cài
stop_case f1d "Bước 1 (cài gói" "check-disk|docker-save|docker-load|^deploy pwd=" STUB_SSH_FAIL_MATCH='install-release.sh --dir'
# 1d: bộ cài THẬT từ chối gói thiếu mục whitelist -> VPS nguyên vẹn
stop_case f1e "Bước 1 (cài gói" "check-disk|docker-save|docker-load|^deploy pwd=" -- OMIT=backup.sh
expect_eq "[4] f1e: VPS giữ nguyên bản cũ" "RELEASE_VERSION=0.0.1" "$(cat "$VDIR/release.env")"
expect_eq "[4] f1e: .env nguyên" "DB_PASSWORD=$SECRET_VPS" "$(cat "$VDIR/.env")"
expect_eq "[4] f1e: thư mục tạm VPS đã xóa" "0" "$(vps_tmp_left)"
# 2: thiếu đĩa
stop_case f2 "Bước 2" "docker-save|docker-load|^deploy pwd=" FAKE_DISK_RC=1
expect_contains "[4] f2: check-disk MỚI đã chạy (gói đã cài trước bước 2)" "check-disk-new" "$(events)"
expect_eq "[4] f2: không nạp image nào lên VPS" "0" "$(find "$STATE/rimg" -type f | wc -l | tr -d ' ')"
# 3: lỗi giữa pipe, ssh vẫn trả 0
stop_case f3a "Bước 3 (docker save" "^deploy pwd=" STUB_SAVE_FAIL=mid
expect_contains "[4] f3a: báo mã từng khâu" "docker save=1" "$OUT"
stop_case f3a2 "Bước 3 (docker save" "^deploy pwd=" STUB_SAVE_FAIL=early
stop_case f3b "Bước 3 (ssh" "^deploy pwd=" STUB_SSH_FAIL_MATCH='docker load'
stop_case f3b2 "Bước 3 (ssh" "^deploy pwd=" STUB_LOAD_FAIL=1
stop_case f3c "Bước 3 (gzip" "^deploy pwd=" STUB_GZIP_FAIL=1
# 3: docker load "xong" nhưng VPS không có image -> bị bắt ở bước kiểm
stop_case f3d "Bước 3 (kiểm image đã nạp" "^deploy pwd=" STUB_LOAD_SKIP=1
# 3: pipefail phía VPS (HÀNH VI): gunzip chết giữa luồng nhưng `docker load` giả vẫn thoát 0, và hai image ĐÃ có sẵn trên VPS (bước kiểm tag
# không thể cứu) -> chỉ `set -o pipefail` trong REMOTE_LOAD_CMD mới làm bước 3 thất bại. Bỏ pipefail thì ca này phải hỏng.
make_case f3e
for r in "$BE_REF" "$FE_REF"; do fake_id "$r" > "$STATE/rimg/${r//[\/:]/_}"; done
run_send STUB_GUNZIP_FAIL=1 -- "${BASE_ARGS[@]}"
expect_nonzero "[4] f3e: gunzip chết giữa luồng, docker load trả 0 -> send phải thất bại" "$RC"
expect_contains "[4] f3e: dừng ở bước 3 (phía nhận)" "Bước 3 (ssh" "$OUT"
expect_contains "[4] f3e: docker load đã thật sự chạy (và trả 0)" "docker-load" "$(events)"
expect_eq "[4] f3e: không deploy" "0" "$(grep -c '^deploy pwd=' <<<"$(events)")"
expect_contains "[4] f3e: KHÔNG tự rollback" "KHÔNG tự rollback" "$OUT"
# 3: ID lệch chỉ cảnh báo, vẫn deploy
make_case w3; run_send STUB_LOAD_ID="sha256:$(printf 'f%.0s' $(seq 64))" -- "${BASE_ARGS[@]}"
expect_rc "[4] ID image VPS lệch: chỉ cảnh báo, vẫn đạt" 0 "$RC"
expect_contains "[4] ID lệch: có CẢNH BÁO" "CẢNH BÁO" "$OUT"
expect_contains "[4] ID lệch: vẫn deploy" "deploy pwd=" "$(events)"
# 4: deploy.sh lỗi -> không rollback
stop_case f4 "Bước 4" "restore" FAKE_DEPLOY_RC=3
expect_contains "[4] f4: deploy đã chạy 1 lần" "deploy pwd=" "$(events)"
expect_contains "[4] f4: image vẫn ở VPS (không dọn/rollback)" "sha256:" "$(cat "$STATE/rimg/${BE_REF//[\/:]/_}")"
expect_contains "[4] f4: gợi ý chạy lại deploy.sh" "./deploy.sh" "$OUT"
expect_eq "[4] f4: release.env mới vẫn ở VPS" "$(cat "$LOCAL/release.env")" "$(cat "$VDIR/release.env")"
fi

# ── 5) --dry-run ─────────────────────────────────────────────────────────────
if want dry; then
echo "== 5) --dry-run: in kế hoạch, không chạy gì =="
make_case d1
run_send -- "${BASE_ARGS[@]}" --dir srv/app --init --dry-run
expect_rc "[5] dry-run đạt" 0 "$RC"
for k in "(1/4)" "(2/4)" "(3/4)" "(4/4)" "vps-test" "srv/app" "install-release" "check-disk" "docker save $BE_REF $FE_REF" "gunzip" "deploy.sh" "--init"; do
  expect_contains "[5] kế hoạch nêu [$k]" "$k" "$OUT"
done
expect_eq "[5] dry-run: không ssh/scp" "" "$(net_log)"
expect_eq "[5] dry-run: không có sự kiện save/load/deploy" "" "$(events)"
expect_not_contains "[5] dry-run: không docker save" "save" "$(dkr_log)"
expect_not_contains "[5] dry-run: không docker load" "load" "$(dkr_log)"
expect_not_contains "[5] dry-run: không lộ bí mật" "$SECRET_LOCAL" "$OUT"
expect_eq "[5] dry-run: VPS không đổi" "RELEASE_VERSION=0.0.1" "$(cat "$VDIR/release.env")"
# dry-run vẫn từ chối bản -local và gói lệch
sed -i 's/^RELEASE_LOCAL=0/RELEASE_LOCAL=1/' "$LOCAL/release.env"
run_send -- "${BASE_ARGS[@]}" --dry-run
expect_nonzero "[5] dry-run vẫn từ chối bản -local" "$RC"; expect_contains "[5] thông báo" "TỪ CHỐI" "$OUT"
make_case d2; echo "rác" >> "$LOCAL/release.tgz"
run_send -- "${BASE_ARGS[@]}" --dry-run
expect_nonzero "[5] dry-run vẫn từ chối gói sai sha256" "$RC"
fi

# ── 6) RELEASE_SSH_OPTS ──────────────────────────────────────────────────────
if want opts; then
echo "== 6) RELEASE_SSH_OPTS đi tới ssh, scp và pipe nạp image; đứng trước mặc định =="
make_case o1
run_send RELEASE_SSH_OPTS='-i /k/id_prod -o Port=2222 -o BatchMode=no' -- "${BASE_ARGS[@]}"
expect_rc "[6] có RELEASE_SSH_OPTS vẫn đạt" 0 "$RC"
NL="$(net_log)"
expect_eq "[6] mọi ssh/scp mang tùy chọn người dùng đứng TRƯỚC mặc định" "0" "$(grep -vc 'opts=\[-i /k/id_prod -o Port=2222 -o BatchMode=no -o BatchMode=yes ' <<<"$NL")"
expect_eq "[6] ssh (kể cả pipe load) + scp đều có" "1" "$(grep -c '^scp ' <<<"$NL")"
expect_contains "[6] pipe nạp image có tùy chọn" "-i /k/id_prod" "$(grep 'docker load' <<<"$NL")"
make_case o2
run_send -- "${BASE_ARGS[@]}"
expect_contains "[6] mặc định: BatchMode=yes" "-o BatchMode=yes" "$(net_log)"
expect_contains "[6] mặc định: ConnectTimeout" "ConnectTimeout=15" "$(net_log)"
expect_contains "[6] mặc định: ServerAliveInterval" "ServerAliveInterval=30" "$(net_log)"
fi

# ── 7) Kiểm tĩnh release.sh ──────────────────────────────────────────────────
if want static; then
echo "== 7) kiểm tĩnh release.sh =="
RS="$RELEASE_SH_SRC"
CODE="$(grep -vE '^\s*#' "$RS")"
expect_eq "[7] không docker login/push/pull" "0" "$(grep -cE 'docker (login|push|pull)|docker buildx .*--push|docker image (push|pull)' <<<"$CODE")"
expect_eq "[7] mọi lời gọi ssh/scp (không tính chú thích) có dấu -- trước host" "0" \
  "$(grep -E '(^|[|;&({]) *(ssh|scp) "' <<<"$CODE" | grep -vcE -- '(ssh|scp) "\$\{SSH_OPTS\[@\]\}" -- ')"
expect_eq "[7] có đủ 4 điểm gọi ssh/scp (ssh_cmd, ssh_script, scp, pipe nạp)" "4" "$(grep -cE '(^|[|;&({]) *(ssh|scp) "' <<<"$CODE")"
expect_eq "[7] bước nạp image có pipefail khâu nhận" "1" "$(grep -c "^readonly REMOTE_LOAD_CMD=.*set -o pipefail; gunzip -c | docker load" <<<"$CODE")"
expect_eq "[7] bước nạp image kiểm PIPESTATUS" "1" "$(grep -c 'PIPESTATUS' <<<"$CODE")"
expect_eq "[7] đủ ba khâu pipe: docker save | gzip | ssh" "1" "$(grep -cE 'docker save "\$BE_REF" "\$FE_REF" \| gzip -c \| ssh ' <<<"$CODE")"
expect_eq "[7] release.sh không chứa IP/host cứng" "0" "$(grep -cE '([0-9]{1,3}\.){3}[0-9]{1,3}' <<<"$CODE")"
expect_eq "[7] release.sh dùng LF" "0" "$(tr -cd '\r' < "$RS" | wc -c | tr -d ' ')"
bash -n "$RS"; expect_rc "[7] release.sh qua bash -n" 0 "$?"
fi

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
