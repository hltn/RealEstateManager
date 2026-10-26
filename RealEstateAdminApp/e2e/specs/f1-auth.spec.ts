/**
 * F1 - Đăng nhập và phân quyền (doc 08 mục 2: F1-01..04). Các test ở đây đăng nhập THẬT bằng form (không dùng loginAs),
 * trừ F1-01 [+mobile] và F1-03 (chỉ cần phiên có sẵn).
 * Các khuyết tật UX từng ghi nhận ở đây (ADMIN không vào màn làm việc, lỗi đăng nhập chỉ là toast, chặn quyền im lặng, không quay lại trang định vào) đã được sửa và test chạy như bình thường.
 *
 * Quyết định [Chưa rõ]:
 * - Trang đăng nhập là `/login`; sau đăng nhập app quay lại trang đang định vào (nếu là đường dẫn nội bộ an toàn), không thì vào `/crm/today`
 *   (ADMIN/MANAGER/STAFF; EDITOR ở `/`).
 * - Gõ URL CRM ngoài quyền (`/crm/reports|projects|settings` với staff): chuyển về `/crm/today` kèm toast "Bạn không có quyền vào trang này.".
 * - Lỗi đăng nhập hiện cả toast tự tắt lẫn vùng lỗi cố định role=alert trong form: "Email hoặc mật khẩu không đúng." cho cả sai mật khẩu lẫn email lạ.
 * - Nút đăng xuất: menu người dùng ở header (data-testid user-menu-toggle / user-menu-logout), nhãn "Đăng xuất"; đăng xuất tải lại trang `/login`.
 * - "Phiên" nằm ở Mongo `refreshtokens` (hash refresh token, cờ isRevoked), KHÔNG nằm ở Redis; Redis chỉ giữ throttle/idempotency.
 */
import { test, expect, ACCOUNTS, TEST_PASSWORD } from '../fixtures';
import { MOBILE_VIEWPORT, openCustomerDetail, seenInDom, toast, watchDomFor } from '../lib/ui';
import type { Page } from '@playwright/test';

const WRONG_PASSWORD = 'Sai@12345678';

async function fillLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
}

async function uiLogin(page: Page, email: string, password = TEST_PASSWORD) {
  await fillLogin(page, email, password);
  await page.getByTestId('login-submit').click();
}

const sidebar = (page: Page) => page.getByRole('complementary');
const MENU = { today: 'Việc hôm nay', customers: 'Khách hàng', appointments: 'Lịch hẹn & Nhắc việc', reports: 'Báo cáo & Thống kê', projects: 'Danh sách dự án', settings: 'Cài đặt CRM' } as const;
const NEWS_MENU = ['Raw Articles', 'Manage WP', 'Phân tích thị trường', 'Sources', 'AI Config', 'Cronjob', 'Quản lý tài khoản'];

const EXPECTED_MENU = {
  staff1: { visible: ['today', 'customers', 'appointments'], hidden: ['reports', 'projects', 'settings'] },
  mgr1: { visible: ['today', 'customers', 'appointments', 'reports'], hidden: ['projects', 'settings'] },
  admin: { visible: ['today', 'customers', 'appointments', 'reports', 'projects', 'settings'], hidden: [] },
} as const;

test.describe('f1-auth', () => {
  for (const role of ['staff1', 'mgr1', 'admin'] as const) {
    test(`F1-01 [${role}] đăng nhập đúng bằng form, thấy "Đang đăng nhập...", vào Việc hôm nay, menu đúng quyền`, async ({ page, backstage, seed }) => {
      // Giữ request đăng nhập để quan sát trạng thái chờ.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/api/v1/auth/login', async (route) => {
        await gate;
        await route.continue();
      });
      await fillLogin(page, ACCOUNTS[role].email, TEST_PASSWORD);
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('login-submit')).toBeDisabled();
      await expect(page.getByTestId('login-submit')).toHaveText('Đang đăng nhập...');
      release();

      await expect(page).not.toHaveURL(/\/login/);
      await expect(page).toHaveURL(/\/crm\/today$/);
      await expect(page.getByRole('heading', { name: 'Việc hôm nay' })).toBeVisible();

      // Menu theo vai trò.
      if (!(await sidebar(page).getByRole('link', { name: MENU.today }).isVisible())) {
        await sidebar(page).getByRole('button', { name: 'Quản lý khách hàng' }).click();
      }
      for (const key of EXPECTED_MENU[role].visible) await expect(sidebar(page).getByRole('link', { name: MENU[key], exact: true })).toBeVisible();
      for (const key of EXPECTED_MENU[role].hidden) await expect(sidebar(page).getByRole('link', { name: MENU[key], exact: true })).toHaveCount(0);
      if (role !== 'admin') for (const name of NEWS_MENU) await expect(sidebar(page).getByRole('link', { name, exact: true })).toHaveCount(0);

      // Hậu trường: phiên (refresh token) của đúng người dùng; không có khóa it-* trong Redis.
      const sessions = (await backstage.find('refreshtokens')).filter((t) => String(t.userId) === seed.users[role].id && !t.isRevoked);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect((await backstage.redisKeys()).filter((k) => /(^|:)it-/.test(k))).toEqual([]);
    });
  }

  test('F1-01 ADMIN sau đăng nhập vào thẳng màn làm việc chính (Việc hôm nay)', async ({ page }) => {
    await uiLogin(page, ACCOUNTS.admin.email);
    await expect(page).not.toHaveURL(/\/login/); // đăng nhập thành công
    await expect(page, 'ADMIN nên vào thẳng màn làm việc chính (Việc hôm nay)').toHaveURL(/\/crm\/today$/);
  });

  test('F1-01 [+mobile] thanh điều hướng đáy theo vai trò (staff không có Báo cáo, quản lý có)', async ({ loginAs }) => {
    const bottomNav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng module khách hàng' });
    const staff = await loginAs('staff1');
    await staff.setViewportSize(MOBILE_VIEWPORT);
    await staff.goto('/crm/today');
    await expect(bottomNav(staff).getByRole('link', { name: /Việc hôm nay/ })).toBeVisible();
    await expect(bottomNav(staff).getByRole('link', { name: 'Khách hàng' })).toBeVisible();
    await expect(bottomNav(staff).getByRole('link', { name: 'Lịch hẹn' })).toBeVisible();
    await expect(bottomNav(staff).getByRole('link', { name: 'Báo cáo' })).toHaveCount(0);

    const mgr = await loginAs('mgr1');
    await mgr.setViewportSize(MOBILE_VIEWPORT);
    await mgr.goto('/crm/today');
    await expect(bottomNav(mgr).getByRole('link', { name: 'Báo cáo' })).toBeVisible();
  });

  test('F1-02 đăng nhập sai: cùng một thông báo cho sai mật khẩu và email lạ, giữ email đã nhập, không tạo phiên mới', async ({ page, backstage }) => {
    const sessionsBefore = (await backstage.find('refreshtokens')).length;

    await uiLogin(page, ACCOUNTS.staff1.email, WRONG_PASSWORD);
    const wrongPasswordToast = toast(page, 'Email hoặc mật khẩu không đúng.');
    await expect(wrongPasswordToast).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Email')).toHaveValue(ACCOUNTS.staff1.email); // không mất email đã nhập
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute('type', 'password'); // không lộ mật khẩu
    await expect(page.getByTestId('login-submit')).toBeEnabled(); // thử lại được ngay

    await page.getByLabel('Email').fill('khong.ton.tai@example.test');
    await page.getByTestId('login-submit').click();
    // Cùng nội dung: không lộ email nào tồn tại.
    await expect(toast(page, 'Email hoặc mật khẩu không đúng.').last()).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // Ô trống: báo lỗi cạnh từng trường (kiểm tra phía giao diện, không gọi máy chủ).
    await page.getByLabel('Email').fill('');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Vui lòng nhập email')).toBeVisible();
    await expect(page.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeVisible();
    await page.getByLabel('Email').fill('khong-phai-email');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Email không đúng định dạng')).toBeVisible();

    // Nút hiện/ẩn mật khẩu.
    await page.getByRole('button', { name: 'Hiện mật khẩu' }).click();
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Ẩn mật khẩu' })).toBeVisible();

    // Hậu trường: đăng nhập thất bại không tạo thêm refresh token nào.
    expect((await backstage.find('refreshtokens')).length).toBe(sessionsBefore);
  });

  test('F1-02 lỗi đăng nhập hiện cố định trong form (role=alert), không chỉ toast tự tắt', async ({ page }) => {
    await uiLogin(page, ACCOUNTS.staff1.email, WRONG_PASSWORD);
    await expect(toast(page, 'Email hoặc mật khẩu không đúng.')).toBeVisible(); // lỗi có xuất hiện (toast): đỏ ở dòng dưới là do THIẾU vùng lỗi cố định
    await expect(page.getByRole('alert'), 'form phải có vùng lỗi cố định role=alert').toContainText('Email hoặc mật khẩu không đúng.');
  });

  test('F1-03 staff gõ URL Báo cáo/Dự án/Cài đặt: bị chuyển về Việc hôm nay, không lộ nội dung thoáng qua', async ({ loginAs }) => {
    const page = await loginAs('staff1');
    // Ghi lại mọi lúc DOM từng chứa tiêu đề màn bị cấm (bắt cả nội dung "nháy" rồi biến mất).
    await page.addInitScript(() => {
      const forbidden = ['Báo cáo & Thống kê', 'Quản lý dự án BĐS', 'Cài đặt CRM', 'sắp ra mắt'];
      const seen = new Set<string>();
      (window as unknown as { __seenForbidden: Set<string> }).__seenForbidden = seen;
      const scan = () => {
        const text = document.body?.innerText ?? '';
        for (const k of forbidden) if (text.includes(k)) seen.add(k);
      };
      new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });
    });
    for (const path of ['/crm/reports', '/crm/projects', '/crm/settings']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/crm\/today$/);
      await expect(page.getByRole('heading', { name: 'Việc hôm nay' })).toBeVisible();
      const seen = await page.evaluate(() => [...(window as unknown as { __seenForbidden: Set<string> }).__seenForbidden]);
      expect(seen, `nội dung bị cấm thoáng hiện ở ${path}`).toEqual([]);
    }
  });

  test('F1-03 bị chặn thì có thông báo giải thích ngắn thay vì chuyển hướng im lặng', async ({ loginAs }) => {
    const page = await loginAs('staff1');
    await page.goto('/crm/reports');
    await expect(page).toHaveURL(/\/crm\/today$/); // đã bị chuyển hướng như thiết kế
    await expect(toast(page, /không có quyền/), 'phải có thông báo giải thích vì sao bị chuyển').toBeVisible();
  });

  test('F1-03 chưa đăng nhập: gõ URL CRM bị đưa về màn đăng nhập', async ({ page }) => {
    for (const path of ['/crm/customers', '/crm/reports', '/crm/appointments/new']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    }
  });

  test('F1-03b đăng nhập xong quay lại trang đang định vào', async ({ page }) => {
    await page.goto('/crm/customers');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email').fill(ACCOUNTS.staff1.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/crm\/customers$/);
  });

  test('F1-04 đăng xuất xóa phiên: người dùng sau không thấy dữ liệu của staff1, Back không hiện lại hồ sơ', async ({ page, api, backstage, seed }) => {
    const mine = await api.createCustomer({ label: 'Khách-Riêng-Staff1' });
    // Chỉ xét phiên do chính test này tạo (các test khác cũng đăng nhập staff1 trên cùng DB).
    const staff1Tokens = async () => (await backstage.find('refreshtokens')).filter((t) => String(t.userId) === seed.users.staff1.id);
    const baseline = new Set((await staff1Tokens()).map((t) => String(t._id)));
    const mySessions = async () => (await staff1Tokens()).filter((t) => !baseline.has(String(t._id)));
    await watchDomFor(page, [mine.fullName, mine.phone]); // ghi lại mọi lúc DOM từng chứa dữ liệu khách của staff1, kể cả thoáng qua
    await uiLogin(page, ACCOUNTS.staff1.email);
    await expect(page).toHaveURL(/\/crm\/today$/);
    await openCustomerDetail(page, mine.id, mine.fullName);

    expect((await mySessions()).filter((t) => !t.isRevoked).length).toBeGreaterThanOrEqual(1);

    await page.getByTestId('user-menu-toggle').click();
    await page.getByTestId('user-menu-logout').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();

    // Hậu trường: mọi refresh token của staff1 đã bị thu hồi.
    await expect.poll(async () => (await mySessions()).filter((t) => !t.isRevoked).length).toBe(0);
    expect((await mySessions()).length).toBeGreaterThanOrEqual(1);
    // Trình duyệt: không còn dữ liệu khách của staff1 trong localStorage/sessionStorage.
    const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    for (const secret of [mine.id, mine.fullName, mine.phone]) expect(stored).not.toContain(secret);

    // Nút Back sau đăng xuất: lùi hết lịch sử mà trình duyệt cho phép. MỌI màn trên đường đi (kể cả màn hồ sơ nếu trình duyệt trả lại
    // trang cũ) không được lộ tên/SĐT của staff1, kể cả thoáng qua. Phải lùi được ít nhất một bước nên vòng lặp luôn có khẳng định.
    let backSteps = 0;
    while (backSteps < 10 && (await page.goBack())) {
      backSteps += 1;
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(mine.fullName);
      await expect(page.locator('body')).not.toContainText(mine.phone);
      expect(await seenInDom(page), `bước Back ${backSteps} (${page.url()}) từng hiện dữ liệu của staff1`).toEqual([]);
    }
    expect(backSteps, 'phải lùi được ít nhất một bước').toBeGreaterThan(0);

    // staff2 đăng nhập trên cùng trình duyệt: không thấy khách của staff1.
    await uiLogin(page, ACCOUNTS.staff2.email);
    await expect(page).toHaveURL(/\/crm\/today$/);
    await page.goto('/crm/customers');
    await expect(page.getByText(seed.customers.staff2[0].fullName).first()).toBeVisible(); // danh sách đã tải
    await expect(page.locator('body')).not.toContainText(mine.fullName);
    await expect(page.locator('body')).not.toContainText(mine.phone);
  });
});
