import { UserX } from 'lucide-react';
import { buildCrmPath } from '@crm/routes';
import { useCrmActions } from '@crm/store';
import { BUTTON_OUTLINE_LG_CLASS, CARD_CLASS } from '@crm/lib/uiClasses';
import { FormPageHeader } from './form/FormPageHeader';

interface CustomerNotFoundProps {
  variant: 'desktop' | 'mobile';
  /** Tiêu đề màn (vd "Cập nhật Chân dung khách hàng"). */
  title: string;
}

/**
 * Trạng thái rỗng khi id khách trên URL không tồn tại (dùng chung CustomerDetail / EditPersona / EditInvestment).
 * Mẫu "Trạng thái rỗng đầy đủ" của Admin (`ManageWpScreen.tsx:830-850`).
 */
export const CustomerNotFound = ({ variant, title }: CustomerNotFoundProps) => {
  const { goBack, navigate } = useCrmActions();

  return (
    <div className={`flex w-full flex-col ${variant === 'mobile' ? 'gap-4' : 'gap-6'}`}>
      <FormPageHeader
        variant={variant}
        title={title}
        breadcrumbs={[{ label: 'Quản lý khách hàng', to: buildCrmPath('customers') }, { label: title }]}
        onBack={goBack}
      />
      <div className={`${CARD_CLASS} flex flex-col items-center px-6 py-12 text-center`}>
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
          <UserX size={32} aria-hidden="true" />
        </span>
        <p className="text-base font-medium text-gray-700 dark:text-gray-300">Không tìm thấy khách hàng</p>
        <p className="mt-1 max-w-sm text-theme-sm text-gray-500 dark:text-gray-400">
          Hồ sơ có thể đã bị xoá hoặc đường dẫn không đúng. Vui lòng chọn lại khách hàng từ danh sách.
        </p>
        <button type="button" onClick={() => navigate('customers')} className={`${BUTTON_OUTLINE_LG_CLASS} mt-6`}>
          Về danh sách khách hàng
        </button>
      </div>
    </div>
  );
};
