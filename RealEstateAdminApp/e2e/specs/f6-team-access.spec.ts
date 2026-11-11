/**
 * F6 - Đội và quyền xem khách (doc 08 mục 6: F6-01..03, bảo mật). Dùng nhiều browser context riêng cho mỗi vai trò
 * (`loginAs` tạo context mới mỗi lần gọi), không đổi tài khoản trong cùng context.
 *
 * Quyết định [Chưa rõ]:
 * - Thông báo "không tìm thấy" thực tế: "Không tìm thấy khách hàng" + "Hồ sơ có thể đã bị xoá hoặc đường dẫn không đúng. Vui lòng chọn lại khách hàng
 *   từ danh sách." + nút "Về danh sách khách hàng" (doc ghi câu có "bạn không có quyền xem": app cố tình KHÔNG phân biệt, đúng yêu cầu bảo mật).
 * - v1.0.5 (doc 10 FR-03, FR-12..FR-14): ĐÃ BỎ tra trùng SĐT và luồng xin tham gia/duyệt/từ chối. Người ngoài nhóm chỉ vào được nhóm chăm sóc khi
 *   PRIMARY/Quản lý/Admin MỜI (thẻ "Nhóm chăm sóc" -> "Mời người"); người chưa được mời không thấy khách và không có đường xin tham gia.
 *   F6-03 viết lại thành luồng mời; ca "Từ chối" thành ca đối chứng "chưa được mời". Luồng mời đầy đủ (danh sách "tên · nhóm", gỡ, 403) ở F12-06.
 */
import { test, expect } from '../fixtures';
import { formatPhone } from '../lib/api';
import { captureCrmResponses, openCustomerDetail, searchCustomers, seenInDom, todaySlot, toast, waitPastLegacyDebounce, watchDomFor } from '../lib/ui';
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
    // Bộ lọc "Người phụ trách" của staff2 không liệt kê nhân viên đội khác (không rò danh sách người dùng ngoài phạm vi).
    const assigneeOptions = await staff2.getByLabel('Người phụ trách').locator('option').allInnerTexts();
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

  test('F6-03 mời người nhóm khác: người được mời thấy khách (danh sách, tìm kiếm, chi tiết), người chưa được mời thì không', async ({ loginAs, api, backstage, seed }) => {
    const k = await api.createCustomer({ label: 'Khách-ĐượcMời' }); // staff1 là PRIMARY, đội 1
    const other = await api.createCustomer({ label: 'Khách-ChưaMời' }); // cùng chủ, KHÔNG mời ai

    // Trước khi mời: staff2 (đội 2) không thấy cả hai khách.
    const staff2 = await loginAs('staff2');
    await staff2.goto(`/crm/customers/${k.id}`);
    await expect(staff2.getByText(NOT_FOUND, { exact: true })).toBeVisible();
    expect((await api.call('staff2', 'GET', `/crm/customers/${k.id}`)).status).toBe(404);

    // Quản lý đội 1 mở chi tiết K, mời staff2 trên thẻ "Nhóm chăm sóc"; xong ở lại chi tiết K (không mất ngữ cảnh).
    const mgr1 = await loginAs('mgr1');
    await openCustomerDetail(mgr1, k.id, k.fullName);
    const team = mgr1.getByRole('region', { name: 'Nhóm chăm sóc' });
    await expect(team).not.toContainText('Nhân viên Hai');
    await team.getByRole('button', { name: 'Mời người' }).click();
    const list = team.getByRole('list', { name: 'Danh sách người có thể mời' });
    await expect(list.getByText('Nhân viên Hai · Nhóm E2E 2')).toBeVisible();
    await list.getByRole('checkbox', { name: /Nhân viên Hai/ }).check();
    await team.getByRole('button', { name: 'Mời 1 người' }).click();
    await expect(toast(mgr1, 'Đã mời 1 người vào nhóm chăm sóc')).toBeVisible();
    await expect(mgr1).toHaveURL(new RegExp(`/crm/customers/${k.id}$`));
    await expect(team).toContainText('Nhân viên Hai');
    await expect(team).toContainText('Cùng chăm sóc');

    // Sau khi mời: staff2 thấy K ở danh sách + tìm kiếm, mở được chi tiết, có tên trong nhóm; KHÔNG thấy khách chưa mời.
    await staff2.goto('/crm/customers');
    await searchCustomers(staff2, k.fullName);
    await expect(staff2.getByText(k.fullName).first()).toBeVisible();
    await searchCustomers(staff2, other.fullName);
    await expect(staff2.getByText(EMPTY_LIST)).toBeVisible();
    await expect(staff2.locator('body')).not.toContainText(other.fullName);
    await openCustomerDetail(staff2, k.id, k.fullName);
    await expect(staff2.getByRole('region', { name: 'Nhóm chăm sóc' })).toContainText('Nhân viên Hai');
    await expect(staff2.getByRole('button', { name: 'Mời người' })).toHaveCount(0); // chỉ PRIMARY/Quản lý/Admin mời được
    await staff2.goto(`/crm/customers/${other.id}`);
    await expect(staff2.getByText(NOT_FOUND, { exact: true })).toBeVisible();
    expect((await api.call('staff2', 'GET', `/crm/customers/${k.id}`)).status).toBe(200);
    expect((await api.call('staff2', 'GET', `/crm/customers/${other.id}`)).status).toBe(404);

    // Hậu trường: chỉ K có staff2 là MEMBER; khách chưa mời không đổi; không có collection đề nghị nào được tạo cho K.
    const kRow = (await backstage.find('customers')).find((c) => String(c._id) === k.id);
    expect(kRow.careTeam.map((m: { userId: unknown; role: string }) => [String(m.userId), m.role])).toEqual([
      [seed.users.staff1.id, 'PRIMARY'],
      [seed.users.staff2.id, 'MEMBER'],
    ]);
    const otherRow = (await backstage.find('customers')).find((c) => String(c._id) === other.id);
    expect(otherRow.careTeam.map((m: { userId: unknown }) => String(m.userId))).toEqual([seed.users.staff1.id]);
    expect((await backstage.find('care_team_requests')).filter((r) => String(r.customerId) === k.id)).toHaveLength(0);
  });

  test('F6-03 ca đối chứng: người chưa được mời vẫn không thấy khách và không có đường xin tham gia (không nút, không API, SĐT trùng không mở cửa)', async ({ loginAs, api, backstage, seed }) => {
    const k = await api.createCustomer({ label: 'Khách-ChưaĐượcMời' });
    const staff2 = await loginAs('staff2');
    const legacy: string[] = [];
    staff2.on('request', (r) => {
      if (/phone-lookups|assignable-users|care-team-requests/.test(r.url())) legacy.push(`${r.method()} ${r.url()}`);
    });

    // Gõ thẳng URL: "Không tìm thấy", chỉ có lối về danh sách; không có nút xin tham gia/yêu cầu quyền.
    await staff2.goto(`/crm/customers/${k.id}`);
    await expect(staff2.getByText(NOT_FOUND, { exact: true })).toBeVisible();
    await expect(staff2.getByRole('button', { name: 'Về danh sách khách hàng' })).toBeVisible();
    await expect(staff2.getByRole('button', { name: /Xin tham gia|Đề nghị tham gia|Yêu cầu quyền|Mời người/ })).toHaveCount(0);
    await expect(staff2.locator('body')).not.toContainText(k.fullName);

    // Gõ đúng SĐT của K ở form thêm khách: không banner, không lộ tên K, không nút xin tham gia (đã bỏ tra trùng).
    await staff2.goto('/crm/customers/new');
    await phoneBox(staff2).fill(k.phone);
    await phoneBox(staff2).blur();
    await waitPastLegacyDebounce(staff2); // chờ thật quá debounce 500 ms cũ của kiểm trùng; `legacy` kiểm ở cuối test
    await expect(staff2.getByRole('alert').filter({ hasText: 'Đã có khách hàng với số điện thoại này' })).toHaveCount(0);
    await expect(staff2.getByRole('button', { name: /Xin tham gia|Đề nghị tham gia/ })).toHaveCount(0);
    await expect(staff2.locator('body')).not.toContainText(k.fullName);
    // Lưu khách mới trùng SĐT được (khách RIÊNG của staff2), và vẫn không mở được hồ sơ K.
    const ownName = `Khách-RiêngHai-${k.fullName.slice(-6)}`;
    await staff2.getByLabel('Họ và tên khách hàng').fill(ownName);
    await staff2.getByRole('button', { name: 'Lưu khách hàng' }).click();
    await expect(toast(staff2, 'Thêm khách hàng thành công')).toBeVisible();
    await staff2.goto(`/crm/customers/${k.id}`);
    await expect(staff2.getByText(NOT_FOUND, { exact: true })).toBeVisible();

    // Phía máy chủ: không có endpoint xin tham gia; tự thêm mình vào nhóm K bị từ chối; nhóm K không đổi.
    expect((await api.call('staff2', 'POST', '/crm/care-team-requests', { customerRef: k.id })).status).toBe(404);
    const selfAdd = await api.call('staff2', 'POST', `/crm/customers/${k.id}/care-team/members`, { userIds: [seed.users.staff2.id] });
    expect([403, 404]).toContain(selfAdd.status);
    expect((await api.call('staff2', 'GET', `/crm/customers/${k.id}`)).status).toBe(404);
    const kRow = (await backstage.find('customers')).find((c) => String(c._id) === k.id);
    expect(kRow.careTeam.map((m: { userId: unknown }) => String(m.userId))).toEqual([seed.users.staff1.id]);
    expect((await backstage.find('care_team_requests')).filter((r) => String(r.customerId) === k.id)).toHaveLength(0);
    expect(legacy, 'không gọi endpoint đã bỏ').toEqual([]);
  });
});
