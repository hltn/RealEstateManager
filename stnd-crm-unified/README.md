# STND CRM Unified — prototype thiết kế trên nền Admin App

Prototype **chỉ để thiết kế** (không backend; chỉ có unit test vitest cho lớp API/hook/lib, chạy `npm test`) cho module **Quản lý khách hàng (CRM)**, dựng **trên nền code thật** của `../RealEstateAdminApp/` (chỉ sao chép, không sửa bản gốc).

- Khung (sidebar, header, theme, toast, modal, bảng, phân trang…), **toàn bộ module CRM (giao diện + hành vi người dùng)** và các màn Admin là bản sao của Admin App ở commit `6eed7bf` (2026-10-31).
- **Khác app chính ở đúng một chỗ: dữ liệu.** App chính gọi API thật (`modules/crm/api/http/*` + React Query); prototype giữ nguyên bề mặt `@crm/api` (tên hook/hàm, tham số, kiểu trả về, mã lỗi + thông điệp tiếng Việt) nhưng chạy trên **store mock** trong trình duyệt. Nhờ đó màn chép từ app chính chạy **nguyên văn**.
- Mọi request `axios` còn lại (Admin: users, auth, tin tức…) được **mock adapter** trả lời (`src/mocks/`).
- Chuẩn phong cách: [`docs/06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md`](../docs/06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md) (gọi tắt **tài liệu 03**).

---

## 1. Cách chạy

```bash
npm install
npm run dev      # vite — http://localhost:5174 (cổng cố định `strictPort`, khớp .claude/launch.json, không đụng cổng 5173 của app chính); mở thẳng /crm/today, đã đăng nhập sẵn Quản trị
npm run lint     # tsc -b (TypeScript, noUnusedLocals/Parameters, erasableSyntaxOnly)
npm run build    # tsc -b && vite build -> dist/
```

Stack (giống Admin App): Vite 8, React 19, TypeScript 6, Tailwind CSS v4, react-router-dom 7, @tanstack/react-query 5, zustand 5, axios, lucide-react, react-hot-toast, react-helmet-async, flatpickr, react-hook-form + zod. Có vitest + testing-library (jsdom) cho unit test lớp API/hook/lib/storage (`npm test`).

**Giao diện mặc định SÁNG** (`ThemeContext` đọc theme đã lưu ngay trong initializer + script inline ở `index.html` để không nháy); chuyển tối bằng nút mặt trăng ở header (lưu `localStorage["theme"]`).

### Tài khoản mẫu (đăng nhập giả)

Mở app = đã đăng nhập **Admin**. Đổi tài khoản ngay trong app: menu avatar (góc phải header) → mục **"Tài khoản mẫu [Prototype]"** (đổi tức thì, không tải lại, tự chuyển về `/crm/today`). Nút **"Đặt lại dữ liệu mẫu"** cùng chỗ (có hộp xác nhận) chỉ xóa các khóa `stnd_crm_proto_*` của prototype rồi nạp lại bộ ban đầu; khóa của app chính (`stnd_crm_data`, `stnd_crm_session_v1`, `stnd_crm_pii_sim_v1`) không bao giờ bị đọc/ghi/xóa. **Vì sao cần nút này:** dữ liệu mẫu dựng TƯƠNG ĐỐI theo thời điểm nạp lần đầu và được lưu localStorage, nên sau vài ngày các cột Hôm nay / Quá hạn / Sắp tới bị lệch — đặt lại để dựng lại theo ngày hiện tại. Trang `/login` đăng nhập được bằng email dưới đây + **mật khẩu bất kỳ**; email lạ → 401, tài khoản khóa → 403.

| Tài khoản | Email | Vai trò | Nhóm | Ghi chú xem gì |
|---|---|---|---|---|
| Admin | `admin@stnd.vn` | ADMIN | — | Thấy tất cả; Cài đặt, Dự án, Khách đã xóa, Quản lý tài khoản |
| Admin2 (Trần Minh Khoa) | `tran.minh.khoa@stnd.vn` | ADMIN + EDITOR | — | Quản trị thứ 2 (để thử gỡ/khóa Quản trị) |
| Hạnh | `hanh.tran@stnd.vn` | MANAGER | KD1 (quản lý KD1) | Quản lý nhóm 1 |
| Minh | `minh.le@stnd.vn` | MANAGER | KD2 (quản lý KD2) | Quản lý nhóm 2; có đề nghị tham gia chờ duyệt |
| **Huy** | `huy.bui@stnd.vn` | **MANAGER + STAFF** | KD3 (quản lý), KD1 | Nhiều vai trò + nhiều nhóm |
| Thảo, Tuấn, Trang | `thao.phan@`, `tuan.nguyen@`, `trang.nguyen@stnd.vn` | STAFF | KD1 | Nhân viên |
| Tùng, Vy, Quân | `tung.vu@`, `vy.do@`, `quan.tran@stnd.vn` | STAFF | KD2 | Nhân viên |
| **Khoa** | `khoa.dang@stnd.vn` | STAFF | KD2 + KD3 | Nhân viên thuộc 2 nhóm |
| **Lan** | `lan.ngo@stnd.vn` | **STAFF + EDITOR** | KD3 | Thấy cả CRM lẫn tin tức |
| Phúc | `phuc.vo@stnd.vn` | STAFF | KD3 | **Đã khóa** (không đăng nhập được) |
| Lê Thu Hà, Phạm Quốc Bảo | `le.thu.ha@`, `pham.quoc.bao@stnd.vn` | EDITOR | — | Không có quyền CRM (màn "không khả dụng") |

Nhóm: **KD1, KD2, KD3** (đang dùng) và **DAGIAI** (đã ngừng, 0 thành viên). Dữ liệu CRM mẫu: 16 khách đang dùng (trong đó nhiều khách **Bỏ**, một khách **chưa phân công**, khách thuộc nhóm của Huy/Khoa/Lan), **3 khách đã xóa mềm** (bình thường / đã ẩn danh hóa / xóa vĩnh viễn dở dang), 10 lịch hẹn (có dự án, đã hủy, đã hoàn thành kèm kết quả), 1 đề nghị tham gia nhóm chăm sóc, thông báo cho từng tài khoản, **34 tỉnh/thành** ở danh mục Khu vực.

---

## 2. Kiến trúc

```
src/
├── main.tsx              # = Admin + [Prototype] gắn mockAdapter vào apiAxios + seed phiên đăng nhập (Admin)
├── App.tsx               # = Admin (buildCrmRoute/buildNotificationsRoute) + [Prototype] "/" -> /crm/today, Raw Articles ở /raw-articles
├── index.css, layout/, components/{ui,common,auth,google-drive,header,users}, context/, hooks/, screens/, stores/, types/, utils/
│                         # CHÉP từ RealEstateAdminApp/src (bỏ *.test.*); chỗ khác app chính đánh dấu [Prototype]
├── mocks/
│   ├── mockAdapter.ts    # AxiosAdapter: chuẩn hoá request -> bảng route -> handler -> AxiosResponse/AxiosError (trễ 250ms)
│   ├── mockUser.ts       # toAuthUser() + MOCK_USER: dựng phiên đăng nhập từ SEED_USERS của store CRM
│   ├── data/ handlers/   # tin tức/knowledge/…; users.ts + auth.ts đọc CHUNG tài khoản với store CRM
└── modules/crm/          # MODULE CRM (alias import `@crm/*`) — giao diện = app chính, dữ liệu = store mock
    ├── crmRoute.tsx CrmLayout.tsx routes.ts navigation.ts   # = app chính
    ├── api/              # LỚP DỮ LIỆU `@crm/api` — chạy trên store mock (xem mục 3)
    │   ├── index.ts      # cùng bề mặt export với app chính
    │   ├── hooks.ts      # useCatalogs, useCustomerList, useCrmApi… (đồng bộ, không React Query)
    │   ├── crmWriteApi.ts# hàm ghi (createCustomer, deleteCustomer, addTeamMember…) -> Promise<ApiResult<T>> có trễ 180ms
    │   ├── queries.ts dailyTasks.ts   # "máy chủ giả" đọc: lọc/sắp xếp/phân quyền phạm vi khách -> đúng kiểu view của app chính
    │   ├── access.ts actor.ts catalogAdmin.ts assignable.ts
    │   ├── dashboard.ts exports.ts mockHooks.ts mockCrmApi.ts  # Báo cáo + nhập/xuất file (mock có cờ cả ở app chính)
    │   └── types.ts http/{crmErrors,projectBody}.ts   # giữ đường dẫn để màn chạy nguyên
    ├── store/            # Zustand + reducer thuần + localStorage (khóa riêng `stnd_crm_proto_*`, schema v6)
    ├── data/             # seedCatalogs (tài khoản, nhóm, danh mục, 34 tỉnh), mockData (khách, nhật ký, lịch hẹn, thông báo)
    ├── components/ lib/ hooks/ types/ config/   # = app chính (+ trường [Prototype] ở types)
    └── screens/          # = app chính (bản sao nguyên văn, xem mục 4)
```

Các sửa đổi **cố ý** so với app chính đều đánh dấu `[Prototype]` (tìm bằng `grep -rn "\[Prototype\]" src`):

| Tệp | Khác app chính |
|---|---|
| `main.tsx` | `apiAxios.defaults.adapter = mockAdapter`; seed `useAuthStore` (Admin) trước render |
| `App.tsx` | `/` -> `/crm/today` cho tài khoản có role CRM (`PrototypeHome`); thêm `/raw-articles` |
| `components/header/UserDropdown.tsx` + `MockAccountSwitcher.tsx` | Bộ chuyển tài khoản mẫu + "Đặt lại dữ liệu mẫu" (có hộp xác nhận `ConfirmDialog`); không có ở app chính |
| `components/ui/dropdown/DropdownItem.tsx` | Thêm cặp `dark:` + `type="button"` (app chính còn thiếu) |
| `components/ui/DatePicker.tsx` | Bỏ `dark:bg-dark-900` (token không tồn tại) |
| `layout/AppSidebar.tsx` | Raw Articles trỏ `/raw-articles` (vì `/` về CRM) |
| `layout/AppLayout.tsx` | Chỉ thêm chú thích về `min-w-0` (class đã có sẵn ở app chính: bảng rộng không đẩy trang tràn ngang) |
| `modules/crm/lib/customerRules.ts` | `findNonAssignableUserIds`: người được phân chăm sóc = còn hoạt động VÀ có role Quản lý/Nhân viên, nên tài khoản ADMIN + STAFF vẫn được phân (app chính chặn mọi ADMIN) |
| `modules/crm/screens/DailyTasks/DailyTasks.desktop.tsx` + `api/hooks.ts` (`useDailyTasks`, `useDailyTaskSummary`) | Quản trị mặc định xem phạm vi "Cả nhóm" (team, đúng nhãn ở UI) vì Admin không phụ trách khách riêng (app chính: mặc định "Việc của tôi" cho mọi vai trò) |
| `mocks/mockUser.ts` | Dựng phiên đăng nhập (`AuthUser`) từ tài khoản mẫu `SEED_USERS` của store CRM (app chính nhận từ `/auth/*` thật) |
| `modules/crm/lib/nationalIdVault.ts` | Khóa localStorage kho CCCD mô phỏng đổi thành `stnd_crm_proto_pii_sim_v1` (không trùng khóa app chính) |
| `modules/crm/api/*` | **Toàn bộ lớp dữ liệu là mock** thay `api/http/*` + `httpCrmApi.ts` + React Query (mục 3) |
| `modules/crm/config/featureFlags.ts` | Cờ là hằng số: module/Báo cáo/nhập-xuất BẬT; Zalo ZNS, gọi trong app, đồng bộ lịch, ảnh đính kèm TẮT |
| `modules/crm/routes.ts` | `isValidCustomerId` nhận id mẫu `CUST-001`/`proj-1` (app chính: ObjectId 24 hex) |
| `modules/crm/store/*` | Luôn nạp dữ liệu mẫu và LƯU localStorage; thêm action xóa/khôi phục/xóa vĩnh viễn khách, sửa/xóa nhật ký, dời/xóa lịch, nhóm, thông báo |
| `modules/crm/types/crm.ts` | Trường tùy chọn thêm cho mock (xóa mềm khách, `projectId/outcome/version` lịch hẹn, `editedAt/createdAt` nhật ký, `email` tài khoản; `Team.code/isActive`; `NotificationItem`) |
| `modules/crm/data/*` | Dữ liệu mẫu (không có ở app chính: app chính lấy từ backend) |
| `mocks/handlers/{auth,users}.ts` | Đọc/ghi CHUNG tài khoản với store CRM; luật nghiệp vụ dùng lại `crmWriteApi` |

### 2.1 Mock backend cho Admin (`src/mocks`)

```
apiAxios.get('/users?page=1&limit=20')
  └─ mockAdapter(config)
       ├─ parseUrl: bỏ baseURL/`/api/v1`, tách path + query (gộp config.params)
       ├─ duyệt mockRoutes: route đầu tiên khớp method + regex  -> handler({ path, query, params, body })
       ├─ không khớp -> console.warn("[mock] Chưa có handler…") + GET trả { data: [], meta }, còn lại {}
       ├─ trễ 250ms (để thấy skeleton/loading)
       └─ status < 400 -> AxiosResponse ; status >= 400 -> ném AxiosError (body { statusCode, message, timestamp, path })
```

- `/users` (liệt kê, tạo, khóa, **đặt nhiều role `PATCH /users/:id/roles`**, nhóm `PATCH /users/:id/teams`, sửa tên/email, đặt lại mật khẩu) và `/auth/*` đọc/ghi **cùng danh sách tài khoản** với store CRM: đổi vai trò/nhóm ở "Quản lý tài khoản" hoặc Cài đặt CRM → phạm vi dữ liệu + menu đổi theo. Luật (Quản trị cuối cùng 409 `LAST_ADMIN_REQUIRED`, không tự khóa mình, bỏ MANAGER thì gỡ khỏi quản lý nhóm, mất cả MANAGER/STAFF thì mất nhóm…) nằm ở `crmWriteApi`, handler chỉ đổi sang JSON lỗi chuẩn.
- Thêm endpoint: tạo/mở file trong `mocks/handlers/`, thêm `{ method, pattern: /^\/duong-dan\/([^/]+)$/, handler }` (route cụ thể đặt **trước** route có tham số), gộp vào `handlers/index.ts` nếu là file mới.
- Tắt mock (khi có backend thật): bỏ 2 dòng `[Prototype]` trong `main.tsx` và thay `modules/crm/api` bằng bản của app chính.

---

## 3. Lớp dữ liệu CRM mock (`modules/crm/api`) — cách chép màn từ app chính

Màn của app chính chỉ import dữ liệu từ `@crm/api` (đọc: hook; ghi: `useCrmApi()`), `@crm/store` (trạng thái giao diện: bộ lọc, modal, điều hướng, toast) và vài deep-import (`@crm/api/access`, `@crm/api/mockHooks`, `@crm/api/http/crmErrors`, `@crm/api/http/projectBody`, `@crm/api/dashboard`, `@crm/api/queries`). Prototype giữ **đủ** các đường dẫn và tên đó, nên:

- **Chép nguyên văn** `RealEstateAdminApp/src/modules/crm/screens/<Màn>/**` (bỏ `*.test.*`, thư mục `test/`) vào `src/modules/crm/screens/` — không cần sửa import.
- Hook đọc trả `{ data, isLoading, isFetching, isError, error, refetch }` như app chính; vì tính **đồng bộ** từ store nên `isLoading`/`isError` luôn `false` (nhánh Skeleton/lỗi của màn vẫn có trong code, chỉ không bật). Hook quản trị (`useAdminUsers`, `useTeamMembers`, `useDeletedCustomers`) trả **403 giả** khi người dùng không đủ quyền.
- Hàm ghi (`useCrmApi()`) trả `Promise<ApiResult<T>>` sau 180ms; **kiểm quyền + phạm vi + khóa lạc quan `version` (409 `VERSION_CONFLICT`) + mã lỗi nghiệp vụ** giống backend (`CUSTOMER_PHONE_NOT_SET`, `PRIMARY_LOCKED`, `CARE_TEAM_LIMIT_EXCEEDED`, `CUSTOMER_NOT_DROPPED`, `USER_OUT_OF_TEAM`, `TEAM_NOT_EMPTY`, `CUSTOMER_ANONYMIZED`, `CUSTOMER_PURGE_IN_PROGRESS`, `LAST_ADMIN_REQUIRED`…).
- Người thao tác = **tài khoản mẫu đang đăng nhập** (`auth.store`), đọc LÚC GỌI nên đổi tài khoản có hiệu lực ngay; hồ sơ vai trò/nhóm lấy từ store CRM (`api/actor.ts`).
- **Chưa mô phỏng**: ảnh đính kèm nhật ký (cờ TẮT như app chính mặc định; upload trả 404), Zalo ZNS/gọi trong app, đồng bộ lịch (cờ TẮT), job nền (nhập file chạy đồng bộ ở `mockCrmApi.ts`).

### Đồng bộ lại khi app chính đổi tiếp

```bash
git diff <commit-đã-đồng-bộ> HEAD -- RealEstateAdminApp/src/modules/crm   # xem app chính đổi gì
```

Chép phần **giao diện/hành vi** (screens, components, lib, hooks, types, navigation/routes); **không** chép `api/http/*`, `httpCrmApi.ts`, `api/hooks.ts` (React Query), `api/mockHooks` đã khác có chủ đích (xem bảng). Nếu app chính thêm hook/hàm ghi mới vào `@crm/api` → thêm bản mock tương ứng ở `api/hooks.ts` / `api/crmWriteApi.ts` (+ action ở `store/crmReducer.ts` nếu cần), cùng tên + chữ ký. Đã đồng bộ tới app chính commit **`6eed7bf`**.

## 4. Trạng thái màn CRM (`src/modules/crm/screens/`)

Hiện là **bản sao nguyên văn từ app chính** (`DailyTasks`, `Customers`, `CreateCustomer`, `CustomerDetail`, `EditPersona`, `EditInvestment`, `Appointments`, `CreateAppointment`, `Reports`, `Projects`, `Settings`, `DeletedCustomers`, `Notifications`) chạy trên lớp mock ở trên; `npm run lint` + `npm run build` sạch, đã mở thử mọi route với 6 tài khoản mẫu, không lỗi console. Màn Stitch cũ (`CrmAiConfig`, `*.desktop/mobile` kiểu cũ) không còn (route `/crm/ai-config` bỏ; thay bằng `/crm/settings`, `/crm/deleted-customers`, `/notifications`).

## 5. TODO còn lại

- Skeleton: Skeleton "do dữ liệu" (đang tải danh sách/chi tiết) **không hiện** vì hook mock tính đồng bộ; Skeleton của **Suspense** (nạp chunk màn lười, `ScreenSkeleton`/"Đang tải…") vẫn thoáng hiện lần đầu vào mỗi màn. Muốn xem Skeleton dữ liệu: thêm trễ giả có điều khiển ở `api/hooks.ts`.
- Badge số việc ở tab "Việc hôm nay" luôn dùng phạm vi mặc định theo vai trò (Quản trị: "Cả nhóm") nên có thể lệch với danh sách khi Quản trị chọn "Việc của tôi" (chấp nhận trong prototype).
- Giai đoạn rà soát màn: so sánh từng màn với app chính ở các trạng thái rỗng/lỗi.
- Chọn giữ/bỏ các màn Admin ít liên quan (Cronjob, Knowledge, Request Logs…) trong bản prototype.
- `NotificationDropdown` đã đổi sang thông báo thật (mock); ảnh `/images/user/*.jpg` cũ không còn dùng.
- `/market-analysis-workflow` có thể in lỗi `CanceledError` ở dev do React Query StrictMode (bản gốc cũng vậy).
