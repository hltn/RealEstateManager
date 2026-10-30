# Bổ sung & sửa đổi tính năng: Module Quản lý & chăm sóc khách hàng (CRM)

> **Mục đích file:** gom **mọi bổ sung/sửa đổi tính năng phát sinh sau khi các tài liệu 01–06 đã chốt** vào một chỗ, theo từng phiên bản. Mỗi phiên bản là một mục độc lập: có ngày, danh sách thay đổi, trạng thái từng thay đổi, thiết kế, API, dữ liệu, giao diện, kiểm thử, rủi ro. Các tài liệu cũ **không bị viết lại**; chỉ có một dòng trỏ về file này ở nơi liên quan.
> **Tài liệu liên quan:** [`04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) (data model §3.8, phân quyền §4), [`05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`](05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md) (API), [`02_Auth_Module_Architecture.md`](../02_Module_Auth/02_Auth_Module_Architecture.md) (Auth).
> **Chuẩn áp dụng:** skill `nodejs-react-mongo-coding-guidelines` (API `/api/v1`, soft delete, transaction, audit trail, migration idempotent).

---

## Quy ước phiên bản

1. **Số phiên bản dạng ba phần** `vX.Y.Z` (hiện tại `v1.0.3`; sau này `v1.0.4` hoặc cao hơn). Mỗi phiên bản là **một mục độc lập** ở cấp `##`, có ngày, danh sách thay đổi và trạng thái từng thay đổi.
2. **Không sửa phiên bản cũ, chỉ thêm mới ở cuối file.** Riêng cột trạng thái trong bảng tổng quan của chính phiên bản đó và mục lục phiên bản được cập nhật khi tiến độ thay đổi (Kế hoạch → Đang làm → Xong).
3. Nếu một quy tắc bị thay đổi ở phiên bản sau thì ghi rõ **"thay thế quy tắc X của vA.B.C"** ngay đầu thay đổi đó; phiên bản cũ giữ nguyên để còn truy vết.
4. Mỗi thay đổi đều có các tiểu mục: Bối cảnh/vấn đề, Quyết định nghiệp vụ, Thiết kế/quy tắc, API thay đổi, Dữ liệu & migration, Giao diện, Ảnh hưởng tài liệu khác, Kiểm thử/nghiệm thu, Rủi ro/điều chưa kiểm chứng.
5. Trạng thái dùng 3 giá trị: **Kế hoạch** · **Đang làm** · **Xong**.

## Mục lục phiên bản

| Phiên bản | Ngày | Nội dung | Trạng thái |
|---|---|---|---|
| [v1.0.3](#v103-2026-10-29) | 2026-10-29 | 4 sửa đổi: (A) nhiều role + nhiều nhóm cho một tài khoản; (B) khu vực theo 34 tỉnh thành; (C) thêm/gỡ/xem thành viên nhóm; (D) xóa, khôi phục, xóa vĩnh viễn khách "Bỏ" | Đang làm – Đợt 1 (A, B) đã code + QA lần 2 đạt, chờ duyệt và chạy migration; Đợt 2: C (BE + FE) đã code, BE QA đạt, FE đang QA; D: BE đã code + QA đạt 2026-10-30, FE đang QA |

---

## v1.0.3 (2026-10-29)

### 1. Tổng quan

| Mã | Sửa đổi | Đợt | Phạm vi | Trạng thái |
|---|---|---|---|---|
| A | Một tài khoản có **nhiều role** và **nhiều nhóm** (giữ `role`/`teamId` làm trường suy ra) | 1 | BE (giao diện chọn nhiều role/nhóm làm cùng mục C ở Đợt 2) | Đang làm – BE đã code + QA lần 2 đạt; migration 005 chưa chạy trên dev |
| B | Khu vực dùng **34 tỉnh thành** (hiệu lực 01/07/2025); xóa hẳn khu vực cũ | 1 | BE + FE | Đang làm – BE + FE đã code + QA lần 2 đạt; migration 006 chưa chạy trên dev |
| C | Màn quản lý nhóm: **xem danh sách, thêm, gỡ thành viên**; UI nhiều role/nhóm; **nguồn bộ lọc "Người phụ trách"** (mục 6.10) | 2 | BE + FE | Đang làm – BE + FE đã code; BE QA đạt, FE đang QA |
| D | **Xóa** khách "Bỏ" (đơn và hàng loạt), **khôi phục**, **xóa vĩnh viễn** | 2 | BE + FE | Đang làm – BE đã code + QA đạt 2026-10-30, FE đang QA |

**Trạng thái thực tế (cập nhật 2026-10-29):** Đợt 1 (A multi-role/nhóm BE, B 34 tỉnh BE + FE) **đã code và QA lần 2 đạt**; code nằm ở commit nháp `d972538` cùng vài file chưa commit. **Migration 005 và 006 CHƯA chạy trên dev.** Đợt 2: **C** (màn thành viên nhóm + UI nhiều role/nhóm + nguồn riêng cho bộ lọc người phụ trách) **đã code (BE + FE)**; BE QA đạt (116/117, test đếm route Swagger đã sửa 31 → 34), FE đang QA. **D** (xóa/khôi phục/xóa vĩnh viễn) **BE đã code, FE chưa** (hợp đồng API ở mục 7.4); chờ QA BE và coder FE.

**Cổng bắt buộc:** **không chạy migration 005/006 lên DB dev** (và chưa commit chính thức phần còn lại) cho tới khi Oniichan đọc tài liệu này và đồng ý.

### 2. Quyết định của Oniichan (đã chốt)

1. Màn quản lý nhóm chưa có thêm/gỡ thành viên và chưa hiện danh sách thành viên → **bổ sung**.
2. Một tài khoản được có **nhiều role** và **nhiều nhóm**. Nhiều role: quyền lấy theo **role cao nhất trong cùng phân vùng CRM** (`ADMIN` > `MANAGER` > `STAFF`). `STAFF` và `EDITOR` thuộc 2 phân vùng khác nhau nên **ngang quyền**: cả hai cùng có hiệu lực (hợp quyền).
3. Khách chuyển sang trạng thái "Bỏ" (nhóm danh sách `DROPPED`) thì ở select "Hành động hàng loạt" hiện thêm option **"Xóa"**, và hiện thêm một nút **Xóa**. Quyền: **Admin** xóa được tất cả; **Manager** xóa được mọi khách "Bỏ" thuộc **nhóm mình quản lý** (chỉ có mặt trong `careTeam` của khách thì **không đủ**; chốt lại 2026-10-29); **STAFF** chỉ xóa được khách mình là **người phụ trách chính** (không cần là người nhập khách; chốt lại 2026-10-29). Xóa là **xóa mềm**; **Admin khôi phục được** và **xóa vĩnh viễn được**.
4. Dữ liệu khu vực dùng **danh sách 34 tỉnh thành Việt Nam** (hiệu lực 01/07/2025, Nghị quyết 202/2025/QH15). Dữ liệu khu vực cũ **xóa hẳn**: không giữ, không chuyển, không hiển thị nhãn "(khu vực cũ)"; khách/dự án trỏ khu vực cũ thì `areaId = null` (không hiển thị). Đã đồng ý chạy script lên DB dev **sau khi QA đạt**, có `mongodump` trước và `--dry-run`.
5. **(Chốt 2026-10-29) Bộ lọc "Người phụ trách" của Manager dùng nguồn riêng**, tách khỏi `GET /crm/assignable-users` (**lọc ≠ gán**). Nguồn riêng = các người phụ trách/thành viên xuất hiện trong tập khách mà Manager được thấy. Ô **gán** người vẫn dùng `assignable-users` chặt (mục 4.3 điểm 11). Chi tiết thiết kế do coder BE đề xuất; là việc của **Đợt 2** (mục 6.10), ảnh hưởng 3 nơi FE: `CustomerToolbar`, `AdvancedFilterModal`, `DailyTasks.desktop`.
6. **(Chốt 2026-10-29) Import CSV:** tên khu vực không khớp 34 tỉnh (kể cả sau khi áp bí danh) thì **để trống khu vực và VẪN tạo khách** (không báo lỗi dòng; chỉ cảnh báo nhẹ). Hệ quả: khách vào hệ thống **không có khu vực** (`areaId = null`) và cần ai đó bổ sung sau. Khớp với mục 5.6.
7. **(Chốt 2026-10-29) Xóa khách "Bỏ":** STAFF chỉ xóa khách mình là người phụ trách chính; Manager chỉ xóa khách thuộc nhóm mình quản lý; Admin xóa tất cả; xóa mềm, Admin khôi phục và xóa vĩnh viễn (điểm 3 đã cập nhật; đóng 2 điểm mở ở mục 10).

### 3. Hiện trạng (kết quả khảo sát trước khi sửa)

| Chủ đề | Hiện trạng |
|---|---|
| Nhóm | Thành viên chỉ lưu ở `User.teamId` (đơn); `Team.managerIds[]` là quản lý; `customers.teamIds[]` là bản denormalize (hợp `teamId` của thành viên `careTeam`, `customer-team-sync.service.ts`). Chưa có route thêm/gỡ thành viên hay `GET /teams/:id/members`; gán nhóm qua `PATCH /users/:id/team` (`TeamsService.assignUserToTeam`: tăng `team.revision`, audit `USER_TEAM_CHANGED`). FE: `modules/crm/screens/Settings/components/TeamsSection.tsx` (danh sách nhóm, `memberCount`, không có UI thành viên); gán nhóm ở `UsersSection.tsx` |
| Role/nhóm đơn | `role`, `teamId` dùng ở khoảng 60 file code và 60+ file test. JWT `{ sub, email, role }`; `RolesGuard` đọc `user.role`; CRM đọc lại role/nhóm từ DB mỗi request qua `CrmActorService`; scope khách (`buildCustomerScope`): ADMIN tất cả, MANAGER = `teamIds` ∈ `managedTeamIds` hoặc `careTeam.userId` = mình, STAFF = `careTeam.userId` = mình |
| Xóa khách | BE đã có `DELETE /crm/customers/:id?reason=` (ADMIN + MANAGER, lý do bắt buộc, xóa mềm, hủy nhắc, audit `CUSTOMER_DELETED`; MANAGER chỉ trong scope); Admin có `GET /crm/deleted-customers`, `POST /crm/customer-restorations`, `POST /crm/customer-anonymizations`. Thao tác hàng loạt (`POST /crm/customer-bulk-operations`, tối đa 200, mỗi khách một transaction) **chưa có** `DELETE`. FE `BulkActionBar.tsx` có option Đổi tình trạng / Gắn thẻ / Thêm người chăm sóc / Xuất CSV, **chưa có Xóa**; FE chưa gọi API xóa/khôi phục nào. "Bỏ" = `customer_statuses` code `DROPPED` thuộc `listGroup` `DROPPED` (nhận diện theo `listGroup`). SĐT unique toàn hệ thống kể cả khách xóa mềm |
| Khu vực | Collection `areas` dạng cây (`COUNTRY`/`PROVINCE`/`DISTRICT`/`WARD`/`OTHER`; có sẵn `isLegacy`, `adminCode`), `Customer.areaId`, `Project.areaId`; seed cũ 4 tỉnh + vài quận + "Nước ngoài"; FE select đơn + lọc `areaIds` (mở rộng theo `ancestorIds`) |

---

### 4. Sửa đổi A — Nhiều role và nhiều nhóm cho một tài khoản (Đợt 1, BE)

**Trạng thái:** Đang làm – Đợt 1 BE đã code + QA lần 2 đạt (commit nháp `d972538` + vài file chưa commit); migration 005 chưa chạy trên dev.

#### 4.1 Bối cảnh / vấn đề
Hiện mỗi tài khoản chỉ có **một** `role` và **một** `teamId`. Thực tế một người có thể vừa quản lý một nhóm vừa là nhân viên chăm sóc ở nhóm khác, hoặc thuộc nhiều nhóm. Tài liệu 04 §3.8 và §4.1 mô tả mô hình đơn.

#### 4.2 Quyết định nghiệp vụ (của Oniichan)
Xem mục 2, điểm 2. Tóm tắt: nhiều role, nhiều nhóm; quyền theo role cao nhất trong cùng phân vùng CRM; `STAFF` và `EDITOR` ngang quyền.

#### 4.3 Thiết kế / quy tắc
*Thay thế một phần quy tắc "mỗi tài khoản một role, một nhóm" ở §3.8 và §4.1 của tài liệu 04.*

1. **Thêm** `roles[]` và `teamIds[]` vào `users`.
2. **Giữ** `role` và `teamId` làm **trường suy ra, luôn đồng bộ**: `role` = role cao nhất theo thứ tự `ADMIN` > `MANAGER` > `STAFF` > `EDITOR`; `teamId` = `teamIds[0]` (hoặc `null` nếu rỗng). Nhờ vậy các chỗ cũ (~60 file code, 60+ file test) **không phải sửa hàng loạt**.
3. **`RolesGuard`:** khớp nếu **bất kỳ** role nào của người dùng khớp `@Roles(...)`. Token cũ chỉ có `role` vẫn chạy (fallback).
4. **Quyền CRM và phạm vi xem khách** theo **role CRM cao nhất**: `MANAGER` + `STAFF` → scope của `MANAGER`; `ADMIN` + role khác → xem tất cả. `STAFF` + `EDITOR` → hợp quyền (EDITOR không có quyền CRM, nên phần CRM vẫn là quyền `STAFF`).
5. **`customers.teamIds`** = hợp `teamIds[]` của mọi thành viên `careTeam` (cập nhật `customer-team-sync.service.ts`).
6. **Chỉ user có role `MANAGER` hoặc `STAFF` mới có nhóm.** Khi bỏ role `MANAGER` của một người thì **gỡ họ khỏi `managerIds`** của các nhóm; khi không còn role `MANAGER`/`STAFF` nào thì **xóa luôn `teamIds`/`teamId`** (không để lại "Quản lý ma" giữ quyền theo nhóm).
7. **JWT** thêm claim `roles`. Audit `actorRole` **giữ một giá trị** (role cao nhất).
8. **Route cũ có ngữ nghĩa thu gọn (đã code):** `PATCH /users/:id/role` = đặt `roles = [role]` (thay toàn bộ role, người nhiều role bị thu về một); `PATCH /users/:id/team` = đặt đúng **một** nhóm `teamIds = [teamId]` (`null` → `[]`). Muốn nhiều role/nhóm phải dùng route mới `/roles`, `/teams` (**ADMIN-only**).
9. **`POST /users` kiểm nhất quán:** nếu client gửi **cả** dạng mảng và dạng đơn mà mâu thuẫn thì trả `400 VALIDATION_FAILED` khi `role` ≠ role cao nhất của `roles`, hoặc `teamId` ≠ `teamIds[0]`. Chỉ gửi một dạng thì không có lỗi này.
10. **Audit:** `USER_ROLE_CHANGED` ghi cả `roles` và `teamIds` (trước → sau, vì đổi role có thể xóa nhóm); `USER_TEAM_CHANGED` ghi `teamIds`.
11. **`GET /crm/assignable-users` (đã siết):** ADMIN thấy tất cả; **MANAGER chỉ thấy người thuộc nhóm mình QUẢN LÝ** (không còn nhóm mình chỉ là thành viên); STAFF thấy người cùng nhóm mình, **STAFF không có nhóm → rỗng**; `?teamId=` ngoài phạm vi của người gọi → **rỗng** (không dùng để dò nhóm khác). Dùng chung hàm `resolveAssignableTeamIds` với `assertAssignable` nên danh sách khớp đúng điều kiện chấp nhận khi gán. Hệ quả: danh sách này **không dùng được làm nguồn bộ lọc** (xem mục 6.10).

#### 4.4 API thay đổi (tương thích ngược)

| Method | Path | Thay đổi |
|---|---|---|
| POST | `/users` | Nhận `roles[]` **hoặc** `role` đơn (cũ). Có thể kèm `teamIds[]`/`teamId`. Gửi cả hai dạng mà `role` ≠ role cao nhất của `roles` hoặc `teamId` ≠ `teamIds[0]` → `400 VALIDATION_FAILED` |
| PATCH | `/users/:id/role` | **Giữ** body `{ role }`; ngữ nghĩa **thu gọn**: `roles = [role]` (thay toàn bộ role) |
| PATCH | `/users/:id/roles` | **Mới.** Body `{ roles[] }`; ADMIN-only; audit `USER_ROLE_CHANGED` (ghi `roles`, `teamIds`); chặn gỡ ADMIN cuối cùng (`409 LAST_ADMIN_REQUIRED`); đặt lại đúng tập role hiện có là no-op |
| PATCH | `/users/:id/team` | **Giữ** body `{ teamId \| null }`; ngữ nghĩa **thu gọn**: đúng một nhóm (`teamIds = [teamId]`, `null` → `[]`) |
| PATCH | `/users/:id/teams` | **Mới.** Body `{ teamIds[] }`; ADMIN-only; tăng `revision` các nhóm bị ảnh hưởng; audit `USER_TEAM_CHANGED` (ghi `teamIds`); đồng bộ `customers.teamIds` |
| GET | `/users`, `GET /auth/me`, response đăng nhập | Response **thêm** `roles`, `teamIds` (vẫn giữ `role`, `teamId`) |
| GET | `/crm/assignable-users` | **Siết phạm vi** (mục 4.3 điểm 11); response thêm `roles`, `teamIds`, `teams`, giữ `role`, `team` |

#### 4.5 Dữ liệu & migration
- Migration `RealEstateBackendApp/scripts/migrations/005_users_roles_teamids.ts`, **idempotent**: `roles = [role]`; `teamIds = teamId ? [teamId] : []` (chỉ ghi cho bản ghi chưa có `roles`/`teamIds`). **Mặc định là dry-run**; ghi thật khi có `--apply`.
- Thêm **hai index mới** trên `users`: `{ roles: 1, status: 1 }` và `{ teamIds: 1, status: 1 }` (đều multikey). **Index cũ `{ teamId: 1, status: 1 }` giữ nguyên.**
- Không đổi/xóa field nào đang có.
- **Phát hiện lệch (drift):** output có `driftBefore` (số tài khoản đã có `roles`/`teamIds` nhưng `role` ≠ role cao nhất của `roles`, hoặc `teamId` ≠ `teamIds[0]`), `driftIds` (tối đa 20 `_id` đầu) và `driftClearsTeamIds` (tối đa 20 `_id` có `teamId = null` nhưng `teamIds` còn giá trị, sẽ bị xóa `teamIds` nếu reconcile). Lệch thường do pod/code cũ ghi `role`/`teamId` đơn lúc rolling deploy.
- **Cờ `--reconcile`:** chỉ có tác dụng khi đi kèm `--apply` (không có `--apply` thì vẫn là dry-run). Lấy cặp đơn `role`/`teamId` làm nguồn đúng: đặt `roles = [role]`, `teamIds = teamId ? [teamId] : []` cho tài khoản lệch; tức **thu gọn** người nhiều role/nhiều nhóm đang bị lệch, và **xóa `teamIds` khi `teamId = null`**. Lưu ý: `customers.teamIds` **không tự tính lại** (cần kiểm tra/đồng bộ riêng); `driftBefore` đếm **trước** backfill nên số `reconciled` có thể **lớn hơn** `driftBefore` (bản ghi vừa chưa migrate vừa lệch). Chỉ dùng khi mọi pod cũ đã tắt.
- **Guard khởi động** `RealEstateBackendApp/src/modules/users/migrations/user-roles-migration.guard.ts` (`OnModuleInit`): đếm tài khoản còn thiếu `roles` (thiếu/rỗng) hoặc `teamIds`. **Production: fail-fast** (không khởi động); **staging/dev: chỉ cảnh báo** kèm số lượng và lệnh chạy migration; **`NODE_ENV=test`: bỏ qua** (không truy vấn DB).
- **Thứ tự triển khai bắt buộc:** `mongodump` → `005 --dry-run` (mặc định) → `005 --apply` → **mới** chạy/triển khai container code mới. `docker-compose.yml` đặt `NODE_ENV=production`, nên làm sai thứ tự thì container **crash-loop** vì guard từ chối khởi động.

#### 4.6 Giao diện
Chọn nhiều role/nhiều nhóm ở `UsersSection.tsx` và `UserManagementScreen` **làm ở Đợt 2, cùng mục C**. Ở Đợt 1 giao diện cũ vẫn chạy nhờ trường `role`/`teamId` suy ra.

#### 4.7 Ảnh hưởng tài liệu khác
- `04_…` §3.8 (collection `users`), §4.1 (vai trò), §4.3 (`CrmActor`, scope).
- `05_…` §2.2 (nhóm `/users`, `/teams`).
- `02_Auth_Module_Architecture.md` §5 (data model `users`), §5.1 (claims JWT), §6.2 (`PATCH /users/:id/role`).

#### 4.8 Kiểm thử / nghiệm thu
- Unit: hàm suy ra `role` cao nhất và `teamId` từ mảng; `RolesGuard` khớp bất kỳ role; token cũ chỉ có `role` vẫn qua guard.
- Unit/integration: `MANAGER` + `STAFF` → scope `MANAGER`; `ADMIN` + role khác → tất cả; `STAFF` + `EDITOR` → quyền CRM của `STAFF`, các route `@Roles(EDITOR)` cũng qua.
- Bỏ role `MANAGER` → bị gỡ khỏi `managerIds`; user không có role `MANAGER`/`STAFF` không gán được nhóm (lỗi rõ ràng).
- `customers.teamIds` đúng hợp nhóm của mọi thành viên `careTeam` sau khi đổi `teamIds[]`.
- API cũ (`role` đơn, `PATCH /users/:id/team`) vẫn trả đúng; response mới có `roles`, `teamIds`.
- Migration 005 chạy hai lần cho cùng kết quả; đối chiếu số user trước/sau; `driftBefore` = 0 sau khi chạy; `--reconcile` không có `--apply` thì không ghi gì; có `--apply --reconcile` thì thu gọn đúng tài khoản lệch và báo `driftClearsTeamIds`.
- Guard khởi động: production + còn user thiếu `roles`/`teamIds` → lỗi khi khởi động; staging/dev → chỉ warn; `NODE_ENV=test` → bỏ qua; không còn user thiếu → qua.
- `PATCH /users/:id/role` và `/team` cũ có ngữ nghĩa thu gọn (role → `[role]`; team → đúng một nhóm); `POST /users` gửi mâu thuẫn `role`/`roles` hoặc `teamId`/`teamIds` → 400 `VALIDATION_FAILED`.
- `assignable-users`: MANAGER không thấy người ở nhóm mình chỉ là thành viên; `?teamId=` ngoài phạm vi → rỗng; STAFF không nhóm → rỗng; danh sách khớp với kết quả `assertAssignable`.
- Audit `USER_ROLE_CHANGED` có `roles`/`teamIds`; `USER_TEAM_CHANGED` có `teamIds`.
- Toàn bộ test hiện có vẫn xanh (không sửa hàng loạt).

#### 4.9 Rủi ro / điều chưa kiểm chứng
- Triển khai sai thứ tự (chạy code mới trước migration 005) làm production crash-loop do guard khởi động; rolling deploy để pod cũ còn ghi `role`/`teamId` đơn sau `005 --apply` gây lệch (xử lý bằng `--apply --reconcile` khi mọi pod cũ đã tắt, chấp nhận thu gọn người nhiều role/nhóm bị lệch).
- Hai trường `role` và `teamId` suy ra có thể lệch với `roles[]`/`teamIds[]` nếu có đường ghi bỏ qua service: mọi ghi phải đi qua một hàm đồng bộ duy nhất; QA kiểm tra các đường ghi.
- Token cũ còn hiệu lực tối đa 15 phút vẫn chạy nhờ fallback `role` (giả định 4).
- Các route ngoài CRM còn tin role trong JWT (đã ghi ở milestone M1) nên role mới có hiệu lực tối đa sau thời hạn token.

---

### 5. Sửa đổi B — Khu vực theo 34 tỉnh thành (Đợt 1, BE + FE)

**Trạng thái:** Đang làm – Đợt 1 BE + FE đã code + QA lần 2 đạt; migration 006 chưa chạy trên dev.

#### 5.1 Bối cảnh / vấn đề
Seed khu vực cũ chỉ có 4 tỉnh, vài quận và mục "Nước ngoài", không theo đơn vị hành chính hiện hành. Từ 01/07/2025 cả nước có 34 tỉnh thành (Nghị quyết 202/2025/QH15).

#### 5.2 Quyết định nghiệp vụ (của Oniichan)
Xem mục 2, điểm 4: dùng 34 tỉnh thành; khu vực cũ xóa hẳn, không giữ, không chuyển, không nhãn "(khu vực cũ)"; khách/dự án trỏ khu vực cũ thì `areaId = null`; chạy script lên DB dev sau khi QA đạt, có `mongodump` + dry-run.

#### 5.3 Thiết kế / quy tắc
1. **Danh sách 34 mục** (type `PROVINCE`, **phẳng**, không có cấp quận/phường): Hà Nội, Huế, Lai Châu, Điện Biên, Sơn La, Lạng Sơn, Quảng Ninh, Thanh Hóa, Nghệ An, Hà Tĩnh, Cao Bằng, Tuyên Quang, Lào Cai, Thái Nguyên, Phú Thọ, Bắc Ninh, Hưng Yên, Hải Phòng, Ninh Bình, Quảng Trị, Đà Nẵng, Quảng Ngãi, Gia Lai, Khánh Hòa, Lâm Đồng, Đắk Lắk, TP. Hồ Chí Minh, Đồng Nai, Tây Ninh, Cần Thơ, Vĩnh Long, Đồng Tháp, Cà Mau, An Giang.
2. Mục "Nước ngoài" của seed cũ **bị bỏ** (điểm đã báo Oniichan, chờ xác nhận nếu cần giữ — xem mục 9 và 10).
3. `adminCode` **chỉ điền khi chắc chắn**, nếu không thì để trống (giả định 5).
4. Seed mới upsert theo `seedKey`; seed cũ không còn tạo khu vực quận/"Nước ngoài".
5. FE: mapper chỉ hiện **tên tỉnh**; khách/dự án không có khu vực thì không có nhãn "(khu vực cũ)". **Bảng danh sách khách hiện "—" khi khu vực rỗng** (`CustomerTableRow.tsx`); các chỗ khác không hiện gì (điều chỉnh so với bản đầu, vốn ghi "không dấu gạch").
6. **Bí danh khu vực** khi import CSV và khi gõ tìm ở ô chọn khu vực (`RealEstateAdminApp/src/modules/crm/lib/areaMatch.ts`): bỏ tiền tố "TP."/"Thành phố"/"Tỉnh" và hậu tố ", Việt Nam"; nhận HCM, TP.HCM, HCMC, Sài Gòn, Ho Chi Minh City → TP. Hồ Chí Minh; HN, Hanoi → Hà Nội; Haiphong → Hải Phòng; Danang → Đà Nẵng; Cantho → Cần Thơ; Đắc Lắc (`dac lac`) → Đắk Lắk (`dak lak`); Thừa Thiên Huế → Huế. **Bình Dương và Bà Rịa-Vũng Tàu cố ý KHÔNG có bí danh** (đã sáp nhập vào TP. Hồ Chí Minh, không ánh xạ ngầm; nhập tên này sẽ thành "không khớp").
7. **Admin vẫn tạo được khu vực con** (quận/phường...) ở màn Settings; mục 5.3 chỉ ràng buộc dữ liệu seed/migration (34 tỉnh phẳng), không khóa chức năng tạo. Dữ liệu tạo thêm này không nằm trong tập 34 mục sau migration và là ngoại lệ có chủ đích.
8. **Lịch sử audit khách giữ nhãn khu vực cũ dạng text** (audit lưu nhãn tại thời điểm ghi, không tra lại danh mục); migration không viết lại audit. Đây là ngoại lệ so với "không hiển thị nhãn khu vực cũ" của mục 2 điểm 4 (chỉ áp cho trường hiện tại của khách/dự án).
9. **Việc dọn còn lại:** ví dụ Swagger cũ ở DTO khu vực (ví dụ `Quận 7` trong `catalogs/dtos/area.dto.ts`) còn nhắc quận/huyện, cần sửa cho khớp tỉnh phẳng (không ảnh hưởng hành vi).

#### 5.4 API thay đổi
Không đổi hợp đồng API. Dữ liệu trả về của `GET /crm/areas` (và các response có `area`) chỉ còn 34 mục phẳng; `areaId` có thể `null`. Lọc `areaIds` vẫn chạy (cây một cấp nên mở rộng `ancestorIds` không tạo thêm kết quả).

#### 5.5 Dữ liệu & migration
Script `RealEstateBackendApp/scripts/migrations/006_areas_34_provinces.ts` (**mặc định dry-run**; có thể ghi rõ `--dry-run`; ghi thật khi `--apply`; `--apply` và `--dry-run` không dùng cùng nhau; chạy trong một transaction, cần Replica Set):
1. Đặt `areaId = null` cho `customers` và `projects` đang trỏ khu vực **không thuộc 34 tỉnh** (kể cả khách đã xóa mềm).
2. **Xóa cứng** các khu vực cũ (không thuộc 34 tỉnh: quận/huyện, "Nước ngoài", tỉnh cũ, bản đã xóa mềm).
3. **Upsert 34 tỉnh** theo `seedKey`; tỉnh gốc đang có và trùng tên (không dấu) được **giữ nguyên id** (khách trỏ vào vẫn hợp lệ), chỉ chuẩn hóa `order`/`type`/`seedKey`.
4. **Idempotent**; **không ghi audit, không tăng `version`** hàng loạt trên khách/dự án.
5. Dry-run chỉ in số liệu (số khách/dự án bị đặt `null`, số khu vực xóa, số tỉnh upsert), không ghi DB.

Hệ quả: dữ liệu khu vực cũ **mất vĩnh viễn** sau khi chạy thật; cơ sở khôi phục duy nhất là bản `mongodump` làm trước đó.

#### 5.6 Giao diện
- Ô chọn khu vực có **tìm kiếm không dấu** ("ha noi" khớp "Hà Nội").
- Mapper chỉ hiện tên tỉnh; khách không có khu vực không hiển thị gì.
- Cập nhật dữ liệu mock/seed FE (`mockData.ts`, `seedCatalogs.ts`) và import khách (khớp **tên 34 tỉnh** + bí danh ở mục 5.3 điểm 6).
- **Import CSV: tên khu vực không khớp 34 tỉnh (kể cả sau bí danh) thì để trống khu vực và VẪN tạo khách** — không báo lỗi dòng, chỉ cảnh báo nhẹ ("Khu vực không khớp 34 tỉnh ... — để trống"). Hệ quả: khách vào hệ thống **không có khu vực** và hiện "—" ở bảng. Code FE trước đó báo lỗi dòng; đã sửa cho khớp (`RealEstateAdminApp/.../lib/importCustomers.ts`, thay đổi chưa commit).
- Bảng danh sách khách hiện "—" khi khu vực rỗng.

#### 5.7 Ảnh hưởng tài liệu khác
- `04_…` §3.3 (danh mục) và phần seed khu vực; `05_…` §2.8 (danh mục & dự án). Chỉ thêm dòng trỏ, không viết lại.

#### 5.8 Kiểm thử / nghiệm thu
- Seed tạo đúng 34 tỉnh, `type = PROVINCE`, không còn mục nào khác; chạy lặp không tạo trùng.
- Migration 006: dry-run không ghi DB; chạy thật đặt `areaId = null` đúng bản ghi, xóa khu vực cũ, giữ nguyên `version`/audit; chạy lần hai không đổi gì.
- FE: gõ không dấu ra đúng tỉnh; bí danh (HCM, Sài Gòn, HN...) khớp đúng tỉnh; khách `areaId = null` hiện "—" ở bảng; import khớp tên tỉnh; import tên không khớp (kể cả "Bình Dương", "Bà Rịa-Vũng Tàu") vẫn tạo khách với khu vực trống và có cảnh báo, không có lỗi dòng.
- Đối chiếu số liệu trước/sau trên dev (mục 8.4).

#### 5.9 Rủi ro / điều chưa kiểm chứng
- Mất dữ liệu khu vực cũ là chủ ý nhưng không hoàn tác ngoài `mongodump`.
- Mã `adminCode` chính thức chưa kiểm chứng nên để trống.
- Khách ở nước ngoài mất thông tin khu vực (xem giả định 3).
- Khách import với khu vực không khớp sẽ không có khu vực; cần theo dõi số lượng (cảnh báo khi import) để bổ sung tay.
- Admin tạo khu vực con ở Settings làm danh mục vượt ngoài 34 mục; lọc `areaIds` theo `ancestorIds` lúc đó có thể trả thêm kết quả (mục 5.4 chỉ đúng khi cây một cấp).
- Có thể còn chỗ khác trong code dựa vào khu vực dạng quận/`ancestorIds`; QA tìm các chỗ này.

---

### 6. Sửa đổi C — Thành viên nhóm: xem, thêm, gỡ (Đợt 2, BE + FE)

**Trạng thái:** Đang làm – Đợt 2: đã code BE + FE; BE QA đạt (116/117, đã sửa test đếm route Swagger 31 → 34); FE đang QA. Chưa commit chính thức, chưa có Oniichan duyệt Cổng 3.

#### 6.1 Bối cảnh / vấn đề
Màn quản lý nhóm (`TeamsSection.tsx`) chỉ có danh sách nhóm và `memberCount`; không xem được ai là thành viên, không thêm/gỡ được. Muốn đổi thành viên phải vào từng tài khoản (`UsersSection.tsx`).

#### 6.2 Quyết định nghiệp vụ (của Oniichan)
Xem mục 2, điểm 1, 2 và 5: bổ sung xem/thêm/gỡ thành viên; một người ở nhiều nhóm; bộ lọc "Người phụ trách" của Manager dùng nguồn riêng (mục 6.10).

#### 6.3 Thiết kế / quy tắc
- Quyền **ghi** (thêm/gỡ) **chỉ ADMIN** (giống tạo/sửa nhóm; giả định 1). Quyền **xem** danh sách thành viên: ADMIN mọi nhóm, MANAGER chỉ nhóm mình quản lý (chi tiết mục 6.4).
- Dùng lại `TeamsService.addUserToTeam` / `removeUserFromTeam` (đã có transaction, tăng `revision`, audit, đồng bộ `customers.teamIds`), làm việc trên `teamIds[]` của sửa đổi A.
- Chỉ user có role `MANAGER`/`STAFF` mới thêm được vào nhóm (quy tắc A).
- Một người có thể thuộc nhiều nhóm.

#### 6.4 API thay đổi

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/teams/:id/members` | **Mới.** Danh sách thành viên của nhóm, phân trang `page`/`limit` (≤ giới hạn của hệ thống) và tìm `q` | A (mọi nhóm), M (chỉ nhóm mình quản lý, tức có mặt trong `managerIds`); STAFF/EDITOR → 403 |
| POST | `/teams/:id/members` | **Mới.** Thêm thành viên, body `{ userId }`; thành công `201`; idempotent (đã là thành viên thì không tạo trùng) | A |
| DELETE | `/teams/:id/members/:userId` | **Mới.** Gỡ thành viên; thành công `204`; idempotent (không phải thành viên thì vẫn `204`) | A |

Quy tắc đã code:
- **Quyền xem của MANAGER là quyết định có chủ ý (Oniichan duyệt ngầm):** Manager cần xem thành viên nhóm mình quản lý để làm việc, nên GET không chỉ ADMIN; điều này **thay đổi một phần giả định 1** (giả định 1 giờ chỉ còn đúng với thêm/gỡ).
- **Lỗi:** `POST` với user không có role `MANAGER`/`STAFF` → `400 VALIDATION_FAILED`. Nhóm không tồn tại, đã xóa mềm hoặc đã tắt; hoặc user không tồn tại → `404`. **Nhóm đã tắt** vẫn `GET` được (200) và **gỡ** thành viên được, nhưng **không thêm** người mới.
- **Response `Member`** = `{ id, displayName, role, roles, status, isManager }`; **không có email**.

#### 6.5 Dữ liệu & migration
Không có migration riêng; dựa vào `teamIds[]` và migration 005 của sửa đổi A.

#### 6.6 Giao diện
- `TeamsSection.tsx`: hiện danh sách thành viên của nhóm, nút **Thêm thành viên**, nút **Gỡ** từng người.
- `UsersSection.tsx` và `UserManagementScreen`: chọn **nhiều role** và **nhiều nhóm** (hoàn tất giao diện của sửa đổi A).
- Sau khi lưu thêm/gỡ thì ở lại màn nhóm và cập nhật danh sách + `memberCount` (không văng ra màn khác, không mất ngữ cảnh).
- **Đã code (FE):** `TeamsSection` có panel **"Thành viên"** (danh sách, thêm, gỡ). Khi gỡ một người vẫn là Quản lý của nhóm thì hiện cảnh báo **"Người này vẫn là Quản lý của nhóm"** (xem mục 6.8: gỡ thành viên không đụng `managerIds`).
- **Đã code (FE):** `UsersSection`/`UserManagementScreen` chọn **nhiều role + nhiều nhóm**: nhóm được chọn **đầu tiên là nhóm chính** (`teamId = teamIds[0]`); ô chọn nhóm **chỉ hiện khi có role `MANAGER`/`STAFF`**; khi lưu gọi lần lượt `PATCH /users/:id/roles` → `PATCH /users/:id/teams` → `PATCH /users/:id/status`; **không gửi `role`/`teamId` đơn**.
- **Cờ cổng tính năng:** `PATCH /users/:id/team` và `/teams` (cùng các route CRM) nằm sau `CrmFeatureGuard` (`FEATURE_CRM_ENABLED`), còn `PATCH /users/:id/role` và `/roles` **không**. Khi tắt CRM thì lưu role thành công nhưng lưu nhóm bị chặn; FE phải xử lý lỗi từng bước và không để dữ liệu bán phần gây hiểu nhầm.

#### 6.7 Ảnh hưởng tài liệu khác
- `05_…` §2.2 (thêm 3 route); `04_…` §4.2 (ma trận quyền: nhóm). Chỉ thêm dòng trỏ.

#### 6.8 Kiểm thử / nghiệm thu
- `POST`/`DELETE`: chỉ ADMIN, vai khác 403. `GET`: ADMIN mọi nhóm; MANAGER chỉ nhóm mình quản lý (nhóm khác → 403); STAFF/EDITOR → 403. Response `Member` không có email; phân trang `page`/`limit`/`q` đúng.
- Thêm thành viên → `customers.teamIds` của các khách mà người đó chăm sóc được cập nhật; gỡ thì ngược lại; có audit `USER_TEAM_CHANGED`.
- **`revision` của nhóm chỉ tăng khi THÊM thành viên** (làm khóa chống xung đột với xóa nhóm); **gỡ thì không tăng**.
- **Gỡ thành viên KHÔNG đụng `managerIds`:** quản lý nhóm chỉ đổi qua `PATCH /teams/:id` hoặc khi gỡ role `MANAGER` của người đó; vì vậy FE cảnh báo "Người này vẫn là Quản lý của nhóm" khi gỡ một Quản lý.
- Thêm/gỡ chạy trong **một transaction**: đồng bộ `teamIds`/`teamId` của user (`teamId = teamIds[0]`; gỡ nhóm chính thì nhóm kế tiếp lên làm nhóm chính), tính lại `customers.teamIds`, ghi audit `USER_TEAM_CHANGED`.
- Thêm user không có role `MANAGER`/`STAFF` → `400 VALIDATION_FAILED`; thêm trùng không tạo bản ghi trùng (idempotent `201`/`204`); nhóm/user không tồn tại hoặc nhóm đã xóa mềm → `404`; nhóm tắt: vẫn `GET`, gỡ được, không thêm được.
- FE: danh sách thành viên đúng, thêm/gỡ cập nhật ngay, lỗi hiện rõ.

#### 6.9 Rủi ro / điều chưa kiểm chứng
- Gỡ thành viên đang là người chăm sóc của khách: khách vẫn nằm trong `careTeam` nhưng `customers.teamIds` đổi; cần QA kiểm tra scope của khách đó.
- Quyền thêm/gỡ "chỉ Admin" là giả định (mục 9); quyền xem của MANAGER là quyết định có chủ ý (mục 6.4).
- `GET /teams/:id/members` hiện kiểm tồn tại nhóm (404) **trước** kiểm quyền (403), nên người không có quyền có thể phân biệt nhóm có tồn tại hay không; mức độ nhẹ, còn mở (mục 10).
- Gỡ thành viên mà họ vẫn trong `managerIds` thì họ vẫn giữ quyền Quản lý nhóm đó (không còn là thành viên); đã có cảnh báo FE, cần QA theo dõi.

#### 6.10 Nguồn bộ lọc "Người phụ trách" của Manager (Đợt 2, BE + FE)

*Chốt 2026-10-29 (mục 2, điểm 5). Thuộc Đợt 2; đã code BE + FE, BE QA đạt, FE đang QA.*

- **Bối cảnh:** sau sửa đổi A, `GET /crm/assignable-users` chỉ trả người thuộc nhóm Manager **quản lý** (mục 4.3 điểm 11), đúng cho việc **gán** nhưng thiếu cho việc **lọc**: Manager thấy khách có người phụ trách/thành viên `careTeam` nằm ngoài nhóm mình quản lý (ví dụ người ở nhóm mình chỉ là thành viên) mà bộ lọc không liệt kê được họ.
- **Quyết định:** **lọc ≠ gán.** Bộ lọc "Người phụ trách" của Manager dùng **nguồn riêng** = các người phụ trách/thành viên xuất hiện trong **tập khách Manager được thấy**. Ô **gán** người (form tạo/sửa khách, "Thêm người chăm sóc" ở `BulkActionBar`, `CareTeamCard`...) vẫn dùng `assignable-users` chặt.
- **Thiết kế đã code (BE):** `GET /crm/assignable-users?purpose=filter`. Tham số `purpose` nhận `assign` (**mặc định**) hoặc `filter`; giá trị khác → `400`.
  - **MANAGER + `filter`:** trả **mọi người trong `careTeam`** của tập khách Manager được thấy (distinct `careTeam.userId` theo `buildCustomerScope`, bỏ khách đã xóa mềm). **Không ràng buộc role/status của user**: ADMIN/EDITOR cũ và user đã khóa vẫn có mặt; chỉ bỏ user đã xóa mềm. Không lộ email.
  - **ADMIN, STAFF, hoặc không có `purpose`:** như cũ (nguồn gán chặt, mục 4.3 điểm 11).
  - **Hiệu năng (QA đo):** 40.000 khách ≈ 435 ms, tăng tuyến tính; **chưa cache**. Nếu số khách vượt khoảng 100.000 thì **phải hỏi Oniichan trước** khi thêm cache/đổi cách tính.
  - **Hạn chế đã biết:** người có lịch hẹn mở nhưng đã rời `careTeam` của khách thì **không có** trong ô lọc của `DailyTasks`.
- **FE đã code:** 3 nơi dùng query riêng `useAssigneeFilterOptions`; ô **gán** người không đổi (vẫn `assignable-users` chặt). 3 nơi ảnh hưởng (đổi nguồn dữ liệu của ô lọc người phụ trách): `RealEstateAdminApp/src/modules/crm/screens/Customers/components/CustomerToolbar.tsx`, `RealEstateAdminApp/src/modules/crm/components/AdvancedFilterModal.tsx`, `RealEstateAdminApp/src/modules/crm/screens/DailyTasks/DailyTasks.desktop.tsx`.
- **Vai khác Manager:** Admin và STAFF **giữ nguyên** nguồn cũ (đã code theo cách này; quyết định của Oniichan chỉ nêu Manager).
- **Kiểm thử:** Manager thấy trong bộ lọc đúng các người xuất hiện trong tập khách mình thấy (kể cả người ở nhóm mình chỉ là thành viên); không thấy người nằm ngoài tập đó; ô gán người vẫn chỉ liệt kê người thuộc nhóm mình quản lý; không lộ email.

---

### 7. Sửa đổi D — Xóa, khôi phục, xóa vĩnh viễn khách "Bỏ" (Đợt 2, BE + FE)

**Trạng thái:** BE đã code + QA đạt 2026-10-30, FE đang QA (Đợt 2). Hợp đồng API cuối cùng ở mục 7.4.

#### 7.1 Bối cảnh / vấn đề
BE đã có xóa mềm đơn và các route khôi phục/ẩn danh hóa cho Admin, nhưng thao tác hàng loạt chưa có xóa, FE chưa có nút xóa hay màn khách đã xóa, và chưa có cách xóa hẳn khách (SĐT vẫn bị giữ chỗ sau khi xóa mềm).

#### 7.2 Quyết định nghiệp vụ (của Oniichan)
Xem mục 2, điểm 3. Tóm tắt phân quyền xóa:

| Vai | Xóa được |
|---|---|
| Admin | Mọi khách (xóa hàng loạt: chỉ khách "Bỏ") |
| Manager | Khách **thuộc nhóm mình quản lý** (xóa hàng loạt: chỉ khách "Bỏ"); chỉ có mặt trong `careTeam` của khách thì **không đủ** |
| STAFF | Chỉ khách "Bỏ" mình là **người phụ trách chính** (không cần là người nhập khách), cả xóa đơn lẫn hàng loạt |

Xóa đơn của Admin/Manager giữ hành vi cũ, không đòi khách "Bỏ" (xem 7.4 mục 2); nút Xóa ở FE vẫn chỉ hiện với khách "Bỏ" (7.6).

Xóa là **xóa mềm**; **Admin khôi phục** và **xóa vĩnh viễn**. (Chốt lại 2026-10-29, đóng hai điểm mở về STAFF và Manager ở mục 10.)

**Chốt 2026-10-30 (Oniichan):**
1. Xóa vĩnh viễn **xóa sạch audit cũ** của khách, chỉ giữ **một** dòng `CUSTOMER_PURGED` không PII.
2. **Tài khoản nhiều role:** quyền theo role cao nhất. **MANAGER+STAFF** coi như Manager: **không** xóa được khách thuộc nhóm khác dù mình là phụ trách chính (đã khóa bằng test); ADMIN+STAFF = Admin; STAFF+EDITOR giữ quyền STAFF.
3. **Không khôi phục khi xóa vĩnh viễn đã bắt đầu** (khách ở trạng thái "đang xóa dở", chỉ thoát bằng bấm Xóa vĩnh viễn lại): cờ `customers.purgingAt`, mã lỗi `CUSTOMER_PURGE_IN_PROGRESS` (7.4).

#### 7.3 Thiết kế / quy tắc
1. **Xóa hàng loạt:** thêm `DELETE` vào `BulkOperationType`. Chỉ áp dụng cho khách thuộc nhóm "Bỏ" (theo `listGroup = DROPPED`); kiểm quyền **từng khách**; **một lý do chung**; tối đa 200 khách; kết quả theo từng khách (thành công/thất bại + mã lỗi); mỗi khách một transaction như các thao tác hàng loạt khác.
2. **Xóa đơn:** `DELETE /crm/customers/:id` **giữ** cho ADMIN/MANAGER trong scope; **mở thêm cho STAFF** với khách mình là **người phụ trách chính** (không cần là người nhập khách) và **chỉ khi khách thuộc nhóm "Bỏ"**. **Siết lại cho MANAGER:** chỉ xóa khách thuộc **nhóm mình quản lý** (`customers.teamIds` giao với `managedTeamIds`), **không** dùng scope xem (scope xem còn gồm khách mình chỉ có mặt trong `careTeam`). (BE đã sửa theo điều kiện này.)
3. **Xóa vĩnh viễn:** route mới **chỉ ADMIN**, chỉ với khách **đã xóa mềm**, **không hoàn tác**. Xóa cả nhật ký chăm sóc, ảnh đính kèm (kể cả file MinIO), lịch hẹn, yêu cầu nhóm chăm sóc, nhắc. Giữ **một dòng audit "đã xóa vĩnh viễn" không kèm PII**. **Giải phóng SĐT** (xóa mềm vẫn giữ chỗ; giả định 2). **Khi xóa vĩnh viễn đã bắt đầu** (cờ `purgingAt`), khôi phục và ẩn danh hóa khách đó bị chặn (409), xóa vĩnh viễn song song cũng bị chặn.
4. "Ẩn danh hóa" hiện có **giữ nguyên** (chỉ thêm điều kiện chặn khi khách đang xóa vĩnh viễn dở).
5. Khôi phục dùng route hiện có `POST /crm/customer-restorations`.

#### 7.4 API thay đổi

| Method | Path | Thay đổi | Quyền |
|---|---|---|---|
| POST | `/crm/customer-bulk-operations` | Thêm `type = DELETE`, **`payload.reason`**; kết quả từng khách | A, M, S (kiểm từng khách) |
| DELETE | `/crm/customers/:id?reason=` | Mở thêm cho STAFF (khách "Bỏ", mình là người phụ trách chính); siết MANAGER về nhóm mình quản lý | A, M (nhóm mình quản lý), S (điều kiện trên) |
| DELETE | `/crm/deleted-customers/:id` | **Mới (đã chốt tên).** Xóa vĩnh viễn khách đã xóa mềm. Không hoàn tác | A |
| GET | `/crm/deleted-customers` | Dùng lại cho màn "Khách đã xóa"; **thêm field `deleteReason`, `purgeInProgress`** | A |
| POST | `/crm/customer-restorations` | Dùng lại cho nút Khôi phục; **thêm 409 `CUSTOMER_PURGE_IN_PROGRESS`** | A |

**Đã chốt tên route xóa vĩnh viễn:** `DELETE /crm/deleted-customers/:id`. Lý do: module CRM đặt tên theo danh từ số nhiều và không đưa động từ vào URL (`customer-restorations`, `customer-anonymizations`, `customer-bulk-operations`, `deleted-customers`); xóa vĩnh viễn là xóa phần tử khỏi tập `deleted-customers` mà `GET /crm/deleted-customers` đang liệt kê, nên một khách chưa xóa mềm không thuộc tập này (409). Khôi phục giữ route cũ.

##### Hợp đồng API cuối cùng (BE đã code; FE bám theo)

**1. Xóa hàng loạt** `POST /crm/customer-bulk-operations` (role CRM, `X-Idempotency-Key` tùy chọn, giới hạn 10 lần/phút/người như các thao tác hàng loạt khác):
- Body: `{ "type": "DELETE", "customerIds": [≤ 200 id], "payload": { "reason": "<bắt buộc, ≤ 500 ký tự>" } }`. **`reason` nằm TRONG `payload`**, không ở cấp ngoài (cấp ngoài bị 400 do whitelist).
- 200: `{ "data": { "succeeded": ["id", ...], "failed": [{ "customerId": "id", "errorCode": "..." }] } }`. Mỗi khách một transaction; khách lỗi không làm hỏng khách khác.
- 400 `VALIDATION_FAILED` cho cả lô: **thiếu hẳn khóa `payload`** (kể cả với các loại thao tác khác), thiếu/rỗng `payload.reason`, `reason` chỉ gồm khoảng trắng/ký tự vô hình (zero-width, `\p{Cf}`: cần ít nhất một ký tự nhìn thấy được), quá 200 khách, id sai. Quy tắc "ít nhất một ký tự nhìn thấy được" áp dụng cả `reason` của xóa đơn.
- `errorCode` từng khách: `CUSTOMER_NOT_FOUND` (không tồn tại **hoặc ngoài phạm vi xem**, không lộ sự tồn tại); `CUSTOMER_NOT_DROPPED` (khách không thuộc nhóm "Bỏ"; áp dụng cho **mọi vai** ở hàng loạt); `INSUFFICIENT_ROLE` (thấy khách nhưng không đủ quyền xóa); `INTERNAL_ERROR` (lỗi lạ, đã ghi log).
- Thứ tự kiểm từng khách: phạm vi xem (404) -> quyền xóa (403) -> thuộc "Bỏ" (409).

**2. Xóa đơn** `DELETE /crm/customers/:id?reason=<bắt buộc>` → **204**. Role vào route: ADMIN, MANAGER, STAFF (EDITOR 403). Lỗi: 400 (thiếu `reason`), 404 `CUSTOMER_NOT_FOUND` (ngoài phạm vi xem, **kể cả STAFF**: trước đây STAFF nhận 403 ở mọi khách), 403 `INSUFFICIENT_ROLE` (thấy khách nhưng không đủ quyền), 409 `CUSTOMER_NOT_DROPPED` (chỉ STAFF: khách chưa "Bỏ"). **ADMIN/MANAGER giữ hành vi cũ về tình trạng: xóa đơn KHÔNG đòi khách "Bỏ"** (chỉ hàng loạt đòi "Bỏ" cho mọi vai); FE chỉ nên hiện nút Xóa khi khách "Bỏ" (mục 7.6).

**3. Quyền xóa (một hàm duy nhất dùng cho xóa đơn, hàng loạt và cờ `permissions.canDelete`)**: ADMIN mọi khách; MANAGER khi `customers.teamIds` giao `managedTeamIds` của mình (có mặt trong `careTeam` hoặc là phụ trách chính của khách nhóm khác thì **không đủ**); STAFF khi là người phụ trách chính **hiện tại** (`careTeam` role `PRIMARY`) **và** khách "Bỏ". `permissions.canDelete` ở `GET /crm/customers/:id` đã đổi theo đúng luật này (trước đây = ADMIN/MANAGER); FE hiện nút Xóa khi `status.listGroup === 'DROPPED' && permissions.canDelete`.

**4. Danh sách khách đã xóa** `GET /crm/deleted-customers` (Admin; `q`, `deletedFrom`, `deletedTo`, `page`, `limit`): mỗi phần tử = `CustomerListItem` (`id`, `fullName`, `phoneMasked` đã che, `status`, `primaryAssignee`...) + `deletedAt`, `deletedBy {id, displayName}`, `anonymizedAt`, **`deleteReason`** (mới; lấy từ audit `CUSTOMER_DELETED` mới nhất; `null` nếu khách đã ẩn danh hóa), **`purgeInProgress: boolean`** (mới; `true` khi xóa vĩnh viễn đang chạy hoặc đã lỗi dở: FE hiện "đang xóa dở, bấm Xóa vĩnh viễn để hoàn tất" và **vô hiệu nút Khôi phục**). Không có SĐT đầy đủ/email.

**5. Khôi phục** `POST /crm/customer-restorations` `{ customerId, reason? }` → 201 `{ data: CustomerDetail }` (không đổi); 409 `CUSTOMER_ANONYMIZED` với khách đã ẩn danh; **409 `CUSTOMER_PURGE_IN_PROGRESS`** nếu khách đang xóa vĩnh viễn (dở). `POST /crm/customer-anonymizations` cũng trả 409 `CUSTOMER_PURGE_IN_PROGRESS` trong trường hợp này.

**6. Xóa vĩnh viễn** `DELETE /crm/deleted-customers/:id` (chỉ Admin; không body; không hoàn tác) → **200** `{ "data": { "customerId": "id", "purged": { "careLogs": n, "attachments": n, "files": n, "appointments": n, "careTeamRequests": n, "reminders": n, "notifications": n, "auditLogs": n } } }` (`files` = số file MinIO đã xóa; có thể dùng để hiện thông báo). Lỗi: 400 id sai; 403 không phải Admin; 404 `CUSTOMER_NOT_FOUND`; **409 `CUSTOMER_NOT_DELETED`** (khách chưa xóa mềm); **409 `CUSTOMER_PURGE_IN_PROGRESS`** (đang có một lần xóa vĩnh viễn khác chạy cùng lúc, thử lại sau ít giây); **503 `SERVICE_UNAVAILABLE`** (không xóa được file ở kho lưu trữ hoặc kho chưa cấu hình: **CHƯA xóa gì ở DB**, khách ở trạng thái "đang xóa dở" `purgeInProgress=true`, FE cho phép bấm thử lại ngay). Sau khi xóa, SĐT dùng lại được; khách không còn trong danh sách đã xóa; khôi phục/xóa lại trả 404.

**Mã lỗi mới:** `CUSTOMER_NOT_DROPPED` (409), `CUSTOMER_NOT_DELETED` (409), `CUSTOMER_PURGE_IN_PROGRESS` (409). **Action audit mới:** `CUSTOMER_PURGED`.

**Thiết kế xóa vĩnh viễn (quyết định của coder BE):**
- Thứ tự an toàn: (1) **đặt cờ `customers.purgingAt` nguyên tử** bằng một `updateOne` có điều kiện (khách tồn tại, đã xóa mềm, `purgingAt` rỗng hoặc cũ hơn 15 giây); từ đây khôi phục/ẩn danh hóa bị chặn (ghi của chúng có thêm điều kiện `purgingAt: null`, nên đua nhau cũng không lọt); (2) xóa **file MinIO TRƯỚC**, ngoài transaction, **song song tối đa 6 file, dừng ngay ở lỗi đầu tiên** (không gọi tiếp các ảnh chưa bắt đầu); lỗi bất kỳ thì ghi log có cấu trúc (`customerId`, bước lỗi, số file đã xóa), dừng 503 và chưa động tới DB (file đã xóa được đánh dấu `purgedAt` nên lần thử lại bỏ qua; xóa object idempotent); lỗi thì cờ được lùi về quá 15 giây để **thử lại ngay** được nhưng vẫn khác rỗng (khách vẫn "đang xóa dở", vẫn không khôi phục được); (3) **một transaction** xóa nhật ký, ảnh, lịch hẹn, yêu cầu nhóm chăm sóc, nhắc, thông báo (`data.customerId`), **mọi audit cũ của khách** (chứa tên/SĐT/email/lý do), trả lại `usageCount` của thẻ, xóa chính khách và ghi **đúng một dòng audit `CUSTOMER_PURGED`** (`customerId` + người làm + số lượng đã xóa trong `changes`; **không** nhận lý do tự do, không SĐT/tên/email). Nhờ file xóa trước nên không bao giờ có file mồ côi mà DB không còn dấu vết để dọn.
- Cờ `purgingAt` (Date, tùy chọn, **không index** vì chỉ đọc/ghi theo `_id`, **không cần migration**): **không hết hạn**; giá trị chỉ là mốc để chặn hai lần xóa vĩnh viễn chạy đồng thời (hai lần đặt cách nhau dưới 15 giây thì lần sau 409). Khách "đang xóa dở" chỉ thoát bằng xóa vĩnh viễn xong.
- SĐT: `phone` nằm trên bản ghi khách (unique index `phone`), không có bảng giữ chỗ riêng, nên xóa khách là giải phóng SĐT.
- Các collection có tham chiếu `customerId` đã quét: `care_logs`, `crm_attachments`, `appointments`, `care_team_requests`, `reminders`, `crm_audit_logs`, và `notifications` (`data.customerId`); thêm `tags.usageCount`.

#### 7.5 Dữ liệu & migration
Không có migration. Xóa vĩnh viễn là thao tác dữ liệu có transaction + dọn file MinIO (bước dọn file nằm ngoài transaction: đã thiết kế ở 7.4). Chỉ thêm field tùy chọn `customers.purgingAt` (tương thích ngược).

#### 7.6 Giao diện
- Option **"Xóa"** trong select "Hành động hàng loạt" (`BulkActionBar.tsx`) **chỉ hiện khi mọi khách đang chọn thuộc nhóm "Bỏ" và người dùng có quyền xóa**.
- Khi chọn option này thì hiện nút **"Xóa"** → hộp xác nhận có **ô lý do** (bắt buộc).
- Sau khi xóa: giữ ngữ cảnh danh sách đang xem, hiện thông báo kết quả theo từng khách (thành công/thất bại và lý do).
- Màn **"Khách đã xóa"** cho Admin: danh sách, nút **Khôi phục**, nút **Xóa vĩnh viễn** kèm xác nhận rõ ràng (nêu rằng không hoàn tác, nêu dữ liệu sẽ mất).

#### 7.7 Ảnh hưởng tài liệu khác
- `05_…` §2.3 (khách hàng) và nhóm thao tác hàng loạt; `04_…` §4.2 (ma trận quyền xóa). Chỉ thêm dòng trỏ.

#### 7.8 Kiểm thử / nghiệm thu
- Ma trận quyền xóa: Admin/Manager/STAFF × khách "Bỏ"/không "Bỏ" × trong/ngoài phạm vi × là/không là người phụ trách chính. Case biên bắt buộc: STAFF là người phụ trách chính nhưng **không** phải người nhập → xóa được; STAFF chỉ là thành viên `careTeam` (không phải người phụ trách chính) → bị từ chối; Manager chỉ có mặt trong `careTeam` của khách (khách không thuộc nhóm mình quản lý) → bị từ chối; Manager với khách thuộc nhóm mình quản lý → xóa được.
- Tài khoản nhiều role: MANAGER+STAFF phụ trách chính khách nhóm khác → bị từ chối; ADMIN+STAFF → xóa được mọi khách; STAFF+EDITOR → giữ quyền STAFF.
- Xóa hàng loạt: một khách lỗi quyền không làm hỏng các khách còn lại; kết quả từng khách đúng; trên 200 khách bị từ chối; thiếu hẳn `payload` → 400 (không 500); `reason` chỉ gồm ký tự vô hình → 400.
- Xóa mềm: hủy nhắc, ghi audit `CUSTOMER_DELETED`, SĐT vẫn bị giữ.
- Xóa vĩnh viễn: chỉ ADMIN; chỉ khách đã xóa mềm; dữ liệu con và file MinIO bị xóa; còn đúng một dòng audit không PII; SĐT dùng lại được; MinIO lỗi → 503 và dừng sớm, DB chưa đổi, thử lại hoàn tất; trong lúc purge chạy (hoặc sau 503) khôi phục/ẩn danh hóa/purge thứ hai → 409 `CUSTOMER_PURGE_IN_PROGRESS`, `purgeInProgress=true` trong danh sách.
- FE: option "Xóa" chỉ hiện khi mọi khách chọn thuộc "Bỏ" và có quyền; hộp xác nhận bắt buộc lý do; màn "Khách đã xóa" khôi phục/xóa vĩnh viễn đúng.

#### 7.9 Rủi ro / điều chưa kiểm chứng
- Xóa vĩnh viễn không hoàn tác: cần xác nhận hai bước ở FE và audit rõ ràng.
- (Đã xử lý 2026-10-30) Dọn file MinIO lỗi giữa chừng: xóa file trước, dừng sớm, 503, thử lại idempotent. Rủi ro còn lại: lỗi giữa bước xóa file và transaction DB để khách ở trạng thái "đang xóa dở" cho tới khi Admin bấm xóa vĩnh viễn lại (cố ý, để không khôi phục được khách đã mất file).
- (Đã đóng 2026-10-30) Khôi phục xen vào lúc xóa vĩnh viễn: chặn bằng cờ `purgingAt`.
- (Đã đóng 2026-10-29) Điều kiện STAFF: chỉ cần là **người phụ trách chính hiện tại**, không cần là người nhập khách.
- (Đã đóng 2026-10-29) Phạm vi xóa của Manager: chỉ nhóm mình quản lý; có mặt trong `careTeam` thôi thì không đủ. Rủi ro còn lại: điều kiện xóa của Manager khác scope xem của họ, dễ bị coder dùng lẫn `buildCustomerScope`; QA phải có test riêng.

---

### 8. Kế hoạch triển khai v1.0.3

#### 8.1 Thứ tự và phụ thuộc

| Đợt | Hạng mục | Chạy | Phụ thuộc |
|---|---|---|---|
| **Đợt 1** | A (BE) và B (BE + FE) | **Song song** (độc lập nhau) | Không |
| **Đợt 2** | C và D | C và D chạy song song được sau khi Đợt 1 xong | C phụ thuộc A (`teamIds[]`, API `/users/:id/teams`); D phụ thuộc A (role/scope nhiều role) và quyền hiện có của CRM |

#### 8.2 Tiến độ từng đợt
1. **Đợt 1** (code xong): `coder-backend-agent` làm A và B-BE, `coder-frontend-agent` làm B-FE; mỗi coder viết unit test cho code mình viết.
2. **QA review Đợt 1:** `qa-agent` review code và test (bắt tautology, thiếu case biên), viết integration test, kiểm tra các đường ghi `role`/`teamId` suy ra, chạy toàn bộ test hiện có. **Trạng thái: QA lần 2 đạt** (code ở commit nháp `d972538` + vài file chưa commit); chờ Cổng 1/2.
3. **Đợt 2** (C và D-BE đã code, D-FE chưa; route xóa vĩnh viễn đã chốt ở mục 7.4): `architect-agent` chốt tên route xóa vĩnh viễn và hợp đồng xóa hàng loạt; `coder-backend-agent` đề xuất thiết kế nguồn bộ lọc người phụ trách (mục 6.10) và siết điều kiện xóa của MANAGER; `coder-backend-agent` và `coder-frontend-agent` làm C và D.
4. **QA review Đợt 2:** như Đợt 1, thêm kiểm thử giao diện tự động (thiếu chức năng, mất ngữ cảnh, điều hướng sau lưu) theo tài liệu 07/08 cùng thư mục.
5. Cập nhật tài liệu 04/05/Auth nếu cần thêm chi tiết và đổi trạng thái trong mục lục phiên bản sau mỗi đợt.

#### 8.3 Cổng "Oniichan duyệt"
- **Cổng 1 (hiện tại):** Oniichan đọc tài liệu này và đồng ý → mới được commit code Đợt 1 và chạy migration lên dev.
- **Cổng 2:** QA Đợt 1 đã đạt; khi Oniichan đồng ý → chạy migration 005 và 006 lên dev (mục 8.4); bắt đầu Đợt 2.
- **Cổng 3:** sau QA Đợt 2 đạt và Oniichan đồng ý → đóng phiên bản (cập nhật trạng thái "Xong").

#### 8.4 Chạy migration lên DB dev (sau QA đạt và được duyệt)
1. **Backup:** `mongodump` toàn bộ DB dev ra thư mục có ngày, ghi lại đường dẫn. Không dọn bản dump cho tới khi đối chiếu xong.
2. **Dry-run:** chạy từng script ở chế độ dry-run (005 rồi 006), lưu số liệu in ra. 005: không cờ là dry-run (xem thêm `driftBefore`); 006: `--dry-run` (cũng là mặc định). **Dừng và điều tra nếu `driftBefore` > 0.**
3. **Chạy thật:** `--apply` cho 005 trước, rồi `--apply` cho 006. Không thêm `--reconcile` trừ khi dry-run báo lệch và mọi pod cũ đã tắt (mục 4.5).
4. **Đối chiếu:** số user có `roles`/`teamIds` đúng so với `role`/`teamId` cũ; số khách/dự án bị đặt `areaId = null` và số khu vực bị xóa khớp dry-run; đúng 34 tỉnh; `version` khách/dự án không đổi; chạy lại script lần hai không đổi gì (idempotent).
5. **Khôi phục (nếu sai):** `mongorestore` từ bản dump ở bước 1.

#### 8.5 Thứ tự triển khai container (guard khởi động)
`mongodump` → `005 --dry-run` → `005 --apply` → (006 theo mục 8.4) → **mới** khởi động/triển khai container code mới. `docker-compose.yml` đặt `NODE_ENV=production`; `UserRolesMigrationGuard` từ chối khởi động nếu còn user thiếu `roles`/`teamIds`, nên chạy container trước migration 005 sẽ **crash-loop**. Staging/dev chỉ cảnh báo trong log; `NODE_ENV=test` bỏ qua.

---

### 9. Giả định cần xác nhận (Neptune tự chọn mặc định)

| # | Giả định | Hậu quả nếu sai |
|---|---|---|
| 1 | Chỉ **Admin** được thêm/gỡ thành viên nhóm (xem danh sách: Admin mọi nhóm, Manager nhóm mình quản lý, đã chốt có chủ ý ở mục 6.4) | Mở thêm quyền thêm/gỡ cho Manager (nhóm mình quản lý): đổi guard + kiểm phạm vi |
| 2 | Xóa mềm **giữ chỗ SĐT**; xóa vĩnh viễn **giải phóng SĐT** | Đổi quy tắc unique SĐT nếu muốn giải phóng sớm hơn |
| 3 | Mục **"Nước ngoài"** bị bỏ khỏi khu vực (chỉ 34 mục) | Thêm lại một mục khu vực "Nước ngoài" ngoài 34 tỉnh vào seed và script |
| 4 | **Token cũ** còn hiệu lực ≤ 15 phút vẫn chạy nhờ fallback `role` | Nếu cần có hiệu lực ngay phải thu hồi phiên |
| 5 | `adminCode` của khu vực **để trống** nếu không chắc | Điền sau khi có bảng mã chính thức |

### 10. Điều còn mở (cần Oniichan trả lời)
- Có cần giữ mục "Nước ngoài" không (giả định 3)?
- Nguồn bộ lọc người phụ trách (mục 6.10): đã code chỉ áp cho Manager, Admin/STAFF giữ nguồn cũ; cần Oniichan xác nhận nếu muốn đổi. Nếu số khách vượt khoảng 100.000 thì cần hỏi Oniichan về cache.
- Guard khởi động migration 005 (mục 4.5) ở staging chỉ cảnh báo, không chặn: có chấp nhận không, hay staging cũng cần fail-fast?
- Thứ tự 404 trước 403 của `GET /teams/:id/members` (mức nhẹ): có cần đảo lại không?
- Khách import với khu vực không khớp: có cần báo cáo/đánh dấu để bổ sung khu vực sau không (hiện chỉ cảnh báo lúc import)?

**Đã đóng 2026-10-30:** (1) xóa vĩnh viễn xóa sạch audit cũ, chỉ giữ một dòng `CUSTOMER_PURGED`; (2) tài khoản MANAGER+STAFF coi như Manager, không xóa khách nhóm khác dù là phụ trách chính (khóa bằng test đa role); (3) không khôi phục khi xóa vĩnh viễn đã bắt đầu (`purgingAt`, 409 `CUSTOMER_PURGE_IN_PROGRESS`, `purgeInProgress` ở danh sách khách đã xóa).

**Đã đóng 2026-10-29:** điều kiện xóa của STAFF (người phụ trách chính, không cần là người nhập); Manager xóa khách chỉ có mặt trong `careTeam` (không được, chỉ nhóm mình quản lý).
