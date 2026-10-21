/**
 * Hàm thuần cục bộ của màn "Khách hàng": sắp xếp, phân trang, che SĐT.
 * (Đặt cục bộ vì chỉ màn này dùng - xem đề xuất chuyển sang `src/lib/` trong báo cáo.)
 */
import type { Customer, LeadStatus } from '@crm/types/crm';
import type { PaginationMeta } from '../../../../types/pagination';

// ---------------------------------------------------------------------------
// Sắp xếp
// ---------------------------------------------------------------------------

export type CustomerSortKey = 'newest' | 'appointment' | 'progress' | 'name';

/** Tuỳ chọn sắp xếp của bản Admin (nhãn giữ nguyên). */
export const CUSTOMER_SORT_OPTIONS: { value: CustomerSortKey; label: string }[] = [
  { value: 'newest', label: 'Cập nhật mới nhất' },
  { value: 'appointment', label: 'Hẹn gần nhất' },
  { value: 'progress', label: 'Tiến độ chốt (Cao - Thấp)' },
  { value: 'name', label: 'Tên A-Z' },
];

const TODAY_LABEL = 'Hôm nay';

/**
 * Khoá sắp xếp lịch hẹn: "Hôm nay" = -Infinity (lên đầu), "dd/MM/yyyy" = timestamp,
 * thiếu / không đọc được = +Infinity (xuống cuối).
 */
const getAppointmentSortValue = (customer: Customer): number => {
  const dateText = customer.nextAppointmentDate?.trim();
  if (!dateText) return Number.POSITIVE_INFINITY;
  if (dateText === TODAY_LABEL) return Number.NEGATIVE_INFINITY;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateText);
  if (!match) return Number.POSITIVE_INFINITY;
  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
};

/** Trả mảng mới đã sắp xếp (không mutate). 'newest' giữ thứ tự store (mới thêm nằm đầu). */
export const sortCustomers = (customers: Customer[], sortKey: CustomerSortKey): Customer[] => {
  const result = [...customers];
  switch (sortKey) {
    case 'name':
      return result.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    case 'progress':
      return result.sort((a, b) => b.progressPercentage - a.progressPercentage);
    case 'appointment':
      return result.sort((a, b) => {
        const diff = getAppointmentSortValue(a) - getAppointmentSortValue(b);
        return Number.isNaN(diff) ? 0 : diff;
      });
    default:
      return result;
  }
};

// ---------------------------------------------------------------------------
// Phân trang
// ---------------------------------------------------------------------------

export interface PageSlice<T> {
  pageItems: T[];
  /** Trang hiện tại đã kẹp vào [1, totalPages]. */
  page: number;
  totalPages: number;
  /** Chỉ số 1-based của bản ghi đầu/cuối đang hiển thị (0-0 khi rỗng). */
  rangeStart: number;
  rangeEnd: number;
}

/** Cắt 1 trang dữ liệu; trang ngoài khoảng hợp lệ được kẹp lại (vd sau khi bộ lọc làm giảm số trang). */
export const getPageSlice = <T>(items: T[], page: number, pageSize: number): PageSlice<T> => {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(totalPages, Math.max(1, page));
  const startIndex = (safePage - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  return {
    pageItems,
    page: safePage,
    totalPages,
    rangeStart: pageItems.length > 0 ? startIndex + 1 : 0,
    rangeEnd: startIndex + pageItems.length,
  };
};

/** Đổi PageSlice sang `PaginationMeta` để dùng `components/common/Pagination` của Admin. */
export const toPaginationMeta = (
  slice: Pick<PageSlice<unknown>, 'page' | 'totalPages'>,
  total: number,
  limit: number,
): PaginationMeta => ({
  total,
  page: slice.page,
  limit,
  totalPages: slice.totalPages,
});

// ---------------------------------------------------------------------------
// Hiển thị
// ---------------------------------------------------------------------------


/** Tab trạng thái có trên danh sách (cả 2 nguồn đều không có tab "Chưa tiếp cận"). */
export type CustomerStatusTab = 'all' | Exclude<LeadStatus, 'untouched'>;
