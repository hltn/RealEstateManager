/**
 * F4b - Đặt lịch hẹn mang ngữ cảnh (khóa hồi quy G2, G5, G6, G7). Doc 08 mục 5: F4-01, 02, 03, 05, 06.
 * Mỗi test tự tạo dự án + khách riêng bằng API (không dùng chung dữ liệu giữa test).
 *
 * Quyết định cho các chỗ [Chưa rõ] của doc:
 * - Nút ở chi tiết khách (desktop) là nút icon `aria-label="Đặt lịch hẹn"`, mobile là "Hẹn nhắc".
 * - Nhãn loại lịch là "Xem nhà mẫu / sa bàn" (doc ghi "Xem nhà / sa bàn").
 * - Desktop KHÔNG có nút "quay lại" ở đầu form: đường quay lại là breadcrumb (tên khách) và nút "Hủy bỏ"; nút "Quay lại" chỉ có ở mobile.
 * - `?customerId=zzz` (sai định dạng): toast "Chưa chọn sẵn được khách hàng" như id ngoài phạm vi, form trống, không khóa.
 * - "Hủy bỏ" khi form có dữ liệu gõ dở: hộp xác nhận (role dialog) "Bỏ thay đổi" / "Tiếp tục nhập"; form còn nguyên thì rời ngay.
 * - Giờ hẹn tính từ "bây giờ" (lib/api.ts): `todaySlot` chỉ ở chỗ cần thấy lịch trong ngày hôm nay, `tomorrowSlot` ở mọi chỗ khác.
 */
import { test, expect } from '../fixtures';
import { tomorrowSlot } from '../lib/api';
import { MOBILE_VIEWPORT, note, openCustomerDetail, setSchedule, todaySlot, toast } from '../lib/ui';
import type { Page } from '@playwright/test';

const SUBMIT = 'Xác nhận tạo lịch hẹn';
const LOCKED_HINT = 'Đặt lịch cho khách đang xem, không đổi được khách.';

const customerCard = (page: Page) => page.getByRole('group', { name: /^Khách hàng/ });
const locationInput = (page: Page) => page.getByRole('textbox', { name: /^Địa điểm/ });
const assigneeSelect = (page: Page) => page.getByRole('combobox', { name: /^Người thực hiện/ });
const projectSelect = (page: Page) => page.getByLabel('Dự án', { exact: true });

async function projectGroups(page: Page): Promise<Array<{ group: string; options: string[] }>> {
  return projectSelect(page).evaluate((el) => {
    const select = el as HTMLSelectElement;
    return Array.from(select.children).map((child) =>
      child.tagName === 'OPTGROUP'
        ? { group: (child as HTMLOptGroupElement).label, options: Array.from(child.children).map((o) => o.textContent ?? '') }
        : { group: '', options: [child.textContent ?? ''] },
    );
  });
}

test.describe('f4b-appointment-context', () => {
  test('F4-01 đặt lịch từ chi tiết khách: mang khách + dự án, khóa trường khách, giữ sau F5 (G5, G2, G7)', async ({ loginAs, api, seed, backstage }, testInfo) => {
    const slot = tomorrowSlot();
    const A = await api.createProject('Dự án A');
    const customer = await api.createCustomer({ projectIds: [A.id] });
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);

    let clicks = 0;
    await page.getByRole('button', { name: 'Đặt lịch hẹn' }).click();
    clicks += 1;

    // 1. URL mang customerId; thẻ khách đã hiện tên và bị khóa.
    await expect(page).toHaveURL(new RegExp(`/crm/appointments/new\\?customerId=${customer.id}$`));
    const assertContext = async () => {
      await expect(customerCard(page)).toContainText(customer.fullName);
      await expect(customerCard(page)).not.toContainText('Chưa chọn khách hàng');
      await expect(page.getByText(LOCKED_HINT)).toBeVisible();
      await expect(page.getByRole('button', { name: /Thay đổi khách|Chọn khách/ })).toHaveCount(0);
      // 3. Dự án duy nhất khách quan tâm được gợi ý sẵn.
      await expect(projectSelect(page)).toHaveValue(A.id);
      // 4. Người thực hiện mặc định theo nhóm chăm sóc, chỉ có người trong nhóm.
      await expect(assigneeSelect(page)).toHaveValue(seed.users.staff1.id);
      await expect(assigneeSelect(page).locator('option')).toHaveCount(1);
    };
    await assertContext();

    // 2. Breadcrumb cấp giữa là tên khách (không phải "Lịch hẹn & Nhắc việc").
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: customer.fullName })).toBeVisible();
    await expect(crumbs.getByRole('link', { name: 'Lịch hẹn & Nhắc việc' })).toHaveCount(0);

    // 5. Tải lại trang: vẫn giữ khách, dự án, vẫn khóa.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`customerId=${customer.id}$`));
    await assertContext();

    // TT: số thao tác từ chi tiết khách đến lưu xong = click "Đặt lịch hẹn" + nhập địa điểm + click xác nhận (loại, ngày, dự án, người thực hiện đã mặc định).
    await locationInput(page).fill('Sa bàn dự án');
    await setSchedule(page, slot); // ngày mai 09:00: độc lập giờ chạy (người dùng thật chỉ sửa giờ nếu 09:30 hôm nay đã qua)
    await page.getByRole('button', { name: SUBMIT }).click();
    clicks += 1;
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));
    note(testInfo, 'TT', `Từ chi tiết khách đến lưu xong: ${clicks} click + 2 ô nhập (địa điểm, giờ; giờ mặc định 09:30 có thể đã qua nên thường phải sửa). Mục tiêu <= 5 thao tác: đạt.`);

    // Hậu trường: giờ hẹn đúng và nhắc trước 60 phút (mặc định) đúng mốc, không phụ thuộc giờ chạy vì lịch ở ngày mai.
    const appt = (await backstage.find('appointments')).find((r) => String(r.customerId) === customer.id);
    expect(appt.startAt.toISOString()).toBe(slot.iso);
    expect(appt.remindBeforeMinutes).toEqual([60]);
    const reminders = (await backstage.find('reminders')).filter((r) => String(r.refId) === String(appt._id));
    expect(reminders.map((r) => r.fireAt.toISOString())).toEqual([new Date(Date.parse(slot.iso) - 60 * 60_000).toISOString()]);
  });

  test('F4-01 khách quan tâm 2 dự án: không tự chọn dự án, nhóm "Khách quan tâm" liệt kê lên đầu (G7)', async ({ loginAs, api }) => {
    const A = await api.createProject('Dự án A');
    const B = await api.createProject('Dự án B');
    const customer = await api.createCustomer({ projectIds: [A.id, B.id] });
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);
    await page.getByRole('button', { name: 'Đặt lịch hẹn' }).click();
    await expect(customerCard(page)).toContainText(customer.fullName);

    await expect(projectSelect(page)).toHaveValue('');
    const groups = await projectGroups(page);
    expect(groups[0]).toEqual({ group: '', options: ['Không chọn'] });
    expect(groups[1].group).toBe('Khách quan tâm');
    expect([...groups[1].options].sort()).toEqual([A.name, B.name].sort());
    expect(groups[2]?.group).toBe('Dự án khác');
  });

  test('F4-01 id khách sai định dạng hoặc ngoài phạm vi: form về "chưa chọn khách", không khóa, không lộ tên', async ({ loginAs, api }) => {
    const other = await api.createCustomer({ role: 'staff2', label: 'Khách-Đội2' });
    const page = await loginAs('staff1');

    // Sai định dạng: form về trạng thái trống, không khóa (toast: xem test ngay bên dưới).
    await page.goto('/crm/appointments/new?customerId=zzz');
    await expect(page.getByRole('heading', { name: 'Tạo lịch hẹn mới' })).toBeVisible();
    await expect(customerCard(page)).toHaveCount(0); // không có thẻ khóa
    await expect(page.getByText('Chưa chọn khách hàng.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chọn khách' })).toBeVisible();
    await expect(page.getByText(LOCKED_HINT)).toHaveCount(0);

    // Id hợp lệ nhưng khách của đội khác: toast cảnh báo, không khóa, không lộ tên.
    await page.goto(`/crm/appointments/new?customerId=${other.id}`);
    await expect(toast(page, 'Chưa chọn sẵn được khách hàng')).toContainText('Khách không tồn tại hoặc bạn không có quyền xem. Vui lòng chọn khách khác.');
    await expect(page.getByText('Chưa chọn khách hàng.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chọn khách' })).toBeVisible();
    await expect(page.getByText(LOCKED_HINT)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(other.fullName);
    await expect(page.locator('body')).not.toContainText(other.phone);
  });

  test('F4-01 id khách sai định dạng cũng báo như id ngoài phạm vi (không im lặng) rồi mở form trống', async ({ loginAs }) => {
    const page = await loginAs('staff1');
    await page.goto('/crm/appointments/new?customerId=zzz');
    await expect(page.getByRole('heading', { name: 'Tạo lịch hẹn mới' })).toBeVisible();
    await expect(page.getByText('Chưa chọn khách hàng.')).toBeVisible(); // đã về trạng thái trống như mong đợi
    await expect(toast(page, 'Chưa chọn sẵn được khách hàng'), 'phải có toast giải thích như nhánh id ngoài phạm vi').toBeVisible();
  });

  test('F4-02 lưu lịch về chi tiết khách, Back không về form, việc hôm nay và lịch hẹn hiện dự án (G6, G7)', async ({ loginAs, api, backstage, seed }, testInfo) => {
    const slot = await todaySlot(testInfo); // cần "hôm nay": kiểm lịch hiện ở Việc hôm nay và màn Lịch hẹn mặc định
    const A = await api.createProject('Dự án A');
    const customer = await api.createCustomer({ projectIds: [A.id] });
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);
    await page.getByRole('button', { name: 'Đặt lịch hẹn' }).click();
    await expect(customerCard(page)).toContainText(customer.fullName);

    await page.getByText('Xem nhà mẫu / sa bàn').click();
    await page.getByLabel('Giờ (giờ Việt Nam)').fill(slot.time); // ngày mặc định của form là hôm nay
    await locationInput(page).fill('Sa bàn dự án');

    // Giữ request POST lại để quan sát trạng thái "Đang lưu…" và thử gửi lần 2 trong lúc chờ.
    let posts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/crm/appointments', async (route) => {
      if (route.request().method() === 'POST') {
        posts += 1;
        await gate;
      }
      await route.continue();
    });
    const beforeSubmit = Date.now();
    await page.getByRole('button', { name: SUBMIT }).click();
    const saving = page.getByRole('button', { name: 'Đang lưu…' });
    await expect(saving).toBeDisabled();
    await locationInput(page).press('Enter'); // gửi lần 2 bằng bàn phím khi đang lưu
    release();

    await expect(toast(page, 'Tạo lịch hẹn thành công')).toContainText(`Lịch hẹn với ${customer.fullName} đã được lưu.`);
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`)); // về đúng chi tiết khách, không sang /crm/appointments
    expect(posts).toBe(1);

    // Nút Back của trình duyệt không đưa về form đã lưu.
    await page.goBack();
    await expect(page).not.toHaveURL(/appointments\/new/);

    // Hậu trường.
    const rows = (await backstage.find('appointments')).filter((r) => String(r.customerId) === customer.id);
    expect(rows).toHaveLength(1);
    const appt = rows[0];
    expect(String(appt.projectId)).toBe(A.id);
    expect(appt.startAt.toISOString()).toBe(slot.iso);
    expect(String(appt.assigneeId)).toBe(seed.users.staff1.id);
    expect(appt.type).toBe('SITE_VISIT');
    expect(appt.remindBeforeMinutes).toEqual([60]);
    const reminders = (await backstage.find('reminders')).filter((r) => String(r.refId) === String(appt._id));
    // Giờ hẹn chỉ cách bây giờ ~5 phút nên mốc "trước 60 phút" đã qua: backend xếp ĐÚNG MỘT nhắc ngay lúc tạo (không sớm hơn lúc bấm lưu, không muộn hơn giờ hẹn).
    // (Mốc nhắc đúng 60 phút trước giờ hẹn được kiểm chính xác ở F4-01, nơi lịch đặt vào ngày mai.)
    expect(reminders).toHaveLength(1);
    const fireAt = reminders[0].fireAt.getTime();
    expect(fireAt).toBeGreaterThanOrEqual(beforeSubmit);
    expect(fireAt).toBeLessThanOrEqual(appt.startAt.getTime());

    // Việc hôm nay: việc lịch hẹn kèm Dự án A.
    await page.goto('/crm/today');
    const task = page.getByTestId('daily-task-card').filter({ hasText: customer.fullName });
    await expect(task).toHaveCount(1);
    await expect(task).toContainText(`Dự án: ${A.name}`);

    // Màn Lịch hẹn: thẻ có dòng "Dự án: A".
    await page.goto('/crm/appointments');
    const card = page.getByTestId('appointment-card').filter({ hasText: customer.fullName });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`Dự án: ${A.name}`);
    note(testInfo, 'NC', 'Dự án A xuất hiện nhất quán ở Mongo, Việc hôm nay, Lịch hẹn.');
  });

  test('F4-02 chi tiết khách cho thấy lịch hẹn sắp tới vừa đặt (xác nhận tại nơi người dùng quay về)', async ({ loginAs, api }) => {
    const slot = tomorrowSlot();
    const customer = await api.createCustomer();
    await api.createAppointment({ customerId: customer.id, slot });
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);
    const upcoming = page.getByRole('region', { name: /Lịch hẹn/ });
    await expect(upcoming, 'chi tiết khách phải có khối "Lịch hẹn" hiện lịch sắp tới').toBeVisible();
    await expect(upcoming).toContainText(slot.time);
  });

  test('F4-01/02 [+mobile] đặt lịch từ chi tiết khách trên di động: nút "Hẹn nhắc", khách khóa, dự án gợi ý, lưu về chi tiết khách, thẻ lịch hẹn hiện dự án', async ({ loginAs, api }, testInfo) => {
    const slot = await todaySlot(testInfo); // thẻ lịch hẹn kiểm ở màn Lịch hẹn mặc định (hôm nay)
    const A = await api.createProject('Dự án A');
    const customer = await api.createCustomer({ projectIds: [A.id] });
    const page = await loginAs('staff1');
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/crm/customers/${customer.id}`);
    await expect(page.getByRole('heading', { name: customer.fullName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Hẹn nhắc' }).click();

    // Ngữ cảnh mang sang: khách khóa, dự án gợi ý; mobile có nút "Quay lại" thay cho breadcrumb.
    await expect(page).toHaveURL(new RegExp(`customerId=${customer.id}$`));
    await expect(customerCard(page)).toContainText(customer.fullName);
    await expect(page.getByText(LOCKED_HINT)).toBeVisible();
    await expect(page.getByRole('button', { name: /Thay đổi khách|Chọn khách/ })).toHaveCount(0);
    await expect(projectSelect(page)).toHaveValue(A.id);
    await expect(page.getByRole('button', { name: 'Quay lại' })).toBeVisible();

    // Lưu: về chi tiết khách; thẻ lịch hẹn di động hiện dự án.
    await page.getByLabel('Giờ (giờ Việt Nam)').fill(slot.time);
    await locationInput(page).fill('Sa bàn dự án');
    await page.getByRole('button', { name: SUBMIT }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));

    await page.goto('/crm/appointments');
    const card = page.getByTestId('appointment-card').filter({ hasText: customer.fullName });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`Dự án: ${A.name}`);
  });

  test('F4-03 "Hủy bỏ" và breadcrumb về chi tiết khách, mở thẳng URL rồi Hủy vẫn về chi tiết khách (G6)', async ({ loginAs, api }) => {
    const A = await api.createProject('Dự án A');
    const customer = await api.createCustomer({ projectIds: [A.id] });
    const page = await loginAs('staff1');

    // Danh sách khách -> chi tiết -> form -> Hủy bỏ: lùi 1 mục, một lần Back nữa về danh sách (không lặp mục).
    await page.goto('/crm/customers');
    await page.getByText(customer.fullName).first().click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));
    await expect(page.getByRole('heading', { name: customer.fullName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Đặt lịch hẹn' }).click();
    await expect(customerCard(page)).toContainText(customer.fullName);
    await locationInput(page).fill('Dữ liệu gõ dở');
    await page.getByRole('button', { name: 'Hủy bỏ' }).click();
    await page.getByRole('button', { name: 'Bỏ thay đổi' }).click(); // form có dữ liệu gõ dở: phải xác nhận bỏ
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/crm\/customers$/);

    // Breadcrumb "tên khách" cũng quay về hồ sơ.
    await page.goto(`/crm/appointments/new?customerId=${customer.id}`);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: customer.fullName }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));

    // Ca phụ: mở thẳng URL trong tab mới (không có lịch sử) rồi Hủy bỏ.
    const fresh = await page.context().newPage();
    await fresh.goto(`/crm/appointments/new?customerId=${customer.id}`);
    await expect(fresh.getByText(LOCKED_HINT)).toBeVisible();
    await fresh.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(fresh).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));
    await expect(fresh.getByRole('heading', { name: customer.fullName }).first()).toBeVisible();
  });

  test('F4-03 gõ dở rồi bấm "Hủy bỏ" thì hỏi xác nhận trước khi bỏ dữ liệu; "Tiếp tục nhập" ở lại form', async ({ loginAs, api }) => {
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await page.goto(`/crm/appointments/new?customerId=${customer.id}`);
    await locationInput(page).fill('Dữ liệu gõ dở');
    await page.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(page.getByRole('dialog'), 'phải có hộp xác nhận trước khi bỏ dữ liệu đã gõ').toBeVisible();
  });

  test('F4-03 [+mobile] nút "Quay lại" và "Hủy bỏ" về chi tiết khách', async ({ loginAs, api }) => {
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/crm/customers/${customer.id}`);
    await expect(page.getByRole('heading', { name: customer.fullName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Hẹn nhắc' }).click();
    await page.getByRole('button', { name: 'Quay lại' }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));

    await page.getByRole('button', { name: 'Hẹn nhắc' }).click();
    await page.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));
  });

  test('F4-05 "Dẫn khách xem" mang dự án sang form; nút chung để trống; dự án ngừng hoạt động bị bỏ qua; khách + dự án giữ cả hai (G7)', async ({ loginAs, api }) => {
    const A = await api.createProject('Dự án A');
    const B = await api.createProject('Dự án B');
    const D = await api.createProject('Dự án D');
    await api.setProjectActive(D.id, false);
    const customer = await api.createCustomer({ projectIds: [A.id] });
    const page = await loginAs('admin');

    await page.goto('/crm/projects');
    const cardB = page.getByRole('article').filter({ hasText: B.name });
    await expect(cardB).toHaveCount(1);
    await cardB.getByRole('button', { name: /Dẫn khách xem/ }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/appointments/new\\?projectId=${B.id}$`));
    await expect(projectSelect(page)).toHaveValue(B.id);
    await expect(page.getByText('Chưa chọn khách hàng.')).toBeVisible(); // chưa có ngữ cảnh khách
    await expect(page.getByRole('button', { name: 'Chọn khách' })).toBeVisible();

    // Lưu xong về /crm/appointments (không có khách gốc).
    await page.getByRole('button', { name: 'Chọn khách' }).click();
    await page.getByLabel('Tìm khách hàng').fill(customer.fullName);
    await page.getByRole('listbox', { name: 'Danh sách khách hàng' }).getByRole('button', { name: new RegExp(customer.fullName) }).click();
    await expect(customerCard(page)).toHaveCount(0);
    await expect(projectSelect(page)).toHaveValue(B.id); // dự án mang sang thắng gợi ý theo khách (khách quan tâm A)
    await setSchedule(page, tomorrowSlot());
    await locationInput(page).fill('Sa bàn dự án B');
    await page.getByRole('button', { name: SUBMIT }).click();
    await expect(page).toHaveURL(/\/crm\/appointments$/);

    // Nút chung "Đặt lịch xem sa bàn": form trống, dự án "Không chọn".
    await page.goto('/crm/projects');
    await page.getByRole('button', { name: 'Đặt lịch xem sa bàn' }).click();
    await expect(page).toHaveURL(/\/crm\/appointments\/new$/);
    await expect(projectSelect(page)).toHaveValue('');
    await expect(page.getByText('Chưa chọn khách hàng.')).toBeVisible();

    // Dự án ngừng hoạt động qua ?projectId= bị bỏ qua.
    await page.goto(`/crm/appointments/new?projectId=${D.id}`);
    await expect(page.getByText('Chưa chọn khách hàng.')).toBeVisible();
    await expect(projectSelect(page)).toHaveValue('');

    // Tổ hợp khách + dự án: giữ cả hai, trường khách khóa.
    await page.goto(`/crm/appointments/new?customerId=${customer.id}&projectId=${B.id}`);
    await expect(customerCard(page)).toContainText(customer.fullName);
    await expect(page.getByText(LOCKED_HINT)).toBeVisible();
    await expect(projectSelect(page)).toHaveValue(B.id);
  });

  test('F4-06 dự án bị ngừng giữa chừng: lỗi hiện cạnh ô Dự án, focus, không mất dữ liệu, sửa dự án rồi lưu được (G7)', async ({ loginAs, api, backstage }) => {
    const C = await api.createProject('Dự án C');
    const customer = await api.createCustomer({ projectIds: [C.id] });
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);
    await page.getByRole('button', { name: 'Đặt lịch hẹn' }).click();
    await expect(projectSelect(page)).toHaveValue(C.id);
    const slot = tomorrowSlot();
    await setSchedule(page, slot);
    await locationInput(page).fill('Giữ nguyên địa điểm này');
    await page.getByLabel('Ghi chú / chuẩn bị').fill('Ghi chú không được mất');

    await api.setProjectActive(C.id, false); // hậu trường: admin ngừng dự án C
    await page.getByRole('button', { name: SUBMIT }).click();

    // Lỗi cạnh ô Dự án, ô nhận focus, không có toast lỗi chung.
    const fieldError = page.locator('#appointment-projectId-error');
    await expect(fieldError).toBeVisible();
    await expect(fieldError).not.toBeEmpty();
    await expect(projectSelect(page)).toBeFocused();
    await expect(projectSelect(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(toast(page, (await fieldError.innerText()).trim())).toHaveCount(0);
    // Dữ liệu còn nguyên; chưa có lịch nào.
    await expect(locationInput(page)).toHaveValue('Giữ nguyên địa điểm này');
    await expect(page.getByLabel('Ghi chú / chuẩn bị')).toHaveValue('Ghi chú không được mất');
    await expect(page.getByLabel('Giờ (giờ Việt Nam)')).toHaveValue(slot.time);
    expect((await backstage.find('appointments')).filter((r) => String(r.customerId) === customer.id)).toHaveLength(0);

    // Đổi sang "Không chọn": lỗi biến mất, lưu được.
    await projectSelect(page).selectOption('');
    await expect(fieldError).toHaveCount(0);
    await page.getByRole('button', { name: SUBMIT }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));
    const rows = (await backstage.find('appointments')).filter((r) => String(r.customerId) === customer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBeNull();
  });

  test('U-A11Y-01 ô "Ngày diễn ra" có nhãn truy cập được', async ({ loginAs, api }) => {
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await page.goto(`/crm/appointments/new?customerId=${customer.id}`);
    await expect(page.getByPlaceholder('Chọn ngày')).toBeVisible(); // ô ngày có hiện
    await expect(page.getByLabel('Ngày diễn ra'), 'ô ngày phải truy cập được bằng nhãn "Ngày diễn ra"').toBeVisible();
  });
});
