/**
 * Nút "Xóa khách" ở chi tiết khách (FR-31): chỉ hiện theo cờ `permissions.canDelete` của backend (Quản trị hoặc người tạo khách,
 * mọi tình trạng khách; không còn điều kiện khách "Bỏ"). FE không tự suy quyền từ vai trò.
 * Desktop: nút icon vuông viền đỏ trong cụm nút đầu trang. Mobile: nút chữ đỏ kín đáo cuối tab "Thông tin" (đặt bởi `CustomerDetail.mobile`, không ở đầu trang).
 * Bấm -> hộp xác nhận có ô lý do bắt buộc (dùng chung với xóa hàng loạt) -> `DELETE /crm/customers/:id?reason=`; xong quay về danh sách khách.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useCrmApi, type CustomerDetail } from '@crm/api';
import { DeleteReasonDialog } from '@crm/components/DeleteReasonDialog';
import { describeDeleteError } from '@crm/lib/customerDeletion';
import { DANGER_OUTLINE_BUTTON_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';

interface DeleteCustomerButtonProps {
  customer: Pick<CustomerDetail, 'id' | 'fullName' | 'permissions'>;
  variant: 'desktop' | 'mobile';
}

export const DeleteCustomerButton = ({ customer, variant }: DeleteCustomerButtonProps) => {
  const api = useCrmApi();
  const { navigate, showToast } = useCrmActions();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!customer.permissions.canDelete) return null;

  const openDialog = () => {
    setError(null);
    setIsOpen(true);
  };

  const confirmDelete = async (reason: string) => {
    setIsDeleting(true);
    setError(null);
    const result = await api.deleteCustomer(customer.id, reason);
    setIsDeleting(false);
    if (!result.ok) {
      setError(describeDeleteError(result.error));
      return;
    }
    setIsOpen(false);
    showToast({ title: `Đã xóa khách ${customer.fullName}`, message: 'Quản trị có thể khôi phục ở màn "Khách đã xóa".' });
    navigate('customers');
  };

  return (
    <>
      {variant === 'desktop' ? (
        <button type="button" onClick={openDialog} aria-label="Xóa khách" title="Xóa khách" className={`${DANGER_OUTLINE_BUTTON_CLASS} h-10 w-10 shrink-0`}>
          <Trash2 size={18} aria-hidden="true" />
        </button>
      ) : (
        // Mobile: kín đáo (hành động nhạy cảm) - đường kẻ ngăn phía trên + nút chữ đỏ nhỏ, không nền đặc; đặt cuối tab "Thông tin".
        <div className="border-t border-gray-200 pt-4 text-center dark:border-white/[0.05]">
          <button
            type="button"
            onClick={openDialog}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-error-600 transition-colors hover:bg-error-50 active:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10 dark:active:bg-error-500/10"
          >
            <Trash2 size={15} aria-hidden="true" />
            Xóa khách
          </button>
        </div>
      )}
      <DeleteReasonDialog
        isOpen={isOpen}
        title={`Xóa khách ${customer.fullName}?`}
        description="Khách sẽ bị xóa khỏi mọi danh sách (xóa mềm). Quản trị có thể khôi phục hoặc xóa vĩnh viễn ở màn “Khách đã xóa”."
        confirmLabel="Xóa khách"
        isSubmitting={isDeleting}
        error={error}
        onCancel={() => setIsOpen(false)}
        onConfirm={(reason) => void confirmDelete(reason)}
      />
    </>
  );
};
