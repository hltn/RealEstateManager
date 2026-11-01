import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Save,
  AlertCircle,
  CheckCircle,
  Loader2,
  Plus,
  Trash2,
  Wifi,
  Image,
  PenTool,
} from 'lucide-react';
import {
  getWpConfig,
  saveWpConfig,
  verifyWpConnection,
  getAiWritingConfig,
  saveAiWritingConfig,
  getAiImageConfig,
  saveAiImageConfig,
  testImageGeneration,
  type CategoryMapping,
  type TagMapping,
  type AiWritingTopic,
} from '../api/knowledge-articles.api';
import { getApiErrorMessage } from '../utils/fetchPaginated';

// ── Inline Message ───────────────────────────────────────

interface InlineMessage {
  text: string;
  type: 'success' | 'error' | '';
}

const InlineAlert = ({ message }: { message: InlineMessage }) => {
  if (!message.text) return null;
  return (
    <div
      className={`p-4 rounded-lg flex items-start gap-3 ${
        message.type === 'error'
          ? 'bg-error-50 dark:bg-error-500/15 text-error-500 border border-error-100 dark:border-error-500/25'
          : 'bg-success-50 dark:bg-success-500/15 text-success-500 border border-success-100 dark:border-success-500/25'
      }`}
    >
      {message.type === 'error' ? <AlertCircle size={20} className="shrink-0 mt-0.5" /> : <CheckCircle size={20} className="shrink-0 mt-0.5" />}
      <p className="text-theme-sm">{message.text}</p>
    </div>
  );
};

// ── WP Connection Tab ────────────────────────────────────

const WpConnectionTab = () => {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<InlineMessage>({ text: '', type: '' });
  const [siteUrl, setSiteUrl] = useState('');
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [defaultCategoryId, setDefaultCategoryId] = useState(0);
  const [categoryMapping, setCategoryMapping] = useState<CategoryMapping[]>([]);
  const [tagMapping, setTagMapping] = useState<TagMapping[]>([]);
  const initializedRef = useRef(false);

  const { data: wpConfig, isLoading } = useQuery({
    queryKey: ['knowledge-config', 'wp'],
    queryFn: ({ signal }) => getWpConfig(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (initializedRef.current || !wpConfig) return;
    initializedRef.current = true;
    setSiteUrl(wpConfig.siteUrl ?? '');
    setUsername(wpConfig.username ?? '');
    setAppPassword(wpConfig.appPassword ?? '');
    setDefaultCategoryId(wpConfig.defaultCategoryId ?? 0);
    setCategoryMapping(wpConfig.categoryMapping ?? []);
    setTagMapping(wpConfig.tagMapping ?? []);
  }, [wpConfig]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveWpConfig({
        siteUrl,
        username,
        appPassword,
        defaultCategoryId,
        categoryMapping,
        tagMapping,
      }),
    onSuccess: () => {
      setMessage({ text: 'Lưu cấu hình WP thành công!', type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-config', 'wp'] });
    },
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Lỗi khi lưu'), type: 'error' }),
  });

  const verifyMutation = useMutation({
    mutationFn: verifyWpConnection,
    onSuccess: (result) => {
      if (result.valid) {
        setMessage({ text: `Kết nối thành công! Site: ${result.siteName ?? 'N/A'}`, type: 'success' });
      } else {
        setMessage({ text: `Kết nối thất bại: ${result.error ?? 'Unknown error'}`, type: 'error' });
      }
    },
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Lỗi kiểm tra kết nối'), type: 'error' }),
  });

  const addCategory = () => {
    setCategoryMapping([...categoryMapping, { slug: '', wpCategoryId: 0, wpCategoryName: '' }]);
  };

  const removeCategory = (index: number) => {
    setCategoryMapping(categoryMapping.filter((_, i) => i !== index));
  };

  const updateCategory = (index: number, field: keyof CategoryMapping, value: string | number) => {
    const updated = [...categoryMapping];
    updated[index] = { ...updated[index], [field]: value };
    setCategoryMapping(updated);
  };

  const addTag = () => {
    setTagMapping([...tagMapping, { name: '', wpTagId: 0 }]);
  };

  const removeTag = (index: number) => {
    setTagMapping(tagMapping.filter((_, i) => i !== index));
  };

  const updateTag = (index: number, field: keyof TagMapping, value: string | number) => {
    const updated = [...tagMapping];
    updated[index] = { ...updated[index], [field]: value };
    setTagMapping(updated);
  };

  const inputClass =
    'w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all';
  const labelClass = 'text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InlineAlert message={message} />

      {/* Basic Connection */}
      <div className="space-y-4">
        <div>
          <label className={labelClass}>WordPress Site URL</label>
          <input type="url" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://example.com" className={inputClass} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Username</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Application Password</label>
            <input type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Default Category ID</label>
          <input type="number" value={defaultCategoryId} onChange={(e) => setDefaultCategoryId(Number(e.target.value))} className={inputClass} />
        </div>
      </div>

      {/* Category Mapping */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-theme-sm font-semibold text-gray-700 dark:text-gray-300">Category Mapping</label>
          <button onClick={addCategory} className="inline-flex items-center gap-1 text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400">
            <Plus size={14} /> Thêm
          </button>
        </div>
        {categoryMapping.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Chưa có mapping nào.</p>
        ) : (
          <div className="space-y-2">
            {categoryMapping.map((cat, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  placeholder="Slug"
                  value={cat.slug}
                  onChange={(e) => updateCategory(index, 'slug', e.target.value)}
                  className={`${inputClass} flex-1`}
                />
                <input
                  placeholder="WP Category ID"
                  type="number"
                  value={cat.wpCategoryId}
                  onChange={(e) => updateCategory(index, 'wpCategoryId', Number(e.target.value))}
                  className={`${inputClass} w-32`}
                />
                <input
                  placeholder="WP Category Name"
                  value={cat.wpCategoryName}
                  onChange={(e) => updateCategory(index, 'wpCategoryName', e.target.value)}
                  className={`${inputClass} flex-1`}
                />
                <button onClick={() => removeCategory(index)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tag Mapping */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-theme-sm font-semibold text-gray-700 dark:text-gray-300">Tag Mapping</label>
          <button onClick={addTag} className="inline-flex items-center gap-1 text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400">
            <Plus size={14} /> Thêm
          </button>
        </div>
        {tagMapping.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Chưa có mapping nào.</p>
        ) : (
          <div className="space-y-2">
            {tagMapping.map((tag, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  placeholder="Tag name"
                  value={tag.name}
                  onChange={(e) => updateTag(index, 'name', e.target.value)}
                  className={`${inputClass} flex-1`}
                />
                <input
                  placeholder="WP Tag ID"
                  type="number"
                  value={tag.wpTagId}
                  onChange={(e) => updateTag(index, 'wpTagId', Number(e.target.value))}
                  className={`${inputClass} w-32`}
                />
                <button onClick={() => removeTag(index)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-white/[0.05]">
        <button
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {verifyMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}
          Kiểm tra kết nối
        </button>
        <div className="flex-1" />
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-all disabled:opacity-50"
        >
          {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Lưu cấu hình
        </button>
      </div>
    </div>
  );
};

// ── AI Writing Tab ───────────────────────────────────────

const AiWritingTab = () => {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<InlineMessage>({ text: '', type: '' });
  const [promptTemplate, setPromptTemplate] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [maxTokens, setMaxTokens] = useState(4096);
  const [temperature, setTemperature] = useState(0.7);
  const [topics, setTopics] = useState<AiWritingTopic[]>([]);
  const [articlesPerBatch, setArticlesPerBatch] = useState(3);
  const initializedRef = useRef(false);

  const { data: aiWritingConfig, isLoading } = useQuery({
    queryKey: ['knowledge-config', 'ai-writing'],
    queryFn: ({ signal }) => getAiWritingConfig(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (initializedRef.current || !aiWritingConfig) return;
    initializedRef.current = true;
    setPromptTemplate(aiWritingConfig.promptTemplate ?? '');
    setModel(aiWritingConfig.model ?? '');
    setProvider(aiWritingConfig.provider ?? '');
    setMaxTokens(aiWritingConfig.maxTokens ?? 4096);
    setTemperature(aiWritingConfig.temperature ?? 0.7);
    setTopics(aiWritingConfig.topics ?? []);
    setArticlesPerBatch(aiWritingConfig.articlesPerBatch ?? 3);
  }, [aiWritingConfig]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveAiWritingConfig({
        promptTemplate,
        model,
        provider,
        maxTokens,
        temperature,
        topics,
        articlesPerBatch,
      }),
    onSuccess: () => {
      setMessage({ text: 'Lưu cấu hình AI Writing thành công!', type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-config', 'ai-writing'] });
    },
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Lỗi khi lưu'), type: 'error' }),
  });

  const addTopic = () => {
    setTopics([...topics, { slug: '', name: '', description: '' }]);
  };

  const removeTopic = (index: number) => {
    setTopics(topics.filter((_, i) => i !== index));
  };

  const updateTopic = (index: number, field: keyof AiWritingTopic, value: string) => {
    const updated = [...topics];
    updated[index] = { ...updated[index], [field]: value };
    setTopics(updated);
  };

  const inputClass =
    'w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all';
  const labelClass = 'text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InlineAlert message={message} />

      {/* Prompt Template */}
      <div>
        <label className={labelClass}>Prompt Template</label>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          rows={8}
          placeholder="Viết bài kiến thức về {{topic}} với chủ đề {{category}}..."
          className={`${inputClass} font-mono text-sm resize-y`}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Sử dụng <code className="text-brand-500">{'{{topic}}'}</code> và <code className="text-brand-500">{'{{category}}'}</code> làm placeholder.
        </p>
      </div>

      {/* Model Settings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Provider</label>
          <input type="text" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="OpenRouter" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Model</label>
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="google/gemini-2.5-flash" className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>Max Tokens</label>
          <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Temperature</label>
          <input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Articles / Batch</label>
          <input type="number" min="1" value={articlesPerBatch} onChange={(e) => setArticlesPerBatch(Number(e.target.value))} className={inputClass} />
        </div>
      </div>

      {/* Topics */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-theme-sm font-semibold text-gray-700 dark:text-gray-300">Topics (Category Rotation)</label>
          <button onClick={addTopic} className="inline-flex items-center gap-1 text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400">
            <Plus size={14} /> Thêm topic
          </button>
        </div>
        {topics.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Chưa có topic nào. Thêm topic để pipeline tự xoay vòng danh mục.</p>
        ) : (
          <div className="space-y-3">
            {topics.map((topic, index) => (
              <div key={index} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    placeholder="Slug (e.g. ha-noi)"
                    value={topic.slug}
                    onChange={(e) => updateTopic(index, 'slug', e.target.value)}
                    className={`${inputClass} flex-1`}
                  />
                  <input
                    placeholder="Tên hiển thị"
                    value={topic.name}
                    onChange={(e) => updateTopic(index, 'name', e.target.value)}
                    className={`${inputClass} flex-1`}
                  />
                  <button onClick={() => removeTopic(index)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
                <input
                  placeholder="Mô tả topic (context cho AI)"
                  value={topic.description}
                  onChange={(e) => updateTopic(index, 'description', e.target.value)}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-white/[0.05]">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-all disabled:opacity-50"
        >
          {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Lưu cấu hình
        </button>
      </div>
    </div>
  );
};

// ── AI Image Tab ─────────────────────────────────────────

const AiImageTab = () => {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<InlineMessage>({ text: '', type: '' });
  const [enabled, setEnabled] = useState(true);
  const [promptTemplate, setPromptTemplate] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [style, setStyle] = useState('realistic');
  const [testImageUrl, setTestImageUrl] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const { data: aiImageConfig, isLoading } = useQuery({
    queryKey: ['knowledge-config', 'ai-image'],
    queryFn: ({ signal }) => getAiImageConfig(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (initializedRef.current || !aiImageConfig) return;
    initializedRef.current = true;
    setEnabled(aiImageConfig.enabled ?? true);
    setPromptTemplate(aiImageConfig.promptTemplate ?? '');
    setModel(aiImageConfig.model ?? '');
    setProvider(aiImageConfig.provider ?? '');
    setWidth(aiImageConfig.width ?? 1024);
    setHeight(aiImageConfig.height ?? 1024);
    setStyle(aiImageConfig.style ?? 'realistic');
  }, [aiImageConfig]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveAiImageConfig({
        enabled,
        promptTemplate,
        model,
        provider,
        width,
        height,
        style,
      }),
    onSuccess: () => {
      setMessage({ text: 'Lưu cấu hình AI Image thành công!', type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-config', 'ai-image'] });
    },
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Lỗi khi lưu'), type: 'error' }),
  });

  const testImageMutation = useMutation({
    mutationFn: testImageGeneration,
    onSuccess: (result) => {
      setTestImageUrl(result.imageUrl);
      setMessage({ text: 'Tạo ảnh mẫu thành công!', type: 'success' });
    },
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Tạo ảnh mẫu thất bại'), type: 'error' }),
  });

  const inputClass =
    'w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all';
  const labelClass = 'text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InlineAlert message={message} />

      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-theme-sm font-semibold text-gray-700 dark:text-gray-300">Kích hoạt sinh ảnh</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Tắt để bỏ qua bước sinh ảnh trong pipeline.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {enabled && (
        <>
          {/* Prompt Template */}
          <div>
            <label className={labelClass}>Image Prompt Template</label>
            <textarea
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              rows={4}
              placeholder="Tạo ảnh minh họa về {{title}} với tóm tắt: {{content_summary}}"
              className={`${inputClass} font-mono text-sm resize-y`}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Sử dụng <code className="text-brand-500">{'{{title}}'}</code> và <code className="text-brand-500">{'{{content_summary}}'}</code> làm placeholder.
            </p>
          </div>

          {/* Provider / Model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Provider</label>
              <input type="text" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="ComfyUI" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Model</label>
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="stable-diffusion-xl" className={inputClass} />
            </div>
          </div>

          {/* Dimensions + Style */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Width</label>
              <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Height</label>
              <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Style</label>
              <select value={style} onChange={(e) => setStyle(e.target.value)} className={inputClass}>
                <option value="realistic">Realistic</option>
                <option value="illustration">Illustration</option>
                <option value="watercolor">Watercolor</option>
                <option value="3d">3D Render</option>
              </select>
            </div>
          </div>
        </>
      )}

      {/* Save + Test */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-white/[0.05]">
        <button
          onClick={() => testImageMutation.mutate()}
          disabled={testImageMutation.isPending || !enabled}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {testImageMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Image size={16} />}
          Tạo ảnh mẫu
        </button>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-all disabled:opacity-50"
        >
          {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Lưu cấu hình
        </button>
      </div>

      {/* Test Image Preview */}
      {testImageUrl && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">Ảnh mẫu:</p>
          <img
            src={testImageUrl}
            alt="AI generated sample"
            className="w-full max-h-64 object-contain rounded-lg border border-gray-200 dark:border-gray-700"
          />
        </div>
      )}
    </div>
  );
};

// ── Tab Definitions ──────────────────────────────────────

type ConfigTab = 'wp' | 'ai-writing' | 'ai-image';

const TABS: Array<{ key: ConfigTab; label: string; icon: React.ReactNode }> = [
  { key: 'wp', label: 'WordPress Connection', icon: <Wifi size={16} /> },
  { key: 'ai-writing', label: 'AI Writing', icon: <PenTool size={16} /> },
  { key: 'ai-image', label: 'AI Image Generation', icon: <Image size={16} /> },
];

// ── Main Screen ──────────────────────────────────────────

export default function KnowledgeConfigScreen() {
  const [activeTab, setActiveTab] = useState<ConfigTab>('wp');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 flex items-center gap-3">
          <Settings className="text-brand-500" size={32} />
          Knowledge Articles — Cấu hình
        </h2>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          Cấu hình kết nối WordPress, AI Writing và AI Image Generation cho pipeline tự động.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-white/[0.05]">
        <nav className="flex gap-1" aria-label="Config tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-6">
        {activeTab === 'wp' && <WpConnectionTab />}
        {activeTab === 'ai-writing' && <AiWritingTab />}
        {activeTab === 'ai-image' && <AiImageTab />}
      </div>
    </div>
  );
}
