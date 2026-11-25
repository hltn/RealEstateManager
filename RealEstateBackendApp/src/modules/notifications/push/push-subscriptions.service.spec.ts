import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import {
  EncryptedPayload,
  PiiCryptoService,
} from '../../crm/common/crypto/pii-crypto.service';
import { FeatureFlagService } from '../../../shared/feature-flags/feature-flag.service';
import { RegisterPushSubscriptionDto } from './dtos/push-subscription.dto';
import {
  buildPushAuthAad,
  computePushEndpointHash,
} from './push-endpoint.policy';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushRevokedReason } from './push-subscription.constants';

const P256DH = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.alloc(64, 7),
]).toString('base64url');
const AUTH = Buffer.alloc(16, 9).toString('base64url');
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';
const USER_ID = new Types.ObjectId().toHexString();
const KEY_HEX = 'ab'.repeat(32);

const dto = (
  overrides: Partial<RegisterPushSubscriptionDto> = {},
): RegisterPushSubscriptionDto => ({
  endpoint: ENDPOINT,
  keys: { p256dh: P256DH, auth: AUTH },
  ...overrides,
});

const savedDoc = (id = new Types.ObjectId()) => ({
  _id: id,
  deviceLabel: 'Android · Chrome',
  platform: 'ANDROID',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  lastSeenAt: new Date('2026-01-02T00:00:00Z'),
});

/** Model giả: ghi lại lời gọi, kết quả từng truy vấn do từng test đặt. */
const buildModel = () => {
  const model = {
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    updateMany: jest.fn(),
  };
  const execOf = (value: unknown) => ({ exec: () => value });
  model.findOneAndUpdate.mockImplementation(() =>
    execOf(
      Promise.resolve({
        value: savedDoc(),
        lastErrorObject: { updatedExisting: false },
      }),
    ),
  );
  const chain = (rows: unknown[]) => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: () => Promise.resolve(rows),
    };
    return query;
  };
  model.find.mockImplementation(() => chain([]));
  model.updateMany.mockImplementation(() => execOf(Promise.resolve({})));
  return { model, chain };
};

const buildService = (extraAllowlist?: string) => {
  const config = {
    get: (key: string) =>
      ({
        CRM_PII_ENCRYPTION_KEY: KEY_HEX,
        PUSH_ENDPOINT_HOST_ALLOWLIST: extraAllowlist,
      })[key],
  } as unknown as ConfigService;
  const crypto = new PiiCryptoService(config, {
    isEnabled: () => false,
  } as unknown as FeatureFlagService);
  const { model, chain } = buildModel();
  const service = new PushSubscriptionsService(model as never, crypto, config);
  return { service, model, chain, crypto };
};

describe('PushSubscriptionsService.register', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('FR-01: upsert theo endpoint, đặt lại thu hồi và làm tươi lastSeenAt', async () => {
    const { service, model } = buildService();
    const before = Date.now();

    await service.register(USER_ID, dto(), 'Mozilla/5.0 (Linux; Android 14)');

    const [filter, update, options] = model.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ endpoint: ENDPOINT });
    const set = update.$set;
    expect(set.userId.toHexString()).toBe(USER_ID);
    expect(set).toMatchObject({
      revokedAt: null,
      revokedReason: null,
      purgeAt: null,
      expirationTime: null,
      platform: 'ANDROID',
    });
    expect(set.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(options).toMatchObject({ upsert: true, returnDocument: 'after' });
  });

  it('FR-01: created=true khi chèn mới, false khi upsert bản đã có', async () => {
    const { service, model } = buildService();
    const created = await service.register(USER_ID, dto());
    expect(created.created).toBe(true);

    model.findOneAndUpdate.mockImplementation(() => ({
      exec: () =>
        Promise.resolve({
          value: savedDoc(),
          lastErrorObject: { updatedExisting: true },
        }),
    }));
    const refreshed = await service.register(USER_ID, dto());
    expect(refreshed.created).toBe(false);
  });

  it('FR-01: auth được mã hóa với AAD userId:endpointHash:push và giải mã lại đúng', async () => {
    const { service, model, crypto } = buildService();

    await service.register(USER_ID, dto());

    const set = model.findOneAndUpdate.mock.calls[0][1].$set;
    const authEnc = set.keys.authEnc as EncryptedPayload;
    const hash = computePushEndpointHash(ENDPOINT);
    expect(set.endpointHash).toBe(hash);
    expect(set.keys.p256dh).toBe(P256DH);
    expect(JSON.stringify(set.keys.authEnc)).not.toContain(AUTH);
    expect(crypto.decrypt(authEnc, buildPushAuthAad(USER_ID, hash))).toBe(AUTH);
    expect(() =>
      crypto.decrypt(
        authEnc,
        buildPushAuthAad(new Types.ObjectId().toHexString(), hash),
      ),
    ).toThrow();
  });

  it('FR-01: phản hồi và log không lộ endpoint, auth, p256dh', async () => {
    const { service } = buildService();

    const result = await service.register(USER_ID, dto());

    const serialized = JSON.stringify(result);
    const logged = JSON.stringify(logSpy.mock.calls);
    for (const secret of [ENDPOINT, 'device-1', AUTH, P256DH]) {
      expect(serialized).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(Object.keys(result.subscription).sort()).toEqual(
      [
        'createdAt',
        'deviceLabel',
        'displaced',
        'id',
        'lastSeenAt',
        'platform',
      ].sort(),
    );
  });

  it('FR-01: expirationTime số mili giây được lưu thành Date', async () => {
    const { service, model } = buildService();
    const expiresAt = Date.UTC(2027, 0, 1);

    await service.register(USER_ID, dto({ expirationTime: expiresAt }));

    expect(model.findOneAndUpdate.mock.calls[0][1].$set.expirationTime).toEqual(
      new Date(expiresAt),
    );
  });

  it('FR-01: đua hai yêu cầu cùng endpoint (E11000) thì thử lại một lần và thành công', async () => {
    const { service, model } = buildService();
    const duplicate = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
    });
    model.findOneAndUpdate
      .mockImplementationOnce(() => ({ exec: () => Promise.reject(duplicate) }))
      .mockImplementationOnce(() => ({
        exec: () =>
          Promise.resolve({
            value: savedDoc(),
            lastErrorObject: { updatedExisting: true },
          }),
      }));

    const result = await service.register(USER_ID, dto());

    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(false);
  });

  it('FR-01: E11000 lặp lại lần hai thì ném lỗi (không thử vô hạn)', async () => {
    const { service, model } = buildService();
    const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
    model.findOneAndUpdate.mockImplementation(() => ({
      exec: () => Promise.reject(duplicate),
    }));

    await expect(service.register(USER_ID, dto())).rejects.toBe(duplicate);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('FR-01: lỗi khác E11000 được ném ngay, không thử lại', async () => {
    const { service, model } = buildService();
    const boom = new Error('mất kết nối');
    model.findOneAndUpdate.mockImplementation(() => ({
      exec: () => Promise.reject(boom),
    }));

    await expect(service.register(USER_ID, dto())).rejects.toBe(boom);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('PushSubscriptionsService.register: kiểm đầu vào', () => {
  const expectInvalid = async (
    input: RegisterPushSubscriptionDto,
    extraAllowlist?: string,
  ) => {
    const { service, model } = buildService(extraAllowlist);
    const error = await service.register(USER_ID, input).catch((e) => e);
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).errorCode).toBe(
      ErrorCode.PUSH_SUBSCRIPTION_INVALID,
    );
    expect((error as BusinessException).getStatus()).toBe(400);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    return error as BusinessException;
  };

  it.each([
    'http://fcm.googleapis.com/fcm/send/x',
    'https://evil.example.com/x',
    'https://169.254.169.254/x',
    'https://fcm.googleapis.com@evil.com/x',
    `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
  ])(
    'FR-01: endpoint sai bị 400 PUSH_SUBSCRIPTION_INVALID, không ghi DB (%#)',
    async (endpoint) => {
      await expectInvalid(dto({ endpoint }));
    },
  );

  it('FR-01: lỗi endpoint không chứa URL trong thông điệp/chi tiết', async () => {
    const error = await expectInvalid(
      dto({ endpoint: 'https://evil.example.com/secret-capability' }),
    );
    expect(JSON.stringify(error.getResponse())).not.toContain(
      'secret-capability',
    );
  });

  it('FR-01: khóa p256dh hoặc auth sai độ dài bị 400 PUSH_SUBSCRIPTION_INVALID', async () => {
    await expectInvalid(dto({ keys: { p256dh: P256DH.slice(1), auth: AUTH } }));
    await expectInvalid(dto({ keys: { p256dh: P256DH, auth: AUTH + 'A' } }));
    await expectInvalid(
      dto({ keys: { p256dh: P256DH, auth: '!'.repeat(22) } }),
    );
  });

  it('FR-01: host bổ sung qua PUSH_ENDPOINT_HOST_ALLOWLIST được chấp nhận', async () => {
    const { service, model } = buildService('push.newvendor.example');
    await service.register(
      USER_ID,
      dto({ endpoint: 'https://push.newvendor.example/abc' }),
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('PushSubscriptionsService.enforceLimit (qua register)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  /** `minutesAgo` so với `lastSeenAt` của `savedDoc` (2026-01-02T00:00Z); số âm = mới hơn. */
  const row = (label: string, minutesAgo = 0) => ({
    _id: new Types.ObjectId(),
    deviceLabel: label,
    lastSeenAt: new Date(
      new Date('2026-01-02T00:00:00Z').getTime() - minutesAgo * 60_000,
    ),
  });

  /** Cho `findOneAndUpdate` trả đúng thiết bị vừa lưu có `_id` cho trước (để so với danh sách hiệu lực). */
  const saveAs = (
    model: ReturnType<typeof buildService>['model'],
    saved: { _id: Types.ObjectId },
  ) =>
    model.findOneAndUpdate.mockImplementation(() => ({
      exec: () =>
        Promise.resolve({
          value: savedDoc(saved._id),
          lastErrorObject: { updatedExisting: false },
        }),
    }));

  it('FR-01: đủ 3 thiết bị (cái mới + 2 cũ) thì không gỡ gì và displaced=null', async () => {
    const { service, model, chain } = buildService();
    const [fresh, a, b] = [row('Mới'), row('A', 1), row('B', 2)];
    saveAs(model, fresh);
    model.find.mockImplementation(() => chain([fresh, a, b]));

    const result = await service.register(USER_ID, dto());

    expect(model.updateMany).not.toHaveBeenCalled();
    expect(result.subscription.displaced).toBeNull();
  });

  it('FR-01: thiết bị thứ 4 thì gỡ cái ít hoạt động nhất (LIMIT_EXCEEDED, purgeAt = +7 ngày) và trả displaced', async () => {
    const { service, model, chain } = buildService();
    const [recent, middle, older, oldest] = [
      row('Mới'),
      row('Giữa', 1),
      row('Cũ', 2),
      row('Cũ nhất', 3),
    ];
    saveAs(model, recent);
    // find trả không theo thứ tự: service phải tự xếp theo lastSeenAt giảm dần.
    model.find.mockImplementation(() => chain([older, recent, oldest, middle]));

    const before = Date.now();
    const result = await service.register(USER_ID, dto());

    const [filter, update] = model.updateMany.mock.calls[0];
    expect(filter._id.$in).toEqual([oldest._id]);
    expect(filter.userId.toHexString()).toBe(USER_ID);
    expect(filter.revokedAt).toBeNull();
    expect(update.$set.revokedReason).toBe(PushRevokedReason.LIMIT_EXCEEDED);
    const retentionMs =
      update.$set.purgeAt.getTime() - update.$set.revokedAt.getTime();
    expect(retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(update.$set.revokedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.subscription.displaced).toEqual({
      id: String(oldest._id),
      deviceLabel: 'Cũ nhất',
    });
  });

  it('FR-01: truy vấn xét mọi thiết bị còn hiệu lực của chính người đăng ký (kể cả cái vừa lưu)', async () => {
    const { service, model, chain } = buildService();

    await service.register(USER_ID, dto());

    const [filter] = model.find.mock.calls[0];
    expect(filter.userId.toHexString()).toBe(USER_ID);
    expect(filter.revokedAt).toBeNull();
    expect(filter._id).toBeUndefined();
  });

  it('FR-01: thiết bị vừa lưu bị yêu cầu đồng thời vượt mặt thì vẫn bị gỡ nhưng không nằm trong displaced', async () => {
    const { service, model, chain } = buildService();
    const [n1, n2, n3, mine] = [
      row('1', -3),
      row('2', -2),
      row('3', -1),
      row('Của tôi'),
    ];
    saveAs(model, mine);
    model.find.mockImplementation(() => chain([n1, n2, n3, mine]));

    const result = await service.register(USER_ID, dto());

    expect(model.updateMany.mock.calls[0][0]._id.$in).toEqual([mine._id]);
    expect(result.subscription.displaced).toBeNull();
  });

  it('FR-01: thiết bị cũ có lastSeenAt tương lai quá ngưỡng lệch đồng hồ không đẩy thiết bị vừa lưu ra ngoài top 3', async () => {
    const { service, model, chain } = buildService();
    const [mine, f1, f2, f3] = [
      row('Của tôi'),
      row('Tương lai 1', -24 * 60),
      row('Tương lai 2', -24 * 60),
      row('Tương lai 3', -24 * 60),
    ];
    // `_id` của thiết bị vừa lưu phải mới hơn các thiết bị đã có (ObjectId tăng dần).
    const fresh = { ...mine, _id: new Types.ObjectId() };
    saveAs(model, fresh);
    model.find.mockImplementation(() => chain([f1, f2, f3, fresh]));

    const result = await service.register(USER_ID, dto());

    const revoked = model.updateMany.mock.calls[0][0]._id.$in;
    expect(revoked).toHaveLength(1);
    expect(revoked).not.toContainEqual(fresh._id);
    expect(result.subscription.displaced).not.toBeNull();
  });
});
