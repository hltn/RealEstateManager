# Market Analysis Workflow — Mockup Thiết Kế

**File:** `docs/mockups/market-analysis-workflow-mockup.html`
**Ngày:** 2026-08-06
**Stack:** HTML5 + Tailwind CSS (CDN) + vanilla JS — standalone, không cần build

## Ý tưởng thiết kế

### Surface: Operate
Đây là một **Operate surface** (theo phân loại claude-design): người dùng kích hoạt pipeline và theo dõi tiến trình từng bước. Không có hero, không marketing — density và state clarity là ưu tiên số một.

### Bố cục (top → bottom)

| Row | Thành phần | Mô tả |
|-----|-----------|-------|
| 1 | **DatePicker + Button** | Input date (mặc định hôm nay) + nút "Phân tích" primary. Button disabled khi đang chạy, có icon tia sét (sparkle) gợi ý AI. |
| 2 | **Workflow visualization** | 5 step card nối bằng connector line ngang. Mỗi step 180px width, scroll ngang trên mobile. Step number trong circle có màu theo trạng thái. |
| 3 | **Kết quả phân tích** | White card với markdown content (tiếng Việt), scroll-y max 500px. Header có badge "Hoàn tất" + ngày. |
| 4 | **Lịch sử** | Table responsive: mobile giấu cột "Số bài viết" và "Trạng thái", tablet giấu cột "Trạng thái". Row hover highlight, clickable để xem lại kết quả. |

### 4 trạng thái step — hiển thị đồng thời trên mockup

| Trạng thái | Màu | Border | Icon | Hiệu ứng |
|-----------|------|--------|------|----------|
| **pending** | Xám (slate-200/300) | border-slate-200 | chấm tròn xám | Opacity 70%, text muted |
| **running** | Xanh lam (blue-400/500) | border-2 blue-400 | spinner CSS (0.7s rotate) | pulse-ring bao quanh card + connector chạy gradient |
| **done** | Xanh lá (green-200/500) | border-green-200 | check SVG xanh | Badge "Hoàn tất", connector chuyển xanh |
| **error** | Đỏ (red-300/500) | border-2 red-300 | X SVG đỏ | Error message đỏ dưới step label + connector dừng ở step lỗi |

### Connector giữa các step
- Line 2px nối từ phải card này sang trái card kế
- `done-connector`: line xanh cố định
- `running-connector`: gradient chạy từ xanh → xanh lam → xám (animation `connectorPulse` 1.5s)
- Pending: line xám

## Hiệu ứng đã dùng

| Hiệu ứng | Mô tả | CSS |
|----------|-------|-----|
| **Spinner** | Border-top xanh lam quay 360° | `@keyframes spin` 0.7s linear |
| **Pulse ring** | Box-shadow lan tỏa quanh card đang chạy | `@keyframes pulseRing` 2s ease-in-out |
| **Connector pulse** | Gradient background-position chạy qua lại | `@keyframes connectorPulse` 1.5s |
| **Reveal** | Slide-down + fade-in khi hiện kết quả/error | `@keyframes revealIn` 0.4s ease-out |
| **Toast** | Slide-up + fade từ bottom-right | transition opacity + translateY 0.3s |
| **Hover** | Row bảng chuyển nền xanh nhạt + cursor pointer | transition-colors 150ms |
| **DatePicker** | Calendar indicator đổi opacity khi hover | transition-opacity 0.2s |

Tất cả animation đều tôn trọng `prefers-reduced-motion: reduce`.

## Các nút Demo

4 nút toggle để xem tất cả trạng thái:

- **Demo: Đang chạy (step 3)** — Step 1-2 done, step 3 running (spinner + pulse), step 4-5 pending. Nút "Phân tích" bị disabled.
- **Demo: Lỗi (step 3)** — Row workflow riêng hiển thị step 1-2 done, step 3 error (đỏ + lỗi API timeout), step 4-5 greyed out.
- **Demo: Hoàn tất** — Hiển thị khu vực kết quả phân tích markdown bên dưới workflow.
- **Demo: Tất cả pending** — Reset về trạng thái chưa chạy.

## Bàn giao cho coder-frontend-agent

File này là **mockup tham khảo, không phải code thật**. Khi code thật:

1. **Workflow visualization:** 5 step card nằm ngang, responsive → trên mobile dùng scroll ngang (`overflow-x-auto`). Step hiện tại có `pulse-ring` (css animation hoặc framer-motion animate).
2. **Connector:** Dùng pseudo-element `::after` hoặc SVG path giữa các card. Khi step running → connector có hiệu ứng gradient chạy.
3. **Màu sắc:** Khớp với `tailwind.config.js` hiện tại: primary `#2563EB`, secondary `#1A237E`.
4. **DatePicker:** Dùng component date picker sẵn có của dự án (hoặc native `<input type="date">`). Mặc định `new Date()` format UTC+7.
5. **Kết quả:** Render markdown content từ `MarketAnalysisHistory.content` bằng thư viện markdown parser (react-markdown / marked).
6. **Provider pattern:** `MarketAnalysisWorkflowJobContext` gói trong `AppLayout.tsx`, poll mỗi 3s, survive tab-switch.
7. **History table:** Fetch bằng TanStack Query `useQuery(['market-analysis-history'])`, click row → hiển thị content lên khu vực kết quả.
