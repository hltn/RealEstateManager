# Tài liệu dự án Real Estate Manager

> **Phiên bản tài liệu:** v1.0.3

Đây là chỉ mục tổng của toàn bộ tài liệu dự án. Tài liệu được tổ chức theo **Tổng thể → Hạ tầng → Từng module → Frontend**, mỗi thư mục và mỗi file đều đánh số để đọc theo thứ tự.

**Phiên bản hiện tại: v1.0.2** (đang chạy production từ 2026-11-02). Mục lục phiên bản của hệ thống, của từng thành phần ứng dụng và của từng tài liệu: [`08_Quan_Ly_Phien_Ban/README.md`](08_Quan_Ly_Phien_Ban/README.md).

## Dự án gồm những gì

| Thành phần | Thư mục code | Công nghệ chính |
|---|---|---|
| Backend API | `RealEstateBackendApp/` | NestJS + Fastify, MongoDB (Mongoose), TypeScript |
| Web admin | `RealEstateAdminApp/` | React 19, Vite, Tailwind CSS v4 (TailAdmin) |
| Ứng dụng di động | `RealEstateApp/` | React Native (Expo) + NativeWind |

## Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| 📘 [`00_Project_Overview/`](00_Project_Overview/README.md) | Kế hoạch và thiết kế kỹ thuật tổng thể |
| 🏗️ [`01_Infrastructure/`](01_Infrastructure/README.md) | Hạ tầng dùng chung: backend, database, logging |
| 🔐 [`02_Module_Auth/`](02_Module_Auth/README.md) | Xác thực, phân quyền (JWT) |
| 📰 [`03_Module_News/`](03_Module_News/README.md) | Thu thập tin tức (NewsFireCrawlManager), chống trùng nội dung |
| ✍️ [`04_Module_Knowledge_Articles/`](04_Module_Knowledge_Articles/README.md) | Tự viết và đăng bài chuyên gia lên WordPress |
| 📊 [`05_Module_Market_Analysis/`](05_Module_Market_Analysis/README.md) | Phân tích thị trường, xuất báo cáo lên Google Drive |
| 👥 [`06_Module_Customer_Management/`](06_Module_Customer_Management/README.md) | Quản lý và chăm sóc khách hàng (module mới) |
| 📱 [`07_Frontend_Mobile/`](07_Frontend_Mobile/README.md) | Ứng dụng di động React Native và thiết kế UI |
| 🏷️ [`08_Quan_Ly_Phien_Ban/`](08_Quan_Ly_Phien_Ban/README.md) | Mục lục phiên bản (hệ thống, ứng dụng, tài liệu), quy trình phát hành, việc cần sửa sau test production |
| 🗄️ [`archive/`](archive/README.md) | Tài liệu lịch sử: intent, spec/plan theo ngày, mockup |
| 🧩 [`_templates/`](_templates/) | Mẫu cho tài liệu mới |

## Nên đọc theo thứ tự nào

**Người mới vào dự án:**

1. `00_Project_Overview/02_Technical_Design.md` — bức tranh kỹ thuật hiện tại (đã audit với code thật).
2. `01_Infrastructure/01_Backend_Plan.md` → `03_Database_Mongo_Plan.md` — kiến trúc backend và dữ liệu.
3. README của module mình sắp làm, rồi đọc các file trong module theo số thứ tự.

**Làm việc trong một module:** đọc theo vòng đời tài liệu trong thư mục module:

```
Plan (PM) → Research → Architecture / Design / Data Model → QA Report
```

Sơ đồ trên là thứ tự đọc tài liệu của module. Vòng đời `Plan → Architecture → Tasks` (mục Quy ước) dành cho tính năng mới làm theo `/spec-*`.

## Quy ước

- **Vòng đời tài liệu một tính năng:** `Plan → Architecture → Tasks` (file `NN_<Ten>_Plan.md`, `NN_<Ten>_Architecture.md`, `NN_<Ten>_Tasks.md` trong thư mục module; `NN` = số lớn nhất đang có trong thư mục cộng 1, không lấp chỗ trống, giữ thứ tự Plan < Architecture < Tasks). Mỗi bước chỉ bắt đầu khi file bước trước có `Trạng thái: Approved`. Yêu cầu có mã `FR-xx` (Plan), task có mã `T-xx` và trỏ về `FR-xx` (Tasks); mẫu ở `_templates/`.
- **Bộ lệnh `/spec-*`** (là skill cục bộ của Neptune ở `.claude/skills/spec-*/`, thiết kế ở `.claude/spec-workflow-design.md`; các thư mục này không nằm trong repo, đã bị git ignore): `/spec-specify` (lập Plan), `/spec-clarify` (hỏi-đáp làm rõ Plan), `/spec-plan` (thiết kế Architecture), `/spec-tasks` (phân rã Tasks), `/spec-analyze` (qa-agent rà nhất quán, chỉ đọc), `/spec-implement` (coder làm theo Tasks, qa-agent review).
- **Tên thư mục:** `NN_Ten_Nhom/` — `NN` là số thứ tự 2 chữ số. Module nghiệp vụ bắt đầu bằng `Module_`.
- **Tên file:** `NN_Ten_Tai_Lieu.md` — số thứ tự theo vòng đời (Plan trước, Design sau, QA cuối).
- **Thêm module mới:** tạo `09_Module_Ten/` (số 08 đã dành cho `08_Quan_Ly_Phien_Ban/`), kèm `README.md`, dùng mẫu trong `_templates/`.
- **Phiên bản tài liệu:** mọi tài liệu có dòng `> **Phiên bản tài liệu:** vX.Y.Z` ngay dưới tiêu đề. Đổi nội dung tài liệu thì cập nhật dòng này **và** bảng phiên bản tài liệu ở [`08_Quan_Ly_Phien_Ban/README.md`](08_Quan_Ly_Phien_Ban/README.md). Ngoại lệ: tick `[x]` và điền "Test tham chiếu" của ma trận phủ FR trong file Tasks (`/spec-implement`) không đổi phiên bản và không cập nhật bảng phiên bản.
- **Tham chiếu chéo:** ghi đường dẫn tính từ `docs/` (ví dụ `03_Module_News/02_News_Module_Data_Model.md`); với link markdown thì dùng đường dẫn tương đối.
- **Tài liệu hết hiệu lực:** chuyển vào `archive/`, không xóa.
- **Quy tắc đồng bộ dữ liệu:** khi sửa trường dữ liệu ở một trong các file Project Plan, Database Plan, Database Mongo Plan, UI Design Plan thì cập nhật các file còn lại (xem đầu mỗi file).

## Bảng tra tên cũ → vị trí mới

| Tên cũ | Vị trí mới |
|---|---|
| `PROJECT_PLAN.md` | `00_Project_Overview/01_Project_Plan.md` |
| `TECHNICAL_DESIGN.md` | `00_Project_Overview/02_Technical_Design.md` |
| `BACKEND_PLAN.md` | `01_Infrastructure/01_Backend_Plan.md` |
| `DATABASE_PLAN.md` | `01_Infrastructure/02_Database_Plan.md` |
| `DATABASE_MONGO_PLAN.md` | `01_Infrastructure/03_Database_Mongo_Plan.md` |
| `REQUEST_LOGGING_PLAN.md` | `01_Infrastructure/04_Request_Logging_Plan.md` |
| `EXTERNAL_LOG_MODULE_DESIGN.md` | `01_Infrastructure/05_External_Log_Module_Design.md` |
| `AUTH_MODULE_PLAN.md` | `02_Module_Auth/01_Auth_Module_Plan.md` |
| `AUTH_MODULE_ARCHITECTURE.md` | `02_Module_Auth/02_Auth_Module_Architecture.md` |
| `NEWS_MODULE_PLAN.md` | `03_Module_News/01_News_Module_Plan.md` |
| `NEWS_MODULE_DATA_MODEL.md` | `03_Module_News/02_News_Module_Data_Model.md` |
| `CONTENT_DEDUP_DESIGN.md` | `03_Module_News/03_Content_Dedup_Design.md` |
| `CONTENT_DEDUP_QA_REPORT.md` | `03_Module_News/04_Content_Dedup_QA_Report.md` |
| `KNOWLEDGE_ARTICLES_PLAN.md` | `04_Module_Knowledge_Articles/01_Knowledge_Articles_Plan.md` |
| `KNOWLEDGE_ARTICLES_DESIGN.md` | `04_Module_Knowledge_Articles/02_Knowledge_Articles_Design.md` |
| `EXPORT_MARKET_ANALYSIS_GOOGLE_DRIVE.md` | `05_Module_Market_Analysis/01_Export_Market_Analysis_Google_Drive.md` |
| `EXPORT_GDRIVE_RESEARCH.md` | `05_Module_Market_Analysis/02_Export_GDrive_Research.md` |
| `EXPORT_GDRIVE_ARCHITECTURE.md` | `05_Module_Market_Analysis/03_Export_GDrive_Architecture.md` |
| `Project_Plan_WebApp_Quan_Ly_Khach_Hang.md` | `06_Module_Customer_Management/01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md` |
| `Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md` | `06_Module_Customer_Management/02_Thiet_Ke_Giao_Dien__module_Quan_Ly_Khach_Hang.md` |
| `Design_System_Quy_Tac_Phong_Cach.md` | `06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md` |
| `REACT_NATIVE_PLAN.md` | `07_Frontend_Mobile/01_React_Native_Plan.md` |
| `UI_DESIGN_PLAN.md` | `07_Frontend_Mobile/02_UI_Design_Plan.md` |
| `CLAUDE_PROMPT_CACHING.md` | `archive/CLAUDE_PROMPT_CACHING.md` |
| `superpowers/`, `intent/`, `mockups/` | `archive/superpowers/`, `archive/intent/`, `archive/mockups/` |
