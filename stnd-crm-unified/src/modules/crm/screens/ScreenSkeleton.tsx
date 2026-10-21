/** Skeleton hiển thị trong lúc tải lazy biến thể màn hình (khối `bg-gray-200` / tối `bg-gray-800` như `TableSkeletonRows`). */
interface ScreenSkeletonProps {
  variant: 'desktop' | 'mobile';
}

const BLOCK_CLASS = 'bg-gray-200 dark:bg-gray-800';

export const ScreenSkeleton = ({ variant }: ScreenSkeletonProps) => (
  <div aria-busy="true" aria-label="Đang tải màn hình" className={`animate-pulse ${variant === 'mobile' ? 'space-y-3' : 'space-y-4'}`}>
    <div className={`h-7 w-48 rounded-lg ${BLOCK_CLASS}`} />
    <div className={`h-4 w-72 max-w-full rounded ${BLOCK_CLASS}`} />
    <div className={`h-32 rounded-2xl ${BLOCK_CLASS}`} />
    <div className={`h-20 rounded-2xl ${BLOCK_CLASS}`} />
  </div>
);
