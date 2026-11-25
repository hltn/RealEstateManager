import { describe, expect, it } from 'vitest';
import { isPushOptInLocallyEligible, resolvePushOptInOutcome, shouldShowPushOptIn, type PushOptInConditions } from './pushOptInLogic';

/** Bộ điều kiện đủ để hiện; mỗi test đổi đúng MỘT điều kiện để chứng minh chính nó chặn hộp thoại. */
const eligible: PushOptInConditions = {
  isAuthenticated: true,
  isStandalone: true,
  isServerEnabled: true,
  isDeviceReady: true,
  permission: 'default',
  storedChoice: null,
};

describe('shouldShowPushOptIn (FR-28: mọi nhánh điều kiện hiện hộp thoại)', () => {
  it('đủ điều kiện => hiện', () => {
    expect(shouldShowPushOptIn(eligible)).toBe(true);
  });

  it('chưa đăng nhập => không hiện', () => {
    expect(shouldShowPushOptIn({ ...eligible, isAuthenticated: false })).toBe(false);
  });

  it('mở trong tab trình duyệt (không standalone) => không hiện', () => {
    expect(shouldShowPushOptIn({ ...eligible, isStandalone: false })).toBe(false);
  });

  it('máy chủ chưa bật push (enabled = false) => không hiện', () => {
    expect(shouldShowPushOptIn({ ...eligible, isServerEnabled: false })).toBe(false);
  });

  it('thiết bị không bật được thông báo (không hỗ trợ) => không hiện', () => {
    expect(shouldShowPushOptIn({ ...eligible, isDeviceReady: false })).toBe(false);
  });

  it('quyền đã granted => không hỏi', () => {
    expect(shouldShowPushOptIn({ ...eligible, permission: 'granted' })).toBe(false);
  });

  it('quyền đã denied => không hỏi', () => {
    expect(shouldShowPushOptIn({ ...eligible, permission: 'denied' })).toBe(false);
  });

  it.each(['enabled', 'skipped', 'denied'] as const)('khóa localStorage đã ghi %s => không hỏi lại', (storedChoice) => {
    expect(shouldShowPushOptIn({ ...eligible, storedChoice })).toBe(false);
  });
});

describe('isPushOptInLocallyEligible (kiểm trước khi gọi API cấu hình)', () => {
  const local = { isAuthenticated: true, isStandalone: true, permission: 'default', storedChoice: null } as const;

  it('đủ điều kiện cục bộ => đáng hỏi máy chủ, không phụ thuộc cờ máy chủ/thiết bị', () => {
    expect(isPushOptInLocallyEligible(local)).toBe(true);
  });

  it.each([
    ['chưa đăng nhập', { isAuthenticated: false }],
    ['không standalone', { isStandalone: false }],
    ['quyền granted', { permission: 'granted' }],
    ['quyền denied', { permission: 'denied' }],
    ['đã ghi kết quả', { storedChoice: 'skipped' }],
  ] as const)('%s => không đáng hỏi máy chủ', (_name, override) => {
    expect(isPushOptInLocallyEligible({ ...local, ...override })).toBe(false);
  });
});

describe('resolvePushOptInOutcome (kết quả sau khi bấm "Bật")', () => {
  it('đăng ký thành công => enabled', () => {
    expect(resolvePushOptInOutcome({ isRegistered: true, permission: 'granted' })).toBe('enabled');
  });

  it('không đăng ký được và quyền bị từ chối => denied', () => {
    expect(resolvePushOptInOutcome({ isRegistered: false, permission: 'denied' })).toBe('denied');
  });

  it('không đăng ký được nhưng quyền đã cấp (lỗi máy chủ/service worker) => failed, không coi là từ chối', () => {
    expect(resolvePushOptInOutcome({ isRegistered: false, permission: 'granted' })).toBe('failed');
  });

  it('đóng hộp xin quyền mà không chọn (quyền vẫn default) => failed', () => {
    expect(resolvePushOptInOutcome({ isRegistered: false, permission: 'default' })).toBe('failed');
  });
});
