// Port từ stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/CreateCustomerView.tsx,
// chuyển sang phong cách Admin App (tài liệu 03): thẻ rounded-2xl có cặp dark:, ô nhập mẫu form Admin, icon lucide-react.
import { buildCrmPath } from '@crm/routes';
import { CreateCustomerFormBody } from './CreateCustomerFormBody';
import { useCreateCustomerForm } from './useCreateCustomerForm';
import { FormActionBar } from '@crm/components/form/FormActionBar';
import { FormPageHeader } from '@crm/components/form/FormPageHeader';

export const CreateCustomerDesktop = () => {
  const form = useCreateCustomerForm();

  return (
    <form onSubmit={form.submit} noValidate aria-label="Thêm khách hàng mới" className="flex w-full flex-col gap-6">
      <FormPageHeader
        variant="desktop"
        title="Thêm khách hàng mới"
        description="Nhập thông tin liên hệ, nhu cầu ban đầu và phân công chuyên viên chăm sóc."
        breadcrumbs={[{ label: 'Quản lý khách hàng', to: buildCrmPath('customers') }, { label: 'Thêm khách hàng mới' }]}
        onBack={form.cancel}
      />
      <CreateCustomerFormBody form={form} variant="desktop" />
      <FormActionBar variant="desktop" submitLabel="Lưu khách hàng" isSubmitting={form.isSubmitting} onCancel={form.cancel} />
    </form>
  );
};

export default CreateCustomerDesktop;
