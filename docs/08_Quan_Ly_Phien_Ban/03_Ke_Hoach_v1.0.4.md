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

1. **Giao tính năng giai đoạn 2 duy nhất: M7 Web Push (VAPID) cho PWA** (Oniichan chốt 2026-11-04), để thông báo CRM thuộc **danh mục 5 loại push** (được mời cùng phụ trách một khách, nhật ký chăm sóc mới, nhắc lịch hẹn, khách lâu chưa chăm sóc, tự đổi tình trạng theo tiến độ; xem mục 2.1.1) đến được **iPhone (Safari, iOS 16.4 trở lên, đã Thêm vào Màn hình chính) và Android (Chrome)** đã cài web admin dạng PWA khi không mở web. Dùng Web Push chuẩn (cặp khóa VAPID), không dùng Firebase/FCM, không cần APNs hay Apple Developer.
2. **Dọn backlog QA của M0–M6** (FR-14 đến FR-37, tức PT-037 đến PT-060: bảo mật/PII, hiệu năng nhỏ, lệch tài liệu; riêng FR-17 (PT-040) đã `Bỏ` theo quyết định của Oniichan 2026-11-04), ưu tiên các việc là điều kiện an toàn trước khi bật push (FR-14, FR-15, FR-16, FR-18); cộng với **lỗi mới và cải tiến Oniichan nêu** (đã có PT-032 đến PT-036 và PT-061 đến PT-065, tức FR-38 đến FR-42 và FR-45 đến FR-49; mã PT tiếp theo `PT-066`, mã FR tiếp theo `FR-50`). Oniichan cho phép lỗi nhẹ (sửa giao diện) được chen lên trước hoặc làm song song M7 (mục 8).

### 1.2 Người dùng / Stakeholder

| Vai trò | Nhu cầu |
|---|---|
| Nhân viên / Quản lý nhóm (STAFF, MANAGER) | Nhận thông báo kịp thời trên điện thoại đã cài PWA (5 loại ở mục 2.1.1); tự bật/tắt từng loại và tự chọn giờ yên lặng của mình (mặc định không có giờ yên lặng) |
| Quản trị (ADMIN) | Bật/tắt push toàn hệ thống bằng cờ; không lộ dữ liệu khách ra dịch vụ bên ngoài (cảnh báo bảo mật `SECURITY_ALERT` vẫn chỉ vào hộp thông báo trong app, không gửi push ở v1.0.4) |
| Oniichan (chủ hệ thống) | Cho phép tạo/lưu khóa VAPID trên VPS (`subject` đã chốt `mailto:info@stnd.vn`); chạy deploy trên VPS; thử máy thật iPhone và Android; bổ sung lỗi mới |
| `devops-agent` | Cấu hình bí mật, cờ, runbook khóa VAPID, deploy |
| `qa-agent` | Review code/test, kiểm chứng DoD từng mốc |

### 1.3 Trong phạm vi / Ngoài phạm vi

- **Trong phạm vi:**
  - M7 Web Push (VAPID) cho PWA: backend (`WebPushProvider`, lưu push subscription, job gửi), hạ tầng khóa VAPID, bật cờ, và phía web admin PWA (service worker xử lý push và click, đăng ký/hủy subscription, nút bật/tắt thông báo ở Cài đặt), kèm **danh mục loại thông báo push có mã** (5 loại, mục 2.1.1, FR-43) và **dịch vụ phát thông báo dùng chung** làm điểm vào duy nhất cho mọi module (FR-44).
  - Backlog QA M0–M6 theo 3 mức ưu tiên (mục 2.2).
  - Lỗi mới do Oniichan nêu sau (mục 2.3).
- **Ngoài phạm vi (để các phiên bản sau):**
  - **M8** Import/Export chung + Dashboard (và gỡ mock Báo cáo/nhập xuất): không liên quan push, làm sau để v1.0.4 gọn; khi làm phải giữ quy tắc "CSV không kích hoạt tự đổi tình trạng" (PT-023).
  - **MCP / API cho agent bên ngoài đẩy thông báo** (Oniichan sẽ viết sau, 2026-11-04): xác thực nguồn ngoài, giới hạn tần suất, danh sách loại được phép đẩy, chặn nội dung tự do chứa dữ liệu cá nhân. v1.0.4 **chỉ** yêu cầu điểm vào phát thông báo dùng chung (FR-44) được thiết kế đủ tổng quát để việc này làm sau mà không sửa bộ gửi; bản thân MCP/endpoint ngoài không làm ở v1.0.4.
  - **Mở rộng danh mục push ngoài 5 loại** (cảnh báo bảo mật `SECURITY_ALERT`, dịp đặc biệt `CUSTOMER_OCCASION`, nhắc việc tiếp theo `FOLLOW_UP_DUE`, đề nghị tham gia nhóm chăm sóc `CARE_TEAM_JOIN_REQUESTED`/`CARE_TEAM_JOIN_RESOLVED`): Oniichan sẽ bổ sung sau bằng cách thêm dòng vào danh mục (FR-43); không gửi push ở v1.0.4.
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
| FR-01 | Tính năng | Đăng ký/hủy push subscription của trình duyệt: lưu endpoint + khóa `p256dh`/`auth` theo người dùng, upsert theo endpoint; có API đăng ký, hủy và `POST /auth/logout` kèm id subscription. Tên endpoint/schema/trường (hiện thiết kế là `POST /device-tokens`, `DELETE /device-tokens/:id`, `device_tokens`) và việc thay `platform` (IOS/ANDROID/WEB) bằng thông tin trình duyệt/thiết bị nếu cần: **để `architect-agent` quyết**. **Giới hạn tối đa 3 thiết bị (subscription còn hiệu lực) mỗi người (Oniichan chốt 2026-11-04):** khi một người bật thiết bị thứ 4 thì subscription có hoạt động gần nhất lâu nhất bị gỡ tự động (thu hồi), và người dùng được báo biết ở trang "Cài đặt thông báo" (ví dụ "đã gỡ thiết bị X để nhường chỗ"); định nghĩa "hoạt động" xem FR-05 | Phải có | M7; tài liệu 04 mục 3, 05 mục 2.10 |
| FR-02 | Tính năng | `WebPushProvider` (thay `FcmPushProvider`) gửi bằng thư viện Web Push chuẩn với khóa VAPID tới iPhone (PWA đã cài) và Android (PWA/Chrome), thay `NoopPushProvider` khi bật cờ; timeout 5 giây | Phải có | M7 |
| FR-03 | Tính năng | Luồng gửi push bằng job BullMQ sau khi transaction nghiệp vụ commit, **nhận yêu cầu từ điểm vào chung (FR-44) và chỉ gửi các loại có trong danh mục push (FR-43, mục 2.1.1)**: đọc cài đặt thông báo (`push` từng loại), **giờ yên lặng là cài đặt cá nhân của người nhận, mặc định tắt (Oniichan chốt 2026-11-04); đang trong giờ yên lặng của người nhận thì `SKIPPED`**, ghi `pushStatus` (SENT/SKIPPED/FAILED), retry backoff có jitter tối đa 5 lần, không gửi trùng | Phải có | M7; tài liệu 04 mục 6.3 |
| FR-04 | Tính năng | Xử lý subscription hết hạn/không còn hợp lệ: dịch vụ push trả HTTP 404/410 thì thu hồi (`revokedAt`), không thử lại subscription đó | Phải có | M7 |
| FR-05 | Tính năng | Dọn subscription lâu không hoạt động: **subscription 90 ngày không hoạt động thì tự xóa** (Oniichan chốt 2026-11-04; người dùng bật lại thông báo nếu cần), chạy bằng job định kỳ **idempotent** (chạy lại không gây lỗi hay xóa thừa; ca biên đúng 90 ngày do `architect-agent` chốt). **Định nghĩa "hoạt động" (đề xuất: lần đăng ký lại/làm mới subscription, lần gửi push thành công, hoặc lần mở web admin đã cài) và trường theo dõi (hiện là `lastSeenAt`) để `architect-agent` quyết**, Plan không tự chốt. Cũng là căn cứ để chọn "ít hoạt động nhất" khi vượt 3 thiết bị ở FR-01 | Nên có (nâng từ Tùy chọn 2026-11-04 vì đã có yêu cầu cụ thể) | M7 (đề xuất bổ sung); Oniichan 2026-11-04 |
| FR-06 | Tính năng | Nội dung push an toàn PII: tiêu đề và nội dung ngắn **theo mẫu nội dung của từng loại trong danh mục push (mục 2.1.1, Oniichan chốt 2026-11-04: nội dung theo mô tả của loại push đó)**; payload chỉ gồm mẫu đã điền biến cho phép, loại thông báo và deep link; **không mẫu nào chứa SĐT, CCCD, email, nội dung nhật ký/ghi chú/lời nhắn**; có test quét cả 5 mẫu chặn các dữ liệu đó | Phải có | M7; tài liệu 04 mục 8 (QT10) |
| FR-07 | Tính năng | Cấu hình và bí mật VAPID: cặp khóa VAPID tạo một lần; biến môi trường đề xuất `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (tên chính xác do `devops-agent` chốt; **giá trị đã chốt `VAPID_SUBJECT=mailto:info@stnd.vn`**, không bí mật nên được ghi trong tài liệu); khóa riêng chỉ ở biến môi trường/secret trên VPS (không vào repo/image), khóa công khai đưa cho FE; bật `FEATURE_CRM_PUSH` qua compose/`.env.docker` **ở production cho mọi người cùng lúc, không allowlist, không môi trường thử riêng (Oniichan chốt 2026-11-04)**; cờ tắt thì quay về Noop và phải tắt được ngay chỉ bằng đổi biến môi trường, không đổi code (quay lui nhanh); health/readiness không sập khi dịch vụ push lỗi | Phải có | M7 |
| FR-08 | Tính năng | Runbook khóa VAPID trong `06_Production_Deploy.md` (tạo cặp khóa một lần, đặt `subject` đã chốt `mailto:info@stnd.vn`, đặt biến trên VPS, đưa khóa công khai cho FE, thử gửi 1 push, cách tắt khẩn cấp, cách xoay khóa và hệ quả: đổi khóa thì subscription cũ mất hiệu lực, người dùng phải bật lại) | Phải có | M7; milestone mục 5 |
| FR-09 | Tính năng | Phía web admin PWA: (a) service worker xử lý sự kiện `push` (hiện thông báo) và `notificationclick` (mở đúng trang theo deep link); hiện service worker PWA **chưa xử lý push** (theo PT-030); (b) đăng ký/hủy subscription từ trình duyệt; (c) nút bật/tắt thông báo của thiết bị này đặt ở trang "Cài đặt thông báo" cá nhân (**web admin chưa có trang này, phải tạo mới**; FR-10 bổ sung phần bật/tắt từng loại và giờ yên lặng trên cùng trang), xin quyền thông báo qua thao tác bấm của người dùng; (d) trên iPhone chỉ hiện nút bật khi web chạy ở chế độ đã cài (standalone), chưa cài thì hiện hướng dẫn "Thêm vào Màn hình chính". **Đích nghiệm thu: push thật đến iPhone (PWA đã cài, iOS 16.4+) và Android (PWA/Chrome), không cam kết thời gian đến (Oniichan đã chấp nhận 2026-11-04)** | Phải có | M7; v1.0.3 PT-030 |
| FR-10 | Tính năng | **Tạo mới trang "Cài đặt thông báo" cá nhân ở web admin** (đã kiểm 2026-11-04: web admin chưa có trang này, không có tham chiếu `quietHours` hay `notification-preferences` ở `RealEstateAdminApp/src`; backend đã có module `notifications` với `notification-preferences`), gọi API `GET/PUT /notification-preferences/me` đã có (tài liệu 05; nếu tài liệu 04/05 mô tả API khác với giả định thì `architect-agent` đối chiếu). Phần thiết bị (nút bật/tắt push của trình duyệt này) thuộc FR-09; FR-10 bổ sung trên cùng trang, khớp hành vi push thật: bật/tắt `push` **từng loại trong danh mục push (5 loại, FR-43, mục 2.1.1; danh sách loại ở trang lấy từ danh mục)**; **giờ yên lặng do mỗi người tự bật/tắt và tự chọn khung giờ trong cài đặt thông báo cá nhân, mặc định TẮT (Oniichan chốt 2026-11-04)**, có hiệu lực thật với push, múi giờ `Asia/Ho_Chi_Minh`, khung giờ được phép qua nửa đêm (ví dụ 22:00 đến 06:00); **backend đã có `quietHours` (M5) trong `notification_preferences`, giao diện chọn giờ chưa có nên phải làm**; bỏ ghi chú "chưa có hiệu lực" nếu có. Không loại nào được ngoại lệ bỏ qua giờ yên lặng ở v1.0.4 | Nên có | M5 (việc để lại: giờ yên lặng), M7 |
| FR-11 | Tính năng | **Không còn việc, trạng thái `Bỏ (không còn đối tượng)`:** đã kiểm code ngày 2026-11-04, web admin **không có mock "đẩy thông báo"** (`featureFlags.ts` chỉ có hai cờ mock là `isMockReportsEnabled` (Báo cáo) và `isMockImportExportEnabled` (nhập/xuất); không có màn/hàm đẩy thông báo hay push broadcast; hook `useUnreadNotificationCount` chỉ ghi chú "chưa có push, M7"). Giữ mã FR-11 để không đánh lại mã | — | M6, M7; Oniichan yêu cầu kiểm 2026-11-04 |
| FR-12 | Tính năng | Bộ test và nghiệm thu M7: unit + integration với dịch vụ push giả lập (kể cả lỗi tạm, subscription hết hạn 404/410, hết hạn mức), E2E chống gửi trùng khi restart, thử thật trên iPhone (PWA đã cài) và Android | Phải có | M7 |
| FR-13 | Tính năng | Cập nhật tài liệu cho M7: 04 (mục 6.3, 10, 11; thêm danh mục loại thông báo push và thiết kế điểm vào phát thông báo chung), 05 (API push subscription, điểm vào phát thông báo nếu có API), bảng milestone 06, `06_Production_Deploy.md`, `.env.docker.example` | Nên có | M7 |
| FR-43 | Tính năng | **Danh mục loại thông báo push làm cấu hình có mã (registry)**: mỗi loại có `Mã push` duy nhất, tên, mẫu nội dung (tiêu đề + dòng nội dung), mẫu deep link, quy tắc người nhận, mặc định bật/tắt, cờ cho phép người dùng tắt; thêm loại mới chỉ là thêm một dòng trong danh mục, **không sửa bộ gửi**; danh mục ở v1.0.4 lấy đúng 5 loại ở bảng mục 2.1.1 (danh sách đóng). Trang cài đặt thông báo (FR-10) và bộ gửi (FR-03) đọc danh sách loại từ danh mục này | Phải có | Oniichan 2026-11-04 (mục 8); mục 2.1.1 |
| FR-44 | Tính năng | **Dịch vụ phát thông báo dùng chung, tái sử dụng được** (ví dụ `NotificationDispatcher`): **một điểm vào duy nhất** nhận một "yêu cầu thông báo" chuẩn (mã loại thuộc danh mục, người nhận, dữ liệu để dựng nội dung, đường dẫn đích, khóa chống trùng) rồi lo ghi hộp thông báo trong app, chọn kênh theo cài đặt người dùng, xếp hàng và gửi Web Push (qua `WebPushProvider`); các module CRM (phân khách, nhật ký, lịch hẹn, quét khách lâu chưa chăm sóc, tự đổi tình trạng) gọi qua điểm vào này thay vì tự gửi. **Mục tiêu tái sử dụng:** sau này Oniichan sẽ viết MCP cho agent bên ngoài đẩy thông báo; điểm vào được thiết kế đủ tổng quát để một API/MCP gọi lại được mà không sửa bộ gửi. **Ngoài phạm vi v1.0.4:** bản thân MCP/endpoint cho agent ngoài (xác thực nguồn ngoài, giới hạn tần suất, danh sách loại cho phép, chặn tự do nhập nội dung chứa dữ liệu cá nhân); chỉ yêu cầu thiết kế không chặn đường làm sau. Giao `architect-agent` thiết kế trước FR-03 | Phải có | Oniichan 2026-11-04 (mục 8) |

> **FR-43 và FR-44 thêm sau (2026-11-04)**, nên mã nằm sau FR-42 ở mục 2.3 nhưng thuộc nhóm M7 (giai đoạn B, mục 4.1); không đánh lại mã FR khác. FR-45 đến FR-49 là các lỗi mới/cải tiến nhận sau (PT-061 đến PT-065, mục 2.3); mã FR tiếp theo là `FR-50`.

#### 2.1.1 Danh mục loại thông báo push (v1.0.4)

> **Danh sách chỉ gồm 5 loại dưới đây (danh sách đóng).** Các loại thông báo khác của hệ thống (ví dụ cảnh báo bảo mật `SECURITY_ALERT`, dịp đặc biệt `CUSTOMER_OCCASION`, nhắc việc tiếp theo `FOLLOW_UP_DUE`, đề nghị tham gia nhóm chăm sóc `CARE_TEAM_JOIN_REQUESTED`/`CARE_TEAM_JOIN_RESOLVED`) **KHÔNG gửi push ở v1.0.4**: chúng vẫn vào hộp thông báo trong app như hiện nay (`pushStatus = SKIPPED`). Sau này bổ sung loại push mới bằng cách **thêm một dòng vào danh mục này** (FR-43), không sửa bộ gửi. Oniichan chốt danh sách và thứ tự ngày 2026-11-04 (mục 8).

`Mã push` là **mã loại thông báo đã dùng ở hộp thông báo** (`notifications.type`, tài liệu 04 mục 3.6.1), nên một thông báo trong app và push của nó cùng một mã và cùng một thông báo gốc (một thông báo = một push). Cả 5 mã lấy từ tài liệu 04; riêng loại 1 dùng chung mã `CUSTOMER_ASSIGNED` với thông báo trong app nhưng **chỉ một phần các tình huống của mã đó có push** (Oniichan chốt 2026-11-04, xem dòng 1).

| # | `Mã push` | Tên tiếng Việt | Khi nào gửi (sự kiện kích hoạt) | Người nhận | Mẫu nội dung push (tiêu đề / dòng nội dung) | Liên kết khi bấm (deep link) | Mặc định | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| 1 | `CUSTOMER_ASSIGNED` (từ tài liệu; push chỉ cho một phần tình huống của mã) | Được mời cùng phụ trách một khách | **Chỉ khi người dùng được thêm vào nhóm chăm sóc của khách với vai trò người cùng phụ trách (không phải phụ trách chính)** (Oniichan chốt 2026-11-04). Theo tài liệu 04 (mục 3.6.1 và M5), mã `CUSTOMER_ASSIGNED` hiện sinh ra ở nhiều tình huống; phân loại cho push: **CÓ push** khi thêm vào nhóm chăm sóc làm người cùng phụ trách, kể cả qua "duyệt đề nghị tham gia" và "thêm hàng loạt người cùng chăm sóc" (kết quả là người đó trở thành người cùng phụ trách mới); **KHÔNG push** khi được đặt làm phụ trách chính, khi tạo khách có phân người, và với phân hàng loạt kiểu "đổi phụ trách chính" (các tình huống này vẫn ghi vào hộp thông báo trong app như hiện nay, `pushStatus = SKIPPED`). Không báo cho chính người thực hiện | Người được thêm làm người cùng phụ trách (trừ chính người thực hiện) | Tiêu đề: `Bạn được mời cùng phụ trách một khách`. Nội dung: `{tên người thực hiện} đã thêm bạn vào nhóm chăm sóc khách {tên khách}.` **Có tên khách** | `data.deepLink` của thông báo (đề xuất `/crm/customers/:id`) | Bật | Thông báo trong app đã có, không phải thêm loại mới. Danh mục cần có **điều kiện gửi push** (vai trò = người cùng phụ trách) để tách tình huống có push khỏi tình huống không push của cùng mã `CUSTOMER_ASSIGNED`; cách thể hiện (điều kiện trên mã, hay yêu cầu thông báo mang thêm vai trò/cờ) do `architect-agent` quyết. **`architect-agent` đối chiếu đường thêm hàng loạt người cùng chăm sóc để gộp hoặc giới hạn push, tránh bão thông báo** (mỗi người được thêm là một push) |
| 2 | `CARE_LOG_ADDED` (từ tài liệu) | Nhật ký chăm sóc mới | Người cùng chăm sóc ghi nhật ký mới của khách; gộp theo khách trong `careLogNotifyDebounceMinutes` (mặc định 10 phút, 0 = không gộp) nên nhiều nhật ký của cùng khách trong khoảng đó chỉ có một thông báo, tức một push | Các thành viên khác trong nhóm chăm sóc của khách, trừ người viết | Tiêu đề: `Có nhật ký chăm sóc mới`. Nội dung: `{tên người viết} vừa ghi nhật ký cho khách {tên khách}.` **Có tên khách** | `/crm/customers/:id` | Bật | **Tuyệt đối không có nội dung nhật ký, kết quả liên hệ, bước tiếp theo.** Push đi theo thông báo đã gộp, không gộp thêm lần nữa |
| 3 | `APPOINTMENT_DUE` (từ tài liệu) | Nhắc lịch hẹn | Đến mốc nhắc trước giờ hẹn của lịch hẹn đang `SCHEDULED`; mốc theo `remindBeforeMinutes` của lịch hẹn (mặc định theo `defaultAppointmentReminderMinutes` = 60 và 1440 phút, tức 1 giờ và 1 ngày trước). Mỗi mốc một thông báo; dời giờ hẹn thì sinh nhắc mới theo giờ mới. Mốc của lịch hẹn tính bằng phút (`leadDays` thuộc nhắc dịp `CUSTOMER_OCCASION`, không nằm trong danh mục push) | Người thực hiện lịch hẹn (`assigneeId`) và phụ trách chính của khách (ưu tiên cao) | Tiêu đề: `Sắp đến lịch hẹn`. Nội dung: `{tên loại lịch hẹn} với khách {tên khách} lúc {giờ hẹn}.` (`{giờ hẹn}` dạng `HH:mm dd/MM`, múi giờ `Asia/Ho_Chi_Minh`). **Có tên khách** | `/crm/customers/:id` (khách của lịch hẹn); đi thẳng tới lịch hẹn hay không do `architect-agent`/FE quyết | Bật | `{tên loại lịch hẹn}` là nhãn tiếng Việt của loại lịch hẹn (xem nhà, gặp mặt, ký cọc / HĐMB, gọi lại, khác), **không** dùng `title`, địa điểm, ghi chú do người dùng nhập. Không có ngoại lệ bỏ qua giờ yên lặng |
| 4 | `STALE_CUSTOMER` (từ tài liệu) | Khách lâu chưa chăm sóc | Khách có tình trạng thuộc nhóm Chưa tiếp cận hoặc Có quan tâm quá `staleCustomerDays` (mặc định 14) ngày chưa có nhật ký; quét hằng ngày lúc `staleCheckTime` (mặc định 08:00). **Một lần cho mỗi đợt** lâu chưa chăm sóc (khóa chống trùng theo khách và ngày nhật ký mới nhất hoặc ngày tạo khách), không nhắc lại mỗi ngày | Chỉ phụ trách chính của khách (thành viên khác không nhận; tùy chọn "thành viên tự bật" là FR-37 (PT-060), ngoài danh mục) | Tiêu đề: `Khách lâu chưa được chăm sóc`. Nội dung: `Khách {tên khách} đã {số ngày} ngày chưa có nhật ký chăm sóc.` (`{số ngày}` tính từ nhật ký mới nhất hoặc ngày tạo khách). **Có tên khách** | `/crm/customers/:id` | Bật (cho phụ trách chính) | Lần quét đầu khi bật ở production có thể sinh rất nhiều thông báo: FR-18 (PT-041) giới hạn lô trước khi bật push |
| 5 | `CUSTOMER_STATUS_AUTO_CHANGED` (từ tài liệu, thêm ở v1.0.3, PT-023) | Tự đổi tình trạng theo tiến độ | Tình trạng khách bị **tự** đổi vì người dùng tick tiêu chí: đủ 3/4 tiêu chí thì chuyển sang "Khách net", hạ dưới 3/4 thì về "Có quan tâm"; chỉ khi có đổi thật; không áp dụng cho khách "Bỏ", nhập CSV, thao tác hàng loạt | Thành viên nhóm chăm sóc của khách, trừ người tick tiêu chí | Tiêu đề: `Tình trạng khách tự thay đổi`. Nội dung: `Khách {tên khách} đã chuyển sang "{tình trạng mới}" theo tiến độ.` (`{tình trạng mới}` là nhãn tình trạng đích: "Khách net" hoặc "Có quan tâm"). **Có tên khách** | `/crm/customers/:id` (đã chốt ở PT-023) | Bật | Mức ưu tiên thông thường (`NORMAL`); khóa chống trùng theo (khách, version sau cùng) |

**Quy ước chung cho mẫu nội dung** (theo FR-06 và mục 3 quy tắc 10):

- Chỉ dùng các biến có trong bảng: `{tên khách}`, `{tên người thực hiện}`, `{tên người viết}` (hai biến này là tên nhân viên, không phải dữ liệu khách), `{tên loại lịch hẹn}`, `{giờ hẹn}`, `{số ngày}`, `{tình trạng mới}`. Biến nằm ngoài danh sách này không được dùng.
- **Cấm trong mọi mẫu:** SĐT, CCCD, email, địa chỉ, ngân sách/chân dung, nội dung nhật ký/ghi chú/lời nhắn, `title`/địa điểm/ghi chú của lịch hẹn, kết quả liên hệ. Test quét cả 5 mẫu (mục 6).
- **Tên khách (Oniichan chốt 2026-11-04: mẫu push có hiện tên khách trên màn khóa):** cả 5 mẫu có `{tên khách}` vì thông báo nói về một khách cụ thể (tài liệu 04 mục 8, QT10, cho phép "tên khách và loại việc"). Lưu ý: tên khách vẫn là dữ liệu cá nhân và có thể nhìn thấy ở màn khóa điện thoại; Oniichan đã chấp nhận. **Chỉ tên khách được phép**, vẫn cấm SĐT, CCCD, email, nội dung nhật ký/ghi chú/lời nhắn và các dữ liệu khác ở dòng "Cấm" trên.
- Độ dài (đề xuất, `architect-agent` chốt): tiêu đề tối đa khoảng 50 ký tự, nội dung tối đa khoảng 120 ký tự; tên quá dài thì cắt bớt.
- Mặc định **Bật** cho cả 5 loại theo tài liệu 04 mục 3.6.1 ("mặc định bật tất cả"); người dùng tắt được từng loại ở trang Cài đặt thông báo (FR-10). Không loại nào bị khóa không cho tắt.

### 2.2 Sửa lỗi: backlog QA M0–M6

> Chỉ gồm việc có trong cột Ghi chú của bảng milestone 06. FR-14, FR-15, FR-16, FR-18 (PT-037, PT-038, PT-039, PT-041) là điều kiện an toàn **phải xong trước khi bật `FEATURE_CRM_PUSH` ở production**; FR-17 (PT-040) đã `Bỏ` (Oniichan quyết định 2026-11-04) nên không còn trong điều kiện này. Mã PT = mã FR + 23 (FR-14 là PT-037, FR-37 là PT-060).

| Mã PT | Mã FR | Loại | Việc | Ưu tiên (Phải có / Nên có / Tùy chọn) | Nguồn |
|---|---|---|---|---|---|
| PT-037 | FR-14 | Sửa lỗi | Sanitize chống NoSQL injection ở đầu vào (query/body có toán tử `$...`) | Phải có | M0 (việc nhỏ còn theo dõi) |
| PT-038 | FR-15 | Sửa lỗi | Winston che PII (SĐT, CCCD, email) trong log, kể cả log của luồng push | Phải có | M0 |
| PT-039 | FR-16 | Sửa lỗi | `listDeleted` (khách đã xóa) thêm `guardSearch` như các endpoint tìm kiếm khác (chống dò SĐT) | Phải có | M2 việc để lại (6) |
| PT-040 | FR-17 | Sửa lỗi | **`Bỏ` (Oniichan quyết định 2026-11-04: không cần xóa GPS khi tải ảnh lên).** Việc gốc là kiểm ảnh điện thoại có GPS thật trên production, xác nhận Exif/GPS đã bị bỏ trước khi lưu (điều kiện nêu ở M3 trước khi bật ảnh đính kèm; ảnh đính kèm đã bật từ 2026-11-02). Không còn yêu cầu xóa/kiểm/đảm bảo Exif/GPS của ảnh đính kèm; giữ mã FR-17/PT-040 để không đánh lại mã | Bỏ (trước đây Phải có) | M3 |
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

### 2.3 Lỗi mới và cải tiến do Oniichan nêu (nhận thêm theo từng đợt)

> Oniichan nêu lỗi mới theo từng đợt (sẽ gửi tiếp khi có, không còn là câu hỏi mở). Đã có **`PT-032` đến `PT-036`** (FR-38 đến FR-42) và **`PT-061` đến `PT-065`** (FR-45 đến FR-49); mã PT tiếp theo là **`PT-066`**, mã FR tiếp theo là **`FR-50`** (PT-037 đến PT-060 đã dành cho 24 mục backlog QA ở mục 2.2; FR-43 và FR-44 đã dành cho danh mục và điểm vào phát thông báo push ở mục 2.1; không dùng lại mã đã có). Mỗi lỗi khi nhận được cấp mã `PT-xxx` và `FR-xx` kế tiếp, và ghi chi tiết theo mẫu một mục ở mục 3 của file v1.0.3. Mức độ ở các mục là **đề xuất**, Oniichan rà lại. **Thứ tự (Oniichan chốt 2026-11-04, mục 8):** lỗi nhẹ như sửa giao diện được chen lên trước hoặc làm song song M7; lỗi nặng (Blocker/Major về dữ liệu hoặc bảo mật) vẫn xử lý ngay theo mức độ.

| Mã PT | Mã FR | Mô tả lỗi | Mức độ | Nhóm | Ưu tiên |
|---|---|---|---|---|---|
| PT-032 | FR-38 | Thông báo trên web admin: trên mobile, bấm chuông thì cửa sổ thông báo hiện **lệch ra ngoài mép trái màn hình, bị cắt** (ảnh chụp iPhone ngày 2026-11-04). Oniichan yêu cầu: **mobile** chuyển hẳn sang **một màn hình danh sách thông báo**, hiển thị **20 thông báo mới nhất**, cuộn xuống cuối thì **tải thêm 20** (infinite scroll); **desktop** hiện dropdown **giống Facebook** (neo dưới chuông, tab Tất cả/Chưa đọc, chấm xanh chưa đọc, thời gian tương đối, link "Xem tất cả") | Major (đề xuất) | FE | Phải có |
| PT-033 | FR-39 | Màn **Cài đặt CRM** thiếu tab quản lý **Kết quả liên hệ** để Quản trị tự thêm, sửa, ẩn mục (Oniichan báo ngày 2026-11-04). Hiện Cài đặt có các tab Tình trạng, Nguồn khách, Khu vực, Dự án, Người dùng, Nhóm, Nhắc việc; backend đã có sẵn `POST/PATCH/DELETE /crm/contact-results` (chỉ Quản trị) và lớp gọi API ở FE đã khai báo endpoint này, nên chỉ thiếu giao diện. Oniichan yêu cầu rà thêm các danh mục khác; kết quả rà đã tách thành PT-035 và PT-036 (xem mục "Kết quả rà soát danh mục" bên dưới) | Major (đề xuất) | FE | Phải có |
| PT-034 | FR-40 | **Dữ liệu danh mục lưu dưới dạng ObjectId, không đọc được** (Oniichan báo ngày 2026-11-04): ví dụ nhật ký chăm sóc lưu `contactResultId` là dãy số `6ae7ebd…`, nên người đọc DB hoặc file export (kể cả agent AI) không hiểu nghĩa; giá trị `<option>` ở form cũng là ObjectId. Đề xuất: đổi tham chiếu các danh mục nhỏ sang **`code` chữ ổn định** (đã có sẵn ở backend, duy nhất và không dùng lại kể cả khi xóa mềm), API và export trả cả `code` lẫn `label`, form dùng `code` làm giá trị; kèm migration dữ liệu cũ | Cải tiến (đề xuất) | BE / FE / Dữ liệu | Nên có |
| PT-035 | FR-41 | **Chưa có màn quản lý Trường chân dung** cho Quản trị (kết quả rà soát 2026-11-04). Đây là nguồn của hầu hết ô "chỉ chọn" Oniichan thấy: loại hình, cơ cấu phòng, mục đích mua, người quyết định, kênh ưa thích, hôn nhân, tiêu chí ưu tiên (seed 27 trường, đa số `isSystem`). Backend đã có đủ `POST`, `PATCH`, `DELETE`, `PUT order` (chỉ Quản trị); FE chỉ gọi `GET /crm/persona-fields`. Tài liệu đã hứa tính năng này (yêu cầu X10: Quản trị tự thêm, sửa, bớt trường chân dung) nhưng FE chưa làm | Major (đề xuất) | FE | Phải có |
| PT-036 | FR-42 | **Chưa có màn quản lý Thẻ** (sở thích, nghề nghiệp): mọi vai trò tạo được thẻ nhanh, nhưng sửa tên, gộp, xóa mềm chỉ Quản trị làm được ở backend và FE không có màn nào, nên thẻ gõ sai hoặc trùng không dọn được và bộ lọc/gắn thẻ hàng loạt ngày càng rối | Minor (đề xuất) | FE | Nên có |
| PT-061 | FR-45 | **Sidebar mobile khi đóng vẫn nằm trong thứ tự phím Tab** (thiếu ẩn khỏi cây truy cập khi đóng): điểm a11y còn mở từ v1.0.3 (mục 7 câu 24 của file v1.0.3); Oniichan quyết định đưa vào v1.0.4 (2026-11-04) | Minor / Cải tiến (đề xuất) | FE | Nên có |
| PT-062 | FR-46 | **"Loại hình" (`propertyTypes`) của Dự án đang gõ tay cách nhau dấu phẩy**, tách rời với lựa chọn `property_type` của trường chân dung (mục nhỏ (a) của rà soát danh mục, Oniichan quyết định làm 2026-11-04). Chuyển thành chọn từ danh sách chung, dùng chung lựa chọn của trường chân dung `property_type` (quản lý ở màn PT-035) | Cải tiến (đề xuất) | FE / BE / Dữ liệu | Nên có |
| PT-063 | FR-47 | **Ô "Kết quả liên hệ" trong `CallModal` dùng 5 chuỗi cứng** (`CALL_OUTCOME_OPTIONS`) khác danh mục trong DB (mục nhỏ (b) của rà soát; chưa lộ vì cờ `isInAppCallEnabled` tắt). Chuyển sang dùng danh mục Kết quả liên hệ trong DB, cùng nguồn với form nhật ký; làm sẵn kể cả khi cờ đang tắt | Cải tiến (đề xuất) | FE | Nên có |
| PT-064 | FR-48 | **Loại thẻ `OTHER` có ở BE và FE nhưng form chỉ hiện INTEREST và OCCUPATION** (mục nhỏ (c) của rà soát): thêm chỗ chọn loại `OTHER` ở form gắn thẻ và màn quản lý thẻ (PT-036) | Minor (đề xuất) | FE | Nên có |
| PT-065 | FR-49 | **Bộ lọc nâng cao chưa lọc theo chân dung khách** dù BE hỗ trợ (`isFilterable`, `personaFilterKeys`) (mục nhỏ (d) của rà soát): thêm lọc theo các trường chân dung lọc được vào bộ lọc nâng cao | Cải tiến (đề xuất) | FE | Nên có |
| PT-066 | | _(chờ Oniichan bổ sung; mã FR cấp khi nhận, từ FR-50)_ | | | |

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
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE nhưng lớn. **Chia hai đợt theo thứ tự làm, nhưng làm CẢ HAI đợt trong v1.0.4, cùng một phát hành, không dời đợt 2 sang v1.0.5 (Oniichan quyết định 2026-11-04, mục 8):** (1) sửa nhãn và lựa chọn của trường SELECT/MULTI_SELECT, bật/tắt, đổi thứ tự; (2) thêm/bớt trường. Giữ cứng: kiểu trường (`PersonaFieldType`) và 7 nhóm trường. `coder-backend-agent` kiểm lại quy tắc BE trước khi làm: trường hệ thống không xóa được (`PERSONA_FIELD_SYSTEM`), không đổi `type` khi đã có dữ liệu (`PERSONA_FIELD_TYPE_LOCKED`), trường nhạy cảm/lọc được. Test: quyền chỉ Quản trị, đổi lựa chọn không làm mất dữ liệu cũ, thứ tự |
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

**PT-061 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | Sidebar mobile của web admin (layout chung, thành phần sidebar/drawer; tên file do `coder-frontend-agent` xác định khi làm) |
| Bước tái hiện | 1. Mở web admin trên mobile (hoặc thu hẹp cửa sổ), sidebar đang đóng. 2. Dùng phím Tab (hoặc trình đọc màn hình) đi qua trang |
| Kết quả thực tế | Sidebar đã đóng vẫn nằm trong thứ tự phím Tab (các liên kết trong sidebar vẫn focus được dù không nhìn thấy) |
| Kết quả mong đợi | Khi sidebar mobile đóng, nội dung của nó bị ẩn khỏi cây truy cập và khỏi thứ tự Tab (ví dụ `inert`/`aria-hidden`/`visibility`, cách làm do FE chọn); khi mở thì focus vào được, đóng lại thì không; desktop không đổi |
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE, không đổi API. Test: sidebar đóng thì các phần tử trong đó không focus được/không nằm trong cây truy cập; mở thì có; kiểm Tab trên mobile |
| Người phụ trách | `coder-frontend-agent`, rồi `qa-agent` review |
| Trạng thái | `Mới` (2026-11-04) |

**PT-062 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | Form Dự án ở Cài đặt CRM (trường "loại hình", `propertyTypes`); lựa chọn `property_type` của trường chân dung (màn Trường chân dung của PT-035); API dự án `POST/PATCH /crm/projects` và `GET /crm/persona-fields` (đã có); hiện `propertyTypes` là chữ gõ tay cách nhau dấu phẩy |
| Bước tái hiện | 1. Mở form thêm/sửa Dự án. 2. Xem ô "loại hình" |
| Kết quả thực tế | Ô là chữ gõ tay cách nhau dấu phẩy, dễ gõ sai/trùng, và tách rời với lựa chọn `property_type` của chân dung |
| Kết quả mong đợi | Ô "loại hình" của Dự án là ô **chọn từ danh sách chung**, dùng **chung lựa chọn của trường chân dung `property_type`** (một nguồn duy nhất, Quản trị đổi ở màn PT-035 thì Dự án thấy ngay); dự án cũ có `propertyTypes` gõ tay được chuyển sang lựa chọn tương ứng, giá trị không khớp được giữ lại và báo để Quản trị xử lý (không mất dữ liệu) |
| Phạm vi kỹ thuật (đề xuất) | **FE + BE, có thể cần migration dữ liệu cũ** (có đường lùi, kiểm trên bản sao dữ liệu thật). **Đi cùng thiết kế PT-034 (đổi tham chiếu danh mục sang `code`) và PT-035**: làm sau khi `architect-agent` chốt thiết kế PT-034; mô hình lưu (lưu `code`) do `architect-agent` quyết. Test: chọn nhiều loại, dữ liệu cũ chuyển đúng, đổi nhãn ở PT-035 không làm vỡ dự án |
| Người phụ trách | `architect-agent` (cùng thiết kế PT-034), `coder-backend-agent` + `coder-frontend-agent`; `qa-agent` review code, test và migration |
| Trạng thái | `Mới` (2026-11-04) |

**PT-063 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | `CallModal` (ô "Kết quả liên hệ", hằng `CALL_OUTCOME_OPTIONS` gồm 5 chuỗi cứng); `GET /crm/contact-results` (danh mục DB, cùng nguồn với form nhật ký); cờ `isInAppCallEnabled` (đang tắt) |
| Bước tái hiện | Bật cờ cuộc gọi trong app (môi trường thử), mở `CallModal`, xem ô Kết quả liên hệ |
| Kết quả thực tế | 5 chuỗi cứng khác danh mục trong DB; chưa lộ ở production vì cờ tắt |
| Kết quả mong đợi | Ô "Kết quả liên hệ" trong `CallModal` lấy từ danh mục Kết quả liên hệ trong DB, **cùng nguồn với form nhật ký**; Quản trị thêm/sửa ở tab PT-033 thì `CallModal` thấy ngay; làm sẵn **kể cả khi cờ đang tắt**; bỏ `CALL_OUTCOME_OPTIONS` cứng |
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE, không đổi API. Test: ô hiện đúng các mục của danh mục DB, mục bị ẩn không hiện, lỗi tải danh mục có trạng thái rõ ràng |
| Người phụ trách | `coder-frontend-agent`, rồi `qa-agent` review |
| Trạng thái | `Mới` (2026-11-04) |

**PT-064 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | Form gắn/tạo thẻ (`TagPicker` ở `EditPersona`) và tab "Thẻ" ở Cài đặt CRM (PT-036); loại thẻ `INTEREST`/`OCCUPATION`/`OTHER` (BE và FE đều có `OTHER`) |
| Bước tái hiện | 1. Mở form tạo/gắn thẻ. 2. Tìm chỗ chọn loại thẻ "Khác" |
| Kết quả thực tế | Form chỉ hiện INTEREST và OCCUPATION; không tạo/chọn được loại `OTHER` |
| Kết quả mong đợi | Có chỗ chọn loại `OTHER` ở form tạo thẻ và màn quản lý thẻ (PT-036); thẻ `OTHER` hiện đúng ở gắn thẻ, bộ lọc và gắn hàng loạt |
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE, không đổi API (BE đã có `OTHER`); làm cùng hoặc sau PT-036. Test: tạo thẻ `OTHER`, hiện đúng trong bộ lọc/gắn hàng loạt |
| Người phụ trách | `coder-frontend-agent`, rồi `qa-agent` review |
| Trạng thái | `Mới` (2026-11-04) |

**PT-065 — chi tiết**

| Trường | Nội dung |
|---|---|
| Màn hình / API | `AdvancedFilterModal` (bộ lọc nâng cao danh sách khách); API danh sách khách có lọc chân dung (BE đã hỗ trợ `isFilterable`, `personaFilterKeys`, `personaFilters`); `GET /crm/persona-fields` |
| Bước tái hiện | Mở bộ lọc nâng cao, tìm cách lọc theo trường chân dung (ví dụ loại hình quan tâm) |
| Kết quả thực tế | Bộ lọc nâng cao không có lọc theo chân dung dù BE hỗ trợ |
| Kết quả mong đợi | Bộ lọc nâng cao cho chọn các trường chân dung **lọc được** (`isFilterable`) và lọc danh sách khách theo giá trị đã chọn; danh sách trường lấy từ API (thêm/bớt ở màn PT-035 thì bộ lọc thấy theo); có thể kết hợp với các bộ lọc hiện có và xóa bộ lọc |
| Phạm vi kỹ thuật (đề xuất) | Chỉ FE, không đổi API (giá trị chứa dấu phẩy: xem PT-055/FR-32). Test: lọc theo một trường chọn, nhiều giá trị, kết hợp bộ lọc khác, xóa bộ lọc; trường không lọc được không hiện |
| Người phụ trách | `coder-frontend-agent`, rồi `qa-agent` review |
| Trạng thái | `Mới` (2026-11-04) |

**Kết quả rà soát danh mục (2026-11-04, `qa-agent`, chỉ đọc code, chưa chạy app)**

- **Đã có màn quản lý (7):** Tình trạng khách, Nguồn khách, Khu vực, Dự án, Người dùng, Nhóm, Nhắc việc.
- **Thiếu màn quản lý:** Kết quả liên hệ (PT-033), Trường chân dung và lựa chọn của chúng (PT-035), Thẻ (PT-036).
- **Mục nhỏ (Oniichan quyết định làm cả 4 trong v1.0.4, 2026-11-04; đã xếp thành PT-062 đến PT-065, FR-46 đến FR-49):** (a) (PT-062) "loại hình" của dự án (`propertyTypes`) là chữ gõ tự do, tách rời với lựa chọn `property_type` của chân dung, nên cho chọn từ danh mục chung hoặc dùng chung lựa chọn (cần BE, có thể cần migration); (b) (PT-063) ô "Kết quả liên hệ" trong `CallModal` dùng 5 chuỗi cứng khác danh mục DB, hiện chưa lộ vì cờ `isInAppCallEnabled` tắt, khi bật phải chuyển sang danh mục DB; (c) (PT-064) loại thẻ `OTHER` có ở BE và FE nhưng form chỉ hiện INTEREST và OCCUPATION, chưa rõ cố ý hay sót; (d) (PT-065) bộ lọc nâng cao chưa lọc theo chân dung dù BE hỗ trợ (`isFilterable`, `personaFilterKeys`), đây là thiếu chức năng lọc, ngoài phạm vi quản lý danh mục (nay vẫn đưa vào v1.0.4 theo quyết định của Oniichan).
- **Nên giữ cứng:** nhóm danh sách của tình trạng, kênh liên hệ nhật ký, loại và trạng thái lịch hẹn, loại việc hôm nay, vai trò tài khoản, 4 tiêu chí nhu cầu/động cơ/tài chính/thời gian, nguồn thông tin chân dung, kiểu trường và nhóm trường chân dung, loại thẻ, loại khu vực/trạng thái bán/đơn vị giá của dự án, tùy chọn bộ lọc/sắp xếp/báo cáo, preset import, các mốc nhắc lịch hẹn ở form.
- **Chưa kiểm được:** màn ẩn ngoài `SETTINGS_TABS` (căn cứ chỉ là grep không thấy lời gọi ghi); `AppointmentMoreMenu`, `MiniMonthCalendar`; ô chọn ngoài module CRM (`UserManagementScreen`, `EditUserModal`).

## 3. Quy tắc nghiệp vụ

Quy tắc cho M7 Web Push (VAPID) cho PWA (tham chiếu FR):

1. **Hộp thông báo trong app là nguồn chính; push chỉ là kênh bổ sung.** Mọi thông báo vẫn ghi vào hộp thông báo như hiện nay; push lỗi/bị bỏ qua không làm hỏng hay chặn nghiệp vụ (FR-03).
2. **Đăng ký subscription:** API đăng ký thuộc `Self`, cần đăng nhập; body gồm endpoint và khóa `p256dh`/`auth` của push subscription trình duyệt, tùy chọn thông tin trình duyệt/thiết bị (thay `platform` IOS/ANDROID/WEB; trường và tên endpoint do `architect-agent` quyết). Endpoint là duy nhất toàn hệ thống: đăng ký lại cùng endpoint từ tài khoản khác thì **gán lại cho người dùng hiện tại** (upsert, cập nhật `lastSeenAt`, xóa `revokedAt`) (FR-01).
3. **Hủy subscription:** API hủy chỉ cho chủ sở hữu (người khác nhận 404, không lộ tồn tại); đăng xuất kèm id subscription thì thu hồi subscription đó; đăng xuất không kèm thì không thu hồi các subscription khác (FR-01).
4. **Người nhận push** = đúng tập người nhận của thông báo trong app (đã loại người thực hiện, đã lọc theo phạm vi quyền). Gửi tới **mọi subscription còn hiệu lực** (`revokedAt` rỗng) của người đó. **Chỉ loại có trong danh mục push (mục 2.1.1) mới được gửi push**; loại khác (ví dụ `SECURITY_ALERT`) chỉ vào hộp thông báo, `pushStatus = SKIPPED` (FR-03, FR-43).
5. **Chọn kênh theo cài đặt thông báo đã có ở M5 (backend):** `notification_preferences.types[type].push` quyết định có gửi push hay không (loại chưa lưu = bật); `inApp` quyết định ghi vào hộp thông báo (không đổi). **Giờ yên lặng là cài đặt cá nhân (Oniichan chốt 2026-11-04):** mỗi người tự bật/tắt và tự chọn khung giờ (`quietHours`, múi giờ `Asia/Ho_Chi_Minh`, khung được phép qua nửa đêm) trong trang Cài đặt thông báo; **mặc định TẮT** (chưa chọn thì không có giờ yên lặng). Push bị tắt, hoặc đang trong giờ yên lặng của **người nhận** thì `pushStatus = SKIPPED`, thông báo vẫn nằm trong hộp thông báo (FR-03, FR-10). **Không loại nào được ngoại lệ bỏ qua giờ yên lặng hay bị khóa không cho tắt ở v1.0.4** (`SECURITY_ALERT` không nằm trong danh mục push). Backend đã có API cài đặt thông báo; web admin **chưa có trang** này, phải tạo mới (FR-09, FR-10).
6. **Thời điểm gửi:** chỉ đưa job `push.send` vào queue **sau khi transaction nghiệp vụ commit**; không gửi cho thông báo của giao dịch bị rollback (FR-03).
7. **Không gửi trùng:** mỗi cặp (thông báo, subscription) có tối đa một lần gửi thành công; job retry hoặc restart worker/hai instance không tạo push thứ hai (dedupe theo khóa thông báo và subscription, cập nhật `pushStatus` nguyên tử) (FR-03, FR-12).
8. **Lỗi và retry:** timeout 5 giây mỗi lần gọi dịch vụ push; lỗi tạm thời (5xx, giới hạn tần suất/hạn mức) thì retry backoff lũy thừa có jitter tối đa 5 lần rồi `pushStatus = FAILED`; lỗi vĩnh viễn thì không retry (FR-02, FR-03).
9. **Xử lý subscription hết hạn:** dịch vụ push trả HTTP 404 hoặc 410 (subscription không còn hợp lệ) thì thu hồi subscription (`revokedAt = now`) và không thử lại; các subscription khác của người đó vẫn gửi bình thường (FR-04).
10. **Không lộ PII trong nội dung push:** nội dung push **theo mẫu của từng loại trong danh mục (mục 2.1.1)** (Oniichan chốt 2026-11-04: nội dung theo mô tả của loại push đó, không có quy tắc nội dung chung riêng). Payload **không** chứa SĐT, CCCD, email, nội dung nhật ký/ghi chú, lời nhắn đề nghị, `title`/địa điểm/ghi chú lịch hẹn; chỉ gồm tiêu đề/nội dung ngắn đã điền các biến cho phép của mẫu, mã loại, và deep link dạng đường dẫn nội bộ có `id` (ví dụ `/crm/customers/:id`). **Tên khách được phép hiện trên màn khóa (Oniichan chốt 2026-11-04)** và chỉ xuất hiện qua biến `{tên khách}` của mẫu (cả 5 mẫu đều có, xem mục 2.1.1); mọi dữ liệu khác ở danh sách cấm trên **không được phép**. Khi ẩn danh hóa khách, thông báo chứa tên khách đã bị xóa khỏi hộp thông báo (đã có ở M5); push đã gửi không thu hồi được nên mẫu nội dung càng ít thông tin càng tốt (FR-06).
11. **Quyền và phạm vi:** người dùng chỉ đăng ký/xem/hủy subscription của chính mình; bấm vào push mở đúng trang nhưng vẫn kiểm quyền/phạm vi ở API (khách ngoài phạm vi trả 404 như hiện nay). Tài khoản bị khóa/ngừng hoạt động hoặc bị xóa thì không nhận push và subscription bị thu hồi (đề xuất, chốt ở thiết kế) (FR-01, FR-03).
12. **Cờ và quay lui:** `FEATURE_CRM_PUSH=false` (mặc định) thì dùng Noop, mọi thông báo `SKIPPED`; API đăng ký subscription vẫn có thể lưu subscription để không mất khi bật cờ sau. Bật/tắt cờ là hành động có kiểm soát của Oniichan/`devops-agent`, tắt được ngay mà không đổi code (FR-07).
13. **Bí mật:** khóa riêng VAPID (`VAPID_PRIVATE_KEY`) là bí mật: không nằm trong repo, image, log, hay tài liệu; chỉ truyền qua biến môi trường/secret trên VPS. Khóa công khai (`VAPID_PUBLIC_KEY`) không bí mật, đưa cho FE. `VAPID_SUBJECT` (địa chỉ liên hệ) **đã chốt là email `mailto:info@stnd.vn`** (không bí mật, được ghi trong tài liệu). Khóa tạo một lần; đổi khóa làm mọi subscription cũ mất hiệu lực (FR-07, FR-08).
14. **Thứ tự bật production (Oniichan chốt 2026-11-04: "bật ở production luôn, không cần thử"):** xong FR-14, FR-15, FR-16, FR-18 (PT-037, PT-038, PT-039, PT-041) trước (điều kiện an toàn, giữ nguyên; FR-17 (PT-040) đã `Bỏ` 2026-11-04 nên không còn trong điều kiện); rồi bật `FEATURE_CRM_PUSH` ở production **cho mọi người cùng lúc**, không có giai đoạn allowlist vài tài khoản, không cần môi trường thử riêng; kiểm trên iPhone/Android thật **làm ngay trên production sau khi bật**; theo dõi log/`pushStatus` sau khi bật; có sự cố thì tắt cờ ngay (không đổi code).
15. **Chỉ xin quyền khi người dùng chủ động bấm:** quyền thông báo chỉ được xin sau một thao tác bấm của người dùng (nút bật thông báo ở Cài đặt), không xin tự động khi mở trang hay đăng nhập. Trình duyệt từ chối thì hiện trạng thái "đã chặn" kèm hướng dẫn mở lại, không xin lặp (FR-09).
16. **iPhone chỉ bật khi đã cài PWA:** trên iPhone (iOS 16.4 trở lên) chỉ hiện nút bật thông báo khi web chạy ở chế độ đã cài (standalone); nếu chạy trong tab Safari thường thì hiện hướng dẫn "Thêm vào Màn hình chính" thay cho nút bật (FR-09).
17. **Danh mục push là danh sách đóng, có mã, mở rộng bằng cấu hình:** v1.0.4 chỉ có đúng 5 loại ở mục 2.1.1; thêm loại mới là thêm một dòng vào danh mục (mã, tên, mẫu nội dung, deep link, quy tắc người nhận, mặc định, cờ cho phép tắt), không sửa bộ gửi (FR-43). Mọi mẫu nội dung của loại mới cũng phải qua quy tắc 10.
18. **Một điểm vào duy nhất để phát thông báo:** mọi module CRM (phân khách, nhật ký, lịch hẹn, quét khách lâu chưa chăm sóc, tự đổi tình trạng) tạo thông báo qua điểm vào chung nhận "yêu cầu thông báo" chuẩn (mã loại thuộc danh mục, người nhận, dữ liệu dựng nội dung, đường dẫn đích, khóa chống trùng), không tự ghi hộp thông báo hay tự gọi push (FR-44). Khóa chống trùng là bắt buộc, trùng khóa thì không tạo thông báo/push thứ hai. Điểm vào đủ tổng quát để sau này MCP/API cho agent bên ngoài gọi lại (ngoài phạm vi v1.0.4, mục 1.3).

## 4. Thứ tự triển khai

### 4.1 Milestone gợi ý (theo ưu tiên và phụ thuộc)

| Giai đoạn | Nội dung | Phụ thuộc |
|---|---|---|
| **A. An toàn nền trước push** | FR-14 (PT-037), FR-15 (PT-038), FR-16 (PT-039), FR-18 (PT-041); FR-17 (PT-040) đã `Bỏ` (Oniichan quyết định 2026-11-04) nên không còn trong giai đoạn này | — (làm trước khi bật push; FR-18 (PT-041) và FR-15 (PT-038) là điều kiện của FR-03/FR-06) |
| **B. M7 lõi backend** | **FR-43 (danh mục loại thông báo push), FR-44 (dịch vụ phát thông báo dùng chung)**, FR-01, FR-02, FR-03, FR-04, FR-06, FR-07, FR-12 (test tự động) | A; `architect-agent` thiết kế trước, **thiết kế FR-43 và FR-44 trước FR-03** (FR-03 nhận yêu cầu từ điểm vào chung và đọc danh mục); M5 (thông báo, queue) đã có |
| **C. Khóa VAPID, cờ và PWA nhận push** | FR-08 (runbook VAPID), FR-09 (PWA: service worker, đăng ký subscription, nút bật/tắt; **tạo mới trang "Cài đặt thông báo" ở web admin**), FR-10 (bật/tắt từng loại, giờ yên lặng trên cùng trang); FR-11 đã `Bỏ (không còn đối tượng)`; bật cờ **ở production cho mọi người cùng lúc** theo mục 3 quy tắc 14 (không allowlist, không môi trường thử riêng) | B; `subject` đã chốt (`mailto:info@stnd.vn`); **Oniichan cho phép tạo/lưu khóa VAPID**; có iPhone (iOS 16.4+) và Android đã cài PWA để kiểm thật ngay trên production sau khi bật cờ |
| **D. Backlog "Nên có"** | FR-19 đến FR-31 (PT-042 đến PT-054), kèm FR-13 (tài liệu) và FR-05 (dọn subscription 90 ngày, "Nên có" từ 2026-11-04; nên làm cùng giai đoạn B vì FR-01 dùng chung định nghĩa "hoạt động") | Không chặn M7; làm xen kẽ, ưu tiên FR-21 (PT-044), FR-23 (PT-046), FR-29 (PT-052) |
| **E. "Tùy chọn" và lỗi mới / cải tiến** | FR-32 đến FR-37 (PT-055 đến PT-060); lỗi mới và cải tiến mục 2.3. **Lỗi nhẹ (sửa giao diện, chỉ FE) được chen lên trước hoặc làm song song M7 (Oniichan chốt 2026-11-04); lỗi nặng (Blocker/Major về dữ liệu/bảo mật) xử lý ngay theo mức độ.** Chỉ FE, không chờ M7, có thể làm sớm: FR-38 (PT-032), FR-39 (PT-033), FR-41 (PT-035; lớn, **làm cả hai đợt trong v1.0.4**: đợt 1 sửa nhãn/lựa chọn/bật tắt/thứ tự, đợt 2 thêm/bớt trường, cùng một phát hành), FR-42 (PT-036), FR-45 (PT-061, a11y sidebar), FR-47 (PT-063, `CallModal`), FR-48 (PT-064, thẻ `OTHER`; làm cùng hoặc sau FR-42), FR-49 (PT-065, lọc chân dung; nên sau FR-41). Cần thiết kế/BE/migration: FR-40 (PT-034) cần `architect-agent` thiết kế và migration, làm sau khi chốt thiết kế, có thể xin dời sang v1.0.5; **FR-46 (PT-062, "loại hình" Dự án) làm sau thiết kế FR-40 (PT-034) và sau FR-41 (PT-035)** vì dùng chung `code` và lựa chọn `property_type` | Làm nếu còn thời gian; lỗi mới xếp theo mức độ khi nhận |

Mốc phát hành v1.0.4: xong A, B, C và các mục "Phải có" còn lại (kể cả FR-41 đủ hai đợt); D và E không chặn phát hành (mục chưa xong được chuyển sang v1.0.5 hoặc ghi `Hoãn`).

### 4.2 Phụ thuộc và việc Oniichan phải chuẩn bị

| Việc | Khi nào cần | Ghi chú |
|---|---|---|
| `subject` liên hệ VAPID: **đã chốt `VAPID_SUBJECT=mailto:info@stnd.vn`** (2026-11-04), không còn việc cần Oniichan duyệt | Đã xong | Giá trị không bí mật; xem mục 8 |
| Cho phép tạo cặp khóa VAPID và lưu khóa riêng (`VAPID_PRIVATE_KEY`) trên VPS; khóa công khai đưa cho FE | Trước bật cờ | Không đưa khóa riêng vào repo/chat; lưu password manager; có kế hoạch xoay (đổi khóa thì người dùng phải bật lại thông báo) |
| Bật `FEATURE_CRM_PUSH` qua `CRM_*`/compose theo hướng dẫn runbook, **ở production cho mọi người cùng lúc** (Oniichan chốt 2026-11-04: bật luôn, không thử trước) | Giai đoạn C, sau khi xong FR-14, FR-15, FR-16, FR-18 | Compose ghi đè `FEATURE_CRM_*`, không đặt trực tiếp trong `.env.docker`; tên biến mới do `devops-agent` chốt; không cần allowlist hay môi trường thử riêng; tắt cờ là cách quay lui nhanh |
| Máy thật **iPhone (iOS 16.4+)** và **Android** đã cài web admin dạng PWA (iPhone: Thêm vào Màn hình chính) để kiểm | Nghiệm thu giai đoạn C, làm **ngay trên production sau khi bật cờ** | iPhone và Android thật của Oniichan; domain production dùng HTTPS |
| Cung cấp danh sách lỗi mới (mục 2.3) | Khi sẵn sàng (Oniichan sẽ gửi khi có) | Đã có PT-032 đến PT-036 và PT-061 đến PT-065; mã PT tiếp theo `PT-066`, mã FR tiếp theo `FR-50` |

## 5. Rủi ro & Ràng buộc

| # | Rủi ro | Ảnh hưởng | Hướng xử lý |
|---|---|---|---|
| 1 | **iOS chỉ hỗ trợ Web Push khi PWA đã cài (Thêm vào Màn hình chính) và iOS từ 16.4**; quyền phải xin qua thao tác bấm | iPhone chưa cài PWA hoặc iOS cũ không nhận push | Hướng dẫn "Thêm vào Màn hình chính" trong app, chỉ hiện nút bật ở chế độ standalone (quy tắc 15, 16); hộp thông báo vẫn là nguồn chính; ghi yêu cầu iOS 16.4+ trong runbook |
| 2 | Quyền thông báo có thể bị người dùng tắt, hoặc mất khi gỡ/cài lại PWA | Subscription cũ chết, người dùng tưởng vẫn nhận push | Thu hồi theo 404/410 (FR-04); Cài đặt hiển thị trạng thái thật (đã bật/đã chặn/chưa bật) và cho bật lại dễ; không xin quyền lặp |
| 3 | Hành vi thông báo trên iOS khó đoán (PWA đóng hẳn, chế độ Focus, tiết kiệm pin, trễ) | Push đến chậm, không đến, hoặc hiển thị khác Android | **Bắt buộc thử trên iPhone thật** trước khi nghiệm thu; ghi kết quả vào runbook; **Oniichan đã chấp nhận** (2026-11-04) mức nghiệm thu "đến được trong điều kiện thử thông thường trên máy thật", không cam kết thời gian đến (mục 8) |
| 4 | Dịch vụ push của Apple/Google nằm ngoài tầm kiểm soát (trễ, từ chối, giới hạn tần suất) | Push chậm hoặc mất | Retry backoff + jitter tối đa 5 lần, timeout 5 giây; hộp thông báo vẫn là nguồn chính; không cam kết thời gian đến |
| 5 | Web Push và service worker chỉ chạy trên **HTTPS** với domain đúng (production sau cloudflared); subscription gắn với domain và khóa VAPID | Đổi domain hoặc khóa thì mất toàn bộ subscription; thử trên domain sai không phản ánh thật | Kiểm trực tiếp trên domain production có HTTPS (không có môi trường thử riêng); không đổi khóa VAPID tùy tiện (runbook xoay khóa, FR-08); kiểm tra scope service worker |
| 6 | Lộ PII qua dịch vụ push (máy chủ Apple/Google, hiện trên màn khóa) | Vi phạm nguyên tắc dữ liệu khách | Mẫu nội dung tối giản, test chặn PII quét cả 5 mẫu (FR-06, FR-12), log che PII (FR-15, PT-038); **Oniichan đã chấp nhận hiện tên khách trên màn khóa (2026-11-04)**: tên khách là dữ liệu cá nhân và có thể nhìn thấy ở màn khóa điện thoại, nên vẫn cấm SĐT, CCCD, email, nội dung nhật ký/ghi chú/lời nhắn trong mọi mẫu |
| 7 | Bão push khi bật cờ (quét "khách lâu chưa chăm sóc" lần đầu, nhắc hàng loạt, **thêm hàng loạt người cùng chăm sóc**: mỗi người được thêm là một push loại `CUSTOMER_ASSIGNED`; thao tác hàng loạt "đổi phụ trách chính" không có push) | Spam nhân viên, chạm giới hạn dịch vụ push | FR-18 (PT-041) giới hạn lô; **`architect-agent` đối chiếu đường thêm hàng loạt người cùng chăm sóc để gộp hoặc giới hạn push (tránh bão thông báo)**; giới hạn tốc độ gửi ở worker; vì bật cho mọi người cùng lúc (không allowlist) nên có bão thì tắt cờ ngay (rủi ro 14) |
| 8 | Gửi trùng do retry/restart/nhiều worker | Nhân viên nhận push lặp | Dedupe theo (thông báo, subscription), `pushStatus` nguyên tử, test chạy đồng thời (FR-03, FR-12) |
| 9 | Lộ khóa riêng VAPID | Kẻ xấu gửi push giả tới mọi subscription | Chỉ biến môi trường/secret, không vào repo/image/log, xoay khóa (người dùng phải bật lại), ghi trong runbook (FR-08) |
| 10 | Redis/BullMQ là phụ thuộc mới của đường push | Redis lỗi thì push dừng | Push không chặn nghiệp vụ; readiness đã kiểm Redis; tắt được bằng cờ |
| 11 | Lỗi mới và cải tiến do Oniichan nêu thêm làm đổi ưu tiên/quy mô (hiện đã thêm PT-061 đến PT-065, và làm cả hai đợt PT-035 trong v1.0.4; PT-062 cần BE/migration) | Trượt mốc | Phân loại theo mức độ; Blocker/Major đưa lên trước, xếp cùng giai đoạn A; lỗi nhẹ chỉ FE chen trước hoặc làm song song M7 (Oniichan cho phép); FR-40 (PT-034) và FR-46 (PT-062) là hai mục có thể xin dời sang v1.0.5 (ghi `Hoãn` có lý do); D và E không chặn phát hành |
| 12 | Một số việc backlog M0/M1 không rõ đã đóng hay chưa (Throttler Redis, sanitize NoSQL, Winston che PII, AAD CCCD, idempotency scope user) | Tính trùng hoặc bỏ sót | `qa-agent` đối chiếu hiện trạng trước khi giao (Câu hỏi 1) |
| 13 | Số 1.0.4 cho phiên bản có tính năng mới (semver thuần là 1.1.0) | Lệch quy ước | **Oniichan đã chốt giữ `1.0.4` (2026-11-04, mục 8)** như ngoại lệ v1.0.2; ghi nhận ngoại lệ thứ hai ở mục 1 của `README.md` thư mục `08_Quan_Ly_Phien_Ban` |
| 14 | **Bật push ở production cho mọi người cùng lúc, không thử trước** (Oniichan chốt 2026-11-04) | Lỗi hoặc bão push ảnh hưởng mọi người dùng ngay lập tức; phát hiện sớm bị hạn chế vì không có đợt thử riêng | **Cờ `FEATURE_CRM_PUSH=false` phải tắt được ngay chỉ bằng đổi biến môi trường, không đổi code (quay lui nhanh)**, ghi bước tắt khẩn cấp trong runbook (FR-07, FR-08); **giữ điều kiện an toàn FR-14, FR-15, FR-16, FR-18 (PT-037, PT-038, PT-039, PT-041) xong trước khi bật** (FR-17 (PT-040) đã `Bỏ`) và test tự động FR-12; theo dõi log/`pushStatus` ngay sau khi bật; kiểm iPhone/Android thật trên production ngay sau khi bật |
| 15 | Không làm điểm vào phát thông báo chung từ đầu (FR-44): các module tự gọi gửi trực tiếp | Sau này thêm loại thông báo hoặc làm MCP cho agent ngoài phải sửa lại nhiều chỗ, tốn kém; dễ gửi trùng, bỏ sót kiểm cài đặt/giờ yên lặng | Làm FR-43 và FR-44 ở giai đoạn B, trước FR-03; mọi module gọi qua điểm vào chung (quy tắc 17, 18); test khóa chống trùng |
| 16 | Agent bên ngoài (MCP làm sau) có thể đẩy nội dung tự do chứa dữ liệu cá nhân nếu không có kiểm soát | Lộ PII qua push, spam, giả mạo thông báo | **Để thiết kế MCP/endpoint ngoài sau** (xác thực nguồn, giới hạn tần suất, danh sách loại cho phép, chặn nội dung tự do); ở v1.0.4 điểm vào chung chỉ nhận loại thuộc danh mục và mẫu nội dung cố định, không có đường nhập nội dung tự do |

## 6. Tiêu chí nghiệm thu

> Căn cứ cho `qa-agent`. Mỗi mục kiểm được bằng test tự động, lệnh, hoặc thao tác thử đã ghi.

**Giai đoạn A (an toàn nền):**

- [ ] FR-14 (PT-037): test cho thấy payload chứa toán tử `$...` bị từ chối hoặc vô hiệu hóa ở các endpoint nhận query/body có lọc.
- [ ] FR-15 (PT-038): test cho thấy log không chứa SĐT, CCCD, email dạng đầy đủ.
- [ ] FR-16 (PT-039): `listDeleted` có test `guardSearch` (tìm SĐT từng phần bị chặn như endpoint khác).
- FR-17 (PT-040): `Bỏ` (Oniichan quyết định 2026-11-04: không cần xóa GPS khi tải ảnh lên); không có tiêu chí nghiệm thu, không còn yêu cầu kiểm Exif/GPS ảnh đính kèm.
- [ ] FR-18 (PT-041): test cho thấy lần quét đầu bị giới hạn kích thước lô và các lô còn lại được xử lý ở lượt sau, không gửi quá hạn mức mỗi lượt.

**Giai đoạn B–C (M7):**

- [ ] FR-01: API đăng ký subscription upsert đúng (trùng endpoint từ user khác thì gán lại), API hủy chỉ chủ sở hữu (người khác 404), logout kèm id subscription thu hồi subscription; có test ma trận quyền. **Giới hạn 3 thiết bị:** đăng ký thiết bị thứ 4 của cùng một người thì subscription có hoạt động gần nhất lâu nhất bị gỡ (thu hồi), người này còn đúng 3 subscription hiệu lực, người khác không bị ảnh hưởng; đăng ký lại cùng endpoint (upsert) không tính thành thiết bị mới; trang "Cài đặt thông báo" báo cho người dùng biết thiết bị bị gỡ.
- [ ] FR-05: job dọn subscription chạy định kỳ và idempotent (chạy hai lần liên tiếp cho cùng kết quả); test có ca biên: subscription 89 ngày không hoạt động còn, đúng 90 ngày xử lý theo quy ước `architect-agent` đã chốt (ghi rõ trong thiết kế), 91 ngày bị xóa; subscription có hoạt động gần đây không bị xóa; sau khi bị dọn, người dùng bật lại thông báo được.
- [ ] FR-43: danh mục có đúng 5 loại ở mục 2.1.1 (`CUSTOMER_ASSIGNED`, `CARE_LOG_ADDED`, `APPOINTMENT_DUE`, `STALE_CUSTOMER`, `CUSTOMER_STATUS_AUTO_CHANGED`), mỗi loại có đủ mã, tên, mẫu nội dung, mẫu deep link, quy tắc người nhận, mặc định, cờ cho phép tắt; test thêm **một loại thử** vào danh mục thì gửi được cả hộp thông báo lẫn push **mà không sửa bộ gửi**; loại không có trong danh mục (ví dụ `SECURITY_ALERT`) không gửi push (`SKIPPED`) nhưng vẫn vào hộp thông báo. **`CUSTOMER_ASSIGNED` chỉ có push khi người nhận được thêm làm người cùng phụ trách** (kể cả qua duyệt đề nghị tham gia và thêm hàng loạt người cùng chăm sóc); được đặt làm phụ trách chính, tạo khách có phân người, đổi phụ trách chính hàng loạt thì vẫn có thông báo trong app nhưng `pushStatus = SKIPPED`, có test cho từng tình huống; thêm hàng loạt nhiều người cùng chăm sóc không gây bão push (gộp hoặc giới hạn theo thiết kế).
- [ ] FR-44: cả 5 nguồn (phân khách, nhật ký, lịch hẹn, quét khách lâu chưa chăm sóc, tự đổi tình trạng) gọi qua điểm vào chung (kiểm bằng test hoặc rà code: không còn chỗ tự ghi thông báo/tự gọi push); test chứng minh khóa chống trùng (gọi hai lần cùng khóa chỉ ra một thông báo và một push); có tài liệu thiết kế/API của điểm vào (đầu vào "yêu cầu thông báo" chuẩn, quy tắc khóa chống trùng) đủ để làm MCP sau mà không sửa bộ gửi.
- [ ] FR-02, FR-03: với dịch vụ push giả lập, test chứng minh: gửi đúng người nhận, tôn trọng `push=false` và giờ yên lặng của người nhận (`SKIPPED`; giờ yên lặng mặc định tắt thì vẫn gửi; khung giờ qua nửa đêm, ví dụ 22:00 đến 06:00, được xét đúng theo múi giờ `Asia/Ho_Chi_Minh`), retry tối đa 5 lần với backoff, hết lần thì `FAILED`, nghiệp vụ không bị ảnh hưởng khi dịch vụ push lỗi.
- [ ] FR-03, FR-12: chạy đồng thời hai worker và restart giữa chừng không tạo push thứ hai cho cùng (thông báo, subscription); không có push cho giao dịch rollback.
- [ ] FR-04: dịch vụ push trả 404 hoặc 410 thì `revokedAt` được đặt và subscription đó không được gửi lại; subscription còn lại của người đó vẫn nhận.
- [ ] FR-06: test quét **cả 5 mẫu nội dung push** ở mục 2.1.1 và payload thật không chứa SĐT, CCCD, email, nội dung nhật ký/ghi chú/lời nhắn, `title`/địa điểm/ghi chú lịch hẹn; chỉ dùng các biến cho phép (tên khách được phép, qua `{tên khách}`, Oniichan đã chấp nhận hiện trên màn khóa); deep link chỉ là đường dẫn nội bộ có `id`.
- [ ] FR-07: cờ `FEATURE_CRM_PUSH=false` thì không có lời gọi dịch vụ push và `pushStatus = SKIPPED`; bật cờ không sửa code; tắt cờ (đổi biến môi trường) là ngừng gửi ngay mà không đổi code (quay lui nhanh, vì bật production cho mọi người cùng lúc); khóa riêng VAPID không có trong repo, image, log (kiểm bằng quét repo và log); khóa công khai đến được FE.
- [ ] FR-08: runbook khóa VAPID đủ bước để người khác tự tạo khóa, đặt `subject` (`mailto:info@stnd.vn`) và biến, thử gửi 1 push, có mục tắt khẩn cấp và xoay khóa; `devops-agent` đã làm theo thử trên bản sạch.
- [ ] FR-09 và nghiệm thu thật (**làm ngay trên production sau khi bật cờ cho mọi người, không có đợt thử riêng**): tại web admin PWA, ở trang "Cài đặt thông báo" (trang mới), đăng ký subscription từ **một iPhone (PWA đã cài, iOS 16.4+) và một Android (PWA/Chrome) thật**, bằng thao tác bấm nút bật thông báo ở Cài đặt (không xin quyền tự động); iPhone chạy trong tab Safari thường chỉ thấy hướng dẫn "Thêm vào Màn hình chính"; tạo một thông báo CRM thật (ví dụ phân khách) và **cả hai thiết bị nhận push**, bấm vào (service worker `notificationclick`) mở đúng trang; tắt thông báo/hủy subscription thì ngừng nhận. Không cam kết thời gian đến, kể cả khi PWA đóng hẳn trên iPhone (Oniichan đã chấp nhận, mục 8).
- [ ] FR-10: web admin có trang "Cài đặt thông báo" cá nhân (tạo mới) gọi `GET/PUT /notification-preferences/me`: danh sách loại lấy từ danh mục (5 loại), bật/tắt push từng loại có hiệu lực thật (tắt loại nào thì không nhận push loại đó nhưng vẫn có trong hộp thông báo); **giờ yên lặng mặc định TẮT** (người dùng mới/chưa chọn thì vẫn nhận push mọi giờ), bật và chọn khung giờ (kể cả qua nửa đêm) thì trong khung đó push `SKIPPED` còn thông báo vẫn nằm trong hộp thông báo, tắt đi thì nhận lại; không loại nào bị bỏ qua giờ yên lặng; có test giao diện và thử thật.
- [ ] FR-11: đã `Bỏ (không còn đối tượng)` (đã kiểm không có mock "đẩy thông báo"); không cần nghiệm thu.

**Giai đoạn D–E và chung:**

- [ ] Mỗi mục Sửa lỗi (FR-19 đến FR-37, tức PT-042 đến PT-060; FR-17 (PT-040) đã `Bỏ` nên không tính) đã làm có test đi kèm và đã qua `qa-agent` review; mục không làm ghi `Hoãn` kèm lý do.
- [ ] FR-29 (PT-052), FR-13: các tài liệu liên quan đã cập nhật số phiên bản tài liệu (`v1.0.4`) và bảng mục 4 của `README.md` thư mục `08_Quan_Ly_Phien_Ban`; không còn mục "Lệch tài liệu" của M3–M5 chưa đồng bộ.
- [ ] Số phiên bản `1.0.4` đã nâng trong `package.json` và lockfile của ba ứng dụng và `app.json` của `RealEstateApp`; bảng ở `README.md` cập nhật.
- [ ] Build và test của backend và web admin xanh (ngoại trừ các lỗi có sẵn đã ghi ở FR-30 (PT-053), FR-31 (PT-054) nếu chưa xử lý); `qa-agent` không còn lỗi Critical/High.
- [ ] Lỗi mới và cải tiến (mục 2.3): mỗi mục có mã `PT-xxx` và `FR-xx`, được xử lý (`Xong`) hoặc `Hoãn` có lý do được Oniichan đồng ý.
- [ ] FR-38 (PT-032): test cho thấy mobile bấm chuông điều hướng sang màn Thông báo (không mở popup), trang đầu đúng 20 mục, cuộn tới cuối gọi trang kế và dừng khi hết, không gọi trùng khi đang tải; desktop dropdown không tràn viewport, có tab Tất cả/Chưa đọc, bấm dòng thì đánh dấu đã đọc và điều hướng theo `deepLink`, số chưa đọc và danh sách cùng cập nhật; Oniichan thử trên iPhone thật và desktop, không còn cửa sổ lệch/cắt.
- [ ] FR-39 (PT-033): Cài đặt CRM có tab "Kết quả liên hệ" (desktop và mobile, chỉ Quản trị thấy); thêm, sửa, ẩn, khôi phục chạy thật với API; mục mới xuất hiện ngay ở ô chọn của form Ghi chú chăm sóc; có test cho tab, quyền và lỗi; đã có danh sách kết quả rà các danh mục khác còn thiếu màn và Oniichan quyết từng mục.
- [ ] FR-40 (PT-034): có tài liệu thiết kế được duyệt; dữ liệu danh mục lưu và đưa ra (API, export, audit) có `code` kèm `label`, `<option value>` là `code`; đổi nhãn không làm vỡ dữ liệu/báo cáo; migration chạy lại an toàn, có đường lùi và đã thử trên bản sao dữ liệu thật; người dùng và nhóm vẫn dùng ObjectId; `qa-agent` không còn lỗi Critical/High. Nếu dời sang v1.0.5 thì ghi `Hoãn` có lý do và được Oniichan đồng ý.
- [ ] FR-41 (PT-035): Cài đặt CRM có màn Trường chân dung (chỉ Quản trị): sửa nhãn và lựa chọn của trường chọn, bật/tắt, đổi thứ tự (đợt 1), thêm/bớt trường (đợt 2); **nghiệm thu gồm cả hai đợt trong v1.0.4** (Oniichan quyết định làm luôn đợt 2, không dời sang v1.0.5); thay đổi có hiệu lực ngay ở form chân dung; test chứng minh đổi lựa chọn không làm mất dữ liệu cũ, thêm trường mới dùng được ở form chân dung, trường hệ thống không xóa được, không đổi kiểu trường đã có dữ liệu; `qa-agent` review.
- [ ] FR-42 (PT-036): Cài đặt CRM có tab Thẻ (chỉ Quản trị): đổi tên/nhóm/màu, gộp, xóa mềm, xem `usageCount`; sau gộp khách chuyển sang thẻ đích và thẻ cũ không còn ở bộ lọc/gắn hàng loạt; có test.
- [ ] FR-45 (PT-061): khi sidebar mobile đóng, các phần tử trong sidebar không focus được bằng phím Tab và không nằm trong cây truy cập; khi mở thì focus được; có test và thử Tab trên mobile; desktop không đổi.
- [ ] FR-46 (PT-062): ô "loại hình" của Dự án là ô chọn từ danh sách chung dùng chung lựa chọn `property_type` của trường chân dung (đổi ở màn PT-035 thì Dự án thấy theo); dự án cũ có `propertyTypes` gõ tay được chuyển đúng, giá trị không khớp không bị mất; migration (nếu có) chạy lại an toàn, có đường lùi và đã thử trên bản sao dữ liệu thật; làm sau thiết kế FR-40 (PT-034); `qa-agent` review code, test và migration. Nếu dời sang v1.0.5 thì ghi `Hoãn` có lý do và được Oniichan đồng ý.
- [ ] FR-47 (PT-063): ô "Kết quả liên hệ" trong `CallModal` lấy từ danh mục Kết quả liên hệ trong DB (cùng nguồn với form nhật ký), không còn `CALL_OUTCOME_OPTIONS` cứng; mục bị ẩn không hiện; kiểm được kể cả khi cờ `isInAppCallEnabled` tắt (bằng test); có test.
- [ ] FR-48 (PT-064): form tạo thẻ và màn quản lý thẻ có chỗ chọn loại `OTHER`; tạo được thẻ `OTHER` và thẻ hiện đúng ở gắn thẻ, bộ lọc, gắn hàng loạt; có test.
- [ ] FR-49 (PT-065): bộ lọc nâng cao có lọc theo các trường chân dung lọc được (`isFilterable`): chọn một hoặc nhiều giá trị thì danh sách khách đúng, kết hợp được với bộ lọc khác, xóa được bộ lọc; trường không lọc được không hiện; có test.

## 7. Câu hỏi còn mở

> Chỗ mơ hồ/thiếu thông tin và các giả định cần Oniichan xác nhận, chưa được trả lời. `/spec-clarify` hỏi từng câu một, rồi chuyển câu đã trả lời sang mục 8 và xóa khỏi đây.

1. `qa-agent` cần đối chiếu hiện trạng các việc "còn theo dõi" của M0/M1 (Throttler Redis, sanitize NoSQL, Winston che PII, AAD bắt buộc cho CCCD, idempotency key scope theo user) vì bảng milestone không ghi đã đóng; việc nào đã xong thì bỏ khỏi FR-14 (PT-037), FR-15 (PT-038), FR-19 (PT-042), FR-20 (PT-043). **Đây là việc kiểm, không cần Oniichan trả lời: Neptune giao `qa-agent` khi Oniichan rảnh.** (ảnh hưởng FR-14, FR-15, FR-19, FR-20)

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
- (2026-11-04) Hỏi: Loại thông báo nào được gửi push (câu hỏi mở số 1 khi đó) → Đáp: **Oniichan: làm riêng một danh sách loại thông báo push có mã, sau này sẽ bổ sung thêm; hiện tại gồm đúng 5 loại: (1) được mời cùng phụ trách một khách, (2) nhật ký mới, (3) nhắc lịch hẹn, (4) khách lâu chưa chăm sóc, (5) tự đổi tình trạng theo tiến độ; danh sách phải rất cụ thể, không có "..."**. Hệ quả: thêm mục 2.1.1 "Danh mục loại thông báo push (v1.0.4)" (bảng đóng 5 loại, mã `CUSTOMER_ASSIGNED`, `CARE_LOG_ADDED`, `APPOINTMENT_DUE`, `STALE_CUSTOMER`, `CUSTOMER_STATUS_AUTO_CHANGED`); các loại khác (cảnh báo bảo mật, dịp đặc biệt, nhắc việc tiếp theo, đề nghị tham gia nhóm chăm sóc) không gửi push ở v1.0.4, bổ sung sau bằng cách thêm dòng vào danh mục; `SECURITY_ALERT` không nằm trong danh mục nên không còn ngoại lệ bỏ qua giờ yên lặng hay không cho tắt; mặc định bật cả 5 loại theo tài liệu 04 mục 3.6.1; mã `CUSTOMER_ASSIGNED` cho loại 1 dùng chung mã với thông báo trong app, phạm vi push đã chốt ở dòng riêng bên dưới. Thêm FR-43 (ảnh hưởng FR-03, FR-10, FR-43, mục 2.1.1, mục 3 quy tắc 4, 5, 17)
- (2026-11-04) Hỏi: Yêu cầu tái sử dụng để sau này viết MCP cho agent bên ngoài đẩy thông báo → Đáp: **Oniichan lưu ý vì sau này sẽ viết MCP để agent bên ngoài đẩy thông báo nên cần viết code để tái sử dụng.** Hệ quả: thêm FR-44 (dịch vụ phát thông báo dùng chung, một điểm vào duy nhất, khóa chống trùng, `architect-agent` thiết kế trước FR-03); **bản thân MCP/endpoint cho agent ngoài nằm ngoài v1.0.4** (xác thực nguồn ngoài, giới hạn tần suất, danh sách loại cho phép, chặn nội dung tự do chứa dữ liệu cá nhân), chỉ yêu cầu thiết kế không chặn đường làm sau (ảnh hưởng FR-44, mục 1.3, mục 3 quy tắc 18, mục 5 rủi ro 15, 16)
- (2026-11-04) Hỏi: Nội dung push có được hiện tên khách trên màn khóa không (câu hỏi mở số 2 khi đó) → Đáp: **Oniichan: "Nội dung push thì cứ dùng theo mô tả của loại push đó."** Hệ quả: nội dung do từng loại trong danh mục quyết, mỗi loại có mẫu nội dung riêng (tiêu đề + dòng nội dung) ở mục 2.1.1; vẫn cấm SĐT, CCCD, email, nội dung nhật ký/ghi chú/lời nhắn trong mọi mẫu (mục 3 quy tắc 10, FR-06). Cả 5 mẫu có `{tên khách}`, Oniichan đã xác nhận hiện tên khách (dòng riêng bên dưới) (ảnh hưởng FR-06, FR-43, mục 2.1.1, mục 3 quy tắc 10)
- (2026-11-04) Hỏi: Giờ yên lặng (câu hỏi mở số 3 khi đó): mặc định, và có ngoại lệ không → Đáp: **Oniichan: "Cho người dùng tự chọn trong mục cài đặt cá nhân. Mặc định là không."** Hệ quả: mỗi người tự bật/tắt và tự chọn khung giờ yên lặng trong trang Cài đặt thông báo cá nhân; mặc định TẮT; đang trong giờ yên lặng của người nhận thì `pushStatus = SKIPPED`, thông báo vẫn có trong hộp thông báo; không loại nào được ngoại lệ ở v1.0.4 (ảnh hưởng FR-03, FR-10, mục 3 quy tắc 5, mục 6)
- (2026-11-04) Hỏi: Cách bật ở production (câu hỏi mở số 4 khi đó): mọi người cùng lúc hay thử allowlist, có môi trường thử riêng không → Đáp: **Oniichan: "Bật ở production luôn, không cần thử."** Hệ quả: bật `FEATURE_CRM_PUSH` cho mọi người cùng lúc, không allowlist, không môi trường thử riêng; kiểm iPhone/Android thật ngay trên production sau khi bật; FR-14, FR-15, FR-16, FR-18 (PT-037, PT-038, PT-039, PT-041) vẫn xong trước khi bật (ban đầu là FR-14 đến FR-18; FR-17 (PT-040) sau đó được Oniichan cho `Bỏ`, xem dòng GPS bên dưới); cờ phải tắt được ngay không đổi code (ảnh hưởng FR-07, mục 3 quy tắc 14, mục 4.1, 4.2, mục 5 rủi ro 14, mục 6)
- (2026-11-04) Hỏi: Mock "đẩy thông báo" ở web admin còn không (câu hỏi mở số 5 khi đó) → Đáp: **Oniichan yêu cầu kiểm; đã kiểm code ngày 2026-11-04: không có mock "đẩy thông báo" nào** (`featureFlags.ts` chỉ có hai cờ mock là Báo cáo và nhập/xuất; không có màn/hàm đẩy thông báo hay push broadcast; hook `useUnreadNotificationCount` chỉ ghi chú "chưa có push, M7"). Hệ quả: FR-11 `Bỏ (không còn đối tượng)`, giữ mã; đồng thời xác nhận **web admin chưa có trang "Cài đặt thông báo" cá nhân** (không có tham chiếu `quietHours` hay `notification-preferences` ở `RealEstateAdminApp/src`; backend đã có module `notifications` với `notification-preferences`), nên FR-09 và FR-10 phải tạo mới trang này (ảnh hưởng FR-09, FR-10, FR-11)
- (2026-11-04) Hỏi: Giữ số `1.0.4` cho phiên bản có tính năng mới (theo semver thuần là `1.1.0`) như ngoại lệ đã chấp nhận ở v1.0.2 không (câu hỏi mở số 6 khi đó) → Đáp: **Oniichan: "Giữ 1.0.4."** Hệ quả: ghi nhận ngoại lệ thứ hai ở mục 1 của `README.md` thư mục `08_Quan_Ly_Phien_Ban` (ảnh hưởng mục 5 rủi ro 13, mục 6, quy ước README)
- (2026-11-04) Hỏi: Giới hạn số thiết bị (subscription) tối đa mỗi người và thời hạn dọn subscription không dùng (câu hỏi mở số 7 khi đó) → Đáp: **Oniichan: "Tối đa 3 thiết bị thôi, dọn sau 90 ngày không hoạt động."** Hệ quả: mỗi người tối đa 3 subscription còn hiệu lực, thiết bị thứ 4 thì gỡ cái hoạt động gần nhất lâu nhất và báo cho người dùng; subscription 90 ngày không hoạt động thì job định kỳ idempotent tự xóa; FR-05 nâng từ Tùy chọn lên Nên có; định nghĩa "hoạt động" để `architect-agent` quyết (ảnh hưởng FR-01, FR-05, mục 4.1, mục 6)
- (2026-11-04) Hỏi: Phạm vi push của `CUSTOMER_ASSIGNED` ("được mời cùng phụ trách một khách"): mọi tình huống sinh mã này hay chỉ khi được thêm làm người cùng phụ trách → Đáp: **Oniichan: "chỉ khi người dùng được thêm làm người cùng phụ trách."** Hệ quả: push chỉ khi người nhận được thêm vào nhóm chăm sóc với vai trò người cùng phụ trách (không phải phụ trách chính), kể cả qua duyệt đề nghị tham gia và thêm hàng loạt người cùng chăm sóc (kết quả là người cùng phụ trách mới); không push khi được đặt làm phụ trách chính, khi tạo khách có phân người, và với phân hàng loạt kiểu đổi phụ trách chính (vẫn ghi hộp thông báo trong app). `architect-agent` đối chiếu đường thêm hàng loạt để gộp hoặc giới hạn push (ảnh hưởng FR-43, FR-03, mục 2.1.1 dòng 1, mục 5 rủi ro 7, mục 6)
- (2026-11-04) Hỏi: Mẫu push có hiện tên khách trên màn khóa không → Đáp: **Oniichan: "Mẫu push có hiện tên khách trên màn khóa"** (tức CÓ hiện). Lưu ý trung thực: tên khách là dữ liệu cá nhân và có thể nhìn thấy ở màn khóa điện thoại; Oniichan đã chấp nhận. Hệ quả: giữ `{tên khách}` trong cả 5 mẫu; vẫn cấm SĐT, CCCD, email, nội dung nhật ký/ghi chú/lời nhắn trong mọi mẫu (ảnh hưởng FR-06, mục 3 quy tắc 10, mục 2.1.1, mục 5 rủi ro 6)
- (2026-11-04) Hỏi: Ảnh điện thoại có GPS thật khi bật ảnh đính kèm đã thử chưa (FR-17 (PT-040)) → Đáp: **Oniichan: "Không cần xóa GPS khi up ảnh."** Hệ quả: FR-17 (PT-040) chuyển `Bỏ`, giữ mã; bỏ khỏi điều kiện xong trước khi bật push (còn FR-14, FR-15, FR-16, FR-18, tức PT-037, PT-038, PT-039, PT-041), bỏ tiêu chí nghiệm thu GPS. Lưu ý trung thực: hành vi hiện tại của backend (đã bỏ Exif/GPS đồng bộ, theo ghi chú M3 trong tài liệu 06) **không bị yêu cầu đổi**; đây chỉ là bỏ yêu cầu kiểm/đảm bảo (ảnh hưởng FR-17, mục 3 quy tắc 14, mục 4.1, 4.2, mục 5 rủi ro 14, mục 6)
- (2026-11-04) Hỏi: Lỗi mới còn lại gửi khi nào, và lỗi Blocker/Major (kể cả PT-032, PT-033) có được chen lên trước M7 không → Đáp: **Oniichan: "Được chen lên, những việc nhẹ như sửa giao diện."** Hệ quả: lỗi nhẹ (sửa giao diện, chỉ FE) được làm trước hoặc song song M7; lỗi nặng (Blocker/Major về dữ liệu/bảo mật) vẫn xử lý ngay theo mức độ; phần "khi nào gửi danh sách còn lại" không còn là câu hỏi, Oniichan sẽ gửi khi có (ảnh hưởng mục 2.3, mục 4.1, mục 5 rủi ro 11)
- (2026-11-04) Hỏi: Điểm a11y sidebar mobile còn mở từ v1.0.3 (sidebar đóng vẫn nằm trong thứ tự Tab) đưa vào v1.0.4 hay `Bỏ` → Đáp: **Oniichan: "Đưa vào 1.0.4."** Hệ quả: thêm PT-061 (FR-45), Sửa lỗi nhóm FE, Minor/Cải tiến (đề xuất), Nên có (ảnh hưởng mục 2.3, FR-45)
- (2026-11-04) Hỏi: PT-035 (Trường chân dung) chia hai đợt, nếu không kịp thì dời đợt 2 sang v1.0.5 không → Đáp: **Oniichan: "Làm luôn trong 1.0.4."** Hệ quả: làm CẢ HAI đợt (đợt 1 sửa nhãn/lựa chọn/bật tắt/thứ tự; đợt 2 thêm/bớt trường) trong v1.0.4, cùng một phát hành, không dời đợt 2 sang v1.0.5; vẫn làm theo thứ tự đợt 1 rồi đợt 2 (ảnh hưởng FR-41 (PT-035), mục 4.1, mục 6)
- (2026-11-04) Hỏi: Có đưa 4 mục nhỏ của rà soát danh mục vào v1.0.4 không ("loại hình" dự án dùng danh mục chung; ô kết quả cuộc gọi trong `CallModal`; loại thẻ `OTHER`; bộ lọc nâng cao theo chân dung) → Đáp: **Oniichan: "Làm luôn."** Hệ quả: cả 4 việc vào v1.0.4, mỗi việc một dòng: PT-062 (FR-46), PT-063 (FR-47), PT-064 (FR-48), PT-065 (FR-49); PT-062 làm sau thiết kế PT-034 và PT-035 vì cần BE và có thể cần migration; mã PT tiếp theo `PT-066`, mã FR tiếp theo `FR-50` (ảnh hưởng mục 2.3, FR-45 đến FR-49, mục 4.1, mục 6)

---

Tài liệu liên quan: `08_Quan_Ly_Phien_Ban/01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md` (PT-030: PWA), `08_Quan_Ly_Phien_Ban/README.md`, `06_Module_Customer_Management/04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`, `06_Module_Customer_Management/05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`, `06_Module_Customer_Management/06_Theo_Doi_Milestone_Module_Quan_Ly_Khach_Hang.md`, `01_Infrastructure/06_Production_Deploy.md`