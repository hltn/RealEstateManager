# Theo dõi milestone: Module Quản lý & chăm sóc khách hàng (CRM)

> Cập nhật lần cuối: **2026-10-22 (chiều)**. Thiết kế chi tiết từng milestone ở [`04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) mục 10; quyết định đã chốt ở mục 11 của tài liệu 04; API ở [`05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`](05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md) (116 endpoint).
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
| M0 | 1 | Nền tảng: Replica Set, Redis + BullMQ, MinIO + `FileStorageService`, `PiiCryptoService` + khóa mã hóa CCCD, Idempotency sang Redis, mở rộng `GlobalExceptionFilter`, Helmet, feature flag, health liveness/readiness | devops-agent, coder-backend-agent | — | Health readiness xanh; transaction chạy trong test | [ ] Chưa làm | | | Docker compose hiện chạy Mongo standalone, cần chuyển Replica Set |
| M1 | 1 | Người dùng, nhóm, danh mục, dự án: enum `MANAGER`/`STAFF`, `teams`, `assignable-users`, `customer-statuses` (4 listGroup), nguồn, kết quả liên hệ, khu vực, dự án (CRUD đầy đủ + ngừng hoạt động + khôi phục) + seed | coder-backend-agent | M0 | CRUD + Swagger + unit test | [ ] Chưa làm | | | |
| M2 | 1 | Khách hàng lõi: `CustomerScope`, CRUD (có email), phone-lookups, **phone-views (`PHONE_VIEWED`)**, list 5 tab, đổi tình trạng, tiêu chí, CCCD, consent, soft delete/restore/anonymize, audit + histories | coder-backend-agent → qa-agent | M1 | E2E ma trận quyền; p95 danh sách đạt trên 10k seed | [ ] Chưa làm | | | Kiểm tải sơ bộ nằm ở đây |
| M3 | 1 | Chăm sóc: care-team, care-team-requests, nhật ký + ảnh đính kèm, bulk operations | coder-backend-agent → qa-agent | M2 | Đúng 1 PRIMARY có test; NV bị gỡ ⇒ 404; ảnh gắn đúng ghi chú | [ ] Chưa làm | | | |
| M4 | 1 | Chân dung & thẻ: persona-fields + seed (gồm nhóm REAL_ESTATE), persona khách, completeness + job recompute, tags | coder-backend-agent → qa-agent | M2 | Đổi cấu hình trường không mất dữ liệu cũ | [ ] Chưa làm | | | |
| M5 | 1 | Lịch hẹn (có loại ký cọc / HĐMB), daily-tasks, nhắc việc BullMQ, hộp thông báo trong app, notification-preferences, `NoopPushProvider` | coder-backend-agent → qa-agent | M3 | Nhắc đúng hạn, không trùng khi restart | [ ] Chưa làm | | | Không gồm push FCM, không gồm `device_tokens` |
| M6 | 1 | Web Admin ghép API thật (thay mock store), ghép từng API khi M1–M5 xong; phần chưa có API (đẩy thông báo, import/export, dashboard) dùng mock bọc sau cờ cấu hình | coder-frontend-agent → qa-agent | **Oniichan duyệt UI** (điều kiện bắt đầu), API M1–M5 theo từng màn | Mọi màn thuộc M1–M5 chạy API thật, không còn mock store ở các màn này; Báo cáo, nhập/xuất, đẩy thông báo còn mock có cờ và ghi rõ; Skeleton loading; lỗi tiếng Việt; qa-agent review | [ ] Chưa làm | | | Chờ duyệt UI prototype; không chờ M7/M8 |
| M7 | 2 | Push FCM: `FcmPushProvider`, `device_tokens`, Firebase + APNs key, bật `FEATURE_CRM_PUSH` | devops-agent, coder-backend-agent → qa-agent | M5, Firebase | Push thật đến iOS + Android | [ ] Chưa làm | | | Cần Oniichan chuẩn bị Firebase (mục 5) |
| M8 | 2 | Import/Export chung và Dashboard; gỡ mock có cờ của Báo cáo và nhập/xuất ở Web Admin | coder-backend-agent, coder-frontend-agent → qa-agent | M2, M3 | Import thử CSV tự tạo; số liệu dashboard khớp | [ ] Chưa làm | | | Không gồm mẫu 3 sheet cũ; sau khi xong thì Web Admin gỡ mock các màn này |
| M9 | 2 | App di động Expo (iOS/Android) | coder-frontend-agent → qa-agent | M6, M7 | TestFlight + Android internal testing | [ ] Chưa làm | | | |
| M10 | 2 | Hardening: k6, security review, backup/restore, bật flag production | qa-agent, devops-agent | Tất cả GĐ2 trước | Quality Gates đạt | [ ] Chưa làm | | | |
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
| Duyệt UI prototype | Trước M6 (giai đoạn 1) | Điều kiện bắt đầu ghép API thật; nên duyệt trong lúc backend làm M0–M2 để M6 bắt đầu ngay khi có API |
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

### 6.3 Ý tưởng giai đoạn sau

- Kanban theo tình trạng ở danh sách khách (kéo thả đổi tình trạng).

[← Về chỉ mục module](README.md)
