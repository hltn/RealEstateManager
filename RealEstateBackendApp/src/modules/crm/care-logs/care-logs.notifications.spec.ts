import { Types } from 'mongoose';
import { NotificationType } from '../../notifications/notification.constants';
import { shouldSendPush } from '../../notifications/push/push-catalog';
import { CareLogsService } from './care-logs.service';

/** T-35: `notifyCareTeam` đi qua Dispatcher, giữ khóa gộp `CARE_LOG:{khách}:{bucket}`, gộp = 0 thì dùng `careLogId`. */
const oid = () => new Types.ObjectId();
const ACTOR = oid();
const OTHER_A = oid();
const OTHER_B = oid();
const CUSTOMER = oid();
const CARE_LOG = oid();

const build = (debounceMinutes: number) => {
  const dispatch = jest.fn().mockResolvedValue({ created: 0 });
  const args = Array.from({ length: 12 }, () => ({}));
  args[10] = { dispatch };
  args[11] = {
    get: jest
      .fn()
      .mockResolvedValue({ careLogNotifyDebounceMinutes: debounceMinutes }),
  };
  const service = new (CareLogsService as unknown as new (
    ...deps: unknown[]
  ) => CareLogsService)(...args);
  const notify = (careTeam: Array<{ userId: Types.ObjectId }>, now: Date) =>
    (service as any).notifyCareTeam(
      { actor: { userId: ACTOR, displayName: 'Lan' } },
      { _id: CUSTOMER, fullName: 'Anh Minh', careTeam },
      CARE_LOG,
      now,
      { id: 's' },
    ) as Promise<void>;
  return { dispatch, notify };
};

describe('CareLogsService.notifyCareTeam qua Dispatcher (T-35)', () => {
  const now = new Date('2026-11-05T03:00:00.000Z');

  it('gộp 5 phút: một yêu cầu cho mọi người cùng chăm sóc (trừ người ghi), dedupeKey theo bucket, vars actorName', async () => {
    const { dispatch, notify } = build(5);
    await notify(
      [{ userId: ACTOR }, { userId: OTHER_A }, { userId: OTHER_B }],
      now,
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [requests, session] = dispatch.mock.calls[0];
    expect(session).toEqual({ id: 's' });
    expect(requests).toHaveLength(1);
    const bucket = Math.floor(now.getTime() / (5 * 60 * 1000));
    expect(requests[0]).toMatchObject({
      type: NotificationType.CARE_LOG_ADDED,
      recipientIds: [OTHER_A, OTHER_B],
      inApp: {
        title: 'Ghi chú chăm sóc mới',
        body: 'Lan vừa ghi chú cho khách Anh Minh',
      },
      vars: { actorName: 'Lan', customerName: 'Anh Minh' },
      dedupeKey: `CARE_LOG:${String(CUSTOMER)}:${bucket}`,
    });
    expect(requests[0].data).toEqual({
      customerId: CUSTOMER,
      deepLink: `/crm/customers/${String(CUSTOMER)}`,
    });
    expect(shouldSendPush(requests[0].type, requests[0].context)).toBe(true);
  });

  it('hai ghi chú trong cùng khung gộp có cùng dedupeKey; khung sau thì khác', async () => {
    const { dispatch, notify } = build(5);
    await notify([{ userId: OTHER_A }], now);
    await notify([{ userId: OTHER_A }], new Date(now.getTime() + 60 * 1000));
    await notify([{ userId: OTHER_A }], new Date(now.getTime() + 10 * 60000));
    const keys = dispatch.mock.calls.map((call) => call[0][0].dedupeKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('gộp = 0 phút: khóa theo careLogId để mỗi ghi chú vẫn một thông báo', async () => {
    const { dispatch, notify } = build(0);
    await notify([{ userId: OTHER_A }], now);
    expect(dispatch.mock.calls[0][0][0].dedupeKey).toBe(
      `CARE_LOG:${String(CUSTOMER)}:${String(CARE_LOG)}`,
    );
  });

  it('người ghi là người duy nhất trong nhóm thì không gọi Dispatcher', async () => {
    const { dispatch, notify } = build(5);
    await notify([{ userId: ACTOR }], now);
    await notify([], now);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
