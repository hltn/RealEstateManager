import { describe, expect, it } from 'vitest';
import { detectInstallPlatform, resolveInstallButtons } from './installPlatform';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_OLD_UA = 'Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1';
const IPADOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('detectInstallPlatform', () => {
  it('iPhone là ios', () => {
    expect(detectInstallPlatform({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 })).toBe('ios');
  });

  it('iPad đời cũ (UA có "iPad") là ios', () => {
    expect(detectInstallPlatform({ userAgent: IPAD_OLD_UA, platform: 'iPad', maxTouchPoints: 5 })).toBe('ios');
  });

  it('iPadOS 13+ (UA Macintosh, platform MacIntel) có cảm ứng đa điểm là ios', () => {
    expect(detectInstallPlatform({ userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
  });

  it('Mac thật (UA Macintosh, không cảm ứng) KHÔNG bị nhầm là iPad, mà là máy tính', () => {
    expect(detectInstallPlatform({ userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('other');
  });

  it('ranh giới: Macintosh với đúng 1 điểm chạm vẫn là máy tính (cần > 1)', () => {
    expect(detectInstallPlatform({ userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 1 })).toBe('other');
  });

  it('Android (UA cũng chứa "Linux") là android, không bị coi là máy tính', () => {
    expect(detectInstallPlatform({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 })).toBe('android');
  });

  it('Windows và Linux máy tính là other', () => {
    expect(detectInstallPlatform({ userAgent: WINDOWS_UA, platform: 'Win32', maxTouchPoints: 0 })).toBe('other');
    expect(detectInstallPlatform({ userAgent: LINUX_UA, platform: 'Linux x86_64', maxTouchPoints: 0 })).toBe('other');
  });

  it('Windows có màn hình cảm ứng vẫn là other (chỉ Macintosh mới được đoán là iPad)', () => {
    expect(detectInstallPlatform({ userAgent: WINDOWS_UA, platform: 'Win32', maxTouchPoints: 10 })).toBe('other');
  });

  it('UA lạ hoặc rỗng là unknown', () => {
    expect(detectInstallPlatform({ userAgent: 'SomeCustomBot/1.0', platform: '', maxTouchPoints: 0 })).toBe('unknown');
    expect(detectInstallPlatform({ userAgent: '', platform: '', maxTouchPoints: 0 })).toBe('unknown');
  });
});

describe('resolveInstallButtons', () => {
  it('android chỉ hiện nút Android', () => {
    expect(resolveInstallButtons('android')).toEqual({ isAndroidVisible: true, isIosVisible: false });
  });

  it('ios chỉ hiện nút iOS', () => {
    expect(resolveInstallButtons('ios')).toEqual({ isAndroidVisible: false, isIosVisible: true });
  });

  it('máy tính và không xác định hiện cả hai', () => {
    expect(resolveInstallButtons('other')).toEqual({ isAndroidVisible: true, isIosVisible: true });
    expect(resolveInstallButtons('unknown')).toEqual({ isAndroidVisible: true, isIosVisible: true });
  });
});
