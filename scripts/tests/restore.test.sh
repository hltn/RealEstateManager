#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/tests/restore.test.sh — test shell KHÔNG cần Docker/Mongo thật cho scripts/restore.sh:
#   - CHẠY script THẬT (bash scripts/restore.sh ...) trong repo git TẠM, với `docker`/`curl`/`stat` giả đặt ĐẦU PATH (docker thật KHÔNG bao giờ được gọi)
#   - cách dùng: không tham số, tham số lạ, --db-only + --code-only, --apply thiếu --yes (kể cả đặt biến môi trường: không thay được --yes)
#   - --list: đúng nội dung, manifest hỏng chỉ báo hỏng, không gọi Docker, không ghi gì
#   - manifest: thiếu file, thiếu khóa, sai phiên bản/TS/SHA, đường dẫn NGOÀI thư mục backups bị từ chối
#   - DRY-RUN mặc định: không đổi gì (HEAD, tag, backups/, không lệnh dừng/xóa/nạp DB); bundle hỏng, backup 0 byte, cây bẩn, image mất => [HỎNG]
#   - --apply --yes: THỨ TỰ backup an toàn -> dừng backend -> xóa DB -> mongorestore -> up --build -> kiểm; code về đúng commit/nhánh/version trong manifest
#   - --db-only, --code-only, --use-image-tag; lỗi giữa chừng (in hướng dẫn, không tự rollback); lệch version DB; nạp commit từ bundle; nhánh khác/nhánh đã xóa
#   - mật khẩu root không xuất hiện trong dòng lệnh docker/đầu ra; cảnh báo ĐỎ cho deploy đã qua bước 90 (một chiều)
# Chỉ kiểm lớp shell (thứ tự, mã thoát, đối số, kiểm trước). Chạy với Mongo/Docker thật là việc diễn tập staging.
# Cần: bash >= 4, git (có `git bundle`), gzip, timeout. Không cần flock (không có thì khóa bị bỏ qua, như deploy.sh).
#
# Chạy:  bash scripts/tests/restore.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
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
expect_lt() { if [[ "$2" =~ ^[0-9]+$ && "$3" =~ ^[0-9]+$ ]] && (( $2 < $3 )); then ok; else fail "$1: thứ tự sai (dòng $2 phải < dòng $3)"; fi; }
expect_rc() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mã thoát mong đợi $2, nhận $3"; fi; }
expect_nonzero() { if [[ "$2" != "0" ]]; then ok; else fail "$1: mong đợi mã thoát khác 0"; fi; }

LOG_PREFIX="test"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.test
export GIT_CONFIG_GLOBAL="$TMP/gitconfig-global" GIT_CONFIG_NOSYSTEM=1
printf '[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n' > "$GIT_CONFIG_GLOBAL"

SECRET="S3cr3t-Pass-XYZ-12345"
STUB="$TMP/stub"
CALLS="$TMP/calls.log"
mkdir -p "$STUB"

# ── Stub: docker, curl, stat (đặt ĐẦU PATH; docker thật không bao giờ chạy trong test này) ─────────────────────────────
# STUB_CALLS ghi mọi lệnh docker (một dòng/lệnh) + các thẻ #DROP/#RESTORE/#SYSVER khi mongosh/mongorestore nhận nội dung tương ứng.
# Điều khiển bằng biến môi trường: STUB_MONGO_STATE, STUB_HEALTH, STUB_IMAGE_PRESENT(1/0), STUB_USERS_EXIST, STUB_NONEMPTY, STUB_DRYRUN_USERS(1/0),
# STUB_DRYRUN_RC, STUB_DUMP_RC, STUB_RESTORE_RC, STUB_SYSTEM_VERSION (mặc định 010), STUB_FAIL_UP, STUB_FAIL_STOP (compose stop lỗi),
# STUB_FAIL_DROP (mongosh dropDatabase lỗi), STUB_CURL_RC (liveness), STUB_COMMIT_DRIFT=1 (`up --build` tạo thêm một commit: giả lập lệch commit),
# STUB_SIGNAL_ON='<chuỗi lệnh>=<TÍN HIỆU>' (lần đầu docker nhận lệnh chứa chuỗi đó, stub gửi tín hiệu cho TIẾN TRÌNH restore.sh qua $PPID: chỉ dùng cho
# lệnh `compose ...` gọi TRỰC TIẾP từ restore.sh, không qua timeout/subshell).
cat > "$STUB/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_CALLS"
if [[ -n "${STUB_SIGNAL_ON:-}" && " $* " == *"${STUB_SIGNAL_ON%%=*}"* && ! -e "$STUB_CALLS.sig" ]]; then
  : > "$STUB_CALLS.sig"; kill "-${STUB_SIGNAL_ON##*=}" "$PPID"
fi
case "${1:-}" in
  compose)
    [[ "${2:-}" == "version" ]] && exit 0
    if [[ " $* " == *" up "* && "${STUB_FAIL_UP:-0}" == "1" ]]; then exit 1; fi
    if [[ " $* " == *" stop "* && "${STUB_FAIL_STOP:-0}" == "1" ]]; then exit 1; fi
    if [[ " $* " == *" up -d --build"* && "${STUB_COMMIT_DRIFT:-0}" == "1" ]]; then git commit --allow-empty -q -m drift; fi
    exit 0 ;;
  info) [[ "$*" == *DockerRootDir* ]] && echo "/"; exit 0 ;;
  inspect)
    case "$*" in
      *Health*) echo "${STUB_HEALTH:-healthy}" ;;
      *State.Status*) echo "${STUB_MONGO_STATE:-running}" ;;
      *) echo "" ;;
    esac
    exit 0 ;;
  image) [[ "${STUB_IMAGE_PRESENT:-1}" == "1" ]] && exit 0 || exit 1 ;;
  tag) exit 0 ;;
  exec)
    shift
    [[ "${1:-}" == "-i" ]] && shift
    shift   # tên container
    if [[ "${1:-}" == "mongosh" ]]; then
      script="$(cat)"
      case "$script" in
        *dropDatabase*)      echo "#DROP" >> "$STUB_CALLS"; [[ "${STUB_FAIL_DROP:-0}" == "1" ]] && exit 1; echo "DROPPED realestate" ;;
        *COLL_EXISTS*)       echo "COLL_EXISTS:users=${STUB_USERS_EXIST:-1}" ;;
        *SYSTEM_VERSION*)    echo "#SYSVER" >> "$STUB_CALLS"; echo "SYSTEM_VERSION=${STUB_SYSTEM_VERSION-010}" ;;
        *NONEMPTY_COLLS*)    echo "NONEMPTY_COLLS=${STUB_NONEMPTY-users}" ;;
      esac
      exit 0
    fi
    cmd="${3:-}"   # bash -c <lệnh>
    case "$cmd" in
      *--dryRun*)     cat > /dev/null; [[ "${STUB_DRYRUN_USERS:-1}" == "1" ]] && echo 'archive prelude `realestate.users`'; exit "${STUB_DRYRUN_RC:-0}" ;;
      *mongodump*)    printf 'dump' | gzip; exit "${STUB_DUMP_RC:-0}" ;;
      *mongorestore*) cat > /dev/null; echo "#RESTORE" >> "$STUB_CALLS"; exit "${STUB_RESTORE_RC:-0}" ;;
    esac ;;
esac
exit 0
EOS
printf '#!/usr/bin/env bash\nexit "${STUB_CURL_RC:-0}"\n' > "$STUB/curl"
# stat giả: file_mode luôn báo 600 (Windows không giữ được chmod 600); mọi dạng gọi khác chuyển cho stat thật.
cat > "$STUB/stat" <<'EOS'
#!/usr/bin/env bash
if [[ "$1" == "-c" && "$2" == "%a" ]]; then echo 600; exit 0; fi
exec /usr/bin/stat "$@"
EOS
chmod +x "$STUB/docker" "$STUB/curl" "$STUB/stat"

# ── Dựng repo "máy chủ" giả mỗi ca ───────────────────────────────────────────
TS="20260101-120000"
N=0
W=""
OLD=""
NEW=""

write_pkg() { printf '{\n  "name": "backend",\n  "version": "%s"\n}\n' "$1" > "$W/RealEstateBackendApp/package.json"; }

# Manifest chuẩn (deploy đã thành công, chưa qua bước 90) -> $1; tham số còn lại là KEY=VAL ghi đè.
mf() { # <tên file trong backups> [KEY=VAL...]
  local f="$W/backups/$1" kv ts
  shift
  ts="${MF_TS:-$TS}"
  manifest_write "$f" \
    "MANIFEST_VERSION=1" "TS=$ts" "CREATED_AT=2026-01-01T12:00:00Z" "HOST=srv" "COMPOSE_PROJECT=realestate" \
    "BRANCH=hotfix-9" "DETACHED=0" "OLD_COMMIT=$OLD" "OLD_COMMIT_SHORT=${OLD:0:7}" "NEW_COMMIT=$NEW" \
    "APP_VERSION_OLD=1.0.4" "APP_VERSION_NEW=1.0.5" "DB_VERSION_BEFORE=010" "DB_VERSION_READ=1" \
    "MONGO_BACKUP_FILE=backups/deploy-pre-$ts.archive.gz" "MONGO_CONTAINER=realestate_mongo" "BACKEND_CONTAINER=realestate_backend" \
    "CODE_BUNDLE=backups/deploy-code-pre-$ts.bundle" "CODE_BUNDLE_REF=refs/heads/hotfix-9" "CODE_TAG=pre-deploy-$ts" \
    "PREV_IMAGE_REPO=realestate-backend" "PREV_IMAGE_TAG=realestate-backend:pre-$ts" \
    "TRACKED_DIRTY=0" "NO_PULL=0" "STACK_TOUCHED=1" "POST_UP_REACHED=0" "DEPLOY_STATUS=succeeded" "FINISHED_AT=2026-01-01T12:10:00Z"
  for kv in "$@"; do manifest_put "$f" "${kv%%=*}" "${kv#*=}"; done
}

# Repo: nhánh hotfix-9 (KHÔNG phải main/master, để chứng minh không giả định tên nhánh); C1 (version 1.0.4) -> bundle -> C2 (1.0.5, "sau deploy").
mk() {
  N=$((N + 1))
  W="$TMP/w$N"
  mkdir -p "$W/scripts/lib" "$W/RealEstateBackendApp" "$W/backups"
  cp "$ROOT_DIR/scripts/restore.sh" "$W/scripts/restore.sh"
  cp "$ROOT_DIR/scripts/lib/ops-common.sh" "$W/scripts/lib/ops-common.sh"
  printf 'services: {}\n' > "$W/docker-compose.yml"
  printf 'MONGO_INITDB_ROOT_USERNAME=root\n' > "$W/.env.docker"
  : > "$W/.env"
  printf '.env\n.env.docker\nbackups/\n' > "$W/.gitignore"
  write_pkg 1.0.4
  (
    cd "$W" || exit 1
    git init -q && git symbolic-ref HEAD refs/heads/hotfix-9
    git add -A && git commit -qm "C1 (version cũ)"
  ) || { echo "Không dựng được repo tạm" >&2; exit 2; }
  OLD="$(git -C "$W" rev-parse HEAD)"
  git -C "$W" bundle create "$W/backups/deploy-code-pre-$TS.bundle" hotfix-9 >/dev/null 2>&1
  git -C "$W" tag "pre-deploy-$TS"
  printf 'dump' | gzip > "$W/backups/deploy-pre-$TS.archive.gz"
  write_pkg 1.0.5
  git -C "$W" commit -qam "C2 (deploy kéo về version mới)"
  NEW="$(git -C "$W" rev-parse HEAD)"
  mf "deploy-pre-$TS.manifest"
}

EXTRA_ENV=()
# Chạy restore.sh THẬT trong repo tạm; OUT = stdout+stderr, RC = mã thoát; CALLS = các lệnh docker giả đã gọi.
run_r() {
  : > "$CALLS"; rm -f "$CALLS.sig"
  OUT="$(cd "$W" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" \
    "${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}" bash "$W/scripts/restore.sh" "$@" 2>&1)"
  RC=$?
}
calls() { cat "$CALLS"; }
line_of() { grep -nF -m1 -- "$1" "$CALLS" | cut -d: -f1; }
# Ảnh chụp trạng thái: file backups + HEAD + tag + trạng thái cây + nội dung package.json.
snap() { ( cd "$W" && { find backups -type f | sort; git rev-parse HEAD; git rev-parse --abbrev-ref HEAD; git tag | sort; git status --porcelain --untracked-files=no; cat RealEstateBackendApp/package.json; } ); }
pkg_version() { sed -nE 's/^.*"version"[^"]*"([^"]*)".*$/\1/p' "$W/RealEstateBackendApp/package.json"; }
mutating_calls() { grep -cE 'stop backend|#DROP|#RESTORE| up -d|mongodump|docker tag' "$CALLS" || true; }

# ═════════════════════════════════════════════════════════════════════════════
echo "== 1) Cách dùng / tham số =="
mk
run_r
expect_rc "không tham số" 2 "$RC"; expect_contains "không tham số: usage" "--list | --latest | --manifest" "$OUT"
expect_eq "không tham số: không gọi docker" "" "$(calls)"
run_r --help
expect_rc "--help" 0 "$RC"; expect_contains "--help nội dung" "--apply --yes" "$OUT"
run_r --bậy
expect_rc "tham số lạ" 2 "$RC"; expect_contains "tham số lạ: báo" "Tham số không hợp lệ" "$OUT"
run_r --latest --db-only --code-only
expect_rc "db-only + code-only" 2 "$RC"; expect_contains "db-only + code-only: báo" "loại trừ nhau" "$OUT"
run_r --latest --db-only --use-image-tag
expect_rc "db-only + use-image-tag" 2 "$RC"
run_r --manifest
expect_rc "--manifest thiếu giá trị" 2 "$RC"
run_r --list --apply --yes
expect_rc "--list + --apply" 2 "$RC"
DEPLOY_BACKUP_DIR=bk run_r --list
expect_nonzero "biến staging đặt ngoài wrapper bị chặn" "$RC"; expect_contains "biến staging: báo" "Biến staging" "$OUT"

echo "== 2) --apply thiếu --yes bị từ chối; biến môi trường KHÔNG thay --yes =="
mk
S0="$(snap)"
run_r --latest --apply
expect_rc "--apply thiếu --yes" 2 "$RC"; expect_contains "--apply thiếu --yes: báo" "bắt buộc thêm --yes" "$OUT"
expect_eq "--apply thiếu --yes: không gọi docker" "" "$(calls)"
expect_eq "--apply thiếu --yes: không đổi gì" "$S0" "$(snap)"
EXTRA_ENV=(YES=1 RESTORE_YES=1 DEPLOY_YES=1 ASSUME_YES=1 FORCE=1 CI=1)
run_r --latest --apply
expect_rc "biến môi trường không thay --yes" 2 "$RC"
expect_eq "biến môi trường: không gọi docker" "" "$(calls)"
expect_eq "biến môi trường: không đổi gì" "$S0" "$(snap)"
EXTRA_ENV=()
run_r --latest --yes
expect_rc "--yes không --apply = dry-run" 0 "$RC"; expect_contains "--yes bị bỏ qua" "--yes bị bỏ qua" "$OUT"
expect_eq "--yes không --apply: không đổi gì" "$S0" "$(snap)"

echo "== 3) --list =="
mk
MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest" "DEPLOY_STATUS=failed" "POST_UP_REACHED=1" "PREV_IMAGE_TAG="
printf 'rác không phải manifest\n' > "$W/backups/deploy-pre-20260103-090000.manifest"
S0="$(snap)"
run_r --list
expect_rc "--list" 0 "$RC"
expect_contains "--list: manifest 1" "deploy-pre-$TS.manifest" "$OUT"
expect_contains "--list: manifest 2" "deploy-pre-20260102-080000.manifest" "$OUT"
expect_contains "--list: trạng thái" "trạng thái deploy: failed" "$OUT"
expect_contains "--list: nhánh" "nhánh: hotfix-9" "$OUT"
expect_contains "--list: commit trước" "${OLD:0:12}" "$OUT"
expect_contains "--list: version app" "1.0.4 -> 1.0.5" "$OUT"
expect_contains "--list: tag" "pre-deploy-$TS" "$OUT"
expect_contains "--list: lưu ý một chiều" "bước 90" "$OUT"
expect_contains "--list: manifest hỏng chỉ báo hỏng" "MANIFEST HỎNG" "$OUT"
expect_eq "--list: không gọi docker" "" "$(calls)"
expect_eq "--list: không đổi gì" "$S0" "$(snap)"
rm -f "$W"/backups/*.manifest
run_r --list
expect_rc "--list rỗng" 0 "$RC"; expect_contains "--list rỗng: báo" "Chưa có manifest" "$OUT"

echo "== 4) Manifest sai/thiếu bị từ chối (không đụng DB) =="
mk
run_r --manifest "$W/backups/khong-co.manifest"
expect_nonzero "manifest không tồn tại" "$RC"; expect_contains "manifest không tồn tại: báo" "deploy-pre-" "$OUT"
run_r --manifest "$W/backups/deploy-pre-nope.manifest"
expect_nonzero "manifest không có file" "$RC"
cp "$W/backups/deploy-pre-$TS.manifest" "$TMP/ngoai.manifest"
run_r --manifest "$TMP/ngoai.manifest"
expect_nonzero "manifest NGOÀI backups/" "$RC"; expect_contains "manifest ngoài: báo" "NGOÀI thư mục" "$OUT"
rm -f "$W"/backups/*.manifest
for bad in "MANIFEST_VERSION=2" "TS=hom-nay" "OLD_COMMIT=abc123" "DETACHED=7" "CODE_TAG=tag-la" "DEPLOY_STATUS=xong" "BRANCH=../etc" "BRANCH=-x" "POST_UP_REACHED=2" "MONGO_BACKUP_FILE=/etc/passwd" "CODE_BUNDLE=../x.bundle"; do
  mf "deploy-pre-$TS.manifest" "$bad"
  run_r --manifest "$W/backups/deploy-pre-$TS.manifest"
  expect_nonzero "manifest sai [$bad]" "$RC"
  expect_eq "manifest sai [$bad]: không gọi lệnh nào đổi trạng thái" "0" "$(mutating_calls)"
done
mf "deploy-pre-$TS.manifest"
sed -i '/^OLD_COMMIT=/d' "$W/backups/deploy-pre-$TS.manifest"
run_r --manifest "$W/backups/deploy-pre-$TS.manifest"
expect_nonzero "manifest thiếu OLD_COMMIT" "$RC"; expect_contains "manifest thiếu khóa: báo" "thiếu khóa bắt buộc OLD_COMMIT" "$OUT"
printf 'ten khong phai KEY=VALUE\n' > "$W/backups/deploy-pre-$TS.manifest"
run_r --manifest "$W/backups/deploy-pre-$TS.manifest"
expect_nonzero "manifest sai định dạng" "$RC"
: > "$W/backups/deploy-pre-$TS.manifest"
run_r --manifest "$W/backups/deploy-pre-$TS.manifest"
expect_nonzero "manifest rỗng" "$RC"
run_r --latest
expect_nonzero "--latest khi manifest hỏng" "$RC"
rm -f "$W"/backups/*.manifest
run_r --latest
expect_nonzero "--latest khi không có manifest" "$RC"; expect_contains "--latest rỗng: báo" "Không có manifest" "$OUT"

echo "== 5) DRY-RUN mặc định: kiểm đạt, KHÔNG đổi gì =="
mk
S0="$(snap)"
run_r --latest
expect_rc "dry-run" 0 "$RC"
expect_contains "dry-run: nhãn" "DRY-RUN" "$OUT"
expect_contains "dry-run: kế hoạch" "backup AN TOÀN" "$OUT"
expect_contains "dry-run: bundle đạt" "qua 'git bundle verify'" "$OUT"
expect_contains "dry-run: backup mongo đạt" "thấy realestate.users" "$OUT"
expect_contains "dry-run: cây sạch" "working tree sạch" "$OUT"
expect_contains "dry-run: lệnh chạy thật gợi ý" "--apply --yes" "$OUT"
expect_not_contains "dry-run: không báo một chiều (chưa qua bước 90)" "CẢNH BÁO MỘT CHIỀU" "$OUT"
expect_eq "dry-run: không đổi gì (HEAD/tag/backups/pkg)" "$S0" "$(snap)"
expect_eq "dry-run: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"
expect_not_contains "dry-run: không tạo backup an toàn" "restore-safety" "$(cd "$W" && ls backups)"
run_r --manifest "$W/backups/deploy-pre-$TS.manifest" --code-only
expect_rc "dry-run --code-only" 0 "$RC"
expect_eq "dry-run --code-only: không đổi gì" "$S0" "$(snap)"
# đường dẫn tương đối theo cwd (run_r đã cd vào $W)
run_r --manifest "backups/deploy-pre-$TS.manifest"
expect_rc "dry-run với đường dẫn tương đối" 0 "$RC"

echo "== 6) --latest chọn manifest MỚI nhất =="
mk
MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest"
cp "$W/backups/deploy-code-pre-$TS.bundle" "$W/backups/deploy-code-pre-20260102-080000.bundle"
cp "$W/backups/deploy-pre-$TS.archive.gz" "$W/backups/deploy-pre-20260102-080000.archive.gz"
run_r --latest
expect_rc "--latest" 0 "$RC"; expect_contains "--latest: chọn bản mới" "deploy-pre-20260102-080000.manifest" "$OUT"

echo "== 7) Kiểm trước HỎNG => dry-run báo [HỎNG] (thoát 1), --apply --yes DỪNG chưa đổi gì =="
CB_SEL=(--latest)
check_bad() { # <nhãn> <chuỗi báo>  (CB_SEL = tham số chọn manifest, mặc định --latest)
  local label="$1" msg="$2" s0
  s0="$(snap)"
  run_r "${CB_SEL[@]}"
  expect_rc "$label: dry-run thoát 1" 1 "$RC"; expect_contains "$label: [HỎNG]" "[HỎNG]" "$OUT"; expect_contains "$label: nội dung" "$msg" "$OUT"
  expect_eq "$label: dry-run không đổi gì" "$s0" "$(snap)"
  run_r "${CB_SEL[@]}" --apply --yes
  expect_nonzero "$label: --apply --yes dừng" "$RC"
  expect_eq "$label: --apply dừng trước khi đổi (không lệnh đổi trạng thái)" "0" "$(mutating_calls)"
  expect_eq "$label: --apply dừng, không đổi gì" "$s0" "$(snap)"
}
mk; printf 'rac' > "$W/backups/deploy-code-pre-$TS.bundle"
check_bad "bundle hỏng" "git bundle verify"
mk; : > "$W/backups/deploy-code-pre-$TS.bundle"
check_bad "bundle rỗng" "bundle code"
mk; rm -f "$W/backups/deploy-code-pre-$TS.bundle"
check_bad "bundle mất" "bundle code"
mk; : > "$W/backups/deploy-pre-$TS.archive.gz"
check_bad "backup mongo 0 byte" "0 byte"
mk; printf 'khong phai gzip' > "$W/backups/deploy-pre-$TS.archive.gz"
check_bad "backup mongo không phải gzip" "gzip"
mk; mf "deploy-pre-$TS.manifest" "MONGO_BACKUP_FILE="
CB_SEL=(--manifest "backups/deploy-pre-$TS.manifest")   # --latest sẽ bỏ qua manifest này (mục 20), nên chọn thẳng
check_bad "manifest không có backup mongo" "không có backup Mongo"
CB_SEL=(--latest)
mk; EXTRA_ENV=(STUB_DRYRUN_USERS=0)
check_bad "backup mongo thiếu realestate.users" "không đạt kiểm nội dung"
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_MONGO_STATE=exited)
check_bad "mongo không chạy" "không chạy"
EXTRA_ENV=()
mk; printf '\n' >> "$W/RealEstateBackendApp/package.json"
check_bad "working tree bẩn" "chưa commit"
mk; EXTRA_ENV=(STUB_IMAGE_PRESENT=0)
S0="$(snap)"
run_r --latest --use-image-tag
expect_rc "--use-image-tag image mất" 1 "$RC"; expect_contains "--use-image-tag image mất: báo" "KHÔNG còn trên máy" "$OUT"
run_r --latest
expect_rc "không --use-image-tag thì image mất không sao" 0 "$RC"
EXTRA_ENV=()
mk; mf "deploy-pre-$TS.manifest" "PREV_IMAGE_TAG="
run_r --latest --use-image-tag
expect_rc "--use-image-tag manifest không có image" 1 "$RC"; expect_contains "--use-image-tag không có image: báo" "không có image dự phòng" "$OUT"
mk; mf "deploy-pre-$TS.manifest" "OLD_COMMIT=$NEW"   # bundle tạo ở C1 nên KHÔNG chứa C2
run_r --latest
expect_rc "bundle không chứa commit của manifest" 1 "$RC"; expect_contains "bundle không khớp: báo" "KHÔNG chứa commit" "$OUT"

echo "== 8) --apply --yes: THỨ TỰ + kết quả =="
mk
run_r --latest --apply --yes
expect_rc "apply" 0 "$RC"
expect_contains "apply: xong" "KHÔI PHỤC XONG" "$OUT"
L_DUMP="$(line_of 'mongodump')"; L_STOP="$(line_of 'stop backend')"; L_DROP="$(line_of '#DROP')"
L_REST="$(line_of '#RESTORE')"; L_UP="$(line_of ' up -d --build')"; L_SYS="$(line_of '#SYSVER')"
expect_lt "dừng backend < dump an toàn (không còn ai ghi DB lúc dump)" "$L_STOP" "$L_DUMP"
expect_lt "dump an toàn < xóa DB" "$L_DUMP" "$L_DROP"
expect_lt "xóa DB < mongorestore" "$L_DROP" "$L_REST"
expect_lt "mongorestore < up --build" "$L_REST" "$L_UP"
expect_lt "up --build < kiểm version DB" "$L_UP" "$L_SYS"
expect_eq "code về commit trong manifest" "$OLD" "$(git -C "$W" rev-parse HEAD)"
expect_eq "code về nhánh trong manifest (không giả định main)" "hotfix-9" "$(git -C "$W" rev-parse --abbrev-ref HEAD)"
expect_eq "version app về bản cũ" "1.0.4" "$(pkg_version)"
expect_eq "backup an toàn DB có tạo" "1" "$(cd "$W/backups" && ls restore-safety-*.archive.gz | wc -l | tr -d ' ')"
expect_eq "không để lại .partial" "0" "$(cd "$W/backups" && ls *.partial 2>/dev/null | wc -l | tr -d ' ')"
SAFETY_TAG="$(git -C "$W" tag | grep '^pre-restore-' | head -n 1)"
expect_contains "tag an toàn pre-restore-<TS>" "pre-restore-" "$SAFETY_TAG"
expect_eq "tag an toàn trỏ vào HEAD TRƯỚC restore" "$NEW" "$(git -C "$W" rev-parse "${SAFETY_TAG}^{commit}")"
expect_eq "tag pre-deploy cũ còn nguyên" "$OLD" "$(git -C "$W" rev-parse "pre-deploy-$TS^{commit}")"
expect_contains "apply: kiểm version DB khớp" "[KHỚP] version DB" "$OUT"
expect_contains "apply: kiểm commit khớp" "[KHỚP] commit code" "$OUT"
expect_contains "apply: kiểm version app khớp" "[KHỚP] version app" "$OUT"
expect_contains "apply: mongorestore --drop --nsInclude" "--drop --gzip --archive --nsInclude" "$(calls)"
expect_contains "apply: nsInclude chỉ realestate" 'realestate.*' "$(calls)"
expect_not_contains "apply: không build bằng --no-build" "--no-build" "$(calls)"
expect_not_contains "mật khẩu root không lên dòng lệnh docker" "$SECRET" "$(calls)"
expect_not_contains "mật khẩu root không có trong đầu ra" "$SECRET" "$OUT"
expect_contains "apply: mật khẩu chỉ qua biến env TRONG container" 'printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD"' "$(calls)"
expect_not_contains "apply: không dùng docker compose down" " down" "$(calls)"

echo "== 9) --apply --yes --use-image-tag =="
mk
run_r --latest --apply --yes --use-image-tag
expect_rc "apply use-image-tag" 0 "$RC"
expect_contains "use-image-tag: gắn lại thẻ" "docker tag realestate-backend:pre-$TS realestate-backend:latest" "$(calls)"
expect_contains "use-image-tag: up --no-build" "up -d --no-build --no-deps backend" "$(calls)"
expect_not_contains "use-image-tag: không build lại" " up -d --build" "$(calls)"
expect_eq "use-image-tag: code vẫn về commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"

echo "== 10) --db-only và --code-only =="
mk
run_r --latest --apply --yes --db-only
expect_rc "apply db-only" 0 "$RC"
expect_eq "db-only: code KHÔNG đổi" "$NEW" "$(git -C "$W" rev-parse HEAD)"
expect_eq "db-only: version app KHÔNG đổi" "1.0.5" "$(pkg_version)"
expect_eq "db-only: không tạo tag pre-restore" "" "$(git -C "$W" tag | grep '^pre-restore-' || true)"
expect_contains "db-only: có nạp DB" "#RESTORE" "$(calls)"
expect_not_contains "db-only: không build" "--build" "$(calls)"
expect_contains "db-only: bật lại backend" "up -d --no-build --no-deps backend" "$(calls)"
expect_not_contains "db-only: không kiểm commit" "[KHỚP] commit code" "$OUT"
mk
run_r --latest --apply --yes --code-only
expect_rc "apply code-only" 0 "$RC"
expect_eq "code-only: code về commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"
expect_not_contains "code-only: KHÔNG đụng DB (không xóa)" "#DROP" "$(calls)"
expect_not_contains "code-only: KHÔNG đụng DB (không nạp)" "#RESTORE" "$(calls)"
expect_not_contains "code-only: không mongodump an toàn" "mongodump" "$(calls)"
expect_eq "code-only: không có backup an toàn DB" "0" "$(cd "$W/backups" && ls restore-safety-* 2>/dev/null | wc -l | tr -d ' ')"
expect_contains "code-only: tag an toàn code" "pre-restore-" "$(git -C "$W" tag)"

echo "== 11) Cảnh báo ĐỎ một chiều (deploy đã qua bước 90) =="
mk; mf "deploy-pre-$TS.manifest" "POST_UP_REACHED=1"
run_r --latest
expect_rc "dry-run một chiều" 0 "$RC"
expect_contains "cảnh báo một chiều" "CẢNH BÁO MỘT CHIỀU" "$OUT"
expect_contains "cảnh báo: migration 011" "011" "$OUT"
expect_contains "cảnh báo: mất dữ liệu sau backup" "SẼ MẤT" "$OUT"
run_r --latest --apply
expect_rc "một chiều: vẫn cần --yes" 2 "$RC"
run_r --latest --code-only
expect_contains "code-only trên deploy một chiều: cảnh báo riêng" "--code-only trên deploy đã qua bước 90" "$OUT"

echo "== 12) Lỗi giữa chừng: in hướng dẫn, KHÔNG tự rollback =="
mk; EXTRA_ENV=(STUB_RESTORE_RC=1)
run_r --latest --apply --yes
expect_nonzero "mongorestore lỗi" "$RC"
expect_contains "lỗi giữa chừng: hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
expect_contains "lỗi giữa chừng: không tự rollback" "KHÔNG tự rollback" "$OUT"
expect_contains "lỗi giữa chừng: nêu backup an toàn" "restore-safety-" "$OUT"
expect_not_contains "lỗi giữa chừng: không up sau khi lỗi" " up -d" "$(calls)"
expect_eq "lỗi ở bước DB: code chưa bị đụng" "$NEW" "$(git -C "$W" rev-parse HEAD)"
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_DUMP_RC=1)
run_r --latest --apply --yes
expect_nonzero "dump an toàn lỗi" "$RC"
expect_contains "dump an toàn lỗi: backend đã dừng TRƯỚC khi dump" "stop backend" "$(calls)"
expect_lt "dump an toàn lỗi: dừng backend < dump" "$(line_of 'stop backend')" "$(line_of 'mongodump')"
expect_not_contains "dump an toàn lỗi: không xóa DB" "#DROP" "$(calls)"
expect_not_contains "dump an toàn lỗi: không nạp DB" "#RESTORE" "$(calls)"
expect_contains "dump an toàn lỗi: BẬT LẠI backend" "up -d --no-build --no-deps backend" "$(calls)"
expect_lt "dump an toàn lỗi: bật lại backend sau dump lỗi" "$(line_of 'mongodump')" "$(line_of 'up -d --no-build --no-deps backend')"
expect_contains "dump an toàn lỗi: báo dữ liệu chưa đổi" "CHƯA bị đổi" "$OUT"
expect_not_contains "dump an toàn lỗi: KHÔNG in hướng dẫn 'dừng giữa chừng'" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
expect_eq "dump an toàn lỗi: không để lại .partial" "0" "$(cd "$W/backups" && ls *.partial 2>/dev/null | wc -l | tr -d ' ')"
expect_eq "dump an toàn lỗi: không tạo tag pre-restore" "" "$(git -C "$W" tag | grep '^pre-restore-' || true)"
expect_eq "dump an toàn lỗi: code chưa đụng" "$NEW" "$(git -C "$W" rev-parse HEAD)"
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_SYSTEM_VERSION=999)
run_r --latest --apply --yes
expect_nonzero "version DB lệch" "$RC"; expect_contains "version DB lệch: báo" "[LỆCH] version DB" "$OUT"
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_FAIL_UP=1)
run_r --latest --apply --yes
expect_nonzero "up lỗi" "$RC"; expect_contains "up lỗi: hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
EXTRA_ENV=()

echo "== 13) Commit đã mất khỏi repo: nạp lại từ bundle =="
mk
B="$TMP/b$N"
git clone -q "$W" "$B" 2>/dev/null
( cd "$B" && printf '{\n  "version": "1.0.3"\n}\n' > RealEstateBackendApp/package.json && git commit -qam "X (chỉ có trong bundle)" )
X="$(git -C "$B" rev-parse HEAD)"
git -C "$B" bundle create "$W/backups/deploy-code-pre-$TS.bundle" hotfix-9 >/dev/null 2>&1
mf "deploy-pre-$TS.manifest" "OLD_COMMIT=$X" "APP_VERSION_OLD=1.0.3"
git -C "$W" cat-file -e "${X}^{commit}" 2>/dev/null && fail "tiền đề: repo W không được có commit X" || ok
run_r --latest --apply --yes
expect_rc "apply nạp từ bundle" 0 "$RC"
expect_contains "nạp từ bundle: báo" "nạp lại từ bundle" "$OUT"
expect_eq "nạp từ bundle: HEAD = commit trong bundle" "$X" "$(git -C "$W" rev-parse HEAD)"
expect_eq "nạp từ bundle: version" "1.0.3" "$(pkg_version)"

echo "== 14) Đang ở nhánh khác / nhánh đích đã bị xóa =="
mk
git -C "$W" switch -q -c other
write_pkg 9.9.9; git -C "$W" commit -qam "other"
OTHER_TIP="$(git -C "$W" rev-parse HEAD)"
run_r --latest --apply --yes
expect_rc "apply từ nhánh khác" 0 "$RC"
expect_eq "từ nhánh khác: về nhánh của manifest" "hotfix-9" "$(git -C "$W" rev-parse --abbrev-ref HEAD)"
expect_eq "từ nhánh khác: về commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"
expect_eq "từ nhánh khác: đầu nhánh hotfix-9 cũ được giữ bằng tag" "$NEW" "$(git -C "$W" rev-parse "$(git -C "$W" tag | grep 'branch-tip' | head -n 1)^{commit}")"
expect_eq "từ nhánh khác: nhánh other còn nguyên" "$OTHER_TIP" "$(git -C "$W" rev-parse other)"
mk
git -C "$W" switch -q -c other
git -C "$W" branch -q -D hotfix-9
run_r --latest --apply --yes
expect_rc "apply khi nhánh đã bị xóa" 0 "$RC"; expect_contains "nhánh bị xóa: tạo lại" "tạo lại tại" "$OUT"
expect_eq "nhánh bị xóa: HEAD = commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"
expect_eq "nhánh bị xóa: nhánh được tạo lại" "hotfix-9" "$(git -C "$W" rev-parse --abbrev-ref HEAD)"

echo "== 15) HEAD detached (manifest DETACHED=1, không có nhánh) =="
mk; mf "deploy-pre-$TS.manifest" "BRANCH=" "DETACHED=1" "CODE_BUNDLE_REF=HEAD"
run_r --latest --apply --yes
expect_rc "apply detached" 0 "$RC"
expect_eq "detached: HEAD = commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"
expect_eq "detached: không còn trên nhánh" "HEAD" "$(git -C "$W" rev-parse --abbrev-ref HEAD)"

echo "== 16) Cổng nhánh/DETACHED, tên nhánh/ref ngoài quy tắc (B11, B14) =="
mk; mf "deploy-pre-$TS.manifest" "BRANCH=hotfix-9" "DETACHED=1" "CODE_BUNDLE_REF=HEAD"
run_r --latest --apply --yes
expect_rc "DETACHED=1 kèm BRANCH: apply" 0 "$RC"
expect_eq "DETACHED=1 thắng BRANCH: HEAD detached" "HEAD" "$(git -C "$W" rev-parse --abbrev-ref HEAD)"
expect_eq "DETACHED=1 thắng BRANCH: HEAD = commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"
expect_eq "DETACHED=1 thắng BRANCH: nhánh hotfix-9 KHÔNG bị reset" "$NEW" "$(git -C "$W" rev-parse refs/heads/hotfix-9)"
for badbr in 'x;rm -rf y' '-evil' 'a..b' 'a//b' 'x.lock' '/abs' 'end/' 'sp ace'; do
  mk; mf "deploy-pre-$TS.manifest" "BRANCH=$badbr"
  S0="$(snap)"; run_r --latest --apply --yes
  expect_nonzero "tên nhánh '$badbr' bị từ chối" "$RC"; expect_contains "tên nhánh '$badbr': báo" "tên nhánh" "$OUT"
  expect_eq "tên nhánh '$badbr': không gọi docker đổi gì" "0" "$(mutating_calls)"
  expect_eq "tên nhánh '$badbr': không đổi gì" "$S0" "$(snap)"
done
mk; mf "deploy-pre-$TS.manifest" "CODE_BUNDLE_REF=refs/heads/a..b"
run_r --latest
expect_nonzero "CODE_BUNDLE_REF chứa '..' bị từ chối" "$RC"; expect_contains "CODE_BUNDLE_REF '..': báo" "CODE_BUNDLE_REF không hợp lệ" "$OUT"
mk; mf "deploy-pre-$TS.manifest" "CODE_BUNDLE_REF=refs/tags/x"
run_r --latest
expect_nonzero "CODE_BUNDLE_REF ngoài refs/heads bị từ chối" "$RC"

echo "== 17) Tín hiệu SIGTERM/SIGHUP (B2): on_exit nhận mã khác 0 =="
# TERM ngay sau `compose stop backend`: đang ở SAFE_PHASE (DB/code chưa đổi) -> bật lại backend, không in hướng dẫn "dừng giữa chừng"
mk; EXTRA_ENV=("STUB_SIGNAL_ON=stop backend=TERM")
run_r --latest --apply --yes
expect_rc "SIGTERM giữa SAFE_PHASE: mã 143" 143 "$RC"
expect_contains "SIGTERM: bật lại backend" "up -d --no-build --no-deps backend" "$(calls)"
expect_contains "SIGTERM: báo dữ liệu chưa đổi" "CHƯA bị đổi" "$OUT"
expect_not_contains "SIGTERM giữa SAFE_PHASE: không xóa DB" "#DROP" "$(calls)"
expect_not_contains "SIGTERM giữa SAFE_PHASE: không mongodump (script dừng ngay)" "mongodump" "$(calls)"
expect_eq "SIGTERM giữa SAFE_PHASE: code chưa đổi" "$NEW" "$(git -C "$W" rev-parse HEAD)"
EXTRA_ENV=()
# HUP khi đang `up --build` (bước 6, đã đổi DB+code): in hướng dẫn, mã 129
mk; EXTRA_ENV=("STUB_SIGNAL_ON=up -d --build=HUP")
run_r --latest --apply --yes
expect_rc "SIGHUP giữa chừng: mã 129" 129 "$RC"
expect_contains "SIGHUP giữa chừng: hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
expect_not_contains "SIGHUP: không chạy tiếp (không có bước kiểm sau)" "Kiểm sau khôi phục" "$OUT"
EXTRA_ENV=()
# TERM khi đang `up --build`
mk; EXTRA_ENV=("STUB_SIGNAL_ON=up -d --build=TERM")
run_r --latest --apply --yes
expect_rc "SIGTERM giữa chừng: mã 143" 143 "$RC"; expect_contains "SIGTERM giữa chừng: hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
EXTRA_ENV=()
# trap có đủ ba tín hiệu (INT không test động được: tiến trình nền bị bỏ qua SIGINT từ lúc khởi động nên không đặt trap được)
RT="$(cat "$ROOT_DIR/scripts/restore.sh")"
expect_contains "restore.sh: trap TERM" "trap 'exit 143' TERM" "$RT"
expect_contains "restore.sh: trap INT" "trap 'exit 130' INT" "$RT"
expect_contains "restore.sh: trap HUP" "trap 'exit 129' HUP" "$RT"

echo "== 18) Chạy lại sau mongorestore bị ngắt: --skip-safety-db (B4) =="
mk; EXTRA_ENV=(STUB_RESTORE_RC=1)
run_r --latest --apply --yes
expect_nonzero "mongorestore lỗi (lần 1)" "$RC"
expect_contains "lần 1: hướng dẫn nhắc --skip-safety-db" "--skip-safety-db" "$OUT"
EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)   # DB dở dang: không còn users nhưng còn dữ liệu khác
run_r --latest --apply --yes
expect_nonzero "chạy lại KHÔNG cờ: dump an toàn từ chối DB dở dang" "$RC"
expect_contains "chạy lại không cờ: báo thiếu users" "không có collection users nhưng có dữ liệu" "$OUT"
expect_contains "chạy lại không cờ: backend được bật lại (dữ liệu chưa đổi lần này)" "up -d --no-build --no-deps backend" "$(calls)"
expect_not_contains "chạy lại không cờ: không xóa DB" "#DROP" "$(calls)"
run_r --latest --apply --yes --skip-safety-db
expect_rc "chạy lại với --skip-safety-db" 0 "$RC"
expect_not_contains "--skip-safety-db: KHÔNG mongodump" "mongodump" "$(calls)"
expect_contains "--skip-safety-db: in backup an toàn đã có" "backup an toàn có sẵn" "$OUT"
expect_contains "--skip-safety-db: in tag an toàn đã có" "tag git an toàn có sẵn" "$OUT"
expect_contains "--skip-safety-db: có nạp DB" "#RESTORE" "$(calls)"
expect_eq "--skip-safety-db: code về commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"
expect_eq "--skip-safety-db: vẫn chỉ MỘT backup an toàn (không dump mới)" "1" "$(cd "$W/backups" && ls restore-safety-*.archive.gz | wc -l | tr -d ' ')"
EXTRA_ENV=()
mk
run_r --latest --apply --skip-safety-db
expect_rc "--skip-safety-db vẫn cần --yes" 2 "$RC"
run_r --latest --apply --yes --skip-safety-db
expect_nonzero "--skip-safety-db khi chưa từng có backup an toàn: từ chối" "$RC"; expect_contains "chưa có backup an toàn: báo" "chưa có" "$OUT"
expect_eq "--skip-safety-db không có backup: không đổi gì" "0" "$(mutating_calls)"
run_r --latest --code-only --skip-safety-db
expect_rc "--skip-safety-db + --code-only" 2 "$RC"
run_r --list --skip-safety-db
expect_rc "--list + --skip-safety-db" 2 "$RC"

echo "== 19) Dừng backend / dump TRƯỚC khi đổi dữ liệu: lỗi thì bật lại backend (B5) =="
mk; EXTRA_ENV=(STUB_FAIL_STOP=1)
run_r --latest --apply --yes
expect_nonzero "compose stop backend lỗi" "$RC"
expect_contains "stop lỗi: thử bật lại backend" "up -d --no-build --no-deps backend" "$(calls)"
expect_not_contains "stop lỗi: không dump" "mongodump" "$(calls)"
expect_not_contains "stop lỗi: không xóa DB" "#DROP" "$(calls)"
expect_not_contains "stop lỗi: không in 'dừng giữa chừng'" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
expect_eq "stop lỗi: code chưa đổi" "$NEW" "$(git -C "$W" rev-parse HEAD)"
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)
run_r --latest --apply --yes
expect_nonzero "DB hiện tại không có users nhưng có dữ liệu" "$RC"
expect_contains "không backup an toàn được: bật lại backend" "up -d --no-build --no-deps backend" "$(calls)"
expect_not_contains "không backup an toàn được: không xóa DB" "#DROP" "$(calls)"
EXTRA_ENV=()

echo "== 20) --latest bỏ qua manifest không có backup Mongo; --list đánh dấu (B7) =="
mk
MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest" "MONGO_BACKUP_FILE="
cp "$W/backups/deploy-code-pre-$TS.bundle" "$W/backups/deploy-code-pre-20260102-080000.bundle"
run_r --latest
expect_rc "--latest bỏ qua bản mới nhất không có backup Mongo" 0 "$RC"
expect_contains "--latest: cảnh báo bỏ qua" "bỏ qua deploy-pre-20260102-080000.manifest" "$OUT"
expect_contains "--latest: dùng bản cũ hơn có backup" "--latest: dùng deploy-pre-$TS.manifest" "$OUT"
run_r --latest --code-only
expect_rc "--latest --code-only: lấy bản mới nhất" 0 "$RC"; expect_contains "--code-only: dùng bản mới nhất" "--latest: dùng deploy-pre-20260102-080000.manifest" "$OUT"
expect_not_contains "--code-only: không cảnh báo bỏ qua" "bỏ qua deploy-pre" "$OUT"
run_r --list
expect_contains "--list: đánh dấu bản không có backup Mongo" "KHÔNG CÓ" "$OUT"
rm -f "$W/backups/deploy-pre-$TS.manifest"
run_r --latest
expect_nonzero "mọi manifest đều không có backup Mongo" "$RC"; expect_contains "không còn bản có backup: báo" "Không manifest nào" "$OUT"

echo "== 21) Chạy từ bản sao ngoài repo: RESTORE_REPO_DIR (B8) =="
mk
RT_DIR="$TMP/rt$N"; mkdir -p "$RT_DIR/scripts"
cp "$ROOT_DIR/scripts/restore.sh" "$RT_DIR/scripts/restore.sh"; cp -r "$ROOT_DIR/scripts/lib" "$RT_DIR/scripts/lib"
: > "$CALLS"; rm -f "$CALLS.sig"
OUT="$(cd "$TMP" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" RESTORE_REPO_DIR="$W" bash "$RT_DIR/scripts/restore.sh" --latest 2>&1)"; RC=$?
expect_rc "bản sao + RESTORE_REPO_DIR: dry-run" 0 "$RC"; expect_contains "bản sao: dry-run đạt" "DRY-RUN: mọi kiểm ĐẠT" "$OUT"
OUT="$(cd "$TMP" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" RESTORE_REPO_DIR="$W" bash "$RT_DIR/scripts/restore.sh" --latest --apply --yes 2>&1)"; RC=$?
expect_rc "bản sao + RESTORE_REPO_DIR: apply" 0 "$RC"
expect_eq "bản sao: code của REPO về commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"
expect_eq "bản sao: bản sao ngoài repo không bị đụng" "yes" "$([[ -f "$RT_DIR/scripts/restore.sh" ]] && echo yes || echo no)"
OUT="$(cd "$TMP" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" RESTORE_REPO_DIR="$TMP/khong-co-thu-muc" bash "$RT_DIR/scripts/restore.sh" --latest 2>&1)"; RC=$?
expect_nonzero "RESTORE_REPO_DIR sai thư mục" "$RC"; expect_contains "RESTORE_REPO_DIR sai: báo" "không phải thư mục" "$OUT"
rm -rf "$RT_DIR/scripts/lib"
OUT="$(cd "$TMP" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" RESTORE_REPO_DIR="$W" bash "$RT_DIR/scripts/restore.sh" --latest 2>&1)"; RC=$?
expect_nonzero "bản sao thiếu lib/" "$RC"; expect_contains "bản sao thiếu lib/: báo" "lib/" "$OUT"

echo "== 22) Nạp commit từ bundle TRƯỚC mọi bước phá hủy (B9) =="
mk
B="$TMP/b$N"
git clone -q "$W" "$B" 2>/dev/null
( cd "$B" && printf '{\n  "version": "1.0.3"\n}\n' > RealEstateBackendApp/package.json && git commit -qam "X (chỉ có trong bundle)" )
X="$(git -C "$B" rev-parse HEAD)"
git -C "$B" bundle create "$W/backups/deploy-code-pre-$TS.bundle" hotfix-9 >/dev/null 2>&1
mf "deploy-pre-$TS.manifest" "OLD_COMMIT=$X" "APP_VERSION_OLD=1.0.3" "CODE_BUNDLE_REF=refs/heads/khong-co-nhanh-nay"   # ref không có trong bundle: fetch sẽ lỗi
S0="$(snap)"
run_r --latest
expect_contains "dry-run: commit chưa có trong repo -> chỉ cảnh báo (không fetch)" "chưa có trong repo" "$OUT"
expect_eq "dry-run: không ghi gì vào repo (không fetch)" "$S0" "$(snap)"
git -C "$W" cat-file -e "${X}^{commit}" 2>/dev/null && fail "dry-run không được nạp commit từ bundle" || ok
run_r --latest --apply --yes
expect_nonzero "git fetch từ bundle lỗi" "$RC"; expect_contains "fetch lỗi: báo" "git fetch từ bundle thất bại" "$OUT"
expect_contains "fetch lỗi: nói rõ chưa đổi gì" "Chưa đổi gì" "$OUT"
expect_eq "fetch lỗi: không có lệnh đổi trạng thái (không dừng backend/dump/xóa DB)" "0" "$(mutating_calls)"
expect_eq "fetch lỗi: không đổi gì" "$S0" "$(snap)"
expect_not_contains "fetch lỗi: không in 'dừng giữa chừng'" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"

echo "== 23) Đổi file hạ tầng / đè file untracked: DỪNG trước khi đổi gì (B6, B12) =="
mk
printf 'services: {}\n# sửa sau deploy\n' > "$W/docker-compose.yml"; git -C "$W" commit -qam "C3 sửa docker-compose"
printf 'FROM node\n' > "$W/RealEstateBackendApp/Dockerfile"; git -C "$W" add -A; git -C "$W" commit -qm "C4 thêm Dockerfile"
S0="$(snap)"
run_r --latest
expect_rc "hạ tầng đổi: dry-run thoát 1" 1 "$RC"; expect_contains "hạ tầng đổi: [HỎNG]" "ĐỔI file hạ tầng" "$OUT"
expect_contains "hạ tầng đổi: liệt kê docker-compose.yml" "docker-compose.yml" "$OUT"
expect_contains "hạ tầng đổi: liệt kê Dockerfile lồng thư mục con" "RealEstateBackendApp/Dockerfile" "$OUT"
expect_contains "hạ tầng đổi: gợi ý cờ" "--allow-infra-change" "$OUT"
expect_eq "hạ tầng đổi: dry-run không đổi gì" "$S0" "$(snap)"
run_r --latest --apply --yes
expect_nonzero "hạ tầng đổi: apply dừng" "$RC"; expect_eq "hạ tầng đổi: apply không đổi trạng thái" "0" "$(mutating_calls)"
expect_eq "hạ tầng đổi: apply không đổi gì" "$S0" "$(snap)"
run_r --latest --db-only
expect_rc "--db-only không bị chặn bởi hạ tầng (không đụng code)" 0 "$RC"
run_r --latest --allow-infra-change
expect_rc "--allow-infra-change: dry-run đạt" 0 "$RC"; expect_contains "--allow-infra-change: vẫn cảnh báo" "đã cho phép bằng --allow-infra-change" "$OUT"
run_r --latest --db-only --allow-infra-change
expect_rc "--db-only + --allow-infra-change" 2 "$RC"
run_r --latest --apply --yes --allow-infra-change
expect_rc "--allow-infra-change: apply chạy" 0 "$RC"; expect_eq "--allow-infra-change: code về commit cũ" "$OLD" "$(git -C "$W" rev-parse HEAD)"
# file untracked sẽ bị git reset --hard ghi đè
mk
git -C "$W" rm -q --cached RealEstateBackendApp/package.json; git -C "$W" commit -qm "C3 bỏ theo dõi package.json"
S0="$(snap)"
run_r --latest
expect_rc "untracked bị đè: dry-run thoát 1" 1 "$RC"; expect_contains "untracked bị đè: [HỎNG]" "GHI ĐÈ" "$OUT"
expect_contains "untracked bị đè: nêu file" "RealEstateBackendApp/package.json" "$OUT"
run_r --latest --apply --yes
expect_nonzero "untracked bị đè: apply dừng" "$RC"; expect_eq "untracked bị đè: không đổi trạng thái" "0" "$(mutating_calls)"
expect_eq "untracked bị đè: file còn nguyên" "1.0.5" "$(pkg_version)"
# commit đích chưa có trong repo: apply kiểm lại SAU khi nạp từ bundle (trước mọi bước phá hủy)
mk
B="$TMP/b$N"; git clone -q "$W" "$B" 2>/dev/null
( cd "$B" && printf 'x\n' > RealEstateBackendApp/extra.txt && git add -A && git commit -qm "X thêm extra.txt (chỉ có trong bundle)" )
X="$(git -C "$B" rev-parse HEAD)"
git -C "$B" bundle create "$W/backups/deploy-code-pre-$TS.bundle" hotfix-9 >/dev/null 2>&1
mf "deploy-pre-$TS.manifest" "OLD_COMMIT=$X"
printf 'cua toi\n' > "$W/RealEstateBackendApp/extra.txt"   # untracked trùng đường dẫn với file của commit X
run_r --latest --apply --yes
expect_nonzero "untracked bị đè (commit nạp từ bundle): apply dừng" "$RC"
expect_contains "kiểm lại sau khi nạp bundle: [HỎNG]" "GHI ĐÈ" "$OUT"
expect_eq "kiểm lại sau khi nạp bundle: không đổi trạng thái" "0" "$(mutating_calls)"
expect_eq "kiểm lại sau khi nạp bundle: file untracked còn nguyên" "cua toi" "$(cat "$W/RealEstateBackendApp/extra.txt")"

echo "== 24) Các lỗi giữa chừng còn lại (liveness quá hạn, xóa DB lỗi, lệch commit/version, không có version DB) =="
mk; EXTRA_ENV=(STUB_CURL_RC=1 HEALTH_TIMEOUT=1)
run_r --latest --apply --yes
expect_nonzero "liveness quá hạn" "$RC"; expect_contains "liveness quá hạn: báo" "không trả liveness" "$OUT"
expect_contains "liveness quá hạn: hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
expect_eq "liveness quá hạn: code đã về commit cũ (restore đã chạy tới bước chờ)" "$OLD" "$(git -C "$W" rev-parse HEAD)"
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_FAIL_DROP=1)
run_r --latest --apply --yes
expect_nonzero "mongosh dropDatabase lỗi" "$RC"; expect_contains "xóa DB lỗi: báo" "Không xóa được DB realestate" "$OUT"
expect_contains "xóa DB lỗi: hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
expect_not_contains "xóa DB lỗi: không mongorestore" "#RESTORE" "$(calls)"
expect_eq "xóa DB lỗi: code chưa đụng" "$NEW" "$(git -C "$W" rev-parse HEAD)"
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_COMMIT_DRIFT=1)
run_r --latest --apply --yes
expect_nonzero "lệch commit sau khôi phục" "$RC"; expect_contains "lệch commit: [LỆCH]" "[LỆCH] commit code" "$OUT"
expect_not_contains "lệch commit: không in 'dừng giữa chừng' (đã chạy hết các bước)" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
EXTRA_ENV=()
mk; mf "deploy-pre-$TS.manifest" "APP_VERSION_OLD=9.9.9"
run_r --latest --apply --yes
expect_nonzero "lệch version app sau khôi phục" "$RC"; expect_contains "lệch version app: [LỆCH]" "[LỆCH] version app" "$OUT"
mk; mf "deploy-pre-$TS.manifest" "DB_VERSION_READ=0" "DB_VERSION_BEFORE="
run_r --latest --apply --yes
expect_rc "DB_VERSION_READ=0: apply vẫn đạt" 0 "$RC"
expect_contains "DB_VERSION_READ=0: bỏ qua so khớp version DB" "[BỎ QUA] version DB" "$OUT"
expect_not_contains "DB_VERSION_READ=0: không đọc system.version" "#SYSVER" "$(calls)"

echo "== 25) on_exit chịu được stderr đã chết + set -e: backend VẪN được bật lại (M1) =="
# run_closed: như run_r nhưng làm mọi ghi ra stderr của restore.sh THẤT BẠI (`2>/dev/full`, giống SSH rớt giữa chừng). Chỉ stdout được thu.
# Có stub `flock` (luôn thành công) để máy không có flock (Git Bash/Windows) không in cảnh báo ra stderr rồi chết sớm TRƯỚC giai đoạn an toàn.
mkdir -p "$TMP/stubflock"; printf '#!/usr/bin/env bash
exit 0
' > "$TMP/stubflock/flock"; chmod +x "$TMP/stubflock/flock"
run_closed() {
  : > "$CALLS"; rm -f "$CALLS.sig"
  OUT="$(cd "$W" && env PATH="$TMP/stubflock:$STUB:$PATH" STUB_CALLS="$CALLS" DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" \
    "${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}" bash "$W/scripts/restore.sh" "$@" 2>/dev/full)"
  RC=$?
}
# (a) dump an toàn lỗi: die() in ra stderr đã đóng (printf lỗi) rồi thoát; on_exit vẫn phải bật lại backend
mk; EXTRA_ENV=(STUB_DUMP_RC=1)
run_closed --latest --apply --yes
expect_nonzero "stderr hỏng + dump lỗi: thoát khác 0" "$RC"
expect_contains "stderr hỏng + dump lỗi: backend VẪN được bật lại" "up -d --no-build --no-deps backend" "$(calls)"
expect_not_contains "stderr hỏng + dump lỗi: không xóa DB" "#DROP" "$(calls)"
# (b) bị TERM ngay sau `compose stop backend` khi stderr đã đóng
mk; EXTRA_ENV=("STUB_SIGNAL_ON=stop backend=TERM")
run_closed --latest --apply --yes
expect_rc "stderr hỏng + SIGTERM: mã 143" 143 "$RC"
expect_contains "stderr hỏng + SIGTERM: backend VẪN được bật lại" "up -d --no-build --no-deps backend" "$(calls)"
expect_lt "stderr hỏng + SIGTERM: stop < bật lại" "$(line_of 'stop backend')" "$(line_of 'up -d --no-build --no-deps backend')"
# (c) bật lại backend chạy TRƯỚC các lệnh in (kiểm tĩnh trên on_exit thật)
OE="$(sed -n '/^on_exit() {/,/^}/p' "$ROOT_DIR/scripts/restore.sh")"
L_SET="$(grep -n 'set +e' <<<"$OE" | head -n 1 | cut -d: -f1)"
L_UP="$(grep -n 'compose up -d --no-build --no-deps backend' <<<"$OE" | head -n 1 | cut -d: -f1)"
L_RED="$(grep -n 'red "' <<<"$OE" | head -n 1 | cut -d: -f1)"
expect_lt "on_exit: set +e ở đầu, trước khi bật lại backend" "$L_SET" "$L_UP"
expect_lt "on_exit: bật lại backend TRƯỚC lệnh in đầu tiên" "$L_UP" "$L_RED"
expect_contains "on_exit: lệnh bật lại không dùng >&2 (fd có thể đã đóng)" ">/dev/null 2>&1" "$(grep 'compose up -d --no-build --no-deps backend' <<<"$OE" | head -n 1)"
EXTRA_ENV=()

echo "== 26) --skip-safety-db: chốt chặn chặt (M2) =="
SAFE_OLD="restore-safety-20260101-120500.archive.gz"; SAFE_NEW="restore-safety-20260101-130000.archive.gz"
good_gz() { printf 'dump' | gzip > "$W/backups/$1"; }
# (a) file an toàn mới nhất RỖNG
mk; good_gz "$SAFE_OLD"; : > "$W/backups/$SAFE_NEW"; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)
S0="$(snap)"; run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: file mới nhất rỗng bị từ chối" "$RC"; expect_contains "skip-safety rỗng: báo rỗng/hỏng" "rỗng/hỏng" "$OUT"
expect_eq "skip-safety rỗng: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"; expect_eq "skip-safety rỗng: không đổi gì" "$S0" "$(snap)"
# (b) file an toàn mới nhất HỎNG (không phải gzip)
mk; good_gz "$SAFE_OLD"; printf 'khong-phai-gzip' > "$W/backups/$SAFE_NEW"; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)
run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: file mới nhất hỏng bị từ chối" "$RC"; expect_contains "skip-safety hỏng: báo" "rỗng/hỏng" "$OUT"
expect_eq "skip-safety hỏng: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"
# (c) gzip hợp lệ nhưng KHÔNG phải dump DB realestate (dryRun không thấy users)
mk; good_gz "$SAFE_NEW"; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders STUB_DRYRUN_USERS=0)
run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: file không có realestate.users bị từ chối" "$RC"; expect_eq "skip-safety không users: không đổi gì" "0" "$(mutating_calls)"
# (d) chỉ xét file MỚI NHẤT: cũ hợp lệ + mới rỗng => từ chối (đã làm ở (a)); cũ rỗng + mới hợp lệ => chấp nhận
mk; : > "$W/backups/$SAFE_OLD"; good_gz "$SAFE_NEW"; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)
run_r --latest --apply --yes --skip-safety-db
expect_rc "skip-safety: cũ rỗng + mới hợp lệ => chấp nhận" 0 "$RC"
# (e) DB KHỎE (có users) + file an toàn hợp lệ => TỪ CHỐI, nêu lý do
mk; good_gz "$SAFE_NEW"; EXTRA_ENV=()
S0="$(snap)"; run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: DB khỏe bị từ chối" "$RC"; expect_contains "skip-safety DB khỏe: lý do" "KHỎE" "$OUT"
expect_eq "skip-safety DB khỏe: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"; expect_eq "skip-safety DB khỏe: không đổi gì" "$S0" "$(snap)"
run_r --latest --skip-safety-db
expect_rc "skip-safety DB khỏe: dry-run cũng thoát 1" 1 "$RC"; expect_contains "skip-safety DB khỏe (dry-run): [HỎNG]" "TỪ CHỐI" "$OUT"
# (f) DB trống (không users, không dữ liệu) => từ chối (không cần cờ)
mk; good_gz "$SAFE_NEW"; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=)
run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: DB trống bị từ chối" "$RC"; expect_contains "skip-safety DB trống: lý do" "chưa có dữ liệu nghiệp vụ" "$OUT"
# (g) DB dở dang + file hợp lệ => chấp nhận (dry-run lẫn apply)
mk; good_gz "$SAFE_NEW"; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)
run_r --latest --skip-safety-db
expect_rc "skip-safety: DB dở dang + file hợp lệ: dry-run đạt" 0 "$RC"; expect_contains "skip-safety dở dang: [ĐẠT]" "DB hiện tại dở dang" "$OUT"
run_r --latest --apply --yes --skip-safety-db
expect_rc "skip-safety: DB dở dang + file hợp lệ: apply" 0 "$RC"; expect_not_contains "skip-safety: không mongodump" "mongodump" "$(calls)"
EXTRA_ENV=()
# (h) Mongo không chạy => không kiểm được => từ chối
mk; good_gz "$SAFE_NEW"; EXTRA_ENV=(STUB_MONGO_STATE=exited)
run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: mongo không chạy bị từ chối" "$RC"; expect_eq "skip-safety mongo tắt: không đổi gì" "0" "$(mutating_calls)"
EXTRA_ENV=()

echo "== 27) Cảnh báo 'code nằm lùi so với upstream' + một chiều có --yes (M3, L7) =="
mk; run_r --latest --apply --yes
expect_rc "apply thường" 0 "$RC"
expect_contains "xong: nhắc code lùi so với upstream" "LÙI so với upstream" "$OUT"
expect_contains "xong: nhắc git pull --ff-only kéo lại commit lỗi" "git pull --ff-only" "$OUT"
expect_contains "xong: nhắc dùng deploy.sh --no-pull" "bash deploy.sh --no-pull" "$OUT"
mk; run_r --latest --apply --yes --db-only
expect_rc "apply --db-only" 0 "$RC"; expect_not_contains "--db-only: không đổi code nên không nhắc lùi upstream" "LÙI so với upstream" "$OUT"
mk; EXTRA_ENV=(STUB_RESTORE_RC=1); run_r --latest --apply --yes
expect_nonzero "mongorestore lỗi" "$RC"; expect_contains "dừng giữa chừng: cũng nhắc lùi upstream" "LÙI so với upstream" "$OUT"
expect_contains "dừng giữa chừng: nhắc --no-pull" "bash deploy.sh --no-pull" "$OUT"
EXTRA_ENV=()
mk; mf "deploy-pre-$TS.manifest" "POST_UP_REACHED=1"
S0="$(snap)"; run_r --latest --apply
expect_rc "một chiều: apply thiếu --yes" 2 "$RC"; expect_eq "một chiều: thiếu --yes không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"; expect_eq "một chiều: thiếu --yes không đổi gì" "$S0" "$(snap)"
run_r --latest --apply --yes
expect_rc "một chiều: apply có --yes vẫn chạy" 0 "$RC"
expect_contains "một chiều: apply in cảnh báo ĐỎ" "CẢNH BÁO MỘT CHIỀU" "$OUT"
expect_contains "một chiều: nêu mất dữ liệu sau backup" "SẼ MẤT" "$OUT"

echo "== 28) Vòng 3: --list hiện loại backup thủ công; latest_safety_file chặt tên; --skip-safety-db khi Mongo tắt; DB trống không có file an toàn =="
# (a) --list hiện BACKUP_KIND=manual (backup do scripts/backup.sh tạo); bản deploy thường không có nhãn này
mk; mf "deploy-pre-$TS.manifest" "BACKUP_KIND=manual"
MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest"
run_r --list
expect_rc "--list có BACKUP_KIND" 0 "$RC"; expect_contains "--list: nhãn backup thủ công" "backup thủ công bằng scripts/backup.sh" "$OUT"
expect_eq "--list: chỉ MỘT manifest mang nhãn thủ công" "1" "$(grep -c 'backup thủ công bằng scripts/backup.sh' <<<"$OUT")"
# (b) latest_safety_file chỉ nhận restore-safety-YYYYMMDD-HHMMSS.archive.gz: file lạ tên "lớn hơn" KHÔNG được chọn làm file an toàn mới nhất
mk; good_gz "$SAFE_NEW"; : > "$W/backups/restore-safety-zzz.archive.gz"; : > "$W/backups/restore-safety-20260101-130000.archive.gz.bak"
EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)
run_r --latest --skip-safety-db
expect_rc "safety: file lạ không đè file an toàn thật" 0 "$RC"; expect_contains "safety: dùng đúng file thật" "$SAFE_NEW" "$OUT"
expect_not_contains "safety: không chọn file lạ" "restore-safety-zzz" "$OUT"
# đối chứng đột biến: nới lại thành glob cũ thì file lạ bị chọn và ca trên phải hỏng
sed -i 's/^\( *\)\[\[ "\$b" =~ .* \]\] && last=/\1last=/' "$W/scripts/restore.sh"
run_r --latest --skip-safety-db
expect_nonzero "đối chứng: nới tên về glob cũ thì file lạ bị chọn (test bắt được)" "$RC"
# (c) --skip-safety-db khi container Mongo dừng: chính chốt trong check_skip_safety_db từ chối (thông báo riêng, khác kiểm backup chính)
mk; good_gz "$SAFE_NEW"; EXTRA_ENV=(STUB_MONGO_STATE=exited)
run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: mongo dừng" "$RC"; expect_contains "skip-safety mongo dừng: thông báo của chính chốt --skip-safety-db" "chưa kiểm được backup an toàn và tình trạng DB" "$OUT"
expect_eq "skip-safety mongo dừng: không đổi gì" "0" "$(mutating_calls)"
# đối chứng đột biến: bỏ chốt "Mongo đang chạy" của check_skip_safety_db thì thông báo trên biến mất (test bắt được)
mk; good_gz "$SAFE_NEW"; EXTRA_ENV=(STUB_MONGO_STATE=exited)
sed -i 's/^  if \[\[ "\$(mongo_state)" != "running" \]\]; then$/  if false; then/' "$W/scripts/restore.sh"
run_r --latest --apply --yes --skip-safety-db
expect_not_contains "đối chứng: bỏ chốt Mongo-chạy thì không còn thông báo riêng" "chưa kiểm được backup an toàn và tình trạng DB" "$OUT"
# (d) DB trống + không có file an toàn: thông báo "không cần thiết", không đổ lỗi "thiếu file"
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=)
run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: DB trống + không có file" "$RC"; expect_contains "DB trống + không file: nói rõ không cần thiết" "không cần thiết" "$OUT"
expect_eq "DB trống + không file: không đổi gì" "0" "$(mutating_calls)"
# (e) DB dở dang nhưng không có file an toàn: thông báo nêu tên mẫu file
mk; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)
run_r --latest --apply --yes --skip-safety-db
expect_nonzero "skip-safety: DB dở dang + không file" "$RC"; expect_contains "không file: nêu tên mẫu" "restore-safety-YYYYMMDD-HHMMSS.archive.gz" "$OUT"
EXTRA_ENV=()

echo "== 29) QA vòng 4: --latest với bản --code-only mới hơn (M2); đường dẫn manifest thoát ra ngoài (L7); nhãn manual + ký tự điều khiển (L8) =="
ESC=$'\033'
# (M2) Hai manifest: CŨ có dump DB (deploy thường) + MỚI do `backup.sh --code-only` (MONGO_BACKUP_FILE rỗng). Chốt hành vi + cảnh báo.
mk
MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest" "MONGO_BACKUP_FILE=" "BACKUP_KIND=manual"
cp "$W/backups/deploy-code-pre-$TS.bundle" "$W/backups/deploy-code-pre-20260102-080000.bundle"
run_r --latest
expect_rc "--latest sau backup --code-only: không từ chối mà dùng bản cũ có DB" 0 "$RC"
expect_contains "--latest: cảnh báo bỏ qua bản --code-only" "bỏ qua deploy-pre-20260102-080000.manifest" "$OUT"
expect_contains "--latest: cảnh báo nói rõ sẽ về bản CŨ HƠN, không phải mới nhất" "CŨ HƠN" "$OUT"
expect_contains "--latest: chọn manifest cũ có DB" "--latest: dùng deploy-pre-$TS.manifest" "$OUT"
expect_not_contains "--latest: không chọn bản --code-only" "--latest: dùng deploy-pre-20260102-080000.manifest" "$OUT"
run_r --latest --code-only
expect_rc "--latest --code-only: dùng chính bản --code-only mới nhất" 0 "$RC"; expect_contains "--latest --code-only: manifest mới" "--latest: dùng deploy-pre-20260102-080000.manifest" "$OUT"
expect_not_contains "--latest --code-only: không cảnh báo bỏ qua" "bỏ qua deploy-pre" "$OUT"
run_r --manifest "$W/backups/deploy-pre-20260102-080000.manifest"
expect_nonzero "--manifest chính bản --code-only (khôi phục DB + code): [HỎNG] vì không có dump" "$RC"; expect_contains "bản --code-only: báo không có backup Mongo" "không có backup Mongo" "$OUT"
# --latest ưu tiên cả bản thủ công CÓ DB mới hơn bản trước deploy
mk; MF_TS=20260103-090000 mf "deploy-pre-20260103-090000.manifest" "BACKUP_KIND=manual"
cp "$W/backups/deploy-code-pre-$TS.bundle" "$W/backups/deploy-code-pre-20260103-090000.bundle"; cp "$W/backups/deploy-pre-$TS.archive.gz" "$W/backups/deploy-pre-20260103-090000.archive.gz"
run_r --latest
expect_rc "--latest ưu tiên bản thủ công mới hơn" 0 "$RC"; expect_contains "--latest: chọn bản thủ công mới hơn" "--latest: dùng deploy-pre-20260103-090000.manifest" "$OUT"

# (L7) --manifest/đường dẫn trong manifest thoát khỏi thư mục backups
mk
cp "$W/backups/deploy-pre-$TS.manifest" "$W/deploy-pre-$TS.manifest"
S0="$(snap)"; run_r --manifest "backups/../deploy-pre-$TS.manifest"
expect_nonzero "manifest backups/../x" "$RC"; expect_contains "backups/../: báo ngoài thư mục" "NGOÀI thư mục" "$OUT"; expect_eq "backups/../: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"
mkdir -p "$W/backups-evil"; cp "$W/backups/deploy-pre-$TS.manifest" "$W/backups-evil/deploy-pre-$TS.manifest"
run_r --manifest "backups-evil/deploy-pre-$TS.manifest"
expect_nonzero "manifest trong backups-evil/ (tiền tố trùng, khác thư mục)" "$RC"; expect_contains "backups-evil: báo ngoài thư mục" "NGOÀI thư mục" "$OUT"
run_r --manifest "$W/backups-evil/deploy-pre-$TS.manifest"
expect_nonzero "manifest backups-evil/ (đường dẫn tuyệt đối)" "$RC"; expect_eq "backups-evil: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"
for bad in "MONGO_BACKUP_FILE=backups-evil/deploy-pre-$TS.archive.gz" "MONGO_BACKUP_FILE=backups/../deploy-pre-$TS.archive.gz" "CODE_BUNDLE=backups-evil/deploy-code-pre-$TS.bundle" "CODE_BUNDLE=backups/../deploy-code-pre-$TS.bundle"; do
  mf "deploy-pre-$TS.manifest" "$bad"
  run_r --manifest "$W/backups/deploy-pre-$TS.manifest"
  expect_nonzero "đường dẫn trong manifest [$bad]" "$RC"; expect_contains "[$bad]: báo ngoài thư mục" "NGOÀI thư mục" "$OUT"
  expect_eq "[$bad]: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"
done
# symlink thoát ra ngoài: chỉ kiểm được khi hệ file tạo symlink THẬT (Git Bash/Windows mặc định chép file thay vì tạo symlink).
mk; mkdir -p "$TMP/outside$N"; cp "$W/backups/deploy-pre-$TS.manifest" "$TMP/outside$N/real.manifest"
if ln -s "$TMP/outside$N/real.manifest" "$W/backups/deploy-pre-20260105-100000.manifest" 2>/dev/null && [[ -L "$W/backups/deploy-pre-20260105-100000.manifest" ]]; then
  run_r --manifest "$W/backups/deploy-pre-20260105-100000.manifest"
  expect_nonzero "manifest là symlink trỏ ra ngoài" "$RC"; expect_contains "symlink: báo ngoài thư mục" "NGOÀI thư mục" "$OUT"
  mf "deploy-pre-$TS.manifest"; mv "$W/backups/deploy-pre-$TS.archive.gz" "$TMP/outside$N/a.gz"; ln -s "$TMP/outside$N/a.gz" "$W/backups/deploy-pre-$TS.archive.gz"
  run_r --manifest "$W/backups/deploy-pre-$TS.manifest"
  expect_nonzero "archive là symlink trỏ ra ngoài" "$RC"; expect_contains "archive symlink: báo ngoài thư mục" "NGOÀI thư mục" "$OUT"
else
  echo "  (bỏ qua ca symlink: hệ file này không tạo được symlink thật)"
fi

# (L8) Nhãn manual chỉ khi BACKUP_KIND đúng `manual`; ký tự điều khiển trong manifest không bao giờ ra màn hình
mk; mf "deploy-pre-$TS.manifest" "BACKUP_KIND=evil"
run_r --list
expect_rc "--list BACKUP_KIND lạ" 0 "$RC"; expect_not_contains "BACKUP_KIND lạ: không nhãn thủ công" "backup thủ công" "$OUT"; expect_not_contains "BACKUP_KIND lạ: không in lại giá trị" "evil" "$OUT"
mk; MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest"
manifest_put "$W/backups/deploy-pre-20260102-080000.manifest" "PREV_IMAGE_TAG" "realestate-backend:pre-1${ESC}[31mROOT"
MF_TS=20260103-090000 mf "deploy-pre-20260103-090000.manifest" "BACKUP_KIND=manual"
printf 'dòng sai %s[31mđịnh dạng\n' "$ESC" >> "$W/backups/deploy-pre-20260103-090000.manifest"
MF_TS=20260104-100000 mf "deploy-pre-20260104-100000.manifest" "BACKUP_KIND=manual"
run_r --list
expect_rc "--list với manifest chứa ký tự điều khiển" 0 "$RC"
[[ "$OUT" != *"$ESC"* ]] && ok || fail "--list: đầu ra KHÔNG được chứa ESC (ký tự điều khiển từ manifest)"
expect_contains "--list: manifest có ESC trong giá trị bị đánh dấu HỎNG" "MANIFEST HỎNG" "$OUT"
expect_contains "--list: manifest hợp lệ còn lại vẫn hiện" "deploy-pre-$TS.manifest" "$OUT"
expect_eq "--list: đúng 2 manifest HỎNG (ESC trong giá trị + dòng sai định dạng)" "2" "$(grep -c 'MANIFEST HỎNG' <<<"$OUT")"
expect_contains "--list: manifest manual sạch vẫn có nhãn" "deploy-pre-20260104-100000.manifest  [loại: manual" "$OUT"
run_r --manifest "$W/backups/deploy-pre-20260102-080000.manifest"
expect_nonzero "--manifest có ký tự điều khiển bị từ chối" "$RC"; [[ "$OUT" != *"$ESC"* ]] && ok || fail "--manifest: đầu ra KHÔNG được chứa ESC"
expect_eq "--manifest ESC: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"
# đối chứng đột biến: bỏ kiểm ký tự điều khiển thì ESC lọt ra màn hình (test trên bắt được)
sed -i '/\[\[ ! "\$val" =~ \[\[:cntrl:\]\] \]\]/d' "$W/scripts/restore.sh"
run_r --list
[[ "$OUT" == *"$ESC"* ]] && ok || fail "đối chứng: bỏ kiểm ký tự điều khiển mà ESC vẫn không ra => test không phân biệt được"
EXTRA_ENV=()

echo
echo "Kết quả: $PASS đạt, $FAIL hỏng."
(( FAIL == 0 ))
