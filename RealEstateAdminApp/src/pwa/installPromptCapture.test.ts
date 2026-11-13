import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasCapturedInstallPrompt, hasInstalledApp, promptInstall, startInstallPromptCapture, subscribeInstallPrompt, type BeforeInstallPromptEvent } from './installPromptCapture';
// Nguồn `main.tsx` dạng chuỗi để kiểm thứ tự gọi (bắt sớm trước khi render).
import mainSource from '../main.tsx?raw';

let stopCapture: () => void;

/** Sự kiện `beforeinstallprompt` giả: có `prompt()` và `userChoice` như bản thật. */
const makePromptEvent = (outcome: 'accepted' | 'dismissed', promptImpl?: () => Promise<void>) => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  event.prompt = vi.fn(promptImpl ?? (() => Promise.resolve()));
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
};

beforeEach(() => {
  stopCapture = startInstallPromptCapture();
});

afterEach(() => {
  stopCapture();
});

describe('installPromptCapture', () => {
  it('chưa có sự kiện thì chưa có prompt và promptInstall trả unavailable', async () => {
    expect(hasCapturedInstallPrompt()).toBe(false);
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('bắt beforeinstallprompt từ trước khi có người dùng: chặn mini-infobar và giữ lại prompt', () => {
    const event = makePromptEvent('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(hasCapturedInstallPrompt()).toBe(true);
  });

  it('promptInstall gọi prompt() đúng một lần và trả lựa chọn của người dùng', async () => {
    const event = makePromptEvent('accepted');
    window.dispatchEvent(event);
    await expect(promptInstall()).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('người dùng từ chối: trả dismissed', async () => {
    window.dispatchEvent(makePromptEvent('dismissed'));
    await expect(promptInstall()).resolves.toBe('dismissed');
  });

  it('prompt chỉ dùng được một lần: gọi lần hai là unavailable và không gọi prompt() lần nữa', async () => {
    const event = makePromptEvent('accepted');
    window.dispatchEvent(event);
    await promptInstall();
    expect(hasCapturedInstallPrompt()).toBe(false);
    await expect(promptInstall()).resolves.toBe('unavailable');
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('prompt() ném lỗi thì trả unavailable để giao diện hiện hướng dẫn dự phòng', async () => {
    window.dispatchEvent(makePromptEvent('accepted', () => Promise.reject(new Error('NotAllowedError'))));
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('appinstalled xóa prompt đã giữ và đánh dấu đã cài', () => {
    window.dispatchEvent(makePromptEvent('accepted'));
    expect(hasInstalledApp()).toBe(false);
    window.dispatchEvent(new Event('appinstalled'));
    expect(hasCapturedInstallPrompt()).toBe(false);
    expect(hasInstalledApp()).toBe(true);
  });

  it('báo cho người đăng ký khi có prompt, và ngừng báo sau khi hủy đăng ký', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInstallPrompt(listener);
    window.dispatchEvent(makePromptEvent('accepted'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    window.dispatchEvent(makePromptEvent('accepted'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('start lần hai không gắn listener trùng: một sự kiện chỉ báo một lần', () => {
    startInstallPromptCapture();
    const listener = vi.fn();
    subscribeInstallPrompt(listener);
    window.dispatchEvent(makePromptEvent('accepted'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sau khi gỡ listener thì sự kiện mới không còn được bắt', () => {
    stopCapture();
    const event = makePromptEvent('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(hasCapturedInstallPrompt()).toBe(false);
  });
});

describe('main.tsx', () => {
  it('gọi startInstallPromptCapture ở cấp module (dòng thật, không phải comment), trước createRoot(...).render (không lỡ sự kiện)', () => {
    const call = /^startInstallPromptCapture\(\)/m.exec(mainSource);
    expect(call).not.toBeNull();
    expect(call!.index).toBeLessThan(mainSource.indexOf('createRoot('));
  });
});
