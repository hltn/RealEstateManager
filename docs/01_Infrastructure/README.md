# 01 — Hạ tầng dùng chung

> **Phiên bản tài liệu:** v1.0.6

Kiến trúc backend, cơ sở dữ liệu và hệ thống ghi log, dùng chung cho mọi module.

| # | Tài liệu | Loại | Nội dung |
|---|---|---|---|
| 01 | [`01_Backend_Plan.md`](01_Backend_Plan.md) | Plan | Kế hoạch backend NestJS + Fastify + MongoDB: tech stack, cấu trúc thư mục, lộ trình |
| 02 | [`02_Database_Plan.md`](02_Database_Plan.md) | Plan | Thiết kế CSDL quan hệ (bản ban đầu) cho quản lý nguồn hàng BĐS |
| 03 | [`03_Database_Mongo_Plan.md`](03_Database_Mongo_Plan.md) | Plan | Thiết kế dữ liệu MongoDB dạng document, tối ưu bằng embedding |
| 04 | [`04_Request_Logging_Plan.md`](04_Request_Logging_Plan.md) | Plan | Kế hoạch ghi log tập trung các outgoing request (crawl, AI) |
| 05 | [`05_External_Log_Module_Design.md`](05_External_Log_Module_Design.md) | Design | Thiết kế chi tiết ExternalLogModule: kiến trúc, schema, che dữ liệu nhạy cảm |
| 06 | [`06_Production_Deploy.md`](06_Production_Deploy.md) | Vận hành | Stack production (Mongo replica set + auth, Redis, MinIO, Cloudflare Tunnel): biến môi trường, triển khai, nâng cấp từ Mongo standalone, backup/restore |
| 07 | `07_Thong_Nhat_Moi_Truong_Plan.md` (nội bộ, không đưa lên repo) | Plan | Plan v1.0.6: build một lần chạy mọi nơi (chuyển image bằng `docker save | ssh`, dev chạy cùng image), gom script vận hành vào gốc và `ops/`, dọn file thừa, tái tổ chức cấu trúc Backend/Frontend, CI/CD, 2 tính năng PWA (nút cài app ở login, hỏi bật thông báo một lần) (`Approved`) |
| 08 | `08_So_Do_CICD.md` (nội bộ, không đưa lên repo) | Sơ đồ | Sơ đồ CI/CD v1.0.6: 3 môi trường, pipeline build một lần, kiến trúc một máy, đường mạng, các bước deploy, URL từng môi trường (`Draft`) |
| 09 | [`09_So_Do_Cau_Truc_Thu_Muc.md`](09_So_Do_Cau_Truc_Thu_Muc.md) | Sơ đồ | Sơ đồ cấu trúc thư mục gốc repo, Backend, Frontend: cách quy hoạch, từng thư mục lưu file gì, hiện trạng và đích v1.0.6, quy tắc thêm file mới |
| 10 | `10_Thong_Nhat_Moi_Truong_Architecture.md` (nội bộ, không đưa lên repo) | Architecture | Kiến trúc v1.0.6 (`Approved`): image và tag, `release.sh`, `deploy.sh` mới, compose gốc + override dev, `.env` duy nhất, FE runtime config, Mảng E (nút cài app, hỏi bật thông báo), thứ tự đợt, nghiệm thu |
| 11 | `11_Thong_Nhat_Moi_Truong_Tasks.md` (nội bộ, không đưa lên repo) | Tasks | Danh sách 46 task `T-01` đến `T-46` của v1.0.6, chia 6 đợt, `Approved` |

> `02_Database_Plan.md` và `03_Database_Mongo_Plan.md` nằm trong nhóm 4 file phải đồng bộ trường dữ liệu (cùng Project Plan và UI Design Plan).

[← Về chỉ mục tài liệu](../README.md)
