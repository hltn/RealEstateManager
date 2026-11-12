/**
 * Hình học màn "Trường chân dung" (T-64, FR-41 đợt 2) trên Chromium thật với API giả (`page.route`):
 * danh sách trường và form "Thêm trường" (kể cả kiểu SELECT có lựa chọn) KHÔNG tràn viewport, KHÔNG gây cuộn ngang ở nhiều cỡ cửa sổ.
 * Chạy: `npm run e2e:mock` (không cần backend). Logic nghiệp vụ (xóa, khóa kiểu, trường mới dùng được ngay) đã có vitest ở
 * src/modules/crm/screens/Settings.
 */
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { MOCK_API_ORIGIN } from '../playwright.mock.config';

const cors = (route: Route) => ({
  'access-control-allow-origin': route.request().headers().origin ?? '*',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type, authorization, x-request-id',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
});

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, headers: cors(route), contentType: 'application/json', body: JSON.stringify(body) });

const makeField = (index: number, overrides: Record<string, unknown> = {}) => ({
  id: `f${index}`,
  key: `truong_${index}`,
  label: `Trường chân dung số ${index} với nhãn khá dài để kiểm tra việc xuống dòng trong hàng`,
  helpText: null,
  placeholder: null,
  groupCode: 'REAL_ESTATE',
  type: 'TEXT',
  options: [],
  order: index,
  weight: 1,
  suggestPriority: 1,
  isFilterable: true,
  isOccasion: false,
  occasionLabel: null,
  linkedCriterion: null,
  isSensitive: false,
  isSystem: index % 2 === 1,
  isActive: true,
  ...overrides,
});

const FIELDS = [
  ...Array.from({ length: 6 }, (_, offset) => makeField(offset + 1)),
  makeField(7, {
    key: 'loai_hinh',
    label: 'Loại hình',
    type: 'MULTI_SELECT',
    options: [
      { value: 'APT', label: 'Căn hộ', isActive: true },
      { value: 'OLD', label: 'Loại cũ', isActive: false },
    ],
  }),
];

/** Giả lập: phiên ADMIN, danh sách trường chân dung 7 dòng, mọi GET khác trả trang rỗng. */
const mockApi = async (page: Page) => {
  await page.route(`${MOCK_API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) });
    const url = new URL(request.url());
    if (url.pathname.endsWith('/auth/refresh')) return json(route, { accessToken: 'mock-token' });
    if (url.pathname.endsWith('/auth/me')) {
      if (!request.headers().authorization) return route.fulfill({ status: 401, headers: cors(route), contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) });
      return json(route, { _id: 'u1', email: 'admin@example.test', displayName: 'Quản trị Mock', role: 'ADMIN', roles: ['ADMIN'], status: 'ACTIVE', teamId: null });
    }
    if (url.pathname.endsWith('/crm/persona-fields')) return json(route, { data: FIELDS, meta: { total: FIELDS.length, page: 1, limit: 100, totalPages: 1 } });
    if (url.pathname.endsWith('/notifications/unread-count')) return json(route, { data: { count: 0 } });
    return json(route, { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
  });
};

const openPersonaTab = async (page: Page) => {
  await page.goto('/crm/settings');
  await page.getByRole('tab', { name: 'Trường chân dung' }).click();
  await expect(page.getByRole('button', { name: 'Thêm trường', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Loại hình').first()).toBeVisible();
};

/** Phần tử nằm trọn trong chiều ngang viewport và trang không có cuộn ngang. */
const expectNoHorizontalOverflow = async (page: Page, element?: Locator) => {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (element && viewport) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
};

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 768, height: 600 },
  { width: 390, height: 800 },
]) {
  test(`FR-41: màn Trường chân dung và form Thêm trường (kiểu SELECT) không tràn viewport ở ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockApi(page);
    await openPersonaTab(page);

    await expectNoHorizontalOverflow(page, page.locator('#settings-panel'));
    // Hàng trường có nút Xoá cho trường không phải hệ thống (số chẵn) và không có cho trường hệ thống.
    await expect(page.getByRole('button', { name: /^Xoá trường / })).toHaveCount(FIELDS.filter((field) => !field.isSystem).length);

    await page.getByRole('button', { name: 'Thêm trường', exact: true }).first().click();
    const form = page.getByTestId('persona-field-create-form');
    await expect(form).toBeVisible();
    await expectNoHorizontalOverflow(page, form);

    // Chuyển sang kiểu SELECT: xuất hiện trình sửa lựa chọn, thêm vài lựa chọn dài, form vẫn nằm trong viewport.
    await form.getByLabel('Kiểu').selectOption('SELECT');
    const optionInput = form.getByLabel('Thêm lựa chọn mới');
    await expect(optionInput).toBeVisible();
    for (const label of ['Hướng Đông Nam nhìn ra công viên trung tâm thành phố', 'Hướng Tây Bắc', 'Không xác định']) {
      await optionInput.fill(label);
      await form.getByRole('button', { name: 'Thêm lựa chọn' }).click();
    }
    await expect(form.getByLabel(/^Tên lựa chọn /)).toHaveCount(3);
    await expectNoHorizontalOverflow(page, form);

    // Mọi điều khiển chính của form nằm trong chiều ngang viewport.
    for (const control of [form.getByLabel('Nhãn trường'), form.getByLabel('Mã trường'), form.getByLabel('Trọng số'), form.getByRole('button', { name: 'Huỷ' }), form.getByRole('button', { name: 'Thêm trường' })]) {
      await control.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page, control);
    }
  });
}

test('FR-41: form Thêm trường mở được và Huỷ đóng lại, không để lại cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockApi(page);
  await openPersonaTab(page);

  await page.getByRole('button', { name: 'Thêm trường', exact: true }).first().click();
  await expect(page.getByTestId('persona-field-create-form')).toBeVisible();
  await page.getByRole('button', { name: 'Huỷ' }).click();

  await expect(page.getByTestId('persona-field-create-form')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
