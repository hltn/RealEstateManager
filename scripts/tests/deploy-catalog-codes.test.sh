#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/tests/deploy-catalog-codes.test.sh — test shell KHÔNG cần Docker/Mongo thật cho bước 8c của deploy.sh (T-17, v1.0.4):
#   - bước bù `node dist/migrations/crm-catalog-codes.cli.js --apply` chạy SAU `up` và SAU wait_backend_liveness (thứ tự gọi trong main)
#   - lệnh bù thoát mã khác 0 => cảnh báo đỏ ở stderr, deploy exit khác 0 (không chạy tiếp `compose ps`/"Deploy xong")
#   - lệnh bù thoát 0 => deploy xong, exit 0
#   - log $LOGS_DIR/deploy-catalog-codes-<TS>.log được ghi (cả khi thành công lẫn thất bại)
#   - downgrade có chủ ý => bỏ qua bước bù
# Hàm (main, compose, run_catalog_codes_cli, apply_catalog_codes) được TRÍCH từ deploy.sh thật bằng sed, KHÔNG chép tay. Các bước khác
# của main (git, backup, build, migration...) và `docker` được thay bằng stub ghi thứ tự gọi vào file; không chạm Docker thật.
# Chỉ kiểm lớp shell (thứ tự, mã thoát, log, cách gọi). Chạy bước bù với Mongo thật là việc của T-18 (bản sao dữ liệu).
#
# Chạy:  bash scripts/tests/deploy-catalog-codes.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034,SC2329,SC2016  # biến/hàm dùng qua eval các hàm trích từ deploy.sh; nháy đơn có chủ ý
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

LOG_PREFIX="test"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

extract_fn() { sed -n "/^$1() {/,/^}/p" "$ROOT_DIR/deploy.sh"; }
# run_catalog_codes_cli và compose là hàm một dòng: sed trên `^name() {` ... `^}` không bắt được khi đóng `}` nằm cùng dòng.
extract_oneliner() { grep -E "^$1\(\) \{.*\}$" "$ROOT_DIR/deploy.sh"; }
for fn in apply_catalog_codes main; do
  src="$(extract_fn "$fn")"
  [[ -n "$src" ]] || { echo "Không trích được $fn từ deploy.sh" >&2; exit 2; }
  eval "$src"
done
for fn in run_catalog_codes_cli compose; do
  src="$(extract_oneliner "$fn")"
  [[ -n "$src" ]] || { echo "Không trích được $fn từ deploy.sh" >&2; exit 2; }
  eval "$src"
done

# ── Stub ─────────────────────────────────────────────────────────────────────
# ORDER_FILE ghi mỗi lần gọi theo thứ tự. docker: ghi "docker <đối số>"; lệnh bù (có crm-catalog-codes.cli.js) in đầu ra giả và
# thoát $FAKE_CC_RC (mặc định 0). Các bước khác của main chỉ ghi tên.
docker() {
  printf 'docker %s\n' "$*" >> "$ORDER_FILE"
  if [[ "$*" == *crm-catalog-codes.cli.js* ]]; then
    echo "FAKE: bù mã danh mục (rc=${FAKE_CC_RC:-0})"
    return "${FAKE_CC_RC:-0}"
  fi
  return 0
}
for stub in check_prereqs acquire_lock git_update check_compose check_users_migrated ensure_runtime_dirs backup_mongo \
            tag_current_backend_image build_backend migration_gate wait_mongo_healthy wait_backend_liveness sync_system_version; do
  eval "$stub() { printf '%s\n' '$stub' >> \"\$ORDER_FILE\"; return 0; }"
done
require_free_disk_gb() { printf 'require_free_disk_gb\n' >> "$ORDER_FILE"; return 0; }
inspect_field() { printf 'running'; }

ENV_FILE=".env.docker"
NINE_ROUTER_CONTAINER=""
TS="20260101-000000"
NEW_COMMIT="abc1234"
PREV_IMAGE_TAG=""
BACKUP_FILE=""
DOC="docs/01_Infrastructure/06_Production_Deploy.md"
DEPLOY_MIN_FREE_GB=5

# Chạy main trong subshell có `set -euo pipefail` (giống deploy.sh thật). In "rc=<mã>" ở dòng cuối; stdout+stderr vào $TMP/out.
run_main() { # <FAKE_CC_RC> [DOWNGRADE_ACTIVE]
  local rc=0
  : > "$ORDER_FILE"
  rm -rf "$TMP/logs"
  (
    set -euo pipefail
    export FAKE_CC_RC="$1"
    LOGS_DIR="$TMP/logs"
    AUTO_MIGRATE=1; ALLOW_DOWNGRADE=0; MONGO_TIMEOUT=120; HEALTH_TIMEOUT=120; DUMP_TIMEOUT=900; OPS_EXEC_TIMEOUT=300
    NO_PULL=0; PLAN_ONLY=0; STACK_TOUCHED=0; DOWNGRADE_ACTIVE="${2:-0}"
    main --no-pull
  ) > "$TMP/out" 2>&1 || rc=$?
  echo "$rc"
}
ORDER_FILE="$TMP/order"

# ── Ca 1: lệnh bù thành công ─────────────────────────────────────────────────
rc="$(run_main 0)"
out="$(cat "$TMP/order")"
expect_eq "thành công: exit 0" "0" "$rc"
mapfile -t order < "$TMP/order"
idx() { local i; for i in "${!order[@]}"; do [[ "${order[$i]}" == *"$1"* ]] && { echo "$i"; return; }; done; echo -1; }
i_up="$(idx 'up -d --build')"
i_live="$(idx wait_backend_liveness)"
i_sync="$(idx sync_system_version)"
i_cc="$(idx crm-catalog-codes.cli.js)"
i_ps="$(idx ' ps')"
(( i_up >= 0 && i_cc >= 0 )) && ok || fail "thiếu lệnh up hoặc lệnh bù trong thứ tự gọi: $out"
(( i_cc > i_up )) && ok || fail "lệnh bù phải chạy SAU up (up=$i_up, bù=$i_cc)"
(( i_cc > i_live )) && ok || fail "lệnh bù phải chạy SAU wait_backend_liveness (live=$i_live, bù=$i_cc)"
(( i_cc > i_sync )) && ok || fail "lệnh bù phải chạy SAU sync_system_version (sync=$i_sync, bù=$i_cc)"
(( i_ps > i_cc )) && ok || fail "compose ps phải chạy SAU lệnh bù (bù=$i_cc, ps=$i_ps)"
cc_line="$(grep 'crm-catalog-codes.cli.js' "$TMP/order")"
expect_contains "gọi qua compose run vào service backend" "compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/crm-catalog-codes.cli.js --apply" "$cc_line"
expect_eq "đúng một lần gọi lệnh bù" "1" "$(grep -c 'crm-catalog-codes.cli.js' "$TMP/order")"
logfile="$TMP/logs/deploy-catalog-codes-20260101-000000.log"
[[ -f "$logfile" ]] && ok || fail "không thấy file log $logfile"
expect_contains "log chứa đầu ra lệnh bù" "FAKE: bù mã danh mục (rc=0)" "$(cat "$logfile" 2>/dev/null)"
expect_contains "stdout có dòng xong" "Bù mã danh mục xong" "$(cat "$TMP/out")"
expect_contains "deploy báo xong" "Deploy xong" "$(cat "$TMP/out")"

# ── Ca 2: lệnh bù thất bại (mã 1) ────────────────────────────────────────────
rc="$(run_main 1)"
expect_eq "lệnh bù mã 1: deploy exit 1" "1" "$rc"
o="$(cat "$TMP/out")"
expect_contains "lệnh bù mã 1: cảnh báo THẤT BẠI" "THẤT BẠI (mã 1)" "$o"
expect_contains "lệnh bù mã 1: có mã màu đỏ" $'\033[1;31m' "$o"
expect_contains "lệnh bù mã 1: báo LỖI deploy" "deploy báo LỖI" "$o"
expect_not_contains "lệnh bù mã 1: KHÔNG in 'Deploy xong'" "Deploy xong" "$o"
expect_not_contains "lệnh bù mã 1: KHÔNG chạy compose ps" " ps" "$(cat "$TMP/order")"
[[ -f "$logfile" ]] && ok || fail "lệnh bù lỗi vẫn phải ghi log"
expect_contains "lệnh bù mã 1: log chứa đầu ra" "FAKE: bù mã danh mục (rc=1)" "$(cat "$logfile" 2>/dev/null)"

# ── Ca 3: lệnh bù sai tham số (mã 2) cũng làm deploy lỗi ─────────────────────
rc="$(run_main 2)"
expect_eq "lệnh bù mã 2: deploy exit 1" "1" "$rc"
expect_contains "lệnh bù mã 2: cảnh báo THẤT BẠI" "THẤT BẠI (mã 2)" "$(cat "$TMP/out")"

# ── Ca 4: downgrade có chủ ý => bỏ qua bước bù ──────────────────────────────
rc="$(run_main 1 1)"
expect_eq "downgrade: deploy exit 0 (bỏ qua bước bù)" "0" "$rc"
expect_eq "downgrade: không gọi lệnh bù" "0" "$(grep -c 'crm-catalog-codes.cli.js' "$TMP/order")"

# ── Tĩnh: deploy.sh nhắc ngoại lệ lùi image 007/008 ─────────────────────────
expect_contains "print_recovery nhắc ngoại lệ 007/008" "NGOẠI LỆ migration 007/008" "$(cat "$ROOT_DIR/deploy.sh")"

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
