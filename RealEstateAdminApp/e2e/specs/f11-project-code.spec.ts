/**
 * F11 - Mã dự án tự điền theo tên khi Thêm dự án (PT-031, mã chỉ A-Z0-9), chạy trên trình duyệt thật + backend thật.
 * - F11-01: gõ từng phím "Sky Park" thì ô Mã hiện SKYPARK ngay, ô Mã vẫn sửa tay được; cả màn Dự án lẫn Cài đặt > Dự án.
 * - F11-02: gõ qua bộ gõ (IME composition, mô phỏng bằng CDP) "Căn hộ" -> CANHO.
 * - F11-03: màn hình điện thoại (bottom sheet) vẫn tự điền.
 * - F11-04: mã tự điền trùng dự án đã XOÁ MỀM (danh sách không có nhưng backend vẫn giữ mã) -> app tự thử mã kế tiếp, lưu được.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { uid } from '../lib/api';

const openAddDialog = async (page: Page) => {
  await page.goto('/crm/projects');
  await page.getByRole('button', { name: 'Thêm dự án' }).first().click();
  const name = page.getByLabel(/Tên dự án/);
  const code = page.getByLabel(/Mã dự án/);
  await expect(code).toBeVisible();
  return { name, code };
};

test('F11-01: gõ từng phím tên dự án thì mã tự điền (màn Dự án và Cài đặt), mã vẫn sửa tay được', async ({ loginAs }) => {
  const page = await loginAs('admin');
  const { name, code } = await openAddDialog(page);
  await name.pressSequentially('Sky Park', { delay: 60 });
  await expect(code).toHaveValue('SKYPARK');
  await name.fill('');
  await expect(code).toHaveValue('');
  await name.pressSequentially('Căn hộ Đảo', { delay: 60 });
  await expect(code).toHaveValue('CANHODAO');
  // Sửa tay ô Mã: gõ tiếp tên không ghi đè.
  await code.fill('');
  await code.pressSequentially('mycode9', { delay: 30 });
  await expect(code).toHaveValue('MYCODE9');
  await name.pressSequentially(' Plus', { delay: 30 });
  await expect(code).toHaveValue('MYCODE9');

  await page.goto('/crm/settings');
  await page.getByRole('tab', { name: 'Dự án' }).click();
  await page.getByRole('button', { name: 'Thêm', exact: true }).click();
  await page.getByLabel(/Tên dự án/).pressSequentially('Sky Park', { delay: 60 });
  await expect(page.getByLabel(/Mã dự án/)).toHaveValue('SKYPARK');
});

test('F11-02: gõ tên qua bộ gõ (IME composition) thì ô Mã tự điền', async ({ loginAs }) => {
  const page = await loginAs('admin');
  const { name, code } = await openAddDialog(page);
  await name.click();
  const cdp = await page.context().newCDPSession(page);
  const compose = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  const commit = (text: string) => cdp.send('Input.insertText', { text });
  for (const step of ['C', 'Ca', 'Că', 'Căn']) await compose(step);
  await commit('Căn ');
  for (const step of ['h', 'hộ']) await compose(step);
  await commit('hộ');
  await expect(name).toHaveValue('Căn hộ');
  await expect(code).toHaveValue('CANHO');
});

test('F11-03: màn hình điện thoại (bottom sheet) vẫn tự điền mã', async ({ loginAs }) => {
  const page = await loginAs('admin');
  await page.setViewportSize({ width: 390, height: 800 });
  const { name, code } = await openAddDialog(page);
  await name.pressSequentially('Sky Park', { delay: 60 });
  await expect(code).toHaveValue('SKYPARK');
});

test('F11-04: mã tự điền trùng dự án đã xoá mềm thì app tự thử mã kế tiếp và lưu được', async ({ loginAs, api }) => {
  const suffix = uid();
  const label = `Sky Park ${suffix}`;
  const firstCode = `SKYPARK${suffix}`;
  // Dự án cũ đã xoá mềm: FE không thấy trong danh sách nhưng BE vẫn giữ mã.
  const created = await api.call('admin', 'POST', '/crm/projects', { name: label, code: firstCode, status: 'SELLING', propertyTypes: ['Căn hộ'] });
  expect(created.status, JSON.stringify(created.data)).toBe(201);
  const removed = await api.call('admin', 'DELETE', `/crm/projects/${String(created.data.id ?? created.data._id)}`);
  expect(removed.status, JSON.stringify(removed.data)).toBeLessThan(300);

  const page = await loginAs('admin');
  const { name, code } = await openAddDialog(page);
  await name.pressSequentially(label, { delay: 20 });
  await expect(code).toHaveValue(firstCode);
  const dialog = page.getByRole('dialog', { name: 'Thêm dự án' });
  await dialog.getByRole('button', { name: 'Thêm dự án' }).click();
  await expect(dialog).toBeHidden();
  const list = await api.call('admin', 'GET', '/crm/projects?limit=100');
  expect(list.status).toBe(200);
  const codes = (list.data as unknown as Array<{ code: string }>).map((item) => item.code);
  expect(codes).toContain(`${firstCode}2`);
});
