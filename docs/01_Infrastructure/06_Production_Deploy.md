# 06 — Triển khai production (Docker Compose)

> **Phiên bản tài liệu:** v1.0.2

Stack production nằm ở `docker-compose.yml` (thư mục gốc repo). Tài liệu này mô tả kiến trúc, biến môi trường, cách triển khai mới, **quy trình nâng cấp từ bản Mongo standalone cũ**, sao lưu và xử lý sự cố. Stack dev (`RealEstateBackendApp/docker-compose.dev.yml`, project `realestate-dev`) là hệ thống riêng, không bị ảnh hưởng.

> Trạng thái kiểm chứng:
> - **Đã chạy thật** (máy dev, project tạm, mật khẩu giả): Mongo/Redis/MinIO/minio-init; nâng cấp tại chỗ từ standalone; mongodump/mongorestore; `mc mirror`; ký URL bằng host công khai. QA đã dựng và chạy **backend thật** trên stack này: readiness 200 (database/redis/storage up), đăng nhập, tạo khách hàng có transaction, idempotency, upload ảnh + presigned URL (Host khớp trả 200, Host sai trả 403), dữ liệu còn sau restart và `down`/`up`. Với `NODE_ENV=production` đã chạy thật lại: backend khởi động, readiness 200, đăng nhập admin OK, `Set-Cookie` refresh có `Secure`, thiếu `ADMIN_*` trên DB trống thì backend thoát với lỗi rõ ràng.
> - **Chưa kiểm chứng**: frontend nginx; cloudflared và Tunnel thật; đường lui 5.8 và khôi phục từ tar volume; hành vi trên server Linux thật (đặc biệt quyền ghi `./logs`, xem mục 4); đăng nhập qua HTTPS thật phía sau nginx + Cloudflare.
> - **Mới thêm, chưa chạy trên server thật**: service `nine-router` (9Router) trong compose, `scripts/run-migration.sh`, `scripts/check-disk.sh`, `deploy.sh` (mục 11) và thư viện `scripts/lib/ops-common.sh`. **Đã thử thật ở máy dev** (qa-agent và devops-agent): `docker compose config` (kể cả thiếu từng biến bắt buộc); `docker build --target builder` rồi `bash scripts/run-migration.sh` 005 (3 user) và 006 (xóa 3 area, tạo 34 tỉnh) trên Mongo replica set có xác thực tạm; mô phỏng nâng cấp 5.1-5.5 trên volume mẫu; `git_update` của `deploy.sh` trong repo tạm; `deploy.sh` trong container Linux cô lập (Mongo thật, `docker` giả: mongodump, `mongorestore --dryRun`, đếm user chưa migrate 005, cổng dung lượng đĩa, chặn backup rác/rỗng/DB khác); logic chặn của khối 5.8.3. **Vẫn chưa thử**: `compose up` toàn stack, build frontend, stage `production` của backend, `deploy.sh` nguyên vẹn với Docker thật, rollback 5.8 bằng `up` thật, 5.0a trên container thật của VPS, `sudo -n chown`, và môi trường bash 5.2/Docker 29 của VPS.

## 1. Kiến trúc stack

| Service | Container | Image | Dữ liệu (named volume) | Cổng ra host | Ghi chú |
|---|---|---|---|---|---|
| `mongo` | `realestate_mongo` | `${MONGO_IMAGE}` (mặc định `mongo:7`) | `mongo_data:/data/db` | không | Replica set `rs0` 1 node, xác thực + keyFile |
| `redis` | `realestate_redis` | `${REDIS_IMAGE}` (mặc định `redis:7-alpine`) | `redis_data:/data` | không | AOF `everysec`, `noeviction`, `requirepass` |
| `minio` | `realestate_minio` | `${MINIO_IMAGE}` (mặc định `cgr.dev/chainguard/minio:latest`) | `minio_data:/data` | không | S3 nội bộ `http://minio:9000` |
| `minio-init` | `realestate_minio_init` | như `minio` | không | không | Chạy 1 lần, tạo 2 bucket riêng tư + hạn 7 ngày cho `crm-exports` |
| `nine-router` | `realestate_9router` | `${NINE_ROUTER_IMAGE}` (mặc định `decolua/9router:latest`) | `nine_router_data:/app/data` | `127.0.0.1:20128` (mặc định, đổi bằng `NINE_ROUTER_BIND_ADDR`) | 9Router, cổng định tuyến AI (một phần sản phẩm). Backend gọi `http://nine-router:20128/v1` trong network nội bộ |
| `backend` | `realestate_backend` | build `RealEstateBackendApp` | bind `./logs`, `./.env` | không | Chờ mongo + redis healthy, minio-init xong. Có `healthcheck` gọi liveness (mục 7); số phiên bản + commit nằm trong image ở `dist/version.json` (mục 11.1) |
| `frontend` | `realestate_frontend` | build `RealEstateAdminApp` (nginx) | không | `80` | Proxy `/api/` sang backend; `client_max_body_size 6m` (upload ảnh CRM tối đa 5 MB, phải >= giới hạn backend) |
| `cloudflared` | `realestate_cloudflared` | `${CLOUDFLARED_IMAGE}` (mặc định `cloudflare/cloudflared:latest`) | không | không | Tunnel token, hostname cấu hình ở dashboard Cloudflare |

```
Internet ── Cloudflare ── cloudflared ─┬─ <domain-admin> ─> frontend:80 ─> backend:3000 ─┬─> mongo:27017 (rs0, auth)
                                       │                                                 ├─> redis:6379  (password)
                                       └─ <domain-file>  ─> minio:9000 <─────────────────┘   minio:9000 (S3, nội bộ)
```

Tất cả nằm trong network `realestate_net` (subnet cố định `10.213.77.0/24`, cloudflared giữ IP tĩnh `10.213.77.250`, xem mục 2.1); **chỉ frontend publish cổng 80 ra mọi interface**, ngoài ra chỉ có cổng `20128` của 9Router (dashboard + API), mặc định bind **`127.0.0.1`** (chỉ vào được từ chính máy chủ). Cổng Mongo `27017` đã bị bỏ (trước đây mở ra mọi interface mà không có xác thực).

**9Router (`nine-router`)**: backend dùng thật (`ACTIVE_AI_PLATFORM=9Router`, `NINEROUTER_BASE_URL=http://nine-router:20128/v1` trong `.env` của backend). Tên service **phải giữ là `nine-router`** (tên DNS nội bộ). Vì backend gọi qua tên service trong network nội bộ nên **không phụ thuộc** cổng publish ra host. Vào dashboard từ xa bằng SSH tunnel: `ssh -L 20128:localhost:20128 <user>@<host>` rồi mở `http://localhost:20128`.

- **Chuyển từ cấu hình cũ (`0.0.0.0`, mọi interface) sang mặc định `127.0.0.1`:** truy cập dashboard trực tiếp qua IP/Tailscale của VPS sẽ **ngừng hoạt động**; muốn giữ thì đặt `NINE_ROUTER_BIND_ADDR=0.0.0.0` trong `.env.docker` (dashboard lộ ra mạng đó, cân nhắc kỹ).
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

Compose đọc biến `${...}` từ file `--env-file`. **Dùng chính `.env.docker`** (file đang chứa `CLOUDFLARE_TUNNEL_TOKEN` và là `env_file` của backend), luôn chạy:

```bash
docker compose --env-file .env.docker <lệnh>
```

Mẫu toàn placeholder: `.env.docker.example`. Biến mới cần thêm vào `.env.docker`:

| Biến | Bắt buộc | Dùng cho | Cách sinh / ghi chú |
|---|---|---|---|
| `MONGO_ROOT_USERNAME` | có | user root Mongo, backend | tên tùy chọn |
| `MONGO_ROOT_PASSWORD` | có | root Mongo, backend | `openssl rand -hex 24` (hex để an toàn trong URI) |
| `MONGO_KEYFILE` | có | keyFile replica set | `openssl rand -hex 64` (1 dòng, 6-1024 ký tự base64/hex) |
| `REDIS_PASSWORD` | có | Redis, backend | `openssl rand -hex 24` |
| `S3_ACCESS_KEY_ID` | có | root user MinIO + access key backend | >= 3 ký tự, không dùng `minioadmin` |
| `S3_SECRET_ACCESS_KEY` | có | root password MinIO + secret backend | `openssl rand -hex 24` (>= 8 ký tự) |
| `S3_PUBLIC_ENDPOINT` | khi dùng ảnh/export | backend ký signed URL | `https://<domain-file>`, xem mục 3 |
| `MINIO_IMAGE`, `MONGO_IMAGE`, `REDIS_IMAGE`, `NINE_ROUTER_IMAGE`, `CLOUDFLARED_IMAGE` | không | image của từng service | mặc định = tag hiện tại (`cgr.dev/chainguard/minio:latest`, `mongo:7`, `redis:7-alpine`, `decolua/9router:latest`, `cloudflare/cloudflared:latest`). Ghim digest và nâng cấp image có chủ đích: **mục 12** (PT-009) |
| `S3_BUCKET_ATTACHMENTS`, `S3_BUCKET_EXPORTS` | không | tên bucket | mặc định `crm-attachments`, `crm-exports`. **CẢNH BÁO: `S3_BUCKET_EXPORTS` phải đúng `crm-exports` (có chữ `s`).** VPS cũ từng gõ nhầm `crm-export`: sai tên thì xuất file CRM lỗi, hoặc ghi vào bucket không có rule tự xóa sau 7 ngày. Chỉ đặt biến này khi thật sự đổi tên bucket; để trống là an toàn nhất. Kiểm: `docker compose --env-file .env.docker config \| grep -E 'S3_BUCKET_'` (hai tên bucket, không phải bí mật) và `mc ls local` (mục 7) phải thấy đúng hai bucket `crm-attachments`, `crm-exports` |
| `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD`, `S3_APP_ACCESS_KEY_ID`, `S3_APP_SECRET_ACCESS_KEY` | không | tài khoản quyền tối thiểu cho backend (thay root) | mặc định để trống = backend dùng root như cũ. Cách tạo và chuyển: **mục 13** (PT-016). Mật khẩu hex, không đặt trong repo |
| `S3_SIGNED_URL_TTL_SECONDS`, `REDIS_KEY_PREFIX` | không | backend | mặc định 900 và `rem:` |
| `CRM_ENABLED`, `CRM_ATTACHMENTS_ENABLED` | không | cờ CRM dùng chung backend (`FEATURE_CRM_*`) và build frontend (`VITE_*`) | mặc định `false`; xem mục 10. **Không** đặt `FEATURE_CRM_*` trong `.env.docker` (compose ghi đè) |
| `FRONTEND_URL` | nên có | CORS (origin duy nhất được phép) và chuyển hướng sau Google Drive OAuth | `https://<domain-admin>` (scheme + host, không dấu `/` cuối, không đường dẫn); thiếu thì compose dùng `http://localhost` (OAuth sẽ về localhost). Cách kiểm: mục 13.1 |
| `CRM_PII_ENCRYPTION_KEY` | **có khi bật CRM** | mã hóa CCCD (AES-256-GCM) | `openssl rand -base64 32`; **mất khóa = không giải mã lại được CCCD đã lưu**, sao lưu ngoài máy chủ |
| `CLOUDFLARE_TUNNEL_TOKEN` | **có** | token Cloudflare Tunnel (`cloudflared`) | lấy ở Cloudflare Zero Trust; thiếu thì `docker compose` báo lỗi ngay (trước đây thiếu thì cloudflared chạy với token rỗng và lỗi âm thầm) |
| `NINE_ROUTER_INITIAL_PASSWORD` | có | mật khẩu dashboard 9Router (`INITIAL_PASSWORD` của container `nine-router`) | `openssl rand -hex 16`; theo README chỉ có tác dụng khi volume `nine_router_data` chưa có mật khẩu đã lưu (VPS đang chạy: không đổi được mật khẩu hiện có, nhưng vẫn phải điền); không ghi vào repo/chat |
| `NINE_ROUTER_BIND_ADDR` | không | địa chỉ host mà cổng `20128` bind | mặc định `127.0.0.1` (chỉ từ máy chủ; vào từ xa bằng SSH tunnel). `0.0.0.0` = mọi interface, chỉ khi thật sự cần vào qua IP/Tailscale |

Compose tự dựng (đặt qua `environment`, ghi đè `env_file`) nên **không cần** khai báo tay trong `.env.docker`: `MONGODB_URI` (`mongodb://<user>:<pwd>@mongo:27017/realestate?authSource=admin&replicaSet=rs0`), `REDIS_URL` (`redis://:<pwd>@redis:6379`), `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, 2 tên bucket. Dòng `MONGODB_URI` cũ trong `.env.docker` có thể xóa, **nhưng giữ lại cho tới hết bước 5.7 nếu còn cần đường lui 5.8** (backend cũ cần nó để nối Mongo standalone).

Lưu ý ký tự đặc biệt trong mật khẩu:

- **Redis**: backend đọc `REDIS_URL` bằng `new URL()` rồi `decodeURIComponent` cho user/password (`src/shared/redis/redis.config.ts`), nên mật khẩu có ký tự đặc biệt vẫn dùng được nếu URL-encode. Nhưng compose ghép chuỗi **không** tự encode, vì vậy dùng hex để khỏi phải nghĩ. Dạng `redis://:<pwd>@host` (username rỗng) chạy tốt với backend (ioredis, đã thử); riêng `redis-cli -u redis://:<pwd>@...` báo WRONGPASS (đặc điểm của redis-cli), hãy dùng `REDISCLI_AUTH`.
- **Mongo**: ký tự `: / ? # [ ] @ % +` trong mật khẩu làm hỏng URI; dùng hex.
- Không dùng `$` trong bất kỳ giá trị nào của `.env.docker` (compose coi là biến).

Ghim image theo digest (production): xem **mục 12**. Lấy digest của bản **đang chạy** bằng `bash scripts/print-image-digests.sh`; không `docker pull` rồi lấy digest mới (bản mới có thể khác bản đang chạy).

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
- Đổi IP/subnet thì sửa **đồng thời** `ipv4_address`/`ipam` trong compose và `set_real_ip_from` trong nginx.conf, rồi build lại frontend (`docker compose --env-file .env.docker up -d --build frontend cloudflared`). Chọn dải không trùng mạng nội bộ/VPN của server; nếu trùng, `up` báo `Pool overlaps`.
- Không đổi `proxy_set_header X-Forwarded-For` về `$proxy_add_x_forwarded_for` (cộng dồn header do client gửi).
- Không bỏ `ip_range` (nếu bỏ, container khác có thể bị cấp đúng `.250` trước cloudflared).
- Đổi ipam của network `realestate_net` đang tồn tại cần tạo lại network: chạy `docker compose --env-file .env.docker down` (KHÔNG `-v`) rồi `up -d --build`. Có downtime ngắn, dữ liệu trong volume không mất.
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
3. Đặt `S3_PUBLIC_ENDPOINT=https://<domain-file>` trong `.env.docker` (không dấu `/` cuối, không đường dẫn), rồi `docker compose --env-file .env.docker up -d backend`.
4. (Khuyến nghị) Cloudflare WAF: chỉ cho `GET`/`HEAD` tới `<domain-file>`; chặn mọi đường dẫn không bắt đầu bằng tên bucket. Bucket vẫn riêng tư, chỉ truy cập được bằng URL đã ký (15 phút).

Trình duyệt tải ảnh qua thẻ `<img>`/liên kết nên không cần CORS. Nếu sau này dùng `fetch`/XHR từ trang web, cần thêm CORS cho MinIO.

## 4. Triển khai mới (volume `mongo_data` rỗng)

```bash
# 1) Chuẩn bị file biến và thư mục bind-mount
cp .env.docker.example .env.docker          # điền giá trị thật, sinh mật khẩu theo mục 2
touch .env                                  # file được bind-mount vào backend; thiếu thì Docker tạo THƯ MỤC .env và backend lỗi
mkdir -p logs && chown 1000:1000 logs     # backend chạy USER node (uid 1000) trong container, cần quyền ghi ./logs (dùng sudo nếu cần)

# 2) Kiểm tra cú pháp + biến bắt buộc
docker compose --env-file .env.docker config -q

# 3) Dựng stack (lần đầu mongo tự tạo user root, tự rs.initiate qua healthcheck)
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps -a   # mongo/redis/minio healthy; minio-init "Exited (0)" là bình thường

# 4) Cloudflare: thêm hostname <domain-file> -> http://minio:9000 (mục 3), đặt S3_PUBLIC_ENDPOINT, up -d backend
```

Backend seed admin theo `ADMIN_EMAIL`/`ADMIN_PASSWORD` (bắt buộc ở production). Kiểm tra sức khỏe ở mục 7.

## 5. Nâng cấp tại chỗ từ Mongo standalone cũ

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
bash scripts/check-disk.sh 5                               # thoát mã 1 nếu trống < 5 GB: `up --build` dựng backend (3 stage) + frontend, để lại image + build cache vài GB
docker builder prune -f                                    # nếu thiếu đĩa: dọn build cache trước (cũng dọn được sau migration 5.4a), rồi chạy lại dòng trên
```

**Kẹt đĩa (đã `docker builder prune -f` mà `check-disk.sh 5` vẫn báo thiếu):** nhu cầu đỉnh đã đo ở máy dev: dựng backend (3 stage) để lại ~+3.49 GB image, thêm frontend tổng ~+4.1 GB; riêng stage `builder` của migration ~+3.75 GB. **Số đo trên VPS thật (2026-11-02, PT-007):** lúc `up --build` dung lượng trống chạm **đáy 1,9 GB** (từ khoảng 4,0 GB); ở mức này Mongo/Docker ghi thêm đã có nguy cơ đầy đĩa, nên đừng hạ ngưỡng quá thấp. Chọn một trong các cách (theo thứ tự nên thử):

1. **Dọn thêm, an toàn:** `docker image prune -f` (image mồ côi); xóa **từng** image cũ cụ thể không còn dùng (`docker image ls`, rồi `docker image rm <tên:thẻ>`, gồm thẻ `realestate-migrate:*`, `realestatemanager-backend:pre-*` của các lần deploy cũ; GIỮ `*:pre-upgrade` nếu còn cần đường lui 5.8); dọn log/`backups/` cũ đã chép ra ngoài máy chủ. **Tuyệt đối KHÔNG** chạy `docker volume prune`, `docker system prune --volumes`, `docker volume rm` hay `docker compose down -v` (xóa dữ liệu `mongo_data`, `redis_data`, `minio_data`, `nine_router_data`), và **không** `docker image prune -a` (xóa cả image `*:pre-upgrade` của đường lui).
2. **Hạ ngưỡng CÓ Ý THỨC** khi đã thấy số liệu trống thật sự đủ cho nhu cầu đỉnh ~4.1 GB: `bash scripts/check-disk.sh 4`, hoặc `MIGRATE_MIN_FREE_GB=4 bash scripts/run-migration.sh ...`. Ngưỡng 5 GB có dư an toàn; hạ xuống 4 là chấp nhận rủi ro đầy đĩa giữa chừng khi build.
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
| `CRM_PII_ENCRYPTION_KEY`, `.env.docker` | Cao | Lưu ở secret manager, tách khỏi máy chủ |

```bash
install -d -m 700 backups; D=backups/$(date +%F); install -d -m 700 "$D"      # thư mục 700 (backup chứa dữ liệu khách hàng)

# MongoDB (đã chạy thử trong container Mongo cô lập). Mật khẩu root đọc từ biến môi trường TRONG container và đưa cho
# mongodump qua pipe `--config <(...)`: không nằm trên dòng lệnh (không lộ trên `ps` của host), không ghi ra đĩa. File ghi thẳng ra host, quyền 600.
( umask 077; docker exec realestate_mongo bash -c 'mongodump --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --db realestate --archive --gzip' > "$D"/mongo.archive.gz )
ls -l "$D"/mongo.archive.gz                                  # phải > 0 byte, không thì DỪNG
# Kiểm NỘI DUNG (chỉ đọc, `--dryRun`): phải thấy dòng `archive prelude `realestate.users``, không thì backup vô dụng, DỪNG
docker exec -i realestate_mongo bash -c 'mongorestore --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --dryRun -v --archive --gzip --nsInclude "realestate.*" 2>&1' < "$D"/mongo.archive.gz | grep 'realestate.users'

# MinIO: mirror bucket ra thư mục (đã chạy thử). Cần S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY trong shell:
export S3_ACCESS_KEY_ID=$(grep '^S3_ACCESS_KEY_ID=' .env.docker | cut -d= -f2-)
export S3_SECRET_ACCESS_KEY=$(grep '^S3_SECRET_ACCESS_KEY=' .env.docker | cut -d= -f2-)
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

## 7. Kiểm tra sức khỏe

```bash
docker compose --env-file .env.docker ps -a
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
| `required variable ... is missing a value` | Chạy compose không kèm `--env-file .env.docker`, hoặc thiếu biến | Dùng `--env-file .env.docker`; bổ sung biến theo mục 2 |
| Backend mount `./.env` lỗi / `.env` thành thư mục | Chưa có file `.env` trên host khi `up` lần đầu | Xóa thư mục `.env`, `touch .env`, `up` lại |
| `mongo` mãi `unhealthy`, log `Authentication failed` | Volume cũ có dữ liệu nhưng chưa tạo user (nâng cấp chưa làm) | Làm mục 5 |
| `mongo` unhealthy, log keyFile `permissions too open` / `too short` | `MONGO_KEYFILE` rỗng/quá ngắn, hoặc entrypoint bị sửa | Đặt `openssl rand -hex 64`; không sửa entrypoint |
| Backend `Authentication failed` / `MongoParseError` | Mật khẩu có ký tự đặc biệt trong URI | Đổi sang hex; backend `authSource=admin` đã có sẵn trong URI |
| Backend `Server selection timed out`, host `localhost:27017` | `rs.initiate` từng chạy với host khác `mongo:27017` | Với root đã đăng nhập: `cfg = rs.conf(); cfg.members[0].host = 'mongo:27017'; rs.reconfig(cfg, {force: true})` |
| Redis `WRONGPASS` / `NOAUTH` | `REDIS_PASSWORD` đổi nhưng container Redis chưa tạo lại | `docker compose --env-file .env.docker up -d redis backend` |
| `redis-cli -u redis://:pwd@...` báo WRONGPASS | Đặc điểm redis-cli với username rỗng (backend không bị) | Dùng `REDISCLI_AUTH` hoặc `redis://default:pwd@...` |
| Signed URL `SignatureDoesNotMatch` (403) | Tunnel đặt "HTTP Host Header"; `S3_PUBLIC_ENDPOINT` có đường dẫn/dấu `/` cuối; lệch giờ máy chủ | Gỡ override Host; sửa biến; đồng bộ NTP |
| Ảnh không tải, URL trỏ `http://minio:9000` | `S3_PUBLIC_ENDPOINT` trống | Đặt theo mục 3 |
| `minio-init` thoát khác 0 | MinIO chưa sẵn sàng hoặc sai credential | `docker logs realestate_minio_init`; kiểm tra `S3_*` |
| Backend restart liên tục, log `ADMIN_EMAIL/ADMIN_PASSWORD must be set in production` | DB chưa có user nhưng thiếu `ADMIN_*` trong `.env.docker` | Điền `ADMIN_EMAIL`, `ADMIN_PASSWORD` rồi `up -d backend` |
| Đăng nhập thành công nhưng bị đẩy ra lại | Cookie `Secure` bị bỏ khi truy cập HTTP qua IP/hostname | Truy cập qua HTTPS (Cloudflare) hoặc `http://localhost` |
| Nhiều người cùng bị 429 khi đăng nhập | Rate limit đang đếm theo IP của nginx/gateway thay vì IP thật: do `TRUST_PROXY` bị xóa/sai, hoặc nginx.conf/compose bị sửa (IP tĩnh cloudflared lệch `set_real_ip_from`, hoặc thêm cả dải docker) | Làm theo mục 2.1, chạy phép kiểm bằng lệnh; xác nhận log backend có `trustProxy bật: tin 1 proxy` |
| Mất sạch dữ liệu sau thao tác | Chạy `down -v`, hoặc đổi tên project nên volume mới rỗng | Khôi phục từ backup ngoài máy (mục 6); lần sau tuyệt đối không `-v` |

## 9. Việc cần làm thủ công (tóm tắt)

1. Sinh mật khẩu/keyFile và điền `.env.docker` theo mục 2; **sao lưu `.env.docker` và `CRM_PII_ENCRYPTION_KEY` ra ngoài máy chủ**.
2. Bật CRM: làm theo mục 10 (cờ `CRM_ENABLED`/`CRM_ATTACHMENTS_ENABLED`).
3. Cloudflare: thêm hostname `<domain-file>` -> `http://minio:9000` (mục 3), đặt `S3_PUBLIC_ENDPOINT`.
4. Nếu production đang có dữ liệu: thực hiện mục 5 theo thứ tự (gồm 5.0a nếu VPS có bản sửa tay/HEAD detached/`deploy.sh` cũ, và migration 005 rồi 006 ở 5.4a trước khi khởi động backend), không bỏ bước backup, chạy trong `tmux`.
5. Ghim image theo digest của bản đang chạy (mục 12; chưa ghim cái nào); thiết lập cron backup + chép ra ngoài máy chủ.
6. `NODE_ENV=production` **đã được đặt** cho backend trong compose (Oniichan đã quyết định). Bắt buộc `ADMIN_EMAIL`/`ADMIN_PASSWORD` trong `.env.docker` khi DB chưa có user. Cookie refresh có cờ `Secure` nên truy cập qua HTTPS (Cloudflare) hoặc `http://localhost`; truy cập HTTP qua IP/hostname thường sẽ không giữ được cookie đăng nhập. Chi tiết và bảng hành vi ở mục 2.
7. (a) **Swagger đã tắt ở production** (PT-008, quyết định 2026-11-02; có hiệu lực sau deploy kế tiếp, xác minh `NODE_ENV` thật ở mục 2); (b) đặt `FRONTEND_URL=https://<domain-admin>` trong `.env.docker` (compose đã đọc biến này; trước đây bị đặt cứng `http://localhost`): cách kiểm ở mục 13.1 (PT-016).
8. Server Linux: `mkdir -p logs && chown 1000:1000 logs` trước `up` lần đầu (backend chạy uid 1000).
9. Tạo user Mongo riêng quyền `readWrite` trên DB `realestate` cho backend (hiện backend dùng root, theo thiết kế đơn giản ban đầu) và access key MinIO riêng thay vì root: runbook ở mục 13.3 và 13.4 (PT-016; compose đã hỗ trợ sẵn `MONGO_APP_*`/`S3_APP_*`, chưa đặt trên VPS). Kiểm cổng 27017/firewall: mục 13.2.
10. 9Router: điền `NINE_ROUTER_INITIAL_PASSWORD` (bắt buộc) vào `.env.docker`; đối chiếu biến môi trường của container đang chạy với service mới (mục 5.0a), mang sang compose mọi biến image có đọc mà bản sửa tay đã đặt (`API_KEY_SECRET`, `JWT_SECRET`, `MACHINE_ID_SALT`, `REQUIRE_API_KEY`...); cổng `20128` mặc định `127.0.0.1` (dashboard qua SSH tunnel; qua IP/Tailscale cần `NINE_ROUTER_BIND_ADDR=0.0.0.0`; xác nhận không có Cloudflare ingress/`tailscale serve` trỏ vào host:20128); thêm volume `nine_router_data` vào lịch backup (mục 6); cân nhắc pin tag/digest cho image `decolua/9router` (hiện `:latest`).
11. Token Cloudflare: `CLOUDFLARE_TUNNEL_TOKEN` là biến bắt buộc trong `.env.docker` (mục 5.0a (e) hướng dẫn chép từ `deploy.sh` cũ mà không in ra). Chỉ xóa/`shred` `~/deploy.sh.old` sau khi tunnel đã lên và chạy ổn (5.7).
12. Từ nay cập nhật bằng `deploy.sh` trong repo (mục 11), thay script cũ trên VPS. Người commit `deploy.sh` từ Windows chạy `git add --chmod=+x deploy.sh scripts/run-migration.sh` để giữ bit thực thi (tài liệu vẫn dùng `bash deploy.sh` nên không phụ thuộc bit này).
13. Dọn định kỳ thẻ image dự phòng `realestatemanager-backend:pre-*` và image `realestate-migrate:*` (mục 5.7/11); script từ chối chạy khi dung lượng đĩa thấp.

## 10. Bật CRM trên production

Cờ CRM có hai phía và **phải khớp**: backend đọc lúc chạy, frontend Vite **nhúng lúc build**. Compose dùng chung hai biến trong `.env.docker`:

| Biến | Backend | Frontend (build arg) | Ghi chú |
|---|---|---|---|
| `CRM_ENABLED` | `FEATURE_CRM_ENABLED` | `VITE_CRM_ENABLED` | công tắc tổng, mặc định `false`; chỉ ghi đúng `true`/`false` chữ thường (backend nhận cả `1`/`yes`/`on` nhưng frontend thì không, sẽ lệch) |
| `CRM_ATTACHMENTS_ENABLED` | `FEATURE_CRM_ATTACHMENTS` | `VITE_FEATURE_CRM_ATTACHMENTS` | ảnh nhật ký; cần MinIO + `S3_PUBLIC_ENDPOINT` (mục 3) |
| (cố định) | `FEATURE_CRM_IMPORT=false`, `FEATURE_CRM_PUSH=false` | `VITE_CRM_MOCK_REPORTS=false`, `VITE_CRM_MOCK_IMPORT_EXPORT=false` | M8 chưa làm; không cho dữ liệu mẫu lọt vào production |

**Thứ tự thực hiện (trên server, sau khi đã làm xong mục 4 hoặc 5):**

1. Sinh khóa PII: `openssl rand -base64 32` (đúng 32 byte; mỗi môi trường 1 khóa).
2. **Sao lưu khóa ngoài máy chủ** (secret manager/két mật khẩu) và xác nhận đọc lại được. Đổi hoặc mất khóa = CCCD đã mã hóa không giải mã lại được và **không có cách khôi phục**.
3. Điền `.env.docker`: `CRM_PII_ENCRYPTION_KEY=<khóa>`, `CRM_ENABLED=true`, (tùy chọn) `CRM_ATTACHMENTS_ENABLED=true`, `FRONTEND_URL=https://<domain-admin>`. Xóa mọi dòng `FEATURE_CRM_*` cũ trong file (bị compose ghi đè, dễ gây nhầm).
4. Sao lưu Mongo trước khi bật (mục 6).
5. Build lại frontend và tạo lại backend: `docker compose --env-file .env.docker up -d --build --force-recreate backend frontend`. Bắt buộc `--build` vì cờ Vite nhúng lúc build.
6. Lần chạy đầu backend tự seed (idempotent, không ghi đè phần Quản trị đã sửa): tình trạng khách, nguồn khách, kết quả liên hệ, khu vực, dự án, nhóm trường và trường chân dung. Đã quan sát trên stack thử: `{"statuses":4,"leadSources":6,"contactResults":7,"areas":15,"projects":8}` và `{"personaGroups":7,"personaFields":25}`.

**Kiểm tra sau khi bật:**

```bash
docker logs realestate_backend 2>&1 | grep -E "Feature flags|Seed"     # CRM_ENABLED:true (+ CRM_ATTACHMENTS:true), có dòng Seed CRM xong
docker compose --env-file .env.docker exec frontend sh -c 'grep -rho "VITE_CRM_ENABLED:.true." /usr/share/nginx/html/assets | head -1'   # bundle có cờ bật
```

Rồi đăng nhập web: thấy menu "Quản lý khách hàng"; tạo thử một khách; nếu bật ảnh thì thêm ảnh vào nhật ký (URL ảnh có host `<domain-file>`). Đã chạy thật trên stack thử (không qua Cloudflare): đăng nhập, `GET /crm/customers` 200, danh mục có dữ liệu seed, tạo khách, upload ảnh 201, cờ trong bundle bật và mock tắt.

**Tắt lại:** đặt `CRM_ENABLED=false` (và `CRM_ATTACHMENTS_ENABLED=false`), chạy lại lệnh ở bước 5. Dữ liệu CRM đã tạo vẫn nằm trong Mongo/MinIO (không bị xóa); theo thiết kế (CrmFeatureGuard) các route `/crm/*` của backend trả 404 và menu ẩn (phần tắt lại chưa chạy thử). **Giữ nguyên `CRM_PII_ENCRYPTION_KEY`** trong `.env.docker` kể cả khi tắt, để bật lại vẫn giải mã được.

**Lỗi thường gặp khi bật:** CRM bật nhưng thiếu `CRM_PII_ENCRYPTION_KEY` thì backend không khởi động (đã thử: container restart liên tục). Lưu ý nhật ký lỗi hiện chỉ in `ERROR [ExceptionHandler] {}` mà không in nguyên nhân, nên khi thấy restart loop kèm dòng đó hãy kiểm tra khóa trước (đúng 32 byte, base64/hex, không có khoảng trắng/dấu nháy). Menu CRM không hiện sau khi đổi cờ: quên `--build` frontend, hoặc trình duyệt giữ bản JS cũ (tải lại cứng).

## 11. Cập nhật stack bằng `deploy.sh`

`deploy.sh` (thư mục gốc repo, thay script cũ trên VPS) cập nhật stack **đang chạy ổn định ở cấu hình mới** lên commit mới nhất của nhánh `production`. Chạy trên server Linux (Ubuntu 24.04), trong thư mục repo, **trong `tmux`/`nohup`** (rớt SSH giữa chừng không làm gián đoạn):

```bash
bash deploy.sh              # git pull --ff-only origin production, rồi backup + build + up + chờ healthy
bash deploy.sh --no-pull    # không pull, deploy đúng commit đang checkout
bash deploy.sh --plan-only  # chỉ lập kế hoạch migration (reconcile dry-run) rồi thoát: không backup, không ghi DB, không up (mục 11.1)
bash deploy.sh --no-migrate # TẮT tự migrate (mặc định là BẬT): có việc chờ hoặc cần baseline thì dừng trước `up` như trước đây
bash deploy.sh --help       # `--migrate` còn là bí danh của chế độ mặc định (tự migrate), giữ cho tương thích
```

Dùng `bash deploy.sh` (không `./deploy.sh`): commit từ Windows có thể làm mất bit thực thi. Người commit chạy `git add --chmod=+x deploy.sh scripts/run-migration.sh` nếu muốn giữ bit. Script `source` thêm `scripts/lib/ops-common.sh` (hàm dùng chung với `scripts/run-migration.sh`), nên phải chạy trong bản repo đầy đủ.

**Không phải công cụ nâng cấp standalone lần đầu.** Lần đó làm theo mục 5, từng bước (tạo user/replica set trên dữ liệu cũ, migration 005/006 trước khi backend lên). `deploy.sh` từ chối chạy nếu thấy container Mongo đang ở cấu hình cũ (không xác thực).

Thứ tự các bước của script:

| # | Bước | Dừng khi |
|---|---|---|
| 1 | Kiểm tra `docker`, `docker compose`, `curl`, `gzip`; `.env.docker` tồn tại, quyền **không rộng hơn 600**, **không còn giá trị mẫu `<...>`** (chỉ in TÊN biến, không in giá trị); `./.env` là file (tạo rỗng nếu thiếu) | thiếu lệnh, quyền rộng hơn 600 (`chmod 600 .env.docker`), còn `<...>`, `./.env` là thư mục |
| 1b | Dung lượng trống >= `DEPLOY_MIN_FREE_GB` (mặc định 5 GB) ở thư mục repo và thư mục dữ liệu Docker | thiếu dung lượng: in `docker system df` và gợi ý dọn (5.7) |
| 2 | `git pull --ff-only origin production` (bỏ qua với `--no-pull`); khóa `.git/realestate-deploy.lock` chống chạy chồng | không ở nhánh `production` hoặc HEAD detached (script **không tự đổi nhánh**: xem 5.0a), working tree có file đã theo dõi bị sửa (vd `docker-compose.yml` sửa tay: xem 5.0a; **đừng `git stash`**), pull không fast-forward |
| 3 | `docker compose --env-file .env.docker config -q` | thiếu/sai biến bắt buộc (gồm `CLOUDFLARE_TUNNEL_TOKEN`, `NINE_ROUTER_INITIAL_PASSWORD`); stack chưa bị đổi |
| 3b | Mongo đang healthy thì **đếm (chỉ đọc)** user chưa có `roles[]`/`teamIds[]` bằng cùng bộ lọc với `UserRolesMigrationGuard` | còn user chưa migrate 005: in hướng dẫn `bash scripts/run-migration.sh 005` (tránh backend mới crash-loop). Không đếm được thì chỉ cảnh báo |
| 4 | Tạo `logs/`, chown `1000:1000` (backend chạy uid 1000; compose chỉ mount `./logs`): thử trực tiếp, rồi `sudo -n`; không được thì **in lệnh `sudo chown ...` để bạn chạy** | không chown được |
| 5 | `mongodump` DB `realestate` ra `backups/deploy-pre-<thời-gian>.archive.gz` (quyền 600, thư mục 700) qua `docker exec`; mật khẩu đọc từ biến môi trường TRONG container, đưa qua pipe; kiểm **nội dung** (> 0 byte, `gzip -t`, `mongorestore --dryRun` thấy `realestate.users`) | mongo không chạy, mongodump lỗi hoặc quá `DUMP_TIMEOUT` (mặc định 900 giây), file rỗng/hỏng/không phải dump DB `realestate` (bước kiểm nội dung có thời hạn `OPS_EXEC_TIMEOUT`, mặc định 300 giây) |
| 6 | Gắn thẻ image backend đang chạy thành `<project>-backend:pre-<thời-gian>` (bản dự phòng) | |
| 6a | `export GIT_COMMIT=<commit ngắn>` rồi `docker compose build backend` (build arg `GIT_COMMIT` ghi commit vào `dist/version.json` của image mới). **Chưa đụng stack đang chạy** (container cũ giữ image cũ theo ID) | build lỗi (stack không đổi) |
| 6b | Migration theo version (PT-027, **mặc định BẬT**), chạy runner trong image vừa build bằng `docker compose run --rm --no-deps backend node dist/migrations/cli.js`, **luôn SAU backup bước 5**: (i) `reconcile --by deploy --skip-version` (**dry-run**, chỉ đọc) in kế hoạch; (ii) nếu dry-run ổn và `BACKUP_FILE` không rỗng: đặt `STACK_TOUCHED=1` rồi `reconcile --apply --by deploy --skip-version` (baseline 002..006 nếu probe chỉ-đọc chứng minh dữ liệu không còn việc, rồi chạy migration 007+ còn chờ; **chưa ghi `version`** vì code mới chưa chạy; ngoại lệ **DB mới tinh** (`version` chưa có, `users` rỗng): runner ghi `version` ngay ở bước này dù có `--skip-version`). Mongo chưa có container (triển khai mới) thì bỏ qua bước này. Với `--no-migrate`: chạy `status --json` như trước, còn việc chờ hoặc cần baseline thì dừng. Với `--plan-only`: chỉ chạy (i) (không `--skip-version`) rồi thoát, **không** backup, **không** up | runner trả **3** (khóa), **4** (probe không đạt, cần xử lý tay), **5** (downgrade, trừ khi `DEPLOY_ALLOW_DOWNGRADE=1`), **1** (lỗi/từ chối): dừng **trước `up`**, stack chưa đổi, in nguyên nhân và lệnh; riêng mã 1 từ `--apply` coi như dữ liệu có thể đổi một phần (in hướng dẫn "không quay code cũ") |
| 7 | `docker compose --env-file .env.docker up -d --build` | build/up lỗi |
| 8 | Chờ `realestate_mongo` healthy (mặc định 120 giây) và backend liveness `http://localhost/api/v1/health/liveness` (mặc định 120 giây) | quá hạn, hoặc container backend `exited` |
| 8b | Nếu bước 6b đọc được trạng thái: `reconcile --apply --by deploy` (không `--skip-version`) để ghi `version` (và `commit`) của app vào collection `system` (migration đã xong ở 6b nên chỉ còn ghi phiên bản). Trên DB mới tinh `version` đã được ghi ở 6b nên 8b là **no-op, mã `0`**. Downgrade có chủ ý (`DEPLOY_ALLOW_DOWNGRADE=1` và runner báo mã 5 ở 6b): **bỏ qua**, không ghi và không hạ `version` | **không làm deploy thất bại**: lỗi chỉ cảnh báo kèm lệnh ghi lại sau |

Biến tùy chọn: `MONGO_TIMEOUT`, `HEALTH_TIMEOUT` (giây), `HEALTH_URL`, `DEPLOY_MIN_FREE_GB`, `DUMP_TIMEOUT`, `OPS_EXEC_TIMEOUT`, `DEPLOY_AUTO_MIGRATE` (`1` mặc định = tự baseline + migrate; `0` = như `--no-migrate`; cờ dòng lệnh thắng biến), `DEPLOY_ALLOW_DOWNGRADE` (`1` = cho phép cố ý deploy code có version thấp hơn DB; mặc định `0`). `--migrate` và `--no-migrate` loại trừ nhau (mã thoát 2). Chưa có container `realestate_mongo` (triển khai mới): script bỏ qua backup (không có dữ liệu) và nói rõ.

**Vì sao KHÔNG rollback bằng `git checkout` (khác `deploy.sh` cũ):** khi dữ liệu Mongo đã được nâng cấp (replica set + xác thực, migration 005/006), compose và code của commit cũ **không đọc được volume mới**; quay code về commit cũ rồi build lại có thể làm hỏng thêm đúng lúc cần ổn định nhất. Vì vậy khi lỗi script chỉ **in hướng dẫn** rồi thoát mã khác 0:

1. Xem nguyên nhân: `docker compose --env-file .env.docker logs --tail 100 backend`.
2. Dữ liệu **chưa đổi** (chưa chạy migration `--apply`, chưa nâng cấp Mongo): dùng lại image dự phòng, không đụng git:
   ```bash
   docker tag <project>-backend:pre-<thời-gian> <project>-backend:latest
   docker compose --env-file .env.docker up -d --no-build --no-deps backend
   ```
3. Dữ liệu **đã đổi**: không quay về bản cũ. Với deploy thường lệ (lâu sau lần nâng cấp standalone) **chỉ** dùng `mongorestore` từ file `backups/deploy-pre-*.archive.gz` (mục 6; luôn kèm `--nsInclude 'realestate.*'`). Mục 5.8 (khôi phục volume) chỉ dành cho sự cố **ngay sau** lần nâng cấp standalone, vì nó đưa cả DB về ngày nâng cấp và mất mọi dữ liệu phát sinh sau đó.

Việc script KHÔNG làm: chạy migration khi có `--no-migrate` hoặc `DEPLOY_AUTO_MIGRATE=0` (mục 11.1), **chạy lại migration 002..006** (runner chỉ ghi sổ chúng khi probe chỉ-đọc chứng minh không còn việc, mục 11.1; muốn thực sự chạy 005/006 vẫn dùng `scripts/run-migration.sh`), chép backup ra ngoài máy chủ, dọn image dự phòng, đổi Cloudflare, pin image (mục 12). Runner không tự backup: nó dựa vào backup mongodump ở bước 5 (vì thế phần ghi của `reconcile` luôn chạy **sau** bước backup). **Dọn dung lượng:** mỗi lần deploy để lại một thẻ `realestatemanager-backend:pre-*` (và `scripts/run-migration.sh` để lại `realestate-migrate:*` nếu không dùng `--cleanup`). Dọn định kỳ theo 5.7: liệt kê `docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^(realestatemanager-backend:pre-|realestate-migrate:)'`, giữ vài thẻ gần nhất, xóa phần còn lại bằng `docker image rm`, rồi `docker image prune -f`.

### 11.1. Phiên bản hệ thống và runner migration (PT-027)

Từ v1.0.3 hệ thống lưu **phiên bản** và **sổ migration đã chạy** trong một collection `system` (key-value) của DB `realestate`; một **runner CLI nằm trong image backend** (`node dist/migrations/cli.js`, không khởi động NestJS, dùng `MONGODB_URI` của backend) chạy các migration **mới** (`007` trở đi) đúng thứ tự, chỉ cái chưa có trong sổ. Backend **không** tự chạy migration và **không** từ chối khởi động; `UserRolesMigrationGuard` (005) và cổng `check_users_migrated` của `deploy.sh` giữ nguyên. **`deploy.sh` tự gọi runner** (baseline 002..006 khi probe chỉ-đọc đạt, rồi migration 007+, rồi ghi version); người vận hành thường không cần gõ lệnh runner, trừ khi xử lý sự cố (mã thoát ở dưới).

- **Số phiên bản trong image:** stage `builder` của `RealEstateBackendApp/Dockerfile` ghi `dist/version.json` = `{ "version": <package.json>, "commit": <GIT_COMMIT hoặc null> }` sau `npm run build`; stage `production` chép cả `dist/` nên file có trong image (image production **không có** `package.json`). Runner đọc `dist/version.json`, không có thì rơi về `package.json`. `GIT_COMMIT` là build arg do compose truyền (`${GIT_COMMIT:-unknown}`), `deploy.sh` đặt nó từ `git rev-parse --short HEAD`; build tay không đặt thì `commit` là `null`. Đổi `GIT_COMMIT` chỉ làm lại lớp nhỏ ghi file (không mất cache `npm run build`).
- **Lệnh runner** (chạy trong container backend; đặt `RUN="docker compose --env-file .env.docker run --rm --no-deps backend node dist/migrations/cli.js"`):

  | Lệnh | Tác dụng | Mã thoát |
  |---|---|---|
  | `$RUN status [--json]` | **Chỉ đọc**: version, đã áp dụng, đang chờ, khóa, lỗi gần nhất | `0` ok · `3` đang có khóa · `4` cần baseline (chỉ khi sổ chưa đủ 002..006) |
  | `$RUN up` | **Dry-run mặc định**: liệt kê migration chờ, không ghi gì | `0` ok · `1` lỗi/từ chối · `2` sai tham số · `3` khóa · `4` cần baseline · `5` downgrade (không ghi gì) |
  | `$RUN up --apply [--by deploy\|cli]` | Chạy migration chờ theo thứ tự (cần replica set; giành khóa; lỗi thì dừng, không retry, không rollback, không ghi sổ cho cái lỗi); xong thì ghi `version`. Từ PT-027 bổ sung `deploy.sh` dùng `reconcile` (dòng dưới) thay lệnh này | `0` ok · `1` lỗi/từ chối · `2` sai tham số · `3` khóa · `4` cần baseline · `5` downgrade (version code < DB: không ghi gì, không hạ `version`) |
  | `$RUN reconcile [--apply] --by deploy\|cli [--skip-version] [--json]` | **Lệnh `deploy.sh` dùng.** Dry-run mặc định (in kế hoạch). `--apply`: theo bảng trạng thái bên dưới, tự baseline 002..006 khi probe chỉ-đọc đạt, chạy migration chờ, ghi `version` (trừ khi có `--skip-version`). `--json` in đúng một dòng JSON ra stdout (`report.probes[]` có thêm khóa `reason`: chuỗi hoặc `null`, nêu lý do probe không đạt hoặc không xác minh được) | `0` ok · `1` lỗi/từ chối · `3` khóa · `4` cần xử lý tay (probe không đạt) · `5` downgrade |
  | `$RUN unlock` | Gỡ khóa còn sót (chỉ khi chắc không có runner nào đang chạy) | `0` |
  | `$RUN baseline [--apply] --version <x.y.z> [--commit <sha>]` | **Lối thoát thủ công, chạy MỘT lần**: ghi sổ 002 đến 006 là đã áp dụng + `version` (không chạy lại chúng, **không probe**: người chạy tự chịu trách nhiệm đã kiểm). `--version` phải là semver chuẩn **không có số 0 đứng đầu** (`1.0.3`, không phải `1.0.03`); pre-release/build sai định dạng cũng bị từ chối với mã `2`. Dry-run mặc định | `0` · `2` sai tham số |

  Muốn đọc nhanh bằng mắt không cần `--json`: `$RUN status`.
- **Việc `deploy.sh` làm ở bước 6a, 6b, 8b:** xem bảng bước ở trên. Nó **gọi** runner (lệnh `reconcile`), không chứa logic migration. Hợp đồng gọi: `docker compose --env-file .env.docker run --rm --no-deps backend node dist/migrations/cli.js reconcile [--apply] --by deploy [--skip-version] [--json]`; dry-run là mặc định; `--json` in đúng một dòng JSON ra stdout.
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

  Phân công giữa hai bước: **6b** chạy `reconcile --apply --skip-version` (version **chưa** ghi vì code mới chưa chạy, trừ DB mới tinh: ghi ngay); **8b** chạy `reconcile --apply` (lúc này chỉ còn ghi `version`, lỗi chỉ cảnh báo). Backup mongodump (bước 5, đã kiểm nội dung) luôn **trước** mọi ghi; `STACK_TOUCHED=1` được đặt ngay trước `--apply`; nếu `BACKUP_FILE` rỗng thì **không** chạy `--apply`. Trước `--apply`, `deploy.sh` chạy thêm một lần `reconcile` **dry-run** để in kế hoạch và để mã 3/4/5/1 luôn dừng khi stack **chưa đổi**. Khóa deploy `.git/realestate-deploy.lock` và khóa `migration-lock` trong `system` giữ nguyên.
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

  Đọc kết quả probe 002..006. Nếu cả 5 đạt và kế hoạch là "ghi sổ baseline, ghi version 1.0.3" thì chạy deploy thật: `bash deploy.sh --no-pull` (tự backup, tự baseline, `up`, ghi version). Không còn quy trình 5 bước tay (kiểm 005/006, backup, dry-run baseline, baseline, deploy lại). Version ghi vào `system` là version của app đang deploy (`1.0.3`); sổ `by=baseline` kèm số đếm là bằng chứng.
- **Triển khai mới (chưa có container Mongo):** bước 6b và 8b đều bị bỏ qua (không có DB để đọc/ghi), `version` chỉ được ghi ở lần deploy sau.
- **Khi `deploy.sh` dừng trước `up` (stack chưa đổi), theo mã thoát của runner:**
  - **Mã 3 (khóa):** có runner khác đang chạy, hoặc tiến trình chết để lại khóa mồ côi. Kiểm `docker ps` không còn lệnh `... node dist/migrations/cli.js` nào đang chạy rồi `$RUN unlock`, chạy lại deploy. Không tự gỡ khóa theo thời gian vì có thể phá một migration đang chạy lâu.
  - **Mã 4 (cần xử lý tay):** ít nhất một probe của 002..006 không đạt (dữ liệu còn việc, hoặc không xác minh được). Runner không ghi gì. Output nêu id và số đếm. Xử lý: chạy migration tương ứng bằng tay, có backup mới, dry-run trước: 005/006 bằng `bash scripts/run-migration.sh 005|006` (mục 5.4a); 002/003/004 cũng bằng `bash scripts/run-migration.sh 002|003|004` (script ts-node ở `RealEstateBackendApp/scripts/migrations/`, chạy trong image dựng từ stage `builder`; `--apply` vẫn bắt buộc backup mongodump mới; riêng **002 `--apply`** in cảnh báo XÓA VĨNH VIỄN bản trùng url, đòi gõ `XOA-BAN-TRUNG-URL` (hoặc `--yes`), và kiểm backup chứa cả `realestate.users` lẫn `raw_articles`/`news_articles` đang tồn tại trong DB: snapshot NDJSON của script nằm trong container nên mất khi thoát, đường lui duy nhất là backup mongodump). Rồi chạy lại `bash deploy.sh --no-pull`.
  - **Mã 4 do probe 002 vượt trần** (dữ liệu bài viết rất lớn): probe 002 có **trần 1.000.000 doc mỗi collection hoặc 5 phút**; vượt thì probe báo "không xác minh được" (`reason` trong output) và runner dừng mã 4, **không phải dữ liệu hỏng**. Làm: (1) dry-run script 002 bằng tay: `bash scripts/run-migration.sh 002` (đọc kỹ: phải báo không còn urlHash MD5 và không còn url trùng); (2) nếu 0 việc, ghi baseline tay với đúng `--version`/`--commit` của bản đang deploy: `$RUN baseline --version <x.y.z> --commit <sha>` (dry-run) rồi thêm `--apply`; (3) chạy lại `bash deploy.sh --no-pull`. Hằng số trần chỉnh ở `RealEstateBackendApp/src/migrations/baseline-probes/probe-002-urlhash.ts` (`PROBE_002_MAX_DOCS_PER_COLLECTION`, `PROBE_002_MAX_DURATION_MS`), phải build lại image sau khi đổi.
  - **Mã 5 (downgrade):** version trong DB cao hơn version của code sắp deploy, thường do pull nhầm nhánh hoặc commit cũ. Runner không ghi gì. Kiểm lại nhánh/commit. Cố ý khôi phục bản cũ: `DEPLOY_ALLOW_DOWNGRADE=1 bash deploy.sh --no-pull`; khi đó `deploy.sh` **bỏ qua migrate** và **không ghi/hạ `version`** (DB giữ version cao hơn), cảnh báo rõ. Code cũ có thể không đọc được dữ liệu đã migrate: đọc lý do không rollback bằng `git checkout` ở mục 11 trước khi dùng.
  - **Mã 1 (lỗi hoặc từ chối):** kết nối Mongo lỗi, sổ không liền mạch, version DB sai định dạng, Mongo không phải replica set khi `--apply`, hoặc một migration (007+) lỗi giữa chừng. Ở bước dry-run: stack chưa đổi. Ở `--apply`: có thể một migration đã chạy dở nên dữ liệu đổi một phần; `deploy.sh` in hướng dẫn "không quay code/image cũ", sửa nguyên nhân rồi chạy lại.
- **Lệnh `baseline` thủ công: lối thoát, giữ nguyên.** Dùng khi đã tự kiểm 002..006 (ví dụ sau khi xử lý mã 4 bằng cách khác, hoặc chạy với `--no-migrate`): `$RUN baseline --version <x.y.z> --commit <sha>` (dry-run), thêm `--apply` để ghi; sau đó `$RUN status` phải thoát `0` rồi chạy `bash deploy.sh --no-pull`. `--no-migrate` giữ hành vi cũ: `status`, còn việc chờ hoặc cần baseline thì dừng trước `up` và in lệnh (cách A: bỏ `--no-migrate`; cách B: làm tay). **Phạm vi của cờ:** `--no-migrate` chỉ chặn migrate **trước `up`** (bước 6b); bước 8b sau khi backend sống vẫn chạy `reconcile --apply` nên vẫn ghi `version` khi DB sạch (không còn việc chờ). Ở chế độ này `deploy.sh` **không** phát hiện downgrade ở bước 6b; bước 8b vẫn không bao giờ hạ `version` (runner trả mã 5, chỉ cảnh báo).
- **Khóa còn sót** (runner chết giữa chừng, kể cả chết giữa lúc ghi sổ baseline): `reconcile`/`status` thoát mã `3`, `deploy.sh` dừng trước `up`; kiểm `docker ps` không có `... run ... node dist/migrations/cli.js` nào đang chạy rồi `$RUN unlock`. Chạy lại là an toàn: id đã vào sổ được bỏ qua, probe chỉ chạy cho id còn thiếu, không nhân đôi. Chết sau pha migrate (trước hoặc sau `up`) mà chưa ghi `version`: lần sau (hoặc bước 8b) chỉ còn ghi `version`.
- **Migration lỗi:** runner dừng ở cái lỗi, ghi `migration-last-error` (đã lọc chuỗi kết nối), thoát mã `1`; dữ liệu có thể đã đổi một phần. **Không quay về code/image cũ**: sửa nguyên nhân rồi chạy lại `up --apply` (mỗi migration phải chạy lại được an toàn); cần hoàn tác thì khôi phục `mongorestore` từ `backups/deploy-pre-*` (mục 6).
- **Đĩa:** runner chạy bằng image backend vừa build nên **không cần** `docker build --target builder` (~3,75 GB, ~13 phút) như `scripts/run-migration.sh`; đây là lý do 007 trở đi dùng runner.

`deploy.sh` trước đây nằm trong `.gitignore` (là script cục bộ của VPS); nay là file được quản lý trong repo, và `/backups/`, `/logs/`, `/tmp/` ở gốc repo được ignore (backup chứa dữ liệu khách hàng, không được commit).

### 11.2. Kịch bản thử `deploy.sh` trên stack thử (trước khi dùng trên VPS)

Đừng thử thẳng VPS. Dùng stack thử: một Mongo replica set tạm (như mục 5.4a đã làm ở máy dev) với project/compose riêng (đổi `MONGO_CONTAINER`, `BACKEND_CONTAINER`, `HEALTH_URL`; không đụng stack thật) và một bản sao dữ liệu giả của production 1.0.2 (users đã 005+004, 34 tỉnh, `urlHash` SHA-256, không TTL index, `system` trống). Mỗi trường hợp chạy từ trạng thái sạch (khôi phục từ dump giả trước mỗi lần), ghi lại output và `$RUN status` sau đó.

| # | Cách tạo tình huống | Lệnh | Kỳ vọng |
|---|---|---|---|
| 1 | Production giả như trên, **không** migration chờ | `bash deploy.sh --plan-only` | Thoát `0`. Không có `mongodump`, không `up`. Output nêu probe 002..006 đạt và kế hoạch baseline + ghi version. Sau đó `system` **vẫn trống** |
| 2 | Như 1 | `bash deploy.sh --no-pull` | Backup, build, `reconcile` dry-run, `reconcile --apply --skip-version` (ghi sổ 002..006 `by=baseline`), `up`, liveness, `reconcile --apply` ghi `version`. `$RUN status` thoát `0`, version = version app |
| 3 | Chạy lại ngay sau 2 | `bash deploy.sh --no-pull` | Không baseline lại, không migrate, `version` không đổi, thoát `0` (idempotent) |
| 4 | Thêm một migration 007 giả vào registry (image thử), DB đã ở version cũ hơn | `bash deploy.sh --no-pull` | Backup trước, **rồi** 007 chạy ở 6b, `up`, ghi version. `system` có `migration:007_...` |
| 5 | Như 4 nhưng 007 ném lỗi | `bash deploy.sh --no-pull` | `--apply` mã `1`: **không** ghi 007 vào sổ, **không** ghi version, in hướng dẫn "không quay code cũ" (stack đã bị coi là chạm). Chạy lại sau khi sửa: hoàn tất |
| 6 | Production giả nhưng **một** probe không đạt (user thiếu `teamId`, hoặc khu vực cũ còn, hoặc `urlHash` MD5, hoặc TTL index còn), từng probe một | `bash deploy.sh --no-pull` | Dừng **trước `up`** với mã runner `4`, in id không đạt và lệnh xử lý; `system` **không có** ghi mới; stack không đổi (kiểm `docker compose ps` và id container backend không đổi) |
| 7 | Production giả, tắt tự migrate | `bash deploy.sh --no-pull --no-migrate` | `status` mã `4`: dừng trước `up`, in cách A/B. Stack không đổi |
| 8 | DB đã ghi `version` cao hơn code (ví dụ sửa `version` thử lên `9.9.9`) | `bash deploy.sh --no-pull` | Dừng trước `up` với mã `5`, in cách cố ý; không ghi gì |
| 9 | Như 8 | `DEPLOY_ALLOW_DOWNGRADE=1 bash deploy.sh --no-pull` | Cảnh báo downgrade; **không** migrate; `up` chạy; bước 8b bị bỏ qua; `version` trong DB vẫn `9.9.9` |
| 10 | Khóa mồ côi: chèn tay `migration-lock` vào `system` | `bash deploy.sh --no-pull` | Dừng trước `up` với mã `3`, in `unlock` kèm hướng dẫn `docker ps`; sau `unlock` chạy lại: bình thường |
| 11 | Mongo không phải replica set (standalone thử) | `bash deploy.sh --no-pull` | `--apply` bị từ chối (mã `1`), dừng trước `up`; riêng dry-run và probe vẫn chạy được |
| 12 | Triển khai mới (chưa có container `realestate_mongo`) | `bash deploy.sh` | Bỏ qua backup và migration (có cảnh báo), `up` chạy; lần deploy sau mới ghi `version` |
| 13 | **DB mới tinh** (Mongo đã chạy, `system` trống, `users` rỗng) | `bash deploy.sh --no-pull` | Không baseline; ở 6b (`--skip-version`) runner **ghi `version` ngay** (kế hoạch `versionToWrite` = version app, đã áp dụng); `up`; 8b là no-op mã `0`. `$RUN status` thoát `0`, version = version app |
| 14 | Probe 002 vượt trần (hạ tạm `PROBE_002_MAX_DOCS_PER_COLLECTION` xuống vài doc trong image thử, dữ liệu giả có nhiều bài hơn) | `bash deploy.sh --no-pull` | Dừng **trước `up`** mã `4`, output nêu probe 002 "không xác minh được"; không ghi gì. Làm theo mục mã 4 ở trên (dry-run `run-migration.sh 002`, rồi `baseline` tay), chạy lại: hoàn tất |

Phần **kiểm cú pháp và luồng** của `deploy.sh` đã chạy ngoài Docker thật (2026-11-03, trong đợt triển khai PT-027): `bash -n`, `shellcheck`, và một harness tạm (không nằm trong repo) thay `docker`/`curl` bằng script giả để kiểm các mã thoát `0/1/3/4/5` của runner, cờ `--plan-only`, `--no-migrate`, `--migrate`, `DEPLOY_ALLOW_DOWNGRADE`, thứ tự backup trước ghi và `up` sau. Harness đó **không** thay cho các kịch bản trên: nó không kiểm runner thật, probe thật hay mongodump thật; 14 kịch bản trên vẫn là việc phải chạy trên stack thử (chưa chạy).

## 12. Ghim image theo digest và nâng cấp image có chủ đích (PT-009)

**Hiện trạng:** compose đã có cơ chế biến cho cả 5 image (mục 2), mặc định = tag hiện tại. **Chưa ghim image nào**, vì digest phải lấy từ bản **đang chạy thật trên VPS** và máy dev/repo không biết nó (tag `:latest`, `mongo:7`, `redis:7-alpine` đã trôi theo thời gian; digest hiện tại trên registry có thể khác bản đã pull lúc dựng stack, ghim nó là đổi phiên bản âm thầm).

| Service | Biến trong `.env.docker` | Mặc định (tag trôi) | Đã ghim |
|---|---|---|---|
| `mongo` | `MONGO_IMAGE` | `mongo:7` | chưa |
| `redis` | `REDIS_IMAGE` | `redis:7-alpine` | chưa |
| `minio`, `minio-init` | `MINIO_IMAGE` | `cgr.dev/chainguard/minio:latest` | chưa |
| `nine-router` | `NINE_ROUTER_IMAGE` | `decolua/9router:latest` | chưa |
| `cloudflared` | `CLOUDFLARED_IMAGE` | `cloudflare/cloudflared:latest` | chưa |

### 12.1. Lấy digest của bản đang chạy (chỉ đọc, Oniichan chạy trên VPS)

```bash
cd ~/RealEstateManager                                  # thư mục repo trên VPS
bash scripts/print-image-digests.sh                     # in dòng sẵn dạng  MONGO_IMAGE=mongo@sha256:...  (chỉ đọc, không pull)
# Đối chiếu bằng tay (cùng thông tin, để kiểm chứng script):
docker image ls --digests --format 'table {{.Repository}}\t{{.Tag}}\t{{.Digest}}\t{{.ID}}'
for c in realestate_mongo realestate_redis realestate_minio realestate_9router realestate_cloudflared; do
  echo "$c  image-id-đang-chạy=$(docker inspect -f '{{.Image}}' "$c")"     # so với cột ID ở bảng trên (rút gọn 12 ký tự đầu)
done
```

Vì sao lấy theo **ID image mà container đang dùng** chứ không theo cột Digest của `image ls`: cột đó là digest của **tag trong kho cục bộ**, có thể đã bị `pull` đè sang bản mới trong khi container vẫn chạy bản cũ (đúng tình huống `container-image-id` khác `local-latest-id` đã gặp ở 5.0a). Dòng nào script báo "KHÔNG có RepoDigest khớp" thì **không ghim** image đó (không đoán digest); báo lại để xử lý.

### 12.2. Ghim vào `.env.docker`

1. Sao lưu `.env.docker` (mục 9 điểm 1), rồi dán các dòng `*_IMAGE=...@sha256:...` script vừa in vào `.env.docker` (quyền 600). Có thể giữ tag cho dễ đọc: `mongo:7@sha256:<digest>` (Docker lấy theo digest, bỏ qua tag).
2. Kiểm: `docker compose --env-file .env.docker config -q && docker compose --env-file .env.docker config | grep -E '^\s+image:'` (chỉ in tên image).
3. **Áp dụng làm compose TẠO LẠI container của service có `image:` đổi** (kể cả khi digest trỏ đúng cùng nội dung, vì chuỗi `image:` khác): gián đoạn ngắn từng service. Làm lúc ít người dùng, **sau backup** (mục 6), **từng service một**, rồi kiểm mục 7:
   ```bash
   docker compose --env-file .env.docker up -d --no-build --no-deps cloudflared      # tunnel rớt vài giây
   docker compose --env-file .env.docker up -d --no-build --no-deps redis nine-router
   docker compose --env-file .env.docker up -d --no-build --no-deps minio
   docker compose --env-file .env.docker up -d --no-build --no-deps mongo           # cuối cùng: backend nối lại sau vài chục giây
   docker compose --env-file .env.docker ps -a                                       # mongo/redis/minio healthy
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/health/readiness # 200
   ```
   Không ghim thì không cần làm bước này; ghim tất cả cũng sẽ tự áp dụng ở lần `deploy.sh` kế tiếp (nó `up -d --build`). Digest trùng bản đang chạy nên **không kéo image mới** (đã có sẵn trong kho cục bộ).

### 12.3. Nâng cấp image có chủ đích (sau khi đã ghim)

Không bao giờ để `pull`/`up` tự đổi phiên bản. Mỗi lần nâng cấp một image:

1. Có lý do rõ (lỗ hổng, tính năng cần) và đã đọc ghi chú phát hành của image. **Đổi major của Mongo (7 sang 8) không làm bằng cách đổi digest**: cần quy trình riêng (featureCompatibilityVersion, thử trên bản sao dữ liệu). Chỉ nâng bản vá trong cùng nhánh.
2. Backup (mục 6; với 9Router thêm `tar` volume `nine_router_data`). Lưu lại dòng digest **đang chạy** (đường lui): `bash scripts/print-image-digests.sh > ~/image-digests.$(date +%F).txt` (không chứa bí mật).
3. Đủ đĩa: `bash scripts/check-disk.sh 5`.
4. **Giữ image cũ trước khi pull** (pull đè tag làm image cũ mồ côi, dễ bị `image prune` xóa mất đường lui): `docker tag <image-id-cũ> <repo>:rollback-$(date +%F)`.
5. Lấy bản mới: `docker pull <repo>:<tag>`; ghi digest mới: `docker image inspect --format '{{index .RepoDigests 0}}' <repo>:<tag>`.
6. Thử trước trên dev hoặc máy khác nếu thay đổi lớn.
7. Đặt biến `*_IMAGE` thành digest mới trong `.env.docker`, `config -q`, `up -d --no-build --no-deps <service>`, kiểm mục 7, và thử một thao tác thật (đăng nhập; với 9Router một thao tác AI; với MinIO tải một ảnh đính kèm).
8. **Đường lui:** đặt biến về digest cũ, `up -d --no-build --no-deps <service>` (image cũ còn nhờ thẻ `rollback-*`). Riêng Mongo: nếu dữ liệu đã được bản mới ghi theo định dạng mới thì không hạ được, phải `mongorestore` từ backup bước 2.
9. Tuyệt đối **không** `docker image prune -a` (xóa image không dùng, gồm cả thẻ đường lui) và **không** `docker volume prune`.

## 13. Việc bảo mật còn tồn (PT-016): `FRONTEND_URL`, cổng 27017/firewall, tài khoản quyền tối thiểu

Phần **trong repo** đã xong (tài liệu này, `.env.docker.example`, và compose đã hỗ trợ sẵn biến `MONGO_APP_*`/`S3_APP_*` mặc định tắt). **Đổi cấu hình thật cần VPS** nên chưa làm: các runbook dưới đây là việc của Oniichan (làm lần lượt 13.2, 13.1, rồi 13.3/13.4; không bước nào đã được chạy trên VPS).

### 13.1. `FRONTEND_URL` (CORS và Google Drive OAuth)

Backend dùng nó làm **origin CORS duy nhất** (`main.ts`: `enableCors({ origin: FRONTEND_URL, credentials: true })`) và địa chỉ chuyển hướng sau OAuth. Compose truyền `${FRONTEND_URL:-http://localhost}`.

```bash
grep '^FRONTEND_URL=' .env.docker                  # URL công khai, không bí mật. Kỳ vọng: FRONTEND_URL=https://<domain-admin> (không dấu / cuối)
docker exec realestate_backend printenv FRONTEND_URL
# Phép thử CORS preflight qua nginx (thay <domain-admin>):
curl -s -i -X OPTIONS http://localhost/api/v1/auth/login -H 'Origin: https://<domain-admin>' -H 'Access-Control-Request-Method: POST' | grep -i '^access-control-allow-origin'
# Kỳ vọng: access-control-allow-origin: https://<domain-admin> (đúng từng ký tự). Không có dòng này = FRONTEND_URL sai/thiếu.
```

Sai hoặc thiếu: sửa dòng trong `.env.docker` (scheme `https`, host đúng như trình duyệt, không `/` cuối), rồi `docker compose --env-file .env.docker up -d --no-deps backend` (không cần build lại; backend tạo lại vài giây).

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

Hiện backend dùng **root**: bị khai thác là mất toàn quyền instance. Mục tiêu: user `readWrite` chỉ trên DB `realestate`. Compose đã hỗ trợ: đặt `MONGO_APP_USERNAME`/`MONGO_APP_PASSWORD` thì `MONGODB_URI` của backend dùng user đó (vẫn `authSource=admin`); không đặt thì vẫn root. Làm sau backup (mục 6), thử trước trên stack/volume mẫu:

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
# (3) Ghi vào .env.docker (printf là builtin: mật khẩu không lên ps), không in ra, rồi xóa biến
[ -n "$(tail -c1 .env.docker)" ] && echo >> .env.docker
printf 'MONGO_APP_USERNAME=%s\nMONGO_APP_PASSWORD=%s\n' "$APP_USER" "$APP_PWD" >> .env.docker
unset APP_PWD
docker compose --env-file .env.docker config -q
# (4) Tạo lại backend (vài giây gián đoạn) và kiểm
docker compose --env-file .env.docker up -d --no-deps backend
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/health/readiness    # 200
docker logs --tail 50 realestate_backend 2>&1 | grep -ci 'authentication failed'     # 0
```

Rồi đăng nhập web và thử một thao tác ghi (tạo/sửa khách, có transaction). **Đường lui:** xóa hai dòng `MONGO_APP_*` khỏi `.env.docker`, `up -d --no-deps backend` (quay lại root). Lưu ý:

- Root vẫn dùng cho healthcheck Mongo, `mongodump` của `deploy.sh`, `scripts/run-migration.sh` (005/006) và các lệnh vận hành; chỉ **backend** chuyển sang user mới.
- Runner migration (mục 11.1) chạy bằng `MONGODB_URI` của backend nên cũng dùng user này. `readWrite` đủ để tạo collection/index/ghi dữ liệu; nếu một migration mới báo `Unauthorized` (vd cần `collMod`, tạo user), chạy migration đó **tạm bằng root** (gỡ hai dòng `MONGO_APP_*` trong lúc chạy) rồi đặt lại.
- Đổi mật khẩu user này: tạo lại bằng `updateUser`, rồi sửa `.env.docker` và `up -d --no-deps backend`.

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
[ -n "$(tail -c1 .env.docker)" ] && echo >> .env.docker
printf 'S3_APP_ACCESS_KEY_ID=%s\nS3_APP_SECRET_ACCESS_KEY=%s\n' "$APP_KEY" "$APP_SECRET" >> .env.docker
unset APP_SECRET
docker compose --env-file .env.docker config -q
docker compose --env-file .env.docker up -d --no-deps backend
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/health/readiness   # 200 (storage up)
```

Thử trên web: tải một ảnh đính kèm vào nhật ký, mở lại ảnh (URL ký bằng khóa mới, phải còn truy cập được trong 15 phút) và một lần xuất file. **Đường lui:** xóa hai dòng `S3_APP_*` khỏi `.env.docker`, `up -d --no-deps backend`. Bucket vẫn riêng tư.

### 13.5. Việc còn lại cho Oniichan (không ai làm thay được từ repo)

| Mục | Việc | Trạng thái |
|---|---|---|
| (c) cổng 27017/firewall | Chạy 13.2 (ba khối: VPS, VirtualBox/router, từ máy ngoài); báo kết quả | Chưa kiểm |
| (a) `FRONTEND_URL` | Chạy 13.1; sửa nếu sai | Chưa kiểm |
| (b) user quyền tối thiểu | Quyết có làm không; nếu làm: 13.3 (Mongo) và 13.4 (MinIO), sau backup, từng cái một | Chưa làm (compose đã sẵn sàng) |

[← Về chỉ mục Hạ tầng](README.md)
