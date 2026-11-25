import { describe, expect, it } from 'vitest';
import { CREATOR_LOCKED_MESSAGE, countCareTeamMembers, describeBulkAssignError, describeCareTeamError, getRemainingMemberSlots, MAX_CARE_TEAM_MEMBERS } from './careTeamRules';

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

  it('FR-33: USER_NOT_ASSIGNABLE hiện NGUYÊN VĂN thông báo backend, không còn câu chung của FE', () => {
    const message = 'Có người được phân không hợp lệ (không tồn tại, không hoạt động hoặc không phải Quản lý/Nhân viên)';
    expect(describeCareTeamError({ errorCode: 'USER_NOT_ASSIGNABLE', message, details: { userIds: ['u1'] } })).toBe(message);
  });

  it('FR-31: PRIMARY_LOCKED kèm reason CREATOR_LOCKED báo riêng cho người tạo; không reason thì vẫn câu "cố định" của phụ trách chính', () => {
    expect(describeCareTeamError({ errorCode: 'PRIMARY_LOCKED', message: 'raw', details: { reason: 'CREATOR_LOCKED' } })).toBe(CREATOR_LOCKED_MESSAGE);
    expect(describeCareTeamError({ errorCode: 'PRIMARY_LOCKED', message: 'raw' })).toContain('cố định');
    expect(describeCareTeamError({ errorCode: 'PRIMARY_LOCKED', message: 'raw', details: { reason: 'KHAC' } })).toContain('cố định');
  });

  it('describeBulkAssignError: lý do theo mã, mã lạ có lời mặc định', () => {
    expect(describeBulkAssignError('CARE_TEAM_LIMIT_EXCEEDED')).toContain('10 thành viên phụ');
    expect(describeBulkAssignError('PRIMARY_REQUIRED')).toContain('chưa có người chăm sóc chính');
    expect(describeBulkAssignError('???')).toBe('không áp dụng được');
  });

  it('describeBulkAssignError: INSUFFICIENT_ROLE (FR-31) nêu rõ ai mới mời được, không rơi vào câu mặc định', () => {
    const note = describeBulkAssignError('INSUFFICIENT_ROLE');
    expect(note).toContain('Quản trị, người tạo khách hoặc Quản lý nhóm chủ');
    expect(note).not.toBe('không áp dụng được');
  });
});
