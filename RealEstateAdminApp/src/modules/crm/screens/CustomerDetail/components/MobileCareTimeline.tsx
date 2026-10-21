// "Dòng thời gian tương tác" của biến thể Mobile (đọc qua adapter `toTimelineEntries`).
// Timeline + lưới ảnh 2x2: Admin chưa có -> vẽ theo bố cục Stitch bằng token/màu/bo góc của Admin.
import { ChevronsUpDown, Images } from 'lucide-react';
import { formatCareLogStamp, toTimelineEntries } from '@crm/lib/customerAdapters';
import { formatCareLogDate } from '@crm/lib/dateTime';
import { useCrmActions } from '@crm/store';
import type { CareLog, GalleryImage } from '@crm/types/crm';
import { getHiddenImageCount, isLeadAuthor } from '../customerDetailUtils';
import { CAPTION_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';

interface MobileCareTimelineProps {
  careLogs: CareLog[];
}

/** Lưới 2x2: 3 ảnh + ảnh thứ 4 phủ "+N Xem tất cả" khi còn ảnh ẩn. */
const MAX_GRID_IMAGES = 4;
const PHOTO_GROUP_TITLE = 'Ảnh thực tế sa bàn & bản vẽ căn hộ';

const TimelinePhotos = ({ images }: { images: GalleryImage[] }) => {
  const { openLightbox } = useCrmActions();
  const hiddenCount = getHiddenImageCount(images.length, MAX_GRID_IMAGES);

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-1 text-theme-xs font-medium text-gray-600 dark:text-gray-400">
        <Images size={14} aria-hidden="true" className="shrink-0 text-brand-500 dark:text-brand-400" />
        <span>
          {PHOTO_GROUP_TITLE} ({images.length} ảnh)
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {images.slice(0, MAX_GRID_IMAGES).map((image, index) => {
          const isOverflowTile = index === MAX_GRID_IMAGES - 1 && hiddenCount > 0;
          return (
            <button
              key={`${image.src}-${index}`}
              type="button"
              onClick={() => openLightbox(images, index, PHOTO_GROUP_TITLE)}
              aria-label={isOverflowTile ? `Xem tất cả ${images.length} ảnh` : `Xem ảnh: ${image.caption}`}
              className="group relative h-20 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <img src={image.src} alt={image.caption} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
              {isOverflowTile ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/70 text-white">
                  <span className="text-lg font-semibold">+{hiddenCount}</span>
                  <span className="text-[10px] text-gray-200">Xem tất cả</span>
                </span>
              ) : (
                <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-gray-900/60 px-1.5 text-[10px] text-white">
                  {image.caption}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const MobileCareTimeline = ({ careLogs }: MobileCareTimelineProps) => {
  const entries = toTimelineEntries(careLogs);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className={CAPTION_CLASS}>Dòng thời gian tương tác</span>
        {entries.length > 1 && (
          <span className="inline-flex items-center gap-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
            <ChevronsUpDown size={12} aria-hidden="true" />
            Cuộn để xem tiếp
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <p className={`py-6 text-center ${MUTED_TEXT_CLASS}`}>Chưa có nhật ký chăm sóc nào.</p>
      ) : (
        <ol className="custom-scrollbar relative max-h-[420px] space-y-4 overflow-y-auto pl-6 pr-1 pt-1 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-gray-200 dark:before:bg-gray-800">
          {entries.map((entry) => {
            const isLead = isLeadAuthor(entry.author);
            return (
              <li key={entry.id} className="relative">
                <span
                  aria-hidden="true"
                  className={`absolute -left-6 top-0.5 h-4 w-4 rounded-full border-[3px] border-white dark:border-gray-900 ${
                    entry.isLatest ? 'bg-brand-500 ring-2 ring-brand-500/20' : isLead ? 'bg-brand-400' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                    {formatCareLogStamp({ date: formatCareLogDate(entry.date), time: entry.time })}
                  </span>
                  {entry.isLatest && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Mới nhất</span>}
                  <span className={`${CHIP_SMALL_CLASS} ${isLead ? CHIP_TONE_CLASS.brand : CHIP_TONE_CLASS.gray}`}>{entry.author}</span>
                </div>
                <p className="mt-1 text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">{entry.content}</p>
                {entry.images.length > 0 && <TimelinePhotos images={entry.images} />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
