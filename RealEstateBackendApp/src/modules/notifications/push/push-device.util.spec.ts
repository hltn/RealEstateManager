import { deriveDeviceInfo } from './push-device.util';
import { PushPlatform } from './push-subscription.constants';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.0.0 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  macFirefox:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
};

describe('deriveDeviceInfo', () => {
  it.each([
    [UA.iphoneSafari, PushPlatform.IOS, 'iPhone · Safari'],
    [UA.iphoneChrome, PushPlatform.IOS, 'iPhone · Chrome'],
    [UA.ipadSafari, PushPlatform.IOS, 'iPad · Safari'],
    [UA.androidChrome, PushPlatform.ANDROID, 'Android · Chrome'],
    [UA.windowsEdge, PushPlatform.DESKTOP, 'Windows · Edge'],
    [UA.macFirefox, PushPlatform.DESKTOP, 'Mac · Firefox'],
  ])('FR-01: suy nền tảng và nhãn từ UA %#', (ua, platform, label) => {
    expect(deriveDeviceInfo(ua)).toEqual({ platform, deviceLabel: label });
  });

  it.each([undefined, null, '', 'curl/8.0', 'x'.repeat(5000)])(
    'FR-01: UA thiếu hoặc lạ cho OTHER và nhãn chung, nhãn không vượt 60 ký tự (%#)',
    (ua) => {
      const info = deriveDeviceInfo(ua);
      expect(info.platform).toBe(PushPlatform.OTHER);
      expect(info.deviceLabel.length).toBeLessThanOrEqual(60);
      expect(info.deviceLabel).not.toContain('curl');
    },
  );

  it('FR-01: nhãn không chứa UA thô (không lưu UA)', () => {
    const { deviceLabel } = deriveDeviceInfo(UA.iphoneSafari);
    expect(deviceLabel).not.toContain('Mozilla');
    expect(deviceLabel).not.toContain('AppleWebKit');
  });
});
