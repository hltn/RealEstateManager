import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CareRole } from './customer.constants';
import {
  LIST_PROJECTION,
  toDeletedListItem,
  toDetail,
  toListItem,
} from './customer.mapper';
import type { RefMaps } from './customer-refs.service';
import type { CustomerLean } from './customers.repository';

const me = new Types.ObjectId();
const other = new Types.ObjectId();

const baseRefs: RefMaps = {
  statuses: new Map(),
  sources: new Map(),
  areas: new Map(),
  projects: new Map(),
  contactResults: new Map(),
  tags: new Map(),
  users: new Map(),
  codes: {
    sources: new Map(),
    areas: new Map(),
    projects: new Map(),
    contactResults: new Map(),
  },
};
const refsWithStates: RefMaps = {
  ...baseRefs,
  users: new Map([
    [String(me), 'Tôi'],
    [String(other), 'Người nghỉ việc'],
  ]),
  userStates: new Map([
    [String(me), { isLocked: false, role: UserRole.MANAGER }],
    [String(other), { isLocked: true, role: UserRole.STAFF }],
  ]),
};

const doc = {
  _id: new Types.ObjectId(),
  customerCode: 'KH-000123',
  fullName: 'Khách A',
  phone: '+84912345678',
  statusId: new Types.ObjectId(),
  interestedProjectIds: [],
  primaryAssigneeId: other,
  careTeam: [
    { userId: other, role: CareRole.PRIMARY, addedBy: me, addedAt: new Date() },
    { userId: me, role: CareRole.MEMBER, addedBy: me, addedAt: new Date() },
  ],
  criteria: {},
  lastUpdatedAt: new Date(),
  createdAt: new Date(),
  hasNationalId: true,
  nationalIdLast4: '8901',
  dataConsent: {},
  __v: 1,
} as unknown as CustomerLean;

const actor = (role: UserRole) => ({
  userId: me,
  role,
  roles: [role],
  displayName: 'me',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
});

describe('FR-09: customerCode ở danh sách, chi tiết, khách đã xóa', () => {
  it('list item trả customerCode; khách chưa có mã trả null (không undefined)', () => {
    expect(toListItem(doc, refsWithStates).customerCode).toBe('KH-000123');
    const noCode = { ...doc } as Record<string, unknown>;
    delete noCode.customerCode;
    expect(
      toListItem(noCode as unknown as CustomerLean, baseRefs),
    ).toHaveProperty('customerCode', null);
    expect(
      toListItem({ ...doc, customerCode: null }, baseRefs).customerCode,
    ).toBeNull();
  });

  it('khách đã xóa (toDeletedListItem) cũng trả customerCode', () => {
    const item = toDeletedListItem(
      { ...doc, deletedAt: new Date(), deletedBy: me },
      refsWithStates,
      null,
    );
    expect(item.customerCode).toBe('KH-000123');
  });

  it('mọi vai trò thấy mã ở chi tiết, kể cả khách không SĐT', () => {
    const noPhone = { ...doc, phone: null } as unknown as CustomerLean;
    for (const role of [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF]) {
      const detail = toDetail(noPhone, refsWithStates, actor(role));
      expect(detail.customerCode).toBe('KH-000123');
      expect(detail.phoneMasked).toBeNull();
    }
  });

  it('Staff thấy mã nhưng không có thêm quyền nào (không xem CCCD, không quản lý nhóm, không xóa)', () => {
    const staff = toDetail(doc, refsWithStates, actor(UserRole.STAFF));
    expect(staff.customerCode).toBe('KH-000123');
    expect(staff.canRevealNationalId).toBe(false);
    expect(staff.permissions.canManageCareTeam).toBe(false);
    expect(staff.permissions.canDelete).toBe(false);
  });

  it('LIST_PROJECTION lấy customerCode và vẫn không lấy searchText/nationalId', () => {
    expect(LIST_PROJECTION).toHaveProperty('customerCode', 1);
    expect(LIST_PROJECTION).not.toHaveProperty('searchText');
    expect(LIST_PROJECTION).not.toHaveProperty('nationalId');
  });
});

describe('FR-18: isLocked và role thành viên', () => {
  it('primaryAssignee.isLocked true khi tài khoản bị khóa, false khi hoạt động', () => {
    expect(toListItem(doc, refsWithStates).primaryAssignee).toEqual({
      id: String(other),
      displayName: 'Người nghỉ việc',
      isLocked: true,
    });
    const active = toListItem(
      { ...doc, primaryAssigneeId: me },
      refsWithStates,
    );
    expect(active.primaryAssignee?.isLocked).toBe(false);
  });

  it('khách chưa có PRIMARY (null) thì primaryAssignee null, không ném lỗi', () => {
    expect(
      toListItem({ ...doc, primaryAssigneeId: null }, refsWithStates)
        .primaryAssignee,
    ).toBeNull();
  });

  it('careTeam[].user có isLocked và role của từng thành viên', () => {
    const { careTeam } = toDetail(doc, refsWithStates, actor(UserRole.ADMIN));
    expect(careTeam[0].user).toEqual({
      id: String(other),
      displayName: 'Người nghỉ việc',
      isLocked: true,
      role: UserRole.STAFF,
    });
    expect(careTeam[1].user).toMatchObject({
      isLocked: false,
      role: UserRole.MANAGER,
    });
  });

  it('RefMaps không có userStates (người không còn trong DB) thì không ném lỗi, role null, không isLocked', () => {
    const { careTeam } = toDetail(doc, baseRefs, actor(UserRole.ADMIN));
    expect(careTeam[0].user.role).toBeNull();
    expect(careTeam[0].user.isLocked).toBeUndefined();
  });

  it('userStates có nhưng thiếu id của user đã bị xóa khỏi DB: không ném lỗi, role null, không isLocked, primaryAssignee không isLocked', () => {
    const deleted = new Types.ObjectId();
    const partial: RefMaps = {
      ...refsWithStates,
      // `deleted` không có trong cả `users` lẫn `userStates`; người khác vẫn có.
      userStates: new Map([[String(me), { isLocked: false, role: null }]]),
    };
    const orphan = {
      ...doc,
      primaryAssigneeId: deleted,
      careTeam: [
        {
          userId: deleted,
          role: CareRole.PRIMARY,
          addedBy: me,
          addedAt: new Date(),
        },
      ],
    } as unknown as CustomerLean;

    const detail = toDetail(orphan, partial, actor(UserRole.ADMIN));

    expect(detail.careTeam[0].user).toEqual({
      id: String(deleted),
      displayName: '',
      role: null,
    });
    expect(detail.careTeam[0].user).not.toHaveProperty('isLocked');
    expect(detail.primaryAssignee).toEqual({
      id: String(deleted),
      displayName: '',
    });
  });
});
