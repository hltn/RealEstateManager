#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/post-migrate/20-customer-codes.sh — bước hậu-migrate 20 của deploy.sh (v1.0.5, FR-08/FR-21/FR-23; T-17).
#
# Bù mã khách (`customerCode` KH-xxxxxx) SAU `up`, khi backend mới đã sống, MỌI lần deploy. Khách tạo bởi image v1.0.3 trong khoảng giữa 6b
# (migration 010) và `up`, cùng toàn bộ khách cũ, chưa có mã: CLI bù theo lô trong transaction, idempotent (chạy lại không đổi mã đã cấp).
# Gọi `crm-customer-codes.cli.js --apply`; thoát mã khác 0 (1 lỗi/còn thiếu mã, 2 sai tham số, hay docker lỗi) => cảnh báo ĐỎ (stderr), ghi log
# $LOGS_DIR/deploy-customer-codes-<TS>.log (chỉ đầu ra của lệnh bù, không bí mật), rồi `die` (exit 1); deploy.sh thấy mã khác 0 thì dừng deploy
# kèm tên bước và KHÔNG chạy bước 90 (011 một chiều chưa chạy).
#
# CHÚ Ý: khi sổ chưa có migration 010 (--no-migrate, DB cũ...) CLI in "chưa áp dụng, bỏ qua" và thoát 0, KHÔNG ghi gì (logic ở CLI, không ở shell).
# Vì vậy mã 0 ở bước này KHÔNG chứng minh đã bù mã; cổng chặn nằm ở bước 90 (từ chối chạy 011 khi còn migration pre-up chờ, gồm 010).
# Bỏ qua khi downgrade có chủ ý: việc đó do deploy.sh (run_post_migrate_steps) xử lý, không gọi tệp này.
#
# Hợp đồng môi trường (deploy.sh truyền sang, KHÔNG bí mật): ENV_FILE, LOGS_DIR, TS, DOC, LOG_PREFIX.
# Không chạy trực tiếp bởi người dùng; deploy.sh gọi bằng `bash <tệp>` (không phụ thuộc bit thực thi).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_PREFIX="${LOG_PREFIX:-deploy}"
# shellcheck source=scripts/lib/ops-common.sh
source "$STEP_DIR/../lib/ops-common.sh"

: "${ENV_FILE:?Thiếu ENV_FILE (do deploy.sh truyền sang)}"
: "${LOGS_DIR:?Thiếu LOGS_DIR (do deploy.sh truyền sang)}"
: "${TS:?Thiếu TS (do deploy.sh truyền sang)}"
DOC="${DOC:-docs/01_Infrastructure/06_Production_Deploy.md}"

# Mọi lệnh compose đều kèm --env-file (giống deploy.sh).
compose() { docker compose --env-file "$ENV_FILE" "$@"; }
run_customer_codes_cli() { compose run --rm --no-deps -T backend node dist/migrations/crm-customer-codes.cli.js "$@"; }

apply_customer_codes() {
  local rc=0 logfile="$LOGS_DIR/deploy-customer-codes-${TS}.log"
  log "Bước 20: bù mã khách (crm-customer-codes.cli.js --apply) ..."
  mkdir -p "$LOGS_DIR" 2>/dev/null || true
  # Ghi đầu ra ra file rồi in lại (không dùng `| tee`: mã thoát của lệnh bù phải lấy trực tiếp, không qua pipe). `|| rc=$?` để set -e
  # không dừng ngay; cảnh báo đỏ và die nằm bên dưới.
  run_customer_codes_cli --apply >"$logfile" 2>&1 || rc=$?
  cat "$logfile" 2>/dev/null || true
  if (( rc != 0 )); then
    printf '\033[1;31m[%s] CẢNH BÁO: bước bù mã khách (20) THẤT BẠI (mã %s). Một số khách có thể còn thiếu `customerCode`; bước 90 (bỏ unique SĐT) CHƯA chạy.\033[0m\n' "$LOG_PREFIX" "$rc" >&2
    printf '\033[1;31m[%s] Xem log: %s. Chạy lại sau khi sửa: %s\033[0m\n' "$LOG_PREFIX" "$logfile" \
      "docker compose --env-file $ENV_FILE run --rm --no-deps backend node dist/migrations/crm-customer-codes.cli.js --apply" >&2
    die "Bước bù mã khách (20) lỗi (mã $rc): deploy báo LỖI dù backend đã sống; bước 90 không chạy. Backend vẫn chạy; xem $DOC mục 11."
  fi
  log "Bù mã khách xong (log: $logfile)."
}

apply_customer_codes
