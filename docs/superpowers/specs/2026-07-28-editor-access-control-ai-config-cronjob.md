# Spec: Editor access control for AI Config, AI Prompt Config, and Cronjob

## Mục tiêu

Siết quyền để `EDITOR` không thể truy cập hoặc thao tác trên các màn và API sau:

- AI Config
- AI Prompt Config
- Cronjob

Chỉ `ADMIN` được xem, sửa và gọi các API liên quan. `EDITOR` vẫn giữ quyền với các khu vực khác của admin app.

## Phạm vi

### Frontend

1. Ẩn các menu sau khỏi sidebar khi user là `EDITOR`:
   - `AI Config`
   - `AI Prompt Config`
   - `Cronjob`

2. Chặn trực tiếp các route sau bằng `RoleGuard`:
   - `/ai-config`
   - `/ai-prompt-config`
   - `/cronjob`

3. Khi `EDITOR` vào thẳng URL, hiển thị thông báo không có quyền truy cập thay vì render màn hình thật.

### Backend

Gắn role guard `ADMIN only` cho toàn bộ API thuộc các màn trên:

- `GET /settings/ai-config`
- `POST /settings/ai-config`
- `GET /settings/openrouter-models`
- `GET /news-manager/prompts`
- `PUT /news-manager/prompts`
- `GET /news-manager/cron`
- `POST /news-manager/cron`

## Quyết định kiến trúc

- Không tạo role mới.
- Không thay đổi schema database.
- Không đổi contract response hiện có.
- Không làm Cronjob public; Cronjob cũng chỉ dành cho `ADMIN`.
- Bảo mật phải được enforced ở backend trước, frontend chỉ là lớp UX bổ sung.

## Luồng xử lý mong muốn

1. User login và nhận `role` từ backend.
2. Frontend đọc `user.role`.
3. Nếu role là `EDITOR`:
   - Sidebar không hiển thị 3 menu trên.
   - Route vào trực tiếp bị chặn.
   - Nếu cố gọi API, backend trả `403 Forbidden`.
4. Nếu role là `ADMIN`:
   - Sidebar hiển thị đầy đủ.
   - Route và API hoạt động bình thường.

## Kiểm thử bắt buộc

### Backend

Cần có unit test để xác nhận:

- Các handler bị giới hạn đúng role `ADMIN`.
- Người dùng role `EDITOR` không được đi qua guard cho các endpoint nêu trên.

Ưu tiên cập nhật các test hiện có:

- `settings.controller.spec.ts`
- `news-fire-crawl-manager.controller.spec.ts`

### Frontend

Nếu test harness hiện tại hỗ trợ render route/component dễ dàng, thêm test để xác nhận:

- Sidebar không render menu config/cron cho `EDITOR`.
- `RoleGuard` chặn đúng các route config/cron.

Nếu không có sẵn infra phù hợp, backend test vẫn là bắt buộc; frontend có thể verify thủ công nhưng vẫn nên thêm khi chi phí thấp.

## Tiêu chí hoàn thành

- `EDITOR` không thấy 3 menu trên.
- `EDITOR` không vào được 3 route trên.
- `EDITOR` gọi API liên quan đều nhận `403`.
- `ADMIN` không bị ảnh hưởng.
- Test bảo vệ thay đổi quyền được thêm hoặc cập nhật.
