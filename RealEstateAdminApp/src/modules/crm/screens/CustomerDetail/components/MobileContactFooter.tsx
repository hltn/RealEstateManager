// Thanh CTA cố định đáy màn (Mobile CustomerDetailView): Ghi chú / Gọi điện / Nhắn Zalo (hiện ở MỌI tab).
// PT-028: "Ghi chú" là nút viền (phụ) đứng đầu hàng, vừa nội dung (`shrink-0`) để hai nút chính chia đều phần còn lại;
// padding ngang + khoảng cách thu nhỏ để cả 3 nút (chữ không bị cắt) vẫn vừa một hàng ở màn 375px, mọi nút cao `h-12` dễ bấm một tay.
// Màn chi tiết không có `CrmBottomNav` (CrmLayout ẩn ở sub view) nên màn tự vẽ thanh CTA đáy.
// Nền/viền như thanh đáy CRM (`bg-white dark:bg-gray-900`, viền gray-200/800); z-30 để backdrop drawer Admin (z-40) phủ lên.
import { MessageCircle, NotebookPen, Phone } from 'lucide-react';
import { useContactActions } from '@crm/hooks/useContactActions';
import { BUTTON_OUTLINE_BASE_CLASS, BUTTON_PRIMARY_BASE_CLASS, BUTTON_SUCCESS_BASE_CLASS } from '@crm/lib/uiClasses';

interface MobileContactFooterProps {
  customerId: string;
  /** Bấm "Ghi chú": màn cha chuyển sang tab Nhật ký và mở form ghi chú đầy đủ (cùng việc với nút "Ghi chú" ở thẻ đầu hồ sơ). */
  onAddNote: () => void;
}

/**
 * Cỡ chung của 3 nút đáy: cao 48px, chữ + icon gọn hơn cỡ LG mặc định để vừa 3 nút trên một hàng.
 * Màn < 360px (iPhone SE đời đầu 320px): bớt padding và ẩn icon (chỉ còn chữ) để "Nhắn Zalo" không bị cắt/tràn; từ 360px trở lên giữ nguyên.
 */
const FOOTER_BUTTON_CLASS = 'h-12 whitespace-nowrap px-3 text-sm max-[359px]:gap-0 max-[359px]:px-2 max-[359px]:[&>svg]:hidden';

export const MobileContactFooter = ({ customerId, onAddNote }: MobileContactFooterProps) => {
  const { callCustomer, messageZalo } = useContactActions();

  return (
    <footer aria-label="Thao tác nhanh với khách" className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-gray-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
      <button type="button" onClick={onAddNote} className={`${BUTTON_OUTLINE_BASE_CLASS} ${FOOTER_BUTTON_CLASS} shrink-0`}>
        <NotebookPen size={18} aria-hidden="true" />
        Ghi chú
      </button>
      <button type="button" onClick={() => callCustomer(customerId)} className={`${BUTTON_PRIMARY_BASE_CLASS} ${FOOTER_BUTTON_CLASS} min-w-0 flex-1`}>
        <Phone size={18} aria-hidden="true" />
        Gọi điện
      </button>
      <button type="button" onClick={() => messageZalo(customerId)} className={`${BUTTON_SUCCESS_BASE_CLASS} ${FOOTER_BUTTON_CLASS} min-w-0 flex-1`}>
        <MessageCircle size={18} aria-hidden="true" />
        Nhắn Zalo
      </button>
    </footer>
  );
};
