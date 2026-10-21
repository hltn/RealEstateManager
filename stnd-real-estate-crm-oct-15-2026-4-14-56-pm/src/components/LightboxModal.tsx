import React, { useEffect } from 'react';

export interface GalleryPhoto {
  url: string;
  title: string;
}

interface LightboxModalProps {
  isOpen: boolean;
  photos: GalleryPhoto[];
  currentIndex: number;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  isOpen,
  photos,
  currentIndex,
  onClose,
  onSelectIndex,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onSelectIndex((currentIndex + 1) % photos.length);
      if (e.key === 'ArrowLeft') onSelectIndex((currentIndex - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, photos.length, onClose, onSelectIndex]);

  if (!isOpen || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex] || photos[0];

  const handleNext = () => {
    onSelectIndex((currentIndex + 1) % photos.length);
  };

  const handlePrev = () => {
    onSelectIndex((currentIndex - 1 + photos.length) % photos.length);
  };

  return (
    <div
      id="image-lightbox-modal"
      className="fixed inset-0 z-50 bg-gray-950/95 backdrop-blur-md flex flex-col justify-between max-w-md mx-auto animate-in fade-in duration-200"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 text-white">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-brand-400 text-[20px]">
            photo_library
          </span>
          <span className="text-body-md font-semibold text-white">
            Ảnh {currentIndex + 1} / {photos.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-300 hover:text-white transition-colors"
          aria-label="Đóng xem ảnh"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      {/* Main Image View */}
      <div className="relative flex-1 flex items-center justify-center p-3 overflow-hidden">
        <button
          type="button"
          onClick={handlePrev}
          className="absolute left-3 z-10 w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center border border-white/20 active:scale-95 transition-all"
          aria-label="Ảnh trước"
        >
          <span className="material-symbols-outlined text-[24px]">chevron_left</span>
        </button>

        <div className="w-full h-full flex flex-col items-center justify-center">
          <img
            src={currentPhoto.url}
            alt={currentPhoto.title}
            className="max-h-[62vh] max-w-full rounded-xl object-contain shadow-2xl transition-all duration-300"
          />
          <p className="text-center text-body-md text-gray-300 mt-2 px-4 py-1 rounded-full bg-gray-900/80 border border-gray-800 text-[12px]">
            {currentPhoto.title}
          </p>
        </div>

        <button
          type="button"
          onClick={handleNext}
          className="absolute right-3 z-10 w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center border border-white/20 active:scale-95 transition-all"
          aria-label="Ảnh sau"
        >
          <span className="material-symbols-outlined text-[24px]">chevron_right</span>
        </button>
      </div>

      {/* Bottom Thumbnails */}
      <div className="p-3 bg-gray-900/90 border-t border-gray-800">
        <div className="flex items-center justify-center gap-2 overflow-x-auto py-1 no-scrollbar">
          {photos.map((item, idx) => {
            const isSelected = idx === currentIndex;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectIndex(idx)}
                className={`w-11 h-11 rounded-lg overflow-hidden border-2 shrink-0 transition-all ${
                  isSelected
                    ? 'border-brand-500 scale-105'
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                <img
                  src={item.url}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
