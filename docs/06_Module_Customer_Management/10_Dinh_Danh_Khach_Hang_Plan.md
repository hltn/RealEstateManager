# Kế hoạch: Định danh khách hàng (bỏ ràng buộc SĐT, mã khách tự sinh, người tạo = chăm sóc chính bất biến)

> **Phiên bản tài liệu:** v1.0.5

> Ngày tạo: 2026-11-10
> Module: Quản lý & chăm sóc khách hàng (CRM) — sửa đổi tính năng đã có
> Trạng thái: Approved
> Author: pm-agent

---

## 1. Mục tiêu & Phạm vi

### 1.1 Mục tiêu nghiệp vụ

Hiện CRM nhận diện khách bằng SĐT: SĐT bắt buộc, duy nhất toàn hệ thống (kể cả khách xóa mềm), khi nhập trùng thì hiện banner "đã có khách này, do X chăm sóc" và cho xin tham gia nhóm chăm sóc (X2). Oniichan quyết định đổi cách làm:

1. **Bỏ ràng buộc SĐT**: SĐT không còn bắt buộc, không còn duy nhất; chỉ họ tên bắt buộc.
2. **Thêm mã khách tự sinh** để Admin/Manager vẫn định danh được khách khi SĐT có thể trùng hoặc trống, và biết khách của ai.
3. **Người tạo khách = người chăm sóc chính (PRIMARY) và không đổi**; nghỉ việc chỉ khóa tài khoản, không xóa.
4. **Bỏ luồng xin tham gia nhóm chăm sóc**; thay bằng **chia sẻ = mời**: người phụ trách chính mời thành viên phụ, kể cả người không cùng nhóm.

Kết quả mong muốn: tạo khách nhanh, không bị chặn vì trùng/thiếu SĐT; mỗi khách luôn có một chủ rõ ràng (người tạo) và một mã định danh; việc chia sẻ khách do chủ khách chủ động.

### 1.2 Người dùng / Stakeholder

| Vai trò | Nhu cầu |
|---|---|
| Nhân viên (STAFF) | Tạo khách không cần SĐT/không bị chặn trùng; là chủ khách mình tạo; mời đồng nghiệp (kể cả nhóm khác) cùng chăm sóc |
| Quản lý (MANAGER) | Thấy mã khách và ai là chủ khách trong nhóm mình quản lý; lọc theo người chăm sóc chính; mời người vào chăm sóc phụ |
| Quản trị (ADMIN) | Như Quản lý nhưng toàn hệ thống; khóa tài khoản khi nhân viên nghỉ việc mà không mất dữ liệu khách |
| Oniichan (chủ hệ thống) | Chốt quy tắc, nghiệm thu; xác nhận migration dữ liệu một chiều |
| `architect-agent`, coder BE/FE, `qa-agent`, `devops-agent` | Nhận Plan làm đầu vào thiết kế, triển khai, kiểm chứng, chạy migration |

### 1.3 Trong phạm vi / Ngoài phạm vi

- Trong phạm vi:
  - BE: `crm/customers`, `crm/care-teams` (gồm kiểm tra cùng nhóm ở `care-team-assignees`/rules), `assignable-users`, `appointments`, `daily-tasks`, `error-codes`, notifications liên quan; migration (bỏ unique `phone`, thêm index mã, counter, bù mã cho khách cũ); `deploy.sh` (chỉ thêm điểm gọi chung, không nhúng logic bù mã), script bù mã khách riêng, tách bước 8c bù mã danh mục của v1.0.4 ra script riêng (FR-23) và test của chúng.
  - FE: `RealEstateAdminApp` và prototype `stnd-crm-unified`, kiểm cả giao diện mobile/PWA.
  - Test BE integration M1–M5/deletion/qa viết lại theo quy tắc mới; unit test BE/FE.
  - Tài liệu 04, 05, 06, 09 (ghi như sửa đổi mới v1.0.5 trong 09) và `01_Infrastructure/06_Production_Deploy.md` (mục 11, sau khi tách script).
- Ngoài phạm vi:
  - Tìm/gộp/khử khách trùng, cảnh báo mềm khi SĐT trùng.
  - Chuyển giao PRIMARY khi nhân viên nghỉ việc (quy trình bàn giao); xóa tài khoản người dùng (API chưa có DELETE user, giữ nguyên).
  - Sửa PRIMARY hàng loạt cho khách cũ (chỉ áp quy tắc cho khách tạo mới; khách cũ chưa có PRIMARY thì Admin/Manager đặt một lần, mục 8).
  - Tính năng tự xin chia sẻ khách dưới hình thức khác.
  - Zalo, ghi âm, import 3 sheet cũ (giai đoạn sau, không liên quan).

### 1.4 Quyết định bị đảo ngược

> Đối chiếu với nhật ký quyết định ở [`04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md`](04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md) mục 11 và các mục liên quan. Theo quy ước của 09: ghi "thay thế quy tắc X"; tài liệu cũ giữ nguyên để truy vết.

| # | Quyết định cũ (nơi ghi) | Quyết định mới | FR |
|---|---|---|---|
| 1 | **#2 "BỎ mã khách hàng"** (04 mục 11): không có `customerCode`/mã KH ở schema, DTO, filter, import/export; nhận diện bằng `_id` + họ tên + SĐT | **CÓ mã khách tự sinh** (định dạng `KH-000123`, mục 8) | FR-07, FR-08, FR-09 |
| 2 | **SĐT bắt buộc và duy nhất toàn hệ thống kể cả khách xóa mềm** (04 mục 3.2; 09 v1.0.2 mục 3 "Hiện trạng"; 05 `409 CUSTOMER_PHONE_DUPLICATED`) | SĐT **tùy chọn** (null được), **không duy nhất**; index `phone` giữ lại dạng thường để tìm kiếm | FR-01, FR-02 |
| 3 | **Luồng tra trùng SĐT + xin tham gia nhóm chăm sóc X2**; quyết định **#12 "G2 ĐÃ XÁC NHẬN — đề nghị tham gia"** (04 mục 11, mục 6.1, ma trận 4.2 hai hàng X2; 05 `phone-lookups`, `/crm/care-team-requests` 3 endpoint, `JOIN_REQUEST_EXISTS`/`ALREADY_IN_CARE_TEAM`) | **BỎ hẳn** luồng (chỉ có một cửa vào là kết quả phone-lookups, bỏ cùng) | FR-03, FR-12 |
| 4 | **Giới hạn "phụ trách chính chỉ mời người cùng nhóm"** (04 ma trận 4.2 hàng "Thêm thành viên chăm sóc" NV phụ trách chính `[Giả định]`; 05 `assignable-users`: S (PR) chỉ nhóm mình) | Phụ trách chính (kể cả Nhân viên) mời được **cả người không cùng nhóm**; người được mời vẫn phải ACTIVE và có vai trò Manager/Nhân viên | FR-13, FR-14, FR-15 |
| 5 | **#15 "G5 ĐÃ XÁC NHẬN — gỡ phụ trách chính phải chọn người thay"** và QT7 "Đổi phụ trách chính" (04 mục 11, ma trận 4.2; 05 `PUT .../care-team/primary`, `PRIMARY_REPLACEMENT_REQUIRED`) | PRIMARY của khách **tạo mới** là người tạo và **bất biến**: khóa đổi, chặn gỡ; chỉ thêm/gỡ thành viên phụ | FR-10, FR-11 |
| 6 | **Tạo hộ**: Admin/Manager chỉ định `careTeam`/primary người khác khi tạo khách (04 mục 6.1 "NV tạo ⇒ tự là PRIMARY", Admin/Manager phân người khi tạo) | Mọi vai trò tạo khách thì **chính mình là PRIMARY**; bỏ chỉ định hộ khi tạo | FR-10 |

Các quyết định **không đổi**: #10 (thành viên PRIMARY/MEMBER xem/gọi SĐT, ghi `PHONE_VIEWED`), #14 (phụ trách chính nhận thông báo ưu tiên), #37 (chặn dò số qua tìm kiếm), #34 (lịch sử thay đổi hiển thị SĐT cũ → mới).

## 2. Tính năng

> Cột `Mã` (FR-01, FR-02…) bắt buộc, duy nhất trong Plan.

| Mã | Tính năng | Ưu tiên (Phải có / Nên có / Tùy chọn) |
|---|---|---|
| FR-01 | Bỏ ràng buộc trùng SĐT: bỏ unique index `phone` (giữ index thường), bỏ kiểm trùng khi tạo/sửa, bỏ lỗi 409 `CUSTOMER_PHONE_DUPLICATED`; nhiều khách (kể cả khách xóa mềm) được cùng SĐT | Phải có |
| FR-02 | SĐT không bắt buộc: chỉ họ tên bắt buộc; `phone` có thể null (schema, DTO tạo/sửa, form Thêm/Sửa khách); khi có nhập vẫn chuẩn hóa và kiểm định dạng | Phải có |
| FR-03 | Bỏ tính năng tra trùng SĐT khi nhập form Thêm khách: bỏ `POST /crm/customers/phone-lookups`, banner trùng SĐT ở FE, rate-limit/audit `PHONE_LOOKUP` liên quan (bỏ hẳn ngay, không giữ bản chuyển tiếp: FR-20) | Phải có |
| FR-04 | Xử lý `phone` null trong luồng xem/gọi: `phone-views` (không có SĐT thì không có gì để xem, trả lỗi rõ ràng, không ghi `PHONE_VIEWED`), `phoneMasked` null, nút Gọi/Zalo ẩn khi không có SĐT; lịch hẹn và việc hằng ngày hiển thị khách không có SĐT bình thường | Phải có |
| FR-05 | **Bỏ khỏi phạm vi v1.0.5** (Oniichan 2026-11-10): nhập/xuất khách hiện chỉ là mock phía giao diện (không có API thật), không sửa gì ở phần này, kể cả tài liệu quy tắc nhập/xuất. Giữ mã FR-05 để không đánh số lại | Bỏ |
| FR-06 | Tìm kiếm và ẩn danh hóa với `phone` null: `searchText` không lỗi khi thiếu SĐT (giữ chặn dò số, mục 11 #37); ẩn danh hóa đặt `phone = null` thay cho giá trị giả `anonymized:<id>` (vốn chỉ để né unique index); dữ liệu cũ dạng `anonymized:<id>` được migration chuyển về `phone = null` (idempotent) | Phải có |
| FR-07 | Mã khách tự sinh: một dãy số chung toàn hệ thống, định dạng `KH-000123` (6 chữ số, vượt 999.999 thì mở rộng thêm chữ số), sinh nguyên tử bằng counter trong transaction tạo khách; unique index; không tái sử dụng kể cả khi khách bị xóa; không sửa được | Phải có |
| FR-08 | Migration bù mã cho khách cũ (kể cả đã xóa mềm) theo thứ tự `createdAt`, cập nhật counter, idempotent; unique index mã dạng partial tạo trước (migration 010), bù mã chạy sau khi backend sống (FR-21) | Phải có |
| FR-09 | Hiển thị mã khách và cột người chăm sóc: (1) **mã khách hiện ngay cạnh SĐT** ở mọi vai trò, trong danh sách (dòng bảng desktop và thẻ mobile/PWA); khách không có SĐT vẫn hiện mã; (2) **màn xem chi tiết khách cũng hiện mã khách** (đầu hồ sơ), mọi vai trò; (3) ô tìm kiếm tìm theo mã; (4) riêng Admin/Manager có thêm cột Người chăm sóc chính (nhãn "đã khóa" cạnh tên nếu tài khoản bị khóa) và bộ lọc theo người chăm sóc chính; giao diện desktop và mobile/PWA | Phải có |
| FR-10 | Người tạo = PRIMARY: Nhân viên, Manager hay Admin tạo khách thì chính người tạo là PRIMARY; bỏ chỉ định hộ `careTeam`/primary người khác khi tạo (DTO, API, form); Admin thuần tạo khách cũng đứng tên PRIMARY được (mở quyền cho Admin, hiện code chỉ cho Manager/Nhân viên) | Phải có |
| FR-11 | PRIMARY bất biến: khóa `PUT /crm/customers/:id/care-team/primary`, chặn gỡ PRIMARY khỏi nhóm chăm sóc (kể cả qua thao tác hàng loạt); vẫn thêm/gỡ thành viên phụ (MEMBER); khách cũ có primary ≠ người tạo **không bị ép sửa** và vẫn bất biến; khách cũ chưa có PRIMARY (null) thì Admin/Manager được đặt PRIMARY đúng một lần rồi khóa; thao tác hàng loạt `ASSIGN` chỉ thêm MEMBER, không đặt/đổi PRIMARY; FE ẩn thao tác đổi/gỡ chính | Phải có |
| FR-12 | Bỏ hẳn luồng xin tham gia nhóm chăm sóc (X2): 3 endpoint `/crm/care-team-requests` (POST, GET, PATCH), collection `care_team_requests`, mã lỗi `JOIN_REQUEST_EXISTS`/`ALREADY_IN_CARE_TEAM` (chỉ bỏ nếu không còn nơi khác dùng, ví dụ thêm thành viên đã có trong nhóm; `architect-agent` kiểm), rate-limit `JOIN_REQUEST`, thông báo đề nghị, phần FE tương ứng; dữ liệu `care_team_requests` giữ nguyên không xóa (không còn code dùng), thông báo cũ vẫn xem được nhưng không còn hành động | Phải có |
| FR-13 | Chia sẻ = mời: người phụ trách chính (kể cả Nhân viên) mời thành viên phụ qua `POST /crm/customers/:id/care-team/members` (đã có) và được mời cả người không cùng nhóm: bỏ kiểm tra cùng nhóm ở `care-team-assignees`/rules cho phụ trách chính; người được mời phải ACTIVE và có vai trò Manager/Nhân viên; Manager cũng mời được người ngoài nhóm mình quản lý (đồng bộ với phụ trách chính), Admin không giới hạn; thành viên phụ không tự rời, chỉ PRIMARY/Manager/Admin gỡ | Phải có |
| FR-14 | Nguồn người được mời cho Nhân viên: Nhân viên tìm và chọn được người ở nhóm khác (danh sách hiện giới hạn theo nhóm, cần mở rộng); chỉ trả tên hiển thị, không lộ thông tin nhạy cảm khác (email, SĐT, CCCD…); phạm vi toàn hệ thống, trả tên hiển thị kèm tên nhóm (mục 8) | Phải có |
| FR-15 | Hệ quả quyền khi mời người ngoài nhóm: `teamIds` của khách là hợp nhóm của các thành viên nên Manager của nhóm người được mời sẽ thấy khách (hành vi này được chấp nhận, mục 8); người được mời thấy toàn bộ hồ sơ kể cả xem SĐT (có audit `PHONE_VIEWED`); ghi nhận vào tài liệu 04 mục 7.3 | Phải có |
| FR-16 | Thông báo khi được mời: người được mời nhận thông báo `CUSTOMER_ASSIGNED` (đã có, nằm trong danh mục push); không gửi cho tài khoản bị khóa (FR-18) | Phải có |
| FR-17 | Giới hạn số thành viên phụ tối đa cho mỗi khách để chống lạm dụng (tối đa 10 thành viên phụ mỗi khách và rate-limit mời 30 lần/phút/người, mục 8) | Nên có |
| FR-18 | Quy tắc nghỉ việc: chỉ **khóa** tài khoản, không xóa (ghi thành quy tắc, API chưa có DELETE user); PRIMARY bị khóa vẫn giữ nguyên trên bản ghi khách; Admin/Manager mời người khác chăm sóc phụ; thông báo/push không gửi cho tài khoản bị khóa; mở khóa lại thì hoạt động bình thường | Phải có |
| FR-19 | Việc hằng ngày/nhắc lịch cho khách có PRIMARY bị khóa hoặc null: bộ lọc "của tôi" theo `primaryAssigneeId` không được làm việc của khách đó rơi vào hư không (việc hằng ngày và nhắc lịch hiện cho mọi thành viên chăm sóc ACTIVE, mục 8) | Phải có |
| FR-20 | **Không giữ bản chuyển tiếp cho PWA bản cũ** (Oniichan 2026-11-10): xóa hẳn ngay trong v1.0.5 mọi thứ bản cũ còn gọi (`phone-lookups`, `PUT primary`, `assignable-users`, field `careTeam` khi tạo, 3 endpoint `care-team-requests`); máy còn bản PWA cũ trong cache phải tải lại/mở lại PWA sau deploy (ghi vào hướng dẫn deploy). Bản FE mới chịu được `phone` null (không gọi `.replace`/`.trim` trên null) ở mọi nơi hiển thị/định dạng SĐT | Phải có |
| FR-21 | Migration dữ liệu và index: bỏ unique `phone` (giữ index thường), thêm unique index mã, collection counter; thứ tự an toàn, có `mongodump` trước, có `--dry-run`, idempotent. **Deploy gộp cùng v1.0.4** (mục 8): đánh số từ 010 liền sau 009; (1) unique index mã dạng **partial** (chỉ tính khi mã là chuỗi) để image cũ v1.0.3 còn phục vụ giữa bước migrate và `up` vẫn tạo được khách chưa có mã mà không lỗi `E11000`; (2) bù mã khách là **một script riêng** (CLI độc lập, đặt cạnh `crm-catalog-codes.cli.ts`), **không viết logic bù mã vào `deploy.sh`**; `deploy.sh` chỉ gọi script này sau khi backend sống, và script chỉ làm việc khi migration v1.0.5 (010) đã áp dụng (tự kiểm sổ migration trong `system`; chưa áp dụng, ví dụ deploy bản khác hoặc `--no-migrate`, thì thoát 0 không làm gì); idempotent; thoát khác 0 thì deploy thất bại; (3) bỏ unique `phone` là migration **riêng, cuối cùng**, và `architect-agent` thiết kế để chạy sau khi backend mới đã sống nhằm giữ đường lùi image khi `up` lỗi; (4) cập nhật test registry/runner, thêm test cho script bù mã (kể cả chạy lại khi `up` lỗi giữa chừng) và thử cả chuỗi 007 → 010+ trên staging bằng bản sao dump production | Phải có |
| FR-22 | Test và tài liệu: viết lại test BE integration M1–M5/deletion/qa theo quy tắc mới, bổ sung unit test BE/FE; cập nhật tài liệu 04, 05 (số endpoint, mã lỗi), 06, 09 (mục v1.0.5, ghi "thay thế quy tắc X của vA.B.C") | Phải có |
| FR-23 | Tách bước 8c (bù mã danh mục của v1.0.4) khỏi `deploy.sh` thành script riêng, dùng chung điểm gọi hậu-migrate với script bù mã khách (FR-21): `deploy.sh` không còn hàm `run_catalog_codes_cli` và khối bước 8c; **hành vi giữ nguyên** (chạy mọi lần deploy sau khi backend sống, bỏ qua khi downgrade có chủ ý, lỗi thì ghi `deploy-catalog-codes-<thời-gian>.log`, in cảnh báo đỏ và deploy thất bại); cập nhật `scripts/tests/deploy-catalog-codes.test.sh`, phần mô tả trong `deploy.sh` và mục 11 của `01_Infrastructure/06_Production_Deploy.md` | Phải có |

## 3. Quy tắc nghiệp vụ

1. Tạo khách chỉ bắt buộc **họ tên**. SĐT tùy chọn; khi nhập thì chuẩn hóa `+84…` và kiểm định dạng như cũ. Không còn kiểm trùng SĐT ở bất kỳ luồng nào (tạo, sửa). **[Giả định]** giữ chuẩn hóa/kiểm định dạng khi có nhập (FR-01, FR-02).
2. Hai khách được phép cùng SĐT. Không có cảnh báo, không có banner, không có tra cứu trùng (FR-01, FR-03).
3. Mã khách do hệ thống sinh, một dãy chung toàn hệ thống, **không tái sử dụng** kể cả khi khách bị xóa mềm/xóa vĩnh viễn/ẩn danh hóa; không ai sửa được (FR-07).
4. Khách cũ được bù mã theo `createdAt` tăng dần; mã đã cấp không đổi khi chạy lại migration (FR-08).
5. Người tạo khách luôn là PRIMARY của khách đó, ở mọi vai trò (Nhân viên, Manager, Admin) và mọi đường tạo (form). Không ai tạo hộ chỉ định PRIMARY khác (FR-10).
6. PRIMARY của khách mới **không đổi, không gỡ** được; thành viên phụ (MEMBER) thêm/gỡ được theo quyền hiện có (FR-11).
7. Khách cũ có primary ≠ người tạo giữ nguyên hiện trạng và bất biến; khách cũ chưa có PRIMARY thì Admin/Manager được đặt đúng một lần rồi khóa; quy tắc 5, 6 chỉ ép cho khách tạo mới (FR-11).
8. Chia sẻ khách chỉ bằng **mời** thành viên phụ; không còn đề nghị tham gia. Người được mời ACTIVE, vai trò Manager/Nhân viên; phụ trách chính mời được cả người khác nhóm (FR-12, FR-13).
9. Mọi thành viên chăm sóc (PRIMARY lẫn MEMBER) thấy toàn bộ hồ sơ khách và được xem/gọi SĐT có ghi `PHONE_VIEWED`; không đổi so với quyết định #10 (FR-15).
10. Nhân viên nghỉ việc chỉ khóa tài khoản, không xóa. Khóa giữ nguyên PRIMARY trên khách; mở khóa lại thì như cũ; tài khoản bị khóa không nhận thông báo (FR-18).
11. Nơi hiển thị SĐT/nút Gọi/Zalo phải xử lý `phone` null: ẩn nút, không lỗi (FR-04, FR-20).
12. Mã khách hiện cạnh SĐT ở danh sách và ở màn chi tiết cho mọi vai trò; cột Người chăm sóc chính và bộ lọc theo người chăm sóc chính chỉ ở danh sách của Admin/Manager; Nhân viên chỉ thấy khách của mình như cũ (FR-09).

## 4. Thứ tự triển khai

| Giai đoạn | Nội dung | Phụ thuộc |
|---|---|---|
| MVP-1 (BE nền) | FR-07, FR-08, FR-21 (thêm counter/index mã, bù mã); FR-10, FR-11 (người tạo = PRIMARY, khóa đổi/gỡ); FR-01, FR-02, FR-06 (bỏ unique, phone null ở BE, ẩn danh hóa) | Câu hỏi đã làm rõ ở mục 8. Migration bỏ unique `phone` chạy **sau cùng** vì một chiều (rủi ro 1) |
| MVP-2 (BE bỏ luồng cũ + mời) | FR-03, FR-12, FR-20 (bỏ phone-lookups, bỏ X2, không giữ bản chuyển tiếp); FR-13, FR-14, FR-16 (mời người ngoài nhóm, nguồn người được mời, thông báo) | MVP-1 |
| MVP-3 (FE + PWA) | FR-02, FR-03, FR-04, FR-20 (form, banner, nút Gọi/Zalo, phone null); FR-09 (mã cạnh SĐT ở danh sách và chi tiết, cột Người chính, lọc, tìm theo mã); ẩn thao tác đổi/gỡ chính, bỏ UI xin tham gia; chọn người mời | MVP-2 (hợp đồng API đã chốt) |
| Enhancement | FR-04 phần lịch hẹn/việc hằng ngày; FR-18, FR-19 (khóa tài khoản, việc của khách có PRIMARY khóa/null); FR-15 (ghi nhận quyền riêng tư, giữ nguyên cách tính `teamIds`) | MVP-3 |
| Enterprise-hardening | FR-17 (giới hạn 10 thành viên phụ và rate-limit mời); FR-22 (viết lại test M1–M5/deletion/qa, audit coverage, cập nhật tài liệu 04/05/06/09); FR-23 (tách bước 8c ra script riêng, làm cùng điểm gọi chung của FR-21); chạy migration lên production có `mongodump`, deploy gộp cùng v1.0.4 và chạy thử trên staging bằng bản sao dump; theo dõi sau deploy | Enhancement; Oniichan duyệt migration một chiều |

## 5. Rủi ro & Ràng buộc

| # | Rủi ro | Ảnh hưởng | Hướng xử lý |
|---|---|---|---|
| 1 | Sau khi đã có SĐT trùng thì **không dựng lại được** unique index `phone` (một chiều) | Muốn quay lại ràng buộc cũ phải khử trùng dữ liệu thủ công | Chạy bỏ unique ở bước cuối sau QA, `mongodump` trước, có `--dry-run`; Oniichan xác nhận rõ đây là quyết định một chiều trước khi lên production (FR-21) |
| 2 | Không giữ bản chuyển tiếp: PWA bản cũ còn trong cache gọi endpoint đã bỏ (`phone-lookups`, `assignable-users`, `care-team-requests`), nhận `phone` null gây lỗi `.replace`… | Màn Thêm khách, danh sách, hộp thông báo lỗi hoặc trắng trên máy chưa tải lại bản mới | Chấp nhận (Oniichan chốt bỏ hết ngay); hướng dẫn deploy ghi rõ báo nhân viên tải lại/mở lại PWA; FE mới xử lý null toàn bộ nơi định dạng SĐT; kiểm cả mobile/PWA (FR-03, FR-20) |
| 3 | Khách cũ không đồng nhất: primary ≠ người tạo, primary null | Quy tắc "người tạo = PRIMARY" chỉ đúng với khách mới; khách cũ primary null không ai đổi được nếu khóa tuyệt đối | Không ép sửa khách có PRIMARY; khách primary null cho Admin/Manager đặt một lần (mục 8); test cả hai nhóm khách (FR-11) |
| 4 | Counter mã khách là điểm tranh chấp ghi khi nhiều người tạo cùng lúc (kể cả import hàng loạt) | Nghẽn tạo khách, transaction retry, mã bị bỏ trống khi rollback | Cấp mã nguyên tử trong transaction tạo khách; `architect-agent` chọn cách cấp (từng mã/theo lô cho import); test đồng thời (FR-07) |
| 5 | Việc của khách có PRIMARY bị khóa: bộ lọc "của tôi" theo `primaryAssigneeId` không còn ai nhận | Khách bị bỏ quên, lịch hẹn/việc không ai thấy | Việc/nhắc lịch hiện cho mọi thành viên ACTIVE (mục 8); hiện nhãn "đã khóa" ở danh sách Admin/Manager để phát hiện (FR-09, FR-18, FR-19) |
| 6 | Mất khả năng tự xin chia sẻ khách (chỉ còn mời) | Nhân viên muốn chăm khách của người khác phải nhờ chủ khách hoặc Manager/Admin mời | Ghi nhận là đánh đổi đã chốt (quyết định 5, 6); Admin/Manager vẫn mời được (FR-12, FR-13) |
| 7 | Mời người ngoài nhóm mở rộng phạm vi nhìn thấy khách: `teamIds` là hợp nhóm các thành viên nên Manager nhóm người được mời thấy khách; người được mời thấy toàn bộ hồ sơ + xem SĐT | Quyền riêng tư dữ liệu cá nhân (Nghị định 13/2023); khách "lan" sang nhóm khác | Giữ audit `PHONE_VIEWED` và cảnh báo xem bất thường; ghi vào 04 mục 7.3; chấp nhận hành vi này và giới hạn 10 thành viên phụ (mục 8) (FR-15, FR-17) |
| 8 | Danh sách người được mời mở rộng toàn hệ thống có thể lộ thông tin nhân sự | Lộ email/vai trò/nhóm của người khác nhóm cho Nhân viên | Chỉ trả tên hiển thị kèm tên nhóm để phân biệt người trùng tên; có phân trang, giới hạn tần suất tìm (FR-14) |
| 9 | Phạm vi sửa rộng (ước thô: BE 25–35 file kể cả spec, FE 15–25 file; nhiều test integration viết lại) | Hồi quy ở scope khách, lịch hẹn, việc hằng ngày, import/export, thông báo | Chia giai đoạn như mục 4; `qa-agent` review code + test từng lượt, audit coverage cuối (FR-22) |
| 10 | Bù mã cho khách cũ trên dữ liệu thật và đổi unique index trên collection đang chạy | Chặn ghi lâu, mã bù sai thứ tự/không đủ | Migration idempotent, thử trên bản sao dump, chạy ngoài giờ cao điểm, xác minh số lượng sau chạy (FR-08, FR-21) |
| 11 | Dữ liệu `care_team_requests` và thông báo đề nghị đã có trong hộp thông báo | Thông báo cũ trỏ tới luồng không còn, dữ liệu mồ côi | Giữ nguyên dữ liệu, bỏ khỏi UI, không xóa (mục 8) (FR-12) |
| 12 | Deploy gộp v1.0.4 + v1.0.5 trong một lần: production đang ở v1.0.3, `deploy.sh` chạy migration 007–009 rồi 010 trở đi **trước `up`**, khi image cũ v1.0.3 còn phục vụ | Image cũ tạo khách chưa có mã; nếu unique index mã không cho phép thiếu mã thì tạo khách lỗi `E11000` trong khoảng đó; khách tạo trong khoảng đó thiếu mã | Unique index mã dạng partial; script bù mã riêng, `deploy.sh` chỉ gọi sau `up` khi migration v1.0.5 đã áp dụng (lỗi thì deploy thất bại); thử trên staging bằng bản sao dump; cập nhật test registry/runner (FR-08, FR-21) |
| 13 | Deploy gộp làm mất đường lùi image an toàn của v1.0.4: 007/008 chỉ thêm trường nên lùi image được, còn bỏ unique `phone` là một chiều | Sau bước bỏ unique, lùi image về v1.0.3 chạy được nhưng mất chặn trùng SĐT và không dựng lại được index | Bỏ unique `phone` là migration riêng cuối cùng, chạy sau khi backend mới sống; `mongodump` trước; Oniichan xác nhận quyết định một chiều trước khi lên production (rủi ro 1, FR-21) |
| 14 | Tách bước 8c (FR-23) sửa lại phần `deploy.sh` của v1.0.4 đã QA xong và nằm trong cùng lần deploy gộp | Hồi quy cách bù mã danh mục (điều kiện an toàn của FR-40 v1.0.4); script mới gọi sai hoặc mất khi downgrade có chủ ý | Giữ nguyên hành vi từng nhánh (bỏ qua khi downgrade, lỗi thì deploy thất bại); sửa và chạy lại `scripts/tests/deploy-catalog-codes.test.sh`; thử cả hai script trên staging (FR-21, FR-23) |

## 6. Tiêu chí nghiệm thu

- [ ] Tạo khách chỉ với họ tên (không SĐT) thành công; tạo hai khách cùng SĐT đều thành công; không còn lỗi `CUSTOMER_PHONE_DUPLICATED` ở tạo/sửa (FR-01, FR-02).
- [ ] Không còn unique index `phone`; vẫn có index `phone` thường; tìm theo SĐT vẫn đúng, chặn dò số vẫn hoạt động (FR-01, FR-06).
- [ ] `POST /crm/customers/phone-lookups` bị xóa hẳn (không còn endpoint, không còn bản chuyển tiếp); form Thêm khách không còn banner; hướng dẫn deploy ghi việc tải lại PWA sau deploy (FR-03, FR-20).
- [ ] Khách không có SĐT: danh sách, chi tiết, lịch hẹn, việc hằng ngày hiển thị bình thường; nút Gọi/Zalo ẩn; `phone-views` trả lỗi rõ ràng và không ghi `PHONE_VIEWED` (FR-04, FR-20).
- [ ] (FR-05 đã bỏ khỏi phạm vi v1.0.5: không có mục nghiệm thu nhập/xuất khách.)
- [ ] Ẩn danh hóa đặt `phone = null`, không còn giá trị `anonymized:<id>` (FR-06).
- [ ] Mỗi khách mới có mã duy nhất theo định dạng đã chốt; tạo đồng thời N khách không trùng mã; xóa khách rồi tạo mới không dùng lại mã (FR-07).
- [ ] Sau migration mọi khách cũ (kể cả đã xóa mềm) có mã theo `createdAt`; chạy lại migration không đổi mã đã cấp; unique index mã tạo thành công (FR-08, FR-21).
- [ ] Deploy gộp thử trên staging bằng bản sao dump production (v1.0.3 → v1.0.5): migration 007–009 rồi 010+ chạy đủ thứ tự; image v1.0.3 tạo khách giữa bước migrate và `up` không lỗi; script bù mã riêng bù đủ mã, chạy lại không đổi và không làm gì khi migration v1.0.5 chưa áp dụng; `deploy.sh` không chứa logic bù mã; test registry/runner, script và `deploy.sh` đã cập nhật (FR-08, FR-21).
- [ ] Mã khách hiện ngay cạnh SĐT trong danh sách (bảng desktop và thẻ mobile/PWA) và ở đầu màn xem chi tiết khách, ở mọi vai trò, kể cả khách không có SĐT; tìm được theo mã; Admin/Manager thấy thêm cột Người chăm sóc chính (có nhãn "đã khóa" khi tài khoản bị khóa) và lọc được theo người chăm sóc chính; Nhân viên không có cột và bộ lọc người chăm sóc chính; hiển thị đúng ở desktop và mobile/PWA (FR-09).
- [ ] Nhân viên, Manager, Admin tạo khách đều thành PRIMARY của khách đó; gửi `careTeam`/primary người khác khi tạo bị từ chối hoặc bỏ qua theo thiết kế (FR-10).
- [ ] `PUT .../care-team/primary` bị khóa; gỡ PRIMARY bị chặn (kể cả hàng loạt); thêm/gỡ MEMBER vẫn được; khách cũ có PRIMARY không bị ép sửa; khách cũ primary null cho Admin/Manager đặt đúng một lần rồi khóa; bulk `ASSIGN` chỉ thêm MEMBER (FR-11).
- [ ] Không còn 3 endpoint `/crm/care-team-requests`, collection/mã lỗi/rate-limit/thông báo/FE của luồng xin tham gia (FR-12).
- [ ] Nhân viên (PRIMARY) tìm và mời được Manager/Nhân viên ACTIVE ở nhóm khác; người bị khóa hoặc sai vai trò bị từ chối; danh sách chỉ trả dữ liệu tối thiểu, không có email/SĐT/CCCD (FR-13, FR-14).
- [ ] Người được mời nhận thông báo `CUSTOMER_ASSIGNED`, xem được hồ sơ, xem SĐT có audit `PHONE_VIEWED`; Manager nhóm người được mời thấy khách (hành vi đã chấp nhận, mục 8) (FR-15, FR-16).
- [ ] Tài khoản bị khóa không nhận thông báo/push; PRIMARY bị khóa vẫn giữ trên khách; mở khóa lại hoạt động bình thường; việc hằng ngày của khách có PRIMARY khóa/null hiện cho mọi thành viên chăm sóc ACTIVE (FR-18, FR-19).
- [ ] `deploy.sh` không còn khối bước 8c; bù mã danh mục v1.0.4 chạy qua script riêng với hành vi y như cũ (chạy mọi lần deploy, bỏ qua khi downgrade có chủ ý, lỗi thì ghi log, in cảnh báo đỏ và deploy thất bại); `scripts/tests/deploy-catalog-codes.test.sh` và tài liệu triển khai đã cập nhật (FR-23).
- [ ] Test BE integration M1–M5/deletion/qa đã viết lại, chạy xanh; unit test BE/FE đủ; tài liệu 04, 05, 06, 09 phản ánh đúng quy tắc mới; `qa-agent` không còn lỗi Critical/High (FR-22).

## 7. Câu hỏi còn mở

> Chỗ mơ hồ/thiếu thông tin và các giả định cần Oniichan xác nhận, chưa được trả lời. `/spec-clarify` hỏi từng câu một, rồi chuyển câu đã trả lời sang mục 8 và xóa khỏi đây. Mục này "rỗng" khi không còn dòng câu hỏi thật nào (dòng trống `1.` của mẫu không tính).

1.

## 8. Làm rõ

> Ghi lại đáp án đã chốt: `- (YYYY-MM-DD) Hỏi: … → Đáp: … (ảnh hưởng FR-xx)`.

Quyết định đã chốt bởi Oniichan trước khi lập Plan (không phải câu hỏi mở):

- (2026-11-10) Bỏ check trùng SĐT; SĐT không bắt buộc (chỉ họ tên bắt buộc); bỏ unique index `phone`, bỏ `CUSTOMER_PHONE_DUPLICATED`, bỏ `phone-lookups`, bỏ banner FE, giữ index `phone` thường (ảnh hưởng FR-01 đến FR-06, FR-20, FR-21).
- (2026-11-10) Mã khách tự sinh, đảo quyết định #2 cũ; một dãy chung, counter nguyên tử trong transaction, unique index, không tái sử dụng, migration bù mã theo `createdAt`; mã hiện cạnh SĐT ở danh sách và ở chi tiết cho mọi vai trò, Admin/Manager còn thấy cột Người chăm sóc chính (nhãn "đã khóa"), lọc theo người chăm sóc chính, tìm theo mã. Định dạng `KH-000123` chốt ở phần dưới (ảnh hưởng FR-07, FR-08, FR-09).
- (2026-11-10) Người tạo = PRIMARY, không đổi; bỏ tạo hộ; khóa `PUT .../care-team/primary`; chặn gỡ PRIMARY; vẫn thêm/gỡ MEMBER; khách cũ không ép sửa (ảnh hưởng FR-10, FR-11).
- (2026-11-10) Nghỉ việc/bị khóa: chỉ khóa tài khoản, không xóa; Admin/Manager mời người khác chăm sóc phụ; PRIMARY bị khóa giữ nguyên; thông báo không gửi cho tài khoản bị khóa (ảnh hưởng FR-18, FR-19).
- (2026-11-10) Bỏ hẳn luồng xin tham gia nhóm chăm sóc X2 (3 endpoint, collection, mã lỗi, rate-limit, thông báo, FE) (ảnh hưởng FR-12).
- (2026-11-10) Chia sẻ khách = mời: phụ trách chính (kể cả Nhân viên) mời thành viên phụ qua `POST /crm/customers/:id/care-team/members`, được mời cả người không cùng nhóm; người được mời ACTIVE, vai trò Manager/Nhân viên; Manager trong nhóm mình quản lý, Admin không giới hạn; phần Manager sau đó được mở rộng, xem bên dưới (ảnh hưởng FR-13 đến FR-16).

Đáp án làm rõ (`/spec-clarify`, 2026-11-10). Năm câu đầu **Oniichan trả lời trực tiếp**; chín câu sau **Neptune tự chốt theo phương án đề xuất** vì Oniichan bảo "chốt các vấn đề đi" (các câu này không đổi FR đã chốt); Oniichan có thể đổi lại bất cứ lúc nào:

Oniichan trả lời:

- (2026-11-10) Hỏi: Admin có đứng tên PRIMARY được không? → Đáp: **Cho phép**: Admin tạo khách thì Admin là PRIMARY (mở quyền cho Admin thuần, hiện code chỉ cho Manager/Nhân viên). Khách chỉ có Admin trong nhóm chăm sóc có thể có `teamIds` rỗng (ảnh hưởng FR-10, FR-09).
- (2026-11-10) Hỏi: Việc hằng ngày/nhắc lịch của khách có PRIMARY bị khóa hoặc null rơi vào đâu? → Đáp: **Mọi thành viên chăm sóc ACTIVE** (PRIMARY lẫn MEMBER) nhận việc và nhắc lịch; bộ lọc "của tôi" tính theo mọi thành viên `careTeam` đang ACTIVE (ảnh hưởng FR-18, FR-19).
- (2026-11-10) Hỏi: Manager của nhóm người được mời có thấy khách không? → Đáp: **Chấp nhận**, giữ cách tính `teamIds` = hợp nhóm của các thành viên (ảnh hưởng FR-15).
- (2026-11-10) Hỏi: Danh sách người được mời cho Nhân viên lấy từ đâu? → Đáp: **Toàn hệ thống, hiện tên hiển thị kèm tên nhóm**; không lộ email/SĐT/CCCD (ảnh hưởng FR-14).
- (2026-11-10) Hỏi: Quy tắc "PRIMARY không đổi" với khách cũ chưa có PRIMARY hoặc primary ≠ người tạo? → Đáp: **Đặt một lần cho khách chưa có PRIMARY**: Admin/Manager được đặt PRIMARY đúng một lần cho khách primary null, sau đó khóa; khách đã có PRIMARY (kể cả ≠ người tạo) thì bất biến (ảnh hưởng FR-11).
- (2026-11-10) Hỏi: Deploy v1.0.4 lên production trước rồi mới v1.0.5, hay gộp? → Đáp: **Gộp một lần deploy** (Oniichan). Hệ quả: migration 007–009 và 010+ chạy cộng dồn từ v1.0.3; thêm hai yêu cầu cho FR-21 (unique index mã dạng partial; script bù mã riêng gọi sau `up`) và hai rủi ro 12, 13; bước bỏ unique `phone` tách riêng, chạy cuối (ảnh hưởng FR-20, FR-21).
- (2026-11-10) Hỏi: Bước bù mã khách đặt ở đâu? → Đáp: **Tách thành một script riêng**, không viết cụ thể trong `deploy.sh`; script chỉ hoạt động khi chạy migration v1.0.5 (Oniichan). Neptune chốt cách kích hoạt: `deploy.sh` chỉ có một điểm gọi chung sau khi backend sống; script tự kiểm sổ migration, 010 đã áp dụng mới bù, chưa thì thoát 0. Kiểm theo sổ chứ không theo "lần chạy này" để deploy chạy lại sau khi `up` lỗi vẫn bù được khách tạo trong khoảng trống (ảnh hưởng FR-21, rủi ro 12).
- (2026-11-10) Hỏi: Có tách luôn bước 8c bù mã danh mục của v1.0.4 khỏi `deploy.sh` không? → Đáp: **Có, tách thành script riêng** (Oniichan). Neptune chốt: làm trong Plan v1.0.5 vì deploy gộp, hành vi giữ nguyên, dùng chung điểm gọi hậu-migrate với script bù mã khách (ảnh hưởng FR-21, FR-23, rủi ro 14).
- (2026-11-10) Hỏi: Giao diện hiện mã khách ở đâu? → Đáp: **Hiện mã khách ngay bên cạnh SĐT** trong danh sách, và **màn xem chi tiết khách cũng hiện mã khách** (Oniichan). Neptune chốt áp dụng cho mọi vai trò (không còn tách "cột Mã chỉ Admin/Manager"); chỉ cột và bộ lọc Người chăm sóc chính còn dành riêng cho Admin/Manager (ảnh hưởng FR-09).
- (2026-11-10) Hỏi: Nhập/xuất khách sửa thế nào ở v1.0.5? → Đáp: **Không sửa gì**; nhập/xuất khách chỉ là mock, không bàn đến (Oniichan). FR-05 bỏ khỏi phạm vi; quy tắc import về cột mã, `duplicatePolicy`, PRIMARY khi import không còn trong Plan (ảnh hưởng FR-05, FR-09, FR-10).
- (2026-11-10) Hỏi: Tìm theo mã có cho gõ số trần không? → Đáp: **Không**; phải gõ tiền tố `KH` (`KH-000123`, `kh123`), từ khóa toàn số vẫn là tìm SĐT (Oniichan xác nhận đề xuất của Kiến trúc) (ảnh hưởng FR-09).
- (2026-11-10) Hỏi: Bản sao dump production cho staging xử lý dữ liệu cá nhân thế nào? → Đáp: **Làm theo đề xuất**: giữ nguyên dữ liệu, chỉ lưu cục bộ trong `.staging/`, xóa sau khi diễn tập (Oniichan) (ảnh hưởng FR-21).
- (2026-11-10) Hỏi: Sửa câu chữ FR-08 cho khớp FR-21? → Đáp: **Đồng ý**: index partial tạo trước ở migration 010, bù mã chạy sau khi backend sống (Oniichan) (ảnh hưởng FR-08).
- (2026-11-10) Hỏi: Có giữ bản chuyển tiếp cho PWA bản cũ rồi xóa ở v1.0.6 không? → Đáp: **Bỏ hết ngay trong v1.0.5** (Oniichan); xóa `phone-lookups`, `PUT primary`, `assignable-users`, field `careTeam` khi tạo và 3 endpoint `care-team-requests`; máy còn PWA cũ phải tải lại sau deploy (ảnh hưởng FR-03, FR-12, FR-20, rủi ro 2).
- (2026-11-10) Hỏi: Chấp nhận khoảng trống ngắn giữa `up` và bước bỏ unique `phone`, và sau đó không lùi image v1.0.3 (chỉ sửa tiến)? → Đáp: **Chấp nhận** (Oniichan). Neptune chốt cơ chế giữ như Plan: migration bỏ unique `phone` tách riêng, chạy cuối sau khi backend sống (ảnh hưởng FR-21, rủi ro 1, 12).
- (2026-11-10) Hỏi: Xử lý `care_team_requests` khi xóa vĩnh viễn/ẩn danh khách? → Đáp: **Làm theo đề xuất**: không xóa collection hay dữ liệu; giữ file schema và đoạn dọn dẹp ở hai service purge/ẩn danh (Oniichan) (ảnh hưởng FR-12).

Neptune tự chốt (mặc định đề xuất, chưa phải lời Oniichan):

- (2026-11-10) Hỏi: Định dạng mã khách? → Đáp: **`KH-000123`**, tiền tố `KH-`, 6 chữ số, vượt 999.999 thì mở rộng thêm chữ số tự nhiên (`KH-1000000`) (ảnh hưởng FR-07, FR-08).
- (2026-11-10) Hỏi: Import khách thì ai là PRIMARY? → Đáp: **Người thực hiện import**; file không có cột "người chăm sóc" (phần import đã bị thay: nhập/xuất khách bỏ khỏi phạm vi, xem mục Làm rõ cuối; ảnh hưởng FR-10).
- (2026-11-10) Hỏi: Thao tác hàng loạt `ASSIGN`? → Đáp: **Chỉ thêm MEMBER**, không đặt/đổi PRIMARY; Admin/Manager vẫn dùng hàng loạt để mời (ảnh hưởng FR-11, FR-13).
- (2026-11-10) Hỏi: Dữ liệu/thông báo của luồng xin tham gia đã có? → Đáp: **Không xóa dữ liệu** (không hoàn tác được): giữ nguyên collection `care_team_requests` chỉ để đối chiếu, không còn code dùng; thông báo cũ vẫn xem được nhưng không còn hành động; xóa collection để bản sau do Oniichan quyết (ảnh hưởng FR-12).
- (2026-11-10) Hỏi: Dữ liệu cũ `anonymized:<id>`? → Đáp: **Chuyển về `phone = null`**, idempotent (ảnh hưởng FR-06, FR-21).
- (2026-11-10) Hỏi: Manager mời người có giới hạn nhóm không? → Đáp: **Đồng bộ với phụ trách chính**: Manager cũng mời được người ngoài nhóm mình quản lý; Admin không giới hạn (ảnh hưởng FR-13).
- (2026-11-10) Hỏi: Thành viên phụ có tự rời khách không? → Đáp: **Giữ như hiện tại**: chỉ PRIMARY/Manager/Admin gỡ thành viên phụ, thành viên phụ không tự rời (ảnh hưởng FR-11, FR-13).
- (2026-11-10) Hỏi: Giới hạn mời? → Đáp: **Tối đa 10 thành viên phụ mỗi khách** và rate-limit mời 30 lần/phút/người; FR-17 nâng thành "Nên có" (ảnh hưởng FR-17).
- (2026-11-10) Hỏi: Mã khách ở màn Nhân viên? → Đáp: **Có** ở màn chi tiết và ô tìm kiếm tìm theo mã; phần "cột Mã chỉ cho Admin/Manager" đã bị thay bằng quyết định sau cùng của Oniichan ngay dưới: mã hiện cạnh SĐT ở danh sách cho mọi vai trò (ảnh hưởng FR-09).
- (2026-11-10) Thay `assignable-users` (bị xóa theo FR-20): mời/gán người dùng endpoint mới `care-team-invitees`; ô lọc "Người phụ trách" dùng endpoint mới `customer-assignees` (người trong nhóm chăm sóc của các khách mình được thấy). Không đổi FR; ô lọc của Nhân viên đổi nguồn từ "người cùng nhóm" sang nguồn này (ảnh hưởng FR-09, FR-14, FR-20).

---

Tài liệu liên quan: `06_Module_Customer_Management/04_Tai_Lieu_Ky_Thuat_Module_Quan_Ly_Khach_Hang.md` (mục 3.2, 4.2, 6.1, 11), `06_Module_Customer_Management/05_Danh_Sach_API_Module_Quan_Ly_Khach_Hang.md`, `06_Module_Customer_Management/06_Theo_Doi_Milestone_Module_Quan_Ly_Khach_Hang.md`, `06_Module_Customer_Management/09_Bo_Sung_Sua_Doi_Tinh_Nang.md`, `08_Quan_Ly_Phien_Ban/03_Ke_Hoach_v1.0.4.md`
