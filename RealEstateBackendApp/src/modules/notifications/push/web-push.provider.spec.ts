import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createECDH, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import https from 'https';
import * as webpush from 'web-push';
import { FeatureFlagService } from '../../../shared/feature-flags/feature-flag.service';
import { NotificationPushStatus } from '../notification.constants';
import { NoopPushProvider } from './noop-push.provider';
import { hashPushEndpoint } from './push-endpoint-hash.util';
import {
  PushPayload,
  PushSendOptions,
  PushSubscriptionTarget,
} from './push-provider.interface';
import {
  classifyPushStatus,
  WEB_PUSH_MAX_PAYLOAD_BYTES,
  WEB_PUSH_TIMEOUT_MS,
  WebPushProvider,
  WebPushSender,
  WebPushVapidConfig,
} from './web-push.provider';

const ENDPOINT =
  'https://fcm.googleapis.com/fcm/send/SECRET-ENDPOINT-TOKEN-123';

function buildSubscription(endpoint = ENDPOINT): PushSubscriptionTarget {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

const PAYLOAD: PushPayload = {
  title: 'Bạn được mời cùng phụ trách một khách',
  body: 'An đã thêm bạn vào nhóm chăm sóc khách Bình.',
  url: '/crm/customers/64b7f0f0f0f0f0f0f0f0f0f0',
  tag: '64b7f0f0f0f0f0f0f0f0f0f1',
  type: 'CUSTOMER_ASSIGNED',
};
const OPTIONS: PushSendOptions = {
  ttlSeconds: 3600,
  urgency: 'high',
  topic: 'abc123_-XYZ',
};

function buildFlags(enabled = true): FeatureFlagService {
  const config = {
    get: (key: string) =>
      key === 'FEATURE_CRM_PUSH' ? `${enabled}` : undefined,
  } as unknown as ConfigService;
  return new FeatureFlagService(config);
}

function httpError(statusCode: number, headers: Record<string, string> = {}) {
  return new webpush.WebPushError(
    'Received unexpected response code',
    statusCode,
    headers,
    'body-từ-dịch-vụ-push',
    ENDPOINT,
  );
}

describe('WebPushProvider', () => {
  const vapidKeys = webpush.generateVAPIDKeys();
  const vapid: WebPushVapidConfig = {
    subject: 'mailto:info@stnd.vn',
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
  };
  let sendNotification: jest.Mock;
  let provider: WebPushProvider;
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;
  let allLogs: () => string;

  beforeEach(() => {
    sendNotification = jest.fn();
    const sender: WebPushSender = { sendNotification };
    provider = new WebPushProvider(vapid, buildFlags(), sender);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    allLogs = () =>
      [...errorLog.mock.calls, ...warnLog.mock.calls]
        .map((args) => args.map(String).join(' '))
        .join('\n');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('ánh xạ kết quả (FR-02)', () => {
    it('FR-02: 201 thành công -> SENT', async () => {
      sendNotification.mockResolvedValue({
        statusCode: 201,
        body: '',
        headers: {},
      });

      await expect(
        provider.send(buildSubscription(), PAYLOAD, OPTIONS),
      ).resolves.toEqual({ outcome: 'SENT', statusCode: 201 });
    });

    it.each([404, 410])(
      'FR-02: %d -> GONE (thu hồi subscription)',
      async (code) => {
        sendNotification.mockRejectedValue(httpError(code));

        await expect(
          provider.send(buildSubscription(), PAYLOAD, OPTIONS),
        ).resolves.toEqual({ outcome: 'GONE', statusCode: code });
      },
    );

    it.each([400, 401, 403, 413])(
      'FR-02: %d -> PERMANENT (không retry)',
      async (code) => {
        sendNotification.mockRejectedValue(httpError(code));

        await expect(
          provider.send(buildSubscription(), PAYLOAD, OPTIONS),
        ).resolves.toEqual({ outcome: 'PERMANENT', statusCode: code });
      },
    );

    it.each([429, 500, 502, 503, 504])(
      'FR-02: %d -> TRANSIENT (BullMQ retry)',
      async (code) => {
        sendNotification.mockRejectedValue(httpError(code));

        await expect(
          provider.send(buildSubscription(), PAYLOAD, OPTIONS),
        ).resolves.toEqual({ outcome: 'TRANSIENT', statusCode: code });
      },
    );

    it('FR-02: lỗi mạng (ECONNRESET, ENOTFOUND, socket timeout của thư viện) -> TRANSIENT, không có statusCode', async () => {
      for (const message of [
        'read ECONNRESET',
        'getaddrinfo ENOTFOUND',
        'Socket timeout',
      ]) {
        sendNotification.mockRejectedValueOnce(new Error(message));

        await expect(
          provider.send(buildSubscription(), PAYLOAD, OPTIONS),
        ).resolves.toEqual({ outcome: 'TRANSIENT' });
      }
    });

    it('FR-02: ngoài bảng (3xx, 4xx khác) -> PERMANENT; 408 -> TRANSIENT; mọi 2xx -> SENT', () => {
      expect(classifyPushStatus(301)).toBe('PERMANENT');
      expect(classifyPushStatus(302)).toBe('PERMANENT');
      expect(classifyPushStatus(409)).toBe('PERMANENT');
      expect(classifyPushStatus(408)).toBe('TRANSIENT');
      expect(classifyPushStatus(200)).toBe('SENT');
      expect(classifyPushStatus(202)).toBe('SENT');
    });

    it('FR-02: không bao giờ ném lỗi ra ngoài, kể cả khi thư viện ném giá trị lạ', async () => {
      sendNotification.mockRejectedValue('chuỗi lạ');

      await expect(
        provider.send(buildSubscription(), PAYLOAD, OPTIONS),
      ).resolves.toEqual({ outcome: 'TRANSIENT' });
    });
  });

  describe('tùy chọn gửi (FR-02)', () => {
    it('FR-02: truyền timeout 5000, TTL, urgency, topic, VAPID theo lần gọi và payload JSON < 1 KB', async () => {
      sendNotification.mockResolvedValue({
        statusCode: 201,
        body: '',
        headers: {},
      });
      const subscription = buildSubscription();

      await provider.send(subscription, PAYLOAD, OPTIONS);

      const [target, body, requestOptions] = sendNotification.mock.calls[0] as [
        PushSubscriptionTarget,
        string,
        webpush.RequestOptions,
      ];
      expect(target).toEqual(subscription);
      expect(JSON.parse(body)).toEqual(PAYLOAD);
      expect(Buffer.byteLength(body)).toBeLessThan(WEB_PUSH_MAX_PAYLOAD_BYTES);
      expect(requestOptions).toEqual({
        vapidDetails: vapid,
        timeout: 5000,
        TTL: 3600,
        urgency: 'high',
        topic: 'abc123_-XYZ',
        contentEncoding: 'aes128gcm',
      });
      expect(WEB_PUSH_TIMEOUT_MS).toBe(5000);
    });

    it('FR-02: payload chỉ gồm 5 trường cố định, trường lạ bị loại', async () => {
      sendNotification.mockResolvedValue({
        statusCode: 201,
        body: '',
        headers: {},
      });
      const polluted = { ...PAYLOAD, phone: '0901234567' } as PushPayload;

      await provider.send(buildSubscription(), polluted, OPTIONS);

      const body = JSON.parse(
        sendNotification.mock.calls[0][1] as string,
      ) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        'body',
        'tag',
        'title',
        'type',
        'url',
      ]);
    });

    it('FR-02: topic sai định dạng (> 32 ký tự hoặc ký tự lạ) bị bỏ, vẫn gửi', async () => {
      sendNotification.mockResolvedValue({
        statusCode: 201,
        body: '',
        headers: {},
      });

      for (const topic of ['x'.repeat(33), 'có dấu!', '']) {
        await provider.send(buildSubscription(), PAYLOAD, {
          ...OPTIONS,
          topic,
        });
      }

      for (const call of sendNotification.mock.calls) {
        expect(call[2]).not.toHaveProperty('topic');
      }
      expect(sendNotification).toHaveBeenCalledTimes(3);
    });

    it('FR-02: TTL âm hoặc lẻ được chuẩn hóa về số nguyên >= 0', async () => {
      sendNotification.mockResolvedValue({
        statusCode: 201,
        body: '',
        headers: {},
      });

      await provider.send(buildSubscription(), PAYLOAD, {
        ...OPTIONS,
        ttlSeconds: -5,
      });
      await provider.send(buildSubscription(), PAYLOAD, {
        ...OPTIONS,
        ttlSeconds: 90.9,
      });

      expect(
        (sendNotification.mock.calls[0][2] as webpush.RequestOptions).TTL,
      ).toBe(0);
      expect(
        (sendNotification.mock.calls[1][2] as webpush.RequestOptions).TTL,
      ).toBe(90);
    });
  });

  describe('timeout 5 giây (FR-02)', () => {
    it('FR-02: dịch vụ push treo thì sau đúng 5 giây trả TRANSIENT (không chờ mãi)', async () => {
      jest.useFakeTimers();
      sendNotification.mockReturnValue(new Promise(() => undefined));

      const pending = provider.send(buildSubscription(), PAYLOAD, OPTIONS);
      await jest.advanceTimersByTimeAsync(WEB_PUSH_TIMEOUT_MS - 1);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ outcome: 'TRANSIENT' });
    });

    it('FR-02: gửi xong sớm thì hủy bộ đếm giờ (không giữ timer treo)', async () => {
      jest.useFakeTimers();
      sendNotification.mockResolvedValue({
        statusCode: 201,
        body: '',
        headers: {},
      });

      await provider.send(buildSubscription(), PAYLOAD, OPTIONS);

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('kiểm tra trước khi gửi (FR-02)', () => {
    it('FR-02: payload >= 1 KB -> PERMANENT, không gọi mạng', async () => {
      const huge = { ...PAYLOAD, body: 'a'.repeat(WEB_PUSH_MAX_PAYLOAD_BYTES) };

      await expect(
        provider.send(buildSubscription(), huge, OPTIONS),
      ).resolves.toEqual({
        outcome: 'PERMANENT',
      });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('FR-02: giới hạn tính theo byte UTF-8, không theo số ký tự', async () => {
      // Tiếng Việt có dấu: 3 byte/ký tự; 400 ký tự = 1200 byte > 1 KB dù chỉ 400 ký tự.
      const huge = { ...PAYLOAD, body: 'ệ'.repeat(400) };

      await expect(
        provider.send(buildSubscription(), huge, OPTIONS),
      ).resolves.toEqual({
        outcome: 'PERMANENT',
      });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['chuỗi', 'không-phải-object'],
      ['trường BigInt (JSON.stringify ném lỗi)', { ...PAYLOAD, title: 1n }],
    ])(
      'FR-02: payload %s -> PERMANENT, không ném lỗi, không gọi mạng',
      async (_name, payload) => {
        await expect(
          provider.send(
            buildSubscription(),
            payload as unknown as PushPayload,
            OPTIONS,
          ),
        ).resolves.toEqual({ outcome: 'PERMANENT' });
        expect(sendNotification).not.toHaveBeenCalled();
        expect(allLogs()).not.toContain('SECRET-ENDPOINT-TOKEN');
      },
    );

    it('FR-02: subscription undefined/null và options undefined cũng không bao giờ ném', async () => {
      for (const subscription of [undefined, null]) {
        await expect(
          provider.send(
            subscription as unknown as PushSubscriptionTarget,
            PAYLOAD,
            OPTIONS,
          ),
        ).resolves.toEqual({ outcome: 'PERMANENT' });
      }
      sendNotification.mockResolvedValue({ statusCode: 201 });
      await expect(
        provider.send(
          buildSubscription(),
          PAYLOAD,
          undefined as unknown as PushSendOptions,
        ),
      ).resolves.toEqual(
        expect.objectContaining({ outcome: expect.any(String) }),
      );
    });

    it.each([
      [
        'endpoint http (không phải https)',
        { ...buildSubscription(), endpoint: 'http://fcm.googleapis.com/x' },
      ],
      [
        'endpoint không phải URL',
        { ...buildSubscription(), endpoint: 'không-phải-url' },
      ],
      ['endpoint rỗng', { ...buildSubscription(), endpoint: '' }],
      [
        'thiếu khóa auth',
        { endpoint: ENDPOINT, keys: { p256dh: 'abc', auth: '' } },
      ],
      [
        'thiếu keys',
        { endpoint: ENDPOINT } as unknown as PushSubscriptionTarget,
      ],
    ])(
      'FR-02: %s -> PERMANENT, không gọi mạng',
      async (_name, subscription) => {
        await expect(
          provider.send(subscription, PAYLOAD, OPTIONS),
        ).resolves.toEqual({
          outcome: 'PERMANENT',
        });
        expect(sendNotification).not.toHaveBeenCalled();
      },
    );
  });

  describe('không theo redirect (FR-02)', () => {
    it('FR-02: dùng thư viện thật, endpoint trả 302 thì chỉ gọi đúng 1 request, kết quả PERMANENT', async () => {
      const requestSpy = jest.spyOn(https, 'request').mockImplementation(((
        _options: unknown,
        callback: (res: EventEmitter) => void,
      ) => {
        const req = Object.assign(new EventEmitter(), {
          write: jest.fn(),
          destroy: jest.fn(),
          end: () => {
            const res = Object.assign(new EventEmitter(), {
              statusCode: 302,
              headers: { location: 'https://evil.example.com/steal' },
            });
            callback(res);
            res.emit('data', '');
            res.emit('end');
          },
        });
        return req;
      }) as unknown as typeof https.request);
      const realProvider = new WebPushProvider(vapid, buildFlags(), webpush);

      const result = await realProvider.send(
        buildSubscription(),
        PAYLOAD,
        OPTIONS,
      );

      expect(result).toEqual({ outcome: 'PERMANENT', statusCode: 302 });
      expect(requestSpy).toHaveBeenCalledTimes(1);
      const [httpsOptions] = requestSpy.mock.calls[0] as unknown as [
        { hostname: string; timeout: number },
      ];
      expect(httpsOptions.hostname).toBe('fcm.googleapis.com');
      expect(httpsOptions.timeout).toBe(5000);
    });

    it('FR-02: dùng thư viện thật, 201 -> SENT và request mã hóa payload (body là Buffer, không phải JSON thô)', async () => {
      let written: Buffer | undefined;
      jest.spyOn(https, 'request').mockImplementation(((
        _options: unknown,
        callback: (res: EventEmitter) => void,
      ) => {
        const req = Object.assign(new EventEmitter(), {
          write: (chunk: Buffer) => (written = chunk),
          destroy: jest.fn(),
          end: () => {
            const res = Object.assign(new EventEmitter(), {
              statusCode: 201,
              headers: {},
            });
            callback(res);
            res.emit('end');
          },
        });
        return req;
      }) as unknown as typeof https.request);
      const realProvider = new WebPushProvider(vapid, buildFlags(), webpush);

      const result = await realProvider.send(
        buildSubscription(),
        PAYLOAD,
        OPTIONS,
      );

      expect(result).toEqual({ outcome: 'SENT', statusCode: 201 });
      expect(Buffer.isBuffer(written)).toBe(true);
      expect((written as Buffer).toString('utf8')).not.toContain(
        'Bạn được mời',
      );
    });
  });

  describe('log an toàn (FR-02, FR-07)', () => {
    it('FR-07: không log khóa riêng, endpoint đầy đủ, payload hay nội dung phản hồi (PERMANENT, TRANSIENT, lỗi mạng)', async () => {
      sendNotification
        .mockRejectedValueOnce(httpError(403))
        .mockRejectedValueOnce(httpError(503, { 'retry-after': '120' }))
        .mockRejectedValueOnce(new Error(`connect failed to ${ENDPOINT}`));
      const subscription = buildSubscription();

      await provider.send(subscription, PAYLOAD, OPTIONS);
      await provider.send(subscription, PAYLOAD, OPTIONS);
      await provider.send(subscription, PAYLOAD, OPTIONS);

      const logs = allLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs).not.toContain(vapid.privateKey);
      expect(logs).not.toContain('SECRET-ENDPOINT-TOKEN-123');
      expect(logs).not.toContain('fcm.googleapis.com');
      expect(logs).not.toContain(subscription.keys.p256dh);
      expect(logs).not.toContain(subscription.keys.auth);
      expect(logs).not.toContain('Bình');
      expect(logs).not.toContain('body-từ-dịch-vụ-push');
      expect(logs).toContain(hashPushEndpoint(ENDPOINT));
      expect(logs).toContain('Retry-After=120');
    });

    it('FR-07: PERMANENT log mức ERROR; TRANSIENT log mức WARN', async () => {
      sendNotification
        .mockRejectedValueOnce(httpError(401))
        .mockRejectedValueOnce(httpError(500));

      await provider.send(buildSubscription(), PAYLOAD, OPTIONS);
      expect(errorLog).toHaveBeenCalledTimes(1);
      await provider.send(buildSubscription(), PAYLOAD, OPTIONS);
      expect(warnLog).toHaveBeenCalledTimes(1);
    });

    it('FR-07: endpoint không hợp lệ cũng không bị log thô', async () => {
      const bad = {
        ...buildSubscription(),
        endpoint: 'http://secret-host.example/token-xyz',
      };

      await provider.send(bad, PAYLOAD, OPTIONS);

      expect(allLogs()).not.toContain('token-xyz');
      expect(allLogs()).not.toContain('secret-host');
    });
  });

  describe('cờ (FR-07)', () => {
    it('FR-07: isEnabled/initialStatus kiểm lại cờ mỗi lần gọi (cờ tắt giữa chừng -> SKIPPED)', () => {
      let flag = 'true';
      const flags = new FeatureFlagService({
        get: () => flag,
      } as unknown as ConfigService);
      const live = new WebPushProvider(vapid, flags);

      expect(live.isEnabled()).toBe(true);
      expect(live.initialStatus()).toBe(NotificationPushStatus.PENDING);
      flag = 'false';
      expect(live.isEnabled()).toBe(false);
      expect(live.initialStatus()).toBe(NotificationPushStatus.SKIPPED);
    });
  });
});

describe('NoopPushProvider.send', () => {
  it('FR-07: tắt, SKIPPED, và nếu lỡ bị gọi send thì trả PERMANENT thay vì ném lỗi', async () => {
    const noop = new NoopPushProvider();

    expect(noop.isEnabled()).toBe(false);
    expect(noop.initialStatus()).toBe(NotificationPushStatus.SKIPPED);
    await expect(noop.send()).resolves.toEqual({ outcome: 'PERMANENT' });
  });
});
