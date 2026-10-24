# Theo dõi milestone: Module Quản lý & chăm sóc khách hàng (CRM)

> Cập nhật lần cuối: **2026-10-24 (M4 xong dev, đã sửa theo QA vòng 1, chờ QA vòng 2)**. Thiết kế chi tiết từng milestone ở [`04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) mục 10; quyết định đã chốt ở mục 11 của tài liệu 04; API ở [`05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`](05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md) (116 endpoint).
> Ký hiệu trạng thái: `[ ]` Chưa làm · `[~]` Đang làm · `[x]` Xong.

## 1. Chia giai đoạn

| Giai đoạn | Mục tiêu | Milestone |
|---|---|---|
| **Giai đoạn 1** | Backend lõi đầy đủ nghiệp vụ **và Web Admin ghép API thật** (sau khi duyệt UI), chạy bằng hộp thông báo trong app, **chưa có push FCM** | M0 – M6 |
| **Giai đoạn 2** | Push FCM, import/export và dashboard, app di động, hardening, import 3 sheet cũ, ghi âm, Zalo | M7 – M12 |

**Đánh số lại:** Web Admin ghép API thật (M8 cũ) nay là **M6**, thuộc giai đoạn 1. Push FCM (M6 cũ) thành **M7**; Import/Export & Dashboard (M7 cũ) thành **M8**; M9–M12 giữ nguyên.

Hạ tầng đã chốt (D5): MongoDB Replica Set, **Redis + BullMQ**, MinIO/S3. Firebase/FCM có trong thiết kế nhưng chỉ để cấu hình/placeholder ở giai đoạn 1.

## 2. Bảng milestone

| ID | GĐ | Nội dung | Agent | Phụ thuộc | Tiêu chí xong | Trạng thái | Bắt đầu | Kết thúc | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|
| M0 | 1 | Nền tảng: Replica Set, Redis + BullMQ, MinIO + `FileStorageService`, `PiiCryptoService` + khóa mã hóa CCCD, Idempotency sang Redis, mở rộng `GlobalExceptionFilter`, Helmet, feature flag, health liveness/readiness | devops-agent, coder-backend-agent | — | Health readiness xanh; transaction chạy trong test | [x] Xong (dev) | 2026-10-23 | 2026-10-23 | QA vòng 2 đạt: build OK, 975 test pass (20 fail có sẵn ở 3 suite AI cũ), 31/31 integration. Compose dev `RealEstateBackendApp/docker-compose.dev.yml` (Redis + MinIO; Mongo dùng container `mongodb` có sẵn, `directConnection=true`). **Stack deploy gốc chưa có Redis/S3/Replica Set: xem M10, không deploy trước khi xong.** Việc nhỏ còn theo dõi: Throttler lưu Redis, sanitize NoSQL injection, Winston che PII (M1–M2); AAD bắt buộc cho CCCD từ M2; idempotency key scope theo user từ M2 |
| M1 | 1 | Người dùng, nhóm, danh mục, dự án: enum `MANAGER`/`STAFF`, `teams`, `assignable-users`, `customer-statuses` (4 listGroup), nguồn, kết quả liên hệ, khu vực, dự án (CRUD đầy đủ + ngừng hoạt động + khôi phục) + seed | coder-backend-agent | M0 | CRUD + Swagger + unit test | [x] Xong (dev) | 2026-10-23 | 2026-10-23 | QA đạt vòng 2 (build OK, 1059 test pass + 20 fail cũ ở 3 suite AI, integration 126/126 gồm M0 31/31). Đã sửa B1 (`RolesGuard` default-deny, `@AnyRole()`), `@AdminOnly()` đọc DB, `seedKey`, khóa chống race, audit đổi role/status, chặn ADMIN cuối cùng. Việc để lại: route ADMIN-only ngoài CRM (knowledge-articles, settings, external-log, cron) còn tin role trong JWT (tối đa 15 phút); GET danh mục CRM còn dựa JWT; `POST /users` trùng email đồng thời có thể 500; bản seed cũ đổi tên trước khi có `seedKey` có thể seed trùng 1 lần; chạy migration 004 `--apply` và bật `FEATURE_CRM_ENABLED` khi deploy |
| M2 | 1 | Khách hàng lõi: `CustomerScope`, CRUD (có email), phone-lookups, **phone-views (`PHONE_VIEWED`)**, list 5 tab, đổi tình trạng, tiêu chí, CCCD, consent, soft delete/restore/anonymize, audit + histories | coder-backend-agent → qa-agent | M1 | E2E ma trận quyền; p95 danh sách đạt trên 10k seed | [x] Xong (dev) | 2026-10-23 | 2026-10-24 | QA vòng 3 đạt, không còn blocker (195 test tích hợp pass). 20 endpoint khách lõi (bulk thuộc M3); đồng bộ `customers.teamIds` khi đổi nhóm/vai trò; mã lỗi mới `CUSTOMER_ANONYMIZED`. **Kiểm tải** là suite riêng `crm-m2-perf.integration.spec.ts`, không nằm trong `npm run test:integration`: chạy `npm run test:perf` khi máy rảnh (tuần tự, ngưỡng thật 300/150/200 ms; `PERF_ASSERT_FACTOR` để nới khi máy tải). **Việc để lại:** (1) M3/M4 phải thêm mẫu vào `PII_AUDIT_FIELD_PATTERNS` và bước dọn nhật ký/chân dung vào luồng ẩn danh hóa; (2) tìm kiếm regex sát 300 ms với ADMIN ở 10k khách, ≥ 50k khách cần text index/Atlas Search, chốt ở M10; (3) trustProxy/IP sau cloudflared: M10; (4) bộ đếm phụ cho dò đuôi 4-5 số (~100 từ khóa/giờ): backlog; (5) idempotency chưa băm body; (6) `listDeleted` chưa `guardSearch`; (7) test đa instance: smoke test ở M10; (8) tag/persona (M4) và thông báo cảnh báo bất thường cho Quản trị (M5) |
| M3 | 1 | Chăm sóc: care-team, care-team-requests, nhật ký + ảnh đính kèm, bulk operations | coder-backend-agent → qa-agent | M2 | Đúng 1 PRIMARY có test; NV bị gỡ ⇒ 404; ảnh gắn đúng ghi chú | [x] Xong (dev) | 2026-10-23 | 2026-10-24 | QA 2 vòng đạt (237 test tích hợp pass; S1 lọc ảnh theo danh sách cho phép, S2 kiểm người được nâng PRIMARY). **Trước khi bật `FEATURE_CRM_ATTACHMENTS` ở production: thử lại với ảnh điện thoại có GPS thật.** 14 endpoint mới: care-team (4), care-team-requests (3), care-logs (4), ảnh đính kèm (2), bulk (1); `phone-lookups.hasPendingRequest` đọc model thật. Collection `care_team_requests`, `care_logs` (giữ `contactResultId`), `crm_attachments`. Đúng 1 PRIMARY có unit test chuỗi ngẫu nhiên + integration (đồng thời, write-skew với đổi nhóm người dùng); `teamIds` đồng bộ; ẩn danh hóa xóa nội dung nhật ký/ảnh/lời nhắn đề nghị và ghi đè audit `careLog.*`. **Lệch tài liệu:** chưa có ImageProcessor/thumbnail (bỏ Exif/GPS đồng bộ, `thumbUrl` = `url`, ảnh vào thẳng `READY`, dọn ảnh mồ côi bằng `@Cron` mỗi giờ, chờ BullMQ ở M5); `nextAction.appointment` chưa nhận (M5); bulk `ADD_TAGS`/`REMOVE_TAGS` trả 400 đến M4; chưa có thông báo/push (M5). Thêm dependency `@fastify/multipart`. Khi deploy: bật `FEATURE_CRM_ATTACHMENTS`, tạo bucket `crm-attachments` |
| M4 | 1 | Chân dung & thẻ: persona-fields + seed (gồm nhóm REAL_ESTATE), persona khách, completeness + job recompute, tags | coder-backend-agent → qa-agent | M2 | Đổi cấu hình trường không mất dữ liệu cũ | [x] Xong (dev) | 2026-10-24 | 2026-10-24 | Chờ QA review. 11 endpoint mới: persona-fields (5), tags (4), persona khách (2); đã nối `tagIds` vào tạo/sửa khách, `tags` vào list/detail, bộ lọc `tagIds`/`occupation`/`personaFilters`, bulk `ADD_TAGS`/`REMOVE_TAGS` (theo phạm vi). Test: unit mới (rules chân dung, tên thẻ, mapper) + integration `crm-m4.integration.spec.ts` và `crm-m4-qa.integration.spec.ts` (ma trận quyền theo phạm vi, đổi cấu hình không mất dữ liệu có chứng minh, đua đổi kiểu/gắn thẻ vs xóa thẻ, bulk + `X-Idempotency-Key`, ẩn danh hóa dọn persona/thẻ). Toàn bộ sau QA vòng 1: 1173 unit pass (20 fail cũ ở 3 suite AI), 296/296 integration (14 suite). **Lệch tài liệu:** (1) job recompute chạy nền trong tiến trình (chưa BullMQ) bằng dấu `personaConfigVersion` nên tự nhặt phần dở khi khởi động lại, xem 04 mục 3.2.2; (2) xóa/gộp thẻ gỡ khỏi khách đồng bộ trong một transaction, không phải job nền; (3) `GET persona` trả thêm `version`; (4) seed 25 trường (prototype + `hobbies`, `lifestyle`), seed persona là `PersonaSeedService` riêng; (5) key trường/tên thẻ trùng dùng `CATALOG_DUPLICATED`; (6) giới hạn 30 thẻ/khách và 30 lần tạo thẻ/phút/người. **Việc để lại:** (a) xóa/gộp thẻ có số khách rất lớn trong 1 transaction: chuyển sang BullMQ ở M5 nếu cần; (b) chưa có job đối soát `usageCount`, trường mới thêm vào seed ở bản sau không tự tính lại độ đầy đủ khách cũ (tự cập nhật khi sửa chân dung hoặc đổi cấu hình trường); (c) `occasions` mới chỉ được ghi, scheduler quét thuộc M5; (d) kiểm hiệu năng lọc thẻ/chân dung trên dữ liệu lớn ở M10; (e) `personaFilters` chưa hỗ trợ giá trị chứa dấu phẩy; (f) **backlog M10 (QA M4):** SF-7 nghẽn `refLock`/`usageCount` khi nhiều người cùng sửa một trường chân dung hoặc cùng gắn một thẻ (khoảng 250 ms/lượt, các giao dịch xếp hàng do xung đột ghi trên một document): chia nhỏ khóa (shard) hoặc đếm lúc đọc; N4, N6 (gồm thiếu index `persona.fieldKey` cho đếm `valueCount` khi đổi kiểu trường). **Khi deploy:** không cần migration (trường mới có mặc định), cần tạo index mới (`tagIds`, `personaFilterKeys`, `occasions`, `tags`, `persona_fields`; Mongoose tự tạo nếu autoIndex bật), seed tự chạy khi bật `FEATURE_CRM_ENABLED`, không thêm biến môi trường |
| M5 | 1 | Lịch hẹn (có loại ký cọc / HĐMB), daily-tasks, nhắc việc BullMQ, hộp thông báo trong app, notification-preferences, `NoopPushProvider` | coder-backend-agent → qa-agent | M3 | Nhắc đúng hạn, không trùng khi restart | [ ] Chưa làm | | | Không gồm push FCM, không gồm `device_tokens` |
| M6 | 1 | Web Admin ghép API thật (thay mock store), ghép từng API khi M1–M5 xong; phần chưa có API (đẩy thông báo, import/export, dashboard) dùng mock bọc sau cờ cấu hình | coder-frontend-agent → qa-agent | **Oniichan duyệt UI** (điều kiện bắt đầu), API M1–M5 theo từng màn | Mọi màn thuộc M1–M5 chạy API thật, không còn mock store ở các màn này; Báo cáo, nhập/xuất, đẩy thông báo còn mock có cờ và ghi rõ; Skeleton loading; lỗi tiếng Việt; qa-agent review | [ ] Chưa làm | | | Oniichan đã duyệt UI prototype (2026-10-23); bắt đầu khi API M1–M5 xong, ghép theo từng màn; không chờ M7/M8 |
| M7 | 2 | Push FCM: `FcmPushProvider`, `device_tokens`, Firebase + APNs key, bật `FEATURE_CRM_PUSH` | devops-agent, coder-backend-agent → qa-agent | M5, Firebase | Push thật đến iOS + Android | [ ] Chưa làm | | | Cần Oniichan chuẩn bị Firebase (mục 5) |
| M8 | 2 | Import/Export chung và Dashboard; gỡ mock có cờ của Báo cáo và nhập/xuất ở Web Admin | coder-backend-agent, coder-frontend-agent → qa-agent | M2, M3 | Import thử CSV tự tạo; số liệu dashboard khớp | [ ] Chưa làm | | | Không gồm mẫu 3 sheet cũ; sau khi xong thì Web Admin gỡ mock các màn này |
| M9 | 2 | App di động Expo (iOS/Android) | coder-frontend-agent → qa-agent | M6, M7 | TestFlight + Android internal testing | [ ] Chưa làm | | | |
| M10 | 2 | Hardening: k6, security review, backup/restore, bật flag production; **cập nhật stack deploy gốc `docker-compose.yml`**: thêm Redis + MinIO, chuyển Mongo standalone sang Replica Set (có kế hoạch backup và Oniichan xác nhận trước), bổ sung biến vào `.env.docker` | qa-agent, devops-agent | Tất cả GĐ2 trước | Quality Gates đạt; stack deploy chạy được backend mới (health readiness xanh) | [ ] Chưa làm | | | Phải xong **trước khi deploy staging/production** bất kỳ bản backend có M0 trở lên; compose dev `RealEstateBackendApp/docker-compose.dev.yml` chỉ dành cho máy dev |
| M11 | 2 | Import 3 sheet cũ DSKH / DSKH_DROP / DSKH_NET (D7) | coder-backend-agent → qa-agent | M8, **file mẫu thật** | Import thử với file thật khớp từng cột | [ ] Chưa làm | | | Hoãn theo quyết định D7 |
| M12 | 2 | Ghi âm có đồng ý (AudioProtect) và Zalo | architect-agent trước, rồi coder | M10 | Thiết kế chi tiết được duyệt | [ ] Chưa làm | | | Phác thảo ở 04 mục 8 |

## 3. Tiến độ frontend (prototype trên mock store)

| Đợt | Nội dung | Trạng thái | Ghi chú |
|---|---|---|---|
| Đợt 0 – 3 | Làm lại prototype CRM `RealEstateAdminApp/src/modules/crm` theo tài liệu 01, lớp `api/` đặt tên theo endpoint tài liệu 05, chạy trên mock store; sửa lỗi QA (xem commit) | [x] Xong | Commit `f852f6c`: 38 file / 330 test CRM pass. Module chỉ bật ở dev hoặc `VITE_CRM_PROTOTYPE=true`. Chi tiết từng đợt không ghi lại ở đây, xem commit |
| Cập nhật theo quyết định 2026-10-22 (đã vào prototype) | Prototype đã sửa theo nhật ký quyết định #1–#36 (bỏ mã khách hàng nếu còn, tách "Đang chăm sóc" thành 2 tab, tab Tất cả mặc định, thành viên xem/gọi SĐT + log, tách preset 3 sheet cũ, đủ CRUD dự án với mã dự án bắt buộc, email, ảnh, loại ký cọc/HĐMB, SĐT đầy đủ trong file xuất) | [x] Xong | 455 test; đã qua QA vòng 1 và vòng 2 (vòng 2 đang sửa lỗi, chưa đóng). Rủi ro dò số qua tìm kiếm SĐT thuộc backend (04 mục 12) |
| QA prototype | Vòng 1 xong; vòng 2 [~] đang sửa lỗi | [~] Đang làm | Kết quả QA vòng 2 đã đưa vào tài liệu 04 (dò số qua tìm kiếm, migration dự án) |
| Ghép API thật | Xem M6 (giai đoạn 1) | [ ] Chưa làm | Sau khi duyệt UI; phần chưa có API dùng mock có cờ |

## 4. Việc đang chạy

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| Chốt quyết định 2026-10-22 vào tài liệu 01, 02, 04, 05, 06, README (nhật ký #1–#36, chia giai đoạn, bảng milestone) | [x] Xong phần tài liệu | Còn lại: giao coder-frontend-agent sửa prototype theo tài liệu |

## 5. Việc Oniichan cần chuẩn bị

| Việc | Khi nào cần | Ghi chú |
|---|---|---|
| Tạo dự án **Firebase** (FCM), tải khóa APNs cho iOS | Trước M7 (giai đoạn 2) | Giai đoạn 1 chưa cần |
| **File mẫu thật** của 3 sheet DSKH, DSKH_DROP, DSKH_NET | Trước M11 (D7) | Để chốt cột, định dạng ngày, cách ghi nhân viên |
| ~~Duyệt UI prototype~~ | Xong 2026-10-23 | Oniichan đã duyệt; M6 bắt đầu khi API M1–M5 xong |
| Tài khoản MinIO/S3, khóa mã hóa CCCD (`CRM_PII_ENCRYPTION_KEY`) cho môi trường thật | Trước triển khai staging/production | Dev dùng giá trị cục bộ, không đưa vào repo |

## 6. Quyết định

### 6.1 Đã chốt chiều 2026-10-22 (nhật ký #29–#36 ở tài liệu 04 mục 11)

- Tab mặc định danh sách khách là "Tất cả".
- Xóa dự án là xóa mềm + khôi phục; dự án đang có khách thì chỉ ngừng hoạt động.
- Mã dự án bắt buộc (chữ, số, `-`, `_`, tối đa 20 ký tự); trạng thái dự án là enum UPCOMING/SELLING/SOLD_OUT; có khoảng giá.
- SĐT trong file xuất là đầy đủ (không có CCCD đầy đủ); kiểm quyền và ghi audit mỗi lần xuất.
- Lịch sử thay đổi hiển thị SĐT cũ → mới đầy đủ cho người xem được khách; `PHONE_VIEWED` không lưu số.
- List/detail chỉ trả `phoneMasked`, số đầy đủ qua `phone-views` có log.
- Giữ cả 10 trường đầu tư; Kanban chỉ ở Việc hôm nay.
- Tài liệu giao diện (02) đã cập nhật theo các quyết định này.

### 6.2 Còn mở

| Điểm | Ghi chú |
|---|---|
| Trường bổ sung của Dự án | Hiện bộ trường tối thiểu; thêm sau là tương thích ngược |
| Mẫu cột 3 sheet cũ (D7) | Cần file mẫu thật, làm ở M11 |

### 6.2b Rủi ro theo dõi (hiệu năng tìm kiếm)

- Tìm kiếm khách là regex trên `searchText`, quét toàn phạm vi của người gọi: ADMIN với 10k khách khoảng 200-300 ms (sát mục tiêu p95 300 ms của doc 04 mục 7.1). Khi từ ≥ 50k khách cần text index hoặc Atlas Search; chốt ở M10 (k6). Test kiểm tải M2 (`npm run test:perf`, tách khỏi `test:integration`) assert theo ngưỡng thật, có thể nới bằng `PERF_ASSERT_FACTOR=2` khi máy tải; lần chạy cuối trên máy bận có 3/7 đỏ, cần đo lại trên máy rảnh.

### 6.3 Ý tưởng giai đoạn sau

- Kanban theo tình trạng ở danh sách khách (kéo thả đổi tình trạng).

[← Về chỉ mục module](README.md)
