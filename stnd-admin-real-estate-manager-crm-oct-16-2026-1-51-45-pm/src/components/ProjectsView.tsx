import React, { useState } from 'react';
import { AVAILABLE_PROJECTS } from '../data/mockData';

export const ProjectsView: React.FC<{ onNavigate: (view: string) => void }> = ({ onNavigate }) => {
  const [selectedSegment, setSelectedSegment] = useState('all');

  const filtered = AVAILABLE_PROJECTS.filter((p) => {
    if (selectedSegment === 'all') return true;
    return p.segment === selectedSegment;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Quản lý dự án BĐS</h1>
          <p className="text-sm text-gray-500 mt-1">
            Danh mục dự án phân phối độc quyền và liên kết F1 trong hệ thống STND
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('create_appointment')}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-xs font-semibold shadow-theme-xs flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">calendar_add_on</span>
            <span>Đặt lịch xem sa bàn</span>
          </button>
        </div>
      </div>

      {/* Filter segments */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {['all', 'Cao cấp', 'Hạng sang', 'Trung cao cấp', 'Đại đô thị'].map((seg) => (
          <button
            key={seg}
            onClick={() => setSelectedSegment(seg)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
              selectedSegment === seg
                ? 'bg-brand-500 text-white shadow-theme-xs'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {seg === 'all' ? 'Tất cả phân khúc' : seg}
          </button>
        ))}
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((proj) => (
          <div
            key={proj.id}
            className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-theme-xs hover:shadow-theme-sm transition-all group"
          >
            <div className="h-44 bg-gradient-to-br from-slate-800 to-indigo-950 p-4 relative flex flex-col justify-between text-white">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/20 backdrop-blur-md">
                  {proj.segment}
                </span>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/80 text-white">
                  {proj.status}
                </span>
              </div>
              <div>
                <h3 className="font-bold text-lg group-hover:text-brand-300 transition-colors">
                  {proj.name}
                </h3>
                <p className="text-xs text-gray-300 flex items-center gap-1 mt-1">
                  <span className="material-symbols-outlined text-xs">location_on</span>
                  {proj.location}
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 text-xs">Khoảng giá dự kiến:</span>
                <span className="font-bold text-brand-600">{proj.price}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-gray-400 block text-[10px]">Cơ cấu căn:</span>
                  <span className="font-semibold text-gray-800">1PN, 2PN, 3PN, Penthouse</span>
                </div>
                <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-gray-400 block text-[10px]">Ngân hàng:</span>
                  <span className="font-semibold text-gray-800">Vietcombank, MB ân hạn</span>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                <button
                  onClick={() => alert(`Tải bộ tài liệu bán hàng ${proj.name}`)}
                  className="text-xs text-gray-600 hover:text-brand-600 font-semibold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  Brochure &amp; Bảng giá
                </button>
                <button
                  onClick={() => onNavigate('create_appointment')}
                  className="text-xs text-brand-600 hover:text-brand-700 font-bold"
                >
                  Dẫn khách xem ➔
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
