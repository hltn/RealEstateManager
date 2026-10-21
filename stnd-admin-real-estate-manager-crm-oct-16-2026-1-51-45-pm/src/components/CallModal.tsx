import React, { useState, useEffect } from 'react';

interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  customerPhone: string;
  projectName?: string;
  onSaveLog?: (note: string, callOutcome: string) => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  isOpen,
  onClose,
  customerName,
  customerPhone,
  projectName = "Q'Terra",
  onSaveLog
}) => {
  const [seconds, setSeconds] = useState(0);
  const [isCalling, setIsCalling] = useState(true);
  const [callOutcome, setCallOutcome] = useState('Khách quan tâm giá / Cần gửi bảng tính');
  const [callNote, setCallNote] = useState('');

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen && isCalling) {
      timer = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isOpen, isCalling]);

  if (!isOpen) return null;

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    setIsCalling(false);
  };

  const handleSaveAndClose = () => {
    if (onSaveLog) {
      onSaveLog(
        callNote || `Cuộc gọi ${formatTimer(seconds)} với ${customerName}: ${callOutcome}`,
        callOutcome
      );
    }
    onClose();
    setSeconds(0);
    setIsCalling(true);
    setCallNote('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Call Status Header */}
        <div className="bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-700 text-white p-6 text-center relative">
          <div className="w-16 h-16 rounded-full bg-white/20 border-2 border-white/40 mx-auto flex items-center justify-center font-bold text-2xl mb-3 shadow-lg">
            {customerName.charAt(0)}
          </div>
          <h3 className="text-xl font-bold tracking-tight">{customerName}</h3>
          <p className="text-brand-100 text-sm mt-0.5">{customerPhone}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-xs font-medium border border-white/20">
            <span className="material-symbols-outlined text-xs">apartment</span>
            <span>Dự án: {projectName}</span>
          </div>

          <div className="mt-4">
            <span
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
                isCalling ? 'bg-emerald-500/30 text-emerald-100 border border-emerald-400/40' : 'bg-gray-700/50 text-gray-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isCalling ? 'bg-emerald-400 animate-ping' : 'bg-gray-400'
                }`}
              ></span>
              {isCalling ? `Đang kết nối: ${formatTimer(seconds)}` : 'Cuộc gọi đã kết thúc'}
            </span>
          </div>
        </div>

        {/* Content & In-Call Note Taker */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Kết quả liên hệ
            </label>
            <select
              value={callOutcome}
              onChange={(e) => setCallOutcome(e.target.value)}
              className="w-full h-10 px-3 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-800 focus:outline-none focus:border-brand-500 focus:bg-white"
            >
              <option value="Khách quan tâm giá / Cần gửi bảng tính">
                Khách quan tâm giá / Cần gửi bảng tính
              </option>
              <option value="Hẹn đi xem thực tế sa bàn và nhà mẫu">
                Hẹn đi xem thực tế sa bàn và nhà mẫu
              </option>
              <option value="Cần tư vấn thêm phương án vay 40%">
                Cần tư vấn thêm phương án vay 40%
              </option>
              <option value="Chưa liên hệ được / Máy bận">Chưa liên hệ được / Máy bận</option>
              <option value="Khách không có nhu cầu">Khách không có nhu cầu</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Ghi chú nhanh trong cuộc gọi
            </label>
            <textarea
              rows={3}
              value={callNote}
              onChange={(e) => setCallNote(e.target.value)}
              placeholder="Nhập ghi chú phản hồi, thắc mắc về giá, hướng căn, tiến độ thanh toán..."
              className="w-full p-3 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-brand-500 focus:bg-white resize-none"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            {isCalling ? (
              <button
                type="button"
                onClick={handleEndCall}
                className="w-full h-11 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 shadow-theme-sm transition-all"
              >
                <span className="material-symbols-outlined">call_end</span>
                Kết thúc cuộc gọi
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-1/3 h-11 border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium text-sm rounded-xl transition-all"
                >
                  Bỏ qua
                </button>
                <button
                  type="button"
                  onClick={handleSaveAndClose}
                  className="w-2/3 h-11 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 shadow-theme-sm transition-all"
                >
                  <span className="material-symbols-outlined text-sm">save</span>
                  Lưu vào nhật ký
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
