#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/tests/staging.test.sh — test rào chắn của staging local, KHÔNG cần Docker thật:
#   - scripts/staging.sh: guard_environment (cổng, tên, DOCKER_HOST/DOCKER_CONTEXT/endpoint context), confirm (ASSUME_YES), prepare_env
#     (gỡ biến shell trùng khóa trong .env.staging.example)
#   - scripts/staging.sh restore-dump/snapshot (T-18, FR-21): chỉ nhắm rhstg_mongo, bắt buộc --yes, archive chỉ trong .staging/, bị từ chối thì
#     KHÔNG gọi Docker (docker stub ghi nhật ký); tĩnh: mongorestore --drop kèm --nsInclude realestate.*, không nhắc container dev/prod
#   - deploy.sh: check_staging_vars (đường dẫn DEPLOY_* tương đối trong repo; biến staging chỉ hợp lệ qua wrapper) và mặc định y hệt cũ
#   - scripts/staging/shims/docker: chỉ đổi đường dẫn host sau cờ đường dẫn (cần cygpath, bỏ qua nếu không có)
# Hàm được TRÍCH từ file thật (sed), docker thay bằng stub. Chạy:  bash scripts/tests/staging.test.sh  (thoát 0 nếu đạt)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034,SC2329,SC2016,SC2032,SC2033  # biến/hàm dùng qua eval các hàm trích từ staging.sh; nháy đơn có chủ ý
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$ROOT_DIR" || exit 2

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: không thấy [$2] trong [$3]"; fi; }

LOG_PREFIX="test"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

extract_fn() { sed -n "/^$1() {/,/^}/p" "$2"; }
for fn in assert_staging_name guard_environment confirm prepare_env is_windows resolve_dump_archive; do
  src="$(extract_fn "$fn" "$ROOT_DIR/scripts/staging.sh")"
  [[ -n "$src" ]] || { echo "Không trích được $fn từ scripts/staging.sh" >&2; exit 2; }
  eval "$src"
done
# Hằng số của staging.sh (lấy nguyên dòng readonly từ file thật).
eval "$(grep -E '^readonly STG_(PROJECT|DIR|ENV|MONGO|BACKEND|IMAGE_PREFIX|ALLOWED_PORTS_RE|BLOCKED_PORTS)=' "$ROOT_DIR/scripts/staging.sh")"
STG_YES=0

# ── guard_environment ────────────────────────────────────────────────────────
# docker (hàm stub): `docker context inspect` trả $FAKE_CTX_HOST (mặc định unix://); rc=$FAKE_CTX_RC.
docker() {
  if [[ "${1:-}" == "context" ]]; then
    [[ "${FAKE_CTX_RC:-0}" == 0 ]] || return "$FAKE_CTX_RC"
    printf '%s\n' "${FAKE_CTX_HOST-unix:///var/run/docker.sock}"
    return 0
  fi
  return 0
}
# guard_rc "<gán biến>": chạy guard_environment trong subshell sau khi eval phần gán; in "rc=<mã> | output".
guard_rc() {
  local out rc=0
  out="$( ( eval "$1"; guard_environment ) 2>&1 )" || rc=$?
  printf 'rc=%s | %s' "$rc" "$out"
}
check_guard() { # mô tả rc_mong_đợi chuỗi_phải_có "<gán biến>"
  local res; res="$(guard_rc "$4")"
  expect_eq "guard: $1 (rc)" "rc=$2" "${res%% |*}"
  [[ -z "$3" ]] || expect_contains "guard: $1 (thông báo)" "$3" "$res"
}
# M-a: cổng
check_guard "mặc định hợp lệ"                0 ""                 ":"
check_guard "backend 13100"                  0 ""                 "export STAGING_BACKEND_PORT=13100"
check_guard "backend 13199"                  0 ""                 "export STAGING_BACKEND_PORT=13199"
check_guard "backend 13200 ngoài dải"        1 "ngoài dải"        "export STAGING_BACKEND_PORT=13200"
check_guard "backend 13099 ngoài dải"        1 "ngoài dải"        "export STAGING_BACKEND_PORT=13099"
check_guard "frontend 18080"                 0 ""                 "export STAGING_FRONTEND_PORT=18080"
check_guard "frontend 18099"                 0 ""                 "export STAGING_FRONTEND_PORT=18099"
check_guard "frontend 18100 ngoài dải"       1 "ngoài dải"        "export STAGING_FRONTEND_PORT=18100"
check_guard "cổng 5 chữ số bất kỳ (30000)"   1 "ngoài dải"        "export STAGING_BACKEND_PORT=30000"
for p in 80 443 3000 6379 9000 9001 20128 27017; do
  check_guard "chặn tường minh cổng $p"      1 "thuộc dev/prod"   "export STAGING_BACKEND_PORT=$p"
done
check_guard "cổng không phải số"             1 "không phải số"    "export STAGING_BACKEND_PORT=abc"
check_guard "hai cổng trùng nhau"            1 "trùng nhau"       "export STAGING_BACKEND_PORT=13100 STAGING_FRONTEND_PORT=13100"
# Tên
check_guard "MONGO_CONTAINER=realestate_mongo" 1 "Từ chối"        "export MONGO_CONTAINER=realestate_mongo"
check_guard "BACKEND_CONTAINER=realestate_dev_x" 1 "Từ chối"      "export BACKEND_CONTAINER=realestate_dev_x"
check_guard "COMPOSE_PROJECT_NAME=realestate-dev" 1 "Từ chối"     "export COMPOSE_PROJECT_NAME=realestate-dev"
check_guard "đúng tên staging được phép"     0 ""                 "export MONGO_CONTAINER=rhstg_mongo COMPOSE_PROJECT_NAME=realestate-staging"
# DOCKER_HOST / DOCKER_CONTEXT / endpoint context (M-e)
check_guard "DOCKER_HOST đặt"                1 "DOCKER_HOST"      "export DOCKER_HOST=tcp://10.0.0.5:2375"
check_guard "DOCKER_CONTEXT đặt"             1 "DOCKER_CONTEXT"   "export DOCKER_CONTEXT=vps"
check_guard "context endpoint ssh://"        1 "ssh://"           "FAKE_CTX_HOST=ssh://root@vps"
check_guard "context endpoint tcp://"        1 "tcp://"           "FAKE_CTX_HOST=tcp://1.2.3.4:2376"
check_guard "context endpoint rỗng/không xác định" 1 "không xác định" "FAKE_CTX_HOST="
check_guard "context inspect lỗi"            1 "không xác định"   "FAKE_CTX_RC=1"
check_guard "context unix:// được phép"      0 ""                 "FAKE_CTX_HOST=unix:///var/run/docker.sock"
check_guard "context npipe:// được phép"     0 ""                 "FAKE_CTX_HOST=npipe:////./pipe/docker_engine"
check_guard "STAGING_ALLOW_DOCKER_HOST bỏ qua kiểm context" 0 ""  "export STAGING_ALLOW_DOCKER_HOST=1 DOCKER_CONTEXT=vps"

# ── M-b: confirm không đọc ASSUME_YES ────────────────────────────────────────
confirm_rc() { local out rc=0; out="$( ( eval "$1"; confirm "hỏi?" ) 2>&1 </dev/null )" || rc=$?; printf 'rc=%s | %s' "$rc" "$out"; }
res="$(confirm_rc 'export ASSUME_YES=1; unset STAGING_ASSUME_YES; STG_YES=0')"
expect_eq "confirm: ASSUME_YES trong môi trường KHÔNG được tính" "rc=1" "${res%% |*}"
expect_contains "confirm: thông báo cần xác nhận" "Cần xác nhận" "$res"
expect_eq "confirm: STAGING_ASSUME_YES=1 bỏ hỏi" "rc=0" "$(confirm_rc 'export STAGING_ASSUME_YES=1; STG_YES=0' | cut -d' ' -f1)"
expect_eq "confirm: cờ --yes (STG_YES=1) bỏ hỏi"  "rc=0" "$(confirm_rc 'unset STAGING_ASSUME_YES; STG_YES=1' | cut -d' ' -f1)"
expect_eq "staging.sh không đọc \${ASSUME_YES}" "0" "$(grep -c '[$]{ASSUME_YES' "$ROOT_DIR/scripts/staging.sh" || true)"

# ── M-e: prepare_env gỡ biến shell trùng khóa của .env.staging.example ───────
pe="$( (
  export JWT_SECRET=evil MONGO_ROOT_PASSWORD=evil PORT=1 ADMIN_PASSWORD=evil COOKIE_SECRET=evil MONGO_APP_USERNAME=evil
  prepare_env >/dev/null 2>&1
  echo "JWT=${JWT_SECRET-unset} PW=${MONGO_ROOT_PASSWORD-unset} PORT=${PORT-unset} ADMIN=${ADMIN_PASSWORD-unset} COOKIE=${COOKIE_SECRET-unset} APPUSER=${MONGO_APP_USERNAME-unset} PROJ=$COMPOSE_PROJECT_NAME"
) 2>&1 )"
expect_eq "prepare_env gỡ biến shell, đặt project staging" \
  "JWT=unset PW=unset PORT=unset ADMIN=unset COOKIE=unset APPUSER=unset PROJ=realestate-staging" "$pe"
# Và không làm rò rỉ ra shell cha:
expect_eq "prepare_env chạy trong subshell không đổi shell cha" "${COMPOSE_PROJECT_NAME-unset}" "${COMPOSE_PROJECT_NAME-unset}"

# ── deploy.sh: check_staging_vars (M-c, M-d) ─────────────────────────────────
# `deploy.sh --help` thoát 0 nếu qua kiểm tra nạp script (không cần Docker); lỗi kiểm tra thì thoát 1 trước cả khi in trợ giúp.
dep_rc() { # "<VAR=giá trị ...>" : chạy trong môi trường sạch (env -i)
  local out rc=0
  # shellcheck disable=SC2086  # tách từ có chủ ý: mỗi phần tử là một VAR=giá-trị không chứa khoảng trắng
  out="$(env -i PATH="$PATH" HOME="${HOME:-/}" $1 bash "$ROOT_DIR/deploy.sh" --help 2>&1)" || rc=$?
  printf 'rc=%s | %s' "$rc" "$(printf '%s' "$out" | head -n 3)"
}
check_dep() { # mô tả rc chuỗi "<VAR=...>"
  local res; res="$(dep_rc "$4")"
  expect_eq "deploy.sh: $1 (rc)" "rc=$2" "${res%% |*}"
  [[ -z "$3" ]] || expect_contains "deploy.sh: $1 (thông báo)" "$3" "$res"
}
STG_COMPOSE="COMPOSE_PROJECT_NAME=realestate-staging COMPOSE_FILE=docker-compose.yml;docker-compose.staging.yml"
check_dep "không đặt biến nào (production)"        0 ""              "X=1"
check_dep "DEPLOY_LOGS_DIR=/ bị chặn"              1 "không hợp lệ"  "DEPLOY_LOGS_DIR=/ $STG_COMPOSE"
check_dep "DEPLOY_LOGS_DIR=/etc bị chặn"           1 "không hợp lệ"  "DEPLOY_LOGS_DIR=/etc $STG_COMPOSE"
check_dep "DEPLOY_LOGS_DIR=.. bị chặn"             1 "không hợp lệ"  "DEPLOY_LOGS_DIR=.. $STG_COMPOSE"
check_dep "DEPLOY_LOGS_DIR=a/../b bị chặn"         1 "không hợp lệ"  "DEPLOY_LOGS_DIR=a/../b $STG_COMPOSE"
check_dep "DEPLOY_LOGS_DIR=. bị chặn"              1 "không hợp lệ"  "DEPLOY_LOGS_DIR=. $STG_COMPOSE"
check_dep "DEPLOY_LOGS_DIR=a/./b bị chặn"          1 "không hợp lệ"  "DEPLOY_LOGS_DIR=a/./b $STG_COMPOSE"
check_dep "DEPLOY_BACKUP_DIR=\$(x) bị chặn"        1 "không hợp lệ"  "DEPLOY_BACKUP_DIR=\$(x) $STG_COMPOSE"
check_dep "DEPLOY_ENV_FILE=/abs bị chặn"           1 "không hợp lệ"  "DEPLOY_ENV_FILE=/abs/env $STG_COMPOSE"
check_dep "DEPLOY_RUNTIME_ENV_FILE=../x bị chặn"   1 "không hợp lệ"  "DEPLOY_RUNTIME_ENV_FILE=../x $STG_COMPOSE"
check_dep "DEPLOY_LOGS_DIR rỗng = mặc định"        0 ""              "DEPLOY_LOGS_DIR="
check_dep "đường dẫn hợp lệ + qua wrapper"         0 ""              "DEPLOY_LOGS_DIR=.staging/logs DEPLOY_BACKUP_DIR=.staging/backups DEPLOY_ENV_FILE=.staging/env DEPLOY_RUNTIME_ENV_FILE=.staging/backend.env NINE_ROUTER_CONTAINER= $STG_COMPOSE"
check_dep "biến staging, không có project/file"    1 "ngoài wrapper" "DEPLOY_LOGS_DIR=.staging/logs"
check_dep "biến staging, project sai"              1 "ngoài wrapper" "DEPLOY_LOGS_DIR=.staging/logs COMPOSE_PROJECT_NAME=realestatemanager COMPOSE_FILE=docker-compose.yml;docker-compose.staging.yml"
check_dep "biến staging, thiếu COMPOSE_FILE staging" 1 "ngoài wrapper" "DEPLOY_ENV_FILE=.staging/env COMPOSE_PROJECT_NAME=realestate-staging"
check_dep "NINE_ROUTER_CONTAINER rỗng ngoài wrapper" 1 "ngoài wrapper" "NINE_ROUTER_CONTAINER="
check_dep "NINE_ROUTER_CONTAINER = mặc định"       0 ""              "NINE_ROUTER_CONTAINER=realestate_9router"
check_dep "COMPOSE_FILE staging mà project khác"   1 "dễ chạm nhầm"  "COMPOSE_PROJECT_NAME=realestatemanager COMPOSE_FILE=docker-compose.yml;docker-compose.staging.yml"
check_dep "COMPOSE_FILE staging, không đặt project" 1 "dễ chạm nhầm" "COMPOSE_FILE=docker-compose.yml;docker-compose.staging.yml"
check_dep "project staging + file staging, không biến DEPLOY_*" 0 "" "$STG_COMPOSE"

# Mặc định (không đặt biến) phải y hệt bản cũ: in giá trị đã giải của các hằng số trong môi trường sạch.
mkdir -p "$TMP/dep/scripts/lib"
cp "$ROOT_DIR/deploy.sh" "$TMP/dep/deploy.sh"
cp "$ROOT_DIR/scripts/lib/ops-common.sh" "$TMP/dep/scripts/lib/ops-common.sh"
sed -i 's/^main "\$@"$/printf "%s|%s|%s|%s|[%s]|%s|%s" "$ENV_FILE" "$RUNTIME_ENV_FILE" "$LOGS_DIR" "$BACKUP_DIR" "$NINE_ROUTER_CONTAINER" "$MONGO_CONTAINER" "$BACKEND_CONTAINER"; exit 0/' "$TMP/dep/deploy.sh"
defaults="$(env -i PATH="$PATH" HOME="${HOME:-/}" bash "$TMP/dep/deploy.sh" 2>&1)"
expect_eq "deploy.sh mặc định (env -i) y hệt bản cũ" ".env.docker|.env|logs|backups|[realestate_9router]|realestate_mongo|realestate_backend" "$defaults"

# ── T-18: restore-dump / snapshot (FR-21) ────────────────────────────────────
# Chạy staging.sh THẬT với `docker` stub đứng đầu PATH: stub ghi mọi lệnh gọi vào $DOCKER_CALLS rồi thoát 1. Các trường hợp bị từ chối
# phải dừng TRƯỚC mọi lệnh Docker (nhật ký không tồn tại). STAGING_ALLOW_DOCKER_HOST=1 để guard không gọi `docker context inspect`.
mkdir -p "$TMP/stubbin"
cat > "$TMP/stubbin/docker" <<'STUB'
#!/bin/bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
exit 1
STUB
chmod +x "$TMP/stubbin/docker"
printf 'not-a-real-dump' > "$TMP/outside.archive.gz"
rd_rc() { # "<VAR=giá trị ...>" <đối số staging.sh ...>: môi trường sạch (env -i), in "rc=<mã> | output"; xóa nhật ký docker trước
  local envs="$1" out rc=0
  shift
  rm -f "$TMP/docker.calls"
  # shellcheck disable=SC2086  # tách từ có chủ ý: mỗi phần tử là VAR=giá-trị không chứa khoảng trắng
  out="$(env -i PATH="$TMP/stubbin:$PATH" HOME="${HOME:-/}" DOCKER_CALLS="$TMP/docker.calls" STAGING_ALLOW_DOCKER_HOST=1 $envs bash "$ROOT_DIR/scripts/staging.sh" "$@" 2>&1 </dev/null)" || rc=$?
  printf 'rc=%s | %s' "$rc" "$out"
}
check_rd() { # mô tả rc chuỗi_phải_có "<VAR=...>" đối_số...
  local desc="$1" rc="$2" want="$3" envs="$4" res calls="no-docker-calls"
  shift 4
  res="$(rd_rc "$envs" "$@")"
  [[ ! -e "$TMP/docker.calls" ]] || calls="docker-calls: $(cat "$TMP/docker.calls")"
  expect_eq "restore-dump: $desc (rc)" "rc=$rc" "${res%% |*}"
  [[ -z "$want" ]] || expect_contains "restore-dump: $desc (thông báo)" "$want" "$res"
  expect_eq "restore-dump: $desc (không gọi docker)" "no-docker-calls" "$calls"
}
check_rd "thiếu archive"                       1 "Thiếu đường dẫn archive" "X=1" restore-dump --yes
check_rd "thiếu --yes (không hỏi tương tác)"   1 "bắt buộc thêm --yes"    "X=1" restore-dump "$TMP/outside.archive.gz"
check_rd "ASSUME_YES chung chung không tính"   1 "bắt buộc thêm --yes"    "ASSUME_YES=1" restore-dump "$TMP/outside.archive.gz"
check_rd "tùy chọn lạ"                         1 "không hợp lệ"           "X=1" restore-dump --force "$TMP/outside.archive.gz" --yes
check_rd "hai archive"                         1 "MỘT đường dẫn"          "X=1" restore-dump a b --yes
check_rd "MONGO_CONTAINER=realestate_mongo (prod) bị từ chối" 1 "Từ chối" "MONGO_CONTAINER=realestate_mongo" restore-dump "$TMP/outside.archive.gz" --yes
check_rd "BACKEND_CONTAINER=realestate_backend bị từ chối"    1 "Từ chối" "BACKEND_CONTAINER=realestate_backend" restore-dump "$TMP/outside.archive.gz" --yes
check_rd "COMPOSE_PROJECT_NAME=realestate-dev bị từ chối"     1 "Từ chối" "COMPOSE_PROJECT_NAME=realestate-dev" restore-dump "$TMP/outside.archive.gz" --yes
check_rd "cổng backend 27017 (mongo dev) bị từ chối"          1 "thuộc dev/prod" "STAGING_BACKEND_PORT=27017" restore-dump "$TMP/outside.archive.gz" --yes
check_rd "STAGING_ASSUME_YES=1 KHÔNG thay được --yes" 1 "bắt buộc thêm --yes" "STAGING_ASSUME_YES=1" restore-dump "$TMP/outside.archive.gz"
check_rd "archive ngoài .staging/ bị từ chối"  1 "NGOÀI .staging"         "X=1" restore-dump "$TMP/outside.archive.gz" --yes
check_rd "archive không tồn tại"               1 "Không thấy file"        "X=1" restore-dump "$TMP/nope.gz" --yes
check_rd "archive là thư mục"                  1 "Không thấy file"        "X=1" restore-dump "$TMP" --yes
check_rd "snapshot nhãn chứa ký tự lạ"         1 "Nhãn snapshot"          "X=1" snapshot 'a/../b'
check_rd "runner thiếu lệnh"                  1 "Thiếu lệnh runner"      "X=1" runner
check_rd "runner với project dev bị từ chối"   1 "Từ chối"                "COMPOSE_PROJECT_NAME=realestate-dev" runner status
check_rd "step3 với container prod bị từ chối" 1 "Từ chối"                "MONGO_CONTAINER=realestate_mongo" step3

# resolve_dump_archive (hàm trích nguyên văn): chấp nhận file gzip thật trong <root>/.staging/, từ chối phần còn lại. ROOT_DIR đổi sang thư mục tạm.
mkdir -p "$TMP/rd/.staging/sub" "$TMP/rd/other"
printf 'dump giả' | gzip > "$TMP/rd/.staging/ok.archive.gz"
printf 'dump giả' | gzip > "$TMP/rd/.staging/sub/ok2.archive.gz"
printf 'dump giả' | gzip > "$TMP/rd/other/outside.gz"
: > "$TMP/rd/.staging/empty.gz"
printf 'khong phai gzip' > "$TMP/rd/.staging/plain.gz"
ln -s "$TMP/rd/other/outside.gz" "$TMP/rd/.staging/link.gz" 2>/dev/null || true
rda() { local out rc=0; out="$( ( ROOT_DIR="$TMP/rd"; resolve_dump_archive "$1" ) 2>&1 )" || rc=$?; printf 'rc=%s | %s' "$rc" "$out"; }
res="$(rda "$TMP/rd/.staging/ok.archive.gz")";       expect_eq "resolve: file gzip trong .staging được nhận" "rc=0 | $(readlink -f "$TMP/rd/.staging/ok.archive.gz")" "$res"
res="$(rda "$TMP/rd/.staging/sub/ok2.archive.gz")";  expect_eq "resolve: thư mục con của .staging được nhận" "rc=0 | $(readlink -f "$TMP/rd/.staging/sub/ok2.archive.gz")" "$res"
res="$(rda "$TMP/rd/other/outside.gz")";             expect_contains "resolve: file ngoài .staging bị từ chối" "NGOÀI" "$res"
res="$(rda "$TMP/rd/.staging/../other/outside.gz")"; expect_contains "resolve: .. thoát khỏi .staging bị từ chối" "NGOÀI" "$res"
if [[ -L "$TMP/rd/.staging/link.gz" ]]; then
  res="$(rda "$TMP/rd/.staging/link.gz")";           expect_contains "resolve: symlink trỏ ra ngoài bị từ chối" "NGOÀI" "$res"
fi
res="$(rda "$TMP/rd/.staging/empty.gz")";            expect_contains "resolve: file rỗng bị từ chối" "rỗng" "$res"
res="$(rda "$TMP/rd/.staging/plain.gz")";            expect_contains "resolve: không phải gzip bị từ chối" "không phải gzip" "$res"
res="$(rda "$TMP/rd/.staging/missing.gz")";          expect_contains "resolve: thiếu file bị từ chối" "Không thấy file" "$res"
res="$(rda "$TMP/rd/.staging")";                     expect_contains "resolve: thư mục bị từ chối" "Không thấy file" "$res"
res="$(rda "")";                                     expect_contains "resolve: đường dẫn rỗng bị từ chối" "Thiếu đường dẫn" "$res"

# Tĩnh (đọc mã nguồn thật): restore-dump chỉ nhắm $STG_MONGO, mongorestore luôn --drop + --nsInclude "realestate.*", không nhắc tên container
# dev/prod, chỉ MỘT dropDatabase (realestate); .staging/ nằm trong .gitignore và không có dump nào được git theo dõi.
rd_src="$(sed -n '/^cmd_restore_dump() {/,/^}/p' "$ROOT_DIR/scripts/staging.sh")"
expect_contains "tĩnh: mongorestore có --drop"            '--drop'                                    "$rd_src"
expect_contains "tĩnh: mongorestore giới hạn --nsInclude" '--nsInclude "realestate.*"'                "$rd_src"
expect_contains "tĩnh: chạy trong container staging"      'docker exec -i "$STG_MONGO"'               "$rd_src"
expect_contains "tĩnh: dropDatabase chỉ realestate"       "getSiblingDB('realestate').dropDatabase()" "$rd_src"
expect_eq "tĩnh: restore-dump không nhắc container dev/prod" "0" "$(grep -cE 'realestate_(mongo|backend|dev)|realestate-dev' <<<"$rd_src" || true)"
expect_eq "tĩnh: restore-dump chỉ có MỘT dropDatabase"       "1" "$(grep -c 'dropDatabase' <<<"$rd_src" || true)"
expect_eq "tĩnh: mọi docker exec/run/rm/cp trong restore-dump nhắm STG_MONGO" "0" "$(grep -E 'docker (exec|run|rm|cp)' <<<"$rd_src" | grep -vc 'STG_MONGO' || true)"
if git -C "$ROOT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  expect_eq "git: .staging/ được ignore"           ".staging/x.gz" "$(git -C "$ROOT_DIR" check-ignore .staging/x.gz)"
  expect_eq "git: .staging/snapshots/ được ignore" ".staging/snapshots/a.json" "$(git -C "$ROOT_DIR" check-ignore .staging/snapshots/a.json)"
  expect_eq "git: không có file nào dưới .staging/ được theo dõi" "0" "$(git -C "$ROOT_DIR" ls-files -- .staging | wc -l | tr -d ' ')"
fi
# Snapshot chỉ đọc: script mongosh không có lệnh ghi/xóa.
expect_eq "snapshot.js không có lệnh ghi/xóa" "0" "$(grep -cE '\.(insert|update|delete|drop|remove|createIndex|dropIndex|save|replace|bulkWrite|renameCollection)[A-Za-z]*\(|dropDatabase' "$ROOT_DIR/scripts/staging/rehearsal-snapshot.js" || true)"

# ── shim docker: chỉ đổi đường dẫn host sau cờ đường dẫn ────────────────────
if command -v cygpath >/dev/null 2>&1; then
  mkdir -p "$TMP/bin" "$TMP/shimdir"
  printf '#!/bin/bash\nprintf "%%s\\n" "$@"\n' > "$TMP/bin/docker"
  chmod +x "$TMP/bin/docker"
  cp "$ROOT_DIR/scripts/staging/shims/docker" "$TMP/shimdir/docker"
  chmod +x "$TMP/shimdir/docker"
  printf 'x' > "$TMP/hostfile"
  winpath="$(cygpath -w "$TMP/hostfile")"
  mapfile -t got < <(PATH="$TMP/shimdir:$TMP/bin:$PATH" STAGING_SHIM_DIR="$TMP/shimdir" bash "$TMP/shimdir/docker" \
    compose --env-file "$TMP/hostfile" -f "$TMP/hostfile" "--file=$TMP/hostfile" run /tmp "$TMP/hostfile" --file /dev/stdin -v "$TMP/hostfile:/x")
  expect_eq "shim: --env-file đổi sang đường dẫn Windows" "$winpath" "${got[2]:-}"
  expect_eq "shim: -f đổi"                                 "$winpath" "${got[4]:-}"
  expect_eq "shim: --file=giá-trị đổi"                     "--file=$winpath" "${got[5]:-}"
  expect_eq "shim: /tmp (đối số thường) giữ nguyên"        "/tmp" "${got[7]:-}"
  expect_eq "shim: đường dẫn host KHÔNG sau cờ giữ nguyên" "$TMP/hostfile" "${got[8]:-}"
  expect_eq "shim: --file /dev/stdin giữ nguyên"           "/dev/stdin" "${got[10]:-}"
  expect_eq "shim: -v host:container giữ nguyên"           "$TMP/hostfile:/x" "${got[12]:-}"
else
  echo "(bỏ qua test shim docker: không có cygpath)"
fi

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
