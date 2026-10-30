/**
 * F10 - Xóa, khôi phục, xóa vĩnh viễn khách "Bỏ" (v1.0.3 mục D, doc 09 mục 7). Dùng khách RIÊNG tạo bằng API (tên có hậu tố ngẫu nhiên).
 * - F10-01 (Admin): chọn khách Bỏ -> Xóa hàng loạt kèm lý do -> thấy ở "Khách đã xóa" -> Khôi phục một khách -> Xóa vĩnh viễn khách còn lại
 *   (SĐT được giải phóng, backend không còn bản ghi).
 * - F10-02 (Nhân viên): option "Xóa" chỉ hiện khi MỌI khách Bỏ đang chọn do mình phụ trách chính; không vào được màn "Khách đã xóa".
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { uid, vnPhone, type Api } from '../lib/api';
import { toast } from '../lib/ui';
import type { RoleKey } from '../env';

/** Id tình trạng thuộc nhóm "Bỏ" (tình trạng hệ thống). */
async function droppedStatusId(api: Api): Promise<string> {
  const statuses = (await api.call('admin', 'GET', '/crm/customer-statuses')).data as unknown as Array<{ id: string; listGroup: string }>;
  const dropped = statuses.find((status) => status.listGroup === 'DROPPED');
  if (!dropped) throw new Error('[E2E] không có tình trạng thuộc nhóm Bỏ');
  return dropped.id;
}

async function createDropped(api: Api, role: RoleKey, statusId: string, label: string): Promise<{ id: string; fullName: string; phone: string }> {
  const fullName = `${label}-${uid()}`;
  const phone = vnPhone();
  const created = await api.call(role, 'POST', '/crm/customers', { fullName, phone, statusId });
  expect(created.status, JSON.stringify(created.data)).toBe(201);
  return { id: String(created.data.id ?? created.data._id), fullName, phone };
}

/** Mở tab "Bỏ" của danh sách khách. */
async function openDroppedTab(page: Page): Promise<void> {
  await page.goto('/crm/customers');
  await page.getByRole('group', { name: 'Danh sách theo tình trạng' }).getByRole('button', { name: /^Bỏ/ }).click();
}

const bulkSelect = (page: Page) => page.getByLabel('Hành động hàng loạt');
const deleteOption = (page: Page) => bulkSelect(page).getByRole('option', { name: 'Xóa', exact: true });

test.describe('f10-delete-customers', () => {
  test('F10-01 Admin xóa hàng loạt khách Bỏ kèm lý do, khôi phục một khách, xóa vĩnh viễn một khách', async ({ loginAs, api }) => {
    const statusId = await droppedStatusId(api);
    const restored = await createDropped(api, 'staff1', statusId, 'F10-KhoiPhuc');
    const purged = await createDropped(api, 'staff1', statusId, 'F10-XoaHan');

    const admin = await loginAs('admin');
    await openDroppedTab(admin);
    await admin.getByRole('checkbox', { name: `Chọn ${restored.fullName}` }).check();
    await admin.getByRole('checkbox', { name: `Chọn ${purged.fullName}` }).check();
    await bulkSelect(admin).selectOption('DELETE');
    await admin.getByRole('button', { name: 'Xóa', exact: true }).click();

    // Hộp xác nhận bắt buộc lý do: chưa nhập thì nút xóa bị khóa.
    const confirm = admin.getByRole('button', { name: 'Xóa 2 khách' });
    await expect(confirm).toBeDisabled();
    await admin.getByLabel(/Lý do xóa/).fill('Khách trùng, dọn dữ liệu E2E');
    await confirm.click();

    // Giữ ngữ cảnh: vẫn ở tab Bỏ của danh sách khách; 2 khách biến khỏi danh sách; thanh chọn hàng loạt đóng.
    await expect(toast(admin, 'Đã xóa 2 khách')).toBeVisible();
    await expect(admin).toHaveURL(/\/crm\/customers$/);
    await expect(admin.getByRole('checkbox', { name: `Chọn ${restored.fullName}` })).toHaveCount(0);
    await expect(admin.getByRole('checkbox', { name: `Chọn ${purged.fullName}` })).toHaveCount(0);
    await expect(bulkSelect(admin)).toHaveCount(0);

    // Backend: cả 2 nằm trong danh sách đã xóa kèm lý do.
    const deleted = (await api.call('admin', 'GET', `/crm/deleted-customers?q=${encodeURIComponent('F10-')}&limit=50`)).data as unknown as Array<{ id: string; deleteReason: string | null }>;
    expect(deleted.find((item) => item.id === restored.id)?.deleteReason).toBe('Khách trùng, dọn dữ liệu E2E');
    expect(deleted.find((item) => item.id === purged.id)).toBeTruthy();

    // Điều hướng tới màn "Khách đã xóa" bằng menu.
    const sidebar = admin.getByRole('complementary');
    if (!(await sidebar.getByRole('link', { name: 'Khách đã xóa', exact: true }).isVisible())) await sidebar.getByRole('button', { name: 'Quản lý khách hàng' }).click();
    await sidebar.getByRole('link', { name: 'Khách đã xóa', exact: true }).click();
    await expect(admin.getByRole('heading', { name: 'Khách đã xóa' })).toBeVisible();

    // Khôi phục một khách.
    await admin.getByLabel('Tìm khách đã xóa').fill(restored.fullName);
    const restoredRow = admin.getByRole('listitem').filter({ hasText: restored.fullName });
    await expect(restoredRow).toContainText('Lý do: Khách trùng, dọn dữ liệu E2E');
    await restoredRow.getByRole('button', { name: `Khôi phục ${restored.fullName}` }).click();
    await admin.getByRole('alertdialog').or(admin.getByRole('dialog')).getByRole('button', { name: 'Khôi phục' }).click();
    await expect(toast(admin, `Đã khôi phục khách ${restored.fullName}`)).toBeVisible();
    await expect(restoredRow).toHaveCount(0);
    expect((await api.call('admin', 'GET', `/crm/customers/${restored.id}`)).status).toBe(200);

    // Xóa vĩnh viễn khách còn lại: xác nhận 2 bước, gõ XOA mới bật nút.
    await admin.getByLabel('Tìm khách đã xóa').fill(purged.fullName);
    const purgedRow = admin.getByRole('listitem').filter({ hasText: purged.fullName });
    await purgedRow.getByRole('button', { name: `Xóa vĩnh viễn ${purged.fullName}` }).click();
    const dialog = admin.getByRole('alertdialog');
    await expect(dialog).toContainText('KHÔNG THỂ HOÀN TÁC');
    await dialog.getByRole('button', { name: 'Tôi hiểu, tiếp tục' }).click();
    const finalButton = dialog.getByRole('button', { name: 'Xóa vĩnh viễn' });
    await expect(finalButton).toBeDisabled();
    await dialog.getByLabel(/Gõ/).fill('XOA');
    await finalButton.click();
    await expect(toast(admin, `Đã xóa vĩnh viễn khách ${purged.fullName}`)).toBeVisible();
    await expect(purgedRow).toHaveCount(0);

    // Backend: không còn khách; SĐT dùng lại được.
    expect((await api.call('admin', 'GET', `/crm/customers/${purged.id}`)).status).toBe(404);
    const reused = await api.call('staff1', 'POST', '/crm/customers', { fullName: `F10-DungLai-${uid()}`, phone: purged.phone });
    expect(reused.status, JSON.stringify(reused.data)).toBe(201);
  });

  test('F10-02 Nhân viên chỉ thấy "Xóa" khi mọi khách Bỏ đang chọn do mình phụ trách chính; không vào được màn Khách đã xóa', async ({ loginAs, api, seed }) => {
    const statusId = await droppedStatusId(api);
    const mine = await createDropped(api, 'staff1', statusId, 'F10-CuaToi');
    const others = await createDropped(api, 'staff2', statusId, 'F10-CuaNguoiKhac');
    // staff1 chỉ là THÀNH VIÊN (không phải phụ trách chính) của khách do staff2 phụ trách (Admin thêm vì khác nhóm nên staff2 không tự thêm được).
    const added = await api.call('admin', 'POST', `/crm/customers/${others.id}/care-team/members`, { userIds: [seed.users.staff1.id] });
    expect(added.status, JSON.stringify(added.data)).toBeLessThan(300);

    const staff = await loginAs('staff1');
    await openDroppedTab(staff);
    await staff.getByRole('checkbox', { name: `Chọn ${mine.fullName}` }).check();
    await expect(bulkSelect(staff)).toBeVisible();
    await expect(deleteOption(staff)).toHaveCount(1);

    await staff.getByRole('checkbox', { name: `Chọn ${others.fullName}` }).check();
    await expect(deleteOption(staff)).toHaveCount(0);

    // Chỉ Quản trị vào màn Khách đã xóa: Nhân viên bị chuyển về Việc hôm nay kèm thông báo.
    await staff.goto('/crm/deleted-customers');
    await expect(staff).toHaveURL(/\/crm\/today$/);
    await expect(toast(staff, 'Bạn không có quyền vào trang này.')).toBeVisible();
  });
});
