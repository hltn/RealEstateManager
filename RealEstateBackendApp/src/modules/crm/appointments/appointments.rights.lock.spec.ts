import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import {
  buildAccess,
  buildCustomer,
  buildScopedRepo,
  chain,
  ctxOf,
  defaultCareTeam,
  fakeConnection,
  IN_SCOPE_KEYS,
  jwtOf,
  OUT_OF_SCOPE_KEYS,
  REJECTS,
  TEAM_A,
  USERS,
  type UserKey,
} from '../customers/access/customer-rights.fixture';
import { AppointmentStatus, AppointmentType } from './appointment.constants';
import { AppointmentsService } from './appointments.service';
import { AppointmentsWriteService } from './appointments-write.service';

/**
 * T-54 (FR-31): KHÓA HIỆN TRẠNG quyền lịch hẹn bằng `buildCustomerScope` + `CustomersRepository` THẬT.
 * - (a, b, c): ngoài phạm vi bị chặn, trong phạm vi tạo được (cả R8, e3).
 * - (d): người thực hiện ngoài `careTeam` => 400 USER_NOT_ASSIGNABLE.
 * - (e, e1): sửa/đổi trạng thái hiện KHÔNG kiểm người sửa (ai trong phạm vi cũng được); xóa: Admin/Manager/người tạo lịch.
 * Hậu tố `[đảo ở T-55]` / `[đảo ở T-56]` = hành vi hiện tại sẽ đổi ở task đó; test không hậu tố phải xanh đến hết T-61.
 */

const SESSION = { id: 'tx-session' } as never;
const future = (): Date => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

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
  assigneeId: USERS.STAFF_MEMBER.userId,
  remindBeforeMinutes: [60],
  // Lịch do STAFF_MEMBER tạo: "người khác" với mọi vai trò còn lại.
  createdBy: USERS.STAFF_MEMBER.userId,
  projectId: null,
  projectCode: null,
  deletedAt: null,
  __v: 1,
  ...extra,
});

const build = (
  customer: Record<string, unknown> & { _id: Types.ObjectId } = buildCustomer(),
  appointment = makeAppointment(customer._id),
  assigneeActive = true,
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
        chain({ ...appointment, ...update.$set, __v: appointment.__v + 1 }),
    ),
  };
  const userModel = {
    // Có khai báo kiểu đối số (`[Record]`) để test đọc được `mock.calls[0][0]` (bộ lọc gửi cho `exists`).
    exists: jest.fn<ReturnType<typeof chain>, [Record<string, unknown>]>(() =>
      chain(assigneeActive ? { _id: new Types.ObjectId() } : null),
    ),
  };
  const refs = {
    resolveOneForAssign: jest.fn().mockResolvedValue(null),
    resolveByIds: jest.fn().mockResolvedValue([]),
    lockAndAssert: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue({ users: new Map() }),
  };
  const writer = new AppointmentsWriteService(
    appointmentModel as never,
    userModel as never,
    repo,
    refs as never,
    {
      get: jest
        .fn()
        .mockResolvedValue({ defaultAppointmentReminderMinutes: [60] }),
    } as never,
    { syncAppointment: jest.fn().mockResolvedValue(undefined) } as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const service = new AppointmentsService(
    fakeConnection() as never,
    appointmentModel as never,
    buildAccess() as never,
    repo,
    refs as never,
    writer,
    {} as never,
  );
  return {
    writer,
    service,
    customer,
    appointment,
    appointmentModel,
    userModel,
    updates,
  };
};

const createInput = (
  customerId: Types.ObjectId,
  extra: Record<string, unknown> = {},
) => ({
  customerId,
  type: AppointmentType.SITE_VISIT,
  startAt: future(),
  ...extra,
});

// ============================================================================================
// A5 Tạo lịch hẹn
// ============================================================================================
describe('AppointmentsWriteService.createInSession: quyền tạo lịch (FR-31 a, b, c, e3)', () => {
  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không tạo lịch',
    async (key) => {
      const h = build();
      await expect(
        h.writer.createInSession(
          ctxOf(key),
          createInput(h.customer._id) as never,
          'WEB',
          SESSION,
        ),
      ).rejects.toMatchObject(REJECTS.CUSTOMER_NOT_FOUND);
      expect(h.appointmentModel.create).not.toHaveBeenCalled();
    },
  );

  it.each(IN_SCOPE_KEYS)(
    'FR-31 (b, e3): %s trong phạm vi tạo được lịch, createdBy = chính mình (giữ ở T-56; gồm R8 = Manager nhóm khác)',
    async (key) => {
      const h = build();
      const { appointment } = await h.writer.createInSession(
        ctxOf(key),
        createInput(h.customer._id),
        'WEB',
        SESSION,
      );
      expect(appointment.createdBy).toEqual(USERS[key].userId);
      expect(h.appointmentModel.create).toHaveBeenCalledTimes(1);
    },
  );

  it('FR-31 (e3) D13: R8 (Manager nhóm khác, không trong careTeam, không phải người tạo) tạo được lịch; người thực hiện mặc định là PRIMARY của khách', async () => {
    const h = build();
    const { appointment } = await h.writer.createInSession(
      ctxOf('MANAGER_R8'),
      createInput(h.customer._id),
      'WEB',
      SESSION,
    );
    expect(appointment.assigneeId).toEqual(USERS.STAFF_PRIMARY.userId);
  });
});

describe('AppointmentsWriteService.createInSession: Manager chỉ nhờ careTeam, không giao nhóm (FR-31 b, e3)', () => {
  // Khách chỉ thuộc TEAM_A: MANAGER_INCARE (nhóm TEAM_D) không giao `teamIds`, chỉ thấy khách vì nằm trong `careTeam`.
  const careTeamOnly = () => buildCustomer({ teamIds: [TEAM_A] });

  it('FR-31 (b) L1: Manager nhóm khác chỉ nhờ `careTeam` (teamIds không giao nhóm của họ) vẫn tạo được lịch, createdBy = chính mình (giữ ở T-56)', async () => {
    const customer = careTeamOnly();
    const h = build(customer);
    const { appointment } = await h.writer.createInSession(
      ctxOf('MANAGER_INCARE'),
      createInput(customer._id),
      'WEB',
      SESSION,
    );
    expect(appointment.createdBy).toEqual(USERS.MANAGER_INCARE.userId);
    expect(h.appointmentModel.create).toHaveBeenCalledTimes(1);
  });

  it('FR-31 (a, c) L1 (đối chứng): Manager nhóm khác KHÔNG trong careTeam và teamIds không giao nhóm => 404 CUSTOMER_NOT_FOUND', async () => {
    const customer = careTeamOnly();
    const h = build(customer);
    await expect(
      h.writer.createInSession(
        ctxOf('MANAGER_R8'),
        createInput(customer._id) as never,
        'WEB',
        SESSION,
      ),
    ).rejects.toMatchObject(REJECTS.CUSTOMER_NOT_FOUND);
    expect(h.appointmentModel.create).not.toHaveBeenCalled();
  });
});

// ============================================================================================
// A6 Giao lịch cho ai (d)
// ============================================================================================
describe('AppointmentsWriteService: người thực hiện phải thuộc careTeam (FR-31 d)', () => {
  // Người ngoài careTeam, KHÔNG phải Manager nhóm chủ, KHÔNG phải người tạo: bị chặn hiện tại và sau T-55.
  it.each(['STAFF_OUT', 'MANAGER_OUT', 'MANAGER_R8'] as UserKey[])(
    'FR-31 (d): chỉ định %s (Manager/Staff ngoài careTeam) => 400 USER_NOT_ASSIGNABLE, details.userIds = [người đó], không tạo lịch',
    async (assignee) => {
      const h = build();
      await expect(
        h.writer.createInSession(
          ctxOf('ADMIN'),
          createInput(h.customer._id, {
            assigneeId: USERS[assignee].userId,
          }) as never,
          'WEB',
          SESSION,
        ),
      ).rejects.toMatchObject({
        ...REJECTS.USER_NOT_ASSIGNABLE,
        details: { userIds: [String(USERS[assignee].userId)] },
      });
      expect(h.userModel.exists).not.toHaveBeenCalled();
      expect(h.appointmentModel.create).not.toHaveBeenCalled();
    },
  );

  it('FR-31 (d): thành viên careTeam nhưng `userModel.exists` không tìm thấy (không còn ACTIVE hoặc không đúng vai) => 400 USER_NOT_ASSIGNABLE (chỉ kiểm nhánh exists -> null)', async () => {
    const h = build(undefined, undefined, false);
    await expect(
      h.writer.createInSession(
        ctxOf('ADMIN'),
        createInput(h.customer._id, {
          assigneeId: USERS.STAFF_INVITED.userId,
        }) as never,
        'WEB',
        SESSION,
      ),
    ).rejects.toMatchObject(REJECTS.USER_NOT_ASSIGNABLE);
  });

  it('FR-31 (d) bộ lọc người thực hiện gửi cho `userModel.exists` là ACTIVE + roles $in [MANAGER, STAFF] (KHÔNG có ADMIN), chưa xóa [đảo ở T-55]', async () => {
    // Đây là gốc lỗi "Admin tạo khách rồi tạo lịch bị 400": ADMIN không nằm trong CRM_TEAM_ROLES nên không thể là
    // người thực hiện. T-55 đổi quy tắc này; mock `exists` phải được khóa bằng ĐỐI SỐ, không chỉ bằng kết quả trả về.
    const h = build();
    await h.writer.createInSession(
      ctxOf('STAFF_PRIMARY'),
      createInput(h.customer._id, {
        assigneeId: USERS.STAFF_INVITED.userId,
      }),
      'WEB',
      SESSION,
    );
    expect(h.userModel.exists).toHaveBeenCalledTimes(1);
    const filter = h.userModel.exists.mock.calls[0][0];
    expect(filter).toEqual({
      _id: USERS.STAFF_INVITED.userId,
      status: UserStatus.ACTIVE,
      roles: { $in: [UserRole.MANAGER, UserRole.STAFF] },
      deletedAt: null,
    });
    expect((filter.roles as { $in: UserRole[] }).$in).not.toContain(
      UserRole.ADMIN,
    );
  });

  it('FR-31 (d): chỉ định thành viên careTeam còn ACTIVE => tạo được (người gọi là Staff khác)', async () => {
    const h = build();
    const { appointment } = await h.writer.createInSession(
      ctxOf('STAFF_PRIMARY'),
      createInput(h.customer._id, {
        assigneeId: USERS.STAFF_INVITED.userId,
      }),
      'WEB',
      SESSION,
    );
    expect(appointment.assigneeId).toEqual(USERS.STAFF_INVITED.userId);
  });

  it('FR-31 (d): sửa lịch đổi người thực hiện sang người ngoài careTeam => 400 USER_NOT_ASSIGNABLE, không ghi', async () => {
    const h = build();
    await expect(
      h.writer.updateInSession(
        ctxOf('STAFF_MEMBER'),
        String(h.appointment._id),
        { version: 1, assigneeId: String(USERS.STAFF_OUT.userId) },
        'WEB',
        SESSION,
      ),
    ).rejects.toMatchObject(REJECTS.USER_NOT_ASSIGNABLE);
    expect(h.appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('FR-31 (d) Manager nhóm chủ ngoài careTeam bị chặn USER_NOT_ASSIGNABLE khi được chỉ định [đảo ở T-55]', async () => {
    const h = build();
    await expect(
      h.writer.createInSession(
        ctxOf('ADMIN'),
        createInput(h.customer._id, {
          assigneeId: USERS.MANAGER_OWNER.userId,
        }) as never,
        'WEB',
        SESSION,
      ),
    ).rejects.toMatchObject(REJECTS.USER_NOT_ASSIGNABLE);
  });

  it('FR-31 (d) người tạo khách ngoài careTeam bị chặn USER_NOT_ASSIGNABLE khi được chỉ định [đảo ở T-55]', async () => {
    // Fixture CÓ người tạo ngoài careTeam (cố ý, để khóa hiện trạng): STAFF_PRIMARY là người tạo nhưng đã bị gỡ.
    const customer = buildCustomer({
      careTeam: defaultCareTeam().filter(
        (member) => !member.userId.equals(USERS.STAFF_PRIMARY.userId),
      ),
      primaryAssigneeId: USERS.STAFF_MEMBER.userId,
    });
    const h = build(customer);
    await expect(
      h.writer.createInSession(
        ctxOf('ADMIN'),
        createInput(customer._id, {
          assigneeId: USERS.STAFF_PRIMARY.userId,
        }) as never,
        'WEB',
        SESSION,
      ),
    ).rejects.toMatchObject(REJECTS.USER_NOT_ASSIGNABLE);
  });
});

// ============================================================================================
// A7/A8 Sửa, đổi trạng thái lịch (e1)
// ============================================================================================
describe('AppointmentsWriteService.updateInSession: sửa lịch (FR-31 a, e1)', () => {
  const edit = (h: ReturnType<typeof build>, key: UserKey) =>
    h.writer.updateInSession(
      ctxOf(key),
      String(h.appointment._id),
      { version: 1, title: 'Tiêu đề mới' },
      'WEB',
      SESSION,
    );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 RESOURCE_NOT_FOUND, không ghi',
    async (key) => {
      const h = build();
      await expect(edit(h, key)).rejects.toMatchObject(
        REJECTS.RESOURCE_NOT_FOUND,
      );
      expect(h.appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['STAFF_MEMBER', 'ADMIN'] as UserKey[])(
    'FR-31 (e1) A8: %s (người tạo lịch hoặc Admin) sửa được lịch (giữ ở T-56)',
    async (key) => {
      const h = build();
      await edit(h, key);
      expect(h.appointmentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'STAFF_PRIMARY',
    'STAFF_INVITED',
    'MANAGER_OWNER',
    'MANAGER_R8',
    'MANAGER_INCARE',
  ] as UserKey[])(
    'FR-31 (e1) A7: %s (trong phạm vi, KHÔNG phải người tạo lịch) hiện sửa được lịch của người khác, không kiểm người sửa [đảo ở T-56]',
    async (key) => {
      const h = build();
      await edit(h, key);
      expect(h.appointmentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    },
  );
});

describe('AppointmentsWriteService.changeStatusInSession: đổi trạng thái lịch (FR-31 a, e1)', () => {
  const finish = (h: ReturnType<typeof build>, key: UserKey) =>
    h.writer.changeStatusInSession(
      ctxOf(key),
      String(h.appointment._id),
      { version: 1, status: AppointmentStatus.DONE },
      'WEB',
      SESSION,
    );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 RESOURCE_NOT_FOUND, không ghi',
    async (key) => {
      const h = build();
      await expect(finish(h, key)).rejects.toMatchObject(
        REJECTS.RESOURCE_NOT_FOUND,
      );
      expect(h.appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['STAFF_MEMBER', 'ADMIN'] as UserKey[])(
    'FR-31 (e1) A8: %s (người tạo lịch hoặc Admin) đổi được trạng thái (giữ ở T-56)',
    async (key) => {
      const h = build();
      const result = await finish(h, key);
      expect(result.changed).toBe(true);
    },
  );

  it.each([
    'STAFF_PRIMARY',
    'STAFF_INVITED',
    'MANAGER_OWNER',
    'MANAGER_R8',
    'MANAGER_INCARE',
  ] as UserKey[])(
    'FR-31 (e1) A7: %s (trong phạm vi, KHÔNG phải người tạo lịch) hiện đổi được trạng thái lịch của người khác [đảo ở T-56]',
    async (key) => {
      const h = build();
      const result = await finish(h, key);
      expect(result.changed).toBe(true);
    },
  );
});

// ============================================================================================
// A7/A8 Xóa lịch
// ============================================================================================
describe('AppointmentsService.remove: xóa lịch (FR-31 a, e)', () => {
  const remove = (h: ReturnType<typeof build>, key: UserKey) =>
    h.service.remove(jwtOf(key), String(h.appointment._id));

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 RESOURCE_NOT_FOUND, không xóa',
    async (key) => {
      const h = build();
      await expect(remove(h, key)).rejects.toMatchObject(
        REJECTS.RESOURCE_NOT_FOUND,
      );
      expect(h.appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['STAFF_MEMBER', 'ADMIN'] as UserKey[])(
    'FR-31 (e) A8: %s (người tạo lịch hoặc Admin) xóa được lịch (giữ ở T-56)',
    async (key) => {
      const h = build();
      await remove(h, key);
      expect(h.appointmentModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({ deletedBy: USERS[key].userId }),
        }),
        expect.anything(),
      );
    },
  );

  it.each(['STAFF_PRIMARY', 'STAFF_INVITED'] as UserKey[])(
    'FR-31 (e) A7: %s (Staff trong careTeam, không phải người tạo lịch) xóa lịch người khác => 403 INSUFFICIENT_ROLE (giữ ở T-56)',
    async (key) => {
      const h = build();
      await expect(remove(h, key)).rejects.toMatchObject(
        REJECTS.INSUFFICIENT_ROLE,
      );
      expect(h.appointmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['MANAGER_OWNER', 'MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e) A7: %s (Manager trong phạm vi, không phải người tạo lịch) xóa được lịch của người khác [đảo ở T-56]',
    async (key) => {
      const h = build();
      await remove(h, key);
      expect(h.appointmentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    },
  );
});
