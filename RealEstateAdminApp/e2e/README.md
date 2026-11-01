# E2E Playwright cho CRM

Chạy giao diện thật (Chromium) trên một stack CÔ LẬP tự dựng và tự dọn bằng 1 lệnh. Không đụng stack dev.

```
cd RealEstateAdminApp
npm run e2e            # headless, chạy toàn bộ; đi qua wrapper e2e/run.mjs (lấy khóa chạy trước khi spawn Playwright)
npm run e2e:headed     # có cửa sổ trình duyệt
npm run typecheck:e2e  # kiểm kiểu mã E2E (tsc -b của app KHÔNG phủ thư mục e2e)
npm run lint           # oxlint: e2e/** chỉ tắt 2 quy tắc react/rules-of-hooks và no-empty-pattern (do fixture Playwright)

# Chạy một spec / một test
npm run e2e -- smoke                          # theo tên file (khớp một phần); mọi đối số sau `--` chuyển cho `playwright test`
npm run e2e -- e2e/specs/f2-customers.spec.ts
npm run e2e -- -g "tên test"                  # theo tiêu đề test

# Xem báo cáo HTML (thư mục RealEstateAdminApp/playwright-report; ảnh + trace khi lỗi)
npx playwright show-report playwright-report
```

Điều kiện: đã `npm install` ở cả `RealEstateAdminApp` và `RealEstateBackendApp` (thư viện mongodb-memory-server, ioredis, AWS SDK và Nest CLI lấy từ backend), `npx playwright install chromium`, Redis + MinIO dev đang chạy (`docker compose -f RealEstateBackendApp/docker-compose.dev.yml up -d`).

Thời gian (đo thật): dựng stack 25-40 giây; chạy đủ bộ khoảng 10-11 phút (69 test, mọi test xanh thật). Lần đầu tiên (hoặc khi mã nguồn backend đổi) có thêm bước build backend riêng, vài phút lần đầu (xem mục "Build backend riêng").

## Khuyết tật UX đã biết (`knownBug`)

Trước đây bộ có 12 test đánh dấu `test.fail` bằng hàm `knownBug` trong `e2e/fixtures.ts` (đỏ có chủ đích: mô tả đúng hành vi mong muốn khi giao diện còn lỗi). **Cả 12 lỗi UX đó đã được sửa (2026-10-26) và các test đã gỡ `knownBug`, nên hiện không test nào dùng nó: 67/67 test xanh thật.** Hàm `knownBug` và cờ `E2E_SHOW_BUGS` được giữ lại để ghi nhận khuyết tật mới phát hiện sau này:

- Test dùng `knownBug(testInfo, loại, lý do)` chạy thật và được kỳ vọng ĐỎ; Playwright coi "đỏ đúng kỳ vọng" là đạt. Khi lỗi được sửa, test "xanh bất ngờ" và Playwright báo FAIL: lúc đó bỏ dòng `knownBug` ở test đó. Mỗi test như vậy có annotation `bug` (loại + lý do) trong báo cáo HTML.
- `E2E_SHOW_BUGS=1 npm run e2e` (PowerShell: `$env:E2E_SHOW_BUGS=1; npm run e2e`) chạy các test `knownBug` như test thường để xem lỗi thật.
- Cách đọc kết quả: "N passed" nghĩa là không có hồi quy; "failed" nghĩa là có hồi quy mới HOẶC một khuyết tật đã sửa mà test `knownBug` chưa gỡ.
- Lưu ý: cờ `E2E_SHOW_BUGS` hiện chỉ kiểm có giá trị hay không nên `E2E_SHOW_BUGS=0` vẫn bật chế độ xem lỗi; để tắt hãy bỏ hẳn biến (đã đề xuất dùng `isTruthyFlag` từ `e2e/env.ts`).

## Build backend riêng (`.e2e-dist`)

E2E KHÔNG BAO GIỜ ghi vào `RealEstateBackendApp/dist` (dùng chung với backend dev cổng 3000, và `nest-cli.json` có `deleteOutDir: true` nên build thường sẽ xóa nó). Thay vào đó:

- Build ra `RealEstateBackendApp/.e2e-dist` (đã nằm trong `.gitignore`) bằng Nest CLI + swc với cấu hình riêng `e2e/backend-build/nest-cli.e2e.json` và `e2e/backend-build/tsconfig.e2e.json` (extends `tsconfig.build.json`, chỉ đổi `outDir`). `nest-cli.json` chung không bị sửa. Thư mục phải nằm trong thư mục backend để `node_modules` của backend được phân giải.
- Backend E2E chạy `node .e2e-dist/main.js` với cwd rỗng (không nạp `.env` dev).
- Build lại khi có file `.ts` (không tính `.spec.ts`), `.json` trong `src`, hoặc `package.json`/`tsconfig*.json`/`nest-cli.json`/cấu hình build riêng mới hơn dấu build `.e2e-dist/.e2e-build-stamp`. Còn mới thì bỏ qua build.
- `E2E_SKIP_BUILD=1` (hoặc `true`) bỏ qua build và dùng `.e2e-dist` hiện có (giá trị `0`/`false`/rỗng KHÔNG bật). Chưa có `.e2e-dist` thì báo lỗi.
- Sau build, mã tự kiểm `dist/main.js` không đổi mtime; có đổi thì ném lỗi.
- Muốn ép build lại: xóa thư mục `RealEstateBackendApp/.e2e-dist`.

## Stack E2E

| Thành phần | Dev (không bị động tới) | E2E |
|---|---|---|
| Backend | 3000 (`dist`) | **3100**, `FRONTEND_URL=http://localhost:5183`, chạy `node .e2e-dist/main.js` (build riêng) với cwd rỗng (không nạp `.env` dev) |
| Admin (Vite) | 5173 | **5183**, `VITE_API_URL` trỏ 3100 |
| MongoDB | container `mongodb`, DB `mongodb` | mongodb-memory-server **replica set**, DB `e2e`, cổng ngẫu nhiên, xóa khi xong |
| Redis | db 0 | **db 15** (flush đầu và cuối), tiền tố key `e2e:`; có thể dùng chung server Redis dev |
| MinIO | `crm-attachments`, `crm-exports` | bucket **`e2e-attachments`**, **`e2e-exports`** (tạo lúc đầu, xóa object + bucket lúc cuối) |

Cờ bật: `FEATURE_CRM_ENABLED`, `FEATURE_CRM_ATTACHMENTS`, `VITE_CRM_ENABLED`, `VITE_FEATURE_CRM_ATTACHMENTS`. Ép tắt dữ liệu mẫu của Vite dev: `VITE_CRM_MOCK_REPORTS=false`, `VITE_CRM_MOCK_IMPORT_EXPORT=false` (smoke có kiểm cờ này). AI/Firecrawl/Google để rỗng, crawler tắt. Mọi giá trị test nằm trong `env.ts` (an toàn để commit); `.env.e2e.example` chỉ liệt kê biến ghi đè tùy chọn.

## Tài khoản seed (chỉ tồn tại trong stack E2E, mật khẩu `Test@12345678`)

`admin.e2e@example.test` (ADMIN), `mgr1.e2e@example.test` (MANAGER, nhóm 1), `staff1.e2e@example.test` (STAFF, nhóm 1), `staff2.e2e@example.test` (STAFF, nhóm 2). Dự án: bộ mẫu của CRM + `E2E-ACTIVE` (hoạt động) + `E2E-OFF` (ngừng). Khách: 3 của staff1 (nhóm 1), 1 của staff2 (nhóm 2). Seed đi qua REST API thật (`lib/seed.ts`); `assertIsolated()` (gọi trước mọi thao tác phá hủy: flush Redis, xóa bucket/object, teardown, seed) đọc lại cấu hình thật và từ chối nếu: Mongo không loopback / cổng 27017 / DB khác `e2e`; Redis không loopback, khác db 15 hoặc key prefix không phải `e2e:`; S3 endpoint không loopback hoặc bucket không bắt đầu bằng `e2e-`; cổng backend/Admin trùng 3000/5173. Vì vậy ghi đè `E2E_REDIS_*`/`E2E_S3_ENDPOINT` sang máy ngoài sẽ bị chặn.

## Thêm spec

Tạo `e2e/specs/<ten>.spec.ts`, import từ `../fixtures`:

```ts
import { test, expect } from '../fixtures';

test('ví dụ', async ({ loginAs, backstage, seed }) => {
  const page = await loginAs('staff1');          // đã đăng nhập, không qua màn login
  await page.goto('/crm/customers');
  // ... thao tác UI ...
  expect(await backstage.count('customers', { fullName: 'Tên khách' })).toBe(1);   // Mongo tạm
  expect(await backstage.s3Keys()).toHaveLength(1);                                 // MinIO e2e-attachments
  expect(await backstage.redisKeys('e2e:*')).toBeDefined();                         // Redis db 15
});
```

- `loginAs(role)` với role `admin | mgr1 | staff1 | staff2`; `page` mặc định là chưa đăng nhập (dùng cho test form đăng nhập/đăng xuất thật).
- `seed`: id người dùng, nhóm, dự án, khách mẫu. Mỗi spec nên tự tạo dữ liệu riêng (tên có hậu tố ngẫu nhiên) thay vì sửa khách mẫu.
- Giao diện mới có rất ít `data-testid` (khoảng 10 điểm: `login-error`, `care-log-photo-remove`, `notification-bell`, `user-menu-toggle`/`user-menu-logout`, `login-submit`, `appointment-card`, `daily-task-card`, `care-log-photo`, `customer-detail-desktop`/`-mobile`); ưu tiên `getByRole`/`getByLabel`, chỉ thêm `data-testid` ở chỗ không có vai trò/nhãn ổn định.

## Lưu ý quan trọng

1. **`loginAs` không dùng cookie storageState.** Refresh token xoay vòng 1 lần dùng và phát hiện tái sử dụng thì thu hồi cả phiên, nên 1 file cookie dùng cho nhiều test sẽ hỏng. Thay vào đó globalSetup ký sẵn JWT truy cập (8 giờ) cho 4 vai trò bằng secret E2E, và fixture trả token đó khi app gọi `POST /auth/refresh` lúc khởi động. Hệ quả: luồng refresh thật không được phủ khi dùng `loginAs`; `page.goto` giữa test vẫn giữ đăng nhập vì app xin lại token qua route đó.
2. **Throttle đăng nhập:** mặc định backend giới hạn `POST /auth/login` 5 lần/phút/IP. Stack E2E đặt `AUTH_LOGIN_THROTTLE_LIMIT=1000` (biến chỉ dành cho E2E, không đặt ở production) nên spec đăng nhập thật nhiều lần không bị 429.
3. `workers: 1`, chạy tuần tự trên 1 stack dùng chung.
4. **Khóa chạy đồng thời (2 lớp).** Khóa là thư mục `e2e/.runtime/e2e.run.lock` (mkdir nguyên tử, bên trong `owner.json` ghi PID + thời điểm); lần chạy thứ hai khi khóa còn sống báo lỗi ngay (không chạy chồng). Khóa mồ côi (PID đã chết do dừng cứng) tự được nhận ra và dọn ở lần chạy kế.
   - Lớp 1, wrapper `e2e/run.mjs` (là thứ `npm run e2e`/`e2e:headed` gọi): lấy khóa TRƯỚC khi spawn Playwright, chuyển tiếp mọi đối số, mã thoát và tín hiệu Ctrl+C, nhả khóa khi kết thúc kể cả lỗi. Cần lớp này vì Playwright XÓA `outputDir` (`RealEstateAdminApp/test-results`) trước cả khi chạy globalSetup; nếu chỉ khóa trong globalSetup thì lần chạy thứ hai (bị từ chối đúng) vẫn kịp xóa trace/ảnh của lần một đang chạy và làm lần một lỗi `ENOENT ... trace`.
   - Lớp 2, globalSetup: cũng tự lấy khóa (nhận biết khóa do wrapper giữ qua biến `E2E_RUN_LOCK_OWNER_PID` khớp PID trong `owner.json`, nên không tự khóa chính mình). Chạy thẳng `npx playwright test -c e2e/playwright.config.ts` (không qua wrapper) vẫn an toàn về stack/cổng/dữ liệu, NHƯNG lần chạy bị từ chối kiểu này có thể đã xóa `test-results` của lần đang chạy; hãy dùng `npm run e2e`.
   - Cổng 3100/5183 đang bận (kiểm cả `127.0.0.1` lẫn `::1`) cũng báo lỗi TRƯỚC khi flush/xóa gì.
   - Khóa này khác với thư mục `e2e/.runtime/e2e.lock` mà người/agent có thể tự `mkdir` bao ngoài lệnh chạy để xếp hàng giữa nhiều phiên.
5. **Dọn sạch khi bị ngắt giữa chừng** (Ctrl+C mạnh, kill, máy treo): thực tế không sót tiến trình/cổng (Vite, backend, mongod tạm bị dừng), NHƯNG teardown không kịp chạy nên SÓT bucket `e2e-attachments`/`e2e-exports` trên MinIO, khóa Redis db 15 và file `.runtime/state.json` cho tới lần chạy kế. globalSetup của lần chạy kế tự dọn lại đầu tiên (flush Redis db 15, xóa object + bucket e2e-*, rồi tạo mới). Dữ liệu sót này chỉ nằm ở db 15 và bucket `e2e-*`, không ảnh hưởng stack dev. Nếu một tiến trình con còn giữ cổng, lần sau báo "Cổng ... đang bị chiếm": tắt tiến trình đó rồi chạy lại.
6. Log backend/Vite của lần chạy gần nhất: `e2e/.runtime/logs/` (`backend.log`, `admin.log`, `app-*.log`; không commit). Dòng đầu mỗi file ghi lệnh, cổng, thời điểm; backend chạy `LOG_LEVEL=info`. Khi backend/Vite không lên, lỗi của globalSetup tự đính 40 dòng cuối của log tương ứng (không in biến môi trường).
7. Chống lẫn stack: `node e2e/tools/dev-snapshot.mjs` in số document DB `mongodb`, DBSIZE Redis db 0/15, số object bucket dev (chỉ đọc); chạy trước và sau `npm run e2e` rồi so sánh.
