# Kế hoạch kiểm thử giao diện tự động (E2E) - Module CRM

> Trạng thái: **Kế hoạch, chưa viết spec.** Sơ đồ vẽ bằng Giotto: [`diagrams/crm-e2e-flows.svg`](diagrams/crm-e2e-flows.svg) (các luồng) và [`diagrams/crm-e2e-rig.svg`](diagrams/crm-e2e-rig.svg) (bộ máy chạy). Bản có hoạt cảnh xem ở canvas Giotto `http://localhost:4321` (file gốc `~/.giotto/crm-e2e-*.json`).

## 1. Mục tiêu

Chứng minh Web Admin và backend nối với nhau đúng khi chạy trên **trình duyệt thật**, và **tìm chỗ còn thiếu** giữa giao diện, API và tài liệu. Không thay thế test hiện có (backend 1266, frontend 485); chỉ bù phần chúng không chạm tới: hợp đồng API giữa hai phía, guard route, cache sau đăng xuất, luồng nhiều màn hình, file thật lên MinIO.

### 1.1. Tiêu chí UI/UX (áp dụng cho mọi luồng ở mục 3)

Test không chỉ hỏi "gọi API được không" mà phải đóng vai người dùng, trả lời: đủ chức năng chưa, đúng chưa, thân thiện chưa. Mỗi luồng kiểm thêm:

| Tiêu chí | Câu hỏi | Ví dụ lỗi đã gặp (2026-10-25) |
|---|---|---|
| Đủ chức năng | Mọi việc API cho phép đều có nút/trường đúng chỗ trên màn hình? Cờ tính năng nào đang che? | Form nhật ký không có nút tải ảnh (ẩn sau `VITE_FEATURE_CRM_ATTACHMENTS`) |
| Giữ ngữ cảnh | Từ bản ghi A sang màn tạo/sửa liên quan, A có được điền sẵn? | "Đặt lịch hẹn" ở chi tiết khách không mang khách sang, phải chọn lại (`CustomerHeader.tsx:94` gọi `navigate('create_appointment')` không truyền khách) |
| Điều hướng sau thao tác | Lưu/hủy xong quay về nơi bắt đầu? | Lưu lịch hẹn xong nhảy sang màn Lịch hẹn thay vì về chi tiết khách (`useCreateAppointmentForm.ts:104`) |
| Phản hồi | Có trạng thái đang tải, thông báo thành công/lỗi dễ hiểu, lỗi hiện cạnh trường, không mất dữ liệu đã nhập khi lỗi? | - |
| Ít thao tác thừa | Số click/lần gõ của luồng chính; chỗ nào phải làm lại việc đã làm? | Chọn lại khách (trên) |
| Trạng thái rỗng và biên | Danh sách rỗng, khách chưa có đội, bị chặn quyền: có hướng dẫn thay vì màn trắng? | - |

Báo cáo ở mục 6 chia 3 nhóm: **Thiếu chức năng**, **Sai hành vi**, **Chưa thân thiện**; mỗi mục kèm file nguyên nhân nếu xác định được. Ba lỗi mẫu ở bảng trên cũng là 3 ca test đầu tiên phải đỏ rồi xanh sau khi sửa (F3, F4).

## 2. Công cụ và bộ máy chạy

- **Playwright** (chỉ Chromium), đặt trong `RealEstateAdminApp/e2e/`, lệnh `npm run test:e2e`. Repo chưa có công cụ E2E nào.
- **Stack test riêng, không đụng stack dev:**

| Thành phần | Dev (giữ nguyên) | E2E |
|---|---|---|
| Backend | 3000 | **3100** (đặt `FRONTEND_URL=http://localhost:5183` để CORS khớp) |
| Admin App | 5173 | **5183**, bật `VITE_FEATURE_CRM_ATTACHMENTS=true` |
| MongoDB | container `mongodb`, DB `mongodb` | **mongodb-memory-server (replica set)**, dựng ở `globalSetup`, xóa khi xong; không ghi vào DB `mongodb` |
| Redis | db 0 | **db 15**, xóa sạch trước mỗi lần chạy |
| MinIO | `crm-attachments`, `crm-exports` | bucket **`e2e-crm-attachments`, `e2e-crm-exports`**, xóa sạch trước mỗi lần chạy |

- **Dữ liệu mồi** (`globalSetup`): 1 Admin, 1 Quản lý, 2 Staff ở hai đội khác nhau, danh mục (trạng thái, nguồn, khu vực, dự án). Mật khẩu test sinh ngẫu nhiên mỗi lần chạy, không ghi vào file.
- Mỗi spec tự tạo khách riêng (tên có hậu tố ngẫu nhiên), không phụ thuộc thứ tự chạy.
- Selector ưu tiên `getByRole`/`getByLabel`; chỉ thêm `data-testid` ở chỗ không có nhãn truy cập được.
- Chụp ảnh và trace khi lỗi; không quay video.

## 3. Danh sách luồng (tránh thừa: 7 spec, mỗi spec 2 - 5 ca)

| # | Luồng | Ưu tiên | Kiểm tra chính | Đối chiếu ngoài UI |
|---|---|---|---|---|
| F1 | Đăng nhập và phân quyền | P0 | Staff / Quản lý / Admin vào đúng màn; sai mật khẩu báo lỗi; Staff không thấy mục của Admin; đăng xuất xóa cache | - |
| F2 | Khách hàng | P0 | Danh sách, SĐT bị che; thêm khách; trùng SĐT báo lỗi; tìm kiếm và lọc; sửa ở 2 tab thì báo xung đột 409 | Mongo: bản ghi, `__v` |
| F3 | Nhật ký chăm sóc và ảnh | P0 | Ghi nhật ký hiện ngay; **bấm nút tải ảnh**, ảnh hiện lại (URL ký sẵn); gỡ ảnh | Mongo `crm_attachments`; MinIO có đúng `fileKey`, gỡ xong thì đánh dấu đã gỡ |
| F4 | Lịch hẹn và nhắc việc | P0 | Đặt lịch từ trang khách; hiện trên màn Lịch hẹn; chuông thông báo tăng số; đổi giờ, hủy lịch | Mongo `appointments`, `reminders` |
| F5 | Chân dung và thẻ | P1 | Điền chân dung, độ đầy đủ tăng; gắn, gỡ thẻ; lọc theo thẻ | Mongo |
| F6 | Đội và quyền xem khách | P0 (bảo mật) | Staff đội khác không thấy khách; gõ thẳng URL bị chặn; xin vào nhóm chăm sóc, Quản lý duyệt thì Staff thấy khách | Mongo `care_team_requests` |
| F7 | Màn còn dữ liệu mẫu và rà thiếu | P1 | Báo cáo, Nhập/Xuất (M8) khi cờ tắt phải ẩn hoặc báo "sắp ra mắt"; lập danh sách nút/trường UI còn thiếu so với API | - |

Luồng nối nhau theo ca dùng thật: F1 → F2 → F3 → F4, và F2 → F6 (hai tài khoản).

## 4. Chỗ thiếu đã thấy trước khi viết test

| # | Phát hiện | Mức | Hướng xử lý |
|---|---|---|---|
| G1 | **Không thấy nút tải ảnh.** Nút có sẵn trong `CareLogForm.tsx` nhưng bị ẩn khi `VITE_FEATURE_CRM_ATTACHMENTS` chưa bật. `.env` của Admin App chỉ có `VITE_API_URL`, không có `.env.example` nên không ai biết có cờ này; backend cũng cần `FEATURE_CRM_ATTACHMENTS=true` | Cao | Thêm `.env.example` cho Admin App liệt kê mọi cờ `VITE_*`; ghi cặp cờ FE/BE vào README; spec F3 chạy với cờ bật |
| G2 | Backend chỉ cho CORS một origin (`FRONTEND_URL`, mặc định `:5173`); `launch.json` từng chạy cổng 5175 nên đăng nhập bị chặn âm thầm | Thấp | Đã sửa `launch.json` về 5173. E2E đặt `FRONTEND_URL` riêng |
| G3 | Integration test backend ghi vào Redis dev và không dọn: còn 181 khóa `it-*` | Thấp | Giao coder-backend dọn khóa sau test (hoặc dùng db riêng cho test) |
| G4 | Chưa có endpoint hoàn thành nhắc FOLLOW_UP; CORS thiếu `exposedHeaders` (`X-Request-ID`, `Retry-After`); UI bỏ một số trường backend chưa có; SĐT chưa hiện ở lịch hẹn và việc hôm nay | Trung bình | Đã ghi ở backlog M6; F7 xác nhận lại bằng thao tác thật |
| G5 | **Đặt lịch hẹn từ chi tiết khách không mang khách sang** màn tạo lịch; người dùng phải bấm "Chọn khách" lại | Cao (UX) | `CustomerHeader.tsx:94` truyền mã khách (query hoặc state); form đọc và điền sẵn; khóa trường khách khi đi từ chi tiết khách (quyết định của Oniichan 2026-10-25) |
| G6 | **Lưu lịch hẹn xong luôn chuyển sang màn Lịch hẹn**, dù người dùng đang ở chi tiết một khách | Cao (UX) | `useCreateAppointmentForm.ts:104`: nếu mở từ chi tiết khách thì quay về chi tiết khách đó (và nút Hủy bỏ cũng vậy) |
| G7 | **Lịch hẹn không có ô chọn dự án.** Lịch "Xem nhà / sa bàn" không ghi được xem dự án nào. Schema `Appointment` (backend) không có `projectId`, form tạo lịch (frontend) cũng không có; màn Việc hôm nay chỉ suy dự án từ sở thích của khách. Tài liệu 01 (C3) chỉ nêu loại lịch hẹn, chưa nêu dự án | Trung bình (thiếu tính năng, chờ Oniichan chốt). **Backend xong (2026-10-25)**: `projectId` ở schema/DTO/response/lọc/`nextAction.appointment`, việc hôm nay có field `project` riêng ở cấp task (`customer.projects` giữ nguyên là dự án khách quan tâm); **frontend xong (2026-10-25, chờ QA)**: ô "Dự án" trong form tạo lịch (gợi ý khi khách quan tâm đúng một dự án, `?projectId=` từ nút "Đặt lịch xem" ở màn Dự án), hiện dự án trên thẻ lịch hẹn desktop và mobile | Thêm `projectId` tùy chọn vào lịch hẹn (schema, DTO kiểm dự án tồn tại, response), ô chọn dự án trong form (gợi ý từ dự án khách quan tâm; nút "Đặt lịch xem" ở màn Dự án mang sẵn dự án sang), hiện dự án trên danh sách lịch hẹn và việc hôm nay |

**Trạng thái (2026-10-25):** G1, G5, G6 **đã sửa và qua QA 2 vòng** (chưa commit): có `.env.example` cho Admin App, khung "Thêm ảnh" rõ ràng kèm lỗi dễ hiểu, đặt lịch từ chi tiết khách mang khách sang (`?customerId=`), lưu/hủy về chi tiết khách, cuộn về đầu khi đổi màn. G2 đã sửa (`launch.json`). G3, G4 chưa làm; G7 backend xong, **frontend xong, chờ QA** (việc hôm nay dùng `task.project` riêng, đã dọn 3 mục nhỏ). Nút "Đặt lịch xem" trên thẻ dự án (`bookVisit`) nay mang sẵn dự án sang form (`?projectId=`); nút chung ở đầu trang Dự án vẫn mở form trống.

Danh sách này sẽ dài thêm khi chạy F2 - F7; kết quả cuối ghi vào mục 6.

## 5. Các bước thực hiện

| Bước | Việc | Giao ai | Xong khi |
|---|---|---|---|
| 0 | Chốt kế hoạch này, bật cờ ảnh ở dev (G1) | Neptune, devops | Oniichan duyệt |
| 1 | Dựng bộ máy: Playwright, `globalSetup`/`globalTeardown`, dữ liệu mồi, script khởi động stack ở cổng 3100/5183/db 15/bucket `e2e-*` | devops-agent + coder-backend | `npm run test:e2e` chạy được 1 spec rỗng, dọn sạch sau khi xong |
| 2 | F1, F2, F3 (kèm sửa G1) | qa-agent viết spec; coder-frontend thêm `data-testid` khi cần | 3 spec xanh, lặp lại 3 lần không chập chờn |
| 3 | F4, F6 | qa-agent | 2 spec xanh |
| 4 | F5, F7, tổng hợp chỗ thiếu | qa-agent | Báo cáo mục 6 |
| 5 | Đưa vào CI (chạy trước khi deploy); gộp với mục "smoke E2E" của M10 | devops-agent | CI chạy được |

Mỗi bước kết thúc bằng qa-agent soi lại cả code lẫn test (bắt test tautology, chập chờn, selector mỏng manh).

## 6. Kết quả rà soát chỗ thiếu

_Chưa có. Điền sau bước 4._
