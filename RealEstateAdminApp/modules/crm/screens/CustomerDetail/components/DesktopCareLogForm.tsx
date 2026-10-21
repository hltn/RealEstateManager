// Form "Thêm nhật ký chăm sóc" + hộp gợi ý STND AI (Admin CustomerDetailView, tab 3 - cột trái).
// Ô nhập/nhãn/nút theo mẫu form của Admin (UserManagementScreen.tsx:374-383); khay ảnh vẽ theo Stitch.
import { useState, type FormEvent } from 'react';
import { CalendarClock, CircleCheck, ImagePlus, MessageSquareText, Save } from 'lucide-react';
import type { Customer } from '@crm/types/crm';
import { ADMIN_CALL_RESULT_OPTIONS, DEFAULT_AI_SUGGESTION, DEFAULT_REMINDER_TEXT } from '../customerDetailUtils';
import { useAttachedPhotos } from '../useAttachedPhotos';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { AiSuggestionNotice, AttachedPhotoTray, CardHeading } from './DetailParts';
import {
  BUTTON_LINK_CLASS,
  BUTTON_PRIMARY_LG_CLASS,
  CARD_CLASS,
  DIVIDER_CLASS,
  FORM_LABEL_CLASS,
  SOLID_INPUT_CLASS,
} from '@crm/lib/uiClasses';

interface DesktopCareLogFormProps {
  customer: Customer;
}

export const DesktopCareLogForm = ({ customer }: DesktopCareLogFormProps) => {
  const { saveCareLog } = useCustomerDetailActions(customer.id);
  const { photos, addSamplePhoto, removePhoto, clearPhotos } = useAttachedPhotos();
  const [note, setNote] = useState('');
  const [callResult, setCallResult] = useState<string>(ADMIN_CALL_RESULT_OPTIONS[0]);
  const [nextReminder, setNextReminder] = useState(DEFAULT_REMINDER_TEXT);
  const isNoteEmpty = note.trim().length === 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const isSaved = saveCareLog({
      content: note,
      callResult,
      images: photos,
      tag: 'Cập nhật mới',
      toastTitle: 'Đã thêm nhật ký chăm sóc thành công!',
    });
    if (!isSaved) return;
    setNote('');
    clearPhotos();
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 xl:col-span-5">
      <form onSubmit={handleSubmit} aria-label="Thêm nhật ký chăm sóc" className={`${CARD_CLASS} @container space-y-5 p-5 md:p-6`}>
        <CardHeading
          icon={MessageSquareText}
          title="Thêm nhật ký chăm sóc"
          trailing={<span className="shrink-0 text-theme-xs text-gray-400 dark:text-gray-500">Cập nhật 2h trước</span>}
        />

        <div>
          <label htmlFor="desktop-care-log-note" className={FORM_LABEL_CLASS}>
            Nội dung trao đổi
          </label>
          <textarea
            id="desktop-care-log-note"
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ghi chú nhanh nội dung trao đổi, kết quả cuộc gọi, phản hồi từ khách..."
            className={`${SOLID_INPUT_CLASS} resize-none`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
          <div>
            <label htmlFor="desktop-care-log-result" className={FORM_LABEL_CLASS}>
              Kết quả liên hệ
            </label>
            <select
              id="desktop-care-log-result"
              value={callResult}
              onChange={(event) => setCallResult(event.target.value)}
              className={SOLID_INPUT_CLASS}
            >
              {ADMIN_CALL_RESULT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="desktop-care-log-reminder" className={FORM_LABEL_CLASS}>
              Nhắc việc tiếp theo
            </label>
            {/* Ô có icon (mẫu ManageWpScreen.tsx:738-748) */}
            <div className="relative">
              <CalendarClock
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                id="desktop-care-log-reminder"
                type="text"
                value={nextReminder}
                onChange={(event) => setNextReminder(event.target.value)}
                className={`${SOLID_INPUT_CLASS} pl-9`}
              />
            </div>
          </div>
        </div>

        {/* Ảnh đính kèm */}
        <div className={`space-y-2 border-t pt-4 ${DIVIDER_CLASS}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-theme-xs font-medium text-success-600 dark:text-success-500">
              <CircleCheck size={14} aria-hidden="true" />
              Đã chọn {photos.length} ảnh
            </span>
            <button type="button" onClick={addSamplePhoto} className={BUTTON_LINK_CLASS}>
              <ImagePlus size={14} aria-hidden="true" />
              Đính kèm
            </button>
          </div>
          <AttachedPhotoTray photos={photos} onRemove={removePhoto} />
        </div>

        <button type="submit" disabled={isNoteEmpty} className={`${BUTTON_PRIMARY_LG_CLASS} w-full disabled:cursor-not-allowed`}>
          <Save size={18} aria-hidden="true" />
          Lưu nhật ký chăm sóc
        </button>
      </form>

      <AiSuggestionNotice suggestion={customer.aiSuggestion || DEFAULT_AI_SUGGESTION} />
    </div>
  );
};
