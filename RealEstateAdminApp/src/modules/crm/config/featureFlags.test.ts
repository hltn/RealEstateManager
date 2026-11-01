import { describe, expect, it } from 'vitest';
import { CRM_FEATURE_FLAGS, resolvePrototypeFlag } from './featureFlags';

describe('TB6 cờ VITE_CRM_PROTOTYPE', () => {
  it('không đặt: bật ở dev, TẮT ở production', () => {
    expect(resolvePrototypeFlag(undefined, true)).toBe(true);
    expect(resolvePrototypeFlag(undefined, false)).toBe(false);
  });

  it('đặt rõ ràng thì thắng môi trường', () => {
    expect(resolvePrototypeFlag('true', false)).toBe(true);
    expect(resolvePrototypeFlag('false', true)).toBe(false);
    expect(resolvePrototypeFlag('', false)).toBe(false);
  });
});

describe('cờ tính năng giai đoạn sau mặc định tắt (fallback tel:/zalo.me)', () => {
  it('ZNS, gọi trong app, đồng bộ lịch đều tắt', () => {
    expect(CRM_FEATURE_FLAGS.isZaloZnsEnabled).toBe(false);
    expect(CRM_FEATURE_FLAGS.isInAppCallEnabled).toBe(false);
    expect(CRM_FEATURE_FLAGS.isAppointmentNotifySyncEnabled).toBe(false);
  });
});
