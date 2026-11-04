import { Component, type ReactNode } from 'react';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  /** Đổi giá trị này (vd đường dẫn hiện tại) thì boundary tự thoát trạng thái lỗi để thử vẽ lại. */
  resetKey: string;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

/**
 * Chặn lỗi khi vẽ vùng nội dung (điển hình: chunk lazy không tải được sau deploy, lúc đó `import()` lỗi và
 * React.lazy ném lỗi khi render) để KHÔNG trắng toàn màn hình: header/sidebar vẫn còn, vùng nội dung hiện thông báo
 * và nút "Tải lại". Phải là class vì React chưa có hook cho error boundary. (React tự ghi lỗi ra console.)
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps): void {
    // Người dùng chuyển sang trang khác (đường dẫn đổi) thì thử vẽ lại thay vì kẹt ở màn lỗi.
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Không tải được trang</h2>
        <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
          Có thể ứng dụng vừa được cập nhật hoặc đường truyền không ổn. Hãy tải lại trang để tiếp tục.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11 rounded-lg bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600"
        >
          Tải lại
        </button>
      </div>
    );
  }
}
