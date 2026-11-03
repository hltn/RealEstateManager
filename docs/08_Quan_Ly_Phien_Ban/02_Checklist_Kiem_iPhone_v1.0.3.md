# Checklist kiểm trên iPhone Safari thật — v1.0.3

Phạm vi: các mục FE mobile ở trạng thái `Xong một phần` (PT-017 đến PT-026). Code và test đã xong; file này chỉ phục vụ bước **thử trên máy thật**.

**Chuẩn bị:** iPhone + Safari, đăng nhập tài khoản có quyền thấy khách; mở 1 khách có tên dài, có vài tiêu chí đã tick, có vài nhật ký chăm sóc (do chính tài khoản đang đăng nhập viết). Thử cả chế độ dọc.

Ghi kết quả vào cột cuối: `Đạt` / `Lỗi` (kèm ảnh chụp màn hình nếu lỗi). Mục `Đạt` hết thì đổi trạng thái PT tương ứng sang `Xong`.

| # | Mã | Làm gì | Kỳ vọng | Kết quả |
|---|---|---|---|---|
| 1 | PT-017 | Mở chi tiết khách có tên dài | Breadcrumb **không** hiện tên khách | |
| 2 | PT-017 | Mở màn sửa khách, màn tạo lịch hẹn | Breadcrumb không lệch, không vỡ dòng | |
| 3 | PT-018 | Tab "Thông tin" | **Không** có SĐT; trường chưa có dữ liệu không hiện (cả "Thông tin" lẫn "Chân dung khách hàng") | |
| 4 | PT-018 | Tìm SĐT ở chỗ khác (header, nút gọi) | SĐT vẫn còn ở đó (chỉ bỏ khỏi section "Thông tin") | |
| 5 | PT-019 | Mở ô "Dự án quan tâm", gõ vài chữ không dấu | Lọc được theo tên dự án; **bàn phím iOS không che danh sách** | |
| 6 | PT-019 | Chọn 2–3 dự án, lưu | Chọn được nhiều dự án, lưu đúng | |
| 7 | PT-020 | Vào tab Nhật ký | Form ghi chú **ẩn** mặc định | |
| 8 | PT-020 | Bấm "Ghi chú" | Form đầy đủ: nội dung, kênh liên hệ, kết quả, ảnh, nhắc bước tiếp theo | |
| 9 | PT-020 | Chọn/tải ảnh từ thư viện iPhone, lưu | Tải được, nhật ký hiện ảnh | |
| 10 | PT-020 | Gõ dở rồi chuyển sang khách khác | Bản nháp **không** dính sang khách kia | |
| 11 | PT-021 | Mở tab Lịch sử thay đổi | Mặc định thu gọn; chỉ tải khi bấm mở | |
| 12 | PT-022 | Nhật ký do mình viết (cũ hơn 24 giờ nếu có) | Có nút **Sửa**, sửa và lưu được | |
| 13 | PT-022 | Nhật ký của người khác (tài khoản không phải Quản trị/Quản lý) | Không có nút Sửa/Xóa | |
| 14 | PT-024 | Mở menu sidebar, kéo co giãn thanh địa chỉ Safari | Panel phủ kín từ mép trên, header phía sau **không hở** | |
| 15 | PT-025 | Chọn một mục trong menu | Sidebar **tự đóng** | |
| 16 | PT-025 | Nhìn nút X | Ở bên **phải**, trong vùng nền trắng | |
| 17 | PT-026 | Form tạo lịch hẹn: ô Giờ | Chữ không đè icon, đủ padding trái | |
| 18 | PT-026 | Ô Dự án, ô Địa điểm | Chữ không đè icon; placeholder "Địa điểm" đọc được; ô Dự án có tìm kiếm (không dấu), có "Không chọn" | |
| 19 | PT-023 | Tab Tiến độ: khách ở "Có quan tâm", tick đủ **3/4** | Tự chuyển sang "Khách net"; giao diện báo rõ việc tự đổi | |
| 19b | PT-023 | Khách ở trạng thái khác "Có quan tâm" ("Chưa tiếp cận" hoặc trạng thái tùy biến do Quản trị thêm, thuộc nhóm Chưa tiếp cận/Có quan tâm), tick đủ **3/4** | Tự **lên "Khách net"** (đè, đã chốt 2026-11-03); giao diện báo rõ việc tự đổi | |
| 20 | PT-023 | Tick thêm lên **4/4** | Không đổi trạng thái | |
| 21 | PT-023 | Bỏ tick từ 4/4 xuống **3/4** | Tự lên "Khách net" (đã chốt) | |
| 22 | PT-023 | Hạ xuống **2/4** (khách đang "Khách net" do cơ chế tự đổi) | Tự về "Có quan tâm" | |
| 22b | PT-023 | Khách đang "Khách net" do **người dùng chọn tay** (đổi tình trạng bằng tay), hạ xuống **2/4** (thử thêm 1/4, 0/4) | Tự về "Có quan tâm" (đã chốt 2026-11-03: không còn phân biệt NET do ai đặt) | |
| 22c | PT-023 | Khách đang ở "Khách net", tick đủ 3/4 (không đổi tiêu chí khác) | Không đổi trạng thái, không báo tự đổi | |
| 23 | PT-023 | Khách đang ở "Bỏ", tick đủ 3/4 rồi hạ xuống 2/4 | **Không** đổi trạng thái ở cả hai lần ("Bỏ" được miễn) | |
| 24 | PT-023 | Khách đang ở "Chưa tiếp cận" hoặc "Có quan tâm", đang 4/4, hạ xuống 2/4 | **Không** đổi trạng thái (chỉ "Khách net" mới tự về "Có quan tâm") | |
| 25 | PT-023 | Khách có 2 người cùng chăm sóc A và B; A tick đủ 3/4 làm tự lên "Khách net"; mở chuông thông báo bằng tài khoản B | B nhận 1 thông báo nêu khách và việc tự đổi; **A không** nhận thông báo cho chính mình | |
| 26 | PT-023 | (Như mục 25) Khách chỉ có A chăm sóc, A tự tick làm đổi trạng thái | Không có thông báo nào (người tick là người nhận duy nhất) | |
| 27 | PT-023 | (Như mục 25) B hạ tiêu chí làm "Khách net" tự về "Có quan tâm" | A nhận thông báo; B không | |

## Lỗi hay gặp trên Safari iOS (để soi kỹ)

- Ô `time` và `select`: Safari hay bỏ qua kiểu mặc định, chữ có thể đè icon (mục 17, 18).
- Thanh địa chỉ co giãn khi cuộn làm `100vh` sai, sidebar hở mép trên (mục 14).
- Bàn phím iOS che phần dưới danh sách/form (mục 5, 8).

## Lưu ý

- Mục 19–27 (PT-023) theo 3 điểm **Oniichan đã chốt 2026-11-03** (mục 7 câu 9 của file kế hoạch): đủ 3/4 đè mọi trạng thái trừ "Bỏ"; hạ dưới 3/4 thì "Khách net" (kể cả do chọn tay) về "Có quan tâm", trừ "Bỏ"; có thông báo cho người cùng chăm sóc (trừ người tick). Mục 25-27 (thông báo, loại `CUSTOMER_STATUS_AUTO_CHANGED`) cần bản có cả BE và FE hiển thị loại thông báo mới; cần 2 tài khoản cùng chăm sóc khách.
- Mục 4 và 13 kiểm phần "không hồi quy" (cái bỏ có chủ đích; cái người khác không được làm).
