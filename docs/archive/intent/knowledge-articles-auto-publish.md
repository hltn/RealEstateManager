# Intent: Knowledge Articles — Auto-Write & Publish to WordPress

> Date: 2026-08-16
> Confirmed: Yes (Oniichan)
> Updated: 2026-08-16 — bỏ Import Topics, bỏ Per-article Pipeline Log

---

## Outcome

Hệ thống Knowledge Articles: tự động viết bài kiến thức → sinh ảnh → đăng lên WordPress. User cấu hình bằng ngôn ngữ tự nhiên, hệ thống tự chạy hàng ngày. Manual controls + log viewer để debug và linh hoạt.

## User

Admin/Editor — quản lý config settings, theo dõi bài đăng

## Why now

Tự động hóa quy trình viết + đăng bài, giảm manual work. Hiện tại không có hệ thống auto-generate + auto-publish.

## Success

1. User config AI writing + AI image + WP connection trong Settings
2. User cấu hình cron job bằng NL → AI chuẩn hóa → preview → confirm → activate
3. Cron job chạy hàng ngày: batch N bài cùng category → rotate categories theo ngày
4. Bài viết đầy đủ: content, featured image, inline images, category, tags → đăng lên WP
5. User có thể retry, publish, republish bài viết từ Tab Knowledge Articles
6. User xem được log pipeline khi cron job chạy

## Constraints

- 1 WordPress site
- 1 cron job = 1 batch generate N bài trong 1 category (same category per batch)
- Schedule linh hoạt theo tuần
- AI sinh ảnh config riêng, tách biệt với AI writing config (linh hoạt)
- Code cứng pipeline (AI chỉ đóng vai writing + image generation)

## In-scope

### Features

1. **Tab Knowledge Articles** — list + detail view
   - Nút **Retry** — regenerate content/images (linh hoạt check lỗi)
   - Nút **Publish** — đăng bài mới lên WP
   - Nút **Republish** — update bài đã đăng trên WP
2. **AI Prompt Config** — prompt template viết bài
3. **Image Generation Config** — cấu hình AI sinh ảnh (linh hoạt, tách riêng)
4. **WP Connection Config** — cấu hình kết nối WP + mapping category/tags
5. **Natural Language Cron Job** — user viết NL → AI phân tích → preview → confirm → activate
6. **Auto Pipeline (batch):** pick topic → AI writing → AI image → upload media → post WP
7. **Category Rotation** — batch N bài cùng category, rotate theo ngày
8. **Pipeline Log** — hiển thị trong tab cron job config: tổng số bài, thành công, thất bại, chi tiết từng bài

### Article States

- `pending` — topic đã pick, chưa bắt đầu
- `generating_content` — AI đang viết bài
- `content_ready` — bài viết xong, chưa có ảnh
- `generating_image` — AI đang sinh ảnh
- `ready` — bài viết + ảnh xong, sẵn sàng đăng
- `publishing` — đang đăng lên WP
- `published` — đã đăng thành công
- `failed` — lỗi ở bất kỳ step nào (hiển thị error + cho phép retry)

### Manual Controls

- **Retry:** Khi article ở state `failed` → click retry → quay lại step bị lỗi
- **Publish:** Khi article ở state `ready` → click publish → đăng lên WP
- **Republish:** Khi article ở state `published` → click republish → update bài trên WP

## Out-of-scope

- Import topics từ bên ngoài (Obsidian, v.v.)
- Review/approval flow trước khi đăng (full auto, nhưng có manual publish/republish)
- Multi-site WordPress
- SEO optimization nâng cao
- Analytics sau khi đăng
- AI orchestration layer (code cứng pipeline)
