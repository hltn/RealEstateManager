import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Newspaper, Settings, Search, Database, FileText, Bot } from 'lucide-react';

export default function AdminLayout() {
  const navItems = [
    { to: '/', icon: <Search size={20} />, label: 'Thu thập thủ công' },
    { to: '/raw-articles', icon: <FileText size={20} />, label: 'Tin tức thô' },
    { to: '/manage-wp', icon: <Newspaper size={20} />, label: 'Quản lý đăng tin' },
    { to: '/sources', icon: <Database size={20} />, label: 'Quản lý Nguồn tin' },
    { to: '/ai-config', icon: <Bot size={20} />, label: 'Cấu hình AI' },
    { to: '/cronjob', icon: <Settings size={20} />, label: 'Cấu hình Cronjob' },
  ];

  return (
    <div className="flex h-screen w-full">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 glass-panel border-r border-white/10 flex flex-col z-10 relative">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="text-blue-500" size={28} />
            <h1 className="text-xl font-bold text-gradient">Admin Panel</h1>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 border ${
                  isActive 
                    ? 'bg-blue-600/20 text-blue-400 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              {item.icon}
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        
        <div className="p-6 border-t border-white/10 text-xs text-slate-500 text-center">
          RealEstate Web Admin v1.0
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 relative">
        <div className="max-w-6xl mx-auto animate-[fadeInUp_0.5s_ease-out_both]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
