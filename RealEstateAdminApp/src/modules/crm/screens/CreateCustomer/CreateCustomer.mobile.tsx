// Port từ stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/views/AddClientView.tsx, theo phong cách Admin App.
// Không vẽ top app bar riêng (header/drawer của Admin đã có) — hàng "← Quay lại" + tiêu đề nằm trong nội dung.
import { CreateCustomerFormBody } from './CreateCustomerFormBody';
import { useCreateCustomerForm } from './useCreateCustomerForm';
import { FormActionBar } from '@crm/components/form/FormActionBar';
import { FormPageHeader } from '@crm/components/form/FormPageHeader';

export const CreateCustomerMobile = () => {
  const form = useCreateCustomerForm();

  return (
    <form onSubmit={form.submit} noValidate aria-label="Thêm khách hàng mới" className="flex w-full flex-col gap-4">
      <FormPageHeader variant="mobile" title="Thêm khách hàng mới" onBack={form.cancel} />
      <CreateCustomerFormBody form={form} variant="mobile" />
      <FormActionBar variant="mobile" submitLabel="Lưu khách hàng" onCancel={form.cancel} />
    </form>
  );
};

export default CreateCustomerMobile;
