/**
 * F7 - Màn còn dữ liệu mẫu và đổi tình trạng khách (doc 08 mục 6: F7-01, F7-02).
 * Các khuyết tật UX đã biết KHÔNG nằm ở đây trừ T-G4 (SĐT ở lịch hẹn/việc hôm nay); mỗi khuyết tật có test "ghi nhận" riêng ở spec của luồng đó
 * (F3-04b gỡ ảnh, F4-09 đổi giờ/hủy lịch, F4-02 lịch hẹn ở chi tiết khách, U-A11Y-01 nhãn ô ngày).
 *
 * Quyết định: ca đối chứng "cờ mẫu bật" không đổi được biến Vite lúc chạy, nên test chặn module `featureFlags.ts` của Vite trong trình duyệt
 * của chính test (không ghi vào mã nguồn sản phẩm) và đổi giá trị biến môi trường `VITE_CRM_MOCK_*` mà Vite nhúng vào module,
 * rồi kiểm biểu ngữ cảnh báo dữ liệu mẫu. Nếu không tìm thấy biến để đổi thì test ĐỎ ngay (không lặng lẽ kiểm sai môi trường).
 */
import { test, expect, knownBug } from '../fixtures';
import { openCustomerDetail, todaySlot, toast } from '../lib/ui';
import type { Page } from '@playwright/test';

const MOCK_FLAG_ENV_NAMES = ['VITE_CRM_MOCK_REPORTS', 'VITE_CRM_MOCK_IMPORT_EXPORT'] as const;

/** Bật hai cờ dữ liệu mẫu CHỈ trong trình duyệt của test; trả về số biến đã đổi được (kỳ vọng = 2). */
async function forceMockFlags(page: Page): Promise<{ patched: () => number }> {
  let patchedCount = 0;
  await page.route(/featureFlags\.ts/, async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    for (const name of MOCK_FLAG_ENV_NAMES) {
      const next = body.replace(new RegExp(`("${name}"\\s*:\\s*)"[^"]*"`), '$1"true"');
      if (next !== body) patchedCount += 1;
      body = next;
    }
    await route.fulfill({ response, body });
  });
  return { patched: () => patchedCount };
}

test.describe('f7-gaps', () => {
  test('F7-01 cờ mẫu tắt: Báo cáo hiện "sắp ra mắt" (không số liệu giả), nút nhập/xuất dữ liệu mẫu bị ẩn', async ({ loginAs }) => {
    const admin = await loginAs('admin');
    await admin.goto('/crm/reports');
    await expect(admin.getByText('Báo cáo & Thống kê sắp ra mắt')).toBeVisible();
    await expect(admin.getByText('Tính năng đang được hoàn thiện ở giai đoạn tiếp theo.')).toBeVisible();
    await expect(admin.getByRole('note')).toHaveCount(0);
    await expect(admin.getByRole('button', { name: /Xuất Excel/ })).toHaveCount(0);
    await expect(admin.getByRole('region', { name: 'Bộ lọc báo cáo' })).toHaveCount(0);

    for (const role of ['mgr1', 'admin'] as const) {
      const page = await loginAs(role);
      await page.goto('/crm/customers');
      await expect(page.getByRole('button', { name: 'Thêm khách' })).toBeVisible(); // trang đã tải
      await expect(page.getByRole('button', { name: /Xuất Excel/ })).toHaveCount(0);
      await expect(page.getByText(/Nhập .*(CSV|file)|Nhập khách/i)).toHaveCount(0);
    }
  });

  test('F7-01 đối chứng: khi cờ mẫu bật, Báo cáo có biểu ngữ cảnh báo "Dữ liệu mẫu" và nút xuất hiện', async ({ loginAs }) => {
    const admin = await loginAs('admin');
    const flags = await forceMockFlags(admin);
    await admin.goto('/crm/reports');
    expect(flags.patched(), 'không đổi được biến VITE_CRM_MOCK_* trong module featureFlags của Vite').toBe(MOCK_FLAG_ENV_NAMES.length);
    await expect(admin.getByRole('note')).toContainText('Dữ liệu mẫu (chưa nối API Báo cáo)');
    await expect(admin.getByRole('button', { name: /Xuất Excel/ })).toBeVisible();
  });

  test('F7-02 đổi tình trạng khách (StatusDropdown): lưu thật và ghi lịch sử', async ({ loginAs, api, backstage }) => {
    const c = await api.createCustomer({ label: 'Khách-ĐổiTìnhTrạng' });
    const page = await loginAs('staff1');
    await openCustomerDetail(page, c.id, c.fullName);

    const before = (await backstage.find('customers', { fullName: c.fullName }))[0];
    const statusButton = page.getByRole('button', { name: /^Tình trạng: .*Bấm để đổi$/ }).first();
    const currentLabel = /Tình trạng: (.*)\. Bấm/.exec((await statusButton.getAttribute('aria-label')) ?? '')?.[1] ?? '';
    await statusButton.click();
    const options = page.getByRole('list', { name: 'Chọn tình trạng khách hàng' }).getByRole('button');
    const names = await options.allInnerTexts();
    const target = names.find((n) => !n.includes(currentLabel) && !/bỏ/i.test(n));
    expect(target, 'cần một tình trạng khác để đổi').toBeTruthy();
    await options.filter({ hasText: target! }).first().click();
    await expect(toast(page, /Đã chuyển/)).toBeVisible();

    // Hậu trường: tình trạng đổi thật, có đúng một dòng lịch sử loại STATUS cho khách này.
    await expect.poll(async () => String((await backstage.find('customers', { fullName: c.fullName }))[0].statusId)).not.toBe(String(before.statusId));
    const audits = (await backstage.find('crm_audit_logs')).filter((l) => String(l.customerId) === c.id && /STATUS/i.test(String(l.action)));
    expect(audits).toHaveLength(1);
  });

  test('F7-02 ghi nhận: lịch hẹn và việc hôm nay phải hiện SĐT đã che của khách (G4)', async ({ loginAs, api }, testInfo) => {
    knownBug(testInfo, 'Thiếu chức năng', 'T-G4: API lịch hẹn và việc hôm nay không trả `phoneMasked` (backend appointment.mapper/daily-tasks.service), nên thẻ lịch hẹn và thẻ việc không có dòng SĐT để gọi/nhắn nhanh; bảng danh sách việc còn ô SĐT trống.');
    const c = await api.createCustomer({ label: 'Khách-SĐTLịch' });
    await api.createAppointment({ customerId: c.id, slot: await todaySlot(testInfo) });
    const page = await loginAs('staff1');
    const maskedPhone = /\d{4} ••• \d{3}/;

    await page.goto('/crm/appointments');
    const appointmentCard = page.getByTestId('appointment-card').filter({ hasText: c.fullName });
    await expect(appointmentCard).toHaveCount(1); // thẻ có hiện: đỏ ở dưới là do thiếu SĐT
    await expect.soft(appointmentCard, 'thẻ lịch hẹn phải có dòng SĐT đã che').toContainText(maskedPhone);

    await page.goto('/crm/today');
    const taskCard = page.getByTestId('daily-task-card').filter({ hasText: c.fullName });
    await expect(taskCard).toHaveCount(1);
    await expect.soft(taskCard, 'thẻ Việc hôm nay phải có SĐT đã che').toContainText(maskedPhone);
  });
});
