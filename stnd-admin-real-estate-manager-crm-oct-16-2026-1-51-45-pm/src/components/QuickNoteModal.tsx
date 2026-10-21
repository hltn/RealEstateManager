import React, { useState } from 'react';
import { Customer } from '../types/crm';

interface QuickNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
  onSaveNote: (customerId: string, note: string) => void;
}

export const QuickNoteModal: React.FC<QuickNoteModalProps> = ({
  isOpen,
  onClose,
  customer,
  onSaveNote
}) => {
  const [note, setNote] = useState('');

  if (!isOpen || !customer) return null;

  const handleSave = () => {
    if (note.trim()) {
      onSaveNote(customer.id, note.trim());
      setNote('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-gray-100 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-500">edit_note</span>
            <h3 className="font-bold text-gray-900 text-sm">Ghi chú nhanh — {customer.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg font-bold"
          >
            ×
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
            Nội dung tương tác mới
          </label>
          <textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: Khách vừa gọi lại xác nhận chiều nay rảnh sau 17h, cần gửi bảng tiến độ thanh toán đợt 2..."
            className="w-full p-3 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-brand-500 focus:bg-white resize-none"
            autoFocus
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={!note.trim()}
            onClick={handleSave}
            className="px-5 py-2 text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-lg shadow-theme-xs transition-colors disabled:opacity-50"
          >
            Lưu ghi chú
          </button>
        </div>
      </div>
    </div>
  );
};
