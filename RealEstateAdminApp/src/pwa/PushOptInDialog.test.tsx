import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushRegistration } from '@crm/api/http/pushApi';
import type { UsePushSubscriptionResult } from '@crm/hooks/usePushSubscription';
import { useAuthStore } from '../stores/auth.store';
import PushOptInDialog from './PushOptInDialog';
import { PUSH_OPT_IN_CHOICE_KEY } from './pushOptInStorage';

// Giả lớp mạng/trình duyệt phía dưới `usePushSubscription`; phần quyết định (điều kiện, ghi khóa, nhánh denied) là code thật.
const usePushSubscription = vi.fn();
vi.mock('@crm/hooks/usePushSubscription', () => ({
  usePushSubscription: (...args: unknown[]) => usePushSubscription(...args),
}));

const DIALOG = { name: 'Bật thông báo cho STND?' };
const BLOCKED_DIALOG = { name: 'Thông báo đang bị chặn' };
const ENABLE_BUTTON = { name: 'Bật thông báo' };
const LATER_BUTTON = { name: 'Để sau' };

type Permission = 'default' | 'granted' | 'denied';

const setStandalone = (isStandalone: boolean) => Object.defineProperty(navigator, 'standalone', { value: isStandalone, configurable: true });

/** jsdom không có `Notification`: giả đúng phần `permission` mà `readPermission` đọc. */
const setPermission = (permission: Permission) => Object.defineProperty(window, 'Notification', { value: { permission }, configurable: true, writable: true });

const login = () => useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'STAFF' }, isInitialized: true });

const REGISTRATION: PushRegistration = {
  id: 'sub-1',
  deviceLabel: 'Chrome · Android',
  platform: 'android',
  createdAt: '2026-11-13T00:00:00.000Z',
  lastSeenAt: '2026-11-13T00:00:00.000Z',
  displaced: null,
};

const makePush = (overrides: Partial<UsePushSubscriptionResult> = {}): UsePushSubscriptionResult => ({
  state: 'ready',
  isAvailable: true,
  canEnable: true,
  canDisable: false,
  isLoading: false,
  isBusy: false,
  error: null,
  enable: vi.fn().mockResolvedValue(REGISTRATION),
  disable: vi.fn().mockResolvedValue(true),
  ...overrides,
});

/** Thiết lập mặc định ĐỦ điều kiện hiện; mỗi test đổi đúng một yếu tố. */
beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ accessToken: null, user: null, isInitialized: true });
  login();
  setStandalone(true);
  setPermission('default');
  usePushSubscription.mockReset();
  usePushSubscription.mockReturnValue(makePush());
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'standalone');
  Reflect.deleteProperty(window, 'Notification');
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('PushOptInDialog: điều kiện hiện (FR-28)', () => {
  it('đủ điều kiện => hiện hộp thoại có role dialog, aria-modal và tiêu đề', () => {
    render(<PushOptInDialog />);
    const dialog = screen.getByRole('dialog', DIALOG);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/nhắc việc, lịch hẹn/);
  });

  it('chưa đăng nhập => không hiện', () => {
    useAuthStore.setState({ accessToken: null, user: null });
    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('standalone qua matchMedia (display-mode: standalone, Android/Chrome đã cài) => hiện dù navigator.standalone không có', () => {
    setStandalone(false);
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: query === '(display-mode: standalone)', media: query }));
    render(<PushOptInDialog />);
    expect(screen.getByRole('dialog', DIALOG)).toBeInTheDocument();
  });

  it('mở trong tab trình duyệt (không standalone) => không hiện', () => {
    setStandalone(false);
    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('máy chủ tắt push => không hiện', () => {
    usePushSubscription.mockReturnValue(makePush({ isAvailable: false, canEnable: false }));
    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('thiết bị không bật được (không hỗ trợ) => không hiện', () => {
    usePushSubscription.mockReturnValue(makePush({ state: 'unsupported', canEnable: false }));
    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each<Permission>(['granted', 'denied'])('quyền đã %s => không hỏi', (permission) => {
    setPermission(permission);
    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['enabled', 'skipped', 'denied'])('khóa localStorage đã ghi %s => không hỏi lại', (choice) => {
    localStorage.setItem(PUSH_OPT_IN_CHOICE_KEY, choice);
    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('chỉ kích hoạt truy vấn push khi đủ điều kiện cục bộ (tab trình duyệt không tốn request)', () => {
    setStandalone(false);
    render(<PushOptInDialog />);
    expect(usePushSubscription).toHaveBeenLastCalledWith({ isActive: false });
  });

  it('đủ điều kiện cục bộ thì kích hoạt truy vấn push', () => {
    render(<PushOptInDialog />);
    expect(usePushSubscription).toHaveBeenLastCalledWith({ isActive: true });
  });
});

describe('PushOptInDialog: bấm "Bật"', () => {
  it('gọi enable() đúng một lần NGAY trong handler bấm (đồng bộ, giữ cử chỉ người dùng)', () => {
    const push = makePush();
    usePushSubscription.mockReturnValue(push);
    render(<PushOptInDialog />);
    fireEvent.click(screen.getByRole('button', ENABLE_BUTTON));
    // Không `await` nào giữa lúc bấm và lúc kiểm: enable() đã được gọi trong cùng nhịp đồng bộ với sự kiện bấm.
    expect(push.enable).toHaveBeenCalledTimes(1);
  });

  it('thành công => ghi enabled, đóng hộp, và mount lại không hỏi nữa', async () => {
    render(<PushOptInDialog />);
    await userEvent.click(screen.getByRole('button', ENABLE_BUTTON));
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBe('enabled');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('bấm lặp lúc đang đăng ký vẫn chỉ gọi enable() một lần', async () => {
    let resolveEnable: (value: PushRegistration) => void = () => undefined;
    const enable = vi.fn(() => new Promise<PushRegistration | null>((resolve) => (resolveEnable = resolve)));
    usePushSubscription.mockReturnValue(makePush({ enable }));
    render(<PushOptInDialog />);
    const button = screen.getByRole('button', ENABLE_BUTTON);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(enable).toHaveBeenCalledTimes(1);
    await act(async () => resolveEnable(REGISTRATION));
  });

  it('đang đăng ký (isBusy) => khóa cả hai nút, hiện "Đang bật…" và Esc không đóng hộp', () => {
    usePushSubscription.mockReturnValue(makePush({ isBusy: true }));
    render(<PushOptInDialog />);
    expect(screen.getByRole('button', { name: 'Đang bật…' })).toBeDisabled();
    expect(screen.getByRole('button', LATER_BUTTON)).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', DIALOG)).toBeInTheDocument();
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBeNull();
  });

  it('lỗi khác từ chối (quyền vẫn default) => không ghi khóa, hộp giữ nguyên và hiện lỗi để thử lại', async () => {
    usePushSubscription.mockReturnValue(makePush({ enable: vi.fn().mockResolvedValue(null), error: 'Ứng dụng chưa sẵn sàng nhận thông báo.' }));
    render(<PushOptInDialog />);
    await userEvent.click(screen.getByRole('button', ENABLE_BUTTON));
    expect(screen.getByRole('alert')).toHaveTextContent('Ứng dụng chưa sẵn sàng nhận thông báo.');
    expect(screen.getByRole('dialog', DIALOG)).toBeInTheDocument();
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBeNull();
  });
});

describe('PushOptInDialog: nhánh quyền bị từ chối', () => {
  /** Giả trình duyệt từ chối ngay khi `enable()` chạy: quyền chuyển sang denied và enable trả null. */
  const denyOnEnable = () => {
    const enable = vi.fn(async () => {
      setPermission('denied');
      return null;
    });
    usePushSubscription.mockReturnValue(makePush({ enable, error: 'Chưa được cấp quyền thông báo.' }));
    return enable;
  };

  it('hiện hướng dẫn mở lại quyền (không hỏi lại), ghi denied', async () => {
    denyOnEnable();
    render(<PushOptInDialog />);
    await userEvent.click(screen.getByRole('button', ENABLE_BUTTON));

    const guide = screen.getByRole('dialog', BLOCKED_DIALOG);
    expect(guide).toHaveTextContent('cài đặt của trình duyệt');
    expect(screen.queryByRole('button', ENABLE_BUTTON)).not.toBeInTheDocument();
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBe('denied');
  });

  it('"Đã hiểu" đóng hướng dẫn; mount lại không hiện gì', async () => {
    denyOnEnable();
    render(<PushOptInDialog />);
    await userEvent.click(screen.getByRole('button', ENABLE_BUTTON));
    await userEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Esc ở bước hướng dẫn chỉ đóng hộp, không ghi đè kết quả denied bằng skipped', async () => {
    denyOnEnable();
    render(<PushOptInDialog />);
    await userEvent.click(screen.getByRole('button', ENABLE_BUTTON));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBe('denied');
  });
});

describe('PushOptInDialog: "Để sau" và đóng hộp', () => {
  it('"Để sau" ghi skipped, đóng hộp, không gọi enable() và mount lại không hỏi nữa', async () => {
    const push = makePush();
    usePushSubscription.mockReturnValue(push);
    render(<PushOptInDialog />);
    await userEvent.click(screen.getByRole('button', LATER_BUTTON));
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBe('skipped');
    expect(push.enable).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    render(<PushOptInDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('nhấp nền KHÔNG đóng hộp mời (tránh lỡ tay bỏ qua vĩnh viễn) và không ghi khóa', async () => {
    render(<PushOptInDialog />);
    const backdrop = document.querySelector('.modal > div') as HTMLElement;
    await userEvent.click(backdrop);
    expect(screen.getByRole('dialog', DIALOG)).toBeInTheDocument();
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBeNull();
  });

  it('Esc tính là "Để sau": ghi skipped và đóng', async () => {
    render(<PushOptInDialog />);
    await userEvent.keyboard('{Escape}');
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBe('skipped');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tiêu điểm vào nút "Bật" khi hộp mở', () => {
    render(<PushOptInDialog />);
    expect(screen.getByRole('button', ENABLE_BUTTON)).toHaveFocus();
  });
});
