import { useState, useEffect } from 'react';
import { Bot, Save, AlertCircle, Link } from 'lucide-react';
import apiAxios from '../api/axios';
import { getApiErrorMessage } from '../utils/fetchPaginated';

interface OpenRouterModel {
  id: string;
  name?: string;
}

interface AiConfigResponse {
  apiKey?: string;
  provider?: string;
  model?: string;
  must1cApiKey?: string;
  must1cModel?: string;
  activePlatform?: string;
}

interface OpenRouterModelsResponse {
  models?: OpenRouterModel[];
  data?: OpenRouterModel[];
}

export default function AiConfigScreen() {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: string }>({ text: '', type: '' });
  const [activePlatform, setActivePlatform] = useState<string>('OpenRouter');

  const [must1cApiKey, setMust1cApiKey] = useState('');
  const [must1cModel, setMust1cModel] = useState('');
  const [isSavingMust1c, setIsSavingMust1c] = useState(false);
  const [must1cMessage, setMust1cMessage] = useState<{ text: string; type: string }>({ text: '', type: '' });

  const [allModels, setAllModels] = useState<OpenRouterModel[]>([]);
  const [modelsList, setModelsList] = useState<OpenRouterModel[]>([]);
  const [providersList, setProvidersList] = useState<string[]>([]);

  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      try {
        const { data } = await apiAxios.get<AiConfigResponse>('/settings/ai-config');
        if (data.apiKey) {
          setApiKey('***');
          setHasApiKey(true);
          setProvider(data.provider || '');
          setModel(data.model || '');
          await fetchModels(data.provider, data.model);
        }
        if (data.must1cApiKey) {
          setMust1cApiKey('***');
        }
        if (data.must1cModel) {
          setMust1cModel(data.must1cModel);
        }
        if (data.activePlatform) {
          setActivePlatform(data.activePlatform);
        }
      } catch (err) {
        console.error(getApiErrorMessage(err, 'Không tải được cấu hình AI'));
      } finally {
        setIsLoading(false);
      }
    };
    loadConfig();
  }, []);

  const fetchModels = async (initialProvider?: string, initialModel?: string) => {
    try {
      const { data } = await apiAxios.get<OpenRouterModelsResponse>('/settings/openrouter-models');
      const models = data.models || data.data || [];
      setAllModels(models);

      const providers = [...new Set(models.map((m) => m.id.split('/')[0]))] as string[];
      setProvidersList(providers);

      const activeProvider = initialProvider || providers[0] || '';
      setProvider(activeProvider);

      const filteredModels = models.filter((m) => m.id.startsWith(activeProvider + '/'));
      setModelsList(filteredModels);

      if (initialModel && filteredModels.find((m) => m.id === initialModel)) {
        setModel(initialModel);
      } else if (filteredModels.length > 0) {
        setModel(filteredModels[0].id);
      }
    } catch (err) {
      setMessage({ text: getApiErrorMessage(err, 'Failed to fetch models from OpenRouter'), type: 'error' });
    }
  };

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const filteredModels = allModels.filter((m) => m.id.startsWith(newProvider + '/'));
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
      await apiAxios.post('/settings/ai-config', { apiKey });
      setMessage({ text: 'Lưu API Key thành công! Đang tải danh sách model...', type: 'success' });
      setHasApiKey(true);
      await fetchModels();
    } catch (err) {
      setMessage({ text: getApiErrorMessage(err, 'Lỗi khi lưu API Key'), type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveModel = async () => {
    setIsSaving(true);
    setMessage({ text: '', type: '' });
    try {
      await apiAxios.post('/settings/ai-config', { provider, model, apiKey });
      setMessage({ text: 'Lưu cấu hình AI thành công!', type: 'success' });
      if (apiKey && apiKey !== '***') {
        // If they updated the API key along with the model
        await fetchModels(provider, model);
      }
    } catch (err) {
      setMessage({ text: getApiErrorMessage(err, 'Lỗi khi lưu cấu hình'), type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };


  const handleTogglePlatform = async (platform: string) => {
    if (activePlatform === platform) return;

    setActivePlatform(platform);

    try {
      await apiAxios.post('/settings/ai-config', { activePlatform: platform });
    } catch (err) {
      console.error(getApiErrorMessage(err, 'Failed to save active platform'));
    }
  };

const handleSaveMust1c = async () => {
    if (!must1cApiKey || !must1cModel) {
      setMust1cMessage({ text: 'Vui lòng nhập đầy đủ API Key và Model', type: 'error' });
      return;
    }
    setIsSavingMust1c(true);
    setMust1cMessage({ text: '', type: '' });
    try {
      await apiAxios.post('/settings/ai-config', { must1cApiKey, must1cModel });
      setMust1cMessage({ text: 'Lưu cấu hình Must1c thành công!', type: 'success' });
    } catch (err) {
      setMust1cMessage({ text: getApiErrorMessage(err, 'Lỗi khi lưu cấu hình Must1c'), type: 'error' });
    } finally {
      setIsSavingMust1c(false);
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex flex-col gap-2">
            <h3 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">
              OpenRouter AI
            </h3>
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              Sử dụng các mô hình AI từ nền tảng OpenRouter.
            </p>
          </div>
          <button
            onClick={() => handleTogglePlatform('OpenRouter')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${activePlatform === 'OpenRouter' ? 'bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activePlatform === 'OpenRouter' ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
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

      {/* Must1c AI Config Card */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-6 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex flex-col gap-2 mb-6">
          <h3 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">
            Kết nối Must1c AI
          </h3>
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            Cấu hình sử dụng các mô hình AI từ nền tảng Must1c.
          </p>
        </div>
          <button
            onClick={() => handleTogglePlatform('Must1c')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${activePlatform === 'Must1c' ? 'bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activePlatform === 'Must1c' ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        
        <div className="space-y-6">
          {must1cMessage.text && (
            <div className={`p-4 rounded-lg flex items-start gap-3 ${
              must1cMessage.type === 'error' ? 'bg-error-50 dark:bg-error-500/15 text-error-500 border border-error-100 dark:border-error-500/25' : 'bg-success-50 dark:bg-success-500/15 text-success-500 border border-success-100 dark:border-success-500/25'
            }`}>
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <p className="text-theme-sm">{must1cMessage.text}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                MUST1C_API_KEY
              </label>
              <input
                type="password"
                value={must1cApiKey}
                onChange={(e) => setMust1cApiKey(e.target.value)}
                placeholder="mk-live-..."
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
              />
            </div>

            <div>
              <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                MUST1C_MODEL
              </label>
              <input
                type="text"
                value={must1cModel}
                onChange={(e) => setMust1cModel(e.target.value)}
                placeholder="Ví dụ: gpt-5.5, gemini-3.6-flash..."
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
              />
            </div>
            
            <div className="pt-4 border-t border-gray-200 dark:border-white/[0.05] flex justify-end">
              <button
                onClick={handleSaveMust1c}
                disabled={isSavingMust1c || !must1cApiKey || !must1cModel}
                className="flex items-center gap-2 px-5 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-all disabled:opacity-50"
              >
                {isSavingMust1c ? (
                  <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                ) : (
                  <Save size={20} />
                )}
                Save Config
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
