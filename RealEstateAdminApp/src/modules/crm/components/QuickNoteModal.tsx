/**
 * Ghi chú nhanh - hợp nhất Admin `QuickNoteModal.tsx` (modal giữa màn) và
 * Mobile `QuickNoteModal.tsx` (bottom sheet): nội dung + kết quả liên hệ + hẹn nhắc lại (sinh việc ở "Việc hôm nay").
 * Lấy bộ trường đầy đủ của Mobile cho cả 2 biến thể.
 * - Web: vỏ `components/ui/modal` của Admin (`max-w-lg p-6`, Esc/khoá cuộn do Modal lo).
 * - App: `BottomSheet` (vẽ theo Stitch bằng token Admin).
 */
import { useState, type FormEvent } from 'react';
import { NotebookPen, Save } from 'lucide-react';
import { Modal } from '../../../components/ui/modal';
import { useCatalogs, useCrmApi } from '@crm/api';
import { formatPhoneDisplay } from '@crm/lib/phone';
import { useCrmActions } from '@crm/store';
import { BottomSheet } from './BottomSheet';
import { getSuggestedFollowUpIso } from '@crm/screens/CustomerDetail/customerDetailUtils';
import {
  BUTTON_OUTLINE_CLASS,
  BUTTON_PRIMARY_CLASS,
  FORM_LABEL_CLASS,
  MODAL_INPUT_CLASS,
  SOLID_INPUT_CLASS,
} from '@crm/lib/uiClasses';

/** Mốc nhắc lại nhanh (số ngày; null = không nhắc). Mốc thật tính theo ngày VN lúc lưu. */
const REMINDER_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: 'suggested', label: 'Theo kết quả liên hệ', days: null },
  { value: '1', label: 'Ngày mai 09:00', days: 1 },
  { value: '2', label: 'Sau 2 ngày 09:00', days: 2 },
  { value: '7', label: 'Sau 1 tuần 09:00', days: 7 },
  { value: 'none', label: 'Không cần nhắc', days: null },
];

export type QuickNoteVariant = 'dialog' | 'sheet';

const FORM_ID = 'crm-quick-note-form';
const TITLE_ID = 'crm-quick-note-title';

interface QuickNoteModalProps {
  customer: { id: string; fullName: string; phone: string };
  /** 'dialog' = modal giữa màn (web), 'sheet' = trượt từ đáy (app). */
  variant: QuickNoteVariant;
  onClose: () => void;
}

/** Ghi chú nhanh -> `POST /crm/customers/:id/care-logs` (tác giả = người dùng hiện tại, có nhắc việc tiếp theo). */
export const QuickNoteModal = ({ customer, variant, onClose }: QuickNoteModalProps) => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const { catalogs } = useCatalogs();
  const contactResults = catalogs.contactResults.filter((item) => item.isActive).sort((a, b) => a.order - b.order);
  const [content, setContent] = useState('');
  const [contactResultId, setContactResultId] = useState('');
  const [reminder, setReminder] = useState('suggested');
  const isSheet = variant === 'sheet';
  const trimmedContent = content.trim();
  const hasContent = trimmedContent.length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasContent) return;
    const result = contactResults.find((item) => item.id === contactResultId);
    const option = REMINDER_OPTIONS.find((item) => item.value === reminder);
    const days = reminder === 'suggested' ? (result?.suggestedFollowUpDays ?? null) : (option?.days ?? null);
    const dueAt = reminder === 'none' ? '' : getSuggestedFollowUpIso(days);
    const saved = api.createCareLog(customer.id, {
      content: trimmedContent,
      contactChannel: 'CALL',
      contactResultId: contactResultId || null,
      nextAction: dueAt || result?.suggestionText ? { suggestion: result?.suggestionText ?? '', dueAt: dueAt || null } : undefined,
    });
    if (!saved.ok) {
      showToast({ type: 'error', title: saved.error.message });
      return;
    }
    showToast({ title: `Đã ghi nhận tương tác cho ${customer.fullName}` });
    onClose();
  };

  // Nút hành động: trên sheet nằm ở chân cố định (ngoài <form>) nên gắn `form={FORM_ID}`.
  const actionButtons = (
    <div className={`flex items-center gap-3 ${isSheet ? '' : 'justify-end'}`}>
      <button type="button" onClick={onClose} className={`${BUTTON_OUTLINE_CLASS} ${isSheet ? 'h-11 flex-1' : ''}`}>
        Hủy
      </button>
      <button
        type="submit"
        form={FORM_ID}
        disabled={!hasContent}
        className={`${BUTTON_PRIMARY_CLASS} ${isSheet ? 'h-11 flex-[2]' : ''}`}
      >
        <Save size={16} aria-hidden="true" />
        Lưu ghi chú
      </button>
    </div>
  );

  const form = (
    <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="quick-note-content" className={FORM_LABEL_CLASS}>
          Nội dung trao đổi / Kết quả cuộc gọi <span className="text-error-500">*</span>
        </label>
        <textarea
          id="quick-note-content"
          required
          rows={isSheet ? 3 : 4}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Ví dụ: Khách vừa gọi lại xác nhận chiều nay rảnh sau 17h, cần gửi bảng tiến độ thanh toán đợt 2..."
          className={`${MODAL_INPUT_CLASS} resize-none`}
          autoFocus
        />
      </div>

      <div className={isSheet ? 'space-y-4' : 'grid grid-cols-2 gap-4'}>
        <div>
          <label htmlFor="quick-note-status" className={FORM_LABEL_CLASS}>
            Kết quả liên hệ
          </label>
          <select
            id="quick-note-status"
            value={contactResultId}
            onChange={(event) => setContactResultId(event.target.value)}
            className={SOLID_INPUT_CLASS}
          >
            <option value="">— Chưa chọn —</option>
            {contactResults.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="quick-note-reminder" className={FORM_LABEL_CLASS}>
            Hẹn lịch nhắc lại
          </label>
          <select
            id="quick-note-reminder"
            value={reminder}
            onChange={(event) => setReminder(event.target.value)}
            className={SOLID_INPUT_CLASS}
          >
            {REMINDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </form>
  );

  if (isSheet) {
    return (
      <BottomSheet
        titleId={TITLE_ID}
        title="Ghi chú & Nhắc việc"
        subtitle={`${customer.fullName} · ${formatPhoneDisplay(customer.phone)}`}
        onClose={onClose}
        footer={actionButtons}
      >
        {form}
      </BottomSheet>
    );
  }

  return (
    <Modal isOpen onClose={onClose} className="mx-4 max-w-lg p-6">
      <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
        {/* pr-12: chừa chỗ nút đóng tròn của Modal (góc phải trên) */}
        <div className="mb-5 flex items-start gap-3 pr-12">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
            <NotebookPen size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Ghi chú nhanh — {customer.fullName}
            </h3>
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">SĐT: {formatPhoneDisplay(customer.phone)}</p>
          </div>
        </div>
        {form}
        <div className="mt-6">{actionButtons}</div>
      </div>
    </Modal>
  );
};
