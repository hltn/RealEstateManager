import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info as InfoIcon, Save, FileText } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPrompts, savePrompts } from '../api/news-manager.api';
import { getApiErrorMessage } from '../utils/fetchPaginated';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  title: string;
  description: string;
  type?: ToastType;
  onClose: () => void;
}

const ToastNotification = ({ title, description, type = 'success', onClose }: ToastProps) => {
  const [progress, setProgress] = useState(100);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    // start progress shrink immediately
    const t1 = setTimeout(() => setProgress(0), 50);
    
    const timer = setTimeout(() => {
      setIsClosing(true);
      setTimeout(onClose, 300); // Wait for slide out animation
    }, 5000);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(timer);
    };
  }, [title, description, onClose]);

  const config = {
    success: {
      icon: CheckCircle,
      color: 'text-emerald-500 dark:text-emerald-400',
      bgIcon: 'bg-emerald-50 dark:bg-emerald-500/10',
      progress: 'bg-emerald-500'
    },
    error: {
      icon: XCircle,
      color: 'text-red-500 dark:text-red-400',
      bgIcon: 'bg-red-50 dark:bg-red-500/10',
      progress: 'bg-red-500'
    },
    warning: {
      icon: AlertTriangle,
      color: 'text-amber-500 dark:text-amber-400',
      bgIcon: 'bg-amber-50 dark:bg-amber-500/10',
      progress: 'bg-amber-500'
    },
    info: {
      icon: InfoIcon,
      color: 'text-blue-500 dark:text-blue-400',
      bgIcon: 'bg-blue-50 dark:bg-blue-500/10',
      progress: 'bg-blue-500'
    }
  }[type];

  const IconComponent = config.icon;

  return (
    <div className={`fixed top-4 right-4 z-[9999] transition-all duration-300 transform ${isClosing ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
      <div className="bg-white dark:bg-gray-800 shadow-2xl rounded-xl p-4 w-[340px] relative overflow-hidden border border-gray-100 dark:border-gray-700">
        <div className="flex items-start gap-3 mb-2">
          <div className={`w-8 h-8 rounded-full ${config.bgIcon} ${config.color} flex items-center justify-center shrink-0 mt-0.5`}>
            <IconComponent className="w-5 h-5" />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
             <div className="flex items-start justify-between gap-2">
               <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{title}</h3>
               <button onClick={() => { setIsClosing(true); setTimeout(onClose, 300); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors shrink-0 -mt-0.5 -mr-1 p-1">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
               </button>
             </div>
             <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 pr-2 line-clamp-2">{description}</p>
          </div>
        </div>
        <div className={`absolute bottom-0 left-0 h-1.5 ${config.progress} transition-all duration-[5000ms] ease-linear`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};

import type { PromptConfig } from '../api/news-manager.api';

export default function AiPromptConfigScreen() {
  const queryClient = useQueryClient();
  const [prompts, setPrompts] = useState<PromptConfig[]>([]);
  const [toast, setToast] = useState<Omit<ToastProps, 'onClose'> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['ai', 'prompts'],
    queryFn: ({ signal }) => fetchPrompts(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Sync danh sách prompt từ server vào state local để chỉnh sửa form (state-sync, không gọi API).
  useEffect(() => {
    if (data) {
      setPrompts(data);
    }
  }, [data]);

  const handlePromptChange = (index: number, field: keyof PromptConfig, value: string) => {
    const newPrompts = [...prompts];
    newPrompts[index] = { ...newPrompts[index], [field]: value };
    setPrompts(newPrompts);
  };

  const saveMutation = useMutation({
    mutationFn: () => savePrompts(prompts),
    onSuccess: () => {
      setToast({
        type: 'success',
        title: 'Lưu thành công',
        description: 'Cấu hình AI Prompts đã được cập nhật',
      });
      void queryClient.invalidateQueries({ queryKey: ['ai', 'prompts'] });
    },
    onError: (err) => {
      setToast({
        type: 'error',
        title: 'Lỗi',
        description: getApiErrorMessage(err, 'Đã có lỗi xảy ra khi lưu cấu hình AI Prompts'),
      });
    },
  });

  const isSaving = saveMutation.isPending;

  return (
    <div className="space-y-6 relative">
      {toast && (
        <ToastNotification
          {...toast}
          onClose={() => setToast(null)}
        />
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 flex items-center gap-3">
          <FileText className="text-brand-500" size={32} />
          AI Prompt Config
        </h2>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          Xem và thay đổi nội dung các prompt trong ai-prompts.json
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <div className="animate-spin w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {prompts.map((prompt, index) => (
            <div key={index} className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                    API AI Name
                  </label>
                  <input
                    type="text"
                    value={prompt.api_ai_name}
                    onChange={(e) => handlePromptChange(index, 'api_ai_name', e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
                  />
                </div>
                <div>
                  <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                    API AI Path
                  </label>
                  <input
                    type="text"
                    value={prompt.api_ai_path}
                    onChange={(e) => handlePromptChange(index, 'api_ai_path', e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
                  />
                </div>
              </div>
              
              <div>
                <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  Prompt
                </label>
                <textarea
                  value={prompt.prompt}
                  onChange={(e) => handlePromptChange(index, 'prompt', e.target.value)}
                  rows={15}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all font-mono text-sm leading-relaxed"
                />
              </div>
            </div>
          ))}

          <div className="pt-4 flex justify-end">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={isSaving}
              className="flex items-center gap-2 px-6 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
              ) : (
                <Save size={20} />
              )}
              Lưu cấu hình
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
