import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { FeatureFlagService } from '../../../shared/feature-flags/feature-flag.service';
import { NoopPushProvider } from './noop-push.provider';
import { createPushProvider } from './push-provider.factory';
import { WebPushProvider } from './web-push.provider';

const keys = webpush.generateVAPIDKeys();

function build(env: Record<string, string | undefined>) {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const logger = { error: jest.fn(), log: jest.fn() };
  const provider = createPushProvider(
    config,
    new FeatureFlagService(config),
    logger,
  );
  return { provider, logger };
}

const FULL_ENV = {
  FEATURE_CRM_PUSH: 'true',
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: 'mailto:info@stnd.vn',
};

describe('createPushProvider (factory PUSH_PROVIDER)', () => {
  it('FR-07: cờ bật và đủ VAPID_* hợp lệ -> WebPushProvider, không log lỗi', () => {
    const { provider, logger } = build(FULL_ENV);

    expect(provider).toBeInstanceOf(WebPushProvider);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('FR-07: VAPID_SUBJECT dạng https: cũng hợp lệ', () => {
    const { provider } = build({
      ...FULL_ENV,
      VAPID_SUBJECT: 'https://stnd.vn/lien-he',
    });

    expect(provider).toBeInstanceOf(WebPushProvider);
  });

  it('FR-07: cờ tắt -> Noop, im lặng (không log lỗi dù thiếu biến)', () => {
    const { provider, logger } = build({ FEATURE_CRM_PUSH: 'false' });

    expect(provider).toBeInstanceOf(NoopPushProvider);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('FR-07: chưa cấu hình gì -> Noop, im lặng', () => {
    const { provider, logger } = build({});

    expect(provider).toBeInstanceOf(NoopPushProvider);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'])(
    'FR-07: cờ bật nhưng thiếu %s -> Noop và log ERROR đúng một lần nêu tên biến, không sập',
    (missing) => {
      const { provider, logger } = build({ ...FULL_ENV, [missing]: undefined });

      expect(provider).toBeInstanceOf(NoopPushProvider);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0][0]).toContain(missing);
    },
  );

  it('FR-07: biến rỗng hoặc chỉ khoảng trắng coi như thiếu', () => {
    const { provider, logger } = build({
      ...FULL_ENV,
      VAPID_PRIVATE_KEY: '   ',
    });

    expect(provider).toBeInstanceOf(NoopPushProvider);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['VAPID_SUBJECT', 'info@stnd.vn'],
    ['VAPID_SUBJECT', 'http://stnd.vn'],
    ['VAPID_PUBLIC_KEY', 'khong-phai-khoa'],
    ['VAPID_PRIVATE_KEY', keys.publicKey],
  ])(
    'FR-07: %s sai định dạng (%s) -> Noop và log ERROR nêu tên biến',
    (name, value) => {
      const { provider, logger } = build({ ...FULL_ENV, [name]: value });

      expect(provider).toBeInstanceOf(NoopPushProvider);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0][0]).toContain(name);
    },
  );

  it('FR-07: log ERROR không chứa giá trị khóa riêng (kể cả khi khóa sai định dạng)', () => {
    const { logger } = build({
      ...FULL_ENV,
      VAPID_PUBLIC_KEY: undefined,
      VAPID_PRIVATE_KEY: 'BI-MAT-KHONG-DUOC-LOG',
    });

    const message = logger.error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).not.toContain('BI-MAT-KHONG-DUOC-LOG');
    expect(message).not.toContain(keys.privateKey);
  });
});
