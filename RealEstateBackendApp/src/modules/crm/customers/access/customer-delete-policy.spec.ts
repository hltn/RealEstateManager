import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActor } from '../../common/access/crm-actor';
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

/**
 * FR-31 (Oniichan chốt 2026-11-16): xóa khách chỉ ADMIN hoặc NGƯỜI TẠO (`createdBy`), KHÔNG điều kiện trạng thái
 * (D9), cho cả xóa đơn lẫn hàng loạt. Manager (kể cả nhóm chủ), PRIMARY không phải người tạo, thành viên careTeam
 * đều KHÔNG được xóa.
 */
describe('getDeleteDenial (quyền xóa khách, FR-31)', () => {
  describe('ADMIN', () => {
    it('xóa được mọi khách, kể cả khách thiếu createdBy hoặc do người khác tạo', () => {
      const admin = actor(UserRole.ADMIN);
      expect(getDeleteDenial(admin, {})).toBeNull();
      expect(getDeleteDenial(admin, { createdBy: null })).toBeNull();
      expect(getDeleteDenial(admin, { createdBy: id() })).toBeNull();
    });
  });

  describe('người tạo (dưới Admin)', () => {
    it.each([UserRole.STAFF, UserRole.MANAGER])(
      '%s là người tạo: được xóa khách của mình (không điều kiện trạng thái)',
      (role) => {
        const creator = actor(role);
        expect(
          getDeleteDenial(creator, { createdBy: creator.userId }),
        ).toBeNull();
      },
    );

    it('người tạo được xóa dù không còn trong careTeam và không thuộc nhóm nào (chỉ xét createdBy)', () => {
      const creator = actor(UserRole.STAFF, { teamId: null, teamIds: [] });
      expect(
        getDeleteDenial(creator, { createdBy: creator.userId }),
      ).toBeNull();
    });
  });

  describe('người KHÔNG phải người tạo', () => {
    it('MANAGER quản lý nhóm chủ (nhóm của người tạo) KHÔNG được xóa khách của nhân viên', () => {
      const ownerTeam = id();
      const manager = actor(UserRole.MANAGER, {
        teamId: ownerTeam,
        teamIds: [ownerTeam],
        managedTeamIds: [ownerTeam],
      });
      expect(getDeleteDenial(manager, { createdBy: id() })).toBe('FORBIDDEN');
    });

    it('STAFF khác (kể cả là PRIMARY hoặc MEMBER của khách) KHÔNG được xóa', () => {
      const staff = actor(UserRole.STAFF);
      expect(getDeleteDenial(staff, { createdBy: id() })).toBe('FORBIDDEN');
    });

    it('khách thiếu createdBy (khách cũ): chỉ Admin xóa được, Staff/Manager bị từ chối', () => {
      expect(getDeleteDenial(actor(UserRole.STAFF), {})).toBe('FORBIDDEN');
      expect(
        getDeleteDenial(actor(UserRole.MANAGER), { createdBy: null }),
      ).toBe('FORBIDDEN');
    });

    it('vai trò ngoài CRM (EDITOR) không phải người tạo thì không được xóa', () => {
      expect(getDeleteDenial(actor(UserRole.EDITOR), { createdBy: id() })).toBe(
        'FORBIDDEN',
      );
    });
  });
});

describe('assertCanDeleteCustomer', () => {
  it('ném 403 INSUFFICIENT_ROLE khi không đủ quyền, không ném khi là người tạo hoặc Admin', () => {
    const staff = actor(UserRole.STAFF);
    const mine: DeletableCustomer = { createdBy: staff.userId };
    expect(() => assertCanDeleteCustomer(staff, mine)).not.toThrow();
    expect(() =>
      assertCanDeleteCustomer(actor(UserRole.ADMIN), { createdBy: id() }),
    ).not.toThrow();
    expect(() => assertCanDeleteCustomer(staff, { createdBy: id() })).toThrow(
      ForbiddenException,
    );
    expect(() => assertCanDeleteCustomer(staff, { createdBy: id() })).toThrow(
      'Insufficient role',
    );
  });
});
