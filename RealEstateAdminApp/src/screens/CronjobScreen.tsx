import { useState, useEffect } from 'react';
import { Clock, Power } from 'lucide-react';

export default function CronjobScreen() {
  const [isActive, setIsActive] = useState(false);
  const [frequency, setFrequency] = useState('0 8 * * *');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/news-manager/cron');
        const data = await res.json();
        setIsActive(data.isActive);
        setFrequency(data.frequency);
      } catch (error) {
        console.error('Failed to fetch cron config', error);
      }
    };
    fetchConfig();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetch('/api/news-manager/cron', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isActive, frequency })
      });
      alert('Đã lưu cấu hình thành công!');
    } catch (error) {
      console.error('Failed to save cron config', error);
      alert('Lỗi khi lưu cấu hình.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6">
      <header className="flex flex-col gap-2 pb-6 border-b border-white/10">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">Cấu hình Cronjob tự động</h2>
        <p className="text-slate-400 max-w-2xl text-sm leading-relaxed">Cài đặt lịch trình tự động cào tin và lọc AI mỗi ngày.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <div className="glass-panel p-8 rounded-3xl relative overflow-hidden group border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.4)] transition-all duration-300 hover:border-purple-500/30 hover:shadow-[0_8px_40px_rgba(168,85,247,0.15)]">
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all duration-700 ease-out"></div>
          
          <div className="flex justify-between items-start mb-8 relative z-10">
            <div className="flex items-center gap-4">
              <div className={`p-3.5 rounded-2xl shadow-inner transition-colors duration-300 ${isActive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800/50 text-slate-400 border border-white/5'}`}>
                <Clock size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-1">Daily News Crawler</h3>
                <div className="flex items-center gap-2">
                  <span className={`relative flex h-2 w-2 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <p className={`text-xs font-medium tracking-wide uppercase ${isActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {isActive ? 'Đang hoạt động' : 'Đã tạm dừng'}
                  </p>
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => setIsActive(!isActive)}
              className={`w-14 h-8 rounded-full p-1 transition-colors duration-300 relative shadow-inner ${isActive ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${isActive ? 'translate-x-6' : 'translate-x-0'}`}></div>
            </button>
          </div>

          <div className="space-y-6 relative z-10">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Lịch trình (Cron Expression)</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-4 pr-10 py-3.5 text-white font-mono text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-inner"
                  disabled={!isActive}
                />
              </div>
              <p className="text-xs text-slate-500 mt-3 flex items-start gap-1.5 leading-relaxed">
                <span className="text-purple-400 font-bold mt-0.5">*</span>
                Mặc định: Chạy vào 8:00 sáng mỗi ngày. Cú pháp chuẩn cron Unix.
              </p>
            </div>

            <button 
              onClick={handleSave}
              className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-3.5 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 hover:shadow-[0_0_20px_rgba(255,255,255,0.05)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 disabled:hover:bg-white/5 disabled:hover:shadow-none"
              disabled={!isActive || isSaving}
            >
              <Power size={18} />
              {isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
