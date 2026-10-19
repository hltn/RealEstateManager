# Thiết kế giao diện: Module Quản lý khách hàng (tích hợp vào app STND hiện có)

> Tài liệu mô tả cách thiết kế giao diện để module **hòa vào app hiện có**, dựa trên ảnh chụp trang "Quản lý Đăng tin WordPress". Toàn bộ phần quản lý khách hàng nằm trong **một tab ở menu bên trái**. Các mục đánh dấu **[Đề xuất]** cần bạn chốt.

## 1. Nguyên tắc

| Nguyên tắc | Ý nghĩa |
|---|---|
| **Hòa vào app hiện có** | Dùng lại khung trang, màu, kiểu bảng, nút, chip của app. Người dùng không cảm thấy đang qua một sản phẩm khác |
| **Chỉ thêm một mục menu** | Mọi chức năng khách hàng nằm trong một tab; điều hướng bên trong module dùng thanh tab ngang |
| **Ghi nhanh, nhắc đúng** | Ghi chú, kết quả liên hệ và hẹn nhắc nằm trên cùng một khung |
| **Luôn rõ việc tiếp theo** | Tab đầu tiên của module là "Việc hôm nay" |
| **Bảo vệ dữ liệu nhạy cảm** | CCCD luôn được che; người chỉ làm chăm sóc khách không thấy các mục quản trị kỹ thuật của app |

## 2. Giao diện app hiện có và cách module dùng lại

| Thành phần của app (theo ảnh) | Cách module sử dụng |
|---|---|
| **Menu trái:** logo STND, nhóm "MENU", mục có biểu tượng đường nét, mục đang chọn nền xanh nhạt chữ xanh, có mục mở rộng bằng mũi tên | Thêm **một mục** "Quản lý khách hàng" với biểu tượng đường nét cùng bộ, cùng kiểu chọn |
| **Thanh trên:** nút thu gọn menu, ô "Search or type command… ⌘K", nút chế độ tối, chuông có chấm đỏ, avatar "Admin" | Dùng lại nguyên khung. **⌘K** tìm được khách (tên, SĐT) và có lệnh nhanh như "Thêm khách". **Chuông** nhận thông báo khách (lịch hẹn, được phân khách). Module phải hiển thị tốt ở **chế độ tối** |
| **Tiêu đề trang** cỡ lớn đậm, dưới là dòng mô tả xám | Mỗi tab của module dùng đúng kiểu này |
| **Thanh bộ lọc một hàng:** "Hành động hàng loạt" + nút Áp dụng, ô tìm "Tìm trong trang này…", sắp xếp, trạng thái, ngày | Dùng nguyên mẫu cho danh sách khách |
| **Bảng trong thẻ bo góc:** ô chọn, STT, tiêu đề kèm ảnh, nguồn/ngày, chip trạng thái, nhóm nút hành động 2 hàng | Dùng nguyên mẫu: tên khách, tình trạng, dự án, tiến độ, thao tác |
| **Dòng phân trang:** "Hiển thị 41–49 / 49 · Trang 3/3" | Giữ nguyên cách trình bày |
| **Nút:** xanh dương (hành động chính), xanh lá (hành động phụ), nền xám nhạt (xem), chip bo tròn viền xám | Giữ nguyên ý nghĩa màu |

## 3. Vị trí và điều hướng

**Menu trái:** thêm đúng **một mục "Quản lý khách hàng"** **[Đề xuất: biểu tượng người/nhóm người]**.
- Vị trí: đặt **ở nhóm đầu của MENU** nếu nhân viên chăm sóc dùng hằng ngày, hoặc sau "Phân tích thị trường" và trước các mục cấu hình (Sources, AI Config, Cronjob...).
- **Hiển thị theo vai trò:** nhân viên chăm sóc chỉ thấy mục này, không thấy các mục kỹ thuật (Sources, AI Config, Request Logs, Cronjob). Admin thấy tất cả.

**Trong module:** thanh tab ngang ngay dưới tiêu đề, gạch chân xanh ở tab đang chọn.

| Tab | Nội dung | Ai thấy |
|---|---|---|
| Việc hôm nay | Trang mặc định khi vào module | Tất cả |
| Khách hàng | Danh sách; ba tab con Đang chăm sóc / Khách net / Bỏ | Tất cả (theo quyền) |
| Lịch hẹn | Lịch tuần/tháng các cuộc hẹn và nhắc việc | Tất cả |
| Báo cáo | Thống kê | Quản lý, Quản trị |
| Cài đặt | Danh mục, danh sách dự án, trường chân dung | Quản trị |

Quản lý người dùng vẫn dùng "Quản lý tài khoản" của app; module chỉ **bổ sung vai trò và quyền** liên quan đến khách (Quản lý, Nhân viên chăm sóc).

```
┌──────────────┬──────────────────────────────────────────────────┐
│ [STND logo]  │ ☰ 🔍 Search or type command…  ⌘K   ◐  🔔  (A) Admin ▾│
│ MENU         ├──────────────────────────────────────────────────┤
│ ▤ Raw Art…   │ Quản lý khách hàng                  [+ Thêm khách]│
│ ▦ Manage WP  │ Theo dõi, chăm sóc khách hàng, nhắc việc, lịch hẹn │
│ ◔ Phân tích… │ Việc hôm nay │ Khách hàng │ Lịch hẹn │ Báo cáo │ Cài đặt│
│ ☺ Quản lý KH │ ═══════════                                        │
│   (mục mới)  │                                                    │
│ ⚙ AI Config  │      (nội dung của tab đang chọn)                  │
│ …            │                                                    │
└──────────────┴──────────────────────────────────────────────────┘
```

## 4. Các màn hình

### 4.1 Việc hôm nay
Chia nhóm **Quá hạn → Hôm nay → Sắp tới**. Mỗi thẻ có: tên khách, tình trạng, dự án, lần liên hệ gần nhất, **gợi ý bước tiếp theo** và nút hành động. Thẻ dùng cùng kiểu bo góc, đường kẻ nhạt như bảng của app.

```
QUÁ HẠN (2)
┌─────────────────────────────────────────────────────────────┐
│ Nguyễn Văn A  [Có quan tâm]  Q'Terra                         │
│ Đã nhắn Zalo 05/10, chưa phản hồi (lần 3)                    │
│ Gợi ý: gửi thông tin mới của dự án, thử gọi buổi tối          │
│                          [Gọi] [Zalo]  [Ghi chú] [Hẹn lại]    │
└─────────────────────────────────────────────────────────────┘
HÔM NAY (5)   SẮP TỚI (8)
```

### 4.2 Danh sách khách (dùng nguyên mẫu trang "Manage WP")

```
Hành động hàng loạt: [Chọn ▾] [Áp dụng]  🔍 Tìm trong trang…
[Cập nhật mới nhất ▾] [Tình trạng ▾] [Dự án ▾] [Khu vực ▾] [Phụ trách ▾]
[Đang chăm sóc 128] [Khách net 14] [Bỏ 32]
Hiển thị 1–20 / 128 khách · Trang 1/7
┌────────────────────────────────────────────────────────────────┐
│☐ STT KHÁCH           TÌNH TRẠNG   DỰ ÁN    TIẾN ĐỘ  HẸN   THAO TÁC │
│☐ 1   Nguyễn Văn A    [Quan tâm]   Q'Terra  ●●○○    09/10  [Gọi][Zalo]│
│      0912 xxx xxx    H★ T                                [Ghi chú][Xem]│
└────────────────────────────────────────────────────────────────┘
```

- Ô **Hành động hàng loạt** chứa: phân người chăm sóc, đổi tình trạng, gắn thẻ.
- Nhóm nút thao tác giữ **bố cục 2 hàng × 2 nút** như app: hàng trên Gọi (xanh dương) và Zalo (xanh lá), hàng dưới Ghi chú và Xem (nền xám nhạt).
- Chip tình trạng dùng cùng hình dạng chip "Đã crawl" (bo tròn, viền xám), thêm màu nhẹ.

### 4.3 Chi tiết khách
Mở thành trang riêng, có đường dẫn "Quản lý khách hàng › Nguyễn Văn A" và nút quay lại. Bố cục **3 vùng**:

```
┌ Nguyễn Văn A  [Có quan tâm ▾]  Phụ trách chính: Hạnh ★  [+ Thêm người]┐
│ 09xx xxx xxx   [Gọi] [Zalo]                                          │
├────────────────┬─────────────────────────────┬───────────────────────┤
│ THÔNG TIN      │ NHẬT KÝ CHĂM SÓC            │ TIẾN ĐỘ  ●●○○  50%    │
│ Khu vực (nơi ở)│ ┌─────────────────────────┐ │ ☑ Nhu cầu  mô tả…     │
│ Nguồn khách    │ │ Ghi chú nhanh…          │ │ ☐ Động cơ  mô tả…     │
│ Dự án (chip)   │ │ [Kết quả ▾][Hẹn nhắc ▾] │ │ ☑ Tài chính mô tả…    │
│ CCCD  ••••1234 │ │                  [Lưu]  │ │ ☐ Thời gian mô tả…    │
│                │ └─────────────────────────┘ │                       │
│ CHÂN DUNG      │ 05/10 15:30 · Hạnh          │ NHÓM CHĂM SÓC         │
│ Nghề, sở thích │ Gọi, khách bận, hẹn gọi lại │ ★ Hạnh · Thảo         │
│ Đầy đủ: 40%    │ 03/10 09:10 · Thảo          │ GỢI Ý TIẾP THEO       │
│                │ Đã nhắn Zalo, chưa phản hồi │ Thử gọi buổi tối      │
└────────────────┴─────────────────────────────┴───────────────────────┘
```

- **Ô ghi chú nhanh luôn ở đầu nhật ký**; chọn "kết quả liên hệ" thì hệ thống gợi ý mốc hẹn nhắc.
- **CCCD** chỉ hiện 4 số cuối; nút "Hiện" chỉ có với người được cấp quyền và ghi lại mỗi lần xem.
- Tiến độ là **4 chấm**, thay cho thanh ký tự █░ của Sheets.

### 4.4 Lịch hẹn, Báo cáo, Cài đặt
- **Lịch hẹn:** lịch tuần/tháng; bấm vào cuộc hẹn mở nhanh hồ sơ khách.
- **Báo cáo:** thẻ số liệu và biểu đồ theo tình trạng, nguồn khách, dự án, khu vực, người phụ trách; bộ lọc theo thời gian.
- **Cài đặt:** danh mục (tình trạng, nguồn, khu vực), **danh sách dự án**, **trường chân dung** (thêm/sửa/bớt).

### 4.5 Giai đoạn sau: ghi âm và văn bản cuộc gọi
Thẻ **Cuộc gọi** trong dòng thời gian: người gọi, thời lượng, tóm tắt, nút nghe lại (người có quyền), văn bản mở rộng, biểu tượng cho biết **khách đã đồng ý ghi âm**.

## 5. Thành phần mới cần thêm (tối thiểu)

Chỉ thêm những gì app hiện chưa có, vẽ bằng **cùng màu, chữ, góc bo** của app:

| Thành phần | Mô tả |
|---|---|
| Thanh tab trong trang | Tab ngang, gạch chân xanh ở tab đang chọn |
| Chip tình trạng có màu | Có quan tâm (xanh lá nhạt), Chưa tiếp cận (xám), Khách net (cam nhạt), Bỏ (đỏ nhạt); luôn kèm chữ **[Đề xuất]** |
| Thanh tiến độ 4 bước | 4 chấm tương ứng 4 tiêu chí |
| Nhóm chăm sóc | Ảnh đại diện chồng nhau, người phụ trách chính có ★ |
| Chip dự án / sở thích | Chọn nhiều, xóa bằng ×, gợi ý khi gõ |
| Mục dòng thời gian | Ngày giờ, người viết, nội dung, nhãn kết quả liên hệ |
| Ô che dữ liệu | CCCD dạng che, nút hiện theo quyền |
| Banner trùng SĐT | "Đã có khách này, do [tên] chăm sóc", kèm nút đề nghị tham gia |
| Hộp xác nhận + Hoàn tác | Khi đổi tình trạng sang "Bỏ" |

## 6. Phong cách hình ảnh
**Kế thừa hoàn toàn từ app** (bộ màu TailAdmin, phông Outfit, Tailwind v4; xem file Design System), không thêm màu hay font mới: nền trắng, đường kẻ nhạt, góc bo, chữ không chân, biểu tượng đường nét. Hỗ trợ **chế độ tối** có sẵn của app. (Đề xuất "xanh biển Neptune" ở bản trước đã bỏ vì app đã có bộ nhận diện STND.)

## 7. Co giãn màn hình
- **Máy tính:** như các trang hiện có; chi tiết khách 3 vùng.
- **Máy tính bảng:** menu thu gọn bằng nút ☰ sẵn có; chi tiết khách 2 vùng.
- **Điện thoại (web):** bảng chuyển thành danh sách thẻ; chi tiết khách chia tab Thông tin / Nhật ký / Tiến độ; nút Gọi và Zalo cố định.
- Ứng dụng di động iPhone/Android (đã chốt trong kế hoạch) dùng cùng nhãn, màu và biểu tượng.

## 8. Trạng thái và tương tác
- **Chưa có dữ liệu:** lời nhắc ngắn kèm nút hành động ("Chưa có khách. Thêm khách đầu tiên").
- **Đang tải:** khung xám giữ chỗ.
- **Lỗi:** thông báo tiếng Việt dễ hiểu, không hiện mã lỗi.
- **Lưu nháp** ghi chú; cảnh báo khi rời trang chưa lưu.
- **Nhiều người cùng xem một khách:** hiện ai đang mở hồ sơ, tự cập nhật khi có ghi chú mới.
- **Phím tắt:** dùng chung ⌘K của app cho tìm khách và lệnh nhanh.

## 9. Nội dung và tiếng Việt
- Nhãn module dùng **tiếng Việt** (menu hiện có đang lẫn tiếng Anh như "Raw Articles", "Manage WP").
- Nhãn nút ngắn, động từ rõ: "Ghi chú", "Hẹn nhắc", "Gọi", "Phân khách".
- Ngày `dd/MM/yyyy`, giờ 24 giờ; hiển thị tương đối ("hôm qua") kèm ngày đầy đủ khi rê chuột.
- Tiền theo cách nói quen thuộc ("2,5 tỷ", "800 triệu"); tìm kiếm không phân biệt dấu.

## 10. Phân quyền trên giao diện
- Mục hoặc nút không đủ quyền thì **ẩn**, không chỉ khóa.
- Nhân viên chỉ thấy khách được phân; Quản lý thấy khách của nhóm; Quản trị thấy tất cả.
- Mọi thay đổi hiển thị người thực hiện và thời điểm.

## 11. Cần bạn xác nhận
1. Vị trí mục "Quản lý khách hàng" trong menu (đầu nhóm MENU hay sau "Phân tích thị trường") và biểu tượng.
2. Nhân viên chăm sóc có dùng **chung hệ thống tài khoản** hiện có không, và có chỉ thấy mục khách hàng không?
3. **Đã xác nhận:** web admin dùng React 19 + Tailwind CSS v4, phông Outfit, biểu tượng lucide-react, biểu mẫu react-hook-form + zod, thông báo react-hot-toast, chọn ngày flatpickr, có sẵn chế độ tối. Module dùng lại các thư viện này; chi tiết màu và thành phần ở file `06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md`. Lịch hẹn và Báo cáo có thể dùng FullCalendar và ApexCharts (đã có sẵn kiểu dáng trong CSS, nhưng thư viện chưa cài).
4. Các **cột mặc định** của bảng khách: muốn hiện những cột nào?
5. Có muốn dựng **bản mẫu trực quan** (mockup) cho 3 màn chính đúng phong cách app này không?
