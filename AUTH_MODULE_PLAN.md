# AUTH_MODULE_PLAN.md

  

## Trạng thái tài liệu

  

Tài liệu này được lập bởi `pm-agent` trong một phiên chạy nền (background), **không có xác nhận

trực tiếp từ người dùng**. Do không có ai trả lời các câu hỏi làm rõ trong phiên này, toàn bộ giả

định về mục tiêu, đối tượng dùng và ràng buộc được tự đặt ra dựa trên suy luận hợp lý nhất, và được

liệt kê đầy đủ ở mục 5 (Rủi ro & Ràng buộc) để người dùng xác nhận hoặc điều chỉnh trước khi

`architect-agent` bắt đầu thiết kế.

  

Plan này **không** đọc, search hay grep source code hiện có (theo yêu cầu bắt buộc của người dùng).

Mọi chi tiết kỹ thuật (schema, endpoint cụ thể, cách áp dụng Guard vào code hiện tại) được giao

hoàn toàn cho `architect-agent` quyết định ở bước tiếp theo.

  

---

  

## 1. Mục tiêu & Phạm vi (Scope)

  

### Mục tiêu

  

Thêm cơ chế đăng nhập (authentication) và phân quyền (authorization) đơn giản để bảo vệ các thao

tác quản trị trong hệ thống RealEstateManager — trước hết là module News/Crawler hiện có, và các

module quản trị khác sau này — khỏi truy cập không kiểm soát. Thành công là: mọi thao tác

ghi/sửa/xóa đều yêu cầu đăng nhập, và có ít nhất 2 mức quyền (Admin/Editor) để giới hạn hành động

theo vai trò.

  

### In-scope

  

- Đăng nhập bằng email/password.

- JWT access token + refresh token (cơ chế cụ thể do `architect-agent` thiết kế).

- Tối thiểu 2 role: **Admin** (toàn quyền) và **Editor** (quyền hạn chế hơn).

- Phân quyền ở mức route/endpoint thông qua Guard theo role.

- Bảo vệ toàn bộ endpoint ghi/sửa/xóa của module News/Crawler hiện có.

- Quản lý tài khoản cơ bản: Admin tạo, khóa/mở, gán role cho tài khoản Editor.

- Frontend: trang đăng nhập, tự động gắn/refresh token, ẩn/hiện chức năng UI theo role.

- Cải thiện bảo mật cơ bản ở mức enhancement: rate-limit đăng nhập, refresh token rotation.

  

### Out-of-scope (giai đoạn này)

  

- OAuth/SSO.

- 2FA (xác thực 2 lớp).

- Self-registration công khai (người dùng tự đăng ký tài khoản).

- Phân quyền theo resource/ownership (VD: Editor chỉ sửa được bài viết do chính mình tạo).

- Audit log chi tiết, quản lý session/device đăng nhập.

- Quên mật khẩu qua email — **cần xác nhận nếu đây thực sự không cần cho MVP** (xem mục 5).

- Auth cho người dùng cuối công khai (khách xem BĐS/tin tức) — giả định hệ thống hiện tại chỉ phục

  vụ đội ngũ nội bộ.

  

---

  

## 2. Phân rã tính năng (Feature breakdown)

  

### 2.1 Kiến trúc & thiết kế nền tảng — `architect-agent`

  

|   Mã WI   | Việc cần làm                                      | Vì sao bắt buộc phải làm                                                         | Giải pháp Kỹ thuật & Kiến trúc từ Neptune                                                                                                          |
| :-------: | :------------------------------------------------ | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WI-01** | Thiết kế Data Model cho User/Role & Refresh Token | Nền tảng lưu trữ thông tin định danh và quản lý phiên làm việc (Session/Token).  | Tạo Collection `User` (lưu password hash Argon2/Bcrypt) & `RefreshToken` (lưu hashed token + familyId + expiresAt).                                |
| **WI-02** | Thiết kế API Contract cho luồng Auth              | Tạo "hợp đồng" chung để Backend và Frontend dev song song mà không bị nghẽn.     | Định nghĩa Swagger DTO cho `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`. Trả Access Token dạng Bearer JWT.                           |
| **WI-03** | Thiết kế Custom Guard/Decorator Phân quyền (RBAC) | Rủi ro rò rỉ dữ liệu hoặc đứt gãy tính năng hiện có khi áp dụng Auth vào API cũ. | Dùng `@SetMetadata()` kết hợp Custom `RolesGuard` + `JwtAuthGuard` áp dụng qua Decorator `@Roles('ADMIN')`.                                        |
| **WI-04** | Thiết kế lưu Token ở Frontend & Auto Refresh      | Tránh lỗ hổng XSS (lấy cắp Token) và CSRF, nâng cao trải nghiệm người dùng (UX). | **Access Token** lưu RAM/State; **Refresh Token** lưu `httpOnly Cookie` (SameSite=Strict). Dùng Axios Interceptor để auto refresh.                 |
| **WI-05** | Thiết kế Refresh Token Rotation & Revoke          | Ngăn chặn việc đánh cắp và tái sử dụng Refresh Token bị rò rỉ.                   | **Rotation & Family Tracking:** Khi refresh, thu hồi token cũ + cấp cặp token mới. Nếu phát hiện dùng lại token cũ -> Revoke toàn bộ Token Family! |

  

### 2.2 Backend — `coder-backend-agent` (phụ thuộc output của architect-agent)

  

|   Mã WI   | Việc cần làm                                     | Vì sao bắt buộc phải làm                                                      | Giải pháp Kỹ thuật & Tệp tin thực thi                                                                                                |
| :-------: | :----------------------------------------------- | :---------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **WI-06** | Module Auth: Login, Issue Access + Refresh Token | Lõi năng lượng của toàn bộ hệ thống xác thực.                                 | Tạo `AuthModule`, `AuthService.login()` kiểm tra password, ký JWT Access Token (15p) & tạo Refresh Token (7 ngày).                   |
| **WI-07** | Bật Guard/Decorator bảo vệ API News/Crawler      | Mục tiêu bảo mật cấp thiết: Chặn người dùng chưa cấp quyền can thiệp dữ liệu. | Gắn `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles(UserRoleEnum.ADMIN)` lên các hàm POST/PUT/DELETE trong Controller.             |
| **WI-08** | API Quản lý Tài khoản cho Admin                  | Cho phép Admin tạo tài khoản, đổi Role, khóa/mở (Active/Block) User.          | Tạo `UserController` với các route RESTful: `POST /users`, `PATCH /users/:id/status`, `PATCH /users/:id/role`.                       |
| **WI-09** | Hash Password, Refresh & Logout Endpoint         | Tiêu chuẩn bắt buộc: Không lưu plain text password, hủy token khi đăng xuất.  | Dùng `argon2` hoặc `bcrypt` để hash password. Hàm `logout()` sẽ tìm `tokenHash` trong DB và đổi `isRevoked = true`.                  |
| **WI-10** | Rate-limit cho Endpoint Login (Enhancement)      | Chặn các đòn tấn công dò quét mật khẩu tự động (Brute-force).                 | Tích hợp `@nestjs/throttling`. Cấu hình riêng route `/auth/login`: Tối đa 5 lần thử trong 1 phút (`ttl: 60`, `limit: 5`).            |
| **WI-11** | Refresh Token Rotation & Revoke (Enhancement)    | Ngăn chặn nguy cơ dùng lại Refresh Token bị rò rỉ.                            | Khi gọi `/auth/refresh`, hủy token cũ + cấp token mới cùng `familyId`. Nếu phát hiện dùng lại token đã revoke -> Xóa sạch cả Family! |

  

### 2.3 Frontend — `coder-frontend-agent` (phụ thuộc API contract từ architect-agent)

  

| Mã WI | Việc cần làm | Vì sao bắt buộc phải làm | Giải pháp Kỹ thuật & Tệp tin thực thi |
| :-: | :--- | :--- | :--- |
| **WI-12** | Trang Đăng nhập (LoginPage & Form) | Cửa ngõ truy cập đầu tiên của toàn bộ hệ thống quản trị. | Xây dựng Form kiểm tra dữ liệu bằng `react-hook-form` + `zod`. Bắt lỗi 401 (Sai email/pass) và hiển thị thông báo thân thiện. |
| **WI-13** | Auto Attach Token, Auto Refresh & Auto Logout | Đảm bảo trải nghiệm người dùng liền mạch 24/7 mà không sợ gián đoạn. | Sử dụng **Axios Interceptors**. Tự động đính kèm `Bearer Token`, gọi `/auth/refresh` khi gặp 401 và redirect về `/login` nếu refresh thất bại. |
| **WI-14** | Phân quyền Giao diện (Protected Route & Dynamic Menu) | Tránh lộ tính năng nhạy cảm, ngăn Editor bấm nhầm chức năng của Admin. | Tạo `AuthContext` lưu User Role, viết Component `<ProtectedRoute allowedRoles={['ADMIN']} />` và render Menu điều kiện. |
| **WI-15** | Trang Quản lý Tài khoản Admin (User Management UI) | Giúp Admin dễ dàng vận hành: Tạo mới, Khóa/Mở khóa, Phân quyền Editor. | Xây dựng `UserManagementPage` với Bảng (Table), Nút kích hoạt Trạng thái (Active/Block Toggle) và Modal tạo User mới. |
| **WI-16** | Thông báo lỗi UX 401/403 nâng cao (Enhancement) | Nâng cao trải nghiệm người dùng (UX) chuyên nghiệp khi hết hạn phiên hoặc bị chặn quyền. | Tích hợp thư viện Toast (như `react-hot-toast` / `antd notification`) hiển thị lý do lỗi 401 (Hết phiên) hoặc 403 (Cấm truy cập). |

  

### 2.4 QA — `qa-agent`

  

|   Mã WI   | Việc cần làm                                         | Vì sao bắt buộc phải làm                                                          | Giải pháp Kỹ thuật & Tệp tin thực thi                                                                                                             |
| :-------: | :--------------------------------------------------- | :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **WI-17** | Test luồng Đăng nhập (Thành công / Thất bại)         | Đảm bảo luồng xác thực cốt lõi chạy chuẩn xác trước khi mở rộng.                  | Dùng Jest/Supertest gửi request tới `/auth/login`: Test sai mật khẩu (401), user bị khóa (403), pass đúng (200 + nhận Token).                     |
| **WI-18** | Test Phân quyền (Editor bị chặn 403 ở API Admin)     | Tiêu chí thành công cốt lõi: Ngăn chặn vượt cấp đặc quyền (Privilege Escalation). | Gửi Request với Bearer Token của Editor tới API `/users` hoặc `/articles/:id/publish` -> Kỳ vọng trả về **403 Forbidden**.                        |
| **WI-19** | Test Endpoint News/Crawler khi không có Token        | Xác nhận mục tiêu bảo mật: Tất cả API nhạy cảm đều được bảo vệ.                   | Gửi Request không kèm Header Authorization tới `/articles/crawl` -> Kỳ vọng trả về **401 Unauthorized**.                                          |
| **WI-20** | Test Luồng Refresh Token                             | Đảm bảo trải nghiệm người dùng không bị gián đoạn giữa chừng.                     | Test gọi `/auth/refresh` khi Access Token hết hạn -> Kiểm tra xem có nhận được cặp Token mới hợp lệ không.                                        |
| **WI-21** | Test Quản lý Tài khoản (Admin CRUD, Editor bị cấm)   | Xác nhận ranh giới quyền hạn (RBAC Matrix) đúng 100% như thiết kế.                | Admin gọi API tạo/khóa Editor thành công (200/201). Editor gọi cùng API đó thì bị đẩy ra ngay (403).                                              |
| **WI-22** | Test Bảo mật Nâng cao (Brute-force & Token Rotation) | Xác nhận các lớp phòng thủ chuyên sâu hoạt động hoàn hảo.                         | **Brute-force:** Gọi login quá 5 lần/phút -> dính **429 Too Many Requests**. **Rotation:** Dùng lại Refresh Token cũ -> bị Revoke toàn bộ Family. |

  

---

  

## 3. Milestone & thứ tự ưu tiên

  

### Milestone 0 — Kiến trúc nền tảng (chặn mọi việc khác)

WI-01, WI-02, WI-03, WI-04

Lý do: backend và frontend đều phụ thuộc vào schema và API contract đã chốt. Không code trước khi

milestone này hoàn tất.

  

### Milestone 1 — MVP: Đăng nhập + phân quyền bảo vệ News/Crawler

Backend: WI-06, WI-07, WI-09 · Frontend: WI-12, WI-13 · QA: WI-17, WI-18, WI-19, WI-20

Lý do: đây là phần lấp gap bảo mật cấp thiết nhất — hiện tại endpoint quản trị của News/Crawler

đang mở tự do, không có kiểm soát truy cập.

  

### Milestone 2 — Quản lý tài khoản cơ bản

Backend: WI-08 · Frontend: WI-14, WI-15 · QA: WI-21

Lý do: cần để Admin vận hành thực tế (tạo tài khoản cho Editor), nhưng không chặn mục tiêu bảo mật

chính ở Milestone 1 — có thể làm song song hoặc ngay sau đó.

  

### Milestone 3 — Enhancement (bảo mật & UX nâng cao)

Backend: WI-05, WI-10, WI-11 · Frontend: WI-16 · QA: WI-22

Lý do: củng cố độ bền bảo mật (chống brute-force, token rotation) sau khi luồng cơ bản đã chạy ổn

định trong thực tế.

  

---

  

## 4. Rủi ro & Ràng buộc

  

### Giả định cần người dùng xác nhận (ASSUMED — tự đặt ra do không có xác nhận trực tiếp trong phiên này)

  

1. **Đối tượng dùng**: hệ thống auth chỉ phục vụ đội ngũ NỘI BỘ (Admin, Editor quản trị dữ liệu),

   không phải người dùng cuối công khai (khách xem BĐS/tin tức không cần đăng nhập).

2. **Không self-registration**: chỉ Admin được tạo tài khoản cho người khác, không có form đăng ký

   công khai.

3. **Phân quyền chỉ cần role cố định** (Admin/Editor) ở mức route/endpoint — không cần phân quyền

   theo resource/ownership (VD Editor chỉ sửa bài viết của chính mình) ở giai đoạn này.

4. **Mức độ bảo mật "đủ dùng cho hệ thống quy mô nhỏ"**: cần các thực hành cơ bản (hash password,

   JWT có hạn, refresh token, rate-limit login) nhưng không cần 2FA, audit log chi tiết, hay

   session/device management ở MVP.

5. **Phạm vi Editor**: Editor được thực hiện view/write/delete/publish trên news/raw-articles, bao gồm: `POST /crawl`, `POST /articles/:id/publish`, `DELETE /articles` (bulk), `POST /raw-articles/move-bulk`, `GET /articles`, `GET /raw-articles`. Editor **không được xem, sửa, hay gọi** AI Config (GET/POST /settings/ai-config, GET /settings/openrouter-models), AI Prompt Config (GET /news-manager/prompts, PUT /news-manager/prompts), và Cronjob (GET/POST /news-manager/cron) — toàn bộ 3 chức năng này chỉ dành cho Admin. Quyết định này đã được xác nhận bởi người dùng (2026-07-28).



6. **Không có "quên mật khẩu" qua email ở MVP** — nếu người dùng cần chức năng này ngay, đây là

   gap cần bổ sung vào Milestone 1 hoặc 2, không phải chỉ ở enhancement.

7. **Không đổi hạ tầng/stack**: MongoDB, NestJS, ReactJS giữ nguyên; không giới thiệu OAuth/SSO/2FA

   trong 3 milestone nêu trên.

  

→ Nếu bất kỳ giả định nào ở trên không đúng với ý định thực tế, cần điều chỉnh scope/milestone

tương ứng trước khi `architect-agent` bắt đầu Milestone 0.

  

### Rủi ro kỹ thuật/nghiệp vụ

  

- **Rủi ro phá vỡ tính năng hiện có**: nếu code News/Crawler hiện tại (frontend gọi API, hoặc

  script crawler nội bộ) không được thiết kế để gửi kèm token xác thực, việc áp Guard vào có thể

  làm gãy luồng đang chạy. `architect-agent` cần đánh giá tác động này trước khi triển khai WI-07.

- **Rủi ro bảo mật token ở frontend**: nơi lưu access/refresh token (localStorage vs cookie

  httpOnly) ảnh hưởng trực tiếp đến rủi ro XSS/CSRF. Đây là quyết định kỹ thuật của

  `architect-agent` (WI-04), nhưng PM ghi nhận là điểm cần cân nhắc kỹ, không chọn theo mặc định

  tiện lợi nhất.

- **Rủi ro mở rộng vai trò**: nếu số lượng tài khoản tăng nhanh hoặc nghiệp vụ cần phân quyền chi

  tiết hơn 2 role, model Admin/Editor hiện tại sẽ không đủ — cần đánh giá lại ở Milestone 3 hoặc

  giai đoạn kế tiếp, không cố gắng thiết kế trước cho trường hợp chưa chắc xảy ra.

  

---

  

## 5. Definition of Done

  

### Milestone 0

- [ ] Data model User/Role, API contract auth, cơ chế Guard, và cơ chế lưu token frontend đã được

      `architect-agent` chốt và ghi lại thành design doc/ADR.

- [ ] Không có dòng code implementation nào được viết trước khi milestone này hoàn tất.

  

### Milestone 1 (MVP)

- [ ] Mọi endpoint ghi/sửa/xóa của News/Crawler trả về 401 nếu không có/token không hợp lệ.

- [ ] Editor bị chặn (403) khi gọi endpoint dành riêng cho Admin.

- [ ] Access token hết hạn → frontend tự động refresh mà không cần đăng nhập lại.

- [ ] Toàn bộ test WI-17 đến WI-20 pass.

- [ ] Kiểm tra thủ công xác nhận không còn endpoint quản trị nào truy cập được mà không đăng nhập.

  

### Milestone 2

- [ ] Admin tạo/khóa/mở được tài khoản Editor qua UI.

- [ ] Editor không gọi được API quản lý tài khoản (403 nếu cố gọi trực tiếp qua API).

- [ ] Test WI-21 pass.

  

### Milestone 3 (Enhancement)

- [ ] Endpoint login bị giới hạn tần suất theo thiết kế của `architect-agent`.

- [ ] Refresh token rotation hoạt động, token cũ bị vô hiệu sau khi dùng một lần.

- [ ] Frontend hiển thị thông báo rõ ràng khi gặp lỗi 401/403.

- [ ] Test WI-22 pass.

  

---

  

## 6. Bàn giao tiếp theo

  

`architect-agent` nhận Milestone 0 (WI-01 đến WI-04) làm input đầu tiên. `coder-backend-agent` và

`coder-frontend-agent` chỉ bắt đầu sau khi Milestone 0 hoàn tất và được review, để tránh code lại

do schema/API contract thay đổi giữa đường.