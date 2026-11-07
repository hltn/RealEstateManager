/**
 * Hình học dropdown thông báo desktop (T-57, FR-38) trên Chromium thật với API giả (`page.route`):
 * neo dưới chuông, KHÔNG tràn viewport ở nhiều cỡ cửa sổ, danh sách cuộn trong khung và cuộn tới cuối tải thêm 20.
 * Chạy: `npm run e2e:mock` (không cần backend). Logic nghiệp vụ (tab, chấm xanh, ...) đã có vitest ở src/components/header.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { MOCK_API_ORIGIN } from '../playwright.mock.config';

const PAGE_SIZE = 20;
const TOTAL = 45;

const cors = (route: Route) => ({
  'access-control-allow-origin': route.request().headers().origin ?? '*',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type, authorization, x-request-id',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
});

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, headers: cors(route), contentType: 'application/json', body: JSON.stringify(body) });

const makeNotification = (index: number) => ({
  id: `n${index}`,
  type: 'FOLLOW_UP_DUE',
  title: `Thông báo số ${index} với tiêu đề khá dài để kiểm tra việc xuống dòng trong khung`,
  body: 'Nội dung thông báo cũng dài vừa đủ để chiếm hai dòng trong dropdown kiểu Facebook.',
  data: { deepLink: '/crm/customers' },
  priority: 'NORMAL',
  readAt: index % 3 === 0 ? new Date().toISOString() : null,
  createdAt: new Date(Date.now() - index * 60_000).toISOString(),
});

/** Giả lập toàn bộ API: phiên đăng nhập, danh sách thông báo phân trang 20/trang, mọi GET khác trả rỗng. */
const mockApi = async (page: Page, requestedPages: number[]) => {
  await page.route(`${MOCK_API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) });
    const url = new URL(request.url());
    if (url.pathname.endsWith('/auth/refresh')) return json(route, { accessToken: 'mock-token' });
    if (url.pathname.endsWith('/auth/me')) {
      // Như backend thật: chưa có token thì 401 để interceptor gọi /auth/refresh rồi thử lại.
      if (!request.headers().authorization) return route.fulfill({ status: 401, headers: cors(route), contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) });
      return json(route, { _id: 'u1', email: 'staff@example.test', displayName: 'Nhân viên Mock', role: 'STAFF', roles: ['STAFF'], status: 'ACTIVE', teamId: null });
    }
    if (url.pathname.endsWith('/notifications/unread-count')) return json(route, { data: { count: 12 } });
    if (url.pathname.endsWith('/notifications')) {
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      requestedPages.push(pageNumber);
      const start = (pageNumber - 1) * PAGE_SIZE;
      const count = Math.max(0, Math.min(PAGE_SIZE, TOTAL - start));
      return json(route, {
        data: Array.from({ length: count }, (_, offset) => makeNotification(start + offset + 1)),
        meta: { total: TOTAL, page: pageNumber, limit: PAGE_SIZE, totalPages: Math.ceil(TOTAL / PAGE_SIZE) },
      });
    }
    return json(route, { data: [], meta: { total: 0, page: 1, limit: PAGE_SIZE, totalPages: 0 } });
  });
};

/** Dưới lg (1024px) AppHeader gom chuông vào menu thu gọn: phải bấm nút ba gạch của header để thấy chuông. */
const revealBell = async (page: Page) => {
  const bell = page.getByTestId('notification-bell');
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.locator('header button[class*="lg:hidden"]').last().click();
  await expect(bell).toBeVisible();
  return bell;
};

const openDropdown = async (page: Page) => {
  await page.goto('/crm/customers');
  const bell = await revealBell(page);
  await bell.click();
  const panel = page.getByTestId('notification-dropdown');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('listitem').first()).toBeVisible();
  return { bell, panel };
};

/** Khung phải nằm trọn trong viewport (chừa lề tối thiểu 8px như hàm kẹp). */
const expectInsideViewport = async (page: Page, panel: ReturnType<Page['getByTestId']>) => {
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(8 - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8 + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  // Không gây cuộn ngang trang.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
};

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 700 },
  { width: 768, height: 600 },
]) {
  test(`FR-38: dropdown thông báo neo dưới chuông và không tràn viewport ở ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockApi(page, []);
    const { bell, panel } = await openDropdown(page);

    await expectInsideViewport(page, panel);

    // Neo đúng dưới chuông: mép trên khung ở dưới đáy chuông, mép phải khung trùng mép phải vùng chứa chuông (CSS right-0).
    const panelBox = await panel.boundingBox();
    const bellBox = await bell.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(bellBox).not.toBeNull();
    if (!panelBox || !bellBox) return;
    expect(panelBox.y).toBeGreaterThanOrEqual(bellBox.y + bellBox.height - 1);
    // Luôn che đúng vị trí chuông theo chiều ngang (tâm chuông nằm trong khung), kể cả khi bị kẹp vào lề.
    const bellCenter = bellBox.x + bellBox.width / 2;
    expect(bellCenter).toBeGreaterThanOrEqual(panelBox.x);
    expect(bellCenter).toBeLessThanOrEqual(panelBox.x + panelBox.width);
    // Header đủ rộng (từ lg): chuông ở góc phải nên mép phải khung trùng mép phải chuông, không lệch như -right-[240px].
    if ((page.viewportSize()?.width ?? 0) >= 1024) expect(Math.abs(panelBox.x + panelBox.width - (bellBox.x + bellBox.width))).toBeLessThanOrEqual(2);
  });
}

test('FR-38: viewport thấp thì khung co theo chiều cao, danh sách cuộn bên trong và vẫn nằm trong viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await mockApi(page, []);
  const { panel } = await openDropdown(page);

  await expectInsideViewport(page, panel);
  const list = page.getByTestId('notification-dropdown-list');
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
});

test('FR-38: cuộn danh sách tới cuối tải thêm 20 (trang 2), khung vẫn không tràn', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const requestedPages: number[] = [];
  await mockApi(page, requestedPages);
  const { panel } = await openDropdown(page);
  const items = panel.getByRole('listitem');
  await expect(items).toHaveCount(PAGE_SIZE);

  await page.getByTestId('notification-dropdown-list').evaluate((element) => element.scrollTo({ top: element.scrollHeight }));

  await expect(items).toHaveCount(PAGE_SIZE * 2);
  expect(requestedPages.filter((pageNumber) => pageNumber === 2)).toHaveLength(1);
  await expectInsideViewport(page, panel);
});

test('FR-38: mobile (dưới md) bấm chuông sang /notifications, không mở popup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockApi(page, []);
  await page.goto('/crm/customers');

  await (await revealBell(page)).click();

  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByTestId('notification-dropdown')).toHaveCount(0);
});
