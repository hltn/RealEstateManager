import React, { useState } from 'react';
import { DailyTask, Customer } from '../types/crm';

interface DailyTasksViewProps {
  tasks: DailyTask[];
  customers: Customer[];
  onSelectCustomerByName: (name: string) => void;
  onOpenCallByName: (name: string) => void;
  onOpenZaloByName: (name: string) => void;
  onOpenQuickNoteByName: (name: string) => void;
  onNavigate: (view: string) => void;
}

export const DailyTasksView: React.FC<DailyTasksViewProps> = ({
  tasks,
  onSelectCustomerByName,
  onOpenCallByName,
  onOpenZaloByName,
  onOpenQuickNoteByName,
  onNavigate
}) => {
  const [filterProject, setFilterProject] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');

  const overdueTasks = tasks.filter((t) => t.category === 'overdue');
  const todayTasks = tasks.filter((t) => t.category === 'today');
  const upcomingTasks = tasks.filter((t) => t.category === 'upcoming');

  const matchesFilter = (task: DailyTask) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !task.customerName.toLowerCase().includes(q) &&
        !task.customerPhone.includes(q) &&
        !task.projectName.toLowerCase().includes(q) &&
        !task.content.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    if (filterProject !== 'all' && !task.projectName.toLowerCase().includes(filterProject.toLowerCase())) {
      return false;
    }
    if (filterAssignee !== 'all' && !task.assignee.toLowerCase().includes(filterAssignee.toLowerCase())) {
      return false;
    }
    if (filterPriority === 'overdue' && task.category !== 'overdue') return false;
    if (filterPriority === 'today' && task.category !== 'today') return false;
    if (filterPriority === 'vip' && task.statusTag !== 'Khách net') return false;
    return true;
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Counter Summary */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Việc hôm nay</h1>
          <p className="text-sm text-gray-500 mt-1">
            Theo dõi nhiệm vụ cần xử lý, nhắc hẹn &amp; gợi ý hành động STND AI
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Status Counter Chips */}
          <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-theme-xs">
            <div className="flex items-center gap-1.5 px-3 py-1 border-r border-gray-200 text-xs">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <span className="text-gray-500">Quá hạn:</span>
              <span className="font-bold text-rose-600">{overdueTasks.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 border-r border-gray-200 text-xs">
              <span className="w-2 h-2 rounded-full bg-brand-500"></span>
              <span className="text-gray-500">Hôm nay:</span>
              <span className="font-bold text-brand-600">{todayTasks.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 text-xs">
              <span className="w-2 h-2 rounded-full bg-gray-400"></span>
              <span className="text-gray-500">Sắp tới:</span>
              <span className="font-bold text-gray-700">{upcomingTasks.length}</span>
            </div>
          </div>

          <button
            onClick={() => onNavigate('create_customer')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-sm shadow-theme-xs transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Thêm khách</span>
          </button>
        </div>
      </div>

      {/* 2. Sub-tabs bar */}
      <div className="border-b border-gray-200 flex items-center gap-8">
        <button
          onClick={() => onNavigate('today')}
          className="pb-3 text-sm font-semibold text-brand-600 border-b-2 border-brand-500 flex items-center gap-2"
        >
          <span>Việc hôm nay</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-brand-50 text-brand-600 font-bold">
            {tasks.length}
          </span>
        </button>

        <button
          onClick={() => onNavigate('customers')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 flex items-center gap-2 transition-colors border-b-2 border-transparent"
        >
          <span>Khách hàng</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">128</span>
        </button>

        <button
          onClick={() => onNavigate('calendar')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 flex items-center gap-2 transition-colors border-b-2 border-transparent"
        >
          <span>Lịch hẹn</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">12</span>
        </button>

        <button
          onClick={() => onNavigate('reports')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 flex items-center gap-2 transition-colors border-b-2 border-transparent"
        >
          <span>Báo cáo</span>
        </button>
      </div>

      {/* 3. Toolbar Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-theme-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên, SĐT, dự án..."
            className="w-full h-10 pl-9 pr-3 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:bg-white focus:border-brand-500 shadow-theme-xs"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="h-10 pl-3 pr-8 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 shadow-theme-xs focus:border-brand-500"
          >
            <option value="all">Dự án: Tất cả</option>
            <option value="Q'Terra">Q&apos;Terra</option>
            <option value="Ecopark Grand">Ecopark Grand</option>
            <option value="The Privia">The Privia</option>
            <option value="Vinhomes Ocean Park">Vinhomes Ocean Park</option>
          </select>

          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="h-10 pl-3 pr-8 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 shadow-theme-xs focus:border-brand-500"
          >
            <option value="all">Người phụ trách: Tất cả</option>
            <option value="Admin">Admin</option>
            <option value="Trần Hoàng Quân">Trần Hoàng Quân</option>
            <option value="Nguyễn Thu Trang">Nguyễn Thu Trang</option>
          </select>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="h-10 pl-3 pr-8 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 shadow-theme-xs focus:border-brand-500"
          >
            <option value="all">Mức ưu tiên: Tất cả</option>
            <option value="overdue">Khẩn cấp (Quá hạn)</option>
            <option value="today">Hôm nay</option>
            <option value="vip">Khách VIP / Net</option>
          </select>

          <button
            onClick={() => {
              setSearchQuery('');
              setFilterProject('all');
              setFilterAssignee('all');
              setFilterPriority('all');
            }}
            className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-theme-xs shrink-0"
            title="Làm mới bộ lọc"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>

          <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200 shrink-0">
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-white text-brand-600 shadow-theme-xs font-medium'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
              title="Dạng cột Kanban"
            >
              <span className="material-symbols-outlined text-[18px] block">view_kanban</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white text-brand-600 shadow-theme-xs font-medium'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
              title="Dạng danh sách"
            >
              <span className="material-symbols-outlined text-[18px] block">view_list</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4. 3-COLUMN KANBAN BOARD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* ==================== CỘT 1: QUÁ HẠN ==================== */}
        <div className="flex flex-col gap-4 bg-gray-100/70 p-4 rounded-2xl border border-rose-200/60">
          <div className="flex items-center justify-between pb-2 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-rose-700">
                QUÁ HẠN ({overdueTasks.filter(matchesFilter).length})
              </h2>
            </div>
            <span className="material-symbols-outlined text-rose-500 text-[18px]">warning</span>
          </div>

          <div className="space-y-3">
            {overdueTasks.filter(matchesFilter).map((task) => (
              <div
                key={task.id}
                className="bg-white rounded-xl border border-rose-100 p-4 shadow-theme-xs hover:shadow-theme-sm transition-all space-y-3 group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => onSelectCustomerByName(task.customerName)}
                    >
                      <span className="font-bold text-sm text-gray-900 group-hover:text-brand-600 transition-colors">
                        {task.customerName}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          task.statusTag === 'Khách net'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-brand-50 text-brand-600 border border-brand-100'
                        }`}
                      >
                        {task.statusTag}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                      <span className="material-symbols-outlined text-[14px]">apartment</span>
                      <span>
                        Dự án: <strong className="text-gray-700 font-medium">{task.projectName}</strong>
                      </span>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-600 border border-rose-100">
                    {task.overdueText || 'Trễ'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50 text-xs text-gray-700 border border-gray-200">
                  <p className="leading-relaxed">{task.content}</p>
                </div>

                {task.aiSuggestion && (
                  <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-200 text-xs text-amber-900 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-[11px] text-amber-700">
                      <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
                      <span>Gợi ý STND AI</span>
                    </div>
                    <p className="text-gray-700 leading-normal text-xs">{task.aiSuggestion}</p>
                  </div>
                )}

                {/* 4 Action Buttons */}
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  <button
                    onClick={() => onOpenCallByName(task.customerName)}
                    className="h-8 flex items-center justify-center gap-1 rounded bg-brand-500 text-white font-medium text-xs hover:bg-brand-600 active:scale-95 transition-all shadow-theme-xs"
                    title="Gọi ngay"
                  >
                    <span className="material-symbols-outlined text-[15px]">call</span>
                    <span>Gọi</span>
                  </button>
                  <button
                    onClick={() => onOpenZaloByName(task.customerName)}
                    className="h-8 flex items-center justify-center gap-1 rounded bg-emerald-600 text-white font-medium text-xs hover:bg-emerald-700 active:scale-95 transition-all shadow-theme-xs"
                    title="Nhắn Zalo"
                  >
                    <span className="material-symbols-outlined text-[15px]">chat</span>
                    <span>Zalo</span>
                  </button>
                  <button
                    onClick={() => onOpenQuickNoteByName(task.customerName)}
                    className="h-8 flex items-center justify-center gap-1 rounded bg-gray-100 text-gray-700 border border-gray-200 font-medium text-xs hover:bg-gray-200 active:scale-95 transition-all"
                    title="Ghi chú"
                  >
                    <span className="material-symbols-outlined text-[15px]">edit_note</span>
                    <span>Ghi chú</span>
                  </button>
                  <button
                    onClick={() => onSelectCustomerByName(task.customerName)}
                    className="h-8 flex items-center justify-center gap-1 rounded bg-gray-100 text-gray-700 border border-gray-200 font-medium text-xs hover:bg-gray-200 active:scale-95 transition-all"
                    title="Xem chi tiết"
                  >
                    <span className="material-symbols-outlined text-[15px]">visibility</span>
                    <span>Xem</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ==================== CỘT 2: HÔM NAY ==================== */}
        <div className="flex flex-col gap-4 bg-gray-100/70 p-4 rounded-2xl border border-brand-200">
          <div className="flex items-center justify-between pb-2 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-500"></span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-brand-600">
                HÔM NAY ({todayTasks.filter(matchesFilter).length})
              </h2>
            </div>
            <span className="material-symbols-outlined text-brand-500 text-[18px]">today</span>
          </div>

          <div className="space-y-3">
            {todayTasks.filter(matchesFilter).map((task) => (
              <div
                key={task.id}
                className="bg-white rounded-xl border border-gray-200 p-4 shadow-theme-xs hover:shadow-theme-sm transition-all space-y-3 group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => onSelectCustomerByName(task.customerName)}
                    >
                      <span className="font-bold text-sm text-gray-900 group-hover:text-brand-600 transition-colors">
                        {task.customerName}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          task.statusTag === 'Khách net'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-brand-50 text-brand-600 border border-brand-100'
                        }`}
                      >
                        {task.statusTag}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                      <span className="material-symbols-outlined text-[14px]">apartment</span>
                      <span>
                        Dự án: <strong className="text-gray-700 font-medium">{task.projectName}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-[11px] font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded border border-brand-100">
                    <span className="material-symbols-outlined text-[13px]">schedule</span>
                    <span>{task.timeText || 'Hôm nay'}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50 text-xs text-gray-700 border border-gray-200">
                  <p className="leading-relaxed">{task.content}</p>
                </div>

                {task.aiSuggestion && (
                  <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-200 text-xs text-amber-900 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-[11px] text-amber-700">
                      <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
                      <span>Gợi ý STND AI</span>
                    </div>
                    <p className="text-gray-700 leading-normal text-xs">{task.aiSuggestion}</p>
                  </div>
                )}

                {/* 4 Action Buttons */}
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  <button
                    onClick={() => onOpenCallByName(task.customerName)}
                    className="h-8 flex items-center justify-center gap-1 rounded bg-brand-500 text-white font-medium text-xs hover:bg-brand-600 active:scale-95 transition-all shadow-theme-xs"
                  >
                    <span className="material-symbols-outlined text-[15px]">call</span>
                    <span>Gọi</span>
                  </button>
                  <button
                    onClick={() => onOpenZaloByName(task.customerName)}
                    className="h-8 flex items-center justify-center gap-1 rounded bg-emerald-600 text-white font-medium text-xs hover:bg-emerald-700 active:scale-95 transition-all shadow-theme-xs"
                  >
                    <span className="material-symbols-outlined text-[15px]">chat</span>
                    <span>Zalo</span>
                  </button>
                  <button
                    onClick={() => onOpenQuickNoteByName(task.customerName)}
                    className="h-8 flex items-center justify-center gap-1 rounded bg-gray-100 text-gray-700 border border-gray-200 font-medium text-xs hover:bg-gray-200 active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined text-[15px]">edit_note</span>
                    <span>Ghi chú</span>
                  </button>
                  <button
                    onClick={() => onSelectCustomerByName(task.customerName)}
                    className="h-8 flex items-center justify-center gap-1 rounded bg-gray-100 text-gray-700 border border-gray-200 font-medium text-xs hover:bg-gray-200 active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined text-[15px]">visibility</span>
                    <span>Xem</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ==================== CỘT 3: SẮP TỚI ==================== */}
        <div className="flex flex-col gap-4 bg-gray-100/70 p-4 rounded-2xl border border-gray-200">
          <div className="flex items-center justify-between pb-2 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                SẮP TỚI ({upcomingTasks.filter(matchesFilter).length})
              </h2>
            </div>
            <span className="material-symbols-outlined text-gray-500 text-[18px]">
              calendar_month
            </span>
          </div>

          <div className="space-y-3">
            {upcomingTasks.filter(matchesFilter).map((task) => (
              <div
                key={task.id}
                className="bg-white rounded-xl border border-gray-200 p-4 shadow-theme-xs hover:shadow-theme-sm transition-all space-y-2.5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div
                      className="font-bold text-sm text-gray-900 cursor-pointer hover:text-brand-600 transition-colors"
                      onClick={() => onSelectCustomerByName(task.customerName)}
                    >
                      {task.customerName}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Dự án: <span className="text-gray-700 font-medium">{task.projectName}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">
                    {task.dateText}
                  </span>
                </div>

                <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">{task.content}</p>

                <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
                  <span className="text-gray-400">
                    Phụ trách: <strong className="text-gray-700">{task.assignee}</strong>
                  </span>
                  <button
                    onClick={() => onSelectCustomerByName(task.customerName)}
                    className="text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-0.5"
                  >
                    <span>Chi tiết</span>
                    <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                  </button>
                </div>
              </div>
            ))}

            <div className="text-center pt-2">
              <button
                onClick={() => alert('Đang tải thêm 5 nhiệm vụ tuần tới từ cơ sở dữ liệu CRM...')}
                className="text-xs font-medium text-gray-600 hover:text-brand-600 transition-colors py-2 px-3 rounded-lg border border-dashed border-gray-300 w-full hover:border-brand-500 bg-white shadow-theme-xs"
              >
                + Xem thêm 5 nhiệm vụ tuần này
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
