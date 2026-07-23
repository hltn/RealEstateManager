import { useState, useEffect } from 'react';
import { Bot, Save, AlertCircle, Link } from 'lucide-react';

export default function AiConfigScreen() {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  const [hasApiKey, setHasApiKey] = useState(false);
  const [allModels, setAllModels] = useState<any[]>([]);
  const [providersList, setProvidersList] = useState<string[]>([]);
  const [modelsList, setModelsList] = useState<any[]>([]);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/settings/ai-config');
      if (response.ok) {
        const data = await response.json();
        setApiKey(data.apiKey || '');
        
        if (data.apiKey) {
          setHasApiKey(true);
          await fetchModels(data.provider, data.model);
        }
      } else {
        throw new Error('Failed to fetch config');
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchModels = async (initialProvider?: string, initialModel?: string) => {
    try {
      const response = await fetch('/api/settings/openrouter-models');
      if (response.ok) {
        const data = await response.json();
        const models = data.data || [];
        setAllModels(models);

        const providers = Array.from(new Set(models.map((m: any) => m.id.split('/')[0]))) as string[];
        setProvidersList(providers);

        let currentProvider = initialProvider;
        if (!currentProvider || !providers.includes(currentProvider)) {
          currentProvider = providers.length > 0 ? providers[0] : '';
        }
        setProvider(currentProvider);

        const filteredModels = models.filter((m: any) => m.id.startsWith(currentProvider + '/'));
        setModelsList(filteredModels);

        if (initialModel && filteredModels.find((m: any) => m.id === initialModel)) {
          setModel(initialModel);
        } else if (filteredModels.length > 0) {
          setModel(filteredModels[0].id);
        }
      } else {
        throw new Error('Failed to fetch models from OpenRouter');
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    }
  };

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const filteredModels = allModels.filter((m: any) => m.id.startsWith(newProvider + '/'));
    setModelsList(filteredModels);
    if (filteredModels.length > 0) {
      setModel(filteredModels[0].id);
    } else {
      setModel('');
    }
  };

  const handleConnect = async () => {
    if (!apiKey) {
      setMessage({ text: 'Vui lòng nhập API Key', type: 'error' });
      return;
    }
    setIsSaving(true);
    setMessage({ text: '', type: '' });
    try {
      const response = await fetch('/api/settings/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      if (response.ok) {
        setMessage({ text: 'Lưu API Key thành công! Đang tải danh sách model...', type: 'success' });
        setHasApiKey(true);
        await fetchModels();
      } else {
        throw new Error('Lỗi khi lưu API Key');
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveModel = async () => {
    setIsSaving(true);
    setMessage({ text: '', type: '' });
    try {
      const response = await fetch('/api/settings/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, apiKey }),
      });
      if (response.ok) {
        setMessage({ text: 'Lưu cấu hình AI thành công!', type: 'success' });
        if (apiKey && apiKey !== '***') {
          // If they updated the API key along with the model
          await fetchModels(provider, model);
        }
      } else {
        throw new Error('Lỗi khi lưu cấu hình');
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold text-white flex items-center gap-3">
          <Bot className="text-purple-500" size={32} />
          Cấu hình AI
        </h2>
        <p className="text-slate-400">
          Cài đặt kết nối với các mô hình AI (thông qua OpenRouter) để phân tích, tóm tắt và đánh giá tin tức bất động sản.
        </p>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-white/10 max-w-2xl">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {message.text && (
              <div className={`p-4 rounded-xl flex items-start gap-3 ${
                message.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <p className="text-sm">{message.text}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Lấy API Key tại <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">openrouter.ai/keys</a>
                </p>
              </div>

              {!hasApiKey ? (
                <div className="pt-4 border-t border-white/10 flex justify-end">
                  <button
                    onClick={handleConnect}
                    disabled={isSaving || !apiKey}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] disabled:opacity-50"
                  >
                    {isSaving ? (
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                    ) : (
                      <Link size={20} />
                    )}
                    Save / Connect
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Nhà cung cấp (Vendor)
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all appearance-none"
                    >
                      {providersList.map(p => (
                        <option key={p} value={p} className="bg-slate-900">{p}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Mô hình (Model)
                    </label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all appearance-none"
                    >
                      {modelsList.map(m => (
                        <option key={m.id} value={m.id} className="bg-slate-900">{m.name || m.id}</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-2">
                      ID mô hình: <span className="text-blue-400">{model}</span>
                    </p>
                  </div>
                  
                  <div className="pt-4 border-t border-white/10 flex justify-end">
                    <button
                      onClick={handleSaveModel}
                      disabled={isSaving}
                      className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] disabled:opacity-50"
                    >
                      {isSaving ? (
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                      ) : (
                        <Save size={20} />
                      )}
                      Save Model
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
