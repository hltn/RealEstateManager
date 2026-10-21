import React, { useState } from 'react';

export const AIConfigView: React.FC = () => {
  const [autoReminder, setAutoReminder] = useState(true);
  const [dealScoreThreshold, setDealScoreThreshold] = useState(75);
  const [smartSlotSuggest, setSmartSlotSuggest] = useState(true);
  const [duplicateAutoCheck, setDuplicateAutoCheck] = useState(true);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Cấu hình STND AI</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
              STND AI v2.6
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Thiết lập mô hình phân tích phễu khách hàng, gợi ý khung giờ gọi tối ưu và tự động hóa CRM
          </p>
        </div>

        <button
          onClick={() => alert('Đã lưu cấu hình STND AI thành công!')}
          className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-semibold text-xs rounded-lg shadow-theme-xs transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">save</span>
          Lưu cấu hình
        </button>
      </div>

      <div className="space-y-6">
        {/* Module 1: Mô hình chấm điểm C4 */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
            <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold">
              <span className="material-symbols-outlined">checklist</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">
                Mô hình chấm điểm 4 tiêu chí (C4 Deal Qualification)
              </h2>
              <p className="text-xs text-gray-500">
                Nhu cầu (25%) + Động cơ (25%) + Tài chính (25%) + Thời gian chốt (25%)
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">Ngưỡng đạt chuẩn phân loại Khách Net</p>
                <p className="text-gray-500">
                  Khi khách hàng đạt ngưỡng này, hệ thống sẽ tự động gán nhãn VIP và ưu tiên xếp lịch
                </p>
              </div>
              <span className="text-base font-bold text-brand-600 bg-brand-50 px-3 py-1 rounded-lg border border-brand-200">
                {dealScoreThreshold}% (3/4 Đạt)
              </span>
            </div>
            <input
              type="range"
              min="25"
              max="100"
              step="25"
              value={dealScoreThreshold}
              onChange={(e) => setDealScoreThreshold(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
          </div>
        </div>

        {/* Module 2: Gợi ý hành động thông minh */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
              <span className="material-symbols-outlined">auto_awesome</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">
                Gợi ý bước tiếp theo &amp; Khung giờ vàng
              </h2>
              <p className="text-xs text-gray-500">
                Học thói quen phản hồi tin nhắn và nghe máy của khách hàng VIP
              </p>
            </div>
          </div>

          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">Tự động đề xuất khung giờ rảnh tối ưu</p>
                <p className="text-gray-500">
                  Phân tích dữ liệu lịch sử cuộc gọi (ưu tiên 19:00 - 20:30 tối)
                </p>
              </div>
              <button
                onClick={() => setSmartSlotSuggest(!smartSlotSuggest)}
                className={`w-12 h-7 rounded-full p-0.5 cursor-pointer flex items-center transition-colors ${
                  smartSlotSuggest ? 'bg-emerald-500 justify-end' : 'bg-gray-300 justify-start'
                }`}
              >
                <div className="w-6 h-6 bg-white rounded-full shadow-theme-xs"></div>
              </button>
            </div>

            <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">Đối soát trùng lặp số điện thoại</p>
                <p className="text-gray-500">
                  Ngăn chặn 2 chuyên viên cùng chăm sóc một khách hàng và bảo vệ hoa hồng
                </p>
              </div>
              <button
                onClick={() => setDuplicateAutoCheck(!duplicateAutoCheck)}
                className={`w-12 h-7 rounded-full p-0.5 cursor-pointer flex items-center transition-colors ${
                  duplicateAutoCheck ? 'bg-emerald-500 justify-end' : 'bg-gray-300 justify-start'
                }`}
              >
                <div className="w-6 h-6 bg-white rounded-full shadow-theme-xs"></div>
              </button>
            </div>

            <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">Tự động sinh nhiệm vụ nhắc hẹn sinh nhật</p>
                <p className="text-gray-500">
                  Tạo thẻ việc trước 3 ngày ngày sinh của khách hàng trong mục Việc hôm nay
                </p>
              </div>
              <button
                onClick={() => setAutoReminder(!autoReminder)}
                className={`w-12 h-7 rounded-full p-0.5 cursor-pointer flex items-center transition-colors ${
                  autoReminder ? 'bg-emerald-500 justify-end' : 'bg-gray-300 justify-start'
                }`}
              >
                <div className="w-6 h-6 bg-white rounded-full shadow-theme-xs"></div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
