/**
 * Xem ảnh phóng to - hợp nhất Admin `LightboxModal.tsx` (hộp thoại có header/thumbnail)
 * và Mobile `LightboxModal.tsx` (toàn màn hình nền tối).
 * Vỏ = `components/ui/modal` của Admin (Esc để đóng, khoá cuộn, z-99999):
 * - 'dialog' (web): `max-w-4xl`, đầu/chân theo nền hộp thoại Admin `bg-white dark:bg-gray-900`;
 * - 'fullscreen' (app): `isFullscreen`, nền tối cố định (vùng xem ảnh luôn tối ở cả 2 chế độ).
 * Phần lightbox (khung ảnh, nút chuyển, dải thumbnail) Admin chưa có → vẽ theo Stitch bằng token Admin.
 * Dữ liệu ảnh chuẩn: GalleryImage { src, caption }.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react';
import { Modal } from '../../../components/ui/modal';
import type { GalleryImage } from '@crm/types/crm';

export type LightboxVariant = 'dialog' | 'fullscreen';

export const DEFAULT_LIGHTBOX_TITLE = "Hình ảnh thực tế dự án — Q'Terra & Nhà mẫu";

const TITLE_ID = 'crm-lightbox-title';

/** Nút chuyển ảnh tròn nổi trên ảnh — luôn trên nền tối nên dùng trắng mờ cho cả 2 chế độ. */
const NAV_BUTTON_CLASS =
  'absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 active:scale-95';

interface LightboxModalProps {
  images: GalleryImage[];
  startIndex?: number;
  title?: string;
  /** 'dialog' = web (Admin), 'fullscreen' = app (Mobile). */
  variant: LightboxVariant;
  onClose: () => void;
}

/** Chỉ số vòng: -1 -> cuối, length -> 0. */
export const wrapIndex = (index: number, length: number): number => ((index % length) + length) % length;

interface ThumbnailStripProps {
  images: GalleryImage[];
  currentIndex: number;
  onSelect: (index: number) => void;
  sizeClass: string;
  idleClass: string;
}

const ThumbnailStrip = ({ images, currentIndex, onSelect, sizeClass, idleClass }: ThumbnailStripProps) => (
  <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
    {images.map((image, index) => {
      const isCurrent = index === currentIndex;
      return (
        <button
          key={`${image.src}-${index}`}
          type="button"
          onClick={() => onSelect(index)}
          aria-label={`Xem ảnh ${index + 1}`}
          aria-current={isCurrent}
          className={`shrink-0 overflow-hidden rounded-lg border-2 transition-all ${sizeClass} ${
            isCurrent ? 'border-brand-500 ring-2 ring-brand-500/30' : `opacity-60 hover:opacity-100 ${idleClass}`
          }`}
        >
          <img src={image.src} alt="" className="h-full w-full object-cover" />
        </button>
      );
    })}
  </div>
);

export const LightboxModal = ({ images, startIndex = 0, title = DEFAULT_LIGHTBOX_TITLE, variant, onClose }: LightboxModalProps) => {
  const [currentIndex, setCurrentIndex] = useState(() => wrapIndex(startIndex, Math.max(images.length, 1)));
  const imageCount = images.length;

  const showPrevious = useCallback(() => setCurrentIndex((index) => wrapIndex(index - 1, imageCount)), [imageCount]);
  const showNext = useCallback(() => setCurrentIndex((index) => wrapIndex(index + 1, imageCount)), [imageCount]);

  // Mũi tên trái/phải chuyển ảnh (Esc do Modal của Admin xử lý).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') showNext();
      if (event.key === 'ArrowLeft') showPrevious();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showNext, showPrevious]);

  if (imageCount === 0) return null;
  const currentImage = images[currentIndex] ?? images[0];
  const hasMultipleImages = imageCount > 1;

  const navButtons = hasMultipleImages && (
    <>
      <button type="button" onClick={showPrevious} aria-label="Ảnh trước" className={`${NAV_BUTTON_CLASS} left-3`}>
        <ChevronLeft size={24} aria-hidden="true" />
      </button>
      <button type="button" onClick={showNext} aria-label="Ảnh sau" className={`${NAV_BUTTON_CLASS} right-3`}>
        <ChevronRight size={24} aria-hidden="true" />
      </button>
    </>
  );

  if (variant === 'fullscreen') {
    return (
      <Modal isOpen onClose={onClose} isFullscreen showCloseButton={false} className="bg-gray-950">
        <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} className="flex h-dvh flex-col bg-gray-950 text-white">
          <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <Images size={20} className="text-brand-400" aria-hidden="true" />
              <span id={TITLE_ID} className="text-sm font-semibold">
                Ảnh {currentIndex + 1} / {imageCount}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng xem ảnh"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-gray-300 transition-colors hover:bg-white/20 hover:text-white"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-3">
            {navButtons}
            <img src={currentImage.src} alt={currentImage.caption} className="max-h-[62dvh] max-w-full rounded-xl object-contain" />
            <p className="mt-3 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-center text-xs text-gray-300">
              {currentImage.caption}
            </p>
          </div>

          <footer className="shrink-0 border-t border-white/10 bg-gray-900/80 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <div className="flex justify-center">
              <ThumbnailStrip
                images={images}
                currentIndex={currentIndex}
                onSelect={setCurrentIndex}
                sizeClass="h-11 w-11"
                idleClass="border-transparent"
              />
            </div>
          </footer>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} showCloseButton={false} className="mx-4 max-w-4xl overflow-hidden">
      <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-2">
            <Images size={20} className="shrink-0 text-brand-500 dark:text-brand-400" aria-hidden="true" />
            <h3 id={TITLE_ID} className="truncate text-lg font-semibold text-gray-800 dark:text-white/90">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Đóng (Esc)"
            aria-label="Đóng xem ảnh"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="relative flex min-h-[420px] items-center justify-center bg-gray-950">
          <img alt={currentImage.caption} src={currentImage.src} className="max-h-[65vh] max-w-full select-none object-contain" />
          {navButtons}
        </div>

        <footer className="flex flex-col items-center justify-between gap-3 border-t border-gray-200 px-6 py-3 sm:flex-row dark:border-gray-800">
          <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{currentImage.caption}</span>
          <div className="flex min-w-0 items-center gap-3">
            <ThumbnailStrip
              images={images}
              currentIndex={currentIndex}
              onSelect={setCurrentIndex}
              sizeClass="h-8 w-10"
              idleClass="border-gray-200 dark:border-gray-700"
            />
            <span className="shrink-0 text-theme-sm font-semibold text-brand-500 dark:text-brand-400">
              {currentIndex + 1} / {imageCount}
            </span>
          </div>
        </footer>
      </div>
    </Modal>
  );
};
