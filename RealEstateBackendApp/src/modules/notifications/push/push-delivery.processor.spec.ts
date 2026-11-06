import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { Types } from 'mongoose';
import { NotificationPushStatus } from '../notification.constants';
import * as renderer from './push-content.renderer';
import { PushRenderError } from './push-content.renderer';
import { PushDeliveryProcessor } from './push-delivery.processor';

jest.mock('./push-content.renderer', () => ({
  ...jest.requireActual('./push-content.renderer'),
  renderPushContent: jest.fn(),
}));
const renderMock = renderer.renderPushContent as unknown as jest.Mock;

/** Chuỗi gọi kiểu Mongoose (`select/sort/limit/lean/exec`) trả về giá trị cố định. */
const chain = (value: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const name of ['select', 'sort', 'limit', 'lean']) {
    c[name] = jest.fn(() => c);
  }
  c.exec = jest.fn().mockResolvedValue(value);
  return c;
};
const resolved = () => ({
  exec: jest.fn().mockResolvedValue({}),
});

const NOTIFICATION_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/SECRET-ENDPOINT-TOKEN';

const sub = (n: number) => ({
  _id: new Types.ObjectId(),
  userId: USER_ID,
  endpoint: `${ENDPOINT}-${n}`,
  endpointHash: `hash${n}`.padEnd(64, '0'),
  keys: { p256dh: 'p', authEnc: { cipherText: 'c' } },
});

interface Setup {
  flag?: boolean;
  notification?: Record<string, unknown> | null;
  user?: unknown;
  preference?: unknown;
  subscriptions?: ReturnType<typeof sub>[];
  claim?: (subscriptionId: Types.ObjectId) => unknown;
  sendResults?: Array<{ outcome: string; statusCode?: number }>;
  deliveries?: Array<{ status: string }>;
}

const defaultNotification = {
  _id: NOTIFICATION_ID,
  userId: USER_ID,
  type: 'CARE_LOG_ADDED',
  data: { deepLink: '/crm/customers/x' },
  push: { title: 'T', body: 'B', url: '/crm/customers/x' },
};

const build = (setup: Setup = {}) => {
  const subs = setup.subscriptions ?? [sub(1)];
  const notificationModel = {
    findOne: jest.fn(() =>
      chain(
        setup.notification === undefined
          ? defaultNotification
          : setup.notification,
      ),
    ),
    updateOne: jest.fn<ReturnType<typeof resolved>, unknown[]>(resolved),
  };
  const userModel = {
    findOne: jest.fn(() =>
      chain(setup.user === undefined ? { _id: USER_ID } : setup.user),
    ),
  };
  const preferenceModel = {
    findOne: jest.fn(() => chain(setup.preference ?? null)),
  };
  const subscriptionModel = {
    find: jest.fn(() => chain(subs)),
    updateOne: jest.fn<ReturnType<typeof resolved>, unknown[]>(resolved),
    updateMany: jest.fn<ReturnType<typeof resolved>, unknown[]>(resolved),
  };
  const deliveryModel = {
    findOneAndUpdate: jest.fn((filter: { subscriptionId: Types.ObjectId }) =>
      chain(
        setup.claim
          ? setup.claim(filter.subscriptionId)
          : { _id: new Types.ObjectId() },
      ),
    ),
    updateOne: jest.fn<ReturnType<typeof resolved>, unknown[]>(resolved),
    find: jest.fn(() => chain(setup.deliveries ?? [{ status: 'SENT' }])),
  };
  const results = [
    ...(setup.sendResults ?? [{ outcome: 'SENT', statusCode: 201 }]),
  ];
  const provider = {
    isEnabled: jest.fn(() => true),
    send: jest.fn<Promise<{ outcome: string; statusCode?: number }>, unknown[]>(
      () => Promise.resolve(results.shift() ?? { outcome: 'SENT' }),
    ),
  };
  const featureFlags = { isEnabled: jest.fn(() => setup.flag ?? true) };
  const crypto = { decrypt: jest.fn((): string => 'auth-secret') };
  const processor = new PushDeliveryProcessor(
    notificationModel as never,
    preferenceModel as never,
    subscriptionModel as never,
    deliveryModel as never,
    userModel as never,
    provider as never,
    featureFlags as never,
    crypto as never,
  );
  return {
    processor,
    notificationModel,
    subscriptionModel,
    deliveryModel,
    provider,
    crypto,
  };
};

const setOf = (update: unknown) =>
  (update as { $set: Record<string, unknown> }).$set;

const job = (attemptsMade = 0, attempts = 5) => ({
  data: { notificationId: String(NOTIFICATION_ID) },
  attemptsMade,
  opts: { attempts },
});

const settledStatus = (m: { notificationModel: { updateOne: jest.Mock } }) =>
  m.notificationModel.updateOne.mock.calls.map(
    (call) => (call[1] as { $set: { pushStatus: string } }).$set.pushStatus,
  );

describe('PushDeliveryProcessor (T-31)', () => {
  let logSpies: jest.SpyInstance[];
  const allLogs = () => logSpies.flatMap((s) => s.mock.calls.flat()).join('\n');

  beforeEach(() => {
    renderMock.mockReset();
    logSpies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(),
    ];
  });
  afterEach(() => jest.restoreAllMocks());

  it('notificationId sai: bỏ job, không chạm DB', async () => {
    const m = build();
    await m.processor.process({
      data: { notificationId: 'x' },
      attemptsMade: 0,
    });
    expect(m.notificationModel.findOne).not.toHaveBeenCalled();
  });

  it('(1) cờ tắt: SKIPPED có điều kiện PENDING, không gửi', async () => {
    const m = build({ flag: false });
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['SKIPPED']);
    expect(m.notificationModel.updateOne.mock.calls[0][0]).toMatchObject({
      pushStatus: NotificationPushStatus.PENDING,
    });
    expect(m.provider.send).not.toHaveBeenCalled();
  });

  it('(2) không còn PENDING: dừng, không gửi, không cập nhật', async () => {
    const m = build({ notification: null });
    await m.processor.process(job());
    expect(m.provider.send).not.toHaveBeenCalled();
    expect(m.notificationModel.updateOne).not.toHaveBeenCalled();
  });

  it('(3) người nhận bị khóa: SKIPPED và thu hồi ACCOUNT_DISABLED mọi thiết bị', async () => {
    const m = build({ user: null });
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['SKIPPED']);
    const [filter, update] = m.subscriptionModel.updateMany.mock.calls[0];
    expect(filter).toEqual({ userId: USER_ID, revokedAt: null });
    expect(setOf(update).revokedReason).toBe('ACCOUNT_DISABLED');
    expect(m.provider.send).not.toHaveBeenCalled();
  });

  it('(4) tắt push của loại: SKIPPED', async () => {
    const m = build({
      preference: { types: { CARE_LOG_ADDED: { push: false, inApp: true } } },
    });
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['SKIPPED']);
    expect(m.provider.send).not.toHaveBeenCalled();
  });

  it('(5) trong giờ yên lặng: SKIPPED; ngoài khung thì gửi', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T16:00:00Z') }); // 23:00 giờ VN
    try {
      const quiet = build({
        preference: { types: {}, quietHours: { start: '22:00', end: '06:00' } },
      });
      await quiet.processor.process(job());
      expect(settledStatus(quiet)).toEqual(['SKIPPED']);
      expect(quiet.provider.send).not.toHaveBeenCalled();

      const open = build({
        preference: { types: {}, quietHours: { start: '01:00', end: '05:00' } },
      });
      await open.processor.process(job());
      expect(open.provider.send).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('(6) không có thiết bị hiệu lực: SKIPPED', async () => {
    const m = build({ subscriptions: [] });
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['SKIPPED']);
  });

  it('(7)(8) gửi thành công: payload/tùy chọn đúng, thông báo SENT + pushSentAt', async () => {
    const m = build();
    await m.processor.process(job());
    expect(m.provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ keys: { p256dh: 'p', auth: 'auth-secret' } }),
      {
        title: 'T',
        body: 'B',
        url: '/crm/customers/x',
        tag: String(NOTIFICATION_ID),
        type: 'CARE_LOG_ADDED',
      },
      { ttlSeconds: 86400, urgency: 'normal', topic: String(NOTIFICATION_ID) },
    );
    expect(settledStatus(m)).toEqual(['SENT']);
    expect(
      setOf(m.notificationModel.updateOne.mock.calls[0][1]).pushSentAt,
    ).toBeInstanceOf(Date);
  });

  it('thiết bị đã xong (claim null): không gửi lại, vẫn tổng hợp từ sổ', async () => {
    const m = build({ claim: () => null, deliveries: [{ status: 'SENT' }] });
    await m.processor.process(job());
    expect(m.provider.send).not.toHaveBeenCalled();
    expect(settledStatus(m)).toEqual(['SENT']);
  });

  it('E11000 khi claim: coi như đã xong, không gửi', async () => {
    const m = build();
    m.deliveryModel.findOneAndUpdate.mockImplementation(() => {
      const c = chain(null);
      c.exec.mockRejectedValue({ code: 11000 });
      return c;
    });
    m.deliveryModel.find.mockImplementation(() =>
      chain([{ status: 'SENDING' }]),
    );
    // Hàng của worker khác còn SENDING, chưa hết lần: không chốt, ném lỗi thường để retry.
    const error = await m.processor.process(job(0)).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toContain('PUSH_TRANSIENT');
    expect(m.provider.send).not.toHaveBeenCalled();
    expect(m.notificationModel.updateOne).not.toHaveBeenCalled();
  });

  it('E11000 + hàng SENDING của worker khác ở lần cuối: chốt FAILED (giữ hành vi), không ném', async () => {
    const m = build();
    m.deliveryModel.findOneAndUpdate.mockImplementation(() => {
      const c = chain(null);
      c.exec.mockRejectedValue({ code: 11000 });
      return c;
    });
    m.deliveryModel.find.mockImplementation(() =>
      chain([{ status: 'SENDING' }]),
    );
    await m.processor.process(job(4, 5));
    expect(settledStatus(m)).toEqual(['FAILED']);
  });

  it('lỗi claim khác E11000 nổi lên', async () => {
    const m = build();
    m.deliveryModel.findOneAndUpdate.mockImplementation(() => {
      const c = chain(null);
      c.exec.mockRejectedValue(new Error('db'));
      return c;
    });
    await expect(m.processor.process(job())).rejects.toThrow('db');
  });

  it('GONE: thu hồi đúng thiết bị đó; thiết bị còn lại vẫn nhận; kết quả SENT', async () => {
    const subs = [sub(1), sub(2)];
    const m = build({
      subscriptions: subs,
      sendResults: [{ outcome: 'GONE', statusCode: 410 }, { outcome: 'SENT' }],
      deliveries: [{ status: 'GONE' }, { status: 'SENT' }],
    });
    await m.processor.process(job());
    expect(m.provider.send).toHaveBeenCalledTimes(2);
    const revoke = m.subscriptionModel.updateOne.mock.calls.find(
      (call) => setOf(call[1]).revokedReason === 'GONE',
    );
    expect(revoke?.[0]).toEqual({ _id: subs[0]._id, revokedAt: null });
    expect(settledStatus(m)).toEqual(['SENT']);
  });

  it('tất cả GONE: SKIPPED', async () => {
    const m = build({
      sendResults: [{ outcome: 'GONE', statusCode: 404 }],
      deliveries: [{ status: 'GONE' }],
    });
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['SKIPPED']);
  });

  it('PERMANENT: thông báo FAILED, không ném, log ERROR chỉ có mã', async () => {
    const m = build({
      sendResults: [{ outcome: 'PERMANENT', statusCode: 403 }],
      deliveries: [{ status: 'FAILED' }],
    });
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['FAILED']);
    expect(allLogs()).toContain('result=PERMANENT code=403');
  });

  it('TRANSIENT chưa hết lần: ném lỗi thường (retry), thông báo vẫn PENDING', async () => {
    const m = build({
      sendResults: [{ outcome: 'TRANSIENT', statusCode: 503 }],
    });
    const error = await m.processor.process(job(0)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toContain('PUSH_TRANSIENT');
    expect(m.notificationModel.updateOne).not.toHaveBeenCalled();
  });

  it('TRANSIENT ở lần thứ 5 (hết lần): FAILED có điều kiện PENDING, ném UnrecoverableError', async () => {
    const m = build({
      sendResults: [{ outcome: 'TRANSIENT' }],
      deliveries: [{ status: 'SENDING' }],
    });
    await expect(m.processor.process(job(4, 5))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(settledStatus(m)).toEqual(['FAILED']);
    expect(m.notificationModel.updateOne.mock.calls[0][0]).toMatchObject({
      pushStatus: 'PENDING',
    });
  });

  it('auth không giải mã được: FAILED, không gọi send, log không chứa nội dung lỗi', async () => {
    const m = build({ deliveries: [{ status: 'FAILED' }] });
    m.crypto.decrypt.mockImplementation(() => {
      throw new Error('SECRET-DETAIL');
    });
    await m.processor.process(job());
    expect(m.provider.send).not.toHaveBeenCalled();
    expect(settledStatus(m)).toEqual(['FAILED']);
    expect(allLogs()).not.toContain('SECRET-DETAIL');
  });

  it('PushRenderError: UnrecoverableError, FAILED có điều kiện PENDING, không gửi, log ERROR không PII', async () => {
    const m = build({
      notification: { ...defaultNotification, data: {}, push: null },
    });
    renderMock.mockImplementation(() => {
      throw new PushRenderError('biến lạ: Nguyễn Văn A 0901234567');
    });
    await expect(m.processor.process(job(0, 5))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(settledStatus(m)).toEqual(['FAILED']);
    expect(m.notificationModel.updateOne.mock.calls[0][0]).toMatchObject({
      pushStatus: 'PENDING',
    });
    expect(m.provider.send).not.toHaveBeenCalled();
    expect(allLogs()).toContain(`notificationId=${String(NOTIFICATION_ID)}`);
    expect(allLogs()).not.toContain('Nguyễn');
    expect(allLogs()).not.toContain('0901234567');
  });

  it('push chưa dựng sẵn (dữ liệu cũ): dựng lại bằng renderer rồi gửi', async () => {
    const m = build({
      notification: {
        ...defaultNotification,
        data: {
          customerId: new Types.ObjectId(),
          deepLink: '/crm/customers/a',
        },
        push: null,
      },
    });
    renderMock.mockReturnValue({
      title: 'RT',
      body: 'RB',
      url: '/',
      type: 'CARE_LOG_ADDED',
      usedFallback: true,
    });
    await m.processor.process(job());
    expect(m.provider.send.mock.calls[0][1]).toMatchObject({
      title: 'RT',
      body: 'RB',
    });
  });

  it('hai thiết bị: A đã SENT, B luôn TRANSIENT, lần cuối: UnrecoverableError, thông báo SENT + pushSentAt', async () => {
    const m = build({
      subscriptions: [sub(1), sub(2)],
      sendResults: [
        { outcome: 'SENT' },
        { outcome: 'TRANSIENT', statusCode: 503 },
      ],
      deliveries: [{ status: 'SENT' }, { status: 'SENDING' }],
    });
    await expect(m.processor.process(job(4, 5))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(settledStatus(m)).toEqual(['SENT']);
    expect(
      setOf(m.notificationModel.updateOne.mock.calls[0][1]).pushSentAt,
    ).toBeInstanceOf(Date);
  });

  it('provider.send ném lỗi: thông báo FAILED, log PROVIDER_ERROR không kèm nội dung lỗi', async () => {
    const m = build({ deliveries: [{ status: 'FAILED' }] });
    m.provider.send.mockRejectedValue(new Error('SECRET-SEND-DETAIL'));
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['FAILED']);
    expect(allLogs()).toContain('PROVIDER_ERROR');
    expect(allLogs()).not.toContain('SECRET-SEND-DETAIL');
  });

  it('provider.isEnabled() false (cờ vẫn bật): SKIPPED, không gửi', async () => {
    const m = build();
    m.provider.isEnabled.mockReturnValue(false);
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['SKIPPED']);
    expect(m.provider.send).not.toHaveBeenCalled();
  });

  it('hỗn hợp PERMANENT + GONE: FAILED (không SKIPPED)', async () => {
    const m = build({
      subscriptions: [sub(1), sub(2)],
      sendResults: [
        { outcome: 'PERMANENT', statusCode: 400 },
        { outcome: 'GONE', statusCode: 410 },
      ],
      deliveries: [{ status: 'FAILED' }, { status: 'GONE' }],
    });
    await m.processor.process(job());
    expect(settledStatus(m)).toEqual(['FAILED']);
  });

  it('log chỉ có notificationId, subscriptionId, endpointHash rút gọn, mã kết quả; không endpoint/payload', async () => {
    const m = build();
    await m.processor.process(job());
    const all = allLogs();
    expect(all).toContain('endpointHash=hash1');
    expect(all).toContain('result=SENT');
    expect(all).not.toContain('SECRET-ENDPOINT-TOKEN');
    expect(all).not.toContain('fcm.googleapis.com');
    expect(all).not.toContain('auth-secret');
  });
});
