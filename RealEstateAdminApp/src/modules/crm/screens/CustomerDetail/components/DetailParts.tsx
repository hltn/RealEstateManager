// Mảnh giao diện dùng chung giữa 2 biến thể desktop/mobile của màn "Chi tiết khách hàng".
// Phần Admin có sẵn: `Dropdown`/`DropdownItem`, `Modal`; phần mới (avatar chồng, thanh tiến độ, khay ảnh) vẽ bằng token Admin.
import { useCallback, useState, type ChangeEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Eye, EyeOff, ImagePlus, LoaderCircle, Lightbulb, ShieldCheck, Star, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Dropdown } from '../../../../../components/ui/dropdown/Dropdown';
import { DropdownItem } from '../../../../../components/ui/dropdown/DropdownItem';
import { ATTACHMENT_ACCEPT, useCatalogs, useCrmActor, useCrmApi, useNationalIdViews, type CareTeamMemberView, type CustomerDetail } from '@crm/api';
import { useCrmActions } from '@crm/store';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { STATUS_TONE_STYLES } from '@crm/components/statusToneStyles';
import { isDroppedStatus } from '@crm/lib/customerRules';
import { formatVnDateTime } from '@crm/lib/dateTime';
import { formatPhoneDisplay } from '@crm/lib/phone';
import { getInitials } from '@crm/lib/staff';
import { BUTTON_LINK_CLASS, CARD_TITLE_CLASS, CHIP_CLASS, CHIP_TONE_CLASS, DIVIDER_CLASS, INFO_LABEL_CLASS, INFO_VALUE_CLASS } from '@crm/lib/uiClasses';
import type { CustomerStatusItem } from '@crm/types/crm';
import type { AttachedPhoto } from '../useAttachedPhotos';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { useRevealedValue } from '../useRevealedValue';

// ---------------------------------------------------------------------------
// Tiêu đề thẻ + ô thông tin chỉ đọc
// ---------------------------------------------------------------------------

interface CardHeadingProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  trailing?: ReactNode;
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
// Dropdown đổi tình trạng: sang nhóm "Bỏ" phải xác nhận + có Hoàn tác (02 §5)
// ---------------------------------------------------------------------------

interface StatusDropdownProps {
  customer: CustomerDetail;
  /** 'left' = canh trái chip (desktop), 'right' = canh phải (mobile). */
  align?: 'left' | 'right';
}

export const StatusDropdown = ({ customer, align = 'left' }: StatusDropdownProps) => {
  const { changeStatus } = useCustomerDetailActions(customer);
  const { catalogs } = useCatalogs();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<CustomerStatusItem | null>(null);
  // `Dropdown` gắn listener theo `onClose` -> giữ tham chiếu ổn định.
  const closeMenu = useCallback(() => setIsOpen(false), []);
  const statuses = catalogs.statuses.filter((status) => status.isActive).sort((a, b) => a.order - b.order);
  const { chipClass, dotClass } = STATUS_TONE_STYLES[customer.status.tone];

  const selectStatus = (status: CustomerStatusItem) => {
    closeMenu();
    if (status.id === customer.status.id) return;
    if (isDroppedStatus(status)) {
      setPendingDrop(status);
      return;
    }
    changeStatus(status.id);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`Tình trạng: ${customer.status.label}. Bấm để đổi`}
        onClick={() => setIsOpen((isMenuOpen) => !isMenuOpen)}
        className={`dropdown-toggle ${CHIP_CLASS} ${chipClass} transition hover:opacity-90`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {customer.status.label}
        <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <Dropdown isOpen={isOpen} onClose={closeMenu} className={`w-52 p-1.5 ${align === 'left' ? 'left-0' : ''}`}>
        <ul aria-label="Chọn tình trạng khách hàng" className="space-y-0.5">
          {statuses.map((option) => {
            const isCurrent = option.id === customer.status.id;
            return (
              <li key={option.id}>
                <DropdownItem
                  className={`rounded-lg ${isCurrent ? 'bg-brand-50 dark:bg-brand-500/[0.12]' : ''}`}
                  onItemClick={() => selectStatus(option)}
                >
                  <span
                    aria-current={isCurrent ? 'true' : undefined}
                    className={`flex items-center gap-2 ${isCurrent ? 'font-medium text-brand-600 dark:text-brand-400' : ''}`}
                  >
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATUS_TONE_STYLES[option.tone].dotClass}`} />
                    <span className="flex-1">{option.label}</span>
                    {isCurrent && <Check size={14} aria-hidden="true" />}
                  </span>
                </DropdownItem>
              </li>
            );
          })}
        </ul>
      </Dropdown>

      <ConfirmDialog
        isOpen={pendingDrop !== null}
        title={`Chuyển ${customer.fullName} sang "${pendingDrop?.label ?? 'Bỏ'}"?`}
        description="Khách sẽ chuyển sang danh sách Bỏ. Hồ sơ, nhật ký và lịch sử được giữ nguyên; bạn có thể hoàn tác ngay sau khi chuyển."
        confirmLabel="Chuyển sang Bỏ"
        tone="danger"
        onCancel={() => setPendingDrop(null)}
        onConfirm={() => {
          if (pendingDrop) changeStatus(pendingDrop.id, { shouldOfferUndo: true });
          setPendingDrop(null);
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// SĐT + CCCD che theo quyền (C9)
// ---------------------------------------------------------------------------

/** SĐT che 3 số cuối; "Hiện số" dành cho mọi người xem được khách (kể cả thành viên nhóm), MỖI lần hiện ghi log PHONE_VIEWED. */
export const PhoneDisplay = ({ customer, className = '' }: { customer: CustomerDetail; className?: string }) => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [revealedPhone, setRevealedPhone] = useRevealedValue(customer.id);
  const isVisible = revealedPhone !== null;
  const ToggleIcon = isVisible ? EyeOff : Eye;
  // "Hiện số" = gọi API có ghi log (như CCCD) trong handler, không trong updater của setState.
  const toggle = async () => {
    if (isVisible) {
      setRevealedPhone(null);
      return;
    }
    const result = await api.createPhoneView(customer.id);
    if (!result.ok) {
      showToast({ type: 'error', title: result.error.message });
      return;
    }
    setRevealedPhone(result.data.phone);
  };
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <span className="font-medium tracking-wide tabular-nums text-gray-800 dark:text-white/90">
        {revealedPhone ? formatPhoneDisplay(revealedPhone) : customer.phoneMasked}
      </span>
      <button type="button" onClick={toggle} className={BUTTON_LINK_CLASS} aria-pressed={isVisible} title="Mỗi lần xem số đầy đủ đều được ghi lại">
        <ToggleIcon size={14} aria-hidden="true" />
        {isVisible ? 'Ẩn số' : 'Hiện số'}
      </button>
    </span>
  );
};

/**
 * CCCD chỉ hiện 4 số cuối; "Hiện" chỉ với người được phép, MỖI lần bấm gọi `POST national-id-views` (có ghi log).
 */
export const NationalIdField = ({ customer }: { customer: CustomerDetail }) => {
  const { revealNationalId } = useCustomerDetailActions(customer);
  const [revealed, setRevealed] = useRevealedValue(customer.id);
  const actor = useCrmActor();
  // Nhật ký xem CCCD chỉ Quản trị/Quản lý đọc được (05 §2.4); gọi cho người khác sẽ 403.
  const { data: viewLog } = useNationalIdViews(customer.id, customer.hasNationalId && (actor.role === 'ADMIN' || actor.role === 'MANAGER'));
  const ToggleIcon = revealed ? EyeOff : Eye;

  if (!customer.hasNationalId) return <span className={INFO_VALUE_CLASS}>Chưa cập nhật</span>;

  return (
    <span className="flex flex-wrap items-center justify-between gap-2">
      <span className={`${INFO_VALUE_CLASS} font-mono tracking-wider`}>{revealed ?? customer.nationalIdMasked}</span>
      {customer.permissions.canRevealNationalId && (
        <button
          type="button"
          onClick={async () => {
            // Gọi API (có ghi log) trong handler, KHÔNG trong updater của setState (StrictMode chạy updater 2 lần).
            if (revealed) setRevealed(null);
            else setRevealed(await revealNationalId());
          }}
          aria-pressed={Boolean(revealed)}
          title="Mỗi lần xem CCCD đầy đủ đều được ghi lại"
          className={BUTTON_LINK_CLASS}
        >
          <ToggleIcon size={14} aria-hidden="true" />
          {revealed ? 'Ẩn' : 'Hiện'}
        </button>
      )}
      {revealed && (
        <span className="inline-flex w-full items-center gap-1 text-theme-xs text-gray-500 dark:text-gray-400">
          <ShieldCheck size={12} aria-hidden="true" />
          Lần xem này đã được ghi vào nhật ký xem CCCD.
        </span>
      )}
      {viewLog.length > 0 && (
        <details className="w-full text-theme-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer select-none">Nhật ký xem CCCD ({viewLog.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {viewLog.slice(0, 10).map((entry) => (
              <li key={`${entry.viewer.id}-${entry.viewedAt}`}>
                {entry.viewer.displayName} — {formatVnDateTime(entry.viewedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Avatar chồng nhau của nhóm chăm sóc (★ = phụ trách chính)
// ---------------------------------------------------------------------------

const MEMBER_AVATAR_TONES = [CHIP_TONE_CLASS.brand, CHIP_TONE_CLASS.success, CHIP_TONE_CLASS.purple];
const AVATAR_BASE_CLASS = 'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ring-2 ring-white dark:ring-gray-900';

export const CareTeamAvatars = ({ members }: { members: CareTeamMemberView[] }) => (
  <div className="flex shrink-0 items-center -space-x-2">
    {members.map((member, index) => {
      const isPrimary = member.role === 'PRIMARY';
      const title = `${member.user.fullName}${isPrimary ? ' (phụ trách chính)' : ''}`;
      return (
        <div key={member.user.id} className="relative" title={title}>
          {member.user.avatarUrl ? (
            <img src={member.user.avatarUrl} alt={title} className={`${AVATAR_BASE_CLASS} object-cover`} />
          ) : (
            <span aria-label={title} className={`${AVATAR_BASE_CLASS} ${isPrimary ? CHIP_TONE_CLASS.warning : MEMBER_AVATAR_TONES[index % MEMBER_AVATAR_TONES.length]}`}>
              {getInitials(member.user.fullName)}
            </span>
          )}
          {isPrimary && (
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-warning-500 text-white ring-2 ring-white dark:ring-gray-900"
            >
              <Star size={8} fill="currentColor" strokeWidth={0} />
            </span>
          )}
        </div>
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------
// Gợi ý tiếp theo — CHỈ hiện khi có dữ liệu thật (không câu mặc định, không gắn nhãn AI)
// ---------------------------------------------------------------------------

export const NextStepNotice = ({ suggestions }: { suggestions: string[] }) => {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 dark:border-brand-500/25 dark:bg-brand-500/15">
      <Lightbulb size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
      <div className="min-w-0 space-y-1">
        <span className="text-sm font-semibold text-gray-800 dark:text-white/90">Gợi ý tiếp theo</span>
        <ul className="space-y-0.5 text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Thanh tiến độ (4 tiêu chí / độ đầy đủ chân dung)
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  percent: number;
  label: string;
  className?: string;
  fillClassName?: string;
}

export const ProgressBar = ({ percent, label, className = 'h-2', fillClassName = 'bg-brand-500' }: ProgressBarProps) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={percent}
    className={`w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800 ${className}`}
  >
    <div className={`h-full rounded-full transition-all duration-300 ${fillClassName}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
  </div>
);

// ---------------------------------------------------------------------------
// Ảnh đính kèm nhật ký (tải lên server ngay khi chọn; cờ `isAttachmentsEnabled`)
// ---------------------------------------------------------------------------

interface AttachedPhotoTrayProps {
  photos: AttachedPhoto[];
  onRemove: (index: number) => void;
}

export const AttachedPhotoTray = ({ photos, onRemove }: AttachedPhotoTrayProps) => {
  if (photos.length === 0) return null;
  return (
    <ul className="custom-scrollbar flex items-center gap-2 overflow-x-auto pb-1" aria-label="Ảnh đã đính kèm">
      {photos.map((photo, index) => (
        <li key={photo.key} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700" title={photo.errorMessage}>
          <img src={photo.previewUrl} alt={photo.name} className={`h-full w-full object-cover ${photo.status === 'ready' ? '' : 'opacity-50'}`} />
          {photo.status === 'uploading' && (
            <span role="status" aria-label="Đang tải ảnh lên" className="absolute inset-0 flex items-center justify-center text-white">
              <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            </span>
          )}
          {photo.status === 'error' && (
            <span role="alert" aria-label={photo.errorMessage ?? 'Tải ảnh lỗi'} className="absolute inset-0 flex items-center justify-center text-error-500">
              <TriangleAlert size={18} aria-hidden="true" />
            </span>
          )}
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

interface PhotoPickerButtonProps {
  /** Nhận file đã chọn; trả về số file bị bỏ qua để báo người dùng. */
  onPick: (files: FileList) => Promise<number>;
  onSkipped?: (skippedCount: number) => void;
  className: string;
  label?: string;
}

/** Nút chọn ảnh (input file thật, ẩn). */
export const PhotoPickerButton = ({ onPick, onSkipped, className, label = 'Đính kèm ảnh' }: PhotoPickerButtonProps) => {
  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    if (files && files.length > 0) {
      const skippedCount = await onPick(files);
      if (skippedCount > 0) onSkipped?.(skippedCount);
    }
    event.target.value = '';
  };

  return (
    <label className={`${className} cursor-pointer`}>
      <ImagePlus size={14} aria-hidden="true" />
      {label}
      <input type="file" accept={ATTACHMENT_ACCEPT.join(',')} multiple className="sr-only" onChange={handleChange} />
    </label>
  );
};
