import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActor } from '../../common/access/crm-actor';
import { buildCustomerScope } from './customer-scope';

const actor = (overrides: Partial<CrmActor>): CrmActor => ({
  userId: new Types.ObjectId(),
  role: UserRole.STAFF,
  displayName: 'x',
  teamId: null,
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

  it('vai trò ngoài CRM (EDITOR) không thấy khách nào', () => {
    expect(buildCustomerScope(actor({ role: UserRole.EDITOR }))).toEqual({
      _id: { $in: [] },
    });
  });
});
