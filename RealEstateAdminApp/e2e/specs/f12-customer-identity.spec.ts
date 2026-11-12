/**
 * F12 - Định danh khách hàng v1.0.5 (T-35; doc 10 Plan FR-02, FR-03, FR-09..FR-14, FR-22; doc 11 Architecture).
 * Mỗi luồng chạy ở desktop (1280px) và mobile/PWA (390px, biến thể thẻ + thanh đáy), kiểm theo tiêu chí UI/UX của dự án:
 *   (1) đủ chức năng trên màn, (2) giữ ngữ cảnh khi đi từ khách A sang màn liên quan, (3) điều hướng sau lưu về đúng chỗ,
 *   (4) phản hồi/lỗi cạnh trường, (5) trạng thái rỗng/biên.
 *
 * Bắt mạng: mọi test gắn `trackNet` vào context; cuối test khẳng định KHÔNG có request tới `phone-lookups`, `assignable-users`,
 * `care-team-requests` (đã bỏ ở v1.0.5) và ĐÃ có request CRM thật (tránh pass rỗng).
 *
 * Quyết định [Chưa rõ]:
 * - Ô lọc nhanh của danh sách (desktop) và nhóm chip ở "Bộ lọc nâng cao" (tiêu đề "Người phụ trách (chính hoặc hỗ trợ)") đều có nhãn
 *   "Người phụ trách", cùng nhãn với ô ở màn Việc hôm nay (phạm vi "Cả nhóm", Quản trị/Quản lý); nguồn dữ liệu chung là `GET /crm/customer-assignees`.
 *   Tài khoản bị khóa vẫn nằm trong nguồn này; nhãn lựa chọn có hậu tố " (đã khóa)" và vẫn chọn để lọc được (F12-05).
 * - Bộ lọc "Phụ trách chính" nằm trong hộp "Bộ lọc nâng cao" (desktop: dialog; mobile: bottom sheet), chỉ Quản trị/Quản lý thấy.
 * - Khách "đã khóa" = người chăm sóc chính bị khóa tài khoản (PATCH /users/:id/status BLOCKED).
 */
import { test, expect } from '../fixtures';
import { TEST_PASSWORD, URLS } from '../env';
import { formatPhone, tomorrowSlot, uid } from '../lib/api';
import { MOBILE_VIEWPORT, note, openCareLogComposer, openCustomerDetail, searchCustomers, setSchedule, toast, waitPastLegacyDebounce } from '../lib/ui';
import type { Locator, Page } from '@playwright/test';

const LEGACY_URL = /phone-lookups|assignable-users|care-team-requests/;
const CODE_RE = /KH-\d{6,}/;
const maskedOf = (phone: string): string => `${phone.slice(0, 4)} ••• ${phone.slice(-3)}`;

/** Ghi mọi request của CẢ context (kể cả tab mới): `legacy` = gọi tới endpoint đã bỏ; `crm` = mọi request /crm/ thật. */
function trackNet(page: Page): { legacy: string[]; crm: string[]; urls: string[] } {
  const out = { legacy: [] as string[], crm: [] as string[], urls: [] as string[] };
  page.context().on('request', (request) => {
    const entry = `${request.method()} ${request.url()}`;
    out.urls.push(entry);
    if (LEGACY_URL.test(request.url())) out.legacy.push(entry);
    if (request.url().includes('/api/v1/crm/')) out.crm.push(entry);
  });
  return out;
}
function expectNoLegacyCalls(net: ReturnType<typeof trackNet>): void {
  expect(net.crm.length, 'phải có request CRM thật (tránh pass rỗng)').toBeGreaterThan(0);
  expect(net.legacy, 'không màn nào được gọi phone-lookups / assignable-users / care-team-requests').toEqual([]);
}

const useMobile = async (page: Page) => page.setViewportSize(MOBILE_VIEWPORT);

/** Dòng/thẻ của khách trong danh sách (bảng desktop có role=row, mobile là thẻ role=article). */
const listItem = (page: Page, mode: Mode, fullName: string): Locator =>
  mode === 'desktop' ? page.getByRole('row').filter({ hasText: fullName }) : page.getByRole('article').filter({ hasText: fullName });

type Mode = 'desktop' | 'mobile';
const MODES: Mode[] = ['desktop', 'mobile'];

/** Tìm khách ở danh sách theo từ khoá (desktop: searchbox "Tìm kiếm"; mobile: textbox "Tìm khách hàng") và chờ phản hồi có `q=`. */
async function searchList(page: Page, mode: Mode, keyword: string): Promise<void> {
  if (mode === 'desktop') return searchCustomers(page, keyword);
  const responded = page.waitForResponse((r) => r.request().method() === 'GET' && /\/crm\/customers\?/.test(r.url()) && r.url().includes('q='));
  await page.getByRole('textbox', { name: 'Tìm khách hàng' }).fill(keyword);
  await responded;
}

/** Mở nhóm chăm sóc ở chi tiết khách: mobile nằm ở tab "Tiến độ". */
async function openCareTeam(page: Page, mode: Mode): Promise<Locator> {
  if (mode === 'mobile') await page.getByRole('tab', { name: 'Tiến độ' }).click();
  const card = page.getByRole('region', { name: 'Nhóm chăm sóc' });
  await expect(card).toBeVisible();
  return card;
}

/** Tài khoản STAFF riêng (nhóm 1) + access token đăng nhập thật; /auth/login bị throttle nên thử lại khi 429. */
async function createStaffWithToken(api: import('../lib/api').Api, teamId: string, displayName: string): Promise<{ id: string; token: string }> {
  const email = `f12-${uid().toLowerCase()}@example.test`;
  const created = await api.call('admin', 'POST', '/users', { email, password: TEST_PASSWORD, displayName, roles: ['STAFF'], teamIds: [teamId] });
  expect(created.status).toBe(201);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${URLS.api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: TEST_PASSWORD }) });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      continue;
    }
    expect(res.status).toBeLessThan(300);
    const body = (await res.json()) as { data?: { accessToken: string }; accessToken?: string };
    return { id: String(created.data._id ?? created.data.id), token: String(body.data?.accessToken ?? body.accessToken) };
  }
  throw new Error('[F12] không đăng nhập được tài khoản tạm (429 kéo dài)');
}

test.describe('f12-customer-identity', () => {
  for (const mode of MODES) {
    test(`F12-01 [${mode}] tạo khách KHÔNG SĐT: SĐT tùy chọn, không banner trùng, lỗi cạnh ô, lưu xong vào chi tiết khách vừa tạo (có mã), Back không về form`, async ({ loginAs, api, backstage, seed }) => {
      const page = await loginAs('staff1');
      const net = trackNet(page);
      if (mode === 'mobile') await useMobile(page);
      const existing = await api.createCustomer({ label: 'Khách-ĐãCóSĐT' });
      const fullName = `Khách-KhôngSĐT-${uid()}`;

      await page.goto('/crm/customers');
      await page.getByRole('button', { name: 'Thêm khách' }).click();
      await expect(page).toHaveURL(/\/crm\/customers\/new$/);
      await expect(page.getByRole('heading', { name: 'Thêm khách hàng mới' })).toBeVisible();
      // Chỉ họ tên bắt buộc: SĐT ghi rõ "Không bắt buộc".
      await expect(page.getByText('Bắt buộc: họ tên')).toBeVisible();
      await expect(page.getByText(/Không bắt buộc\. Di động 10 số/)).toBeVisible();
      await expect(page.getByText('Người chăm sóc chính: bạn (tự động)')).toBeVisible();
      // Không còn ô chọn người phụ trách hộ (FR-10).
      await expect(page.getByLabel('Người phụ trách chính')).toHaveCount(0);

      // Lỗi cạnh trường, dữ liệu đã nhập không mất, không gửi POST.
      let posts = 0;
      const legacyCalls: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && /\/crm\/customers$/.test(r.url())) posts += 1;
        if (LEGACY_URL.test(r.url())) legacyCalls.push(`${r.method()} ${r.url()}`);
      });
      await page.getByRole('button', { name: 'Lưu khách hàng' }).click();
      await expect(page.getByText('Vui lòng nhập họ và tên khách hàng.', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/crm\/customers\/new$/);
      const nameBox = page.getByLabel('Họ và tên khách hàng');
      const phoneBox = page.getByLabel('Số điện thoại');
      await nameBox.fill(fullName);
      await phoneBox.fill('12345');
      await page.getByRole('button', { name: 'Lưu khách hàng' }).click();
      await expect(phoneBox).toHaveAttribute('aria-invalid', 'true');
      await expect(nameBox).toHaveValue(fullName);
      expect(posts, 'dữ liệu sai thì không gửi lên máy chủ').toBe(0);

      // SĐT của khách đã có: KHÔNG có banner "đã có khách hàng với số điện thoại này" (đã bỏ tra trùng, FR-03), không chặn lưu.
      await phoneBox.fill(existing.phone);
      await phoneBox.blur();
      await waitPastLegacyDebounce(page); // chờ thật quá debounce 500 ms cũ của kiểm trùng (kiểm phủ định)
      expect(legacyCalls, 'gõ SĐT trùng không gọi phone-lookups').toEqual([]);
      await expect(page.getByText('Đã có khách hàng với số điện thoại này')).toHaveCount(0);
      await expect(page.getByText('Chưa có, tạo được')).toHaveCount(0);
      await expect(phoneBox).not.toHaveAttribute('aria-invalid', 'true');
      // Người dùng bỏ trống SĐT (luồng chính của ca này): xoá số rồi lưu.
      await phoneBox.fill('');
      await page.getByRole('button', { name: 'Lưu khách hàng' }).click();

      await expect(toast(page, 'Thêm khách hàng thành công')).toContainText(`${fullName} đã được thêm vào hệ thống.`);
      // Điều hướng sau lưu: vào chi tiết CHÍNH khách vừa tạo (không về danh sách/giữ form).
      await expect(page).toHaveURL(/\/crm\/customers\/[0-9a-f]{24}$/);
      await expect(page.getByRole('heading', { name: fullName }).first()).toBeVisible();
      const header = page.getByRole('region', { name: mode === 'desktop' ? 'Hồ sơ khách hàng' : 'Tóm tắt hồ sơ' });
      await expect(header).toContainText('Phụ trách chính: Nhân viên Một');
      // Mã khách hiện ở chi tiết (desktop cạnh tên; mobile ở hàng đầu).
      const codeLocator = mode === 'desktop' ? header.getByText(CODE_RE) : page.getByTestId('customer-detail-mobile').getByText(CODE_RE).first();
      const shownCode = (await codeLocator.innerText()).match(CODE_RE)![0];
      // Không SĐT: không dòng SĐT/"Hiện số", không nút Gọi/Zalo (ẩn chứ không disable) nhưng vẫn còn Ghi chú + đặt hẹn.
      await expect(page.getByRole('button', { name: 'Hiện số' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^(Gọi|Zalo|Nhắn Zalo)/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Ghi chú', exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: mode === 'desktop' ? 'Đặt lịch hẹn' : 'Hẹn nhắc' })).toBeVisible();

      // Hậu trường: phone rỗng, mã đúng như UI, người tạo là PRIMARY.
      const rows = await backstage.find('customers', { fullName });
      expect(rows).toHaveLength(1);
      expect(rows[0].phone ?? null).toBeNull();
      expect(rows[0].customerCode).toBe(shownCode);
      expect(rows[0].careTeam.map((m: { userId: unknown; role: string }) => [String(m.userId), m.role])).toEqual([[seed.users.staff1.id, 'PRIMARY']]);
      // Trùng SĐT được phép: khách mẫu cũ vẫn còn đúng 1 bản ghi.
      expect(await backstage.count('customers', { fullName: existing.fullName })).toBe(1);

      // Back không quay về form đã lưu.
      await page.goBack();
      await expect(page).toHaveURL(/\/crm\/customers$/);
      expectNoLegacyCalls(net);
    });
  }

  for (const mode of MODES) {
    test(`F12-02 [${mode}] khách không SĐT vẫn đủ việc: danh sách ẩn Gọi/Zalo, Ghi chú mở được, đặt lịch mang khách và lưu xong QUAY LẠI chi tiết khách`, async ({ loginAs, api, backstage }, testInfo) => {
      const c = await api.createCustomerNoPhone();
      const withPhone = await api.createCustomer({ label: 'Khách-CóSĐT' });
      const page = await loginAs('staff1');
      const net = trackNet(page);
      if (mode === 'mobile') await useMobile(page);

      await page.goto('/crm/customers');
      await searchList(page, mode, c.customerCode); // tìm theo MÃ (FR-09 mục 3)
      const row = listItem(page, mode, c.fullName);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(c.customerCode);
      // Khách không SĐT: không dấu "·" thừa, không nút Gọi/Zalo; khách có SĐT (đối chứng) có nút Gọi.
      await expect(row).not.toContainText('·');
      await expect(row.getByRole('button', { name: /^(Gọi|Zalo)/ })).toHaveCount(0);
      await searchList(page, mode, withPhone.fullName);
      await expect(listItem(page, mode, withPhone.fullName).getByRole('button', { name: /^Gọi/ })).toHaveCount(1);

      // Vào chi tiết khách không SĐT, đặt lịch hẹn: khách được mang sang (không chọn lại), khóa.
      await openCustomerDetail(page, c.id, c.fullName);
      let clicks = 0;
      await page.getByRole('button', { name: mode === 'desktop' ? 'Đặt lịch hẹn' : 'Hẹn nhắc' }).click();
      clicks += 1;
      await expect(page).toHaveURL(new RegExp(`/crm/appointments/new\\?customerId=${c.id}$`));
      await expect(page.getByRole('group', { name: /^Khách hàng/ })).toContainText(c.fullName);
      await expect(page.getByRole('button', { name: /Thay đổi khách|Chọn khách/ })).toHaveCount(0);

      const slot = tomorrowSlot();
      await page.getByRole('textbox', { name: /^Địa điểm/ }).fill('Văn phòng bán hàng');
      await setSchedule(page, slot);
      await page.getByRole('button', { name: 'Xác nhận tạo lịch hẹn' }).click();
      clicks += 1;
      // Điều hướng sau lưu: về CHI TIẾT khách đang xem, không đẩy sang màn Lịch hẹn.
      await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`));
      await expect(page.getByRole('heading', { name: c.fullName }).first()).toBeVisible();
      expect((await backstage.find('appointments')).filter((a) => String(a.customerId) === c.id)).toHaveLength(1);
      note(testInfo, 'TT', `Từ chi tiết khách không SĐT đến lưu lịch hẹn: ${clicks} click + 2 ô nhập (địa điểm, giờ).`);

      // Ghi chú chăm sóc vẫn mở được (thiếu SĐT không làm mất chức năng ghi nhật ký).
      if (mode === 'desktop') {
        const form = await openCareLogComposer(page);
        await expect(form).toBeVisible();
      } else {
        await page.getByRole('button', { name: 'Ghi chú', exact: true }).first().click();
        await expect(page.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeVisible();
      }
      expectNoLegacyCalls(net);
    });
  }

  for (const mode of MODES) {
    test(`F12-03 [${mode}] danh sách hiện mã khách cạnh SĐT ở mọi vai trò; tìm theo mã ra đúng khách; chi tiết hiện mã`, async ({ loginAs, api }) => {
      const c = await api.createCustomer({ label: 'Khách-Mã' });
      const code = await api.customerCodeOf(c.id);
      expect(code).toMatch(CODE_RE);
      const phoneShown = maskedOf(c.phone);
      for (const role of ['staff1', 'mgr1', 'admin'] as const) {
        const page = await loginAs(role);
        const net = trackNet(page);
        if (mode === 'mobile') await useMobile(page);
        await page.goto('/crm/customers');
        await searchList(page, mode, code);
        const item = listItem(page, mode, c.fullName);
        await expect(item, `${role} tìm theo mã ${code}`).toHaveCount(1);
        // Mã đứng cạnh SĐT trong cùng một dòng thông tin: "KH-000123 · 0931 ••• 567".
        await expect(item).toContainText(code);
        await expect(item).toContainText(phoneShown);
        await expect(item.getByText(code).locator('xpath=..')).toContainText(phoneShown);
        await expect(item).not.toContainText(formatPhone(c.phone)); // SĐT đầy đủ không lộ ở danh sách

        // Chi tiết hiện mã (mọi vai trò).
        await item.getByRole('button', { name: c.fullName, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`));
        await expect(page.getByRole('heading', { name: c.fullName }).first()).toBeVisible();
        const scope = mode === 'desktop' ? page.getByRole('region', { name: 'Hồ sơ khách hàng' }) : page.getByTestId('customer-detail-mobile');
        await expect(scope.getByText(code).first()).toBeVisible();
        expectNoLegacyCalls(net);
      }
    });
  }

  for (const mode of MODES) {
    test(`F12-04 [${mode}] Admin/Manager có thông tin + bộ lọc "Phụ trách chính"; Nhân viên không có; lọc ra đúng khách`, async ({ loginAs, api, seed }) => {
      const stamp = uid();
      const a = await api.createCustomer({ role: 'staff1', label: `F12L${stamp}-Một` });
      const b = await api.createCustomer({ role: 'staff2', label: `F12L${stamp}-Hai` });
      const keyword = `F12L${stamp}`;

      // Nhân viên: không cột/dòng "Chăm sóc chính", hộp lọc nâng cao CÓ "Người phụ trách" nhưng KHÔNG có "Phụ trách chính".
      const staff = await loginAs('staff1');
      const staffNet = trackNet(staff);
      if (mode === 'mobile') await useMobile(staff);
      await staff.goto('/crm/customers');
      await searchList(staff, mode, keyword);
      await expect(listItem(staff, mode, a.fullName)).toHaveCount(1);
      if (mode === 'desktop') await expect(staff.getByRole('columnheader', { name: 'Người chăm sóc chính' })).toHaveCount(0);
      else await expect(listItem(staff, mode, a.fullName)).not.toContainText('Chăm sóc:');
      await staff.getByRole('button', { name: /Bộ lọc nâng cao/ }).click();
      await expect(staff.getByRole('group', { name: 'Người phụ trách (chính hoặc hỗ trợ)' })).toBeVisible();
      await expect(staff.getByRole('group', { name: 'Phụ trách chính' })).toHaveCount(0);
      expectNoLegacyCalls(staffNet);

      // Admin và Manager: có cột/dòng người chăm sóc chính (tên), có nhóm lọc "Phụ trách chính".
      for (const role of ['admin', 'mgr1'] as const) {
        const page = await loginAs(role);
        const net = trackNet(page);
        if (mode === 'mobile') await useMobile(page);
        await page.goto('/crm/customers');
        await searchList(page, mode, keyword);
        const rowA = listItem(page, mode, a.fullName);
        await expect(rowA).toHaveCount(1);
        if (mode === 'desktop') {
          await expect(page.getByRole('columnheader', { name: 'Người chăm sóc chính' }), `${role} thấy cột`).toBeVisible();
          await expect(rowA).toContainText('Nhân viên Một');
        } else {
          await expect(rowA).toContainText('Chăm sóc:');
          await expect(rowA).toContainText('Nhân viên Một');
        }
        if (role === 'mgr1') {
          // Manager chỉ thấy khách trong phạm vi nhóm mình: khách của staff2 (nhóm 2) không xuất hiện.
          await expect(listItem(page, mode, b.fullName)).toHaveCount(0);
          expectNoLegacyCalls(net);
          continue;
        }
        await expect(listItem(page, mode, b.fullName)).toHaveCount(1);

        await page.getByRole('button', { name: /Bộ lọc nâng cao/ }).click();
        const primaryGroup = page.getByRole('group', { name: 'Phụ trách chính' });
        await expect(primaryGroup).toBeVisible();
        // Các lựa chọn nạp từ customer-assignees: có cả hai nhân viên seed.
        await expect(primaryGroup.getByRole('button', { name: 'Nhân viên Một' })).toBeVisible();
        await expect(primaryGroup.getByRole('button', { name: 'Nhân viên Hai' })).toBeVisible();
        await primaryGroup.getByRole('button', { name: 'Nhân viên Hai' }).click();
        const filtered = page.waitForResponse((r) => r.request().method() === 'GET' && /\/crm\/customers\?/.test(r.url()));
        await page.getByRole('button', { name: 'Áp dụng' }).click();
        await filtered;
        // Điều hướng/ngữ cảnh: hộp đóng, từ khoá tìm vẫn còn, chỉ còn khách của Nhân viên Hai.
        await expect(page.getByRole('dialog', { name: 'Bộ lọc nâng cao' })).toHaveCount(0);
        await expect(listItem(page, mode, b.fullName)).toHaveCount(1);
        await expect(listItem(page, mode, a.fullName)).toHaveCount(0);
        await expect(mode === 'desktop' ? page.getByRole('searchbox', { name: 'Tìm kiếm' }) : page.getByRole('textbox', { name: 'Tìm khách hàng' })).toHaveValue(keyword);
        expect(seed.users.staff2.id).toBeTruthy();
        expectNoLegacyCalls(net);
      }
    });
  }

  for (const mode of MODES) {
    test(`F12-05 [${mode}] khách có PRIMARY bị khóa: danh sách + chi tiết hiện nhãn "đã khóa", ô lọc "Người phụ trách" có "(đã khóa)" và vẫn lọc được (Admin)`, async ({ loginAs, api, seed }) => {
      const label = `Tạm-Khóa-${uid()}`;
      const temp = await createStaffWithToken(api, seed.teams.team1, label);
      const created = await api.callWithToken(temp.token, 'POST', '/crm/customers', { fullName: `Khách-PrimaryKhóa-${uid()}` });
      expect(created.status).toBe(201);
      const customerId = String(created.data.id ?? created.data._id);
      const fullName = String(created.data.fullName);
      try {
        const blocked = await api.call('admin', 'PATCH', `/users/${temp.id}/status`, { status: 'BLOCKED' });
        expect(blocked.status).toBeLessThan(300);

        const admin = await loginAs('admin');
        const net = trackNet(admin);
        if (mode === 'mobile') await useMobile(admin);
        await admin.goto('/crm/customers');
        await searchList(admin, mode, fullName);
        const item = listItem(admin, mode, fullName);
        await expect(item).toHaveCount(1);
        await expect(item).toContainText(label);
        await expect(item).toContainText('đã khóa');

        // Ô lọc "Người phụ trách": người bị khóa có hậu tố " (đã khóa)" (cùng chữ với thẻ khách) và VẪN chọn được để lọc khách cũ của họ.
        const lockedLabel = `${label} (đã khóa)`;
        const customersLoaded = () => admin.waitForResponse((r) => r.request().method() === 'GET' && /\/crm\/customers\?/.test(r.url()));
        if (mode === 'desktop') {
          // Ô chọn nhanh trên thanh lọc (chỉ có ở desktop).
          const quick = admin.getByLabel('Người phụ trách');
          await expect.poll(async () => quick.locator('option').allInnerTexts()).toContain(lockedLabel);
          expect(await quick.locator('option').allInnerTexts()).not.toContain(label); // chỉ còn nhãn có hậu tố
          let loaded = customersLoaded();
          await quick.selectOption({ label: 'Nhân viên Một' });
          await loaded;
          await expect(item).toHaveCount(0); // lọc theo người khác: khách của người bị khóa biến mất
          loaded = customersLoaded();
          await quick.selectOption({ label: lockedLabel });
          await loaded;
          await expect(item).toHaveCount(1); // chọn người bị khóa: khách của họ hiện lại, từ khóa tìm giữ nguyên
          await expect(admin.getByRole('searchbox', { name: 'Tìm kiếm' })).toHaveValue(fullName);
        }
        // Nhóm chip ở Bộ lọc nâng cao (desktop: hộp thoại; mobile: bottom sheet, nơi duy nhất có ô lọc người phụ trách).
        await admin.getByRole('button', { name: /Bộ lọc nâng cao/ }).click();
        const assigneeGroup = admin.getByRole('group', { name: 'Người phụ trách (chính hoặc hỗ trợ)' });
        await expect(assigneeGroup).toBeVisible();
        const lockedChip = assigneeGroup.getByRole('button', { name: lockedLabel, exact: true });
        await expect(lockedChip).toBeVisible();
        await expect(assigneeGroup.getByRole('button', { name: label, exact: true })).toHaveCount(0);
        if (mode === 'desktop') {
          await expect(lockedChip).toHaveAttribute('aria-pressed', 'true'); // đã chọn từ ô nhanh, chip phản ánh đúng
        } else {
          await expect(lockedChip).toHaveAttribute('aria-pressed', 'false');
          await lockedChip.click();
          await expect(lockedChip).toHaveAttribute('aria-pressed', 'true');
          const loaded = customersLoaded();
          await admin.getByRole('button', { name: 'Áp dụng' }).click();
          await loaded;
          await expect(admin.getByRole('dialog', { name: 'Bộ lọc nâng cao' })).toHaveCount(0);
          await expect(item).toHaveCount(1);
        }
        if (mode === 'desktop') await admin.getByRole('button', { name: 'Áp dụng' }).click();

        await item.getByRole('button', { name: fullName, exact: true }).click();
        await expect(admin.getByRole('heading', { name: fullName }).first()).toBeVisible();
        const card = await openCareTeam(admin, mode);
        await expect(card).toContainText(label);
        await expect(card).toContainText('Chủ khách');
        await expect(card).toContainText('đã khóa');
        // PRIMARY (kể cả bị khóa) cố định: không nút gỡ/đổi.
        await expect(card.getByRole('button', { name: /Gỡ .* khỏi nhóm chăm sóc/ })).toHaveCount(0);
        await expect(card.getByRole('button', { name: /Đổi|Đặt người chăm sóc chính/ })).toHaveCount(0);
        expect(customerId).toMatch(/^[0-9a-f]{24}$/);
        expectNoLegacyCalls(net);
      } finally {
        await api.call('admin', 'PATCH', `/users/${temp.id}/status`, { status: 'ACTIVE' });
      }
    });
  }

  for (const mode of MODES) {
    test(`F12-06 [${mode}] PRIMARY mời người NHÓM KHÁC: danh sách "tên · nhóm" không lộ email, mời xong ở lại chi tiết, người được mời thấy khách; không đổi/gỡ chính, không xin tham gia`, async ({ loginAs, api, backstage, seed }) => {
      const c = await api.createCustomer({ label: 'Khách-Mời' });
      const page = await loginAs('staff1');
      const net = trackNet(page);
      if (mode === 'mobile') await useMobile(page);
      await openCustomerDetail(page, c.id, c.fullName);
      const card = await openCareTeam(page, mode);

      // PRIMARY: cố định, không nút gỡ/đổi; không có lối "xin tham gia".
      await expect(card).toContainText('Nhân viên Một');
      await expect(card).toContainText('Chủ khách');
      await expect(card.getByText('Người chăm sóc chính được cố định, không đổi hoặc gỡ được.')).toBeVisible();
      await expect(card.getByRole('button', { name: /Gỡ Nhân viên Một/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Xin tham gia|Đề nghị tham gia|Đổi người chăm sóc|Đổi người chính|Gỡ người chăm sóc chính/i })).toHaveCount(0);
      await expect(card.getByText(/\d+\/10 thành viên phụ/)).toBeVisible();

      // Mở khung mời: truy vấn invitees chỉ chạy khi mở; chỉ tên + nhóm.
      const inviteesLoaded = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('/crm/care-team-invitees'));
      await card.getByRole('button', { name: 'Mời người' }).click();
      const invitees = await inviteesLoaded;
      expect(invitees.status()).toBe(200);
      const inviteesBody = await invitees.text();
      expect(inviteesBody).not.toMatch(/@|email|phone|nationalId/i);
      const list = card.getByRole('list', { name: 'Danh sách người có thể mời' });
      await expect(list.getByText('Nhân viên Hai · Nhóm E2E 2')).toBeVisible(); // người nhóm khác: mời được
      await expect(list.getByText(/^Nhân viên Một/)).toHaveCount(0); // người gọi không nằm trong danh sách mời

      // Tìm và chọn; nút mời hiện số người; mời xong ở lại chi tiết khách (không mất ngữ cảnh), khung đóng, nhóm cập nhật.
      const search = card.getByRole('searchbox', { name: 'Tìm người để mời' });
      await search.fill('Hai');
      await expect(list.getByText('Nhân viên Hai · Nhóm E2E 2')).toBeVisible();
      await list.getByRole('checkbox', { name: /Nhân viên Hai/ }).check();
      await card.getByRole('button', { name: 'Mời 1 người' }).click();
      await expect(toast(page, 'Đã mời 1 người vào nhóm chăm sóc')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`));
      await expect(card.getByRole('searchbox', { name: 'Tìm người để mời' })).toHaveCount(0);
      const memberRow = card.getByRole('listitem').filter({ hasText: 'Nhân viên Hai' });
      await expect(memberRow).toContainText('Cùng chăm sóc');
      await expect(card.getByText('1/10 thành viên phụ')).toBeVisible();

      const dbRow = (await backstage.find('customers', { _id: await objectId(backstage, c.id) }))[0];
      expect(dbRow.careTeam.map((m: { userId: unknown; role: string }) => [String(m.userId), m.role])).toEqual([
        [seed.users.staff1.id, 'PRIMARY'],
        [seed.users.staff2.id, 'MEMBER'],
      ]);

      // Người được mời (nhóm khác) thấy khách và nhóm chăm sóc, nhưng KHÔNG mời/gỡ được (chỉ PRIMARY/Manager/Admin).
      const invited = await loginAs('staff2');
      const invitedNet = trackNet(invited);
      if (mode === 'mobile') await useMobile(invited);
      await openCustomerDetail(invited, c.id, c.fullName);
      const invitedCard = await openCareTeam(invited, mode);
      await expect(invitedCard).toContainText('Nhân viên Một');
      await expect(invitedCard.getByRole('button', { name: 'Mời người' })).toHaveCount(0);
      await expect(invitedCard.getByRole('button', { name: /Gỡ .* khỏi nhóm chăm sóc/ })).toHaveCount(0);
      const forbidden = await api.call('staff2', 'POST', `/crm/customers/${c.id}/care-team/members`, { userIds: [seed.users.mgr1.id] });
      expect(forbidden.status).toBe(403);
      expectNoLegacyCalls(invitedNet);

      // PRIMARY gỡ thành viên phụ: có phản hồi, ở lại chi tiết; PRIMARY không gỡ được (API 409).
      await memberRow.getByRole('button', { name: 'Gỡ Nhân viên Hai khỏi nhóm chăm sóc' }).click();
      await expect(toast(page, 'Đã gỡ Nhân viên Hai khỏi nhóm chăm sóc')).toBeVisible();
      await expect(memberRow).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`));
      const lockedRemove = await api.call('admin', 'DELETE', `/crm/customers/${c.id}/care-team/members/${seed.users.staff1.id}`);
      expect(lockedRemove.status).toBe(409);
      expectNoLegacyCalls(net);
    });
  }

  test('F12-07 Việc hôm nay (Admin, "Cả nhóm"): ô "Người phụ trách" nạp từ customer-assignees; danh sách khách cũng gọi đúng nguồn đó', async ({ loginAs, api }) => {
    const c = await api.createCustomer({ label: 'Khách-NguồnLọc' });
    await api.createCareLog({ customerId: c.id, content: 'Ghi chú để có việc', nextAction: undefined });
    const page = await loginAs('admin');
    const net = trackNet(page);

    const assigneesForList = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('/crm/customer-assignees'));
    await page.goto('/crm/customers');
    const listResponse = await assigneesForList;
    expect(listResponse.status()).toBe(200);
    const listBody = (await listResponse.json()) as { data: Array<{ displayName?: string; fullName?: string }> };
    const names = listBody.data.map((u) => u.displayName ?? u.fullName);
    expect(names).toEqual(expect.arrayContaining(['Nhân viên Một', 'Nhân viên Hai']));
    expect(JSON.stringify(listBody)).not.toMatch(/@example\.test|email|phone/i); // chỉ tên, không lộ email/SĐT
    // Ô lọc nhanh "Người phụ trách" liệt kê đúng những người máy chủ trả.
    const options = await page.getByLabel('Người phụ trách').locator('option').allInnerTexts();
    expect(options).toEqual(expect.arrayContaining(['Tất cả', 'Nhân viên Một', 'Nhân viên Hai']));

    // Chọn người ở ô lọc nhanh: danh sách thu hẹp theo người đó, từ khoá/tình trạng giữ nguyên.
    await searchCustomers(page, c.fullName);
    await page.getByLabel('Người phụ trách').selectOption({ label: 'Nhân viên Hai' });
    await expect(page.getByText('Không có khách hàng phù hợp')).toBeVisible();
    await page.getByLabel('Người phụ trách').selectOption({ label: 'Nhân viên Một' });
    await expect(page.getByRole('row').filter({ hasText: c.fullName })).toHaveCount(1);

    // Việc hôm nay, phạm vi "Cả nhóm": ô "Người phụ trách" cũng có các lựa chọn từ nguồn này.
    await page.goto('/crm/today');
    await expect(page.getByRole('heading', { name: 'Việc hôm nay' })).toBeVisible();
    await page.getByLabel('Phạm vi').selectOption('team');
    const assignee = page.getByLabel('Người phụ trách');
    await expect(assignee).toBeVisible();
    await expect.poll(async () => (await assignee.locator('option').allInnerTexts()).join('|')).toContain('Nhân viên Một');
    expect((await assignee.locator('option').allInnerTexts())).toEqual(expect.arrayContaining(['Tất cả', 'Nhân viên Hai']));
    expectNoLegacyCalls(net);
  });

  test('F12-08 [mobile] Nhân viên: danh sách thẻ + mở bộ lọc nâng cao chỉ gọi customer-assignees (không lộ người nhóm khác), không endpoint cũ', async ({ loginAs, api }) => {
    const c = await api.createCustomer({ label: 'Khách-MobileLọc' });
    const page = await loginAs('staff2');
    const net = trackNet(page);
    await useMobile(page);
    await page.goto('/crm/customers');
    await expect(page.getByRole('textbox', { name: 'Tìm khách hàng' })).toBeVisible();
    const assignees = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('/crm/customer-assignees'));
    await page.getByRole('button', { name: /Bộ lọc nâng cao/ }).click();
    expect((await assignees).status()).toBe(200);
    const group = page.getByRole('group', { name: 'Người phụ trách (chính hoặc hỗ trợ)' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button', { name: 'Nhân viên Một' })).toHaveCount(0); // khách nhóm 1 không thuộc phạm vi xem của staff2
    await expect(page.locator('body')).not.toContainText(c.fullName);
    expectNoLegacyCalls(net);
  });

  for (const role of ['staff1', 'mgr1', 'admin'] as const) {
    test(`F12-09 [${role}] đi qua các màn CRM: không request tới phone-lookups / assignable-users / care-team-requests`, async ({ loginAs, api }) => {
      test.setTimeout(180_000); // mỗi lần goto tải lại cả SPA (Vite dev), nhiều màn nên cần dư thời gian
      const c = await api.createCustomer({ label: 'Khách-QuétMạng' });
      const paths = ['/crm/today', '/crm/customers', `/crm/customers/${c.id}`, '/crm/appointments', `/crm/appointments/new?customerId=${c.id}`, '/crm/reports', '/crm/projects', ...(role === 'admin' ? ['/crm/settings'] : [])];
      const page = await loginAs(role);
      const net = trackNet(page);
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator('main, #root').first()).toBeVisible();
        await page.waitForLoadState('networkidle'); // chờ request lười của màn tải xong rồi mới sang màn kế
      }
      // Chi tiết khách: mở khung mời (PRIMARY/Manager/Admin) cũng không gọi endpoint cũ.
      await page.goto(`/crm/customers/${c.id}`);
      const invite = page.getByRole('button', { name: 'Mời người' });
      await expect(invite).toBeVisible();
      await invite.click();
      await expect(page.getByRole('searchbox', { name: 'Tìm người để mời' })).toBeVisible();
      // Form Thêm khách: gõ SĐT trùng (khách mẫu) cũng không gọi tra trùng.
      await page.goto('/crm/customers/new');
      await page.getByLabel('Số điện thoại').fill(c.phone);
      await page.getByLabel('Họ và tên khách hàng').fill('Khách quét mạng');
      await waitPastLegacyDebounce(page); // chờ thật quá debounce 500 ms cũ: nếu còn tra trùng thì request đã được gửi trước khi kiểm cuối
      expectNoLegacyCalls(net);
    });
  }

  test('F12-10 phía máy chủ: các endpoint đã bỏ (phone-lookups, assignable-users, care-team-requests, đổi người chính) không còn', async ({ api, seed }) => {
    const c = await api.createCustomer({ label: 'Khách-APICũ' });
    const lookup = await api.call('staff1', 'POST', '/crm/customers/phone-lookups', { phone: c.phone });
    expect([404, 405]).toContain(lookup.status);
    expect((await api.call('staff1', 'GET', '/crm/assignable-users')).status).toBe(404);
    expect((await api.call('admin', 'GET', '/crm/care-team-requests')).status).toBe(404);
    expect((await api.call('staff2', 'POST', '/crm/care-team-requests', { customerRef: c.id })).status).toBe(404);
    expect((await api.call('admin', 'PUT', `/crm/customers/${c.id}/care-team/primary`, { userId: seed.users.staff2.id })).status).toBe(404);
  });
});

/** ObjectId từ chuỗi hex cho truy vấn Mongo tạm (driver lấy từ backend qua `lib`). */
async function objectId(backstage: import('../lib/backstage').Backstage, id: string): Promise<unknown> {
  const { lib } = await import('../lib/infra');
  const { ObjectId } = lib('mongodb');
  void backstage;
  return new ObjectId(id);
}
