/**
 * F9 - Thành viên nhóm (v1.0.2 mục C): Admin xem, thêm, gỡ thành viên ngay dưới dòng nhóm ở Cài đặt CRM > Nhóm.
 * Dùng tài khoản RIÊNG tạo bằng API; chỉ thêm/gỡ chính tài khoản đó vào nhóm 2 (không đụng tài khoản seed dùng chung).
 * Kiểm UX: panel mở tại chỗ (không rời màn), số thành viên của nhóm cập nhật, quản lý nhóm hiện badge, backend ghi đúng teamIds.
 */
import { test, expect } from '../fixtures';
import { TEST_PASSWORD } from '../env';
import { toast } from '../lib/ui';

test.describe('f9-team-members', () => {
  test('F9-01 Admin thêm rồi gỡ thành viên nhóm: danh sách + số thành viên + backend khớp', async ({ loginAs, api, seed }) => {
    const stamp = Date.now().toString(36);
    const displayName = `Thành viên F9 ${stamp}`;
    const created = await api.call('admin', 'POST', '/users', { email: `f9-${stamp}@example.test`, password: TEST_PASSWORD, displayName, roles: ['STAFF'] });
    expect(created.status).toBe(201);
    const userId = String(created.data._id ?? created.data.id);

    const admin = await loginAs('admin');
    await admin.goto('/crm/settings');
    await admin.getByRole('tab', { name: 'Nhóm' }).click();
    const teamRow = admin.getByRole('listitem').filter({ hasText: 'Nhóm E2E 2' }).first();
    await expect(teamRow).toBeVisible();
    const countText = async () => (await teamRow.getByText(/\d+ thành viên ·/).innerText()).match(/(\d+) thành viên/)![1];
    const before = Number(await countText());

    await teamRow.getByRole('button', { name: 'Thành viên nhóm Nhóm E2E 2' }).click();
    const panel = admin.getByRole('region', { name: 'Thành viên nhóm Nhóm E2E 2' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Nhân viên Hai')).toBeVisible(); // thành viên seed

    // Thêm: chọn người trong ô tìm rồi bấm Thêm thành viên.
    const picker = panel.getByRole('combobox', { name: 'Chọn người để thêm vào nhóm' });
    await picker.fill(displayName);
    await panel.getByRole('option', { name: new RegExp(displayName) }).click();
    await panel.getByRole('button', { name: 'Thêm thành viên' }).click();
    await expect(toast(admin, `Đã thêm ${displayName}`)).toBeVisible();
    const newRow = panel.getByRole('listitem').filter({ hasText: displayName });
    await expect(newRow).toBeVisible();
    // Không mất ngữ cảnh: panel vẫn mở; số thành viên của nhóm tăng 1.
    await expect(panel).toBeVisible();
    await expect(async () => expect(Number(await countText())).toBe(before + 1)).toPass();

    let users = (await api.call('admin', 'GET', '/users?limit=100')).data as unknown as Array<Record<string, unknown>>;
    expect(users.find((u) => String(u._id) === userId)).toMatchObject({ teamIds: [seed.teams.team2] });

    // Gỡ có hộp xác nhận.
    await newRow.getByRole('button', { name: `Gỡ ${displayName} khỏi nhóm` }).click();
    await admin.getByRole('button', { name: 'Gỡ khỏi nhóm' }).click();
    await expect(toast(admin, `Đã gỡ ${displayName}`)).toBeVisible();
    await expect(newRow).toBeHidden();
    await expect(async () => expect(Number(await countText())).toBe(before)).toPass();

    users = (await api.call('admin', 'GET', '/users?limit=100')).data as unknown as Array<Record<string, unknown>>;
    expect(users.find((u) => String(u._id) === userId)).toMatchObject({ teamIds: [], teamId: null });
  });
});
