/**
 * Nút "Xóa khách" ở chi tiết khách (Sửa đổi D): chỉ hiện khi khách thuộc nhóm "Bỏ" VÀ backend cho phép (`permissions.canDelete`).
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
  customer: Pick<CustomerDetail, 'id' | 'fullName' | 'status' | 'permissions'>;
  variant: 'desktop' | 'mobile';
}

export const DeleteCustomerButton = ({ customer, variant }: DeleteCustomerButtonProps) => {
  const api = useCrmApi();
  const { navigate, showToast } = useCrmActions();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (customer.status.listGroup !== 'DROPPED' || !customer.permissions.canDelete) return null;

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
        <button type="button" onClick={openDialog} className={`${DANGER_OUTLINE_BUTTON_CLASS} col-span-2 h-10 w-full text-sm`}>
          <Trash2 size={16} aria-hidden="true" />
          Xóa khách
        </button>
      )}
      <DeleteReasonDialog
        isOpen={isOpen}
        title={`Xóa khách ${customer.fullName}?`}
        description="Khách thuộc danh sách Bỏ sẽ bị xóa khỏi mọi danh sách (xóa mềm). Quản trị có thể khôi phục hoặc xóa vĩnh viễn ở màn “Khách đã xóa”."
        confirmLabel="Xóa khách"
        isSubmitting={isDeleting}
        error={error}
        onCancel={() => setIsOpen(false)}
        onConfirm={(reason) => void confirmDelete(reason)}
      />
    </>
  );
};
