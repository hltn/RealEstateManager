/**
 * F4 - Lịch hẹn và nhắc việc (phần còn lại): F4-04, F4-07, F4-08, F4-09 (doc 08 mục 5). F4-01/02/03/05/06 ở `f4b-appointment-context.spec.ts`.
 *
 * Giờ hẹn luôn tính từ "bây giờ" theo giờ VN (lib/api.ts): `todaySlot` (bây giờ + 5 phút) chỉ ở chỗ cần thấy lịch trong ngày hôm nay,
 * `tomorrowSlot` (ngày mai 09:00) ở mọi chỗ khác; không gắn cứng giờ nên kết quả không phụ thuộc giờ chạy.
 *
 * Quyết định [Chưa rõ]:
 * - Nút tạo lịch ở màn Lịch hẹn: "Tạo lịch hẹn mới". Nút "Hủy bỏ" của FormActionBar: "Hủy bỏ".
 * - Menu "Thao tác khác" có ở mọi thẻ lịch hẹn (mobile ở đầu thẻ; desktop ở hàng nút) và có "Đổi giờ" + "Hủy lịch hẹn" khi lịch còn chờ thực hiện;
 *   thẻ "Ký cọc / HĐMB" còn nút "Xác nhận hoàn thành" / "Hoàn tác xác nhận"; thẻ "Nhắc gọi lại" còn "Đã liên hệ xong" / "Hoàn tác liên hệ".
 * - Chuông thông báo: nhắc đến hạn do job lặp 1 phút/lần của backend (BullMQ) gửi; test tạo lịch hẹn ~6 phút nữa với "nhắc trước 15 phút"
 *   (nhắc đã quá hạn ngay khi tạo) rồi chờ có điều kiện, không chờ cố định.
 */
import { test, expect } from '../fixtures';
import { tomorrowSlot, vnToday } from '../lib/api';
import { MOBILE_VIEWPORT, note, openCustomerDetail, setSchedule, todaySlot, toast } from '../lib/ui';
import type { Locator, Page } from '@playwright/test';

const SUBMIT = 'Xác nhận tạo lịch hẹn';
const CUSTOMER_REQUIRED = 'Vui lòng chọn khách hàng.';
const LOCATION_REQUIRED = 'Vui lòng nhập địa điểm gặp.';

const locationInput = (page: Page) => page.getByRole('textbox', { name: /^Địa điểm/ });
const projectSelect = (page: Page) => page.getByLabel('Dự án', { exact: true });
const timeInput = (page: Page) => page.getByLabel('Giờ (giờ Việt Nam)');
const customerCard = (page: Page) => page.getByRole('group', { name: /^Khách hàng/ });

async function pickCustomer(page: Page, fullName: string) {
  const trigger = page.getByRole('button', { name: /^(Chọn khách|Thay đổi khách)$/ });
  await trigger.click();
  await page.getByLabel('Tìm khách hàng').fill(fullName);
  await page.getByRole('listbox', { name: 'Danh sách khách hàng' }).getByRole('button', { name: new RegExp(fullName) }).click();
}

async function kpi(page: Page, label: RegExp): Promise<number> {
  const card = page.getByRole('region', { name: 'Chỉ số lịch hẹn' }).locator('div').filter({ hasText: label }).first();
  const text = await card.innerText();
  const match = new RegExp(`${label.source}\\s*(\\d+)`, 'i').exec(text.replace(/\n/g, ' '));
  if (!match) throw new Error(`Không đọc được KPI ${label}: ${text}`);
  return Number(match[1]);
}

const cardFor = (page: Page, fullName: string): Locator => page.getByTestId('appointment-card').filter({ hasText: fullName });

test.describe('f4-appointments', () => {
  test('F4-04 đặt lịch từ màn Lịch hẹn: chọn khách tự do, lưu về danh sách, hiện đúng ngày; dự án chọn tay không bị ghi đè khi đổi khách', async ({ loginAs, api }, testInfo) => {
    const slot = await todaySlot(testInfo);
    const p1 = await api.createProject('Dự án Một');
    const p2 = await api.createProject('Dự án Hai');
    const p3 = await api.createProject('Dự án Ba');
    const c1 = await api.createCustomer({ label: 'Khách-Lịch-Một', projectIds: [p1.id] });
    const c2 = await api.createCustomer({ label: 'Khách-Lịch-Hai', projectIds: [p2.id] });
    const page = await loginAs('staff1');

    await page.goto('/crm/appointments');
    await page.getByRole('button', { name: 'Tạo lịch hẹn mới' }).click();
    await expect(page).toHaveURL(/\/crm\/appointments\/new$/);
    // Form trống: chưa có khách, nút "Chọn khách"; breadcrumb cấp giữa là "Lịch hẹn & Nhắc việc".
    await expect(page.getByText('Chưa chọn khách hàng.')).toBeVisible();
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Lịch hẹn & Nhắc việc' })).toBeVisible();

    // Tìm khách không tồn tại -> thông báo; tìm đúng tên -> ra đúng người.
    await page.getByRole('button', { name: 'Chọn khách' }).click();
    await page.getByLabel('Tìm khách hàng').fill('khong-co-khach-nay-zzz');
    await expect(page.getByText('Không tìm thấy khách phù hợp.')).toBeVisible();
    await page.getByLabel('Tìm khách hàng').fill(c1.fullName);
    const option = page.getByRole('listbox', { name: 'Danh sách khách hàng' }).getByRole('button', { name: new RegExp(c1.fullName) });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(customerCard(page)).toHaveCount(0); // không khóa
    await expect(page.getByText(c1.fullName).first()).toBeVisible();
    // Khách quan tâm đúng 1 dự án -> gợi ý dự án đó.
    await expect(projectSelect(page)).toHaveValue(p1.id);

    // Chọn tay dự án Ba rồi đổi khách: lựa chọn tay không bị ghi đè bởi gợi ý của khách mới.
    await projectSelect(page).selectOption(p3.id);
    await pickCustomer(page, c2.fullName);
    await expect(page.getByText(c2.fullName).first()).toBeVisible();
    await expect(projectSelect(page)).toHaveValue(p3.id);
    // Đổi lại về khách 1 để lưu lịch của khách 1 với dự án chọn tay.
    await pickCustomer(page, c1.fullName);
    await expect(projectSelect(page)).toHaveValue(p3.id);

    await timeInput(page).fill(slot.time); // ngày mặc định của form là hôm nay
    await locationInput(page).fill('Văn phòng bán hàng');
    await page.getByRole('button', { name: SUBMIT }).click();
    await expect(toast(page, 'Tạo lịch hẹn thành công')).toBeVisible();
    await expect(page).toHaveURL(/\/crm\/appointments$/);
    // Lịch mới hiện đúng ngày hôm nay, đúng khách và dự án chọn tay.
    const card = cardFor(page, c1.fullName);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`Dự án: ${p3.name}`);
    // Back không quay về form.
    await page.goBack();
    await expect(page).not.toHaveURL(/appointments\/new/);
    note(testInfo, 'TT', 'Từ màn Lịch hẹn: 1 click mở form + 3 thao tác chọn khách (mở, gõ, chọn) + giờ + địa điểm + 1 click lưu.');
  });

  test('F4-07 trường bắt buộc: lỗi chỉ hiện sau lần bấm đầu, đếm ngược "Còn N trường", focus trường lỗi đầu tiên, bấm đúp chỉ tạo 1 lịch', async ({ loginAs, api, backstage }) => {
    const c = await api.createCustomer({ label: 'Khách-BắtBuộc' });
    const page = await loginAs('staff1');
    await page.goto('/crm/appointments/new');
    await setSchedule(page, tomorrowSlot()); // ngày mai: loại bỏ yếu tố giờ mặc định 09:30 của hôm nay có thể đã qua
    await expect(page.getByText('Còn 2 trường bắt buộc cần kiểm tra')).toBeVisible();
    // Chưa bấm lưu: chưa có lỗi cạnh trường.
    await expect(page.getByText(CUSTOMER_REQUIRED)).toHaveCount(0);
    await expect(page.getByText(LOCATION_REQUIRED)).toHaveCount(0);

    await page.getByRole('button', { name: SUBMIT }).click();
    await expect(toast(page, 'Chưa thể tạo lịch hẹn')).toContainText(CUSTOMER_REQUIRED); // lý do trường lỗi đầu tiên
    await expect(page.getByText(CUSTOMER_REQUIRED, { exact: true })).toBeVisible();
    await expect(page.getByText(LOCATION_REQUIRED, { exact: true })).toBeVisible();
    await expect(page.locator('#appointment-customerId')).toBeFocused();

    // Điền dần: số trường còn lại giảm tới "Đã đủ thông tin bắt buộc".
    await pickCustomer(page, c.fullName);
    await expect(page.getByText('Còn 1 trường bắt buộc cần kiểm tra')).toBeVisible();
    await expect(page.getByText(CUSTOMER_REQUIRED, { exact: true })).toHaveCount(0);
    await locationInput(page).fill('Sa bàn dự án');
    await expect(page.getByText('Đã đủ thông tin bắt buộc')).toBeVisible();
    await expect(page.getByText(LOCATION_REQUIRED, { exact: true })).toHaveCount(0);

    // Bấm đúp thật nhanh: chỉ 1 lịch, 1 request POST.
    let posts = 0;
    await page.route('**/api/v1/crm/appointments', async (route) => {
      if (route.request().method() === 'POST') {
        posts += 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      await route.continue();
    });
    await page.getByRole('button', { name: SUBMIT }).dblclick();
    await expect(page).toHaveURL(/\/crm\/appointments$/);
    expect(posts).toBe(1);
    expect((await backstage.find('appointments')).filter((r) => String(r.customerId) === c.id)).toHaveLength(1);
  });

  test('F4-07 loại "Nhắc gọi lại" tự điền địa điểm kênh gọi và bỏ bắt buộc; "Mục đích khác" bắt buộc ghi chú; công tắc SMS/ZNS và đồng bộ lịch ẩn khi cờ tắt', async ({ loginAs, api }) => {
    const c = await api.createCustomer({ label: 'Khách-LoạiLịch' });
    const page = await loginAs('staff1');
    await page.goto(`/crm/appointments/new?customerId=${c.id}`);
    await expect(customerCard(page)).toContainText(c.fullName);
    await setSchedule(page, tomorrowSlot());

    await expect(page.getByText('Tự động gửi SMS / Zalo ZNS')).toHaveCount(0);
    await expect(page.getByText('Đồng bộ Google & Outlook')).toHaveCount(0);

    await page.getByRole('radio', { name: /^Nhắc gọi lại/ }).check({ force: true });
    await expect(locationInput(page)).toHaveValue('Gọi điện / Zalo');
    await expect(page.getByText('Địa điểm').first()).toBeVisible();
    await expect(page.locator('label[for="appointment-location"]')).not.toContainText('*');

    await page.getByRole('radio', { name: /^Mục đích khác/ }).check({ force: true });
    await locationInput(page).fill('Văn phòng');
    await page.getByRole('button', { name: SUBMIT }).click();
    await expect(toast(page, 'Chưa thể tạo lịch hẹn')).toContainText('Mục đích khác: vui lòng ghi rõ nội dung buổi hẹn.');
    await expect(page.locator('#appointment-note-error')).toBeVisible();
  });

  test('F4-08 đánh dấu hoàn thành / bỏ đánh dấu ở menu "Thao tác khác": thẻ, KPI, tải lại và hậu trường khớp nhau', async ({ loginAs, api, backstage }, testInfo) => {
    const c = await api.createCustomer({ label: 'Khách-HoànThành' });
    await api.createAppointment({ customerId: c.id, slot: await todaySlot(testInfo) });
    const page = await loginAs('staff1');
    await page.goto('/crm/appointments');
    const card = cardFor(page, c.fullName);
    await expect(card).toHaveCount(1);
    const doneBefore = await kpi(page, /Hoàn thành tháng này/);

    // Menu có đủ 4 mục.
    await card.getByRole('button', { name: 'Thao tác khác' }).click();
    const menu = page.getByRole('list', { name: 'Thao tác lịch hẹn' });
    for (const label of ['Xem hồ sơ khách', 'Ghi chú nhanh', 'Nhắn Zalo', 'Đánh dấu hoàn thành']) await expect(menu.getByText(label, { exact: true })).toBeVisible();
    await menu.getByText('Đánh dấu hoàn thành', { exact: true }).click();
    await expect(toast(page, 'Đã đánh dấu hoàn thành lịch hẹn')).toBeVisible();
    await expect(card).toContainText('Đã hoàn thành');
    await expect.poll(() => kpi(page, /Hoàn thành tháng này/)).toBe(doneBefore + 1);
    const find = async () => (await backstage.find('appointments')).find((r) => String(r.customerId) === c.id);
    expect((await find()).status).toBe('DONE');
    const version = (await find()).__v;

    // Tải lại: trạng thái giữ nguyên.
    await page.reload();
    await expect(cardFor(page, c.fullName)).toContainText('Đã hoàn thành');

    // Bỏ đánh dấu.
    await cardFor(page, c.fullName).getByRole('button', { name: 'Thao tác khác' }).click();
    await page.getByRole('list', { name: 'Thao tác lịch hẹn' }).getByText('Bỏ đánh dấu hoàn thành', { exact: true }).click();
    await expect(toast(page, 'Đã mở lại lịch hẹn')).toBeVisible();
    await expect(cardFor(page, c.fullName)).not.toContainText('Đã hoàn thành');
    await expect.poll(async () => (await find()).status).toBe('SCHEDULED');
    expect((await find()).__v).toBeGreaterThan(version);

    // "Xem hồ sơ khách" mở đúng khách.
    await cardFor(page, c.fullName).getByRole('button', { name: 'Thao tác khác' }).click();
    await page.getByRole('list', { name: 'Thao tác lịch hẹn' }).getByText('Xem hồ sơ khách', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`));
  });

  test('F4-08 việc lịch hẹn ở "Việc hôm nay": nút "Hoàn thành" đóng việc và cập nhật lịch hẹn; thẻ "Ký cọc" và "Nhắc gọi lại" có nút xác nhận riêng', async ({ loginAs, api, backstage }, testInfo) => {
    const slot = await todaySlot(testInfo);
    const c = await api.createCustomer({ label: 'Khách-ViệcHôm' });
    const deposit = await api.createCustomer({ label: 'Khách-KýCọc' });
    const callback = await api.createCustomer({ label: 'Khách-GọiLại' });
    await api.createAppointment({ customerId: c.id, slot });
    await api.createAppointment({ customerId: deposit.id, slot, type: 'DEPOSIT_CONTRACT' });
    await api.createAppointment({ customerId: callback.id, slot, type: 'CALLBACK', location: '' });
    const page = await loginAs('staff1');

    await page.goto('/crm/today');
    const task = page.getByTestId('daily-task-card').filter({ hasText: c.fullName });
    await expect(task).toHaveCount(1);
    await task.getByRole('button', { name: 'Hoàn thành' }).click();
    await expect(toast(page, 'Đã hoàn thành lịch hẹn')).toBeVisible();
    await expect
      .poll(async () => (await backstage.find('appointments')).find((r) => String(r.customerId) === c.id).status)
      .toBe('DONE');

    await page.goto('/crm/appointments');
    const depositCard = cardFor(page, deposit.fullName);
    await depositCard.getByRole('button', { name: 'Xác nhận hoàn thành' }).click();
    await expect(toast(page, 'Đã đánh dấu hoàn thành lịch hẹn')).toBeVisible();
    await expect(depositCard.getByRole('button', { name: 'Hoàn tác xác nhận' })).toBeVisible();
    await depositCard.getByRole('button', { name: 'Hoàn tác xác nhận' }).click();
    await expect(toast(page, 'Đã mở lại lịch hẹn')).toBeVisible();

    const callbackCard = cardFor(page, callback.fullName);
    await callbackCard.getByRole('button', { name: 'Đã liên hệ xong' }).click();
    await expect(callbackCard.getByRole('button', { name: 'Hoàn tác liên hệ' })).toBeVisible();
  });

  test('F4-08 chuông thông báo: số chưa đọc tăng khi có nhắc lịch hẹn đến hạn, mở được danh sách và thông báo dẫn tới khách', async ({ loginAs, api }) => {
    test.setTimeout(240_000);
    const c = await api.createCustomer({ label: 'Khách-Chuông' });
    const page = await loginAs('staff1');
    await page.goto('/crm/today');
    const bell = page.getByTestId('notification-bell');
    await expect(bell).toBeVisible();
    const count = page.getByTestId('notification-bell-count');
    const readCount = async () => ((await count.count()) === 0 ? 0 : Number((await count.innerText()).replace('+', '')));
    const before = await readCount();

    // Nhắc trước 15 phút của lịch hẹn sau 6 phút = đã quá hạn từ lúc tạo; job nhắc việc 1 phút/lần sẽ gửi.
    const startAtIso = new Date(Date.now() + 6 * 60_000).toISOString();
    await api.createAppointment({ customerId: c.id, startAtIso, remindBeforeMinutes: [15], title: `Hẹn chuông ${c.fullName}` });

    await expect(async () => {
      await page.reload();
      expect(await readCount()).toBeGreaterThan(before);
    }).toPass({ intervals: [10_000], timeout: 180_000 });

    await bell.click();
    const item = page.getByRole('listitem').filter({ hasText: c.fullName }).first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/crm/(customers/${c.id}|appointments)`));
  });

  test('F4-09 đổi giờ / hủy lịch hẹn có ở thẻ lịch hẹn (desktop và mobile, mọi loại thẻ)', async ({ loginAs, api }, testInfo) => {
    const slot = await todaySlot(testInfo);
    const cards = [
      { label: 'Xem nhà mẫu', customer: await api.createCustomer({ label: 'Khách-ĐổiGiờ-Xem' }), type: 'SITE_VISIT' },
      { label: 'Ký cọc', customer: await api.createCustomer({ label: 'Khách-ĐổiGiờ-Cọc' }), type: 'DEPOSIT_CONTRACT' },
      { label: 'Nhắc gọi lại', customer: await api.createCustomer({ label: 'Khách-ĐổiGiờ-Gọi' }), type: 'CALLBACK' },
    ];
    for (const { customer, type } of cards) await api.createAppointment({ customerId: customer.id, slot, type, ...(type === 'CALLBACK' ? { location: '' } : {}) });
    const page = await loginAs('staff1');
    const pattern = /đổi giờ|dời|hoãn|hủy lịch|huỷ lịch|hủy hẹn|xóa lịch|xoá lịch|sửa lịch/i;

    /** Thẻ có lối đổi giờ/hủy không: tìm trong menu "Thao tác khác" (nếu thẻ có) và trong mọi nút của thẻ. */
    const offersRescheduleOrCancel = async (fullName: string): Promise<boolean> => {
      const card = cardFor(page, fullName);
      await expect(card).toHaveCount(1);
      const texts: string[] = await card.getByRole('button').allInnerTexts();
      const menuButton = card.getByRole('button', { name: 'Thao tác khác' });
      if (await menuButton.count()) {
        await menuButton.click();
        texts.push(await card.getByRole('list', { name: 'Thao tác lịch hẹn' }).innerText());
        await menuButton.click(); // đóng menu bằng chính nút mở
      }
      return pattern.test(texts.join('|'));
    };
    const check = async (viewport: string) => {
      for (const { label, customer } of cards) expect.soft(await offersRescheduleOrCancel(customer.fullName), `${viewport} / thẻ "${label}": phải có Đổi giờ hoặc Hủy lịch`).toBe(true);
    };
    await page.goto('/crm/appointments');
    await check('desktop');
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/crm/appointments');
    await check('mobile');
  });

  test('F4-09b đổi giờ lưu đúng giờ mới (lịch rời khỏi hôm nay); hủy lịch kèm lý do rồi "Hoàn tác" mở lại được', async ({ loginAs, api, backstage }, testInfo) => {
    const slot = await todaySlot(testInfo);
    const mover = await api.createCustomer({ label: 'Khách-DờiGiờ' });
    const canceler = await api.createCustomer({ label: 'Khách-HủyLịch' });
    await api.createAppointment({ customerId: mover.id, slot });
    await api.createAppointment({ customerId: canceler.id, slot });
    const page = await loginAs('staff1');
    await page.goto('/crm/appointments');
    const openMenuItem = async (fullName: string, item: string) => {
      const card = cardFor(page, fullName);
      await expect(card).toHaveCount(1);
      await card.getByRole('button', { name: 'Thao tác khác' }).click();
      await card.getByRole('list', { name: 'Thao tác lịch hẹn' }).getByRole('button', { name: item }).click();
    };

    // Đổi giờ sang ngày mai 10:15 (giờ VN = 03:15 UTC): lưu đúng, thẻ rời khỏi danh sách "hôm nay".
    const newDate = vnToday(1);
    await openMenuItem(mover.fullName, 'Đổi giờ');
    const rescheduleDialog = page.getByRole('dialog', { name: 'Đổi giờ lịch hẹn' });
    await rescheduleDialog.getByLabel('Ngày mới').fill(newDate);
    await rescheduleDialog.getByLabel('Giờ mới (giờ Việt Nam)').fill('10:15');
    await rescheduleDialog.getByRole('button', { name: 'Lưu giờ mới' }).click();
    await expect(toast(page, 'Đã đổi giờ lịch hẹn')).toBeVisible();
    await expect(cardFor(page, mover.fullName)).toHaveCount(0);
    const moved = (await backstage.find('appointments')).find((r) => String(r.customerId) === mover.id);
    expect(new Date(moved?.startAt).toISOString()).toBe(`${newDate}T03:15:00.000Z`);

    // Hủy kèm lý do: thẻ biến mất khỏi danh sách; "Hoàn tác" ngay trên thông báo mở lại lịch.
    await openMenuItem(canceler.fullName, 'Hủy lịch hẹn');
    const cancelDialog = page.getByRole('alertdialog', { name: 'Hủy lịch hẹn này?' });
    await cancelDialog.getByLabel('Lý do hủy (tùy chọn)').fill('Khách bận việc đột xuất');
    await cancelDialog.getByRole('button', { name: 'Xác nhận hủy lịch' }).click();
    await expect(toast(page, 'Đã hủy lịch hẹn')).toBeVisible();
    await expect(cardFor(page, canceler.fullName)).toHaveCount(0);
    const canceled = (await backstage.find('appointments')).find((r) => String(r.customerId) === canceler.id);
    expect(canceled?.status).toBe('CANCELED');
    expect(canceled?.outcome).toBe('Khách bận việc đột xuất');

    await toast(page, 'Đã hủy lịch hẹn').getByRole('button', { name: 'Hoàn tác' }).click();
    await expect(toast(page, 'Đã mở lại lịch hẹn')).toBeVisible();
    await expect(cardFor(page, canceler.fullName)).toHaveCount(1);
    const reopened = (await backstage.find('appointments')).find((r) => String(r.customerId) === canceler.id);
    expect(reopened?.status).toBe('SCHEDULED');
  });

  test('F4-09c xung đột phiên bản (409): lịch bị phiên khác sửa trước khi bấm Đổi giờ / Hủy -> báo xung đột rõ, không ghi đè, tải lại dữ liệu, hộp thoại còn đường ra, nút không kẹt', async ({ loginAs, api, backstage }, testInfo) => {
    const slot = await todaySlot(testInfo);
    const mover = await api.createCustomer({ label: 'Khách-409-DờiGiờ' });
    const canceler = await api.createCustomer({ label: 'Khách-409-Hủy' });
    await api.createAppointment({ customerId: mover.id, slot });
    await api.createAppointment({ customerId: canceler.id, slot });
    const rowOf = async (customerId: string) => (await backstage.find('appointments')).find((r) => String(r.customerId) === customerId);
    const page = await loginAs('staff1');
    await page.goto('/crm/appointments');
    await expect(cardFor(page, mover.fullName)).toHaveCount(1);
    await expect(cardFor(page, canceler.fullName)).toHaveCount(1);

    /** Phiên khác (API) sửa địa điểm với đúng version hiện tại: __v tăng, thẻ trên màn hình thành "cũ". */
    const editElsewhere = async (customerId: string, location: string) => {
      const row = await rowOf(customerId);
      const r = await api.call('staff1', 'PATCH', `/crm/appointments/${row?._id}`, { version: row?.__v, location });
      expect(r.status).toBe(200);
      return row?.__v as number;
    };
    const CONFLICT = /^Lịch hẹn vừa được người khác cập nhật\. Dữ liệu mới nhất đã được tải lại/;
    const openMenuItem = async (fullName: string, item: string) => {
      await cardFor(page, fullName).getByRole('button', { name: 'Thao tác khác' }).click();
      await cardFor(page, fullName).getByRole('list', { name: 'Thao tác lịch hẹn' }).getByRole('button', { name: item }).click();
    };

    // --- Đổi giờ ---
    const moverLocation = 'Địa điểm do phiên khác sửa (đổi giờ)';
    const moverStale = await editElsewhere(mover.id, moverLocation);
    await expect(cardFor(page, mover.fullName)).not.toContainText(moverLocation); // màn hình vẫn là bản cũ
    const newDate = vnToday(1);
    await openMenuItem(mover.fullName, 'Đổi giờ');
    const rescheduleDialog = page.getByRole('dialog', { name: 'Đổi giờ lịch hẹn' });
    await rescheduleDialog.getByLabel('Ngày mới').fill(newDate);
    await rescheduleDialog.getByLabel('Giờ mới (giờ Việt Nam)').fill('10:15');
    await rescheduleDialog.getByRole('button', { name: 'Lưu giờ mới' }).click();
    await expect(toast(page, CONFLICT)).toBeVisible();
    // Không ghi đè: giờ cũ giữ nguyên, địa điểm của phiên khác còn đó, version chỉ tăng do lần sửa kia.
    const afterConflict = await rowOf(mover.id);
    expect(new Date(afterConflict?.startAt).toISOString()).toBe(slot.iso);
    expect(afterConflict?.location).toBe(moverLocation);
    expect(afterConflict?.__v).toBe(moverStale + 1);
    // Dữ liệu được tải lại ngay (thẻ phía sau hộp thoại đã có địa điểm mới); hộp thoại còn mở, nút "Lưu giờ mới" không kẹt "Đang lưu…".
    await expect(cardFor(page, mover.fullName)).toContainText(moverLocation);
    await expect(rescheduleDialog).toBeVisible();
    await expect(rescheduleDialog.getByRole('button', { name: 'Lưu giờ mới' })).toBeEnabled();
    // Đường ra 1: "Đóng" thoát được; mở lại thì lưu thành công với version mới (pendingIds đã được gỡ).
    await rescheduleDialog.getByRole('button', { name: 'Đóng' }).click();
    await expect(rescheduleDialog).toHaveCount(0);
    await openMenuItem(mover.fullName, 'Đổi giờ');
    await rescheduleDialog.getByLabel('Ngày mới').fill(newDate);
    await rescheduleDialog.getByLabel('Giờ mới (giờ Việt Nam)').fill('10:15');
    await rescheduleDialog.getByRole('button', { name: 'Lưu giờ mới' }).click();
    await expect(toast(page, 'Đã đổi giờ lịch hẹn')).toBeVisible();
    await expect(cardFor(page, mover.fullName)).toHaveCount(0);
    expect(new Date((await rowOf(mover.id))?.startAt).toISOString()).toBe(`${newDate}T03:15:00.000Z`);

    // --- Hủy lịch ---
    const cancelerLocation = 'Địa điểm do phiên khác sửa (hủy)';
    const cancelerStale = await editElsewhere(canceler.id, cancelerLocation);
    await openMenuItem(canceler.fullName, 'Hủy lịch hẹn');
    const cancelDialog = page.getByRole('alertdialog', { name: 'Hủy lịch hẹn này?' });
    await cancelDialog.getByLabel('Lý do hủy (tùy chọn)').fill('Khách đổi ý');
    await cancelDialog.getByRole('button', { name: 'Xác nhận hủy lịch' }).click();
    await expect(toast(page, CONFLICT)).toBeVisible();
    const canceledRow = await rowOf(canceler.id);
    expect(canceledRow?.status).toBe('SCHEDULED');
    expect(canceledRow?.outcome ?? '').toBe('');
    expect(canceledRow?.location).toBe(cancelerLocation);
    expect(canceledRow?.__v).toBe(cancelerStale + 1);
    await expect(cardFor(page, canceler.fullName)).toContainText(cancelerLocation);
    // Hộp thoại còn mở, lý do đã nhập không mất; đường ra 2: bấm lại "Xác nhận hủy lịch" (version mới) thì hủy thành công.
    await expect(cancelDialog).toBeVisible();
    await expect(cancelDialog.getByLabel('Lý do hủy (tùy chọn)')).toHaveValue('Khách đổi ý');
    await cancelDialog.getByRole('button', { name: 'Xác nhận hủy lịch' }).click();
    await expect(toast(page, 'Đã hủy lịch hẹn')).toBeVisible();
    await expect(cardFor(page, canceler.fullName)).toHaveCount(0);
    const finalRow = await rowOf(canceler.id);
    expect(finalRow?.status).toBe('CANCELED');
    expect(finalRow?.outcome).toBe('Khách đổi ý');
  });

  test('F4-09d mobile: Đổi giờ, Hủy kèm lý do và Hoàn tác trên thẻ lịch hẹn (menu ⋮ của thẻ mobile)', async ({ loginAs, api, backstage }, testInfo) => {
    const slot = await todaySlot(testInfo);
    const mover = await api.createCustomer({ label: 'Khách-Mobile-DờiGiờ' });
    const canceler = await api.createCustomer({ label: 'Khách-Mobile-Hủy' });
    await api.createAppointment({ customerId: mover.id, slot });
    await api.createAppointment({ customerId: canceler.id, slot });
    const rowOf = async (customerId: string) => (await backstage.find('appointments')).find((r) => String(r.customerId) === customerId);
    const page = await loginAs('staff1');
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/crm/appointments');
    // Đang ở biến thể mobile: có thanh điều hướng đáy của app.
    await expect(cardFor(page, mover.fullName)).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Điều hướng module khách hàng' })).toBeVisible();
    const openMenuItem = async (fullName: string, item: string) => {
      const card = cardFor(page, fullName);
      await card.getByRole('button', { name: 'Thao tác khác' }).click();
      const entry = card.getByRole('list', { name: 'Thao tác lịch hẹn' }).getByRole('button', { name: item });
      await expect(entry).toBeVisible();
      // Mục menu phải nằm trọn trong khung nhìn điện thoại (không bị cắt ngang mép) để chạm được.
      const box = await entry.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= MOBILE_VIEWPORT.width, `mục "${item}" nằm trọn trong chiều ngang ${MOBILE_VIEWPORT.width}px`).toBe(true);
      await entry.click();
    };

    // Đổi giờ -> ngày mai 10:15 (VN = 03:15 UTC); hộp thoại vừa khung điện thoại.
    const newDate = vnToday(1);
    await openMenuItem(mover.fullName, 'Đổi giờ');
    const rescheduleDialog = page.getByRole('dialog', { name: 'Đổi giờ lịch hẹn' });
    await expect(rescheduleDialog).toBeVisible();
    const dialogBox = await rescheduleDialog.boundingBox();
    expect(dialogBox && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= MOBILE_VIEWPORT.width, 'hộp Đổi giờ nằm trọn trong chiều ngang điện thoại').toBe(true);
    await rescheduleDialog.getByLabel('Ngày mới').fill(newDate);
    await rescheduleDialog.getByLabel('Giờ mới (giờ Việt Nam)').fill('10:15');
    await rescheduleDialog.getByRole('button', { name: 'Lưu giờ mới' }).click();
    await expect(toast(page, 'Đã đổi giờ lịch hẹn')).toBeVisible();
    await expect(cardFor(page, mover.fullName)).toHaveCount(0);
    expect(new Date((await rowOf(mover.id))?.startAt).toISOString()).toBe(`${newDate}T03:15:00.000Z`);

    // Hủy kèm lý do rồi Hoàn tác từ thông báo.
    await openMenuItem(canceler.fullName, 'Hủy lịch hẹn');
    const cancelDialog = page.getByRole('alertdialog', { name: 'Hủy lịch hẹn này?' });
    await cancelDialog.getByLabel('Lý do hủy (tùy chọn)').fill('Khách bận việc đột xuất');
    await cancelDialog.getByRole('button', { name: 'Xác nhận hủy lịch' }).click();
    await expect(toast(page, 'Đã hủy lịch hẹn')).toBeVisible();
    await expect(cardFor(page, canceler.fullName)).toHaveCount(0);
    const canceled = await rowOf(canceler.id);
    expect(canceled?.status).toBe('CANCELED');
    expect(canceled?.outcome).toBe('Khách bận việc đột xuất');
    await toast(page, 'Đã hủy lịch hẹn').getByRole('button', { name: 'Hoàn tác' }).click();
    await expect(toast(page, 'Đã mở lại lịch hẹn')).toBeVisible();
    await expect(cardFor(page, canceler.fullName)).toHaveCount(1);
    expect((await rowOf(canceler.id))?.status).toBe('SCHEDULED');
  });

  test('F4-02 giờ mặc định đã qua: form chặn ngay, lỗi chỉ rõ cạnh ô Giờ, rời form không bị chặn', async ({ loginAs, api }) => {
    const c = await api.createCustomer({ label: 'Khách-GiờQuáKhứ' });
    const page = await loginAs('staff1');
    // Đồng hồ TRÌNH DUYỆT cố định ở 12:00 hôm nay (giờ VN): giờ mặc định 09:30 của form luôn là quá khứ, bất kể giờ chạy thật.
    // Ca này không gọi backend (lỗi chặn ngay ở form) nên không cần đồng hồ máy chủ khớp.
    await page.clock.setFixedTime(new Date(`${vnToday()}T12:00:00+07:00`));
    await page.goto(`/crm/appointments/new?customerId=${c.id}`);
    await expect(customerCard(page)).toContainText(c.fullName);
    await expect(timeInput(page)).toHaveValue('09:30');
    await locationInput(page).fill('Văn phòng');
    await page.getByRole('button', { name: SUBMIT }).click();
    await expect(toast(page, 'Chưa thể tạo lịch hẹn')).toContainText('Giờ hẹn không được ở quá khứ.');
    await expect(page.locator('#appointment-time-error')).toHaveText('Giờ hẹn không được ở quá khứ.');
    await expect(timeInput(page)).toBeFocused();
    await expect(page).toHaveURL(/appointments\/new/);
    await openCustomerDetail(page, c.id, c.fullName); // rời form không bị chặn
  });
});
