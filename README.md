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
- `release.sh`: dựng image một lần (`build`) và gửi gói lên máy chủ (`send`).
- `deploy.sh`, `backup.sh`, `restore.sh`: cập nhật, sao lưu và khôi phục stack trên máy chủ (không build, không dùng git).
- `docker-compose.yml`: stack production/staging dùng image dựng sẵn; `docker-compose.dev.yml` và `docker-compose.dev-watch.yml`: lớp phủ cho máy dev.
- `.env.example`: mẫu duy nhất của file `.env` (mọi môi trường).
- `.github/workflows/`: (sẽ có ở v1.0.6, quy trình CI/CD GitHub Actions; xem `docs/01_Infrastructure/06_Production_Deploy.md` mục 17).
- `stnd-crm-unified/`: prototype giao diện, giữ nguyên (xem mục 6).
- `RealEstateApp/`: ứng dụng di động, **không thuộc luồng build/deploy này**.

Sơ đồ đầy đủ và quy tắc đặt file mới: `docs/01_Infrastructure/09_So_Do_Cau_Truc_Thu_Muc.md`.

## 3. Chạy môi trường dev

Dev dùng đúng stack của production (cùng image, cùng Mongo replica set, Redis, MinIO), chạy bằng Docker Compose:

1. Lần đầu: từ gốc repo chạy `cp .env.example .env` rồi điền giá trị thật (chú thích từng khóa, kể cả cách sinh `CRM_PII_ENCRYPTION_KEY`, nằm trong `.env.example`). Kiểm tra bằng `bash ops/verify-env.sh .env`.
2. Dựng image: `./release.sh build --local` (compose gốc không build; `--local` tạo thẻ `<version>-local` và không gửi được lên máy chủ).
3. Chạy stack: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` (dev mở thêm cổng loopback cho Mongo, Redis, MinIO console; đổi cổng bằng `DEV_MONGO_PORT`, `DEV_REDIS_PORT`, `DEV_MINIO_CONSOLE_PORT` trong `.env`).
4. Sửa backend có tự biên dịch lại: thêm `docker-compose.dev-watch.yml` (`docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.dev-watch.yml up -d --build backend`), rồi chạy web admin trên host: `cd RealEstateAdminApp`, `npm install`, `npx vite` (KHÔNG dùng `npm run dev`: script đó chạy thêm một backend trên host tranh cổng 3000 với container và không có Mongo/Redis; Vite proxy `/api` sang `localhost:3000` nên trúng container). Chi tiết và lưu ý cổng nằm ở đầu từng file `docker-compose.dev*.yml`.
5. Kiểm thử: `npm test` trong từng app.

Biến môi trường của mọi luồng (npm, Docker, production, staging) nằm trong MỘT file `.env` ở gốc repo, lập từ mẫu duy nhất `.env.example` (cùng danh sách khóa ở mọi môi trường, chỉ khác giá trị; `.env` không commit). Backend đọc `.env` trong thư mục chạy trước rồi đến `../.env`, nên một file `.env` cũ còn sót trong `RealEstateBackendApp/` sẽ thắng `.env` gốc: hãy xóa nó khi đã chuyển giá trị sang `.env` gốc. Cấu hình web admin (`API_URL`, cờ `CRM_*`) cũng đọc từ `.env` này lúc chạy (qua `/env.js`), không nhúng lúc build.

## 4. Build và deploy

Nguyên tắc: **build một lần, chạy mọi nơi**. Máy chủ không build và không dùng git; chỉ nạp image đã dựng.

- Dựng bản phát hành (cần cây git sạch và nhánh đã push): `./release.sh build`. Gửi lên máy chủ và deploy: `./release.sh send --to <tên-host-trong-~/.ssh/config>` (thêm `--dry-run` để xem kế hoạch, `--init` cho lần cài đầu). Địa chỉ máy chủ không ghi trong repo.
- Cập nhật stack trên máy chủ (do `send` gọi; chạy tay khi cần): `bash deploy.sh` (xem `bash deploy.sh --help`).
- Sao lưu: `bash backup.sh`; khôi phục: `bash restore.sh` (mặc định chỉ dry-run, xem `bash restore.sh --help`).
- Quy trình đầy đủ, cảnh báo dữ liệu và cách khôi phục: `docs/01_Infrastructure/06_Production_Deploy.md`.
- Sơ đồ CI/CD và luồng đi của các thành phần: `docs/01_Infrastructure/08_So_Do_CICD.md`.
- CI/CD GitHub Actions (kiểm thử khi có PR, deploy staging tự động, production cần người duyệt): đang triển khai, mô tả ở mục 17 của tài liệu 06.

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
