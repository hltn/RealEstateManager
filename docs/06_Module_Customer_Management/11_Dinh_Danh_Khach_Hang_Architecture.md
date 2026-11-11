# Định danh khách hàng (bỏ ràng buộc SĐT, mã khách tự sinh, người tạo = chăm sóc chính bất biến) — Architecture Design

> **Phiên bản tài liệu:** v1.0.5

> Ngày tạo: 2026-11-10
> Author: architect-agent
> Trạng thái: Approved
> Dựa trên: `06_Module_Customer_Management/10_Dinh_Danh_Khach_Hang_Plan.md` (Approved, FR-01 đến FR-23), audit codebase (BE `RealEstateBackendApp`, FE `RealEstateAdminApp` + `stnd-crm-unified`, `deploy.sh`, `scripts/`), skill `nodejs-react-mongo-coding-guidelines`

---

## 1. Tổng quan kiến trúc

### 1.1 Mục tiêu và đánh đổi chính

Đổi cách định danh khách: bỏ SĐT khỏi vai trò "khóa định danh" (không bắt buộc, không duy nhất), thêm **mã khách** `KH-000123` do hệ thống sinh, **người tạo = PRIMARY bất biến**, chia sẻ khách chỉ bằng **mời** (bỏ xin tham gia). Thêm khối hạ tầng triển khai: tách bước 8c của `deploy.sh` và thêm bước bù mã khách thành các script riêng sau một điểm gọi chung.

Đánh đổi chính:

| # | Đánh đổi | Chọn | Lý do (FR) |
|---|---|---|---|
| 1 | Bù mã khách trước hay sau `up` | **Sau `up`**, bằng script riêng; unique index mã là **partial** tạo sớm ở migration 010 | Image v1.0.3 còn phục vụ giữa 6b và `up` vẫn tạo được khách chưa có mã (FR-21) |
| 2 | Bỏ unique `phone` chạy lúc nào | Migration **011 (cuối cùng)** có thuộc tính `phase: 'post-up'`, runner chỉ chạy sau khi backend mới sống | Giữ đường lùi image khi `up` lỗi (FR-21, rủi ro 13 của Plan) |
| 3 | Cấp mã | Counter trong collection `counters`, `$inc` **trong transaction tạo khách** (theo lô n mã khi tạo hàng loạt) | Nguyên tử, không trùng, rollback thì counter cũng rollback nên không thủng số (FR-07) |
| 4 | Người được mời toàn hệ thống | Endpoint mới `care-team-invitees` trả tên + tên nhóm, phân trang, rate-limit; `assignable-users` **bị xóa hẳn**, phần ô lọc người chăm sóc chuyển sang endpoint mới `customer-assignees` (4, 5.5a) | Không lộ email/vai trò/id nhóm (FR-14); FE mới không còn nơi nào cần `assignable-users` |
| 5 | Tương thích PWA bản cũ | **Không giữ bản chuyển tiếp nào**: xóa hẳn `phone-lookups`, `PUT primary`, `assignable-users`, trường `careTeam` ở DTO tạo, 3 endpoint `care-team-requests` ngay trong v1.0.5. Máy còn PWA cũ phải tải lại trang sau deploy (ghi vào hướng dẫn deploy, task docs) | Oniichan đã chốt (11.1b #5); đổi lại, bản PWA cũ nhận 400/404 tới khi tải lại (R11) |

Không thêm microservice, queue hay cache mới: tạo khách là thao tác ngắn, đồng bộ. Không có tác vụ nặng hay gọi bên thứ ba mới (bù mã chạy theo lô trong script, không phải job nền). Không cần health check mới (không thêm service).

### 1.2 Luồng deploy gộp v1.0.3 → v1.0.4 + v1.0.5

```
deploy.sh
 5   mongodump (có sẵn)
 6b  runner: reconcile --apply --skip-version --phase pre-up     (image v1.0.3 vẫn phục vụ)
        007 codes danh mục, 008, 009, 010 (index mã partial + counter)
 up  build + chạy backend v1.0.5, chờ liveness
 8a  (cài mới) reconcile --apply --phase pre-up  (DB trống: chạy 007..010, ghi version)
 8b  sync_system_version (cảnh báo, không fail)   --phase pre-up
 8c' run_post_migrate_steps   <= MỘT điểm gọi chung, thư mục scripts/post-migrate/
        10-catalog-codes.sh     (hành vi 8c cũ: bù mã danh mục)
        20-customer-codes.sh    (bù mã khách; tự kiểm sổ: 010 chưa áp dụng thì thoát 0)
        90-post-up-migrations.sh (runner reconcile --apply --phase post-up => 011 bỏ unique phone)
```

Bất kỳ bước post-migrate nào thoát khác 0 thì deploy thất bại (cảnh báo đỏ, log riêng), các bước sau không chạy. Downgrade có chủ ý (`DOWNGRADE_ACTIVE=1`) bỏ qua toàn bộ điểm gọi chung (image cũ không có các CLI này), đúng hành vi 8c hiện tại.

### 1.3 Luồng tạo khách (mới)

```
FE form (họ tên, SĐT tùy chọn, ...)  --X-Idempotency-Key-->  POST /api/v1/crm/customers
  CustomersService.create
    withTransaction(session)
      1. lock người tạo (touch users) + đọc teamIds của người tạo
      2. CounterService.next('CUSTOMER_CODE', 1, session)  -> seq -> formatCustomerCode(seq)
      3. insert customer { customerCode, phone|null, careTeam:[{người tạo, PRIMARY}], primaryAssigneeId, teamIds }
      4. ghi audit CUSTOMER_CREATED (+customerCode) / history, notification CUSTOMER_ASSIGNED không gửi cho chính người tạo
    commit  -> response 201 { data: { ...customer, customerCode }, meta }
```

### 1.4 Luồng mời thành viên (thay xin tham gia)

```
PRIMARY / Manager / Admin -> GET /crm/care-team-invitees?customerId&q&page   (tên + tên nhóm)
                          -> POST /crm/customers/:id/care-team/members {userIds}
  CareTeamService.applyInSession (transaction)
    đọc careTeam -> planAddMembers -> kiểm giới hạn 10 MEMBER -> assertAssignable (ACTIVE + role Manager/Staff, KHÔNG kiểm nhóm)
    -> tính lại teamIds = hợp nhóm mọi thành viên -> ghi -> audit CARE_TEAM_MEMBER_ADDED -> notification CUSTOMER_ASSIGNED (bỏ tài khoản BLOCKED)
```

---

## 2. Hiện trạng codebase

| Thành phần | Trạng thái | Ghi chú | FR |
|---|---|---|---|
| `customers` schema: `phone` required + `CustomerSchema.index({phone:1},{unique:true})`, chưa có `customerCode` | ⚠️ GAP | Sửa schema, đổi chú thích quyết định #2 | FR-01, 02, 07 |
| `CustomersService.create/insertCustomer/planCareTeam`; tạo hộ `careTeam` cho Admin/Manager; xử lý trùng SĐT | ⚠️ GAP | Người tạo luôn PRIMARY; bỏ tạo hộ và xử lý trùng | FR-01, 10 |
| `CustomerPhoneService.lookup/buildDuplicateError/view` + `POST phone-lookups` | ⚠️ GAP | `lookup`/`buildDuplicateError` và route `phone-lookups` **xóa hẳn** (không bản chuyển tiếp); `view` xử lý `phone` null | FR-03, 04, 20 |
| `toPhoneMasked`, `buildSearchText`, anonymize `phone: anonymized:<id>` (`customer-lifecycle.service.ts`), `customer-audit.util.ts`, appointment mapper | ⚠️ GAP | Đều giả định `phone` là chuỗi | FR-04, 06 |
| `CareTeamService`, `care-team.rules.ts` (`planChangePrimary`, `planRemoveMember`, `canChangePrimary`), `PUT primary`, bulk `ASSIGN` với `primaryUserId` | ⚠️ GAP | Khóa PRIMARY (xóa route `PUT primary`, không giữ 409), bulk chỉ MEMBER | FR-11 |
| `CareTeamAssigneesService.assertAssignable(restrictToActorScope)` + `resolveAssignableTeamIds/sharesAnyTeam` | ⚠️ GAP | Bỏ giới hạn nhóm | FR-13 |
| `care-team-requests.controller/service`, `schemas/care-team-request.schema.ts`, rate-limit `JOIN_REQUEST`, thông báo `CARE_TEAM_JOIN_REQUESTED`, mã lỗi `JOIN_REQUEST_*` | ⚠️ GAP | Bỏ code (controller/service/DTO/đăng ký module); giữ file schema + dọn dẹp ở purge/ẩn danh (11.1b #1) | FR-12 |
| `assignable-users` (module, controller, service, DTO; `purpose=assign|filter`) và các nơi FE dùng: `useCatalogs().assignable/users`, `useAssignableUsers`, `useAssigneeFilterOptions` (`fetchAssigneeFilterUsers`), `BulkActionBar`, `CreateCustomerFormBody`, `CareTeamCard`, `CustomerToolbar`, `AdvancedFilterModal`, `DailyTasks` | ⚠️ GAP | **Xóa hẳn** module BE; thay: mời/gán → `care-team-invitees`, ô lọc người chăm sóc → `customer-assignees` mới (5.5a) | FR-09, 14, 20 |
| `daily-tasks.service.ts`: lọc "của tôi" theo `primaryAssigneeId` ở 3 nguồn (lịch hẹn dòng 284, việc kế tiếp dòng 367, khách lâu chưa chăm dòng 522); nguồn dịp đặc biệt đã theo `careTeam.userId` | ⚠️ GAP | Đổi theo mọi thành viên `careTeam` | FR-19 |
| `reminder-dispatch.service.ts` (nhắc theo `careTeam`) | ⚠️ CẦN ĐỔI (T-14) | Đổi người nhận của ba loại nhắc (lịch hẹn, việc kế tiếp, khách lâu chưa chăm) từ người thực hiện/người ghi nhật ký/PRIMARY sang MỌI thành viên `careTeam` ACTIVE (PRIMARY `HIGH`, MEMBER `NORMAL`); nhắc dịp đặc biệt đã đúng; bỏ người BLOCKED; không còn ai thì hủy nhắc | FR-18, 19 |
| Rate-limit `CrmRateLimitService` (`PHONE_LOOKUP`, `JOIN_REQUEST`), `CrmAbuseMonitorService` | ⚠️ GAP | Bỏ hai khóa cũ, thêm `CARE_TEAM_INVITE`, `INVITEE_SEARCH` | FR-12, 17 |
| `ErrorCode`: `CUSTOMER_PHONE_DUPLICATED`, `JOIN_REQUEST_EXISTS/RESOLVED`, `ALREADY_IN_CARE_TEAM`, `PRIMARY_REPLACEMENT_REQUIRED` | ⚠️ GAP | `ALREADY_IN_CARE_TEAM` còn dùng (`planAddMembers`) nên giữ (FR-12 cho phép) | FR-01, 12 |
| Counter nguyên tử cho mã | 🆕 MỚI | Chưa có hạ tầng counter (`grep` chỉ thấy rate-limit); tạo `counters` + `CounterService` | FR-07 |
| Migration registry 007, 008, 009; runner chạy **mọi** migration chờ trong một lượt, không có khái niệm pha | ⚠️ GAP | Thêm 010, 011 và thuộc tính `phase` | FR-21 |
| `deploy.sh` bước 8c (`run_catalog_codes_cli` + `apply_catalog_codes`), test `scripts/tests/deploy-catalog-codes.test.sh` trích hàm từ `deploy.sh` bằng `sed` | ⚠️ GAP | Tách ra `scripts/post-migrate/` | FR-23 |
| `scripts/staging.sh` (`init`, `seed-prod102`, `deploy`, `status`, `down`, `reset`), chưa có lệnh nạp dump thật | ⚠️ GAP | Thêm `restore-dump` | FR-21 |
| `crm-catalog-codes.cli.ts` + `crm-catalog-codes-app.ts` (CLI độc lập, dry-run mặc định, `--apply`) | ✅ ĐÃ CÓ | Mẫu cho CLI bù mã khách; **không đổi** | FR-21, 23 |
| FE `RealEstateAdminApp/src/modules/crm` (màn Customers, CustomerDetail, CreateCustomer, Appointments, DailyTasks, mock API + `crmStorage`) | ⚠️ GAP | Xem mục 6 | FR-02..04, 09..14, 20 |
| FE `stnd-crm-unified/src/modules/crm` (bản prototype cùng cấu trúc module, cấu trúc `api/` khác: `crmWriteApi.ts`, `hooks.ts`, `queries.ts`) | ⚠️ GAP | Làm tương đương, theo cấu trúc riêng của nó | FR-02..04, 09..14, 20 |
| Ứng dụng Expo `RealEstateApp` | ✅ ĐÃ CÓ | `grep` không có màn/ API khách (CRM) nào: **không phải sửa**; QA rà lại bằng grep khi nghiệm thu | FR-09 |

---

## 3. Data Model (MongoDB / Mongoose)

> Cột `FR` (ở mục 3, 4, 10): ghi mã FR-xx mà dòng này đáp ứng. Mọi thay đổi theo mô hình **expand → đổi code → contract** (Zero-Downtime): 010 chỉ **thêm**, 011 (bỏ unique) chạy sau cùng và một chiều.

| Collection | Trường | Kiểu | Ràng buộc / Index | FR |
|---|---|---|---|---|
| `customers` | `customerCode` | `String` (tùy chọn ở mức schema, luôn có sau bù mã) | Index **partial unique** `customerCode_1`: key `{customerCode:1}`, `unique:true`, `partialFilterExpression:{customerCode:{$type:'string'}}`. Khai báo trong schema **và** tạo ở migration 010 bằng **cùng một hằng số** `CUSTOMER_CODE_INDEX` (khớp từng tùy chọn, tránh `IndexOptionsConflict` khi autoIndex). Không sửa được sau khi có (service không nhận trong DTO). Không tái sử dụng. Giữ nguyên khi ẩn danh hóa. | FR-07, 08, 21 |
| `customers` | `phone` | `String \| null` (đổi từ bắt buộc; `default: null`) | **Bỏ** unique. Index thường `phone_1` (không unique) do **migration 011 sở hữu**, **không khai báo trong schema** (tiền lệ `crm-attachment.schema.ts`: collection đã có dữ liệu thì index do migration tạo; tránh autoIndex của backend mới đụng `phone_1` unique còn tồn tại trước 011). Chuỗi rỗng từ client được chuẩn hóa thành `null` ở service. | FR-01, 02, 21 |
| `customers` | `searchText` | `String` | Phần thứ 3 (các dạng số) rỗng khi `phone` null; vẫn ba phần ngăn cách `\n` để giữ quy tắc chặn dò số #37 | FR-06 |
| `customers` | `careTeam[]`, `primaryAssigneeId`, `teamIds` | giữ nguyên | Bất biến: rỗng hoặc đúng 1 PRIMARY. Người tạo luôn là PRIMARY. `teamIds` = hợp nhóm các thành viên, **có thể `[]`** khi chỉ có Admin (Admin không thuộc nhóm); mọi chỗ giả định `teamIds` không rỗng phải rà (xem 5.2). Thêm giới hạn nghiệp vụ: tối đa 10 MEMBER. | FR-10, 11, 13, 15, 17 |
| `customers` | `phone` khi ẩn danh hóa | `null` | Thay giá trị giả `anonymized:<id>`; `searchText: ''` như cũ | FR-06 |
| `counters` | `_id: String` (khóa `CUSTOMER_CODE`), `seq: Number` | 🆕 mới | `_id` là khóa duy nhất. `seq` = số thứ tự đã cấp lớn nhất. Cập nhật chỉ qua `$inc` trong transaction; `$max` khi đồng bộ với mã đã có. Tạo bằng upsert ở migration 010 (`$setOnInsert seq: 0`). Dùng chung được cho mã khác sau này. | FR-07, 08 |
| `system` | doc sổ `migration:010_crm_customer_code_index`, `migration:011_crm_drop_unique_phone` | theo sổ hiện có | Script bù mã khách đọc doc 010 để quyết định có làm việc không. | FR-21 |
| `system` | doc `script:crm-customer-codes` (tùy chọn) | `{lastRunAt, assigned, remaining, by}` | Vết vận hành (audit trail của thao tác dữ liệu hệ thống): lần chạy gần nhất, số khách được bù, số còn thiếu | FR-08, 21 |
| `care_team_requests` | giữ nguyên | không đổi | **Không xóa collection hay dữ liệu**; code truy cập bị bỏ, trừ phần dọn dẹp khi xóa vĩnh viễn/ẩn danh khách (11.1b #1) | FR-12 |
| `notifications` | `type = CARE_TEAM_JOIN_REQUESTED` (dữ liệu cũ) | giữ | Giá trị enum giữ để hiển thị thông báo cũ (không còn hành động); ngừng phát sinh mới | FR-12 |
| `crm_audit_logs` | `action`: `JOIN_REQUEST_CREATED/RESOLVED`, `PHONE_LOOKUP` (dữ liệu cũ) | giữ | Giữ giá trị enum để đọc log cũ; ngừng ghi mới. `CUSTOMER_CREATED` thêm `customerCode` vào `details`; `CARE_TEAM_MEMBER_ADDED/REMOVED` giữ | FR-03, 12 |

### 3.1 Định nghĩa migration (một chiều, idempotent, đánh số liền 010)

| Id | Pha | Nội dung | Idempotent | Ghi chú | FR |
|---|---|---|---|---|---|
| `010_crm_customer_code_index` | `pre-up` (mặc định) | (1) Tạo index partial unique `customerCode_1` bằng `CUSTOMER_CODE_INDEX`; (2) upsert doc `counters` `CUSTOMER_CODE` với `$setOnInsert { seq: 0 }`. **Không** bù mã, **không** đụng `phone`. Chạy ở 6b khi image v1.0.3 còn phục vụ: index partial không chặn khách chưa có mã nên không `E11000`. Nếu đã có index cùng tên khác tùy chọn thì thất bại rõ ràng (không tự xóa). | Có (tạo index trùng spec là no-op) | Thêm vào `MIGRATIONS` sau 009; `validateMigrationRegistry` vẫn liền số | FR-07, 21 |
| `011_crm_drop_unique_phone` | **`post-up`**, đánh số **cuối** | (1) `dropIndex('phone_1')` nếu đang là unique (bỏ qua nếu không có); (2) tạo `phone_1` **thường**; (3) `updateMany({phone: /^anonymized:/}, {$set:{phone:null}})`; không `down` (một chiều). **Bước (3) bắt buộc đứng sau (1)**: nhiều khách `phone: null` trên index unique cũ sẽ `E11000`. | Có | `description` ghi rõ "MỘT CHIỀU"; không dựng lại unique được khi đã có SĐT trùng | FR-01, 06, 21 |

Mọi migration sau này đánh số tiếp từ 012. Quy tắc runner (mục 5.7) cấm theo cả hai chiều (`pre-up` vượt mặt `post-up` nhỏ hơn còn chờ, và `post-up` vượt mặt `pre-up` nhỏ hơn còn chờ), để không tạo lỗ hổng sổ.

### 3.2 Hằng số dùng chung (không phụ thuộc NestJS, import được từ migration/CLI)

Tệp `customer-code.constants.ts`: tiền tố `KH-`, độ rộng 6, `COUNTER_KEY = 'CUSTOMER_CODE'`, `CUSTOMER_CODE_INDEX` (key + options + name), `formatCustomerCode(seq)` (`KH-` + `padStart(6,'0')`; vượt 999.999 thì tự dài thêm, `KH-1000000`), `parseCustomerCodeSeq(code)` (null nếu sai định dạng). Một nguồn duy nhất cho schema, migration 010, service và script bù mã. **FR-07, 08, 21.**

---

## 4. API Contract

> Mọi endpoint dưới `/api/v1/...`, có Swagger, thành công `{ data, meta }`, lỗi theo `GlobalExceptionFilter` `{ statusCode, message, timestamp, path }` (kèm `errorCode`/`details` như hiện có). Bảng chỉ liệt kê endpoint đổi/mới/bỏ.

| Method | Endpoint | Quyền | Request | Response | FR |
|---|---|---|---|---|---|
| GET | `/api/v1/crm/customers` | CRM_ROLES (phạm vi như cũ) | Thêm: `q` hỗ trợ mã khách (xem 5.3). `primaryAssigneeIds` đã có, giữ. | Mỗi item thêm `customerCode: string \| null` **cho mọi vai trò**; `phoneMasked: string \| null`; `primaryAssignee: { id, displayName, isLocked }` (`isLocked` = tài khoản `BLOCKED`, thêm tùy chọn vào ref). FE chỉ **hiển thị** cột/bộ lọc người chăm sóc chính cho Admin/Manager; API không đổi quyền xem | FR-04, 09 |
| GET | `/api/v1/crm/customers/:id` | như cũ | – | Thêm `customerCode`; `phoneMasked` null được; `careTeam[].user.isLocked`; **bỏ** `permissions.canChangePrimary` (không giữ cho bản cũ); thêm `permissions.canSetInitialPrimary` (= Admin/Manager và `careTeam` rỗng) | FR-04, 09, 11 |
| GET | `/api/v1/crm/deleted-customers` | ADMIN (như cũ) | – | Thêm `customerCode` ở mỗi item | FR-09 |
| POST | `/api/v1/crm/customers` | CRM_ROLES **kể cả Admin thuần** | Body: `fullName*`, `phone?` (null/rỗng được; khi có thì chuẩn hóa `+84…` và kiểm định dạng như cũ, `400 INVALID_PHONE`). **Không còn trường `careTeam`** (DTO không nhận; gửi lên bị `forbidNonWhitelisted` trả `400`, kể cả từ PWA cũ chưa tải lại, xem R11). Header `X-Idempotency-Key` như cũ | `201 { data: { ...customer, customerCode }, meta }`. Không còn `409 CUSTOMER_PHONE_DUPLICATED`. Người tạo là PRIMARY ở mọi vai trò | FR-01, 02, 07, 10 |
| PATCH | `/api/v1/crm/customers/:id` | như cũ | `phone: null` hoặc `''` xóa số; có giá trị thì chuẩn hóa. **Không** nhận `customerCode` (trường lạ → 400) | Không còn 409 trùng SĐT (giữ `VERSION_CONFLICT`). Lịch sử thay đổi SĐT cũ → mới hiển thị `—` cho null (quyết định #34 giữ) | FR-01, 02, 06 |
| POST | `/api/v1/crm/customers/phone-lookups` | – | – | **Xóa hẳn** (404). Không có bản chuyển tiếp; Swagger/OpenAPI không còn route | FR-03, 20 |
| POST | `/api/v1/crm/customers/:id/phone-views` | thành viên chăm sóc / Admin / Manager (như cũ) | – | Khách `phone` null → `409 CUSTOMER_PHONE_NOT_SET` (kiểm **sau** kiểm phạm vi, **trước** rate-limit/audit): không ghi `PHONE_VIEWED` | FR-04 |
| GET | `/api/v1/crm/customers/:id/care-team` | như cũ | – | Thành viên có `isLocked` | FR-09, 18 |
| POST | `/api/v1/crm/customers/:id/care-team/members` | ADMIN, MANAGER, hoặc PRIMARY của khách | `{ userIds[], primaryUserId? }`. `primaryUserId` chỉ hợp lệ khi `careTeam` **rỗng** và người gọi là Admin/Manager (đặt PRIMARY lần đầu cho khách cũ); ngoài trường hợp đó `400 VALIDATION_FAILED`. Rate-limit `CARE_TEAM_INVITE` 30/phút/người | `201 { data: careTeam }` (mặc định POST của NestJS, không `@HttpCode`; sửa từ 200, đồng bộ theo code (2026-11-11)). Lỗi: `400 USER_NOT_ASSIGNABLE` (không ACTIVE hoặc không có role Manager/Staff; **không còn** lý do "ngoài nhóm"), `409 ALREADY_IN_CARE_TEAM`, `409 CARE_TEAM_LIMIT_EXCEEDED` (quá 10 MEMBER), `429 RATE_LIMITED`. Người được mời nhận `CUSTOMER_ASSIGNED` (bỏ tài khoản BLOCKED) | FR-11, 13, 16, 17 |
| DELETE | `/api/v1/crm/customers/:id/care-team/members/:userId` | ADMIN, MANAGER, PRIMARY | **Bỏ** tham số `newPrimaryUserId` (khỏi DTO/query; không còn ý nghĩa) | Chỉ gỡ MEMBER. Gỡ PRIMARY → `409 PRIMARY_LOCKED`. Thành viên phụ không tự rời (chỉ PRIMARY/Manager/Admin gỡ, như cũ) | FR-11, 13 |
| PUT | `/api/v1/crm/customers/:id/care-team/primary` | – | – | **Xóa hẳn** (404). Không giữ route trả 409; việc đổi PRIMARY không còn tồn tại. `PRIMARY_LOCKED` chỉ trả ở `DELETE member` khi gỡ PRIMARY | FR-11, 20 |
| POST | `/api/v1/crm/customer-bulk-operations` (`ASSIGN`) | ADMIN, MANAGER | `payload.memberIds` bắt buộc; `payload.primaryUserId` → `400 VALIDATION_FAILED` ("không đặt PRIMARY hàng loạt") | Chỉ thêm MEMBER, `skipExisting` giữ; khách `careTeam` rỗng báo lỗi từng khách `PRIMARY_REQUIRED` (đặt PRIMARY lần đầu dùng `POST members`); giới hạn 10 MEMBER áp từng khách; không còn giới hạn nhóm | FR-11, 13, 17 |
| GET | `/api/v1/crm/care-team-invitees` | CRM_ROLES | Query: `customerId?`, `q?` (tối đa 50 ký tự), `page`, `limit` (≤ 20). Có `customerId`: người gọi phải là Admin/Manager hoặc PRIMARY của khách đó (ngoài ra `404`/`403` như phạm vi khách) và kết quả **loại** người đã trong `careTeam`. Không `customerId`: chỉ Admin/Manager (nguồn người nhận khi giao hàng loạt `POST /crm/customer-bulk-operations`, đồng bộ theo code (2026-11-11)). Rate-limit `INVITEE_SEARCH` 60/phút/người | 🆕 `200 { data: [{ id, displayName, teamNames: string[] }], meta: { total, page, limit, totalPages } }` (chuẩn `buildPaginationMeta`). Chỉ user ACTIVE, chưa xóa mềm, có role Manager/Staff, loại chính người gọi, sắp theo `displayName`. **Không có** email/SĐT/CCCD/role/id nhóm | FR-13, 14 |
| GET | `/api/v1/crm/customer-assignees` | CRM_ROLES | 🆕 Query: `q?` (tối đa 50 ký tự), `teamId?`, `page`, `limit` (≤ 100). Nguồn cho **ô lọc "Người phụ trách"** (thay `assignable-users?purpose=filter`). Tập người = những người **xuất hiện trong `careTeam`** của các khách mà người gọi được thấy (`buildCustomerScope`, bỏ khách xóa mềm), lấy bằng `distinct('careTeam.userId')` (một truy vấn, không N+1); loại user đã xóa mềm; **không lọc trạng thái** để lọc được khách của PRIMARY bị khóa. Không rate-limit riêng (rate-limit chung) | `200 { data: [{ id, displayName, role, team, teams, isLocked }], meta }` (`AssignableUserResponseDto` cũ + `isLocked`; sắp theo `displayName`, collation `vi`). Không email/SĐT/CCCD. Endpoint **ngoài Plan**, thêm để thay nhánh `purpose=filter` của `assignable-users` (11.1a #2); **không** là nguồn ô chọn người mời/giao: việc đó dùng `care-team-invitees` (đồng bộ theo code (2026-11-11)) | FR-09, 18 |
| GET | `/api/v1/crm/assignable-users` | – | – | **Xóa hẳn** (404), cả `purpose=assign` lẫn `purpose=filter`. Mời/gán dùng `care-team-invitees`; ô lọc dùng `customer-assignees` | FR-09, 14, 20 |
| POST/GET/PATCH | `/api/v1/crm/care-team-requests` | – | – | **Xóa hẳn** (404). Bản PWA cũ chưa tải lại sẽ lỗi ở hộp thông báo đề nghị (R11) | FR-12 |

### 4.1 Mã lỗi (`ErrorCode`)

| Hành động | Mã | FR |
|---|---|---|
| Bỏ | `CUSTOMER_PHONE_DUPLICATED`, `JOIN_REQUEST_EXISTS`, `JOIN_REQUEST_RESOLVED`, `PRIMARY_REPLACEMENT_REQUIRED` (coder `grep` xác nhận không còn nơi dùng trước khi xóa) | FR-01, 11, 12 |
| Giữ | `ALREADY_IN_CARE_TEAM` (còn dùng ở `planAddMembers`), `PRIMARY_REQUIRED`, `USER_NOT_ASSIGNABLE`, `CARE_TEAM_ACTION_FORBIDDEN`, `INVALID_PHONE`, `VERSION_CONFLICT` | FR-12 |
| Thêm | `PRIMARY_LOCKED` (409), `CARE_TEAM_LIMIT_EXCEEDED` (409), `CUSTOMER_PHONE_NOT_SET` (409) | FR-11, 17, 04 |
| Giữ giá trị enum, ngừng phát sinh | audit `PHONE_LOOKUP`, `JOIN_REQUEST_CREATED/RESOLVED`; notification `CARE_TEAM_JOIN_REQUESTED` (để đọc dữ liệu cũ) | FR-03, 12 |

### 4.2 CLI/Script (không phải HTTP)

| Lệnh | Đầu vào | Kết quả | FR |
|---|---|---|---|
| `node dist/migrations/cli.js reconcile\|up --apply [--phase pre-up\|post-up\|all]` | `--phase` mặc định `all` (giữ hành vi cho người chạy tay/`scripts/run-migration.sh`); `deploy.sh` luôn truyền `pre-up` ở 6b/8a/8b và `post-up` ở bước 90 | Mã thoát như hiện có (0/1/2/3/4/5) | FR-21 |
| `node dist/migrations/crm-customer-codes.cli.js [--apply]` | Dry-run mặc định như `crm-catalog-codes.cli.js` | 0 = xong/không việc; 1 = lỗi, còn khách thiếu mã hay sổ không đọc được; 2 = sai tham số. In tóm tắt `assigned`, `remaining` | FR-08, 21 |
| `node dist/migrations/crm-catalog-codes.cli.js --apply` | **không đổi** | **không đổi** | FR-23 |

---

## 5. Service & luồng xử lý

### 5.1 Cấp mã khách (FR-07)

- `CounterService.next(key, count, session)` (module `shared/counters`, schema `Counter`): `findOneAndUpdate({_id:key},{$inc:{seq:count}},{upsert:true,new:true,session})`, trả khoảng `[seq-count+1, seq]`. Gọi **trong transaction** tạo khách nên `$inc` rollback cùng khách (không thủng số, không tái sử dụng).
- Tạo 1 khách: `count = 1`. Nếu sau này có đường tạo hàng loạt: **mỗi lô một lần** `$inc` n (lô ≤ 200, một transaction/lô), không mỗi mã một lần. Hiện BE không có đường tạo hàng loạt (nhập/xuất khách ngoài phạm vi, xem 10.2 FR-05).
- Điểm tranh chấp: một doc counter làm các transaction tạo khách đồng thời xung đột ghi (`TransientTransactionError`) → `withTransaction` tự retry. Thứ tự trong transaction: **đọc/kiểm tra trước, `$inc` rồi insert sau cùng** để giữ khóa ngắn nhất. Chấp nhận ở quy mô CRM; test đồng thời N khách không trùng mã (FR-07).
- Index unique partial là lớp bảo vệ cuối; trùng mã (không thể xảy ra bình thường) báo lỗi 500 có log, không tự thử lại.

### 5.2 Tạo/sửa khách (FR-01, 02, 04, 06, 10)

- `create`: bỏ kiểm trùng SĐT và `buildDuplicateError`; `phone` rỗng → `null`; DTO **không còn** trường `careTeam` (xóa khỏi `CreateCustomerDto`, kể cả khối Swagger); luôn `careTeam = [{ userId: người tạo, role: PRIMARY, addedBy: người tạo, addedAt }]`, `primaryAssigneeId = người tạo`, `teamIds` = nhóm của người tạo (Admin thuần: `[]`). Vẫn `lock` doc người tạo trong transaction (chống write-skew đổi nhóm, như `lock` của assignee hiện có).
- Người tạo đủ điều kiện: ACTIVE (đã bảo đảm bởi guard FR-21 `crm-fr21-active-crm-user`) và có role CRM. **Không** dùng `hasCrmTeamRole` cho việc này (hàm đó còn dùng ở `team-membership.util.ts`, `users.service.ts`, không đổi); thêm helper riêng `canBePrimary(roles)` (ADMIN, MANAGER hoặc STAFF) tại `care-team.rules.ts`/`user-roles.util` mới, còn người **được mời** vẫn dùng điều kiện Manager/Staff.
- Rà `teamIds` rỗng: `buildCustomerScope` (ADMIN thấy tất cả; Manager theo `teamIds ∩ nhóm quản lý` hoặc trong `careTeam`; Staff theo `careTeam`) chạy được với `[]`; coder `grep` mọi nơi giả định `teamIds[0]`/không rỗng (list, `customerScopeStages`, thông báo) và test.
- `update`: bỏ nhánh bắt `E11000` trên `phone`; `buildSearchText` nhận `phone: string \| null`; `customer-audit.util.ts` (`maskPhone` chỉ khi có giá trị) và lịch sử thay đổi null-safe.
- `toPhoneMasked` trả `null` khi `phone` null hoặc đã ẩn danh; DTO `phoneMasked: string \| null` (`ApiProperty({nullable:true})`); `appointment.mapper.ts` và `daily-tasks.service.ts` (chọn trường `phone`) null-safe.
- Ẩn danh hóa (`customer-lifecycle.service.ts`): `phone: null` thay `anonymized:<id>`, `searchText: ''`, **giữ** `customerCode` (không phải dữ liệu cá nhân, phục vụ truy vết, không tái sử dụng).
- `CustomerPhoneService.view`: sau kiểm phạm vi, nếu `phone` null → `CUSTOMER_PHONE_NOT_SET`; không consume `PHONE_VIEW`, không ghi `PHONE_VIEWED`.

### 5.3 Danh sách, tìm kiếm, lọc (FR-09, 06)

- Mapper danh sách/chi tiết: thêm `customerCode`; `customer-list.service.ts` chọn thêm trường `customerCode`; `UserRefDto` thêm `isLocked?` (cộng thêm, tương thích); bộ nạp ref người dùng đọc thêm `status` để tính `isLocked`.
- Từ khóa tìm: thêm loại `code` vào `parseKeyword`, **ưu tiên trước** nhánh số: khớp `^kh-?\d+$` (không phân biệt hoa/thường, bỏ khoảng trắng). Điều kiện: `customerCode` bằng dạng đệm 6 số **hoặc** tiền tố nhập vào (regex neo đầu, qua `escapeRegex`), kèm `{ $type: 'string' }` để planner dùng được index partial. Từ khóa **toàn số** vẫn là SĐT (đúng quy tắc chặn dò số #37, không đổi); muốn tìm mã phải gõ `KH`. Mã không nhạy cảm nên không áp ngưỡng 4 chữ số.
- Lọc theo người chăm sóc chính: `primaryAssigneeIds` **đã có** ở BE và FE (`AdvancedFilterModal`); chỉ cần FE hiện cho Admin/Manager và nguồn tùy chọn là endpoint mới `customer-assignees` (5.5; gồm cả người bị khóa, kèm `isLocked`).

### 5.4 Nhóm chăm sóc: khóa PRIMARY, mời, giới hạn (FR-11, 12, 13, 16, 17, 18)

- `care-team.rules.ts`: `planRemoveMember` — mục tiêu là PRIMARY → `PRIMARY_LOCKED` (bỏ tham số `newPrimaryUserId`); `planChangePrimary`, `canChangePrimary`, route `PUT primary` (controller + DTO + service method) và `permissions.canChangePrimary` **xóa hẳn** (chỉ còn trường hợp đặt PRIMARY lần đầu khi `careTeam` rỗng, đã có trong nhánh `current.length === 0` của `planAddMembers`, giữ nguyên `PRIMARY_REQUIRED`); `allowPrimaryChange` bỏ. Bất biến `assertCareTeamInvariant` giữ.
- Chặn đặt PRIMARY lần đầu cho khách cũ chỉ Admin/Manager (STAFF không phải PRIMARY nên đã không có quyền `POST members` khi `careTeam` rỗng).
- `CareTeamAssigneesService.assertAssignable`: bỏ tham số `restrictToActorScope` và nhánh `sharesAnyTeam`/`resolveAssignableTeamIds` (Manager, PRIMARY, Admin đều không giới hạn nhóm). Điều kiện còn lại: tồn tại, chưa xóa mềm, `ACTIVE`, có role MANAGER hoặc STAFF.
- Khóa write-skew `lock()` giữ cho mọi người được thêm (đổi nhóm của họ đồng thời vẫn buộc một bên retry; `teamIds` luôn tính lại trong cùng transaction).
- **Giới hạn 10 MEMBER** (FR-17): kiểm trên `careTeam` **sau** khi lập kế hoạch, trong cùng transaction với việc đọc `careTeam` (cơ chế phiên bản/`touch` hiện có xử lý hai lần thêm đồng thời). `PRIMARY` không tính. Khách cũ đã quá 10: chỉ chặn **thêm**, vẫn gỡ được, không ép cắt. Áp cả bulk `ASSIGN` (lỗi từng khách).
- Rate-limit: khóa mới `CARE_TEAM_INVITE` `{30, 60_000}` gọi ở `POST members` (một lần mỗi request); `INVITEE_SEARCH` `{60, 60_000}` ở endpoint invitees. Bỏ khóa `JOIN_REQUEST`, `PHONE_LOOKUP`. `CrmAbuseMonitorService`: bỏ các tham chiếu `PHONE_LOOKUP`/đề nghị; giữ cảnh báo xem SĐT bất thường (`PHONE_VIEWED`).
- Bỏ luồng X2: xóa `care-team-requests.controller/service`, DTO, đăng ký module (`CareTeamsModule`, `CustomersModule` bớt `CareTeamRequest` model), mã thông báo gửi `CARE_TEAM_JOIN_REQUESTED`, push category tương ứng nếu có. Giữ file `schemas/care-team-request.schema.ts` cho phần dọn dẹp ở 5.11 (11.1b #1).
- Thông báo `CUSTOMER_ASSIGNED` cho người được mời: tại điểm tạo/gửi thông báo/push chung (`modules/notifications`, coder xác định tệp), **lọc người nhận `status = ACTIVE`** để BLOCKED không nhận, áp cho mọi loại thông báo (FR-18), không riêng loại này. Đã có `touch` hiện tại cho mời hàng loạt (`pushGroupKey` `BULK:`) giữ.
- Khóa tài khoản: không có đường API xóa user, không đổi. PRIMARY BLOCKED giữ nguyên trên `customers`; mở khóa lại là bình thường (FR-18).

### 5.5 Danh sách người được mời (FR-14)

Service `CareTeamInviteesService` (module `care-teams`, controller riêng `care-team-invitees.controller.ts`; thay thế phần "mời/gán" của `assignable-users` đã xóa): truy vấn `users` `{deletedAt:null, status:ACTIVE, roles chứa MANAGER/STAFF (chỉ lọc mảng `roles`; hook `pre('validate')` của User luôn đồng bộ `role` với `roles` nên không cần lọc thêm `role`), _id ≠ người gọi, _id ∉ careTeam (nếu có customerId)}`, `q` khớp `displayName` bằng regex `escapeRegex` không phân biệt hoa/thường, `select('displayName teamIds')`, một truy vấn `teams` gom tên nhóm (tránh N+1; chỉ nhóm `deletedAt: null`), phân trang `skip/limit` ≤ 20, tổng bằng `countDocuments`. DTO response chỉ có `id`, `displayName`, `teamNames`. Index `users` cho `status`/`displayName` đã đủ ở quy mô hiện tại (không thêm index mới).

### 5.5a Danh sách người cho ô lọc "Người phụ trách" (FR-09, 18) — thay `assignable-users?purpose=filter`

Service `CustomerAssigneesService` (module `customers`, controller `customer-assignees.controller.ts`, route `GET /crm/customer-assignees`; thế chỗ module `assignable-users` bị xóa). Logic lấy từ nhánh `purpose=filter` của service cũ, **áp cho mọi vai trò** (không còn nhánh "gán" theo nhóm): `actor = CrmActorService.resolve(jwt)`; `userIds = customerModel.distinct('careTeam.userId', { $and: [buildCustomerScope(actor), { deletedAt: null }] })`; rồi `users.find({ _id: {$in: userIds}, deletedAt: null, [teamIds = teamId nếu có], [displayName ~ q qua escapeRegex] })` sắp `displayName, _id` (collation `vi`), phân trang `skip/limit` ≤ 100, `countDocuments`, một truy vấn `teams` gom tên nhóm (không N+1). Response thêm `isLocked` (= `status BLOCKED`). Không lọc trạng thái/role (khách vẫn gắn với người đã khóa hoặc đổi role và người dùng cần lọc được họ). Index `careTeam.userId` đã có. Vai trò không thuộc CRM_ROLES: `403` theo guard hiện có. FE chỉ hiện ô này cho Admin/Manager ở màn khách (FR-09); `DailyTasks` vẫn dùng cùng hook (xem 6.3).
- Hệ quả hành vi đã nêu ở 11.1a #2: Nhân viên (nếu có ô lọc) thấy người trong nhóm chăm sóc của **khách mình thấy** thay vì "người cùng nhóm".
- Không lộ thêm dữ liệu: mỗi người xuất hiện trong danh sách chỉ khi người gọi vốn đã thấy họ trong `careTeam` của một khách trong phạm vi.

### 5.6 "Việc của tôi" cho khách PRIMARY khóa/null (FR-19, 04)

`daily-tasks.service.ts`: ba nguồn đang so `primaryAssigneeId = tôi` đổi thành **tôi nằm trong `careTeam`**:
- lịch hẹn: `$or: [assigneeId = tôi, customer.careTeam.userId = tôi]` (đổi `customerScopeStages(..., { careTeam: 1 })`, chỉ thêm trường đã chiếu);
- việc kế tiếp (care log `nextAction`): `$or: [authorId = tôi, customer.careTeam.userId = tôi]`;
- khách lâu chưa chăm: `careTeam.userId = tôi` thay `primaryAssigneeId = tôi`;
- dịp đặc biệt: đã theo `careTeam.userId`, giữ.
Người gọi luôn ACTIVE (guard) nên "mọi thành viên ACTIVE" thỏa. Cờ `isPrimary` trong phản hồi vẫn tính từ `primaryAssigneeId`. Khách `careTeam` rỗng (PRIMARY null) không ai "của tôi", chỉ hiện ở chế độ toàn bộ của Admin/Manager (đúng phạm vi của họ). `reminder-dispatch.service.ts`: nhắc cho mọi thành viên `careTeam` ACTIVE (PRIMARY `HIGH`, MEMBER `NORMAL`; bỏ người BLOCKED; `careTeam` rỗng thì hủy nhắc).

### 5.7 Runner migration: thuộc tính `phase` (FR-21)

- `Migration` thêm `phase?: 'pre-up' | 'post-up'` (mặc định `pre-up`); 007–010 không đổi (mặc định), 011 `post-up`.
- `reconcile`/`up` nhận `--phase pre-up|post-up|all` (mặc định `all`): chỉ **chọn** migration chờ theo pha (`selectPendingMigrations` và `plan.pendingIds` lọc theo pha); không đổi cách ghi sổ, khóa, mã thoát. `status` in cột pha và đếm riêng "chờ post-up". Việc ghi `version` (8b) giữ nguyên, không phụ thuộc việc còn migration post-up chờ.
- **Quy tắc an toàn sổ (HAI chiều):** một lần chạy theo pha không được ghi sổ vượt mặt migration pha **kia** còn chờ có số **nhỏ hơn**; vi phạm → từ chối (mã 1, không ghi gì), áp dụng cho cả `up` và `reconcile`, cả dry-run lẫn `--apply` (cùng hàm `findPhaseOrderViolation` trong `migration-phase.ts`, `reconcile` gọi qua `planReconcile`). `--phase all` chạy theo thứ tự số nên luôn hợp lệ.
  - **Chiều 1 (`pre-up`):** còn migration `post-up` chờ có số nhỏ hơn migration `pre-up` chờ cao nhất → thông báo nêu cả hai id và lệnh cần chạy trước: `--phase post-up`. Xảy ra khi bản sau (có 012 `pre-up`) deploy lên DB mà bước 90 của lần trước chưa xong.
  - **Chiều 2 (`post-up`, bổ sung theo duyệt của Oniichan):** còn migration `pre-up` chờ có số nhỏ hơn migration `post-up` chờ cao nhất → thông báo nêu cả hai id và lệnh cần chạy trước: `--phase pre-up`. **Lý do:** 011 là một chiều; nếu cho ghi sổ khi 010 (hoặc 007..009) chưa chạy thì sổ có 011 mà thiếu 010, lần `reconcile` sau bị `findLedgerGap` từ chối ("chưa chạy nhưng migration sau nó đã vào sổ"), nên các pre-up chờ không bao giờ áp dụng được bằng runner và cổng sổ của CLI bù mã đóng. Chiều này chỉ xảy ra khi bỏ sót 6b hoặc chạy tay.
  - **Không ảnh hưởng luồng deploy hợp lệ:** `deploy.sh` luôn chạy `--phase pre-up` (6b/8a/8b) trước, bước 90 (`--phase post-up`) chỉ chạy sau khi không còn pre-up chờ (cổng chặn `require_pre_up_done` của `90-post-up-migrations.sh` đã từ chối sớm theo `status --json`; quy tắc runner là lớp chặn thứ hai, không phụ thuộc script). Lối thoát khi bị từ chối: chạy pha được khuyên trong thông báo trước rồi chạy lại.
- Cập nhật: `migration.types.ts`, `migration-runner.ts` (lọc), `reconcile-plan.ts`, `cli-app.ts` (`--phase`, `CLI_USAGE`), `migration.registry.ts` + `.spec.ts`, spec/integration của runner và reconcile (thêm ca: pha, từ chối khi có post-up chờ, chạy `all` đúng thứ tự, chạy lại idempotent).

### 5.8 Bù mã khách (FR-08, 21): script riêng

CLI `crm-customer-codes.cli.ts` + `crm-customer-codes-app.ts` (đặt cạnh `crm-catalog-codes.*`, cùng khung `runXxxCli(argv, deps)`, `CONNECTION_HINT`, dry-run mặc định):
1. **Cổng sổ:** đọc doc `migration:010_crm_customer_code_index` trong `system`; **không có** (chưa áp dụng: deploy bản khác, `--no-migrate`, DB cũ) → in "chưa áp dụng, bỏ qua", **thoát 0**, không đụng dữ liệu. Kiểm theo **sổ**, không theo "lần chạy này", nên deploy chạy lại sau khi `up` lỗi vẫn bù được khách tạo trong khoảng trống.
2. **Bù theo lô (mặc định lô 500):** lặp `find({customerCode:{$not:{$type:'string'}}})` (không lọc `deletedAt`: gồm khách xóa mềm/ẩn danh) sắp `createdAt, _id`, `limit` lô; mỗi lô **một transaction**: `$inc` counter `k` rồi `bulkWrite` đặt mã `seq-k+1 … seq`, mỗi thao tác có điều kiện `{_id, customerCode:{$not:{$type:'string'}}}`. Mỗi lô nguyên tử nên chạy dở vẫn nối lại được; chạy lại không đổi mã đã cấp.
3. **Đối soát cuối:** đếm khách còn thiếu mã (phải 0), kiểm số mã không trùng, `$max` đồng bộ counter với mã số lớn nhất đang có (phòng thủ). Ghi doc `script:crm-customer-codes`.
4. In tóm tắt; thoát 1 nếu lỗi hoặc còn thiếu.
- Thứ tự mã: khách cũ được bù theo `createdAt, _id`. Khách do v1.0.3 tạo trong khoảng 6b→`up`, và khách tạo bởi backend mới trong vài giây từ `up` đến lúc script chạy, có thể có mã **không** đúng thứ tự thời gian tuyệt đối (khách mới đã lấy số trước). Chấp nhận, ghi trong tài liệu (thông tin, 11.1b #9).
- Quy mô: thiếu index `createdAt` nên sắp xếp quét cả collection mỗi lô; chấp nhận ở quy mô hiện tại (hàng nghìn khách); nếu lớn hơn thì đọc một lần các `_id` theo thứ tự rồi cắt lô (coder quyết, ghi trong code).

### 5.9 Điểm gọi hậu-migrate dùng chung và tách bước 8c (FR-21, 23)

- `deploy.sh` chỉ giữ **một** hàm `run_post_migrate_steps` (thay `run_catalog_codes_cli` + `apply_catalog_codes` + khối 8c): nếu `DOWNGRADE_ACTIVE=1` thì cảnh báo và bỏ qua toàn bộ; ngược lại chạy lần lượt các tệp `scripts/post-migrate/[0-9][0-9]-*.sh` theo thứ tự tên. **Không có logic bù mã trong `deploy.sh`.** Thứ tự gọi trong `main()` giữ: 8a → 8b → điểm gọi chung (đúng vị trí 8c cũ).
- Hợp đồng mỗi tệp bước: nhận môi trường từ deploy (`ENV_FILE`, `LOGS_DIR`, `TS`, `DOC`, `LOG_PREFIX`; dùng `scripts/lib/ops-common.sh` cho `log/warn/die`), tự chạy lệnh trong container (`compose run --rm --no-deps -T backend node dist/migrations/...`), tự ghi log `"$LOGS_DIR/deploy-<tên>-$TS.log"` (chỉ đầu ra lệnh, không bí mật), tự in cảnh báo **đỏ** và thoát khác 0 khi lỗi; `deploy.sh` thấy khác 0 thì `die` kèm tên bước.
- `10-catalog-codes.sh`: **chuyển nguyên hành vi 8c** (gọi `crm-catalog-codes.cli.js --apply`, log `deploy-catalog-codes-<TS>.log`, cảnh báo đỏ + lệnh chạy lại, thoát khác 0 ⇒ deploy lỗi). Chạy mọi lần deploy.
- `20-customer-codes.sh`: gọi `crm-customer-codes.cli.js --apply`, log `deploy-customer-codes-<TS>.log`, cùng kiểu cảnh báo. Việc "010 chưa áp dụng thì làm gì" nằm **trong script CLI** (5.8), không trong shell.
- `90-post-up-migrations.sh`: `cli.js reconcile --apply --by deploy --skip-version --phase post-up` (chạy 011), log `deploy-post-up-<TS>.log`. Đứng **sau** hai bước bù mã: bù mã lỗi thì chưa bỏ unique (bước một chiều chưa xảy ra). Cửa sổ giữa `up` và bước 90 (`phone_1` còn unique nên có thể `E11000` khi tạo khách trùng/không SĐT thứ hai) **đã được Oniichan chấp nhận** (11.1b #4); giữ thứ tự 10 → 20 → 90 (phương án A, 011 đánh số cuối).
- 6b, 8a, 8b truyền `--phase pre-up` rõ ràng cho runner. Cập nhật mô tả đầu `deploy.sh`, `usage()` và `print_recovery`. **Hướng dẫn lùi (ghi cả vào `print_recovery` lẫn `06_Production_Deploy.md` mục 11):**
  - Trước bước 90 (011 chưa chạy): được phép lùi image v1.0.3 như thường lệ (còn `phone_1` unique, mã khách thừa không ảnh hưởng v1.0.3).
  - **Sau bước 90 (011 đã chạy) chỉ sửa tiến, không lùi image v1.0.3** (một chiều: `phone` có thể `null`/trùng, mapper v1.0.3 giả định `phone` là chuỗi). `print_recovery` phải in rõ câu này kèm cách kiểm 011 đã chạy (`status` hoặc doc sổ `migration:011_crm_drop_unique_phone`); nếu cần quay lại phải khôi phục từ `mongodump` bước 5 (mất dữ liệu sau thời điểm dump) và do Oniichan quyết.
  - Sau deploy, thông báo người dùng **tải lại trang (làm mới cứng/đóng mở lại PWA)** vì các endpoint cũ đã bị xóa (11.1b #5); ghi cùng mục trong `06_Production_Deploy.md`.

### 5.10 Diễn tập staging bằng bản sao dump production (FR-21)

Thêm `scripts/staging.sh restore-dump <đường-dẫn-archive> [--yes]` (chỉ nhắm `rhstg_mongo`, cùng rào tên/cổng hiện có; `mongorestore --drop` DB `realestate` của staging; dump đặt trong `.staging/` đã gitignore, xóa sau diễn tập). Quy trình (chạy bởi `devops-agent`, nghiệm bởi `qa-agent`):
1. Chụp trước: số khách, số khách có SĐT trùng, số khách `phone` bắt đầu `anonymized:`, số khách `careTeam` không rỗng nhưng `primaryAssigneeId` null (phải 0 theo bất biến), `listIndexes` của `customers`, doc `system` (version/sổ).
2. `deploy --plan-only`: chờ 007, 008, 009, 010 (pre-up) và 011 (post-up).
3. **Giả lập khoảng 6b → `up`:** chạy tay `reconcile --apply --skip-version --phase pre-up`; bằng `mongosh` chèn 2 khách **không có `customerCode`** (như image cũ): phải thành công (index partial); chèn khách thứ hai cùng SĐT với khách khác: phải **lỗi** (unique `phone_1` còn, xác nhận 011 chưa chạy).
4. `deploy` đầy đủ: `up` → 10 → 20 (mọi khách có mã, theo `createdAt`, hai khách vừa chèn có mã) → 90 (011). Sau: tạo hai khách cùng SĐT qua API thành công; không còn `anonymized:`; có `phone_1` thường.
5. **Chạy lại:** deploy lần hai (idempotent: không đổi mã, 010/011 no-op, bước 20 báo 0 việc); kịch bản `up` lỗi giữa chừng (làm hỏng khởi động backend) rồi deploy lại: bước 20 vẫn bù đủ khách tạo trong khoảng trống.
6. Đo thời gian từng bước; kiểm cảnh báo/log `deploy-*.log`; kiểm `--no-migrate` (`deploy.sh` dừng TRƯỚC `up` với mã 1 khi còn migration chờ, stack không đổi; vì vậy bước 20 "chưa áp dụng, bỏ qua" thoát 0 và bước 90 từ chối mã 1 được kiểm bằng cách chạy trực tiếp tệp bước trên DB có sổ dừng ở 006) và downgrade có chủ ý (bỏ qua toàn bộ điểm gọi).
Dump chứa dữ liệu cá nhân thật: xem 7 và 11.1b (#10, đã chốt: giữ nguyên, lưu cục bộ, xóa sau diễn tập).

### 5.11 Dọn dẹp khi xóa vĩnh viễn/ẩn danh (FR-12)

`customer-purge.service.ts` và `customer-care-anonymizer.service.ts` đang xóa/ẩn danh `care_team_requests` của khách (có thể chứa lời nhắn tự do). Giữ phần này (model chỉ đăng ký cho hai service này); **không xóa collection, không xóa dữ liệu** (Oniichan đã chốt, 11.1b #1); mọi code khác dùng collection đều bỏ.

---

## 6. Frontend

> Áp dụng song song cho `RealEstateAdminApp` (nguồn chính, PWA admin, màn `*.desktop.tsx` và `*.mobile.tsx`) và `stnd-crm-unified` (prototype, cùng cây `src/modules/crm`, cấu trúc `api/` riêng). Ứng dụng Expo `RealEstateApp` không có màn khách nên không đổi. State: dữ liệu máy chủ qua React Query (hook trong `api/hooks.ts`); trạng thái cục bộ (ô tìm người mời, hộp thoại mở/đóng, nháp form) dùng `useState`; không thêm Zustand/store toàn cục mới (mock store `crmStore` chỉ phục vụ lớp mock).

### 6.1 Hiển thị mã khách (FR-09)

- **Thành phần dùng chung mới** `CustomerCodeBadge` (`components/`): nhận `code: string \| null`, hiển thị chữ đơn cách (`font-mono tabular-nums`), `aria-label="Mã khách KH-000123"`, `null` thì không render (khách đang chờ bù mã trong vài giây deploy). Test: có mã, null, mã dài hơn 6 số.
- **Danh sách bảng desktop** (`Customers/components/CustomerTableRow.tsx`, dòng dưới tên khách): hiển thị `<mã> · <SĐT che>` **ngay cạnh nhau**; khách không có SĐT chỉ hiện mã, không để dấu phân cách thừa; áp dụng **mọi vai trò**.
- **Thẻ mobile/PWA** (`Customers/components/CustomerCard.tsx`, dòng SĐT che): cùng quy tắc.
- **Màn chi tiết**: `CustomerDetail/components/CustomerHeader.tsx` (desktop, đầu hồ sơ ngay dưới/trên họ tên) và `MobileDetailHeader.tsx` (mobile) hiện `CustomerCodeBadge` ở **mọi vai trò**. Hàng "SĐT" trong header và `PhoneDisplay`/`CustomerInfoCard.tsx` null-safe (ẩn dòng khi không có SĐT).
- **Danh sách khách đã xóa** (`DeletedCustomersView.tsx`, Admin): hiện mã (nhận diện khi không có SĐT).
- **Ô tìm kiếm** (`CustomerToolbar.tsx`): placeholder "Tìm tên, SĐT, mã KH-…"; không đổi API gọi (`q`); nhắc người dùng gõ tiền tố `KH` (đã chốt, 11.1b #7).
- **Cột "Người chăm sóc chính" và bộ lọc** — **chỉ Admin/Manager** (kiểm vai trò qua `lib/roles.ts`/`actor.role`): cột hiện có (`CustomerTableRow`, `lg`) ẩn cho Staff; thêm nhãn "đã khóa" (`isLocked`) cạnh tên người; thẻ mobile hiện dòng "Chăm sóc: <tên> (đã khóa)" chỉ cho Admin/Manager; `AdvancedFilterModal` nhóm chip "Phụ trách chính" chỉ cho Admin/Manager, nguồn `useAssigneeFilterOptions` (đã có tên hook; đổi `catalogApi.fetchAssigneeFilterUsers` sang gọi `GET /crm/customer-assignees`, gồm người bị khóa, 5.5a). Staff không thấy cột lẫn bộ lọc.

### 6.2 Thêm/Sửa khách (FR-02, 03, 10)

- `CreateCustomer/`: bỏ dấu `*` ở nhãn SĐT, `customerFormRules.ts`/`createCustomerForm.ts` chỉ bắt buộc họ tên; có nhập thì giữ chuẩn hóa/kiểm định dạng; gửi `phone: null` khi rỗng.
- Bỏ `DuplicatePhoneBanner` (+ test), `usePhoneLookup` và `postPhoneLookup` trong hook/api (route BE đã xóa, 4); không gửi `careTeam` trong payload tạo; bỏ phần chọn người phụ trách khi tạo (`CreateCustomerFormBody.tsx`, `useCreateCustomerForm.ts`): thay bằng dòng chỉ đọc "Người chăm sóc chính: bạn (tự động)" cho mọi vai trò, kể cả Admin. Sau lưu điều hướng như cũ.
- Màn sửa khách: cho xóa SĐT (ô rỗng ⇒ `null`).

### 6.3 Nhóm chăm sóc và mời (FR-11, 12, 13, 14, 17)

- `CustomerDetail/components/CareTeamCard.tsx`: bỏ thao tác "đổi phụ trách chính" và "gỡ PRIMARY"; hiện nhãn PRIMARY cố định (kèm "đã khóa" tài khoản nếu có) và "Chủ khách"; PRIMARY/Manager/Admin thấy nút **Mời thành viên** và **Gỡ** cho từng MEMBER; đếm `x/10 thành viên phụ` và vô hiệu nút khi đủ 10 (hiển thị `409 CARE_TEAM_LIMIT_EXCEEDED` nếu BE từ chối); khách `careTeam` rỗng và người dùng Admin/Manager: nút "Đặt người chăm sóc chính" (một lần) dùng `POST members` kèm `primaryUserId`.
- Bộ chọn người mời mới (`CareTeamInvitePicker`): ô tìm debounce (`useDebouncedValue` đã có) + danh sách phân trang "tên · nhóm", hook `useCareTeamInvitees(customerId, q, page)` (khóa query `['crm','care-team-invitees', customerId, q, page]`, `keepPreviousData`); chọn nhiều người trong `useState`. `assignable-users` đã **xóa hẳn** ở BE nên FE mới không được gọi nữa. Các nơi FE đang dùng và thay thế (coder `grep` `fetchAssignableUsers`, `useAssignableUsers`, `assignable`, `catalogs.users`, `roleOf`):
  - `CareTeamCard.tsx` (mời), `BulkActionBar.tsx` (thêm thành viên hàng loạt) → `useCareTeamInvitees` / endpoint `care-team-invitees` (có hoặc không `customerId`).
  - `CreateCustomerFormBody.tsx` / `useCreateCustomerForm.ts` → bỏ hẳn bộ chọn người phụ trách (6.2), không cần nguồn người.
  - `CustomerToolbar.tsx`, `AdvancedFilterModal.tsx`, `DailyTasks.desktop.tsx` (ô lọc "Người phụ trách") → `useAssigneeFilterOptions` đổi nguồn sang `customer-assignees` (6.1, 5.5a).
  - `useCatalogs` (`api/hooks.ts`): bỏ truy vấn `assignable` khỏi danh sách `required` và bỏ trường `assignable` + `users` ở giá trị trả về; `useDetailContext` đang dùng `users` để `roleOf` thành viên nhóm: đổi sang lấy vai trò từ chính `careTeam[].user` của API chi tiết (coder kiểm API đã trả `role`; nếu chưa thì thêm vào DTO `careTeam[].user` ở BE-7), không gọi danh sách người nữa; `roleOf` chịu `undefined`.
  - `catalogApi.ts`: xóa `fetchAssignableUsers`; `fetchAssigneeFilterUsers` đổi đường dẫn; mock API cung cấp dữ liệu tương ứng.
- `BulkActionBar.tsx` (Admin/Manager): "Thêm thành viên" dùng endpoint invitees không kèm `customerId`; bỏ lựa chọn đặt PRIMARY hàng loạt; hiển thị kết quả từng khách (gồm `CARE_TEAM_LIMIT_EXCEEDED`, `PRIMARY_REQUIRED`).
- Bỏ toàn bộ UI xin tham gia: `useCareTeamRequests`, `CareTeamRequestView`, các nút/hộp thoại trong `CareTeamCard`, tab/khu vực duyệt đề nghị; `lib/notifications.ts`: thông báo `CARE_TEAM_JOIN_REQUESTED` cũ vẫn **hiển thị** nhưng **không có hành động** (không link, không nút duyệt).
- Người được mời nhận `CUSTOMER_ASSIGNED` (đã có kênh, không đổi FE ngoài chữ nếu cần).

### 6.4 Chịu `phone` null ở mọi nơi (FR-04, 20)

Các điểm cần rà (null-safe, không gọi `.replace/.trim/.startsWith` trên null): `lib/phone.ts` (`formatPhoneDisplay`, `normalizePhone` nhận `null`), `lib/contact.ts`, `components/ContactActionGrid.tsx`, `TableContactActions.tsx`, `CallModal.tsx`, `ZaloModal.tsx`, `hooks/useContactActions.ts` (không có SĐT: **ẩn** nút Gọi/Zalo, không phải disable), `screens/Appointments/components/AppointmentCardDesktop/Mobile.tsx`, `screens/CreateAppointment/components/CustomerPicker.tsx`, `AppointmentFormFields.tsx`, `DailyTasks`, `CustomerDetail/components/MobileContactFooter.tsx`, `DetailParts.tsx` (`PhoneDisplay`), `api/types.ts` (`phone: string | null`, `phoneMasked: string | null`, `customerCode: string | null`), mappers `api/http/dto.ts`/`customerMappers`, lớp mock (`mockCrmApi`, `mockData`, `queries.ts`: bỏ `lookupPhone`, dữ liệu mẫu có khách không SĐT và khách trùng SĐT), `crmStorage.ts` (bản lưu cục bộ của mock: tăng phiên bản schema lưu trữ, di trú thêm `customerCode`, cho phép `phone: null`, cập nhật `crmStorageMigration/Validation` test).
Xử lý lỗi `409 CUSTOMER_PHONE_NOT_SET` ở nút xem số: hiện thông báo "Khách chưa có số điện thoại".

---

## 7. Bảo mật & Phân quyền

- **Phân quyền nhóm chăm sóc** (thay ma trận 04 mục 4.2): thêm/gỡ MEMBER: Admin, Manager (trong phạm vi khách), PRIMARY; đặt PRIMARY lần đầu cho khách `careTeam` rỗng: Admin/Manager; đổi/gỡ PRIMARY: không ai; thành viên phụ không tự rời. Quyền xem mã khách: mọi vai trò trong phạm vi xem khách (mã không nhạy cảm, **không dùng làm khóa truy cập**: mọi truy vấn vẫn qua `CustomerScope`, API theo `:id`).
- **Mở rộng phạm vi nhìn thấy (FR-15):** `teamIds` = hợp nhóm các thành viên nên Manager nhóm người được mời thấy khách; người được mời thấy toàn bộ hồ sơ và xem được SĐT với audit `PHONE_VIEWED` + cảnh báo xem bất thường giữ nguyên. Ghi vào 04 mục 7.3. Giảm thiểu: tối đa 10 MEMBER, rate-limit mời 30/phút, audit `CARE_TEAM_MEMBER_ADDED` (người mời, người được mời, khách), thông báo cho người được mời.
- **Danh sách người được mời:** chỉ `id`, `displayName`, `teamNames`; không email/SĐT/CCCD/role/id nhóm; chỉ người có quyền mời (Admin/Manager hoặc PRIMARY của khách chỉ định) gọi được; rate-limit `INVITEE_SEARCH`; phân trang ≤ 20; `q` qua `escapeRegex`, giới hạn độ dài.
- **Bỏ tra trùng SĐT** loại bỏ kênh dò "SĐT này có trong hệ thống không" qua tạo khách (409) và `phone-lookups`; quy tắc chặn dò qua tìm kiếm #37 giữ. `phone-lookups` đã xóa hẳn.
- **PII:** SĐT/CCCD vẫn che và ghi audit khi xem; log không ghi SĐT nguyên (`pii-redactor.util.ts` đã có; kiểm bổ sung với `phone: null`); mã khách không phải PII. Ẩn danh hóa: `phone: null`, giữ mã. Dọn `care_team_requests` khi xóa vĩnh viễn/ẩn danh (5.11).
- **Dump production dùng ở staging:** chứa dữ liệu cá nhân thật (Nghị định 13/2023): chỉ lưu trong `.staging/` (không commit), staging chỉ lắng nghe `127.0.0.1`, xóa dump sau diễn tập; **đã chốt** giữ nguyên dữ liệu, không làm mờ (11.1b #10).
- **Chống lạm dụng khác:** tạo khách có rate-limit chung hiện có và `X-Idempotency-Key`; không còn 409 nên không còn kênh dò trùng; JWT + Refresh Token không đổi.
- **Script/Migration:** chạy với `MONGODB_URI` từ env, không in chuỗi kết nối (dùng `sanitizeErrorMessage` có sẵn); log không chứa bí mật; migration 011 một chiều nên cần `mongodump` trước (bước 5 của deploy) và xác nhận của Oniichan (Plan, rủi ro 1).

---

## 8. Logging & Giám sát

- **Correlation ID:** `X-Request-ID` (đã có) trong log và audit; các thao tác nhóm chăm sóc/tạo khách ghi `requestId` vào audit như hiện tại. Script/migration không có request: log theo `deploy TS` trong tên tệp.
- **Audit trail:** `CUSTOMER_CREATED` có `customerCode` và người tạo = PRIMARY; `CARE_TEAM_MEMBER_ADDED/REMOVED`; `PHONE_VIEWED` (không ghi khi `phone` null); thay đổi SĐT cũ → mới trong lịch sử khách; thao tác hệ thống bù mã ghi doc `script:crm-customer-codes` và log deploy; `PRIMARY_CHANGED` không còn phát sinh mới (giữ enum cho dữ liệu cũ).
- **Log deploy** (mỗi bước một tệp, không bí mật): `deploy-catalog-codes-<TS>.log` (giữ tên), `deploy-customer-codes-<TS>.log`, `deploy-post-up-<TS>.log`. Cảnh báo đỏ khi một bước lỗi (hành vi 8c giữ).
- **Chỉ số nên theo dõi sau deploy:** (1) số khách thiếu `customerCode` (phải 0 sau bước 20; script in giá trị này); (2) số lỗi `E11000` trên `customers` trong log backend ngay sau `up` (cửa sổ trước 011); (3) tỷ lệ `409 CARE_TEAM_LIMIT_EXCEEDED` và `429` ở mời/tìm người; (4) lỗi 404 vào `/crm/care-team-requests`, `/crm/assignable-users`, `/crm/customers/phone-lookups`, `PUT .../care-team/primary` và 400 do trường `careTeam` khi tạo khách (báo hiệu máy chưa tải lại PWA, R11): theo dõi vài ngày đầu rồi nhắc người dùng liên quan.
- **Health check:** không thêm service nên không thêm endpoint health; liveness/readiness hiện có giữ.
- **Rate-limit** chỉ dùng cơ chế `CrmRateLimitService` hiện có (không thêm hạ tầng); không thêm cache.

---

## 9. Kế hoạch kiểm thử

- **Unit (coder giao ở mục 10; coder-backend/coder-frontend viết cùng code, `qa-agent` review chống tautology/thiếu ca biên):**
  - BE: `customer-code.constants` (`formatCustomerCode` 1, 999.999, 1.000.000; `parseCustomerCodeSeq` sai định dạng); `CounterService.next` (đếm theo lô, dùng session); `CustomersService.create` (phone null/rỗng/có; Admin/Manager/Staff đều PRIMARY; không còn nhánh trùng); `buildSearchText`/`parseKeyword` (mã `kh-12`, `KH000123`, số thuần vẫn là SĐT, từ khóa rỗng/tên); `toPhoneMasked`/mapper null; `CustomerPhoneService.view` (null → `CUSTOMER_PHONE_NOT_SET`, không audit/rate-limit); anonymize đặt `phone: null` giữ mã; `care-team.rules` (`planRemoveMember` PRIMARY → `PRIMARY_LOCKED`, `planAddMembers` đặt PRIMARY lần đầu, MEMBER không PRIMARY, giới hạn 10 và khách cũ >10); `assertAssignable` (ACTIVE, role, **không** kiểm nhóm, người BLOCKED/Admin-only bị từ chối); `CareTeamInviteesService` (loại người đã trong nhóm, chính mình, BLOCKED, không lộ trường; phân trang; `escapeRegex`); `CustomerAssigneesService` (tập người theo `buildCustomerScope` của từng vai trò, bỏ khách xóa mềm, gồm người BLOCKED kèm `isLocked`, loại user đã xóa mềm, lọc `q`/`teamId`, phân trang, không lộ email); `CreateCustomerDto` từ chối trường `careTeam` (400 do `forbidNonWhitelisted`); bulk `ASSIGN` (từ chối `primaryUserId`, khách rỗng → `PRIMARY_REQUIRED`, giới hạn 10); `daily-tasks` ba nguồn theo `careTeam`; runner (`phase` lọc, từ chối hai chiều: post-up chờ nhỏ hơn pre-up chờ và ngược lại, `all` đúng thứ tự, idempotent); `migration.registry.spec` (liền số 007..011, id 011 `post-up`); migration 010/011 (idempotent, index conflict báo lỗi rõ, bước `anonymized:` sau `dropIndex`); CLI `crm-customer-codes` (cổng sổ thoát 0, lô, thứ tự `createdAt,_id`, gồm khách xóa mềm, chạy lại không đổi mã, `$max` counter, dry-run không ghi, lỗi giữa lô nối lại được); test "index trong schema khớp hằng số migration" (không `IndexOptionsConflict`).
  - FE: `CustomerCodeBadge`; `CustomerTableRow`/`CustomerCard` (mã cạnh SĐT; không SĐT chỉ mã; Staff không có cột/ lọc chính; Admin/Manager có và nhãn "đã khóa"); `CustomerHeader`/`MobileDetailHeader` (mã ở mọi vai trò); form tạo (SĐT tùy chọn, không banner, dòng PRIMARY tự động, Admin); `CareTeamCard` (không đổi/gỡ chính, giới hạn 10, mời); `CareTeamInvitePicker`/hook invitees; `useAssigneeFilterOptions` gọi nguồn mới; `useCatalogs` không còn `assignable`/`users` và `useDetailContext`/`roleOf` chịu `undefined`; `lib/phone.ts` và các điểm null-safe ở 6.4; `useContactActions` ẩn nút khi null; `crmStorage` di trú; thông báo `CARE_TEAM_JOIN_REQUESTED` cũ không có hành động.
  - Shell: cập nhật `scripts/tests/deploy-catalog-codes.test.sh` (trích `run_post_migrate_steps` từ `deploy.sh` và chạy **tệp thật** `scripts/post-migrate/10-catalog-codes.sh` với `docker` giả) giữ nguyên mọi ca cũ: sau `up` + liveness, đúng một lần gọi, đối số `--apply`, log `deploy-catalog-codes-<TS>.log` cả khi thành/bại, cảnh báo đỏ + exit khác 0, bỏ qua khi downgrade, thứ tự sau `reconcile` ở cài mới, không chạy khi reconcile lỗi; thêm `scripts/tests/deploy-post-migrate.test.sh` (hoặc mở rộng): thứ tự 10 → 20 → 90, bước lỗi dừng các bước sau, mỗi bước đúng đối số/log, `deploy.sh` **không chứa** chuỗi `catalog-codes`/`customer-codes`/`run_catalog_codes_cli` ngoài điểm gọi chung, 6b/8a/8b truyền `--phase pre-up`.
- **Integration / E2E (`qa-agent`):**
  - Viết lại test BE integration M1–M5, `crm-customer-deletion`, `crm-m*-qa`, `crm-team-members`, `crm-multi-role-team`, `crm-bulk-assign-push`, `crm-m1-fr40-customer-codes` theo quy tắc mới: tạo khách không SĐT; hai khách cùng SĐT; **N khách tạo đồng thời không trùng mã** và xóa rồi tạo không dùng lại mã; Staff/Manager/Admin tạo = PRIMARY; xóa vĩnh viễn rồi tạo không tái sử dụng mã; gỡ PRIMARY 409 `PRIMARY_LOCKED`; **các route đã xóa trả 404** (`POST phone-lookups`, `PUT .../care-team/primary`, `GET assignable-users`, 3 route `care-team-requests`) và `POST customers` có trường `careTeam` trả 400; `GET customer-assignees` theo vai trò (Admin thấy mọi người trong `careTeam` của khách còn sống, Manager/Staff theo phạm vi, người BLOCKED có `isLocked`, khách xóa mềm bị loại); `role-coverage.audit.spec.ts` và 4 spec integration đang tham chiếu `assignable-users` cập nhật theo endpoint mới/xóa; bulk ASSIGN; mời người ngoài nhóm (Staff PRIMARY → Staff nhóm khác thành công); BLOCKED/Admin-only bị từ chối; quá 10 MEMBER; Manager nhóm người được mời thấy khách; thông báo `CUSTOMER_ASSIGNED` không gửi cho BLOCKED; việc hằng ngày hiển thị cho MEMBER khi PRIMARY BLOCKED/null; `phone-views` null; ẩn danh hóa → `phone: null`; tìm theo mã; Swagger/OpenAPI không còn `phone-lookups`, `PUT primary`, `assignable-users`, 3 endpoint `care-team-requests`.
  - **Chuỗi migration** trên Mongo replica set thật: 007 → 010 → 011 trên DB mẫu có khách (có xóa mềm, `anonymized:`), chạy lại không đổi; 010 khi image cũ ghi chen (chèn khách thiếu mã): không lỗi; bước 20 sau đó bù đủ; chạy bước 20 khi sổ chưa có 010 thoát 0 không làm gì; mô phỏng `up` lỗi rồi chạy lại.
  - **Staging** (5.10) bằng bản sao dump production: toàn bộ kịch bản 1–6, kèm đo thời gian và báo cáo cho Oniichan trước khi lên production.
  - **E2E UI** (Playwright sẵn có `RealEstateAdminApp/e2e/specs`, theo mục tiêu "kiểm thiếu chức năng, mất ngữ cảnh, điều hướng sau lưu"): tạo khách không SĐT (desktop và mobile); danh sách hiện mã cạnh SĐT; chi tiết hiện mã; Admin/Manager có cột và lọc người chăm sóc chính, Staff không; khách PRIMARY bị khóa hiện nhãn; mời người nhóm khác; không còn nút đổi/gỡ chính, không còn xin tham gia; ô lọc "Người phụ trách" nạp từ `customer-assignees` (gồm người bị khóa); không màn nào gọi endpoint đã xóa (kiểm bằng bắt request mạng: không có `phone-lookups`, `assignable-users`, `care-team-requests`).
- **Coverage:** sau khi coder xong, `qa-agent` audit coverage chuẩn Enterprise, lập danh sách code cũ thiếu unit test giao coder viết (FR-22).

---

## 10. Phân việc cho coder agent

> `T-xx` do `/spec-tasks` đặt sau; bảng dưới là nhóm việc cấp kiến trúc. Mọi coder viết **unit test cùng code**; `qa-agent` review code + test sau mỗi lượt. Thứ tự giai đoạn bám Plan mục 4.

| Task | Agent | Phụ thuộc | FR |
|---|---|---|---|
| BE-1: `customer-code.constants`, module `shared/counters` (schema `Counter`, `CounterService.next`), thêm `customerCode` vào `customer.schema.ts` (+index partial dùng `CUSTOMER_CODE_INDEX`), `phone` nullable, bỏ index unique `phone` khỏi schema, đổi chú thích quyết định #2 | coder-backend-agent | – | FR-01, 02, 07 |
| BE-2: migration 010 + 011 (`versions/`), thuộc tính `phase` ở `migration.types`, lọc theo pha và `--phase` ở runner/`cli-app`, quy tắc từ chối hai chiều (pre-up khi post-up nhỏ hơn còn chờ, và ngược lại), đăng ký registry, cập nhật `migration.registry.spec`, spec runner/reconcile/integration | coder-backend-agent | BE-1 | FR-06, 21 |
| BE-3: CLI `crm-customer-codes.cli.ts` + `crm-customer-codes-app.ts` + test (kể cả chạy lại sau khi `up` lỗi, cổng sổ) | coder-backend-agent | BE-1, BE-2 | FR-08, 21 |
| BE-4: tạo/sửa khách: người tạo PRIMARY (kể cả Admin), cấp mã trong transaction, bỏ trùng SĐT và `buildDuplicateError`, **xóa trường `careTeam` khỏi `CreateCustomerDto`**, **xóa hẳn route/controller `phone-lookups`**, `searchText`/`customer-audit.util`/mapper/`phoneMasked` null, anonymize `phone: null`, `phone-views` null, bỏ `CUSTOMER_PHONE_DUPLICATED` | coder-backend-agent | BE-1 | FR-01, 02, 03, 04, 06, 07, 10, 20 |
| BE-5: nhóm chăm sóc: `PRIMARY_LOCKED` (gỡ PRIMARY), **xóa hẳn route `PUT primary`** (controller/DTO/service) + `permissions.canChangePrimary` + tham số `newPrimaryUserId` của `DELETE member`, bulk `ASSIGN` chỉ MEMBER, bỏ giới hạn nhóm ở `assertAssignable`, giới hạn 10 + `CARE_TEAM_INVITE` rate-limit, bỏ luồng X2 (controller/service/DTO/mã lỗi/rate-limit/thông báo gửi mới), giữ enum cũ, lọc BLOCKED ở thông báo/push, dọn `care_team_requests` ở purge/anonymize | coder-backend-agent | BE-4 | FR-11, 12, 13, 16, 17, 18 |
| BE-6: `GET /crm/care-team-invitees` (service, controller, DTO, rate-limit `INVITEE_SEARCH`); `GET /crm/customer-assignees` (`CustomerAssigneesService`, controller, DTO, 5.5a); **xóa hẳn module `assignable-users`** (module/controller/service/DTO/spec, đăng ký trong `CrmModule`, Swagger) và cập nhật `role-coverage.audit.spec.ts` cùng 4 spec integration đang tham chiếu; `UserRefDto.isLocked`; nếu chi tiết khách chưa trả vai trò ở `careTeam[].user` thì thêm (cho `roleOf` ở FE) | coder-backend-agent | BE-5 | FR-09, 14, 18, 20 |
| BE-7: danh sách/chi tiết/deleted trả `customerCode` cho mọi vai trò, tìm theo mã (`parseKeyword` loại `code`), `primaryAssignee.isLocked`, `permissions.canSetInitialPrimary` | coder-backend-agent | BE-1, BE-4 | FR-09 |
| BE-8: `daily-tasks`/appointments/reminders: "của tôi" theo mọi thành viên `careTeam`, `phone` null ở mapper và truy vấn, nhắc bỏ BLOCKED, rà `teamIds` rỗng | coder-backend-agent | BE-4, BE-5 | FR-04, 18, 19 |
| OPS-1: tách 8c: `scripts/post-migrate/10-catalog-codes.sh` (hành vi giữ nguyên), `20-customer-codes.sh`, `90-post-up-migrations.sh`; `deploy.sh`: bỏ `run_catalog_codes_cli`/`apply_catalog_codes`/khối 8c, thêm `run_post_migrate_steps` (bỏ qua khi downgrade), truyền `--phase pre-up` ở 6b/8a/8b, cập nhật mô tả đầu/`usage`/`print_recovery`; cập nhật `deploy-catalog-codes.test.sh`, thêm test điểm gọi chung | devops-agent | BE-2, BE-3 | FR-21, 23 |
| OPS-2: `scripts/staging.sh restore-dump` + test `staging.test.sh`; viết quy trình diễn tập 5.10; chạy diễn tập với bản sao dump production (Oniichan cung cấp bản sao; đã chốt giữ nguyên, lưu cục bộ trong `.staging/`, xóa sau diễn tập, 11.1b #10) | devops-agent | OPS-1, BE-1..BE-8 | FR-21 |
| OPS-3: cập nhật `docs/01_Infrastructure/06_Production_Deploy.md` mục 11 (điểm gọi hậu-migrate, ba script, `--phase`, dùng dump ở staging) và `print_recovery` của `deploy.sh`: **hướng dẫn lùi** (trước bước 90 lùi được image v1.0.3; **sau bước 90 chỉ sửa tiến, không lùi image v1.0.3**, cách kiểm 011 đã chạy; chấp nhận cửa sổ `E11000` giữa `up` và bước 90); **mục "Sau deploy v1.0.5"**: thông báo người dùng **tải lại trang/PWA** vì endpoint cũ đã xóa (`phone-lookups`, `PUT primary`, `assignable-users`, `care-team-requests`, trường `careTeam`), theo dõi 404/400 vài ngày đầu | devops-agent | OPS-1 | FR-20, 21, 23 |
| FE-1: lớp API/hook/kiểu (`phone`/`phoneMasked`/`customerCode` null, `isLocked`, hook `useCareTeamInvitees`; bỏ `usePhoneLookup`/`useCareTeamRequests`/`useAssignableUsers`/`fetchAssignableUsers`; `useCatalogs` bỏ `assignable` + `users`; `useAssigneeFilterOptions` đổi sang `customer-assignees`; `roleOf` chịu `undefined`; không gửi `careTeam` khi tạo khách), mock API + `crmStorage` di trú, `lib/phone.ts`/`contact.ts` null-safe — **cả** `RealEstateAdminApp` và `stnd-crm-unified` | coder-frontend-agent | hợp đồng API mục 4 (BE-4..BE-7) | FR-02, 03, 04, 14, 20 |
| FE-2: form Thêm/Sửa khách (SĐT tùy chọn, bỏ banner, dòng PRIMARY tự động, Admin) | coder-frontend-agent | FE-1 | FR-02, 03, 10 |
| FE-3: `CustomerCodeBadge`; danh sách bảng + thẻ mobile + chi tiết desktop/mobile + khách đã xóa hiện mã; tìm theo mã; cột Người chăm sóc chính + nhãn "đã khóa" + bộ lọc chỉ Admin/Manager | coder-frontend-agent | FE-1 | FR-09 |
| FE-4: `CareTeamCard` (khóa PRIMARY, đặt lần đầu, giới hạn 10), `CareTeamInvitePicker`, `BulkActionBar`, bỏ UI xin tham gia và hành động thông báo cũ | coder-frontend-agent | FE-1 | FR-11, 12, 13, 14, 16, 17 |
| FE-5: lịch hẹn/việc hằng ngày/`CustomerPicker`/`ContactActionGrid`/modal Gọi-Zalo chịu khách không SĐT | coder-frontend-agent | FE-1 | FR-04, 20 |
| QA-1: review code + unit test từng lượt; viết lại test integration BE (M1–M5, deletion, qa, team-members, multi-role, bulk-assign-push, fr40-customer-codes), test chuỗi migration, E2E UI | qa-agent | BE-*, FE-* | FR-22 |
| QA-2: nghiệm thu diễn tập staging (5.10) và báo cáo; audit coverage Enterprise, lập danh sách code cũ thiếu unit test giao coder | qa-agent | OPS-2, QA-1 | FR-21, 22 |
| DOC-1: cập nhật 04 (3.2, 4.2, 6.1, 7.3, 11: ghi "thay thế quy tắc X của vA.B.C"), 05 (số endpoint; mã lỗi; **xóa** mục `phone-lookups`, `care-team-requests`, `assignable-users`, `primary`; thêm `care-team-invitees`, `customer-assignees`), 06, 09 (mục v1.0.5), và ghi chú **"máy còn PWA cũ phải tải lại sau deploy v1.0.5"** (kèm danh sách endpoint đã xóa) ở 09 và 05 | coder-backend-agent | BE-* chốt | FR-22 |

### 10.1 Thứ tự và phụ thuộc

1. **Nền BE (MVP-1):** BE-1 → BE-2 → BE-3 và BE-4 (song song BE-2/BE-3 sau BE-1).
2. **BE bỏ luồng cũ + mời (MVP-2):** BE-5 → BE-6, BE-7, BE-8.
3. **FE (MVP-3):** FE-1 sau khi hợp đồng mục 4 chốt (có thể bắt đầu với mock trước); FE-2..FE-5 song song.
4. **Enhancement / hardening:** OPS-1 (sau BE-2/BE-3) → OPS-2 → QA-2; QA-1 xuyên suốt; OPS-3, DOC-1 cuối.
5. Migration 011 được đưa lên production **sau cùng** và cần Oniichan xác nhận một chiều (Plan, rủi ro 1).

### 10.2 Phủ FR

| FR | Nơi đáp ứng | FR | Nơi đáp ứng |
|---|---|---|---|
| FR-01 | 3 (`phone`), 3.1 (011), 4 (POST/PATCH), 5.2, BE-1/4 | FR-13 | 4 (members, bulk), 5.4, 7, BE-5, FE-4 |
| FR-02 | 3, 4, 5.2, 6.2, BE-4, FE-2 | FR-14 | 4 (invitees), 5.5, 6.3, BE-6, FE-1/4 |
| FR-03 | 4 (`phone-lookups` xóa hẳn), 6.2, BE-4, FE-2 | FR-15 | 3 (`teamIds`), 7, 11.1b #6, DOC-1 |
| FR-04 | 4 (`phone-views`, list), 5.2, 6.4, BE-4/8, FE-5 | FR-16 | 4 (members), 5.4, BE-5 |
| FR-05 | bỏ khỏi phạm vi (Oniichan: nhập/xuất khách chỉ là mock, không sửa) | FR-17 | 4, 5.4, 6.3, BE-5, FE-4 |
| FR-06 | 3, 3.1 (011), 5.2, BE-2/4 | FR-18 | 5.4, 5.6, 6.1, BE-5/8 |
| FR-07 | 3, 3.2, 5.1, BE-1/4 | FR-19 | 5.6, BE-8 |
| FR-08 | 3.1 (010), 5.8, BE-3 | FR-20 | 4 (các route đã xóa), 6.4, BE-4/5/6, FE-1/5, OPS-3, DOC-1, 11.1b #5, R11 |
| FR-09 | 4 (list/detail/deleted/`customer-assignees`), 5.3, 5.5a, 6.1, BE-6/7, FE-3 | FR-21 | 1.2, 3.1, 5.7, 5.8, 5.9, 5.10, BE-2/3, OPS-1/2 |
| FR-10 | 4 (POST), 5.2, 6.2, BE-4, FE-2 | FR-22 | 9, 10 (QA-1/2, DOC-1) |
| FR-11 | 4 (`PUT primary` xóa hẳn, members, bulk), 5.4, 6.3, BE-5, FE-4 | FR-23 | 1.2, 5.9, OPS-1/3, 9 (shell) |
| FR-12 | 4 (care-team-requests xóa hẳn), 5.4, 5.11, 6.3, BE-5, FE-4, 11.1b #1 | | |

---

## 11. Rủi ro & Câu hỏi mở

> Toàn bộ câu hỏi mở đã được Oniichan chốt (11.1b). Mục 11.1a ghi các mâu thuẫn phát sinh khi bỏ phần chuyển tiếp, đều đã được Neptune xử lý.

### 11.1 Câu hỏi mở

**Không còn câu hỏi mở.** Oniichan đã chốt toàn bộ; xem bảng 11.1b. Mọi chỗ trong tài liệu từng tham chiếu "mục 11 #1/#3/#4/#5" nay trỏ về bảng 11.1b.

### 11.1a Mâu thuẫn phát sinh khi bỏ hết phần chuyển tiếp (cả 4 mục: Đã xử lý, Neptune)

1. **Đã xử lý (Neptune)** — Plan còn câu chữ cũ về bản chuyển tiếp: FR-20, dòng MVP-2, rủi ro 2, tiêu chí nghiệm thu và mục 8 đã được Neptune sửa trong Plan cho khớp quyết định "bỏ hết ngay, máy còn PWA cũ phải tải lại".
2. **Đã xử lý (Neptune)** — Không thể bỏ `assignable-users` mà không có nơi thay thế:** FE mới còn dùng endpoint này ở **ô lọc người chăm sóc** (`purpose=filter`: `CustomerToolbar`, `AdvancedFilterModal`, `DailyTasks` qua `useAssigneeFilterOptions`) và ở `useCatalogs().users` (tra vai trò thành viên khi dựng chi tiết khách). Kiến trúc thay bằng: (a) `GET /api/v1/crm/care-team-invitees` cho **mọi thao tác mời/gán** (`CareTeamCard`, `BulkActionBar`, bỏ `CreateCustomerFormBody`); (b) endpoint mới `GET /api/v1/crm/customer-assignees` cho **ô lọc** (4, 5.3, 5.5a, 6.1, 6.3). Đây là việc thêm một endpoint ngoài Plan (không đổi FR, không đổi phạm vi chức năng); Neptune đã chấp nhận như quyết định kỹ thuật không đổi FR và ghi vào mục 8 của Plan. Hệ quả hành vi: ô lọc của Nhân viên đổi nguồn từ "người cùng nhóm" sang "người xuất hiện trong nhóm chăm sóc của khách mình thấy" (đồng bộ với Quản lý/Quản trị và cho phép Admin làm PRIMARY xuất hiện trong lọc).
3. **Đã xử lý (Neptune)** — Test hiện có tham chiếu `assignable-users`: `role-coverage.audit.spec.ts` và 4 test integration; hệ quả đã biết, coder cập nhật/xóa theo endpoint mới (đã ghi ở BE-6/QA-1).
4. **Đã xử lý (Neptune)** — Bỏ trường `careTeam` khỏi DTO tạo khách và `newPrimaryUserId` khỏi DELETE member: `forbidNonWhitelisted` làm bản PWA cũ nhận 400 khi tạo khách (và 404 ở các route đã bỏ); hệ quả đã biết của quyết định "tải lại sau deploy" (đã ghi vào hướng dẫn deploy, OPS-3).

### 11.1b Đã chốt và thông tin (không còn là câu hỏi)

| # | Nội dung | Trạng thái |
|---|---|---|
| 1 | FR-12 so với dọn dữ liệu khi xóa vĩnh viễn/ẩn danh: **giữ** file schema `care_team_requests` và việc dọn dẹp ở `customer-purge.service.ts`, `customer-care-anonymizer.service.ts` (chỉ hai service này còn inject model); **không xóa collection, không xóa dữ liệu**; mọi code khác dùng collection bị bỏ (5.4, 5.11). | **Đã chốt** (theo đề xuất) |
| 3 | Cơ chế bỏ unique `phone` sau khi backend sống: **phương án A** — migration 011 trong registry với `phase: 'post-up'` + cờ `--phase`, đánh số cuối cùng, một chiều (3.1, 5.7, 5.9). | **Đã chốt** |
| 4 | Cửa sổ giữa `up` và bước 90 (`phone_1` vẫn unique, có thể `E11000` khi tạo khách trùng/không SĐT thứ hai): **chấp nhận**, giữ thứ tự 10 → 20 → 90, deploy ngoài giờ cao điểm. Sau bước 90 (011 đã chạy) **chỉ sửa tiến, không lùi image v1.0.3** (mapper v1.0.3 giả định `phone` là chuỗi). Phải ghi vào `print_recovery` của `deploy.sh` và `06_Production_Deploy.md` mục 11 (5.9, OPS-1, OPS-3). | **Đã chốt** |
| 5 | Tương thích PWA bản cũ: **bỏ hết ngay trong v1.0.5, không giữ bản chuyển tiếp.** Xóa hẳn `POST phone-lookups`, `PUT care-team/primary`, `assignable-users`, trường `careTeam` ở DTO tạo khách, 3 endpoint `care-team-requests`. Máy còn PWA cũ phải **tải lại trang** sau deploy; ghi vào `06_Production_Deploy.md` và task docs (OPS-3, DOC-1). Không còn mục xóa ở v1.0.6. FE vẫn chịu `phone` null (FR-20 còn lại). | **Đã chốt** (xem 11.1a về hệ quả) |
| 2 | FR-08 ("bù mã trước khi tạo unique index") khác thứ tự với FR-21 (index partial ở migration trước `up`, bù mã sau `up`). Thiết kế theo FR-21 vì index partial chỉ tính khi mã là chuỗi nên không có gì để vi phạm. | **Đã chốt:** Neptune sửa câu chữ FR-08 trong Plan; kiến trúc không đổi |
| 7 | Cú pháp tìm theo mã: phải gõ tiền tố `KH` (`KH-000123`, `kh123`); từ khóa toàn số vẫn là SĐT để giữ quy tắc chặn dò số #37. | **Đã chốt** |
| 10 | Dump production để diễn tập staging: giữ nguyên dữ liệu, chỉ lưu cục bộ trong `.staging/` (không commit), xóa sau diễn tập. Oniichan cung cấp bản sao khi tới OPS-2. | **Đã chốt** |
| 6 | Admin thuần làm PRIMARY thì `teamIds = []`: khách chỉ Admin (và người được mời sau này) thấy; Manager không thấy cho đến khi có thành viên có nhóm. Đã chốt ở Plan mục 8; QA cần kiểm thử. | Thông tin, Oniichan đã đồng ý |
| 9 | Thứ tự mã cho khách tạo trong khoảng trống (v1.0.3 tạo giữa 6b và `up`; backend mới tạo trong vài giây trước script): mã không đúng tuyệt đối theo `createdAt`. Không chặn; ghi vào tài liệu 09. | Thông tin, Oniichan đã đồng ý |
| FR-05 | Nhập/xuất khách: **bỏ khỏi phạm vi** (chỉ là mock, không sửa gì). | **Đã chốt** |

### 11.2 Rủi ro kỹ thuật và hướng xử lý

| # | Rủi ro | Xử lý | FR |
|---|---|---|---|
| R1 | Mongoose autoIndex đụng `phone_1` unique còn tồn tại trước 011 (`IndexOptionsConflict`) | Không khai báo index `phone` trong schema, 011 sở hữu; index `customerCode` dùng chung hằng số với migration; test khớp | FR-21 |
| R2 | Điểm tranh chấp counter khi tạo đồng thời | `$inc` ở cuối transaction, `withTransaction` tự retry; test đồng thời | FR-07 |
| R3 | `teamIds` rỗng (Admin PRIMARY) làm hỏng giả định nơi khác | `grep` và test list/scope/thông báo | FR-10 |
| R4 | Giới hạn 10 MEMBER bị vượt khi hai lần thêm đồng thời | Kiểm trong transaction cùng việc đọc `careTeam`, test đồng thời | FR-17 |
| R5 | Tách 8c làm hỏng hành vi đã QA của v1.0.4 | Chuyển nguyên hành vi, test shell cũ giữ mọi ca, chạy lại cả hai script ở staging | FR-23 |
| R6 | Bước 20 bù mã lâu (sắp `createdAt` không có index) | Hàng nghìn khách vài giây; theo dõi thời gian ở staging, tối ưu cắt lô theo `_id` đã sắp nếu cần | FR-08 |
| R7 | Người dùng thường xuyên gõ số trần để tìm mã sẽ không ra | Placeholder hướng dẫn; đã chốt (11.1b #7) | FR-09 |
| R8 | Hộp thông báo cũ trỏ tới luồng không còn | Hiển thị không hành động, không xóa dữ liệu | FR-12 |
| R11 | Máy còn PWA bản cũ gọi endpoint đã xóa (`phone-lookups`, `care-team-requests`, `assignable-users`, `PUT primary`) hoặc gửi `careTeam` khi tạo khách → 404/400, màn Thêm khách/danh sách người phụ trách lỗi hoặc trắng | Quyết định đã chốt: máy phải tải lại sau deploy. Ghi vào `06_Production_Deploy.md` (thông báo người dùng trước/sau deploy, hướng dẫn tải lại cứng) và task docs; theo dõi 404/400 từ các route này trong log vài ngày đầu | FR-20 |
| R9 | `crmStorage` mock đổi cấu trúc làm mất dữ liệu cục bộ của dev | Tăng phiên bản lưu trữ và di trú, test `crmStorageMigration` | FR-04 |
| R10 | Mã khách chưa hiển thị cho khách tạo trong khoảng trống tới khi script chạy | `customerCode: string \| null`, `CustomerCodeBadge` không render khi null; khoảng chỉ vài giây | FR-08, 09 |

### 11.3 Đề xuất ngoài FR (không thực hiện nếu Oniichan không duyệt)

- Hiện mã khách trong thẻ lịch hẹn/việc hằng ngày để phân biệt khách trùng tên khi không có SĐT (hiện Plan chỉ yêu cầu danh sách và chi tiết).
- Nút sao chép mã khách ở màn chi tiết.
