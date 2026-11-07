import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUSH_LAST_REFRESH_KEY,
  PUSH_SUBSCRIPTION_ID_KEY,
  clearPushRegistration,
  readPushLastRefreshAt,
  readPushSubscriptionId,
  savePushRegistration,
} from './pushStorage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('pushStorage (id subscription + mốc làm tươi, FR-01, FR-09)', () => {
  it('FR-01: lưu rồi đọc lại đúng id và mốc thời gian', () => {
    savePushRegistration('sub-1', 1_700_000_000_000);
    expect(readPushSubscriptionId()).toBe('sub-1');
    expect(readPushLastRefreshAt()).toBe(1_700_000_000_000);
  });

  it('FR-01: chưa lưu thì null; giá trị mốc hỏng thì null', () => {
    expect(readPushSubscriptionId()).toBeNull();
    expect(readPushLastRefreshAt()).toBeNull();
    localStorage.setItem(PUSH_LAST_REFRESH_KEY, 'khong-phai-so');
    expect(readPushLastRefreshAt()).toBeNull();
  });

  it('FR-01: clear xóa cả id lẫn mốc', () => {
    savePushRegistration('sub-1', 5);
    clearPushRegistration();
    expect(localStorage.getItem(PUSH_SUBSCRIPTION_ID_KEY)).toBeNull();
    expect(localStorage.getItem(PUSH_LAST_REFRESH_KEY)).toBeNull();
  });

  it('FR-01: localStorage ném lỗi (private mode) thì không ném ra ngoài', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readPushSubscriptionId()).toBeNull();
    expect(() => savePushRegistration('x', 1)).not.toThrow();
    expect(() => clearPushRegistration()).not.toThrow();
  });
});
