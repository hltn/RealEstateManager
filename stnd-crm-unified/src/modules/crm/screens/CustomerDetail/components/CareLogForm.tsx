// Ô ghi chú nhanh ở đầu nhật ký (02 §4.3, C2, C3): nội dung + kênh + kết quả liên hệ + nhắc việc tiếp theo (+ tạo lịch hẹn).
// Chọn "kết quả liên hệ" -> gợi ý sẵn nội dung + mốc hẹn nhắc theo danh mục (người dùng sửa được trước khi lưu).
import { useState, type FormEvent } from 'react';
import { CalendarClock, CircleCheck, MessageSquareText, Save } from 'lucide-react';
import { useCatalogs, type CustomerDetail } from '@crm/api';
import { ToggleRow } from '@crm/components/form/ToggleRow';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { CONTACT_CHANNEL_LABELS, CONTACT_CHANNEL_ORDER } from '@crm/lib/customerAdapters';
import { getVnTodayKey } from '@crm/lib/dateTime';
import {
  BUTTON_DASHED_CLASS,
  BUTTON_PRIMARY_LG_CLASS,
  CARD_CLASS,
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
import { ReminderSelectField, ScheduleDateTimeFields } from '../../CreateAppointment/components/ScheduleDateTimeFields';
import { DEFAULT_REMINDER_MINUTES, DEFAULT_TIME, validateScheduleDateTime } from '../../CreateAppointment/createAppointmentForm';
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
  const { photos, attachmentIds, isUploading, addFiles, removePhoto, clearPhotos } = useAttachedPhotos(customer.id);
  const [isSaving, setIsSaving] = useState(false);
  const [content, setContent] = useState('');
  const [contactChannel, setContactChannel] = useState<ContactChannel>('CALL');
  const [contactResultId, setContactResultId] = useState('');
  const [nextSuggestion, setNextSuggestion] = useState('');
  const [nextDueLocal, setNextDueLocal] = useState('');
  const [shouldCreateAppointment, setShouldCreateAppointment] = useState(false);
  const [remindBeforeMinutes, setRemindBeforeMinutes] = useState(DEFAULT_REMINDER_MINUTES);
  // Đã bấm Lưu khi bật "Tạo lịch hẹn" mà ngày/giờ chưa hợp lệ: từ đó mới hiện lỗi cạnh ô (không báo lỗi khi người dùng chưa nhập xong).
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  // `nextDueLocal` đang là mốc MẶC ĐỊNH do công tắc điền sẵn (hôm nay 09:30), người dùng chưa chỉnh tay: gợi ý từ "kết quả liên hệ" được phép thay nó; mốc đã chỉnh tay thì không bao giờ bị ghi đè.
  const [isDueToggleDefault, setIsDueToggleDefault] = useState(false);
  const idPrefix = `care-log-${variant}`;
  const contactResults = catalogs.contactResults.filter((item) => item.isActive).sort((a, b) => a.order - b.order);
  const isContentEmpty = content.trim().length === 0;
  // Ngày + Giờ của lịch hẹn gộp trong `nextDueLocal` ("YYYY-MM-DDTHH:mm", giờ VN): BE lấy giờ bắt đầu lịch từ `nextAction.dueAt`.
  // Công tắc "Tạo lịch hẹn" TẮT thì không có ô ngày giờ nào và không gửi `dueAt` (chỉ lưu "việc cần làm tiếp theo").
  const [dueDate = '', dueTime = ''] = nextDueLocal.split('T');
  const scheduleErrors = shouldCreateAppointment ? validateScheduleDateTime(dueDate, dueTime.slice(0, 5)) : {};
  const shownScheduleErrors = hasTriedSubmit ? scheduleErrors : {};
  const dateInputId = `${idPrefix}-appointment-date`;
  const timeInputId = `${idPrefix}-appointment-time`;
  const hasAttachments = CRM_FEATURE_FLAGS.isAttachmentsEnabled;

  const handleResultChange = (resultId: string) => {
    setContactResultId(resultId);
    const result = contactResults.find((item) => item.id === resultId);
    if (!result) return;
    // Gợi ý mốc hẹn + việc tiếp theo theo kết quả liên hệ; chỉ điền khi người dùng chưa tự nhập.
    if (!nextSuggestion.trim() && result.suggestionText) setNextSuggestion(result.suggestionText);
    // Mốc gợi ý điền khi chưa có mốc, hoặc khi mốc còn là mặc định do công tắc điền (bật công tắc trước rồi mới chọn kết quả); mốc người dùng đã tự sửa thì giữ nguyên.
    const suggestedDue = toDateTimeLocalValue(getSuggestedFollowUpIso(result.suggestedFollowUpDays));
    if (suggestedDue && (!nextDueLocal || isDueToggleDefault)) {
      setNextDueLocal(suggestedDue);
      setIsDueToggleDefault(false);
    }
  };

  const reset = () => {
    setContent('');
    setContactResultId('');
    setNextSuggestion('');
    setNextDueLocal('');
    setIsDueToggleDefault(false);
    setShouldCreateAppointment(false);
    setRemindBeforeMinutes(DEFAULT_REMINDER_MINUTES);
    setHasTriedSubmit(false);
    clearPhotos();
  };

  // Gộp Ngày + Giờ thành `nextDueLocal`; cả hai rỗng = chưa đặt mốc ('' để không tính là "đã nhập").
  const composeDue = (date: string, time: string) => (date || time ? `${date}T${time}` : '');

  // Bật: chưa có mốc thì điền sẵn hôm nay + giờ mặc định của form Tạo lịch hẹn (đã có mốc gợi ý từ "kết quả liên hệ" thì dùng mốc đó). Tắt: giữ giá trị đã nhập để bật lại không mất, nhưng không gửi.
  const handleAppointmentToggle = (isOn: boolean) => {
    setShouldCreateAppointment(isOn);
    if (!isOn) setHasTriedSubmit(false);
    else if (!nextDueLocal) {
      setNextDueLocal(composeDue(getVnTodayKey(), DEFAULT_TIME));
      setIsDueToggleDefault(true);
    }
  };

  // Người dùng tự chọn Ngày/Giờ: từ đó mốc là của họ, gợi ý từ "kết quả liên hệ" không ghi đè nữa.
  const handleDueChange = (date: string, time: string) => {
    setNextDueLocal(composeDue(date, time));
    setIsDueToggleDefault(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving || isUploading) return;
    // Bật "Tạo lịch hẹn": kiểm ngày giờ như form Tạo lịch hẹn (bắt buộc, không ở quá khứ); sai thì hiện lỗi + đưa tiêu điểm tới ô sai, không gọi API.
    if (shouldCreateAppointment && (scheduleErrors.date || scheduleErrors.time)) {
      setHasTriedSubmit(true);
      document.getElementById(scheduleErrors.date ? dateInputId : timeInputId)?.focus();
      return;
    }
    // Công tắc tắt = không có mốc: `nextAction` chỉ còn `suggestion` (BE chấp nhận, không tạo lịch/nhắc).
    const dueAt = (shouldCreateAppointment && fromDateTimeLocalValue(nextDueLocal)) || null;
    const hasNextAction = Boolean(nextSuggestion.trim() || dueAt);
    setIsSaving(true);
    const isSaved = await saveCareLog({
      content,
      contactChannel,
      contactResultId: contactResultId || null,
      nextAction: hasNextAction
        ? { suggestion: nextSuggestion, dueAt, appointment: dueAt ? { type: 'CALLBACK', remindBeforeMinutes: [remindBeforeMinutes] } : undefined }
        : undefined,
      attachmentIds,
    });
    setIsSaving(false);
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
        <input
          type="text"
          value={nextSuggestion}
          onChange={(event) => setNextSuggestion(event.target.value)}
          aria-label="Việc cần làm tiếp theo"
          placeholder="VD: Gọi lại báo giá căn tầng cao"
          className={SOLID_INPUT_CLASS}
        />
        <ToggleRow title="Tạo lịch hẹn" description='Tạo lịch "Nhắc gọi lại" cho khách vào đúng ngày giờ đã chọn' isChecked={shouldCreateAppointment} onChange={handleAppointmentToggle} />
        {shouldCreateAppointment && (
          <div className="space-y-3">
            <ScheduleDateTimeFields
              dateId={dateInputId}
              timeId={timeInputId}
              date={dueDate}
              time={dueTime}
              dateError={shownScheduleErrors.date}
              timeError={shownScheduleErrors.time}
              onDateChange={(date) => handleDueChange(date, dueTime)}
              onTimeChange={(time) => handleDueChange(dueDate, time)}
              gridClassName="grid grid-cols-1 gap-3 @md:grid-cols-2"
            />
            <ReminderSelectField id={`${idPrefix}-appointment-remind`} value={remindBeforeMinutes} onChange={setRemindBeforeMinutes} />
          </div>
        )}
        <p className={FORM_HINT_CLASS}>
          {shouldCreateAppointment ? 'Lịch hẹn hiện ở "Việc hôm nay" đúng ngày hẹn (giờ Việt Nam).' : 'Bật "Tạo lịch hẹn" để đặt ngày giờ; không bật thì chỉ lưu việc cần làm tiếp theo.'}
        </p>
      </fieldset>

      {hasAttachments && (
        <div className={`space-y-2 border-t pt-4 ${DIVIDER_CLASS}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
              <CircleCheck size={16} aria-hidden="true" className={photos.length > 0 ? 'text-success-500' : 'text-gray-400'} />
              Ảnh đính kèm <span className="font-normal text-gray-500 dark:text-gray-400">(tuỳ chọn)</span>
            </span>
            <PhotoPickerButton
              className={BUTTON_DASHED_CLASS}
              label="Thêm ảnh"
              onPick={addFiles}
              onSkipped={(count) =>
                showToast({
                  type: 'warning',
                  title: `Bỏ qua ${count} ảnh`,
                  message: `Chỉ nhận ảnh JPEG/PNG/WebP ≤ ${MAX_PHOTO_BYTES / 1024 / 1024} MB, tối đa ${MAX_ATTACHED_PHOTOS} ảnh.`,
                })
              }
            />
          </div>
          <p className={FORM_HINT_CLASS}>
            JPEG, PNG hoặc WebP, tối đa {MAX_PHOTO_BYTES / 1024 / 1024} MB mỗi ảnh, tối đa {MAX_ATTACHED_PHOTOS} ảnh. Đã chọn {photos.length}/{MAX_ATTACHED_PHOTOS} ảnh.
          </p>
          <AttachedPhotoTray photos={photos} onRemove={removePhoto} />
        </div>
      )}

      <button type="submit" disabled={isContentEmpty || isSaving || isUploading} className={`${BUTTON_PRIMARY_LG_CLASS} w-full`}>
        <Save size={18} aria-hidden="true" />
        {isSaving ? 'Đang lưu…' : isUploading ? 'Đang tải ảnh…' : 'Lưu nhật ký'}
      </button>
    </form>
  );
};
