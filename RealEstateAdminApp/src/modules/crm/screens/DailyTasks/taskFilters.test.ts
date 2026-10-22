import { describe, expect, it } from 'vitest';
import type { DailyTask } from '@crm/api';
import { DEFAULT_TASK_FILTERS, getTaskDueText, groupTasks, matchesTaskFilter } from './taskFilters';

const NOW = new Date('2026-10-22T03:00:00.000Z');

const task = (overrides: Partial<DailyTask>): DailyTask => ({
  id: 't',
  kind: 'FOLLOW_UP',
  dueAt: '2026-10-22T08:30:00.000Z',
  group: 'TODAY',
  customer: { id: 'C1', fullName: 'Nguyễn Văn An', phoneMasked: '0912 345 •••', status: { id: 's', label: 'Có quan tâm', code: 'INTERESTED', listGroup: 'INTERESTED', tone: 'success' }, projects: [{ id: 'proj-1', label: "Q'Terra" }] },
  title: 'Gọi lại báo giá',
  lastCareLog: null,
  suggestion: '',
  assignee: { id: 'hanh', displayName: 'Hạnh' },
  isPrimary: true,
  ...overrides,
});

describe('taskFilters', () => {
  it('lọc cục bộ theo dự án/người/loại (từ khoá tìm do lớp dữ liệu xử lý, không lọc lại ở đây)', () => {
    expect(matchesTaskFilter(task({}), { ...DEFAULT_TASK_FILTERS, search: 'khong co' })).toBe(true);
    expect(matchesTaskFilter(task({}), { ...DEFAULT_TASK_FILTERS, projectId: 'proj-1' })).toBe(true);
    expect(matchesTaskFilter(task({}), { ...DEFAULT_TASK_FILTERS, projectId: 'proj-2' })).toBe(false);
    expect(matchesTaskFilter(task({}), { ...DEFAULT_TASK_FILTERS, assigneeId: 'thao' })).toBe(false);
    expect(matchesTaskFilter(task({}), { ...DEFAULT_TASK_FILTERS, kind: 'APPOINTMENT' })).toBe(false);
  });

  it('groupTasks chia đúng 3 nhóm', () => {
    const groups = groupTasks([task({ id: 'a', group: 'OVERDUE' }), task({ id: 'b' }), task({ id: 'c', group: 'UPCOMING' })]);
    expect([groups.OVERDUE.length, groups.TODAY.length, groups.UPCOMING.length]).toEqual([1, 1, 1]);
  });

  it('chữ thời hạn tính theo ngày thực (không nhãn cứng)', () => {
    expect(getTaskDueText(task({ group: 'OVERDUE', dueAt: '2026-10-20T02:00:00.000Z' }), NOW)).toBe('Trễ 2 ngày');
    expect(getTaskDueText(task({}), NOW)).toBe('Hôm nay 15:30');
    expect(getTaskDueText(task({ group: 'UPCOMING', dueAt: '2026-10-23T02:00:00.000Z' }), NOW)).toBe('Ngày mai 09:00');
    expect(getTaskDueText(task({ group: 'UPCOMING', kind: 'OCCASION', dueAt: '2026-10-25T01:00:00.000Z' }), NOW)).toBe('25/10/2026');
  });
});
