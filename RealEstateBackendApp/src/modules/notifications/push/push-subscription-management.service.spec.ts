import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { PushSubscriptionManagementService } from './push-subscription-management.service';
import { PushRevokedReason } from './push-subscription.constants';

const USER_ID = new Types.ObjectId().toHexString();
const SUB_ID = new Types.ObjectId().toHexString();
const DAY_MS = 24 * 60 * 60 * 1000;

const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) });

type Filter = Record<string, unknown>;
type RevocationUpdate = {
  $set: { revokedAt: Date; purgeAt: Date; revokedReason: string };
};

const build = (opts: { enabled?: boolean; publicKey?: string } = {}) => {
  const rows: { active: unknown[]; revoked: unknown[] } = {
    active: [],
    revoked: [],
  };
  const finds: Filter[] = [];
  const model = {
    find: jest.fn((filter: Filter) => {
      finds.push(filter);
      const result = filter.revokedAt === null ? rows.active : rows.revoked;
      return {
        sort: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: () => Promise.resolve(result),
      };
    }),
    updateOne: jest.fn(() => exec({ matchedCount: 1, modifiedCount: 1 })),
    updateMany: jest.fn(() => exec({ modifiedCount: 2 })),
    exists: jest.fn(() => exec({ _id: 'x' })),
  };
  const config = {
    get: (key: string) =>
      key === 'VAPID_PUBLIC_KEY' ? opts.publicKey : undefined,
  } as unknown as ConfigService;
  const provider = { isEnabled: () => opts.enabled ?? true };
  const service = new PushSubscriptionManagementService(
    model as never,
    config,
    provider as never,
  );
  return { service, model, rows, finds };
};

const callOf = <T extends unknown[]>(mock: jest.Mock): T =>
  (mock.mock.calls as unknown[][])[0] as T;

describe('PushSubscriptionManagementService.getConfig (FR-07)', () => {
  it('bật và có khóa: enabled=true, trả publicKey đã trim', () => {
    const { service } = build({ enabled: true, publicKey: '  BKey  ' });
    expect(service.getConfig()).toEqual({ enabled: true, publicKey: 'BKey' });
  });

  it('nhà cung cấp tắt (cờ tắt hoặc thiếu VAPID): enabled=false và KHÔNG lộ publicKey', () => {
    const { service } = build({ enabled: false, publicKey: 'BKey' });
    expect(service.getConfig()).toEqual({ enabled: false, publicKey: null });
  });

  it('bật nhưng khóa rỗng hoặc thiếu: publicKey=null', () => {
    expect(
      build({ enabled: true, publicKey: '' }).service.getConfig().publicKey,
    ).toBeNull();
    expect(build({ enabled: true }).service.getConfig().publicKey).toBeNull();
  });
});

describe('PushSubscriptionManagementService.list (FR-05)', () => {
  it('lọc theo userId người gọi, revoked chỉ trong 7 ngày, không lộ endpoint/keys', async () => {
    const { service, rows, finds } = build();
    const id = new Types.ObjectId();
    const created = new Date('2026-01-01');
    const seen = new Date('2026-01-02');
    rows.active = [
      {
        _id: id,
        deviceLabel: 'Android · Chrome',
        platform: 'ANDROID',
        lastSeenAt: seen,
        createdAt: created,
        endpoint: 'https://secret',
        keys: { auth: 'x' },
      },
    ];
    const revokedAt = new Date('2026-01-03');
    rows.revoked = [
      {
        deviceLabel: 'iPhone · Safari',
        revokedReason: PushRevokedReason.LIMIT_EXCEEDED,
        revokedAt,
      },
    ];
    const before = Date.now();

    const result = await service.list(USER_ID);

    expect(result).toEqual({
      active: [
        {
          id: String(id),
          deviceLabel: 'Android · Chrome',
          platform: 'ANDROID',
          lastSeenAt: seen,
          createdAt: created,
        },
      ],
      recentlyRevoked: [
        { deviceLabel: 'iPhone · Safari', reason: 'LIMIT_EXCEEDED', revokedAt },
      ],
    });
    for (const filter of finds) {
      expect((filter.userId as Types.ObjectId).toHexString()).toBe(USER_ID);
    }
    const revokedFilter = finds.find((f) => f.revokedAt !== null)
      ?.revokedAt as { $ne: null; $gte: Date };
    expect(revokedFilter.$ne).toBeNull();
    expect(revokedFilter.$gte.getTime()).toBeGreaterThanOrEqual(
      before - 7 * DAY_MS,
    );
    expect(revokedFilter.$gte.getTime()).toBeLessThanOrEqual(
      Date.now() - 7 * DAY_MS,
    );
  });

  it('không có thiết bị: hai mảng rỗng', async () => {
    const { service } = build();
    await expect(service.list(USER_ID)).resolves.toEqual({
      active: [],
      recentlyRevoked: [],
    });
  });
});

describe('PushSubscriptionManagementService.revokeOwn (FR-05)', () => {
  it('thu hồi thiết bị của mình lý do USER, purgeAt = +7 ngày, lọc cả userId', async () => {
    const { service, model } = build();

    await service.revokeOwn(USER_ID, SUB_ID);

    const [filter, update] = callOf<[Filter, RevocationUpdate]>(
      model.updateOne,
    );
    expect((filter._id as Types.ObjectId).toHexString()).toBe(SUB_ID);
    expect((filter.userId as Types.ObjectId).toHexString()).toBe(USER_ID);
    expect(filter.revokedAt).toBeNull();
    expect(update.$set.revokedReason).toBe('USER');
    expect(
      update.$set.purgeAt.getTime() - update.$set.revokedAt.getTime(),
    ).toBe(7 * DAY_MS);
    expect(model.exists).not.toHaveBeenCalled();
  });

  it('idempotent: đã thu hồi từ trước (không khớp nhưng còn tồn tại) vẫn thành công', async () => {
    const { service, model } = build();
    model.updateOne.mockImplementation(() => exec({ matchedCount: 0 }));

    await expect(service.revokeOwn(USER_ID, SUB_ID)).resolves.toBeUndefined();
    expect(model.exists).toHaveBeenCalledTimes(1);
  });

  it('thiết bị của người khác hoặc không tồn tại: 404 RESOURCE_NOT_FOUND', async () => {
    const { service, model } = build();
    model.updateOne.mockImplementation(() => exec({ matchedCount: 0 }));
    model.exists.mockImplementation(() => exec(null));

    const error = (await service
      .revokeOwn(USER_ID, SUB_ID)
      .catch((e: unknown) => e)) as BusinessException;

    expect(error).toBeInstanceOf(BusinessException);
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({
      errorCode: ErrorCode.RESOURCE_NOT_FOUND,
    });
    const [existsFilter] = callOf<[Filter]>(model.exists);
    expect((existsFilter.userId as Types.ObjectId).toHexString()).toBe(USER_ID);
  });
});

describe('PushSubscriptionManagementService.revokeForLogout (T-28)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('id của chính mình: thu hồi lý do LOGOUT, lọc userId và còn hiệu lực, trả true', async () => {
    const { service, model } = build();

    await expect(service.revokeForLogout(USER_ID, SUB_ID)).resolves.toBe(true);

    const [filter, update] = callOf<[Filter, RevocationUpdate]>(
      model.updateOne,
    );
    expect((filter.userId as Types.ObjectId).toHexString()).toBe(USER_ID);
    expect((filter._id as Types.ObjectId).toHexString()).toBe(SUB_ID);
    expect(filter.revokedAt).toBeNull();
    expect(update.$set.revokedReason).toBe('LOGOUT');
  });

  it('id của người khác hoặc không tồn tại (không khớp): bỏ qua im lặng, trả false', async () => {
    const { service, model } = build();
    model.updateOne.mockImplementation(() =>
      exec({ matchedCount: 0, modifiedCount: 0 }),
    );

    await expect(service.revokeForLogout(USER_ID, SUB_ID)).resolves.toBe(false);
  });

  it.each([undefined, '', 'not-an-object-id'])(
    'id %s: không chạm DB, trả false',
    async (value) => {
      const { service, model } = build();
      await expect(service.revokeForLogout(USER_ID, value)).resolves.toBe(
        false,
      );
      expect(model.updateOne).not.toHaveBeenCalled();
    },
  );

  it('lỗi DB: nuốt lỗi để đăng xuất không hỏng, trả false', async () => {
    const { service, model } = build();
    model.updateOne.mockImplementation(() => ({
      exec: () => Promise.reject(new Error('db down')),
    }));

    await expect(service.revokeForLogout(USER_ID, SUB_ID)).resolves.toBe(false);
  });
});

describe('PushSubscriptionManagementService.revokeAllForUser (T-29)', () => {
  it('thu hồi mọi thiết bị còn hiệu lực của người đó với ACCOUNT_DISABLED, giữ session', async () => {
    const { service, model } = build();
    const session = { id: 's' } as never;

    await expect(
      service.revokeAllForUser(USER_ID, undefined, session),
    ).resolves.toBe(2);

    const [filter, update, options] = callOf<
      [Filter, RevocationUpdate, { session: unknown }]
    >(model.updateMany);
    expect((filter.userId as Types.ObjectId).toHexString()).toBe(USER_ID);
    expect(filter.revokedAt).toBeNull();
    expect(update.$set.revokedReason).toBe('ACCOUNT_DISABLED');
    expect(
      update.$set.purgeAt.getTime() - update.$set.revokedAt.getTime(),
    ).toBe(7 * DAY_MS);
    expect(options.session).toBe(session);
  });

  it('nhận ObjectId và lý do khác', async () => {
    const { service, model } = build();
    await service.revokeAllForUser(
      new Types.ObjectId(USER_ID),
      PushRevokedReason.GONE,
    );
    const [, update] = callOf<[unknown, RevocationUpdate]>(model.updateMany);
    expect(update.$set.revokedReason).toBe('GONE');
  });
});
