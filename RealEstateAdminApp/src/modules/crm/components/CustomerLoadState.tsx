import type { ApiError } from '@crm/api';
import { ScreenSkeleton } from '../screens/ScreenSkeleton';
import { CrmUnavailable } from './CrmUnavailable';
import { CustomerNotFound } from './CustomerNotFound';

interface CustomerLoadStateProps {
  variant: 'desktop' | 'mobile';
  /** Tiêu đề màn (dùng cho trạng thái "Không tìm thấy"). */
  title: string;
  isLoading: boolean;
  /** 404: không tồn tại HOẶC ngoài phạm vi quyền (backend không phân biệt). */
  isNotFound: boolean;
  error: ApiError | null;
  onRetry: () => void;
}

/** Trạng thái thay thế khi chưa có hồ sơ khách: Skeleton (đang tải), "Không tìm thấy" (404), hoặc lỗi + thử lại (403/429/503/mạng). */
export const CustomerLoadState = ({ variant, title, isLoading, isNotFound, error, onRetry }: CustomerLoadStateProps) => {
  if (isLoading) return <ScreenSkeleton variant={variant} />;
  if (isNotFound || !error) return <CustomerNotFound variant={variant} title={title} />;
  return <CrmUnavailable error={error} onRetry={onRetry} />;
};
