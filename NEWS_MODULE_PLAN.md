# Kế Hoạch Chi Tiết: Module NewsFireCrawlManager

## 1. Phân Tích Nghiệp Vụ (Business Analysis)
Module này có nhiệm vụ tự động hóa việc thu thập tin tức bất động sản, lọc nội dung bằng AI và đăng tự động lên hệ thống WordPress. 

**Các bước chính trong quy trình:**
1. **Quản lý Nguồn Tin:** Cấu hình danh sách các website cần crawl (URL, trạng thái kích hoạt).
2. **Thu Thập (Crawl):** Sử dụng API của Firecrawl để quét các nguồn tin.
3. **Lọc Trùng Lặp (Pre-AI):** Loại bỏ ngay các bài đã crawl trước đó dựa vào URL hoặc tiêu đề.
4. **Xử Lý AI:** Đưa nội dung qua AI (Gemini/ChatGPT/Claude) để đánh giá xem bài viết có đúng chủ đề bất động sản không, tóm tắt và phân loại (tags/categories).
5. **Đăng Bài (Publish):** Đăng bài viết đạt chuẩn lên WordPress thông qua REST API.

## 2. Cấu Trúc Database (MongoDB / Relational)
Bổ sung các bảng (hoặc collections) sau:

### 2.1. `NewsSource` (Nguồn tin tức)
- `_id`: UUID / ObjectID
- `name`: Tên nguồn (VD: Batdongsan.com.vn)
- `url`: Đường dẫn gốc cần crawl
- `isActive`: Boolean 
- `crawlConfig`: JSON (Cấu hình đặc thù cho Firecrawl như depth, rules)

### 2.2. `NewsArticle` (Bài viết)
- `_id`: UUID / ObjectID
- `sourceId`: Tham chiếu tới `NewsSource`
- `originalUrl`: URL gốc của bài (Đã loại bỏ UTM tracking params)
- `urlHash`: Chuỗi Hash (SHA-256) của `originalUrl` (Tạo Unique Index để tra cứu siêu nhanh và chống trùng)
- `title`: Tiêu đề
- `titleHash`: Chuỗi Hash (SHA-256) của tiêu đề (Chống trùng bài báo xuất hiện ở nhiều URL)
- `content`: Nội dung HTML/Markdown
- `aiSummary`: Nội dung tóm tắt do AI sinh ra
- `isRealEstate`: Boolean (Xác định bởi AI)
- `status`: Enum (`CRAWLED`, `AI_PROCESSED`, `REJECTED`, `POSTED_WP`, `ERROR`)
- `wpPostId`: String/Number (ID của bài viết trên WordPress)
- `wpPostUrl`: String
- `createdAt` & `updatedAt`: Timestamp

## 3. Luồng Xử Lý (Cronjobs)
Để tránh rate limit và dễ kiểm soát lỗi, chia thành 3 Job tuần tự:

### Job 1: Crawl & Deduplicate (Chạy tự động)
1. Lấy `NewsSource` có `isActive: true`.
2. Chạy vòng lặp tuần tự qua **từng link chuyên mục (Listing page)** của NewsSource đó:
   - **Crawl & Lưu file tạm:** Dùng Firecrawl API quét trang chuyên mục. Lưu kết quả thô ra file `.md` tại `tmp/` (ví dụ: `tmp/<categoryHash>_listing.md`).
   - **Xử lý bóc tách:** Đọc file `.md` vừa lưu, bóc tách các trường: STT, Tiêu đề, Ngày đăng, Mô tả, Nguồn, Link gốc, Link ảnh đại diện (nếu có).
   - **Gom dữ liệu:** Đưa (merge/append) mảng dữ liệu vừa bóc tách được vào một file JSON tổng (ví dụ: `tmp/<source_name>_extracted.json`).
3. **Xử lý và Crawl chi tiết:** Quét qua tất cả bài viết trong JSON tổng. Hệ thống sẽ dùng Firecrawl cào tiếp **trang chi tiết (Detail page)** của từng bài viết để lấy nội dung đầy đủ.
4. **Cập nhật file JSON:** Bổ sung và cập nhật lại dữ liệu vào file JSON để đảm bảo có đủ các trường: STT, Tiêu đề, Ngày đăng, Mô tả, Nội dung, Link ảnh đại diện, Nguồn.
5. **Lọc theo Ngày:** Loại bỏ hoàn toàn khỏi JSON những tin tức có ngày đăng **khác** với ngày mục tiêu (target date) truyền vào.

### Job 2: AI Processing (Chạy sau Job 1)
1. Gửi toàn bộ dữ liệu file JSON (bao gồm tiêu đề, mô tả, nội dung) để AI xử lý.
2. AI sẽ đọc dữ liệu và **xếp hạng chọn ra 5 tin quan trọng nhất** dựa trên Tiêu Chí Đánh Giá sau:
   - **Tiêu chí 1 (Khu vực Hà Nội):** Các tin tức về Bất động sản, Quy hoạch, Hạ tầng... phải liên quan trực tiếp tới Thủ đô Hà Nội.
   - **Tiêu chí 2 (Tác động Vĩ mô):** Các tin tức về Kinh tế vĩ mô, Chính trị, Pháp luật... phải có ảnh hưởng hoặc tác động tới thị trường bất động sản, đất đai nói chung.
3. Mồi (Prompt) yêu cầu AI trả về kết quả định dạng cấu trúc JSON chi tiết cho mỗi bản tin:
   - 1. Tiêu đề
   - 2. Tóm tắt (3-5 câu)
   - 3. Vì sao tin này quan trọng
   - 4. Mức độ ảnh hưởng (Rất cao / Cao / Trung bình)
   - 5. Đối tượng chịu tác động (Nhà đầu tư / Người mua ở thực / Chủ đầu tư / Môi giới / Ngân hàng)
   - 6. Nhận định chuyên gia (không quá 150 từ)
   - 7. Ngày đăng
   - 8. Nguồn báo
   - 9. Đường dẫn bài viết
   - 10. Từ khóa chính
4. Kết quả 5 tin này sẽ được lưu ra file JSON để Job 3 lấy dữ liệu hiển thị.

### Job 3: Lưu Tin (Thao tác Thủ công trên Giao diện)
1. Đây là màn hình gom chung hiển thị kết quả của Job 1 & Job 2.
2. Trên giao diện Admin, người dùng xem danh sách 5 tin quan trọng nhất (với 10 trường dữ liệu chi tiết ở trên) do AI phân tích.
3. Người dùng tích chọn những tin muốn lưu.
4. Khi bấm lưu, hệ thống sẽ tạo `urlHash` và lưu các tin này vào Database. Lúc này dữ liệu mới chính thức được lưu vào DB.

### Job 4: Đăng bài lên WordPress (Thao tác Thủ công trên Giao diện)
1. Một màn hình riêng biệt (với Sidebar/Vertical Tab) để quản lý danh sách các tin tức đã lưu trong Database (dạng Data Table).
2. Người dùng tích chọn các bài muốn đăng lên web.
3. Bấm nút Đăng: Hệ thống sẽ lấy dữ liệu từ Database và POST tới WordPress REST API (`/wp-json/wp/v2/posts`).
4. Nếu thành công -> Cập nhật trạng thái trong DB (`status = POSTED_WP`) và lưu `wpPostId`. Lỗi -> Cập nhật `ERROR`.

## 4. Giải Pháp Chống Trùng Lặp Trọn Vẹn (Duplication Checking)
- **Tầng 1 (Database - Quan trọng nhất):** Sử dụng thuật toán băm SHA-256 trên URL (sau chuẩn hóa) làm Unique Index trong DB. Mọi luồng xử lý trùng lặp sẽ bị DB báo lỗi "Duplicate Key" ngay lập tức. Băm thêm Tiêu đề để phát hiện trùng lặp giữa các nguồn.
- **Tầng 2 (Cronjob Concurrency):** Dùng cơ chế Distributed Lock (VD: Redis Lock) để đảm bảo không có 2 tiến trình crawl chạy cùng lúc đè lên nhau.
- **Tầng 3 (WordPress):** Khi gửi bài lên WP, đính kèm custom field (Meta Data) chứa giá trị `urlHash`. Trong trường hợp DB lỗi/mất đồng bộ, code có thể truy vấn `GET WP kèm meta_key=urlHash` trước khi đăng để kiểm tra bài này đã tồn tại trên WP chưa, giúp ngăn đăng đúp tuyệt đối.

## 5. Giao Diện Quản Trị (Admin UI)
Để tiện lợi cho việc vận hành, module này sẽ thiết kế 2 màn hình chính:
1. **Màn hình Thu Thập (Job 1, 2, 3):** 
   - Quản lý Cronjob (Bật/Tắt) & Nút bấm "Thu Thập Tin Tức Ngay".
   - Sau khi thực thi Crawl và AI, màn hình hiển thị trực tiếp danh sách Top 5 bản tin chi tiết (10 trường thông tin).
   - Có Checkbox để người dùng chọn tin cần duyệt & Nút "Lưu vào Database".
2. **Màn hình Quản Lý Tin Tức (Job 4):**
   - Truy cập thông qua một tab dọc (Sidebar / Vertical Tab).
   - Hiển thị danh sách các bài viết đã duyệt (đã lưu Database) dưới dạng Bảng (Data Table).
   - Cho phép chọn bài và bấm nút "Đăng lên WordPress".

## User Review Required
> [!IMPORTANT]
> Em đã cập nhật lại kế hoạch: (1) Cào chi tiết và lấy đủ data ở Job 1; (2) AI xếp hạng Top 5 tin có chấm điểm và lý do ở Job 2; (3) Tách thành Job 3 và Job 4 là các bước thao tác thủ công (Người dùng tự chọn tin để lưu DB, và chọn tin để đăng WordPress). Anh xem lại nhé, nếu OK thì bấm **Proceed** để em cập nhật lại Task List và cho Coder triển khai!
>
> Ngoài ra, hệ thống chống trùng lặp 3 tầng đã đảm bảo tuyệt đối không đăng lặp bài, anh có muốn bổ sung thêm điều kiện lọc bài viết nào khác (chẳng hạn lọc bài theo từ khóa cấm) không?
