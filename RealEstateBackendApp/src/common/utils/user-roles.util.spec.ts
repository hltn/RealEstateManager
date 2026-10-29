import { UserRole } from '../enums/user-role.enum';
import {
  hasAnyRole,
  hasCrmTeamRole,
  highestRole,
  normalizeRoles,
  rolesOf,
} from './user-roles.util';

describe('user-roles.util', () => {
  describe('highestRole', () => {
    it.each([
      [[UserRole.STAFF, UserRole.MANAGER], UserRole.MANAGER],
      [[UserRole.STAFF, UserRole.ADMIN, UserRole.EDITOR], UserRole.ADMIN],
      [[UserRole.EDITOR, UserRole.STAFF], UserRole.STAFF],
      [[UserRole.EDITOR], UserRole.EDITOR],
    ])('%j → %s (không phụ thuộc thứ tự đầu vào)', (roles, expected) => {
      expect(highestRole(roles)).toBe(expected);
      expect(highestRole([...roles].reverse())).toBe(expected);
    });

    it('rỗng hoặc chỉ có giá trị lạ → null', () => {
      expect(highestRole([])).toBeNull();
      expect(highestRole(['SUPERUSER'])).toBeNull();
    });
  });

  describe('normalizeRoles', () => {
    it('khử trùng, bỏ giá trị lạ, sắp theo độ ưu tiên', () => {
      expect(
        normalizeRoles(['STAFF', 'EDITOR', 'STAFF', 'HACKER', 'MANAGER']),
      ).toEqual([UserRole.MANAGER, UserRole.STAFF, UserRole.EDITOR]);
    });
  });

  describe('rolesOf', () => {
    it('ưu tiên roles[] khi có', () => {
      expect(rolesOf({ role: 'MANAGER', roles: ['MANAGER', 'STAFF'] })).toEqual(
        ['MANAGER', 'STAFF'],
      );
    });

    it('bản ghi/token cũ chỉ có role đơn → [role]', () => {
      expect(rolesOf({ role: 'STAFF' })).toEqual(['STAFF']);
      expect(rolesOf({ role: 'STAFF', roles: [] })).toEqual(['STAFF']);
    });

    it('không có gì → rỗng (không ném lỗi)', () => {
      expect(rolesOf({})).toEqual([]);
      expect(rolesOf({ role: null, roles: null })).toEqual([]);
    });
  });

  describe('hasAnyRole / hasCrmTeamRole', () => {
    it('hasAnyRole: khớp bất kỳ role nào (STAFF+EDITOR vào được cả route CRM lẫn route EDITOR)', () => {
      const roles = [UserRole.STAFF, UserRole.EDITOR];
      expect(hasAnyRole(roles, [UserRole.ADMIN, UserRole.STAFF])).toBe(true);
      expect(hasAnyRole(roles, [UserRole.EDITOR])).toBe(true);
      expect(hasAnyRole(roles, [UserRole.ADMIN, UserRole.MANAGER])).toBe(false);
    });

    it('hasCrmTeamRole: ADMIN/EDITOR đơn thuần không được thuộc nhóm; chỉ cần 1 role MANAGER/STAFF là đủ', () => {
      expect(hasCrmTeamRole([UserRole.ADMIN])).toBe(false);
      expect(hasCrmTeamRole([UserRole.ADMIN, UserRole.EDITOR])).toBe(false);
      expect(hasCrmTeamRole([UserRole.EDITOR, UserRole.STAFF])).toBe(true);
      expect(hasCrmTeamRole([])).toBe(false);
    });
  });
});
