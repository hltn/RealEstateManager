#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/tests/deploy-catalog-codes.test.sh — test shell KHÔNG cần Docker/Mongo thật cho bước 8c (nay là scripts/post-migrate/10-catalog-codes.sh,
# gọi qua run_post_migrate_steps của deploy.sh; T-03/FR-23, trước đó T-17 v1.0.4):
#   - bước bù `node dist/migrations/crm-catalog-codes.cli.js --apply` chạy SAU `up` và SAU wait_backend_liveness (thứ tự gọi trong main)
#   - lệnh bù thoát mã khác 0 => cảnh báo đỏ ở stderr, deploy exit khác 0 (không chạy tiếp `compose ps`/"Deploy xong")
#   - lệnh bù thoát 0 => deploy xong, exit 0
#   - log $LOGS_DIR/deploy-catalog-codes-<TS>.log được ghi (cả khi thành công lẫn thất bại)
#   - downgrade có chủ ý => bỏ qua bước bù
# Hàm (main, compose, run_post_migrate_steps...) được TRÍCH từ deploy.sh thật bằng sed, KHÔNG chép tay; tệp bước 10-catalog-codes.sh chạy THẬT
# (subprocess `bash`, `docker` giả được export -f). Các bước khác
# của main (git, backup, build, migration...) và `docker` được thay bằng stub ghi thứ tự gọi vào file; không chạm Docker thật.
# Chỉ kiểm lớp shell (thứ tự, mã thoát, log, cách gọi). Chạy bước bù với Mongo thật là việc của T-18 (bản sao dữ liệu).
# Thêm (T-03): điểm gọi chung chạy các tệp [0-9][0-9]-*.sh theo thứ tự tên, bước lỗi dừng các bước sau, deploy.sh không còn logic bù mã.
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
eval "$(extract_fn migration_gate | sed '1s/^migration_gate()/real_migration_gate()/')"
eval "$(extract_fn mongo_volume_exists)"
for fn in run_post_migrate_steps fresh_install_reconcile sync_system_version main; do
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
# ORDER_FILE ghi mỗi lần gọi theo thứ tự. docker: ghi "docker <đối số>"; lệnh bù (có crm-catalog-codes.cli.js) in đầu ra giả và
# thoát $FAKE_CC_RC (mặc định 0). Các bước khác của main chỉ ghi tên.
docker() {
  printf 'docker %s\n' "$*" >> "$ORDER_FILE"
  if [[ "$1 $2" == "volume ls" ]]; then [[ -n "${FAKE_VOLUME:-}" ]] && echo "$FAKE_VOLUME"; return 0; fi
  if [[ "$1" == "inspect" && "$*" == *"$MONGO_CONTAINER"* ]]; then [[ "${FAKE_CONTAINER:-1}" == "1" ]]; return $?; fi
  if [[ "$1" == "inspect" && "$*" == *Labels* ]]; then return 1; fi
  if [[ "$*" == *migrations/cli.js\ status* ]]; then   # cổng chặn của bước 90 (T-17): mặc định không còn migration pre-up chờ
    echo '{"appVersion":"1.0.5","pending":[{"id":"011_x","description":"d","phase":"post-up"}],"locked":null}'
    return 0
  fi
  if [[ "$*" == *crm-customer-codes.cli.js* ]]; then
    echo "FAKE: bù mã khách (rc=${FAKE_CU_RC:-0})"
    return "${FAKE_CU_RC:-0}"
  fi
  if [[ "$*" == *migrations/cli.js\ reconcile* ]]; then
    echo "FAKE: reconcile (rc=${FAKE_RECONCILE_RC:-0})"
    return "${FAKE_RECONCILE_RC:-0}"
  fi
  if [[ "$*" == *crm-catalog-codes.cli.js* ]]; then
    echo "FAKE: bù mã danh mục (rc=${FAKE_CC_RC:-0})"
    return "${FAKE_CC_RC:-0}"
  fi
  return 0
}
# Bước hậu-migrate chạy bằng `bash` (subprocess): cần export hàm docker giả và ORDER_FILE.
export -f docker
for stub in check_prereqs acquire_lock git_update check_compose check_users_migrated ensure_runtime_dirs backup_mongo \
            tag_current_backend_image build_backend wait_mongo_healthy wait_backend_liveness; do
  eval "$stub() { printf '%s\n' '$stub' >> \"\$ORDER_FILE\"; return 0; }"
done
manifest_record_deploy_state() { :; }   # ghi manifest backup code (T backup code): ngoài phạm vi test này, nên giả im lặng
# migration_gate giả (mặc định) hoặc THẬT (FAKE_REAL_GATE=1, trích từ deploy.sh, đổi tên real_migration_gate). Gate thật gọi
# mongo_is_healthy / docker inspect / docker volume ls giả điều khiển bằng FAKE_MONGO_HEALTHY, FAKE_CONTAINER, FAKE_VOLUME.
migration_gate() {
  printf 'migration_gate
' >> "$ORDER_FILE"
  if [[ "${FAKE_REAL_GATE:-0}" == "1" ]]; then real_migration_gate; return $?; fi
  FRESH_INSTALL="${FAKE_FRESH:-0}"; MIGRATION_GATE_RAN=$(( 1 - FRESH_INSTALL )); return 0
}
mongo_is_healthy() { [[ "${FAKE_MONGO_HEALTHY:-1}" == "1" ]]; }
reconcile_dry_run() { printf 'reconcile_dry_run
' >> "$ORDER_FILE"; }
auto_reconcile() { printf 'auto_reconcile
' >> "$ORDER_FILE"; MIGRATION_GATE_RAN=1; }
legacy_status_gate() { printf 'legacy_status_gate
' >> "$ORDER_FILE"; MIGRATION_GATE_RAN=1; }
require_free_disk_gb() { printf 'require_free_disk_gb\n' >> "$ORDER_FILE"; return 0; }
inspect_field() { printf 'running'; }

ENV_FILE=".env.docker"
MONGO_CONTAINER="realestate_mongo"; BACKEND_CONTAINER="realestate_backend"; DEFAULT_PROJECT="realestatemanager"
NINE_ROUTER_CONTAINER=""
TS="20260101-000000"
NEW_COMMIT="abc1234"
PREV_IMAGE_TAG=""
BACKUP_FILE=""
DOC="docs/01_Infrastructure/06_Production_Deploy.md"
DEPLOY_MIN_FREE_GB=5

# Chạy main trong subshell có `set -euo pipefail` (giống deploy.sh thật). In "rc=<mã>" ở dòng cuối; stdout+stderr vào $TMP/out.
run_main() { # <FAKE_CC_RC> [DOWNGRADE_ACTIVE]  (đặt FAKE_FRESH / FAKE_RECONCILE_RC ở môi trường gọi)
  local rc=0
  : > "$ORDER_FILE"
  rm -rf "$TMP/logs"
  (
    set -euo pipefail
    export FAKE_CC_RC="$1" FAKE_FRESH="${FAKE_FRESH:-0}" FAKE_RECONCILE_RC="${FAKE_RECONCILE_RC:-0}"
    export FAKE_REAL_GATE="${FAKE_REAL_GATE:-0}" FAKE_MONGO_HEALTHY="${FAKE_MONGO_HEALTHY:-1}" FAKE_CONTAINER="${FAKE_CONTAINER:-1}" FAKE_VOLUME="${FAKE_VOLUME:-}"
    FRESH_INSTALL=0; MIGRATION_GATE_RAN=0
    LOGS_DIR="$TMP/logs"
    AUTO_MIGRATE="${FAKE_AUTO:-1}"; ALLOW_DOWNGRADE=0; MONGO_TIMEOUT=120; HEALTH_TIMEOUT=120; DUMP_TIMEOUT=900; OPS_EXEC_TIMEOUT=300
    NO_PULL=0; PLAN_ONLY="${FAKE_PLAN:-0}"; STACK_TOUCHED=0; DOWNGRADE_ACTIVE="${2:-0}"
    main --no-pull
  ) > "$TMP/out" 2>&1 || rc=$?
  echo "$rc"
}
ORDER_FILE="$TMP/order"; export ORDER_FILE

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

# ── Nhánh DB TRỐNG / cài mới (T-19): 6b bỏ qua nên reconcile --apply chạy SAU up + liveness, trước 8c ──────────
pre_recon_lines() { grep 'migrations/cli.js reconcile' "$TMP/order" | grep -v -- '--phase post-up' || true; }
RECON='compose --env-file .env.docker run --rm --no-deps -T backend node dist/migrations/cli.js reconcile --apply --by deploy'
rc="$(FAKE_FRESH=1 run_main 0)"
expect_eq "cài mới: exit 0" "0" "$rc"
mapfile -t order < "$TMP/order"
i_up="$(idx 'up -d --build')"; i_live="$(idx wait_backend_liveness)"; i_rc="$(idx 'migrations/cli.js reconcile')"; i_cc="$(idx crm-catalog-codes.cli.js)"
(( i_rc > i_live && i_live > i_up )) && ok || fail "cài mới: reconcile phải SAU up và liveness (up=$i_up live=$i_live reconcile=$i_rc)"
(( i_cc > i_rc )) && ok || fail "cài mới: bước bù 8c phải SAU reconcile (reconcile=$i_rc, bù=$i_cc)"
expect_eq "cài mới: reconcile pre-up gọi đúng 1 lần (sync 8b không gọi thêm)" "1" "$(pre_recon_lines | wc -l | tr -d ' ')"
expect_contains "cài mới: đúng lệnh --apply --by deploy, không --skip-version" "$RECON" "$(pre_recon_lines)"
expect_not_contains "cài mới: không --skip-version" "--skip-version" "$(pre_recon_lines)"
expect_contains "cài mới: deploy báo xong" "Deploy xong" "$(cat "$TMP/out")"

rc="$(FAKE_FRESH=1 FAKE_RECONCILE_RC=1 run_main 0)"
expect_eq "cài mới, reconcile lỗi mã 1: deploy exit 1" "1" "$rc"
o="$(cat "$TMP/out")"
expect_contains "cài mới, reconcile lỗi: thông báo 8a" "Bước 8a (cài mới) reconcile --apply thất bại (mã 1)" "$o"
expect_not_contains "cài mới, reconcile lỗi: không in 'Deploy xong'" "Deploy xong" "$o"
expect_eq "cài mới, reconcile lỗi: không chạy bước bù 8c" "0" "$(grep -c 'crm-catalog-codes.cli.js' "$TMP/order")"

rc="$(FAKE_FRESH=1 FAKE_RECONCILE_RC=4 run_main 0)"
expect_eq "cài mới, reconcile lỗi mã 4: deploy exit 1" "1" "$rc"

# Nhánh KHÁC không đổi: DB đã có dữ liệu (không FRESH) => 8a không chạy, 8b (sync) vẫn gọi reconcile --apply 1 lần.
rc="$(run_main 0)"
expect_eq "DB có dữ liệu: exit 0" "0" "$rc"
expect_eq "DB có dữ liệu: đúng 1 reconcile pre-up (8b), không thêm 8a" "1" "$(pre_recon_lines | wc -l | tr -d ' ')"
expect_not_contains "DB có dữ liệu: không có log bước 8a" "Bước 8a" "$(cat "$TMP/out")"

# ── migration_gate THẬT + docker inspect / volume ls giả (M1): chỉ cài mới khi KHÔNG container VÀ KHÔNG volume Mongo ──────
RECON_N() { pre_recon_lines | wc -l | tr -d ' '; }
rc="$(FAKE_REAL_GATE=1 FAKE_MONGO_HEALTHY=0 FAKE_CONTAINER=0 FAKE_VOLUME= run_main 0)"
expect_eq "gate thật, không container+không volume: exit 0" "0" "$rc"
expect_eq "gate thật, cài mới thật: 8a chạy reconcile 1 lần" "1" "$(RECON_N)"
expect_contains "gate thật, cài mới thật: có log 8a" "Bước 8a" "$(cat "$TMP/out")"
rc="$(FAKE_REAL_GATE=1 FAKE_MONGO_HEALTHY=0 FAKE_CONTAINER=0 FAKE_VOLUME=realestatemanager_mongo_data run_main 0)"
expect_eq "gate thật, có volume không container: exit 0 (như hành vi cũ)" "0" "$rc"
expect_eq "gate thật, có volume: KHÔNG reconcile (không migrate khi chưa backup)" "0" "$(RECON_N)"
expect_not_contains "gate thật, có volume: không có log 8a" "Bước 8a" "$(cat "$TMP/out")"
expect_contains "gate thật, có volume: cảnh báo volume còn" "đã có volume Mongo" "$(cat "$TMP/out")"
expect_contains "gate thật: truy vấn volume theo tên project" "volume ls -q --filter name=^realestatemanager_mongo_data\$" "$(cat "$TMP/order")"
# --no-migrate + cài mới thật: 8a vẫn chạy trên DB trống (ngoại lệ có chủ ý, ghi ở doc 06).
rc="$(FAKE_AUTO=0 FAKE_REAL_GATE=1 FAKE_MONGO_HEALTHY=0 FAKE_CONTAINER=0 FAKE_VOLUME= run_main 0)"
expect_eq "--no-migrate + cài mới: exit 0" "0" "$rc"
expect_eq "--no-migrate + cài mới: 8a vẫn chạy reconcile 1 lần" "1" "$(RECON_N)"
rc="$(FAKE_AUTO=0 FAKE_REAL_GATE=1 FAKE_MONGO_HEALTHY=0 FAKE_CONTAINER=0 FAKE_VOLUME=realestatemanager_mongo_data run_main 0)"
expect_eq "--no-migrate + có volume: không reconcile" "0" "$(RECON_N)"
# --plan-only + cài mới: thoát trước up, không reconcile, không 8a.
rc="$(FAKE_PLAN=1 FAKE_REAL_GATE=1 FAKE_MONGO_HEALTHY=0 FAKE_CONTAINER=0 FAKE_VOLUME= run_main 0)"
expect_eq "--plan-only + cài mới: exit 0" "0" "$rc"
expect_eq "--plan-only + cài mới: không up" "0" "$(grep -c 'up -d --build' "$TMP/order")"
expect_eq "--plan-only + cài mới: không reconcile" "0" "$(RECON_N)"
# Container tồn tại nhưng chưa healthy: gate thật dừng (không coi là cài mới).
rc="$(FAKE_REAL_GATE=1 FAKE_MONGO_HEALTHY=0 FAKE_CONTAINER=1 run_main 0)"
expect_eq "container có mà chưa healthy: deploy dừng exit 1" "1" "$rc"
expect_eq "container chưa healthy: không reconcile" "0" "$(RECON_N)"

# ── Điểm gọi chung run_post_migrate_steps (T-03): thứ tự tên, bước lỗi dừng các bước sau, thiếu tệp thì dừng ─────────────
# Gọi hàm THẬT (trích từ deploy.sh) với ROOT_DIR trỏ tới thư mục giả có các tệp bước giả; mỗi bước ghi tên + env nhận được vào $TMP/steps.
FAKE_ROOT="$TMP/fakeroot"; mkdir -p "$FAKE_ROOT/scripts/post-migrate"
mkstep() { printf '#!/usr/bin/env bash
printf "%%s ENV=%%s LOGS=%%s TS=%%s DOC=%%s PFX=%%s\n" "$(basename "$0")" "$ENV_FILE" "$LOGS_DIR" "$TS" "$DOC" "$LOG_PREFIX" >> "$STEPS_FILE"
exit %s
' "$2" > "$FAKE_ROOT/scripts/post-migrate/$1"; }
run_steps() { # [DOWNGRADE_ACTIVE]  -> in rc; stdout+stderr vào $TMP/steps_out
  local rc=0
  : > "$TMP/steps"
  ( set -euo pipefail; ROOT_DIR="$FAKE_ROOT"; STEPS_FILE="$TMP/steps"; export STEPS_FILE
    LOGS_DIR="logs-x"; DOWNGRADE_ACTIVE="${1:-0}"; run_post_migrate_steps ) > "$TMP/steps_out" 2>&1 || rc=$?
  echo "$rc"
}
mkstep 90-z.sh 0; mkstep 10-a.sh 0; mkstep 20-b.sh 0; mkstep not-a-step.sh 0; mkstep 5-short.sh 0
rc="$(run_steps)"
expect_eq "điểm gọi chung: exit 0" "0" "$rc"
expect_eq "điểm gọi chung: đúng thứ tự tên, bỏ tệp không khớp [0-9][0-9]-*.sh" "10-a.sh 20-b.sh 90-z.sh" "$(awk '{print $1}' "$TMP/steps" | paste -sd ' ' -)"
expect_contains "điểm gọi chung: truyền ENV_FILE/LOGS_DIR/TS/DOC/LOG_PREFIX" "ENV=.env.docker LOGS=logs-x TS=20260101-000000 DOC=docs/01_Infrastructure/06_Production_Deploy.md PFX=test" "$(head -n 1 "$TMP/steps")"
mkstep 20-b.sh 7
rc="$(run_steps)"
expect_eq "bước 20 lỗi: deploy exit 1" "1" "$rc"
expect_eq "bước 20 lỗi: bước 90 KHÔNG chạy, 10 và 20 đã chạy" "10-a.sh 20-b.sh" "$(awk '{print $1}' "$TMP/steps" | paste -sd ' ' -)"
expect_contains "bước 20 lỗi: die kèm tên bước và mã" "Bước hậu-migrate '20-b' thất bại (mã 7)" "$(cat "$TMP/steps_out")"
rc="$(run_steps 1)"
expect_eq "downgrade: điểm gọi chung exit 0" "0" "$rc"
expect_eq "downgrade: không chạy bước nào" "0" "$(wc -l < "$TMP/steps" | tr -d ' ')"
rm -f "$FAKE_ROOT"/scripts/post-migrate/*.sh
rc="$(run_steps)"
expect_eq "không có tệp bước: dừng exit 1 (không bỏ qua im lặng)" "1" "$rc"

# ── Tĩnh: deploy.sh không còn logic bù mã; tệp bước thật có mặt ──────────────────────────────────────────────────
dsh="$(cat "$ROOT_DIR/deploy.sh")"
expect_not_contains "deploy.sh không còn run_catalog_codes_cli" "run_catalog_codes_cli()" "$dsh"
expect_not_contains "deploy.sh không còn apply_catalog_codes" "apply_catalog_codes()" "$dsh"
expect_not_contains "deploy.sh không gọi crm-catalog-codes.cli.js trong code" "migrations/crm-catalog-codes.cli.js \"" "$dsh"
[[ -f "$ROOT_DIR/scripts/post-migrate/10-catalog-codes.sh" ]] && ok || fail "thiếu scripts/post-migrate/10-catalog-codes.sh"

# ── Tĩnh: deploy.sh nhắc ngoại lệ lùi image 007/008 ─────────────────────────
expect_contains "print_recovery nhắc ngoại lệ 007/008" "NGOẠI LỆ migration 007/008" "$(cat "$ROOT_DIR/deploy.sh")"

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
