# Kế hoạch: Knowledge Articles — Auto-Write & Publish to WordPress

> Ngày tạo: 2026-08-16
> Module: knowledge-articles (mới) + settings (mở rộng)
> Trạng thái: Draft
> Author: Neptune (PM)

---

## 1. Scope

### 1.0. DB Design: Gộp vào `news-articles`

Sử dụng chung collection `news-articles`, phân tách bằng field `type`:

| Type | Mô tả | Schema fields |
|------|-------|---------------|
| `news` | Bài viết tin tức (tính năng hiện có) | title, content, source, publishedDate, isPublished... |
| `knowledge` | Bài viết kiến thức (tính năng mới) | + promptTemplate, wpPostId, articleStatus, category, tags, aiWritingConfig, imageConfig |

**Phân tách:**
- `type: 'knowledge'` → dùng cho Knowledge Articles feature
- `type: 'news'` (default) → dùng cho tính năng news hiện có
- Query: `find({ type: 'knowledge' })` hoặc `find({ type: 'news' })` — không xung đột
- Existing news features giữ nguyên, KHÔNG bị ảnh hưởng

### 1.1. In-scope

| # | Feature | Mô tả |
|---|---------|-------|
| F2 | Tab Knowledge Articles | UI tab quản lý danh sách bài viết (list + detail view) |
| F3 | AI Prompt Config | Section cấu hình prompt template viết bài |
| F4 | Image Generation Config | Section cấu hình AI sinh ảnh (linh hoạt, tách riêng, provider/model/API key) |
| F5 | WP Connection Config | Section cấu hình kết nối WP (REST API URL, app password) + mapping category/tags |
| F6 | NL Cron Job | User viết NL → AI phân tích → preview → confirm → activate |
| F7 | Auto Pipeline | Batch: pick topic → AI writing → AI image → upload media → post WP |
| F8 | Category Rotation | Batch N bài cùng category, rotate theo ngày giữa các categories |
| F9 | Manual Controls | Retry, Publish, Republish bài viết từ Tab Knowledge Articles |
| F10 | Pipeline Log | Log viewer hiển thị progress pipeline + trace log (trạng thái, thời gian, lỗi) |

### 1.2. Out-of-scope

- Review/approval flow trước khi đăng
- Multi-site WordPress
- SEO optimization nâng cao
- Analytics sau khi đăng
- AI orchestration layer (code cứng pipeline)
- Thay đổi tính năng news hiện tại

---

## 2. Task Breakdown

| # | Task | Agent | Phụ thuộc | Ước lượng |
|---|------|-------|-----------|-----------|
| 1 | **Research & Architecture** — architect nghiên cứu WP REST API, AI integration patterns, pipeline log design, thiết kế module | architect-agent | — | 45 phút |
| 2 | **Backend: DB Schema + Config Endpoints** — schema cho knowledge articles, WP config, AI config, NL cron config. Config endpoints CRUD | coder-backend | Card 1 | 40 phút |
| 3 | **Backend: AI Writing + Image Services** — AI writing service (prompt → content), AI image service (prompt → image upload), WP upload service | coder-backend | Card 2 | 50 phút |
| 4 | **Backend: Auto Pipeline + NL Cron** — batch pipeline logic, NL→cron parsing, cron job runner, category rotation, pipeline log tracking (trạng thái + thời gian + lỗi) | coder-backend | Card 3 | 60 phút |
| 5 | **Frontend: Tab Knowledge Articles + Configs** — Tab list/detail, manual controls (retry/publish/republish), AI prompt config, image gen config, WP connection config, NL cron UI, log viewer | coder-frontend | Card 1 | 60 phút |
| 6 | **QA Review** | qa-agent | Card 4 + Card 5 | 20 phút |

---

## 3. Timeline

```
Card 1 (Research)                45 phút
    ↓
Card 2 (Schema + Config)       40 phút
    ↓
Card 3 (AI + WP Services)        50 phút  ← chờ Card 2
    ↓
Card 4 (Pipeline + NL Cron)      60 phút  ← chờ Card 3
    ↓
Card 5 (Frontend UI)             60 phút  ← chờ Card 1, song song với BE
    ↓
Card 6 (QA)                      20 phút  ← chờ Card 4 + Card 5

Tổng ước lượng: ~5.5 tiếng (tính cả research + QA)
```

---

## 4. Task Scheduling (Dependencies)

```
Card 1 (Research) → Card 2 (Schema) → Card 3 (Services) → Card 4 (Pipeline)
                         │                                           │
                         └────────── Card 5 (FE) ───────────────────┘
                                                                │
                                                           Card 6 (QA)
```

- Card 5 (FE) chỉ chờ Card 1 xong, chạy song song với BE
- Card 6 (QA) chờ cả Card 4 (BE pipeline) và Card 5 (FE UI) xong

---

## 5. Resources

| Agent | Cards | Tổng thời gian |
|-------|-------|----------------|
| architect-agent | Card 1 | 45 phút |
| coder-backend-agent | Card 2, 3, 4 | 150 phút |
| coder-frontend-agent | Card 5 | 60 phút |
| qa-agent | Card 6 | 20 phút |

---

## 6. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| WP REST API có rate limit | Medium | Implement retry + backoff, batch upload |
| AI writing output không consistent | Medium | Prompt template phải có hướng dẫn chi tiết, QA test output quality |
| NL→cron parsing sai | High | User confirm preview trước khi activate |
| AI image generation API thay đổi | Medium | Abstract layer, linh hoạt provider trong config |
| WP categories/tags sync issue | Medium | Mapping manual, không auto-sync |
| Pipeline log quá lớn | Low | TTL index hoặc pagination, log cleanup policy |

---

## 7. Article States

```
pending → generating_content → content_ready → generating_image → ready → publishing → published
    ↓              ↓                ↓                ↓                        ↓
  failed          failed           failed           failed                 failed
    │              │                │                │                        │
    └──────────── retry ─────────────────────────────────────────────────────┘
```

- `pending` — topic đã pick, chưa bắt đầu
- `generating_content` — AI đang viết bài
- `content_ready` — bài viết xong, chưa có ảnh
- `generating_image` — AI đang sinh ảnh
- `ready` — bài viết + ảnh xong, sẵn sàng đăng
- `publishing` — đang đăng lên WP
- `published` — đã đăng thành công
- `failed` — lỗi ở bất kỳ step nào (hiển thị error + cho phép retry)

---

## 8. Manual Controls

| Action | State hiện tại | Hành động |
|--------|---------------|-----------|
| **Retry** | `failed` | Quay lại step bị lỗi, regenerate |
| **Publish** | `ready` | Đăng bài mới lên WP |
| **Republish** | `published` | Update bài đã đăng trên WP (cùng WP post ID) |

---

## 9. Pipeline Log Design

Log được lưu trong quá trình thực hiện Cron Job, hiển thị trong tab cron job config:

- Tổng số bài trong batch: 5
- Thành công: 3
- Thất bại: 2
- Chi tiết từng bài: title, status, error (nếu có), duration

---

## 10. Acceptance Criteria

### Card 1 (Research)
- [ ] Xác định WP REST API endpoints cần dùng
- [ ] Xác định AI integration pattern (writing + image)
- [ ] Module structure + schema design
- [ ] Pipeline log design (trạng thái + thời gian + lỗi)

### Card 2 (Schema + Config)
- [ ] Knowledge article schema: content, status, images, WP post ID
- [ ] WP config schema, AI config schema
- [ ] Config endpoints CRUD hoạt động
- [ ] Unit tests pass

### Card 3 (AI + WP Services)
- [ ] AI writing service: prompt → article content
- [ ] AI image service: prompt → image upload to WP
- [ ] WP upload service: upload media + create post + update post
- [ ] Pipeline log tracking (trạng thái + thời gian + lỗi)
- [ ] Unit tests pass

### Card 4 (Pipeline + NL Cron)
- [ ] Batch pipeline: pick topic → writing → image → upload → post
- [ ] NL → cron config parsing (AI-powered)
- [ ] Category rotation: batch N bài cùng category, rotate theo ngày
- [ ] Cron job runner hoạt động
- [ ] Pipeline log recording chi tiết (status, duration, error)
- [ ] Unit tests pass

### Card 5 (Frontend UI)
- [ ] Tab Knowledge Articles: list + detail view
- [ ] Manual controls: Retry (state=failed), Publish (state=ready), Republish (state=published)
- [ ] AI Prompt Config section
- [ ] Image Generation Config section (tách riêng, linh hoạt)
- [ ] WP Connection Config section
- [ ] NL Cron Job UI: input NL → preview → confirm → activate
- [ ] Log viewer: hiển thị progress pipeline + trace log (trạng thái, thời gian, lỗi)
- [ ] Unit tests pass

### Card 6 (QA)
- [ ] All tests pass
- [ ] No critical/major findings
- [ ] Code review OK
