# Changelog

Bản tóm tắt thay đổi theo phiên bản, theo kiểu [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/). Phiên bản chung cho cả hệ thống (backend, web admin, mobile), đánh số semver `X.Y.Z`.

Nguồn chính và đầy đủ: [`docs/08_Quan_Ly_Phien_Ban/README.md`](docs/08_Quan_Ly_Phien_Ban/README.md). Mã `PT-NNN` là mã mục trong file kế hoạch v1.0.3.

## [1.0.3] - 2026-11-04

Sửa và bổ sung sau khi test web trên production (chủ yếu giao diện mobile), thêm PWA, tự chạy migration khi deploy.

v1.0.3 đã deploy lên production ngày 2026-11-04; thẻ git `v1.0.3` đặt trên `d2e5282`.

### Thêm
- PT-023: đủ 3/4 tiêu chí thì tự chuyển khách sang "Khách net"; hạ dưới 3/4 về "Có quan tâm" (không đè trạng thái "Bỏ"), thông báo người cùng chăm sóc.
- PT-022: nút Sửa nhật ký chăm sóc; bỏ quy tắc tác giả chỉ sửa được trong 24 giờ (bỏ mã lỗi `CARE_LOG_EDIT_WINDOW_EXPIRED`).
- PT-030: web admin thành PWA, cài được lên Màn hình chính iPhone/Android, không offline dữ liệu, có thông báo bản mới.
- PT-031: mã dự án là chữ và số viết liền, tối đa 30 ký tự; FE tự điền mã từ tên (mã cũ giữ nguyên).
- PT-019: "Dự án quan tâm" chuyển sang selectbox có ô tìm kiếm.
- PT-021: "Lịch sử thay đổi" thu gọn, chỉ tải khi bấm xem.
- PT-020, PT-028: form Ghi chú chỉ hiện khi bấm nút Ghi chú; nút này nằm ở thanh đáy trên mobile.
- PT-018: tab Thông tin bỏ SĐT, ẩn các trường chưa có dữ liệu.

### Sửa
- PT-017: mobile bỏ tên khách ở breadcrumb.
- PT-029: mobile bỏ nút "Chỉnh sửa" ở hàng tiêu đề.
- PT-024, PT-025: sidebar mobile phủ kín từ mép trên, tự đóng sau khi chọn mục, nút X sang phải.
- PT-026: form tạo lịch hẹn mobile hết icon đè chữ ở ô Giờ và Dự án.
- PT-008: tắt Swagger trên production (chỉ bật khi `NODE_ENV` thuộc `development`, `test`, `staging`, `local`).

### Hạ tầng
- PT-027: sổ phiên bản trong collection `system`; runner migration; `deploy.sh` tự baseline và tự chạy migration chờ; staging local.
- PT-001, PT-002: healthcheck cho `backend`; healthcheck `mongo` không còn mật khẩu trên dòng lệnh.
- PT-009, PT-016: cơ chế ghim digest image (biến `*_IMAGE`, script `print-image-digests.sh`) và runbook user Mongo/MinIO quyền tối thiểu (biến `MONGO_APP_*`, `S3_APP_*`).
- PT-003, PT-004, PT-007, PT-010, PT-011, PT-013: bật ảnh đính kèm CRM, rà biến `S3_BUCKET_EXPORTS`, bổ sung tài liệu triển khai, dọn dẹp sau nâng cấp, rà token tunnel, sao lưu khóa mã hóa PII ra ngoài máy chủ.
- PT-005: kiểm chứng thao tác AI qua 9Router (Cấu hình AI, tải danh sách model).
- PT-006: nới đĩa VPS để `deploy.sh` và `run-migration.sh` không bị chặn bởi ngưỡng đĩa trống 5 GB.
- Số phiên bản ba ứng dụng nâng lên 1.0.3.

### Đã bỏ
- Oniichan quyết định bỏ ngày 2026-11-02: PT-012, PT-014, PT-015.

Chi tiết: [`docs/08_Quan_Ly_Phien_Ban/01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md`](docs/08_Quan_Ly_Phien_Ban/01_Cap_Nhat_Sua_Doi_Bo_Sung_v1.0.3.md); checklist kiểm máy thật: [`docs/08_Quan_Ly_Phien_Ban/02_Checklist_Kiem_iPhone_v1.0.3.md`](docs/08_Quan_Ly_Phien_Ban/02_Checklist_Kiem_iPhone_v1.0.3.md).

## [1.0.2] - 2026-11-02

Nâng cấp production lên stack mới, kèm đợt sửa đổi CRM A-D. Thẻ git `v1.0.2` đặt trên `d0037f2` (manifest 1.0.2); production thực chạy `e6099c0` lúc 2026-11-02, manifest lúc đó còn số cũ.

### Thêm
- CRM: một người dùng có nhiều role và nhiều nhóm; thành viên nhóm; khu vực 34 tỉnh thành.
- CRM: xóa, khôi phục, xóa vĩnh viễn khách "Bỏ".
- Admin sửa tên/email và đặt lại mật khẩu tài khoản; giao diện mặc định light; ngày có lịch hẹn tô cam trong lịch tháng.

### Sửa
- Hết tràn ngang ở layout, hộp thoại cao không bị cắt đầu, chữ lỗi đạt tương phản AA.
- Migration 005 không lỗi với tài khoản thiếu `roles`/`teamIds`.

### Hạ tầng
- Mongo replica set `rs0` có xác thực, Redis, MinIO, 9Router trong compose; `deploy.sh`; migration runner thủ công (005, 006 đã chạy trên VPS).
- Nginx chỉ tin `CF-Connecting-IP` từ cloudflared; `TRUST_PROXY` cấu hình được; `NODE_ENV=production` cho backend.

Chi tiết: [`docs/06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](docs/06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md), [`docs/01_Infrastructure/06_Production_Deploy.md`](docs/01_Infrastructure/06_Production_Deploy.md).

## [1.0.1] - 2026-08-24

Nền tảng: toàn bộ tài liệu và tính năng có trước đợt sửa đổi CRM A-D (mốc thẻ git `932db04`).

### Thêm
- Auth, News, Knowledge Articles, Market Analysis, CRM giai đoạn 1.
- Hạ tầng backend (health, log request, MongoDB) và ứng dụng mobile.

Chi tiết: [`docs/08_Quan_Ly_Phien_Ban/README.md`](docs/08_Quan_Ly_Phien_Ban/README.md) (mục 2 và 4).
