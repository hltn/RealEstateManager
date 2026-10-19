# Raw Articles: Giữ lựa chọn khi phân trang

## Mục tiêu

Thêm hành vi **giữ lựa chọn khi phân trang** cho màn `RawArticlesScreen`, cho phép người dùng chọn bản ghi ở nhiều trang khác nhau và tiếp tục giữ các lựa chọn đó khi đổi trang, search, sort, date filter hoặc page size.

## Phạm vi

Trong scope:

- Persist selection trong vòng đời component `RawArticlesScreen`.
- Selection được lưu theo `_id` của raw article.
- Checkbox từng dòng và checkbox chọn tất cả trên trang hiện tại phản ánh đúng selection đã lưu.
- Bulk action sử dụng toàn bộ selection hiện có, không chỉ các bản ghi đang hiển thị.
- Clear selection sau các mutation ghi thành công để tránh thao tác nhầm trên dữ liệu đã thay đổi.

Ngoài scope:

- Không persist selection sau khi rời màn hình rồi quay lại.
- Không thêm global store/context mới.
- Không đổi API backend.

## Thiết kế đề xuất

### State selection

Đổi `selectedIds` từ `string[]` sang `Set<string>` trong `RawArticlesScreen` để đồng bộ với pattern ở `ManageWpScreen` và tránh thao tác `includes/filter` lặp lại.

Selection không bị reset khi:

- đổi trang;
- đổi search;
- đổi sort;
- đổi date range;
- đổi page size.

Selection chỉ bị clear khi:

- bulk mutation thành công;
- mutation ghi làm thay đổi danh sách và cần refresh an toàn;
- người dùng bỏ chọn thủ công hoặc bỏ chọn toàn bộ các item trên trang hiện tại.

### Pagination và filter flow

Khi `filterSignature` đổi, màn hình vẫn reset `page` về `1` để tránh gọi API với page cũ không hợp lệ, nhưng không gọi `setSelectedIds(new Set())`.

`changePage(nextPage)` chỉ gọi `setPage(nextPage)`, không clear selection.

### Checkbox flow

- Checkbox từng dòng checked khi `selectedIds.has(article._id)`.
- `isAllOnPageSelected` true khi trang hiện tại có item và mọi item trên trang đều nằm trong `selectedIds`.
- `toggleSelectAllOnPage`:
  - nếu toàn bộ item trang hiện tại đã được chọn, chỉ remove ID của trang hiện tại;
  - nếu chưa, merge ID của trang hiện tại vào selection hiện có.

### Bulk action flow

Các handler bulk action lấy ID từ `Array.from(selectedIds)`. UI hiển thị tổng số selected bằng `selectedIds.size`.

Sau khi bulk action thành công, clear selection để tránh giữ ID của các bản ghi đã bị xóa hoặc thay đổi trạng thái.

## Error handling

Không thay đổi error handling hiện có. Nếu mutation lỗi, giữ nguyên selection để người dùng có thể retry mà không cần chọn lại.

## Testing / verification

Cần kiểm tra thủ công hoặc test tương đương các case sau:

1. Chọn bản ghi ở trang 1, chuyển sang trang 2, chọn thêm bản ghi, quay lại trang 1 vẫn thấy checked.
2. Chọn bản ghi rồi đổi search/sort/date filter/page size, selection count vẫn giữ.
3. Chọn tất cả trên trang hiện tại không làm mất selection ở trang khác.
4. Bỏ chọn tất cả trên trang hiện tại chỉ bỏ các ID của trang đó.
5. Bulk action thành công thì selection được clear.
6. Bulk action lỗi thì selection vẫn giữ để retry.

## Rủi ro và giới hạn

- Vì chỉ lưu `_id`, UI không thể hiển thị chi tiết các bản ghi đã chọn nếu chúng không nằm trên trang hiện tại. Đây là chấp nhận được cho scope hiện tại.
- Nếu backend xóa bản ghi ngoài luồng trong khi màn hình đang mở, selection có thể còn chứa ID cũ cho đến khi mutation hoặc thao tác tiếp theo xử lý. Không thêm API kiểm tra tồn tại trong scope này.
