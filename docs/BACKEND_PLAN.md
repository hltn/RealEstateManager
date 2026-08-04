# Kế hoạch Triển khai Backend (NestJS & MongoDB) - Real Estate Manager

Tài liệu này mô tả chi tiết kiến trúc, công nghệ, cấu trúc thư mục và lộ trình các bước để xây dựng hệ thống API Backend (máy chủ) phục vụ cho ứng dụng quản lý bất động sản. Hệ thống được thiết kế dựa trên cấu trúc dữ liệu NoSQL được định nghĩa tại `DATABASE_MONGO_PLAN.md`.

---

## 1. Công nghệ & Kiến trúc (Tech Stack)

*   **Core Framework**: **NestJS** kết hợp với **Fastify** (Sử dụng Fastify làm HTTP engine thay cho Express để đạt hiệu năng tối đa, xử lý request nhanh hơn gấp 2-3 lần).
*   **Ngôn ngữ**: **TypeScript** (NestJS hỗ trợ TypeScript native 100%).
*   **Cơ sở dữ liệu**: **MongoDB** (NoSQL, linh hoạt với dữ liệu BĐS).
*   **ODM**: **Mongoose** (Được tích hợp thông qua `@nestjs/mongoose`).
*   **Xác thực & Phân quyền**: **JWT** kết hợp với **NestJS Guards** và **Decorators** (Quản lý Role/Permission vô cùng chặt chẽ và nhàn hạ, thay thế hoàn toàn việc phải tự viết middleware rối rắm).
*   **Lưu trữ file/ảnh**: **Cloudinary** (Upload ảnh nhanh, tối ưu hóa ảnh tự động) kết hợp với **NestJS Interceptors** (`FileInterceptor` dùng multer ở dưới vỏ bọc).
*   **Validation**: **class-validator** & **class-transformer** (Validation dữ liệu đầu vào ngay tại DTO (Data Transfer Object) bằng các Decorator rất trực quan).

---

## 2. Cấu trúc Thư mục (Directory Structure)

Áp dụng kiến trúc theo chuẩn của NestJS (Module-based Architecture):

```text
RealEstateBackendApp/
├── src/
│   ├── app.module.ts           # Module gốc, gom các module con lại
│   ├── main.ts                 # File khởi chạy ứng dụng NestJS
│   ├── config/                 # Các file cấu hình (Env, Database)
│   ├── common/                 # Dùng chung toàn hệ thống
│   │   ├── decorators/         # Các custom decorator (vd: @CurrentUser(), @Roles())
│   │   ├── filters/            # Global Exception Filters (Xử lý lỗi tập trung)
│   │   ├── guards/             # Guards phân quyền (JwtAuthGuard, RolesGuard)
│   │   └── interceptors/       # Interceptors (vd: Transform response data)
│   └── modules/                # Chứa các nghiệp vụ chính (Mỗi nghiệp vụ là 1 module)
│       ├── auth/               # Module Xác thực
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts
│       │   ├── auth.service.ts
│       │   └── strategies/     # JwtStrategy, LocalStrategy
│       ├── users/              # Module Quản lý nhân viên
│       ├── real-estates/       # Module Bảng hàng BĐS
│       │   ├── dto/            # Data Transfer Objects (Validation body request)
│       │   ├── schemas/        # Định nghĩa Mongoose Schema
│       │   ├── real-estates.controller.ts
│       │   ├── real-estates.service.ts
│       │   └── real-estates.module.ts
│       ├── demands/            # Module Nhu cầu khách hàng
│       └── uploads/            # Module Xử lý upload ảnh (Cloudinary)
├── .env                        # Các biến môi trường
├── tsconfig.json               # Cấu hình TypeScript
└── package.json
```

---

## 3. Ưu điểm của NestJS cho dự án này

1.  **Guards thay vì Middleware**: Thay vì viết chuỗi middleware loằng ngoằng trong Express, với NestJS bạn chỉ cần đặt `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles('admin', 'manager')` ngay trên đầu Controller hoặc Function là đã bảo mật xong API.
2.  **Validation tập trung (DTO)**: Khi client gửi form tạo Bất động sản, dữ liệu được tự động check qua các class DTO (dùng `@IsString()`, `@IsNumber()`) trước khi chạm tới Controller.
3.  **Dependency Injection (DI)**: Dễ dàng tái sử dụng code. Ví dụ: `RealEstatesService` có thể dễ dàng gọi `UploadsService` để xóa ảnh trên Cloudinary khi xóa BĐS.

---

## 4. Các Bước Triển khai Chi tiết

### Giai đoạn 1: Khởi tạo & Thiết lập nền tảng (Foundation)
1.  Cài đặt NestJS CLI: `npm i -g @nestjs/cli` và khởi tạo dự án `nest new RealEstateBackendApp`.
2.  Cài đặt các packages: `@nestjs/mongoose`, `mongoose`, `@nestjs/config` (quản lý biến môi trường).
3.  Cấu hình `AppModule` kết nối với MongoDB.
4.  Thiết lập `GlobalValidationPipe` và `GlobalExceptionFilter` để chuẩn hóa dữ liệu đầu vào và format định dạng báo lỗi (Error Response) đồng nhất cho toàn App.

### Giai đoạn 2: Phát triển Module Xác thực (Auth & Users)
1.  Khởi tạo module `nest g res users` và `nest g res auth`.
2.  Cài đặt Passport, JWT (`@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt`).
3.  Định nghĩa `UserSchema`.
4.  Xây dựng `JwtAuthGuard` để bắt buộc đăng nhập, và `RolesGuard` cùng `@Roles()` decorator để phân quyền Admin/Manager/Agent.

### Giai đoạn 3: Phát triển Nghiệp vụ Lõi (Bảng hàng & Nhu cầu)
1.  Khởi tạo module `nest g res real-estates` và `nest g res demands`.
2.  Thiết lập các Schemas phức tạp dựa trên `DATABASE_MONGO_PLAN.md` (nhúng Address, Specifications...).
3.  Tạo các file DTO (vd: `CreateRealEstateDto`) dùng `class-validator` để kiểm tra độ dài chữ, khoảng giá...
4.  Viết các API CRUD. Sử dụng Query Builder của Mongoose trong Service để hỗ trợ tìm kiếm, lọc (filter) nâng cao (vd: lọc giá, diện tích).

### Giai đoạn 4: Tích hợp Dịch vụ Upload (Cloudinary)
1.  Khởi tạo module `nest g res uploads`.
2.  Sử dụng `FileInterceptor` của NestJS (tích hợp sẵn Multer) ở Controller để nhận file.
3.  Viết Service đẩy buffer của file thẳng lên Cloudinary và trả về Array chứa các URLs.

### Giai đoạn 5: Tối ưu & Triển khai
1.  Cài đặt `@nestjs/swagger` để tự động sinh tài liệu API (Swagger UI). Giúp Frontend/Mobile dễ dàng đọc và tích hợp API.
2.  Thêm Rate Limiting (`@nestjs/throttler`) và Helmet để bảo mật.
3.  Deploy lên môi trường Production (Render/Railway).
