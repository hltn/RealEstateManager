# 06 — Module Quản lý khách hàng

> **Phiên bản tài liệu:** v1.0.5

Module mới thay cho Google Sheets (DSKH, DSKH_DROP, DSKH_NET): quản lý và chăm sóc khách, nhiều người cùng chăm sóc, chân dung khách hàng, nhắc lịch, ứng dụng di động có thông báo đẩy.

| # | Tài liệu | Loại | Nội dung |
|---|---|---|---|
| 01 | [`01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md`](01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md) | Plan | Mục đích, tính năng, quy tắc nghiệp vụ, câu hỏi cần xác nhận |
| 02 | [`02_Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md`](02_Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md) | UI Design | Thiết kế giao diện tích hợp vào web admin hiện có |
| 03 | [`03_Design_System_Quy_Tac_Phong_Cach.md`](03_Design_System_Quy_Tac_Phong_Cach.md) | Design System | Quy tắc phong cách web admin rút trực tiếp từ code `RealEstateAdminApp` (Tailwind v4, Outfit, dark mặc định, mẫu lớp + component có sẵn, phần còn thiếu so với Stitch) |
| 04 | [`04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) | Technical Design | Kiến trúc (NestJS + MongoDB Replica Set + BullMQ/Redis + FCM), cấu trúc module, data model + index, ma trận phân quyền và row-level scope, luồng xử lý (sequence), yêu cầu phi chức năng (hiệu năng, GMT+7, bảo vệ dữ liệu cá nhân), phác thảo Zalo/ghi âm, giả định đã xác nhận, nhật ký quyết định 2026-10-22, chia giai đoạn và milestone |
| 05 | [`05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`](05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md) | API Contract | Quy ước chung (response, lỗi, phân trang, sort, filter, header) và danh sách 115 endpoint `/api/v1` theo 15 nhóm (v1.0.5: xóa 6, thêm 2), map ID yêu cầu, mã lỗi nghiệp vụ |
| 06 | [`06_Theo_Doi_Milestone_Module_Quan_Ly_Khach_Hang.md`](06_Theo_Doi_Milestone_Module_Quan_Ly_Khach_Hang.md) | Tracking | Theo dõi trạng thái milestone M0–M12 (giai đoạn 1/2), theo dõi v1.0.5 theo đợt T-01 đến T-38, tiến độ frontend, việc cần chuẩn bị, quyết định còn mở |
| 09 | [`09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](09_Bo_Sung_Sua_Doi_Tinh_Nang.md) | Change Log | Bổ sung/sửa đổi tính năng theo phiên bản (chỉ thêm mới ở cuối). v1.0.2 (2026-10-29): nhiều role + nhiều nhóm, khu vực 34 tỉnh thành, thành viên nhóm, xóa/khôi phục/xóa vĩnh viễn khách "Bỏ"; kế hoạch triển khai 2 đợt. v1.0.5 (2026-11-10): định danh khách (SĐT tùy chọn, mã khách `KH-000123`, người tạo = phụ trách chính bất biến, bỏ xin tham gia, chia sẻ bằng mời), bảng quy tắc bị thay, endpoint xóa/thêm, ghi chú deploy (PWA tải lại, không lùi image sau migration 011) |
| 10 | [`10_Dinh_Danh_Khach_Hang_Plan.md`](10_Dinh_Danh_Khach_Hang_Plan.md) | Plan | Kế hoạch v1.0.5 (`Approved`): bỏ ràng buộc SĐT, mã khách tự sinh, người tạo = người chăm sóc chính không đổi, bỏ xin tham gia nhóm, chia sẻ bằng mời |
| 11 | [`11_Dinh_Danh_Khach_Hang_Architecture.md`](11_Dinh_Danh_Khach_Hang_Architecture.md) | Architecture | Kiến trúc v1.0.5 (`Approved`): migration 010 (pre-up) và 011 (post-up, một chiều), cấp mã bằng counter, điểm gọi hậu-migrate `scripts/post-migrate/`, API và giao diện hiển thị mã, diễn tập staging |
| 12 | [`12_Dinh_Danh_Khach_Hang_Tasks.md`](12_Dinh_Danh_Khach_Hang_Tasks.md) | Tasks | Danh sách 38 task v1.0.5 (`Approved`, T-01 đến T-38, 5 đợt), ma trận phủ FR-01 đến FR-23 (FR-05 bỏ) |

> `03_Design_System_Quy_Tac_Phong_Cach.md` mô tả phong cách của **toàn bộ web admin**, không riêng module này. Nếu sau này có module khác dùng, có thể chuyển lên `00_Project_Overview/`.

> **Phiên bản:** đợt sửa đổi v1.0.2 (mục 09) đã lên production ngày 2026-11-02. Mục lục phiên bản của cả hệ thống và danh sách việc cần sửa sau test production (v1.0.3, kế hoạch). Đợt v1.0.5 "Định danh khách hàng" (tài liệu 09 mục v1.0.5 và 10–12) đang triển khai, deploy gộp cùng v1.0.3 → v1.0.4 nằm ở [`../08_Quan_Ly_Phien_Ban/`](../08_Quan_Ly_Phien_Ban/README.md).

[← Về chỉ mục tài liệu](../README.md)
