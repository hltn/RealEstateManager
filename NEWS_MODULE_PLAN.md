# Kế Hoạch Dự Án: Module NewsFireCrawlManager

  

> Tài liệu này là **Project Plan** (vai trò PM), mô tả mục tiêu, phạm vi, thứ tự triển khai và tiêu chí nghiệm thu. Chi tiết kỹ thuật (DB schema, API contract, kiến trúc service, luồng xử lý cronjob) không nằm trong tài liệu này — xem `TECHNICAL_DESIGN.md`.

  

## 1. Mục Tiêu & Phạm Vi (Scope)

  

### 1.1. Mục tiêu nghiệp vụ

  

Tự động hóa toàn bộ chu trình: **thu thập tin tức bất động sản → sàng lọc/đánh giá bằng AI → biên tập/tổng hợp → xuất bản lên WordPress**, nhằm giảm công sức biên tập viên phải tự tìm, đọc và tổng hợp tin thị trường mỗi ngày, đồng thời cung cấp một kênh tin tức được cập nhật đều đặn trên website bất động sản của công ty.

  

### 1.2. Đối tượng người dùng / Stakeholder

  

- **Người dùng chính:** Admin nội bộ (biên tập viên / marketing) quản lý nội dung website — số lượng nhỏ (dự kiến 1-5 người dùng), không đối mặt trực tiếp với người dùng cuối (internal tool).

- **Phân quyền:** Trong phạm vi các milestone M1-M4, hệ thống dùng **một cấp quyền Admin duy nhất** (không phân vai trò Editor/Approver/Viewer riêng). Đây là giả định cần xác nhận lại nếu về sau có nhu cầu tách quy trình duyệt bài (VD: một người duyệt nội dung, một người khác duyệt đăng bài).

- **Bên liên quan gián tiếp:** Bộ phận pháp lý/biên tập nội dung website (do rủi ro bản quyền nội dung crawl lại, xem mục 4), và người quản trị hạ tầng WordPress đích.

  

### 1.3. Trong phạm vi (In-scope)

  

- Cấu hình và quản lý danh sách nguồn tin cần crawl.

- Thu thập tin tức tự động từ các nguồn đã cấu hình, loại bỏ trùng lặp trước khi đưa vào hàng chờ duyệt.

- Dùng AI để xếp hạng tin quan trọng, tóm tắt, và gắn nhận định chuyên gia cho từng tin.

- Quy trình duyệt thủ công của Admin trước khi lưu tin chính thức và trước khi đăng lên WordPress.

- Đăng bài tự động lên WordPress theo lịch, có theo dõi trạng thái đăng.

- Tổng hợp phân tích xu hướng thị trường từ nhiều tin đã chọn, và lưu lại lịch sử các lần phân tích để tra cứu.

- Các màn hình quản trị tương ứng (nguồn tin, tin thô, tin chính thức, cronjob, lịch sử phân tích).

  

### 1.4. Ngoài phạm vi (Out-of-scope)

  

- Không crawl nội dung dạng video hoặc mạng xã hội (Facebook, TikTok, YouTube...) — chỉ crawl trang tin/báo dạng bài viết văn bản.

- Không hỗ trợ đăng đồng thời lên nhiều site WordPress — chỉ một site đích duy nhất.

- Không đa ngôn ngữ — toàn bộ nội dung, tiêu chí xếp hạng AI và giao diện quản trị chỉ phục vụ tiếng Việt, thị trường bất động sản khu vực Hà Nội.

- Không phân quyền vai trò chi tiết (Editor/Approver/Viewer) — xem giả định ở mục 1.2.

- Không đảm bảo phát hiện tin theo thời gian thực — vận hành theo lịch cronjob (theo ngày), không phải streaming.

- Không tự động sửa nội dung đã đăng trên WordPress sau khi xuất bản (chỉ theo dõi trạng thái, không đồng bộ hai chiều).

  

## 2. Phân Rã Tính Năng (Feature Breakdown)

  

### F1 — Quản lý Nguồn Tin

- WI1.1: Cấu hình danh sách nguồn tin cần crawl (thêm/sửa/xóa/kích hoạt-tạm ngưng từng nguồn).

- WI1.2: Màn hình quản trị nguồn tin cho Admin.

  

### F2 — Thu Thập & Khử Trùng Lặp

- WI2.1: Job tự động thu thập tin theo các nguồn tin đang active, giới hạn theo ngày mục tiêu.

- WI2.2: Khử trùng lặp tin (theo URL và theo tiêu đề) trước khi tin được đưa vào hàng chờ duyệt, để không tốn công AI xử lý và không hiển thị tin trùng cho Admin.

- WI2.3: Màn hình xem/duyệt tin thô (tìm kiếm, sắp xếp, thao tác hàng loạt: xóa hoặc chuyển thành tin chính thức).

  

### F3 — Xử Lý & Xếp Hạng Bằng AI

- WI3.1: Job AI đọc dữ liệu tin thô đã crawl, xếp hạng chọn ra các tin quan trọng nhất theo tiêu chí nghiệp vụ đã thống nhất (tin liên quan trực tiếp thị trường Hà Nội, hoặc tin vĩ mô có tác động tới BĐS nói chung).

- WI3.2: AI sinh tóm tắt, lý do tin quan trọng, mức độ ảnh hưởng, đối tượng bị tác động, và nhận định chuyên gia cho từng tin được chọn.

- WI3.3: Đưa kết quả đã được AI xử lý vào hàng chờ duyệt để Admin xem trước khi lưu chính thức.

  

### F4 — Lưu Tin Chính Thức & Quản Lý Trước Khi Đăng

- WI4.1: Thao tác Admin "lưu" các tin đã duyệt từ hàng chờ thô thành tin chính thức, đảm bảo không phát sinh trùng lặp với tin đã lưu trước đó.

- WI4.2: Màn hình quản lý tin chính thức — tìm kiếm, lọc theo trạng thái (đã lưu / đã đăng / lỗi), thao tác hàng loạt.

  

### F5 — Đăng Bài Lên WordPress

- WI5.1: Đăng bài thủ công (Admin chọn tin, bấm đăng) và theo dõi trạng thái đăng (thành công/lỗi) trên màn hình quản lý tin chính thức.

- WI5.2: Tự động hóa việc đăng bài theo lịch (cronjob), chạy tiếp sau bước AI xử lý, giảm phụ thuộc vào việc Admin phải đăng tay hằng ngày.

- WI5.3: Màn hình quản lý cronjob — bật/tắt tự động hóa, xem trạng thái hoạt động của hệ thống ngầm.

  

### F6 — Phân Tích Thị Trường & Lịch Sử Phân Tích (Market Analysis History)

> Tính năng đã tồn tại trong code hiện tại, được chính thức hóa vào plan ở đây.

- WI6.1: Cho phép Admin chọn nhiều tin đã lưu, yêu cầu AI tổng hợp một bản phân tích xu hướng thị trường chung (khác với tóm tắt từng bài riêng lẻ ở F3 — đây là góc nhìn tổng hợp/vĩ mô dựa trên nhiều tin cùng lúc).

- WI6.2: Lưu lại lịch sử mỗi lần phân tích (thời điểm thực hiện, số tin/danh sách tin đã dùng làm căn cứ, nội dung kết quả phân tích) để tra cứu lại về sau, tránh phải chạy lại AI cho cùng một câu hỏi.

- WI6.3: Màn hình xem danh sách lịch sử phân tích và xem chi tiết từng bản phân tích (bao gồm khả năng copy nội dung để dùng lại, VD: đăng bài phân tích riêng lên WordPress).

  

## 3. Milestone & Thứ Tự Ưu Tiên

  

Thứ tự các milestone theo mức phụ thuộc kỹ thuật (milestone sau cần dữ liệu/luồng của milestone trước) và giá trị nghiệp vụ tăng dần (từ "có tin để xem" đến "tự động hoàn toàn" đến "khai thác sâu dữ liệu đã có").

  

### M1 — MVP: Thu thập & Duyệt tin thủ công

**Gồm:** F1 (Quản lý Nguồn Tin), F2 (Thu thập & Khử trùng lặp), WI4.1/WI4.2 ở mức tối thiểu (lưu tin chính thức + xem danh sách).

**Vì sao ưu tiên:** Đây là nền tảng dữ liệu — không có tin thu thập được thì không có gì để AI xử lý hay đăng bài. Cho phép Admin bắt đầu vận hành thủ công ngay, kiểm chứng chất lượng nguồn tin và cơ chế khử trùng lặp trước khi đầu tư vào AI.

  

### M2 — Xử lý AI tự động

**Gồm:** F3 (Xử lý & Xếp hạng bằng AI), tích hợp vào luồng duyệt tin ở M1.

**Vì sao ưu tiên:** Sau khi có dữ liệu tin ổn định, việc AI tự động xếp hạng và tóm tắt giúp giảm đáng kể thời gian Admin phải đọc và chọn tin thủ công — đây là giá trị cốt lõi khác biệt của module so với crawl tin thông thường.

  

### M3 — Tự động hóa đăng bài

**Gồm:** F5 (Đăng bài lên WordPress, đăng thủ công + cronjob tự động).

**Vì sao ưu tiên:** Chỉ tự động đăng bài sau khi luồng crawl + AI đã chạy ổn định và được kiểm chứng chất lượng qua M1-M2, để tránh đăng nhầm tin chưa qua kiểm duyệt đủ tốt lên website công khai.

  

### M4 — Phân tích thị trường & Lịch sử phân tích

**Gồm:** F6 (Market Analysis History).

**Vì sao ưu tiên:** Đây là tính năng khai thác sâu hơn trên dữ liệu đã có sẵn (tin đã lưu ở M1-M3), phục vụ nhu cầu tổng hợp báo cáo thị trường định kỳ — không phải tính năng thiết yếu để module vận hành cơ bản, nên xếp sau các milestone nền tảng.

  

## 4. Rủi Ro & Ràng Buộc

  

|  #  | Rủi ro / Ràng buộc                                                 | Ảnh hưởng                                                                                                                        | Ghi chú / Hướng xử lý đề xuất                                                                                                                                              |
| :-: | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | Rate limit của Firecrawl API                                       | Crawl bị chặn hoặc lỗi giữa chừng nếu quét quá nhiều nguồn/tần suất cao                                                          | Giới hạn số nguồn tin và tần suất crawl đồng thời; cần xác nhận hạn mức gói Firecrawl đang dùng                                                                            |
|  2  | Rate limit / hạn mức token của AI Provider (Gemini/ChatGPT/Claude) | Job AI có thể bị từ chối hoặc chậm nếu vượt hạn mức                                                                              | Xử lý theo lô (batch), có ngưỡng cảnh báo khi gần vượt hạn mức                                                                                                             |
|  3  | Chi phí AI tính theo token/bài                                     | Chi phí tăng tuyến tính theo số tin crawl mỗi ngày; tính năng M4 (phân tích gộp nhiều bài) tốn chi phí/lần cao hơn xử lý đơn bài | Cần theo dõi chi phí AI hàng tháng (xem KPI mục 5) để kiểm soát ngân sách vận hành                                                                                         |
|  4  | Rủi ro bản quyền nội dung                                          | Crawl và đăng lại nguyên văn nội dung từ nguồn khác có thể vi phạm bản quyền báo chí                                             | Giả định: hệ thống chỉ đăng bản tóm tắt/biên tập lại do AI sinh ra, không đăng nguyên văn nội dung crawl. Cần xác nhận với bộ phận pháp lý nếu công ty có yêu cầu chặt hơn |
|  5  | Rủi ro đăng đúp lên WordPress                                      | Mạng lag hoặc cronjob chạy trùng có thể khiến một tin bị đăng 2 lần                                                              | Cơ chế chống trùng ở tầng vận hành cần được architect-agent thiết kế (xem TECHNICAL_DESIGN.md)                                                                             |
|  6  | Rủi ro WordPress downtime                                          | Khi WordPress không phản hồi, tin đã duyệt bị kẹt ở trạng thái lỗi                                                               | Cần cơ chế theo dõi tin lỗi và cho phép Admin đăng lại thủ công                                                                                                            |
|  7  | Giả định phân quyền                                                | Chỉ một cấp Admin duy nhất trong M1-M4                                                                                           | Cần xác nhận lại nếu về sau có nhu cầu tách vai trò biên tập/duyệt bài                                                                                                     |
|  8  | Giả định phạm vi thị trường                                        | Tiêu chí xếp hạng AI hiện chỉ tập trung Hà Nội                                                                                   | Nếu mở rộng sang tỉnh/thành khác, cần điều chỉnh tiêu chí đánh giá AI (thuộc phạm vi thay đổi nghiệp vụ, không phải lỗi kỹ thuật)                                          |

  

## 5. KPI / Success Metrics

  

Áp dụng để đo lường hiệu quả vận hành sau khi từng milestone lên production, làm căn cứ cho `qa-agent` và Admin theo dõi định kỳ:

  

- **Độ phủ crawl:** số tin thu thập được/ngày trên mỗi nguồn tin.

- **Tỷ lệ khử trùng lặp:** % tin trùng lặp bị chặn trước khi vào hàng chờ AI (mục tiêu: càng cao càng tốt, giảm chi phí AI xử lý tin trùng).

- **Thời gian xử lý AI trung bình/bài** (đảm bảo job không bị nghẽn hoặc timeout khi số lượng tin tăng).

- **Tỷ lệ tin bị AI loại (reject)** so với tổng số tin thô — đo lường độ chính xác của bước sàng lọc.

- **Chi phí AI/tháng** (theo token, tách riêng chi phí xử lý tin thường và chi phí phân tích thị trường M4).

- **Tỷ lệ đăng WordPress thành công** trên tổng số tin được duyệt đăng.

- **Số lượt phân tích thị trường thực hiện/tháng** và tỷ lệ Admin xem lại lịch sử phân tích cũ (đo lường mức độ hữu ích của việc lưu lịch sử).

  

## 6. Định Nghĩa Hoàn Thành (Definition of Done)

  

### DoD chung cho mọi milestone

- Code tuân thủ coding guideline của dự án (NestJS + React + MongoDB): validate DTO đầy đủ, Swagger decorator, response format phân trang chuẩn, không dùng `console.log`, không lộ field nhạy cảm.

- Không có lỗi build/lint; có unit test cho logic nghiệp vụ chính (service).

- Đã qua kiểm thử của `qa-agent` theo checklist tương ứng dưới đây.

- Tài liệu kỹ thuật liên quan trong `TECHNICAL_DESIGN.md` được cập nhật nếu có thay đổi kiến trúc.

  

### DoD — M1 (Thu thập & Duyệt tin thủ công)

- [ ] Admin cấu hình được nguồn tin (thêm/sửa/xóa/bật-tắt) và thấy thay đổi có hiệu lực ngay ở lần crawl kế tiếp.

- [ ] Job crawl chạy được thủ công (trigger tay) và thu về tin thô từ ít nhất 1 nguồn tin thật.

- [ ] Tin trùng lặp (cùng URL hoặc cùng tiêu đề đã tồn tại) không xuất hiện lại trong hàng chờ duyệt.

- [ ] Admin xem được danh sách tin thô, tìm kiếm/sắp xếp, và chuyển được tin đã chọn thành tin chính thức mà không phát sinh lỗi trùng khóa.

- [ ] Test case dedupe (crawl lại cùng nguồn 2 lần liên tiếp không tạo tin trùng) đã được `qa-agent` xác nhận pass.

  

### DoD — M2 (Xử lý AI tự động)

- [ ] Job AI chạy sau Job crawl, trả về tối đa số tin quan trọng theo cấu hình, kèm đủ: tóm tắt, lý do quan trọng, mức độ ảnh hưởng, đối tượng tác động, nhận định chuyên gia.

- [ ] Tin không đạt tiêu chí (không liên quan Hà Nội và không có tác động vĩ mô tới BĐS) không xuất hiện trong kết quả AI trả về.

- [ ] Khi AI Provider lỗi hoặc timeout, hệ thống không crash và tin thô liên quan không bị mất (vẫn có thể xử lý lại sau).

- [ ] `qa-agent` xác nhận đã kiểm thử với ít nhất một bộ dữ liệu tin thật, đối chiếu chất lượng tóm tắt/xếp hạng với đánh giá thủ công của Admin.

  

### DoD — M3 (Tự động hóa đăng bài)

- [ ] Admin đăng thủ công một tin lên WordPress thành công và trạng thái được cập nhật đúng (thành công/lỗi).

- [ ] Cronjob tự động đăng bài chạy theo lịch đã cấu hình, không đăng trùng một tin 2 lần trong các lần chạy liên tiếp.

- [ ] Khi WordPress không phản hồi (giả lập downtime), tin được đánh dấu lỗi rõ ràng và Admin có thể đăng lại thủ công sau đó.

- [ ] Màn hình quản lý cronjob cho phép bật/tắt và phản ánh đúng trạng thái thực tế của job ngầm.

- [ ] `qa-agent` xác nhận test case chống đăng đúp (chạy cronjob 2 lần gần nhau) pass.

  

### DoD — M4 (Phân tích thị trường & Lịch sử phân tích)

- [ ] Admin chọn được nhiều tin đã lưu và nhận được một bản phân tích thị trường tổng hợp từ AI trong thời gian chấp nhận được (không timeout).

- [ ] Mỗi lần phân tích được lưu lại đầy đủ: thời điểm, danh sách tin đã dùng, nội dung kết quả.

- [ ] Admin xem được danh sách lịch sử phân tích (sắp xếp theo thời gian) và mở lại được nội dung chi tiết của từng lần phân tích cũ.

- [ ] Nội dung phân tích có thể copy để tái sử dụng (đăng thủ công nơi khác nếu cần).

- [ ] `qa-agent` xác nhận đã kiểm thử với trường hợp chọn 0 tin (phải báo lỗi hợp lệ, không gọi AI) và trường hợp chọn nhiều tin (kiểm tra thời gian phản hồi trong ngưỡng chấp nhận được).

  

## 7. Bước Tiếp Theo

  

Tài liệu này là input cho `architect-agent` để thiết kế/rà soát kiến trúc kỹ thuật chi tiết (schema, API contract, service, cronjob) trong `TECHNICAL_DESIGN.md`, sau đó chuyển cho `coder-backend-agent/coder-frontend-agent` triển khai theo từng milestone, và `qa-agent` kiểm thử theo checklist DoD ở mục 6. Với các hạng mục UI cần đầu tư sâu về UX (VD: trải nghiệm màn hình lịch sử phân tích ở M4), có thể phối hợp thêm với `web-design-agent`.