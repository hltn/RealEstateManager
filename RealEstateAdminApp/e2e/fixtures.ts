/**
 * Fixture dùng chung cho mọi spec E2E.
 *
 * - `loginAs(role)`: mở trang ĐÃ đăng nhập theo vai trò (admin | mgr1 | staff1 | staff2), không phải login lại.
 *   Cơ chế: token truy cập (JWT 8 giờ, ký bằng secret E2E ở globalSetup) được trả về khi app gọi `POST /auth/refresh`
 *   lúc khởi động. Lý do không dùng cookie storageState: refresh token xoay vòng 1 lần dùng và phát hiện tái sử dụng
 *   sẽ thu hồi cả phiên, nên 1 file cookie dùng cho nhiều test sẽ hỏng. `/auth/login` thật bị throttle 5 lần/phút/IP.
 *   Hệ quả: luồng refresh thật KHÔNG được phủ khi dùng `loginAs`; test đăng nhập/đăng xuất thật dùng `page` thường.
 * - `loginWithToken(accessToken)`: như `loginAs` cho tài khoản tạo riêng trong spec (token lấy từ `POST /auth/login`).
 * - `page` (mặc định của Playwright): chưa đăng nhập, dùng cho test form đăng nhập.
 * - `backstage`: đối chiếu Mongo tạm, MinIO, Redis db 15 (xem lib/backstage.ts).
 * - `seed`: dữ liệu mồi (id người dùng, nhóm, dự án, khách mẫu).
 */
import { test as base, type Browser, type Page, type TestInfo } from '@playwright/test';
import { ACCOUNTS, TEST_PASSWORD, URLS, isTruthyFlag, type RoleKey } from './env';
import { Backstage, readState } from './lib/backstage';
import { Api } from './lib/api';
import type { SeedState } from './lib/seed';

interface Fixtures {
  loginAs: (role: RoleKey) => Promise<Page>;
  /** Như `loginAs` nhưng cho access token tự lấy (tài khoản tạo riêng trong spec, không đụng tài khoản seed dùng chung). */
  loginWithToken: (accessToken: string) => Promise<Page>;
  backstage: Backstage;
  seed: SeedState;
  api: Api;
  password: string;
}

export const test = base.extend<Fixtures>({
  seed: async ({}, use) => use(readState()),
  api: async ({ seed }, use) => use(new Api(seed)),
  password: async ({}, use) => use(TEST_PASSWORD),

  backstage: async ({}, use) => {
    const b = new Backstage();
    await use(b);
    await b.close();
  },

  loginWithToken: async ({ browser }, use) => {
    const contexts: Array<{ close: () => Promise<void> }> = [];
    await use((accessToken: string) => openSessionPage(browser, contexts, accessToken));
    for (const c of contexts) await c.close();
  },

  loginAs: async ({ browser, seed }, use) => {
    const contexts: Array<{ close: () => Promise<void> }> = [];
    await use((role: RoleKey) => openSessionPage(browser, contexts, seed.users[role].accessToken));
    for (const c of contexts) await c.close();
  },
});

/** Mở trang đã có phiên: `POST /auth/refresh` được trả lời bằng `accessToken` (cơ chế giải thích ở đầu file). */
async function openSessionPage(browser: Browser, contexts: Array<{ close: () => Promise<void> }>, accessToken: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: URLS.admin });
  contexts.push(context);
  await context.route('**/api/v1/auth/refresh', (route) => {
    // Trả lời cả preflight CORS (Chromium chuyển OPTIONS qua route khi có header tùy chỉnh X-Request-ID).
    const cors = {
      'access-control-allow-origin': URLS.admin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, authorization, x-request-id',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ accessToken }) });
  });
  return context.newPage();
}

export { expect } from '@playwright/test';
export { ACCOUNTS, TEST_PASSWORD, URLS };

export type BugKind = 'Thiếu chức năng' | 'Sai hành vi' | 'Chưa thân thiện';

/** Đánh dấu test hiện tại là khuyết tật UX đã biết (xem ghi chú đầu file). Ghi annotation loại 'bug' bằng tiếng Việt. */
export function knownBug(info: TestInfo, kind: BugKind, reason: string): void {
  info.annotations.push({ type: 'bug', description: `${kind}: ${reason}` });
  if (!isTruthyFlag(process.env.E2E_SHOW_BUGS)) base.fail();
}
