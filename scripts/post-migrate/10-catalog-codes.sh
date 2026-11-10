#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/post-migrate/10-catalog-codes.sh — bước hậu-migrate 10 của deploy.sh (trước đây là bước 8c, v1.0.4, FR-40/FR-46; T-03/FR-23).
#
# Bù mã danh mục SAU `up`, khi backend đã sống, MỌI lần deploy. Runner 007/008 chạy ở 6b khi image cũ còn phục vụ nên có thể còn vài
# bản ghi chỉ có id, chưa có `code`; lệnh bù cùng hàm với migration (idempotent, vài giây).
# Lệnh bù thoát mã khác 0 (1 lỗi/mồ côi/thiếu mã, 2 sai tham số, hay docker lỗi) => cảnh báo ĐỎ (stderr), ghi log
# $LOGS_DIR/deploy-catalog-codes-<TS>.log (chỉ đầu ra của lệnh bù, không bí mật), rồi `die` (exit 1); deploy.sh thấy mã khác 0 thì dừng
# deploy kèm tên bước. Bỏ qua khi downgrade có chủ ý: việc đó do deploy.sh (run_post_migrate_steps) xử lý, không gọi tệp này.
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
run_catalog_codes_cli() { compose run --rm --no-deps -T backend node dist/migrations/crm-catalog-codes.cli.js "$@"; }

apply_catalog_codes() {
  local rc=0 logfile="$LOGS_DIR/deploy-catalog-codes-${TS}.log"
  log "Bước 10 (cũ 8c): bù mã danh mục (crm-catalog-codes.cli.js --apply) ..."
  mkdir -p "$LOGS_DIR" 2>/dev/null || true
  # Ghi đầu ra ra file rồi in lại (không dùng `| tee`: mã thoát của lệnh bù phải lấy trực tiếp, không qua pipe). `|| rc=$?` để set -e
  # không dừng ngay; cảnh báo đỏ và die nằm bên dưới.
  run_catalog_codes_cli --apply >"$logfile" 2>&1 || rc=$?
  cat "$logfile" 2>/dev/null || true
  if (( rc != 0 )); then
    printf '\033[1;31m[%s] CẢNH BÁO: bước bù mã danh mục (8c) THẤT BẠI (mã %s). Một số bản ghi có thể còn thiếu `code`.\033[0m\n' "$LOG_PREFIX" "$rc" >&2
    printf '\033[1;31m[%s] Xem log: %s. Chạy lại sau khi sửa: %s\033[0m\n' "$LOG_PREFIX" "$logfile" \
      "docker compose --env-file $ENV_FILE run --rm --no-deps backend node dist/migrations/crm-catalog-codes.cli.js --apply" >&2
    die "Bước bù mã danh mục (8c) lỗi (mã $rc): deploy báo LỖI dù backend đã sống. Backend vẫn chạy; xem $DOC mục 11."
  fi
  log "Bù mã danh mục xong (log: $logfile)."
}

apply_catalog_codes
