# Danh sách API: Module Quản lý & chăm sóc khách hàng (CRM)

> **Phiên bản tài liệu:** v1.0.6

> Đi kèm [`04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) (data model mục 3, ma trận quyền mục 4.2). Mã yêu cầu (C*, X*, QT* = quy tắc mục 4) theo [`01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md`](01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md).
> **Tổng: 115 endpoint** (v1.0.5) — 10 dùng lại (Auth, Users, Health), 105 mới. v1.0.5 ("Định danh khách hàng", FR-01 đến FR-23) **xóa 6 endpoint** (`POST /crm/customers/phone-lookups`, 3 endpoint `/crm/care-team-requests`, `PUT /crm/customers/:id/care-team/primary`, `GET /crm/assignable-users`) và **thêm 2** (`GET /crm/care-team-invitees`, `GET /crm/customer-assignees`): bảng v1.0.4 ghi 118 nhưng thực tế có 119 dòng (2.3 ghi 14 mà có 15 dòng), nên 119 − 6 + 2 = **115**. ~~Tổng v1.0.4: 118 endpoint (10 dùng lại, 108 mới; thay 2 endpoint `/device-tokens` bằng 4 endpoint `/push-subscriptions`).~~ **Máy còn PWA/FE cũ phải tải lại trang sau deploy v1.0.5**: không có bản chuyển tiếp cho các endpoint đã xóa (xem 09 mục v1.0.5). Cập nhật 2026-10-22 (xem nhật ký quyết định ở 04 mục 11): ~~bỏ mã khách hàng~~ (v1.0.5 thay: có `customerCode` `KH-000123`); thêm email; `listGroup` tách 4 giá trị + tab ảo `ALL`; thêm `phone-views` (xem/gọi SĐT, ghi `PHONE_VIEWED`); thêm ảnh đính kèm nhật ký (2 endpoint); dự án có CRUD đầy đủ + khôi phục (1 endpoint mới); import 3 sheet cũ hoãn giai đoạn sau. Mọi path dưới đây đã có global prefix **`/api/v1`** (ví dụ `GET /crm/customers` = `GET /api/v1/crm/customers`). Swagger: `/api/v1/docs`.
>
> **v1.0.6 ("Phân quyền CRM", FR-30 đến FR-33): KHÔNG thêm, KHÔNG xóa endpoint (vẫn 115).** Đổi hợp đồng ở các endpoint hiện có: (1) lịch hẹn nhận `assigneeIds` (1 đến 20), response có `assignees` và vẫn giữ `assignee` (**deprecated**, bỏ ở v1.0.7), cùng cờ `canEdit`, `canDelete`; request `assigneeId` còn nhận nhưng deprecated; (2) `DELETE /crm/customers/:id` và bulk `DELETE` chỉ Quản trị hoặc người tạo khách, **không còn điều kiện khách "Bỏ"**; mã `CUSTOMER_NOT_DROPPED` đã xóa khỏi `ErrorCode`; (3) sửa, đổi trạng thái, xóa lịch hẹn và sửa/xóa nhật ký, gỡ ảnh chỉ của chính mình (Quản trị không giới hạn); (4) xem CMND/CCCD và mời/gỡ thành viên chỉ chủ khách (Quản trị, người tạo khách, Manager nhóm chủ); người tạo khách không bị gỡ khỏi `careTeam`; (5) `CustomerDetail` thêm `ownerManagers`, `creator`; (6) `USER_NOT_ASSIGNABLE` có `details.reason`. **Nguồn duy nhất về luật phân quyền là [`13_Ma_Tran_Phan_Quyen_CRM.md`](13_Ma_Tran_Phan_Quyen_CRM.md)**; cột "Quyền" dưới đây chỉ là tóm tắt theo vai trò, lệch thì theo 13. FE cũ đọc `assignee` vẫn chạy tới v1.0.7.

---

## 1. Quy ước chung

### 1.1 Header

| Header | Bắt buộc | Mô tả |
|---|---|---|
| `Authorization: Bearer <accessToken>` | Mọi route trừ `@Public` | Access token sống ngắn (15 phút), có sẵn |
| `X-Request-ID` | Nên gửi (FE/App sinh UUID) | Correlation ID; server tự sinh nếu thiếu và trả lại trong response header |
| `X-Idempotency-Key` | Có, với các route đánh dấu **[IK]** | UUID mỗi lần bấm; lặp lại cùng key trong 5 phút ⇒ trả lại response cũ; đang xử lý ⇒ 409 `IDEMPOTENCY_IN_PROGRESS`. Tên header theo code hiện có |
| `X-Client-Type: web \| mobile` | Có với `/auth/*` từ app | Quyết định trả refresh token bằng cookie (web) hay body (mobile) — **[Giả định D6]** |

### 1.2 Response thành công

| Loại | Shape |
|---|---|
| Danh sách | `{ data: T[], meta: { total, page, limit, totalPages } }` (dùng `buildPaginationMeta` có sẵn) |
| Một đối tượng | `{ data: T }` |
| Job bất đồng bộ | `202 { data: { jobId, status } }` |
| Không nội dung | `204` (DELETE mềm, gỡ thiết bị push) |

> Ghi chú: một số controller cũ (`/users`) đang trả object trần; CRM thống nhất bọc `{ data }`. Không sửa API cũ để giữ tương thích.

### 1.3 Response lỗi (`GlobalExceptionFilter`)

```json
{
  "statusCode": 409,
  "message": "Mỗi khách chỉ có tối đa 10 thành viên phụ",
  "timestamp": "2026-11-10T08:30:00.000Z",
  "path": "/api/v1/crm/customers/66f1.../care-team/members",
  "errorCode": "CARE_TEAM_LIMIT_EXCEEDED",
  "details": { "limit": 10, "membersAfter": 11 }
}
```

> v1.0.5: ví dụ lỗi cũ (409 `CUSTOMER_PHONE_DUPLICATED` kèm `canRequestJoin`) đã bị thay vì không còn kiểm trùng SĐT và không còn luồng xin tham gia.

4 trường đầu là chuẩn bắt buộc (đã có). `errorCode`, `details` là **mở rộng tùy chọn, tương thích ngược** — filter chỉ thêm khi exception có. `message` là tiếng Việt dễ hiểu; lỗi validate trả `message: string[]` như ValidationPipe hiện tại. Stack trace chỉ ở `development`.

### 1.4 Phân trang, sắp xếp, lọc

| Tham số | Quy tắc |
|---|---|
| `page`, `limit` | Kế thừa `PaginationQueryDto`: `page ≥ 1` (mặc định 1), `1 ≤ limit ≤ 100` (mặc định 20) |
| `sort` | Một field trong whitelist của từng endpoint; tiền tố `-` = giảm dần. Ví dụ `sort=-lastUpdatedAt`. Field ngoài whitelist ⇒ 400 |
| Lọc nhiều giá trị | Chuỗi phân tách dấu phẩy: `statusIds=a,b`. Tối đa 50 giá trị |
| Khoảng | Hậu tố `From`/`To` (ví dụ `updatedFrom=2026-10-01&updatedTo=2026-10-21`, ngày theo giờ VN) hoặc `Min`/`Max` (số) |
| Tìm kiếm | `q` (2–100 ký tự), không phân biệt dấu/hoa thường |
| Danh mục nhỏ | Cũng trả `{ data, meta }`; mặc định `limit=100` |

### 1.5 Ký hiệu quyền

`A` Quản trị, `M` Quản lý, `S` Nhân viên (`STAFF`); `P` = trong phạm vi khách của mình (row-level, 04 §4.3); `PR` = phụ trách chính; `TG` = tác giả (v1.0.6: chủ bản ghi, tức người tạo lịch hẹn, tác giả nhật ký hoặc người tải ảnh; Quản trị luôn được); `NT` = người tạo khách (v1.0.6); `CK` = chủ khách (v1.0.6) = Quản trị, người tạo khách hoặc Manager của nhóm chủ (13, mục 2.1); `Self` = chính mình; `Public` = không cần đăng nhập. `EDITOR` không có quyền CRM.

### 1.6 Kiểu dùng chung trong response

| Kiểu | Shape |
|---|---|
| `Ref` | `{ id, label }` (danh mục, dự án, thẻ) |
| `StatusRef` | `{ id, code, label, listGroup: 'NOT_CONTACTED'\|'INTERESTED'\|'NET'\|'DROPPED', color }` |
| `UserRef` | `{ id, displayName, isLocked? }` (`isLocked` thêm ở v1.0.5, tương thích: có mặt và `true` khi tài khoản đang bị khóa, để FE hiện nhãn "đã khóa") |
| `CareTeamMember` | `{ user: UserRef, role: 'PRIMARY'\|'MEMBER', addedAt, addedBy: UserRef }` |
| `OwnerRef` | `{ userId, fullName, role: 'ADMIN'\|'MANAGER'\|'STAFF'\|null }` (v1.0.6; `role` = vai trò CRM cao nhất của tài khoản) |
| `Criterion` | `{ isDone, description, updatedAt, updatedBy: UserRef \| null }` |
| `CustomerListItem` | `{ id, customerCode (v1.0.5: `KH-000123`, bất biến; `null` ngắn hạn với khách chưa được script bù mã), fullName, phoneMasked (ví dụ `0912 ••• 678`; **`null` khi khách không có SĐT** (v1.0.5); số đầy đủ qua `phone-views`), purchasePurposes: string[] (mã lựa chọn trường chân dung `purchase_purposes` như `LIVING`, `INVEST_RENT`; rỗng khi chưa có hoặc khách đã ẩn danh; FE dịch mã sang nhãn theo cấu hình trường), status: StatusRef, source: Ref\|null, projects: Ref[], area: Ref\|null, tags: Ref[], progress, criteriaDone: { demand, motivation, finance, timing } (boolean), primaryAssignee: UserRef\|null, careTeamSize, nextAppointmentAt, lastCareLogAt, lastUpdatedAt, personaCompleteness }` |
| `CustomerDetail` | `CustomerListItem` + `{ email: string\|null, canViewPhone, criteria: { demand, motivation, finance, timing: Criterion }, careTeam: CareTeamMember[], nationalIdMasked: '••••1234'\|null, hasNationalId, canRevealNationalId, dataConsent, lastUpdatedBy: UserRef, createdAt, createdBy: UserRef, createdVia, nextActionSuggestions: string[], permissions: { canEdit, canManageCareTeam, ~~canChangePrimary~~ (v1.0.5: PRIMARY khóa vĩnh viễn, không còn đổi), canSetInitialPrimary, canDelete }, ownerManagers: OwnerRef[] (v1.0.6, FR-30: Manager ACTIVE của nhóm chủ chưa trong `careTeam`, kể cả người tạo nếu là Manager; sắp theo `fullName`), creator: OwnerRef\|null (v1.0.6, FR-30: người tạo khách ACTIVE, có vai trò CRM, ngoài `careTeam` và chưa nằm trong `ownerManagers`), version }`. **v1.0.6 (FR-31):** `canRevealNationalId`, `permissions.canManageCareTeam`, `permissions.canSetInitialPrimary` đúng khi người gọi có **quyền chủ khách** (Quản trị, người tạo khách, Manager nhóm chủ); `permissions.canDelete` đúng khi Quản trị hoặc người tạo khách (không xét tình trạng khách); FE dựng danh sách chọn người thực hiện = `careTeam` ACTIVE + `ownerManagers` + `creator`, khử trùng theo `userId` |
| `PersonaFieldValue` | `{ fieldKey, label, groupCode, type, value, source, updatedAt, updatedBy: UserRef }`. `value` là object chỉ chứa khóa hợp với kiểu trường (`valueText` cho TEXT/TEXTAREA; `valueNumber` cho NUMBER; `valueNumber` + `valueNumberTo` cho NUMBER_RANGE, được thiếu một đầu; `valueDate` `YYYY-MM-DD` cho DATE; `valueOptions` mã lựa chọn cho SELECT (1)/MULTI_SELECT (1-20); `valueBoolean` cho BOOLEAN), hoặc `null` khi chưa có giá trị (khi đó `source`, `updatedAt`, `updatedBy` cũng `null`) |
| `CareLog` | `{ id, customerId, author: UserRef, occurredAt, content, attachments: [{ id, thumbUrl (URL ký 15 phút của thumbnail khi đã có; chưa có hoặc `FAILED` thì bằng `url`), url (signed URL 15 phút), mimeType, size }], contactChannel, contactResult: Ref\|null, nextAction: { suggestion, dueAt, appointmentId }\|null, source, editedAt, canEdit (v1.0.6, FR-32: đúng khi là tác giả hoặc Quản trị; cũng là điều kiện xóa nhật ký) }` |
| `Appointment` | `{ id, customer: { id, fullName, status: StatusRef }, type, title, startAt, endAt, location, note, assignee: UserRef\|null (**deprecated v1.0.6**: người đầu trong `assignees`, bỏ ở v1.0.7), assignees: UserRef[] (v1.0.6, FR-30: mọi người thực hiện theo thứ tự), remindBeforeMinutes, status, completedAt, outcome, createdBy: UserRef, version (khóa lạc quan, M5), canEdit (v1.0.6, FR-32: sửa và đổi trạng thái), canDelete (M5; v1.0.6: cùng điều kiện với `canEdit`, đúng khi là người tạo lịch hoặc Quản trị), project: Ref\|null (G7: dự án của buổi hẹn, vẫn trả tên khi dự án đã ngừng/ẩn) }` |
| `DailyTask` | `{ kind: 'APPOINTMENT'\|'FOLLOW_UP'\|'OCCASION'\|'STALE_CUSTOMER', dueAt, group: 'OVERDUE'\|'TODAY'\|'UPCOMING', customer: { id, fullName, status: StatusRef, projects: Ref[] (dự án khách quan tâm) }, project: Ref\|null (G7: dự án của lịch hẹn, chỉ việc APPOINTMENT), lastCareLog: { occurredAt, excerpt }\|null, suggestion, appointmentId?, isPrimary, id (M5: `KIND:id nguồn`, ổn định giữa các trang), title, careLogId?, assignee: UserRef (hoặc null; deprecated v1.0.6), assignees: UserRef[] (v1.0.6; việc APPOINTMENT là mọi người thực hiện, nguồn khác tối đa một người), canEdit, canDelete (v1.0.6; chỉ việc APPOINTMENT có nghĩa, cùng điều kiện như `Appointment`) }` |
| `HistoryEntry` | `{ id, action, actor: UserRef, actorRole, changes: [{ field, from, to }], reason, source, createdAt }` |

---

## 2. Danh sách endpoint theo nhóm

### 2.1 Auth — dùng lại (4)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| POST | `/auth/login` | Đăng nhập (có sẵn, throttle 5/phút). Mở rộng: client mobile nhận `refreshToken` trong body | Public | body `{ email, password }`; header `X-Client-Type` | `{ accessToken, user, refreshToken? (mobile) }` + cookie (web) | X1 |
| POST | `/auth/refresh` | Xoay refresh token (có sẵn). Mở rộng: mobile gửi token trong body | Public | cookie (web) hoặc body `{ refreshToken }` (mobile) | `{ accessToken, refreshToken? }` | X1 |
| POST | `/auth/logout` | Thu hồi refresh token (có sẵn). Mở rộng (v1.0.4): body tùy chọn `pushSubscriptionId` để gỡ thiết bị Web Push của chính mình (lý do `LOGOUT`); id hợp lệ nhưng lạ/của người khác bị bỏ qua im lặng, sai kiểu hoặc field lạ ⇒ 400 | Đã đăng nhập | body `{ pushSubscriptionId? }` | `{ message }` | X1, X5 |
| GET | `/auth/me` | Hồ sơ người dùng (có sẵn). Mở rộng: thêm `teamId`, `managedTeamIds` | Đã đăng nhập | — | `{ _id, email, displayName, role, status, teamId, managedTeamIds }` | X1 |

### 2.2 Người dùng & nhóm (10: 4 dùng lại, 6 mới)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/users` | Danh sách tài khoản (có sẵn). Mở rộng filter | A | query `page, limit, role, teamId, status, q` | `{ data: User[], meta }` | X7 |
| POST | `/users` | Tạo tài khoản (có sẵn). Mở rộng: `role` nhận `MANAGER`/`STAFF`, thêm `teamId` | A | body `{ email, password, displayName, role, teamId? }` | `User` | X7 |
| PATCH | `/users/:id/status` | Khóa/mở khóa (có sẵn) | A | body `{ status }` | `User` | X7 |
| PATCH | `/users/:id/role` | Đổi vai trò (có sẵn, thêm enum) | A | body `{ role }` | `User` | X1 |
| PATCH | `/users/:id/team` | **Mới.** Gán nhóm (chỉ MANAGER/STAFF; ghi audit `USER_TEAM_CHANGED`). **M1 chưa đồng bộ `customers.teamIds`** — việc này (job đồng bộ) thuộc M2 khi có collection `customers` | A | body `{ teamId \| null }` | `{ data: User }` | QT6 |
| GET | `/teams` | **Mới.** Danh sách nhóm | A, M (nhóm mình) | query `page, limit, q, isActive` | `{ data: Team[], meta }` — `Team { id, name, code, managers: UserRef[], memberCount, isActive }` | QT6 |
| POST | `/teams` | **Mới.** Tạo nhóm | A | body `{ name, code, managerIds[] }` | `201 { data: Team }` | QT6 |
| PATCH | `/teams/:id` | **Mới.** Sửa nhóm, đổi quản lý | A | body `{ name?, managerIds?, isActive? }` | `{ data: Team }` | QT6 |
| DELETE | `/teams/:id` | **Mới.** Xóa mềm (chỉ khi không còn thành viên) | A | — | `204`; 409 `TEAM_NOT_EMPTY` | QT6 |
| GET | `/crm/customer-assignees` | **Mới (v1.0.5, thay `GET /crm/assignable-users` đã xóa).** Nguồn ô lọc "Người phụ trách": người xuất hiện trong `careTeam` của các khách người gọi được thấy (bỏ khách xóa mềm), gồm cả người bị khóa (`isLocked`); chỉ trả id, tên, vai trò, nhóm, cờ khóa (không email/SĐT/CCCD). Nguồn người được **mời** vào nhóm là `GET /crm/care-team-invitees` (2.5) | A, M, S | query `q (≤ 50), teamId, page, limit (≤ 100)` | `{ data: [{ id, displayName, role, team: Ref\|null, teams: Ref[], isLocked }], meta }` | FR-09, FR-18 |

> Cập nhật: thêm `PATCH /users/:id/roles`, `PATCH /users/:id/teams`, `GET|POST|DELETE /teams/:id/members`, `DELETE` trong thao tác hàng loạt khách, route xóa vĩnh viễn khách và khu vực 34 tỉnh; xem [`09_Bo_Sung_Sua_Doi_Tinh_Nang.md`](09_Bo_Sung_Sua_Doi_Tinh_Nang.md) v1.0.2.

### 2.3 Khách hàng (14)

> Khai báo route tĩnh (`list-counts`) **trước** `/:id`. (v1.0.5: route `phone-lookups` đã xóa.)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers` | Danh sách khách có tìm/lọc/sắp xếp. Bộ lọc chân dung/thẻ (M4): `tagIds` khớp khách gắn BẤT KỲ thẻ nào trong danh sách; `occupation` khớp TIỀN TỐ không dấu, không phân biệt hoa thường ("ke toan" ra cả "Kế toán trưởng"); `personaFilters` dạng `fieldKey:value` (chỉ trường `isFilterable`, `value` là mã lựa chọn / chữ / `true|false`), cùng `fieldKey` là HOẶC, khác `fieldKey` là VÀ, tối đa 20 giá trị; giá trị sai định dạng ⇒ 400, giá trị không khớp trường nào ⇒ không có kết quả. Tìm theo **mã khách** (v1.0.5) phải gõ tiền tố `KH` (`KH-000123`, `kh123`); từ khóa toàn số vẫn là SĐT (giữ quy tắc chặn dò số, quyết định #37). Từ khóa `q` toàn chữ số: < 4 số không có kết quả, 4-5 số chỉ khớp đuôi số, từ 6 số khớp chuỗi con; có từ khóa thì giới hạn 30 lần/phút/người (cùng từ khóa trong 5 giây, gồm `list-counts` và đổi trang, chỉ tốn 1 lượt); ≥ 20 từ khóa số (từ 6 chữ số) "lá" khác nhau/giờ (từ khóa là tiền tố của từ khóa khác đã tìm không tính, nên gõ dần không báo giả) ghi audit `PHONE_SEARCH_ANOMALY` | A, M-P, S-P | query `page, limit, q (tên, SĐT, email, mã khách `KH-…`), listGroup (ALL\|NOT_CONTACTED\|INTERESTED\|NET\|DROPPED; **mặc định ALL**, tab mặc định của giao diện là Tất cả), statusIds, sourceIds, projectIds, areaIds (gồm khu vực con), assigneeIds (bất kỳ ai trong nhóm), primaryAssigneeIds, teamIds, progress (0,25,50,75,100 — nhiều giá trị), progressMin, progressMax, updatedFrom, updatedTo, lastCareFrom, lastCareTo, tagIds, occupation, personaFilters (`fieldKey:value`, nhiều), hasNationalId, sort ∈ {lastUpdatedAt, fullName, progress, createdAt, nextAppointmentAt, lastCareLogAt, personaCompleteness}` (mặc định `-lastUpdatedAt`) | `{ data: CustomerListItem[], meta }` | C6, X3 |
| GET | `/crm/customers/list-counts` | Số khách mỗi tab Tất cả / Chưa tiếp cận / Có quan tâm / Khách net / Bỏ (cùng bộ lọc trừ `listGroup`) | A, M-P, S-P | query như trên (bỏ `page, limit, sort, listGroup`) | `{ data: { ALL, NOT_CONTACTED, INTERESTED, NET, DROPPED, byStatus: [{ statusId, count }] } }` | C6 |
| POST | `/crm/customers` | Tạo khách. **[IK]** (khóa idempotency gắn theo người dùng + route). **v1.0.5 (thay quy tắc của v1.0.4):** chỉ `fullName` bắt buộc; `phone` tùy chọn (vắng/`null`/chuỗi rỗng = khách chưa có SĐT, lưu `null`; có giá trị thì chuẩn hóa E.164) và **không kiểm trùng**; **người tạo luôn là PRIMARY ở mọi vai trò** (kể cả Quản trị), nên body **không nhận `careTeam`** (gửi ⇒ 400 `VALIDATION_FAILED`); cấp `customerCode` trong cùng transaction. `tagIds` tối đa 30 thẻ còn hoạt động (sai/đã xóa ⇒ 400 `VALIDATION_FAILED`, không tạo khách) | A, M, S | body `{ fullName*, phone?, email?, statusId?, sourceId?, interestedProjectIds?, areaId?, tagIds?, nationalId?, criteria?: { [key]: { isDone, description } }, dataConsent? }` | `201 { data: CustomerDetail }` (có `customerCode`, `careTeam` = [người tạo là PRIMARY]); 400 `INVALID_PHONE`, `VALIDATION_FAILED`. ~~409 `CUSTOMER_PHONE_DUPLICATED`, 400 `PRIMARY_REQUIRED`~~ đã bỏ | C1, C4, C5, C7, C8, QT3, FR-01, FR-07, FR-10 |
| GET | `/crm/customers/:id` | Chi tiết hồ sơ (không gồm persona đầy đủ, nhật ký) | A, M-P, S-P | — | `{ data: CustomerDetail }`; 404 nếu ngoài phạm vi | C1, C4, C5, C8, C9 |
| PATCH | `/crm/customers/:id` | Sửa hồ sơ cơ bản. `lastUpdatedAt` server tự ghi; optimistic concurrency | A, M-P, S-P | body `{ version*, fullName?, phone?, email?, sourceId?, interestedProjectIds?, areaId?, tagIds? }` (`tagIds` là danh sách thẻ MONG MUỐN, thay thế toàn bộ, tối đa 30; vắng mặt = giữ nguyên) | `{ data: CustomerDetail }`; 409 `VERSION_CONFLICT` (~~`CUSTOMER_PHONE_DUPLICATED`~~ đã bỏ ở v1.0.5: SĐT không unique; `phone: null` hoặc chuỗi rỗng = xóa SĐT; `customerCode` bất biến, không nhận) | C1, C7, C11, X4 |
| PATCH | `/crm/customers/:id/status` | Đổi tình trạng; khách tự chuyển danh sách; dùng lại để Hoàn tác | A, M-P, S-P | body `{ statusId*, version*, reason? }` | `{ data: { status: StatusRef, previousStatusId, version, lastUpdatedAt } }` | C6, QT2, X4 |
| PATCH | `/crm/customers/:id/criteria` | Cập nhật 1–4 tiêu chí; server tính `progress`. **Tự đổi tình trạng theo tiến độ (v1.0.3, PT-023):** nếu lần cập nhật làm `progress` đổi, server có thể đổi luôn tình trạng khách **trong cùng transaction** (quyền như lệnh cập nhật tiêu chí; không cần quyền riêng): (1) `progress` **mới = 75** và `progress` cũ **khác 75** (gồm 0/25/50 lên 75 **và 100 xuống 75**, tức 4/4 bỏ một tiêu chí) và tình trạng hiện tại thuộc nhóm `NOT_CONTACTED` hoặc `INTERESTED` (kể cả tình trạng tùy biến, bị đè) ⇒ chuyển sang tình trạng `NET` ("Khách net"); (2) `progress` tụt từ 75 trở lên xuống **dưới 75** (2/4, 1/4, 0/4) và tình trạng hiện tại thuộc nhóm `NET` (**kể cả NET do người dùng chọn tay**) ⇒ về `INTERESTED` ("Có quan tâm"); (3) mọi trường hợp khác **không đổi tình trạng**: đủ 4/4 (kể cả 0/25/50 lên 100) không làm gì; khách `DROPPED` miễn cả hai chiều; khách đã ở nhóm `NET` khi đủ 3/4 không đổi; `progress` không đổi (chỉ sửa mô tả) không kích hoạt. Chỉ endpoint này kích hoạt (nhập CSV, đổi hàng loạt, `PATCH /status` không). Field nội bộ `statusAutoSource` trên khách đã bỏ (2026-11-03); dấu tự động chỉ còn trong audit. **Thông báo (chốt 2026-11-03):** mỗi lần tự đổi thật, những người cùng chăm sóc (trừ người tick) nhận thông báo loại `CUSTOMER_STATUS_AUTO_CHANGED` trong hộp thông báo (`GET /notifications`), ghi cùng transaction; xem tài liệu 04 mục 3.6.1 và 6.2a. Nếu danh mục thiếu tình trạng `NET`/`INTERESTED` đang hoạt động thì bỏ qua việc tự đổi, tiêu chí vẫn lưu (200). Lỗi khi đổi tình trạng làm rollback cả cập nhật tiêu chí (409 `VERSION_CONFLICT` như thường). **Audit:** 2 bản ghi `CRITERIA_UPDATED` và `STATUS_CHANGED`, cùng người thực hiện là **người tick tiêu chí**, `reason` null; bản `STATUS_CHANGED` có thêm phần tử `changes` về `statusAutoSource` (cả hai chiều) | A, M-P, S-P | body `{ version*, demand?: { isDone?, description? }, motivation?, finance?, timing? }` | `{ data: { criteria, progress, version, lastUpdatedAt, autoStatusChange? } }`. `autoStatusChange?: { from: StatusRef\|null; to: StatusRef }` **chỉ có khi tình trạng vừa tự đổi** (vắng mặt khi không đổi). `version` và `lastUpdatedAt` là giá trị **SAU CÙNG**: khi có tự đổi tình trạng, `version` = `version` gửi lên + 2 (một lần cho cập nhật tiêu chí, một lần cho đổi tình trạng), nên lần gửi kế tiếp phải dùng `version` mới này. **Tương thích ngược:** request không đổi, client cũ bỏ qua field mới | C4, C5, QT1, PT-023 |
| PUT | `/crm/customers/:id/data-consent` | Ghi nhận / rút lại đồng ý xử lý dữ liệu cá nhân | A, M-P, S-P | body `{ status* (GRANTED\|WITHDRAWN\|UNKNOWN), method? (VERBAL\|WRITTEN\|ZALO\|OTHER), note? }` | `{ data: dataConsent }` | §5 (QT9) |
| DELETE | `/crm/customers/:id` | Xóa mềm (`deletedAt`). **v1.0.6 (FR-31, thay quy tắc v1.0.2 "M nhóm mình quản lý; S phụ trách chính và khách Bỏ"):** chỉ **Quản trị** (mọi khách) hoặc **người tạo khách** (khách mình tạo), ở mọi tình trạng; Manager nhóm chủ không phải người tạo, Manager được mời, PRIMARY không phải người tạo và mọi thành viên khác bị 403. Khách ngoài phạm vi vẫn 404 (không lộ sự tồn tại) | A, NT (người tạo khách) | query `reason*` (không dùng body với DELETE; phải có ký tự nhìn thấy được) | `204`; 403 `INSUFFICIENT_ROLE`; 404 `CUSTOMER_NOT_FOUND` (~~409 `CUSTOMER_NOT_DROPPED`~~ đã bỏ ở v1.0.6) | FR-31 |
| GET | `/crm/deleted-customers` | Danh sách khách đã xóa mềm | A | query `page, limit, q, deletedFrom, deletedTo` | `{ data: [CustomerListItem + { deletedAt, deletedBy, anonymizedAt, deleteReason, purgeInProgress }], meta }` | — |
| DELETE | `/crm/deleted-customers/:id` | **Xóa vĩnh viễn** khách đã xóa mềm (không hoàn tác; xóa nhật ký, ảnh + file MinIO, lịch hẹn, yêu cầu nhóm, nhắc, thông báo, audit cũ; giữ một dòng audit `CUSTOMER_PURGED` không PII; giải phóng SĐT). Chi tiết: tài liệu 09 §7.4 | A | — | `200 { data: { customerId, purged: {...} } }`; 404 `CUSTOMER_NOT_FOUND`; 409 `CUSTOMER_NOT_DELETED`, `CUSTOMER_PURGE_IN_PROGRESS`; 503 `SERVICE_UNAVAILABLE` (file chưa xóa được, chưa xóa gì ở DB, thử lại được) | — |
| POST | `/crm/customer-restorations` | Khôi phục khách đã xóa mềm | A | body `{ customerId*, reason? }` | `201 { data: CustomerDetail }`; 409 `CUSTOMER_ANONYMIZED`, `CUSTOMER_PURGE_IN_PROGRESS` | — |
| POST | `/crm/customer-anonymizations` | Ẩn danh hóa theo yêu cầu khách (không hoàn tác được). **[IK]** | A | body `{ customerId*, reason*, confirm: true }` | `201 { data: { customerId, anonymizedAt } }` | §5 |
| POST | `/crm/customer-bulk-operations` | Thao tác hàng loạt (≤ 200 khách/lần, đồng bộ, **mỗi khách một transaction** nên khách lỗi không kéo khách khác rollback; trả `200`; 10 lần/phút/người). `CHANGE_STATUS` đi qua đúng đường đổi tình trạng đơn lẻ (không cần `version`, audit `STATUS_CHANGED` lý do "Thao tác hàng loạt"). `ASSIGN` (chỉ A/M-P; S ⇒ 403; **v1.0.5**: chỉ **thêm MEMBER** (mời), không giới hạn theo nhóm, khách đã đủ 10 thành viên phụ ⇒ `CARE_TEAM_LIMIT_EXCEEDED` riêng khách đó; **`payload.primaryUserId` bị bỏ: gửi lên ⇒ 400 `VALIDATION_FAILED`** vì PRIMARY khóa; khách `careTeam` rỗng báo `PRIMARY_REQUIRED` riêng khách đó, đặt PRIMARY lần đầu dùng `POST care-team/members`; nguồn người nhận: `GET /crm/care-team-invitees` không truyền `customerId`). `DELETE` (v1.0.2 mục D; **v1.0.6, FR-31: cùng luật với xóa đơn, không còn điều kiện khách "Bỏ"**): xóa mềm khách, `payload.reason*` chung (có ký tự nhìn thấy được), kiểm quyền TỪNG khách (chỉ Quản trị hoặc người tạo khách đó), mã lỗi từng khách `CUSTOMER_NOT_FOUND`/`INSUFFICIENT_ROLE`/`INTERNAL_ERROR` (~~`CUSTOMER_NOT_DROPPED`~~ đã bỏ); thiếu hẳn `payload` ⇒ 400. **`ASSIGN` v1.0.6:** cổng ngoài vẫn A/M, nhưng quyền mời kiểm TỪNG khách: khách mà người gọi không phải chủ khách báo `INSUFFICIENT_ROLE` riêng khách đó. `ADD_TAGS`/`REMOVE_TAGS` (M4): `payload.tagIds` bắt buộc (1-50); thẻ cần GẮN phải còn tồn tại (sai/đã xóa ⇒ 400 cho cả lô), thẻ cần GỠ thì thẻ đã xóa vẫn gỡ được; khách đã có thẻ (khi thêm) hoặc chưa có thẻ (khi gỡ) tính là thành công và không ghi gì; mỗi khách tối đa 30 thẻ (vượt ⇒ khách đó `VALIDATION_FAILED`); đi qua `CustomerScope` như mọi thao tác khác (Nhân viên chỉ gắn/gỡ cho khách trong phạm vi), audit `TAGS_UPDATED` mỗi khách. Khách ngoài phạm vi/không tồn tại/đã xóa đều báo `CUSTOMER_NOT_FOUND`. **[IK]** | A, M-P, S-P (S không được `ASSIGN`; `DELETE` và `ASSIGN` kiểm từng khách theo chủ khách/người tạo) | body `{ type* (CHANGE_STATUS\|ADD_TAGS\|REMOVE_TAGS\|ASSIGN\|DELETE), customerIds*[] (1-200, không trùng), payload*: { statusId? \| tagIds? \| memberIds? \| reason? } (~~`primaryUserId`~~ bỏ ở v1.0.5) }` | `{ data: { succeeded: id[], failed: [{ customerId, errorCode }] } }`; 400 `VALIDATION_FAILED`; 403 `INSUFFICIENT_ROLE`; 429 `RATE_LIMITED` | C6, C8, C11, FR-12, FR-13 |

### 2.4 CCCD và xem/gọi SĐT (5)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| PUT | `/crm/customers/:id/national-id` | Nhập/sửa CCCD (mã hóa AES-256-GCM, chỉ lưu 4 số cuối dạng rõ) | A, M-P, S-P | body `{ nationalId* (9 hoặc 12 chữ số) }` | `{ data: { hasNationalId: true, nationalIdMasked: '••••1234' } }` | C9 |
| DELETE | `/crm/customers/:id/national-id` | Xóa giá trị CCCD khỏi hồ sơ | A, M-P, S-P | — | `204` | C9, §5 |
| POST | `/crm/customers/:id/national-id-views` | Xem CCCD đầy đủ: tạo bản ghi xem + trả số. Throttle 10/phút, `Cache-Control: no-store`. **v1.0.6 (FR-31, thay giả định D2 "phụ trách chính xem được"):** chỉ **chủ khách** = Quản trị, người tạo khách (kể cả Staff không phải PRIMARY), Manager nhóm chủ; PRIMARY không phải người tạo, thành viên `careTeam`, Manager được mời và Manager nhóm khác bị 403 `NATIONAL_ID_FORBIDDEN` | A, NT, CK | body `{ purpose? }` | `201 { data: { nationalId, viewedAt } }`; 403 `NATIONAL_ID_FORBIDDEN` | C9 |
| GET | `/crm/customers/:id/national-id-views` | Nhật ký các lần xem CCCD của khách | A, M-P | query `page, limit` | `{ data: [{ viewer: UserRef, viewedAt, purpose, source }], meta }` | C9 |
| POST | `/crm/customers/:id/phone-views` | Xem số đầy đủ / gọi / sao chép: kiểm `CustomerScope`, ghi audit `PHONE_VIEWED` (không lưu số). Mọi thành viên nhóm chăm sóc đều được (không che theo vai trò trong nhóm). Throttle 60/phút/người, `Cache-Control: no-store` | A, M-P, S-P (PR và MEMBER) | body `{ purpose* (VIEW\|CALL\|COPY) }` | `201 { data: { phone, viewedAt } }`; 404 nếu ngoài phạm vi; **409 `CUSTOMER_PHONE_NOT_SET`** (v1.0.5: khách không có SĐT, không ghi audit, không tốn hạn mức). Bản ghi audit `PHONE_VIEWED` **không lưu số** | C14 |

### 2.5 Nhóm chăm sóc & mời thành viên (4) — v1.0.5: bỏ luồng xin tham gia (3 endpoint `care-team-requests`) và `PUT primary`, thêm `care-team-invitees`

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers/:id/care-team` | Nhóm chăm sóc hiện tại | A, M-P, S-P | — | `{ data: { members: CareTeamMember[], primary: UserRef \| null } }` | C8 |
| POST | `/crm/customers/:id/care-team/members` | **Mời** thành viên phụ (v1.0.5 thay quy tắc "chỉ người cùng nhóm" của v1.0.2). Người được mời phải ACTIVE và là MANAGER/STAFF, **không giới hạn theo nhóm** (mời được người nhóm khác); tối đa **10 MEMBER** mỗi khách; rate-limit `CARE_TEAM_INVITE` 30 lượt/phút/người. `primaryUserId` **chỉ nhận khi `careTeam` đang rỗng** (khách cũ chưa có PRIMARY) và người gọi là Quản trị/Quản lý (đặt PRIMARY một lần); nhóm đã có người mà gửi `primaryUserId` ⇒ 400 `VALIDATION_FAILED`. Đồng bộ `primaryAssigneeId`, `teamIds` (hợp nhóm các thành viên; Quản lý nhóm người được mời thấy khách). Người được mời nhận `CUSTOMER_ASSIGNED` (không gửi cho tài khoản bị khóa). **v1.0.6 (FR-31): chỉ chủ khách (Quản trị, người tạo khách, Manager nhóm chủ) mời được**; PRIMARY không phải người tạo, thành viên `careTeam` và Manager nhóm khác bị 403 `CARE_TEAM_ACTION_FORBIDDEN`. `USER_NOT_ASSIGNABLE` ở đây vẫn là lỗi "người được mời không hợp lệ" (khóa hoặc không có vai trò CRM) | A, CK | body `{ userIds*[] (1-20), primaryUserId? }` | `201 { data: { members, primary } }`; 400 `PRIMARY_REQUIRED` (nhóm rỗng thiếu `primaryUserId`), `USER_NOT_ASSIGNABLE`, `VALIDATION_FAILED`; 403 `CARE_TEAM_ACTION_FORBIDDEN`; 409 `ALREADY_IN_CARE_TEAM`, `CARE_TEAM_LIMIT_EXCEEDED` (details `{ limit, membersAfter }`), `VERSION_CONFLICT`; 429 `RATE_LIMITED` | C8, QT7, QT8, X5, FR-12, FR-13, FR-17 |
| DELETE | `/crm/customers/:id/care-team/members/:userId` | Gỡ thành viên phụ. **v1.0.5 (thay quy tắc "gỡ PRIMARY phải chỉ định người thay" của v1.0.2):** PRIMARY khóa vĩnh viễn nên gỡ PRIMARY ⇒ 409 `PRIMARY_LOCKED` (kể cả Quản trị/Quản lý); không còn tham số `newPrimaryUserId` (~~400 `PRIMARY_REPLACEMENT_REQUIRED`~~ đã bỏ). Khách cũ đã quá 10 thành viên phụ vẫn gỡ được. **v1.0.6 (FR-31, FR-32): chỉ chủ khách gỡ được; không ai, kể cả Quản trị, gỡ được người tạo khách khỏi `careTeam` (dù PRIMARY hay MEMBER): 409 `PRIMARY_LOCKED` kèm `details.reason = CREATOR_LOCKED`** | A, CK | — | `{ data: { members, primary } }`; 403 `CARE_TEAM_ACTION_FORBIDDEN`; 404 `RESOURCE_NOT_FOUND` (người không có trong nhóm); 409 `PRIMARY_LOCKED` (`details.reason = CREATOR_LOCKED` khi gỡ người tạo) | C8, QT7, QT8, FR-11, FR-31, FR-32 |
| GET | `/crm/care-team-invitees` | **Mới (v1.0.5, thay `GET /crm/assignable-users` đã xóa).** Nguồn người được mời: **toàn hệ thống** (không giới hạn nhóm), user ACTIVE vai trò Quản lý/Nhân viên, loại người gọi và (khi có `customerId`) người đã trong nhóm. Chỉ trả id, tên hiển thị, tên nhóm (không email/SĐT/CCCD). Có `customerId`: người gọi phải là **chủ khách** (v1.0.6, FR-31: Quản trị, người tạo khách, Manager nhóm chủ; thay "Quản trị/Quản lý hoặc phụ trách chính"), không thì 403 `CARE_TEAM_ACTION_FORBIDDEN`; không `customerId` (giao hàng loạt): chỉ Quản trị/Quản lý. Rate-limit `INVITEE_SEARCH` 60 lượt/phút/người | A, M, CK | query `customerId?, q (≤ 50), page, limit (≤ 20, mặc định 20)` | `{ data: [{ id, displayName, teamNames: string[] }], meta }`; 403 `CARE_TEAM_ACTION_FORBIDDEN`; 404 `CUSTOMER_NOT_FOUND` (khách không tồn tại/ngoài phạm vi); 429 `RATE_LIMITED` | FR-13, FR-14, FR-31 |

> **v1.0.5 đã xóa khỏi nhóm này:** `PUT /crm/customers/:id/care-team/primary` (PRIMARY khóa), `POST /crm/care-team-requests`, `GET /crm/care-team-requests`, `PATCH /crm/care-team-requests/:id` (bỏ luồng xin tham gia X2; collection `care_team_requests` và enum cũ giữ lại cho dữ liệu cũ, không còn endpoint). Client cũ gọi các endpoint này nhận 404; **PWA bản cũ phải tải lại trang sau deploy** (09 mục v1.0.5).

### 2.6 Nhật ký chăm sóc và ảnh đính kèm (6)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers/:id/care-logs` | Dòng thời gian, mới nhất trước | A, M-P, S-P | query `page, limit, authorId, contactChannel, from, to` | `{ data: CareLog[], meta }` | C2 |
| POST | `/crm/customers/:id/care-logs` | Ghi nhật ký (ghi chú nhanh). Ghi rõ người viết từ JWT; cập nhật `lastCareLogAt`; tùy chọn nhắc bước tiếp theo; thông báo người cùng chăm sóc thuộc M5. `lastCareLogAt` = mốc `occurredAt` lớn nhất (nhập bù ngày cũ không kéo lùi; xóa/sửa nhật ký tính lại); không tăng `version` của khách; `occurredAt` không ở tương lai (lệch ≤ 5 phút). **M5: `nextAction.appointment { type, location?, remindBeforeMinutes? }`** tạo luôn lịch hẹn tại `nextAction.dueAt` (bắt buộc có `dueAt`, ≥ hiện tại trừ 5 phút; thiếu/quá khứ ⇒ 400 và KHÔNG tạo nhật ký) trong cùng transaction; người thực hiện là người ghi (Quản trị/Quản lý ngoài nhóm: phụ trách chính), tiêu đề lấy từ `suggestion`, `nextAction.appointmentId`/`appointments.sourceCareLogId` liên kết hai chiều. Không có `appointment` mà có `dueAt` ⇒ tạo nhắc FOLLOW_UP đúng giờ `dueAt`. Thông báo CARE_LOG_ADDED cho người cùng chăm sóc (gộp theo khoảng `careLogNotifyDebounceMinutes`). `attachmentIds` chỉ nhận ảnh do chính người ghi tải lên cho đúng khách, chưa gắn nơi khác; cờ `FEATURE_CRM_ATTACHMENTS` tắt ⇒ 400. **[IK]** | A, M-P, S-P | body `{ content*, contactChannel*, occurredAt?, contactResultId?, attachmentIds? (≤ 5, đã upload), nextAction?: { suggestion?, dueAt?, appointment?: { type, location?, projectId? (G7, cùng quy tắc POST /crm/appointments; dự án không hợp lệ ⇒ 400 và KHÔNG tạo nhật ký), remindBeforeMinutes? } } }` | `201 { data: CareLog }`; 400 `ATTACHMENT_LIMIT_EXCEEDED` | C2, C3, X5 |
| PATCH | `/crm/customers/:id/care-logs/:logId` | Sửa nội dung (tác giả sửa được bất cứ lúc nào, không giới hạn thời gian). **v1.0.6 (FR-32, thay "Quản trị, Quản lý trong phạm vi mọi lúc"): chỉ nhật ký của chính mình; nhật ký của người khác chỉ Quản trị sửa được, Manager (kể cả nhóm chủ) không.** `contactResultId: null` = bỏ kết quả liên hệ; `attachmentIds` là tập ảnh mong muốn sau khi sửa (ảnh vắng mặt bị gỡ và xóa khỏi kho) | TG, A, M-P | body `{ content?, contactChannel?, contactResultId?, occurredAt?, attachmentIds? }` | `{ data: CareLog }`; 403 `INSUFFICIENT_ROLE` (không phải tác giả và không phải Quản trị); 404 `RESOURCE_NOT_FOUND` | C2, X4, FR-32 |
| DELETE | `/crm/customers/:id/care-logs/:logId` | Xóa mềm nhật ký (ảnh đính kèm bị gỡ khỏi kho; `lastCareLogAt` tính lại). **v1.0.6 (FR-32): chỉ tác giả hoặc Quản trị** (Manager không còn xóa nhật ký người khác) | TG, A | query `reason?` | `204`; 403 `INSUFFICIENT_ROLE` (không phải tác giả và không phải Quản trị) | C2, X4, FR-32 |
| POST | `/crm/customers/:id/care-log-attachments` | Upload ảnh trước khi lưu ghi chú (từng ảnh; jpeg/png/webp, ≤ 5 MB, kiểm magic bytes, đổi tên UUID). **M3:** server bỏ EXIF/GPS/XMP/IPTC ngay lúc tải (đồng bộ, không giải mã lại điểm ảnh; ảnh hỏng cấu trúc ⇒ 415); ảnh vào thẳng `READY` (response không đổi); **v1.0.4 (FR-26):** sau khi commit, API xếp job nền `attachment.thumbnail` (queue `crm-image`, `jobId = thumb-{attachmentId}`, best-effort: lỗi Redis chỉ ghi log) để `sharp` sinh thumbnail WebP (cạnh dài ≤ 320 px, không metadata), điền `thumbKey`, `thumbStatus`, `width`, `height` vào `crm_attachments`, còn bản chụp `care_logs.attachments[]` chỉ nhận `thumbKey`, `width`, `height` (không có `thumbStatus`); `thumbStatus` chỉ có ở `crm_attachments`, khởi tạo `NONE`, thành `READY` khi có thumbnail, `FAILED` khi hết lượt thử hoặc ảnh không giải mã được; `thumbUrl` của `CareLog.attachments[]` là URL ký 15 phút riêng cho `thumbKey` khi đã `READY`, còn chưa có thumbnail (job chưa chạy, ảnh cũ chưa được bù) hoặc `FAILED` thì rơi về `url` ảnh gốc (chi tiết doc 04 mục 6.6); lưu bucket `crm-attachments` tên UUID `customers/<id>/care-logs/<uuid>.<ext>`; ảnh chưa gắn quá 24 giờ bị dọn mỗi giờ; tối đa 20 ảnh chưa gắn/người/khách; 30 lần/phút/người; cờ `FEATURE_CRM_ATTACHMENTS` tắt ⇒ 404 | A, M-P, S-P | multipart `file*` | `201 { data: { id, status: 'READY' } }`; 400 `ATTACHMENT_LIMIT_EXCEEDED`; 413 `FILE_TOO_LARGE`; 415 `ATTACHMENT_TYPE_INVALID`; 429 `RATE_LIMITED` | C2 |
| DELETE | `/crm/customers/:id/care-log-attachments/:attachmentId` | Gỡ ảnh khỏi nhật ký (**v1.0.6, FR-32: chỉ ảnh của mình, Quản trị gỡ mọi ảnh**; chưa gắn: người tải lên hoặc Quản trị, người khác nhận 404; đã gắn: tác giả nhật ký hoặc Quản trị, người khác 403). File ảnh gốc và thumbnail (nếu có `thumbKey`) bị xóa khỏi kho sau khi commit | TG, A | — | `204`; 403 `INSUFFICIENT_ROLE` (ảnh đã gắn, không phải tác giả và không phải Quản trị); 404 `RESOURCE_NOT_FOUND` | C2, FR-32 |

### 2.7 Chân dung & thẻ (11)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers/:id/persona` | Chân dung theo nhóm trường (chỉ trường đang hoạt động, nhóm không có trường nào thì bỏ) + độ đầy đủ tính trực tiếp + tối đa 5 gợi ý thông tin còn thiếu (ưu tiên `suggestPriority` nhỏ). Giá trị của trường đã tắt/xóa vẫn lưu nguyên nhưng không hiện cho đến khi trường bật lại. Trường nhạy cảm vẫn hiện nhưng không tính vào độ đầy đủ và không nằm trong gợi ý | A, M-P, S-P | — | `{ data: { groups: [{ code, label, fields: PersonaFieldValue[] }], completeness, missingSuggestions: [{ fieldKey, label, groupCode }], version } }` (`version` là version hồ sơ để gửi kèm PATCH; thêm so với bản đầu của tài liệu, tương thích ngược) | C10, C12, QT9 |
| PATCH | `/crm/customers/:id/persona` | Cập nhật nhiều giá trị (1-50, không trùng `fieldKey`); `value: null` để xóa (kể cả trường đã tắt/xóa mềm, để quyền xóa dữ liệu cá nhân không phụ thuộc cấu hình). Ghi người/ngày/nguồn từng giá trị; một giá trị sai làm hỏng cả lô (không ghi gì); ghi lại đúng giá trị và nguồn cũ là no-op (không tăng version, không audit). Độ đầy đủ, token lọc, dịp đặc biệt tính lại trong cùng lệnh `updateOne` với khóa lạc quan `__v`; ghi chân dung tăng `version` hồ sơ. Audit `PERSONA_UPDATED` theo `persona.<fieldKey>` (giá trị trường nhạy cảm không được ghi); xóa giá trị còn ghi đè giá trị đó trong các audit cũ của đúng trường (`[đã xóa]`). Không nhập mới được cho trường đã tắt/xóa | A, M-P, S-P | body `{ version*, values*: [{ fieldKey*, value* (theo type, hoặc null), source* (CUSTOMER_SHARED\|STAFF_OBSERVED), sensitiveAcknowledged? }] }` | `{ data: { completeness, updated: PersonaFieldValue[], version } }`; 400 `PERSONA_VALUE_INVALID` (kèm `fieldKey`: sai kiểu, lựa chọn không hợp lệ, trường không tồn tại/đang tắt), `SENSITIVE_FIELD_CONSENT_REQUIRED`; 409 `VERSION_CONFLICT` | C10, C12, C13, QT9, X10 |
| GET | `/crm/persona-fields` | Cấu hình trường chân dung (render form, bộ lọc), theo thứ tự hiển thị `order`; không gồm trường đã xóa mềm. Mặc định `limit=100` | A, M, S | query `isActive, groupCode, page, limit` | `{ data: PersonaField[], meta }` — `PersonaField { id, key, label, helpText, placeholder, groupCode, type, options: [{ value, label, isActive }], order, weight, suggestPriority, isFilterable, isOccasion, occasionLabel, linkedCriterion, isSensitive, isSystem, isActive }` | X10 |
| POST | `/crm/persona-fields` | Thêm trường. `key` slug `^[a-z][a-z0-9_]{0,39}$`, duy nhất kể cả trường đã xóa; `groupCode` phải là nhóm có thật (seed: PERSONAL, OCCUPATION, LIFESTYLE, OCCASION, FAMILY, CONTACT, REAL_ESTATE); SELECT/MULTI_SELECT bắt buộc có lựa chọn (`value` không trùng sau khi chuẩn hóa), kiểu khác không được có `options`; `isOccasion` chỉ cho DATE; `isFilterable` chỉ cho TEXT/SELECT/MULTI_SELECT/BOOLEAN và không đi cùng `isSensitive`; tối đa 100 lựa chọn kể cả đã tắt; `weight` 0-100 (mặc định 1, 0 = không tính). Tăng phiên bản cấu hình và chạy job nền tính lại cho khách | A | body `{ key*, label*, groupCode*, type*, options?, helpText?, placeholder?, weight?, suggestPriority?, isFilterable?, isOccasion?, occasionLabel?, linkedCriterion?, isSensitive? }` | `201 { data: PersonaField }`; 400 `VALIDATION_FAILED`; 409 `CATALOG_DUPLICATED` (trùng `key`) | X10, C12 |
| PATCH | `/crm/persona-fields/:id` | Sửa nhãn, nhóm, lựa chọn, trọng số, bật/tắt... `key` bất biến; `type` khóa khi đã có khách có giá trị của trường (kể cả khách xóa mềm). `options` là DANH SÁCH MONG MUỐN: lựa chọn vắng mặt bị tắt (`isActive: false`), không bao giờ xóa, nên giá trị khách đã chọn vẫn đọc và lưu lại được; lựa chọn đã tắt không chọn mới được. Đổi `weight`/`isActive`/`isFilterable`/`isOccasion`/`type` tăng phiên bản cấu hình và chạy job nền tính lại. Không bao giờ ghi vào dữ liệu chân dung của khách | A | body các field của POST trừ `key` + `isActive?` | `{ data: PersonaField }`; 409 `PERSONA_FIELD_TYPE_LOCKED` `{ valueCount }` (đổi `type` khi đã có khách có giá trị; **được ưu tiên** hơn mã dưới đây); 409 `PERSONA_FIELD_SYSTEM` `{ field: 'type' }` (đổi `type` của trường `isSystem` khi chưa khách nào có giá trị; vẫn sửa được nhãn, lựa chọn, bật/tắt); 400 `VALIDATION_FAILED` (hình dạng sai: tắt hết lựa chọn, lựa chọn trùng `value`, quá 100 lựa chọn kể cả đã tắt) | X10 |
| DELETE | `/crm/persona-fields/:id` | Bớt trường = xóa mềm (`deletedAt`, kèm tắt), giữ nguyên dữ liệu cũ của khách; `key` vẫn bị giữ chỗ. Không áp dụng trường `isSystem` (chỉ tắt bằng PATCH `isActive: false`) | A | — | `204`; 409 `PERSONA_FIELD_SYSTEM` `{ valueCount }` (trường hệ thống không xóa được; `valueCount` = số khách đang có giá trị, kể cả khách xóa mềm) | X10 |
| PUT | `/crm/persona-fields/order` | Sắp lại thứ tự trường (và chuyển nhóm bằng `groupCode`). `order` là thứ tự toàn cục, trong một nhóm hiển thị theo thứ tự này. Tối đa 200 mục, `id` không trùng, id không tồn tại ⇒ 404 | A | body `{ items*: [{ id, order, groupCode? }] }` | `{ data: PersonaField[] }` (toàn bộ trường theo thứ tự mới) | X10 |
| GET | `/crm/tags` | Danh sách / gợi ý thẻ khi gõ (`q` không dấu, khớp chứa từ khóa; không gồm thẻ đã xóa). `label` = tên thẻ; `usageCount` = số khách đang gắn (kể cả khách xóa mềm). Mặc định `limit=100`, `sort=name` | A, M, S | query `q, category, page, limit, sort ∈ {name, usageCount}` | `{ data: [Ref + { category, usageCount, color }], meta }` | C11 |
| POST | `/crm/tags` | Tạo thẻ (trùng tên đã chuẩn hóa — không dấu, không phân biệt hoa thường, gom khoảng trắng — trong cùng `category` ⇒ trả thẻ có sẵn; nhiều người tạo cùng tên đồng thời chỉ ra một thẻ). Tên được chuẩn hóa NFKC và bỏ ký tự vô hình; tên không còn ký tự hiển thị ⇒ 400 `VALIDATION_FAILED`. Giới hạn 30 lần/phút/người (`RATE_LIMITED`) | A, M, S | body `{ name* (1-50), category* (INTEREST\|OCCUPATION\|OTHER) }` | `201 { data: Tag }` hoặc `200` nếu đã tồn tại; 429 `RATE_LIMITED` | C11 |
| PATCH | `/crm/tags/:id` | Sửa tên/nhóm/màu (trùng tên trong nhóm ⇒ 409 `CATALOG_DUPLICATED`); hoặc gộp vào thẻ khác CÙNG `category` bằng `mergeIntoId` (không đi kèm field khác, không gộp vào chính nó, khác nhóm ⇒ 400 `VALIDATION_FAILED`): khách đang gắn thẻ nguồn chuyển sang thẻ đích (gắn cả hai chỉ còn một), thẻ nguồn xóa mềm (`mergedIntoId`), `usageCount` thẻ đích đếm lại. Gộp chạy ĐỒNG BỘ trong một transaction (không dùng job nền, xem 06 M4); không tăng `version`/`lastUpdatedAt` của từng khách | A | body `{ name?, category?, color?, mergeIntoId? }` | `{ data: Tag }` (gộp: trả thẻ đích) | C11 |
| DELETE | `/crm/tags/:id` | Xóa mềm thẻ và gỡ khỏi mọi khách (kể cả khách xóa mềm) ĐỒNG BỘ trong cùng transaction (không dùng job nền); không có thời điểm nào khách còn thẻ đã xóa | A | — | `204` | C11 |

**Kết quả kiểm quy tắc BE `/crm/persona-fields` (T-62, FR-41, v1.0.4; test tích hợp `crm-fr41-persona-fields-rules.integration.spec.ts`)** để FE (màn "Trường chân dung") dựa vào, mọi lỗi đều có `errorCode` + `details`:

- Xóa trường hệ thống ⇒ 409 `PERSONA_FIELD_SYSTEM` `{ valueCount }`. Đổi kiểu khi đã có dữ liệu khách ⇒ 409 `PERSONA_FIELD_TYPE_LOCKED` `{ valueCount }`. Đổi kiểu trường hệ thống chưa có dữ liệu ⇒ 409 `PERSONA_FIELD_SYSTEM` `{ field: 'type' }`.
- PATCH `options`: lựa chọn vắng mặt bị `isActive: false`, không xóa; đổi nhãn giữ nguyên `value`; tắt hết mọi lựa chọn hoặc trùng `value` ⇒ 400; trần 100 lựa chọn tính cả lựa chọn đã tắt.
- `PUT /crm/persona-fields/order` nhận `{ items: [{ id, order, groupCode? }] }`, trả toàn bộ danh sách theo thứ tự mới; thao tác không đổi gì (no-op) thì không ghi audit.

### 2.8 Danh mục & dự án (22)

Bốn danh mục dùng chung một mẫu CRUD (4 endpoint mỗi loại). Đọc: A, M, S. Ghi: A. Xóa = xóa mềm; đang được dùng hoặc `isSystem` ⇒ 409 `CATALOG_IN_USE` / `CATALOG_SYSTEM` (gợi ý tắt `isActive`). `code` của danh mục unique **kể cả bản đã xóa mềm**: mã đã xóa không dùng lại được, tạo trùng ⇒ 409 `CATALOG_DUPLICATED`.

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customer-statuses` | Danh sách tình trạng | A, M, S | query `listGroup, isActive, page, limit` | `{ data: [StatusRef + { order, isDefault, isSystem, isActive }], meta }` | C1, C6, X7 |
| POST | `/crm/customer-statuses` | Thêm tình trạng (bắt buộc chọn nhóm danh sách) | A | body `{ code*, label*, listGroup*, color?, order? }` | `201 { data: Status }` | X7, QT2 |
| PATCH | `/crm/customer-statuses/:id` | Sửa nhãn/màu/thứ tự/nhóm/mặc định | A | body `{ label?, color?, order?, listGroup? (không áp dụng isSystem), isDefault?, isActive? }` | `{ data: Status }` | X7 |
| DELETE | `/crm/customer-statuses/:id` | Xóa mềm | A | — | `204` | X7 |
| GET | `/crm/lead-sources` | Nguồn khách | A, M, S | query `isActive, q, page, limit` | `{ data: [Ref + { code, order, isActive }], meta }` | C1, X7 |
| POST | `/crm/lead-sources` | Thêm nguồn | A | body `{ code*, label*, order? }` | `201 { data }` | X7 |
| PATCH | `/crm/lead-sources/:id` | Sửa nguồn | A | body `{ label?, order?, isActive? }` | `{ data }` | X7 |
| DELETE | `/crm/lead-sources/:id` | Xóa mềm | A | — | `204` | X7 |
| GET | `/crm/areas` | Khu vực (phẳng hoặc theo cha). `parentId=root` chỉ lấy khu vực gốc; `parentId=<id>` lấy con trực tiếp; `includeLegacy` mặc định `false` (ẩn khu vực hành chính cũ); `q` tìm không dấu | A, M, S | query `parentId, type, q, isActive, includeLegacy, page, limit` | `{ data: [Ref + { name, type, parentId, path: Ref[], adminCode, isLegacy, order, isActive }], meta }` | C1, X7 |
| POST | `/crm/areas` | Thêm khu vực | A | body `{ name*, type*, parentId?, adminCode?, order? }` | `201 { data }` | X7 |
| PATCH | `/crm/areas/:id` | Sửa / chuyển cha (`parentId=null` = về gốc). `ancestorIds` của cả nhánh con được cập nhật **đồng bộ trong cùng transaction** (không dùng job nền); chặn chuyển vào chính nó hoặc nhánh con (400); trùng tên trong cùng cha ⇒ 409 `CATALOG_DUPLICATED` | A | body `{ name?, parentId?, isActive?, isLegacy?, order? }` | `{ data }` | X7 |
| DELETE | `/crm/areas/:id` | Xóa mềm (không xóa khi còn con hoặc đang dùng) | A | — | `204` | X7 |
| GET | `/crm/contact-results` | Kết quả liên hệ + gợi ý mốc hẹn | A, M, S | query `isActive, page, limit` | `{ data: [Ref + { code, suggestedFollowUpDays, suggestionText }], meta }` | C2, C3 |
| POST | `/crm/contact-results` | Thêm kết quả liên hệ | A | body `{ code*, label*, suggestedFollowUpDays?, suggestionText?, order? }` | `201 { data }` | C3 |
| PATCH | `/crm/contact-results/:id` | Sửa | A | body các field POST trừ `code` + `isActive?` | `{ data }` | C3 |
| DELETE | `/crm/contact-results/:id` | Xóa mềm | A | — | `204` | C3 |
| GET | `/crm/projects` | Danh sách dự án (ô chọn nhiều khi nhập hồ sơ) | A, M, S | query `q, status, areaId, isActive, isDeleted (chỉ A: xem dự án đã xóa mềm), page, limit (mặc định `limit=100`, quy ước danh mục nhỏ), sort ∈ {name, createdAt}` | `{ data: Project[], meta }` — `Project { id, name, code, developer, location, area: Ref\|null, propertyTypes, priceFrom, priceTo, status, isActive, customerCount, deletedAt }` | C1, X7 |
| GET | `/crm/projects/:id` | Chi tiết dự án | A, M, S | — | `{ data: Project + { description, customerCount } }` | X7 |
| POST | `/crm/projects` | Thêm dự án. `code` bắt buộc, regex `^[A-Za-z0-9]{1,30}$` (chỉ chữ A-Z không dấu và số 0-9, viết liền, không `-`, không `_`, tối đa 30 ký tự; đổi ngày 2026-11-04), unique không phân biệt hoa thường (kể cả đã xóa mềm); sai định dạng ⇒ 400 `VALIDATION_FAILED`. `status` ∈ `UPCOMING`\|`SELLING`\|`SOLD_OUT` (mặc định `UPCOMING`); `priceFrom ≤ priceTo` | A | body `{ name*, code*, developer?, location?, areaId?, propertyTypes?, priceFrom?, priceTo?, status?, description? }` | `201 { data: Project }`; 409 `PROJECT_CODE_DUPLICATED` | X7 |
| PATCH | `/crm/projects/:id` | Sửa dự án; `isActive=false` = **ngừng hoạt động** (ẩn khỏi ô chọn mới, khách cũ giữ liên kết, hiển thị "đã ngừng"). **Mã (`code`):** gửi lại đúng mã hiện có (không phân biệt hoa thường) thì được chấp nhận dù là mã cũ có `-`/`_` (không migrate dữ liệu cũ); đổi sang mã khác phải theo quy tắc mới như POST, sai ⇒ 400 `VALIDATION_FAILED` (do DTO: `message` là mảng, không có `details`; do service: `details.fields=['code']`; FE chỉ dựa vào `errorCode`/`message`); trùng mã khác ⇒ 409. FE luôn gửi `code` HOA nên mã cũ `old_code-1` được lưu thành `OLD_CODE-1` khi sửa (giữ `_`/`-`, có audit) | A | body như POST (tùy chọn) + `isActive?` | `{ data: Project }`; 400 `VALIDATION_FAILED`; 409 `PROJECT_CODE_DUPLICATED` | X7 |
| DELETE | `/crm/projects/:id` | Xóa mềm (`deletedAt`) chỉ khi không còn khách tham chiếu; còn khách ⇒ 409, Quản trị dùng PATCH `isActive=false` | A | — | `204`; 409 `PROJECT_IN_USE { customerCount }` | X7 |
| POST | `/crm/project-restorations` | Khôi phục dự án đã xóa mềm | A | body `{ projectId*, reason? }` | `201 { data: Project }`; 404 `RESOURCE_NOT_FOUND` | X7 |

### 2.9 Lịch hẹn & việc hôm nay (8) — **đã làm ở M5**

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/appointments` | Lịch tuần/tháng hoặc theo khách. **M5:** phạm vi theo KHÁCH của người gọi (NV: khách mình thuộc nhóm chăm sóc, kể cả lịch của người khác trong nhóm; Quản lý: nhóm mình quản lý, nhóm chăm sóc có mình hoặc khách mình tạo; Nhân viên: thêm khách mình tạo (v1.0.6, FR-31); Quản trị: tất cả; bị gỡ khỏi khách ⇒ không còn thấy lịch của khách đó). `from`/`to` dạng `YYYY-MM-DD` là ngày giờ VN (đầu/cuối ngày), ISO 8601 là thời điểm tuyệt đối; thiếu `from`/`to`, `to` < `from` hoặc quá 62 ngày ⇒ 400 `VALIDATION_FAILED`. `sort` chỉ `startAt`/`-startAt`. Response có thêm `version` (khóa lạc quan), `canEdit`, `canDelete` (v1.0.6) và `assignees`. Filter `assigneeIds` khớp lịch có BẤT KỲ người nào trong danh sách (v1.0.6; lịch chưa backfill vẫn khớp theo `assigneeId` cũ) | A, M-P, S-P | query `from*, to* (ISO/ngày VN, tối đa 62 ngày), customerId, projectId (G7: chỉ lịch của dự án này, sai định dạng ⇒ 400), assigneeIds, types, status, page, limit (≤100), sort ∈ {startAt}` | `{ data: Appointment[], meta }` | C3 |
| POST | `/crm/appointments` | Tạo lịch hẹn/nhắc việc; tự tạo `reminders`; cập nhật `customers.nextAppointmentAt` (lịch SCHEDULED chưa xóa sớm nhất, kể cả đã quá giờ mà chưa xử lý). **[IK]** **M5:** `startAt` không được ở quá khứ (dung sai 5 phút), `endAt` sau `startAt` và ≤ 24 giờ; không kiểm trùng/giao lịch (một người có thể dẫn nhiều khách cùng giờ). **v1.0.6 (FR-30, thay "`assigneeId` phải thuộc nhóm chăm sóc, mặc định mình hoặc phụ trách chính"):** ai trong phạm vi khách cũng tạo được lịch; `assigneeIds` 1 đến 20 người (id trùng được khử trùng giữ thứ tự; mảng rỗng ⇒ 400 `VALIDATION_FAILED`), mỗi người phải thuộc **tập hợp lệ** của khách = thành viên `careTeam` ACTIVE hợp Manager ACTIVE của nhóm chủ (nhóm của người tạo khách) hợp người tạo khách ACTIVE (kể cả ngoài `careTeam`); Quản trị khác ngoài tập (kể cả tự giao cho mình) bị loại; bỏ trống `assigneeIds` thì mặc định = người đặt lịch nếu thuộc tập, không thì phụ trách chính. `assigneeId` (đơn) vẫn nhận nhưng deprecated, chỉ dùng khi không gửi `assigneeIds`; bản ghi luôn ghi kép `assigneeId = assigneeIds[0]` tới v1.0.7. Sai ⇒ 400 `USER_NOT_ASSIGNABLE` với `details = { userIds, reason }`, `reason` ∈ `NOT_IN_CARE_TEAM` (id ngoài tập, kể cả id không tồn tại; kiểm TRƯỚC), `NOT_ACTIVE` (tài khoản không tồn tại, bị khóa hoặc đã xóa), `NOT_CRM_ROLE` (không có vai trò Quản trị/Quản lý/Nhân viên); thông điệp riêng từng `reason` (xem mục 5). `remindBeforeMinutes`: tối đa 5 mốc khác nhau, 0 – 10080 phút; không gửi = mặc định theo `/crm/settings` (`defaultAppointmentReminderMinutes`), `[]` = không nhắc; mốc đã qua thì bỏ (không nhắc bù); NGOẠI LỆ: lịch còn ở tương lai mà mọi mốc đã qua (hẹn gần hơn mốc nhỏ nhất) ⇒ vẫn có MỘT nhắc gửi ngay cho mốc nhỏ nhất (khóa chống trùng ổn định, sync lại/restart không gửi thêm); lịch đã qua giờ thì không nhắc. Lịch + khách + nhắc + audit cùng một transaction. **G7:** `projectId` tùy chọn (mọi loại lịch, không bắt buộc; `null`/bỏ trống = không gắn); dự án phải tồn tại, chưa xóa mềm và đang hoạt động, sai ⇒ 400 `VALIDATION_FAILED` `details.field = projectId` (không có mã riêng, cùng quy ước các danh mục khác), id sai định dạng ⇒ 400; audit ghi thêm `appointment.project` (tên dự án) | A, M-P, S-P | body `{ customerId*, type* (`SITE_VISIT`\|`MEETING`\|`DEPOSIT_CONTRACT` "Ký cọc / HĐMB"\|`CALLBACK`\|`OTHER`), startAt*, endAt?, title?, location?, note?, assigneeIds? (v1.0.6: 1-20 ObjectId, mặc định người đặt lịch nếu thuộc tập hợp lệ, không thì phụ trách chính), ~~assigneeId?~~ (deprecated, bỏ v1.0.7), projectId? (ObjectId\|null), remindBeforeMinutes? }` | `201 { data: Appointment }`; 400 `USER_NOT_ASSIGNABLE` | C3, X5, FR-30 |
| GET | `/crm/appointments/:id` | Chi tiết | A, M-P, S-P | — | `{ data: Appointment }` | C3 |
| PATCH | `/crm/appointments/:id` | Dời lịch / sửa (tính lại reminders). **M5:** chỉ sửa được lịch SCHEDULED (khác ⇒ 409 `APPOINTMENT_STATUS_INVALID`, mở lại lịch trước); dời `startAt` phải ở tương lai; `version` tùy chọn — gửi lên mà lệch ⇒ 409 `VERSION_CONFLICT { currentVersion }`; không có thay đổi thì không tăng version/không audit; `endAt: null` bỏ giờ kết thúc. **G7:** `projectId` bỏ trống = giữ nguyên, `null` = gỡ dự án, đổi sang dự án KHÁC thì dự án mới phải đang hoạt động (sai ⇒ 400 `VALIDATION_FAILED` `details.field = projectId`); gửi lại đúng dự án cũ (kể cả đã ngừng hoạt động) thì bỏ qua kiểm tra; đổi dự án được audit `appointment.project`. **v1.0.6 (FR-30, FR-32):** `assigneeIds?` (1-20; thay cả danh sách; chỉ kiểm các id MỚI THÊM so với danh sách cũ, người đã có mà sau đó rời tập hợp lệ vẫn giữ được; `assigneeIds: []` ⇒ 400; gửi trùng id thì khử trùng giữ thứ tự; thay đổi lịch dựng lại nhắc, người nhận chốt lúc gửi); **chỉ người tạo lịch hoặc Quản trị sửa được** (người thực hiện không phải người tạo, Manager, thành viên khác: 403 `INSUFFICIENT_ROLE`) | A, TG | body `{ startAt?, endAt?, type?, title?, location?, note?, assigneeIds? (v1.0.6), ~~assigneeId?~~ (deprecated), projectId? (ObjectId\|null), remindBeforeMinutes? }` | `{ data: Appointment }`; 400 `USER_NOT_ASSIGNABLE`; 403 `INSUFFICIENT_ROLE` | C3, FR-30, FR-32 |
| PATCH | `/crm/appointments/:id/status` | Hoàn thành / hủy / mở lại; tùy chọn ghi luôn nhật ký kết quả. **M5:** SCHEDULED → DONE hoặc CANCELED; DONE/CANCELED → SCHEDULED (mở lại); DONE ↔ CANCELED trực tiếp ⇒ 409 `APPOINTMENT_STATUS_INVALID`; cùng trạng thái hiện tại là no-op (200, không ghi nhật ký lần hai). `createCareLog` chỉ khi sang DONE (khác ⇒ 400): ghi nhật ký (kênh theo loại lịch, nội dung = `outcome` hoặc câu mặc định) trong CÙNG transaction, response có thêm `careLog`. DONE/CANCELED hủy nhắc chưa gửi, mở lại dựng lại nhắc cho giờ hiện tại; `nextAppointmentAt` tính lại. **v1.0.6 (FR-32): đổi trạng thái tính là sửa nên chỉ người tạo lịch hoặc Quản trị làm được** (người thực hiện không phải người tạo: 403 `INSUFFICIENT_ROLE`) | A, TG | body `{ status* (DONE\|CANCELED\|SCHEDULED), outcome?, createCareLog?: boolean }` | `{ data: Appointment + { careLog? } }`; 403 `INSUFFICIENT_ROLE` | C2, C3, FR-32 |
| DELETE | `/crm/appointments/:id` | Xóa mềm (nhập nhầm). **v1.0.6 (FR-32, thay quy tắc M5 "Quản trị/Quản lý xóa mọi lịch"): chỉ người tạo lịch hoặc Quản trị xóa được** (Manager không còn xóa lịch người khác ⇒ 403 `INSUFFICIENT_ROLE`); hủy nhắc chưa gửi, tính lại `nextAppointmentAt` | TG, A | — | `204` | C3 |
| GET | `/crm/daily-tasks` | "Việc hôm nay" theo nhóm Quá hạn / Hôm nay / Sắp tới (lịch hẹn, bước tiếp theo, dịp đặc biệt, khách lâu chưa chăm sóc). **M5:** TÍNH từ dữ liệu thật theo ngày giờ VN (không lưu việc), mọi nguồn lọc theo phạm vi khách của người gọi. Nhóm theo NGÀY VN của `dueAt`: trước hôm nay = Quá hạn, trong hôm nay (kể cả giờ đã qua) = Hôm nay, sau hôm nay tới hết `upcomingDays` (mặc định 7, tối đa 30) = Sắp tới. Nguồn: APPOINTMENT (lịch SCHEDULED); FOLLOW_UP (`nextAction.dueAt` của nhật ký MỚI NHẤT của khách, chưa có lịch hẹn kèm; có nhật ký mới hơn là việc biến mất); OCCASION (từ hôm nay tới hết `max(occasionLeadDays)` ngày, bỏ khách nhóm Rớt; `dueAt` = 08:00 VN của ngày dịp); STALE_CUSTOMER (Chưa tiếp cận/Có quan tâm quá `staleCustomerDays`, luôn nhóm Hôm nay, `dueAt` = bây giờ). `scope=mine` (mặc định): lịch mình thực hiện (nằm trong `assigneeIds`, v1.0.6) hoặc lịch của khách mình thuộc nhóm chăm sóc; FOLLOW_UP mình ghi hoặc phụ trách chính; OCCASION khách mình thuộc nhóm chăm sóc; STALE khách mình phụ trách chính. `scope=team` chỉ Quản trị/Quản lý (NV ⇒ 403). Sắp theo `dueAt` tăng dần, phân trang chính xác giữa các nguồn. Response `DailyTask` có thêm `id`, `title`, `careLogId?`, `assignee` so với 1.6; **v1.0.6:** thêm `assignees`, `canEdit`, `canDelete` (việc APPOINTMENT: cùng điều kiện sửa/xóa lịch hẹn, tức người tạo lịch hoặc Quản trị). **G7:** thêm `project: Ref\|null` ở cấp việc = dự án của lịch hẹn (chỉ việc APPOINTMENT có lịch gắn dự án, vẫn trả tên khi dự án đã ngừng/ẩn; việc khác và lịch chưa gắn dự án = `null`); `customer.projects` giữ nguyên nghĩa là các dự án khách quan tâm | A, M, S (mặc định việc của mình) | query `group? (OVERDUE\|TODAY\|UPCOMING; bỏ trống = cả 3 nhóm, dùng cho chế độ Kanban), scope (mine\|team — team chỉ A/M), kinds, upcomingDays (mặc định 7), page, limit` | `{ data: DailyTask[], meta }` | C3, C13, X5 |
| GET | `/crm/daily-tasks/summary` | Số việc mỗi nhóm (badge tab, app); cùng quy tắc nhóm/phạm vi với `GET /crm/daily-tasks` (`scope=team` chỉ A/M) | A, M, S | query `scope, upcomingDays` | `{ data: { overdue, today, upcoming } }` | C3 |

### 2.10 Thông báo & thiết bị (10) — dùng chung toàn app. **M5 làm 6 endpoint (hộp thông báo 4 + cài đặt 2); v1.0.4 (M7) thêm `/push-subscriptions` (4, Web Push VAPID cho PWA) thay cho `/device-tokens` (FCM, không còn dùng)**

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/notifications` | Hộp thông báo (chuông) của CHÍNH người gọi, mới nhất trước. **M5:** loại thông báo: CUSTOMER_ASSIGNED (v1.0.5: gửi cho người được **mời**, không gửi tài khoản bị khóa), APPOINTMENT_DUE (**v1.0.6, FR-33**: gửi đúng những người trong `assigneeIds` còn thuộc tập hợp lệ hiện tại của khách, ACTIVE, chưa xóa; phụ trách chính nếu có trong danh sách nhận `priority = HIGH`; hết người thì nhắc chưa gửi thành `CANCELED`), FOLLOW_UP_DUE, CARE_LOG_ADDED (gộp theo khách trong `careLogNotifyDebounceMinutes`), STALE_CUSTOMER (chỉ phụ trách chính), CUSTOMER_OCCASION, ~~CARE_TEAM_JOIN_REQUESTED/RESOLVED~~ (v1.0.5: không còn phát sinh, giữ giá trị enum để đọc thông báo cũ), SECURITY_ALERT (cảnh báo bất thường gửi Quản trị: `PHONE_SEARCH_ANOMALY`, `PHONE_VIEW_ALERT`, `NATIONAL_ID_VIEW_ALERT`; loại mới thêm ở M5), IMPORT_COMPLETED/EXPORT_READY (M8). Nội dung không chứa SĐT/CCCD; thông báo gắn với khách bị xóa khi khách bị ẩn danh hóa. EDITOR ⇒ 403 | Self | query `isRead, types, page, limit` | `{ data: [{ id, type, title, body, data: { customerId?, appointmentId?, deepLink }, priority, readAt, createdAt }], meta }` | X5 |
| GET | `/notifications/unread-count` | Số chưa đọc | Self | — | `{ data: { count } }` | X5 |
| PATCH | `/notifications/:id` | Đánh dấu một thông báo đã đọc/chưa đọc (giữ mốc `readAt` đầu tiên); thông báo của người khác hoặc không tồn tại ⇒ 404 `RESOURCE_NOT_FOUND` | Self | body `{ isRead* }` | `{ data: Notification }` | X5 |
| PATCH | `/notifications` | Đánh dấu đã đọc hàng loạt (chỉ thông báo của mình; `ids` tối đa 200; `isRead` chỉ nhận `true`) | Self | body `{ isRead: true, ids? (bỏ trống = tất cả), before? }` | `{ data: { updated } }` | X5 |
| GET | `/push-subscriptions/config` | Cấu hình push cho trình duyệt (v1.0.4, M7). `enabled` = cờ `FEATURE_CRM_PUSH` bật **và** đủ `VAPID_*` hợp lệ; `publicKey` là khóa công khai VAPID (không bí mật) để `pushManager.subscribe`, `null` khi `enabled=false`. Vẫn gọi được khi cờ push tắt | Self (CRM) | — | `{ data: { enabled, publicKey } }` | X5, X9 |
| GET | `/push-subscriptions` | Thiết bị của chính mình: `active` (đang hiệu lực) và `recentlyRevoked` (thu hồi trong 7 ngày gần nhất, mới nhất trước, kèm lý do). Không bao giờ trả `endpoint`, `keys` hay `auth` | Self (CRM) | — | `{ data: { active: [{ id, deviceLabel, platform, lastSeenAt, createdAt }], recentlyRevoked: [{ deviceLabel, reason (USER\|LOGOUT\|GONE\|LIMIT_EXCEEDED\|ACCOUNT_DISABLED), revokedAt }] } }` | X5, X9 |
| POST | `/push-subscriptions` | Đăng ký/làm mới thiết bị nhận push (upsert theo `endpoint`, gán lại cho người gọi). `userId` luôn lấy từ JWT. Tối đa 3 thiết bị còn hiệu lực mỗi người: đăng ký thiết bị thứ 4 thì thiết bị ít hoạt động nhất bị gỡ (lý do `LIMIT_EXCEEDED`, trả trong `displaced`). `endpoint` phải là `https`, tối đa 1024 ký tự, host thuộc dịch vụ push cho phép (FCM, Mozilla, Apple, WNS, cộng `PUSH_ENDPOINT_HOST_ALLOWLIST` nếu cấu hình) để chống SSRF. `auth` được mã hóa khi lưu, không trả lại. Giới hạn 10 yêu cầu/phút/người | Self (CRM) | body `{ endpoint*, keys*: { p256dh*, auth* }, expirationTime? }` | `201` (mới) hoặc `200` (endpoint đã có) `{ data: { id, deviceLabel, platform (IOS\|ANDROID\|DESKTOP\|OTHER), createdAt, lastSeenAt, displaced: { id, deviceLabel } \| null } }`; 400 `PUSH_SUBSCRIPTION_INVALID` (endpoint không https/ngoài allowlist/khóa sai) hoặc `VALIDATION_FAILED`; 429 `RATE_LIMITED` | X5, X9 |
| DELETE | `/push-subscriptions/:id` | Gỡ một thiết bị của chính mình (lý do `USER`). Idempotent: gỡ lại vẫn `204`. Thiết bị không có hoặc của người khác ⇒ 404 `RESOURCE_NOT_FOUND`. Bản gỡ được giữ 7 ngày (hiển thị "đã gỡ thiết bị X") rồi tự xóa | Self (CRM) | — | `204` | X5 |
| GET | `/notification-preferences/me` | Cài đặt bật/tắt từng loại thông báo; trả đủ mọi loại (loại chưa lưu = bật cả `push` và `inApp`). **v1.0.4:** kèm `pushTypes` lấy từ danh mục push (đúng 4 loại, theo thứ tự danh mục) để FE hiện công tắc push; loại ngoài danh mục không có push | Self | — | `{ data: { types: { [type]: { push, inApp } }, quietHours, pushTypes: [{ type, label, description, defaultEnabled, canDisable }] } }` | X5, §5 |
| PUT | `/notification-preferences/me` | Lưu cài đặt. **M5:** chỉ cập nhật các loại gửi lên (loại khác giữ nguyên); khóa không phải NotificationType hoặc giá trị không đủ `{ push, inApp }` boolean ⇒ 400; `quietHours: null` bỏ giờ yên lặng, `start` ≠ `end`. `inApp=false` ⇒ loại đó không được ghi vào hộp thông báo của người này **và cũng không có push** (push đi theo thông báo gốc). **v1.0.4:** `push=false` tắt push của loại đó; giờ yên lặng (`quietHours`, giờ VN, `start` bao gồm, `end` không bao gồm, `start > end` là qua nửa đêm) có hiệu lực: push trong khung này bị bỏ qua (`SKIPPED`), thông báo vẫn nằm trong hộp thông báo | Self | body `{ types*: { [type]: { push, inApp } }, quietHours?: { start, end } \| null }` | `{ data: Preferences }` | X5, §5 |

### 2.11 Lịch sử & audit (2)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers/:id/histories` | Lịch sử thay đổi của khách: ai, lúc nào, đổi gì (gồm mọi lần đổi tình trạng, người chăm sóc). Sự kiện **tạo khách** ghi SĐT dạng che (tài liệu chưa quy định; lý do: ghi đầy đủ sẽ cho người chỉ được xem lịch sử đọc được số mà không để lại `PHONE_VIEWED`); sự kiện **sửa** ghi SĐT cũ → mới đầy đủ. Không hiện `PHONE_LOOKUP` và các cảnh báo (chỉ ở `/crm/audit-logs`). `changes` lưu **giá trị trường đầy đủ** (SĐT cũ → mới hiển thị cho mọi người xem được khách; CCCD luôn che). Mục xem CCCD (`NATIONAL_ID_VIEWED`) và xem/gọi SĐT (`PHONE_VIEWED`, không có số) chỉ trả cho A/M | A, M-P, S-P | query `actions, actorId, from, to, page, limit` | `{ data: HistoryEntry[], meta }` | X4 |
| GET | `/crm/audit-logs` | Audit toàn CRM (export, import, danh mục, xem CCCD, dò số…); `entityType` phải thuộc enum, sai ⇒ 400 | A | query `entityType, action, actorId, customerId, from, to, page, limit` | `{ data: [HistoryEntry + { entityType, entityId, customerId, requestId, ip }], meta }` | X4, §5 |

### 2.12 Import / Export (12)

> **Ghi chú v1.0.4 (FR-13, FR-40):** dữ liệu danh mục của khách và nhật ký đã lưu kèm `…Code` (mã chữ ổn định) bên cạnh `…Id`. Các endpoint export dưới đây (M8) chưa được làm ở v1.0.4; khi làm, **mỗi cột danh mục (tình trạng, nguồn, khu vực, dự án quan tâm, kết quả liên hệ) trong file xuất phải có cặp `code` + `label`** để người đọc file (kể cả công cụ/agent bên ngoài) hiểu nghĩa mà không cần tra ObjectId.

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/import-mapping-templates` | Mẫu map cột do người dùng tạo (mẫu hệ thống DSKH, DSKH_DROP, DSKH_NET: **hoãn giai đoạn sau, cần file mẫu thật**) | A | query `page, limit` | `{ data: [{ id, code, name, defaultStatusCode, columns: [{ header, aliases, target, transform }], isSystem }], meta }` | X8 |
| POST | `/crm/import-mapping-templates` | Tạo mẫu map tùy chỉnh | A | body `{ code*, name*, defaultStatusCode?, columns*[] }` (`target` ∈ `fullName, phone, source, projects, area, nationalId, status, criteria.<key>.description, criteria.<key>.isDone, assignees, primaryAssignee, lastUpdatedAt, careLogs, tags, persona.<fieldKey>, ignore`; `transform` ∈ `SPLIT_COMMA, DATE_DMY, BOOLEAN_MARK, PHONE, TRIM`) | `201 { data: Template }` | X8 |
| PATCH | `/crm/import-mapping-templates/:id` | Sửa mẫu | A | body như POST (tùy chọn) | `{ data: Template }` | X8 |
| GET | `/crm/import-mapping-templates/:id/sample-file` | Tải file Excel mẫu đúng cột của template | A | query `format (XLSX\|CSV)` | file `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` / `text/csv` | X8 |
| POST | `/crm/customer-imports` | Upload file và tạo job (mặc định chạy thử). `multipart/form-data`, ≤ 10 MB, MIME xlsx/csv + kiểm magic bytes. **[IK]** | A | form `file*, mappingTemplateId*, sheetName?, isDryRun (mặc định true), duplicatePolicy (SKIP\|FILL_EMPTY\|OVERWRITE), assigneeMapping (JSON `[{ sheetValue, userId }]`), defaultPrimaryUserId?, defaultTeamId?` | `202 { data: { jobId, status: 'UPLOADED' } }`; 415 `IMPORT_FILE_TYPE_INVALID` | X8 |
| GET | `/crm/customer-imports` | Lịch sử các lần import | A | query `status, page, limit` | `{ data: ImportJob[], meta }` | X8 |
| GET | `/crm/customer-imports/:id` | Trạng thái, tiến độ, tổng kết; link file lỗi khi có | A | — | `{ data: { id, status, isDryRun, progress: { total, processed }, summary: { valid, created, updated, skipped, duplicateInFile, duplicateInDb, errors }, errorFileUrl?, createdBy, startedAt, finishedAt } }` | X8 |
| GET | `/crm/customer-imports/:id/rows` | Xem trước/kết quả từng dòng | A | query `status, page, limit` | `{ data: [{ rowNumber, sheet, status, messages, preview: { fullName, phoneMasked, status, assignees } , customerId? }], meta }` | X8 |
| PATCH | `/crm/customer-imports/:id` | Xác nhận nhập thật sau chạy thử, hoặc hủy | A | body `{ status* (CONFIRMED\|CANCELED) }` | `202 { data: { jobId, status: 'IMPORTING' } }`; 409 `IMPORT_NOT_VALIDATED` | X8 |
| POST | `/crm/customer-exports` | Tạo job export theo bộ lọc danh sách (áp dụng phạm vi). **[IK]**. Throttle 5/giờ. File **chứa SĐT đầy đủ, không chứa CCCD đầy đủ** (`••••1234`); ghi audit `CUSTOMER_EXPORTED` mỗi lần (bộ lọc, cột, số dòng, không lưu số); chặn CSV formula injection | A, M-P | body `{ format* (XLSX\|CSV), filters (giống query GET /crm/customers), columns[] }` | `202 { data: { jobId, status: 'QUEUED' } }` | X8 |
| GET | `/crm/customer-exports` | Các lần export của mình (A thấy tất cả) | A, M | query `status, page, limit` | `{ data: ExportJob[], meta }` | X8 |
| GET | `/crm/customer-exports/:id` | Trạng thái; khi `READY` kèm signed URL (15 phút) | A, M (người tạo) | — | `{ data: { id, status, rowCount, format, downloadUrl?, expiresAt } }` | X8 |

### 2.13 Dashboard (3)

Tất cả nhận query chung: `from, to` (ngày VN, theo `createdAt` hoặc `statusChangedAt` tùy chỉ số), `teamIds`, `assigneeIds`, `projectIds`. Phạm vi: A tất cả, M nhóm mình.

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/dashboard/summary` | Thẻ số liệu: tổng khách, theo nhóm danh sách, khách mới trong kỳ, tiến độ trung bình, lịch hẹn hoàn thành, khách lâu chưa chăm sóc (cả Chưa tiếp cận và Có quan tâm) | A, M-P | query chung | `{ data: { totalCustomers, byListGroup: { NOT_CONTACTED, INTERESTED, NET, DROPPED }, newCustomers, averageProgress, appointmentsDone, staleCustomers } }` | X6 |
| GET | `/crm/dashboard/breakdowns` | Phân bố theo một chiều | A, M-P | query chung + `dimension* (status\|source\|project\|area\|primaryAssignee\|tag)`, `limit` (top N) | `{ data: [{ key: Ref, count, averageProgress }] }` | X6 |
| GET | `/crm/dashboard/assignee-stats` | Khách theo người chăm sóc: tách "phụ trách chính" và "cùng chăm sóc" | A, M-P | query chung + `page, limit, sort ∈ {primaryCount, memberCount, careLogCount, averageProgress}` | `{ data: [{ user: UserRef, primaryCount, memberCount, careLogCount, appointmentsDone, averageProgress, staleCount }], meta }` | X6, QT7 |

### 2.14 Cài đặt CRM (2)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/settings` | Cấu hình nhắc việc và quy tắc | A (M đọc) | — | `{ data: { staleCustomerDays, staleCheckTime, occasionNotifyTime, occasionLeadDays, defaultAppointmentReminderMinutes, careLogEditWindowHours, careLogNotifyDebounceMinutes, phoneViewAlertPerHour } }` | C3, C13, X5 |
| PATCH | `/crm/settings` | Sửa cấu hình (scheduler đọc lại ở lần chạy kế) | A | body các field trên (tùy chọn) | `{ data: Settings }` | C3, C13, X5 |

### 2.15 Health — dùng lại (2)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/health/liveness` | Liveness (có sẵn) | Public | — | Terminus | — |
| GET | `/health/readiness` | Readiness: MongoDB (có sẵn) + **Redis** (mở rộng) | Public | — | Terminus | — |

---

## 3. Tổng hợp số lượng

| Nhóm | Dùng lại | Mới | Tổng |
|---|---|---|---|
| 2.1 Auth | 4 | 0 | 4 |
| 2.2 Người dùng & nhóm | 4 | 6 | 10 |
| 2.3 Khách hàng | 0 | 14 | 14 |
| 2.4 CCCD và xem/gọi SĐT | 0 | 5 | 5 |
| 2.5 Nhóm chăm sóc & mời thành viên | 0 | 4 | 4 |
| 2.6 Nhật ký chăm sóc và ảnh đính kèm | 0 | 6 | 6 |
| 2.7 Chân dung & thẻ | 0 | 11 | 11 |
| 2.8 Danh mục & dự án | 0 | 22 | 22 |
| 2.9 Lịch hẹn & việc hôm nay | 0 | 8 | 8 |
| 2.10 Thông báo & thiết bị | 0 | 10 | 10 |
| 2.11 Lịch sử & audit | 0 | 2 | 2 |
| 2.12 Import / Export | 0 | 12 | 12 |
| 2.13 Dashboard | 0 | 3 | 3 |
| 2.14 Cài đặt CRM | 0 | 2 | 2 |
| 2.15 Health | 2 | 0 | 2 |
| **Tổng** | **10** | **105** | **115** |

> v1.0.5: 2.2 vẫn 10 (`assignable-users` thay bằng `customer-assignees`); 2.3 còn 14 (bỏ `phone-lookups`; bảng v1.0.4 ghi 14 nhưng có 15 dòng); 2.5 còn 4 (bỏ `PUT primary` và 3 `care-team-requests`, thêm `care-team-invitees`). ~~Tổng v1.0.4: 118 (10 + 108).~~ Nhóm 2.12 (Import/Export, 12) và 2.13 (Dashboard, 3) được tính ở đây theo thiết kế nhưng **chưa có controller ở BE** (hiện chỉ có ở mock FE), nên số endpoint "có thật trong BE" thấp hơn 115.

---

## 4. Ma trận yêu cầu → API

| ID | Endpoint chính |
|---|---|
| C1 | `POST/GET/PATCH /crm/customers`, `/crm/projects`, `/crm/lead-sources`, `/crm/areas`, `/crm/customer-statuses` |
| C2 | `/crm/customers/:id/care-logs` (4), `/crm/customers/:id/care-log-attachments` (2) |
| C3 | `POST care-logs` (`nextAction`), `/crm/appointments` (6), `/crm/daily-tasks` (2), `/crm/contact-results` |
| C4, C5 | `PATCH /crm/customers/:id/criteria` (progress server tính; có thể tự đổi tình trạng theo tiến độ, v1.0.3 PT-023) |
| C6 | `GET /crm/customers?listGroup=`, `list-counts`, `PATCH .../status` |
| C7 | Mọi PATCH trên khách (server ghi `lastUpdatedAt`) |
| C8 | `/crm/customers/:id/care-team*` (3: GET, POST members, DELETE member; ~~`PUT primary`~~ đã xóa v1.0.5), `/crm/care-team-invitees`, `/crm/customer-assignees`, bulk `ASSIGN` (~~`/crm/assignable-users`~~ đã xóa v1.0.5) |
| C9 | `/crm/customers/:id/national-id*` (4) |
| C14 | `POST /crm/customers/:id/phone-views` |
| C10, C12 | `GET/PATCH /crm/customers/:id/persona` |
| C11 | `/crm/tags` (4), bulk `ADD_TAGS/REMOVE_TAGS`, filter `tagIds` |
| C13 | Scheduler `occasions.scan` + `notifications`; trường chân dung `isOccasion` |
| X1 | `/auth/*`, `/users/*`, `/teams/*`, row-level scope mọi endpoint CRM |
| X2 | ~~`POST /crm/customers/phone-lookups`, 409 khi tạo, `/crm/care-team-requests` (3)~~ **Đã bỏ hoàn toàn ở v1.0.5** (FR-03, FR-12, FR-20): không còn tra trùng SĐT, không còn luồng xin tham gia; thay bằng mời (`care-team/members`, `care-team-invitees`). Mã yêu cầu X2 giữ lại để truy vết |
| X3 | Query của `GET /crm/customers` |
| X4 | `GET /crm/customers/:id/histories`, `GET /crm/audit-logs` |
| X5 | `/notifications` (4), `/push-subscriptions` (4, Web Push v1.0.4), `/notification-preferences/me` (2), scheduler |
| X6 | `/crm/dashboard/*` (3) |
| X7 | 2.8 (22, gồm CRUD dự án + `/crm/project-restorations`), `/users`, `/teams` |
| X8 | 2.12 (12, nhập/xuất chung; mẫu 3 sheet cũ giai đoạn sau) |
| X9 | Cùng API cho web và app; `/push-subscriptions` (Web Push VAPID cho PWA; push native FCM/APNs thuộc M9 là phương án cho app di động, không phải thiết kế hiện tại, hiện tại dùng Web Push VAPID); `X-Client-Type` ở auth |
| X10 | `/crm/persona-fields` (5) |
| FR-xx (v1.0.5) | Mã yêu cầu của tài liệu [`10_Dinh_Danh_Khach_Hang_Plan.md`](10_Dinh_Danh_Khach_Hang_Plan.md): FR-01..FR-06 (`POST/PATCH /crm/customers`, `phone-views`), FR-07..FR-09 (`customerCode` ở list/detail, tìm theo mã), FR-10, FR-11 (`care-team/members` DELETE ⇒ `PRIMARY_LOCKED`), FR-12..FR-17 (`care-team/members` POST, `care-team-invitees`), FR-18, FR-19 (`customer-assignees`, `isLocked`) |

---

## 5. Mã lỗi nghiệp vụ (`errorCode`)

| HTTP | `errorCode` | Khi nào | `details` |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | DTO không hợp lệ (ValidationPipe) | — (`message` là mảng) |
| 400 | `INVALID_PHONE` | SĐT không chuẩn hóa được | `{ input }` |
| 400 | `PRIMARY_REQUIRED` | Khách `careTeam` rỗng (khách cũ) được mời lần đầu mà thiếu `primaryUserId` (v1.0.5: tạo khách không còn lỗi này vì người tạo luôn là PRIMARY) | — |
| 400 | `USER_NOT_ASSIGNABLE` | Người được phân (mời, hoặc **v1.0.6: người thực hiện lịch hẹn**) không hợp lệ. Ba thông điệp theo `details.reason` (v1.0.6): `NOT_IN_CARE_TEAM` "Người thực hiện phải là thành viên nhóm chăm sóc, người tạo khách hoặc Quản lý của nhóm chủ khách; nhờ thành viên có quyền mời đưa người đó vào nhóm trước"; `NOT_ACTIVE` "Người thực hiện không còn hoạt động (tài khoản bị khóa hoặc đã xóa)"; `NOT_CRM_ROLE` "Người thực hiện không có vai trò CRM (cần là Quản trị, Quản lý hoặc Nhân viên)". Thứ tự kiểm: `NOT_IN_CARE_TEAM`, rồi `NOT_ACTIVE`, rồi `NOT_CRM_ROLE`. Mời thành viên dùng thông điệp cũ (không ACTIVE hoặc không phải MANAGER/STAFF) | `{ userIds, reason? }` (`reason` ∈ `NOT_IN_CARE_TEAM`, `NOT_ACTIVE`, `NOT_CRM_ROLE`; có ở lịch hẹn) |
| 400 | `PERSONA_VALUE_INVALID` | Giá trị sai kiểu trường / lựa chọn không tồn tại | `{ fieldKey }` |
| 400 | `SENSITIVE_FIELD_CONSENT_REQUIRED` | Trường nhạy cảm thiếu `source=CUSTOMER_SHARED` + xác nhận | `{ fieldKey }` |
| 400 | `PUSH_SUBSCRIPTION_INVALID` | Đăng ký thiết bị push: `endpoint` không `https`/quá dài/ngoài allowlist host, hoặc khóa `p256dh`/`auth` sai định dạng (v1.0.4) | — |
| 400 | `INVALID_SORT_FIELD` | `sort` ngoài whitelist | `{ allowed }` |
| 401 | `UNAUTHORIZED` | Token thiếu/hết hạn | — |
| 403 | `INSUFFICIENT_ROLE` | Vai trò không đủ (RolesGuard); **v1.0.6**: xóa khách không phải Quản trị/người tạo (đơn, và từng khách ở bulk `DELETE`), sửa/đổi trạng thái/xóa lịch hẹn hoặc sửa/xóa nhật ký, gỡ ảnh đã gắn không phải của mình (không phải Quản trị) | — |
| 403 | `NATIONAL_ID_FORBIDDEN` | Không có quyền xem CCCD đầy đủ (v1.0.6: không phải chủ khách = Quản trị, người tạo khách, Manager nhóm chủ) | — |
| 403 | `CARE_TEAM_ACTION_FORBIDDEN` | Mời/gỡ thành viên hoặc tra `care-team-invitees` theo khách mà không phải chủ khách (v1.0.6: Quản trị, người tạo khách, Manager nhóm chủ), thành viên thường thêm/gỡ người… | — |
| 404 | `CUSTOMER_NOT_FOUND` | Không tồn tại **hoặc ngoài phạm vi** | — |
| 404 | `RESOURCE_NOT_FOUND` | Tài nguyên khác | — |
| 409 | `CUSTOMER_ANONYMIZED` | Khôi phục/ẩn danh hóa lại khách đã được ẩn danh hóa (không hoàn tác được) | — |
| 409 | `CUSTOMER_NOT_DELETED` | Xóa vĩnh viễn khách chưa xóa mềm | — |
| 409 | `CUSTOMER_PURGE_IN_PROGRESS` | Khách đang xóa vĩnh viễn (dở hoặc đang chạy): không khôi phục/ẩn danh hóa/xóa vĩnh viễn song song; bấm Xóa vĩnh viễn lại để hoàn tất | — |
| 409 | `CUSTOMER_PHONE_NOT_SET` | **Mới v1.0.5.** `phone-views` trên khách không có SĐT (không ghi audit, không tốn hạn mức) | — |
| 409 | `VERSION_CONFLICT` | Hồ sơ đã bị người khác sửa | `{ currentVersion }` |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Cùng `X-Idempotency-Key` đang xử lý | — |
| 409 | `ALREADY_IN_CARE_TEAM` | Mời người đã có trong nhóm chăm sóc (v1.0.5 giữ mã này; ~~`JOIN_REQUEST_EXISTS`, `JOIN_REQUEST_RESOLVED`~~ đã xóa cùng luồng xin tham gia) | — |
| 409 | `PRIMARY_LOCKED` | **Mới v1.0.5.** Gỡ phụ trách chính (PRIMARY khóa vĩnh viễn; áp dụng cả Quản trị/Quản lý). **v1.0.6:** cũng báo khi gỡ **người tạo khách** khỏi `careTeam` (PRIMARY hay MEMBER, kể cả Quản trị) | `{ reason: 'CREATOR_LOCKED' }` khi gỡ người tạo (v1.0.6); còn lại — |
| 409 | `CARE_TEAM_LIMIT_EXCEEDED` | **Mới v1.0.5.** Mời vượt 10 thành viên phụ mỗi khách (`POST care-team/members`; ở bulk `ASSIGN` báo riêng từng khách) | `{ limit, membersAfter }` |
| 409 | `PROJECT_CODE_DUPLICATED` | Mã dự án trùng (kể cả dự án đã xóa mềm) | `{ code }` |
| 409 | `PROJECT_IN_USE` | Xóa dự án còn khách tham chiếu | `{ customerCount }` |
| 409 | `CATALOG_DUPLICATED` | Trùng `code` danh mục (kể cả bản đã xóa mềm), trùng tên khu vực trong cùng khu vực cha, trùng `key` trường chân dung (kể cả đã xóa), hoặc đổi tên thẻ trùng tên thẻ khác trong cùng nhóm | `{ field, value }` |
| 409 | `TEAM_CODE_DUPLICATED` | Trùng mã nhóm (kể cả nhóm đã xóa mềm) | `{ code }` |
| 409 | `LAST_ADMIN_REQUIRED` | Khóa hoặc hạ vai trò Quản trị đang hoạt động cuối cùng | — |
| 409 | `CATALOG_IN_USE` / `CATALOG_SYSTEM` | Xóa danh mục đang dùng / hệ thống | `{ usageCount }` |
| 409 | `PERSONA_FIELD_TYPE_LOCKED` | Đổi kiểu trường đã có dữ liệu khách (ưu tiên hơn `PERSONA_FIELD_SYSTEM` khi cả hai cùng đúng) | `{ valueCount }` |
| 409 | `PERSONA_FIELD_SYSTEM` | Xóa trường hệ thống (`{ valueCount }`), hoặc đổi kiểu trường hệ thống chưa có dữ liệu khách (`{ field: 'type' }`) | `{ valueCount }` hoặc `{ field }` |
| 409 | `TEAM_NOT_EMPTY` | Xóa nhóm còn thành viên | `{ memberCount }` |
| 409 | `IMPORT_NOT_VALIDATED` | Xác nhận import khi chưa chạy thử xong | `{ status }` |
| 409 | `APPOINTMENT_STATUS_INVALID` | Sửa lịch hẹn không còn ở trạng thái SCHEDULED, hoặc chuyển trạng thái không hợp lệ (DONE ↔ CANCELED phải mở lại trước) — thêm ở M5 | — |
| 413 | `FILE_TOO_LARGE` | File > 10 MB | `{ maxBytes }` |
| 415 | `IMPORT_FILE_TYPE_INVALID` | Không phải xlsx/csv hợp lệ | — |
| 415 | `ATTACHMENT_TYPE_INVALID` | Ảnh đính kèm không phải jpeg/png/webp hợp lệ | — |
| 400 | `ATTACHMENT_LIMIT_EXCEEDED` | Quá 5 ảnh/ghi chú | `{ max }` |
| 429 | `RATE_LIMITED` | Vượt Throttler (login, ~~phone-lookups~~, national-id-views, phone-views, exports, **`CARE_TEAM_INVITE` 30/phút**, **`INVITEE_SEARCH` 60/phút**; v1.0.5) | `{ retryAfterSeconds }` |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước (không lộ stack ở production) | — |
| 503 | `SERVICE_UNAVAILABLE` | Xóa vĩnh viễn khách: không xóa được file ở kho lưu trữ (hoặc kho chưa cấu hình); CHƯA xóa gì ở DB, khách ở trạng thái "đang xóa dở", bấm xóa lại được | `{ filesDeleted? }` |

> **v1.0.5 đã xóa khỏi `ErrorCode`:** `CUSTOMER_PHONE_DUPLICATED`, `JOIN_REQUEST_EXISTS`, `JOIN_REQUEST_RESOLVED`, `PRIMARY_REPLACEMENT_REQUIRED` (không còn đường nào phát ra). **Thêm:** `CUSTOMER_PHONE_NOT_SET`, `PRIMARY_LOCKED`, `CARE_TEAM_LIMIT_EXCEEDED`. Giữ `ALREADY_IN_CARE_TEAM`, `PRIMARY_REQUIRED`, `USER_NOT_ASSIGNABLE`. Đối chiếu nguồn: `RealEstateBackendApp/src/common/exceptions/error-codes.ts`.

> **v1.0.6 đã xóa khỏi `ErrorCode`:** `CUSTOMER_NOT_DROPPED` (xóa khách không còn điều kiện tình trạng "Bỏ", xem 2.3 và `13_Ma_Tran_Phan_Quyen_CRM.md`); khách không đủ quyền xóa nay báo `INSUFFICIENT_ROLE`. **Không thêm mã mới:** `USER_NOT_ASSIGNABLE` thêm `details.reason`, `PRIMARY_LOCKED` thêm `details.reason = CREATOR_LOCKED`, `INSUFFICIENT_ROLE`, `NATIONAL_ID_FORBIDDEN`, `CARE_TEAM_ACTION_FORBIDDEN` dùng lại. Bulk `DELETE` trả `failed[].errorCode` ∈ `INSUFFICIENT_ROLE`, `CUSTOMER_NOT_FOUND`, `INTERNAL_ERROR`.
