import { useState } from 'react';
import { Play, Check, AlertCircle, Save, Search } from 'lucide-react';

export default function ManualCrawlScreen() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [message, setMessage] = useState('');

  const handleTrigger = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/news-manager/trigger', { method: 'POST' });
      const resData = await response.json();
      setResults(resData.data || []);
      setMessage('Lấy tin và phân tích thành công!');
    } catch (error) {
      setMessage('Có lỗi xảy ra khi gọi API.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (results.length === 0) return;
    try {
      const response = await fetch('/api/news-manager/articles/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results),
      });
      const data = await response.json();
      setMessage(`Đã lưu ${data.savedCount} bài. Bỏ qua ${data.duplicates} bài trùng.`);
      setResults([]);
    } catch (error) {
      setMessage('Lỗi khi lưu bài viết.');
    }
  };

  return (
    <div className="w-full flex flex-col gap-6">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-6 pb-6 border-b border-white/10">
        <div>
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mb-2">Thu thập tin tức thủ công</h2>
          <p className="text-slate-400 max-w-2xl text-sm leading-relaxed">Kích hoạt luồng Firecrawl cào tin và dùng AI phân tích chuyên sâu tự động.</p>
        </div>
        <button
          onClick={handleTrigger}
          disabled={loading}
          className="group relative inline-flex items-center justify-center gap-3 px-8 py-3.5 font-medium text-white transition-all duration-300 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl hover:from-blue-500 hover:to-indigo-500 hover:shadow-[0_0_30px_rgba(79,70,229,0.4)] active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100 disabled:hover:shadow-none overflow-hidden"
        >
          <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
          <Play size={20} className={`relative z-10 ${loading ? 'animate-pulse' : ''}`} />
          <span className="relative z-10">{loading ? 'Đang xử lý...' : 'Chạy quy trình thu thập'}</span>
        </button>
      </header>

      {message && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center gap-3 text-blue-200 animate-[fadeIn_0.3s_ease-out]">
          <Check className="text-blue-400 shrink-0" size={20} />
          <span className="text-sm font-medium">{message}</span>
        </div>
      )}

      {results.length > 0 ? (
        <div className="space-y-6 animate-[fadeInUp_0.5s_ease-out_both]">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/50 p-4 rounded-2xl border border-white/5">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="bg-blue-600 w-2 h-6 rounded-full inline-block"></span>
              Kết quả phân tích từ AI ({results.length})
            </h3>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-6 py-2.5 rounded-xl transition-all font-medium hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]"
            >
              <Save size={18} />
              Duyệt & Lưu Database
            </button>
          </div>
          
          <div className="grid grid-cols-1 gap-6">
            {results.map((item, idx) => (
              <div key={idx} className="glass-panel p-7 rounded-2xl hover:border-blue-500/40 transition-all duration-300 group hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
                  <h4 className="text-xl font-semibold text-white leading-tight group-hover:text-blue-200 transition-colors">{item.title}</h4>
                  <span className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wide shrink-0 shadow-inner ${
                    item.impactLevel === 'Rất cao' 
                      ? 'bg-red-500/10 text-red-400 border border-red-500/30' 
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  }`}>
                    {item.impactLevel}
                  </span>
                </div>
                <p className="text-slate-300 text-sm mb-6 leading-relaxed bg-black/20 p-4 rounded-xl border border-white/5">{item.summary}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm mb-6">
                  <div className="space-y-2">
                    <span className="text-indigo-400 font-semibold text-xs uppercase tracking-wider flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span> Lý do quan trọng
                    </span>
                    <p className="text-slate-300 leading-relaxed pl-3.5 border-l border-indigo-500/20">{item.importanceReason}</p>
                  </div>
                  <div className="space-y-2">
                    <span className="text-emerald-400 font-semibold text-xs uppercase tracking-wider flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Nhận định chuyên gia
                    </span>
                    <p className="text-slate-300 leading-relaxed pl-3.5 border-l border-emerald-500/20">{item.expertOpinion}</p>
                  </div>
                </div>
                <div className="pt-4 border-t border-white/10 flex flex-wrap gap-x-6 gap-y-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-medium"><AlertCircle size={14} className="text-slate-500"/> {item.source}</span>
                  <span className="flex items-center gap-1.5 font-medium text-slate-300"><span className="text-slate-500">Đối tượng:</span> {item.targetAudience?.join(', ')}</span>
                  <a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-blue-400 hover:text-blue-300 hover:underline ml-auto">
                    Xem bài viết gốc <span className="text-lg leading-none">↗</span>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 px-4 rounded-3xl border border-dashed border-white/20 bg-white/5 backdrop-blur-sm mt-8 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-slate-800/80 shadow-[0_0_30px_rgba(0,0,0,0.5)] border border-white/10 flex items-center justify-center mb-6 relative">
              <div className="absolute inset-0 rounded-full border border-blue-500/30 animate-[spin_4s_linear_infinite]"></div>
              <Search size={36} className="text-blue-400" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-3">Chưa có dữ liệu phân tích</h3>
            <p className="text-slate-400 max-w-md text-sm leading-relaxed">
              Hệ thống đã sẵn sàng. Hãy bấm nút <span className="text-blue-400 font-medium">Chạy quy trình thu thập</span> ở góc trên để bắt đầu quét các trang báo và sử dụng AI để lọc tin tức.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
