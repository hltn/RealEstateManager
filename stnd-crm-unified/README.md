# STND CRM Unified — prototype thiết kế trên nền Admin App

Prototype **chỉ để thiết kế** (không backend, không test) cho module **Quản lý khách hàng (CRM)**, dựng **trên nền code thật** của `../RealEstateAdminApp/` (chỉ sao chép, không sửa bản gốc).

- Khung (sidebar, header, theme sáng/tối, toast, modal, bảng, phân trang…) và **toàn bộ màn admin cũ** là bản sao nguyên vẹn từ Admin App.
- Module CRM (port từ 2 template Stitch) nằm riêng trong `src/modules/crm/`, cắm vào khung Admin qua router + 1 mục sidebar.
- Mọi request `axios` được **mock adapter** trả lời (`src/mocks/`).
- Chuẩn phong cách: [`docs/06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md`](../docs/06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md) (gọi tắt **tài liệu 03**).

---

## 1. Cách chạy

```bash
npm install
npm run dev      # vite — http://localhost:5173 (mở thẳng /crm/today, đã đăng nhập sẵn tài khoản mock ADMIN)
npm run lint     # tsc -b (TypeScript, noUnusedLocals/Parameters, erasableSyntaxOnly)
npm run build    # tsc -b && vite build -> dist/
```

Stack (giống Admin App): Vite 8, React 19, TypeScript 6, Tailwind CSS v4 (`@tailwindcss/vite` + `@tailwindcss/typography`), react-router-dom 7, @tanstack/react-query 5, zustand 5, axios, lucide-react, react-hot-toast, react-helmet-async, flatpickr, react-hook-form + zod, react-markdown. **Không có** vitest/testing-library — prototype không viết test.

## 2. Kiến trúc

```
src/
├── main.tsx              # = Admin + [Prototype] gắn mockAdapter vào apiAxios + seed phiên đăng nhập
├── App.tsx               # = Admin + "/" -> /crm/today, Raw Articles -> /raw-articles, nhóm route /crm/*
├── index.css             # = Admin (nguyên tệp) + khối "[Prototype] Bổ sung cho module CRM" ở cuối
├── api/ components/{ui,common,auth,google-drive,header} context/ hooks/ icons/ images/
│   layout/ screens/ stores/ types/ utils/      # CHÉP NGUYÊN từ RealEstateAdminApp/src (bỏ *.test.*)
├── mocks/
│   ├── mockAdapter.ts    # AxiosAdapter: chuẩn hoá request -> bảng route -> handler -> AxiosResponse/AxiosError
│   ├── types.ts utils.ts # MockRoute/MockRequest/MockResponse; paginate(), filterBySearch(), ok(), fail()…
│   ├── mockUser.ts       # tài khoản mock ADMIN dùng chung cho seed + /auth/*
│   ├── data/             # dữ liệu mẫu: news.ts (nguồn, tin thô, bài WP, lịch sử phân tích), knowledge.ts
│   └── handlers/         # 1 file / domain: auth, googleDrive, users, settings, newsSources,
│                         # newsManager, knowledgeArticles, externalLogs (+ shared.ts); index.ts gộp bảng route
└── modules/crm/          # MODULE CRM (alias import `@crm/*`)
    ├── CrmLayout.tsx     # layout route /crm: CrmProvider + <Outlet/> + CrmBottomNav (mobile) + GlobalModals
    ├── routes.ts         # ViewId <-> URL: buildCrmPath(), matchCrmPath(), CRM_CHILD_ROUTES
    ├── navigation.ts     # VIEW_TITLES, MODULE_TAB_ITEMS (icon lucide), CRM_SIDEBAR_SUB_ITEMS
    ├── components/       # CrmModuleTabs, CrmBottomNav, GlobalModals, Call/Zalo/QuickNote/Lightbox/AdvancedFilter modal
    ├── store/            # CrmProvider (context + useReducer, localStorage), crmActions, selectors, hooks
    ├── types/ data/ lib/ hooks/       # mô hình dữ liệu CRM, mock CRM, hàm thuần, useIsMobile/useContactActions…
    └── screens/          # <Screen>/index.tsx + .desktop.tsx + .mobile.tsx (+ _placeholder cho màn chưa port)
```

Các sửa đổi trên code chép từ Admin đều đánh dấu `[Prototype]` (tìm bằng `grep -rn "\[Prototype\]" src`):

| Tệp | Thay đổi |
|---|---|
| `main.tsx` | `apiAxios.defaults.adapter = mockAdapter`; `useAuthStore.setState({ accessToken, user, isInitialized: true })` trước render |
| `App.tsx` | index `/` -> `Navigate /crm/today`; Raw Articles chuyển sang `/raw-articles`; thêm nhóm route `/crm/*` |
| `layout/AppSidebar.tsx` | thêm mục đầu "Quản lý khách hàng" (icon `GroupIcon` cùng bộ SVG sidebar) có submenu; Raw Articles trỏ `/raw-articles`; mục con CRM sáng cả với route con (`/crm/customers/:id`) |
| `index.css` | nối thêm khối token CRM (typography Stitch, surface, `.material-symbols-outlined`) — ghi đè `--text-title-md` thành 18px (Admin không dùng token này) |
| `index.html` | `lang="vi"`, đổi title, tạm giữ link font Material Symbols (TODO) |
| `components/google-drive/ExportButton.tsx` | bỏ khối "Success" lặp (code chết gây TS2339) + `handleReset` không dùng (TS6133) — lỗi có sẵn ở bản gốc, bản gốc không lộ vì `tsc` dừng ở lỗi cú pháp của 1 file test |
| `screens/MarketAnalysisWorkflowScreen.tsx` | biến `historyId` không tồn tại (TS2552) -> so với `item._id` của dòng đang export |

### 2.1 Mock backend (`src/mocks`)

```
apiAxios.get('/users?page=1&limit=20')
  └─ mockAdapter(config)
       ├─ parseUrl: bỏ baseURL/`/api/v1`, tách path + query (gộp config.params)
       ├─ duyệt mockRoutes: route đầu tiên khớp method + regex  -> handler({ path, query, params, body })
       ├─ không khớp -> console.warn("[mock] Chưa có handler…") + GET trả { data: [], meta }, còn lại {}
       ├─ trễ 250ms (để thấy skeleton/loading)
       └─ status < 400 -> AxiosResponse ; status >= 400 -> ném AxiosError (body { statusCode, message, timestamp, path })
```

- Danh sách trả đúng `{ data, meta: { total, page, limit, totalPages } }` (`mocks/utils.ts#paginate`) như `utils/fetchPaginated.ts` mong đợi.
- Dữ liệu mẫu là mảng trong bộ nhớ: POST/PUT/PATCH/DELETE sửa trực tiếp → thao tác trên màn có hiệu lực tới khi F5.
- Job chạy nền (crawl, analyze, market analysis workflow, pipeline KB…) trả trạng thái **kết thúc** để polling dừng.
- `/auth/login` luôn thành công (đăng xuất rồi đăng nhập lại bằng bất kỳ email/mật khẩu nào). `/google-drive/status` -> `{ connected: false }`.
- Thêm endpoint: tạo/mở file trong `mocks/handlers/`, thêm `{ method, pattern: /^\/duong-dan\/([^/]+)$/, handler }` (route cụ thể đặt **trước** route có tham số), gộp vào `handlers/index.ts` nếu là file mới.
- Tắt mock (khi có backend thật): bỏ 2 dòng `[Prototype]` trong `main.tsx`.

### 2.2 Module CRM trong khung Admin

| Viewport | Hành vi |
|---|---|
| `>= 1024px` | Khung Admin gốc: sidebar cố định 290px (thu gọn 90px), header 1 hàng. Màn CRM có `CrmModuleTabs` (tab gạch chân) |
| `768–1023px` | Khung Admin gốc: sidebar dạng drawer, header 2 hàng |
| `< 768px` | Header + drawer **của Admin** (`AppHeader`/`AppSidebar`). Thêm `CrmBottomNav` cố định đáy (chỉ trên `/crm/*`, ẩn ở màn chi tiết/form) + `pb-20` cho nội dung |

**Route CRM** (khai báo trong `App.tsx`, đường dẫn sinh từ `modules/crm/routes.ts`):

| ViewId | URL | Màn |
|---|---|---|
| `today` | `/crm/today` (mặc định, `/` và `/crm` chuyển về đây) | `DailyTasks` |
| `customers` | `/crm/customers` | `Customers` |
| `create_customer` | `/crm/customers/new` | `CreateCustomer` |
| `customer_detail` | `/crm/customers/:customerId` | `CustomerDetail` |
| `edit_persona` | `/crm/customers/:customerId/persona` | `EditPersona` |
| `edit_investment` | `/crm/customers/:customerId/investment` | `EditInvestment` |
| `appointments` | `/crm/appointments` | `Appointments` |
| `create_appointment` | `/crm/appointments/new` | `CreateAppointment` |
| `reports` | `/crm/reports` | `Reports` |
| `projects` | `/crm/projects` | `Projects` |
| `ai_config` | `/crm/ai-config` | `CrmAiConfig` (khác màn `/ai-config` của Admin) |

**Store CRM điều hướng bằng react-router (cầu nối `CrmRouterBridge`)** — màn KHÔNG đổi API, vẫn gọi `navigate(view)`, `goBack()`, `selectCustomer(id)`:

1. `CrmProvider` nằm trong `BrowserRouter` (layout route `/crm`), lấy `useNavigate()` + `useLocation()` và truyền `router = { navigateTo(path), goBack() }` vào `createCrmActions`.
2. `navigate(view)` → `router.navigateTo(buildCrmPath(view, selectedCustomerId))`; `selectCustomer(id)` → `/crm/customers/:id`.
3. `goBack()` → `navigate(-1)` nếu còn lịch sử trong app (`history.state.idx > 0`), ngược lại về màn cha (`PARENT_VIEW_BY_VIEW`) bằng `replace`.
4. **URL là nguồn sự thật**: `useCurrentView()` = `matchCrmPath(location.pathname)`; `selectedCustomerId` bị ghi đè bởi `:customerId` trên URL → F5 / copy link ở màn chi tiết vẫn đúng khách. Reducer không còn `currentView`, `viewHistory`, `toasts`.
5. `showToast({ title, message?, type })` của store gọi `react-hot-toast` (Toaster toàn cục ở `main.tsx`).

## 3. Quy ước khi port màn CRM (bước sau)

Nguồn chuẩn: **tài liệu 03** (mục 2, 4, 5, 7). Nguồn tham khảo bố cục: 2 template Stitch (`screens/screenSources.ts`).

1. **Ưu tiên component có sẵn của Admin**, chỉ làm mới thứ tài liệu 03 mục 10 ghi "Làm mới":
   - Bảng: vỏ `overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]`, `thead tr.bg-gray-50.dark:bg-gray-900`, `th.px-5.py-3.text-theme-xs.font-medium.text-gray-500.uppercase`, `tbody.divide-y.divide-gray-100.dark:divide-white/[0.05]`; tải: `components/common/TableSkeletonRows`; phân trang: `components/common/Pagination`.
   - Hộp thoại: `components/ui/modal` (`<Modal isOpen onClose className="max-w-lg p-6">`). Dropdown: `components/ui/dropdown`. Chọn ngày: `components/ui/DatePicker`.
   - Toast: `react-hot-toast` (`toast.success/error`) hoặc `useCrmActions().showToast`. **Không** viết toast/hộp thoại tự chế.
   - Tab module: `@crm/components/CrmModuleTabs` (mẫu `KnowledgeConfigScreen.tsx:672-689`).
2. **Mẫu lớp Tailwind** (tài liệu 03 mục 5): đầu trang `h2.text-title-sm.font-semibold.text-gray-800.dark:text-white/90` + mô tả `text-theme-sm text-gray-500 dark:text-gray-400`; thẻ `rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]`; nút chính `rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600`; nút viền `border border-gray-200 … dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5`; chip trạng thái `rounded-full px-2.5 py-1 text-xs font-medium bg-success-50 text-success-600 dark:bg-success-500/10`; ô nhập lọc `px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-brand-500`.
3. **Bắt buộc cặp `dark:` cho mọi màu** (app mặc định chạy **tối**). Chỉ dùng token `brand/gray/success/error/warning`; không dùng `red/emerald/amber/blue/indigo` cho ý nghĩa trạng thái; không dùng `info-*`, `dark-900` (không tồn tại).
4. **Icon: lucide-react** (import từng icon, vd `import { Phone } from 'lucide-react'`). Không thêm Material Symbols; khi màn cuối cùng hết `material-symbols-outlined` thì xoá link font trong `index.html` + khối CSS cuối `index.css`.
5. Typography: `text-title-sm` (tiêu đề trang), `text-theme-sm` (thân, ô bảng), `text-theme-xs` (nhãn/cột). Token Stitch (`text-body-md`, `text-label-xs`, `text-headline-sm`, `bg-surface-container-*`) chỉ để màn cũ chạy — không dùng cho code mới.
6. z-index: hộp thoại dùng `Modal` (z-99999); thanh đáy `z-40`; không đặt `z-[100]`, `z-[60]`.
7. Dữ liệu CRM: qua hook `@crm/store` (`useCrmState`, `useCrmActions`, `useFilteredCustomers`, `useSelectedCustomer`…); điều hướng qua `navigate(view)` / `<Link to={buildCrmPath(view, id)}>`; không gọi API trong `useEffect`.
8. Mobile: màn chi tiết/form (ViewId trong `CRM_SUB_VIEWS`) không có bottom nav, tự vẽ thanh CTA đáy; màn tab chính có bottom nav — đừng đặt nội dung `fixed bottom-0` ở các màn này.
9. **Không viết test.** Không sửa `RealEstateAdminApp/`. Sửa code chép từ Admin chỉ khi bắt buộc và đánh dấu `[Prototype]`.

## 4. TODO còn lại

- Port nội dung các màn CRM còn placeholder (`DailyTasks`, `Appointments.mobile`, `CreateAppointment`, `EditPersona`, `EditInvestment`, `Reports`, `Projects`, `CrmAiConfig`) theo mục 3.
- Đổi `material-symbols-outlined` → lucide-react trong `src/modules/crm` (≈50 tệp), rồi xoá link font + khối CSS tạm.
- Thêm cặp `dark:` cho các màn CRM đã port (Customers, CustomerDetail, CreateCustomer…) và nội dung Call/Zalo/QuickNote modal.
- `LightboxModal`, `AdvancedFilterModal`, bottom sheet `QuickNoteModal` (mobile) còn vỏ tự viết theo Stitch.
- Màn chi tiết/form CRM trên mobile đang có 2 header (header Admin + header riêng của màn) — quyết định giữ/bỏ header riêng khi port.
- Ở `npm run dev`, `/market-analysis-workflow` in 1 dòng đỏ `Query error: CanceledError` — do chính màn Admin `console.error` khi React Query huỷ request lần mount đầu của StrictMode (bản gốc cũng vậy; không xuất hiện ở bản build). `ManageWpScreen` còn `console.log` debug của bản gốc.
- `NotificationDropdown` (chép từ Admin) dùng ảnh `/images/user/*.jpg` không tồn tại → ảnh hỏng khi mở chuông (lỗi có sẵn ở Admin).
