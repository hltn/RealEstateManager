import React from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning';
  title: string;
  message?: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] flex flex-col gap-2 w-[90%] max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto bg-gray-900/95 text-white p-3 rounded-xl shadow-theme-lg flex items-center justify-between gap-3 text-xs backdrop-blur-md border border-gray-800 animate-in slide-in-from-top duration-200"
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`material-symbols-outlined text-[18px] ${
                toast.type === 'success'
                  ? 'text-emerald-400'
                  : toast.type === 'warning'
                  ? 'text-amber-400'
                  : 'text-brand-400'
              }`}
            >
              {toast.type === 'success' ? 'check_circle' : toast.type === 'warning' ? 'warning' : 'info'}
            </span>
            <div>
              <p className="font-semibold text-white leading-tight">{toast.title}</p>
              {toast.message && <p className="text-gray-300 text-[11px] mt-0.5">{toast.message}</p>}
            </div>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-gray-400 hover:text-white p-1"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      ))}
    </div>
  );
};
