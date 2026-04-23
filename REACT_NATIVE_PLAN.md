# Kế hoạch Triển khai Frontend (React Native) - Real Estate Manager

Tài liệu này mô tả chi tiết kiến trúc, công nghệ, cấu trúc thư mục và lộ trình các bước để xây dựng ứng dụng di động cho dự án quản lý bất động sản.

---

## 1. Công nghệ & Kiến trúc (Tech Stack)

Để đảm bảo tốc độ phát triển nhanh, hiệu năng tốt và dễ dàng bảo trì, dự án sẽ sử dụng bộ công cụ hiện đại sau:

*   **Core Framework**: **React Native** thông qua **Expo** (Sử dụng Expo SDK mới nhất để hạn chế thiết lập môi trường phức tạp và dễ dàng build/deploy).
*   **Ngôn ngữ**: **TypeScript** (Bắt buộc, giúp kiểm soát kiểu dữ liệu và giảm thiểu bug).
*   **Routing / Navigation**: **Expo Router** (Kiến trúc định tuyến dựa trên thư mục - file-based routing, chuẩn mới và rất mạnh mẽ của Expo).
*   **Styling**: **NativeWind** (Cho phép sử dụng các class của Tailwind CSS ngay trong React Native, khớp hoàn toàn với định hướng thiết kế trong `UI_DESIGN_PLAN`).
*   **State Management**: 
    *   **Zustand**: Quản lý Global State nhẹ nhàng (Lưu thông tin User đăng nhập, trạng thái Bộ lọc BĐS...).
*   **Data Fetching**: **TanStack Query (React Query)** kết hợp với **Axios** (Quản lý caching, loading states, và đồng bộ dữ liệu từ API mượt mà).
*   **Form Management**: **React Hook Form** + **Zod** (Xử lý form mượt mà và validate dữ liệu an toàn).

---

## 2. Cấu trúc Thư mục (Directory Structure)

Dự án sẽ áp dụng cấu trúc phân tách rõ ràng giữa định tuyến (routing) và mã nguồn logic/UI:

```text
RealEstateApp/
├── app/                        # Nơi chứa các file định tuyến (Expo Router)
│   ├── (tabs)/                 # Nhóm Bottom Navigation Tabs
│   │   ├── index.tsx           # Trang Dashboard
│   │   ├── listings.tsx        # Trang Bảng hàng chính
│   │   ├── demands.tsx         # Trang Nhu cầu
│   │   └── menu.tsx            # Trang Menu/Cài đặt
│   ├── listings/               # Các trang con của Bảng hàng
│   │   ├── [id].tsx            # Trang Chi tiết BĐS (Dynamic route)
│   │   └── filter.tsx          # Màn hình/Popup bộ lọc nâng cao (Modal)
│   ├── _layout.tsx             # Layout gốc của toàn ứng dụng
│   └── +not-found.tsx          # Trang lỗi 404
├── src/                        # Chứa toàn bộ mã nguồn ứng dụng
│   ├── assets/                 # Hình ảnh, Fonts chữ (Inter/Poppins), Icons
│   ├── components/             # Các Component tái sử dụng
│   │   ├── ui/                 # UI Kit cơ bản (Button, Input, Typography, Modal)
│   │   └── business/           # Component nghiệp vụ (PropertyCard, DemandCard)
│   ├── constants/              # Hằng số (Colors theme, Configs, API Endpoints)
│   ├── hooks/                  # Custom hooks (useAuth, useDebounce...)
│   ├── services/               # Cấu hình Axios và các file API fetchers
│   ├── store/                  # Cấu hình Zustand store
│   ├── types/                  # Các file định nghĩa Type/Interface của TypeScript
│   └── utils/                  # Các hàm hỗ trợ (Format tiền tệ, Format ngày tháng...)
├── app.json                    # Cấu hình chung của ứng dụng Expo
├── tailwind.config.js          # Cấu hình TailwindCSS (Mã màu, font size theo thiết kế)
├── babel.config.js             # Cấu hình Babel (Nativewind, Reanimated plugin)
└── package.json
```

---

## 3. Các Module/Thành phần cần cài đặt

Mở terminal và chạy các lệnh tương ứng (Sau khi đã khởi tạo dự án với `npx create-expo-app -t expo-template-blank-typescript`):

### UI & Styling
*   `nativewind` & `tailwindcss`: Để sử dụng hệ thống utility classes.
*   `react-native-safe-area-context`: Xử lý tai thỏ, phần viền an toàn trên iOS/Android.
*   `@expo/vector-icons`: Thư viện icon đa dạng (Material Symbols, FontAwesome...).
*   `react-native-reanimated` & `react-native-gesture-handler`: Xử lý các hiệu ứng chuyển động mượt mà (Micro-animations, vuốt chạm).

### Navigation & Routing
*   `expo-router`: Hệ thống định tuyến chính.
*   `@react-navigation/native` & `@react-navigation/bottom-tabs`: Core để Expo Router hoạt động.

### State, API & Forms
*   `zustand`: Cài đặt state manager.
*   `@tanstack/react-query`: Cài đặt data fetcher.
*   `axios`: HTTP Client.
*   `react-hook-form` & `zod`: Xử lý form.
*   `@react-native-async-storage/async-storage`: Lưu trữ dữ liệu cục bộ (như Token, Theme).

---

## 4. Các Bước Triển khai Chi tiết

### Giai đoạn 1: Khởi tạo & Thiết lập nền tảng (Foundation)
1.  Khởi tạo dự án Expo TypeScript.
2.  Cài đặt cấu hình NativeWind.
3.  Cấu hình `tailwind.config.js`: Thêm các mã màu chuẩn (Deep Blue #1A237E, Electric Blue #2563EB...) và font chữ theo `UI_DESIGN_PLAN.md`.
4.  Load font chữ (`Inter` hoặc `Poppins`) vào trong dự án bằng thư viện `@expo-google-fonts`.
5.  Thiết lập bộ thư mục `src` và cấu trúc `app` router cơ bản.

### Giai đoạn 2: Phát triển UI Kit (Core Components)
Trước khi làm các màn hình lớn, cần tạo các thành phần UI cơ bản mang phong cách "Minimalism & Bold Typography":
1.  **Typography**: Tạo các component `<TextBase>`, `<TextBold>`, `<Heading>` với font size và weight cấu hình sẵn.
2.  **Buttons**: Tạo `<PrimaryButton>` (Màu nhấn Electric Blue), `<OutlineButton>` và `<GhostButton>` (nút nền trong suốt).
3.  **Inputs**: Tạo `<TextInput>` thiết kế phẳng, `<SearchInput>` (không viền, icon kính lúp), `<RangeSlider>` cho bộ lọc.
4.  **Layout**: Tạo `<SafeAreaWrapper>`, `<Divider>`, để phân chia không gian trắng linh hoạt.
5.  **Business UI**: Code `<PropertyCard>` (Thẻ Bất động sản theo chiều ngang), `<DemandCard>`, `<NotificationCard>`.

### Giai đoạn 3: Ghép Giao diện Màn hình (Screen Layouts)
Sử dụng dữ liệu giả (Dummy Data) để code toàn bộ UI:
1.  Tạo **Bottom Navigation** với 4 tab chính.
2.  **Trang Dashboard**: Header xanh đậm, thẻ tính năng nhanh, lưới thống kê 2x2.
3.  **Trang Bảng hàng**: Tab chuyển đổi Sơ cấp/Thứ cấp, danh sách PropertyCard.
4.  **Popup Bộ lọc nâng cao**: Thiết kế dưới dạng Modal/Bottom Sheet trượt từ dưới lên, chứa các ô chọn Quận/Huyện, input khoảng giá/diện tích.
5.  **Trang Nhu cầu**: Danh sách thẻ khách hàng cần mua/thuê.
6.  **Trang Chi tiết BĐS & Nhu cầu**: Giao diện chi tiết, ẩn Bottom Nav khi vào trang này.

### Giai đoạn 4: Tích hợp Logic & Kết nối API
1.  Thiết lập **Axios Interceptors** để tự động gắn Token vào header của các request.
2.  Định nghĩa các hàm gọi API trong `src/services/`.
3.  Sử dụng **TanStack Query** trong các màn hình để fetch danh sách Bảng hàng, Nhu cầu (hỗ trợ phân trang/infinite scroll).
4.  Lưu trữ trạng thái bộ lọc của người dùng vào **Zustand** store để khi chuyển tab, bộ lọc không bị mất.
5.  Tích hợp Form đăng nhập/tạo BĐS bằng **React Hook Form**.

### Giai đoạn 5: Tối ưu & Cải thiện UX
1.  Xử lý các trạng thái **Loading** (Dùng Text Skeleton thay vì khối xám lớn) và **Error** (Mất mạng, API lỗi).
2.  Thêm **Micro-animations**: Hiệu ứng khi bấm nút (scale nhỏ lại), hiệu ứng mượt mà khi mở popup bộ lọc bằng `Reanimated`.
3.  Test kỹ layout trên đa thiết bị (iOS/Android) với các kích thước màn hình khác nhau (đặc biệt lưu ý khoảng không gian trắng - padding/margin).
