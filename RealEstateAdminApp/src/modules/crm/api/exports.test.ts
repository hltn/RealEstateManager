import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '@crm/lib/csv';
import { normalizePhone } from '@crm/lib/phone';
import { createTestHarness, FIXED_NOW } from '@crm/test/fixtures';
import { buildCustomerExport } from './exports';
import { buildActor } from './access';
import { selectCurrentUser } from '@crm/store/selectors';

describe('N2 xuất CSV khách chống formula injection', () => {
  it('họ tên / ghi chú bắt đầu bằng = + - @ được thêm tiền tố nháy đơn trong file xuất', () => {
    const harness = createTestHarness('admin');
    const created = harness.api.createCustomer({ fullName: '=HYPERLINK("http://evil.example","bấm")', phone: '0911000444' });
    expect(created.ok).toBe(true);
    const state = harness.getState();
    const file = buildCustomerExport(state, buildActor(selectCurrentUser(state), state.teams), { listGroup: 'ALL', limit: 100 }, FIXED_NOW);
    // File thô: ô họ tên có tiền tố nháy đơn (Excel không chạy công thức).
    expect(file.content).toContain(`"'=HYPERLINK(""http://evil.example""`);
    // Đọc lại bằng parseCsv: nguyên văn tên gốc.
    const rows = parseCsv(file.content);
    expect(rows.some((row) => row[1].startsWith('=HYPERLINK'))).toBe(true);
  });

  it('CCCD chỉ xuất dạng che, không có số đầy đủ', () => {
    const harness = createTestHarness('admin');
    const state = harness.getState();
    const file = buildCustomerExport(state, buildActor(selectCurrentUser(state), state.teams), { listGroup: 'ALL', limit: 100 }, FIXED_NOW);
    expect(file.content).not.toMatch(/\d{12}/);
  });
});

describe('TB-n1 vòng export -> import SĐT', () => {
  it.each([['+14155552671'], ['+447911123456'], ['0912 000 222'], ['+84 912 000 111']])('SĐT %s xuất ra rồi đọc lại bằng parseCsv + normalizePhone cho cùng số, ô không kích hoạt công thức', (phone) => {
    const harness = createTestHarness('admin');
    const created = harness.api.createCustomer({ fullName: 'Vòng khứ hồi', phone });
    expect(created.ok).toBe(true);
    const state = harness.getState();
    const file = buildCustomerExport(state, buildActor(selectCurrentUser(state), state.teams), { listGroup: 'ALL', limit: 100 }, FIXED_NOW);
    const raw = file.content.split('\r\n').find((line) => line.includes('Vòng khứ hồi')) ?? '';
    const phoneCell = parseCsv(raw)[0][2];
    expect(raw.split(',')[2]).not.toMatch(/^['=+\-@]/); // ô SĐT thô trong file không bắt đầu bằng ký tự công thức
    expect(normalizePhone(phoneCell)).toBe(normalizePhone(phone));
  });

  it('họ tên bắt đầu bằng = khi nhập lại được bỏ tiền tố nháy (khứ hồi nguyên vẹn)', () => {
    expect(parseCsv(toCsv([['=A1', "'bình thường", '+84']]))).toEqual([['=A1', "'bình thường", '+84']]);
  });
});
