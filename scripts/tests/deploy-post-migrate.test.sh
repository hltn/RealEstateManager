#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/tests/deploy-post-migrate.test.sh — test shell KHÔNG cần Docker/Mongo thật cho điểm gọi hậu-migrate v1.0.5 (T-17, FR-21/FR-23):
#   - thứ tự 10 -> 20 -> 90 (tệp bước THẬT chạy bằng `bash`, `docker` giả export -f), bước lỗi dừng các bước sau, downgrade bỏ qua toàn bộ
#   - mỗi bước đúng đối số lệnh và đúng tên log: deploy-customer-codes-<TS>.log, deploy-post-up-<TS>.log
#   - bước 90: cổng chặn đọc `status --json`, TỪ CHỐI (thoát 1, KHÔNG gọi reconcile) khi còn migration pre-up chờ (gồm 010), khi status lỗi
#     (khóa/baseline/không đọc được), khi không có danh sách chờ; chỉ chạy `reconcile --apply --by deploy --skip-version --phase post-up`
#     khi không còn pre-up chờ
#   - 6b (dry-run + apply), 8a, 8b của deploy.sh đều truyền `--phase pre-up` (hàm THẬT trích từ deploy.sh bằng sed)
#   - deploy.sh không còn logic bù mã ngoài điểm gọi chung; print_recovery/usage nêu "sau bước 90 chỉ sửa tiến" và cách kiểm 011
# Chỉ kiểm lớp shell (thứ tự, mã thoát, log, đối số, cổng chặn). Chạy với Mongo thật là việc của T-34/T-36.
#
# Chạy:  bash scripts/tests/deploy-post-migrate.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
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
extract_oneliner() { grep -E "^$1\(\) \{.*\}$" "$ROOT_DIR/deploy.sh"; }
for fn in run_post_migrate_steps reconcile_dry_run auto_reconcile fresh_install_reconcile sync_system_version print_recovery usage; do
  src="$(extract_fn "$fn")"
  [[ -n "$src" ]] || { echo "Không trích được $fn từ deploy.sh" >&2; exit 2; }
  eval "$src"
done
for fn in run_migration_cli runner_cmd_hint compose; do
  src="$(extract_oneliner "$fn")"
  [[ -n "$src" ]] || { echo "Không trích được $fn từ deploy.sh" >&2; exit 2; }
  eval "$src"
done

# ── Stub ─────────────────────────────────────────────────────────────────────
# ORDER_FILE ghi mỗi lần gọi docker theo thứ tự. Điều khiển bằng biến môi trường:
#   FAKE_CC_RC / FAKE_CU_RC        mã thoát của CLI bù mã danh mục / khách (mặc định 0)
#   FAKE_STATUS_OUT / FAKE_STATUS_RC  đầu ra và mã thoát của `cli.js status --json` (mặc định: không còn pre-up chờ, chỉ 011 post-up)
#   FAKE_POSTUP_RC                 mã thoát của `reconcile ... --phase post-up` (bước 90)
#   FAKE_RECONCILE_RC              mã thoát của `reconcile` khác (pre-up)
docker() {
  printf 'docker %s\n' "$*" >> "$ORDER_FILE"
  if [[ "$*" == *crm-catalog-codes.cli.js* ]]; then echo "FAKE: bù mã danh mục (rc=${FAKE_CC_RC:-0})"; return "${FAKE_CC_RC:-0}"; fi
  if [[ "$*" == *crm-customer-codes.cli.js* ]]; then echo "FAKE: bù mã khách (rc=${FAKE_CU_RC:-0})"; return "${FAKE_CU_RC:-0}"; fi
  if [[ "$*" == *migrations/cli.js\ status* ]]; then
    printf '%s\n' "${FAKE_STATUS_OUT-$DEFAULT_STATUS}"
    return "${FAKE_STATUS_RC:-0}"
  fi
  if [[ "$*" == *migrations/cli.js\ reconcile*--phase\ post-up* ]]; then
    echo "FAKE: reconcile post-up (rc=${FAKE_POSTUP_RC:-0})"
    return "${FAKE_POSTUP_RC:-0}"
  fi
  if [[ "$*" == *migrations/cli.js\ reconcile* ]]; then
    echo "FAKE: reconcile pre-up (rc=${FAKE_RECONCILE_RC:-0})"
    return "${FAKE_RECONCILE_RC:-0}"
  fi
  return 0
}
export -f docker
# Dạng JSON thật của `status --json` (thứ tự khóa như migration-runner.ts): pending nằm giữa applied và locked.
DEFAULT_STATUS='{"appVersion":"1.0.5","appCommit":"abc","systemVersion":{"value":"1.0.4"},"applied":[{"id":"010_crm_customer_code_index"}],"pending":[{"id":"011_crm_drop_unique_phone","description":"d","phase":"post-up"}],"locked":null,"lastError":null,"baselineRequired":false,"replicaSet":true}'
export DEFAULT_STATUS
mongo_is_healthy() { return 0; }
inspect_field() { printf 'running'; }

ENV_FILE=".env.docker"
TS="20260101-000000"
DOC="docs/01_Infrastructure/06_Production_Deploy.md"
ORDER_FILE="$TMP/order"; export ORDER_FILE
STEP_ENV=(ENV_FILE="$ENV_FILE" LOGS_DIR="$TMP/logs" TS="$TS" DOC="$DOC" LOG_PREFIX="test")

# Chạy MỘT tệp bước THẬT trong subshell; stdout+stderr vào $TMP/out; in "rc=<mã>". Ghi đè biến FAKE_* ở môi trường gọi.
run_step() { # <tên tệp bước>
  local rc=0
  : > "$ORDER_FILE"; rm -rf "$TMP/logs"
  env "${STEP_ENV[@]}" bash "$ROOT_DIR/scripts/post-migrate/$1" > "$TMP/out" 2>&1 || rc=$?
  echo "$rc"
}
calls() { grep -c "$1" "$ORDER_FILE" || true; }

# ── Bước 20: bù mã khách ─────────────────────────────────────────────────────
rc="$(run_step 20-customer-codes.sh)"
expect_eq "20 thành công: exit 0" "0" "$rc"
expect_eq "20: gọi đúng một lệnh qua compose run vào service backend" \
  "docker compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/crm-customer-codes.cli.js --apply" "$(cat "$ORDER_FILE")"
expect_contains "20: log chứa đầu ra lệnh bù" "FAKE: bù mã khách (rc=0)" "$(cat "$TMP/logs/deploy-customer-codes-$TS.log" 2>/dev/null)"
expect_contains "20: stdout có dòng xong" "Bù mã khách xong" "$(cat "$TMP/out")"
rc="$(FAKE_CU_RC=1 run_step 20-customer-codes.sh)"
expect_eq "20 lỗi mã 1: exit 1" "1" "$rc"
o="$(cat "$TMP/out")"
expect_contains "20 lỗi: cảnh báo THẤT BẠI kèm mã" "THẤT BẠI (mã 1)" "$o"
expect_contains "20 lỗi: có mã màu đỏ" $'\033[1;31m' "$o"
expect_contains "20 lỗi: báo LỖI deploy" "deploy báo LỖI" "$o"
expect_contains "20 lỗi: vẫn ghi log" "FAKE: bù mã khách (rc=1)" "$(cat "$TMP/logs/deploy-customer-codes-$TS.log" 2>/dev/null)"
rc="$(FAKE_CU_RC=2 run_step 20-customer-codes.sh)"
expect_eq "20 lỗi mã 2: exit 1" "1" "$rc"

# ── Bước 90: cổng chặn + migration post-up ───────────────────────────────────
POSTUP_CMD="docker compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/cli.js reconcile --apply --by deploy --skip-version --phase post-up"
STATUS_CMD="docker compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/cli.js status --json"
rc="$(run_step 90-post-up-migrations.sh)"
expect_eq "90 thành công (không còn pre-up chờ): exit 0" "0" "$rc"
mapfile -t order < "$ORDER_FILE"
expect_eq "90: đúng 2 lệnh docker (status rồi reconcile)" "2" "${#order[@]}"
expect_eq "90: lệnh 1 là status --json (cổng chặn chạy TRƯỚC --apply)" "$STATUS_CMD" "${order[0]:-}"
expect_eq "90: lệnh 2 là reconcile --apply --by deploy --skip-version --phase post-up" "$POSTUP_CMD" "${order[1]:-}"
logfile="$TMP/logs/deploy-post-up-$TS.log"
[[ -f "$logfile" ]] && ok || fail "không thấy log $logfile"
expect_contains "90: log chứa đầu ra reconcile" "FAKE: reconcile post-up (rc=0)" "$(cat "$logfile" 2>/dev/null)"
expect_contains "90: stdout có dòng xong" "Migration post-up xong" "$(cat "$TMP/out")"

# pending rỗng (011 đã áp dụng từ lần trước): vẫn chạy reconcile (idempotent, no-op ở runner), không từ chối.
rc="$(FAKE_STATUS_OUT='{"appVersion":"1.0.5","applied":[],"pending":[],"locked":null,"baselineRequired":false}' run_step 90-post-up-migrations.sh)"
expect_eq "90, pending rỗng: exit 0" "0" "$rc"
expect_eq "90, pending rỗng: có gọi reconcile post-up" "1" "$(calls 'phase post-up')"

# description chứa `]` và chuỗi giống "phase":"pre-up" (đã escape) KHÔNG làm cổng chặn nhầm; chỉ trường phase thật mới tính.
rc="$(FAKE_STATUS_OUT='{"pending":[{"id":"011_x","description":"a ] b \"phase\":\"pre-up\" c","phase":"post-up"}],"locked":null}' run_step 90-post-up-migrations.sh)"
expect_eq "90, mô tả chứa ] và chuỗi giống phase: exit 0 (không từ chối nhầm)" "0" "$rc"

# CỔNG CHẶN: 010 chưa áp dụng (pre-up chờ) => TỪ CHỐI, KHÔNG gọi reconcile, KHÔNG ghi gì.
PRE010='{"appVersion":"1.0.5","applied":[],"pending":[{"id":"010_crm_customer_code_index","description":"d","phase":"pre-up"},{"id":"011_crm_drop_unique_phone","description":"d","phase":"post-up"}],"locked":null,"baselineRequired":false}'
rc="$(FAKE_STATUS_OUT="$PRE010" run_step 90-post-up-migrations.sh)"
expect_eq "90, 010 chưa áp dụng: exit 1" "1" "$rc"
o="$(cat "$TMP/out")"
expect_contains "90, 010 chưa áp dụng: nêu TỪ CHỐI" "TỪ CHỐI" "$o"
expect_contains "90, 010 chưa áp dụng: nêu mã 010 còn chờ" "010_crm_customer_code_index" "$o"
expect_contains "90, 010 chưa áp dụng: có mã màu đỏ" $'\033[1;31m' "$o"
expect_eq "90, 010 chưa áp dụng: KHÔNG gọi reconcile" "0" "$(calls 'migrations/cli.js reconcile')"
expect_eq "90, 010 chưa áp dụng: chỉ gọi status" "1" "$(wc -l < "$ORDER_FILE" | tr -d ' ')"
expect_contains "90, từ chối: vẫn ghi log" "010_crm_customer_code_index" "$(cat "$logfile" 2>/dev/null)"
# Một migration pre-up chờ bất kỳ (vd 012 của bản sau) cũng chặn.
rc="$(FAKE_STATUS_OUT='{"pending":[{"id":"012_next","description":"d","phase":"pre-up"}],"locked":null}' run_step 90-post-up-migrations.sh)"
expect_eq "90, còn pre-up chờ bất kỳ: exit 1" "1" "$rc"
expect_eq "90, còn pre-up chờ bất kỳ: không gọi reconcile" "0" "$(calls 'migrations/cli.js reconcile')"
# status lỗi (3 khóa, 4 baseline, 1 chung): từ chối, không reconcile.
for src in 1 3 4; do
  rc="$(FAKE_STATUS_RC=$src run_step 90-post-up-migrations.sh)"
  expect_eq "90, status mã $src: exit 1" "1" "$rc"
  expect_contains "90, status mã $src: nêu mã" "mã status $src" "$(cat "$TMP/out")"
  expect_eq "90, status mã $src: không gọi reconcile" "0" "$(calls 'migrations/cli.js reconcile')"
done
# không có JSON / JSON thiếu danh sách chờ: fail-closed.
rc="$(FAKE_STATUS_OUT='lỗi kết nối Mongo' run_step 90-post-up-migrations.sh)"
expect_eq "90, status không có JSON: exit 1" "1" "$rc"
expect_eq "90, status không có JSON: không gọi reconcile" "0" "$(calls 'migrations/cli.js reconcile')"
rc="$(FAKE_STATUS_OUT='{"appVersion":"1.0.5","locked":null}' run_step 90-post-up-migrations.sh)"
expect_eq "90, JSON thiếu pending: exit 1" "1" "$rc"
expect_eq "90, JSON thiếu pending: không gọi reconcile" "0" "$(calls 'migrations/cli.js reconcile')"
# reconcile post-up lỗi: đỏ + die, nói rõ chỉ sửa tiến.
rc="$(FAKE_POSTUP_RC=1 run_step 90-post-up-migrations.sh)"
expect_eq "90, reconcile post-up lỗi mã 1: exit 1" "1" "$rc"
o="$(cat "$TMP/out")"
expect_contains "90, reconcile lỗi: cảnh báo THẤT BẠI kèm mã" "THẤT BẠI (mã 1)" "$o"
expect_contains "90, reconcile lỗi: có mã màu đỏ" $'\033[1;31m' "$o"
expect_contains "90, reconcile lỗi: nhắc chỉ sửa tiến nếu 011 đã áp dụng" "sửa tiến" "$o"
expect_contains "90, reconcile lỗi: vẫn ghi log" "FAKE: reconcile post-up (rc=1)" "$(cat "$logfile" 2>/dev/null)"

# ── Điểm gọi chung với TỆP BƯỚC THẬT: thứ tự 10 -> 20 -> 90, bước lỗi dừng các bước sau, downgrade bỏ qua toàn bộ ────────
run_steps() { # [DOWNGRADE_ACTIVE]  -> in rc; stdout+stderr vào $TMP/out
  local rc=0
  : > "$ORDER_FILE"; rm -rf "$TMP/logs"
  ( set -euo pipefail; LOGS_DIR="$TMP/logs"; DOWNGRADE_ACTIVE="${1:-0}"; run_post_migrate_steps ) > "$TMP/out" 2>&1 || rc=$?
  echo "$rc"
}
kind() { # in tên bước theo thứ tự gọi, từ ORDER_FILE
  sed -E -e 's/.*crm-catalog-codes.*/10/' -e 's/.*crm-customer-codes.*/20/' -e 's/.*cli.js status.*/90s/' -e 's/.*phase post-up.*/90r/' "$ORDER_FILE" | paste -sd ' ' -
}
rc="$(run_steps)"
expect_eq "điểm gọi chung: exit 0" "0" "$rc"
expect_eq "điểm gọi chung: thứ tự 10 -> 20 -> 90 (status rồi reconcile)" "10 20 90s 90r" "$(kind)"
expect_contains "điểm gọi chung: đủ ba log" "deploy-catalog-codes-$TS.log" "$(ls "$TMP/logs")"
expect_contains "điểm gọi chung: log bù mã khách" "deploy-customer-codes-$TS.log" "$(ls "$TMP/logs")"
expect_contains "điểm gọi chung: log post-up" "deploy-post-up-$TS.log" "$(ls "$TMP/logs")"

rc="$(FAKE_CC_RC=1 run_steps)"
expect_eq "bước 10 lỗi: deploy exit 1" "1" "$rc"
expect_eq "bước 10 lỗi: 20 và 90 KHÔNG chạy" "10" "$(kind)"
expect_contains "bước 10 lỗi: die kèm tên bước" "Bước hậu-migrate '10-catalog-codes' thất bại (mã 1)" "$(cat "$TMP/out")"
rc="$(FAKE_CU_RC=1 run_steps)"
expect_eq "bước 20 lỗi: deploy exit 1" "1" "$rc"
expect_eq "bước 20 lỗi: 90 KHÔNG chạy (không status, không reconcile)" "10 20" "$(kind)"
expect_contains "bước 20 lỗi: die kèm tên bước" "Bước hậu-migrate '20-customer-codes' thất bại (mã 1)" "$(cat "$TMP/out")"
# Tình huống 010 chưa áp dụng: CLI bù mã thoát 0 "chưa áp dụng" (thành công giả) nhưng bước 90 từ chối => deploy thất bại, 011 KHÔNG chạy.
rc="$(FAKE_STATUS_OUT="$PRE010" run_steps)"
expect_eq "010 chưa áp dụng: bước 20 thoát 0 nhưng deploy exit 1 (bước 90 từ chối)" "1" "$rc"
expect_eq "010 chưa áp dụng: 10, 20, status đã chạy; reconcile post-up KHÔNG chạy" "10 20 90s" "$(kind)"
expect_contains "010 chưa áp dụng: die kèm tên bước 90" "Bước hậu-migrate '90-post-up-migrations' thất bại (mã 1)" "$(cat "$TMP/out")"
rc="$(FAKE_POSTUP_RC=1 run_steps)"
expect_eq "bước 90 lỗi: deploy exit 1" "1" "$rc"
rc="$(run_steps 1)"
expect_eq "downgrade có chủ ý: exit 0" "0" "$rc"
expect_eq "downgrade có chủ ý: không chạy bước nào (không gọi docker)" "0" "$(wc -l < "$ORDER_FILE" | tr -d ' ')"
expect_contains "downgrade có chủ ý: cảnh báo bỏ qua" "bỏ qua toàn bộ bước hậu-migrate" "$(cat "$TMP/out")"

# ── 6b, 8a, 8b truyền --phase pre-up (hàm THẬT trích từ deploy.sh) ───────────────────────────────────────────────
# 6b: auto_reconcile = dry-run rồi --apply, đều --skip-version --phase pre-up. BACKUP_FILE khác rỗng để chạy --apply.
: > "$ORDER_FILE"
( set -euo pipefail; BACKUP_FILE="x"; DOWNGRADE_ACTIVE=0; ALLOW_DOWNGRADE=0; STACK_TOUCHED=0; MIGRATION_GATE_RAN=0; auto_reconcile ) > "$TMP/out" 2>&1; rc=$?
expect_eq "6b auto_reconcile: exit 0" "0" "$rc"
mapfile -t order < "$ORDER_FILE"
expect_eq "6b: đúng 2 lệnh (dry-run, apply)" "2" "${#order[@]}"
expect_eq "6b: dry-run có --skip-version --phase pre-up" \
  "docker compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/cli.js reconcile --by deploy --skip-version --phase pre-up" "${order[0]:-}"
expect_eq "6b: apply có --skip-version --phase pre-up" \
  "docker compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/cli.js reconcile --apply --by deploy --skip-version --phase pre-up" "${order[1]:-}"
# 8a: cài mới.
: > "$ORDER_FILE"
( set -euo pipefail; FRESH_INSTALL=1; fresh_install_reconcile ) > "$TMP/out" 2>&1; rc=$?
expect_eq "8a: exit 0" "0" "$rc"
expect_eq "8a: reconcile --apply --by deploy --phase pre-up" \
  "docker compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/cli.js reconcile --apply --by deploy --phase pre-up" "$(cat "$ORDER_FILE")"
# 8b: ghi version.
: > "$ORDER_FILE"
( set -euo pipefail; FRESH_INSTALL=0; MIGRATION_GATE_RAN=1; DOWNGRADE_ACTIVE=0; sync_system_version ) > "$TMP/out" 2>&1; rc=$?
expect_eq "8b: exit 0" "0" "$rc"
expect_eq "8b: reconcile --apply --by deploy --phase pre-up" \
  "docker compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/cli.js reconcile --apply --by deploy --phase pre-up" "$(cat "$ORDER_FILE")"
# --plan-only dùng reconcile_dry_run KHÔNG --phase (mọi pha) để kế hoạch thấy cả 011.
: > "$ORDER_FILE"
( set -euo pipefail; DOWNGRADE_ACTIVE=0; ALLOW_DOWNGRADE=0; reconcile_dry_run ) > "$TMP/out" 2>&1
expect_not_contains "plan-only: dry-run không giới hạn pha (thấy cả post-up)" "--phase" "$(cat "$ORDER_FILE")"

# ── Tĩnh: deploy.sh không còn logic bù mã/bước hậu-migrate ngoài điểm gọi chung ──────────────────────────────────
# Bỏ dòng chú thích, thân usage() và print_recovery() (chỉ là chữ hướng dẫn); phần còn lại là mã chạy.
code="$(awk '
  /^usage\(\) \{/ {skip=1}
  /^print_recovery\(\) \{/ {skip=1}
  skip && /^}/ {skip=0; next}
  !skip && !/^[[:space:]]*#/ {print}
' "$ROOT_DIR/deploy.sh")"
for banned in 'catalog-codes' 'customer-codes' 'run_catalog_codes_cli' 'run_customer_codes_cli' 'apply_catalog_codes' 'apply_customer_codes' 'post-up-migrations'; do
  expect_not_contains "deploy.sh (mã chạy) không chứa $banned" "$banned" "$code"
done
for f in 10-catalog-codes.sh 20-customer-codes.sh 90-post-up-migrations.sh; do
  [[ -f "$ROOT_DIR/scripts/post-migrate/$f" ]] && ok || fail "thiếu scripts/post-migrate/$f"
done

# ── print_recovery và usage ──────────────────────────────────────────────────────────────────────────────────
rec="$(OLD_COMMIT=a NEW_COMMIT=b BACKUP_FILE=backups/deploy-pre-X.archive.gz PREV_IMAGE_TAG=img:pre-X PREV_IMAGE_REPO=img ENV_FILE=.env.docker DOC="$DOC" LOGS_DIR=logs TS="$TS" print_recovery 2>&1)"
expect_contains "print_recovery: câu sau bước 90 chỉ sửa tiến" "sau bước 90 chỉ sửa tiến" "$rec"
expect_contains "print_recovery: không lùi image v1.0.3 sau bước 90" "KHÔNG lùi image v1.0.3" "$rec"
expect_contains "print_recovery: trước bước 90 lùi được" "TRƯỚC bước 90" "$rec"
expect_contains "print_recovery: cách kiểm 011 (status)" "cli.js status" "$rec"
expect_contains "print_recovery: tên migration 011" "011_crm_drop_unique_phone" "$rec"
expect_contains "print_recovery: log post-up" "deploy-post-up-$TS.log" "$rec"
expect_contains "print_recovery: khôi phục từ backup do Oniichan quyết" "backups/deploy-pre-X.archive.gz" "$rec"
expect_contains "print_recovery: vẫn nhắc ngoại lệ 007/008" "NGOẠI LỆ migration 007/008" "$rec"
use="$(usage 2>&1)"
expect_contains "usage: nêu bước 20" "20-customer-codes" "$use"
expect_contains "usage: nêu bước 90 và --phase post-up" "--phase post-up" "$use"
expect_contains "usage: nêu sau bước 90 chỉ sửa tiến" "sau bước 90 chỉ sửa tiến" "$use"
expect_contains "usage: --phase pre-up ở 6b" "--phase pre-up" "$use"

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
