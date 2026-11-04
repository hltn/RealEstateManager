import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '../../types/pagination';
import { PAGE_SIZE_OPTIONS } from '../../types/pagination';

export interface PaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  isDisabled?: boolean;
  /** Nhãn đơn vị bản ghi, VD: "bài viết". */
  itemLabel?: string;
  /** Ẩn phần tóm tắt khi màn hình render nó ở đầu bảng. */
  showSummary?: boolean;
}

/** Ký hiệu vị trí rút gọn "..." trong dải số trang. */
const ELLIPSIS = 'ellipsis' as const;
type PageItem = number | typeof ELLIPSIS;

/**
 * Sinh dải số trang hiển thị: luôn giữ trang đầu, trang cuối, trang hiện tại
 * và 1 trang liền kề mỗi bên; phần bị lược bỏ thay bằng "...".
 */
const buildPageItems = (currentPage: number, totalPages: number): PageItem[] => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: PageItem[] = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) items.push(ELLIPSIS);
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < totalPages - 1) items.push(ELLIPSIS);

  items.push(totalPages);
  return items;
};

/**
 * Thanh phân trang dùng chung cho các bảng danh sách (server-side pagination).
 * Không render gì khi không có bản ghi để tránh chia cho 0 / hiển thị "trang 1/0".
 */
export const Pagination = ({
  meta,
  onPageChange,
  onLimitChange,
  isDisabled = false,
  itemLabel = 'bản ghi',
  showSummary = true,
}: PaginationProps) => {
  const { total, page, limit, totalPages } = meta;

  if (total === 0 || totalPages === 0) return null;

  const safePage = Math.min(Math.max(page, 1), totalPages);
  const firstItemIndex = (safePage - 1) * limit + 1;
  const lastItemIndex = Math.min(safePage * limit, total);
  const hasPrev = safePage > 1;
  const hasNext = safePage < totalPages;

  const pageItems = buildPageItems(safePage, totalPages);

  const baseButtonClass =
    'inline-flex items-center justify-center min-w-9 h-9 px-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <nav
      aria-label="Phân trang danh sách"
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1 py-2"
    >
      <div className="flex items-center gap-3 text-theme-sm text-gray-500 dark:text-gray-400">
        {showSummary && (
          <span>
            Hiển thị {firstItemIndex}-{lastItemIndex} / {total} {itemLabel} &middot; Trang {safePage}/
            {totalPages}
          </span>
        )}
        {onLimitChange && (
          <label className="hidden md:flex items-center gap-2">
            <span className="whitespace-nowrap">Số dòng:</span>
            <select
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              disabled={isDisabled}
              aria-label="Số bản ghi mỗi trang"
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.1] rounded-lg px-2 py-1 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <ul className="flex items-center gap-1">
        <li>
          <button
            type="button"
            onClick={() => onPageChange(safePage - 1)}
            disabled={isDisabled || !hasPrev}
            aria-label="Trang trước"
            className={`${baseButtonClass} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.05]`}
          >
            <ChevronLeft size={16} />
          </button>
        </li>

        {pageItems.map((item, index) =>
          item === ELLIPSIS ? (
            <li key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-gray-400 select-none">
              &hellip;
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                onClick={() => onPageChange(item)}
                disabled={isDisabled}
                aria-label={`Trang ${item}`}
                aria-current={item === safePage ? 'page' : undefined}
                className={`${baseButtonClass} ${
                  item === safePage
                    ? 'bg-brand-500 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.05]'
                }`}
              >
                {item}
              </button>
            </li>
          ),
        )}

        <li>
          <button
            type="button"
            onClick={() => onPageChange(safePage + 1)}
            disabled={isDisabled || !hasNext}
            aria-label="Trang sau"
            className={`${baseButtonClass} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.05]`}
          >
            <ChevronRight size={16} />
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default Pagination;
