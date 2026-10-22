import { describe, expect, it } from 'vitest';
import { createTestState, FIXED_NOW } from '@crm/test/fixtures';
import { selectCurrentUser } from '@crm/store/selectors';
import { buildActor } from './access';
import { buildDashboardReportRows, getAssigneeStats, getDashboardBreakdown, getDashboardReport, getDashboardSummary } from './dashboard';

const setup = (userId = 'admin') => {
  const state = createTestState(userId);
  return { state, actor: buildActor(selectCurrentUser(state), state.teams) };
};

describe('dashboard (X6)', () => {
  it('tổng theo nhóm danh sách khớp tổng khách; tiến độ trung bình tính từ tiêu chí', () => {
    const { state, actor } = setup();
    const summary = getDashboardSummary(state, actor, {}, 14, FIXED_NOW);
    expect(summary.totalCustomers).toBe(11);
    expect(summary.byListGroup).toEqual({ NOT_CONTACTED: 1, INTERESTED: 6, NET: 3, DROPPED: 1 });
    expect(Object.values(summary.byListGroup).reduce((sum, count) => sum + count, 0)).toBe(summary.totalCustomers);
    // Tiến độ các khách: 50,75,75,100,75,50,75,25,75,25,0 -> 625/11 = 56.8
    expect(summary.averageProgress).toBe(56.8);
    expect(summary.appointmentsDone).toBe(1);
  });

  it('phân bổ theo tình trạng giữ thứ tự danh mục; theo dự án đếm 1 khách nhiều dự án', () => {
    const { state, actor } = setup();
    expect(getDashboardBreakdown(state, actor, 'status').map((item) => [item.key.label, item.count])).toEqual([
      ['Chưa tiếp cận', 1],
      ['Có quan tâm', 6],
      ['Khách net', 3],
      ['Bỏ', 1],
    ]);
    const projects = getDashboardBreakdown(state, actor, 'project');
    expect(projects.reduce((sum, item) => sum + item.count, 0)).toBeGreaterThan(11);
    expect(projects[0].key.label).toBe("Q'Terra");
  });

  it('lọc thời gian theo ngày tạo (giờ VN)', () => {
    const { state, actor } = setup();
    // Khách tạo trong 10 ngày gần nhất: CUST-010 (9 ngày), CUST-011 (2 ngày).
    expect(getDashboardSummary(state, actor, { from: '2026-10-12', to: '2026-10-22' }).totalCustomers).toBe(2);
  });

  it('số khách theo người: tách phụ trách chính / cùng chăm sóc; theo phạm vi quyền', () => {
    const { state, actor } = setup();
    const hanh = getAssigneeStats(state, actor).find((row) => row.user.id === 'hanh');
    expect(hanh).toMatchObject({ primaryCount: 5, memberCount: 0 });
    const minh = getAssigneeStats(state, actor).find((row) => row.user.id === 'minh');
    expect(minh).toMatchObject({ primaryCount: 1, memberCount: 1 });
    const staff = setup('thao');
    expect(getDashboardSummary(staff.state, staff.actor).totalCustomers).toBe(1);
  });
});

describe('buildDashboardReportRows', () => {
  it('xuất đủ các khối, không chứa số điện thoại/CCCD', () => {
    const { state, actor } = setup();
    const rows = buildDashboardReportRows(getDashboardReport(state, actor, {}, FIXED_NOW), 'Tất cả thời gian');
    const flat = rows.map((row) => row.join('|')).join('\n');
    expect(rows[2]).toEqual(['Tổng khách', '11']);
    expect(flat).toContain('Theo nguồn khách|Số khách');
    expect(flat).toContain('Theo người chăm sóc|Phụ trách chính');
    expect(flat).not.toMatch(/\+84|\d{12}/);
  });
});

describe('báo cáo theo tình trạng khi có tình trạng đã ẩn', () => {
  it('khách gắn tình trạng đã ẩn gộp vào nhóm "Tình trạng đã ẩn" -> tổng các đoạn luôn bằng tổng khách', () => {
    const { state, actor } = setup();
    const hiddenState = {
      ...state,
      catalogs: { ...state.catalogs, statuses: state.catalogs.statuses.map((status) => (status.id === 'st-interested' ? { ...status, isActive: false } : status)) },
    };
    const segments = getDashboardBreakdown(hiddenState, actor, 'status');
    expect(segments.reduce((sum, item) => sum + item.count, 0)).toBe(getDashboardSummary(hiddenState, actor).totalCustomers);
    expect(segments.find((item) => item.key.id === 'hidden-statuses')?.count).toBe(6);
    expect(segments.find((item) => item.key.id === 'st-interested')).toBeUndefined();
  });
});
