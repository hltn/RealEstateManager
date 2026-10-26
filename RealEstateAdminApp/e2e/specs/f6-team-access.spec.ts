/**
 * F6 - Đội và quyền xem khách (doc 08 mục 6: F6-01..03, bảo mật). Dùng nhiều browser context riêng cho mỗi vai trò
 * (`loginAs` tạo context mới mỗi lần gọi), không đổi tài khoản trong cùng context.
 *
 * Quyết định [Chưa rõ]:
 * - Thông báo "không tìm thấy" thực tế: "Không tìm thấy khách hàng" + "Hồ sơ có thể đã bị xoá hoặc đường dẫn không đúng. Vui lòng chọn lại khách hàng
 *   từ danh sách." + nút "Về danh sách khách hàng" (doc ghi câu có "bạn không có quyền xem": app cố tình KHÔNG phân biệt, đúng yêu cầu bảo mật).
 * - Banner trùng SĐT với khách ngoài phạm vi: có "do <tên người phụ trách chính> chăm sóc" (backend trả `caredByName` để người xin biết hỏi ai),
 *   nhưng KHÔNG có tên/SĐT của khách. Test khẳng định đúng như vậy.
 * - Sau "Từ chối", staff có thể gửi đề nghị mới (chỉ đề nghị PENDING bị chặn trùng).
 */
import { test, expect } from '../fixtures';
import { formatPhone } from '../lib/api';
import { captureCrmResponses, openCustomerDetail, searchCustomers, seenInDom, todaySlot, toast, watchDomFor } from '../lib/ui';
import type { Page } from '@playwright/test';

const NOT_FOUND = 'Không tìm thấy khách hàng';
const NOT_FOUND_HINT = /Hồ sơ có thể đã bị xoá hoặc đường dẫn không đúng/;
/** Trạng thái rỗng của bảng: app hiện "Chưa có khách." khi tìm/lọc không ra (lệch so với doc, xem F2-04) hoặc "Không có khách hàng phù hợp". */
const EMPTY_LIST = /^(Chưa có khách\.|Không có khách hàng phù hợp)$/;

const phoneBox = (page: Page) => page.getByLabel('Số điện thoại');

test.describe('f6-team-access', () => {
  test('F6-01 staff đội khác không thấy khách ở danh sách, tìm kiếm, bộ chọn khách, lịch hẹn, việc hôm nay; quản lý đội 1 và quản trị thấy', async ({ loginAs, api, seed }, testInfo) => {
    const k = await api.createCustomer({ label: 'Khách-ĐộiMột' }); // thuộc nhóm chăm sóc của staff1 (đội 1)
    // Lịch hẹn HÔM NAY: nằm đúng trong màn Lịch hẹn và Việc hôm nay mà staff2 mở, nên nếu có rò thì mới bị thấy.
    await api.createAppointment({ customerId: k.id, slot: await todaySlot(testInfo) });

    const staff2 = await loginAs('staff2');
    const bodies = captureCrmResponses(staff2);

    // Danh sách + tìm kiếm.
    await staff2.goto('/crm/customers');
    await expect(staff2.getByText(seed.customers.staff2[0].fullName).first()).toBeVisible(); // danh sách của staff2 đã tải
    await searchCustomers(staff2, k.fullName);
    await expect(staff2.getByText(EMPTY_LIST)).toBeVisible();
    await expect(staff2.locator('body')).not.toContainText(k.fullName);
    // Bộ lọc "Người chăm sóc" của staff2 không liệt kê nhân viên đội khác (không rò danh sách người dùng ngoài phạm vi).
    const assigneeOptions = await staff2.getByLabel('Người chăm sóc').locator('option').allInnerTexts();
    expect(assigneeOptions).not.toContain('Nhân viên Một');

    // Bộ chọn khách ở form tạo lịch hẹn.
    await staff2.goto('/crm/appointments/new');
    await staff2.getByRole('button', { name: 'Chọn khách' }).click();
    await staff2.getByLabel('Tìm khách hàng').fill(k.fullName);
    await expect(staff2.getByText('Không tìm thấy khách phù hợp.')).toBeVisible();

    // Lịch hẹn và Việc hôm nay.
    const tasksLoaded = staff2.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('/crm/daily-tasks'));
    await staff2.goto('/crm/today');
    await tasksLoaded;
    await expect(staff2.getByRole('heading', { name: 'Việc hôm nay' })).toBeVisible();
    await expect(staff2.locator('body')).not.toContainText(k.fullName);
    const apptLoaded = staff2.waitForResponse((r) => r.request().method() === 'GET' && /\/crm\/appointments\?/.test(r.url()));
    await staff2.goto('/crm/appointments');
    await apptLoaded;
    await expect(staff2.getByRole('heading', { name: 'Lịch hẹn & Nhắc việc' })).toBeVisible();
    await expect(staff2.locator('body')).not.toContainText(k.fullName);

    // Hậu trường: không phản hồi API nào của staff2 chứa _id hay tên khách K.
    expect(bodies.length).toBeGreaterThan(3);
    for (const body of bodies) {
      expect(body).not.toContain(k.id);
      expect(body).not.toContain(k.fullName);
    }

    // Quản lý đội 1 và quản trị thấy K.
    for (const role of ['mgr1', 'admin'] as const) {
      const page = await loginAs(role);
      await page.goto('/crm/customers');
      await searchCustomers(page, k.fullName);
      await expect(page.getByText(k.fullName).first()).toBeVisible();
    }
  });

  test('F6-02 gõ thẳng URL khách ngoài phạm vi: "Không tìm thấy", có lối về danh sách, không lộ tên/SĐT kể cả lúc đang tải', async ({ loginAs, api }) => {
    const k = await api.createCustomer({ label: 'Khách-BíMật' });
    const page = await loginAs('staff2');
    await watchDomFor(page, [k.fullName, k.phone, formatPhone(k.phone), `${k.phone.slice(0, 4)} ••• ${k.phone.slice(-3)}`]);
    const hints: string[] = [];

    for (const path of [`/crm/customers/${k.id}`, `/crm/customers/${k.id}/persona`, `/crm/customers/${k.id}/investment`]) {
      await page.goto(path);
      await expect(page.getByText(NOT_FOUND, { exact: true })).toBeVisible();
      hints.push((await page.getByText(NOT_FOUND_HINT).innerText()).trim());
      await expect(page.getByRole('button', { name: 'Về danh sách khách hàng' })).toBeVisible();
      expect(await seenInDom(page), `rò thông tin K ở ${path}`).toEqual([]);
    }

    // Id đúng định dạng nhưng không tồn tại: cùng thông báo (không phân biệt được với ca ngoài phạm vi).
    await page.goto('/crm/customers/000000000000000000000000');
    await expect(page.getByText(NOT_FOUND, { exact: true })).toBeVisible();
    hints.push((await page.getByText(NOT_FOUND_HINT).innerText()).trim());
    expect(new Set(hints).size).toBe(1);

    // Lối thoát: "Về danh sách khách hàng" -> /crm/customers.
    await page.getByRole('button', { name: 'Về danh sách khách hàng' }).click();
    await expect(page).toHaveURL(/\/crm\/customers$/);

    // Form lịch hẹn: toast, không khóa, không có tên K.
    await page.goto(`/crm/appointments/new?customerId=${k.id}`);
    await expect(toast(page, 'Chưa chọn sẵn được khách hàng')).toBeVisible();
    await expect(page.getByText('Chưa chọn khách hàng.')).toBeVisible();
    await expect(page.getByText('Đặt lịch cho khách đang xem, không đổi được khách.')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(k.fullName);
    expect(await seenInDom(page)).toEqual([]);
  });

  test('F6-03 xin vào nhóm chăm sóc, quản lý duyệt, staff thấy khách; staff không tự duyệt được', async ({ loginAs, api, backstage, seed }) => {
    const k = await api.createCustomer({ label: 'Khách-XinVào' });

    // staff2 gõ SĐT của K ở form thêm khách.
    const staff2 = await loginAs('staff2');
    await staff2.goto('/crm/customers/new');
    await phoneBox(staff2).fill(k.phone);
    const banner = staff2.getByRole('alert').filter({ hasText: 'Đã có khách hàng với số điện thoại này' });
    await expect(banner).toContainText('do Nhân viên Một chăm sóc');
    await expect(banner).not.toContainText(k.fullName);
    await expect(banner).not.toContainText(k.phone);
    await staff2.getByRole('button', { name: 'Đề nghị tham gia nhóm chăm sóc' }).click();
    await expect(toast(staff2, 'Đã gửi đề nghị tham gia nhóm chăm sóc')).toBeVisible();
    await expect(banner).toContainText('Đã gửi đề nghị, đang chờ duyệt');
    await expect(staff2.getByRole('button', { name: 'Đề nghị tham gia nhóm chăm sóc' })).toHaveCount(0);

    const requests = (await backstage.find('care_team_requests')).filter((r) => String(r.customerId) === k.id);
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe('PENDING');
    expect(String(requests[0].requesterId)).toBe(seed.users.staff2.id);
    expect((await backstage.find('customers')).filter((c) => c.phone === k.phone || String(c._id) === k.id)).toHaveLength(1); // không sinh khách mới

    // staff2 không tự duyệt được đề nghị của chính mình (kiểm API, quyền ở máy chủ).
    const selfApprove = await api.call('staff2', 'PATCH', `/crm/care-team-requests/${requests[0]._id}`, { status: 'APPROVED' });
    expect([401, 403, 404]).toContain(selfApprove.status);
    expect((await backstage.find('care_team_requests')).filter((r) => String(r.customerId) === k.id)[0].status).toBe('PENDING');

    // mgr1 duyệt trên thẻ "Nhóm chăm sóc".
    const mgr1 = await loginAs('mgr1');
    await openCustomerDetail(mgr1, k.id, k.fullName);
    const team = mgr1.getByRole('region', { name: 'Nhóm chăm sóc' });
    await expect(team.getByText('Đề nghị tham gia nhóm chăm sóc')).toBeVisible();
    await expect(team).toContainText('Nhân viên Hai');
    await team.getByRole('button', { name: 'Duyệt' }).click();
    await expect(toast(mgr1, 'Đã duyệt đề nghị tham gia')).toBeVisible();
    await expect(team.getByText('Đề nghị tham gia nhóm chăm sóc')).toHaveCount(0); // đề nghị biến mất khỏi thẻ

    // staff2 giờ thấy K, mở được chi tiết, có tên trong nhóm chăm sóc.
    await staff2.goto('/crm/customers');
    await searchCustomers(staff2, k.fullName);
    await expect(staff2.getByText(k.fullName).first()).toBeVisible();
    await openCustomerDetail(staff2, k.id, k.fullName);
    await expect(staff2.getByRole('region', { name: 'Nhóm chăm sóc' })).toContainText('Nhân viên Hai');
    await expect(staff2.getByRole('button', { name: 'Duyệt' })).toHaveCount(0);

    // Hậu trường.
    const resolved = (await backstage.find('care_team_requests')).filter((r) => String(r.customerId) === k.id)[0];
    expect(resolved.status).toBe('APPROVED');
    expect(String(resolved.resolvedBy)).toBe(seed.users.mgr1.id);
    const customer = (await backstage.find('customers')).find((c) => String(c._id) === k.id);
    expect(customer.careTeam.map((m: { userId: unknown }) => String(m.userId))).toContain(seed.users.staff2.id);
  });

  test('F6-03 ca đối chứng "Từ chối": staff vẫn không thấy khách và có thể gửi đề nghị mới', async ({ loginAs, api, backstage, seed }) => {
    const k = await api.createCustomer({ label: 'Khách-TừChối' });
    const sent = await api.call('staff2', 'POST', '/crm/care-team-requests', { customerRef: k.id });
    expect(sent.status).toBe(201);

    const mgr1 = await loginAs('mgr1');
    await openCustomerDetail(mgr1, k.id, k.fullName);
    const team = mgr1.getByRole('region', { name: 'Nhóm chăm sóc' });
    await team.getByRole('button', { name: 'Từ chối' }).click();
    await expect(toast(mgr1, 'Đã từ chối đề nghị')).toBeVisible();
    await expect(team.getByText('Đề nghị tham gia nhóm chăm sóc')).toHaveCount(0);

    const rejected = (await backstage.find('care_team_requests')).filter((r) => String(r.customerId) === k.id);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].status).toBe('REJECTED');
    expect(String(rejected[0].resolvedBy)).toBe(seed.users.mgr1.id);
    const customer = (await backstage.find('customers')).find((c) => String(c._id) === k.id);
    expect(customer.careTeam.map((m: { userId: unknown }) => String(m.userId))).not.toContain(seed.users.staff2.id);

    // staff2 vẫn không xem được khách.
    const staff2 = await loginAs('staff2');
    await staff2.goto(`/crm/customers/${k.id}`);
    await expect(staff2.getByText(NOT_FOUND, { exact: true })).toBeVisible();

    // Có thể gửi đề nghị mới sau khi bị từ chối.
    await staff2.goto('/crm/customers/new');
    await phoneBox(staff2).fill(k.phone);
    await staff2.getByRole('button', { name: 'Đề nghị tham gia nhóm chăm sóc' }).click();
    await expect(toast(staff2, 'Đã gửi đề nghị tham gia nhóm chăm sóc')).toBeVisible();
    const all = (await backstage.find('care_team_requests')).filter((r) => String(r.customerId) === k.id);
    expect(all.map((r) => r.status).sort()).toEqual(['PENDING', 'REJECTED']);
  });
});
