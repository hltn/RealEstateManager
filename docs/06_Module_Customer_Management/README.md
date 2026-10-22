# 06 — Module Quản lý khách hàng

Module mới thay cho Google Sheets (DSKH, DSKH_DROP, DSKH_NET): quản lý và chăm sóc khách, nhiều người cùng chăm sóc, chân dung khách hàng, nhắc lịch, ứng dụng di động có thông báo đẩy.

| # | Tài liệu | Loại | Nội dung |
|---|---|---|---|
| 01 | [`01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md`](01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md) | Plan | Mục đích, tính năng, quy tắc nghiệp vụ, câu hỏi cần xác nhận |
| 02 | [`02_Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md`](02_Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md) | UI Design | Thiết kế giao diện tích hợp vào web admin hiện có |
| 03 | [`03_Design_System_Quy_Tac_Phong_Cach.md`](03_Design_System_Quy_Tac_Phong_Cach.md) | Design System | Quy tắc phong cách web admin rút trực tiếp từ code `RealEstateAdminApp` (Tailwind v4, Outfit, dark mặc định, mẫu lớp + component có sẵn, phần còn thiếu so với Stitch) |
| 04 | [`04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) | Technical Design | Kiến trúc (NestJS + MongoDB Replica Set + BullMQ/Redis + FCM), cấu trúc module, data model + index, ma trận phân quyền và row-level scope, luồng xử lý (sequence), yêu cầu phi chức năng (hiệu năng, GMT+7, bảo vệ dữ liệu cá nhân), phác thảo Zalo/ghi âm, giả định, milestone |
| 05 | [`05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`](05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md) | API Contract | Quy ước chung (response, lỗi, phân trang, sort, filter, header) và danh sách 112 endpoint `/api/v1` theo 15 nhóm, map ID yêu cầu, mã lỗi nghiệp vụ |

> `03_Design_System_Quy_Tac_Phong_Cach.md` mô tả phong cách của **toàn bộ web admin**, không riêng module này. Nếu sau này có module khác dùng, có thể chuyển lên `00_Project_Overview/`.

[← Về chỉ mục tài liệu](../README.md)
