#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/tests/deploy-code-backup.test.sh — test shell KHÔNG cần Docker/Mongo thật cho phần backup CODE của deploy.sh (bước 2b):
#   - hàm THẬT backup_code/manifest_set/manifest_record_deploy_state/manifest_finish trích từ deploy.sh bằng sed, chạy trong repo git TẠM
#   - tạo bundle (qua `git bundle verify`, chứa đúng nhánh/commit), tag CỤC BỘ pre-deploy-<TS>, manifest (đủ khóa, đúng giá trị, không bí mật)
#   - KHÔNG giả định tên nhánh (dùng nhánh release-x); HEAD detached vẫn backup (DETACHED=1)
#   - --plan-only không tạo gì; --no-pull vẫn backup; không có .git thì cảnh báo, không tạo gì
#   - bundle hỏng (tạo lỗi / verify lỗi) => die, KHÔNG để lại bundle/.partial/tag/manifest; đã có bundle/tag cùng TS => die, không ghi đè
#   - manifest_finish chốt succeeded/failed + commit mới; manifest_record_deploy_state ghi DB version/image dự phòng
#   - hợp đồng với scripts/restore.sh: manifest do backup_code ghi qua được read_manifest/validate_manifest THẬT của restore.sh
#   - thứ tự trong git_update: backup_code chạy TRƯỚC `git pull`
#   - git_update KHÔNG ép nhánh `production`: pull trên nhánh đang checkout theo upstream; detached/không upstream thì từ chối, gợi ý --no-pull
#   - tên nhánh ngoài quy tắc (valid_branch_name) => die trước khi tạo bất cứ thứ gì
#   - STACK_TOUCHED/POST_UP_REACHED ghi vào manifest NGAY qua manifest_set (không chờ manifest_finish)
#   - trap TERM/HUP: on_exit nhận mã khác 0 (143/129), manifest ghi `failed` (chạy trong script con thật, trích hàm từ deploy.sh)
#   - git worktree (.git là FILE) vẫn backup được
# `docker` giả đặt đầu PATH (docker thật không chạy). Mode 600 của bundle chỉ kiểm trên Linux (Windows không giữ chmod).
#
# Chạy:  bash scripts/tests/deploy-code-backup.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034,SC2329,SC2016  # biến/hàm dùng qua eval các hàm trích từ deploy.sh
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
expect_lt() { if [[ "$2" =~ ^[0-9]+$ && "$3" =~ ^[0-9]+$ ]] && (( $2 < $3 )); then ok; else fail "$1: thứ tự sai (dòng $2 phải < dòng $3)"; fi; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.test
export GIT_CONFIG_GLOBAL="$TMP/gitconfig-global" GIT_CONFIG_NOSYSTEM=1
printf '[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n' > "$GIT_CONFIG_GLOBAL"

LOG_PREFIX="test"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

extract_fn() { sed -n "/^$1() {/,/^}/p" "$2"; }
for fn in manifest_set backup_code manifest_record_deploy_state manifest_finish git_update; do
  src="$(extract_fn "$fn" "$ROOT_DIR/deploy.sh")"
  [[ -n "$src" ]] || { echo "Không trích được $fn từ deploy.sh" >&2; exit 2; }
  eval "$src"
done
# Hàm đọc manifest THẬT của restore.sh (hợp đồng deploy.sh -> restore.sh)
eval "$(grep -m1 '^readonly MANIFEST_KEYS=' "$ROOT_DIR/scripts/restore.sh")"
for fn in resolve_in_backup_dir read_manifest validate_manifest; do
  src="$(extract_fn "$fn" "$ROOT_DIR/scripts/restore.sh")"
  [[ -n "$src" ]] || { echo "Không trích được $fn từ restore.sh" >&2; exit 2; }
  eval "$src"
done
eval "$(grep -E '^manifest_path_abs\(\) \{.*\}$' "$ROOT_DIR/scripts/restore.sh")"
declare -A MF=()
DB_ARCHIVE=""; BUNDLE_PATH=""

# docker giả (PATH): inspect -> trạng thái mongo; exec mongosh -> SYSTEM_VERSION
STUB="$TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/docker" <<'EOS'
#!/usr/bin/env bash
case "${1:-}" in
  inspect) echo "${STUB_MONGO_STATE:-running}"; exit 0 ;;
  exec) cat > /dev/null; if [[ -z "${STUB_NO_VERSION:-}" ]]; then echo "SYSTEM_VERSION=${STUB_SYSTEM_VERSION-011}"; fi; exit 0 ;;
esac
exit 0
EOS
chmod +x "$STUB/docker"
export PATH="$STUB:$PATH"

# ── Biến mà các hàm deploy.sh cần ───────────────────────────────────────────
TS="20260301-101500"
BACKUP_DIR="backups"
OPS_APP_PKG="RealEstateBackendApp/package.json"
MONGO_CONTAINER="realestate_mongo"
BACKEND_CONTAINER="realestate_backend"
DEFAULT_PROJECT="realestate"
PLAN_ONLY=0
NO_PULL=0
BACKUP_FILE=""
PREV_IMAGE_REPO=""
PREV_IMAGE_TAG=""
STACK_TOUCHED=0
POST_UP_REACHED=0
MANIFEST_FILE=""
OLD_COMMIT_FULL=""
OPS_EXEC_TIMEOUT=30

R=""
N=0
mkrepo() { # repo tạm: nhánh release-x (KHÔNG phải main/master), version app 2.3.4
  N=$((N + 1)); R="$TMP/r$N"
  mkdir -p "$R/RealEstateBackendApp"
  printf '{\n  "version": "2.3.4"\n}\n' > "$R/RealEstateBackendApp/package.json"
  ( cd "$R" && git init -q && git symbolic-ref HEAD refs/heads/release-x && git add -A && git commit -qm "c1" ) || { echo "Không dựng được repo tạm" >&2; exit 2; }
  MANIFEST_FILE=""; PLAN_ONLY=0; NO_PULL=0; BACKUP_FILE=""; PREV_IMAGE_REPO=""; PREV_IMAGE_TAG=""; STACK_TOUCHED=0; POST_UP_REACHED=0
}
run_bc() { OUT="$( cd "$R" && backup_code 2>&1 )"; RC=$?; }
MFILE() { printf '%s/backups/deploy-pre-%s.manifest' "$R" "$TS"; }
BFILE() { printf '%s/backups/deploy-code-pre-%s.bundle' "$R" "$TS"; }
mval() { sed -n "s/^$1=//p" "$(MFILE)" | head -n 1; }
mcount() { grep -c "^$1=" "$(MFILE)" || true; }
nfiles() { find "$R/backups" -type f 2>/dev/null | wc -l | tr -d ' '; }
head_sha() { git -C "$R" rev-parse HEAD; }

echo "== 1) Backup thường (nhánh release-x) =="
mkrepo
C1="$(head_sha)"
run_bc
expect_rc "backup_code" 0 "$RC"
[[ -f "$(BFILE)" ]] && ok || fail "bundle không được tạo"
[[ -f "$(MFILE)" ]] && ok || fail "manifest không được tạo"
git -C "$R" bundle verify "$(BFILE)" >/dev/null 2>&1 && ok || fail "bundle không qua git bundle verify"
HEADS="$(git -C "$R" bundle list-heads "$(BFILE)" 2>/dev/null)"
expect_contains "bundle chứa commit hiện tại" "$C1" "$HEADS"
expect_contains "bundle chứa nhánh release-x" "refs/heads/release-x" "$HEADS"
expect_eq "tag cục bộ pre-deploy-<TS> trỏ commit cũ" "$C1" "$(git -C "$R" rev-parse "pre-deploy-$TS^{commit}" 2>/dev/null)"
expect_eq "không để lại .partial/.tmp" "0" "$(find "$R/backups" -name '*.partial' -o -name '*.tmp' | wc -l | tr -d ' ')"
expect_eq "chỉ có 2 file (bundle + manifest)" "2" "$(nfiles)"
if [[ "$(uname -s)" == "Linux" ]]; then
  expect_eq "bundle mode 600" "600" "$(stat -c '%a' "$(BFILE)")"
  expect_eq "manifest mode 600" "600" "$(stat -c '%a' "$(MFILE)")"
  expect_eq "thư mục backups mode 700" "700" "$(stat -c '%a' "$R/backups")"
fi
expect_eq "MANIFEST_VERSION" "1" "$(mval MANIFEST_VERSION)"
expect_eq "TS" "$TS" "$(mval TS)"
expect_eq "BRANCH (không giả định main)" "release-x" "$(mval BRANCH)"
expect_eq "DETACHED" "0" "$(mval DETACHED)"
expect_eq "OLD_COMMIT đủ 40 ký tự" "$C1" "$(mval OLD_COMMIT)"
expect_eq "OLD_COMMIT_SHORT" "${C1:0:7}" "$(mval OLD_COMMIT_SHORT)"
expect_eq "APP_VERSION_OLD" "2.3.4" "$(mval APP_VERSION_OLD)"
expect_eq "CODE_BUNDLE (tương đối repo)" "backups/deploy-code-pre-$TS.bundle" "$(mval CODE_BUNDLE)"
expect_eq "CODE_BUNDLE_REF" "refs/heads/release-x" "$(mval CODE_BUNDLE_REF)"
expect_eq "CODE_TAG" "pre-deploy-$TS" "$(mval CODE_TAG)"
expect_eq "DEPLOY_STATUS ban đầu" "started" "$(mval DEPLOY_STATUS)"
expect_eq "POST_UP_REACHED ban đầu" "0" "$(mval POST_UP_REACHED)"
expect_eq "STACK_TOUCHED ban đầu" "0" "$(mval STACK_TOUCHED)"
expect_eq "TRACKED_DIRTY" "0" "$(mval TRACKED_DIRTY)"
expect_eq "NO_PULL" "0" "$(mval NO_PULL)"
expect_eq "MONGO_CONTAINER" "realestate_mongo" "$(mval MONGO_CONTAINER)"
expect_eq "MONGO_BACKUP_FILE chưa có" "" "$(mval MONGO_BACKUP_FILE)"
expect_not_contains "manifest không chứa bí mật" "assword" "$(cat "$(MFILE)")"
expect_not_contains "manifest không chứa token" "SECRET" "$(cat "$(MFILE)")"
for k in MANIFEST_VERSION TS CREATED_AT HOST COMPOSE_PROJECT BRANCH DETACHED OLD_COMMIT OLD_COMMIT_SHORT NEW_COMMIT APP_VERSION_OLD APP_VERSION_NEW DB_VERSION_BEFORE DB_VERSION_READ MONGO_BACKUP_FILE MONGO_CONTAINER BACKEND_CONTAINER CODE_BUNDLE CODE_BUNDLE_REF CODE_TAG PREV_IMAGE_REPO PREV_IMAGE_TAG TRACKED_DIRTY NO_PULL STACK_TOUCHED POST_UP_REACHED DEPLOY_STATUS FINISHED_AT; do
  expect_eq "manifest có đúng 1 khóa $k" "1" "$(mcount "$k")"
done

echo "== 2) Hợp đồng với restore.sh: manifest qua read_manifest/validate_manifest THẬT =="
RES="$( ( ROOT_DIR="$R"; read_manifest "$(MFILE)" && printf 'OK branch=%s old=%s bundle=%s' "${MF[BRANCH]}" "${MF[OLD_COMMIT]}" "$BUNDLE_PATH" ) 2>&1 )"
expect_contains "restore.sh đọc được manifest của deploy.sh" "OK branch=release-x old=$C1" "$RES"
expect_contains "restore.sh resolve đúng bundle" "/backups/deploy-code-pre-$TS.bundle" "$RES"

echo "== 3) --plan-only không tạo gì =="
mkrepo; PLAN_ONLY=1
run_bc
expect_rc "plan-only" 0 "$RC"
[[ ! -e "$R/backups" ]] && ok || fail "plan-only không được tạo thư mục backups"
expect_eq "plan-only: không tạo tag" "" "$(git -C "$R" tag)"
expect_eq "plan-only: không in gì" "" "$OUT"

echo "== 4) --no-pull VẪN backup =="
mkrepo; NO_PULL=1
run_bc
expect_rc "no-pull" 0 "$RC"
[[ -f "$(BFILE)" && -f "$(MFILE)" ]] && ok || fail "no-pull phải vẫn tạo bundle + manifest"
expect_eq "no-pull: NO_PULL=1 trong manifest" "1" "$(mval NO_PULL)"

echo "== 5) HEAD detached =="
mkrepo; git -C "$R" checkout -q --detach
C1="$(head_sha)"
run_bc
expect_rc "detached" 0 "$RC"
expect_contains "detached: cảnh báo" "detached" "$OUT"
expect_eq "detached: DETACHED=1" "1" "$(mval DETACHED)"
expect_eq "detached: BRANCH rỗng" "" "$(mval BRANCH)"
expect_eq "detached: CODE_BUNDLE_REF=HEAD" "HEAD" "$(mval CODE_BUNDLE_REF)"
git -C "$R" bundle verify "$(BFILE)" >/dev/null 2>&1 && ok || fail "detached: bundle không qua verify"
expect_contains "detached: bundle chứa commit" "$C1" "$(git -C "$R" bundle list-heads "$(BFILE)" 2>/dev/null)"
RES="$( ( ROOT_DIR="$R"; read_manifest "$(MFILE)" && printf 'OK detached=%s' "${MF[DETACHED]}" ) 2>&1 )"
expect_contains "detached: restore.sh vẫn đọc được" "OK detached=1" "$RES"

echo "== 6) File đã theo dõi bị sửa tay: cảnh báo + TRACKED_DIRTY=1, bundle vẫn là commit =="
mkrepo; C1="$(head_sha)"; printf '\n' >> "$R/RealEstateBackendApp/package.json"
run_bc
expect_rc "dirty" 0 "$RC"; expect_contains "dirty: cảnh báo" "KHÔNG chứa các thay đổi" "$OUT"
expect_eq "dirty: TRACKED_DIRTY=1" "1" "$(mval TRACKED_DIRTY)"
expect_eq "dirty: OLD_COMMIT là commit (không phải working tree)" "$C1" "$(mval OLD_COMMIT)"

echo "== 7) Không có .git: cảnh báo, không tạo gì =="
mkrepo; rm -rf "$R/.git"
run_bc
expect_rc "không .git" 0 "$RC"; expect_contains "không .git: cảnh báo" "Không phải git repo" "$OUT"
[[ ! -e "$R/backups" ]] && ok || fail "không .git: không được tạo backups"

echo "== 8) git bundle create lỗi => die, không để lại gì =="
mkrepo
OUT="$( cd "$R" && { git() { if [[ "${1:-}" == bundle && "${2:-}" == create ]]; then return 1; fi; command git "$@"; }; backup_code; } 2>&1 )"; RC=$?
expect_rc "bundle create lỗi" 1 "$RC"; expect_contains "bundle create lỗi: báo" "git bundle create thất bại" "$OUT"
expect_eq "bundle create lỗi: không để lại file nào" "0" "$(nfiles)"
expect_eq "bundle create lỗi: không tạo tag" "" "$(git -C "$R" tag)"

echo "== 9) Bundle hỏng (verify lỗi) => die, bundle .partial bị xóa =="
mkrepo
OUT="$( cd "$R" && { git() { if [[ "${1:-}" == bundle && "${2:-}" == verify ]]; then return 1; fi; command git "$@"; }; backup_code; } 2>&1 )"; RC=$?
expect_rc "bundle hỏng" 1 "$RC"; expect_contains "bundle hỏng: báo" "không qua 'git bundle verify'" "$OUT"
expect_eq "bundle hỏng: không để lại file nào (bundle/.partial/manifest)" "0" "$(nfiles)"
expect_eq "bundle hỏng: không tạo tag" "" "$(git -C "$R" tag)"

echo "== 10) Đã có bundle/tag cùng TS => die, KHÔNG ghi đè =="
mkrepo; mkdir -p "$R/backups"; printf 'cu' > "$(BFILE)"
run_bc
expect_rc "bundle đã có" 1 "$RC"; expect_contains "bundle đã có: báo" "Không ghi đè" "$OUT"
expect_eq "bundle đã có: nội dung cũ nguyên vẹn" "cu" "$(cat "$(BFILE)")"
expect_eq "bundle đã có: không tạo manifest" "1" "$(nfiles)"
mkrepo; git -C "$R" tag "pre-deploy-$TS"
run_bc
expect_rc "tag đã có" 1 "$RC"; expect_contains "tag đã có: báo" "Đã có tag" "$OUT"
[[ ! -e "$(BFILE)" ]] && ok || fail "tag đã có: không được tạo bundle"

echo "== 11) manifest_set không làm chết deploy =="
MANIFEST_FILE=""
manifest_set FOO bar; expect_rc "manifest_set khi chưa có manifest" 0 "$?"
MANIFEST_FILE="$TMP/khong-ton-tai.manifest"
manifest_set FOO bar; expect_rc "manifest_set khi file mất" 0 "$?"
MANIFEST_FILE=""

echo "== 12) manifest_record_deploy_state: backup Mongo, version DB, image dự phòng =="
mkrepo; run_bc; MANIFEST_FILE="backups/deploy-pre-$TS.manifest"
cd "$R" || exit 2
BACKUP_FILE="backups/deploy-pre-$TS.archive.gz"; PREV_IMAGE_REPO="realestate-backend"; PREV_IMAGE_TAG="realestate-backend:pre-$TS"
manifest_record_deploy_state >/dev/null
cd "$TMP" || exit 2
expect_eq "record: MONGO_BACKUP_FILE" "backups/deploy-pre-$TS.archive.gz" "$(mval MONGO_BACKUP_FILE)"
expect_eq "record: PREV_IMAGE_TAG" "realestate-backend:pre-$TS" "$(mval PREV_IMAGE_TAG)"
expect_eq "record: PREV_IMAGE_REPO" "realestate-backend" "$(mval PREV_IMAGE_REPO)"
expect_eq "record: COMPOSE_PROJECT" "realestate" "$(mval COMPOSE_PROJECT)"
expect_eq "record: DB_VERSION_BEFORE" "011" "$(mval DB_VERSION_BEFORE)"
expect_eq "record: DB_VERSION_READ" "1" "$(mval DB_VERSION_READ)"
expect_eq "record: không nhân đôi khóa" "1" "$(mcount DB_VERSION_BEFORE)"
mkrepo; run_bc; MANIFEST_FILE="backups/deploy-pre-$TS.manifest"
cd "$R" || exit 2
STUB_MONGO_STATE=exited manifest_record_deploy_state >/dev/null
cd "$TMP" || exit 2
expect_eq "record: mongo không chạy => DB_VERSION_READ=0" "0" "$(mval DB_VERSION_READ)"
expect_eq "record: mongo không chạy => DB_VERSION_BEFORE rỗng" "" "$(mval DB_VERSION_BEFORE)"
mkrepo; run_bc; MANIFEST_FILE="backups/deploy-pre-$TS.manifest"
cd "$R" || exit 2
STUB_NO_VERSION=1 manifest_record_deploy_state >/dev/null
cd "$TMP" || exit 2
expect_eq "record: không đọc được version => READ=0" "0" "$(mval DB_VERSION_READ)"

echo "== 13) manifest_finish chốt succeeded/failed + commit mới =="
mkrepo; C1="$(head_sha)"; run_bc; MANIFEST_FILE="backups/deploy-pre-$TS.manifest"
printf '{\n  "version": "2.4.0"\n}\n' > "$R/RealEstateBackendApp/package.json"
git -C "$R" commit -qam "c2"; C2="$(head_sha)"
STACK_TOUCHED=1; POST_UP_REACHED=1; BACKUP_FILE="backups/deploy-pre-$TS.archive.gz"
( cd "$R" && manifest_finish 0 )
expect_eq "finish 0: succeeded" "succeeded" "$(mval DEPLOY_STATUS)"
expect_eq "finish: NEW_COMMIT" "$C2" "$(mval NEW_COMMIT)"
expect_eq "finish: APP_VERSION_NEW" "2.4.0" "$(mval APP_VERSION_NEW)"
expect_eq "finish: STACK_TOUCHED" "1" "$(mval STACK_TOUCHED)"
expect_eq "finish: POST_UP_REACHED" "1" "$(mval POST_UP_REACHED)"
expect_eq "finish: MONGO_BACKUP_FILE" "backups/deploy-pre-$TS.archive.gz" "$(mval MONGO_BACKUP_FILE)"
[[ -n "$(mval FINISHED_AT)" ]] && ok || fail "finish: FINISHED_AT trống"
expect_eq "finish: OLD_COMMIT không đổi" "$C1" "$(mval OLD_COMMIT)"
( cd "$R" && manifest_finish 1 )
expect_eq "finish 1: failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "finish: không nhân đôi khóa DEPLOY_STATUS" "1" "$(mcount DEPLOY_STATUS)"
RES="$( ( ROOT_DIR="$R"; read_manifest "$(MFILE)" && printf 'OK status=%s onway=%s' "${MF[DEPLOY_STATUS]}" "${MF[POST_UP_REACHED]}" ) 2>&1 )"
expect_contains "restore.sh đọc được manifest đã chốt" "OK status=failed onway=1" "$RES"

echo "== 14) Thứ tự trong deploy.sh =="
GU="$(extract_fn git_update "$ROOT_DIR/deploy.sh")"
L_BC="$(grep -nE '^[[:space:]]*backup_code( |$)' <<<"$GU" | tail -n 1 | cut -d: -f1)"
L_PULL="$(grep -nE '^[[:space:]]*git pull --ff-only' <<<"$GU" | head -n 1 | cut -d: -f1)"
expect_lt "git_update: backup_code TRƯỚC git pull" "$L_BC" "$L_PULL"
expect_eq "git_update: backup_code gọi ở cả nhánh --no-pull và nhánh pull" "2" "$(grep -cE '^[[:space:]]*backup_code( |$)' <<<"$GU")"
BC="$(extract_fn backup_code "$ROOT_DIR/deploy.sh")"
expect_contains "backup_code: plan-only thoát đầu hàm" "(( PLAN_ONLY == 0 )) || return 0" "$(sed -n '2p' <<<"$BC")"
expect_eq "deploy.sh/restore.sh không có lệnh git push" "0" "$(cat "$ROOT_DIR/deploy.sh" "$ROOT_DIR/scripts/restore.sh" | grep -c 'git push' || true)"
expect_eq "deploy.sh không còn PROD_BRANCH/ép nhánh production" "0" "$(grep -cE 'PROD_BRANCH|origin production' "$ROOT_DIR/deploy.sh" || true)"
expect_eq "git_update: pull không hardcode remote/nhánh" "0" "$(grep -cE '^[[:space:]]*git pull --ff-only +[A-Za-z]' <<<"$GU" || true)"
DS="$(cat "$ROOT_DIR/deploy.sh")"
expect_contains "deploy.sh: STACK_TOUCHED ghi manifest ngay" "STACK_TOUCHED=1; manifest_set STACK_TOUCHED 1" "$DS"
expect_contains "deploy.sh: POST_UP_REACHED ghi manifest ngay" "POST_UP_REACHED=1; manifest_set POST_UP_REACHED 1" "$DS"
expect_contains "deploy.sh: trap TERM" "trap 'exit 143' TERM" "$DS"
expect_contains "deploy.sh: trap INT" "trap 'exit 130' INT" "$DS"
expect_contains "deploy.sh: trap HUP" "trap 'exit 129' HUP" "$DS"

echo "== 15) git_update: KHÔNG ép nhánh production; pull theo upstream của nhánh đang checkout =="
# remote cục bộ (bare) + nhánh release-x có upstream; một clone khác đẩy thêm commit mới
mkrepo
REM="$TMP/remote$N"; git init -q --bare "$REM"
git -C "$R" remote add origin "$REM"; git -C "$R" push -q -u origin release-x 2>/dev/null
C1="$(head_sha)"
OTH="$TMP/other$N"; git clone -q "$REM" "$OTH" 2>/dev/null
( cd "$OTH" && git checkout -q release-x && printf '{\n  "version": "2.5.0"\n}\n' > RealEstateBackendApp/package.json && git commit -qam "c-remote" && git push -q origin release-x ) 2>/dev/null
C2="$(git -C "$OTH" rev-parse HEAD)"
OLD_COMMIT=""; NEW_COMMIT=""
OUT="$( cd "$R" && git_update 2>&1 )"; RC=$?
expect_rc "git_update trên nhánh release-x (không phải production)" 0 "$RC"
expect_eq "git_update: HEAD tiến tới commit remote" "$C2" "$(head_sha)"
expect_eq "git_update: backup chạy TRƯỚC pull (manifest OLD_COMMIT = commit cũ)" "$C1" "$(mval OLD_COMMIT)"
expect_eq "git_update: bundle chứa commit cũ, không chứa commit mới" "0" "$(git -C "$R" bundle list-heads "$(BFILE)" 2>/dev/null | grep -c "$C2" || true)"
expect_eq "git_update: manifest ghi NEW_COMMIT ngay sau pull" "$C2" "$(mval NEW_COMMIT)"
expect_eq "git_update: manifest BRANCH" "release-x" "$(mval BRANCH)"
expect_not_contains "git_update: không báo lỗi ép nhánh" "production" "$OUT"
# upstream của nhánh khác tên origin (không hardcode 'origin <nhánh>'): đổi tên remote
mkrepo
git init -q --bare "$TMP/remote$N"
git -C "$R" remote add up2 "$TMP/remote$N"; git -C "$R" push -q -u up2 release-x 2>/dev/null
OUT="$( cd "$R" && git_update 2>&1 )"; RC=$?
expect_rc "git_update: upstream là remote tên khác origin" 0 "$RC"
expect_contains "git_update: log nêu upstream" "up2/release-x" "$OUT"

echo "== 15b) git_update: nhánh local và upstream RẼ NHÁNH => git pull --ff-only bị từ chối, backup đã tạo, HEAD không đổi =="
mkrepo
REM="$TMP/remote$N"; git init -q --bare "$REM"
git -C "$R" remote add origin "$REM"; git -C "$R" push -q -u origin release-x 2>/dev/null
OTH="$TMP/other$N"; git clone -q "$REM" "$OTH" 2>/dev/null
( cd "$OTH" && git checkout -q release-x && printf 'remote
' > remote.txt && git add remote.txt && git commit -qm "c-remote" && git push -q origin release-x ) 2>/dev/null
printf 'local
' > "$R/local.txt"; git -C "$R" add local.txt; git -C "$R" commit -qm "c-local"
C1="$(head_sha)"; OLD_COMMIT=""; NEW_COMMIT=""
# set -e THẬT như deploy.sh. `install -m 700` báo lỗi chmod trên Windows (Linux không): bọc install để bỏ qua mã lỗi đó, mọi lệnh khác giữ nguyên.
REAL_INSTALL="$(command -v install)"; mkdir -p "$TMP/stubinstall"
printf '#!/usr/bin/env bash
"%s" "$@"
exit 0
' "$REAL_INSTALL" > "$TMP/stubinstall/install"; chmod +x "$TMP/stubinstall/install"
OUT="$( cd "$R"; PATH="$TMP/stubinstall:$PATH"; set -e; git_update 2>&1 )"; RC=$?
expect_nonzero "git_update: pull rẽ nhánh bị từ chối (mã khác 0)" "$RC"
expect_eq "git_update rẽ nhánh: HEAD không đổi (không merge/rebase ngầm)" "$C1" "$(head_sha)"
[[ -f "$(BFILE)" && -f "$(MFILE)" ]] && ok || fail "git_update rẽ nhánh: backup phải được tạo TRƯỚC pull"
expect_eq "git_update rẽ nhánh: bundle có commit local" "1" "$(git -C "$R" bundle list-heads "$(BFILE)" 2>/dev/null | grep -c "$C1" || true)"
expect_not_contains "git_update rẽ nhánh: không báo 'Đã cập nhật'" "Đã cập nhật" "$OUT"
expect_eq "git_update rẽ nhánh: working tree không có merge dở dang" "0" "$([[ -e "$R/.git/MERGE_HEAD" ]] && echo 1 || echo 0)"

echo "== 16) git_update: detached/không upstream bị từ chối, gợi ý --no-pull, chưa tạo gì =="
mkrepo; git -C "$R" checkout -q --detach; C1="$(head_sha)"
OUT="$( cd "$R" && git_update 2>&1 )"; RC=$?
expect_rc "detached: từ chối" 1 "$RC"; expect_contains "detached: báo detached" "detached" "$OUT"; expect_contains "detached: gợi ý --no-pull" "--no-pull" "$OUT"
[[ ! -e "$R/backups" ]] && ok || fail "detached: không được tạo backups"
expect_eq "detached: không tạo tag" "" "$(git -C "$R" tag)"
expect_eq "detached: HEAD không đổi" "$C1" "$(head_sha)"
mkrepo   # nhánh release-x, KHÔNG có upstream
OUT="$( cd "$R" && git_update 2>&1 )"; RC=$?
expect_rc "không upstream: từ chối" 1 "$RC"; expect_contains "không upstream: báo" "chưa có upstream" "$OUT"; expect_contains "không upstream: gợi ý --no-pull" "--no-pull" "$OUT"
[[ ! -e "$R/backups" ]] && ok || fail "không upstream: không được tạo backups"
expect_eq "không upstream: không tạo tag" "" "$(git -C "$R" tag)"
mkrepo; NO_PULL=1   # --no-pull vẫn chạy được ở cả hai trường hợp
git -C "$R" checkout -q --detach
OUT="$( cd "$R" && git_update 2>&1 )"; RC=$?
expect_rc "detached + --no-pull: chạy được" 0 "$RC"; [[ -f "$(BFILE)" ]] && ok || fail "detached + --no-pull: phải tạo bundle"
NO_PULL=0

echo "== 17) Tên nhánh ngoài quy tắc => die trước khi tạo gì =="
for badbr in 'x;rm' 'we!rd' "it's" 'x$y'; do
  mkrepo; git -C "$R" branch -m "$badbr" 2>/dev/null || { fail "không tạo được nhánh thử '$badbr'"; continue; }
  git -C "$R" symbolic-ref HEAD >/dev/null 2>&1 || true
  run_bc
  expect_rc "nhánh '$badbr': die" 1 "$RC"; expect_contains "nhánh '$badbr': báo tên nhánh" "Tên nhánh" "$OUT"
  [[ ! -e "$R/backups" ]] && ok || fail "nhánh '$badbr': không được tạo backups"
  expect_eq "nhánh '$badbr': không tạo tag" "" "$(git -C "$R" tag)"
done
mkrepo; git -C "$R" branch -m "feature/ok-1.2_x"; run_bc
expect_rc "nhánh hợp lệ có / . _ -" 0 "$RC"; expect_eq "nhánh hợp lệ: BRANCH" "feature/ok-1.2_x" "$(mval BRANCH)"

echo "== 18) manifest_set ghi NGAY (không chờ manifest_finish) =="
mkrepo; run_bc; MANIFEST_FILE="backups/deploy-pre-$TS.manifest"
( cd "$R" && manifest_set STACK_TOUCHED 1 && manifest_set POST_UP_REACHED 1 )
expect_eq "STACK_TOUCHED=1 có ngay trong manifest" "1" "$(mval STACK_TOUCHED)"
expect_eq "POST_UP_REACHED=1 có ngay trong manifest" "1" "$(mval POST_UP_REACHED)"
expect_eq "DEPLOY_STATUS vẫn started (chưa finish)" "started" "$(mval DEPLOY_STATUS)"
expect_eq "không nhân đôi khóa STACK_TOUCHED" "1" "$(mcount STACK_TOUCHED)"

echo "== 19) trap TERM/HUP + on_exit THẬT trong script con: mã khác 0, manifest ghi failed (B2) =="
CHILD="$TMP/child.sh"
cat > "$CHILD" <<'EOS'
#!/usr/bin/env bash
# Script con: nạp hàm THẬT từ deploy.sh (backup_code, manifest_*, on_exit, các dòng trap) rồi mô phỏng bị ngắt.
set -uo pipefail   # KHÔNG -e: `install -m 700` báo lỗi chmod trên Windows (Linux không); hành vi trap không phụ thuộc -e
source "$CHILD_VARS"
source "$ROOT_DIR/scripts/lib/ops-common.sh"
for fn in manifest_set backup_code manifest_finish on_exit; do
  eval "$(sed -n "/^$fn() {/,/^}/p" "$ROOT_DIR/deploy.sh")"
done
print_recovery() { echo "RECOVERY_PRINTED"; echo "recovery-stderr" >&2; }   # in cả ra stderr: stderr hỏng + set -e không được làm mất mã thoát
eval "$(grep -E '^trap ' "$ROOT_DIR/deploy.sh")"
backup_code
case "$1" in
  ok) exit 0 ;;
  term) kill -TERM $$; sleep 5 ;;
  hup) kill -HUP $$; sleep 5 ;;
  touched) STACK_TOUCHED=1; manifest_set STACK_TOUCHED 1; kill -TERM $$; sleep 5 ;;
  fail) exit 7 ;;
  # Bật set -e SAU backup_code (install -m 700 lỗi chmod trên Windows): on_exit phải sống sót khi lệnh in lỗi (stderr hỏng)
  term_e) set -e; STACK_TOUCHED=1; manifest_set STACK_TOUCHED 1; kill -TERM $$; sleep 5 ;;
  fail_e) set -e; STACK_TOUCHED=1; manifest_set STACK_TOUCHED 1; exit 7 ;;
  early_e) set -e; kill -TERM $$; sleep 5 ;;
esac
EOS
run_child() { # <chế độ>: chạy script con trong repo tạm; KHÔNG dùng khóa/docker thật
  declare -p TS BACKUP_DIR OPS_APP_PKG MONGO_CONTAINER BACKEND_CONTAINER DEFAULT_PROJECT PLAN_ONLY NO_PULL BACKUP_FILE PREV_IMAGE_REPO PREV_IMAGE_TAG STACK_TOUCHED POST_UP_REACHED MANIFEST_FILE OLD_COMMIT_FULL OPS_EXEC_TIMEOUT LOG_PREFIX > "$TMP/child.vars"
  OUT="$( cd "$R" && CHILD_VARS="$TMP/child.vars" ROOT_DIR="$ROOT_DIR" bash "$CHILD" "$1" 2>&1 )"; RC=$?
}
mkrepo; run_child ok
expect_rc "script con thoát 0" 0 "$RC"; expect_eq "thoát 0: manifest succeeded" "succeeded" "$(mval DEPLOY_STATUS)"
mkrepo; run_child fail
expect_rc "script con thoát 7" 7 "$RC"; expect_eq "thoát 7: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_contains "thoát 7 trước khi đụng stack: cảnh báo dừng sớm" "Dừng TRƯỚC khi đụng tới stack" "$OUT"
mkrepo; run_child term
expect_rc "SIGTERM: mã 143" 143 "$RC"; expect_eq "SIGTERM: manifest failed (không ghi nhầm succeeded)" "failed" "$(mval DEPLOY_STATUS)"
expect_not_contains "SIGTERM chưa đụng stack: không in hướng dẫn khôi phục" "RECOVERY_PRINTED" "$OUT"
mkrepo; run_child hup
expect_rc "SIGHUP: mã 129" 129 "$RC"; expect_eq "SIGHUP: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
mkrepo; run_child touched
expect_rc "SIGTERM sau khi đụng stack: mã 143" 143 "$RC"; expect_eq "đụng stack + TERM: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "đụng stack + TERM: STACK_TOUCHED=1" "1" "$(mval STACK_TOUCHED)"
expect_contains "đụng stack + TERM: in hướng dẫn khôi phục" "RECOVERY_PRINTED" "$OUT"

echo "== 19b) on_exit THẬT chịu được stderr hỏng + set -e: giữ ĐÚNG mã thoát, manifest failed (M1) =="
run_child_dead() { # <chế độ>: như run_child nhưng MỌI ghi ra stderr đều thất bại (/dev/full, giống SSH rớt); chỉ stdout được thu
  declare -p TS BACKUP_DIR OPS_APP_PKG MONGO_CONTAINER BACKEND_CONTAINER DEFAULT_PROJECT PLAN_ONLY NO_PULL BACKUP_FILE PREV_IMAGE_REPO PREV_IMAGE_TAG STACK_TOUCHED POST_UP_REACHED MANIFEST_FILE OLD_COMMIT_FULL OPS_EXEC_TIMEOUT LOG_PREFIX > "$TMP/child.vars"
  OUT="$( cd "$R" && CHILD_VARS="$TMP/child.vars" ROOT_DIR="$ROOT_DIR" bash "$CHILD" "$1" 2>/dev/full )"; RC=$?
}
mkrepo; run_child_dead term_e
expect_rc "stderr hỏng + set -e + SIGTERM sau khi đụng stack: mã 143 (không bị che thành 1)" 143 "$RC"
expect_eq "stderr hỏng + SIGTERM: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_contains "stderr hỏng + SIGTERM: print_recovery vẫn được gọi" "RECOVERY_PRINTED" "$OUT"
mkrepo; run_child_dead fail_e
expect_rc "stderr hỏng + set -e + exit 7 sau khi đụng stack: mã 7" 7 "$RC"; expect_eq "stderr hỏng + exit 7: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
mkrepo; run_child_dead early_e
expect_rc "stderr hỏng + set -e + SIGTERM trước khi đụng stack (warn ra stderr hỏng): mã 143" 143 "$RC"
expect_eq "stderr hỏng + SIGTERM sớm: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
# bằng chứng test bắt được lỗi: bỏ `set +e` khỏi on_exit thì mã thoát bị che
mkrepo
sed '/^on_exit() {/,/^}/{/^  set +e/d}' "$ROOT_DIR/deploy.sh" > "$TMP/deploy.noset.sh"
sed "s|\$ROOT_DIR/deploy.sh|$TMP/deploy.noset.sh|g" "$CHILD" > "$TMP/child.noset.sh"
declare -p TS BACKUP_DIR OPS_APP_PKG MONGO_CONTAINER BACKEND_CONTAINER DEFAULT_PROJECT PLAN_ONLY NO_PULL BACKUP_FILE PREV_IMAGE_REPO PREV_IMAGE_TAG STACK_TOUCHED POST_UP_REACHED MANIFEST_FILE OLD_COMMIT_FULL OPS_EXEC_TIMEOUT LOG_PREFIX > "$TMP/child.vars"
( cd "$R" && CHILD_VARS="$TMP/child.vars" ROOT_DIR="$ROOT_DIR" bash "$TMP/child.noset.sh" term_e >/dev/null 2>/dev/full ); RC=$?
[[ "$RC" != "143" ]] && ok || fail "đối chứng: bỏ set +e khỏi on_exit mà vẫn ra 143 => test M1 không phân biệt được lỗi"

echo "== 20) git worktree (.git là FILE) vẫn backup được (B13) =="
mkrepo
WT="$TMP/wt$N"; git -C "$R" worktree add -q -b wtbranch "$WT" 2>/dev/null
[[ -f "$WT/.git" ]] && ok || fail "worktree: .git phải là file"
( cd "$WT" && in_git_repo ) && ok || fail "in_git_repo phải đúng trong worktree"
( cd "$TMP" && in_git_repo ) && fail "in_git_repo phải sai ngoài repo" || ok
OUT="$( cd "$WT" && backup_code 2>&1 )"; RC=$?
expect_rc "worktree: backup_code" 0 "$RC"
[[ -f "$WT/backups/deploy-code-pre-$TS.bundle" && -f "$WT/backups/deploy-pre-$TS.manifest" ]] && ok || fail "worktree: thiếu bundle/manifest"
expect_eq "worktree: BRANCH" "wtbranch" "$(sed -n 's/^BRANCH=//p' "$WT/backups/deploy-pre-$TS.manifest" | head -n 1)"
expect_not_contains "worktree: không cảnh báo thiếu .git" "Không phải git repo" "$OUT"

echo
echo "Kết quả: $PASS đạt, $FAIL hỏng."
(( FAIL == 0 ))
