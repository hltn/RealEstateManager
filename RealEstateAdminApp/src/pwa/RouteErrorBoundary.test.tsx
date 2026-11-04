import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from './RouteErrorBoundary';

/** Con ném lỗi khi `shouldThrow` (giả lập chunk lazy không tải được). */
const Page = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error('Failed to fetch dynamically imported module');
  return <p>Nội dung trang</p>;
};

describe('RouteErrorBoundary', () => {
  const reload = vi.fn();

  beforeEach(() => {
    // React ghi lỗi đã bắt ra console.error; tắt để log test gọn.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('location', { ...window.location, reload });
    reload.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('không lỗi thì hiện nội dung bình thường', () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <Page shouldThrow={false} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('Nội dung trang')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con ném lỗi: hiện màn "Không tải được trang" thay vì trắng màn, không tự reload', () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <Page shouldThrow />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được trang');
    expect(screen.queryByText('Nội dung trang')).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('bấm "Tải lại" gọi reload', async () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <Page shouldThrow />
      </RouteErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('đổi resetKey (chuyển trang) thì thoát màn lỗi và vẽ lại; cùng resetKey thì vẫn kẹt ở màn lỗi', () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/a">
        <Page shouldThrow />
      </RouteErrorBoundary>,
    );
    rerender(
      <RouteErrorBoundary resetKey="/a">
        <Page shouldThrow={false} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <RouteErrorBoundary resetKey="/b">
        <Page shouldThrow={false} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('Nội dung trang')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
