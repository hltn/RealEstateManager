#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/check-disk.sh — kiểm tra dung lượng đĩa trống TRƯỚC khi build image (vd `docker compose up -d --build`).
#
#   bash scripts/check-disk.sh [GB]      # mặc định 5 GB; thoát mã 1 nếu thiếu
#
# Kiểm cả thư mục repo và thư mục dữ liệu Docker (cùng hàm với deploy.sh/run-migration.sh, scripts/lib/ops-common.sh).
# Không đổi gì trên hệ thống; thiếu dung lượng thì in `docker system df` và gợi ý dọn (docker builder prune -f...).
# Dùng ở tài liệu mục 5.4b trước khi `up --build` (build backend + frontend để lại image + build cache vài GB).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="disk"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[disk] LỖI: không resolve được đường dẫn thật của script (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")/.." && pwd)"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

case "${1:-}" in
  -h|--help) echo "Cách dùng: bash scripts/check-disk.sh [GB]   (mặc định 5; thoát 1 nếu trống ít hơn ngưỡng)"; exit 0 ;;
esac
GB="${1:-5}"

command -v docker >/dev/null 2>&1 || die "Thiếu lệnh 'docker'."
cd "$ROOT_DIR"
require_free_disk_gb "$GB"
log "Đủ dung lượng trống (>= ${GB} GB) ở thư mục repo và thư mục dữ liệu Docker."
