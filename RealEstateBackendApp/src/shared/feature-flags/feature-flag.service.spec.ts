import { ConfigService } from '@nestjs/config';
import { FeatureFlag, FeatureFlagService } from './feature-flag.service';

function createService(env: Record<string, unknown>) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new FeatureFlagService(config);
}

describe('FeatureFlagService', () => {
  it('mặc định tắt khi chưa cấu hình biến nào (kể cả FEATURE_CRM_PUSH)', () => {
    const service = createService({});

    expect(service.snapshot()).toEqual({
      CRM_ENABLED: false,
      CRM_PUSH: false,
      CRM_IMPORT: false,
      CRM_ATTACHMENTS: false,
    });
  });

  it.each(['true', 'TRUE', ' True ', '1', 'yes', 'on'])(
    'giá trị %p được hiểu là bật',
    (value) => {
      const service = createService({ FEATURE_CRM_ENABLED: value });
      expect(service.isEnabled(FeatureFlag.CRM_ENABLED)).toBe(true);
    },
  );

  it.each(['false', '0', 'no', 'off', '', 'abc', 'tru'])(
    'giá trị %p (sai/lạ/rỗng) được hiểu là tắt, không đoán bật',
    (value) => {
      const service = createService({ FEATURE_CRM_PUSH: value });
      expect(service.isEnabled(FeatureFlag.CRM_PUSH)).toBe(false);
    },
  );

  it('mỗi cờ độc lập: bật CRM_ENABLED không bật CRM_PUSH', () => {
    const service = createService({ FEATURE_CRM_ENABLED: 'true' });

    expect(service.isEnabled(FeatureFlag.CRM_ENABLED)).toBe(true);
    expect(service.isEnabled(FeatureFlag.CRM_PUSH)).toBe(false);
  });

  it('chấp nhận boolean thật (ConfigService có thể đã ép kiểu)', () => {
    const service = createService({ FEATURE_CRM_IMPORT: true });
    expect(service.isEnabled(FeatureFlag.CRM_IMPORT)).toBe(true);
  });
});
