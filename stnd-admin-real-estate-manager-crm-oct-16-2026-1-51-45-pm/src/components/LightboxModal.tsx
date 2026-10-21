import React, { useEffect } from 'react';

interface LightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: { src: string; caption: string }[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  isOpen,
  onClose,
  images,
  currentIndex,
  onIndexChange
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndexChange((currentIndex + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndexChange((currentIndex - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, images.length, onClose, onIndexChange]);

  if (!isOpen || images.length === 0) return null;

  const currentImg = images[currentIndex] || images[0];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full bg-surface-container-lowest rounded-2xl overflow-hidden shadow-2xl border border-gray-700/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-500">photo_library</span>
            <h3 className="text-sm font-bold text-gray-900">
              Hình ảnh thực tế dự án — Q&apos;Terra &amp; Nhà mẫu
            </h3>
          </div>
          <button
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center font-bold text-lg transition-colors"
            onClick={onClose}
            title="Đóng (Esc)"
          >
            ×
          </button>
        </div>

        {/* Image viewport */}
        <div className="relative bg-gray-950 flex items-center justify-center min-h-[420px] max-h-[70vh]">
          <img
            alt={currentImg.caption}
            className="max-h-[68vh] max-w-full object-contain transition-all duration-200 select-none"
            src={currentImg.src}
          />

          {/* Navigation Controls */}
          {images.length > 1 && (
            <>
              <button
                className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center backdrop-blur-md transition-all active:scale-95 shadow-lg"
                onClick={() =>
                  onIndexChange((currentIndex - 1 + images.length) % images.length)
                }
                title="Ảnh trước"
              >
                <span className="material-symbols-outlined text-2xl">chevron_left</span>
              </button>
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center backdrop-blur-md transition-all active:scale-95 shadow-lg"
                onClick={() => onIndexChange((currentIndex + 1) % images.length)}
                title="Ảnh tiếp theo"
              >
                <span className="material-symbols-outlined text-2xl">chevron_right</span>
              </button>
            </>
          )}
        </div>

        {/* Footer info bar with thumbnails */}
        <div className="p-3 bg-white border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{currentImg.caption}</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Thumbnails strip */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              {images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => onIndexChange(idx)}
                  className={`w-9 h-7 rounded overflow-hidden border transition-all ${
                    idx === currentIndex
                      ? 'border-brand-500 ring-2 ring-brand-500/30 scale-105'
                      : 'border-gray-200 opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={img.src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>

            <span className="font-semibold text-brand-600 shrink-0">
              {currentIndex + 1} / {images.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
