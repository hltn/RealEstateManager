/**
 * F3 - Nhật ký chăm sóc và ảnh đính kèm (doc 08 mục 4: F3-01..04).
 * Mỗi test tự tạo khách riêng bằng API. Ảnh hợp lệ do trình duyệt tự vẽ (canvas) nên không cần file nhị phân trong repo;
 * "ảnh quá lớn" và "PDF" là buffer giả (FE chặn trước khi tải lên, không đi tới máy chủ).
 *
 * Quyết định [Chưa rõ]:
 * - F3-04b: mục nhật ký đã lưu có nút "Xóa ảnh N khỏi nhật ký" (chỉ khi người xem còn quyền sửa nhật ký) + hộp xác nhận "Xác nhận gỡ ảnh";
 *   nút "Xóa ảnh N" ở khay trước khi lưu là điều khiển khác (F3-04a).
 */
import { test, expect } from '../fixtures';
import { MOBILE_VIEWPORT, bigPng, makeJpeg, note, openCustomerDetail, pdfFile, todaySlot, toast } from '../lib/ui';
import type { Page } from '@playwright/test';

const photoInput = (page: Page) => page.getByLabel('Thêm ảnh');
const saveButton = (page: Page) => page.getByRole('button', { name: /^(Lưu nhật ký|Đang lưu…|Đang tải ảnh…)$/ });
const contentBox = (page: Page) => page.getByRole('textbox', { name: /^Nội dung trao đổi/ });
const timeline = (page: Page) => page.getByRole('region', { name: 'Nhật ký chăm sóc' });
const photoHint = (n: number) => `Đã chọn ${n}/5 ảnh.`;

async function expectNoPendingUpload(page: Page) {
  await expect(page.getByRole('status', { name: 'Đang tải ảnh lên' })).toHaveCount(0);
}

test.describe('f3-care-log', () => {
  test('F3-01 ghi nhật ký có nhắc việc: hiện ngay đầu dòng thời gian, form dọn trống, Việc hôm nay có "Bước tiếp theo"', async ({ loginAs, api, backstage }, testInfo) => {
    const dueSlot = await todaySlot(testInfo); // "Thời điểm nhắc" hôm nay để việc hiện ở Việc hôm nay
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);

    // Nút lưu khóa khi nội dung rỗng.
    await expect(saveButton(page)).toBeDisabled();

    const content = `Gọi khách ${customer.fullName}, quan tâm căn 2PN`;
    const nextStep = `Xác nhận lịch xem nhà mẫu ${customer.fullName}`;
    await contentBox(page).fill(content);
    await expect(saveButton(page)).toBeEnabled();
    await page.getByLabel('Kênh liên hệ').selectOption({ label: 'Zalo' });
    await page.getByLabel('Kết quả liên hệ').selectOption({ label: 'Hẹn xem sa bàn / nhà mẫu' });
    // Chọn kết quả liên hệ tự gợi ý việc tiếp theo (người dùng sửa được).
    await expect(page.getByLabel('Việc cần làm tiếp theo')).not.toHaveValue('');
    await page.getByLabel('Việc cần làm tiếp theo').fill(nextStep);
    await page.getByLabel('Thời điểm nhắc').fill(`${dueSlot.date}T${dueSlot.time}`);
    await saveButton(page).click();

    await expect(toast(page, 'Đã lưu nhật ký chăm sóc')).toBeVisible();
    // Form dọn trống, ở lại chi tiết khách.
    await expect(contentBox(page)).toHaveValue('');
    await expect(page.getByLabel('Việc cần làm tiếp theo')).toHaveValue('');
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${customer.id}$`));
    // Mục mới ở đầu dòng thời gian, không cần tải lại trang.
    const first = timeline(page).getByRole('article').first();
    await expect(first).toContainText(content);
    await expect(first).toContainText('Zalo');
    await expect(first).toContainText('Hẹn xem sa bàn / nhà mẫu');
    await expect(first).toContainText(`Tiếp theo: ${nextStep}`);

    // Hậu trường.
    const logs = (await backstage.find('care_logs')).filter((l) => String(l.customerId) === customer.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].content).toBe(content);
    expect(logs[0].contactChannel).toBe('ZALO');
    expect(logs[0].nextAction.suggestion).toBe(nextStep);
    const reminders = (await backstage.find('reminders')).filter((r) => String(r.customerId) === customer.id);
    expect(reminders.length).toBeGreaterThanOrEqual(1);
    expect(reminders.map((r) => r.type)).toContain('FOLLOW_UP');

    // Việc hôm nay của staff1: có việc "Bước tiếp theo" của khách này, có nút "Ghi nhật ký".
    await page.goto('/crm/today');
    const task = page.getByTestId('daily-task-card').filter({ hasText: customer.fullName });
    await expect(task).toHaveCount(1);
    await expect(task).toContainText('Bước tiếp theo');
    await expect(task).toContainText(nextStep);
    await expect(task.getByRole('button', { name: 'Ghi nhật ký' })).toBeVisible();
    note(testInfo, 'TT', 'Ghi nhật ký có nhắc việc: nhập 4 ô (nội dung, việc tiếp theo, thời điểm nhắc) + chọn 2 danh sách + 1 click lưu.');
  });

  test('F3-02 tải ảnh lên nhật ký: khung ảnh hiện khi cờ bật, tải lên MinIO, hiện lại sau khi tải lại trang (G1)', async ({ loginAs, api, backstage }) => {
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);

    // Khung "Ảnh đính kèm" và nút "Thêm ảnh" hiện ngay (cờ FE bật), kèm gợi ý giới hạn.
    await expect(page.getByText('Ảnh đính kèm', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Thêm ảnh')).toBeVisible();
    await expect(page.getByText(`JPEG, PNG hoặc WebP, tối đa 5 MB mỗi ảnh, tối đa 5 ảnh. ${photoHint(0)}`)).toBeVisible();

    // Giữ request tải ảnh để quan sát trạng thái "đang tải".
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/care-log-attachments', async (route) => {
      if (route.request().method() === 'POST') await gate;
      await route.continue();
    });
    const jpeg = await makeJpeg(page, 1);
    await photoInput(page).setInputFiles({ name: 'anh-hop-le.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await expect(page.getByRole('status', { name: 'Đang tải ảnh lên' })).toBeVisible();
    await contentBox(page).fill('Gửi ảnh căn mẫu cho khách');
    await expect(page.getByRole('button', { name: 'Đang tải ảnh…' })).toBeDisabled();
    release();
    await expectNoPendingUpload(page);
    await expect(page.getByText(photoHint(1))).toBeVisible();
    // Xem trước đúng ảnh đã chọn.
    await expect(page.getByRole('list', { name: 'Ảnh đã đính kèm' }).getByRole('img', { name: 'anh-hop-le.jpg' })).toBeVisible();

    await saveButton(page).click();
    await expect(toast(page, 'Đã lưu nhật ký chăm sóc')).toBeVisible();
    await expect(page.getByText(photoHint(0))).toBeVisible(); // khay dọn sau khi lưu

    // Ảnh hiện trong đúng mục nhật ký vừa lưu và tải được (naturalWidth > 0).
    const entry = timeline(page).getByRole('article').first();
    await expect(entry).toContainText('Gửi ảnh căn mẫu cho khách');
    const photo = entry.getByTestId('care-log-photo');
    await expect(photo).toHaveCount(1);
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // Tải lại trang: ảnh vẫn hiện (URL ký sẵn mới).
    await page.reload();
    const entryAfter = timeline(page).getByRole('article').first();
    await expect(entryAfter).toContainText('Gửi ảnh căn mẫu cho khách');
    const photoAfter = entryAfter.getByTestId('care-log-photo');
    await expect(photoAfter).toHaveCount(1);
    await expect.poll(() => photoAfter.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // Hậu trường: bản ghi crm_attachments gắn nhật ký; đối tượng MinIO đúng fileKey và kích thước.
    const logs = (await backstage.find('care_logs')).filter((l) => String(l.customerId) === customer.id);
    expect(logs).toHaveLength(1);
    const atts = (await backstage.find('crm_attachments')).filter((a) => String(a.customerId) === customer.id);
    expect(atts).toHaveLength(1);
    expect(atts[0].status).toBe('ATTACHED');
    expect(String(atts[0].careLogId)).toBe(String(logs[0]._id));
    expect(atts[0].mimeType).toBe('image/jpeg');
    expect(await backstage.s3Has(atts[0].fileKey)).toBe(true);
    expect(await backstage.s3Size(atts[0].fileKey)).toBe(atts[0].size);
    expect(logs[0].attachments.map((a: { fileKey: string }) => a.fileKey)).toEqual([atts[0].fileKey]);
  });

  test('F3-02 [+mobile] tải ảnh lên nhật ký trên di động (tab "Nhật ký")', async ({ loginAs, api }) => {
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/crm/customers/${customer.id}`);
    await expect(page.getByRole('heading', { name: customer.fullName }).first()).toBeVisible();
    await page.getByRole('tab', { name: /^Nhật ký/ }).click();
    await expect(page.getByText('Thêm ảnh')).toBeVisible();
    const jpeg = await makeJpeg(page, 2);
    await photoInput(page).setInputFiles({ name: 'anh-hop-le.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await expectNoPendingUpload(page);
    await expect(page.getByText(photoHint(1))).toBeVisible();
    await contentBox(page).fill('Ảnh từ điện thoại');
    await saveButton(page).click();
    await expect(toast(page, 'Đã lưu nhật ký chăm sóc')).toBeVisible();
    const photo = page.getByTestId('care-log-photo');
    await expect(photo).toHaveCount(1);
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test('F3-03 ảnh sai loại, quá lớn, vượt số lượng: báo "Bỏ qua N ảnh", không mất nội dung, không lên MinIO', async ({ loginAs, api, backstage }) => {
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);
    await contentBox(page).fill('Nội dung đã gõ phải được giữ');
    const keysBefore = await backstage.s3Keys();
    const warning = 'Chỉ nhận ảnh JPEG/PNG/WebP ≤ 5 MB, tối đa 5 ảnh.';

    // PDF.
    await photoInput(page).setInputFiles(pdfFile());
    await expect(toast(page, 'Bỏ qua 1 ảnh')).toContainText(warning);
    await expect(page.getByText(photoHint(0))).toBeVisible();
    await expect(page.getByRole('list', { name: 'Ảnh đã đính kèm' })).toHaveCount(0);
    await expect(toast(page, 'Bỏ qua 1 ảnh'), 'toast của bước PDF phải tắt hẳn trước bước sau (để toast kế tiếp là của chính bước đó)').toHaveCount(0, { timeout: 15_000 });

    // PNG > 5 MB.
    await photoInput(page).setInputFiles(bigPng());
    await expect(toast(page, 'Bỏ qua 1 ảnh')).toBeVisible();
    await expect(page.getByText(photoHint(0))).toBeVisible();
    await expect(toast(page, 'Bỏ qua 1 ảnh'), 'toast của bước PNG phải tắt hẳn trước bước 6 ảnh').toHaveCount(0, { timeout: 15_000 });

    // Cả hai không tạo bản ghi/đối tượng nào.
    expect((await backstage.find('crm_attachments')).filter((a) => String(a.customerId) === customer.id)).toHaveLength(0);
    expect(await backstage.s3Keys()).toEqual(keysBefore);
    await expect(contentBox(page)).toHaveValue('Nội dung đã gõ phải được giữ');

    // 6 ảnh hợp lệ một lần: nhận 5, bỏ qua 1.
    const files = [];
    for (let i = 0; i < 6; i += 1) files.push({ name: `anh-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: await makeJpeg(page, i + 3) });
    await photoInput(page).setInputFiles(files);
    await expect(toast(page, 'Bỏ qua 1 ảnh')).toContainText(warning);
    await expectNoPendingUpload(page);
    await expect(page.getByText(photoHint(5))).toBeVisible();
    await expect(page.getByRole('list', { name: 'Ảnh đã đính kèm' }).getByRole('listitem')).toHaveCount(5);
    expect((await backstage.find('crm_attachments')).filter((a) => String(a.customerId) === customer.id)).toHaveLength(5);
    await expect(contentBox(page)).toHaveValue('Nội dung đã gõ phải được giữ');
  });

  test('F3-04a gỡ ảnh trước khi lưu: khay còn 1 ảnh, chỉ ảnh còn lại được gắn vào nhật ký', async ({ loginAs, api, backstage }) => {
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);
    await photoInput(page).setInputFiles([
      { name: 'anh-1.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 1) },
      { name: 'anh-2.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 2) },
    ]);
    await expectNoPendingUpload(page);
    await expect(page.getByText(photoHint(2))).toBeVisible();

    await page.getByRole('button', { name: 'Xóa ảnh 1' }).click();
    await expect(page.getByText(photoHint(1))).toBeVisible();
    const tray = page.getByRole('list', { name: 'Ảnh đã đính kèm' });
    await expect(tray.getByRole('listitem')).toHaveCount(1);
    await expect(tray.getByRole('img', { name: 'anh-2.jpg' })).toBeVisible();

    await contentBox(page).fill('Chỉ giữ ảnh số 2');
    await saveButton(page).click();
    await expect(toast(page, 'Đã lưu nhật ký chăm sóc')).toBeVisible();
    await expect(timeline(page).getByRole('article').first().getByTestId('care-log-photo')).toHaveCount(1);

    await expect
      .poll(async () => (await backstage.find('crm_attachments')).filter((a) => String(a.customerId) === customer.id).map((a) => a.status).sort())
      .toEqual(['ATTACHED', 'REMOVED']);
    const attached = (await backstage.find('crm_attachments')).find((a) => String(a.customerId) === customer.id && a.status === 'ATTACHED');
    expect(attached.originalName).toBe('anh-2.jpg');
  });

  test('F3-04b gỡ ảnh khỏi nhật ký ĐÃ LƯU: nút gỡ ở mục nhật ký, xác nhận rồi ảnh biến mất', async ({ loginAs, api }) => {
    const customer = await api.createCustomer();
    const page = await loginAs('staff1');
    await openCustomerDetail(page, customer.id, customer.fullName);
    await photoInput(page).setInputFiles({ name: 'anh-hop-le.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 1) });
    await expectNoPendingUpload(page);
    await contentBox(page).fill('Nhật ký có ảnh cần gỡ');
    await saveButton(page).click();
    await expect(toast(page, 'Đã lưu nhật ký chăm sóc')).toBeVisible();
    const entry = timeline(page).getByRole('article').first();
    await expect(entry.getByTestId('care-log-photo')).toHaveCount(1);
    const removeButton = entry.getByRole('button', { name: /Gỡ ảnh|Xóa ảnh/ });
    await expect(removeButton, 'mục nhật ký đã lưu phải có nút "Gỡ ảnh"').toBeVisible();
    await removeButton.click();
    await page.getByRole('button', { name: /Xác nhận|Đồng ý|Gỡ/ }).click();
    await expect(entry.getByTestId('care-log-photo')).toHaveCount(0);
  });
});
