// Thẻ "Nhật ký chăm sóc" của biến thể Mobile: form thêm nhật ký + gợi ý STND AI + dòng thời gian — phong cách Admin.
import { useState, type ChangeEvent } from 'react';
import { CircleCheck, ImagePlus, NotebookPen, Save, Zap } from 'lucide-react';
import { useContactActions } from '@crm/hooks/useContactActions';
import type { CareLog, Customer } from '@crm/types/crm';
import {
  DEFAULT_AI_SUGGESTION,
  DEFAULT_REMINDER_TEXT,
  MOBILE_CALL_RESULT_OPTIONS,
  MOBILE_REMINDER_OPTIONS,
} from '../customerDetailUtils';
import { useAttachedPhotos } from '../useAttachedPhotos';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { AiSuggestionNotice, AttachedPhotoTray } from './DetailParts';
import {
  BUTTON_LINK_CLASS,
  BUTTON_PRIMARY_LG_CLASS,
  CAPTION_CLASS,
  CHIP_CLASS,
  CHIP_TONE_CLASS,
  FORM_LABEL_CLASS,
  INSET_CLASS,
  SOLID_INPUT_CLASS,
} from '@crm/lib/uiClasses';
import { MobileCareTimeline } from './MobileCareTimeline';
import { MOBILE_CARD_CLASS, MobileSectionHeader } from './MobileSectionParts';

interface MobileCareLogSectionProps {
  customer: Customer;
  careLogs: CareLog[];
}

export const MobileCareLogSection = ({ customer, careLogs }: MobileCareLogSectionProps) => {
  const { openQuickNote } = useContactActions();
  const { saveCareLog } = useCustomerDetailActions(customer.id);
  const { photos, addSamplePhoto, removePhoto, clearPhotos } = useAttachedPhotos();
  const [note, setNote] = useState('');
  const [callResult, setCallResult] = useState<string>(MOBILE_CALL_RESULT_OPTIONS[0]);
  const [reminder, setReminder] = useState(DEFAULT_REMINDER_TEXT);
  const isNoteEmpty = note.trim().length === 0;

  /** Prototype chỉ mô phỏng upload: chọn file bất kỳ -> thêm 1 ảnh mẫu. */
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) addSamplePhoto();
    event.target.value = '';
  };

  const handleSave = () => {
    const isSaved = saveCareLog({
      content: note,
      callResult,
      images: photos,
      toastTitle: 'Đã thêm nhật ký chăm sóc mới!',
    });
    if (!isSaved) return;
    setNote('');
    clearPhotos();
  };

  return (
    <section aria-label="Nhật ký chăm sóc" className={MOBILE_CARD_CLASS}>
      <MobileSectionHeader
        icon={NotebookPen}
        title="Nhật ký chăm sóc"
        trailing={<span className={`${CHIP_CLASS} shrink-0 px-2 py-0.5 ${CHIP_TONE_CLASS.brand}`}>{careLogs.length}</span>}
      />

      {/* Form thêm nhật ký */}
      <div className={`${INSET_CLASS} space-y-3 p-3`}>
        <div className="flex items-center justify-between gap-2">
          <span className={CAPTION_CLASS}>Thêm nhật ký chăm sóc</span>
          <button type="button" onClick={() => openQuickNote(customer.id)} className={BUTTON_LINK_CLASS}>
            <Zap size={14} aria-hidden="true" />
            Ghi chú nhanh
          </button>
        </div>

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label="Nội dung nhật ký"
          placeholder="Ghi chú nhanh nội dung trao đổi, kết quả cuộc gọi..."
          rows={3}
          className={`${SOLID_INPUT_CLASS} resize-none`}
        />

        <div>
          <label htmlFor="mobile-care-log-result" className={FORM_LABEL_CLASS}>
            Kết quả liên hệ
          </label>
          <select
            id="mobile-care-log-result"
            value={callResult}
            onChange={(event) => setCallResult(event.target.value)}
            className={SOLID_INPUT_CLASS}
          >
            {MOBILE_CALL_RESULT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="mobile-care-log-reminder" className={FORM_LABEL_CLASS}>
            Nhắc việc tiếp theo
          </label>
          <select
            id="mobile-care-log-reminder"
            value={reminder}
            onChange={(event) => setReminder(event.target.value)}
            className={SOLID_INPUT_CLASS}
          >
            {MOBILE_REMINDER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {/* Ảnh đính kèm */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-500 transition hover:bg-brand-100 active:scale-95 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/20">
              <ImagePlus size={16} aria-hidden="true" />
              Đính kèm ảnh
              <input type="file" accept="image/*" multiple className="sr-only" onChange={handleFileChange} />
            </label>
            <span className="inline-flex items-center gap-1 text-theme-xs font-medium text-gray-600 dark:text-gray-400">
              <CircleCheck size={14} aria-hidden="true" className="text-success-500" />
              Đã chọn {photos.length} ảnh
            </span>
          </div>
          <AttachedPhotoTray photos={photos} onRemove={removePhoto} />
        </div>

        <button type="button" onClick={handleSave} disabled={isNoteEmpty} className={`${BUTTON_PRIMARY_LG_CLASS} w-full disabled:cursor-not-allowed`}>
          <Save size={16} aria-hidden="true" />
          Lưu nhật ký chăm sóc
        </button>
      </div>

      <AiSuggestionNotice suggestion={customer.aiSuggestion || DEFAULT_AI_SUGGESTION} />

      <MobileCareTimeline careLogs={careLogs} />
    </section>
  );
};
