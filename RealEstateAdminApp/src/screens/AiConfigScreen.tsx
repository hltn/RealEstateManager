import { useState, useEffect } from 'react';
import { Bot, Save, AlertCircle, Link } from 'lucide-react';

export default function AiConfigScreen() {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: string }>({ text: '', type: '' });

  const [allModels, setAllModels] = useState<any[]>([]);
  const [modelsList, setModelsList] = useState<any[]>([]);
  const [providersList, setProvidersList] = useState<string[]>([]);

  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/settings/ai-config');
        if (res.ok) {
          const data = await res.json();
          if (data.apiKey) {
            setApiKey('***');
            setHasApiKey(true);
            setProvider(data.provider || '');
            setModel(data.model || '');
            await fetchModels(data.provider, data.model);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    loadConfig();
  }, []);

  const fetchModels = async (initialProvider?: string, initialModel?: string) => {
    try {
      const res = await fetch('/api/settings/ai-models');
      if (res.ok) {
        const data = await res.json();
        const models = data.models || [];
        setAllModels(models);
        
        const providers = [...new Set(models.map((m: any) => m.id.split('/')[0]))] as string[];
        setProvidersList(providers);

        const activeProvider = initialProvider || providers[0] || '';
        setProvider(activeProvider);

        const filteredModels = models.filter((m: any) => m.id.startsWith(activeProvider + '/'));
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
        <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 flex items-center gap-3">
          <Bot className="text-brand-500" size={32} />
          Cấu hình AI
        </h2>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          Cài đặt kết nối với các mô hình AI (thông qua OpenRouter) để phân tích, tóm tắt và đánh giá tin tức bất động sản.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-6 max-w-2xl">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {message.text && (
              <div className={`p-4 rounded-lg flex items-start gap-3 ${
                message.type === 'error' ? 'bg-error-50 dark:bg-error-500/15 text-error-500 border border-error-100 dark:border-error-500/25' : 'bg-success-50 dark:bg-success-500/15 text-success-500 border border-success-100 dark:border-success-500/25'
              }`}>
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <p className="text-theme-sm">{message.text}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Lấy API Key tại <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">openrouter.ai/keys</a>
                </p>
              </div>

              {!hasApiKey ? (
                <div className="pt-4 border-t border-gray-200 dark:border-white/[0.05] flex justify-end">
                  <button
                    onClick={handleConnect}
                    disabled={isSaving || !apiKey}
                    className="flex items-center gap-2 px-5 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-all disabled:opacity-50"
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
                    <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                      Nhà cung cấp (Vendor)
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all appearance-none"
                    >
                      {providersList.map(p => (
                        <option key={p} value={p} className="bg-white dark:bg-gray-900">{p}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                      Mô hình (Model)
                    </label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all appearance-none"
                    >
                      {modelsList.map(m => (
                        <option key={m.id} value={m.id} className="bg-white dark:bg-gray-900">{m.name || m.id}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      ID mô hình: <span className="text-brand-500">{model}</span>
                    </p>
                  </div>
                  
                  <div className="pt-4 border-t border-gray-200 dark:border-white/[0.05] flex justify-end">
                    <button
                      onClick={handleSaveModel}
                      disabled={isSaving}
                      className="flex items-center gap-2 px-5 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-all disabled:opacity-50"
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
