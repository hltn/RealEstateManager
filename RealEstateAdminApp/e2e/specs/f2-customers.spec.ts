/**
 * F2 - Khách hàng (doc 08 mục 3: F2-01..05).
 *
 * Quyết định [Chưa rõ]:
 * - Tiêu đề màn danh sách thực tế là "Quản lý khách hàng" (doc ghi "Khách hàng"); nút thêm khách là "Thêm khách".
 * - Trùng SĐT khi bấm "Lưu khách hàng": CHẶN NGAY Ở GIAO DIỆN (toast "Chưa thể lưu khách hàng" + lỗi cạnh ô SĐT "Số điện thoại đã có trong hệ thống."),
 *   không đợi máy chủ; dữ liệu đã nhập còn nguyên.
 * - Tìm/lọc không ra kết quả: hiện "Không có khách hàng phù hợp" + hướng dẫn + nút "Xóa bộ lọc"; "Chưa có khách." + "Thêm khách đầu tiên"
 *   chỉ hiện khi hệ thống thật sự chưa có khách nào (không từ khoá/bộ lọc).
 * - F2-05 dùng hai trường cơ bản khác nhau (Email ở tab 1, Họ và tên ở tab 2) của màn "Chân dung khách hàng".
 */
import { test, expect } from '../fixtures';
import { formatPhone, uid, vnPhone } from '../lib/api';
import { MOBILE_VIEWPORT, note, openCustomerDetail, searchCustomers, toast } from '../lib/ui';
import type { Page } from '@playwright/test';

/** Danh sách và chi tiết che phần giữa: "0935 ••• 721". */
const maskedOf = (phone: string): string => `${phone.slice(0, 4)} ••• ${phone.slice(-3)}`;
const e164 = (phone: string): string => `+84${phone.slice(1)}`;

const phoneBox = (page: Page) => page.getByLabel('Số điện thoại');
const nameBox = (page: Page) => page.getByLabel('Họ và tên khách hàng');
const dupBanner = (page: Page) => page.getByRole('alert').filter({ hasText: 'Đã có khách hàng với số điện thoại này' });

test.describe('f2-customers', () => {
  test('F2-01 danh sách che SĐT; "Hiện số" lộ số đầy đủ và ghi log PHONE_VIEWED đúng 1 lần mỗi lần bấm', async ({ loginAs, api, backstage }) => {
    const c = await api.createCustomer({ label: 'Khách-HiệnSố' });
    const page = await loginAs('staff1');

    // Danh sách: response không chứa SĐT đầy đủ.
    const listResponse = page.waitForResponse((r) => r.request().method() === 'GET' && /\/crm\/customers\?/.test(r.url()));
    await page.goto('/crm/customers');
    expect(await (await listResponse).text()).not.toContain(c.phone.slice(1)); // 931234567 (cả dạng +84...)
    await searchCustomers(page, c.fullName);
    const row = page.getByRole('row').filter({ hasText: c.fullName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(maskedOf(c.phone));
    await expect(row).not.toContainText(formatPhone(c.phone));

    // Chi tiết: SĐT che; Hiện số -> đầy đủ; Ẩn số -> che lại.
    await row.getByRole('button', { name: c.fullName, exact: true }).click();
    await expect(page.getByRole('heading', { name: c.fullName }).first()).toBeVisible();
    const header = page.getByRole('region', { name: 'Hồ sơ khách hàng' });
    await expect(header).toContainText(maskedOf(c.phone));
    const views = async () => (await backstage.find('crm_audit_logs', { action: 'PHONE_VIEWED' })).filter((l) => String(l.customerId) === c.id).length;
    expect(await views()).toBe(0);

    await header.getByRole('button', { name: 'Hiện số' }).click();
    await expect(header).toContainText(formatPhone(c.phone));
    await expect(header.getByRole('button', { name: 'Ẩn số' })).toBeVisible();
    expect(await views()).toBe(1);

    await header.getByRole('button', { name: 'Ẩn số' }).click();
    await expect(header).toContainText(maskedOf(c.phone));
    await expect(header).not.toContainText(formatPhone(c.phone));
    expect(await views()).toBe(1); // ẩn không ghi log

    await header.getByRole('button', { name: 'Hiện số' }).click();
    await expect(header).toContainText(formatPhone(c.phone));
    await expect.poll(views).toBe(2); // mỗi lần "Hiện số" một log
  });

  test('F2-01 [+mobile] thẻ khách che SĐT, chi tiết có "Hiện số"', async ({ loginAs, api }) => {
    const c = await api.createCustomer({ label: 'Khách-DiĐộng' });
    const page = await loginAs('staff1');
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/crm/customers');
    await expect(page.getByRole('heading', { name: 'Quản lý khách hàng' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(formatPhone(c.phone));
    await openCustomerDetail(page, c.id, c.fullName);
    await expect(page.getByRole('region', { name: 'Tóm tắt hồ sơ' }).getByRole('button', { name: 'Hiện số' })).toBeVisible();
  });

  test('F2-02 thêm khách thành công: về chi tiết khách vừa tạo, người phụ trách mặc định là mình, Back không về form', async ({ loginAs, backstage, seed }, testInfo) => {
    const page = await loginAs('staff1');
    const fullName = `Khách-Thêm-${uid()}`;
    const phone = vnPhone();
    await page.goto('/crm/customers');
    await page.getByRole('button', { name: 'Thêm khách' }).click();
    await expect(page).toHaveURL(/\/crm\/customers\/new$/);
    await expect(page.getByRole('heading', { name: 'Thêm khách hàng mới' })).toBeVisible();
    // Người phụ trách chính đã là mình, khóa (không phải chọn lại).
    const primary = page.getByLabel('Người phụ trách chính');
    await expect(primary).toBeDisabled();
    await expect(primary).toHaveValue(seed.users.staff1.id);

    await nameBox(page).fill(fullName);
    await phoneBox(page).fill(phone);
    await expect(page.getByText('Chưa có, tạo được')).toBeVisible(); // kiểm trùng thời gian thực
    const source = page.getByLabel('Nguồn khách');
    await source.selectOption({ index: 1 });
    const area = page.getByLabel('Khu vực (nơi khách đang ở)');
    await area.selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Lưu khách hàng' }).click();

    await expect(toast(page, 'Thêm khách hàng thành công')).toContainText(`${fullName} đã được thêm vào hệ thống.`);
    await expect(page).toHaveURL(/\/crm\/customers\/[0-9a-f]{24}$/);
    await expect(page.getByRole('heading', { name: fullName }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Hồ sơ khách hàng' })).toContainText('Phụ trách chính: Nhân viên Một');
    // Back không quay về form đã lưu.
    await page.goBack();
    await expect(page).toHaveURL(/\/crm\/customers$/);

    // Hậu trường.
    const rows = await backstage.find('customers', { fullName });
    expect(rows).toHaveLength(1);
    expect(rows[0].__v).toBe(0);
    expect(rows[0].phone).toBe(e164(phone));
    expect(rows[0].careTeam.map((m: { userId: unknown }) => String(m.userId))).toEqual([seed.users.staff1.id]);
    expect(String(rows[0].primaryAssigneeId)).toBe(seed.users.staff1.id);
    note(testInfo, 'TT', 'Thêm khách: 1 click mở form + 2 ô nhập (tên, SĐT) + 2 chọn (nguồn, khu vực, không bắt buộc) + 1 click lưu; người phụ trách không phải chọn.');
  });

  test('F2-02 "Hủy bỏ" ở form thêm khách quay về nơi đã mở form', async ({ loginAs }) => {
    const page = await loginAs('staff1');
    await page.goto('/crm/customers');
    await page.getByRole('button', { name: 'Thêm khách' }).click();
    await nameBox(page).fill('Gõ dở');
    await page.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(page).toHaveURL(/\/crm\/customers$/);

    await page.goto('/crm/today');
    await page.getByRole('button', { name: 'Thêm khách' }).click();
    await page.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(page).toHaveURL(/\/crm\/today$/);
  });

  test('F2-03 trùng SĐT: khách trong phạm vi có "Xem hồ sơ"; khách ngoài phạm vi chỉ có đề nghị tham gia; Lưu bị chặn và giữ dữ liệu', async ({ loginAs, api, backstage }) => {
    const x = await api.createCustomer({ label: 'Khách-X' }); // đội 1, staff1 thấy
    const y = await api.createCustomer({ role: 'staff2', label: 'Khách-Y' }); // đội 2, staff1 không thấy
    const page = await loginAs('staff1');
    await page.goto('/crm/customers/new');

    // A: trong phạm vi.
    await phoneBox(page).fill(x.phone);
    await expect(dupBanner(page)).toContainText('Đã có khách hàng với số điện thoại này.'); // trong phạm vi: không cần nêu người chăm sóc
    await expect(page.getByText('Đã có trên hệ thống')).toBeVisible();
    await page.getByRole('button', { name: 'Xem hồ sơ' }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${x.id}$`));
    await expect(page.getByRole('heading', { name: x.fullName }).first()).toBeVisible();

    // B: ngoài phạm vi - không lộ tên/SĐT của khách, có lối đi tiếp.
    await page.goto('/crm/customers/new');
    await nameBox(page).fill('Tên đã nhập, phải còn nguyên');
    await phoneBox(page).fill(y.phone);
    await expect(dupBanner(page)).toContainText('Đã có khách hàng với số điện thoại này, do Nhân viên Hai chăm sóc.');
    await expect(dupBanner(page)).not.toContainText(y.fullName);
    await expect(page.locator('body')).not.toContainText(y.fullName);
    await expect(page.getByRole('button', { name: 'Xem hồ sơ' })).toHaveCount(0);

    // Cố bấm Lưu khi trùng: chặn, báo tiếng Việt, giữ dữ liệu, không tạo khách.
    await page.getByRole('button', { name: 'Lưu khách hàng' }).click();
    await expect(toast(page, 'Chưa thể lưu khách hàng')).toContainText('Số điện thoại đã có trong hệ thống.');
    await expect(page.locator('#cc-desktop-phone-error')).toHaveText('Số điện thoại đã có trong hệ thống.');
    await expect(nameBox(page)).toHaveValue('Tên đã nhập, phải còn nguyên');
    await expect(phoneBox(page)).toHaveValue(y.phone);
    expect(await backstage.count('customers', { phone: e164(y.phone) })).toBe(1);

    // Đề nghị tham gia nhóm: gửi được, trạng thái "đang chờ duyệt" giữ sau khi tải lại.
    await page.getByRole('button', { name: 'Đề nghị tham gia nhóm chăm sóc' }).click();
    await expect(toast(page, 'Đã gửi đề nghị tham gia nhóm chăm sóc')).toBeVisible();
    await expect(dupBanner(page)).toContainText('Đã gửi đề nghị, đang chờ duyệt');
    await page.reload();
    await phoneBox(page).fill(y.phone);
    await expect(dupBanner(page)).toContainText('Đã gửi đề nghị, đang chờ duyệt');
    const requests = (await backstage.find('care_team_requests')).filter((r) => String(r.customerId) === y.id);
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe('PENDING');
    expect(await backstage.count('customers', { fullName: 'Tên đã nhập, phải còn nguyên' })).toBe(0);
  });

  test('F2-04 tìm không dấu có debounce, lọc theo dự án, tab rỗng có hướng dẫn', async ({ loginAs, api }, testInfo) => {
    const tag = uid();
    const project = await api.createProject('Dự án Lọc');
    const inProject = await api.createCustomer({ label: `Trần Văn Ánh ${tag}`, projectIds: [project.id] });
    const other = await api.createCustomer({ label: `Trần Văn Ánh ${tag}`, projectIds: [] });
    const page = await loginAs('staff1');
    await page.goto('/crm/customers');
    await expect(page.getByRole('heading', { name: 'Quản lý khách hàng' })).toBeVisible();

    // Gõ không dấu từng phím (cách nhau 40 ms, ngắn hơn debounce 250 ms): số lần gọi API tìm kiếm phải ít hơn nhiều so với số phím.
    // Đếm đúng request `GET /crm/customers?q=...` (không tính `/list-counts`), ghi lại từ khóa `q` của từng lần gọi.
    const query = `tran van anh ${tag.toLowerCase()}`;
    const searchTerms: string[] = [];
    /** `q` của request `GET /crm/customers?q=...` (null nếu không phải request tìm kiếm danh sách). */
    const searchTermOf = (method: string, rawUrl: string): string | null => {
      const url = new URL(rawUrl);
      return method === 'GET' && /\/crm\/customers$/.test(url.pathname) ? url.searchParams.get('q') : null;
    };
    page.on('request', (r) => {
      const term = searchTermOf(r.method(), r.url());
      if (term !== null) searchTerms.push(term);
    });
    // Chờ ĐÚNG phản hồi của lần gọi mang đủ từ khóa (khách mới tạo đã nằm sẵn ở trang đầu nên chờ hàng trong bảng là chưa chứng minh gì).
    const finalSearch = page.waitForResponse((r) => searchTermOf(r.request().method(), r.url()) === query);
    await page.getByRole('searchbox', { name: 'Tìm kiếm' }).pressSequentially(query, { delay: 40 });
    const found = (await (await finalSearch).json()) as { data: Array<{ fullName: string }> };
    // Tìm không dấu ra đúng hai khách trùng tên gốc, khác hậu tố; bảng hiện đúng hai khách đó.
    expect(found.data.map((c) => c.fullName).sort()).toEqual([inProject.fullName, other.fullName].sort());
    await expect(page.getByRole('row').filter({ hasText: inProject.fullName })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: tag })).toHaveCount(2);
    // Debounce: các phím cách nhau 40 ms (< 250 ms) chỉ được gọi API tìm kiếm rất ít lần, lần cuối mang đủ từ khóa.
    expect(searchTerms.length, 'bộ đếm phải thấy ít nhất một lần gọi API tìm kiếm').toBeGreaterThan(0);
    expect(searchTerms.at(-1), 'lần gọi cuối phải mang đủ từ khóa đã gõ').toBe(query);
    expect(searchTerms.length, `debounce: ${query.length} phím nhưng ${searchTerms.length} lần gọi (${searchTerms.join(' | ')})`).toBeLessThanOrEqual(Math.floor(query.length / 4));
    note(testInfo, 'TT', `Gõ ${query.length} phím, ${searchTerms.length} lần gọi API tìm kiếm (debounce).`);

    // Lọc theo dự án: chỉ còn khách quan tâm dự án.
    await page.getByLabel('Dự án', { exact: true }).selectOption({ label: project.name });
    await expect(page.getByRole('row').filter({ hasText: inProject.fullName })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: other.fullName })).toHaveCount(0);
    const badge = await page.getByLabel(/nhóm bộ lọc đang bật/).count();
    note(testInfo, 'PH', `Huy hiệu "N nhóm bộ lọc đang bật" sau khi lọc nhanh theo dự án: ${badge === 0 ? 'KHÔNG hiện (chỉ tính bộ lọc nâng cao)' : 'hiện'}.`);
    const clearButtons = await page.getByRole('button', { name: /Xóa bộ lọc|Xoá bộ lọc|Đặt lại/ }).count();
    note(testInfo, 'TT', `Nút xóa nhanh bộ lọc: ${clearButtons === 0 ? 'KHÔNG có (phải chọn "Tất cả" từng ô)' : 'có'}.`);
    await page.getByLabel('Dự án', { exact: true }).selectOption('all');
    await expect(page.getByRole('row').filter({ hasText: tag })).toHaveCount(2);

    // Tab rỗng trong khi tổng khách > 0: có hướng dẫn thay vì bảng trắng.
    await page.getByRole('searchbox', { name: 'Tìm kiếm' }).fill('');
    await page.getByRole('button', { name: /^Bỏ/ }).click();
    await expect(page.getByText('Không có khách hàng phù hợp')).toBeVisible();
    await expect(page.getByText('Thử đổi tab danh sách, từ khoá hoặc bộ lọc nâng cao.')).toBeVisible();
  });

  test('F2-04 tìm không khớp báo "Không có khách hàng phù hợp" kèm nút xóa bộ lọc, không phải "Chưa có khách"', async ({ loginAs }) => {
    const page = await loginAs('staff1');
    await page.goto('/crm/customers');
    await searchCustomers(page, 'zzzkhongkhopbaogio');
    await expect(page.getByText('Không có khách hàng phù hợp')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm khách đầu tiên' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await expect(page.getByText('Không có khách hàng phù hợp')).toHaveCount(0);
  });

  test('F2-05 sửa đồng thời hai tab: tab lưu sau nhận hướng dẫn 409, giữ nguyên dữ liệu đang gõ, lưu lại được mà không ghi đè tab trước', async ({ loginAs, api, backstage }) => {
    const c = await api.createCustomer({ label: 'Khách-XungĐột' });
    const tab1 = await loginAs('staff1');
    const tab2 = await tab1.context().newPage();
    for (const tab of [tab1, tab2]) {
      await tab.goto(`/crm/customers/${c.id}/persona`);
      await expect(tab.getByRole('button', { name: 'Lưu chân dung' })).toBeVisible();
      await expect(tab.getByLabel('Họ và tên')).toHaveValue(c.fullName);
    }
    const before = (await backstage.find('customers', { fullName: c.fullName }))[0].__v;

    // Tab 1 đổi Email rồi lưu.
    await tab1.getByLabel('Email', { exact: true }).fill('tab1@example.test');
    await tab1.getByRole('button', { name: 'Lưu chân dung' }).click();
    await expect(toast(tab1, 'Đã cập nhật chân dung khách hàng')).toBeVisible();

    // Tab 2 đổi Họ và tên rồi lưu: xung đột 409.
    const newName = `${c.fullName}-Sửa`;
    await tab2.getByLabel('Họ và tên').fill(newName);
    await tab2.getByRole('button', { name: 'Lưu chân dung' }).click();
    await expect(toast(tab2, 'Hồ sơ vừa được người khác cập nhật. Dữ liệu mới nhất đã được tải lại, vui lòng kiểm tra rồi thực hiện lại.')).toBeVisible();
    await expect(tab2).toHaveURL(new RegExp(`/crm/customers/${c.id}/persona$`)); // ở lại form
    await expect(tab2.getByLabel('Họ và tên')).toHaveValue(newName); // không mất dữ liệu đang gõ

    // Lưu lần nữa: thành công với version mới, thay đổi của tab 1 còn nguyên.
    await tab2.getByRole('button', { name: 'Lưu chân dung' }).click();
    await expect(toast(tab2, 'Đã cập nhật chân dung khách hàng')).toBeVisible();
    const after = (await backstage.find('customers', { fullName: newName }))[0];
    expect(after.email).toBe('tab1@example.test');
    expect(after.__v).toBe(before + 2);
  });
});
