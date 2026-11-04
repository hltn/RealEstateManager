# Kế hoạch: Phiên bản v1.0.4 (Web Push (VAPID) cho PWA, backlog QA M0–M6, lỗi mới)

> **Phiên bản tài liệu:** v1.0.4

> Ngày tạo: 2026-11-04
> Module: Quản lý phiên bản / CRM (giai đoạn 2, milestone M7) / Hạ tầng
> Trạng thái: Draft
> Author: pm-agent

> **Bảo mật:** tài liệu này chỉ ghi **tên biến**, không ghi giá trị bí mật (khóa riêng VAPID, token, mật khẩu).

---

## 1. Mục tiêu & Phạm vi

### 1.1 Mục tiêu nghiệp vụ

**Bối cảnh hiện tại (đọc từ tài liệu, ngày 2026-11-04):**

- **Production đang chạy v1.0.3** (lên production 2026-11-04; trước đó v1.0.2 từ 2026-11-02). Stack mới (Mongo replica set `rs0` có xác thực, Redis, MinIO, 9Router, `deploy.sh`; CRM giai đoạn 1 M0–M6 đã lên; ảnh đính kèm CRM đã bật 2026-11-02).
- **v1.0.3 đã xong hết** (Oniichan xác nhận 2026-11-04: 28 mục Xong, 3 mục Bỏ; đã deploy production, gồm cả kiểm trên iPhone/Android thật, VPS, AI qua 9Router, nới đĩa). Hạ tầng cần cho v1.0.4 (đĩa VPS, runner migration, `deploy.sh`) coi là đã đáp ứng.
- **CRM giai đoạn 1 (M0–M6) đã xong dev**, chạy bằng hộp thông báo trong app; **chưa có push** (chỉ `PushProvider` + `NoopPushProvider`, `FEATURE_CRM_PUSH=false`, `device-tokens` chưa làm). Cột Ghi chú của bảng milestone còn nhiều "việc để lại" và backlog QA.

**v1.0.4 nhằm 2 mục tiêu (Oniichan chốt 2026-11-04):**

1. **Giao tính năng giai đoạn 2 duy nhất: M7 Web Push (VAPID) cho PWA** (Oniichan chốt 2026-11-04), để thông báo CRM (nhắc lịch hẹn, phân khách, cảnh báo bảo mật...) đến được **iPhone (Safari, iOS 16.4 trở lên, đã Thêm vào Màn hình chính) và Android (Chrome)** đã cài web admin dạng PWA khi không mở web. Dùng Web Push chuẩn (cặp khóa VAPID), không dùng Firebase/FCM, không cần APNs hay Apple Developer.
2. **Dọn backlog QA của M0–M6** (FR-14 đến FR-37, tức PT-037 đến PT-060: bảo mật/PII, hiệu năng nhỏ, lệch tài liệu), ưu tiên các việc là điều kiện an toàn trước khi bật push; cộng với **lỗi mới Oniichan sẽ nêu sau** (đã có PT-032 đến PT-036; mã PT tiếp theo `PT-061`).

### 1.2 Người dùng / Stakeholder

| Vai trò | Nhu cầu |
|---|---|
| Nhân viên / Quản lý nhóm (STAFF, MANAGER) | Nhận thông báo kịp thời trên điện thoại đã cài PWA (được phân khách, đến hạn lịch hẹn, có nhật ký mới); tự bật/tắt từng loại và đặt giờ yên lặng |
| Quản trị (ADMIN) | Nhận cảnh báo bảo mật (xem SĐT/CCCD bất thường); bật/tắt push toàn hệ thống bằng cờ; không lộ dữ liệu khách ra dịch vụ bên ngoài |
| Oniichan (chủ hệ thống) | Cho phép tạo/lưu khóa VAPID trên VPS (`subject` đã chốt `mailto:info@stnd.vn`); chạy deploy trên VPS; thử máy thật iPhone và Android; bổ sung lỗi mới |
| `devops-agent` | Cấu hình bí mật, cờ, runbook khóa VAPID, deploy |
| `qa-agent` | Review code/test, kiểm chứng DoD từng mốc |

### 1.3 Trong phạm vi / Ngoài phạm vi

- **Trong phạm vi:**
  - M7 Web Push (VAPID) cho PWA: backend (`WebPushProvider`, lưu push subscription, job gửi), hạ tầng khóa VAPID, bật cờ, và phía web admin PWA (service worker xử lý push và click, đăng ký/hủy subscription, nút bật/tắt thông báo ở Cài đặt).
  - Backlog QA M0–M6 theo 3 mức ưu tiên (mục 2.2).
  - Lỗi mới do Oniichan nêu sau (mục 2.3).
- **Ngoài phạm vi (để các phiên bản sau):**
  - **M8** Import/Export chung + Dashboard (và gỡ mock Báo cáo/nhập xuất): không liên quan push, làm sau để v1.0.4 gọn; khi làm phải giữ quy tắc "CSV không kích hoạt tự đổi tình trạng" (PT-023).
  - **M9** App di động Expo/native: phụ thuộc M6; là bản riêng sau. **Push cho app native (FCM, APNs, tài khoản Apple Developer) dời sang M9**, không làm ở v1.0.4.
  - **Ngoài phạm vi M7 (Oniichan chốt 2026-11-04):** Firebase/FCM, APNs và Apple Developer, app Expo/native, push cho app di động native.
  - **M10** Hardening: k6, security review đầy đủ, backup/restore, bật cờ production. Các việc **chỉ thuộc M10 và không cần cho M7**, nên hoãn: k6 và kiểm tải (Việc hôm nay, lọc thẻ/chân dung), text index/Atlas Search khi từ 50.000 khách, chia nhỏ khóa `refLock`/`usageCount` (SF-7), smoke test đa instance, job đối soát `usageCount`/độ đầy đủ chân dung và cửa sổ crash của seed chân dung, chuyển job tính lại chân dung/xóa-gộp thẻ lớn sang BullMQ. Lý do: hiện chạy 1 instance, chưa chạm ngưỡng; làm khi dữ liệu/tải tăng.
  - **M11** Import 3 sheet cũ (chờ file mẫu thật) và **M12** Ghi âm + Zalo.
  - Các mục v1.0.3 Oniichan đã `Bỏ` (PT-012, PT-014, PT-015): không mở lại.

## 2. Tính năng

> **Quy ước hai mã:** `FR-xx` là mã yêu cầu để truy vết qua Architecture/Tasks/test (bắt buộc theo quy trình `/spec-*`); `PT-xxx` là mã sổ lỗi nối tiếp từ file v1.0.3 (`01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md`), áp dụng cho mọi dòng Sửa lỗi; dòng Tính năng chỉ có FR. Ở bảng sửa lỗi cột `Mã PT` đứng trước cột `Mã FR`; trong văn bản ghi dạng `FR-14 (PT-037)`.
>
> Cột `Mã FR` (FR-01, FR-02…) duy nhất trong Plan. `Loại`: Tính năng / Sửa lỗi. `Nguồn`: milestone (M0–M7) hoặc mã PT-xxx.

### 2.1 Tính năng giai đoạn 2: M7 Web Push (VAPID) cho PWA

> "Device token" của thiết kế cũ nay là **push subscription** của trình duyệt (endpoint + khóa `p256dh`/`auth`). Tên endpoint, schema và trường (đang là `/device-tokens`, `device_tokens`, `platform`) **do `architect-agent` quyết**, Plan chỉ nêu yêu cầu.

| Mã FR | Loại | Tính năng | Ưu tiên (Phải có / Nên có / Tùy chọn) | Nguồn |
|---|---|---|---|---|
| FR-01 | Tính năng | Đăng ký/hủy push subscription của trình duyệt: lưu endpoint + khóa `p256dh`/`auth` theo người dùng, upsert theo endpoint; có API đăng ký, hủy và `POST /auth/logout` kèm id subscription. Tên endpoint/schema/trường (hiện thiết kế là `POST /device-tokens`, `DELETE /device-tokens/:id`, `device_tokens`) và việc thay `platform` (IOS/ANDROID/WEB) bằng thông tin trình duyệt/thiết bị nếu cần: **để `architect-agent` quyết** | Phải có | M7; tài liệu 04 mục 3, 05 mục 2.10 |
| FR-02 | Tính năng | `WebPushProvider` (thay `FcmPushProvider`) gửi bằng thư viện Web Push chuẩn với khóa VAPID tới iPhone (PWA đã cài) và Android (PWA/Chrome), thay `NoopPushProvider` khi bật cờ; timeout 5 giây | Phải có | M7 |
| FR-03 | Tính năng | Luồng gửi push bằng job BullMQ sau khi transaction nghiệp vụ commit: đọc cài đặt thông báo (`push` từng loại), giờ yên lặng, ghi `pushStatus` (SENT/SKIPPED/FAILED), retry backoff có jitter tối đa 5 lần, không gửi trùng | Phải có | M7; tài liệu 04 mục 6.3 |
| FR-04 | Tính năng | Xử lý subscription hết hạn/không còn hợp lệ: dịch vụ push trả HTTP 404/410 thì thu hồi (`revokedAt`), không thử lại subscription đó | Phải có | M7 |
| FR-05 | Tính năng | Dọn subscription lâu không dùng (theo `lastSeenAt`) bằng job lặp | Tùy chọn | M7 (đề xuất bổ sung) |
| FR-06 | Tính năng | Nội dung push an toàn PII: payload chỉ gồm tiêu đề/nội dung ngắn theo mẫu, loại thông báo và deep link; có test chặn SĐT, CCCD, nội dung nhật ký | Phải có | M7; tài liệu 04 mục 8 (QT10) |
| FR-07 | Tính năng | Cấu hình và bí mật VAPID: cặp khóa VAPID tạo một lần; biến môi trường đề xuất `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (tên chính xác do `devops-agent` chốt; **giá trị đã chốt `VAPID_SUBJECT=mailto:info@stnd.vn`**, không bí mật nên được ghi trong tài liệu); khóa riêng chỉ ở biến môi trường/secret trên VPS (không vào repo/image), khóa công khai đưa cho FE; bật `FEATURE_CRM_PUSH` qua compose/`.env.docker`; cờ tắt thì quay về Noop; health/readiness không sập khi dịch vụ push lỗi | Phải có | M7 |
| FR-08 | Tính năng | Runbook khóa VAPID trong `06_Production_Deploy.md` (tạo cặp khóa một lần, đặt `subject` đã chốt `mailto:info@stnd.vn`, đặt biến trên VPS, đưa khóa công khai cho FE, thử gửi 1 push, cách tắt khẩn cấp, cách xoay khóa và hệ quả: đổi khóa thì subscription cũ mất hiệu lực, người dùng phải bật lại) | Phải có | M7; milestone mục 5 |
| FR-09 | Tính năng | Phía web admin PWA: (a) service worker xử lý sự kiện `push` (hiện thông báo) và `notificationclick` (mở đúng trang theo deep link); hiện service worker PWA **chưa xử lý push** (theo PT-030); (b) đăng ký/hủy subscription từ trình duyệt; (c) nút bật/tắt thông báo ở Cài đặt, xin quyền thông báo qua thao tác bấm của người dùng; (d) trên iPhone chỉ hiện nút bật khi web chạy ở chế độ đã cài (standalone), chưa cài thì hiện hướng dẫn "Thêm vào Màn hình chính". **Đích nghiệm thu: push thật đến iPhone (PWA đã cài, iOS 16.4+) và Android (PWA/Chrome), không cam kết thời gian đến (Oniichan đã chấp nhận 2026-11-04)** | Phải có | M7; v1.0.3 PT-030 |
| FR-10 | Tính năng | Trang cài đặt thông báo ở web admin khớp hành vi push thật: bật/tắt `push` từng loại, giờ yên lặng có hiệu lực, bỏ ghi chú "chưa có hiệu lực" nếu có | Nên có | M5 (việc để lại: giờ yên lặng), M7 |
| FR-11 | Tính năng | Gỡ mock có cờ của "đẩy thông báo" ở web admin nếu còn (xem Câu hỏi 5) | Nên có | M6, M7 |
| FR-12 | Tính năng | Bộ test và nghiệm thu M7: unit + integration với dịch vụ push giả lập (kể cả lỗi tạm, subscription hết hạn 404/410, hết hạn mức), E2E chống gửi trùng khi restart, thử thật trên iPhone (PWA đã cài) và Android | Phải có | M7 |
| FR-13 | Tính năng | Cập nhật tài liệu cho M7: 04 (mục 6.3, 10, 11), 05 (API push subscription), bảng milestone 06, `06_Production_Deploy.md`, `.env.docker.example` | Nên có | M7 |

### 2.2 Sửa lỗi: backlog QA M0–M6

> Chỉ gồm việc có trong cột Ghi chú của bảng milestone 06. FR-14 đến FR-18 (PT-037 đến PT-041) là điều kiện an toàn **phải xong trước khi bật `FEATURE_CRM_PUSH` ở production**. Mã PT = mã FR + 23 (FR-14 là PT-037, FR-37 là PT-060).

| Mã PT | Mã FR | Loại | Việc | Ưu tiên (Phải có / Nên có / Tùy chọn) | Nguồn |
|---|---|---|---|---|---|
| PT-037 | FR-14 | Sửa lỗi | Sanitize chống NoSQL injection ở đầu vào (query/body có toán tử `$...`) | Phải có | M0 (việc nhỏ còn theo dõi) |
| PT-038 | FR-15 | Sửa lỗi | Winston che PII (SĐT, CCCD, email) trong log, kể cả log của luồng push | Phải có | M0 |
| PT-039 | FR-16 | Sửa lỗi | `listDeleted` (khách đã xóa) thêm `guardSearch` như các endpoint tìm kiếm khác (chống dò SĐT) | Phải có | M2 việc để lại (6) |
| PT-040 | FR-17 | Sửa lỗi | Kiểm ảnh điện thoại có GPS thật trên production: xác nhận Exif/GPS đã bị bỏ trước khi lưu (điều kiện nêu ở M3 trước khi bật ảnh đính kèm; hiện đã bật từ 2026-11-02) | Phải có | M3 |
| PT-041 | FR-18 | Sửa lỗi | Giới hạn lô khi quét "khách lâu chưa chăm sóc" lần đầu bật ở production (tránh bão thông báo, nhất là khi đã có push) | Phải có | M5 (N5) |
| PT-042 | FR-19 | Sửa lỗi | Throttler lưu trạng thái ở Redis (dùng chung nhiều instance) | Nên có | M0 |
| PT-043 | FR-20 | Sửa lỗi | Idempotency: băm body để phát hiện cùng key khác nội dung; xác nhận scope key theo user | Nên có | M0, M2 việc để lại (5) |
| PT-044 | FR-21 | Sửa lỗi | Route ADMIN-only ngoài CRM (knowledge-articles, settings, external-log, cron) và GET danh mục CRM đọc role từ DB thay vì tin role trong JWT (tối đa 15 phút trễ) | Nên có | M1 |
| PT-045 | FR-22 | Sửa lỗi | `POST /users` trùng email đồng thời trả 409 thay vì 500 | Nên có | M1 |
| PT-046 | FR-23 | Sửa lỗi | `trustProxy`/lấy IP thật sau cloudflared (ảnh hưởng audit IP và rate limit) | Nên có | M2 việc để lại (3) |
| PT-047 | FR-24 | Sửa lỗi | Thêm index `persona.fieldKey` cho đếm `valueCount` khi đổi kiểu trường chân dung | Nên có | M4 (N4, N6) |
| PT-048 | FR-25 | Sửa lỗi | `notifications.createMany` xử lý E11000 ngoài đường nhắc việc | Nên có | M5 (N3) |
| PT-049 | FR-26 | Sửa lỗi | `ImageProcessor`/thumbnail cho ảnh đính kèm (hiện `thumbUrl` = `url`, ảnh vào thẳng `READY`) | Nên có | M3, M5 (nhãn M10; không là tiền đề của M7) |
| PT-050 | FR-27 | Sửa lỗi | Endpoint hoàn tất việc FOLLOW_UP (BE) và nối ở web admin (FE) | Nên có | M6 backlog |
| PT-051 | FR-28 | Sửa lỗi | CORS `exposedHeaders` cho các header FE cần đọc | Nên có | M6 backlog |
| PT-052 | FR-29 | Sửa lỗi | Dọn lệch tài liệu: đồng bộ tài liệu 04, 05, 06 với các mục "Lệch tài liệu" đã ghi ở M3, M4, M5 | Nên có | M3, M4, M5 |
| PT-053 | FR-30 | Sửa lỗi | Xử lý 20 test fail có sẵn ở 3 suite AI của backend (liên quan thao tác AI) | Nên có | M0 (ghi nhận lặp ở M1–M5) |
| PT-054 | FR-31 | Sửa lỗi | Xử lý 11 test và 7 lỗi `tsc` ngoài CRM có sẵn ở web admin (ManageWpScreen, MarketAnalysisWorkflowScreen, google-drive) | Nên có | M6 |
| PT-055 | FR-32 | Sửa lỗi | `personaFilters` hỗ trợ giá trị chứa dấu phẩy | Tùy chọn | M4 (e) |
| PT-056 | FR-33 | Sửa lỗi | Chỉnh Helmet CORP nếu phát ảnh qua API (hiện ảnh đi qua URL ký sẵn của MinIO nên chưa cần) | Tùy chọn | M6 backlog |
| PT-057 | FR-34 | Sửa lỗi | Bộ đếm phụ cho dò đuôi 4-5 số của tìm kiếm SĐT (~100 từ khóa/giờ) | Tùy chọn | M2 việc để lại (4) |
| PT-058 | FR-35 | Sửa lỗi | Seed dự án trùng một lần với bản seed cũ đổi tên trước khi có `seedKey` | Tùy chọn | M1 |
| PT-059 | FR-36 | Sửa lỗi | `evaluateOccasion` kiểm `occurrenceDate` | Tùy chọn | M5 (N4) |
| PT-060 | FR-37 | Sửa lỗi | Tùy chọn "thành viên tự bật `STALE_CUSTOMER`" (cần cờ riêng trong cài đặt) | Tùy chọn | M5 |

### 2.3 Lỗi mới chờ Oniichan bổ sung

> Oniichan nêu lỗi mới theo từng đợt. Đã có **`PT-032` đến `PT-036`** (FR-38 đến FR-42); mã PT tiếp theo là **`PT-061`** (PT-037 đến PT-060 đã dành cho 24 mục backlog QA ở mục 2.2; không dùng lại mã đã có). Mỗi lỗi khi nhận được cấp mã `PT-xxx` kế tiếp (từ `PT-061`) và mã `FR-xx` kế tiếp (từ `FR-43`), và ghi chi tiết theo mẫu một mục ở mục 3 của file v1.0.3. Mức độ ở các mục là **đề xuất**, Oniichan rà lại.

| Mã PT | Mã FR | Mô tả lỗi | Mức độ | Nhóm | Ưu tiên |
|---|---|---|---|---|---|
| PT-032 | FR-38 | Thông báo trên web admin: trên mobile, bấm chuông thì cửa sổ thông báo hiện **lệch ra ngoài mép trái màn hình, bị cắt** (ảnh chụp iPhone ngày 2026-11-04). Oniichan yêu cầu: **mobile** chuyển hẳn sang **một màn hình danh sách thông báo**, hiển thị **20 thông báo mới nhất**, cuộn xuống cuối thì **tải thêm 20** (infinite scroll); **desktop** hiện dropdown **giống Facebook** (neo dưới chuông, tab Tất cả/Chưa đọc, chấm xanh chưa đọc, thời gian tương đối, link "Xem tất cả") | Major (đề xuất) | FE | Phải có |
| PT-033 | FR-39 | Màn **Cài đặt CRM** thiếu tab quản lý **Kết quả liên hệ** để Quản trị tự thêm, sửa, ẩn mục (Oniichan báo ngày 2026-11-04). Hiện Cài đặt có các tab Tình trạng, Nguồn khách, Khu vực, Dự án, Người dùng, Nhóm, Nhắc việc; backend đã có sẵn `POST/PATCH/DELETE /crm/contact-results` (chỉ Quản trị) và lớp gọi API ở FE đã khai báo endpoint này, nên chỉ thiếu giao diện. Oniichan yêu cầu rà thêm các danh mục khác; kết quả rà đã tách thành PT-035 và PT-036 (xem mục "Kết quả rà soát danh mục" bên dưới) | Major (đề xuất) | FE | Phải có |
| PT-034 | FR-40 | **Dữ liệu danh mục lưu dưới dạng ObjectId, không đọc được** (Oniichan báo ngày 2026-11-04): ví dụ nhật ký chăm sóc lưu `contactResultId` là dãy số `6ae7ebd…`, nên người đọc DB hoặc file export (kể cả agent AI) không hiểu nghĩa; giá trị `<option>` ở form cũng là ObjectId. Đề xuất: đổi tham chiếu các danh mục nhỏ sang **`code` chữ ổn định** (đã có sẵn ở backend, duy nhất và không dùng lại kể cả khi xóa mềm), API và export trả cả `code` lẫn `label`, form dùng `code` làm giá trị; kèm migration dữ liệu cũ | Cải tiến (đề xuất) | BE / FE / Dữ liệu | Nên có |
| PT-035 | FR-41 | **Chưa có màn quản lý Trường chân dung** cho Quản trị (kết quả rà soát 2026-11-04). Đây là nguồn của hầu hết ô "chỉ chọn" Oniichan thấy: loại hình, cơ cấu phòng, mục đích mua, người quyết định, kênh ưa thích, hôn nhân, tiêu chí ưu tiên (seed 27 trường, đa số `isSystem`). Backend đã có đủ `POST`, `PATCH`, `DELETE`, `PUT order` (chỉ Quản trị); FE chỉ gọi `GET /crm/persona-fields`. Tài liệu đã hứa tính năng này (yêu cầu X10: Quản trị tự thêm, sửa, bớt trường chân dung) nhưng FE chưa làm | Major (đề xuất) | FE | Phải có |
| PT-036 | FR-42 | **Chưa có màn quản lý Thẻ** (sở thích, nghề nghiệp): mọi vai trò tạo được thẻ nhanh, nhưng sửa tên, gộp, xóa mềm chỉ Quản trị làm được ở backend và FE không có màn nào, nên thẻ gõ sai hoặc trùng không dọn được và bộ lọc/gắn thẻ hàng loạt ngày càng rối | Minor (đề xuất) | FE | Nên có |
| PT-061 | | _(chờ Oniichan bổ sung; mã FR cấp khi nhận, từ FR-43)_ | | | |

**PT-032 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | Chuông thông báo ở header web admin (`src/components/header/NotificationDropdown.tsx`, `src/layout/AppHeader.tsx`), màn Thông báo CRM (`src/modules/crm/screens/Notifications`); API `GET /notifications` (đã có `page`, `limit`, mới nhất trước), `GET /notifications/unread-count`, `PATCH /notifications/:id`, `PATCH /notifications` |
| Bước tái hiện | 1. Mở web admin trên iPhone. 2. Bấm icon chuông ở header |
| Kết quả thực tế | Cửa sổ thông báo lệch trái, bị cắt, không đọc được nội dung |
| Kết quả mong đợi | Mobile: chuyển sang màn riêng, 20 mục đầu, cuộn tới cuối tải thêm 20, có trạng thái đang tải/hết danh sách/rỗng/lỗi. Desktop: dropdown kiểu Facebook, không tràn ra ngoài viewport, cuộn tới cuối cũng tải thêm 20 |
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE: backend đã có phân trang, không đổi API. Dùng infinite query; đánh dấu đã đọc phải làm tươi cả danh sách và số chưa đọc; kèm test phân trang (đúng 20 mục, hết danh sách, lỗi giữa chừng) và thử iPhone thật |
| Người phụ trách | `coder-frontend-agent`, rồi `qa-agent` review |
| Trạng thái | `Mới` (Oniichan yêu cầu chưa sửa, chỉ đưa vào kế hoạch, 2026-11-04) |

**PT-033 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | Màn Cài đặt CRM (`RealEstateAdminApp/src/modules/crm/screens/Settings`: `SettingsView.tsx`, `settingsForms.ts` (`SETTINGS_TABS`), `components/CatalogSection.tsx`, `CatalogItemEditor.tsx`); API `GET/POST/PATCH/DELETE /crm/contact-results` (đã có, chỉ Quản trị; POST nhận `code*`, `label*`, `suggestedFollowUpDays?`, `suggestionText?`, `order?`; PATCH không đổi `code`; DELETE là xóa mềm) |
| Bước tái hiện | 1. Đăng nhập Quản trị, mở Cài đặt CRM. 2. Tìm chỗ thêm/sửa/ẩn "Kết quả liên hệ" (ô chọn ở form Ghi chú chăm sóc) |
| Kết quả thực tế | Không có tab nào cho Kết quả liên hệ; người dùng không tự thêm bớt được |
| Kết quả mong đợi | Có tab "Kết quả liên hệ": xem danh sách, thêm (nhập `code`, nhãn, số ngày gợi ý hẹn lại, câu gợi ý), sửa nhãn/gợi ý/thứ tự, ẩn và khôi phục; mục đã dùng chỉ ẩn, không xóa cứng; lỗi tiếng Việt; có trên cả desktop và mobile. Form soạn mục có thêm 2 trường riêng của kết quả liên hệ (số ngày gợi ý hẹn lại, câu gợi ý nhắc việc), không chỉ nhãn như Nguồn khách. Các danh mục khác còn thiếu màn đã được rà và ghi ở PT-035, PT-036 |
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE, tái sử dụng `CatalogSection`/`CatalogItemEditor` (bắt buộc mở rộng `CatalogDraft` và `CatalogItemEditor` cho `suggestedFollowUpDays`, `suggestionText`: hiện cả hai chưa có; `CATALOG_ENDPOINTS` ở `settingsForms.ts` chỉ ánh xạ 3 loại, chưa có `contact-results` dù `adminApi.ts` đã khai báo); thêm test cho tab, thêm/sửa/ẩn và quyền (chỉ Quản trị thấy); sau khi lưu danh mục dùng chung phải tải lại để form Ghi chú thấy ngay |
| Người phụ trách | `coder-frontend-agent`, rồi `qa-agent` review |
| Trạng thái | `Mới` (2026-11-04) |

**PT-034 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | Mọi nơi tham chiếu danh mục bằng ObjectId: nhật ký chăm sóc (`contactResultId`), khách (tình trạng, nguồn, khu vực, dự án quan tâm), bộ lọc, báo cáo, file export, lịch sử thay đổi/audit; form chọn danh mục ở web admin |
| Bước tái hiện | 1. Mở form Ghi chú chăm sóc, xem DevTools: `<option value>` là ObjectId. 2. Xem dữ liệu nhật ký trong DB/export: `contactResultId` là dãy số |
| Kết quả thực tế | Dữ liệu lưu và dữ liệu đưa ra ngoài chỉ có ObjectId, người và agent AI không đọc được nghĩa nếu không tra bảng danh mục |
| Kết quả mong đợi | Dữ liệu lưu/đưa ra có `code` chữ ổn định (ví dụ mã của "Quan tâm giá") kèm `label`; đổi nhãn không làm vỡ báo cáo hay dữ liệu cũ; mã đã xóa mềm không bị dùng lại |
| Quyết định thiết kế (đề xuất của Neptune, chờ Oniichan duyệt) | **Không chuyển sang nhãn tự do** (nhãn đổi tên được, gõ sai được, đếm theo nhãn sẽ vỡ); dùng `code`. Danh mục nhỏ (tình trạng khách, nguồn khách, kết quả liên hệ, khu vực, dự án) chuyển sang `code`; **người dùng và nhóm giữ ObjectId**; thẻ và trường chân dung xét riêng khi thiết kế. Cần `architect-agent` thiết kế trước (mô hình lưu, API tương thích ngược, thứ tự migration, cách xử lý index/bộ lọc/báo cáo/export/audit), migration có đường lùi, kiểm trên bản sao dữ liệu thật trước khi chạy production |
| Rủi ro | Chạm nhiều module (khách, nhật ký, bộ lọc, báo cáo, export), có migration dữ liệu; nếu không kịp thì xin dời sang v1.0.5 (ghi `Hoãn` có lý do) |
| Người phụ trách | `architect-agent` thiết kế, rồi `coder-backend-agent` + `coder-frontend-agent`; `qa-agent` review code, test và migration |
| Trạng thái | `Mới` (2026-11-04) |

**PT-035 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | Cài đặt CRM (thêm tab, ví dụ "Trường chân dung"); dùng ở `EditPersona`, `EditInvestment` (nhóm REAL_ESTATE), `PersonaFieldInput` (SELECT, MULTI_SELECT), thẻ chân dung ở chi tiết khách; API `GET/POST/PATCH/DELETE /crm/persona-fields`, `PUT /crm/persona-fields/order` (đã có, chỉ Quản trị; PATCH nhận `options` là danh sách mong muốn, lựa chọn vắng mặt bị tắt chứ không xóa) |
| Bước tái hiện | 1. Đăng nhập Quản trị, mở Cài đặt CRM. 2. Tìm chỗ sửa lựa chọn của ô "Loại hình quan tâm" hoặc thêm một trường chân dung mới |
| Kết quả thực tế | Không có màn nào; Quản trị không sửa được nhãn, lựa chọn, thứ tự, bật/tắt, thêm hay bớt trường |
| Kết quả mong đợi | Quản trị xem danh sách trường theo nhóm, sửa nhãn và lựa chọn của trường chọn, bật/tắt, đổi thứ tự, thêm trường mới (kiểu, lựa chọn, trọng số, lọc được, nhạy cảm) và bớt trường không phải trường hệ thống; thay đổi có hiệu lực ngay ở form chân dung; không mất dữ liệu cũ của khách |
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE nhưng lớn. Đề xuất **chia hai đợt**: (1) sửa nhãn và lựa chọn của trường SELECT/MULTI_SELECT, bật/tắt, đổi thứ tự; (2) thêm/bớt trường. Giữ cứng: kiểu trường (`PersonaFieldType`) và 7 nhóm trường. `coder-backend-agent` kiểm lại quy tắc BE trước khi làm: trường hệ thống không xóa được (`PERSONA_FIELD_SYSTEM`), không đổi `type` khi đã có dữ liệu (`PERSONA_FIELD_TYPE_LOCKED`), trường nhạy cảm/lọc được. Test: quyền chỉ Quản trị, đổi lựa chọn không làm mất dữ liệu cũ, thứ tự |
| Người phụ trách | `coder-frontend-agent` (và `coder-backend-agent` kiểm quy tắc); `qa-agent` review |
| Trạng thái | `Mới` (2026-11-04) |

**PT-036 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | Cài đặt CRM (thêm tab "Thẻ"); dùng ở `EditPersona` (`TagPicker`), `AdvancedFilterModal` (lọc), `BulkActionBar` (gắn thẻ hàng loạt); API `PATCH /crm/tags/:id` (đổi tên/nhóm/màu, gộp bằng `mergeIntoId`), `DELETE /crm/tags/:id` (xóa mềm) (đã có, chỉ Quản trị); `POST /crm/tags` mọi vai trò CRM (có giới hạn tần suất) |
| Bước tái hiện | 1. Nhân viên gắn nhanh thẻ mới bị gõ sai hoặc trùng. 2. Quản trị tìm chỗ đổi tên, gộp hoặc xóa thẻ đó |
| Kết quả thực tế | Không có màn nào; thẻ sai/trùng tồn tại mãi và hiện ở mọi bộ lọc |
| Kết quả mong đợi | Tab "Thẻ": danh sách thẻ kèm số lần dùng (`usageCount`), đổi tên/nhóm/màu, gộp hai thẻ, ẩn/xóa; thay đổi có hiệu lực ngay ở bộ lọc, gắn hàng loạt và form chân dung |
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE, không cần migration. Giữ cứng loại thẻ (INTEREST/OCCUPATION/OTHER). Test: quyền, gộp (thẻ cũ biến mất, khách chuyển sang thẻ đích), xóa mềm |
| Người phụ trách | `coder-frontend-agent`, rồi `qa-agent` review |
| Trạng thái | `Mới` (2026-11-04) |

**Kết quả rà soát danh mục (2026-11-04, `qa-agent`, chỉ đọc code, chưa chạy app)**

- **Đã có màn quản lý (7):** Tình trạng khách, Nguồn khách, Khu vực, Dự án, Người dùng, Nhóm, Nhắc việc.
- **Thiếu màn quản lý:** Kết quả liên hệ (PT-033), Trường chân dung và lựa chọn của chúng (PT-035), Thẻ (PT-036).
- **Mục nhỏ chưa xếp thành PT** (ưu tiên Thấp, chờ Oniichan quyết): (a) "loại hình" của dự án (`propertyTypes`) là chữ gõ tự do, tách rời với lựa chọn `property_type` của chân dung, nên cho chọn từ danh mục chung hoặc dùng chung lựa chọn (cần BE, có thể cần migration); (b) ô "Kết quả liên hệ" trong `CallModal` dùng 5 chuỗi cứng khác danh mục DB, hiện chưa lộ vì cờ `isInAppCallEnabled` tắt, khi bật phải chuyển sang danh mục DB; (c) loại thẻ `OTHER` có ở BE và FE nhưng form chỉ hiện INTEREST và OCCUPATION, chưa rõ cố ý hay sót; (d) bộ lọc nâng cao chưa lọc theo chân dung dù BE hỗ trợ (`isFilterable`, `personaFilterKeys`), đây là thiếu chức năng lọc, ngoài phạm vi quản lý danh mục.
- **Nên giữ cứng:** nhóm danh sách của tình trạng, kênh liên hệ nhật ký, loại và trạng thái lịch hẹn, loại việc hôm nay, vai trò tài khoản, 4 tiêu chí nhu cầu/động cơ/tài chính/thời gian, nguồn thông tin chân dung, kiểu trường và nhóm trường chân dung, loại thẻ, loại khu vực/trạng thái bán/đơn vị giá của dự án, tùy chọn bộ lọc/sắp xếp/báo cáo, preset import, các mốc nhắc lịch hẹn ở form.
- **Chưa kiểm được:** màn ẩn ngoài `SETTINGS_TABS` (căn cứ chỉ là grep không thấy lời gọi ghi); `AppointmentMoreMenu`, `MiniMonthCalendar`; ô chọn ngoài module CRM (`UserManagementScreen`, `EditUserModal`).

## 3. Quy tắc nghiệp vụ

Quy tắc cho M7 Web Push (VAPID) cho PWA (tham chiếu FR):

1. **Hộp thông báo trong app là nguồn chính; push chỉ là kênh bổ sung.** Mọi thông báo vẫn ghi vào hộp thông báo như hiện nay; push lỗi/bị bỏ qua không làm hỏng hay chặn nghiệp vụ (FR-03).
2. **Đăng ký subscription:** API đăng ký thuộc `Self`, cần đăng nhập; body gồm endpoint và khóa `p256dh`/`auth` của push subscription trình duyệt, tùy chọn thông tin trình duyệt/thiết bị (thay `platform` IOS/ANDROID/WEB; trường và tên endpoint do `architect-agent` quyết). Endpoint là duy nhất toàn hệ thống: đăng ký lại cùng endpoint từ tài khoản khác thì **gán lại cho người dùng hiện tại** (upsert, cập nhật `lastSeenAt`, xóa `revokedAt`) (FR-01).
3. **Hủy subscription:** API hủy chỉ cho chủ sở hữu (người khác nhận 404, không lộ tồn tại); đăng xuất kèm id subscription thì thu hồi subscription đó; đăng xuất không kèm thì không thu hồi các subscription khác (FR-01).
4. **Người nhận push** = đúng tập người nhận của thông báo trong app (đã loại người thực hiện, đã lọc theo phạm vi quyền). Gửi tới **mọi subscription còn hiệu lực** (`revokedAt` rỗng) của người đó (FR-03).
5. **Chọn kênh theo cài đặt thông báo đã có ở M5:** `notification_preferences.types[type].push` quyết định có gửi push hay không (loại chưa lưu = bật); `inApp` quyết định ghi vào hộp thông báo (không đổi). Push bị tắt hoặc đang trong **giờ yên lặng** (`quietHours`, múi giờ `Asia/Ho_Chi_Minh`) thì `pushStatus = SKIPPED`, thông báo vẫn nằm trong hộp thư (FR-03). Ngoại lệ giờ yên lặng cho cảnh báo bảo mật: xem Câu hỏi 3.
6. **Thời điểm gửi:** chỉ đưa job `push.send` vào queue **sau khi transaction nghiệp vụ commit**; không gửi cho thông báo của giao dịch bị rollback (FR-03).
7. **Không gửi trùng:** mỗi cặp (thông báo, subscription) có tối đa một lần gửi thành công; job retry hoặc restart worker/hai instance không tạo push thứ hai (dedupe theo khóa thông báo và subscription, cập nhật `pushStatus` nguyên tử) (FR-03, FR-12).
8. **Lỗi và retry:** timeout 5 giây mỗi lần gọi dịch vụ push; lỗi tạm thời (5xx, giới hạn tần suất/hạn mức) thì retry backoff lũy thừa có jitter tối đa 5 lần rồi `pushStatus = FAILED`; lỗi vĩnh viễn thì không retry (FR-02, FR-03).
9. **Xử lý subscription hết hạn:** dịch vụ push trả HTTP 404 hoặc 410 (subscription không còn hợp lệ) thì thu hồi subscription (`revokedAt = now`) và không thử lại; các subscription khác của người đó vẫn gửi bình thường (FR-04).
10. **Không lộ PII trong nội dung push:** payload **không** chứa SĐT, CCCD, email, nội dung nhật ký/ghi chú, lời nhắn đề nghị; chỉ gồm tiêu đề/nội dung ngắn theo mẫu theo loại thông báo, loại, và deep link dạng đường dẫn nội bộ có `id` (ví dụ `/crm/customers/:id`). Có hiển thị tên khách hay không: Câu hỏi 2. Khi ẩn danh hóa khách, thông báo chứa tên khách đã bị xóa khỏi hộp thông báo (đã có ở M5); push đã gửi không thu hồi được nên mẫu nội dung càng ít thông tin càng tốt (FR-06).
11. **Quyền và phạm vi:** người dùng chỉ đăng ký/xem/hủy subscription của chính mình; bấm vào push mở đúng trang nhưng vẫn kiểm quyền/phạm vi ở API (khách ngoài phạm vi trả 404 như hiện nay). Tài khoản bị khóa/ngừng hoạt động hoặc bị xóa thì không nhận push và subscription bị thu hồi (đề xuất, chốt ở thiết kế) (FR-01, FR-03).
12. **Cờ và quay lui:** `FEATURE_CRM_PUSH=false` (mặc định) thì dùng Noop, mọi thông báo `SKIPPED`; API đăng ký subscription vẫn có thể lưu subscription để không mất khi bật cờ sau. Bật/tắt cờ là hành động có kiểm soát của Oniichan/`devops-agent`, tắt được ngay mà không đổi code (FR-07).
13. **Bí mật:** khóa riêng VAPID (`VAPID_PRIVATE_KEY`) là bí mật: không nằm trong repo, image, log, hay tài liệu; chỉ truyền qua biến môi trường/secret trên VPS. Khóa công khai (`VAPID_PUBLIC_KEY`) không bí mật, đưa cho FE. `VAPID_SUBJECT` (địa chỉ liên hệ) **đã chốt là email `mailto:info@stnd.vn`** (không bí mật, được ghi trong tài liệu). Khóa tạo một lần; đổi khóa làm mọi subscription cũ mất hiệu lực (FR-07, FR-08).
14. **Thứ tự bật production (đề xuất):** xong FR-14 đến FR-18 (PT-037 đến PT-041) trước; bật cờ và thử với vài tài khoản; quan sát log/`pushStatus`; rồi mở rộng (xem Câu hỏi 4).
15. **Chỉ xin quyền khi người dùng chủ động bấm:** quyền thông báo chỉ được xin sau một thao tác bấm của người dùng (nút bật thông báo ở Cài đặt), không xin tự động khi mở trang hay đăng nhập. Trình duyệt từ chối thì hiện trạng thái "đã chặn" kèm hướng dẫn mở lại, không xin lặp (FR-09).
16. **iPhone chỉ bật khi đã cài PWA:** trên iPhone (iOS 16.4 trở lên) chỉ hiện nút bật thông báo khi web chạy ở chế độ đã cài (standalone); nếu chạy trong tab Safari thường thì hiện hướng dẫn "Thêm vào Màn hình chính" thay cho nút bật (FR-09).

## 4. Thứ tự triển khai

### 4.1 Milestone gợi ý (theo ưu tiên và phụ thuộc)

| Giai đoạn | Nội dung | Phụ thuộc |
|---|---|---|
| **A. An toàn nền trước push** | FR-14 (PT-037), FR-15 (PT-038), FR-16 (PT-039), FR-17 (PT-040), FR-18 (PT-041) | — (làm trước khi bật push; FR-18 (PT-041) và FR-15 (PT-038) là điều kiện của FR-03/FR-06) |
| **B. M7 lõi backend** | FR-01, FR-02, FR-03, FR-04, FR-06, FR-07, FR-12 (test tự động) | A; `architect-agent` thiết kế trước; M5 (thông báo, queue) đã có |
| **C. Khóa VAPID, cờ và PWA nhận push** | FR-08 (runbook VAPID), FR-09 (PWA: service worker, đăng ký subscription, nút bật/tắt), FR-10, FR-11; bật cờ theo mục 3 quy tắc 14 | B; `subject` đã chốt (`mailto:info@stnd.vn`); **Oniichan cho phép tạo/lưu khóa VAPID**; có iPhone (iOS 16.4+) và Android đã cài PWA để thử |
| **D. Backlog "Nên có"** | FR-19 đến FR-31 (PT-042 đến PT-054), kèm FR-13 (tài liệu) | Không chặn M7; làm xen kẽ, ưu tiên FR-21 (PT-044), FR-23 (PT-046), FR-29 (PT-052) |
| **E. "Tùy chọn" và lỗi mới** | FR-05, FR-32 đến FR-37 (PT-055 đến PT-060); lỗi mới mục 2.3 (đưa lên trước nếu là Blocker/Major; FR-38 (PT-032), FR-39 (PT-033) và FR-41 (PT-035) là Major đề xuất, chỉ FE, không chờ M7 nên có thể làm sớm (PT-035 lớn, chia hai đợt); FR-42 (PT-036) là Minor chỉ FE; FR-40 (PT-034) cần `architect-agent` thiết kế và migration, làm sau khi chốt thiết kế, có thể xin dời sang v1.0.5) | Làm nếu còn thời gian; lỗi mới xếp theo mức độ khi nhận |

Mốc phát hành v1.0.4: xong A, B, C và các mục "Phải có" còn lại; D và E không chặn phát hành (mục chưa xong được chuyển sang v1.0.5 hoặc ghi `Hoãn`).

### 4.2 Phụ thuộc và việc Oniichan phải chuẩn bị

| Việc | Khi nào cần | Ghi chú |
|---|---|---|
| `subject` liên hệ VAPID: **đã chốt `VAPID_SUBJECT=mailto:info@stnd.vn`** (2026-11-04), không còn việc cần Oniichan duyệt | Đã xong | Giá trị không bí mật; xem mục 8 |
| Cho phép tạo cặp khóa VAPID và lưu khóa riêng (`VAPID_PRIVATE_KEY`) trên VPS; khóa công khai đưa cho FE | Trước bật cờ | Không đưa khóa riêng vào repo/chat; lưu password manager; có kế hoạch xoay (đổi khóa thì người dùng phải bật lại thông báo) |
| Bật `FEATURE_CRM_PUSH` qua `CRM_*`/compose theo hướng dẫn runbook | Giai đoạn C | Compose ghi đè `FEATURE_CRM_*`, không đặt trực tiếp trong `.env.docker`; tên biến mới do `devops-agent` chốt |
| Máy thật **iPhone (iOS 16.4+)** và **Android** đã cài web admin dạng PWA (iPhone: Thêm vào Màn hình chính) để thử | Nghiệm thu giai đoạn C | iPhone và Android thật của Oniichan; domain production dùng HTTPS |
| Cung cấp danh sách lỗi mới (mục 2.3) | Khi sẵn sàng | Đã có PT-032 đến PT-036; mã PT tiếp theo `PT-061` |

## 5. Rủi ro & Ràng buộc

| # | Rủi ro | Ảnh hưởng | Hướng xử lý |
|---|---|---|---|
| 1 | **iOS chỉ hỗ trợ Web Push khi PWA đã cài (Thêm vào Màn hình chính) và iOS từ 16.4**; quyền phải xin qua thao tác bấm | iPhone chưa cài PWA hoặc iOS cũ không nhận push | Hướng dẫn "Thêm vào Màn hình chính" trong app, chỉ hiện nút bật ở chế độ standalone (quy tắc 15, 16); hộp thông báo vẫn là nguồn chính; ghi yêu cầu iOS 16.4+ trong runbook |
| 2 | Quyền thông báo có thể bị người dùng tắt, hoặc mất khi gỡ/cài lại PWA | Subscription cũ chết, người dùng tưởng vẫn nhận push | Thu hồi theo 404/410 (FR-04); Cài đặt hiển thị trạng thái thật (đã bật/đã chặn/chưa bật) và cho bật lại dễ; không xin quyền lặp |
| 3 | Hành vi thông báo trên iOS khó đoán (PWA đóng hẳn, chế độ Focus, tiết kiệm pin, trễ) | Push đến chậm, không đến, hoặc hiển thị khác Android | **Bắt buộc thử trên iPhone thật** trước khi nghiệm thu; ghi kết quả vào runbook; **Oniichan đã chấp nhận** (2026-11-04) mức nghiệm thu "đến được trong điều kiện thử thông thường trên máy thật", không cam kết thời gian đến (mục 8) |
| 4 | Dịch vụ push của Apple/Google nằm ngoài tầm kiểm soát (trễ, từ chối, giới hạn tần suất) | Push chậm hoặc mất | Retry backoff + jitter tối đa 5 lần, timeout 5 giây; hộp thông báo vẫn là nguồn chính; không cam kết thời gian đến |
| 5 | Web Push và service worker chỉ chạy trên **HTTPS** với domain đúng (production sau cloudflared); subscription gắn với domain và khóa VAPID | Đổi domain hoặc khóa thì mất toàn bộ subscription; thử trên domain sai không phản ánh thật | Thử trên domain production/staging có HTTPS; không đổi khóa VAPID tùy tiện (runbook xoay khóa, FR-08); kiểm tra scope service worker |
| 6 | Lộ PII qua dịch vụ push (máy chủ Apple/Google, hiện trên màn khóa) | Vi phạm nguyên tắc dữ liệu khách | Mẫu nội dung tối giản, test chặn PII (FR-06, FR-12), log che PII (FR-15, PT-038), Câu hỏi 2 |
| 7 | Bão push khi bật cờ (quét "khách lâu chưa chăm sóc" lần đầu, nhắc hàng loạt) | Spam nhân viên, chạm giới hạn dịch vụ push | FR-18 (PT-041) giới hạn lô; bật cờ theo allowlist rồi mở rộng; giới hạn tốc độ gửi ở worker |
| 8 | Gửi trùng do retry/restart/nhiều worker | Nhân viên nhận push lặp | Dedupe theo (thông báo, subscription), `pushStatus` nguyên tử, test chạy đồng thời (FR-03, FR-12) |
| 9 | Lộ khóa riêng VAPID | Kẻ xấu gửi push giả tới mọi subscription | Chỉ biến môi trường/secret, không vào repo/image/log, xoay khóa (người dùng phải bật lại), ghi trong runbook (FR-08) |
| 10 | Redis/BullMQ là phụ thuộc mới của đường push | Redis lỗi thì push dừng | Push không chặn nghiệp vụ; readiness đã kiểm Redis; tắt được bằng cờ |
| 11 | Lỗi mới do Oniichan nêu sau làm đổi ưu tiên/quy mô | Trượt mốc | Phân loại theo mức độ; Blocker/Major đưa lên trước, xếp cùng giai đoạn A |
| 12 | Một số việc backlog M0/M1 không rõ đã đóng hay chưa (Throttler Redis, sanitize NoSQL, Winston che PII, AAD CCCD, idempotency scope user) | Tính trùng hoặc bỏ sót | `qa-agent` đối chiếu hiện trạng trước khi giao (Câu hỏi 8) |
| 13 | Số 1.0.4 cho phiên bản có tính năng mới (semver thuần là 1.1.0) | Lệch quy ước | Giữ theo quyết định của Oniichan như ngoại lệ v1.0.2 (Câu hỏi 6) |

## 6. Tiêu chí nghiệm thu

> Căn cứ cho `qa-agent`. Mỗi mục kiểm được bằng test tự động, lệnh, hoặc thao tác thử đã ghi.

**Giai đoạn A (an toàn nền):**

- [ ] FR-14 (PT-037): test cho thấy payload chứa toán tử `$...` bị từ chối hoặc vô hiệu hóa ở các endpoint nhận query/body có lọc.
- [ ] FR-15 (PT-038): test cho thấy log không chứa SĐT, CCCD, email dạng đầy đủ.
- [ ] FR-16 (PT-039): `listDeleted` có test `guardSearch` (tìm SĐT từng phần bị chặn như endpoint khác).
- [ ] FR-17 (PT-040): tải lên một ảnh điện thoại có GPS thật ở production (hoặc môi trường thử cùng cấu hình), tải về và xác nhận không còn Exif/GPS.
- [ ] FR-18 (PT-041): test cho thấy lần quét đầu bị giới hạn kích thước lô và các lô còn lại được xử lý ở lượt sau, không gửi quá hạn mức mỗi lượt.

**Giai đoạn B–C (M7):**

- [ ] FR-01: API đăng ký subscription upsert đúng (trùng endpoint từ user khác thì gán lại), API hủy chỉ chủ sở hữu (người khác 404), logout kèm id subscription thu hồi subscription; có test ma trận quyền.
- [ ] FR-02, FR-03: với dịch vụ push giả lập, test chứng minh: gửi đúng người nhận, tôn trọng `push=false` và giờ yên lặng (`SKIPPED`), retry tối đa 5 lần với backoff, hết lần thì `FAILED`, nghiệp vụ không bị ảnh hưởng khi dịch vụ push lỗi.
- [ ] FR-03, FR-12: chạy đồng thời hai worker và restart giữa chừng không tạo push thứ hai cho cùng (thông báo, subscription); không có push cho giao dịch rollback.
- [ ] FR-04: dịch vụ push trả 404 hoặc 410 thì `revokedAt` được đặt và subscription đó không được gửi lại; subscription còn lại của người đó vẫn nhận.
- [ ] FR-06: test quét mọi mẫu nội dung push và payload không chứa SĐT, CCCD, email, nội dung nhật ký/ghi chú; deep link chỉ là đường dẫn nội bộ có `id`.
- [ ] FR-07: cờ `FEATURE_CRM_PUSH=false` thì không có lời gọi dịch vụ push và `pushStatus = SKIPPED`; bật cờ không sửa code; khóa riêng VAPID không có trong repo, image, log (kiểm bằng quét repo và log); khóa công khai đến được FE.
- [ ] FR-08: runbook khóa VAPID đủ bước để người khác tự tạo khóa, đặt `subject` (`mailto:info@stnd.vn`) và biến, thử gửi 1 push, có mục tắt khẩn cấp và xoay khóa; `devops-agent` đã làm theo thử trên bản sạch.
- [ ] FR-09 và nghiệm thu thật: tại web admin PWA, đăng ký subscription từ **một iPhone (PWA đã cài, iOS 16.4+) và một Android (PWA/Chrome) thật**, bằng thao tác bấm nút bật thông báo ở Cài đặt (không xin quyền tự động); iPhone chạy trong tab Safari thường chỉ thấy hướng dẫn "Thêm vào Màn hình chính"; tạo một thông báo CRM thật (ví dụ phân khách) và **cả hai thiết bị nhận push**, bấm vào (service worker `notificationclick`) mở đúng trang; tắt thông báo/hủy subscription thì ngừng nhận. Không cam kết thời gian đến, kể cả khi PWA đóng hẳn trên iPhone (Oniichan đã chấp nhận, mục 8).
- [ ] FR-10, FR-11: bật/tắt push từng loại và đặt giờ yên lặng ở web admin có hiệu lực thật; không còn mock "đẩy thông báo" (nếu đã xác nhận ở Câu hỏi 5).

**Giai đoạn D–E và chung:**

- [ ] Mỗi mục Sửa lỗi (FR-19 đến FR-37, tức PT-042 đến PT-060) đã làm có test đi kèm và đã qua `qa-agent` review; mục không làm ghi `Hoãn` kèm lý do.
- [ ] FR-29 (PT-052), FR-13: các tài liệu liên quan đã cập nhật số phiên bản tài liệu (`v1.0.4`) và bảng mục 4 của `README.md` thư mục `08_Quan_Ly_Phien_Ban`; không còn mục "Lệch tài liệu" của M3–M5 chưa đồng bộ.
- [ ] Số phiên bản `1.0.4` đã nâng trong `package.json` và lockfile của ba ứng dụng và `app.json` của `RealEstateApp`; bảng ở `README.md` cập nhật.
- [ ] Build và test của backend và web admin xanh (ngoại trừ các lỗi có sẵn đã ghi ở FR-30 (PT-053), FR-31 (PT-054) nếu chưa xử lý); `qa-agent` không còn lỗi Critical/High.
- [ ] Lỗi mới (mục 2.3): mỗi lỗi có mã `PT-xxx`, được xử lý (`Xong`) hoặc `Hoãn` có lý do được Oniichan đồng ý.
- [ ] FR-38 (PT-032): test cho thấy mobile bấm chuông điều hướng sang màn Thông báo (không mở popup), trang đầu đúng 20 mục, cuộn tới cuối gọi trang kế và dừng khi hết, không gọi trùng khi đang tải; desktop dropdown không tràn viewport, có tab Tất cả/Chưa đọc, bấm dòng thì đánh dấu đã đọc và điều hướng theo `deepLink`, số chưa đọc và danh sách cùng cập nhật; Oniichan thử trên iPhone thật và desktop, không còn cửa sổ lệch/cắt.
- [ ] FR-39 (PT-033): Cài đặt CRM có tab "Kết quả liên hệ" (desktop và mobile, chỉ Quản trị thấy); thêm, sửa, ẩn, khôi phục chạy thật với API; mục mới xuất hiện ngay ở ô chọn của form Ghi chú chăm sóc; có test cho tab, quyền và lỗi; đã có danh sách kết quả rà các danh mục khác còn thiếu màn và Oniichan quyết từng mục.
- [ ] FR-40 (PT-034): có tài liệu thiết kế được duyệt; dữ liệu danh mục lưu và đưa ra (API, export, audit) có `code` kèm `label`, `<option value>` là `code`; đổi nhãn không làm vỡ dữ liệu/báo cáo; migration chạy lại an toàn, có đường lùi và đã thử trên bản sao dữ liệu thật; người dùng và nhóm vẫn dùng ObjectId; `qa-agent` không còn lỗi Critical/High. Nếu dời sang v1.0.5 thì ghi `Hoãn` có lý do và được Oniichan đồng ý.
- [ ] FR-41 (PT-035): Cài đặt CRM có màn Trường chân dung (chỉ Quản trị): sửa nhãn và lựa chọn của trường chọn, bật/tắt, đổi thứ tự (đợt 1), thêm/bớt trường (đợt 2); thay đổi có hiệu lực ngay ở form chân dung; test chứng minh đổi lựa chọn không làm mất dữ liệu cũ, trường hệ thống không xóa được, không đổi kiểu trường đã có dữ liệu; `qa-agent` review.
- [ ] FR-42 (PT-036): Cài đặt CRM có tab Thẻ (chỉ Quản trị): đổi tên/nhóm/màu, gộp, xóa mềm, xem `usageCount`; sau gộp khách chuyển sang thẻ đích và thẻ cũ không còn ở bộ lọc/gắn hàng loạt; có test.

## 7. Câu hỏi còn mở

> Chỗ mơ hồ/thiếu thông tin và các giả định cần Oniichan xác nhận, chưa được trả lời. `/spec-clarify` hỏi từng câu một, rồi chuyển câu đã trả lời sang mục 8 và xóa khỏi đây.

1. **Loại thông báo nào được gửi push?** (phân khách, nhật ký mới, đề nghị tham gia, nhắc lịch hẹn, dịp đặc biệt, khách lâu chưa chăm sóc, cảnh báo bảo mật, tự đổi tình trạng theo tiến độ...). Mặc định bật tất cả? `SECURITY_ALERT` có cho người dùng tắt không? (ảnh hưởng FR-03, FR-10)
2. Nội dung push **có được hiện tên khách** (màn khóa điện thoại) không? Tài liệu 04 cho phép "tên khách và loại việc", nhưng tên khách vẫn là dữ liệu cá nhân; hay dùng nội dung chung ("Bạn được phân một khách mới")? (ảnh hưởng FR-06)
3. **Giờ yên lặng:** có giá trị mặc định không? Cảnh báo bảo mật hoặc nhắc lịch hẹn sắp tới có được bỏ qua giờ yên lặng không? (ảnh hưởng FR-03, FR-10)
4. **Cách bật ở production:** bật cho mọi người cùng lúc hay thử với danh sách tài khoản (allowlist) vài ngày trước? Có môi trường thử riêng (HTTPS, domain thử) không? (ảnh hưởng FR-07, mục 3 quy tắc 14)
5. Mock "đẩy thông báo" ở web admin (M6 ghi "còn mock có cờ") **còn tồn tại không**, và việc gỡ thuộc M7 (FR-11) hay M8? (ảnh hưởng FR-11)
6. Giữ số **1.0.4** cho phiên bản có tính năng mới (theo semver thuần là 1.1.0) như ngoại lệ đã chấp nhận ở v1.0.2? (ảnh hưởng mục 6, quy ước README)
7. Giới hạn **số thiết bị (subscription) tối đa mỗi người** và thời hạn dọn subscription không dùng (ví dụ 60 hoặc 90 ngày) cho FR-05? (ảnh hưởng FR-01, FR-05)
8. `qa-agent` cần đối chiếu hiện trạng các việc "còn theo dõi" của M0/M1 (Throttler Redis, sanitize NoSQL, Winston che PII, AAD bắt buộc cho CCCD, idempotency key scope theo user) vì bảng milestone không ghi đã đóng; việc nào đã xong thì bỏ khỏi FR-14 (PT-037), FR-15 (PT-038), FR-19 (PT-042), FR-20 (PT-043). (ảnh hưởng FR-14, FR-15, FR-19, FR-20)
9. Khi bật ảnh đính kèm (2026-11-02), đã thử ảnh có **GPS thật** chưa? Tài liệu chỉ ghi "đính kèm ảnh: OK". (ảnh hưởng FR-17 (PT-040))
10. **Lỗi mới** Oniichan sẽ nêu: khi nào gửi phần còn lại của danh sách (đã có PT-032 đến PT-036, mã PT tiếp theo `PT-061`), và lỗi mức Blocker/Major (kể cả PT-032, PT-033) có được chen lên trước M7 không? (ảnh hưởng mục 2.3, mục 4)
11. Điểm a11y còn để mở từ v1.0.3 (mục 7 câu 24 của file v1.0.3): sidebar mobile khi đóng vẫn nằm trong thứ tự phím Tab; đưa vào v1.0.4 (khi đó cấp mã PT kế tiếp từ `PT-061` kèm mã FR kế tiếp ở mục 2.2) hay `Bỏ`? (chưa gắn FR)
12. **PT-035 (Trường chân dung):** Oniichan có đồng ý chia hai đợt (đợt 1 sửa nhãn/lựa chọn/bật tắt/thứ tự; đợt 2 thêm/bớt trường) và nếu không kịp v1.0.4 thì dời đợt 2 sang v1.0.5 không? (ảnh hưởng FR-41 (PT-035))
13. **Mục nhỏ của rà soát danh mục:** có đưa vào v1.0.4 không: "loại hình" dự án thành danh mục/dùng chung lựa chọn; ô kết quả cuộc gọi trong `CallModal` (chỉ cần khi bật cờ cuộc gọi trong app); loại thẻ `OTHER` chưa có chỗ chọn; bộ lọc nâng cao theo chân dung? (ảnh hưởng mục 2.3, FR-39 đến FR-42, tức PT-033 đến PT-036)

## 8. Làm rõ

> Ghi lại đáp án đã chốt: `- (YYYY-MM-DD) Hỏi: … → Đáp: … (ảnh hưởng FR-xx)`.

- (2026-11-04) Hỏi: Phạm vi tính năng giai đoạn 2 cho v1.0.4 → Đáp: **chỉ M7 Push** (bật `FEATURE_CRM_PUSH`, đích push thật đến iPhone + Android; cách làm đã đổi sang Web Push (VAPID) cho PWA theo ba dòng 2026-11-04 ở cuối mục này); M8 đến M12 để các phiên bản sau (ảnh hưởng FR-01 đến FR-13, mục 1.3)
- (2026-11-04) Hỏi: Sửa lỗi trong v1.0.4 gồm gì → Đáp: (a) backlog QA M0–M6 theo mức Phải có/Nên có/Tùy chọn; (b) lỗi mới Oniichan nêu theo từng đợt, mã từ `PT-032` (ảnh hưởng FR-14 đến FR-37, tức PT-037 đến PT-060, mục 2.3). Ý thứ ba ban đầu (việc dở của v1.0.3) đã được bỏ khỏi v1.0.4, xem dòng ngay dưới
- (2026-11-04) Hỏi: Việc dở của v1.0.3 (PT-005, PT-006 và các mục `Xong một phần`) có còn chuyển sang v1.0.4 không → Đáp: **Oniichan xác nhận việc dở v1.0.3 đã xong hết** (gồm kiểm trên iPhone/Android thật, VPS, AI qua 9Router, nới đĩa) và v1.0.3 đã deploy production ngày 2026-11-04, nên bỏ khỏi v1.0.4. Hệ quả: bỏ mục "Việc dở v1.0.3" và giai đoạn đóng v1.0.3; các FR đánh số lại, FR-48 (PT-032) thành FR-38; tổng còn 38 yêu cầu; các câu hỏi mở về thứ tự deploy v1.0.3/v1.0.4 và về PT-005 hết căn cứ nên đã xóa (ảnh hưởng mục 1, 2, 4, 5, 6, 7)
- (2026-11-04) Hỏi: Push M7 nhận ở đâu (câu hỏi cũ 1) và có chấp nhận nghiệm thu ở mức server không (câu hỏi cũ 2) → Đáp: **M7 nhận push ở PWA (Web Push)**: web admin chạy dạng PWA cài được trên iPhone (Safari, iOS 16.4 trở lên, phải Thêm vào Màn hình chính, quyền thông báo xin qua một thao tác bấm của người dùng) và Android (Chrome). Không còn đích là app Expo (M9); nghiệm thu bằng push thật đến iPhone PWA và Android PWA, không cần hạ xuống mức server. Hai câu hỏi cũ 1 và 2 đã xóa khỏi mục 7 (ảnh hưởng FR-09, FR-10, FR-12, mục 1, 4, 5, 6)
- (2026-11-04) Hỏi: Có cần APNs và Apple Developer ở M7 không (câu hỏi cũ 3) → Đáp: **bỏ APNs và Apple Developer khỏi M7, dời sang M9** (app native sau này). Câu hỏi cũ 3 đã xóa khỏi mục 7 (ảnh hưởng FR-02, FR-07, FR-08, mục 1.3, 4.2, 5)
- (2026-11-04) Hỏi: Dùng Firebase/FCM hay Web Push chuẩn → Đáp: **Web Push chuẩn (VAPID), không dùng Firebase/FCM** trong M7. Hệ quả: không còn Firebase project, service account Firebase, khóa APNs; thay bằng cặp khóa VAPID (tạo một lần, khóa riêng chỉ ở biến môi trường/secret trên VPS, khóa công khai đưa cho FE) và `subject` liên hệ VAPID; backend gửi bằng thư viện Web Push chuẩn, `FcmPushProvider` đổi thành `WebPushProvider`; "device token" thành push subscription của trình duyệt (endpoint + khóa `p256dh`/`auth`), nên endpoint `/device-tokens`, schema `device_tokens` và trường `platform` có thể đổi tên/đổi trường, **để `architect-agent` quyết**; 404/410 từ dịch vụ push thì thu hồi subscription; tên biến đề xuất `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, để `devops-agent` chốt (ảnh hưởng FR-01, FR-02, FR-04, FR-05, FR-07, FR-08, FR-09, FR-12, FR-13, mục 3)
- (2026-11-04) Hỏi: Có chuyển mã sang FR thay cho PT không → Đáp: Oniichan duyệt giữ cả hai: FR để truy vết, PT cho mọi dòng sửa lỗi nối tiếp v1.0.3 (ảnh hưởng FR-14 đến FR-42)
- (2026-11-04) Hỏi: Push khi PWA đã đóng hẳn trên iPhone (có thể trễ, bị gộp, bị chế độ Focus/tiết kiệm pin chặn, hoặc không đến) có chấp nhận mức nghiệm thu "đến được trong điều kiện thử thông thường trên máy thật", không cam kết thời gian đến, không → Đáp: **Oniichan chấp nhận**, không cam kết thời gian đến; câu hỏi cũ 14 đã xóa khỏi mục 7 (ảnh hưởng FR-09, FR-12, mục 5 rủi ro 3, mục 6)
- (2026-11-04) Hỏi: `subject` VAPID dùng email hay URL, địa chỉ cụ thể là gì → Đáp: **dùng email `info@stnd.vn`**, tức `VAPID_SUBJECT=mailto:info@stnd.vn` (giá trị không bí mật, được ghi trong tài liệu); câu hỏi cũ 15 đã xóa khỏi mục 7 (ảnh hưởng FR-07, FR-08, mục 3 quy tắc 13, mục 4.2)

---

Tài liệu liên quan: `08_Quan_Ly_Phien_Ban/01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md` (PT-030: PWA), `08_Quan_Ly_Phien_Ban/README.md`, `06_Module_Customer_Management/04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`, `06_Module_Customer_Management/05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`, `06_Module_Customer_Management/06_Theo_Doi_Milestone_Module_Quan_Ly_Khach_Hang.md`, `01_Infrastructure/06_Production_Deploy.md`
