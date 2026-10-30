import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../../common/exceptions/error-codes';
import { CrmActor } from '../../common/access/crm-actor';
import { CareRole } from '../customer.constants';
import {
  assertCanDeleteCustomer,
  DeletableCustomer,
  getDeleteDenial,
} from './customer-delete-policy';

const id = () => new Types.ObjectId();

const actor = (
  role: UserRole,
  overrides: Partial<CrmActor> = {},
): CrmActor => ({
  userId: id(),
  role,
  roles: [role],
  displayName: 'x',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
  ...overrides,
});

const careTeam = (primary: Types.ObjectId, ...members: Types.ObjectId[]) => [
  { userId: primary, role: CareRole.PRIMARY },
  ...members.map((userId) => ({ userId, role: CareRole.MEMBER })),
];

const DROPPED = { isDropped: true, requireDropped: false };
const NOT_DROPPED = { isDropped: false, requireDropped: false };

describe('getDeleteDenial (quyền xóa khách, tài liệu 09 mục 7.2)', () => {
  describe('ADMIN', () => {
    it('xóa được mọi khách, kể cả khách không thuộc nhóm nào và không có careTeam', () => {
      const admin = actor(UserRole.ADMIN);
      expect(getDeleteDenial(admin, {}, DROPPED)).toBeNull();
      expect(
        getDeleteDenial(admin, { teamIds: [id()] }, NOT_DROPPED),
      ).toBeNull();
    });
  });

  describe('MANAGER', () => {
    const managedTeam = id();
    const manager = actor(UserRole.MANAGER, { managedTeamIds: [managedTeam] });

    it('khách thuộc nhóm mình quản lý: được xóa (kể cả không "Bỏ", giữ hành vi xóa đơn cũ)', () => {
      const customer: DeletableCustomer = { teamIds: [id(), managedTeam] };
      expect(getDeleteDenial(manager, customer, DROPPED)).toBeNull();
      expect(getDeleteDenial(manager, customer, NOT_DROPPED)).toBeNull();
    });

    it('chỉ có mặt trong careTeam (khách thuộc nhóm khác): bị từ chối dù THẤY khách theo phạm vi xem', () => {
      const customer: DeletableCustomer = {
        teamIds: [id()],
        careTeam: careTeam(id(), manager.userId),
      };
      expect(getDeleteDenial(manager, customer, DROPPED)).toBe('FORBIDDEN');
    });

    it('là người phụ trách chính nhưng khách ở nhóm mình không quản lý: vẫn bị từ chối', () => {
      const customer: DeletableCustomer = {
        teamIds: [id()],
        careTeam: careTeam(manager.userId),
      };
      expect(getDeleteDenial(manager, customer, DROPPED)).toBe('FORBIDDEN');
    });

    it('nhóm mình chỉ là THÀNH VIÊN (teamIds) mà không quản lý, hoặc khách không có nhóm: bị từ chối', () => {
      const memberOnly = actor(UserRole.MANAGER, {
        teamIds: [managedTeam],
        managedTeamIds: [],
      });
      expect(
        getDeleteDenial(memberOnly, { teamIds: [managedTeam] }, DROPPED),
      ).toBe('FORBIDDEN');
      expect(getDeleteDenial(manager, { teamIds: [] }, DROPPED)).toBe(
        'FORBIDDEN',
      );
    });
  });

  describe('STAFF', () => {
    const staff = actor(UserRole.STAFF);

    it('phụ trách chính + khách "Bỏ": được xóa (không cần là người nhập, không xét nhóm)', () => {
      const customer: DeletableCustomer = {
        careTeam: careTeam(staff.userId, id()),
        teamIds: [],
      };
      expect(getDeleteDenial(staff, customer, DROPPED)).toBeNull();
    });

    it('phụ trách chính nhưng khách KHÔNG "Bỏ": 409 NOT_DROPPED (không phải 403: họ có quyền với khách này)', () => {
      const customer = { careTeam: careTeam(staff.userId) };
      expect(getDeleteDenial(staff, customer, NOT_DROPPED)).toBe('NOT_DROPPED');
    });

    it('chỉ là thành viên careTeam (không phải phụ trách chính): bị từ chối', () => {
      const customer = { careTeam: careTeam(id(), staff.userId) };
      expect(getDeleteDenial(staff, customer, DROPPED)).toBe('FORBIDDEN');
    });

    it('không phải thành viên careTeam: bị từ chối; ưu tiên 403 hơn 409 khi vừa thiếu quyền vừa không "Bỏ"', () => {
      expect(
        getDeleteDenial(staff, { careTeam: careTeam(id()) }, DROPPED),
      ).toBe('FORBIDDEN');
      expect(
        getDeleteDenial(staff, { careTeam: careTeam(id()) }, NOT_DROPPED),
      ).toBe('FORBIDDEN');
    });
  });

  it('vai trò khác (EDITOR) không được xóa', () => {
    const editor = actor(UserRole.EDITOR);
    expect(
      getDeleteDenial(editor, { careTeam: careTeam(editor.userId) }, DROPPED),
    ).toBe('FORBIDDEN');
  });

  describe('xóa hàng loạt (requireDropped)', () => {
    const bulk = { isDropped: false, requireDropped: true };

    it('ADMIN và MANAGER cũng bị từ chối 409 khi khách không "Bỏ"; đủ điều kiện thì được', () => {
      const managedTeam = id();
      const admin = actor(UserRole.ADMIN);
      const manager = actor(UserRole.MANAGER, {
        managedTeamIds: [managedTeam],
      });
      const customer = { teamIds: [managedTeam] };
      expect(getDeleteDenial(admin, customer, bulk)).toBe('NOT_DROPPED');
      expect(getDeleteDenial(manager, customer, bulk)).toBe('NOT_DROPPED');
      expect(
        getDeleteDenial(manager, customer, { ...bulk, isDropped: true }),
      ).toBeNull();
    });

    it('Manager ngoài nhóm quản lý vẫn bị 403 trước (không lộ khách có "Bỏ" hay không)', () => {
      const manager = actor(UserRole.MANAGER, { managedTeamIds: [id()] });
      expect(getDeleteDenial(manager, { teamIds: [id()] }, bulk)).toBe(
        'FORBIDDEN',
      );
    });
  });
});

describe('assertCanDeleteCustomer', () => {
  it('ném 403 INSUFFICIENT_ROLE / 409 CUSTOMER_NOT_DROPPED, và không ném khi được phép', () => {
    const staff = actor(UserRole.STAFF);
    const mine = { careTeam: careTeam(staff.userId) };
    expect(() => assertCanDeleteCustomer(staff, mine, DROPPED)).not.toThrow();
    expect(() =>
      assertCanDeleteCustomer(staff, { careTeam: careTeam(id()) }, DROPPED),
    ).toThrow(ForbiddenException);
    let thrown: unknown;
    try {
      assertCanDeleteCustomer(staff, mine, NOT_DROPPED);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BusinessException);
    expect(thrown).toMatchObject({ errorCode: ErrorCode.CUSTOMER_NOT_DROPPED });
  });
});
