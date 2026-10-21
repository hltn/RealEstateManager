// Mảnh giao diện dùng chung giữa 2 biến thể desktop/mobile của màn "Chi tiết khách hàng".
// Phần Admin có sẵn: `Dropdown`/`DropdownItem` (components/ui/dropdown), mẫu chip/thẻ/thông báo trong trang (tài liệu 03 mục 5).
// Phần Admin chưa có (vẽ mới theo bố cục Stitch, dùng token Admin): avatar chồng, thanh tiến độ C4, khay ảnh đính kèm.
import { useCallback, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Sparkles, Star, X, type LucideIcon } from 'lucide-react';
import { Dropdown } from '../../../../../components/ui/dropdown/Dropdown';
import { DropdownItem } from '../../../../../components/ui/dropdown/DropdownItem';
import { CUSTOMER_STATUSES, type CustomerStatus, type GalleryImage } from '@crm/types/crm';
import { getInitials } from '@crm/lib/staff';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { CUSTOMER_STATUS_STYLE } from '@crm/components/CustomerStatusChip';
import {
  CARD_TITLE_CLASS,
  CHIP_CLASS,
  CHIP_TONE_CLASS,
  DIVIDER_CLASS,
  INFO_LABEL_CLASS,
  INFO_VALUE_CLASS,
  VIP_CHIP_CLASS,
} from '@crm/lib/uiClasses';

// ---------------------------------------------------------------------------
// Tiêu đề thẻ: icon lucide trong ô brand + tiêu đề + mô tả + nút phải
// ---------------------------------------------------------------------------

interface CardHeadingProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  trailing?: ReactNode;
  /** Cấp tiêu đề; mặc định h2. */
  as?: 'h2' | 'h3';
}

export const CardHeading = ({ icon: Icon, title, description, trailing, as: Heading = 'h2' }: CardHeadingProps) => (
  <div className={`flex items-center justify-between gap-3 border-b pb-4 ${DIVIDER_CLASS}`}>
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <Heading className={CARD_TITLE_CLASS}>{title}</Heading>
        {description && <p className="text-theme-xs text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
    </div>
    {trailing}
  </div>
);

// ---------------------------------------------------------------------------
// Ô thông tin chỉ đọc: nhãn trên, giá trị dưới
// ---------------------------------------------------------------------------

interface InfoFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  valueClassName?: string;
}

export const InfoField = ({ label, children, className = '', valueClassName = INFO_VALUE_CLASS }: InfoFieldProps) => (
  <div className={`min-w-0 ${className}`}>
    <span className={INFO_LABEL_CLASS}>{label}</span>
    <span className={`mt-0.5 block ${valueClassName}`}>{children}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Chip VIP
// ---------------------------------------------------------------------------

export const VipChip = ({ label }: { label: string }) => (
  <span className={VIP_CHIP_CLASS}>
    <Star size={12} fill="currentColor" aria-hidden="true" />
    {label}
  </span>
);

// ---------------------------------------------------------------------------
// Chip trạng thái + Dropdown đổi trạng thái (Admin `Dropdown` + chip mục 5)
// ---------------------------------------------------------------------------

interface StatusDropdownProps {
  customerId: string;
  status: CustomerStatus;
  /** Phía mở menu: 'left' = canh trái chip (desktop), 'right' = canh phải (mobile, chip nằm sát mép phải). */
  align?: 'left' | 'right';
}

export const StatusDropdown = ({ customerId, status, align = 'left' }: StatusDropdownProps) => {
  const { changeStatus } = useCustomerDetailActions(customerId);
  const [isOpen, setIsOpen] = useState(false);
  // `Dropdown` gắn listener theo `onClose` -> giữ tham chiếu ổn định.
  const closeMenu = useCallback(() => setIsOpen(false), []);
  const { tone, dotClassName } = CUSTOMER_STATUS_STYLE[status];

  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`Trạng thái: ${status}. Bấm để đổi`}
        onClick={() => setIsOpen((isMenuOpen) => !isMenuOpen)}
        // `dropdown-toggle`: Dropdown của Admin bỏ qua click trên nút này khi xét "bấm ra ngoài".
        className={`dropdown-toggle ${CHIP_CLASS} ${CHIP_TONE_CLASS[tone]} transition hover:opacity-90`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />
        {status}
        <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <Dropdown isOpen={isOpen} onClose={closeMenu} className={`w-52 p-1.5 ${align === 'left' ? 'left-0' : ''}`}>
        <ul aria-label="Chọn trạng thái khách hàng" className="space-y-0.5">
          {CUSTOMER_STATUSES.map((option) => {
            const isCurrent = option === status;
            return (
              <li key={option}>
                {/* `DropdownItem` của Admin (đã có cặp dark: + type="button"); mục đang chọn tô brand. */}
                <DropdownItem
                  className={`rounded-lg ${isCurrent ? 'bg-brand-50 dark:bg-brand-500/[0.12]' : ''}`}
                  onItemClick={() => {
                    if (!isCurrent) changeStatus(option);
                    closeMenu();
                  }}
                >
                  <span
                    aria-current={isCurrent ? 'true' : undefined}
                    className={`flex items-center gap-2 ${isCurrent ? 'font-medium text-brand-600 dark:text-brand-400' : ''}`}
                  >
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${CUSTOMER_STATUS_STYLE[option].dotClassName}`} />
                    <span className="flex-1">{option}</span>
                    {isCurrent && <Check size={14} aria-hidden="true" />}
                  </span>
                </DropdownItem>
              </li>
            );
          })}
        </ul>
      </Dropdown>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Avatar chồng nhau của nhóm chăm sóc (C8) — Admin chưa có, vẽ theo Stitch
// ---------------------------------------------------------------------------

/** Màu xoay vòng cho người hỗ trợ (token Admin thay blue/emerald/purple của Stitch). */
const SUPPORT_AVATAR_TONES = [CHIP_TONE_CLASS.brand, CHIP_TONE_CLASS.success, CHIP_TONE_CLASS.purple];
const AVATAR_BASE_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ring-2 ring-white dark:ring-gray-900';

interface CareTeamAvatarsProps {
  staffLead: string;
  staffSupport: string[];
  /** Ảnh của người phụ trách chính (nếu có); không có -> avatar chữ. */
  leadAvatarUrl?: string;
}

export const CareTeamAvatars = ({ staffLead, staffSupport, leadAvatarUrl }: CareTeamAvatarsProps) => (
  <div className="flex shrink-0 items-center -space-x-2">
    {staffLead && (
      <div className="relative" title={`${staffLead} (Chính)`}>
        {leadAvatarUrl ? (
          <img src={leadAvatarUrl} alt={`${staffLead} (Chính)`} className={`${AVATAR_BASE_CLASS} object-cover`} />
        ) : (
          <span className={`${AVATAR_BASE_CLASS} ${CHIP_TONE_CLASS.warning}`} aria-label={`${staffLead} (Chính)`}>
            {getInitials(staffLead)}
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-warning-500 text-white ring-2 ring-white dark:ring-gray-900"
        >
          <Star size={8} fill="currentColor" strokeWidth={0} />
        </span>
      </div>
    )}
    {staffSupport.map((staffName, index) => (
      <span
        key={`${staffName}-${index}`}
        title={staffName}
        aria-label={staffName}
        className={`${AVATAR_BASE_CLASS} ${SUPPORT_AVATAR_TONES[index % SUPPORT_AVATAR_TONES.length]}`}
      >
        {getInitials(staffName)}
      </span>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Gợi ý STND AI — mẫu "thông báo trong trang" của Admin (ExternalLogsScreen.tsx:194-199), tông brand
// ---------------------------------------------------------------------------

export const AiSuggestionNotice = ({ suggestion }: { suggestion: string }) => (
  <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 dark:border-brand-500/25 dark:bg-brand-500/15">
    <Sparkles size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-800 dark:text-white/90">Gợi ý bước tiếp theo</span>
        <span className={`${CHIP_CLASS} px-2 py-0.5 ${CHIP_TONE_CLASS.purple}`}>STND AI</span>
      </div>
      <p className="text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">{suggestion}</p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Thanh tiến độ C4 — Admin chưa có (tham khảo StepCard), vẽ theo Stitch
// ---------------------------------------------------------------------------

interface C4ProgressBarProps {
  percent: number;
  className?: string;
}

export const C4ProgressBar = ({ percent, className = 'h-2' }: C4ProgressBarProps) => (
  <div
    role="progressbar"
    aria-label="Mức độ đạt chuẩn C4"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={percent}
    className={`w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800 ${className}`}
  >
    <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${percent}%` }} />
  </div>
);

// ---------------------------------------------------------------------------
// Khay ảnh đính kèm cuộn ngang — Admin chưa có, vẽ theo Stitch
// ---------------------------------------------------------------------------

interface AttachedPhotoTrayProps {
  photos: GalleryImage[];
  onRemove: (index: number) => void;
}

export const AttachedPhotoTray = ({ photos, onRemove }: AttachedPhotoTrayProps) => {
  if (photos.length === 0) return null;
  return (
    <ul className="custom-scrollbar flex items-center gap-2 overflow-x-auto pb-1" aria-label="Ảnh đã đính kèm">
      {photos.map((photo, index) => (
        <li
          key={`${photo.src}-${index}`}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <img src={photo.src} alt={photo.caption} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Xóa ảnh ${index + 1}`}
            title="Xóa ảnh"
            className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900/80 text-white transition-colors hover:bg-error-500"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
};
