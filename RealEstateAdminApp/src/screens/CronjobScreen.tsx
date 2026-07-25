import { useState, useEffect } from 'react';
import { Clock, Power } from 'lucide-react';

export default function CronjobScreen() {
  const [isActive, setIsActive] = useState(false);
  const [frequency, setFrequency] = useState('0 8 * * *');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/v1/news-manager/cron');
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
      await fetch('/api/v1/news-manager/cron', {
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
      <header className="flex flex-col gap-2 pb-6 border-b border-gray-200 dark:border-white/[0.05]">
        <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Cấu hình Cronjob tự động</h2>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed">Cài đặt lịch trình tự động cào tin và lọc AI mỗi ngày.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <div className="rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03] p-8 relative overflow-hidden group transition-all duration-300 hover:border-brand-300 dark:hover:border-brand-500/30">
          
          <div className="flex justify-between items-start mb-8 relative z-10">
            <div className="flex items-center gap-4">
              <div className={`p-3.5 rounded-2xl transition-colors duration-300 ${isActive ? 'bg-success-50 dark:bg-success-500/15 text-success-500 border border-success-100 dark:border-success-500/25' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700'}`}>
                <Clock size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white/90 mb-1">Daily News Crawler</h3>
                <div className="flex items-center gap-2">
                  <span className={`relative flex h-2 w-2 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success-500"></span>
                  </span>
                  <p className={`text-xs font-medium tracking-wide uppercase ${isActive ? 'text-success-500' : 'text-gray-500 dark:text-gray-400'}`}>
                    {isActive ? 'Đang hoạt động' : 'Đã tạm dừng'}
                  </p>
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => setIsActive(!isActive)}
              className={`w-14 h-8 rounded-full p-1 transition-colors duration-300 relative ${isActive ? 'bg-success-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${isActive ? 'translate-x-6' : 'translate-x-0'}`}></div>
            </button>
          </div>

          <div className="space-y-6 relative z-10">
            <div>
              <label className="text-theme-xs font-medium text-gray-500 dark:text-gray-400 mb-3 block uppercase tracking-wider">Lịch trình (Cron Expression)</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg pl-4 pr-10 py-2.5 text-gray-800 dark:text-white/90 font-mono text-sm focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!isActive}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 flex items-start gap-1.5 leading-relaxed">
                <span className="text-brand-500 font-bold mt-0.5">*</span>
                Mặc định: Chạy vào 8:00 sáng mỗi ngày. Cú pháp chuẩn cron Unix.
              </p>
            </div>

            <button 
              onClick={handleSave}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white font-medium py-3 rounded-lg transition-all duration-300 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
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
