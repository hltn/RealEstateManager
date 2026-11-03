import { useState } from 'react';
import { Share, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { readIosInstallHintDismissed, readInstallEnvironment, saveIosInstallHintDismissed, shouldShowIosInstallHint } from './iosInstallHintLogic';

/**
 * Banner mỏng hướng dẫn cài app lên Màn hình chính trên iPhone/iPad Safari.
 * Chỉ hiện khi đã đăng nhập, chưa cài và chưa bấm "Đã hiểu" (cờ lưu localStorage). Nằm trong luồng bình thường
 * phía trên header nên không che nội dung và không đổi bố cục khi đã ẩn.
 */
const IosInstallHint = () => {
  const { isAuthenticated } = useAuth();
  // Khởi tạo một lần: trạng thái cài/đã tắt không đổi trong phiên; "Đã hiểu" đặt state để ẩn ngay.
  const [isDismissed, setIsDismissed] = useState<boolean>(readIosInstallHintDismissed);

  if (!shouldShowIosInstallHint({ environment: readInstallEnvironment(), isAuthenticated, isDismissed })) return null;

  const handleDismiss = () => {
    saveIosInstallHintDismissed();
    setIsDismissed(true);
  };

  return (
    <section
      aria-label="Hướng dẫn cài ứng dụng"
      className="flex items-start gap-3 border-b border-brand-100 bg-brand-25 py-2.5 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] text-sm text-gray-700 dark:border-gray-800 dark:bg-brand-500/10 dark:text-gray-300"
    >
      <Share size={18} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Cài STND lên Màn hình chính: bấm nút <strong>Chia sẻ</strong> của Safari, rồi chọn <strong>Thêm vào MH chính</strong>.
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-white/5"
      >
        <X size={14} aria-hidden="true" />
        Đã hiểu
      </button>
    </section>
  );
};

export default IosInstallHint;
