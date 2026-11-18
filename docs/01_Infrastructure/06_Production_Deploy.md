# 06 — Triển khai production (Docker Compose)

> **Phiên bản tài liệu:** v1.0.6 (2026-11-14)

Stack production nằm ở `docker-compose.yml` (thư mục gốc repo). Từ v1.0.6 **VPS không build và không dùng git**: image dựng MỘT lần ở máy build (máy dev; runner CI là kế hoạch v1.0.7, chưa có) bằng `release.sh build`, được gửi lên VPS bằng `release.sh send` (gói script + `docker save | ssh | docker load`), rồi `deploy.sh` chạy trên VPS bằng đúng image đã nạp. Tài liệu này mô tả quy trình đó (mục 0), kiến trúc stack, biến môi trường, sao lưu/khôi phục và xử lý sự cố. Các mục đánh dấu **lịch sử** (5, 11.2, 11.4 đến 11.7 và một số ví dụ rải rác) mô tả cách làm trước v1.0.6 (VPS tự `git pull` và build) và chỉ giữ để tham khảo; khi lệch với mục 0, 6, 11 và 11.8 thì theo các mục đó.

> **Ghi chú đầu tài liệu (v1.0.6, FR-22):**
> - **Compose gốc (`docker-compose.yml`)**: `backend` và `frontend` dùng image dựng sẵn `realestatemanager-backend:current` và `realestatemanager-frontend:current` (ghi đè bằng `BACKEND_IMAGE`/`FRONTEND_IMAGE` trong `.env` khi muốn ghim một tag khác); **không có `build:`**, backend **không có `env_file`** và không bind-mount `.env` (danh sách khóa env của backend nằm tường minh trong compose). Trạng thái bền của backend nằm ở volume `backend_state` (mount `/app/state`). Mọi biến nằm trong MỘT file `.env` ở gốc repo, lập từ MỘT mẫu duy nhất `.env.example` (cùng danh sách khóa ở dev, staging và production; chỉ khác giá trị; `.env` không commit, quyền 600). Compose tự đọc `.env` ở thư mục gốc nên lệnh chỉ là `docker compose <lệnh>`: **không còn `--env-file .env.docker`**. `ops/verify-env.sh` kiểm `.env` (chỉ in tên khóa, không in giá trị); `deploy.sh` gọi nó trước khi làm bất cứ việc gì.
> - **Cấu hình frontend lúc chạy**: Admin App đọc cấu hình runtime từ `/env.js` do entrypoint nginx sinh từ biến môi trường của container; không còn build arg `VITE_*` nhúng lúc build, nên đổi cờ (ví dụ `CRM_ENABLED`) chỉ cần tạo lại container `frontend`, không dựng lại image. Template nginx dùng `envsubst` (`BACKEND_UPSTREAM`, `TRUSTED_PROXY_IP`, `CLIENT_MAX_BODY`); có route `/healthz`.
> - **Dev**: dùng đúng stack production qua `docker-compose.yml` + `docker-compose.dev.yml` (override mỏng, chỉ publish thêm cổng loopback `DEV_MONGO_PORT`, `DEV_REDIS_PORT`, `DEV_MINIO_CONSOLE_PORT`), tùy chọn thêm `docker-compose.dev-watch.yml` (stage `dev` của Dockerfile backend, tag `realestatemanager-backend:dev-watch`, backend tự biên dịch lại khi sửa `src/`). Lệnh mẫu ở `README.md` gốc mục 3. Hạ tầng dev CŨ `RealEstateBackendApp/docker-compose.dev.yml` (project `realestate-dev`) là hệ riêng, không bị ảnh hưởng.
> - **Staging local (`ops/staging.sh`, `docker-compose.staging.yml`, `.env.staging.example`)**: **không còn dùng được với `deploy.sh` v1.0.6** (wrapper vẫn thêm cờ `--no-pull` mà `deploy.sh` mới từ chối với mã 2, và `deploy.sh` không còn build). Mục 11.3 chỉ còn là ghi chú lịch sử; staging thật chạy trên VPS staging bằng đúng quy trình mục 0 (chạy tay `release.sh send`). Các file staging local **tạm giữ nguyên ở v1.0.6**; việc gỡ chúng (T-46) chuyển sang v1.0.7 cùng CI/CD.
> - **CI/CD (GitHub Actions)**: **không thuộc v1.0.6** (Oniichan quyết 2026-11-16, chuyển sang v1.0.7). Hiện **không có** CI, CD, runner staging hay quét bảo mật tự động nào trong repo (không có `.github/workflows/`); quy trình hiện hành duy nhất là `release.sh build` → `release.sh send` → `deploy.sh` chạy tay (mục 0). Mục 17 chỉ là **kế hoạch v1.0.7, chưa triển khai**.

> Trạng thái kiểm chứng (tích lũy đến v1.0.5; mô tả cách làm cũ, khi lệch với mục 0 thì theo mục 0):
> - **Đã chạy thật** (máy dev, project tạm, mật khẩu giả): Mongo/Redis/MinIO/minio-init; nâng cấp tại chỗ từ standalone; mongodump/mongorestore; `mc mirror`; ký URL bằng host công khai. QA đã dựng và chạy **backend thật** trên stack này: readiness 200 (database/redis/storage up), đăng nhập, tạo khách hàng có transaction, idempotency, upload ảnh + presigned URL (Host khớp trả 200, Host sai trả 403), dữ liệu còn sau restart và `down`/`up`. Với `NODE_ENV=production` đã chạy thật lại: backend khởi động, readiness 200, đăng nhập admin OK, `Set-Cookie` refresh có `Secure`, thiếu `ADMIN_*` trên DB trống thì backend thoát với lỗi rõ ràng.
> - **Đã thử thật (PT-030, nginx cô lập, `dist` giả)**: header cache/MIME/404 của PWA trong `RealEstateAdminApp/nginx.conf` và `nginx -t` (mục 14.2); header bảo mật (mục 14.5). Chưa thử với bản build frontend thật hay Cloudflare thật (mục 14.4).
> - **Chưa kiểm chứng**: frontend nginx (trong stack compose đầy đủ, ngoài phép thử cô lập ở trên); cloudflared và Tunnel thật; đường lui 5.8 và khôi phục từ tar volume; hành vi trên server Linux thật (đặc biệt quyền ghi `./logs`, xem mục 4); đăng nhập qua HTTPS thật phía sau nginx + Cloudflare.
> - **Mới thêm, chưa chạy trên server thật**: service `nine-router` (9Router) trong compose, `scripts/run-migration.sh`, `ops/check-disk.sh`, `deploy.sh` (mục 11) và thư viện `ops/lib/ops-common.sh`. **Đã thử thật ở máy dev** (qa-agent và devops-agent): `docker compose config` (kể cả thiếu từng biến bắt buộc); `docker build --target builder` rồi `bash scripts/run-migration.sh` 005 (3 user) và 006 (xóa 3 area, tạo 34 tỉnh) trên Mongo replica set có xác thực tạm; mô phỏng nâng cấp 5.1-5.5 trên volume mẫu; `git_update` của `deploy.sh` trong repo tạm; `deploy.sh` trong container Linux cô lập (Mongo thật, `docker` giả: mongodump, `mongorestore --dryRun`, đếm user chưa migrate 005, cổng dung lượng đĩa, chặn backup rác/rỗng/DB khác); logic chặn của khối 5.8.3. **Vẫn chưa thử**: `compose up` toàn stack, build frontend, stage `production` của backend, `deploy.sh` nguyên vẹn với Docker thật, rollback 5.8 bằng `up` thật, 5.0a trên container thật của VPS, `sudo -n chown`, và môi trường bash 5.2/Docker 29 của VPS.

## 0. Quy trình phát hành v1.0.6 (đọc trước)

Nguyên tắc **build một lần, chạy mọi nơi**: cùng một cặp image (backend + frontend) đi từ máy build qua staging tới production; VPS không có mã nguồn, không `git pull`, không `docker build`. Không dùng registry (không đăng nhập, không đẩy image lên mạng).

| Thành phần | Chạy ở | Việc |
|---|---|---|
| `./release.sh build` | máy build (máy dev; runner CI là kế hoạch v1.0.7) | dựng 2 image, ghi `release.env`, đóng gói `release.tgz` |
| `./release.sh send --to <ssh-host>` | máy build | gửi gói + image lên VPS rồi gọi `deploy.sh` |
| `ops/install-release.sh` | VPS (do `send` gọi, lấy từ chính gói) | kiểm sha256 + danh sách gói, hoán đổi các mục whitelist vào thư mục deploy; không bao giờ chạm `.env`, `backups/`, `logs/` |
| `deploy.sh` | VPS, thư mục deploy | backup, gắn thẻ, promote, migrate, `up`, kiểm sức khỏe, hậu-migrate |
| `backup.sh`, `restore.sh` | VPS, thư mục deploy | backup tay; khôi phục về bản trước một lần deploy |

**Thẻ image** (tên `realestatemanager-backend`, `realestatemanager-frontend`):

| Thẻ | Ai đặt | Ý nghĩa |
|---|---|---|
| `<version>-<commit 7 ký tự>` (ví dụ `1.0.6-ab12cd3`) | `release.sh build` | bất biến, định danh bản phát hành; `release.env` ghi thẻ và ID |
| `current` | `deploy.sh` (promote); `restore.sh` (đặt lại về bản cũ); `release.sh build` ở máy dev (trừ `--no-current`; script cũng bỏ qua khi chạy trong CI, chuẩn bị cho v1.0.7, hiện chưa có CI) | thẻ **di động** mà compose đọc mặc định; trỏ tới bản đang (hoặc sắp) chạy |
| `pre-<TS>` | `deploy.sh`, `backup.sh` | bản **đang chạy ngay trước** lần deploy/backup đó (đường lùi), `<TS>` = `YYYYMMDD-HHMMSS` |
| `pre-restore-<RTS>` | `restore.sh` | bản đang chạy ngay trước lần restore (để quay lại nếu restore sai) |
| `dev-watch` | `docker-compose.dev-watch.yml` | chỉ dev, không dính tới `current` |

### 0.1. Build: `release.sh build`

```bash
./release.sh build               # bản phát hành: cây git sạch, nhánh đã push
./release.sh build --local       # thử trên máy mình: thẻ <version>-local; `send` từ chối bản này
./release.sh build --no-current  # không đặt thẻ current cục bộ
```

Làm lần lượt, dừng ở lỗi đầu tiên: (1) đọc version ở `RealEstateBackendApp/package.json` và khẳng định `RealEstateAdminApp/package.json` cùng version; (2) từ chối cây git bẩn (kể cả file chưa theo dõi) và nhánh chưa push (khi `CI=true` hoặc `GITHUB_ACTIONS=true`, bỏ qua kiểm "chưa push" nhưng vẫn từ chối cây bẩn; nhánh này chuẩn bị cho CI ở v1.0.7, hiện chưa có pipeline nào đặt các biến đó); (3) dựng hai image (`--target production`, `--build-arg GIT_COMMIT`) với thẻ bất biến `<version>-<commit 7 ký tự>`; (4) ghi `release.env` (không bí mật: version, commit, tên/thẻ/ID hai image); (5) sinh `release.tgz` + `release.tgz.sha256` chỉ gồm whitelist `docker-compose.yml deploy.sh backup.sh restore.sh release.env ops/ scripts/` (lấy bằng `git ls-files`: `.env`, `backups/`, `logs/` không bao giờ lọt vào gói; có thêm chốt chặn đường dẫn trông như bí mật/dump); (6) đặt thẻ `current` cục bộ cho cả hai image, trừ khi có `--no-current` hoặc đang chạy trong CI (dành cho v1.0.7: runner CI dùng chung Docker daemon với stack đang chạy, mà compose đọc `current`, nên trong CI chỉ `deploy.sh` được promote `current`; ở v1.0.6 chưa có CI nên nhánh này chưa dùng tới). Mỗi lần `build` xóa ba file đầu ra của lần trước. Đầu ra (`release.env`, `release.tgz`, `release.tgz.sha256`) nằm ở gốc repo và đều nằm trong `.gitignore`.

### 0.2. Gửi: `release.sh send` (và chuyển image bằng `docker save | ssh | docker load`)

```bash
./release.sh send --to <ssh-host> --dry-run                    # chỉ kiểm cục bộ, in kế hoạch bốn bước
./release.sh send --to <ssh-host> --init                       # LẦN ĐẦU: tạo thư mục deploy trên VPS
./release.sh send --to <ssh-host> [--dir <thư-mục-deploy>]     # các lần sau; --dir mặc định RealEstateManager (tương đối HOME của tài khoản ssh)
```

Bốn bước, dừng ở lỗi đầu tiên và **không tự rollback** (hoàn tác sau `up` là việc của `restore.sh`):

0. **Kiểm cục bộ** (chỉ đọc, chưa chạm mạng): từ chối bản `-local`/`-dirty`; có đủ `release.env`, `release.tgz`, `.sha256`; `sha256sum -c` khớp; `release.env` trong gói trùng `release.env` cạnh gói; hai thẻ image có trên máy này và ID khớp `release.env`.
1. **Gửi gói và cài**: tạo thư mục tạm quyền 700 trên VPS, `scp` gói + `.sha256` vào đó, kiểm sha256 phía VPS, rồi chạy `ops/install-release.sh --dir <thư-mục-deploy>` lấy **từ chính gói** (nên lần cài đầu không cần có sẵn bộ cài trên VPS và luôn dùng bộ cài mới nhất). Bộ cài tự kiểm lại sha256 và danh sách gói, hoán đổi từng mục whitelist có nhật ký (lỗi giữa chừng thì tự hoàn tác), không chạm `.env`/`backups/`/`logs/`. Thư mục tạm luôn bị xóa, kể cả khi lỗi.
2. **Kiểm đĩa**: `bash ops/check-disk.sh` trên VPS (bản vừa cài).
3. **Chuyển image**: `docker save <BE> <FE> | gzip | ssh <host> 'bash -c "set -o pipefail; gunzip -c | docker load"'` (không registry; mã thoát từng khâu trong pipe được kiểm nên `docker save`/`gzip` hỏng giữa chừng không bị ssh che mất). Sau khi nạp, kiểm hai thẻ có trên VPS; ID lệch chỉ cảnh báo (dưới containerd, ID là digest manifest, nên cổng cứng để `DEPLOY_ENFORCE_IMAGE_ID=1`, mặc định tắt).
4. **Deploy**: `./deploy.sh` trên VPS (tự khóa, backup, migrate, `up`, kiểm sức khỏe; mục 11). Chạy qua ssh không tương tác nên `deploy.sh` không hỏi đáp.

Tùy chọn ssh thêm: biến `RELEASE_SSH_OPTS` (ví dụ `-o Port=2222`; mặc định `BatchMode=yes`, `ConnectTimeout=15`, `ServerAliveInterval=30`). **Chỉ đặt từ nguồn tin cậy** vì nó được đưa nguyên cho `ssh`/`scp` (`-o ProxyCommand=...` chạy lệnh tùy ý). Lần ssh đầu tới VPS mới: `BatchMode` nên host chưa có trong `known_hosts` bị từ chối; chạy `ssh-keyscan -H <host> >> ~/.ssh/known_hosts` rồi **đối chiếu fingerprint** với nguồn tin cậy.

Chuyển image bằng tay (khi không dùng `send`, ví dụ lỗi giữa bước 3): chạy lại đúng lệnh `docker save ... | gzip | ssh ... docker load` ở bước 3 (đồng nhất và chạy lại được), rồi `ssh <host> 'cd <thư-mục-deploy> && ./deploy.sh'`. Gói script (bước 1) chỉ cài một lần cho mỗi bản phát hành; chạy lại `send` với cùng gói cho cùng kết quả (idempotent).

### 0.3. Lần cài đầu trên VPS mới

1. Máy build: `./release.sh build`, `./release.sh send --to <ssh-host> --init --dry-run`, rồi bỏ `--dry-run` (tạo thư mục deploy, cài gói, nạp image, nhưng `deploy.sh` sẽ dừng ở bước kiểm `.env` vì chưa có `.env`).
2. Trên VPS, trong thư mục deploy: `cp` mẫu `.env.example` thành `.env` (mẫu không nằm trong gói; chép từ repo hoặc dán tay), điền giá trị thật theo mục 2, `chmod 600 .env`, rồi `bash ops/verify-env.sh` cho tới khi hợp lệ.
3. `mkdir -p logs && chown 1000:1000 logs` (backend chạy uid 1000), rồi chạy lại `./release.sh send --to <ssh-host>` (hoặc `bash deploy.sh` trên VPS khi image đã nạp).

Nâng cấp tại chỗ từ Mongo standalone cũ vẫn làm theo mục 5 (lịch sử); không dùng `deploy.sh` cho lần đó.

### 0.4. Thứ tự của `deploy.sh` (tóm tắt, chi tiết ở mục 11)

Kiểm đĩa, đọc `release.env`, kiểm hai image đã nạp (thẻ `<version>-<commit>`; ID lệch: cảnh báo, hoặc lỗi khi `DEPLOY_ENFORCE_IMAGE_ID=1`), `ops/verify-env.sh .env`, khóa `.deploy.lock` (`flock`), `docker compose config -q`, kiểm volume Mongo (Q-03), kiểm không còn user chưa migrate 005, chuẩn bị `logs/`, `mongodump` ra `./backups` + sao `.env`, ghi manifest v2, gắn thẻ `pre-<TS>` cho hai image đang chạy, **promote** `<version>-<commit>` thành `current`, runner migration `reconcile` (dry-run rồi `--apply --skip-version --phase pre-up`), `up -d --no-build`, chờ Mongo healthy và backend liveness, ghi phiên bản vào collection `system`, hậu-migrate 10/20/90 (90 = migration 011 **một chiều**).

Cờ của `deploy.sh` chỉ còn `--no-migrate`, `--migrate` (bí danh của chế độ mặc định), `--plan-only` và `--help`; tham số lạ (kể cả `--no-pull` cũ) thoát mã 2. Lỗi **sau promote nhưng trước `up`** (stack chưa đổi): `deploy.sh` tự trả thẻ `current` về image cũ (`pre-<TS>`), ghi `PROMOTE_REVERT` (`reverted`, `failed` hoặc `none`) vào manifest. Lỗi **sau `up`**: **không tự rollback**; script in lệnh `bash restore.sh --manifest backups/deploy-pre-<TS>.manifest`.

### 0.5. Khôi phục (rollback): `restore.sh`

```bash
bash restore.sh --list                                              # liệt kê manifest (chỉ đọc)
bash restore.sh --latest                                            # DRY-RUN mặc định: kiểm + in kế hoạch, không đổi gì
bash restore.sh --manifest backups/deploy-pre-<TS>.manifest         # dry-run một bản cụ thể
bash restore.sh --manifest backups/deploy-pre-<TS>.manifest --apply --yes   # THỰC SỰ khôi phục
```

Khôi phục = nạp lại DB từ `deploy-pre-<TS>.archive.gz` **và** gắn lại `pre-<TS>` thành `current` cho cả hai image, rồi `up -d --no-build`. Trước khi đổi gì, `restore.sh` dừng backend và tạo **bản an toàn của trạng thái hiện tại**: dump `backups/restore-safety-<RTS>.archive.gz` và thẻ image `pre-restore-<RTS>`. Chi tiết và biến thể ở mục 6.1; cấu trúc manifest ở mục 11.8.

### 0.6. Bảng cờ cũ sang mới (v1.0.5 sang v1.0.6)

| Cũ (trước v1.0.6) | v1.0.6 |
|---|---|
| `bash deploy.sh` tự `git pull --ff-only` rồi build trên VPS | `./release.sh send --to <host>` (build ở máy build, VPS chỉ nạp image); `deploy.sh` không build, không dùng git |
| `deploy.sh --no-pull` | **bỏ** (không còn pull); thoát mã 2 |
| `ops/staging.sh deploy --pull` | bỏ cùng staging local (gỡ ở v1.0.7, T-46; tạm giữ ở v1.0.6 nhưng không còn dùng được) |
| `restore.sh --code-only` | **bỏ** (không còn khôi phục code bằng git; code = image) |
| `restore.sh --use-image-tag` | **thành mặc định** (gắn `pre-<TS>` thành `current`); cờ bị từ chối |
| `restore.sh --allow-infra-change` | **bỏ** (không còn `git reset` đổi file hạ tầng) |
| `backup.sh --code-only` | **bỏ** (không còn bundle/thẻ git) |
| `--migrate`, `--no-migrate`, `--plan-only` | **giữ** nguyên nghĩa |
| `restore.sh --db-only`, `--skip-safety-db`, `--apply --yes` | **giữ** |
| `backup.sh --db-only`, `--no-image` | **giữ** (`--db-only` không có manifest) |
| `.env.docker`, `.env.docker.example` | **`.env`, `.env.example`** (một file, một mẫu) |
| `docker compose --env-file .env.docker <lệnh>` | `docker compose <lệnh>` |
| `.env.staging.example`, `.staging/env` (staging local) | `.env` trên VPS staging (cùng mẫu `.env.example`) |
| `docker-compose.staging.yml`, `ops/staging.sh` | gỡ ở v1.0.7 (T-46); tạm giữ ở v1.0.6 nhưng không còn dùng được (staging chạy trên VPS bằng quy trình mục 0) |
| backend bind-mount `./.env`, `touch .env` | bỏ; compose liệt kê khóa tường minh, trạng thái bền ở volume `backend_state` |
| `docker compose up -d --build` | `docker compose up -d` (không build; build = `release.sh build`) |
| thẻ git `pre-deploy-<TS>`, `deploy-code-pre-<TS>.bundle` | **bỏ**; thẻ image `pre-<TS>` |
| manifest v1 (`OLD_COMMIT`, `CODE_BUNDLE`, `NO_PULL`...) | manifest v2 (mục 11.8); `restore.sh` từ chối manifest v1 kèm hướng dẫn |
| build arg `VITE_*` nhúng lúc build | cấu hình runtime `/env.js` |
| Ghi chú đường dẫn cũ: `backup.sh`/`restore.sh`/`lib` từng nằm dưới thư mục `scripts` | gốc repo (`backup.sh`, `restore.sh`) và `ops/` (`ops/lib/`, `ops/tests/`, `ops/check-disk.sh`, `ops/print-image-digests.sh`) |


## 1. Kiến trúc stack

| Service | Container | Image | Dữ liệu (named volume) | Cổng ra host | Ghi chú |
|---|---|---|---|---|---|
| `mongo` | `realestate_mongo` | `${MONGO_IMAGE}` (mặc định `mongo:7`) | `mongo_data:/data/db` | không | Replica set `rs0` 1 node, xác thực + keyFile |
| `redis` | `realestate_redis` | `${REDIS_IMAGE}` (mặc định `redis:7-alpine`) | `redis_data:/data` | không | AOF `everysec`, `noeviction`, `requirepass` |
| `minio` | `realestate_minio` | `${MINIO_IMAGE}` (mặc định `cgr.dev/chainguard/minio:latest`) | `minio_data:/data` | không | S3 nội bộ `http://minio:9000` |
| `minio-init` | `realestate_minio_init` | như `minio` | không | không | Chạy 1 lần, tạo 2 bucket riêng tư + hạn 7 ngày cho `crm-exports` |
| `nine-router` | `realestate_9router` | `${NINE_ROUTER_IMAGE}` (mặc định `decolua/9router:latest`) | `nine_router_data:/app/data` | `127.0.0.1:20128` (mặc định, đổi bằng `NINE_ROUTER_BIND_ADDR`) | 9Router, cổng định tuyến AI (một phần sản phẩm). Backend gọi `http://nine-router:20128/v1` trong network nội bộ |
| `backend` | `realestate_backend` | image `realestatemanager-backend:current` (dựng bởi `release.sh build`, mục 0) | bind `./logs`; volume `backend_state` (`/app/state`) | không | Chờ mongo + redis healthy, minio-init xong. Có `healthcheck` gọi liveness (mục 7); số phiên bản + commit nằm trong image ở `dist/version.json` (mục 11.1) |
| `frontend` | `realestate_frontend` | image `realestatemanager-frontend:current` (nginx, dựng bởi `release.sh build`) | không | `80` | Proxy `/api/` sang backend; cấu hình runtime qua `/env.js`, health ở `/healthz`; `client_max_body_size 6m` (upload ảnh CRM tối đa 5 MB, phải >= giới hạn backend) |
| `cloudflared` | `realestate_cloudflared` | `${CLOUDFLARED_IMAGE}` (mặc định `cloudflare/cloudflared:latest`) | không | không | Tunnel token, hostname cấu hình ở dashboard Cloudflare |

```
Internet ── Cloudflare ── cloudflared ─┬─ <domain-admin> ─> frontend:80 ─> backend:3000 ─┬─> mongo:27017 (rs0, auth)
                                       │                                                 ├─> redis:6379  (password)
                                       └─ <domain-file>  ─> minio:9000 <─────────────────┘   minio:9000 (S3, nội bộ)
```

Tất cả nằm trong network `realestate_net` (subnet cố định `10.213.77.0/24`, cloudflared giữ IP tĩnh `10.213.77.250`, xem mục 2.1); **chỉ frontend publish cổng 80 ra mọi interface**, ngoài ra chỉ có cổng `20128` của 9Router (dashboard + API), mặc định bind **`127.0.0.1`** (chỉ vào được từ chính máy chủ). Cổng Mongo `27017` đã bị bỏ (trước đây mở ra mọi interface mà không có xác thực).

**9Router (`nine-router`)**: backend dùng thật (`ACTIVE_AI_PLATFORM=9Router`, `NINEROUTER_BASE_URL=http://nine-router:20128/v1` do compose đặt cho backend (`docker-compose.yml`)). Tên service **phải giữ là `nine-router`** (tên DNS nội bộ). Vì backend gọi qua tên service trong network nội bộ nên **không phụ thuộc** cổng publish ra host. Vào dashboard từ xa bằng SSH tunnel: `ssh -L 20128:localhost:20128 <user>@<host>` rồi mở `http://localhost:20128`.

- **Chuyển từ cấu hình cũ (`0.0.0.0`, mọi interface) sang mặc định `127.0.0.1`:** truy cập dashboard trực tiếp qua IP/Tailscale của VPS sẽ **ngừng hoạt động**; muốn giữ thì đặt `NINE_ROUTER_BIND_ADDR=0.0.0.0` trong `.env` (dashboard lộ ra mạng đó, cân nhắc kỹ).
- Cổng `127.0.0.1:20128` chỉ bind **IPv4 loopback** (bản cũ `20128:20128` bind cả IPv4 và IPv6). Trước khi đổi, xác nhận **không có Cloudflare Tunnel ingress hay `tailscale serve`/`funnel` nào đang trỏ vào IP của host ở cổng 20128** (Zero Trust > Tunnels > Public Hostname; `tailscale serve status`): ingress kiểu đó sẽ hỏng khi chuyển sang loopback. Ingress trỏ `nine-router:20128` (tên service) thì vẫn chạy.
- **Khóa API:** image 9Router **không đọc** biến `NINEROUTER_API_KEY` (đó là tên biến phía backend), nên compose không còn đặt biến này. API key mà backend dùng gọi 9Router là key tạo trong dashboard 9Router, lưu ở cấu hình/`.env` của backend; không liên quan tới compose. Các biến image có đọc (`API_KEY_SECRET`, `JWT_SECRET`, `MACHINE_ID_SALT`, `REQUIRE_API_KEY`, `AUTH_COOKIE_SECURE`...) hiện không đặt (dùng mặc định của image); nếu bản đang chạy trên VPS có đặt thì phải mang sang compose trước khi tạo lại container (mục 5.0a). `INITIAL_PASSWORD` theo README chỉ có tác dụng khi volume chưa có mật khẩu đã lưu.

Quyết định thiết kế chính:

| Hạng mục | Quyết định | Lý do |
|---|---|---|
| Mongo replica set | `rs0`, 1 node, host `mongo:27017` | Backend dùng `withTransaction`; host là tên service nên backend nối bằng `replicaSet=rs0`, không cần `directConnection` |
| Mongo xác thực | root từ env + keyFile 400 user `mongodb`, tạo lại mỗi lần khởi động từ `MONGO_KEYFILE` | Replica set có auth bắt buộc keyFile; không để file secret trong repo/image |
| Healthcheck Mongo | tự `rs.initiate` (idempotent) rồi chỉ healthy khi PRIMARY; xác thực **trong script `mongosh`** bằng `process.env.MONGO_INITDB_ROOT_*` (không có `-u`/`-p` trên dòng lệnh, PT-002) | Không cần bước khởi tạo thủ công khi triển khai mới; mật khẩu root không hiện trong `ps` |
| Healthcheck backend | `node -e fetch(.../api/v1/health/liveness)` mỗi 15 giây, `start_period` 40 giây (PT-001) | Image `node:*-slim` không có `curl`/`wget`; liveness không kiểm dependency nên Mongo/Redis/MinIO chập chờn không làm backend bị đánh dấu `unhealthy` |
| Volume Mongo | giữ tên `mongo_data` | Dữ liệu production cũ không mất |
| Volume 9Router | giữ tên khóa `nine_router_data` (volume thật `realestatemanager_nine_router_data`) | Volume đang có dữ liệu 9Router; đổi tên khóa/project là mất dấu dữ liệu |
| Database | giữ `realestate` | Khớp dữ liệu cũ |
| Redis | noeviction + AOF | BullMQ yêu cầu noeviction; job/idempotency sống qua restart |
| MinIO | credential bắt buộc từ env, không cổng ra host | Không còn `minioadmin`, không lộ S3 ra mạng ngoài |

## 2. Biến môi trường

Compose tự đọc biến `${...}` từ file **`.env`** ở thư mục chạy: **một file duy nhất**, lập từ **một mẫu duy nhất** `.env.example` (không còn `.env.docker`). File này chứa `CLOUDFLARE_TUNNEL_TOKEN` và mọi bí mật khác. Backend **không** đọc nó trực tiếp (không `env_file`, không bind-mount): compose truyền từng khóa vào container (danh sách tường minh trong `docker-compose.yml`). Quyền `600`, không commit. Luôn chạy từ thư mục chứa `.env`:

```bash
docker compose <lệnh>
```

Mẫu toàn placeholder: `.env.example` (nguồn đầy đủ; `bash ops/verify-env.sh .env` kiểm khóa bắt buộc, định dạng và độ khớp giữa các khóa). Bảng dưới liệt kê các khóa quan trọng; "Bắt buộc = có" nghĩa là thiếu hoặc rỗng thì `docker compose` báo lỗi ngay (`${KEY:?}`) và `verify-env.sh` báo lỗi:

| Biến | Bắt buộc | Dùng cho | Cách sinh / ghi chú |
|---|---|---|---|
| `NODE_ENV` | có | môi trường chạy | `ops/verify-env.sh` bắt buộc có `NODE_ENV=production` trong `.env` (giá trị khác thì báo lỗi; compose không có `:?` cho khóa này); compose tự đặt cứng `NODE_ENV=production` cho backend |
| `MONGO_ROOT_USERNAME` | có | user root Mongo, backend | tên tùy chọn |
| `MONGO_ROOT_PASSWORD` | có | root Mongo, backend | `openssl rand -hex 24` (hex để an toàn trong URI) |
| `MONGO_KEYFILE` | có | keyFile replica set | `openssl rand -hex 64` (1 dòng, 6-1024 ký tự base64/hex) |
| `MONGODB_URI` | có | URI backend dùng để nối Mongo (và runner migration) | `mongodb://<MONGO_ROOT_USERNAME>:<MONGO_ROOT_PASSWORD>@mongo:27017/realestate?authSource=admin&replicaSet=rs0`; user/mật khẩu phải TRÙNG `MONGO_ROOT_*` (`verify-env.sh` kiểm). Compose KHÔNG tự dựng chuỗi này |
| `REDIS_PASSWORD` | có | Redis, backend | `openssl rand -hex 24` |
| `REDIS_URL` | có | URL Redis của backend | `redis://:<REDIS_PASSWORD>@redis:6379`; mật khẩu phải TRÙNG `REDIS_PASSWORD` (`verify-env.sh` kiểm). Compose KHÔNG tự dựng chuỗi này |
| `S3_ACCESS_KEY_ID` | có | root user MinIO + access key backend | >= 3 ký tự, không dùng `minioadmin` |
| `S3_SECRET_ACCESS_KEY` | có | root password MinIO + secret backend | `openssl rand -hex 24` (>= 8 ký tự) |
| `S3_PUBLIC_ENDPOINT` | khi dùng ảnh/export | backend ký signed URL | `https://<domain-file>`, xem mục 3 |
| `MINIO_IMAGE`, `MONGO_IMAGE`, `REDIS_IMAGE`, `NINE_ROUTER_IMAGE`, `CLOUDFLARED_IMAGE` | không | image của từng service | mặc định = tag hiện tại (`cgr.dev/chainguard/minio:latest`, `mongo:7`, `redis:7-alpine`, `decolua/9router:latest`, `cloudflare/cloudflared:latest`). Ghim digest và nâng cấp image có chủ đích: **mục 12** (PT-009) |
| `S3_BUCKET_ATTACHMENTS`, `S3_BUCKET_EXPORTS` | có | tên bucket (backend và `minio-init`) | giá trị mẫu `crm-attachments`, `crm-exports`. **Bắt buộc, không được để trống** (compose dùng `${KEY:?}`: thiếu hoặc rỗng thì mọi lệnh `docker compose` báo lỗi). **CẢNH BÁO: `S3_BUCKET_EXPORTS` phải đúng `crm-exports` (có chữ `s`).** VPS cũ từng gõ nhầm `crm-export`: sai tên thì xuất file CRM lỗi, hoặc ghi vào bucket không có rule tự xóa sau 7 ngày. Chỉ đổi giá trị mẫu khi thật sự đổi tên bucket. Kiểm: `docker compose config | grep -E 'S3_BUCKET_'` (hai tên bucket, không phải bí mật) và `mc ls local` (mục 7) phải thấy đúng hai bucket `crm-attachments`, `crm-exports` |
| `S3_APP_ACCESS_KEY_ID`, `S3_APP_SECRET_ACCESS_KEY` | không | access key MinIO quyền tối thiểu cho backend (thay root) | mặc định để trống = backend dùng `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (cùng cặp root của MinIO). Cách tạo và chuyển: **mục 13.4** (PT-016). Mật khẩu hex, không đặt trong repo. **`MONGO_APP_*` đã bỏ ở v1.0.6** (compose không còn đọc; `verify-env.sh` báo khóa lạ): xem banner ở mục 13.3 |
| `S3_SIGNED_URL_TTL_SECONDS`, `REDIS_KEY_PREFIX` | không | backend | mặc định 900 và `rem:` |
| `CRM_ENABLED`, `CRM_ATTACHMENTS_ENABLED` | không | cờ CRM dùng chung backend (`FEATURE_CRM_*`) và frontend (runtime `/env.js`) | mặc định `false`; xem mục 10. **Không** đặt `FEATURE_CRM_*` trong `.env` (compose ghi đè) |
| `CRM_PUSH_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_ENDPOINT_HOST_ALLOWLIST` | không | Web Push (`FEATURE_CRM_PUSH` do compose chuyển từ `CRM_PUSH_ENABLED`) | mặc định tắt; cách sinh khóa VAPID, bật/tắt khẩn cấp: xem **mục 10** và **mục 15**. **Không** đặt `FEATURE_CRM_PUSH` trong `.env` |
| `FRONTEND_URL` | **có** | CORS (origin duy nhất được phép) và chuyển hướng sau Google Drive OAuth | `https://<domain-admin>` (scheme + host, không dấu `/` cuối, không đường dẫn); `verify-env.sh` kiểm dạng. Compose dùng `${FRONTEND_URL:?}` cho cả `backend` và `frontend`: thiếu hoặc rỗng thì `docker compose` báo lỗi (không còn rơi về `http://localhost`). Cách kiểm: mục 13.1 |
| `JWT_SECRET`, `COOKIE_SECRET` | có | ký access token / cookie của backend | `openssl rand -base64 48` (mỗi khóa một giá trị khác nhau) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | có | tài khoản admin seed lần đầu (khi DB chưa có user) | email và mật khẩu mạnh do bạn chọn; thiếu thì backend không khởi động khi DB trống (xem bảng "Hành vi khi `NODE_ENV=production`" bên dưới) |
| `HELMET_CSP_ENABLED` | không | bật Content-Security-Policy của Helmet trên backend | mặc định `false` (`true`, không phân biệt hoa/thường và không có khoảng trắng thừa, thì bật; giá trị khác thì tắt); chỉ bật khi Admin SPA phục vụ riêng (nginx) và đã thử Swagger UI + web admin không bị chặn |
| `QUEUE_WORKERS_ENABLED` | không | backend chạy worker + job lặp BullMQ (nhắc lịch hẹn, dọn ảnh, gửi push) | mặc định `true` khi bỏ trống ở production; chỉ đặt `false` khi tách tiến trình worker riêng (phải còn >= 1 instance `true`, nếu không nhắc lịch/push/thumbnail không chạy). Nhận `true|1|yes|on` |
| `CRM_PII_ENCRYPTION_KEY` | **có khi bật CRM** | mã hóa CCCD (AES-256-GCM) | `openssl rand -base64 32`; **mất khóa = không giải mã lại được CCCD đã lưu**, sao lưu ngoài máy chủ |
| `CLOUDFLARE_TUNNEL_TOKEN` | **có** | token Cloudflare Tunnel (`cloudflared`) | lấy ở Cloudflare Zero Trust; thiếu thì `docker compose` báo lỗi ngay (trước đây thiếu thì cloudflared chạy với token rỗng và lỗi âm thầm) |
| `NINE_ROUTER_INITIAL_PASSWORD` | có | mật khẩu dashboard 9Router (`INITIAL_PASSWORD` của container `nine-router`) | `openssl rand -hex 16`; theo README chỉ có tác dụng khi volume `nine_router_data` chưa có mật khẩu đã lưu (VPS đang chạy: không đổi được mật khẩu hiện có, nhưng vẫn phải điền); không ghi vào repo/chat |
| `NINE_ROUTER_BIND_ADDR` | không | địa chỉ host mà cổng `20128` bind | mặc định `127.0.0.1` (chỉ từ máy chủ; vào từ xa bằng SSH tunnel). `0.0.0.0` = mọi interface, chỉ khi thật sự cần vào qua IP/Tailscale |

Compose cố định sẵn (không đọc từ `.env`, nên **không cần** khai báo): `S3_ENDPOINT` (= `http://minio:9000`), `PORT`, `TZ`, `TRUST_PROXY`. Các khóa còn lại truyền từ `.env` vào container theo danh sách tường minh của `docker-compose.yml`; khóa tùy chọn có giá trị mặc định (`${KEY:-mặc định}`: `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_SIGNED_URL_TTL_SECONDS`, `REDIS_KEY_PREFIX`...). **`MONGODB_URI`, `REDIS_URL` và hai tên bucket KHÔNG được compose tự dựng: phải khai trong `.env`** (bảng trên). Khi nâng cấp từ bản cũ: dòng `MONGODB_URI` cũ (Mongo standalone) phải được thay bằng URI replica set ở trên; **giữ lại bản cũ ngoài repo cho tới hết bước 5.7 nếu còn cần đường lui 5.8** (backend cũ cần nó để nối Mongo standalone).

Lưu ý ký tự đặc biệt trong mật khẩu:

- **Redis**: backend đọc `REDIS_URL` bằng `new URL()` rồi `decodeURIComponent` cho user/password (`src/shared/redis/redis.config.ts`), nên mật khẩu có ký tự đặc biệt vẫn dùng được nếu URL-encode. Nhưng compose ghép chuỗi **không** tự encode, vì vậy dùng hex để khỏi phải nghĩ. Dạng `redis://:<pwd>@host` (username rỗng) chạy tốt với backend (ioredis, đã thử); riêng `redis-cli -u redis://:<pwd>@...` báo WRONGPASS (đặc điểm của redis-cli), hãy dùng `REDISCLI_AUTH`.
- **Mongo**: ký tự `: / ? # [ ] @ % +` trong mật khẩu làm hỏng URI; dùng hex.
- Không dùng `$` trong bất kỳ giá trị nào của `.env` (compose coi là biến).

Ghim image theo digest (production): xem **mục 12**. Lấy digest của bản **đang chạy** bằng `bash ops/print-image-digests.sh`; không `docker pull` rồi lấy digest mới (bản mới có thể khác bản đang chạy).

### Hành vi khi `NODE_ENV=production` (compose đã đặt sẵn cho backend)

Đã rà toàn bộ `RealEstateBackendApp/src`: chỉ các chỗ sau đọc `NODE_ENV`.

| Hành vi | production | Ngoài production |
|---|---|---|
| Cookie refresh token (`auth.controller.ts`) | có cờ `Secure` (đã xác nhận trong `Set-Cookie`), `HttpOnly`, `SameSite=Strict` | không `Secure` |
| Seed admin lần đầu (`auth.service.ts`) | **bắt buộc** `ADMIN_EMAIL` + `ADMIN_PASSWORD` khi DB chưa có user; thiếu thì backend thoát với `ADMIN_EMAIL/ADMIN_PASSWORD must be set in production` (đã thử; container sẽ restart liên tục vì `restart: unless-stopped`). DB đã có user thì bỏ qua | dùng admin mặc định + cảnh báo |
| Giới hạn đăng nhập (`auth-throttle.config.ts`) | cố định 5 lần/phút/IP, bỏ qua `AUTH_LOGIN_THROTTLE_LIMIT` | cho nới bằng biến đó (E2E) |
| Hàng đợi BullMQ, ghi log file | giữ nguyên (chỉ `NODE_ENV=test` mới tắt) | như nhau |
| Swagger (`/api/v1/docs`) (`src/common/swagger/swagger.config.ts`, PT-008) | **tắt**: không đăng ký route, `/api/v1/docs` trả **404**; log khởi động ghi `Swagger docs đã tắt (NODE_ENV=production)` | **bật chỉ khi** `NODE_ENV` (sau khi trim và hạ chữ thường) thuộc allowlist `development`, `test`, `staging`, `local`. Giá trị lạ hoặc gõ nhầm (ví dụ `prod`), chưa đặt, hoặc `production` đều **tắt** (fail-safe: không lộ tài liệu API khi cấu hình sai) |
| CORS, Helmet, ValidationPipe, log level | **không phụ thuộc** `NODE_ENV` (level theo `LOG_LEVEL`; CSP theo `HELMET_CSP_ENABLED`) | như nhau |
| Stack trace trong lỗi API | không bao giờ gửi cho client (chỉ ghi log máy chủ) | như nhau |

Hệ quả cần biết:

- Cookie `Secure` chỉ được trình duyệt giữ khi truy cập qua **HTTPS** (domain Cloudflare) hoặc `http://localhost`. Truy cập HTTP qua IP/hostname thường sẽ không giữ được cookie đăng nhập.
- **Swagger đã tắt ở production (PT-008, quyết định của Oniichan 2026-11-02):** không còn tài liệu API công khai; muốn xem tài liệu API dùng dev/staging. Không cần chặn đường dẫn ở Cloudflare/nginx. **Có hiệu lực sau lần deploy kế tiếp** (code đổi ở `main.ts`): bản production đang chạy trước đó vẫn trả 200 ở `/api/v1/docs`.
- **Xác minh `NODE_ENV` thật trên production (việc của Oniichan, chỉ đọc; chưa làm):** compose đặt `NODE_ENV=production` cho `backend` qua `environment` (ghi đè `env_file`), nhưng **chưa ai kiểm giá trị trong container đang chạy**. Sau khi deploy bản có PT-008:
  ```bash
  docker exec realestate_backend printenv NODE_ENV                          # kỳ vọng: production
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/docs     # kỳ vọng: 404 (qua nginx cổng 80 trên VPS)
  docker logs realestate_backend 2>&1 | grep -i 'Swagger'                   # kỳ vọng: "Swagger docs đã tắt (NODE_ENV=production)"
  ```
  Nếu `printenv` in giá trị khác `production`, hoặc `/api/v1/docs` vẫn 200: dừng, báo lại (container có thể đang chạy từ compose cũ chưa tạo lại). Repo hiện **không có stack staging**. **Lưu ý khi chạy dev:** vì Swagger chỉ bật với `NODE_ENV` thuộc allowlist `development|test|staging|local`, môi trường dev phải có `NODE_ENV` thuộc danh sách này (`RealEstateBackendApp/.env.example` đã ghi `NODE_ENV=development`); `RealEstateBackendApp/docker-compose.dev.yml` không tự đặt `NODE_ENV`, nên nếu dev không có biến này thì Swagger tắt (log ghi `Swagger docs đã tắt (NODE_ENV=(chưa đặt))`). Nếu sau này có staging: đặt `NODE_ENV=staging` (không đặt `production`) nếu muốn xem Swagger ở đó.
- **IP client cho rate limit: đã xử lý (mục 2.1 bên dưới).**

### 2.1. IP client thật cho rate limit (nginx + Cloudflare + backend)

Vấn đề đã gặp: backend không bật `trustProxy`, nên `req.ip` là IP nginx và **mọi người dùng chung một bộ đếm** (5 lần đăng nhập/phút cho cả hệ thống). Cách xử lý gồm 3 phần phải đi cùng nhau:

| Thành phần | Cấu hình | Vai trò |
|---|---|---|
| `docker-compose.yml`: `cloudflared` | IP tĩnh `10.213.77.250` trong network `realestate_net` (subnet `10.213.77.0/24`, `ip_range 10.213.77.0/25` cho IP động) | Có một địa chỉ duy nhất để nginx tin |
| `RealEstateAdminApp/nginx.conf` | `set_real_ip_from 10.213.77.250; real_ip_header CF-Connecting-IP; real_ip_recursive off;` rồi `proxy_set_header X-Forwarded-For $remote_addr` và `X-Real-IP $remote_addr` (ghi đè, không cộng dồn) | Lấy IP thật từ Cloudflare **chỉ khi request đến từ cloudflared**, rồi báo cho backend |
| `docker-compose.yml`: backend | `TRUST_PROXY=1` | Backend tin đúng 1 hop (nginx) và lấy IP từ `X-Forwarded-For` mà nginx ghi |

Vì sao không tin cả dải docker: cổng 80 của frontend được publish ra host, request vào thẳng cổng đó có nguồn là gateway của bridge (`10.213.77.1`) nằm trong cùng dải với cloudflared. Nếu `set_real_ip_from` là cả dải, kẻ tấn công tự đặt `CF-Connecting-IP` giả và lách được giới hạn đăng nhập. Vì thế chỉ tin đúng một IP.

**Cảnh báo khi sửa:**
- KHÔNG đổi `set_real_ip_from` thành dải mạng (`10.0.0.0/8`, `172.16.0.0/12`, subnet của `realestate_net`...).
- Đổi IP/subnet thì sửa **đồng thời** `ipv4_address`/`ipam` trong compose và biến `TRUSTED_PROXY_IP` trong `.env` (nginx.conf là template envsubst, `set_real_ip_from` lấy từ biến này), rồi tạo lại container (`docker compose up -d --no-build frontend cloudflared`). Chọn dải không trùng mạng nội bộ/VPN của server; nếu trùng, `up` báo `Pool overlaps`.
- Không đổi `proxy_set_header X-Forwarded-For` về `$proxy_add_x_forwarded_for` (cộng dồn header do client gửi).
- Không bỏ `ip_range` (nếu bỏ, container khác có thể bị cấp đúng `.250` trước cloudflared).
- Đổi ipam của network `realestate_net` đang tồn tại cần tạo lại network: chạy `docker compose down` (KHÔNG `-v`) rồi `up -d --no-build`. Có downtime ngắn, dữ liệu trong volume không mất.
- Cổng 80 vẫn publish ra host như cũ. Nếu không cần truy cập trực tiếp, có thể đổi thành `127.0.0.1:80:80` (tăng an toàn); chưa áp dụng.

Kiểm bằng lệnh (đã chạy thật trên project tạm, cloudflared được giả bằng container tạm gán đúng IP tĩnh):

```bash
NET=<tên-network>   # docker network ls | grep realestate_net
# Script gửi N lần đăng nhập sai với CF-Connecting-IP cho trước tới nginx (cần node:24-slim, đặt file t.js ở thư mục tạm).
#   (a) từ IP cloudflared: mỗi CF-Connecting-IP có bộ đếm riêng
docker run --rm --network $NET --ip 10.213.77.250 -v "$PWD/tmp":/t:ro node:24-slim node /t/t.js cfA 203.0.113.10 6   # 401 x5 rồi 429
docker run --rm --network $NET --ip 10.213.77.250 -v "$PWD/tmp":/t:ro node:24-slim node /t/t.js cfB 203.0.113.20 2   # 401, 401 (IP B không bị khóa theo IP A)
#   (b) từ container khác (IP không phải cloudflared): CF-Connecting-IP bị bỏ qua
docker run --rm --network $NET -v "$PWD/tmp":/t:ro node:24-slim node /t/t.js other 198.51.100.1,198.51.100.2,198.51.100.3,198.51.100.4,198.51.100.5,198.51.100.6 1   # lần 6 bị 429
#   (c) vào thẳng cổng 80 publish của host với CF-Connecting-IP giả: không được tin (nguồn là gateway bridge)
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " -X POST http://127.0.0.1/api/v1/auth/login -H 'content-type: application/json' -H "CF-Connecting-IP: 192.0.2.$i" -d '{"email":"x@x.local","password":"wrongpass1"}'; done   # 401 x5 rồi 429
docker logs realestate_backend 2>&1 | grep trustProxy      # "trustProxy bật: tin 1 proxy"
```

(Ghi chú: file `t.js` lặp qua danh sách `CF-Connecting-IP`, gửi `POST /api/v1/auth/login` sai mật khẩu và in mã trạng thái; thay bằng cách tương đương tùy ý. Nhớ đợi 60 giây giữa hai lượt kiểm nếu thử lại cùng IP.)

Kết quả đã quan sát: (a) IP A `401,401,401,401,401,429`, IP B `401,401`; (b) `401 x5` rồi `429` dù mỗi lần đổi `CF-Connecting-IP` và `X-Forwarded-For`; (c) `401 x5` rồi `429`, log nginx ghi nguồn `10.213.77.1`. Chưa kiểm chứng với cloudflared và Cloudflare thật (cần xác nhận `CF-Connecting-IP` đúng IP người dùng khi đã có tunnel thật), và chưa thử trên server Linux thật.


## 3. `S3_PUBLIC_ENDPOINT`: để trình duyệt tải ảnh/export

Backend ký URL bằng `S3_PUBLIC_ENDPOINT` (code: `src/shared/storage/storage.module.ts`, `s3.config.ts`); chữ ký SigV4 bao gồm **Host** và đường dẫn. MinIO không publish ra host nên cần một địa chỉ công khai mà trình duyệt gọi được.

Phương án chọn: **một hostname riêng qua Cloudflare Tunnel trỏ tới `http://minio:9000`**, vd `https://<domain-file>`. Compose không phải sửa (tunnel dùng token, ingress cấu hình trên dashboard). Đã thử: URL ký cho host `files.example.test` trả 200 khi Host khớp, 403 `SignatureDoesNotMatch` khi Host khác.

Phương án đã loại: proxy `/s3/` trong `RealEstateAdminApp/nginx.conf` cùng host với web. Đường dẫn nằm trong chữ ký nên cắt tiền tố `/s3/` làm sai chữ ký, và mở rộng nginx.conf chỉ để phục vụ S3 là phức tạp hơn.

**Việc thủ công (Oniichan làm một lần):**

1. Cloudflare Zero Trust > Networks > Tunnels > tunnel đang dùng (cùng token `CLOUDFLARE_TUNNEL_TOKEN`) > **Public Hostname** > Add: Subdomain/Domain = `<domain-file>`, Service = `HTTP`, URL = `minio:9000`.
2. **Không** đặt "HTTP Host Header" (Additional settings > HTTP Settings) cho hostname này: cloudflared phải giữ nguyên Host gốc, nếu không chữ ký sai.
3. Đặt `S3_PUBLIC_ENDPOINT=https://<domain-file>` trong `.env` (không dấu `/` cuối, không đường dẫn), rồi `docker compose up -d backend`.
4. (Khuyến nghị) Cloudflare WAF: chỉ cho `GET`/`HEAD` tới `<domain-file>`; chặn mọi đường dẫn không bắt đầu bằng tên bucket. Bucket vẫn riêng tư, chỉ truy cập được bằng URL đã ký (15 phút).

Trình duyệt tải ảnh qua thẻ `<img>`/liên kết nên không cần CORS. Nếu sau này dùng `fetch`/XHR từ trang web, cần thêm CORS cho MinIO.

## 4. Triển khai mới (volume `mongo_data` rỗng)

Từ v1.0.6 VPS **không có mã nguồn**: gói script và image đến từ máy build (mục 0). Thư mục deploy trên VPS chỉ có `docker-compose.yml`, `deploy.sh`, `backup.sh`, `restore.sh`, `release.env`, `ops/`, `scripts/` (do `release.sh send` cài) cùng `.env`, `backups/`, `logs/` do bạn tạo.

```bash
# 1) MÁY BUILD: dựng image + gói, rồi gửi lần đầu (tạo thư mục deploy, cài gói, nạp image). Chi tiết ở mục 0.2.
./release.sh build
./release.sh send --to <ssh-host> --init --dry-run      # kiểm cục bộ, in kế hoạch
./release.sh send --to <ssh-host> --init                # deploy.sh sẽ dừng ở bước kiểm .env (chưa có .env): bình thường

# 2) TRÊN VPS, trong thư mục deploy: tạo .env từ mẫu .env.example (mẫu nằm trong repo, KHÔNG nằm trong gói), điền giá trị thật
cp .env.example .env && chmod 600 .env      # (chép .env.example từ repo sang VPS trước); sinh mật khẩu theo mục 2
bash ops/verify-env.sh                      # lặp lại cho tới khi hợp lệ (chỉ in TÊN khóa lỗi, không in giá trị)
mkdir -p logs && chown 1000:1000 logs       # backend chạy USER node (uid 1000) trong container, cần quyền ghi ./logs (dùng sudo nếu cần)

# 3) Kiểm tra cú pháp + biến bắt buộc (compose tự đọc .env ở thư mục hiện tại)
docker compose config -q

# 4) MÁY BUILD: gửi lại để deploy thật (lần đầu mongo tự tạo user root, tự rs.initiate qua healthcheck)
./release.sh send --to <ssh-host>
# hoặc, khi image đã nạp sẵn trên VPS:  bash deploy.sh
docker compose ps -a   # mongo/redis/minio healthy; minio-init "Exited (0)" là bình thường

# 5) Cloudflare: thêm hostname <domain-file> -> http://minio:9000 (mục 3), đặt S3_PUBLIC_ENDPOINT trong .env rồi `docker compose up -d --no-build backend`
```

Backend seed admin theo `ADMIN_EMAIL`/`ADMIN_PASSWORD` (bắt buộc ở production). Kiểm tra sức khỏe ở mục 7. Cài mới thật sự (không có container và không có volume Mongo): `deploy.sh` bỏ qua backup (chưa có dữ liệu) và chạy bước 8a (mục 11) để ghi phiên bản hệ thống.

## 5. Nâng cấp tại chỗ từ Mongo standalone cũ

> **Lịch sử (trước v1.0.6).** Mục 5 mô tả lần nâng cấp tại chỗ từ Mongo standalone cũ, làm một lần bằng tay trên VPS khi VPS còn là một bản repo git và tự build. Các lệnh trong mục này dùng `docker compose` theo cấu trúc cũ (`--env-file .env.docker`, `up -d --build`, bind-mount `./.env`) và **không còn khớp** với compose v1.0.6; giữ nguyên làm hồ sơ và chỉ dùng như tham khảo từng bước (tạo user, `rs.initiate`, migration 005/006). Với VPS đã ở cấu hình replica set + xác thực, bỏ qua mục này và dùng mục 0 và 11.

Áp dụng khi production đang chạy `mongo:7` standalone (không xác thực) với dữ liệu thật ở volume `mongo_data`. `MONGO_INITDB_ROOT_*` chỉ chạy khi thư mục dữ liệu **rỗng**, nên chỉ đổi compose rồi `up` sẽ không tạo user: Mongo khởi động nhưng healthcheck/backend báo `Authentication failed`. Quy trình sau tạo user và khởi tạo replica set ngay trên dữ liệu cũ.

Rủi ro: có **downtime vài phút** (dừng backend/mongo). Tính chất: có đường lui (bước 5.8), miễn là bước 5.0a (nếu áp dụng), 5.1 và 5.2 đã làm. Không bỏ qua các bước này.

Lần nâng cấp này **không dùng `deploy.sh`** (mục 11 chỉ dành cho cập nhật stack đã ở trạng thái mới). Phiên bản backend mới còn đòi **migration dữ liệu 005 và 006 chạy TRƯỚC khi backend khởi động** (bước 5.4a), nên `up` cả stack một lần như trước đây sẽ làm backend mới không lên.

> **Chạy cả quy trình trong `tmux` (hoặc `screen`/`nohup`).** SSH rớt giữa chừng (nhất là sau 5.2 khi stack đã dừng, hoặc lúc `docker build` ở 5.4a/5.4b) có thể để hệ thống nửa vời. Rớt thì vào lại, `tmux attach`, xem `docker ps -a`, rồi làm tiếp từ đúng bước dở (các bước đều dừng được an toàn, trừ 5.3: nếu container `realestate_mongo_upgrade` còn tồn tại thì xem `docker logs` trước khi chạy lại).

Quy ước: chạy ở thư mục gốc repo trên máy production.

> **Chạy trên server Linux (bash) hoặc WSL. KHÔNG dùng Git Bash trên Windows** cho mục 5 và 6: MSYS tự đổi đường dẫn (`/tmp` thành `C:/...`) và mount `-v "$PWD/..."` bị hỏng, file backup có thể không xuất hiện mà tưởng đã có.
>
> **Quy tắc tự kiểm tra:** sau MỖI bước backup phải chạy `ls -l` và thấy file có kích thước **> 0 byte** mới đi tiếp. Báo `No such file` hoặc 0 byte: DỪNG, chưa được làm bước kế.

**Mức kiểm chứng:** các bước của bản quy trình cũ (backup 5.1, `stop` 5.2, bật replica set + tạo user trên dữ liệu cũ 5.3, `up`, kiểm dữ liệu 5.5) đã chạy thật trên volume mẫu (2 document còn nguyên sau nâng cấp), trừ đường lui 5.8. **Chuỗi MỚI chưa từng chạy end-to-end**: 5.0a (gỡ sửa tay, chuyển nhánh), chỉ `up` 4 service ở 5.4, migration 005/006 qua `scripts/run-migration.sh` ở 5.4a (ts-node và migration 005/006 đã chạy thật trên image `builder` ở máy dev, chưa chạy trên VPS), 5.4b với `nine-router`, và đường lui 5.8 mới (dùng compose cũ đã lưu). Làm trên VPS từng bước, thấy điều lạ thì dừng.

**5.0 Chuẩn bị**

> Các lệnh ở 5.0 và 5.0a là quy trình **tay** cho VPS chạy nhánh `production` (ghi cứng `origin production`, đúng với VPS). Từ v1.0.5 `deploy.sh` **không còn ép nhánh `production`**: nó pull trên nhánh đang checkout theo upstream của nhánh đó (mục 11, 11.8). Hai việc này độc lập, đừng nhầm.

```bash
git status --short                                            # phải trống; còn dòng nào (vd ` M docker-compose.yml`) thì làm 5.0a thay cho `git pull`
git branch --show-current                                     # phải in `production`; in ra trống = HEAD detached: làm 5.0a
git pull --ff-only origin production                          # CHỈ khi hai dòng trên đạt; đã làm 5.0a thì BỎ QUA dòng này. CHƯA up
docker volume ls | grep mongo_data                            # ghi lại tên volume thật, vd realestatemanager_mongo_data
VOL=realestatemanager_mongo_data                              # đặt đúng tên vừa thấy
docker inspect realestate_mongo --format '{{.Config.Image}}'  # xác nhận đang mongo:7
# Điền .env.docker (mục 2), kiểm tra:
docker compose --env-file .env.docker config -q
```

Không đổi tên thư mục dự án và không thêm `name:` vào compose: project khác tên sẽ tạo volume mới rỗng.

**5.0a Nếu VPS có bản sửa tay (`nine-router` thêm tay vào `docker-compose.yml`), đang ở HEAD detached, hoặc còn `deploy.sh` cũ: làm bước này THAY cho `git pull` ở 5.0**

Hiện trạng đã xác minh: VPS chạy compose bản cũ + service `nine-router` thêm tay (không có trong repo), đang ở HEAD detached nên `git pull` thẳng sẽ lỗi. 9Router nay nằm sẵn trong compose của repo. Stack cũ **vẫn đang chạy** trong bước này. Làm đúng thứ tự:

```bash
# (a) Ghi lại hiện trạng 9Router đang chạy: CHỈ TÊN biến (không in giá trị), mounts, image.
#     Tìm container THEO VOLUME, không giả định tên:
C9=$(docker ps -a --filter volume=realestatemanager_nine_router_data --format '{{.Names}}')
echo "$C9"                                                    # phải đúng MỘT tên (kỳ vọng realestate_9router). Rỗng hoặc nhiều tên: DỪNG, xem `docker ps -a`
IMG=$(docker inspect "$C9" --format '{{.Config.Image}}')
( umask 077                                                   # các file ghi chép dưới đây quyền 600 (chỉ chứa TÊN biến/mounts, vẫn nên riêng tư)
  docker inspect "$C9" --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1 | sort > ~/9router.env-names.txt
  docker image inspect "$IMG" --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1 | sort > ~/9router.image-env-names.txt
  docker inspect "$C9" --format '{{json .Mounts}}' > ~/9router.mounts.json )
comm -23 ~/9router.env-names.txt ~/9router.image-env-names.txt   # tên biến do bản sửa tay đặt (không phải của image)
docker inspect "$C9" --format 'container-image-id={{.Image}}'
docker image inspect "$IMG" --format 'local-latest-id={{.Id}} digests={{json .RepoDigests}}'
```

Đối chiếu với service `nine-router` mới (xem `docker-compose.yml`: chỉ đặt `INITIAL_PASSWORD`, `DATA_DIR`, `NODE_ENV`, mount `nine_router_data:/app/data`):

- Kỳ vọng từ `comm`: `DATA_DIR`, `INITIAL_PASSWORD`, `NINEROUTER_API_KEY` (và có thể `NODE_ENV`).
- **Có tên nào khác, đặc biệt `API_KEY_SECRET`, `JWT_SECRET`, `MACHINE_ID_SALT`, `REQUIRE_API_KEY`, `AUTH_COOKIE_SECURE`, `BASE_URL`, `ENABLE_REQUEST_LOGS`, `HTTP_PROXY`/`HTTPS_PROXY`: DỪNG** và báo để sửa compose mang chúng sang (qua `.env.docker`) trước khi đi tiếp. Mất `API_KEY_SECRET`/`MACHINE_ID_SALT` làm API key backend đang dùng ngừng hợp lệ; mất `REQUIRE_API_KEY` làm `/v1/*` mở không cần key; mất `JWT_SECRET` đặt tay làm phiên dashboard hiện có bị đăng xuất.
- **`comm` chỉ so TÊN biến.** Nó KHÔNG thấy trường hợp image đã định nghĩa sẵn biến đó nhưng bản sửa tay đặt GIÁ TRỊ KHÁC (vd `NODE_ENV`, `PORT`, `HOSTNAME`). Nghi ngờ thì đối chiếu giá trị thủ công mà không in bí mật: biến không bí mật in thẳng (`docker inspect "$C9" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(NODE_ENV|DATA_DIR|PORT|HOSTNAME)='`); biến bí mật chỉ so BĂM cắt ngắn (`... | grep '^TÊN_BIẾN=' | sha256sum | cut -c1-12`), chạy cùng lệnh trên container cũ và trên container mới sau 5.4b, hai băm phải bằng nhau.
- **`NINEROUTER_API_KEY` bị bỏ có chủ đích vì README image KHÔNG liệt kê biến này.** "Không được liệt kê trong README" khác với "image không đọc": quyết định dựa trên README, rủi ro thấp nhưng chưa chứng minh bằng mã nguồn image. Nếu `comm` hiện `NINEROUTER_API_KEY`, xác nhận bằng bước "Thử nhanh một thao tác AI" ở 5.4b. Nếu 9Router báo lỗi key/401 sau đó: thêm lại biến vào `environment` của service `nine-router` với đúng giá trị cũ (xem `~/docker-compose.pre-upgrade.yml`, giá trị đưa qua biến trong `.env.docker`, không ghi vào repo) rồi `docker compose --env-file .env.docker up -d nine-router` (sửa compose: báo kiến trúc/devops).
- **Rủi ro `JWT_SECRET`:** theo README, nếu không đặt thì 9Router tự sinh và lưu vào `~/.9router/jwt-secret`. Nếu file này nằm NGOÀI volume `/app/data`, tạo lại container sẽ sinh secret mới: phiên đăng nhập dashboard bị đăng xuất (không mất dữ liệu; đăng nhập lại bằng mật khẩu). Chấp nhận được. Không tự đặt biến mới khi chưa kiểm chứng.
- `container-image-id` khác `local-latest-id`: container đang chạy dùng bản image khác với `decolua/9router:latest` trong máy; khi tạo lại, compose sẽ dùng `latest` trong máy. Ghi nhận, và cân nhắc pin digest (mục 9).
- `~/9router.mounts.json` phải có `nine_router_data` (tên đầy đủ `realestatemanager_nine_router_data`) gắn vào `/app/data`.

```bash
# (b) Lưu compose đang chạy và .env.docker ra NGOÀI repo (quyền 600): đây là ĐƯỜNG LUI ở 5.8. Chúng chứa mật khẩu: không commit, không gửi chat
install -m 600 docker-compose.yml ~/docker-compose.pre-upgrade.yml
install -m 600 .env.docker ~/env.docker.pre-upgrade

# (c) Gắn thẻ image backend/frontend ĐANG CHẠY: đường lui cần đúng image cũ (build lại ở 5.4b sẽ ghi đè :latest).
#     Tên image ghi vào ~/pre-upgrade.images (mỗi dòng: dịch-vụ tên-image) để 5.8.3 dùng ĐÚNG các tên này
: > ~/pre-upgrade.images
for c in backend frontend; do
  img=$(docker inspect "realestate_$c" --format '{{.Config.Image}}'); img=${img%%:*}
  docker tag "$(docker inspect "realestate_$c" --format '{{.Image}}')" "$img:pre-upgrade"
  echo "$c $img" >> ~/pre-upgrade.images
done
cat ~/pre-upgrade.images                                      # 2 dòng, vd: backend realestatemanager-backend
# BẮT BUỘC có đủ cả hai dịch vụ (đường lui 5.8.3 cần cả hai); thiếu thì in THIẾU và DỪNG, đừng đi tiếp
grep -q '^backend ' ~/pre-upgrade.images && grep -q '^frontend ' ~/pre-upgrade.images && [ "$(wc -l < ~/pre-upgrade.images)" -ge 2 ] || echo "THIẾU: ~/pre-upgrade.images phải có đủ 2 dòng (backend và frontend): DỪNG, kiểm tra tên container realestate_backend/realestate_frontend"
docker image ls --filter 'reference=*:pre-upgrade'            # phải thấy 2 dòng: ...-backend và ...-frontend

# (d) Bỏ bản sửa tay, chuyển sang nhánh production, lấy code mới
git status --short                                            # chỉ nên thấy ` M docker-compose.yml`; thấy file khác thì DỪNG và xem kỹ
git checkout -- docker-compose.yml                            # KHÔNG dùng `git stash` rồi để đó: bản stash nằm trong .git và chứa mật khẩu dạng chữ thường
mv deploy.sh ~/deploy.sh.old && chmod 600 ~/deploy.sh.old     # script cũ ghi cứng CLOUDFLARE_TUNNEL_TOKEN; bản mới của repo thế chỗ
git fetch origin && git checkout production                   # VPS đang detached HEAD
git pull --ff-only origin production
git status                                                    # phải thấy "On branch production", working tree sạch
git log -1 --oneline                                          # đối chiếu với commit mới nhất của nhánh production trên GitHub

# (e) Điền .env.docker: biến mới (mục 2), gồm NINE_ROUTER_INITIAL_PASSWORD (mật khẩu 9Router lấy từ ~/docker-compose.pre-upgrade.yml).
#     Token Cloudflare: nếu .env.docker chưa có giá trị, chép từ deploy.sh cũ MÀ KHÔNG in ra màn hình:
chmod 600 .env.docker
TOKEN=$(sed -nE "s/^[[:space:]]*(export[[:space:]]+)?CLOUDFLARE_TUNNEL_TOKEN=[\"']?([^\"' ]+).*/\2/p" ~/deploy.sh.old | head -n 1)
if ! grep -q '^CLOUDFLARE_TUNNEL_TOKEN=.\+' .env.docker && [ -n "$TOKEN" ]; then
  sed -i '/^CLOUDFLARE_TUNNEL_TOKEN=$/d' .env.docker           # bỏ dòng rỗng (nếu có) để không bị trùng khóa
  [ -n "$(tail -c1 .env.docker)" ] && echo >> .env.docker      # file KHÔNG có newline cuối thì thêm, kẻo token bị nối dính vào dòng cuối (vd ADMIN_PASSWORD=...CLOUDFLARE_TUNNEL_TOKEN=...)
  printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$TOKEN" >> .env.docker   # printf là builtin: token không lên danh sách tiến trình
fi
unset TOKEN
grep -c '^CLOUDFLARE_TUNNEL_TOKEN=.\+' .env.docker             # BẮT BUỘC in 1 (không in giá trị). In 0: mở deploy.sh.old bằng tay, dán vào .env.docker
# Kiểm DẠNG token (không in giá trị): >= 40 ký tự thuộc [A-Za-z0-9_=+/.-], không có \r, khoảng trắng hay nháy
VAL=$(grep '^CLOUDFLARE_TUNNEL_TOKEN=' .env.docker | tail -n 1 | cut -d= -f2-)
printf '%s' "$VAL" | grep -Eq '^[A-Za-z0-9_=+/.-]{40,}$' && echo "dạng token: OK" || echo "dạng token: SAI (quá ngắn, hoặc có \r/nháy/khoảng trắng): sửa .env.docker TRƯỚC khi đi tiếp"
unset VAL
grep -c '=.*CLOUDFLARE_TUNNEL_TOKEN=' .env.docker                 # phải in 0: không có dòng nào bị nối dính (khóa token nằm sau một dấu = khác); không in giá trị
```

Điều cần biết:

- Volume `realestatemanager_nine_router_data` **giữ nguyên**: compose mới khai báo khóa `nine_router_data` (cùng tên khóa với bản sửa tay) nên project `realestatemanager` tự ánh xạ vào đúng volume cũ. Tuyệt đối không đổi tên thư mục dự án, không thêm `name:`. Volume này được sao lưu ở 5.2 (stack đã dừng) **trước** khi container 9Router được tạo lại ở 5.4b.
- `CLOUDFLARE_TUNNEL_TOKEN` nay là biến **bắt buộc** (`${...:?}`): thiếu thì mọi lệnh compose báo lỗi, nên phải có trong `.env.docker` TRƯỚC 5.4b. Chỉ xóa `~/deploy.sh.old` sau khi tunnel đã lên (5.4b) và chạy ổn (5.7).
- Cổng 20128 mặc định giờ là `127.0.0.1`: dashboard truy cập qua IP/Tailscale sẽ ngừng, dùng SSH tunnel (mục 1) hoặc đặt `NINE_ROUTER_BIND_ADDR=0.0.0.0`. Kiểm tra trước không có Cloudflare ingress/`tailscale serve` trỏ vào host:20128 (mục 1).
- Giữ nguyên dòng `MONGODB_URI` cũ trong `.env.docker` cho tới hết 5.7 (đường lui cần). Nếu lỡ xóa, lấy lại từ `~/env.docker.pre-upgrade`.

**5.1 Backup logic bằng mongodump (stack cũ vẫn đang chạy)**

```bash
install -d -m 700 backups                                     # thư mục 700: bảo vệ mọi file bên trong (backup chứa dữ liệu khách hàng)
( umask 077; docker exec realestate_mongo mongodump --archive --gzip > backups/pre-upgrade.archive.gz )   # standalone cũ không cần mật khẩu; ghi thẳng ra host, file quyền 600
ls -l backups/pre-upgrade.archive.gz                          # BẮT BUỘC thấy file > 0 byte, không thì DỪNG
# Kiểm NỘI DUNG (chỉ đọc, không ghi gì): phải thấy dòng có `realestate.users`; không thấy thì backup vô dụng, DỪNG
docker exec -i realestate_mongo mongorestore --dryRun -v --archive --gzip --nsInclude 'realestate.*' < backups/pre-upgrade.archive.gz 2>&1 | grep 'realestate.users'
# Ghi số document từng collection TRƯỚC nâng cấp, để 5.5 so sánh
docker exec realestate_mongo mongosh --quiet --eval 'const d = db.getSiblingDB("realestate"); d.getCollectionNames().sort().forEach(n => print(n + ": " + d.getCollection(n).countDocuments()))' > backups/counts-pre-upgrade.txt
cat backups/counts-pre-upgrade.txt
# Chép file ra NGOÀI máy chủ (scp/rclone) trước khi đi tiếp.
```

**5.2 Dừng stack cũ và sao nguyên volume (đường lui chính)**

```bash
# Volume PHẢI tồn tại: `docker run -v TÊN_SAI:/data` TỰ TẠO một volume rỗng rồi tar ra file rỗng vô nghĩa. Hai lệnh dưới phải thành công (không báo lỗi), không thì DỪNG
docker volume inspect "$VOL" >/dev/null
docker volume inspect realestatemanager_nine_router_data >/dev/null
docker compose --env-file .env.docker stop                   # KHÔNG dùng down -v (compose mới bắt buộc --env-file; dừng cả nine-router, volume giữ nguyên)
docker run --rm -v "$VOL":/data:ro -v "$PWD/backups":/backup alpine \
  tar czf /backup/mongo_data-pre-upgrade.tar.gz -C /data .
ls -l backups/mongo_data-pre-upgrade.tar.gz       # BẮT BUỘC thấy file > 0 byte (vài trăm KB trở lên với dữ liệu thật), không thì DỪNG
tar tzf backups/mongo_data-pre-upgrade.tar.gz | grep -m1 WiredTiger   # BẮT BUỘC in 1 dòng (dữ liệu Mongo thật); không in gì = sai volume, DỪNG
# Volume 9Router (stack đã dừng nên dữ liệu nhất quán): sao lưu TRƯỚC khi container 9Router được tạo lại ở 5.4b
docker run --rm -v realestatemanager_nine_router_data:/data:ro -v "$PWD/backups":/backup alpine \
  tar czf /backup/nine_router_data-pre-upgrade.tar.gz -C /data .
ls -l backups/nine_router_data-pre-upgrade.tar.gz # BẮT BUỘC > 0 byte, không thì DỪNG
tar tzf backups/nine_router_data-pre-upgrade.tar.gz | grep -vx './' | head -5   # phải thấy ít nhất 1 entry (theo README: ./db/data.sqlite); trống hẳn = sai volume, DỪNG
```

(File `.tar.gz` do container tạo thuộc root; thư mục `backups/` quyền 700 vẫn chặn người dùng khác. Đọc để chép ra ngoài máy cần `sudo`.)

**5.3 Bật replica set + tạo user root trên dữ liệu cũ (container tạm, chưa có auth)**

```bash
U=$(grep '^MONGO_ROOT_USERNAME=' .env.docker | cut -d= -f2-)
P=$(grep '^MONGO_ROOT_PASSWORD=' .env.docker | cut -d= -f2-)

# --hostname mongo: để host `mongo:27017` trong cấu hình replica set phân giải về chính node này
docker run -d --name realestate_mongo_upgrade --hostname mongo \
  -v "$VOL":/data/db mongo:7 mongod --replSet rs0 --bind_ip_all

# Chờ mongod sẵn sàng (tối đa ~60 giây); dừng nếu quá hạn
for i in $(seq 1 30); do
  docker exec realestate_mongo_upgrade mongosh --quiet --eval "db.hello().ok" 2>/dev/null | grep -q '^1$' && break
  sleep 2
done
docker exec realestate_mongo_upgrade mongosh --quiet --eval "db.hello().ok"   # phải in 1, nếu lỗi thì xem `docker logs realestate_mongo_upgrade` và DỪNG

# Mật khẩu root đi qua file env tạm quyền 600 + `docker exec --env-file`, KHÔNG dùng `-e P=...` (sẽ hiện trên `ps` của host)
ENVF=$(mktemp) && chmod 600 "$ENVF"
printf 'U=%s\nP=%s\n' "$U" "$P" > "$ENVF"                     # printf là builtin: không lên danh sách tiến trình
docker exec --env-file "$ENVF" realestate_mongo_upgrade mongosh --quiet --eval "
rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
while (!db.hello().isWritablePrimary) { sleep(500); }
db.getSiblingDB('admin').createUser({ user: process.env.U, pwd: process.env.P, roles: [{ role: 'root', db: 'admin' }] });
print(rs.status().members.map(m => m.name + ' ' + m.stateStr));
"
rm -f "$ENVF"; unset P
# Kỳ vọng: [ 'mongo:27017 PRIMARY' ]

docker exec realestate_mongo_upgrade mongosh --quiet --eval "try { db.adminCommand({ shutdown: 1 }) } catch (e) {}"
timeout 60 docker wait realestate_mongo_upgrade      # chờ mongod tắt hẳn (exit code 0)
docker rm -f realestate_mongo_upgrade
```

**5.4 Khởi động hạ tầng của stack mới (auth + keyFile + replica set), CHƯA khởi động backend**

```bash
docker compose --env-file .env.docker up -d mongo redis minio minio-init
docker compose --env-file .env.docker ps -a        # mongo phải "healthy" (PRIMARY); minio-init "Exited (0)" là bình thường
```

Container `realestate_mongo` cũ (đã `stop`) được compose tạo lại theo cấu hình mới; volume `mongo_data` giữ nguyên. Chỉ 4 service trên được khởi động: backend/frontend/cloudflared/nine-router **chưa** lên (xem lý do ở 5.4a).

**5.4a Chạy migration dữ liệu 005 rồi 006 (trước khi backend mới khởi động)**

Vì sao phải làm ở bước này:

- Backend mới **không khởi động** nếu còn tài khoản chưa migrate 005 (`UserRolesMigrationGuard`: code mới lọc theo `roles[]`/`teamIds[]`). Vì vậy 005 phải xong trước khi `backend` lên.
- Image backend production chỉ có `dist/` + `node_modules` production, **không có `ts-node` và không có `scripts/`**, nên không chạy migration bằng `docker exec` vào backend được. `scripts/run-migration.sh` dựng image tạm từ stage `builder` của `RealEstateBackendApp/Dockerfile`, chạy migration bằng `docker run --rm` trong network của compose.
- 006 cần Replica Set + transaction (đã có từ 5.3) và **xóa vĩnh viễn** khu vực cũ (không hoàn tác bằng script, chỉ khôi phục bằng backup).

```bash
# Dry-run trước (mặc định, không ghi gì), đọc kỹ số liệu
bash scripts/run-migration.sh 005
bash scripts/run-migration.sh 006

# Backup MỚI bằng mongodump theo mục 6 (khối "MongoDB"), NGAY trước khi --apply, rồi `ls -l` thấy > 0 byte.
# Script từ chối --apply nếu không có *.archive.gz trong ./backups/ mới hơn 60 phút (BACKUP_MAX_AGE_MINUTES),
# hoặc file đó hỏng/không phải dump của DB realestate (kiểm bằng gzip -t và mongorestore --dryRun, thấy realestate.users).

# Ghi thật: 005 TRƯỚC, rồi 006
bash scripts/run-migration.sh 005 --apply
bash scripts/run-migration.sh 005                          # dry-run lại: không còn tài khoản cần bổ sung
bash scripts/run-migration.sh 006 --apply --cleanup        # hỏi xác nhận (gõ XOA-KHU-VUC-CU); --cleanup xóa image tạm VÀ chạy `docker builder prune -f`

# Nếu KHÔNG dùng --cleanup (hoặc không chắc đã dọn): giải phóng build cache của lần build builder (~2.2 GB; `docker image rm` một mình
# KHÔNG giải phóng phần này, chỉ prune mới trả đĩa về mức ban đầu). Prune xóa mọi build cache không dùng nên build kế tiếp chậm hơn.
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^realestate-migrate:'   # nếu còn: docker image rm <tên:thẻ>
docker builder prune -f
```

**Về `--cleanup`:** nó xóa image tạm `realestate-migrate:<tag>` rồi chạy `docker builder prune -f`, và chạy **kể cả khi migration lỗi** (trong `trap` thoát). `docker builder prune -f` xóa **TOÀN BỘ** build cache không dùng (không chỉ phần của migration), nên bước 5.4b `up --build` ngay sau đó phải dựng lại từ đầu: chậm hơn và lại tốn đĩa cho build cache mới (xem "Kẹt đĩa" ở 5.4b). Không muốn vậy thì đừng dùng `--cleanup`, tự dọn bằng hai lệnh ở trên khi cần.

Ghi chú: script đọc `MONGO_ROOT_USERNAME`/`MONGO_ROOT_PASSWORD` từ `.env.docker` (phải quyền `600`), dựng `MONGODB_URI` vào file env tạm quyền 600 (xóa khi thoát; mật khẩu không nằm trên dòng lệnh, không hiện trên màn hình hay `ps` của host), tự tìm network `<project>_realestate_net` (ghi đè bằng `NETWORK=<tên>`). Cần trống >= 5 GB (`MIGRATE_MIN_FREE_GB`, ghi đè được): đã đo ở máy dev, build stage `builder` tốn ~3.75 GB (image ~2.2 GB + build cache ~2.2 GB); thiếu thì script dừng, in `docker system df` và gợi ý dọn (mục 5.7). Migration idempotent: chạy lại an toàn. Lần dựng image đầu mất vài phút. Cờ `--reconcile` của 005 (xem đầu file migration) script không bọc: nếu cần thì chạy tay theo hướng dẫn trong file đó.

Số đo thực tế từ lần nâng cấp 2026-11-02 trên VPS (PT-007) và cờ cần biết:

- **Thời gian:** dựng stage `builder` của migration mất **khoảng 13 phút** trên VPS (lần đầu, chưa có cache). Chạy trong `tmux`, đừng tưởng treo; các lần sau có cache nhanh hơn nhưng `docker builder prune -f` (kể cả qua `--cleanup`) xóa cache và đưa về ~13 phút.
- **Đĩa:** đáy dung lượng trống đã đo lúc `docker compose up --build` là **1,9 GB** (từ khoảng 4,0 GB trước đó, xem PT-006 và "Kẹt đĩa" ở 5.4b). Nhớ rằng stage builder riêng của migration tốn thêm ~3,75 GB: đừng chạy builder rồi `up --build` liền nhau khi đĩa còn dưới ngưỡng 5 GB.
- **Cờ `--yes` của `scripts/run-migration.sh`:** bỏ bước xác nhận gõ tay `XOA-KHU-VUC-CU` của **006 `--apply`**. Cần khi chạy **không có terminal** (`nohup`, cron, CI), vì thiếu terminal mà không có `--yes` thì script dừng với lỗi "006 --apply cần xác nhận". **Chỉ dùng khi Oniichan cho phép rõ ràng**: 006 xóa vĩnh viễn khu vực cũ (không hoàn tác bằng script). Ví dụ: `bash scripts/run-migration.sh 006 --apply --yes`. Không ảnh hưởng 005 (005 không có bước xác nhận gõ tay).
- **Từ v1.0.3 (PT-027):** migration **mới** (`007` trở đi) không chạy bằng script này mà bằng runner trong image backend (`node dist/migrations/cli.js`, collection `system`), do `deploy.sh` gọi (mục 11.1). Script này chỉ còn dùng cho 005 và 006 trên bản dữ liệu cũ (và các lần dựng lại từ đầu); runner không bao giờ tự chạy lại 002 đến 006.

**5.4b Khởi động phần còn lại (backend, frontend, cloudflared, nine-router)**

Kiểm tra TRƯỚC khi `up`:

```bash
grep -c '^CLOUDFLARE_TUNNEL_TOKEN=.\+' .env.docker       # phải in 1 (không in giá trị). 0 thì quay lại 5.0a (e): thiếu token thì compose báo lỗi và tunnel không lên
docker compose --env-file .env.docker config -q            # gồm cả biến bắt buộc NINE_ROUTER_INITIAL_PASSWORD
df -h . "$(docker info -f '{{.DockerRootDir}}')" 2>/dev/null   # xem dung lượng trống (đường dẫn Docker có thể cần sudo)
bash ops/check-disk.sh 5                               # thoát mã 1 nếu trống < 5 GB: `up --build` dựng backend (3 stage) + frontend, để lại image + build cache vài GB
docker builder prune -f                                    # nếu thiếu đĩa: dọn build cache trước (cũng dọn được sau migration 5.4a), rồi chạy lại dòng trên
```

**Kẹt đĩa (đã `docker builder prune -f` mà `check-disk.sh 5` vẫn báo thiếu):** nhu cầu đỉnh đã đo ở máy dev: dựng backend (3 stage) để lại ~+3.49 GB image, thêm frontend tổng ~+4.1 GB; riêng stage `builder` của migration ~+3.75 GB. **Số đo trên VPS thật (2026-11-02, PT-007):** lúc `up --build` dung lượng trống chạm **đáy 1,9 GB** (từ khoảng 4,0 GB); ở mức này Mongo/Docker ghi thêm đã có nguy cơ đầy đĩa, nên đừng hạ ngưỡng quá thấp. Chọn một trong các cách (theo thứ tự nên thử):

1. **Dọn thêm, an toàn:** `docker image prune -f` (image mồ côi); xóa **từng** image cũ cụ thể không còn dùng (`docker image ls`, rồi `docker image rm <tên:thẻ>`, gồm thẻ `realestate-migrate:*`, `realestatemanager-backend:pre-*` của các lần deploy cũ; GIỮ `*:pre-upgrade` nếu còn cần đường lui 5.8); dọn log/`backups/` cũ đã chép ra ngoài máy chủ. **Tuyệt đối KHÔNG** chạy `docker volume prune`, `docker system prune --volumes`, `docker volume rm` hay `docker compose down -v` (xóa dữ liệu `mongo_data`, `redis_data`, `minio_data`, `nine_router_data`), và **không** `docker image prune -a` (xóa cả image `*:pre-upgrade` của đường lui).
2. **Hạ ngưỡng CÓ Ý THỨC** khi đã thấy số liệu trống thật sự đủ cho nhu cầu đỉnh ~4.1 GB: `bash ops/check-disk.sh 4`, hoặc `MIGRATE_MIN_FREE_GB=4 bash scripts/run-migration.sh ...`. Ngưỡng 5 GB có dư an toàn; hạ xuống 4 là chấp nhận rủi ro đầy đĩa giữa chừng khi build.
3. **Dựng image ở máy khác** (CI hoặc máy dev) rồi đưa lên VPS (`docker save | docker load`, hoặc registry riêng); khi đó compose phải dùng image có sẵn thay vì `build` (cần sửa compose, báo kiến trúc/devops).

Đối chiếu một lần nữa service `nine-router` mới với ghi chép ở 5.0a (không có biến lạ bị bỏ sót). Rồi:

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps -a        # tất cả Up; mongo/redis/minio healthy
docker logs --tail 20 realestate_cloudflared       # thấy tunnel đã đăng ký kết nối; truy cập web qua domain OK
docker inspect realestate_9router --format '{{json .Mounts}}'    # phải có nine_router_data -> /app/data (dữ liệu 9Router còn nguyên)
# Backend tới được 9Router qua tên service (200 hoặc 401 đều chứng tỏ tới được; lỗi DNS/ECONNREFUSED là hỏng):
docker exec realestate_backend node -e "fetch('http://nine-router:20128/v1/models').then(r => console.log(r.status)).catch(e => { console.error(e.cause ? e.cause.code : e.message); process.exit(1); })"
```

Nếu `nine-router` đã tồn tại từ bản sửa tay (5.0a), compose tạo lại nó theo cấu hình mới (cùng tên container, volume giữ nguyên); 9Router gián đoạn ngắn lúc này.

**Thử nhanh một thao tác AI qua backend:** đăng nhập web admin, vào Cấu hình AI và tải danh sách model 9Router (hoặc chạy một thao tác AI thật, vd tóm tắt/tạo tin). Kỳ vọng không báo lỗi 401/5xx. Lỗi thì xem `docker logs --tail 50 realestate_9router realestate_backend`, đối chiếu lại biến ở 5.0a; **không** xóa volume `nine_router_data`.

**5.5 Kiểm tra dữ liệu**

```bash
# Mật khẩu root xác thực TRONG script qua biến môi trường của container (không có `-p ...` trên dòng lệnh)
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
print(rs.status().members.map(m => m.name + " " + m.stateStr));
EOF
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin > backups/counts-post-upgrade.txt <<'EOF'
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const d = db.getSiblingDB("realestate");
d.getCollectionNames().sort().forEach(n => print(n + ": " + d.getCollection(n).countDocuments()));
EOF
diff backups/counts-pre-upgrade.txt backups/counts-post-upgrade.txt   # chỉ nên khác ở collection do migration 006 đổi (`areas`) hoặc collection mới do backend tự tạo
docker logs --tail 50 realestate_backend            # không có lỗi kết nối Mongo/Redis/S3
```

So số document với bản trước nâng cấp (file `counts-pre-upgrade.txt` ở 5.1; `areas` đổi hợp lệ sau 006). Thử đăng nhập web admin, mở một khách hàng, tạo thử một thao tác ghi. Nếu dùng AI qua 9Router, kiểm tra `docker logs --tail 20 realestate_9router` và thử một thao tác AI.

**5.6 Đóng cổng cũ (đã xong khi dùng compose mới)**

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep 27017    # realestate_mongo chỉ hiện "27017/tcp", không có 0.0.0.0:27017
```

Nếu máy có firewall/NAT từng mở cổng 27017 ra ngoài, hãy đóng lại, và **đổi mọi mật khẩu/bí mật nếu nghi ngờ đã bị truy cập** (Mongo cũ không có xác thực). Runbook kiểm chỉ-đọc đầy đủ (trên VPS, trên máy ảo/NAT và từ bên ngoài): mục 13.2.

**5.7 Dọn sau khi ổn định (sau vài ngày)**

Giữ `backups/` cho đến khi chắc chắn; không xóa volume nào. Khi hết nhu cầu đường lui 5.8:

```bash
# Xóa bản sao chứa bí mật nằm ngoài repo (token Cloudflare, mật khẩu 9Router...): CHỈ sau khi tunnel đã chạy ổn
shred -u ~/deploy.sh.old ~/docker-compose.pre-upgrade.yml ~/env.docker.pre-upgrade

# Dọn image dự phòng và image migration (tốn dung lượng: image builder vài GB). Xem danh sách TRƯỚC rồi xóa từng cái:
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^(realestatemanager-(backend|frontend):pre-|realestate-migrate:)'
docker image rm <tên:thẻ>            # lặp cho từng dòng cần xóa (KHÔNG xóa :latest đang chạy)
docker image prune -f                # image mồ côi (dangling)
docker builder prune -f              # build cache (thường chiếm nhiều nhất: ~2.2 GB cho mỗi lần build builder); image rm KHÔNG giải phóng phần này
```

Nếu `~/9router.*.txt/json` và `~/pre-upgrade.images` không còn cần đối chiếu thì xóa luôn (không chứa bí mật).

**5.8 Đường lui (nếu bước 5.4, 5.4a, 5.4b hoặc 5.5 thất bại)**

> Chưa kiểm chứng trên server thật (khối lệnh 5.8.3 đã thử logic chặn trong container cô lập với `docker` giả: thiếu `CUR`, thiếu file, file hỏng, volume không tồn tại đều dừng TRƯỚC khi xóa gì). **Khối lệnh xóa volume (5.8.3) chỉ chạy khi cả hai file backup ở 5.8.2 và 5.2 tồn tại, > 0 byte và đọc được trọn bằng `tar tzf`.** Không chạy từng dòng rời rạc.

| Tình huống | Cách |
|---|---|
| Chưa có dữ liệu mới, muốn về đúng trạng thái trước nâng cấp | 5.8.1 + 5.8.2 + 5.8.3 |
| Có dữ liệu mới và muốn giữ | Trước 5.8.1, khi stack mới còn chạy: `mongodump` từ stack mới (mục 6); sau 5.8.3 dùng `mongorestore` phần mới |
| Chỉ hỏng vài collection | Không cần đường lui: `mongorestore --nsInclude` từ `backups/pre-upgrade.archive.gz` (mục 6; luôn kèm `--nsInclude 'realestate.*'`) |

**Phạm vi:** 5.8 (khôi phục volume) chỉ dành cho sự cố **ngay sau lần nâng cấp standalone này**: nó đưa cả DB về đúng ngày nâng cấp, mất mọi dữ liệu phát sinh sau đó. Các lần deploy thường lệ về sau (mục 11) KHÔNG dùng 5.8; sự cố dữ liệu lúc đó chỉ xử lý bằng `mongorestore` từ file `backups/deploy-pre-*` (mục 6).

Đường lui dựng lại đúng stack CŨ (có 9Router sửa tay) từ **compose cũ và image cũ đã lưu ở 5.0a** (`~/docker-compose.pre-upgrade.yml`, thẻ `*:pre-upgrade`), không dùng `git checkout` về commit cũ (compose của commit cũ không có `nine-router`, và nó sẽ build lại bằng mã nguồn mới).

**5.8.1 Dừng stack mới (không `-v`)**

```bash
docker compose --env-file .env.docker down
```

(`down` xóa container, gồm cả `realestate_9router`; volume `nine_router_data` vẫn còn, 5.8.3 dựng lại container từ compose cũ.)

**5.8.2 Sao lưu volume ở trạng thái HIỆN TẠI (sau nâng cấp) TRƯỚC khi xóa bất cứ thứ gì**

```bash
CUR="mongo_data-post-upgrade-$(date +%F-%H%M).tar.gz"
docker run --rm -v "$VOL":/data:ro -v "$PWD/backups":/backup alpine   tar czf "/backup/$CUR" -C /data .
ls -l "backups/$CUR" backups/mongo_data-pre-upgrade.tar.gz     # CẢ HAI phải thấy file > 0 byte, không thì DỪNG
```

Giữ nguyên shell này cho 5.8.3 (biến `CUR` và `VOL` phải còn). Mở shell mới thì đặt lại `VOL=...` và `CUR=<tên file post-upgrade vừa tạo>` trước khi chạy 5.8.3; thiếu một trong hai là khối dưới dừng ngay.

**5.8.3 Khôi phục về trạng thái trước nâng cấp (chỉ khi 5.8.2 đủ điều kiện)**

```bash
(
  set -euo pipefail                                   # chạy trong subshell: lỗi thì dừng khối này, không đóng shell của bạn
  : "${VOL:?VOL chưa đặt (xem 5.0): dừng, chưa xóa gì}"
  : "${CUR:?CUR chưa đặt (xem 5.8.2): dừng, chưa xóa gì}"
  PRE=backups/mongo_data-pre-upgrade.tar.gz
  OLD_COMPOSE="$HOME/docker-compose.pre-upgrade.yml"

  # --- Kiểm tra TRƯỚC KHI xóa bất cứ thứ gì ---
  docker volume inspect "$VOL" >/dev/null || { echo "VOL='$VOL' không phải volume có thật: dừng"; exit 1; }
  for f in "backups/$CUR" "$PRE"; do
    [ -f "$f" ] && [ -s "$f" ] || { echo "THIẾU hoặc RỖNG: $f: dừng"; exit 1; }
    tar tzf "$f" >/dev/null || { echo "HỎNG (tar không đọc được trọn): $f: dừng"; exit 1; }
    [ -n "$(tar tzf "$f" | grep -m1 WiredTiger || true)" ] || { echo "KHÔNG thấy file WiredTiger trong $f (không phải dữ liệu Mongo?): dừng"; exit 1; }
  done
  [ -f "$OLD_COMPOSE" ] || { echo "THIẾU $OLD_COMPOSE (bản compose cũ lưu ở 5.0a): dừng"; exit 1; }
  IMAGES="$HOME/pre-upgrade.images"                   # tên image do 5.0a (c) ghi: dùng chung đúng các tên đó
  [ -s "$IMAGES" ] || { echo "THIẾU $IMAGES (ghi ở 5.0a (c)): dừng"; exit 1; }
  # phải có ĐỦ cả backend và frontend (file 1 dòng hoặc thiếu dịch vụ nghĩa là chỉ dựng lại được một nửa stack): dừng TRƯỚC khi xóa gì
  { grep -q '^backend ' "$IMAGES" && grep -q '^frontend ' "$IMAGES" && [ "$(wc -l < "$IMAGES")" -ge 2 ]; } || { echo "$IMAGES phải có đủ 2 dòng (backend và frontend): dừng, chưa xóa gì"; exit 1; }
  while read -r svc img; do
    docker image inspect "$img:pre-upgrade" >/dev/null || { echo "THIẾU image $img:pre-upgrade ($svc, gắn ở 5.0a): dừng"; exit 1; }
  done < "$IMAGES"

  # --- Khôi phục volume Mongo về trước nâng cấp ---
  docker volume rm "$VOL"
  docker volume create "$VOL"      # compose có thể cảnh báo "volume ... was not created by compose": vô hại
  docker run --rm -v "$VOL":/data -v "$PWD/backups":/backup:ro alpine tar xzf /backup/mongo_data-pre-upgrade.tar.gz -C /data

  # --- Dựng lại stack CŨ từ compose cũ + image cũ (không build, không đụng git) ---
  while read -r svc img; do
    docker tag "$img:pre-upgrade" "$img:latest"
  done < "$IMAGES"
  docker compose --project-directory "$PWD" -f "$OLD_COMPOSE" --env-file .env.docker up -d --no-build
)
```

Ghi chú: `--project-directory "$PWD"` giữ project là `realestatemanager` (nếu không, project bị đặt theo thư mục chứa file `-f` và tạo ra bộ volume/network mới). Compose cũ gồm cả service `nine-router` sửa tay, nên 9Router được dựng lại trên volume `nine_router_data` còn nguyên. Backend cũ cần dòng `MONGODB_URI` cũ trong `.env.docker` (xem ghi chú 5.0a). Kiểm tra bằng `docker compose --project-directory "$PWD" -f ~/docker-compose.pre-upgrade.yml --env-file .env.docker ps`, đăng nhập web và so số document với `backups/counts-pre-upgrade.txt`.

Repo vẫn ở commit mới (không đụng git). Muốn nâng cấp lại: xử lý nguyên nhân thất bại, đưa volume về trạng thái standalone (vừa làm xong), rồi làm lại từ 5.2.

## 6. Backup và restore

> **Chạy trên server Linux (bash) hoặc WSL, KHÔNG dùng Git Bash trên Windows** (MSYS đổi đường dẫn, mount `-v "$PWD/..."` hỏng, file backup có thể không xuất hiện). **Sau mỗi bước backup phải `ls -l` thấy file > 0 byte mới đi tiếp.**

> **Named volume KHÔNG phải backup.** Nó nằm trên cùng ổ đĩa với máy chủ và bị xóa bởi `docker compose down -v` hoặc `docker volume rm`. Mọi bản sao lưu phải được chép ra **ngoài máy chủ** (máy khác, rclone/S3 khác, ổ ngoài).

| Dữ liệu | Mức quan trọng | Phương pháp |
|---|---|---|
| MongoDB | Cao nhất | `mongodump` hằng ngày |
| MinIO (`crm-attachments`) | Cao | `mc mirror` hằng ngày |
| MinIO (`crm-exports`) | Thấp (tự xóa sau 7 ngày, tạo lại được) | Có thể bỏ qua |
| Redis | Phụ (queue nhắc việc + idempotency, tạo lại được) | Sao chép AOF, không bắt buộc |
| 9Router (`nine_router_data`) | Trung bình (cấu hình provider/tài khoản; mất thì phải cấu hình lại) | `tar` volume giống 5.2: `docker run --rm -v realestatemanager_nine_router_data:/data:ro -v "$PWD/backups":/backup alpine tar czf /backup/nine_router_data.tar.gz -C /data .` rồi `ls -l` > 0 byte |
| `CRM_PII_ENCRYPTION_KEY`, `.env` | Cao | Lưu ở secret manager, tách khỏi máy chủ |

```bash
install -d -m 700 backups; D=backups/$(date +%F); install -d -m 700 "$D"      # thư mục 700 (backup chứa dữ liệu khách hàng)

# MongoDB (đã chạy thử trong container Mongo cô lập). Mật khẩu root đọc từ biến môi trường TRONG container và đưa cho
# mongodump qua pipe `--config <(...)`: không nằm trên dòng lệnh (không lộ trên `ps` của host), không ghi ra đĩa. File ghi thẳng ra host, quyền 600.
( umask 077; docker exec realestate_mongo bash -c 'mongodump --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --db realestate --archive --gzip' > "$D"/mongo.archive.gz )
ls -l "$D"/mongo.archive.gz                                  # phải > 0 byte, không thì DỪNG
# Kiểm NỘI DUNG (chỉ đọc, `--dryRun`): phải thấy dòng `archive prelude `realestate.users``, không thì backup vô dụng, DỪNG
docker exec -i realestate_mongo bash -c 'mongorestore --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --dryRun -v --archive --gzip --nsInclude "realestate.*" 2>&1' < "$D"/mongo.archive.gz | grep 'realestate.users'

# MinIO: mirror bucket ra thư mục (đã chạy thử). Cần S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY trong shell:
export S3_ACCESS_KEY_ID=$(grep '^S3_ACCESS_KEY_ID=' .env | cut -d= -f2-)
export S3_SECRET_ACCESS_KEY=$(grep '^S3_SECRET_ACCESS_KEY=' .env | cut -d= -f2-)
NET=$(docker inspect realestate_minio --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker run --rm --network "$NET" --user "$(id -u):$(id -g)" --entrypoint sh \
  -e S3_ACCESS_KEY_ID -e S3_SECRET_ACCESS_KEY -e MC_CONFIG_DIR=/tmp/.mc \
  -v "$PWD/$D":/backup cgr.dev/chainguard/minio:latest -c '
  mc alias set local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
  mc mirror --overwrite local/crm-attachments /backup/crm-attachments'
du -sh "$D"/crm-attachments; find "$D"/crm-attachments -type f | head -3   # phải thấy thư mục và file (nếu bucket có ảnh)

# Redis (phụ): ép lưu rồi chép thư mục /data (AOF + RDB)
L=$(docker exec realestate_redis redis-cli lastsave)
docker exec realestate_redis redis-cli bgsave
# Chờ bgsave xong (LASTSAVE đổi), tối đa ~60 giây, rồi mới sao chép
for i in $(seq 1 60); do
  [ "$(docker exec realestate_redis redis-cli lastsave)" != "$L" ] && break
  sleep 1
done
docker cp realestate_redis:/data "$D"/redis-data
ls -l "$D"/redis-data

# Chép "$D" ra ngoài máy chủ, ví dụ: rclone copy "$D" remote:rem-backups/$(date +%F)
```

Khuyến nghị lịch: cron hằng ngày (đêm), giữ 14 bản ngày + 8 bản tuần, **thử khôi phục định kỳ** vào một máy khác.

Về mật khẩu trên dòng lệnh: các lệnh Mongo trong tài liệu này dùng pipe/biến môi trường/stdin nên mật khẩu root không nằm trên dòng lệnh (không lộ trên `ps` của host). **Healthcheck Mongo (PT-002, đã sửa trong repo):** healthcheck của service `mongo` không còn truyền `-p` trên dòng lệnh; nó xác thực **trong script** `mongosh` bằng `db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)` rồi mới `rs.status()`/`rs.initiate` (idempotent, chỉ khởi tạo khi `NotYetInitialized`), và chỉ trả healthy khi là PRIMARY. Nhánh `NotYetInitialized` vẫn đúng vì user root do initdb tạo (từ `MONGO_INITDB_ROOT_*`) **trước** khi mongod thật khởi động, nên lúc replica set chưa khởi tạo vẫn xác thực được (đúng như bản cũ dùng `-u/-p`). Hiệu lực khi container `mongo` được tạo lại bằng compose mới; **chưa kiểm trên volume/VPS thật** (xem phần việc của Oniichan: sau deploy, `docker inspect realestate_mongo --format '{{.State.Health.Status}}'` phải ra `healthy`, và `for i in 1 2 3 4 5 6; do docker top realestate_mongo | grep -c -- ' -p '; sleep 3; done` phải toàn `0`: không còn tiến trình mongosh mang `-p`; chỉ đếm, không in dòng lệnh). `redis-cli` dùng `REDISCLI_AUTH` nên chưa từng bị.

Restore:

```bash
# MongoDB (đã chạy thử trong container Mongo cô lập). LUÔN kèm --nsInclude 'realestate.*': file `pre-upgrade.archive.gz` (5.1) là dump
# TOÀN instance (có cả DB admin, user/role): không giới hạn namespace thì --drop có thể ghi đè cả DB admin. Chạy --dryRun -v trước để xem sẽ nạp gì.
# --drop xóa collection hiện có trước khi nạp: chỉ dùng khi thực sự muốn ghi đè. Archive đọc từ stdin (không cần docker cp, không file tạm trong container).
docker exec -i realestate_mongo bash -c 'mongorestore --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --archive --gzip --drop --nsInclude "realestate.*"' < "$D"/mongo.archive.gz

# MinIO: mirror ngược (đã chạy thử), dùng cùng lệnh docker run ở trên, thay dòng mc mirror bằng:
#   mc mirror --overwrite /backup/crm-attachments local/crm-attachments
```

### 6.1. Khôi phục DB + image về bản trước deploy bằng `restore.sh`

Mỗi lần `deploy.sh` chạy (trừ `--plan-only`) để lại trong `backups/` một **bộ** cùng thời gian `<TS>`: dump DB (`deploy-pre-<TS>.archive.gz`), bản sao `.env` (`deploy-pre-<TS>.env`, quyền 600), **manifest v2** (`deploy-pre-<TS>.manifest`, mục 11.8) và hai thẻ image cục bộ `realestatemanager-backend:pre-<TS>`, `realestatemanager-frontend:pre-<TS>` (chính là image **đang chạy ngay trước** lần deploy đó). `restore.sh` đọc manifest rồi đưa **cả DB lẫn image** về đúng thời điểm đó, thay cho việc gõ tay các lệnh ở trên. Không còn khôi phục "code" bằng git: code là image, VPS không có git.

```bash
bash restore.sh --list                         # liệt kê các manifest (chỉ đọc, không cần Docker)
bash restore.sh --latest                       # DRY-RUN mặc định: kiểm điều kiện, in kế hoạch + cảnh báo, KHÔNG đổi gì
bash restore.sh --manifest backups/deploy-pre-<TS>.manifest            # dry-run một bản cụ thể
bash restore.sh --manifest backups/deploy-pre-<TS>.manifest --apply --yes   # THỰC SỰ khôi phục
```

| Tùy chọn | Ý nghĩa |
|---|---|
| `--list` / `--latest` / `--manifest <file>` | Chọn bản khôi phục (đúng một). `--manifest` chỉ nhận file nằm trong thư mục backup. |
| `--apply --yes` | Bắt buộc **cả hai** mới chạy thật. Thiếu `--yes` thoát mã 2. **Không có biến môi trường thay `--yes`.** |
| `--db-only` | Chỉ nạp lại DB, **không đổi thẻ image** (`current` giữ nguyên). Dùng cho bản `backup.sh --no-image` (không có thẻ `pre-<TS>`). |
| `--skip-safety-db` | (cùng `--apply --yes`) **Không dump lại** DB hiện tại. Dùng khi **chạy lại** sau lần restore bị ngắt giữa `mongorestore`: lúc đó DB dở dang (không còn `users`) nên không dump an toàn được. Chốt chặn (sai một điều kiện là `[HỎNG]`, `--apply` dừng, chưa đổi gì): (a) backup an toàn **mới nhất** `restore-safety-*.archive.gz` phải còn nguyên (> 0 byte, `gzip -t`, `mongorestore --dryRun` thấy `realestate.users`); (b) DB hiện tại phải **thật sự dở dang**: không có collection `users` nhưng có collection khác có dữ liệu. DB khỏe (có `users`) thì cờ bị từ chối (phải dump an toàn mới để không mất dữ liệu hiện có); DB trống thì không cần cờ. |

Cờ khác bị từ chối với mã 2. Các cờ khôi phục code bằng git của bản cũ (`--code-only`, `--use-image-tag`, `--allow-infra-change`) **đã bỏ ở v1.0.6**: không còn bundle/thẻ git, và đặt lại image `pre-<TS>` thành `current` là hành vi **mặc định** (bảng ở mục 0.6).

**Kiểm tiền điều kiện (dry-run và đầu `--apply`, chưa đổi gì).** Manifest phải là **v2** (manifest v1 từ trước v1.0.6 bị từ chối kèm hướng dẫn thủ công); file dump còn nguyên (> 0 byte, `gzip -t`, thấy `realestate.users`); hai thẻ `pre-<TS>` còn trên VPS (trừ `--db-only`); khóa `.deploy.lock` rảnh (không chạy chồng với `deploy.sh`/`backup.sh`); đủ dung lượng đĩa.

**Thứ tự khi `--apply --yes`:** (1) **dừng backend** (để không còn ai ghi DB trong lúc dump); (2) **backup an toàn trạng thái hiện tại**: `mongodump` ra `backups/restore-safety-<RTS>.archive.gz` và gắn thẻ image `pre-restore-<RTS>` cho image đang chạy; lỗi hoặc bị ngắt ở bước 1-2 thì dữ liệu chưa đổi, script **tự bật lại backend** rồi thoát; (3) `dropDatabase realestate` rồi `mongorestore --drop --nsInclude 'realestate.*'` từ dump trong manifest (mật khẩu root chỉ qua pipe/biến môi trường trong container); (4) `docker tag <name>:pre-<TS> <name>:current` cho backend và frontend (bỏ qua với `--db-only`); (5) `docker compose up -d --no-build --no-deps backend frontend`; (6) chờ Mongo healthy và backend liveness; (7) kiểm lại: version trong `system` khớp `DB_VERSION_BEFORE` và image đang chạy khớp `pre-<TS>` của manifest. Từ bước 3 trở đi **không có auto-rollback**.

Cần biết:

- **Sau restore, `release.env` vẫn là bản MỚI** (cái vừa bị lùi). Chạy lại `deploy.sh` (hoặc `release.sh send` với cùng gói) sẽ triển khai lại đúng bản lỗi đó. Muốn dừng ở bản cũ thì **không deploy** cho tới khi có bản vá (build lại từ máy build, gói mới ghi đè `release.env`). `restore.sh` in lại cảnh báo này khi xong.
- **Cảnh báo ĐỎ "bước 90 một chiều".** Nếu manifest ghi `POST_UP_REACHED=1` (deploy đó đã tới sau `up`, nơi migration 011 một chiều chạy), restore DB về dump trước deploy là **mất mọi dữ liệu sau thời điểm dump** và là đường quay lại **duy nhất** (mục 11, ngoại lệ 011). Script in cảnh báo đỏ; đọc kỹ trước khi thêm `--yes`.
- **Dừng giữa chừng KHÔNG tự rollback.** Lỗi (hoặc `SIGTERM`/`SIGINT`/`SIGHUP`, thoát mã 143/130/129) từ bước 3 trở đi thì script in "RESTORE DỪNG GIỮA CHỪNG" kèm trạng thái và việc cần làm tiếp (bản an toàn `restore-safety-<RTS>` và thẻ `pre-restore-<RTS>` để quay lại), rồi thoát mã khác 0. **Chạy lại sau khi `mongorestore` bị ngắt:** DB đang dở dang nên bước dump an toàn từ chối; chạy lại đúng lệnh cũ kèm `--skip-safety-db` (dùng bản an toàn của lần trước).
- **Quay lại sau một lần restore sai:** nạp `backups/restore-safety-<RTS>.archive.gz` (cùng cách `mongorestore` ở đầu mục 6, luôn kèm `--nsInclude 'realestate.*'`) và đặt `realestatemanager-<backend|frontend>:pre-restore-<RTS>` thành `current` bằng `docker tag`, rồi `docker compose up -d --no-build --no-deps backend frontend`.
- Chạy từ **bản sao ngoài thư mục deploy** (khi thư mục deploy sắp bị thay, ví dụ lúc đang cài gói mới) và trỏ `RESTORE_REPO_DIR` về thư mục deploy:
  ```bash
  mkdir -p /tmp/rt/ops && cp restore.sh /tmp/rt/ && cp -r ops/lib /tmp/rt/ops/
  RESTORE_REPO_DIR="$PWD" bash /tmp/rt/restore.sh --manifest backups/deploy-pre-<TS>.manifest --apply --yes
  ```
  Thư viện lấy từ `ops/lib/` cạnh bản sao (giữ cấu trúc `<bản-sao>/restore.sh` + `<bản-sao>/ops/lib/`); thư mục đích là `RESTORE_REPO_DIR` (mặc định: thư mục chứa `restore.sh`).
- **Ghi chú đường dẫn cũ (v1.0.6):** từ v1.0.6 `backup.sh`, `restore.sh` nằm ở gốc thư mục deploy (cùng chỗ với `deploy.sh`), phần phụ trợ ở `ops/` (`ops/lib/`, `ops/tests/`, `ops/check-disk.sh`, `ops/print-image-digests.sh`, `ops/staging.sh`); `scripts/` chỉ còn `run-migration.sh` và `post-migrate/*`. **Manifest và bản sao `restore.sh` tạo trước v1.0.6 vẫn chứa/in đường dẫn cũ `scripts/...`**: chỉ là chuỗi hướng dẫn; khi cần chạy lại restore hãy dùng đường dẫn mới ở trên. Manifest v1 (trước v1.0.6) không dùng được với `restore.sh` mới: khôi phục DB từ file dump của nó bằng tay (lệnh ở đầu mục 6).
- **Chọn manifest khi một lần deploy bị chạy lại (retry).** Mỗi lần chạy `deploy.sh` tạo một manifest riêng (TS khác nhau). Lần A lỗi rồi chạy lại thành lần B: manifest A giữ **trạng thái thật trước deploy** (dump DB và image trước khi đụng gì), còn manifest B ghi trạng thái ngay trước lần thử cuối (có thể đã dính thay đổi dở dang của A). `--latest` đưa về **ngay trước lần thử cuối (B)**; muốn về trạng thái trước deploy thì `--list` rồi chọn manifest A bằng `--manifest`. `--latest` tự **bỏ qua manifest không có backup Mongo** (có cảnh báo; `--list` đánh dấu "KHÔNG CÓ"); không còn manifest nào có backup thì dừng, hãy chọn tay bằng `--manifest`. **`--latest` chọn theo tên (thời gian) mới nhất, KỂ CẢ bản thủ công của `backup.sh` (mục 6.2) mới hơn bản trước deploy**: luôn đọc dòng `--latest: dùng <manifest>` trước khi thêm `--apply --yes`.
- Deploy cũ (trước manifest v2) **không dùng được với `restore.sh`**: dùng lệnh thủ công ở đầu mục 6 và mục 11 (L1/L3).
- Staging dùng đúng hợp đồng biến môi trường như `deploy.sh` (`MONGO_CONTAINER`, `BACKEND_CONTAINER`, ...).
- Kiểm trên Windows chỉ qua stub (không có Docker/Mongo/`flock` thật); lần đầu dùng trên server, chạy **dry-run** và diễn tập ở staging (mục 11.3) trước.

### 6.2. Backup thủ công bằng `backup.sh` (ngoài lần deploy)

**Quan hệ với `deploy.sh`.** `deploy.sh` **vẫn tự backup trước mỗi lần deploy** (bộ ở 6.1), không gọi `backup.sh`. `backup.sh` là **bản chạy tay độc lập**, cùng định dạng file (archive, manifest v2, thẻ image) nên `restore.sh` đọc được; hai script chỉ dùng chung thư viện `ops/lib/ops-common.sh` và khóa `.deploy.lock` ở thư mục deploy (không chạy chồng với `deploy.sh`/`restore.sh`).

**Khi nào dùng:** trước khi sửa tay trên máy chủ (đổi dữ liệu, chạy migration/CLI bằng tay, nâng Mongo), hoặc muốn một điểm khôi phục ngoài chu kỳ deploy. **Không** dùng thay cho backup định kỳ ra ngoài máy chủ.

```bash
bash backup.sh                 # đủ bộ: DB + manifest + thẻ image `pre-<TS>` của backend và frontend đang chạy
bash backup.sh --db-only       # chỉ mongodump (KHÔNG manifest, KHÔNG thẻ image)
bash backup.sh --no-image      # bỏ thẻ image (restore.sh sau đó chỉ dùng được với --db-only)
bash backup.sh --help
```

| Tùy chọn | Ý nghĩa |
|---|---|
| (mặc định) | Tạo `backups/deploy-pre-<TS>.archive.gz`, `deploy-pre-<TS>.manifest` (v2) và hai thẻ image `<project>-backend:pre-<TS>`, `<project>-frontend:pre-<TS>` gắn vào image **đang chạy** của hai container. Manifest có `BACKUP_KIND=manual`, `DEPLOY_STATUS=succeeded`, `STACK_TOUCHED=1`, `POST_UP_REACHED=0`. Không có bundle hay thẻ git (VPS không có git). |
| `--db-only` | Chỉ dump DB đã kiểm nội dung. **Không ghi manifest và không gắn thẻ image**, nên bản này **không hiện trong `restore.sh --list/--latest`**: khôi phục **bằng tay** (lệnh mẫu bên dưới). |
| `--no-image` | Không gắn thẻ image (cũng tự bỏ qua nếu chưa có container). `restore.sh` từ manifest đó chỉ chạy được với `--db-only`. |

Cờ khác (kể cả `--code-only` cũ) thoát mã 2. Mã thoát: `0` ok | `1` lỗi (gồm `--db-only` khi DB trống, file/manifest trùng, Mongo tắt khi cần DB) | `2` sai tham số | `143`/`130`/`129` bị ngắt (`SIGTERM`/`SIGINT`/`SIGHUP`). Lỗi hoặc bị ngắt giữa chừng: script **xóa các file/thẻ image vừa tạo ở lần chạy đó** (không đụng bản cũ), không có manifest mồ côi.

Khác với `deploy.sh`:

- Không build, không `up`, không migrate, không dừng container: **chỉ đọc** DB và trạng thái container rồi ghi vào `backups/`.
- DB trống (không `users`, không dữ liệu): mặc định **bỏ qua DB**; với `--db-only` thì lỗi. DB dở dang (không `users` nhưng có dữ liệu) thì lỗi (không có gì dump hợp lệ để dùng).
- `POST_UP_REACHED=0`: manifest mô tả "trạng thái hiện tại", không phải "trước một deploy".

Khôi phục từ bản `--db-only` (không có manifest), chạy trên máy chủ Linux, **sau khi đã có dry-run `--dryRun -v` xem sẽ nạp gì**:

```bash
F=backups/deploy-pre-<TS>.archive.gz     # nhớ ls -l thấy > 0 byte
docker exec -i realestate_mongo bash -c 'mongorestore --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --archive --gzip --dryRun -v --nsInclude "realestate.*"' < "$F"
# Hợp lý rồi mới ghi thật (--drop xóa collection hiện có trước khi nạp; backend nên dừng trong lúc nạp: docker compose stop backend)
docker exec -i realestate_mongo bash -c 'mongorestore --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --archive --gzip --drop --nsInclude "realestate.*"' < "$F"
```

Biến môi trường tùy chọn (không bí mật; nguồn: `backup.sh`, `ops/lib/ops-common.sh`):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DUMP_TIMEOUT` | `900` | Số giây tối đa cho `mongodump`; quá hạn thì lỗi "mongodump quá ... s" (mã 1, dọn file `.partial`). Tăng khi DB lớn. Phải là số nguyên. |
| `OPS_EXEC_TIMEOUT` | `300` | Số giây tối đa cho các lệnh `docker exec` kiểm tra (đọc version/collection, `mongorestore --dryRun` kiểm nội dung dump). Phải là số nguyên. |
| `BACKUP_MIN_FREE_GB` | `2` | Dung lượng trống tối thiểu (GB) ở thư mục deploy và thư mục dữ liệu Docker; thiếu thì dừng, chưa tạo gì. Phải là số. |
| `MONGO_CONTAINER`, `BACKEND_CONTAINER`, `FRONTEND_CONTAINER` | `realestate_mongo`, `realestate_backend`, `realestate_frontend` | Tên container (chỉ đổi khi thử nghiệm). |

Giới hạn cần biết:

- Dump **không dùng `--oplog`** và **không dừng backend**: ghi đồng thời trong lúc dump có thể làm dump không nhất quán giữa các collection. **Chạy lúc ít tải** (hoặc dừng backend trước nếu cần điểm nhất quán tuyệt đối).
- `SIGTERM`/`SIGINT`/`SIGHUP` được xử lý **sau khi lệnh con đang chạy** (`mongodump`, `docker exec`) kết thúc hoặc hết `DUMP_TIMEOUT`: dừng giữa lúc dump có thể phải chờ; sau đó script mới dọn file/thẻ image vừa tạo và thoát 143/130/129. Nếu bắt buộc dừng ngay (`kill -9`) thì dọn tay `backups/*.partial` và thẻ image `pre-<TS>` dở dang.
- Tất cả-hoặc-không: nếu bước gắn thẻ image hoặc ghi manifest lỗi **sau khi** dump DB đã xong, script xóa luôn file dump vừa tạo ở lần chạy đó (exit 1). Cần giữ riêng bản DB thì chạy lại `backup.sh --db-only` sau khi sửa nguyên nhân.
- File nằm cùng ổ đĩa với máy chủ **không phải backup thật**: chép `backups/` (archive, `.env` sao, manifest) ra **ngoài máy chủ** (`scp`/`rclone`) như mục 6.
- Kiểm trên Windows chỉ qua stub (không có Docker/Mongo/`flock` thật); lần đầu dùng trên server, chạy rồi kiểm `ls -l backups/` và `bash restore.sh --list` (dry-run) trước khi tin cậy.

### 6.3. Chính sách dọn thẻ `pre-*` (khuyến nghị, chưa có script)

Mỗi `deploy.sh` thêm hai thẻ image `pre-<TS>` (backend + frontend), mỗi `backup.sh` đủ bộ thêm hai thẻ nữa, mỗi `restore.sh --apply` thêm hai thẻ `pre-restore-<RTS>`. Image cũ là **đường lùi**, nhưng cũng chiếm đĩa (`deploy.sh` và `restore.sh` kiểm dung lượng trước khi chạy). Chưa có script dọn tự động; làm tay theo quy tắc:

- **Giữ** thẻ `pre-*` của **3 lần deploy gần nhất** và mọi thẻ còn được manifest mới nhất tham chiếu (`PRE_TAG`, `BACKEND_PRE_IMAGE`, `FRONTEND_PRE_IMAGE`). Giữ cả `pre-restore-*` của lần restore gần nhất cho tới khi chắc chắn không cần quay lại.
- **Xóa** phần cũ hơn, **từng thẻ một**, kèm xóa bộ `backups/deploy-pre-<TS>.*` tương ứng (manifest mà thiếu thẻ thì `restore.sh` dừng ở bước kiểm, không đổi gì). Thẻ `<version>-<commit>` của bản **đang chạy** (và bản ngay trước) thì không xóa.
- Liệt kê: `docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^realestatemanager-(backend|frontend):(pre-|[0-9])'` (và `realestate-migrate:*` nếu dùng `scripts/run-migration.sh` không kèm `--cleanup`). Xóa: `docker image rm <repo>:<tag>` (xóa theo **thẻ** chỉ gỡ thẻ nếu image còn thẻ khác; layer chung được giữ).
- **Cấm** `docker image prune -a` và `docker system prune`: xóa luôn image không có container dùng, gồm toàn bộ thẻ đường lùi và bản đã nạp chờ deploy. Chỉ `docker image prune -f` (image không có thẻ, dangling) là an toàn.
- Dọn `backups/` ngoài việc trên: giữ theo lịch ở mục 6 (14 bản ngày + 8 bản tuần, đã chép ra ngoài máy chủ).

## 7. Kiểm tra sức khỏe

```bash
docker compose ps -a
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'   # [ 'mongo:27017 PRIMARY' ]  (mật khẩu xác thực trong script, không có -p trên dòng lệnh)
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
print(rs.status().members.map(m => m.name + " " + m.stateStr));
EOF
docker exec realestate_redis redis-cli ping                                                       # PONG
docker exec realestate_redis redis-cli config get maxmemory-policy                                # noeviction
docker exec realestate_minio sh -c 'MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@localhost:9000" mc ready local'
docker exec realestate_minio sh -c 'MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@localhost:9000" mc ilm rule ls local/crm-exports'   # 1 rule, 7 ngày
docker exec realestate_minio sh -c 'MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@localhost:9000" mc ls local'                          # đúng 2 bucket: crm-attachments, crm-exports (S3_BUCKET_EXPORTS đúng `crm-exports`, mục 2)
docker inspect realestate_backend --format '{{.State.Health.Status}}'                             # healthy (healthcheck liveness, mục 7.1)
docker ps --format '{{.Names}} {{.Ports}}'                                                        # frontend 0.0.0.0:80; realestate_9router 127.0.0.1:20128 (mặc định)
docker volume ls | grep -E 'mongo_data|redis_data|minio_data|nine_router_data'                    # 4 volume tồn tại
```

Sau khi bật `S3_PUBLIC_ENDPOINT` và CRM: mở một ảnh đính kèm trên web, URL phải có host `<domain-file>` và chạy được trong 15 phút.

### 7.1. Hai route health của backend (PT-001)

Backend (`@nestjs/terminus`, `src/health.controller.ts`) có **đúng hai route**, nằm dưới tiền tố toàn cục `/api/v1`, không cần đăng nhập (`@Public()`):

| Route | Ý nghĩa | Mã trả về |
|---|---|---|
| `GET /api/v1/health/liveness` | Chỉ cho biết tiến trình còn sống; **không** kiểm dependency | `200` khi tiến trình trả lời được. Không trả (từ chối kết nối/timeout) nghĩa là tiến trình chết hoặc chưa lên |
| `GET /api/v1/health/readiness` | Sẵn sàng phục vụ: kiểm MongoDB (ping, timeout 3 giây), Redis, S3/MinIO (HeadBucket mọi bucket đã cấu hình, timeout 4 giây) | `200` khi cả ba `up`; `503` khi có thành phần lỗi (nội dung nói thành phần nào `down`). Môi trường chưa cấu hình bucket thì storage báo `up` kèm `configured: false` |

**`GET /api/v1/health` (không có `/liveness` hay `/readiness`) trả `404` là đúng thiết kế, không phải lỗi**: đừng kết luận backend hỏng khi gặp nó.

```bash
# Từ máy chủ qua nginx cổng 80 (đúng đường người dùng đi):
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/health/liveness     # 200
curl -s -w '\n%{http_code}\n' http://localhost/api/v1/health/readiness               # JSON {"status":"ok",...} rồi 200
# Trạng thái healthcheck Docker của backend (gọi liveness trực tiếp trong container, mỗi 15 giây):
docker inspect realestate_backend --format '{{.State.Health.Status}}'                # starting (tối đa ~40 giây đầu) rồi healthy
```

**Healthcheck của service `backend` trong compose** gọi **liveness** (không phải readiness) để Mongo/Redis/MinIO chập chờn không làm backend bị đánh dấu `unhealthy` (Docker Compose không tự khởi động lại container `unhealthy`; trạng thái này chỉ để quan sát và cho công cụ giám sát). `docker compose ps` nay hiện `healthy`/`unhealthy` cho backend. Image `node:*-slim` không có `curl`/`wget` nên lệnh dùng `node -e fetch(...)` (Node 24 có sẵn `fetch`). **Ảnh hưởng tới `depends_on`:** `frontend` và `cloudflared` dùng dạng ngắn (`service_started`), nên **không** bị đổi hành vi; `up -d` không chờ backend `healthy` và không lỗi nếu nó `unhealthy`. `deploy.sh` vẫn tự chờ liveness qua nginx (mục 11), không phụ thuộc trạng thái này. Muốn kiểm readiness (dependency) hãy gọi route readiness ở trên. Healthcheck gọi liveness mỗi 15 giây: nếu log request của backend có ghi các lần gọi này, đó là nhiễu bình thường, không phải sự cố.

## 8. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `required variable ... is missing a value` | Chạy compose không kèm `--env-file .env`, hoặc thiếu biến | Dùng `--env-file .env`; bổ sung biến theo mục 2 |
| Backend mount `./.env` lỗi / `.env` thành thư mục | Chưa có file `.env` trên host khi `up` lần đầu | Xóa thư mục `.env`, `touch .env`, `up` lại |
| `mongo` mãi `unhealthy`, log `Authentication failed` | Volume cũ có dữ liệu nhưng chưa tạo user (nâng cấp chưa làm) | Làm mục 5 |
| `mongo` unhealthy, log keyFile `permissions too open` / `too short` | `MONGO_KEYFILE` rỗng/quá ngắn, hoặc entrypoint bị sửa | Đặt `openssl rand -hex 64`; không sửa entrypoint |
| Backend `Authentication failed` / `MongoParseError` | Mật khẩu có ký tự đặc biệt trong URI | Đổi sang hex; backend `authSource=admin` đã có sẵn trong URI |
| Backend `Server selection timed out`, host `localhost:27017` | `rs.initiate` từng chạy với host khác `mongo:27017` | Với root đã đăng nhập: `cfg = rs.conf(); cfg.members[0].host = 'mongo:27017'; rs.reconfig(cfg, {force: true})` |
| Redis `WRONGPASS` / `NOAUTH` | `REDIS_PASSWORD` đổi nhưng container Redis chưa tạo lại | `docker compose up -d redis backend` |
| `redis-cli -u redis://:pwd@...` báo WRONGPASS | Đặc điểm redis-cli với username rỗng (backend không bị) | Dùng `REDISCLI_AUTH` hoặc `redis://default:pwd@...` |
| Signed URL `SignatureDoesNotMatch` (403) | Tunnel đặt "HTTP Host Header"; `S3_PUBLIC_ENDPOINT` có đường dẫn/dấu `/` cuối; lệch giờ máy chủ | Gỡ override Host; sửa biến; đồng bộ NTP |
| Ảnh không tải, URL trỏ `http://minio:9000` | `S3_PUBLIC_ENDPOINT` trống | Đặt theo mục 3 |
| `minio-init` thoát khác 0 | MinIO chưa sẵn sàng hoặc sai credential | `docker logs realestate_minio_init`; kiểm tra `S3_*` |
| Backend restart liên tục, log `ADMIN_EMAIL/ADMIN_PASSWORD must be set in production` | DB chưa có user nhưng thiếu `ADMIN_*` trong `.env` | Điền `ADMIN_EMAIL`, `ADMIN_PASSWORD` rồi `up -d backend` |
| Đăng nhập thành công nhưng bị đẩy ra lại | Cookie `Secure` bị bỏ khi truy cập HTTP qua IP/hostname | Truy cập qua HTTPS (Cloudflare) hoặc `http://localhost` |
| Nhiều người cùng bị 429 khi đăng nhập | Rate limit đang đếm theo IP của nginx/gateway thay vì IP thật: do `TRUST_PROXY` bị xóa/sai, hoặc nginx.conf/compose bị sửa (IP tĩnh cloudflared lệch `set_real_ip_from`, hoặc thêm cả dải docker) | Làm theo mục 2.1, chạy phép kiểm bằng lệnh; xác nhận log backend có `trustProxy bật: tin 1 proxy` |
| Mất sạch dữ liệu sau thao tác | Chạy `down -v`, hoặc đổi tên project nên volume mới rỗng | Khôi phục từ backup ngoài máy (mục 6); lần sau tuyệt đối không `-v` |

## 9. Việc cần làm thủ công (tóm tắt)

1. Sinh mật khẩu/keyFile và điền `.env` theo mục 2; **sao lưu `.env` và `CRM_PII_ENCRYPTION_KEY` ra ngoài máy chủ**.
2. Bật CRM: làm theo mục 10 (cờ `CRM_ENABLED`/`CRM_ATTACHMENTS_ENABLED`).
3. Cloudflare: thêm hostname `<domain-file>` -> `http://minio:9000` (mục 3), đặt `S3_PUBLIC_ENDPOINT`.
4. Nếu production đang có dữ liệu: thực hiện mục 5 theo thứ tự (gồm 5.0a nếu VPS có bản sửa tay/HEAD detached/`deploy.sh` cũ, và migration 005 rồi 006 ở 5.4a trước khi khởi động backend), không bỏ bước backup, chạy trong `tmux`.
5. Ghim image theo digest của bản đang chạy (mục 12; chưa ghim cái nào); thiết lập cron backup + chép ra ngoài máy chủ.
6. `NODE_ENV=production` **đã được đặt** cho backend trong compose (Oniichan đã quyết định). Bắt buộc `ADMIN_EMAIL`/`ADMIN_PASSWORD` trong `.env` khi DB chưa có user. Cookie refresh có cờ `Secure` nên truy cập qua HTTPS (Cloudflare) hoặc `http://localhost`; truy cập HTTP qua IP/hostname thường sẽ không giữ được cookie đăng nhập. Chi tiết và bảng hành vi ở mục 2.
7. (a) **Swagger đã tắt ở production** (PT-008, quyết định 2026-11-02; có hiệu lực sau deploy kế tiếp, xác minh `NODE_ENV` thật ở mục 2); (b) đặt `FRONTEND_URL=https://<domain-admin>` trong `.env` (compose đã đọc biến này; trước đây bị đặt cứng `http://localhost`): cách kiểm ở mục 13.1 (PT-016).
8. Server Linux: `mkdir -p logs && chown 1000:1000 logs` trước `up` lần đầu (backend chạy uid 1000).
9. Tạo user Mongo riêng quyền `readWrite` trên DB `realestate` cho backend (hiện backend dùng root, theo thiết kế đơn giản ban đầu) và access key MinIO riêng thay vì root: runbook ở mục 13.3 và 13.4 (PT-016; từ v1.0.6 compose chỉ còn hỗ trợ `S3_APP_*`, **`MONGO_APP_*` đã bỏ**, xem banner ở 13.3; chưa đặt trên VPS). Kiểm cổng 27017/firewall: mục 13.2.
10. 9Router: điền `NINE_ROUTER_INITIAL_PASSWORD` (bắt buộc) vào `.env`; đối chiếu biến môi trường của container đang chạy với service mới (mục 5.0a), mang sang compose mọi biến image có đọc mà bản sửa tay đã đặt (`API_KEY_SECRET`, `JWT_SECRET`, `MACHINE_ID_SALT`, `REQUIRE_API_KEY`...); cổng `20128` mặc định `127.0.0.1` (dashboard qua SSH tunnel; qua IP/Tailscale cần `NINE_ROUTER_BIND_ADDR=0.0.0.0`; xác nhận không có Cloudflare ingress/`tailscale serve` trỏ vào host:20128); thêm volume `nine_router_data` vào lịch backup (mục 6); cân nhắc pin tag/digest cho image `decolua/9router` (hiện `:latest`).
11. Token Cloudflare: `CLOUDFLARE_TUNNEL_TOKEN` là biến bắt buộc trong `.env` (mục 5.0a (e) hướng dẫn chép từ `deploy.sh` cũ mà không in ra). Chỉ xóa/`shred` `~/deploy.sh.old` sau khi tunnel đã lên và chạy ổn (5.7).
12. Từ nay cập nhật bằng `deploy.sh` trong repo (mục 11), thay script cũ trên VPS. Người commit `deploy.sh` từ Windows chạy `git add --chmod=+x deploy.sh scripts/run-migration.sh` để giữ bit thực thi (tài liệu vẫn dùng `bash deploy.sh` nên không phụ thuộc bit này).
13. Dọn định kỳ thẻ image dự phòng `realestatemanager-backend:pre-*` và image `realestate-migrate:*` (mục 5.7/11); script từ chối chạy khi dung lượng đĩa thấp.
14. Web Push (v1.0.4): sinh khóa VAPID một lần, đặt `VAPID_*` + `CRM_PUSH_ENABLED` rồi bật theo đúng thứ tự: làm theo **mục 15** (kèm cách tắt khẩn cấp, đổi khóa và checklist thử trên điện thoại thật).
15. Việc kiểm tay sau deploy v1.0.4 (hậu-deploy, không chặn phát hành): IP thật sau cloudflared (FR-23) và dự án mẫu bị trùng (FR-35): làm theo **mục 16**, điền ô kiểm ở 16.3.

## 10. Bật CRM trên production

Cờ CRM có hai phía và **phải khớp**: backend đọc lúc chạy, frontend **cũng đọc lúc chạy** (v1.0.6: qua `/env.js` do entrypoint nginx sinh từ biến môi trường của container; không còn build arg `VITE_*`). Compose dùng chung hai biến trong `.env`:

| Biến | Backend | Frontend (runtime, `/env.js`) | Ghi chú |
|---|---|---|---|
| `CRM_ENABLED` | `FEATURE_CRM_ENABLED` | `CRM_ENABLED` | công tắc tổng, mặc định `false`; chỉ ghi đúng `true`/`false` chữ thường (backend nhận cả `1`/`yes`/`on` nhưng frontend thì không, sẽ lệch) |
| `CRM_ATTACHMENTS_ENABLED` | `FEATURE_CRM_ATTACHMENTS` | `CRM_ATTACHMENTS_ENABLED` | ảnh nhật ký; cần MinIO + `S3_PUBLIC_ENDPOINT` (mục 3) |
| `CRM_PUSH_ENABLED` | `FEATURE_CRM_PUSH` (mặc định `false`; kèm `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; chỉ backend, không có phía frontend; đổi thì `docker compose up -d backend` để tạo lại container, không cần build) | (không có) | Web Push v1.0.4; runbook đầy đủ ở **mục 15** (Web Push VAPID) |
| `PUSH_ENDPOINT_HOST_ALLOWLIST` (tùy chọn) | `PUSH_ENDPOINT_HOST_ALLOWLIST` (danh sách host cách nhau dấu phẩy, hỗ trợ `*.host`; **chỉ bổ sung** vào mặc định FCM/Mozilla/Apple/WNS, không thay thế; để trống là bình thường, đổi thì tạo lại container backend) | (không có) | Cho phép thêm host dịch vụ push khi nhà cung cấp đổi tên miền (FR-01, chống SSRF) |
| (cố định) | `FEATURE_CRM_IMPORT=false` | `CRM_MOCK_REPORTS=false`, `CRM_MOCK_IMPORT_EXPORT=false` (mặc định tắt) | M8 chưa làm; không cho dữ liệu mẫu lọt vào production |

**Thứ tự thực hiện (trên server, sau khi đã làm xong mục 4 hoặc 5):**

1. Sinh khóa PII: `openssl rand -base64 32` (đúng 32 byte; mỗi môi trường 1 khóa).
2. **Sao lưu khóa ngoài máy chủ** (secret manager/két mật khẩu) và xác nhận đọc lại được. Đổi hoặc mất khóa = CCCD đã mã hóa không giải mã lại được và **không có cách khôi phục**.
3. Điền `.env`: `CRM_PII_ENCRYPTION_KEY=<khóa>`, `CRM_ENABLED=true`, (tùy chọn) `CRM_ATTACHMENTS_ENABLED=true`, `FRONTEND_URL=https://<domain-admin>`. Xóa mọi dòng `FEATURE_CRM_*` cũ trong file (bị compose ghi đè, dễ gây nhầm).
4. Sao lưu Mongo trước khi bật (mục 6).
5. Tạo lại backend và frontend để nhận cờ mới (không cần build lại image; frontend đọc cờ lúc khởi động): `docker compose up -d --no-build --force-recreate backend frontend`.
6. Lần chạy đầu backend tự seed (idempotent, không ghi đè phần Quản trị đã sửa): tình trạng khách, nguồn khách, kết quả liên hệ, khu vực, dự án, nhóm trường và trường chân dung. Đã quan sát trên stack thử: `{"statuses":4,"leadSources":6,"contactResults":7,"areas":15,"projects":8}` và `{"personaGroups":7,"personaFields":25}`.

**Kiểm tra sau khi bật:**

```bash
docker logs realestate_backend 2>&1 | grep -E "Feature flags|Seed"     # CRM_ENABLED:true (+ CRM_ATTACHMENTS:true), có dòng Seed CRM xong
docker compose exec frontend wget -qO- http://127.0.0.1/env.js   # cấu hình runtime của frontend (không có bí mật); thấy CRM_ENABLED đúng giá trị
```

Rồi đăng nhập web: thấy menu "Quản lý khách hàng"; tạo thử một khách; nếu bật ảnh thì thêm ảnh vào nhật ký (URL ảnh có host `<domain-file>`). Đã chạy thật trên stack thử (không qua Cloudflare): đăng nhập, `GET /crm/customers` 200, danh mục có dữ liệu seed, tạo khách, upload ảnh 201, cờ trong bundle bật và mock tắt.

**Tắt lại:** đặt `CRM_ENABLED=false` (và `CRM_ATTACHMENTS_ENABLED=false`), chạy lại lệnh ở bước 5. Dữ liệu CRM đã tạo vẫn nằm trong Mongo/MinIO (không bị xóa); theo thiết kế (CrmFeatureGuard) các route `/crm/*` của backend trả 404 và menu ẩn (phần tắt lại chưa chạy thử). **Giữ nguyên `CRM_PII_ENCRYPTION_KEY`** trong `.env` kể cả khi tắt, để bật lại vẫn giải mã được.

**Lỗi thường gặp khi bật:** CRM bật nhưng thiếu `CRM_PII_ENCRYPTION_KEY` thì backend không khởi động (đã thử: container restart liên tục). Lưu ý nhật ký lỗi hiện chỉ in `ERROR [ExceptionHandler] {}` mà không in nguyên nhân, nên khi thấy restart loop kèm dòng đó hãy kiểm tra khóa trước (đúng 32 byte, base64/hex, không có khoảng trắng/dấu nháy). Menu CRM không hiện sau khi đổi cờ: chưa tạo lại container `frontend` sau khi đổi cờ, hoặc trình duyệt giữ `/env.js`/bản JS cũ (tải lại cứng).

## 11. Cập nhật stack bằng `deploy.sh`

`deploy.sh` (thư mục deploy trên VPS; có trong gói do `release.sh build` đóng) cập nhật stack **đang chạy ổn định ở cấu hình mới** lên **gói phát hành đã cài** (`release.env` + hai image đã nạp bằng `docker load`). Script **không build, không dùng git, không pull**: nguồn sự thật của phiên bản là `release.env` (mục 0.1). Thường được `release.sh send` gọi qua ssh (mục 0.2); chạy tay trên server Linux (Ubuntu 24.04), trong thư mục deploy, **trong `tmux`/`nohup`** (rớt SSH giữa chừng không làm gián đoạn):

```bash
bash deploy.sh              # backup + gắn thẻ + promote + migrate + up + chờ healthy + hậu-migrate
bash deploy.sh --plan-only  # chỉ kiểm image/.env/khóa và lập kế hoạch migration (reconcile dry-run) rồi thoát: không backup, không promote `current`, không ghi DB, không up (mục 11.1)
bash deploy.sh --no-migrate # TẮT tự migrate (mặc định là BẬT): có việc chờ hoặc cần baseline thì dừng trước `up`
bash deploy.sh --help       # `--migrate` còn là bí danh của chế độ mặc định (tự migrate), giữ cho tương thích
```

Chỉ bốn cờ trên (`--no-migrate`, `--migrate`, `--plan-only`, `--help`); tham số lạ, kể cả `--no-pull` cũ, thoát mã 2 (bảng cờ cũ sang mới ở mục 0.6). Dùng `bash deploy.sh` (không phụ thuộc bit thực thi). Script `source` thêm `ops/lib/ops-common.sh` nên phải chạy trong thư mục deploy đầy đủ (do `ops/install-release.sh` cài).

**Không phải công cụ nâng cấp standalone lần đầu.** Lần đó làm theo mục 5, từng bước (tạo user/replica set trên dữ liệu cũ, migration 005/006 trước khi backend lên). `deploy.sh` từ chối chạy nếu thấy container Mongo đang ở cấu hình cũ (không xác thực).

Thứ tự các bước của script (nhãn `5`, `6b`, `8a`, `8b`, `8c` giữ nguyên vì script và các mục sau còn dẫn chiếu):

| # | Bước | Dừng khi |
|---|---|---|
| 1 | Kiểm tra `docker`, `docker compose`, `curl`, `gzip`; dung lượng trống >= `DEPLOY_MIN_FREE_GB` (mặc định 5 GB) ở thư mục deploy và thư mục dữ liệu Docker | thiếu lệnh; thiếu dung lượng (in `docker system df`, gợi ý dọn ở mục 6.3) |
| 1a | Đọc `release.env` (chỉ bằng `grep`, không `source`): `RELEASE_VERSION`, `GIT_COMMIT`, tên/thẻ/ID hai image; từ chối bản `-local`/`-dirty` | thiếu/hỏng `release.env`; bản local/dirty |
| 1b | Kiểm hai image `<name>:<version>-<commit>` **đã nạp** trên VPS và ID khớp `release.env`. ID lệch: **cảnh báo**; với `DEPLOY_ENFORCE_IMAGE_ID=1` là **lỗi** (dưới containerd store, ID là digest manifest nên có thể lệch; chỉ bật sau khi diễn tập đạt) | thiếu image (chạy lại bước chuyển image, mục 0.2); lệch ID khi `DEPLOY_ENFORCE_IMAGE_ID=1` |
| 2 | `bash ops/verify-env.sh .env`: đủ khóa bắt buộc, không còn placeholder `<...>`, không còn khóa cũ (`VITE_*`, `FEATURE_CRM_*`...), URI khớp mật khẩu, quyền **600**; chỉ in TÊN khóa. Rồi khóa `flock` `.deploy.lock` ở thư mục deploy (chống chạy chồng với `deploy.sh`/`backup.sh`/`restore.sh`) | `.env` lỗi (sửa theo tên khóa được in); khóa đang bị giữ |
| 3 | `docker compose config -q` | thiếu/sai biến bắt buộc (gồm `CLOUDFLARE_TUNNEL_TOKEN`, `NINE_ROUTER_INITIAL_PASSWORD`); stack chưa bị đổi |
| 3a | **Kiểm volume Mongo (Q-03):** có container Mongo thì dùng như thường; không có container nhưng **có volume** `<project>_mongo_data` (dữ liệu có thể còn, dễ do sai project) thì dừng; không có cả hai là **cài mới** (bước 8a). `DEPLOY_ALLOW_NEW_MONGO_VOLUME=1` cho phép có chủ ý | có volume Mongo mà không có container và không đặt `DEPLOY_ALLOW_NEW_MONGO_VOLUME=1` |
| 3b | Mongo đang healthy thì **đếm (chỉ đọc)** user chưa có `roles[]`/`teamIds[]` bằng cùng bộ lọc với `UserRolesMigrationGuard` | còn user chưa migrate 005: in hướng dẫn `bash scripts/run-migration.sh 005` (tránh backend mới crash-loop). Không đếm được thì chỉ cảnh báo |
| 4 | Tạo `logs/`, chown `1000:1000` (backend chạy uid 1000; compose chỉ mount `./logs`): thử trực tiếp, rồi `sudo -n`; không được thì **in lệnh `sudo chown ...` để bạn chạy** | không chown được |
| 5 | `mongodump` DB `realestate` ra `backups/deploy-pre-<thời-gian>.archive.gz` (quyền 600, thư mục 700) qua `docker exec`; mật khẩu đọc từ biến môi trường TRONG container, đưa qua pipe; kiểm **nội dung** (> 0 byte, `gzip -t`, `mongorestore --dryRun` thấy `realestate.users`). Sao `.env` ra `backups/deploy-pre-<thời-gian>.env` (quyền 600). **Ngoại lệ DB chưa có dữ liệu:** trước khi dump, script hỏi (chỉ đọc) DB có collection `users` không; nếu **không có `users` và không collection nào có document** (Mongo vừa dựng, backend chưa boot lần nào; "có document" kiểm bằng `findOne`, không tin số đếm trong metadata) thì in cảnh báo "DB chưa có dữ liệu" và **bỏ qua backup** (mongodump sẽ không sinh `realestate.users` nên bước kiểm nội dung từ chối oan). Trạng thái "chỉ có collection `system` có document, không có `users`" (sổ phiên bản do runner ghi ở 6b của một lần deploy đầu bị dở dang trước `up`) cũng được coi là chưa có dữ liệu nghiệp vụ, có cảnh báo riêng. Có `users` (kể cả rỗng) thì backup vẫn bắt buộc như thường | mongo không chạy, không hỏi được Mongo, DB không có `users` nhưng có collection khác có dữ liệu (mơ hồ: script không đoán, in cách kiểm; collection `system` không tính là mơ hồ), mongodump lỗi hoặc quá `DUMP_TIMEOUT` (mặc định 900 giây), file rỗng/hỏng/không phải dump DB `realestate` (bước kiểm nội dung có thời hạn `OPS_EXEC_TIMEOUT`, mặc định 300 giây) |
| 5a | **Manifest v2** `backups/deploy-pre-<TS>.manifest` (mục 11.8; KEY=VALUE, không bí mật; các khóa trạng thái `STACK_TOUCHED`/`POST_UP_REACHED` được ghi **ngay** khi xảy ra nên bị `SIGKILL`/mất điện manifest vẫn đúng). Bị ngắt bằng `SIGTERM`/`SIGINT`/`SIGHUP` (kill, Ctrl-C, rớt SSH) thì thoát mã 143/130/129: manifest ghi `failed`, không ghi nhầm `succeeded` | không ghi được vào thư mục backup |
| 6 | Gắn thẻ **`pre-<TS>`** cho image backend và frontend **đang chạy** (lấy từ container, không phải bản mới): đây là đường lùi. Cài mới (chưa có container) thì không có gì để gắn | không gắn được thẻ |
| 6a | **Promote:** gắn thẻ `<name>:<version>-<commit>` thành `<name>:current` cho cả hai image (compose đọc `current`). **Chưa đụng stack đang chạy** (container cũ giữ image cũ theo ID). Lỗi từ đây tới trước `up` (stack và dữ liệu chưa đổi) thì `deploy.sh` **tự trả `current` về image `pre-<TS>`** và ghi `PROMOTE_REVERT` (`reverted`, `failed` hoặc `none`) vào manifest; `failed` thì in cảnh báo kèm lệnh `docker tag` làm tay. Đây là ngoại lệ duy nhất có auto-rollback, vì chỉ đổi thẻ cục bộ | promote lỗi |
| 6b | Migration theo version (PT-027, **mặc định BẬT**), chạy runner trong **image `<version>-<commit>` đã nạp** bằng `docker compose run --rm --no-deps backend node dist/migrations/cli.js`, **luôn SAU backup bước 5**: (i) `reconcile --by deploy --skip-version --phase pre-up` (**dry-run**, chỉ đọc) in kế hoạch; (ii) nếu dry-run ổn và `BACKUP_FILE` không rỗng (hoặc bước 5 đã bỏ qua backup vì DB chưa có dữ liệu; khi đó script hỏi lại DB ngay trước khi ghi và chỉ chạy tiếp nếu vẫn chưa có dữ liệu nghiệp vụ; không hỏi lại được thì dừng, DB đã có dữ liệu thì dừng và yêu cầu chạy lại `bash deploy.sh` để có backup mới): đặt `STACK_TOUCHED=1` rồi `reconcile --apply --by deploy --skip-version --phase pre-up` (baseline 002..006 nếu probe chỉ-đọc chứng minh dữ liệu không còn việc, rồi chạy migration **pre-up** 007..010 còn chờ; migration pha `post-up` (011, v1.0.5) **không** chạy ở đây mà ở bước 90, mục 11.6; **chưa ghi `version`** vì code mới chưa chạy; ngoại lệ **DB mới tinh** (`version` chưa có, `users` rỗng): runner ghi `version` ngay ở bước này dù có `--skip-version`). Mongo chưa có container VÀ chưa có volume `<project>_mongo_data` (triển khai mới, DB trống) thì bỏ qua bước này TRƯỚC `up` và bước **8a** bù ngay trong cùng lần deploy (xem dưới; không cần deploy lần hai). Với `--no-migrate`: chạy `status --json` như trước, còn việc chờ hoặc cần baseline thì dừng. Với `--plan-only`: chỉ chạy (i) bằng image `<version>-<commit>` (không `--skip-version`, **không** `--phase` nên kế hoạch thấy mọi pha, gồm cả 011 post-up) rồi thoát, **không** backup, **không** promote `current`, **không** up | runner trả **3** (khóa), **4** (probe không đạt, cần xử lý tay), **5** (downgrade, trừ khi `DEPLOY_ALLOW_DOWNGRADE=1`), **1** (lỗi/từ chối): dừng **trước `up`**, stack chưa đổi (nếu đã promote thì `current` được tự trả về, bước 6a), in nguyên nhân và lệnh; riêng mã 1 từ `--apply` coi như dữ liệu có thể đổi một phần (in hướng dẫn "không quay image cũ") |
| 7 | `docker compose up -d --no-build` (không build, không `--pull always`): tạo lại container `backend`/`frontend` theo `current` mới | up lỗi (từ đây không còn auto-rollback) |
| 8 | Chờ `realestate_mongo` healthy (mặc định `MONGO_TIMEOUT` 120 giây) và backend liveness `http://localhost/api/v1/health/liveness` (`HEALTH_URL`, mặc định `HEALTH_TIMEOUT` 120 giây) | quá hạn, hoặc container backend `exited` |
| 8a | **Chỉ khi CÀI MỚI thật sự** (6b đặt `FRESH_INSTALL=1`: KHÔNG có container Mongo VÀ KHÔNG có volume `<project>_mongo_data`), ngay sau liveness: `reconcile --apply --by deploy --phase pre-up` (không `--skip-version`; chạy 007..010 và ghi `version`; không backup vì DB trống; 011 để bước 90). **Không phụ thuộc `--no-migrate`/`DEPLOY_AUTO_MIGRATE=0`** (ngoại lệ có chủ ý: DB trống thật sự nên không có gì để hỏng); `--plan-only` thoát trước nên không chạy. Có volume Mongo mà không có container thì **không** coi là cài mới: bỏ qua cả 6b lẫn 8a, in cảnh báo (dữ liệu có thể còn, không migrate khi chưa backup) | **làm deploy THẤT BẠI** (`die`, exit 1, không chạy 8c) kèm lệnh chạy lại |
| 8b | **Bỏ qua khi cài mới (8a đã ghi `version`).** Nếu bước 6b đọc được trạng thái: `reconcile --apply --by deploy --phase pre-up` (không `--skip-version`) để ghi `version` (và `commit`) của app vào collection `system` (migration đã xong ở 6b nên chỉ còn ghi phiên bản). Trên DB mới tinh `version` đã được ghi ở 6b nên 8b là **no-op, mã `0`**. Downgrade có chủ ý (`DEPLOY_ALLOW_DOWNGRADE=1` và runner báo mã 5 ở 6b): **bỏ qua**, không ghi và không hạ `version` | **không làm deploy thất bại**: lỗi chỉ cảnh báo kèm lệnh ghi lại sau |
| 8c | **Điểm gọi hậu-migrate dùng chung (v1.0.5; chạy MỌI lần deploy)**, ngay sau 8a/8b khi backend đã sống: hàm `run_post_migrate_steps` chạy lần lượt các tệp `scripts/post-migrate/[0-9][0-9]-*.sh` **theo thứ tự tên** bằng `bash <tệp>` (không phụ thuộc bit thực thi). Mỗi tệp nhận `ENV_FILE`, `LOGS_DIR`, `TS`, `DOC`, `LOG_PREFIX` qua môi trường, tự chạy lệnh trong container, tự ghi log `logs/deploy-<tên>-<thời-gian>.log` và tự in cảnh báo đỏ khi lỗi. `deploy.sh` **không** chứa logic bù mã hay migration của các bước này. Ba tệp hiện có (chi tiết ở mục 11.6): `10-catalog-codes.sh` (bù mã danh mục), `20-customer-codes.sh` (bù mã khách), `90-post-up-migrations.sh` (migration 011 **một chiều**). Không thấy tệp bước nào dạng `[0-9][0-9]-*.sh` thì `die` (không bỏ qua im lặng việc bù mã). Downgrade có chủ ý (`DEPLOY_ALLOW_DOWNGRADE=1` và runner báo mã 5 ở 6b): **bỏ qua TOÀN BỘ** ba bước (image cũ không có các CLI này) | **Khác 8b, làm deploy THẤT BẠI**: tệp bước thoát khác 0 thì có cảnh báo **đỏ** ở stderr cùng log riêng của bước, rồi `deploy.sh` `die` kèm tên bước ("Bước hậu-migrate '<tên>' thất bại"), thoát mã `1` (không in "Deploy xong", không chạy `compose ps`) và in hướng dẫn lùi/sửa tiến (`print_recovery`, vì `STACK_TOUCHED=1`); các bước **sau** KHÔNG chạy. Backend vẫn đang chạy; sửa nguyên nhân rồi chạy lại `bash deploy.sh` (hoặc đúng lệnh ghi trong cảnh báo đỏ) |

> **Đổi tên bước 8c (v1.0.5).** Từ v1.0.5 bước "8c bù mã danh mục" là tệp `scripts/post-migrate/10-catalog-codes.sh` (hành vi giữ nguyên, log `deploy-catalog-codes-<thời-gian>.log`). Các chỗ khác của tài liệu này (11.2, 11.4, 15.7 và đoạn L1/L2 ở dưới) vẫn nói "bước 8c" cho phần này: đọc là "bước 10 của điểm gọi hậu-migrate". Toàn bộ phần mới của v1.0.5 (khách có mã, SĐT tùy chọn, bước 20 và 90) nằm ở mục 11.6; việc báo người dùng sau deploy ở mục 11.7.

Biến tùy chọn (không bí mật): `MONGO_TIMEOUT`, `HEALTH_TIMEOUT` (giây), `HEALTH_URL`, `DEPLOY_MIN_FREE_GB`, `DUMP_TIMEOUT`, `OPS_EXEC_TIMEOUT`, `DEPLOY_AUTO_MIGRATE` (`1` mặc định = tự baseline + migrate; `0` = như `--no-migrate`; cờ dòng lệnh thắng biến), `DEPLOY_ALLOW_DOWNGRADE` (`1` = cho phép cố ý deploy bản có version thấp hơn DB; mặc định `0`), `DEPLOY_ENFORCE_IMAGE_ID` (`1` = lệch image ID là lỗi; mặc định `0` chỉ cảnh báo), `DEPLOY_ALLOW_NEW_MONGO_VOLUME` (`1` = cho phép tạo volume Mongo mới khi chưa có container, bước 3a), `DEPLOY_CD_RUN_ID` (mã lần chạy CD, ghi vào manifest `CD_RUN_ID`; mặc định lấy `GITHUB_RUN_ID` nếu có; chuẩn bị cho CD v1.0.7, ở v1.0.6 chạy tay nên thường để trống). `--migrate` và `--no-migrate` loại trừ nhau (mã thoát 2). Chưa có container `realestate_mongo` (triển khai mới): script bỏ qua backup (không có dữ liệu) và nói rõ. Container Mongo đã chạy nhưng DB `realestate` chưa có dữ liệu (không `users`, không document nào): cũng bỏ qua backup và nói rõ (xem bước 5). DB đã có `users` thì backup luôn bắt buộc.

**Vì sao KHÔNG tự rollback sau `up`:** khi dữ liệu Mongo đã được nâng cấp (replica set + xác thực, migration 005/006...), image và compose cũ **không đọc được dữ liệu mới**; tự quay image có thể làm hỏng thêm đúng lúc cần ổn định nhất. Vì vậy khi lỗi sau `up` script chỉ **in hướng dẫn** (log, lệnh `bash restore.sh --manifest backups/deploy-pre-<TS>.manifest`) rồi thoát mã khác 0. Đường lùi:

0. **Có đường tự động:** `bash restore.sh --latest` (dry-run) rồi `--manifest <file> --apply --yes` đưa DB + image (hai thẻ `pre-<TS>` thành `current`) về bản trước deploy (mục 6.1, manifest ở 11.8; kiểm bản cần chọn bằng `--list`). Lưu ý `release.env` vẫn là bản mới, nên **không** chạy lại `deploy.sh` cho tới khi có bản vá. Các bước thủ công dưới đây vẫn dùng được.
1. Xem nguyên nhân: `docker compose logs --tail 100 backend`.
2. Dữ liệu **chưa đổi** (chưa chạy migration `--apply`, chưa nâng cấp Mongo): lùi **image** bằng thẻ `pre-<TS>`, không đụng DB:
   ```bash
   docker tag realestatemanager-backend:pre-<thời-gian>  realestatemanager-backend:current
   docker tag realestatemanager-frontend:pre-<thời-gian> realestatemanager-frontend:current
   docker compose up -d --no-build --no-deps backend frontend
   ```
   **Ngoại lệ v1.0.4 cho migration 007 (mã danh mục, FR-40) và 008 (loại hình, FR-46): được lùi IMAGE dù migration đã `--apply`.** Hai migration này chỉ **thêm** trường mới (`areas.code`, các trường `...Code`, `propertyTypeCodes`, index) và **vẫn ghi id cũ**, nên image cũ đọc dữ liệu bình thường. Ba mức, thử theo thứ tự:
   - **L1 (an toàn, mặc định):** chỉ lùi image bằng đúng hai lệnh `docker tag` / `up -d --no-build --no-deps backend` ở mục 2 trên. Không đụng dữ liệu. Bản ghi image cũ ghi trong lúc lùi sẽ thiếu `code`; khi tiến lại, bước 8c chạy lại và tự sửa chúng.
   - **L2 (chỉ khi cần dọn trường mới):** `$unset` đúng các trường mới do 007/008 thêm, **chỉ sau khi đã lùi image** (L1 xong mới `$unset`, nếu không backend mới ghi lại ngay). Danh sách trường và lệnh mẫu đầy đủ ở **"Lùi L2: `$unset` trường mã mới của 007/008"** ngay dưới danh sách này; dùng được độc lập lúc xử sự cố.
   - **L3 (cuối cùng):** `mongorestore` từ `backups/deploy-pre-*` như mục 3 dưới đây; mất mọi dữ liệu phát sinh sau backup.

   Thứ tự bắt buộc: **L1 (lùi image) trước, rồi L2 (`$unset`), cuối cùng mới L3 (`mongorestore`)**. Dừng ở mức nhỏ nhất đủ giải quyết sự cố; đa số trường hợp chỉ cần L1. Migration **009** chỉ thêm index và lùi bằng `down`. Ngoại lệ này **chỉ áp dụng cho migration 007 và 008**, **không** áp dụng cho migration khác (005/006, nâng cấp Mongo, 009...), **ngoại trừ ngoại lệ v1.0.5 ngay dưới** cho migration 010.

   **Ngoại lệ v1.0.5 cho migration 010 (index mã khách) và ranh giới "bước 90 (011) một chiều" (FR-21).** Migration **010** chỉ **thêm** (index partial unique `customers.customerCode_1` và counter `CUSTOMER_CODE`, không đụng `phone`), nên lùi IMAGE về v1.0.3 vẫn được dù 010 đã `--apply` (khách chưa có `customerCode` không vi phạm index partial; mã thừa không ảnh hưởng v1.0.3). Ranh giới nằm ở **bước 90** (migration **011**, MỘT CHIỀU, mục 11.6):
   - **Trước bước 90 (011 CHƯA chạy):** lùi image v1.0.3 như thường lệ (L1: `docker tag` + `up -d --no-build --no-deps backend`, như mục 2 ở trên). `phone_1` vẫn unique nên v1.0.3 chạy đúng. Khi tiến lại, bước 20 tự bù mã cho khách image cũ vừa tạo.
   - **Sau bước 90 (011 ĐÃ chạy hoặc chạy dở): chỉ sửa tiến (fix-forward), KHÔNG lùi image v1.0.3.** 011 bỏ unique `phone_1` (tạo `phone_1` thường) và đổi `phone` dạng `anonymized:...` về `null`, nên `phone` có thể `null`/trùng còn mapper v1.0.3 giả định `phone` là chuỗi. Sửa nguyên nhân rồi deploy lại. Muốn quay lại hẳn thì chỉ còn `mongorestore` từ `backups/deploy-pre-*` (mất mọi dữ liệu sau thời điểm dump, và đó là việc Oniichan quyết định, không tự chạy).
   - **Kiểm 011 đã chạy chưa:** `$RUN status` (`RUN` như ở 11.1): dòng `011_crm_drop_unique_phone (deploy, <ngày>)` nằm trong mục **"Đã áp dụng"** là đã chạy; còn nằm trong "Migration chờ" (`[post-up]`, "Chờ post-up: 1") là chưa. Cách khác: `docker exec` mongosh kiểm `customers.getIndexes()` thấy `phone_1` **không** còn `unique: true`. **Đừng dựa vào việc file `logs/deploy-post-up-<thời-gian>.log` có tồn tại:** bước 90 tạo file này ngay từ đầu, kể cả khi cổng chặn từ chối chạy 011 (lúc đó trong log chỉ có đầu ra `status`, không có dòng `reconcile`); muốn dùng log thì đọc nội dung để biết lý do lỗi hoặc từ chối. `deploy.sh` in hướng dẫn tương tự (hàm `print_recovery`) khi deploy lỗi sau `up`: ở đó cũng chỉ tin `status`, và nói rõ file log chỉ để đọc lý do.
3. Dữ liệu **đã đổi** (migration 005/006, nâng cấp Mongo...): không quay về bản cũ. Với deploy thường lệ (lâu sau lần nâng cấp standalone) **chỉ** dùng `mongorestore` từ file `backups/deploy-pre-*.archive.gz` (mục 6; luôn kèm `--nsInclude 'realestate.*'`). Mục 5.8 (khôi phục volume) chỉ dành cho sự cố **ngay sau** lần nâng cấp standalone, vì nó đưa cả DB về ngày nâng cấp và mất mọi dữ liệu phát sinh sau đó.

**Lùi L2: `$unset` trường mã mới của 007/008 (ngoại lệ chỉ cho 007/008, dùng độc lập lúc xử sự cố).** Chạy trên máy chủ Linux (bash/WSL, không phải Git Bash trên Windows), thư mục repo, `realestate_mongo` đang chạy. Chỉ làm khi L1 chưa đủ (ví dụ cần loại hẳn các trường mới khỏi dữ liệu).

Điều kiện trước khi `$unset` (thiếu một điều kiện thì DỪNG, đừng chạy):

1. **Đã lùi image (L1) xong và backend đang chạy bản cũ.** Kiểm: hai ID dưới đây phải **giống nhau** (thay `<project>` và `<thời-gian>` đúng thẻ `pre-*` của lần deploy lỗi):
   ```bash
   docker inspect realestate_backend --format '{{.Image}}'
   docker image inspect <project>-backend:pre-<thời-gian> --format '{{.Id}}'
   ```
   Nếu backend mới còn chạy, nó sẽ ghi lại các trường vừa xóa (và deploy tiếp theo cũng sẽ điền lại, xem cuối mục).
2. **Có bản backup mới nhất còn dùng được** (`backups/deploy-pre-*.archive.gz` của lần deploy này, kiểm `ls -l` > 0 byte). Nên dump thêm ngay trước khi `$unset` theo mục 6 nếu đã có dữ liệu ghi sau backup.

**Danh sách trường được `$unset` (đủ, không thêm, không bớt).** Đã đối chiếu Architecture v1.0.4 mục 3.1 và 5.1.7 với mã nguồn `migrate-catalog-codes.ts` (007) và `migrate-project-property-type-codes.ts` (008):

| Collection | Trường mới cần `$unset` | Do migration |
|---|---|---|
| `customers` | `statusCode`, `sourceCode`, `areaCode`, `interestedProjectCodes` | 007 |
| `care_logs` | `contactResultCode` | 007 |
| `appointments` | `projectCode` | 007 |
| `projects` | `areaCode` | 007 |
| `projects` | `propertyTypeCodes`, `unmappedPropertyTypes` | 008 |
| `areas` | `code` | 007 |

**KHÔNG `$unset`** các trường id cũ mà image cũ đọc: `statusId`, `sourceId`, `areaId`, `interestedProjectIds`, `contactResultId`, `projectId`, `propertyTypes` (007/008 ghi kép, không xóa, không sửa chúng). Trường `changes[].fromCode`/`toCode` trong `crm_audit_logs` (Architecture 3.1) do ứng dụng ghi, không do 007/008, nên **cũng không** nằm trong L2 (image cũ bỏ qua).

**Bước A. Đếm TRƯỚC (chỉ đọc).** Mỗi dòng in số bản ghi đang có trường đó:

```bash
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const d = db.getSiblingDB("realestate");
const fields = {
  customers: ["statusCode", "sourceCode", "areaCode", "interestedProjectCodes"],
  care_logs: ["contactResultCode"],
  appointments: ["projectCode"],
  projects: ["areaCode", "propertyTypeCodes", "unmappedPropertyTypes"],
  areas: ["code"],
};
for (const [coll, list] of Object.entries(fields)) {
  print(coll + " (tong): " + d.getCollection(coll).countDocuments({}));
  for (const f of list) print("  " + coll + "." + f + " ton tai: " + d.getCollection(coll).countDocuments({ [f]: { $exists: true } }));
}
EOF
```

**Bước B. `$unset` (GHI dữ liệu, chỉ sau khi hai điều kiện trên đạt).** `updateMany({}, ...)` qua mongosh gốc nên **không đổi `updatedAt`/`version`**. Mỗi lệnh in `modifiedCount`:

```bash
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const d = db.getSiblingDB("realestate");
printjson(d.customers.updateMany({}, { $unset: { statusCode: "", sourceCode: "", areaCode: "", interestedProjectCodes: "" } }));
printjson(d.care_logs.updateMany({}, { $unset: { contactResultCode: "" } }));
printjson(d.appointments.updateMany({}, { $unset: { projectCode: "" } }));
printjson(d.projects.updateMany({}, { $unset: { areaCode: "", propertyTypeCodes: "", unmappedPropertyTypes: "" } }));
printjson(d.areas.updateMany({}, { $unset: { code: "" } }));
EOF
```

**Bước C. Đếm SAU (chỉ đọc).** Chạy lại đúng script ở bước A. **Mọi dòng `... ton tai` phải bằng `0`**, còn các dòng `(tong)` phải **bằng** bước A (không mất bản ghi). Dòng nào khác `0`: image mới có thể còn chạy và đang ghi lại (quay lại điều kiện 1), rồi chạy lại bước B. Nếu `(tong)` lệch với bước A: DỪNG, không làm thêm, báo người phụ trách rồi cân nhắc L3.

**Index mới còn lại là vô hại, không cần xóa.** `$unset` không xóa index: các index do 007 tạo vẫn còn (`areas.code_1` unique partial chỉ áp dụng cho `code` kiểu chuỗi nên không chặn bản ghi không có `code`; `customers.statusCode_1`, `sourceCode_1`, `areaCode_1`, `interestedProjectCodes_1`, `deletedAt_1_statusCode_1_lastUpdatedAt_-1`, `primaryAssigneeId_1_statusCode_1`; `care_logs.contactResultCode_1` sparse; `appointments.projectCode_1_startAt_1`; `projects.areaCode_1`, `propertyTypeCodes_1`). Index trên trường vắng chỉ tốn một ít dung lượng, image cũ bỏ qua chúng, và lần deploy sau `createIndex` coi là đã có.

**Tiến lại sau L2:** deploy bản mới như thường. Runner 007/008 và bước 8c tự điền lại mọi `...Code`/`propertyTypeCodes` từ các id cũ (đều idempotent). Riêng `areas.code`: mã được tính lại theo quy tắc xác định (tỉnh seed có mã cố định, khu vực khác sinh từ tên, thêm hậu tố `_2`, `_3` nếu trùng), nên thường trùng mã cũ nhưng **không đảm bảo** nếu danh sách khu vực đã đổi trong lúc lùi; vì vậy chỉ dùng L2 khi thật cần, ưu tiên L1.

Việc script KHÔNG làm: chạy migration khi có `--no-migrate` hoặc `DEPLOY_AUTO_MIGRATE=0` (mục 11.1; ngoại lệ duy nhất: CÀI MỚI thật sự, không container và không volume Mongo, vẫn chạy bước 8a trên DB trống), **chạy lại migration 002..006** (runner chỉ ghi sổ chúng khi probe chỉ-đọc chứng minh không còn việc, mục 11.1; muốn thực sự chạy 005/006 vẫn dùng `scripts/run-migration.sh`), chép backup ra ngoài máy chủ, **dọn image dự phòng** (chính sách và lệnh ở mục 6.3), đổi Cloudflare, ghim image hạ tầng (mục 12), build image (việc của `release.sh build`). Runner không tự backup: nó dựa vào backup mongodump ở bước 5 (vì thế phần ghi của `reconcile` luôn chạy **sau** bước backup). **Dọn dung lượng:** mỗi lần deploy để lại hai thẻ `realestatemanager-{backend,frontend}:pre-*` (và `scripts/run-migration.sh` để lại `realestate-migrate:*` nếu không dùng `--cleanup`): dọn theo **mục 6.3** (giữ 3 lần gần nhất, không `docker image prune -a`/`docker system prune`).

### 11.1. Phiên bản hệ thống và runner migration (PT-027)

Từ v1.0.3 hệ thống lưu **phiên bản** và **sổ migration đã chạy** trong một collection `system` (key-value) của DB `realestate`; một **runner CLI nằm trong image backend** (`node dist/migrations/cli.js`, không khởi động NestJS, dùng `MONGODB_URI` của backend) chạy các migration **mới** (`007` trở đi) đúng thứ tự, chỉ cái chưa có trong sổ. Backend **không** tự chạy migration và **không** từ chối khởi động; `UserRolesMigrationGuard` (005) và cổng `check_users_migrated` của `deploy.sh` giữ nguyên. **`deploy.sh` tự gọi runner** (baseline 002..006 khi probe chỉ-đọc đạt, rồi migration 007+, rồi ghi version); người vận hành thường không cần gõ lệnh runner, trừ khi xử lý sự cố (mã thoát ở dưới).

- **Số phiên bản trong image:** stage `builder` của `RealEstateBackendApp/Dockerfile` ghi `dist/version.json` = `{ "version": <package.json>, "commit": <GIT_COMMIT hoặc null> }` sau `npm run build`; stage `production` chép cả `dist/` nên file có trong image (image production **không có** `package.json`). Runner đọc `dist/version.json`, không có thì rơi về `package.json`. `GIT_COMMIT` là build arg do compose truyền (`${GIT_COMMIT:-unknown}`), `deploy.sh` đặt nó từ `git rev-parse --short HEAD`; build tay không đặt thì `commit` là `null`. Đổi `GIT_COMMIT` chỉ làm lại lớp nhỏ ghi file (không mất cache `npm run build`).
- **Lệnh runner** (chạy trong container backend; đặt `RUN="docker compose run --rm --no-deps backend node dist/migrations/cli.js"`):

  | Lệnh | Tác dụng | Mã thoát |
  |---|---|---|
  | `$RUN status [--json]` | **Chỉ đọc**: version, đã áp dụng, đang chờ, khóa, lỗi gần nhất | `0` ok · `3` đang có khóa · `4` cần baseline (chỉ khi sổ chưa đủ 002..006) |
  | `$RUN up` | **Dry-run mặc định**: liệt kê migration chờ, không ghi gì | `0` ok · `1` lỗi/từ chối · `2` sai tham số · `3` khóa · `4` cần baseline · `5` downgrade (không ghi gì) |
  | `$RUN up --apply [--by deploy\|cli]` | Chạy migration chờ theo thứ tự (cần replica set; giành khóa; lỗi thì dừng, không retry, không rollback, không ghi sổ cho cái lỗi); xong thì ghi `version`. Từ PT-027 bổ sung `deploy.sh` dùng `reconcile` (dòng dưới) thay lệnh này | `0` ok · `1` lỗi/từ chối · `2` sai tham số · `3` khóa · `4` cần baseline · `5` downgrade (version code < DB: không ghi gì, không hạ `version`) |
  | `$RUN reconcile [--apply] --by deploy\|cli [--skip-version] [--json]` | **Lệnh `deploy.sh` dùng.** Dry-run mặc định (in kế hoạch). `--apply`: theo bảng trạng thái bên dưới, tự baseline 002..006 khi probe chỉ-đọc đạt, chạy migration chờ, ghi `version` (trừ khi có `--skip-version`). `--json` in đúng một dòng JSON ra stdout (`report.probes[]` có thêm khóa `reason`: chuỗi hoặc `null`, nêu lý do probe không đạt hoặc không xác minh được) | `0` ok · `1` lỗi/từ chối · `3` khóa · `4` cần xử lý tay (probe không đạt) · `5` downgrade |
  | `$RUN unlock` | Gỡ khóa còn sót (chỉ khi chắc không có runner nào đang chạy) | `0` |
  | `$RUN baseline [--apply] --version <x.y.z> [--commit <sha>]` | **Lối thoát thủ công, chạy MỘT lần**: ghi sổ 002 đến 006 là đã áp dụng + `version` (không chạy lại chúng, **không probe**: người chạy tự chịu trách nhiệm đã kiểm). `--version` phải là semver chuẩn **không có số 0 đứng đầu** (`1.0.3`, không phải `1.0.03`); pre-release/build sai định dạng cũng bị từ chối với mã `2`. Dry-run mặc định | `0` · `2` sai tham số |

  Muốn đọc nhanh bằng mắt không cần `--json`: `$RUN status`.
- **Việc `deploy.sh` làm ở bước 6a, 6b, 8b:** xem bảng bước ở trên. Nó **gọi** runner (lệnh `reconcile`), không chứa logic migration. Hợp đồng gọi: `docker compose run --rm --no-deps backend node dist/migrations/cli.js reconcile [--apply] --by deploy [--skip-version] [--json]`; dry-run là mặc định; `--json` in đúng một dòng JSON ra stdout.
- **Tự baseline + tự migrate theo version (mặc định BẬT; `--no-migrate` hoặc `DEPLOY_AUTO_MIGRATE=0` để tắt).** Sau backup (bước 5) và build (6a), `reconcile` quyết định theo trạng thái đọc được trong `system` và version của code:

  | Trạng thái | Hành động | Mã |
  |---|---|---|
  | `system` trống, `users` rỗng (DB mới tinh) | không baseline; chạy migration chờ từ 007; ghi `version` **ngay ở 6b** (kể cả `--skip-version`; 8b là no-op) | `0` |
  | `version` đã có nhưng sổ thiếu 002..006 | tin `version` (DB lập sau khi có sổ, không cần legacy), không probe | `0` |
  | `version` chưa có, `users` có dữ liệu, sổ thiếu 002..006 | chạy **probe chỉ-đọc** cho id còn thiếu. Đạt hết: ghi sổ `by=baseline` (kèm số đếm làm bằng chứng, không PII), rồi chạy migration chờ, rồi ghi `version`. Có probe không đạt: **không ghi gì**, in id không đạt, số đếm, lệnh xử lý | `0` / **`4`** |
  | `version` chưa có nhưng sổ đã đủ 002..006 (baseline dở dang) | bỏ qua probe, chạy tiếp như dòng dưới | `0` |
  | version code = version DB, không migration chờ | không làm gì | `0` |
  | version code = version DB, có migration chờ | vẫn chạy (sổ là sự thật), in cảnh báo | `0` |
  | version code > version DB | chạy migration chờ theo thứ tự (dừng ở lỗi), ghi `version` | `0` / `1` |
  | **version code < version DB (downgrade)** | **không ghi gì** (không migrate, không hạ `version`) | **`5`** |
  | đang có khóa | không làm gì | `3` |
  | sổ không liền mạch (id lớn đã có mà id nhỏ hơn chưa) | từ chối, không chạy sai thứ tự | `1` |

  Phân công giữa hai bước: **6b** chạy `reconcile --apply --skip-version` (version **chưa** ghi vì code mới chưa chạy, trừ DB mới tinh: ghi ngay); **8b** chạy `reconcile --apply` (lúc này chỉ còn ghi `version`, lỗi chỉ cảnh báo). Backup mongodump (bước 5, đã kiểm nội dung) luôn **trước** mọi ghi; `STACK_TOUCHED=1` được đặt ngay trước `--apply`; nếu `BACKUP_FILE` rỗng thì **không** chạy `--apply`, **trừ** đúng trường hợp DB chưa có dữ liệu ở bước 5 (không `users`, không collection nào có document; script kiểm lại ngay trước `--apply`, lệch thì dừng). Quy tắc "luôn backup trước khi ghi" giữ nguyên cho mọi DB đã có `users`. Trước `--apply`, `deploy.sh` chạy thêm một lần `reconcile` **dry-run** để in kế hoạch và để mã 3/4/5/1 luôn dừng khi stack **chưa đổi**. Khóa deploy `.git/realestate-deploy.lock` và khóa `migration-lock` trong `system` giữ nguyên.
- **Probe: "dry-run của chính migration báo 0 việc".** 002 đến 006 đều idempotent, nên "đã áp dụng" được định nghĩa là **dữ liệu hiện tại không còn việc cho migration đó** (chỉ dùng thao tác đọc). Không có cờ khai báo tay; probe không đạt thì **dừng (mã 4)**, runner **không tự chạy** migration cũ (002 và 006 có bước xóa).

  | Migration | Probe "đã xong" khi |
  |---|---|
  | 002 | mọi bài (`raw_articles`, `news_articles`) có `url` đều có `urlHash` đúng SHA-256 hiện hành và không có nhóm trùng `url` |
  | 003 | `googledrivetokens` không còn TTL index trên `expiresAt` (collection chưa có = đạt) |
  | 004 | không còn user thiếu field `teamId` (index `{teamId, status}` chỉ báo, do autoIndex của Mongoose bù khi backend khởi động) |
  | 005 | không còn user chưa có `roles[]`/`teamIds[]` (cùng bộ lọc với `UserRolesMigrationGuard` và `check_users_migrated`) |
  | 006 | dry-run `migrateAreasTo34Provinces` báo 0 việc (không còn khu vực cũ, không còn tham chiếu cần xóa, đủ 34 tỉnh) |

  Rủi ro còn lại (đã nêu với Oniichan): probe kiểm **trạng thái cuối**, không kiểm "lịch sử đã chạy"; nếu 002/003/004 thực tế chưa từng chạy nhưng dữ liệu không còn việc thì ghi sổ vẫn vô hại. Probe 002 quét hai collection bài viết (chỉ đọc 2 trường); nếu chậm ở quy mô lớn thì phải tối ưu.
- **Lần đầu trên production (deploy 1.0.3 đầu tiên).** `system` còn trống nhưng `users` đã có dữ liệu, nên `reconcile` sẽ probe 002..006 rồi baseline. Chạy **một lần** trước, chỉ để xem (không backup, không ghi DB, không `up`, stack không đổi):

  ```bash
  bash deploy.sh --plan-only            # pull + build image backend, rồi reconcile dry-run; thoát 0 nếu kế hoạch ổn
  ```

  Đọc kết quả probe 002..006. Nếu cả 5 đạt và kế hoạch là "ghi sổ baseline, ghi version 1.0.3" thì chạy deploy thật: `bash deploy.sh` (tự backup, tự baseline, `up`, ghi version). Không còn quy trình 5 bước tay (kiểm 005/006, backup, dry-run baseline, baseline, deploy lại). Version ghi vào `system` là version của app đang deploy (`1.0.3`); sổ `by=baseline` kèm số đếm là bằng chứng.
- **Triển khai mới (chưa có container Mongo):** lần deploy đầu bỏ qua backup (bước 5) và migration trước `up` (6b) vì không có DB để đọc/ghi (có cảnh báo), rồi `up -d --no-build` (image dựng sẵn bằng `release.sh build`, mục 0.1); sau liveness, bước **8a** chạy `reconcile --apply --by deploy` (bản vá T-19) nên cài mới chỉ cần MỘT lần deploy và `version` được ghi ngay. "Cài mới" nghĩa là không container Mongo **và** không volume `<project>_mongo_data`; có volume mà thiếu container thì KHÔNG phải cài mới (không chạy 8a). (Đoạn mô tả dưới đây về "lần deploy sau" là hành vi trước bản vá T-19, giữ lại cho trường hợp 8a bị bỏ qua.) Ở lần deploy **sau** (Mongo đã có container), `reconcile` chạy bình thường: vì `users` đã có admin, nó đi theo hàng "`version` chưa có, `users` có dữ liệu" của bảng trên (probe 002..006, đạt hết thì baseline rồi ghi `version`). Kết quả phụ thuộc probe 006 (đòi đủ 34 tỉnh): nếu CRM đã bật seed khu vực thì 34 tỉnh đã có; nếu `areas` còn rỗng thì kết quả phụ thuộc việc probe 006 có chấp nhận `areas` rỗng hay không (đang là việc riêng ở phía code runner, tài liệu này chưa khẳng định). Probe không đạt thì deploy dừng mã 4 trước `up` theo mục "Mã 4" bên dưới; đọc output để biết id nào không đạt. Mongo đã chạy nhưng DB chưa có dữ liệu (kịch bản 13 bên dưới) là trường hợp khác: `users` chưa có thì không backup, runner ghi `version` ngay ở 6b.
- **Khi `deploy.sh` dừng trước `up` (stack chưa đổi), theo mã thoát của runner:**
  - **Mã 3 (khóa):** có runner khác đang chạy, hoặc tiến trình chết để lại khóa mồ côi. Kiểm `docker ps` không còn lệnh `... node dist/migrations/cli.js` nào đang chạy rồi `$RUN unlock`, chạy lại deploy. Không tự gỡ khóa theo thời gian vì có thể phá một migration đang chạy lâu.
  - **Mã 4 (cần xử lý tay):** ít nhất một probe của 002..006 không đạt (dữ liệu còn việc, hoặc không xác minh được). Runner không ghi gì. Output nêu id và số đếm. Xử lý: chạy migration tương ứng bằng tay, có backup mới, dry-run trước: 005/006 bằng `bash scripts/run-migration.sh 005|006` (mục 5.4a); 002/003/004 cũng bằng `bash scripts/run-migration.sh 002|003|004` (script ts-node ở `RealEstateBackendApp/scripts/migrations/`, chạy trong image dựng từ stage `builder`; `--apply` vẫn bắt buộc backup mongodump mới; riêng **002 `--apply`** in cảnh báo XÓA VĨNH VIỄN bản trùng url, đòi gõ `XOA-BAN-TRUNG-URL` (hoặc `--yes`), và kiểm backup chứa cả `realestate.users` lẫn `raw_articles`/`news_articles` đang tồn tại trong DB: snapshot NDJSON của script nằm trong container nên mất khi thoát, đường lui duy nhất là backup mongodump). Rồi chạy lại `bash deploy.sh`.
  - **Mã 4 do probe 002 vượt trần** (dữ liệu bài viết rất lớn): probe 002 có **trần 1.000.000 doc mỗi collection hoặc 5 phút**; vượt thì probe báo "không xác minh được" (`reason` trong output) và runner dừng mã 4, **không phải dữ liệu hỏng**. Làm: (1) dry-run script 002 bằng tay: `bash scripts/run-migration.sh 002` (đọc kỹ: phải báo không còn urlHash MD5 và không còn url trùng); (2) nếu 0 việc, ghi baseline tay với đúng `--version`/`--commit` của bản đang deploy: `$RUN baseline --version <x.y.z> --commit <sha>` (dry-run) rồi thêm `--apply`; (3) chạy lại `bash deploy.sh`. Hằng số trần chỉnh ở `RealEstateBackendApp/src/migrations/baseline-probes/probe-002-urlhash.ts` (`PROBE_002_MAX_DOCS_PER_COLLECTION`, `PROBE_002_MAX_DURATION_MS`), phải build lại image sau khi đổi.
  - **Mã 5 (downgrade):** version trong DB cao hơn version của code sắp deploy, thường do gửi nhầm gói (bản cũ hơn bản đang chạy). Runner không ghi gì. Kiểm lại phiên bản gói đã gửi/cài (`release.env`). Cố ý khôi phục bản cũ: `DEPLOY_ALLOW_DOWNGRADE=1 bash deploy.sh`; khi đó `deploy.sh` **bỏ qua migrate** và **không ghi/hạ `version`** (DB giữ version cao hơn), cảnh báo rõ. Code cũ có thể không đọc được dữ liệu đã migrate: đọc mục 11.6 (đường lùi/sửa tiến) trước khi dùng.
  - **Mã 1 (lỗi hoặc từ chối):** kết nối Mongo lỗi, sổ không liền mạch, version DB sai định dạng, Mongo không phải replica set (runner từ chối ngay cả ở **dry-run** và `--plan-only`, sau khi in probe và kế hoạch; nếu dùng nguyên URI có `replicaSet=rs0` trên Mongo standalone thì lỗi là `Server selection timed out`), hoặc một migration (007+) lỗi giữa chừng. Ở bước dry-run: stack chưa đổi. Ở `--apply`: có thể một migration đã chạy dở nên dữ liệu đổi một phần; `deploy.sh` in hướng dẫn "không quay code/image cũ", sửa nguyên nhân rồi chạy lại.
- **Lệnh `baseline` thủ công: lối thoát, giữ nguyên.** Dùng khi đã tự kiểm 002..006 (ví dụ sau khi xử lý mã 4 bằng cách khác, hoặc chạy với `--no-migrate`): `$RUN baseline --version <x.y.z> --commit <sha>` (dry-run), thêm `--apply` để ghi; sau đó `$RUN status` phải thoát `0` rồi chạy `bash deploy.sh`. `--no-migrate` giữ hành vi cũ: `status`, còn việc chờ hoặc cần baseline thì dừng trước `up` và in lệnh (cách A: bỏ `--no-migrate`; cách B: làm tay). **Phạm vi của cờ:** `--no-migrate` chỉ chặn migrate **trước `up`** (bước 6b); bước 8b sau khi backend sống vẫn chạy `reconcile --apply` nên vẫn ghi `version` khi DB sạch (không còn việc chờ). **Ngoại lệ cài mới:** `--no-migrate` + cài mới thật sự (không container, không volume Mongo) thì bước 8a vẫn chạy `reconcile --apply` đủ 007/008/009 + `version` trên DB trống (an toàn vì không có dữ liệu để hỏng); nếu có volume Mongo mà không có container thì 8a không chạy. Ở chế độ này `deploy.sh` **không** phát hiện downgrade ở bước 6b; bước 8b vẫn không bao giờ hạ `version` (runner trả mã 5, chỉ cảnh báo).
- **Khóa còn sót** (runner chết giữa chừng, kể cả chết giữa lúc ghi sổ baseline): `reconcile`/`status` thoát mã `3`, `deploy.sh` dừng trước `up`; kiểm `docker ps` không có `... run ... node dist/migrations/cli.js` nào đang chạy rồi `$RUN unlock`. Chạy lại là an toàn: id đã vào sổ được bỏ qua, probe chỉ chạy cho id còn thiếu, không nhân đôi. Chết sau pha migrate (trước hoặc sau `up`) mà chưa ghi `version`: lần sau (hoặc bước 8b) chỉ còn ghi `version`.
- **Migration lỗi:** runner dừng ở cái lỗi, ghi `migration-last-error` (đã lọc chuỗi kết nối), thoát mã `1`; dữ liệu có thể đã đổi một phần. **Không quay về code/image cũ**: sửa nguyên nhân rồi chạy lại `up --apply` (mỗi migration phải chạy lại được an toàn); cần hoàn tác thì khôi phục `mongorestore` từ `backups/deploy-pre-*` (mục 6). **Ngoại lệ v1.0.4:** nếu migration đã `--apply` xong là 007 và/hoặc 008 (chỉ thêm trường, vẫn ghi id cũ) thì lùi image `pre-<thời-gian>` là an toàn (L1; L2 `$unset` sau khi lùi; L3 mongorestore là cuối cùng), xem mục 11, mục 2 và 3 của danh sách hướng dẫn khi lỗi. Bước 8c (bù mã danh mục) sẽ chạy lại ở lần tiến sau.
- **Đĩa:** runner chạy bằng image backend của gói phát hành đã cài (không build trên VPS) nên **không cần** `docker build --target builder` (~3,75 GB, ~13 phút) như `scripts/run-migration.sh`; đây là lý do 007 trở đi dùng runner.

`deploy.sh` trước đây nằm trong `.gitignore` (là script cục bộ của VPS); nay là file được quản lý trong repo, và `/backups/`, `/logs/`, `/tmp/` ở gốc repo được ignore (backup chứa dữ liệu khách hàng, không được commit).

### 11.2. Kịch bản thử `deploy.sh` trên stack thử (trước khi dùng trên VPS)

> **Lịch sử (trước v1.0.6).** Các kịch bản dưới đây diễn tập `deploy.sh` bản cũ (có `git pull`, build trên VPS, cờ `--no-pull`). **Hành vi của runner migration (bước 6b) vẫn đúng**; các lệnh `bash deploy.sh --no-pull` đã được đọc là `bash deploy.sh` (cờ `--no-pull` đã bỏ), và bước "build" nay là `release.sh build` ở máy build. Thử một kịch bản ở v1.0.6 cần image đã nạp (`docker load`) và gói đã cài (mục 0).

Đừng thử thẳng VPS. Dùng stack thử: một Mongo replica set tạm (như mục 5.4a đã làm ở máy dev) với project/compose riêng (đổi `MONGO_CONTAINER`, `BACKEND_CONTAINER`, `HEALTH_URL`; không đụng stack thật) và một bản sao dữ liệu giả của production 1.0.2 (users đã 005+004, 34 tỉnh, `urlHash` SHA-256, không TTL index, `system` trống). Mỗi trường hợp chạy từ trạng thái sạch (khôi phục từ dump giả trước mỗi lần), ghi lại output và `$RUN status` sau đó.

| # | Cách tạo tình huống | Lệnh | Kỳ vọng |
|---|---|---|---|
| 1 | Production giả như trên, **không** migration chờ | `bash deploy.sh --plan-only` | Thoát `0`. Không có `mongodump`, không `up`. Output nêu probe 002..006 đạt và kế hoạch baseline + ghi version. Sau đó `system` **vẫn trống** |
| 2 | Như 1 | `bash deploy.sh` | Backup, build, `reconcile` dry-run, `reconcile --apply --skip-version` (ghi sổ 002..006 `by=baseline`), `up`, liveness, `reconcile --apply` ghi `version`. `$RUN status` thoát `0`, version = version app |
| 3 | Chạy lại ngay sau 2 | `bash deploy.sh` | Không baseline lại, không migrate, `version` không đổi, thoát `0` (idempotent) |
| 4 | Thêm một migration 007 giả vào registry (image thử), DB đã ở version cũ hơn | `bash deploy.sh` | Backup trước, **rồi** 007 chạy ở 6b, `up`, ghi version. `system` có `migration:007_...` |
| 5 | Như 4 nhưng 007 ném lỗi | `bash deploy.sh` | `--apply` mã `1`: **không** ghi 007 vào sổ, **không** ghi version, in hướng dẫn "không quay code cũ" (stack đã bị coi là chạm). Chạy lại sau khi sửa: hoàn tất |
| 6 | Production giả nhưng **một** probe không đạt, từng probe một: `urlHash` MD5 (002), TTL index còn (003), user thiếu `teamId` (004), khu vực cũ còn (006) | `bash deploy.sh` | Dừng **trước `up`** với mã runner `4`, in id không đạt và lệnh xử lý; `system` **không có** ghi mới; stack không đổi (kiểm `docker compose ps` và id container backend không đổi). **Biến thể 005** (user thiếu `roles[]`/`teamIds[]`) dừng **sớm hơn**: ở cổng `check_users_migrated` (bước 3b), trước cả backup và runner, nên **không** có mã runner `4`; `deploy.sh` thoát mã `1` với hướng dẫn `bash scripts/run-migration.sh 005`; không có backup mới, không gọi runner, `system` không ghi, stack không đổi |
| 7 | Production giả, tắt tự migrate | `bash deploy.sh --no-migrate` | `status` mã `4`: dừng trước `up`, in cách A/B. Stack không đổi |
| 8 | DB đã ghi `version` cao hơn code (ví dụ sửa `version` thử lên `9.9.9`) | `bash deploy.sh` | Dừng trước `up` với mã `5`, in cách cố ý; không ghi gì |
| 9 | Như 8 | `DEPLOY_ALLOW_DOWNGRADE=1 bash deploy.sh` | Cảnh báo downgrade; **không** migrate; `up` chạy; bước 8b bị bỏ qua; `version` trong DB vẫn `9.9.9` |
| 10 | Khóa mồ côi: chèn tay `migration-lock` vào `system` | `bash deploy.sh` | Dừng trước `up` với mã `3`, in `unlock` kèm hướng dẫn `docker ps`; sau `unlock` chạy lại: bình thường |
| 11 | Mongo không phải replica set (standalone thử; URI backend **không** có `replicaSet=rs0`, dùng `directConnection=true`) | `bash deploy.sh` (và `--plan-only`) | Ngay **dry-run** `reconcile` đã thoát mã `1` ("Từ chối: MongoDB không phải replica set nên --apply sẽ bị từ chối"), `deploy.sh` dừng **trước `up`**, stack không đổi; `--plan-only` cũng thoát `1`. Probe và kế hoạch vẫn được **in ra** trước khi bị từ chối (đọc được), nhưng không có bước `--apply` nào chạy. Nếu dùng nguyên URI có `replicaSet=rs0` trên Mongo standalone thì runner không kết nối được: lỗi `Server selection timed out` (mã `1`), không in kế hoạch |
| 12 | Triển khai mới (chưa có container `realestate_mongo`) | `bash deploy.sh` | Bỏ qua backup và migration (có cảnh báo), `up` chạy; lần deploy sau mới ghi `version` |
| 13 | **DB mới tinh** (Mongo đã chạy, `system` trống, `users` rỗng). Hai biến thể: **13a** `users` tồn tại nhưng rỗng; **13b** DB `realestate` chưa có cả collection `users` (backend chưa boot lần nào) | `bash deploy.sh` | 13a: backup chạy bình thường (mongodump vẫn sinh `realestate.users`). 13b: cảnh báo "DB chưa có dữ liệu", **bỏ qua backup**, vẫn cho `--apply` (script hỏi lại DB ngay trước khi ghi). Cả hai: không baseline; ở 6b (`--skip-version`) runner **ghi `version` ngay** (kế hoạch `versionToWrite` = version app, đã áp dụng); `up`; 8b là no-op mã `0`. `$RUN status` thoát `0`, version = version app |
| 14 | Probe 002 vượt trần (hạ tạm `PROBE_002_MAX_DOCS_PER_COLLECTION` xuống vài doc trong image thử, dữ liệu giả có nhiều bài hơn) | `bash deploy.sh` | Dừng **trước `up`** mã `4`, output nêu probe 002 "không xác minh được"; không ghi gì. Làm theo mục mã 4 ở trên (dry-run `run-migration.sh 002`, rồi `baseline` tay), chạy lại: hoàn tất |
| 15 | (v1.0.4, T-17/T-18) Bản sao dữ liệu production, image có CLI `crm-catalog-codes.cli.js` | `bash deploy.sh` | Sau `up`, liveness và 8b, log có dòng "Bước 8c" và lệnh `crm-catalog-codes.cli.js --apply` chạy **một lần**; có file `logs/deploy-catalog-codes-<thời-gian>.log`; thoát `0`; chạy lần hai: lệnh bù là no-op |
| 16 | Như 15 nhưng lệnh bù lỗi (ví dụ làm hỏng một bản ghi để CLI báo mồ côi, thoát mã `1`) | `bash deploy.sh` | Cảnh báo **đỏ** "bước bù mã danh mục (8c) THẤT BẠI (mã 1)" kèm đường dẫn log; `deploy.sh` thoát mã `1`, không in "Deploy xong"; log được ghi; backend vẫn chạy. Sửa nguyên nhân, chạy lại: hoàn tất |

**Đã diễn tập thật (2026-11-03, Docker thật trên Windows/Git Bash, project thử `rhs`, tên container riêng, log/seed/fixture ở `D:\Jobs\_deploy_rehearsal`, không phải VPS):** 14 kịch bản trên đã chạy, theo báo cáo diễn tập 14/14 đạt về hành vi sau khi sửa các lệch tìm thấy. Các lệch liên quan tới script/tài liệu đã xử lý: (L2) DB chưa có collection `users` làm bước backup chết (mongodump mã 0 nhưng archive không có `realestate.users`): nay `deploy.sh` phân loại DB bằng `classify_db` (xem bước 5); (L3) kịch bản 6 biến thể 005 dừng ở cổng `check_users_migrated`, không phải mã runner 4; (L4b) Mongo standalone bị runner từ chối ngay ở dry-run (kịch bản 11); (L5) cảnh báo `(\nmissing)` khi container chưa tồn tại (nay dùng `inspect_field`); (L1) tài liệu "triển khai mới" ở 11.1, phần probe 006 chấp nhận `areas` rỗng là việc ở phía code runner. Sau các sửa đó chỉ **chạy lại** trên Docker các kịch bản 1, 2, 12, 13 (13a và 13b) và ca mơ hồ (không `users`, `areas` có dữ liệu: `deploy.sh` dừng, mã 1); các sửa ở `classify_db` sau đó (kiểm "có dữ liệu" bằng `findOne` thay `estimatedDocumentCount`, trạng thái chỉ-`system` coi như trống) cũng đã được **chạy lại đầu-cuối bằng `deploy.sh` thật (2026-11-03, đều đạt)**: (L1) cài mới rồi `deploy` lần 2 (backup chạy vì `users` đã có admin, probe 006 đạt với `areasEmpty`, baseline 002..006 `by=baseline`, ghi `version`, `status` mã 0; lần 3 là no-op); (M2) 13a, 13b, kịch bản 2 (baseline thường) và trạng thái chỉ-`system`. **Trung thực về trạng thái chỉ-`system`:** khi ép `up` lỗi bằng cách bỏ `ADMIN_*` (backend crash), Mongoose vẫn kịp tạo `users` (rỗng) nên lần deploy sau đi nhánh `HAS_USERS` (có backup), **không** phải chỉ-`system`; muốn gặp đúng `EMPTY_SYSTEM_ONLY` phải dựng **thủ công** (dừng backend, xóa mọi collection trừ `system`), và đã kiểm theo cách đó. Trạng thái này thực tế chỉ xảy ra khi `up` lỗi trước khi backend khởi động. Từ lần này việc diễn tập lặp lại bằng một lệnh cố định: mục 11.3 "Staging local".

**Chưa kiểm được / không khẳng định:** (a) khóa chống chạy chồng `flock`: Git Bash trên Windows không có `flock` nên script bỏ qua khóa (có cảnh báo), cơ chế khóa chưa được thử; (b) việc `docker compose up` tạo lại container backend ở mỗi lần deploy: hành vi trên Docker Desktop (containerd) có thể khác Docker Engine trên Ubuntu, chưa đối chiếu; (c) dung lượng đĩa thư mục dữ liệu Docker (`/var/lib/docker`) không đọc được trên Windows nên bước 1b bị bỏ qua mục đó; (d) `mongodump` **không tạo prelude cho collection không tồn tại** (nên DB chưa có `users` làm `verify_backup_archive` từ chối): đây là hành vi quan sát được ở bước diễn tập, hiện `deploy.sh` né bằng `classify_db`; chưa thử với mọi phiên bản `mongo:7`; (e) kịch bản cài-mới-rồi-deploy-lần-hai (L1) chưa chạy; (f) toàn bộ chưa chạy trên VPS Ubuntu thật.

**Test bước 8c không cần Docker** (v1.0.4): `bash ops/tests/deploy-catalog-codes.test.sh` (thoát 0 nếu đạt). Trích `main`, `apply_catalog_codes`, `run_catalog_codes_cli`, `compose` từ `deploy.sh` thật, thay `docker` và các bước khác bằng stub ghi thứ tự gọi; chứng minh: lệnh bù chạy sau `up`, sau liveness và sau 8b, trước `compose ps`; gọi đúng `compose run --rm --no-deps -T backend node dist/migrations/crm-catalog-codes.cli.js --apply`; lệnh bù mã `1` hoặc `2` thì cảnh báo đỏ và deploy thoát `1`; log được ghi; downgrade có chủ ý thì bỏ qua. Test **không** chạy CLI với Mongo thật (đó là kiểm chứng T-18 trên bản sao: kịch bản 15 và 16 ở bảng trên).

**Test shell không cần Docker** (hàm lấy từ file thật, `docker` bị thay bằng stub trong thư mục tạm): `bash ops/tests/ops-common.test.sh` (thoát 0 nếu đạt). Nó phủ `inspect_field`, `classify_db` (bảng trường hợp, fail-closed khi mongosh lỗi/rỗng/chỉ có cảnh báo) và `auto_reconcile` (tổ hợp `BACKUP_FILE` × cờ DB trống × kết quả `classify_db`), nhưng **không** kiểm đoạn JS chạy trong mongosh. Đoạn JS (dùng `findOne`, không dùng `estimatedDocumentCount`, vì số đếm trong metadata có thể về 0 sau `kill -9` mongod trong khi collection vẫn có dữ liệu; đã tái hiện trên Mongo thật: sau `kill -9` `estimatedDocumentCount()` trả 0, `findOne` vẫn thấy document) chỉ kiểm được trên một Mongo thật, ví dụ container thử `docker run -d --name x_mongo -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=<pw> mongo:7` rồi gọi `nonempty_collections x_mongo` sau khi `source ops/lib/ops-common.sh` (đặt `LOG_PREFIX`).

### 11.3. Staging: VPS staging (hiện hành) và staging local (đã lỗi thời)

> **Cập nhật v1.0.6 (FR-22).** Staging local (`ops/staging.sh` + `docker-compose.staging.yml` + `.env.staging.example`, dựng stack giả ngay trên máy dev, diễn tập `deploy.sh` bản cũ) **không còn dùng được**: wrapper vẫn thêm cờ `--no-pull` vào `deploy.sh`, mà `deploy.sh` v1.0.6 từ chối cờ này (mã 2) và cũng không còn build. Các file đó **tạm giữ trong repo ở v1.0.6**; việc gỡ (T-46) chuyển sang v1.0.7 cùng CI/CD (mục 17). Đừng dùng chúng để diễn tập bản v1.0.6.

**Staging hiện hành là một VPS thật** chạy **đúng quy trình production** (mục 0), để kiểm bản phát hành trước khi lên production:

| Hạng mục | Staging (VPS) | Production |
|---|---|---|
| Đường đưa bản lên | `release.sh send --to <ssh-host-staging>` (chạy tay; CD tự động là kế hoạch v1.0.7, mục 17) | `release.sh send --to <ssh-host-production>` (chạy tay; job production của CD cần duyệt là kế hoạch v1.0.7) |
| Image | **cùng** cặp image `<version>-<commit>` đã dựng một lần | **cùng** cặp image đó (build một lần, chạy mọi nơi) |
| `.env` | một file `.env` riêng trên VPS staging (**bí mật giả/riêng**, không dùng chung với production), lập từ **cùng** mẫu `.env.example` | một file `.env` riêng trên VPS production |
| Dữ liệu | dữ liệu thử; có thể nạp bản sao đã ẩn danh khi cần diễn tập migration (xem 11.4 để hiểu cách làm; dump production chỉ để ở máy dev của người có quyền, **không** để lên VPS staging) | thật |
| Kiểm | `deploy.sh --plan-only`, rồi deploy thật; xem mục 7 (health), 11.1 (`status`), 11.6 (hậu-migrate) | như staging, sau khi staging đạt |

Địa chỉ, IP và tên tài khoản ssh của VPS staging **không ghi trong repo** (repo công khai): đặt trong `~/.ssh/config` của máy build (một `Host` bí danh dùng cho `--to`) (khi có CI/CD ở v1.0.7 thì thêm vào secret của CI/CD; xem mục 17). Lần ssh đầu tới VPS cần `ssh-keyscan -H <host> >> ~/.ssh/known_hosts` rồi đối chiếu fingerprint (mục 0.2).

Diễn tập tại chỗ trước khi lên production, theo thứ tự: `./release.sh send --to <staging> --dry-run`, `./release.sh send --to <staging>`, kiểm `docker compose ps`, `curl` readiness (mục 7), thử một thao tác thật, rồi `bash restore.sh --latest` (**dry-run**) để chắc đường lùi đọc được manifest. Chỉ sau khi staging đạt mới gửi cùng gói lên production.

**Gốc lịch sử của mục này.** Bản trước v1.0.6 mô tả `ops/staging.sh` (các lệnh `init`, `seed-prod102`, `deploy`, `status`, `down`, `reset`), project `realestate-staging`, container `rhstg_*`, cổng `127.0.0.1:13100/18080` và bí mật giả sinh vào `.staging/env`. Các kết quả diễn tập ở 11.2 và 11.4 (kịch bản migration 1..12, dump 007/008/009) vẫn là hồ sơ hợp lệ về **hành vi của runner migration**, nhưng các lệnh `bash deploy.sh --no-pull` trong đó nay đọc là `bash deploy.sh` (không còn cờ `--no-pull`). Test của rào chắn staging local (`bash ops/tests/staging.test.sh`) vẫn còn trong `ops/tests/` cho tới khi gỡ ở v1.0.7 (T-46).


### 11.4. A0 (v1.0.4): diễn tập migration 007/008/009 trên bản sao dữ liệu thật (T-18)

> **Lịch sử (trước v1.0.6).** Quy trình diễn tập dùng stack staging local (`ops/staging.sh`) và `deploy.sh --no-pull` của bản cũ. Kết quả về hành vi migration 007/008/009 trên dữ liệu thật vẫn đúng; muốn diễn tập lại hãy dùng VPS staging (mục 11.3).

Ngày 2026-11-06, `devops-agent`, dump production (file nằm ngoài repo, không ghi tên và dung lượng) do Oniichan cung cấp. **Chỉ ghi số đếm, không ghi dữ liệu cá nhân.** Môi trường: `mongo:7` replica set 1 node tạm (tên `tmp-t18-`, `127.0.0.1:27099`, `--tmpfs`, không mount volume), backend build từ working tree (`npm run build`, CLI chạy bằng `node` trên máy dev, không qua image). Đã dọn hết sau khi xong.

**Dữ liệu sau restore (4.809 document, 0 lỗi):** `customers` 8, `care_logs` 7, `appointments` 3, `projects` 10 (4 chưa xóa mềm), `areas` 34, `customer_statuses` 4, `catalog_items` 20, `persona_fields` 25, `users` 5. Sổ migration có 002..006 (baseline), version DB `1.0.3`.

| Bước | Kết quả (số đếm) |
|---|---|
| `reconcile` dry-run | Chờ 007, 008, 009; không ghi gì; thoát `0` |
| `crm-catalog-codes.cli` dry-run | 007: `areasCoded=34 projectsAreaCoded=9 customersStatusCoded=8 customersSourceCoded=7 customersAreaCoded=8 customersProjectsCoded=8 careLogsCoded=3 appointmentsCoded=0 orphans=0`; 008: `projectsCoded=10 projectsWithUnmapped=0 unmappedTexts=0` |
| `reconcile --apply` | 007, 008, 009 xong, số đếm đúng bằng dry-run; 009 tạo 2 index; thoát `0` |
| `reconcile --apply` lần hai | "Migration chờ: không có", thoát `0` |
| `crm-catalog-codes.cli` dry-run rồi `--apply` sau migrate | Toàn số `0` (cả 007 và 008), `orphans=0`, thoát `0` |

**Bất biến 3.1 (đếm):** khách có `statusId` 8, thiếu `statusCode` 0; `sourceId` 7, thiếu 0; `areaId` 8, thiếu 0; `interestedProjectIds` không rỗng 5, thiếu `interestedProjectCodes` 0; `care_logs.contactResultId` 3, thiếu 0; `appointments.projectId` 0; `projects.areaId` 9, thiếu `areaCode` 0; `areas` 34, thiếu `code` 0. Số bản ghi mà `…Id` trỏ tới danh mục có `code` khác `…Code`: **0** ở cả 7 cặp (kể cả từng phần tử của `interestedProjectIds`). `propertyTypeCodes` 12 giá trị trên 8 dự án, **0** giá trị ngoài `options[].value`, `unmappedPropertyTypes` 0; `propertyTypes` cũ giữ nguyên 8 dự án. Index `areas.code_1` unique partial có, hai index 009 có. Dữ liệu thật **không** có bản ghi thiếu `…Code` sau migrate (không có khách xóa mềm: 0).

**Ca DB trống (phát hiện lỗi thật):** DB mới hoàn toàn, hoặc DB có dữ liệu nhưng thiếu trường `persona_fields.key = property_type` (thử bằng xóa đúng một document cấu hình ở bản sao thứ hai), đều làm **008 ném `PropertyTypeFieldMissingError`** ("Seed trường chân dung property_type rồi chạy lại"), kể cả dry-run:
- `crm-catalog-codes.cli`: bước 007 OK, bước 008 LỖI, thoát `1` (cả dry-run lẫn `--apply`), tiến trình không chết giữa chừng, in tóm tắt từng bước.
- `reconcile --apply` (DB trống): 007 chạy xong và ghi sổ, **008 lỗi, runner dừng, thoát `1`, không chạy 009, không ghi `version`**; trạng thái sau đó: 007 đã ghi sổ, chờ 008 và 009, "Lỗi gần nhất" ghi 008. Xảy ra y hệt với bản dump thật đã bỏ `property_type`.
- Ý nghĩa (hành vi QUAN SÁT ĐƯỢC TRƯỚC KHI SỬA): chuỗi `deploy.sh` trên DB mới tinh (kịch bản 13 ở 11.2) đã **dừng ở 6b** vì trường `property_type` chỉ được seed khi backend khởi động lần đầu (`PersonaSeedService`), mà backend chưa chạy lúc 6b. **Đã sửa:** 008 khi thiếu trường `property_type` mà KHÔNG có dự án nào cần mã (`projects` rỗng hoặc không dự án nào có chữ loại hình cần dịch) thì coi là "không có việc": log cảnh báo `CẢNH BÁO`, thoát OK (cả dry-run lẫn `--apply`); runner chạy hết 007/008/009 và ghi `version`, CLI `crm-catalog-codes` thoát `0`, nên `deploy.sh` không còn dừng ở 6b/8c trên DB mới tinh. Thiếu trường mà CÓ dự án cần mã vẫn ném `PropertyTypeFieldMissingError` (cấu hình hỏng thật). Production (đã có `property_type`) không đổi hành vi. Đã kiểm bằng integration trên replica set (registry thật, DB trống); chưa chạy lại kịch bản 13 bằng Docker thật.

**`explain` truy vấn nhánh `$or` id/code (dữ liệu thật):** khách theo `statusCode`/`statusId`: `OR` hai `IXSCAN` (`deletedAt_1_statusCode_1_lastUpdatedAt_-1` và `statusCode_1`), 5 trả về, 5 document quét, 7 khóa; theo `sourceCode`/`sourceId`: `SUBPLAN > OR > IXSCAN(sourceCode_1) x2`, 7 trả về, 8 quét, 9 khóa; theo `interestedProjectCodes`/`interestedProjectIds`: `SUBPLAN > OR > IXSCAN(interestedProjectIds_1) + IXSCAN(interestedProjectCodes_1)`; lịch hẹn theo `projectCode`/`projectId`: `SUBPLAN > OR > IXSCAN(projectId_1_startAt_1) + IXSCAN(projectCode_1_startAt_1)`. Không có `COLLSCAN`. (Quy mô 8 khách nên chỉ chứng minh dùng index, không chứng minh hiệu năng ở quy mô lớn.)

**Tương thích lùi (L1, L2):** image v1.0.3 không có trên máy và không `pull` được, nên chạy **mã nguồn tag `v1.0.3` đã build** (`git archive` ra thư mục tạm ngoài repo, `nest build`, `node dist/main.js`, phụ thuộc lấy từ `node_modules` hiện tại; khác image thật ở lớp đóng gói, cùng mã ứng dụng) với Redis tạm, trỏ vào bản sao đã migrate. Khởi động bình thường, `GET /crm/customers` trả 8/8, `list-counts` `ALL=8`, `GET /crm/projects` 4 (đúng số dự án chưa xóa mềm). **L2** theo đúng danh sách ở trên (mongosh, đếm trước/sau): `modifiedCount` `customers` 8, `care_logs` 3, `appointments` 0, `projects` 10, `areas` 34; sau đó mọi trường mã mới bằng `0`, tổng bản ghi không đổi, id cũ còn nguyên (`statusId` 8, `sourceId` 7, `areaId` 8, `contactResultId` 3, `projects.areaId` 9, `propertyTypes` 8 dự án). v1.0.3 khởi động lại **sau L2** vẫn trả đúng 8 khách, 4 dự án. Tiến lại: lệnh bù `--apply` điền lại đủ (`areasCoded=34`, `customersStatusCoded=8`, `projectsCoded=10`, ...), lần sau toàn `0`.

**Review `qa-agent` vòng 1 (T-18 bước 5, Arch 5.1.8):** không có lỗi Critical; bản vá 008 (ca DB trống / thiếu `property_type`) đạt; các việc QA nêu đã đóng. Kịch bản 13 (DB trống) đã xác nhận bằng integration test sau bản vá 008; **chưa** chạy `deploy.sh` Docker thật trên DB mới tinh.

**Bổ sung L1 bằng image v1.0.3 thật (2026-11-06, `devops-agent`):** build image từ `git archive v1.0.3` ra thư mục tạm ngoài repo (tag tạm `tmp-t18-v103:test`, build exit 0, 3 stage), chạy trỏ vào replica set `mongo:7` tạm (`tmp-t18-*`, `--tmpfs`, mạng riêng, cổng 127.0.0.1) dựng lại từ đúng dump trên (8 khách, 10 dự án, 34 khu vực), rồi migrate bằng `reconcile --apply` (007/008/009, thoát `0`) và `crm-catalog-codes.cli --apply` lần sau (`projectsCoded=0 projectsWithUnmapped=0 unmappedTexts=0`, thoát `0`). Image v1.0.3 (`FEATURE_CRM_ENABLED=true`, cần `CRM_PII_ENCRYPTION_KEY` giả) khởi động `Nest application successfully started`; với JWT ADMIN ký bằng secret giả: `GET /api/v1/crm/customers` 200 `n=8 total=8`, `GET /api/v1/crm/projects` 200 `n=4 total=4`, `GET /api/v1/crm/customers/list-counts` 200 `ALL=8`. Kết quả khớp lần chạy bằng mã nguồn ở trên: **image v1.0.3 đọc đúng DB đã migrate 007/008/009** (bản sao, không phải production). Đã dọn sạch container, mạng, image, volume ẩn và thư mục tạm `tmp-t18-*`; chỉ ghi số đếm.

**Chưa kiểm chứng:** chạy bằng image Docker **v1.0.4** thật và `deploy.sh` trên bản sao (CLI migrate vẫn chạy từ `node` trên máy dev); hiệu năng ở quy mô lớn; ca ghi/đọc ngược bằng image v1.0.3 sau L2 (L2 chỉ đã kiểm bằng mã nguồn v1.0.3); kịch bản 13 (DB trống) chạy `deploy.sh` Docker thật (gom vào T-19 hoặc diễn tập staging). `qa-agent` vòng 2 (2026-11-06) đã duyệt T-18; T-19 là task QA liên module riêng, ghi báo cáo vào mục này.

**Review và test xuyên module A0 (T-19, 2026-11-06, `qa-agent`):** chạy không cần Docker (replica set `mongodb-memory-server`, dữ liệu giả). Bộ A0 hiện có: 10 suite integration, 194 ca xanh (migration 007/008/009, lệnh bù, reconcile, ghi kép khách/nhật ký/lịch hẹn/dự án qua HTTP, lọc/đếm theo `code`, lệch `…Id`/`…Code` thì 400, bản ghi thiếu `code` vẫn lọc/đếm/chặn xóa `CATALOG_IN_USE`/`PROJECT_IN_USE`, `countActiveCustomersByProjects` đếm id-hoặc-code không đếm trùng, đổi nhãn không đổi `code`). Bổ sung `src/migrations/crm-a0-cross-module.integration.spec.ts` (2 ca): registry THẬT reconcile trên dữ liệu cũ chỉ-id ở mọi collection (ghi sổ đủ 007/008/009, bất biến 3.1 bằng 0, không đổi `updatedAt`/`version`, chạy lần hai không đổi dữ liệu) và kịch bản lùi rồi tiến (bản cũ ghi chen chỉ-id, reconcile không tự lành, lệnh bù dry-run không ghi, `--apply` điền đủ, lần sau không đổi). Toàn bộ unit BE: 164 suite, 2306 ca xanh; `tsc` BE 0 lỗi. Lỗi: Critical 0, High 0. Chưa làm được: kịch bản 13 chạy `deploy.sh` thật trên DB trống (cần Docker Desktop; logic đã được integration test phủ).

**Kịch bản 13 chạy `deploy.sh` Docker thật trên DB trống (T-19, 2026-11-06, `devops-agent`):** bản sao cô lập ngoài repo (`D:\Jobs\tmp-t19-work`, đã xóa), sinh từ `ops/staging.sh` + `docker-compose.staging.yml` với tên đổi sang `tmp-t19-` (project `tmp-t19-stg`, container `tmp-t19-*`, volume/mạng `tmp-t19-stg_*`, image `tmp-t19-stg-backend`), cổng `127.0.0.1:13190`, secret giả sinh ngẫu nhiên, `.env` thật không dùng. Hai chỗ khác bản repo, chỉ trong bản sao: đổi chuỗi tên project/container (kể cả hằng `realestate-staging` trong `check_staging_vars` của `deploy.sh`); mọi logic còn lại giữ nguyên. Image backend build từ cây làm việc hiện tại (`package.json` vẫn `1.0.3`: chưa nâng số bản, T-69; `GIT_COMMIT=unknown` vì bản sao không có `.git`). Mongo `mongo:7` replica set `rs0` + auth + keyFile như production.
- **Lần 1: `deploy.sh` trên DB trống (không có container, không volume): thoát `0`.** Build image OK; **6b bị bỏ qua** (`Chưa có container tmp-t19-mongo (triển khai mới?): bỏ qua migration`), backup bỏ qua (chưa có gì); `up -d --build` (v1.0.5) OK; mongo healthy, backend liveness OK sau ~11s, `docker compose ps` backend `healthy`; **8b bị bỏ qua** (`MIGRATION_GATE_RAN=0`); **8c chạy sau `up`, thoát `0`**: `[1/2] 007 OK` (toàn số `0`: `areasCoded=0 customersStatusCoded=0 ...`), `[2/2] 008 OK` (CẢNH BÁO "không có trường property_type", không có dự án cần mã nên bỏ qua, **không ném lỗi**). Trạng thái runner sau lần 1: **sổ rỗng, 3 migration chờ (007/008/009), `version` DB chưa có, `status` thoát `4` ("CẦN BASELINE": `users` đã có do backend seed admin)**; backend log cảnh báo "Còn 3 migration chờ chạy".
- **Lần 2: `deploy.sh` ngay trên DB đó: thoát `0`.** Backup `mongodump` OK (đã kiểm nội dung), thẻ image `pre-<thời-gian>`; dry-run: probe 002..006 **đều đạt** (0 việc), ghi baseline 002..006; `reconcile --apply --skip-version` chạy **007, 008, 009 hết** (008 `Xong`, không ném lỗi, cảnh báo như trên), 009 tạo index; backend liveness OK; 8b `Đã ghi phiên bản hệ thống: 1.0.3`; 8c thoát `0` (toàn `0`, 007/008 OK). `status` cuối: **Đã áp dụng 8 (002..006 baseline, 007/008/009 by deploy), Migration chờ: không có, Khóa: không có, thoát `0`.**
- **Kết luận:** 008 không ném lỗi trên DB trống ở cả hai đường (CLI bù ở lần 1, runner ở lần 2); bước bù 8c chạy sau `up` thoát `0`; backend healthy. Nhưng yêu cầu "007+008+009 chạy hết **trong một lần deploy** trên DB trống" **chưa đạt**: lần 1 chỉ chạy 8c (007+008 qua CLI bù, **không có 009**), reconcile phải đợi lần deploy thứ hai.
- **Phát hiện hạ tầng (không tự sửa, cần Oniichan/`architect-agent` quyết):** (1) [ĐÃ SỬA ở T-19 bản vá, xem mục "Bản vá T-19" bên dưới] `migration_gate` thoát sớm khi chưa có container Mongo, nên cài mới không ghi sổ/`version`, không chạy 009 (thiếu 2 index), và `status` báo mã `4` cho tới khi deploy lần hai (an toàn dữ liệu, vì DB trống; 2 index 009 thiếu chỉ ảnh hưởng hiệu năng cron/thumbnail). Hướng sửa gợi ý: ở nhánh "chưa có container" của deploy mới, sau `up` + liveness thì chạy `reconcile --apply --by deploy` (trên DB mới tinh runner tự ghi version, không cần backup), hoặc ghi rõ vào runbook "cài mới = chạy `deploy.sh` hai lần". (2) 008 vẫn cảnh báo thiếu `property_type` ở lần 2: trường `property_type` **chỉ được seed khi `CRM_ENABLED=true`** (`PersonaSeedService`); bản staging chạy cờ tắt sẽ không có trường này (lần chạy T-19 đã quan sát thiếu). Vô hại khi `projects` rỗng, nhưng **phải bật `CRM_ENABLED=true` và xác nhận đã có `property_type` trước khi nhập dự án thật** vào DB mới (xem "Kiểm tra trước khi import" ở cuối mục này).
- **Dọn dẹp:** `staging.sh reset --images --yes` (container, 3 volume, mạng, hai image `tmp-t19-stg-backend:latest`/`:pre-*`), xóa thư mục bản sao. Sau đó `docker ps -a`, `volume ls`, `network ls`, `images` không còn thứ gì `tmp-t19-` và đúng bằng trạng thái trước khi chạy. Không đụng Mongo dev/prod, container `mongodb`, `D:\mongodb`, volume cũ, `D:\Jobs\prod-dumps\`; không có dữ liệu cá nhân hay secret trong log/doc.

**Bản vá T-19: cài mới chỉ cần MỘT lần deploy (2026-11-06, `devops-agent`, Oniichan đã duyệt).** `deploy.sh`: `migration_gate` ở nhánh "chưa có container Mongo" đặt `FRESH_INSTALL=1` **chỉ khi cũng không có volume `<project>_mongo_data`** (hàm `mongo_volume_exists`; container bị `compose down/rm` mà volume còn dữ liệu thì giữ hành vi cũ: bỏ qua migration, in cảnh báo, không chạy migration không backup); sau `up` + mongo healthy + backend liveness, hàm mới `fresh_install_reconcile` (bước **8a**) chạy `reconcile --apply --by deploy` (cùng `run_migration_cli` với 6b/8b, không `--skip-version`, không backup vì DB trống): runner baseline 002..006 (probe đạt), chạy 007/008/009 và ghi `version`. Lỗi (mã khác 0) thì `die`: deploy exit 1, không chạy 8c, in lệnh chạy lại. Khi `FRESH_INSTALL=1`, `sync_system_version` (8b) bỏ qua vì 8a đã ghi version. Mọi nhánh khác (DB đã có dữ liệu, `--plan-only`, `--no-migrate`, downgrade) không đổi. Runbook: **cài mới = chạy `deploy.sh` MỘT lần**, không cần lần hai. Thông điệp cảnh báo của `migration_gate` đã đổi tương ứng.
- Test shell: `ops/tests/deploy-catalog-codes.test.sh` thêm ca cài mới (reconcile gọi đúng 1 lần, SAU `up` và liveness, TRƯỚC 8c, đúng `--apply --by deploy` không `--skip-version`; reconcile lỗi mã 1 và 4 thì deploy exit 1, không "Deploy xong", không chạy 8c; nhánh DB có dữ liệu vẫn đúng 1 reconcile và không có 8a). Bộ test shell: deploy-catalog-codes 56 đạt (gồm ca gate thật: volume, --no-migrate, --plan-only), ops-common 67 đạt, staging 105 đạt, 0 hỏng.
- **Kịch bản 13 chạy lại bằng Docker thật (bản vá, 2026-11-06):** cô lập `tmp-t19-` như lần trước (bản sao ngoài repo `D:\Jobs\tmp-t19-work`, project `tmp-t19-stg`, cổng `127.0.0.1:13190`, secret giả). **MỘT lần `deploy.sh` trên DB trống: thoát `0`.** 6b bỏ qua kèm cảnh báo mới; `up` OK; mongo healthy; liveness OK sau ~12s; **8a**: probe 002..006 đạt rồi baseline, 007 (toàn số `0`), 008 (cảnh báo thiếu `property_type`, không ném lỗi, vì không có dự án), 009 tạo 2 index, `Đã ghi phiên bản hệ thống: 1.0.3`; 8c thoát `0`; 4 container `healthy`. `status` ngay sau lần deploy đó: phiên bản app = DB = `1.0.3`, Đã áp dụng 8 (002..006 baseline, 007/008/009 by deploy), Migration chờ: không có, Khóa: không có, thoát `0`. Không cần lần deploy thứ hai. Chưa thử nhánh lỗi 8a bằng Docker thật (chỉ test shell). Điểm (2) ở phát hiện trên vẫn còn, ngoài phạm vi T-19: `property_type` chỉ được seed khi `CRM_ENABLED=true`, nên bản staging chạy cờ tắt sẽ thiếu trường này (008 chỉ cảnh báo vì chưa có dự án).

**Kiểm tra trước khi import dự án vào DB mới (chỉ đếm, không in dữ liệu cá nhân):**
1. Xác nhận `CRM_ENABLED=true` (và `FEATURE_CRM_ENABLED=true` nếu image dùng cờ này) trong env của backend đang chạy; nếu đang tắt thì bật rồi khởi động lại backend để `PersonaSeedService` seed.
2. Đếm trường đã seed, kết quả phải là `1`: `db.persona_fields.countDocuments({ key: 'property_type' })` (mongosh trong container mongo, chỉ in số đếm, không dùng `find()` in nội dung).
3. Nếu `0`: dừng import, không chạy `crm-catalog-codes --apply` cho tới khi đủ `1`; nếu cố chạy khi đã có dự án cần mã thì 008 ném `PropertyTypeFieldMissingError`.
- **Dọn dẹp:** `staging.sh reset --images --yes` rồi xóa thư mục bản sao và log tạm. Sau đó `docker ps -a` chỉ còn `realestate_dev_*` và `mongodb` như trước; volume, mạng, image `tmp-t19-` đều 0; không còn thư mục `tmp-t19` trong `D:\Jobs`. Không đụng Mongo dev/prod, `mongodb` cũ, `D:\mongodb`, `D:\Jobs\prod-dumps\`.

### 11.5. T-20: `npm audit` trước/sau và build image backend (Web Push, `sharp`)

> **Lịch sử (trước v1.0.6).** Lệnh `docker build` ở đây là cách làm cũ; từ v1.0.6 image dựng bằng `release.sh build` (mục 0.1). Kết quả `npm audit` và kiểm chứng `sharp`/Web Push vẫn là hồ sơ hợp lệ.

Ngày 2026-11-06, `devops-agent`. Phạm vi: `RealEstateBackendApp` thêm `sharp ^0.35.5`, `web-push ^3.6.7`, `@types/web-push ^3.6.4` (so với HEAD).

**`npm audit` trước/sau:** lấy `package.json` + `package-lock.json` ở HEAD (`git show HEAD:...`) và bản hiện tại ra hai thư mục tạm ngoài repo, chạy `npm audit --package-lock-only --json` (có và không `--omit=dev`). Hai lệnh thoát `1` ở cả hai bản (đều đã có lỗ hổng sẵn từ trước). Thư mục tạm đã xóa.

| Phạm vi | Bản | critical | high | moderate | low | tổng |
|---|---|---|---|---|---|---|
| `--omit=dev` | HEAD | 1 | 18 | 9 | 0 | 28 |
| `--omit=dev` | hiện tại | 1 | 18 | 9 | 0 | 28 |
| toàn bộ (cả dev) | HEAD | 3 | 19 | 26 | 3 | 51 |
| toàn bộ (cả dev) | hiện tại | 3 | 19 | 26 | 3 | 51 |

Tập tên gói có lỗ hổng (`--omit=dev`) **giống hệt** nhau (diff rỗng). **Kết luận: thêm `sharp`, `web-push`, `@types/web-push` (và phụ thuộc kéo theo) không tạo thêm lỗ hổng Critical/High nào, cũng không thêm lỗ hổng mức nào.** Critical/High còn lại đều có sẵn từ trước, không liên quan Web Push (Critical `proxy-addr`; High gồm `fastify`, `@nestjs/platform-express`, `multer`, `axios`, `undici`, `body-parser`, ... qua `@nestjs/*`, `firecrawl`); xử lý bump riêng ngoài phạm vi v1.0.4.

**Build image và compose (T-20):**
- `docker compose config` với biến giả: thoát `0`; 5 biến push (`FEATURE_CRM_PUSH`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_ENDPOINT_HOST_ALLOWLIST`) nằm trong `environment` của backend (không `build.args`, không vào image).
- `docker build RealEstateBackendApp` (tag tạm `tmp-t20-backend:test`, base `node:24.18.1-slim`): thoát `0`, 3 stage (`deps`, `builder`, `production`), khoảng 58 giây (có cache).
- Chạy container tạm từ image đó (`--entrypoint node`, `--rm`): `require('web-push')` in `sendNotification` và `generateVAPIDKeys` đều là `function`; `sharp` trên `-slim` (linux x64, Node 24.18.1) tạo ảnh 64x48 trong bộ nhớ, resize 32x24, `toBuffer` ra PNG, đọc lại `metadata()` được `png 32x24`, buffer khác rỗng. Tức binary `sharp` prebuilt chạy được trên image `-slim`.
- Đã xóa image `tmp-t20-backend:test` và mọi container tạm.

**Chưa kiểm chứng:** build trên kiến trúc khác (arm64) nếu VPS khác `linux/amd64`; `sharp` xử lý ảnh thật (JPEG/HEIC) và sinh thumbnail qua hàng đợi trong container production; chưa chạy `npm audit` trên VPS với registry thật (kết quả trên phụ thuộc cơ sở dữ liệu advisory lúc chạy).

### 11.6. v1.0.5 "Định danh khách hàng": điểm gọi hậu-migrate, thứ tự deploy, lùi, diễn tập bằng dump (T-19, FR-20, FR-21, FR-23)

> **Lịch sử (trước v1.0.6).** Thứ tự hậu-migrate, ranh giới bước 90 (011 một chiều) và đường lùi/sửa tiến ở mục này vẫn đúng. Riêng chi tiết về `git pull`, build trên VPS, cờ `--no-pull`, bundle/thẻ git `pre-deploy-<TS>` là của bản cũ: từ v1.0.6 đọc theo mục 0, 11 và 11.8.

Phần này mô tả hành vi **thực tế** của `deploy.sh` và `scripts/post-migrate/*.sh` (đã đối chiếu mã nguồn ngày 2026-11-10). Thiết kế gốc: `docs/06_Module_Customer_Management/11_Dinh_Danh_Khach_Hang_Architecture.md` mục 5.7 đến 5.10.

> **CẢNH BÁO: migration 011 là MỘT CHIỀU (không có `down`).** Nó bỏ ràng buộc unique của `customers.phone` (tạo lại `phone_1` thường) và đổi `phone` dạng `anonymized:<id>` về `null`. Sau khi chạy không dựng lại unique được (đã có SĐT trùng/`null`) và **không lùi image v1.0.3** được (mục 11.6.4). **Chưa lên production khi Oniichan chưa xác nhận** (sau diễn tập staging 11.6.5 và báo cáo đạt). Việc `deploy.sh` lên production là hành động không hoàn tác.

#### 11.6.1. Thứ tự deploy v1.0.5: 010 → `up` → 10 → 20 → 90

| Thứ tự | Bước của `deploy.sh` | Việc làm | Ghi chú |
|---|---|---|---|
| 1 | 5 | `mongodump` DB `realestate` ra `backups/deploy-pre-<thời-gian>.archive.gz` | Bắt buộc, là đường quay lại duy nhất sau 011 |
| 2 | 6b | `reconcile --apply --by deploy --skip-version --phase pre-up`: chạy migration **pre-up** còn chờ, gồm **010** (index partial unique `customers.customerCode_1` chỉ tính mã dạng chuỗi, và counter `CUSTOMER_CODE`; **không** bù mã, **không** đụng `phone`) | Image v1.0.3 vẫn đang phục vụ; 010 chỉ thêm nên image cũ không bị ảnh hưởng. Migration **011** (pha `post-up`) **không** chạy ở đây |
| 3 | 7, 8 | `up -d --no-build` rồi chờ Mongo healthy và backend liveness | Backend mới chạy; từ đây khách mới nhận mã ngay khi tạo |
| 4 | 8a / 8b | `reconcile --apply --by deploy --phase pre-up` (8a chỉ khi cài mới; 8b ghi `version`) | `version` do bước 8b ghi; bước 90 dùng `--skip-version` nên không ghi lại |
| 5 | **10** | `10-catalog-codes.sh`: bù mã danh mục (v1.0.4) | Giữ nguyên hành vi 8c cũ |
| 6 | **20** | `20-customer-codes.sh`: bù mã khách `KH-xxxxxx` | Khách cũ và khách image v1.0.3 tạo trong khoảng 6b → `up` chưa có mã |
| 7 | **90** | `90-post-up-migrations.sh`: migration 011 (bỏ unique SĐT, **một chiều**) | Đứng cuối có chủ ý: bù mã lỗi thì bước một chiều chưa xảy ra |

Với `--plan-only`: dry-run `reconcile` **không** truyền `--phase`, nên kế hoạch in đủ 007, 008, 009, 010 (pre-up) và 011 (post-up) (mục 11 bước 6b).

#### 11.6.2. Điểm gọi hậu-migrate và ba script

`main()` của `deploy.sh` gọi tuần tự `fresh_install_reconcile` (8a) → `sync_system_version` (8b) → `run_post_migrate_steps`. Hàm cuối chạy mọi tệp `scripts/post-migrate/[0-9][0-9]-*.sh` theo thứ tự tên bằng `bash <tệp>`; không có tệp nào thì `die`; `DOWNGRADE_ACTIVE=1` thì bỏ qua **toàn bộ**. Thêm bước mới = thêm một tệp đúng khuôn tên và hợp đồng (nhận `ENV_FILE`, `LOGS_DIR`, `TS`, `DOC`, `LOG_PREFIX` qua môi trường; tự ghi log; thoát khác 0 khi lỗi), không sửa `deploy.sh`. Mọi lệnh chạy trong container: `docker compose run --rm --no-deps -T backend node dist/migrations/<...>`. Các tệp không chạy tay bởi người dùng (trừ lệnh chạy lại ghi trong cảnh báo đỏ).

| Tệp | Lệnh trong container | Log (`logs/`) | Hành vi và khi lỗi |
|---|---|---|---|
| `10-catalog-codes.sh` | `crm-catalog-codes.cli.js --apply` | `deploy-catalog-codes-<thời-gian>.log` | Bù mã danh mục (007/008). Thoát khác 0 (`1` lỗi/mồ côi/thiếu mã, `2` sai tham số, hoặc docker lỗi): cảnh báo **đỏ** kèm lệnh chạy lại, `die`, **bước 20 và 90 không chạy** |
| `20-customer-codes.sh` | `crm-customer-codes.cli.js --apply` | `deploy-customer-codes-<thời-gian>.log` | Bù mã khách theo lô (mặc định 500) theo `createdAt, _id`, mỗi lô một transaction; idempotent (chạy lại không đổi mã đã cấp; chạy dở thì lần sau nối tiếp). Thoát khác 0: cảnh báo đỏ ("bước 90 CHƯA chạy") kèm lệnh chạy lại, `die`, bước 90 không chạy. **Lưu ý:** khi sổ chưa có migration 010 (`--no-migrate`, DB cũ...), CLI in "chưa áp dụng, bỏ qua" và **thoát 0 mà không ghi gì**; vì vậy mã thoát 0 ở bước này **không chứng minh** đã bù mã (logic "010 chưa áp dụng" nằm ở CLI, không ở shell). Cổng chặn nằm ở bước 90 |
| `90-post-up-migrations.sh` | (1) `cli.js status --json` (chỉ đọc), rồi (2) `cli.js reconcile --apply --by deploy --skip-version --phase post-up` | `deploy-post-up-<thời-gian>.log` | Chạy migration 011. **Cổng chặn trước `--apply`:** TỪ CHỐI (thoát `1`, không ghi gì) khi `status` thoát khác 0 (`3` có khóa, `4` cần baseline, ...), khi không đọc được danh sách chờ trong JSON (fail-closed), hoặc khi **còn bất kỳ migration pre-up chờ** (gồm 010 chưa áp dụng). Lý do: cổng này còn kiểm thêm điều runner không kiểm được (bước 20 có thể đã thoát 0 mà chưa bù mã vì sổ chưa có 010; không có cổng thì 011 bỏ unique khi khách chưa có mã). Runner cũng tự từ chối `--phase post-up` khi còn pre-up số nhỏ hơn chờ (mục 11.6.3, quy tắc hai chiều) nên lỗ hổng sổ (011 vào sổ, 010 chưa) bị chặn ở cả hai lớp. Lỗi `--apply` (thoát khác 0): cảnh báo đỏ "011 có thể đã chạy MỘT PHẦN: kiểm `status` trước", `die` |

Mọi bước lỗi đều kết thúc bằng `deploy.sh` thoát mã `1`, không in "Deploy xong", và (vì `STACK_TOUCHED=1` sau bước 7) in `print_recovery` (mục 11.6.4). Backend vẫn chạy bản mới. Log mỗi bước chỉ chứa đầu ra lệnh (không bí mật; PII không nằm trong đầu ra của CLI, chỉ số đếm). Nhớ chép/xóa log theo quy ước thư mục `logs/` hiện có.

#### 11.6.3. Cờ `--phase` của runner

- `reconcile` và `up` nhận `--phase pre-up|post-up|all` (mặc định `all`). Cờ chỉ **chọn** migration chờ theo pha (`pre-up` là mặc định của mỗi migration; 007 đến 010 là `pre-up`, 011 là `post-up`); không đổi cách ghi sổ, khóa hay mã thoát. `status` in `[pre-up]`/`[post-up]` cạnh mỗi migration chờ và dòng `Chờ post-up: N`.
- `deploy.sh` truyền `--phase pre-up` ở 6b (cả dry-run lẫn `--apply`), 8a và 8b; bước 90 truyền `--phase post-up`; `--plan-only` không truyền (mọi pha).
- **Quy tắc an toàn sổ (HAI chiều):** một lần chạy theo pha không được ghi sổ vượt mặt migration pha **kia** còn chờ có số **nhỏ hơn**; vi phạm thì runner **từ chối (mã `1`, không ghi gì)**, ở cả `up` lẫn `reconcile`, cả dry-run lẫn `--apply`; `--phase all` (mặc định) chạy theo thứ tự số nên luôn hợp lệ. Thông báo nêu id đang chờ và lệnh cần chạy trước:
  - Chạy `--phase pre-up` mà còn `post-up` chờ số nhỏ hơn một `pre-up` chờ: "chạy `--phase post-up` trước". Tình huống: bản sau (có migration 012 `pre-up`) deploy lên DB mà bước 90 của lần v1.0.5 chưa xong. Xử lý: chạy 011 trước (`$RUN reconcile --apply --by cli --skip-version --phase post-up`, sau khi bù mã) rồi deploy lại.
  - Chạy `--phase post-up` mà còn `pre-up` chờ số nhỏ hơn một `post-up` chờ (ví dụ 010 chưa áp dụng mà chạy 011): "chạy `--phase pre-up` trước". Lý do: 011 là một chiều, nếu ghi sổ khi 010 chưa chạy thì sổ có 011 mà thiếu 010, lần `reconcile` sau bị từ chối vì sổ không liền mạch và các pre-up chờ không bao giờ áp dụng được bằng runner. Chỉ xảy ra khi bỏ sót 6b hoặc chạy tay; `deploy.sh` luôn chạy pre-up (6b/8a/8b) trước bước 90 nên luồng deploy hợp lệ không bị ảnh hưởng. Xử lý: chạy `$RUN reconcile --apply --by cli --skip-version --phase pre-up`, bù mã (bước 20), rồi chạy lại bước post-up.
- Chạy tay khi cần (không qua `deploy.sh`; `RUN` như ở 11.1): `$RUN reconcile --by cli --phase pre-up` (dry-run), thêm `--apply` để ghi.

#### 11.6.4. Cửa sổ `E11000` giữa `up` và bước 90 (đã được Oniichan chấp nhận)

Từ lúc `up` xong đến khi bước 90 xong, `customers.phone_1` **vẫn là unique** (011 chưa chạy), trong khi backend mới cho phép khách không có SĐT (`phone: null`) và SĐT trùng. Hậu quả có thể xảy ra trong cửa sổ này: tạo khách **thứ hai không có SĐT**, hoặc khách trùng SĐT với khách khác, làm Mongo báo `E11000` và người dùng thấy lỗi tạo khách. Cửa sổ dài bằng thời gian bước 10 và 20 (bù mã theo lô: quy mô hàng nghìn khách thì vài chục giây đến vài phút; đo thật ở staging 11.6.5). **Đã chấp nhận** (Architecture 11.1b #4): giữ thứ tự 10 → 20 → 90, **deploy ngoài giờ cao điểm**, không làm gì thêm; hết cửa sổ khi bước 90 xong. Nếu bước 10/20 lỗi và deploy dừng thì cửa sổ **kéo dài đến khi sửa và chạy lại**: ưu tiên sửa nhanh hoặc lùi image (khi 011 chưa chạy, bảng dưới). Khách tạo bởi backend mới trong cửa sổ đã có mã ngay; mã chỉ có thể không đúng thứ tự thời gian tuyệt đối so với khách được bù (thông tin, 11.1b #9).

**Hướng dẫn lùi / sửa tiến (đồng bộ với `print_recovery` mục 2c của `deploy.sh`; chi tiết ngoại lệ ở mục 11, danh sách "Khi lỗi"):**

| Tình huống | Lùi image v1.0.3 | Việc làm |
|---|---|---|
| Lỗi **trước** bước 90, 011 **chưa** chạy (6b, `up`, bước 10, bước 20, hoặc bước 90 **từ chối** vì còn pre-up chờ) | **Được** (L1: `docker tag` + `up -d --no-build --no-deps backend`; 010 chỉ thêm nên v1.0.3 đọc bình thường, `phone_1` còn unique) | Chọn lùi hoặc sửa nguyên nhân rồi chạy lại `bash deploy.sh`. Khi tiến lại, bước 20 bù mã cho khách image cũ vừa tạo |
| Bước 90 `--apply` lỗi hoặc chạy dở | Chỉ khi **chắc 011 chưa chạy**: kiểm bên dưới trước. Runner không ghi sổ cho migration lỗi nhưng 011 làm tuần tự (gỡ unique, tạo `phone_1` thường, đổi `anonymized:` về `null`) nên có thể đã chạy một phần | Kiểm bên dưới; nếu `phone_1` đã không còn unique thì coi như **đã chạy**: chỉ sửa tiến |
| Bước 90 xong, 011 **đã** áp dụng (kể cả phát hiện lỗi về sau) | **KHÔNG** (`phone` có thể `null`/trùng, mapper v1.0.3 giả định chuỗi) | **Chỉ sửa tiến**: sửa nguyên nhân rồi deploy lại. Quay lại duy nhất bằng `mongorestore` từ `backups/deploy-pre-*` (mục 6, kèm `--nsInclude 'realestate.*'`; mất dữ liệu sau thời điểm dump) và **do Oniichan quyết định** |

**Cách kiểm 011 đã chạy chưa (chỉ đọc):** `$RUN status`, tìm `011_crm_drop_unique_phone (deploy, <ngày>)` trong mục **"Đã áp dụng"** (đã chạy) hay trong "Migration chờ ... `[post-up]`" với "Chờ post-up: 1" (chưa). Kiểm chéo trường hợp chạy dở: mongosh `db.getSiblingDB('realestate').customers.getIndexes()` (mẫu `docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin` có xác thực như L2 ở mục 11): `phone_1` còn `unique: true` = 011 chưa gỡ unique. Không dựa vào việc file `logs/deploy-post-up-<thời-gian>.log` có tồn tại: bước 90 tạo file ngay từ đầu, kể cả khi cổng chặn từ chối (lúc đó trong log chỉ có đầu ra `status`).

#### 11.6.5. Diễn tập bằng bản sao dump production ở staging (FR-21; Architecture 5.10)

Trước khi lên production, diễn tập toàn bộ chuỗi trên staging local (11.3) bằng **bản sao dump production** (Oniichan cung cấp; xem `D:\Jobs\prod-dumps` chỉ dùng cho việc này, không động production):

1. **Dump chỉ nằm trong `.staging/`** (thư mục đã `.gitignore` bằng `/.staging/`; không bao giờ commit, không gửi chat, không dán nội dung vào tài liệu hay log). Dump chứa dữ liệu cá nhân thật: chỉ ghi **số đếm** vào báo cáo.
2. Nạp vào staging bằng `bash ops/staging.sh restore-dump <đường-dẫn-archive> --yes`. Cờ `--yes` **bắt buộc** (lệnh không hỏi tương tác, và chỉ nhận cờ này, không nhận biến `STAGING_ASSUME_YES`); archive phải nằm trong `.staging/`; lệnh chỉ nhắm `rhstg_mongo`, cùng rào tên/cổng của wrapper, XÓA DB `realestate` **của staging** rồi nạp lại bằng `mongorestore`. Các lệnh phụ trợ của diễn tập: `snapshot [nhãn]` (chụp chỉ đọc số đếm, index, doc `system` vào `.staging/snapshots/`), `runner <lệnh...>` (chạy runner migration trên staging, vd `runner reconcile --apply --skip-version --phase pre-up`), `step3` (giả lập khoảng giữa 6b và `up`: chèn hai khách không mã và thử một khách trùng SĐT). Quy trình từng bước kèm kết quả mong đợi và bảng ghi kết quả nằm ở `ops/staging/REHEARSAL.md`.
3. Sáu bước diễn tập (Architecture 5.10): (1) chụp trước: số khách, số khách có SĐT trùng, số khách `anonymized:`, số khách `careTeam` không rỗng nhưng `primaryAssigneeId` null (phải `0`), `listIndexes` của `customers`, doc `system`; (2) `deploy --plan-only` (chờ 007..010 pre-up và 011 post-up); (3) giả lập khoảng 6b → `up`: chạy tay `reconcile --apply --skip-version --phase pre-up`, chèn hai khách **không có `customerCode`** (phải thành công nhờ index partial) và một khách trùng SĐT (phải **lỗi**: unique `phone_1` còn, xác nhận 011 chưa chạy); (4) `deploy` đầy đủ: 10 → 20 (mọi khách có mã, hai khách vừa chèn có mã) → 90; sau đó tạo hai khách cùng SĐT qua API phải thành công, không còn `anonymized:`, `phone_1` thường; (5) chạy lại (idempotent: không đổi mã, bước 20 báo 0 việc) và kịch bản `up` lỗi giữa chừng rồi deploy lại (bước 20 vẫn bù đủ); (6) đo thời gian từng bước, kiểm log `deploy-*.log`, kiểm `--no-migrate` (bước 20 thoát 0 khi sổ chưa có 010, bước 90 từ chối) và downgrade có chủ ý (bỏ qua toàn bộ điểm gọi).
4. **Xóa sau diễn tập:** `bash ops/staging.sh reset --yes` (xóa container và volume dữ liệu staging, kể cả `.staging/backups` và `.staging/logs`; thêm `--images` nếu muốn xóa luôn image staging) rồi xóa file dump khỏi `.staging/` (hoặc `rm -rf .staging`). Kiểm lại bằng `git status` rằng không có file dump nào bị theo dõi.
5. Báo cáo cho Oniichan (số đếm trước/sau, thời gian từng bước, cửa sổ `E11000` đo được) **trước khi** xin xác nhận lên production.

**Test shell không cần Docker cho điểm gọi hậu-migrate:** `bash ops/tests/deploy-post-migrate.test.sh` (105 ca đạt, gồm ca readonly như deploy.sh thật, cập nhật 2026-11-11 cho T-36) kiểm lớp shell: thứ tự 10 → 20 → 90 chạy tệp bước **thật** với `docker` giả, bước lỗi dừng các bước sau, đúng đối số và tên log, cổng chặn của bước 90 (từ chối khi còn pre-up chờ, `status` lỗi, thiếu danh sách chờ), 6b/8a/8b có `--phase pre-up`, `--plan-only` không có `--phase`, `deploy.sh` không còn logic bù mã ngoài điểm gọi chung, `print_recovery` có câu "sau bước 90 chỉ sửa tiến", downgrade có chủ ý bỏ qua toàn bộ. `deploy-catalog-codes.test.sh` vẫn đạt (69 ca). Hai test **không** chạy CLI với Mongo thật: đó là việc của diễn tập staging ở trên.

### 11.7. Sau deploy v1.0.5 (việc cho Oniichan và người vận hành)

> **Lịch sử (trước v1.0.6).** Thứ tự hậu-migrate, ranh giới bước 90 (011 một chiều) và đường lùi/sửa tiến ở mục này vẫn đúng. Riêng chi tiết về `git pull`, build trên VPS, cờ `--no-pull`, bundle/thẻ git `pre-deploy-<TS>` là của bản cũ: từ v1.0.6 đọc theo mục 0, 11 và 11.8.

v1.0.5 **xóa hẳn, không giữ bản chuyển tiếp** các endpoint của luồng cũ (Architecture 11.1b #5): máy còn chạy bản web/PWA cũ sẽ gọi vào route không còn và gặp lỗi cho tới khi tải bản mới.

| Đã xóa (trả `404`) | Dùng cho |
|---|---|
| `POST /api/v1/crm/customers/phone-lookups` | Kiểm tra trùng SĐT khi tạo khách |
| `PUT /api/v1/crm/customers/:id/care-team/primary` | Đổi người chăm sóc chính |
| `GET /api/v1/crm/assignable-users` (cả `purpose=assign` và `purpose=filter`) | Danh sách người gán/lọc; thay bằng `care-team-invitees` và `customer-assignees` |
| `POST/GET/PATCH /api/v1/crm/care-team-requests` | Đề nghị tham gia nhóm chăm sóc (và hộp thông báo của nó) |
| Trường `careTeam` ở body tạo khách (`POST /api/v1/crm/customers`) | Bản cũ gửi trường này nên bị `400` (ValidationPipe `forbidNonWhitelisted`: "property careTeam should not exist") |

**Việc cần làm sau khi `deploy.sh` xong:**

1. **Báo người dùng tải lại cứng hoặc đóng và mở lại PWA.** Trình duyệt máy tính: tải lại cứng (`Ctrl+F5` hoặc `Ctrl+Shift+R`). PWA đã cài trên điện thoại: đóng hẳn rồi mở lại; theo cấu hình `RealEstateAdminApp/vite.config.ts` (`registerType: 'prompt'`, mục 14) bản mới chỉ kích hoạt khi người dùng **bấm "Cập nhật"** trên thông báo, nên dặn bấm nút đó (không thấy thì tải lại cứng lần nữa). Cloudflare không được giữ `sw.js`/`index.html` cũ (mục 14.4); kiểm theo 14.3.
2. **Theo dõi `404` và `400` của các route trên vài ngày đầu** (số lượng giảm dần về 0 khi người dùng đã tải bản mới). Nginx của frontend ghi access log ra stdout của container, ví dụ (chỉ đọc):
   ```bash
   docker compose logs --since 24h frontend 2>&1 \
     | grep -E 'phone-lookups|assignable-users|care-team-requests|care-team/primary' | grep -E '" (404|400) '
   ```
   Route lạ lặp lại từ cùng một người dùng = máy đó chưa tải bản mới: nhắc tải lại. `400` do trường `careTeam` đi qua đường dẫn bình thường của `POST /api/v1/crm/customers` nên **không lộ trong lệnh trên**; nếu backend ghi log lỗi `400`, tìm chuỗi `property careTeam should not exist` (`docker compose logs --since 24h backend | grep 'careTeam'`), nếu không thì theo dõi số `400` của route này tăng bất thường. (Chưa kiểm trên stack thật mức chi tiết log `400` của backend.)
3. **Kiểm bằng `status` và số đếm sau deploy (chỉ đọc):** `$RUN status` thoát `0`, `011_crm_drop_unique_phone` nằm trong "Đã áp dụng", "Chờ post-up: 0"; `docker compose run --rm --no-deps -T backend node dist/migrations/crm-customer-codes.cli.js` (dry-run, không `--apply`) báo không còn khách thiếu mã; mongosh `customers.getIndexes()` thấy `customerCode_1` unique partial và `phone_1` **không** unique.
4. **Ghi nhận cho Oniichan:** migration 011 là **một chiều**; từ bước 90 trở đi chỉ sửa tiến, không lùi image v1.0.3 (11.6.4). Quay lại hẳn chỉ bằng `mongorestore` từ backup bước 5 (mất dữ liệu sau thời điểm dump) và do Oniichan quyết định.

### 11.8. Manifest v2 và bộ backup của mỗi lần deploy (bước 5a)

Mỗi lần deploy (trừ `--plan-only`) tạo trong `backups/` (thư mục 700, file 600; đường dẫn trong manifest **tương đối so với thư mục deploy**):

| File / thẻ | Nội dung |
|---|---|
| `deploy-pre-<TS>.archive.gz` | dump DB `realestate` (bước 5) |
| `deploy-pre-<TS>.env` | bản sao `.env` lúc deploy (**có bí mật**, quyền 600; giữ `backups/` quyền 700 và chép ra ngoài máy chủ qua kênh an toàn) |
| `deploy-pre-<TS>.manifest` | mô tả bản khôi phục (bảng dưới) |
| thẻ image `realestatemanager-backend:pre-<TS>`, `realestatemanager-frontend:pre-<TS>` | image **đang chạy ngay trước** deploy (đường lùi; bước 6) |

Không còn `deploy-code-pre-<TS>.bundle` và thẻ git `pre-deploy-<TS>` (VPS không có git; code là image). Manifest là `KEY=VALUE` mỗi dòng, **không chứa bí mật**; `restore.sh` đọc bằng bộ lọc khóa cho phép (không `source` file), chỉ nhận `MANIFEST_VERSION=2`. Khóa:

| Khóa | Ý nghĩa |
|---|---|
| `MANIFEST_VERSION`, `BACKUP_KIND`, `TS`, `CREATED_AT`, `HOST` | phiên bản định dạng (**2**); `BACKUP_KIND=manual` do `backup.sh` ghi (mục 6.2), `BACKUP_KIND=deploy` do `deploy.sh` ghi (`manifest_init`); mã thời gian; giờ UTC; tên máy |
| `COMPOSE_PROJECT`, `MONGO_CONTAINER`, `BACKEND_CONTAINER`, `FRONTEND_CONTAINER` | định danh stack |
| `RELEASE_VERSION`, `RELEASE_COMMIT`, `CD_RUN_ID` | bản **mới** đang được deploy (từ `release.env`); mã lần chạy CD nếu có (v1.0.6 chưa có CD nên thường trống) |
| `BACKEND_IMAGE_NAME`, `BACKEND_IMAGE_TAG`, `FRONTEND_IMAGE_NAME`, `FRONTEND_IMAGE_TAG` | tên và thẻ `<version>-<commit>` của image mới |
| `PRE_TAG`, `BACKEND_PRE_IMAGE`, `FRONTEND_PRE_IMAGE` | thẻ `pre-<TS>` và hai image **cũ** để lùi (`restore.sh` gắn lại thành `current`) |
| `DB_VERSION_BEFORE`, `DB_VERSION_READ` | version trong collection `system` trước deploy; `DB_VERSION_READ=0` nghĩa là không đọc được (restore không tự kiểm version) |
| `MONGO_BACKUP_FILE`, `ENV_BACKUP_FILE` | dump DB (rỗng nếu DB chưa có dữ liệu nên bỏ qua backup) và bản sao `.env` |
| `STACK_TOUCHED`, `POST_UP_REACHED` | deploy đã đụng stack/dữ liệu; đã tới sau `up` (nơi bước 90, migration 011 một chiều, chạy) |
| `DEPLOY_STATUS`, `FINISHED_AT` | `started` (đang chạy hoặc bị ngắt), rồi `succeeded`/`failed` khi `deploy.sh` thoát |
| `PROMOTE_REVERT` | chỉ có khi lỗi sau promote trước `up`: `reverted` (đã tự trả `current` về image cũ), `failed` (không trả được: làm tay), `none` (không có gì để trả). `DEPLOY_STATUS` vẫn là `failed` |

Các khóa lạ khác bị `restore.sh` bỏ qua. Dùng manifest để khôi phục: mục 6.1 (`restore.sh`). Nguyên tắc ở đầu mục 11 **không đổi**: không tự rollback sau `up`; restore chỉ chạy khi bạn gõ `--apply --yes`, luôn có backup an toàn trước (`restore-safety-<RTS>` + thẻ `pre-restore-<RTS>`) và cảnh báo đỏ khi deploy đã qua bước 90.

**Lưu ý nhánh (không còn áp dụng).** Bản trước v1.0.6 `deploy.sh` `git pull --ff-only` trên nhánh đang checkout, nên phải kiểm nhánh trước khi chạy. Từ v1.0.6 VPS không có git: **bản được deploy là bản đã dựng và gửi**, và `release.sh build` từ chối cây git bẩn hoặc nhánh chưa push. Việc cần kiểm trước khi `send` là: đúng nhánh/commit đã dựng (xem `release.env` hoặc dòng cuối của `release.sh build`), và đúng host đích (`--to`).


## 12. Ghim image theo digest và nâng cấp image có chủ đích (PT-009)

**Hiện trạng:** compose đã có cơ chế biến cho cả 5 image (mục 2), mặc định = tag hiện tại. **Chưa ghim image nào**, vì digest phải lấy từ bản **đang chạy thật trên VPS** và máy dev/repo không biết nó (tag `:latest`, `mongo:7`, `redis:7-alpine` đã trôi theo thời gian; digest hiện tại trên registry có thể khác bản đã pull lúc dựng stack, ghim nó là đổi phiên bản âm thầm).

| Service | Biến trong `.env` | Mặc định (tag trôi) | Đã ghim |
|---|---|---|---|
| `mongo` | `MONGO_IMAGE` | `mongo:7` | chưa |
| `redis` | `REDIS_IMAGE` | `redis:7-alpine` | chưa |
| `minio`, `minio-init` | `MINIO_IMAGE` | `cgr.dev/chainguard/minio:latest` | chưa |
| `nine-router` | `NINE_ROUTER_IMAGE` | `decolua/9router:latest` | chưa |
| `cloudflared` | `CLOUDFLARED_IMAGE` | `cloudflare/cloudflared:latest` | chưa |

### 12.1. Lấy digest của bản đang chạy (chỉ đọc, Oniichan chạy trên VPS)

```bash
cd ~/RealEstateManager                                  # thư mục deploy trên VPS
bash ops/print-image-digests.sh                     # in dòng sẵn dạng  MONGO_IMAGE=mongo@sha256:...  (chỉ đọc, không pull)
# Đối chiếu bằng tay (cùng thông tin, để kiểm chứng script):
docker image ls --digests --format 'table {{.Repository}}\t{{.Tag}}\t{{.Digest}}\t{{.ID}}'
for c in realestate_mongo realestate_redis realestate_minio realestate_9router realestate_cloudflared; do
  echo "$c  image-id-đang-chạy=$(docker inspect -f '{{.Image}}' "$c")"     # so với cột ID ở bảng trên (rút gọn 12 ký tự đầu)
done
```

Vì sao lấy theo **ID image mà container đang dùng** chứ không theo cột Digest của `image ls`: cột đó là digest của **tag trong kho cục bộ**, có thể đã bị `pull` đè sang bản mới trong khi container vẫn chạy bản cũ (đúng tình huống `container-image-id` khác `local-latest-id` đã gặp ở 5.0a). Dòng nào script báo "KHÔNG có RepoDigest khớp" thì **không ghim** image đó (không đoán digest); báo lại để xử lý.

### 12.2. Ghim vào `.env`

1. Sao lưu `.env` (mục 9 điểm 1), rồi dán các dòng `*_IMAGE=...@sha256:...` script vừa in vào `.env` (quyền 600). Có thể giữ tag cho dễ đọc: `mongo:7@sha256:<digest>` (Docker lấy theo digest, bỏ qua tag).
2. Kiểm: `docker compose config -q && docker compose config | grep -E '^\s+image:'` (chỉ in tên image).
3. **Áp dụng làm compose TẠO LẠI container của service có `image:` đổi** (kể cả khi digest trỏ đúng cùng nội dung, vì chuỗi `image:` khác): gián đoạn ngắn từng service. Làm lúc ít người dùng, **sau backup** (mục 6), **từng service một**, rồi kiểm mục 7:
   ```bash
   docker compose up -d --no-build --no-deps cloudflared      # tunnel rớt vài giây
   docker compose up -d --no-build --no-deps redis nine-router
   docker compose up -d --no-build --no-deps minio
   docker compose up -d --no-build --no-deps mongo           # cuối cùng: backend nối lại sau vài chục giây
   docker compose ps -a                                       # mongo/redis/minio healthy
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/health/readiness # 200
   ```
   Không ghim thì không cần làm bước này; ghim tất cả cũng sẽ tự áp dụng ở lần `deploy.sh` kế tiếp (nó `up -d --no-build`). Digest trùng bản đang chạy nên **không kéo image mới** (đã có sẵn trong kho cục bộ).

### 12.3. Nâng cấp image có chủ đích (sau khi đã ghim)

Không bao giờ để `pull`/`up` tự đổi phiên bản. Mỗi lần nâng cấp một image:

1. Có lý do rõ (lỗ hổng, tính năng cần) và đã đọc ghi chú phát hành của image. **Đổi major của Mongo (7 sang 8) không làm bằng cách đổi digest**: cần quy trình riêng (featureCompatibilityVersion, thử trên bản sao dữ liệu). Chỉ nâng bản vá trong cùng nhánh.
2. Backup (mục 6; với 9Router thêm `tar` volume `nine_router_data`). Lưu lại dòng digest **đang chạy** (đường lui): `bash ops/print-image-digests.sh > ~/image-digests.$(date +%F).txt` (không chứa bí mật).
3. Đủ đĩa: `bash ops/check-disk.sh 5`.
4. **Giữ image cũ trước khi pull** (pull đè tag làm image cũ mồ côi, dễ bị `image prune` xóa mất đường lui): `docker tag <image-id-cũ> <repo>:rollback-$(date +%F)`.
5. Lấy bản mới: `docker pull <repo>:<tag>`; ghi digest mới: `docker image inspect --format '{{index .RepoDigests 0}}' <repo>:<tag>`.
6. Thử trước trên dev hoặc máy khác nếu thay đổi lớn.
7. Đặt biến `*_IMAGE` thành digest mới trong `.env`, `config -q`, `up -d --no-build --no-deps <service>`, kiểm mục 7, và thử một thao tác thật (đăng nhập; với 9Router một thao tác AI; với MinIO tải một ảnh đính kèm).
8. **Đường lui:** đặt biến về digest cũ, `up -d --no-build --no-deps <service>` (image cũ còn nhờ thẻ `rollback-*`). Riêng Mongo: nếu dữ liệu đã được bản mới ghi theo định dạng mới thì không hạ được, phải `mongorestore` từ backup bước 2.
9. Tuyệt đối **không** `docker image prune -a` (xóa image không dùng, gồm cả thẻ đường lui) và **không** `docker volume prune`.

## 13. Việc bảo mật còn tồn (PT-016): `FRONTEND_URL`, cổng 27017/firewall, tài khoản quyền tối thiểu

Phần **trong repo** đã xong (tài liệu này, `.env.example`, và compose hỗ trợ biến `S3_APP_*` mặc định tắt; `MONGO_APP_*` đã bỏ ở v1.0.6, xem banner ở 13.3). **Đổi cấu hình thật cần VPS** nên chưa làm: các runbook dưới đây là việc của Oniichan (làm lần lượt 13.2, 13.1, rồi 13.3/13.4; không bước nào đã được chạy trên VPS).

### 13.1. `FRONTEND_URL` (CORS và Google Drive OAuth)

Backend dùng nó làm **origin CORS duy nhất** (`main.ts`: `enableCors({ origin: FRONTEND_URL, credentials: true })`) và địa chỉ chuyển hướng sau OAuth. Compose truyền `${FRONTEND_URL:?}` (bắt buộc: thiếu hoặc rỗng thì `docker compose` báo lỗi).

```bash
grep '^FRONTEND_URL=' .env                  # URL công khai, không bí mật. Kỳ vọng: FRONTEND_URL=https://<domain-admin> (không dấu / cuối)
docker exec realestate_backend printenv FRONTEND_URL
# Phép thử CORS preflight qua nginx (thay <domain-admin>):
curl -s -i -X OPTIONS http://localhost/api/v1/auth/login -H 'Origin: https://<domain-admin>' -H 'Access-Control-Request-Method: POST' | grep -i '^access-control-allow-origin'
# Kỳ vọng: access-control-allow-origin: https://<domain-admin> (đúng từng ký tự). Không có dòng này = FRONTEND_URL sai/thiếu.
```

Sai hoặc thiếu: sửa dòng trong `.env` (scheme `https`, host đúng như trình duyệt, không `/` cuối), rồi `docker compose up -d --no-deps backend` (không cần build lại; backend tạo lại vài giây).

### 13.2. Cổng 27017 (và các cổng nội bộ) không mở ra ngoài: kiểm chỉ-đọc

Compose không publish cổng Mongo/Redis/MinIO; cần xác nhận không có thứ gì khác (firewall, NAT, port-forward) mở chúng ra ngoài.

```bash
# (1) Trên VPS (không sửa gì):
docker ps --format '{{.Names}} {{.Ports}}' | grep -E '27017|6379|9000|9001|20128'    # mongo/redis/minio chỉ hiện "27017/tcp"... KHÔNG có 0.0.0.0: hoặc :::; 20128 phải là 127.0.0.1:20128
sudo ss -ltn | grep -E ':(27017|6379|9000|9001)\b' || echo "không cổng nào đang LISTEN trên host"
sudo ufw status verbose 2>/dev/null || echo "không dùng ufw"
sudo iptables -t nat -S DOCKER 2>/dev/null | grep -E '27017|6379|9000|9001' || echo "không có luật DNAT tới các cổng này"
```

```powershell
# (2) VPS là máy ảo VirtualBox (nhanubuntu): trên máy chủ ảo hóa, liệt kê luật chuyển cổng NAT (chỉ đọc). Đồng thời xem port-forward trên router.
VBoxManage showvminfo nhanubuntu --machinereadable | Select-String -Pattern '^Forwarding'
# Không được có luật nào trỏ tới guest port 27017 (cũng như 6379, 9000, 9001, 20128).
```

```bash
# (3) Từ MỘT MÁY KHÁC, ngoài VPS (laptop/4G), thử tới IP công khai/LAN của VPS: phải bị từ chối hoặc timeout
nc -vz -w 5 <IP-VPS> 27017        # PowerShell: Test-NetConnection <IP-VPS> -Port 27017  (TcpTestSucceeded phải là False)
nc -vz -w 5 <IP-VPS> 6379 ; nc -vz -w 5 <IP-VPS> 9000 ; nc -vz -w 5 <IP-VPS> 20128
```

Kỳ vọng: chỉ cổng 80 (frontend) mở; `20128` chỉ từ chính VPS. Nếu có cổng mở: đóng luật tương ứng (firewall/NAT/router), rồi coi bí mật tương ứng là có thể đã lộ: **đổi mật khẩu root Mongo (và các user), `REDIS_PASSWORD`, khóa MinIO** nếu có dấu hiệu bị truy cập (xem log/`db.currentOp`, `mongod` log), theo mục 5.6.

### 13.3. User Mongo quyền tối thiểu cho backend (thay root)

> **Cập nhật v1.0.6: runbook dưới đây chưa dùng được nguyên văn.** `docker-compose.yml` v1.0.6 **không còn đọc `MONGO_APP_USERNAME`/`MONGO_APP_PASSWORD`** (backend chỉ nhận `MONGODB_URI` từ `.env`), `.env.example` không còn hai khóa này (`verify-env.sh` báo khóa lạ nếu còn), và `verify-env.sh` bắt user/mật khẩu trong `MONGODB_URI` phải TRÙNG `MONGO_ROOT_*`. Nghĩa là chuyển backend sang user `readWrite` hiện cần sửa trực tiếp `MONGODB_URI` kèm nới kiểm tra khớp của `verify-env.sh` (thay đổi script, chưa làm; là việc của lượt sau). Các bước (1) và (2) (tạo và kiểm user) vẫn đúng; bước (3) đến (4) và "Đường lui" mô tả cách cũ qua `MONGO_APP_*`, giữ làm tham khảo. Việc này vẫn nằm trong danh sách còn tồn của mục 13.5.

Hiện backend dùng **root**: bị khai thác là mất toàn quyền instance. Mục tiêu: user `readWrite` chỉ trên DB `realestate`. Cách cũ (đã bỏ ở v1.0.6, không còn hiệu lực): trước đây compose đọc `MONGO_APP_USERNAME`/`MONGO_APP_PASSWORD` để dựng `MONGODB_URI` của backend dùng user đó (vẫn `authSource=admin`); từ v1.0.6 compose KHÔNG tự dựng URI nữa, phải tự sửa `MONGODB_URI` trong `.env` (mục 2); không đổi thì vẫn root. Làm sau backup (mục 6), thử trước trên stack/volume mẫu:

```bash
# (1) Tạo user trong DB admin, quyền readWrite trên realestate. Mật khẩu đi qua file env tạm 600 + `docker exec --env-file` (không lên dòng lệnh/ps)
APP_USER=remapp                                           # tên tùy chọn
APP_PWD=$(openssl rand -hex 24)                           # hex: an toàn trong URI
ENVF=$(mktemp) && chmod 600 "$ENVF"
printf 'APP_USER=%s\nAPP_PWD=%s\n' "$APP_USER" "$APP_PWD" > "$ENVF"
docker exec -i --env-file "$ENVF" realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
db.getSiblingDB('admin').createUser({ user: process.env.APP_USER, pwd: process.env.APP_PWD, roles: [{ role: 'readWrite', db: 'realestate' }] });
print('đã tạo user ' + process.env.APP_USER);
EOF
# (2) Kiểm user mới: ghi/đọc được trong realestate (rồi dọn), KHÔNG đọc được admin
docker exec -i --env-file "$ENVF" realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
const a = db.getSiblingDB('admin'); a.auth(process.env.APP_USER, process.env.APP_PWD);
const d = db.getSiblingDB('realestate');
d.getCollection('_perm_probe').insertOne({ _id: 'x' }); d.getCollection('_perm_probe').drop(); print('realestate: ghi/đọc OK');
try { a.getCollection('system.users').findOne(); print('LỖI: đọc được admin (quyền thừa)'); } catch (e) { print('admin: bị từ chối (đúng)'); }
EOF
rm -f "$ENVF"
# (3) Ghi vào .env (printf là builtin: mật khẩu không lên ps), không in ra, rồi xóa biến
[ -n "$(tail -c1 .env)" ] && echo >> .env
printf 'MONGO_APP_USERNAME=%s\nMONGO_APP_PASSWORD=%s\n' "$APP_USER" "$APP_PWD" >> .env
unset APP_PWD
docker compose config -q
# (4) Tạo lại backend (vài giây gián đoạn) và kiểm
docker compose up -d --no-deps backend
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/health/readiness    # 200
docker logs --tail 50 realestate_backend 2>&1 | grep -ci 'authentication failed'     # 0
```

Rồi đăng nhập web và thử một thao tác ghi (tạo/sửa khách, có transaction). **Đường lui:** xóa hai dòng `MONGO_APP_*` khỏi `.env`, `up -d --no-deps backend` (quay lại root). Lưu ý:

- Root vẫn dùng cho healthcheck Mongo, `mongodump` của `deploy.sh`, `scripts/run-migration.sh` (005/006) và các lệnh vận hành; chỉ **backend** chuyển sang user mới.
- Runner migration (mục 11.1) chạy bằng `MONGODB_URI` của backend nên cũng dùng user này. `readWrite` đủ để tạo collection/index/ghi dữ liệu; nếu một migration mới báo `Unauthorized` (vd cần `collMod`, tạo user), chạy migration đó **tạm bằng root** (gỡ hai dòng `MONGO_APP_*` trong lúc chạy) rồi đặt lại.
- Đổi mật khẩu user này: tạo lại bằng `updateUser`, rồi sửa `.env` và `up -d --no-deps backend`.

### 13.4. Access key MinIO quyền tối thiểu cho backend (thay root)

Backend chỉ dùng `PutObject`, `GetObject` (cả ký URL), `DeleteObject` và `HeadBucket` trên hai bucket CRM (`src/shared/storage/`). Compose hỗ trợ `S3_APP_ACCESS_KEY_ID`/`S3_APP_SECRET_ACCESS_KEY` (không đặt thì vẫn dùng khóa root `S3_ACCESS_KEY_ID`). `minio-init` luôn dùng khóa root (tạo bucket, rule 7 ngày). **Chưa chạy thử trên VPS; cú pháp `mc admin` có thể khác tùy phiên bản `mc` trong image** (bản mới: `policy create`/`policy attach`; bản cũ: `policy add`/`policy set`).

```bash
APP_KEY=remapp ; APP_SECRET=$(openssl rand -hex 24)
ENVF=$(mktemp) && chmod 600 "$ENVF"; printf 'APP_KEY=%s\nAPP_SECRET=%s\n' "$APP_KEY" "$APP_SECRET" > "$ENVF"
# Policy chỉ cho hai bucket (đổi tên nếu S3_BUCKET_* khác mặc định):
docker exec -i realestate_minio sh -c 'cat > /tmp/crm-app-policy.json' <<'EOF'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["s3:GetBucketLocation", "s3:ListBucket"], "Resource": ["arn:aws:s3:::crm-attachments", "arn:aws:s3:::crm-exports"] },
  { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"], "Resource": ["arn:aws:s3:::crm-attachments/*", "arn:aws:s3:::crm-exports/*"] }
] }
EOF
docker exec -i --env-file "$ENVF" realestate_minio sh -c '
  export MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@localhost:9000"
  mc admin policy create local crm-app /tmp/crm-app-policy.json
  mc admin user add local "$APP_KEY" "$APP_SECRET"          # secret lộ thoáng qua trong ps của CONTAINER minio (một lần)
  mc admin policy attach local crm-app --user "$APP_KEY"
  mc ls local/crm-attachments >/dev/null && echo "root: thấy bucket"
  MC_HOST_app="http://$APP_KEY:$APP_SECRET@localhost:9000" mc ls app/crm-attachments >/dev/null && echo "app key: ĐỌC được crm-attachments (đúng)"
  MC_HOST_app="http://$APP_KEY:$APP_SECRET@localhost:9000" mc admin info app >/dev/null 2>&1 && echo "LỖI: app key có quyền admin" || echo "app key: bị từ chối quyền admin (đúng)"
'
rm -f "$ENVF"
[ -n "$(tail -c1 .env)" ] && echo >> .env
printf 'S3_APP_ACCESS_KEY_ID=%s\nS3_APP_SECRET_ACCESS_KEY=%s\n' "$APP_KEY" "$APP_SECRET" >> .env
unset APP_SECRET
docker compose config -q
docker compose up -d --no-deps backend
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/health/readiness   # 200 (storage up)
```

Thử trên web: tải một ảnh đính kèm vào nhật ký, mở lại ảnh (URL ký bằng khóa mới, phải còn truy cập được trong 15 phút) và một lần xuất file. **Đường lui:** xóa hai dòng `S3_APP_*` khỏi `.env`, `up -d --no-deps backend`. Bucket vẫn riêng tư.

### 13.5. Việc còn lại cho Oniichan (không ai làm thay được từ repo)

| Mục | Việc | Trạng thái |
|---|---|---|
| (c) cổng 27017/firewall | Chạy 13.2 (ba khối: VPS, VirtualBox/router, từ máy ngoài); báo kết quả | Chưa kiểm |
| (a) `FRONTEND_URL` | Chạy 13.1; sửa nếu sai | Chưa kiểm |
| (b) user quyền tối thiểu | Quyết có làm không; nếu làm: 13.3 (Mongo) và 13.4 (MinIO), sau backup, từng cái một | Chưa làm (MinIO: compose đã sẵn sàng với `S3_APP_*`; Mongo: cần đổi compose/`verify-env.sh` trước, xem banner 13.3) |

## 14. PWA phía hạ tầng (PT-030): header cache của nginx và Cloudflare

Web admin là PWA (service worker `sw.js` ở gốc `/`, scope `/`; chỉ precache vỏ app, **không** cache `/api/`). Phía hạ tầng chỉ có hai việc: (1) nginx gắn đúng `Cache-Control` cho từng nhóm file trong `RealEstateAdminApp/nginx.conf`; (2) bảo đảm Cloudflare không giữ bản cũ của các file không băm tên. PWA chỉ cài/chạy được trên **HTTPS** (hoặc `localhost`): đã có qua Cloudflare Tunnel.

### 14.1. Bảng header theo đường dẫn

| Đường dẫn | Cache-Control | Vì sao |
|---|---|---|
| `/index.html`, `/`, mọi route SPA (`/customers/123`...) | `no-cache` | File không băm tên và trỏ tới các `/assets/<tên-băm>` của bản build hiện tại. Nếu trình duyệt giữ bản cũ thì sau deploy nó tải JS/CSS cũ (đã bị xóa khỏi image mới) và vỡ trang |
| `/env.js` (cấu hình chạy của FE, sinh lúc container khởi động) | `no-store` | Nội dung phụ thuộc cấu hình: đổi cờ rồi tạo lại container phải có hiệu lực ngay (không build lại). File nhỏ nên không cần cache. Dùng `no-store` thay `no-cache` vì Cloudflare đã ghi đè `no-cache` của `/env.js` thành `max-age=3600` ở staging; dự kiến `no-store` thì Cloudflare không ghi đè (chưa kiểm trên Cloudflare thật, xem 14.4) |
| `/sw.js`, `/workbox-*.js`, `/registerSW.js` (nếu có) | `no-cache` | Service worker không băm tên: trình duyệt phải kiểm được bản mới thì app mới cập nhật. Dùng `no-cache` thay vì `no-store`: vẫn lưu và hỏi lại bằng ETag (trả 304, nhẹ); trình duyệt vốn bỏ qua cache HTTP khi kiểm cập nhật service worker nên `no-store` không thêm lợi ích (khác `/env.js` ở dòng trên) |
| `/manifest.webmanifest`, `/offline.html` | `no-cache` | Không băm tên, nhỏ. `offline.html` còn nằm trong precache của service worker nên phải cập nhật cùng bản build |
| `/assets/*` (JS/CSS băm tên) | `public, max-age=31536000, immutable` | Đổi nội dung thì đổi tên file nên cache vĩnh viễn an toàn |
| `/pwa-*.png`, `/apple-touch-icon*.png`, `/maskable-icon*.png`, `/favicon.*` | `public, max-age=86400` | Không băm tên nhưng ít đổi; cache 1 ngày. Regex neo ở gốc và chỉ khớp các tên này (không đụng `/api/...`) |
| `/api/` | không đổi (proxy như cũ) | Không cache ở nginx |

Quy tắc bổ sung trong cấu hình:

- **File thiếu trả 404 thật** cho `/assets/*`, `sw.js`, `workbox-*`, `registerSW.js`, manifest, `offline.html` và icon (`try_files $uri =404`), **không** rơi về `index.html` với mã 200. Nếu không, sau deploy một `/assets/app-cu.js` đã bị xóa sẽ nhận về HTML (lỗi MIME khó hiểu, hoặc trình duyệt cache HTML thành JS), và trình duyệt đăng ký service worker từ một trang HTML sẽ báo lỗi không rõ nguyên nhân.
- **`.webmanifest` phải là `application/manifest+json`.** `mime.types` của `nginx:1.27-alpine` **không có** `webmanifest` (lúc thử trả `application/octet-stream`), nên `types { } default_type application/manifest+json;` được đặt ngay trong `location = /manifest.webmanifest`. KHÔNG đặt khối `types { ... }` ở cấp `server`: nó thay toàn bộ bảng MIME (mất `text/css`, `image/png`...).
- `gzip_types` đã thêm `application/manifest+json` và `image/svg+xml`.
- **`add_header` không kế thừa:** `add_header` trong một `location` thay thế add_header cấp server. Header bảo mật (mục 14.5) vì vậy nằm trong một snippet `include` ở cấp server **và** trong từng location có `add_header Cache-Control` riêng; location mới có `add_header` mà quên include sẽ mất header bảo mật (test `ops/tests/nginx-security-headers.test.sh` bắt lỗi này).
- Fallback SPA (`try_files ... /index.html`) là redirect nội bộ nên rơi vào `location = /index.html` và nhận `no-cache`; đã thử trên nginx thật (bảng 14.2).
- Khối `set_real_ip_from`/`CF-Connecting-IP`, proxy `/api/` (kể cả `client_max_body_size 6m`) và gzip cũ **không đổi**.

### 14.2. Đã kiểm chứng bằng nginx thật (máy dev)

`nginx:1.27-alpine` chạy cô lập (cổng `127.0.0.1:18999`, không đụng stack nào), mount **đúng** `RealEstateAdminApp/nginx.conf` làm `default.conf` (`--add-host backend:127.0.0.1` để upstream resolve được) và một thư mục `dist` GIẢ (file mẫu, không phải build thật). `nginx -t` báo `syntax is ok` / `test is successful`. Kết quả `curl -I`:

| URL | Status | Content-Type | Cache-Control |
|---|---|---|---|
| `/` | 200 | text/html | no-cache |
| `/env.js` | 200 | application/javascript | no-store |
| `/healthz` | 200 | text/plain | no-store |
| `/customers/123` (route SPA) | 200 | text/html | no-cache |
| `/index.html` | 200 | text/html | no-cache |
| `/sw.js` | 200 | application/javascript | no-cache |
| `/sw.js.map` (không có file) | 404 | text/html | (không có) |
| `/manifest.webmanifest` | 200 | application/manifest+json | no-cache |
| `/offline.html` | 200 | text/html | no-cache |
| `/assets/app-abc123.js` | 200 | application/javascript | public, max-age=31536000, immutable |
| `/assets/app-abc123.css` | 200 | text/css | public, max-age=31536000, immutable |
| `/assets/khong-co.js` | **404** | text/html | (không có) |
| `/workbox-xyz.js` | 200 | application/javascript | no-cache |
| `/workbox-khong-co.js`, `/registerSW.js` (không có file) | **404** | text/html | (không có) |
| `/pwa-192x192.png`, `/apple-touch-icon.png` | 200 | image/png | public, max-age=86400 |
| `/favicon.svg` | 200 | image/svg+xml | public, max-age=86400 |
| `/favicon.ico`, `/pwa-512x512.png` (không có file) | **404** | text/html | (không có) |
| `/api/`, `/api/v1/x.png` (backend không chạy) | 502 | text/html | (không có), như trước |

Bổ sung (T-41 B-1, đo lại bằng nginx cô lập cùng cách, mount `nginx.conf` mới, `dist` giả có `env.js`): hai dòng `/env.js` và `/healthz` ở bảng trên; `nginx -t` vẫn đạt; `If-None-Match` với ETag của `/env.js` trả **304**. Phần kiểm tĩnh (không cần nginx) nằm ở `ops/tests/nginx-cache-headers.test.sh`.

Thêm: `If-None-Match` với ETag của `/sw.js` và `/customers/123` trả **304**; `manifest.webmanifest`, `favicon.svg`, JS lớn hơn ngưỡng được gzip; POST 7 MB vào `/api/` trả 413, 1 KB trả 502 (giới hạn 6 MB còn nguyên).

### 14.3. Kiểm sau mỗi lần deploy (Oniichan chạy, chỉ đọc)

```bash
D=https://<domain-admin>
for p in / /index.html /env.js /sw.js /manifest.webmanifest /offline.html; do
  echo "== $p"; curl -sI "$D$p" | grep -iE '^(HTTP|content-type|cache-control|cf-cache-status|etag)'
done
# Một file băm tên bất kỳ của bản build hiện tại (lấy tên từ index.html):
A=$(curl -s "$D/" | grep -oE '/assets/[^"]+\.js' | head -n 1); curl -sI "$D$A" | grep -iE '^(HTTP|content-type|cache-control|cf-cache-status)'
# File không có phải 404, không phải HTML 200:
curl -s -o /dev/null -w '%{http_code}\n' "$D/assets/khong-co.js"        # 404
```

Kỳ vọng (việc Oniichan kiểm sau mỗi deploy; riêng dòng `/env.js` là bước `curl -sI "$D/env.js"` của T-41 B-1, chưa kiểm trên Cloudflare thật): `/env.js` có `cache-control: no-store`; `/`, `/index.html`, `/sw.js`, `/manifest.webmanifest`, `/offline.html` đều `cache-control: no-cache` và `cf-cache-status` thuộc `DYNAMIC`/`BYPASS`/`EXPIRED`/`REVALIDATED` (**không** `HIT`); `/manifest.webmanifest` có `content-type: application/manifest+json`; `/assets/...` có `immutable`.

### 14.4. Cloudflare: không để edge giữ bản `sw.js`/`index.html` cũ

Cloudflare mặc định cache theo **phần mở rộng** (`.js`, `.css`, ảnh...), nên `sw.js` có thể bị giữ ở edge. Với origin gửi `Cache-Control: no-cache` thì thường Cloudflare không giữ, nhưng cần kiểm chứng thay vì đoán, vì thiết lập tài khoản (Cache Rules, Browser Cache TTL, Edge Cache TTL...) có thể ghi đè header của origin:

1. Chạy lệnh ở 14.3, **gọi hai lần liên tiếp** cho `/sw.js` và `/index.html`, đọc `cf-cache-status`. Mong đợi `DYNAMIC`/`BYPASS`/`EXPIRED`/`REVALIDATED`, không phải `HIT`. Đồng thời xem `cache-control` mà trình duyệt nhận có đúng `no-cache` (không bị Cloudflare đổi thành `max-age=...`).
2. Nếu `HIT` hoặc header bị đổi: Cloudflare > Caching > Cache Rules > tạo rule **Bypass cache** cho đường dẫn `/sw.js`, `/index.html`, `/manifest.webmanifest`, `/offline.html` (và `/workbox-*`, `/registerSW.js` nếu có; cũng nên thêm đường dẫn `/` chính xác). Sau khi tạo: Purge các URL này một lần (Caching > Configuration > Purge Cache > Custom Purge) rồi chạy lại bước 1.
3. Kiểm thủ công sau deploy đầu tiên có PWA: mở web, DevTools > Application > Service Workers, bấm Update, xác nhận nhận được bản `sw.js` mới sau khi deploy bản kế tiếp (không cần xóa cache trình duyệt).
4. **`/env.js` bị Cloudflare ghi đè TTL (đã gặp ở staging, T-41 B-1):** Cloudflare từng đổi `Cache-Control` của `/env.js` (và `/sw.js`) từ `no-cache` thành `max-age=3600` dù origin gửi `no-cache`, nên trình duyệt có thể giữ `/env.js` cũ tới 1 giờ sau khi đổi cờ (trái Q-20: đổi cờ chỉ cần tạo lại container). nginx nay gửi `Cache-Control: no-store` cho `/env.js`; **dự kiến** Cloudflare sẽ không cache và không ghi đè TTL khi origin gửi `no-store`, nhưng đây là kỳ vọng **chưa kiểm trên Cloudflare thật** (phần origin đã đo bằng nginx thật, bảng 14.2). Việc của Oniichan sau deploy: `curl -sI "$D/env.js" | grep -iE '^(cache-control|cf-cache-status)'` phải thấy `cache-control: no-store`. **Rủi ro cần biết:** nếu Cloudflare ghi đè TTL ở cấp zone (Caching > Configuration > **Browser Cache TTL**, đặt giá trị cố định) thì không riêng `/env.js` mà cả `index.html`, `sw.js`, `manifest.webmanifest` cũng có thể bị giữ bản cũ ở trình duyệt, dù origin đã gửi `no-cache`. Cách xử lý: đặt Browser Cache TTL = **"Respect Existing Headers"** (việc của Oniichan trên dashboard; không cần đổi code), rồi chạy lại bước 1 và lệnh `curl` ở trên. `sw.js` ít nghiêm trọng hơn: trình duyệt luôn bỏ qua cache HTTP khi kiểm cập nhật service worker.
5. Nên để tắt các tính năng sửa JS/HTML ở edge cho hostname admin (Rocket Loader, và Auto Minify nếu tài khoản còn tùy chọn này): chúng đổi nội dung file mà precache của service worker đã ghi nhận theo bản build.

> Trạng thái: **chưa kiểm chứng trên Cloudflare thật** (không có quyền/không thể thử từ repo): hành vi `cf-cache-status` của `sw.js`/`index.html`, Cache Rule bypass và Purge là việc của Oniichan. Cũng **chưa kiểm** với bản build frontend thật có `sw.js`/`workbox-*.js` thật (bảng 14.2 dùng `dist` giả); tên file thật do `vite-plugin-pwa` sinh ra cần đối chiếu với các location ở 14.1 khi có bản build đầu tiên (nếu có file mới không băm tên như `registerSW.js` thì đã có sẵn, tên khác thì phải thêm location). Luồng cập nhật/offline của service worker trên trình duyệt thật cũng thuộc phần frontend, chưa phải phạm vi tài liệu này.

### 14.5. Header bảo mật của FE (T-41 D-1, B-2)

Trước đây nginx FE không gửi header bảo mật nào (có thể bị nhúng iframe, lộ phiên bản nginx). Nay `RealEstateAdminApp/nginx.conf` có `server_tokens off;` và `include` snippet `RealEstateAdminApp/nginx-security-headers.conf` (image chép vào `/etc/nginx/snippets/security-headers.conf`; là file thường, **không** qua envsubst). Thêm/bớt header chỉ sửa snippet, không sửa từng location.

| Header | Giá trị | Ghi chú |
|---|---|---|
| `Server` | `nginx` (không còn số phiên bản) | `server_tokens off` (B-2); cũng ẩn phiên bản ở trang lỗi |
| `X-Content-Type-Options` | `nosniff` | Trình duyệt không đoán kiểu MIME; khớp với việc file thiếu trả 404 thật (14.1) |
| `X-Frame-Options` | `SAMEORIGIN` | Chặn nhúng iframe từ trang khác (clickjacking) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Gửi sang trang khác chỉ origin, không gửi đường dẫn đầy đủ |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | Chỉ tắt các quyền mà mã FE **không dùng** (đã kiểm `src/`: không có `getUserMedia`/`geolocation`/thanh toán/USB; ảnh đính kèm dùng `<input type="file">`, gọi điện dùng `tel:`). Thông báo/push, clipboard, toàn màn hình không bị chặn |

Quy tắc của cấu hình:

- Mọi header trên dùng `always` nên cũng gắn cho 404 (`try_files` thiếu file) và 502 của `/api/`; `Cache-Control` thì **không** đổi (404 vẫn không có).
- Snippet được `include` ở cấp server (cho `location /`, `/api/`, trang lỗi) và lặp lại trong từng location có `add_header Cache-Control` (`/index.html`, `/env.js`, `/healthz`, sw/workbox, manifest, `/offline.html`, `/assets/`, icon). `proxy_hide_header` ở `/api/` ẩn bản header cùng tên do backend (helmet) gửi để phản hồi API không bị lặp header (Chrome coi hai `X-Frame-Options` là không hợp lệ). `Strict-Transport-Security` của backend **giữ nguyên**.
- **HSTS: không đặt ở origin.** Origin nginx chỉ nói HTTP (TLS kết thúc ở Cloudflare/cloudflared), và gửi HSTS qua HTTP bị trình duyệt bỏ qua. **Việc của Oniichan:** bật HSTS ở Cloudflare (SSL/TLS > Edge Certificates > HTTP Strict Transport Security; bắt đầu `max-age` ngắn, ví dụ 6 tháng, chưa bật `includeSubDomains`/`preload` nếu chưa chắc mọi subdomain đều HTTPS), hoặc Transform Rule gắn response header. Phần dư thừa với backend (đã có HSTS) không sao.
- **CSP: chưa đưa vào.** Chưa chứng minh được một chính sách chặt không làm hỏng app: `index.html` có script inline (áp lớp `dark` trước khi vẽ) và `<script src="/env.js">`; ảnh đến từ nhiều nguồn (MinIO/S3 qua `S3_PUBLIC_ENDPOINT`, ảnh tin tức/WordPress bên ngoài, `blob:` xem trước); thẻ `style` inline do React/Tailwind; kết nối API cùng origin (`/api/v1`, chưa đối chiếu hết các nơi gọi ra origin khác). Đưa CSP cứng khi chưa đo có thể làm trắng trang. Cách làm sau, an toàn: thêm `add_header Content-Security-Policy-Report-Only "<chính sách>" always;` vào **snippet** (một chỗ), chạy staging vài ngày, đọc báo cáo vi phạm ở DevTools Console, nới/siết cho khớp (script inline: dùng hash hoặc chuyển ra file; `img-src` thêm origin S3; `connect-src` thêm origin cần gọi), rồi mới đổi sang `Content-Security-Policy`. Việc này cần xem bản build thật nên để phiên sau.
- **`sw.js` bị Cloudflare ghi TTL** (`max-age=3600` dù origin `no-cache`, xem 14.4 và T-41 B-3): không sửa được từ nginx; là việc dashboard của Oniichan (Browser Cache TTL = "Respect Existing Headers" hoặc Cache Rule bypass cho `/sw.js`). Ảnh hưởng thấp vì trình duyệt bỏ qua cache HTTP khi kiểm cập nhật service worker.
- **Đã kiểm chứng (máy dev, nginx:1.27-alpine thật, không build image):** `nginx -t` đạt; `curl -I` mọi đường dẫn ở bảng 14.2 (kể cả 404, `/api/`, 304 của `/env.js`) nhận đủ bốn header bảo mật đúng một lần, `Server: nginx`, `Cache-Control` giữ nguyên như bảng 14.1; `/api/` với backend giả gửi `X-Frame-Options: DENY` + HSTS: chỉ còn `SAMEORIGIN` của nginx, HSTS còn. **Chưa kiểm:** trên trình duyệt thật (PWA, service worker, push) và qua Cloudflare thật.
- Kiểm sau deploy (Oniichan chạy, chỉ đọc): `curl -sI "$D/" | grep -iE '^(server|x-content-type-options|x-frame-options|referrer-policy|permissions-policy|strict-transport-security)'`. Kỳ vọng `server: nginx` (có thể là `cloudflare` nếu qua edge), bốn header trên đủ; `strict-transport-security` chỉ xuất hiện sau khi bật ở Cloudflare.
- Kiểm tự động: `bash ops/tests/nginx-security-headers.test.sh` (tĩnh + nginx thật nếu có Docker/image `nginx:1.27-alpine`; bỏ qua phần Docker bằng `SKIP_DOCKER=1`).

## 15. Web Push VAPID (v1.0.4, T-43, FR-08)

Runbook bật/tắt/đổi khóa Web Push trên VPS. Đối chiếu mã nguồn: `push-provider.factory.ts` (chọn nhà cung cấp **một lần lúc khởi động**), `push-subscriptions.controller.ts` (`GET /push-subscriptions/config`), worker `push.send` + `push.sweep`.

**Nguyên tắc chung**
- Khóa riêng VAPID là bí mật: **không dán vào chat, không commit, không in ra màn hình**. Mọi lệnh dưới đây ghi thẳng vào file quyền 600 hoặc chỉ in độ dài/số đếm.
- `VAPID_*` và `CRM_PUSH_ENABLED` chỉ nằm ở `environment` của backend (không `build.args`, không vào image, không có phía frontend: frontend lấy khóa công khai lúc chạy qua `/push-subscriptions/config`). Đổi các biến này chỉ cần **tạo lại container**, không build: `docker compose up -d backend` (vài giây).
- Khi cờ tắt hoặc khóa sai, backend **vẫn khởi động bình thường** với `NoopPushProvider`; hộp thông báo trong app vẫn hoạt động, chỉ không có push ra thiết bị.
- Mọi lệnh chạy ở thư mục gốc repo trên VPS (nơi có `docker-compose.yml` và `.env`).

### 15.1. Thứ tự bật trên production

Chỉ bật push (bước 5) khi các bước trước đã xong; đảo thứ tự có thể làm người dùng nhận push khi dữ liệu/quyền chưa đúng:

1. Các task bảo mật dữ liệu **T-01..T-04 (FR-14/15/16)** đã làm xong **và đã qua `qa-agent`** (không còn Critical/High). Push gửi nội dung thông báo ra dịch vụ ngoài nên phải đúng quyền/PII trước.
2. Phần push của backend/frontend đã nằm trong bản deploy (T-16..T-38, T-39..T-42) và `deploy.sh` đã chạy thành công (mục 11).
3. **A0 xong**: migration 007/008/009 đã `--apply` (mục 11.4) **và** bước bù mã danh mục 8c chạy xong (15.7).
4. Sinh khóa VAPID một lần (15.2) và đặt vào `.env` (15.3) với **cờ vẫn `false`**; `up -d backend`; kiểm `config` (15.4) phải ra `enabled:false`.
5. Đặt `CRM_PUSH_ENABLED=true`, `up -d backend`, kiểm `config` ra `enabled:true` (15.4) và log có dòng "Web Push bật" (15.5).
6. Thử bằng thao tác thật trên điện thoại (15.8, 15.12), theo dõi `pushStatus` (15.9).

Bước 4-6 là việc **sau deploy do Oniichan làm** (T-48), nằm ngoài `/spec-implement`. Cờ tắt lại được bất cứ lúc nào (15.10).

### 15.2. Sinh khóa VAPID (một lần, không hiển thị khóa)

Dùng đúng thư viện `web-push` trong image backend (không cần Node trên máy chủ). `umask 077` để file ra quyền 600; lệnh ghi thẳng vào file, **không in khóa lên màn hình**:

```bash
umask 077
docker compose run --rm --no-deps -T backend node -e \
  "const k=require('web-push').generateVAPIDKeys();process.stdout.write('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey+'\n')" \
  > ~/vapid.new.env
ls -l ~/vapid.new.env   # kỳ vọng: -rw------- và > 0 byte
```

Kiểm độ dài (không in giá trị): khóa công khai **87** ký tự, khóa riêng **43** ký tự (base64url của 65 và 32 byte):

```bash
awk -F= '/^VAPID_PUBLIC_KEY=/{print "public:", length($2)} /^VAPID_PRIVATE_KEY=/{print "private:", length($2)}' ~/vapid.new.env
# kỳ vọng: public: 87 / private: 43
```

**Sao lưu khóa riêng vào trình quản lý mật khẩu ngay lúc này** (mở file bằng trình soạn thảo trên máy chủ và chép tay, hoặc `scp` về máy cá nhân; không qua chat/email). Mất khóa riêng cũng như đổi khóa: mọi thiết bị đã đăng ký thành vô hiệu (15.11).

### 15.3. Đặt `VAPID_*` và `CRM_PUSH_ENABLED` vào `.env`

```bash
# 1) Xóa dòng cũ (nếu có), bảo đảm file kết thúc bằng xuống dòng, rồi nối khóa mới
sed -i '/^VAPID_PUBLIC_KEY=/d;/^VAPID_PRIVATE_KEY=/d' .env
[ -n "$(tail -c1 .env)" ] && echo >> .env
cat ~/vapid.new.env >> .env
chmod 600 .env

# 2) Xóa file tạm chứa khóa (khóa riêng đã có trong .env và trình quản lý mật khẩu)
shred -u ~/vapid.new.env

# 3) Đặt các biến còn lại (mở bằng trình soạn thảo, KHÔNG echo giá trị bí mật):
#    VAPID_SUBJECT=mailto:<email liên hệ thật>   (bắt buộc là mailto: hoặc https:)
#    CRM_PUSH_ENABLED=false                      (ở bước 4 của 15.1; bước 5 mới đổi thành true)
grep -nE '^(CRM_PUSH_ENABLED|VAPID_SUBJECT)=' .env

# 4) Kiểm độ dài khóa trong .env (không in giá trị)
awk -F= '/^VAPID_PUBLIC_KEY=/{print "public:", length($2)} /^VAPID_PRIVATE_KEY=/{print "private:", length($2)}' .env

# 5) Kiểm compose nhận biến mà KHÔNG lộ khóa riêng: chỉ in cờ/subject, còn khóa chỉ đếm số dòng có giá trị (kỳ vọng 1)
docker compose config | grep -E 'FEATURE_CRM_PUSH|VAPID_SUBJECT|PUSH_ENDPOINT'
docker compose config | grep -c '^ *VAPID_PRIVATE_KEY: .\+'

# 6) Áp dụng (tạo lại container backend, không build)
docker compose up -d backend
```

`.env` đã nằm ngoài git (mục 2). Đã có bản sao lưu `.env` ngoài máy chủ (mục 9, việc 1): cập nhật bản sao đó sau khi thêm `VAPID_*`.

### 15.4. Kiểm `GET /push-subscriptions/config`

Endpoint cần đăng nhập (mọi vai trò CRM). Mật khẩu nhập tay, không nằm trên dòng lệnh hay lịch sử shell:

```bash
read -rp 'Email: ' E; read -rsp 'Mật khẩu: ' P; echo
TOKEN=$(printf '{"email":"%s","password":"%s"}' "$E" "$P" \
  | curl -s http://localhost/api/v1/auth/login -H 'content-type: application/json' -d @- \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
unset P
curl -s http://localhost/api/v1/push-subscriptions/config -H "Authorization: Bearer $TOKEN"; echo
unset TOKEN
```

Đăng nhập chịu giới hạn 5 lần/phút/IP ở production: nhập sai nhiều lần sẽ bị chặn tạm.

| Trạng thái | Kết quả `data` |
|---|---|
| `CRM_PUSH_ENABLED=true` + `VAPID_*` hợp lệ | `{"enabled":true,"publicKey":"<87 ký tự>"}`; 10 ký tự đầu của `publicKey` phải trùng đầu `VAPID_PUBLIC_KEY` trong `.env` |
| Cờ `false` | `{"enabled":false,"publicKey":null}` |
| Cờ `true` nhưng thiếu/sai biến `VAPID_*` | `{"enabled":false,"publicKey":null}` (backend đã quay về Noop, xem log ở 15.5) |

Khóa công khai là thông tin công khai (trình duyệt nào cũng nhận được), in ra được; **khóa riêng thì không bao giờ**.

### 15.5. Log khởi động mong đợi

```bash
docker compose logs --since 5m backend | grep -E 'Web Push|FEATURE_CRM_PUSH'
```

- Thành công: `Web Push bật (VAPID hợp lệ), dùng WebPushProvider.`
- Cờ bật nhưng sai cấu hình (log mức ERROR, chỉ nêu **tên** biến, không kèm giá trị): `FEATURE_CRM_PUSH đang bật nhưng thiếu hoặc sai định dạng: VAPID_PUBLIC_KEY, ...` rồi quay về Noop. Sửa biến theo tên đã nêu rồi `up -d backend` lại.
- Cờ tắt: không có dòng nào ở trên (Noop im lặng).

### 15.6. Quan hệ giữa các lớp (để hiểu `pushStatus`)

- Khi có sự kiện, Dispatcher ghi thông báo vào hộp thư với `pushStatus=PENDING`; job `push.send` (BullMQ) gửi sau khi transaction commit; `push.sweep` (chu kỳ 60 giây) xếp lại các thông báo `PENDING` quá 30 giây (lưới an toàn khi Redis/worker gián đoạn). Sổ gửi theo thiết bị nằm ở `push_deliveries`.
- `pushStatus`: `PENDING`, `SENT`, `SKIPPED` (cờ tắt, người nhận không còn `ACTIVE`, loại thông báo bị tắt, giờ yên lặng, không có thiết bị, vượt giới hạn 3 push/đợt), `FAILED`.
- Dịch vụ push trả 404/410 nghĩa là thiết bị không còn: backend thu hồi thiết bị đó (lý do `GONE`). Tối đa 3 thiết bị/người; đăng ký quá 90 ngày không làm mới thì hết hạn.
- Có 4 loại thông báo trong danh mục push. `CUSTOMER_ASSIGNED` chỉ push khi người nhận được thêm làm **thành viên (MEMBER)**; đổi người phụ trách chính (PRIMARY) hay tạo khách mới **không** push.

### 15.7. Bù mã danh mục A0 sau `up` (bước 8c)

`deploy.sh` đã chạy bước này **tự động mọi lần deploy** (mục 11, bước 8c) và fail deploy nếu thoát khác 0. Chạy tay khi cần xác nhận, hoặc sau khi `up` thủ công ngoài `deploy.sh`:

```bash
docker compose run --rm --no-deps -T backend node dist/migrations/crm-catalog-codes.cli.js --apply
echo "exit=$?"   # kỳ vọng exit=0; khác 0 thì DỪNG, không bật push
```

Lệnh idempotent (chạy lại an toàn). Điều kiện bật push ở 15.1 yêu cầu A0 xong để danh mục dựa trên mã khớp dữ liệu.

### 15.8. Thử push bằng thao tác thật (không có endpoint "Gửi thử")

Hệ thống **không có** endpoint gửi thử; thử bằng đúng luồng nghiệp vụ. Cần một **tài khoản thử** (STAFF hoặc MANAGER, không phải tài khoản quản trị của Oniichan) và một điện thoại thật:

1. Trên điện thoại, mở web admin bằng HTTPS (domain thật). **PWA phải cập nhật bản mới trước**: khi thấy thông báo bản mới, bấm **"Cập nhật"**. Thiết bị chưa cập nhật còn chạy service worker cũ, **không xử lý được push** nên sẽ không hiện thông báo dù backend đã gửi.
2. iPhone: bắt buộc **"Thêm vào Màn hình chính"** rồi mở từ biểu tượng đó (iOS 16.4 trở lên); mở trong tab Safari thường không nhận push.
3. Đăng nhập tài khoản thử, vào **Cài đặt thông báo**, bật thông báo và cho phép quyền khi trình duyệt hỏi. Kiểm: thiết bị hiện trong danh sách thiết bị của chính mình (`GET /push-subscriptions`).
4. Dùng một tài khoản **có quyền thêm thành viên** vào một khách thử, **thêm tài khoản thử làm thành viên cùng phụ trách (MEMBER)**. Quy tắc thật là hàm `canManageMembers` trong `RealEstateBackendApp/src/modules/crm/care-teams/care-team.rules.ts`, ba nhóm người được thêm: (a) **ADMIN**; (b) **MANAGER trong phạm vi quản lý** (khách phải nằm trong phạm vi của MANAGER đó, ngoài phạm vi sẽ báo không tìm thấy khách; người được thêm cũng bị kiểm theo phạm vi của người thao tác); (c) **PRIMARY (phụ trách chính) của chính khách đó**. STAFF **không** phải PRIMARY của khách đó thì không thêm được (kể cả đang là MEMBER của khách đó): backend trả 403 "Chỉ Quản trị, Quản lý hoặc phụ trách chính được thêm thành viên". Nên dùng tài khoản ADMIN của Oniichan cho bước này.
5. Mong đợi trong khoảng 1 phút: điện thoại hiện push tiêu đề **"Bạn được mời cùng phụ trách một khách"**; chạm vào mở `/crm/customers/<id>` của khách đó. Thông báo trong app xuất hiện, `pushStatus` của nó chuyển `SENT` (truy vấn ở 15.9).
6. Dọn: gỡ tài khoản thử khỏi nhóm phụ trách của khách thử (không để dữ liệu thử lẫn vào dữ liệu thật).

Nếu không hiện push: xem `pushStatus` và `push_deliveries` ở 15.9 (`SKIPPED` cho biết lý do; `FAILED` kèm mã lỗi), rồi lỗi thường gặp ở 15.12.

### 15.9. Truy vấn theo dõi `pushStatus` (chỉ đọc)

Chạy trên VPS. Dòng `auth` đầu lấy tài khoản root từ biến môi trường của container (cùng cách mục 5), không có mật khẩu trên dòng lệnh. Script **chỉ đọc**:

```bash
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const d = db.getSiblingDB("realestate");
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
const show = (label, cursor, fmt) => { print(label); cursor.forEach(r => print("  " + fmt(r))); };
show("(1) pushStatus cua thong bao tao trong 24 gio qua:",
  d.notifications.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$pushStatus", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  r => r._id + ": " + r.n);
print("(2) PENDING qua 2 phut (nghi Redis/worker):");
print("  " + d.notifications.countDocuments({ pushStatus: "PENDING", createdAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) } }));
show("(3) Thiet bi bi thu hoi trong 24 gio qua, theo ly do (GONE = dich vu push bao 404/410):",
  d.push_subscriptions.aggregate([{ $match: { revokedAt: { $gte: since } } }, { $group: { _id: "$revokedReason", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  r => r._id + ": " + r.n);
show("(4) Ket qua gui theo thiet bi trong 24 gio qua (FAILED 401/403 = nghi sai khoa VAPID):",
  d.push_deliveries.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { status: "$status", code: "$lastErrorCode" }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
  r => r._id.status + " code=" + r._id.code + ": " + r.n);
print("(5) Thiet bi dang hieu luc:");
print("  " + d.push_subscriptions.countDocuments({ revokedAt: null }));
EOF
```

Cách đọc kết quả:

| Quan sát | Ý nghĩa/việc cần làm |
|---|---|
| (1) có `SENT`, ít `FAILED` | Bình thường. `SKIPPED` nhiều là bình thường nếu cờ tắt, giờ yên lặng hoặc người nhận chưa bật thông báo |
| (2) > 0 kéo dài | Redis/worker `push.send` có vấn đề (`push.sweep` sẽ xếp lại sau chu kỳ 60 giây; nếu vẫn tồn thì kiểm Redis và log backend) |
| (3) `GONE` tăng đột biến | Nhiều thiết bị bị dịch vụ push từ chối cùng lúc: nghi vừa đổi khóa VAPID (15.11) |
| (4) `FAILED` mã 401/403 | Nghi `VAPID_*` sai/lệch cặp hoặc `VAPID_SUBJECT` bị từ chối: kiểm 15.4/15.5 |
| (5) bằng 0 | Chưa ai bật thông báo (hoặc vừa đổi khóa): người dùng cần bật lại |

### 15.10. Tắt khẩn cấp

```bash
# Đặt CRM_PUSH_ENABLED=false trong .env (mở bằng trình soạn thảo, hoặc:)
sed -i 's/^CRM_PUSH_ENABLED=.*/CRM_PUSH_ENABLED=false/' .env
docker compose up -d backend      # vài giây, không build
# Kiểm: config phải ra {"enabled":false,"publicKey":null} (15.4)
```

Hiệu lực: provider chọn lại lúc khởi động thành Noop; worker thấy cờ tắt nên thông báo đang `PENDING` chuyển `SKIPPED` (không gửi). Hộp thông báo trong app **vẫn chạy**. **Reversible**: bật lại bằng `CRM_PUSH_ENABLED=true` + `up -d backend`; thiết bị đã đăng ký vẫn còn, người dùng không phải bật lại. Thông báo đã `SKIPPED` trong lúc tắt không được gửi bù.

### 15.11. Đổi khóa VAPID và hệ quả

Chỉ đổi khi nghi lộ khóa riêng hoặc mất khóa. **Hệ quả: toàn bộ đăng ký hiện có gắn với khóa cũ trở nên vô hiệu** (dịch vụ push từ chối, khoảng 401/403/410, rồi bị thu hồi `GONE`), **mọi người dùng phải vào Cài đặt thông báo và bật lại**. **Không hoàn tác được** (đăng ký cũ không khôi phục được bằng khóa cũ nếu đã bị thu hồi). Báo trước cho người dùng.

1. Sinh cặp mới (15.2), thay vào `.env` (15.3), `up -d backend`.
2. Kiểm `config` (15.4) ra `publicKey` mới; log có "Web Push bật" (15.5).
3. **Không cần build lại frontend**: frontend lấy khóa công khai lúc chạy. Người dùng bật lại thông báo sẽ đăng ký bằng khóa mới.
4. Xóa khóa riêng **cũ** khỏi trình quản lý mật khẩu **chỉ sau khi** xác nhận push chạy với khóa mới (thử 15.8).

### 15.12. Checklist thử thủ công trên điện thoại thật (Oniichan)

Đây là phần **kiểm chứng khác** của FR-08 mà unit test không phủ được (nhận push trên thiết bị thật; tham chiếu từ ghi chú T-41/T-56 sang T-44/T-43). Làm sau bước 5 của 15.1. Đánh dấu từng dòng cho cả iPhone (Safari, PWA đã thêm vào Màn hình chính, iOS 16.4+) và Android (Chrome, PWA):

| # | Bước | iPhone | Android |
|---|---|---|---|
| 1 | Mở PWA (iPhone: từ biểu tượng Màn hình chính); bấm **"Cập nhật"** nếu có | [ ] | [ ] |
| 2 | Cài đặt thông báo: bật, cho phép quyền | [ ] | [ ] |
| 3 | Thiết bị xuất hiện trong danh sách thiết bị của tôi | [ ] | [ ] |
| 4 | Được thêm làm MEMBER: nhận push khi **app đang đóng/ở nền** | [ ] | [ ] |
| 5 | Chạm push mở đúng `/crm/customers/<id>` | [ ] | [ ] |
| 6 | Bật giờ yên lặng bao trùm giờ hiện tại rồi lặp lại bước 4: **không** có push, `pushStatus=SKIPPED` | [ ] | [ ] |
| 7 | Tắt loại thông báo `CUSTOMER_ASSIGNED` rồi lặp lại bước 4: **không** có push | [ ] | [ ] |
| 8 | Gỡ thiết bị trong danh sách thiết bị, lặp lại bước 4: **không** có push | [ ] | [ ] |
| 9 | Đăng xuất: thiết bị bị thu hồi, không còn nhận push cho tài khoản đó | [ ] | [ ] |
| 10 | Thiết bị **chưa** bấm "Cập nhật" (còn bản cũ): không hiện push, đây là hành vi dự kiến | [ ] | [ ] |

Lỗi thường gặp: iPhone không mở từ Màn hình chính thì không đăng ký được; chặn thông báo ở cài đặt hệ điều hành; chế độ tiết kiệm pin/Focus chặn hiển thị; domain không phải HTTPS.

### 15.13. Rollback image với migration 007/008 (Q10)

Nếu sau khi bật cần lùi bản: **được lùi image** dù migration 007/008 đã `--apply` (chúng chỉ thêm trường mới, image cũ vẫn đọc id cũ). Quy trình L1 (lùi image), L2 (`$unset` nếu cần), L3 (`mongorestore`) nằm ở **mục 11**, đoạn "Ngoại lệ v1.0.4 cho migration 007 (mã danh mục, FR-40) và 008 (loại hình, FR-46)". Trước khi lùi, **tắt push trước (15.10)**; lùi image không xóa đăng ký thiết bị.

### 15.14. Đã kiểm chứng / chưa kiểm chứng

Ngày 2026-11-07, `devops-agent`, máy dev, container Mongo/Redis tạm (đã xóa), khóa/mật khẩu giả, **không đụng môi trường dev/prod**.

**Đã chạy thật:**
- Sinh khóa bằng `generateVAPIDKeys()` với lệnh ghi file ở 15.2; độ dài đo được **87/43** (đúng ngưỡng 65/32 byte mà factory kiểm).
- `docker compose config` với biến giả (cờ `true` rồi `false`): `FEATURE_CRM_PUSH` nhận `"true"`/`"false"`, `VAPID_SUBJECT` và `PUSH_ENDPOINT_HOST_ALLOWLIST` có trong `environment` của backend, `VAPID_PRIVATE_KEY` và `VAPID_PUBLIC_KEY` mỗi biến có đúng 1 dòng có giá trị (đếm bằng `grep -c`, không in).
- Biên dịch (`tsc`) và chạy backend thật từ nguồn với Mongo + Redis tạm: `GET /push-subscriptions/config` ra đúng 3 trạng thái ở bảng 15.4 (`enabled:true` + khóa; cờ tắt; cờ bật nhưng thiếu VAPID thì `enabled:false`); log đúng hai câu ở 15.5.
- Nội dung truy vấn theo dõi 15.9 chạy trên dữ liệu mẫu gieo vào Mongo tạm (`PENDING/SENT/SKIPPED`, thiết bị thu hồi `GONE`, `push_deliveries`): ra đủ 5 mục, số đếm khớp dữ liệu gieo.
- `crm-catalog-codes.cli.js --apply` (15.7) trên Mongo tạm rỗng: thoát `0`.
- T-20 đã ghi riêng: trong image production, `require('web-push').generateVAPIDKeys` là hàm (mục 11.5).

**Chưa kiểm chứng (việc của Oniichan, sau deploy, T-48/T-44):**
- Push thật tới thiết bị thật (iPhone/Android) và toàn bộ checklist 15.12, gồm hành vi PWA phải bấm "Cập nhật" trên máy thật.
- VPS thật và Cloudflare: lệnh `docker compose run ... backend node -e ...` (15.2) trong stack thật, `read -rsp` + `curl` qua nginx (15.4), `shred` trên VPS, dòng `auth` bằng biến root trong container Mongo thật (15.9; trên máy dev đã chạy nội dung truy vấn nhưng với Mongo tạm).
- Đổi khóa (15.11) và tắt khẩn cấp (15.10): mới thử ở mức đổi biến và khởi động lại tiến trình backend trên máy dev, chưa với stack compose đầy đủ.
- Quy tắc ai được thêm MEMBER (15.8 bước 4) đã **đối chiếu với mã nguồn** (`canManageMembers`: ADMIN, MANAGER trong phạm vi, hoặc PRIMARY của khách đó; đọc code, ngày 2026-11-07); **chưa thử từng vai trò trên bản chạy thật**.

## 16. Việc kiểm tay sau deploy (v1.0.4, T-44, FR-23, FR-35)

Hai việc **Oniichan tự làm trên production sau khi deploy v1.0.4**; code đã xong hoặc không có code, **không có test tự động**, không chặn phát hành (hậu-deploy). Ô kiểm và chỗ ghi kết quả nằm ở 16.3. Quy ước chung: không dán token/mật khẩu vào chat hay file; thay `<domain-admin>` bằng tên miền thật; mọi lệnh VPS chạy ở thư mục gốc repo (nơi có `docker-compose.yml` và `.env`).

| Việc | FR | Cần quyền | Kết quả cần có |
|---|---|---|---|
| 16.1 IP thật sau cloudflared | FR-23 | ADMIN + SSH VPS | IP ghi ở audit và IP dùng cho giới hạn tần suất là IP thật của người dùng |
| 16.2 Dự án mẫu bị trùng | FR-35 | ADMIN | Không còn dự án mẫu trùng trong danh sách dự án |

### 16.1. FR-23: IP thật của người dùng sau cloudflared

**Vì sao cần.** Cấu hình lấy IP thật (mục 2.1: nginx `set_real_ip_from` đúng một IP cloudflared, `CF-Connecting-IP`, backend `TRUST_PROXY=1`) đã chạy được trên stack thử nhưng **chưa từng thử với cloudflared và Cloudflare thật**. Nếu sai, mọi người dùng chung một IP proxy: audit ghi sai IP và 5 lần đăng nhập sai/phút tính cho cả hệ thống.

**Chuẩn bị.** Một thiết bị truy cập web admin **qua Cloudflare** (domain thật, không qua `localhost`/IP của VPS). Dùng điện thoại bật 4G/5G (tắt Wi-Fi) để có IP công khai khác IP của VPS và của máy tính.

**Bước 1. Ghi lại IP công khai thật của thiết bị (IP A).** Trên điện thoại 4G mở một trang "what is my IP" (ví dụ `https://ifconfig.me`) và chép IP. Lưu ý: thiết bị có IPv6 thì Cloudflare gửi IPv6, nên IP A có thể là IPv6.

**Bước 2. Kiểm cấu hình đang chạy trên VPS (chỉ đọc).**

```bash
docker compose logs backend | grep trustProxy   # kỳ vọng: "trustProxy bật: tin 1 proxy ..."
docker compose config | grep TRUST_PROXY        # kỳ vọng: TRUST_PROXY: "1"
docker exec realestate_frontend nginx -T 2>/dev/null | grep -E 'set_real_ip_from|real_ip_header'
# kỳ vọng: đúng MỘT dòng set_real_ip_from 10.213.77.250 và real_ip_header CF-Connecting-IP (không phải dải mạng)
```

**Bước 3. Tạo một dòng audit từ thiết bị đó.** Trên điện thoại 4G, đăng nhập web admin bằng tài khoản **ADMIN**, mở một khách thử và bấm **"Hiện số"** ở số điện thoại (ghi audit `PHONE_VIEWED` kèm IP của request, không đổi dữ liệu; chịu giới hạn tần suất xem số theo từng người dùng nên chỉ bấm một hai lần).

**Bước 4. Đọc IP đã ghi (VPS, chỉ đọc, ADMIN).** Mật khẩu nhập tay (cùng cách 15.4); route audit chỉ dành cho ADMIN:

```bash
read -rp 'Email admin: ' E; read -rsp 'Mật khẩu: ' P; echo
TOKEN=$(printf '{"email":"%s","password":"%s"}' "$E" "$P" \
  | curl -s http://localhost/api/v1/auth/login -H 'content-type: application/json' -d @- \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
unset P
curl -s "http://localhost/api/v1/crm/audit-logs?action=PHONE_VIEWED&limit=3" -H "Authorization: Bearer $TOKEN" \
  | grep -o '"ip":[^,}]*'
unset TOKEN
```

Dòng đầu tiên (mới nhất) phải có `"ip":"<IP A>"` đúng từng ký tự. Lệnh in cả trường hợp `"ip":null` (backend trả `null` khi request không có IP trong ngữ cảnh): thấy `"ip":null` là lỗi, xem dòng thứ ba của bảng "Cách đọc kết quả sai" bên dưới. Nếu không in dòng nào thì token sai/hết hạn hoặc chưa có dòng `PHONE_VIEWED` (làm lại bước 3 và đăng nhập lại), không phải IP đúng. Cách khác (Mongo, chỉ đọc; dòng `auth` giống 15.9):

```bash
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
db.getSiblingDB("realestate").crm_audit_logs.find({ action: "PHONE_VIEWED" }, { ip: 1, createdAt: 1, _id: 0 }).sort({ createdAt: -1 }).limit(3).forEach(r => print(r.createdAt.toISOString() + " " + r.ip));
EOF
```

Cách đọc kết quả sai:

| `ip` ghi được | Nghĩa là | Việc cần làm |
|---|---|---|
| `10.213.77.x` (`.250` cloudflared, `.1` gateway, hoặc IP container khác) | Backend đang thấy IP nội bộ docker: `set_real_ip_from` không khớp IP thật của cloudflared, hoặc `TRUST_PROXY` thiếu | Đối chiếu IP thật của container `realestate_cloudflared` với `ipv4_address` trong compose và `set_real_ip_from` (mục 2.1); KHÔNG nới thành cả dải mạng |
| IP của Cloudflare (ví dụ `104.16.x.x`, `172.64.x.x` đến `172.71.x.x`, `2606:4700:...`) | Header `CF-Connecting-IP` không được dùng | Kiểm `real_ip_header CF-Connecting-IP` trong nginx đang chạy (bước 2) |
| `127.0.0.1`, IP của VPS hoặc `null` | Request không đi qua tunnel hoặc không có IP trong ngữ cảnh | Kiểm lại bước 3 thực sự đi qua `<domain-admin>` (HTTPS), không phải `localhost` |
| IP khác IP A nhưng là IP công khai | Thiết bị đổi mạng giữa chừng hoặc IPv4/IPv6 khác nhau | Lặp bước 1 và 3 sát nhau, ghi cả IPv4 lẫn IPv6 nếu có |

**Bước 5. Giới hạn tần suất đăng nhập tính theo IP thật.** Dùng **email không tồn tại** (không khóa tài khoản thật nào); mỗi IP được 5 lần/phút:

```bash
# Từ máy tính nối Wi-Fi/mạng khác (IP B), gửi 6 lần đăng nhập sai
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://<domain-admin>/api/v1/auth/login \
    -H 'content-type: application/json' -d '{"email":"khong-ton-tai@example.invalid","password":"sai-mat-khau-1"}'
done; echo
# kỳ vọng: 401 401 401 401 401 429
```

Ngay sau đó (trong vòng 60 giây) đổi sang mạng của IP A (ví dụ máy tính nối điểm phát sóng 4G của điện thoại, hoặc nhờ người khác ở mạng khác) và gửi **một** lần cùng lệnh: kỳ vọng **401** (không phải 429), vì IP A có bộ đếm riêng. Nếu thiết bị thứ hai cũng nhận 429 thì mọi người đang chung một IP proxy: FR-23 chưa đạt, quay lại bảng ở bước 4. Phân biệt 429 của backend (JSON có `statusCode`) với chặn của Cloudflare (trang HTML hoặc mã 1015/403): nếu là Cloudflare thì đó là luật WAF/Rate limiting riêng của Cloudflare, không phải kết quả của phép thử này. Sau 60 giây bộ đếm tự reset.

**Kết quả mong đợi (đạt FR-23):** bước 2 khớp; bước 4 ra đúng IP A; bước 5 hai IP khác nhau có bộ đếm tách biệt. Lệch thì **ghi nhận làm lỗi mới** (mã PT tiếp theo của Plan 03) kèm dòng sai ở bảng bước 4; không tự sửa `nginx.conf` trên VPS.

### 16.2. FR-35: dự án mẫu bị trùng trên production

**Vì sao cần.** Dự án mẫu (seed) hiện nhận diện bằng `seedKey` bất biến, nhưng bản seed **cũ** (trước khi có `seedKey`) có thể đã để lại dự án mẫu bị đổi tên/mã: lần seed sau không nhận ra bản đổi tên và tạo thêm một bản mẫu mới, nên danh sách có hai dự án giống nhau. Đây là việc kiểm dữ liệu, **không còn việc sửa code**. 8 dự án mẫu (mã/tên): `QTERRA` Q'Terra, `PRIVIA` The Privia, `ECOPARK` Ecopark Grand, `VHOP` Vinhomes Ocean Park, `LUMIERE` Lumiere Riverside, `MASTERI` Masteri Centre Point, `AQUA` Aqua City Waterfront, `VHGP` Vinhomes Grand Park.

**Chuẩn bị.** Tài khoản **ADMIN** (xóa/khôi phục dự án chỉ dành cho ADMIN). Đã có bản sao lưu từ lần deploy (`deploy.sh` backup trước khi chạy); xóa ở đây là **xóa mềm, khôi phục được** nên không cần backup riêng.

**Bước 1. Xem danh sách trên web.** Vào menu **Quản lý khách hàng > Danh sách dự án** (`/crm/projects`), bật **"Hiện cả dự án ngừng hoạt động"**. So với 8 dự án mẫu ở trên và ghi lại các cặp trùng (cùng tên, hoặc tên gần giống và cùng chủ đầu tư). Mỗi thẻ có số **"Khách quan tâm"**.

**Bước 2. (Khuyến nghị) Đối chiếu bằng truy vấn chỉ đọc để không sót.** Chạy trên VPS; dòng `auth` giống 15.9:

```bash
docker exec -i realestate_mongo mongosh --quiet --norc --file /dev/stdin <<'EOF'
db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const d = db.getSiblingDB("realestate");
print("(1) Du an chua xoa (so luong): " + d.projects.countDocuments({ deletedAt: null }));
print("(2) Ten trung (khong phan biet hoa/thuong, dau), chi du an chua xoa:");
d.projects.aggregate(
  [
    { $match: { deletedAt: null } },
    { $group: { _id: "$name", n: { $sum: 1 }, codes: { $push: "$code" } } },
    { $match: { n: { $gt: 1 } } },
    { $sort: { _id: 1 } },
  ],
  { collation: { locale: "vi", strength: 1 } }
).forEach(r => print("  " + r._id + " x" + r.n + " ma=" + r.codes.join(",")));
print("(3) Toan bo du an chua xoa (ten | ma | nha phat trien | dang hoat dong | co seedKey):");
d.projects.find({ deletedAt: null }).sort({ developer: 1, name: 1 }).collation({ locale: "vi" }).forEach(p =>
  print("  " + p.name + " | " + p.code + " | " + (p.developer || "-") + " | " + p.isActive + " | " + (p.seedKey ? "co" : "KHONG")));
EOF
```

Mục (2) rỗng và mục (3) không có hai dòng giống nhau là đạt. Mục (2) chỉ bắt trùng **tên**; trùng do đổi tên phải nhìn mục (3) (cùng chủ đầu tư, tên gần giống).

**Bước 3. Quyết định bản giữ và bản xóa cho từng cặp trùng.**
- **Giữ** bản đang có khách quan tâm (hoặc bản đã được Quản trị chỉnh tên/mã).
- **Xóa** bản còn lại, thường là bản mẫu mới sinh ra: `seedKey` = `co`, mã nằm trong 8 mã mẫu, **0 khách**. Xóa mềm vẫn giữ `seedKey` nên lần seed sau **không tạo lại** (seed bỏ qua khi `seedKey` đã tồn tại, kể cả đã xóa mềm).
- Bấm **"Xoá dự án"** trên thẻ bản cần xóa. Nếu dự án còn khách, hệ thống chặn xóa (409 `PROJECT_IN_USE`) và chỉ đề nghị **"Ngừng hoạt động"** (ẩn khỏi lựa chọn mới, khách cũ giữ liên kết). Hai bản cùng có khách thì **không xóa**: chọn ngừng hoạt động bản kém quan trọng hơn hoặc để nguyên và ghi vào 16.3 (hệ thống chưa có công cụ gộp dự án).
- **Reversible**: dự án đã xóa nằm ở **"Hiện dự án đã xoá" > "Khôi phục"** (ADMIN).

**Bước 4. Xác nhận.** Tải lại trang; chạy lại truy vấn bước 2 (nếu dùng) và xem danh sách: không còn cặp trùng ngoài các trường hợp đã ghi nhận ở 16.3.

**Kết quả mong đợi (đạt FR-35):** danh sách dự án không còn dự án mẫu trùng, hoặc phần trùng còn lại đã được ghi rõ lý do (cùng có khách) ở 16.3.

### 16.3. Ô kiểm và ghi kết quả (Oniichan điền sau deploy)

Điền trực tiếp vào bảng này (không ghi mật khẩu/token; IP người dùng được ghi dạng rút gọn nếu ngại, ví dụ che octet cuối).

| # | Việc | Đạt | Ngày/Người | Ghi chú (lệch thì ghi mã PT mới) |
|---|---|---|---|---|
| 1 | 16.1 bước 2: `trustProxy` bật, `TRUST_PROXY=1`, nginx đúng một `set_real_ip_from` | [ ] | | |
| 2 | 16.1 bước 4: `ip` trong audit khớp IP thật của thiết bị | [ ] | | |
| 3 | 16.1 bước 5: hai IP khác nhau có bộ đếm đăng nhập riêng | [ ] | | |
| 4 | 16.2 bước 1-2: đã xem danh sách dự án và ghi các cặp trùng (nếu có) | [ ] | | |
| 5 | 16.2 bước 3-4: đã xóa/ngừng bản trùng (hoặc xác nhận không có) và danh sách sạch | [ ] | | |

### 16.4. Đã kiểm chứng / chưa kiểm chứng

Ngày 2026-11-07, `devops-agent`, máy dev, container Mongo tạm (đã xóa), dữ liệu mẫu giả, không đụng môi trường dev/prod.

**Đã làm:**
- Truy vấn Mongo ở 16.2 bước 2 (gồm `collation` tiếng Việt `strength: 1` cho `$group`) chạy được trên `mongo:7` với dữ liệu giả có sẵn cặp trùng tên (khác chữ hoa/thường, khác hoặc không có `seedKey`) và một bản đã xóa mềm: mục (2) chỉ bắt các bản chưa xóa, mục (3) in đúng cột.
- Đối chiếu mã nguồn: `req.ip` được ghi vào audit (`request-context.middleware.ts` rồi `crm-audit-log.service.ts`, trường `ip` của `crm_audit_logs`); `GET /api/v1/crm/audit-logs` chỉ ADMIN và trả `ip`, nhận tham số `action`, `limit`; hành động `PHONE_VIEWED` ghi audit; xóa dự án chỉ ADMIN, xóa mềm, chặn 409 khi còn khách; `ensureSeeded` bỏ qua khi `seedKey` đã tồn tại kể cả đã xóa mềm; đăng nhập giới hạn 5 lần/phút/IP ở production (mục 2.1).

**Chưa kiểm chứng (cần VPS/Cloudflare thật, việc của Oniichan):**
- Toàn bộ 16.1 trên cloudflared và Cloudflare thật: IP thật ghi vào audit, hành vi `CF-Connecting-IP` (kể cả IPv6/Pseudo IPv4), phép thử 429 qua tunnel.
- Lệnh `docker exec realestate_frontend nginx -T` (16.1 bước 2) và route `GET /api/v1/crm/audit-logs` bằng `curl` + `grep -o` **chưa chạy thật** (chưa dựng stack đầy đủ; dạng JSON trả về chỉ đọc từ mã, `grep -o '"ip":[^,}]*'` không phụ thuộc cấu trúc bọc ngoài). Dòng `auth` Mongo trong container thật đã nêu ở 15.14.
- 16.2 trên dữ liệu production thật: số lượng và hình dạng cặp trùng thực tế, thao tác "Xoá dự án"/"Ngừng hoạt động"/"Khôi phục" trên giao diện thật (chỉ đọc mã giao diện).
- Chưa có số liệu nào về việc production có thực sự đang có dự án trùng hay không.

## 17. CI/CD (KẾ HOẠCH v1.0.7, CHƯA TRIỂN KHAI)

> **Trạng thái (cập nhật 2026-11-16):** Oniichan quyết **gỡ toàn bộ CI/CD khỏi phạm vi v1.0.6 và chuyển sang v1.0.7** (mảng D: FR-24 CI, FR-25 CD, FR-26 gỡ staging local, FR-29 quét bảo mật Trivy/npm audit/Gitleaks/Dependabot; tasks T-42 đến T-53). **Toàn bộ mục này là kế hoạch, KHÔNG phải quy trình hiện hành**: repo **không có** `.github/workflows/`, không có CI, CD, quét bảo mật tự động hay runner nào đang vận hành trong repo. Quy trình thật ở v1.0.6 là chạy tay: `release.sh build` → `release.sh send` (`docker save | ssh | docker load`) → `deploy.sh` (mục 0); đã chạy trên VPS staging ở T-34 đến T-41. Phần dưới giữ lại làm đầu vào cho v1.0.7; thiết kế có thể được duyệt lại khi bắt đầu v1.0.7. Khi các workflow có thật (v1.0.7), đối chiếu lại bảng job với file `.github/workflows/*.yml` (file thắng khi lệch). Runbook vận hành runner (trạng thái, log, khởi động lại, gỡ/đăng ký lại, chính sách PR từ fork) là việc của T-49 (v1.0.7). Ghi chú về runner `staging-runner`: bước cài runner (T-47) đã làm **ngoài repo** trên máy staging, nhưng chưa có workflow nào dùng nó.

Quy trình dự kiến (v1.0.7): **build → lint → test → audit → deploy**. Ba file workflow dự kiến, đúng vai (đều **chưa tồn tại**):

| File | Trigger | Runner | Nội dung |
|---|---|---|---|
| `_tests.yml` | `workflow_call` (reusable) | chỉ `ubuntu-latest` | `lint-fe` (`oxlint`, **cổng chặn**), `lint-be-report` (`npm run lint:ci`, không `--fix`, chỉ báo cáo số lỗi vào job summary), `test-be` (unit + build; integration nếu cần), `test-fe` (`tsc -b`, build, vitest), `test-ops` (`ops/tests/*.test.sh`, gồm test tĩnh quét workflow) |
| `ci.yml` | **chỉ** `pull_request` | chỉ `ubuntu-latest`; `permissions: contents: read`; **không secret** | job `tests` (gọi `_tests.yml`), `docker-build-smoke` (build BE + FE, không push), `npm-audit` (`npm audit --omit=dev` cho BE và Admin App, chỉ báo cáo), `gitleaks` (quét diff của PR, **chặn** khi lộ khóa) |
| `cd.yml` | `push` vào `main` + `workflow_dispatch` | `ubuntu-latest` cho test/e2e; `[self-hosted, staging]` cho build và deploy | một **lượt** gồm `tests`, `e2e-fe` (song song, không chặn deploy), `build`, `deploy-staging`, `deploy-production` |

Chuỗi dự kiến trong `cd.yml` (v1.0.7; cùng một lượt, chung artifact bằng `upload-artifact`/`download-artifact`; không dùng `workflow_run`):

1. `build` (self-hosted `staging-runner`, `needs: tests`): `ops/check-disk.sh`, `./release.sh build` (**build một lần**; trong CI **không đặt thẻ `current`**, chỉ thẻ bất biến `<version>-<commit>`, vì runner dùng chung Docker daemon với stack staging mà compose đọc `current`), quét Trivy hai image (chỉ báo cáo), rồi `upload-artifact` (hai image + `release.env` + gói release, giữ khoảng 7 ngày).
2. `deploy-staging` (environment `staging`, `needs: build`): `download-artifact`, `docker load`, `ops/install-release.sh`, rồi `deploy.sh` **trực tiếp trên máy runner** (không ssh vòng); chỉ `deploy.sh` promote `<version>-<commit>` thành `current` (sau khi kiểm image ID/`.env` và backup); smoke test (liveness, readiness, `/env.js`, frontend 200).
3. `deploy-production` (environment `production`, `needs: deploy-staging`): dùng **cùng artifact** đã qua staging, gửi gói + image tới VPS production bằng ssh (`release.sh send`), host key được ghim (`StrictHostKeyChecking=yes`), khóa ssh là secret của Environment `production`. **Job này cần người duyệt (Oniichan là reviewer bắt buộc của Environment `production`, chỉ nhánh `main`)** trước khi chạy; không có chạy tự động lên production.

Quy tắc an toàn dự kiến (v1.0.7; sẽ kiểm bằng test tĩnh quét `.github/workflows/`, các assertion S1 đến S8):

- Workflow kích hoạt bởi `pull_request` chỉ dùng `ubuntu-latest`, `permissions: contents: read`, **không secret**, không bao giờ `self-hosted`, không `pull_request_target` (repo công khai: PR từ bên ngoài không được chạm runner staging hay secret).
- `[self-hosted, staging]` chỉ có trong `cd.yml` và mọi job đó có guard nhánh `main`.
- Job deploy có `concurrency` với `cancel-in-progress: false` (hai lượt không chồng nhau, không hủy lượt đang chạy). "Re-run jobs" triển khai lại đúng artifact cũ trong hạn; lượt chờ duyệt production có thể lâu hơn hạn artifact thì **chạy lại cả lượt**.
- **Cấm** `docker system prune`, `docker volume prune`, `down -v`/`--volumes` trong pipeline (chúng xóa thẻ `pre-*` là đường lùi); dọn thẻ cũ theo mục 6.3.
- Không `--fix` trong lệnh lint của CI; không in secret ra log; token đăng ký runner và PAT không đưa vào repo.
- Staging không cần khóa ssh (deploy cục bộ trên runner); production cần khóa ssh riêng quyền tối thiểu.

**Chạy tay (đường hiện hành ở v1.0.6, và sẽ là đường dự phòng khi runner hỏng ở v1.0.7):** `./release.sh build` rồi `./release.sh send --to <ssh-host>` từ máy của người có quyền (mục 0). Địa chỉ, IP và tên tài khoản của VPS staging/production không ghi trong repo (công khai); đặt chúng trong `~/.ssh/config` của máy build (và trong secret của CI/CD khi v1.0.7 có CI/CD).

[← Về chỉ mục Hạ tầng](README.md)
