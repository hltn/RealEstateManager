// Dòng thời gian nhật ký chăm sóc (C2, 02 §5 "Mục dòng thời gian"): ngày giờ đầy đủ (giờ VN), người viết,
// dấu "Chính" chỉ khi tác giả là phụ trách chính của khách, kênh + kết quả liên hệ, bước tiếp theo, ảnh đính kèm.
import { Activity, CalendarClock, Images, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CareLogView } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { CONTACT_CHANNEL_LABELS } from '@crm/lib/customerAdapters';
import { formatVnDateTime, formatVnRelative } from '@crm/lib/dateTime';
import { CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { GalleryImage } from '@crm/types/crm';
import { getHiddenImageCount, getShortCaption } from '../customerDetailUtils';
import { useRemoveCareLogPhoto } from '../useRemoveCareLogPhoto';
import { CardHeading } from './DetailParts';

const VISIBLE_THUMBNAIL_COUNT = 3;
const IMAGE_RETRY_INTERVAL_MS = 30_000;
const PHOTO_GROUP_TITLE = 'Ảnh đính kèm';

interface CareLogPhotosProps {
  images: GalleryImage[];
  /** Id ảnh song song với `images`; chỉ truyền khi người xem được phép gỡ ảnh của nhật ký này. */
  removableAttachmentIds?: string[];
  onRemovePhoto?: (attachmentId: string) => Promise<boolean>;
  isRemoving?: boolean;
  onImageError?: () => void;
}

const CareLogPhotos = ({ images, removableAttachmentIds, onRemovePhoto, isRemoving = false, onImageError }: CareLogPhotosProps) => {
  const { openLightbox } = useCrmActions();
  const [pendingAttachmentId, setPendingAttachmentId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const canRemove = Boolean(removableAttachmentIds && onRemovePhoto);
  const hiddenCount = getHiddenImageCount(images.length, VISIBLE_THUMBNAIL_COUNT);
  // Người có quyền sửa: "+N" mở rộng toàn bộ ảnh để gỡ được từng ảnh; người chỉ xem: "+N" mở lightbox như cũ.
  const visibleImages = isExpanded ? images : images.slice(0, VISIBLE_THUMBNAIL_COUNT);

  const confirmRemove = async () => {
    if (!pendingAttachmentId || !onRemovePhoto) return;
    await onRemovePhoto(pendingAttachmentId);
    setPendingAttachmentId(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-theme-xs font-medium text-brand-500 dark:text-brand-400">
        <Images size={14} aria-hidden="true" />
        {PHOTO_GROUP_TITLE} ({images.length} ảnh)
      </div>
      <div className="grid grid-cols-4 gap-2">
        {visibleImages.map((image, index) => {
          const attachmentId = removableAttachmentIds?.[index];
          return (
            <div key={`${image.src.slice(-24)}-${index}`} className="relative">
              <button
                type="button"
                onClick={() => openLightbox(images, index, PHOTO_GROUP_TITLE)}
                aria-label={`Xem ảnh: ${image.caption || 'đính kèm'}`}
                className="group relative block aspect-video w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <img data-testid="care-log-photo" src={image.src} alt={image.caption} onError={onImageError} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-gray-900/60 px-1 py-0.5 text-center text-[10px] text-white">
                  {getShortCaption(image.caption)}
                </span>
              </button>
              {attachmentId && onRemovePhoto && (
                <button
                  type="button"
                  data-testid="care-log-photo-remove"
                  onClick={() => setPendingAttachmentId(attachmentId)}
                  aria-label={`Xóa ảnh ${index + 1} khỏi nhật ký`}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-gray-900/70 text-white transition-colors hover:bg-error-500"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && !isExpanded && (
          <button
            type="button"
            onClick={() => (canRemove ? setIsExpanded(true) : openLightbox(images, VISIBLE_THUMBNAIL_COUNT, PHOTO_GROUP_TITLE))}
            aria-label={canRemove ? `Hiện thêm ${hiddenCount} ảnh` : `Xem tất cả ${images.length} ảnh`}
            className="flex aspect-video flex-col items-center justify-center rounded-lg bg-gray-900 text-white transition-colors hover:bg-gray-800 dark:bg-gray-800"
          >
            <span className="text-sm font-semibold">+{hiddenCount}</span>
            <span className="text-[10px] text-gray-300">{canRemove ? 'Hiện thêm' : 'Xem tất cả'}</span>
          </button>
        )}
      </div>
      {isExpanded && hiddenCount > 0 && (
        <button type="button" onClick={() => setIsExpanded(false)} className="text-theme-xs font-medium text-brand-500 hover:underline">
          Thu gọn
        </button>
      )}
      <ConfirmDialog
        isOpen={pendingAttachmentId !== null}
        title="Gỡ ảnh khỏi nhật ký?"
        description="Ảnh sẽ không còn hiện trong nhật ký này và không khôi phục được."
        confirmLabel={isRemoving ? 'Đang gỡ…' : 'Xác nhận gỡ ảnh'}
        cancelLabel="Giữ ảnh"
        tone="danger"
        onConfirm={() => void confirmRemove()}
        onCancel={() => !isRemoving && setPendingAttachmentId(null)}
      />
    </div>
  );
};

interface CareTimelineProps {
  careLogs: CareLogView[];
  /** Có khung thẻ + tiêu đề (desktop) hay danh sách trần (nằm trong thẻ khác). */
  isFramed?: boolean;
  isLoading?: boolean;
  /** Còn nhật ký cũ hơn chưa tải (phân trang 20 mục/lần). */
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Ảnh không tải được (URL ký 15 phút đã hết hạn): tải lại nhật ký để lấy URL mới. */
  onImageError?: () => void;
  /** Khách đang xem: cần để gỡ ảnh khỏi nhật ký đã lưu. */
  customerId: string;
}

export const CareTimeline = ({ careLogs, isFramed = true, isLoading = false, hasMore = false, isLoadingMore = false, onLoadMore, onImageError, customerId }: CareTimelineProps) => {
  const { removePhoto, isRemoving } = useRemoveCareLogPhoto(customerId);
  const lastImageRetry = useRef(0);
  /** Tối đa 1 lần làm mới / 30 giây để URL hỏng thật không gây vòng lặp tải. */
  const handleImageError = onImageError
    ? () => {
        if (Date.now() - lastImageRetry.current < IMAGE_RETRY_INTERVAL_MS) return;
        lastImageRetry.current = Date.now();
        onImageError();
      }
    : undefined;
  const list = isLoading ? (
    <div aria-busy="true" aria-label="Đang tải nhật ký" className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ))}
    </div>
  ) : (
    careLogs.length === 0 ? (
      <p className={`py-8 text-center ${MUTED_TEXT_CLASS}`}>Chưa có nhật ký chăm sóc nào cho khách hàng này.</p>
    ) : (
      <ol className="relative space-y-4 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-gray-200 dark:before:bg-gray-800">
        {careLogs.map((log, index) => (
          <li key={log.id} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -left-6 top-4 h-4 w-4 rounded-full border-[3px] border-white dark:border-gray-900 ${
                index === 0 ? 'bg-brand-500 ring-2 ring-brand-500/20' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            />
            <article className={`${INSET_CLASS} space-y-2.5 p-4`}>
              <div className="flex flex-wrap items-center gap-2">
                <time dateTime={log.occurredAt} title={formatVnDateTime(log.occurredAt)} className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  {formatVnRelative(log.occurredAt)}
                </time>
                <span className={`${CHIP_SMALL_CLASS} ${log.isPrimaryAuthor ? CHIP_TONE_CLASS.warning : CHIP_TONE_CLASS.gray}`}>
                  {log.isPrimaryAuthor ? `★ ${log.author.displayName} (Chính)` : log.author.displayName}
                </span>
                <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.success}`}>{CONTACT_CHANNEL_LABELS[log.contactChannel]}</span>
                {log.contactResult && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>{log.contactResult.label}</span>}
              </div>
              <p className="whitespace-pre-line text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">{log.content}</p>
              {log.nextAction && (log.nextAction.suggestion || log.nextAction.dueAt) && (
                <p className="flex items-start gap-1.5 text-theme-xs text-gray-600 dark:text-gray-400">
                  <CalendarClock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-500" />
                  <span>
                    Tiếp theo: {log.nextAction.suggestion || 'Chăm sóc lại'}
                    {log.nextAction.dueAt && ` — ${formatVnDateTime(log.nextAction.dueAt)}`}
                  </span>
                </p>
              )}
              {log.images.length > 0 && (
                <CareLogPhotos
                  images={log.images}
                  removableAttachmentIds={log.canEdit ? log.attachmentIds : undefined}
                  onRemovePhoto={removePhoto}
                  isRemoving={isRemoving}
                  onImageError={handleImageError}
                />
              )}
            </article>
          </li>
        ))}
      </ol>
    )
  );
  const loadMore = hasMore && onLoadMore && (
    <button type="button" onClick={onLoadMore} disabled={isLoadingMore} className="mx-auto mt-2 block text-theme-sm font-medium text-brand-500 hover:underline disabled:opacity-60">
      {isLoadingMore ? 'Đang tải…' : 'Xem nhật ký cũ hơn'}
    </button>
  );
  const content = (
    <>
      {list}
      {loadMore}
    </>
  );

  if (!isFramed) return content;
  return (
    <section aria-label="Nhật ký chăm sóc" className={`${CARD_CLASS} space-y-4 p-5`}>
      <CardHeading icon={Activity} title="Nhật ký chăm sóc" as="h3" trailing={<span className={MUTED_TEXT_CLASS}>{careLogs.length}{hasMore ? '+' : ''} mục</span>} />
      {content}
    </section>
  );
};
