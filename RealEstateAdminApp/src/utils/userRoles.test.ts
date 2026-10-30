import { describe, expect, it } from 'vitest';
import { crmRoleOf, hasAnyRole, hasCrmRole, hasTeamRole, highestRole, isCrmOnlyAccount, isSameSet, normalizeRoles, rolesOf, withRoles } from './userRoles';

describe('userRoles', () => {
  it('normalizeRoles khử trùng, sắp theo ADMIN > MANAGER > STAFF > EDITOR và bỏ giá trị lạ', () => {
    expect(normalizeRoles(['EDITOR', 'STAFF', 'STAFF', 'GUEST', 'ADMIN'])).toEqual(['ADMIN', 'STAFF', 'EDITOR']);
  });

  it('highestRole lấy role cao nhất; STAFF + EDITOR -> STAFF; rỗng -> null', () => {
    expect(highestRole(['STAFF', 'MANAGER'])).toBe('MANAGER');
    expect(highestRole(['EDITOR', 'STAFF'])).toBe('STAFF');
    expect(highestRole([])).toBeNull();
  });

  it('rolesOf ưu tiên roles[], rơi về role đơn cho bản ghi cũ', () => {
    expect(rolesOf({ role: 'MANAGER', roles: ['STAFF', 'MANAGER'] })).toEqual(['MANAGER', 'STAFF']);
    expect(rolesOf({ role: 'STAFF' })).toEqual(['STAFF']);
    expect(rolesOf({ role: 'STAFF', roles: [] })).toEqual(['STAFF']);
  });

  it('hasTeamRole: chỉ MANAGER/STAFF mới có nhóm', () => {
    expect(hasTeamRole(['ADMIN', 'EDITOR'])).toBe(false);
    expect(hasTeamRole(['ADMIN', 'STAFF'])).toBe(true);
    expect(hasTeamRole(['MANAGER'])).toBe(true);
  });

  it('hasAnyRole: chỉ cần MỘT role khớp; chưa đăng nhập -> false; bản ghi cũ chỉ có role đơn vẫn đúng', () => {
    expect(hasAnyRole({ role: 'STAFF', roles: ['STAFF', 'EDITOR'] }, ['ADMIN', 'EDITOR'])).toBe(true);
    expect(hasAnyRole({ role: 'STAFF', roles: ['STAFF'] }, ['ADMIN', 'EDITOR'])).toBe(false);
    expect(hasAnyRole({ role: 'EDITOR' }, ['EDITOR'])).toBe(true);
    expect(hasAnyRole(null, ['ADMIN'])).toBe(false);
  });

  it('isCrmOnlyAccount: STAFF/MANAGER thuần là chỉ-CRM; thêm EDITOR hoặc ADMIN thì không; EDITOR thuần không có quyền CRM', () => {
    expect(isCrmOnlyAccount({ role: 'STAFF', roles: ['STAFF'] })).toBe(true);
    expect(isCrmOnlyAccount({ role: 'STAFF', roles: ['STAFF', 'EDITOR'] })).toBe(false);
    expect(isCrmOnlyAccount({ role: 'ADMIN', roles: ['ADMIN', 'STAFF'] })).toBe(false);
    expect(hasCrmRole({ role: 'EDITOR', roles: ['EDITOR'] })).toBe(false);
    expect(hasCrmRole({ role: 'STAFF', roles: ['STAFF', 'EDITOR'] })).toBe(true);
  });

  it('crmRoleOf: role CRM cao nhất; EDITOR/không rõ coi như STAFF', () => {
    expect(crmRoleOf({ role: 'MANAGER', roles: ['STAFF', 'MANAGER'] })).toBe('MANAGER');
    expect(crmRoleOf({ role: 'EDITOR', roles: ['EDITOR'] })).toBe('STAFF');
    expect(crmRoleOf(null)).toBe('STAFF');
  });

  it('withRoles cập nhật roles đã chuẩn hóa và role = cao nhất, giữ nguyên trường khác', () => {
    expect(withRoles({ _id: 'u', role: 'ADMIN' as const, roles: ['ADMIN' as const] }, ['EDITOR', 'STAFF'])).toEqual({ _id: 'u', role: 'STAFF', roles: ['STAFF', 'EDITOR'] });
  });

  it('isSameSet bỏ qua thứ tự', () => {
    expect(isSameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isSameSet(['a'], ['a', 'b'])).toBe(false);
  });
});
