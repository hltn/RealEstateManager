# Project Plan: Module quản lý & chăm sóc khách hàng (Web + Ứng dụng di động)

> Bản này chỉ mô tả mục đích, tính năng và yêu cầu. Các mục đánh dấu **[Giả định]** đã được xác nhận ngày 22/10/2026 (xem **Nhật ký quyết định** ở [tài liệu 04, mục 11](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md#11-nhật-ký-quyết-định-2026-10-22)); riêng việc nhập dữ liệu từ 3 sheet cũ được **hoãn sang giai đoạn sau**.

## 1. Mục đích

Hiện nay việc quản lý khách hàng đang chạy trên Google Sheets (DSKH, DSKH_DROP, DSKH_NET) kèm script. Việc chuyển dữ liệu từ ba sheet này sang module là **giai đoạn sau** (mục 3.5). Cách này dễ lỗi khi thay đổi cấu trúc bảng, khó phân quyền, không có lịch sử thay đổi và khó dùng trên điện thoại.

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
| C1 | Hồ sơ khách: họ tên, SĐT, **email (không bắt buộc)**, nguồn khách, **dự án quan tâm** (chọn từ danh sách dự án có sẵn, chọn được nhiều dự án), **khu vực** (nơi khách đang ở), CCCD (không bắt buộc), tình trạng (Chưa tiếp cận / Có quan tâm / Khách net / Bỏ). **Không có mã khách hàng**: khách được nhận diện bằng họ tên + SĐT (SĐT duy nhất) | Phải có |
| C2 | Nhật ký chăm sóc theo dòng thời gian (ngày + nội dung), **ghi rõ người viết**, có thể **đính kèm ảnh** (tối đa 5 ảnh mỗi ghi chú) | Phải có |
| C3 | Gợi ý hướng chăm sóc tiếp theo, có ngày hẹn và nhắc việc. Loại lịch hẹn: xem nhà, gặp mặt, **ký cọc / HĐMB**, gọi lại, khác | Nên có |
| C4 | 4 tiêu chí tương tác (Nhu cầu, Động cơ, Tài chính, Thời gian): mỗi tiêu chí có mô tả và dấu hoàn thành | Phải có |
| C5 | Tự tính **tiến độ** theo số tiêu chí hoàn thành | Phải có |
| C6 | Các danh sách **Tất cả (tab mặc định) / Chưa tiếp cận / Có quan tâm / Khách net / Bỏ** là **bộ lọc theo tình trạng** (không còn nhóm gộp cũ); đổi tình trạng thì khách tự xuất hiện ở đúng danh sách | Phải có |
| C7 | Tự ghi "ngày cập nhật cuối" mỗi khi hồ sơ được sửa | Phải có |
| C8 | **Phân khách cho nhiều người cùng chăm sóc:** thêm/bớt người; người được phân xem được toàn bộ hồ sơ và nhật ký của khách đó; người không được phân thì không thấy. Mỗi khách có **một người phụ trách chính** trong nhóm chăm sóc | Phải có |
| C9 | **Bảo vệ CCCD** (khi có nhập): chỉ người có quyền được xem, che bớt số khi hiển thị, ghi nhật ký mỗi lần xem | Phải có |
| C10 | **Chân dung khách hàng:** nhóm trường để hiểu khách (sở thích, nghề nghiệp, gia đình...), tất cả đều không bắt buộc; xem danh sách gợi ý bên dưới | Phải có |
| C11 | **Thẻ (tag) sở thích, nghề nghiệp** để gắn nhanh, tìm và lọc khách theo đặc điểm chung | Nên có |
| C12 | **Độ đầy đủ chân dung:** thanh % cho biết đã thu thập được bao nhiêu, và gợi ý các thông tin còn thiếu để hỏi khách ở lần chăm sóc tới | Nên có |
| C13 | **Nhắc chăm sóc theo dịp đặc biệt:** sinh nhật khách, ngày kỷ niệm thì thông báo cho những người đang chăm sóc | Nên có |
| C14 | **Xem và gọi SĐT:** mọi thành viên nhóm chăm sóc (cả phụ trách chính lẫn thành viên thường) được xem số đầy đủ và gọi; mỗi lần xem/gọi ghi nhật ký **PHONE_VIEWED** (ai, lúc nào, khách nào). Không có quy tắc che SĐT riêng cho thành viên | Phải có |

**Gợi ý các trường chân dung (C10)** **[Đề xuất, bạn chọn trường nào giữ]**

| Nhóm | Trường gợi ý |
|---|---|
| Cá nhân | Ngày sinh, giới tính, tình trạng hôn nhân, số con, nơi ở hiện tại, quê quán |
| Nghề nghiệp | Nghề nghiệp, nơi làm việc, chức vụ, ngành |
| Sở thích và lối sống | Sở thích, thể thao/giải trí, du lịch, ẩm thực, thú cưng, phong cách sống, tính cách và cách giao tiếp ưa thích |
| Dịp đặc biệt | Sinh nhật, ngày kỷ niệm, dịp quan trọng khác |
| Gia đình và quan hệ | Người ra quyết định mua (vợ/chồng, con...), người thân liên quan, người giới thiệu |
| Cách liên hệ | Kênh ưa thích (gọi, Zalo...), khung giờ thuận tiện, cách xưng hô |
| Nhu cầu BĐS (nhóm đầu tư, **giữ đủ các trường của prototype**) | Loại hình quan tâm, cơ cấu phòng, mục đích (ở / đầu tư / cho con), ngân sách (khoảng), vốn tự có, cần hỗ trợ vay, thời điểm dự kiến mua, tiêu chí ưu tiên, khu vực muốn mua, vị trí cụ thể |

Nhóm "Nhu cầu BĐS" nên lưu dạng trường có cấu trúc (danh sách chọn, khoảng số) để lọc và thống kê được, đồng thời liên kết với 4 tiêu chí Nhu cầu / Động cơ / Tài chính / Thời gian ở C4.

### 3.2 Dùng chung
| ID | Tính năng | Ưu tiên |
|---|---|---|
| X1 | Đăng nhập, phân quyền theo vai trò và theo khách được phân | Phải có |
| X2 | Chống trùng SĐT. Nếu khách đã có và do người khác phụ trách thì chỉ báo "đã có khách này, do [tên] chăm sóc" (không lộ chi tiết) và cho phép đề nghị được thêm vào nhóm chăm sóc **[Giả định]** | Phải có |
| X3 | Tìm kiếm (tên, SĐT, email), lọc, sắp xếp (theo tình trạng, nguồn khách, dự án, khu vực, người chăm sóc, tiến độ, ngày cập nhật, nghề nghiệp, sở thích/thẻ) | Phải có |
| X4 | Nhật ký thay đổi (ai, lúc nào, đổi gì), gồm mọi lần đổi tình trạng và đổi người chăm sóc | Phải có |
| X5 | **Đẩy thông báo trên điện thoại:** được phân khách mới, lịch hẹn đến hạn, có ghi chú mới từ người cùng chăm sóc, khách lâu chưa được chăm sóc — áp dụng cho cả hai tình trạng Chưa tiếp cận và Có quan tâm (người phụ trách chính nhận thông báo ưu tiên) | Phải có |
| X6 | Dashboard thống kê: khách theo tình trạng, nguồn khách, dự án, khu vực; tiến độ trung bình; khách theo người chăm sóc | Nên có |
| X7 | Quản lý danh mục: tình trạng, nguồn khách, khu vực, người dùng và **danh sách dự án** (để chọn khi nhập hồ sơ khách). **Quản trị tự thêm, sửa, xóa dự án**; dự án đang có khách quan tâm thì không xóa mà chuyển "ngừng hoạt động" (khách cũ vẫn giữ liên kết); dự án đã xóa mềm khôi phục được. Mã dự án bắt buộc (chữ, số, `-`, `_`, tối đa 20 ký tự); trạng thái dự án: sắp mở bán / đang bán / hết hàng; có khoảng giá | Phải có |
| X8 | Xuất Excel/CSV chứa **SĐT đầy đủ** (không chứa CCCD đầy đủ); chỉ Quản trị/Quản lý (trong phạm vi) xuất, mỗi lần xuất ghi nhật ký. Nhập/xuất Excel/CSV **chung** (người dùng tự ghép cột; chạy thử trước khi nhập thật). **Nhập dữ liệu cũ từ DSKH, DSKH_DROP, DSKH_NET: hoãn sang giai đoạn sau** (mục 3.5) | Phải có (phần chung) |
| X9 | **Ứng dụng di động cho cả iPhone và Android** (có đẩy thông báo) và bản web cho máy tính | Phải có |
| X10 | Quản trị **tự thêm, sửa, bớt trường chân dung** (kiểu chữ, danh sách chọn, ngày, chọn nhiều) mà không cần lập trình | Nên có |
| X11 | **Việc hôm nay** xem được ở dạng **Kanban** (3 cột Quá hạn / Hôm nay / Sắp tới) hoặc danh sách | Nên có |

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

### 3.5 Nhập dữ liệu từ 3 sheet cũ (DSKH, DSKH_DROP, DSKH_NET) **[Hoãn sang giai đoạn sau, quyết định D7]**

- Không nằm trong các milestone hiện tại. Khi làm cần **file mẫu thật** của từng sheet để chốt cột, định dạng ngày, cách ghi nhân viên chăm sóc.
- Giai đoạn hiện tại **vẫn có** nhập/xuất Excel/CSV chung (X8): chọn file, tự ghép cột, chạy thử, xác nhận. Không có mẫu cột dựng sẵn cho 3 sheet cũ.
- Khi làm giai đoạn sau chỉ cần thêm mẫu ghép cột hệ thống và trường truy vết dữ liệu cũ, không đổi cấu trúc đang có (tương thích ngược).

## 4. Quy tắc nghiệp vụ

1. Tiến độ khách = số tiêu chí hoàn thành / 4 (mỗi tiêu chí 25%).
2. Đổi tình trạng không làm mất dữ liệu, chỉ đổi danh sách hiển thị:
   - "Bỏ" đưa khách vào danh sách Bỏ.
   - "Khách net" đưa khách vào danh sách Khách net.
   - "Có quan tâm" đưa khách từ Bỏ hoặc Khách net trở lại danh sách Có quan tâm.
   - "Chưa tiếp cận" là danh sách riêng (tình trạng mặc định của khách mới); tab "Tất cả" hiển thị mọi khách thuộc phạm vi của người xem.
3. Khách phải có tên và SĐT mới được lưu. Email và CCCD không bắt buộc. Hệ thống không dùng mã khách hàng.
4. SĐT là duy nhất trong toàn hệ thống.
5. "Ngày cập nhật cuối" tự ghi khi sửa bất kỳ thông tin nào của khách; không do người dùng nhập tay.
6. **Quyền xem khách:** Quản trị xem tất cả; Quản lý xem khách của nhóm mình; nhân viên chỉ xem khách được phân cho mình **[Giả định]**.
7. **Nhiều người chăm sóc:** mọi người trong danh sách chăm sóc cùng xem, ghi chú và đổi tình trạng; mọi thay đổi ghi rõ người thực hiện.
   - Mỗi khách có **đúng một người phụ trách chính**; hệ thống yêu cầu chọn khi phân khách lần đầu.
   - Người phụ trách chính là đầu mối: nhận thông báo ưu tiên (khách lâu chưa chăm sóc, lịch hẹn) và được thống kê riêng trong báo cáo **[Giả định]**.
   - Quản lý/Quản trị đổi được người phụ trách chính; khi người phụ trách chính bị gỡ khỏi khách thì phải chọn người thay thế **[Giả định]**.
8. Khi được thêm vào chăm sóc một khách, người đó nhận thông báo đẩy; khi bị gỡ, không còn thấy khách đó.
   - **SĐT:** mọi người trong nhóm chăm sóc (kể cả thành viên thường) được xem số đầy đủ và gọi; mỗi lần xem/gọi ghi nhật ký `PHONE_VIEWED`. Người ngoài nhóm không thấy khách nên không thấy SĐT (ngoại lệ: kiểm tra trùng SĐT chỉ báo tên người phụ trách, X2).
9. **Thông tin chân dung:**
   - Mọi trường đều không bắt buộc, nhân viên điền dần qua các lần chăm sóc.
   - Mỗi thông tin ghi rõ người cập nhật, ngày cập nhật và nguồn (khách tự chia sẻ / nhân viên quan sát).
   - Không ghi các nội dung nhạy cảm (tôn giáo, chính trị, sức khỏe, đời sống riêng tư), trừ khi khách tự chia sẻ và thật sự cần cho việc chăm sóc.
   - Chỉ những người đang chăm sóc khách (và Quản lý, Quản trị) mới xem được chân dung.
10. **Ghi âm (giai đoạn sau):** chỉ ghi âm khi khách đã đồng ý; văn bản chuyển từ cuộc gọi là dữ liệu cá nhân, áp dụng cùng quy tắc phân quyền như chân dung; không đưa CCCD hoặc thông tin nhạy cảm sang dịch vụ phân tích bên ngoài khi chưa được phép.
11. **Dự án:** chỉ Quản trị thêm/sửa/xóa. Dự án đang có khách quan tâm không xóa được, chỉ chuyển "ngừng hoạt động" (ẩn khỏi ô chọn mới, khách cũ vẫn giữ liên kết, hiển thị "đã ngừng"). Dự án chưa có khách thì xóa mềm được và khôi phục được.
12. **Ảnh đính kèm:** chỉ gắn vào ghi chú chăm sóc; ai xem được ghi chú thì xem được ảnh; ảnh được bỏ dữ liệu vị trí (GPS) khi lưu.

## 5. Yêu cầu chung

- **Tiếng Việt:** lưu và tìm kiếm đúng chữ có dấu; múi giờ Việt Nam (GMT+7).
- **Bảo mật dữ liệu cá nhân:** SĐT, email và đặc biệt CCCD là dữ liệu nhạy cảm. Chỉ thu thập CCCD khi thật cần, phân quyền chặt, che số CCCD khi hiển thị; mọi lần xem/gọi SĐT đều có nhật ký; sao lưu định kỳ và nên tham khảo quy định bảo vệ dữ liệu cá nhân hiện hành.
- **Dữ liệu chân dung:** thu thập nhiều thông tin cá nhân hơn đồng nghĩa trách nhiệm bảo vệ lớn hơn. Chỉ thu thập thông tin phục vụ việc chăm sóc, thông báo cho khách và xin đồng ý khi cần, và phải có cách sửa hoặc xóa thông tin khi khách yêu cầu.
- **Thông báo:** đẩy được trên cả iPhone và Android; người dùng tự bật/tắt từng loại thông báo.
- **Tốc độ:** danh sách vài nghìn khách vẫn mở nhanh.
- **Dễ chuyển đổi:** nhập được từ file Excel/CSV chung và có chế độ xem dạng bảng quen thuộc. Nhập riêng từ ba sheet hiện có làm ở giai đoạn sau (mục 3.5).

## 6. Các quyết định đã chốt

| Nội dung | Quyết định |
|---|---|
| CCCD | Tùy chọn, không bắt buộc |
| Nhiều người chăm sóc | Có **người phụ trách chính** cho mỗi khách |
| Dự án quan tâm | Chọn từ danh sách dự án có sẵn; một khách chọn được nhiều dự án |
| Khu vực | Là nơi khách đang ở |
| Ứng dụng di động | Cần cho cả iPhone và Android |
| Ghi âm cuộc gọi (AudioProtect) | Đưa vào kế hoạch, **triển khai ở giai đoạn sau** (mục 3.4) |
| Email khách | Giữ, không bắt buộc |
| Mã khách hàng | **Bỏ** (không có trong hồ sơ, API, nhập/xuất, chỉ mục) |
| Tab "Tất cả" và Kanban | Giữ tab "Tất cả"; giữ chế độ Kanban của Việc hôm nay |
| Ảnh đính kèm | Giữ, gắn vào ghi chú chăm sóc |
| Loại lịch hẹn "Ký cọc / HĐMB" | Giữ |
| Nhóm trường nhu cầu BĐS / đầu tư | Giữ đủ các trường của prototype |
| Màn Dự án | Giữ; Quản trị thêm/sửa/xóa mềm/ngừng hoạt động/khôi phục; mã dự án bắt buộc; trạng thái là danh sách cố định |
| Tab mặc định của danh sách khách | "Tất cả" |
| SĐT trong file xuất | Đầy đủ (không có CCCD đầy đủ); kiểm quyền và ghi nhật ký mỗi lần xuất |
| Lịch sử thay đổi | Hiển thị SĐT cũ → mới đầy đủ cho người xem được khách |
| Kanban theo tình trạng ở danh sách khách | Chưa làm, để ý tưởng giai đoạn sau |
| Nhóm gộp "Đang chăm sóc" | **Bỏ**, tách thành 2 tình trạng/tab riêng: "Chưa tiếp cận" và "Có quan tâm" |
| SĐT với thành viên nhóm | Cho xem và gọi; ghi nhật ký `PHONE_VIEWED` |
| Nhập dữ liệu 3 sheet cũ | **Hoãn sang giai đoạn sau**, cần file mẫu thật |

## 7. Câu hỏi cần xác nhận

1. Có khoảng bao nhiêu người dùng, và có những vai trò nào ngoài mục 2?
2. (Đã chốt: Chưa tiếp cận và Có quan tâm là hai danh sách riêng.) Cột Tình trạng còn giá trị nào ngoài "Chưa tiếp cận", "Có quan tâm", "Khách net", "Bỏ"?
3. **Người phụ trách chính** khác gì so với người cùng chăm sóc (ví dụ chỉ người này được thêm/bớt người, hay đổi tình trạng)? Ai được đổi người phụ trách chính?
4. ~~Danh sách dự án do ai quản lý?~~ **Đã chốt:** Quản trị thêm/sửa/xóa. Còn lại: mỗi dự án cần lưu thông tin gì ngoài bộ trường tối thiểu (chủ đầu tư, vị trí, loại hình, khoảng giá, trạng thái)?
5. **Khu vực nơi khách ở** dùng danh sách nào: quận/huyện Hà Nội, các tỉnh/thành khác, cả nước ngoài (có khách Việt kiều)?
6. Có làm các tính năng Zalo ở mục 3.3 không, và làm mục nào?
7. **Chân dung khách:** trong bảng gợi ý ở mục 3.1, bạn muốn giữ nhóm trường nào, thêm trường nào? Muốn Quản trị tự thêm/bớt trường (X10) hay cố định từ đầu?
8. Có cần ghi nhận **khách đồng ý** cho phép lưu thông tin cá nhân không (ví dụ một ô xác nhận trong hồ sơ)?
9. **Ghi âm (giai đoạn sau):** lưu file âm thanh bao lâu và lưu văn bản bao lâu? Ai được phép nghe lại?
10. Có cần ghi âm **buổi gặp/xem nhà trực tiếp** (R10), hay chỉ ghi âm cuộc gọi?
