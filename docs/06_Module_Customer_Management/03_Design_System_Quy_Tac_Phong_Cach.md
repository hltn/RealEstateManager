# Quy tắc thiết kế (Design System) của web admin STND Real Estate Manager

> **Mục đích:** đưa nguyên tài liệu này vào công cụ thiết kế AI (hoặc cho designer/lập trình viên) để tạo màn hình **đúng phong cách web admin hiện tại**.
>
> **Nguồn (đã xác nhận):** `index.css` và `package.json` của dự án web `client` (Vite + React + Tailwind v4), kết hợp 4 ảnh chụp trang thật (Quản lý Đăng tin WordPress, Quản lý tài khoản, Cronjob, Request Logs). Màu, phông chữ, cỡ chữ, bóng đổ, điểm ngắt màn hình **lấy từ mã nguồn**. Phần cỡ thành phần (độ cao nút, bo góc từng thẻ...) vẫn **suy từ ảnh chụp** vì chưa có tệp thành phần (mục 10).

## 0. Công nghệ của web admin

| Hạng mục | Thực tế (từ `package.json`, `index.css`) |
|---|---|
| Nền tảng | Vite 8, React 19, TypeScript 6 |
| Giao diện | **Tailwind CSS v4** (cấu hình ngay trong `index.css` bằng `@theme`, không có `tailwind.config.js`), `@tailwindcss/typography` |
| Bảng màu | Bộ màu **TailAdmin** (brand, gray, success, error, warning, orange, blue-light) |
| Phông chữ | **Outfit** (Google Fonts, độ đậm 100–900) |
| Chế độ tối | Có, bật bằng **lớp `.dark`** (`@custom-variant dark`) |
| Biểu tượng | **lucide-react** (đường nét) |
| Biểu mẫu | react-hook-form + zod |
| Thông báo nhỏ | react-hot-toast |
| Chọn ngày | flatpickr (đã tùy biến giao diện) |
| Dữ liệu | axios, @tanstack/react-query, zustand |
| Điều hướng | react-router-dom v7 |
| Khác | react-markdown, clsx, tailwind-merge, vitest |
| Backend | Thư mục `../RealEstateBackendApp` |

**Lưu ý:** `index.css` còn chứa kiểu dáng sẵn cho **ApexCharts, FullCalendar, Swiper, jvectormap**, nhưng `package.json` **chưa cài** các thư viện này. Module khách hàng cần biểu đồ (Báo cáo) và lịch (Lịch hẹn) có thể dùng ApexCharts và FullCalendar để giao diện khớp ngay, nhưng phải cài thêm.

**Dự án khác:** các tệp trước đó (`tailwind_config.js`, `package.json` tên `realestateapp`) thuộc **app di động Expo/NativeWind** (màu chính #2563EB, phông Inter/Poppins), không phải web admin. Xem mục 9.

## 1. Tính cách giao diện

Sáng, gọn, nhiều khoảng trắng; **một màu nhấn xanh chàm-lam `brand-500` (#465FFF)** cho hành động chính; ít đổ bóng, phân vùng bằng **viền 1 px**; biểu tượng đường nét; chữ không chân hình học (Outfit). Là một bảng quản trị (admin dashboard) hiện đại, thiên về thẻ và bảng dữ liệu. Có chế độ sáng và tối.

## 2. Màu sắc

### 2.1 Thang màu (khai báo trong `@theme`)

| Nhóm | Các bậc dùng nhiều (mã màu) |
|---|---|
| **brand** (màu thương hiệu) | 25 `#F2F7FF`, 50 `#ECF3FF`, 100 `#DDE9FF`, 200 `#C2D6FF`, 300 `#9CB9FF`, 400 `#7592FF`, **500 `#465FFF`**, 600 `#3641F5`, 700 `#2A31D8`, 800 `#252DAE`, 900 `#262E89`, 950 `#161950` |
| **gray** (trung tính) | 25 `#FCFCFD`, 50 `#F9FAFB`, 100 `#F2F4F7`, 200 `#E4E7EC`, 300 `#D0D5DD`, 400 `#98A2B3`, 500 `#667085`, 600 `#475467`, 700 `#344054`, 800 `#1D2939`, 900 `#101828`, 950 `#0C111D`, `gray-dark` `#1A2231` |
| **success** (thành công) | 50 `#ECFDF3`, 100 `#D1FADF`, 200 `#A6F4C5`, 500 `#12B76A`, 600 `#039855`, 700 `#027A48` |
| **error** (lỗi) | 50 `#FEF3F2`, 100 `#FEE4E2`, 200 `#FECDCA`, 300 `#FDA29B`, 500 `#F04438`, 600 `#D92D20`, 700 `#B42318` |
| **warning** (cảnh báo) | 50 `#FFFAEB`, 100 `#FEF0C7`, 500 `#F79009`, 600 `#DC6803`, 700 `#B54708` |
| **orange** | 50 `#FFF6ED`, 100 `#FFEAD5`, 400 `#FD853A`, 500 `#FB6514`, 600 `#EC4A0A` |
| **blue-light** | 50 `#F0F9FF`, 100 `#E0F2FE`, 500 `#0BA5EC`, 600 `#0086C9` |
| Màu nhấn khác | `theme-pink-500` `#EE46BC`, `theme-purple-500` `#7A5AF8` |
| Cố định | `white` `#FFFFFF`, `black` `#101828` |

Phông, điểm ngắt màn hình bị xóa về mặc định (`--font-*: initial`, `--breakpoint-*: initial`); còn **bảng màu mặc định của Tailwind vẫn dùng được** (ví dụ `emerald`, `purple`).

### 2.2 Cách dùng theo vai trò (đã đối chiếu với ảnh)

| Vai trò | Token / lớp Tailwind | Mã màu (sáng) | Dark |
|---|---|---|---|
| Nền trang | `bg-gray-50` | #F9FAFB | `dark:bg-gray-900` |
| Nền khối/thẻ/menu/thanh trên | `bg-white` | #FFFFFF | **[Suy ra từ TailAdmin]** `dark:bg-white/[0.03]` hoặc `gray-900` |
| Viền mặc định (mọi phần tử) | `border-gray-200` (đặt toàn cục) | #E4E7EC | `dark:border-gray-800` **[Suy ra]** |
| Đường kẻ giữa hàng bảng | `gray-100` | #F2F4F7 | |
| Chữ nội dung (body) | `text-gray-800` | #1D2939 | `dark:text-gray-300` (#D0D5DD) |
| Chữ phụ, nhãn cột, mô tả | `text-gray-500` | #667085 | `dark:text-gray-400` |
| Chữ mờ, nhãn "MENU", placeholder | `text-gray-400` | #98A2B3 | |
| Nút/hành động chính, avatar, trang đang chọn | `bg-brand-500` | #465FFF | |
| Nút chính khi rê chuột | `hover:bg-brand-600` | #3641F5 | |
| Nút chính vô hiệu | `bg-brand-500` + `opacity-50` | ≈ #A2AFFF | |
| Mục menu đang chọn | `bg-brand-50 text-brand-500` | #ECF3FF / #465FFF | `dark:bg-brand-500/[0.12] dark:text-brand-400` (#7592FF) |
| Mục menu thường | `text-gray-700 hover:bg-gray-100` | #344054 / #F2F4F7 | `dark:text-gray-300 dark:hover:bg-white/5` |
| Nút phụ cùng tông (Xem nguồn, Xem lịch sử) | `bg-brand-50 text-brand-500` | #ECF3FF | |
| Nút phụ trung tính (Xem, Tải lại) | `bg-gray-100` hoặc `bg-gray-50` + viền | #F2F4F7 | |
| Chip/công tắc thành công | `bg-success-50 text-success-700`, công tắc `bg-success-500` | #ECFDF3 / #027A48 / #12B76A | |
| Chip mã trạng thái "200" | `bg-success-100 text-success-700` | #D1FADF | |
| Nút "Khóa", nút "Đăng xuất" (nguy hiểm) | chữ `text-error-600`; nền `bg-error-50`~`error-100` (đo #FFEAEC); "Đăng xuất" viền đỏ nhạt | #D92D20 | |
| Chấm thông báo trên chuông | `bg-orange-400` | #FD853A | |
| Nút hành động xanh lá (Làm sạch) | Tailwind mặc định `bg-emerald-500` **[Suy ra từ màu đo #00BF7D]** | ≈ #00BC7D | |
| Chip loại "AI" (tím) | Tailwind mặc định `bg-purple-100 text-purple-800` **[Ước lượng]** | ≈ #F3E8FF / #6E11B0 | |
| Biểu tượng thao tác phụ (mắt, mũi tên) | `text-gray-400` | ≈ #9EA5AF (đo) | |

### 2.3 Màu cho module khách hàng **[Đề xuất, ảnh không có]**

Dùng đúng thang màu của app:

| Tình trạng | Nền chip | Chữ chip |
|---|---|---|
| Có quan tâm | `success-50` | `success-700` |
| Chưa tiếp cận | `gray-50` + viền `gray-200` (giống chip "Đã crawl") | `gray-700` |
| Khách net | `warning-50` | `warning-700` |
| Bỏ | `error-50` | `error-600` |

Luôn kèm **chữ** trên chip, không chỉ dựa vào màu.

### 2.4 Chế độ tối (những gì có chắc trong `index.css`)
- Nền trang `gray-900` #101828, chữ `gray-300`.
- Mục menu đang chọn: nền `brand-500` độ mờ 12%, chữ `brand-400`.
- Mục menu rê chuột: nền trắng độ mờ 5%.
- Thanh cuộn: `gray-700` (#344054).
- Hộp chọn ngày/popover: nền `gray-dark` #1A2231, viền trắng độ mờ 5%.
- Ô tiêu đề bảng lịch: nền `gray-900`; viền `gray-800`.

Màu nền thẻ, ô nhập ở chế độ tối nằm trong tệp thành phần nên **chưa xác nhận** (mục 10).

## 3. Chữ

**Phông:** `font-outfit` = **Outfit** (100–900); là phông duy nhất (các phông khác bị xóa), áp cho toàn `body`, độ đậm mặc định 400.

| Cỡ chữ (khai báo trong `@theme`) | Kích thước / dòng | Dùng cho (đã đối chiếu ảnh) |
|---|---|---|
| `text-title-sm` | **30 px / 38 px** | Tiêu đề trang (Manage WP, Cronjob, Request Logs) |
| `text-theme-xl` | **20 px / 30 px** | Tiêu đề trang "Quản lý tài khoản", tiêu đề thẻ/khối |
| `text-theme-sm` | **14 px / 20 px** | Mục menu, nội dung bảng, nút, mô tả |
| `text-theme-xs` | **12 px / 18 px** | Nhãn cột bảng, nhãn trường form (chữ hoa), chip, dòng gợi ý |
| `text-title-md/lg/xl/2xl` | 36 / 48 / 60 / 72 px | Tiêu đề rất lớn (hiếm dùng) |
| Mặc định Tailwind | `text-base` 16 px, `text-lg` 18 px | Tiêu đề bài trong bảng (16 px), tiêu đề khối (18 px) |

Độ đậm: mục menu `font-medium` (500); tiêu đề `font-semibold`–`font-bold` (600–700); nhãn cột và chip `font-medium`.

**Không nhất quán đáng lưu ý:** "Quản lý tài khoản" dùng cỡ 20 px, các trang còn lại 30 px. Module mới dùng **`text-title-sm` (30 px)** cho tiêu đề trang.

## 4. Bố cục, khoảng cách, bóng đổ

| Yếu tố | Quy tắc |
|---|---|
| Khung chung | Menu trái + thanh trên + vùng nội dung cuộn, nền `gray-50` |
| Menu trái | Rộng ~**284–290 px** (đo ~284; mẫu TailAdmin chuẩn 290), nền trắng, viền phải 1 px |
| Thanh trên | Cao ~**76–80 px**, nền trắng, viền dưới 1 px |
| Vùng nội dung | Lề trái và phải khoảng 60–72 px (đo từ ảnh) |
| Lưới khoảng cách | Bội số của 4 px (thang spacing Tailwind) |
| Bo góc | Nút, ô nhập, mục menu `rounded-lg` **8 px**; ô biểu tượng, popover `rounded-xl` **12 px**; thẻ lớn `rounded-2xl` **16 px**; chip, avatar, công tắc `rounded-full` |
| Điểm ngắt màn hình | 2xsm 375, xsm 425, sm 640, md 768, lg 1024, xl 1280, 2xl 1536, 3xl 2000 (px) |
| Lớp z-index | 1, 9, 99, 999, 9999, 99999, 999999 |

**Bóng đổ (có sẵn):**

| Tên | Giá trị | Dùng cho |
|---|---|---|
| `shadow-theme-xs` | 0 1px 2px rgba(16,24,40,.05) | Ô nhập, nút |
| `shadow-theme-sm` | 0 1px 3px rgba(16,24,40,.1), 0 1px 2px rgba(16,24,40,.06) | Thẻ nổi nhẹ, tooltip biểu đồ |
| `shadow-theme-md` | 0 4px 8px -2px rgba(16,24,40,.1), 0 2px 4px -2px rgba(16,24,40,.06) | Popover, hộp chọn ngày |
| `shadow-theme-lg` / `xl` | nhẹ → vừa | Hộp thoại, menu thả xuống |
| `shadow-focus-ring` | 0 0 0 4px rgba(70,95,255,.12) | **Vòng focus** của ô nhập, nút |

Gần như không dùng bóng đậm; phân vùng chủ yếu bằng viền 1 px.

## 5. Thành phần

### 5.1 Menu trái
- Logo STND ở đầu; nhãn nhóm "MENU" `gray-400` chữ hoa nhỏ.
- **Lớp tiện ích có sẵn trong `index.css`** cần dùng lại: `menu-item` (flex, gap-3, px-3, py-2, font-medium, rounded-lg, 14 px), `menu-item-active`, `menu-item-inactive`, `menu-item-icon`, `menu-item-icon-active`, `menu-item-icon-inactive`, `menu-item-icon-size` (biểu tượng 24 px), `menu-item-arrow(-active/-inactive)` (mũi tên xoay 180° khi mở), `menu-dropdown-item(-active/-inactive)`, `menu-dropdown-badge`.
- Trong ảnh biểu tượng menu hiển thị ~20 px, trong khi lớp `menu-item-icon-size` đặt 24 px: dùng cỡ nào tùy thành phần **[Chưa xác nhận]**.
- Mục đang chọn: nền `brand-50`, chữ và biểu tượng `brand-500`. Có đường kẻ mảnh ngăn nhóm.

### 5.2 Thanh trên
1. Nút vuông 44 px viền `gray-200`, bo 8 px (thu gọn menu).
2. **Ô tìm kiếm** ~430 px, cao 44 px, kính lúp, placeholder "Search or type command…", ô nhỏ viền hiển thị phím **⌘K**.
3. (Căn phải) **Chip trạng thái** nền `success-50`, chữ xanh lá.
4. Nút tròn 44 px viền: chế độ tối (mặt trăng), chuông có **chấm `orange-400`**.
5. **Avatar tròn** 44 px nền `brand-500`, chữ cái trắng, kèm tên "Admin" và mũi tên.

### 5.3 Đầu trang
Tiêu đề (`text-title-sm`, đậm) + dòng mô tả `gray-500` 14 px + đường kẻ ngang 1 px bên dưới. **Biến thể có nút bên phải** (Quản lý tài khoản): nút phụ "Tải lại" (viền) và nút chính "Tạo tài khoản" cao ~36 px, bo 8 px.

### 5.4 Thanh bộ lọc
- **Một hàng (Manage WP):** nhãn "Hành động hàng loạt:" + ô chọn nền `gray-50` viền `gray-200` + nút chính "Áp dụng" (mờ khi chưa chọn); ô tìm kèm kính lúp; ô chọn sắp xếp, trạng thái; ô ngày có biểu tượng lịch (flatpickr); hàng thứ hai là nút phụ `brand-50` có biểu tượng.
- **Thẻ bộ lọc có nhãn (Request Logs):** thẻ trắng viền, bo 16 px, đệm 20–24 px; mỗi trường có **nhãn chữ hoa 12 px** phía trên + ô nhập cao ~38 px nền trắng viền `gray-200` bo 8 px; nút chính "Làm mới" ở cuối hàng.

### 5.5 Thẻ tiêu đề khối
Thẻ trắng viền, bo 16 px, cao ~60 px: biểu tượng đường nét màu `brand-500` + tiêu đề đậm 18–20 px (ví dụ "Danh sách Request Logs (2551 bản ghi)").

### 5.6 Bảng
- Thẻ trắng viền `gray-200`, bo 16 px. Dòng đếm kết quả xám 14 px phía trên, hoặc nằm **ở chân bảng cùng phân trang** (Quản lý tài khoản).
- Hàng tiêu đề: chữ hoa 12 px `gray-500`. Hàng dữ liệu ngăn 1 px `gray-100`; chiều cao tùy nội dung (~87 / 63 / 55 px).
- **Ô chọn dạng bảng:** lớp `.tableCheckbox`; khi chọn nền và viền `brand-500`.
- Cột đặc trưng: ô chọn, STT, ảnh nhỏ 60×40 (bo 4 px) + tiêu đề, nguồn đậm + ngày xám, chip trạng thái, nhóm nút 2×2.
- Chân bảng: "Hiển thị 1–3 / 3 tài khoản · Trang 1/1", ô chọn "Số dòng: 20", **phân trang** (ô vuông ~36 px bo 8 px, trang hiện tại nền `brand-500` chữ trắng, mũi tên `gray-400`).
- Thanh cuộn dùng lớp `custom-scrollbar` (rộng 6 px, `gray-200`, bo tròn; tối `gray-700`).

### 5.7 Nút

| Loại | Kiểu | Dùng khi |
|---|---|---|
| Chính | `bg-brand-500` chữ trắng, rê chuột `brand-600` | Hành động quan trọng nhất |
| Chính vô hiệu | Như trên + `opacity-50` | Chưa đủ điều kiện |
| Xanh lá | `emerald-500` chữ trắng | Xử lý/hoàn tất (Làm sạch) |
| Phụ cùng tông | `bg-brand-50 text-brand-500` | Xem nguồn, Xem lịch sử |
| Phụ trung tính | `bg-gray-100` hoặc `bg-gray-50` + viền | Xem, Tải lại |
| Nguy hiểm mềm | `bg-error-50`~`100 text-error-600` | Khóa tài khoản |
| Nguy hiểm viền | Viền và chữ `error-600` | Đăng xuất |
| Chính lớn toàn chiều rộng | `bg-brand-500` cao ~48 px, biểu tượng + chữ 16 px đậm | Lưu cấu hình |

Nút trong bảng: cao ~24 px, rộng ~87 px, bo 6–8 px, biểu tượng 14 px bên trái chữ, xếp lưới 2×2. Tất cả nút có `cursor: pointer` khi không bị vô hiệu (đặt toàn cục).

### 5.8 Chip và thẻ nhỏ
Hình viên thuốc, 12–13 px, `font-medium`:
- Trung tính: nền `gray-50` viền `gray-200`.
- **Chip có chấm tròn**: `success-50` / `success-700` ("● Hoạt động").
- Chip loại "AI": nền tím nhạt, biểu tượng + chữ tím đậm.
- Chip mã trạng thái "200": `success-100` / `success-700`.
- Thẻ "Bạn": `brand-50` / `brand-500`.

### 5.9 Biểu mẫu và thẻ cấu hình (Cronjob)
- Thẻ hẹp ~475 px, bo 16 px. Đầu thẻ: ô biểu tượng vuông ~54 px bo 12 px nền `success-50`, biểu tượng `success-500`; tiêu đề đậm 18–20 px; dòng trạng thái **"● ĐANG HOẠT ĐỘNG"** chữ hoa 12 px `success-500`; công tắc bên phải (viên thuốc ~56×32, bật = `success-500`, núm trắng).
- Nhãn trường chữ hoa 12 px `gray-500`; ô nhập nền `gray-50` viền `gray-200` cao ~42 px bo 8 px, **vòng focus `shadow-focus-ring`**; dòng gợi ý 12 px với dấu `*` màu `brand-500`; nút chính toàn chiều rộng.
- Ô chọn dạng danh sách (vai trò): viền `gray-200`, nền trắng, bo 8 px, giá trị chữ hoa.
- Hộp chọn ngày flatpickr: nền trắng, bo 12 px, đệm 20 px, viền `gray-200`, `shadow-theme-md`; ngày được chọn nền `brand-500` chữ trắng; ngày/tuần tiêu đề 14 px.

### 5.10 Thông báo nhỏ, lịch, biểu đồ
- **Toast:** react-hot-toast (giao diện chưa có trong ảnh) **[Chưa xác nhận]**.
- **Lịch (FullCalendar):** `index.css` đã tùy biến: nút điều hướng 40 px viền `gray-200` bo 8 px, nút nhấn `brand-500`, sự kiện có thanh màu bên trái (success / error / brand / orange), ô hôm nay nền `gray-100`.
- **Biểu đồ (ApexCharts):** chữ chú thích `gray-700`, đường lưới `gray-100`, tooltip bo 8 px viền `gray-200`.

## 6. Biểu tượng
**lucide-react**: biểu tượng đường nét, nét mảnh (stroke ~1.5–2 px), góc bo tròn; một bộ duy nhất. Kích thước ~20 px ở menu và thanh trên, 14–16 px trong nút.

## 7. Nên và không nên

**Nên:**
- Dùng `brand-500` làm màu nhấn chính; mỗi khu vực chỉ có **một nút chính**.
- Dùng đúng token và lớp Tailwind có sẵn; dùng lớp `menu-item*` cho menu.
- Phân vùng bằng viền 1 px và khoảng trắng; nền trang `gray-50`, khối nổi màu trắng.
- Tiêu đề trang to đậm (30 px), dòng mô tả xám bên dưới.
- Trạng thái luôn là **chip bo tròn có chữ**; trạng thái bật dùng `success`.
- Nhãn trường form và tiêu đề cột bằng **chữ hoa nhỏ màu xám**.
- Luôn viết cặp lớp sáng/tối (`dark:`).

**Không nên:**
- Thêm màu thương hiệu mới, gradient hoặc đổ bóng đậm.
- Dùng tiêu đề bảng nền tối hoặc nền màu đặc.
- Dùng biểu tượng đặc hoặc trộn nhiều bộ biểu tượng.
- Dùng chữ nhỏ hơn 12 px hoặc chữ xám quá nhạt trên nền xám.
- Làm thẻ form kéo dài hết chiều rộng trang.

## 8. Mã dùng lại (Tailwind v4, đặt trong `index.css`)

Web admin **không cần thêm** token: đã có sẵn trong `@theme`. Chỉ khi dựng dự án mới (hoặc cho công cụ thiết kế) thì chép khối rút gọn sau:

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

@theme {
  --font-*: initial;
  --font-outfit: Outfit, sans-serif;

  --text-title-sm: 30px;  --text-title-sm--line-height: 38px;
  --text-theme-xl: 20px;  --text-theme-xl--line-height: 30px;
  --text-theme-sm: 14px;  --text-theme-sm--line-height: 20px;
  --text-theme-xs: 12px;  --text-theme-xs--line-height: 18px;

  --color-brand-50: #ecf3ff;  --color-brand-400: #7592ff;
  --color-brand-500: #465fff; --color-brand-600: #3641f5;
  --color-gray-50: #f9fafb;   --color-gray-100: #f2f4f7;
  --color-gray-200: #e4e7ec;  --color-gray-400: #98a2b3;
  --color-gray-500: #667085;  --color-gray-700: #344054;
  --color-gray-800: #1d2939;  --color-gray-900: #101828;
  --color-success-50: #ecfdf3; --color-success-100: #d1fadf;
  --color-success-500: #12b76a; --color-success-700: #027a48;
  --color-error-50: #fef3f2;  --color-error-600: #d92d20;
  --color-warning-50: #fffaeb; --color-warning-700: #b54708;
  --color-orange-400: #fd853a;

  --shadow-theme-xs: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
  --shadow-theme-sm: 0px 1px 3px 0px rgba(16, 24, 40, 0.1), 0px 1px 2px 0px rgba(16, 24, 40, 0.06);
  --shadow-focus-ring: 0px 0px 0px 4px rgba(70, 95, 255, 0.12);
}

@layer base {
  *, ::after, ::before { border-color: var(--color-gray-200, currentColor); }
  body { @apply font-outfit font-normal bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-300; }
}
```

## 9. App di động `realestateapp` (Expo + NativeWind)

Cấu hình hiện tại chỉ có 4 màu (`primary` #2563EB, `secondary` #1A237E, `background`, `text`) và phông Inter/Poppins, nên **chưa cùng nhận diện** với web admin. Để đồng bộ, thay `theme.extend` (NativeWind dùng Tailwind v3, dùng cấu hình dạng `tailwind.config.js`):

```js
theme: {
  extend: {
    colors: {
      brand: { 50: '#ECF3FF', 100: '#DDE9FF', 400: '#7592FF', DEFAULT: '#465FFF', 500: '#465FFF', 600: '#3641F5' },
      gray: { 50: '#F9FAFB', 100: '#F2F4F7', 200: '#E4E7EC', 400: '#98A2B3', 500: '#667085',
              700: '#344054', 800: '#1D2939', 900: '#101828' },
      success: { 50: '#ECFDF3', 100: '#D1FADF', 500: '#12B76A', 700: '#027A48' },
      error: { 50: '#FEF3F2', 600: '#D92D20' },
      warning: { 50: '#FFFAEB', 700: '#B54708' },
      orange: { 400: '#FD853A' },
    },
    borderRadius: { lg: '8px', xl: '12px', '2xl': '16px' },
    fontFamily: { outfit: ['Outfit'] }, // cài thêm @expo-google-fonts/outfit
  },
},
```

Cần quyết định: dùng **một** màu chính cho cả web và di động (khuyến nghị #465FFF, thay #2563EB) và đổi phông sang Outfit.

## 10. Lời nhắc (prompt) mẫu cho công cụ thiết kế AI

```text
Design a Vietnamese-language admin screen that matches this existing app style exactly.
Use only the design system below. Do not add new colors, gradients or heavy shadows.

STACK/STYLE: TailAdmin-style light admin dashboard built with Tailwind. Font: Outfit
(weights 400/500/600/700), full Vietnamese diacritics. Page background #F9FAFB, white
surfaces (#FFFFFF) with 1px borders #E4E7EC, cards rounded 16px, controls/menu items 8px,
popovers 12px, chips/avatars/toggles fully rounded. Single accent color brand #465FFF
(hover #3641F5): primary buttons, active menu item (background #ECF3FF, text/icon #465FFF),
avatar, active pagination. Soft secondary buttons: background #ECF3FF, text #465FFF.
Green action button: emerald #00BC7D, white text. Neutral buttons: #F2F4F7.
Danger: text #D92D20 on #FEF3F2. Text: #1D2939 (body), #667085 (secondary), #98A2B3 (muted).
Success chip: bg #ECFDF3, text #027A48, optional leading dot; HTTP-200 chip bg #D1FADF;
"AI" type chip light purple. Toggle on = #12B76A. Notification dot orange #FD853A.
Row dividers #F2F4F7. Focus ring: 4px rgba(70,95,255,0.12). Shadows: very subtle only.
Dark mode: page #101828, text #D0D5DD, active menu bg brand/12% with text #7592FF.

TYPE SCALE: page title 30/38 bold; card/section title 20/30 or 18 bold; body 14/20;
labels, column headers, chips 12/18 (uppercase for column headers and field labels, gray #667085).

LAYOUT: fixed left sidebar (~290px, white, right border) with logo, small uppercase gray
"MENU" label, outline lucide-style icons + 14px medium labels, 40px-high rounded items.
Top bar ~76-80px: collapse button, search "Search or type command..." with a ⌘K badge,
right side: green status chip, dark-mode button, bell with orange dot, round blue avatar
with name and chevron. Content: page title + gray 14px subtitle + 1px divider, then filters
(one row, or a white bordered card with uppercase 12px field labels), then a data table in a
white rounded card (uppercase 12px gray column headers, 1px dividers, optional checkbox
column, footer "Hiển thị x–y / n · Trang a/b", rows-per-page select, numbered pagination with
blue active page). Form cards are narrow (~475px): icon tile, bold title, uppercase status,
toggle, uppercase field labels, inputs with #F9FAFB background, full-width blue button.
ICONS: lucide outline, 1.5-2px stroke, rounded joins, one set only.

TASK: <mô tả màn hình cần thiết kế>
```

## 11. Còn cần đối chiếu (cần tệp thành phần)

`index.css` cho token và một số lớp tiện ích, nhưng **kích thước cụ thể của từng thành phần nằm trong các tệp React**. Để chính xác 100%, gửi thêm:
1. Thành phần **Sidebar** và **Header/Topbar** (độ rộng, độ cao, kích thước biểu tượng).
2. **Button, Badge/Chip, Table, Card, Input/Select, Pagination** (hoặc 2–3 trang đại diện).
3. Một ảnh chụp **chế độ tối** (kiểm tra màu nền thẻ và ô nhập).
4. Ảnh một **hộp thoại (modal)** và một **thông báo (toast)** nếu có.
