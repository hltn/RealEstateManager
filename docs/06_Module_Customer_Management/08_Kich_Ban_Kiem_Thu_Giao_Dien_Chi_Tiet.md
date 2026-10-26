# Kịch bản kiểm thử giao diện chi tiết - Module CRM

> Trạng thái (2026-10-26): **Đã có spec chạy thật** (`RealEstateAdminApp/e2e/specs/`, kết quả ở mục 7.3 và 8). Bổ sung cho [`07_Ke_Hoach_Kiem_Thu_Giao_Dien_Tu_Dong.md`](07_Ke_Hoach_Kiem_Thu_Giao_Dien_Tu_Dong.md) (kế hoạch, tiêu chí UX mục 1.1, bảng gap G1-G7, luồng F1-F7). Nhãn nút, đường dẫn, thông báo dưới đây lấy từ code ở `RealEstateAdminApp/src/modules/crm/` (đối chiếu 2026-10-25). Chỗ code chưa rõ ghi **[Chưa rõ]**, tổng hợp ở mục 7.

## 1. Quy ước chung

### 1.1. Tài khoản test (chỉ dùng cho stack E2E cô lập, cổng 3100/5183)

| Mã | Email | Vai trò | Đội | Dùng cho |
|---|---|---|---|---|
| `staff1` | `staff1.e2e@example.test` | Nhân viên (STAFF) | Đội 1 | Người thao tác chính ở F2-F5 |
| `staff2` | `staff2.e2e@example.test` | Nhân viên (STAFF) | Đội 2 | Người "ngoài phạm vi" ở F6 |
| `mgr1` | `mgr1.e2e@example.test` | Quản lý (MANAGER) | Quản lý đội 1 | Duyệt đề nghị vào nhóm (F6), đối chiếu menu (F1) |
| `admin` | `admin.e2e@example.test` (backend tự seed lúc khởi động từ `ADMIN_EMAIL`/`ADMIN_PASSWORD` của stack E2E) | Quản trị (ADMIN) | - | Menu đầy đủ (F1), rà thiếu (F7) |

- Mật khẩu chung `Test@12345678` **chỉ** hợp lệ ở stack E2E (DB trong bộ nhớ, Redis db 15). Cấm dùng ở dev/staging/production, cấm ghi vào file cấu hình dev. (Mục 2 của tài liệu 07 từng ghi "mật khẩu sinh ngẫu nhiên"; thống nhất theo yêu cầu mới: mật khẩu cố định nhưng chỉ ở stack cô lập.)
- Đăng nhập nhanh: fixture `loginAs(role)` trả về trang đã đăng nhập, KHÔNG dùng `storageState`: `globalSetup` ký sẵn JWT truy cập (8 giờ, secret E2E) cho 4 vai trò và fixture trả token đó khi app gọi `POST /auth/refresh` lúc khởi động (refresh token xoay vòng 1 lần dùng nên 1 file cookie dùng chung cho nhiều test sẽ bị thu hồi phiên; `/auth/login` thật còn bị throttle). Hệ quả: luồng refresh thật chỉ được phủ ở F1 (đăng nhập thật bằng form, trang `page` thường), không phủ ở các spec dùng `loginAs`.

### 1.2. Dữ liệu seed có sẵn trước mỗi spec (do `globalSetup`)

| Nhóm | Nội dung tối thiểu |
|---|---|
| Người dùng | 4 tài khoản ở 1.1; `staff1` và `mgr1` cùng Đội 1, `staff2` ở Đội 2 |
| Danh mục | Trạng thái khách (có "Mới"), nguồn, khu vực, kết quả liên hệ (có "Hẹn xem sa bàn / nhà mẫu") và bộ dự án mẫu của CRM do backend seed; thêm 2 dự án `E2E-ACTIVE` (hoạt động) và `E2E-OFF` (ngừng). Các dự án A, B, C, D trong kịch bản do **từng spec tự tạo** bằng `api.createProject` (D tạo xong rồi `setProjectActive(false)`) để không ảnh hưởng spec khác |
| Khách mồi | `Khách-Mẫu-<hậu tố>`: **mỗi spec tự tạo bằng API trước khi chạy** (qua fixture, không bấm UI để dựng), thuộc nhóm chăm sóc của `staff1`, quan tâm đúng 1 dự án (A). Thêm khách thứ hai quan tâm 2 dự án (A, B) cho ca "không gợi ý" |
| Ảnh mẫu | Không có file trong repo: ảnh JPEG hợp lệ (< 1 MB) do chính trình duyệt vẽ bằng canvas (`makeJpeg` trong `e2e/lib/ui.ts`); "ảnh quá lớn" (PNG > 5 MB) và "tài liệu sai loại" (PDF) là buffer dựng trong code (`bigPng`, `pdfFile`), FE chặn trước khi tải lên nên không tới máy chủ |

Quy tắc dữ liệu: tên/SĐT khách có hậu tố ngẫu nhiên; SĐT sinh theo định dạng VN hợp lệ và duy nhất mỗi spec (trừ ca cố tình trùng).

### 1.3. Cờ tính năng của stack E2E

| Cờ | Giá trị | Lý do |
|---|---|---|
| Backend `FEATURE_CRM_ATTACHMENTS` | `true` | Nếu tắt, API tải ảnh trả 404 |
| Frontend `VITE_FEATURE_CRM_ATTACHMENTS` | `true` | Nếu tắt, khung "Ảnh đính kèm" / nút "Thêm ảnh" **không hiện** (nguyên nhân G1). Spec F3 phải khẳng định cờ đang bật trước khi kết luận "thiếu nút" |
| Backend `FRONTEND_URL` | `http://localhost:5183` | CORS khớp |
| `VITE_CRM_MOCK_REPORTS`, `VITE_CRM_MOCK_IMPORT_EXPORT` | `false` | Vite dev mặc định BẬT dữ liệu mẫu (`featureFlags.ts`); E2E mô phỏng production nên tắt để F7 thấy "sắp ra mắt" / nút nhập-xuất bị ẩn. Đã xác nhận: `smoke.spec.ts` đọc cờ thật từ Vite và F7-01 kiểm giao diện thật |
| `VITE_CRM_FEATURE_ZALO_ZNS`, `..._IN_APP_CALL`, `..._APPOINTMENT_SYNC` | không đặt (tắt) | Ca F4 khẳng định công tắc SMS/ZNS và đồng bộ lịch **không** hiện khi cờ tắt |

### 1.4. Quy tắc selector

1. Ưu tiên `getByRole(role, { name })` và `getByLabel` với **nhãn tiếng Việt đúng như bảng ở từng kịch bản** (ví dụ `getByRole('button', { name: 'Lưu nhật ký' })`).
2. Chỉ dùng `data-testid` khi không có nhãn truy cập được (vùng ảnh đã tải, thẻ lịch hẹn trong danh sách). Mỗi lần thêm testid phải ghi vào mục 7 để coder-frontend biết.
3. Cấm selector theo class Tailwind, thứ tự phần tử (`nth`) khi có nhãn thay thế, và `waitForTimeout` cố định; chờ theo `expect(...).toBeVisible()` / `toHaveURL`.
4. Nút chỉ có biểu tượng đã có `aria-label`: "Ghi chú nhanh", "Đặt lịch hẹn" (ở đầu trang chi tiết khách desktop); trên mobile nút tương ứng hiện chữ "Ghi chú", "Hẹn nhắc".
5. Chạy Chromium hai viewport: **desktop 1440x900** (mặc định) và **mobile 390x844** chỉ cho các ca được đánh dấu `[+mobile]`.

### 1.5. Quy tắc độc lập giữa spec

- Mỗi spec tự dựng dữ liệu bằng API (không dựa kết quả spec khác, không phụ thuộc thứ tự); xóa/đánh dấu xóa dữ liệu đã tạo ở `afterAll` nếu spec đổi danh mục dùng chung (ví dụ ngừng hoạt động một dự án phải khôi phục hoặc dùng dự án riêng của spec).
- Spec F6 dùng hai browser context riêng cho `staff1` và `staff2`; không đăng nhập đổi tài khoản trong cùng context.
- `workers: 1`, chạy tuần tự trên một stack dùng chung (login bị throttle, một Mongo/Redis/MinIO tạm). Độ ổn định đo bằng việc chạy lại TOÀN BỘ bộ nhiều lần liên tiếp (kết quả ở mục 8), không lặp từng spec.
- Đối chiếu hậu trường chỉ **đọc** Mongo/Redis/MinIO (qua fixture `backstage`, file `e2e/lib/backstage.ts`), không sửa dữ liệu để "ép" test xanh.

### 1.6. Cách ghi mỗi kịch bản

Mỗi kịch bản gồm: **Mục tiêu**, **Tiền điều kiện**, **Bước**, **Kết quả trên giao diện**, **Hậu trường** (nếu có), **Tiêu chí UX kiểm kèm** theo 6 chữ viết tắt: **CN** đủ chức năng, **NC** giữ ngữ cảnh, **ĐH** điều hướng sau thao tác, **PH** phản hồi, **TT** ít thao tác thừa, **RG** trạng thái rỗng/biên. Cột "Hồi quy" ghi G1, G2... khi kịch bản khóa một lỗi đã sửa (phải xanh sau sửa; nếu đỏ là hồi quy).

---

## 2. F1 - Đăng nhập và phân quyền (spec `f1-auth.spec.ts`)

Màn đăng nhập: `LoginScreen` (nhãn "Email", ô mật khẩu có nút "Hiện mật khẩu"/"Ẩn mật khẩu", nút "Đăng nhập", đang gửi hiện "Đang đăng nhập..."). Sau đăng nhập code chuyển về `/` (không phải `/crm/today`), **[Chưa rõ]** trang `/` hiển thị gì cho từng vai trò; menu CRM ở sidebar mục "Quản lý khách hàng".

### F1-01 Đăng nhập đúng và menu theo vai trò (P0)
- **Mục tiêu:** ba vai trò vào được CRM và chỉ thấy mục đúng quyền (`navigation.ts`: Báo cáo cho Quản lý/Quản trị; Dự án, Cài đặt theo `canViewProjectCatalog`/`canViewSettings`).
- **Tiền điều kiện:** chưa đăng nhập, 4 tài khoản đã seed.
- **Bước (lặp cho `staff1`, `mgr1`, `admin`):** mở `/login` (đường dẫn thực tế **[Chưa rõ]**) -> gõ Email -> gõ mật khẩu -> bấm "Đăng nhập" -> mở menu "Quản lý khách hàng" -> bấm "Việc hôm nay".
- **Kết quả:** vào được `/crm/today`, tiêu đề "Việc hôm nay". `staff1` thấy: Việc hôm nay, Khách hàng, Lịch hẹn & Nhắc việc, **không** có Báo cáo & Thống kê, Danh sách dự án, Cài đặt CRM. `mgr1` có thêm Báo cáo; `admin` thấy đủ (Báo cáo, Danh sách dự án, Cài đặt CRM). Menu mobile (390px) cũng theo quy tắc này.
- **Hậu trường:** Redis db 15 có phiên/refresh token của người dùng; không có khóa `it-*`.
- **UX kiểm kèm:** CN (mục đúng quyền), ĐH (sau đăng nhập đến màn dùng được, không màn trắng), PH (nút "Đang đăng nhập..." khi chờ). `[+mobile]` cho bottom nav.

### F1-02 Đăng nhập sai (P0)
- **Mục tiêu:** sai mật khẩu và email không tồn tại báo lỗi dễ hiểu, không lộ email nào đúng.
- **Bước:** `staff1@example.com` + mật khẩu sai -> "Đăng nhập"; sau đó email lạ + mật khẩu bất kỳ -> "Đăng nhập"; sau đó để trống cả hai và bấm "Đăng nhập".
- **Kết quả:** vẫn ở màn đăng nhập; thông báo tiếng Việt (lấy từ máy chủ, mặc định "Đăng nhập thất bại, vui lòng thử lại"); hai ca đầu **cùng một nội dung thông báo**; email đã gõ còn nguyên, ô mật khẩu không bị lộ; ca trống báo cạnh trường (nếu có kiểm tra phía FE, **[Chưa rõ]**).
- **Hậu trường:** không có phiên mới trong Redis.
- **UX kiểm kèm:** PH (không mất email đã nhập), RG (ô trống).

### F1-03 Chặn truy cập trực tiếp bằng URL theo vai trò (P0, bảo mật)
- **Mục tiêu:** ẩn menu chưa đủ, gõ URL cũng phải bị chặn.
- **Bước:** đăng nhập `staff1` -> gõ lần lượt `/crm/reports`, `/crm/projects`, `/crm/settings` vào thanh địa chỉ.
- **Kết quả:** mỗi lần được chuyển về màn được phép hoặc thấy thông báo "Bạn không có quyền thực hiện thao tác này."; **không** thấy nội dung Báo cáo/Dự án/Cài đặt thoáng qua. Hành vi chặn thực tế (đã xác định, 2026-10-26): chuyển hướng về `/crm/today` kèm toast "Bạn không có quyền vào trang này." (`RedirectWithNotice`); sai khi hiện nội dung hoặc màn trắng. Cùng bước với chưa đăng nhập: bị đưa về màn đăng nhập.
- **UX kiểm kèm:** RG (có hướng dẫn thay vì trắng), ĐH.

### F1-04 Đăng xuất xóa sạch dữ liệu phiên (P0)
- **Mục tiêu:** sau khi `staff1` đăng xuất, người dùng tiếp theo không thấy dữ liệu của `staff1` (cache React Query, localStorage).
- **Bước:** `staff1` mở chi tiết một khách -> mở menu người dùng ở góc trên -> "Đăng xuất" (nhãn thực tế trong `UserDropdown.tsx`, **[Chưa rõ]**) -> đăng nhập `staff2` -> mở `/crm/customers` -> bấm nút Quay lại của trình duyệt.
- **Kết quả:** `staff2` không thấy khách của `staff1` ở danh sách; Quay lại không hiện lại hồ sơ khách của `staff1` (đưa về đăng nhập hoặc "Không tìm thấy"); localStorage không còn khóa dữ liệu CRM của `staff1`.
- **Hậu trường:** refresh token cũ bị thu hồi (Redis).
- **UX kiểm kèm:** ĐH, RG.

---

## 3. F2 - Khách hàng (spec `f2-customers.spec.ts`)

Màn: `/crm/customers` (tiêu đề "Khách hàng", ô tìm "Tên (có/không dấu), SĐT, email...", bộ lọc "Dự án", "Khu vực", "Người chăm sóc"); `/crm/customers/new` (tiêu đề "Thêm khách hàng mới", nút "Lưu khách hàng"). Trường: "Họ và tên khách hàng", "Số điện thoại", "Email", "Số CCCD", "Khu vực (nơi khách đang ở)", "Nguồn khách", "Người phụ trách chính".

### F2-01 Danh sách, SĐT che và "Hiện số" (P0)
- **Mục tiêu:** SĐT mặc định bị che, chỉ lộ khi người xem được phép bấm; mỗi lần lộ có ghi log.
- **Tiền điều kiện:** `staff1` đăng nhập; có ≥ 3 khách của đội 1.
- **Bước:** mở `/crm/customers` -> quan sát hàng khách -> bấm tên một khách vào chi tiết -> ở thẻ đầu trang bấm "Hiện số" -> bấm "Ẩn số".
- **Kết quả:** danh sách không có SĐT đầy đủ (chỉ dạng che `phoneMasked`); chi tiết hiện SĐT che; "Hiện số" hiện số đầy đủ định dạng `0912 345 678`, nút đổi thành "Ẩn số"; "Ẩn số" che lại.
- **Hậu trường:** Mongo có bản ghi lịch sử `PHONE_VIEWED` đúng 1 lần cho mỗi lần "Hiện số"; response danh sách (bắt bằng `page.waitForResponse`) không chứa SĐT đầy đủ.
- **UX kiểm kèm:** CN, PH. `[+mobile]` (thẻ khách `CustomerCard`).

### F2-02 Thêm khách thành công (P0)
- **Mục tiêu:** tạo khách qua form và thấy khách đó ngay.
- **Bước:** ở `/crm/customers` bấm nút thêm khách (nhãn thực tế ở `CustomerToolbar`/header, **[Chưa rõ]**) -> gõ "Họ và tên khách hàng" -> gõ "Số điện thoại" (SĐT mới) -> chọn "Nguồn khách" -> chọn "Khu vực" -> bấm "Lưu khách hàng".
- **Kết quả:** có thông báo thành công; chuyển sang **chi tiết khách vừa tạo** (`useCreateCustomerForm.ts:94` dùng `selectCustomer(..., replace)`), tên đúng, người phụ trách chính hiển thị đúng ("Phụ trách chính: <staff1>"); nút Quay lại của trình duyệt **không** quay về form đã lưu. Bấm "Hủy" ở form (ca phụ) quay về nơi mở form.
- **Hậu trường:** `customers` có 1 bản ghi, `__v` = 0 (hoặc giá trị khởi tạo theo schema), `careTeam` chứa staff1, SĐT lưu dạng chuẩn hóa.
- **UX kiểm kèm:** ĐH, NC (người phụ trách mặc định = người tạo, không phải chọn lại), PH, TT (đếm số lần gõ/click, ghi vào báo cáo).

### F2-03 Trùng SĐT (P0)
- **Mục tiêu:** nhập SĐT đã có thì báo ngay, không lộ dữ liệu khách ngoài phạm vi.
- **Tiền điều kiện:** khách X (SĐT 0912...) thuộc đội 1; khách Y thuộc đội 2 (staff1 không xem được).
- **Bước (A, staff1):** ở form thêm khách gõ SĐT của X -> chờ banner. **Bước (B, staff1):** gõ SĐT của Y.
- **Kết quả A:** banner `role="alert"` "Đã có khách hàng với số điện thoại này, do <tên> chăm sóc." kèm nút "Xem hồ sơ"; bấm vào mở chi tiết X. **Kết quả B:** banner chỉ nêu "Đã có khách hàng với số điện thoại này." **không** có tên/mã/SĐT của Y; có nút "Đề nghị tham gia nhóm chăm sóc"; bấm lần nữa hoặc tải lại thì hiện "Đã gửi đề nghị, đang chờ duyệt". Cố bấm "Lưu khách hàng" khi trùng thì máy chủ từ chối bằng thông báo tiếng Việt, dữ liệu đã nhập còn nguyên.
- **Hậu trường:** B tạo 1 bản ghi `care_team_requests` trạng thái chờ; không có bản ghi khách mới ở cả hai ca.
- **UX kiểm kèm:** PH (lỗi cạnh trường, không mất dữ liệu), CN (có lối đi tiếp thay vì ngõ cụt), RG.

### F2-04 Tìm kiếm, lọc và trạng thái rỗng (P1)
- **Bước:** gõ tên khách không dấu vào ô tìm -> chờ kết quả -> gõ chuỗi không khớp -> chọn "Dự án" = A -> xóa bộ lọc.
- **Kết quả:** tìm không dấu ra đúng khách (debounce, không gọi API mỗi phím); không khớp thì hiện hướng dẫn "Thử đổi tab danh sách, từ khoá hoặc bộ lọc nâng cao." thay vì bảng trắng; lọc dự án chỉ giữ khách quan tâm dự án A; huy hiệu "N nhóm bộ lọc đang bật" xuất hiện rồi biến mất khi xóa.
- **UX kiểm kèm:** RG, PH, TT (có nút xóa nhanh bộ lọc không). `[+mobile]` (bộ lọc dạng BottomSheet).

### F2-05 Sửa đồng thời ở hai tab báo xung đột 409 (P0)
- **Mục tiêu:** hai tab cùng sửa chân dung một khách, tab lưu sau nhận hướng dẫn rõ và không mất dữ liệu đã gõ.
- **Bước:** tab 1 và tab 2 cùng mở `/crm/customers/<id>/persona` -> tab 1 đổi một trường rồi bấm "Lưu chân dung" -> tab 2 đổi trường khác rồi bấm "Lưu chân dung".
- **Kết quả:** tab 2 báo "Hồ sơ vừa được người khác cập nhật. Dữ liệu mới nhất đã được tải lại, vui lòng kiểm tra rồi thực hiện lại." Form tab 2 **giữ nguyên** những gì đang gõ (`usePersonaForm.ts:85`); bấm "Lưu chân dung" lần nữa thì lưu được với version mới và thay đổi của tab 1 không bị ghi đè mất.
- **Hậu trường:** `__v` tăng đúng 2 lần; bản ghi cuối chứa cả thay đổi của hai tab (trường khác nhau).
- **UX kiểm kèm:** PH, ĐH (sau khi lưu về chi tiết khách; **[Chưa rõ]** đích điều hướng của nút Lưu chân dung, ghi nhận thực tế).

---

## 4. F3 - Nhật ký chăm sóc và ảnh (spec `f3-care-log.spec.ts`)

Form: thẻ "Ghi chú chăm sóc" (`form` có nhãn "Thêm nhật ký chăm sóc") ở chi tiết khách: "Nội dung trao đổi *", "Kênh liên hệ", "Kết quả liên hệ" (mặc định "— Chưa chọn —"), nhóm "Nhắc việc tiếp theo" ("Việc cần làm tiếp theo", "Thời điểm nhắc", hộp "Tạo lịch hẹn "Nhắc gọi lại" vào thời điểm này"), khung "Ảnh đính kèm (tuỳ chọn)" với nút "Thêm ảnh", nút "Lưu nhật ký" (khóa khi nội dung rỗng; đang lưu hiện "Đang lưu…", đang tải ảnh hiện "Đang tải ảnh…").

### F3-01 Ghi nhật ký có nhắc việc, hiện ngay (P0)
- **Bước:** vào chi tiết khách mồi -> gõ "Nội dung trao đổi" -> chọn "Kênh liên hệ" -> chọn "Kết quả liên hệ" -> gõ "Việc cần làm tiếp theo" + chọn "Thời điểm nhắc" (hôm nay, giờ sau) -> bấm "Lưu nhật ký".
- **Kết quả:** nút "Lưu nhật ký" bị khóa khi nội dung rỗng (kiểm trước khi gõ); sau lưu form được dọn trống, mục mới xuất hiện đầu dòng thời gian (`CareTimeline`) **không cần tải lại trang**; mục "Việc hôm nay" của `staff1` có việc "Bước tiếp theo" của khách này đúng ngày (có nút "Ghi nhật ký").
- **Hậu trường:** Mongo có bản ghi nhật ký đúng nội dung/kênh; có nhắc việc tương ứng (`reminders`).
- **UX kiểm kèm:** CN, PH, ĐH (ở lại chi tiết khách), TT.

### F3-02 Tải ảnh lên nhật ký và xem lại (P0, hồi quy G1)
- **Mục tiêu:** khung "Ảnh đính kèm" và nút "Thêm ảnh" **có hiện** khi cờ bật; ảnh lên MinIO và hiển thị lại sau khi tải lại trang.
- **Tiền điều kiện:** cờ FE/BE bật (1.3).
- **Bước:** vào chi tiết khách -> thấy "Ảnh đính kèm (tuỳ chọn)" -> bấm "Thêm ảnh" -> chọn `anh-hop-le.jpg` -> chờ xem trước -> gõ nội dung -> bấm "Lưu nhật ký" -> tải lại trang.
- **Kết quả:** khung và nút hiện ngay không cần thao tác lạ; gợi ý "JPEG, PNG hoặc WebP, tối đa 5 MB mỗi ảnh, tối đa 5 ảnh. Đã chọn 1/5 ảnh." cập nhật số đã chọn; trong lúc tải có `role="status"` "Đang tải ảnh lên" và nút lưu hiện "Đang tải ảnh…"; sau lưu và sau tải lại, ảnh hiện trong mục nhật ký (URL ký sẵn, mở được; kiểm bằng `naturalWidth > 0`).
- **Hậu trường:** `crm_attachments` có bản ghi gắn nhật ký, `fileKey` đúng; MinIO bucket `e2e-attachments` có đối tượng đúng `fileKey` và kích thước khớp.
- **UX kiểm kèm:** CN (chính là G1), PH, NC (ảnh nằm đúng mục nhật ký vừa lưu), TT. `[+mobile]`.

### F3-03 Ảnh sai loại / quá lớn / vượt số lượng (P1)
- **Bước:** "Thêm ảnh" -> chọn `tai-lieu.pdf`; lặp với `anh-qua-lon.png`; lặp chọn 6 ảnh hợp lệ một lần.
- **Kết quả:** toast cảnh báo "Bỏ qua N ảnh" kèm "Chỉ nhận ảnh JPEG/PNG/WebP ≤ 5 MB, tối đa 5 ảnh."; khay ảnh không thêm file sai; ca 6 ảnh chỉ nhận 5 và báo bỏ qua 1; nội dung đã gõ không mất; không có đối tượng nào lên MinIO cho file bị bỏ.
- **UX kiểm kèm:** PH, RG.

### F3-04 Gỡ ảnh (P1)
- **Phần a (trước khi lưu):** chọn 2 ảnh -> bấm nút "Xóa ảnh 1" -> khay còn 1 ảnh, đếm "Đã chọn 1/5 ảnh"; lưu thì chỉ ảnh còn lại được lên.
- **Phần b (sau khi lưu):** Mục nhật ký đã lưu có nút "Xóa ảnh N khỏi nhật ký" (chỉ khi `canEdit`: tác giả trong 24 giờ, Quản trị, Quản lý trong phạm vi) + hộp xác nhận "Xác nhận gỡ ảnh"; nút "Xóa ảnh N" ở khay trước khi lưu là điều khiển khác (F3-04a). Kịch bản: gỡ ảnh ở mục đã lưu rồi kiểm ảnh biến mất (trước 2026-10-26 chưa có nút này, đã ghi nhóm *Thiếu chức năng* rồi sửa). Lịch sử có loại "Gỡ ảnh đính kèm" (`HistoryList.tsx:37`).
- **Hậu trường (nếu có):** `crm_attachments` đánh dấu đã gỡ (không xóa cứng), lịch sử có "Gỡ ảnh đính kèm".
- **UX kiểm kèm:** CN, PH (hỏi xác nhận trước khi gỡ?).

---

## 5. F4 - Lịch hẹn và nhắc việc (spec `f4-appointments.spec.ts` và `f4b-appointment-context.spec.ts`)

Form: `/crm/appointments/new` ("Tạo lịch hẹn mới"). Khối: "Khách hàng" (chọn bằng "Chọn khách hàng"), "Loại cuộc hẹn & Mục đích làm việc", "Dự án" (có "Không chọn", nhóm "Khách quan tâm", "Dự án khác", chip "Nên chọn"), "Ngày diễn ra", "Giờ (giờ Việt Nam)", "Địa điểm", "Ghi chú / chuẩn bị", "Người thực hiện", "Nhắc trước"; nút "Xác nhận tạo lịch hẹn", nút "Hủy bỏ" (**[Chưa rõ]** chữ chính xác của nút hủy trong `FormActionBar`), dòng thông tin "Còn N trường bắt buộc cần kiểm tra" / "Đã đủ thông tin bắt buộc". Thông báo thành công: "Tạo lịch hẹn thành công" + "Lịch hẹn với <tên> đã được lưu."

Ba hồi quy nặng nhất (G5, G6, G7, G2) gom vào `f4b`, chạy trước trong CI.

### F4-01 Đặt lịch từ chi tiết khách mang khách và dự án, khóa trường khách (P0, hồi quy G5, G2, G7)
- **Tiền điều kiện:** `staff1`, khách mồi quan tâm đúng 1 dự án (A), và khách thứ hai quan tâm A và B.
- **Bước:** vào chi tiết khách (desktop) -> bấm nút "Đặt lịch hẹn" (mobile: "Hẹn nhắc") -> quan sát form.
- **Kết quả:**
  1. URL là `/crm/appointments/new?customerId=<24 hex>`; ô "Khách hàng" **đã hiện tên khách**, không phải "Chọn khách hàng"; **khóa** (không bấm đổi được, có dòng "Đặt lịch cho khách đang xem, không đổi được khách.").
  2. Breadcrumb cấp giữa là tên khách (bấm quay về hồ sơ), không phải "Lịch hẹn & Nhắc việc".
  3. Ô "Dự án" đã **gợi ý dự án A** (khách chỉ quan tâm một dự án); ở khách quan tâm hai dự án thì **không** tự chọn, nhưng nhóm "Khách quan tâm" liệt kê A, B lên đầu.
  4. "Người thực hiện" mặc định theo nhóm chăm sóc của khách; hộp "Chọn người" chỉ chứa người trong nhóm.
  5. Tải lại trang (F5) vẫn giữ khách, dự án và vẫn khóa.
  6. Phủ thủ thuật: sửa URL thành `?customerId=zzz` (sai định dạng) và id hợp lệ nhưng khách của đội khác: form về "chưa chọn khách", **không khóa**, có toast "Chưa chọn sẵn được khách hàng" kèm "Khách không tồn tại hoặc bạn không có quyền xem. Vui lòng chọn khách khác."
- **Hậu trường:** không (chưa lưu).
- **UX kiểm kèm:** NC (cốt lõi), TT (số click từ chi tiết khách đến lưu xong: mục tiêu 5 thao tác hoặc ít hơn, ghi vào báo cáo), CN, PH. `[+mobile]`.

### F4-02 Lưu lịch hẹn về chi tiết khách, việc hôm nay hiện dự án (P0, hồi quy G6, G7)
- **Bước:** tiếp F4-01 (khách quan tâm một dự án A) -> chọn loại "Xem nhà / sa bàn" (nhãn thực tế trong `AppointmentTypePicker`, **[Chưa rõ]**) -> chọn ngày **hôm nay** -> chọn giờ -> gõ "Địa điểm" -> bấm "Xác nhận tạo lịch hẹn" -> bấm nút Quay lại của trình duyệt -> mở "Việc hôm nay" và "Lịch hẹn & Nhắc việc".
- **Kết quả:** trong lúc gửi nút hiện "Đang lưu…" và không bấm đúp được; toast "Tạo lịch hẹn thành công"; **quay về chi tiết đúng khách đó** (`/crm/customers/<id>`), **không** sang `/crm/appointments`; nút Quay lại của trình duyệt **không** đưa về form đã lưu (dùng thay thế lịch sử); `nextAppointmentAt`/khối "lịch hẹn tiếp theo" ở chi tiết khách cập nhật không cần tải lại; "Việc hôm nay" có việc lịch hẹn kèm **Dự án A** (trường `project` riêng của việc, không lẫn với "dự án khách quan tâm"); màn Lịch hẹn hiện thẻ có dòng "Dự án: A".
- **Hậu trường:** `appointments` có bản ghi đúng `customerId`, **`projectId` = A**, đúng giờ (UTC từ giờ Việt Nam), assignee đúng; `reminders` có nhắc tương ứng theo "Nhắc trước".
- **UX kiểm kèm:** ĐH (cốt lõi), PH, NC (dự án xuất hiện nhất quán ở 3 nơi). `[+mobile]` (`AppointmentCardMobile`).

### F4-03 Hủy bỏ về chi tiết khách (P0, hồi quy G6)
- **Bước:** chi tiết khách -> "Đặt lịch hẹn" -> gõ vài trường -> bấm "Hủy bỏ" (sau đó lặp với nút quay lại ở đầu trang `onBack`). Ca phụ: mở thẳng URL `/crm/appointments/new?customerId=<id>` trong tab mới (không có lịch sử) rồi "Hủy bỏ".
- **Kết quả:** về chi tiết khách đó, một lần Back của trình duyệt không bị lặp mục; ca mở thẳng URL thì chuyển về chi tiết khách (không kẹt hay trắng); form đã gõ dở thì hiện hộp xác nhận "Bỏ lịch hẹn đang nhập?" ("Bỏ thay đổi" / "Tiếp tục nhập"), form còn nguyên thì rời ngay (đã sửa U-F4-03).
- **UX kiểm kèm:** ĐH, TT.

### F4-04 Đặt lịch từ màn Lịch hẹn: chọn khách tự do, lưu về danh sách (P0)
- **Bước:** `/crm/appointments` -> bấm nút tạo lịch hẹn mới (nhãn **[Chưa rõ]**) -> thấy ô khách trống ("Chọn khách hàng") -> bấm, gõ tên khách để tìm -> chọn -> điền các trường bắt buộc -> bấm "Xác nhận tạo lịch hẹn".
- **Kết quả:** tìm khách theo tên trả đúng người; gõ khách không có thì hiện "Không tìm thấy khách phù hợp."; sau lưu về `/crm/appointments`, lịch mới hiện đúng ngày (chọn đúng ô tuần/ngày), Back không quay về form; breadcrumb cấp giữa là "Lịch hẹn & Nhắc việc"; chọn khách xong gợi ý dự án theo khách (ca khách quan tâm một dự án). Đổi khách rồi đổi dự án bằng tay, sau đó đổi khách lần nữa thì **dự án chọn tay không bị ghi đè** (`useCreateAppointmentForm.ts` header).
- **UX kiểm kèm:** ĐH, TT, CN, PH.

### F4-05 "Dẫn khách xem" mang dự án sang form (P0, hồi quy G7)
- **Tiền điều kiện:** `admin` hoặc người có quyền vào `/crm/projects` (staff1 không thấy menu này theo F1-01; dùng `mgr1`/`admin`; **[Chưa rõ]** vai trò nào đặt được lịch ở màn này, nếu `mgr1` không vào được thì dùng `admin`).
- **Bước:** `/crm/projects` -> ở thẻ dự án B bấm "Dẫn khách xem". Sau đó quay lại, bấm nút đầu trang "Đặt lịch xem sa bàn".
- **Kết quả:** "Dẫn khách xem": URL `?projectId=<id B>`, ô "Dự án" đã chọn **B**, ô khách trống (chưa có ngữ cảnh khách); lưu xong về `/crm/appointments` (không có khách gốc). Nút "Đặt lịch xem sa bàn" chung: form trống, ô "Dự án" ở "Không chọn". Dự án ngừng hoạt động (D) truyền qua `?projectId=` bị bỏ qua, không chọn sẵn. Tổ hợp `?customerId=...&projectId=...`: giữ cả hai, trường khách khóa, dự án mang sang thắng gợi ý theo khách.
- **UX kiểm kèm:** NC, CN, TT.

### F4-06 Lỗi 400 `projectId` hiện cạnh ô Dự án (P1, hồi quy G7)
- **Mục tiêu:** dự án bị ngừng hoạt động giữa lúc đang mở form thì lỗi hiện **cạnh ô Dự án**, form không mất dữ liệu.
- **Bước:** `staff1` mở form đặt lịch từ chi tiết khách, chọn dự án C và điền đủ -> (hậu trường, bằng API, `admin` ngừng hoạt động dự án C) -> bấm "Xác nhận tạo lịch hẹn".
- **Kết quả:** không có toast chung; thông báo hiện cạnh ô "Dự án" và ô nhận focus; mọi trường khác còn nguyên; đổi sang dự án khác hoặc "Không chọn" thì lỗi biến mất và lưu được; **không** có bản ghi lịch nào được tạo ở lần lỗi.
- **Hậu trường:** `appointments` không có bản ghi sau lần lỗi, có 1 bản ghi sau lần lưu lại; khôi phục dự án C ở `afterEach` (hoặc dùng dự án riêng của spec).
- **UX kiểm kèm:** PH (cốt lõi), NC.

### F4-07 Kiểm tra trường bắt buộc và khóa bấm đúp (P1)
- **Bước:** mở form trống từ màn Lịch hẹn -> bấm "Xác nhận tạo lịch hẹn" khi chưa điền gì -> điền từng trường thiếu -> bấm "Xác nhận tạo lịch hẹn" hai lần liên tiếp thật nhanh.
- **Kết quả:** toast "Chưa thể tạo lịch hẹn" kèm lý do trường lỗi đầu tiên, ô đó nhận focus, lỗi hiện cạnh từng trường chỉ **sau** lần bấm đầu; dòng thông tin đổi "Còn N trường bắt buộc cần kiểm tra" giảm dần đến "Đã đủ thông tin bắt buộc"; bấm đúp chỉ tạo **1** lịch (nút khóa "Đang lưu…"). Chọn loại "Nhắc gọi lại" mà chưa có địa điểm thì "Địa điểm" tự điền kênh gọi và không còn bắt buộc.
- **Hậu trường:** `appointments` tăng đúng 1.
- **UX kiểm kèm:** PH, RG, TT.

### F4-08 Đánh dấu hoàn thành, chuông thông báo (P1)
- **Bước:** màn Lịch hẹn -> ở một thẻ mở "Thao tác khác" -> chọn "Đánh dấu hoàn thành" (có cả "Xem hồ sơ khách", "Ghi chú nhanh", "Nhắn Zalo") -> chọn lại để "Bỏ đánh dấu hoàn thành"; ở "Việc hôm nay" bấm "Hoàn thành" trên việc lịch hẹn; mở chuông thông báo trên header trước và sau khi tạo một lịch có nhắc trước.
- **Kết quả:** trạng thái thẻ đổi tức thì và khớp sau tải lại; KPI "Hoàn thành tháng này" tăng/giảm đúng; "Xem hồ sơ khách" mở đúng khách; chuông tăng số khi có nhắc đến hạn **[Chưa rõ]** cơ chế đến hạn (cần seed nhắc đã quá hạn để kiểm được trong thời gian test).
- **Hậu trường:** `appointments.status` = DONE/SCHEDULED theo thao tác, `version` tăng; `reminders` đúng.
- **UX kiểm kèm:** PH, ĐH, CN.

### F4-09 Đổi giờ / hủy lịch hẹn: rà thiếu chức năng (P1)
> **Spec (2026-10-26):** ban đầu KHÔNG có lối đổi giờ/hủy ở cả 3 loại thẻ (desktop và mobile) nên F4-09 từng là `test.fail`; nay đã có "Đổi giờ" và "Hủy lịch hẹn" ở menu "Thao tác khác" (có ở mọi thẻ, cả desktop lẫn mobile) và F4-09 chạy như test thường (khẳng định mềm cho từng viewport và từng loại thẻ). F4-09b (mới) kiểm hành vi thật: đổi giờ lưu đúng `startAt` ở Mongo và thẻ rời khỏi hôm nay; hủy kèm lý do thì thẻ biến mất, `status=CANCELED`, `outcome` = lý do; bấm "Hoàn tác" trên toast thì lịch về `SCHEDULED`. Lịch đã hủy không còn hiện ở danh sách (`useAppointments` bỏ mặc định).

- **Mục tiêu:** API có `updateAppointmentStatus(... 'CANCELED')` nhưng trong code đã đọc, menu thẻ lịch hẹn chỉ có "Xem hồ sơ khách", "Ghi chú nhanh", "Nhắn Zalo", "Đánh dấu hoàn thành" và **không thấy** thao tác Đổi giờ hay Hủy lịch.
- **Bước:** mở từng thẻ lịch hẹn (desktop và mobile), mở "Thao tác khác", tìm mọi lối để đổi giờ hoặc hủy.
- **Kết quả mong đợi:** có lối đổi giờ và hủy ở mọi thẻ; đổi giờ giữ khách+dự án và dời giờ kết thúc theo thời lượng, hủy yêu cầu xác nhận (lý do tùy chọn) và có "Hoàn tác", thẻ phản ánh ngay. (Từng là thiếu thật, đã sửa 2026-10-26.)
- **UX kiểm kèm:** CN.

---

## 6. F5, F6, F7

### F5 - Chân dung, nhu cầu và thẻ (spec `f5-persona.spec.ts`)

Màn: chi tiết khách có nút "Sửa chân dung khách hàng" / "Sửa nhu cầu BĐS" / "Sửa thông tin khách hàng" (`PersonaCards.tsx`, `CustomerInfoCard.tsx`); `/crm/customers/<id>/persona` (nút "Lưu chân dung"), `/crm/customers/<id>/investment` (nút "Lưu nhu cầu").

#### F5-01 Điền chân dung và nhu cầu, độ đầy đủ tăng (P1)
- **Bước:** chi tiết khách -> ghi lại chỉ số độ đầy đủ chân dung (`ProgressDots`/phần trăm, vị trí **[Chưa rõ]**) -> bấm "Sửa chân dung khách hàng" -> điền 3 trường -> "Lưu chân dung" -> bấm "Sửa nhu cầu BĐS" -> điền ngân sách (`BudgetRangeInput`) -> "Lưu nhu cầu".
- **Kết quả:** mỗi lần lưu có thông báo thành công; **quay về chi tiết khách** (đích thực tế **[Chưa rõ]**, ghi nhận), giá trị mới hiển thị, độ đầy đủ tăng; khi nhập ngân sách tối thiểu > tối đa thì lỗi hiện cạnh trường và không lưu; dữ liệu CCCD chỉ hiện 4 số cuối.
- **Hậu trường:** `customers` có chân dung mới, `__v` tăng; lịch sử ghi nhận thay đổi.
- **UX kiểm kèm:** ĐH, PH, NC, CN.

#### F5-02 Gắn, gỡ thẻ và lọc theo thẻ (P1)
- **[Chưa rõ]** vị trí điều khiển thẻ: có `CustomerBadges.tsx` và `TagInput` trong form chân dung, **chưa xác nhận** có bộ lọc theo thẻ ở danh sách khách (toolbar chỉ thấy "Dự án", "Khu vực", "Người chăm sóc"). Kịch bản: thêm thẻ ở form chân dung -> lưu -> thẻ hiện ở chi tiết; gỡ thẻ -> lưu -> biến mất; tìm cách lọc theo thẻ ở danh sách, **nếu không có thì ghi "Thiếu chức năng"** (tài liệu 07 F5 đã nêu "lọc theo thẻ").
- **UX kiểm kèm:** CN, PH.

### F6 - Đội và quyền xem khách (spec `f6-team-access.spec.ts`, bảo mật)

#### F6-01 Staff đội khác không thấy khách (P0)
- **Tiền điều kiện:** khách K thuộc nhóm chăm sóc của `staff1` (đội 1); hai context `staff1`, `staff2`.
- **Bước:** `staff2` mở `/crm/customers` -> tìm tên khách K -> kiểm các bộ lọc "Người chăm sóc" -> mở màn "Việc hôm nay" và "Lịch hẹn & Nhắc việc"; ở form tạo lịch hẹn gõ tên K vào ô chọn khách.
- **Kết quả:** K không xuất hiện ở danh sách, tìm kiếm, bộ chọn khách ở form lịch hẹn, lịch hẹn, việc hôm nay của `staff2`; hiển thị "Không tìm thấy khách phù hợp." / trạng thái rỗng có hướng dẫn. `mgr1` (quản lý đội 1) và `admin` thì thấy K.
- **Hậu trường:** response API danh sách của `staff2` không chứa `_id` của K (bắt bằng `waitForResponse`).
- **UX kiểm kèm:** RG, CN.

#### F6-02 Gõ thẳng URL khách ngoài phạm vi (P0)
- **Bước:** `staff2` mở `/crm/customers/<id K>`, rồi `/crm/customers/<id K>/persona`, rồi `/crm/appointments/new?customerId=<id K>`; ca phụ: id đúng định dạng nhưng không tồn tại.
- **Kết quả:** cả ba hiện "Không tìm thấy khách hàng" (`CustomerNotFound`, thông báo "Không tìm thấy khách hàng hoặc bạn không có quyền xem khách này.") có đường quay về danh sách, **không** lộ tên/SĐT/ghi chú K ở bất kỳ thời điểm nào (kể cả lúc đang tải); ca form lịch hẹn: toast "Chưa chọn sẵn được khách hàng", form **không khóa**, không có tên K trong ô khách. Ca không tồn tại hiện **cùng** thông báo với ca ngoài phạm vi (không phân biệt được).
- **UX kiểm kèm:** RG (có lối thoát), PH.

#### F6-03 Xin vào nhóm chăm sóc, Quản lý duyệt, Staff thấy khách (P0)
- **Bước:** `staff2` mở form thêm khách, gõ SĐT của K -> "Đề nghị tham gia nhóm chăm sóc" -> thấy "Đã gửi đề nghị, đang chờ duyệt". `mgr1` mở chi tiết K -> thẻ "Nhóm chăm sóc" mục "Đề nghị tham gia nhóm chăm sóc" -> bấm "Duyệt". `staff2` tải lại `/crm/customers`. Ca đối chứng: lặp lại và bấm "Từ chối".
- **Kết quả:** sau "Duyệt" có toast thành công, đề nghị biến mất khỏi thẻ; `staff2` thấy K ở danh sách, mở được chi tiết, ở "Nhóm chăm sóc" có tên `staff2`. Sau "Từ chối" `staff2` vẫn **không** thấy K và vẫn có thể gửi đề nghị mới **[Chưa rõ]**. `staff2` không tự duyệt được cho mình (không có nút "Duyệt").
- **Hậu trường:** `care_team_requests` chuyển trạng thái (duyệt/từ chối) đúng người duyệt; `customers.careTeam` chứa `staff2` (chỉ ca duyệt).
- **UX kiểm kèm:** CN, PH, NC, RG.

### F7 - Màn còn dữ liệu mẫu và rà thiếu (spec `f7-gaps.spec.ts`)

#### F7-01 Báo cáo và Nhập/Xuất khi cờ mẫu tắt (P1)
- **Bước:** `admin` mở `/crm/reports`; `mgr1` mở `/crm/customers` rồi tìm nút nhập file CSV (`ImportCustomersButton`) và nút xuất.
- **Kết quả:** `/crm/reports` hiện "Báo cáo & Thống kê sắp ra mắt" (không có số liệu giả); nút nhập/xuất dữ liệu mẫu bị ẩn (cờ `VITE_CRM_MOCK_IMPORT_EXPORT=false`); nếu có nút xuất thật thì kiểm thông báo "Đã xuất N khách theo bộ lọc hiện tại" và file CSV UTF-8. Ca đối chứng (spec riêng hoặc `test.describe` với biến bật): cờ bật thì báo cáo có biểu ngữ cảnh báo "dữ liệu mẫu".
- **UX kiểm kèm:** RG (có thông báo thay vì trắng), CN.

#### F7-02 Rà soát điều khiển còn thiếu so với API (P1)
- **Mục tiêu:** sinh **bảng rà thiếu**, không chỉ xanh/đỏ. Duyệt chi tiết khách, danh sách khách, lịch hẹn, việc hôm nay, dự án; với mỗi mục trong danh sách dưới đây kiểm sự hiện diện điều khiển; mục không có thì ghi nhận (không làm test đỏ, trừ mục đánh dấu "bắt buộc").

| Hạng mục | Kỳ vọng | Ghi chú |
|---|---|---|
| Nút tải ảnh khi cờ bật | Có (bắt buộc, trùng F3-02) | G1 |
| Đổi giờ / hủy lịch hẹn | Có | F4-09 |
| Gỡ ảnh sau khi lưu | Có | F3-04b |
| Lọc khách theo thẻ | Có | F5-02 |
| Hoàn thành việc "Bước tiếp theo" | Có nút "Ghi nhật ký" (đã có); chưa có endpoint hoàn thành FOLLOW_UP | G4 |
| SĐT ở lịch hẹn và việc hôm nay | Hiện (che) | G4 |
| Đổi tình trạng khách | Có `StatusDropdown` ("Tình trạng: <x>. Bấm để đổi") | kiểm đổi lưu thật và có lịch sử |
| Sửa/xóa lịch hẹn từ chi tiết khách | Chỉ đọc: khối "Lịch hẹn sắp tới"; đổi giờ/hủy làm ở màn Lịch hẹn | ghi nhận |

- **Spec (2026-10-26):** bảng rà thiếu không còn là một test "luôn xanh": từng hạng mục thiếu đã thành test riêng ở spec của luồng (ban đầu là `test.fail`, nay đã sửa và chạy xanh: gỡ ảnh F3-04b, đổi giờ/hủy F4-09, lịch hẹn ở chi tiết khách G-UX-01, nhãn ô ngày U-A11Y-01, SĐT ở lịch hẹn/việc hôm nay T-G4); hạng mục "nút tải ảnh" và "Ghi nhật ký cho việc Bước tiếp theo" đã được F3-01/F3-02 phủ. F7-02 còn lại đúng một test: đổi tình trạng khách ở `StatusDropdown`, kiểm lưu thật và có dòng lịch sử `STATUS`.

---

## 7. Ma trận độ phủ, ưu tiên và ước lượng

### 7.1. Danh sách và ưu tiên

| Mã | Tên | Ưu tiên | Hồi quy | Spec |
|---|---|---|---|---|
| F1-01 | Đăng nhập đúng, menu theo vai trò | P0 | | f1 |
| F1-02 | Đăng nhập sai | P0 | | f1 |
| F1-03 | Chặn URL theo vai trò | P0 | | f1 |
| F1-04 | Đăng xuất xóa phiên | P0 | | f1 |
| F2-01 | Danh sách, SĐT che, "Hiện số" | P0 | | f2 |
| F2-02 | Thêm khách thành công | P0 | | f2 |
| F2-03 | Trùng SĐT | P0 | | f2 |
| F2-04 | Tìm kiếm, lọc, rỗng | P1 | | f2 |
| F2-05 | Xung đột 409 hai tab | P0 | | f2 |
| F3-01 | Ghi nhật ký có nhắc việc | P0 | | f3 |
| F3-02 | Tải ảnh và xem lại | P0 | G1 | f3 |
| F3-03 | Ảnh sai loại/quá lớn/quá số lượng | P1 | | f3 |
| F3-04 | Gỡ ảnh | P1 | | f3 |
| F4-01 | Đặt lịch từ chi tiết khách: mang khách+dự án, khóa | P0 | G5, G2, G7 | f4b |
| F4-02 | Lưu về chi tiết khách, việc hôm nay có dự án | P0 | G6, G7 | f4b |
| F4-03 | Hủy bỏ về chi tiết khách | P0 | G6 | f4b |
| F4-04 | Đặt lịch từ màn Lịch hẹn | P0 | | f4 |
| F4-05 | "Dẫn khách xem" mang dự án | P0 | G7 | f4b |
| F4-06 | Lỗi 400 projectId cạnh ô Dự án | P1 | G7 | f4b |
| F4-07 | Trường bắt buộc, khóa bấm đúp | P1 | | f4 |
| F4-08 | Hoàn thành lịch, chuông | P1 | | f4 |
| F4-09 | Đổi giờ/hủy lịch (rà thiếu) | P1 | | f4 |
| F5-01 | Chân dung và nhu cầu | P1 | | f5 |
| F5-02 | Thẻ gắn/gỡ/lọc | P1 | | f5 |
| F6-01 | Staff đội khác không thấy khách | P0 | | f6 |
| F6-02 | URL khách ngoài phạm vi | P0 | | f6 |
| F6-03 | Xin vào nhóm, duyệt, thấy khách | P0 | | f6 |
| F7-01 | Báo cáo/nhập-xuất khi cờ mẫu tắt | P1 | | f7 |
| F7-02 | Bảng rà thiếu | P1 | | f7 |

Tổng: **29 kịch bản** (P0: 17, P1: 12). Không có kịch bản nào bị trùng mục tiêu; F4-09, F5-02, F7-02 cùng "rà thiếu" nhưng mỗi cái khóa một hạng mục khác nhau, gộp được nếu Oniichan muốn bớt.

### 7.2. Ma trận độ phủ tiêu chí UX (● chính, ○ kèm)

| Mã | CN | NC | ĐH | PH | TT | RG |
|---|---|---|---|---|---|---|
| F1-01 | ● | | ○ | ○ | | |
| F1-02 | | | | ● | | ○ |
| F1-03 | | | ○ | | | ● |
| F1-04 | | | ○ | | | ○ |
| F2-01 | ● | | | ○ | | |
| F2-02 | ○ | ○ | ● | ● | ○ | |
| F2-03 | ● | | | ● | | ○ |
| F2-04 | | | | ○ | ○ | ● |
| F2-05 | | | ○ | ● | | |
| F3-01 | ● | | ○ | ○ | ○ | |
| F3-02 | ● | ○ | | ○ | ○ | |
| F3-03 | | | | ● | | ○ |
| F3-04 | ● | | | ○ | | |
| F4-01 | ○ | ● | | ○ | ● | |
| F4-02 | | ○ | ● | ○ | | |
| F4-03 | | | ● | | ○ | |
| F4-04 | ○ | | ● | ○ | ○ | |
| F4-05 | ○ | ● | | | ○ | |
| F4-06 | | ○ | | ● | | |
| F4-07 | | | | ● | ○ | ○ |
| F4-08 | ○ | | ○ | ● | | |
| F4-09 | ● | | | | | |
| F5-01 | ○ | ○ | ● | ○ | | |
| F5-02 | ● | | | ○ | | |
| F6-01 | ○ | | | | | ● |
| F6-02 | | | | ○ | | ● |
| F6-03 | ● | ○ | | ○ | | ○ |
| F7-01 | ○ | | | | | ● |
| F7-02 | ● | | | | | |

Kiểm tra phủ: mỗi cột có ít nhất 3 kịch bản chính (CN: 10, NC: 3, ĐH: 7, PH: 9, TT: 1, RG: 7). **TT chỉ có F4-01 làm chính**: chấp nhận vì "ít thao tác thừa" được đo bằng đếm click ở chính F4-01/F2-02, không tạo thêm test; số đếm ghi vào báo cáo.

### 7.3. Số test thực tế (2026-10-26)

| Spec | Kịch bản | Số test | Trong đó `test.fail` (khuyết tật UX đã biết, kỳ vọng đỏ; nay đều 0 vì 12 lỗi đã sửa) |
|---|---|---|---|
| `f4b-appointment-context` | F4-01, 02, 03, 05, 06 | 13 | 0 (trước đây 4: G-UX-01, id sai định dạng, U-F4-03, U-A11Y-01) |
| `f3-care-log` | F3-01..04 | 6 | 0 (trước đây 1: T-F3-04b) |
| `f1-auth` | F1-01..04 | 12 (F1-01 chạy 3 vai trò) | 0 (trước đây 4: ADMIN vào màn chính, U-F1-02, U-F1-03, U-F1-03b) |
| `f2-customers` | F2-01..05 | 8 | 0 (trước đây 1: S-F2-04) |
| `f6-team-access` | F6-01..03 | 4 | 0 |
| `f4-appointments` | F4-04, 07, 08, 09 | 9 (thêm F4-09b) | 0 (trước đây 1: T-F4-09) |
| `f5-persona` | F5-01, 02 | 4 | 0 |
| `f7-gaps` | F7-01, 02 | 4 | 0 (trước đây 1: T-G4) |
| `smoke` | hạ tầng E2E | 2 | 0 |
| `vn-time` | hàm tính giờ hẹn theo giờ VN | 5 | 0 |
| **Tổng** | **29 kịch bản** | **67** | **0** (trước đây 12) |

Cả **67 test xanh bình thường**; không còn test `test.fail` nào (12 test từng đỏ có chủ đích đã được gỡ `knownBug` sau khi lỗi UX được sửa, xem mục 6 của tài liệu 07). Hàm `knownBug` và cờ `E2E_SHOW_BUGS=1` vẫn có trong `e2e/fixtures.ts` để ghi nhận khuyết tật mới: test dùng `knownBug` chạy thật, kỳ vọng ĐỎ (Playwright báo "passed"), khi lỗi được sửa test tự báo "Expected to fail, but passed" để gỡ dấu. Thời gian một lượt đầy đủ khoảng 11 phút (tuần tự, `workers: 1`; riêng test chuông thông báo F4-08 chờ job nhắc việc 1 phút/lần nên mất ~3 phút).

Giờ hẹn trong spec KHÔNG gắn cứng: `tomorrowSlot()` (ngày mai 09:00) cho chỗ không cần "hôm nay", `todaySlot()` (bây giờ + 5 phút, chờ qua nửa đêm nếu còn dưới 8 phút) cho chỗ cần thấy lịch trong ngày; hàm tính giờ có test đơn vị ở các biên 23:56 và 00:03 (`vn-time.spec.ts`).

### 7.4. Mẫu báo cáo phát hiện

Báo cáo cuối ghi vào mục 6 của tài liệu 07. Mỗi phát hiện dùng đúng một dòng bảng, chia 3 nhóm.

**Nhóm 1 - Thiếu chức năng** (API/tài liệu cho phép nhưng giao diện không có, hoặc bị cờ che)

| ID | Kịch bản | Mô tả thiếu gì | Cờ/điều kiện che | Mức (Cao/TB/Thấp) | File nguyên nhân | Đề xuất |
|---|---|---|---|---|---|---|
| T-01 | F4-09 | Không có Đổi giờ/Hủy lịch ở thẻ lịch hẹn | - | | `AppointmentMoreMenu.tsx` | |

**Nhóm 2 - Sai hành vi** (làm sai so với mong đợi hoặc tài liệu: sai dữ liệu, sai điều hướng, sai quyền, mất ngữ cảnh)

| ID | Kịch bản | Bước tái hiện | Thực tế | Mong đợi | Mức | File nguyên nhân | Hậu trường (Mongo/MinIO) |
|---|---|---|---|---|---|---|---|
| S-01 | | | | | | | |

**Nhóm 3 - Chưa thân thiện** (chạy đúng nhưng khó dùng: thao tác thừa, thông báo khó hiểu, thiếu phản hồi, thiếu hướng dẫn khi rỗng)

| ID | Kịch bản | Vấn đề | Số thao tác hiện tại / gợi ý | Tiêu chí UX | Mức | File nguyên nhân | Đề xuất |
|---|---|---|---|---|---|---|---|
| U-01 | | | | | | | |

Quy ước: mức **Cao** = chặn việc hoặc rò quyền; **TB** = làm sai việc nhưng có đường vòng; **Thấp** = khó chịu. Mỗi phát hiện kèm ảnh chụp và trace của lần chạy; nếu lỗi do cờ thì ghi rõ cờ nào.

---

## 8. Chưa kiểm chứng / rủi ro

1. **Đã chạy thật (2026-10-26).** Nhãn, thông báo ở trên đã được so lại với giao diện chạy thật khi viết spec; chỗ lệch với tài liệu này được ghi ở mục "Quyết định [Chưa rõ]" đầu mỗi file spec. Kết quả chạy toàn bộ bộ E2E (stack cô lập): xem bảng kết quả bên dưới.
2. **Các chỗ từng phải suy đoán** (đường dẫn đăng nhập `/login`, trang đích sau đăng nhập, nhãn nút, cách chặn route theo vai trò là chuyển hướng về `/crm/today` (nay kèm toast giải thích), từng chưa có điều khiển gỡ ảnh sau khi lưu / đổi giờ / hủy lịch (nay đã có), lọc theo thẻ chỉ nằm trong "Bộ lọc nâng cao", chuông thông báo cần nhắc đã quá hạn) **đã được xác định bằng chạy thật**; các điểm từng không đạt mong đợi là 12 lỗi UX (từng là 12 test `test.fail`), nay đã sửa hết; chi tiết ở bảng tài liệu 07 mục 6.
3. **Mật khẩu test cố định (đã thống nhất):** tài liệu 07 mục 2 đã ghi `Test@12345678` cố định cho stack E2E. Seed không bao giờ chạy ngoài stack cô lập: `assertIsolated()` từ chối nếu Mongo không phải máy chủ tạm, Redis khác db 15, cổng backend khác 3100 hoặc bucket không bắt đầu bằng `e2e-`.
4. **Hai cờ dữ liệu mẫu:** stack E2E ép `VITE_CRM_MOCK_REPORTS=false` và `VITE_CRM_MOCK_IMPORT_EXPORT=false`; `smoke.spec.ts` kiểm cờ thật mà Vite nhận, F7-01 kiểm giao diện, và ca đối chứng bật cờ (chặn module `featureFlags.ts` trong trình duyệt của test, đổi đúng hai biến `VITE_CRM_MOCK_*`, đỏ ngay nếu không đổi được) chứng minh selector không kiểm hờ.
5. **F4-06 phụ thuộc thao tác nền** (ngừng hoạt động dự án giữa chừng bằng API): nếu dự án dùng chung có thể làm nhiễu spec chạy song song; bắt buộc dùng dự án riêng cho spec này.
6. **F4-08 (chuông)** phụ thuộc job nhắc việc 1 phút/lần của backend: test tạo lịch hẹn sau ~6 phút với nhắc trước 15 phút (nhắc đã quá hạn ngay lúc tạo) rồi chờ có điều kiện (tải lại mỗi 10 giây, tối đa 3 phút), không chờ cố định.
7. **Chập chờn tiềm ẩn:** debounce tìm khách 250 ms (F2-04, F4-04) và tải thông tin khách mang sang (F4-01); phải chờ theo phản hồi mạng/phần tử, không chờ cố định.
8. **`data-testid` đã dùng:** `login-submit`, `user-menu-toggle`, `user-menu-logout`, `appointment-card`, `daily-task-card`, `care-log-photo`, `notification-bell`, `notification-bell-count`; còn lại dùng `getByRole`/`getByLabel`. Chỗ thiếu nhãn truy cập (ô "Ngày diễn ra") được ghi là khuyết tật U-A11Y-01 thay vì thêm testid.
9. **Chưa phủ có chủ ý** (tránh test thừa, đã có test đơn vị/tích hợp): định dạng SĐT, quy tắc lọc, reducer store, rate limit, Idempotency-Key (kiểm ở integration backend).
10. **Giờ chạy gần nửa đêm:** spec không phụ thuộc giờ chạy (`tomorrowSlot`/`todaySlot`), nhưng một test đang chạy dở đúng lúc qua 00:00 (vài giây) vẫn có thể thấy "hôm nay" đổi ngày; `todaySlot` giảm rủi ro này bằng cách chờ qua nửa đêm khi còn dưới 8 phút.

### Kết quả chạy thật (2026-10-26, stack cô lập, `workers: 1`)

| Lần | Cách chạy | Kết quả | Thời gian |
|---|---|---|---|
| 1 | `E2E_SHOW_BUGS=1` (12 test `test.fail` chạy như test thường) | 54 xanh + 12 đỏ, mỗi test đỏ đúng ở dòng assertion nói về lỗi UX của nó | ~10 phút |
| 2 - 5 | `npm run e2e` đầy đủ, 4 lần liên tiếp | mỗi lần **66/66 "passed"** (54 xanh + 12 `test.fail` đỏ đúng kỳ vọng), không chập chờn | 10,2 - 10,7 phút |
| 6 | `npm run e2e` đầy đủ, SAU khi sửa 12 lỗi UX (đã gỡ hết `knownBug`) | **66/66 xanh thật**, 0 test đỏ có chủ đích, 0 "xanh bất ngờ" | 10,9 phút |
| 7 | `npm run e2e` đầy đủ, sau khi thêm F4-09b (đổi giờ/hủy/hoàn tác) | **67/67 xanh thật**, 0 test `test.fail`, không chập chờn | 9,8 phút |

Sau chạy: cổng 3100/5183 trống, Redis db 15 rỗng, không còn bucket `e2e-*`, số document DB dev `mongodb` không đổi. (Lần 6 và 7: cổng 3100/5183 trống, Redis db 15 rỗng; DB dev `mongodb` không đối chiếu được vì container đang tắt, nhưng E2E chỉ dùng MongoDB tạm trong bộ nhớ.)
