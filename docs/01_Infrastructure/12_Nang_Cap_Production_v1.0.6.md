# 12 — Nâng cấp production lên v1.0.6 (từ v1.0.5, VPS kiểu cũ)

> **Phiên bản tài liệu:** v1.0.6

Chỉ nêu **phần riêng của production**. Bước chung dùng `06_Production_Deploy.md`: quy trình `release.sh build/send` (mục 0, 0.3), thứ tự `deploy.sh` (0.4, mục 11), `restore.sh` (0.5, 6.1), backup (mục 6), bảng khóa cũ/mới (0.6), dọn thẻ `pre-*` (6.3). Không ghi IP, tài khoản ssh hay giá trị bí mật (repo công khai). Chưa chạy lần nào trên production; mọi lệnh do Oniichan chạy.

## 1. Hiện trạng đã xác minh (Neptune, ssh chỉ đọc, 2026-11-19): nhánh B

| Mục | Hiện trạng |
|---|---|
| Phiên bản | v1.0.5, commit `15770ac` (mốc dùng để đối chiếu mã; image thật xác nhận ở Bước 0). Lên production **2026-11-13**: `system.version` cập nhật 02:21 giờ VN, manifest `deploy-pre-20261113-021647` ghi `DB_VERSION_BEFORE=1.0.3`, nên đi thẳng từ v1.0.3 lên v1.0.5 trong một lượt (gồm cả v1.0.4) |
| Kiểu triển khai | VPS **kiểu cũ**: `git pull`, compose không `name:`, có `env_file`; `.env.docker` + `.env` (file trạng thái cũ, bind-mount `/app/.env`); không có `release.env`, không có volume `backend_state` |
| Dữ liệu | volume `realestatemanager_*` đang mang dữ liệu thật; Mongo replica set `rs0` |
| Migration | **011 đã chạy** (sổ có 007..011); **012 chưa**. Lần nâng này chỉ thêm 012 (post-up) |
| Web Push | đã bật (`CRM_PUSH_ENABLED=true`, `VAPID_*` có trong `.env.docker`) |
| `.env.docker` | có `CRM_*`, `VAPID_*`, token tunnel Cloudflare, mật khẩu NineRouter |
| Đĩa | còn ~21G (đo 2026-11-19; đạt ngưỡng 10 GB tự đặt của tài liệu này, nghiêm hơn mặc định 5 GB của `deploy.sh:104`); **đo lại ngay trước deploy** |
| Backup cũ | manifest mới nhất (2026-11-13) là kiểu **v1** |

## 2. Bốn điểm riêng của production

**(a) Chuyển TẠI CHỖ trên volume đang có dữ liệu thật.** Compose mới ghim `name: realestatemanager` nên dùng đúng `realestatemanager_*`; guard Q-03 (`deploy.sh:470-514`) **không kích hoạt** vì `realestatemanager_mongo_data` đã có. Nếu Q-03 dừng deploy thì tên volume lệch: **DỪNG, hỏi Oniichan**. **TUYỆT ĐỐI KHÔNG đặt `DEPLOY_ALLOW_NEW_MONGO_VOLUME=1`** (cách C của Q-03: dựng DB **trống**). Staging bật cờ này ở T-40 vì cố ý dựng DB trống rồi nạp dump; production thì không.

**(b) `.env.docker` + env_file -> một `.env` theo `.env.example`.** Làm theo T-40 (doc 11, Lượt 17): sau khi sao lưu (mục 4), **đổi tên** thư mục cũ thành `<D>.old-<TS>` (giữ nguyên làm đường lùi, không xóa), `release.sh send --init` tạo thư mục mới, lập `.env` ở đó rồi `send` lại (doc 06 mục 0.3). Lý do giống T-40: bộ file cũ (compose, `.env.docker`, `.env`, `backups/`) còn nguyên, bộ cài không phải đoán trong cây `git`.

| Nhóm | Khóa | Việc |
|---|---|---|
| Chép đúng giá trị (không in, chép bằng pipe) | `MONGO_ROOT_*`, `MONGO_KEYFILE`, `REDIS_PASSWORD`, `S3_*`, `JWT_SECRET`, `COOKIE_SECRET`, `ADMIN_*`, `CRM_*` (nhất là `CRM_PII_ENCRYPTION_KEY`, `CRM_PII_KEY_VERSION`, `CRM_PII_ENCRYPTION_KEY_V<n>`: sai hay mất = không giải mã được dữ liệu cá nhân), `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT`, `CLOUDFLARE_TUNNEL_TOKEN`, `NINE_ROUTER_INITIAL_PASSWORD` | Push đang bật nên `ops/verify-env.sh:217-220` bắt buộc đủ ba khóa VAPID |
| Thêm mới (compose cũ tự ghép) | `MONGODB_URI`, `REDIS_URL` | Theo `.env.example` (dòng 37, 43); user/mật khẩu phải trùng `MONGO_ROOT_*`/`REDIS_PASSWORD`. Nếu `.env.docker` có `MONGO_APP_*` thì **dừng hỏi** (v1.0.6 chỉ kiểm khớp root) |
| Kiểm riêng (`ops/verify-env.sh`) | `FRONTEND_URL` (bắt buộc, dạng `https://host`, **không có `/` cuối**, dòng 241); `TRUSTED_PROXY_IP` (nếu có: MỘT IPv4 đơn, không CIDR, không `0.0.0.0`, dòng 258-265) | Chép từ `.env.docker`, rồi để `verify-env.sh` kiểm |
| Khóa `*_IMAGE` | `BACKEND_IMAGE`, `FRONTEND_IMAGE` | **Không chép** nếu `.env.docker` có ghim: v1.0.6 lấy image từ `release.env` (thẻ `current` do `deploy.sh` promote), ghim trong `.env` làm lệch bản vừa gửi |
| | `MINIO_IMAGE`, `MONGO_IMAGE`, `REDIS_IMAGE`, `NINE_ROUTER_IMAGE`, `CLOUDFLARED_IMAGE` | Chép nếu đang ghim (giữ đúng digest đang chạy, như T-40 ghim `NINE_ROUTER_IMAGE`); digest mẫu `<...>` bị `verify-env.sh` từ chối |
| Từ `.env` cũ (file trạng thái) | khóa ở mục "AI, crawl" (`ACTIVE_AI_PLATFORM`, `OPENROUTER_*`, `MUST1C_*`, `NINEROUTER_*`), `DAILY_CRAWLER_*` | v1.0.6 lưu chúng ở volume `backend_state` (mới, rỗng), `.env` chỉ là giá trị khởi tạo: không chép thì cấu hình AI và lịch cron về mặc định |
| Bỏ | `FEATURE_*`, `VITE_*` nếu có | Không còn khóa nào đọc `.env.docker` (bảng 0.6 doc 06) |

So bằng lệnh liệt kê **tên** khóa (Bước 0, mục 3): **hợp `.env.docker` + `.env` cũ** so với `.env.example` mới, cả hai chiều, nên nhóm AI/crawl không rơi mất. Lệnh chỉ là gợi ý; **cổng cuối là `bash ops/verify-env.sh .env`**, chạy đến khi sạch.

**(c) Điểm khôi phục.** Manifest v1 bị `restore.sh` **từ chối** (`restore.sh:192-194`). Điểm khôi phục dùng được **duy nhất** là `backups/deploy-pre-<TS>.*` do **chính lần deploy v1.0.6** tạo ra (manifest v2 ngay sau bước backup). Trước `send` chỉ có bản ngoài máy chủ (mục 4). Backup cũ chỉ dùng bằng `mongorestore` tay (doc 06 mục 6, khối restore, luôn `--nsInclude 'realestate.*'`).

**(d) Thẻ `pre-<TS>` khi image đang chạy mang thẻ `latest`.** `deploy.sh` gắn `<tên>:pre-<TS>` theo **IMAGE ID của container đang chạy** (`docker inspect -f '{{.Image}}'`, `deploy.sh:538-545`), không theo thẻ, nên `latest` hay thẻ nào cũng đúng bản v1.0.5. Bước promote (`555-561`) chỉ gắn thêm `current`; thẻ cũ không bị xóa. Thẻ mới mang tên repo theo `release.env` (`realestatemanager-backend|frontend`); image kiểu cũ do compose tự đặt `<project>-<service>` (compose v2: `realestatemanager-backend`, trùng; compose v1 dùng gạch dưới, lệch), nên **tin ID, không tin tên** (Bước 0 in `Config.Image` thật). Thẻ này chỉ có sau khi `deploy.sh` chạy qua bước 1f, nên trước đó giữ tay bằng khối ở mục 4.

## 3. Bước 0 (chỉ đọc; chạy ngay trước deploy)

```bash
D="$HOME/RealEstateManager"   # thư mục deploy cũ: đổi cho đúng thư mục thật
git -C "$D" log -1 --format='%h %cs'; git -C "$D" status --short | head     # kỳ vọng 15770ac; file sửa tay
# TRƯỚC deploy, GHI RA NGOÀI VPS (giấy/ghi chú) 2 giá trị Config.Image (backend, frontend; cột thứ hai của lệnh dưới): khối lùi mục 5 cần đúng tên này, vì sau khi v1.0.6 chạy thì Config.Image đã đổi.
docker inspect -f '{{.Name}} {{.Config.Image}} {{.Image}}' realestate_backend realestate_frontend
docker inspect -f '{{.Name}} {{.State.Health.Status}}' realestate_mongo realestate_backend realestate_frontend
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const d = db.getSiblingDB("realestate");
printjson(d.system.findOne({ _id: "version" }, { value: 1, commit: 1 }));       // kỳ vọng 1.0.5
print(d.system.find({ _id: /^migration:/ }).map(x => x._id).sort().join(" "));   // kỳ vọng tới 011, chưa có 012
print(d.customers.getIndexes().map(i => i.name + " unique=" + !!i.unique).join(" | "));   // phone_1 KHÔNG unique
print("appointments thiếu assigneeIds: " + d.appointments.countDocuments({ assigneeIds: { $exists: false } }));
EOF
df -h "$HOME" /var/lib/docker
# Tên khóa (không in giá trị): HỢP .env.docker + .env cũ so với mẫu mới, hai chiều. Chép .env.example của repo lên VPS thành ~/env.example.v106 trước.
( umask 077; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
  names() { grep -hoE '^[A-Za-z_][A-Za-z0-9_]*=' "$@" | tr -d = | sort -u; }
  names "$D/.env.docker" "$D/.env" > "$T/old"; names "$HOME/env.example.v106" > "$T/new"
  echo "--- mẫu mới có, cũ (.env.docker + .env) thiếu:"; comm -13 "$T/old" "$T/new"
  echo "--- cũ có, mẫu mới không có (bỏ FEATURE_*, VITE_*; chép nếu là cấu hình AI/crawl hoặc ghim *_IMAGE theo bảng 2b):"; comm -23 "$T/old" "$T/new"
  echo "--- khóa *_IMAGE đang ghim ở bản cũ (chỉ tên; .env.example để chúng dạng comment nên không hiện ở nhóm trên):"; names "$D/.env.docker" "$D/.env" | grep '_IMAGE$' )
```

Dừng và hỏi Oniichan nếu: `version` khác 1.0.5; sổ chưa có 011 hoặc đã có 012; `phone_1` còn `unique=true`; commit lệch `15770ac` hoặc có file sửa tay; đĩa dưới 10 GB (ngưỡng tự đặt, nghiêm hơn `DEPLOY_MIN_FREE_GB=5` mặc định của `deploy.sh:104`: script chỉ chặn ở 5 GB, nên tự kiểm ở đây; chạy `deploy.sh` trực tiếp trên VPS thì đặt `DEPLOY_MIN_FREE_GB=10`); container không `healthy`.

## 4. Sao lưu ngoài máy chủ (trước `send`)

1. Chạy khối "MongoDB" ở doc 06 mục 6 trên stack cũ (`mongodump` qua pipe), kiểm `gzip -t` và `--dryRun` thấy `realestate.users`; chép thêm `.env.docker`, `.env` (quyền 600; có khóa PII, VAPID, token) và volume `nine_router_data` (doc 06 mục 6), rồi đưa **ra ngoài VPS** (`scp`/`rclone`). Không có bản ngoài máy chủ thì không `send`.
2. Giữ chỗ image v1.0.5 bằng thẻ bền (deploy chưa gắn `pre-<TS>` ở thời điểm này):

```bash
for s in backend frontend; do
  docker tag "$(docker inspect -f '{{.Image}}' "realestate_$s")" "re-keep/$s:v105" || echo "LỖI $s"
done
```

3. **Không** `docker image prune`, `docker builder prune`, `docker system prune`; **không xóa** thẻ `pre-*` và `re-keep/*`. 10.75GB thu hồi được chỉ để biết; dọn chỉ khi Oniichan đồng ý bằng văn bản.

## 5. Rủi ro còn lại và đường lùi

**Đã diễn tập trên staging (doc 11, tài liệu nội bộ đang git-ignore, không có trên repo công khai):** T-40 (cutover, 2026-11-15, Lượt 17), T-41 (deploy + rollback bằng `restore.sh`, 2026-11-15, Vòng 2 đạt, dòng 98), T-62 (012, 2026-11-18, Oniichan nghiệm thu, dòng 114: backfill 3/3 lịch hẹn cũ, 2 index mới có sau khi BE mới lên, deploy lần hai không đổi dữ liệu). **Không bắt diễn tập lại.** Staging khác production ở các điểm sau, và đây là rủi ro còn lại:

1. Staging dựng volume **mới** rồi nạp dump (Q-03 bật cờ); production chuyển **tại chỗ**, không được bật cờ (2a).
2. Production dùng `.env.docker` + env_file và `.env` trạng thái cũ; bước `.env.docker` -> `.env` (2b) chưa chạy thật. Staging đi từ DB 1.0.3 (có 007-011), production từ 1.0.5 (ít migration hơn).
3. Rollback về **image v1.0.5** sau chuyển cấu trúc chưa thử; T-41 chạy trước 012 và Đợt 7.

**012 (đối chiếu T-62 và mã `migrations/versions/012_crm_appointment_assignee_ids.ts`):** pha `post-up`, chạy ở bước 90 ngay sau `up`; **không một chiều, không có `down`**; chỉ cộng thêm (điền `appointments.assigneeIds` từ `assigneeId`, tạo index `assigneeIds_1_startAt_1`), giữ nguyên `assigneeId` cũ tới v1.0.7; **idempotent**, chạy lại không đổi dữ liệu (T-62). Rủi ro thật: không có lệnh tự gỡ (không cần để lùi image, v1.0.5 không dùng trường này); `assigneeId` không hợp lệ bị bỏ qua và ghi log kèm `_id` để xử lý tay; v1.0.5 đọc đúng dữ liệu do v1.0.6 ghi **chưa kiểm chứng**. Số lịch hẹn production chưa đo (index tạo lâu hơn nếu lớn).

**Bằng chứng CRM_* hay FEATURE_CRM_* (commit `15770ac`, chỉ đọc mã, chưa chạy):** `feature-flag.service.ts` đọc `FEATURE_${flag}` (dòng 34); `crm-feature.guard.ts` trả 404 khi `FEATURE_CRM_ENABLED` tắt (dòng 8, 20-21); compose `15770ac` ánh xạ `FEATURE_CRM_ENABLED=${CRM_ENABLED:-false}` và `FEATURE_CRM_PUSH=${CRM_PUSH_ENABLED:-false}` (dòng 245-251). Compose v1.0.6 chỉ truyền `CRM_*` (dòng 278-280) và BE v1.0.6 đọc thẳng `CRM_*`. Suy ra: **image v1.0.5 dưới compose v1.0.6 thấy cờ CRM tắt: CRM trả 404, Push tắt.** FE v1.0.5 mang cờ build-time nên không bị.

**Đường lùi (Oniichan quyết, không ai tự chạy):**
- **Trước `up`** (deploy dừng từ bước 1 đến trước `reconcile --apply` ở 6b): container v1.0.5 còn chạy; `deploy.sh` tự trả `current` chỉ khi chưa `STACK_TOUCHED` (`deploy.sh:287-301`). Từ 6b trở đi `STACK_TOUCHED=1` (đặt trước `--apply` kể cả khi không còn migration chờ, `deploy.sh:835`) nên **không** tự trả: kiểm tay `current` so với container đang chạy. Sửa nguyên nhân rồi chạy lại.
- **Sau `up`, lùi image** (dữ liệu giữ nguyên, 012 chỉ cộng thêm nên không cần `$unset`). **Không** dùng `restore.sh` hay `docker tag ... current` dưới compose v1.0.6 (dính 404 ở trên). Dùng bộ file cũ, **chưa diễn tập**:

```bash
# CẢNH BÁO: KHÔNG `down -v`, không `-v` ở bất kỳ lệnh nào: volume realestatemanager_* mang dữ liệu thật.
NEW="$HOME/RealEstateManager"; OLD="$NEW.old-<TS>"       # <TS> = hậu tố lúc đổi tên ở 2b
( cd "$NEW" && docker compose down )                     # dừng stack v1.0.6; hai bộ compose cùng container_name realestate_* nên phải dừng trước
BE_OLD="<Config.Image backend đã ghi ở Bước 0>"; FE_OLD="<Config.Image frontend đã ghi ở Bước 0>"   # điền sẵn từ ghi chú ngoài VPS; KHÔNG đọc lại từ container đang chạy (đã là v1.0.6)
docker tag re-keep/backend:v105  "$BE_OLD"    # compose cũ dùng build:, tên thường là <project>-backend:latest, nhưng lấy theo Bước 0
docker tag re-keep/frontend:v105 "$FE_OLD"
( cd "$OLD" && docker compose -p realestatemanager --env-file .env.docker up -d --no-build )   # --no-build: thiếu thì tên lệch sẽ build lại từ mã, không còn là image v1.0.5 đã giữ
```

  `-p realestatemanager` là bắt buộc (thư mục đã đổi tên; thiếu thì compose tạo project mới và volume rỗng). Cấu hình AI/cron đổi trong lúc chạy v1.0.6 nằm ở `backend_state`, không về lại `.env` cũ.
- **Lùi DB** (mất dữ liệu sau thời điểm dump): `restore.sh --manifest backups/deploy-pre-<TS>.manifest` (dry-run trước, `--apply --yes` sau); nó dựng `pre-<TS>` dưới compose v1.0.6 nên vẫn dính lỗi 404, rồi phải chuyển sang bộ file cũ như trên. Hoặc `mongorestore` tay từ bản mục 4.

**Đã xác nhận bằng mã (chưa chạy trên production):** `deploy.sh:835` đặt `STACK_TOUCHED=1` vô điều kiện trước `reconcile --apply`, kể cả khi không còn migration chờ; `scripts/post-migrate/90-post-up-migrations.sh` gọi `reconcile --apply --by deploy --skip-version --phase post-up` và runner chỉ chọn migration chưa có trong sổ (`selectPendingMigrations`), nên bỏ qua 011; 011 là post-up một chiều (đã chạy từ trước), 012 chỉ cộng thêm và idempotent.

**Chưa kiểm chứng:** đổi tên thư mục đang chạy rồi `up` có nhận lại container `realestate_*` hay báo trùng tên; đường lùi bằng bộ file cũ (khối ở trên); image production đúng `15770ac`.

**Trạng thái:** Draft (chưa chạy trên production) · 2026-11-19
