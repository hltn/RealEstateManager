# 08 — Quản lý phiên bản

> **Phiên bản tài liệu:** v1.0.4

Mục lục phiên bản của toàn bộ hệ thống Real Estate Manager: quy ước đánh số, bảng phiên bản hệ thống, phiên bản từng thành phần ứng dụng, phiên bản từng tài liệu, và quy trình phát hành một phiên bản mới.

**Phiên bản hiện tại: v1.0.3** (đang chạy production từ 2026-11-04; trước đó v1.0.2 từ 2026-11-02).

Bản tóm tắt thay đổi theo phiên bản (đọc nhanh, kiểu Keep a Changelog) nằm ở [`../../CHANGELOG.md`](../../CHANGELOG.md) ở thư mục gốc repo; file này vẫn là nguồn chính và đầy đủ.

## 1. Quy ước đánh số

Dùng semver `X.Y.Z`, một số phiên bản **chung cho cả hệ thống** (tài liệu + ứng dụng):

| Phần | Khi nào tăng | Ví dụ |
|---|---|---|
| `Z` (vá) | Sửa lỗi, bổ sung nhỏ, chỉnh tài liệu; không đổi hành vi hợp đồng | `v1.0.2` → `v1.0.3` |
| `Y` (tính năng) | Thêm tính năng tương thích ngược (API cũ vẫn chạy, dữ liệu cũ vẫn đọc được) | `v1.0.x` → `v1.1.0` |
| `X` (phá vỡ) | Thay đổi phá vỡ tương thích (đổi hợp đồng API, đổi schema không có đường lùi) | `v1.x.y` → `v2.0.0` |

**Ngoại lệ đã chấp nhận:** đợt v1.0.2 có endpoint, trường dữ liệu và migration mới (005, 006) nên theo semver thuần là `1.1.0`; số `1.0.2` là **quyết định của Oniichan**, không phải kết quả áp quy tắc trên. Ngoại lệ thứ hai: v1.0.4 có tính năng mới (Web Push, endpoint và trường dữ liệu mới) nên theo semver thuần là `1.1.0`; số `1.0.4` là **quyết định của Oniichan (2026-11-04)**, tương tự v1.0.2, không phải kết quả áp quy tắc trên.

Quy tắc kèm theo:

- Ba ứng dụng `RealEstateBackendApp`, `RealEstateAdminApp`, `RealEstateApp` **đi cùng số phiên bản hệ thống** (xem mục 3). `stnd-crm-unified` là prototype độc lập, **không đi theo bản phát hành**.
- Mỗi tài liệu mang số phiên bản của **lần phát hành gần nhất làm đổi nội dung tài liệu đó** (mục 4), không phải số của lần phát hành hiện tại.
- **Ngoại lệ về header tài liệu:** tài liệu kế hoạch của một phiên bản chưa phát hành mang số phiên bản kế tiếp (ví dụ `03_Ke_Hoach_v1.0.4.md` mang `v1.0.4` dù hệ thống đang ở v1.0.3).
- Sửa đổi tính năng CRM được ghi chi tiết theo phiên bản ở [`../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md).
- **Ngoại lệ về đổi tài liệu:** tick `[x]` và điền "Test tham chiếu" của ma trận phủ FR trong file Tasks (`/spec-implement`) không đổi phiên bản tài liệu và không cập nhật bảng mục 4.
- Trạng thái dùng 3 giá trị: **Kế hoạch** · **Đang làm** · **Xong**.

## 2. Bảng phiên bản hệ thống

| Phiên bản | Ngày | Nội dung chính | Trạng thái | Link |
|---|---|---|---|---|
| v1.0.1 | trước 2026-10-29 | Nền tảng: toàn bộ tài liệu và tính năng có trước đợt sửa đổi A–D (Auth, News, Knowledge Articles, Market Analysis, CRM giai đoạn 1, hạ tầng, mobile) | Xong | Toàn bộ tài liệu có header `v1.0.1` ở mục 4 |
| v1.0.2 | 2026-11-02 (lên production) | Nâng cấp production lên stack mới (Mongo replica set `rs0` có xác thực, Redis, MinIO, 9Router trong compose, `deploy.sh`, migration runner) cùng đợt sửa đổi CRM A–D: nhiều role/nhóm, khu vực 34 tỉnh thành, thành viên nhóm, xóa/khôi phục/xóa vĩnh viễn khách "Bỏ". Production chạy commit `e6099c0`; migration 005 và 006 đã chạy xong trên VPS | Xong về triển khai (đã lên production); chưa đóng chính thức ở mục 09 vì chờ nghiệm thu thực tế | [`../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md), [`../01_Infrastructure/06_Production_Deploy.md`](../01_Infrastructure/06_Production_Deploy.md) |
| v1.0.3 | 2026-11-04 (lên production) | Sửa và bổ sung sau khi test production (chủ yếu giao diện mobile), web admin thành PWA cài được trên iPhone/Android, sổ phiên bản trong collection `system` và tự chạy migration khi deploy, các việc hạ tầng/bảo mật. Tổng 31 mục PT: **28 mục Xong, 3 mục Bỏ** (PT-012, PT-014, PT-015). Oniichan xác nhận toàn bộ đã xong (gồm kiểm trên iPhone/Android thật, VPS, AI qua 9Router, nới đĩa) và v1.0.3 đã lên production ngày 2026-11-04. Thẻ git `v1.0.3` trên `d2e5282` (xem phần Thẻ git) | Xong | [`01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md`](01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md) |
| v1.0.4 | chưa có | Plan, Architecture, Tasks (70 task) đều `Approved` 2026-11-04: **49 yêu cầu** (mã `FR-01` đến `FR-49` để truy vết) = 13 yêu cầu M7 Web Push (VAPID) cho PWA (FR-01 đến FR-13; tính năng giai đoạn 2 duy nhất, chỉ có FR) + 2 yêu cầu M7 thêm sau (FR-43 danh mục loại thông báo push có mã, gồm đúng 4 loại: push khách lâu chưa chăm sóc `STALE_CUSTOMER` dời sang v1.0.5 theo quyết định của Oniichan 2026-11-04; FR-44 dịch vụ phát thông báo dùng chung, tái sử dụng được, để sau này làm MCP cho agent ngoài; MCP nằm ngoài v1.0.4) + 24 mục backlog QA của M0–M6 + 5 lỗi mới đã nêu từ đầu (FR-38 đến FR-42) + 5 lỗi mới/cải tiến nhận thêm (FR-45 đến FR-49) (13 + 2 + 24 + 5 + 5 = 49; FR-11 đã `Bỏ (không còn đối tượng)`, FR-17 (PT-040) đã `Bỏ` (Oniichan quyết định 2026-11-04: không cần xóa GPS khi tải ảnh lên) FR-18 (PT-041, giới hạn lô quét khách lâu chưa chăm sóc) và FR-20 (PT-043, idempotency) đã `Bỏ` (Oniichan quyết định 2026-11-04) nhưng vẫn giữ mã; FR-19 (PT-042, Throttler Redis), FR-24 (PT-047), FR-27 (PT-050), FR-28 (PT-051), FR-32 (PT-055), FR-34 (PT-057) và FR-36 (PT-059) `Hoãn`, chưa gắn phiên bản, và FR-37 (PT-060) `Hoãn` sang v1.0.5 cùng loại push `STALE_CUSTOMER` (Oniichan quyết định 2026-11-04); FR-33 (PT-056) `Không cần`; còn 36 yêu cầu hiệu lực, trong đó FR-23 (PT-046), FR-30 (PT-053) và FR-31 (PT-054) `Đã xong` (FR-23 còn một việc kiểm tay trên production), FR-35 (PT-058) là việc Oniichan kiểm dữ liệu khi deploy (không giao coder), và 32 yêu cầu còn phải làm (27 việc code, 5 việc tài liệu/test: FR-08, FR-12, FR-13, FR-25, FR-29); 49 - 4 `Bỏ` - 8 `Hoãn` - 1 `Không cần` = 36; 36 - 3 - 1 = 32). **Sửa lỗi gồm 24 mục backlog QA (PT-037 đến PT-060, tức FR-14 đến FR-37; PT-040, PT-041 và PT-043 đã `Bỏ`; PT-042, PT-047, PT-050, PT-051, PT-055, PT-057, PT-059 và PT-060 `Hoãn`; PT-056 `Không cần`; PT-046, PT-053 và PT-054 `Đã xong`), 5 lỗi mới (PT-032 đến PT-036, tức FR-38 đến FR-42) và 5 lỗi mới/cải tiến nhận thêm (PT-061 đến PT-065, tức FR-45 đến FR-49); mã PT tiếp theo PT-066, mã FR tiếp theo FR-50** (mọi dòng Sửa lỗi có mã PT nối tiếp v1.0.3, Oniichan duyệt 2026-11-04). Lỗi mới: PT-032 (FR-38: màn thông báo mobile 20 mục + tải thêm khi cuộn, dropdown kiểu Facebook trên desktop), PT-033 (FR-39: thêm tab Kết quả liên hệ vào Cài đặt CRM, rà các danh mục khác còn thiếu màn), PT-034 (FR-40: đổi tham chiếu danh mục từ ObjectId sang `code`, cần thiết kế và migration; Oniichan quyết định làm luôn trong v1.0.4 ngày 2026-11-04, ưu tiên Phải có, không dời sang v1.0.5), PT-035 (FR-41: màn quản lý Trường chân dung, chia hai đợt), PT-036 (FR-42: tab quản lý Thẻ), PT-061 (FR-45: sidebar mobile đóng vẫn nằm trong thứ tự phím Tab), PT-062 (FR-46: "loại hình" Dự án chọn từ danh sách chung dùng chung lựa chọn của trường chân dung, cần BE và có thể cần migration), PT-063 (FR-47: ô kết quả liên hệ của `CallModal` dùng danh mục DB), PT-064 (FR-48: chọn loại thẻ `OTHER`), PT-065 (FR-49: bộ lọc nâng cao theo chân dung). PT-035 (FR-41) làm cả hai đợt trong v1.0.4. Lỗi nhẹ (sửa giao diện) được chen lên trước hoặc làm song song M7. Việc dở của v1.0.3 không còn (đã xong, bỏ khỏi v1.0.4). M8–M12 để các phiên bản sau. Không còn câu hỏi mở (13 câu ban đầu, 12 câu đã được Oniichan trả lời 2026-11-04: loại thông báo push, nội dung push, giờ yên lặng, cách bật production, mock đẩy thông báo, số phiên bản, giới hạn thiết bị, ảnh GPS, lỗi mới chen trước M7, a11y sidebar, PT-035 chia hai đợt, mục nhỏ của rà soát danh mục; hai câu phát sinh thêm là phạm vi push của `CUSTOMER_ASSIGNED` và tên khách trên màn khóa cũng đã trả lời trong ngày; câu cuối là việc kiểm `qa-agent` đối chiếu việc M0/M1 với code thật, đã xong 2026-11-04; đã chốt `VAPID_SUBJECT=mailto:info@stnd.vn` và chấp nhận push iOS không cam kết thời gian đến) | Kế hoạch, Kiến trúc, Tasks | [`03_Ke_Hoach_v1.0.4.md`](03_Ke_Hoach_v1.0.4.md), [`04_Ke_Hoach_v1.0.4_Architecture.md`](04_Ke_Hoach_v1.0.4_Architecture.md), [`05_Ke_Hoach_v1.0.4_Tasks.md`](05_Ke_Hoach_v1.0.4_Tasks.md) |

Ba mốc ngày của v1.0.2: **2026-10-29** soạn mục 09 (đợt sửa đổi A–D); **2026-11-02** commit `d0037f2` ("đánh số phiên bản v1.0.2", manifest 1.0.2) là commit mang thẻ git `v1.0.2`, và cùng ngày lên production (production thực chạy commit `e6099c0`, manifest lúc đó còn số cũ). Thẻ cục bộ cũ trỏ `ad59c4b` (2026-11-01) đã bị thay.

Thẻ git (**đã quyết**, Oniichan, 2026-11-04):

- `v1.0.1`: thẻ **giữ nguyên trên remote**, trỏ commit `932db04` (2026-08-24). Mốc này cũ hơn một phần nội dung được xếp vào v1.0.1 (ví dụ tài liệu CRM soạn tháng 10); việc có dời mốc hay không **chưa quyết** (chưa nằm trong quyết định 2026-11-04).
- `v1.0.2`: **đặt lại lên `d0037f2`** (2026-11-02, "đánh số phiên bản v1.0.2") rồi push, thay cho thẻ cục bộ cũ trỏ `ad59c4b` (2026-11-01, chưa push). Lý do: `d0037f2` có manifest 1.0.2 và nằm trên cả `main` lẫn `production`; còn `e6099c0` (merge PR #17) không nằm trên `main` và manifest còn số cũ (backend 0.0.1, admin 0.0.0, mobile 1.0.0). Lưu ý: production thực chạy `e6099c0` lúc 2026-11-02 (manifest lúc đó còn số cũ), nên thẻ `v1.0.2` đánh dấu bản phát hành chứ không phải commit chính xác đã build trên VPS.
- `v1.0.3`: **đã đặt và đã push** lên remote `hltn` trên `d2e5282` (thẻ annotated; nhánh `main`, merge PR #19; đã gồm PT-031).
- Cả hai thẻ `v1.0.2` và `v1.0.3` **push lên remote `hltn`**.
- Hệ quả khác: Swagger đang đặt cứng `.setVersion('1.0')` (`main.ts`) và backend chưa có endpoint trả số phiên bản, nên chưa đối chiếu được production với bản phát hành. Đề xuất hiển thị số phiên bản chạy thật ghi ở mục PT-014 của file kế hoạch v1.0.3, mục này đã `Bỏ` (Oniichan quyết định, 2026-11-02) nên không có việc nào xử lý ý này; phần đưa số phiên bản app vào image Docker nằm ở PT-027.

## 3. Phiên bản thành phần ứng dụng

| Thành phần | Thư mục | Tệp chứa số phiên bản | Phiên bản | Ghi chú |
|---|---|---|---|---|
| Backend | `RealEstateBackendApp/` | `package.json` + `package-lock.json` | 1.0.3 | Đi theo bản phát hành |
| Web admin | `RealEstateAdminApp/` | `package.json` + `package-lock.json` | 1.0.3 | Đi theo bản phát hành |
| Mobile | `RealEstateApp/` | `package.json` + `package-lock.json` + `app.json` (`expo.version`) | 1.0.3 | Đi theo bản phát hành |
| Prototype CRM | `stnd-crm-unified/` | `package.json` | 0.2.0 | **Độc lập, không đi theo bản phát hành**; dùng dữ liệu mock thay API thật, giữ số riêng |

Manifest hiện là **1.0.3** (commit `b40b851`, 2026-11-03). Số **1.0.2** là số tại `d0037f2` (commit mang thẻ `v1.0.2`).

## 4. Phiên bản từng tài liệu

Cột "Phiên bản tài liệu" khớp với dòng `> **Phiên bản tài liệu:** vX.Y.Z` ngay dưới tiêu đề của từng file. Không liệt kê `archive/` và `_templates/`.

| Tài liệu | Phiên bản tài liệu | Ghi chú |
|---|---|---|
| [`00_Project_Overview/01_Project_Plan.md`](../00_Project_Overview/01_Project_Plan.md) | v1.0.1 |  |
| [`00_Project_Overview/02_Technical_Design.md`](../00_Project_Overview/02_Technical_Design.md) | v1.0.1 |  |
| [`00_Project_Overview/README.md`](../00_Project_Overview/README.md) | v1.0.1 |  |
| [`01_Infrastructure/01_Backend_Plan.md`](../01_Infrastructure/01_Backend_Plan.md) | v1.0.1 |  |
| [`01_Infrastructure/02_Database_Plan.md`](../01_Infrastructure/02_Database_Plan.md) | v1.0.1 |  |
| [`01_Infrastructure/03_Database_Mongo_Plan.md`](../01_Infrastructure/03_Database_Mongo_Plan.md) | v1.0.1 |  |
| [`01_Infrastructure/04_Request_Logging_Plan.md`](../01_Infrastructure/04_Request_Logging_Plan.md) | v1.0.1 |  |
| [`01_Infrastructure/05_External_Log_Module_Design.md`](../01_Infrastructure/05_External_Log_Module_Design.md) | v1.0.1 |  |
| [`01_Infrastructure/06_Production_Deploy.md`](../01_Infrastructure/06_Production_Deploy.md) | v1.0.2 | Nâng cấp production lên stack mới (9Router trong compose, `deploy.sh`, migration runner) |
| [`01_Infrastructure/README.md`](../01_Infrastructure/README.md) | v1.0.1 |  |
| [`02_Module_Auth/01_Auth_Module_Plan.md`](../02_Module_Auth/01_Auth_Module_Plan.md) | v1.0.1 |  |
| [`02_Module_Auth/02_Auth_Module_Architecture.md`](../02_Module_Auth/02_Auth_Module_Architecture.md) | v1.0.2 | `roles[]`/`teamIds[]`, claim `roles` trong JWT |
| [`02_Module_Auth/README.md`](../02_Module_Auth/README.md) | v1.0.1 |  |
| [`03_Module_News/01_News_Module_Plan.md`](../03_Module_News/01_News_Module_Plan.md) | v1.0.1 |  |
| [`03_Module_News/02_News_Module_Data_Model.md`](../03_Module_News/02_News_Module_Data_Model.md) | v1.0.1 |  |
| [`03_Module_News/03_Content_Dedup_Design.md`](../03_Module_News/03_Content_Dedup_Design.md) | v1.0.1 |  |
| [`03_Module_News/04_Content_Dedup_QA_Report.md`](../03_Module_News/04_Content_Dedup_QA_Report.md) | v1.0.1 |  |
| [`03_Module_News/README.md`](../03_Module_News/README.md) | v1.0.1 |  |
| [`04_Module_Knowledge_Articles/01_Knowledge_Articles_Plan.md`](../04_Module_Knowledge_Articles/01_Knowledge_Articles_Plan.md) | v1.0.1 |  |
| [`04_Module_Knowledge_Articles/02_Knowledge_Articles_Design.md`](../04_Module_Knowledge_Articles/02_Knowledge_Articles_Design.md) | v1.0.1 |  |
| [`04_Module_Knowledge_Articles/README.md`](../04_Module_Knowledge_Articles/README.md) | v1.0.1 |  |
| [`05_Module_Market_Analysis/01_Export_Market_Analysis_Google_Drive.md`](../05_Module_Market_Analysis/01_Export_Market_Analysis_Google_Drive.md) | v1.0.1 |  |
| [`05_Module_Market_Analysis/02_Export_GDrive_Research.md`](../05_Module_Market_Analysis/02_Export_GDrive_Research.md) | v1.0.1 |  |
| [`05_Module_Market_Analysis/03_Export_GDrive_Architecture.md`](../05_Module_Market_Analysis/03_Export_GDrive_Architecture.md) | v1.0.1 |  |
| [`05_Module_Market_Analysis/README.md`](../05_Module_Market_Analysis/README.md) | v1.0.1 |  |
| [`06_Module_Customer_Management/01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md`](../06_Module_Customer_Management/01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md) | v1.0.1 |  |
| [`06_Module_Customer_Management/02_Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md`](../06_Module_Customer_Management/02_Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md) | v1.0.1 |  |
| [`06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md`](../06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md) | v1.0.2 | Giao diện mặc định light |
| [`06_Module_Customer_Management/04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](../06_Module_Customer_Management/04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) | v1.0.2 | Data model nhiều role/nhóm, 34 tỉnh, `purgingAt` |
| [`06_Module_Customer_Management/05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`](../06_Module_Customer_Management/05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md) | v1.0.2 | Endpoint mới: roles, teams, thành viên nhóm, xóa/xóa vĩnh viễn khách |
| [`06_Module_Customer_Management/06_Theo_Doi_Milestone_Module_Quan_Ly_Khach_Hang.md`](../06_Module_Customer_Management/06_Theo_Doi_Milestone_Module_Quan_Ly_Khach_Hang.md) | v1.0.1 |  |
| [`06_Module_Customer_Management/07_Ke_Hoach_Kiem_Thu_Giao_Dien_Tu_Dong.md`](../06_Module_Customer_Management/07_Ke_Hoach_Kiem_Thu_Giao_Dien_Tu_Dong.md) | v1.0.1 |  |
| [`06_Module_Customer_Management/08_Kich_Ban_Kiem_Thu_Giao_Dien_Chi_Tiet.md`](../06_Module_Customer_Management/08_Kich_Ban_Kiem_Thu_Giao_Dien_Chi_Tiet.md) | v1.0.1 |  |
| [`06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md) | v1.0.2 | Đợt sửa đổi A–D (đánh số lại thành v1.0.2 ngày 2026-11-02) |
| [`06_Module_Customer_Management/README.md`](../06_Module_Customer_Management/README.md) | v1.0.2 | Cập nhật dòng 09 và con trỏ sang `08_Quan_Ly_Phien_Ban` |
| [`07_Frontend_Mobile/01_React_Native_Plan.md`](../07_Frontend_Mobile/01_React_Native_Plan.md) | v1.0.1 |  |
| [`07_Frontend_Mobile/02_UI_Design_Plan.md`](../07_Frontend_Mobile/02_UI_Design_Plan.md) | v1.0.1 |  |
| [`07_Frontend_Mobile/README.md`](../07_Frontend_Mobile/README.md) | v1.0.1 |  |
| [`08_Quan_Ly_Phien_Ban/01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md`](01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md) | v1.0.3 | Kế hoạch và hồ sơ v1.0.3 (31 mục: 28 Xong, 3 Bỏ); đã lên production 2026-11-04 |
| [`08_Quan_Ly_Phien_Ban/03_Ke_Hoach_v1.0.4.md`](03_Ke_Hoach_v1.0.4.md) | v1.0.4 | Kế hoạch v1.0.4 (`Approved` 2026-11-04), chưa phát hành |
| [`08_Quan_Ly_Phien_Ban/04_Ke_Hoach_v1.0.4_Architecture.md`](04_Ke_Hoach_v1.0.4_Architecture.md) | v1.0.4 | Thiết kế kiến trúc v1.0.4 (`Approved`, Oniichan ủy quyền Neptune duyệt 2026-11-04 sau khi qa-agent rà), chưa phát hành |
| [`08_Quan_Ly_Phien_Ban/05_Ke_Hoach_v1.0.4_Tasks.md`](05_Ke_Hoach_v1.0.4_Tasks.md) | v1.0.4 | Danh sách 70 task v1.0.4 (`Approved`, Oniichan ủy quyền Neptune duyệt 2026-11-04), chưa phát hành |
| [`08_Quan_Ly_Phien_Ban/README.md`](README.md) | v1.0.4 | File này; v1.0.3: cập nhật hàng `docs/README.md`, ngoại lệ tick `[x]` không đổi phiên bản; v1.0.4: thêm dòng v1.0.4 ở mục 2 và hàng file kế hoạch, file kiến trúc ở mục 4; cập nhật dòng v1.0.3 thành Xong (đã lên production 2026-11-04), phiên bản hiện tại v1.0.3, thẻ `v1.0.3` đã đặt và push |
| [`README.md`](../README.md) | v1.0.4 | Thêm thư mục 08, phiên bản hiện tại, quy ước phiên bản tài liệu; v1.0.3: vòng đời Plan → Architecture → Tasks (tên file `NN_<Ten>_…`, `NN` = max + 1), bộ lệnh `/spec-*`, ngoại lệ tick `[x]` ; v1.0.4: dòng "Phiên bản hiện tại" = v1.0.3 (production từ 2026-11-04) |

Cách xếp: file nào đổi nội dung trong đợt v1.0.2 (theo lịch sử git từ 2026-10-29 và nội dung) mang `v1.0.2`; các file còn lại là `v1.0.1`. File `01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md` là kế hoạch và hồ sơ của v1.0.3, phiên bản đã phát hành (2026-11-04). Từ khi v1.0.3 phát hành, phiên bản đang phát triển là v1.0.4: tài liệu mới tạo hoặc sửa bằng bộ `/spec-*` mang số `v1.0.4`. File `03_Ke_Hoach_v1.0.4.md` là kế hoạch (`Approved`) của v1.0.4 (chưa phát hành) nên mang `v1.0.4` theo ngoại lệ ở mục 1.

## 5. Quy trình phát hành một phiên bản mới

Checklist dưới đây là **đề xuất**; mọi bước ghi ra ngoài máy (push, đặt thẻ trên remote, deploy) phải có Oniichan đồng ý.

1. Chốt nội dung phiên bản: mọi mục liên quan trong file cập nhật của phiên bản đó ở trạng thái Xong hoặc Hoãn có lý do.
2. Sửa số phiên bản của ba ứng dụng: `package.json` và `package-lock.json` của `RealEstateBackendApp`, `RealEstateAdminApp`, `RealEstateApp`; thêm `app.json` (`expo.version`) của `RealEstateApp`. Không đụng `stnd-crm-unified`.
3. Cập nhật mục 2 (bảng phiên bản hệ thống) và mục 3 (bảng thành phần) của file này.
4. Với mỗi tài liệu có nội dung đổi: sửa dòng `> **Phiên bản tài liệu:**` ngay dưới tiêu đề và hàng tương ứng ở mục 4.
5. Cập nhật tiêu đề, trạng thái ở `06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md` nếu phiên bản có đổi tính năng CRM; cập nhật `docs/README.md` (dòng "Phiên bản hiện tại").
6. Chạy test và build của ba ứng dụng, đối chiếu với Definition of Done của phiên bản.
7. **Migration dữ liệu (PT-027):** phiên bản có đổi schema/dữ liệu thì thêm migration vào registry `RealEstateBackendApp/src/migrations/` (id `NNN_ten`, chạy lại được an toàn, tương thích ngược) kèm test tích hợp, và ghi vào file kế hoạch của phiên bản. Trước khi deploy, kiểm `status`/dry-run bằng runner trong image mới (`docker compose --env-file .env.docker run --rm --no-deps backend node dist/migrations/cli.js status`, chỉ đọc) và đọc danh sách migration chờ. **Lần đầu** trên production không còn bước `baseline` tay: `deploy.sh` tự probe chỉ-đọc 002..006 rồi tự baseline; chạy `bash deploy.sh --plan-only` một lần trước để xem kết quả probe (xem `06_Production_Deploy.md` mục 11.1). Số phiên bản trong `package.json` của backend (bước 2) chính là số runner ghi vào collection `system`, nên bước 2 phải xong **trước** khi build image.
8. Đặt thẻ git `vX.Y.Z` lên đúng commit sẽ chạy production (đề xuất, push thẻ khi Oniichan đồng ý).
9. Triển khai theo [`../01_Infrastructure/06_Production_Deploy.md`](../01_Infrastructure/06_Production_Deploy.md) (mục 11 cho `deploy.sh`):
   1. Backup tự động trước deploy; chép bản backup ra **ngoài** máy chủ.
   2. Migration: `deploy.sh` **tự chạy** (mặc định BẬT) sau backup và trước `up`: baseline 002..006 khi probe chỉ-đọc đạt, rồi migration chờ từ 007, rồi ghi `version` sau khi backend sống. Muốn xem trước: `bash deploy.sh --plan-only` (không backup, không ghi, không `up`). Muốn tắt: `bash deploy.sh --no-pull --no-migrate` (có việc chờ thì dừng trước `up`). Lỗi/khóa/probe không đạt/downgrade thì dừng **trước `up`** (stack không đổi) và in lệnh xử lý (mục 11.1). Migration 005/006 của đợt v1.0.2 vẫn chạy qua `scripts/run-migration.sh` (mục 5.4a).
   3. Sau deploy: `status` của runner thoát mã `0`, `version` trong collection `system` khớp số phiên bản vừa phát hành; `docker compose ps` backend `healthy`; `/api/v1/health/readiness` trả `200`.
   4. Việc sau deploy phụ thuộc VPS (xác minh `NODE_ENV`/Swagger đã tắt, ghim digest image, kiểm cổng 27017) theo `06_Production_Deploy.md` mục 2, 12, 13.

[← Về chỉ mục tài liệu](../README.md)
