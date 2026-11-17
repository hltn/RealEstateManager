import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import {
  buildCustomer,
  buildCustomerWithOtherPrimary,
  buildScopedRepo,
  buildUserDirectory,
  chain,
  ctxOf,
  defaultCareTeam,
  makeFixtureUser,
  REJECTS,
  TEAM_A,
  USERS,
  type UserDirectoryOptions,
  type UserKey,
} from '../customers/access/customer-rights.fixture';
import { CareRole } from '../customers/customer.constants';
import { AppointmentStatus, AppointmentType } from './appointment.constants';
import { AppointmentsWriteService } from './appointments-write.service';

/**
 * T-55 (FR-30): người thực hiện NHIỀU NGƯỜI với tập hợp lệ = careTeam ACTIVE ∪ Quản lý nhóm chủ ∪ người tạo khách.
 * Dùng `buildCustomerScope`, `CustomersRepository` và `CustomerOwnerTeamService` THẬT (fixture), chỉ giả model Mongo.
 */

const SESSION = { id: 'tx-session' } as never;
const future = (): Date => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const id = (key: UserKey): Types.ObjectId => USERS[key].userId;
const sid = (key: UserKey): string => String(USERS[key].userId);

const makeAppointment = (
  customerId: Types.ObjectId,
  extra: Record<string, unknown> = {},
) => ({
  _id: new Types.ObjectId(),
  customerId,
  type: AppointmentType.SITE_VISIT,
  title: 'Xem nhà',
  location: '',
  note: '',
  startAt: future(),
  endAt: null,
  status: AppointmentStatus.SCHEDULED,
  assigneeIds: [id('STAFF_MEMBER')],
  assigneeId: id('STAFF_MEMBER'),
  remindBeforeMinutes: [60],
  createdBy: id('STAFF_MEMBER'),
  projectId: null,
  projectCode: null,
  deletedAt: null,
  __v: 1,
  ...extra,
});

const build = (
  customer: Record<string, unknown> & { _id: Types.ObjectId } = buildCustomer(),
  directory: UserDirectoryOptions = {},
  appointment: Record<string, unknown> & {
    _id: Types.ObjectId;
  } = makeAppointment(customer._id),
) => {
  const { repo, updates } = buildScopedRepo([customer]);
  const appointmentModel = {
    create: jest.fn(([doc]: Array<Record<string, unknown>>) =>
      Promise.resolve([
        {
          toObject: () => ({
            _id: new Types.ObjectId(),
            __v: 0,
            status: AppointmentStatus.SCHEDULED,
            remindBeforeMinutes: [60],
            ...doc,
          }),
        },
      ]),
    ),
    findOne: jest.fn((filter: Record<string, unknown>) =>
      chain(
        filter._id &&
          (filter._id as Types.ObjectId).equals(appointment._id) &&
          filter.deletedAt === null
          ? { ...appointment }
          : null,
      ),
    ),
    findOneAndUpdate: jest.fn(
      (_filter: unknown, update: { $set: Record<string, unknown> }) =>
        chain({ ...appointment, ...update.$set, __v: 2 }),
    ),
  };
  const dir = buildUserDirectory(directory);
  const refs = {
    resolveOneForAssign: jest.fn().mockResolvedValue(null),
    resolveByIds: jest.fn().mockResolvedValue([]),
    lockAndAssert: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue({ users: new Map() }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const reminders = { syncAppointment: jest.fn().mockResolvedValue(undefined) };
  const writer = new AppointmentsWriteService(
    appointmentModel as never,
    dir.userModel as never,
    repo,
    refs as never,
    {
      get: jest
        .fn()
        .mockResolvedValue({ defaultAppointmentReminderMinutes: [60] }),
    } as never,
    reminders as never,
    audit as never,
    dir.ownerTeam,
  );
  return {
    writer,
    customer,
    appointment,
    appointmentModel,
    refs,
    audit,
    reminders,
    updates,
    ...dir,
  };
};

type Harness = ReturnType<typeof build>;

const create = (
  h: Harness,
  key: UserKey,
  extra: Record<string, unknown> = {},
) =>
  h.writer.createInSession(
    ctxOf(key),
    {
      customerId: h.customer._id,
      type: AppointmentType.SITE_VISIT,
      startAt: future(),
      ...extra,
    },
    'WEB',
    SESSION,
  );

const update = (
  h: Harness,
  dto: Record<string, unknown>,
  key: UserKey = 'ADMIN',
) =>
  h.writer.updateInSession(
    ctxOf(key),
    String(h.appointment._id),
    { version: 1, ...dto },
    'WEB',
    SESSION,
  );

const notAssignable = (userIds: string[], reason: string) => ({
  ...REJECTS.USER_NOT_ASSIGNABLE,
  details: { userIds, reason },
});

/** Khách do `creator` (không thuộc careTeam) tạo; careTeam mặc định bỏ STAFF_PRIMARY nếu `creator` là họ. */
const customerCreatedBy = (
  creatorId: Types.ObjectId,
  over: Record<string, unknown> = {},
) => buildCustomer({ createdBy: creatorId, ...over });

describe('AppointmentsWriteService.createInSession: tập người thực hiện hợp lệ (FR-30)', () => {
  describe('Admin', () => {
    it('FR-30: Admin là thành viên careTeam (MEMBER) được chỉ định', async () => {
      const customer = buildCustomer({
        careTeam: [
          ...defaultCareTeam(),
          {
            userId: id('ADMIN'),
            role: CareRole.MEMBER,
            addedBy: id('STAFF_PRIMARY'),
            addedAt: new Date(),
          },
        ],
      });
      const h = build(customer);
      const { appointment } = await create(h, 'STAFF_PRIMARY', {
        assigneeIds: [id('ADMIN')],
      });
      expect(appointment.assigneeIds).toEqual([id('ADMIN')]);
      expect(appointment.assigneeId).toEqual(id('ADMIN'));
    });

    it('FR-30: Admin NGOÀI careTeam và không phải người tạo => 400 NOT_IN_CARE_TEAM (Admin chỉ được giao khi thuộc tập hợp lệ)', async () => {
      const h = build();
      await expect(
        create(h, 'ADMIN', { assigneeIds: [id('ADMIN')] }),
      ).rejects.toMatchObject(
        notAssignable([sid('ADMIN')], 'NOT_IN_CARE_TEAM'),
      );
      expect(h.appointmentModel.create).not.toHaveBeenCalled();
    });

    it('FR-30: Admin là người tạo khách nhưng ngoài careTeam => được chỉ định (nhánh người tạo, Admin thuần không có nhóm)', async () => {
      const adminOnly = makeFixtureUser('Admin tạo', {
        roles: [UserRole.ADMIN],
      });
      const h = build(customerCreatedBy(adminOnly._id), {
        extraUsers: [adminOnly],
      });
      const { appointment } = await create(h, 'ADMIN', {
        assigneeIds: [adminOnly._id],
      });
      expect(appointment.assigneeIds).toEqual([adminOnly._id]);
    });
  });

  describe('người tạo khách ngoài careTeam, đủ ba vai trò CRM', () => {
    it.each([
      ['STAFF', [UserRole.STAFF]],
      ['MANAGER', [UserRole.MANAGER]],
      ['ADMIN', [UserRole.ADMIN]],
    ])(
      'FR-30: người tạo %s ngoài careTeam được chỉ định',
      async (_n, roles) => {
        const creator = makeFixtureUser('Người tạo', { roles });
        const h = build(customerCreatedBy(creator._id), {
          extraUsers: [creator],
        });
        const { appointment } = await create(h, 'ADMIN', {
          assigneeIds: [creator._id, id('STAFF_MEMBER')],
        });
        expect(appointment.assigneeIds).toEqual([
          creator._id,
          id('STAFF_MEMBER'),
        ]);
      },
    );

    it.each([
      ['bị khóa', { status: UserStatus.BLOCKED }],
      ['đã xóa mềm', { deletedAt: new Date() }],
    ])(
      'FR-30: người tạo %s => 400 NOT_ACTIVE (vẫn thuộc tập hợp lệ nhưng không còn hoạt động)',
      async (_n, over) => {
        const creator = makeFixtureUser('Người tạo', over);
        const h = build(customerCreatedBy(creator._id), {
          extraUsers: [creator],
        });
        await expect(
          create(h, 'ADMIN', { assigneeIds: [creator._id] }),
        ).rejects.toMatchObject(
          notAssignable([String(creator._id)], 'NOT_ACTIVE'),
        );
      },
    );
  });

  describe('Quản lý nhóm chủ', () => {
    it('FR-30: nhóm chủ cố định theo người tạo: đổi PRIMARY không đổi tập; Manager nhóm khác (R8) vẫn bị chặn', async () => {
      const h = build(buildCustomerWithOtherPrimary());
      const ok = await create(h, 'ADMIN', {
        assigneeIds: [id('MANAGER_OWNER')],
      });
      expect(ok.appointment.assigneeIds).toEqual([id('MANAGER_OWNER')]);
      await expect(
        create(h, 'ADMIN', { assigneeIds: [id('MANAGER_R8')] }),
      ).rejects.toMatchObject(
        notAssignable([sid('MANAGER_R8')], 'NOT_IN_CARE_TEAM'),
      );
    });

    it('FR-30: người tạo là Admin thuần (không nhóm) thì KHÔNG có Quản lý nhóm chủ, kể cả khi customer.teamIds có nhóm', async () => {
      const adminOnly = makeFixtureUser('Admin tạo', {
        roles: [UserRole.ADMIN],
      });
      const h = build(customerCreatedBy(adminOnly._id, { teamIds: [TEAM_A] }), {
        extraUsers: [adminOnly],
      });
      await expect(
        create(h, 'ADMIN', { assigneeIds: [id('MANAGER_OWNER')] }),
      ).rejects.toMatchObject(
        notAssignable([sid('MANAGER_OWNER')], 'NOT_IN_CARE_TEAM'),
      );
    });

    it('FR-30: khách cũ thiếu createdBy dự phòng customer.teamIds => Quản lý nhóm đó được chỉ định', async () => {
      const h = build(buildCustomer({ createdBy: null, teamIds: [TEAM_A] }));
      const { appointment } = await create(h, 'ADMIN', {
        assigneeIds: [id('MANAGER_OWNER')],
      });
      expect(appointment.assigneeIds).toEqual([id('MANAGER_OWNER')]);
    });

    it('FR-30: nhóm chủ đã xóa mềm không tính => Quản lý nhóm đó bị chặn NOT_IN_CARE_TEAM', async () => {
      const h = build(buildCustomer(), { deletedTeamIds: [TEAM_A] });
      await expect(
        create(h, 'ADMIN', { assigneeIds: [id('MANAGER_OWNER')] }),
      ).rejects.toMatchObject(
        notAssignable([sid('MANAGER_OWNER')], 'NOT_IN_CARE_TEAM'),
      );
    });

    it('FR-30: Quản lý nhóm chủ bị khóa => NOT_ACTIVE', async () => {
      const h = build(buildCustomer(), {
        overrides: { MANAGER_OWNER: { status: UserStatus.BLOCKED } },
      });
      await expect(
        create(h, 'ADMIN', { assigneeIds: [id('MANAGER_OWNER')] }),
      ).rejects.toMatchObject(
        notAssignable([sid('MANAGER_OWNER')], 'NOT_ACTIVE'),
      );
    });

    it('FR-30: tài khoản còn trong managerIds nhưng đã mất vai trò MANAGER => NOT_IN_CARE_TEAM (kiểm vai trò từ lần đọc users)', async () => {
      const h = build(buildCustomer(), {
        overrides: { MANAGER_OWNER: { roles: [UserRole.STAFF] } },
      });
      await expect(
        create(h, 'ADMIN', { assigneeIds: [id('MANAGER_OWNER')] }),
      ).rejects.toMatchObject(
        notAssignable([sid('MANAGER_OWNER')], 'NOT_IN_CARE_TEAM'),
      );
    });
  });

  describe('thứ tự và nội dung lỗi cho cả mảng', () => {
    it('FR-30: nhiều người, chỉ một lần đọc users; userIds chỉ gồm những người ngoài tập', async () => {
      const h = build();
      await expect(
        create(h, 'ADMIN', {
          assigneeIds: [id('STAFF_MEMBER'), id('STAFF_OUT'), id('MANAGER_OUT')],
        }),
      ).rejects.toMatchObject(
        notAssignable(
          [sid('STAFF_OUT'), sid('MANAGER_OUT')],
          'NOT_IN_CARE_TEAM',
        ),
      );
      expect(h.userModel.find).toHaveBeenCalledTimes(1);
    });

    it('FR-30: id không tồn tại trong users => NOT_IN_CARE_TEAM', async () => {
      const ghost = new Types.ObjectId();
      const h = build();
      await expect(
        create(h, 'ADMIN', { assigneeIds: [ghost] }),
      ).rejects.toMatchObject(
        notAssignable([String(ghost)], 'NOT_IN_CARE_TEAM'),
      );
    });

    it('FR-30: thứ tự lý do NOT_IN_CARE_TEAM > NOT_ACTIVE > NOT_CRM_ROLE khi mảng vi phạm nhiều kiểu', async () => {
      const blocked = { status: UserStatus.BLOCKED };
      const editor = { roles: [UserRole.EDITOR] };
      const both = build(buildCustomer(), {
        overrides: { STAFF_MEMBER: blocked, STAFF_INVITED: editor },
      });
      // Có người ngoài tập => NOT_IN_CARE_TEAM thắng cả NOT_ACTIVE lẫn NOT_CRM_ROLE.
      await expect(
        create(both, 'ADMIN', {
          assigneeIds: [
            id('STAFF_MEMBER'),
            id('STAFF_INVITED'),
            id('STAFF_OUT'),
          ],
        }),
      ).rejects.toMatchObject({
        details: { reason: 'NOT_IN_CARE_TEAM', userIds: [sid('STAFF_OUT')] },
      });
      // Trong tập: NOT_ACTIVE thắng NOT_CRM_ROLE.
      await expect(
        create(both, 'ADMIN', {
          assigneeIds: [id('STAFF_MEMBER'), id('STAFF_INVITED')],
        }),
      ).rejects.toMatchObject({
        details: { reason: 'NOT_ACTIVE', userIds: [sid('STAFF_MEMBER')] },
      });
    });

    it('FR-30: thành viên careTeam chỉ có vai EDITOR (không vai CRM) => 400 NOT_CRM_ROLE', async () => {
      const h = build(buildCustomer(), {
        overrides: { STAFF_INVITED: { roles: [UserRole.EDITOR] } },
      });
      await expect(
        create(h, 'ADMIN', { assigneeIds: [id('STAFF_INVITED')] }),
      ).rejects.toMatchObject(
        notAssignable([sid('STAFF_INVITED')], 'NOT_CRM_ROLE'),
      );
    });

    it('FR-30: thông điệp từng lý do khác nhau và không chứa tên khách', async () => {
      const messages = new Set<string>();
      for (const [over, ids] of [
        [{}, [id('STAFF_OUT')]],
        [
          { STAFF_INVITED: { status: UserStatus.BLOCKED } },
          [id('STAFF_INVITED')],
        ],
        [
          { STAFF_INVITED: { roles: [UserRole.EDITOR] } },
          [id('STAFF_INVITED')],
        ],
      ] as Array<[UserDirectoryOptions['overrides'], Types.ObjectId[]]>) {
        const h = build(buildCustomer(), { overrides: over });
        const error = await create(h, 'ADMIN', { assigneeIds: ids }).catch(
          (e: Error) => e,
        );
        messages.add((error as Error).message);
        expect((error as Error).message).not.toContain('Khách thử');
      }
      expect(messages.size).toBe(3);
    });
  });

  describe('chỉ đọc nhóm chủ khi cần', () => {
    it('FR-30: mọi người đều trong careTeam hoặc là người tạo => không đọc người tạo/nhóm (không thêm truy vấn)', async () => {
      const h = build();
      await create(h, 'ADMIN', {
        assigneeIds: [id('STAFF_PRIMARY'), id('STAFF_MEMBER')],
      });
      expect(h.userModel.find).toHaveBeenCalledTimes(1);
      expect(h.userModel.findOne).not.toHaveBeenCalled();
      expect(h.teamModel.find).not.toHaveBeenCalled();
    });

    it('FR-30: có người ngoài careTeam => đọc người tạo MỘT lần và nhóm MỘT lần', async () => {
      const h = build();
      await create(h, 'ADMIN', { assigneeIds: [id('MANAGER_OWNER')] });
      expect(h.userModel.findOne).toHaveBeenCalledTimes(1);
      expect(h.teamModel.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('người thực hiện mặc định', () => {
    it('FR-30: người đặt lịch thuộc careTeam => chính họ', async () => {
      const h = build();
      const { appointment } = await create(h, 'STAFF_INVITED');
      expect(appointment.assigneeIds).toEqual([id('STAFF_INVITED')]);
      expect(appointment.assigneeId).toEqual(id('STAFF_INVITED'));
    });

    it('FR-30: người đặt lịch là người tạo khách (Admin) nhưng ngoài careTeam => chính họ (nhánh người tạo, không phải Manager)', async () => {
      const h = build(customerCreatedBy(id('ADMIN')));
      const { appointment } = await create(h, 'ADMIN');
      expect(appointment.assigneeIds).toEqual([id('ADMIN')]);
    });

    it('FR-30: người đặt lịch là Quản lý nhóm chủ ngoài careTeam => chính họ', async () => {
      const h = build();
      const { appointment } = await create(h, 'MANAGER_OWNER');
      expect(appointment.assigneeIds).toEqual([id('MANAGER_OWNER')]);
    });

    it('FR-30: người đặt lịch ngoài tập hợp lệ (Admin, Manager nhóm khác) => PRIMARY của khách', async () => {
      for (const key of ['ADMIN', 'MANAGER_R8'] as UserKey[]) {
        const h = build();
        const { appointment } = await create(h, key);
        expect(appointment.assigneeIds).toEqual([id('STAFF_PRIMARY')]);
      }
    });

    it('FR-30: ngoài tập hợp lệ và khách không có PRIMARY => 400 NOT_IN_CARE_TEAM với userIds rỗng', async () => {
      const h = build(buildCustomer({ primaryAssigneeId: null }));
      await expect(create(h, 'ADMIN')).rejects.toMatchObject(
        notAssignable([], 'NOT_IN_CARE_TEAM'),
      );
    });

    it('FR-30: id mặc định đi qua cùng bước kiểm: người đặt lịch trong careTeam nhưng đã bị khóa => NOT_ACTIVE', async () => {
      const h = build(buildCustomer(), {
        overrides: { STAFF_INVITED: { status: UserStatus.BLOCKED } },
      });
      await expect(create(h, 'STAFF_INVITED')).rejects.toMatchObject(
        notAssignable([sid('STAFF_INVITED')], 'NOT_ACTIVE'),
      );
    });
  });

  describe('ghi kép assigneeIds và assigneeId', () => {
    it('FR-30: nhiều người => assigneeIds giữ thứ tự, assigneeId = phần tử đầu; khử trùng', async () => {
      const h = build();
      const { appointment } = await create(h, 'ADMIN', {
        assigneeIds: [
          id('STAFF_MEMBER'),
          id('STAFF_PRIMARY'),
          id('STAFF_MEMBER'),
        ],
      });
      expect(appointment.assigneeIds).toEqual([
        id('STAFF_MEMBER'),
        id('STAFF_PRIMARY'),
      ]);
      expect(appointment.assigneeId).toEqual(id('STAFF_MEMBER'));
      const doc = h.appointmentModel.create.mock.calls[0][0][0] as {
        assigneeIds: Types.ObjectId[];
        assigneeId: Types.ObjectId;
      };
      expect(doc.assigneeId).toEqual(doc.assigneeIds[0]);
    });

    it('FR-30: client cũ chỉ gửi assigneeId => vẫn tạo được và ghi cả hai trường', async () => {
      const h = build();
      const { appointment } = await create(h, 'ADMIN', {
        assigneeId: id('STAFF_MEMBER'),
      });
      expect(appointment.assigneeIds).toEqual([id('STAFF_MEMBER')]);
      expect(appointment.assigneeId).toEqual(id('STAFF_MEMBER'));
    });

    it('FR-30: gửi cả hai thì assigneeIds thắng (assigneeId cũ bị bỏ qua)', async () => {
      const h = build();
      const { appointment } = await create(h, 'ADMIN', {
        assigneeId: id('STAFF_OUT'),
        assigneeIds: [id('STAFF_MEMBER')],
      });
      expect(appointment.assigneeIds).toEqual([id('STAFF_MEMBER')]);
    });

    it('FR-30: audit và tra tên dùng ĐỦ mọi người thực hiện', async () => {
      const h = build();
      h.refs.resolve.mockResolvedValue({
        users: new Map([
          [sid('STAFF_MEMBER'), 'Thành viên'],
          [sid('STAFF_PRIMARY'), 'Phụ trách'],
        ]),
      });
      await create(h, 'ADMIN', {
        assigneeIds: [id('STAFF_MEMBER'), id('STAFF_PRIMARY')],
      });
      expect(h.refs.resolve).toHaveBeenCalledWith({
        userIds: [id('STAFF_MEMBER'), id('STAFF_PRIMARY')],
      });
      const changes = (
        h.audit.record.mock.calls[0][0] as {
          changes: Array<{ field: string; to: unknown }>;
        }
      ).changes;
      expect(changes.find((c) => c.field === 'appointment.assignee')?.to).toBe(
        'Thành viên, Phụ trách',
      );
    });
  });
});

describe('AppointmentsWriteService.updateInSession: đổi danh sách người thực hiện (FR-30)', () => {
  it('FR-30: thêm Quản lý nhóm chủ (id MỚI hợp lệ) => ghi kép, giữ người cũ ở đầu', async () => {
    const h = build();
    await update(h, {
      assigneeIds: [id('STAFF_MEMBER'), id('MANAGER_OWNER')],
    });
    const set = h.appointmentModel.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.assigneeIds).toEqual([id('STAFF_MEMBER'), id('MANAGER_OWNER')]);
    expect(set.assigneeId).toEqual(id('STAFF_MEMBER'));
  });

  it('FR-30: id mới ngoài tập hợp lệ => 400 NOT_IN_CARE_TEAM, không ghi', async () => {
    const h = build();
    await expect(
      update(h, { assigneeIds: [id('STAFF_MEMBER'), id('STAFF_OUT')] }),
    ).rejects.toMatchObject(
      notAssignable([sid('STAFF_OUT')], 'NOT_IN_CARE_TEAM'),
    );
    expect(h.appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-30: CHỈ kiểm id mới thêm: người đã có (nay bị khóa) giữ nguyên, thêm người hợp lệ vẫn được', async () => {
    const h = build(buildCustomer(), {
      overrides: { STAFF_MEMBER: { status: UserStatus.BLOCKED } },
    });
    await update(h, {
      assigneeIds: [id('STAFF_MEMBER'), id('STAFF_PRIMARY')],
    });
    const lookup = h.userModel.find.mock.calls[0][0] as {
      _id: { $in: Types.ObjectId[] };
    };
    expect(lookup._id.$in).toEqual([id('STAFF_PRIMARY')]);
  });

  it('FR-30: sửa giờ/nội dung mà không đổi danh sách => không kiểm người thực hiện (không đọc users)', async () => {
    const h = build(buildCustomer(), {
      overrides: { STAFF_MEMBER: { status: UserStatus.BLOCKED } },
    });
    await update(h, { title: 'Tiêu đề mới' });
    expect(h.userModel.find).not.toHaveBeenCalled();
    const set = h.appointmentModel.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set).not.toHaveProperty('assigneeIds');
    expect(set).not.toHaveProperty('assigneeId');
  });

  it('FR-30: gửi lại đúng danh sách hiện tại => không đổi và không kiểm', async () => {
    const h = build();
    await update(h, { title: 'Mới', assigneeIds: [id('STAFF_MEMBER')] });
    expect(h.userModel.find).not.toHaveBeenCalled();
    const set = h.appointmentModel.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set).not.toHaveProperty('assigneeIds');
  });

  it('FR-30: gỡ bớt người (còn ít nhất một) không cần kiểm lại', async () => {
    const appointment = (customerId: Types.ObjectId) =>
      makeAppointment(customerId, {
        assigneeIds: [id('STAFF_MEMBER'), id('STAFF_PRIMARY')],
        assigneeId: id('STAFF_MEMBER'),
      });
    const customer = buildCustomer();
    const h = build(customer, {}, appointment(customer._id));
    await update(h, { assigneeIds: [id('STAFF_PRIMARY')] });
    expect(h.userModel.find).not.toHaveBeenCalled();
    const set = h.appointmentModel.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.assigneeIds).toEqual([id('STAFF_PRIMARY')]);
    expect(set.assigneeId).toEqual(id('STAFF_PRIMARY'));
  });

  it('FR-30: client cũ gửi assigneeId = người đầu hiện tại => không đổi (không cắt danh sách nhiều người)', async () => {
    const customer = buildCustomer();
    const h = build(
      customer,
      {},
      makeAppointment(customer._id, {
        assigneeIds: [id('STAFF_MEMBER'), id('STAFF_PRIMARY')],
      }),
    );
    await update(h, { title: 'Mới', assigneeId: sid('STAFF_MEMBER') });
    const set = h.appointmentModel.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set).not.toHaveProperty('assigneeIds');
  });

  it('FR-30: client cũ gửi assigneeId khác => thay danh sách bằng đúng người đó (đã kiểm)', async () => {
    const h = build();
    await update(h, { assigneeId: sid('STAFF_PRIMARY') });
    const set = h.appointmentModel.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.assigneeIds).toEqual([id('STAFF_PRIMARY')]);
    expect(set.assigneeId).toEqual(id('STAFF_PRIMARY'));
    await expect(
      update(build(), { assigneeId: sid('STAFF_OUT') }),
    ).rejects.toMatchObject(REJECTS.USER_NOT_ASSIGNABLE);
  });

  it('FR-30: lịch CHƯA backfill (chỉ có assigneeId) vẫn sửa được: danh sách hiện tại suy từ assigneeId', async () => {
    const customer = buildCustomer();
    const legacy = makeAppointment(customer._id);
    delete (legacy as Record<string, unknown>).assigneeIds;
    const h = build(customer, {}, legacy);
    await update(h, {
      assigneeIds: [id('STAFF_MEMBER'), id('STAFF_PRIMARY')],
    });
    const set = h.appointmentModel.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.assigneeIds).toEqual([id('STAFF_MEMBER'), id('STAFF_PRIMARY')]);
    const lookup = h.userModel.find.mock.calls[0][0] as {
      _id: { $in: Types.ObjectId[] };
    };
    expect(lookup._id.$in).toEqual([id('STAFF_PRIMARY')]);
  });
});

describe('FR-30: danh sách FE (ownerManagers + creator + careTeam) khớp tập BE chấp nhận (một builder dùng chung)', () => {
  const ALL = Object.keys(USERS) as UserKey[];

  const offered = async (h: Harness): Promise<Set<string>> => {
    const refs = await h.ownerTeam.buildOwnerRefs(
      h.customer as never,
      undefined,
    );
    return new Set([
      ...((h.customer.careTeam as Array<{ userId: Types.ObjectId }>) ?? []).map(
        (member) => String(member.userId),
      ),
      ...refs.ownerManagers.map((manager) => manager.userId),
      ...(refs.creator ? [refs.creator.userId] : []),
    ]);
  };
  const accepted = async (
    customer: Record<string, unknown> & { _id: Types.ObjectId },
    directory: UserDirectoryOptions,
  ): Promise<Set<string>> => {
    const result = new Set<string>();
    for (const key of ALL) {
      const h = build(customer, directory);
      try {
        await create(h, 'ADMIN', { assigneeIds: [id(key)] });
        result.add(sid(key));
      } catch {
        // bị từ chối: không thuộc tập hợp lệ
      }
    }
    return result;
  };

  it.each<
    [
      string,
      () => Record<string, unknown> & { _id: Types.ObjectId },
      UserDirectoryOptions,
    ]
  >([
    ['khách mặc định (người tạo Staff nhóm A)', () => buildCustomer(), {}],
    [
      'người tạo là Manager nhóm chủ',
      () => buildCustomer({ createdBy: id('MANAGER_OWNER') }),
      {},
    ],
    [
      'người tạo là Admin (không nhóm chủ)',
      () => buildCustomer({ createdBy: id('ADMIN') }),
      {},
    ],
    [
      'người tạo bị khóa',
      () => buildCustomer(),
      { overrides: { STAFF_PRIMARY: { status: UserStatus.BLOCKED } } },
    ],
    [
      'Manager nhóm chủ mất vai trò Manager',
      () => buildCustomer(),
      { overrides: { MANAGER_OWNER: { roles: [UserRole.STAFF] } } },
    ],
    [
      'nhóm chủ đã xóa mềm',
      () => buildCustomer(),
      { deletedTeamIds: [TEAM_A] },
    ],
  ])('%s', async (_label, makeCustomer, directory) => {
    const customer = makeCustomer();
    const h = build(customer, directory);
    const fromFe = await offered(h);
    const fromBe = await accepted(customer, directory);
    expect(fromBe.size).toBeGreaterThan(0);
    // careTeam có thể chứa người bị khóa: FE chỉ liệt kê danh sách thành viên, BE từ chối bị khóa; so trên người ACTIVE.
    const active = new Set(
      h.users
        .filter((user) => user.status === UserStatus.ACTIVE && !user.deletedAt)
        .map((user) => String(user._id)),
    );
    expect(new Set([...fromFe].filter((userId) => active.has(userId)))).toEqual(
      fromBe,
    );
  });
});
