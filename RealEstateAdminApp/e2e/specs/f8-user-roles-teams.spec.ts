/**
 * F8 - Một tài khoản có NHIỀU vai trò và NHIỀU nhóm (v1.0.3 mục A/C): Admin gán 2 vai trò + 2 nhóm ở Cài đặt CRM > Người dùng.
 * Dùng tài khoản RIÊNG tạo bằng API (không đụng tài khoản seed dùng chung giữa các spec).
 * Kiểm cả 3 điểm UX: (1) thấy đủ vai trò/nhóm ngay trên dòng người dùng, (2) lưu xong quay về đúng danh sách (không mất ngữ cảnh),
 * (3) backend ghi đúng (roles, teamIds, trường suy ra role/teamId).
 */
import { test, expect } from '../fixtures';
import { TEST_PASSWORD, URLS } from '../env';
import { toast } from '../lib/ui';

type UserRow = { _id: string; roles: string[]; status: string; teamIds: string[] };

/** Admin đã bị khóa tạm trong test (F8-03) cần mở lại ở afterEach — mở lại lỗi thì test ĐỎ rõ ràng (không để lại stack E2E thiếu Admin). */
const blockedAdmins: { token: string; ids: string[] } = { token: '', ids: [] };

/** Access token của tài khoản tạo riêng (đăng nhập thật; /auth/login bị throttle nên chờ rồi thử lại khi gặp 429). */
async function loginToken(email: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${URLS.api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: TEST_PASSWORD }) });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      continue;
    }
    expect(res.status).toBeLessThan(300);
    const body = (await res.json()) as { data?: { accessToken: string }; accessToken?: string };
    return (body.data ?? body).accessToken as string;
  }
  throw new Error('[E2E] đăng nhập tài khoản riêng bị throttle quá lâu');
}

test.describe('f8-user-roles-teams', () => {
  test.afterEach(async ({ api }) => {
    const { token, ids } = blockedAdmins;
    blockedAdmins.ids = [];
    // Thử mở lại TẤT CẢ (một Admin lỗi không được làm các Admin còn lại bị bỏ sót), rồi gom lỗi và làm test đỏ ở cuối.
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const reopened = await api.callWithToken(token, 'PATCH', `/users/${id}/status`, { status: 'ACTIVE' });
        if (reopened.status >= 300) failures.push(`Admin ${id}: ${reopened.status} ${JSON.stringify(reopened.data)}`);
      } catch (error) {
        failures.push(`Admin ${id}: ${String(error)}`);
      }
    }
    expect(failures, 'mở lại Admin sau test').toEqual([]);
  });

  test('F8-01 Admin gán 2 vai trò + 2 nhóm: dòng người dùng hiện đủ, backend ghi roles/teamIds đúng; bỏ hết vai trò nhóm thì gỡ nhóm', async ({ loginAs, api, seed }) => {
    const stamp = Date.now().toString(36);
    const displayName = `Nhân sự F8 ${stamp}`;
    const created = await api.call('admin', 'POST', '/users', { email: `f8-${stamp}@example.test`, password: TEST_PASSWORD, displayName, roles: ['STAFF'] });
    expect(created.status).toBe(201);
    const userId = String(created.data._id ?? created.data.id);

    const admin = await loginAs('admin');
    await admin.goto('/crm/settings');
    await admin.getByRole('tab', { name: 'Người dùng' }).click();
    const row = admin.getByRole('listitem').filter({ hasText: displayName });
    await expect(row).toBeVisible();
    await expect(row.getByText('Nhân viên')).toBeVisible();
    await expect(row.getByText('Chưa có nhóm')).toBeVisible();

    // Thêm Quản lý + hai nhóm.
    await row.getByRole('button', { name: `Sửa ${displayName}` }).click();
    const form = admin.getByRole('form', { name: 'Sửa người dùng' });
    await form.getByRole('checkbox', { name: 'Quản lý' }).check({ force: true });
    await form.getByRole('checkbox', { name: 'Nhóm E2E 1' }).check({ force: true });
    await form.getByRole('checkbox', { name: 'Nhóm E2E 2' }).check({ force: true });
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(toast(admin, `Đã lưu người dùng ${displayName}`)).toBeVisible();
    // Không mất ngữ cảnh: form đóng, vẫn đứng ở tab Người dùng và thấy đủ vai trò + nhóm trên đúng dòng.
    await expect(form).toBeHidden();
    await expect(admin.getByRole('tab', { name: 'Người dùng', selected: true })).toBeVisible();
    await expect(row.getByText('Quản lý')).toBeVisible();
    await expect(row.getByText('Nhân viên')).toBeVisible();
    await expect(row.getByText('Nhóm E2E 1')).toBeVisible();
    await expect(row.getByText('Nhóm E2E 2')).toBeVisible();

    const after = await api.call('admin', 'GET', `/users?limit=100`);
    const saved = (after.data as unknown as Array<Record<string, unknown>>).find((user) => String(user._id) === userId);
    expect(saved).toMatchObject({ role: 'MANAGER', roles: ['MANAGER', 'STAFF'], teamId: seed.teams.team1, teamIds: [seed.teams.team1, seed.teams.team2] });

    // Bỏ cả Quản lý lẫn Nhân viên (đổi sang Quản trị): ô nhóm biến mất, cảnh báo gỡ nhóm, lưu xong không còn nhóm.
    await row.getByRole('button', { name: `Sửa ${displayName}` }).click();
    await form.getByRole('checkbox', { name: 'Quản trị' }).check({ force: true });
    await form.getByRole('checkbox', { name: 'Quản lý' }).uncheck({ force: true });
    await form.getByRole('checkbox', { name: 'Nhân viên' }).uncheck({ force: true });
    await expect(form.getByRole('checkbox', { name: 'Nhóm E2E 1' })).toBeHidden();
    await expect(form.getByRole('note')).toContainText('gỡ tài khoản này khỏi mọi nhóm');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form).toBeHidden();
    await expect(row.getByText('Quản trị')).toBeVisible();
    await expect(row.getByText('Nhóm E2E 1')).toBeHidden();

    const cleared = await api.call('admin', 'GET', `/users?limit=100`);
    const cleanUser = (cleared.data as unknown as Array<Record<string, unknown>>).find((user) => String(user._id) === userId);
    expect(cleanUser).toMatchObject({ role: 'ADMIN', roles: ['ADMIN'], teamId: null, teamIds: [] });
  });

  test('F8-02 Admin (còn Admin khác) tự bỏ Quản trị + thêm nhóm: lưu đủ 3 bước, về /crm/today với MỘT thông điệp, menu mất Cài đặt CRM', async ({ loginWithToken, api, seed }) => {
    const stamp = Date.now().toString(36);
    const displayName = `Admin tự hạ F8 ${stamp}`;
    const email = `f8-self-${stamp}@example.test`;
    const created = await api.call('admin', 'POST', '/users', { email, password: TEST_PASSWORD, displayName, roles: ['ADMIN', 'STAFF'], teamIds: [seed.teams.team1] });
    expect(created.status).toBe(201);
    const userId = String(created.data._id ?? created.data.id);

    const page = await loginWithToken(await loginToken(email));
    await page.goto('/crm/settings');
    await page.getByRole('tab', { name: 'Người dùng' }).click();
    await page.getByRole('button', { name: `Sửa ${displayName}` }).click();
    const form = page.getByRole('form', { name: 'Sửa người dùng' });
    await form.getByRole('checkbox', { name: 'Quản trị' }).uncheck({ force: true });
    await expect(form.getByRole('note')).toContainText('Bạn sắp bỏ vai trò Quản trị của chính mình');
    await form.getByRole('checkbox', { name: 'Nhóm E2E 2' }).check({ force: true });
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Về màn làm việc, chỉ một thông điệp thống nhất (không kèm toast lỗi "không có quyền").
    await expect(page).toHaveURL(/\/crm\/today$/);
    await expect(toast(page, /Bạn không còn là Quản trị/)).toBeVisible();
    await expect(toast(page, 'Bạn không có quyền vào trang này.')).toHaveCount(0);
    const sidebar = page.getByRole('complementary');
    if (!(await sidebar.getByRole('link', { name: 'Việc hôm nay', exact: true }).isVisible())) await sidebar.getByRole('button', { name: 'Quản lý khách hàng' }).click();
    await expect(sidebar.getByRole('link', { name: 'Việc hôm nay', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Cài đặt CRM', exact: true })).toHaveCount(0);

    const saved = ((await api.call('admin', 'GET', '/users?limit=100')).data as unknown as UserRow[]).find((user) => String(user._id) === userId);
    expect(saved).toMatchObject({ roles: ['STAFF'], teamIds: [seed.teams.team1, seed.teams.team2] });
  });

  test('F8-03 Admin DUY NHẤT tự bỏ Quản trị bị chặn: form còn mở, báo rõ phần đã lưu/chưa lưu, vẫn là Admin', async ({ loginWithToken, api, seed }) => {
    const stamp = Date.now().toString(36);
    const displayName = `Admin duy nhất F8 ${stamp}`;
    const email = `f8-sole-${stamp}@example.test`;
    const created = await api.call('admin', 'POST', '/users', { email, password: TEST_PASSWORD, displayName, roles: ['ADMIN'] });
    expect(created.status).toBe(201);
    const userId = String(created.data._id ?? created.data.id);
    const token = await loginToken(email);

    // Khóa mọi Admin đang hoạt động khác (kể cả tài khoản seed) để người này thành Admin duy nhất; mở lại ở afterEach.
    const others = ((await api.callWithToken(token, 'GET', '/users?limit=100')).data as unknown as UserRow[]).filter((user) => user.roles.includes('ADMIN') && user.status === 'ACTIVE' && String(user._id) !== userId);
    blockedAdmins.token = token;
    for (const other of others) {
      expect((await api.callWithToken(token, 'PATCH', `/users/${other._id}/status`, { status: 'BLOCKED' })).status).toBeLessThan(300);
      blockedAdmins.ids.push(String(other._id));
    }

    const page = await loginWithToken(token);
    await page.goto('/crm/settings');
    await page.getByRole('tab', { name: 'Người dùng' }).click();
    await page.getByRole('button', { name: `Sửa ${displayName}` }).click();
    const form = page.getByRole('form', { name: 'Sửa người dùng' });
    await form.getByRole('checkbox', { name: 'Nhân viên' }).check({ force: true });
    await form.getByRole('checkbox', { name: 'Quản trị' }).uncheck({ force: true });
    await form.getByRole('checkbox', { name: 'Nhóm E2E 1' }).check({ force: true });
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(form.getByText(/Đã lưu vai trò mới thêm, nhóm; chưa lưu được vai trò: Hệ thống phải còn ít nhất một Quản trị đang hoạt động/)).toBeVisible();
    await expect(page).toHaveURL(/\/crm\/settings$/);
    await expect(form).toBeVisible();

    const saved = ((await api.callWithToken(token, 'GET', '/users?limit=100')).data as unknown as UserRow[]).find((user) => String(user._id) === userId);
    expect(saved).toMatchObject({ roles: ['ADMIN', 'STAFF'], teamIds: [seed.teams.team1] });
  });
});
