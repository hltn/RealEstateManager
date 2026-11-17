import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { AppointmentType } from '../appointments/appointment.constants';
import { CustomerOwnerTeamService } from '../customers/customer-owner-team.service';
import { ReminderType } from './reminder.constants';
import { ReminderDispatchService } from './reminder-dispatch.service';

/**
 * FR-33 (T-58): nhắc giờ hẹn `APPOINTMENT_DUE` gửi ĐÚNG những người được chọn làm người thực hiện (`assigneeIds`) mà
 * còn nằm trong tập hợp lệ HIỆN TẠI của khách (thành viên `careTeam` ACTIVE, Manager ACTIVE của nhóm chủ, người tạo
 * khách ACTIVE có vai trò CRM); không còn ai thì HỦY. Chạy `CustomerOwnerTeamService` THẬT (nguồn dựng tập hợp lệ
 * chung với `resolveAssignees`, T-55) trên model giả có lọc, và kho khách giả ÁP DỤNG ĐÚNG `CUSTOMER_PROJECTION` của
 * dịch vụ: bỏ `createdBy` hoặc `teamIds` khỏi projection thì các ca "người tạo/Manager nhóm chủ nhận nhắc" ĐỎ.
 */
const oid = () => new Types.ObjectId();
const NOW = new Date('2026-11-05T02:00:00.000Z');
const START_AT = new Date('2026-11-05T03:05:00.000Z');
const APPOINTMENT = oid();

interface FakeUser {
  _id: Types.ObjectId;
  fullName: string;
  roles: UserRole[];
  status: UserStatus;
  deletedAt: Date | null;
  teamId: Types.ObjectId | null;
  teamIds: Types.ObjectId[];
}

interface FakeTeam {
  _id: Types.ObjectId;
  managerIds: Types.ObjectId[];
  deletedAt: Date | null;
}

const user = (
  fullName: string,
  over: Partial<FakeUser> = {},
  role: UserRole = UserRole.STAFF,
): FakeUser => ({
  _id: oid(),
  fullName,
  roles: [role],
  status: UserStatus.ACTIVE,
  deletedAt: null,
  teamId: null,
  teamIds: [],
  ...over,
});

const team = (
  managers: FakeUser[],
  over: Partial<FakeTeam> = {},
): FakeTeam => ({
  _id: oid(),
  managerIds: managers.map((m) => m._id),
  deletedAt: null,
  ...over,
});

const chain = <T>(rows: T) => {
  const api: Record<string, jest.Mock> = {};
  for (const name of ['select', 'lean', 'session']) {
    api[name] = jest.fn(() => api);
  }
  api.exec = jest.fn(() => Promise.resolve(rows));
  return api;
};

type Filter = {
  _id?: Types.ObjectId | { $in: Types.ObjectId[] };
  status?: UserStatus;
  deletedAt?: null;
  roles?: UserRole;
};

/** Model `users` giả: lọc đúng các khóa dịch vụ dùng (`_id`, `status`, `deletedAt: null`, `roles`). */
const matchUsers = (users: FakeUser[], filter: Filter) => {
  const wanted = filter._id;
  const ids =
    wanted === undefined
      ? undefined
      : '$in' in wanted
        ? wanted.$in.map(String)
        : [String(wanted)];
  return users.filter(
    (u) =>
      (!ids || ids.includes(String(u._id))) &&
      (filter.status === undefined || u.status === filter.status) &&
      (filter.deletedAt === undefined || u.deletedAt === null) &&
      (filter.roles === undefined || u.roles.includes(filter.roles)),
  );
};

interface World {
  users: FakeUser[];
  teams?: FakeTeam[];
  /** Hồ sơ khách ĐỦ trường; kho giả chỉ trả các trường nằm trong projection thật của dịch vụ. */
  customer: Record<string, unknown> & { _id: Types.ObjectId };
  appointment: Record<string, unknown>;
}

const build = (world: World) => {
  const users = world.users;
  const teams = world.teams ?? [];
  const userModel = {
    find: jest.fn((filter: Filter) => chain(matchUsers(users, filter))),
    findOne: jest.fn((filter: Filter) =>
      chain(matchUsers(users, filter)[0] ?? null),
    ),
  };
  const teamModel = {
    find: jest.fn((filter: { _id: { $in: Types.ObjectId[] } }) =>
      chain(
        teams.filter(
          (t) =>
            filter._id.$in.some((id) => id.equals(t._id)) &&
            t.deletedAt === null,
        ),
      ),
    ),
  };
  const customers = {
    findForSystemJobById: jest.fn(
      (_id: Types.ObjectId, projection: string): Promise<unknown> => {
        const fields = projection.split(' ');
        const picked: Record<string, unknown> = { _id: world.customer._id };
        for (const field of fields) {
          if (field in world.customer) picked[field] = world.customer[field];
        }
        return Promise.resolve(picked);
      },
    ),
  };
  let appointment = world.appointment;
  const appointmentModel = {
    findOne: jest.fn(() => chain(appointment)),
  };
  const ownerTeam = new CustomerOwnerTeamService(
    userModel as never,
    teamModel as never,
  );
  const service = new ReminderDispatchService(
    {} as never,
    {} as never,
    appointmentModel as never,
    {} as never,
    {} as never,
    customers as never,
    { dispatch: jest.fn() } as never,
    userModel as never,
    ownerTeam,
  );
  return {
    service,
    userModel,
    teamModel,
    customers,
    setAppointment: (next: Record<string, unknown>) => {
      appointment = next;
    },
  };
};

const appointmentOf = (assignees: Partial<Record<string, unknown>>) => ({
  _id: APPOINTMENT,
  startAt: START_AT,
  type: AppointmentType.SITE_VISIT,
  status: 'SCHEDULED',
  ...assignees,
});

const customerOf = (
  over: Record<string, unknown> & { careTeam?: FakeUser[] },
  primary: FakeUser | null,
) => {
  const { careTeam = [], ...rest } = over;
  return {
    _id: oid(),
    fullName: 'Anh Minh',
    careTeam: careTeam.map((member) => ({ userId: member._id })),
    primaryAssigneeId: primary?._id ?? null,
    lastCareLogAt: null,
    createdBy: null,
    teamIds: [],
    ...rest,
  } as World['customer'];
};

const reminderFor = (customerId: Types.ObjectId) =>
  ({
    _id: oid(),
    type: ReminderType.APPOINTMENT,
    customerId,
    refId: APPOINTMENT,
    dueAt: START_AT,
    dedupeKey: 'REM:APPT:abc:1',
  }) as never;

interface TestDecision {
  action: string;
  notifications?: Array<{
    type: string;
    recipientIds: Types.ObjectId[];
    dedupeKey: string;
    inApp: { priority: string };
    data: { appointmentId?: Types.ObjectId };
  }>;
}

const evaluate = (
  service: ReminderDispatchService,
  customerId: Types.ObjectId,
): Promise<TestDecision> =>
  (
    service as unknown as {
      evaluate: (...args: unknown[]) => Promise<TestDecision>;
    }
  ).evaluate(reminderFor(customerId), NOW, {});

/** "người nhận:ưu tiên" đã sắp xếp, mỗi thông báo đúng MỘT người nhận. */
const received = (decision: TestDecision): string[] =>
  (decision.notifications ?? [])
    .map((n) => `${String(n.recipientIds[0])}:${n.inApp.priority}`)
    .sort();

const want = (...pairs: Array<[FakeUser, 'HIGH' | 'NORMAL']>): string[] =>
  pairs.map(([u, priority]) => `${String(u._id)}:${priority}`).sort();

describe('ReminderDispatchService.evaluate APPOINTMENT_DUE: người nhận = assigneeIds giao tập hợp lệ hiện tại (FR-33)', () => {
  describe('người thực hiện nằm trong careTeam', () => {
    it('Admin trong careTeam giao cho chính mình: nhận (đường dispatch không loại Admin); thành viên careTeam KHÔNG được chọn không nhận', async () => {
      const admin = user('Admin', {}, UserRole.ADMIN);
      const primary = user('Chính');
      const member = user('Thành viên');
      const customer = customerOf(
        { careTeam: [primary, admin, member] },
        primary,
      );
      const { service } = build({
        users: [admin, primary, member],
        customer,
        appointment: appointmentOf({
          assigneeIds: [admin._id],
          assigneeId: admin._id,
        }),
      });

      const decision = await evaluate(service, customer._id);

      expect(decision.action).toBe('SEND');
      expect(received(decision)).toEqual(want([admin, 'NORMAL']));
    });

    it('nhiều người thực hiện: mỗi người còn hợp lệ nhận đúng MỘT thông báo (khử trùng id lặp), PRIMARY được chọn nhận HIGH', async () => {
      const primary = user('Chính');
      const b = user('B');
      const c = user('C');
      const notChosen = user('Không chọn');
      const customer = customerOf(
        { careTeam: [primary, b, c, notChosen] },
        primary,
      );
      const { service } = build({
        users: [primary, b, c, notChosen],
        customer,
        appointment: appointmentOf({
          assigneeIds: [b._id, primary._id, b._id, c._id],
          assigneeId: b._id,
        }),
      });

      const decision = await evaluate(service, customer._id);

      expect(decision.notifications).toHaveLength(3);
      expect(received(decision)).toEqual(
        want([primary, 'HIGH'], [b, 'NORMAL'], [c, 'NORMAL']),
      );
      for (const n of decision.notifications ?? []) {
        expect(n).toMatchObject({
          type: 'APPOINTMENT_DUE',
          dedupeKey: 'REM:APPT:abc:1',
          data: { appointmentId: APPOINTMENT },
        });
      }
    });

    it('PRIMARY không được chọn thì không nhận (đổi so với trước: không còn gửi cả careTeam)', async () => {
      const primary = user('Chính');
      const b = user('B');
      const customer = customerOf({ careTeam: [primary, b] }, primary);
      const { service } = build({
        users: [primary, b],
        customer,
        appointment: appointmentOf({ assigneeIds: [b._id], assigneeId: b._id }),
      });

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([b, 'NORMAL']),
      );
    });

    it('tất cả người thực hiện đều trong careTeam: không đọc thêm teams/người tạo (không tốn truy vấn dựng tập)', async () => {
      const primary = user('Chính');
      const b = user('B');
      const customer = customerOf({ careTeam: [primary, b] }, primary);
      const { service, teamModel, userModel } = build({
        users: [primary, b],
        customer,
        appointment: appointmentOf({ assigneeIds: [b._id], assigneeId: b._id }),
      });

      await evaluate(service, customer._id);

      expect(teamModel.find).not.toHaveBeenCalled();
      expect(userModel.findOne).not.toHaveBeenCalled();
    });

    it('người thực hiện trong careTeam nhưng bị khóa hoặc đã xóa: không nhận; người còn lại vẫn nhận', async () => {
      const primary = user('Chính');
      const locked = user('Bị khóa', { status: UserStatus.BLOCKED });
      const deleted = user('Đã xóa', { deletedAt: new Date() });
      const customer = customerOf(
        { careTeam: [primary, locked, deleted] },
        primary,
      );
      const { service } = build({
        users: [primary, locked, deleted],
        customer,
        appointment: appointmentOf({
          assigneeIds: [primary._id, locked._id, deleted._id],
          assigneeId: primary._id,
        }),
      });

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([primary, 'HIGH']),
      );
    });
  });

  describe('người thực hiện NGOÀI careTeam nhưng thuộc tập hợp lệ', () => {
    it('Manager nhóm chủ ngoài careTeam được chọn thì nhận (NORMAL)', async () => {
      const manager = user('Quản lý nhóm chủ', {}, UserRole.MANAGER);
      const ownerTeam = team([manager]);
      const creator = user('Người tạo', {
        teamId: ownerTeam._id,
        teamIds: [ownerTeam._id],
      });
      const customer = customerOf(
        { careTeam: [creator], createdBy: creator._id },
        creator,
      );
      const { service } = build({
        users: [manager, creator],
        teams: [ownerTeam],
        customer,
        appointment: appointmentOf({
          assigneeIds: [manager._id],
          assigneeId: manager._id,
        }),
      });

      const decision = await evaluate(service, customer._id);

      expect(decision.action).toBe('SEND');
      expect(received(decision)).toEqual(want([manager, 'NORMAL']));
    });

    it.each([
      ['Admin', UserRole.ADMIN],
      ['Staff', UserRole.STAFF],
      ['Manager', UserRole.MANAGER],
    ])(
      'người tạo khách ngoài careTeam (%s; fixture dựng tay) được chọn thì nhận: cần createdBy trong CUSTOMER_PROJECTION thật',
      async (_label, role) => {
        const creator = user('Người tạo', {}, role);
        const primary = user('Chính');
        const customer = customerOf(
          { careTeam: [primary], createdBy: creator._id },
          primary,
        );
        const { service, customers } = build({
          users: [creator, primary],
          customer,
          appointment: appointmentOf({
            assigneeIds: [creator._id],
            assigneeId: creator._id,
          }),
        });

        const decision = await evaluate(service, customer._id);

        expect(decision.action).toBe('SEND');
        expect(received(decision)).toEqual(want([creator, 'NORMAL']));
        const projection = customers.findForSystemJobById.mock.calls[0][1];
        expect(projection.split(' ')).toEqual(
          expect.arrayContaining(['createdBy', 'teamIds', 'careTeam']),
        );
      },
    );

    it('người tạo khách vừa nằm trong careTeam vừa được chọn: nhận đúng MỘT thông báo (không nhân đôi giữa các nguồn)', async () => {
      const creator = user('Người tạo', {}, UserRole.ADMIN);
      const customer = customerOf(
        { careTeam: [creator], createdBy: creator._id },
        creator,
      );
      const { service } = build({
        users: [creator],
        customer,
        appointment: appointmentOf({
          assigneeIds: [creator._id],
          assigneeId: creator._id,
        }),
      });

      const decision = await evaluate(service, customer._id);

      expect(decision.notifications).toHaveLength(1);
      expect(received(decision)).toEqual(want([creator, 'HIGH']));
    });

    it('khách cũ thiếu createdBy: dự phòng customer.teamIds nên Manager của nhóm đó vẫn nhận (cần teamIds trong projection thật)', async () => {
      const manager = user('Quản lý', {}, UserRole.MANAGER);
      const legacyTeam = team([manager]);
      const primary = user('Chính');
      const customer = customerOf(
        { careTeam: [primary], createdBy: null, teamIds: [legacyTeam._id] },
        primary,
      );
      const { service } = build({
        users: [manager, primary],
        teams: [legacyTeam],
        customer,
        appointment: appointmentOf({
          assigneeIds: [manager._id],
          assigneeId: manager._id,
        }),
      });

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([manager, 'NORMAL']),
      );
    });

    it('hỗn hợp: careTeam + Manager nhóm chủ + người tạo cùng được chọn: cả ba nhận, người không được chọn thì không', async () => {
      const manager = user('Quản lý nhóm chủ', {}, UserRole.MANAGER);
      const ownerTeam = team([manager]);
      const creator = user(
        'Admin tạo',
        { teamId: ownerTeam._id, teamIds: [ownerTeam._id] },
        UserRole.ADMIN,
      );
      const primary = user('Chính');
      const notChosen = user('Không chọn');
      const customer = customerOf(
        { careTeam: [primary, notChosen], createdBy: creator._id },
        primary,
      );
      const { service } = build({
        users: [manager, creator, primary, notChosen],
        teams: [ownerTeam],
        customer,
        appointment: appointmentOf({
          assigneeIds: [primary._id, manager._id, creator._id],
          assigneeId: primary._id,
        }),
      });

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([primary, 'HIGH'], [manager, 'NORMAL'], [creator, 'NORMAL']),
      );
    });
  });

  describe('người thực hiện đã rơi khỏi tập hợp lệ hiện tại', () => {
    it('đã bị gỡ khỏi careTeam (không phải Manager nhóm chủ, không phải người tạo): không nhận dù còn tên trong assigneeIds; người còn hợp lệ vẫn nhận', async () => {
      const primary = user('Chính');
      const removed = user('Đã bị gỡ');
      const customer = customerOf({ careTeam: [primary] }, primary);
      const { service } = build({
        users: [primary, removed],
        customer,
        appointment: appointmentOf({
          assigneeIds: [removed._id, primary._id],
          assigneeId: removed._id,
        }),
      });

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([primary, 'HIGH']),
      );
    });

    it('Admin KHÁC ngoài careTeam và không phải người tạo (kể cả tự giao cho mình, dữ liệu dựng tay): không nhận', async () => {
      const outsideAdmin = user('Admin ngoài', {}, UserRole.ADMIN);
      const creator = user('Người tạo');
      const primary = user('Chính');
      const customer = customerOf(
        { careTeam: [primary], createdBy: creator._id },
        primary,
      );
      const { service } = build({
        users: [outsideAdmin, creator, primary],
        customer,
        appointment: appointmentOf({
          assigneeIds: [outsideAdmin._id, primary._id],
          assigneeId: outsideAdmin._id,
        }),
      });

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([primary, 'HIGH']),
      );
    });

    it('Manager nhóm KHÁC (không phải nhóm chủ), ngoài careTeam: không nhận', async () => {
      const otherManager = user('Quản lý nhóm khác', {}, UserRole.MANAGER);
      const otherTeam = team([otherManager]);
      const ownerManager = user('Quản lý nhóm chủ', {}, UserRole.MANAGER);
      const ownerTeam = team([ownerManager]);
      const creator = user('Người tạo', {
        teamId: ownerTeam._id,
        teamIds: [ownerTeam._id],
      });
      const customer = customerOf(
        { careTeam: [creator], createdBy: creator._id },
        creator,
      );
      const { service } = build({
        users: [otherManager, ownerManager, creator],
        teams: [otherTeam, ownerTeam],
        customer,
        appointment: appointmentOf({
          assigneeIds: [otherManager._id, ownerManager._id],
          assigneeId: otherManager._id,
        }),
      });

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([ownerManager, 'NORMAL']),
      );
    });

    it.each([
      ['bị khóa', { status: UserStatus.BLOCKED }],
      ['đã xóa mềm', { deletedAt: new Date() }],
    ])(
      'Manager nhóm chủ %s: không nhận',
      async (_label, over: Partial<FakeUser>) => {
        const manager = user('Quản lý nhóm chủ', over, UserRole.MANAGER);
        const ownerTeam = team([manager]);
        const creator = user('Người tạo', {
          teamId: ownerTeam._id,
          teamIds: [ownerTeam._id],
        });
        const customer = customerOf(
          { careTeam: [creator], createdBy: creator._id },
          creator,
        );
        const { service } = build({
          users: [manager, creator],
          teams: [ownerTeam],
          customer,
          appointment: appointmentOf({
            assigneeIds: [manager._id],
            assigneeId: manager._id,
          }),
        });

        await expect(evaluate(service, customer._id)).resolves.toEqual({
          action: 'CANCEL',
        });
      },
    );

    it('Manager nhóm chủ đã mất vai trò MANAGER (còn trong managerIds của team): không nhận', async () => {
      const demoted = user('Hết làm quản lý', {}, UserRole.STAFF);
      const ownerTeam = team([demoted]);
      const creator = user('Người tạo', {
        teamId: ownerTeam._id,
        teamIds: [ownerTeam._id],
      });
      const customer = customerOf(
        { careTeam: [creator], createdBy: creator._id },
        creator,
      );
      const { service } = build({
        users: [demoted, creator],
        teams: [ownerTeam],
        customer,
        appointment: appointmentOf({
          assigneeIds: [demoted._id],
          assigneeId: demoted._id,
        }),
      });

      await expect(evaluate(service, customer._id)).resolves.toEqual({
        action: 'CANCEL',
      });
    });

    it('nhóm chủ đã xóa mềm: Manager của nhóm đó không còn là ứng viên, không nhận', async () => {
      const manager = user('Quản lý', {}, UserRole.MANAGER);
      const deletedTeam = team([manager], { deletedAt: new Date() });
      const creator = user('Người tạo', {
        teamId: deletedTeam._id,
        teamIds: [deletedTeam._id],
      });
      const customer = customerOf(
        { careTeam: [creator], createdBy: creator._id },
        creator,
      );
      const { service } = build({
        users: [manager, creator],
        teams: [deletedTeam],
        customer,
        appointment: appointmentOf({
          assigneeIds: [manager._id],
          assigneeId: manager._id,
        }),
      });

      await expect(evaluate(service, customer._id)).resolves.toEqual({
        action: 'CANCEL',
      });
    });

    it.each([
      ['bị khóa', { status: UserStatus.BLOCKED }, UserRole.ADMIN],
      ['đã xóa mềm', { deletedAt: new Date() }, UserRole.STAFF],
    ])(
      'người tạo khách ngoài careTeam %s: không nhận',
      async (_label, over: Partial<FakeUser>, role) => {
        const creator = user('Người tạo', over, role);
        const primary = user('Chính');
        const customer = customerOf(
          { careTeam: [primary], createdBy: creator._id },
          primary,
        );
        const { service } = build({
          users: [creator, primary],
          customer,
          appointment: appointmentOf({
            assigneeIds: [creator._id],
            assigneeId: creator._id,
          }),
        });

        await expect(evaluate(service, customer._id)).resolves.toEqual({
          action: 'CANCEL',
        });
      },
    );

    it('người tạo khách chỉ có vai trò ngoài CRM (EDITOR), ngoài careTeam: không nhận', async () => {
      const creator = user('Biên tập', {}, UserRole.EDITOR);
      const primary = user('Chính');
      const customer = customerOf(
        { careTeam: [primary], createdBy: creator._id },
        primary,
      );
      const { service } = build({
        users: [creator, primary],
        customer,
        appointment: appointmentOf({
          assigneeIds: [creator._id],
          assigneeId: creator._id,
        }),
      });

      await expect(evaluate(service, customer._id)).resolves.toEqual({
        action: 'CANCEL',
      });
    });

    it('không còn ai trong tập (mọi người thực hiện đã rơi): HỦY, không dựng thông báo nào', async () => {
      const primary = user('Chính');
      const removed = user('Đã bị gỡ');
      const outsideAdmin = user('Admin ngoài', {}, UserRole.ADMIN);
      const customer = customerOf({ careTeam: [primary] }, primary);
      const { service } = build({
        users: [primary, removed, outsideAdmin],
        customer,
        appointment: appointmentOf({
          assigneeIds: [removed._id, outsideAdmin._id],
          assigneeId: removed._id,
        }),
      });

      await expect(evaluate(service, customer._id)).resolves.toEqual({
        action: 'CANCEL',
      });
    });
  });

  describe('lịch cũ chưa backfill và đổi người thực hiện', () => {
    it('lịch chưa có assigneeIds (chỉ assigneeId, ghi kép): người thực hiện nhận, thành viên khác thì không', async () => {
      const primary = user('Chính');
      const b = user('B');
      const customer = customerOf({ careTeam: [primary, b] }, primary);
      const { service } = build({
        users: [primary, b],
        customer,
        appointment: appointmentOf({ assigneeId: b._id }),
      });

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([b, 'NORMAL']),
      );
    });

    it('lịch cũ chưa backfill mà người thực hiện đã bị gỡ khỏi careTeam: HỦY', async () => {
      const primary = user('Chính');
      const removed = user('Đã bị gỡ');
      const customer = customerOf({ careTeam: [primary] }, primary);
      const { service } = build({
        users: [primary, removed],
        customer,
        appointment: appointmentOf({ assigneeId: removed._id }),
      });

      await expect(evaluate(service, customer._id)).resolves.toEqual({
        action: 'CANCEL',
      });
    });

    it('assigneeIds rỗng thật (không lùi về assigneeId): HỦY', async () => {
      const primary = user('Chính');
      const b = user('B');
      const customer = customerOf({ careTeam: [primary, b] }, primary);
      const { service } = build({
        users: [primary, b],
        customer,
        appointment: appointmentOf({ assigneeIds: [], assigneeId: b._id }),
      });

      await expect(evaluate(service, customer._id)).resolves.toEqual({
        action: 'CANCEL',
      });
    });

    it('đổi danh sách người thực hiện giữa hai lần đánh giá: người mới nhận, người cũ không (đọc lại lịch lúc gửi)', async () => {
      const primary = user('Chính');
      const oldOne = user('Người cũ');
      const newOne = user('Người mới');
      const customer = customerOf(
        { careTeam: [primary, oldOne, newOne] },
        primary,
      );
      const { service, setAppointment } = build({
        users: [primary, oldOne, newOne],
        customer,
        appointment: appointmentOf({
          assigneeIds: [oldOne._id],
          assigneeId: oldOne._id,
        }),
      });
      expect(received(await evaluate(service, customer._id))).toEqual(
        want([oldOne, 'NORMAL']),
      );

      setAppointment(
        appointmentOf({ assigneeIds: [newOne._id], assigneeId: newOne._id }),
      );

      expect(received(await evaluate(service, customer._id))).toEqual(
        want([newOne, 'NORMAL']),
      );
    });
  });
});
