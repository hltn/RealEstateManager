#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/install-release.test.sh — test shell KHÔNG cần Docker/ssh/VPS cho `ops/install-release.sh` (v1.0.6, T-31, FR-14, FR-21).
#
# Mỗi ca dựng một thư mục deploy GIẢ (có bản "OLD" + file cần bảo vệ: .env, .env.docker, backups/, logs/, notes.txt, release.tgz) và
# một gói release.tgz giả (bằng python tarfile để dựng được cả gói độc hại, hoặc bằng GNU tar giống release.sh). Bộ cài chạy từ bản
# sao riêng NGOÀI thư mục deploy (`--dir`). `chmod` và `mv` là bản giả đặt đầu PATH: chmod ghi nhật ký (Windows/NTFS không giữ bit +x),
# mv có thể bị ép lỗi/kill -9 đúng ở một mục để thử "lỗi giữa chừng".
#
# Phủ: whitelist đúng và đủ, KHÔNG đụng .env/backups/logs/file lạ, idempotent (chạy 2 lần), nâng cấp qua gói thứ hai (mục cũ biến mất),
# cài lần đầu vào thư mục trống, chmod +x cho *.sh, checksum sai/thiếu/sai định dạng (deploy giữ NGUYÊN), gói độc hại (.., tuyệt đối,
# ổ đĩa, `\`, xuống dòng, symlink, hardlink, fifo, file ngoài whitelist, .env/backups/logs/dump trong whitelist, trùng tên, thiếu mục,
# sai kiểu mục, gói rỗng/không phải gzip) đều bị từ chối TRƯỚC khi giải nén và không để lại gì, lỗi/kill giữa lúc hoán đổi tự hoàn tác
# (cả lần chạy sau khi bị kill -9), khóa chống chạy chồng, thay chính mình khi chạy từ <deploy>/ops (chỉ Linux), mục deploy là symlink,
# gói dựng bằng GNU tar giống release.sh, gói dựng từ file git thật của repo, canh lệch whitelist với release.sh, không rò bí mật.
#
# Chạy:  bash ops/tests/install-release.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
#        INSTALL_SH=<đường-dẫn> bash ...             (chạy bộ test trên một bản script khác: mutation test)
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
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: không thấy [$2] trong [${3:0:600}]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: KHÔNG được chứa [$2] (đầu ra: ${3:0:600})"; fi; }
expect_rc() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mã thoát mong đợi $2, nhận $3 (đầu ra: ${OUT:0:600})"; fi; }
expect_nonzero() { if [[ "$2" != "0" ]]; then ok; else fail "$1: mong đợi mã thoát khác 0 (đầu ra: ${OUT:0:600})"; fi; }
expect_file() { if [[ -e "$2" ]]; then ok; else fail "$1: thiếu $2"; fi; }
expect_no_file() { if [[ ! -e "$2" && ! -L "$2" ]]; then ok; else fail "$1: $2 không được tồn tại"; fi; }
file_has() { grep -qF -- "$3" "$2" 2>/dev/null && ok || fail "$1: $2 không chứa [$3] (có: $(head -c 120 "$2" 2>/dev/null | tr '\n' ' '))"; }

INSTALL_SH_SRC="${INSTALL_SH:-$ROOT_DIR/ops/install-release.sh}"
# ONLY="5 6": chỉ chạy các nhóm ca được liệt kê (g1 = ca 1-3, 4..11) để mutation test nhanh; mặc định chạy tất cả.
want() { [[ -z "${ONLY:-}" || " $ONLY " == *" $1 "* ]]; }
SECRET="zq7TopSecretValue"
IS_WIN=0; case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) IS_WIN=1 ;; esac
PY=""; for c in python3 python; do if command -v "$c" >/dev/null 2>&1 && "$c" -I -c 'import tarfile' 2>/dev/null; then PY="$c"; break; fi; done
[[ -n "$PY" ]] || { echo "Thiếu python3/python (cần để dựng gói thử)." >&2; exit 1; }
REAL_CHMOD="$(type -P chmod)"; REAL_MV="$(type -P mv)"

# ── chmod/mv giả ─────────────────────────────────────────────────────────────
STUB="$TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/chmod" <<'EOS'
#!/usr/bin/env bash
echo "$*" >> "${STUB_STATE:?}/chmod.log"
exec "${REAL_CHMOD:?}" "$@"
EOS
cat > "$STUB/mv" <<'EOS'
#!/usr/bin/env bash
# mv giả: nếu một tham số khớp glob $STUB_MV_MATCH thì ép lỗi (mặc định) hoặc kill -9 tiến trình cha (STUB_MV_MODE=kill).
if [[ -n "${STUB_MV_MATCH:-}" ]]; then
  for a in "$@"; do
    if [[ "$a" == $STUB_MV_MATCH ]]; then
      echo "mv-giả chặn: $a" >> "${STUB_STATE:?}/mv.log"
      [[ "${STUB_MV_MODE:-fail}" == "kill" ]] && kill -9 "$PPID"
      exit 1
    fi
  done
fi
exec "${REAL_MV:?}" "$@"
EOS
chmod +x "$STUB/chmod" "$STUB/mv"

# ── Dựng gói bằng python (cho phép gói độc hại) ──────────────────────────────
cat > "$TMP/mkpkg.py" <<'EOP'
# usage: mkpkg.py TREE OUT [--omit NAME]... [--extra KIND|NAME|ARG]... [--mode NAME=OCTAL]... [--empty]
# --mode: đặt quyền (kể cả bit setuid/setgid/sticky, vd 4755) cho mục NAME (file trong cây hoặc mục --extra; bỏ '/' cuối của thư mục).
# KIND: reg (ARG=nội dung), sym/hard (ARG=đích), dir, fifo. `@NL@` trong NAME = xuống dòng.
import os, sys, tarfile, io
tree, out = sys.argv[1], sys.argv[2]
omit, extras, empty, modes = set(), [], False, {}
a = sys.argv[3:]
while a:
    k = a.pop(0)
    if k == "--omit": omit.add(a.pop(0))
    elif k == "--extra": extras.append(a.pop(0))
    elif k == "--empty": empty = True
    elif k == "--mode":
        n, m = a.pop(0).rsplit("=", 1); modes[n] = int(m, 8)
def add_reg(tf, name, data, mode):
    ti = tarfile.TarInfo(name); ti.size = len(data); ti.mode = mode; ti.mtime = 0
    tf.addfile(ti, io.BytesIO(data))
with tarfile.open(out, "w:gz") as tf:
    if not empty:
        for root, _, files in sorted(os.walk(tree)):
            for f in sorted(files):
                p = os.path.join(root, f); name = os.path.relpath(p, tree).replace(os.sep, "/")
                if name in omit or any(name.startswith(o + "/") for o in omit): continue
                add_reg(tf, name, open(p, "rb").read(), modes.get(name, 0o755 if name == "deploy.sh" else 0o644))
    for e in extras:
        kind, name, arg = (e.split("|", 2) + ["", ""])[:3]
        name = name.replace("@NL@", "\n")
        ti = tarfile.TarInfo(name); ti.mtime = 0; ti.mode = modes.get(name.rstrip("/"), 0o644)
        if kind == "reg": add_reg(tf, name, arg.encode(), ti.mode); continue
        if kind == "sym": ti.type = tarfile.SYMTYPE; ti.linkname = arg
        elif kind == "hard": ti.type = tarfile.LNKTYPE; ti.linkname = arg
        elif kind == "dir": ti.type = tarfile.DIRTYPE; ti.mode = modes.get(name.rstrip("/"), 0o755)
        elif kind == "fifo": ti.type = tarfile.FIFOTYPE
        tf.addfile(ti)
EOP

# ── Dựng cây/deploy giả ──────────────────────────────────────────────────────
# make_tree <dir> <tag>: cây whitelist với nội dung "NEW <tag>".
make_tree() {
  local d="$1" tag="$2"
  mkdir -p "$d/ops/lib" "$d/scripts/post-migrate"
  local f
  for f in docker-compose.yml deploy.sh backup.sh restore.sh ops/lib/ops-common.sh ops/install-release.sh ops/check-disk.sh \
           scripts/run-migration.sh scripts/post-migrate/10-x.sh; do
    echo "$tag" > "$d/$f"
  done
  printf 'RELEASE_VERSION=%s\nGIT_COMMIT=abc1234\nBACKEND_IMAGE_ID=sha256:%064d\n' "$tag" 0 > "$d/release.env"
}
# make_deploy <dir>: thư mục deploy bản cũ + file cần bảo vệ.
make_deploy() {
  local d="$1"
  make_tree "$d" "OLD"
  printf 'RELEASE_VERSION=0.0.1\nGIT_COMMIT=old0000\n' > "$d/release.env"
  echo "OLD only" > "$d/ops/old-only.sh"
  echo "DB_PASSWORD=$SECRET" > "$d/.env"; echo "TOKEN=$SECRET" > "$d/.env.docker"
  mkdir -p "$d/backups" "$d/logs"; echo "$SECRET" > "$d/backups/a.archive"; echo "$SECRET" > "$d/logs/app.log"
  echo "ghi chú" > "$d/notes.txt"; echo "gói cũ" > "$d/release.tgz"
}
# new_case <tên>: đặt CASE, DEPLOY, PKGDIR, STATE; dựng deploy cũ; chưa dựng gói.
new_case() {
  CASE="$TMP/$1"; DEPLOY="$CASE/deploy"; PKGDIR="$CASE/pkg"; STATE="$CASE/state"
  mkdir -p "$DEPLOY" "$PKGDIR" "$STATE"
  make_deploy "$DEPLOY"
}
# build_pkg <tag> [tùy chọn mkpkg...]: gói PKGDIR/release.tgz (+ .sha256) từ cây "NEW <tag>".
build_pkg() {
  local tag="$1"; shift
  rm -rf "$PKGDIR/tree"; make_tree "$PKGDIR/tree" "$tag"
  "$PY" -I "$TMP/mkpkg.py" "$PKGDIR/tree" "$PKGDIR/release.tgz" "$@"
  ( cd "$PKGDIR" && sha256sum release.tgz > release.tgz.sha256 )
}
# Bộ cài chạy từ bản sao riêng, NGOÀI mọi thư mục deploy.
RUNNER="$TMP/runner"; mkdir -p "$RUNNER/ops/lib"
cp "$INSTALL_SH_SRC" "$RUNNER/ops/install-release.sh"; cp "$ROOT_DIR/ops/lib/ops-common.sh" "$RUNNER/ops/lib/ops-common.sh"

# run_inst [KEY=VAL ...] -- <args...>: kết quả ở OUT (stdout+stderr) và RC.
OUT=""; RC=0
run_inst() {
  local -a envs=()
  while (( $# > 0 )) && [[ "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  OUT="$(env "${envs[@]}" PATH="$STUB:$PATH" STUB_STATE="$STATE" REAL_CHMOD="$REAL_CHMOD" REAL_MV="$REAL_MV" \
         bash "$RUNNER/ops/install-release.sh" "$@" 2>&1)"; RC=$?
}
# install <extra env...>: cài PKGDIR/release.tgz vào DEPLOY.
install_pkg() { run_inst "$@" -- --dir "$DEPLOY" "$PKGDIR/release.tgz"; }

# snap <dir>: dấu vân tay toàn bộ cây (đường dẫn + sha256 file + thư mục + symlink).
snap() {
  ( cd "$1" && {
      find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum 2>/dev/null
      find . -type d | LC_ALL=C sort | sed 's/^/D /'
      find . -type l | LC_ALL=C sort | sed 's/^/L /'
    } )
}
# protected_snap <dir>: nội dung + mtime của phần PHẢI giữ nguyên (không phải whitelist).
protected_snap() {
  ( cd "$1" && for p in .env .env.docker notes.txt release.tgz backups/a.archive logs/app.log; do
      printf '%s %s %s\n' "$p" "$(sha256sum < "$p" | cut -c1-64)" "$(stat -c %Y "$p")"
    done )
}
top_names() { ( cd "$1" && LC_ALL=C ls -A | tr '\n' ' ' ); }
leftovers() { ( cd "$1" && LC_ALL=C ls -A | grep -c 'install-release' || true ); }
EXPECT_TOP=".env .env.docker backup.sh backups deploy.sh docker-compose.yml logs notes.txt ops release.env release.tgz restore.sh scripts "

# assert_new <dir> <tag>: mọi mục whitelist đã là bản <tag>.
assert_new() {
  local d="$2" tag="$3" f
  for f in docker-compose.yml deploy.sh backup.sh restore.sh ops/lib/ops-common.sh ops/check-disk.sh scripts/run-migration.sh scripts/post-migrate/10-x.sh; do
    file_has "$1 $f=$tag" "$d/$f" "$tag"
  done
  file_has "$1 release.env=$tag" "$d/release.env" "RELEASE_VERSION=$tag"
}
assert_old() {
  local d="$2" f
  for f in docker-compose.yml deploy.sh backup.sh restore.sh ops/lib/ops-common.sh ops/check-disk.sh scripts/run-migration.sh; do
    file_has "$1 $f=OLD" "$d/$f" "OLD"
  done
  file_has "$1 release.env=0.0.1" "$d/release.env" "RELEASE_VERSION=0.0.1"
  file_has "$1 ops/old-only.sh còn" "$d/ops/old-only.sh" "OLD only"
}

# ── 1) Cài đạt ───────────────────────────────────────────────────────────────
if want g1; then
echo "== 1) cài đạt: whitelist đúng, không đụng .env/backups/logs, không để lại rác, +x =="
new_case c1; build_pkg "1.2.3"
P0="$(protected_snap "$DEPLOY")"
install_pkg
expect_rc "[1] rc" 0 "$RC"
assert_new "[1]" "$DEPLOY" "1.2.3"
expect_no_file "[1] ops/old-only.sh bị thay cùng thư mục ops" "$DEPLOY/ops/old-only.sh"
expect_eq "[1] phần ngoài whitelist giữ NGUYÊN (nội dung + mtime)" "$P0" "$(protected_snap "$DEPLOY")"
expect_eq "[1] tập mục cấp 1 đúng (whitelist + file được bảo vệ)" "$EXPECT_TOP" "$(top_names "$DEPLOY")"
expect_eq "[1] không còn thư mục tạm/khóa" "0" "$(leftovers "$DEPLOY")"
expect_contains "[1] báo version/commit" "bản 1.2.3 (abc1234)" "$OUT"
expect_contains "[1] báo không động tới .env" "Không động tới .env, backups/, logs/" "$OUT"
expect_not_contains "[1] không rò bí mật" "$SECRET" "$OUT"
CHM="$(cat "$STATE/chmod.log" 2>/dev/null || true)"
expect_contains "[1] chmod +x được gọi" "+x" "$CHM"
expect_contains "[1] chmod +x trên backup.sh (git để 644)" "backup.sh" "$CHM"
expect_contains "[1] chmod +x trên restore.sh" "restore.sh" "$CHM"
expect_contains "[1] chmod +x trên ops/lib/ops-common.sh" "ops-common.sh" "$CHM"
expect_contains "[1] chmod +x trên scripts/post-migrate/*.sh" "10-x.sh" "$CHM"
expect_not_contains "[1] chmod không chạm .env" "/.env" "$CHM"
expect_not_contains "[1] chmod không chạm backups/logs" "backups" "$CHM"
if (( ! IS_WIN )); then
  for f in backup.sh restore.sh deploy.sh scripts/run-migration.sh scripts/post-migrate/10-x.sh ops/check-disk.sh ops/lib/ops-common.sh; do
    [[ -x "$DEPLOY/$f" ]] && ok || fail "[1] $f phải có bit +x sau khi cài"
  done
  [[ ! -x "$DEPLOY/docker-compose.yml" && ! -x "$DEPLOY/release.env" ]] && ok || fail "[1] file không phải .sh không được +x"
fi

# ── 2) Idempotent ────────────────────────────────────────────────────────────
echo "== 2) idempotent: chạy lần hai cùng gói cho cùng kết quả =="
S1="$(snap "$DEPLOY")"
install_pkg
expect_rc "[2] lần 2 rc" 0 "$RC"
expect_eq "[2] cây deploy y hệt sau lần 2" "$S1" "$(snap "$DEPLOY")"
expect_eq "[2] phần được bảo vệ vẫn nguyên" "$P0" "$(protected_snap "$DEPLOY")"
install_pkg
expect_rc "[2] lần 3 rc" 0 "$RC"
expect_eq "[2] cây y hệt sau lần 3" "$S1" "$(snap "$DEPLOY")"

# ── 3) Nâng cấp qua gói thứ hai, cài lần đầu ────────────────────────────────
echo "== 3) nâng cấp gói 1.2.3 -> 1.2.4 (file chỉ có ở gói cũ biến mất); cài lần đầu vào thư mục trống =="
build_pkg "1.2.4"; echo "chỉ gói 1.2.3" > "$DEPLOY/scripts/only-in-123.sh"
install_pkg
expect_rc "[3] rc" 0 "$RC"
assert_new "[3]" "$DEPLOY" "1.2.4"
expect_no_file "[3] file của gói cũ không sót" "$DEPLOY/scripts/only-in-123.sh"
expect_eq "[3] phần được bảo vệ vẫn nguyên" "$P0" "$(protected_snap "$DEPLOY")"
new_case c3b; rm -rf "$DEPLOY"; mkdir -p "$DEPLOY"; build_pkg "2.0.0"
install_pkg
expect_rc "[3b] cài lần đầu vào thư mục trống: rc" 0 "$RC"
assert_new "[3b]" "$DEPLOY" "2.0.0"
expect_eq "[3b] chỉ có 7 mục whitelist" "backup.sh deploy.sh docker-compose.yml ops release.env restore.sh scripts " "$(top_names "$DEPLOY")"
expect_eq "[3b] không còn rác" "0" "$(leftovers "$DEPLOY")"

# ── 4) Checksum ──────────────────────────────────────────────────────────────
fi

if want 4; then
echo "== 4) checksum sai/thiếu/sai định dạng: dừng, deploy giữ NGUYÊN =="
new_case c4; build_pkg "1.2.3"; B4="$(snap "$DEPLOY")"
# 4a) gói bị sửa sau khi tính checksum
cp "$PKGDIR/release.tgz" "$PKGDIR/orig.tgz"
printf 'x' >> "$PKGDIR/release.tgz"
install_pkg
expect_nonzero "[4a] gói bị sửa: rc" "$RC"; expect_contains "[4a] báo SAI checksum" "SAI checksum" "$OUT"
expect_eq "[4a] deploy y nguyên" "$B4" "$(snap "$DEPLOY")"
# 4b) thiếu file .sha256
cp "$PKGDIR/orig.tgz" "$PKGDIR/release.tgz"; mv "$PKGDIR/release.tgz.sha256" "$PKGDIR/sha.bak"
install_pkg
expect_nonzero "[4b] thiếu .sha256: rc" "$RC"; expect_contains "[4b] báo thiếu checksum" "Thiếu file checksum" "$OUT"
expect_eq "[4b] deploy y nguyên" "$B4" "$(snap "$DEPLOY")"
# 4c) .sha256 sai định dạng / hash của gói khác / rỗng
echo "not-a-hash  release.tgz" > "$PKGDIR/release.tgz.sha256"
install_pkg
expect_nonzero "[4c] sai định dạng: rc" "$RC"; expect_contains "[4c] báo sai định dạng" "không đúng định dạng" "$OUT"
printf '%064d  release.tgz\n' 0 > "$PKGDIR/release.tgz.sha256"
install_pkg
expect_nonzero "[4d] hash khác: rc" "$RC"; expect_contains "[4d] báo SAI checksum" "SAI checksum" "$OUT"
: > "$PKGDIR/release.tgz.sha256"
install_pkg
expect_nonzero "[4e] file .sha256 rỗng: rc" "$RC"
expect_eq "[4e] deploy y nguyên" "$B4" "$(snap "$DEPLOY")"
# 4f) khớp nhưng viết HOA + CRLF (file sinh trên Windows): vẫn nhận; --sha256 trỏ file ở chỗ khác
H="$(sha256sum "$PKGDIR/release.tgz" | cut -c1-64 | tr 'a-f' 'A-F')"
printf '%s  release.tgz\r\n' "$H" > "$CASE/elsewhere.sha"
run_inst -- --dir "$DEPLOY" --sha256 "$CASE/elsewhere.sha" "$PKGDIR/release.tgz"
expect_rc "[4f] checksum HOA+CRLF qua --sha256: rc" 0 "$RC"
assert_new "[4f]" "$DEPLOY" "1.2.3"

# ── 5) Gói độc hại / ngoài whitelist / thiếu ─────────────────────────────────
fi

if want 5; then
echo "== 5) gói độc hại, ngoài whitelist, thiếu mục: từ chối trước khi giải nén; deploy y nguyên, không ghi ra ngoài =="
# bad_case <nhãn> <thông-báo-mong-đợi> <tùy chọn mkpkg...>
bad_case() {
  local label="$1" msg="$2"; shift 2
  new_case "bad-$label"; build_pkg "9.9.9" "$@"
  local before; before="$(snap "$DEPLOY")"
  install_pkg
  expect_nonzero "[5 $label] rc" "$RC"
  expect_contains "[5 $label] thông báo" "$msg" "$OUT"
  expect_eq "[5 $label] deploy y nguyên" "$before" "$(snap "$DEPLOY")"
  expect_eq "[5 $label] không rác" "0" "$(leftovers "$DEPLOY")"
  expect_no_file "[5 $label] không ghi ra ngoài (evil cạnh deploy)" "$CASE/evil"
  expect_no_file "[5 $label] không ghi ra ngoài (evil trong pkg)" "$PKGDIR/evil"
  expect_not_contains "[5 $label] không rò bí mật" "$SECRET" "$OUT"
}
bad_case dotdot        "'..'"             --extra "reg|../evil|x"
bad_case dotdot-deep   "'..'"             --extra "reg|ops/../../evil|x"
bad_case dot-prefix    "'.'"              --extra "reg|./ops/zz.sh|x"
bad_case abs           "tuyệt đối"        --extra "reg|/tmp/evil-abs|x"
bad_case drive         "ổ đĩa"            --extra "reg|C:/evil|x"
bad_case double-slash  "'//'"             --extra "reg|ops//zz.sh|x"
bad_case backslash     "ký tự thoát"      --extra 'reg|ops\evil|x'
bad_case newline       "ký tự thoát"      --extra "reg|ops/a@NL@b|x"
bad_case symlink-file  "symlink"          --omit docker-compose.yml --extra "sym|docker-compose.yml|/etc/passwd"
bad_case symlink-in-ops "symlink"         --extra "sym|ops/link|/etc"
bad_case symlink-dotdot "symlink"         --extra "sym|scripts/up|../.."
bad_case hardlink      "hardlink"         --extra "hard|ops/hl|deploy.sh"
bad_case fifo          "không phải file thường" --extra "fifo|ops/pipe"
bad_case outside       "NGOÀI whitelist"  --extra "reg|extra.txt|x"
bad_case outside-env   "NGOÀI whitelist"  --extra "reg|.env|DB_PASSWORD=pwned"
bad_case outside-backups "NGOÀI whitelist" --extra "reg|backups/pwn.archive|x"
bad_case outside-logs  "NGOÀI whitelist"  --extra "reg|logs/pwn.log|x"
bad_case outside-envdocker "NGOÀI whitelist" --extra "reg|.env.docker|x"
bad_case outside-tgz   "NGOÀI whitelist"  --extra "reg|release.tgz|x"
bad_case similar-name  "NGOÀI whitelist"  --extra "reg|opsx/a.sh|x"
bad_case env-in-ops    "bí mật/dump"      --extra "reg|ops/.env|x"
bad_case env-var-in-scripts "bí mật/dump" --extra "reg|scripts/.env.production|x"
bad_case backups-in-ops "bí mật/dump"     --extra "reg|ops/backups/a.txt|x"
bad_case logs-in-scripts "bí mật/dump"    --extra "reg|scripts/logs/a.log|x"
bad_case dump-in-ops   "bí mật/dump"      --extra "reg|ops/data.dump|x"
bad_case key-in-ops    "bí mật/dump"      --extra "reg|ops/server.pem|x"
bad_case dup           "trùng tên"        --extra "reg|ops/lib/ops-common.sh|dup"
bad_case missing-file  "thiếu mục whitelist" --omit restore.sh
bad_case missing-env   "thiếu mục whitelist" --omit release.env
bad_case missing-dir   "thiếu mục whitelist" --omit scripts
bad_case file-as-dir   "phải là một file thường" --omit deploy.sh --extra "dir|deploy.sh/|"
bad_case dir-as-file   "phải là thư mục"  --omit ops --extra "reg|ops|x"
bad_case empty         "Gói rỗng"         --empty
# bit setuid/setgid/sticky (bộ cài chạy bằng root, tar giải nén sẽ giữ nguyên): từ chối từ danh sách, deploy.sh hiện có giữ nguyên
bad_case setuid-file   "setuid/setgid/sticky" --mode deploy.sh=4755
bad_case setgid-file   "setuid/setgid/sticky" --mode backup.sh=2755
bad_case setuid-nox    "setuid/setgid/sticky" --mode restore.sh=4644
bad_case sticky-file   "setuid/setgid/sticky" --mode ops/check-disk.sh=1755
bad_case sticky-nox    "setuid/setgid/sticky" --mode ops/check-disk.sh=1644
bad_case setuid-in-scripts "setuid/setgid/sticky" --mode scripts/post-migrate/10-x.sh=6755
bad_case sticky-dir    "setuid/setgid/sticky" --extra "dir|ops/sticky/|" --mode ops/sticky=1777
bad_case setgid-dir    "setuid/setgid/sticky" --extra "dir|scripts/sg/|" --mode scripts/sg=2755
# Không phải gzip / không tồn tại / tham số sai
new_case c5g; head -c 2000 /dev/urandom > "$PKGDIR/release.tgz"; ( cd "$PKGDIR" && sha256sum release.tgz > release.tgz.sha256 ); B5="$(snap "$DEPLOY")"
install_pkg
expect_nonzero "[5g] không phải gzip/tar: rc" "$RC"; expect_contains "[5g] báo không đọc được gói" "Không đọc được gói" "$OUT"
expect_eq "[5g] deploy y nguyên" "$B5" "$(snap "$DEPLOY")"
run_inst -- --dir "$DEPLOY" "$PKGDIR/not-there.tgz"
expect_nonzero "[5h] gói không tồn tại: rc" "$RC"; expect_contains "[5h] báo không thấy gói" "Không thấy gói" "$OUT"
run_inst -- --dir "$DEPLOY"
expect_nonzero "[5i] thiếu gói: rc" "$RC"; expect_contains "[5i] báo thiếu gói" "Thiếu đường dẫn gói" "$OUT"
run_inst -- --dir "$DEPLOY" --bogus "$PKGDIR/release.tgz"
expect_nonzero "[5j] cờ lạ: rc" "$RC"; expect_contains "[5j] báo tham số" "Tham số không hợp lệ" "$OUT"
run_inst -- --dir "$DEPLOY" "$PKGDIR/release.tgz" "$PKGDIR/release.tgz"
expect_nonzero "[5k] hai gói: rc" "$RC"
run_inst -- --dir "$CASE/khong-co" "$PKGDIR/release.tgz"
expect_nonzero "[5l] thư mục deploy không có: rc" "$RC"; expect_contains "[5l] báo thư mục" "Thư mục deploy không tồn tại" "$OUT"
expect_eq "[5m] có chốt chặn --dir / (kiểm tĩnh, không chạy thật)" "1" "$(grep -c 'Từ chối cài vào thư mục gốc' "$INSTALL_SH_SRC")"
run_inst -- --help
expect_rc "[5n] --help" 0 "$RC"; expect_contains "[5n] --help in cách dùng" "Cách dùng" "$OUT"
expect_eq "[5] sau toàn bộ ca xấu, deploy của c5g vẫn nguyên" "$B5" "$(snap "$DEPLOY")"

# ── 6) Lỗi giữa lúc hoán đổi: tự hoàn tác ────────────────────────────────────
fi

if want 6; then
echo "== 6) lỗi giữa lúc hoán đổi (mục đầu/giữa/cuối): hoàn tác về đúng bản cũ =="
for m in ops backup.sh release.env; do
  new_case "mid-$m"; build_pkg "3.0.0"; B6="$(snap "$DEPLOY")"; P6="$(protected_snap "$DEPLOY")"
  install_pkg "STUB_MV_MATCH=*/new/$m"
  expect_nonzero "[6 $m] rc" "$RC"
  expect_contains "[6 $m] báo hoàn tác" "Đã hoàn tác" "$OUT"
  expect_file "[6 $m] mv giả thật sự đã chặn" "$STATE/mv.log"
  expect_eq "[6 $m] deploy y hệt trước khi cài (không nửa mới nửa cũ)" "$B6" "$(snap "$DEPLOY")"
  expect_eq "[6 $m] phần bảo vệ nguyên" "$P6" "$(protected_snap "$DEPLOY")"
  expect_eq "[6 $m] không rác/khóa" "0" "$(leftovers "$DEPLOY")"
  # sau lỗi thì chạy lại (không stub) vẫn cài được
  install_pkg
  expect_rc "[6 $m] chạy lại sau lỗi: rc" 0 "$RC"
  assert_new "[6 $m] sau chạy lại" "$DEPLOY" "3.0.0"
done
# lần đầu (mục chưa có trong deploy): lỗi ở mục thứ ba thì mục đã cài trước đó phải bị gỡ
new_case c6f; rm -rf "$DEPLOY"; mkdir -p "$DEPLOY"; build_pkg "3.0.0"
install_pkg "STUB_MV_MATCH=*/new/backup.sh"
expect_nonzero "[6f] rc" "$RC"
expect_eq "[6f] thư mục trống vẫn trống sau hoàn tác" "" "$(top_names "$DEPLOY")"

# ── 7) kill -9 giữa lúc hoán đổi: lần sau tự hoàn tác ────────────────────────
fi

if want 7; then
echo "== 7) tiến trình bị kill -9 giữa lúc hoán đổi: lần chạy sau tự hoàn tác, thu hồi khóa chết =="
new_case c7; build_pkg "4.0.0"; B7="$(snap "$DEPLOY")"
install_pkg "STUB_MV_MATCH=*/new/backup.sh" "STUB_MV_MODE=kill"
expect_nonzero "[7] bị kill: rc" "$RC"
expect_file "[7] mv giả đã kill" "$STATE/mv.log"
file_has "[7] trạng thái dở dang: ops đã là bản mới" "$DEPLOY/ops/lib/ops-common.sh" "4.0.0"
expect_no_file "[7] trạng thái dở dang: backup.sh đang KHÔNG có (đã dời, chưa đặt bản mới)" "$DEPLOY/backup.sh"
expect_eq "[7] còn thư mục tạm kèm state=swapping" "swapping" "$(cat "$DEPLOY"/.install-release.tmp.*/state 2>/dev/null | head -n 1)"
# lần chạy sau với gói HỎNG (sai checksum): vẫn phải hoàn tác trước, rồi dừng; deploy về đúng bản cũ
cp "$PKGDIR/release.tgz" "$PKGDIR/good.tgz"; printf 'x' >> "$PKGDIR/release.tgz"
install_pkg
expect_nonzero "[7b] gói hỏng: rc" "$RC"
expect_contains "[7b] báo thu hồi khóa chết" "Thu hồi khóa" "$OUT"
expect_contains "[7b] báo hoàn tác lần dở dang" "hoàn tác về bản cũ trước khi cài" "$OUT"
expect_eq "[7b] deploy về ĐÚNG bản trước khi cài" "$B7" "$(snap "$DEPLOY")"
# kill lần nữa (gói tốt) rồi chạy lại: cài thành công
cp "$PKGDIR/good.tgz" "$PKGDIR/release.tgz"
install_pkg "STUB_MV_MATCH=*/new/restore.sh" "STUB_MV_MODE=kill"
expect_nonzero "[7c] kill lần hai: rc" "$RC"
install_pkg
expect_rc "[7c] chạy lại gói tốt sau kill: rc" 0 "$RC"
assert_new "[7c]" "$DEPLOY" "4.0.0"
expect_eq "[7c] không rác" "0" "$(leftovers "$DEPLOY")"

# ── 8) Khóa chống chạy chồng ─────────────────────────────────────────────────
fi

if want 8; then
echo "== 8) khóa: tiến trình khác đang cài thì từ chối, không xóa khóa của họ =="
new_case c8; build_pkg "5.0.0"; B8="$(snap "$DEPLOY")"
sleep 30 & SLP=$!
mkdir -p "$DEPLOY/.install-release.lock.d"; echo "$SLP" > "$DEPLOY/.install-release.lock.d/pid"
B8L="$(snap "$DEPLOY")"
install_pkg
expect_nonzero "[8] rc" "$RC"; expect_contains "[8] báo đang có lần cài khác" "Đang có lần cài khác" "$OUT"
expect_eq "[8] deploy + khóa của người khác y nguyên" "$B8L" "$(snap "$DEPLOY")"
kill "$SLP" 2>/dev/null; wait "$SLP" 2>/dev/null
install_pkg
expect_rc "[8b] pid giữ khóa đã chết -> thu hồi và cài: rc" 0 "$RC"
assert_new "[8b]" "$DEPLOY" "5.0.0"
expect_eq "[8b] không rác" "0" "$(leftovers "$DEPLOY")"
: "$B8"

# ── 9) Thay chính mình / mục deploy là symlink / đổi kiểu ────────────────────
fi

if want 9; then
echo "== 9) chạy từ <deploy>/ops (tự thay mình, chỉ Linux); mục deploy là symlink; file<->thư mục =="
if (( IS_WIN )); then
  echo "   (bỏ qua 9a trên Windows: không đổi tên được thư mục chứa script đang chạy)"
else
  new_case c9a; build_pkg "6.0.0"
  cp "$INSTALL_SH_SRC" "$DEPLOY/ops/install-release.sh"; cp "$ROOT_DIR/ops/lib/ops-common.sh" "$DEPLOY/ops/lib/ops-common.sh"
  OUT="$(env PATH="$STUB:$PATH" STUB_STATE="$STATE" REAL_CHMOD="$REAL_CHMOD" REAL_MV="$REAL_MV" bash "$DEPLOY/ops/install-release.sh" "$PKGDIR/release.tgz" 2>&1)"; RC=$?
  expect_rc "[9a] chạy từ <deploy>/ops, không --dir: rc" 0 "$RC"
  assert_new "[9a]" "$DEPLOY" "6.0.0"
  expect_contains "[9a] mặc định là thư mục cha của ops/" "vào $DEPLOY" "$OUT"
fi
# 9b) deploy/ops là symlink tới thư mục khác: thay chính symlink, KHÔNG ghi xuyên vào đích
new_case c9b; build_pkg "6.1.0"; mkdir -p "$CASE/target-ops"; echo "đích" > "$CASE/target-ops/keep.txt"
rm -rf "$DEPLOY/ops"; ln -s "$CASE/target-ops" "$DEPLOY/ops" 2>/dev/null
if [[ -L "$DEPLOY/ops" ]]; then
  install_pkg
  expect_rc "[9b] rc" 0 "$RC"
  expect_eq "[9b] thư mục đích của symlink cũ không bị đụng" "đích" "$(cat "$CASE/target-ops/keep.txt")"
  expect_eq "[9b] đích không nhận file mới" "keep.txt " "$(top_names "$CASE/target-ops")"
  [[ ! -L "$DEPLOY/ops" && -d "$DEPLOY/ops" ]] && ok || fail "[9b] ops phải thành thư mục thật"
  assert_new "[9b]" "$DEPLOY" "6.1.0"
else
  echo "   (bỏ qua 9b: môi trường không tạo được symlink)"
fi
# 9c) scripts đang là FILE, docker-compose.yml đang là THƯ MỤC
new_case c9c; build_pkg "6.2.0"; rm -rf "$DEPLOY/scripts" "$DEPLOY/docker-compose.yml"; echo "file" > "$DEPLOY/scripts"; mkdir -p "$DEPLOY/docker-compose.yml"; echo x > "$DEPLOY/docker-compose.yml/z"
install_pkg
expect_rc "[9c] đổi kiểu: rc" 0 "$RC"
assert_new "[9c]" "$DEPLOY" "6.2.0"
[[ -f "$DEPLOY/docker-compose.yml" && -d "$DEPLOY/scripts" ]] && ok || fail "[9c] kiểu mục phải theo gói"

# ── 10) Gói dựng bằng GNU tar giống release.sh + gói từ file git thật ─────────
fi

if want 10; then
echo "== 10) gói dựng bằng GNU tar (giống release.sh) và gói dựng từ file git thật của repo =="
new_case c10; make_tree "$CASE/gtree" "7.0.0"; chmod +x "$CASE/gtree/deploy.sh" 2>/dev/null
( cd "$CASE/gtree" && find docker-compose.yml deploy.sh backup.sh restore.sh ops scripts release.env -type f -print0 \
    | tar --no-recursion --null --owner=0 --group=0 --numeric-owner --mode=644 -T - -czf "$PKGDIR/release.tgz" )
( cd "$PKGDIR" && sha256sum release.tgz > release.tgz.sha256 )
install_pkg
expect_rc "[10a] gói GNU tar: rc" 0 "$RC"
assert_new "[10a]" "$DEPLOY" "7.0.0"
if git -C "$ROOT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  new_case c10r; mkdir -p "$CASE/rtree"
  ( cd "$ROOT_DIR" && for item in docker-compose.yml deploy.sh backup.sh restore.sh ops scripts; do git ls-files -z -- "$item"; done \
      | while IFS= read -r -d '' p; do [[ -f "$p" ]] && printf '%s\0' "$p"; done | tar --null -T - -cf - ) | tar -xf - -C "$CASE/rtree"
  printf 'RELEASE_VERSION=9.9.9\nGIT_COMMIT=realrep\n' > "$CASE/rtree/release.env"
  ( cd "$CASE/rtree" && find docker-compose.yml deploy.sh backup.sh restore.sh ops scripts release.env -type f -print0 \
      | tar --no-recursion --null --owner=0 --group=0 --numeric-owner --mode=644 -T - -czf "$PKGDIR/release.tgz" )
  ( cd "$PKGDIR" && sha256sum release.tgz > release.tgz.sha256 )
  install_pkg
  expect_rc "[10b] gói từ file git thật: rc" 0 "$RC"
  expect_contains "[10b] báo version" "bản 9.9.9 (realrep)" "$OUT"
  expect_eq "[10b] ops/lib/ops-common.sh đã cài giống bản thật" "$(sha256sum < "$ROOT_DIR/ops/lib/ops-common.sh" | cut -c1-64)" "$(sha256sum < "$DEPLOY/ops/lib/ops-common.sh" | cut -c1-64)"
  expect_eq "[10b] số file ops/ + scripts/ khớp cây nguồn" "$(cd "$CASE/rtree" && find ops scripts -type f | wc -l | tr -d ' ')" "$(cd "$DEPLOY" && find ops scripts -type f | wc -l | tr -d ' ')"
else
  echo "   (bỏ qua 10b: không phải git repo)"
fi

# ── 11) Canh lệch whitelist với release.sh, kiểm tĩnh ────────────────────────
fi

if want 11; then
echo "== 11) whitelist khớp release.sh; kiểm tĩnh =="
REL_WL="$(sed -n 's/^readonly WHITELIST=(\(.*\))$/\1/p' "$ROOT_DIR/release.sh" | tr ' ' '\n' | grep -v '^$')"
INS_WL="$(sed -n 's/^readonly WL_DIRS=(\(.*\))$/\1/p;s/^readonly WL_FILES=(\(.*\))$/\1/p' "$INSTALL_SH_SRC" | tr ' ' '\n' | grep -v '^$')"
if [[ -n "$REL_WL" ]]; then
  expect_eq "[11] whitelist install-release = WHITELIST của release.sh + release.env" \
    "$(printf '%s\nrelease.env\n' "$REL_WL" | LC_ALL=C sort | tr '\n' ' ')" "$(printf '%s\n' "$INS_WL" | LC_ALL=C sort | tr '\n' ' ')"
else
  fail "[11] không đọc được WHITELIST từ release.sh"
fi
expect_eq "[11] PROTECTED là .env backups logs" "(.env backups logs)" "$(sed -n 's/^readonly PROTECTED=\(.*\)$/\1/p' "$INSTALL_SH_SRC")"
for p in .env backups logs; do
  case " $(printf '%s ' $INS_WL) " in *" $p "*) fail "[11] whitelist chứa mục bảo vệ $p" ;; *) ok ;; esac
done
if bash -n "$INSTALL_SH_SRC" 2>/dev/null; then ok; else fail "[11] bash -n lỗi cú pháp"; fi
expect_eq "[11] LF-only (không CR)" "0" "$(tr -cd '\r' < "$INSTALL_SH_SRC" | wc -c | tr -d ' ')"
expect_eq "[11] set -euo pipefail" "1" "$(grep -c '^set -euo pipefail$' "$INSTALL_SH_SRC")"
expect_eq "[11] không có cách bỏ kiểm checksum (không cờ skip/no-verify)" "0" "$(grep -ciE -- '--(skip|no)-?(verify|check|sha)' "$INSTALL_SH_SRC")"
OUT="$(cd "$TMP" && env -i PATH="$PATH" HOME="${HOME:-/}" bash "$RUNNER/ops/install-release.sh" --help 2>&1)"; RC=$?
expect_rc "[11] --help chạy từ cwd khác" 0 "$RC"
fi

if want 12; then
echo "== 12) TOCTOU: checksum kiểm trên BẢN SAO trong thư mục tạm; gói gốc bị đổi giữa chừng không được cài =="
# sha256sum giả (đầu PATH): lần gọi đầu tiên ghi đè gói gốc bằng gói khác (STUB_SWAP_SRC -> STUB_SWAP_DST), TRƯỚC hoặc SAU lần băm thật.
REAL_SHA="$(type -P sha256sum)"
cat > "$STUB/sha256sum" <<'EOS'
#!/usr/bin/env bash
swap() { if [[ -n "${STUB_SWAP_SRC:-}" && ! -e "${STUB_STATE:?}/swapped" ]]; then cp -f -- "$STUB_SWAP_SRC" "$STUB_SWAP_DST"; : > "$STUB_STATE/swapped"; fi; }
[[ "${STUB_SWAP_WHEN:-after}" == "before" ]] && swap
out="$("${REAL_SHA:?}" "$@")"; rc=$?
[[ "${STUB_SWAP_WHEN:-after}" == "after" ]] && swap
printf '%s\n' "$out"; exit "$rc"
EOS
chmod +x "$STUB/sha256sum"
# toctou_case <nhãn> <before|after>: gói tốt (1.0.0) có .sha256 đúng; gói thay thế (EVIL) cũng hợp lệ về cấu trúc nhưng KHÁC nội dung/hash.
toctou_case() {
  local label="$1" when="$2" evil_tgz
  new_case "c12-$label"; build_pkg "1.0.0"
  evil_tgz="$CASE/evil.tgz"; rm -rf "$CASE/evil-tree"; make_tree "$CASE/evil-tree" "EVIL"
  "$PY" -I "$TMP/mkpkg.py" "$CASE/evil-tree" "$evil_tgz"
  [[ "$(sha256sum < "$evil_tgz" | cut -c1-64)" != "$(sha256sum < "$PKGDIR/release.tgz" | cut -c1-64)" ]] && ok || fail "[12 $label] gói thay thế phải khác gói gốc"
  install_pkg REAL_SHA="$REAL_SHA" STUB_SWAP_SRC="$evil_tgz" STUB_SWAP_DST="$PKGDIR/release.tgz" STUB_SWAP_WHEN="$when"
  expect_file "[12 $label] stub đã ghi đè gói gốc" "$STATE/swapped"
  expect_not_contains "[12 $label] không rò bí mật" "$SECRET" "$OUT"
  # chấp nhận đúng hai kết quả an toàn: cài đúng bản đã kiểm (1.0.0) hoặc từ chối và giữ nguyên bản cũ; tuyệt đối không cài EVIL.
  if [[ "$RC" == "0" ]]; then
    assert_new "[12 $label] cài đúng bản đã kiểm" "$DEPLOY" "1.0.0"
    file_has "[12 $label] release.env là 1.0.0" "$DEPLOY/release.env" "RELEASE_VERSION=1.0.0"
  else
    assert_old "[12 $label] bị từ chối thì deploy giữ nguyên" "$DEPLOY"
  fi
  expect_eq "[12 $label] không có file EVIL nào trong deploy" "0" "$( (grep -rl EVIL "$DEPLOY" 2>/dev/null || true) | wc -l | tr -d ' ')"
  expect_eq "[12 $label] không rác" "0" "$(leftovers "$DEPLOY")"
}
# ghi đè TRƯỚC lần băm: nếu hash tính trên gói gốc (không phải bản sao) thì gói EVIL sẽ trượt checksum -> ca này (đòi cài bản đã kiểm) hỏng.
toctou_case before-hash before
[[ "$RC" == "0" ]] && ok || fail "[12 before-hash] checksum trên bản sao: phải cài được gói đã kiểm (rc=$RC)"
# ghi đè SAU lần băm: nếu giải nén từ gói gốc (không phải bản sao đã kiểm) thì EVIL được cài -> ca này hỏng.
toctou_case after-hash after
[[ "$RC" == "0" ]] && ok || fail "[12 after-hash] phải cài được bản sao đã kiểm (rc=$RC)"
rm -f "$STUB/sha256sum"
fi

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
