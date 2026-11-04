# Cập nhật, sửa đổi và bổ sung sau test production — v1.0.3 (Kế hoạch)

> **Phiên bản tài liệu:** v1.0.3

> Bản nháp kế hoạch, chưa phát hành (phiên bản đang chạy production là v1.0.2). Ngày 2026-11-02: phần lớn mục đã được code và test trong repo (chưa commit, chưa deploy); trạng thái từng mục ở mục 4.

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
| Đăng nhập web admin | Oniichan báo đã xong (2026-11-02), chưa ghi chi tiết kết quả |
| Thao tác AI qua 9Router | Oniichan báo đã xong (2026-11-02), chưa ghi chi tiết kết quả (xem PT-005) |
| Ảnh đính kèm CRM | Đã bật ngày 2026-11-02 (xem PT-003); Oniichan đã thử đính kèm ảnh trên web: OK |

**Hệ quả:** ngày 2026-11-02 Oniichan đã test web trên production (mobile) và ghi nhận **10 mục giao diện/tính năng** `PT-017` đến `PT-026`; chưa có lỗi nghiệp vụ về dữ liệu nào (lần thử đính kèm ảnh đạt). Các mục `PT-001` đến `PT-012` ở mục 5 là **phát hiện lúc nâng cấp** (hạ tầng, cấu hình, tài liệu, dọn dẹp); `PT-013` đến `PT-016` do **QA đề xuất** khi rà tài liệu. `PT-017` đến `PT-026` là **10 mục do Oniichan tự test web trên production ngày 2026-11-02** (điện thoại iPhone Safari và giả lập iPhone SE 375x667), chủ yếu thuộc nhóm FE (giao diện, một mục tính năng mới; PT-022 mở rộng sang BE và tài liệu, PT-023 cần thêm BE). `PT-027` là **hạng mục bổ sung do Oniichan yêu cầu** (nền tảng lưu phiên bản hệ thống và tự chạy migration), không phải lỗi test. Lỗi test thật tiếp theo bắt đầu từ `PT-028`.

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

**Trạng thái:** `Mới` → `Đã xác nhận` → `Đang sửa` → `Xong một phần` (đã làm một phần, còn việc dở ghi rõ trong mục) → `Xong`; hoặc `Hoãn` (ghi lý do), hoặc `Bỏ` (Oniichan quyết định không làm, ghi ngày và ghi chú).

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

Nguồn: `PT-001` đến `PT-012` là **phát hiện lúc nâng cấp**; `PT-013` đến `PT-016` do **QA đề xuất**. `PT-017` đến `PT-026` do **Oniichan test production ngày 2026-11-02**; `PT-027` do **Oniichan yêu cầu bổ sung ngày 2026-11-02**; `PT-028`, `PT-029` và `PT-030` do **Oniichan yêu cầu bổ sung ngày 2026-11-03** (trạng thái `Xong một phần`: code và test xong, chưa commit, chưa deploy; còn việc thử trên mobile thật; PT-030 là PWA cài được trên iPhone và Android, còn thử máy thật và Lighthouse); `PT-031` do **Oniichan yêu cầu bổ sung ngày 2026-11-04** (đổi quy tắc mã dự án thành chữ và số viết liền, tối đa 30 ký tự, kèm FE tự điền mã từ tên; `Xong một phần`: code và test xong, chưa commit, chưa deploy). Mức độ ở các mục này là **đề xuất**, Oniichan sẽ rà lại. Tình trạng ngày 2026-11-02 (sau khi triển khai trong repo, **chưa commit, chưa deploy**): 6 mục `Xong` (PT-003, PT-004, PT-007, PT-010, PT-011, PT-013), 16 mục `Xong một phần` (PT-001, PT-002, PT-008, PT-009, PT-016, PT-017 đến PT-027; mỗi mục ghi đúng việc còn lại, chủ yếu là kiểm trên VPS hoặc iPhone Safari thật, hoặc việc của Oniichan), 0 mục `Đang sửa`, 3 mục `Bỏ` (PT-012, PT-014, PT-015, Oniichan quyết định không làm ngày 2026-11-02), 2 mục `Mới` (PT-005 và PT-006, việc của Oniichan: test AI qua 9Router; nới đĩa VPS) (tổng 27 tại thời điểm đó; từ 2026-11-03 thêm PT-028, PT-029 và PT-030, đều `Xong một phần`, nên bảng dưới có 30 mục; từ 2026-11-04 thêm PT-031 (`Xong một phần`), nên bảng dưới có **31 mục**). **Quy ước:** `Xong một phần` ở đây nghĩa là đã code và test trong repo nhưng còn việc phải kiểm trên VPS hoặc iPhone thật; `Xong` là mục chỉ là tài liệu hoặc đã kiểm đủ.

| Mã | Tiêu đề | Mức độ | Nhóm | Trạng thái |
|---|---|---|---|---|
| [PT-001](#pt-001--thiếu-healthcheck-cho-backend-và-route-health-chưa-ghi-vào-tài-liệu) | Thiếu healthcheck cho backend và route health chưa ghi vào tài liệu | Minor | DevOps / Tài liệu | Xong một phần |
| [PT-002](#pt-002--healthcheck-của-mongo-còn-đặt-mật-khẩu-trên-dòng-lệnh) | Healthcheck Mongo còn đặt mật khẩu trên dòng lệnh | Minor | DevOps | Xong một phần |
| [PT-003](#pt-003--bật-ảnh-đính-kèm-crm) | Bật ảnh đính kèm CRM | Cải tiến | DevOps | Xong |
| [PT-004](#pt-004--xác-nhận-giá-trị-s3_bucket_exports) | Xác nhận giá trị `S3_BUCKET_EXPORTS` | Minor | DevOps | Xong |
| [PT-005](#pt-005--chưa-kiểm-chứng-thao-tác-ai-qua-9router) | Chưa kiểm chứng thao tác AI qua 9Router | Major | BE / DevOps | Mới |
| [PT-006](#pt-006--dung-lượng-đĩa-vps-căng) | Dung lượng đĩa VPS căng (chặn `deploy.sh` kế tiếp) | Major | DevOps | Mới |
| [PT-007](#pt-007--bổ-sung-kinh-nghiệm-thực-tế-vào-06_production_deploymd) | Bổ sung kinh nghiệm thực tế vào `06_Production_Deploy.md` | Minor | Tài liệu | Xong |
| [PT-008](#pt-008--swagger-công-khai-trên-production) | Swagger công khai trên production | Major | BE | Xong một phần |
| [PT-009](#pt-009--ghim-phiên-bản-các-image-theo-digest) | Ghim phiên bản các image theo digest | Cải tiến | DevOps | Xong một phần |
| [PT-010](#pt-010--dọn-dẹp-sau-vài-ngày-mục-57) | Dọn dẹp sau vài ngày (mục 5.7) | Minor | DevOps | Xong |
| [PT-011](#pt-011--rà-soát-bảo-mật-token-cloudflare-tunnel) | Rà soát bảo mật token Cloudflare tunnel | Minor | DevOps | Xong |
| [PT-012](#pt-012--khách-và-dự-án-trỏ-khu-vực-cũ-bị-bỏ-trống-khu-vực) | Khách và dự án trỏ khu vực cũ bị bỏ trống khu vực | Minor | Dữ liệu | Bỏ |
| [PT-013](#pt-013--sao-lưu-crm_pii_encryption_key-ra-ngoài-máy-chủ) | Sao lưu `CRM_PII_ENCRYPTION_KEY` ra ngoài máy chủ (làm ngay) | Major | DevOps | Xong |
| [PT-014](#pt-014--hiển-thị-số-phiên-bản-đang-chạy-thật) | Hiển thị số phiên bản đang chạy thật | Cải tiến | BE / DevOps | Bỏ |
| [PT-015](#pt-015--backup-định-kỳ-chép-ra-ngoài-vps-và-thử-khôi-phục) | Backup định kỳ, chép ra ngoài VPS và thử khôi phục | Major | DevOps | Bỏ |
| [PT-016](#pt-016--các-việc-bảo-mật-còn-tồn-ở-mục-9) | Các việc bảo mật còn tồn ở mục 9 | Minor | DevOps / BE | Xong một phần |
| [PT-017](#pt-017--màn-hình-mobile-bỏ-hiển-thị-tên-khách-hàng-ở-breadcrumb) | Màn hình mobile bỏ hiển thị tên khách hàng ở breadcrumb | Minor | FE | Xong một phần |
| [PT-018](#pt-018--tab-thông-tin-bỏ-sđt-và-ẩn-các-trường-chưa-có-dữ-liệu) | Tab Thông tin: bỏ SĐT và ẩn các trường chưa có dữ liệu | Cải tiến | FE | Xong một phần |
| [PT-019](#pt-019--dự-án-quan-tâm-chuyển-sang-selectbox-có-ô-tìm-kiếm) | Dự án quan tâm chuyển sang selectbox có ô tìm kiếm | Cải tiến | FE | Xong một phần |
| [PT-020](#pt-020--nhật-ký-chỉ-hiện-form-ghi-chú-khi-bấm-nút-ghi-chú) | Nhật ký: chỉ hiện form ghi chú khi bấm nút Ghi chú | Minor | FE | Xong một phần |
| [PT-021](#pt-021--lịch-sử-thay-đổi-thu-gọn-và-tải-khi-bấm-xem) | Lịch sử thay đổi: thu gọn và tải khi bấm xem | Cải tiến | FE | Xong một phần |
| [PT-022](#pt-022--nhật-ký-chăm-sóc-thiếu-nút-sửa) | Nhật ký chăm sóc thiếu nút Sửa; bỏ quy tắc tác giả sửa trong 24 giờ | Major | BE / FE / Tài liệu | Xong một phần |
| [PT-023](#pt-023--tiến-độ-đủ-34-tiêu-chí-thì-tự-chuyển-trạng-thái-khách) | Tiến độ đủ 3/4 tiêu chí thì tự chuyển trạng thái khách | Cải tiến | FE (+ BE, cần thiết kế) | Xong một phần |
| [PT-024](#pt-024--sidebar-mobile-chưa-phủ-kín-từ-mép-trên-màn-hình) | Sidebar mobile chưa phủ kín từ mép trên màn hình | Minor | FE | Xong một phần |
| [PT-025](#pt-025--sidebar-mobile-không-tự-đóng-sau-khi-chọn-mục-chuyển-nút-x-sang-phải) | Sidebar mobile không tự đóng sau khi chọn mục; chuyển nút X sang phải | Major | FE | Xong một phần |
| [PT-026](#pt-026--form-tạo-lịch-hẹn-mobile-icon-đè-lên-chữ-ở-ô-giờ-và-dự-án) | Form tạo lịch hẹn mobile: icon đè lên chữ ở ô Giờ và Dự án | Major | FE | Xong một phần |
| [PT-027](#pt-027--lưu-phiên-bản-hệ-thống-trong-db-và-cơ-chế-tự-chạy-migration-khi-nâng-cấp) | Lưu phiên bản hệ thống trong DB và cơ chế tự chạy migration khi nâng cấp | Major (đề xuất; cải tiến nền tảng) | BE / DevOps / Dữ liệu | Xong một phần |
| [PT-028](#pt-028--chuyển-nút-ghi-chú-ở-tab-nhật-ký-xuống-thanh-đáy-mobile-và-chỉnh-lại-nút-trên-desktop) | Chuyển nút Ghi chú ở tab Nhật ký xuống thanh đáy mobile; chỉnh lại nút trên desktop | Cải tiến | FE | Xong một phần |
| [PT-029](#pt-029--màn-hình-mobile-bỏ-nút-chỉnh-sửa-ở-hàng-tiêu-đề) | Màn hình mobile bỏ nút "Chỉnh sửa" ở hàng tiêu đề | Minor | FE | Xong một phần |
| [PT-030](#pt-030--biến-web-admin-thành-pwa-cài-được-trên-iphone-và-android) | Biến web admin thành PWA cài được trên iPhone và Android (không offline dữ liệu) | Cải tiến | FE | Xong một phần |
| [PT-031](#pt-031--đổi-quy-tắc-mã-dự-án-thành-chữ-và-số-viết-liền-fe-tự-điền-mã-từ-tên) | Đổi quy tắc mã dự án thành chữ và số viết liền (tối đa 30 ký tự), FE tự điền mã từ tên | Cải tiến | BE / FE / Tài liệu | Xong một phần |

## 5. Chi tiết các mục

Mỗi mục có nhãn nguồn: **[Phát hiện lúc nâng cấp]** (`PT-001` đến `PT-012`) **[Do QA đề xuất khi rà tài liệu]** (`PT-013` đến `PT-016`) hoặc **[Oniichan test production 2026-11-02]** (`PT-017` đến `PT-026`) hoặc **[Oniichan yêu cầu bổ sung 2026-11-02]** (`PT-027`) hoặc **[Oniichan yêu cầu bổ sung 2026-11-03]** (`PT-028`, `PT-029`, `PT-030`) hoặc **[Oniichan yêu cầu bổ sung 2026-11-04]** (`PT-031`). "Người phụ trách" là **đề xuất**, Oniichan chốt.

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
| Trạng thái | Xong một phần (2026-11-02). Đã xong trong repo (chưa commit, chưa deploy): `docker-compose.yml` có `healthcheck` cho service `backend`; `06_Production_Deploy.md` mục 7 đã ghi hai route health. **Còn lại:** sau khi deploy, kiểm `docker inspect realestate_backend` ra trạng thái `healthy` |

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
| Trạng thái | Xong một phần (2026-11-02). Đã xong trong repo (chưa commit, chưa deploy): healthcheck của `mongo` không còn mật khẩu trên dòng lệnh (đã thử trên `mongo:7` thật). **Còn lại:** deploy, kiểm container `mongo` ra `healthy` và `docker top` không còn ` -p `. **Ghi chú:** `up -d` sẽ tạo lại container `mongo` một lần (do đổi cấu hình healthcheck), gián đoạn vài chục giây |

#### PT-003 — Bật ảnh đính kèm CRM

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Lúc nâng cấp, container đặt `CRM_ENABLED=true` và `CRM_ATTACHMENTS_ENABLED=false` nên chưa có ảnh đính kèm (quyết định có chủ đích). **Đã bật ngày 2026-11-02** |
| Màn hình / API | CRM, phần đính kèm ảnh của khách; biến `.env.docker`; Cloudflare tunnel |
| Bước tái hiện | 1. Mở chi tiết khách. 2. Đính kèm một ảnh. 3. Xem lại ảnh |
| Kết quả thực tế | Oniichan đã thử đính kèm ảnh trên web ngày 2026-11-02: **OK** |
| Kết quả mong đợi | Tải ảnh lên và xem lại được qua URL ký sẵn trong 15 phút |
| Mức độ | Cải tiến |
| Ảnh hưởng | Trước khi bật: thiếu tính năng ảnh đính kèm |
| Đề xuất | **Đã thực hiện (2026-11-02):** (1) thêm Public hostname `minio.stnd.vn` → `http://minio:9000` (không override Host) **vào tunnel hiện có**, không dùng tunnel mới; (2) `S3_PUBLIC_ENDPOINT=https://minio.stnd.vn` (đã đặt từ trước) và `CRM_ATTACHMENTS_ENABLED=true` trong `.env.docker`; (3) build lại frontend bằng `docker compose build frontend`, rồi `up -d frontend backend` (**không dùng `deploy.sh`** vì cổng đĩa 5 GB, xem PT-006); (4) kiểm: `https://minio.stnd.vn/minio/health/live` trả 200, `/` trả 403; hai bucket `crm-attachments` và `crm-exports` ở chế độ private. **Việc còn lại:** không còn. Tunnel trống tên `minio.stnd.vn` (trạng thái Inactive) mà Oniichan từng lỡ tạo trong Cloudflare đã được xóa (Oniichan báo đã xong 2026-11-02; Neptune chưa kiểm lại trên Cloudflare). Khóa `CRM_PII_ENCRYPTION_KEY` tách thành [PT-013](#pt-013--sao-lưu-crm_pii_encryption_key-ra-ngoài-máy-chủ) |
| Người phụ trách | `devops-agent`; Oniichan quyết thời điểm bật |
| Trạng thái | Xong |

#### PT-004 — Xác nhận giá trị `S3_BUCKET_EXPORTS`

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Giá trị mặc định của `S3_BUCKET_EXPORTS` là `crm-exports`. VPS cũ từng gõ nhầm thành `crm-export` (thiếu chữ `s`) |
| Màn hình / API | `.env.docker` trên VPS; bucket MinIO dùng cho xuất file CRM |
| Bước tái hiện | 1. Đọc **tên biến** và giá trị (không phải giá trị bí mật) `S3_BUCKET_EXPORTS` trong `.env.docker`. 2. Đối chiếu với bucket có thật và rule vòng đời 7 ngày |
| Kết quả thực tế | Đã xác nhận ngày 2026-11-02: giá trị đúng `crm-exports`, bucket có thật. Còn thiếu cảnh báo trong tài liệu (xem dòng Trạng thái) |
| Kết quả mong đợi | Giá trị là `crm-exports`, trùng bucket do `minio-init` tạo |
| Mức độ | Minor |
| Ảnh hưởng | Sai tên thì tính năng xuất file CRM lỗi hoặc ghi vào bucket không có rule xóa sau 7 ngày |
| Đề xuất | Kiểm và sửa nếu sai; ghi cảnh báo "đúng `crm-exports`" vào mục 2 của `06_Production_Deploy.md` |
| Người phụ trách | `devops-agent` |
| Trạng thái | Xong (2026-11-02). Kiểm ngày 2026-11-02: trên production `S3_BUCKET_EXPORTS` đặt đúng `crm-exports` và bucket `crm-exports` có thật trong MinIO. Đã thêm cảnh báo "đúng `crm-exports`" vào `06_Production_Deploy.md` mục 2 |

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
| Mô tả | Đĩa VPS còn khoảng **4,0 GB (đầy 83%)**. Lúc `up --build` đáy xuống **1,9 GB**. Build stage migration `builder` mất khoảng **13 phút** trên VPS. Ngày 2026-11-02, lần build riêng frontend (`docker compose build frontend`, để bật ảnh đính kèm ở PT-003) làm đĩa từ **4,0 GB còn 3,4 GB (đầy 86%)**. **Số liệu hiện tại (2026-11-02, sau khi dọn xong các bước shred, xóa image `pre-upgrade`, drop stash ở PT-010 và `docker builder prune -f`):** `/dev/sda2` 25G, dùng 19G, còn **4,4 GB (đầy 82%)** (trước đó 3,4 GB), vẫn dưới ngưỡng `DEPLOY_MIN_FREE_GB`=5 nên `deploy.sh` kế tiếp vẫn bị chặn |
| Màn hình / API | VPS (`df`, `docker system df`); `deploy.sh`, `scripts/run-migration.sh` |
| Bước tái hiện | 1. `df -h` và `docker system df` trên VPS. 2. Ghi dung lượng trống trước mỗi lần build |
| Kết quả thực tế | 4,0 GB trống sau nâng cấp; đáy 1,9 GB khi build; còn 3,4 GB (86%) sau lần build frontend ngày 2026-11-02; **còn 4,4 GB (82%) sau dọn dẹp PT-010 và `docker builder prune -f` (2026-11-02)** |
| Kết quả mong đợi | Trống từ 5 GB trở lên (đúng ngưỡng mặc định của script) để build kế tiếp không bị chặn và không chạm đáy nguy hiểm (nhu cầu đỉnh khoảng 4,1 GB theo `06_Production_Deploy.md` mục 5.4a và 5.4b) |
| Mức độ | Major |
| Ảnh hưởng | **Chặn lần `bash deploy.sh` kế tiếp:** `deploy.sh` (`DEPLOY_MIN_FREE_GB`, mặc định 5) và `scripts/run-migration.sh` (`MIGRATE_MIN_FREE_GB`, mặc định 5) dừng khi đĩa trống dưới 5 GB; đĩa còn khoảng 4,4 GB (số mới nhất, ngày 2026-11-02, sau dọn dẹp), vẫn dưới 5 GB nên deploy vẫn bị chặn; lần bật ảnh đính kèm phải né `deploy.sh` và build tay frontend vì lý do này cho tới khi dọn/nới đĩa, hoặc hạ ngưỡng có chủ đích (chấp nhận rủi ro đầy đĩa giữa chừng, xem 5.4b). Đầy đĩa giữa chừng khi build hoặc khi Mongo ghi có thể làm hỏng dữ liệu hoặc làm sập stack |
| Đề xuất | Dọn thêm theo mục 5.4b ("Kẹt đĩa") và 5.7: journal vacuum, `~/.npm`, log cũ, image mồ côi; **tuyệt đối không** `docker volume prune`, `docker system prune --volumes`, `docker image prune -a`. Dọn xong mới deploy; theo dõi dung lượng trước mỗi lần build; cân nhắc nới đĩa VPS. **Nhận định (2026-11-02):** Oniichan đang chuẩn bị nới đĩa VM VirtualBox (`nhanubuntu`, 25 -> 50 GB; tắt VM, `VBoxManage modifymedium disk <Location> --resize 51200`, rồi trong máy ảo `growpart /dev/sda 2` và `resize2fs /dev/sda2`); chưa làm xong |
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
| Trạng thái | Xong (2026-11-02). Đã bổ sung đủ ba điểm vào `06_Production_Deploy.md` (cờ `--yes`, đáy đĩa 1,9 GB, thời gian build khoảng 13 phút: mục 5.4a, 5.4b) |

#### PT-008 — Swagger công khai trên production

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Swagger đang truy cập công khai được ở `/api/v1/docs` trên production |
| Màn hình / API | `GET /api/v1/docs` |
| Bước tái hiện | 1. Mở `<domain>/api/v1/docs` không đăng nhập |
| Kết quả thực tế | Xem được toàn bộ tài liệu API |
| Kết quả mong đợi | **Đã chốt (Oniichan, 2026-11-02): tắt Swagger khi `NODE_ENV=production`**, tức không còn `/api/v1/docs` trên production. Dev/staging vẫn bật |
| Mức độ | Major |
| Ảnh hưởng | Hiện tại: lộ danh sách endpoint, kiểu dữ liệu, mã lỗi nghiệp vụ cho người ngoài, giúp dò tấn công. Sau khi sửa: **không còn trang docs công khai trên production**; tài liệu API chỉ xem được ở dev/staging |
| Đề xuất | **Quyết định:** chỉ gọi `SwaggerModule.setup` khi `NODE_ENV` khác `production` (hiện `RealEstateBackendApp/src/main.ts:77-85` luôn bật). Cập nhật bảng "Hành vi khi `NODE_ENV=production`" trong `06_Production_Deploy.md`; kiểm thử không làm hỏng test đếm route Swagger; thêm test production không có route docs, môi trường khác có. **Cần xác minh trước khi coi là xong:** `docker-compose.yml:242` đặt `NODE_ENV=production` cho service `backend`, nhưng chưa kiểm giá trị thật trong container production đang chạy (`realestate_backend`) và chưa rõ staging (nếu có) đặt `NODE_ENV` là gì, để "dev/staging vẫn bật" đúng. Không chọn phương án chặn ở nginx/Cloudflare Access |
| Người phụ trách | `coder-backend-agent` (`devops-agent` xác minh `NODE_ENV` thật trên production) |
| Trạng thái | Xong một phần (2026-11-02). Code và test xong trong repo (chưa commit, chưa deploy). **Quy tắc thực tế chặt hơn câu đã chốt ở trên:** Swagger chỉ bật khi `NODE_ENV` (sau khi trim và hạ chữ thường) thuộc allowlist `development`, `test`, `staging`, `local`; giá trị lạ, chưa đặt hoặc `production` thì **tắt** (fail-safe). Lý do: bản đầu viết kiểu "khác `production` thì bật" (fail-open, gõ nhầm `prod` hay `Production` là lộ docs) do QA phát hiện nên đã đổi. Đã cập nhật bảng "Hành vi khi `NODE_ENV=production`" trong `06_Production_Deploy.md` để nêu allowlist. **Còn lại:** deploy rồi kiểm `NODE_ENV` thật trong container production (`docker exec realestate_backend printenv NODE_ENV`) và `/api/v1/docs` trả 404 |

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
| Trạng thái | Xong một phần (2026-11-02). Đã xong trong repo (chưa commit, chưa deploy): cơ chế biến `MONGO_IMAGE`, `REDIS_IMAGE`, `NINE_ROUTER_IMAGE`, `CLOUDFLARED_IMAGE`, `MINIO_IMAGE` trong compose và script `scripts/print-image-digests.sh`. **Chưa ghim digest nào** (cả 5 image vẫn dùng tag trôi cho tới khi có digest). **Còn lại (việc của Oniichan):** chạy script trên VPS, dán các dòng `*_IMAGE=` vào `.env.docker`, rồi `up -d --no-deps` từng service |

#### PT-010 — Dọn dẹp sau vài ngày (mục 5.7)

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | Theo mục 5.7 của `06_Production_Deploy.md`, sau vài ngày chạy ổn cần dọn các bản sao dự phòng của lần nâng cấp. **Oniichan đã đồng ý làm cả 4 bước (2026-11-02: "Làm đi")**; vẫn làm tuần tự và ghi kết quả từng bước |
| Màn hình / API | VPS |
| Bước tái hiện | Liệt kê các mục dưới đây trên VPS |
| Kết quả thực tế | **Đã xong (Neptune thực hiện trên VPS theo lệnh Oniichan, 2026-11-02):** (a) `shred -u` 3 file `~/deploy.sh.old`, `~/docker-compose.pre-upgrade.yml`, `~/env.docker.pre-upgrade` (đã kiểm không còn); (b) xóa 2 tag image `realestatemanager-backend:pre-upgrade` và `realestatemanager-frontend:pre-upgrade` (`:latest` đang chạy nguyên); (c) `git stash drop stash@{0}` (stash chỉ chứa 1 dòng sửa `docker-compose.yml`; danh sách stash giờ trống); (d) backup `~/RealEstateManager/backups/*` và `~/backups/*` đã chép về `C:\Users\Udon\backups\vps-upgrade-20261102\` (SHA-256 khớp hai phía); **bản trên VPS vẫn giữ, chưa xóa**; (e) thêm `docker builder prune -f` (Oniichan yêu cầu): giải phóng 573,7 MB. Sau dọn: 7 container chạy bình thường, site trả 200. **Hệ quả:** đường lui 5.8 (dựng lại stack cũ từ image `pre-upgrade`) không còn dùng được; dữ liệu cũ còn trong backup ở máy Oniichan |
| Kết quả mong đợi | Đã dọn xong, đĩa trống thêm, không còn bản sao chứa bí mật nằm lại |
| Mức độ | Minor |
| Ảnh hưởng | Bản sao chứa bí mật nằm lại trên VPS; tốn đĩa (liên quan PT-006) |
| Đề xuất | (1) `shred` các file bí mật tạm: `~/deploy.sh.old`, `~/docker-compose.pre-upgrade.yml`, `~/env.docker.pre-upgrade`; (2) xóa image tag `*:pre-upgrade` (chỉ khi không còn cần đường lui 5.8); (3) sao chép `backups/*.tar.gz` ra khỏi máy chủ rồi mới xóa bản trên VPS (**phần chép đã xong; bản trên VPS vẫn giữ, chưa xóa**); (4) xóa `stash@{0}` cũ trong repo trên VPS (bước này **bổ sung theo tình trạng thật trên VPS**, không có trong mục 5.7). Làm từng bước và ghi kết quả vào mục này; **trước khi xóa image `*:pre-upgrade` phải kiểm đường lui 5.8 còn dùng được:** không còn áp dụng, image đã xóa ngày 2026-11-02 theo yêu cầu Oniichan (xem dòng 10 ở mục 6) |
| Người phụ trách | `devops-agent` (thực hiện sau khi Oniichan đồng ý từng bước) |
| Trạng thái | Xong |

#### PT-011 — Rà soát bảo mật token Cloudflare tunnel

**[Phát hiện lúc nâng cấp]**

| Trường | Nội dung |
|---|---|
| Mô tả | File `deploy.sh` cũ trên VPS từng chứa token Cloudflare tunnel viết cứng trong file |
| Màn hình / API | VPS: `~/deploy.sh.old`; biến token tunnel trong `.env.docker` |
| Bước tái hiện | Xác định file `deploy.sh` cũ từng được sao chép, gửi hoặc xem ở đâu ngoài VPS (chat, backup, ảnh chụp) |
| Kết quả thực tế | Đã rà soát ngày 2026-11-02: `deploy.sh.old` đã `shred` (PT-010); Oniichan xác nhận token không lộ ra ngoài VPS |
| Kết quả mong đợi | Biết token có từng ra ngoài VPS hay không; nếu có thì đã xoay (rotate) |
| Mức độ | Minor (nâng lên Major nếu xác nhận từng lộ ra ngoài VPS) |
| Ảnh hưởng | Người có token có thể dựng tunnel giả mạo vào hạ tầng của dự án |
| Đề xuất | Oniichan xác nhận phạm vi lộ. Nếu từng lộ: tạo token tunnel mới trong Cloudflare, cập nhật `.env.docker` trên VPS, khởi động lại `cloudflared`, vô hiệu token cũ. Xóa `deploy.sh.old` theo PT-010 |
| Người phụ trách | Oniichan (xác nhận), `devops-agent` (xoay token) |
| Trạng thái | Xong. Kiểm ngày 2026-11-02: `deploy.sh.old` đã `shred` (PT-010); Oniichan xác nhận token không lộ ra ngoài VPS (2026-11-02), không cần xoay token |

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
| Trạng thái | Bỏ. Oniichan quyết định bỏ (2026-11-02) |

Lưu ý: mục này giữ lại để tham chiếu, không còn là việc sẽ làm. Production hiện 0 khách và 0 dự án bị ảnh hưởng; không làm phần đánh dấu khách thiếu khu vực.

#### PT-013 — Sao lưu `CRM_PII_ENCRYPTION_KEY` ra ngoài máy chủ

**[Do QA đề xuất khi rà tài liệu]**

| Trường | Nội dung |
|---|---|
| Mô tả | `CRM_ENABLED=true` đã chạy trên production nên khóa `CRM_PII_ENCRYPTION_KEY` **đã được dùng** để mã hóa dữ liệu cá nhân (ví dụ CCCD). Mất hoặc đổi khóa thì không giải mã lại được và **không có cách khôi phục** (`06_Production_Deploy.md` mục 9 điểm 1 và mục 10 bước 2 và 3). Chưa có xác nhận khóa đã được sao lưu ngoài máy chủ |
| Màn hình / API | `.env.docker` trên VPS (chỉ nói tên biến, không ghi giá trị) |
| Bước tái hiện | Hỏi Oniichan: khóa đã nằm ở két mật khẩu/secret manager ngoài VPS chưa, và đã đọc lại thử được chưa |
| Kết quả thực tế | Ngày 2026-11-02 đã chép `.env.docker` về máy cá nhân của Oniichan (hash khớp bản trên VPS, quyền thư mục giới hạn). **Oniichan báo đã xong việc cất khóa vào password manager và xác nhận khóa đủ 44 ký tự (2026-11-02)** |
| Kết quả mong đợi | Khóa có bản sao ngoài máy chủ, đã đọc lại được; ghi ngày sao lưu (không ghi giá trị) vào mục này |
| Mức độ | Major (làm ngay, **không chờ** quyết định bật ảnh đính kèm ở PT-003) |
| Ảnh hưởng | Mất VPS hoặc mất file `.env.docker` thì dữ liệu cá nhân đã mã hóa mất vĩnh viễn |
| Đề xuất | Oniichan tự chép khóa từ `.env.docker` vào két mật khẩu/secret manager (không dán vào chat, log hay tài liệu), rồi xác nhận đọc lại được. Sao lưu luôn `.env.docker` theo mục 9 điểm 1. **Đã làm:** chép `.env.docker` về máy cá nhân (2026-11-02). **Đã xong (Oniichan báo 2026-11-02):** cất khóa vào password manager và xác nhận khóa đủ 44 ký tự. **Còn lại:** không còn. **Lưu ý:** bản trên máy cá nhân cũng chứa mọi bí mật khác của hệ thống, phải giữ kín và **không đưa vào repo** |
| Người phụ trách | Oniichan (thực hiện), `devops-agent` (hướng dẫn) |
| Trạng thái | Xong |

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
| Trạng thái | Bỏ. Oniichan quyết định bỏ (2026-11-02) |

Lưu ý: mục này giữ lại để tham chiếu, không còn là việc sẽ làm. Phần đưa số phiên bản app vào image Docker (cần cho runner của PT-027) chuyển sang phạm vi PT-027.

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
| Người phụ trách | `devops-agent`; Oniichan chọn nơi lưu ngoài máy chủ (không còn áp dụng vì mục đã bỏ) |
| Trạng thái | Bỏ. Oniichan quyết định bỏ (2026-11-02). Lưu ý rủi ro: không có cron backup/chép ra ngoài; chỉ còn backup thủ công và backup tự động trước mỗi lần deploy của `deploy.sh` |

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
| Trạng thái | Xong một phần (2026-11-02). Đã xong trong repo (chưa commit, chưa deploy): runbook mục 13 của `06_Production_Deploy.md`; compose hỗ trợ biến `MONGO_APP_*` và `S3_APP_*` (mặc định để trống thì vẫn dùng root, nên không đổi hành vi nếu Oniichan chưa làm). **Còn lại (việc của Oniichan):** chạy 13.1 và 13.2, quyết 13.3 và 13.4. Lưu ý: lệnh `mc admin` ở 13.4 **chưa được kiểm** với phiên bản `mc` có trong image |

#### PT-017 — Màn hình mobile bỏ hiển thị tên khách hàng ở breadcrumb

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Trên màn hình mobile, bỏ hiển thị tên khách hàng ở breadcrumb |
| Nhóm | FE |
| Màn hình / API | Chi tiết khách (mobile), breadcrumb. File nghi liên quan (đã grep xác nhận tồn tại, chưa kiểm nội dung): `RealEstateAdminApp/src/modules/crm/components/CrmBreadcrumb.tsx`, `.../CustomerDetail/components/CustomerHeader.tsx` |
| Bước tái hiện | 1. Mở chi tiết một khách trên điện thoại hoặc giả lập 375x667. 2. Nhìn breadcrumb. (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Breadcrumb hiển thị tên khách hàng |
| Kết quả mong đợi | Trên mobile breadcrumb không hiển thị tên khách hàng (desktop giữ nguyên nếu Oniichan không nói khác) |
| Mức độ | Minor |
| Ảnh hưởng | Tên dài chiếm chỗ trên màn hình hẹp |
| Đề xuất | Ẩn đoạn tên khách trong breadcrumb ở viewport mobile; kiểm các màn khác dùng cùng breadcrumb (sửa khách, tạo lịch hẹn) để không lệch |
| Người phụ trách | `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). Code và test (vitest) xong trong repo (chưa commit, chưa deploy). **Còn lại:** Oniichan thử trên iPhone Safari thật |

#### PT-018 — Tab Thông tin: bỏ SĐT và ẩn các trường chưa có dữ liệu

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Chi tiết khách, tab "Thông tin": (1) section "Thông tin" bỏ hiển thị SĐT; (2) các trường chưa có dữ liệu thì không hiển thị; (3) tương tự với section "Chân dung khách hàng" |
| Nhóm | FE |
| Màn hình / API | Chi tiết khách, tab "Thông tin" (theo `02_Thiet_Ke_Giao_Dien...` mobile chia tab Thông tin / Nhật ký / Tiến độ). File nghi liên quan: `.../CustomerDetail/components/CustomerInfoCard.tsx`, `.../PersonaCards.tsx` |
| Bước tái hiện | 1. Mở chi tiết khách ít dữ liệu. 2. Xem tab "Thông tin", section "Thông tin" và "Chân dung khách hàng". (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Section "Thông tin" hiện SĐT; các trường rỗng vẫn được hiển thị (cả ở "Chân dung khách hàng") |
| Kết quả mong đợi | Section "Thông tin" không hiện SĐT; trường chưa có dữ liệu không hiển thị ở cả "Thông tin" lẫn "Chân dung khách hàng" |
| Mức độ | Cải tiến |
| Ảnh hưởng | Màn hình dài, nhiều dòng trống, khó đọc trên mobile |
| Đề xuất | Ẩn trường rỗng ở chế độ xem (chế độ sửa vẫn phải hiện đủ để nhập). **Cần xác nhận với Oniichan:** quy tắc C14 trong tài liệu 01 cho thành viên nhóm xem số đầy đủ và gọi (ghi `PHONE_VIEWED`), và thiết kế mobile có nút Gọi/Zalo cố định; bỏ SĐT khỏi section "Thông tin" nhưng vẫn phải còn đường xem/gọi số |
| Người phụ trách | `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). Code và test (vitest) xong trong repo (chưa commit, chưa deploy). **Cách đã làm với SĐT:** SĐT chỉ bị bỏ khỏi section "Thông tin"; vẫn còn ở thẻ tóm tắt (số được che, nút "Hiện số" ghi `PHONE_VIEWED`) và ở nút Gọi/Zalo. **Còn lại:** Oniichan thử trên iPhone Safari thật |

#### PT-019 — Dự án quan tâm chuyển sang selectbox có ô tìm kiếm

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Mục sửa "Thông tin": ô "Dự án quan tâm" chuyển sang dạng selectbox có ô tìm kiếm tích hợp để tìm nhanh tên dự án |
| Nhóm | FE |
| Màn hình / API | Sửa thông tin khách, trường "Dự án quan tâm" (tài liệu 01 mục C1: chọn nhiều dự án từ danh sách có sẵn) |
| Bước tái hiện | 1. Mở sửa thông tin khách. 2. Tìm một dự án trong "Dự án quan tâm" khi danh sách dài. (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Khó tìm nhanh tên dự án |
| Kết quả mong đợi | Selectbox có ô tìm kiếm tích hợp, gõ để lọc theo tên dự án, vẫn chọn được nhiều dự án |
| Mức độ | Cải tiến |
| Ảnh hưởng | Chọn dự án chậm khi có nhiều dự án |
| Đề xuất | Dùng selectbox đa chọn có tìm kiếm (không dấu nếu có thể); dùng chung cho màn tạo khách và các nơi chọn dự án; kiểm bàn phím ảo trên iOS Safari không che danh sách |
| Người phụ trách | `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). Code và test (vitest) xong trong repo (chưa commit, chưa deploy); đã kiểm combobox bằng preview Chromium 375x667. **Còn lại:** Oniichan thử trên iPhone Safari thật, đặc biệt bàn phím iOS có che danh sách không. **Ô "Dự án" ở form tạo lịch hẹn (mục 7 câu 22):** Oniichan quyết đổi sang ô chọn có tìm kiếm (2026-11-02); **đã làm** bằng `SearchableSelect` (một lựa chọn, tìm không dấu, có "Không chọn"). Mất nhãn nhóm "Khách quan tâm" / "Dự án khác" nhưng dự án khách quan tâm xếp đầu khi chưa gõ; chưa có trạng thái loading/lỗi riêng (như ô cũ). Chưa thử trên iPhone Safari thật |

#### PT-020 — Nhật ký: chỉ hiện form ghi chú khi bấm nút Ghi chú

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Mục "Nhật ký": bỏ hiển thị sẵn section thêm ghi chú / chăm sóc; chỉ hiện ra khi ấn nút "Ghi chú". Hiện tại ấn "Ghi chú" cũng đang hiện giao diện không đầy đủ (**lỗi hiển thị, cần xác minh**) |
| Nhóm | FE |
| Màn hình / API | Chi tiết khách, tab "Nhật ký". File nghi liên quan: `.../CustomerDetail/components/CareLogForm.tsx`, `.../CareTimeline.tsx`; API `POST /crm/customers/:id/care-logs` |
| Bước tái hiện | 1. Mở tab "Nhật ký" của một khách. 2. Quan sát form thêm ghi chú. 3. Ấn nút "Ghi chú", quan sát giao diện hiện ra. (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Form thêm ghi chú/chăm sóc hiện sẵn; khi ấn "Ghi chú" giao diện hiện ra không đầy đủ (chưa rõ thiếu phần nào) |
| Kết quả mong đợi | Form chỉ hiện khi ấn "Ghi chú", và hiện đầy đủ (nội dung, kênh liên hệ, kết quả, ảnh, nhắc bước tiếp theo) |
| Mức độ | Minor |
| Ảnh hưởng | Chiếm chỗ trên màn hình hẹp; giao diện thiếu phần có thể khiến không ghi đủ thông tin |
| Đề xuất | Xác minh trước phần "giao diện không đầy đủ" trên iPhone Safari và 375x667 (chụp ảnh); nếu đó là lỗi khiến không ghi được nhật ký thì nâng mức độ lên Major; sau đó đổi sang hiển thị theo nút |
| Người phụ trách | `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). Code và test (vitest) xong trong repo (chưa commit, chưa deploy); đã kiểm form ghi chú bằng preview Chromium 375x667. **Nguyên nhân lỗi "giao diện không đầy đủ":** nút "Ghi chú" trước đây mở `QuickNoteModal` rút gọn; nay mở form đầy đủ ở tab Nhật ký, và có hỏi xác nhận khi bỏ bản nháp. **`QuickNoteModal` (mục 7 câu 21):** Oniichan quyết nâng lên form đầy đủ (2026-11-02); **đã làm:** `QuickNoteModal` bị xóa, thay bằng `CareLogDialog` (tái dùng `CareLogComposer`; modal trên web, BottomSheet trên app; hỏi xác nhận khi bỏ bản nháp), nên màn Việc hôm nay, danh sách khách và lịch hẹn cũng mở form đầy đủ; nhãn menu "Ghi chú nhanh" giữ nguyên. `BottomSheet` dùng `useKeyboardInset` để nâng lên trên bàn phím iOS (các sheet khác cũng hưởng). **Còn lại:** Oniichan thử trên iPhone Safari thật (bàn phím iOS, tải ảnh) |

#### PT-021 — Lịch sử thay đổi: thu gọn và tải khi bấm xem

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Thu gọn phần "Lịch sử thay đổi"; chỉ gọi API tải khi người dùng ấn vào xem (lazy load) |
| Nhóm | FE |
| Màn hình / API | Chi tiết khách, "Lịch sử thay đổi"; API `GET /crm/customers/:id/histories` (tài liệu 05). File nghi liên quan: `.../CustomerDetail/components/HistoryList.tsx` |
| Bước tái hiện | 1. Mở chi tiết khách. 2. Xem Network: có gọi API lịch sử ngay khi vào màn hay không. (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Phần lịch sử hiển thị và tải ngay cả khi người dùng chưa xem (theo mô tả của Oniichan; cần xác minh bằng Network) |
| Kết quả mong đợi | Mặc định thu gọn; chỉ gọi API khi người dùng mở |
| Mức độ | Cải tiến |
| Ảnh hưởng | Tải thừa dữ liệu, màn hình dài, chậm hơn trên mạng di động |
| Đề xuất | Thu gọn mặc định (accordion), bật `enabled` của truy vấn khi mở; giữ nguyên dữ liệu sau khi đóng lại để không tải lại |
| Người phụ trách | `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). Code và test (vitest) xong trong repo (chưa commit, chưa deploy): thu gọn mặc định, chỉ gọi API khi mở, `staleTime` của lịch sử là 5 phút. **Còn lại:** Oniichan thử trên iPhone Safari thật |

#### PT-022 — Nhật ký chăm sóc thiếu nút Sửa

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Nhật ký chăm sóc đang thiếu nút Sửa trên giao diện. **Mở rộng theo quyết định của Oniichan (2026-11-02): bỏ quy tắc "tác giả chỉ sửa được trong 24 giờ kể từ lúc tạo"**, tức tác giả sửa (và xóa) nhật ký bất cứ lúc nào, không còn cửa sổ 24 giờ. Quy tắc này là **code và tài liệu thật** (đã grep xác minh), không chỉ là lỗi giao diện, nên mục này gồm BE, FE và tài liệu. **Đây là thay đổi quy tắc nghiệp vụ** (nới quyền của tác giả), không phải sửa lỗi thuần túy |
| Nhóm | BE, FE, Tài liệu |
| Màn hình / API | Chi tiết khách, tab "Nhật ký". API: `PATCH /crm/customers/:id/care-logs/:logId` (sửa), `DELETE /crm/customers/:id/care-logs/:logId` (xóa mềm), `DELETE /crm/customers/:id/care-log-attachments/:attachmentId` (gỡ ảnh đã gắn); hiện cả ba cùng dùng cửa sổ 24 giờ. Hàm `updateCareLog` đã có trong `RealEstateAdminApp/src/modules/crm/api/httpCrmApi.ts`. Lúc viết, `grep` trong `.../CareTimeline.tsx` không thấy điều khiển "Sửa". Danh sách file BE, FE và tài liệu cần đổi ở mục "Phạm vi thay đổi PT-022" ngay dưới bảng |
| Bước tái hiện | 1. Mở tab "Nhật ký". 2. Tìm nút Sửa ở một nhật ký do chính mình vừa ghi. 3. (BE) Với một nhật ký do chính mình ghi cách đây hơn 24 giờ, gọi sửa/xóa. (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Không có nút Sửa trên giao diện. Ở BE, tác giả (Nhân viên) quá 24 giờ kể từ lúc tạo nhận 403 `CARE_LOG_EDIT_WINDOW_EXPIRED` khi sửa, xóa hoặc gỡ ảnh |
| Kết quả mong đợi | Tác giả sửa và xóa nhật ký của mình **bất cứ lúc nào** (không còn giới hạn 24 giờ), có nút Sửa trên giao diện; Quản trị và Quản lý trong phạm vi vẫn sửa/xóa mọi lúc; người **không phải tác giả** (và không phải Quản trị/Quản lý trong phạm vi) vẫn nhận 403; **không còn mã lỗi `CARE_LOG_EDIT_WINDOW_EXPIRED`** ở bất kỳ API, mã nguồn hay tài liệu hiện hành nào |
| Mức độ | Major |
| Ảnh hưởng | Ghi sai nhật ký thì không sửa được trên giao diện dù backend cho phép; quy tắc 24 giờ còn chặn tác giả sửa nhật ký cũ. Sau khi đổi: tác giả có thêm quyền (nới quyền), nhật ký có thể bị sửa/xóa lâu sau khi ghi; lịch sử/audit hiện có vẫn ghi lại các lần sửa/xóa |
| Đề xuất | (1) FE: thêm nút Sửa (mở lại form với dữ liệu cũ, gồm ảnh đính kèm), xử lý xung đột; hiển thị theo `canEdit` từ BE, không kiểm 24 giờ ở FE. (2) BE: bỏ kiểm tra 24 giờ (`isWithinEditWindow`), bỏ ném `CARE_LOG_EDIT_WINDOW_EXPIRED`, bỏ hằng `CARE_LOG_EDIT_WINDOW_MS`; tác giả luôn được sửa/xóa/gỡ ảnh. (3) Bỏ khai báo ApiResponse 403 `CARE_LOG_EDIT_WINDOW_EXPIRED` ở controller. (4) Cập nhật test BE (bỏ/viết lại ca "quá 24 giờ", thêm ca tác giả sửa nhật ký rất cũ vẫn được, người khác vẫn 403) và test FE. (5) Sửa tài liệu API và kỹ thuật (liệt kê bên dưới). **Đây là thay đổi quy tắc nghiệp vụ; API tương thích ngược:** nới quyền, không đổi hợp đồng (cùng endpoint, cùng body, cùng mã thành công; chỉ bớt một nhánh 403), client cũ vẫn chạy. Xóa hay giữ hằng `ErrorCode.CARE_LOG_EDIT_WINDOW_EXPIRED`: mục 7 câu 18 |
| Người phụ trách | `coder-backend-agent` (bỏ quy tắc, mã lỗi, test BE) + `coder-frontend-agent` (nút Sửa, bỏ xử lý mã lỗi nếu có, test FE); `qa-agent` review code và test; tài liệu API/kỹ thuật cập nhật cùng đợt |
| Trạng thái | Xong một phần (2026-11-02). BE, FE và tài liệu 04, 05, 08 đã xong trong repo (chưa commit, chưa deploy); `grep CARE_LOG_EDIT_WINDOW_EXPIRED` trong code và tài liệu hiện hành rỗng (trừ ghi chú lịch sử trong file này). Giả định ở mục 7 câu 18 đã được áp dụng: bỏ quy tắc cho cả ba thao tác (sửa, xóa, gỡ ảnh đã gắn) và xóa hẳn mã lỗi. **Còn lại:** Oniichan thử nút Sửa trên máy thật (iPhone Safari) |

##### Phạm vi thay đổi PT-022 (chỉ liệt kê, chưa sửa)

**Code BE** (`RealEstateBackendApp/src/`, đã grep xác minh 2026-11-02):

- `modules/crm/care-logs/care-log.constants.ts:36`: hằng `CARE_LOG_EDIT_WINDOW_MS`. **Giữ nguyên** hằng `ORPHAN_ATTACHMENT_TTL_MS` ngay dưới (cùng giá trị 24 giờ nhưng là hạn dọn ảnh chưa gắn, không liên quan).
- `modules/crm/care-logs/care-log.rules.ts:9,21,37-46`: import hằng, hàm `isWithinEditWindow`, và `assertCanModifyCareLog` ném `CARE_LOG_EDIT_WINDOW_EXPIRED` (kèm `canModifyCareLog` ở dòng 24-34 đang gọi kiểm hết hạn).
- Nơi gọi các hàm trên, cần rà khi đổi: `care-logs.service.ts:363` (sửa) và `:505` (xóa); `care-log-attachments.service.ts:259` (gỡ ảnh đã gắn); `care-log.mapper.ts:55` (tính `canEdit` trả cho FE).
- `modules/crm/care-logs/care-logs.controller.ts:108,126`: `@ApiResponse` 403 `CARE_LOG_EDIT_WINDOW_EXPIRED`.
- `common/exceptions/error-codes.ts:21`: `CARE_LOG_EDIT_WINDOW_EXPIRED` (xóa hay giữ: mục 7 câu 18).
- Test: `modules/crm/care-logs/care-log.rules.spec.ts:30-40` và `modules/crm/crm-m3.integration.spec.ts:1199-1250`.

**Code FE** (`RealEstateAdminApp/src/modules/crm/`): `screens/CustomerDetail/components/CareTimeline.tsx` (+ `CareTimeline.test.tsx`, `CareLogForm.tsx`), `api/httpCrmApi.ts` (`updateCareLog`), `api/access.ts` và `api/http/*` (nơi dùng `canEdit`). Lúc viết, `grep` trong `RealEstateAdminApp/src` không thấy FE xử lý mã `CARE_LOG_EDIT_WINDOW_EXPIRED`; coder-frontend-agent xác minh lại.

**Tài liệu cần đổi khi triển khai** (thư mục `docs/06_Module_Customer_Management/`; **không sửa bây giờ**):

- `05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`: dòng 159 (PATCH sửa nhật ký: bỏ "tác giả trong 24 giờ tính từ lúc TẠO" và 403 `CARE_LOG_EDIT_WINDOW_EXPIRED`, giữ "không phải tác giả: 403"); dòng 160 (DELETE nhật ký: quyền "TG (24 giờ)" thành "TG", bỏ 403 `CARE_LOG_EDIT_WINDOW_EXPIRED`); dòng 162 (DELETE ảnh đã gắn: bỏ "trong 24 giờ" và 403 `CARE_LOG_EDIT_WINDOW_EXPIRED`); dòng 352 (bảng mã lỗi: xóa hàng 403 `CARE_LOG_EDIT_WINDOW_EXPIRED`). **Không** đụng chữ "24 giờ" ở dòng 161 (ảnh chưa gắn bị dọn) và dòng 214 (`endAt` tối đa 24 giờ).
- `04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`: ma trận quyền, dòng 422 ("Sửa / xóa nhật ký": hai ô "TG (trong 24 giờ)" thành "TG") và dòng 423 ("gỡ: TG (24 giờ)" ở hai ô thành "gỡ: TG"); hai dòng này cùng dẫn chiếu quy tắc C2. Tài liệu 01 định nghĩa C2 và X4 **không** nêu giới hạn 24 giờ nên không cần sửa. **Lưu ý đếm:** grep "24 giờ" trong tài liệu 04 ra 6 dòng (339, 422, 423, 725, 802, 913) nhưng chỉ **422 và 423** (4 chỗ trong 2 dòng) là quy tắc sửa 24 giờ; 339 và 725 là job dọn ảnh `PENDING` chưa gắn, 802 là RPO sao lưu, 913 là `endAt` lịch hẹn, **giữ nguyên**.
- `02_Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md`: grep "24 giờ" chỉ ra dòng 173 ("giờ 24 giờ" là định dạng giờ, **không** liên quan quy tắc sửa nhật ký); lúc viết **chưa tìm thấy chỗ nào** nói về cửa sổ sửa 24 giờ trong file này, cần rà lại phần nhật ký khi sửa tài liệu.
- `08_Kich_Ban_Kiem_Thu_Giao_Dien_Chi_Tiet.md`: dòng 163 (`canEdit`: "tác giả trong 24 giờ, Quản trị, Quản lý trong phạm vi" thành "tác giả, Quản trị, Quản lý trong phạm vi"). `07_Ke_Hoach_Kiem_Thu_Giao_Dien_Tu_Dong.md` dòng 95 chỉ nhắc `canEdit`, không nêu 24 giờ nên có thể giữ.
- Khi phát hành: cập nhật dòng "Phiên bản tài liệu" của các file đổi nội dung và hàng tương ứng ở `README.md` mục 4.

#### PT-023 — Tiến độ đủ 3/4 tiêu chí thì tự chuyển trạng thái khách

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Bổ sung ở phần "tiến độ": khi đủ 3/4 tiêu chí thì trạng thái khách hàng tự chuyển sang "Khách n…" (câu gốc bị cụt; **Oniichan đã xác nhận trạng thái đích là "Khách net"**). Đây là **tính năng mới**, cần thiết kế (architect-agent) trước khi code **Oniichan đã chốt 6 quy tắc nghiệp vụ (2026-11-02), ghi ở dòng "Kết quả mong đợi"; 3 điểm mở ở mục 7 câu 9 đã chốt 2026-11-03** |
| Nhóm | FE (+ BE, cần thiết kế) |
| Màn hình / API | Chi tiết khách, tab "Tiến độ" (file nghi liên quan: `.../CustomerDetail/components/CriteriaBoard.tsx`); `PATCH /crm/customers/:id/criteria`; `PATCH /crm/customers/:id/status` |
| Bước tái hiện | Không áp dụng (tính năng mới) |
| Kết quả thực tế | **Đã tra tài liệu 01, 04, 05:** (1) 4 tiêu chí là **Nhu cầu, Động cơ, Tài chính, Thời gian** (`criteria.demand/motivation/finance/timing`, mỗi cái có `isDone` và `description`). (2) `progress` = số tiêu chí `isDone` x 25, nhận giá trị 0/25/50/75/100, **server tính** cùng lệnh cập nhật tiêu chí; vậy "3/4" tương ứng `progress = 75`. (3) Tình trạng khách hiện có 4 trạng thái hệ thống: **Chưa tiếp cận, Có quan tâm, Khách net, Bỏ** (code `NOT_CONTACTED`, `INTERESTED`, `NET`, `DROPPED`; Quản trị thêm được trạng thái mới và chọn nhóm danh sách). **"Khách net" đã tồn tại** (code `NET`, nhóm danh sách `NET`, màu `warning`, thứ tự 3; có trong tài liệu 04 và trong seed `RealEstateBackendApp/src/modules/crm/seed/crm-seed.data.ts`), nên không cần thêm vào danh mục trạng thái. (4) **Trước v1.0.3** tiến độ **không** tự đổi tình trạng (nay đã đổi theo PT-023); đổi tình trạng chỉ qua `PATCH /crm/customers/:id/status` (cần `version`, `reason?`), audit `STATUS_CHANGED { from, to, reason }`, giao diện có Hoàn tác trong 10 giây. (5) `linkedCriterion` của trường chân dung cũng không tự đánh dấu hoàn thành tiêu chí |
| Kết quả mong đợi | **Quy tắc đã chốt (Oniichan, 2026-11-02):** (1) khi đủ **3/4 tiêu chí bất kỳ** (không phụ thuộc tiêu chí cụ thể; `progress = 75`) thì **tự động chuyển hẳn** (không chỉ gợi ý) sang "Khách net" (code `NET`); **kể cả khi từ 4/4 bỏ một tiêu chí xuống 3/4** (Oniichan chốt 2026-11-02, mục 7 câu 19); (2) lên **4/4 thì không làm gì cả** (không đổi trạng thái thêm); (3) **hạ xuống dưới 3/4 (2/4, 1/4, 0/4) thì tự chuyển về "Có quan tâm"** (code `INTERESTED`; Oniichan gọi là "Khách đang quan tâm", tên thật trong seed là "Có quan tâm"), **kể cả khi "Khách net" do người dùng chọn tay** (chốt 2026-11-03); (4) **không áp dụng cho khách đang ở "Bỏ"** (`DROPPED`); (5) **audit ghi người tick tiêu chí là người thực hiện, không cần lý do**; (6) **không áp dụng cho khách nhập từ CSV và thao tác hàng loạt** (chỉ `PATCH /crm/customers/:id/criteria` kích hoạt; `CustomerCriteriaService` chỉ được `customers.controller.ts` gọi, nên CSV và hàng loạt không đi qua đường này). **3 điểm còn mở trước đây đã chốt (Oniichan, 2026-11-03; mục 7 câu 9):** (a) **có thông báo** cho người cùng chăm sóc khi tình trạng bị tự đổi (cả lên `NET` lẫn về `INTERESTED`), trừ người tick; (b) hạ dưới 3/4 thì về `INTERESTED` **bất kể `NET` do ai đặt** (trừ `DROPPED`); (c) đủ 3/4 thì **đè** sang `NET` bất kể tình trạng hiện tại (trừ `DROPPED`; đã ở nhóm `NET` thì không đổi, không audit, không thông báo) |
| Mức độ | Cải tiến |
| Ảnh hưởng | Đổi quy tắc nghiệp vụ: tình trạng khách và các danh sách (tab theo nhóm) có thể đổi mà người dùng không thao tác trực tiếp; ảnh hưởng thống kê, bộ lọc, thông báo và audit |
| Đề xuất | (Đề xuất ban đầu lúc lập kế hoạch; **đã triển khai** theo mục "Thiết kế PT-023" ngay dưới bảng.) `architect-agent` thiết kế trước, rồi `coder-backend-agent` và `coder-frontend-agent`. Gợi ý cho thiết kế: kích hoạt ở backend trong cùng transaction với cập nhật tiêu chí (`customer-criteria.service.ts`, `withTransaction`), tái dùng `CustomerStatusChangeService.applyChange` (nhận `session`, ghi audit `STATUS_CHANGED`, kiểm khóa lạc quan `version`); audit lấy người tick làm người thực hiện, không cần `reason`; (ban đầu đề xuất thêm một dấu hiệu cho biết trạng thái do cơ chế này đặt để phục vụ chiều ngược lại; **không còn cần** sau khi chốt (b) ngày 2026-11-03, xem mục "Thiết kế PT-023" điểm 1); thiết kế quyết giao diện báo thế nào khi trạng thái tự đổi và Hoàn tác 10 giây có áp dụng không. Các điểm còn mở ở mục 7 câu 9 |
| Người phụ trách | `architect-agent` (thiết kế), sau đó `coder-backend-agent` + `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). BE, FE và test xong trong repo (chưa commit, chưa deploy). **Đã chốt (2026-11-02):** câu 19 (4/4 bỏ một tiêu chí xuống 3/4 thì **tự lên "Khách net"**; quy tắc code đã đổi theo, xem mục "Thiết kế PT-023") và câu 20 (trạng thái tùy biến bị đè, hạ thì về `INTERESTED` hệ thống: Oniichan chấp nhận). **Đã chốt (2026-11-03):** 3 điểm mở ở mục 7 câu 9; BE đã sửa theo (a), (b), (c) (xem mục "Thiết kế PT-023", cập nhật 2026-11-03; (a) dùng loại thông báo mới `CUSTOMER_STATUS_AUTO_CHANGED`, Neptune duyệt 2026-11-03). **Còn lại:** (1) FE hiển thị loại thông báo mới (nhãn trong `lib/notifications.ts`, `crmWriteApi.ts`, trang cài đặt thông báo); (2) Oniichan thử trên iPhone Safari thật; (3) khi làm nhập CSV (M8) phải giữ quy tắc "CSV không kích hoạt tự đổi tình trạng" (xem ghi chú trong mục thiết kế bên dưới) |

##### Thiết kế PT-023 (tóm tắt, đã triển khai)

Do `architect-agent` soạn; đây là bản tóm tắt thiết kế **đã áp dụng** (file nháp thiết kế tạm đã xóa). Áp dụng đúng 6 quy tắc đã chốt ở dòng "Kết quả mong đợi". **Cập nhật 2026-11-03:** 3 điểm (a)(b)(c) ở mục 7 câu 9 đã chốt và các mục bên dưới đã sửa theo (bản thiết kế gốc dùng field `statusAutoSource` trên khách để phân biệt NET do tự động; nay bỏ).

**1. Dữ liệu: KHÔNG còn field `statusAutoSource` trên khách, không cần migration.**

- Thiết kế gốc có field tùy chọn `statusAutoSource` trên khách để biết "NET do cơ chế tiến độ tự đặt" (phục vụ điều kiện chỉ tự lùi khi NET do tự động). **Từ 2026-11-03 điều kiện đó bị bỏ** (mục 7 câu 9 (b): hạ dưới 3/4 thì về `INTERESTED` bất kể NET do ai đặt), nên field này trở thành mã chết: đã **bỏ khỏi schema khách**, bỏ `$set`/`$unset` trong `applyChange` và bỏ khỏi projection của `CustomerCriteriaService`.
- **Không cần migration:** field bị bỏ khỏi schema; document cũ còn field thừa `statusAutoSource` vẫn đọc/ghi bình thường (Mongoose bỏ qua field không khai báo; field không ảnh hưởng quyết định nào), đúng Zero-Downtime (không xóa dữ liệu đột ngột). Không dọn dữ liệu cũ vì vô hại.
- **Dấu "tự động" còn lại chỉ ở audit:** phần tử `changes` `{ field: 'statusAutoSource', from: null, to: 'CRITERIA_PROGRESS' }` của bản ghi `STATUS_CHANGED` được ghi cho **cả hai chiều** (lên `NET` lẫn về `INTERESTED`; trước đây chỉ chiều lên). FE dùng nó để hiện chip "Tự động theo tiến độ" trong lịch sử, nên giữ lại.

**2. Quy tắc quyết định (backend, trong cùng transaction với cập nhật tiêu chí).**

- Chỉ xét khi `progress` thực sự đổi. Quyết định chỉ dựa vào **nhóm danh sách của tình trạng hiện tại**, không phân biệt do tự động hay do người dùng đặt (hàm thuần `decideAutoStatus`, nhận tiến độ trước/sau và nhóm hiện tại).
- Tự lên **NET** khi tiến độ **MỚI = 75** và tiến độ **cũ khác 75** (gồm 0/25/50 lên 75 **và 100 xuống 75**, tức 4/4 bỏ một tiêu chí; mục 7 câu 19) và tình trạng hiện tại thuộc nhóm `NOT_CONTACTED` hoặc `INTERESTED` (kể cả tình trạng tùy biến, bị **đè**; mục 7 câu 9 (c), câu 20). **Không đổi** khi: khách `DROPPED` (miễn); khách đã ở nhóm `NET` (không đổi, không audit, không thông báo); lên 4/4 (0/25/50 lên 100).
- Tự về **INTERESTED** khi tiến độ tụt từ 75 trở lên xuống dưới 75 (2/4, 1/4, 0/4) và tình trạng hiện tại thuộc nhóm `NET`, **kể cả NET do người dùng chọn tay hay có sẵn** (mục 7 câu 9 (b)). `DROPPED` miễn. Khách đang ở nhóm `NOT_CONTACTED`/`INTERESTED` hạ tiêu chí thì không đổi (không tự "lên" `INTERESTED`).
- Tái dùng `CustomerStatusChangeService.applyChange` (cùng `session`, kiểm khóa lạc quan `version`); lỗi trong bước này làm rollback cả cập nhật tiêu chí (tiêu chí và trạng thái nguyên tử). Nếu danh mục thiếu trạng thái `NET`/`INTERESTED` đang hoạt động thì bỏ qua tự đổi (tiêu chí vẫn lưu, trả 200, ghi log cảnh báo).
- **Audit:** hai bản ghi `CRITERIA_UPDATED` và `STATUS_CHANGED`, cùng người thực hiện là người tick tiêu chí, `reason` null; bản `STATUS_CHANGED` có thêm phần tử `changes` về `statusAutoSource` (chỉ trong audit, cả hai chiều). Không đổi schema audit.
- **API:** response của `PATCH /crm/customers/:id/criteria` thêm field tùy chọn `autoStatusChange` (chỉ có khi tình trạng vừa tự đổi); `version` và `lastUpdatedAt` trả về là giá trị **sau cùng** (version gửi lên cộng 2 khi có tự đổi). Request không đổi, tương thích ngược. Chi tiết: tài liệu 05 và 04.

**3. Giao diện.**

- Khi response có `autoStatusChange`, hiện toast **6 giây** nêu tình trạng cũ và mới, kèm lý do "do tiến độ đạt 3/4 tiêu chí" hoặc "do tiến độ xuống dưới 3/4 tiêu chí"; **không có nút Hoàn tác 10 giây** (hoàn tác riêng trạng thái sẽ làm lệch quy tắc 3/4; muốn đảo thì bỏ tick tiêu chí hoặc đổi tình trạng bằng tay).
- Lịch sử thay đổi hiện chip **"Tự động theo tiến độ"** ở các lần đổi tình trạng do cơ chế này.
- Không cần thêm bước làm mới dữ liệu: ghi dữ liệu CRM ở FE đã làm mới toàn bộ truy vấn liên quan (chi tiết khách, danh sách, tab nhóm, đếm, lịch sử).

**4. Lưu ý khi làm nhập CSV (M8).** Backend **hiện chưa có** tính năng nhập CSV (M8). Quy tắc chốt "CSV không kích hoạt tự đổi tình trạng" hiện đúng vì chỉ `PATCH /crm/customers/:id/criteria` đi qua cơ chế này; khi làm M8 phải **nhớ giữ** quy tắc đó (nhập CSV không được gọi đường cập nhật tiêu chí có kèm tự đổi tình trạng).

**5. Thông báo cho người cùng chăm sóc (mục 7 câu 9 (a), chốt 2026-11-03): ĐÃ LÀM ở BE.** `CustomerCriteriaService.applyAutoStatus` gọi `NotificationsService.createMany(items, session)` **cùng transaction**, chỉ khi tình trạng đã đổi thật (cả lên `NET` lẫn về `INTERESTED`); không đổi (đã NET, `DROPPED`, lên 4/4, thiếu tình trạng đích, lỗi/xung đột version) thì không có thông báo (lỗi thì rollback cả thông báo). Người nhận = `customer.careTeam` **trừ người tick**, mỗi người một thông báo; careTeam rỗng hoặc chỉ có người tick thì không gửi. Loại mới `CUSTOMER_STATUS_AUTO_CHANGED` (thêm vào `NotificationType`, chỉ thêm giá trị nên tương thích ngược; cài đặt bật/tắt theo loại tự áp dụng, mặc định bật). `dedupeKey` = `CUSTOMER_STATUS_AUTO:<customerId>:<version sau cùng>`; deep link `/crm/customers/:id`; nội dung nêu tên khách, tình trạng cũ/mới, lý do, người tick; không có SĐT/CCCD. Dựng bằng hàm thuần `buildAutoStatusNotifications` (`customers/utils/customer-auto-status-notification.util.ts`).

**6. Test đã có** (cập nhật 2026-11-03): hàm quyết định thuần (ma trận đầy đủ tiến độ trước x sau x nhóm: lên 3/4 đè mọi nhóm trừ `DROPPED`/`NET`, 100 xuống 75, hạ dưới 3/4 từ `NET` về `INTERESTED`, `DROPPED` miễn, lên 4/4 không làm gì), test tích hợp BE (2 audit, version +2, dấu tự động trong audit cả hai chiều, NET đổi tay hạ về `INTERESTED`, tình trạng tùy biến bị đè, xung đột phiên bản, rollback, hàng loạt không kích hoạt...), test FE (toast đúng nhãn và nội dung, không có Hoàn tác, lỗi 409, lần tick kế tiếp dùng version mới).

#### PT-024 — Sidebar mobile chưa phủ kín từ mép trên màn hình

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Sidebar mobile cần phủ kín từ mép trên của màn hình; hiện đang cách ra một khoảng trống phía trên, trông xấu |
| Nhóm | FE |
| Màn hình / API | Menu bên (sidebar) ở mobile, ví dụ trang `/crm/today`. File nghi liên quan: `RealEstateAdminApp/src/layout/AppSidebar.tsx`, `AppHeader.tsx`, `Backdrop.tsx` |
| Bước tái hiện | 1. Mở `/crm/today` ở giả lập iPhone SE 375x667. 2. Mở menu (sidebar). (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Panel menu màu trắng bắt đầu thấp hơn đỉnh màn hình; header phía sau còn hiện (theo ảnh chụp giả lập 375x667 của Oniichan) |
| Kết quả mong đợi | Panel menu phủ kín từ mép trên, header phía sau không hở ra |
| Mức độ | Minor |
| Ảnh hưởng | Giao diện thiếu chỉn chu; có thể do header đè hoặc `z-index` và vùng an toàn (safe area) của iOS |
| Đề xuất | Kiểm vị trí, `z-index` và chiều cao panel so với header; thử cả iPhone thật (Safari, thanh địa chỉ co giãn) lẫn giả lập |
| Người phụ trách | `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). Code và test (vitest) xong trong repo (chưa commit, chưa deploy); đã kiểm sidebar bằng preview Chromium 375x667. **Còn lại:** Oniichan thử trên iPhone Safari thật, đặc biệt thanh địa chỉ co giãn |

#### PT-025 — Sidebar mobile không tự đóng sau khi chọn mục; chuyển nút X sang phải

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Sidebar mobile: khi ấn vào một tab/mục menu thì sidebar không tự đóng, gây khó cho người dùng. Nút X hiện ở vùng nền tối bên trái, khó thấy |
| Nhóm | FE |
| Màn hình / API | Menu bên (sidebar) ở mobile. File nghi liên quan: `RealEstateAdminApp/src/layout/AppSidebar.tsx` (có `isMobileOpen`), `Backdrop.tsx` |
| Bước tái hiện | 1. Mở sidebar trên mobile. 2. Chạm một mục menu. 3. Quan sát sidebar và vị trí nút X. (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Sidebar vẫn mở sau khi chọn mục; nút X nằm ở vùng nền tối bên trái |
| Kết quả mong đợi | Sidebar tự đóng sau khi chọn mục; nút X chuyển sang bên phải của sidebar và nằm trong vùng nền trắng cho dễ nhìn |
| Mức độ | Major |
| Ảnh hưởng | Phải đóng tay mới thấy màn hình đã chuyển; điều hướng mobile khó dùng |
| Đề xuất | Đóng sidebar khi đổi route (kể cả mục có mục con); đặt nút X trong panel, góc phải; thử trên iPhone Safari và 375x667 |
| Người phụ trách | `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). Code và test (vitest) xong trong repo (chưa commit, chưa deploy); đã kiểm sidebar bằng preview Chromium 375x667. **Còn lại:** Oniichan thử trên iPhone Safari thật. Điểm a11y có từ trước, chưa xử lý: sidebar mobile khi đóng vẫn nằm trong thứ tự Tab (mục 7 câu 24) |

#### PT-026 — Form tạo lịch hẹn mobile: icon đè lên chữ ở ô Giờ và Dự án

**[Oniichan test production 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Màn tạo lịch hẹn, bước 3 "Thời gian & Địa điểm": ở các ô "Giờ" (giờ Việt Nam) và "Dự án", icon bên trái bị chèn lên chữ (giá trị "09:30" và "Không chọn" đè lên icon): responsive chưa đủ, thiếu padding trái khi có icon. **Quan sát phụ, cần xác minh:** ô "Địa điểm" có placeholder bị cắt chữ ("...dùng văn phòng dị…"); cùng nhóm lỗi hiển thị form mobile |
| Nhóm | FE |
| Màn hình / API | Tạo lịch hẹn, bước 3 "Thời gian & Địa điểm". File nghi liên quan: `RealEstateAdminApp/src/modules/crm/screens/CreateAppointment/CreateAppointment.mobile.tsx` |
| Bước tái hiện | 1. Mở tạo lịch hẹn trên iPhone (Safari) hoặc giả lập 375x667. 2. Đi tới bước 3. 3. Nhìn các ô "Giờ", "Dự án", "Địa điểm". (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này) |
| Kết quả thực tế | Giá trị "09:30" và "Không chọn" đè lên icon bên trái; placeholder ô "Địa điểm" bị cắt (ảnh chụp từ iPhone, Safari) |
| Kết quả mong đợi | Có đủ padding trái khi ô có icon, chữ không đè icon; placeholder ô "Địa điểm" đọc được (rút ngắn hoặc cho xuống dòng) |
| Mức độ | Major |
| Ảnh hưởng | Khó đọc giá trị đã chọn, thao tác sai; thấy rõ trên màn hẹp |
| Đề xuất | Thêm padding trái cho mọi ô có icon (chung một lớp tiện ích), kiểm ô `time` và ô select riêng của Safari iOS vì chúng hay bỏ qua kiểu mặc định; rà các form mobile khác cùng kiểu |
| Người phụ trách | `coder-frontend-agent` |
| Trạng thái | Xong một phần (2026-11-02). Code và test (vitest) xong trong repo (chưa commit, chưa deploy); đã kiểm bằng preview Chromium 375x667. Sửa bằng **lớp dùng chung** nên các form mobile khác có icon cũng được sửa theo; placeholder ô "Địa điểm" đổi thành "Nhập địa chỉ gặp khách". Ô "Dự án" ở form tạo lịch hẹn đã đổi sang `SearchableSelect` có tìm kiếm (Oniichan quyết, mục 7 câu 22; xem PT-019); `index.html` thiếu `viewport-fit=cover`: Oniichan đã nghe giải thích, đề xuất mặc định **chưa thêm**, chờ Oniichan quyết (mục 7 câu 23). **Còn lại:** Oniichan thử trên iPhone Safari thật, đặc biệt ô `time` và ô select (Safari iOS hay bỏ qua kiểu mặc định) |

#### PT-027 — Lưu phiên bản hệ thống trong DB và cơ chế tự chạy migration khi nâng cấp

**[Oniichan yêu cầu bổ sung 2026-11-02]**

| Trường | Nội dung |
|---|---|
| Mô tả | Oniichan yêu cầu: có một nơi trong DB lưu **phiên bản hệ thống**; khi nâng cấp lên phiên bản mới thì có cơ chế **chạy các script đổi/cập nhật DB nếu có**. Cải tiến nền tảng, không phải lỗi; mục này là **thiết kế** (chưa code). **Oniichan đã chốt (2026-11-02): chỉ MỘT collection tên `system`**, dạng key-value, "để sau này còn lưu các biến khác". Sau nhận xét "thiết kế phức tạp quá", mục này đã **viết lại tối giản** (bỏ 3 collection `system_versions`, `schema_migrations`, `system_locks` của bản trước) |
| Nhóm | BE / DevOps / Dữ liệu (cải tiến nền tảng) |
| Màn hình / API | Collection `system`; CLI runner `dist/migrations/cli.js` trong image backend; `deploy.sh`; `RealEstateBackendApp/Dockerfile`. Không có API hay giao diện mới |
| Bước tái hiện | Không áp dụng (tính năng mới) |
| Kết quả thực tế | **Hiện trạng đã đọc code (2026-11-02):** (1) Migration là script thủ công `RealEstateBackendApp/scripts/migrations/00N_*.ts` (002 đến 006), chạy bằng `bash scripts/run-migration.sh <005\|006>` (file này ở `scripts/` **gốc repo**, khác thư mục `RealEstateBackendApp/scripts/migrations/`): dry-run mặc định, `--apply` mới ghi (`scripts/run-migration.sh:5-6`); chỉ nhận 005 và 006 (`:55,97,109-110`). (2) **Không có** nơi nào trong DB ghi migration nào đã chạy hay số phiên bản hệ thống; người vận hành tự nhớ. (3) `deploy.sh` chỉ kiểm riêng 005 (`check_users_migrated`, `deploy.sh:203-230`, gọi ở `:367`), rồi backup (`:369`), rồi `up -d --build` (`:372-374`). (4) `UserRolesMigrationGuard` (`RealEstateBackendApp/src/modules/users/migrations/user-roles-migration.guard.ts:29-45`) ở `production` ném lỗi, không khởi động nếu còn user chưa migrate 005. (5) Image production chỉ có `node_modules` và `dist`, **không có** `ts-node`, `package.json`, `scripts/` (`RealEstateBackendApp/Dockerfile:17-27`); `run-migration.sh` vì thế dựng stage `builder` (`:185`) rồi chạy `ts-node` (`:201-202`), tốn khoảng 3,75 GB đĩa và khoảng 13 phút trên VPS (PT-006). (6) Logic 004 đến 006 nằm ở `RealEstateBackendApp/src/modules/**/migrations/*.ts` (có tham số `apply`); logic 002 và 003 nằm ngay trong script. (7) Mongo là replica set `rs0` (`docker-compose.yml:31-57, 220`), dùng được transaction. (8) `RealEstateBackendApp/package.json:3` = `1.0.2`; Swagger đặt cứng `1.0` (`main.ts:81`). (9) Mục 2 chỉ ghi production đã chạy **005 và 006**; 002, 003, 004 **không có bằng chứng ghi lại**. Từ 2026-11-03 không cần khai báo tay: lần deploy đầu tiên kiểm bằng **probe chỉ-đọc** trên dữ liệu thật (mục 4b bên dưới) |
| Kết quả mong đợi | (1) DB ghi hệ thống đang ở phiên bản nào và migration nào đã chạy. (2) Nâng cấp thì **chỉ migration chưa chạy** được chạy, đúng thứ tự, không chạy song song. (3) Migration lỗi thì dừng và ghi lỗi, không tự lặp, không tự hoàn tác dữ liệu. (4) Migration cũ 002 đến 006 (đã chạy tay, có bước xóa) **không bao giờ bị runner tự chạy lại** |
| Mức độ | Major (**đề xuất**, Oniichan quyết; về bản chất là cải tiến nền tảng). Lý do: mọi thay đổi schema về sau dựa vào nó, và hiện việc "migration nào đã chạy" chỉ nằm trong đầu người vận hành |
| Ảnh hưởng | Không có sổ thì dễ chạy sót hoặc chạy lại migration có bước xóa (006 xóa khu vực cũ), khó biết production đang ở trạng thái dữ liệu nào, và `deploy.sh` phải viết riêng một cổng cho từng migration (như `check_users_migrated`) |
| Đề xuất | Một collection `system`, một runner CLI trong image backend do `deploy.sh` gọi, dry-run mặc định, 002 đến 006 ghi "đã áp dụng" một lần (bản đầu: lệnh `baseline` tay; **từ 2026-11-03: `deploy.sh` tự làm qua lệnh `reconcile` sau probe chỉ-đọc, `baseline` tay chỉ còn là lối thoát**). Chi tiết ở 6 mục thiết kế bên dưới; các điểm cần Oniichan quyết ở mục 7 (câu 11 đến 17). Phạm vi gồm cả việc **đưa số phiên bản app vào image Docker** (Dockerfile sao chép `package.json` vào image, hoặc sinh `dist/version.json` lúc build) để runner đọc được; trước đây phần này tách sang PT-014, nay PT-014 đã `Bỏ` nên thuộc PT-027 |
| Người phụ trách | `architect-agent` (thiết kế, xong); `coder-backend-agent` (runner, test); `devops-agent` (`deploy.sh`, Dockerfile, tài liệu `06_Production_Deploy.md`); `qa-agent` (review code và test) |
| Trạng thái | Xong một phần (cập nhật 2026-11-03). Đã xong trong repo (chưa commit, chưa deploy): runner `src/migrations/**` (lệnh `status`, `up`, `unlock`, `baseline`; sổ trong collection `system`); Dockerfile sinh `dist/version.json`; QA đã build image thật và chạy runner trong container. **Bổ sung 2026-11-03 (tự baseline + tự migrate theo version, xem mục 4b):** lệnh `reconcile` của runner (do `coder-backend-agent` làm; `qa-agent` đã review, đã sửa theo review) và `deploy.sh` tự gọi nó (mặc định BẬT; `--no-migrate` để tắt; `--migrate` còn là bí danh; `--plan-only` chỉ xem kế hoạch, kèm `--no-migrate` thì `--plan-only` thắng và có thông báo; `DEPLOY_ALLOW_DOWNGRADE=1` cho downgrade cố ý). Sau vòng sửa QA: DB mới tinh ghi `version` ngay ở 6b (8b là no-op); `up`/`up --apply` thủ công cũng có thể trả mã 5; probe 002 có trần (vượt thì mã 4 "không xác minh được"); `baseline --version` từ chối số có 0 đứng đầu. `deploy.sh` đã qua `bash -n`, `shellcheck` và kiểm luồng bằng stub (chưa kiểm với runner thật hay Docker thật). **Còn lại (việc của Oniichan):** (1) chạy `bash deploy.sh --plan-only` MỘT lần trên VPS trước lần deploy 1.0.3 đầu tiên, đọc kết quả probe 002..006; (2) chạy `bash deploy.sh --no-pull` (tự backup, tự baseline, `up`, ghi `version`); (3) thử `deploy.sh` đầu-cuối trên môi trường thử theo mục 11.2 của `06_Production_Deploy.md`. **Lưu ý:** mã 4 (probe không đạt) và mã 5 (downgrade) là chốt chặn chủ ý, dừng **trước `up`** (stack chưa đổi), không còn "lần deploy đầu luôn dừng ở mã 4". Khóa mồ côi (tiến trình chết để lại khóa) chỉ gỡ bằng `unlock` |

##### Thiết kế PT-027 (bản tối giản)

Do `architect-agent` soạn, **chưa code, chờ Oniichan duyệt** (mục 7, câu 11 đến 17). Đã đối chiếu `nodejs-react-mongo-coding-guidelines`: collection mới là thay đổi tương thích ngược (thêm, không sửa/xóa field cũ); runner không đi qua request web nên không cần Idempotency-Key; không đưa Queue/Cache vào vì chưa có nhu cầu.

**1. Collection `system` (key-value).** Mỗi document là một biến, `_id` là khóa:

| `_id` | Nội dung | Ghi chú |
|---|---|---|
| `version` | `{ value: '1.0.2', commit, updatedAt }` | Phiên bản hệ thống sau lần nâng cấp thành công gần nhất; chỉ runner ghi |
| `migration:007_ten` | `{ at, by }` | **Mỗi migration một document**; `by` là `deploy`, `cli` hoặc `baseline` (không ghi tên người) |
| `migration-lock` | `{ at, by }` | Có mặt khi runner đang chạy (mục 2) |
| `migration-last-error` | `{ migrationId, message, at }` | Lỗi gần nhất; `message` cắt 500 ký tự, lọc chuỗi kết nối (`mongodb://...`) |

Chọn "mỗi migration một document" thay vì một mảng `applied[]` vì ghi bằng `insert` với `_id` duy nhất: ghi trùng bị Mongo từ chối, không phải cập nhật mảng, không tranh chấp. Sổ **chỉ thêm, không xóa**, không chứa PII, token, URI kết nối. Biến hệ thống khác về sau thêm bằng document mới với `_id` riêng; runner chỉ đụng các `_id` ở trên. Collection mới không ảnh hưởng bản 1.0.2 đang chạy. Lưu ý tên: `docs/00_Project_Overview/02_Technical_Design.md:155` có nhắc collection `system_locks` cho khóa cron crawler (chỉ là gợi ý, chưa có trong code); PT-027 dùng tên `system` khác biệt, không đụng nhau.

**2. Runner** (`node dist/migrations/cli.js <lệnh>`; không khởi động NestJS, chỉ dùng `MongoClient` với `MONGODB_URI` sẵn có):

- `status` (chỉ đọc): in `version`, danh sách đã áp dụng, danh sách chờ, có khóa hoặc lỗi tồn đọng không.
- `up`: **mặc định dry-run** (in danh sách chờ, không ghi gì); `--apply` mới chạy. Chạy theo **thứ tự số file**, chỉ những cái **chưa có trong sổ**. Với `--apply`: giành khóa bằng `insert` `migration-lock` (trùng `_id` = thua, thoát mã khác 0, không chờ); chạy từng migration rồi `insert` `migration:<id>`; **lỗi thì dừng ngay**, ghi `migration-last-error`, không ghi "đã áp dụng" cho migration lỗi, không chạy cái sau, không tự retry, không rollback tự động, thoát mã khác 0; chạy hết thì ghi `version` = phiên bản app; luôn xóa khóa khi xong. Vì dữ liệu và sổ không cùng transaction, **mỗi migration phải chạy lại được an toàn** (idempotent).
- `unlock`: gỡ khóa thủ công (khi tiến trình chết để lại khóa; người kiểm tra không có runner nào chạy rồi mới gỡ).
- Registry migration khai báo tường minh trong `RealEstateBackendApp/src/migrations/` (mỗi migration có `id` dạng `NNN_ten`, `description`, hàm `up`); một unit test đối chiếu thư mục với registry (không trùng, không hở số).

**3. Migration cũ 002 đến 006 (không bao giờ tự chạy lại).** Chúng đã chạy tay trên production (005 và 006 đã xác nhận; 002, 003, 004 không có bằng chứng ghi lại) và có bước **xóa** (002 xóa bài trùng, 006 xóa khu vực cũ), nên registry của runner **chỉ chứa từ 007 trở đi**; không sửa code 002 đến 006, không bọc adapter, script cũ giữ nguyên. Để sổ phản ánh đúng, bản đầu dùng lệnh `baseline` **chạy một lần bằng tay**; **từ 2026-11-03 việc này tự động** (mục 4b bên dưới): `reconcile` chạy **probe chỉ-đọc** cho 002..006, đạt hết thì ghi sổ `by=baseline` (kèm số đếm làm bằng chứng), **không đạt thì dừng (mã 4) và không ghi gì**. Lệnh `baseline` tay (`baseline --apply --version <x.y.z> --commit <sha>`) **giữ làm lối thoát** cho người đã tự kiểm. DB mới tinh thì không baseline. Chốt chặn: nếu `system` chưa có `version` mà `users` đã có dữ liệu, runner **không bao giờ tự chạy 002 đến 006 chỉ vì sổ trống**; nó chỉ ghi sổ khi probe chứng minh dữ liệu không còn việc cho migration đó.

**4. Chạy ở đâu.** `deploy.sh` gọi runner giữa bước backup và `up`. **Bản đầu (2026-11-02):** `status`; còn migration chờ thì dừng và in lệnh, có `--migrate` mới tự `up --apply`. **Từ 2026-11-03:** tự migrate **mặc định BẬT**: `reconcile --apply --skip-version` ngay sau backup (6b), `reconcile --apply` ghi `version` sau khi backend sống (8b; DB mới tinh thì `version` đã được ghi ngay ở 6b); `--no-migrate` giữ hành vi cũ. Sau `--apply` phải coi stack như đã bị chạm (`STACK_TOUCHED=1`) để lỗi in đúng hướng dẫn "không quay code cũ"; riêng mã 3/4/5 runner không ghi gì nên stack chưa đổi. Backend **không** tự chạy migration và **không** từ chối khởi động; chỉ ghi log cảnh báo nếu còn migration chờ. Giữ nguyên `check_users_migrated` và `UserRolesMigrationGuard`. Khi triển khai, bổ sung bước migration vào checklist phát hành ở [`README.md`](README.md) mục 5.

**4b. Tự baseline + tự migrate theo version (bổ sung 2026-11-03, thiết kế đã duyệt).** Nguyên tắc: "đã áp dụng" = **dữ liệu hiện tại không còn việc cho migration đó** (002 đến 006 đều idempotent), kiểm bằng probe **chỉ-đọc**; probe không đạt thì dừng, không tự chạy migration cũ. Quyết định đã chốt với Oniichan: `DEPLOY_AUTO_MIGRATE` mặc định **BẬT**, `--no-migrate` để tắt, `--migrate` giữ làm bí danh; migration 007+ tự chạy sau backup; không bao giờ tự chạy lại 002..006; **downgrade** (version code < DB) dừng mã 5, cố ý cần `DEPLOY_ALLOW_DOWNGRADE=1` (khi đó bỏ qua migrate, KHÔNG ghi/hạ `version`); `--plan-only` chạy `reconcile` dry-run rồi thoát, stack không đổi. Quy tắc probe: 002 (mọi bài có `url` đều có `urlHash` SHA-256 hiện hành, không nhóm trùng `url`), 003 (không còn TTL index `expiresAt` của `googledrivetokens`), 004 (không còn user thiếu `teamId`), 005 (cùng bộ lọc với `UserRolesMigrationGuard`), 006 (dry-run `migrateAreasTo34Provinces` báo 0 việc). Với 1.0.3 trên production: `system` trống, `users` có dữ liệu -> probe 002..006 -> ghi sổ baseline -> ghi `version` = `1.0.3` (không còn baseline `1.0.2` riêng). Phiên bản 1.0.3 không cần migration dữ liệu mới. Vì sao mặc định BẬT: lần đầu (1.0.3) phần tự động chỉ **ghi sổ + version** sau khi probe chỉ-đọc chứng minh không còn việc và sau backup đã kiểm nội dung, không đổi dữ liệu nghiệp vụ; mọi tình huống lạ (khóa, probe không đạt, downgrade, lỗi) đều dừng **trước `up`**. Hành vi khác: `version` đã có mà sổ thiếu 002..006 thì tin `version`; sổ có id lớn mà thiếu id nhỏ thì từ chối (mã 1); Mongo không phải replica set thì `--apply` bị từ chối (mã 1); runner chết giữa chừng thì khóa mồ côi (mã 3) và chạy lại an toàn (id đã vào sổ được bỏ qua). Rủi ro còn lại: probe kiểm trạng thái cuối chứ không kiểm lịch sử; probe 002 quét hai collection bài viết và có **trần 1.000.000 doc mỗi collection hoặc 5 phút** (hằng số `PROBE_002_MAX_DOCS_PER_COLLECTION`, `PROBE_002_MAX_DURATION_MS` ở `RealEstateBackendApp/src/migrations/baseline-probes/probe-002-urlhash.ts`): vượt trần thì probe báo "không xác minh được" và dừng mã 4, người vận hành chạy dry-run script 002 bằng tay rồi `baseline` thủ công. Chi tiết quy trình, mã thoát và kịch bản thử: `docs/01_Infrastructure/06_Production_Deploy.md` mục 11, 11.1, 11.2.

**5. Việc kỹ thuật bắt buộc** (từ review QA, đã xác minh):

- Image production không có `ts-node`, `package.json`, `scripts/` (`RealEstateBackendApp/Dockerfile:17-27`), nên runner phải là **code TS dưới `src/`** biên dịch vào `dist/` (build SWC xuất mọi file trong `src`; đường dẫn dự kiến `dist/migrations/cli.js`, coder kiểm lại sau build). Runner dùng driver `mongodb` đi kèm mongoose trong `node_modules` production (coder xác minh trong image).
- **Dockerfile phải đưa số phiên bản vào image**: copy `package.json` vào stage production, hoặc sinh `dist/version.json` ở stage `builder`; thêm `ARG GIT_COMMIT` nếu muốn lưu commit. Phần này thuộc phạm vi PT-027 (trước đây tách sang PT-014; PT-014 đã `Bỏ` ngày 2026-11-02).
- Dry-run **không ghi gì** (không `createIndex`, không khóa). Runner **từ chối `--apply` nếu Mongo không phải replica set** (như 006, vốn yêu cầu replica set để chạy trong transaction).

**6. Nghiệm thu** (test tích hợp dùng `createMemoryReplSet` như `migrate-areas-to-34-provinces.integration.spec.ts`, chạy `npm run test:integration`):

1. `status` và `up` dry-run **không ghi gì** vào DB; `up --apply` trên Mongo không phải replica set bị từ chối.
2. `up --apply` chạy migration chờ **đúng thứ tự** và ghi sổ; **chạy lần 2 không làm gì**.
3. Migration lỗi (giả lập ném lỗi ở cái thứ 2 trong 3): cái 1 vào sổ, cái 2 **không** vào sổ và có `migration-last-error` (không chứa `mongodb://` hay mật khẩu), cái 3 không chạy, thoát mã khác 0.
4. Hai runner chạy song song: chỉ một bên chạy, bên kia thoát mã khác 0; khóa còn sót thì `unlock` gỡ được.
5. `system` chưa có `version` mà `users` đã có dữ liệu: runner **không chạy 002 đến 006**; `reconcile` chạy probe chỉ-đọc, đạt hết thì ghi sổ baseline rồi chạy từ 007, không đạt thì thoát mã 4 và không ghi gì; DB rỗng chạy được ngay (không baseline) và ghi `version` ngay ở bước `--skip-version` (bước ghi version sau đó là no-op); probe 002 vượt trần thì thoát mã 4, không ghi gì.
6. Chạy xong thì `version` trong `system` bằng phiên bản app, và số phiên bản đọc được từ image production (có `package.json` hoặc `dist/version.json` trong image, kiểm bằng chạy `status` từ container backend); `deploy.sh` (thử trên môi trường thử, không thử thẳng VPS, kịch bản ở mục 11.2 của `06_Production_Deploy.md`): mặc định tự baseline/migrate sau backup rồi `up`; `--no-migrate` mà còn việc chờ hoặc cần baseline thì dừng **trước** `up` (stack không đổi); probe không đạt (mã 4), downgrade (mã 5), khóa (mã 3) đều dừng trước `up`; `--plan-only` không backup, không ghi, không `up`; chạy lại lần 2 là no-op.

**Ranh giới với các mục liên quan:**

- **PT-014** (hiển thị số phiên bản): `Bỏ` (Oniichan quyết định, 2026-11-02), không làm phần hiện số phiên bản ở Swagger, health hay chân trang web. Phần **đưa số phiên bản app vào image Docker** (cần để runner ghi `version` vào `system`) thuộc PT-027, ghi ở mục 5; PT-027 không còn phụ thuộc kỹ thuật vào PT-014.
- **PT-006** (đĩa): **điều kiện để deploy**: đĩa còn khoảng 4,4 GB, dưới ngưỡng 5 GB của `deploy.sh` nên chưa deploy được. Runner chạy bằng image backend đã build nên bỏ được bước `docker build --target builder` riêng của `run-migration.sh`.
- **PT-001** (healthcheck): không đổi ý nghĩa liveness/readiness; backend không chạy migration nên không ảnh hưởng `start_period`.
- **PT-007** (tài liệu triển khai): cập nhật `06_Production_Deploy.md` (mục 5.4a, 11) cùng đợt. **PT-015** (backup định kỳ) đã `Bỏ` (Oniichan, 2026-11-02) nên không có việc cập nhật tài liệu theo PT-015; runner vẫn không tự backup và dựa vào backup tự động trước mỗi lần deploy của `deploy.sh`.

**Không làm:**

- Không có `down` hay rollback tự động: hoàn tác = khôi phục từ backup; dữ liệu đã đổi thì không quay code cũ (`deploy.sh:17-19,114-118`).
- Runner không tự backup (dựa vào backup của `deploy.sh`).
- Không giao diện quản trị, không endpoint, không chạy migration trong luồng request hay khi backend khởi động.
- Không sửa hay bọc 002 đến 006; không checksum, không lease/fencing; không Queue, Cache, microservice.

**Thứ tự:** nếu Oniichan đồng ý, làm nhóm (e) **trước** các nhóm có đụng dữ liệu (sau khi xử lý PT-006); nhóm FE thuần giao diện không phụ thuộc.

### Gợi ý nhóm công việc khi sửa

Chỉ là gợi ý, **chưa giao việc**. Mọi nhóm FE đều phải thử trên iPhone SE 375x667 (giả lập) và Safari iOS (máy thật) trước khi báo xong.

| Nhóm | Mục | Gợi ý |
|---|---|---|
| (a) Màn chi tiết khách | PT-017 đến PT-022 | `coder-frontend-agent`; riêng PT-022 **cần thêm `coder-backend-agent`** (bỏ quy tắc 24 giờ và mã lỗi `CARE_LOG_EDIT_WINDOW_EXPIRED` ở BE, cập nhật test và tài liệu API/kỹ thuật) cùng với nút Sửa ở FE |
| (b) Tiến độ tự chuyển trạng thái | PT-023 | Tính năng mới: `architect-agent` thiết kế, rồi `coder-backend-agent` và `coder-frontend-agent`; chờ Oniichan trả lời mục 7 |
| (c) Sidebar mobile | PT-024, PT-025 | `coder-frontend-agent` |
| (d) Form lịch hẹn mobile | PT-026 | `coder-frontend-agent`; rà luôn các form mobile khác cùng kiểu |
| (f) Nút Ghi chú và nút Chỉnh sửa ở màn chi tiết khách | PT-028, PT-029 | `coder-frontend-agent`; cùng màn với nhóm (a), nên làm sau khi nhóm (a) đã chốt để khỏi sửa chồng lên nhau. Chờ Oniichan trả lời 2 câu hỏi trong chính mục PT-028 |
| (g) PWA (cài lên màn hình chính) | PT-030 | `coder-frontend-agent` (code, icon, test) + `devops-agent` (nginx, header cache; tài liệu hạ tầng); `qa-agent` review. Không phụ thuộc nhóm khác, nhưng `viewport-fit=cover` đổi cách tính vùng an toàn nên nên thử cùng đợt với nhóm (c), (d), (f) trên iPhone thật |
| (h) Quy tắc mã dự án | PT-031 | `coder-backend-agent` (pattern, DTO, service, test, tài liệu) + `coder-frontend-agent` (tự điền mã, ô Mã viết hoa; làm song song, không đụng file của nhau); `qa-agent` review code và test. Không phụ thuộc nhóm khác; không cần migration (mã cũ giữ nguyên) |
| (e) Nền tảng phiên bản và migration | PT-027 | Cải tiến nền tảng, **nên làm TRƯỚC** nếu Oniichan đồng ý. **Tiên quyết: PT-006** (đĩa còn khoảng 4,4 GB, dưới ngưỡng 5 GB của `deploy.sh` nên chưa deploy được). Dockerfile đưa số phiên bản vào image nằm trong phạm vi PT-027 (PT-014 đã `Bỏ`). `coder-backend-agent` (runner), `devops-agent` (`deploy.sh`, Dockerfile), `qa-agent` review code và test; chờ Oniichan trả lời mục 7 (câu 11 đến 17) |

Nhóm (e) nên làm **trước** các nhóm còn lại nếu Oniichan đồng ý, vì mọi thay đổi schema/dữ liệu về sau sẽ dựa vào nó (hiện chưa mục PT nào bắt buộc migration, nhưng PT-023 có thể phát sinh); **điều kiện để deploy được là xử lý PT-006 (đĩa) trước**. Nhóm (a), (c), (d) thuần giao diện không phụ thuộc vào nhóm (e).

#### PT-028 — Chuyển nút Ghi chú ở tab Nhật ký xuống thanh đáy mobile và chỉnh lại nút trên desktop

**[Oniichan yêu cầu bổ sung 2026-11-03]**

| Trường | Nội dung |
|---|---|
| Mô tả | Màn chi tiết khách, tab **Nhật ký**. **Mobile:** bỏ nút "Ghi chú" nằm ngay dưới thanh tab (nút khoanh đỏ trong ảnh Oniichan gửi), chuyển xuống **thanh cố định ở đáy màn**, đứng cạnh hai nút "Gọi điện" và "Nhắn Zalo". **Desktop:** nút "Ghi chú" ở cùng chỗ đang "đứng lửng lơ" (một nút nhỏ đứng riêng, không gắn với khối nào), cần chỉnh lại cho đẹp và gọn |
| Nhóm | FE |
| Màn hình / API | Chi tiết khách, tab Nhật ký. File liên quan (đã đọc, 2026-11-03): `RealEstateAdminApp/src/modules/crm/screens/CustomerDetail/components/CareLogComposer.tsx` (nút khoanh đỏ: `w-full` ở mobile, `md:w-auto` ở desktop, nút `openCreate`); `.../components/MobileContactFooter.tsx` (thanh đáy cố định, hiện có 2 nút `flex-1`, `h-12`); `.../CustomerDetail.mobile.tsx`, `CustomerDetail.desktop.tsx` (nối `onAddNote`); `.../useNoteComposer.ts` (`openCreate`). Không có API mới |
| Bước tái hiện | 1. Mở chi tiết một khách ở mobile (hoặc giả lập 375x667). 2. Chọn tab "Nhật ký". 3. Nhìn nút "Ghi chú" dưới thanh tab. 4. Lặp lại ở desktop và nhìn vị trí nút. (Môi trường: Oniichan test trên điện thoại (iPhone, Safari) và giả lập iPhone SE 375x667 trên desktop. Khi sửa phải thử lại đúng hai môi trường này, kèm desktop) |
| Kết quả thực tế | Mobile: nút "Ghi chú" nằm giữa màn hình, trên khối "Nhật ký chăm sóc", phải cuộn lên mới thấy khi danh sách nhật ký dài, còn các nút hành động chính (Gọi điện, Nhắn Zalo) lại nằm ở đáy. Desktop: nút đứng riêng một mình, không thẳng hàng với khối nào, nhìn lửng lơ |
| Kết quả mong đợi | Mobile: không còn nút "Ghi chú" ở giữa màn; thanh đáy có 3 nút (Ghi chú, Gọi điện, Nhắn Zalo), vẫn bấm được bằng một tay, không đè nội dung và không bị bàn phím che khi mở form. Desktop: nút "Ghi chú" được đặt vào chỗ có chủ đích (ví dụ cùng hàng với tiêu đề thẻ "Nhật ký chăm sóc", căn phải) hoặc nằm trong thẻ, cân với bố cục xung quanh |
| Mức độ | Cải tiến |
| Ảnh hưởng | Thao tác ghi chú, việc làm nhiều nhất của sale sau cuộc gọi, hiện nằm xa tầm ngón cái ở mobile; desktop thì thiếu chỉn chu |
| Đề xuất | (1) Mobile: thêm nút "Ghi chú" vào `MobileContactFooter` (thanh đáy), tiếp tục dùng `openCreate` của `useNoteComposer` để mở form; chỉ hiện nút ở tab Nhật ký hay ở mọi tab là điểm cần Oniichan chốt (câu hỏi 1). Ẩn nút khoanh đỏ ở mobile (`variant === 'mobile'`) trong `CareLogComposer`, giữ nguyên ở desktop. (2) Desktop: đưa nút lên đầu thẻ "Nhật ký chăm sóc" (cùng hàng với tiêu đề), thay vì đứng riêng trên thẻ. (3) Cập nhật test vitest (`CustomerDetail.mobile.test.tsx` đang kiểm thanh đáy chỉ có Gọi điện và Nhắn Zalo, dòng 107 đến 115). (4) Kiểm tra khi form ghi chú đang mở thì thanh đáy không che ô nhập (form cuộn vào vùng nhìn thấy, xem `CareLogForm.tsx:89`) |
| Người phụ trách | `coder-frontend-agent`; `qa-agent` review code và test |
| Trạng thái | Xong một phần (2026-11-03). Code và test (vitest) xong trong repo (chưa commit, chưa deploy); `qa-agent` đã review (không Major), đã sửa theo review. Oniichan chưa trả lời 2 câu hỏi nên dùng mặc định: nút Ghi chú ở thanh đáy hiện ở **mọi tab**; nút Ghi chú ở thẻ đầu hồ sơ (`CustomerHeader.tsx:56`) **giữ nguyên** (mobile hiện có Ghi chú ở cả thẻ đầu hồ sơ và thanh đáy). **Đã làm:** mobile bỏ nút khoanh đỏ, thanh đáy 3 nút (Ghi chú, Gọi điện, Nhắn Zalo; dưới 360px bớt padding và ẩn icon); bấm Ghi chú ở thanh đáy thì sang tab Nhật ký, mở form, cuộn và focus, nháp không mất. Desktop: nút Ghi chú nằm cùng hàng tiêu đề thẻ "Nhật ký chăm sóc" (căn phải), ẩn khi form đang mở, quay lại sau khi lưu hoặc hủy (`CareLogComposer` ở trạng thái đóng không còn vẽ nút nào, cả desktop). Vitest toàn module CRM 789 test pass, `tsc -b` sạch (Neptune chạy lại). **Còn lại:** Oniichan thử trên iPhone Safari thật (bàn phím ảo, vùng an toàn thanh đáy, màn 320px) và chốt 2 câu hỏi nếu muốn đổi; E2E Playwright chưa chạy (cần backend; chỉ đổi comment ở `e2e/lib/ui.ts`) |

#### PT-029 — Màn hình mobile bỏ nút "Chỉnh sửa" ở hàng tiêu đề

**[Oniichan yêu cầu bổ sung 2026-11-03]**

| Trường | Nội dung |
|---|---|
| Mô tả | Màn chi tiết khách ở mobile: bỏ nút "Chỉnh sửa" (biểu tượng bút, chữ xanh) nằm góc phải hàng tiêu đề "← Quản lý khách hàng". Oniichan nhận xét nút này "lửng lơ" (đứng một mình trên nền trang, không thuộc thẻ nào) |
| Nhóm | FE |
| Màn hình / API | Chi tiết khách, mobile (mọi tab). File: `RealEstateAdminApp/src/modules/crm/screens/CustomerDetail/components/MobileDetailHeader.tsx:27-30` (nút gọi `navigate('edit_persona')`); test `MobileDetailHeader.test.tsx:21-25` đang kiểm nút này **phải có** nên cần đổi. Không có API mới |
| Bước tái hiện | 1. Mở chi tiết một khách ở mobile (iPhone Safari hoặc giả lập 375x667). 2. Nhìn góc phải hàng tiêu đề. (Môi trường: như PT-017 đến PT-026) |
| Kết quả thực tế | Có nút "Chỉnh sửa" đứng riêng ở góc phải hàng tiêu đề |
| Kết quả mong đợi | Không còn nút này ở mobile; hàng tiêu đề chỉ còn nút Quay lại và nhãn "Quản lý khách hàng" |
| Mức độ | Minor |
| Ảnh hưởng | Giao diện thiếu gọn. **Không mất chức năng (Neptune đã đọc code, 2026-11-03):** cùng đích `edit_persona` (`/customers/:id/persona`) vẫn vào được bằng nút "Sửa" ở thẻ "Thông tin" (`CustomerInfoCard.tsx:24`) và thẻ "Chân dung khách hàng" (`PersonaCards.tsx:52`), cả hai đều nằm ở tab Thông tin |
| Đề xuất | Xóa nút và import `Pencil`, `BUTTON_LINK_CLASS`, `useCrmActions().navigate` khỏi `MobileDetailHeader.tsx` (giữ `goBack`); sửa test thành "KHÔNG có nút Chỉnh sửa". Chỉ áp dụng cho mobile: `MobileDetailHeader` chỉ được dùng ở `CustomerDetail.mobile.tsx:43`, nên desktop không bị ảnh hưởng. Làm chung đợt với PT-028 (cùng màn, cùng agent) |
| Người phụ trách | `coder-frontend-agent`; `qa-agent` review code và test |
| Trạng thái | Xong một phần (2026-11-03). Code và test (vitest) xong trong repo (chưa commit, chưa deploy); `qa-agent` đã review (không Major). Nút "Chỉnh sửa" ở tiêu đề mobile đã xóa, test đổi thành kiểm không còn nút. **Còn lại:** Oniichan xem trên mobile thật. Lưu ý: nếu người dùng đang ở tab Nhật ký hay Tiến độ thì muốn sửa khách phải quay về tab Thông tin (đề xuất chấp nhận; nếu Oniichan muốn giữ một lối tắt khác ở các tab đó thì báo lại) |

#### PT-030 — Biến web admin thành PWA cài được trên iPhone và Android

**[Oniichan yêu cầu bổ sung 2026-11-03]**

| Trường | Nội dung |
|---|---|
| Mô tả | Làm cho web admin **cài được lên Màn hình chính** như một ứng dụng (iPhone Safari và Android Chrome): có manifest, service worker, icon, tên ứng dụng, mở ra không thanh địa chỉ. Hiện trạng trước đó: chưa có manifest, service worker, icon; `public/` chỉ có logo Vite; `index.html` còn `<title>client</title>`, `lang="en"`, chưa có `theme-color` |
| Nhóm | FE (phần cache header nginx và tài liệu hạ tầng do `devops-agent` làm, xem `docs/01_Infrastructure`) |
| Màn hình / API | Toàn bộ web admin. Không có API mới. File chính: `RealEstateAdminApp/vite.config.ts` (plugin `vite-plugin-pwa` 2.0.0, tương thích Vite 8), `index.html`, `src/pwa/*` (`sw.ts`, `serviceWorkerConfig.ts`, `registerServiceWorker.ts`, `PwaUpdatePrompt.tsx`, `IosInstallHint.tsx`, `iosInstallHintLogic.ts` và test), `public/offline.html`, `public/pwa-*.png`, `public/apple-touch-icon.png`, `public/favicon-*.png`, `scripts/generate-pwa-icons.mjs`, `tsconfig.sw.json` |
| Bước tái hiện | 1. Mở web admin trên iPhone Safari, bấm Chia sẻ. 2. Nhìn menu: trước đây không có icon/tên riêng, mở ra vẫn là trang web trong Safari |
| Kết quả thực tế | Không cài được như ứng dụng; tab trình duyệt hiện tiêu đề `client` và logo Vite |
| Kết quả mong đợi | Cài lên Màn hình chính với tên "STND", icon logo STND, mở ra toàn màn hình; có hướng dẫn cài trên iPhone; có thông báo khi có phiên bản mới; mất mạng thì hiện trang "Không có kết nối" |
| Mức độ | Cải tiến |
| Ảnh hưởng | Nhân viên mở ứng dụng nhanh hơn từ Màn hình chính; không ảnh hưởng dữ liệu. Rủi ro đã chặn: service worker **không bao giờ** cache dữ liệu (CCCD, hồ sơ khách, ảnh signed URL) |
| Đề xuất | Xem "Quyết định đã chốt" và "Đã làm" ngay dưới |
| Người phụ trách | `coder-frontend-agent` (code, icon, test, tài liệu mục này); `devops-agent` (nginx và tài liệu hạ tầng); `qa-agent` review |
| Trạng thái | Xong một phần (2026-11-03). Code, test (vitest) và build xong trong repo (chưa commit, chưa deploy). **Chưa** thử trên iPhone và Android thật, **chưa** chạy Lighthouse, **chưa** kiểm Cloudflare. Việc còn lại: mục "Việc Oniichan tự làm" bên dưới |

##### Quyết định đã chốt (Oniichan duyệt 2026-11-03)

1. **Mức PWA: cài được, KHÔNG offline dữ liệu.** Service worker chỉ precache vỏ ứng dụng (JS, CSS, icon, `offline.html`). **Không cache `/api/`**, ảnh, hay origin khác; không có `runtimeCaching`. Mất mạng khi mở một trang thì hiện trang tĩnh "Không có kết nối" kèm nút Thử lại, **không** hiện dữ liệu cũ.
2. **Cập nhật sau deploy: không tự tải lại.** Nhân viên có thể đang gõ dở ghi chú. Khi có phiên bản mới hiện thông báo "Có phiên bản mới" với nút **Cập nhật** (mới tải lại) và nút **Để sau**. Ứng dụng tự kiểm bản mới khi mở lại/quay lại ứng dụng (sự kiện `visibilitychange`) và mỗi 1 giờ, vì PWA đã cài trên iOS gần như không tự tải lại trang.
3. **Icon tạm** dựng từ `src/images/logo/logo.png` (chỉ **60x78 px**, nền trong suốt, không vuông): đặt giữa nền navy `#101828` (màu nền tối của app). Vì file nguồn rất nhỏ, icon 192/512 px là ảnh **phóng to nên hơi mềm/mờ**; chấp nhận cho tới khi có logo độ phân giải cao.
4. **`viewport-fit=cover`: ĐÃ LÀM** (xem mục 23 ở mục 7, đã sửa lại cho khớp). Đã rà các phần tử cố định/sát mép, danh sách ở "Vùng an toàn".
5. **Tên:** `name` "STND – Quản lý Bất động sản", `short_name` "STND" (dưới icon), `lang: vi`, `display: standalone`, `start_url`/`scope`/`id` đều `/`, không khóa hướng màn hình (desktop cũng dùng).

##### Đã làm

- **Plugin, không viết tay toàn bộ:** `vite-plugin-pwa` 2.0.0 (peer `vite ^8` hợp lệ), chiến lược `injectManifest` với service worker tự viết `src/pwa/sw.ts` (Workbox `workbox-precaching`, `workbox-routing`, `workbox-core`), chế độ `registerType: 'prompt'`, `devOptions.enabled: false`. Build ra `dist/sw.js` (gộp sẵn Workbox, không có `workbox-*.js` riêng), `dist/manifest.webmanifest`, icon, `dist/offline.html`.
- **Vì sao `injectManifest` thay vì `generateSW`/`navigateFallback`:** `navigateFallback` của Workbox trả trang được chỉ định cho **mọi** lần điều hướng (kể cả khi có mạng), nên không thể dùng để chỉ hiện `offline.html` khi mất mạng. Với `injectManifest`: điều hướng luôn đi mạng; **chỉ khi `fetch` lỗi** mới trả `offline.html`. `index.html` cố ý **không** nằm trong precache (vì Workbox sẽ trả bản cũ cho `/` kể cả khi online); `navigateFallbackDenylist` tương ứng là `NavigationRoute({ denylist: [/^\/api\//] })`. `manifest.webmanifest` cũng bị lọc khỏi precache để luôn lấy bản mới.
- **Hệ quả cần biết:** mất mạng khi mở ứng dụng thì thấy "Không có kết nối" chứ **không** vào được vỏ SPA rồi lỗi API. Đang dùng ứng dụng (trang đã tải) mà mất mạng thì hành vi như web thường (lỗi từng request). Lần cài đầu tải khoảng 1,8 MB JS/CSS để precache.
- **`index.html`:** `lang="vi"`, `<title>STND – Quản lý Bất động sản</title>` (không có chỗ nào đang đặt title động: `PageMeta`/`react-helmet-async` chưa được màn hình nào dùng, nên không xung đột), `theme-color`, `apple-touch-icon` (180x180, nền đặc vì iOS không hỗ trợ nền trong suốt), `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style=default`, `viewport-fit=cover`; script áp lớp `dark` giữ nguyên; favicon Vite (`favicon.svg`) đã **xóa** và thay bằng `favicon-32x32.png`, `favicon-48x48.png` từ logo STND.
- **Hướng dẫn cài iPhone:** banner mỏng ở đầu trang, **chỉ** hiện khi iOS Safari, chưa cài (không standalone), đã đăng nhập và chưa bấm "Đã hiểu" (cờ localStorage `pwa.iosInstallHintDismissed`). Nội dung: bấm Chia sẻ rồi chọn "Thêm vào MH chính". Không hiện trên Chrome/Firefox iOS và trong trình duyệt nhúng của app (Zalo, Facebook...) vì hướng dẫn Safari không đúng ở đó.
- **Android: KHÔNG làm nút "Cài ứng dụng" riêng** (`beforeinstallprompt` phải bắt từ sớm trước khi React mount và giữ trạng thái toàn cục; không đáng độ phức tạp). Chrome Android vẫn tự có menu "Cài đặt ứng dụng" và thanh gợi ý khi đủ điều kiện.
- **Script sinh icon:** `RealEstateAdminApp/scripts/generate-pwa-icons.mjs` (dùng `sharp`, devDependency). **Thay logo:** thay file nguồn `src/images/logo/logo.png` (hoặc truyền `--source=...`) rồi chạy `node scripts/generate-pwa-icons.mjs` (tùy chọn `--bg=#rrggbb`, `--kernel=lanczos3|nearest`), commit các PNG trong `public/`. Build **không** phụ thuộc script này (PNG đã nằm sẵn trong `public/`). Đã thử cả hai kernel: `lanczos3` (mặc định) mượt hơn; `nearest` ra răng cưa vì logo không phải pixel-art thật.
- **Giới hạn đã biết:** `theme-color` và `background_color` là **tĩnh `#ffffff`** (giao diện sáng mặc định); người dùng chọn chế độ tối trong app thì thanh trạng thái vẫn trắng. Thanh trạng thái iOS dùng `default` (nền trắng, chữ đen, nội dung nằm dưới thanh) để không phải che tai thỏ ở mép trên.

##### Vùng an toàn (`viewport-fit=cover`)

Khi có `viewport-fit=cover`, các `env(safe-area-inset-*)` mới có giá trị thật (trước đây luôn bằng 0 nên các chỗ đã có `env()` chưa từng hoạt động). Đã rà và sửa:

| Chỗ | Sửa |
|---|---|
| `CrmBottomNav` (thanh đáy CRM) | **Sửa lỗi sẽ lộ ra:** chiều cao `h-16` + `pb-[env(bottom)]` làm phần icon bị co trên iPhone có home indicator. Đổi chiều cao thành `calc(4rem + env(bottom))`; thêm lề trái/phải theo `env(left/right)` |
| `CrmLayout` | Padding đáy chừa thanh đáy: `pb-[calc(5rem+env(bottom))]` (trước `pb-20`), khớp chiều cao mới |
| `AppHeader` (header dính trên cùng) | Thêm `pt-[env(top)]` |
| `AppSidebar` (sidebar mobile) | Đã có `env(top/bottom)`; thêm lề trái `max(1.25rem, env(left))` |
| `MobileContactFooter` (Ghi chú/Gọi/Zalo) | Đã có `env(bottom)`; thêm lề trái/phải |
| `BottomSheet` | Chân sheet đã có `env(bottom)`; thêm `env(bottom)` cho vùng nội dung khi sheet **không có** chân |
| `LightboxModal` (xem ảnh toàn màn hình) | Header chừa `env(top/left/right)` |
| Toàn trang (`body`) | `padding-left/right: env(left/right)` để xoay ngang không bị tai thỏ che |
| Toast (`Toaster`) | `containerStyle` chừa `env(top/right)` |
| Đã có sẵn, giữ nguyên | `FormActionBar`, `CareLogForm` (thanh dính đáy), `MobileDetailHeader` (nằm trong nội dung, không dính), `CustomerDetail.mobile` (`pb` đã gồm `env(bottom)`) |

**Chưa chắc, cần Oniichan thử trên iPhone thật:** (1) với `status-bar-style=default`, `env(safe-area-inset-top)` trong chế độ đã cài thường bằng 0 (nội dung bắt đầu dưới thanh trạng thái); các chỗ đã thêm `env(top)` chỉ phòng trường hợp khác; (2) khi **bàn phím ảo mở**, `env(safe-area-inset-bottom)` có thể vẫn còn giá trị làm thừa khoảng trống ở chân `BottomSheet`/thanh dính; (3) xoay ngang trên iPhone có tai thỏ (thanh đáy CRM, sidebar, lightbox); (4) các hộp thoại giữa màn (`components/ui/modal`) và toast cũ ở các màn tin tức (`fixed top-4 right-4`) **chưa** chỉnh vùng an toàn vì nằm giữa màn hoặc chỉ dùng trên desktop; (5) banner hướng dẫn cài nằm trong luồng bình thường phía trên header, có thể đẩy bố cục các màn mobile toàn màn hình xuống một chút cho tới khi bấm "Đã hiểu".

##### Đã kiểm trong repo (2026-11-03)

- `npx tsc -b` thoát 0; `npx vitest run` toàn bộ 119 file, 1032 test xanh (có 42 test mới trong `src/pwa`: các nhánh hiện gợi ý iOS, đường dẫn `/api` bị chặn, toast cập nhật chỉ gọi cập nhật khi bấm Cập nhật, kiểm bản mới khi tab visible/theo chu kỳ/mất mạng); `npm run lint` không có cảnh báo mới ở file đã đụng; `npm run build` ra đủ `dist/sw.js`, `dist/manifest.webmanifest`, icon, `dist/offline.html`.
- `dist/sw.js`: danh sách precache **không** có `/api`, không có `index.html`, không có `runtimeCaching`; chỉ có một chỗ nhắc `/api`: `denylist:[/^\/api\//]` của `NavigationRoute`.
- Trình duyệt headless (Playwright, Chromium) chạy trên `vite preview`: service worker đăng ký ở scope `/`, manifest không lỗi, **không có lỗi installability**, cache chỉ có 124 mục vỏ ứng dụng (không `/api`, không `index.html`, không manifest), mất mạng thì điều hướng ra "Không có kết nối" và nút Thử lại tải lại được ứng dụng; luồng cập nhật (build lại, quay lại tab) hiện "Có phiên bản mới", **không** tự tải lại, và chỉ tải lại sau khi bấm "Cập nhật".

##### Việc Oniichan tự làm

1. Cài thử trên **iPhone Safari** (Chia sẻ, Thêm vào MH chính) và **Android Chrome** (menu Cài đặt ứng dụng): đúng tên, icon, mở toàn màn hình; làm theo mục mới trong [`02_Checklist_Kiem_iPhone_v1.0.3.md`](02_Checklist_Kiem_iPhone_v1.0.3.md).
2. Chạy **Lighthouse** (mục PWA/Best practices) trên môi trường staging.
3. **Kiểm Cloudflare không cache `sw.js`** (và `index.html`, `manifest.webmanifest`, `offline.html`): nginx đã đặt `Cache-Control: no-cache` cho các file này, nhưng cần xem Cloudflare có đè bằng rule cache riêng không (tab Caching/Rules). Nếu `sw.js` bị cache ở edge, người dùng sẽ kẹt bản cũ.
4. Đưa kết quả vào checklist iPhone và đổi PT-030 sang `Xong` khi đạt.
5. Có logo độ phân giải cao thì thay file nguồn và chạy lại script icon.

#### PT-031 — Đổi quy tắc mã dự án thành chữ và số viết liền, FE tự điền mã từ tên

**[Oniichan yêu cầu bổ sung 2026-11-04]**

| Trường | Nội dung |
|---|---|
| Mô tả | Đổi quy tắc **mã dự án** (module CRM Dự án): chỉ gồm chữ A-Z không dấu và số 0-9, **viết liền** (không khoảng trắng, **không `-`, không `_`**), 1 đến **30** ký tự; hiển thị và lưu theo chữ HOA ở FE. Kèm tiện ích: form **Thêm dự án** tự điền ô Mã từ Tên dự án. **Lịch sử đổi yêu cầu (2026-11-04):** ban đầu Oniichan chốt tối đa 20 ký tự, sau đó đổi thành 30 ký tự trong cùng ngày; số cuối cùng là 30 |
| Nhóm | BE / FE / Tài liệu |
| Màn hình / API | Màn Dự án (form Thêm và Sửa); `POST /crm/projects`, `PATCH /crm/projects/:id`. Quy tắc cũ là quyết định #31 (2026-10-22): chữ, số, `-`, `_`, tối đa 20 ký tự |
| Bước tái hiện | 1. Mở màn Dự án bằng tài khoản Quản trị, bấm Thêm dự án. 2. Nhập mã có `-` hoặc `_` (ví dụ `SKY-PARK`): trước đây được chấp nhận |
| Kết quả thực tế | Mã cho phép `-`, `_`, tối đa 20 ký tự; người dùng phải tự gõ mã |
| Kết quả mong đợi | Mã chỉ A-Z, 0-9 viết liền, 1-30 ký tự (sai ⇒ 400 `VALIDATION_FAILED`); form Thêm tự điền mã từ tên |
| Mức độ | Cải tiến |
| Ảnh hưởng | Mã dự án dùng để tìm và hiển thị; đổi quy tắc **không** đổi dữ liệu cũ. Không đổi cơ chế so trùng: `code` giữ như người gửi, unique không phân biệt hoa thường qua `codeNormalized` (kể cả dự án đã xóa mềm), trùng ⇒ 409 `PROJECT_CODE_DUPLICATED` |
| Đề xuất | Xem "Quyết định đã chốt" và "Đã làm" ngay dưới |
| Người phụ trách | `coder-backend-agent` (BE, unit test, tài liệu mục này); `coder-frontend-agent` (FE, trong `RealEstateAdminApp/`); `qa-agent` review code và test |
| Trạng thái | Xong một phần (2026-11-04). Code BE và test xong trong repo (chưa commit, chưa deploy); phần FE do `coder-frontend-agent` làm song song. **Còn lại:** deploy, Oniichan thử thêm/sửa dự án trên web (đặc biệt sửa dự án có mã cũ chứa `-`/`_`) |

##### Quyết định đã chốt (Oniichan, 2026-11-04)

1. **Quy tắc mới:** `^[A-Za-z0-9]{1,30}$`. Hiển thị chữ HOA ở FE; BE vẫn giữ `code` như người gửi, so trùng không phân biệt hoa thường qua `codeNormalized` (không đổi).
2. **Mã cũ: giữ nguyên, không migrate.** Production có thể đã có mã chứa `-`/`_`; không tự đổi dữ liệu cũ. Quy tắc mới chỉ áp cho mã **tạo mới** và mã **được đổi sang giá trị khác**. `PATCH` gửi lại đúng mã đang có (so không phân biệt hoa thường) vẫn được chấp nhận dù là mã cũ (để sửa tên, giá, trạng thái... mà không bị chặn vì mã).
3. **FE tự điền mã khi Thêm:** lấy từ Tên dự án bằng slug bỏ dấu tiếng Việt, chỉ giữ A-Z và 0-9, viết hoa, cắt 30 ký tự; nếu trùng với mã đã có thì thêm hậu tố số (ví dụ `SKYPARK` ⇒ `SKYPARK2`); **ngừng tự điền** khi người dùng sửa tay ô Mã; form **Sửa** không tự đổi mã; ô Mã tự viết hoa khi gõ.

##### Đã làm (BE)

- `RealEstateBackendApp/src/modules/crm/projects/project.rules.ts`: `PROJECT_CODE_PATTERN` đổi thành `^[A-Za-z0-9]{1,30}$`; thêm `PROJECT_CODE_MAX_LENGTH` (30), `PROJECT_CODE_LEGACY_PATTERN` (`^[A-Za-z0-9_-]{1,30}$`, chỉ để kiểm nới ở PATCH), `PROJECT_CODE_MESSAGE` và hàm `assertProjectCodeChange` (mã gửi lên trùng mã hiện có không phân biệt hoa thường thì qua; khác thì phải khớp quy tắc mới, sai ⇒ 400 `VALIDATION_FAILED` với `details.fields = ['code']`).
- `dtos/project.dto.ts`: `CreateProjectDto.code` kiểm chặt (thông báo và Swagger `pattern`, `maxLength`, `description` đã cập nhật); `UpdateProjectDto.code` chỉ kiểm nới (`PROJECT_CODE_LEGACY_PATTERN`, vì DTO không biết mã hiện có).
- `projects.service.ts` (`update`): trong transaction, sau khi đọc dự án hiện có, gọi `assertProjectCodeChange(dto.code, normalizeProjectCode(before.code))` khi PATCH có `code`.
- `schemas/project.schema.ts`: `maxlength` của `code` nâng từ 20 lên 30 (tương thích ngược: mã cũ tối đa 20 vẫn hợp lệ). `codeNormalized` và index unique `{ codeNormalized: 1 }` **không có giới hạn độ dài** nên không đổi; không cần migration.
- Test: `project.rules.spec.ts` (ca biên 1 và 30 ký tự, 31 ký tự bị từ chối, có `_`, có `-`, có khoảng trắng, có dấu tiếng Việt, chữ thường hợp lệ, DTO PATCH nới, `assertProjectCodeChange`); `projects.service.spec.ts` mới (PATCH giữ nguyên mã cũ có `_` thì qua, đổi sang mã mới có `_`/`-` thì 400 và không ghi DB, đổi sang mã hợp lệ thì `codeNormalized` viết hoa, trùng mã ⇒ 409 ở cả tạo và sửa); `crm-m1.integration.spec.ts` (mã dữ liệu thử đổi sang A-Z0-9, thêm ca validate `_`, `-`, dấu, 31 ký tự và ca mã cũ trong DB: PATCH giữ nguyên 200, đổi sang mã còn `_` 400, đổi sang mã sạch 200).
- Tài liệu: 04 (mục 3.3, bảng `projects`, checklist, quyết định #31), 05 (POST/PATCH `/crm/projects`), 01 (X7) và 02 (màn Dự án).
- Sau review QA (2026-11-04): thông báo lỗi của DTO PATCH đổi thành "Mã dự án chỉ gồm chữ A-Z không dấu và số 0-9 viết liền, tối đa 30 ký tự (mã cũ chỉ được gửi lại nguyên văn)" (trước đó nghe như `-`/`_` vẫn được phép); `assertProjectCodeChange` nhận **mã hiện có dạng thô** và tự chuẩn hóa bên trong; dữ liệu rất cũ thiếu `code` (null) không còn gây lỗi 500 mà mã gửi lên rơi vào kiểm chặt (có test).

##### Lưu ý khi dùng (từ review QA)

1. **PATCH từ FE luôn gửi `code`** (chữ HOA, đã trim). Vì vậy khi Quản trị sửa bất kỳ trường nào của một dự án có mã cũ như `old_code-1`, mã lưu sẽ đổi sang chữ HOA `OLD_CODE-1` (ghi vào audit `PROJECT_UPDATED` như một thay đổi `code`); các ký tự `_` và `-` vẫn giữ nguyên, chỉ đổi hoa/thường. Đây là hành vi chấp nhận được, không phải lỗi.
2. **Hai dạng lỗi 400 cho mã sai:** lỗi do **DTO** (khoảng trắng, dấu, quá 30 ký tự, hoặc POST sai quy tắc) trả `message` là **mảng** chuỗi và **không** có `details.fields`; lỗi do **service** (PATCH đổi sang mã khác còn `-`/`_`) trả `message` là chuỗi và `details.fields = ['code']`, `errorCode = VALIDATION_FAILED`. FE chỉ nên dựa vào `errorCode` và `message`, không dựa vào `details.fields`.

## 6. Kết quả test production do Oniichan ghi nhận

**Phần lớn còn để trống** (ngày 2026-11-02 đã ghi dòng 11 ảnh đính kèm và dòng 12 giao diện mobile; dòng 1 và 4 do Oniichan báo đã xong, chưa ghi chi tiết; dòng 10 không còn áp dụng). Oniichan điền cột "Kết quả" (ví dụ Đạt / Lỗi / Không áp dụng) và cột "Mã mục lỗi liên quan" (ví dụ `PT-017`) khi test. Lỗi mới phát hiện được thêm ở mục 5 từ `PT-017`.

| # | Hạng mục test (đề xuất) | Cách làm | Kết quả | Mã mục lỗi liên quan |
|---|---|---|---|---|
| 1 | Đăng nhập web admin | Đăng nhập bằng tài khoản ADMIN, kiểm tra vào được trang chính | Oniichan báo đã xong (2026-11-02), chưa ghi chi tiết | |
| 2 | Danh sách và chi tiết khách | Mở danh sách khách, mở chi tiết một khách | | |
| 3 | Ghi thử một thay đổi | Sửa một trường của một khách (ví dụ ghi chú), lưu, tải lại để kiểm | | |
| 4 | Thao tác AI | Cấu hình AI, tải danh sách model, chạy một thao tác AI nhỏ (liên quan PT-005) | Oniichan báo đã xong (2026-11-02), chưa ghi chi tiết | |
| 5 | Thao tác nhóm | Thêm và gỡ thành viên của một nhóm | | |
| 6 | Xóa và khôi phục khách "Bỏ" | Xóa một khách ở trạng thái "Bỏ", khôi phục bằng tài khoản Admin (chỉ làm nếu bản giao diện đã có chức năng này) | | |
| 7 | Bộ lọc "Người phụ trách" | Lọc theo người phụ trách ở danh sách khách, kiểm kết quả đúng phạm vi quyền | | |
| 8 | Khu vực 34 tỉnh thành | Mở select khu vực, thấy đủ 34 tỉnh/thành, chọn thử cho một khách (PT-012 đã `Bỏ`) | | |
| 9 | Health sau deploy | Gọi `GET /api/v1/health/liveness` và `GET /api/v1/health/readiness` (liên quan PT-001); readiness phải 200 khi MongoDB, Redis, S3/MinIO sẵn sàng | | |
| 10 | Đường lui 5.8 còn dùng được | Trước khi làm PT-010, kiểm các điều kiện của đường lui 5.8 (image `*:pre-upgrade`, backup volume, dump `pre-upgrade`) còn nguyên và dùng được. Ngày dự kiến hết thời hạn giữ đường lui: không còn cần (xem cột Kết quả) | Không còn áp dụng: image `*:pre-upgrade` đã xóa ngày 2026-11-02 theo yêu cầu Oniichan (PT-010), nên đường lui 5.8 không còn dùng được | PT-010 |
| 11 | Ảnh đính kèm | Đính kèm một ảnh vào nhật ký/chi tiết khách và xem lại ảnh (liên quan PT-003) | OK (2026-11-02) | Không |
| 12 | Giao diện mobile | Dùng web admin trên iPhone (Safari) và giả lập iPhone SE 375x667: chi tiết khách, nhật ký, sidebar, tạo lịch hẹn | Có lỗi: xem PT-017 đến PT-026 (2026-11-02). Code sửa xong (2026-11-02), chờ Oniichan thử lại trên iPhone | PT-017 đến PT-026 |

## 7. Điều cần Oniichan quyết

Đã xong hoặc đã chốt (không còn cần quyết):

- PT-003 bật ảnh đính kèm (2026-11-02).
- **Câu 1, 2, 3, 4: Oniichan báo "Đã xong" (2026-11-02):** (1) cất `CRM_PII_ENCRYPTION_KEY` vào password manager và xác nhận đủ 44 ký tự; (2) xóa tunnel trống `minio.stnd.vn`; (3) thẻ git `v1.0.2`; (4) test đăng nhập web và thao tác AI. Đây là lời báo của Oniichan; **Neptune sẽ kiểm lại cụ thể từng việc** (đặc biệt câu 3: thẻ `v1.0.2` đang trỏ commit nào, đã push chưa), kết quả kiểm chưa ghi ở đây. Đã cập nhật theo lời báo: PT-013 `Xong`, PT-003 (việc còn lại: không còn), mục 2 và mục 6 (dòng 1 và 4 ghi "Oniichan báo đã xong, chưa ghi chi tiết"). PT-005 chưa đổi vì Oniichan chưa ghi kết quả cụ thể. Riêng câu 3: hướng (a) hay (b) Oniichan đã chọn chưa ghi, Neptune sẽ kiểm `git tag` để ghi lại.
- **Câu 5 (PT-010 dọn dẹp): đã xong (2026-11-02).** Oniichan đồng ý "Làm đi" cả 4 bước; Neptune đã thực hiện xong trên VPS (chi tiết ở PT-010), PT-010 `Xong`. Phần còn mở của câu 5 xem bên dưới.
- **Câu 7 (PT-008):** chốt **tắt Swagger khi `NODE_ENV=production`**.
- **Câu 8 (PT-015):** **Oniichan quyết định bỏ PT-015 (2026-11-02)**, không còn cần chọn nơi lưu ngoài máy chủ.
- **Câu 6 (PT-011):** Oniichan xác nhận token Cloudflare cũ **không lộ** ra ngoài VPS (2026-11-02), không cần xoay token; PT-011 `Xong`.
- **PT-012 (khu vực bị bỏ trống):** **Oniichan quyết định bỏ (2026-11-02)**; không làm phần đánh dấu khách thiếu khu vực.
- **PT-014 (hiển thị số phiên bản đang chạy thật):** **Oniichan quyết định bỏ (2026-11-02)**. Phần đưa số phiên bản app vào image Docker chuyển sang PT-027 (xem câu 11).
- **PT-004 (`S3_BUCKET_EXPORTS`):** Oniichan đồng ý trạng thái `Xong một phần` (2026-11-02); phần còn thiếu là cảnh báo trong `06_Production_Deploy.md` mục 2.
- **Câu 9 (PT-023):** chốt 6 quy tắc (ghi ở PT-023); **3 điểm (a)(b)(c) đã chốt ngày 2026-11-03** (câu 9 bên dưới).
- **Câu 17:** chốt tên collection là **`system`** (một collection, lưu cả phiên bản và các biến hệ thống khác); phần baseline còn mở ở câu 17 bên dưới.
- **Câu 19 (PT-023):** Oniichan chốt **cho tự lên "Khách net"** khi 4/4 bỏ một tiêu chí xuống 3/4 (2026-11-02); quy tắc code đã đổi.
- **Câu 20 (PT-023):** Oniichan **chấp nhận** việc trạng thái tùy biến thuộc nhóm `INTERESTED`/`NOT_CONTACTED` bị đè thành `NET` và về `INTERESTED` hệ thống khi hạ (2026-11-02).
- **Câu 21 (`QuickNoteModal`):** Oniichan chốt **nâng lên form đầy đủ**; đã làm (2026-11-02), chờ thử iPhone Safari thật.
- **Câu 22 (ô "Dự án" lịch hẹn):** Oniichan chốt **đổi sang ô chọn có tìm kiếm**; đã làm (2026-11-02).

Còn cần quyết (giữ nguyên số câu để không vỡ tham chiếu; câu đã xong hoặc đã chốt ghi tại chỗ):

1. **Đã xong (Oniichan báo 2026-11-02, Neptune sẽ kiểm lại):** cất `CRM_PII_ENCRYPTION_KEY` vào password manager và xác nhận đủ 44 ký tự (PT-013). Bản `.env.docker` trên máy cá nhân chứa mọi bí mật khác nên giữ kín, không đưa vào repo.
2. **Đã xong (Oniichan báo 2026-11-02, Neptune sẽ kiểm lại):** xóa tunnel trống tên `minio.stnd.vn` (Inactive) trong Cloudflare (PT-003).
3. **Đã xong (Oniichan báo 2026-11-02, Neptune sẽ kiểm lại):** thẻ git `v1.0.2` đặt lên đâu. Oniichan báo đã xong (2026-11-02); hướng đã chọn chưa ghi, Neptune sẽ kiểm `git tag` để ghi lại. Bối cảnh để Neptune kiểm: production chạy `e6099c0` nhưng manifest ở commit đó còn cũ (backend 0.0.1, admin 0.0.0, mobile 1.0.0); hai hướng (a) đặt thẻ lên `e6099c0` và ghi rõ manifest lệch số, (b) đặt thẻ lên commit nâng 1.0.2 rồi triển khai lại; thẻ cục bộ `v1.0.2` từng trỏ `ad59c4b`, thẻ `v1.0.1` trên remote trỏ `932db04` (2026-08-24). **Push thẻ chỉ làm khi Oniichan đồng ý.**
4. **Đã xong (Oniichan báo 2026-11-02, Neptune sẽ kiểm lại):** test đăng nhập web và thao tác AI (PT-005, mục 6). Mục 6 (dòng 1 và 4) đã ghi "Oniichan báo đã xong (2026-11-02), chưa ghi chi tiết"; kết quả cụ thể chưa có và PT-005 chưa đổi.
5. **Dọn dẹp ở PT-010: đã xong (2026-11-02).** Còn mở: nới đĩa VPS (PT-006: đĩa còn khoảng 4,4 GB, vẫn dưới ngưỡng 5 GB nên chặn `deploy.sh` kế tiếp; Oniichan đang chuẩn bị nới đĩa VM VirtualBox 25 -> 50 GB, chưa xong). Ý "ngày hết thời hạn giữ đường lui 5.8" không còn cần (đường lui 5.8 đã không còn).
6. **Đã chốt (2026-11-02):** token Cloudflare tunnel (PT-011) không lộ ra ngoài VPS, không cần xoay; PT-011 `Xong`.
7. **Đã chốt (2026-11-02):** Swagger (PT-008) **tắt khi `NODE_ENV=production`**.
8. **Đã chốt: bỏ PT-015 (Oniichan, 2026-11-02).** Mục PT-015 giữ lại với trạng thái `Bỏ`; không làm backup định kỳ. Lưu ý rủi ro: không có cron backup/chép ra ngoài; chỉ còn backup thủ công và backup tự động trước mỗi lần deploy của `deploy.sh`.
9. **PT-023 (tiến độ tự chuyển trạng thái):** Oniichan đã chốt 6 quy tắc (ghi ở PT-023: 3/4 tiêu chí bất kỳ thì tự chuyển hẳn sang "Khách net"; 4/4 không làm gì; hạ xuống 2/4 thì về "Có quan tâm"; không áp dụng cho "Bỏ"; audit ghi người tick, không cần lý do; không áp dụng cho CSV và hàng loạt). **3 điểm (a), (b), (c) trước đây dùng giả định tạm; Oniichan đã chốt ngày 2026-11-03 (bên dưới). BE đã sửa theo (b) và (c); (a) cũng đã làm ở BE với loại thông báo mới `CUSTOMER_STATUS_AUTO_CHANGED`.** Mã trạng thái thật trong code (`RealEstateBackendApp/src/modules/crm/seed/crm-seed.data.ts`): `NOT_CONTACTED` "Chưa tiếp cận", `INTERESTED` **"Có quan tâm"** (Oniichan gọi là "Khách đang quan tâm"), `NET` "Khách net", `DROPPED` "Bỏ". Hệ thống **chưa có** trạng thái "Khách hẹn" hay "Đã chốt"; Quản trị có thể thêm trạng thái tùy chọn, mỗi trạng thái thuộc một trong 4 nhóm danh sách (`ListGroup`).
   - (a) **Đã chốt 2026-11-03: CÓ thông báo** cho người cùng chăm sóc khi tình trạng bị tự đổi, cả chiều lên `NET` lẫn chiều về `INTERESTED`. Người nhận: những người trong `careTeam` của khách **trừ người thực hiện thao tác tick** (không tự báo cho chính mình); không có người nhận thì không gửi. (Trước đây giả định tạm: không thông báo.) **Đã triển khai ở BE (2026-11-03)** bằng hộp thông báo sẵn có với loại mới `CUSTOMER_STATUS_AUTO_CHANGED` (Neptune duyệt); FE cần hiển thị loại mới (nhãn, trang cài đặt).
   - (b) **Đã chốt 2026-11-03:** hạ dưới 3/4 (2/4, 1/4, 0/4, kể cả từ 4/4) thì tự về `INTERESTED` **bất kể `NET` do ai đặt** (kể cả do người dùng chọn tay), trừ khách `DROPPED`. Tình trạng tùy biến thuộc nhóm `NET` cũng về `INTERESTED` hệ thống (đã chấp nhận ở câu 20). Hệ quả: bỏ điều kiện "do cơ chế này đặt", field `statusAutoSource` trên khách thành mã chết nên đã bỏ (không cần migration, xem mục "Thiết kế PT-023" điểm 1). (Trước đây giả định tạm: chỉ lùi khi `NET` do cơ chế tự động đặt.)
   - (c) **Đã chốt 2026-11-03:** đủ 3/4 thì **đè** sang `NET` bất kể tình trạng hiện tại (`NOT_CONTACTED`, `INTERESTED`, tình trạng tùy biến...), trừ `DROPPED`. Khách đã ở nhóm `NET` thì không đổi gì, không ghi audit, không thông báo. (Trước đây giả định tạm: không lùi, không đè trạng thái cao hơn do người dùng chuyển tay.)
10. **Mức độ của PT-017 đến PT-026** do PM đề xuất: Oniichan rà lại (đặc biệt PT-020, nếu giao diện "Ghi chú" thiếu phần khiến không ghi được nhật ký thì là Major).
11. **PT-027 (phiên bản hệ thống trong DB và tự chạy migration):** có làm trong v1.0.3 không, giữ mức Major (đề xuất) không, và có làm **trước** các nhóm khác không? Đề xuất: có, làm trước, sau khi xử lý PT-006 (đĩa). Thiết kế đã rút còn một collection `system` (PT-027, mục 5).
12. **PT-027, chạy ở đâu:** đề xuất `deploy.sh` gọi runner giữa backup và `up`; backend **không** tự chạy migration và **không** từ chối khởi động, chỉ ghi log cảnh báo nếu còn migration chờ. Đồng ý?
13. **PT-027, có migration chờ lúc deploy:** đề xuất `deploy.sh` mặc định **dừng và in lệnh** (như cổng 005 hiện nay), có cờ `--migrate` mới tự `--apply` sau backup. Hay cho tự `--apply` luôn? **Đã chốt (2026-11-03): tự migrate mặc định BẬT**, `--no-migrate` để tắt, `--migrate` giữ làm bí danh.
14. **PT-027, migration lỗi:** đề xuất runner dừng, ghi lỗi vào `system`, không tự thử lại; sau khi người sửa nguyên nhân, chạy lại `up --apply` sẽ thử lại migration đó (vì chưa vào sổ), nên mọi migration phải chạy lại được an toàn. Đồng ý?
15. **PT-027, `down`/rollback:** đề xuất **không có**; hoàn tác bằng khôi phục từ backup (đúng nguyên tắc "đã đổi dữ liệu thì không quay code cũ"). Đồng ý?
16. **PT-027, tự backup:** đề xuất runner **không** tự backup (`deploy.sh` đã backup trước khi chạy). Đồng ý?
17. **PT-027, tên collection đã chốt là `system`.** Còn mở: **phiên bản baseline** ghi cho production hiện tại, đề xuất `1.0.2`, commit `e6099c0` (liên quan câu 3 về thẻ git); và Oniichan có biết production từng chạy migration 002, 003, 004 chưa? (Không chắc cũng được: devops kiểm chỉ-đọc trước khi chạy `baseline`.) **Cập nhật 2026-11-03:** không còn cần Oniichan khai báo 002..004: `deploy.sh` kiểm bằng probe chỉ-đọc trên dữ liệu thật; `version` ghi là phiên bản app đang deploy (`1.0.3`), không còn baseline `1.0.2` riêng.
18. **PT-022 (bỏ quy tắc 24 giờ), cần xác nhận hai giả định:** (a) quy tắc bỏ áp dụng cho **cả ba thao tác**: sửa nhật ký, xóa nhật ký và gỡ ảnh đã gắn (hiện cả ba cùng dùng cửa sổ 24 giờ). Đề xuất: **cả ba**. (b) Hằng `ErrorCode.CARE_LOG_EDIT_WINDOW_EXPIRED` sau khi bỏ: giữ hay xóa hẳn? Đề xuất: **xóa** vì không còn dùng (báo FE bỏ xử lý mã này nếu có). **Đã áp dụng cả hai giả định (2026-11-02):** bỏ quy tắc cho cả ba thao tác và xóa hẳn mã lỗi; chờ Oniichan xác nhận.
19. **Đã chốt (Oniichan, 2026-11-02): PT-023, khách 4/4 rồi bỏ một tiêu chí.** Câu hỏi: một khách đang ở `INTERESTED` (do từng đổi tay) có đủ 4/4 tiêu chí; sau đó bỏ một tiêu chí xuống 3/4, trước đây hệ thống **không** tự lên `NET` (chỉ lên khi vượt lên đúng 75 từ dưới 75). **Oniichan quyết: CHO TỰ LÊN "Khách net".** **Quy tắc code đã đổi:** tự lên `NET` khi tiến độ **mới = 75** và tiến độ **cũ khác 75** (gồm 100 xuống 75) và trạng thái hiện tại thuộc nhóm `NOT_CONTACTED`/`INTERESTED`. Giữ nguyên: lên 4/4 không làm gì; tụt xuống dưới 75 từ 75 trở lên và `NET` có dấu thì về `INTERESTED`; `DROPPED` không áp dụng; `NET` đổi tay hoặc không có dấu không bị lùi hay đè. Tài liệu 02, 04, 05, 08 và mục PT-023 đã sửa theo.
20. **PT-023, trạng thái tùy biến bị đè:** khách đang ở một trạng thái tùy biến (do Quản trị thêm) thuộc nhóm `INTERESTED` hoặc `NOT_CONTACTED` sẽ bị đè thành `NET` khi đạt 3/4; và khi tiến độ tụt dưới 3/4, hệ thống đưa khách về `INTERESTED` chứ **không** về trạng thái tùy biến cũ. **Đã chốt: Oniichan CHẤP NHẬN (2026-11-02).**
21. **Đã chốt (Oniichan, 2026-11-02): `QuickNoteModal` bản rút gọn.** Câu hỏi: sau PT-020, nút "Ghi chú" ở chi tiết khách mở form đầy đủ ở tab Nhật ký, nhưng `QuickNoteModal` bản rút gọn vẫn còn ở màn Việc hôm nay, danh sách khách và lịch hẹn. **Oniichan quyết: NÂNG LÊN FORM ĐẦY ĐỦ. Đã làm:** `QuickNoteModal` bị xóa, thay bằng `CareLogDialog` (tái dùng `CareLogComposer`; modal trên web, BottomSheet trên app; hỏi xác nhận khi bỏ bản nháp); nhãn menu "Ghi chú nhanh" giữ nguyên. `BottomSheet` dùng `useKeyboardInset` để nâng lên trên bàn phím iOS (các sheet khác cũng hưởng). **Còn lại:** Oniichan thử trên iPhone Safari thật (bàn phím, tải ảnh).
22. **Đã chốt (Oniichan, 2026-11-02): ô "Dự án" ở form tạo lịch hẹn.** Câu hỏi: ô này là `<select>` thường (PT-019 chỉ đổi ô "Dự án quan tâm" của khách). **Oniichan quyết: ĐỔI sang ô chọn có tìm kiếm. Đã làm** bằng `SearchableSelect` (một lựa chọn, tìm không dấu, có "Không chọn"). Mất nhãn nhóm "Khách quan tâm" / "Dự án khác" nhưng dự án khách quan tâm xếp đầu khi chưa gõ; chưa có trạng thái loading/lỗi riêng (như ô cũ).
23. **Đã chốt và đã làm (2026-11-03, theo PT-030): `viewport-fit=cover`.** Trước đó (2026-11-02) `index.html` của web admin thiếu `viewport-fit=cover`; Neptune đã giải thích: chỉ có tác dụng khi dùng như PWA hoặc xoay ngang (vùng an toàn của iPhone), thêm vào thì phải kiểm lại từng màn, nhất là thanh Gọi/Zalo cố định ở đáy mobile, và đề xuất tạm "chưa thêm". Khi Oniichan duyệt làm PWA (PT-030), `viewport-fit=cover` **đã được thêm** vào `index.html` và đã rà, sửa các phần tử cố định/sát mép (danh sách ở mục "Vùng an toàn" của PT-030). Còn lại: Oniichan thử trên iPhone thật (các điểm "chưa chắc" ở PT-030). Lưu ý: các `env(safe-area-inset-*)` có sẵn trước đây chỉ bắt đầu có giá trị thật từ khi có `viewport-fit=cover`.
24. **Sidebar mobile (a11y, có từ trước), chưa có quyết định, giữ mở:** khi đóng, sidebar mobile vẫn nằm trong thứ tự phím Tab. Có muốn xử lý không?

## 8. Definition of Done của v1.0.3

- Mọi mục `PT-NNN` ở trạng thái `Xong`, `Hoãn` có lý do được Oniichan đồng ý, hoặc `Bỏ` (Oniichan quyết định không làm, đã ghi ngày và ghi chú; hiện có PT-012, PT-014 và PT-015); không còn mục `Blocker`.
- Các mục `Major` (PT-005, PT-006, PT-008, PT-013, PT-022, PT-025, PT-026, PT-027 nếu Oniichan giữ mức Major, và mọi lỗi test thật mức Major) đã `Xong` (PT-015 là Major nhưng đã `Bỏ`, được chấp nhận).
- Mục 6 đã được Oniichan điền đủ các dòng áp dụng; mỗi dòng lỗi có mã `PT-NNN`.
- Mỗi mục sửa code có test đi kèm và đã qua `qa-agent` review; mọi mục giao diện (FE) đã thử trên iPhone SE 375x667 và Safari iOS.
- `06_Production_Deploy.md` đã cập nhật theo PT-007 và các thay đổi hạ tầng (PT-001, PT-002, PT-008, PT-009; PT-015 đã `Bỏ` nên không có phần cập nhật).
- PT-022: BE đã bỏ kiểm 24 giờ và mã lỗi `CARE_LOG_EDIT_WINDOW_EXPIRED` (test cập nhật), FE có nút Sửa, tài liệu 04, 05, 08 đã sửa đúng các dòng liệt kê ở mục PT-022; `grep CARE_LOG_EDIT_WINDOW_EXPIRED` trong code và tài liệu hiện hành không còn kết quả (trừ ghi chú lịch sử trong file này). **Tình trạng 2026-11-02:** các điều kiện này đã đạt trong repo; còn Oniichan thử nút Sửa trên máy thật.
- **Tình trạng đáp ứng DoD ngày 2026-11-02:** 16 mục `Xong một phần` chỉ chuyển sang `Xong` khi đã kiểm đúng việc còn lại ghi ở từng mục (kiểm sau deploy trên VPS, hoặc Oniichan thử trên iPhone Safari thật, hoặc việc của Oniichan như baseline PT-027, ghim digest PT-009, runbook PT-016); PT-005 và PT-006 còn `Mới`. Với PT-023, mục 7 câu 9, 19, 20 đã chốt (2026-11-02, 2026-11-03); còn FE hiển thị loại thông báo mới và Oniichan thử trên máy thật; khi làm nhập CSV (M8) phải giữ quy tắc "CSV không kích hoạt tự đổi tình trạng".
- PT-023: tài liệu 04 (quy tắc nghiệp vụ; field `statusAutoSource` trên khách đã bỏ 2026-11-03, chỉ còn dấu trong audit) và 05 (response `autoStatusChange` của `PATCH /crm/customers/:id/criteria`) đã cập nhật; không còn chỗ nào khẳng định tiến độ không tự đổi tình trạng.
- Nếu Oniichan duyệt PT-027: 6 tiêu chí nghiệm thu của mục đó đã đạt (qua `qa-agent`), gồm việc Dockerfile đưa số phiên bản app vào image (PT-014 đã `Bỏ`, phần này thuộc PT-027); lần deploy 1.0.3 đầu tiên trên production đã tự baseline thành công (Oniichan chạy `bash deploy.sh --plan-only` xem probe trước, rồi `bash deploy.sh --no-pull`); checklist phát hành ở [`README.md`](README.md) mục 5 đã bổ sung bước migration.
- Số phiên bản đã nâng lên 1.0.3 trong `package.json` và lockfile của ba ứng dụng, và trong `app.json` (chỉ `RealEstateApp` có file này); bảng ở [`README.md`](README.md) đã cập nhật; tài liệu đổi nội dung đã cập nhật dòng "Phiên bản tài liệu".

[← Về mục lục phiên bản](README.md)
