import React, { useState } from 'react';

interface ZaloModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  customerPhone: string;
  projectName?: string;
  onSentMessage?: (content: string) => void;
}

export const ZaloModal: React.FC<ZaloModalProps> = ({
  isOpen,
  onClose,
  customerName,
  customerPhone,
  projectName = "Q'Terra",
  onSentMessage
}) => {
  const templates = [
    `Chào anh ${customerName}, em Hạnh bên BĐS STND xin gửi bảng tính dòng tiền và phương án vay hỗ trợ 40% cho căn 3PN dự án ${projectName}. Anh xem qua và báo em nếu cần hỗ trợ thêm nhé ạ!`,
    `Dạ anh ${customerName}, cuối tuần này bên em có chương trình trải nghiệm sa bàn và căn hộ mẫu ${projectName}. Em xin phép gửi vé mời mời anh và chị nhà ghé tham quan ạ!`,
    `Em Hạnh STND gửi anh ${customerName} cập nhật mới nhất về tiến độ pháp lý đợt 2 và danh mục vật liệu bàn giao của căn hộ ạ.`
  ];

  const [message, setMessage] = useState(templates[0]);
  const [isSent, setIsSent] = useState(false);

  if (!isOpen) return null;

  const handleSend = () => {
    setIsSent(true);
    setTimeout(() => {
      if (onSentMessage) {
        onSentMessage(message);
      }
      setIsSent(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white text-blue-600 flex items-center justify-center font-bold text-lg shadow-sm">
              Z
            </div>
            <div>
              <h3 className="font-bold text-base">Gửi tin nhắn Zalo ZNS / Tư vấn</h3>
              <p className="text-xs text-blue-100">
                Gửi tới: <span className="font-semibold text-white">{customerName}</span> (
                {customerPhone})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center font-bold text-lg transition-colors"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
              Mẫu tin nhắn nhanh
            </label>
            <div className="space-y-1.5">
              {templates.map((tpl, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMessage(tpl)}
                  className={`w-full text-left p-2.5 rounded-xl border text-xs transition-colors ${
                    message === tpl
                      ? 'border-brand-500 bg-brand-50/70 text-brand-900 font-medium'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <span className="font-bold text-brand-600 mr-1.5">Mẫu {i + 1}:</span>
                  <span className="line-clamp-1">{tpl}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Nội dung tin nhắn
            </label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full p-3.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-brand-500 focus:bg-white resize-none leading-relaxed"
            />
          </div>

          {/* Attachments preview */}
          <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-100 flex items-center justify-between text-xs text-blue-700">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base">attach_file</span>
              <span>Đính kèm: Bang-tinh-dong-tien-{projectName}.pdf (1.8MB)</span>
            </div>
            <span className="font-semibold text-emerald-600">Sẵn sàng</span>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-medium transition-colors"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              disabled={isSent || !message.trim()}
              onClick={handleSend}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-semibold flex items-center gap-2 shadow-theme-xs transition-all disabled:opacity-50"
            >
              {isSent ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  Đã gửi thành công!
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-sm">send</span>
                  Gửi Zalo ngay
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
