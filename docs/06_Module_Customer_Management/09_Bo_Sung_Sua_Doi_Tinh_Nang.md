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
| [v1.0.3](#v103-2026-10-29) | 2026-10-29 | 4 sửa đổi: (A) nhiều role + nhiều nhóm cho một tài khoản; (B) khu vực theo 34 tỉnh thành; (C) thêm/gỡ/xem thành viên nhóm; (D) xóa, khôi phục, xóa vĩnh viễn khách "Bỏ" | Kế hoạch – đang triển khai Đợt 1 |

---

## v1.0.3 (2026-10-29)

### 1. Tổng quan

| Mã | Sửa đổi | Đợt | Phạm vi | Trạng thái |
|---|---|---|---|---|
| A | Một tài khoản có **nhiều role** và **nhiều nhóm** (giữ `role`/`teamId` làm trường suy ra) | 1 | BE (giao diện chọn nhiều role/nhóm làm cùng mục C ở Đợt 2) | Kế hoạch – đang triển khai Đợt 1 |
| B | Khu vực dùng **34 tỉnh thành** (hiệu lực 01/07/2025); xóa hẳn khu vực cũ | 1 | BE + FE | Kế hoạch – đang triển khai Đợt 1 |
| C | Màn quản lý nhóm: **xem danh sách, thêm, gỡ thành viên** | 2 | BE + FE | Kế hoạch – đang triển khai Đợt 1 |
| D | **Xóa** khách "Bỏ" (đơn và hàng loạt), **khôi phục**, **xóa vĩnh viễn** | 2 | BE + FE | Kế hoạch – đang triển khai Đợt 1 |

**Trạng thái thực tế tại thời điểm viết (2026-10-29):** Đợt 1 đang được code song song (A, B-BE, B-FE) nhưng **chưa QA, chưa commit, chưa chạy migration lên dev**. Đợt 2 (C, D) chưa bắt đầu.

**Cổng bắt buộc:** **không commit và không chạy migration lên DB dev** cho tới khi Oniichan đọc tài liệu này và đồng ý.

### 2. Quyết định của Oniichan (đã chốt)

1. Màn quản lý nhóm chưa có thêm/gỡ thành viên và chưa hiện danh sách thành viên → **bổ sung**.
2. Một tài khoản được có **nhiều role** và **nhiều nhóm**. Nhiều role: quyền lấy theo **role cao nhất trong cùng phân vùng CRM** (`ADMIN` > `MANAGER` > `STAFF`). `STAFF` và `EDITOR` thuộc 2 phân vùng khác nhau nên **ngang quyền**: cả hai cùng có hiệu lực (hợp quyền).
3. Khách chuyển sang trạng thái "Bỏ" (nhóm danh sách `DROPPED`) thì ở select "Hành động hàng loạt" hiện thêm option **"Xóa"**, và hiện thêm một nút **Xóa**. Quyền: **Admin** xóa được tất cả; **Manager** xóa được mọi khách "Bỏ" trong phạm vi dữ liệu phòng kinh doanh (nhóm mình quản lý); **STAFF** chỉ xóa được khách mình là **người phụ trách chính** (cũng là người nhập khách). Xóa là **xóa mềm**; **Admin khôi phục được** và **xóa vĩnh viễn được**.
4. Dữ liệu khu vực dùng **danh sách 34 tỉnh thành Việt Nam** (hiệu lực 01/07/2025, Nghị quyết 202/2025/QH15). Dữ liệu khu vực cũ **xóa hẳn**: không giữ, không chuyển, không hiển thị nhãn "(khu vực cũ)"; khách/dự án trỏ khu vực cũ thì `areaId = null` (không hiển thị). Đã đồng ý chạy script lên DB dev **sau khi QA đạt**, có `mongodump` trước và `--dry-run`.

### 3. Hiện trạng (kết quả khảo sát trước khi sửa)

| Chủ đề | Hiện trạng |
|---|---|
| Nhóm | Thành viên chỉ lưu ở `User.teamId` (đơn); `Team.managerIds[]` là quản lý; `customers.teamIds[]` là bản denormalize (hợp `teamId` của thành viên `careTeam`, `customer-team-sync.service.ts`). Chưa có route thêm/gỡ thành viên hay `GET /teams/:id/members`; gán nhóm qua `PATCH /users/:id/team` (`TeamsService.assignUserToTeam`: tăng `team.revision`, audit `USER_TEAM_CHANGED`). FE: `modules/crm/screens/Settings/components/TeamsSection.tsx` (danh sách nhóm, `memberCount`, không có UI thành viên); gán nhóm ở `UsersSection.tsx` |
| Role/nhóm đơn | `role`, `teamId` dùng ở khoảng 60 file code và 60+ file test. JWT `{ sub, email, role }`; `RolesGuard` đọc `user.role`; CRM đọc lại role/nhóm từ DB mỗi request qua `CrmActorService`; scope khách (`buildCustomerScope`): ADMIN tất cả, MANAGER = `teamIds` ∈ `managedTeamIds` hoặc `careTeam.userId` = mình, STAFF = `careTeam.userId` = mình |
| Xóa khách | BE đã có `DELETE /crm/customers/:id?reason=` (ADMIN + MANAGER, lý do bắt buộc, xóa mềm, hủy nhắc, audit `CUSTOMER_DELETED`; MANAGER chỉ trong scope); Admin có `GET /crm/deleted-customers`, `POST /crm/customer-restorations`, `POST /crm/customer-anonymizations`. Thao tác hàng loạt (`POST /crm/customer-bulk-operations`, tối đa 200, mỗi khách một transaction) **chưa có** `DELETE`. FE `BulkActionBar.tsx` có option Đổi tình trạng / Gắn thẻ / Thêm người chăm sóc / Xuất CSV, **chưa có Xóa**; FE chưa gọi API xóa/khôi phục nào. "Bỏ" = `customer_statuses` code `DROPPED` thuộc `listGroup` `DROPPED` (nhận diện theo `listGroup`). SĐT unique toàn hệ thống kể cả khách xóa mềm |
| Khu vực | Collection `areas` dạng cây (`COUNTRY`/`PROVINCE`/`DISTRICT`/`WARD`/`OTHER`; có sẵn `isLegacy`, `adminCode`), `Customer.areaId`, `Project.areaId`; seed cũ 4 tỉnh + vài quận + "Nước ngoài"; FE select đơn + lọc `areaIds` (mở rộng theo `ancestorIds`) |

---

### 4. Sửa đổi A — Nhiều role và nhiều nhóm cho một tài khoản (Đợt 1, BE)

**Trạng thái:** Kế hoạch – đang triển khai Đợt 1 (code BE chạy song song, chưa QA).

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
6. **Chỉ user có role `MANAGER` hoặc `STAFF` mới có nhóm.** Khi bỏ role `MANAGER` của một người thì **gỡ họ khỏi `managerIds`** của các nhóm.
7. **JWT** thêm claim `roles`. Audit `actorRole` **giữ một giá trị** (role cao nhất).

#### 4.4 API thay đổi (tương thích ngược)

| Method | Path | Thay đổi |
|---|---|---|
| POST | `/users` | Nhận `roles[]` **hoặc** `role` đơn (cũ). Có thể kèm `teamIds[]`/`teamId` |
| PATCH | `/users/:id/role` | **Giữ** body `{ role }` (đặt đúng một role) |
| PATCH | `/users/:id/roles` | **Mới.** Body `{ roles[] }`; ADMIN; audit đổi role; chặn gỡ ADMIN cuối cùng (như quy tắc hiện có) |
| PATCH | `/users/:id/team` | **Giữ** body `{ teamId \| null }` |
| PATCH | `/users/:id/teams` | **Mới.** Body `{ teamIds[] }`; ADMIN; tăng `revision` các nhóm bị ảnh hưởng; audit `USER_TEAM_CHANGED`; đồng bộ `customers.teamIds` |
| GET | `/users`, `GET /auth/me`, response đăng nhập | Response **thêm** `roles`, `teamIds` (vẫn giữ `role`, `teamId`) |

#### 4.5 Dữ liệu & migration
- Migration `RealEstateBackendApp/scripts/migrations/005_users_roles_teamids.ts`, **idempotent**: `roles = [role]`; `teamIds = teamId ? [teamId] : []` (chỉ ghi cho bản ghi chưa có `roles`).
- Thêm index multikey `{ teamIds: 1, status: 1 }` trên `users`.
- Không đổi/xóa field nào đang có.

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
- Migration 005 chạy hai lần cho cùng kết quả; đối chiếu số user trước/sau.
- Toàn bộ test hiện có vẫn xanh (không sửa hàng loạt).

#### 4.9 Rủi ro / điều chưa kiểm chứng
- Hai trường `role` và `teamId` suy ra có thể lệch với `roles[]`/`teamIds[]` nếu có đường ghi bỏ qua service: mọi ghi phải đi qua một hàm đồng bộ duy nhất; QA kiểm tra các đường ghi.
- Token cũ còn hiệu lực tối đa 15 phút vẫn chạy nhờ fallback `role` (giả định 4).
- Các route ngoài CRM còn tin role trong JWT (đã ghi ở milestone M1) nên role mới có hiệu lực tối đa sau thời hạn token.

---

### 5. Sửa đổi B — Khu vực theo 34 tỉnh thành (Đợt 1, BE + FE)

**Trạng thái:** Kế hoạch – đang triển khai Đợt 1 (code BE và FE chạy song song, chưa QA).

#### 5.1 Bối cảnh / vấn đề
Seed khu vực cũ chỉ có 4 tỉnh, vài quận và mục "Nước ngoài", không theo đơn vị hành chính hiện hành. Từ 01/07/2025 cả nước có 34 tỉnh thành (Nghị quyết 202/2025/QH15).

#### 5.2 Quyết định nghiệp vụ (của Oniichan)
Xem mục 2, điểm 4: dùng 34 tỉnh thành; khu vực cũ xóa hẳn, không giữ, không chuyển, không nhãn "(khu vực cũ)"; khách/dự án trỏ khu vực cũ thì `areaId = null`; chạy script lên DB dev sau khi QA đạt, có `mongodump` + dry-run.

#### 5.3 Thiết kế / quy tắc
1. **Danh sách 34 mục** (type `PROVINCE`, **phẳng**, không có cấp quận/phường): Hà Nội, Huế, Lai Châu, Điện Biên, Sơn La, Lạng Sơn, Quảng Ninh, Thanh Hóa, Nghệ An, Hà Tĩnh, Cao Bằng, Tuyên Quang, Lào Cai, Thái Nguyên, Phú Thọ, Bắc Ninh, Hưng Yên, Hải Phòng, Ninh Bình, Quảng Trị, Đà Nẵng, Quảng Ngãi, Gia Lai, Khánh Hòa, Lâm Đồng, Đắk Lắk, TP. Hồ Chí Minh, Đồng Nai, Tây Ninh, Cần Thơ, Vĩnh Long, Đồng Tháp, Cà Mau, An Giang.
2. Mục "Nước ngoài" của seed cũ **bị bỏ** (điểm đã báo Oniichan, chờ xác nhận nếu cần giữ — xem mục 9 và 10).
3. `adminCode` **chỉ điền khi chắc chắn**, nếu không thì để trống (giả định 5).
4. Seed mới upsert theo `seedKey`; seed cũ không còn tạo khu vực quận/"Nước ngoài".
5. FE: mapper chỉ hiện **tên tỉnh**; khách/dự án không có khu vực thì **không hiển thị gì** (không nhãn, không dấu gạch).

#### 5.4 API thay đổi
Không đổi hợp đồng API. Dữ liệu trả về của `GET /crm/areas` (và các response có `area`) chỉ còn 34 mục phẳng; `areaId` có thể `null`. Lọc `areaIds` vẫn chạy (cây một cấp nên mở rộng `ancestorIds` không tạo thêm kết quả).

#### 5.5 Dữ liệu & migration
Script `RealEstateBackendApp/scripts/migrations/006_areas_34_provinces.ts`, có cờ `--dry-run`:
1. Đặt `areaId = null` cho `customers` và `projects` đang trỏ khu vực **không thuộc 34 tỉnh**.
2. **Xóa** các khu vực cũ (không thuộc 34 tỉnh).
3. **Upsert 34 tỉnh** theo `seedKey`.
4. **Idempotent**; **không ghi audit, không tăng `version`** hàng loạt trên khách/dự án.
5. Dry-run chỉ in số liệu (số khách/dự án bị đặt `null`, số khu vực xóa, số tỉnh upsert), không ghi DB.

Hệ quả: dữ liệu khu vực cũ **mất vĩnh viễn** sau khi chạy thật; cơ sở khôi phục duy nhất là bản `mongodump` làm trước đó.

#### 5.6 Giao diện
- Ô chọn khu vực có **tìm kiếm không dấu** ("ha noi" khớp "Hà Nội").
- Mapper chỉ hiện tên tỉnh; khách không có khu vực không hiển thị gì.
- Cập nhật dữ liệu mock/seed FE (`mockData.ts`, `seedCatalogs.ts`) và import khách (khớp **tên 34 tỉnh**; tên không khớp thì bỏ trống khu vực).

#### 5.7 Ảnh hưởng tài liệu khác
- `04_…` §3.3 (danh mục) và phần seed khu vực; `05_…` §2.8 (danh mục & dự án). Chỉ thêm dòng trỏ, không viết lại.

#### 5.8 Kiểm thử / nghiệm thu
- Seed tạo đúng 34 tỉnh, `type = PROVINCE`, không còn mục nào khác; chạy lặp không tạo trùng.
- Migration 006: dry-run không ghi DB; chạy thật đặt `areaId = null` đúng bản ghi, xóa khu vực cũ, giữ nguyên `version`/audit; chạy lần hai không đổi gì.
- FE: gõ không dấu ra đúng tỉnh; khách `areaId = null` không hiện gì; import khớp tên tỉnh.
- Đối chiếu số liệu trước/sau trên dev (mục 8.4).

#### 5.9 Rủi ro / điều chưa kiểm chứng
- Mất dữ liệu khu vực cũ là chủ ý nhưng không hoàn tác ngoài `mongodump`.
- Mã `adminCode` chính thức chưa kiểm chứng nên để trống.
- Khách ở nước ngoài mất thông tin khu vực (xem giả định 3).
- Có thể còn chỗ khác trong code dựa vào khu vực dạng quận/`ancestorIds`; QA tìm các chỗ này.

---

### 6. Sửa đổi C — Thành viên nhóm: xem, thêm, gỡ (Đợt 2, BE + FE)

**Trạng thái:** Kế hoạch – đang triển khai Đợt 1 (chưa bắt đầu code; sẽ làm ở Đợt 2 sau khi A xong).

#### 6.1 Bối cảnh / vấn đề
Màn quản lý nhóm (`TeamsSection.tsx`) chỉ có danh sách nhóm và `memberCount`; không xem được ai là thành viên, không thêm/gỡ được. Muốn đổi thành viên phải vào từng tài khoản (`UsersSection.tsx`).

#### 6.2 Quyết định nghiệp vụ (của Oniichan)
Xem mục 2, điểm 1 và 2: bổ sung xem/thêm/gỡ thành viên; một người ở nhiều nhóm.

#### 6.3 Thiết kế / quy tắc
- Quyền mặc định **chỉ ADMIN** (giống tạo/sửa nhóm; giả định 1).
- Dùng lại `TeamsService.addUserToTeam` / `removeUserFromTeam` (đã có transaction, tăng `revision`, audit, đồng bộ `customers.teamIds`), làm việc trên `teamIds[]` của sửa đổi A.
- Chỉ user có role `MANAGER`/`STAFF` mới thêm được vào nhóm (quy tắc A).
- Một người có thể thuộc nhiều nhóm.

#### 6.4 API thay đổi

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/teams/:id/members` | **Mới.** Danh sách thành viên của nhóm | A |
| POST | `/teams/:id/members` | **Mới.** Thêm thành viên, body `{ userId }` | A |
| DELETE | `/teams/:id/members/:userId` | **Mới.** Gỡ thành viên | A |

#### 6.5 Dữ liệu & migration
Không có migration riêng; dựa vào `teamIds[]` và migration 005 của sửa đổi A.

#### 6.6 Giao diện
- `TeamsSection.tsx`: hiện danh sách thành viên của nhóm, nút **Thêm thành viên**, nút **Gỡ** từng người.
- `UsersSection.tsx` và `UserManagementScreen`: chọn **nhiều role** và **nhiều nhóm** (hoàn tất giao diện của sửa đổi A).
- Sau khi lưu thêm/gỡ thì ở lại màn nhóm và cập nhật danh sách + `memberCount` (không văng ra màn khác, không mất ngữ cảnh).

#### 6.7 Ảnh hưởng tài liệu khác
- `05_…` §2.2 (thêm 3 route); `04_…` §4.2 (ma trận quyền: nhóm). Chỉ thêm dòng trỏ.

#### 6.8 Kiểm thử / nghiệm thu
- Chỉ ADMIN gọi được 3 route; vai khác nhận 403.
- Thêm thành viên → `customers.teamIds` của các khách mà người đó chăm sóc được cập nhật; gỡ thì ngược lại; `revision` nhóm tăng; có audit.
- Thêm user không có role `MANAGER`/`STAFF` bị từ chối; thêm trùng không tạo bản ghi trùng.
- FE: danh sách thành viên đúng, thêm/gỡ cập nhật ngay, lỗi hiện rõ.

#### 6.9 Rủi ro / điều chưa kiểm chứng
- Gỡ thành viên đang là người chăm sóc của khách: khách vẫn nằm trong `careTeam` nhưng `customers.teamIds` đổi; cần QA kiểm tra scope của khách đó.
- Quyền "chỉ Admin" là giả định (mục 9).

---

### 7. Sửa đổi D — Xóa, khôi phục, xóa vĩnh viễn khách "Bỏ" (Đợt 2, BE + FE)

**Trạng thái:** Kế hoạch – đang triển khai Đợt 1 (chưa bắt đầu code; sẽ làm ở Đợt 2).

#### 7.1 Bối cảnh / vấn đề
BE đã có xóa mềm đơn và các route khôi phục/ẩn danh hóa cho Admin, nhưng thao tác hàng loạt chưa có xóa, FE chưa có nút xóa hay màn khách đã xóa, và chưa có cách xóa hẳn khách (SĐT vẫn bị giữ chỗ sau khi xóa mềm).

#### 7.2 Quyết định nghiệp vụ (của Oniichan)
Xem mục 2, điểm 3. Tóm tắt phân quyền xóa:

| Vai | Xóa được |
|---|---|
| Admin | Tất cả khách "Bỏ" |
| Manager | Mọi khách "Bỏ" trong phạm vi dữ liệu phòng kinh doanh (nhóm mình quản lý) |
| STAFF | Chỉ khách "Bỏ" mình là người phụ trách chính (cũng là người nhập khách) |

Xóa là **xóa mềm**; **Admin khôi phục** và **xóa vĩnh viễn**.

#### 7.3 Thiết kế / quy tắc
1. **Xóa hàng loạt:** thêm `DELETE` vào `BulkOperationType`. Chỉ áp dụng cho khách thuộc nhóm "Bỏ" (theo `listGroup = DROPPED`); kiểm quyền **từng khách**; **một lý do chung**; tối đa 200 khách; kết quả theo từng khách (thành công/thất bại + mã lỗi); mỗi khách một transaction như các thao tác hàng loạt khác.
2. **Xóa đơn:** `DELETE /crm/customers/:id` **giữ** cho ADMIN/MANAGER trong scope; **mở thêm cho STAFF** với khách mình phụ trách chính (đồng thời là người nhập khách) và **chỉ khi khách thuộc nhóm "Bỏ"**.
3. **Xóa vĩnh viễn:** route mới **chỉ ADMIN**, chỉ với khách **đã xóa mềm**, **không hoàn tác**. Xóa cả nhật ký chăm sóc, ảnh đính kèm (kể cả file MinIO), lịch hẹn, yêu cầu nhóm chăm sóc, nhắc. Giữ **một dòng audit "đã xóa vĩnh viễn" không kèm PII**. **Giải phóng SĐT** (xóa mềm vẫn giữ chỗ; giả định 2).
4. "Ẩn danh hóa" hiện có **giữ nguyên**.
5. Khôi phục dùng route hiện có `POST /crm/customer-restorations`.

#### 7.4 API thay đổi

| Method | Path | Thay đổi | Quyền |
|---|---|---|---|
| POST | `/crm/customer-bulk-operations` | Thêm `type = DELETE`, body có `reason`; kết quả từng khách | A, M, S (kiểm từng khách) |
| DELETE | `/crm/customers/:id?reason=` | Mở thêm cho STAFF (khách "Bỏ", mình là người phụ trách chính + người nhập) | A, M (trong scope), S (điều kiện trên) |
| *(route mới, tên do `architect-agent` chốt)* | Xóa vĩnh viễn khách đã xóa mềm | **Mới.** Không hoàn tác | A |
| GET | `/crm/deleted-customers` | Dùng lại cho màn "Khách đã xóa" | A |
| POST | `/crm/customer-restorations` | Dùng lại cho nút Khôi phục | A |

Tên/đường dẫn route xóa vĩnh viễn **chưa chốt** ở bản này; sẽ do `architect-agent` quyết định theo quy ước REST của module.

#### 7.5 Dữ liệu & migration
Không có migration. Xóa vĩnh viễn là thao tác dữ liệu có transaction + dọn file MinIO (bước dọn file nằm ngoài transaction: cần thiết kế thử lại/ghi nhận lỗi).

#### 7.6 Giao diện
- Option **"Xóa"** trong select "Hành động hàng loạt" (`BulkActionBar.tsx`) **chỉ hiện khi mọi khách đang chọn thuộc nhóm "Bỏ" và người dùng có quyền xóa**.
- Khi chọn option này thì hiện nút **"Xóa"** → hộp xác nhận có **ô lý do** (bắt buộc).
- Sau khi xóa: giữ ngữ cảnh danh sách đang xem, hiện thông báo kết quả theo từng khách (thành công/thất bại và lý do).
- Màn **"Khách đã xóa"** cho Admin: danh sách, nút **Khôi phục**, nút **Xóa vĩnh viễn** kèm xác nhận rõ ràng (nêu rằng không hoàn tác, nêu dữ liệu sẽ mất).

#### 7.7 Ảnh hưởng tài liệu khác
- `05_…` §2.3 (khách hàng) và nhóm thao tác hàng loạt; `04_…` §4.2 (ma trận quyền xóa). Chỉ thêm dòng trỏ.

#### 7.8 Kiểm thử / nghiệm thu
- Ma trận quyền xóa: Admin/Manager/STAFF × khách "Bỏ"/không "Bỏ" × trong/ngoài phạm vi × là/không là người phụ trách chính.
- Xóa hàng loạt: một khách lỗi quyền không làm hỏng các khách còn lại; kết quả từng khách đúng; trên 200 khách bị từ chối.
- Xóa mềm: hủy nhắc, ghi audit `CUSTOMER_DELETED`, SĐT vẫn bị giữ.
- Xóa vĩnh viễn: chỉ ADMIN; chỉ khách đã xóa mềm; dữ liệu con và file MinIO bị xóa; còn đúng một dòng audit không PII; SĐT dùng lại được.
- FE: option "Xóa" chỉ hiện khi mọi khách chọn thuộc "Bỏ" và có quyền; hộp xác nhận bắt buộc lý do; màn "Khách đã xóa" khôi phục/xóa vĩnh viễn đúng.

#### 7.9 Rủi ro / điều chưa kiểm chứng
- Xóa vĩnh viễn không hoàn tác: cần xác nhận hai bước ở FE và audit rõ ràng.
- Dọn file MinIO có thể lỗi giữa chừng; cần cơ chế thử lại hoặc báo lỗi.
- "Người phụ trách chính (cũng là người nhập khách)": nếu hai người này khác nhau (ví dụ đã đổi người phụ trách) thì điều kiện của STAFF chưa rõ; tạm hiểu là người phụ trách chính hiện tại và cần xác nhận (mục 10).
- Phạm vi "phòng kinh doanh" của Manager đang hiểu theo scope MANAGER hiện có (nhóm mình quản lý, và khách mình có trong `careTeam`); cần xác nhận có gồm trường hợp thứ hai không.

---

### 8. Kế hoạch triển khai v1.0.3

#### 8.1 Thứ tự và phụ thuộc

| Đợt | Hạng mục | Chạy | Phụ thuộc |
|---|---|---|---|
| **Đợt 1** | A (BE) và B (BE + FE) | **Song song** (độc lập nhau) | Không |
| **Đợt 2** | C và D | C và D chạy song song được sau khi Đợt 1 xong | C phụ thuộc A (`teamIds[]`, API `/users/:id/teams`); D phụ thuộc A (role/scope nhiều role) và quyền hiện có của CRM |

#### 8.2 Tiến độ từng đợt
1. **Đợt 1** (đang làm): `coder-backend-agent` làm A và B-BE, `coder-frontend-agent` làm B-FE; mỗi coder viết unit test cho code mình viết.
2. **QA review Đợt 1:** `qa-agent` review code và test (bắt tautology, thiếu case biên), viết integration test, kiểm tra các đường ghi `role`/`teamId` suy ra, chạy toàn bộ test hiện có.
3. **Đợt 2:** `architect-agent` chốt tên route xóa vĩnh viễn và hợp đồng xóa hàng loạt; `coder-backend-agent` và `coder-frontend-agent` làm C và D.
4. **QA review Đợt 2:** như Đợt 1, thêm kiểm thử giao diện tự động (thiếu chức năng, mất ngữ cảnh, điều hướng sau lưu) theo tài liệu 07/08 cùng thư mục.
5. Cập nhật tài liệu 04/05/Auth nếu cần thêm chi tiết và đổi trạng thái trong mục lục phiên bản sau mỗi đợt.

#### 8.3 Cổng "Oniichan duyệt"
- **Cổng 1 (hiện tại):** Oniichan đọc tài liệu này và đồng ý → mới được commit code Đợt 1 và chạy migration lên dev.
- **Cổng 2:** sau QA Đợt 1 đạt và Oniichan đồng ý → chạy migration 005 và 006 lên dev (mục 8.4); bắt đầu Đợt 2.
- **Cổng 3:** sau QA Đợt 2 đạt và Oniichan đồng ý → đóng phiên bản (cập nhật trạng thái "Xong").

#### 8.4 Chạy migration lên DB dev (sau QA đạt và được duyệt)
1. **Backup:** `mongodump` toàn bộ DB dev ra thư mục có ngày, ghi lại đường dẫn. Không dọn bản dump cho tới khi đối chiếu xong.
2. **Dry-run:** chạy từng script với `--dry-run` (005 rồi 006), lưu số liệu in ra.
3. **Chạy thật:** chạy 005 trước, rồi 006.
4. **Đối chiếu:** số user có `roles`/`teamIds` đúng so với `role`/`teamId` cũ; số khách/dự án bị đặt `areaId = null` và số khu vực bị xóa khớp dry-run; đúng 34 tỉnh; `version` khách/dự án không đổi; chạy lại script lần hai không đổi gì (idempotent).
5. **Khôi phục (nếu sai):** `mongorestore` từ bản dump ở bước 1.

---

### 9. Giả định cần xác nhận (Neptune tự chọn mặc định)

| # | Giả định | Hậu quả nếu sai |
|---|---|---|
| 1 | Chỉ **Admin** được thêm/gỡ thành viên nhóm | Mở thêm quyền cho Manager (nhóm mình quản lý): đổi guard + kiểm phạm vi |
| 2 | Xóa mềm **giữ chỗ SĐT**; xóa vĩnh viễn **giải phóng SĐT** | Đổi quy tắc unique SĐT nếu muốn giải phóng sớm hơn |
| 3 | Mục **"Nước ngoài"** bị bỏ khỏi khu vực (chỉ 34 mục) | Thêm lại một mục khu vực "Nước ngoài" ngoài 34 tỉnh vào seed và script |
| 4 | **Token cũ** còn hiệu lực ≤ 15 phút vẫn chạy nhờ fallback `role` | Nếu cần có hiệu lực ngay phải thu hồi phiên |
| 5 | `adminCode` của khu vực **để trống** nếu không chắc | Điền sau khi có bảng mã chính thức |

### 10. Điều còn mở (cần Oniichan trả lời)
- Có cần giữ mục "Nước ngoài" không (giả định 3)?
- Điều kiện xóa của STAFF: "người phụ trách chính" hiện tại hay "người nhập khách" ban đầu, và nếu hai người khác nhau thì sao?
- Manager xóa khách "Bỏ" mà mình chỉ là thành viên `careTeam` (không thuộc nhóm mình quản lý) có được không?
