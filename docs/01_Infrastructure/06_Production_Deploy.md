# 06 — Triển khai production (Docker Compose)

Stack production nằm ở `docker-compose.yml` (thư mục gốc repo). Tài liệu này mô tả kiến trúc, biến môi trường, cách triển khai mới, **quy trình nâng cấp từ bản Mongo standalone cũ**, sao lưu và xử lý sự cố. Stack dev (`RealEstateBackendApp/docker-compose.dev.yml`, project `realestate-dev`) là hệ thống riêng, không bị ảnh hưởng.

> Trạng thái kiểm chứng:
> - **Đã chạy thật** (máy dev, project tạm, mật khẩu giả): Mongo/Redis/MinIO/minio-init; nâng cấp tại chỗ từ standalone; mongodump/mongorestore; `mc mirror`; ký URL bằng host công khai. QA đã dựng và chạy **backend thật** trên stack này: readiness 200 (database/redis/storage up), đăng nhập, tạo khách hàng có transaction, idempotency, upload ảnh + presigned URL (Host khớp trả 200, Host sai trả 403), dữ liệu còn sau restart và `down`/`up`. Với `NODE_ENV=production` đã chạy thật lại: backend khởi động, readiness 200, đăng nhập admin OK, `Set-Cookie` refresh có `Secure`, thiếu `ADMIN_*` trên DB trống thì backend thoát với lỗi rõ ràng.
> - **Chưa kiểm chứng**: frontend nginx; cloudflared và Tunnel thật; đường lui 5.8 và khôi phục từ tar volume; hành vi trên server Linux thật (đặc biệt quyền ghi `./logs`, xem mục 4); đăng nhập qua HTTPS thật phía sau nginx + Cloudflare.

## 1. Kiến trúc stack

| Service | Container | Image | Dữ liệu (named volume) | Cổng ra host | Ghi chú |
|---|---|---|---|---|---|
| `mongo` | `realestate_mongo` | `mongo:7` | `mongo_data:/data/db` | không | Replica set `rs0` 1 node, xác thực + keyFile |
| `redis` | `realestate_redis` | `redis:7-alpine` | `redis_data:/data` | không | AOF `everysec`, `noeviction`, `requirepass` |
| `minio` | `realestate_minio` | `${MINIO_IMAGE}` (mặc định `cgr.dev/chainguard/minio:latest`) | `minio_data:/data` | không | S3 nội bộ `http://minio:9000` |
| `minio-init` | `realestate_minio_init` | như `minio` | không | không | Chạy 1 lần, tạo 2 bucket riêng tư + hạn 7 ngày cho `crm-exports` |
| `backend` | `realestate_backend` | build `RealEstateBackendApp` | bind `./logs`, `./.env` | không | Chờ mongo + redis healthy, minio-init xong |
| `frontend` | `realestate_frontend` | build `RealEstateAdminApp` (nginx) | không | `80` | Proxy `/api/` sang backend; `client_max_body_size 6m` (upload ảnh CRM tối đa 5 MB, phải >= giới hạn backend) |
| `cloudflared` | `realestate_cloudflared` | `cloudflare/cloudflared` | không | không | Tunnel token, hostname cấu hình ở dashboard Cloudflare |

```
Internet ── Cloudflare ── cloudflared ─┬─ <domain-admin> ─> frontend:80 ─> backend:3000 ─┬─> mongo:27017 (rs0, auth)
                                       │                                                 ├─> redis:6379  (password)
                                       └─ <domain-file>  ─> minio:9000 <─────────────────┘   minio:9000 (S3, nội bộ)
```

Tất cả nằm trong network `realestate_net` (subnet cố định `10.213.77.0/24`, cloudflared giữ IP tĩnh `10.213.77.250`, xem mục 2.1); **chỉ frontend publish cổng 80**. Cổng Mongo `27017` đã bị bỏ (trước đây mở ra mọi interface mà không có xác thực).

Quyết định thiết kế chính:

| Hạng mục | Quyết định | Lý do |
|---|---|---|
| Mongo replica set | `rs0`, 1 node, host `mongo:27017` | Backend dùng `withTransaction`; host là tên service nên backend nối bằng `replicaSet=rs0`, không cần `directConnection` |
| Mongo xác thực | root từ env + keyFile 400 user `mongodb`, tạo lại mỗi lần khởi động từ `MONGO_KEYFILE` | Replica set có auth bắt buộc keyFile; không để file secret trong repo/image |
| Healthcheck Mongo | tự `rs.initiate` (idempotent) rồi chỉ healthy khi PRIMARY | Không cần bước khởi tạo thủ công khi triển khai mới |
| Volume Mongo | giữ tên `mongo_data` | Dữ liệu production cũ không mất |
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
| `MINIO_IMAGE` | không | image MinIO | khuyến nghị pin digest, xem dưới |
| `S3_BUCKET_ATTACHMENTS`, `S3_BUCKET_EXPORTS` | không | tên bucket | mặc định `crm-attachments`, `crm-exports` |
| `S3_SIGNED_URL_TTL_SECONDS`, `REDIS_KEY_PREFIX` | không | backend | mặc định 900 và `rem:` |
| `CRM_ENABLED`, `CRM_ATTACHMENTS_ENABLED` | không | cờ CRM dùng chung backend (`FEATURE_CRM_*`) và build frontend (`VITE_*`) | mặc định `false`; xem mục 10. **Không** đặt `FEATURE_CRM_*` trong `.env.docker` (compose ghi đè) |
| `FRONTEND_URL` | nên có | CORS và chuyển hướng sau Google Drive OAuth | `https://<domain-admin>`; thiếu thì compose dùng `http://localhost` (OAuth sẽ về localhost) |
| `CRM_PII_ENCRYPTION_KEY` | **có khi bật CRM** | mã hóa CCCD (AES-256-GCM) | `openssl rand -base64 32`; **mất khóa = không giải mã lại được CCCD đã lưu**, sao lưu ngoài máy chủ |

Compose tự dựng (đặt qua `environment`, ghi đè `env_file`) nên **không cần** khai báo tay trong `.env.docker`: `MONGODB_URI` (`mongodb://<user>:<pwd>@mongo:27017/realestate?authSource=admin&replicaSet=rs0`), `REDIS_URL` (`redis://:<pwd>@redis:6379`), `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, 2 tên bucket. Dòng `MONGODB_URI` cũ trong `.env.docker` có thể xóa.

Lưu ý ký tự đặc biệt trong mật khẩu:

- **Redis**: backend đọc `REDIS_URL` bằng `new URL()` rồi `decodeURIComponent` cho user/password (`src/shared/redis/redis.config.ts`), nên mật khẩu có ký tự đặc biệt vẫn dùng được nếu URL-encode. Nhưng compose ghép chuỗi **không** tự encode, vì vậy dùng hex để khỏi phải nghĩ. Dạng `redis://:<pwd>@host` (username rỗng) chạy tốt với backend (ioredis, đã thử); riêng `redis-cli -u redis://:<pwd>@...` báo WRONGPASS (đặc điểm của redis-cli), hãy dùng `REDISCLI_AUTH`.
- **Mongo**: ký tự `: / ? # [ ] @ % +` trong mật khẩu làm hỏng URI; dùng hex.
- Không dùng `$` trong bất kỳ giá trị nào của `.env.docker` (compose coi là biến).

Pin MinIO theo digest (production):

```bash
docker pull cgr.dev/chainguard/minio:latest
docker image inspect --format '{{index .RepoDigests 0}}' cgr.dev/chainguard/minio:latest
# đặt kết quả vào .env.docker:  MINIO_IMAGE=cgr.dev/chainguard/minio@sha256:<digest>
```

### Hành vi khi `NODE_ENV=production` (compose đã đặt sẵn cho backend)

Đã rà toàn bộ `RealEstateBackendApp/src`: chỉ các chỗ sau đọc `NODE_ENV`.

| Hành vi | production | Ngoài production |
|---|---|---|
| Cookie refresh token (`auth.controller.ts`) | có cờ `Secure` (đã xác nhận trong `Set-Cookie`), `HttpOnly`, `SameSite=Strict` | không `Secure` |
| Seed admin lần đầu (`auth.service.ts`) | **bắt buộc** `ADMIN_EMAIL` + `ADMIN_PASSWORD` khi DB chưa có user; thiếu thì backend thoát với `ADMIN_EMAIL/ADMIN_PASSWORD must be set in production` (đã thử; container sẽ restart liên tục vì `restart: unless-stopped`). DB đã có user thì bỏ qua | dùng admin mặc định + cảnh báo |
| Giới hạn đăng nhập (`auth-throttle.config.ts`) | cố định 5 lần/phút/IP, bỏ qua `AUTH_LOGIN_THROTTLE_LIMIT` | cho nới bằng biến đó (E2E) |
| Hàng đợi BullMQ, ghi log file | giữ nguyên (chỉ `NODE_ENV=test` mới tắt) | như nhau |
| Swagger (`/api/v1/docs`), CORS, Helmet, ValidationPipe, log level | **không phụ thuộc** `NODE_ENV` (Swagger luôn bật, đã thấy 200; level theo `LOG_LEVEL`; CSP theo `HELMET_CSP_ENABLED`) | như nhau |
| Stack trace trong lỗi API | không bao giờ gửi cho client (chỉ ghi log máy chủ) | như nhau |

Hệ quả cần biết:

- Cookie `Secure` chỉ được trình duyệt giữ khi truy cập qua **HTTPS** (domain Cloudflare) hoặc `http://localhost`. Truy cập HTTP qua IP/hostname thường sẽ không giữ được cookie đăng nhập.
- Swagger vẫn mở công khai qua nginx tại `/api/v1/docs` (không gắn với `NODE_ENV`): cân nhắc chặn đường dẫn này ở Cloudflare/nginx.
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

Rủi ro: có **downtime vài phút** (dừng backend/mongo). Tính chất: có đường lui (bước 5.8), miễn là bước 5.1 và 5.2 đã làm. Không bỏ qua hai bước này.

Quy ước: chạy ở thư mục gốc repo trên máy production.

> **Chạy trên server Linux (bash) hoặc WSL. KHÔNG dùng Git Bash trên Windows** cho mục 5 và 6: MSYS tự đổi đường dẫn (`/tmp` thành `C:/...`) và mount `-v "$PWD/..."` bị hỏng, file backup có thể không xuất hiện mà tưởng đã có.
>
> **Quy tắc tự kiểm tra:** sau MỖI bước backup phải chạy `ls -l` và thấy file có kích thước **> 0 byte** mới đi tiếp. Báo `No such file` hoặc 0 byte: DỪNG, chưa được làm bước kế.

Đã kiểm chứng toàn bộ chuỗi bước trên volume mẫu (2 document còn nguyên sau nâng cấp), trừ đường lui 5.8.

**5.0 Chuẩn bị**

```bash
git pull                                                      # lấy docker-compose.yml mới (CHƯA up)
docker volume ls | grep mongo_data                            # ghi lại tên volume thật, vd realestatemanager_mongo_data
VOL=realestatemanager_mongo_data                              # đặt đúng tên vừa thấy
docker inspect realestate_mongo --format '{{.Config.Image}}'  # xác nhận đang mongo:7
# Điền .env.docker (mục 2), kiểm tra:
docker compose --env-file .env.docker config -q
```

Không đổi tên thư mục dự án và không thêm `name:` vào compose: project khác tên sẽ tạo volume mới rỗng.

**5.1 Backup logic bằng mongodump (stack cũ vẫn đang chạy)**

```bash
mkdir -p backups
docker exec realestate_mongo mongodump --archive=/tmp/pre-upgrade.archive.gz --gzip      # standalone cũ không cần mật khẩu
docker cp realestate_mongo:/tmp/pre-upgrade.archive.gz ./backups/pre-upgrade.archive.gz
ls -l backups/pre-upgrade.archive.gz                                                      # BẮT BUỘC thấy file > 0 byte, không thì DỪNG
# Chép file ra NGOÀI máy chủ (scp/rclone) trước khi đi tiếp.
```

**5.2 Dừng stack cũ và sao nguyên volume (đường lui chính)**

```bash
docker compose stop                                           # KHÔNG dùng down -v
docker run --rm -v "$VOL":/data:ro -v "$PWD/backups":/backup alpine \
  tar czf /backup/mongo_data-pre-upgrade.tar.gz -C /data .
ls -l backups/mongo_data-pre-upgrade.tar.gz       # BẮT BUỘC thấy file > 0 byte (vài trăm KB trở lên với dữ liệu thật), không thì DỪNG
```

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

docker exec -e U="$U" -e P="$P" realestate_mongo_upgrade mongosh --quiet --eval "
rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
while (!db.hello().isWritablePrimary) { sleep(500); }
db.getSiblingDB('admin').createUser({ user: process.env.U, pwd: process.env.P, roles: [{ role: 'root', db: 'admin' }] });
print(rs.status().members.map(m => m.name + ' ' + m.stateStr));
"
# Kỳ vọng: [ 'mongo:27017 PRIMARY' ]

docker exec realestate_mongo_upgrade mongosh --quiet --eval "try { db.adminCommand({ shutdown: 1 }) } catch (e) {}"
timeout 60 docker wait realestate_mongo_upgrade      # chờ mongod tắt hẳn (exit code 0)
docker rm -f realestate_mongo_upgrade
```

**5.4 Khởi động stack mới (auth + keyFile + replica set)**

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps -a        # mongo phải "healthy" (PRIMARY)
```

Container `realestate_mongo` cũ (đã `stop`) được compose tạo lại theo cấu hình mới; volume `mongo_data` giữ nguyên.

**5.5 Kiểm tra dữ liệu**

```bash
docker exec realestate_mongo sh -c 'mongosh --quiet admin -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "rs.status().members.map(m => m.name + \" \" + m.stateStr)"'
docker exec realestate_mongo sh -c 'mongosh --quiet admin -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "db.getSiblingDB(\"realestate\").getCollectionNames().map(n => n + \": \" + db.getSiblingDB(\"realestate\").getCollection(n).countDocuments())"'
docker logs --tail 50 realestate_backend            # không có lỗi kết nối Mongo/Redis/S3
```

So số document với bản trước nâng cấp. Thử đăng nhập web admin, mở một khách hàng, tạo thử một thao tác ghi.

**5.6 Đóng cổng cũ (đã xong khi dùng compose mới)**

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep 27017    # realestate_mongo chỉ hiện "27017/tcp", không có 0.0.0.0:27017
```

Nếu máy có firewall/NAT từng mở cổng 27017 ra ngoài, hãy đóng lại, và **đổi mọi mật khẩu/bí mật nếu nghi ngờ đã bị truy cập** (Mongo cũ không có xác thực).

**5.7 Dọn sau khi ổn định (sau vài ngày)**

Giữ `backups/` cho đến khi chắc chắn; không xóa volume nào.

**5.8 Đường lui (nếu bước 5.4 hoặc 5.5 thất bại)**

> Chưa kiểm chứng trên server thật. **Khối lệnh xóa volume (5.8.3) chỉ chạy khi cả hai file backup ở 5.8.2 và 5.2 đã có (`ls -l` > 0 byte).** Không chạy từng dòng rời rạc.

| Tình huống | Cách |
|---|---|
| Chưa có dữ liệu mới, muốn về đúng trạng thái trước nâng cấp | 5.8.1 + 5.8.2 + 5.8.3 |
| Có dữ liệu mới và muốn giữ | Trước 5.8.1, khi stack mới còn chạy: `mongodump` từ stack mới (mục 6); sau 5.8.3 dùng `mongorestore` phần mới |
| Chỉ hỏng vài collection | Không cần đường lui: `mongorestore --nsInclude` từ `backups/pre-upgrade.archive.gz` (mục 6) |

**5.8.1 Dừng stack mới (không `-v`)**

```bash
docker compose --env-file .env.docker down
```

**5.8.2 Sao lưu volume ở trạng thái HIỆN TẠI (sau nâng cấp) TRƯỚC khi xóa bất cứ thứ gì**

```bash
CUR="mongo_data-post-upgrade-$(date +%F-%H%M).tar.gz"
docker run --rm -v "$VOL":/data:ro -v "$PWD/backups":/backup alpine   tar czf "/backup/$CUR" -C /data .
ls -l "backups/$CUR" backups/mongo_data-pre-upgrade.tar.gz     # CẢ HAI phải thấy file > 0 byte, không thì DỪNG
```

**5.8.3 Khôi phục volume về trạng thái trước nâng cấp (chỉ khi 5.8.2 đủ điều kiện)**

```bash
if [ -n "$VOL" ] && [ -s "backups/$CUR" ] && [ -s backups/mongo_data-pre-upgrade.tar.gz ]; then
  docker volume rm "$VOL"   && docker volume create "$VOL"   && docker run --rm -v "$VOL":/data -v "$PWD/backups":/backup alpine        tar xzf /backup/mongo_data-pre-upgrade.tar.gz -C /data   && git checkout <commit-cũ> -- docker-compose.yml   && docker compose up -d
else
  echo "THIẾU VOL hoặc file backup: KHÔNG xóa volume. Dừng lại."
fi
```

Sau khi ổn định, trả compose về bản mới khi sẵn sàng nâng cấp lại: `git checkout HEAD -- docker-compose.yml`.

## 6. Backup và restore

> **Chạy trên server Linux (bash) hoặc WSL, KHÔNG dùng Git Bash trên Windows** (MSYS đổi đường dẫn, mount `-v "$PWD/..."` hỏng, file backup có thể không xuất hiện). **Sau mỗi bước backup phải `ls -l` thấy file > 0 byte mới đi tiếp.**

> **Named volume KHÔNG phải backup.** Nó nằm trên cùng ổ đĩa với máy chủ và bị xóa bởi `docker compose down -v` hoặc `docker volume rm`. Mọi bản sao lưu phải được chép ra **ngoài máy chủ** (máy khác, rclone/S3 khác, ổ ngoài).

| Dữ liệu | Mức quan trọng | Phương pháp |
|---|---|---|
| MongoDB | Cao nhất | `mongodump` hằng ngày |
| MinIO (`crm-attachments`) | Cao | `mc mirror` hằng ngày |
| MinIO (`crm-exports`) | Thấp (tự xóa sau 7 ngày, tạo lại được) | Có thể bỏ qua |
| Redis | Phụ (queue nhắc việc + idempotency, tạo lại được) | Sao chép AOF, không bắt buộc |
| `CRM_PII_ENCRYPTION_KEY`, `.env.docker` | Cao | Lưu ở secret manager, tách khỏi máy chủ |

```bash
D=backups/$(date +%F); mkdir -p "$D"

# MongoDB (đã chạy thử)
docker exec realestate_mongo sh -c 'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db realestate --archive=/tmp/mongo.archive.gz --gzip'
docker cp realestate_mongo:/tmp/mongo.archive.gz "$D"/mongo.archive.gz
docker exec realestate_mongo rm /tmp/mongo.archive.gz
ls -l "$D"/mongo.archive.gz                                  # phải > 0 byte, không thì DỪNG

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

Restore:

```bash
# MongoDB (đã chạy thử; --drop xóa collection hiện có trước khi nạp: chỉ dùng khi thực sự muốn ghi đè)
docker cp "$D"/mongo.archive.gz realestate_mongo:/tmp/restore.archive.gz
docker exec realestate_mongo sh -c 'mongorestore --archive=/tmp/restore.archive.gz --gzip --drop -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'
docker exec realestate_mongo rm /tmp/restore.archive.gz

# MinIO: mirror ngược (đã chạy thử), dùng cùng lệnh docker run ở trên, thay dòng mc mirror bằng:
#   mc mirror --overwrite /backup/crm-attachments local/crm-attachments
```

## 7. Kiểm tra sức khỏe

```bash
docker compose --env-file .env.docker ps -a
docker exec realestate_mongo sh -c 'mongosh --quiet admin -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "rs.status().members.map(m => m.name + \" \" + m.stateStr)"'   # [ 'mongo:27017 PRIMARY' ]
docker exec realestate_redis redis-cli ping                                                       # PONG
docker exec realestate_redis redis-cli config get maxmemory-policy                                # noeviction
docker exec realestate_minio sh -c 'MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@localhost:9000" mc ready local'
docker exec realestate_minio sh -c 'MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@localhost:9000" mc ilm rule ls local/crm-exports'   # 1 rule, 7 ngày
docker ps --format '{{.Names}} {{.Ports}}'                                                        # chỉ frontend có 0.0.0.0:80
docker volume ls | grep -E 'mongo_data|redis_data|minio_data'                                     # 3 volume tồn tại
```

Sau khi bật `S3_PUBLIC_ENDPOINT` và CRM: mở một ảnh đính kèm trên web, URL phải có host `<domain-file>` và chạy được trong 15 phút.

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
4. Nếu production đang có dữ liệu: thực hiện mục 5 theo thứ tự, không bỏ bước backup.
5. Pin `MINIO_IMAGE` theo digest; thiết lập cron backup + chép ra ngoài máy chủ.
6. `NODE_ENV=production` **đã được đặt** cho backend trong compose (Oniichan đã quyết định). Bắt buộc `ADMIN_EMAIL`/`ADMIN_PASSWORD` trong `.env.docker` khi DB chưa có user. Cookie refresh có cờ `Secure` nên truy cập qua HTTPS (Cloudflare) hoặc `http://localhost`; truy cập HTTP qua IP/hostname thường sẽ không giữ được cookie đăng nhập. Chi tiết và bảng hành vi ở mục 2.
7. **Chưa xử lý, chờ Oniichan quyết:** (a) Swagger luôn mở công khai tại `/api/v1/docs` (không gắn `NODE_ENV`): nên chặn đường dẫn này ở Cloudflare (WAF/Access) hoặc nginx; (b) đặt `FRONTEND_URL=https://<domain-admin>` trong `.env.docker` (compose đã đọc biến này; trước đây bị đặt cứng `http://localhost`).
8. Server Linux: `mkdir -p logs && chown 1000:1000 logs` trước `up` lần đầu (backend chạy uid 1000).
9. Cân nhắc sau này: tạo user Mongo riêng quyền `readWrite` trên DB `realestate` cho backend (hiện backend dùng root, theo thiết kế đơn giản ban đầu) và access key MinIO riêng thay vì root.

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

[← Về chỉ mục Hạ tầng](README.md)
