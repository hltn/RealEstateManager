# Danh sách API: Module Quản lý & chăm sóc khách hàng (CRM)

> Đi kèm [`04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) (data model mục 3, ma trận quyền mục 4.2). Mã yêu cầu (C*, X*, QT* = quy tắc mục 4) theo [`01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md`](01_Project_Plan_WebApp_Quan_Ly_Khach_Hang.md).
> **Tổng: 116 endpoint** — 10 dùng lại (Auth, Users, Health), 106 mới. Cập nhật 2026-10-22 (xem nhật ký quyết định ở 04 mục 11): bỏ mã khách hàng; thêm email; `listGroup` tách 4 giá trị + tab ảo `ALL`; thêm `phone-views` (xem/gọi SĐT, ghi `PHONE_VIEWED`); thêm ảnh đính kèm nhật ký (2 endpoint); dự án có CRUD đầy đủ + khôi phục (1 endpoint mới); import 3 sheet cũ hoãn giai đoạn sau. Mọi path dưới đây đã có global prefix **`/api/v1`** (ví dụ `GET /crm/customers` = `GET /api/v1/crm/customers`). Swagger: `/api/v1/docs`.

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
| Không nội dung | `204` (DELETE mềm, đăng xuất thiết bị) |

> Ghi chú: một số controller cũ (`/users`) đang trả object trần; CRM thống nhất bọc `{ data }`. Không sửa API cũ để giữ tương thích.

### 1.3 Response lỗi (`GlobalExceptionFilter`)

```json
{
  "statusCode": 409,
  "message": "Đã có khách này, do Hạnh chăm sóc",
  "timestamp": "2026-10-21T08:30:00.000Z",
  "path": "/api/v1/crm/customers",
  "errorCode": "CUSTOMER_PHONE_DUPLICATED",
  "details": { "customerRef": "66f1...", "caredByName": "Hạnh", "canRequestJoin": true }
}
```

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

`A` Quản trị, `M` Quản lý, `S` Nhân viên (`STAFF`); `P` = trong phạm vi khách của mình (row-level, 04 §4.3); `PR` = phụ trách chính; `TG` = tác giả; `Self` = chính mình; `Public` = không cần đăng nhập. `EDITOR` không có quyền CRM.

### 1.6 Kiểu dùng chung trong response

| Kiểu | Shape |
|---|---|
| `Ref` | `{ id, label }` (danh mục, dự án, thẻ) |
| `StatusRef` | `{ id, code, label, listGroup: 'NOT_CONTACTED'\|'INTERESTED'\|'NET'\|'DROPPED', color }` |
| `UserRef` | `{ id, displayName }` |
| `CareTeamMember` | `{ user: UserRef, role: 'PRIMARY'\|'MEMBER', addedAt, addedBy: UserRef }` |
| `Criterion` | `{ isDone, description, updatedAt, updatedBy: UserRef \| null }` |
| `CustomerListItem` | `{ id, fullName, phoneMasked (ví dụ `0912 ••• 678`; số đầy đủ qua `phone-views`), status: StatusRef, source: Ref\|null, projects: Ref[], area: Ref\|null, tags: Ref[], progress, criteriaDone: { demand, motivation, finance, timing } (boolean), primaryAssignee: UserRef\|null, careTeamSize, nextAppointmentAt, lastCareLogAt, lastUpdatedAt, personaCompleteness }` |
| `CustomerDetail` | `CustomerListItem` + `{ email: string\|null, canViewPhone, criteria: { demand, motivation, finance, timing: Criterion }, careTeam: CareTeamMember[], nationalIdMasked: '••••1234'\|null, hasNationalId, canRevealNationalId, dataConsent, lastUpdatedBy: UserRef, createdAt, createdBy: UserRef, createdVia, nextActionSuggestions: string[], permissions: { canEdit, canManageCareTeam, canChangePrimary, canDelete }, version }` |
| `PersonaFieldValue` | `{ fieldKey, label, groupCode, type, value, source, updatedAt, updatedBy: UserRef }` |
| `CareLog` | `{ id, customerId, author: UserRef, occurredAt, content, attachments: [{ id, thumbUrl, url (signed URL 15 phút), mimeType, size }], contactChannel, contactResult: Ref\|null, nextAction: { suggestion, dueAt, appointmentId }\|null, source, editedAt, canEdit }` |
| `Appointment` | `{ id, customer: { id, fullName, status: StatusRef }, type, title, startAt, endAt, location, note, assignee: UserRef, remindBeforeMinutes, status, completedAt, outcome, createdBy: UserRef }` |
| `DailyTask` | `{ kind: 'APPOINTMENT'\|'FOLLOW_UP'\|'OCCASION'\|'STALE_CUSTOMER', dueAt, group: 'OVERDUE'\|'TODAY'\|'UPCOMING', customer: { id, fullName, status: StatusRef, projects: Ref[] }, lastCareLog: { occurredAt, excerpt }\|null, suggestion, appointmentId?, isPrimary }` |
| `HistoryEntry` | `{ id, action, actor: UserRef, actorRole, changes: [{ field, from, to }], reason, source, createdAt }` |

---

## 2. Danh sách endpoint theo nhóm

### 2.1 Auth — dùng lại (4)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| POST | `/auth/login` | Đăng nhập (có sẵn, throttle 5/phút). Mở rộng: client mobile nhận `refreshToken` trong body | Public | body `{ email, password }`; header `X-Client-Type` | `{ accessToken, user, refreshToken? (mobile) }` + cookie (web) | X1 |
| POST | `/auth/refresh` | Xoay refresh token (có sẵn). Mở rộng: mobile gửi token trong body | Public | cookie (web) hoặc body `{ refreshToken }` (mobile) | `{ accessToken, refreshToken? }` | X1 |
| POST | `/auth/logout` | Thu hồi refresh token (có sẵn). Mở rộng: kèm `deviceTokenId` để gỡ thiết bị nhận push | Đã đăng nhập | body `{ deviceTokenId? }` | `{ message }` | X1, X5 |
| GET | `/auth/me` | Hồ sơ người dùng (có sẵn). Mở rộng: thêm `teamId`, `managedTeamIds` | Đã đăng nhập | — | `{ _id, email, displayName, role, status, teamId, managedTeamIds }` | X1 |

### 2.2 Người dùng & nhóm (10: 4 dùng lại, 6 mới)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/users` | Danh sách tài khoản (có sẵn). Mở rộng filter | A | query `page, limit, role, teamId, status, q` | `{ data: User[], meta }` | X7 |
| POST | `/users` | Tạo tài khoản (có sẵn). Mở rộng: `role` nhận `MANAGER`/`STAFF`, thêm `teamId` | A | body `{ email, password, displayName, role, teamId? }` | `User` | X7 |
| PATCH | `/users/:id/status` | Khóa/mở khóa (có sẵn) | A | body `{ status }` | `User` | X7 |
| PATCH | `/users/:id/role` | Đổi vai trò (có sẵn, thêm enum) | A | body `{ role }` | `User` | X1 |
| PATCH | `/users/:id/team` | **Mới.** Gán nhóm; enqueue job đồng bộ `customers.teamIds` | A | body `{ teamId \| null }` | `{ data: User }` | QT6 |
| GET | `/teams` | **Mới.** Danh sách nhóm | A, M (nhóm mình) | query `page, limit, q, isActive` | `{ data: Team[], meta }` — `Team { id, name, code, managers: UserRef[], memberCount, isActive }` | QT6 |
| POST | `/teams` | **Mới.** Tạo nhóm | A | body `{ name, code, managerIds[] }` | `201 { data: Team }` | QT6 |
| PATCH | `/teams/:id` | **Mới.** Sửa nhóm, đổi quản lý | A | body `{ name?, managerIds?, isActive? }` | `{ data: Team }` | QT6 |
| DELETE | `/teams/:id` | **Mới.** Xóa mềm (chỉ khi không còn thành viên) | A | — | `204`; 409 `TEAM_NOT_EMPTY` | QT6 |
| GET | `/crm/assignable-users` | **Mới.** Người có thể phân chăm sóc (cho ô chọn người). A: tất cả; M: nhóm mình; S (PR): nhóm mình | A, M, S | query `q, teamId, page, limit` | `{ data: [UserRef + { role, team: Ref }], meta }` | C8 |

### 2.3 Khách hàng (14)

> Khai báo route tĩnh (`list-counts`, `phone-lookups`) **trước** `/:id`.

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers` | Danh sách khách có tìm/lọc/sắp xếp | A, M-P, S-P | query `page, limit, q (tên, SĐT, email), listGroup (ALL\|NOT_CONTACTED\|INTERESTED\|NET\|DROPPED; **mặc định ALL**, tab mặc định của giao diện là Tất cả), statusIds, sourceIds, projectIds, areaIds (gồm khu vực con), assigneeIds (bất kỳ ai trong nhóm), primaryAssigneeIds, teamIds, progress (0,25,50,75,100 — nhiều giá trị), progressMin, progressMax, updatedFrom, updatedTo, lastCareFrom, lastCareTo, tagIds, occupation, personaFilters (`fieldKey:value`, nhiều), hasNationalId, sort ∈ {lastUpdatedAt, fullName, progress, createdAt, nextAppointmentAt, lastCareLogAt, personaCompleteness}` (mặc định `-lastUpdatedAt`) | `{ data: CustomerListItem[], meta }` | C6, X3 |
| GET | `/crm/customers/list-counts` | Số khách mỗi tab Tất cả / Chưa tiếp cận / Có quan tâm / Khách net / Bỏ (cùng bộ lọc trừ `listGroup`) | A, M-P, S-P | query như trên (bỏ `page, limit, sort, listGroup`) | `{ data: { ALL, NOT_CONTACTED, INTERESTED, NET, DROPPED, byStatus: [{ statusId, count }] } }` | C6 |
| POST | `/crm/customers/phone-lookups` | Kiểm tra trùng SĐT trước khi tạo. Dùng POST để **SĐT không nằm trên URL/log**. Throttle 30/phút | A, M, S | body `{ phone }` | `{ data: { normalizedPhone, exists, isAccessible, customerId? (khi truy cập được), customerRef? (khi không), caredByName? ("Hạnh" hoặc null nếu chưa phân), canRequestJoin, hasPendingRequest, isDeleted? (chỉ A) } }`; 400 `INVALID_PHONE` | X2 |
| POST | `/crm/customers` | Tạo khách. **[IK]**. S tạo ⇒ tự là PRIMARY; A/M có thể chỉ định `careTeam` (bắt buộc `primaryUserId` nếu có người) | A, M, S | body `{ fullName*, phone*, email?, statusId?, sourceId?, interestedProjectIds?, areaId?, tagIds?, nationalId?, criteria?: { [key]: { isDone, description } }, careTeam?: { memberIds[], primaryUserId }, dataConsent? }` | `201 { data: CustomerDetail }`; 409 `CUSTOMER_PHONE_DUPLICATED` (details như phone-lookups); 400 `PRIMARY_REQUIRED` | C1, C4, C5, C7, C8, X2, QT3, QT4 |
| GET | `/crm/customers/:id` | Chi tiết hồ sơ (không gồm persona đầy đủ, nhật ký) | A, M-P, S-P | — | `{ data: CustomerDetail }`; 404 nếu ngoài phạm vi | C1, C4, C5, C8, C9 |
| PATCH | `/crm/customers/:id` | Sửa hồ sơ cơ bản. `lastUpdatedAt` server tự ghi; optimistic concurrency | A, M-P, S-P | body `{ version*, fullName?, phone?, email?, sourceId?, interestedProjectIds?, areaId?, tagIds? }` | `{ data: CustomerDetail }`; 409 `VERSION_CONFLICT` / `CUSTOMER_PHONE_DUPLICATED` | C1, C7, C11, X4 |
| PATCH | `/crm/customers/:id/status` | Đổi tình trạng; khách tự chuyển danh sách; dùng lại để Hoàn tác | A, M-P, S-P | body `{ statusId*, version*, reason? }` | `{ data: { status: StatusRef, previousStatusId, version, lastUpdatedAt } }` | C6, QT2, X4 |
| PATCH | `/crm/customers/:id/criteria` | Cập nhật 1–4 tiêu chí; server tính `progress` | A, M-P, S-P | body `{ version*, demand?: { isDone?, description? }, motivation?, finance?, timing? }` | `{ data: { criteria, progress, version, lastUpdatedAt } }` | C4, C5, QT1 |
| PUT | `/crm/customers/:id/data-consent` | Ghi nhận / rút lại đồng ý xử lý dữ liệu cá nhân | A, M-P, S-P | body `{ status* (GRANTED\|WITHDRAWN\|UNKNOWN), method? (VERBAL\|WRITTEN\|ZALO\|OTHER), note? }` | `{ data: dataConsent }` | §5 (QT9) |
| DELETE | `/crm/customers/:id` | Xóa mềm (`deletedAt`) | A, M-P | query `reason*` (không dùng body với DELETE) | `204` | — |
| GET | `/crm/deleted-customers` | Danh sách khách đã xóa mềm | A | query `page, limit, q, deletedFrom, deletedTo` | `{ data: [CustomerListItem + { deletedAt, deletedBy }], meta }` | — |
| POST | `/crm/customer-restorations` | Khôi phục khách đã xóa mềm | A | body `{ customerId*, reason? }` | `201 { data: CustomerDetail }` | — |
| POST | `/crm/customer-anonymizations` | Ẩn danh hóa theo yêu cầu khách (không hoàn tác được). **[IK]** | A | body `{ customerId*, reason*, confirm: true }` | `201 { data: { customerId, anonymizedAt } }` | §5 |
| POST | `/crm/customer-bulk-operations` | Thao tác hàng loạt (≤ 200 khách/lần, đồng bộ). **[IK]** | A, M-P, S-P (S không được `ASSIGN`) | body `{ type* (CHANGE_STATUS\|ADD_TAGS\|REMOVE_TAGS\|ASSIGN), customerIds*[], payload: { statusId? \| tagIds? \| memberIds?, primaryUserId? } }` | `{ data: { succeeded: id[], failed: [{ customerId, errorCode }] } }` | C6, C8, C11 |

### 2.4 CCCD và xem/gọi SĐT (5)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| PUT | `/crm/customers/:id/national-id` | Nhập/sửa CCCD (mã hóa AES-256-GCM, chỉ lưu 4 số cuối dạng rõ) | A, M-P, S-P | body `{ nationalId* (9 hoặc 12 chữ số) }` | `{ data: { hasNationalId: true, nationalIdMasked: '••••1234' } }` | C9 |
| DELETE | `/crm/customers/:id/national-id` | Xóa giá trị CCCD khỏi hồ sơ | A, M-P, S-P | — | `204` | C9, §5 |
| POST | `/crm/customers/:id/national-id-views` | Xem CCCD đầy đủ: tạo bản ghi xem + trả số. Throttle 10/phút, `Cache-Control: no-store` | A, M-P, PR **[Giả định D2]** | body `{ purpose? }` | `201 { data: { nationalId, viewedAt } }`; 403 `NATIONAL_ID_FORBIDDEN` | C9 |
| GET | `/crm/customers/:id/national-id-views` | Nhật ký các lần xem CCCD của khách | A, M-P | query `page, limit` | `{ data: [{ viewer: UserRef, viewedAt, purpose, source }], meta }` | C9 |
| POST | `/crm/customers/:id/phone-views` | Xem số đầy đủ / gọi / sao chép: kiểm `CustomerScope`, ghi audit `PHONE_VIEWED` (không lưu số). Mọi thành viên nhóm chăm sóc đều được (không che theo vai trò trong nhóm). Throttle 60/phút/người, `Cache-Control: no-store` | A, M-P, S-P (PR và MEMBER) | body `{ purpose* (VIEW\|CALL\|COPY) }` | `201 { data: { phone, viewedAt } }`; 404 nếu ngoài phạm vi. Bản ghi audit `PHONE_VIEWED` **không lưu số** | C14 |

### 2.5 Nhóm chăm sóc & đề nghị tham gia (7)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers/:id/care-team` | Nhóm chăm sóc hiện tại | A, M-P, S-P | — | `{ data: { members: CareTeamMember[], primary: UserRef \| null } }` | C8 |
| POST | `/crm/customers/:id/care-team/members` | Thêm người chăm sóc; lần phân đầu bắt buộc `primaryUserId`; gửi push `CUSTOMER_ASSIGNED` | A, M-P, PR | body `{ userIds*[], primaryUserId? }` | `{ data: { members, primary } }`; 400 `PRIMARY_REQUIRED`, `USER_NOT_ASSIGNABLE` | C8, QT7, QT8, X5 |
| DELETE | `/crm/customers/:id/care-team/members/:userId` | Gỡ người; nếu là PRIMARY bắt buộc chỉ định người thay (chỉ A/M) | A, M-P, PR (không gỡ được PRIMARY) | query `newPrimaryUserId?` | `{ data: { members, primary } }`; 400 `PRIMARY_REPLACEMENT_REQUIRED` | C8, QT7, QT8 |
| PUT | `/crm/customers/:id/care-team/primary` | Đổi phụ trách chính (người mới tự được thêm nếu chưa có; người cũ thành MEMBER) | A, M-P | body `{ userId* }` | `{ data: { members, primary } }` | QT7 |
| POST | `/crm/care-team-requests` | Đề nghị tham gia nhóm chăm sóc khách đã có (từ kết quả phone-lookups). Thông báo PR + Quản lý nhóm | M, S | body `{ customerRef*, message? }` | `201 { data: { id, status: 'PENDING', createdAt } }`; 409 `JOIN_REQUEST_EXISTS`, `ALREADY_IN_CARE_TEAM` | X2 |
| GET | `/crm/care-team-requests` | Danh sách đề nghị: `box=mine` (mình gửi) hoặc `box=to-review` (mình duyệt) | A, M, S | query `box*, status, page, limit` | `{ data: [{ id, customer: { id?, fullName? (chỉ người duyệt) }, requester: UserRef, message, status, createdAt, resolvedBy, resolvedAt }], meta }` | X2 |
| PATCH | `/crm/care-team-requests/:id` | Duyệt / từ chối (người duyệt) hoặc hủy (người gửi). Duyệt ⇒ thêm MEMBER + push | A, M-P, PR; người gửi chỉ `CANCELED` | body `{ status* (APPROVED\|REJECTED\|CANCELED), resolutionNote? }` | `{ data: Request }`; 409 `JOIN_REQUEST_RESOLVED` | X2, QT8 |

### 2.6 Nhật ký chăm sóc và ảnh đính kèm (6)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers/:id/care-logs` | Dòng thời gian, mới nhất trước | A, M-P, S-P | query `page, limit, authorId, contactChannel, from, to` | `{ data: CareLog[], meta }` | C2 |
| POST | `/crm/customers/:id/care-logs` | Ghi nhật ký (ghi chú nhanh). Ghi rõ người viết từ JWT; cập nhật `lastCareLogAt`; tùy chọn tạo lịch hẹn/nhắc bước tiếp theo; thông báo người cùng chăm sóc. **[IK]** | A, M-P, S-P | body `{ content*, contactChannel*, occurredAt?, contactResultId?, attachmentIds? (≤ 5, đã upload), nextAction?: { suggestion?, dueAt?, appointment?: { type, startAt, location? } } }` | `201 { data: CareLog + { appointment? } }` | C2, C3, X5 |
| PATCH | `/crm/customers/:id/care-logs/:logId` | Sửa nội dung (tác giả trong 24 giờ) | TG, A, M-P | body `{ content?, contactChannel?, contactResultId?, occurredAt?, attachmentIds? }` | `{ data: CareLog }`; 403 `CARE_LOG_EDIT_WINDOW_EXPIRED` | C2, X4 |
| DELETE | `/crm/customers/:id/care-logs/:logId` | Xóa mềm nhật ký | TG (24 giờ), A, M-P | query `reason?` | `204` | C2, X4 |
| POST | `/crm/customers/:id/care-log-attachments` | Upload ảnh trước khi lưu ghi chú (từng ảnh; jpeg/png/webp, ≤ 5 MB, kiểm magic bytes, đổi tên UUID). Server bỏ EXIF/GPS, tạo thumbnail bằng job nền; ảnh chưa gắn quá 24 giờ bị dọn | A, M-P, S-P | multipart `file*` | `201 { data: { id, status: 'PENDING' } }`; 413 `FILE_TOO_LARGE`; 415 `ATTACHMENT_TYPE_INVALID` | C2 |
| DELETE | `/crm/customers/:id/care-log-attachments/:attachmentId` | Gỡ ảnh khỏi nhật ký (chưa gắn: bất kỳ lúc nào; đã gắn: tác giả trong 24 giờ, hoặc A/M-P) | TG, A, M-P | — | `204` | C2 |

### 2.7 Chân dung & thẻ (11)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers/:id/persona` | Chân dung theo nhóm trường + độ đầy đủ + gợi ý thông tin còn thiếu | A, M-P, S-P | — | `{ data: { groups: [{ code, label, fields: PersonaFieldValue[] }], completeness, missingSuggestions: [{ fieldKey, label, groupCode }] } }` | C10, C12, QT9 |
| PATCH | `/crm/customers/:id/persona` | Cập nhật nhiều giá trị; `value: null` để xóa. Ghi người/ngày/nguồn từng giá trị | A, M-P, S-P | body `{ version*, values*: [{ fieldKey*, value* (theo type), source* (CUSTOMER_SHARED\|STAFF_OBSERVED), sensitiveAcknowledged? }] }` | `{ data: { completeness, updated: PersonaFieldValue[], version } }`; 400 `PERSONA_VALUE_INVALID`, `SENSITIVE_FIELD_CONSENT_REQUIRED` | C10, C12, C13, QT9, X10 |
| GET | `/crm/persona-fields` | Cấu hình trường chân dung (render form, bộ lọc) | A, M, S | query `isActive, groupCode, page, limit` | `{ data: PersonaField[], meta }` | X10 |
| POST | `/crm/persona-fields` | Thêm trường | A | body `{ key*, label*, groupCode*, type*, options?, helpText?, weight?, suggestPriority?, isFilterable?, isOccasion?, occasionLabel?, linkedCriterion?, isSensitive? }` | `201 { data: PersonaField }`; enqueue recompute completeness | X10, C12 |
| PATCH | `/crm/persona-fields/:id` | Sửa nhãn, lựa chọn, trọng số, bật/tắt. `type`/`key` khóa khi đã có dữ liệu | A | body các field của POST trừ `key` + `isActive?` | `{ data: PersonaField }`; 409 `PERSONA_FIELD_TYPE_LOCKED` | X10 |
| DELETE | `/crm/persona-fields/:id` | Bớt trường = xóa mềm/tắt, giữ dữ liệu cũ; không áp dụng trường `isSystem` | A | — | `204`; 409 `PERSONA_FIELD_SYSTEM` | X10 |
| PUT | `/crm/persona-fields/order` | Sắp lại thứ tự trường | A | body `{ items*: [{ id, order, groupCode? }] }` | `{ data: PersonaField[] }` | X10 |
| GET | `/crm/tags` | Danh sách / gợi ý thẻ khi gõ | A, M, S | query `q, category, page, limit, sort ∈ {name, usageCount}` | `{ data: [Ref + { category, usageCount }], meta }` | C11 |
| POST | `/crm/tags` | Tạo thẻ (trùng tên đã chuẩn hóa ⇒ trả thẻ có sẵn) | A, M, S | body `{ name*, category* }` | `201 { data: Tag }` hoặc `200` nếu đã tồn tại | C11 |
| PATCH | `/crm/tags/:id` | Sửa tên/nhóm; gộp vào thẻ khác (`mergeIntoId`, chạy job thay thế trên khách) | A | body `{ name?, category?, color?, mergeIntoId? }` | `{ data: Tag }` | C11 |
| DELETE | `/crm/tags/:id` | Xóa mềm thẻ (gỡ khỏi khách bằng job nền) | A | — | `204` | C11 |

### 2.8 Danh mục & dự án (22)

Bốn danh mục dùng chung một mẫu CRUD (4 endpoint mỗi loại). Đọc: A, M, S. Ghi: A. Xóa = xóa mềm; đang được dùng hoặc `isSystem` ⇒ 409 `CATALOG_IN_USE` / `CATALOG_SYSTEM` (gợi ý tắt `isActive`).

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
| GET | `/crm/areas` | Khu vực (phẳng hoặc theo cha) | A, M, S | query `parentId, type, q, isActive, includeLegacy, page, limit` | `{ data: [Ref + { type, parentId, path: Ref[], isLegacy }], meta }` | C1, X7 |
| POST | `/crm/areas` | Thêm khu vực | A | body `{ name*, type*, parentId?, adminCode?, order? }` | `201 { data }` | X7 |
| PATCH | `/crm/areas/:id` | Sửa / chuyển cha (job cập nhật `ancestorIds`) | A | body `{ name?, parentId?, isActive?, isLegacy?, order? }` | `{ data }` | X7 |
| DELETE | `/crm/areas/:id` | Xóa mềm (không xóa khi còn con hoặc đang dùng) | A | — | `204` | X7 |
| GET | `/crm/contact-results` | Kết quả liên hệ + gợi ý mốc hẹn | A, M, S | query `isActive, page, limit` | `{ data: [Ref + { code, suggestedFollowUpDays, suggestionText }], meta }` | C2, C3 |
| POST | `/crm/contact-results` | Thêm kết quả liên hệ | A | body `{ code*, label*, suggestedFollowUpDays?, suggestionText?, order? }` | `201 { data }` | C3 |
| PATCH | `/crm/contact-results/:id` | Sửa | A | body các field POST trừ `code` + `isActive?` | `{ data }` | C3 |
| DELETE | `/crm/contact-results/:id` | Xóa mềm | A | — | `204` | C3 |
| GET | `/crm/projects` | Danh sách dự án (ô chọn nhiều khi nhập hồ sơ) | A, M, S | query `q, status, areaId, isActive, isDeleted (chỉ A: xem dự án đã xóa mềm), page, limit, sort ∈ {name, createdAt}` | `{ data: Project[], meta }` — `Project { id, name, code, developer, location, area: Ref\|null, propertyTypes, priceFrom, priceTo, status, isActive, customerCount }` | C1, X7 |
| GET | `/crm/projects/:id` | Chi tiết dự án | A, M, S | — | `{ data: Project + { description, customerCount } }` | X7 |
| POST | `/crm/projects` | Thêm dự án. `code` bắt buộc, regex `^[A-Za-z0-9_-]{1,20}$`, unique không phân biệt hoa thường (kể cả đã xóa mềm). `status` ∈ `UPCOMING`\|`SELLING`\|`SOLD_OUT` (mặc định `UPCOMING`); `priceFrom ≤ priceTo` | A | body `{ name*, code*, developer?, location?, areaId?, propertyTypes?, priceFrom?, priceTo?, status?, description? }` | `201 { data: Project }`; 409 `PROJECT_CODE_DUPLICATED` | X7 |
| PATCH | `/crm/projects/:id` | Sửa dự án; `isActive=false` = **ngừng hoạt động** (ẩn khỏi ô chọn mới, khách cũ giữ liên kết, hiển thị "đã ngừng") | A | body như POST (tùy chọn) + `isActive?` | `{ data: Project }` | X7 |
| DELETE | `/crm/projects/:id` | Xóa mềm (`deletedAt`) chỉ khi không còn khách tham chiếu; còn khách ⇒ 409, Quản trị dùng PATCH `isActive=false` | A | — | `204`; 409 `PROJECT_IN_USE { customerCount }` | X7 |
| POST | `/crm/project-restorations` | Khôi phục dự án đã xóa mềm | A | body `{ projectId*, reason? }` | `201 { data: Project }`; 404 `RESOURCE_NOT_FOUND` | X7 |

### 2.9 Lịch hẹn & việc hôm nay (8)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/appointments` | Lịch tuần/tháng hoặc theo khách | A, M-P, S-P | query `from*, to* (ISO/ngày VN, tối đa 62 ngày), customerId, assigneeIds, types, status, page, limit (≤100), sort ∈ {startAt}` | `{ data: Appointment[], meta }` | C3 |
| POST | `/crm/appointments` | Tạo lịch hẹn/nhắc việc; tự tạo `reminders`; cập nhật `customers.nextAppointmentAt`. **[IK]** | A, M-P, S-P | body `{ customerId*, type* (`SITE_VISIT`\|`MEETING`\|`DEPOSIT_CONTRACT` "Ký cọc / HĐMB"\|`CALLBACK`\|`OTHER`), startAt*, endAt?, title?, location?, note?, assigneeId? (mặc định mình, phải thuộc careTeam), remindBeforeMinutes? }` | `201 { data: Appointment }` | C3, X5 |
| GET | `/crm/appointments/:id` | Chi tiết | A, M-P, S-P | — | `{ data: Appointment }` | C3 |
| PATCH | `/crm/appointments/:id` | Dời lịch / sửa (tính lại reminders) | A, M-P, S-P | body `{ startAt?, endAt?, type?, title?, location?, note?, assigneeId?, remindBeforeMinutes? }` | `{ data: Appointment }` | C3 |
| PATCH | `/crm/appointments/:id/status` | Hoàn thành / hủy; tùy chọn ghi luôn nhật ký kết quả | A, M-P, S-P | body `{ status* (DONE\|CANCELED\|SCHEDULED), outcome?, createCareLog?: boolean }` | `{ data: Appointment + { careLog? } }` | C2, C3 |
| DELETE | `/crm/appointments/:id` | Xóa mềm (nhập nhầm) | TG, A, M-P | — | `204` | C3 |
| GET | `/crm/daily-tasks` | "Việc hôm nay" theo nhóm Quá hạn / Hôm nay / Sắp tới (lịch hẹn, bước tiếp theo, dịp đặc biệt, khách lâu chưa chăm sóc) | A, M, S (mặc định việc của mình) | query `group? (OVERDUE\|TODAY\|UPCOMING; bỏ trống = cả 3 nhóm, dùng cho chế độ Kanban), scope (mine\|team — team chỉ A/M), kinds, upcomingDays (mặc định 7), page, limit` | `{ data: DailyTask[], meta }` | C3, C13, X5 |
| GET | `/crm/daily-tasks/summary` | Số việc mỗi nhóm (badge tab, app) | A, M, S | query `scope, upcomingDays` | `{ data: { overdue, today, upcoming } }` | C3 |

### 2.10 Thông báo & thiết bị (8) — dùng chung toàn app

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/notifications` | Hộp thông báo (chuông) | Self | query `isRead, types, page, limit` | `{ data: [{ id, type, title, body, data: { customerId?, appointmentId?, deepLink }, priority, readAt, createdAt }], meta }` | X5 |
| GET | `/notifications/unread-count` | Số chưa đọc | Self | — | `{ data: { count } }` | X5 |
| PATCH | `/notifications/:id` | Đánh dấu đã đọc/chưa đọc | Self | body `{ isRead* }` | `{ data: Notification }` | X5 |
| PATCH | `/notifications` | Đánh dấu đã đọc hàng loạt | Self | body `{ isRead: true, ids? (bỏ trống = tất cả), before? }` | `{ data: { updated } }` | X5 |
| POST | `/device-tokens` | Đăng ký/làm mới device token (upsert theo token, gán lại cho user hiện tại) | Self | body `{ token*, platform* (IOS\|ANDROID\|WEB), deviceId?, appVersion? }` | `201 { data: { id, platform, lastSeenAt } }` | X5, X9 |
| DELETE | `/device-tokens/:id` | Hủy đăng ký thiết bị (đăng xuất, tắt push) | Self | — | `204` | X5 |
| GET | `/notification-preferences/me` | Cài đặt bật/tắt từng loại thông báo | Self | — | `{ data: { types: { [type]: { push, inApp } }, quietHours } }` | X5, §5 |
| PUT | `/notification-preferences/me` | Lưu cài đặt | Self | body `{ types*: { [type]: { push, inApp } }, quietHours?: { start, end } \| null }` | `{ data: Preferences }` | X5, §5 |

### 2.11 Lịch sử & audit (2)

| Method | Path | Mô tả | Quyền | Request | Response | ID |
|---|---|---|---|---|---|---|
| GET | `/crm/customers/:id/histories` | Lịch sử thay đổi của khách: ai, lúc nào, đổi gì (gồm mọi lần đổi tình trạng, người chăm sóc). `changes` lưu **giá trị trường đầy đủ** (SĐT cũ → mới hiển thị cho mọi người xem được khách; CCCD luôn che). Mục xem CCCD (`NATIONAL_ID_VIEWED`) và xem/gọi SĐT (`PHONE_VIEWED`, không có số) chỉ trả cho A/M | A, M-P, S-P | query `actions, actorId, from, to, page, limit` | `{ data: HistoryEntry[], meta }` | X4 |
| GET | `/crm/audit-logs` | Audit toàn CRM (export, import, danh mục, xem CCCD, dò số…) | A | query `entityType, action, actorId, customerId, from, to, page, limit` | `{ data: [HistoryEntry + { entityType, entityId, customerId, requestId, ip }], meta }` | X4, §5 |

### 2.12 Import / Export (12)

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
| 2.5 Nhóm chăm sóc & đề nghị tham gia | 0 | 7 | 7 |
| 2.6 Nhật ký chăm sóc và ảnh đính kèm | 0 | 6 | 6 |
| 2.7 Chân dung & thẻ | 0 | 11 | 11 |
| 2.8 Danh mục & dự án | 0 | 22 | 22 |
| 2.9 Lịch hẹn & việc hôm nay | 0 | 8 | 8 |
| 2.10 Thông báo & thiết bị | 0 | 8 | 8 |
| 2.11 Lịch sử & audit | 0 | 2 | 2 |
| 2.12 Import / Export | 0 | 12 | 12 |
| 2.13 Dashboard | 0 | 3 | 3 |
| 2.14 Cài đặt CRM | 0 | 2 | 2 |
| 2.15 Health | 2 | 0 | 2 |
| **Tổng** | **10** | **106** | **116** |

---

## 4. Ma trận yêu cầu → API

| ID | Endpoint chính |
|---|---|
| C1 | `POST/GET/PATCH /crm/customers`, `/crm/projects`, `/crm/lead-sources`, `/crm/areas`, `/crm/customer-statuses` |
| C2 | `/crm/customers/:id/care-logs` (4), `/crm/customers/:id/care-log-attachments` (2) |
| C3 | `POST care-logs` (`nextAction`), `/crm/appointments` (6), `/crm/daily-tasks` (2), `/crm/contact-results` |
| C4, C5 | `PATCH /crm/customers/:id/criteria` (progress server tính) |
| C6 | `GET /crm/customers?listGroup=`, `list-counts`, `PATCH .../status` |
| C7 | Mọi PATCH trên khách (server ghi `lastUpdatedAt`) |
| C8 | `/crm/customers/:id/care-team*` (4), `/crm/assignable-users`, bulk `ASSIGN` |
| C9 | `/crm/customers/:id/national-id*` (4) |
| C14 | `POST /crm/customers/:id/phone-views` |
| C10, C12 | `GET/PATCH /crm/customers/:id/persona` |
| C11 | `/crm/tags` (4), bulk `ADD_TAGS/REMOVE_TAGS`, filter `tagIds` |
| C13 | Scheduler `occasions.scan` + `notifications`; trường chân dung `isOccasion` |
| X1 | `/auth/*`, `/users/*`, `/teams/*`, row-level scope mọi endpoint CRM |
| X2 | `POST /crm/customers/phone-lookups`, 409 khi tạo, `/crm/care-team-requests` (3) |
| X3 | Query của `GET /crm/customers` |
| X4 | `GET /crm/customers/:id/histories`, `GET /crm/audit-logs` |
| X5 | `/notifications` (4), `/device-tokens` (2), `/notification-preferences/me` (2), scheduler |
| X6 | `/crm/dashboard/*` (3) |
| X7 | 2.8 (22, gồm CRUD dự án + `/crm/project-restorations`), `/users`, `/teams` |
| X8 | 2.12 (12, nhập/xuất chung; mẫu 3 sheet cũ giai đoạn sau) |
| X9 | Cùng API cho web và app; `/device-tokens`; `X-Client-Type` ở auth |
| X10 | `/crm/persona-fields` (5) |

---

## 5. Mã lỗi nghiệp vụ (`errorCode`)

| HTTP | `errorCode` | Khi nào | `details` |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | DTO không hợp lệ (ValidationPipe) | — (`message` là mảng) |
| 400 | `INVALID_PHONE` | SĐT không chuẩn hóa được | `{ input }` |
| 400 | `PRIMARY_REQUIRED` | Phân khách lần đầu thiếu phụ trách chính | — |
| 400 | `PRIMARY_REPLACEMENT_REQUIRED` | Gỡ phụ trách chính mà thiếu người thay | — |
| 400 | `USER_NOT_ASSIGNABLE` | Người được phân không ACTIVE hoặc không phải MANAGER/STAFF | `{ userIds }` |
| 400 | `PERSONA_VALUE_INVALID` | Giá trị sai kiểu trường / lựa chọn không tồn tại | `{ fieldKey }` |
| 400 | `SENSITIVE_FIELD_CONSENT_REQUIRED` | Trường nhạy cảm thiếu `source=CUSTOMER_SHARED` + xác nhận | `{ fieldKey }` |
| 400 | `INVALID_SORT_FIELD` | `sort` ngoài whitelist | `{ allowed }` |
| 401 | `UNAUTHORIZED` | Token thiếu/hết hạn | — |
| 403 | `INSUFFICIENT_ROLE` | Vai trò không đủ (RolesGuard) | — |
| 403 | `NATIONAL_ID_FORBIDDEN` | Không có quyền xem CCCD đầy đủ | — |
| 403 | `CARE_LOG_EDIT_WINDOW_EXPIRED` | Sửa/xóa nhật ký quá 24 giờ | — |
| 403 | `CARE_TEAM_ACTION_FORBIDDEN` | Thành viên thường thêm/gỡ người, PR gỡ chính mình… | — |
| 404 | `CUSTOMER_NOT_FOUND` | Không tồn tại **hoặc ngoài phạm vi** | — |
| 404 | `RESOURCE_NOT_FOUND` | Tài nguyên khác | — |
| 409 | `CUSTOMER_PHONE_DUPLICATED` | Trùng SĐT khi tạo/sửa | `{ customerRef, caredByName, canRequestJoin, isAccessible, customerId? }` |
| 409 | `VERSION_CONFLICT` | Hồ sơ đã bị người khác sửa | `{ currentVersion }` |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Cùng `X-Idempotency-Key` đang xử lý | — |
| 409 | `JOIN_REQUEST_EXISTS` / `ALREADY_IN_CARE_TEAM` / `JOIN_REQUEST_RESOLVED` | Đề nghị tham gia trùng/đã xử lý | — |
| 409 | `PROJECT_CODE_DUPLICATED` | Mã dự án trùng (kể cả dự án đã xóa mềm) | `{ code }` |
| 409 | `PROJECT_IN_USE` | Xóa dự án còn khách tham chiếu | `{ customerCount }` |
| 409 | `CATALOG_IN_USE` / `CATALOG_SYSTEM` | Xóa danh mục đang dùng / hệ thống | `{ usageCount }` |
| 409 | `PERSONA_FIELD_TYPE_LOCKED` / `PERSONA_FIELD_SYSTEM` | Đổi kiểu trường đã có dữ liệu / xóa trường hệ thống | `{ valueCount }` |
| 409 | `TEAM_NOT_EMPTY` | Xóa nhóm còn thành viên | `{ memberCount }` |
| 409 | `IMPORT_NOT_VALIDATED` | Xác nhận import khi chưa chạy thử xong | `{ status }` |
| 413 | `FILE_TOO_LARGE` | File > 10 MB | `{ maxBytes }` |
| 415 | `IMPORT_FILE_TYPE_INVALID` | Không phải xlsx/csv hợp lệ | — |
| 415 | `ATTACHMENT_TYPE_INVALID` | Ảnh đính kèm không phải jpeg/png/webp hợp lệ | — |
| 400 | `ATTACHMENT_LIMIT_EXCEEDED` | Quá 5 ảnh/ghi chú | `{ max }` |
| 429 | `RATE_LIMITED` | Vượt Throttler (login, phone-lookups, national-id-views, phone-views, exports) | `{ retryAfterSeconds }` |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước (không lộ stack ở production) | — |
