/**
 * Tiện ích nội bộ dùng chung cho các handler mock (đọc body, lọc ngày, job giả).
 * Không export ra ngoài `src/mocks/`.
 */

/** Ép body request (unknown) về object để đọc field an toàn. */
export const asRecord = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

/** Đọc mảng `ids` (chuỗi) từ body `{ ids: string[] }`. */
export const readIds = (body: unknown): string[] => {
  const ids = asRecord(body).ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
};

/** Đọc chuỗi từ body, trả `undefined` nếu không phải string. */
export const readString = (body: unknown, key: string): string | undefined => {
  const value = asRecord(body)[key];
  return typeof value === 'string' ? value : undefined;
};

/** Ngày local dạng `YYYY-MM-DD` (khớp giá trị DatePicker gửi lên). */
export const toLocalDateKey = (iso: string | undefined): string => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('sv-SE');
};

/**
 * Lọc theo khoảng ngày `[startDate, endDate]` (định dạng YYYY-MM-DD, bao gồm 2 đầu).
 * So sánh chuỗi được vì định dạng ISO-date sắp xếp đúng thứ tự từ điển.
 */
export const filterByDateRange = <T>(
  items: T[],
  getDate: (item: T) => string | undefined,
  startDate: string | null,
  endDate: string | null,
): T[] => {
  if (!startDate && !endDate) return items;
  return items.filter((item) => {
    const key = toLocalDateKey(getDate(item));
    if (!key) return false;
    if (startDate && key < startDate) return false;
    if (endDate && key > endDate) return false;
    return true;
  });
};

/** Sắp xếp theo thời gian `newest` (mặc định) hoặc `oldest`. Trả mảng mới, không mutate. */
export const sortByDate = <T>(items: T[], getDate: (item: T) => string | undefined, sort: string | null): T[] => {
  const direction = sort === 'oldest' ? 1 : -1;
  return [...items].sort(
    (a, b) => direction * (new Date(getDate(a) ?? 0).getTime() - new Date(getDate(b) ?? 0).getTime()),
  );
};

/** Sinh jobId dễ đọc khi debug, vd `job-crawl-lq3x9a`. */
export const mockJobId = (prefix: string): string => `job-${prefix}-${Date.now().toString(36)}`;
