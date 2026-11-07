import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_LAST_REFRESH_KEY, PUSH_SUBSCRIPTION_ID_KEY, savePushRegistration } from '../pwa/pushStorage';

const post = vi.fn();
vi.mock('./axios', () => ({ default: { post: (...args: unknown[]) => post(...args) } }));

import { logout } from './auth.api';

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: { message: 'ok' } });
  localStorage.clear();
});

describe('logout kèm id subscription push (FR-01)', () => {
  it('FR-01: có id đã lưu thì gửi { pushSubscriptionId } và xóa bản ghi cục bộ', async () => {
    savePushRegistration('sub-42', Date.now());
    await logout();
    expect(post).toHaveBeenCalledWith('/auth/logout', { pushSubscriptionId: 'sub-42' });
    expect(localStorage.getItem(PUSH_SUBSCRIPTION_ID_KEY)).toBeNull();
    expect(localStorage.getItem(PUSH_LAST_REFRESH_KEY)).toBeNull();
  });

  it('FR-01: chưa bật push thì không gửi body (hành vi như cũ, tương thích ngược)', async () => {
    await logout();
    expect(post).toHaveBeenCalledWith('/auth/logout', undefined);
  });

  it('FR-01: gọi API lỗi vẫn xóa bản ghi cục bộ và ném lỗi lên cho nơi gọi xử lý', async () => {
    savePushRegistration('sub-42', Date.now());
    post.mockRejectedValue(new Error('network'));
    await expect(logout()).rejects.toThrow('network');
    expect(localStorage.getItem(PUSH_SUBSCRIPTION_ID_KEY)).toBeNull();
  });
});
