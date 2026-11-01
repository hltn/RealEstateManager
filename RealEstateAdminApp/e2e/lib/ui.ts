/**
 * Helper UI dùng chung cho spec (chỉ selector theo vai trò/nhãn tiếng Việt, không selector theo class).
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { planTodaySlot, type VnSlot } from './api';

export const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Toast của react-hot-toast: mỗi toast là phần tử role=status; lọc theo chữ. */
export const toast = (page: Page, text: string | RegExp): Locator => page.getByRole('status').filter({ hasText: text });

/** Mở chi tiết khách bằng URL và chờ tên khách hiện (không chờ cố định). */
export async function openCustomerDetail(page: Page, customerId: string, fullName: string): Promise<void> {
  await page.goto(`/crm/customers/${customerId}`);
  await expect(page.getByRole('heading', { name: fullName }).first()).toBeVisible();
}

/** Ghi số liệu/quan sát UX vào báo cáo Playwright (annotation) để đối chiếu khi viết báo cáo phát hiện. */
export function note(info: TestInfo, type: string, description: string): void {
  info.annotations.push({ type, description });
  console.log(`[${type}] ${info.title.split(' ')[0]}: ${description}`);
}

/** Id 24 hex trong URL (customerId, projectId...) theo tên tham số query. */
export function queryParam(url: string, name: string): string | null {
  return new URL(url).searchParams.get(name);
}

/** Ô "Khách hàng" của form tạo lịch hẹn khi bị khóa (thẻ chỉ-đọc, role=group). */
export const lockedCustomerCard = (page: Page): Locator => page.getByRole('group', { name: 'Khách hàng' });

/** JPEG hợp lệ do chính trình duyệt vẽ (canvas) để không phải đưa file nhị phân vào repo; luôn < 1 MB. */
export async function makeJpeg(page: Page, seed = 0): Promise<Buffer> {
  const b64 = await page.evaluate((n) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 320, 200);
    g.addColorStop(0, `hsl(${(n * 40) % 360},70%,50%)`);
    g.addColorStop(1, '#111827');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 320, 200);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  }, seed);
  return Buffer.from(b64, 'base64');
}

/** File giả "ảnh quá lớn" (> 5 MB, chỉ để kiểm FE chặn trước khi tải lên) và "tài liệu sai loại". */
export const bigPng = (): { name: string; mimeType: string; buffer: Buffer } => ({
  name: 'anh-qua-lon.png',
  mimeType: 'image/png',
  buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(5 * 1024 * 1024 + 16)]),
});
export const pdfFile = (): { name: string; mimeType: string; buffer: Buffer } => ({
  name: 'tai-lieu.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'),
});

/** Ô tìm kiếm của danh sách khách (`/crm/customers`): gõ từ khóa và chờ phản hồi danh sách tương ứng (debounce 250 ms). */
export async function searchCustomers(page: Page, keyword: string): Promise<void> {
  const responded = page.waitForResponse((r) => r.request().method() === 'GET' && /\/crm\/customers\?/.test(r.url()) && r.url().includes('q='));
  await page.getByRole('searchbox', { name: 'Tìm kiếm' }).fill(keyword);
  await responded;
}

/** Ghi lại thân các phản hồi API CRM để đối chiếu "không rò dữ liệu" (đọc trong handler vì body bị bỏ khi điều hướng). */
export function captureCrmResponses(page: Page, pattern = /\/api\/v1\/crm\/(customers|appointments|daily-tasks)/): string[] {
  const bodies: string[] = [];
  page.on('response', async (response) => {
    if (!pattern.test(response.url())) return;
    try {
      bodies.push(await response.text());
    } catch {
      /* phản hồi bị hủy khi chuyển trang */
    }
  });
  return bodies;
}

/** Từ lúc gọi, ghi lại mọi chuỗi trong `needles` từng xuất hiện trong DOM (kể cả thoáng qua lúc đang tải). Đọc bằng `seenInDom`. */
export async function watchDomFor(page: Page, needles: string[]): Promise<void> {
  await page.addInitScript((list: string[]) => {
    const seen = new Set<string>();
    (window as unknown as { __seenNeedles: Set<string> }).__seenNeedles = seen;
    const scan = () => {
      const text = document.body?.innerText ?? '';
      for (const needle of list) if (text.includes(needle)) seen.add(needle);
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });
  }, needles);
}
export const seenInDom = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as unknown as { __seenNeedles?: Set<string> }).__seenNeedles ?? [])]);

/**
 * Mốc hẹn "HÔM NAY" (bây giờ + 5 phút, giờ VN) cho test cần thấy lịch ở Việc hôm nay / màn Lịch hẹn mặc định.
 * Gần nửa đêm (còn < 8 phút) thì chờ qua nửa đêm rồi mới trả mốc (và cộng thời gian chờ vào hạn của test), nên test không bao giờ
 * bị cắt ngang ngày. Chỗ không cần "hôm nay" hãy dùng `tomorrowSlot()` (không chờ).
 */
export async function todaySlot(info: TestInfo): Promise<VnSlot> {
  const { slot, waitMs } = planTodaySlot();
  if (waitMs > 0) {
    info.setTimeout(info.timeout + waitMs);
    note(info, 'giờ', `Còn gần nửa đêm: chờ ${Math.ceil(waitMs / 1000)} giây rồi mới dùng mốc hôm nay ${slot.date} ${slot.time}.`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return slot;
}

/** Đặt Ngày + Giờ của form tạo lịch hẹn. Ô ngày là flatpickr chưa có nhãn truy cập (U-A11Y-01) nên chọn qua placeholder "Chọn ngày" và API của flatpickr. */
export async function setSchedule(page: Page, slot: VnSlot): Promise<void> {
  const dateInput = page.getByPlaceholder('Chọn ngày');
  await dateInput.evaluate((el, date) => (el as HTMLInputElement & { _flatpickr: { setDate: (d: string, trigger: boolean) => void } })._flatpickr.setDate(date, true), slot.date);
  await expect(dateInput).toHaveValue(slot.date);
  await page.getByLabel('Giờ (giờ Việt Nam)').fill(slot.time);
}
