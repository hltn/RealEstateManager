// "Dòng thời gian tương tác" (Admin CustomerDetailView, tab 3 - cột phải).
// Timeline + lưới ảnh thu nhỏ: Admin chưa có -> vẽ theo bố cục Stitch bằng token/màu/bo góc của Admin.
import { Activity, ChevronsUpDown, Images, Pencil } from 'lucide-react';
import { formatCareLogStamp } from '@crm/lib/customerAdapters';
import { formatCareLogDate } from '@crm/lib/dateTime';
import { useCrmActions } from '@crm/store';
import type { CareLog, GalleryImage } from '@crm/types/crm';
import { getHiddenImageCount, getShortCaption } from '../customerDetailUtils';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { CardHeading } from './DetailParts';
import { CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';

interface DesktopCareTimelineProps {
  customerId: string;
  careLogs: CareLog[];
}

/** Số ảnh thu nhỏ hiển thị trên mỗi nhật ký (ô thứ 4 là "+N Xem tất cả"). */
const VISIBLE_THUMBNAIL_COUNT = 3;
const PHOTO_GROUP_TITLE = 'Ảnh thực tế sa bàn & bản vẽ căn hộ';

const CareLogPhotos = ({ images }: { images: GalleryImage[] }) => {
  const { openLightbox } = useCrmActions();
  const hiddenCount = getHiddenImageCount(images.length, VISIBLE_THUMBNAIL_COUNT);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-theme-xs font-medium text-brand-500 dark:text-brand-400">
        <Images size={14} aria-hidden="true" />
        <span>
          {PHOTO_GROUP_TITLE} ({images.length} ảnh)
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {images.slice(0, VISIBLE_THUMBNAIL_COUNT).map((image, index) => (
          <button
            key={`${image.src}-${index}`}
            type="button"
            onClick={() => openLightbox(images, index, PHOTO_GROUP_TITLE)}
            aria-label={`Xem ảnh: ${image.caption}`}
            className="group relative aspect-video overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
          >
            <img src={image.src} alt={image.caption} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
            <span className="absolute inset-x-0 bottom-0 truncate bg-gray-900/60 px-1 py-0.5 text-center text-[10px] text-white">
              {getShortCaption(image.caption)}
            </span>
          </button>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => openLightbox(images, VISIBLE_THUMBNAIL_COUNT, PHOTO_GROUP_TITLE)}
            aria-label={`Xem tất cả ${images.length} ảnh`}
            className="flex aspect-video flex-col items-center justify-center rounded-lg bg-gray-900 text-white transition-colors hover:bg-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700"
          >
            <span className="text-sm font-semibold">+{hiddenCount}</span>
            <span className="text-[10px] text-gray-300">Xem tất cả</span>
          </button>
        )}
      </div>
    </div>
  );
};

export const DesktopCareTimeline = ({ customerId, careLogs }: DesktopCareTimelineProps) => {
  const { notify } = useCustomerDetailActions(customerId);

  return (
    <div className="min-w-0 xl:col-span-7">
      <section aria-label="Dòng thời gian tương tác" className={`${CARD_CLASS} space-y-5 p-5 md:p-6`}>
        <CardHeading
          icon={Activity}
          title="Dòng thời gian tương tác"
          trailing={
            careLogs.length > 1 && (
              <span className="inline-flex items-center gap-1 text-theme-xs text-gray-500 dark:text-gray-400">
                <ChevronsUpDown size={14} aria-hidden="true" />
                Cuộn để xem tiếp
              </span>
            )
          }
        />

        {careLogs.length === 0 ? (
          <p className={`py-10 text-center ${MUTED_TEXT_CLASS}`}>Chưa có nhật ký chăm sóc nào cho khách hàng này.</p>
        ) : (
          <div className="custom-scrollbar max-h-[640px] overflow-y-auto pr-2">
            <ol className="relative space-y-5 pl-7 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-0.5 before:bg-gray-200 dark:before:bg-gray-800">
              {careLogs.map((log, index) => {
                const isLatest = index === 0;
                return (
                  <li key={log.id} className="relative">
                    <span
                      aria-hidden="true"
                      className={`absolute -left-7 top-4 h-5 w-5 rounded-full border-4 border-white dark:border-gray-900 ${
                        isLatest ? 'bg-brand-500 ring-2 ring-brand-500/20' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    />
                    <article className={`${INSET_CLASS} space-y-3 p-4 transition-colors hover:border-brand-200 dark:hover:border-brand-500/30`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                            {formatCareLogStamp({ date: formatCareLogDate(log.date), time: log.time })}
                          </span>
                          {log.tag && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>{log.tag}</span>}
                          <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>{log.author}</span>
                          {log.contactMethod && (
                            <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.success}`}>{log.contactMethod}</span>
                          )}
                        </div>
                        {/* Nút icon trong bảng (ExternalLogsScreen.tsx:365) */}
                        <button
                          type="button"
                          title="Chỉnh sửa nhật ký"
                          aria-label="Chỉnh sửa nhật ký"
                          onClick={() => notify('Chỉnh sửa nhật ký này')}
                          className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-brand-50 hover:text-brand-500 dark:hover:bg-brand-500/10"
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                      </div>

                      <p className="text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">{log.content}</p>

                      {log.images && log.images.length > 0 && <CareLogPhotos images={log.images} />}
                    </article>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
};
