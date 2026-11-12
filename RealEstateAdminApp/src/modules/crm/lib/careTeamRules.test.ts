import { describe, expect, it } from 'vitest';
import { countCareTeamMembers, describeBulkAssignError, describeCareTeamError, getRemainingMemberSlots, MAX_CARE_TEAM_MEMBERS } from './careTeamRules';

const team = (memberCount: number, hasPrimary = true) => [...(hasPrimary ? [{ role: 'PRIMARY' as const }] : []), ...Array.from({ length: memberCount }, () => ({ role: 'MEMBER' as const }))];

describe('careTeamRules', () => {
  it('giới hạn là 10 thành viên phụ', () => {
    expect(MAX_CARE_TEAM_MEMBERS).toBe(10);
  });

  it('chỉ đếm MEMBER, không đếm PRIMARY', () => {
    expect(countCareTeamMembers(team(0))).toBe(0);
    expect(countCareTeamMembers(team(3))).toBe(3);
    expect(countCareTeamMembers([])).toBe(0);
  });

  it.each([
    [0, 10],
    [9, 1],
    [10, 0],
    [12, 0],
  ])('%i thành viên phụ -> còn %i chỗ (không âm)', (count, remaining) => {
    expect(getRemainingMemberSlots(team(count))).toBe(remaining);
  });

  it('describeCareTeamError: mã đã biết -> tiếng Việt theo mã; mã lạ/không mã -> message gốc', () => {
    expect(describeCareTeamError({ errorCode: 'CARE_TEAM_LIMIT_EXCEEDED', message: 'raw' })).toContain('10 thành viên phụ');
    expect(describeCareTeamError({ errorCode: 'PRIMARY_LOCKED', message: 'raw' })).toContain('cố định');
    expect(describeCareTeamError({ errorCode: 'PRIMARY_REQUIRED', message: 'raw' })).toContain('người chăm sóc chính');
    expect(describeCareTeamError({ errorCode: 'WHATEVER', message: 'thông báo gốc' })).toBe('thông báo gốc');
    expect(describeCareTeamError({ message: 'không mã' })).toBe('không mã');
  });

  it('describeBulkAssignError: lý do theo mã, mã lạ có lời mặc định', () => {
    expect(describeBulkAssignError('CARE_TEAM_LIMIT_EXCEEDED')).toContain('10 thành viên phụ');
    expect(describeBulkAssignError('PRIMARY_REQUIRED')).toContain('chưa có người chăm sóc chính');
    expect(describeBulkAssignError('???')).toBe('không áp dụng được');
  });
});
