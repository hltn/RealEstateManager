# 01 — Hạ tầng dùng chung

Kiến trúc backend, cơ sở dữ liệu và hệ thống ghi log, dùng chung cho mọi module.

| # | Tài liệu | Loại | Nội dung |
|---|---|---|---|
| 01 | [`01_Backend_Plan.md`](01_Backend_Plan.md) | Plan | Kế hoạch backend NestJS + Fastify + MongoDB: tech stack, cấu trúc thư mục, lộ trình |
| 02 | [`02_Database_Plan.md`](02_Database_Plan.md) | Plan | Thiết kế CSDL quan hệ (bản ban đầu) cho quản lý nguồn hàng BĐS |
| 03 | [`03_Database_Mongo_Plan.md`](03_Database_Mongo_Plan.md) | Plan | Thiết kế dữ liệu MongoDB dạng document, tối ưu bằng embedding |
| 04 | [`04_Request_Logging_Plan.md`](04_Request_Logging_Plan.md) | Plan | Kế hoạch ghi log tập trung các outgoing request (crawl, AI) |
| 05 | [`05_External_Log_Module_Design.md`](05_External_Log_Module_Design.md) | Design | Thiết kế chi tiết ExternalLogModule: kiến trúc, schema, che dữ liệu nhạy cảm |

> `02_Database_Plan.md` và `03_Database_Mongo_Plan.md` nằm trong nhóm 4 file phải đồng bộ trường dữ liệu (cùng Project Plan và UI Design Plan).

[← Về chỉ mục tài liệu](../README.md)
