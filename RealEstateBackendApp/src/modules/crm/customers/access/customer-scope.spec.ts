import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActor } from '../../common/access/crm-actor';
import { buildCustomerScope } from './customer-scope';

const actor = (overrides: Partial<CrmActor>): CrmActor => ({
  userId: new Types.ObjectId(),
  role: UserRole.STAFF,
  roles: [overrides.role ?? UserRole.STAFF],
  displayName: 'x',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
  ...overrides,
});

describe('buildCustomerScope (phạm vi khách theo vai trò, tài liệu 04 mục 4.3)', () => {
  it('ADMIN: không giới hạn', () => {
    expect({ ...buildCustomerScope(actor({ role: UserRole.ADMIN })) }).toEqual(
      {},
    );
  });

  it('MANAGER: khách của nhóm mình quản lý HOẶC khách mình nằm trong careTeam', () => {
    const managed = [new Types.ObjectId(), new Types.ObjectId()];
    const me = new Types.ObjectId();
    expect(
      buildCustomerScope(
        actor({ role: UserRole.MANAGER, userId: me, managedTeamIds: managed }),
      ),
    ).toEqual({
      $or: [{ teamIds: { $in: managed } }, { 'careTeam.userId': me }],
    });
  });

  it('MANAGER dùng managedTeamIds, KHÔNG dùng nhóm mình thuộc về (không mở rộng quyền theo teamId)', () => {
    const own = new Types.ObjectId();
    const scope = buildCustomerScope(
      actor({ role: UserRole.MANAGER, teamId: own, managedTeamIds: [] }),
    ) as unknown as { $or: Array<{ teamIds?: { $in: Types.ObjectId[] } }> };
    expect(scope.$or[0].teamIds?.$in).toEqual([]);
  });

  it('STAFF: chỉ khách có mình trong careTeam, bất kể nhóm', () => {
    const me = new Types.ObjectId();
    expect(
      buildCustomerScope(
        actor({
          role: UserRole.STAFF,
          userId: me,
          teamId: new Types.ObjectId(),
          managedTeamIds: [new Types.ObjectId()],
        }),
      ),
    ).toEqual({ 'careTeam.userId': me });
  });

  it('FR-06: phạm vi không phụ thuộc teamIds của khách (khách teamIds=[] do Admin tạo vẫn thấy qua careTeam)', () => {
    const me = new Types.ObjectId();
    expect(
      buildCustomerScope(actor({ role: UserRole.STAFF, userId: me })),
    ).toEqual({ 'careTeam.userId': me });
    // Manager chưa quản lý nhóm nào: nhánh teamIds khớp rỗng, nhánh careTeam vẫn hoạt động.
    expect(
      buildCustomerScope(
        actor({ role: UserRole.MANAGER, userId: me, managedTeamIds: [] }),
      ),
    ).toEqual({ $or: [{ teamIds: { $in: [] } }, { 'careTeam.userId': me }] });
  });

  it('vai trò ngoài CRM (EDITOR) không thấy khách nào', () => {
    expect(buildCustomerScope(actor({ role: UserRole.EDITOR }))).toEqual({
      _id: { $in: [] },
    });
  });
});
