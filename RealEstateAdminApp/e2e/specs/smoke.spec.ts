import { REDIS_KEY_PREFIX, S3 } from '../env';
import { test, expect, ACCOUNTS, TEST_PASSWORD } from '../fixtures';

test('smoke: staff1 đăng nhập, thấy danh sách khách, đăng xuất', async ({ page, seed }) => {
  test.setTimeout(60_000);
  await page.goto('/login');
  await page.getByPlaceholder('admin@example.com').fill(ACCOUNTS.staff1.email);
  await page.locator('input[type="password"]').fill(TEST_PASSWORD);
  await page.getByTestId('login-submit').click();

  // Điều hướng trong app (token truy cập nằm trong RAM, goto sẽ buộc refresh bằng cookie).
  await expect(page).not.toHaveURL(/\/login/);
  await page.locator('a[href="/crm/customers"]').first().click();
  // Các spec khác thêm nhiều khách nên khách mẫu không còn ở trang đầu: tìm theo tên trước.
  await page.getByRole('searchbox', { name: 'Tìm kiếm' }).fill(seed.customers.staff1[0].fullName);
  await expect(page.getByText(seed.customers.staff1[0].fullName).first()).toBeVisible();

  await page.getByTestId('user-menu-toggle').click();
  await page.getByTestId('user-menu-logout').click();
  await expect(page).toHaveURL(/\/login/);
});

test('smoke: fixture loginAs bỏ qua màn đăng nhập; backstage đọc được Mongo, Redis db 15, MinIO', async ({ loginAs, backstage, seed }) => {
  const page = await loginAs('staff1');
  await page.goto('/crm/customers');
  await page.getByRole('searchbox', { name: 'Tìm kiếm' }).fill(seed.customers.staff1[0].fullName);
  await expect(page.getByText(seed.customers.staff1[0].fullName).first()).toBeVisible();

  // Cờ FE thực sự được Vite nhận (biến process.env thắng .env của dự án).
  const flags = await page.evaluate(async () => {
    const path = '/src/modules/crm/config/featureFlags.ts';
    const mod = await import(/* @vite-ignore */ path);
    return mod.CRM_FEATURE_FLAGS;
  });
  expect(flags).toMatchObject({ isPrototypeEnabled: true, isAttachmentsEnabled: true, isMockReportsEnabled: false, isMockImportExportEnabled: false });

  expect(await backstage.count('customers')).toBeGreaterThanOrEqual(seed.customers.staff1.length + seed.customers.staff2.length); // các spec khác thêm khách
  expect(await backstage.count('projects', { code: seed.projects.inactive.code, isActive: false })).toBe(1);
  // Redis db 15: đã có khóa (throttle/idempotency của các thao tác trên) và MỌI khóa đều mang tiền tố của stack E2E.
  const redisKeys = await backstage.redisKeys();
  expect(redisKeys.length).toBeGreaterThan(0);
  expect(redisKeys.filter((k) => !k.startsWith(REDIS_KEY_PREFIX))).toEqual([]);
  // MinIO: liệt kê được bucket ảnh (ListObjects ném lỗi nếu MinIO sập hoặc thiếu bucket); bucket export chưa ai ghi nên rỗng.
  await backstage.s3Keys(S3.bucketAttachments);
  expect(await backstage.s3Keys(S3.bucketExports)).toEqual([]);
});
