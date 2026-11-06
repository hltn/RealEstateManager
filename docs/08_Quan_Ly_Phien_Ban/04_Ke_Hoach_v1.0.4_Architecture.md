# Phiên bản v1.0.4 (Web Push VAPID cho PWA, backlog QA M0–M6, lỗi mới) — Architecture Design

> **Phiên bản tài liệu:** v1.0.4

> Ngày tạo: 2026-11-04
> Author: architect-agent
> Trạng thái: Approved
> Dựa trên: `08_Quan_Ly_Phien_Ban/03_Ke_Hoach_v1.0.4.md` (Plan, Approved 2026-11-04, 36 yêu cầu hiệu lực), audit codebase (`RealEstateBackendApp`, `RealEstateAdminApp`, ngày 2026-11-04), skill `nodejs-react-mongo-coding-guidelines`

> **Bảo mật:** tài liệu này chỉ ghi **tên biến**, không ghi giá trị bí mật (khóa riêng VAPID, token, mật khẩu).
>
> **Quy ước:** cột `FR` ở mọi bảng ghi mã `FR-xx` của Plan mà dòng đó đáp ứng. Tài liệu chỉ thiết kế, không chứa code triển khai; coder agent làm theo mục 10. Quyết định nào lệch với Plan hoặc code thật được gom ở mục 11 (đánh số `Q1`…) để Oniichan quyết; phần thiết kế đã chọn **phương án mặc định an toàn nhất** để coder không bị chặn.

---

## 1. Tổng quan kiến trúc

### 1.1 Quyết định cốt lõi

| # | Quyết định | Lý do ngắn | FR |
|---|---|---|---|
| D1 | **A0 (làm trước): đổi tham chiếu danh mục sang `code` theo kiểu mở rộng–chuyển–thu hẹp (expand/migrate/contract), "ghi kép"**: trường `…Code` mới là nguồn đọc chính, trường ObjectId cũ vẫn được ghi song song và KHÔNG xóa ở v1.0.4. Migration `007` điền `code` cho dữ liệu cũ, idempotent, có chế độ dry-run | Skill cấm sửa/xóa field đột ngột (Zero-Downtime Schema); đường lùi = chạy lại image cũ vẫn đọc đúng; `deploy.sh` chạy migration TRƯỚC `up` khi image cũ còn phục vụ nên phải tương thích hai chiều | FR-40, FR-46 |
| D2 | **Push là kênh bổ sung của hộp thông báo, đi theo mô hình outbox**: `NotificationDispatcher` (điểm vào duy nhất) ghi thông báo với `pushStatus = PENDING` TRONG transaction nghiệp vụ; job BullMQ `push.send` được xếp hàng SAU commit (hook `afterCommit`) và có job quét `push.sweep` làm lưới an toàn nếu Redis lỗi/instance chết giữa chừng | Không gửi push cho transaction rollback, không mất push khi Redis lỗi, nghiệp vụ không bao giờ bị chặn bởi push | FR-03, FR-44 |
| D3 | **Không gửi trùng** bằng 3 lớp: `jobId = push-{notificationId}` (BullMQ không cho dấu `:`; hàm dùng chung `pushSendJobId`); collection `push_deliveries` unique (notificationId, subscriptionId) quyết định ai đã gửi xong; `Topic` (Web Push) và `tag` (service worker) theo id thông báo để nếu vẫn lặp thì thay thế nhau chứ không hiện hai lần | Retry/restart/hai instance an toàn (at-least-once + dedupe) | FR-03, FR-12 |
| D4 | **Danh mục push (FR-43) là hằng số cấu hình trong code** (`push-catalog.ts`), đúng 4 loại, có điều kiện gửi cho `CUSTOMER_ASSIGNED`; trang Cài đặt thông báo đọc danh sách loại từ API (không hard-code ở FE) | Thêm loại = thêm một dòng, không sửa bộ gửi | FR-43, FR-10 |
| D5 | **Web Push chuẩn bằng thư viện `web-push`** (VAPID, mã hóa payload `aes128gcm`, timeout 5 giây); `WebPushProvider` thay `NoopPushProvider` khi `FEATURE_CRM_PUSH` bật VÀ đủ biến VAPID; thiếu biến thì quay về Noop + log lỗi (không sập app, readiness không đổi) | Quay lui nhanh bằng đổi biến môi trường; khớp skill (timeout, retry + jitter) | FR-02, FR-07 |
| D6 | **SSRF**: endpoint do client gửi lên chỉ nhận `https` và host thuộc danh sách cho phép của dịch vụ push (Google, Mozilla, Apple, Microsoft) | Server sẽ tự `POST` tới URL này; không có allowlist là lỗ hổng SSRF | FR-01, FR-02 |
| D7 | **Một service worker duy nhất** `src/pwa/sw.ts` (đã có `tsconfig.sw.json`) thêm `push` và `notificationclick`; **luôn** gọi `showNotification` cho mọi push (iOS Safari thu hồi subscription nếu push "im lặng") | Ràng buộc nền tảng iOS 16.4+ | FR-09 |
| D8 | **Sửa lỗi FR-14**: lớp chặn toán tử `$` ở tầng chung bằng **interceptor toàn cục** (chạy trước `ValidationPipe`, test được bằng module Nest), KHÔNG bật `sanitizeFilter` toàn cục của Mongoose vì sẽ phá mọi truy vấn nội bộ dùng `$in`/`$ne` | Tránh hồi quy diện rộng | FR-14 |
| D9 | **FR-26 thumbnail**: thư viện `sharp`, xử lý **bất đồng bộ qua BullMQ** (skill: xử lý ảnh phải tách khỏi luồng chính); upload vẫn trả ngay `READY`, `thumbKey` điền sau; `thumbUrl` rơi về `url` khi chưa có thumbnail (tương thích dữ liệu cũ) | Không làm chậm upload, không đổi hợp đồng API | FR-26 |
| D10 | **FR-15 che PII ở đúng một cửa**: hàm `redactPii()` áp dụng trong `CustomLogger` (message VÀ các tham số phụ như stack) và trong `winston.config.ts` | `CustomLogger` là nơi duy nhất mọi log đi qua (console + file) | FR-15 |

### 1.2 Sơ đồ luồng push (B + C)

```text
[Service nghiệp vụ CRM]  --(1) dispatch(requests, session)-->  NotificationDispatcher            (FR-44)
   (phân khách, nhật ký, lịch hẹn,                                |  - tra PUSH_CATALOG (4 loại) + điều kiện   (FR-43)
    tự đổi tình trạng, quét khách...)                             |  - dựng title/body push theo mẫu, quét PII  (FR-06)
                                                                  |  - ghi `notifications` (dedupeKey, upsert)
                                                                  |    pushStatus = PENDING | SKIPPED            (FR-03)
                                                                  |  - registerAfterCommit(session, enqueue)
                                                                  v
              transaction COMMIT  --(2) afterCommit-->  Queue `push` : job push.send {notificationId}, jobId = push-{id}
                                                                  |                      ^
                          Redis lỗi / chết giữa chừng             |                      | (4) push.sweep mỗi 60 giây:
                          (job không được xếp hàng)  ------------>+ PENDING quá 30 giây -> xếp hàng lại (cùng jobId)
                                                                  v
        Worker `push.send` (FEATURE_CRM_PUSH + QUEUE_WORKERS_ENABLED)                                          (FR-03, FR-04)
          a. người nhận còn ACTIVE? cài đặt `types[type].push`? giờ yên lặng (VN)?  -> không thì SKIPPED
          b. đọc `push_subscriptions` còn hiệu lực của người nhận (tối đa 3)
          c. mỗi subscription: claim `push_deliveries` (unique) -> WebPushProvider.send (timeout 5 giây)
             201 => SENT | 404/410 => thu hồi subscription, không retry | 429/5xx/timeout => ném lỗi để BullMQ retry
          d. retry tối đa 5 lần, backoff mũ + jitter (QueueRuntimeService) -> hết lần: pushStatus = FAILED
          e. >= 1 subscription SENT => pushStatus = SENT
                                                                  |
                                                                  v   Apple / Google / Mozilla push service
                                      Service worker (sw.ts): `push` -> showNotification(tag = id) ; `notificationclick` -> mở deepLink  (FR-09)
```

### 1.3 Thứ tự làm (bám Plan mục 4.1; chi tiết ở mục 10)

`A0 (thiết kế đã xong ở tài liệu này, BE+FE+migration bắt đầu ngay)` ∥ `A (FR-14, 15, 16)` → `B (FR-43, 44, 01..07, 05, 12)` → `C (FR-08, 09, 10, 13, bật cờ)`; `D`, `E` làm xen kẽ, không chặn phát hành. **Mốc phát hành chờ A0 (FR-40, FR-46) và FR-41 (E-6) đủ hai đợt; chỉ FR-42 (E-4) không chặn (xem 10.1).**

## 2. Hiện trạng codebase

> Đã đối chiếu code thật ngày 2026-11-04 (BE: `RealEstateBackendApp/src`; FE: `RealEstateAdminApp/src`).

| Thành phần | Trạng thái | Ghi chú | FR |
|---|---|---|---|
| `modules/notifications` (hộp thông báo, `notification_preferences`, `PushProvider` + `NoopPushProvider`, `PUSH_PROVIDER`) | ✅ ĐÃ CÓ | `NotificationsService.createMany(items, session?)` ghi thông báo bằng `bulkWrite` (upsert theo `(userId, dedupeKey)` khi có khóa); `pushStatus` lấy từ `PushProvider.initialStatus()`. **7 điểm gọi `createMany` trong 6 file** (đã grep lại 2026-11-04): `customers.service.ts:293` (tạo khách), `care-team.service.ts:311` (`notifyAssigned`), `care-team-requests.service.ts:329` và `:353`, `customer-criteria.service.ts:269` (tự đổi tình trạng), `care-logs.service.ts:323` (`notifyCareTeam`), `reminder-dispatch.service.ts:175`; **cộng điểm thứ 8 nội bộ** `notifications.service.ts:186` (`createMany` gọi từ `notifyAdmins`, mà `notifyAdmins` được `crm-abuse-monitor.service.ts:179` gọi). Dispatcher phải thay cả 8 điểm (hoặc 7 + `notifyAdmins`) | FR-43, 44 |
| `notification_preferences` (`types[type].{push,inApp}`, `quietHours {start,end}`), API `GET/PUT /notification-preferences/me` | ✅ ĐÃ CÓ | `resolveTypePreferences` trả đủ 12 loại; chưa có hiệu lực với push thật; web admin **chưa có trang** | FR-10 |
| `PushProvider` chỉ có `isEnabled()` và `initialStatus()` (không có `send`) | ⚠️ GAP | Cần mở rộng giao diện (xem 5.2) | FR-02 |
| `push_subscriptions` / `device_tokens`, API đăng ký, worker `push.send` | 🆕 MỚI | Chưa có gì; tài liệu 04/05/06 còn mô tả FCM + `device_tokens` (hướng cũ, xem 11.2) | FR-01..05 |
| Hạ tầng BullMQ: `QueueRuntimeService` (`registerWorker`, `upsertSchedulers`, `add` với `jobId`), `DEFAULT_JOB_OPTIONS` (3 lần, backoff mũ, `jitter: 0.5`), `QueueNames` (`HEALTH_PING`, `CRM_SCHEDULER`) | ✅ ĐÃ CÓ | Dùng lại cho queue `push` và `crm-image`; cần thêm hằng tên queue; tắt khi `QUEUE_WORKERS_ENABLED` sai (test) | FR-03, 05, 26 |
| `withTransaction(connection, work)` (`shared/database/with-transaction.util.ts`) | ⚠️ GAP | Doc nêu "không enqueue trong `work`, làm sau commit" nhưng 7 điểm gọi `createMany` (6 file) nằm sâu trong `work`; cần cơ chế `afterCommit` (xem 5.3) | FR-03 |
| `FeatureFlag.CRM_PUSH` (`FEATURE_CRM_PUSH`, mặc định tắt, đọc tại thời điểm gọi) | ✅ ĐÃ CÓ | `docker-compose.yml` dòng 248 đang **hard-code** `FEATURE_CRM_PUSH=false`; phải đổi thành biến `${CRM_PUSH_ENABLED:-false}` (FR-07) | FR-07 |
| Biến `VAPID_*`, thư viện `web-push` | 🆕 MỚI | Chưa có trong `package.json`, compose, `.env.docker.example` | FR-02, 07 |
| `PiiCryptoService` (AES-GCM + AAD, `modules/crm/common/crypto`) | ✅ ĐÃ CÓ | Dùng để mã hóa khóa `auth` của subscription (xem Q7) | FR-01 |
| `CustomLogger` (console + file Winston), `winston.config.ts` | ⚠️ GAP | Không che PII; mọi log đi qua `prependCallerInfo` rồi `super.*` + `forwardToFile`; `error(message, stack)` truyền stack ở tham số phụ | FR-15 |
| `RequestContextMiddleware` / `RequestContextService` (X-Request-ID) | ✅ ĐÃ CÓ | Dùng làm Correlation ID cho log push và làm khóa gộp push hàng loạt | FR-03 |
| Runner migration `src/migrations` (`MIGRATIONS` rỗng, đăng ký từ số `007`; `deploy.sh` bước 6b chạy `reconcile --apply --skip-version` SAU backup, TRƯỚC `up`; bước 8b chỉ ghi version) | ✅ ĐÃ CÓ | Migration phải idempotent; image CŨ vẫn phục vụ trong lúc migrate | FR-40, 46 |
| Migration CRM độc lập kiểu `migrateAreasTo34Provinces(db, apply)` (dry-run `apply=false`, driver gốc, có spec tích hợp) | ✅ ĐÃ CÓ (mẫu) | Dùng làm khuôn cho migration `007` | FR-40 |
| Danh mục: `customer_statuses.code` (duy nhất, bất biến), `catalog_items(type).code` (duy nhất theo loại, bất biến), `areas` (**KHÔNG có `code`**, chỉ `adminCode`/`seedKey`), `projects.code` (**sửa được** qua PATCH, `codeNormalized` duy nhất kể cả đã xóa mềm) | ⚠️ GAP so với Plan | Plan giả định mọi danh mục đã có `code` ổn định: sai với khu vực và dự án (xem Q1, Q2) | FR-40, 46 |
| Tham chiếu ObjectId hiện có: `customers.{statusId, sourceId, areaId, interestedProjectIds}`, `care_logs.contactResultId`, `appointments.projectId`, `projects.areaId`; audit đã lưu **nhãn** (không phải id) cho các trường này; chân dung đã khóa theo `fieldKey`/`value` | ✅ ĐÃ CÓ | `CustomerRefsService` là điểm chung dịch id↔nhãn và "khóa ghi" (`refLock`); `CrmUsageService` đếm theo các trường id để chặn xóa | FR-40 |
| `ActiveAdminGuard` (đọc role từ DB qua `CrmActorService`) + `@AdminOnly()` | ✅ ĐÃ CÓ (chỉ CRM) | Controller ngoài CRM (`knowledge-articles`, `external-log`, endpoint cron/settings ở `news-fire-crawl-manager`) vẫn dùng `@Roles(UserRole.ADMIN)` tin JWT | FR-21 |
| `GET catalogs` CRM (`@Roles(...CRM_ROLES)`) | ✅ ĐÃ CÓ | Tin role trong JWT (sống 15 phút) | FR-21 |
| `POST /users` (`UsersService.create`): kiểm `findOne` trước rồi `create` | ⚠️ GAP | Race hai yêu cầu đồng thời: chỉ có kiểm trước, không bắt E11000 → 500 | FR-22 |
| `listDeleted` trong `customer-list.service.ts` (dòng 152), `guardSearch` đã dùng ở `list` và `counts` | ⚠️ GAP | `listDeleted` chưa gọi `guardSearch` | FR-16 |
| Ảnh đính kèm: `crm_attachments.thumbKey` (luôn `null`), `care-log.mapper.ts` dòng 33 `thumbUrl: url`; `stripImageMetadata` (JS thuần, không có thư viện ảnh); `customer-purge.service` đã xóa cả `thumbKey` | ⚠️ GAP | Chưa có `sharp`/`jimp` trong `package.json` | FR-26 |
| Web admin PWA: `vite-plugin-pwa` (injectManifest), `src/pwa/sw.ts` (precache vỏ app, chưa có `push`), `tsconfig.sw.json` (include `src/pwa/sw.ts`, `serviceWorkerConfig.ts`), `registerServiceWorker.ts`, `IosInstallHint.tsx` | ✅ ĐÃ CÓ | Service worker chưa xử lý push; có sẵn nhận diện iOS để hiện hướng dẫn cài | FR-09 |
| Web admin: `NotificationDropdown.tsx` (popup 350px, `-right-[240px]`), màn `Notifications/index.tsx`, `AppSidebar.tsx` (`-translate-x-full` khi đóng, không `inert`) | ⚠️ GAP | Lỗi FR-38, FR-45 | FR-38, 45 |
| Web admin: tab Cài đặt CRM `SETTINGS_TABS` (7 tab), `CatalogSection`/`CatalogItemEditor`, `CATALOG_ENDPOINTS` mới có 3 loại; chưa có màn Kết quả liên hệ, Trường chân dung, Thẻ | ⚠️ GAP | FR-39, 41, 42 | FR-39, 41, 42 |
| Web admin FE: lớp adapter `modules/crm/api/http/*` (`catalogMappers`, `customerApi`, `customerQuery`, `careApi`, `schedulingApi`, `projectBody`) ánh xạ BE → kiểu FE, store dùng "id" chuỗi | ✅ ĐÃ CÓ | Đổi nguồn "id" sang `code` ở adapter là cách ít chạm nhất (xem 6.1) | FR-40 |
| Health: `/health/liveness`, `/health/readiness` (Mongo, Redis, S3) | ✅ ĐÃ CÓ | Không thêm dịch vụ hạ tầng mới (Redis/BullMQ đã có) nên không thêm probe; push lỗi KHÔNG làm readiness đỏ | FR-07 |

## 3. Data Model (MongoDB / Mongoose)

> Cột `FR` (ở mục 3, 4, 10): ghi mã FR-xx mà dòng này đáp ứng. Mọi thay đổi schema ở v1.0.4 là **thêm field/index (tương thích ngược)**; không xóa, không đổi tên, không đổi kiểu field cũ. Nguyên tắc index: **mọi index mới trên collection ĐÃ có dữ liệu tạo bằng migration** (`createIndex` idempotent) trước khi image mới chạy (`007` cho A0, `009` cho `notifications` và `crm_attachments`), không để Mongoose `autoIndex` dựng lúc khởi động trên collection lớn. **Ngoại lệ có chủ đích:** collection MỚI (`push_subscriptions`, `push_deliveries`) tạo index bằng schema Mongoose / `ensureIndexes` kiểu hiện có của dự án, vì collection rỗng lúc tạo nên dựng index tức thời, không khóa, không cần migration.

### 3.1 A0: tham chiếu danh mục theo `code` (FR-40, FR-46)

**Phạm vi đổi sang `code`** (kết quả đối chiếu code thật):

| Danh mục | Collection nguồn | Mã tham chiếu (`ref code`) | Bất biến? | Ghi chú | FR |
|---|---|---|---|---|---|
| Tình trạng khách | `customer_statuses` | `code` | Có (đã có, duy nhất kể cả đã xóa mềm) | Đã có sẵn | FR-40 |
| Nguồn khách | `catalog_items` (type `LEAD_SOURCE`) | `code` | Có (PATCH không đổi `code`) | Đã có sẵn | FR-40 |
| Kết quả liên hệ | `catalog_items` (type `CONTACT_RESULT`) | `code` | Có | Đã có sẵn | FR-40 |
| Khu vực | `areas` | `code` **MỚI** | Có (DTO sửa không có `code`) | Chưa có field; thêm và điền (xem 5.1.4, Q2) | FR-40 |
| Dự án | `projects` | `codeNormalized` (chữ HOA) | **Cần khóa bất biến** (hiện PATCH đổi được `code`) | Xem Q1 | FR-40 |
| Loại hình của dự án (FR-46) | `persona_fields` (`fieldKey = property_type`), `options[].value` | `value` của lựa chọn | Có (lựa chọn chỉ tắt, không xóa) | Đã có (`APARTMENT`, `TOWNHOUSE`, `VILLA`, `LAND`, `CONDOTEL`) | FR-46 |

**Giữ nguyên ObjectId** (ngoài phạm vi): người dùng, nhóm, thẻ (`tagIds`; thẻ đổi tên/gộp được và không có `code`), nhóm trường chân dung. Chân dung đã lưu theo `fieldKey`/`value` (đã là mã chữ). Audit đã lưu **nhãn** nên không cần chuyển; chỉ thêm `fromCode`/`toCode` tùy chọn (FR-40).

| Collection | Trường (mới, additive) | Kiểu | Ràng buộc / Index | FR |
|---|---|---|---|---|
| `areas` | `code` | `string` | Mẫu `^[A-Z][A-Z0-9_]{0,29}$`; **unique** `{code:1}` (partial `$type: string`, tính cả bản xóa mềm); sinh phía server khi tạo, không có trong DTO sửa; điền cho dữ liệu cũ bằng migration `007` | FR-40 |
| `projects` | (không thêm) dùng `codeNormalized` làm mã tham chiếu; thêm quy tắc "bất biến sau khi tạo" ở service (Q1) | | Index `codeNormalized` unique đã có | FR-40 |
| `projects` | `areaCode` | `string \| null` | Index `{areaCode:1}`; ghi kép cùng `areaId` | FR-40 |
| `projects` | `propertyTypeCodes` | `string[]` (mặc định `[]`) | Giá trị thuộc `options[].value` của `property_type`; index `{propertyTypeCodes:1}`. Trường cũ `propertyTypes` (chữ tự do) **giữ nguyên** làm dữ liệu cũ; API vẫn trả `propertyTypes` = danh sách NHÃN suy ra từ `propertyTypeCodes` (giá trị chưa khớp lấy nguyên văn) | FR-46 |
| `projects` | `unmappedPropertyTypes` | `string[]` (mặc định `[]`) | Chữ cũ không khớp lựa chọn nào; không mất dữ liệu; Quản trị xử lý ở form Dự án | FR-46 |
| `customers` | `statusCode` | `string` | Ghi kép với `statusId`; `required: false` ở schema trong v1.0.4 (dữ liệu cũ chưa chắc có, migration điền); index mới `{statusCode:1}`, `{deletedAt:1, statusCode:1, lastUpdatedAt:-1}`, `{primaryAssigneeId:1, statusCode:1}` (giữ index `statusId` cũ đến bản thu hẹp) | FR-40 |
| `customers` | `sourceCode` | `string \| null` | Index `{sourceCode:1}` | FR-40 |
| `customers` | `areaCode` | `string \| null` | Index `{areaCode:1}` | FR-40 |
| `customers` | `interestedProjectCodes` | `string[]` | Index `{interestedProjectCodes:1}` (multikey) | FR-40 |
| `care_logs` | `contactResultCode` | `string \| null` | Index `{contactResultCode:1}` sparse | FR-40 |
| `appointments` | `projectCode` | `string \| null` | Index `{projectCode:1, startAt:1}` | FR-40 |
| `crm_audit_logs` | `changes[].fromCode`, `changes[].toCode` | `string?` | Chỉ cho dòng thay đổi của 5 trường danh mục; thêm tùy chọn, bản ghi cũ không có | FR-40 |

**Bất biến dữ liệu sau migration (kiểm bằng test):** với mọi bản ghi, nếu trường ObjectId có giá trị thì trường `...Code` tương ứng có giá trị và trỏ đúng bản ghi danh mục đó; `...Code` không bao giờ đổi khi đổi nhãn.

### 3.2 M7 Web Push (FR-01..FR-07)

| Collection | Trường | Kiểu | Ràng buộc / Index | FR |
|---|---|---|---|---|
| `push_subscriptions` | `userId` | `ObjectId` | Bắt buộc; (mọi index của `push_subscriptions` và `push_deliveries` khai báo trong schema Mongoose/`ensureIndexes`, không qua migration vì collection mới, rỗng) index `{userId:1, revokedAt:1, lastSeenAt:-1}` (tối đa 3 hiệu lực/người) | FR-01 |
| | `endpoint` | `string` (≤ 1024) | Bắt buộc; **unique toàn hệ thống** (kể cả đã thu hồi, để đăng ký lại cùng endpoint là upsert gán lại); chỉ `https`, host thuộc allowlist (D6) | FR-01 |
| | `keys.p256dh` | `string` (base64url, 87 ký tự) | Khóa công khai của trình duyệt (không bí mật) | FR-01 |
| | `keys.authEnc` | `{cipherText, iv, tag, keyVersion}` | **Mã hóa** bằng `PiiCryptoService`, AAD `${userId}:${endpointHash}:push`; `auth` gốc (22 ký tự base64url) không bao giờ ghi log hay lộ ra API (Q7) | FR-01 |
| | `endpointHash` | `string` (SHA-256 hex) | Dùng trong AAD và log (không log `endpoint` thô vì URL là "capability"); index `{endpointHash:1}` | FR-01 |
| | `expirationTime` | `Date \| null` | Từ `PushSubscription.expirationTime` nếu có | FR-04 |
| | `platform` | `'IOS' \| 'ANDROID' \| 'DESKTOP' \| 'OTHER'` | Suy ra phía server từ `User-Agent` (thay `platform` IOS/ANDROID/WEB của thiết kế cũ); **không lưu UA thô** | FR-01 |
| | `deviceLabel` | `string` (≤ 60) | Nhãn hiển thị, ví dụ "iPhone · Safari", do server dựng từ UA | FR-01 |
| | `lastSeenAt` | `Date` | **Định nghĩa "hoạt động"** (chốt cho FR-01 và FR-05): đăng ký/làm mới (`POST` upsert, FE gọi tối đa 1 lần/24 giờ khi mở PWA đã cài), hoặc lần gửi thành công (HTTP 201 từ dịch vụ push). Dùng để chọn "ít hoạt động nhất" khi vượt 3 thiết bị và tính hạn 90 ngày | FR-01, FR-05 |
| | `revokedAt` | `Date \| null` | Thu hồi mềm; subscription còn hiệu lực khi và chỉ khi `revokedAt = null` | FR-01, FR-04 |
| | `revokedReason` | `'USER' \| 'LOGOUT' \| 'GONE' \| 'LIMIT_EXCEEDED' \| 'ACCOUNT_DISABLED'` | `GONE` = HTTP 404/410 của dịch vụ push; `LIMIT_EXCEEDED` = nhường chỗ thiết bị thứ 4 | FR-01, FR-04 |
| | `purgeAt` | `Date \| null` | Đặt bằng `revokedAt + 7 ngày` khi thu hồi; **TTL index** `{purgeAt:1}`, `expireAfterSeconds: 0`. 7 ngày để trang cài đặt báo "đã gỡ thiết bị X" | FR-01, FR-05 |
| | `createdAt`, `updatedAt` | `Date` | `timestamps` | FR-01 |
| `push_deliveries` | `notificationId` | `ObjectId` | **unique** `{notificationId:1, subscriptionId:1}` (chống trùng) | FR-03 |
| | `subscriptionId`, `userId` | `ObjectId` | | FR-03 |
| | `status` | `'SENDING' \| 'SENT' \| 'GONE' \| 'FAILED'` | Chỉ `SENT`/`GONE` là "đã xong" (không gửi lại) | FR-03, FR-04 |
| | `attempts` | `number` | | FR-03 |
| | `lastErrorCode` | `string \| null` | Chỉ mã (HTTP status / `TIMEOUT` / `NETWORK`), **không** lưu thân phản hồi hay payload | FR-03 |
| | `sentAt` | `Date \| null` | | FR-03 |
| | `createdAt` | `Date` | TTL index `{createdAt:1}` 30 ngày (dữ liệu kỹ thuật, ngắn hơn 180 ngày của `notifications`) | FR-03 |
| `notifications` (thêm field) | `push` | `{title, body, url} \| null` | Nội dung push **đã dựng sẵn** theo mẫu (title ≤ 50, body ≤ 120 ký tự, `url` là đường dẫn nội bộ); có tên khách nên **bị xóa cùng `title/body` khi khách ẩn danh hóa** (sửa `customer-scheduling-anonymizer.service`) | FR-06, FR-44 |
| | `pushGroupKey` | `string \| null` | Khóa gộp push hàng loạt (xem 5.5); mặc định `null` | FR-43 |
| | `pushSentAt` | `Date \| null` | Mốc gửi thành công đầu tiên | FR-03 |
| | `pushStatus` (đã có) | `PENDING \| SENT \| SKIPPED \| FAILED` | Dùng đủ 4 giá trị. Index mới `{pushStatus:1, createdAt:1}` partial `pushStatus = 'PENDING'` cho job quét, **tạo bằng migration `009`** (collection `notifications` đã có dữ liệu; 5.1.10) | FR-03 |
| `notification_preferences` | (không đổi schema) | | `types[type].push` mặc định `true`; `quietHours` mặc định `null` (tắt). Không loại nào được ngoại lệ | FR-03, FR-10 |

**Mã hóa/nhạy cảm:** `endpoint` là URL có tính "capability" nên không ghi log thô (dùng `endpointHash`); `auth` mã hóa at-rest; `p256dh` không bí mật. Khóa riêng VAPID chỉ ở biến môi trường, không vào DB, repo, image, log (FR-07). Payload push không bao giờ lưu vào `push_deliveries`.

### 3.3 Nhóm sửa lỗi và lỗi mới (các thay đổi dữ liệu còn lại)

| Collection | Trường | Kiểu | Ràng buộc / Index | FR |
|---|---|---|---|---|
| `crm_attachments` | `thumbKey` (đã có), `width`, `height` (đã có, đang `null`) | `string \| null`, `number \| null` | Điền bởi job thumbnail; thêm `thumbStatus: 'NONE' \| 'READY' \| 'FAILED'` (mặc định `NONE`; thiếu field coi như `NONE`) và `thumbAttempts: number`; index `{thumbStatus:1, createdAt:1}` partial `thumbStatus != READY` cho job bù ảnh cũ, **tạo bằng migration `009`** (collection `crm_attachments` đã có dữ liệu; 5.1.10) | FR-26 |
| `notifications` | (không đổi) | | Test E11000 đồng thời (FR-25): `createMany` dùng upsert theo `(userId, dedupeKey)`; chỉ khi test chứng minh upsert đua ném E11000 mới bắt `isDuplicateKeyError` và thử lại một lần | FR-25 |
| `users` | (không đổi) | | `POST /users`: bắt E11000 của index duy nhất email → 409 (cùng thông điệp `EMAIL_IN_USE_MESSAGE` hiện có) | FR-22 |

## 4. API Contract

> Mọi route có tiền tố `/api/v1`, có `@ApiTags/@ApiOperation/@ApiProperty` (Swagger), trả `{ data }` (danh sách kèm `meta`), lỗi theo `GlobalExceptionFilter`: `{ statusCode, message, timestamp, path }` (kèm `code` nghiệp vụ như hiện nay qua `BusinessException`). Bảng liệt kê **endpoint mới và endpoint đổi hợp đồng**; endpoint không nêu thì không đổi.

### 4.1 M7 Web Push (FR-01, 04, 05, 07, 09, 10)

| Method | Endpoint | Quyền | Request | Response | FR |
|---|---|---|---|---|---|
| GET | `/push-subscriptions/config` | `CRM_ROLES` + `CrmFeatureGuard` | không | `200 { data: { enabled: boolean, publicKey: string \| null } }`. `enabled` = cờ `FEATURE_CRM_PUSH` bật VÀ đủ biến VAPID. `publicKey` = `VAPID_PUBLIC_KEY` **chỉ khi `enabled = true`; `enabled = false` thì `publicKey = null`** (không bí mật; FE lấy lúc chạy, **không** nhúng vào bundle nên đổi khóa không phải build lại FE) | FR-07, FR-09 |
| POST | `/push-subscriptions` | `CRM_ROLES` (Self) | `{ endpoint: string (https, ≤1024, host allowlist), keys: { p256dh: string (base64url 87), auth: string (base64url 22) }, expirationTime?: number \| null }`. Đã whitelist DTO; giới hạn 10 yêu cầu/phút/người (Throttler) | `201` (mới) hoặc `200` (upsert/làm mới): `{ data: { id, deviceLabel, platform, createdAt, lastSeenAt, displaced: { id, deviceLabel } \| null } }`. Upsert theo `endpoint`: đã có (kể cả của người khác hoặc đã thu hồi) thì **gán lại cho người gọi**, xóa `revokedAt`, cập nhật `lastSeenAt` và khóa. Nếu sau khi lưu người này có hơn 3 subscription hiệu lực thì thu hồi (`LIMIT_EXCEEDED`) các cái `lastSeenAt` cũ nhất và trả `displaced` (thiết bị bị gỡ). Lỗi: `400 PUSH_SUBSCRIPTION_INVALID` (endpoint không https/không thuộc allowlist/khóa sai độ dài), `400 VALIDATION_FAILED` | FR-01, FR-05 |
| GET | `/push-subscriptions` | `CRM_ROLES` (Self) | không | `200 { data: { active: [{ id, deviceLabel, platform, lastSeenAt, createdAt }], recentlyRevoked: [{ deviceLabel, reason: 'LIMIT_EXCEEDED' \| 'GONE' \| 'USER' \| 'LOGOUT' \| 'ACCOUNT_DISABLED', revokedAt }] } }`. `recentlyRevoked` = đã thu hồi trong 7 ngày (nguồn của thông báo "đã gỡ thiết bị X để nhường chỗ") | FR-01, FR-09 |
| DELETE | `/push-subscriptions/:id` | `CRM_ROLES` (Self) | `:id` qua `ParseObjectIdPipe` | `204`. Chỉ chủ sở hữu; người khác hoặc không tồn tại: `404 RESOURCE_NOT_FOUND` (không lộ tồn tại). Đặt `revokedAt`, `revokedReason = USER`, `purgeAt`. Idempotent (đã thu hồi cũng 204) | FR-01 |
| POST | `/auth/logout` (đổi hợp đồng, tương thích ngược) | công khai theo cookie như hiện nay | thêm body tùy chọn `{ pushSubscriptionId?: string }`; không gửi thì hành vi như cũ | Như cũ. Có `pushSubscriptionId` hợp lệ **của chính người đăng xuất** thì thu hồi (`LOGOUT`); id lạ bị bỏ qua im lặng (không lộ). Đăng xuất không kèm id **không** thu hồi subscription nào | FR-01 |
| GET | `/notification-preferences/me` (đổi hợp đồng, thêm field) | `CRM_ROLES` | không | Như cũ (`types`, `quietHours`) **kèm** `pushTypes: [{ type, label, description, defaultEnabled: true, canDisable: true }]` lấy từ `PUSH_CATALOG` (đúng 4 loại, theo thứ tự danh mục). FE hiển thị công tắc theo `pushTypes`, không hard-code danh sách | FR-10, FR-43 |
| PUT | `/notification-preferences/me` | `CRM_ROLES` | Như cũ: `{ types: { [type]: { push, inApp } }, quietHours?: { start: 'HH:mm', end: 'HH:mm' } \| null }`; `quietHours = null` tắt (mặc định tắt); `start ≠ end`, được qua nửa đêm | Như cũ + `pushTypes` | FR-10 |
| (nội bộ) | `NotificationDispatcher.dispatch(requests, session?)` | không phải HTTP | Xem 5.2 | `{ created: number }` | FR-44 |

> **M2: đã bỏ endpoint `POST /push-subscriptions/:id/test` ("Gửi thử") khỏi thiết kế** vì không thuộc FR nào của Plan (danh mục push là danh sách đóng 4 loại, FR-43; một push "Thông báo thử" sẽ là loại/mẫu thứ năm). Ngoài phạm vi v1.0.4; nghiệm thu iPhone/Android bằng thao tác thật (phân khách, ghi nhật ký) theo runbook. Xem Q11.

**Mã lỗi mới** (thêm vào `common/exceptions/error-codes.ts`): `PUSH_SUBSCRIPTION_INVALID` (400). Không dùng mã 5xx riêng cho lỗi dịch vụ push vì push không bao giờ làm hỏng response nghiệp vụ.

**Tương thích trong lúc chuyển (PWA cũ còn cache bundle cũ tới khi bấm "Cập nhật"):** các endpoint hiện có không đổi nghĩa; mọi trường mới chỉ thêm. Khi API chạy mà `FEATURE_CRM_PUSH` tắt: `POST/GET/DELETE /push-subscriptions` vẫn hoạt động (lưu để không mất khi bật cờ sau, Plan mục 3 quy tắc 12) nhưng `config.enabled = false` nên FE không hiện nút bật.

### 4.2 A0: hợp đồng danh mục theo `code` (FR-40, FR-46)

Nguyên tắc: **response trả cả `id` lẫn `code` lẫn `label`; request chấp nhận `code` (mới, ưu tiên) hoặc `id` (cũ, deprecated)**, đúng một trong hai cho mỗi trường (gửi cả hai mà không khớp: `400 VALIDATION_FAILED`). Cho phép cả hai trong suốt v1.0.4 vì PWA cũ còn gửi id; thu hẹp (bỏ nhận `id`) là việc của bản sau (Q3).

| Method | Endpoint | Quyền | Request (thay đổi) | Response (thay đổi) | FR |
|---|---|---|---|---|---|
| GET/POST/PATCH | `/crm/customers`, `/crm/customers/:id` | như hiện nay | Body thêm `statusCode`, `sourceCode`, `areaCode`, `projectCodes[]` (song song `statusId`, `sourceId`, `areaId`, `projectIds[]`) | `status` đã có `code`; `source`, `area`, `projects[]` đổi từ `RefDto {id,label}` sang `CatalogRefDto {id, code, label}` (kiểu mới kế thừa `RefDto`, **không đổi `RefDto` dùng chung** vì thẻ/người dùng cũng dùng) | FR-40 |
| GET | `/crm/customers`, `/crm/customers/list-counts` (và `/crm/deleted-customers` không có lọc danh mục) | như hiện nay | Query thêm `statusCodes`, `sourceCodes`, `areaCodes`, `projectCodes` (CSV, qua `csv-list.decorator`) song song `statusIds`...; `areaCodes` vẫn mở rộng sang khu vực con (qua `ancestorIds`) | `list-counts.byStatus[]` thêm `statusCode` cạnh `statusId` | FR-40 |
| POST | `/crm/customer-bulk-operations` | `ADMIN`/`MANAGER`/`STAFF` theo ma trận hiện có | `payload.statusCode` song song `payload.statusId` (CHANGE_STATUS) | Như cũ | FR-40 |
| POST/PATCH | `/crm/customers/:id/care-logs` | như hiện nay | `contactResultCode` song song `contactResultId` | `contactResult: CatalogRefDto` | FR-40, FR-47 |
| POST/PATCH | `/crm/appointments` | như hiện nay | `projectCode` song song `projectId` | `project: CatalogRefDto \| null` | FR-40 |
| GET/POST/PATCH | `/crm/areas` | GET: `CRM_ROLES` (FR-21); ghi: `@AdminOnly()` | Không nhận `code` (sinh phía server) | Thêm `code` | FR-40 |
| GET/POST/PATCH | `/crm/projects` | như hiện nay | Thêm `areaCode`, `propertyTypeCodes[]` (song song `areaId`, `propertyTypes[]` chữ cũ). `PATCH` gửi `code` khác `code` hiện tại (so sánh `codeNormalized`): `400 PROJECT_CODE_IMMUTABLE` (Q1) | Thêm `areaCode`, `propertyTypeCodes[]`, `unmappedPropertyTypes[]`; `propertyTypes[]` = nhãn suy ra | FR-40, FR-46 |
| GET | `/crm/customer-statuses`, `/crm/lead-sources`, `/crm/contact-results` | `CRM_ROLES` | Không đổi | Đã có `code` | FR-40 |
| GET | `/crm/customers/:id/histories`, `/crm/audit-logs` | như hiện nay | Không đổi | `changes[]` của 5 trường danh mục thêm `fromCode`, `toCode` tùy chọn cạnh `from`, `to` (nhãn) | FR-40 |

**Quyết định về xuất file:** backend hiện **chưa có** endpoint xuất CSV/Excel (M8 thuộc phiên bản sau). Ở v1.0.4, "export đọc được" đạt được vì dữ liệu lưu đã có `…Code`; khi M8 làm xuất file thì mỗi cột danh mục phải có cặp `code` + `label` (ghi vào tài liệu FR-13).

### 4.3 Nhóm sửa lỗi và lỗi mới (hợp đồng đổi)

| Method | Endpoint | Quyền | Request | Response | FR |
|---|---|---|---|---|---|
| POST | `/users` | `@AdminOnly()` (đã có) | Không đổi | Trùng email (kể cả hai yêu cầu đồng thời): `409` cùng thông điệp `EMAIL_IN_USE_MESSAGE`, không còn `500` | FR-22 |
| GET | `/crm/deleted-customers` (`listDeleted`, `customer-lifecycle.controller.ts`) | `@AdminOnly()` (đã có) | `q` đi qua `guardSearch` (rate limit 30/phút + theo dõi dò SĐT) | `429` khi vượt hạn mức, như `list` | FR-16 |
| (mọi route) | toàn hệ thống | như hiện nay | Khóa bắt đầu bằng `$` ở **bất kỳ cấp** của `body`, `query`, `params` bị từ chối trước `ValidationPipe` | `400 VALIDATION_FAILED` ("Dữ liệu chứa ký tự/toán tử không được phép") | FR-14 |
| (route ADMIN-only ngoài CRM) | `knowledge-articles/*`, `external-log/*`, endpoint cron/cài đặt trong `news-fire-crawl-manager` và `settings` | ADMIN **đọc role từ DB** | Không đổi | Tài khoản bị khóa/hạ quyền: `401`/`403` ngay (không chờ JWT hết hạn) | FR-21 |
| GET | `/crm/customer-statuses`, `/crm/lead-sources`, `/crm/contact-results`, `/crm/areas`, `/crm/projects`, `/crm/tags`, `/crm/persona-fields` | `CRM_ROLES` + **xác nhận người dùng còn ACTIVE và còn role CRM theo DB** | Không đổi | Như cũ; tài khoản đã khóa: `401` | FR-21 (Q8) |
| GET | `/crm/customers/:id/care-logs` và `/crm/customers/:id/care-log-attachments` (ảnh đính kèm) | như hiện nay | Không đổi | `attachments[].thumbUrl` trỏ tới thumbnail thật khi `thumbKey` có; chưa có thì `thumbUrl = url` như cũ | FR-26 |
| GET | `/notifications` | `CRM_ROLES` (đã có `page`, `limit`, `isRead`) | Không đổi | Không đổi (FR-38 chỉ làm ở FE; đã kiểm có phân trang, mới nhất trước) | FR-38 |

## 5. Service & luồng xử lý

### 5.1 A0 (đọc và làm trước): đổi tham chiếu danh mục sang `code`, FR-40 và FR-46

> Đủ chi tiết để `coder-backend-agent`, `coder-frontend-agent`, `devops-agent` làm ngay. Nguyên tắc nền: **mở rộng (thêm field + ghi kép) → chuyển dữ liệu (migration idempotent) → đọc theo `code` → (bản sau) thu hẹp (bỏ id)**. Ở v1.0.4 chỉ làm ba bước đầu.

#### 5.1.1 Quy tắc ghi kép và đọc theo `code`

| Quy tắc | Nội dung | FR |
|---|---|---|
| Ghi | Mọi đường **ghi** trường danh mục ghi **cả hai**: `statusId`+`statusCode`, `sourceId`+`sourceCode`, `areaId`+`areaCode`, `interestedProjectIds`+`interestedProjectCodes`, `contactResultId`+`contactResultCode`, `projectId`+`projectCode` (lịch hẹn), `areaId`+`areaCode` (dự án). Việc dịch `code ↔ id` làm **một chỗ**: `CustomerRefsService` (thêm `resolveByCodes`/`resolveByIds` trả `{ id, code, label }` theo lô, `$in` một lần mỗi loại để không N+1) | FR-40 |
| Đầu vào | Request nhận `…Code` (ưu tiên) hoặc `…Id` (cũ). Có cả hai mà không cùng một bản ghi: `400 VALIDATION_FAILED`. `code` không tồn tại/đã ngừng hoạt động/đã xóa mềm khi **gán mới**: `400` như thông báo hiện nay ("không tồn tại hoặc đã ngừng hoạt động"); giữ nguyên "khóa ghi" `refLock` (hàm `lockAndAssert` nhận id đã dịch) | FR-40 |
| Đọc | Lọc, nhóm, đếm dùng `…Code` (`buildFilter`, `statusCondition`, `counts` với `$group` theo `statusCode`); **hiển thị**: khi bản ghi chưa có `…Code` thì **mapper dịch từ id** (`code = lookup(id)`), không lỗi. **Lưu ý (H1):** mapper chỉ che được phần hiển thị, KHÔNG che được lọc/đếm; bản ghi thiếu `…Code` (do image v1.0.3 ghi trong lúc migrate hoặc lúc lùi) sẽ không lọt vào lọc/đếm theo `code`. Vì vậy **đã chọn: lệnh bù tự động trong `deploy.sh` ngay sau `up`** (xem 5.1.3, "Mặc định đã chọn H1"); lọc/đếm giữ nguyên chỉ dùng `…Code` (giữ đúng chỉ mục, không dùng `$or` ở đường nóng) | FR-40 |
| Đếm "đang dùng" | `CrmUsageService.count*` dùng `$or: [{ statusCode: code }, { statusId: id }]` (tương tự cho nguồn, khu vực, dự án, kết quả liên hệ) cho tới khi thu hẹp, để chặn xóa danh mục vẫn đúng với dữ liệu chưa kịp điền `code` | FR-40 |
| Đổi nhãn | Không đổi `code`; không cập nhật hàng loạt bản ghi tham chiếu. Audit cũ giữ nhãn lúc ghi | FR-40 |
| Mã không dùng lại | Giữ nguyên các chỉ mục duy nhất kể cả bản xóa mềm (`customer_statuses.code`, `catalog_items {type, code}`, `projects.codeNormalized`, mới: `areas.code`) | FR-40 |
| Khóa ghi chéo | `refLock` đã đủ cho id; ghi kép không thêm khóa mới vì `code` suy ra từ cùng bản ghi danh mục đã khóa | FR-40 |

#### 5.1.2 Thay đổi theo file (backend, `RealEstateBackendApp/src`)

| File / module | Việc | FR |
|---|---|---|
| `modules/crm/catalogs/schemas/area.schema.ts`, `areas.service.ts`, `dtos/area.dto.ts` | Thêm `code` (unique partial); `create` sinh `code` (xem 5.1.4); DTO sửa không nhận `code`; response thêm `code`. Seed 34 tỉnh (`seed/crm-seed.data.ts`) thêm `provinceCode()` xác định | FR-40 |
| `modules/crm/projects/projects.service.ts`, `project.rules.ts`, `schemas/project.schema.ts`, `dtos/project.dto.ts` | Thêm `areaCode`, `propertyTypeCodes`, `unmappedPropertyTypes`; `assertProjectCodeChange` thành "không đổi (so `codeNormalized`)" → `400 PROJECT_CODE_IMMUTABLE` (Q1); `create/update` ghi kép `areaId`+`areaCode`; `propertyTypes` chữ cũ vẫn nhận (ánh xạ qua bộ khớp, phần không khớp vào `unmappedPropertyTypes`) | FR-40, FR-46 |
| `modules/crm/customers/schemas/customer.schema.ts`, `customer-refs.service.ts`, `customers.service.ts`, `customer-status-change.service.ts`, `customer-criteria.service.ts`, `customer-list.service.ts`, `customer.mapper.ts`, `dtos/customer-request.dto.ts`, `dtos/customer-query.dto.ts`, `dtos/customer-response.dto.ts`, `utils/customer-audit.util.ts` | Thêm 4 field `…Code` + index; ghi kép ở tạo/sửa/đổi tình trạng/tự đổi tình trạng; `statusCondition`, `buildFilter` (`sourceCodes`, `projectCodes`, `areaCodes` + mở rộng khu vực con), `counts` (`$group` theo `statusCode`); response `CatalogRefDto`; audit thêm `fromCode/toCode` | FR-40 |
| `modules/crm/bulk-operations/*` | `payload.statusCode` song song `statusId`; đi qua `CustomerRefsService` | FR-40 |
| `modules/crm/care-logs/*` (`schemas`, `care-logs.service.ts`, `dtos`, `care-log.mapper.ts`) | `contactResultCode` ghi kép; mapper trả `CatalogRefDto` | FR-40 |
| `modules/crm/appointments/*` (`schemas`, `appointments-write.service.ts`, `appointments.service.ts`, `daily-tasks.service.ts`, mapper, dtos) | `projectCode` ghi kép; `daily-tasks.service` (`statusIdsOf`, lọc `interestedProjectIds`) và `reminder-scanner.service.ts` (nhóm tình trạng) chuyển sang `…Code` | FR-40 |
| `modules/crm/common/crm-usage.service.ts` | Đếm theo `$or` (xem 5.1.1) | FR-40 |
| `common/dto/ref.dto.ts` | **Không sửa `RefDto`**; thêm `CatalogRefDto extends RefDto { code }` | FR-40 |
| `migrations/migration.registry.ts` + file migration mới | Đăng ký `007_crm_catalog_codes`, `008_crm_project_property_type_codes` và `009_notification_attachment_indexes` (xem 5.1.3, 5.1.5, 5.1.10); spec tích hợp theo khuôn `migrate-areas-to-34-provinces.integration.spec.ts` | FR-40, FR-46 |

#### 5.1.3 Migration `007_crm_catalog_codes` (idempotent, dry-run, không đổi `updatedAt`/`version`)

Hàm thuần `migrateCatalogCodes(db, apply)` theo khuôn `migrateAreasTo34Provinces` (driver MongoDB gốc, **không** qua Mongoose để không chạm `updatedAt`, `__v`/`version`, `lastUpdatedAt`, không sinh audit/nhắc việc/thông báo). **Không bọc một transaction duy nhất** (collection khách có thể lớn, vượt thời gian sống của transaction); thay vào đó mỗi bước là thao tác idempotent theo từng lô, chạy lại an toàn từ đầu (đúng yêu cầu `Migration.up` của runner).

(Bảng dưới là các bước kỹ thuật của một migration, toàn bộ thuộc FR-40 và FR-46 theo tiêu đề mục; không thêm cột FR.)

| Bước | Thao tác | Idempotent nhờ |
|---|---|---|
| 0 | `apply=false`: chỉ đếm từng bước dưới đây và in báo cáo, không ghi gì | |
| 1 | Điền `areas.code` cho bản chưa có (xem 5.1.4), rồi `createIndex` unique partial `{code:1}` | Chỉ ghi khi thiếu `code`; `createIndex` trùng định nghĩa thì bỏ qua |
| 2 | `createIndex` các chỉ mục mới ở 3.1 (`customers`, `care_logs`, `appointments`, `projects`) | `createIndex` idempotent |
| 3 | `projects.areaCode`: với mỗi khu vực, `updateMany({ areaId, areaCode: { $exists: false } }, { $set: { areaCode } })` | Điều kiện `$exists: false` |
| 4 | `customers`: mỗi tình trạng/nguồn/khu vực (kể cả đã ngừng hoặc xóa mềm): `updateMany({ <id>: id, <code>: { $exists: false } }, { $set: { <code> } })`. `interestedProjectCodes`: duyệt con trỏ lô 500 khách chưa có field, ánh xạ id→`codeNormalized`, `bulkWrite` `updateOne` kèm điều kiện `$exists: false` (mảng id rỗng → `[]`) | Điều kiện `$exists: false` |
| 5 | `care_logs.contactResultCode`, `appointments.projectCode`: như bước 4 | Như trên |
| 6 | Kiểm cuối: đếm bản ghi có id mà thiếu `code` (phải bằng 0) và **id mồ côi** (id không còn trong danh mục, đáng lẽ không có vì danh mục chỉ xóa mềm). Có mồ côi: ghi danh sách `collection:_id:id` (không có dữ liệu cá nhân) vào log runner rồi **ném lỗi** để runner dừng ở lỗi (không ghi sổ), người vận hành xử lý rồi chạy lại. Phần còn lại đã điền, không phải làm lại | |

Báo cáo trả về (giống `MigrateAreasResult`): `areasCoded`, `areaIndexCreated`, `projectsAreaCoded`, `customersStatusCoded`, `customersSourceCoded`, `customersAreaCoded`, `customersProjectsCoded`, `careLogsCoded`, `appointmentsCoded`, `orphans`.

**Khoảng hở deploy:** runner chạy SAU backup, TRƯỚC `up`, lúc image cũ còn phục vụ nên có thể còn vài bản ghi mới ghi chỉ có id (cũng xảy ra với bản ghi do image cũ ghi trong thời gian lùi). Các lớp bảo vệ: (1) mapper (hiển thị) và `CrmUsageService` (`$or`, chặn xóa danh mục) chịu được thiếu `code` (5.1.1); (2) mọi lần ghi của image mới tự điền `code`; (3) lệnh bù `node dist/migrations/crm-catalog-codes.cli.js [--apply]` (bọc cùng hàm `migrateCatalogCodes`, dry-run mặc định).

**Mặc định đã chọn H1 (lỗ hổng lọc/đếm bỏ sót bản ghi thiếu `code`): lệnh bù là BƯỚC TỰ ĐỘNG của `deploy.sh`, chạy ngay SAU `up` (sau khi backend healthy), `--apply`, chạy mọi lần deploy (idempotent, vài giây khi không còn gì để bù), thất bại (mã thoát khác 0) thì in cảnh báo đỏ và deploy báo lỗi chứ không im lặng.** Lý do chọn so với phương án `$or` (id hoặc code) ở lọc/đếm: (a) `$or` phá chỉ mục tổng hợp mới `{deletedAt, statusCode, lastUpdatedAt}`, và `$group` theo `statusCode` không có `$or` tương đương nếu không `$lookup` hoặc `$ifNull` + tra id trong bộ nhớ (thêm nhánh logic ở đường nóng của danh sách khách, dễ sai và chậm); (b) bản ghi thiếu `code` chỉ là hiện tượng tạm trong khoảng giữa migrate và `up` (hoặc sau lùi), một bước bù tự động sau `up` đóng khoảng này mà không làm phức tạp truy vấn; (c) sau `up` mọi lần ghi của image mới đã tự điền `code` nên lệnh bù chạy đúng một lần là đủ; (d) quay lui rồi tiến lại cũng chạy lại bước này vì là bước cố định của `deploy.sh`. Khoảng hở còn lại: vài giây giữa `up` và bước bù (chấp nhận, không mất dữ liệu, chỉ lệch tạm trong danh sách/đếm). Giữ `$or` như lớp dự phòng **chỉ** ở `CrmUsageService` (đường lạnh, chặn xóa danh mục). Nếu Oniichan muốn không còn cả khoảng hở này thì phương án thay thế là `$or` ở lọc/đếm (chi phí: chỉ mục và `$group` như trên).

**Cách kiểm bằng test (bắt buộc, thuộc A0-MIG và A0-QA):**
1. Integration: gieo khách, nhật ký, lịch hẹn chỉ có id (mô phỏng image v1.0.3 ghi) bên cạnh bản ghi đã có `code`; trước lệnh bù, kiểm chứng đối chứng: lọc theo `statusCodes` KHÔNG thấy bản ghi thiếu code và `list-counts` thiếu nó (khẳng định lỗ hổng có thật, tránh test tautology); chạy `crm-catalog-codes.cli --apply`; sau đó lọc `statusCodes`/`sourceCodes`/`areaCodes`/`projectCodes` và `list-counts.byStatus` phải thấy đủ, và tổng `byStatus` bằng số khách không xóa.
2. Chạy lệnh bù lần hai: mọi số đếm bằng 0 (idempotent); dry-run không ghi.
3. Kịch bản lùi rồi tiến: sau khi lùi sang image cũ và ghi vài bản ghi chỉ có id, chạy lại bước bù, các bản ghi đó xuất hiện trong lọc/đếm.
4. `devops-agent` kiểm `deploy.sh` trên bản sao (5.1.8): bước bù có chạy sau `up`, lỗi của lệnh bù làm deploy báo lỗi; ghi vào log.
5. Truy vấn kiểm bất biến 3.1 (đếm bản ghi có id mà thiếu `code` = 0) chạy sau bước bù.

#### 5.1.4 Sinh `areas.code`

- Khuôn: chữ HOA ASCII, bỏ dấu (dùng `normalizeVietnamese`), ký tự không phải chữ/số thành `_`, gộp `_` liên tiếp, cắt ≤ 30 ký tự, bắt đầu bằng chữ (nếu không thì thêm tiền tố `A_`). Ví dụ "Hà Nội" → `HA_NOI`.
- **34 tỉnh seed**: mã xác định từ danh sách seed (hàm `provinceCode(name)` đặt cạnh `provinceSeedKey`), không phụ thuộc thứ tự chạy.
- **Khu vực khác (người dùng tạo, quận/huyện còn sót)**: sinh từ tên; trùng thì thêm hậu tố `_2`, `_3`... (kiểm trong bộ nhớ cho migration, bằng `unique` index + thử lại cho `create`).
- Bất biến: không có trong DTO sửa; đổi tên không đổi mã; xóa mềm không giải phóng mã.

#### 5.1.5 Migration `008_crm_project_property_type_codes` (FR-46)

- Đầu vào: `projects.propertyTypes` (chữ tự do) và lựa chọn của trường chân dung `property_type` (kể cả lựa chọn đã tắt). Thiếu trường `property_type` (hoặc trường có nhưng danh sách lựa chọn rỗng), xử lý theo việc còn lại: (a) **không có dự án nào cần gán `propertyTypeCodes`** (mọi dự án đã có mã, hoặc `propertyTypes` không có chữ không rỗng nào) thì coi là "không có việc": ghi log **CẢNH BÁO**, trả 0, **không ghi**, cả dry-run lẫn apply (tình huống DB mới tinh: trường chỉ được seed khi backend khởi động lần đầu, tức sau bước 6b của `deploy.sh`, nên lúc chạy migration chưa có trường); (b) **có dự án cần gán mã** mà thiếu trường thì **ném `PropertyTypeFieldMissingError`** dừng migration, không đoán. Có trường thì xử lý như các mục dưới.
- Với mỗi dự án chưa có `propertyTypeCodes`: mỗi chữ cũ, so khớp **sau chuẩn hóa** (`normalizeVietnamese`, chữ thường, bỏ khoảng trắng thừa) với `label` hoặc `value` của lựa chọn, cộng một **bảng từ đồng nghĩa cố định** trong migration (ví dụ "căn hộ" → `APARTMENT`, "nhà phố"/"shophouse" → `TOWNHOUSE`, "biệt thự"/"villa" → `VILLA`, "đất nền" → `LAND`, "condotel"/"nghỉ dưỡng" → `CONDOTEL`). Khớp được: vào `propertyTypeCodes` (bỏ trùng, giữ thứ tự). Không khớp: vào `unmappedPropertyTypes` (**không mất dữ liệu**), `propertyTypes` cũ giữ nguyên.
- Ghi bằng `updateOne({ _id, propertyTypeCodes: { $exists: false } }, ...)`; dry-run liệt kê số dự án và các chữ không khớp (dữ liệu dự án, không phải dữ liệu cá nhân).
- Sau chuyển: migration chỉ **thêm** `propertyTypeCodes` và `unmappedPropertyTypes`; `propertyTypes` (chữ cũ) **giữ nguyên văn, không ghi đè** (khớp mục 3.1), nên image cũ vẫn đọc đúng chữ gốc và `$unset` ở L2 không làm mất dữ liệu. Nhãn hiển thị do API suy ra từ `propertyTypeCodes` khi trả về (mục 3.1), không lưu lại vào `propertyTypes`. Form Dự án hiện `unmappedPropertyTypes` như cảnh báo để Quản trị chọn lại.
- Đổi nhãn lựa chọn ở màn Trường chân dung (FR-41) không làm vỡ dự án vì dự án lưu `value`. **Lựa chọn không được xóa cứng** (chỉ tắt) là điều kiện đã có sẵn ở `PATCH persona-fields` (`options` vắng mặt bị tắt, không xóa).

#### 5.1.6 Tương thích trong giai đoạn chuyển

- API nhận cả `…Id` lẫn `…Code` suốt v1.0.4 (PWA cũ còn cache bundle tới khi người dùng bấm "Cập nhật"). Response thêm field, không bỏ field (`status.id`, `source.id`... vẫn có).
- Web admin: đổi **nguồn "id" thành `code` ở lớp adapter** (`modules/crm/api/http/*`: `catalogMappers`, `customerApi`, `customerQuery`, `careApi`, `schedulingApi`, `projectBody`) để kiểu FE và store giữ nguyên, `<option value>` tự thành `code`. Dữ liệu lưu cục bộ (`crmStorage`) có bộ lọc theo id cũ: nâng phiên bản lưu trữ và bỏ bộ lọc cũ (có test migration lưu trữ). Mock (`mockCrmApi`, `seedCatalogs`, `mockData`) đổi id mẫu thành `code`.

#### 5.1.7 Chiến lược lùi (đường lùi)

> FR: toàn bộ bảng này áp dụng cho migration `007` (FR-40) và `008` (FR-46); migration `009` (FR-03, FR-26) chỉ thêm index, lùi bằng `down` (5.1.10).

| Mức | Khi nào | Cách | Dữ liệu |
|---|---|---|---|
| L1: lùi code | Image mới lỗi sau deploy | Chạy lại image `pre-<thời gian>` của `deploy.sh` (không `git checkout`): vì mọi thay đổi chỉ **thêm field/index** và id vẫn luôn được ghi, v1.0.3 đọc dữ liệu đã migrate bình thường | Không mất. Bản ghi image cũ ghi trong thời gian lùi thiếu `code` → khi tiến lại chạy lệnh bù (5.1.3) |
| L2: dọn field mới | Cần gỡ hẳn (hiếm) | Lệnh `$unset` các field `…Code` và `propertyTypeCodes`, `unmappedPropertyTypes`, `areas.code`, `projects.areaCode`, chỉ chạy **sau khi đã lùi image** (ghi vào runbook) | Id gốc còn nguyên |
| L3: khôi phục | Dữ liệu hỏng | `mongorestore` từ bản backup `deploy.sh` đã tạo trước migrate | Mất dữ liệu ghi sau backup (chỉ dùng cuối cùng) |

Không có bước hủy khả năng lùi trong v1.0.4: trường id cũ, index cũ và nhận `…Id` ở API **được giữ**.

#### 5.1.8 Thử trên bản sao dữ liệu thật (điều kiện mốc phát hành)

1. `devops-agent` xin Oniichan một bản `mongodump` production (hoặc dùng bản backup của `deploy.sh`), `mongorestore` vào Mongo replica set tạm (không đụng production).
2. Chạy `reconcile` dry-run rồi `up --apply` cho `007`, `008`, `009`; ghi số liệu báo cáo.
3. Chạy `up --apply` lần hai: mọi số đếm phải bằng 0 (chứng minh idempotent). Chạy lệnh bù: không thay đổi.
4. Kiểm bất biến 3.1 bằng truy vấn đếm; khởi động image v1.0.3 trên bản sao đã migrate và gọi thử danh sách khách, ghi nhật ký (chứng minh L1).
5. `qa-agent` review migration và kết quả; ghi vào tài liệu 06 mục A0.

#### 5.1.8a Quy tắc đọc khi bản ghi chưa có `…Code` (ghi kép, QA lượt 5, FR-40)

Trong thời gian chuyển tiếp (trước khi migration `007`/`008` backfill xong, hoặc bản ghi do image v1.0.3 ghi vào sau đó) một bản ghi có thể có `…Id` nhưng thiếu `…Code`. Mọi truy vấn LỌC/ĐẾM theo `code` phải có thêm nhánh song song theo id, nếu không bản ghi chưa backfill bị bỏ sót lặng lẽ:

- Điều kiện "thuộc nhóm tình trạng" của khách: `{ $or: [ { statusCode: { $in: codes } }, { statusCode: null, statusId: { $in: ids } } ] }`. `statusCode: null` khớp cả trường vắng lẫn `null`, nên khách đã backfill không bị đếm lặp bằng nhánh id (một khách chỉ khớp một nhánh). Điều kiện "KHÔNG thuộc nhóm" là phủ định chính xác bằng `$nor` của cùng hai nhánh (không dùng `$nin` đơn lẻ vì `$nin` khớp luôn bản ghi thiếu trường). Cài đặt dùng chung ở `common/utils/status-group-codes.util.ts` (`statusInRefsCondition`, `statusNotInRefsCondition`), áp dụng cho: tab và `statusCodes` của danh sách khách (`customer-list.service.ts`), việc hôm nay (`daily-tasks.service.ts`) và quét nhắc dịp/lâu chưa chăm sóc (`reminder-scanner.service.ts`). Nơi đã có một `$or` khác trong cùng bộ lọc (khách lâu chưa chăm sóc) thì gom bằng `$and` để hai `$or` không ghi đè nhau.
- Bộ lọc khách theo nguồn / dự án quan tâm / khu vực của danh sách và list-counts (`customer-list.service.ts`, khi client gửi `sourceCodes` / `projectCodes` / `areaCodes`): thêm nhánh id song song, id lấy từ MỘT lần `resolveByCodes` (không N+1). Nguồn: `{ $or: [ { sourceCode: { $in: codes } }, { sourceCode: null, sourceId: { $in: ids } } ] }`. Dự án (trường mảng): `{ $or: [ { interestedProjectCodes: { $in: codes } }, { interestedProjectCodes: { $in: [null, []] }, interestedProjectIds: { $in: ids } } ] }`; "chưa backfill" của mảng là `interestedProjectCodes` vắng, `null` hoặc rỗng, nên khách đã có ít nhất một mã chỉ khớp nhánh mã (không đếm lặp). Khu vực: mở rộng khu vực con qua `ancestorIds`, nhánh mã dùng `areaCode`, nhánh id dùng `areaId` của chính các khu vực đã mở rộng (khu vực con chưa có `code` chỉ còn nhánh id). Mã không tồn tại thì nhánh id rỗng, chỉ còn nhánh mã (không khớp ai, không lỗi). Cài đặt dùng chung ở `modules/crm/common/utils/ref-codes-condition.util.ts` (`refInCondition` cho trường đơn, `refArrayInCondition` cho trường mảng). Giữ nguyên 400 khi gửi cả id và code không cùng tập, và đường chỉ gửi `…Ids` (cũ) lọc thuần theo id. Các điều kiện này nằm trong `$and` của `buildFilter` nên không ghi đè `$or` khác.
- Bộ lọc `projectCode` của lịch hẹn (`appointments.service.ts`): `{ $or: [ { projectCode }, { projectCode: null, projectId } ] }` với `projectId` lấy từ một lần `resolveByCodes` (không N+1; khi client gửi cả `projectId` thì dùng lại id đã dịch).
- Đếm khách theo dự án (`CrmUsageService.countActiveCustomersByProjects`) đếm id-HOẶC-code và loại trùng bằng `$setUnion`; test khách có cả hai chỉ đếm một lần, khách thiếu một trong hai vẫn được đếm.
- Sửa lịch gửi lại đúng dự án đang lưu (`sameAsCurrent` ở `appointments-write.service.ts`) là "không đổi" ngay cả khi dự án đó đã xóa mềm hoặc không còn trong danh mục (xóa cứng ngoài ứng dụng): so với mã đã ghi kép trên lịch khi không dịch được id. Ứng dụng không có đường xóa cứng dự án (chỉ xóa mềm, chặn khi còn khách), và xóa mềm KHÔNG bị chặn bởi lịch hẹn, nên trường hợp này là bình thường chứ không hiếm.

#### 5.1.9 Ngoài v1.0.4 (ghi để không mất)

Bản thu hẹp (sau): bỏ nhận `…Id` ở API, gỡ trường id và index id cũ, `statusCode` thành bắt buộc; cần Oniichan duyệt riêng (Q3).

#### 5.1.10 Migration `009_notification_attachment_indexes` (index trên collection đã có dữ liệu, FR-03, FR-26)

Quyết định đã chốt: giữ nguyên tắc "mọi index mới trên collection đã có dữ liệu tạo bằng migration". `009` chỉ tạo index, không đổi dữ liệu:

| Collection | Index | FR |
|---|---|---|
| `notifications` | `{pushStatus:1, createdAt:1}`, partial `pushStatus = 'PENDING'` | FR-03 |
| `crm_attachments` | `{thumbStatus:1, createdAt:1}`, partial `thumbStatus != 'READY'` (khớp 3.3) | FR-26 |

Thứ tự migration của v1.0.4 (runner đăng ký tăng dần, mỗi cái idempotent):

| Số | Tên | Nội dung | Chạy sau | FR |
|---|---|---|---|---|
| `007` | `crm_catalog_codes` | Điền `…Code`, `areas.code` + index A0 (collection đã có dữ liệu) | (đầu tiên) | FR-40 |
| `008` | `crm_project_property_type_codes` | `propertyTypeCodes`, `unmappedPropertyTypes` | `007` | FR-46 |
| `009` | `notification_attachment_indexes` | Index `notifications`, `crm_attachments` | `007`, `008` | FR-03, FR-26 |

- Thứ tự: `009` chạy **sau `007` và `008`** (số đăng ký tăng dần trong runner). `validateMigrationRegistry` bắt buộc số liên tiếp từ 007 nên `009` chỉ đăng ký được sau khi `007` và `008` đã có trong registry: **không làm `009` song song với `007`/`008`**, và cả ba cùng sửa `migration.registry.ts` (làm tuần tự 007 → 008 → 009, cùng một coder). Cùng cơ chế `deploy.sh` bước 6b (SAU backup, TRƯỚC `up`).
- **Idempotent:** `createIndex` cùng tên và định nghĩa thì bỏ qua; có dry-run (`apply=false`) chỉ liệt kê index sẽ tạo.
- **Có `down`:** `dropIndex` hai index trên (an toàn vì chỉ thêm index; image cũ không dùng chúng).
- Partial index của `crm_attachments` dùng `thumbStatus != 'READY'` ở đây chỉ để khớp 3.3; nếu Mongo không hỗ trợ `$ne` trong `partialFilterExpression` thì coder dùng `thumbStatus: { $in: ['NONE','FAILED'] }` (ghi vào spec tích hợp). Dữ liệu cũ thiếu field `thumbStatus` vẫn được job bù xử lý bằng truy vấn riêng.
- Collection MỚI `push_subscriptions`, `push_deliveries`: index khai báo ở schema / `ensureIndexes` (5.6, 3.2), không thuộc `009`.
- Spec tích hợp theo khuôn `migrate-areas-to-34-provinces.integration.spec.ts` (chạy hai lần, `down`, dry-run).

### 5.2 FR-43 và FR-44: danh mục push và `NotificationDispatcher`

**Vị trí:** `modules/notifications/` (không phụ thuộc module CRM, như hiện nay).

| Thành phần | Trách nhiệm (Single Responsibility) | FR |
|---|---|---|
| `push/push-catalog.ts` | Hằng số cấu hình **đúng 4 loại**; mỗi dòng: `type`, `label`, `description`, `titleTemplate`, `bodyTemplate`, `allowedVars`, `deepLinkTemplate`, `defaultEnabled = true`, `canDisable = true`, `urgency`, `ttlSeconds`, `pushWhen(context)` (không có `groupedBodyTemplate`: đã quyết bỏ mẫu gộp, xem 9.1, 10.4). Thêm loại = thêm một dòng | FR-43 |
| `push/push-content.renderer.ts` (thuần) | Điền mẫu bằng **biến cho phép**, cắt độ dài (tiêu đề ≤ 50, nội dung ≤ 120, cắt tên dài thêm `…`), từ chối biến lạ, **quét PII** kết quả (xem 5.7) | FR-06 |
| `notification-dispatcher.service.ts` | Điểm vào duy nhất (FR-44): chuẩn hóa người nhận, tôn trọng `inApp`, ghi hộp thông báo, quyết `pushStatus`, đăng ký `afterCommit` xếp hàng | FR-44, FR-03 |
| `notifications.service.ts` | Giữ phần đọc/đánh dấu của hộp thông báo; `createMany` thành **nội bộ** (chỉ Dispatcher gọi) | FR-44 |

**"Yêu cầu thông báo" chuẩn** (FR-43, FR-44; `NotificationRequest`, kiểu nội bộ; tương lai MCP/API ngoài chỉ cần kiểm tra rồi gọi lại, không sửa bộ gửi):

| Trường | Ý nghĩa |
|---|---|
| `type` | `NotificationType` bất kỳ (loại có trong danh mục thì mới có push) |
| `recipientIds[]` | Người nhận; Dispatcher bỏ trùng, bỏ `excludeUserIds` (người thực hiện) |
| `inApp { title, body, priority? }` | Nội dung hộp thông báo (giữ như hiện nay, do nơi gọi dựng) |
| `vars` | Chỉ các biến cho phép: `customerName`, `actorName`, `appointmentTypeLabel`, `appointmentTimeLabel`, `newStatusLabel` (đúng danh sách của Plan; không biến nào khác) |
| `data { customerId?, appointmentId?, requestId?, deepLink }` | Như `notifications.data` |
| `context { careRole?, origin?, groupKey? }` | Dữ liệu để `pushWhen` quyết gửi push hay không (ví dụ `CUSTOMER_ASSIGNED`) và khóa gộp hàng loạt |
| `dedupeKey` | **Bắt buộc** (Plan mục 3 quy tắc 18); trùng `(userId, dedupeKey)` thì không tạo thông báo/push thứ hai |

Với nguồn bên ngoài sau này: **không** có đường nhập `title/body` tự do (mẫu thuộc danh mục); chỉ `type` thuộc danh mục + `vars` cho phép. Việc xác thực nguồn, giới hạn tần suất, danh sách loại cho phép nằm ở lớp MCP làm sau (Plan mục 1.3).

**Bốn dòng của danh mục (đồng bộ Plan mục 2.1.1):**

| `type` | Điều kiện có push `pushWhen` | Mẫu (tiêu đề / nội dung) | Deep link | Urgency, TTL | FR |
|---|---|---|---|---|---|
| `CUSTOMER_ASSIGNED` | `context.careRole === 'MEMBER'` **và** `context.origin !== 'CUSTOMER_CREATED'` (thêm vào nhóm làm người cùng phụ trách: thêm đơn, duyệt đề nghị, thêm hàng loạt). Không push khi được đặt làm phụ trách chính, tạo khách có phân người, "đổi phụ trách chính" hàng loạt | `Bạn được mời cùng phụ trách một khách` / `{tên người thực hiện} đã thêm bạn vào nhóm chăm sóc khách {tên khách}.` Thêm hàng loạt: giới hạn 3 push/người/đợt (xem 5.5; mẫu gộp chỉ làm nếu Oniichan duyệt Q5, mặc định KHÔNG làm) | `/crm/customers/:id` (từ `data.deepLink`) | normal, 24 giờ | FR-43 |
| `CARE_LOG_ADDED` | luôn | `Có nhật ký chăm sóc mới` / `{tên người viết} vừa ghi nhật ký cho khách {tên khách}.` | `/crm/customers/:id` | normal, 24 giờ | FR-43 |
| `APPOINTMENT_DUE` | luôn | `Sắp đến lịch hẹn` / `{tên loại lịch hẹn} với khách {tên khách} lúc {giờ hẹn}.` (`HH:mm dd/MM`, `Asia/Ho_Chi_Minh`) | `/crm/customers/:id` | high, 1 giờ | FR-43 |
| `CUSTOMER_STATUS_AUTO_CHANGED` | luôn | `Tình trạng khách tự thay đổi` / `Khách {tên khách} đã chuyển sang "{tình trạng mới}" theo tiến độ.` | `/crm/customers/:id` | normal, 24 giờ | FR-43 |

**Ánh xạ nguồn thông báo hiện có sang Dispatcher** (mọi nơi gọi `createMany`/`notifyAdmins` phải đổi; có test kiến trúc cấm gọi trực tiếp, FR-44):

| Nguồn (file) | `type` | `dedupeKey` | `context` / ghi chú | FR |
|---|---|---|---|---|
| `customers.service.ts` (tạo khách có phân người) | `CUSTOMER_ASSIGNED` | `ASSIGN:CREATE:{customerId}` | `origin = CUSTOMER_CREATED` (không push); in-app giữ nguyên | FR-44 |
| `care-team.service.ts` `notifyAssigned` (đường chung của thêm đơn, duyệt đề nghị, `ASSIGN` hàng loạt vì cả ba đều qua `applyInSession`) | `CUSTOMER_ASSIGNED` | `ASSIGN:ADD:{customerId}:{__v sau thay đổi}` | `careRole` lấy từ vai trò của người mới trong `change.careTeam`; `origin` thêm vào `CareTeamMutation` (`TEAM_ADD` / `REQUEST_APPROVED` / `BULK_ADD`); `groupKey = BULK:{X-Request-ID}` khi `BULK_ADD` | FR-43, FR-44 |
| `care-team-requests.service.ts` (`notifyReviewers`, `notifyRequester`) | `CARE_TEAM_JOIN_REQUESTED`, `CARE_TEAM_JOIN_RESOLVED` | `JOINREQ:{requestId}`, `JOINRES:{requestId}` | Không có push (ngoài danh mục) | FR-44 |
| `care-logs.service.ts` `notifyCareTeam` | `CARE_LOG_ADDED` | giữ `CARE_LOG:{customerId}:{bucket}`; khi gộp = 0 phút: `CARE_LOG:{customerId}:{careLogId}` | `vars.actorName = tên người viết`; một push cho mỗi thông báo đã gộp | FR-44 |
| `customer-criteria.service.ts` | `CUSTOMER_STATUS_AUTO_CHANGED` | `AUTOSTATUS:{customerId}:{version sau cùng}` | `vars.newStatusLabel` | FR-44 |
| `reminder-dispatch.service.ts` | `APPOINTMENT_DUE`, `FOLLOW_UP_DUE`, `CUSTOMER_OCCASION`, `STALE_CUSTOMER` | giữ `reminder.dedupeKey` | Chỉ `APPOINTMENT_DUE` có push; `vars.appointmentTypeLabel`, `appointmentTimeLabel` | FR-44 |
| `crm-abuse-monitor.service.ts` (`notifyAdmins`) | `SECURITY_ALERT` | giữ `ALERT:...` | Không push (ngoài danh mục); `notifyAdmins` đi qua Dispatcher | FR-44 |

### 5.3 `afterCommit` và job quét `push.sweep` (FR-03)

- `shared/database/after-commit.util.ts`: `registerAfterCommit(session, fn)`; `withTransaction` được sửa để (a) xóa danh sách hàm đã đăng ký **ở đầu mỗi lần chạy `work`** (vì `connection.transaction` có thể retry `work`), (b) sau khi transaction **commit thành công** thì chạy lần lượt các hàm, mỗi hàm bọc `try/catch` (ghi log cảnh báo, không bao giờ ném). Nếu `session` không do `withTransaction` tạo (không có trong bảng theo dõi, ví dụ gọi không transaction) thì chạy ngay.
- Hàm đăng ký làm đúng một việc: `queue.add('push.send', { notificationId }, { jobId: pushSendJobId(notificationId) })` qua `QueueRuntimeService.add`. Lỗi Redis chỉ ghi log; thông báo vẫn `PENDING`.
- **`push.sweep` (job lặp mỗi 60 giây, `upsertSchedulers`)**: lấy tối đa 200 thông báo `pushStatus = PENDING`, `createdAt < now - 30 giây`, xếp hàng lại với **cùng `jobId`** (`push-{id}`, qua chính hàm `pushSendJobId`) (BullMQ bỏ qua nếu đã có). Thông báo `PENDING` quá hạn TTL của loại (`ttlSeconds`) chuyển `SKIPPED` (không gửi nhắc đã cũ). Cờ tắt thì chuyển `SKIPPED` (xem 5.4).
- Rủi ro đã kiểm: Redis chết lúc commit, instance chết giữa chừng, retry `work` của transaction: không mất push, không gửi cho transaction bị rollback (vì chưa có hàng đợi và bản ghi `PENDING` rollback cùng transaction).

### 5.4 FR-02, FR-03, FR-04: `WebPushProvider`, worker `push.send`, retry

| Mục | Thiết kế | FR |
|---|---|---|
| Giao diện | `PushProvider` mở rộng: `isEnabled()`, `initialStatus()` (giữ) và `send(subscription, payload, options): Promise<PushSendResult>`; `PushSendResult` = `{ outcome: 'SENT' \| 'GONE' \| 'PERMANENT' \| 'TRANSIENT', statusCode? }` | FR-02 |
| Chọn provider | Factory của `PUSH_PROVIDER`: cờ `FEATURE_CRM_PUSH` bật **và** đủ `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` hợp lệ (`mailto:` hoặc `https:`) thì `WebPushProvider`; ngược lại `NoopPushProvider` (kèm log ERROR một lần nếu cờ bật mà thiếu biến). **Thống nhất hai thời điểm đọc cờ (L6):** (a) **factory chọn provider một lần lúc khởi động** (đọc `FEATURE_CRM_PUSH` + `VAPID_*` từ môi trường); (b) `WebPushProvider.isEnabled()`/worker/Dispatcher **kiểm lại cờ mỗi lần gọi** (`FeatureFlagService`) như hiện nay, để khi cờ bị coi là tắt trong cùng tiến trình thì mọi thông báo `PENDING` thành `SKIPPED`. Hệ quả vận hành: **đổi biến môi trường (bật/tắt cờ, đổi `VAPID_*`) phải chạy `docker compose up -d backend`** (tạo lại container, vài giây) mới có hiệu lực: biến môi trường của container không đổi khi tiến trình đang chạy, nên "đọc mỗi lần gọi" chỉ có nghĩa với nguồn cờ có thể đổi lúc chạy (nếu có), không thay thế bước tạo lại container. Chuyển từ Noop sang WebPush (hoặc ngược lại) luôn cần khởi động lại. Runbook ghi đúng lệnh này | FR-02, FR-07 |
| Gửi | Thư viện `web-push`; tùy chọn `timeout: 5000` ms, `TTL` và `urgency` từ danh mục, `topic` = id thông báo rút gọn (Web Push `Topic`, ≤ 32 ký tự base64url) để bản trùng thay thế bản chờ; payload JSON `{ title, body, url, tag, type }` (< 1 KB, mã hóa `aes128gcm` bởi thư viện) | FR-02, FR-06 |
| Phân loại kết quả | 201: `SENT`. **404, 410: `GONE`** (thu hồi `revokedReason = GONE`, không retry, các subscription khác vẫn gửi). 400, 401, 403, 413: `PERMANENT` (khóa/payload sai; `FAILED` cho subscription này, log ERROR một lần, không retry). 429, 5xx, timeout, lỗi mạng: `TRANSIENT` (ném lỗi để BullMQ retry, tôn trọng `Retry-After` nếu có thì chỉ ghi log) | FR-02, FR-04 |
| Worker (`push-delivery.processor.ts`) | Queue `push` (`QueueNames.PUSH`), concurrency 5, `limiter` 50 job/giây (thêm tùy chọn `limiter` vào `QueueRuntimeService.registerWorker`, thêm không phá cũ). Mỗi job `push.send` theo thứ tự: (1) cờ tắt → `SKIPPED`, dừng; (2) đọc thông báo, không còn `PENDING` → dừng (idempotent); (3) người nhận không còn `ACTIVE` hoặc đã xóa → `SKIPPED` + thu hồi subscription; (4) `notification_preferences.types[type].push === false` → `SKIPPED`; (5) **giờ yên lặng** của người nhận (múi `Asia/Ho_Chi_Minh`, `start` bao gồm, `end` không bao gồm, hỗ trợ qua nửa đêm; mặc định tắt) đang bật và đang trong khung → `SKIPPED`; (6) lấy subscription hiệu lực (tối đa 3), không có → `SKIPPED`; (7) mỗi subscription: claim `push_deliveries` bằng upsert nguyên tử (đã `SENT`/`GONE` thì bỏ qua), gọi `send`, cập nhật; (8) tổng hợp: có ít nhất một `SENT` → `pushStatus = SENT`, `pushSentAt`; tất cả `GONE`/không còn → `SKIPPED`; còn `TRANSIENT` → ném lỗi (BullMQ retry, chỉ những subscription chưa xong được làm lại nhờ `push_deliveries`); (9) hết lần retry → `FAILED` (cập nhật có điều kiện `pushStatus = PENDING`) | FR-03, FR-04 |
| Retry | Job `attempts: 5`, `backoff: { type: 'exponential', delay: 5000, jitter: 0.5 }` (đặt riêng cho queue `push`, mặc định chung là 3 lần/1 giây) | FR-03 |
| Chống trùng | Ba lớp ở D3; thêm `tag = notificationId` ở service worker. Cửa sổ rủi ro còn lại: gửi thành công nhưng chết trước khi ghi `SENT` → retry gửi lần hai cùng `Topic`/`tag` nên người dùng chỉ thấy một thông báo | FR-03, FR-12 |
| Không chặn nghiệp vụ | Push hoàn toàn nằm sau commit; mọi lỗi ở Dispatcher phần xếp hàng chỉ log; worker lỗi không ảnh hưởng request | FR-03 |
| Log | Chỉ ghi `notificationId`, `subscriptionId`, `endpointHash`, mã kết quả, `X-Request-ID`/`jobId`; **không** ghi `endpoint` thô, payload, tên khách (đồng thời đi qua bộ che PII của FR-15) | FR-03, FR-15 |

### 5.5 Giờ yên lặng, tùy chọn từng loại, gộp push hàng loạt (FR-03, FR-10, FR-43)

- **Giờ yên lặng:** hàm thuần `isInQuietHours(nowVnHHmm, quietHours)` đặt cạnh `notification-preference.rules.ts` (đã có `isValidQuietHours`); xét tại **thời điểm worker xử lý lần đầu**. Mặc định `quietHours = null` (không yên lặng); không loại nào được ngoại lệ.
- **Tắt từng loại:** `types[type].push` (mặc định `true`). Dispatcher đã đặt `SKIPPED` ngay khi ghi nếu người nhận tắt `push` (đỡ một job); worker kiểm lại vì cài đặt có thể đổi trong lúc chờ. Lưu ý: tắt `inApp` thì không có cả thông báo lẫn push (push đi theo thông báo gốc); trang cài đặt chỉ chỉnh `push` nên không gặp trường hợp này, ghi vào mô tả API.
- **Chống "bão thông báo" khi thêm hàng loạt người cùng chăm sóc** (Plan rủi ro 7): `ASSIGN` hàng loạt chạy mỗi khách một transaction nên cùng một người có thể nhận N thông báo. Giải pháp **mặc định (không thêm mẫu mới, nằm trong 4 mẫu của Plan): giới hạn**. Khi `origin = BULK_ADD`, Dispatcher đặt `pushGroupKey = BULK:{X-Request-ID}`; worker, trước khi gửi, tăng bộ đếm Redis nguyên tử `push:group:{userId}:{groupKey}` (`INCR` kèm `EXPIRE` 10 phút, dùng `REDIS_CLIENT` sẵn có): **tối đa 3 push cho mỗi (người, đợt hàng loạt)**, các thông báo vượt hạn mức chuyển `SKIPPED` (vẫn nằm trong hộp thông báo). Tương tự mọi loại khác: mỗi người tối đa một push cho mỗi thông báo gốc, và nhật ký đã gộp theo `careLogNotifyDebounceMinutes`. **Tùy chọn cần Oniichan duyệt (Q5):** gửi đúng **một** push theo mẫu gộp có nội dung cố định không biến (`Bạn được thêm vào nhóm chăm sóc của nhiều khách.`), cần job trễ ~20 giây để đếm; mẫu này là chuỗi thứ năm ngoài danh sách 4 mẫu của Plan nên chưa làm khi chưa duyệt.

### 5.6 FR-01, FR-05: đăng ký, giới hạn 3 thiết bị, dọn 90 ngày

| Mục | Thiết kế | FR |
|---|---|---|
| Module (index: schema Mongoose/`ensureIndexes`, không qua migration vì collection mới, 5.1.10) | `PushSubscriptionsModule` trong `modules/notifications/push/` gồm `push-subscriptions.controller.ts`, `push-subscriptions.service.ts`, `push-subscriptions.repository`, DTO, schema, `push-endpoint.policy.ts` (allowlist host: Google/FCM, Mozilla autopush, Apple `*.push.apple.com`, Microsoft `*.notify.windows.com`; chỉnh được bằng biến `PUSH_ENDPOINT_HOST_ALLOWLIST` nếu một nhà cung cấp đổi tên miền) | FR-01 |
| Đăng ký (upsert) | `findOneAndUpdate({ endpoint }, { $set: { userId, keys, lastSeenAt: now, revokedAt: null, revokedReason: null, purgeAt: null, ...nhãn thiết bị }, $setOnInsert: { createdAt } }, { upsert })`; đua hai yêu cầu cùng endpoint: bắt E11000 và thử lại một lần | FR-01 |
| Giới hạn 3 | Sau khi lưu, `enforceLimit(userId)`: lấy subscription hiệu lực của người đó sắp theo `lastSeenAt` giảm dần, thu hồi mọi cái từ thứ 4 trở đi (`LIMIT_EXCEEDED`, `purgeAt = now + 7 ngày`). Hội tụ đúng dù hai yêu cầu đồng thời (mỗi lần đều thi hành lại); đăng ký lại cùng endpoint (upsert) không tạo thiết bị mới; người khác không bị ảnh hưởng. Cái vừa đăng ký có `lastSeenAt` mới nhất nên không bao giờ bị gỡ | FR-01 |
| "Hoạt động" | Xem định nghĩa ở 3.2: `POST` (đăng ký/làm mới, FE gọi tối đa 1 lần/24 giờ khi mở PWA đã cài và quyền đang `granted`) hoặc gửi thành công | FR-01, FR-05 |
| Hủy / đăng xuất | `DELETE /push-subscriptions/:id` (Self, người khác 404); `POST /auth/logout` kèm `pushSubscriptionId` của chính mình | FR-01 |
| Job `push.cleanup` | Job lặp mỗi 6 giờ (idempotent, `upsertSchedulers`): (a) **xóa cứng** subscription `lastSeenAt < now - 90 ngày` (ca biên chốt: **đúng 90 ngày còn, quá 90 ngày thì xóa**; test 89, 90, 91 ngày), (b) thu hồi subscription có `expirationTime < now` (`GONE`), (c) thu hồi subscription của người không còn `ACTIVE`/đã xóa (`ACCOUNT_DISABLED`). Bản đã thu hồi do TTL index `purgeAt` tự xóa sau 7 ngày. Chạy lại không gây lỗi hay xóa thừa. Xóa cứng là dữ liệu kỹ thuật (đã có tiền lệ TTL của `notifications`), ghi rõ ở mục 7 | FR-05 |
| Khóa tài khoản | Worker kiểm trạng thái người nhận (5.4); `UsersService` khi khóa/xóa người dùng gọi `revokeAllForUser` (đường phụ, không bắt buộc cho đúng đắn) | FR-01 |

### 5.7 FR-06: nội dung push an toàn PII

- Chỉ `push-content.renderer.ts` dựng nội dung: mẫu cố định + biến cho phép. **Quét hậu kiểm** kết quả: nếu khớp mẫu email, số điện thoại VN, dãy 9–12 chữ số liền (CCCD/CMND) thì **thay bằng nội dung chung** `Bạn có thông báo mới` + `url` gốc, ghi log ERROR (không kèm nội dung). Đây là lớp phòng thủ thứ hai; lớp thứ nhất là danh sách biến đóng. **Chuỗi `Bạn có thông báo mới` chỉ là lưới an toàn kỹ thuật** (cũng dùng cho `parsePushPayload` ở service worker khi payload sai định dạng), **không phải mẫu thứ năm** của danh mục (FR-43 / Plan 2.1.1 và FR-06 giữ danh sách đóng 4 loại, 4 mẫu); chỉ xuất hiện khi lớp thứ nhất lỗi. Mặc định đã chọn và lý do: xem Q12.
- `{tên khách}` là biến duy nhất mang dữ liệu khách (Oniichan đã chấp nhận hiện trên màn khóa). Không biến nào lấy từ `title/địa điểm/ghi chú` lịch hẹn, nội dung nhật ký, lời nhắn, kết quả liên hệ. `{tên loại lịch hẹn}` lấy từ bản đồ nhãn theo `AppointmentType`.
- `url` luôn là đường dẫn nội bộ bắt đầu bằng `/` (không `//`), dựng từ mẫu và id (ObjectId hợp lệ).
- Test quét cả 4 mẫu với bộ dữ liệu "bẫy" (tên chứa số điện thoại, email, dãy 12 số) và test payload thật (FR-12).

### 5.8 FR-07: cấu hình, bí mật, cờ

| Mục | Thiết kế | FR |
|---|---|---|
| Biến mới (backend) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (bí mật), `VAPID_SUBJECT` (giá trị đã chốt: địa chỉ `mailto:` của STND trong Plan), `PUSH_ENDPOINT_HOST_ALLOWLIST` (tùy chọn). Tên chính xác do `devops-agent` chốt | FR-07 |
| Cấu hình cho FE | `GET /push-subscriptions/config` trả `publicKey = null` khi `enabled = false`; khóa công khai chỉ được trả khi `enabled = true` | FR-07, FR-09 |
| Compose | `docker-compose.yml` đổi `FEATURE_CRM_PUSH=false` (dòng 248, đang cứng) thành `FEATURE_CRM_PUSH=${CRM_PUSH_ENABLED:-false}`; chuyển `VAPID_*` từ `.env.docker` vào service `backend` qua `environment` (không vào `build.args`, không vào image) | FR-07 |
| `.env.docker.example` | Thêm `CRM_PUSH_ENABLED=false`, `VAPID_PUBLIC_KEY=`, `VAPID_PRIVATE_KEY=`, `VAPID_SUBJECT=` (để trống/ví dụ, không giá trị thật), kèm chú thích "tạo khóa một lần" | FR-07, FR-13 |
| FE | **Không** cần biến build: khóa công khai lấy lúc chạy từ `GET /push-subscriptions/config` | FR-07, FR-09 |
| Quay lui nhanh | Đặt `CRM_PUSH_ENABLED=false` trong `.env.docker` rồi `docker compose up -d backend` (vài giây, không build, không đổi code); worker thấy cờ tắt thì mọi job `PENDING` thành `SKIPPED` | FR-07, FR-08 |
| Health | Không thêm probe mới (không có dịch vụ hạ tầng mới). Lỗi dịch vụ push không ảnh hưởng `/health/readiness`; readiness hiện có đã kiểm Redis (đường xếp hàng) | FR-07 |
| Phụ thuộc mới | `web-push` (+ `@types/web-push`); `npm audit` bởi `devops-agent` trước khi hợp nhất (Q9) | FR-02 |

### 5.9 Nhóm sửa lỗi: file bị đụng, cách sửa, rủi ro hồi quy, test

| FR | File / module bị đụng | Cách sửa (thiết kế) | Rủi ro hồi quy | Loại test | 
|---|---|---|---|---|
| FR-14 | Mới: `common/security/nosql-operator.interceptor.ts` đăng ký `APP_INTERCEPTOR` ở `app.module.ts`; `news-fire-crawl-manager` controller + service (`backfillEmbeddings` body inline, `crawlConfig`, `articles`); `knowledge-articles` nếu có body tự do | (i) Interceptor toàn cục duyệt đệ quy `body`, `query`, `params` (độ sâu ≤ 10), từ chối khóa bắt đầu bằng `$` hoặc là `__proto__`/`constructor`, và (chỉ với `query`/`params`) khóa chứa `.` hoặc dạng `a[$...]`; bỏ qua yêu cầu `multipart`. Chạy sau guard, **trước** `ValidationPipe`. (ii) Điểm lọt DTO: `backfillEmbeddings` thành DTO có `@IsInt @Min @Max`; `crawlConfig`/`articles` truy vết xem có vào filter Mongo không: có thì whitelist khóa/ép kiểu, không thì ghi kết quả kiểm vào tài liệu. **Không** bật `mongoose.set('sanitizeFilter')` toàn cục (phá mọi truy vấn nội bộ có `$in`/`$ne`) | Thấp–vừa: payload hợp lệ có khóa bắt đầu `$` (không có trong FE hiện tại); khóa chứa `.` ở body không bị chặn để không vỡ `crawlConfig` | Unit interceptor (lồng sâu, mảng, multipart, độ sâu); integration cho `GET /crm/customers` (`q`, `statusIds`, `tagIds`...), body POST/PATCH khách, nhật ký, lịch hẹn, thẻ, danh mục; ba điểm lọt DTO; chạy lại 5 điểm đã có 400 |
| FR-15 | `common/logger/custom-logger.service.ts`, `winston.config.ts`, mới `common/logger/pii-redactor.util.ts` | Hàm thuần `redactPii(text)` (email → `[EMAIL]`; số điện thoại VN `0xxxxxxxxx`/`+84…`/có dấu cách chấm gạch → `[PHONE]`; dãy 12 chữ số (CCCD) và 9 chữ số liền khi đứng riêng → `[NATIONAL_ID]`; khối `dup key: {...}` của E11000 → `dup key: {[REDACTED]}`). Áp trong `CustomLogger` ở **một cửa**: kết quả `prependCallerInfo` và **mọi tham số phụ chuỗi** (stack truyền ở tham số thứ hai của `error`) trước `super.*` và `forwardToFile`; thêm lớp `winston.format` ở `createAppFileLogger` làm tuyến hai | False positive (ObjectId 24 hex, timestamp 13 số, mã số khác) làm mờ log gỡ lỗi: dùng biên chữ số `(?<!\d)…(?!\d)` và test mẫu không bị che | Unit bảng (SĐT các dạng, email, CCCD, E11000 thật, stack có `cause`, object JSON, tham số phụ); test không che ObjectId/timestamp; test log của luồng push (FR-03) không chứa PII | 
| FR-16 | `modules/crm/customers/customer-list.service.ts` (`listDeleted`) | Gọi `await this.guardSearch(jwt, query.q)` ngay sau `access.resolve` như `list` và `counts` (cùng giới hạn 30/phút và theo dõi dò SĐT) | Thấp (chỉ Quản trị dùng); làm **trước** A0 vì cùng file với thay đổi lọc | Unit/integration: tìm SĐT từng phần bị chặn như endpoint khác, lượt thứ 31/phút trả 429 | 
| FR-21 | `modules/knowledge-articles/knowledge-articles.controller.ts`, `modules/external-log/controllers/external-log.controller.ts`, endpoint cron/cài đặt ở `news-fire-crawl-manager` và `settings` (route chỉ `ADMIN`); 7 controller GET danh mục CRM; `common/guards/role-coverage.audit.spec.ts` | Route chỉ ADMIN: thay `@Roles(UserRole.ADMIN)` bằng `@AdminOnly()` (đã có: `@Roles` + `ActiveAdminGuard` đọc DB) và import `CrmCommonModule` vào module chứa controller (hoặc nâng `CrmActorService`/`ActiveAdminGuard` lên `common/access`, coder chọn cách ít cạnh phụ thuộc). Route `@Roles(ADMIN, EDITOR)` **không đổi** (EDITOR không thuộc DB-CRM). GET danh mục CRM: decorator mới `@ActiveCrmUser()` (guard `ActiveCrmUserGuard` dùng `CrmActorService.resolve`: 401 nếu không còn ACTIVE; 403 nếu mất vai trò CRM). Một truy vấn theo `_id` mỗi request | Vừa: thêm một lần đọc DB cho mỗi GET danh mục; 401 bất ngờ với tài khoản vừa bị khóa (đúng mong muốn). Cần cập nhật bộ kiểm "role coverage" | Unit guard; integration: khóa người dùng khi JWT còn hạn → 401; hạ vai trò → 403; EDITOR vẫn vào route EDITOR | 
| FR-22 | `modules/users/users.service.ts` (`create`, cả hai nhánh có và không có `teamIds`) | Bắt `isDuplicateKeyError` (đã có `common/utils/mongo-error.util.ts`) quanh `create` và trả `ConflictException(EMAIL_IN_USE_MESSAGE)` giống nhánh kiểm trước. Chỉ `POST /users` (phạm vi thu hẹp) | Thấp | Integration (replica set trong bộ nhớ): hai `POST /users` đồng thời cùng email → đúng một 201, một 409, không 500 | 
| FR-25 | `modules/notifications/notifications.service.ts` (nay do Dispatcher gọi), spec mới | **Chỉ là test** trước: chạy song song nhiều `createMany` cùng `(userId, dedupeKey)` (và hai khóa khác nhau) trong và ngoài transaction. Nếu E11000 xuất hiện thật (upsert đua trên unique index là hành vi đã biết của MongoDB) thì bọc `bulkWrite` bằng thử lại một lần khi `isDuplicateKeyError`; nếu không thì ghi kết quả vào tài liệu 06 và đóng (trạng thái `Không cần`) | Thấp | Integration đồng thời (≥ 50 lần song song); kết quả quyết định có sửa code không | 
| FR-26 | `care-log-attachments.service.ts`, `care-log.mapper.ts` (+ nơi dựng `urls`), `schemas/crm-attachment.schema.ts`, `attachment-cleanup.service.ts`, `shared/queue/queue.constants.ts`, `shared/storage/file-storage.service.ts` (đã có `download`), mới `care-logs/attachment-thumbnail.processor.ts`, `package.json` (`sharp`) | Xem 5.9.1 | Vừa: thư viện native trong Docker, bộ nhớ khi xử lý ảnh; thumbnail mồ côi nếu quên xóa | Unit với ảnh mẫu nhỏ thật; integration với kho lưu trữ giả; test mapper fallback `thumbUrl = url`; test xóa cả `thumbKey` khi dọn/purge |
| FR-29 | `docs/06_Module_Customer_Management/04_*.md` (mục 139, 362, 733–747, 822, 918, 984), `06_*.md` | **Chỉ sửa tài liệu** theo (a)–(e) của Plan; (a) cập nhật theo kết quả FR-26 (nếu thumbnail xong thì mô tả `ImageProcessor` thành đúng, chỉ đối chiếu lại tên lớp/queue); bảng 04 mục 2.3, 3.6, 6.3, 10, 11 cũng do FR-13 sửa | Không có rủi ro code | `qa-agent` đối chiếu từng mục, có đối chiếu code | 

#### 5.9.1 FR-26: thumbnail ảnh đính kèm (đồng bộ hay hàng đợi, MinIO, URL ký, dữ liệu cũ)

- **Chọn: hàng đợi** (BullMQ queue `crm-image`, job `attachment.thumbnail`, `jobId = thumb:{attachmentId}`, 3 lần retry): skill yêu cầu xử lý ảnh tách khỏi luồng chính; upload vẫn trả ngay `READY` như hợp đồng hiện nay nên FE không đổi. Xếp hàng sau `withTransaction` của `upload` (hoặc `afterCommit`); lỗi xếp hàng chỉ log.
- **Thư viện: `sharp`** (có binary dựng sẵn cho Node 24 trên Debian slim; nhanh, an toàn bộ nhớ hơn lựa chọn JS thuần). Cấu hình `limitInputPixels`, `sharp.concurrency(1)`, tắt cache; worker concurrency 2 (Q9).
- **Quy trình worker:** tải ảnh gốc từ MinIO (`FileStorageService.download`) → `resize` cạnh dài tối đa 320 px (`fit: inside`, không phóng to), xuất WebP chất lượng ~75, **không giữ metadata** → tải lên cùng bucket `crm-attachments`, khóa UUID mới dưới tiền tố khách → cập nhật có điều kiện `thumbKey: null` → `thumbKey`, `thumbStatus = READY`, `width`, `height` của ảnh gốc. Hết 3 lần: `thumbStatus = FAILED` (ảnh vẫn dùng được, `thumbUrl = url`).
- **URL ký sẵn:** mapper dựng thêm bản đồ URL ký cho `thumbKey` cùng TTL với URL ảnh gốc (`S3_SIGNED_URL_TTL_SECONDS`); `thumbUrl = thumbKey ? urlKý(thumbKey) : url`. Hợp đồng API không đổi.
- **Dữ liệu cũ:** ảnh bật từ 2026-11-02 có `thumbKey = null`. Bước "bù thumbnail" thêm vào job `attachments.cleanup` hiện có (mỗi giờ): lấy tối đa 200 ảnh `READY`/`ATTACHED` chưa có `thumbKey` và `thumbStatus` khác `FAILED`, xếp hàng lại; chạy lặp tới hết, idempotent. Không cần migration.
- **MinIO/dọn dẹp:** `attachment-cleanup.service` (hiện không nhắc `thumbKey`) và `customer-purge.service` (đã xóa) phải xóa **cả `thumbKey`** khi gỡ/dọn ảnh; thêm test.

### 5.10 FR-08, FR-12, FR-13: runbook, bộ test, tài liệu

| FR | Phạm vi | Nơi ghi |
|---|---|---|
| FR-08 | Runbook: tạo cặp khóa VAPID **một lần** (lệnh sinh khóa của thư viện, chạy trên VPS hoặc máy tin cậy, **không** dán khóa riêng vào chat/repo), đặt `VAPID_*` và `CRM_PUSH_ENABLED` vào `.env.docker` (chmod 600), lưu khóa riêng ở trình quản lý mật khẩu, kiểm `GET /push-subscriptions/config`, thử gửi 1 push bằng thao tác thật (dùng một tài khoản thử: phân một khách cho tài khoản đó làm người cùng phụ trách; không có endpoint "Gửi thử", xem Q11), **tắt khẩn cấp** (5.8), **xoay khóa** và hệ quả (mọi subscription cũ mất hiệu lực, người dùng bật lại), thứ tự bật production (xong FR-14, 15, 16 trước), lệnh bù `crm-catalog-codes` sau `up`, kiểm tay IP thật cloudflared (FR-23) và dự án trùng (FR-35) | `docs/01_Infrastructure/06_Production_Deploy.md` (mục mới "Web Push VAPID"), `devops-agent` làm theo thử trên bản sạch |
| FR-12 | Bộ test và nghiệm thu M7 (xem mục 9): unit + integration với dịch vụ push **giả** (cổng `PushProvider` đưa kết quả `SENT`/`GONE`/`PERMANENT`/`TRANSIENT`); E2E chống trùng khi restart (hai worker + dừng giữa chừng); thử thật iPhone và Android sau khi bật cờ ở production (ghi kết quả vào runbook) | Cạnh code (`*.spec.ts`), tài liệu 06 mục M7 |
| FR-13 | Cập nhật: 04 (mục 2.3, 3.6, 6.3, 10, 11: thay FCM/`device_tokens` bằng Web Push VAPID/`push_subscriptions`; thêm danh mục push và Dispatcher), 05 (mục 2.10: `/push-subscriptions`, `/notification-preferences/me` có `pushTypes`, ghi chú xuất file cần `code`+`label`), 06 (bảng milestone M7, dòng Firebase/APNs ở "Việc Oniichan chuẩn bị"), `06_Production_Deploy.md`, `.env.docker.example`, `README.md` thư mục phiên bản | Các file nêu trên |

## 6. Frontend

> `RealEstateAdminApp/src`. Quy ước: dữ liệu từ API đi qua **React Query** (không `useEffect` để gọi API); `useState` cho trạng thái cục bộ (mở/đóng, giá trị ô nhập); Zustand chỉ dùng chỗ đã có (`auth.store`). Hook/query key mới đặt trong lớp `modules/crm/api` hiện có (`queries.ts`, `hooks.ts`, `http/*`) theo đúng khuôn từng hook đang dùng; mọi chữ hiển thị tiếng Việt.

### 6.1 A0: danh mục theo `code` (FR-40, FR-46)

| Thành phần | Việc | State | FR |
|---|---|---|---|
| Lớp adapter `modules/crm/api/http/` (`catalogMappers`, `customerApi`, `customerQuery`, `careApi`, `schedulingApi`, `projectBody`, `adminApi`) | "id" của tình trạng, nguồn, khu vực, dự án, kết quả liên hệ trong kiểu FE = `code` của BE; gửi `…Code`/`…Codes`, đọc `code` từ response; kiểu FE và các màn giữ nguyên nên `<option value>` tự là `code` | Server state (React Query) | FR-40 |
| `modules/crm/store/crmStorage*` | Nâng phiên bản lưu cục bộ, bỏ bộ lọc/ưu tiên lưu theo id cũ (không mang sang), có test migration lưu trữ | Cục bộ (`localStorage`) | FR-40 |
| `mockCrmApi`, `data/seedCatalogs.ts`, `data/mockData.ts`, `test/customerFactory.ts` | Id mẫu đổi sang `code` để mock và test khớp | | FR-40 |
| `screens/Settings/components/ProjectsCatalogSection.tsx`, `components/form/ProjectFormFields.tsx` | Ô "loại hình": **ô chọn nhiều** lấy lựa chọn từ `GET /crm/persona-fields` (trường `property_type`, kể cả lựa chọn đã tắt chỉ hiện nếu dự án đang dùng); hiện cảnh báo + chip cho `unmappedPropertyTypes` để Quản trị chọn lại; ô khu vực dùng `areaCode`; mã dự án chỉ đọc khi sửa (Q1) | Form cục bộ + React Query (`persona-fields`) | FR-46, FR-40 |
| `lib/customerFilters.ts`, `screens/Customers/components/CustomerToolbar.tsx` | Tham số lọc gửi `statusCodes`, `sourceCodes`, `areaCodes`, `projectCodes` | | FR-40 |

### 6.2 M7 Web Push phía web admin PWA (FR-09, FR-10, FR-43)

**Service worker** (`src/pwa/sw.ts`, giữ `tsconfig.sw.json`; thêm file thuần mới `src/pwa/pushPayload.ts` vào `include` của `tsconfig.sw.json` để kiểm kiểu và để vitest kiểm được, giống `serviceWorkerConfig.ts`):

| Sự kiện | Hành vi | FR |
|---|---|---|
| `push` | Đọc JSON `{ title, body, url, tag, type }` bằng hàm thuần `parsePushPayload` (sai định dạng thì dùng nội dung chung `Bạn có thông báo mới`); **luôn** `showNotification` (không bao giờ push im lặng, iOS sẽ thu hồi subscription); `tag` = id thông báo (thay thế bản trùng), `icon` `pwa-192x192.png`, `data.url`. Không cache, không chạm `/api` (ràng buộc PT-030 giữ nguyên) | FR-09 |
| `notificationclick` | Đóng thông báo; `url` phải là đường dẫn nội bộ (bắt đầu `/`, không `//`), sai thì về `/`; có cửa sổ đang mở thì `focus()` + `navigate(url)` (hoặc `postMessage` cho app tự điều hướng bằng router), không có thì `clients.openWindow(url)`. API vẫn kiểm quyền/phạm vi khi trang tải (khách ngoài phạm vi 404) | FR-09 |
| Cập nhật | Bản service worker có xử lý push chỉ có hiệu lực khi người dùng bấm "Cập nhật" (chế độ prompt sẵn có): ghi trong runbook; thiết bị chưa cập nhật chưa hiện được push | FR-09 |

**Trang "Cài đặt thông báo" cá nhân (mới)**: `modules/crm/screens/NotificationSettings/` (`index.tsx` + `useNotificationSettings.ts`), route `/notification-settings` (cạnh `/notifications`), liên kết từ menu người dùng và từ màn Thông báo.

| Khối | Nội dung | State | FR |
|---|---|---|---|
| Thiết bị này | Máy trạng thái của thiết bị: `unsupported` (thiếu `serviceWorker`/`PushManager`), `needs-install` (iPhone chưa chạy ở chế độ standalone: **không hiện nút**, hiện hướng dẫn "Thêm vào Màn hình chính" tái dùng `IosInstallHint`), `blocked` (quyền `denied`: hướng dẫn mở lại, không xin lặp), `ready` (hiện nút **Bật thông báo**, xin quyền chỉ sau thao tác bấm), `subscribed` (hiện **Tắt**; không có nút "Gửi thử", xem Q11). Chỉ hiện nút bật khi `GET /push-subscriptions/config` có `enabled = true`. Khi `granted` và đã có subscription: gọi `POST /push-subscriptions` tối đa 1 lần/24 giờ (làm tươi `lastSeenAt`); id subscription lưu `localStorage` để đăng xuất kèm id | Cục bộ (`useState`/máy trạng thái) + React Query (`push-subscriptions`) | FR-09 |
| Danh sách thiết bị | Từ `GET /push-subscriptions`: thiết bị đang bật (tên, lần dùng gần nhất, nút gỡ) và **thông báo đã gỡ để nhường chỗ** (từ `recentlyRevoked` với `reason = LIMIT_EXCEEDED`, ví dụ "Đã gỡ iPhone · Safari để nhường chỗ"); nhắc tối đa 3 thiết bị | Server state | FR-01, FR-09 |
| Loại thông báo | Công tắc **Thông báo đẩy** cho **từng loại lấy từ `pushTypes`** của `GET /notification-preferences/me` (4 loại, nhãn và mô tả từ danh mục, không hard-code); lưu bằng `PUT /notification-preferences/me` (optimistic UI, hoàn tác khi lỗi) | Server state | FR-10, FR-43 |
| Giờ yên lặng | Công tắc bật/tắt (mặc định tắt) + chọn giờ bắt đầu/kết thúc (cho phép qua nửa đêm, ví dụ 22:00 đến 06:00), múi giờ ghi chú "giờ Việt Nam"; `start ≠ end`; bỏ ghi chú "chưa có hiệu lực" nếu còn | Form cục bộ + server | FR-10 |

Test (vitest): `parsePushPayload`, chuẩn hóa `url`, máy trạng thái (iOS chưa cài, đã chặn, hỗ trợ), trang: render theo `pushTypes`, lưu tùy chọn, thông báo thiết bị bị gỡ, giờ yên lặng qua nửa đêm; `sw.test.ts` mở rộng cho `push`/`notificationclick` với `ServiceWorkerGlobalScope` giả.

### 6.3 Nhóm lỗi mới và cải tiến chỉ FE (FR-38, 39, 41, 42, 45, 47, 48, 49)

| Mã | Màn hình / file | Việc | State | Rủi ro hồi quy | Test | 
|---|---|---|---|---|---|
| FR-38 | `components/header/NotificationDropdown.tsx`, `layout/AppHeader.tsx`, `modules/crm/screens/Notifications/index.tsx`, `modules/crm/api/hooks.ts` (`useNotifications`), `crm/hooks/useIsMobile.ts` | Hook mới `useInfiniteNotifications` (React Query `useInfiniteQuery`, `limit = 20`, trang kế khi `meta.page < meta.totalPages`, không gọi trùng khi đang tải). **Mobile (dưới breakpoint của `useIsMobile`)**: chuông điều hướng sang màn `/notifications` (không mở popup), danh sách 20 mục đầu, cuộn tới cuối (`IntersectionObserver`) tải thêm 20, có trạng thái đang tải/hết danh sách/rỗng/lỗi (có nút thử lại). **Desktop**: dropdown kiểu Facebook neo dưới chuông (không dùng `-right-[240px]`; tính vị trí để không tràn viewport), tab Tất cả/Chưa đọc (`isRead=false`), chấm xanh chưa đọc, thời gian tương đối, "Xem tất cả thông báo", cuộn tới cuối tải thêm 20. Đánh dấu đã đọc: làm tươi **cả danh sách và số chưa đọc** (invalidate `notifications` + `unread-count`) | React Query | Vừa: `useNotifications` đang được nơi khác dùng (giữ nguyên hook cũ, thêm hook mới) | Phân trang đúng 20, hết danh sách, lỗi giữa chừng, không gọi trùng, mobile điều hướng, desktop không tràn (kiểm bằng hình học trong jsdom/Playwright), thử iPhone thật |
| FR-39 | `screens/Settings/settingsForms.ts` (`SETTINGS_TABS`, `CATALOG_ENDPOINTS`), `SettingsView.tsx`, `components/CatalogSection.tsx`, `components/CatalogItemEditor.tsx` | Thêm tab "Kết quả liên hệ" (chỉ Quản trị): mở rộng `CatalogDraft` và `CatalogItemEditor` cho `suggestedFollowUpDays`, `suggestionText`; ánh xạ `contact-results` vào `CATALOG_ENDPOINTS` (`adminApi.ts` đã khai báo); thêm/sửa/ẩn/khôi phục, lỗi tiếng Việt, desktop và mobile; sau lưu invalidate danh mục để form Nhật ký thấy ngay | Server state + form cục bộ | Thấp–vừa: dùng chung `CatalogSection` với 3 tab hiện có | Tab, thêm/sửa/ẩn, quyền, lỗi, form Nhật ký cập nhật |
| FR-41 | Mới `screens/Settings/components/PersonaFieldsSection.tsx` (+ editor), đăng ký tab ở `SETTINGS_TABS`; API `GET/POST/PATCH/DELETE /crm/persona-fields`, `PUT /crm/persona-fields/order` | **Đợt 1:** danh sách theo 7 nhóm, sửa nhãn và lựa chọn của trường SELECT/MULTI_SELECT (lựa chọn vắng mặt trong `options` bị **tắt**, không xóa), bật/tắt, đổi thứ tự. **Đợt 2:** thêm trường mới (kiểu, lựa chọn, trọng số, lọc được, nhạy cảm) và bớt trường không phải hệ thống (`PERSONA_FIELD_SYSTEM` chặn trường hệ thống, `PERSONA_FIELD_TYPE_LOCKED` chặn đổi kiểu khi đã có dữ liệu: FE hiện đúng lỗi). Giữ cứng `PersonaFieldType` và 7 nhóm. Thay đổi có hiệu lực ngay ở form chân dung (invalidate `persona-fields`). `coder-backend-agent` kiểm lại quy tắc BE trước khi FE làm | Server state + form cục bộ | Vừa: lớn; sửa lựa chọn không được làm mất dữ liệu cũ (lựa chọn đã tắt vẫn hiển thị cho khách đang dùng) | Quyền chỉ Quản trị, đổi lựa chọn không mất dữ liệu cũ, thứ tự, trường hệ thống không xóa, không đổi kiểu đã có dữ liệu, thêm trường dùng được ở form |
| FR-42 | Mới `screens/Settings/components/TagsSection.tsx`; API `PATCH/DELETE /crm/tags/:id` (`mergeIntoId`) | Tab "Thẻ" (chỉ Quản trị): danh sách + `usageCount`, đổi tên/nhóm/màu, gộp (chọn thẻ đích), xóa mềm; sau thay đổi invalidate `tags` ở bộ lọc, gắn hàng loạt, form chân dung | Server state | Thấp | Quyền, gộp (thẻ cũ biến mất, khách chuyển sang thẻ đích), xóa mềm |
| FR-45 | `layout/AppSidebar.tsx`, `context/SidebarContext.tsx` | Khi `lg:` chưa áp dụng (mobile) và `isMobileOpen = false`: sidebar có `inert` (và `aria-hidden`) để ra khỏi thứ tự Tab và cây truy cập; mở thì bỏ; desktop không đổi (`lg:translate-x-0` luôn hiện). Dùng thuộc tính `inert` của React 19, kiểm hỗ trợ iOS 15.5+ (PWA yêu cầu iOS 16.4+) | Cục bộ (`SidebarContext`) | Thấp: chỉ lớp phủ mobile; đảm bảo focus trap/đóng bằng Esc còn đúng | Đóng thì phần tử trong sidebar không focus được, mở thì có, desktop không đổi (`AppSidebar.test.tsx` mở rộng) |
| FR-47 | `modules/crm/components/CallModal.tsx`, `GlobalModals.tsx` | Bỏ hằng `CALL_OUTCOME_OPTIONS` (5 chuỗi cứng); ô "Kết quả liên hệ" lấy từ danh mục `GET /crm/contact-results` (cùng hook với form nhật ký, mục ẩn không hiện), có trạng thái đang tải/lỗi rõ; làm cả khi `isInAppCallEnabled` tắt; giá trị là `code` (A0) | Server state | Thấp (chưa lộ vì cờ tắt) | Ô hiện đúng mục DB, mục ẩn không hiện, lỗi tải; kiểm với cờ tắt bằng test |
| FR-48 | `screens/EditPersona/PersonaFormBody.tsx` (`TagPicker`), `TagsSection.tsx` | Thêm chỗ chọn loại `OTHER` ở form tạo thẻ nhanh và ở màn quản lý thẻ; `OTHER` hiện đúng ở gắn thẻ, bộ lọc, gắn hàng loạt (nhóm "Khác") | Cục bộ + server | Thấp; **làm sau FR-42** (chung `TagsSection`) | Tạo thẻ `OTHER`, hiện ở bộ lọc/gắn hàng loạt |
| FR-49 | `modules/crm/components/AdvancedFilterModal.tsx`, `lib/customerFilters.ts`, `api/http/customerQuery.ts` | Thêm khối lọc chân dung: lấy trường `isFilterable` từ `GET /crm/persona-fields` (thêm/bớt ở FR-41 thì tự thấy), chọn một hoặc nhiều giá trị, gửi `personaFilterKeys`/`personaFilters` đúng định dạng BE đang hỗ trợ; kết hợp bộ lọc khác, xóa được; trường không lọc được không hiện. Giá trị chứa dấu phẩy (FR-32 `Hoãn`) ngoài phạm vi | Cục bộ (`useState` trong modal) + server | Thấp–vừa; **làm sau FR-41**, phối hợp với đổi `code` ở A0 trong `customerQuery.ts` | Lọc một/nhiều giá trị, kết hợp, xóa, trường không lọc được ẩn |

## 7. Bảo mật & Phân quyền

| Chủ đề | Thiết kế | FR |
|---|---|---|
| Quyền API push | `/push-subscriptions*`: `@Roles(...CRM_ROLES)` + `CrmFeatureGuard`, thao tác chỉ trên subscription của chính người gọi (lọc theo `userId`; sai chủ thì 404). `POST /auth/logout` thu hồi chỉ id của chính mình | FR-01 |
| SSRF | Allowlist host + `https` + giới hạn độ dài; không theo chuyển hướng (`https.request` của Node không tự theo redirect; coder xác nhận khi tích hợp `web-push`); timeout 5 giây | FR-01, FR-02 |
| Bí mật | Khóa riêng VAPID chỉ ở biến môi trường (compose `environment`, không `build.args`, không vào image/repo/log/tài liệu); khóa công khai trả qua API; `auth` của subscription mã hóa (AAD gắn người dùng và endpoint); `endpoint` chỉ log dạng băm | FR-01, FR-07 |
| PII | Danh sách biến cho phép đóng + quét hậu kiểm; log che PII (FR-15); push đã gửi không thu hồi được nên mẫu tối giản; `notifications.push` xóa khi khách ẩn danh hóa | FR-06, FR-15 |
| Không lộ tồn tại | Hủy subscription của người khác: 404 | FR-01 |
| Rate limit | `POST /push-subscriptions` 10/phút, **tracker theo `userId`** (không theo IP, vì sau cloudflared nhiều người có thể chung IP; yêu cầu chưa đăng nhập đã bị guard JWT chặn trước nên luôn có `userId`). **Lưu ý (L5):** Throttler hiện lưu **trong bộ nhớ từng instance** (dùng Redis là FR-19, `Hoãn`), nên với một instance backend thì đúng 10/phút/người, nếu sau này chạy nhiều instance thì hạn mức thực tế nhân theo số instance; chấp nhận ở v1.0.4. **Mặc định đã chọn:** tracker `userId`; nếu coder không gắn được tracker theo `userId` thì rơi về theo IP (an toàn, chặt hơn). Worker dùng `limiter` của BullMQ | FR-01, FR-03 |
| NoSQL injection | Interceptor toàn cục + DTO chặt (FR-14); không bật `sanitizeFilter` toàn cục | FR-14 |
| Role theo DB | `@AdminOnly()` cho route ADMIN ngoài CRM; `@ActiveCrmUser()` cho GET danh mục (Q8) | FR-21 |
| Soft Delete | `push_subscriptions` thu hồi mềm (`revokedAt`) rồi **xóa cứng bằng TTL/job** vì là dữ liệu kỹ thuật không phải nghiệp vụ (cùng tiền lệ `notifications`, `reminders`); Plan FR-05 yêu cầu "tự xóa" | FR-05 |
| Audit trail | Đăng ký/gỡ subscription là dữ liệu kỹ thuật, không ghi `crm_audit_logs` (ghi log kỹ thuật có Correlation ID); thay đổi danh mục `code` (A0) và migration ghi qua log runner; thay đổi danh mục/chân dung/thẻ ở FR-39/41/42 đã được audit sẵn bởi BE (`CATALOG_*`) | FR-01, FR-40 |
| Zero-Downtime Schema | Chỉ thêm field/index; id cũ giữ; xem 5.1.7 | FR-40, FR-46 |
| Cờ tính năng | `FEATURE_CRM_PUSH` (tắt mặc định); API đăng ký vẫn hoạt động khi cờ tắt | FR-07 |
| Điều kiện an toàn trước bật cờ production | **FR-14, FR-15, FR-16 xong và qua `qa-agent` trước khi đặt `CRM_PUSH_ENABLED=true`** (Plan mục 3 quy tắc 14) | FR-14, 15, 16 |
| JWT + Refresh Token | Không đổi (đã có); push không dùng token riêng | FR-01 |

## 8. Logging & Giám sát

- Mọi dòng log của luồng push mang `X-Request-ID`/`jobId` (Correlation ID, `RequestContextService`); job nền truyền `notificationId` làm khóa tìm.
- Chỉ ghi: số lượng, trạng thái, mã HTTP của dịch vụ push, `endpointHash`, `subscriptionId`. Không ghi payload, `endpoint` thô, khóa, tên khách. Tất cả đi qua bộ che PII (FR-15).
- Chỉ số theo dõi sau khi bật cờ (đếm bằng truy vấn `notifications.pushStatus`, không thêm công cụ mới): tỉ lệ `SENT`/`SKIPPED`/`FAILED`, số `GONE` thu hồi, số `PENDING` quá 2 phút (nghi Redis/worker), lỗi `PERMANENT` 401/403 (nghi sai khóa VAPID). Ghi truy vấn mẫu vào runbook (FR-08).
- Cảnh báo ERROR có dấu hiệu rõ: cờ bật mà thiếu `VAPID_*`; `PERMANENT` 401/403 lặp lại; mẫu push chạm bộ quét PII.
- Migration A0: báo cáo số đếm mỗi bước vào stdout của runner (đã được `deploy.sh` thu).

## 9. Kế hoạch kiểm thử

> Backend: Jest (`*.spec.ts`; tích hợp dùng Mongo replica set trong bộ nhớ `memory-replset.util`); Web admin: vitest + Testing Library, Playwright (`e2e/`) khi cần. Mỗi coder viết unit cho code của mình; `qa-agent` bổ sung integration/E2E và review test (bắt tautology, thiếu ca biên).

### 9.1 Unit

| Phạm vi | Nội dung | FR |
|---|---|---|
| `push-catalog` | Đúng 4 loại, đủ trường; thêm một loại thử thì Dispatcher/renderer dùng được **không sửa bộ gửi**; `STALE_CUSTOMER`, `SECURITY_ALERT` không có | FR-43 |
| `push-content.renderer` | Quét cả 4 mẫu (không có "mẫu gộp": bỏ vì Q5 chưa duyệt; chỉ thêm test nếu Oniichan duyệt Q5 phương án gộp) với dữ liệu bẫy (tên chứa số điện thoại/email/12 chữ số) → rơi về nội dung chung; chỉ dùng biến cho phép; cắt độ dài; `url` nội bộ | FR-06 |
| `isInQuietHours` | Mặc định tắt; 22:00 đến 06:00 qua nửa đêm; biên `start` bao gồm, `end` không bao gồm; múi giờ `Asia/Ho_Chi_Minh` | FR-03, FR-10 |
| `WebPushProvider` (thư viện giả) | Ánh xạ 201/404/410/400/401/403/413/429/5xx/timeout sang `SENT/GONE/PERMANENT/TRANSIENT`; timeout 5 giây | FR-02, FR-04 |
| Dispatcher | `pushWhen` của `CUSTOMER_ASSIGNED` cho từng tình huống (thêm người cùng phụ trách, duyệt đề nghị, thêm hàng loạt: có push; phụ trách chính, tạo khách, đổi phụ trách chính hàng loạt: `SKIPPED`); khóa chống trùng; người thực hiện bị loại; tắt `push`; cờ tắt → `SKIPPED` | FR-43, FR-44, FR-03 |
| Subscriptions service | Upsert gán lại cho người mới; giới hạn 3 (thứ 4 gỡ cái cũ nhất, upsert cùng endpoint không tính thiết bị mới, người khác không bị ảnh hưởng); allowlist/độ dài khóa; hủy người khác 404; logout kèm id | FR-01 |
| Dọn 90 ngày | 89 ngày còn, đúng 90 còn, 91 xóa; chạy hai lần cùng kết quả; hoạt động gần đây không bị xóa; bật lại được sau khi bị dọn | FR-05 |
| `afterCommit` | Chỉ chạy sau commit; rollback thì không chạy; retry `work` không chạy hai lần; lỗi trong callback không ném | FR-03 |
| `redactPii`, `nosql interceptor` | Như 5.9 | FR-15, FR-14 |
| Migration `007`/`008`/`009` | Xem 9.2 (`009`: tạo index idempotent, `down` gỡ index, dry-run chỉ liệt kê) | FR-40, FR-46, FR-03, FR-26 |
| FE: `parsePushPayload`, máy trạng thái thiết bị, `NotificationSettings`, hook `useInfiniteNotifications`, từng màn ở 6.3 | Như 6.2, 6.3 | FR-09, 10, 38–49 |

### 9.2 Integration / E2E

| Phạm vi | Nội dung | FR |
|---|---|---|
| Migration A0 (khuôn `migrate-areas-to-34-provinces.integration.spec.ts`) | Dữ liệu mẫu có đủ ca: khách có/không nguồn/khu vực/dự án, tình trạng đã ngừng/xóa mềm, dự án nhiều loại hình chữ cũ; chạy `up` hai lần (lần hai mọi số đếm 0); dry-run không ghi; **`updatedAt`/`version`/`lastUpdatedAt` không đổi**; mồ côi → ném lỗi, phần còn lại đã điền; chạy lệnh bù; ghi kép ở mọi đường ghi (tạo/sửa khách, đổi tình trạng, tự đổi tình trạng, bulk, nhật ký, lịch hẹn, dự án); API nhận `…Code` và `…Id`, lệch → 400; lọc/đếm theo `code`; đổi nhãn không vỡ; `CrmUsageService` đúng khi thiếu `code` | FR-40, FR-46 |
| Luồng push đầu-cuối với **dịch vụ push giả** | Phân khách → thông báo `PENDING` → job → `SENT`; lỗi tạm 5 lần rồi `FAILED`; 404/410 thu hồi đúng subscription, subscription còn lại vẫn nhận; tắt cờ → `SKIPPED` không gọi dịch vụ push; quá hạn; người bị khóa | FR-02, 03, 04, 07 |
| **Không gửi trùng** | Hai worker xử lý cùng lúc, restart giữa chừng (job `active` bị dừng), `push.sweep` + `afterCommit` cùng xếp một thông báo → đúng một lần gửi thành công cho mỗi (thông báo, subscription); transaction rollback không có push | FR-03, FR-12 |
| Giới hạn hàng loạt | Bulk `ASSIGN` nhiều khách cho cùng một người → không quá 3 push cho người đó trong đợt (các thông báo còn lại `SKIPPED`, vẫn có trong hộp thông báo); đợt khác dùng bộ đếm khác | FR-43 |
| Cấm gọi trực tiếp | Test kiến trúc: không file nào ngoài `notifications` gọi `createMany`/`notifyAdmins` (rà mã nguồn bằng test) | FR-44 |
| FR-14, 16, 21, 22, 25 | Như 5.9 | các FR tương ứng |
| FR-26 | Upload → job → `thumbKey`; ảnh cũ được bù; xóa kèm thumbnail; mapper fallback | FR-26 |
| Thử thật | iPhone (iOS 16.4+, PWA đã cài) và Android (Chrome PWA) **trên production ngay sau khi bật cờ** (thao tác thật: phân một khách cho tài khoản thử; không có nút "Gửi thử"); bấm vào push mở đúng trang; tắt thông báo thì dừng; ghi kết quả vào runbook. Không cam kết thời gian đến (Oniichan đã chấp nhận) | FR-09, FR-12 |
| FR-23, FR-35 | Việc kiểm tay của Oniichan sau deploy (mục 10.2), không có test tự động | (ngoài thiết kế) |

## 10. Phân việc cho coder agent

> Nhãn nhóm: `A0` (làm trước, gồm migration), `A`, `B`, `C`, `D`, `E` bám Plan mục 4.1. `[P]` = có thể song song với việc cùng cột "Song song được" (không chung file). Việc nào "tuần tự" phải đợi việc nêu ở "Phụ thuộc" vì cùng file/module hoặc cùng hợp đồng. Mọi việc coder đều kèm unit test; **sau mỗi việc coder dispatch `qa-agent` review code và test** (quy trình dự án). `/spec-tasks` sẽ đánh số `T-xx`; cột "Gói" là nhãn tạm.

**Đối chiếu nhãn giai đoạn A0 với Plan (L4):** Plan (mục 4.1) dùng `A0` = **giai đoạn THIẾT KẾ sớm** (thiết kế FR-40/PT-034 cùng FR-43, FR-44; do `architect-agent`). Tài liệu này dùng `A0` cho **phần TRIỂN KHAI FR-40/FR-46** (BE, FE, migration, thử bản sao) vì thiết kế đã xong ở mục 5.1.

| Nhãn | Nghĩa trong Plan | Nghĩa trong tài liệu này | FR |
|---|---|---|---|
| `A0` (thiết kế) | Thiết kế FR-40 + FR-43/44 | Đã xong: mục 5.1 (FR-40/46), 5.2 (FR-43/44) | FR-40, FR-43, FR-44 |
| `A0-*` (A0-BE-1/2/3, A0-MIG, A0-FE, A0-OPS, A0-QA) | (không có) | Triển khai FR-40, FR-46 (Plan: sau thiết kế A0, thuộc BE/FE/migration của FR-40) | FR-40, FR-46 |
| `A` | Điều kiện an toàn FR-14, 15, 16 | `A-1..A-4` (thêm FR-22) | FR-14, FR-15, FR-16, FR-22 |

### 10.1 Bảng việc

| Gói | Task | Agent | Phụ thuộc | Song song được | FR |
|---|---|---|---|---|---|
| A-1 | `listDeleted` thêm `guardSearch` + test. **Làm đầu tiên** (cùng file `customer-list.service.ts` với A0-BE-2) | `coder-backend-agent` | không | [P] A-2, A-3, A-4, A0-BE-1 | FR-16 |
| A-2 | Bộ che PII `redactPii` ở `CustomLogger` + `winston.config.ts` + test (làm **trước** code log của B) | `coder-backend-agent` | không | [P] A-1, A-3, A-4 | FR-15 |
| A-3 | Interceptor chặn toán tử `$` + sửa 3 điểm lọt DTO của `news-fire-crawl-manager` + test `$`-operator cho CRM | `coder-backend-agent` | không | [P] A-1, A-2, A-4 | FR-14 |
| A-4 | `POST /users` bắt E11000 → 409 + test đồng thời | `coder-backend-agent` | không | [P] A-1, A-2, A-3 | FR-22 |
| A0-BE-1 | Danh mục: `areas.code` (schema, service, DTO, seed `provinceCode`), `projects` (`areaCode`, `propertyTypeCodes`, `unmappedPropertyTypes`, bất biến mã), `CatalogRefDto`, `CustomerRefsService.resolveByCodes/ByIds` + `lockAndAssert` nhận id đã dịch, `CrmUsageService` đếm `$or` | `coder-backend-agent` | không (thiết kế đã xong ở mục 5.1) | [P] A-1..A-4 | FR-40, FR-46 |
| A0-BE-2 | Khách: 4 field `…Code` + index, ghi kép (tạo/sửa/đổi tình trạng/tự đổi tình trạng), lọc `…Codes`, `list-counts` theo `statusCode`, mapper/DTO, audit `fromCode/toCode`, bulk `payload.statusCode` | `coder-backend-agent` | A0-BE-1, A-1 | [P] A0-BE-3, A0-MIG | FR-40 |
| A0-BE-3 | Nhật ký (`contactResultCode`), lịch hẹn (`projectCode`), `daily-tasks.service`, `reminder-scanner.service` chuyển sang `…Code` | `coder-backend-agent` | A0-BE-1 | [P] A0-BE-2, A0-MIG | FR-40 |
| A0-MIG | Migration `007_crm_catalog_codes` + `008_crm_project_property_type_codes` + `009_notification_attachment_indexes` (đăng ký registry; **làm tuần tự 007 → 008 → 009** vì `validateMigrationRegistry` bắt số liên tiếp từ 007 và cả ba cùng sửa `migration.registry.ts`, không song song; idempotent, có `down`; làm xong trước B-4 và D-3 vì hai việc này dựa vào index), lệnh bù `crm-catalog-codes.cli`, spec tích hợp (idempotent, dry-run, không đổi `updatedAt/version`, mồ côi) | `coder-backend-agent` | A0-BE-1 (tên field/index) | [P] A0-BE-2, A0-BE-3, A0-FE | FR-40, FR-46, FR-03, FR-26 |
| A0-FE | Adapter `api/http/*` đổi id→`code`, `crmStorage` nâng phiên bản, mock/seed, bộ lọc gửi `…Codes`, test | `coder-frontend-agent` | Hợp đồng 4.2 (đã chốt; tích hợp thật sau A0-BE-2/3) | [P] A0-BE-*, A0-MIG | FR-40 |
| A0-OPS | Thử trên bản sao dữ liệu thật (5.1.8), ghi số liệu; **thêm bước tự động `crm-catalog-codes.cli --apply` vào `deploy.sh` sau `up` (H1, 5.1.3), lỗi thì deploy báo lỗi**; cập nhật thông điệp/runbook lùi (Q10) | `devops-agent` | A0-MIG | [P] A0-FE | FR-40, FR-46 |
| A0-QA | Review migration (idempotent, đường lùi, bất biến), review ghi kép ở mọi đường ghi, test tích hợp xuyên module | `qa-agent` | A0-BE-2, A0-BE-3, A0-MIG, A0-OPS | | FR-40, FR-46 |
| B-1 | `push-catalog.ts`, `push-content.renderer.ts`, `NotificationDispatcher`, `afterCommit` trong `withTransaction`, `createMany` thành nội bộ, `pushWhen`, test | `coder-backend-agent` | A-2 | [P] B-2, B-3, B-7 | FR-43, FR-44, FR-06 |
| B-2 | `WebPushProvider` (`web-push`), mở rộng `PushProvider`, factory theo cờ + VAPID, `QueueNames.PUSH`, tùy chọn `limiter` của `registerWorker` | `coder-backend-agent` | không | [P] B-1, B-3 | FR-02, FR-07 |
| B-3 | `push_subscriptions` (schema, API, giới hạn 3, mã hóa `auth`, allowlist), `push_deliveries`, `push.cleanup`, sửa `POST /auth/logout` | `coder-backend-agent` | không | [P] B-1, B-2 | FR-01, FR-05, FR-04 |
| B-4 | Worker `push.send`, `push.sweep`, giờ yên lặng, tùy chọn từng loại, retry, giới hạn hàng loạt, 404/410 thu hồi | `coder-backend-agent` | B-1, B-2, B-3 | | FR-03, FR-04, FR-43 |
| B-5 | Đổi mọi nơi gọi `createMany`/`notifyAdmins` sang Dispatcher (7 điểm gọi trong 6 file ở bảng 5.2, cộng `notifications.service.ts:186` qua `notifyAdmins`), thêm `origin` vào `CareTeamMutation`, xóa `push` khi ẩn danh hóa khách, test kiến trúc cấm gọi trực tiếp | `coder-backend-agent` | B-1, **A0-BE-2, A0-BE-3** (cùng `customers.service.ts`, `care-logs.service.ts`) | tuần tự sau A0-BE | FR-44 |
| B-6 | Bộ test M7: giả lập dịch vụ push, chống trùng khi restart, quét PII 4 mẫu, ma trận quyền | `qa-agent` | B-4, B-5 | [P] C-1 | FR-12, FR-06 |
| B-7 | `docker-compose.yml` (`FEATURE_CRM_PUSH=${CRM_PUSH_ENABLED:-false}`, `VAPID_*`), `.env.docker.example` (chỉ tên biến), thêm phụ thuộc `web-push`/`sharp` + `npm audit` | `devops-agent` | không | [P] B-1..B-3 | FR-07 |
| C-1 | `sw.ts` (`push`, `notificationclick`), `pushPayload.ts`, `tsconfig.sw.json`, client đăng ký/hủy, hook `usePushSubscription` | `coder-frontend-agent` | Hợp đồng 4.1 (đã chốt) | [P] B-*, C-2 sau | FR-09 |
| C-2 | Trang "Cài đặt thông báo" (thiết bị, danh sách thiết bị, công tắc từng loại theo `pushTypes`, giờ yên lặng), route, liên kết menu | `coder-frontend-agent` | C-1 (cùng thư mục/hook), B-3 (API) | | FR-09, FR-10, FR-43 |
| C-3 | Runbook VAPID trong `06_Production_Deploy.md` (gồm bật/tắt khẩn cấp, xoay khóa, lệnh bù A0, kiểm tay FR-23 và FR-35), thử trên bản sạch | `devops-agent` | B-4, B-7 | [P] C-4 | FR-08 |
| C-4 | Tài liệu 04/05/06 (thay FCM bằng Web Push, `push_subscriptions`, danh mục push, Dispatcher, API), `README.md` phiên bản, nhãn v1.0.4 | **`pm-agent` viết** (M4: theo phân vai, `qa-agent` không là chủ sở hữu tài liệu; `architect-agent` hỗ trợ nội dung kỹ thuật khi `pm-agent` cần); **`qa-agent` chỉ review** đối chiếu code/tài liệu sau khi viết xong | B-4, C-2; **riêng phần FR-29(a) phụ thuộc kết quả D-3 (FR-26)**: mô tả `ImageProcessor`/thumbnail chỉ chốt sau khi D-3 xong (chưa xong D-3 thì ghi "đang làm" hoặc để lại cuối) | [P] C-3 | FR-13, FR-29 |
| C-5 | **Bật `FEATURE_CRM_PUSH` ở production** (Oniichan + `devops-agent`), thử iPhone/Android thật | Oniichan, `devops-agent` | A-1, A-2, A-3 xong và qua `qa-agent`; B xong; C-1..C-3 xong | | FR-07, FR-09, FR-12 |
| D-1 | Route ADMIN ngoài CRM dùng `@AdminOnly()`; `@ActiveCrmUser()` cho GET danh mục; cập nhật `role-coverage` | `coder-backend-agent` | A-3 (cùng `news-fire-crawl-manager` controller) | [P] D-2, D-3 | FR-21 |
| D-2 | Test đồng thời `createMany`/Dispatcher (FR-25): **`qa-agent` viết test**; nếu test đỏ (chứng minh lỗi E11000 thật) thì **`coder-backend-agent` sửa code** (bắt `isDuplicateKeyError` thử lại một lần) rồi `qa-agent` chạy lại; test xanh thì ghi kết quả vào tài liệu 06 và đóng (`Không cần`) | `qa-agent` (test) + `coder-backend-agent` (sửa nếu đỏ) | B-1 | [P] D-1, D-3 | FR-25 |
| D-3 | Thumbnail ảnh: `sharp`, queue `crm-image`, worker, `thumbStatus`, mapper, bù ảnh cũ, dọn kèm `thumbKey` | `coder-backend-agent` | A0-BE-3 (cùng `care-log.mapper.ts`), B-7 (phụ thuộc `sharp`) | [P] D-1, D-2 | FR-26 |
| E-1 | `NotificationDropdown` kiểu Facebook + màn Thông báo mobile, `useInfiniteNotifications` | `coder-frontend-agent` | không (chỉ FE, backend đã đủ) | [P] E-2, E-3, E-6 | FR-38 |
| E-2 | `AppSidebar` `inert` khi đóng | `coder-frontend-agent` | không | [P] E-1, E-3 | FR-45 |
| E-3 | Tab "Kết quả liên hệ" (mở rộng `CatalogDraft`/`CatalogItemEditor`, `CATALOG_ENDPOINTS`) | `coder-frontend-agent` | A0-FE (dùng `code`) | [P] E-1, E-2 | FR-39 |
| E-4 | Tab "Thẻ" (đổi tên/gộp/xóa mềm/`usageCount`) | `coder-frontend-agent` | E-3 (cùng `settingsForms.ts`, `SettingsView.tsx`) | tuần tự sau E-3 | FR-42 |
| E-5 | Loại thẻ `OTHER` ở form thẻ và tab Thẻ | `coder-frontend-agent` | E-4 | tuần tự sau E-4 | FR-48 |
| E-6 | Màn Trường chân dung, đợt 1 (nhãn/lựa chọn/bật tắt/thứ tự); đợt 2 (thêm/bớt trường). `coder-backend-agent` kiểm quy tắc BE trước | `coder-frontend-agent` (+ `coder-backend-agent` kiểm) | E-3, A0-FE; làm sau E-4 nếu E-4 đã làm (cùng `settingsForms.ts`, chỉ là thứ tự, không phụ thuộc cứng). **Thuộc mốc phát hành, cả hai đợt** | đợt 1 [P] E-1; đợt 2 tuần tự sau đợt 1 | FR-41 |
| E-7 | `CallModal` dùng danh mục DB | `coder-frontend-agent` | A0-FE (bỏ phụ thuộc E-3 cũ: `CallModal` chỉ dùng hook `GET /crm/contact-results` đã có, không dùng tab Cài đặt của E-3; E-3 và E-7 không chung file) | [P] E-1, E-2, E-3 | FR-47 |
| E-8 | Bộ lọc nâng cao theo chân dung | `coder-frontend-agent` | E-6 (đợt 1), A0-FE | [P] E-7 | FR-49 |
| E-9 | Form Dự án "loại hình" chọn từ `property_type` + cảnh báo `unmappedPropertyTypes` | `coder-frontend-agent` | A0-BE-1, A0-MIG (008), E-3, A0-FE; làm sau E-6 (đợt 1) nếu E-6 đã làm (cùng `settingsForms.ts`, chỉ là thứ tự, không chặn) | | FR-46 |
| QA-1 | Review code/test từng gói; audit `qa-agent` toàn bản (build `tsc`, `jest`, `vitest` xanh, không Critical/High) | `qa-agent` | mỗi gói | | FR-01..FR-49 (36 hiệu lực) |

**Ghi chú thứ tự tuần tự (cùng file/module):** `customer-list.service.ts` (A-1 → A0-BE-2); `customers.service.ts`, `care-logs.service.ts`, `care-team.service.ts` (A0-BE-2/3 → B-5); `news-fire-crawl-manager` controller (A-3 → D-1); `care-log.mapper.ts` (A0-BE-3 → D-3); `settingsForms.ts`/`SettingsView.tsx` (E-3 → E-4 → E-6 → E-9); `TagsSection.tsx` (E-4 → E-5); `AdvancedFilterModal.tsx`, `customerQuery.ts` (A0-FE → E-8); `shared/queue/queue.constants.ts` và `queue-runtime.service.ts` (B-2 → D-3).

**Phụ thuộc bổ sung (bổ sung sau `/spec-analyze`, không đổi số task):**
- Push hàng loạt (B-4, cụ thể bộ đếm `pushGroupKey` và test giới hạn 3 push/đợt, = T-33 trong Tasks) cần `origin = BULK_ADD` do **B-5** thêm vào `CareTeamMutation`: B-4 phần hàng loạt làm sau B-5 (phần còn lại của B-4 không chờ).
- `UsersService`: FR-22 (A-4, bắt E11000) và `revokeAllForUser` (B-3, 5.6) cùng file `users.service.ts` nên **làm tuần tự** (A-4 → B-3 phần `revokeAllForUser`).
- `@ActiveCrmUser()` cho GET persona-fields (D-1, FR-21) và sửa quy tắc persona-fields (FR-41, backend kiểm của E-6, thuộc mốc phát hành) cùng controller `persona-fields` nên **làm tuần tự**, không song song.
- `009` (A0-MIG) tạo index `notifications` và `crm_attachments` trước khi B-4 (job `push.sweep`) và D-3 (job bù thumbnail) chạy trên dữ liệu thật.
- QA-1 ghi cột FR là `FR-01..FR-49 (36 hiệu lực)`, không phải "mọi FR" (13 FR còn lại ở 10.2 không thuộc phạm vi review).

**Mốc phát hành (M1, khớp Plan dòng 336 và 417-419: FR-38 và FR-39 là "Phải có"):** xong A, A0 (kể cả A0-OPS và A0-QA), B, C, **E-1 (FR-38) và E-3 (FR-39)**, **E-6 đủ hai đợt (FR-41, khớp Plan 4.1 dòng ~336: mốc phát hành chờ "FR-41 đủ hai đợt")**, E-9 (FR-46); D (FR-21, 25, 26) và phần còn lại của E (E-2, E-4, E-5, E-7, E-8: FR-45, 42, 48, 47, 49) **không chặn phát hành** (quyết định đã chốt: chỉ FR-42 (E-4) không là điều kiện phát hành; E-6 không phụ thuộc cứng E-4, chỉ làm tuần tự cùng file `settingsForms.ts` nên nếu E-4 chưa làm thì E-6 đăng ký tab sau E-3; E-9 làm sau E-6 đợt 1, chỉ là thứ tự; hệ quả: phần backend kiểm quy tắc `persona-fields` của E-6 (T-62) cũng nằm trong mốc phát hành), làm nếu còn thời gian (theo mức ưu tiên ghi ở Plan; coder/qa đối chiếu lại cột ưu tiên của Plan nếu Plan đổi).

### 10.2 Ngoài phạm vi thiết kế

Các FR dưới đây có trong Plan nhưng **không thiết kế** (chỉ ghi để truy vết):

| FR | Trạng thái (Plan) | Lý do (một dòng) |
|---|---|---|
| FR-11 | Bỏ | Không còn đối tượng: web admin không có mock "đẩy thông báo" |
| FR-17 | Bỏ | Oniichan: không cần xóa GPS khi tải ảnh lên |
| FR-18 | Bỏ | Push `STALE_CUSTOMER` đã dời, không cần giới hạn lô khi quét lần đầu |
| FR-20 | Bỏ | Oniichan không làm băm body và scope key theo user cho 6 route ngoài CRM |
| FR-19 | Hoãn | Throttler dùng Redis chỉ cần khi chạy nhiều instance backend |
| FR-24 | Hoãn | Index `persona.fieldKey` rủi ro thấp, chưa gấp |
| FR-27 | Hoãn | Dùng tạm nút "Ghi nhật ký"; việc FOLLOW_UP tự hết khi có nhật ký mới hơn |
| FR-28 | Hoãn | Web admin chưa đọc header phản hồi nào (`exposedHeaders`) |
| FR-32 | Hoãn | `personaFilters` chứa dấu phẩy chưa gấp (FR-49 không hỗ trợ ca này) |
| FR-34 | Hoãn | Bộ đếm phụ dò đuôi SĐT rủi ro thấp |
| FR-36 | Hoãn | `evaluateOccasion` kiểm `occurrenceDate` rủi ro thấp |
| FR-37 | Hoãn (v1.0.5) | Đi cùng loại push `STALE_CUSTOMER` dời sang v1.0.5; **không thiết kế `STALE_CUSTOMER`** (danh mục 4 loại là danh sách đóng) |
| FR-33 | Không cần | `qa-agent` xác minh không phải lỗi (ảnh qua URL ký sẵn của MinIO) |
| FR-23 | Đã xong | Code đã xong; còn một việc **kiểm tay IP thật sau cloudflared** của Oniichan, ghi ở runbook C-3 |
| FR-30 | Đã xong | Backend `jest` 1781/1781 (mốc đối chiếu), không còn việc |
| FR-31 | Đã xong | Web admin `tsc` 0 lỗi, `vitest` 1112 (mốc đối chiếu), không còn việc |
| FR-35 | Kiểm dữ liệu khi deploy | Oniichan tự kiểm dự án mẫu trùng trên production, không giao coder; ghi ở runbook C-3 |

### 10.3 Ma trận phủ FR hiệu lực (36)

| Nhóm | FR | Nơi thiết kế |
|---|---|---|
| M7 lõi (12 mục hiệu lực của mục 2.1, không tính FR-11) | FR-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 12, 13 | Mục 3.2, 4.1, 5.3 đến 5.8, 5.10, 6.2, 9, 10 |
| M7 danh mục và điểm vào | FR-43, FR-44 | Mục 5.2, 4.1, 6.2, 9 |
| Sửa lỗi làm ở v1.0.4 | FR-14, 15, 16, 21, 22, 25, 26, 29 | Mục 5.9, 5.9.1, 4.3, 3.3, 9 |
| Lỗi mới (mục 2.3) | FR-38, 39, 40, 41, 42, 45, 46, 47, 48, 49 | Mục 5.1 (FR-40, 46), 6.1, 6.3 |
| Không cần thiết kế (đã xong, kiểm tay) | FR-23, 30, 31, 35 | Mục 10.2 |

Tổng: 12 + 2 + 8 + 10 = 32 việc còn làm có thiết kế, + 4 (FR-23, 30, 31, 35) ghi ở mục 10.2 = **36/36 FR hiệu lực**. 13 FR còn lại của Plan (FR-11, 17, 18, 20 `Bỏ`; FR-19, 24, 27, 28, 32, 34, 36, 37 `Hoãn`; FR-33 `Không cần`) chỉ liệt kê ở mục 10.2. **Số việc không đổi sau đợt sửa này** (36 hiệu lực, 32 có thiết kế): bỏ endpoint `/test` (M2) không phải một FR nên không làm đổi số; các thay đổi M1/M4/L4 chỉ đổi mốc, chủ sở hữu và nhãn; số task trong bảng 10.1 giữ nguyên (không thêm, không bớt dòng; `D-2` gộp thêm `coder-backend-agent` vào cùng một dòng; migration `009` gộp vào dòng A0-MIG, không thêm task). Đợt sửa sau `/spec-analyze` cũng **không đổi số FR** (vẫn 36 hiệu lực, 32 có thiết kế).

### 10.4 Cổng quyết định (decision gates) cho Oniichan

> Mỗi cổng ghi: **mặc định đã chọn** (coder làm theo mặc định, không bị chặn), **task bị ảnh hưởng**, **hệ quả nếu Oniichan đổi ý**. Oniichan chỉ cần phản hồi khi muốn đổi; không phản hồi = chấp nhận mặc định. Cổng nào ở trạng thái "chưa chốt" thì task đã nêu có thể phải làm lại phần liệt kê.

| Cổng | Mặc định đã chọn | Task bị ảnh hưởng | Hệ quả nếu đổi ý | Phải chốt trước | FR |
|---|---|---|---|---|---|
| **Q1** Mã dự án | Khóa bất biến sau khi tạo (`400 PROJECT_CODE_IMMUTABLE`); đổi hoa/thường được | A0-BE-1 (`assertProjectCodeChange`), **E-9 = T-67 trong Tasks** (ô mã chỉ đọc khi sửa nằm ở form Dự án `ProjectFormFields`; A0-FE chỉ bị ảnh hưởng nếu adapter `projectBody` có xử lý mã dự án), A0-MIG (không đổi mã hiện có), A0-QA | Nếu muốn **sửa được mã dự án**: bỏ khóa, và mỗi lần đổi mã phải cập nhật dây chuyền `interestedProjectCodes` (khách) và `appointments.projectCode` trong một transaction (nặng, rủi ro, thêm test và có thể phải làm theo lô nền); A0-BE-1/2/3 và A0-MIG làm lại phần dự án | Bắt đầu A0-BE-1 | FR-40 |
| **Q3** Ghi kép | Ghi cả id lẫn `code`, API nhận cả hai, chưa gỡ id | A0-BE-1/2/3, A0-MIG (007/008/009), A0-FE, A0-OPS (đường lùi L1, bước bù tự động của `deploy.sh`, thử bản sao), A0-QA | Nếu bắt gỡ id ngay: mất đường lùi L1 (image v1.0.3 không đọc được dữ liệu), phải chặn PWA cũ, thêm migration thu hẹp và bản ghi mới sai tương thích; đây là thay đổi lớn, cần bản phát hành riêng | Bắt đầu A0-BE-2 | FR-40 |
| **Q5** Bão push hàng loạt | Giới hạn 3 push/người/đợt, không thêm mẫu mới | B-1 (renderer, `groupedBodyTemplate` bỏ), B-4 (bộ đếm Redis), B-5 (`origin = BULK_ADD`), B-6 (test, gồm cả phần quét PII 4 mẫu: nếu duyệt mẫu gộp thì thành 5 mẫu), 9.1 | Nếu duyệt **mẫu gộp**: thêm một chuỗi cố định thứ năm (cần sửa danh sách đóng của FR-43/FR-06 trong Plan), job trễ ~20 giây để đếm, thêm test quét PII cho mẫu gộp; B-1, B-4, B-6 làm thêm | Bắt đầu B-4 | FR-43, FR-06 |
| **Q8** `@ActiveCrmUser()` cho GET danh mục | Áp cho **7 GET danh mục** CRM (tình trạng, nguồn, kết quả liên hệ, khu vực, dự án, thẻ, trường chân dung) | D-1 (FR-21), `role-coverage.audit.spec.ts`, test integration khóa/hạ quyền | Nếu **chỉ** làm route ADMIN-only: bỏ phần `@ActiveCrmUser()`; D-1 nhỏ lại (không thêm một lần đọc DB mỗi GET danh mục). Giữ mặc định thì **mở rộng FR-21 sang 7 GET danh mục** (Plan FR-21 chưa nêu rõ phạm vi này) và chấp nhận thêm một truy vấn `_id` mỗi request, tài khoản bị khóa nhận 401 ngay | Bắt đầu D-1 | FR-21 |
| **Q9** Thư viện `sharp` (và `web-push`) | Dùng cả hai; `devops-agent` chạy `npm audit` và kiểm Docker build | B-2, B-7 (`package.json`, Dockerfile), D-3 (thumbnail) | Không chấp nhận `sharp`: D-3 dùng thư viện JS thuần (chậm hơn, tốn bộ nhớ), đổi lại không có binary native trong Docker; D-3 làm lại phần xử lý ảnh và R6 đổi. Không chấp nhận `web-push`: phải tự viết mã hóa `aes128gcm` và ký VAPID (không khuyến nghị), B-2 làm lại | Bắt đầu B-7 / D-3 | FR-02, FR-07, FR-26 |
| Q4 (chỉ để biết) | Giữ nguyên hai thông báo khi duyệt đề nghị (`CUSTOMER_ASSIGNED` có push, `CARE_TEAM_JOIN_RESOLVED` không) | B-5 (không đổi hành vi hộp thông báo) | Muốn gộp còn một thông báo thì đổi `CARE_TEAM_JOIN_RESOLVED` khi duyệt (việc nhỏ, B-5 thêm) | Không chặn | FR-43, FR-44 |
| Q7 (chỉ để biết) | Mã hóa `auth` bằng `PiiCryptoService`; `p256dh` để rõ | B-3 | Lưu rõ `auth` thì bớt phụ thuộc vào `crm/common/crypto` nhưng yếu hơn về bảo mật | Không chặn | FR-01 |
| Q10 (chỉ để biết) | Ghi ngoại lệ lùi image vào runbook; `devops-agent` chỉnh thông điệp `deploy.sh` nếu Oniichan đồng ý | A0-OPS, C-3 | Giữ cảnh báo gốc thì L1 chỉ dùng sau khi `devops-agent` xác nhận trên bản sao | Không chặn | FR-40 |

Q2, Q6 (đã chốt theo Plan), Q11, Q12 (xem 11.1) cũng đã có mặc định; Q11 và Q12 không chặn task nào.

## 11. Rủi ro & Câu hỏi mở

### 11.1 Câu hỏi cần Oniichan quyết (mỗi câu đã có phương án mặc định để coder không bị chặn)

| # | Mâu thuẫn / điểm cần quyết | Phương án mặc định đã dùng trong thiết kế | Ảnh hưởng nếu đổi | FR |
|---|---|---|---|---|
| Q1 | **Mã dự án sửa được (code thật) mâu thuẫn với giả định "code ổn định, không dùng lại" của Plan**: `PATCH /crm/projects/:id` hiện cho đổi `code` (PT-031). Nếu dùng `code` làm tham chiếu thì đổi mã làm mồ côi mọi khách/lịch hẹn đã tham chiếu | **Khóa bất biến mã dự án sau khi tạo** (chỉ đổi hoa/thường được; đổi khác thì 400 `PROJECT_CODE_IMMUTABLE`); migration không đổi giá trị mã hiện có. Phương án khác: giữ sửa được và cập nhật dây chuyền toàn bộ khách và lịch hẹn trong một transaction mỗi lần đổi mã (nặng, nhiều rủi ro) | Quản trị không còn sửa được mã dự án (vẫn sửa được tên) | FR-40, FR-46 |
| Q2 | **Khu vực chưa có `code`** (Plan giả định đã có): chỉ có `adminCode` và `seedKey` | Thêm `areas.code` bất biến, tự sinh từ tên (34 tỉnh seed có mã xác định), điền bằng migration `007`, không cho Quản trị nhập | Nếu muốn Quản trị tự đặt mã khu vực thì thêm field vào form tạo (không ảnh hưởng dữ liệu cũ) | FR-40 |
| Q3 | Plan nói "đổi tham chiếu sang `code`"; thiết kế giữ **ghi kép** (id và `code`), API nhận cả hai trong suốt v1.0.4, **chưa gỡ** trường id/index id | Giữ id đến bản thu hẹp sau (Zero-Downtime Schema, PWA cũ còn cache, đường lùi image cũ) | Nếu bắt buộc gỡ id ngay v1.0.4 thì mất đường lùi L1 và phải chặn PWA cũ | FR-40 |
| Q4 | Plan nói `CUSTOMER_ASSIGNED` có push khi "duyệt đề nghị tham gia". **Code thật** khi duyệt đi qua `applyInSession` → phát `CUSTOMER_ASSIGNED` cho người gửi, **đồng thời** phát `CARE_TEAM_JOIN_RESOLVED` (kết quả duyệt). Người gửi có hai thông báo trong app, chỉ thông báo `CUSTOMER_ASSIGNED` có push | Giữ nguyên hai thông báo (không đổi hành vi hộp thông báo) | Muốn gộp còn một thông báo thì phải đổi nội dung `CARE_TEAM_JOIN_RESOLVED` khi duyệt | FR-43, FR-44 |
| Q5 | Chống bão push khi thêm hàng loạt người cùng chăm sóc: Plan cho phép "gộp hoặc giới hạn". **Mẫu push gộp** là một chuỗi thứ năm ngoài 4 mẫu của Plan | **Giới hạn** tối đa 3 push cho mỗi (người, đợt hàng loạt), không thêm mẫu mới | Duyệt mẫu gộp ("Bạn được thêm vào nhóm chăm sóc của nhiều khách.") thì chỉ còn một push/đợt, thêm job trễ ~20 giây | FR-43 |
| Q7 | Mã hóa `auth` của subscription bằng `PiiCryptoService` (dùng `CRM_PII_ENCRYPTION_KEY`), đưa phụ thuộc từ `notifications` sang `crm/common/crypto` | Mã hóa `auth`, `p256dh` để rõ; cờ push và CRM đều phải bật nên khóa có sẵn | Lưu `auth` rõ (đơn giản hơn nhưng lộ bí mật chia sẻ nếu lộ DB) | FR-01 |
| Q8 | Plan FR-21 "GET danh mục CRM đọc role từ DB" chưa nói rõ phạm vi | `@ActiveCrmUser()` (kiểm ACTIVE + còn role CRM theo DB) cho 7 GET danh mục (tình trạng, nguồn, kết quả liên hệ, khu vực, dự án, thẻ, trường chân dung); route ADMIN ngoài CRM dùng `@AdminOnly()` | Nếu chỉ muốn route ADMIN-only thì bỏ phần `@ActiveCrmUser()` | FR-21 |
| Q9 | Thêm hai phụ thuộc: `web-push` (thuần JS) và `sharp` (native, dựng sẵn cho Node 24 Debian slim) | Dùng cả hai, `devops-agent` chạy `npm audit` và kiểm Docker build | Nếu không chấp nhận `sharp` thì thumbnail dùng thư viện thuần JS (chậm, tốn bộ nhớ hơn) | FR-02, FR-26 |
| Q10 | `deploy.sh` cảnh báo "không quay về code/image cũ khi dữ liệu Mongo đã được migrate". Với A0 (chỉ thêm field/index) lùi về image v1.0.3 vẫn an toàn (5.1.7) | Ghi vào runbook ngoại lệ này cho migration `007`/`008`/`009`; `devops-agent` chỉnh thông điệp của script nếu Oniichan đồng ý | Giữ cảnh báo gốc thì L1 chỉ dùng được sau khi `devops-agent` xác nhận bằng bản sao | FR-40 |
| Q11 | Endpoint `POST /push-subscriptions/:id/test` ("Gửi thử") trong bản nháp đầu **không thuộc FR nào** | **Mặc định đã chọn: BỎ khỏi thiết kế, ghi ngoài phạm vi v1.0.4.** Lý do: Plan FR-43/FR-06 chốt danh mục đóng 4 loại, một push "Thông báo thử" là loại thứ năm; nghiệm thu bằng thao tác thật (phân khách cho tài khoản thử) | Nếu Oniichan muốn có nút "Gửi thử" thì phải thêm FR mới vào Plan (mã `FR-50`), thêm endpoint (`202`, 3 lần/phút/người, `409 PUSH_DISABLED`), nút FE và một mẫu cố định không PII | FR-09, FR-12, FR-43 |
| Q12 | Chuỗi dự phòng `Bạn có thông báo mới` (khi quét PII chặn nội dung, và khi service worker nhận payload sai định dạng) và "mẫu gộp" của Q5 trong bản nháp đầu bị coi như mẫu thứ năm | **Mặc định đã chọn:** danh sách đóng **4 loại, 4 mẫu** (Plan 2.1.1, FR-06). `Bạn có thông báo mới` chỉ là **lưới an toàn kỹ thuật** (không thuộc danh mục, không có công tắc, không tạo thông báo mới, chỉ thay nội dung của push vốn thuộc một trong 4 loại), không phải mẫu thứ năm. **"Mẫu gộp" bỏ khỏi thiết kế và khỏi unit test** cho tới khi Oniichan duyệt Q5 phương án gộp | Nếu Oniichan không chấp nhận cả chuỗi dự phòng: khi quét PII chặn thì **không gửi push** (`SKIPPED`, vẫn có trong hộp thông báo) và service worker bỏ qua payload sai (không `showNotification`: rủi ro iOS thu hồi subscription, vì vậy KHÔNG khuyến nghị) | FR-06, FR-43 |

(Không đánh số Q6: dành cho mâu thuẫn tài liệu, xử lý ở 11.2 vì đã chốt theo Plan, không cần Oniichan quyết.)

### 11.2 Mâu thuẫn đã xử lý theo Plan hoặc chuẩn (không cần quyết, ghi để truy vết)

| # | Mâu thuẫn | Cách xử lý | FR |
|---|---|---|---|
| Q6 | Tài liệu 04, 05, 06 của module 06 vẫn mô tả **FCM, APNs, Firebase, `device_tokens`, `/device-tokens`, `FcmPushProvider`** (**L3: danh sách dòng dưới đây chỉ là GỢI Ý tại thời điểm audit, không đầy đủ và có thể đã lệch; coder bắt buộc `grep` lại toàn bộ `FCM|APNs|Firebase|device_tokens|device-tokens|FcmPushProvider` trong 04/05/06 trước khi sửa**; ví dụ 04 dòng 8, 898, 911, 939, 944 chưa có trong danh sách này) (04 các dòng 23, 52–66, 78, 112, 140, 184, 350, 609–629, 812, 922, 930, 967, 1000; 05 dòng 230–231, 328, 332; 06 dòng 13, 17, 30, 56) | Chốt theo Plan: **Web Push VAPID**, `push_subscriptions`, `/push-subscriptions`, `WebPushProvider`; sửa tài liệu ở C-4 (FR-13). Push cho app native (FCM/APNs) thuộc M9 | FR-13, FR-02 |
| 11.2-2 | `docker-compose.yml` hard-code `FEATURE_CRM_PUSH=false`, trái với Plan "bật qua biến môi trường" | Đổi thành `${CRM_PUSH_ENABLED:-false}` (5.8) | FR-07 |
| 11.2-3 | Plan FR-05 "tự xóa" subscription vs skill "không DELETE cứng" | Thu hồi mềm (`revokedAt`) rồi xóa cứng bằng TTL/job vì là dữ liệu kỹ thuật (tiền lệ `notifications`, `reminders`); ghi ở mục 7 | FR-05 |
| 11.2-4 | Plan "retry tối đa 5 lần" vs mặc định queue 3 lần | Queue `push` đặt riêng 5 lần, backoff mũ + jitter | FR-03 |
| 11.2-5 | `dedupeKey` của `createMany` hiện tùy chọn, Plan quy tắc 18 bắt buộc | Dispatcher bắt buộc; bảng khóa ở 5.2 | FR-44 |
| 11.2-6 | `PushProvider` hiện không có `send` | Mở rộng giao diện (5.4), `NoopPushProvider` giữ nguyên hành vi | FR-02 |
| 11.2-7 | Plan 2.1.1 giả định mã `CUSTOMER_ASSIGNED` tách được tình huống push; code thật có một đường chung `notifyAssigned` cho thêm đơn, duyệt và bulk | Dispatcher quyết bằng `pushWhen(context)`; `origin` thêm vào `CareTeamMutation` | FR-43 |
| 11.2-8 | `inApp = false` cho một loại thì không có thông báo và cũng không có push (push đi theo thông báo gốc) | Trang cài đặt chỉ chỉnh `push`; ghi mô tả API | FR-10 |
| 11.2-9 | Cập nhật PWA theo chế độ "prompt": thiết bị chưa bấm "Cập nhật" chưa có xử lý `push` | Ghi vào runbook C-3; thử thật sau khi cập nhật | FR-09 |
| 11.2-10 | Nâng phiên bản lưu cục bộ (A0-FE) làm mất bộ lọc đã lưu một lần | Chấp nhận, ghi chú phát hành | FR-40 |
| 11.2-11 | Migration `007` gặp tham chiếu mồ côi (không kỳ vọng vì danh mục chỉ xóa mềm) | Dừng ở lỗi, liệt kê id (không PII); xử lý rồi chạy lại | FR-40 |

### 11.3 Rủi ro chính

| # | Rủi ro | Giảm thiểu | FR |
|---|---|---|---|
| R1 | A0 chạm nhiều module, mốc phát hành chờ A0 | Thiết kế xong ở mục 5.1; ghi kép giữ đường lùi; chạy thử bản sao; tách A0-BE-2/3, MIG, FE chạy song song | FR-40 |
| R2 | Sửa `withTransaction` (dùng chung) có thể gây hồi quy ở mọi nghiệp vụ | Thay đổi cộng thêm (không đổi chữ ký), test chuyên biệt `with-transaction.integration.spec`, `qa-agent` rà | FR-03 |
| R3 | Redis/BullMQ lỗi làm push dừng | Outbox `PENDING` + `push.sweep`; nghiệp vụ không bị chặn; readiness đã kiểm Redis | FR-03 |
| R4 | Bật cờ production cho mọi người cùng lúc, không thử trước | Tắt nhanh bằng biến (5.8); điều kiện FR-14, 15, 16 xong trước; theo dõi `pushStatus` | FR-07 |
| R5 | iOS: push chỉ khi PWA đã cài, quyền qua thao tác bấm, thời gian đến không đảm bảo | Máy trạng thái FE; luôn `showNotification`; Oniichan đã chấp nhận | FR-09 |
| R6 | `sharp` native trong Docker, bộ nhớ khi xử lý ảnh | Prebuilt binary, `concurrency` thấp, `limitInputPixels`, ảnh ≤ 5 MB | FR-26 |
| R7 | Tên khách hiện trên màn khóa | Oniichan đã chấp nhận; quét PII chặn mọi dữ liệu khác | FR-06 |
