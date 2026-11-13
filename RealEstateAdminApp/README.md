# RealEstateAdminApp

Ứng dụng web quản trị của hệ thống STND: quản lý tin tức bất động sản (thu thập, duyệt, đăng WordPress), bài kiến thức, cấu hình AI, nhật ký gọi dịch vụ ngoài, quản lý người dùng, và module **Quản lý khách hàng (CRM)** tại `/crm/*`. Ứng dụng cài được như PWA (không dùng offline cho dữ liệu).

Công nghệ: React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, Zustand, react-hook-form + zod. Kiểm thử bằng Vitest (đơn vị) và Playwright (E2E). Giao diện gọi API của `RealEstateBackendApp` (NestJS).

## Chạy thử cục bộ

Yêu cầu: Node.js 24.18.1 (khớp `.nvmrc` và Dockerfile), đã chạy `npm install` trong thư mục này.

```bash
cd RealEstateAdminApp
cp .env.example .env     # chỉnh biến VITE_* nếu cần (xem mục "Biến môi trường")
npm run dev              # chạy cùng lúc Vite (FRONT) và backend NestJS (BACK, ../RealEstateBackendApp)
```

Vite chuyển tiếp `/api` tới `http://localhost:3000` (xem `vite.config.ts`). Chỉ muốn chạy giao diện: `npx vite`.

## Lệnh thường dùng

| Lệnh | Việc làm |
|---|---|
| `npm run dev` | Dev server giao diện + backend |
| `npm run build` | `tsc -b` (kiểm kiểu) rồi `vite build` ra `dist/` |
| `npm run preview` | Chạy thử bản đã build |
| `npm test` | Vitest, chạy một lần toàn bộ test đơn vị |
| `npm run test:watch` | Vitest chế độ theo dõi |
| `npm run lint` | oxlint |
| `npm run e2e` | Playwright E2E trên stack cô lập tự dựng (xem `e2e/README.md`) |
| `npm run typecheck:e2e` | Kiểm kiểu mã E2E (`tsc -b` của app không phủ thư mục `e2e/`) |

Lưu ý: nếu Vitest báo `localStorage.clear is not a function` thì Node đang bật Web Storage thử nghiệm và che mất bản của jsdom; chạy với `NODE_OPTIONS=--no-experimental-webstorage`.

## Cấu trúc thư mục `src/`

```text
App.tsx, main.tsx       Khai báo route, điểm vào ứng dụng
screens/                Màn đăng nhập, quản lý người dùng (màn tin tức nằm ở modules/news/screens)
components/             Thành phần dùng chung (auth, ui, common, header, users)
layout/                 Khung trang: sidebar, header, AppLayout
api/                    Hàm gọi backend (axios)
context/, stores/       Theme, sidebar (context) và Zustand store (Provider tin tức nằm ở modules/news/context)
hooks/                  Hook dùng chung (useAuth, useDebouncedValue ...)
icons/                  Bộ icon svg và index.ts (nhập bằng `?react`)
pwa/                    Service worker, nhắc cập nhật, đăng ký thông báo đẩy
modules/crm/            Module Quản lý khách hàng (alias `@crm/*`), có CrmLayout, api, store, screens riêng
modules/news/           Module tin tức/crawl (alias `@news/*`): screens, api, context, hooks, components/google-drive
types/, utils/          Kiểu dùng chung và hàm tiện ích
```

## Biến môi trường

Mọi biến `VITE_*` mà mã nguồn đọc được liệt kê và giải thích trong `.env.example`. Vite nhúng biến vào bundle lúc build/khởi động, nên đổi `.env` thì phải chạy lại dev server, và không được đặt bí mật vào biến `VITE_*`. Một số cờ CRM (ví dụ `VITE_FEATURE_CRM_ATTACHMENTS`) phải khớp cờ cùng tên ở backend.

## Triển khai

`Dockerfile` build bản tĩnh bằng `npm run build` rồi phục vụ qua Nginx (`nginx.conf`). Quy trình triển khai và vận hành nằm ở `docs/01_Infrastructure/06_Production_Deploy.md`.

## Tài liệu liên quan

- `docs/README.md`: mục lục tài liệu của cả hệ thống.
- `docs/06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md`: quy tắc giao diện và design system.
- `docs/01_Infrastructure/`: hạ tầng, triển khai, sơ đồ CI/CD và cấu trúc thư mục.
- `e2e/README.md`: cách chạy và đọc kết quả bộ E2E.
