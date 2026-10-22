// Ô ghi chú nhanh ở đầu nhật ký (02 §4.3, C2, C3): nội dung + kênh + kết quả liên hệ + nhắc việc tiếp theo (+ tạo lịch hẹn).
// Chọn "kết quả liên hệ" -> gợi ý sẵn nội dung + mốc hẹn nhắc theo danh mục (người dùng sửa được trước khi lưu).
import { useState, type FormEvent } from 'react';
import { CalendarClock, CircleCheck, MessageSquareText, Save } from 'lucide-react';
import { useCatalogs, type CustomerDetail } from '@crm/api';
import { CONTACT_CHANNEL_LABELS, CONTACT_CHANNEL_ORDER } from '@crm/lib/customerAdapters';
import {
  BUTTON_LINK_CLASS,
  BUTTON_PRIMARY_LG_CLASS,
  CARD_CLASS,
  CHECKBOX_CLASS,
  DIVIDER_CLASS,
  FORM_HINT_CLASS,
  FORM_LABEL_CLASS,
  SOLID_INPUT_CLASS,
} from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { ContactChannel } from '@crm/types/crm';
import { fromDateTimeLocalValue, getSuggestedFollowUpIso, toDateTimeLocalValue } from '../customerDetailUtils';
import { MAX_ATTACHED_PHOTOS, MAX_PHOTO_BYTES, useAttachedPhotos } from '../useAttachedPhotos';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { AttachedPhotoTray, CardHeading, PhotoPickerButton } from './DetailParts';

interface CareLogFormProps {
  customer: CustomerDetail;
  variant: 'desktop' | 'mobile';
}

const MAX_CONTENT_LENGTH = 5000;

export const CareLogForm = ({ customer, variant }: CareLogFormProps) => {
  const { catalogs } = useCatalogs();
  const { showToast } = useCrmActions();
  const { saveCareLog } = useCustomerDetailActions(customer);
  const { photos, addFiles, removePhoto, clearPhotos } = useAttachedPhotos();
  const [content, setContent] = useState('');
  const [contactChannel, setContactChannel] = useState<ContactChannel>('CALL');
  const [contactResultId, setContactResultId] = useState('');
  const [nextSuggestion, setNextSuggestion] = useState('');
  const [nextDueLocal, setNextDueLocal] = useState('');
  const [shouldCreateAppointment, setShouldCreateAppointment] = useState(false);
  const idPrefix = `care-log-${variant}`;
  const contactResults = catalogs.contactResults.filter((item) => item.isActive).sort((a, b) => a.order - b.order);
  const isContentEmpty = content.trim().length === 0;

  const handleResultChange = (resultId: string) => {
    setContactResultId(resultId);
    const result = contactResults.find((item) => item.id === resultId);
    if (!result) return;
    // Gợi ý mốc hẹn + việc tiếp theo theo kết quả liên hệ; chỉ điền khi người dùng chưa tự nhập.
    if (!nextSuggestion.trim() && result.suggestionText) setNextSuggestion(result.suggestionText);
    if (!nextDueLocal) setNextDueLocal(toDateTimeLocalValue(getSuggestedFollowUpIso(result.suggestedFollowUpDays)));
  };

  const reset = () => {
    setContent('');
    setContactResultId('');
    setNextSuggestion('');
    setNextDueLocal('');
    setShouldCreateAppointment(false);
    clearPhotos();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dueAt = fromDateTimeLocalValue(nextDueLocal) || null;
    const hasNextAction = Boolean(nextSuggestion.trim() || dueAt);
    const isSaved = saveCareLog({
      content,
      contactChannel,
      contactResultId: contactResultId || null,
      nextAction: hasNextAction
        ? { suggestion: nextSuggestion, dueAt, appointment: shouldCreateAppointment && dueAt ? { type: 'CALLBACK' } : undefined }
        : undefined,
      images: photos,
    });
    if (isSaved) reset();
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Thêm nhật ký chăm sóc" className={`${CARD_CLASS} @container space-y-4 p-5`}>
      <CardHeading icon={MessageSquareText} title="Ghi chú chăm sóc" as="h3" />

      <div>
        <label htmlFor={`${idPrefix}-content`} className={FORM_LABEL_CLASS}>
          Nội dung trao đổi <span className="text-error-500">*</span>
        </label>
        <textarea
          id={`${idPrefix}-content`}
          rows={variant === 'mobile' ? 3 : 4}
          maxLength={MAX_CONTENT_LENGTH}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Ghi chú nhanh: kết quả cuộc gọi, phản hồi của khách..."
          className={`${SOLID_INPUT_CLASS} resize-none`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-channel`} className={FORM_LABEL_CLASS}>
            Kênh liên hệ
          </label>
          <select id={`${idPrefix}-channel`} value={contactChannel} onChange={(event) => setContactChannel(event.target.value as ContactChannel)} className={SOLID_INPUT_CLASS}>
            {CONTACT_CHANNEL_ORDER.map((channel) => (
              <option key={channel} value={channel}>
                {CONTACT_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-result`} className={FORM_LABEL_CLASS}>
            Kết quả liên hệ
          </label>
          <select id={`${idPrefix}-result`} value={contactResultId} onChange={(event) => handleResultChange(event.target.value)} className={SOLID_INPUT_CLASS}>
            <option value="">— Chưa chọn —</option>
            {contactResults.map((result) => (
              <option key={result.id} value={result.id}>
                {result.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className={`space-y-3 border-t pt-4 ${DIVIDER_CLASS}`}>
        <legend className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
          <CalendarClock size={16} aria-hidden="true" className="text-brand-500" />
          Nhắc việc tiếp theo
        </legend>
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
          <input
            type="text"
            value={nextSuggestion}
            onChange={(event) => setNextSuggestion(event.target.value)}
            aria-label="Việc cần làm tiếp theo"
            placeholder="VD: Gọi lại báo giá căn tầng cao"
            className={SOLID_INPUT_CLASS}
          />
          <input
            type="datetime-local"
            value={nextDueLocal}
            onChange={(event) => setNextDueLocal(event.target.value)}
            aria-label="Thời điểm nhắc"
            className={`${SOLID_INPUT_CLASS} dark:[color-scheme:dark]`}
          />
        </div>
        <label className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={shouldCreateAppointment}
            disabled={!nextDueLocal}
            onChange={(event) => setShouldCreateAppointment(event.target.checked)}
            className={CHECKBOX_CLASS}
          />
          Tạo lịch hẹn "Nhắc gọi lại" vào thời điểm này
        </label>
        <p className={FORM_HINT_CLASS}>Có thời điểm nhắc thì việc sẽ hiện ở "Việc hôm nay" đúng ngày (giờ Việt Nam).</p>
      </fieldset>

      <div className={`space-y-2 border-t pt-4 ${DIVIDER_CLASS}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-theme-xs font-medium text-gray-600 dark:text-gray-400">
            <CircleCheck size={14} aria-hidden="true" className={photos.length > 0 ? 'text-success-500' : 'text-gray-400'} />
            Đã chọn {photos.length} ảnh
          </span>
          <PhotoPickerButton
            className={BUTTON_LINK_CLASS}
            onPick={addFiles}
            onSkipped={(count) =>
              showToast({
                type: 'warning',
                title: `Bỏ qua ${count} ảnh`,
                message: `Chỉ nhận ảnh PNG/JPG/WebP/GIF ≤ ${MAX_PHOTO_BYTES / 1024 / 1024} MB, tối đa ${MAX_ATTACHED_PHOTOS} ảnh.`,
              })
            }
          />
        </div>
        <AttachedPhotoTray photos={photos} onRemove={removePhoto} />
      </div>

      <button type="submit" disabled={isContentEmpty} className={`${BUTTON_PRIMARY_LG_CLASS} w-full`}>
        <Save size={18} aria-hidden="true" />
        Lưu nhật ký
      </button>
    </form>
  );
};
