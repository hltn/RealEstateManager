import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_OPT_IN_CHOICE_KEY, readPushOptInChoice, savePushOptInChoice, type PushOptInChoice } from './pushOptInStorage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('pushOptInStorage (kết quả hộp thoại mời bật thông báo, FR-28)', () => {
  it.each<PushOptInChoice>(['enabled', 'skipped', 'denied'])('FR-28: ghi %s rồi đọc lại đúng giá trị, dưới khóa riêng thiết bị', (choice) => {
    savePushOptInChoice(choice);
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBe(choice);
    expect(readPushOptInChoice()).toBe(choice);
  });

  it('FR-28: chưa ghi thì null (chưa từng hỏi)', () => {
    expect(readPushOptInChoice()).toBeNull();
  });

  it('FR-28: giá trị lạ hoặc rỗng coi như chưa hỏi', () => {
    localStorage.setItem(PUSH_OPT_IN_CHOICE_KEY, 'maybe');
    expect(readPushOptInChoice()).toBeNull();
    localStorage.setItem(PUSH_OPT_IN_CHOICE_KEY, '');
    expect(readPushOptInChoice()).toBeNull();
  });

  it('FR-28: ghi đè lựa chọn trước đó', () => {
    savePushOptInChoice('skipped');
    savePushOptInChoice('enabled');
    expect(readPushOptInChoice()).toBe('enabled');
  });

  it('FR-28: localStorage ném lỗi (private mode) thì đọc ra null và ghi không ném ra ngoài', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readPushOptInChoice()).toBeNull();
    expect(() => savePushOptInChoice('skipped')).not.toThrow();
  });
});
