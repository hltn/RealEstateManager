# Project Plan: Module quản lý & chăm sóc khách hàng (Web + Ứng dụng di động)

> Bản này chỉ mô tả mục đích, tính năng và yêu cầu. Các mục đánh dấu **[Giả định]** cần xác nhận ở cuối tài liệu.

## 1. Mục đích

Hiện nay việc quản lý khách hàng đang chạy trên Google Sheets (DSKH, DSKH_DROP, DSKH_NET) kèm script. Cách này dễ lỗi khi thay đổi cấu trúc bảng, khó phân quyền, không có lịch sử thay đổi và khó dùng trên điện thoại.

Module nhằm:
1. Quản lý và **chăm sóc khách hàng** trong một ứng dụng: ghi nhận quá trình chăm sóc, đo tiến độ tương tác, phân loại khách.
2. Thay việc "chuyển dòng giữa các sheet" bằng **đổi tình trạng**, không mất dữ liệu và có lịch sử.
3. Cho phép **nhiều người cùng chăm sóc một khách**, mọi người trong nhóm chăm sóc cùng thấy thông tin và ghi chú của khách đó.
4. Tự động hóa các việc đang làm tay: tính tiến độ, ghi ngày cập nhật, chống trùng SĐT, nhắc lịch hẹn.
5. Xây dựng **chân dung khách hàng** (sở thích, nghề nghiệp, gia đình, thói quen...) càng đầy đủ càng tốt để nhân viên chăm sóc đúng người, đúng cách, đúng thời điểm.
6. **Ứng dụng trên điện thoại với đẩy thông báo** để nhân viên nhận việc và nhắc lịch kịp thời.

**Bỏ hoàn toàn các thành phần của Google Sheets:** thanh tiến độ bằng ký tự, dropdown trong ô, tô màu ô bằng script, copy/xóa dòng giữa các sheet.

## 2. Người dùng **[Giả định]**

| Vai trò | Làm được gì |
|---|---|
| Quản trị | Toàn quyền, cấu hình danh mục, quản lý người dùng |
| Quản lý | Xem khách của nhóm mình, xem báo cáo, phân khách cho nhân viên |
| Nhân viên chăm sóc | Xem và sửa các khách được phân cho mình, ghi chú chăm sóc, đổi tình trạng |

## 3. Tính năng

### 3.1 Khách hàng
| ID | Tính năng | Ưu tiên |
|---|---|---|
| C1 | Hồ sơ khách: họ tên, SĐT, nguồn khách, **dự án quan tâm** (chọn từ danh sách dự án có sẵn, chọn được nhiều dự án), **khu vực** (nơi khách đang ở), CCCD (không bắt buộc), tình trạng (Chưa tiếp cận / Có quan tâm / Khách net / Bỏ) | Phải có |
| C2 | Nhật ký chăm sóc theo dòng thời gian (ngày + nội dung), **ghi rõ người viết** | Phải có |
| C3 | Gợi ý hướng chăm sóc tiếp theo, có ngày hẹn và nhắc việc | Nên có |
| C4 | 4 tiêu chí tương tác (Nhu cầu, Động cơ, Tài chính, Thời gian): mỗi tiêu chí có mô tả và dấu hoàn thành | Phải có |
| C5 | Tự tính **tiến độ** theo số tiêu chí hoàn thành | Phải có |
| C6 | Các danh sách Đang chăm sóc / Khách net / Bỏ là **bộ lọc theo tình trạng**; đổi tình trạng thì khách tự xuất hiện ở đúng danh sách | Phải có |
| C7 | Tự ghi "ngày cập nhật cuối" mỗi khi hồ sơ được sửa | Phải có |
| C8 | **Phân khách cho nhiều người cùng chăm sóc:** thêm/bớt người; người được phân xem được toàn bộ hồ sơ và nhật ký của khách đó; người không được phân thì không thấy. Mỗi khách có **một người phụ trách chính** trong nhóm chăm sóc | Phải có |
| C9 | **Bảo vệ CCCD** (khi có nhập): chỉ người có quyền được xem, che bớt số khi hiển thị, ghi nhật ký mỗi lần xem | Phải có |
| C10 | **Chân dung khách hàng:** nhóm trường để hiểu khách (sở thích, nghề nghiệp, gia đình...), tất cả đều không bắt buộc; xem danh sách gợi ý bên dưới | Phải có |
| C11 | **Thẻ (tag) sở thích, nghề nghiệp** để gắn nhanh, tìm và lọc khách theo đặc điểm chung | Nên có |
| C12 | **Độ đầy đủ chân dung:** thanh % cho biết đã thu thập được bao nhiêu, và gợi ý các thông tin còn thiếu để hỏi khách ở lần chăm sóc tới | Nên có |
| C13 | **Nhắc chăm sóc theo dịp đặc biệt:** sinh nhật khách, ngày kỷ niệm thì thông báo cho những người đang chăm sóc | Nên có |

**Gợi ý các trường chân dung (C10)** **[Đề xuất, bạn chọn trường nào giữ]**

| Nhóm | Trường gợi ý |
|---|---|
| Cá nhân | Ngày sinh, giới tính, tình trạng hôn nhân, số con, nơi ở hiện tại, quê quán |
| Nghề nghiệp | Nghề nghiệp, nơi làm việc, chức vụ, ngành |
| Sở thích và lối sống | Sở thích, thể thao/giải trí, du lịch, ẩm thực, thú cưng, phong cách sống, tính cách và cách giao tiếp ưa thích |
| Dịp đặc biệt | Sinh nhật, ngày kỷ niệm, dịp quan trọng khác |
| Gia đình và quan hệ | Người ra quyết định mua (vợ/chồng, con...), người thân liên quan, người giới thiệu |
| Cách liên hệ | Kênh ưa thích (gọi, Zalo...), khung giờ thuận tiện, cách xưng hô |
| Nhu cầu BĐS | Loại hình quan tâm, mục đích (ở / đầu tư / cho con), ngân sách (khoảng), thời điểm dự kiến mua |

Nhóm "Nhu cầu BĐS" nên lưu dạng trường có cấu trúc (danh sách chọn, khoảng số) để lọc và thống kê được, đồng thời liên kết với 4 tiêu chí Nhu cầu / Động cơ / Tài chính / Thời gian ở C4.

### 3.2 Dùng chung
| ID | Tính năng | Ưu tiên |
|---|---|---|
| X1 | Đăng nhập, phân quyền theo vai trò và theo khách được phân | Phải có |
| X2 | Chống trùng SĐT. Nếu khách đã có và do người khác phụ trách thì chỉ báo "đã có khách này, do [tên] chăm sóc" (không lộ chi tiết) và cho phép đề nghị được thêm vào nhóm chăm sóc **[Giả định]** | Phải có |
| X3 | Tìm kiếm, lọc, sắp xếp (theo tình trạng, nguồn khách, dự án, khu vực, người chăm sóc, tiến độ, ngày cập nhật, nghề nghiệp, sở thích/thẻ) | Phải có |
| X4 | Nhật ký thay đổi (ai, lúc nào, đổi gì), gồm mọi lần đổi tình trạng và đổi người chăm sóc | Phải có |
| X5 | **Đẩy thông báo trên điện thoại:** được phân khách mới, lịch hẹn đến hạn, có ghi chú mới từ người cùng chăm sóc, khách lâu chưa được chăm sóc (người phụ trách chính nhận thông báo ưu tiên) | Phải có |
| X6 | Dashboard thống kê: khách theo tình trạng, nguồn khách, dự án, khu vực; tiến độ trung bình; khách theo người chăm sóc | Nên có |
| X7 | Quản lý danh mục: tình trạng, nguồn khách, khu vực, người dùng và **danh sách dự án** (để chọn khi nhập hồ sơ khách) | Phải có |
| X8 | Nhập/xuất Excel/CSV, gồm nhập dữ liệu cũ từ DSKH, DSKH_DROP, DSKH_NET | Phải có |
| X9 | **Ứng dụng di động cho cả iPhone và Android** (có đẩy thông báo) và bản web cho máy tính | Phải có |
| X10 | Quản trị **tự thêm, sửa, bớt trường chân dung** (kiểu chữ, danh sách chọn, ngày, chọn nhiều) mà không cần lập trình | Nên có |

### 3.3 Mở rộng sau (tùy chọn): Zalo **[Chưa quyết định]**
| ID | Tính năng | Ghi chú |
|---|---|---|
| Z1 | Nút mở nhanh cuộc trò chuyện Zalo với khách từ hồ sơ (theo SĐT) | Đơn giản, có thể làm ngay |
| Z2 | Gửi tin xác nhận lịch hẹn, thông tin dự án cho khách qua kênh chính thức của doanh nghiệp (Zalo OA) | Cần đăng ký OA, mẫu tin được Zalo duyệt, có phí |
| Z3 | Lưu hội thoại Zalo vào nhật ký khách | Chỉ áp dụng được cho hội thoại qua OA, không lấy được tin nhắn Zalo cá nhân của nhân viên |

### 3.4 Ghi âm có đồng ý, chuyển văn bản và phân tích (AudioProtect) **[Triển khai ở giai đoạn sau]**

**Mục đích:** lưu lại nội dung các cuộc trao đổi với khách (dưới dạng văn bản) để phục vụ chăm sóc và phân tích khách hàng sau này.

**Nguyên tắc (tham khảo tính năng AudioProtect của Grab):**
- Chỉ ghi âm khi **khách đã đồng ý**; mặc định là không ghi.
- Bản ghi được mã hóa, hạn chế người truy cập, chỉ dùng cho mục đích chăm sóc khách.
- Có thời hạn lưu và cách xóa khi khách yêu cầu.

**Giới hạn của điện thoại cần lưu ý:** trên cả iPhone và Android, ứng dụng bên thứ ba không tự ghi âm được cuộc gọi thường (khi khách gọi số cá nhân của nhân viên). Vì vậy việc ghi âm tự động phải đi qua **cuộc gọi trong ứng dụng hoặc số tổng đài của công ty**.

| ID | Tính năng | Ưu tiên |
|---|---|---|
| R1 | **Ghi nhận đồng ý của khách:** lưu thời điểm, hình thức đồng ý, người ghi nhận; khách có thể rút lại; chưa có đồng ý thì không ghi âm | Phải có |
| R2 | **Gọi khách qua ứng dụng, ghi âm tự động** trên máy chủ (iPhone và Android) khi khách đã đồng ý | Phải có |
| R3 | **Số tổng đài của công ty** để khách gọi vào, chuyển cho người phụ trách chính; ghi âm theo cùng quy tắc | Phải có |
| R4 | **Câu thông báo đầu cuộc gọi:** "cuộc gọi có thể được ghi âm để phục vụ chăm sóc" | Phải có |
| R5 | **Tải lên bản ghi** từ cuộc gọi thường (bản ghi có sẵn của điện thoại) và gắn vào hồ sơ khách; ghi rõ nguồn | Nên có |
| R6 | **Chuyển giọng nói thành văn bản tiếng Việt**, lưu vào nhật ký chăm sóc kèm thời điểm và người gọi | Phải có |
| R7 | **Tóm tắt cuộc gọi** và gợi ý thông tin điền vào chân dung khách (sở thích, nghề nghiệp, ngân sách...) để nhân viên duyệt trước khi lưu; gợi ý hướng follow-up | Nên có |
| R8 | **Quản lý bản ghi:** mã hóa; chỉ người đang chăm sóc và người được cấp quyền mới nghe/xem; ghi nhật ký mỗi lần nghe; thời hạn lưu cấu hình được; xóa khi khách yêu cầu | Phải có |
| R9 | **Tìm kiếm trong văn bản cuộc gọi** theo từ khóa, khách, thời gian | Nên có |
| R10 | Ghi âm **buổi gặp/xem nhà trực tiếp** bằng micro khi cả nhân viên và khách đồng ý | Tùy chọn |

## 4. Quy tắc nghiệp vụ

1. Tiến độ khách = số tiêu chí hoàn thành / 4 (mỗi tiêu chí 25%).
2. Đổi tình trạng không làm mất dữ liệu, chỉ đổi danh sách hiển thị:
   - "Bỏ" đưa khách vào danh sách Bỏ.
   - "Khách net" đưa khách vào danh sách Khách net.
   - "Có quan tâm" đưa khách từ Bỏ hoặc Khách net trở lại danh sách đang chăm sóc.
3. Khách phải có tên và SĐT mới được lưu. CCCD không bắt buộc.
4. SĐT là duy nhất trong toàn hệ thống.
5. "Ngày cập nhật cuối" tự ghi khi sửa bất kỳ thông tin nào của khách; không do người dùng nhập tay.
6. **Quyền xem khách:** Quản trị xem tất cả; Quản lý xem khách của nhóm mình; nhân viên chỉ xem khách được phân cho mình **[Giả định]**.
7. **Nhiều người chăm sóc:** mọi người trong danh sách chăm sóc cùng xem, ghi chú và đổi tình trạng; mọi thay đổi ghi rõ người thực hiện.
   - Mỗi khách có **đúng một người phụ trách chính**; hệ thống yêu cầu chọn khi phân khách lần đầu.
   - Người phụ trách chính là đầu mối: nhận thông báo ưu tiên (khách lâu chưa chăm sóc, lịch hẹn) và được thống kê riêng trong báo cáo **[Giả định]**.
   - Quản lý/Quản trị đổi được người phụ trách chính; khi người phụ trách chính bị gỡ khỏi khách thì phải chọn người thay thế **[Giả định]**.
8. Khi được thêm vào chăm sóc một khách, người đó nhận thông báo đẩy; khi bị gỡ, không còn thấy khách đó.
9. **Thông tin chân dung:**
   - Mọi trường đều không bắt buộc, nhân viên điền dần qua các lần chăm sóc.
   - Mỗi thông tin ghi rõ người cập nhật, ngày cập nhật và nguồn (khách tự chia sẻ / nhân viên quan sát).
   - Không ghi các nội dung nhạy cảm (tôn giáo, chính trị, sức khỏe, đời sống riêng tư), trừ khi khách tự chia sẻ và thật sự cần cho việc chăm sóc.
   - Chỉ những người đang chăm sóc khách (và Quản lý, Quản trị) mới xem được chân dung.
10. **Ghi âm (giai đoạn sau):** chỉ ghi âm khi khách đã đồng ý; văn bản chuyển từ cuộc gọi là dữ liệu cá nhân, áp dụng cùng quy tắc phân quyền như chân dung; không đưa CCCD hoặc thông tin nhạy cảm sang dịch vụ phân tích bên ngoài khi chưa được phép.

## 5. Yêu cầu chung

- **Tiếng Việt:** lưu và tìm kiếm đúng chữ có dấu; múi giờ Việt Nam (GMT+7).
- **Bảo mật dữ liệu cá nhân:** SĐT và đặc biệt CCCD là dữ liệu nhạy cảm. Chỉ thu thập CCCD khi thật cần, phân quyền chặt, che số khi hiển thị, sao lưu định kỳ và nên tham khảo quy định bảo vệ dữ liệu cá nhân hiện hành.
- **Dữ liệu chân dung:** thu thập nhiều thông tin cá nhân hơn đồng nghĩa trách nhiệm bảo vệ lớn hơn. Chỉ thu thập thông tin phục vụ việc chăm sóc, thông báo cho khách và xin đồng ý khi cần, và phải có cách sửa hoặc xóa thông tin khi khách yêu cầu.
- **Thông báo:** đẩy được trên cả iPhone và Android; người dùng tự bật/tắt từng loại thông báo.
- **Tốc độ:** danh sách vài nghìn khách vẫn mở nhanh.
- **Dễ chuyển đổi:** nhập được dữ liệu từ ba sheet hiện có và có chế độ xem dạng bảng quen thuộc.

## 6. Các quyết định đã chốt

| Nội dung | Quyết định |
|---|---|
| CCCD | Tùy chọn, không bắt buộc |
| Nhiều người chăm sóc | Có **người phụ trách chính** cho mỗi khách |
| Dự án quan tâm | Chọn từ danh sách dự án có sẵn; một khách chọn được nhiều dự án |
| Khu vực | Là nơi khách đang ở |
| Ứng dụng di động | Cần cho cả iPhone và Android |
| Ghi âm cuộc gọi (AudioProtect) | Đưa vào kế hoạch, **triển khai ở giai đoạn sau** (mục 3.4) |

## 7. Câu hỏi cần xác nhận

1. Có khoảng bao nhiêu người dùng, và có những vai trò nào ngoài mục 2?
2. Cột Tình trạng còn giá trị nào ngoài "Chưa tiếp cận", "Có quan tâm", "Khách net", "Bỏ"?
3. **Người phụ trách chính** khác gì so với người cùng chăm sóc (ví dụ chỉ người này được thêm/bớt người, hay đổi tình trạng)? Ai được đổi người phụ trách chính?
4. **Danh sách dự án** do ai quản lý (thêm/sửa)? Mỗi dự án cần lưu thông tin gì (chủ đầu tư, vị trí, loại hình, giá...)?
5. **Khu vực nơi khách ở** dùng danh sách nào: quận/huyện Hà Nội, các tỉnh/thành khác, cả nước ngoài (có khách Việt kiều)?
6. Có làm các tính năng Zalo ở mục 3.3 không, và làm mục nào?
7. **Chân dung khách:** trong bảng gợi ý ở mục 3.1, bạn muốn giữ nhóm trường nào, thêm trường nào? Muốn Quản trị tự thêm/bớt trường (X10) hay cố định từ đầu?
8. Có cần ghi nhận **khách đồng ý** cho phép lưu thông tin cá nhân không (ví dụ một ô xác nhận trong hồ sơ)?
9. **Ghi âm (giai đoạn sau):** lưu file âm thanh bao lâu và lưu văn bản bao lâu? Ai được phép nghe lại?
10. Có cần ghi âm **buổi gặp/xem nhà trực tiếp** (R10), hay chỉ ghi âm cuộc gọi?
