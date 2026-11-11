import { Types } from 'mongoose';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { AppointmentType } from '../appointments/appointment.constants';
import { ReminderType } from './reminder.constants';
import { ReminderDispatchService } from './reminder-dispatch.service';

/**
 * FR-18/19: MỌI loại nhắc (lịch hẹn, việc kế tiếp, khách lâu chưa chăm, dịp đặc biệt) gửi cho MỌI thành viên
 * `careTeam` ACTIVE (PRIMARY `HIGH`, MEMBER `NORMAL`), không phụ thuộc người thực hiện lịch/người ghi nhật ký.
 * Người bị khóa không nhận; không còn ai thì HỦY (không đánh dấu SENT khi Dispatcher sẽ loại hết).
 */
const oid = () => new Types.ObjectId();
const CUSTOMER = oid();
const PRIMARY = oid();
const MEMBER_A = oid();
const MEMBER_B = oid();
/** Người thực hiện lịch/ghi nhật ký đã rời nhóm: không nằm trong careTeam nên không được nhận. */
const OUTSIDER = oid();
const APPOINTMENT = oid();
const START_AT = new Date('2026-11-05T03:05:00.000Z');
const LAST_LOG_AT = new Date('2026-11-01T03:00:00.000Z');
const NOW = new Date('2026-11-05T02:00:00.000Z');

const chain = <T>(result: T) => {
  const query: Record<string, jest.Mock> = {};
  for (const name of ['select', 'lean', 'session']) {
    query[name] = jest.fn(() => query);
  }
  query.exec = jest.fn(() => Promise.resolve(result));
  return query;
};

interface Setup {
  customer: Record<string, unknown> | null;
  /** Id các tài khoản đang ACTIVE (đúng như truy vấn `users` lọc status/deletedAt trả về). */
  activeIds: Types.ObjectId[];
}

const build = ({ customer, activeIds }: Setup) => {
  const userModel = {
    find: jest.fn(() => chain(activeIds.map((_id) => ({ _id })))),
  };
  const appointmentModel = {
    findOne: jest.fn(() =>
      chain({
        _id: APPOINTMENT,
        startAt: START_AT,
        type: AppointmentType.SITE_VISIT,
        assigneeId: OUTSIDER,
      }),
    ),
  };
  const careLogModel = {
    findOne: jest.fn(() =>
      chain({
        _id: APPOINTMENT,
        authorId: OUTSIDER,
        occurredAt: LAST_LOG_AT,
        nextAction: { dueAt: START_AT },
      }),
    ),
  };
  const personaFieldModel = { findOne: jest.fn(() => chain(null)) };
  const customers = {
    findForSystemJobById: jest.fn().mockResolvedValue(customer),
  };
  const service = new ReminderDispatchService(
    {} as never,
    {} as never,
    appointmentModel as never,
    careLogModel as never,
    personaFieldModel as never,
    customers as never,
    { dispatch: jest.fn() } as never,
    userModel as never,
  );
  return { service, userModel };
};

const reminder = (type: ReminderType) =>
  ({
    _id: oid(),
    type,
    customerId: CUSTOMER,
    refId: APPOINTMENT,
    dueAt: START_AT,
    dedupeKey: 'REM:abc:1',
    payload: { leadDays: 0 },
  }) as never;

const customerOf = (
  team: Types.ObjectId[],
  primaryAssigneeId: Types.ObjectId | null,
) => ({
  _id: CUSTOMER,
  fullName: 'Anh Minh',
  careTeam: team.map((userId) => ({ userId })),
  primaryAssigneeId,
  lastCareLogAt: LAST_LOG_AT,
});

interface TestDecision {
  action: string;
  notifications?: Array<{
    recipientIds: Types.ObjectId[];
    inApp: { priority: string };
  }>;
}

// `evaluate` là private; gọi qua API công khai (`dispatchDue`) cần giả lập claim + transaction, đắt hơn nhiều.
const evaluate = (
  service: ReminderDispatchService,
  type: ReminderType,
): Promise<TestDecision> =>
  (
    service as unknown as {
      evaluate: (...args: unknown[]) => Promise<TestDecision>;
    }
  ).evaluate(reminder(type), NOW, {});

/** Danh sách "người nhận:ưu tiên" đã sắp xếp, để assert đúng cả người lẫn mức ưu tiên. */
const recipientPriorities = (decision: TestDecision) =>
  (decision.notifications ?? [])
    .map((n) => `${String(n.recipientIds[0])}:${n.inApp.priority}`)
    .sort();

const expected = (...pairs: Array<[Types.ObjectId, string]>) =>
  pairs.map(([id, priority]) => `${String(id)}:${priority}`).sort();

const TYPES = [
  ReminderType.APPOINTMENT,
  ReminderType.FOLLOW_UP,
  ReminderType.STALE_CUSTOMER,
  ReminderType.OCCASION,
];

describe('ReminderDispatchService: người nhận là mọi thành viên careTeam ACTIVE (FR-18/19)', () => {
  it('lọc người nhận bằng MỘT truy vấn users theo lô, đúng điều kiện ACTIVE + chưa xóa', async () => {
    const { service, userModel } = build({
      customer: customerOf([PRIMARY, MEMBER_A, MEMBER_B], PRIMARY),
      activeIds: [PRIMARY, MEMBER_A, MEMBER_B],
    });

    await evaluate(service, ReminderType.APPOINTMENT);

    expect(userModel.find).toHaveBeenCalledTimes(1);
    expect(userModel.find).toHaveBeenCalledWith({
      _id: { $in: [PRIMARY, MEMBER_A, MEMBER_B] },
      status: UserStatus.ACTIVE,
      deletedAt: null,
    });
  });

  describe.each(TYPES)('%s', (type) => {
    it('gửi cho mọi thành viên ACTIVE: PRIMARY HIGH, MEMBER NORMAL; người thực hiện/ghi nhật ký đã rời nhóm không nhận', async () => {
      const { service } = build({
        customer: customerOf([PRIMARY, MEMBER_A, MEMBER_B], PRIMARY),
        activeIds: [PRIMARY, MEMBER_A, MEMBER_B],
      });

      const decision = await evaluate(service, type);

      expect(decision.action).toBe('SEND');
      expect(recipientPriorities(decision)).toEqual(
        expected([PRIMARY, 'HIGH'], [MEMBER_A, 'NORMAL'], [MEMBER_B, 'NORMAL']),
      );
    });

    it('thành viên bị khóa không nhận, những người ACTIVE còn lại vẫn nhận', async () => {
      const { service } = build({
        customer: customerOf([PRIMARY, MEMBER_A, MEMBER_B], PRIMARY),
        activeIds: [PRIMARY, MEMBER_B],
      });

      const decision = await evaluate(service, type);

      expect(recipientPriorities(decision)).toEqual(
        expected([PRIMARY, 'HIGH'], [MEMBER_B, 'NORMAL']),
      );
    });

    it('PRIMARY bị khóa: MEMBER ACTIVE vẫn nhận, không ai nhận mức HIGH', async () => {
      const { service } = build({
        customer: customerOf([PRIMARY, MEMBER_A, MEMBER_B], PRIMARY),
        activeIds: [MEMBER_A, MEMBER_B],
      });

      const decision = await evaluate(service, type);

      expect(decision.action).toBe('SEND');
      expect(recipientPriorities(decision)).toEqual(
        expected([MEMBER_A, 'NORMAL'], [MEMBER_B, 'NORMAL']),
      );
    });

    it('PRIMARY null (careTeam chỉ có MEMBER): MEMBER nhận mức NORMAL', async () => {
      const { service } = build({
        customer: customerOf([MEMBER_A], null),
        activeIds: [MEMBER_A],
      });

      const decision = await evaluate(service, type);

      expect(decision.action).toBe('SEND');
      expect(recipientPriorities(decision)).toEqual(
        expected([MEMBER_A, 'NORMAL']),
      );
    });

    it('mọi thành viên đều bị khóa: HỦY (không đánh dấu SENT)', async () => {
      const { service } = build({
        customer: customerOf([PRIMARY, MEMBER_A], PRIMARY),
        activeIds: [],
      });

      await expect(evaluate(service, type)).resolves.toEqual({
        action: 'CANCEL',
      });
    });

    it('nhóm rỗng: HỦY và không truy vấn users', async () => {
      const { service, userModel } = build({
        customer: customerOf([], null),
        activeIds: [],
      });

      await expect(evaluate(service, type)).resolves.toEqual({
        action: 'CANCEL',
      });
      expect(userModel.find).not.toHaveBeenCalled();
    });

    it('ca biên 11 người (1 PRIMARY + 10 MEMBER): mỗi người đúng một thông báo, chỉ PRIMARY HIGH', async () => {
      const members = Array.from({ length: 10 }, () => oid());
      const { service } = build({
        customer: customerOf([PRIMARY, ...members], PRIMARY),
        activeIds: [PRIMARY, ...members],
      });

      const decision = await evaluate(service, type);

      expect(decision.action).toBe('SEND');
      expect(decision.notifications).toHaveLength(11);
      expect(recipientPriorities(decision)).toEqual(
        expected(
          [PRIMARY, 'HIGH'],
          ...members.map((id): [Types.ObjectId, string] => [id, 'NORMAL']),
        ),
      );
    });
  });

  it('khách không còn tồn tại: hủy, không truy vấn users', async () => {
    const { service, userModel } = build({ customer: null, activeIds: [] });

    await expect(evaluate(service, ReminderType.APPOINTMENT)).resolves.toEqual({
      action: 'CANCEL',
    });
    expect(userModel.find).not.toHaveBeenCalled();
  });
});
