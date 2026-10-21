import React, { useState } from 'react';
import { STND_LOGO_URL } from '../data/mockData';

interface TopAppBarProps {
  onOpenMenu?: () => void;
  onResetData?: () => void;
  title?: string;
  subtitle?: string;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  onOpenMenu,
  onResetData,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-theme-xs flex justify-between items-center w-full h-[68px] sm:h-[76px] px-4">
      {/* Leading Action: Menu Hamburger */}
      <button
        aria-label="Menu"
        onClick={onOpenMenu}
        className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 transition-colors active:scale-95 duration-150"
        type="button"
      >
        <span className="material-symbols-outlined text-[24px]">menu</span>
      </button>

      {/* Center Brand: STND Monogram Logo */}
      <div className="flex items-center justify-center flex-1">
        <img
          src={STND_LOGO_URL}
          alt="STND Logo"
          className="h-9 sm:h-10 w-auto object-contain cursor-pointer transition-transform hover:scale-105"
          onError={(e) => {
            // Fallback in case of external network block
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <span className="sr-only">STND Real Estate CRM</span>
      </div>

      {/* Trailing Action: Options menu */}
      <div className="relative">
        <button
          aria-label="Tùy chọn"
          onClick={() => setShowDropdown(!showDropdown)}
          className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 transition-colors active:scale-95 duration-150"
          type="button"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="1"></circle>
            <circle cx="19" cy="12" r="1"></circle>
            <circle cx="5" cy="12" r="1"></circle>
          </svg>
        </button>

        {showDropdown && (
          <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-theme-lg border border-gray-100 py-1.5 z-50 text-body-md text-gray-700 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-3 py-1.5 border-b border-gray-100">
              <p className="font-semibold text-gray-900 text-xs">STND Real Estate CRM</p>
              <p className="text-[11px] text-gray-500">Phiên bản 4.4 Pro</p>
            </div>
            <button
              onClick={() => {
                setShowDropdown(false);
                if (onResetData) onResetData();
              }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2 text-label-xs text-gray-700"
            >
              <span className="material-symbols-outlined text-[16px] text-gray-500">restart_alt</span>
              Khôi phục dữ liệu mẫu
            </button>
            <button
              onClick={() => {
                setShowDropdown(false);
                window.print();
              }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2 text-label-xs text-gray-700"
            >
              <span className="material-symbols-outlined text-[16px] text-gray-500">print</span>
              In trang hiện tại
            </button>
            <div className="border-t border-gray-100 my-1"></div>
            <div className="px-3 py-1 text-[11px] text-gray-400">
              Chuyên viên: Hạnh ★ (Team Nam Sài Gòn)
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
