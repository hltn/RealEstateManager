import React, { useState, useEffect, useRef } from 'react';

interface TopHeaderProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSearchSelect?: (item: string) => void;
  onNavigate: (view: string) => void;
  customerCount: number;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  onNavigate,
  customerCount
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut ⌘K or Ctrl+K for search, and ⌘B or Ctrl+B for sidebar toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = searchRef.current?.querySelector('input');
        input?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        onToggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleSidebar]);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const notifications = [
    {
      id: 'n1',
      title: 'Lịch hẹn mới với Lê Hoàng Long',
      desc: "Xem sa bàn Q'Terra lúc 15:30 chiều nay",
      time: '10 phút trước',
      icon: 'calendar_month',
      color: 'text-brand-600 bg-brand-50'
    },
    {
      id: 'n2',
      title: 'Khách hàng VIP Nguyễn Văn A',
      desc: 'Đã cập nhật tiêu chí đầu tư căn hộ 3PN',
      time: '45 phút trước',
      icon: 'stars',
      color: 'text-purple-700 bg-purple-50'
    },
    {
      id: 'n3',
      title: 'Cảnh báo quá hạn cuộc gọi',
      desc: '2 nhiệm vụ cần liên hệ lại ngay hôm nay',
      time: '2 giờ trước',
      icon: 'warning',
      color: 'text-amber-700 bg-amber-50'
    }
  ];

  const quickSearchMatches = [
    { label: 'Nguyễn Văn A', sub: '0912 345 678 • VIP Platinum', view: 'customer_detail' },
    { label: 'Trần Thị Bích', sub: 'The Privia • Căn 2PN-B08', view: 'customer_detail' },
    { label: 'Lê Hoàng Long', sub: "0912 888 921 • Q'Terra", view: 'customer_detail' },
    { label: 'Việc hôm nay (7 nhiệm vụ)', sub: 'Kanban theo dõi ca trực', view: 'today' },
    { label: 'Lịch hẹn & Nhắc việc', sub: 'Xem ca trực tuần 42', view: 'calendar' },
    { label: 'Báo cáo & Thống kê CRM', sub: 'Biểu đồ phân bổ & KPI', view: 'reports' }
  ].filter(
    (item) =>
      !searchQuery ||
      item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sub.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <header className="h-[76px] bg-surface-container-lowest border-b border-gray-200 px-6 lg:px-8 flex items-center justify-between z-30 shrink-0">
      {/* Left zone: Hamburger toggle button + Global Search (430px) */}
      <div className="flex items-center gap-4 flex-1 max-w-[620px]">
        {/* Nút ẩn / hiện menu bên trái (Hoạt động cả Desktop lẫn Mobile) */}
        <button
          type="button"
          onClick={onToggleSidebar}
          className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-all shadow-theme-xs active:scale-95 shrink-0 ${
            isSidebarOpen
              ? 'border-gray-200 hover:bg-gray-100 text-gray-700 bg-white'
              : 'border-brand-300 bg-brand-50 text-brand-600 hover:bg-brand-100'
          }`}
          title={isSidebarOpen ? 'Thu gọn menu (Ẩn sidebar)' : 'Mở menu (Hiện sidebar)'}
          aria-label="Ẩn hiện menu bên trái"
        >
          <span className="material-symbols-outlined text-[22px]">menu</span>
        </button>

        {/* Global Search Container */}
        <div ref={searchRef} className="relative w-full max-w-[430px]">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
            <span className="material-symbols-outlined text-lg">search</span>
          </span>
          <input
            className="w-full h-10 pl-10 pr-12 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/10 placeholder-gray-400 transition-all font-sans"
            placeholder="Tìm kiếm khách hàng, SĐT, mã căn, dự án..."
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
          />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <kbd className="px-1.5 py-0.5 text-[10px] font-semibold text-gray-400 bg-white border border-gray-200 rounded shadow-sm">
              ⌘K
            </kbd>
          </div>

          {/* Search Dropdown Results */}
          {isSearchFocused && (
            <div className="absolute left-0 right-0 top-12 mt-1 bg-white border border-gray-200 rounded-xl shadow-theme-lg p-2 z-50 animate-in fade-in slide-in-from-top-1">
              <div className="text-[11px] font-semibold uppercase text-gray-400 px-3 py-1.5 tracking-wider">
                Kết quả tìm kiếm nhanh ({quickSearchMatches.length})
              </div>
              <div className="space-y-0.5 max-h-64 overflow-y-auto custom-scrollbar">
                {quickSearchMatches.map((item, idx) => (
                  <button
                    key={idx}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-brand-50 transition-colors flex items-center justify-between group"
                    onClick={() => {
                      onNavigate(item.view);
                      setSearchQuery('');
                      setIsSearchFocused(false);
                    }}
                  >
                    <div>
                      <div className="text-sm font-semibold text-gray-900 group-hover:text-brand-600">
                        {item.label}
                      </div>
                      <div className="text-xs text-gray-500">{item.sub}</div>
                    </div>
                    <span className="material-symbols-outlined text-gray-300 group-hover:text-brand-500 text-sm">
                      chevron_right
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right zone: Utilities & Admin Profile Topbar */}
      <div className="flex items-center gap-3">
        {/* System status pill */}
        <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-xs text-emerald-700 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Máy chủ ổn định</span>
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="w-10 h-10 rounded-full border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-gray-600 transition-colors shadow-theme-xs"
          title={isDarkMode ? 'Chế độ sáng' : 'Chế độ tối'}
        >
          <span className="material-symbols-outlined text-[20px]">
            {isDarkMode ? 'light_mode' : 'dark_mode'}
          </span>
        </button>

        {/* Notification Bell with Dropdown */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative w-10 h-10 rounded-full border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-gray-600 transition-colors shadow-theme-xs"
            title="Thông báo mới"
          >
            <span className="material-symbols-outlined text-[20px]">notifications</span>
            <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-orange-400 border-2 border-white rounded-full"></span>
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-12 mt-2 w-80 sm:w-96 bg-white border border-gray-200 rounded-2xl shadow-theme-lg p-4 z-50 animate-in fade-in slide-in-from-top-1">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-900 text-sm">Thông báo hệ thống</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-600">
                    3 mới
                  </span>
                </div>
                <button
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  onClick={() => setShowNotifications(false)}
                >
                  Đánh dấu đã đọc
                </button>
              </div>
              <div className="space-y-2.5 max-h-72 overflow-y-auto custom-scrollbar">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-2.5 rounded-xl bg-gray-50/80 hover:bg-brand-50/50 border border-gray-100 flex items-start gap-3 transition-colors cursor-pointer"
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.color}`}
                    >
                      <span className="material-symbols-outlined text-base">{n.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-gray-900 truncate">{n.title}</div>
                      <div className="text-xs text-gray-600 mt-0.5 leading-snug">{n.desc}</div>
                      <div className="text-[10px] text-gray-400 mt-1">{n.time}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-3 border-t border-gray-100 mt-3 text-center">
                <button
                  onClick={() => {
                    onNavigate('today');
                    setShowNotifications(false);
                  }}
                  className="text-xs font-semibold text-brand-600 hover:underline"
                >
                  Xem tất cả việc cần xử lý ➔
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="h-6 w-px bg-gray-200 mx-1"></div>

        {/* Quick Admin User badge */}
        <div ref={userRef} className="relative">
          <div
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2.5 pl-1 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-full bg-brand-500 text-white font-semibold flex items-center justify-center text-sm ring-2 ring-brand-100 shadow-theme-xs">
              H
            </div>
            <div className="text-left hidden lg:block">
              <div className="text-sm font-semibold text-gray-900 leading-tight group-hover:text-brand-600 transition-colors">
                Admin STND
              </div>
              <div className="text-xs text-gray-500">Trưởng nhóm kinh doanh</div>
            </div>
            <span className="material-symbols-outlined text-gray-400 text-base hidden sm:inline-block">
              expand_more
            </span>
          </div>

          {showUserMenu && (
            <div className="absolute right-0 top-12 mt-2 w-64 bg-white border border-gray-200 rounded-2xl shadow-theme-lg p-2 z-50">
              <div className="p-3 border-b border-gray-100">
                <div className="text-sm font-bold text-gray-900">Admin STND (Trần Mỹ Hạnh)</div>
                <div className="text-xs text-gray-500">Chi nhánh Miền Nam • Nhóm C8</div>
                <div className="mt-2 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  Đang trực tuyến • {customerCount} khách
                </div>
              </div>
              <div className="py-1 space-y-0.5 text-xs text-gray-700">
                <button
                  onClick={() => {
                    onNavigate('account_management');
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">person</span>
                  Hồ sơ cá nhân &amp; Phân quyền
                </button>
                <button
                  onClick={() => {
                    onNavigate('reports');
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">insights</span>
                  Báo cáo hiệu suất kinh doanh
                </button>
                <button
                  onClick={() => {
                    onNavigate('ai_config');
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 flex items-center gap-2 text-purple-700"
                >
                  <span className="material-symbols-outlined text-sm">auto_awesome</span>
                  Cấu hình trợ lý STND AI
                </button>
              </div>
              <div className="pt-1 border-t border-gray-100">
                <button
                  onClick={() => {
                    alert('Đăng xuất thành công.');
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 flex items-center gap-2 text-xs font-medium"
                >
                  <span className="material-symbols-outlined text-sm">logout</span>
                  Đăng xuất hệ thống
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
