import { ConfigService } from '@nestjs/config';
import { FeatureFlag, FeatureFlagService } from './feature-flag.service';

function createService(env: Record<string, unknown>) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new FeatureFlagService(config);
}

describe('FeatureFlagService', () => {
  it('giá trị enum chính là tên biến môi trường mới (FR-18, không còn tiền tố FEATURE_)', () => {
    expect(FeatureFlag.CRM_ENABLED).toBe('CRM_ENABLED');
    expect(FeatureFlag.CRM_ATTACHMENTS).toBe('CRM_ATTACHMENTS_ENABLED');
    expect(FeatureFlag.CRM_PUSH).toBe('CRM_PUSH_ENABLED');
    expect(FeatureFlag.CRM_IMPORT).toBe('CRM_IMPORT_ENABLED');
  });

  it('mặc định tắt khi chưa cấu hình biến nào (kể cả CRM_PUSH_ENABLED)', () => {
    const service = createService({});

    expect(service.snapshot()).toEqual({
      CRM_ENABLED: false,
      CRM_PUSH_ENABLED: false,
      CRM_IMPORT_ENABLED: false,
      CRM_ATTACHMENTS_ENABLED: false,
    });
  });

  it.each([
    [FeatureFlag.CRM_ENABLED, 'CRM_ENABLED'],
    [FeatureFlag.CRM_ATTACHMENTS, 'CRM_ATTACHMENTS_ENABLED'],
    [FeatureFlag.CRM_PUSH, 'CRM_PUSH_ENABLED'],
    [FeatureFlag.CRM_IMPORT, 'CRM_IMPORT_ENABLED'],
  ])('cờ %s đọc đúng biến %s', (flag, envName) => {
    expect(createService({ [envName]: 'true' }).isEnabled(flag)).toBe(true);
    expect(createService({ [envName]: 'false' }).isEnabled(flag)).toBe(false);
    expect(createService({}).isEnabled(flag)).toBe(false);
  });

  it.each(['true', 'TRUE', ' True ', '1', 'yes', 'on'])(
    'giá trị %p được hiểu là bật',
    (value) => {
      const service = createService({ CRM_ENABLED: value });
      expect(service.isEnabled(FeatureFlag.CRM_ENABLED)).toBe(true);
    },
  );

  it.each(['false', '0', 'no', 'off', '', 'abc', 'tru'])(
    'giá trị %p (sai/lạ/rỗng) được hiểu là tắt, không đoán bật',
    (value) => {
      const service = createService({ CRM_PUSH_ENABLED: value });
      expect(service.isEnabled(FeatureFlag.CRM_PUSH)).toBe(false);
    },
  );

  it('tên cũ FEATURE_CRM_* KHÔNG còn được đọc (không cầu nối tương thích)', () => {
    const service = createService({
      FEATURE_CRM_ENABLED: 'true',
      FEATURE_CRM_ATTACHMENTS: 'true',
      FEATURE_CRM_PUSH: 'true',
      FEATURE_CRM_IMPORT: 'true',
    });

    expect(Object.values(service.snapshot()).every((on) => !on)).toBe(true);
  });

  it('mỗi cờ độc lập: bật CRM_ENABLED không bật CRM_PUSH_ENABLED', () => {
    const service = createService({ CRM_ENABLED: 'true' });

    expect(service.isEnabled(FeatureFlag.CRM_ENABLED)).toBe(true);
    expect(service.isEnabled(FeatureFlag.CRM_PUSH)).toBe(false);
  });

  it('chấp nhận boolean thật (ConfigService có thể đã ép kiểu)', () => {
    const service = createService({ CRM_IMPORT_ENABLED: true });
    expect(service.isEnabled(FeatureFlag.CRM_IMPORT)).toBe(true);
  });

  it('snapshot phản ánh đúng từng cờ đang bật', () => {
    const service = createService({
      CRM_ENABLED: '1',
      CRM_ATTACHMENTS_ENABLED: 'on',
      CRM_PUSH_ENABLED: '',
    });

    expect(service.snapshot()).toEqual({
      CRM_ENABLED: true,
      CRM_ATTACHMENTS_ENABLED: true,
      CRM_PUSH_ENABLED: false,
      CRM_IMPORT_ENABLED: false,
    });
  });
});
