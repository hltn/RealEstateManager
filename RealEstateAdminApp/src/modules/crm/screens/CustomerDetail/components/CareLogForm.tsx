// Form ghi chú / chăm sóc của tab Nhật ký (02 §4.3, C2, C3): nội dung + kênh + kết quả liên hệ + nhắc việc tiếp theo (+ tạo lịch hẹn) + ảnh.
// Chọn "kết quả liên hệ" -> gợi ý sẵn nội dung + mốc hẹn nhắc theo danh mục (người dùng sửa được trước khi lưu).
// PT-020: KHÔNG hiện sẵn — chỉ được dựng khi người dùng bấm "Ghi chú" (xem `CareLogComposer`); luôn là bộ trường ĐẦY ĐỦ (khác hộp "Ghi chú nhanh").
// PT-022: có `editingLog` = SỬA nhật ký đã lưu (`PATCH care-logs/:logId`): điền sẵn dữ liệu cũ + ảnh đã đính kèm; không sửa "nhắc việc tiếp theo" (PATCH không nhận).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarClock, CircleCheck, MessageSquareText, Save, X } from 'lucide-react';
import { useCatalogs, type CareLogView, type CustomerDetail } from '@crm/api';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { CONTACT_CHANNEL_LABELS, CONTACT_CHANNEL_ORDER } from '@crm/lib/customerAdapters';
import {
  BUTTON_DASHED_CLASS,
  BUTTON_OUTLINE_LG_CLASS,
  BUTTON_PRIMARY_LG_CLASS,
  CARD_CLASS,
  CHECKBOX_CLASS,
  DIVIDER_CLASS,
  FORM_HINT_CLASS,
  FORM_LABEL_CLASS,
  ICON_BUTTON_CLASS,
  SOLID_INPUT_CLASS,
} from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { ContactChannel } from '@crm/types/crm';
import { fromDateTimeLocalValue, getSuggestedFollowUpIso, isCareLogDraftDirty, toDateTimeLocalValue } from '../customerDetailUtils';
import { MAX_ATTACHED_PHOTOS, MAX_PHOTO_BYTES, toExistingPhotos, useAttachedPhotos } from '../useAttachedPhotos';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import type { NoteComposerGuard } from '../useNoteComposer';
import { AttachedPhotoTray, CardHeading, PhotoPickerButton } from './DetailParts';

interface CareLogFormProps {
  customer: CustomerDetail;
  variant: 'desktop' | 'mobile';
  /** Có = đang SỬA nhật ký này (điền sẵn dữ liệu cũ); không có = thêm mới. */
  editingLog?: CareLogView;
  /** Đóng form NGAY sau khi lưu xong (và là mặc định của `onCancel`). */
  onClose: () => void;
  /** Người dùng bấm Hủy/X (không có = như `onClose`). Cho phép chỗ đặt form hỏi lại khi còn thay đổi chưa lưu. */
  onCancel?: () => void;
  /** Báo mỗi khi "còn thay đổi chưa lưu"/"đang lưu" đổi (xem `useNoteComposer`). */
  onGuardChange?: (guard: NoteComposerGuard) => void;
}

const MAX_CONTENT_LENGTH = 5000;

export const CareLogForm = ({ customer, variant, editingLog, onClose, onCancel = onClose, onGuardChange }: CareLogFormProps) => {
  const { catalogs } = useCatalogs();
  const { showToast } = useCrmActions();
  const { saveCareLog, updateCareLog } = useCustomerDetailActions(customer);
  const { photos, attachmentIds, isUploading, addFiles, removePhoto, clearPhotos } = useAttachedPhotos(customer.id, editingLog ? toExistingPhotos(editingLog) : []);
  const isEditing = Boolean(editingLog);
  const formRef = useRef<HTMLFormElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [content, setContent] = useState(editingLog?.content ?? '');
  const [contactChannel, setContactChannel] = useState<ContactChannel>(editingLog?.contactChannel ?? 'CALL');
  const [contactResultId, setContactResultId] = useState(editingLog?.contactResult?.id ?? '');
  const [nextSuggestion, setNextSuggestion] = useState('');
  const [nextDueLocal, setNextDueLocal] = useState('');
  const [shouldCreateAppointment, setShouldCreateAppointment] = useState(false);
  const idPrefix = `care-log-${variant}`;
  const activeResults = catalogs.contactResults.filter((item) => item.isActive).sort((a, b) => a.order - b.order);
  // Khi sửa: kết quả liên hệ hiện tại của nhật ký vẫn chọn được dù danh mục đã ẩn nó (không làm mất dữ liệu cũ).
  const currentResult = editingLog?.contactResult;
  const contactResults =
    currentResult && !activeResults.some((item) => item.id === currentResult.id)
      ? [...activeResults, { id: currentResult.id, label: currentResult.label, suggestionText: '', suggestedFollowUpDays: null, order: Number.MAX_SAFE_INTEGER, isActive: false }]
      : activeResults;
  const isContentEmpty = content.trim().length === 0;
  const hasAttachments = CRM_FEATURE_FLAGS.isAttachmentsEnabled;
  const hasPhotoChanges = photos.some((photo) => !photo.isExisting) || (editingLog ? photos.filter((photo) => photo.isExisting).length < editingLog.attachmentIds.length : false);
  const isDirty = isCareLogDraftDirty(
    { content, contactChannel, contactResultId, nextSuggestion, nextDueLocal, hasPhotoChanges },
    editingLog && { content: editingLog.content, contactChannel: editingLog.contactChannel, contactResultId: editingLog.contactResult?.id ?? '' },
  );

  // Báo chỗ đặt form để hỏi lại trước khi bỏ bản nháp (đổi sang form khác, Hủy/X).
  useEffect(() => {
    onGuardChange?.({ isDirty, isSaving });
  }, [isDirty, isSaving, onGuardChange]);

  // Mở form (bấm "Ghi chú"/"Sửa"): đưa form vào vùng nhìn thấy (mobile: form nằm dưới thẻ tóm tắt) rồi đặt con trỏ vào ô nội dung.
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    contentRef.current?.focus({ preventScroll: true });
  }, []);

  const handleResultChange = (resultId: string) => {
    setContactResultId(resultId);
    // Gợi ý việc tiếp theo chỉ áp dụng khi thêm mới (sửa nhật ký không đổi "nhắc việc tiếp theo").
    if (isEditing) return;
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

  // Ảnh mới đã tải lên mà chưa lưu được xóa khi form được gỡ (`useAttachedPhotos`), nên Hủy không tự xóa: nếu hộp "bỏ thay đổi?" bị từ chối thì ảnh còn nguyên.
  const handleCancel = () => onCancel();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving || isUploading) return;
    if (editingLog) {
      setIsSaving(true);
      const isUpdated = await updateCareLog(editingLog.id, {
        content,
        contactChannel,
        contactResultId: contactResultId || null,
        // Cờ ảnh tắt: không gửi `attachmentIds` để KHÔNG vô tình gỡ ảnh đã có của nhật ký.
        ...(hasAttachments ? { attachmentIds } : {}),
      });
      setIsSaving(false);
      if (isUpdated) {
        clearPhotos(); // ảnh mới đã gắn vào nhật ký: dọn khay để bước dọn khi gỡ form không xóa nhầm
        onClose();
      }
      return;
    }
    const dueAt = fromDateTimeLocalValue(nextDueLocal) || null;
    const hasNextAction = Boolean(nextSuggestion.trim() || dueAt);
    setIsSaving(true);
    const isSaved = await saveCareLog({
      content,
      contactChannel,
      contactResultId: contactResultId || null,
      nextAction: hasNextAction
        ? { suggestion: nextSuggestion, dueAt, appointment: shouldCreateAppointment && dueAt ? { type: 'CALLBACK' } : undefined }
        : undefined,
      attachmentIds,
    });
    setIsSaving(false);
    if (isSaved) {
      reset();
      onClose();
    }
  };

  // "Nhắc việc tiếp theo": chỉ khi THÊM MỚI (PATCH nhật ký không nhận nextAction nên khi sửa chỉ báo giữ nguyên).
  const nextActionSection = isEditing ? (
    <p className={`border-t pt-4 ${DIVIDER_CLASS} ${FORM_HINT_CLASS}`}>Việc tiếp theo và lịch hẹn đã tạo cùng nhật ký này được giữ nguyên.</p>
  ) : (
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
  );

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      aria-label={isEditing ? 'Sửa nhật ký chăm sóc' : 'Thêm nhật ký chăm sóc'}
      className={`${CARD_CLASS} @container scroll-mt-20 space-y-4 p-5`}
    >
      <CardHeading
        icon={MessageSquareText}
        title={isEditing ? 'Sửa nhật ký chăm sóc' : 'Ghi chú chăm sóc'}
        as="h3"
        trailing={
          <button type="button" onClick={handleCancel} disabled={isSaving} aria-label="Đóng form ghi chú" title="Đóng" className={ICON_BUTTON_CLASS}>
            <X size={18} aria-hidden="true" />
          </button>
        }
      />

      <div>
        <label htmlFor={`${idPrefix}-content`} className={FORM_LABEL_CLASS}>
          Nội dung trao đổi <span className="text-error-500">*</span>
        </label>
        <textarea
          ref={contentRef}
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

      {nextActionSection}

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

      <div className="flex items-center gap-3">
        <button type="button" onClick={handleCancel} disabled={isSaving} className={`${BUTTON_OUTLINE_LG_CLASS} shrink-0`}>
          Hủy
        </button>
        <button type="submit" disabled={isContentEmpty || isSaving || isUploading} className={`${BUTTON_PRIMARY_LG_CLASS} min-w-0 flex-1`}>
          <Save size={18} aria-hidden="true" />
          {isSaving ? 'Đang lưu…' : isUploading ? 'Đang tải ảnh…' : isEditing ? 'Lưu thay đổi' : 'Lưu nhật ký'}
        </button>
      </div>
    </form>
  );
};
