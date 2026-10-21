# Design System của web admin STND Real Estate Manager (rút từ code)

> **Nguồn duy nhất:** mã nguồn `RealEstateAdminApp/` (đọc ngày 21/10/2026). Mọi quy tắc đều dẫn `file:dòng`, đường dẫn tính từ `RealEstateAdminApp/src/` nếu không ghi khác. Không suy từ ảnh chụp.
>
> **Phạm vi:** phong cách của toàn bộ web admin, dùng làm chuẩn cho module Quản lý khách hàng (CRM). Mục 9 so sánh với bản cũ, mục 10 liệt kê thứ mà 2 thiết kế Stitch cần nhưng Admin App chưa có.

---

## 1. Công nghệ thực tế

| Hạng mục | Thực tế | Bằng chứng |
|---|---|---|
| Nền tảng | Vite 8, React 19, TypeScript 6 | `../package.json` |
| CSS | **Tailwind CSS v4** qua `@tailwindcss/vite`; cấu hình bằng `@theme` trong `index.css`, **không có** `tailwind.config.js`; có `@tailwindcss/typography` (lớp `prose`) | `index.css:4-5`, `../vite.config.ts:10` |
| Phông | **Outfit** (Google Fonts 100–900), là phông duy nhất (`--font-*: initial`) | `index.css:1, 10-11, 190` |
| Chế độ tối | Lớp `.dark` gắn vào **`<html>`** (`document.documentElement`), biến thể `@custom-variant dark (&:is(.dark *))`. **Mặc định là TỐI** khi chưa có `localStorage.theme` | `index.css:7`, `context/ThemeContext.tsx:18, 24, 34-36` |
| Biểu tượng | **2 bộ song song**: (1) SVG tùy biến của TailAdmin trong `src/icons/*.svg`, nạp bằng `vite-plugin-svgr` (`?react`) — dùng ở menu trái, Login, Quản lý tài khoản; (2) **lucide-react** — dùng ở hầu hết màn còn lại (18 tệp). Ngoài ra nhiều SVG viết thẳng (inline) ở header, modal, alert | `icons/index.ts:1-56`, `layout/AppSidebar.tsx:6-18`, `screens/LoginScreen.tsx`, `screens/UserManagementScreen.tsx:11`, `../vite.config.ts:11-15` |
| Thông báo nhỏ (toast) | `react-hot-toast`, một `<Toaster position="top-right" duration=4000>` toàn cục (≈21 lời gọi `toast.*`) + **một toast tự viết** `ToastNotification` bị chép lặp ở 3 màn | `main.tsx:19`; `screens/ManageWpScreen.tsx:29-97`, `AiPromptConfigScreen.tsx:16`, `KnowledgeArticlesScreen.tsx:84` |
| Biểu mẫu | react-hook-form + zod (Login, Tạo tài khoản); các màn khác dùng `useState` | `screens/UserManagementScreen.tsx:3-5, 30-38` |
| Chọn ngày | flatpickr + react-flatpickr, bọc trong `ui/DatePicker.tsx` (CSS tùy biến ở `index.css:394-557`) | `components/ui/DatePicker.tsx` |
| Dữ liệu | axios (1 instance `api/axios.ts`), @tanstack/react-query, zustand (chỉ auth) | `api/axios.ts:12-16`, `main.tsx:10`, `stores/auth.store.ts` |
| Khác | react-router-dom v7, react-markdown + remark-breaks, react-helmet-async, tailwind-merge (chỉ DatePicker). `clsx` có trong package.json nhưng **không dùng** | `App.tsx`, `components/common/PageMeta.tsx` |

`index.css` còn khối CSS cho ApexCharts, FullCalendar, Swiper, jvectormap (`index.css:302-392, 559-791`) nhưng **chưa cài** các thư viện này — là phần thừa của mẫu TailAdmin. `.glass-panel`, `.text-gradient` (`index.css:795-807`) **không được dùng**.

## 2. Token (`@theme`, `index.css:9-167`)

### 2.1 Màu

| Nhóm | Giá trị (đầy đủ 25–950 trong `index.css`) | Dòng |
|---|---|---|
| `brand` | 25 `#f2f7ff` · 50 `#ecf3ff` · 100 `#dde9ff` · 200 `#c2d6ff` · 300 `#9cb9ff` · 400 `#7592ff` · **500 `#465fff`** · 600 `#3641f5` · 700 `#2a31d8` · 800 `#252dae` · 900 `#262e89` · 950 `#161950` | 45-56 |
| `blue-light` | 50 `#f0f9ff` · 500 `#0ba5ec` · 600 `#0086c9` … | 58-69 |
| `gray` | 25 `#fcfcfd` · 50 `#f9fafb` · 100 `#f2f4f7` · 200 `#e4e7ec` · 300 `#d0d5dd` · 400 `#98a2b3` · 500 `#667085` · 600 `#475467` · 700 `#344054` · 800 `#1d2939` · 900 `#101828` · 950 `#0c111d` · **`gray-dark` `#1a2231`** | 71-83 |
| `orange` (ghi đè mặc định) | 50 `#fff6ed` · 400 `#fd853a` · 500 `#fb6514` … | 85-96 |
| `success` | 50 `#ecfdf3` · 100 `#d1fadf` · 500 `#12b76a` · 600 `#039855` · 700 `#027a48` … | 98-109 |
| `error` | 50 `#fef3f2` · 100 `#fee4e2` · 500 `#f04438` · 600 `#d92d20` · 700 `#b42318` … | 111-122 |
| `warning` | 50 `#fffaeb` · 500 `#f79009` · 600 `#dc6803` · 700 `#b54708` … | 124-135 |
| Khác | `theme-pink-500` `#ee46bc`, `theme-purple-500` `#7a5af8`, `white`, `black` = `#101828` | 40-43, 137-139 |

**Thực tế sử dụng** (đếm lớp trong `.tsx`): `gray` 1416 · `brand` 311 · `success` 111 · `error` 99 · `warning` 17 · `blue-light` 10. **Song song**, bảng màu mặc định của Tailwind vẫn bật và được dùng nhiều: `red` 91 · `emerald` 60 · `blue` 37 · `amber` 36 · `indigo` 16 · `purple` 8 (toast tự viết, StepCard, chip CRAWL/AI, nút "Làm sạch", nút "Xem nguồn").

**Lớp gọi token không tồn tại (lỗi, không có hiệu lực):** `bg-info-50/…`, `text-info-600` (`screens/ManageWpScreen.tsx:920-922` — chip "Đã crawl" hiển thị không màu); `dark:bg-dark-900`, `hover:text-dark-900` (`layout/AppHeader.tsx:258`, `components/ui/DatePicker.tsx:34`, `components/common/ThemeToggleButton.tsx:9`).

### 2.2 Màu theo vai trò (đã đối chiếu code)

| Vai trò | Sáng | Tối | Bằng chứng |
|---|---|---|---|
| Nền trang, chữ thân | `bg-gray-50 text-gray-800` | `dark:bg-gray-900 dark:text-gray-300` | `index.css:190` |
| Viền mặc định mọi phần tử | `gray-200` (base layer) | phải ghi rõ `dark:border-gray-800` hoặc `dark:border-white/[0.05]` | `index.css:183` |
| Sidebar, header | `bg-white` + viền `gray-200` | `dark:bg-gray-900 dark:border-gray-800` | `layout/AppSidebar.tsx:298`, `layout/AppHeader.tsx:159` |
| Thẻ/khối nội dung | `bg-white border-gray-200` | `dark:bg-white/[0.03] dark:border-white/[0.05]` (phổ biến) hoặc `dark:bg-gray-dark dark:border-gray-800` | `screens/CronjobScreen.tsx:58`, `screens/UserManagementScreen.tsx:226` |
| Popover/dropdown | `bg-white`, `shadow-theme-lg`, `rounded-xl/2xl` | `dark:bg-gray-dark dark:border-gray-800` | `components/ui/dropdown/Dropdown.tsx:41`, `components/header/UserDropdown.tsx:67` |
| Hộp thoại | `bg-white` | `dark:bg-gray-900` | `components/ui/modal/index.tsx:54`, `screens/ExternalLogsScreen.tsx:395` |
| Tiêu đề trang | `text-gray-800` | `dark:text-white/90` | `screens/CronjobScreen.tsx:53` |
| Chữ phụ / nhãn | `text-gray-500` | `dark:text-gray-400` | `screens/ExternalLogsScreen.tsx:189, 205` |
| Hành động chính | `bg-brand-500 hover:bg-brand-600 text-white` | như sáng | `screens/UserManagementScreen.tsx:217` |
| Menu đang chọn | `bg-brand-50 text-brand-500` | `dark:bg-brand-500/[0.12] dark:text-brand-400` | `index.css:198-200` |
| Chấm thông báo | `bg-orange-400` + `animate-ping` | — | `components/header/NotificationDropdown.tsx:29-33` |

### 2.3 Chữ (`index.css:23-38`)

| Token | Cỡ / dòng | Số lần dùng | Dùng thật cho |
|---|---|---|---|
| `text-title-sm` | 30/38 | 14 | Tiêu đề trang (`font-semibold`) — `screens/CronjobScreen.tsx:53` |
| `text-theme-sm` | 14/20 | 86 | Mô tả trang, ô bảng, menu — `screens/ExternalLogsScreen.tsx:189` |
| `text-theme-xs` | 12/18 | 62 | Tiêu đề cột, nhãn trường chữ hoa — `screens/ExternalLogsScreen.tsx:205, 309` |
| `text-theme-xl` | 20/30 | **0** | Không dùng |
| `text-title-md/lg/xl/2xl` | 36–72 | **0** | Không dùng |
| Mặc định Tailwind | `text-xl/lg/sm/xs` | nhiều | Tiêu đề modal `text-lg/xl font-bold`, tiêu đề trang "Quản lý tài khoản" `text-xl font-bold` (`screens/UserManagementScreen.tsx:196`) |

### 2.4 Bóng, bo góc, z-index, breakpoint

| Hạng mục | Khai báo | Dùng thật |
|---|---|---|
| Bóng | `shadow-theme-xs/sm/md/lg/xl`, `shadow-focus-ring`, `shadow-tooltip`… (`index.css:141-155`) | `theme-xs` 6, `theme-sm` 2, `theme-md` 3, `theme-lg` 4, **`focus-ring` 0**, `theme-xl` 0; song song `shadow-sm` 8, `shadow-xl` 5, `shadow-2xl` 4 (modal, toast) |
| Bo góc | Mặc định Tailwind | `rounded-lg` 181 (nút, ô nhập), `rounded-full` 106 (chip, công tắc, avatar), `rounded-2xl` 31 (thẻ, bảng, modal tự viết), `rounded-xl` 22 (popover, toast), `rounded-3xl` 2 (Modal chung, thẻ Login) |
| z-index | `--z-index-1…999999` (`index.css:160-166`) | Sidebar `z-50`, backdrop `z-40`, header `z-2`, Modal chung + nút toggle header `z-99999`, modal tự viết `z-50` / `z-[60]` / `z-[100]`, toast tự viết `z-[9999]` — **không theo thang** |
| Breakpoint | `2xsm 375 · xsm 425 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 · 3xl 2000` (`index.css:13-21`) | Bố cục đổi chính ở **`lg` (1024)** |

## 3. Bố cục khung (layout)

```
<html class="dark?"> body.bg-gray-50
└─ div.min-h-screen.xl:flex                         layout/AppLayout.tsx:18
   ├─ AppSidebar (fixed, z-50) + Backdrop (z-40)
   └─ div.flex-1  lg:ml-[290px] | lg:ml-[90px]      layout/AppLayout.tsx:23-27
      ├─ AppHeader (sticky top-0)
      └─ div.p-4.md:p-6.mx-auto.max-w-(--breakpoint-2xl)   layout/AppLayout.tsx:29  → <Outlet/>
```

| Thành phần | Desktop ≥1024 | Tablet 768–1023 | Mobile <768 | Bằng chứng |
|---|---|---|---|---|
| **Sidebar** | `fixed` cao `h-screen`, `px-5`, rộng **290px**; thu gọn **90px** (chỉ icon, logo 32px); rê chuột vào khi thu gọn → mở tạm 290px | Ẩn (`-translate-x-full`), mở dạng **drawer** 290px khi bấm nút menu | Như tablet; drawer bắt đầu dưới header (`mt-16` = 64px); `isExpanded` bị ép `false` khi <768 | `layout/AppSidebar.tsx:297-309`, `context/SidebarContext.tsx:36-43, 68` |
| Nút menu | Bấm → thu gọn/mở rộng (`toggleSidebar`) | Bấm → mở/đóng drawer (`toggleMobileSidebar`) | như tablet | `layout/AppHeader.tsx:129-135` (ngưỡng 1024) |
| Backdrop | — | `fixed inset-0 z-40 bg-gray-900/50 lg:hidden`, bấm để đóng | như tablet | `layout/Backdrop.tsx:9-12` |
| **Header** | 1 hàng, `lg:px-6 lg:py-4`, cao ≈ **76px** (nút 44px + 2×16px), viền dưới; trái: nút menu 44×44 viền + ô tìm 430px (`xl:w-[430px]`) có nhãn ⌘K (Ctrl/⌘+K focus); phải: badge trạng thái job, nút sáng/tối, chuông, avatar | 2 hàng: hàng 1 `px-3 py-3` (≈64px) = nút menu 40px + logo + nút "⋯"; hàng 2 (badge, sáng/tối, chuông, user) **ẩn**, bấm "⋯" mới hiện; **ô tìm ẩn** | như tablet | `layout/AppHeader.tsx:159-286` |
| Vùng nội dung | `p-6` (24px), `max-w` 1536px, căn giữa | `p-6` | `p-4` (16px) | `layout/AppLayout.tsx:29` |
| Nhóm menu | Nhãn "MENU" `text-xs uppercase text-gray-400`; nhóm Prompt (ADMIN/EDITOR) và Admin cách bằng `pt-4 border-t border-gray-100` | | | `layout/AppSidebar.tsx:341-364` |

Ghi chú hành vi: ô tìm ở header **không làm gì** (form không có xử lý, `layout/AppHeader.tsx:235-266`); chuông thông báo là **dữ liệu mẫu tĩnh** của TailAdmin với ảnh `/images/user/*.jpg` **không tồn tại** trong `public/` (`components/header/NotificationDropdown.tsx:90-162`); `SidebarWidget` trả `null`. Tên menu lẫn Anh–Việt (`layout/AppSidebar.tsx:35-99`).

## 4. Catalog component có sẵn

### 4.1 Đang được dùng

| Component | Đường dẫn | Props chính | Ghi chú |
|---|---|---|---|
| `Pagination` | `components/common/Pagination.tsx` | `meta {total,page,limit,totalPages}`, `onPageChange`, `onLimitChange?`, `isDisabled?`, `itemLabel?`, `showSummary?` | Dòng "Hiển thị x-y / n · Trang a/b"; ô "Số dòng" (10/20/50/100, ẩn <md); nút 36×36 `rounded-lg`, trang hiện tại `bg-brand-500 text-white`; có dấu "…" khi >7 trang; tự ẩn khi `total=0` |
| `TableSkeletonRows` | `components/common/TableSkeletonRows.tsx` | `columnCount`, `rowCount=5` | Hàng `<tr>` với thanh `h-4 bg-gray-100 dark:bg-gray-800 animate-pulse` |
| `DatePicker` | `components/ui/DatePicker.tsx` | `value`, `onChange(dateStr)`, `mode: single/multiple/range`, `placeholder`, `className`, `inputClassName` | flatpickr, định dạng `Y-m-d`, icon lucide `Calendar` bên phải |
| `Modal` | `components/ui/modal/index.tsx` | `isOpen`, `onClose`, `className`, `showCloseButton=true`, `isFullscreen` | `rounded-3xl`, nền mờ `bg-gray-400/50 backdrop-blur-[32px]`, `z-99999`, Esc để đóng, khóa cuộn body. **Chỉ** `UserManagementScreen` dùng; nhớ truyền `className="max-w-lg p-6"` |
| `Dropdown` / `DropdownItem` | `components/ui/dropdown/` | `isOpen`, `onClose`, `className` / `tag a|button`, `to`, `onItemClick` | Đóng khi bấm ra ngoài (trừ phần tử `.dropdown-toggle`). `DropdownItem` thiếu lớp `dark:` |
| `ThemeToggleButton` | `components/common/ThemeToggleButton.tsx` | — | Nút tròn 44px viền |
| `UserDropdown`, `NotificationDropdown` | `components/header/` | — | Avatar chữ cái đầu `h-11 w-11 bg-brand-500` (`UserDropdown.tsx:40`) |
| `ProtectedRoute`, `RoleGuard`, `AuthInitializer` | `components/auth/` | `allowedRoles`, `fallback` | Spinner toàn trang `border-4 border-t-brand-500` |
| `GoogleDriveStatusBadge`, `ExportButton`, `FolderInput` | `components/google-drive/` | — | Riêng tính năng phân tích thị trường |
| `PageMeta` / `AppWrapper` | `components/common/PageMeta.tsx` | `title`, `description` | Chỉ `AppWrapper` (HelmetProvider) được dùng; chưa màn nào đặt `<PageMeta>` |
| Hook | `hooks/useDebouncedValue.ts` (400ms), `hooks/useAuth.ts`, `hooks/useHeaderStatusReset.ts` | | |

### 4.2 Có sẵn nhưng **chưa màn nào dùng** (thừa từ TailAdmin)

`ui/button/Button.tsx` (size `sm|md`, variant `primary|outline`, `startIcon/endIcon` — **không có prop `type`**), `ui/badge/Badge.tsx` (variant `light|solid`, color `primary|success|error|warning|info|light|dark`), `ui/table/index.tsx` (Table/Header/Body/Row/Cell chỉ là vỏ không kiểu), `ui/alert/Alert.tsx` (success/error/warning/info), `ui/avatar/Avatar.tsx` (chỉ ảnh, 6 cỡ, chấm trạng thái), `ui/images/*`, `ui/videos/*`, `common/ComponentCard.tsx`, `common/PageBreadCrumb.tsx` (chữ "Home"), `common/ScrollToTop.tsx`, `common/ThemeTogglerTwo.tsx`, `common/ChartTab.tsx`, `common/GridShape.tsx`, `components/header/Header.tsx` (bản trùng của AppHeader), `hooks/useModal.ts`, `hooks/useGoBack.ts`.

→ Các màn thật viết **lớp Tailwind trực tiếp** cho nút, chip, bảng, ô nhập, hộp thoại, công tắc. Vì vậy chuẩn thực tế là **các mẫu lớp ở mục 5**, không phải component.

## 5. Mẫu lớp Tailwind chuẩn (lặp lại nhiều nhất)

| Mẫu | Lớp | Bằng chứng |
|---|---|---|
| **Đầu trang** | `<header class="flex flex-col gap-2 pb-6 border-b border-gray-200 dark:border-white/[0.05]">` + `h2.text-title-sm.font-semibold.text-gray-800.dark:text-white/90` + `p.text-theme-sm.text-gray-500.dark:text-gray-400.max-w-2xl.leading-relaxed`; bao màn: `w-full flex flex-col gap-6` | `screens/CronjobScreen.tsx:51-55`, `ExternalLogsScreen.tsx:186-192` |
| Đầu trang có nút | thêm `md:flex-row md:justify-between md:items-end gap-6` | `screens/RawArticlesScreen.tsx:435-491` |
| Nút chính | `inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium|semibold text-white hover:bg-brand-600 disabled:opacity-50` (+ `active:scale-[0.98]` ở nhiều màn) | `UserManagementScreen.tsx:217`, `ExternalLogsScreen.tsx:288` |
| Nút viền | `rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5` | `UserManagementScreen.tsx:207` |
| Nút nhạt cùng tông | `bg-brand-50 text-brand-500 border border-brand-100 hover:bg-brand-100 dark:bg-brand-500/15 dark:border-brand-500/25` | `RawArticlesScreen.tsx:479` |
| Nút xám | `bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700` | `ExternalLogsScreen.tsx:479`, `ManageWpScreen.tsx:966` |
| Nút nguy hiểm | mềm: `bg-error-500/10 text-error-600 hover:bg-error-500/20`; viền: `border border-error-200 text-error-600 hover:bg-error-50` | `UserManagementScreen.tsx:328, 457` |
| Nút trong bảng | `text-xs font-semibold px-2 py-1 rounded-lg gap-1` + icon 14px, xếp `grid grid-cols-2 gap-1.5 w-[180px]`; màu: `brand-500`, `emerald-500`, `gray-100`, `indigo-50/indigo-600` | `ManageWpScreen.tsx:937-979` |
| Nút icon trong bảng | `p-1.5|p-2 text-gray-400|500 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/10 rounded-lg` + lucide 18px | `ExternalLogsScreen.tsx:365` |
| Ô nhập — thanh lọc | `px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500` | `ExternalLogsScreen.tsx:207, 225` |
| Ô nhập — form cấu hình | `w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500` | `KnowledgeConfigScreen.tsx:141-142`, `CronjobScreen.tsx:95` |
| Ô nhập — form trong modal | `w-full rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:text-white`; lỗi `mt-1 text-xs text-error-500` | `UserManagementScreen.tsx:379, 383` |
| Nhãn trường | thanh lọc / thẻ cấu hình: `text-theme-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider`; form thường: `mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400` | `ExternalLogsScreen.tsx:205`, `UserManagementScreen.tsx:374` |
| Ô tìm có icon | `relative` + lucide `Search` `absolute left-3 top-1/2 -translate-y-1/2 text-gray-400` + input `pl-9|pl-10` | `ManageWpScreen.tsx:738-748` |
| Select | `<select>` gốc, cùng lớp với ô nhập thanh lọc | `ExternalLogsScreen.tsx:206` |
| Checkbox | `<input type=checkbox>` gốc, `w-4 h-4 rounded border-gray-300 accent-brand-500` | `ManageWpScreen.tsx:817` |
| Công tắc | lớn: nút `w-14 h-8 rounded-full p-1` bật `bg-success-500` tắt `bg-gray-300 dark:bg-gray-600`, núm `w-6 h-6 bg-white shadow-md translate-x-6`; nhỏ (`role="switch"`): `h-6 w-11` bật `bg-brand-500`, núm `h-4 w-4` | `CronjobScreen.tsx:79-84`, `AiConfigScreen.tsx:307-317` |
| **Thẻ** | `rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]` + `p-4|p-6|p-8` | `CronjobScreen.tsx:58`, `KnowledgeConfigScreen.tsx:692` |
| Thẻ tiêu đề khối | thẻ ở trên với `flex items-center gap-2 p-4` + `h3.text-lg.font-semibold` + icon lucide `text-brand-500` 20px, kèm số bản ghi | `ExternalLogsScreen.tsx:296-301` |
| Thanh lọc | thẻ `flex flex-col md:flex-row flex-wrap gap-4 p-4`, mỗi trường `flex flex-col gap-1.5` (nhãn trên) | `ExternalLogsScreen.tsx:202-293` |
| **Bảng** | vỏ `overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]` (không nền) → `overflow-x-auto` → `table.min-w-full`; `thead tr.bg-gray-50.dark:bg-gray-900`; `th.px-5.py-3.text-theme-xs.font-medium.text-gray-500.uppercase.text-left`; `tbody.divide-y.divide-gray-100.dark:divide-white/[0.05]`; `tr.hover:bg-gray-50.dark:hover:bg-white/[0.02]`; `td.px-5.py-3|py-4.text-theme-sm`; đang tải lại giữ dữ liệu cũ `opacity-60` | `ExternalLogsScreen.tsx:304-332`, `ManageWpScreen.tsx:804-858` |
| Bảng (biến thể) | vỏ có nền `bg-white dark:bg-gray-dark`, `th` `font-semibold` không nền, Pagination đặt **trong** vỏ dưới `border-t` | `UserManagementScreen.tsx:226-356` |
| Ảnh nhỏ trong bảng | `w-[60px] h-[40px] object-cover rounded`; không ảnh: khối `bg-gray-100` + icon | `ManageWpScreen.tsx:874-886` |
| **Chip trạng thái** | `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium` + chấm `h-1.5 w-1.5 rounded-full`; màu `bg-{success|error|warning}-50 text-…-600 dark:bg-…-500/10`; có thể thêm viền `border-…-200` và chấm `animate-ping` | `UserManagementScreen.tsx:298-311`, `ManageWpScreen.tsx:901-930` |
| Chip loại / mã | `px-2 py-0.5 rounded-full text-xs font-medium` (+ icon 12px): CRAWL `emerald-100/700`, AI `purple-100/700`, HTTP 2xx `success-100/700`, lỗi `error-100/700` | `ExternalLogsScreen.tsx:66-98` |
| Nhãn nhỏ | "Bạn": `rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-600` | `UserManagementScreen.tsx:278` |
| Thông báo trong trang | `p-4 rounded-lg border flex items-center gap-3` + `bg-error-50 border-error-100 text-error-500 dark:bg-error-500/15 dark:border-error-500/25` (tương tự success) + icon `AlertCircle` 20px | `ExternalLogsScreen.tsx:194-199`, `RawArticlesScreen.tsx:493-504` |
| **Hộp thoại tự viết** (phổ biến hơn `Modal`) | lớp phủ `fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4` (± `backdrop-blur-sm`); hộp `bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700|800 w-full max-w-2xl|4xl|5xl max-h-[85vh] overflow-y-auto shadow-xl`; đầu `sticky top-0 px-6 py-4 border-b` + `h3.text-lg.font-semibold`; chân `border-t px-6 py-3 flex justify-end` | `ExternalLogsScreen.tsx:389-485`, `ManageWpScreen.tsx:113-146` |
| Toast | **Ưu tiên** `toast.success()/toast.error()` (react-hot-toast). Toast tự viết: `fixed top-4 right-4 z-[9999] w-[340px] rounded-xl shadow-2xl` + thanh tiến trình 5s | `screens/CronjobScreen.tsx:40-44`; `ManageWpScreen.tsx:77-97` |
| Tab | gạch chân: `nav.flex.gap-1` trong `border-b`; nút `inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2`, chọn `border-brand-500 text-brand-600 dark:text-brand-400`, thường `border-transparent text-gray-500 hover:text-gray-700` | `KnowledgeConfigScreen.tsx:672-689` |
| Trạng thái rỗng | đơn giản: `td colSpan px-5 py-20 text-center text-gray-500`; đầy đủ: vòng `w-16 h-16 rounded-full bg-gray-100` + icon 32px + `text-base font-medium text-gray-700` + gợi ý `text-theme-sm` | `ExternalLogsScreen.tsx:322-327`, `ManageWpScreen.tsx:830-850` |
| Lỗi tải + thử lại | ô bảng `py-10 text-center text-sm text-gray-500` + nút `text-brand-500 underline` "Thử lại" | `UserManagementScreen.tsx:251-259` |
| Đang tải | bảng: `TableSkeletonRows`; khối: lucide `Loader2 animate-spin text-brand-500`; trong nút: vòng `h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white` + chữ "Đang …" | `ManageWpScreen.tsx:189-192`, `UserManagementScreen.tsx:443-446` |
| Bước tiến trình | `StepCard` (cục bộ): thẻ `rounded-xl border-2 p-3 md:p-4`, trạng thái pending/running/done/error (gray/blue/emerald/red), nối bằng vạch `h-0.5 w-6`, xếp dọc trên mobile | `MarketAnalysisWorkflowScreen.tsx:66-134` |
| Markdown | `prose prose-sm dark:prose-invert max-w-none` | `ManageWpScreen.tsx:131` |

## 6. Responsive thực tế

- Ngưỡng chính `lg` (1024): sidebar cố định ↔ drawer; header 1 hàng ↔ 2 hàng; ô tìm hiện ↔ ẩn (`layout/AppHeader.tsx:129-135, 160-161, 234`).
- Bảng **không có** bản thẻ cho mobile: chỉ cuộn ngang `overflow-x-auto` (một số đặt `min-w-[720px]`, `UserManagementScreen.tsx:228`).
- Thanh lọc, đầu trang: `flex-col` → `md:flex-row` (`ExternalLogsScreen.tsx:202`, `RawArticlesScreen.tsx:435`). Lưới thẻ: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (`CronjobScreen.tsx:57`).
- Pagination ẩn ô "Số dòng" dưới `md` (`Pagination.tsx:81`). Hộp thoại luôn `p-4` lề ngoài, `w-full max-w-*`.
- **Không có** điều hướng dưới (bottom nav), bottom sheet hay FAB.

## 7. Nên / Không nên (rút từ code)

**Nên**
- Dùng token `brand/gray/success/error/warning` cho mọi màu ngữ nghĩa; luôn viết cặp `dark:` (app mặc định chạy **tối**).
- Đầu trang theo mẫu mục 5 (`text-title-sm font-semibold` + mô tả + `pb-6 border-b`).
- Bảng: vỏ `rounded-2xl border`, `thead` nền `gray-50`, chữ cột `text-theme-xs uppercase`, `TableSkeletonRows` khi tải, `Pagination` bên dưới.
- Gọi API bằng React Query qua `apiAxios`/`fetchPaginated` (`utils/fetchPaginated.ts:59-79`); lỗi dùng `getApiErrorMessage` (`utils/fetchPaginated.ts:23`) + `toast.error`.
- Nhãn trạng thái luôn là **chip có chữ** (± chấm màu).
- Mỗi khu vực chỉ một nút `bg-brand-500`.

**Không nên** (đang tồn tại trong code, đừng chép tiếp)
- Gọi token không tồn tại (`info-*`, `dark-900`).
- Trộn màu mặc định Tailwind (`red/emerald/amber/blue/indigo`) với token ngữ nghĩa cho cùng một ý nghĩa — module mới dùng `error/success/warning/brand`.
- Viết thêm toast/hộp thoại tự chế: dùng `react-hot-toast` và `components/ui/modal` (hoặc một `Modal` chung đã chuẩn hóa).
- Thêm bộ icon thứ ba (Material Symbols của Stitch): quy về **lucide-react**.
- Đặt z-index tùy ý (`z-[100]`, `z-[60]`): hộp thoại dùng một mức chung.
- Để `console.log` debug trong màn (`ManageWpScreen.tsx:161-175`).

## 8. Khối CSS tối thiểu để dựng prototype đúng phong cách

Chép **nguyên tệp** `src/index.css` (đã gồm đủ token, `menu-item*`, flatpickr). Nếu cần gọn: giữ `index.css:1-300` và `394-557` (flatpickr), bỏ phần ApexCharts/FullCalendar/Swiper/jvectormap. Không cần khai báo thêm token.

## 9. Sai khác so với bản cũ (bản suy từ ảnh)

| # | Bản cũ ghi | Thực tế trong code |
|---|---|---|
| 1 | Biểu tượng: **chỉ lucide-react**, "một bộ duy nhất" | Hai bộ: SVG TailAdmin (`src/icons`, svgr) cho menu/Login/Users + lucide-react cho các màn; thêm SVG inline (mục 1) |
| 2 | Giao diện "sáng", có chế độ tối | **Mặc định tối** (`ThemeContext.tsx:18, 24`); lớp `.dark` trên `<html>` |
| 3 | Vòng focus dùng `shadow-focus-ring` | 0 lần dùng; thực tế `focus:ring-1/2/3` + `focus:border-brand-*` (mục 5) |
| 4 | Ô chọn trong bảng dùng lớp `.tableCheckbox` | 0 lần dùng; checkbox gốc `accent-brand-500` |
| 5 | "Quản lý tài khoản" dùng `text-theme-xl` | `text-xl font-bold` (`UserManagementScreen.tsx:196`); `text-theme-xl` 0 lần dùng |
| 6 | Nút "Xem nguồn", "Xem lịch sử" = `bg-brand-50 text-brand-500` | `bg-indigo-50 text-indigo-600` (`ManageWpScreen.tsx:790, 975`) |
| 7 | Chip "Đã crawl" = nền `gray-50` viền `gray-200` | Gọi `info-*` không tồn tại → chip không màu (lỗi) (`ManageWpScreen.tsx:920`) |
| 8 | Vùng nội dung lề 60–72px | `p-4 md:p-6` + `max-w` 1536px căn giữa (`AppLayout.tsx:29`) |
| 9 | Menu trái ~284–290px; thanh trên 76–80px | Đúng **290px** (thu gọn **90px**, hover mở tạm); header ≈76px desktop, ≈64px mobile (2 hàng) |
| 10 | Bảng nằm trong "thẻ trắng" | Vỏ bảng chỉ có viền + `rounded-2xl`, **không nền**; `thead` nền `gray-50`/`gray-900` (chỉ trang Users có nền trắng) |
| 11 | Toast "chưa xác nhận" | `react-hot-toast` top-right 4s + toast tự viết lặp ở 3 màn |
| 12 | Hộp thoại chưa rõ | `Modal` chung `rounded-3xl` (chỉ 1 màn dùng); còn lại tự viết `bg-black/50` + `rounded-2xl`, z-index lộn xộn |
| 13 | Chưa có tệp component (cần gửi thêm) | Có `ui/button, badge, table, alert, avatar…` nhưng **không màn nào dùng**; chuẩn thật là mẫu lớp (mục 5) |
| 14 | "Không thêm màu ngoài thang" là hiện trạng | Hiện trạng dùng nhiều màu mặc định Tailwind (`red` 91, `emerald` 60, `blue` 37, `amber` 36 lần) |
| 15 | Ô nhập form "nền gray-50 viền gray-200 cao ~42px" | 3 kiểu ô nhập khác nhau (thanh lọc / form cấu hình viền `gray-300` / form modal nền trong suốt) |
| 16 | Chip "AI" `purple-100/purple-800` (ước lượng) | `purple-100/purple-700` (`ExternalLogsScreen.tsx:76`) |
| 17 | Ô tìm kiếm header là chức năng | Chỉ trang trí (không xử lý), ẩn dưới 1024px; chuông là dữ liệu mẫu với ảnh hỏng |
| 18 | Khuyến nghị mã màu cho app di động Expo (mục 9 cũ) | Không có cơ sở trong code web admin — đã bỏ khỏi tài liệu này |

## 10. Chưa có trong Admin App (làm theo template Stitch)

Đối chiếu với `stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/*` (web) và `stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/{views,components}/*` (mobile). Cả 2 thiết kế dùng **cùng token brand/success/warning** với Admin App, phông Outfit, nhưng icon là **Material Symbols Outlined** (font) và **không có lớp `dark:`** nào.

| Thành phần Stitch cần | Có trong Admin App? | Hướng làm |
|---|---|---|
| Bottom nav mobile (`BottomNavBar`) | Không | Làm mới theo Stitch, hiện `<lg`, có badge số |
| Top app bar mobile (logo giữa) | Một phần (hàng 1 header mobile) | Giữ `AppHeader`, chỉ chỉnh nếu cần |
| Drawer mobile có thẻ user (`SideDrawer`) | Có drawer sidebar | Tái dùng `AppSidebar` chế độ mobile, thêm thẻ user |
| Tab module ngang (Khách hàng/Lịch hẹn/Việc hôm nay/Báo cáo) | Mẫu tab gạch chân (cục bộ) | Tách thành component từ `KnowledgeConfigScreen.tsx:672-689` |
| Tab dạng viên thuốc có số đếm (lọc tình trạng) | Không | Làm mới |
| Thẻ KPI / bento số liệu | Không | Làm mới trên mẫu "thẻ" mục 5 |
| Kanban 3 cột (Quá hạn/Hôm nay/Sắp tới) | Không | Làm mới |
| Timeline (nhật ký chăm sóc, lịch theo buổi) | Không | Làm mới |
| Tiến độ 4 bước (C4) / thanh tiến độ nhiều đoạn | Một phần (`StepCard` cục bộ) | Làm component mới, tham khảo `StepCard` |
| Avatar nhóm chồng nhau (`-space-x-`), avatar chữ cái | Avatar chỉ ảnh (không dùng); avatar chữ cái trong `UserDropdown` | Làm `AvatarInitials` + `AvatarStack` |
| Lịch tháng mini, dải 7 ngày, điều khiển phân đoạn Ngày/Tuần/Tháng | Chỉ `DatePicker` flatpickr | Làm mới |
| Biểu đồ donut, thanh xếp hạng nhân viên | Không (CSS ApexCharts có nhưng chưa cài) | SVG thuần theo Stitch, hoặc cài ApexCharts |
| Thẻ chọn kiểu radio, nhập tag + gợi ý, chip chọn nhiều | Không | Làm mới |
| Thanh hành động dính đáy (sticky footer form) | Không | Làm mới |
| Bottom sheet lọc nâng cao (mobile) | Không | Làm mới |
| Danh sách thẻ khách hàng thay bảng trên mobile | Không | Làm mới (bảng vẫn dùng mẫu mục 5 cho desktop) |
| Lightbox ảnh, khay ảnh cuộn ngang, tải ảnh lên | Không | Làm mới |
| Hộp thoại Gọi điện / Zalo / Ghi chú nhanh | Có `Modal` gốc | Dựng trên `components/ui/modal` |
| Breadcrumb | `PageBreadCrumb` (không dùng, chữ "Home") | Sửa nhãn tiếng Việt rồi dùng |
| Dropdown chọn tình trạng dạng chip | Có `Dropdown` | Ghép `Dropdown` + chip mục 5 |
| Ô gợi ý AI | `Alert` (info, không dùng) | Dùng `Alert` hoặc thông báo trong trang mục 5 |
| Kết quả tìm kiếm thả xuống ở header | Ô tìm chỉ trang trí | Làm mới |
| Thanh trượt khoảng (ngân sách) | Không | Làm mới |
| Toast | Có `react-hot-toast` | Dùng `toast.*`, bỏ `Toast` của Stitch |
| Bảng, phân trang, skeleton, trạng thái rỗng, công tắc | Có (mục 4–5) | Dùng lại |
