/**
 * NGUỒN DUY NHẤT các mẫu lớp Tailwind của module CRM — rút từ các mẫu lặp lại của Admin App
 * (tài liệu 03 mục 5; đường dẫn `file:dòng` tính từ `RealEstateAdminApp/src/screens/` nếu không ghi khác).
 * Mọi màu đều có cặp `dark:` (Admin mặc định chạy tối). Chỉ gom mẫu ≥ 2 nơi dùng; lớp riêng của 1 màn viết tại chỗ.
 *
 * Gộp từ 5 tệp cũ do các màn tự tạo khi port song song: `components/crmClassNames.ts`,
 * `CustomerDetail/components/detailStyles.ts`, `Appointments/appointmentUi.ts`,
 * `CreateAppointment/formClasses.ts`, `CreateCustomer/components/formStyles.ts`.
 */

// ---------------------------------------------------------------------------
// Bố cục & chữ
// ---------------------------------------------------------------------------

/** Thẻ / khối nội dung — `CronjobScreen.tsx:58`, `KnowledgeConfigScreen.tsx:692`. */
export const CARD_CLASS =
  'rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]';

/** Ô phụ nằm trong thẻ (nền lõm hơn thẻ ở cả 2 chế độ). */
export const INSET_CLASS = 'rounded-xl border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900';

/** Màu đường kẻ phân tách trong thẻ (ghép với `border-b`/`border-t`). */
export const DIVIDER_CLASS = 'border-gray-100 dark:border-white/[0.05]';

/** Tiêu đề trang — `CronjobScreen.tsx:53`. */
export const PAGE_TITLE_CLASS = 'text-title-sm font-semibold text-gray-800 dark:text-white/90';

/** Tiêu đề trang trên mobile (< 768px): `text-xl` như "Quản lý tài khoản" (`UserManagementScreen.tsx:196`). */
export const PAGE_TITLE_MOBILE_CLASS = 'text-xl font-semibold text-gray-800 dark:text-white/90';

/** Mô tả dưới tiêu đề — `ExternalLogsScreen.tsx:189`. */
export const PAGE_DESCRIPTION_CLASS = 'text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400';

/** Tiêu đề khối trong thẻ. */
export const CARD_TITLE_CLASS = 'text-base font-semibold text-gray-800 dark:text-white/90';

/** Nhãn chữ hoa (thanh lọc, nhóm, cột) — `ExternalLogsScreen.tsx:205`. */
export const CAPTION_CLASS = 'text-theme-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400';

/** Nhãn nhỏ của ô thông tin chỉ đọc. */
export const INFO_LABEL_CLASS = 'block text-theme-xs text-gray-500 dark:text-gray-400';

/** Giá trị của ô thông tin chỉ đọc. */
export const INFO_VALUE_CLASS = 'break-words text-theme-sm font-medium text-gray-800 dark:text-white/90';

/** Chữ thân phụ. */
export const MUTED_TEXT_CLASS = 'text-theme-sm text-gray-500 dark:text-gray-400';

// ---------------------------------------------------------------------------
// Nút
// ---------------------------------------------------------------------------

/** Cỡ nút chuẩn của Admin (`px-4 py-2 text-sm`, `UserManagementScreen.tsx:207, 217`). */
const BUTTON_SIZE_MD = 'px-4 py-2 text-sm';
/** Cỡ nút trong form / thẻ chi tiết (cao hơn 4px, ngang hàng ô nhập h-11 khi đặt cạnh nhau). */
const BUTTON_SIZE_LG = 'px-4 py-2.5 text-sm';

/** Nút chính, chưa có padding/cỡ chữ — `UserManagementScreen.tsx:217`. */
export const BUTTON_PRIMARY_BASE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 font-medium text-white transition-colors hover:bg-brand-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';
export const BUTTON_PRIMARY_CLASS = `${BUTTON_PRIMARY_BASE_CLASS} ${BUTTON_SIZE_MD}`;
export const BUTTON_PRIMARY_LG_CLASS = `${BUTTON_PRIMARY_BASE_CLASS} ${BUTTON_SIZE_LG}`;

/** Nút xanh lá (Zalo) — token success thay `emerald` của Stitch. */
export const BUTTON_SUCCESS_LG_CLASS = `inline-flex items-center justify-center gap-2 rounded-lg bg-success-500 font-medium text-white transition-colors hover:bg-success-600 active:scale-[0.98] ${BUTTON_SIZE_LG}`;

/** Nút viền, chưa có padding/cỡ chữ — `UserManagementScreen.tsx:207`. */
export const BUTTON_OUTLINE_BASE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-white/5';
export const BUTTON_OUTLINE_CLASS = `${BUTTON_OUTLINE_BASE_CLASS} ${BUTTON_SIZE_MD}`;
export const BUTTON_OUTLINE_LG_CLASS = `${BUTTON_OUTLINE_BASE_CLASS} ${BUTTON_SIZE_LG}`;

/** Nút nhạt cùng tông brand, chưa có padding/cỡ chữ — `RawArticlesScreen.tsx:479`. */
export const BUTTON_SOFT_BASE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-brand-100 bg-brand-50 font-medium text-brand-500 transition-colors hover:bg-brand-100 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400 dark:hover:bg-brand-500/25';
export const BUTTON_SOFT_CLASS = `${BUTTON_SOFT_BASE_CLASS} ${BUTTON_SIZE_MD}`;
/** Nút nhạt cỡ nhỏ (trong đầu thẻ). */
export const BUTTON_SOFT_SM_CLASS = `${BUTTON_SOFT_BASE_CLASS} shrink-0 gap-1 px-2.5 py-1.5 text-xs`;

/** Nút xám, chưa có padding/cỡ chữ — `ExternalLogsScreen.tsx:479`. */
export const BUTTON_GRAY_BASE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-gray-100 font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700';

/** Nút chữ (link) nhỏ. */
export const BUTTON_LINK_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-500 transition-colors hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10';

/** Nút viền nét đứt ("Thêm người"). */
export const BUTTON_DASHED_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:border-brand-500 hover:text-brand-500 dark:border-gray-700 dark:text-gray-400 dark:hover:border-brand-400 dark:hover:text-brand-400';

/** Nút icon (bảng, đầu hộp thoại) — `ExternalLogsScreen.tsx:365`. */
export const ICON_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-brand-50 hover:text-brand-500 dark:text-gray-400 dark:hover:bg-brand-500/10 dark:hover:text-brand-400';

/** Nút vuông 40px chỉ có icon, kiểu nút viền. */
export const ICON_BUTTON_OUTLINE_CLASS =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-brand-500 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-brand-400';

/** Nút điều hướng nhỏ 32px (tháng/tuần trước - sau). */
export const NAV_ICON_BUTTON_CLASS =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200';

// ---------------------------------------------------------------------------
// Chip / nhãn
// ---------------------------------------------------------------------------

/** Chip trạng thái — `UserManagementScreen.tsx:298-311`. */
export const CHIP_CLASS = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium';

/** Chip gọn (thẻ mobile, danh sách hẹp). */
export const CHIP_SMALL_CLASS = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';

/** Tông màu chip (ghép với `CHIP_CLASS` / `CHIP_SMALL_CLASS`). */
export const CHIP_TONE_CLASS = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  success: 'bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500',
  error: 'bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500',
  /** Chip "AI" (Admin dùng tông tím — `ExternalLogsScreen.tsx:76`). */
  purple: 'bg-theme-purple-500/10 text-theme-purple-500',
} as const;

export type ChipTone = keyof typeof CHIP_TONE_CLASS;

/** Chip VIP: token warning (vàng) thay `amber-*` của Stitch; tím để dành cho nhãn AI. */
export const VIP_CHIP_CLASS = `${CHIP_CLASS} ${CHIP_TONE_CLASS.warning}`;

/** Chip loại / mã (dự án) — `ExternalLogsScreen.tsx:66-98`, tông brand. */
export const PROJECT_CHIP_CLASS =
  'inline-flex max-w-full items-center truncate rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400';

/** Chip nhạt cùng tông brand có viền (tag đã chọn) — `RawArticlesScreen.tsx:479`. */
export const BRAND_SOFT_CHIP_CLASS =
  'border border-brand-100 bg-brand-50 text-brand-600 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400';

/** Hộp gợi ý AI — "thông báo trong trang" (`ExternalLogsScreen.tsx:194`) với tông warning. */
export const AI_HINT_CLASS =
  'flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-2.5 text-xs text-warning-700 dark:border-warning-500/25 dark:bg-warning-500/10 dark:text-warning-400';

// ---------------------------------------------------------------------------
// Tab gạch chân — `KnowledgeConfigScreen.tsx:672-689`
// ---------------------------------------------------------------------------

export const TAB_BASE_CLASS =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border-b-2 py-3 text-sm font-medium transition-colors';
export const TAB_ACTIVE_CLASS = 'border-brand-500 text-brand-600 dark:text-brand-400';
export const TAB_INACTIVE_CLASS =
  'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300';
export const TAB_BADGE_ACTIVE_CLASS = 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400';
export const TAB_BADGE_INACTIVE_CLASS = 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';

// ---------------------------------------------------------------------------
// Lựa chọn (nhóm nút, thẻ radio, chip chọn nhiều) — Admin chưa có, vẽ theo Stitch bằng token Admin
// ---------------------------------------------------------------------------

export const OPTION_ACTIVE_CLASS =
  'border-brand-500 bg-brand-50 text-brand-600 dark:border-brand-500 dark:bg-brand-500/15 dark:text-brand-400';
export const OPTION_IDLE_CLASS =
  'border-gray-200 bg-transparent text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5';

/** Viên lọc (tab trạng thái dạng viên thuốc, chip chọn nhanh) — Admin chưa có, vẽ theo Stitch: đang chọn tô đặc brand. */
export const PILL_ACTIVE_CLASS = 'border-brand-500 bg-brand-500 text-white';
export const PILL_IDLE_CLASS =
  'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/5';
/** Số đếm trong viên lọc. */
export const PILL_COUNT_ACTIVE_CLASS = 'bg-white/20 text-white';
export const PILL_COUNT_IDLE_CLASS = 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';

// ---------------------------------------------------------------------------
// Ô nhập
// ---------------------------------------------------------------------------

/** Ô nhập / select của thanh lọc — `ExternalLogsScreen.tsx:207`. */
export const FILTER_INPUT_CLASS =
  'h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/[0.1] dark:bg-gray-900 dark:text-white/90';

/** Ô nhập form trong hộp thoại — `UserManagementScreen.tsx:379` (nền trong suốt). */
export const MODAL_INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:text-white/90 dark:placeholder:text-gray-500';

/** Như `MODAL_INPUT_CLASS` nhưng nền đặc — dùng cho `<select>` để danh sách `<option>` đọc được ở chế độ tối. */
export const SOLID_INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-gray-500';

/** Nhãn trường form thường — `UserManagementScreen.tsx:374`. */
export const FORM_LABEL_TEXT_CLASS = 'block text-sm font-medium text-gray-700 dark:text-gray-400';
export const FORM_LABEL_CLASS = `mb-1.5 ${FORM_LABEL_TEXT_CLASS}`;

/** Chữ gợi ý dưới trường. */
export const FORM_HINT_CLASS = 'mt-1.5 text-xs text-gray-500 dark:text-gray-400';

/** Checkbox gốc — `ManageWpScreen.tsx:817`. */
export const CHECKBOX_CLASS = 'h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 accent-brand-500 dark:border-gray-600';

/** Icon trái trong ô nhập — mẫu "Ô tìm có icon" `ManageWpScreen.tsx:738-748`. */
export const INPUT_ICON_CLASS = 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500';

const FIELD_BASE_CLASS =
  'w-full rounded-lg border text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60 dark:text-white/90 dark:placeholder:text-gray-500';
const FIELD_OK_CLASS = 'border-gray-200 focus:border-brand-500 focus:ring-brand-500 dark:border-gray-700';
const FIELD_ERROR_CLASS = 'border-error-500 focus:border-error-500 focus:ring-error-500 dark:border-error-500';

export interface InputClassOptions {
  hasError?: boolean;
  hasLeftIcon?: boolean;
  hasRightAddon?: boolean;
}

/** Ô nhập form 1 dòng cao 44px (mẫu "form trong modal" `UserManagementScreen.tsx:379`) + viền đỏ khi lỗi. */
export const getInputClass = ({ hasError = false, hasLeftIcon = false, hasRightAddon = false }: InputClassOptions = {}): string =>
  `${FIELD_BASE_CLASS} h-11 bg-transparent py-2.5 ${hasError ? FIELD_ERROR_CLASS : FIELD_OK_CLASS} ${hasLeftIcon ? 'pl-10' : 'pl-4'} ${
    hasRightAddon ? 'pr-10' : 'pr-4'
  }`;

/** `<select>` gốc: nền đặc + `color-scheme` tối để danh sách thả xuống đọc được ở chế độ tối (`UserManagementScreen.tsx:420`). */
export const getSelectClass = ({ hasError = false, hasLeftIcon = false }: InputClassOptions = {}): string =>
  `${FIELD_BASE_CLASS} h-11 cursor-pointer bg-white py-2.5 pr-4 dark:bg-gray-900 dark:[color-scheme:dark] ${
    hasError ? FIELD_ERROR_CLASS : FIELD_OK_CLASS
  } ${hasLeftIcon ? 'pl-10' : 'pl-4'}`;

/** Ô nhập nhiều dòng. */
export const getTextareaClass = (hasError = false): string =>
  `${FIELD_BASE_CLASS} resize-none bg-transparent px-4 py-3 leading-relaxed ${hasError ? FIELD_ERROR_CLASS : FIELD_OK_CLASS}`;

export const TEXTAREA_CLASS = getTextareaClass();

/**
 * `inputClassName` cho `components/ui/DatePicker` (twMerge ghép với lớp gốc `border-gray-300 shadow-theme-xs`):
 * đưa viền/focus về cùng kiểu ô nhập form ở trên.
 */
export const getDatePickerInputClass = (hasError = false): string =>
  `h-11 py-2.5 focus:ring-1 ${hasError ? FIELD_ERROR_CLASS : FIELD_OK_CLASS}`;
