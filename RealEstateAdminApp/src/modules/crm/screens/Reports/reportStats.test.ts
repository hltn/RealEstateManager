import { describe, expect, it } from 'vitest';
import { createTestState } from '@crm/test/fixtures';
import { selectCurrentUser } from '@crm/store/selectors';
import { buildActor } from '@crm/api/access';
import { getDashboardBreakdown, getDashboardSummary, queryDashboardCustomers } from '@crm/api/dashboard';
import { ALL_OPTION, DEFAULT_REPORT_FILTERS, getPeriodLabel, toBreakdownRows, toDashboardQuery, toStatusSegments } from './reportStats';

const setup = () => {
  const state = createTestState('admin');
  return { state, actor: buildActor(selectCurrentUser(state), state.teams) };
};

describe('toDashboardQuery', () => {
  it('toàn thời gian: không giới hạn ngày, không lọc dự án/người', () => {
    expect(toDashboardQuery(DEFAULT_REPORT_FILTERS, '2026-10-22')).toEqual({ dateField: 'createdAt' });
  });

  it('"7 ngày qua" tính cả hôm nay', () => {
    expect(toDashboardQuery({ ...DEFAULT_REPORT_FILTERS, period: '7d' }, '2026-10-22')).toMatchObject({ from: '2026-10-16', to: '2026-10-22' });
  });

  it('kỳ "30 ngày" qua ranh giới tháng', () => {
    expect(toDashboardQuery({ ...DEFAULT_REPORT_FILTERS, period: '30d' }, '2026-03-05')).toMatchObject({ from: '2026-02-04', to: '2026-03-05' });
  });

  it('tuỳ chọn: chỉ áp đầu mút đã nhập; lọc dự án + người + trường ngày cập nhật', () => {
    const query = toDashboardQuery(
      { ...DEFAULT_REPORT_FILTERS, period: 'custom', from: '2026-10-01', to: '', dateField: 'lastUpdatedAt', projectId: 'proj-2', assigneeId: 'hanh' },
      '2026-10-22',
    );
    expect(query).toEqual({ dateField: 'lastUpdatedAt', from: '2026-10-01', projectIds: ['proj-2'], assigneeIds: ['hanh'] });
  });

  it('bỏ qua from/to khi không phải kỳ tuỳ chọn', () => {
    expect(toDashboardQuery({ ...DEFAULT_REPORT_FILTERS, from: '2026-01-01', projectId: ALL_OPTION }, '2026-10-22')).toEqual({ dateField: 'createdAt' });
  });
});

describe('định dạng số liệu', () => {
  it('nhãn kỳ', () => {
    expect(getPeriodLabel(DEFAULT_REPORT_FILTERS, {})).toBe('Toàn thời gian');
    expect(getPeriodLabel(DEFAULT_REPORT_FILTERS, { from: '2026-10-01' })).toBe('Ngày tạo khách: 2026-10-01 → ...');
  });

  it('đoạn tình trạng lấy màu theo tone; thiếu tone -> xám', () => {
    const segments = toStatusSegments([
      { key: { id: 'st-net', label: 'Khách net' }, count: 3, percent: 30, averageProgress: 80, tone: 'warning' },
      { key: { id: 'x', label: 'Khác' }, count: 1, percent: 10, averageProgress: 0 },
    ]);
    expect(segments[0]).toMatchObject({ key: 'st-net', fillClass: 'bg-warning-500' });
    expect(segments[1].fillClass).toContain('bg-gray-400');
  });

  it('các đoạn tình trạng của dữ liệu thật cộng lại đúng tổng khách và ~100%', () => {
    const { state, actor } = setup();
    const segments = toStatusSegments(getDashboardBreakdown(state, actor, 'status'));
    expect(segments.reduce((sum, segment) => sum + segment.count, 0)).toBe(getDashboardSummary(state, actor).totalCustomers);
    expect(segments.reduce((sum, segment) => sum + segment.percent, 0)).toBeGreaterThan(99);
    expect(segments.reduce((sum, segment) => sum + segment.percent, 0)).toBeLessThanOrEqual(100.2);
    expect(toBreakdownRows(getDashboardBreakdown(state, actor, 'source')).reduce((sum, row) => sum + row.count, 0)).toBe(11);
  });

  it('báo cáo 7 ngày: ranh giới múi giờ VN — 16:59:59.999Z vẫn là ngày hôm trước, 17:00:00Z là ngày kế', () => {
    const { state, actor } = setup();
    const query = toDashboardQuery({ ...DEFAULT_REPORT_FILTERS, period: '7d' }, '2026-10-22'); // 16/10 -> 22/10 (giờ VN)
    const withCreatedAt = (createdAt: string) => ({
      ...state,
      customers: state.customers.map((customer) => (customer.id === 'CUST-001' ? { ...customer, createdAt } : customer)),
    });
    const hasCust1 = (createdAt: string) => queryDashboardCustomers(withCreatedAt(createdAt), actor, query).some((customer) => customer.id === 'CUST-001');
    expect(hasCust1('2026-10-15T16:59:59.999Z')).toBe(false); // 15/10 23:59 VN: ngoài 7 ngày
    expect(hasCust1('2026-10-15T17:00:00.000Z')).toBe(true); // 16/10 00:00 VN: trong 7 ngày
  });

});
