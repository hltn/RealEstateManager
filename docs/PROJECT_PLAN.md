Kế Hoạch Chi Tiết: Module NewsFireCrawlManager (Business Plan)

1. Phân Tích Nghiệp Vụ (Business Analysis)

Module này có nhiệm vụ tự động hóa việc thu thập tin tức bất động sản, lọc nội dung bằng AI và đăng tự động lên hệ thống WordPress.

Các bước chính trong quy trình:

Quản lý Nguồn Tin: Cấu hình danh sách các website cần crawl (URL, trạng thái kích hoạt).

Thu Thập (Crawl): Sử dụng công cụ (Firecrawl) để quét các nguồn tin.

Lọc Trùng Lặp (Pre-AI): Loại bỏ ngay các bài đã crawl trước đó để tiết kiệm chi phí xử lý.

Xử Lý AI: Đưa nội dung qua AI để đánh giá xem bài viết có đúng chủ đề bất động sản không, tóm tắt và phân loại (tags/categories).

Đăng Bài (Publish): Đăng bài viết đạt chuẩn lên WordPress.

2. Các Thực Thể Dữ Liệu Nghiệp Vụ (Business Entities)

(Chi tiết về Database Schema, Field Type, Hash logic vui lòng xem tại TECHNICAL_DESIGN.md)

Hệ thống xoay quanh 2 thực thể chính:

Nguồn tin tức (News Source): Lưu trữ thông tin website đích, trạng thái hoạt động và cấu hình quét.

Bài viết (News Article): Lưu trữ dữ liệu thô (sau khi quét), dữ liệu tinh (sau khi AI xử lý) và trạng thái xuất bản (Đã lưu, Đã đăng, Lỗi). Yêu cầu phải lưu trữ lại vết của nguồn bài viết gốc và thông tin trên WordPress sau khi đăng.

3. Luồng Xử Lý Nghiệp Vụ (Business Workflows & Jobs)

Để đảm bảo tính ổn định và dễ kiểm soát, luồng xử lý chia thành 4 bước (Jobs) tách biệt:

Job 1: Thu thập & Làm sạch (Tự động)

Hệ thống chỉ lấy các Nguồn tin đang được "Kích hoạt".

Quét qua các trang chuyên mục của nguồn tin để lấy danh sách bài viết.

Vào từng bài viết chi tiết để lấy nội dung đầy đủ (Tiêu đề, Ngày đăng, Mô tả, Nội dung, Ảnh đại diện).

Lọc bỏ các tin tức không nằm trong ngày mục tiêu (Target date). Gom toàn bộ dữ liệu hợp lệ lại để chuẩn bị cho bước AI.

Job 2: Đánh giá bằng AI (Tự động, nối tiếp Job 1)

Gửi dữ liệu thô cho AI đánh giá và chọn ra 5 tin quan trọng nhất.

Tiêu Chí Đánh Giá Bắt Buộc:

Khu vực Hà Nội: Ưu tiên tin Bất động sản, Quy hoạch, Hạ tầng tại Thủ đô.

Tác động Vĩ mô: Các tin Kinh tế, Chính trị, Pháp luật có ảnh hưởng lớn tới thị trường.

Yêu cầu Đầu ra của AI: Phải tạo ra được Tóm tắt, Nhận định mức độ quan trọng, Mức độ ảnh hưởng, Đối tượng bị tác động, Nhận định chuyên gia và Từ khóa.

Job 3: Duyệt và Lưu Tin (Thao tác Thủ công bởi Admin)

Giao diện hiển thị kết quả 5 tin xuất sắc nhất từ AI.

Admin đọc duyệt, chọn lọc những tin ưng ý.

Thực hiện thao tác "Chuyển (Move)" để đưa tin từ trạng thái thô sang trạng thái chính thức trong hệ thống (sẵn sàng chờ đăng). Hệ thống phải đảm bảo không lưu trùng bài.

Job 4: Xuất bản lên WordPress (Thao tác Thủ công bởi Admin)

Màn hình quản lý các bài viết đã duyệt.

Admin chọn các bài muốn xuất bản.

Thực hiện thao tác "Đăng (Publish)". Hệ thống đồng bộ sang WordPress và cập nhật trạng thái xuất bản.

4. Yêu Cầu Ràng Buộc Nghiệp Vụ (Business Constraints)

Bảo toàn dữ liệu khi di chuyển: Khi Admin duyệt tin (từ Thô sang Chính thức), hệ thống phải giữ nguyên vẹn mọi thông tin gốc, đặc biệt là các dấu vết để nhận diện bài viết.

Chống trùng lặp tuyệt đối (Zero Duplication):

Hệ thống không được phép lưu 1 bài báo 2 lần vào CSDL (nhận diện qua URL hoặc Tiêu đề).

Hệ thống không được phép đăng đúp 1 bài lên WordPress (cần có cơ chế đối chiếu với WP trước khi đăng).

Không được phép có 2 tiến trình thu thập chạy đè lên nhau cùng 1 thời điểm.

5. Giao Diện Quản Trị (Admin UI / UX)

Áp dụng thiết kế tối giản (Minimalism), hỗ trợ thao tác hàng loạt (Bulk Actions).

Quản Lý Nguồn Tin: Xem danh sách, Thêm/Sửa/Xóa nguồn, và Bật/Tắt trạng thái nhanh (Toggle).

Màn hình Thu Thập (Duyệt tin thô):

Hiển thị dạng bảng (Có STT, Checkbox chọn nhiều).

Cột Tiêu đề có lồng ghép Ảnh đại diện (Thumbnail) cho trực quan.

Tìm kiếm, sắp xếp nội dung.

Nút hành động hàng loạt: Duyệt lưu (Move) hoặc Xóa.

Màn hình Quản Lý Tin Tức (Xuất bản):

Tương tự màn hình Duyệt tin, nhưng dành cho tin đã lưu.

Nút hành động hàng loạt: Đăng WP (Publish) hoặc Xóa.

Màn hình Quản Lý Cronjob:

Cấu hình bật/tắt luồng tự động ngầm.

6. PM Sign-off & Task Delegation

Product Manager Sign-off: Kế hoạch đã được rà soát để loại bỏ các chi tiết kỹ thuật chuyên sâu, tập trung 100% vào luồng nghiệp vụ (Business Flow) và trải nghiệm quản trị (Admin UX).

Tiếp theo: Các kỹ sư và architect_agent sử dụng tài liệu này kết hợp với TECHNICAL_DESIGN.md để tiến hành phát triển.