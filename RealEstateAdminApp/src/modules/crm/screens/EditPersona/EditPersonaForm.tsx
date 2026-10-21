import { buildCrmPath } from '@crm/routes';
import { useSelectedCustomer } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import { FormActionBar } from '@crm/components/form/FormActionBar';
import { FormPageHeader } from '@crm/components/form/FormPageHeader';
import { CustomerBadges } from './components/CustomerBadges';
import { CustomerNotFound } from '@crm/components/CustomerNotFound';
import { PersonaFormBody } from './PersonaFormBody';
import { usePersonaForm } from './usePersonaForm';

const TITLE = 'Cập nhật Chân dung khách hàng';

interface PersonaFormProps {
  customer: Customer;
  variant: 'desktop' | 'mobile';
}

const PersonaForm = ({ customer, variant }: PersonaFormProps) => {
  const form = usePersonaForm(customer);
  const isMobile = variant === 'mobile';

  return (
    <form onSubmit={form.submit} noValidate aria-label={TITLE} className={`flex w-full flex-col ${isMobile ? 'gap-4' : 'gap-6'}`}>
      <FormPageHeader
        variant={variant}
        title={TITLE}
        description={isMobile ? undefined : 'Chuẩn hoá chân dung khách hàng (C10, C11) để tư vấn và chăm sóc cá nhân hoá.'}
        badges={<CustomerBadges customer={customer} />}
        breadcrumbs={[
          { label: 'Quản lý khách hàng', to: buildCrmPath('customers') },
          { label: customer.name, to: buildCrmPath('customer_detail', customer.id) },
          { label: 'Cập nhật Chân dung' },
        ]}
        onBack={form.cancel}
      />
      <PersonaFormBody form={form} variant={variant} />
      <FormActionBar
        variant={variant}
        submitLabel="Lưu chân dung"
        onCancel={form.cancel}
        info="Dữ liệu chân dung được cập nhật ngay vào hồ sơ khách hàng."
      />
    </form>
  );
};

interface EditPersonaFormProps {
  variant: 'desktop' | 'mobile';
}

/** Màn sửa chân dung: lấy khách theo URL; `key` reset form khi đổi khách. */
export const EditPersonaForm = ({ variant }: EditPersonaFormProps) => {
  // `useSelectedCustomer` = khách theo id trên URL; null khi id không tồn tại (không rơi về khách khác).
  const customer = useSelectedCustomer();
  if (!customer) return <CustomerNotFound variant={variant} title={TITLE} />;
  return <PersonaForm key={customer.id} customer={customer} variant={variant} />;
};
