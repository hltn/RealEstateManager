// Thanh CTA cố định đáy màn (Mobile CustomerDetailView): Gọi điện / Nhắn Zalo.
// Màn chi tiết không có `CrmBottomNav` (CrmLayout ẩn ở sub view) nên màn tự vẽ thanh CTA đáy.
// Nền/viền như thanh đáy CRM (`bg-white dark:bg-gray-900`, viền gray-200/800); z-30 để backdrop drawer Admin (z-40) phủ lên.
import { MessageCircle, Phone } from 'lucide-react';
import { useContactActions } from '@crm/hooks/useContactActions';
import { BUTTON_PRIMARY_LG_CLASS, BUTTON_SUCCESS_LG_CLASS } from '@crm/lib/uiClasses';

interface MobileContactFooterProps {
  customerId: string;
}

export const MobileContactFooter = ({ customerId }: MobileContactFooterProps) => {
  const { callCustomer, messageZalo } = useContactActions();

  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-gray-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
      <button type="button" onClick={() => callCustomer(customerId)} className={`${BUTTON_PRIMARY_LG_CLASS} h-12 flex-1`}>
        <Phone size={20} aria-hidden="true" />
        Gọi điện
      </button>
      <button type="button" onClick={() => messageZalo(customerId)} className={`${BUTTON_SUCCESS_LG_CLASS} h-12 flex-1`}>
        <MessageCircle size={20} aria-hidden="true" />
        Nhắn Zalo
      </button>
    </footer>
  );
};
