import { describe, expect, it } from 'vitest';
import type { CrmUser } from '@crm/types/crm';
import { buildAssigneeFilterOptions, LOCKED_ASSIGNEE_SUFFIX } from './assigneeFilter';

const user = (id: string, patch: Partial<CrmUser> = {}): CrmUser => ({ id, fullName: `Tên ${id}`, displayName: id, role: 'STAFF', jobTitle: '', teamId: null, isActive: true, ...patch });

describe('buildAssigneeFilterOptions', () => {
  it('giữ cả ADMIN trong danh sách máy chủ trả cho bộ lọc (người trong careTeam), bỏ người đã khóa và khử trùng', () => {
    const options = buildAssigneeFilterOptions([user('a'), user('boss', { role: 'ADMIN' }), user('off', { isActive: false }), user('a')], null);
    expect(options).toEqual([
      { value: 'a', label: 'Tên a' },
      { value: 'boss', label: 'Tên boss' },
    ]);
  });

  it('gắn thêm chính người đăng nhập nếu thiếu, trừ Quản trị; đã có thì không nhân đôi', () => {
    expect(buildAssigneeFilterOptions([user('a')], user('me', { role: 'MANAGER' })).map((option) => option.value)).toEqual(['a', 'me']);
    expect(buildAssigneeFilterOptions([user('me')], user('me')).map((option) => option.value)).toEqual(['me']);
    expect(buildAssigneeFilterOptions([user('a')], user('root', { role: 'ADMIN' })).map((option) => option.value)).toEqual(['a']);
  });

  it('người bị khóa (isLocked) vẫn có trong danh sách, nhãn kèm "(đã khóa)", value giữ nguyên id để chọn lọc; người không khóa nhãn trơn', () => {
    const options = buildAssigneeFilterOptions([user('a'), user('b', { isLocked: true }), user('c', { isLocked: false })], null);
    expect(options).toEqual([
      { value: 'a', label: 'Tên a' },
      { value: 'b', label: 'Tên b (đã khóa)' },
      { value: 'c', label: 'Tên c' },
    ]);
    expect(LOCKED_ASSIGNEE_SUFFIX).toBe(' (đã khóa)');
  });

  it('chính người đăng nhập đã có trong danh sách máy chủ với cờ khóa thì giữ nhãn khóa, không nhân đôi', () => {
    expect(buildAssigneeFilterOptions([user('me', { isLocked: true })], user('me'))).toEqual([{ value: 'me', label: 'Tên me (đã khóa)' }]);
  });
});
