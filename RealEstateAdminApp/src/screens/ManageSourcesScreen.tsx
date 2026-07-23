import { useState, useEffect } from 'react';
import { Edit2, Trash2, Plus, X, Server, Database } from 'lucide-react';

export default function ManageSourcesScreen() {
  const [sources, setSources] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', url: '', crawlConfig: '{}' });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchSources();
  }, []);

  const fetchSources = async () => {
    try {
      const res = await fetch('/api/news-manager/sources');
      const data = await res.json();
      setSources(data);
    } catch (error) {
      console.error('Failed to fetch sources', error);
    }
  };

  const handleOpenModal = (source: any = null) => {
    if (source) {
      setEditingId(source._id);
      setFormData({
        name: source.name,
        url: source.url,
        crawlConfig: JSON.stringify(source.crawlConfig || {}, null, 2)
      });
    } else {
      setEditingId(null);
      setFormData({ name: '', url: '', crawlConfig: '{\n  \n}' });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({ name: '', url: '', crawlConfig: '{}' });
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      let configObj = {};
      try {
        configObj = JSON.parse(formData.crawlConfig);
      } catch (e) {
        alert('Crawl Config phải là JSON hợp lệ.');
        setIsLoading(false);
        return;
      }

      const payload = {
        name: formData.name,
        url: formData.url,
        crawlConfig: configObj
      };

      if (editingId) {
        const res = await fetch(`/api/news-manager/sources/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const updated = await res.json();
        setSources(sources.map(s => s._id === editingId ? updated : s));
        alert('Đã cập nhật nguồn tin!');
      } else {
        const res = await fetch('/api/news-manager/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const created = await res.json();
        setSources([...sources, created]);
        alert('Đã thêm nguồn tin!');
      }
      handleCloseModal();
    } catch (error) {
      console.error('Failed to save source', error);
      alert('Lỗi khi lưu nguồn tin.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa nguồn tin này?')) return;
    try {
      await fetch(`/api/news-manager/sources/${id}`, {
        method: 'DELETE'
      });
      setSources(sources.filter(s => s._id !== id));
      alert('Đã xóa nguồn tin!');
    } catch (error) {
      console.error('Failed to delete source', error);
      alert('Lỗi khi xóa nguồn tin.');
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const res = await fetch(`/api/news-manager/sources/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus })
      });
      const updated = await res.json();
      setSources(sources.map(s => s._id === id ? updated : s));
    } catch (error) {
      console.error('Failed to toggle status', error);
      alert('Lỗi khi cập nhật trạng thái.');
    }
  };

  return (
    <div className="w-full flex flex-col gap-6 relative">
      <header className="flex flex-col gap-2 pb-6 border-b border-white/10">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">Quản lý Nguồn tin</h2>
            <p className="text-slate-400 max-w-2xl text-sm leading-relaxed mt-2">Cấu hình các trang báo bất động sản cần thu thập dữ liệu.</p>
          </div>
          <button 
            onClick={() => handleOpenModal()}
            className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_25px_rgba(37,99,235,0.5)] active:scale-95"
          >
            <Plus size={20} />
            Thêm Mới
          </button>
        </div>
      </header>

      <div className="glass-panel rounded-3xl overflow-hidden border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-white/5 border-b border-white/10 text-xs uppercase text-slate-400 font-semibold">
              <tr>
                <th className="px-6 py-4">Tên Nguồn</th>
                <th className="px-6 py-4">URL</th>
                <th className="px-6 py-4">Trạng thái</th>
                <th className="px-6 py-4 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500 italic">Chưa có dữ liệu nguồn tin.</td>
                </tr>
              ) : (
                sources.map(source => (
                  <tr key={source._id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-medium text-white flex items-center gap-3">
                      <Database className="text-blue-400" size={18} />
                      {source.name}
                    </td>
                    <td className="px-6 py-4 text-slate-400">{source.url}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleToggleActive(source._id, source.isActive)}
                          className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 relative shadow-inner ${source.isActive ? 'bg-emerald-500' : 'bg-slate-700'}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${source.isActive ? 'translate-x-6' : 'translate-x-0'}`}></div>
                        </button>
                        <span className={`text-xs font-medium ${source.isActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {source.isActive ? 'Bật' : 'Tắt'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-3">
                        <button 
                          onClick={() => handleOpenModal(source)}
                          className="p-2 bg-white/5 hover:bg-blue-500/20 text-slate-400 hover:text-blue-400 rounded-lg transition-all border border-transparent hover:border-blue-500/30"
                          title="Sửa"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(source._id)}
                          className="p-2 bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition-all border border-transparent hover:border-red-500/30"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] w-full max-w-2xl overflow-hidden animate-[slideUp_0.3s_ease-out]">
            <div className="flex justify-between items-center p-6 border-b border-white/10 bg-white/5">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Server className="text-blue-400" size={24} />
                {editingId ? 'Cập nhật Nguồn tin' : 'Thêm Nguồn tin mới'}
              </h3>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Tên Nguồn (vd: Batdongsan.com.vn)</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  placeholder="Nhập tên nguồn..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">URL trang web</label>
                <input 
                  type="text" 
                  value={formData.url}
                  onChange={(e) => setFormData({...formData, url: e.target.value})}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  placeholder="https://"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Cấu hình Crawl (JSON)</label>
                <textarea 
                  value={formData.crawlConfig}
                  onChange={(e) => setFormData({...formData, crawlConfig: e.target.value})}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono text-sm h-40 resize-y"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3">
              <button 
                onClick={handleCloseModal}
                className="px-5 py-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/5 font-medium transition-colors"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={handleSave}
                disabled={isLoading}
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-6 py-2.5 rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] disabled:opacity-50 flex items-center gap-2"
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
