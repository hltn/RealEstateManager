# 08 — Quản lý phiên bản

> **Phiên bản tài liệu:** v1.0.2

Mục lục phiên bản của toàn bộ hệ thống Real Estate Manager: quy ước đánh số, bảng phiên bản hệ thống, phiên bản từng thành phần ứng dụng, phiên bản từng tài liệu, và quy trình phát hành một phiên bản mới.

**Phiên bản hiện tại: v1.0.2** (đang chạy production từ 2026-11-02).

## 1. Quy ước đánh số

Dùng semver `X.Y.Z`, một số phiên bản **chung cho cả hệ thống** (tài liệu + ứng dụng):

| Phần | Khi nào tăng | Ví dụ |
|---|---|---|
| `Z` (vá) | Sửa lỗi, bổ sung nhỏ, chỉnh tài liệu; không đổi hành vi hợp đồng | `v1.0.2` → `v1.0.3` |
| `Y` (tính năng) | Thêm tính năng tương thích ngược (API cũ vẫn chạy, dữ liệu cũ vẫn đọc được) | `v1.0.x` → `v1.1.0` |
| `X` (phá vỡ) | Thay đổi phá vỡ tương thích (đổi hợp đồng API, đổi schema không có đường lùi) | `v1.x.y` → `v2.0.0` |

**Ngoại lệ đã chấp nhận:** đợt v1.0.2 có endpoint, trường dữ liệu và migration mới (005, 006) nên theo semver thuần là `1.1.0`; số `1.0.2` là **quyết định của Oniichan**, không phải kết quả áp quy tắc trên.

Quy tắc kèm theo:

- Ba ứng dụng `RealEstateBackendApp`, `RealEstateAdminApp`, `RealEstateApp` **đi cùng số phiên bản hệ thống** (xem mục 3). `stnd-crm-unified` là prototype độc lập, **không đi theo bản phát hành**.
- Mỗi tài liệu mang số phiên bản của **lần phát hành gần nhất làm đổi nội dung tài liệu đó** (mục 4), không phải số của lần phát hành hiện tại.
- **Ngoại lệ về header tài liệu:** tài liệu kế hoạch của một phiên bản chưa phát hành mang số phiên bản kế tiếp (ví dụ `01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md` mang `v1.0.3` dù hệ thống đang ở v1.0.2).
- Sửa đổi tính năng CRM được ghi chi tiết theo phiên bản ở [`../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md).
- Trạng thái dùng 3 giá trị: **Kế hoạch** · **Đang làm** · **Xong**.

## 2. Bảng phiên bản hệ thống

| Phiên bản | Ngày | Nội dung chính | Trạng thái | Link |
|---|---|---|---|---|
| v1.0.1 | trước 2026-10-29 | Nền tảng: toàn bộ tài liệu và tính năng có trước đợt sửa đổi A–D (Auth, News, Knowledge Articles, Market Analysis, CRM giai đoạn 1, hạ tầng, mobile) | Xong | Toàn bộ tài liệu có header `v1.0.1` ở mục 4 |
| v1.0.2 | 2026-11-02 (lên production) | Nâng cấp production lên stack mới (Mongo replica set `rs0` có xác thực, Redis, MinIO, 9Router trong compose, `deploy.sh`, migration runner) cùng đợt sửa đổi CRM A–D: nhiều role/nhóm, khu vực 34 tỉnh thành, thành viên nhóm, xóa/khôi phục/xóa vĩnh viễn khách "Bỏ". Production chạy commit `e6099c0`; migration 005 và 006 đã chạy xong trên VPS | Xong về triển khai (đã lên production); chưa đóng chính thức ở mục 09 vì chờ nghiệm thu thực tế | [`../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](../06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md), [`../01_Infrastructure/06_Production_Deploy.md`](../01_Infrastructure/06_Production_Deploy.md) |
| v1.0.3 | chưa có | Kế hoạch: các việc cần sửa/bổ sung sau khi chạy test trên production (hiện gồm 27 mục: 12 phát hiện lúc nâng cấp, 4 do QA đề xuất, 10 do Oniichan test web trên production ngày 2026-11-02 (PT-017 đến PT-026, giao diện mobile và một tính năng mới) và 1 do Oniichan yêu cầu bổ sung (PT-027, lưu phiên bản hệ thống trong collection `system` và cơ chế tự chạy migration); ngày 2026-11-02: 6 mục Xong (PT-003, PT-004, PT-007, PT-010, PT-011, PT-013), 16 mục Xong một phần (PT-001, PT-002, PT-008, PT-009, PT-016, PT-017 đến PT-027: đã code và test trong repo, chưa commit, chưa deploy; còn việc kiểm trên VPS hoặc iPhone thật), PT-012 (khu vực bị bỏ trống), PT-014 (hiển thị số phiên bản) và PT-015 (backup định kỳ) Oniichan quyết định Bỏ, 2 mục còn Mới (PT-005, PT-006); PT-022 mở rộng thành bỏ quy tắc tác giả sửa nhật ký trong 24 giờ, cần BE, FE và tài liệu) | Kế hoạch | [`01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md`](01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md) |

Ba mốc ngày của v1.0.2: **2026-10-29** soạn mục 09 (đợt sửa đổi A–D); **2026-11-01** ngày của commit mà thẻ git cục bộ `v1.0.2` đang trỏ tới (`ad59c4b`); **2026-11-02** lên production (commit `e6099c0`).

Thẻ git (đề xuất, việc push thẻ do Oniichan quyết):

- `v1.0.1` hiện có trên remote, trỏ commit `932db04` (2026-08-24). Mốc này cũ hơn một phần nội dung được xếp vào v1.0.1 (ví dụ tài liệu CRM soạn tháng 10), nên cần Oniichan quyết có giữ nguyên hay không.
- `v1.0.2`: lúc viết chỉ thấy thẻ cục bộ trỏ `ad59c4b` (2026-11-01), chưa push, chưa rõ ai tạo. Production đang chạy `e6099c0` (merge PR #17) với **manifest cũ** (backend 0.0.1, admin 0.0.0, mobile 1.0.0); commit nâng số lên 1.0.2 chưa có trong commit này. Hai hướng: **(a)** đặt thẻ `v1.0.2` lên `e6099c0` và ghi rõ manifest lệch số; **(b)** đặt thẻ lên commit nâng 1.0.2 rồi triển khai lại (redeploy).
- Hệ quả khác: Swagger đang đặt cứng `.setVersion('1.0')` (`main.ts`) và backend chưa có endpoint trả số phiên bản, nên chưa đối chiếu được production với bản phát hành. Đề xuất hiển thị số phiên bản chạy thật ghi ở mục PT-014 của file kế hoạch v1.0.3, mục này đã `Bỏ` (Oniichan quyết định, 2026-11-02) nên không có việc nào xử lý ý này; phần đưa số phiên bản app vào image Docker nằm ở PT-027.

## 3. Phiên bản thành phần ứng dụng

| Thành phần | Thư mục | Tệp chứa số phiên bản | Phiên bản | Ghi chú |
|---|---|---|---|---|
| Backend | `RealEstateBackendApp/` | `package.json` + `package-lock.json` | 1.0.2 | Đi theo bản phát hành |
| Web admin | `RealEstateAdminApp/` | `package.json` + `package-lock.json` | 1.0.2 | Đi theo bản phát hành |
| Mobile | `RealEstateApp/` | `package.json` + `package-lock.json` + `app.json` (`expo.version`) | 1.0.2 | Đi theo bản phát hành |
| Prototype CRM | `stnd-crm-unified/` | `package.json` | 0.2.0 | **Độc lập, không đi theo bản phát hành**; dùng dữ liệu mock thay API thật, giữ số riêng |

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
| [`08_Quan_Ly_Phien_Ban/01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md`](01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md) | v1.0.3 | Bản nháp kế hoạch v1.0.3, chưa phát hành |
| [`08_Quan_Ly_Phien_Ban/README.md`](README.md) | v1.0.2 | File này |
| [`README.md`](../README.md) | v1.0.2 | Thêm thư mục 08, phiên bản hiện tại, quy ước phiên bản tài liệu |

Cách xếp: file nào đổi nội dung trong đợt v1.0.2 (theo lịch sử git từ 2026-10-29 và nội dung) mang `v1.0.2`; các file còn lại là `v1.0.1`. File `01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md` là bản nháp kế hoạch của v1.0.3, chưa phát hành.

## 5. Quy trình phát hành một phiên bản mới

Checklist dưới đây là **đề xuất**; mọi bước ghi ra ngoài máy (push, đặt thẻ trên remote, deploy) phải có Oniichan đồng ý.

1. Chốt nội dung phiên bản: mọi mục liên quan trong file cập nhật của phiên bản đó ở trạng thái Xong hoặc Hoãn có lý do.
2. Sửa số phiên bản của ba ứng dụng: `package.json` và `package-lock.json` của `RealEstateBackendApp`, `RealEstateAdminApp`, `RealEstateApp`; thêm `app.json` (`expo.version`) của `RealEstateApp`. Không đụng `stnd-crm-unified`.
3. Cập nhật mục 2 (bảng phiên bản hệ thống) và mục 3 (bảng thành phần) của file này.
4. Với mỗi tài liệu có nội dung đổi: sửa dòng `> **Phiên bản tài liệu:**` ngay dưới tiêu đề và hàng tương ứng ở mục 4.
5. Cập nhật tiêu đề, trạng thái ở `06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md` nếu phiên bản có đổi tính năng CRM; cập nhật `docs/README.md` (dòng "Phiên bản hiện tại").
6. Chạy test và build của ba ứng dụng, đối chiếu với Definition of Done của phiên bản.
7. **Migration dữ liệu (PT-027):** phiên bản có đổi schema/dữ liệu thì thêm migration vào registry `RealEstateBackendApp/src/migrations/` (id `NNN_ten`, chạy lại được an toàn, tương thích ngược) kèm test tích hợp, và ghi vào file kế hoạch của phiên bản. Trước khi deploy, kiểm `status`/dry-run bằng runner trong image mới (`docker compose --env-file .env.docker run --rm --no-deps backend node dist/migrations/cli.js status`, chỉ đọc) và đọc danh sách migration chờ. **Lần đầu** chạy runner trên production cần `baseline` đúng một lần (xem `06_Production_Deploy.md` mục 11.1). Số phiên bản trong `package.json` của backend (bước 2) chính là số runner ghi vào collection `system`, nên bước 2 phải xong **trước** khi build image.
8. Đặt thẻ git `vX.Y.Z` lên đúng commit sẽ chạy production (đề xuất, push thẻ khi Oniichan đồng ý).
9. Triển khai theo [`../01_Infrastructure/06_Production_Deploy.md`](../01_Infrastructure/06_Production_Deploy.md) (mục 11 cho `deploy.sh`):
   1. Backup tự động trước deploy; chép bản backup ra **ngoài** máy chủ.
   2. Có migration chờ: `bash deploy.sh` **dừng trước `up`** (stack không đổi) và in lệnh; chọn `bash deploy.sh --no-pull --migrate` (tự `up --apply` sau backup) hoặc chạy tay runner rồi `bash deploy.sh --no-pull` (mục 11.1). Migration 005/006 của đợt v1.0.2 vẫn chạy qua `scripts/run-migration.sh` (mục 5.4a).
   3. Sau deploy: `status` của runner thoát mã `0`, `version` trong collection `system` khớp số phiên bản vừa phát hành; `docker compose ps` backend `healthy`; `/api/v1/health/readiness` trả `200`.
   4. Việc sau deploy phụ thuộc VPS (xác minh `NODE_ENV`/Swagger đã tắt, ghim digest image, kiểm cổng 27017) theo `06_Production_Deploy.md` mục 2, 12, 13.

[← Về chỉ mục tài liệu](../README.md)
