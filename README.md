# Real Estate Manager

Hệ thống quản lý bất động sản của STND: backend API, web admin (PWA), ứng dụng di động và prototype giao diện. README này chỉ nêu điểm vào; chi tiết nằm ở `docs/`.

## 1. Dự án gồm những gì

| Thành phần | Thư mục | Công nghệ chính |
|---|---|---|
| Backend API | `RealEstateBackendApp/` | NestJS, MongoDB (replica set), Redis, MinIO (S3) |
| Web admin (PWA) | `RealEstateAdminApp/` | React 19, Vite, Tailwind CSS v4 |
| Ứng dụng di động | `RealEstateApp/` | React Native (Expo), tách riêng |
| Prototype giao diện | `stnd-crm-unified/` | Bản dựng thử giao diện CRM, chạy trên dữ liệu mock |

Các tính năng chính: thu thập và phân tích tin tức thị trường, bài chuyên gia, quản lý và chăm sóc khách hàng (CRM). Tổng quan: `docs/00_Project_Overview/README.md`.

## 2. Cấu trúc thư mục cấp 1

- `RealEstateBackendApp/`, `RealEstateAdminApp/`: mã nguồn backend và web admin.
- `docs/`: toàn bộ tài liệu (xem mục 5).
- `ops/`: công cụ vận hành phụ trợ và test shell (`ops/tests/`).
- `scripts/`: chạy migration dữ liệu (`scripts/run-migration.sh`, `scripts/post-migrate/`).
- `deploy.sh`, `backup.sh`, `restore.sh`: cập nhật, sao lưu và khôi phục stack production.
- `docker-compose.yml`, `docker-compose.staging.yml`: định nghĩa stack production và staging.
- `stnd-crm-unified/`: prototype giao diện, giữ nguyên (xem mục 6).
- `RealEstateApp/`: ứng dụng di động, **không thuộc luồng build/deploy này**.

Sơ đồ đầy đủ và quy tắc đặt file mới: `docs/01_Infrastructure/09_So_Do_Cau_Truc_Thu_Muc.md`.

## 3. Chạy môi trường dev

Hiện tại chạy từng phần bằng npm:

1. Chuẩn bị backend (lần đầu): chạy `npm install` trong `RealEstateBackendApp/`; từ gốc repo chạy `cp .env.example .env` rồi điền giá trị thật (chú thích từng khóa, kể cả cách sinh `CRM_PII_ENCRYPTION_KEY`, nằm trong `.env.example`; chạy backend trên host thì đổi `MONGODB_URI`/`REDIS_URL` trỏ về `localhost` theo chú thích; chi tiết ở `RealEstateBackendApp/README.md`).
2. Dựng hạ tầng dev (MongoDB replica set, Redis, MinIO): `docker compose -f RealEstateBackendApp/docker-compose.dev.yml up -d`.
3. Cài thư viện web admin và chạy: `cd RealEstateAdminApp`, `npm install`, `npm run dev` (chạy cùng lúc Vite và `start:dev` của backend).
4. Kiểm thử: `npm test` trong từng app.

Biến môi trường của mọi luồng (npm, Docker, production, staging) nằm trong MỘT file `.env` ở gốc repo, lập từ mẫu duy nhất `.env.example` (cùng danh sách khóa ở mọi môi trường, chỉ khác giá trị; `.env` không commit). Backend đọc `.env` trong thư mục chạy trước rồi đến `../.env`, nên một file `.env` cũ còn sót trong `RealEstateBackendApp/` sẽ thắng `.env` gốc: hãy xóa nó khi đã chuyển giá trị sang `.env` gốc.

Dựng và chạy dev thống nhất bằng `docker compose` (`release.sh build`, file `.env.example`, `docker-compose.dev.yml`, tùy chọn `docker-compose.dev-watch.yml`): (sẽ có ở v1.0.6, xem tài liệu `docs/01_Infrastructure/10_Thong_Nhat_Moi_Truong_Architecture.md`).

## 4. Build và deploy

- Cập nhật stack production đang chạy: `bash deploy.sh` (xem `bash deploy.sh --help`).
- Sao lưu: `bash backup.sh`; khôi phục: `bash restore.sh` (mặc định chỉ dry-run, xem `bash restore.sh --help`).
- Quy trình đầy đủ, cảnh báo dữ liệu và cách khôi phục: `docs/01_Infrastructure/06_Production_Deploy.md`.
- Sơ đồ CI/CD và luồng đi của các thành phần: `docs/01_Infrastructure/08_So_Do_CICD.md`.
- Đóng gói `release.sh build`/`release.sh send` và CI/CD GitHub Actions: (sẽ có ở v1.0.6, xem tài liệu `docs/01_Infrastructure/08_So_Do_CICD.md`).

## 5. Mục lục tài liệu

Chỉ mục tổng: `docs/README.md`. Mỗi thư mục con có README riêng:

- `docs/00_Project_Overview/README.md`: kế hoạch và thiết kế kỹ thuật tổng thể.
- `docs/01_Infrastructure/README.md`: hạ tầng dùng chung, triển khai, vận hành.
- `docs/02_Module_Auth/README.md` đến `docs/06_Module_Customer_Management/README.md`: tài liệu từng module nghiệp vụ.
- `docs/07_Frontend_Mobile/README.md`: ứng dụng di động và thiết kế UI.
- `docs/08_Quan_Ly_Phien_Ban/README.md`: mục lục phiên bản và quy trình phát hành.

Lịch sử thay đổi: `CHANGELOG.md`.

## 6. Quy ước đồng bộ giao diện sang prototype

`stnd-crm-unified/` là prototype giao diện, giữ nguyên làm nơi thiết kế; không thuộc build, deploy hay CI.

- Mọi thay đổi giao diện của `RealEstateAdminApp/` phải đồng bộ sang `stnd-crm-unified/` để hai bản thống nhất.
- Ngoại lệ: phần PWA, thông báo đẩy (push) và chế độ standalone (như hộp thoại bật thông báo FR-28) không đồng bộ vì prototype không có. Phần cài app như FR-27 vẫn đồng bộ.
- `qa-agent` kiểm mục này mỗi lượt có đổi giao diện.
- Chi tiết và cách làm: `docs/06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md` (mục 11).
