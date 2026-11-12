#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# scripts/tests/backup.test.sh — test shell KHÔNG cần Docker/Mongo thật cho scripts/backup.sh:
#   - CHẠY script THẬT (bash scripts/backup.sh ...) trong repo git TẠM, với `docker`/`flock`/`date` giả đặt ĐẦU PATH (docker thật KHÔNG bao giờ được gọi)
#   - mặc định đủ bộ (archive + bundle + tag + manifest + thẻ image), --db-only (không manifest/bundle/tag), --code-only, --no-image
#   - DB trống (bỏ qua DB, vẫn backup code; --db-only thì lỗi), DB dở dang, Mongo tắt, dump hỏng, verify hỏng (dọn sạch)
#   - kiểm tiền điều kiện phía code TRƯỚC khi dump: tên nhánh lạ (feat#1), bundle/tag/manifest/archive trùng (file cũ không bị xóa)
#   - tham số sai (rc 2), HEAD detached, SIGTERM/SIGHUP (143/129, dọn file/tag/thẻ image), stderr chết, khóa chung (flock), mật khẩu root không lộ
#   - manifest do backup.sh sinh ra qua được restore.sh --list/--latest (dry-run); đối chứng đột biến (đổi thứ tự kiểm-trước-dump; bỏ dọn tag)
# Chỉ kiểm lớp shell (thứ tự, mã thoát, đối số, dọn dẹp). Chạy với Mongo/Docker thật là việc diễn tập staging.
# Cần: bash >= 4, git (có `git bundle`), gzip, timeout.
#
# Chạy:  bash scripts/tests/backup.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ──────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034,SC2016  # biến dùng gián tiếp; nháy đơn có chủ ý (stub nhận lệnh chứa $ chưa mở rộng)
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
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: không thấy [$2] trong [$3]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: không được có [$2] trong [$3]"; fi; }
expect_rc() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mã thoát mong đợi $2, nhận $3"; fi; }
expect_nonzero() { if [[ "$2" != "0" ]]; then ok; else fail "$1: mong đợi mã thoát khác 0"; fi; }
expect_file() { if [[ -f "$2" ]]; then ok; else fail "$1: thiếu file $2"; fi; }
expect_nofile() { if [[ ! -e "$2" ]]; then ok; else fail "$1: không được có $2"; fi; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.test
export GIT_CONFIG_GLOBAL="$TMP/gitconfig-global" GIT_CONFIG_NOSYSTEM=1
printf '[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n' > "$GIT_CONFIG_GLOBAL"

SECRET="S3cr3t-Pass-XYZ-12345"
STUB="$TMP/stub"
CALLS="$TMP/calls.log"
mkdir -p "$STUB"
TS="20260101-120000"
IMG="sha256:0123456789abcdef"

# ── Stub: docker, flock, date (đặt ĐẦU PATH) ──────────────────────────────────────────────────────────────────────────
# STUB_CALLS ghi mọi lệnh docker (một dòng/lệnh). Điều khiển bằng biến môi trường: STUB_MONGO_STATE, STUB_NO_ROOT(1: mongo cấu hình cũ),
# STUB_USERS_EXIST, STUB_NONEMPTY, STUB_DRYRUN_USERS(1/0), STUB_DUMP_RC, STUB_SYSTEM_VERSION, STUB_BACKEND_PRESENT(1/0), STUB_FAIL_TAG,
# STUB_FLOCK_RC (khóa bị giữ), STUB_SIGNAL_ON='<chuỗi lệnh>=<TÍN HIỆU>' (gửi tín hiệu cho TIẾN TRÌNH backup.sh qua $PPID: chỉ dùng cho lệnh docker
# gọi TRỰC TIẾP từ backup.sh, vd `docker tag`).
cat > "$STUB/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_CALLS"
if [[ -n "${STUB_SIGNAL_ON:-}" && " $* " == *"${STUB_SIGNAL_ON%%=*}"* && ! -e "$STUB_CALLS.sig" ]]; then
  : > "$STUB_CALLS.sig"; kill "-${STUB_SIGNAL_ON##*=}" "$PPID"
fi
case "${1:-}" in
  info) [[ "$*" == *DockerRootDir* ]] && echo "/"; exit 0 ;;
  inspect)
    case "$*" in
      *State.Status*) echo "${STUB_MONGO_STATE:-running}" ;;
      *"{{.Image}}"*) [[ "${STUB_BACKEND_PRESENT:-1}" == "1" ]] && echo "sha256:0123456789abcdef" || exit 1 ;;
      *compose.project*) echo "${STUB_PROJECT:-realestatemanager}" ;;
      *) echo "" ;;
    esac
    exit 0 ;;
  tag) [[ "${STUB_FAIL_TAG:-0}" == "1" ]] && exit 1; exit 0 ;;
  rmi) exit 0 ;;
  exec)
    shift
    [[ "${1:-}" == "-i" ]] && shift
    shift   # tên container
    if [[ "${1:-}" == "mongosh" ]]; then
      script="$(cat)"
      case "$script" in
        *COLL_EXISTS*)    echo "COLL_EXISTS:users=${STUB_USERS_EXIST:-1}" ;;
        *SYSTEM_VERSION*) echo "SYSTEM_VERSION=${STUB_SYSTEM_VERSION-010}" ;;
        *NONEMPTY_COLLS*) echo "NONEMPTY_COLLS=${STUB_NONEMPTY-users}" ;;
      esac
      exit 0
    fi
    if [[ "${1:-}" == "sh" ]]; then [[ "${STUB_NO_ROOT:-0}" == "1" ]] && exit 1; exit 0; fi
    cmd="${3:-}"   # bash -c <lệnh>
    case "$cmd" in
      *--dryRun*)  cat > /dev/null; [[ "${STUB_DRYRUN_USERS:-1}" == "1" ]] && echo 'archive prelude `realestate.users`'; exit 0 ;;
      *mongodump*) printf 'dump' | gzip; exit "${STUB_DUMP_RC:-0}" ;;
    esac ;;
esac
exit 0
EOS
# flock giả: ghi lại lời gọi, STUB_FLOCK_RC=1 giả lập "khóa đang bị giữ"; (Git Bash/Windows không có flock thật).
printf '#!/usr/bin/env bash\necho "flock $*" >> "$STUB_CALLS.flock"\nexit "${STUB_FLOCK_RC:-0}"\n' > "$STUB/flock"
# date giả: đóng băng mã thời gian TS (để dựng trước file/tag trùng); mọi dạng gọi khác chuyển cho date thật.
cat > "$STUB/date" <<'EOS'
#!/usr/bin/env bash
if [[ "$*" == "+%Y%m%d-%H%M%S" ]]; then echo "20260101-120000"; exit 0; fi
exec /usr/bin/date "$@"
EOS
# stat giả (chỉ cho script chạy trong stub): file_mode luôn báo 600 vì Windows không giữ được chmod; dạng gọi khác chuyển cho stat thật.
cat > "$STUB/stat" <<'EOS'
#!/usr/bin/env bash
if [[ "$1" == "-c" && "$2" == "%a" ]]; then echo 600; exit 0; fi
exec /usr/bin/stat "$@"
EOS
# git giả: chỉ chen vào `git bundle create`/`git bundle verify` khi STUB_GIT_BUNDLE_CREATE_FAIL / STUB_GIT_BUNDLE_VERIFY_FAIL=1; mọi lệnh khác chạy git thật.
REAL_GIT="$(command -v git)"; REAL_INSTALL="$(command -v install)"; REAL_CHMOD="$(command -v chmod)"
cat > "$STUB/git" <<EOS
#!/usr/bin/env bash
if [[ "\${1:-}" == "bundle" && "\${2:-}" == "create" && "\${STUB_GIT_BUNDLE_CREATE_FAIL:-0}" == "1" ]]; then echo "git bundle create (giả lập lỗi)" >&2; exit 1; fi
if [[ "\${1:-}" == "bundle" && "\${2:-}" == "verify" && "\${STUB_GIT_BUNDLE_VERIFY_FAIL:-0}" == "1" ]]; then echo "git bundle verify (giả lập lỗi)" >&2; exit 1; fi
exec "$REAL_GIT" "\$@"
EOS
# install/chmod giả: STUB_INSTALL_FAIL=1 làm `install` luôn lỗi (như Git Bash/NTFS); STUB_CHMOD700_FAIL=1 làm `chmod 700 ...` lỗi (chmod khác chạy thật).
cat > "$STUB/install" <<EOS
#!/usr/bin/env bash
if [[ "\${STUB_INSTALL_FAIL:-0}" == "1" ]]; then echo "install: giả lập lỗi" >&2; exit 1; fi
exec "$REAL_INSTALL" "\$@"
EOS
cat > "$STUB/chmod" <<EOS
#!/usr/bin/env bash
if [[ "\${STUB_CHMOD700_FAIL:-0}" == "1" && "\${1:-}" == "700" ]]; then exit 1; fi
exec "$REAL_CHMOD" "\$@"
EOS
chmod +x "$STUB/docker" "$STUB/flock" "$STUB/date" "$STUB/stat" "$STUB/git" "$STUB/install" "$STUB/chmod"

# ── Dựng repo "máy chủ" giả mỗi ca (chưa có thư mục backups/: backup.sh tự tạo) ───────────────────────────────────────
N=0; W=""
mk() {
  N=$((N + 1))
  W="$TMP/w$N"
  mkdir -p "$W/scripts/lib" "$W/RealEstateBackendApp"
  cp "$ROOT_DIR/scripts/backup.sh" "$W/scripts/backup.sh"
  cp "$ROOT_DIR/scripts/restore.sh" "$W/scripts/restore.sh"
  cp "$ROOT_DIR/scripts/lib/ops-common.sh" "$W/scripts/lib/ops-common.sh"
  printf 'services: {}\n' > "$W/docker-compose.yml"
  printf 'MONGO_INITDB_ROOT_USERNAME=root\n' > "$W/.env.docker"
  : > "$W/.env"
  printf '.env\n.env.docker\nbackups/\n' > "$W/.gitignore"
  printf '{\n  "name": "backend",\n  "version": "2.3.4"\n}\n' > "$W/RealEstateBackendApp/package.json"
  (
    cd "$W" || exit 1
    git init -q && git symbolic-ref HEAD refs/heads/release-x
    git add -A && git commit -qm "C1"
  ) || { echo "Không dựng được repo tạm" >&2; exit 2; }
  HEAD_SHA="$(git -C "$W" rev-parse HEAD)"
}
EXTRA_ENV=()
# Chạy backup.sh THẬT trong repo tạm; OUT = stdout+stderr, RC = mã thoát; CALLS = các lệnh docker giả đã gọi.
run_b() {
  : > "$CALLS"; rm -f "$CALLS.sig" "$CALLS.flock"
  OUT="$(cd "$W" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" BACKUP_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" \
    "${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}" bash "$W/scripts/backup.sh" "$@" 2>&1)"
  RC=$?
}
# Như run_b nhưng MỌI ghi ra stderr đều thất bại (/dev/full, giống SSH rớt giữa chừng); chỉ stdout được thu.
run_b_dead() {
  : > "$CALLS"; rm -f "$CALLS.sig" "$CALLS.flock"
  OUT="$(cd "$W" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" BACKUP_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" \
    "${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}" bash "$W/scripts/backup.sh" "$@" 2>/dev/full)"
  RC=$?
}
calls() { cat "$CALLS"; }
files() { ( cd "$W" && { [[ -d backups ]] && find backups -type f | sort; true; } | tr '\n' ' ' ); }
tags() { git -C "$W" tag | tr '\n' ' '; }
ARCH() { printf '%s/backups/deploy-pre-%s.archive.gz' "$W" "$TS"; }
BUND() { printf '%s/backups/deploy-code-pre-%s.bundle' "$W" "$TS"; }
MANI() { printf '%s/backups/deploy-pre-%s.manifest' "$W" "$TS"; }
mval() { sed -n "s/^$1=//p" "$(MANI)" | head -n 1; }
n_calls() { grep -c -- "$1" "$CALLS" || true; }

# Quyền file chỉ kiểm được khi hệ file giữ chmod (Linux có; NTFS/Git Bash thì không).
touch "$TMP/permprobe"; chmod 600 "$TMP/permprobe"
PERM_OK=0; [[ "$(stat -c %a "$TMP/permprobe" 2>/dev/null)" == "600" ]] && PERM_OK=1

# ═════════════════════════════════════════════════════════════════════════════
echo "== 1) Mặc định: đủ bộ archive + bundle + tag + manifest + thẻ image =="
mk; run_b
expect_rc "backup mặc định" 0 "$RC"
expect_file "archive" "$(ARCH)"; expect_file "bundle" "$(BUND)"; expect_file "manifest" "$(MANI)"
expect_eq "archive là gzip hợp lệ" "0" "$(gzip -t "$(ARCH)" 2>/dev/null; echo $?)"
expect_eq "bundle qua git bundle verify" "0" "$(git -C "$W" bundle verify "$(BUND)" >/dev/null 2>&1; echo $?)"
expect_contains "tag cục bộ pre-deploy-<TS>" "pre-deploy-$TS" "$(tags)"
expect_eq "tag trỏ đúng HEAD" "$HEAD_SHA" "$(git -C "$W" rev-parse "pre-deploy-$TS^{commit}")"
expect_contains "gắn thẻ image backend" "docker tag $IMG realestatemanager-backend:pre-$TS" "$(calls)"
expect_eq "không file rác (.partial/.tmp)" "" "$(find "$W/backups" -name '*.partial' -o -name '*.tmp' | tr '\n' ' ')"
expect_eq "manifest: BACKUP_KIND" "manual" "$(mval BACKUP_KIND)"
expect_eq "manifest: BRANCH" "release-x" "$(mval BRANCH)"
expect_eq "manifest: DETACHED" "0" "$(mval DETACHED)"
expect_eq "manifest: OLD_COMMIT" "$HEAD_SHA" "$(mval OLD_COMMIT)"
expect_eq "manifest: NEW_COMMIT = OLD_COMMIT" "$HEAD_SHA" "$(mval NEW_COMMIT)"
expect_eq "manifest: MONGO_BACKUP_FILE" "backups/deploy-pre-$TS.archive.gz" "$(mval MONGO_BACKUP_FILE)"
expect_eq "manifest: CODE_BUNDLE" "backups/deploy-code-pre-$TS.bundle" "$(mval CODE_BUNDLE)"
expect_eq "manifest: CODE_TAG" "pre-deploy-$TS" "$(mval CODE_TAG)"
expect_eq "manifest: PREV_IMAGE_TAG" "realestatemanager-backend:pre-$TS" "$(mval PREV_IMAGE_TAG)"
expect_eq "manifest: APP_VERSION" "2.3.4" "$(mval APP_VERSION_OLD)"
expect_eq "manifest: DB_VERSION_BEFORE" "010" "$(mval DB_VERSION_BEFORE)"
expect_eq "manifest: DB_VERSION_READ" "1" "$(mval DB_VERSION_READ)"
expect_eq "manifest: STACK_TOUCHED=1 (restore không gợi ý bỏ qua DB)" "1" "$(mval STACK_TOUCHED)"
expect_eq "manifest: POST_UP_REACHED=0" "0" "$(mval POST_UP_REACHED)"
expect_eq "manifest: DEPLOY_STATUS" "succeeded" "$(mval DEPLOY_STATUS)"
expect_eq "manifest: NO_PULL" "1" "$(mval NO_PULL)"
expect_eq "manifest: TRACKED_DIRTY" "0" "$(mval TRACKED_DIRTY)"
expect_eq "khóa chung: có gọi flock -n 9" "1" "$(grep -c 'flock -n 9' "$CALLS.flock")"
[[ -f "$W/.git/realestate-deploy.lock" ]] && ok || fail "khóa chung: file .git/realestate-deploy.lock (cùng khóa với deploy.sh/restore.sh)"
expect_not_contains "mật khẩu root không có trong lệnh docker" "$SECRET" "$(calls)"
expect_not_contains "mật khẩu root không có trong đầu ra" "$SECRET" "$OUT"
expect_not_contains "mật khẩu root không có trong manifest" "$SECRET" "$(cat "$(MANI)")"
expect_eq "mongodump chạy đúng 1 lần" "1" "$(n_calls 'mongodump')"
expect_not_contains "không đụng stack (không up/stop/down/build)" " up " "$(calls)"
expect_not_contains "không dừng container" " stop " "$(calls)"
if (( PERM_OK == 1 )); then
  expect_eq "quyền archive 600" "600" "$(stat -c %a "$(ARCH)")"; expect_eq "quyền bundle 600" "600" "$(stat -c %a "$(BUND)")"
  expect_eq "quyền manifest 600" "600" "$(stat -c %a "$(MANI)")"; expect_eq "quyền thư mục backups 700" "700" "$(stat -c %a "$W/backups")"
fi

echo "== 2) Manifest do backup.sh sinh ra qua được restore.sh --list / --latest (dry-run) =="
RUN_R() { : > "$CALLS"; OUT2="$(cd "$W" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" bash "$W/scripts/restore.sh" "$@" 2>&1)"; RC2=$?; }
RUN_R --list
expect_rc "restore.sh --list" 0 "$RC2"; expect_contains "--list thấy manifest" "deploy-pre-$TS.manifest" "$OUT2"
expect_contains "--list hiện loại backup thủ công" "manual" "$OUT2"
expect_not_contains "--list không hiện MANIFEST HỎNG" "MANIFEST HỎNG" "$OUT2"
RUN_R --latest
expect_rc "restore.sh --latest (dry-run)" 0 "$RC2"; expect_not_contains "dry-run không có [HỎNG]" "[HỎNG]" "$OUT2"
expect_contains "dry-run dùng đúng manifest vừa tạo" "deploy-pre-$TS.manifest" "$OUT2"

echo "== 3) --db-only: chỉ archive, KHÔNG manifest/bundle/tag/thẻ image =="
mk; run_b --db-only
expect_rc "--db-only" 0 "$RC"; expect_file "--db-only: archive" "$(ARCH)"
expect_nofile "--db-only: không manifest" "$(MANI)"; expect_nofile "--db-only: không bundle" "$(BUND)"
expect_eq "--db-only: không tag" "" "$(tags)"; expect_not_contains "--db-only: không docker tag" "docker tag" "$(calls)"
expect_eq "--db-only: chỉ 1 file" "1" "$(find "$W/backups" -type f | wc -l | tr -d ' ')"
RUN_R --list
expect_rc "--db-only: restore.sh --list không lỗi" 0 "$RC2"; expect_not_contains "--db-only: không hiện trong --list" "deploy-pre-$TS" "$OUT2"
mk; EXTRA_ENV=(STUB_MONGO_STATE=exited); run_b --db-only
expect_nonzero "--db-only + mongo tắt" "$RC"; expect_eq "--db-only + mongo tắt: không tạo gì" "" "$(files)"; EXTRA_ENV=()

echo "== 4) --code-only: bundle + tag + manifest, MONGO_BACKUP_FILE rỗng, KHÔNG đụng Mongo =="
mk; run_b --code-only
expect_rc "--code-only" 0 "$RC"; expect_file "--code-only: bundle" "$(BUND)"; expect_file "--code-only: manifest" "$(MANI)"
expect_nofile "--code-only: không archive" "$(ARCH)"
expect_eq "--code-only: MONGO_BACKUP_FILE rỗng" "" "$(mval MONGO_BACKUP_FILE)"
expect_eq "--code-only: DB_VERSION_READ=0" "0" "$(mval DB_VERSION_READ)"
expect_eq "--code-only: không mongodump/mongosh/exec" "0" "$(n_calls ' exec ')"
RUN_R --latest --code-only
expect_rc "--code-only: restore.sh --latest --code-only chấp nhận" 0 "$RC2"; expect_not_contains "--code-only: dry-run không có [HỎNG]" "[HỎNG]" "$OUT2"
RUN_R --latest
expect_nonzero "--code-only: restore.sh --latest (khôi phục DB) không dùng được bản này" "$RC2"
EXTRA_ENV=(STUB_MONGO_STATE=exited); mk; run_b --code-only
expect_rc "--code-only chạy được cả khi mongo tắt" 0 "$RC"; EXTRA_ENV=()

echo "== 5) --no-image =="
mk; run_b --no-image
expect_rc "--no-image" 0 "$RC"; expect_not_contains "--no-image: không docker tag" "docker tag" "$(calls)"
expect_eq "--no-image: PREV_IMAGE_TAG rỗng" "" "$(mval PREV_IMAGE_TAG)"
mk; EXTRA_ENV=(STUB_BACKEND_PRESENT=0); run_b
expect_rc "chưa có container backend: vẫn backup được" 0 "$RC"; expect_not_contains "chưa có backend: không docker tag" "docker tag" "$(calls)"
expect_eq "chưa có backend: PREV_IMAGE_TAG rỗng" "" "$(mval PREV_IMAGE_TAG)"; EXTRA_ENV=()

echo "== 6) DB trống: bỏ qua DB, vẫn backup code; --db-only thì lỗi =="
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=); run_b
expect_rc "DB trống (mặc định)" 0 "$RC"; expect_nofile "DB trống: không archive" "$(ARCH)"; expect_file "DB trống: vẫn có bundle" "$(BUND)"; expect_file "DB trống: vẫn có manifest" "$(MANI)"
expect_eq "DB trống: MONGO_BACKUP_FILE rỗng" "" "$(mval MONGO_BACKUP_FILE)"; expect_eq "DB trống: không mongodump" "0" "$(n_calls 'mongodump')"
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=system); run_b
expect_rc "DB chỉ có system.*" 0 "$RC"; expect_nofile "DB chỉ system: không archive" "$(ARCH)"
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=); run_b --db-only
expect_rc "--db-only + DB trống" 1 "$RC"; expect_contains "--db-only + DB trống: lý do" "DB trống" "$OUT"; expect_eq "--db-only + DB trống: không tạo gì" "" "$(files)"
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders); run_b
expect_nonzero "DB dở dang (không users, có dữ liệu)" "$RC"; expect_eq "DB dở dang: không tạo gì" "" "$(files)"; expect_eq "DB dở dang: không tag" "" "$(tags)"
EXTRA_ENV=()

echo "== 7) Mongo tắt / cấu hình cũ / dump hỏng / verify hỏng: dọn sạch =="
mk; EXTRA_ENV=(STUB_MONGO_STATE=exited); run_b
expect_nonzero "mongo tắt" "$RC"; expect_contains "mongo tắt: gợi ý" "--code-only" "$OUT"; expect_eq "mongo tắt: không tạo gì" "" "$(files)"; expect_eq "mongo tắt: không tag" "" "$(tags)"
mk; EXTRA_ENV=(STUB_NO_ROOT=1); run_b
expect_nonzero "mongo cấu hình cũ (không user root)" "$RC"; expect_eq "mongo cấu hình cũ: không tạo gì" "" "$(files)"
mk; EXTRA_ENV=(STUB_DUMP_RC=1); run_b
expect_nonzero "mongodump lỗi" "$RC"; expect_contains "mongodump lỗi: báo" "mongodump thất bại" "$OUT"
expect_eq "mongodump lỗi: dọn sạch (không archive/.partial/bundle/manifest)" "" "$(files)"; expect_eq "mongodump lỗi: không tag" "" "$(tags)"
mk; EXTRA_ENV=(STUB_DRYRUN_USERS=0); run_b
expect_nonzero "verify hỏng (dump không có realestate.users)" "$RC"; expect_contains "verify hỏng: báo" "không đạt kiểm tra nội dung" "$OUT"
expect_eq "verify hỏng: dọn sạch file" "" "$(files)"; expect_eq "verify hỏng: không tag" "" "$(tags)"
expect_not_contains "verify hỏng: không gắn thẻ image" "docker tag" "$(calls)"; expect_not_contains "verify hỏng: không đụng stack" " up " "$(calls)"
EXTRA_ENV=()

echo "== 8) Lỗi SAU khi đã tạo bundle/tag/thẻ image: on_exit dọn tất cả (và đối chứng đột biến) =="
# Ép lỗi ghi manifest: thư mục trùng tên file .tmp làm manifest_write thất bại, sau khi archive + bundle + tag + thẻ image đã có.
fail_manifest() { mkdir -p "$W/backups/deploy-pre-$TS.manifest.tmp"; }
mk; fail_manifest; run_b
expect_nonzero "ghi manifest lỗi" "$RC"; expect_contains "ghi manifest lỗi: báo" "Không ghi được manifest" "$OUT"
expect_eq "ghi manifest lỗi: không còn archive/bundle/manifest" "" "$(files)"
expect_eq "ghi manifest lỗi: tag đã bị xóa" "" "$(tags)"
expect_contains "ghi manifest lỗi: gỡ thẻ image đã gắn" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"
expect_contains "ghi manifest lỗi: báo đã dọn" "đã dọn" "$OUT"
# Đối chứng: bỏ dòng `git tag -d` khỏi on_exit thì test trên phải bắt được (tag còn sót).
mk; fail_manifest; sed -i '/git tag -d "\$TAG_NAME"/d' "$W/scripts/backup.sh"; run_b
[[ -n "$(tags)" ]] && ok || fail "đối chứng: bỏ 'git tag -d' mà tag vẫn bị xóa => test dọn tag không phân biệt được"
mk; fail_manifest; sed -i '/docker rmi/d' "$W/scripts/backup.sh"; run_b
expect_eq "đối chứng: bỏ 'docker rmi' thì không còn lệnh rmi (test dọn thẻ image bắt được)" "0" "$(n_calls 'docker rmi')"
mk; fail_manifest; sed -i '/rm -f -- "\${BUNDLE_FILE}.partial" "\$BUNDLE_FILE"/d' "$W/scripts/backup.sh"; run_b
[[ -f "$(BUND)" ]] && ok || fail "đối chứng: bỏ dòng xóa bundle mà bundle vẫn mất => test dọn file không phân biệt được"

echo "== 9) Kiểm tiền điều kiện phía code chạy TRƯỚC khi dump (5.3) =="
mk; git -C "$W" branch -m 'feat#1'; run_b
expect_rc "tên nhánh feat#1" 1 "$RC"; expect_contains "feat#1: báo tên nhánh" "feat#1" "$OUT"
expect_eq "feat#1: KHÔNG có mongodump (dừng trước khi dump)" "0" "$(n_calls 'mongodump')"
expect_eq "feat#1: không gọi docker exec nào" "0" "$(n_calls ' exec ')"
expect_eq "feat#1: không tạo file nào" "" "$(files)"; expect_eq "feat#1: không tag" "" "$(tags)"
mk; git -C "$W" branch -m 'feat#1'; run_b --db-only
expect_eq "feat#1 + --db-only: vẫn chạy (không cần tên nhánh), có archive" "0" "$RC"; expect_file "feat#1 --db-only: archive" "$(ARCH)"
mk; git -C "$W" tag "pre-deploy-$TS"; run_b
expect_rc "tag pre-deploy-<TS> đã có" 1 "$RC"; expect_contains "tag trùng: báo" "Đã có tag" "$OUT"
expect_eq "tag trùng: KHÔNG mongodump" "0" "$(n_calls 'mongodump')"; expect_eq "tag trùng: không tạo file" "" "$(files)"
expect_contains "tag trùng: tag cũ còn nguyên" "pre-deploy-$TS" "$(tags)"
mk; mkdir -p "$W/backups"; printf 'cu' > "$(BUND)"; run_b
expect_rc "bundle <TS> đã có" 1 "$RC"; expect_eq "bundle trùng: KHÔNG mongodump" "0" "$(n_calls 'mongodump')"
expect_eq "bundle trùng: file cũ nguyên vẹn (không bị dọn nhầm)" "cu" "$(cat "$(BUND)")"; expect_eq "bundle trùng: chỉ còn file cũ" "$(BUND)" "$(find "$W/backups" -type f | tr '\n' ' ' | sed 's/ $//')"
mk; mkdir -p "$W/backups"; printf 'manifest-cu' > "$(MANI)"; run_b
expect_rc "manifest <TS> đã có" 1 "$RC"; expect_eq "manifest trùng: KHÔNG mongodump" "0" "$(n_calls 'mongodump')"
expect_eq "manifest trùng: file cũ nguyên vẹn (on_exit không xóa nhầm)" "manifest-cu" "$(cat "$(MANI)")"
mk; mkdir -p "$W/backups"; printf 'archive-cu' > "$(ARCH)"; run_b
expect_rc "archive <TS> đã có" 1 "$RC"; expect_eq "archive trùng: KHÔNG mongodump" "0" "$(n_calls 'mongodump')"; expect_eq "archive trùng: file cũ nguyên vẹn" "archive-cu" "$(cat "$(ARCH)")"
mk; mkdir -p "$W/backups"; printf 'archive-cu' > "$(ARCH)"; run_b --db-only
expect_rc "--db-only: archive <TS> đã có" 1 "$RC"; expect_eq "--db-only: archive cũ nguyên vẹn" "archive-cu" "$(cat "$(ARCH)")"
# Đối chứng đột biến: dời precheck xuống SAU dump thì feat#1 phải làm mongodump chạy và dump hợp lệ bị xóa (đúng lỗi 5.3 ban đầu).
mk; git -C "$W" branch -m 'feat#1'
sed -i '/^  precheck   #/d; s/^  local commit="\$P_COMMIT"/  precheck; local commit="$P_COMMIT"/' "$W/scripts/backup.sh"
run_b
(( $(n_calls 'mongodump') >= 1 )) && ok || fail "đối chứng: dời precheck xuống sau dump mà mongodump vẫn không chạy => test thứ tự không phân biệt được"
expect_eq "đối chứng: thứ tự cũ làm mất dump hợp lệ (đúng lỗi 5.3)" "" "$(files)"
# Kiểm tĩnh: precheck được gọi trước backup_mongo trong main.
L_PRE="$(grep -n '^  precheck' "$ROOT_DIR/scripts/backup.sh" | head -n 1 | cut -d: -f1)"; L_DB="$(grep -n 'backup_mongo || rc' "$ROOT_DIR/scripts/backup.sh" | head -n 1 | cut -d: -f1)"
(( ${L_PRE:-0} > 0 && ${L_PRE:-0} < ${L_DB:-0} )) && ok || fail "main: precheck phải đứng TRƯỚC backup_mongo (dòng $L_PRE / $L_DB)"

echo "== 10) HEAD detached =="
mk; git -C "$W" checkout -q --detach; run_b
expect_rc "HEAD detached" 0 "$RC"; expect_contains "detached: cảnh báo" "detached" "$OUT"
expect_eq "detached: DETACHED=1" "1" "$(mval DETACHED)"; expect_eq "detached: BRANCH rỗng" "" "$(mval BRANCH)"; expect_eq "detached: CODE_BUNDLE_REF" "HEAD" "$(mval CODE_BUNDLE_REF)"
expect_eq "detached: bundle verify" "0" "$(git -C "$W" bundle verify "$(BUND)" >/dev/null 2>&1; echo $?)"
mk; printf '\n' >> "$W/RealEstateBackendApp/package.json"; run_b
expect_rc "file đã theo dõi bị sửa tay" 0 "$RC"; expect_eq "sửa tay: TRACKED_DIRTY=1" "1" "$(mval TRACKED_DIRTY)"; expect_contains "sửa tay: cảnh báo" "chưa commit" "$OUT"

echo "== 11) Tham số sai / trợ giúp / biến môi trường sai =="
mk; run_b --bi-an
expect_rc "tham số lạ" 2 "$RC"; expect_contains "tham số lạ: nêu tham số" "--bi-an" "$OUT"; expect_eq "tham số lạ: không tạo gì" "" "$(files)"; expect_eq "tham số lạ: không gọi docker" "0" "$(wc -l < "$CALLS" | tr -d ' ')"
run_b --db-only --code-only
expect_rc "--db-only kèm --code-only" 2 "$RC"; expect_contains "loại trừ nhau" "loại trừ nhau" "$OUT"; expect_eq "loại trừ nhau: không tạo gì" "" "$(files)"
run_b --help
expect_rc "--help" 0 "$RC"; expect_contains "--help: có cách dùng" "Cách dùng" "$OUT"; expect_contains "--help: nói rõ --db-only không có manifest" "KHÔNG ghi manifest" "$OUT"
expect_contains "--help: nêu mongorestore" "mongorestore" "$OUT"
EXTRA_ENV=(DUMP_TIMEOUT=abc); run_b
expect_rc "DUMP_TIMEOUT không phải số" 1 "$RC"; expect_eq "DUMP_TIMEOUT sai: không tạo gì" "" "$(files)"; EXTRA_ENV=()
EXTRA_ENV=(BACKUP_MIN_FREE_GB=x); run_b
expect_rc "BACKUP_MIN_FREE_GB không phải số" 1 "$RC"; EXTRA_ENV=()

echo "== 12) Khóa chung với deploy.sh/restore.sh (flock) =="
mk; EXTRA_ENV=(STUB_FLOCK_RC=1); run_b
expect_rc "khóa đang bị giữ" 1 "$RC"; expect_contains "khóa bị giữ: báo" "đang chạy" "$OUT"
expect_eq "khóa bị giữ: không mongodump" "0" "$(n_calls 'mongodump')"; expect_eq "khóa bị giữ: không tạo file" "" "$(files)"; expect_eq "khóa bị giữ: không tag" "" "$(tags)"
EXTRA_ENV=()

echo "== 13) SIGTERM / SIGHUP giữa chừng (ngay lúc gắn thẻ image): mã 143/129 và dọn sạch =="
mk; EXTRA_ENV=("STUB_SIGNAL_ON=tag sha256=TERM"); run_b
expect_rc "SIGTERM" 143 "$RC"; expect_eq "SIGTERM: dọn sạch file" "" "$(files)"; expect_eq "SIGTERM: xóa tag" "" "$(tags)"
expect_contains "SIGTERM: gỡ thẻ image vừa gắn" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"; expect_contains "SIGTERM: báo đã dọn" "THẤT BẠI" "$OUT"
mk; EXTRA_ENV=("STUB_SIGNAL_ON=tag sha256=HUP"); run_b
expect_rc "SIGHUP" 129 "$RC"; expect_eq "SIGHUP: dọn sạch file" "" "$(files)"; expect_eq "SIGHUP: xóa tag" "" "$(tags)"
expect_contains "SIGHUP: gỡ thẻ image vừa gắn" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"
mk; EXTRA_ENV=("STUB_SIGNAL_ON=tag sha256=TERM"); run_b_dead
expect_rc "SIGTERM + stderr chết (/dev/full)" 143 "$RC"; expect_eq "SIGTERM + stderr chết: vẫn dọn sạch file" "" "$(files)"; expect_eq "SIGTERM + stderr chết: vẫn xóa tag" "" "$(tags)"
expect_contains "SIGTERM + stderr chết: vẫn gỡ thẻ image" "docker rmi" "$(calls)"
mk; EXTRA_ENV=(STUB_DUMP_RC=1); run_b_dead
expect_rc "dump lỗi + stderr chết" 1 "$RC"; expect_eq "dump lỗi + stderr chết: vẫn dọn sạch" "" "$(files)"
mk; EXTRA_ENV=(); run_b_dead
expect_rc "backup thường + stderr chết" 0 "$RC"; expect_file "stderr chết: backup vẫn đủ (manifest)" "$(MANI)"
# Kiểm tĩnh on_exit: set +e và bỏ SIGPIPE ở đầu, dọn dẹp TRƯỚC các lệnh in.
OE="$(sed -n '/^on_exit() {/,/^}/p' "$ROOT_DIR/scripts/backup.sh")"
L_SET="$(grep -n 'set +e' <<<"$OE" | head -n 1 | cut -d: -f1)"; L_RM="$(grep -n 'rm -f' <<<"$OE" | head -n 1 | cut -d: -f1)"; L_WARN="$(grep -n 'warn "' <<<"$OE" | head -n 1 | cut -d: -f1)"
(( ${L_SET:-0} > 0 && ${L_SET:-0} < ${L_RM:-0} && ${L_RM:-0} < ${L_WARN:-0} )) && ok || fail "on_exit: thứ tự set +e ($L_SET) < dọn dẹp ($L_RM) < in ($L_WARN)"
expect_contains "on_exit: bỏ SIGPIPE" "trap '' PIPE" "$OE"
EXTRA_ENV=()

echo "== 14) Manifest không mồ côi: bị ngắt sát lúc ghi manifest thì manifest cũng bị xóa (5.9) =="
OE="$(sed -n '/^on_exit() {/,/^}/p' "$ROOT_DIR/scripts/backup.sh")"
expect_contains "on_exit xóa cả manifest chưa chốt" '"$MANIFEST_FILE"' "$OE"
L_SETM="$(grep -n 'MANIFEST_FILE="\${BACKUP_DIR}' "$ROOT_DIR/scripts/backup.sh" | head -n 1 | cut -d: -f1)"; L_CHK="$(grep -n 'deploy-pre-\${TS}.manifest" \]\]' "$ROOT_DIR/scripts/backup.sh" | head -n 1 | cut -d: -f1)"
(( ${L_CHK:-0} > 0 && ${L_CHK:-0} < ${L_SETM:-0} )) && ok || fail "MANIFEST_FILE phải được đặt SAU khi đã kiểm manifest chưa tồn tại (kiểm dòng $L_CHK, đặt dòng $L_SETM)"

echo "== 15) Tên backup.sh không đổi hành vi deploy.sh: deploy.sh vẫn tự backup, không gọi backup.sh =="
# Chỉ được NHẮC backup.sh trong chú thích (#) hoặc dòng trợ giúp "Backup thủ công ..."; mọi dòng khác nhắc tới nó là bị gọi/nạp => hỏng.
expect_eq "deploy.sh không gọi/nạp backup.sh (chỉ nhắc trong chú thích/usage)" "0" "$(grep 'scripts/backup\.sh' "$ROOT_DIR/deploy.sh" | grep -vcE '^[[:space:]]*#|^Backup thủ công' || true)"
expect_contains "deploy.sh vẫn có backup_mongo" "backup_mongo()" "$(cat "$ROOT_DIR/deploy.sh")"
expect_contains "deploy.sh vẫn có backup_code" "backup_code()" "$(cat "$ROOT_DIR/deploy.sh")"

echo "== 16) git bundle create/verify lỗi, mongodump quá hạn (rc 124): dọn sạch, mã 1 (QA vòng 4, M1) =="
# (a) `git bundle create` lỗi. Hành vi thực tế: on_exit dọn MỌI thứ lần chạy này đã tạo, KỂ CẢ dump DB tốt đã xong trước đó (tất cả hoặc không gì).
mk; EXTRA_ENV=(STUB_GIT_BUNDLE_CREATE_FAIL=1); run_b
expect_rc "bundle create lỗi" 1 "$RC"; expect_contains "bundle create lỗi: báo" "git bundle create thất bại" "$OUT"
expect_eq "bundle create lỗi: dọn sạch (cả dump DB đã xong, không .partial, không manifest)" "" "$(files)"
expect_eq "bundle create lỗi: không tag" "" "$(tags)"; expect_not_contains "bundle create lỗi: chưa gắn thẻ image" "docker tag" "$(calls)"
expect_eq "bundle create lỗi: dump DB ĐÃ chạy trước đó (đúng thứ tự mặc định)" "1" "$(n_calls 'mongodump')"
expect_contains "bundle create lỗi: báo đã dọn" "đã dọn" "$OUT"
mk; EXTRA_ENV=(STUB_GIT_BUNDLE_CREATE_FAIL=1); run_b --code-only
expect_rc "bundle create lỗi (--code-only)" 1 "$RC"; expect_eq "bundle create lỗi --code-only: không còn gì" "" "$(files)"; expect_eq "bundle create lỗi --code-only: không tag" "" "$(tags)"
# (b) `git bundle verify` lỗi: .partial bị xóa, không tag, không thẻ image, không manifest, mã 1.
mk; EXTRA_ENV=(STUB_GIT_BUNDLE_VERIFY_FAIL=1); run_b
expect_rc "bundle verify lỗi" 1 "$RC"; expect_contains "bundle verify lỗi: báo" "không qua 'git bundle verify'" "$OUT"
expect_eq "bundle verify lỗi: dọn sạch (bundle .partial, archive, manifest)" "" "$(files)"; expect_eq "bundle verify lỗi: không tag" "" "$(tags)"
expect_not_contains "bundle verify lỗi: không gắn thẻ image" "docker tag" "$(calls)"
mk; EXTRA_ENV=(STUB_GIT_BUNDLE_VERIFY_FAIL=1); run_b --code-only
expect_rc "bundle verify lỗi (--code-only)" 1 "$RC"; expect_eq "bundle verify lỗi --code-only: không còn gì" "" "$(files)"; expect_eq "bundle verify lỗi --code-only: không tag" "" "$(tags)"
# đối chứng đột biến: bỏ dòng `git bundle verify` thì bundle hỏng lọt qua (rc 0) => test (b) ở trên sẽ HỎNG, tức là bắt được.
mk; sed -i '/^  git bundle verify "\$part"/d' "$W/scripts/backup.sh"; EXTRA_ENV=(STUB_GIT_BUNDLE_VERIFY_FAIL=1); run_b
expect_eq "đối chứng: bỏ 'git bundle verify' thì bundle không được kiểm (rc 0: test (b) bắt được)" "0" "$RC"
# (c) mongodump quá hạn (timeout trả 124): thông báo timeout, dọn .partial và mọi file
mk; EXTRA_ENV=(STUB_DUMP_RC=124); run_b
expect_rc "mongodump quá hạn (124)" 1 "$RC"; expect_contains "mongodump quá hạn: thông báo timeout" "mongodump quá" "$OUT"
expect_contains "mongodump quá hạn: gợi ý DUMP_TIMEOUT" "DUMP_TIMEOUT" "$OUT"
expect_eq "mongodump quá hạn: dọn .partial và mọi file" "" "$(files)"; expect_eq "mongodump quá hạn: không tag" "" "$(tags)"
EXTRA_ENV=()

echo "== 17) install lỗi (Git Bash/NTFS): fallback mkdir + chmod; chmod 700 lỗi thì CẢNH BÁO (L1) =="
mk; EXTRA_ENV=(STUB_INSTALL_FAIL=1); run_b
expect_rc "install lỗi: fallback mkdir" 0 "$RC"; [[ -d "$W/backups" ]] && ok || fail "install lỗi: thiếu thư mục backups"
expect_file "install lỗi: vẫn đủ bộ (manifest)" "$(MANI)"; expect_file "install lỗi: archive" "$(ARCH)"
expect_not_contains "install lỗi mà chmod 700 được: không cảnh báo quyền" "Không đặt được quyền 700" "$OUT"
mk; EXTRA_ENV=(STUB_INSTALL_FAIL=1 STUB_CHMOD700_FAIL=1); run_b
expect_rc "install + chmod 700 đều lỗi: vẫn chạy tiếp" 0 "$RC"; expect_contains "chmod 700 lỗi: CẢNH BÁO rõ ràng" "Không đặt được quyền 700" "$OUT"
expect_file "chmod 700 lỗi: vẫn tạo manifest" "$(MANI)"
mk; EXTRA_ENV=(STUB_INSTALL_FAIL=1 STUB_CHMOD700_FAIL=1); run_b_dead
expect_rc "install + chmod 700 lỗi + stderr chết" 0 "$RC"
# đối chứng đột biến: bỏ cảnh báo (về `|| true`) thì test trên phải hỏng.
mk; sed -i 's/chmod 700 "\$BACKUP_DIR" 2>\/dev\/null || warn "[^;]*" || true; }/chmod 700 "$BACKUP_DIR" 2>\/dev\/null || true; }/' "$W/scripts/backup.sh"; EXTRA_ENV=(STUB_INSTALL_FAIL=1 STUB_CHMOD700_FAIL=1); run_b
expect_not_contains "đối chứng: về '|| true' thì không còn cảnh báo (test bắt được)" "Không đặt được quyền 700" "$OUT"
EXTRA_ENV=()

echo "== 18) Canh lệch: classify_db của backup.sh phải giống deploy.sh (mỗi bên giữ một bản, cố ý không dùng chung) =="
fn_body() { sed -n '/^classify_db() {/,/^}/p' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$'; }
D_FN="$(fn_body "$ROOT_DIR/deploy.sh")"; B_FN="$(fn_body "$ROOT_DIR/scripts/backup.sh")"
[[ -n "$D_FN" && -n "$B_FN" ]] && ok || fail "không tìm thấy classify_db trong deploy.sh hoặc backup.sh"
expect_eq "classify_db: deploy.sh == backup.sh (đã chuẩn hóa khoảng trắng)" "$D_FN" "$B_FN"

echo
echo "Kết quả: $PASS đạt, $FAIL hỏng."
(( FAIL == 0 ))
