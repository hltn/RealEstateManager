#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — cập nhật stack production ĐANG CHẠY ổn định lên commit mới nhất của NHÁNH ĐANG CHECKOUT (theo upstream của nhánh đó).
#
# Chạy ở máy chủ (Ubuntu 24.04), trong thư mục repo:
#   bash deploy.sh [--no-pull] [--no-migrate | --migrate] [--plan-only] [--help]
# (Dùng `bash deploy.sh`, không phụ thuộc bit thực thi: commit từ Windows có thể làm mất bit này.)
# Tài liệu: docs/01_Infrastructure/06_Production_Deploy.md (mục 11). Chạy trong tmux/nohup để rớt SSH không làm
# gián đoạn giữa chừng.
#
# KHÔNG phải công cụ nâng cấp standalone lần đầu (Mongo cũ không xác thực -> replica set + auth):
# lần đó làm theo mục 5 của tài liệu, từng bước bằng tay. Script này từ chối chạy nếu thấy Mongo cũ.
#
# Git: `git pull --ff-only` chạy trên NHÁNH ĐANG CHECKOUT, dùng upstream của nhánh đó (KHÔNG hardcode tên nhánh/remote, không phụ thuộc tên nhánh).
# Từ chối pull (gợi ý --no-pull, KHÔNG đoán nhánh) khi HEAD detached hoặc nhánh chưa có upstream; vẫn chặn file đã theo dõi bị sửa và không ff.
#
# Các bước: tiền điều kiện (+ dung lượng đĩa) -> git pull (ff-only) -> `compose config -q` -> kiểm tra migration 005
# -> chuẩn bị logs/ -> mongodump ra ./backups (kiểm cả nội dung; bỏ qua nếu DB chưa có dữ liệu: không `users`, không document nào) -> gắn thẻ image backend hiện tại làm bản dự phòng
# -> build backend (kèm GIT_COMMIT) -> runner migration `reconcile` (PT-027, bước 6b): dry-run xem kế hoạch, rồi
# `reconcile --apply --skip-version --phase pre-up` NGAY SAU backup (tự baseline 002..006 nếu probe chỉ-đọc chứng minh dữ liệu không còn việc,
# rồi chạy migration pre-up 007..010 còn chờ; migration pha `post-up` như 011 KHÔNG chạy ở đây) -> `up -d --build` -> chờ mongo healthy + backend liveness -> `reconcile --apply --phase pre-up`
# (bước 8b, chỉ còn ghi `version`; CÀI MỚI không có container Mongo: 6b/8b bỏ qua, bước 8a chạy `reconcile --apply --phase pre-up` đủ 007..010 + version ngay sau liveness) -> điểm gọi hậu-migrate DÙNG CHUNG `run_post_migrate_steps` (8c cũ, T-03/T-17): chạy các tệp scripts/post-migrate/[0-9][0-9]-*.sh theo thứ tự tên, bỏ qua toàn bộ khi downgrade:
#   10-catalog-codes.sh     (v1.0.4) `crm-catalog-codes.cli.js --apply`, log deploy-catalog-codes-<TS>.log
#   20-customer-codes.sh    (v1.0.5) `crm-customer-codes.cli.js --apply`, log deploy-customer-codes-<TS>.log (CLI thoát 0 và không làm gì nếu sổ chưa có 010)
#   90-post-up-migrations.sh (v1.0.5) `reconcile --apply --skip-version --phase post-up` = migration 011 MỘT CHIỀU (bỏ unique SĐT), log deploy-post-up-<TS>.log;
#                           TỪ CHỐI chạy (exit khác 0) nếu `status` còn migration pre-up chờ (gồm 010) hoặc không đọc được trạng thái
# chạy MỌI lần deploy, ngay sau khi backend sống (idempotent). Bước thoát mã khác 0 thì in cảnh báo ĐỎ, ghi log riêng của bước
# và deploy THẤT BẠI (exit khác 0, kèm tên bước), các bước sau KHÔNG chạy, KHÔNG im lặng. Lý do: khoảng trống giữa 6b
# (migration 007/008/010 chạy khi image cũ còn phục vụ) và `up` có thể để lại vài bản ghi chưa có `code`/`customerCode`.
#
# Tự migrate MẶC ĐỊNH BẬT (DEPLOY_AUTO_MIGRATE=1). Tắt bằng --no-migrate (giữ hành vi cũ: có việc chờ hoặc cần baseline
# thì DỪNG trước `up`; cờ này chỉ chặn migrate TRƯỚC `up` ở 6b, còn 8b vẫn chạy `reconcile --apply` để ghi phiên bản khi DB sạch,
# xem mục 11.1). --migrate là bí danh giữ lại cho tương thích. --plan-only: build + `reconcile` dry-run rồi thoát,
# không backup, không `up`, stack không đổi (chạy một lần trước lần deploy 1.0.3 đầu tiên).
# Mã thoát của runner `reconcile`: 0 ok | 1 lỗi hoặc từ chối | 3 có khóa | 4 cần xử lý tay (probe không đạt) | 5 downgrade.
# Mã 1/3/4/5 ở dry-run: deploy DỪNG trước `up` (stack chưa đổi). Downgrade CỐ Ý cần DEPLOY_ALLOW_DOWNGRADE=1: bỏ qua
# migrate, KHÔNG ghi và KHÔNG hạ `version` trong DB.
#
# BACKUP CODE + MANIFEST (bước 2b, trong git_update, SAU các cổng chặn (nhánh có upstream, working tree sạch) và TRƯỚC `git pull`; --plan-only KHÔNG tạo; --no-pull và downgrade VẪN tạo):
# ghi lại nhánh + commit đang checkout trên máy chủ (không giả định tên nhánh): git bundle backups/deploy-code-pre-<TS>.bundle (đã `git bundle verify`, quyền 600),
# tag CỤC BỘ pre-deploy-<TS> tại commit cũ (không push), và manifest backups/deploy-pre-<TS>.manifest (KEY=VALUE, không bí mật: nhánh, commit cũ/mới,
# version app cũ/mới, version DB trước deploy, đường dẫn backup Mongo + bundle, image dự phòng, project compose, trạng thái deploy). Không tạo được bundle = `die`.
# KHÔI PHỤC DB + code về bản trước: `bash scripts/restore.sh --list` rồi `bash scripts/restore.sh --manifest backups/deploy-pre-<TS>.manifest` (mặc định chỉ dry-run;
# chạy thật cần `--apply --yes`). Chi tiết: tài liệu mục 6 và 11.
# deploy.sh VẪN tự backup mỗi lần deploy (như trên). Muốn backup THỦ CÔNG ngoài lần deploy (vd trước khi sửa tay): `bash scripts/backup.sh` (bản chạy tay
# độc lập, cùng định dạng archive/bundle/tag/manifest, restore.sh đọc được; KHÔNG được deploy.sh gọi). Xem tài liệu mục 6.2.
#
# KHÔNG rollback bằng `git checkout`: khi dữ liệu Mongo đã được nâng cấp (replica set/auth, migration),
# compose và code cũ không đọc được volume mới, nên quay code về commit cũ có thể làm hỏng thêm.
# Khi lỗi, script chỉ IN hướng dẫn (log, image dự phòng, scripts/restore.sh, mục 5.8 khi dữ liệu đã đổi) rồi thoát mã khác 0.
# NGOẠI LỆ v1.0.4: migration 007 (mã danh mục) và 008 (loại hình) CHỈ THÊM trường mới, vẫn ghi id cũ, nên SAU hai migration này
# vẫn được lùi IMAGE về bản `pre-<thời-gian>` (L1, an toàn). Khi tiến lại thì bước hậu-migrate 10-catalog-codes (8c cũ) chạy lại và sửa bản ghi image cũ vừa ghi
# thiếu `code`. Chỉ khi cần dọn trường mới mới `$unset` (L2, SAU khi đã lùi image); mongorestore từ deploy-pre-* là L3, cuối cùng.
# Migration khác (005/006, nâng cấp Mongo...) vẫn KHÔNG lùi image. Chi tiết: tài liệu mục 11.
# NGOẠI LỆ v1.0.5: 010 (index mã khách partial + counter) cũng chỉ thêm nên lùi được image TRƯỚC bước 90. Bước 90 chạy 011 (bỏ unique SĐT, MỘT CHIỀU):
# SAU bước 90 chỉ sửa tiến, KHÔNG lùi image v1.0.3 (SĐT có thể null/trùng, v1.0.3 giả định chuỗi); print_recovery nêu rõ và nêu cách kiểm 011.
#
# Bí mật: script KHÔNG chứa bí mật. Mọi lệnh compose kèm `--env-file .env.docker`. Mật khẩu root Mongo chỉ được đọc
# từ biến môi trường BÊN TRONG container và đưa cho mongodump/mongorestore qua pipe (không nằm trên dòng lệnh, không
# ghi ra đĩa, không in ra màn hình/log). Healthcheck Mongo của compose cũng xác thực trong script mongosh (PT-002),
# không có `-p` trên dòng lệnh. Runner migration nhận MONGODB_URI từ môi trường của container backend (compose dựng).
#
# Biến môi trường tùy chọn (không bí mật):
#   MONGO_TIMEOUT       giây chờ mongo healthy           (mặc định 120)
#   HEALTH_TIMEOUT      giây chờ backend liveness        (mặc định 120)
#   HEALTH_URL          URL liveness (qua nginx cổng 80) (mặc định http://localhost/api/v1/health/liveness)
#   DEPLOY_MIN_FREE_GB  dung lượng trống tối thiểu (GB) ở thư mục repo và thư mục dữ liệu Docker (mặc định 5: build backend + frontend
#                       cần image + build cache vài GB)
#   DUMP_TIMEOUT        giây tối đa cho mongodump (mặc định 900); OPS_EXEC_TIMEOUT giây tối đa cho bước kiểm nội dung backup (mặc định 300)
#   DEPLOY_AUTO_MIGRATE   1 (mặc định) = tự baseline + migrate sau backup; 0 = như --no-migrate (cờ dòng lệnh thắng biến)
#   DEPLOY_ALLOW_DOWNGRADE  1 = cho phép CỐ Ý deploy code có version thấp hơn DB (bỏ qua migrate, không hạ version); mặc định 0
#   MONGO_CONTAINER, BACKEND_CONTAINER  tên container (mặc định realestate_mongo, realestate_backend; chỉ đổi khi thử nghiệm)
#   DEPLOY_ENV_FILE, DEPLOY_RUNTIME_ENV_FILE, DEPLOY_LOGS_DIR, DEPLOY_BACKUP_DIR, NINE_ROUTER_CONTAINER  CHỈ cho staging local
#                       (scripts/staging.sh đặt; mục 11.3 tài liệu). Production KHÔNG đặt: mặc định .env.docker, .env, logs, backups, realestate_9router
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="deploy"
# Resolve symlink bằng `readlink -f` (GNU coreutils, có trên Ubuntu): gọi qua symlink vẫn tìm đúng thư mục repo.
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[deploy] LỖI: không resolve được đường dẫn thật của deploy.sh (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")" && pwd)"
# shellcheck source=scripts/lib/ops-common.sh
source "$ROOT_DIR/scripts/lib/ops-common.sh"

# Các biến DEPLOY_* / NINE_ROUTER_CONTAINER dưới đây CHỈ để chạy staging local (scripts/staging.sh đặt chúng); production không đặt
# gì nên giữ đúng mặc định cũ (.env.docker, ./.env, ./logs, ./backups, realestate_9router).
readonly ENV_FILE="${DEPLOY_ENV_FILE:-.env.docker}"
readonly RUNTIME_ENV_FILE="${DEPLOY_RUNTIME_ENV_FILE:-.env}"   # file backend bind-mount làm /app/.env
readonly LOGS_DIR="${DEPLOY_LOGS_DIR:-logs}"
readonly BACKUP_DIR="${DEPLOY_BACKUP_DIR:-backups}"
readonly NINE_ROUTER_CONTAINER="${NINE_ROUTER_CONTAINER-realestate_9router}"   # đặt RỖNG để bỏ qua cảnh báo 9Router (staging)
readonly MONGO_CONTAINER="${MONGO_CONTAINER:-realestate_mongo}"
readonly BACKEND_CONTAINER="${BACKEND_CONTAINER:-realestate_backend}"
readonly DEFAULT_PROJECT="realestatemanager"   # tên project compose = tên thư mục repo (không đổi, xem docker-compose.yml)
readonly DOC="docs/01_Infrastructure/06_Production_Deploy.md"

# Kiểm các biến chỉ dành cho staging NGAY khi nạp script (valid_rel_path/check_staging_vars nằm ở scripts/lib/ops-common.sh, dùng chung với scripts/restore.sh).
check_staging_vars

MONGO_TIMEOUT="${MONGO_TIMEOUT:-120}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
HEALTH_URL="${HEALTH_URL:-http://localhost/api/v1/health/liveness}"
DEPLOY_MIN_FREE_GB="${DEPLOY_MIN_FREE_GB:-5}"
DUMP_TIMEOUT="${DUMP_TIMEOUT:-900}"

NO_PULL=0
TS="$(date +%Y%m%d-%H%M%S)"
OLD_COMMIT=""
NEW_COMMIT=""
BACKUP_FILE=""
PREV_IMAGE_TAG=""
PREV_IMAGE_REPO=""
STACK_TOUCHED=0   # =1 ngay trước `up` (hoặc trước `reconcile --apply`): từ đây stack/dữ liệu có thể đã bị thay đổi
AUTO_MIGRATE="${DEPLOY_AUTO_MIGRATE:-1}"        # 1 = tự baseline + migrate sau backup (mặc định); 0 = --no-migrate
ALLOW_DOWNGRADE="${DEPLOY_ALLOW_DOWNGRADE:-0}"  # 1 = chấp nhận CỐ Ý version code < version DB
PLAN_ONLY=0       # =1 khi có --plan-only: chạy đến hết `reconcile` dry-run rồi thoát (không backup, không up)
DOWNGRADE_ACTIVE=0     # =1 khi runner báo downgrade và DEPLOY_ALLOW_DOWNGRADE=1: bỏ qua migrate và việc ghi version
FRESH_INSTALL=0        # =1 khi chưa có container Mongo (triển khai mới, DB trống): 6b/8b không chạy được, bước 8a bù bằng reconcile sau liveness (T-19)
MIGRATION_GATE_RAN=0   # =1 khi đã đọc được trạng thái migration (Mongo healthy): chỉ khi đó mới ghi phiên bản sau deploy
DB_EMPTY_NO_BACKUP=0   # =1 khi Mongo đã chạy nhưng DB `realestate` CHƯA có dữ liệu (không có `users`, không collection nào có document): bỏ qua backup

usage() {
  cat <<'EOF'
Cách dùng: bash deploy.sh [--no-pull] [--no-migrate | --migrate] [--plan-only] [--help]

Cập nhật stack production đang chạy lên bản mới nhất của nhánh ĐANG CHECKOUT (git pull --ff-only theo upstream của nhánh đó).

  --no-pull     Không git pull; build và deploy đúng commit đang checkout. Dùng khi HEAD detached hoặc nhánh chưa có upstream
                (script từ chối pull trong hai trường hợp đó và KHÔNG đoán nhánh).
  --no-migrate  TẮT tự migrate (mặc định là BẬT, hoặc DEPLOY_AUTO_MIGRATE=0). Giữ hành vi cũ: runner `status`; còn migration
                chờ hoặc cần baseline thì script DỪNG trước `up` (stack không đổi) và in lệnh để chạy tay. Cờ này chỉ chặn migrate
                TRƯỚC `up` (6b); bước 8b sau khi backend sống vẫn chạy `reconcile --apply` và vẫn ghi phiên bản khi DB sạch.
  --migrate     Bí danh của chế độ mặc định (tự migrate đã bật sẵn); giữ lại cho tương thích. Không dùng cùng --no-migrate.
  --plan-only   Chạy đến hết `reconcile` dry-run (runner trong image backend vừa build, MỌI pha: thấy cả 011 post-up) rồi THOÁT: không backup, không ghi
                gì vào DB, không `up`, stack không đổi. Dùng một lần trước lần deploy 1.0.3 đầu tiên để xem kết quả probe.
                Có git pull (trừ khi kèm --no-pull) và build image backend (vài phút, cần đĩa như deploy thường).
                Kèm --no-migrate (hoặc DEPLOY_AUTO_MIGRATE=0): --plan-only VẪN thắng, vẫn chạy `reconcile` dry-run (script in một
                dòng thông báo); cờ tắt chỉ áp dụng cho lần deploy thật sau đó. Không từ chối (mã 2) để khỏi vướng biến môi trường.
  -h, --help    Hiện trợ giúp này.

Tự migrate (mặc định): SAU backup, TRƯỚC `up`, runner `reconcile` (1) lập kế hoạch dry-run, (2) --apply --skip-version:
  - DB đã có dữ liệu mà `system` chưa có `version`: probe CHỈ-ĐỌC cho 002..006; đạt hết thì ghi sổ baseline (không chạy lại
    002..006), không đạt thì DỪNG (mã 4), không ghi gì;
  - chạy migration pre-up 007..010 còn chờ (`--phase pre-up`; đúng thứ tự, dừng ở lỗi). Migration post-up (011) KHÔNG chạy ở đây.
Sau khi backend sống, bước 8b `reconcile --apply --phase pre-up` chỉ còn ghi `version` (lỗi chỉ cảnh báo).
Rồi điểm gọi hậu-migrate scripts/post-migrate/ (8c cũ, MỌI lần deploy, theo thứ tự tên): 10-catalog-codes.sh (`crm-catalog-codes.cli.js --apply`: bù mã danh mục),
20-customer-codes.sh (`crm-customer-codes.cli.js --apply`: bù mã khách), 90-post-up-migrations.sh (`reconcile --apply --skip-version --phase post-up`: migration 011 MỘT CHIỀU, bỏ
unique SĐT; TỪ CHỐI chạy nếu còn migration pre-up chờ/gồm 010 chưa áp dụng). Bước thoát mã khác 0 thì in cảnh báo đỏ, ghi log và deploy báo LỖI (exit khác 0), khác với 8b; các bước sau không chạy.
Dừng TRƯỚC `up` (stack chưa đổi) khi runner trả: 3 có khóa | 4 probe không đạt | 5 downgrade | 1 lỗi hoặc từ chối.
Downgrade CỐ Ý (khôi phục image cũ): DEPLOY_ALLOW_DOWNGRADE=1 bash deploy.sh ... : bỏ qua migrate, KHÔNG ghi/hạ `version`.

Backup trước deploy (khi không --plan-only): ngoài mongodump còn backup CODE của nhánh đang checkout (bất kể tên nhánh): git bundle
backups/deploy-code-pre-<thời-gian>.bundle + tag cục bộ pre-deploy-<thời-gian> + manifest backups/deploy-pre-<thời-gian>.manifest (nhánh, commit, version
app/DB trước deploy, đường dẫn backup, image dự phòng). Quay DB + code về bản trước: bash scripts/restore.sh --list ; bash scripts/restore.sh --latest
(mặc định dry-run; chạy thật cần --apply --yes). Xem bash scripts/restore.sh --help.
Backup thủ công ngoài lần deploy (không đụng stack): bash scripts/backup.sh [--db-only | --code-only] (xem bash scripts/backup.sh --help); deploy.sh vẫn tự backup như trên.

Điều kiện: chạy trong thư mục repo; có .env.docker với quyền không rộng hơn 600 (chmod 600 .env.docker) và đã điền
hết giá trị mẫu <...>; đủ dung lượng đĩa (DEPLOY_MIN_FREE_GB, mặc định 5 GB); working tree sạch (với git pull);
đang ở một nhánh có upstream (không detached; tên nhánh tùy ý) khi có git pull, hoặc dùng --no-pull; chạy trong tmux/nohup.

Script làm: git pull --ff-only theo upstream của nhánh hiện tại (trước đó: bundle + tag + manifest backup code) -> docker compose config -q -> kiểm tra không còn user chưa migrate 005
-> mongodump ra ./backups (bắt buộc > 0 byte, gzip hợp lệ, có realestate.users; riêng DB chưa có dữ liệu thì bỏ qua, có cảnh báo) -> gắn thẻ image backend hiện tại thành
<project>-backend:pre-<thời-gian> -> build backend (ghi GIT_COMMIT vào image) -> runner migration `reconcile` (bước 6b, xem trên;
với --no-migrate: `status`, dừng nếu còn migration chờ hoặc cần baseline) -> up -d --build -> chờ mongo healthy và
backend liveness -> ghi phiên bản vào collection `system` (bước 8b) -> điểm gọi hậu-migrate scripts/post-migrate/ (10 bù mã danh mục, 20 bù mã khách, 90 migration post-up 011; lỗi = deploy báo lỗi).

Lùi image sau migration 007/008 (v1.0.4) và 010 (v1.0.5): ĐƯỢC, vì chỉ thêm trường/index (L1). Lần tiến lại, các bước hậu-migrate 10 và 20 tự sửa bản ghi thiếu mã.
Lùi image TRƯỚC bước 90 (011 chưa chạy): được; sau bước 90 chỉ sửa tiến, KHÔNG lùi image v1.0.3 (011 một chiều). Kiểm 011 đã chạy chưa bằng `status` của runner (print_recovery hướng dẫn).

KHÔNG dùng cho lần nâng cấp standalone đầu tiên (xem mục 5 tài liệu). KHÔNG rollback bằng git checkout.
Biến tùy chọn: MONGO_TIMEOUT, HEALTH_TIMEOUT (giây, mặc định 120), HEALTH_URL, DEPLOY_MIN_FREE_GB, DUMP_TIMEOUT,
DEPLOY_AUTO_MIGRATE (1|0, mặc định 1), DEPLOY_ALLOW_DOWNGRADE (1|0, mặc định 0). Chi tiết: tài liệu mục 11 và 11.1.
EOF
}

# Mọi lệnh compose đều kèm --env-file (thiếu là biến ${...} bắt buộc báo lỗi hoặc mật khẩu bị rỗng).
compose() { docker compose --env-file "$ENV_FILE" "$@"; }

# In hướng dẫn xử lý khi thất bại SAU KHI stack có thể đã bị thay đổi. Không rollback tự động.
print_recovery() {
  {
    echo
    echo "════════════ DEPLOY THẤT BẠI — script KHÔNG tự rollback ════════════"
    echo "Commit trước deploy: ${OLD_COMMIT:-?}  |  commit đang checkout: ${NEW_COMMIT:-?}"
    [[ -n "$BACKUP_FILE" ]] && echo "Backup Mongo trước deploy: $BACKUP_FILE"
    if [[ -n "${MANIFEST_FILE:-}" ]]; then
      echo "Backup code + manifest: ${MANIFEST_FILE} (bundle + tag cục bộ pre-deploy-${TS}; nhánh/commit cũ ghi trong manifest)"
      echo "Khôi phục DB + code về bản trước deploy bằng script riêng (mặc định chỉ dry-run, chạy thật cần --apply --yes):"
      echo "     bash scripts/restore.sh --manifest ${MANIFEST_FILE}              # xem kế hoạch + kiểm trước, chưa đổi gì"
      echo "     bash scripts/restore.sh --manifest ${MANIFEST_FILE} --apply --yes"
      if (( ${POST_UP_REACHED:-0} == 1 )); then
        echo "   LƯU Ý: deploy này đã tới điểm hậu-migrate; nếu bước 90 (migration 011 MỘT CHIỀU) đã chạy thì restore.sh --apply là đường quay lại DUY NHẤT"
        echo "   và MẤT dữ liệu phát sinh sau thời điểm backup Mongo (restore.sh cảnh báo đỏ và vẫn đòi --yes)."
      fi
    fi
    echo
    echo "1) Xem nguyên nhân:"
    echo "     docker compose --env-file $ENV_FILE ps -a"
    echo "     docker compose --env-file $ENV_FILE logs --tail 100 backend"
    echo "     docker compose --env-file $ENV_FILE logs --tail 50 mongo"
    echo
    if [[ -n "$PREV_IMAGE_TAG" ]]; then
      echo "2) Chỉ khi dữ liệu Mongo CHƯA bị đổi (chưa chạy migration --apply, chưa nâng cấp Mongo) mới được dùng lại"
      echo "   image backend cũ đã gắn thẻ:"
      echo "     docker tag $PREV_IMAGE_TAG ${PREV_IMAGE_REPO}:latest"
      echo "     docker compose --env-file $ENV_FILE up -d --no-build --no-deps backend"
    else
      echo "2) Không có image backend dự phòng (lần deploy đầu, chưa có container backend)."
    fi
    echo
    echo "2b) NGOẠI LỆ migration 007/008 (v1.0.4, chỉ THÊM trường, vẫn ghi id cũ): vẫn lùi được IMAGE về bản pre-<thời-gian> (L1)"
    echo "   dù migration đã --apply. Khi tiến lại, bước hậu-migrate 10-catalog-codes.sh (crm-catalog-codes.cli.js --apply) tự sửa bản ghi image cũ ghi thiếu mã."
    echo "   Chỉ khi cần dọn trường mới: \$unset các trường mã SAU KHI đã lùi image (L2). mongorestore từ deploy-pre-* là L3, cuối cùng"
    echo "   (mất dữ liệu phát sinh sau backup). Không áp dụng ngoại lệ này cho migration khác."
    echo
    echo "2c) v1.0.5 — migration 010 (index mã khách partial + counter) chỉ THÊM nên lùi IMAGE v1.0.3 vẫn được, miễn là TRƯỚC bước 90."
    echo "   Bước 90 (scripts/post-migrate/90-post-up-migrations.sh) chạy migration 011 MỘT CHIỀU: bỏ unique SĐT (phone_1 thành index thường),"
    echo "   ẩn danh 'anonymized:' thành null. Kiểm 011 đã chạy chưa:"
    echo "     $(runner_cmd_hint) status      # CHỈ tin status: 011_crm_drop_unique_phone nằm trong mục 'đã áp dụng' = đã chạy; còn 'đang chờ' = chưa chạy"
    echo "     (file $LOGS_DIR/deploy-post-up-${TS}.log chỉ để đọc LÝ DO lỗi/từ chối: bước 90 tạo nó cả khi cổng chặn từ chối, nên có file KHÔNG có nghĩa 011 đã chạy)"
    echo "   - 011 CHƯA chạy (bước 10/20 lỗi, hoặc bước 90 từ chối vì còn migration pre-up chờ): lùi image v1.0.3 theo mục 2/2b như thường lệ"
    echo "     (phone_1 vẫn unique, mã khách thừa không ảnh hưởng v1.0.3)."
    echo "   - 011 ĐÃ chạy (bước 90 xong hoặc chạy dở): sau bước 90 chỉ sửa tiến (fix-forward), KHÔNG lùi image v1.0.3: phone có thể null/trùng,"
    echo "     mapper v1.0.3 giả định phone là chuỗi. Sửa nguyên nhân rồi deploy lại. Quay lại duy nhất bằng mongorestore từ ${BACKUP_FILE:-file deploy-pre-*}"
    echo "     (mất dữ liệu sau thời điểm dump) và do Oniichan quyết định."
    echo
    echo "3) Nếu dữ liệu ĐÃ đổi (migration 005/006, nâng cấp Mongo...): KHÔNG quay về code/image cũ, bản cũ có thể"
    echo "   không đọc được dữ liệu mới. Với deploy thường lệ (lâu sau lần nâng cấp standalone) CHỈ dùng mongorestore"
    echo "   từ file deploy-pre-* ($DOC mục 6, luôn kèm --nsInclude 'realestate.*'). Mục 5.8 (khôi phục volume) chỉ dành"
    echo "   cho sự cố NGAY sau lần nâng cấp standalone: nó đưa cả DB về ngày nâng cấp, mất mọi dữ liệu phát sinh sau đó."
    echo "   Không dùng 'docker compose down -v' (xóa vĩnh viễn dữ liệu)."
  } >&2
}

on_exit() {
  local code=$?
  trap - EXIT
  set +e   # handler phải chạy hết dù set -e đang bật và stderr đã chết (SSH rớt): các lệnh in không được làm thoát sớm
  trap '' PIPE
  manifest_finish "$code" || true   # chốt manifest backup code (succeeded/failed + commit mới); không đổi mã thoát
  if (( code != 0 )); then
    if (( STACK_TOUCHED == 1 )); then
      print_recovery
    else
      warn "Dừng TRƯỚC khi đụng tới stack đang chạy (stack không đổi). Commit trước: ${OLD_COMMIT:-?}, hiện tại: ${NEW_COMMIT:-?}."
    fi
  fi
  exit "$code"
}
trap on_exit EXIT
# Bị ngắt (kill/Ctrl-C/rớt SSH) phải thoát với mã KHÁC 0 để on_exit biết là THẤT BẠI (manifest ghi `failed`, không ghi nhầm `succeeded`; in hướng dẫn
# khi đã đụng stack). `exit N` trong trap tín hiệu bảo đảm on_exit luôn nhận mã N (128 + số tín hiệu), không phụ thuộc lệnh con đang chạy.
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# ── 1) Tiền điều kiện ────────────────────────────────────────────────────────
check_prereqs() {
  local cmd
  for cmd in docker curl gzip; do
    command -v "$cmd" >/dev/null 2>&1 || die "Thiếu lệnh '$cmd'."
  done
  (( NO_PULL == 1 )) || command -v git >/dev/null 2>&1 || die "Thiếu lệnh 'git'."
  docker compose version >/dev/null 2>&1 || die "Thiếu 'docker compose' (plugin v2)."
  docker info >/dev/null 2>&1 || die "Không nói chuyện được với Docker daemon (daemon chưa chạy, hoặc user thiếu quyền: thêm vào nhóm 'docker')."

  # .env.docker chứa mật khẩu Mongo/Redis/MinIO, token Cloudflare...: quyền rộng hơn 600 là dừng.
  require_private_file "$ENV_FILE"
  require_no_placeholders "$ENV_FILE"

  # backend bind-mount ./.env; thiếu thì Docker tự tạo THƯ MỤC .env làm backend lỗi.
  if [[ -d "$RUNTIME_ENV_FILE" ]]; then
    die "./$RUNTIME_ENV_FILE là THƯ MỤC (Docker tự tạo khi file thiếu). Xóa nó (rmdir $RUNTIME_ENV_FILE), rồi 'touch $RUNTIME_ENV_FILE'."
  fi
  [[ -e "$RUNTIME_ENV_FILE" ]] || { touch "$RUNTIME_ENV_FILE"; log "Đã tạo ./$RUNTIME_ENV_FILE rỗng (backend bind-mount file này)."; }
}

# ── 1b) Backup CODE (nhánh + commit đang chạy trên máy chủ, KHÔNG giả định tên nhánh) ──────────────────────────────
# Chạy trong git_update, SAU các cổng chặn và TRƯỚC `git pull` (HEAD chưa đổi). Tạo: (a) git bundle chứa nhánh/HEAD hiện tại (toàn bộ
# lịch sử tới commit đó, xác minh bằng `git bundle verify`), (b) tag CỤC BỘ pre-deploy-<TS> tại commit cũ (KHÔNG push), (c) manifest
# deploy-pre-<TS>.manifest (KEY=VALUE, không bí mật) mà scripts/restore.sh đọc. Lỗi tạo bundle/manifest = `die` (không im lặng).
# --plan-only KHÔNG gọi (chỉ đọc). --no-pull và downgrade có chủ ý VẪN backup. Không có .git (chỉ khi --no-pull) thì cảnh báo và bỏ qua.
# Thay đổi chưa commit của file đã theo dõi (chỉ có thể xảy ra với --no-pull) KHÔNG nằm trong bundle (cố ý không sao ra patch: patch có thể
# chứa mật khẩu sửa tay); chỉ ghi TRACKED_DIRTY=1 và cảnh báo.
MANIFEST_FILE=""      # đường dẫn manifest sau khi backup_code tạo; rỗng = chưa/không có (plan-only, không .git)
OLD_COMMIT_FULL=""
POST_UP_REACHED=0     # =1 ngay trước điểm gọi hậu-migrate: từ đây bước 90 (011 MỘT CHIỀU) có thể đã chạy, quay lại chỉ còn mongorestore

# Cập nhật một khóa của manifest; KHÔNG bao giờ làm deploy chết (phần "sau" chỉ là thông tin phục hồi). Không có manifest thì bỏ qua.
manifest_set() {
  [[ -n "${MANIFEST_FILE:-}" && -f "$MANIFEST_FILE" ]] || return 0
  manifest_put "$MANIFEST_FILE" "$1" "$2" || warn "Không cập nhật được khóa $1 trong $MANIFEST_FILE (bỏ qua)."
  return 0
}

backup_code() {
  (( PLAN_ONLY == 0 )) || return 0
  # `git rev-parse --git-dir` (không phải `[[ -d .git ]]`): đúng cả với git worktree/submodule, nơi `.git` là FILE.
  if ! in_git_repo; then
    warn "Không phải git repo: không backup được code (chỉ có thể xảy ra với --no-pull). Manifest/bundle KHÔNG được tạo; restore.sh --code-only sẽ không dùng được cho lần deploy này."
    return 0
  fi

  local commit branch="" detached=0 dirty=0 ref bundle part tag host
  commit="$(git rev-parse HEAD)" || die "Không đọc được commit hiện tại (git rev-parse HEAD)."
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die "Commit hiện tại không phải SHA-1 40 ký tự ('$commit'); backup code chưa hỗ trợ."
  if branch="$(git symbolic-ref --short -q HEAD)" && [[ -n "$branch" ]]; then
    ref="refs/heads/$branch"
  else
    branch=""; detached=1; ref="HEAD"
    warn "HEAD đang detached tại ${commit:0:12}: bundle/tag vẫn tạo theo commit này, manifest ghi DETACHED=1."
  fi
  # Cùng quy tắc tên nhánh với scripts/restore.sh (valid_branch_name): không tạo manifest mà restore.sh sẽ từ chối. Chặn luôn `..` trong ref.
  if (( detached == 0 )) && ! valid_branch_name "$branch"; then
    die "Tên nhánh '$branch' có ký tự/dạng mà scripts/restore.sh không chấp nhận (chỉ A-Z a-z 0-9 . _ - /, không bắt đầu bằng - hoặc /, không chứa '..', '//', không kết thúc bằng '.lock' hay '/'). Backup sẽ không khôi phục được: đổi tên nhánh (git branch -m) rồi chạy lại. Chưa đổi gì."
  fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    dirty=1
    warn "Working tree có thay đổi chưa commit ở file đã theo dõi: bundle/tag chỉ chứa commit ${commit:0:12}, KHÔNG chứa các thay đổi đó."
  fi

  install -d -m 700 "$BACKUP_DIR"
  bundle="${BACKUP_DIR}/deploy-code-pre-${TS}.bundle"
  part="${bundle}.partial"
  tag="pre-deploy-${TS}"
  [[ ! -e "$bundle" ]] || die "Đã có $bundle (chạy chồng cùng giây?). Không ghi đè backup: chạy lại sau."
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then die "Đã có tag $tag. Không ghi đè: chạy lại sau."; fi

  log "Backup code: nhánh '${branch:-(detached)}' commit ${commit:0:12} -> $bundle ..."
  if ! ( umask 077; git bundle create "$part" "$ref" ) >/dev/null 2>&1; then
    rm -f "$part"
    die "git bundle create thất bại (repo shallow? hết đĩa?). Không deploy khi không backup được code. Thử tay: git bundle create /tmp/x.bundle HEAD"
  fi
  if ! git bundle verify "$part" >/dev/null 2>&1; then
    rm -f "$part"
    die "Bundle vừa tạo không qua 'git bundle verify'. Không deploy."
  fi
  chmod 600 "$part"
  mv "$part" "$bundle"
  git tag "$tag" "$commit" || die "Không tạo được tag cục bộ $tag."
  log "Đã tạo bundle (đã verify) và tag cục bộ $tag (KHÔNG push tag này)."

  OLD_COMMIT_FULL="$commit"
  MANIFEST_FILE="${BACKUP_DIR}/deploy-pre-${TS}.manifest"
  host="$(hostname 2>/dev/null || true)"
  manifest_write "$MANIFEST_FILE" \
    "MANIFEST_VERSION=1" \
    "TS=${TS}" \
    "CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "HOST=${host:-unknown}" \
    "COMPOSE_PROJECT=${COMPOSE_PROJECT_NAME:-}" \
    "BRANCH=${branch}" \
    "DETACHED=${detached}" \
    "OLD_COMMIT=${commit}" \
    "OLD_COMMIT_SHORT=${commit:0:7}" \
    "NEW_COMMIT=" \
    "APP_VERSION_OLD=$(read_pkg_version || true)" \
    "APP_VERSION_NEW=" \
    "DB_VERSION_BEFORE=" \
    "DB_VERSION_READ=0" \
    "MONGO_BACKUP_FILE=" \
    "MONGO_CONTAINER=${MONGO_CONTAINER}" \
    "BACKEND_CONTAINER=${BACKEND_CONTAINER}" \
    "CODE_BUNDLE=${bundle}" \
    "CODE_BUNDLE_REF=${ref}" \
    "CODE_TAG=${tag}" \
    "PREV_IMAGE_REPO=" \
    "PREV_IMAGE_TAG=" \
    "TRACKED_DIRTY=${dirty}" \
    "NO_PULL=${NO_PULL}" \
    "STACK_TOUCHED=0" \
    "POST_UP_REACHED=0" \
    "DEPLOY_STATUS=started" \
    "FINISHED_AT=" \
    || die "Không ghi được manifest $MANIFEST_FILE."
  log "Manifest: $MANIFEST_FILE (khôi phục: bash scripts/restore.sh --manifest $MANIFEST_FILE)"
}

# Sau backup Mongo + gắn thẻ image, TRƯỚC build/migration: ghi nốt phần "trước deploy" còn lại vào manifest: file backup Mongo, phiên bản DB
# (`system.version`, chỉ đọc; không đọc được thì DB_VERSION_READ=0), image dự phòng. Không có manifest (plan-only/không .git) thì bỏ qua.
manifest_record_deploy_state() {
  [[ -n "${MANIFEST_FILE:-}" && -f "$MANIFEST_FILE" ]] || return 0
  local proj dbv="" got=0
  proj="${PREV_IMAGE_REPO%-backend}"
  [[ -n "$proj" ]] || proj="${COMPOSE_PROJECT_NAME:-$DEFAULT_PROJECT}"
  manifest_set COMPOSE_PROJECT "$proj"
  manifest_set MONGO_BACKUP_FILE "${BACKUP_FILE:-}"
  manifest_set PREV_IMAGE_REPO "${PREV_IMAGE_REPO:-}"
  manifest_set PREV_IMAGE_TAG "${PREV_IMAGE_TAG:-}"
  if [[ "$(inspect_field "$MONGO_CONTAINER" '{{.State.Status}}')" == "running" ]] && dbv="$(read_system_version "$MONGO_CONTAINER")"; then
    got=1
  else
    dbv=""
  fi
  manifest_set DB_VERSION_BEFORE "$dbv"
  manifest_set DB_VERSION_READ "$got"
  log "Manifest: DB version trước deploy = ${dbv:-(không có/không đọc được)}; backup Mongo = ${BACKUP_FILE:-(không có)}; image dự phòng = ${PREV_IMAGE_TAG:-(không có)}."
}

# Gọi từ on_exit (mọi lối thoát): chốt phần "sau" của manifest. Không bao giờ đổi mã thoát.
manifest_finish() {
  local code="$1" st
  [[ -n "${MANIFEST_FILE:-}" && -f "$MANIFEST_FILE" ]] || return 0
  if (( code == 0 )); then st="succeeded"; else st="failed"; fi
  [[ -z "${BACKUP_FILE:-}" ]] || manifest_set MONGO_BACKUP_FILE "$BACKUP_FILE"
  if in_git_repo; then manifest_set NEW_COMMIT "$(git rev-parse HEAD 2>/dev/null || true)"; fi
  manifest_set APP_VERSION_NEW "$(read_pkg_version || true)"
  manifest_set STACK_TOUCHED "$STACK_TOUCHED"
  manifest_set POST_UP_REACHED "$POST_UP_REACHED"
  manifest_set DEPLOY_STATUS "$st"
  manifest_set FINISHED_AT "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  return 0
}

# ── 2) Git ───────────────────────────────────────────────────────────────────
git_update() {
  if (( NO_PULL == 1 )); then
    if in_git_repo; then OLD_COMMIT="$(git rev-parse --short HEAD)"; NEW_COMMIT="$OLD_COMMIT"; fi
    log "--no-pull: bỏ qua git pull${NEW_COMMIT:+, deploy commit hiện tại $NEW_COMMIT}."
    backup_code   # --no-pull VẪN backup code (nhánh/commit đang checkout)
    return 0
  fi
  in_git_repo || die "Không phải git repo (dùng --no-pull nếu cố ý)."

  # Pull trên NHÁNH ĐANG CHECKOUT theo upstream của nhánh đó (không ép tên nhánh, không hardcode remote). Không đoán nhánh:
  # HEAD detached hoặc nhánh chưa có upstream thì từ chối rõ ràng và gợi ý --no-pull.
  local branch upstream
  branch="$(git symbolic-ref --short -q HEAD || true)"
  [[ -n "$branch" ]] || die "HEAD đang detached: không biết pull nhánh nào (script KHÔNG đoán nhánh). Checkout nhánh cần deploy (git switch <nhánh>) hoặc chạy lại với --no-pull để deploy đúng commit đang checkout."
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  [[ -n "$upstream" ]] || die "Nhánh '$branch' chưa có upstream nên không biết pull từ đâu. Đặt upstream (git branch --set-upstream-to=origin/$branch $branch) hoặc chạy lại với --no-pull để deploy đúng commit đang checkout."

  # File chưa theo dõi (logs/, backups/...) không tính; chỉ chặn khi file đã theo dõi bị sửa.
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    git status --short --untracked-files=no >&2
    die "Working tree có thay đổi chưa commit (vd docker-compose.yml sửa tay). Không pull để tránh ghi đè/xung đột. Xử lý theo $DOC mục 5.0a (lưu bản sửa tay ra NGOÀI repo với quyền 600 rồi git checkout -- <file>; KHÔNG git stash vì mật khẩu sẽ nằm lại trong .git), rồi chạy lại."
  fi

  OLD_COMMIT="$(git rev-parse --short HEAD)"
  backup_code   # bundle + tag + manifest của code hiện tại, TRƯỚC khi pull làm đổi HEAD (die nếu không backup được)
  log "Commit hiện tại: $OLD_COMMIT (nhánh $branch, upstream $upstream). Đang git pull --ff-only ..."
  git pull --ff-only
  NEW_COMMIT="$(git rev-parse --short HEAD)"
  manifest_set NEW_COMMIT "$(git rev-parse HEAD)"
  if [[ "$OLD_COMMIT" == "$NEW_COMMIT" ]]; then
    log "Không có commit mới (vẫn $NEW_COMMIT); tiếp tục build/up (idempotent)."
  else
    log "Đã cập nhật $OLD_COMMIT -> $NEW_COMMIT."
  fi
}

# ── 3) Kiểm tra cú pháp + biến bắt buộc của compose (chưa đụng stack) ────────
check_compose() {
  log "Kiểm tra docker compose config (cú pháp + biến bắt buộc)..."
  compose config -q || die "docker compose config lỗi: thiếu/sai biến trong $ENV_FILE (đối chiếu .env.docker.example). Stack chưa bị đổi."
  check_credential_pair MONGO_APP_USERNAME MONGO_APP_PASSWORD
  check_credential_pair S3_APP_ACCESS_KEY_ID S3_APP_SECRET_ACCESS_KEY
}

# Cặp thông tin đăng nhập tùy chọn (PT-016) phải đặt CẢ HAI hoặc KHÔNG đặt: compose ghép từng biến với giá trị dự phòng
# riêng (`${A:-root}`), nên đặt lệch một nửa sẽ tạo cặp user-app + mật khẩu-root và backend xác thực lỗi khi khởi động.
# Chỉ kiểm có/không (không đọc giá trị ra màn hình).
check_credential_pair() {
  local first="$1" second="$2" has_first=0 has_second=0
  grep -qE "^${first}=[^[:space:]]" "$ENV_FILE" && has_first=1
  grep -qE "^${second}=[^[:space:]]" "$ENV_FILE" && has_second=1
  (( has_first == has_second )) || die "$ENV_FILE đặt $first và $second lệch nhau (chỉ một trong hai có giá trị). Đặt cả hai hoặc xóa cả hai. Stack chưa bị đổi."
}

# ── 3b) Cổng migration 005: code mới không khởi động nếu còn user chưa có roles[]/teamIds[] ──
# Đếm CHỈ ĐỌC bằng cùng bộ lọc với UserRolesMigrationGuard. Không đếm được thì cảnh báo, không chặn.
check_users_migrated() {
  local health out pending js
  health="$(inspect_field "$MONGO_CONTAINER" '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
  if [[ "$health" != "healthy" ]]; then
    warn "Mongo không ở trạng thái healthy ($health): bỏ qua kiểm tra migration 005."
    return 0
  fi
  # Mật khẩu root xác thực TRONG script (đọc biến môi trường container), không đưa lên dòng lệnh.
  read -r -d '' js <<'EOF' || true
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const pending = db.getSiblingDB('realestate').users.countDocuments({ $or: [
  { roles: { $not: { $type: 'array' } } }, { roles: { $size: 0 } }, { teamIds: { $not: { $type: 'array' } } } ] });
print('PENDING_USERS=' + pending);
EOF
  if ! out="$(docker exec -i "$MONGO_CONTAINER" mongosh --quiet --norc --file /dev/stdin <<<"$js" 2>&1)"; then
    warn "Không đếm được user chưa migrate 005 (mongosh lỗi): bỏ qua kiểm tra này. Nếu backend mới crash-loop, xem UserRolesMigrationGuard ($DOC mục 5.4a)."
    return 0
  fi
  pending="$(grep -oE 'PENDING_USERS=[0-9]+' <<<"$out" | tail -n 1 | cut -d= -f2 || true)"
  if [[ -z "$pending" ]]; then
    warn "Không đọc được kết quả đếm user chưa migrate 005: bỏ qua kiểm tra này."
    return 0
  fi
  if (( pending > 0 )); then
    die "Còn $pending tài khoản chưa migrate 005 (roles[]/teamIds[]). Backend mới sẽ KHÔNG khởi động (UserRolesMigrationGuard). Chạy trước: bash scripts/run-migration.sh 005 (dry-run), rồi backup và bash scripts/run-migration.sh 005 --apply, sau đó chạy lại deploy (khuyến nghị 'bash deploy.sh --no-pull' nếu đã pull). Xem $DOC mục 5.4a."
  fi
  log "Không còn user chưa migrate 005."
}

# ── 4) logs/: backend chạy USER node (uid 1000) cần quyền ghi ────────────────
# docker-compose.yml chỉ bind-mount ./logs (không mount ./tmp; tmp nằm trong image), nên chỉ chuẩn bị logs/.
ensure_runtime_dirs() {
  mkdir -p "$LOGS_DIR"
  local need=0 stray
  [[ "$(stat -c '%u' "$LOGS_DIR")" == "1000" ]] || need=1
  stray="$(find "$LOGS_DIR" ! -uid 1000 -print -quit)"
  [[ -z "$stray" ]] || need=1
  (( need == 1 )) || return 0

  log "logs/ chưa thuộc uid 1000 (backend cần ghi); đang chown..."
  if [[ "$(id -u)" == "0" ]]; then
    chown -R 1000:1000 "$LOGS_DIR"
  elif chown -R 1000:1000 "$LOGS_DIR" 2>/dev/null; then
    :   # user hiện tại chính là uid 1000 (vd user đầu tiên trên Ubuntu): chown về chính mình thành công
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -n chown -R 1000:1000 "$LOGS_DIR"
  else
    die "Không chown được logs/ (không có sudo không mật khẩu). Chạy rồi chạy lại script:  sudo chown -R 1000:1000 \"$PWD/$LOGS_DIR\""
  fi
}

# ── 5) Backup Mongo (bắt buộc trước khi up) ──────────────────────────────────
# Phân loại DB `realestate` (CHỈ ĐỌC) để quyết định có cần backup không. In đúng một trong:
#   HAS_USERS            có collection `users` (kể cả rỗng): backup bắt buộc, mongodump luôn sinh prelude realestate.users
#   EMPTY                không có `users` VÀ không collection nào có document: không có gì để sao lưu
#   EMPTY_SYSTEM_ONLY    không có `users`; collection duy nhất có document là `system` (sổ phiên bản/migration do runner ghi ở 6b của một
#                        lần deploy đầu bị dở dang trước `up`): không có dữ liệu nghiệp vụ, sổ tái tạo được bằng reconcile. Một DB
#                        production cũ đã baseline cũng có `system`, nhưng khi đó `users`/collection nghiệp vụ có dữ liệu nên ra
#                        HAS_USERS/AMBIGUOUS, không rơi vào nhánh này
#   AMBIGUOUS:<tên...>   không có `users` nhưng collection khác (ngoài `system`) có dữ liệu: mơ hồ, caller phải dừng
# Trả 1 (không in gì) nếu không hỏi được Mongo: caller phải dừng (fail-closed).
classify_db() {
  local present busy
  present="$(existing_collections "$MONGO_CONTAINER" users)" || return 1
  if [[ -n "$present" ]]; then echo HAS_USERS; return 0; fi
  busy="$(nonempty_collections "$MONGO_CONTAINER")" || return 1
  case "$busy" in
    "") echo EMPTY ;;
    system) echo EMPTY_SYSTEM_ONLY ;;
    *) echo "AMBIGUOUS:${busy}" ;;
  esac
}

backup_mongo() {
  local state
  state="$(docker inspect -f '{{.State.Status}}' "$MONGO_CONTAINER" 2>/dev/null || true)"
  if [[ -z "$state" ]]; then
    warn "Chưa có container $MONGO_CONTAINER (triển khai mới?): bỏ qua mongodump vì không có container để dump (nếu volume Mongo cũ còn dữ liệu, migration cũng bị bỏ qua: xem migration_gate)."
    return 0
  fi
  [[ "$state" == "running" ]] || die "Container $MONGO_CONTAINER ở trạng thái '$state'. Khởi động nó trước (docker compose --env-file $ENV_FILE up -d mongo) để sao lưu được; không deploy khi không có backup."

  # Mongo cũ standalone (không xác thực) không có biến root: đó là việc của mục 5, không phải của deploy.sh.
  docker exec "$MONGO_CONTAINER" sh -c 'test -n "$MONGO_INITDB_ROOT_USERNAME" && test -n "$MONGO_INITDB_ROOT_PASSWORD"' \
    || die "Mongo đang chạy cấu hình cũ (không có user root/xác thực). deploy.sh KHÔNG dùng để nâng cấp standalone: làm theo $DOC mục 5."

  # DB `realestate` chưa có collection `users` (Mongo vừa dựng, backend chưa boot lần nào): mongodump vẫn mã 0 nhưng archive
  # KHÔNG có prelude `realestate.users` nên verify_backup_archive sẽ từ chối. Chỉ khi DB thật sự không có dữ liệu nghiệp vụ nào mới
  # bỏ qua backup; có `users` (kể cả rỗng) thì backup vẫn BẮT BUỘC như thường; mơ hồ thì dừng, không đoán.
  local db_class
  db_class="$(classify_db)" || die "Không hỏi được Mongo xem DB realestate có collection users/dữ liệu hay chưa (mongosh lỗi hoặc quá ${OPS_EXEC_TIMEOUT}s). Không deploy khi không biết có cần backup hay không: kiểm container $MONGO_CONTAINER rồi chạy lại."
  case "$db_class" in
    HAS_USERS) ;;
    EMPTY)
      warn "DB realestate trong $MONGO_CONTAINER chưa có dữ liệu (chưa có collection users, không collection nào có document): bỏ qua mongodump vì không có gì để sao lưu (backend chưa boot lần nào?)."
      DB_EMPTY_NO_BACKUP=1
      return 0
      ;;
    EMPTY_SYSTEM_ONLY)
      warn "DB realestate trong $MONGO_CONTAINER chưa có collection users; collection duy nhất có dữ liệu là \`system\` (sổ phiên bản/migration, thường do một lần deploy đầu bị dở dang). Không có dữ liệu nghiệp vụ cần sao lưu, sổ tái tạo được bằng reconcile: bỏ qua mongodump. (DB production cũ đã baseline sẽ có users/collection nghiệp vụ nên không rơi vào trường hợp này.)"
      DB_EMPTY_NO_BACKUP=1
      return 0
      ;;
    *)
      die "DB realestate chưa có collection users nhưng có collection có dữ liệu (${db_class#AMBIGUOUS:}). Không rõ đây là DB gì nên deploy.sh KHÔNG bỏ qua backup và cũng không tạo được backup hợp lệ (backup phải chứa realestate.users). Kiểm bằng mongosh ('show collections' trong DB realestate) và xử lý theo $DOC mục 6 trước; không deploy khi chưa hiểu tình trạng dữ liệu."
      ;;
  esac

  install -d -m 700 "$BACKUP_DIR"
  local out="${BACKUP_DIR}/deploy-pre-${TS}.archive.gz"
  local part="${out}.partial"
  log "mongodump DB realestate -> $out ..."
  # Mật khẩu: đọc từ biến môi trường BÊN TRONG container, đưa cho mongodump qua pipe `--config <(...)` (không có trên dòng
  # lệnh, không ghi ra đĩa). --archive không tên = ghi ra stdout, chuyển thẳng vào file quyền 600 trên host.
  # shellcheck disable=SC2016  # biến phải được mở rộng BÊN TRONG container, nên dùng nháy đơn có chủ ý
  local dump_cmd='mongodump --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --db realestate --archive --gzip'
  local dump_rc=0
  ( umask 077; timeout "$DUMP_TIMEOUT" docker exec "$MONGO_CONTAINER" bash -c "$dump_cmd" > "$part" ) || dump_rc=$?
  if (( dump_rc != 0 )); then
    rm -f "$part"
    if (( dump_rc == 124 )); then
      die "mongodump quá ${DUMP_TIMEOUT}s (Mongo quá tải/treo?). Tăng DUMP_TIMEOUT nếu DB lớn. Không deploy khi không có backup."
    fi
    die "mongodump thất bại (mã $dump_rc). Không deploy khi không có backup."
  fi
  # Kiểm cả nội dung (không chỉ định dạng): > 0 byte, gzip hợp lệ, mongorestore --dryRun thấy realestate.users.
  if ! verify_backup_archive "$part" "$MONGO_CONTAINER"; then
    rm -f "$part"
    die "Backup vừa tạo không đạt kiểm tra nội dung. Không deploy."
  fi
  mv "$part" "$out"
  BACKUP_FILE="$out"
  ls -l "$out"
  log "Backup OK (đã kiểm nội dung). Hãy chép nó ra NGOÀI máy chủ (scp/rclone); backup nằm cùng ổ đĩa không phải backup thật."
}

# ── 6) Gắn thẻ image backend đang chạy làm bản dự phòng ──────────────────────
tag_current_backend_image() {
  local image_id project
  image_id="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
  if [[ -z "$image_id" ]]; then
    log "Chưa có container $BACKEND_CONTAINER: không có image để dự phòng."
    return 0
  fi
  project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
  [[ -n "$project" ]] || project="$DEFAULT_PROJECT"
  PREV_IMAGE_REPO="${project}-backend"
  PREV_IMAGE_TAG="${PREV_IMAGE_REPO}:pre-${TS}"
  docker tag "$image_id" "$PREV_IMAGE_TAG"
  log "Đã gắn thẻ image backend hiện tại: $PREV_IMAGE_TAG"
}

# ── 6b) Build backend + migration theo version (PT-027) ──────────────────────
# Runner nằm TRONG image backend (dist/migrations/cli.js, không cần ts-node) nên chạy bằng `compose run --rm --no-deps
# backend`: dùng image vừa build, MONGODB_URI do compose dựng (mật khẩu không nằm trên dòng lệnh host), cùng network
# với mongo. `-T` tắt TTY để chạy được trong nohup/tmux. Mã thoát của runner: 0 ok | 1 lỗi hoặc từ chối | 3 đang có khóa |
# 4 cần xử lý tay (probe baseline không đạt, hoặc cần baseline ở chế độ --no-migrate) | 5 downgrade (version code < DB).
run_migration_cli() { compose run --rm --no-deps -T backend node dist/migrations/cli.js "$@"; }

# Lệnh runner viết sẵn để IN cho người dùng chạy tay (không chạy ở đây).
runner_cmd_hint() { printf 'docker compose --env-file %s run --rm --no-deps backend node dist/migrations/cli.js' "$ENV_FILE"; }

# Có volume dữ liệu Mongo của project compose hiện hành (`<project>_mongo_data`) không. Project: COMPOSE_PROJECT_NAME, rồi nhãn
# compose của container backend đang có, rồi tên mặc định. Dùng phân biệt "cài mới thật" với "container bị xóa nhưng dữ liệu còn".
mongo_volume_exists() {
  local project="${COMPOSE_PROJECT_NAME:-}"
  [[ -n "$project" ]] || project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
  [[ -n "$project" ]] || project="$DEFAULT_PROJECT"
  [[ -n "$(docker volume ls -q --filter "name=^${project}_mongo_data\$" 2>/dev/null || true)" ]]
}

# Build image backend MỚI (gắn GIT_COMMIT). Chưa đụng stack đang chạy: container cũ giữ image cũ theo ID; thẻ :latest
# bị ghi đè nhưng bản cũ đã gắn thẻ pre-<thời-gian> ở bước 6.
build_backend() {
  log "docker compose build backend (GIT_COMMIT=${GIT_COMMIT:-unknown}) ..."
  compose build backend
}

# Dừng deploy (die) kèm nguyên nhân và lệnh xử lý theo mã thoát của runner. Chỉ gọi khi runner BÁO LỖI mà chưa ghi gì
# (mã 3, 4, 5 từ dry-run hoặc từ --apply: theo hợp đồng runner các mã này không ghi gì) hoặc mã 1 ở dry-run.
reconcile_stop() {
  local rc="$1" cli
  cli="$(runner_cmd_hint)"
  case "$rc" in
    3)
      die "Runner migration báo đang có KHÓA (có runner khác đang chạy, hoặc tiến trình chết để lại khóa). Kiểm 'docker ps' không còn lệnh '... node dist/migrations/cli.js' nào đang chạy, rồi gỡ: $cli unlock . Sau đó chạy lại deploy. Stack chưa bị đổi."
      ;;
    4)
      {
        echo "Runner dừng (mã 4): DB đã có dữ liệu nhưng probe chỉ-đọc cho thấy một trong 002..006 CHƯA xong (hoặc không xác minh được),"
        echo "nên runner KHÔNG ghi gì và KHÔNG tự chạy lại migration cũ (002 và 006 có bước xóa). Output ở trên nêu id nào không đạt và số đếm."
        echo "Xử lý (làm tay, có backup ${BACKUP_FILE:-trước đó}, đọc dry-run trước):"
        echo "  005, 006:  bash scripts/run-migration.sh 005   rồi   bash scripts/run-migration.sh 006      # dry-run; thêm --apply để ghi"
        echo "  002, 003, 004:  bash scripts/run-migration.sh 002   (hoặc 003, 004)                                  # dry-run; thêm --apply để ghi"
        echo "  Probe 002 có TRẦN (1.000.000 doc mỗi collection hoặc 5 phút): vượt trần thì báo \"không xác minh được\" (mã 4), không phải dữ liệu hỏng."
        echo "    Khi đó chạy dry-run script 002 ở trên và đọc kết quả; nếu báo 0 việc cần làm thì ghi baseline tay (lối thoát bên dưới)."
        echo "Sau khi xử lý xong, chạy lại: bash deploy.sh --no-pull"
        echo "Lối thoát (chỉ khi ĐÃ tự kiểm 002..006 xong): $cli baseline --version <x.y.z> --commit <sha>   (dry-run; thêm --apply để ghi)"
        echo "  <x.y.z> là semver chuẩn, KHÔNG có số 0 đứng đầu (vd 1.0.3, không phải 1.0.03); sai định dạng thì runner thoát mã 2."
      } >&2
      die "Cần xử lý tay trước khi deploy. Stack chưa bị đổi."
      ;;
    5)
      {
        echo "Runner dừng (mã 5): version trong DB CAO HƠN version của code sắp deploy (downgrade). Thường do pull nhầm nhánh/commit cũ."
        echo "Runner không ghi gì (không migrate, không hạ version)."
        echo "Nếu đúng là muốn quay về bản cũ có chủ ý: DEPLOY_ALLOW_DOWNGRADE=1 bash deploy.sh --no-pull"
        echo "  (bỏ qua migrate, KHÔNG ghi/hạ version; code cũ có thể không đọc được dữ liệu đã migrate: đọc $DOC mục 11 trước)."
      } >&2
      die "Downgrade chưa được cho phép. Stack chưa bị đổi."
      ;;
    *)
      die "Runner migration lỗi hoặc từ chối (mã $rc; xem output ở trên: kết nối Mongo, sổ không liền mạch, version sai định dạng, image thiếu dist/migrations/cli.js, Mongo không phải replica set: runner từ chối ngay cả ở dry-run...). Stack chưa bị đổi (dry-run chỉ đọc)."
      ;;
  esac
}

# `reconcile` DRY-RUN (chỉ đọc, không khóa): in kế hoạch cho người dùng và dừng sớm khi runner báo mã khác 0, TRƯỚC khi
# đụng STACK_TOUCHED. Nhờ vậy mã 3/4/5/1 luôn kết thúc với "stack chưa đổi". Tham số thêm (vd --skip-version) chuyển nguyên
# cho runner. Downgrade (mã 5) kèm DEPLOY_ALLOW_DOWNGRADE=1: ghi DOWNGRADE_ACTIVE=1 rồi cho đi tiếp (không migrate, không ghi version).
reconcile_dry_run() {
  local rc=0
  run_migration_cli reconcile --by deploy "$@" || rc=$?
  case "$rc" in
    0) return 0 ;;
    5)
      if (( ALLOW_DOWNGRADE == 1 )); then
        warn "Downgrade CỐ Ý (DEPLOY_ALLOW_DOWNGRADE=1): version trong DB cao hơn version code. Bỏ qua migrate, KHÔNG ghi và KHÔNG hạ version. Dữ liệu đã migrate có thể không tương thích code cũ."
        DOWNGRADE_ACTIVE=1
        return 0
      fi
      reconcile_stop 5
      ;;
    *) reconcile_stop "$rc" ;;
  esac
}

# Chế độ mặc định (tự migrate): dry-run xem kế hoạch, rồi `reconcile --apply --skip-version` NGAY SAU backup (bước 5), TRƯỚC `up`.
# Version thường chưa ghi ở đây (code mới chưa chạy): bước 8b làm việc đó. Ngoại lệ DB mới tinh (version null, users rỗng): runner
# GHI version ngay ở bước này (kể cả --skip-version), nên 8b trên DB mới là no-op mã 0. STACK_TOUCHED=1 đặt ngay trước --apply; BACKUP_FILE rỗng
# thì không chạy --apply, trừ DB chưa có dữ liệu (bước 5 bỏ qua backup, kiểm lại ngay trước --apply). Mã 3/4/5 từ --apply: runner không ghi gì nên trả STACK_TOUCHED=0 trước khi dừng. Mã 1 từ --apply:
# có thể một migration đã chạy dở (dữ liệu đổi một phần) nên GIỮ STACK_TOUCHED=1 (in hướng dẫn "không quay code cũ").
auto_reconcile() {
  local cli rc=0
  cli="$(runner_cmd_hint)"
  log "Lập kế hoạch migration (runner reconcile, dry-run, chỉ đọc) ..."
  reconcile_dry_run --skip-version --phase pre-up
  MIGRATION_GATE_RAN=1
  if (( DOWNGRADE_ACTIVE == 1 )); then
    return 0
  fi

  if [[ -z "$BACKUP_FILE" ]]; then
    # Chỉ DB không có dữ liệu nghiệp vụ (bước 5 đã xác nhận: không users, không document nào ngoài `system`) được ghi mà không có
    # backup. Hỏi lại NGAY trước khi ghi (build mất vài phút: dữ liệu có thể đã xuất hiện); bất kỳ trạng thái nào khác là dừng,
    # giữ nguyên quy tắc "luôn backup trước khi ghi".
    local db_class="" recheck_rc=0
    (( DB_EMPTY_NO_BACKUP == 1 )) || die "Tự migrate cần backup Mongo vừa tạo ở bước 5 (BACKUP_FILE rỗng), mà bước 5 không xác nhận DB trống. Dừng, chưa ghi gì. Stack chưa bị đổi."
    db_class="$(classify_db)" || recheck_rc=$?
    (( recheck_rc == 0 )) || die "Không hỏi lại được Mongo ngay trước khi ghi (mongosh lỗi hoặc quá hạn): không ghi khi không có backup và không xác nhận được DB còn trống. Chạy lại: bash deploy.sh --no-pull. Dừng, chưa ghi gì. Stack chưa bị đổi."
    case "$db_class" in
      EMPTY|EMPTY_SYSTEM_ONLY) ;;
      *) die "DB realestate KHÔNG còn trống kể từ bước 5 (nay: $db_class), nhưng deploy này không có backup. Không ghi. Chạy lại để có backup mới: bash deploy.sh --no-pull. Dừng, chưa ghi gì. Stack chưa bị đổi." ;;
    esac
    log "DB realestate chưa có dữ liệu nghiệp vụ ($db_class; đã kiểm lại ngay trước khi ghi): ghi baseline/version không cần backup."
  fi
  # Từ đây dữ liệu/sổ có thể đổi: lỗi sau điểm này in hướng dẫn "không quay code cũ" (print_recovery).
  STACK_TOUCHED=1; manifest_set STACK_TOUCHED 1   # ghi NGAY (không chờ manifest_finish): bị SIGKILL/mất điện giữa chừng manifest vẫn đúng
  log "reconcile --apply --skip-version --phase pre-up (baseline nếu cần + migration pre-up chờ; backup: ${BACKUP_FILE:-không có, DB trống}) ..."
  run_migration_cli reconcile --apply --by deploy --skip-version --phase pre-up || rc=$?
  case "$rc" in
    0) ;;
    5)
      # Hiếm: dry-run vừa rồi không báo downgrade nhưng --apply thì có (DB đổi giữa hai lệnh). Runner không ghi gì.
      STACK_TOUCHED=0; manifest_set STACK_TOUCHED 0
      if (( ALLOW_DOWNGRADE == 1 )); then
        warn "Downgrade CỐ Ý (DEPLOY_ALLOW_DOWNGRADE=1): bỏ qua migrate, KHÔNG ghi và KHÔNG hạ version."
        DOWNGRADE_ACTIVE=1
        return 0
      fi
      reconcile_stop 5
      ;;
    3|4) STACK_TOUCHED=0; manifest_set STACK_TOUCHED 0; reconcile_stop "$rc" ;;
    *)
      die "reconcile --apply thất bại (mã $rc): runner đã dừng (không chạy migration sau, không ghi sổ cho migration lỗi, không tự rollback). Nếu migration chạy dở thì dữ liệu có thể đã đổi MỘT PHẦN; nếu runner từ chối trước khi ghi (không phải replica set, sổ không liền mạch) thì dữ liệu chưa đổi. Xem: $cli status . Sửa nguyên nhân rồi chạy lại; KHÔNG quay về code cũ."
      ;;
  esac
  log "Migration/baseline xong (version được ghi ở bước 8b sau khi backend sống; DB mới tinh thì runner đã ghi ngay ở bước này)."
}

# Chế độ --no-migrate (hành vi cũ): đọc `status --json` (chỉ đọc). Còn migration chờ hoặc cần baseline hoặc đang có khóa:
# DỪNG trước `up` (stack không đổi) và in lệnh. Không đọc được trạng thái: dừng (không đoán), vì deploy mù với migration
# là rủi ro lớn hơn một lần chạy lại. Không phát hiện downgrade ở chế độ này (chỉ bước 8b không bao giờ hạ version).
legacy_status_gate() {
  local cli out rc=0 json ids
  cli="$(runner_cmd_hint)"
  log "--no-migrate: kiểm tra migration chờ (runner: status, chỉ đọc) ..."
  out="$(run_migration_cli status --json 2>&1)" || rc=$?
  case "$rc" in
    0) ;;
    3)
      printf '%s\n' "$out" >&2
      die "Runner migration báo đang có KHÓA (có runner khác đang chạy, hoặc tiến trình chết để lại khóa). Chắc chắn không còn runner nào chạy rồi gỡ: $cli unlock . Stack chưa bị đổi."
      ;;
    4)
      printf '%s\n' "$out" >&2
      {
        echo "Collection \`system\` chưa có phiên bản nhưng DB đã có dữ liệu: cần baseline MỘT LẦN (ghi sổ 002..006 đã áp dụng, không chạy lại)."
        echo "  Cách A (khuyến nghị): bỏ --no-migrate: bash deploy.sh --no-pull   (probe chỉ-đọc rồi tự baseline nếu đạt; xem trước bằng --plan-only)"
        echo "  Cách B (tay, lối thoát; chỉ khi ĐÃ tự kiểm 002..006 xong):"
        echo "    Dry-run:  $cli baseline --version <x.y.z> --commit <sha>"
        echo "    Ghi thật: $cli baseline --apply --version <x.y.z> --commit <sha>"
        echo "Chi tiết: $DOC mục 11.1."
      } >&2
      die "Cần baseline. Stack chưa bị đổi."
      ;;
    *)
      printf '%s\n' "$out" >&2
      die "Không đọc được trạng thái migration (mã $rc; xem output ở trên: kết nối Mongo, image backend thiếu dist/migrations/cli.js?). Stack chưa bị đổi."
      ;;
  esac

  json="$(grep -m1 '^{' <<<"$out" || true)"
  if [[ -z "$json" ]]; then
    printf '%s\n' "$out" >&2
    die "Runner không trả JSON trạng thái. Stack chưa bị đổi."
  fi
  MIGRATION_GATE_RAN=1

  # JSON.stringify không có khoảng trắng: danh sách rỗng là đúng chuỗi "pending":[]
  if grep -q '"pending":\[\]' <<<"$json"; then
    log "Không có migration chờ."
    return 0
  fi
  ids="$(grep -oE '"pending":\[.*\]' <<<"$json" | grep -oE '"id":"[^"]+"' | cut -d'"' -f4 | paste -sd ' ' - || true)"
  warn "Có migration chờ: ${ids:-?}"
  {
    echo
    echo "════════════ DỪNG TRƯỚC KHI CẬP NHẬT: còn migration chờ (${ids:-?}) ════════════"
    echo "Đã backup: ${BACKUP_FILE:-không có}. Stack đang chạy CHƯA bị đổi (image backend mới đã build nhưng chưa chạy)."
    echo "Chọn một cách:"
    echo "  A) Tự động (bỏ --no-migrate):  bash deploy.sh --no-pull     (backup mới -> reconcile --apply -> up)"
    echo "  B) Bằng tay: $cli up            # dry-run, đọc kỹ"
    echo "               $cli up --apply --by cli       # mã 5 = downgrade (version DB cao hơn code): không ghi gì, xem mục 11.1"
    echo "               rồi: bash deploy.sh --no-pull --no-migrate"
    echo "Chi tiết: $DOC mục 11.1."
  } >&2
  exit 1
}

# Cổng migration của bước 6b. Mongo chưa có container (triển khai mới): bỏ qua. Container có mà chưa healthy: dừng.
# Sau đó rẽ nhánh: --plan-only (chỉ dry-run) | tự migrate (mặc định) | --no-migrate (hành vi cũ).
migration_gate() {
  local cli
  cli="$(runner_cmd_hint)"
  if ! mongo_is_healthy; then
    # Container Mongo ĐÃ TỒN TẠI mà không healthy (đang khởi động, mất primary...): không đoán, không deploy mù với
    # migration (backup_mongo đã bắt buộc nó đang chạy). Chỉ khi chưa có container (triển khai mới) mới bỏ qua.
    if docker inspect "$MONGO_CONTAINER" >/dev/null 2>&1; then
      die "Mongo ($MONGO_CONTAINER) đang chạy nhưng chưa healthy: không đọc được trạng thái migration. Chờ nó healthy (docker compose --env-file $ENV_FILE ps) rồi chạy lại. Stack chưa bị đổi."
    fi
    # Container có thể đã bị xóa (compose down/rm) mà volume vẫn giữ DỮ LIỆU THẬT: khi đó KHÔNG coi là DB trống (8a sẽ
    # chạy reconcile --apply không backup). Chỉ cài mới khi không có container VÀ không có volume Mongo của project.
    if mongo_volume_exists; then
      warn "Chưa có container $MONGO_CONTAINER NHƯNG đã có volume Mongo của project (dữ liệu có thể còn): KHÔNG coi là cài mới, bỏ qua migration và bước 8a (không chạy migration khi chưa backup). Khởi động Mongo rồi chạy lại deploy, hoặc xem: $cli status"
      return 0
    fi
    FRESH_INSTALL=1
    warn "Chưa có container $MONGO_CONTAINER và chưa có volume Mongo (triển khai mới, DB trống): bỏ qua migration trước \`up\`; sau khi stack lên và backend sống, bước 8a sẽ chạy reconcile --apply (007/008/009 + ghi version) trong CÙNG lần deploy này. Xem trạng thái: $cli status"
    return 0
  fi

  if (( PLAN_ONLY == 1 )); then
    log "--plan-only: lập kế hoạch migration (reconcile dry-run, chỉ đọc; không backup, không ghi, không up) ..."
    reconcile_dry_run
  elif (( AUTO_MIGRATE == 1 )); then
    auto_reconcile
  else
    legacy_status_gate
  fi
}

# Sau khi backend sống (bước 8b): `reconcile --apply --by deploy` ghi `version` (và `commit`) của app vào `system`. Migration đã
# xong ở bước 6b nên ở đây chỉ còn ghi version. KHÔNG làm deploy thất bại: lỗi chỉ cảnh báo (backend vẫn chạy bình thường).
# Downgrade có chủ ý: bỏ qua hẳn (không ghi, không hạ version). Ở chế độ --no-migrate, nếu DB có version cao hơn thì runner
# trả mã 5 và cũng không ghi gì: chỉ cảnh báo.
sync_system_version() {
  (( FRESH_INSTALL == 1 )) && return 0   # cài mới đã được fresh_install_reconcile (8a) xử lý, gồm cả ghi version
  (( MIGRATION_GATE_RAN == 1 )) || { log "Bỏ qua ghi phiên bản vào \`system\` (chưa đọc được trạng thái migration trước deploy)."; return 0; }
  if (( DOWNGRADE_ACTIVE == 1 )); then
    warn "Downgrade có chủ ý: KHÔNG ghi và KHÔNG hạ \`version\` trong \`system\` (DB giữ version cao hơn)."
    return 0
  fi
  mongo_is_healthy || return 0
  local rc=0
  run_migration_cli reconcile --apply --by deploy --phase pre-up || rc=$?
  if (( rc != 0 )); then
    warn "Không ghi được phiên bản vào collection \`system\` (mã $rc; backend vẫn chạy). Ghi lại sau: $(runner_cmd_hint) reconcile --apply --by cli"
  fi
}

# Bước 8a (T-19): CÀI MỚI (6b bỏ qua vì chưa có container Mongo, nên chưa chạy 007/008/009 và chưa ghi version). Sau `up` + liveness,
# chạy `reconcile --apply --by deploy` (không --skip-version): trên DB mới tinh runner chạy hết migration chờ và ghi `version`. DB trống
# nên không cần backup. Khác 8b: lỗi => `die` (deploy báo lỗi, exit khác 0), vì cài mới mà thiếu 009/version là trạng thái dở dang.
fresh_install_reconcile() {
  (( FRESH_INSTALL == 1 )) || return 0
  local rc=0
  log "Bước 8a (cài mới): reconcile --apply --by deploy (chạy 007/008/009 và ghi phiên bản trong cùng lần deploy) ..."
  run_migration_cli reconcile --apply --by deploy --phase pre-up || rc=$?
  if (( rc != 0 )); then
    die "Bước 8a (cài mới) reconcile --apply thất bại (mã $rc): backend vẫn chạy nhưng migration/phiên bản chưa đủ. Xem: $(runner_cmd_hint) status ; sửa nguyên nhân rồi chạy: $(runner_cmd_hint) reconcile --apply --by cli"
  fi
  log "Bước 8a xong: migration và phiên bản đã ghi."
}

# Điểm gọi hậu-migrate DÙNG CHUNG (T-03, FR-23; thay bước 8c cũ): sau `up` + liveness + 8a/8b, chạy lần lượt các tệp
# scripts/post-migrate/[0-9][0-9]-*.sh theo thứ tự tên (10-catalog-codes.sh = hành vi 8c cũ: bù mã danh mục; 20-customer-codes.sh = bù mã khách; 90-post-up-migrations.sh = migration pha post-up, 011; MỌI lần deploy).
# KHÔNG có logic bù mã trong deploy.sh (T-17: cả cổng chặn 010 của bước 90 nằm trong tệp bước). Hợp đồng mỗi tệp: nhận ENV_FILE, LOGS_DIR, TS, DOC, LOG_PREFIX qua môi trường, tự chạy lệnh trong
# container, tự ghi log `$LOGS_DIR/deploy-<tên>-<TS>.log` và tự in cảnh báo ĐỎ + thoát khác 0 khi lỗi. Tệp nào thoát khác 0 thì `die` kèm
# tên bước (on_exit in hướng dẫn lùi), các tệp sau KHÔNG chạy. Downgrade có chủ ý (DOWNGRADE_ACTIVE=1): bỏ qua TOÀN BỘ (image cũ không có
# các CLI này). Chạy bằng `bash <tệp>` nên không phụ thuộc bit thực thi (commit từ Windows có thể làm mất bit này).
run_post_migrate_steps() {
  if (( DOWNGRADE_ACTIVE == 1 )); then
    warn "Downgrade có chủ ý: bỏ qua toàn bộ bước hậu-migrate (scripts/post-migrate/)."
    return 0
  fi
  local dir="$ROOT_DIR/scripts/post-migrate" step name rc
  local -a steps=()
  for step in "$dir"/[0-9][0-9]-*.sh; do
    [[ -f "$step" ]] && steps+=("$step")
  done
  (( ${#steps[@]} > 0 )) || die "Không thấy tệp bước nào dạng [0-9][0-9]-*.sh trong $dir (checkout thiếu file?). Không bỏ qua im lặng việc bù mã sau migrate."
  for step in "${steps[@]}"; do
    name="$(basename "$step" .sh)"
    log "Hậu-migrate: bước $name ..."
    rc=0
    env ENV_FILE="$ENV_FILE" LOGS_DIR="$LOGS_DIR" TS="$TS" DOC="$DOC" LOG_PREFIX="$LOG_PREFIX" bash "$step" || rc=$?
    (( rc == 0 )) || die "Bước hậu-migrate '$name' thất bại (mã $rc): deploy báo LỖI, các bước sau không chạy. Xem log $LOGS_DIR/deploy-*-${TS}.log và $DOC mục 11."
  done
  log "Hậu-migrate xong (${#steps[@]} bước)."
}

# ── 7) Chờ healthy: wait_mongo_healthy / wait_backend_liveness nằm ở scripts/lib/ops-common.sh ──

# ── Chạy ─────────────────────────────────────────────────────────────────────
main() {
  local arg flag_migrate=0 flag_no_migrate=0
  for arg in "$@"; do
    case "$arg" in
      --no-pull) NO_PULL=1 ;;
      --migrate) flag_migrate=1 ;;
      --no-migrate) flag_no_migrate=1 ;;
      --plan-only) PLAN_ONLY=1 ;;
      -h|--help) trap - EXIT; usage; exit 0 ;;
      *) trap - EXIT; printf '[deploy] Tham số không hợp lệ: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
    esac
  done
  if (( flag_migrate == 1 && flag_no_migrate == 1 )); then
    trap - EXIT; echo "[deploy] --migrate và --no-migrate loại trừ nhau." >&2; exit 2
  fi
  # Cờ dòng lệnh thắng biến môi trường DEPLOY_AUTO_MIGRATE.
  if (( flag_no_migrate == 1 )); then AUTO_MIGRATE=0; fi
  if (( flag_migrate == 1 )); then AUTO_MIGRATE=1; fi
  # --plan-only luôn dùng `reconcile` dry-run (không có nhánh `status`): nói rõ để khỏi âm thầm bỏ qua cờ tắt tự migrate.
  if (( PLAN_ONLY == 1 && AUTO_MIGRATE == 0 )); then
    log "--plan-only đi kèm --no-migrate/DEPLOY_AUTO_MIGRATE=0: --plan-only thắng, vẫn chạy reconcile dry-run (chỉ đọc). Cờ tắt tự migrate chỉ áp dụng cho lần deploy thật sau đó."
  fi

  [[ "$AUTO_MIGRATE" =~ ^[01]$ ]]    || die "DEPLOY_AUTO_MIGRATE phải là 0 hoặc 1 (nhận '$AUTO_MIGRATE')."
  [[ "$ALLOW_DOWNGRADE" =~ ^[01]$ ]] || die "DEPLOY_ALLOW_DOWNGRADE phải là 0 hoặc 1 (nhận '$ALLOW_DOWNGRADE')."
  [[ "$MONGO_TIMEOUT" =~ ^[0-9]+$ ]]  || die "MONGO_TIMEOUT phải là số nguyên (giây)."
  [[ "$HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || die "HEALTH_TIMEOUT phải là số nguyên (giây)."
  [[ "$DUMP_TIMEOUT" =~ ^[0-9]+$ && "$OPS_EXEC_TIMEOUT" =~ ^[0-9]+$ ]] || die "DUMP_TIMEOUT/OPS_EXEC_TIMEOUT phải là số nguyên (giây)."

  # Luôn chạy tại thư mục gốc repo để đường dẫn tương đối ./logs ./backups luôn đúng.
  cd "$ROOT_DIR"
  [[ -f docker-compose.yml ]] || die "Không thấy docker-compose.yml: chạy script từ thư mục gốc repo."

  check_prereqs
  require_free_disk_gb "$DEPLOY_MIN_FREE_GB"
  acquire_lock
  git_update
  # Commit ngắn ghi vào dist/version.json của image (build arg GIT_COMMIT trong docker-compose.yml); phải export TRƯỚC mọi
  # lệnh compose build/run để cache khớp. Không có .git (--no-pull) thì để compose dùng `unknown`.
  export GIT_COMMIT="${NEW_COMMIT:-unknown}"
  check_compose
  check_users_migrated
  # --plan-only chỉ đọc: không chuẩn bị logs/ và KHÔNG backup (không có gì sẽ bị ghi). Vẫn gắn thẻ image đang chạy vì build
  # sau đó ghi đè :latest (đường lui "image dự phòng" của deploy thật sau này vẫn đúng).
  if (( PLAN_ONLY == 0 )); then
    ensure_runtime_dirs
    backup_mongo
  fi
  tag_current_backend_image
  manifest_record_deploy_state   # ghi nốt phần "trước deploy" vào manifest backup (file Mongo, DB version, image dự phòng)
  build_backend
  migration_gate

  if (( PLAN_ONLY == 1 )); then
    log "--plan-only xong: stack và dữ liệu KHÔNG đổi (chưa backup, chưa up). Image backend mới đã build (:latest); container đang chạy vẫn dùng image cũ."
    log "Nếu kế hoạch ở trên đúng ý, deploy thật: bash deploy.sh --no-pull"
    return 0
  fi

  STACK_TOUCHED=1; manifest_set STACK_TOUCHED 1   # ghi NGAY vào manifest (xem chú thích ở reconcile --apply)
  log "docker compose up -d --build ..."
  compose up -d --build

  wait_mongo_healthy
  wait_backend_liveness
  fresh_install_reconcile
  sync_system_version
  POST_UP_REACHED=1; manifest_set POST_UP_REACHED 1   # ghi NGAY vào manifest; từ đây bước 90 (migration 011 MỘT CHIỀU) có thể chạy: manifest ghi lại để restore.sh cảnh báo
  run_post_migrate_steps

  echo
  compose ps
  if [[ -n "$NINE_ROUTER_CONTAINER" && "$(inspect_field "$NINE_ROUTER_CONTAINER" '{{.State.Status}}')" != "running" ]]; then
    warn "Container $NINE_ROUTER_CONTAINER không chạy (AI qua 9Router sẽ lỗi). Xem: docker compose --env-file $ENV_FILE logs nine-router"
  fi
  log "Deploy xong (commit ${NEW_COMMIT:-?}). Image dự phòng: ${PREV_IMAGE_TAG:-không có}. Backup: ${BACKUP_FILE:-không có}."
}

# Bọc toàn bộ trong main + `exit`: bash đọc script theo từng đoạn, nên bắt buộc dừng ở đây để việc `git pull` thay
# đổi chính file này giữa chừng không làm bash đọc tiếp phần lệnh lạ.
main "$@"
exit 0
