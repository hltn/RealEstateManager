# [ PROJECT_PLAN ] | [ DATABASE_PLAN ] | [ DATABASE_MONGO_PLAN ] | [ UI_DESIGN_PLAN ]

> [!IMPORTANT]
> **QUY TẮC ĐỒNG BỘ DỮ LIỆU:**
> Khi 1 trong 4 file kế hoạch (Project, Database, Database Mongo, UI Design) thay đổi hoặc update tính năng, **bắt buộc** phải cập nhật cấu trúc dữ liệu (các trường dữ liệu) vào các file còn lại để đảm bảo tính nhất quán.

# Kế hoạch Thiết kế Giao diện (UI Design Plan) - Real Estate Manager

Tài liệu này định nghĩa phong cách thiết kế và cấu trúc các màn hình chính của ứng dụng, đảm bảo tính thẩm mỹ cao, hiện đại và tối ưu trải nghiệm người dùng (UX).

## 1. Phong cách Thiết kế Chủ đạo (Design System)

- **Ngôn ngữ thiết kế**: **Minimalism & Bold Typography** (Tối giản & Kiểu chữ đậm). Tối đa hóa khoảng không gian trắng (negative space), loại bỏ các chi tiết trang trí thừa, hạn chế sử dụng card có nền màu hoặc đổ bóng nếu không thực sự cần thiết. Nội dung được phân tách chủ yếu bằng khoảng trắng và sự phân cấp của chữ.
- **Typography**: 
    - Font **Inter**, **Poppins** hoặc **SF Pro Display** làm chủ đạo. 
    - **Bold Typography**: Sử dụng font chữ to, cực đậm (Heavy/Black/Bold) cho các tiêu đề chính (Headings) và các con số quan trọng (Giá tiền, Diện tích) để tạo sự chú ý và ấn tượng thị giác ngay lập tức.
- **Màu sắc chủ đạo (Color Palette)**: 
    - **Monochrome Foundation**: Sử dụng nền Trắng tuyệt đối (Pure White #FFFFFF), chữ Đen (Pitch Black #000000) và các sắc độ xám (Grays) để làm nền tảng tĩnh lặng.
    - **Vibrant Accent**: Dùng một màu nhấn duy nhất và nổi bật (ví dụ: Electric Blue #2563EB) chỉ dành riêng cho các nút call-to-action (CTA), đường link hoặc các trạng thái đặc biệt quan trọng.
- **Chế độ hiển thị**: Light Mode với độ tương phản tuyệt đối giữa nền trắng và chữ đen/xám đậm.
- **Iconography**: Sử dụng bộ icon dạng nét thanh mảnh (Line icons hoặc Material Symbols Outlined), kích thước nhỏ gọn để không tranh giành sự chú ý với Typography lớn.
- **Framework CSS**: Ưu tiên sử dụng **Tailwind CSS** để dễ dàng thiết lập các font size lớn, font weight đa dạng và margin/padding rộng (ví dụ: `text-4xl font-black tracking-tight`, `p-8`).
- **Micro-animations**: Ít nhưng tinh tế. Chuyển cảnh tức thì (snappy), hiệu ứng hover làm nổi bật chữ hoặc icon mà không làm xao nhãng.

---

## 2. Chi tiết Giao diện: Trang chủ (Dashboard)

Áp dụng bố cục phân lớp từ trên xuống dưới theo ảnh mẫu:

### 2.1. Cấu trúc Layout (Mobile-first)

#### A. Header Profile (Top Section)
- **Nền**: Màu Deep Blue (#1A237E).
- **Thành phần**: 
    - Thông tin nhân viên (Avatar, Tên, Chức vụ) nằm bên trái.
    - Icon Thông báo (Chuông): Nằm bên phải. Khi nhấn sẽ chuyển sang màn hình **Danh sách Thông báo**.

#### B. Màn hình Danh sách Thông báo (Navigation)
- **Header**: Thanh điều hướng có tiêu đề "Thông báo" và nút **Back (Quay lại)** ở góc trái để trở về Dashboard.
- **Nội dung**: 
    - Danh sách các thông báo dưới dạng thẻ phẳng.
    - Phân chia theo nhóm thời gian (Hôm nay, Tuần này, Cũ hơn).
    - Có trạng thái Đã đọc / Chưa đọc (chấm xanh).

#### B. Thẻ hành động nhanh (Quick Action Floating Card)
- Một thẻ trắng nổi (nằm đè lên phần giao giữa Header và Body).
- Chứa 3 icon chức năng chính theo hàng ngang:
    - **Tạo nhu cầu** (Icon: Star/Demand).
    - **Xem bảng hàng** (Icon: Home/Listings).
    - **Tạo công việc** (Icon: Task/Calendar).

#### C. Thống kê nhu cầu (Demand Statistics)
- Tiêu đề: "Thống kê nhu cầu" kèm nút "Xem thêm".
- Lưới 2x2 (Grid 2 columns) hiển thị các chỉ số:
    - **Đang chăm sóc**.
    - **Deal trong tháng**.
    - **Chia sẻ trong tháng**.
    - **Đợi thanh toán cọc**.

#### D. Danh mục Bảng hàng (Listings Summary)
- Tiêu đề: "Bảng hàng" kèm nút "Xem tất cả".
- Các thẻ lớn theo chiều dọc:
    - **Nhà đất**: Ảnh minh họa bên trái, thông tin mô tả bên phải.
    - **Sơ cấp dự án**: Thẻ tương tự cho các dự án mới.

#### E. Quản lý công việc & Tài liệu
- **Quản lý công việc**: Thẻ hiển thị trạng thái deadline hoặc lời nhắc công việc.
- **Tài liệu cho bạn**: Lưới các thẻ nhỏ chứa link tài liệu thương hiệu và dự án.

---

## 3. Chi tiết Giao diện: Trang Bảng hàng (Listings Page)

Màn hình danh mục chính khi nhấn vào mục "Bảng hàng" ở thanh điều hướng dưới.

### 3.1. Cấu trúc Layout (Theo mẫu layout thực tế)

#### A. Header & Yêu thích
- **Tiêu đề**: "Bảng hàng" (Font Bold, size 24px).
- **Icon Heart**: Nằm ở góc phải để truy cập nhanh danh sách BĐS đã lưu/quan tâm.

#### B. Bộ chuyển đổi phân khúc (Segmented Control)
- Thanh tab phẳng chia làm 2 nút: **Thứ cấp** và **Sơ cấp**.
- Nút đang chọn có viền hoặc nền màu Deep Blue, chữ xanh. Nút còn lại màu xám nhẹ.

#### C. Danh sách Danh mục (Category Cards) - Khi chọn Tab "Thứ cấp"
Các thẻ được thiết kế lớn, thoáng, mỗi thẻ chiếm toàn bộ chiều ngang:
- **Thẻ 1: Thứ cấp dự án**
    - Icon minh họa (Material: Apartment/Document).
    - Tiêu đề: "Thứ cấp dự án".
    - Mô tả: "Danh sách bất động sản Thứ cấp dự án bạn được xem và giao dịch".
    - Icon Mũi tên (North East Arrow) ở góc phải trên cùng của thẻ.
- **Thẻ 2: Thứ cấp nhà đất**
    - Icon minh họa (Material: Home/Real Estate).
    - Tiêu đề: "Thứ cấp nhà đất".
    - Mô tả: "Danh sách bất động sản Thứ cấp nhà đất bạn được xem và giao dịch".
    - Icon Mũi tên (North East Arrow) ở góc phải trên cùng của thẻ.

#### D. Tab "Sơ cấp" (Layout mở rộng)
- Khi chuyển sang tab Sơ cấp, nội dung sẽ hiển thị:
    - Thanh tìm kiếm dự án.
    - Danh sách các dự án tiêu biểu (Lumière, Vinhomes...) kèm thông tin số lượng căn đang mở bán.

### 3.2. Màn hình Danh sách Bảng hàng Chi tiết (Sub-level)

Màn hình hiển thị danh sách các bất động sản cụ thể sau khi chọn danh mục.

#### A. Header & Công cụ tìm kiếm
- **Thanh tiêu đề**: 
    - Nút **Back** quay lại trang danh mục.
    - Tiêu đề: "Bảng hàng [Tên danh mục]".
    - Cụm icon phải: **Thống kê** (Icon chart) và **Yêu thích** (Icon heart).
- **Thanh tìm kiếm**: Thiết kế phẳng, placeholder: "Nhập địa chỉ, số GCN/HĐMB, mã hàng...".

#### B. Bộ lọc & Tùy chọn (Filter Bar)
- **Hàng 1 (Nút bấm nhanh)**:
    - Nút **Bộ lọc**: Mở popup lọc nâng cao (Giá, Diện tích, Hướng, Pháp lý).
    - Nút **Quận/Huyện**: Dropdown chọn nhanh khu vực.
    - Nút **Sắp xếp**: Dropdown (Mới nhất, Giá tăng/giảm...).
- **Hàng 2 (Toggle)**: 
    - Nút gạt (Switch): "BĐS chờ duyệt" (Dành cho quản lý).
    - Icon chuyển đổi chế độ hiển thị (List/Grid).

#### C. Thẻ BĐS Chi tiết (Detailed Property Card)
Bố cục thẻ ngang (Horizontal Card) tối ưu thông tin:
- **Phần ảnh (Trái)**: 
    - Ảnh đại diện tỉ lệ 1:1 hoặc 4:3.
    - Lớp phủ (Overlay) góc dưới: Icon mắt + Số lượt xem (ví dụ: 👁️ 48).
- **Phần nội dung (Phải)**:
    - **Dòng 1**: Giá tổng (Màu xanh dương, ví dụ: 13.5 tỷ) - Giá/m2 - Icon Trái tim (Góc phải).
    - **Dòng 2**: Địa chỉ/Tiêu đề (Chữ đậm, Roboto Medium).
    - **Dòng 3**: Vị trí rút gọn (Icon Map + Phường/Quận).
    - **Dòng 4 (Dãy thông số - Badges)**: Các ô nền xám nhạt:
        - Diện tích (ví dụ: 52.2/52.2m2).
        - Số tầng (ví dụ: 7T).
        - Mặt tiền (ví dụ: 4.26m).
        - Hoa hồng (ví dụ: H3%).
    - **Dòng 5 (Footer)**: Thời gian cập nhật (ví dụ: 8 giờ trước) và Ngày đăng ký.

---

### 3.3. Giao diện Bộ lọc nâng cao (Filter Overlay)

Màn hình xuất hiện khi người dùng nhấn vào nút "Bộ lọc" ở trang danh sách chi tiết.

#### A. Header & Lịch sử
- **Header**: Icon **X** (Đóng) và Tiêu đề "Bộ lọc".
- **Lịch sử lọc gần đây**: Hiển thị thẻ tóm tắt các tiêu chí đã dùng trước đó (Ví dụ: "TP. Hà Nội / Quận Hoàn Kiếm / 0-50 tỷ...").

#### B. Nhóm Địa chỉ & Vị trí
- Nút gạt (Switch): "Địa chỉ hành chính mới?".
- Hệ thống Dropdown phân cấp: Chọn Quận/Huyện -> Chọn Phường/Xã -> Chọn Tuyến đường.

#### C. Nhóm Thông số kỹ thuật (Inputs & Sliders)
Sử dụng cấu trúc: 2 ô nhập liệu (Từ - Đến) kèm một **Range Slider** nằm ngay bên dưới để điều chỉnh nhanh:
- **Giá bán (tỷ)**: Khoảng từ 0 đến >50 tỷ.
- **Diện tích (m2)**: Khoảng từ 0 đến >300 m2.
- **Độ rộng ngõ (m)**: Khoảng từ 0 đến >20 m.

#### D. Nhóm Đặc điểm & Tiện ích
- **Đường tiếp giáp**: Dropdown chọn loại đường (Ngõ thông, Ngõ cụt, Đường ô tô...).
- **Loại hình (Choice Chips)**: Các nút bấm bo góc chọn nhanh: "Nhà ở", "Đất trống".
- **Tiện ích & Điểm nổi bật**: Dropdown chọn đa mảng (ví dụ: Gần trường học, Gần chợ, Sổ đỏ chính chủ...).
- **Đầu chủ**: Dropdown chọn nhân viên phụ trách nguồn hàng.

#### E. Tùy chọn Hiển thị & Hành động
- **Checkbox**: "Chỉ hiển thị BĐS quan tâm ❤️".
- **Footer Sticky**: 
    - Nút **Bỏ chọn** (Outline style): Reset toàn bộ tiêu chí về mặc định.
    - Nút **Xác nhận** (Solid Blue style): Áp dụng bộ lọc và quay lại danh sách.

---

### 3.4. Giao diện chọn Quận/Huyện (Area Selector)

Xuất hiện khi người dùng nhấn vào nút "Quận/Huyện" ở thanh lọc nhanh.

#### A. Header & Tìm kiếm
- **Header**: Icon **X** (Đóng) và Tiêu đề lớn "Quận/Huyện".
- **Thanh tìm kiếm tại chỗ**: Ô nhập liệu có icon kính lúp, hỗ trợ lọc nhanh danh sách quận huyện khi gõ.

#### B. Danh sách khu vực (Multi-select)
- Hiển thị danh sách các Quận/Huyện dưới dạng hàng ngang.
- Mỗi hàng gồm:
    - **Checkbox**: Cho phép chọn/bỏ chọn.
    - **Tên Quận/Huyện**: (Ví dụ: Q. Cầu Giấy, Q. Ba Đình...).
- Phân cách giữa các hàng bằng đường kẻ mỏng (Divider).

#### C. Hành động
- Nút **Bỏ chọn**: Xóa toàn bộ lựa chọn hiện tại.
- Nút **Xác nhận**: Áp dụng các khu vực đã chọn và đóng popup.

---

## 4. Luồng di chuyển chính (Navigation Flow Summary)

Để tránh nhầm lẫn khi thiết kế, luồng di chuyển được quy định như sau:

1.  **Dashboard** (Home) -> Nhấn "Xem bảng hàng" -> Chuyển sang **Tab Bảng hàng**.
2.  **Bảng hàng** -> Chọn **Hạng mục** (Thứ cấp nhà đất/dự án) -> Mở màn hình **Danh sách Chi tiết**.
3.  **Danh sách Chi tiết** -> Chọn **Bất động sản** -> Mở màn hình **Chi tiết Bất động sản**.
4.  **Bất động sản** -> Nhấn nút **Back** -> Quay lại **Danh sách Chi tiết**.
5.  **Bottom Nav**: Chỉ hiển thị ở các màn hình cấp 1 (Trang chủ, Danh mục Bảng hàng, Danh sách Nhu cầu, Menu). 
6.  **Quy tắc Ẩn/Hiện**: Khi đi sâu vào các màn hình cấp 2 trở lên (Danh sách chi tiết, Chi tiết BĐS/Nhu cầu, Thông báo), **Bottom Nav sẽ bị ẩn đi** để mở rộng không gian hiển thị. Nhấn **Back** quay lại cấp 1 thì Bottom Nav mới hiện lại.

---

---

## 4. Chi tiết Giao diện: Trang Nhu cầu (Demands Page)

Trang quản lý danh sách yêu cầu từ khách hàng của nhân viên.

### 4.1. Cấu trúc Layout

#### A. Header & Bộ chuyển đổi (Tab Switcher)
- Tiêu đề trang: "Nhu cầu" (Căn trái) và nút **Thêm mới (+)** ở góc phải.
- **Segmented Control**: Hai tab phẳng "Cần Mua" và "Cần Thuê".

#### B. Thanh công cụ tìm kiếm (Search & Filter)
- Thanh tìm kiếm phẳng: "Tìm khách theo tên, SĐT...".
- Nút Lọc (Filter): Mở popup chọn nhanh khu vực, khoảng tài chính hoặc trạng thái (Đang chăm sóc, Đã chốt...).

#### C. Danh sách Thẻ Nhu cầu (Demand Cards)
Thẻ được thiết kế tối giản, tập trung vào các thông số cốt lõi:
- **Dòng 1**: Tên khách hàng (Chữ đậm) và Badge trạng thái (Ví dụ: "Đang chăm sóc").
- **Dòng 2**: Khoảng giá (Ví dụ: "3 - 5 tỷ") | Loại hình (Ví dụ: "Nhà mặt phố").
*(Nhấn vào thẻ để xem chi tiết đầy đủ và thực hiện hành động)*

### 4.2. Màn hình Chi tiết Nhu cầu (Demand Details)

Màn hình hiển thị toàn bộ hồ sơ khách hàng và tiêu chí tìm kiếm.

#### A. Header & Điều hướng
- Nút **Back** (Quay lại danh sách).
- Tiêu đề: "Chi tiết nhu cầu".
- Nút **Chỉnh sửa** (Góc phải).

#### B. Thông tin Khách hàng & Định danh
- **Thông tin liên hệ**: Tên, Số điện thoại (có nút sao chép), Email.
- **Hồ sơ CCCD**: Hiển thị ảnh chụp 2 mặt và các thông tin định danh (Ngày sinh, Quốc tịch, Nơi thường trú...).

#### C. Tiêu chí tìm kiếm chi tiết
- **Khu vực**: Danh sách các Quận, Huyện, Phường khách đang quan tâm.
- **Loại hình**: Liệt kê chi tiết (ví dụ: Nhà ngõ, Căn hộ, Shophouse...).
- **Tài chính**: Con số chính xác Budget Min/Max.
- **Ghi chú**: Các yêu cầu đặc biệt khác (Ví dụ: "Hướng Tây tứ trạch", "Cần có thang máy"...).

#### D. Thanh hành động dưới (Bottom Sticky Bar)
- Cố định ở cuối màn hình để dễ dàng tương tác:
    - 📞 **Gọi điện**: Kết nối trực tiếp với khách.
    - 💬 **Zalo/Nhắn tin**: Chuyển hướng sang chat.
    - 🎯 **Tìm hàng khớp (Match)**: Kích hoạt bộ lọc tự động để tìm các BĐS trong kho hàng thỏa mãn các tiêu chí này.

---

---

## 5. Chi tiết Giao diện: Menu (Quản lý & Cài đặt)

Trang Menu tập trung vào các thiết lập cá nhân và quản trị hệ thống.

### 4.1. Cấu trúc Layout

#### A. Hồ sơ cá nhân (Profile Summary)
- **Vị trí**: Trên cùng của trang.
- **Thành phần**: 
    - Avatar hình tròn lớn ở giữa hoặc bên trái.
    - Tên nhân viên (Chữ đậm, Roboto 20px).
    - Vai trò & Phòng ban (Chữ nhỏ, màu xám).
    - Nút "Chỉnh sửa ảnh" tinh tế.

#### B. Nhóm Cài đặt Tài khoản (Account Group)
Danh sách các mục dưới dạng List Item phẳng (Flat List):
- **Thông tin cá nhân**: Xem và cập nhật SĐT, Email, Địa chỉ liên hệ.
- **Đổi mật khẩu**: Mở màn hình/popup nhập mật khẩu cũ và mật khẩu mới (có icon ẩn/hiện mật khẩu).
- **Xác thực sinh trắc học**: Tùy chọn bật/tắt FaceID hoặc Vân tay để đăng nhập nhanh.

#### C. Nhóm Tiện ích & Hệ thống (System Group)
- **Thông báo**: Cài đặt nhận thông báo đẩy về nguồn hàng mới hoặc công việc.
- **Cấu hình lưu trữ (Admin only)**: Chuyển đổi giữa chế độ Cloudinary và Server nội bộ.
- **Quản lý phòng ban (Manager only)**: Xem danh sách thành viên trong team.

#### D. Nhóm Hỗ trợ (Support Group)
- **Hướng dẫn sử dụng**: Link đến các bài viết hoặc video hướng dẫn.
- **Chính sách & Bảo mật**: Thông tin pháp lý của ứng dụng.
- **Phiên bản**: Hiển thị số hiệu phiên bản hiện tại (ví dụ: v1.0.0).

#### E. Nút Đăng xuất (Logout Button)
- **Vị trí**: Đặt dưới cùng của danh sách.
- **Thiết kế**: Chữ màu Đỏ (Red-500) hoặc nút có viền đỏ để tạo sự khác biệt rõ rệt. Khi nhấn sẽ có Popup xác nhận "Bạn có chắc chắn muốn đăng xuất?".

#### F. Nút Quan tâm & Theo dõi Giá (Detail Screen)
- Trong trang Chi tiết Bất động sản, một icon **Heart (Trái tim)** nằm ở vị trí dễ thấy (Header hoặc cạnh nút Share).
- Khi nhấn: Icon chuyển sang màu Đỏ và hệ thống bắt đầu theo dõi biến động giá cho user này.

---

## 5. Thanh Điều hướng dưới (Bottom Navigation)

- Cố định 4 mục: **Trang chủ**, **Bảng hàng**, **Nhu cầu**, **Menu**.

---

## 6. Ghi chú về UX (UX Notes)

- **Minimalist Layout**: Hạn chế tối đa các đường viền (borders) cứng và hộp (cards) kín. Ưu tiên phân cách nội dung bằng khoảng trắng (spacing) rộng rãi và kích thước chữ (Typography).
- **Typography as UI**: Chữ không chỉ để đọc mà còn để định hướng. Các khối thông tin quan trọng nhất (như Giá, Tiêu đề) cần được phóng to và làm siêu đậm (Black/ExtraBold) để dẫn dắt mắt người dùng.
- **Active State**: Tab hoặc Icon đang chọn sẽ có chữ đậm hơn hẳn, màu đen tuyền hoặc đi kèm một dấu chấm màu nhấn (dot indicator) đơn giản, thay vì tô cả một mảng màu nền lớn.
- **Search First**: Thanh tìm kiếm luôn ở vị trí dễ tiếp cận, thiết kế dưới dạng thanh input không viền (borderless) với chữ placeholder lớn hoặc chỉ là một icon kính lúp to bản.
- **Loading State**: Sử dụng Text Skeleton (chỉ làm mờ/nhấp nháy các khối chữ) thay vì các khối hộp Skeleton xám lớn làm phá vỡ không gian trắng.
