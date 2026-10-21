import React from 'react';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  isOpen,
  onToggle
}) => {
  const isCrmActive = [
    'customers',
    'customer_detail',
    'edit_persona',
    'edit_investment',
    'create_customer',
    'today',
    'calendar',
    'create_appointment',
    'reports'
  ].includes(currentView);

  const handleNav = (view: string) => {
    onNavigate(view);
    // On small screen, automatically close sidebar after choosing item
    if (window.innerWidth < 768) {
      onToggle();
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden animate-in fade-in"
          onClick={onToggle}
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 shrink-0 bg-surface-container-lowest border-r border-gray-200 flex flex-col justify-between select-none transition-all duration-300 ease-in-out ${
          isOpen
            ? 'w-[284px] translate-x-0 opacity-100 shadow-lg md:shadow-none'
            : 'w-0 -translate-x-full md:-translate-x-full opacity-0 border-r-0 pointer-events-none overflow-hidden'
        }`}
      >
        <div className="w-[284px] flex flex-col h-full overflow-hidden shrink-0">
          {/* Brand Header */}
          <div className="h-[76px] px-6 border-b border-gray-200 flex items-center justify-between shrink-0">
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => handleNav('customers')}
            >
              <img
                alt="STND Logo"
                className="h-10 w-auto object-contain transition-transform group-hover:scale-105"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBD8cT3l0dnSzG0FxcAJAGipXb6SSp09UXRmanzmCe0G3nx2kjDJTquPMcdrCjDM2LxxSl6-XArimbVwB_cRQyMRX2mHpxpiJFujolfSx36fdfcx23Smlue1BnoeGKvy5B26QRB8eOCxwHWU7w0NykCkj36CMLWY3xv9dMQPk0FMFF67769X4yoj1WVeqjhQmvFRY0m5VTeABDIwlY4fXLUj9LLr23-XtpFRqrfzrEWD4KRFnbKa5kxASo0xRQ1Ey2gAQ"
              />
              <div className="flex flex-col">
                <span className="font-bold text-gray-900 leading-none tracking-tight text-lg">
                  STND Admin
                </span>
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">
                  REAL ESTATE MANAGER
                </span>
              </div>
            </div>

            {/* Collapse sidebar button */}
            <button
              className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              onClick={onToggle}
              title="Thu gọn menu bên trái"
            >
              <span className="material-symbols-outlined text-[20px]">first_page</span>
            </button>
          </div>

          {/* Navigation Links Container */}
          <nav className="flex-1 px-4 py-5 space-y-1 overflow-y-auto custom-scrollbar">
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase text-gray-400 tracking-wider">
              HỆ THỐNG &amp; NGHIỆP VỤ
            </div>

            {/* 1. Quản lý khách hàng */}
            <button
              onClick={() => handleNav('customers')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isCrmActive
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={isCrmActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                group
              </span>
              <span className="flex-1 text-left">Quản lý khách hàng</span>
              {isCrmActive && <span className="w-2 h-2 rounded-full bg-brand-500"></span>}
            </button>

            {/* 2. Quản lý dự án */}
            <button
              onClick={() => handleNav('projects')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                currentView === 'projects'
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-brand-500">
                apartment
              </span>
              <span className="flex-1 text-left">Quản lý dự án</span>
            </button>

            {/* 3. Raw Articles */}
            <button
              onClick={() => handleNav('articles')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                currentView === 'articles'
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-brand-500">
                article
              </span>
              <span className="flex-1 text-left">Raw Articles</span>
            </button>

            {/* 4. Manage WP */}
            <button
              onClick={() => handleNav('manage_wp')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                currentView === 'manage_wp'
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-brand-500">
                language
              </span>
              <span className="flex-1 text-left">Manage WP</span>
            </button>

            {/* 5. Phân tích thị trường */}
            <button
              onClick={() => handleNav('market_analysis')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                currentView === 'market_analysis'
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-brand-500">
                trending_up
              </span>
              <span className="flex-1 text-left">Phân tích thị trường</span>
            </button>

            {/* 6. Sources */}
            <button
              onClick={() => handleNav('sources')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                currentView === 'sources'
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-brand-500">
                folder_open
              </span>
              <span className="flex-1 text-left">Sources</span>
            </button>

            {/* 7. AI Config with badge */}
            <button
              onClick={() => handleNav('ai_config')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                currentView === 'ai_config'
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-brand-500">
                auto_awesome
              </span>
              <span className="flex-1 text-left">AI Config</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 tracking-wide">
                STND AI
              </span>
            </button>

            {/* 8. Cronjob */}
            <button
              onClick={() => handleNav('cronjob')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                currentView === 'cronjob'
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-brand-500">
                schedule
              </span>
              <span className="flex-1 text-left">Cronjob</span>
            </button>

            {/* 9. Quản lý tài khoản */}
            <button
              onClick={() => handleNav('account_management')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                currentView === 'account_management'
                  ? 'bg-brand-50 text-brand-600 shadow-theme-xs font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-brand-500">
                manage_accounts
              </span>
              <span className="flex-1 text-left">Quản lý tài khoản</span>
            </button>
          </nav>

          {/* Bottom User Card */}
          <div className="p-4 border-t border-gray-200 bg-gray-50/70">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-brand-500 text-white flex items-center justify-center font-bold text-sm ring-2 ring-brand-100 shadow-theme-xs">
                  AD
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">Quản trị viên STND</div>
                <div className="text-xs text-gray-500 truncate">admin@stnd.vn</div>
              </div>
              <button
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                title="Đăng xuất"
                onClick={() => alert('Đã đăng xuất tài khoản an toàn.')}
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
