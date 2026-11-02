# Cập nhật, sửa đổi và bổ sung sau test production — v1.0.3 (Kế hoạch)

> **Phiên bản tài liệu:** v1.0.3

> Bản nháp kế hoạch, chưa phát hành (phiên bản đang chạy production là v1.0.2).

> **Mục đích file:** gom **mọi việc cần sửa hoặc bổ sung phát hiện sau khi chạy test trên production** vào một chỗ, theo mã mục `PT-NNN`, để giao việc cho từng agent và nghiệm thu. File này là **kế hoạch của v1.0.3**; phiên bản đang chạy production là **v1.0.2**.
> **Tài liệu liên quan:** [`README.md`](README.md) (mục lục phiên bản), [`../01_Infrastructure/06_Production_Deploy.md`](../01_Infrastructure/06_Production_Deploy.md) (triển khai, nâng cấp, backup), [`../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md) (đợt A–D thuộc v1.0.2).
> **Bảo mật:** tài liệu này chỉ ghi **tên biến**, không ghi giá trị bí mật (token, mật khẩu, khóa).

---

## 1. Mục đích

1. Có **một danh sách duy nhất** các việc cần xử lý sau khi hệ thống lên production, mỗi việc có mã, mức độ, nhóm, người phụ trách đề xuất và trạng thái.
2. Làm chỗ để **Oniichan ghi kết quả test thật trên production** (mục 6) và gắn lỗi phát hiện được vào mã `PT-NNN`.
3. Làm căn cứ cho `qa-agent` nghiệm thu v1.0.3 (mục 8).

## 2. Bối cảnh: production sau nâng cấp v1.0.2

| Hạng mục | Hiện trạng (ghi nhận 2026-11-02) |
|---|---|
| Commit đang chạy | `e6099c0` (merge PR #17, nhánh `production`) |
| MongoDB | Replica set `rs0` có xác thực |
| Migration 005 | Đã chạy: cập nhật 3 tài khoản (ADMIN 2, EDITOR 1) sang `roles[]`/`teamIds[]` |
| Migration 006 | Đã chạy: tạo 34 tỉnh/thành, xóa 0 khu vực cũ |
| Service / container | 8 service (7 container chạy, `minio-init` thoát mã 0 theo thiết kế) |
| Web | Trả 200 qua domain |
| Đăng nhập web admin | **Chưa được Oniichan thực hiện** |
| Thao tác AI qua 9Router | **Chưa được Oniichan thực hiện** |

**Hệ quả:** tại thời điểm viết, **chưa có lỗi nghiệp vụ nào được ghi nhận**. Các mục `PT-001` đến `PT-012` ở mục 5 là **phát hiện lúc nâng cấp** (hạ tầng, cấu hình, tài liệu, dọn dẹp); `PT-013` đến `PT-016` do **QA đề xuất** khi rà tài liệu. Cả 16 mục **chưa phải lỗi do Oniichan test**. Lỗi do test thật sẽ được thêm từ `PT-017` trở đi.

## 3. Quy ước ghi nhận

**Mã mục:** `PT-001`, `PT-002`, ... tăng dần, không dùng lại mã đã xóa.

**Mức độ:**

| Mức độ | Ý nghĩa |
|---|---|
| Blocker | Chặn dùng hệ thống hoặc mất/lộ dữ liệu; xử lý ngay |
| Major | Chức năng chính sai hoặc rủi ro bảo mật/vận hành đáng kể; xử lý trong v1.0.3 |
| Minor | Sai nhẹ, có cách tránh, hoặc việc dọn dẹp/tài liệu |
| Cải tiến | Không sai nhưng nên làm tốt hơn |

**Nhóm:** `BE` · `FE` · `DevOps` · `Dữ liệu` · `Tài liệu`.

**Trạng thái:** `Mới` → `Đã xác nhận` → `Đang sửa` → `Xong`; hoặc `Hoãn` (ghi lý do).

### Mẫu một mục

Khi thêm lỗi mới, chép khối này và điền đủ các dòng:

```markdown
#### PT-NNN — <tiêu đề ngắn>

| Trường | Nội dung |
|---|---|
| Mô tả | |
| Màn hình / API | |
| Bước tái hiện | 1. ... 2. ... |
| Kết quả thực tế | |
| Kết quả mong đợi | |
| Mức độ | Blocker / Major / Minor / Cải tiến |
| Ảnh hưởng | |
| Đề xuất | |
| Người phụ trách | |
| Trạng thái | Mới |
```

## 4. Bảng tổng hợp

Nguồn: `PT-001` đến `PT-012` là **phát hiện lúc nâng cấp**; `PT-013` đến `PT-016` do **QA đề xuất**. Chưa mục nào là lỗi do Oniichan test.

| Mã | Tiêu đề | Mức độ | Nhóm | Trạng thái |
|---|---|---|---|---|
| [PT-001](#pt-001--thiếu-healthcheck-cho-backend-và-route-health-chưa-ghi-vào-tài-liệu) | Thiếu healthcheck cho backend và route health chưa ghi vào tài liệu | Minor | DevOps / Tài liệu | Mới |
| [PT-002](#pt-002--healthcheck-của-mongo-còn-đặt-mật-khẩu-trên-dòng-lệnh) | Healthcheck Mongo còn đặt mật khẩu trên dòng lệnh | Minor | DevOps | Mới |
| [PT-003](#pt-003--ảnh-đính-kèm-crm-đang-tắt) | Ảnh đính kèm CRM đang tắt | Cải tiến | DevOps | Mới |
| [PT-004](#pt-004--xác-nhận-giá-trị-s3_bucket_exports) | Xác nhận giá trị `S3_BUCKET_EXPORTS` | Minor | DevOps | Mới |
| [PT-005](#pt-005--chưa-kiểm-chứng-thao-tác-ai-qua-9router) | Chưa kiểm chứng thao tác AI qua 9Router | Major | BE / DevOps | Mới |
| [PT-006](#pt-006--dung-lượng-đĩa-vps-căng) | Dung lượng đĩa VPS căng (chặn `deploy.sh` kế tiếp) | Major | DevOps | Mới |
| [PT-007](#pt-007--bổ-sung-kinh-nghiệm-thực-tế-vào-06_production_deploymd) | Bổ sung kinh nghiệm thực tế vào `06_Production_Deploy.md` | Minor | Tài liệu | Mới |
| [PT-008](#pt-008--swagger-công-khai-trên-production) | Swagger công khai trên production | Major | BE | Mới |
| [PT-009](#pt-009--ghim-phiên-bản-các-image-theo-digest) | Ghim phiên bản các image theo digest | Cải tiến | DevOps | Mới |
| [PT-010](#pt-010--dọn-dẹp-sau-vài-ngày-mục-57) | Dọn dẹp sau vài ngày (mục 5.7) | Minor | DevOps | Mới |
| [PT-011](#pt-011--rà-soát-bảo-mật-token-cloudflare-tunnel) | Rà soát bảo mật token Cloudflare tunnel | Minor | DevOps | Mới |
| [PT-012](#pt-012--khách-và-dự-án-trỏ-khu-vực-cũ-bị-bỏ-trống-khu-vực) | Khách và dự án trỏ khu vực cũ bị bỏ trống khu vực | Minor | Dữ liệu | Mới |
| [PT-013](#pt-013--sao-lưu-crm_pii_encryption_key-ra-ngoài-máy-chủ) | Sao lưu `CRM_PII_ENCRYPTION_KEY` ra ngoài máy chủ (làm ngay) | Major | DevOps | Mới |
| [PT-014](#pt-014--hiển-thị-số-phiên-bản-đang-chạy-thật) | Hiển thị số phiên bản đang chạy thật | Cải tiến | BE / DevOps | Mới |
| [PT-015](#pt-015--backup-định-kỳ-chép-ra-ngoài-vps-và-thử-khôi-phục) | Backup định kỳ, chép ra ngoài VPS và thử khôi phục | Major | DevOps | Mới |
| [PT-016](#pt-016--các-việc-bảo-mật-còn-tồn-ở-mục-9) | Các việc bảo mật còn tồn ở mục 9 | Minor | DevOps / BE | Mới |

## 5. Chi tiết các mục

Mỗi mục có nhãn nguồn: **[Phát hiện lúc nâng cấp]** (`PT-001` đến `PT-012`) hoặc **[Do QA đề xuất khi rà tài liệu]** (`PT-013` đến `PT-016`); không mục nào là lỗi do Oniichan test. "Người phụ trách" là **đề xuất**, Oniichan chốt.

#### PT-001 — Thiếu healthcheck cho backend và route health chưa ghi vào tài liệu

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Route health **đã có**: `RealEstateBackendApp/src/health.controller.ts` khai báo `@Controller('health')` với `GET liveness` và `GET readiness` (đều `@Public()`); tiền tố toàn cục `api/v1` (đặt trong `main.ts`). Nên có hai route `/api/v1/health/liveness` (chỉ cho biết tiến trình còn sống) và `/api/v1/health/readiness` (200 khi MongoDB, Redis, S3/MinIO sẵn sàng, 503 khi có thành phần lỗi). `GET /api/v1/health` trả 404 là **đúng thiết kế**, không phải lỗi. Còn thiếu thật hai điểm: (1) service `backend` trong `docker-compose.yml` chưa có `healthcheck` (mongo, redis, minio có); (2) `06_Production_Deploy.md` mục 7 chưa ghi hai route này (chỉ `deploy.sh` ở mục 11 đang dùng liveness) |
| Màn hình / API | `docker-compose.yml` (service `backend`); `GET /api/v1/health/liveness`, `GET /api/v1/health/readiness`; mục 7 của `06_Production_Deploy.md` |
| Bước tái hiện | 1. Xem khối service `backend` trong `docker-compose.yml`. 2. Đọc mục 7 của tài liệu triển khai |
| Kết quả thực tế | Compose không có `healthcheck` cho `backend`; mục 7 không nhắc route health |
| Kết quả mong đợi | Compose có `healthcheck` cho `backend` (gọi liveness); mục 7 liệt kê cả hai route kèm ý nghĩa và mã trả về |
| Mức độ | Minor |
| Ảnh hưởng | `docker compose ps` chỉ biết container chạy chứ không biết ứng dụng sẵn sàng; người vận hành dễ gọi nhầm `/api/v1/health`, thấy 404 rồi tưởng backend hỏng |
| Đề xuất | Thêm `healthcheck` cho `backend` gọi liveness (kiểm công cụ có sẵn trong image trước khi chọn lệnh; cân nhắc ảnh hưởng tới `depends_on` của service khác); ghi hai route vào mục 7 |
| Người phụ trách | `devops-agent` |
| Trạng thái | Mới |

#### PT-002 — Healthcheck của Mongo còn đặt mật khẩu trên dòng lệnh

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Healthcheck của service `mongo` còn đặt `-p` (mật khẩu root) trên command line **bên trong container** |
| Màn hình / API | `docker-compose.yml`, service `mongo`, khối `healthcheck` |
| Bước tái hiện | 1. Vào container `realestate_mongo`. 2. Xem tiến trình khi healthcheck chạy (`ps`) |
| Kết quả thực tế | Mật khẩu có thể hiện ra trong danh sách tiến trình trong lúc healthcheck chạy |
| Kết quả mong đợi | Mật khẩu không nằm trên dòng lệnh; xác thực qua biến môi trường, file hoặc stdin (đúng cách các lệnh Mongo khác trong `06_Production_Deploy.md` đang làm) |
| Mức độ | Minor |
| Ảnh hưởng | Lộ mật khẩu root cho ai xem được tiến trình trong container hoặc trên host; phạm vi hẹp nhưng trái nguyên tắc của tài liệu triển khai |
| Đề xuất | Đổi healthcheck sang `mongosh` đọc mật khẩu từ biến môi trường trong script (không `-p ...`); kiểm lại `rs.initiate` idempotent vẫn đúng; thử trên volume mẫu trước |
| Người phụ trách | `devops-agent` |
| Trạng thái | Mới |

#### PT-003 — Ảnh đính kèm CRM đang tắt

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Trong container đang đặt `CRM_ENABLED=true` và `CRM_ATTACHMENTS_ENABLED=false`, nên tính năng ảnh đính kèm của CRM chưa dùng được. Đây là **quyết định có chủ đích** lúc nâng cấp |
| Màn hình / API | CRM, phần đính kèm ảnh của khách; biến `.env.docker` |
| Bước tái hiện | 1. Mở chi tiết khách. 2. Tìm chức năng đính kèm ảnh |
| Kết quả thực tế | Không có chức năng đính kèm (cờ tắt) |
| Kết quả mong đợi | Khi Oniichan quyết bật: tải ảnh lên và xem lại được qua URL ký sẵn trong 15 phút |
| Mức độ | Cải tiến |
| Ảnh hưởng | Thiếu tính năng ảnh đính kèm cho tới khi bật |
| Đề xuất | Các bước bật: (1) tạo hostname Cloudflare `minio.stnd.vn` trỏ `http://minio:9000`, **không override Host**; (2) đặt `S3_PUBLIC_ENDPOINT` tương ứng và `CRM_ATTACHMENTS_ENABLED=true` trong `.env.docker`; (3) build lại frontend với `--build` (cờ Vite được đọc lúc build); (4) kiểm theo `06_Production_Deploy.md` mục 3 và 7. Lưu ý: khóa `CRM_PII_ENCRYPTION_KEY` đã được dùng từ khi `CRM_ENABLED=true`, nên việc sao lưu khóa này **không chờ quyết định bật ảnh** và được tách thành [PT-013](#pt-013--sao-lưu-crm_pii_encryption_key-ra-ngoài-máy-chủ) |
| Người phụ trách | `devops-agent`; Oniichan quyết thời điểm bật |
| Trạng thái | Mới |

#### PT-004 — Xác nhận giá trị `S3_BUCKET_EXPORTS`

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Giá trị mặc định của `S3_BUCKET_EXPORTS` là `crm-exports`. VPS cũ từng gõ nhầm thành `crm-export` (thiếu chữ `s`) |
| Màn hình / API | `.env.docker` trên VPS; bucket MinIO dùng cho xuất file CRM |
| Bước tái hiện | 1. Đọc **tên biến** và giá trị (không phải giá trị bí mật) `S3_BUCKET_EXPORTS` trong `.env.docker`. 2. Đối chiếu với bucket có thật và rule vòng đời 7 ngày |
| Kết quả thực tế | Chưa xác nhận |
| Kết quả mong đợi | Giá trị là `crm-exports`, trùng bucket do `minio-init` tạo |
| Mức độ | Minor |
| Ảnh hưởng | Sai tên thì tính năng xuất file CRM lỗi hoặc ghi vào bucket không có rule xóa sau 7 ngày |
| Đề xuất | Kiểm và sửa nếu sai; ghi cảnh báo "đúng `crm-exports`" vào mục 2 của `06_Production_Deploy.md` |
| Người phụ trách | `devops-agent` |
| Trạng thái | Mới |

#### PT-005 — Chưa kiểm chứng thao tác AI qua 9Router

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Sau nâng cấp, thao tác AI qua 9Router chưa được kiểm chứng. `NINEROUTER_API_KEY` là biến **phía backend** (key tạo trong dashboard 9Router, lưu trong `.env` của backend); image 9Router không đọc biến này nên nó **cố ý bị bỏ khỏi service `nine-router` trong compose** (xem `06_Production_Deploy.md` mục 1). Volume `nine_router_data` còn nguyên |
| Màn hình / API | Web admin, màn Cấu hình AI, thao tác tải danh sách model; backend gọi 9Router qua tên service trong mạng compose |
| Bước tái hiện | 1. Đăng nhập web admin bằng tài khoản ADMIN. 2. Vào Cấu hình AI. 3. Bấm tải danh sách model |
| Kết quả thực tế | Chưa test |
| Kết quả mong đợi | Danh sách model hiện ra, không lỗi 401/5xx |
| Mức độ | Major |
| Ảnh hưởng | Nếu hỏng thì mọi tính năng dùng AI (tin tức, bài chuyên gia, phân tích) ngừng chạy |
| Đề xuất | Oniichan test như bước tái hiện. Nếu 401 hoặc 5xx: xem `docker logs` của `realestate_9router` và `realestate_backend`; **kiểm tra key tạo trong dashboard 9Router và giá trị `NINEROUTER_API_KEY` trong `.env` của backend** có còn khớp nhau. **Không bao giờ xóa volume `nine_router_data`.** Dashboard 9Router chỉ vào được qua SSH tunnel tới cổng 20128 (bind `127.0.0.1`), không mở ra Internet |
| Người phụ trách | Oniichan (test), `devops-agent` + `coder-backend-agent` (xử lý nếu lỗi) |
| Trạng thái | Mới |

#### PT-006 — Dung lượng đĩa VPS căng

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Đĩa VPS còn khoảng **4,0 GB (đầy 83%)**. Lúc `up --build` đáy xuống **1,9 GB**. Build stage migration `builder` mất khoảng **13 phút** trên VPS |
| Màn hình / API | VPS (`df`, `docker system df`); `deploy.sh`, `scripts/run-migration.sh` |
| Bước tái hiện | 1. `df -h` và `docker system df` trên VPS. 2. Ghi dung lượng trống trước mỗi lần build |
| Kết quả thực tế | 4,0 GB trống sau nâng cấp; đáy 1,9 GB khi build |
| Kết quả mong đợi | Trống từ 5 GB trở lên (đúng ngưỡng mặc định của script) để build kế tiếp không bị chặn và không chạm đáy nguy hiểm (nhu cầu đỉnh khoảng 4,1 GB theo `06_Production_Deploy.md` mục 5.4a và 5.4b) |
| Mức độ | Major |
| Ảnh hưởng | **Chặn lần `bash deploy.sh` kế tiếp:** `deploy.sh` (`DEPLOY_MIN_FREE_GB`, mặc định 5) và `scripts/run-migration.sh` (`MIGRATE_MIN_FREE_GB`, mặc định 5) dừng khi đĩa trống dưới 5 GB; đĩa còn khoảng 4,0 GB nên deploy sẽ bị chặn cho tới khi dọn/nới đĩa, hoặc hạ ngưỡng có chủ đích (chấp nhận rủi ro đầy đĩa giữa chừng, xem 5.4b). Đầy đĩa giữa chừng khi build hoặc khi Mongo ghi có thể làm hỏng dữ liệu hoặc làm sập stack |
| Đề xuất | Dọn thêm theo mục 5.4b ("Kẹt đĩa") và 5.7: journal vacuum, `~/.npm`, log cũ, image mồ côi; **tuyệt đối không** `docker volume prune`, `docker system prune --volumes`, `docker image prune -a`. Dọn xong mới deploy; theo dõi dung lượng trước mỗi lần build; cân nhắc nới đĩa VPS |
| Người phụ trách | `devops-agent`; Oniichan quyết nới đĩa |
| Trạng thái | Mới |

#### PT-007 — Bổ sung kinh nghiệm thực tế vào `06_Production_Deploy.md`

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Tài liệu triển khai còn thiếu một số điểm rút ra từ lần nâng cấp thật. **Đã có sẵn, không cần viết lại:** cổng đĩa 5 GB và cách hạ `MIGRATE_MIN_FREE_GB` "có ý thức" (mục 5.4a, 5.4b) |
| Màn hình / API | [`../01_Infrastructure/06_Production_Deploy.md`](../01_Infrastructure/06_Production_Deploy.md) (mục 5.4a, 5.4b, 11) |
| Bước tái hiện | Đọc các mục trên và đối chiếu với `scripts/run-migration.sh` và những gì đã xảy ra khi nâng cấp |
| Kết quả thực tế | Thiếu các điểm dưới đây |
| Kết quả mong đợi | Tài liệu có thêm: (1) cờ `--yes` của `scripts/run-migration.sh` (bỏ bước xác nhận gõ `XOA-KHU-VUC-CU` của 006 `--apply`, cần khi chạy không có terminal; **chỉ dùng khi Oniichan cho phép rõ**), hiện có trong script nhưng chưa nhắc trong tài liệu; (2) số đo **đáy đĩa 1,9 GB** lúc `up --build`; (3) thời gian build migration builder **khoảng 13 phút** trên VPS |
| Mức độ | Minor |
| Ảnh hưởng | Lần nâng cấp sau dễ vấp lại cùng chỗ (không biết có `--yes`, đánh giá sai thời gian và đáy đĩa) |
| Đề xuất | Bổ sung ba điểm trên; số liệu lấy từ lần nâng cấp 2026-11-02 |
| Người phụ trách | `devops-agent` (hoặc `pm-agent` ghi tài liệu) |
| Trạng thái | Mới |

#### PT-008 — Swagger công khai trên production

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Swagger đang truy cập công khai được ở `/api/v1/docs` trên production |
| Màn hình / API | `GET /api/v1/docs` |
| Bước tái hiện | 1. Mở `<domain>/api/v1/docs` không đăng nhập |
| Kết quả thực tế | Xem được toàn bộ tài liệu API |
| Kết quả mong đợi | Chặn trên production, hoặc chỉ cho người đã xác thực |
| Mức độ | Major |
| Ảnh hưởng | Lộ danh sách endpoint, kiểu dữ liệu, mã lỗi nghiệp vụ cho người ngoài, giúp dò tấn công |
| Đề xuất | Tắt Swagger khi `NODE_ENV=production` hoặc đặt sau xác thực/IP cho phép (chặn ở nginx hoặc Cloudflare Access); cập nhật bảng "Hành vi khi `NODE_ENV=production`" trong `06_Production_Deploy.md`; kiểm thử không làm hỏng test đếm route Swagger |
| Người phụ trách | `coder-backend-agent` (hoặc `devops-agent` nếu chặn ở nginx) |
| Trạng thái | Mới |

#### PT-009 — Ghim phiên bản các image theo digest

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Các image chưa ghim theo digest: `MINIO_IMAGE` (mặc định `cgr.dev/chainguard/minio:latest`), `decolua/9router:latest`, và (QA bổ sung) `cloudflare/cloudflared:latest`, `mongo:7`, `redis:7-alpine` |
| Màn hình / API | `docker-compose.yml`, `.env.docker` |
| Bước tái hiện | Xem tag đang dùng của từng image; so với digest thực tế đang chạy (`docker image ls --digests`) |
| Kết quả thực tế | Tag trôi, lần `pull` sau có thể kéo bản khác |
| Kết quả mong đợi | Mọi image ghim `@sha256:<digest>`, nâng cấp có kiểm soát |
| Mức độ | Cải tiến |
| Ảnh hưởng | Nâng cấp bất ngờ khi pull lại; khó tái hiện sự cố |
| Đề xuất | Lấy digest đang chạy của cả năm image, ghim vào `.env.docker` hoặc compose; ghi quy trình nâng cấp image có chủ đích vào tài liệu |
| Người phụ trách | `devops-agent` |
| Trạng thái | Mới |

#### PT-010 — Dọn dẹp sau vài ngày (mục 5.7)

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Theo mục 5.7 của `06_Production_Deploy.md`, sau vài ngày chạy ổn cần dọn các bản sao dự phòng của lần nâng cấp. **Mỗi bước cần Oniichan đồng ý** trước khi làm |
| Màn hình / API | VPS |
| Bước tái hiện | Liệt kê các mục dưới đây trên VPS |
| Kết quả thực tế | Vẫn còn nguyên |
| Kết quả mong đợi | Đã dọn xong, đĩa trống thêm, không còn bản sao chứa bí mật nằm lại |
| Mức độ | Minor |
| Ảnh hưởng | Bản sao chứa bí mật nằm lại trên VPS; tốn đĩa (liên quan PT-006) |
| Đề xuất | (1) `shred` các file bí mật tạm: `~/deploy.sh.old`, `~/docker-compose.pre-upgrade.yml`, `~/env.docker.pre-upgrade`; (2) xóa image tag `*:pre-upgrade` (chỉ khi không còn cần đường lui 5.8); (3) sao chép `backups/*.tar.gz` ra khỏi máy chủ rồi mới xóa bản trên VPS; (4) xóa `stash@{0}` cũ trong repo trên VPS (bước này **bổ sung theo tình trạng thật trên VPS**, không có trong mục 5.7). Làm từng bước, báo Oniichan trước mỗi bước; **trước khi xóa image `*:pre-upgrade` phải kiểm đường lui 5.8 còn dùng được** (xem dòng 10 ở mục 6) |
| Người phụ trách | `devops-agent` (thực hiện sau khi Oniichan đồng ý từng bước) |
| Trạng thái | Mới |

#### PT-011 — Rà soát bảo mật token Cloudflare tunnel

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | File `deploy.sh` cũ trên VPS từng chứa token Cloudflare tunnel viết cứng trong file |
| Màn hình / API | VPS: `~/deploy.sh.old`; biến token tunnel trong `.env.docker` |
| Bước tái hiện | Xác định file `deploy.sh` cũ từng được sao chép, gửi hoặc xem ở đâu ngoài VPS (chat, backup, ảnh chụp) |
| Kết quả thực tế | Chưa rà soát |
| Kết quả mong đợi | Biết token có từng ra ngoài VPS hay không; nếu có thì đã xoay (rotate) |
| Mức độ | Minor (nâng lên Major nếu xác nhận từng lộ ra ngoài VPS) |
| Ảnh hưởng | Người có token có thể dựng tunnel giả mạo vào hạ tầng của dự án |
| Đề xuất | Oniichan xác nhận phạm vi lộ. Nếu từng lộ: tạo token tunnel mới trong Cloudflare, cập nhật `.env.docker` trên VPS, khởi động lại `cloudflared`, vô hiệu token cũ. Xóa `deploy.sh.old` theo PT-010 |
| Người phụ trách | Oniichan (xác nhận), `devops-agent` (xoay token) |
| Trạng thái | Mới |

#### PT-012 — Khách và dự án trỏ khu vực cũ bị bỏ trống khu vực

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Migration 006 đặt `areaId = null` cho khách và dự án trỏ khu vực cũ. Số thực tế khi chạy trên production: **0 khách và 0 dự án** bị ảnh hưởng, xóa 0 khu vực cũ |
| Màn hình / API | Danh sách khách, chi tiết khách, nhập CSV, select khu vực (34 tỉnh/thành) |
| Bước tái hiện | 1. Nhập khách mới (tay hoặc CSV). 2. Xem trường khu vực |
| Kết quả thực tế | Chưa có dữ liệu bị ảnh hưởng; khách nhập sau này có thể không có khu vực nếu tên không khớp (nhập CSV bỏ trống khu vực không khớp nhưng **vẫn tạo khách**, chỉ cảnh báo nhẹ) |
| Kết quả mong đợi | Khách có khu vực đúng, hoặc có cách dễ dàng nhận ra và bổ sung khu vực thiếu |
| Mức độ | Minor |
| Ảnh hưởng | Khách không có khu vực sẽ lọt khỏi bộ lọc theo khu vực |
| Đề xuất | Khi nhập khách cần bổ sung khu vực; theo dõi kết quả nhập CSV (tên khu vực không khớp để trống); cân nhắc báo cáo/đánh dấu khách thiếu khu vực (đã là điểm còn mở ở mục 10 của tài liệu `09_Bo_Sung_Sua_Doi_Tinh_Nang.md`) |
| Người phụ trách | `coder-frontend-agent` / `coder-backend-agent` nếu làm báo cáo; Oniichan khi nhập liệu |
| Trạng thái | Mới |

#### PT-013 — Sao lưu `CRM_PII_ENCRYPTION_KEY` ra ngoài máy chủ

**[Do QA đề xuất khi rà tài liệu]**

| Trường | Nội dung |
|---|---|
| Mô tả | `CRM_ENABLED=true` đã chạy trên production nên khóa `CRM_PII_ENCRYPTION_KEY` **đã được dùng** để mã hóa dữ liệu cá nhân (ví dụ CCCD). Mất hoặc đổi khóa thì không giải mã lại được và **không có cách khôi phục** (`06_Production_Deploy.md` mục 9 điểm 1 và mục 10 bước 2 và 3). Chưa có xác nhận khóa đã được sao lưu ngoài máy chủ |
| Màn hình / API | `.env.docker` trên VPS (chỉ nói tên biến, không ghi giá trị) |
| Bước tái hiện | Hỏi Oniichan: khóa đã nằm ở két mật khẩu/secret manager ngoài VPS chưa, và đã đọc lại thử được chưa |
| Kết quả thực tế | Chưa xác nhận |
| Kết quả mong đợi | Khóa có bản sao ngoài máy chủ, đã đọc lại được; ghi ngày sao lưu (không ghi giá trị) vào mục này |
| Mức độ | Major (làm ngay, **không chờ** quyết định bật ảnh đính kèm ở PT-003) |
| Ảnh hưởng | Mất VPS hoặc mất file `.env.docker` thì dữ liệu cá nhân đã mã hóa mất vĩnh viễn |
| Đề xuất | Oniichan tự chép khóa từ `.env.docker` vào két mật khẩu/secret manager (không dán vào chat, log hay tài liệu), rồi xác nhận đọc lại được. Sao lưu luôn `.env.docker` theo mục 9 điểm 1 |
| Người phụ trách | Oniichan (thực hiện), `devops-agent` (hướng dẫn) |
| Trạng thái | Mới |

#### PT-014 — Hiển thị số phiên bản đang chạy thật

**[Do QA đề xuất khi rà tài liệu]**

| Trường | Nội dung |
|---|---|
| Mô tả | Swagger đang đặt cứng `.setVersion('1.0')` (`main.ts`) và backend chưa có endpoint nào trả số phiên bản; không có cách xem production đang chạy phiên bản nào. Thêm vào đó production chạy `e6099c0` với manifest cũ (backend 0.0.1, admin 0.0.0, mobile 1.0.0), commit nâng 1.0.2 chưa có (xem `README.md` mục 2) |
| Màn hình / API | Swagger (`/api/v1/docs`), `GET /api/v1/health/liveness` |
| Bước tái hiện | 1. Mở Swagger, xem số phiên bản. 2. Gọi liveness, xem có trường version không |
| Kết quả thực tế | Swagger luôn ghi `1.0`; không có trường version ở health |
| Kết quả mong đợi | Số phiên bản thật (từ `package.json`) hiện ở Swagger và ở response health, kèm commit ngắn nếu có |
| Mức độ | Cải tiến |
| Ảnh hưởng | Khó đối chiếu production với bản phát hành, khó hỗ trợ khi có sự cố |
| Đề xuất | Swagger đọc `version` từ `package.json`; thêm `version` (và commit ngắn qua biến build) vào response health; cân nhắc hiện số phiên bản ở chân trang web admin |
| Người phụ trách | `coder-backend-agent` (+ `devops-agent` cho biến build commit) |
| Trạng thái | Mới |

#### PT-015 — Backup định kỳ, chép ra ngoài VPS và thử khôi phục

**[Do QA đề xuất khi rà tài liệu]**

| Trường | Nội dung |
|---|---|
| Mô tả | Chưa có cron backup hằng ngày, chưa có bước chép ra ngoài VPS và chưa có lịch thử khôi phục (`06_Production_Deploy.md` mục 9 điểm 5 và mục 6). Thư mục `backups/` nằm cùng ổ đĩa đang đầy 83% (liên quan PT-006) |
| Màn hình / API | VPS (crontab, `backups/`); mục 6 của tài liệu triển khai |
| Bước tái hiện | 1. `crontab -l` trên VPS. 2. Liệt kê `backups/` và nơi lưu ngoài máy chủ |
| Kết quả thực tế | Chưa thiết lập (cần Oniichan xác nhận) |
| Kết quả mong đợi | Cron hằng ngày (giữ 14 bản ngày + 8 bản tuần theo mục 6), bản sao ra ngoài VPS, và thử khôi phục định kỳ vào một Mongo thử |
| Mức độ | Major |
| Ảnh hưởng | Mất VPS hoặc đầy đĩa thì mất cả dữ liệu lẫn backup; backup chưa từng thử khôi phục thì chưa chắc dùng được |
| Đề xuất | Lập cron theo mục 6, chép ra ngoài bằng `rclone` hoặc công cụ tương đương, đặt lịch thử khôi phục (ví dụ hằng tháng); ghi lịch thật vào tài liệu |
| Người phụ trách | `devops-agent`; Oniichan chọn nơi lưu ngoài máy chủ |
| Trạng thái | Mới |

#### PT-016 — Các việc bảo mật còn tồn ở mục 9

**[Do QA đề xuất khi rà tài liệu]**

| Trường | Nội dung |
|---|---|
| Mô tả | Ba việc còn tồn trong `06_Production_Deploy.md`: (a) mục 9 điểm 7(b): đặt `FRONTEND_URL=https://<domain-admin>` trong `.env.docker` (trước đây bị đặt cứng `http://localhost`); (b) mục 9 điểm 9: tạo user Mongo riêng quyền `readWrite` trên DB `realestate` thay vì dùng root, và access key MinIO riêng thay vì root; (c) mục 5.6: xác nhận cổng 27017 không mở ra ngoài (compose không publish, nhưng cần kiểm firewall/NAT của máy chủ). (Điểm 7(a) Swagger đã là PT-008) |
| Màn hình / API | `.env.docker`, cấu hình user Mongo, firewall VPS |
| Bước tái hiện | 1. Đọc giá trị `FRONTEND_URL` trong `.env.docker`. 2. Xem backend đang dùng user Mongo nào. 3. `docker ps --format '{{.Names}} {{.Ports}}' | grep 27017` và kiểm firewall/NAT |
| Kết quả thực tế | Chưa kiểm |
| Kết quả mong đợi | `FRONTEND_URL` là domain admin thật; backend dùng user Mongo quyền tối thiểu; 27017 không truy cập được từ ngoài |
| Mức độ | Minor |
| Ảnh hưởng | Backend lộ quyền root nếu bị khai thác; sai `FRONTEND_URL` có thể gây lỗi liên kết/CORS; cổng DB mở ra ngoài là rủi ro lớn nếu có |
| Đề xuất | Làm lần lượt (c), (a), (b); (b) cần đổi cấu hình kết nối cẩn thận và thử trên môi trường thử trước |
| Người phụ trách | `devops-agent` (+ `coder-backend-agent` cho (b)) |
| Trạng thái | Mới |

## 6. Kết quả test production do Oniichan ghi nhận

**Để trống: chưa ai test.** Oniichan điền cột "Kết quả" (ví dụ Đạt / Lỗi / Không áp dụng) và cột "Mã mục lỗi liên quan" (ví dụ `PT-017`) khi test. Lỗi mới phát hiện được thêm ở mục 5 từ `PT-017`.

| # | Hạng mục test (đề xuất) | Cách làm | Kết quả | Mã mục lỗi liên quan |
|---|---|---|---|---|
| 1 | Đăng nhập web admin | Đăng nhập bằng tài khoản ADMIN, kiểm tra vào được trang chính | | |
| 2 | Danh sách và chi tiết khách | Mở danh sách khách, mở chi tiết một khách | | |
| 3 | Ghi thử một thay đổi | Sửa một trường của một khách (ví dụ ghi chú), lưu, tải lại để kiểm | | |
| 4 | Thao tác AI | Cấu hình AI, tải danh sách model, chạy một thao tác AI nhỏ (liên quan PT-005) | | |
| 5 | Thao tác nhóm | Thêm và gỡ thành viên của một nhóm | | |
| 6 | Xóa và khôi phục khách "Bỏ" | Xóa một khách ở trạng thái "Bỏ", khôi phục bằng tài khoản Admin (chỉ làm nếu bản giao diện đã có chức năng này) | | |
| 7 | Bộ lọc "Người phụ trách" | Lọc theo người phụ trách ở danh sách khách, kiểm kết quả đúng phạm vi quyền | | |
| 8 | Khu vực 34 tỉnh thành | Mở select khu vực, thấy đủ 34 tỉnh/thành, chọn thử cho một khách (liên quan PT-012) | | |
| 9 | Health sau deploy | Gọi `GET /api/v1/health/liveness` và `GET /api/v1/health/readiness` (liên quan PT-001); readiness phải 200 khi MongoDB, Redis, S3/MinIO sẵn sàng | | |
| 10 | Đường lui 5.8 còn dùng được | Trước khi làm PT-010, kiểm các điều kiện của đường lui 5.8 (image `*:pre-upgrade`, backup volume, dump `pre-upgrade`) còn nguyên và dùng được. Ngày dự kiến hết thời hạn giữ đường lui: ______ (Oniichan điền) | | |

## 7. Điều cần Oniichan quyết

1. **Sao lưu `CRM_PII_ENCRYPTION_KEY` ngay** (PT-013): không chờ quyết định bật ảnh. Khóa đã được dùng từ khi CRM bật.
2. **Bật ảnh đính kèm khi nào?** (PT-003) Cần tạo hostname `minio.stnd.vn` và build lại frontend (khóa PII đã tách ở mục 1).
3. **Thẻ git `v1.0.2` đặt lên đâu?** Production chạy `e6099c0` nhưng manifest ở commit đó còn cũ (backend 0.0.1, admin 0.0.0, mobile 1.0.0); commit nâng 1.0.2 chưa có. Hai hướng: **(a)** đặt thẻ `v1.0.2` lên `e6099c0` và ghi rõ manifest lệch số; **(b)** đặt thẻ lên commit nâng 1.0.2 rồi triển khai lại (redeploy). Hiện có thẻ cục bộ `v1.0.2` trỏ `ad59c4b` (chưa push, chưa rõ ai tạo); thẻ `v1.0.1` trên remote trỏ `932db04` (2026-08-24). **Push thẻ chỉ làm khi Oniichan đồng ý.**
4. **Khi nào test đăng nhập web và thao tác AI** (PT-005, mục 6): hai việc mở khóa phần lớn rủi ro chưa kiểm chứng.
5. **Dọn dẹp ở PT-010:** đồng ý từng bước (shred file bí mật, xóa image `pre-upgrade`, chép backup ra ngoài, xóa `stash@{0}`); có nới đĩa VPS không (PT-006, đang chặn `deploy.sh` kế tiếp); và ngày hết thời hạn giữ đường lui 5.8.
6. **Token Cloudflare tunnel (PT-011):** `deploy.sh` cũ có từng bị chép ra ngoài VPS không; nếu có thì xoay token.
7. **Swagger (PT-008):** tắt hẳn trên production hay chỉ yêu cầu xác thực?
8. **Backup định kỳ (PT-015):** chọn nơi lưu ngoài máy chủ.

## 8. Definition of Done của v1.0.3

- Mọi mục `PT-NNN` ở trạng thái `Xong` hoặc `Hoãn` có lý do được Oniichan đồng ý; không còn mục `Blocker`.
- Các mục `Major` (PT-005, PT-006, PT-008, PT-013, PT-015 và mọi lỗi test thật mức Major) đã `Xong`.
- Mục 6 đã được Oniichan điền đủ các dòng áp dụng; mỗi dòng lỗi có mã `PT-NNN`.
- Mỗi mục sửa code có test đi kèm và đã qua `qa-agent` review.
- `06_Production_Deploy.md` đã cập nhật theo PT-007 và các thay đổi hạ tầng (PT-001, PT-002, PT-008, PT-009, PT-015).
- Số phiên bản đã nâng lên 1.0.3 trong `package.json` và lockfile của ba ứng dụng, và trong `app.json` (chỉ `RealEstateApp` có file này); bảng ở [`README.md`](README.md) đã cập nhật; tài liệu đổi nội dung đã cập nhật dòng "Phiên bản tài liệu".

[← Về mục lục phiên bản](README.md)
