#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/post-migrate/90-post-up-migrations.sh — bước hậu-migrate 90 của deploy.sh (v1.0.5, FR-21/FR-23; T-17).
#
# Chạy migration pha `post-up` (hiện là 011_crm_drop_unique_phone: bỏ unique `phone_1`, tạo `phone_1` thường, ẩn danh `anonymized:` -> null)
# bằng `node dist/migrations/cli.js reconcile --apply --by deploy --skip-version --phase post-up`, SAU `up` + liveness + bước 10 và 20
# (bù mã danh mục/khách xong thì mới làm bước MỘT CHIỀU này). `--skip-version`: version do bước 8b ghi, không ghi lại ở đây.
#
# CỔNG CHẶN (bắt buộc, chạy TRƯỚC `--apply`): CLI bù mã khách thoát 0 khi sổ chưa có 010 ("chưa áp dụng"), và runner với `--phase post-up`
# KHÔNG tự thấy migration pre-up đang chờ; chạy 011 lúc đó vừa bỏ unique khi khách chưa có mã, vừa để lỗ hổng sổ (011 vào sổ, 010 chưa).
# Nên bước này đọc `status --json` (chỉ đọc) và TỪ CHỐI (thoát 1, không ghi gì) khi: không đọc được trạng thái / có khóa / cần baseline
# (mã khác 0), không đọc được danh sách chờ, hoặc CÒN BẤT KỲ migration pre-up chờ (gồm 010). Một chỗ duy nhất, không cần sửa CLI/backend.
#
# Lỗi (cổng chặn hoặc --apply) => cảnh báo ĐỎ (stderr), ghi log $LOGS_DIR/deploy-post-up-<TS>.log (đầu ra status + reconcile, không bí mật),
# rồi `die` (exit 1); deploy.sh dừng deploy kèm tên bước và in hướng dẫn lùi/sửa tiến (print_recovery).
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
run_migration_cli() { compose run --rm --no-deps -T backend node dist/migrations/cli.js "$@"; }

LOGFILE="$LOGS_DIR/deploy-post-up-${TS}.log"
CLI_HINT="docker compose --env-file $ENV_FILE run --rm --no-deps backend node dist/migrations/cli.js"

# In log vừa ghi rồi cảnh báo ĐỎ + die (các lệnh gọi từ cổng chặn chưa ghi gì vào DB).
fail_step() { # <thông báo đỏ> <thông báo die>
  cat "$LOGFILE" 2>/dev/null || true
  printf '\033[1;31m[%s] CẢNH BÁO: %s\033[0m\n' "$LOG_PREFIX" "$1" >&2
  printf '\033[1;31m[%s] Xem log: %s\033[0m\n' "$LOG_PREFIX" "$LOGFILE" >&2
  die "$2"
}

# Cổng chặn: chỉ đi tiếp khi `status --json` đọc được, không khóa/baseline, và KHÔNG còn migration pre-up chờ (nên 010 đã áp dụng).
require_pre_up_done() {
  local out rc=0 json pending ids
  out="$(run_migration_cli status --json 2>&1)" || rc=$?
  printf '%s\n' "$out" >>"$LOGFILE"
  if (( rc != 0 )); then
    fail_step "bước 90 TỪ CHỐI chạy 011: không đọc được trạng thái migration (mã $rc: 3 = có khóa, 4 = cần baseline). Chưa ghi gì." \
      "Bước 90 từ chối (mã status $rc): không chạy 011 khi chưa xác nhận migration pre-up (gồm 010) đã áp dụng. Chưa ghi gì; xem $DOC mục 11. Kiểm: $CLI_HINT status"
  fi
  json="$(grep -m1 '^{' <<<"$out" || true)"
  # JSON.stringify không khoảng trắng; sau khóa "pending" luôn là "locked". Không khớp => không đoán, từ chối (fail-closed).
  if [[ -z "$json" ]] || ! grep -qE '"pending":\[.*\],"locked":' <<<"$json"; then
    fail_step "bước 90 TỪ CHỐI chạy 011: không đọc được danh sách migration chờ từ status --json. Chưa ghi gì." \
      "Bước 90 từ chối: không đọc được danh sách migration chờ. Chưa ghi gì; xem $DOC mục 11. Kiểm: $CLI_HINT status"
  fi
  pending="$(sed -E 's/.*"pending":\[(.*)\],"locked":.*/\1/' <<<"$json")"
  if grep -q '"phase":"pre-up"' <<<"$pending"; then
    ids="$(grep -oE '"id":"[^"]+"' <<<"$pending" | cut -d'"' -f4 | paste -sd ' ' - || true)"
    fail_step "bước 90 TỪ CHỐI chạy 011 (MỘT CHIỀU): còn migration pre-up chờ (${ids:-?}), tức 010 và/hoặc migration trước nó CHƯA áp dụng; bước 20 có thể đã thoát 0 mà không bù mã. Chưa ghi gì." \
      "Bước 90 từ chối: còn migration pre-up chờ (${ids:-?}) nên 011 chưa được phép chạy. Chưa ghi gì. Chạy: $CLI_HINT reconcile --apply --by cli --phase pre-up ; bù mã (bước 20) ; rồi $CLI_HINT reconcile --apply --by cli --skip-version --phase post-up. Xem $DOC mục 11."
  fi
}

apply_post_up() {
  local rc=0
  log "Bước 90: migration post-up (reconcile --apply --phase post-up; 011 bỏ unique SĐT, MỘT CHIỀU) ..."
  mkdir -p "$LOGS_DIR" 2>/dev/null || true
  : >"$LOGFILE"
  require_pre_up_done
  # Ghi đầu ra ra file rồi in lại (không dùng `| tee`: mã thoát phải lấy trực tiếp).
  run_migration_cli reconcile --apply --by deploy --skip-version --phase post-up >>"$LOGFILE" 2>&1 || rc=$?
  cat "$LOGFILE" 2>/dev/null || true
  if (( rc != 0 )); then
    printf '\033[1;31m[%s] CẢNH BÁO: bước 90 (migration post-up, gồm 011 một chiều) THẤT BẠI (mã %s). 011 có thể đã chạy MỘT PHẦN: kiểm status trước khi làm gì.\033[0m\n' "$LOG_PREFIX" "$rc" >&2
    printf '\033[1;31m[%s] Xem log: %s. Kiểm: %s status. Nếu 011 đã áp dụng thì CHỈ sửa tiến, không lùi image v1.0.3.\033[0m\n' "$LOG_PREFIX" "$LOGFILE" "$CLI_HINT" >&2
    die "Bước 90 (post-up) lỗi (mã $rc): deploy báo LỖI dù backend đã sống. Sau bước 90 chỉ sửa tiến nếu 011 đã áp dụng; xem $DOC mục 11."
  fi
  log "Migration post-up xong (log: $LOGFILE)."
}

apply_post_up
