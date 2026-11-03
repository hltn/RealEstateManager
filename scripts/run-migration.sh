#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/run-migration.sh — chạy MỘT migration cũ (002 đến 006) trên máy chủ production, trong network của compose.
#
#   bash scripts/run-migration.sh 005            # dry-run (mặc định, không ghi gì)
#   bash scripts/run-migration.sh 005 --apply    # ghi thật (bắt buộc có backup mongodump MỚI, đã kiểm nội dung)
#   bash scripts/run-migration.sh 006 --apply --cleanup
#   bash scripts/run-migration.sh 002           # dry-run 002 (urlHash SHA-256): dùng khi probe 002 của deploy.sh báo "không xác minh được"
# (Dùng `bash ...`, không phụ thuộc bit thực thi: commit từ Windows có thể làm mất bit này. Chạy trong tmux/nohup.)
#
# Vì sao cần script này: image backend production (stage `production` của RealEstateBackendApp/Dockerfile) chỉ có
# dist/ + node_modules production, KHÔNG có ts-node và KHÔNG có thư mục scripts/. Migration là script ts-node nên
# phải chạy bằng image dựng từ stage `builder` (đủ devDependencies + toàn bộ mã nguồn), nối vào cùng network với mongo.
# Backend mới KHÔNG khởi động nếu còn user chưa migrate 005 (UserRolesMigrationGuard), nên 005 phải xong TRƯỚC khi
# backend mới lên. Thứ tự đầy đủ: docs/01_Infrastructure/06_Production_Deploy.md mục 5.4a.
#
# Bí mật: MONGODB_URI dựng từ MONGO_ROOT_USERNAME/MONGO_ROOT_PASSWORD trong .env.docker, ghi vào file --env-file TẠM
# quyền 600 (xóa bằng trap khi thoát) rồi truyền cho `docker run --env-file`: mật khẩu không nằm trên dòng lệnh của
# host (không thấy trong `ps`) và không được in ra màn hình. Việc kiểm tra nội dung backup dùng mongorestore --dryRun
# trong container mongo với mật khẩu đưa qua pipe (không nằm trên dòng lệnh).
#
# Biến môi trường tùy chọn:
#   NETWORK                 tên network docker của compose (mặc định <project>_realestate_net, lấy project từ container mongo)
#   BACKUP_MAX_AGE_MINUTES  tuổi tối đa của backup khi --apply (mặc định 60 phút: backup NGAY trước khi apply)
#   MIGRATE_MIN_FREE_GB     dung lượng trống tối thiểu (GB) ở thư mục repo và thư mục dữ liệu Docker (mặc định 5: build stage
#                           `builder` tốn ~3.75 GB gồm image ~2.2 GB + build cache ~2.2 GB, đã đo ở máy dev)
#   MONGO_CONTAINER         tên container mongo (mặc định realestate_mongo; chỉ đổi khi thử nghiệm)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="migrate"
# Resolve symlink bằng `readlink -f` (GNU coreutils, có trên Ubuntu): gọi qua symlink vẫn tìm đúng thư mục repo.
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[migrate] LỖI: không resolve được đường dẫn thật của script (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")/.." && pwd)"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

readonly ENV_FILE=".env.docker"
readonly MONGO_CONTAINER="${MONGO_CONTAINER:-realestate_mongo}"
readonly DEFAULT_PROJECT="realestatemanager"
readonly BACKEND_DIR="RealEstateBackendApp"
readonly DOC="docs/01_Infrastructure/06_Production_Deploy.md"
BACKUP_MAX_AGE_MINUTES="${BACKUP_MAX_AGE_MINUTES:-60}"
MIGRATE_MIN_FREE_GB="${MIGRATE_MIN_FREE_GB:-5}"

MIGRATION=""
APPLY=0
CLEANUP=0
ASSUME_YES=0
IMAGE=""
ENV_TMP=""

usage() {
  cat <<'EOF'
Cách dùng: bash scripts/run-migration.sh <002|003|004|005|006> [--apply] [--cleanup] [--yes] [--help]

  002         rehash urlHash MD5 -> SHA-256 (raw_articles, news_articles), XÓA VĨNH VIỄN bài trùng url. Snapshot NDJSON của chính
              script nằm TRONG container (mất khi thoát): --apply chỉ dựa vào backup mongodump (phải chứa cả raw_articles và
              news_articles nếu chúng tồn tại) và cần xác nhận gõ tay (hoặc --yes), như 006.
  003         bỏ TTL index expiresAt của googledrivetokens.
  004         users.teamId = null cho tài khoản thiếu + index {teamId, status}.
  005         users.roles[] + users.teamIds[] (nhiều role/nhóm). PHẢI chạy trước khi backend mới khởi động.
  006         khu vực -> đúng 34 tỉnh/thành. XÓA VĨNH VIỄN các khu vực cũ (không hoàn tác được bằng script).
  --apply     Ghi thật. Mặc định là dry-run (chỉ đếm, không ghi). Với --apply BẮT BUỘC có backup mongodump
              (*.archive.gz) trong ./backups/ mới hơn BACKUP_MAX_AGE_MINUTES (mặc định 60 phút), > 0 byte,
              gzip hợp lệ và mongorestore --dryRun thấy realestate.users (backup NGAY trước khi apply).
  --cleanup   Xóa image tạm realestate-migrate:<tag> VÀ chạy `docker builder prune -f` sau khi xong (kể cả khi lỗi).
              Lưu ý: image rm chỉ giải phóng image; build cache (~2.2 GB) chỉ mất khi prune. `builder prune -f` xóa TOÀN BỘ
              build cache không dùng (không chỉ của migration): `up --build` sau đó dựng lại từ đầu, chậm hơn và lại tốn đĩa.
  --yes       Bỏ bước xác nhận gõ tay của 002 --apply và 006 --apply (dành cho chạy không có terminal).
  -h, --help  Hiện trợ giúp này.

Chạy ở thư mục gốc repo trên máy chủ, sau khi mongo đã healthy (docker compose --env-file .env.docker up -d mongo ...).
Cần trống >= MIGRATE_MIN_FREE_GB (mặc định 5 GB) cho image builder (+ build cache).
Kẹt đĩa (đã `docker builder prune -f` mà vẫn dưới ngưỡng): (a) dọn thêm an toàn: `docker image prune -f`, xóa từng image cũ
cụ thể; TUYỆT ĐỐI không động volume dữ liệu (mongo/redis/minio/nine_router): không `docker volume prune`, không
`system prune --volumes`, không `down -v`, không `image prune -a` (xóa cả image đường lui `*:pre-upgrade`); (b) hoặc hạ ngưỡng
CÓ Ý THỨC, vd MIGRATE_MIN_FREE_GB=4 (stage builder riêng cần ~3.75 GB; nhu cầu đỉnh khi dựng cả backend + frontend ~4.1 GB);
(c) hoặc dựng image ở máy khác. Chi tiết: docs/01_Infrastructure/06_Production_Deploy.md mục 5.4b ("Kẹt đĩa").
Quy trình: dry-run trước, đọc số liệu, backup, rồi mới --apply. Chi tiết: docs/01_Infrastructure/06_Production_Deploy.md mục 5.4a.
EOF
}

cleanup() {
  local code=$?
  trap - EXIT
  # File env tạm chứa mật khẩu Mongo: luôn xóa.
  [[ -z "$ENV_TMP" ]] || rm -f "$ENV_TMP"
  if (( CLEANUP == 1 )) && [[ -n "$IMAGE" ]]; then
    log "Dọn image tạm $IMAGE ..."
    docker image rm "$IMAGE" >/dev/null 2>&1 || warn "Không xóa được $IMAGE (xóa tay: docker image rm $IMAGE)."
    log "Dọn build cache (docker builder prune -f) ..."
    docker builder prune -f >/dev/null 2>&1 || warn "Không dọn được build cache (chạy tay: docker builder prune -f)."
  fi
  exit "$code"
}
trap cleanup EXIT

# ── Tham số ──────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    002|003|004|005|006) [[ -z "$MIGRATION" ]] || { trap - EXIT; echo "Chỉ chạy MỘT migration mỗi lần." >&2; exit 2; }; MIGRATION="$arg" ;;
    --apply) APPLY=1 ;;
    --cleanup) CLEANUP=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help) trap - EXIT; usage; exit 0 ;;
    *) trap - EXIT; printf '[migrate] Tham số không hợp lệ: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done
if [[ -z "$MIGRATION" ]]; then trap - EXIT; usage >&2; exit 2; fi
[[ "$BACKUP_MAX_AGE_MINUTES" =~ ^[0-9]+$ ]] || die "BACKUP_MAX_AGE_MINUTES phải là số nguyên (phút)."

case "$MIGRATION" in
  002) SCRIPT_REL="scripts/migrations/002_recompute_urlhash_sha256.ts" ;;
  003) SCRIPT_REL="scripts/migrations/003_drop_googledrivetokens_ttl_index.ts" ;;
  004) SCRIPT_REL="scripts/migrations/004_users_add_team_id.ts" ;;
  005) SCRIPT_REL="scripts/migrations/005_users_roles_teamids.ts" ;;
  006) SCRIPT_REL="scripts/migrations/006_areas_34_provinces.ts" ;;
esac

# Chạy ở thư mục gốc repo (cha của scripts/) để ./backups, .env.docker, ./RealEstateBackendApp luôn đúng.
cd "$ROOT_DIR"
[[ -f "$BACKEND_DIR/$SCRIPT_REL" ]] || die "Không thấy $BACKEND_DIR/$SCRIPT_REL (chạy trong repo đúng, đã git pull?)."

# ── Tiền điều kiện ───────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "Thiếu lệnh 'docker'."
command -v gzip >/dev/null 2>&1 || die "Thiếu lệnh 'gzip'."
docker info >/dev/null 2>&1 || die "Không nói chuyện được với Docker daemon (daemon chưa chạy, hoặc user thiếu quyền)."

require_private_file "$ENV_FILE"

# Đọc đúng một khóa từ .env.docker (KHÔNG `source` file: tránh thực thi nội dung). Lấy dòng cuối, bỏ \r.
read_env() {
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' || true)"
  printf '%s' "$v"
}
MONGO_USER="$(read_env MONGO_ROOT_USERNAME)"
MONGO_PWD="$(read_env MONGO_ROOT_PASSWORD)"
[[ -n "$MONGO_USER" && -n "$MONGO_PWD" ]] || die "Thiếu MONGO_ROOT_USERNAME hoặc MONGO_ROOT_PASSWORD trong $ENV_FILE."
# Chuỗi sẽ ghép thẳng vào URI mongodb://: chỉ nhận ký tự an toàn cho URL (khuyến nghị hex, xem tài liệu mục 2).
[[ "$MONGO_USER" =~ ^[A-Za-z0-9._~-]+$ && "$MONGO_PWD" =~ ^[A-Za-z0-9._~-]+$ ]] \
  || die "MONGO_ROOT_USERNAME/MONGO_ROOT_PASSWORD có ký tự không an toàn cho URI (chỉ A-Z a-z 0-9 . _ ~ -). Dùng hex theo tài liệu mục 2."

mongo_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$MONGO_CONTAINER" 2>/dev/null || echo missing)"
[[ "$mongo_health" == "healthy" ]] \
  || die "$MONGO_CONTAINER chưa healthy (trạng thái: $mongo_health). Khởi động: docker compose --env-file $ENV_FILE up -d mongo, đợi healthy rồi chạy lại."

# Network của compose: mặc định <project>_realestate_net, project lấy từ nhãn compose của container mongo.
if [[ -z "${NETWORK:-}" ]]; then
  project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$MONGO_CONTAINER" 2>/dev/null || true)"
  [[ -n "$project" ]] || project="$DEFAULT_PROJECT"
  NETWORK="${project}_realestate_net"
fi
docker network inspect "$NETWORK" >/dev/null 2>&1 \
  || die "Không thấy network docker '$NETWORK'. Xem 'docker network ls | grep realestate_net' rồi chạy lại với NETWORK=<tên>."

# Image builder cần vài GB: kiểm tra trống trước khi dựng (kể cả dry-run, vì dry-run cũng phải dựng image).
require_free_disk_gb "$MIGRATE_MIN_FREE_GB"

# ── Backup bắt buộc khi --apply ──────────────────────────────────────────────
if (( APPLY == 1 )); then
  newest=""
  while IFS= read -r -d '' f; do
    if [[ -z "$newest" || "$f" -nt "$newest" ]]; then newest="$f"; fi
  done < <(find backups -type f -name '*.archive.gz' -size +0c -mmin "-${BACKUP_MAX_AGE_MINUTES}" -print0 2>/dev/null || true)
  if [[ -z "$newest" ]]; then
    die "Không có backup mongodump (*.archive.gz, > 0 byte) nào trong ./backups/ mới hơn ${BACKUP_MAX_AGE_MINUTES} phút. Tạo backup NGAY trước khi apply theo $DOC mục 6 (mongodump) rồi chạy lại. Không --apply khi không có backup."
  fi
  # Kiểm cả nội dung (không chỉ định dạng): gzip hợp lệ + mongorestore --dryRun (chỉ đọc) thấy realestate.users.
  # 002 --apply còn XÓA/GHI ở raw_articles và news_articles: backup phải chứa cả hai (backup cắt --nsInclude realestate.users bị từ chối).
  # Chỉ đòi collection ĐANG TỒN TẠI trong DB thật (mongodump không sinh namespace cho collection chưa có, đòi nó là chặn oan);
  # không hỏi được danh sách collection thì DỪNG, không đoán.
  required_colls=()
  if [[ "$MIGRATION" == "002" ]]; then
    existing="$(existing_collections "$MONGO_CONTAINER" raw_articles news_articles)"       || die "Không đọc được danh sách collection của DB realestate (mongosh lỗi/quá hạn) để biết backup phải chứa gì. Dừng, chưa ghi gì."
    # shellcheck disable=SC2206  # tách theo khoảng trắng có chủ ý: tên collection chỉ gồm [A-Za-z0-9_]
    required_colls=($existing)
    log "002 --apply: backup phải chứa realestate.users và các collection đang có: ${existing:-(không có collection bài viết nào)}."
  fi
  verify_backup_archive "$newest" "$MONGO_CONTAINER" "${required_colls[@]+"${required_colls[@]}"}" || die "Backup $newest không đạt kiểm tra nội dung. Tạo lại backup rồi chạy lại."
  log "Backup dùng làm điều kiện: $newest ($(wc -c < "$newest") byte, đã kiểm nội dung). Nhớ đã chép nó ra NGOÀI máy chủ."
fi

# ── Cảnh báo 006 ─────────────────────────────────────────────────────────────
if [[ "$MIGRATION" == "006" ]]; then
  {
    echo "!!! CẢNH BÁO 006: bước --apply XÓA VĨNH VIỄN toàn bộ khu vực (areas) cũ, và đặt areaId = null"
    echo "!!! cho khách/dự án đang trỏ khu vực không thuộc 34 tỉnh. Script KHÔNG hoàn tác được:"
    echo "!!! chỉ khôi phục bằng mongorestore từ backup. Cần Mongo replica set (chạy trong 1 transaction)."
  } >&2
  if (( APPLY == 1 && ASSUME_YES == 0 )); then
    [[ -t 0 ]] || die "006 --apply cần xác nhận: chạy trong terminal, hoặc thêm --yes khi đã chắc chắn."
    read -r -p "Gõ XOA-KHU-VUC-CU để tiếp tục: " confirm
    [[ "$confirm" == "XOA-KHU-VUC-CU" ]] || die "Không xác nhận, dừng (chưa ghi gì)."
  fi
fi

# ── Cảnh báo 002 (--apply) ───────────────────────────────────────────────────
if [[ "$MIGRATION" == "002" ]] && (( APPLY == 1 )); then
  {
    echo "!!! CẢNH BÁO 002 --apply: XÓA VĨNH VIỄN các bản trùng url ở raw_articles và news_articles (giữ bài cũ nhất), rồi"
    echo "!!! đổi urlHash MD5 -> SHA-256. Snapshot NDJSON mà script in ra nằm TRONG container và MẤT khi thoát, nên ĐƯỜNG LUI"
    echo "!!! DUY NHẤT là backup mongodump vừa kiểm ở trên (mongorestore --nsInclude 'realestate.*', xem $DOC mục 6)."
    echo "!!! Đã chạy dry-run 002 và đọc số bài trùng sẽ bị xóa chưa?"
  } >&2
  if (( ASSUME_YES == 0 )); then
    [[ -t 0 ]] || die "002 --apply cần xác nhận: chạy trong terminal, hoặc thêm --yes khi đã chắc chắn."
    read -r -p "Gõ XOA-BAN-TRUNG-URL để tiếp tục: " confirm
    [[ "$confirm" == "XOA-BAN-TRUNG-URL" ]] || die "Không xác nhận, dừng (chưa ghi gì)."
  fi
fi

# ── Dựng image từ stage `builder` ────────────────────────────────────────────
tag="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)"
IMAGE="realestate-migrate:${tag}"
log "Dựng image $IMAGE từ stage builder (có thể mất vài phút lần đầu; có cache các lần sau)..."
docker build --target builder -t "$IMAGE" "./$BACKEND_DIR"

# ── File env tạm (600) chứa MONGODB_URI ──────────────────────────────────────
umask 077
ENV_TMP="$(mktemp "${TMPDIR:-/tmp}/realestate-migrate-env.XXXXXX")"
chmod 600 "$ENV_TMP"
# printf là builtin: mật khẩu không xuất hiện trong danh sách tiến trình. Host `mongo` = tên service trong network compose.
printf 'MONGODB_URI=mongodb://%s:%s@mongo:27017/realestate?authSource=admin&replicaSet=rs0\n' "$MONGO_USER" "$MONGO_PWD" > "$ENV_TMP"
unset MONGO_PWD

# ── Chạy migration ───────────────────────────────────────────────────────────
args=()
(( APPLY == 1 )) && args+=(--apply)
log "Migration $MIGRATION — chế độ: $( (( APPLY == 1 )) && echo APPLY || echo DRY-RUN ) — network: $NETWORK"
# set +e quanh docker run để còn in hướng dẫn tiếp theo theo đúng mã thoát.
set +e
docker run --rm --network "$NETWORK" --env-file "$ENV_TMP" "$IMAGE" \
  node_modules/.bin/ts-node "$SCRIPT_REL" "${args[@]+"${args[@]}"}"
rc=$?
set -e

if (( rc != 0 )); then
  die "Migration $MIGRATION thất bại (mã $rc). Xem output ở trên; chạy lại là an toàn (migration idempotent). Dữ liệu có thể đã đổi một phần với 005; 006 chạy trong 1 transaction nên không đổi nửa vời."
fi

if (( APPLY == 1 )); then
  log "Đã ghi xong migration $MIGRATION. Chạy lại ở chế độ dry-run để xác nhận không còn gì cần ghi:  bash scripts/run-migration.sh $MIGRATION"
else
  log "DRY-RUN xong, chưa ghi gì. Kiểm tra số liệu, backup, rồi chạy lại với --apply."
fi
if (( CLEANUP == 0 )); then
  log "Chưa dùng --cleanup: image $IMAGE và build cache (~vài GB) còn trên đĩa. Dọn: docker image rm $IMAGE ; docker builder prune -f"
fi
