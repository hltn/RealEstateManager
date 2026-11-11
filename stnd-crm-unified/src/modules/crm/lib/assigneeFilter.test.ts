import { describe, expect, it } from 'vitest';
import type { CrmUser } from '@crm/types/crm';
import { buildAssigneeFilterOptions, LOCKED_ASSIGNEE_SUFFIX } from './assigneeFilter';

const user = (id: string, role: CrmUser['role'] = 'STAFF'): CrmUser => ({ id, displayName: id.toUpperCase(), role }) as CrmUser;

describe('buildAssigneeFilterOptions (nguồn customer-assignees)', () => {
  it('nhãn là displayName, tài khoản khóa có hậu tố', () => {
    const options = buildAssigneeFilterOptions(
      [
        { id: 'a', displayName: 'An', isLocked: false },
        { id: 'b', displayName: 'Bình', isLocked: true },
      ],
      null,
    );
    expect(options).toEqual([
      { value: 'a', label: 'An' },
      { value: 'b', label: `Bình${LOCKED_ASSIGNEE_SUFFIX}` },
    ]);
  });

  it('bỏ trùng id', () => {
    const options = buildAssigneeFilterOptions(
      [
        { id: 'a', displayName: 'An', isLocked: false },
        { id: 'a', displayName: 'An', isLocked: false },
      ],
      null,
    );
    expect(options).toHaveLength(1);
  });

  it('gắn thêm chính người đăng nhập nếu thiếu, trừ Quản trị', () => {
    expect(buildAssigneeFilterOptions([], user('me'))).toEqual([{ value: 'me', label: 'ME' }]);
    expect(buildAssigneeFilterOptions([], user('root', 'ADMIN'))).toEqual([]);
    expect(buildAssigneeFilterOptions([{ id: 'me', displayName: 'Me', isLocked: false }], user('me'))).toHaveLength(1);
  });
});
