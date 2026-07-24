import { useState, useEffect } from 'react';
import { Edit2, Trash2, Plus, X, Server, Database } from 'lucide-react';

export default function ManageSourcesScreen() {
  const [sources, setSources] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', url: '', rssUrl: '', crawlConfig: '{}' });
  const [isLoading, setIsLoading] = useState(false);

  const fetchSources = async () => {
    try {
      const res = await fetch('/api/news-manager/sources');
      const data = await res.json();
      setSources(data.data || []);
    } catch (err) {
      console.error('Error fetching sources', err);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const handleOpenModal = (source?: any) => {
    if (source) {
      setEditingId(source._id);
      setFormData({ 
        name: source.name, 
        url: source.url, 
        rssUrl: source.rssUrl || '',
        crawlConfig: JSON.stringify(source.crawlConfig || {}, null, 2) 
      });
    } else {
      setEditingId(null);
      setFormData({ name: '', url: '', rssUrl: '', crawlConfig: '{}' });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({ name: '', url: '', rssUrl: '', crawlConfig: '{}' });
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      let crawlConfigParsed = {};
      try {
        crawlConfigParsed = JSON.parse(formData.crawlConfig);
      } catch {}

      const url = editingId ? `/api/news-manager/sources/${editingId}` : '/api/news-manager/sources';
      const method = editingId ? 'PUT' : 'POST';
      
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name, url: formData.url, rssUrl: formData.rssUrl, crawlConfig: crawlConfigParsed })
      });
      handleCloseModal();
      fetchSources();
    } catch (err) {
      console.error('Error saving source', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bạn có chắc muốn xóa nguồn tin này?')) return;
    try {
      await fetch(`/api/news-manager/sources/${id}`, { method: 'DELETE' });
      fetchSources();
    } catch (err) {
      console.error('Error deleting source', err);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      await fetch(`/api/news-manager/sources/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive })
      });
      fetchSources();
    } catch (err) {
      console.error('Error toggling source', err);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6">
      <header className="flex flex-col gap-2 pb-6 border-b border-gray-200 dark:border-white/[0.05]">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Quản lý Nguồn tin</h2>
            <p className="text-theme-sm text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed mt-2">Cấu hình các trang báo bất động sản cần thu thập dữ liệu.</p>
          </div>
          <button 
            onClick={() => handleOpenModal()}
            className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-5 py-3 rounded-lg transition-all duration-300 flex items-center gap-2 active:scale-95"
          >
            <Plus size={20} />
            Thêm Mới
          </button>
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-gray-100 dark:border-white/[0.05]">
              <tr className="bg-gray-50 dark:bg-gray-900">
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Tên Nguồn</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">URL</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Trạng thái</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-center uppercase">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-gray-500 dark:text-gray-400 italic text-theme-sm">Chưa có dữ liệu nguồn tin.</td>
                </tr>
              ) : (
                sources.map(source => (
                  <tr key={source._id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-4 font-medium text-gray-800 dark:text-white/90 text-theme-sm">
                      <div className="flex items-center gap-3">
                        <Database className="text-brand-500" size={18} />
                        {source.name}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-theme-sm text-gray-500 dark:text-gray-400">{source.url}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleToggleActive(source._id, source.isActive)}
                          className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 relative ${source.isActive ? 'bg-success-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${source.isActive ? 'translate-x-6' : 'translate-x-0'}`}></div>
                        </button>
                        <span className={`text-xs font-medium ${source.isActive ? 'text-success-500' : 'text-gray-500 dark:text-gray-400'}`}>
                          {source.isActive ? 'Bật' : 'Tắt'}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-3">
                        <button 
                          onClick={() => handleOpenModal(source)}
                          className="p-2 bg-gray-100 dark:bg-gray-800 hover:bg-brand-50 dark:hover:bg-brand-500/10 text-gray-500 dark:text-gray-400 hover:text-brand-500 rounded-lg transition-all border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-500/30"
                          title="Sửa"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(source._id)}
                          className="p-2 bg-gray-100 dark:bg-gray-800 hover:bg-error-50 dark:hover:bg-error-500/10 text-gray-500 dark:text-gray-400 hover:text-error-500 rounded-lg transition-all border border-gray-200 dark:border-gray-700 hover:border-error-300 dark:hover:border-error-500/30"
                          title="Xóa"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-theme-md w-full max-w-2xl overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-white/[0.05] bg-gray-50 dark:bg-gray-800/50">
              <h3 className="text-xl font-bold text-gray-800 dark:text-white/90 flex items-center gap-2">
                <Server className="text-brand-500" size={24} />
                {editingId ? 'Cập nhật Nguồn tin' : 'Thêm Nguồn tin mới'}
              </h3>
              <button onClick={handleCloseModal} className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white/90 transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              <div>
                <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Tên Nguồn (vd: Batdongsan.com.vn)</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
                  placeholder="Nhập tên nguồn..."
                />
              </div>
              
              <div>
                <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">URL trang web</label>
                <input 
                  type="text" 
                  value={formData.url}
                  onChange={(e) => setFormData({...formData, url: e.target.value})}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
                  placeholder="https://"
                />
              </div>

              <div>
                <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">URL RSS Feed</label>
                <input 
                  type="text" 
                  value={formData.rssUrl}
                  onChange={(e) => setFormData({...formData, rssUrl: e.target.value})}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
                  placeholder="https://.../rss"
                />
              </div>

              <div>
                <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Cấu hình Crawl (JSON)</label>
                <textarea 
                  value={formData.crawlConfig}
                  onChange={(e) => setFormData({...formData, crawlConfig: e.target.value})}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all font-mono text-sm h-40 resize-y"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-white/[0.05] bg-gray-50 dark:bg-gray-800/30 flex justify-end gap-3">
              <button 
                onClick={handleCloseModal}
                className="px-5 py-2.5 rounded-lg text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white/90 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium transition-colors"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={handleSave}
                disabled={isLoading}
                className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-5 py-2.5 rounded-lg transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isLoading && <span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></span>}
                {editingId ? 'Cập nhật' : 'Thêm mới'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
