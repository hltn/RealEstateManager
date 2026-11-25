#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/restore.test.sh — test shell KHÔNG cần Docker/Mongo thật cho restore.sh (v1.0.6, T-36: lùi bản bằng image, không còn git):
#   - CHẠY script THẬT (bash restore.sh ...) trong thư mục deploy TẠM (không phải git repo), với `docker`/`curl`/`flock`/`date`/`stat` giả đặt ĐẦU PATH
#   - cách dùng: không tham số, tham số lạ, cờ cũ (--code-only/--use-image-tag) bị từ chối, --apply thiếu --yes (biến môi trường không thay được --yes)
#   - --list: nội dung manifest bản 2, manifest bản 1/rác chỉ báo hỏng, không gọi Docker; manifest sai/thiếu/ngoài backups/ bị từ chối, bản 1 báo rõ
#   - DRY-RUN mặc định không đổi gì; --latest chọn bản mới nhất CÓ backup Mongo; kiểm trước hỏng (archive, image mất, thiếu image dự phòng, mongo tắt, khóa bị giữ)
#   - --apply --yes: THỨ TỰ dừng backend -> dump an toàn -> thẻ an toàn -> xóa DB -> mongorestore -> docker tag pre-<TS> current -> up -d --no-build -> kiểm sau
#   - --db-only, --skip-safety-db, lỗi giữa chừng (hướng dẫn, vùng an toàn bật lại backend), SIGTERM/SIGHUP, lệch image sau khôi phục
#   - RESTORE_REPO_DIR (chạy từ bản sao ngoài thư mục deploy), khóa chung <thư mục deploy>/.deploy.lock, kiểm tĩnh không còn git/bundle/--build, đối chứng đột biến
# Chỉ kiểm lớp shell (thứ tự, mã thoát, đối số, kiểm trước). Chạy với Mongo/Docker thật là việc diễn tập staging.
# Cần: bash >= 4, gzip, timeout.
#
# Chạy:  bash ops/tests/restore.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
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
expect_file() { if [[ -f "$2" ]]; then ok; else fail "$1: thiếu file $2"; fi; }

# SIGHUP bị bỏ qua từ lúc khởi động (vd chạy bằng nohup) thì bash không bắt được: bỏ ca SIGHUP thay vì báo hỏng giả.
HUP_OK=1; [[ "$(bash -c 'kill -HUP $$; echo survived' 2>/dev/null)" == "survived" ]] && HUP_OK=0
LOG_PREFIX="test"
# shellcheck source=ops/lib/ops-common.sh
source "$ROOT_DIR/ops/lib/ops-common.sh"

SECRET="S3cr3t-Pass-XYZ-12345"
STUB="$TMP/stub"
CALLS="$TMP/calls.log"
mkdir -p "$STUB"
RTS="20260301-090000"   # mã thời gian của LẦN RESTORE (date giả đóng băng), khác TS của manifest

# ── Stub: docker, curl, flock, date, stat (đặt ĐẦU PATH; docker thật không bao giờ chạy trong test này) ────────────────
# STUB_CALLS ghi mọi lệnh docker (một dòng/lệnh) + các thẻ #DROP/#RESTORE/#SYSVER khi mongosh/mongorestore nhận nội dung tương ứng.
# Thẻ image giả: `docker tag A B` ghi B=<id của A> vào $STUB_CALLS.tags; id mặc định của ref là sha256:id-<ref>, của container là sha256:running-<vai trò>
# (sau khi `<tên>:current` được gắn thì container "chạy" đúng image đó: mô phỏng compose up --no-build).
# Điều khiển bằng biến môi trường: STUB_MONGO_STATE, STUB_HEALTH, STUB_IMAGE_PRESENT(1/0), STUB_IMAGE_MISSING (chuỗi con ref bị mất), STUB_USERS_EXIST,
# STUB_NONEMPTY, STUB_DRYRUN_USERS(1/0), STUB_DUMP_RC, STUB_RESTORE_RC, STUB_SYSTEM_VERSION (mặc định 010), STUB_FAIL_UP, STUB_FAIL_STOP, STUB_FAIL_DROP,
# STUB_CONTAINER_MISMATCH=1 (container backend luôn "chạy" image lạ), STUB_CURL_RC, STUB_FLOCK_RC (khóa bị giữ),
# STUB_SIGNAL_ON='<chuỗi lệnh>=<TÍN HIỆU>' (lần đầu docker nhận lệnh chứa chuỗi đó, stub gửi tín hiệu cho TIẾN TRÌNH restore.sh qua $PPID: chỉ dùng cho lệnh
# `compose ...` gọi TRỰC TIẾP từ restore.sh).
cat > "$STUB/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_CALLS"
TAGS="$STUB_CALLS.tags"
idof() { # <ref>
  local r="$1" v
  if [[ "$r" == sha256:* ]]; then echo "$r"; return; fi
  v="$(sed -n "s|^$r=||p" "$TAGS" 2>/dev/null | tail -n 1)"
  echo "${v:-sha256:id-$r}"
}
if [[ -n "${STUB_SIGNAL_ON:-}" && " $* " == *"${STUB_SIGNAL_ON%%=*}"* && ! -e "$STUB_CALLS.sig" ]]; then
  : > "$STUB_CALLS.sig"; kill "-${STUB_SIGNAL_ON##*=}" "$PPID"
fi
if [[ -n "${STUB_SIGNAL2_ON:-}" && " $* " == *"${STUB_SIGNAL2_ON%%=*}"* && ! -e "$STUB_CALLS.sig2" ]]; then
  : > "$STUB_CALLS.sig2"; kill "-${STUB_SIGNAL2_ON##*=}" "$PPID"
fi
case "${1:-}" in
  compose)
    [[ "${2:-}" == "version" ]] && exit 0
    if [[ " $* " == *" up "* && "${STUB_FAIL_UP:-0}" == "1" ]]; then exit 1; fi
    if [[ " $* " == *" stop "* && "${STUB_FAIL_STOP:-0}" == "1" ]]; then exit 1; fi
    exit 0 ;;
  info) [[ "$*" == *DockerRootDir* ]] && echo "/"; exit 0 ;;
  inspect)
    case "$*" in
      *Health*) echo "${STUB_HEALTH:-healthy}" ;;
      *State.Status*) echo "${STUB_MONGO_STATE:-running}" ;;
      *"{{.Image}}"*)
        c="${@: -1}"
        case "$c" in
          *backend*)  if [[ "${STUB_CONTAINER_MISMATCH:-0}" == "1" ]]; then echo "sha256:other"; else idof_cur="$(sed -n 's|^realestatemanager-backend:current=||p' "$TAGS" 2>/dev/null | tail -n 1)"; echo "${idof_cur:-sha256:running-backend}"; fi ;;
          *frontend*) idof_cur="$(sed -n 's|^realestatemanager-frontend:current=||p' "$TAGS" 2>/dev/null | tail -n 1)"; echo "${idof_cur:-sha256:running-frontend}" ;;
          *) exit 1 ;;
        esac ;;
      *) echo "" ;;
    esac
    exit 0 ;;
  image)
    shift
    [[ "${1:-}" == "ls" ]] && exit 0
    ref="${@: -1}"
    [[ "${STUB_IMAGE_PRESENT:-1}" == "1" ]] || exit 1
    if [[ -n "${STUB_IMAGE_MISSING:-}" && "$ref" == *"$STUB_IMAGE_MISSING"* ]]; then exit 1; fi
    idof "$ref"; exit 0 ;;
  tag) echo "$3=$(idof "$2")" >> "$TAGS"; exit 0 ;;
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
      *--dryRun*)     cat > /dev/null; [[ "${STUB_DRYRUN_USERS:-1}" == "1" ]] && echo 'archive prelude `realestate.users`'; exit 0 ;;
      *mongodump*)    printf 'dump' | gzip; exit "${STUB_DUMP_RC:-0}" ;;
      *mongorestore*) cat > /dev/null; echo "#RESTORE" >> "$STUB_CALLS"; exit "${STUB_RESTORE_RC:-0}" ;;
    esac ;;
esac
exit 0
EOS
printf '#!/usr/bin/env bash\nexit "${STUB_CURL_RC:-0}"\n' > "$STUB/curl"
# flock giả: ghi lại lời gọi, STUB_FLOCK_RC=1 giả lập "khóa đang bị giữ" (Git Bash/Windows không có flock thật).
printf '#!/usr/bin/env bash\necho "flock $*" >> "$STUB_CALLS.flock"\nexit "${STUB_FLOCK_RC:-0}"\n' > "$STUB/flock"
# date giả: đóng băng mã thời gian RTS của lần restore; mọi dạng gọi khác chuyển cho date thật.
cat > "$STUB/date" <<'EOS'
#!/usr/bin/env bash
if [[ "$*" == "+%Y%m%d-%H%M%S" ]]; then echo "20260301-090000"; exit 0; fi
exec /usr/bin/date "$@"
EOS
# stat giả: file_mode luôn báo 600 (Windows không giữ được chmod 600); mọi dạng gọi khác chuyển cho stat thật.
cat > "$STUB/stat" <<'EOS'
#!/usr/bin/env bash
if [[ "$1" == "-c" && "$2" == "%a" ]]; then echo 600; exit 0; fi
exec /usr/bin/stat "$@"
EOS
chmod +x "$STUB/docker" "$STUB/curl" "$STUB/flock" "$STUB/date" "$STUB/stat"

# ── Dựng thư mục deploy "máy chủ" giả mỗi ca (KHÔNG phải git repo) ─────────────────────────────────────────────────────
TS="20260101-120000"
BE="realestatemanager-backend"
FE="realestatemanager-frontend"
N=0
W=""

# Manifest bản 2 chuẩn (deploy đã thành công, chưa qua bước 90) -> $1; tham số còn lại là KEY=VAL ghi đè.
mf() { # <tên file trong backups> [KEY=VAL...]
  local f="$W/backups/$1" kv ts
  shift
  ts="${MF_TS:-$TS}"
  manifest_write "$f" \
    "MANIFEST_VERSION=2" "TS=$ts" "CREATED_AT=2026-01-01T12:00:00Z" "HOST=srv" "COMPOSE_PROJECT=realestatemanager" \
    "RELEASE_VERSION=1.0.6" "RELEASE_COMMIT=abc1234" "CD_RUN_ID=run-77" \
    "BACKEND_IMAGE_NAME=$BE" "BACKEND_IMAGE_TAG=1.0.6" "FRONTEND_IMAGE_NAME=$FE" "FRONTEND_IMAGE_TAG=1.0.6" \
    "PRE_TAG=pre-$ts" "BACKEND_PRE_IMAGE=$BE:pre-$ts" "FRONTEND_PRE_IMAGE=$FE:pre-$ts" \
    "DB_VERSION_BEFORE=010" "DB_VERSION_READ=1" "MONGO_BACKUP_FILE=backups/deploy-pre-$ts.archive.gz" "ENV_BACKUP_FILE=" \
    "MONGO_CONTAINER=realestate_mongo" "BACKEND_CONTAINER=realestate_backend" "FRONTEND_CONTAINER=realestate_frontend" \
    "STACK_TOUCHED=1" "POST_UP_REACHED=0" "DEPLOY_STATUS=succeeded" "FINISHED_AT=2026-01-01T12:10:00Z"
  for kv in "$@"; do manifest_put "$f" "${kv%%=*}" "${kv#*=}"; done
}

mk() {
  N=$((N + 1))
  W="$TMP/w$N"
  mkdir -p "$W/ops/lib" "$W/backups"
  cp "$ROOT_DIR/restore.sh" "$W/restore.sh"
  cp "$ROOT_DIR/ops/lib/ops-common.sh" "$W/ops/lib/ops-common.sh"
  printf 'services: {}\n' > "$W/docker-compose.yml"
  printf 'MONGO_INITDB_ROOT_USERNAME=root\n' > "$W/.env"
  printf 'dump' | gzip > "$W/backups/deploy-pre-$TS.archive.gz"
  mf "deploy-pre-$TS.manifest"
}

EXTRA_ENV=()
# Chạy restore.sh THẬT trong thư mục tạm; OUT = stdout+stderr, RC = mã thoát; CALLS = các lệnh docker giả đã gọi.
run_r() {
  : > "$CALLS"; rm -f "$CALLS.sig" "$CALLS.sig2" "$CALLS.tags" "$CALLS.flock"
  OUT="$(cd "$W" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" \
    "${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}" bash "$W/restore.sh" "$@" 2>&1)"
  RC=$?
}
# Chạy restore.sh từ BẢN SAO ngoài thư mục deploy (RESTORE_REPO_DIR); thư mục deploy $W không còn restore.sh/ops/lib để chứng minh dùng bản sao.
run_copy() {
  local c="$TMP/cp$N"
  mkdir -p "$c/ops/lib"; cp "$ROOT_DIR/restore.sh" "$c/restore.sh"; cp "$ROOT_DIR/ops/lib/ops-common.sh" "$c/ops/lib/ops-common.sh"
  rm -rf "$W/restore.sh" "$W/ops"
  : > "$CALLS"; rm -f "$CALLS.sig" "$CALLS.sig2" "$CALLS.tags" "$CALLS.flock"
  OUT="$(cd "$TMP" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD="$SECRET" RESTORE_REPO_DIR="$W" \
    "${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}" bash "$c/restore.sh" "$@" 2>&1)"
  RC=$?
}
calls() { cat "$CALLS"; }
line_of() { grep -nF -m1 -- "$1" "$CALLS" | cut -d: -f1; }
n_calls() { grep -cF -- "$1" "$CALLS" || true; }
# Ảnh chụp trạng thái: file trong backups/ + toàn bộ thẻ image đã gắn.
snap() { ( cd "$W" && { find backups -type f | sort; cat "$CALLS.tags" 2>/dev/null; } ); }
mutating_calls() { grep -cE 'stop backend|#DROP|#RESTORE| up -d|mongodump|docker tag' "$CALLS" || true; }
tag_cur() { printf 'docker tag %s:pre-%s %s:current' "$1" "${2:-$TS}" "$1"; }

# ═════════════════════════════════════════════════════════════════════════════
echo "== 1) Cách dùng / tham số (cờ cũ của bản git bị từ chối, mã 2) =="
mk
run_r
expect_rc "không tham số" 2 "$RC"; expect_contains "không tham số: usage" "--list | --latest | --manifest" "$OUT"
expect_eq "không tham số: không gọi docker" "" "$(calls)"
run_r --help
expect_rc "--help" 0 "$RC"; expect_contains "--help nội dung" "--apply --yes" "$OUT"
expect_contains "--help: nêu image pre-<TS> thành current" "pre-<TS>" "$OUT"
run_r --bậy
expect_rc "tham số lạ" 2 "$RC"; expect_contains "tham số lạ: báo" "Tham số không hợp lệ" "$OUT"
for old in --code-only --use-image-tag --allow-infra-change; do
  run_r --latest "$old"
  expect_rc "cờ cũ $old bị từ chối" 2 "$RC"; expect_contains "cờ cũ $old: nêu tên cờ" "$old" "$OUT"
  expect_contains "cờ cũ $old: giải thích đã bỏ" "đã bỏ ở v1.0.6" "$OUT"
  expect_eq "cờ cũ $old: không gọi docker" "" "$(calls)"
done
run_r --manifest
expect_rc "--manifest thiếu giá trị" 2 "$RC"
run_r --list --apply --yes
expect_rc "--list + --apply" 2 "$RC"
DEPLOY_BACKUP_DIR=bk run_r --list
expect_nonzero "biến staging đặt ngoài wrapper bị chặn" "$RC"; expect_contains "biến staging: báo" "Biến staging" "$OUT"
EXTRA_ENV=(DEPLOY_ENV_FILE=.env.docker); run_r --list
expect_nonzero "DEPLOY_ENV_FILE=.env.docker ngoài wrapper staging bị chặn (mặc định là .env)" "$RC"; EXTRA_ENV=()

echo "== 2) --apply thiếu --yes bị từ chối; biến môi trường KHÔNG thay --yes =="
mk
S0="$(snap)"
run_r --latest --apply
expect_rc "--apply thiếu --yes" 2 "$RC"; expect_contains "--apply thiếu --yes: báo" "bắt buộc thêm --yes" "$OUT"
expect_eq "--apply thiếu --yes: không gọi docker" "" "$(calls)"
EXTRA_ENV=(YES=1 RESTORE_YES=1 DEPLOY_YES=1 ASSUME_YES=1 FORCE=1 CI=1)
run_r --latest --apply
expect_rc "biến môi trường không thay --yes" 2 "$RC"; expect_eq "biến môi trường: không gọi docker" "" "$(calls)"
EXTRA_ENV=()
run_r --latest --yes
expect_rc "--yes không --apply = dry-run" 0 "$RC"; expect_contains "--yes bị bỏ qua" "--yes bị bỏ qua" "$OUT"
expect_eq "--yes không --apply: không đổi gì" "$S0" "$(snap)"

echo "== 3) --list: nội dung manifest bản 2; bản 1/rác chỉ báo hỏng; không gọi Docker =="
mk
MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest" "DEPLOY_STATUS=failed" "POST_UP_REACHED=1" "BACKEND_PRE_IMAGE=" "BACKUP_KIND=manual"
mf "deploy-pre-20251201-100000.manifest" "MANIFEST_VERSION=1" "TS=20251201-100000" "PRE_TAG="
printf 'rác không phải manifest\n' > "$W/backups/deploy-pre-20260103-090000.manifest"
S0="$(snap)"
run_r --list
expect_rc "--list" 0 "$RC"
expect_contains "--list: manifest 1" "deploy-pre-$TS.manifest" "$OUT"
expect_contains "--list: manifest 2" "deploy-pre-20260102-080000.manifest" "$OUT"
expect_contains "--list: trạng thái" "trạng thái deploy: failed" "$OUT"
expect_contains "--list: bản phát hành" "bản phát hành: 1.0.6" "$OUT"
expect_contains "--list: CD run" "CD run: run-77" "$OUT"
expect_contains "--list: thẻ" "pre-$TS" "$OUT"
expect_contains "--list: hai image dự phòng" "$BE:pre-$TS + $FE:pre-$TS" "$OUT"
expect_contains "--list: thiếu image dự phòng thì nói rõ" "chỉ dùng được --db-only" "$OUT"
expect_contains "--list: loại backup thủ công" "[loại: manual" "$OUT"
expect_contains "--list: lưu ý một chiều" "bước 90" "$OUT"
expect_contains "--list: manifest bản 1 báo rõ" "bản 1" "$OUT"
expect_contains "--list: manifest hỏng chỉ báo hỏng" "MANIFEST HỎNG" "$OUT"
expect_eq "--list: không gọi docker" "" "$(calls)"
expect_eq "--list: không đổi gì" "$S0" "$(snap)"
rm -f "$W"/backups/*.manifest
run_r --list
expect_rc "--list rỗng" 0 "$RC"; expect_contains "--list rỗng: báo" "Chưa có manifest" "$OUT"

echo "== 4) Manifest sai/thiếu bị từ chối (không đụng DB); bản 1 báo rõ =="
mk
run_r --manifest "$W/backups/khong-co.manifest"
expect_nonzero "manifest không tồn tại" "$RC"; expect_contains "manifest không tồn tại: báo" "deploy-pre-" "$OUT"
cp "$W/backups/deploy-pre-$TS.manifest" "$TMP/ngoai.manifest"
run_r --manifest "$TMP/ngoai.manifest"
expect_nonzero "manifest NGOÀI backups/" "$RC"; expect_contains "manifest ngoài: báo" "NGOÀI thư mục" "$OUT"
mf "deploy-pre-$TS.manifest" "MANIFEST_VERSION=1"
run_r --manifest "backups/deploy-pre-$TS.manifest"
expect_nonzero "manifest bản 1" "$RC"; expect_contains "bản 1: nêu rõ là bản 1" "là bản 1" "$OUT"
expect_contains "bản 1: giải thích gói code git" "gói code git" "$OUT"; expect_contains "bản 1: hướng dẫn khôi phục DB tay" "mongorestore" "$OUT"
expect_eq "bản 1: không gọi lệnh nào đổi trạng thái" "0" "$(mutating_calls)"
run_r --latest
expect_nonzero "--latest gặp manifest bản 1" "$RC"; expect_contains "--latest bản 1: báo" "là bản 1" "$OUT"
for bad in "MANIFEST_VERSION=3" "TS=hom-nay" "PRE_TAG=pre-khac" "DEPLOY_STATUS=xong" "POST_UP_REACHED=2" "BACKEND_PRE_IMAGE=evil:tag" "BACKEND_IMAGE_NAME=../x" \
  "MONGO_BACKUP_FILE=/etc/passwd" "RELEASE_COMMIT=ZZZ" "CD_RUN_ID=a b;c"; do
  mf "deploy-pre-$TS.manifest" "$bad"
  run_r --manifest "backups/deploy-pre-$TS.manifest"
  expect_nonzero "manifest sai [$bad]" "$RC"
  expect_eq "manifest sai [$bad]: không lệnh nào đổi trạng thái" "0" "$(mutating_calls)"
done
mf "deploy-pre-$TS.manifest"
sed -i '/^PRE_TAG=/d' "$W/backups/deploy-pre-$TS.manifest"
run_r --manifest "backups/deploy-pre-$TS.manifest"
expect_nonzero "manifest thiếu PRE_TAG" "$RC"; expect_contains "thiếu khóa: báo" "thiếu khóa bắt buộc PRE_TAG" "$OUT"
printf 'ten khong phai KEY=VALUE\n' > "$W/backups/deploy-pre-$TS.manifest"
run_r --manifest "backups/deploy-pre-$TS.manifest"
expect_nonzero "manifest sai định dạng" "$RC"

echo "== 5) DRY-RUN mặc định: kiểm đạt, KHÔNG đổi gì; kế hoạch dùng image, không git/build =="
mk
S0="$(snap)"
run_r --latest
expect_rc "dry-run" 0 "$RC"
expect_contains "dry-run: nhãn" "DRY-RUN" "$OUT"
expect_contains "dry-run: kế hoạch backup an toàn" "backup AN TOÀN" "$OUT"
expect_contains "dry-run: kế hoạch đặt thẻ current" "$BE:pre-$TS -> $BE:current" "$OUT"
expect_contains "dry-run: kế hoạch up --no-build" "up -d --no-build --no-deps backend frontend" "$OUT"
expect_contains "dry-run: hai image dự phòng đạt" "còn trên máy" "$OUT"
expect_contains "dry-run: backup mongo đạt" "thấy realestate.users" "$OUT"
expect_contains "dry-run: lệnh chạy thật gợi ý" "--apply --yes" "$OUT"
expect_not_contains "dry-run: không báo một chiều (chưa qua bước 90)" "CẢNH BÁO MỘT CHIỀU" "$OUT"
expect_not_contains "dry-run: không nhắc bundle/git" "bundle" "$OUT"
expect_eq "dry-run: không đổi gì (backups + thẻ image)" "$S0" "$(snap)"
expect_eq "dry-run: không gọi lệnh đổi trạng thái" "0" "$(mutating_calls)"
expect_eq "dry-run: không tạo backup an toàn" "" "$(cd "$W/backups" && ls | grep restore-safety || true)"
run_r --manifest "backups/deploy-pre-$TS.manifest" --db-only
expect_rc "dry-run --db-only" 0 "$RC"; expect_contains "dry-run --db-only: kế hoạch bỏ qua thẻ" "--db-only không đổi thẻ image" "$OUT"
expect_eq "dry-run --db-only: không đổi gì" "$S0" "$(snap)"

echo "== 6) --latest chọn manifest MỚI nhất CÓ backup Mongo =="
mk
MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest"
printf 'dump' | gzip > "$W/backups/deploy-pre-20260102-080000.archive.gz"
run_r --latest
expect_rc "--latest" 0 "$RC"; expect_contains "--latest: chọn bản mới" "deploy-pre-20260102-080000.manifest" "$OUT"
mk
MF_TS=20260102-080000 mf "deploy-pre-20260102-080000.manifest" "MONGO_BACKUP_FILE="
run_r --latest
expect_rc "--latest bỏ qua bản không có backup Mongo" 0 "$RC"; expect_contains "--latest bỏ qua: cảnh báo" "bỏ qua deploy-pre-20260102-080000.manifest" "$OUT"
expect_contains "--latest bỏ qua: dùng bản cũ hơn" "--latest: dùng deploy-pre-$TS.manifest" "$OUT"

echo "== 7) Kiểm trước HỎNG => dry-run [HỎNG] (thoát 1); --apply --yes DỪNG chưa đổi gì =="
CB_SEL=(--latest)
check_bad() { # <nhãn> <chuỗi báo> [apply=1]  (CB_SEL = tham số chọn manifest)
  local label="$1" msg="$2" with_apply="${3:-1}" s0
  s0="$(snap)"
  run_r "${CB_SEL[@]}"
  expect_rc "$label: dry-run thoát 1" 1 "$RC"; expect_contains "$label: [HỎNG]" "[HỎNG]" "$OUT"; expect_contains "$label: nội dung" "$msg" "$OUT"
  expect_eq "$label: dry-run không đổi gì" "$s0" "$(snap)"
  expect_eq "$label: dry-run không lệnh đổi trạng thái" "0" "$(mutating_calls)"
  if [[ "$with_apply" == "1" ]]; then
    run_r "${CB_SEL[@]}" --apply --yes
    expect_nonzero "$label: --apply --yes dừng" "$RC"
    expect_eq "$label: --apply dừng trước khi đổi (không lệnh đổi trạng thái)" "0" "$(mutating_calls)"
    expect_eq "$label: --apply dừng, không đổi gì" "$s0" "$(snap)"
  fi
}
mk; : > "$W/backups/deploy-pre-$TS.archive.gz"
check_bad "backup mongo 0 byte" "0 byte"
mk; printf 'khong phai gzip' > "$W/backups/deploy-pre-$TS.archive.gz"
check_bad "backup mongo không phải gzip" "gzip" 0
mk; EXTRA_ENV=(STUB_IMAGE_MISSING="$FE:pre-$TS")
check_bad "image dự phòng frontend mất" "KHÔNG còn trên máy"
expect_contains "image mất: nêu đúng ref" "$FE:pre-$TS" "$OUT"
EXTRA_ENV=()
mk; mf "deploy-pre-$TS.manifest" "BACKEND_PRE_IMAGE="
check_bad "manifest thiếu image dự phòng" "không có đủ image dự phòng" 0
expect_contains "thiếu image dự phòng: gợi ý --db-only" "--db-only" "$OUT"
mk; EXTRA_ENV=(STUB_MONGO_STATE=exited)
check_bad "mongo không chạy" "không chạy" 0
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_DRYRUN_USERS=0)
check_bad "backup mongo thiếu realestate.users" "không đạt kiểm nội dung" 0
EXTRA_ENV=()
mk; touch "$W/.deploy.lock"; EXTRA_ENV=(STUB_FLOCK_RC=1)
check_bad "khóa chung đang bị giữ" "đang chạy"
EXTRA_ENV=()
# --db-only không cần image dự phòng: manifest không có (hoặc image mất) vẫn dry-run đạt.
mk; mf "deploy-pre-$TS.manifest" "BACKEND_PRE_IMAGE=" "FRONTEND_PRE_IMAGE="; EXTRA_ENV=(STUB_IMAGE_PRESENT=0)
run_r --latest --db-only
expect_rc "--db-only không cần image dự phòng" 0 "$RC"; EXTRA_ENV=()
mk; mf "deploy-pre-$TS.manifest" "MONGO_BACKUP_FILE="
run_r --manifest "backups/deploy-pre-$TS.manifest"
expect_rc "manifest không có backup Mongo" 1 "$RC"; expect_contains "không có backup Mongo: báo" "không có backup Mongo" "$OUT"

echo "== 8) --apply --yes: THỨ TỰ + kết quả (image pre-<TS> thành current, không git/build) =="
mk
run_r --latest --apply --yes
expect_rc "apply" 0 "$RC"
expect_contains "apply: xong" "KHÔI PHỤC XONG" "$OUT"
L_STOP="$(line_of 'stop backend')"; L_DUMP="$(line_of 'mongodump')"; L_SAFE="$(line_of "docker tag sha256:running-backend $BE:pre-restore-$RTS")"
L_DROP="$(line_of '#DROP')"; L_REST="$(line_of '#RESTORE')"; L_TAGB="$(line_of "$(tag_cur $BE)")"; L_TAGF="$(line_of "$(tag_cur $FE)")"
L_UP="$(line_of ' up -d --no-build --no-deps backend frontend')"; L_SYS="$(line_of '#SYSVER')"
expect_lt "dừng backend < dump an toàn (không còn ai ghi DB lúc dump)" "$L_STOP" "$L_DUMP"
expect_lt "dump an toàn < thẻ image an toàn" "$L_DUMP" "$L_SAFE"
expect_lt "thẻ image an toàn < xóa DB" "$L_SAFE" "$L_DROP"
expect_lt "xóa DB < mongorestore" "$L_DROP" "$L_REST"
expect_lt "mongorestore < docker tag pre-<TS> current (backend)" "$L_REST" "$L_TAGB"
expect_lt "tag backend < tag frontend" "$L_TAGB" "$L_TAGF"
expect_lt "tag current < up -d --no-build" "$L_TAGF" "$L_UP"
expect_lt "up < kiểm version DB" "$L_UP" "$L_SYS"
expect_contains "thẻ an toàn frontend" "docker tag sha256:running-frontend $FE:pre-restore-$RTS" "$(calls)"
expect_eq "đúng 4 lệnh docker tag (2 an toàn + 2 current)" "4" "$(n_calls 'docker tag ')"
expect_eq "backup an toàn DB có tạo" "1" "$(cd "$W/backups" && ls restore-safety-*.archive.gz | wc -l | tr -d ' ')"
expect_file "backup an toàn đúng tên theo RTS" "$W/backups/restore-safety-$RTS.archive.gz"
expect_eq "không để lại .partial" "0" "$(cd "$W/backups" && ls *.partial 2>/dev/null | wc -l | tr -d ' ')"
expect_contains "apply: kiểm version DB khớp" "[KHỚP] version DB" "$OUT"
expect_contains "apply: kiểm image backend khớp" "[KHỚP] image realestate_backend đang chạy = $BE:pre-$TS" "$OUT"
expect_contains "apply: kiểm image frontend khớp" "[KHỚP] image realestate_frontend đang chạy = $FE:pre-$TS" "$OUT"
expect_contains "apply: cảnh báo release.env còn là bản mới" "release.env" "$OUT"
expect_contains "apply: in thẻ an toàn" "$BE:pre-restore-$RTS" "$OUT"
expect_contains "apply: mongorestore --drop --nsInclude" "--drop --gzip --archive --nsInclude" "$(calls)"
expect_contains "apply: nsInclude chỉ realestate" 'realestate.*' "$(calls)"
expect_not_contains "apply: không build (không có --build)" "--build" "$(calls)"
expect_not_contains "apply: không dùng git" "git " "$(calls)"
expect_not_contains "apply: không docker compose down" " down" "$(calls)"
expect_not_contains "mật khẩu root không lên dòng lệnh docker" "$SECRET" "$(calls)"
expect_not_contains "mật khẩu root không có trong đầu ra" "$SECRET" "$OUT"
expect_contains "apply: mật khẩu chỉ qua biến env TRONG container" 'printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD"' "$(calls)"
expect_eq "khóa chung: apply gọi flock -n 8 đúng 1 lần" "1" "$(grep -c 'flock -n 8' "$CALLS.flock")"
expect_file "khóa chung: file <thư mục deploy>/.deploy.lock (cùng khóa deploy.sh)" "$W/.deploy.lock"
expect_contains "apply: báo đã giữ khóa" ".deploy.lock" "$OUT"

echo "== 9) --apply --yes --db-only: không đổi thẻ image current, chỉ bật lại backend =="
mk
run_r --latest --apply --yes --db-only
expect_rc "apply db-only" 0 "$RC"; expect_contains "db-only: xong" "KHÔI PHỤC XONG" "$OUT"
expect_contains "db-only: có nạp DB" "#RESTORE" "$(calls)"
expect_eq "db-only: không docker tag nào (không thẻ an toàn, không current)" "0" "$(n_calls 'docker tag ')"
expect_contains "db-only: bật lại backend" "up -d --no-build --no-deps backend" "$(calls)"
expect_not_contains "db-only: không đụng frontend" "backend frontend" "$(calls)"
expect_not_contains "db-only: không kiểm image" "[KHỚP] image" "$OUT"
expect_not_contains "db-only: không cảnh báo release.env" "release.env" "$OUT"

echo "== 10) Cảnh báo ĐỎ một chiều (deploy đã qua bước 90) và các cảnh báo manifest =="
mk; mf "deploy-pre-$TS.manifest" "POST_UP_REACHED=1" "DEPLOY_STATUS=failed" "STACK_TOUCHED=0" "DB_VERSION_READ=0"
run_r --latest
expect_rc "dry-run một chiều" 0 "$RC"
expect_contains "cảnh báo một chiều" "CẢNH BÁO MỘT CHIỀU" "$OUT"
expect_contains "cảnh báo: migration 011" "011" "$OUT"
expect_contains "cảnh báo: mất dữ liệu sau backup" "SẼ MẤT" "$OUT"
expect_contains "cảnh báo: deploy thất bại" "THẤT BẠI" "$OUT"
expect_contains "cảnh báo: STACK_TOUCHED=0" "STACK_TOUCHED=0" "$OUT"
expect_contains "cảnh báo: không có version DB" "DB_VERSION_READ=0" "$OUT"
run_r --latest --apply
expect_rc "một chiều: vẫn cần --yes" 2 "$RC"

echo "== 11) Lỗi giữa chừng: vùng an toàn bật lại backend; từ bước 3 in hướng dẫn, không tự rollback =="
# Vùng an toàn (dữ liệu CHƯA đổi): dump an toàn lỗi -> bật lại backend, không xóa DB.
mk; EXTRA_ENV=(STUB_DUMP_RC=1)
run_r --latest --apply --yes
expect_nonzero "dump an toàn lỗi" "$RC"; expect_contains "dump an toàn lỗi: báo" "mongodump (backup an toàn) thất bại" "$OUT"
expect_contains "vùng an toàn: báo chưa đổi dữ liệu" "Dừng TRƯỚC khi đổi dữ liệu" "$OUT"
expect_contains "vùng an toàn: bật lại backend" "Đã bật lại backend" "$OUT"
expect_not_contains "vùng an toàn: không hướng dẫn 'dừng giữa chừng'" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
expect_not_contains "vùng an toàn: không xóa DB" "#DROP" "$(calls)"; expect_eq "vùng an toàn: không có docker tag current" "0" "$(n_calls ':current')"
expect_eq "vùng an toàn: không để lại backup an toàn dở" "" "$(cd "$W/backups" && ls | grep restore-safety || true)"
EXTRA_ENV=()
# compose stop lỗi: cũng thuộc vùng an toàn.
mk; EXTRA_ENV=(STUB_FAIL_STOP=1)
run_r --latest --apply --yes
expect_nonzero "stop backend lỗi" "$RC"; expect_contains "stop lỗi: vùng an toàn" "Dừng TRƯỚC khi đổi dữ liệu" "$OUT"; expect_not_contains "stop lỗi: không xóa DB" "#DROP" "$(calls)"
EXTRA_ENV=()
# mongorestore lỗi: đã xóa DB => in hướng dẫn, KHÔNG tự bật lại, KHÔNG đặt current.
mk; EXTRA_ENV=(STUB_RESTORE_RC=1)
run_r --latest --apply --yes
expect_nonzero "mongorestore lỗi" "$RC"; expect_contains "mongorestore lỗi: báo" "mongorestore thất bại" "$OUT"
expect_contains "mongorestore lỗi: hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
expect_contains "mongorestore lỗi: nêu backup an toàn" "restore-safety-$RTS.archive.gz" "$OUT"
expect_contains "mongorestore lỗi: nêu thẻ image an toàn" "$BE:pre-restore-$RTS" "$OUT"
expect_contains "mongorestore lỗi: gợi ý --skip-safety-db" "--skip-safety-db" "$OUT"
expect_not_contains "mongorestore lỗi: không tự đặt current" "$(tag_cur $BE)" "$(calls)"
expect_eq "mongorestore lỗi: không tự bật lại (không có up)" "0" "$(n_calls ' up -d')"
EXTRA_ENV=()
# up lỗi sau khi đã đặt current: hướng dẫn, image current đã đổi.
mk; EXTRA_ENV=(STUB_FAIL_UP=1)
run_r --latest --apply --yes
expect_nonzero "up lỗi" "$RC"; expect_contains "up lỗi: hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"; expect_contains "up lỗi: bước đang chạy" "5) khởi động lại" "$OUT"
expect_contains "up lỗi: đã đặt current trước đó" "$(tag_cur $BE)" "$(calls)"
expect_contains "up lỗi: nhắc release.env" "release.env" "$OUT"
EXTRA_ENV=()
# Sau khôi phục container chạy image LẠ: báo LỆCH, mã khác 0.
mk; EXTRA_ENV=(STUB_CONTAINER_MISMATCH=1)
run_r --latest --apply --yes
expect_nonzero "image sau khôi phục lệch" "$RC"; expect_contains "lệch: báo [LỆCH]" "[LỆCH] image realestate_backend" "$OUT"
expect_not_contains "lệch: không in hướng dẫn 'dừng giữa chừng' (đã chạy hết)" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
EXTRA_ENV=()
mk; EXTRA_ENV=(STUB_SYSTEM_VERSION=011)
run_r --latest --apply --yes
expect_nonzero "version DB sau khôi phục lệch manifest" "$RC"; expect_contains "lệch version DB: báo" "[LỆCH] version DB" "$OUT"
EXTRA_ENV=()

echo "== 12) SIGTERM / SIGHUP giữa chừng =="
mk; EXTRA_ENV=("STUB_SIGNAL_ON=stop backend=TERM")
run_r --latest --apply --yes
expect_rc "SIGTERM lúc dừng backend (vùng an toàn)" 143 "$RC"; expect_contains "SIGTERM an toàn: bật lại backend" "Đã bật lại backend" "$OUT"
expect_not_contains "SIGTERM an toàn: không xóa DB" "#DROP" "$(calls)"; expect_not_contains "SIGTERM an toàn: không hướng dẫn giữa chừng" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
# Tín hiệu THỨ HAI đến đúng lúc on_exit đang bật lại backend: on_exit bỏ qua TERM/INT/HUP nên vẫn bật xong + báo, mã gốc 143 (như deploy.sh).
mk; EXTRA_ENV=("STUB_SIGNAL_ON=stop backend=TERM" "STUB_SIGNAL2_ON=up -d --no-build --no-deps backend=TERM")
run_r --latest --apply --yes
expect_rc "TERM thứ hai khi on_exit đang bật lại backend: mã gốc 143" 143 "$RC"; expect_contains "TERM thứ hai: vẫn báo đã bật lại backend" "Đã bật lại backend" "$OUT"
# Đối chứng: bỏ TERM INT HUP khỏi on_exit => tín hiệu thứ hai cắt ngang (không tới được dòng báo).
mk; sed -i "/^on_exit() {/,/^}/s/trap '' PIPE TERM INT HUP/trap '' PIPE/" "$W/restore.sh"
run_r --latest --apply --yes
expect_not_contains "đối chứng: không bỏ qua TERM thì on_exit bị cắt ngang (test bắt được)" "Đã bật lại backend" "$OUT"
if (( HUP_OK == 1 )); then
mk; EXTRA_ENV=("STUB_SIGNAL_ON=backend frontend=HUP")
run_r --latest --apply --yes
expect_rc "SIGHUP lúc up (đã đổi dữ liệu)" 129 "$RC"; expect_contains "SIGHUP: in hướng dẫn" "RESTORE DỪNG GIỮA CHỪNG" "$OUT"
else echo "  (bỏ qua ca SIGHUP: SIGHUP bị bỏ qua từ lúc khởi động, vd chạy bằng nohup)"; fi
EXTRA_ENV=()

echo "== 13) --skip-safety-db: chốt chặn chặt =="
mk
run_r --latest --skip-safety-db
expect_rc "--skip-safety-db khi chưa có backup an toàn nào" 1 "$RC"; expect_contains "chưa có backup an toàn: báo" "restore-safety" "$OUT"
mk; printf 'dump' | gzip > "$W/backups/restore-safety-20251231-235959.archive.gz"
run_r --latest --skip-safety-db
expect_rc "--skip-safety-db khi DB KHỎE" 1 "$RC"; expect_contains "DB khỏe: từ chối" "KHỎE" "$OUT"
mk; printf 'dump' | gzip > "$W/backups/restore-safety-20251231-235959.archive.gz"; EXTRA_ENV=(STUB_USERS_EXIST=0 STUB_NONEMPTY=orders)
run_r --latest --apply --yes --skip-safety-db
expect_rc "--skip-safety-db khi DB dở dang + có backup an toàn" 0 "$RC"; expect_contains "skip: báo không dump lại" "KHÔNG dump lại" "$OUT"
expect_eq "skip: KHÔNG mongodump" "0" "$(n_calls 'mongodump')"; expect_contains "skip: nêu backup an toàn có sẵn" "restore-safety-20251231-235959.archive.gz" "$OUT"
expect_contains "skip: vẫn khôi phục DB" "#RESTORE" "$(calls)"; expect_contains "skip: vẫn đặt current" "$(tag_cur $BE)" "$(calls)"
EXTRA_ENV=()

echo "== 14) RESTORE_REPO_DIR: chạy từ BẢN SAO ngoài thư mục deploy =="
mk
run_copy --list
expect_rc "bản sao --list" 0 "$RC"; expect_contains "bản sao --list thấy manifest trong thư mục deploy" "deploy-pre-$TS.manifest" "$OUT"
mk
run_copy --latest --apply --yes --db-only
expect_rc "bản sao apply --db-only" 0 "$RC"; expect_contains "bản sao apply: xong" "KHÔI PHỤC XONG" "$OUT"
expect_file "bản sao: backup an toàn nằm trong thư mục deploy" "$W/backups/restore-safety-$RTS.archive.gz"
expect_file "bản sao: khóa chung nằm trong thư mục deploy" "$W/.deploy.lock"
mk
(cd "$TMP" && env PATH="$STUB:$PATH" STUB_CALLS="$CALLS" RESTORE_REPO_DIR="$TMP/khong-ton-tai" bash "$W/restore.sh" --list >"$TMP/o.txt" 2>&1); RC=$?
expect_nonzero "RESTORE_REPO_DIR không phải thư mục" "$RC"; expect_contains "RESTORE_REPO_DIR sai: báo" "RESTORE_REPO_DIR" "$(cat "$TMP/o.txt")"

echo "== 15) Kiểm tĩnh: không còn git, bundle, --code-only, up --build, .env.docker (và đối chứng đột biến) =="
BAD_RE='--code-only|bundle|git (reset|switch|checkout|tag|clone|rev-parse|status|fetch|pull)|up .*--build|in_git_repo|acquire_lock|valid_branch_name|--use-image-tag|--allow-infra-change'
static_hits() { grep -nE -- "$BAD_RE" "$1" || true; }
expect_eq "restore.sh sạch (không --code-only/bundle/git/up --build)" "" "$(static_hits "$ROOT_DIR/restore.sh")"
expect_eq "backup.sh sạch" "" "$(static_hits "$ROOT_DIR/backup.sh")"
expect_eq "restore.sh không còn nhắc .env.docker" "0" "$(grep -c '\.env\.docker' "$ROOT_DIR/restore.sh" || true)"
expect_eq "restore.sh: không gọi lệnh git" "" "$(grep -vE '^[[:space:]]*#' "$ROOT_DIR/restore.sh" | grep -E "^[[:space:]]*git[[:space:]]|[;&|(\`][[:space:]]*git[[:space:]]" || true)"
expect_contains "restore.sh dùng up -d --no-build --no-deps" "up -d --no-build --no-deps backend frontend" "$(cat "$ROOT_DIR/restore.sh")"
expect_contains "restore.sh gọi acquire_dir_lock chung" 'acquire_dir_lock "$ROOT_DIR"' "$(cat "$ROOT_DIR/restore.sh")"
expect_contains "restore.sh on_exit bỏ TERM INT HUP khi dọn (như deploy.sh)" "trap '' PIPE TERM INT HUP" "$(sed -n '/^on_exit() {/,/^}/p' "$ROOT_DIR/restore.sh")"
for pat in 'git bundle verify x' 'git reset --hard HEAD' 'docker compose up --build -d' 'case --code-only) :;;'; do
  cp "$ROOT_DIR/restore.sh" "$TMP/mut.sh"; printf '%s\n' "$pat" >> "$TMP/mut.sh"
  [[ -n "$(static_hits "$TMP/mut.sh")" ]] && ok || fail "đối chứng: thêm '$pat' mà kiểm tĩnh không bắt được"
done

echo "== 16) Đối chứng đột biến chạy thật: test phải BẮT được script hỏng =="
# (a) Bỏ bước đặt thẻ current: image đang chạy KHÔNG đổi => không có lệnh docker tag ... current và kiểm sau báo LỆCH, mã khác 0.
mk; sed -i 's/^    restore_image_tags$/    :/' "$W/restore.sh"
run_r --latest --apply --yes
expect_eq "(đột biến a) không còn docker tag current" "0" "$(n_calls "$(tag_cur $BE)")"
expect_nonzero "(đột biến a) kiểm sau bắt được image không đổi" "$RC"; expect_contains "(đột biến a) báo LỆCH" "[LỆCH] image" "$OUT"
# (b) Chấp nhận manifest bản 1: dry-run không còn báo "là bản 1" (test từ chối bản 1 bắt được).
mk; mf "deploy-pre-$TS.manifest" "MANIFEST_VERSION=1"; sed -i 's/== "1" \]\]; then$/== "9" ]]; then/' "$W/restore.sh"
run_r --manifest "backups/deploy-pre-$TS.manifest"
expect_not_contains "(đột biến b) bỏ kiểm bản 1 thì không còn thông báo bản 1" "là bản 1" "$OUT"
# (c) Bỏ khóa chung: không gọi flock (test khóa bắt được).
mk; sed -i '/^    acquire_dir_lock "\$ROOT_DIR"$/d' "$W/restore.sh"
run_r --latest --apply --yes --db-only
expect_eq "(đột biến c) bỏ acquire_dir_lock thì không gọi flock" "0" "$(cat "$CALLS.flock" 2>/dev/null | grep -c flock || true)"


echo "== 17) PROMOTE_REVERT (deploy.sh ghi khi trả thẻ current): whitelist, kiểm giá trị, cảnh báo khi =failed =="
MP="backups/deploy-pre-$TS.manifest"
mk; mf "deploy-pre-$TS.manifest" "PROMOTE_REVERT=failed" "DEPLOY_STATUS=failed" "STACK_TOUCHED=0"
run_r --manifest "$MP"
expect_rc "dry-run manifest PROMOTE_REVERT=failed vẫn đọc được" 0 "$RC"
expect_contains "failed: cảnh báo nêu khóa" "PROMOTE_REVERT=failed" "$OUT"
expect_contains "failed: nói thẻ current có thể vẫn là image mới" "VẪN là image MỚI" "$OUT"
expect_contains "failed: không --db-only thì restore tự đặt lại current" "sẽ đặt lại thẻ current = pre-$TS" "$OUT"
run_r --manifest "$MP" --db-only
expect_rc "dry-run --db-only với PROMOTE_REVERT=failed" 0 "$RC"
expect_contains "failed + --db-only: cảnh báo không đổi thẻ + lệnh tay" "docker tag <tên image>:pre-$TS <tên image>:current" "$OUT"
run_r --list
expect_rc "--list với PROMOTE_REVERT=failed" 0 "$RC"; expect_contains "--list: nhắc PROMOTE_REVERT=failed" "PROMOTE_REVERT=failed" "$OUT"
for v in reverted none ""; do
  mk; mf "deploy-pre-$TS.manifest" "PROMOTE_REVERT=$v"
  run_r --manifest "$MP"
  expect_rc "PROMOTE_REVERT='$v' đọc được" 0 "$RC"; expect_not_contains "PROMOTE_REVERT='$v': không cảnh báo thẻ" "VẪN là image MỚI" "$OUT"
  run_r --list; expect_not_contains "--list PROMOTE_REVERT='$v': không nhắc thẻ" "PROMOTE_REVERT" "$OUT"
done
mk; mf "deploy-pre-$TS.manifest" "PROMOTE_REVERT=bậy"
run_r --manifest "$MP"
expect_nonzero "PROMOTE_REVERT sai giá trị bị từ chối" "$RC"; expect_contains "PROMOTE_REVERT sai: báo khóa" "PROMOTE_REVERT phải là" "$OUT"
# Whitelist: khóa nằm trong MANIFEST_KEYS; đối chứng: bỏ nó khỏi whitelist thì khóa bị bỏ qua (không cảnh báo) => test cảnh báo ở trên bắt được.
expect_contains "MANIFEST_KEYS có PROMOTE_REVERT" " PROMOTE_REVERT " "$(sed -n 's/^readonly MANIFEST_KEYS="\(.*\)"$/ \1 /p' "$ROOT_DIR/restore.sh")"
mk; mf "deploy-pre-$TS.manifest" "PROMOTE_REVERT=failed"; sed -i '/^readonly MANIFEST_KEYS=/s/ PROMOTE_REVERT / /' "$W/restore.sh"
run_r --manifest "$MP"
expect_not_contains "(đột biến d) bỏ PROMOTE_REVERT khỏi whitelist thì không còn cảnh báo (test bắt được)" "VẪN là image MỚI" "$OUT"
echo
echo "Kết quả: $PASS đạt, $FAIL hỏng."
(( FAIL == 0 ))
