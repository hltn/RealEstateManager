#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# ops/tests/backup.test.sh — test shell KHÔNG cần Docker/Mongo thật cho backup.sh (v1.0.6, T-36: không còn git):
#   - CHẠY script THẬT (bash backup.sh ...) trong thư mục deploy TẠM (không phải git repo), với `docker`/`flock`/`date` giả đặt ĐẦU PATH
#   - mặc định đủ bộ (archive + thẻ image pre-<TS> BE/FE + manifest bản 2), --db-only (không manifest/thẻ), --no-image, cờ cũ (--code-only...) bị từ chối
#   - manifest ghi RELEASE_VERSION (release.env), CD_RUN_ID, PRE_TAG/PRE_IMAGE; không có khóa của bản git (BRANCH, CODE_BUNDLE...)
#   - DB trống, DB dở dang, Mongo tắt, dump hỏng, verify hỏng, thẻ trùng, lỗi ghi manifest (dọn sạch file + thẻ image)
#   - khóa chung `<thư mục deploy>/.deploy.lock` (flock -n 8, cùng deploy.sh), SIGTERM/SIGHUP, stderr chết, mật khẩu root không lộ
#   - manifest do backup.sh sinh ra qua được restore.sh --list/--latest (dry-run); kiểm tĩnh không còn git; đối chứng đột biến
# Chỉ kiểm lớp shell (thứ tự, mã thoát, đối số, dọn dẹp). Chạy với Mongo/Docker thật là việc diễn tập staging.
# Cần: bash >= 4, gzip, timeout.
#
# Chạy:  bash ops/tests/backup.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ──────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034,SC2016  # biến dùng gián tiếp; nháy đơn có chủ ý (stub nhận lệnh chứa $ chưa mở rộng)
set -uo pipefail
# Cô lập khỏi môi trường CI: GitHub luôn đặt GITHUB_RUN_ID, làm CD_RUN_ID không còn rỗng như test giả định.
# Ca cần các biến này tự đặt qua EXTRA_ENV/rd.
unset GITHUB_RUN_ID DEPLOY_CD_RUN_ID

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

SECRET="S3cr3t-Pass-XYZ-12345"
STUB="$TMP/stub"
CALLS="$TMP/calls.log"
mkdir -p "$STUB"
TS="20260101-120000"
BE_ID="sha256:be0123456789abcdef"
FE_ID="sha256:fe0123456789abcdef"

# ── Stub: docker, flock, date, stat (đặt ĐẦU PATH) ─────────────────────────────────────────────────────────────────────
# STUB_CALLS ghi mọi lệnh docker (một dòng/lệnh). Điều khiển bằng biến môi trường: STUB_MONGO_STATE, STUB_NO_ROOT(1: mongo cấu hình cũ),
# STUB_USERS_EXIST, STUB_NONEMPTY, STUB_DRYRUN_USERS(1/0), STUB_DUMP_RC, STUB_SYSTEM_VERSION, STUB_BACKEND_PRESENT/STUB_FRONTEND_PRESENT(1/0),
# STUB_TAG_EXISTS (chuỗi con: thẻ image nào chứa nó thì "đã tồn tại"), STUB_IMAGES_ALL(1: mọi image đều có; dùng cho restore.sh dry-run),
# STUB_FAIL_TAG, STUB_FLOCK_RC (khóa bị giữ), STUB_SIGNAL_ON='<chuỗi lệnh>=<TÍN HIỆU>' (gửi tín hiệu cho TIẾN TRÌNH backup.sh qua $PPID: chỉ dùng cho
# lệnh docker gọi TRỰC TIẾP từ backup.sh, vd `docker tag`).
cat > "$STUB/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_CALLS"
if [[ -n "${STUB_SIGNAL_ON:-}" && " $* " == *"${STUB_SIGNAL_ON%%=*}"* && ! -e "$STUB_CALLS.sig" ]]; then
  : > "$STUB_CALLS.sig"; kill "-${STUB_SIGNAL_ON##*=}" "$PPID"
fi
if [[ -n "${STUB_SIGNAL2_ON:-}" && " $* " == *"${STUB_SIGNAL2_ON%%=*}"* && ! -e "$STUB_CALLS.sig2" ]]; then
  : > "$STUB_CALLS.sig2"; kill "-${STUB_SIGNAL2_ON##*=}" "$PPID"
fi
case "${1:-}" in
  info) [[ "$*" == *DockerRootDir* ]] && echo "/"; exit 0 ;;
  inspect)
    case "$*" in
      *State.Status*) echo "${STUB_MONGO_STATE:-running}" ;;
      *"{{.Image}}"*)
        case "$*" in
          *realestate_backend*)  [[ "${STUB_BACKEND_PRESENT:-1}" == "1" ]] && echo "sha256:be0123456789abcdef" || exit 1 ;;
          *realestate_frontend*) [[ "${STUB_FRONTEND_PRESENT:-1}" == "1" ]] && echo "sha256:fe0123456789abcdef" || exit 1 ;;
          *) exit 1 ;;
        esac ;;
      *compose.project*) echo "${STUB_PROJECT:-realestatemanager}" ;;
      *) echo "" ;;
    esac
    exit 0 ;;
  image)   # docker image inspect [-f ...] <ref>
    if [[ -n "${STUB_TAG_EXISTS:-}" && "$*" == *"$STUB_TAG_EXISTS"* ]]; then echo "sha256:exists"; exit 0; fi
    if [[ "${STUB_IMAGES_ALL:-0}" == "1" ]]; then echo "sha256:img"; exit 0; fi
    exit 1 ;;
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
# date giả: đóng băng mã thời gian TS (để dựng trước file/thẻ trùng); mọi dạng gọi khác chuyển cho date thật.
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
# install/chmod giả: STUB_INSTALL_FAIL=1 làm `install` luôn lỗi (như Git Bash/NTFS); STUB_CHMOD700_FAIL=1 làm `chmod 700 ...` lỗi (chmod khác chạy thật).
REAL_INSTALL="$(command -v install)"; REAL_CHMOD="$(command -v chmod)"
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
chmod +x "$STUB/docker" "$STUB/flock" "$STUB/date" "$STUB/stat" "$STUB/install" "$STUB/chmod"

# ── Dựng thư mục deploy "máy chủ" giả mỗi ca (KHÔNG phải git repo; chưa có thư mục backups/: backup.sh tự tạo) ────────────
N=0; W=""
mk() {
  N=$((N + 1))
  W="$TMP/w$N"
  mkdir -p "$W/ops/lib"
  cp "$ROOT_DIR/backup.sh" "$W/backup.sh"
  cp "$ROOT_DIR/restore.sh" "$W/restore.sh"
  cp "$ROOT_DIR/ops/lib/ops-common.sh" "$W/ops/lib/ops-common.sh"
  printf 'services: {}\n' > "$W/docker-compose.yml"
  printf 'MONGO_INITDB_ROOT_USERNAME=root\n' > "$W/.env"
}
EXTRA_ENV=()
# Chạy backup.sh THẬT trong thư mục tạm; OUT = stdout+stderr, RC = mã thoát; CALLS = các lệnh docker giả đã gọi.
run_b() {
  : > "$CALLS"; rm -f "$CALLS.sig" "$CALLS.sig2" "$CALLS.flock"
  OUT="$(cd "$W" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" BACKUP_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" \
    "${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}" bash "$W/backup.sh" "$@" 2>&1)"
  RC=$?
}
# Như run_b nhưng MỌI ghi ra stderr đều thất bại (/dev/full, giống SSH rớt giữa chừng); chỉ stdout được thu.
run_b_dead() {
  : > "$CALLS"; rm -f "$CALLS.sig" "$CALLS.sig2" "$CALLS.flock"
  OUT="$(cd "$W" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" BACKUP_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" \
    "${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}" bash "$W/backup.sh" "$@" 2>/dev/full)"
  RC=$?
}
calls() { cat "$CALLS"; }
files() { ( cd "$W" && { [[ -d backups ]] && find backups -type f | sort; true; } | tr '\n' ' ' ); }
ARCH() { printf '%s/backups/deploy-pre-%s.archive.gz' "$W" "$TS"; }
MANI() { printf '%s/backups/deploy-pre-%s.manifest' "$W" "$TS"; }
mval() { sed -n "s/^$1=//p" "$(MANI)" | head -n 1; }
n_calls() { grep -c -- "$1" "$CALLS" || true; }

# Quyền file chỉ kiểm được khi hệ file giữ chmod (Linux có; NTFS/Git Bash thì không).
touch "$TMP/permprobe"; chmod 600 "$TMP/permprobe"
PERM_OK=0; [[ "$(stat -c %a "$TMP/permprobe" 2>/dev/null)" == "600" ]] && PERM_OK=1
# SIGHUP bị bỏ qua từ lúc khởi động (vd chạy bằng nohup) thì bash không bắt được: bỏ ca SIGHUP thay vì báo hỏng giả.
HUP_OK=1; [[ "$(bash -c 'kill -HUP $$; echo survived' 2>/dev/null)" == "survived" ]] && HUP_OK=0

# ═════════════════════════════════════════════════════════════════════════════
echo "== 1) Mặc định: đủ bộ archive + thẻ image pre-<TS> (BE+FE) + manifest bản 2, không git =="
mk; run_b
expect_rc "backup mặc định" 0 "$RC"
expect_file "archive" "$(ARCH)"; expect_file "manifest" "$(MANI)"
expect_eq "archive là gzip hợp lệ" "0" "$(gzip -t "$(ARCH)" 2>/dev/null; echo $?)"
expect_contains "gắn thẻ image backend vào image đang chạy" "docker tag $BE_ID realestatemanager-backend:pre-$TS" "$(calls)"
expect_contains "gắn thẻ image frontend vào image đang chạy" "docker tag $FE_ID realestatemanager-frontend:pre-$TS" "$(calls)"
expect_eq "đúng 2 lệnh docker tag" "2" "$(n_calls '^docker tag ')"
expect_eq "chỉ có 2 file: archive + manifest (không bundle)" "2" "$(find "$W/backups" -type f | wc -l | tr -d ' ')"
expect_eq "không file rác (.partial/.tmp)" "" "$(find "$W/backups" -name '*.partial' -o -name '*.tmp' | tr '\n' ' ')"
expect_eq "manifest: MANIFEST_VERSION=2" "2" "$(mval MANIFEST_VERSION)"
expect_eq "manifest: BACKUP_KIND" "manual" "$(mval BACKUP_KIND)"
expect_eq "manifest: TS" "$TS" "$(mval TS)"
expect_eq "manifest: PRE_TAG" "pre-$TS" "$(mval PRE_TAG)"
expect_eq "manifest: BACKEND_IMAGE_NAME" "realestatemanager-backend" "$(mval BACKEND_IMAGE_NAME)"
expect_eq "manifest: FRONTEND_IMAGE_NAME" "realestatemanager-frontend" "$(mval FRONTEND_IMAGE_NAME)"
expect_eq "manifest: BACKEND_PRE_IMAGE" "realestatemanager-backend:pre-$TS" "$(mval BACKEND_PRE_IMAGE)"
expect_eq "manifest: FRONTEND_PRE_IMAGE" "realestatemanager-frontend:pre-$TS" "$(mval FRONTEND_PRE_IMAGE)"
expect_eq "manifest: MONGO_BACKUP_FILE" "backups/deploy-pre-$TS.archive.gz" "$(mval MONGO_BACKUP_FILE)"
expect_eq "manifest: DB_VERSION_BEFORE" "010" "$(mval DB_VERSION_BEFORE)"
expect_eq "manifest: DB_VERSION_READ" "1" "$(mval DB_VERSION_READ)"
expect_eq "manifest: COMPOSE_PROJECT" "realestatemanager" "$(mval COMPOSE_PROJECT)"
expect_eq "manifest: STACK_TOUCHED=1 (restore không gợi ý bỏ qua DB)" "1" "$(mval STACK_TOUCHED)"
expect_eq "manifest: POST_UP_REACHED=0" "0" "$(mval POST_UP_REACHED)"
expect_eq "manifest: DEPLOY_STATUS" "succeeded" "$(mval DEPLOY_STATUS)"
expect_eq "manifest: RELEASE_VERSION rỗng khi không có release.env" "" "$(mval RELEASE_VERSION)"
expect_eq "manifest: CD_RUN_ID rỗng khi không có" "" "$(mval CD_RUN_ID)"
expect_eq "manifest: ENV_BACKUP_FILE rỗng (backup thủ công không chép .env)" "" "$(mval ENV_BACKUP_FILE)"
expect_eq "manifest: MONGO_CONTAINER" "realestate_mongo" "$(mval MONGO_CONTAINER)"
expect_eq "manifest: FRONTEND_CONTAINER" "realestate_frontend" "$(mval FRONTEND_CONTAINER)"
for k in BRANCH DETACHED OLD_COMMIT NEW_COMMIT CODE_BUNDLE CODE_BUNDLE_REF CODE_TAG PREV_IMAGE_REPO PREV_IMAGE_TAG TRACKED_DIRTY NO_PULL APP_VERSION_OLD; do
  expect_eq "manifest không còn khóa của bản git: $k" "0" "$(grep -c "^$k=" "$(MANI)" || true)"
done
expect_eq "khóa chung: gọi flock -n 8 đúng 1 lần" "1" "$(grep -c 'flock -n 8' "$CALLS.flock")"
expect_file "khóa chung: file <thư mục deploy>/.deploy.lock (cùng khóa deploy.sh)" "$W/.deploy.lock"
expect_nofile "không dùng khóa trong .git" "$W/.git"
expect_not_contains "mật khẩu root không có trong lệnh docker" "$SECRET" "$(calls)"
expect_not_contains "mật khẩu root không có trong đầu ra" "$SECRET" "$OUT"
expect_not_contains "mật khẩu root không có trong manifest" "$SECRET" "$(cat "$(MANI)")"
expect_eq "mongodump chạy đúng 1 lần" "1" "$(n_calls 'mongodump')"
expect_not_contains "không đụng stack (không up/stop/down/build)" " up " "$(calls)"
expect_not_contains "không dừng container" " stop " "$(calls)"
expect_not_contains "không dùng git (đầu ra không nhắc bundle)" "bundle" "$OUT"
if (( PERM_OK == 1 )); then
  expect_eq "quyền archive 600" "600" "$(stat -c %a "$(ARCH)")"
  expect_eq "quyền manifest 600" "600" "$(stat -c %a "$(MANI)")"; expect_eq "quyền thư mục backups 700" "700" "$(stat -c %a "$W/backups")"
fi

echo "== 2) Manifest do backup.sh sinh ra qua được restore.sh --list / --latest / --manifest (dry-run) =="
RUN_R() { : > "$CALLS"; OUT2="$(cd "$W" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" STUB_IMAGES_ALL=1 DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" bash "$W/restore.sh" "$@" 2>&1)"; RC2=$?; }
RUN_R --list
expect_rc "restore.sh --list" 0 "$RC2"; expect_contains "--list thấy manifest" "deploy-pre-$TS.manifest" "$OUT2"
expect_contains "--list hiện loại backup thủ công" "manual" "$OUT2"
expect_contains "--list hiện hai thẻ image" "realestatemanager-backend:pre-$TS" "$OUT2"
expect_not_contains "--list không hiện MANIFEST HỎNG" "MANIFEST HỎNG" "$OUT2"
RUN_R --latest
expect_rc "restore.sh --latest (dry-run)" 0 "$RC2"; expect_not_contains "dry-run không có [HỎNG]" "[HỎNG]" "$OUT2"
expect_contains "dry-run dùng đúng manifest vừa tạo" "deploy-pre-$TS.manifest" "$OUT2"
RUN_R --manifest "backups/deploy-pre-$TS.manifest"
expect_rc "restore.sh --manifest (dry-run)" 0 "$RC2"; expect_not_contains "--manifest không có [HỎNG]" "[HỎNG]" "$OUT2"

echo "== 3) --db-only: chỉ archive, KHÔNG manifest và KHÔNG thẻ image =="
mk; run_b --db-only
expect_rc "--db-only" 0 "$RC"; expect_file "--db-only: archive" "$(ARCH)"
expect_nofile "--db-only: không manifest" "$(MANI)"
expect_not_contains "--db-only: không docker tag" "docker tag" "$(calls)"
expect_eq "--db-only: chỉ 1 file" "1" "$(find "$W/backups" -type f | wc -l | tr -d ' ')"
RUN_R --list
expect_rc "--db-only: restore.sh --list không lỗi" 0 "$RC2"; expect_not_contains "--db-only: không hiện trong --list" "deploy-pre-$TS" "$OUT2"
mk; EXTRA_ENV=(STUB_MONGO_STATE=exited); run_b --db-only
expect_nonzero "--db-only + mongo tắt" "$RC"; expect_eq "--db-only + mongo tắt: không tạo gì" "" "$(files)"; EXTRA_ENV=()

echo "== 4) --no-image / thiếu container: pre-image rỗng, restore.sh chỉ dùng được --db-only =="
mk; run_b --no-image
expect_rc "--no-image" 0 "$RC"; expect_not_contains "--no-image: không docker tag" "docker tag" "$(calls)"
expect_eq "--no-image: BACKEND_PRE_IMAGE rỗng" "" "$(mval BACKEND_PRE_IMAGE)"; expect_eq "--no-image: FRONTEND_PRE_IMAGE rỗng" "" "$(mval FRONTEND_PRE_IMAGE)"
expect_eq "--no-image: PRE_TAG vẫn ghi" "pre-$TS" "$(mval PRE_TAG)"
RUN_R --latest
expect_nonzero "--no-image: restore.sh --latest (cần image) không dùng được" "$RC2"; expect_contains "--no-image: restore báo [HỎNG]" "HỎNG" "$OUT2"
RUN_R --latest --db-only
expect_rc "--no-image: restore.sh --latest --db-only dùng được" 0 "$RC2"
mk; EXTRA_ENV=(STUB_BACKEND_PRESENT=0); run_b
expect_rc "chưa có container backend: vẫn backup được" 0 "$RC"
expect_eq "chưa có backend: BACKEND_PRE_IMAGE rỗng" "" "$(mval BACKEND_PRE_IMAGE)"
expect_eq "chưa có backend: FRONTEND_PRE_IMAGE vẫn có" "realestatemanager-frontend:pre-$TS" "$(mval FRONTEND_PRE_IMAGE)"
expect_eq "chưa có backend: chỉ 1 docker tag" "1" "$(n_calls '^docker tag ')"
mk; EXTRA_ENV=(STUB_FRONTEND_PRESENT=0); run_b
expect_rc "chưa có container frontend: vẫn backup được" 0 "$RC"
expect_eq "chưa có frontend: FRONTEND_PRE_IMAGE rỗng" "" "$(mval FRONTEND_PRE_IMAGE)"
expect_eq "chưa có frontend: BACKEND_PRE_IMAGE vẫn có" "realestatemanager-backend:pre-$TS" "$(mval BACKEND_PRE_IMAGE)"
mk; EXTRA_ENV=(STUB_PROJECT=myproj); run_b
expect_eq "COMPOSE_PROJECT lấy từ nhãn compose của backend" "myproj" "$(mval COMPOSE_PROJECT)"
expect_eq "tên image KHÔNG đổi theo project (mặc định docker-compose.yml)" "realestatemanager-backend:pre-$TS" "$(mval BACKEND_PRE_IMAGE)"
EXTRA_ENV=()

echo "== 5) release.env + mã chạy CD: RELEASE_VERSION/RELEASE_COMMIT/CD_RUN_ID, tên image từ release.env =="
mk; printf 'RELEASE_VERSION=1.0.6\nGIT_COMMIT=abc1234\nBACKEND_IMAGE_NAME=acme-be\nFRONTEND_IMAGE_NAME=acme-fe\n' > "$W/release.env"
EXTRA_ENV=(DEPLOY_CD_RUN_ID=run-123); run_b
expect_rc "có release.env + CD run" 0 "$RC"
expect_eq "RELEASE_VERSION từ release.env" "1.0.6" "$(mval RELEASE_VERSION)"; expect_eq "RELEASE_COMMIT từ release.env" "abc1234" "$(mval RELEASE_COMMIT)"
expect_eq "CD_RUN_ID từ DEPLOY_CD_RUN_ID" "run-123" "$(mval CD_RUN_ID)"
expect_eq "tên image BE từ release.env" "acme-be:pre-$TS" "$(mval BACKEND_PRE_IMAGE)"; expect_eq "tên image FE từ release.env" "acme-fe:pre-$TS" "$(mval FRONTEND_PRE_IMAGE)"
expect_contains "docker tag dùng tên từ release.env" "docker tag $BE_ID acme-be:pre-$TS" "$(calls)"
mk; printf 'RELEASE_VERSION=1.0.6\n' > "$W/release.env"; EXTRA_ENV=(GITHUB_RUN_ID=987654); run_b
expect_eq "CD_RUN_ID rơi về GITHUB_RUN_ID" "987654" "$(mval CD_RUN_ID)"
mk; printf 'RELEASE_VERSION=1.0.6\n' > "$W/release.env"; EXTRA_ENV=(DEPLOY_CD_RUN_ID=first GITHUB_RUN_ID=second); run_b
expect_eq "DEPLOY_CD_RUN_ID ưu tiên hơn GITHUB_RUN_ID" "first" "$(mval CD_RUN_ID)"
mk; printf 'BACKEND_IMAGE_NAME=Bad Name;rm\nFRONTEND_IMAGE_NAME=../x\nRELEASE_VERSION=a b c\nGIT_COMMIT=ZZZ\n' > "$W/release.env"; EXTRA_ENV=(); run_b
expect_rc "release.env có giá trị xấu: vẫn chạy" 0 "$RC"
expect_eq "tên BE xấu: rơi về mặc định" "realestatemanager-backend:pre-$TS" "$(mval BACKEND_PRE_IMAGE)"
expect_eq "tên FE xấu (..): rơi về mặc định" "realestatemanager-frontend:pre-$TS" "$(mval FRONTEND_PRE_IMAGE)"
expect_eq "RELEASE_VERSION xấu: bỏ trống" "" "$(mval RELEASE_VERSION)"; expect_eq "RELEASE_COMMIT xấu: bỏ trống" "" "$(mval RELEASE_COMMIT)"
RUN_R --latest
expect_rc "manifest từ release.env xấu vẫn qua restore.sh" 0 "$RC2"
# CD_RUN_ID sai dạng: dừng SAU khi đã gắn thẻ => on_exit phải dọn archive + gỡ cả hai thẻ.
mk; EXTRA_ENV=(DEPLOY_CD_RUN_ID='a b;c'); run_b
expect_rc "CD_RUN_ID sai dạng" 1 "$RC"; expect_contains "CD_RUN_ID sai: báo" "CD_RUN_ID" "$OUT"
expect_eq "CD_RUN_ID sai: dọn sạch file" "" "$(files)"
expect_contains "CD_RUN_ID sai: gỡ thẻ BE" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"
expect_contains "CD_RUN_ID sai: gỡ thẻ FE" "docker rmi realestatemanager-frontend:pre-$TS" "$(calls)"
EXTRA_ENV=()

echo "== 6) DB trống: bỏ qua DB, vẫn thẻ image + manifest; --db-only thì lỗi =="
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=); run_b
expect_rc "DB trống (mặc định)" 0 "$RC"; expect_nofile "DB trống: không archive" "$(ARCH)"; expect_file "DB trống: vẫn có manifest" "$(MANI)"
expect_eq "DB trống: MONGO_BACKUP_FILE rỗng" "" "$(mval MONGO_BACKUP_FILE)"; expect_eq "DB trống: không mongodump" "0" "$(n_calls 'mongodump')"
expect_eq "DB trống: vẫn gắn 2 thẻ image" "2" "$(n_calls '^docker tag ')"
RUN_R --latest
expect_nonzero "DB trống: restore.sh --latest không có bản nào dùng được" "$RC2"
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=system); run_b
expect_rc "DB chỉ có system.*" 0 "$RC"; expect_nofile "DB chỉ system: không archive" "$(ARCH)"
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=); run_b --db-only
expect_rc "--db-only + DB trống" 1 "$RC"; expect_contains "--db-only + DB trống: lý do" "DB trống" "$OUT"; expect_eq "--db-only + DB trống: không tạo gì" "" "$(files)"
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders); run_b
expect_nonzero "DB dở dang (không users, có dữ liệu)" "$RC"; expect_eq "DB dở dang: không tạo gì" "" "$(files)"; expect_not_contains "DB dở dang: không gắn thẻ" "docker tag" "$(calls)"
EXTRA_ENV=()

echo "== 7) Mongo tắt / cấu hình cũ / dump hỏng / verify hỏng / quá hạn: dọn sạch, chưa gắn thẻ =="
mk; EXTRA_ENV=(STUB_MONGO_STATE=exited); run_b
expect_nonzero "mongo tắt" "$RC"; expect_eq "mongo tắt: không tạo gì" "" "$(files)"; expect_not_contains "mongo tắt: không gắn thẻ" "docker tag" "$(calls)"
mk; EXTRA_ENV=(STUB_NO_ROOT=1); run_b
expect_nonzero "mongo cấu hình cũ (không user root)" "$RC"; expect_eq "mongo cấu hình cũ: không tạo gì" "" "$(files)"
mk; EXTRA_ENV=(STUB_DUMP_RC=1); run_b
expect_nonzero "mongodump lỗi" "$RC"; expect_contains "mongodump lỗi: báo" "mongodump thất bại" "$OUT"
expect_eq "mongodump lỗi: dọn sạch (không archive/.partial/manifest)" "" "$(files)"; expect_not_contains "mongodump lỗi: không gắn thẻ" "docker tag" "$(calls)"
mk; EXTRA_ENV=(STUB_DUMP_RC=124); run_b
expect_rc "mongodump quá hạn (124)" 1 "$RC"; expect_contains "quá hạn: thông báo timeout" "mongodump quá" "$OUT"; expect_contains "quá hạn: gợi ý DUMP_TIMEOUT" "DUMP_TIMEOUT" "$OUT"
expect_eq "quá hạn: dọn .partial và mọi file" "" "$(files)"
mk; EXTRA_ENV=(STUB_DRYRUN_USERS=0); run_b
expect_nonzero "verify hỏng (dump không có realestate.users)" "$RC"; expect_contains "verify hỏng: báo" "không đạt kiểm tra nội dung" "$OUT"
expect_eq "verify hỏng: dọn sạch file" "" "$(files)"; expect_not_contains "verify hỏng: không gắn thẻ image" "docker tag" "$(calls)"; expect_not_contains "verify hỏng: không đụng stack" " up " "$(calls)"
EXTRA_ENV=()

echo "== 8) Lỗi SAU khi đã gắn thẻ: on_exit dọn tất cả (file + thẻ) và đối chứng đột biến =="
# Ép lỗi ghi manifest: thư mục trùng tên file .tmp làm manifest_write thất bại, sau khi archive + hai thẻ image đã có.
fail_manifest() { mkdir -p "$W/backups/deploy-pre-$TS.manifest.tmp"; }
mk; fail_manifest; run_b
expect_nonzero "ghi manifest lỗi" "$RC"; expect_contains "ghi manifest lỗi: báo" "Không ghi được manifest" "$OUT"
expect_eq "ghi manifest lỗi: không còn archive/manifest" "" "$(find "$W/backups" -maxdepth 1 -type f | tr '\n' ' ')"
expect_contains "ghi manifest lỗi: gỡ thẻ BE" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"
expect_contains "ghi manifest lỗi: gỡ thẻ FE" "docker rmi realestatemanager-frontend:pre-$TS" "$(calls)"
expect_contains "ghi manifest lỗi: báo đã dọn" "đã dọn" "$OUT"
# Đối chứng: bỏ các dòng `docker rmi` khỏi on_exit => không còn lệnh rmi (test dọn thẻ bắt được).
mk; fail_manifest; sed -i '/docker rmi/d' "$W/backup.sh"; run_b
expect_eq "đối chứng: bỏ 'docker rmi' thì không còn lệnh rmi" "0" "$(n_calls 'docker rmi')"
# Đối chứng: bỏ dòng xóa archive => archive còn sót (test dọn file bắt được).
mk; fail_manifest; sed -i '/rm -f -- "\${ARCHIVE_FILE}.partial" "\$ARCHIVE_FILE"/d' "$W/backup.sh"; run_b
[[ -f "$(ARCH)" ]] && ok || fail "đối chứng: bỏ dòng xóa archive mà archive vẫn mất => test dọn file không phân biệt được"
# Thẻ FE đã có (chạy chồng): BE vừa gắn phải được gỡ, thẻ FE CÓ SẴN thì KHÔNG bị gỡ nhầm.
mk; EXTRA_ENV=(STUB_TAG_EXISTS="frontend:pre-$TS"); run_b
expect_rc "thẻ FE đã có" 1 "$RC"; expect_contains "thẻ FE đã có: báo" "Đã có thẻ image" "$OUT"
expect_contains "thẻ FE đã có: gỡ thẻ BE vừa gắn" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"
expect_not_contains "thẻ FE đã có: KHÔNG gỡ thẻ có sẵn" "docker rmi realestatemanager-frontend" "$(calls)"
expect_eq "thẻ FE đã có: dọn sạch file" "" "$(files)"
mk; EXTRA_ENV=(STUB_TAG_EXISTS="backend:pre-$TS"); run_b
expect_rc "thẻ BE đã có" 1 "$RC"; expect_eq "thẻ BE đã có: KHÔNG docker rmi nào (không xóa nhầm thẻ có sẵn)" "0" "$(n_calls 'docker rmi')"
expect_eq "thẻ BE đã có: không docker tag nào" "0" "$(n_calls '^docker tag ')"; expect_eq "thẻ BE đã có: dọn sạch file" "" "$(files)"
# docker tag lỗi.
mk; EXTRA_ENV=(STUB_FAIL_TAG=1); run_b
expect_nonzero "docker tag lỗi" "$RC"; expect_contains "docker tag lỗi: báo" "Không gắn được thẻ" "$OUT"; expect_eq "docker tag lỗi: dọn sạch file" "" "$(files)"
EXTRA_ENV=()

echo "== 9) File trùng mã thời gian: không ghi đè, file cũ không bị dọn nhầm =="
mk; mkdir -p "$W/backups"; printf 'manifest-cu' > "$(MANI)"; run_b
expect_rc "manifest <TS> đã có" 1 "$RC"; expect_eq "manifest trùng: KHÔNG mongodump" "0" "$(n_calls 'mongodump')"
expect_eq "manifest trùng: file cũ nguyên vẹn (on_exit không xóa nhầm)" "manifest-cu" "$(cat "$(MANI)")"
mk; mkdir -p "$W/backups"; printf 'archive-cu' > "$(ARCH)"; run_b
expect_rc "archive <TS> đã có" 1 "$RC"; expect_eq "archive trùng: KHÔNG mongodump" "0" "$(n_calls 'mongodump')"; expect_eq "archive trùng: file cũ nguyên vẹn" "archive-cu" "$(cat "$(ARCH)")"
expect_not_contains "archive trùng: không gắn thẻ" "docker tag" "$(calls)"
mk; mkdir -p "$W/backups"; printf 'archive-cu' > "$(ARCH)"; run_b --db-only
expect_rc "--db-only: archive <TS> đã có" 1 "$RC"; expect_eq "--db-only: archive cũ nguyên vẹn" "archive-cu" "$(cat "$(ARCH)")"

echo "== 10) Tham số: cờ cũ bị từ chối (rc 2), tham số lạ, trợ giúp, biến môi trường sai =="
mk; run_b --code-only
expect_rc "cờ cũ --code-only bị từ chối" 2 "$RC"; expect_contains "cờ cũ: nêu tham số" "--code-only" "$OUT"; expect_contains "cờ cũ: giải thích đã bỏ" "đã bỏ ở v1.0.6" "$OUT"
expect_eq "cờ cũ: không tạo gì" "" "$(files)"; expect_eq "cờ cũ: không gọi docker" "0" "$(wc -l < "$CALLS" | tr -d ' ')"
run_b --db-only --code-only
expect_rc "--db-only kèm cờ cũ" 2 "$RC"
run_b --bi-an
expect_rc "tham số lạ" 2 "$RC"; expect_contains "tham số lạ: nêu tham số" "--bi-an" "$OUT"; expect_eq "tham số lạ: không tạo gì" "" "$(files)"; expect_eq "tham số lạ: không gọi docker" "0" "$(wc -l < "$CALLS" | tr -d ' ')"
run_b --help
expect_rc "--help" 0 "$RC"; expect_contains "--help: có cách dùng" "Cách dùng" "$OUT"; expect_contains "--help: nói rõ --db-only không có manifest" "KHÔNG ghi manifest" "$OUT"
expect_contains "--help: nêu mongorestore" "mongorestore" "$OUT"; expect_not_contains "--help: không còn nhắc --code-only như tùy chọn" "--code-only" "$OUT"
EXTRA_ENV=(DUMP_TIMEOUT=abc); run_b
expect_rc "DUMP_TIMEOUT không phải số" 1 "$RC"; expect_eq "DUMP_TIMEOUT sai: không tạo gì" "" "$(files)"; EXTRA_ENV=()
EXTRA_ENV=(BACKUP_MIN_FREE_GB=x); run_b
expect_rc "BACKUP_MIN_FREE_GB không phải số" 1 "$RC"; EXTRA_ENV=()

echo "== 11) File env mặc định là .env (không còn .env.docker) =="
mk; EXTRA_ENV=(DEPLOY_ENV_FILE=.env.docker); run_b
expect_rc "DEPLOY_ENV_FILE=.env.docker ngoài wrapper staging" 1 "$RC"; expect_contains "báo biến staging đặt ngoài wrapper" "DEPLOY_ENV_FILE" "$OUT"
expect_eq "không tạo gì" "" "$(files)"; EXTRA_ENV=()
mk; run_b
expect_rc "không đặt DEPLOY_ENV_FILE: mặc định .env chạy bình thường" 0 "$RC"
expect_eq "backup.sh không còn nhắc .env.docker" "0" "$(grep -c '\.env\.docker' "$ROOT_DIR/backup.sh" || true)"
expect_eq "restore.sh không còn nhắc .env.docker" "0" "$(grep -c '\.env\.docker' "$ROOT_DIR/restore.sh" || true)"

echo "== 12) Khóa chung <thư mục deploy>/.deploy.lock với deploy.sh/restore.sh =="
mk; EXTRA_ENV=(STUB_FLOCK_RC=1); run_b
expect_rc "khóa đang bị giữ" 1 "$RC"; expect_contains "khóa bị giữ: báo" "đang chạy" "$OUT"
expect_eq "khóa bị giữ: không mongodump" "0" "$(n_calls 'mongodump')"; expect_eq "khóa bị giữ: không tạo file" "" "$(files)"; expect_not_contains "khóa bị giữ: không gắn thẻ" "docker tag" "$(calls)"
EXTRA_ENV=()
# Cùng đường dẫn khóa với deploy.sh: ops-common dựng "$dir/.deploy.lock", deploy.sh khai báo DEPLOY_LOCK_FILE=".deploy.lock" và khóa "$ROOT_DIR/$DEPLOY_LOCK_FILE".
expect_contains "deploy.sh khóa file .deploy.lock" 'DEPLOY_LOCK_FILE=".deploy.lock"' "$(cat "$ROOT_DIR/deploy.sh")"
expect_contains "ops-common: acquire_dir_lock dùng .deploy.lock" '/.deploy.lock' "$(sed -n '/^acquire_dir_lock() {/,/^}/p' "$ROOT_DIR/ops/lib/ops-common.sh")"
expect_contains "backup.sh gọi acquire_dir_lock" 'acquire_dir_lock "$ROOT_DIR"' "$(cat "$ROOT_DIR/backup.sh")"
expect_contains "restore.sh gọi acquire_dir_lock" 'acquire_dir_lock "$ROOT_DIR"' "$(cat "$ROOT_DIR/restore.sh")"
# Đối chứng: bỏ lời gọi khóa => không còn flock nào được gọi (test khóa bắt được).
mk; sed -i '/acquire_dir_lock "\$ROOT_DIR"/d' "$W/backup.sh"; run_b
expect_eq "đối chứng: bỏ acquire_dir_lock thì không gọi flock" "0" "$(cat "$CALLS.flock" 2>/dev/null | grep -c flock || true)"

echo "== 13) SIGTERM / SIGHUP giữa chừng (ngay lúc gắn thẻ image): mã 143/129 và dọn sạch =="
mk; EXTRA_ENV=("STUB_SIGNAL_ON=tag sha256:be=TERM"); run_b
expect_rc "SIGTERM lúc gắn thẻ BE" 143 "$RC"; expect_eq "SIGTERM: dọn sạch file" "" "$(files)"
expect_contains "SIGTERM: gỡ thẻ BE (đặt trước docker tag)" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"; expect_contains "SIGTERM: báo đã dọn" "THẤT BẠI" "$OUT"
if (( HUP_OK == 1 )); then
mk; EXTRA_ENV=("STUB_SIGNAL_ON=tag sha256:fe=HUP"); run_b
expect_rc "SIGHUP lúc gắn thẻ FE" 129 "$RC"; expect_eq "SIGHUP: dọn sạch file" "" "$(files)"
expect_contains "SIGHUP: gỡ thẻ FE" "docker rmi realestatemanager-frontend:pre-$TS" "$(calls)"; expect_contains "SIGHUP: gỡ cả thẻ BE đã gắn" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"
else echo "  (bỏ qua ca SIGHUP: SIGHUP bị bỏ qua từ lúc khởi động, vd chạy bằng nohup)"; fi
# Tín hiệu THỨ HAI đến đúng lúc on_exit đang dọn (docker rmi): on_exit bỏ qua TERM/INT/HUP nên vẫn dọn xong + báo, mã gốc 143 (như deploy.sh).
mk; EXTRA_ENV=("STUB_SIGNAL_ON=tag sha256:be=TERM" "STUB_SIGNAL2_ON=rmi realestatemanager-backend:pre-$TS=TERM"); run_b
expect_rc "TERM thứ hai khi đang dọn: mã gốc 143" 143 "$RC"; expect_eq "TERM thứ hai: vẫn dọn sạch file" "" "$(files)"
expect_contains "TERM thứ hai: đã gỡ thẻ BE" "docker rmi realestatemanager-backend:pre-$TS" "$(calls)"; expect_contains "TERM thứ hai: dọn xong vẫn báo THẤT BẠI" "THẤT BẠI" "$OUT"
# Đối chứng: bỏ TERM INT HUP khỏi on_exit => tín hiệu thứ hai cắt ngang việc dọn (không còn tới được dòng báo).
mk; sed -i "/^on_exit() {/,/^}/s/trap '' PIPE TERM INT HUP/trap '' PIPE/" "$W/backup.sh"; run_b
expect_not_contains "đối chứng: không bỏ qua TERM thì dọn bị cắt ngang (test bắt được)" "THẤT BẠI" "$OUT"
mk; EXTRA_ENV=("STUB_SIGNAL_ON=tag sha256:be=TERM"); run_b_dead
expect_rc "SIGTERM + stderr chết (/dev/full)" 143 "$RC"; expect_eq "SIGTERM + stderr chết: vẫn dọn sạch file" "" "$(files)"
expect_contains "SIGTERM + stderr chết: vẫn gỡ thẻ image" "docker rmi" "$(calls)"
mk; EXTRA_ENV=(STUB_DUMP_RC=1); run_b_dead
expect_rc "dump lỗi + stderr chết" 1 "$RC"; expect_eq "dump lỗi + stderr chết: vẫn dọn sạch" "" "$(files)"
mk; EXTRA_ENV=(); run_b_dead
expect_rc "backup thường + stderr chết" 0 "$RC"; expect_file "stderr chết: backup vẫn đủ (manifest)" "$(MANI)"
# Kiểm tĩnh on_exit: set +e và bỏ SIGPIPE ở đầu, dọn dẹp TRƯỚC các lệnh in.
OE="$(sed -n '/^on_exit() {/,/^}/p' "$ROOT_DIR/backup.sh")"
L_SET="$(grep -n 'set +e' <<<"$OE" | head -n 1 | cut -d: -f1)"; L_RM="$(grep -n 'rm -f' <<<"$OE" | head -n 1 | cut -d: -f1)"; L_WARN="$(grep -n 'warn "' <<<"$OE" | head -n 1 | cut -d: -f1)"
(( ${L_SET:-0} > 0 && ${L_SET:-0} < ${L_RM:-0} && ${L_RM:-0} < ${L_WARN:-0} )) && ok || fail "on_exit: thứ tự set +e ($L_SET) < dọn dẹp ($L_RM) < in ($L_WARN)"
expect_contains "on_exit: bỏ SIGPIPE" "trap '' PIPE" "$OE"
expect_contains "on_exit: bỏ cả TERM INT HUP khi dọn (như deploy.sh)" "trap '' PIPE TERM INT HUP" "$OE"
expect_contains "on_exit xóa cả manifest chưa chốt" '"$MANIFEST_FILE"' "$OE"
# MANIFEST_FILE chỉ được đặt MỘT chỗ (trong write_manifest, sau khi main đã kiểm manifest chưa tồn tại): đặt sớm hơn thì on_exit xóa nhầm manifest cũ trùng TS.
expect_eq "MANIFEST_FILE chỉ gán giá trị đường dẫn một lần" "1" "$(grep -c 'MANIFEST_FILE="${BACKUP_DIR}' "$ROOT_DIR/backup.sh")"
expect_contains "phép gán nằm trong write_manifest" 'MANIFEST_FILE="${BACKUP_DIR}' "$(sed -n '/^write_manifest() {/,/^}/p' "$ROOT_DIR/backup.sh")"
EXTRA_ENV=()

echo "== 14) install lỗi (Git Bash/NTFS): fallback mkdir + chmod; chmod 700 lỗi thì CẢNH BÁO =="
mk; EXTRA_ENV=(STUB_INSTALL_FAIL=1); run_b
expect_rc "install lỗi: fallback mkdir" 0 "$RC"; [[ -d "$W/backups" ]] && ok || fail "install lỗi: thiếu thư mục backups"
expect_file "install lỗi: vẫn đủ bộ (manifest)" "$(MANI)"; expect_file "install lỗi: archive" "$(ARCH)"
expect_not_contains "install lỗi mà chmod 700 được: không cảnh báo quyền" "Không đặt được quyền 700" "$OUT"
mk; EXTRA_ENV=(STUB_INSTALL_FAIL=1 STUB_CHMOD700_FAIL=1); run_b
expect_rc "install + chmod 700 đều lỗi: vẫn chạy tiếp" 0 "$RC"; expect_contains "chmod 700 lỗi: CẢNH BÁO rõ ràng" "Không đặt được quyền 700" "$OUT"
expect_file "chmod 700 lỗi: vẫn tạo manifest" "$(MANI)"
mk; EXTRA_ENV=(STUB_INSTALL_FAIL=1 STUB_CHMOD700_FAIL=1); run_b_dead
expect_rc "install + chmod 700 lỗi + stderr chết" 0 "$RC"
mk; sed -i 's/chmod 700 "\$BACKUP_DIR" 2>\/dev\/null || warn "[^;]*" || true; }/chmod 700 "$BACKUP_DIR" 2>\/dev\/null || true; }/' "$W/backup.sh"; EXTRA_ENV=(STUB_INSTALL_FAIL=1 STUB_CHMOD700_FAIL=1); run_b
expect_not_contains "đối chứng: về '|| true' thì không còn cảnh báo (test bắt được)" "Không đặt được quyền 700" "$OUT"
EXTRA_ENV=()

echo "== 15) Kiểm tĩnh: backup.sh/restore.sh không còn git, bundle, --code-only, up --build (và đối chứng đột biến) =="
# Mẫu bị cấm: cờ cũ, bundle, git reset/switch/tag/clone/checkout, `up --build`, hàm cũ của bản git.
BAD_RE='--code-only|bundle|git (reset|switch|checkout|tag|clone|rev-parse|status|fetch|pull)|up .*--build|in_git_repo|acquire_lock|valid_branch_name|--use-image-tag|--allow-infra-change'
static_hits() { grep -nE -- "$BAD_RE" "$1" || true; }
expect_eq "backup.sh sạch (không --code-only/bundle/git/up --build)" "" "$(static_hits "$ROOT_DIR/backup.sh")"
expect_eq "restore.sh sạch (không --code-only/bundle/git reset/up --build)" "" "$(static_hits "$ROOT_DIR/restore.sh")"
for pat in 'git bundle create x' 'git reset --hard HEAD' 'docker compose up --build -d' 'DO_CODE=1 # --code-only'; do
  cp "$ROOT_DIR/backup.sh" "$TMP/mut.sh"; printf '%s\n' "$pat" >> "$TMP/mut.sh"
  [[ -n "$(static_hits "$TMP/mut.sh")" ]] && ok || fail "đối chứng: thêm '$pat' mà kiểm tĩnh không bắt được"
done
GIT_CALL_RE='(^|[;&|(`]|[[:space:]])git[[:space:]]+[a-z-]+'
expect_eq "backup.sh: không gọi lệnh git" "" "$(grep -vE '^[[:space:]]*#' "$ROOT_DIR/backup.sh" | grep -E "^[[:space:]]*git[[:space:]]|[;&|(\`][[:space:]]*git[[:space:]]" || true)"
expect_eq "restore.sh: không gọi lệnh git" "" "$(grep -vE '^[[:space:]]*#' "$ROOT_DIR/restore.sh" | grep -E "^[[:space:]]*git[[:space:]]|[;&|(\`][[:space:]]*git[[:space:]]" || true)"

echo "== 16) deploy.sh vẫn tự backup, không gọi backup.sh; classify_db đồng bộ =="
expect_eq "deploy.sh không gọi/nạp backup.sh (chỉ nhắc trong chú thích/usage)" "0" "$(grep 'backup\.sh' "$ROOT_DIR/deploy.sh" | grep -vcE '^[[:space:]]*#|^Backup thủ công' || true)"
expect_contains "deploy.sh vẫn có backup_mongo" "backup_mongo()" "$(cat "$ROOT_DIR/deploy.sh")"
fn_body() { sed -n '/^classify_db() {/,/^}/p' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$'; }
D_FN="$(fn_body "$ROOT_DIR/deploy.sh")"; B_FN="$(fn_body "$ROOT_DIR/backup.sh")"
[[ -n "$D_FN" && -n "$B_FN" ]] && ok || fail "không tìm thấy classify_db trong deploy.sh hoặc backup.sh"
expect_eq "classify_db: deploy.sh == backup.sh (đã chuẩn hóa khoảng trắng)" "$D_FN" "$B_FN"

echo "== 17) Đối chứng: manifest sai thì restore.sh phải từ chối =="
mk; sed -i 's/"PRE_TAG=pre-\${TS}"/"PRE_TAG=pre"/' "$W/backup.sh"; run_b
expect_rc "(đột biến) backup với PRE_TAG sai vẫn ghi được" 0 "$RC"
RUN_R --latest
expect_nonzero "(đột biến) restore.sh từ chối manifest PRE_TAG sai" "$RC2"
mk; sed -i 's/"MANIFEST_VERSION=2"/"MANIFEST_VERSION=1"/' "$W/backup.sh"; run_b
RUN_R --latest
expect_nonzero "(đột biến) restore.sh từ chối manifest bản 1" "$RC2"; expect_contains "bản 1: thông báo rõ" "bản 1" "$OUT2"

echo
echo "Kết quả: $PASS đạt, $FAIL hỏng."
(( FAIL == 0 ))
