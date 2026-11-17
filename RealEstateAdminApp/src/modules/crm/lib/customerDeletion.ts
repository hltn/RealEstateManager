/**
 * Quy tắc thuần cho xóa / khôi phục / xóa vĩnh viễn khách (FR-31, v1.0.6): kiểm lý do, thông báo tiếng Việt theo mã lỗi.
 * Quyền xóa = Quản trị hoặc NGƯỜI TẠO khách, KHÔNG phụ thuộc tình trạng khách (đã bỏ điều kiện khách "Bỏ"); backend là nguồn sự thật
 * (cờ `permissions.canDelete` ở chi tiết, `failed[]` INSUFFICIENT_ROLE ở xóa hàng loạt) nên FE không tự suy quyền.
 */
import type { ApiError } from '@crm/api';

/** Giới hạn khách mỗi lần xóa hàng loạt của backend. */
export const BULK_DELETE_LIMIT = 200;
/** Độ dài tối đa của lý do xóa. */
export const DELETE_REASON_MAX_LENGTH = 500;

/**
 * Ký tự "trống nhìn như trống" nhưng thuộc nhóm chữ/ký hiệu: Hangul filler (U+115F, U+1160, U+3164, U+FFA0) và Braille blank (U+2800).
 * Khớp `has-visible-char.decorator.ts` của backend.
 */
const VISIBLE_CHAR_PATTERN = /(?![\u115F\u1160\u3164\uFFA0\u2800])[\p{L}\p{N}\p{P}\p{S}]/u;

/** Lý do có ÍT NHẤT MỘT ký tự nhìn thấy được (chữ, số, dấu câu, ký hiệu/emoji) — cùng quy tắc với backend (400 nếu không). */
export const hasVisibleChar = (text: string): boolean => VISIBLE_CHAR_PATTERN.test(text);

const VISIBLE_REASON_MESSAGE = 'Lý do cần có ít nhất một chữ hoặc ký tự nhìn thấy được.';

/** Lỗi nhập lý do xóa (null = hợp lệ). Lý do được cắt khoảng trắng đầu/cuối trước khi gửi. */
export const validateDeleteReason = (reason: string): string | null => {
  const length = reason.trim().length;
  // Backend từ chối lý do không có ký tự nhìn thấy (chỉ khoảng trắng/zero-width/ký tự trống giả dạng) nên chặn sớm ở đây.
  if (!hasVisibleChar(reason)) return length === 0 ? 'Vui lòng nhập lý do xóa.' : VISIBLE_REASON_MESSAGE;
  if (length > DELETE_REASON_MAX_LENGTH) return `Lý do tối đa ${DELETE_REASON_MAX_LENGTH} ký tự.`;
  return null;
};

/** Lý do khách không xóa được vì thiếu quyền (xóa đơn và hàng loạt dùng chung). */
const INSUFFICIENT_DELETE_ROLE_NOTE = 'bạn không có quyền xóa khách này (chỉ Quản trị hoặc người tạo khách mới xóa được)';

const BULK_DELETE_ERROR_NOTES: Record<string, string> = {
  CUSTOMER_NOT_FOUND: 'không còn trong phạm vi của bạn hoặc không tồn tại',
  INSUFFICIENT_ROLE: INSUFFICIENT_DELETE_ROLE_NOTE,
  INTERNAL_ERROR: 'lỗi hệ thống, vui lòng thử lại sau',
};

/** Lý do (tiếng Việt) một khách không xóa được trong lô; mã lạ -> câu chung kèm mã để dễ báo lỗi. */
export const describeBulkDeleteError = (errorCode: string): string => BULK_DELETE_ERROR_NOTES[errorCode] ?? `không xóa được (mã lỗi ${errorCode})`;

/** Lỗi 400 về lý do của backend ("payload.reason phải có ít nhất một ký tự nhìn thấy được"...) -> câu tiếng Việt dễ hiểu; lỗi khác giữ nguyên. */
export const describeDeleteBatchError = (error: ApiError): string => (/ký tự nhìn thấy được/.test(error.message) ? VISIBLE_REASON_MESSAGE : error.message);

/** Thông báo cho xóa đơn (một khách). */
export const describeDeleteError = (error: ApiError): string => {
  if (error.errorCode === 'INSUFFICIENT_ROLE') return 'Bạn không có quyền xóa khách này (chỉ Quản trị hoặc người tạo khách mới xóa được).';
  if (error.errorCode === 'CUSTOMER_NOT_FOUND') return 'Khách không còn trong phạm vi của bạn hoặc không tồn tại.';
  return describeDeleteBatchError(error);
};

/** Thông báo cho khôi phục khách đã xóa. */
export const describeRestoreError = (error: ApiError): string => {
  if (error.errorCode === 'CUSTOMER_PURGE_IN_PROGRESS') return 'Khách này đang được xóa vĩnh viễn dở dang nên không khôi phục được nữa. Hãy bấm Xóa vĩnh viễn để hoàn tất.';
  if (error.errorCode === 'CUSTOMER_ANONYMIZED') return 'Khách này đã bị ẩn danh hóa nên không khôi phục được.';
  if (error.statusCode === 404) return 'Khách không còn trong danh sách đã xóa (có thể đã được khôi phục hoặc xóa vĩnh viễn trước đó).';
  return error.message;
};

/** 404 khi vừa bấm xóa vĩnh viễn = khách đã biến mất khỏi danh sách đã xóa (lần xóa trước đã xong): coi là hoàn tất, chỉ cần làm tươi danh sách. */
export const isPurgeAlreadyDone = (error: ApiError): boolean => error.statusCode === 404;

/** Thông báo cho xóa vĩnh viễn: 503 = kho tệp lỗi, backend CHƯA xóa gì nên thử lại được. */
export const describePurgeError = (error: ApiError): string => {
  if (error.statusCode === 503) return 'Kho tệp tạm thời lỗi nên CHƯA xóa gì cả. Khách vẫn nằm trong danh sách đã xóa — hãy thử lại sau ít phút.';
  if (error.errorCode === 'CUSTOMER_PURGE_IN_PROGRESS') return 'Đang có một lần xóa vĩnh viễn khác chạy cho khách này. Hãy thử lại sau ít giây.';
  if (error.errorCode === 'CUSTOMER_NOT_DELETED') return 'Khách này chưa ở trạng thái đã xóa (có thể vừa được khôi phục). Danh sách đã được làm mới.';
  if (error.statusCode === 404) return 'Khách không còn trong danh sách đã xóa (có thể đã được xóa vĩnh viễn trước đó). Danh sách đã được làm mới.';
  if (error.statusCode === 403) return 'Chỉ Quản trị mới được xóa vĩnh viễn.';
  return error.message;
};

/** Kẹp trang về trang cuối còn dữ liệu (tối thiểu 1): danh sách ngắn lại sau khi xóa thì không đứng ở trang rỗng. */
export const clampPage = (page: number, totalPages: number): number => Math.max(1, Math.min(page, totalPages));

/** Trang cần đứng sau khi gỡ 1 khách khỏi danh sách: gỡ khách DUY NHẤT của một trang (không phải trang 1) thì lùi một trang, không đứng ở trang trống. */
export const getPageAfterRemoval = (page: number, itemsOnPage: number): number => (page > 1 && itemsOnPage <= 1 ? page - 1 : page);
