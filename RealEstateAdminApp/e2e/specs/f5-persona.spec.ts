/**
 * F5 - Chân dung, nhu cầu và thẻ (doc 08 mục 6: F5-01, F5-02).
 *
 * Quyết định [Chưa rõ]:
 * - Độ đầy đủ chân dung nằm ở thẻ "Chân dung khách hàng" của chi tiết khách ("Độ đầy đủ chân dung N%").
 * - Sau "Lưu chân dung" / "Lưu nhu cầu" app gọi `goBack()`: vào form từ chi tiết khách thì quay về chi tiết khách (đúng nơi bắt đầu).
 *   Mở thẳng URL form (không có lịch sử) thì về màn cha (chi tiết khách) nhờ đích dự phòng của `goBack()`.
 * - Thẻ: gắn/gỡ ở form "Chân dung khách hàng" (mục "Thẻ sở thích"), hiện ở thẻ "Thông tin" của chi tiết khách; BỘ LỌC theo thẻ CÓ nhưng chỉ ở
 *   "Bộ lọc nâng cao" (không có ở thanh lọc nhanh).
 */
import { test, expect } from '../fixtures';
import { uid } from '../lib/api';
import { note, openCustomerDetail, searchCustomers, toast } from '../lib/ui';
import type { Page } from '@playwright/test';

const personaCard = (page: Page) => page.getByRole('region', { name: 'Chân dung khách hàng' });
const needsCard = (page: Page) => page.getByRole('region', { name: 'Nhu cầu BĐS' });
const infoCard = (page: Page) => page.getByRole('region', { name: 'Thông tin khách hàng' });

async function completeness(page: Page): Promise<number> {
  const text = await personaCard(page).innerText();
  const match = /Độ đầy đủ chân dung\s*(\d+)%/.exec(text.replace(/\n/g, ' '));
  if (!match) throw new Error(`Không đọc được độ đầy đủ: ${text.slice(0, 200)}`);
  return Number(match[1]);
}

test.describe('f5-persona', () => {
  test('F5-01 điền chân dung và nhu cầu: có thông báo, quay về chi tiết khách, giá trị mới hiện, độ đầy đủ tăng, ngân sách sai báo lỗi cạnh trường', async ({ loginAs, api, backstage }, testInfo) => {
    const c = await api.createCustomer({ label: 'Khách-ChânDung' });
    const page = await loginAs('staff1');
    await openCustomerDetail(page, c.id, c.fullName);
    const before = await completeness(page);
    const rowsBefore = await backstage.find('customers', { fullName: c.fullName });
    const versionBefore = rowsBefore[0].__v;

    // Chân dung: 3 trường.
    await page.getByRole('button', { name: 'Sửa chân dung khách hàng' }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}/persona$`));
    await page.getByLabel('Quê quán').fill('Hà Nam');
    await page.getByLabel('Nghề nghiệp / chức vụ').fill('Kế toán trưởng');
    await page.getByLabel('Cách xưng hô').fill('Chị Lan');
    await page.getByRole('button', { name: 'Lưu chân dung' }).click();
    await expect(toast(page, 'Đã cập nhật chân dung khách hàng')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`)); // về chi tiết khách (nơi bắt đầu)
    await expect(personaCard(page)).toContainText('Hà Nam');
    await expect(personaCard(page)).toContainText('Kế toán trưởng');
    await expect(personaCard(page)).toContainText('Chị Lan');
    const afterPersona = await completeness(page);
    expect(afterPersona).toBeGreaterThan(before);

    // Nhu cầu BĐS: ngân sách tối thiểu > tối đa -> lỗi cạnh trường, không lưu.
    await page.getByRole('button', { name: 'Sửa nhu cầu BĐS' }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}/investment$`));
    await page.getByLabel('Ngân sách tối thiểu (tỷ)').fill('5');
    await page.getByLabel('Ngân sách tối đa (tỷ)').fill('3');
    await page.getByRole('button', { name: 'Lưu nhu cầu' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Mức tối đa phải lớn hơn hoặc bằng mức tối thiểu.' })).toBeVisible();
    await expect(page.getByLabel('Ngân sách tối đa (tỷ)')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/investment$/);
    const versionMid = (await backstage.find('customers', { fullName: c.fullName }))[0].__v;

    // Sửa lại hợp lệ + thời điểm mua rồi lưu.
    await page.getByLabel('Ngân sách tối đa (tỷ)').fill('8');
    await page.getByLabel('Thời điểm dự kiến mua').fill('Quý 4/2026');
    await page.getByRole('button', { name: 'Lưu nhu cầu' }).click();
    await expect(toast(page, 'Đã cập nhật nhu cầu BĐS')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`));
    await expect(needsCard(page)).toContainText('Quý 4/2026');
    await expect(needsCard(page)).toContainText('5');
    await expect(needsCard(page)).toContainText('8');
    expect(await completeness(page)).toBeGreaterThan(afterPersona);

    // Hậu trường: chân dung mới, version tăng đúng sau mỗi lần lưu thành công (lần lỗi không tăng).
    const row = (await backstage.find('customers', { fullName: c.fullName }))[0];
    expect(row.persona.map((p: { fieldKey: string }) => p.fieldKey)).toEqual(expect.arrayContaining(['hometown', 'occupation', 'salutation', 'budget', 'expected_purchase_time']));
    expect(versionMid).toBeGreaterThan(versionBefore);
    expect(row.__v).toBeGreaterThan(versionMid);
    expect(row.personaCompleteness).toBeGreaterThan(0);
    note(testInfo, 'ĐH', `Độ đầy đủ chân dung ${before}% -> ${afterPersona}% -> ${await completeness(page)}%.`);
  });

  test('F5-01 CCCD: lưu rồi chi tiết chỉ hiện 4 số cuối, form sửa che số khi không focus', async ({ loginAs, api, backstage }) => {
    const c = await api.createCustomer({ label: 'Khách-CCCD' });
    const page = await loginAs('staff1');
    await openCustomerDetail(page, c.id, c.fullName);
    await page.getByRole('button', { name: 'Sửa chân dung khách hàng' }).click();
    const idBox = page.getByLabel(/^CCCD mới/);
    await idBox.fill('079123456789');
    await page.getByLabel('Họ và tên').focus(); // rời ô: số bị che
    await expect(idBox).toHaveAttribute('data-masked', 'true');
    await expect(idBox).not.toHaveValue('079123456789');
    await page.getByRole('button', { name: 'Lưu chân dung' }).click();
    await expect(toast(page, 'Đã cập nhật chân dung khách hàng')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`));
    await expect(infoCard(page)).toContainText('6789');
    await expect(infoCard(page)).not.toContainText('079123456789');
    await expect(page.locator('body')).not.toContainText('079123456789');
    const row = (await backstage.find('customers', { fullName: c.fullName }))[0];
    expect(row.nationalIdLast4).toBe('6789');
    expect(row.hasNationalId).toBe(true);
  });

  test('F5-01 mở thẳng URL form (không có lịch sử) rồi lưu: vẫn về chi tiết khách (màn cha)', async ({ loginAs, api }) => {
    const c = await api.createCustomer({ label: 'Khách-MởThẳng' });
    const page = await loginAs('staff1');
    await page.goto(`/crm/customers/${c.id}/persona`);
    await page.getByLabel('Quê quán').fill('Nghệ An');
    await page.getByRole('button', { name: 'Lưu chân dung' }).click();
    await expect(toast(page, 'Đã cập nhật chân dung khách hàng')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${c.id}$`));
  });

  test('F5-02 gắn, gỡ thẻ ở form chân dung và lọc khách theo thẻ ở "Bộ lọc nâng cao"', async ({ loginAs, api }, testInfo) => {
    const tag = `Thẻ${uid()}`;
    const group = uid();
    const tagged = await api.createCustomer({ label: `Khách-Thẻ-${group}` });
    const plain = await api.createCustomer({ label: `Khách-Thẻ-${group}` });
    const page = await loginAs('staff1');

    // Gắn thẻ mới (tạo nhanh) rồi lưu.
    await openCustomerDetail(page, tagged.id, tagged.fullName);
    await expect(infoCard(page)).toContainText('Chưa gắn thẻ');
    await page.getByRole('button', { name: 'Sửa chân dung khách hàng' }).click();
    await page.getByLabel('Thêm thẻ sở thích mới').fill(tag);
    await page.getByLabel('Thêm thẻ sở thích mới').press('Enter');
    await expect(page.getByRole('checkbox', { name: tag })).toBeChecked();
    await page.getByRole('button', { name: 'Lưu chân dung' }).click();
    await expect(toast(page, 'Đã cập nhật chân dung khách hàng')).toBeVisible();
    await expect(infoCard(page)).toContainText(`#${tag}`);

    // Lọc theo thẻ (Bộ lọc nâng cao).
    await page.goto('/crm/customers');
    await searchCustomers(page, group.toLowerCase());
    await expect(page.getByRole('row').filter({ hasText: group })).toHaveCount(2);
    await page.getByRole('button', { name: /Bộ lọc nâng cao/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Bộ lọc nâng cao' });
    await dialog.getByRole('group', { name: /Thẻ sở thích/ }).getByRole('button', { name: `#${tag}` }).click();
    await dialog.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.getByRole('row').filter({ hasText: tagged.fullName })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: plain.fullName })).toHaveCount(0);
    await expect(page.getByLabel(/nhóm bộ lọc đang bật/)).toBeVisible();

    // Thiết lập lại bộ lọc -> cả hai khách trở lại.
    await page.getByRole('button', { name: /Bộ lọc nâng cao/ }).click();
    await page.getByRole('dialog', { name: 'Bộ lọc nâng cao' }).getByRole('button', { name: 'Thiết lập lại' }).click();
    await page.getByRole('dialog', { name: 'Bộ lọc nâng cao' }).getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.getByRole('row').filter({ hasText: group })).toHaveCount(2);

    // Gỡ thẻ -> lưu -> biến mất.
    await openCustomerDetail(page, tagged.id, tagged.fullName);
    await page.getByRole('button', { name: 'Sửa chân dung khách hàng' }).click();
    await page.getByRole('checkbox', { name: tag }).uncheck({ force: true });
    await page.getByRole('button', { name: 'Lưu chân dung' }).click();
    await expect(toast(page, 'Đã cập nhật chân dung khách hàng')).toBeVisible();
    await expect(infoCard(page)).toContainText('Chưa gắn thẻ');
    await expect(infoCard(page)).not.toContainText(`#${tag}`);
    note(testInfo, 'TT', 'Lọc theo thẻ chỉ có trong "Bộ lọc nâng cao" (2 click + chọn thẻ + Áp dụng), không có ở thanh lọc nhanh.');
  });
});
