# Kế hoạch Tổng quan: Ứng dụng Quản lý Nguồn hàng Bất động sản

Dự án này nhằm xây dựng một hệ thống quản lý tập trung các nguồn hàng bất động sản (nhà phố, căn hộ, đất nền...) dành cho môi giới hoặc sàn giao dịch, giúp tối ưu hóa quy trình theo dõi và khớp khách.

---

## 1. Mục tiêu Dự án
- **Quản lý tập trung**: Thay thế việc quản lý bằng Excel/Sổ tay truyền thống.
- **Tốc độ**: Truy xuất nhanh thông tin nguồn hàng khi có khách hỏi.
- **Tính chính xác**: Cập nhật trạng thái (còn hàng/hết hàng) theo thời gian thực.
- **Tính thẩm mỹ**: Giao diện hiện đại, chuyên nghiệp, dễ sử dụng trên cả máy tính và điện thoại.

---

## 2. Các Chức năng Cần có (MVP)

### A. Quản lý Nguồn hàng (Properties Management)
- **Thêm mới/Chỉnh sửa**: 
    - Thông tin cơ bản: 
        - **Mã hàng**: Mã định danh duy nhất (Ví dụ: HN-CG-001).
        - Tiêu đề, mô tả.
        - Địa chỉ: Chọn từ danh mục Tỉnh/Thành -> Quận/Huyện -> Phường/Xã -> Số nhà/Tên đường.
        - **Vị trí & Tọa độ**:
            - Tọa độ GPS: Vĩ độ (Latitude) và Kinh độ (Longitude).
            - Link vị trí: Đường dẫn đến Google Maps hoặc các nền tảng bản đồ khác.
    - **Thông tin Người đăng**: Tự động lưu người tạo hoặc chọn người phụ trách.
    - **Thông tin Chủ sở hữu (Landlord)**: Liên kết với danh mục Chủ nhà để truy xuất nhanh thông tin liên hệ.
    - Thông số kỹ thuật chi tiết:
        - Diện tích: Diện tích sổ / Diện tích thực tế.
        - Kích thước: Độ rộng mặt tiền, chiều sâu (Ẩn nếu là **Cho thuê**).
        - Kết cấu: Số tầng, số phòng ngủ, số toilet, diện tích xây dựng (Ẩn nếu là **Cho thuê**), tổng diện tích sàn (GFA) (Ẩn nếu là **Cho thuê**).
        - Đặc điểm ngõ (nếu có): Khoảng cách đến mặt phố (Ẩn nếu là **Cho thuê**), độ rộng ngõ (m) (Ẩn nếu là **Cho thuê**).
        - Hướng: Hướng cửa chính, hướng ban công.
        - Tòa nhà: Số tầng cao, số tầng hầm, năm xây dựng.
        - Tiện ích đi kèm: 
            - Nội khu: Thang máy, Hồ bơi, Sân vườn, Gara ô tô, Tầng hầm.
            - Ngoại khu: Gần trường học, Gần bệnh viện, Gần trung tâm thương mại.
        - Nội thất: Đầy đủ nội thất, nội thất cơ bản, hoặc nhà trống (Không nội thất).
        - Pháp lý: Đã có sổ đỏ, Giấy phép xây dựng, Hợp đồng mua bán, Đang chờ sổ.
    - Hình thức giao dịch: **Bán** hoặc **Cho thuê**.
    - Phân khúc thị trường: **Sơ cấp** (Dự án mới) hoặc **Thứ cấp** (Mua đi bán lại). 
        - *Lưu ý*: Với hình thức **Cho thuê**, mặc định là **Thứ cấp**.
    - **Dự án**: Thuộc dự án nào (Liên kết từ danh sách dự án).
    - Giá bán/Giá thuê (Hỗ trợ đơn vị Tỷ, Triệu).
    - **Hoa hồng**: Tỉ lệ % hoặc số tiền cố định (Ví dụ: 3% hoặc 100 triệu).
- **Loại hình Bất động sản**: 
    - Chung cư.
    - Biệt thự - Liền kề.
    - Khách sạn - Căn hộ dịch vụ.
    - Nhà mặt phố.
    - Tòa nhà văn phòng.
    - Nhà ngõ.
- **Trạng thái**: Đang bán, Đang cọc, Đã bán, Ngừng giao dịch.
- **Quản lý Hình ảnh (Phân loại chi tiết)**: 
    - Cho phép tải lên tối đa 10 ảnh cho mỗi danh mục sau:
        - **Ảnh mặt tiền / Tổng thể**.
        - **Ảnh mặt đường / Ngõ**.
        - **Ảnh phòng khách**.
        - **Ảnh phòng bếp**.
        - **Ảnh phòng ngủ**.
        - **Ảnh nhà vệ sinh**.
    - Chức năng: Kéo thả, sắp xếp thứ tự, xem ảnh phóng to.
- **Lịch sử Thay đổi (Change History / Versioning)**:
    - Tự động lưu bản sao lưu (snapshot) toàn bộ thông tin tại thời điểm chỉnh sửa.
    - Ghi nhận: Người thực hiện thay đổi, thời gian thay đổi, các trường dữ liệu đã thay đổi.
    - Chức năng: Xem lại lịch sử các phiên bản, so sánh sự khác biệt (diff), và khôi phục (restore) về phiên bản cũ.
- **Nhập liệu bằng AI (AI-Powered Entry)**:
    - **Voice-to-Data**: Tích hợp nhận diện giọng nói để người dùng mô tả bất động sản bằng ngôn ngữ tự nhiên.
    - **Phân tích Thông minh (Smart Parsing)**: Sử dụng AI (LLM) để tự động bóc tách các thông tin như: tiêu đề, giá, diện tích, địa chỉ, số tầng, số phòng... từ văn bản/giọng nói.
    - **Tự động điền (Auto-fill)**: Điền thông tin vào form một cách chính xác, giảm thiểu thao tác nhập liệu thủ công.
    - **Quét Pháp lý (AI OCR Scanning)**: 
        - Nhận diện và trích xuất dữ liệu từ ảnh chụp Sổ đỏ/Sổ hồng (số thửa, số tờ bản đồ, diện tích, địa chỉ, mục đích sử dụng...).
        - Tự động hóa việc đối chiếu dữ liệu pháp lý.
    - **Hỗ trợ đa ngôn ngữ/phương ngữ**: Nhận diện tốt giọng nói tiếng Việt các vùng miền.

### B. Tìm kiếm & Bộ lọc Nâng cao (Search & Filter)
- **Tìm kiếm nhanh**: Theo từ khóa, địa chỉ hoặc mã số căn.
- **Bộ lọc chuyên sâu**: 
    - Lọc theo Hình thức (Bán/Cho thuê).
    - Lọc theo Dự án.
    - Lọc theo Phân khúc (Sơ cấp/Thứ cấp).
    - Lọc theo Loại hình (Chung cư, Biệt thự, Nhà phố...).
    - Lọc theo vị trí (Quận/Huyện).
    - Lọc theo tiện ích (Thang máy, Gara, Gần trường học...).
    - Lọc theo Người đăng/Người phụ trách.
    - Lọc theo đặc điểm (hướng nhà, pháp lý).
- **Sắp xếp (Sorting)**:
    - Giá: Tăng dần / Giảm dần.
    - Thời gian cập nhật: Mới nhất / Cũ nhất.
    - Ngày lên bảng hàng: Mới nhất.

### C. Quản lý Dự án (Projects Management)
- **Thêm/Sửa/Xóa dự án**: Tên dự án, Chủ đầu tư, Vị trí, Quy mô, Pháp lý dự án.
- **Trạng thái dự án**: Sắp mở bán, Đang mở bán, Đã bàn giao.
- **Quản lý Hình ảnh**: Tải lên bộ ảnh phối cảnh, mặt bằng tổng thể của dự án.
- **Liên kết**: Tự động liệt kê các bất động sản thuộc dự án này.

### D. Quản lý Địa điểm (Location Management)
- **Cấu trúc Cha/Con**: Quản lý danh mục Tỉnh/Thành phố, Quận/Huyện/Thị xã.
- **Tùy chỉnh**: Admin có thể thêm mới vùng miền hoặc khu vực trọng điểm để lọc nhanh.

### E. Quản lý Người dùng & Cơ cấu (Users & Organization)
- **Quản lý Phòng/Ban (Department Management)**: 
    - Tạo/Sửa/Xóa phòng ban.
    - Gán nhân viên vào các phòng ban cụ thể.
- **Danh sách nhân viên**: Tên, SĐT, Email, Vai trò, Phòng ban trực thuộc.
- **Thống kê hiệu quả**: Số lượng nguồn hàng, tương tác khách hàng theo từng nhân viên/phòng ban.

### F. Hệ thống Phân quyền (Permissions System)
- **Admin (Quản trị hệ thống)**: 
    - Toàn quyền hệ thống.
    - Quản lý cơ cấu tổ chức (Phòng/Ban), quản lý người dùng.
- **Trưởng phòng Kinh Doanh**: 
    - Xem, Thêm, Sửa, Xóa Người dùng trong phòng/ban được phân công.
    - Xem, Thêm, Sửa, Xóa Bất động sản trong phạm vi phòng/ban mình phụ trách.
    - Xem, Thêm, Sửa, Xóa Nhu cầu khách hàng của cá nhân mình và nhân viên trong phòng.
- **Đầu chủ (Listing Agent)**: 
    - Xem, Thêm, Sửa, Xóa nguồn hàng do chính mình tạo ra.
    - Xem, Thêm, Sửa, Xóa Nhu cầu khách hàng của riêng mình.
- **Đầu khách (Sales Agent)**: 
    - Chỉ có quyền Xem toàn bộ hoặc một phần nguồn hàng để tư vấn cho khách.
    - Xem, Thêm, Sửa, Xóa Nhu cầu khách hàng của riêng mình.

### G. Quản lý Chủ nhà & Liên hệ
- **Hồ sơ Chủ nhà**: Lưu trữ thông tin định danh (Tên, SĐT, Địa chỉ, Ghi chú đặc điểm cá nhân).
- **Danh sách Bất động sản Sở hữu (Crucial)**: 
    - Khi xem chi tiết một chủ nhà, hệ thống **bắt buộc liệt kê danh sách toàn bộ các bất động sản** mà người này đang sở hữu/ký gửi.
    - Hiển thị tóm tắt trạng thái (Đang bán/Đã bán), giá và mã hàng để truy cập nhanh.
- **Nhật ký tương tác**: Lịch sử liên hệ, ghi chú quá trình thương lượng giá và các yêu cầu riêng biệt của chủ nhà.

### H. Công cụ Tạo Tin & Chia sẻ (Listing & Marketing Tools)
- **Vị trí tích hợp**: Xuất hiện trực tiếp trong trang **Chi tiết Bất động sản** để người dùng có thể tạo và gửi thông tin ngay lập tức khi đang xem nguồn hàng.
- **Tạo Tin đăng Tự động**:
    - Trích xuất dữ liệu từ nguồn hàng để tự động soạn thảo tin quảng cáo mẫu.
    - Cho phép chọn ảnh từ kho dữ liệu có sẵn hoặc tải lên ảnh mới dành riêng cho tin đăng này.
- **Biên tập Tin đăng**:
    - Chỉnh sửa nội dung văn bản, thay đổi thứ tự hình ảnh trước khi xuất bản.
    - Lưu nhiều mẫu tin khác nhau cho cùng một bất động sản (Ví dụ: Tin ngắn cho Zalo, Tin chi tiết cho Facebook).
- **Chia sẻ Đa kênh (Instant Sharing)**:
    - Nút gửi nhanh qua **Zalo, Facebook, Messenger, Telegram**.
    - Hỗ trợ copy nội dung kèm bộ ảnh hoặc chia sẻ đường dẫn (URL) xem trực tiếp với giao diện chuyên nghiệp.

### I. Dashboard & Thống kê
- Tổng số lượng nguồn hàng hiện có.
- Biểu đồ phân bổ nguồn hàng theo khu vực/phân khúc.
- Thống kê hàng mới về trong ngày/tuần.

### K. Quản lý Nhu cầu Khách hàng (Customer Demand Management)
- **Lưu trữ Nhu cầu**: 
    - Thông tin khách hàng: Tên, Số điện thoại, Tuổi.
    - Tiêu chí tìm kiếm: Khu vực quan tâm, Phân khúc tài chính, Mục đích (Mua để ở / Đầu tư), Loại hình bất động sản.
- **Khớp hàng & Thông báo (Auto-Matching & Notification)**:
    - Hệ thống tự động kiểm tra khi có nguồn hàng mới được đăng lên hoặc cập nhật trạng thái "Đang bán".
    - Gửi thông báo ngay lập tức cho người dùng nếu nguồn hàng phù hợp với các tiêu chí nhu cầu đã lưu.
- **Gợi ý Nguồn hàng phù hợp**:
    - Trong trang chi tiết của mỗi nhu cầu, tự động liệt kê danh sách các bất động sản đang có trong hệ thống thỏa mãn tiêu chí của khách hàng đó.

### L. Tính năng Nâng cao (Phát triển sau)
- **Hệ thống Bản đồ Thông minh (Smart Map)**: 
    - Tích hợp trực tiếp Google Maps hoặc OpenStreetMap vào ứng dụng.
    - Hiển thị danh sách nguồn hàng dưới dạng các biểu tượng (icons) trên bản đồ.
    - Hiển thị nhanh các thông số khi tương tác: **Tên bất động sản, Diện tích, Giá tổng, Đơn giá/m2**.
    - Hỗ trợ tìm kiếm theo vùng khoanh vùng trên bản đồ.
- **Tự động Định giá**: AI gợi ý giá dựa trên dữ liệu thị trường và lịch sử giao dịch.
- **Xuất file**: Xuất thông tin bất động sản ra file PDF để in ấn hoặc gửi khách.
- **Phân tích Xu hướng**: Thống kê các vùng/phân khúc đang được khách hàng quan tâm nhất.

---

## 3. Kiến trúc Công nghệ Đề xuất

| Thành phần | Công nghệ | Ghi chú |
| :--- | :--- | :--- |
| **Mobile App** | **React Native (Expo)** | Đa nền tảng (iOS/Android), hiệu năng mượt mà, phát triển nhanh. |
| **Backend API** | **Node.js (NestJS)** | Framework mạnh mẽ, dễ mở rộng, quản lý phân quyền và logic AI tốt. |
| **Database** | **PostgreSQL** | Lưu trữ dữ liệu quan hệ (User, Department, Property) chặt chẽ và ổn định. |
| **Lưu trữ Ảnh** | **Cloudinary** | Tự động tối ưu dung lượng ảnh, chèn Watermark bản quyền, CDN tốc độ cao. |
| **AI / NLP** | **OpenAI Whisper** | Nhận diện giọng nói chính xác cao cho tính năng nhập liệu Voice-to-Data. |
| **Vision / OCR** | **Gemini Pro Vision** | Trích xuất dữ liệu từ ảnh chụp Sổ đỏ và phân tích nội dung hình ảnh. |
| **Thiết kế** | **Modern UI/UX** | Giao diện tối giản (Minimalism), hỗ trợ Dark mode, Micro-animations. |

---

## 4. Lộ trình Triển khai (Roadmap)

1. **Giai đoạn 1 (Tuần 1)**: Thiết kế Database và UI Mockup. Xây dựng khung giao diện chính.
2. **Giai đoạn 2 (Tuần 2)**: Phát triển tính năng CRUD (Thêm/Sửa/Xóa) nguồn hàng và bộ lọc.
3. **Giai đoạn 3 (Tuần 3)**: Xây dựng module quản lý hình ảnh và Dashboard.
4. **Giai đoạn 4 (Tuần 4)**: Kiểm thử, tối ưu hiệu năng và đóng gói ứng dụng.

---

## 5. Ghi chú Quan trọng về Trải nghiệm (UX Notes)

- **Tính liền mạch**: Công cụ Tạo tin & Chia sẻ phải được tích hợp ngay bên trong màn hình Chi tiết Bất động sản, không mở trang mới.
- **Tương tác Bản đồ**: Icon trên bản đồ phải hiển thị "Pop-over" chứa thông tin giá/m2 và ảnh đại diện khi chạm vào.
- **Thông báo Thông minh**: Ưu tiên thông báo đẩy (Push notification) cho Sales ngay khi có nguồn hàng mới khớp với nhu cầu khách hàng đang theo dõi.
- **Bảo mật dữ liệu**: Chỉ Admin mới có quyền xóa vĩnh viễn dữ liệu; các cấp bậc khác chỉ được chuyển trạng thái "Ngừng giao dịch".

---

*Tài liệu này được soạn thảo để định hướng phát triển cho dự án Real Estate Manager.*
