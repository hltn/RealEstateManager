import React, { useState } from 'react';
import { Customer } from '../types';

interface QuickNoteModalProps {
  isOpen: boolean;
  customer: Customer | null;
  onClose: () => void;
  onSaveNote: (customerId: string, noteContent: string, statusText: string, reminderDate: string) => void;
}

export const QuickNoteModal: React.FC<QuickNoteModalProps> = ({
  isOpen,
  customer,
  onClose,
  onSaveNote,
}) => {
  const [content, setContent] = useState('');
  const [statusText, setStatusText] = useState('Khách quan tâm giá / Cần gửi bảng tính');
  const [reminder, setReminder] = useState('Hẹn gọi lại sau 2 ngày (07/10)');

  if (!isOpen || !customer) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    onSaveNote(customer.id, content.trim(), statusText, reminder);
    setContent('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-gray-200 shadow-theme-lg p-4 space-y-4 animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center justify-between pb-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-500 text-[20px]">
              edit_note
            </span>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Ghi chú & Nhắc việc</h3>
              <p className="text-[11px] text-gray-500">Khách: {customer.name} ({customer.phone})</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Nội dung trao đổi / Kết quả cuộc gọi
            </label>
            <textarea
              required
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Nhập ghi chú nhanh: Khách hỏi chính sách đợt 2, hẹn tư vấn cuối tuần..."
              className="w-full text-body-md border border-gray-200 rounded-lg p-2.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-gray-400 resize-none outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Tình trạng phản hồi
            </label>
            <select
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              className="w-full border border-gray-200 text-gray-700 font-body-md rounded-lg px-3 py-2 text-xs bg-white outline-none focus:border-brand-500"
            >
              <option value="Khách quan tâm giá / Cần gửi bảng tính">Khách quan tâm giá / Cần gửi bảng tính</option>
              <option value="Đang so sánh dự án khác">Đang so sánh dự án khác</option>
              <option value="Hẹn tham quan nhà mẫu">Hẹn tham quan nhà mẫu</option>
              <option value="Khách từ chối / Không đúng nhu cầu">Khách từ chối / Không đúng nhu cầu</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Hẹn lịch nhắc lại
            </label>
            <select
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
              className="w-full border border-gray-200 text-gray-700 font-body-md rounded-lg px-3 py-2 text-xs bg-white outline-none focus:border-brand-500"
            >
              <option value="Hẹn gọi lại sau 2 ngày (07/10)">Hẹn gọi lại sau 2 ngày (07/10)</option>
              <option value="Hẹn chiều mai (15:00)">Hẹn chiều mai (15:00)</option>
              <option value="Nhắc gửi brochure vào sáng thứ Hai">Nhắc gửi brochure vào sáng thứ Hai</option>
              <option value="Không cần nhắc hẹn">Không cần nhắc hẹn</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium text-xs transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="flex-1 h-10 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium text-xs shadow-theme-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              Lưu ghi chú
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
