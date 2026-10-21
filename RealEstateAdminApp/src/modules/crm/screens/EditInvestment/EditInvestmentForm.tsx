import { buildCrmPath } from '@crm/routes';
import { useSelectedCustomer } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import { FormActionBar } from '@crm/components/form/FormActionBar';
import { FormPageHeader } from '@crm/components/form/FormPageHeader';
import { CustomerBadges } from '../EditPersona/components/CustomerBadges';
import { CustomerNotFound } from '@crm/components/CustomerNotFound';
import { InvestmentFormBody } from './InvestmentFormBody';
import { useInvestmentForm } from './useInvestmentForm';

const TITLE = 'Cập nhật Thông tin đầu tư';

interface InvestmentFormProps {
  customer: Customer;
  variant: 'desktop' | 'mobile';
}

const InvestmentForm = ({ customer, variant }: InvestmentFormProps) => {
  const form = useInvestmentForm(customer);
  const isMobile = variant === 'mobile';

  return (
    <form onSubmit={form.submit} noValidate aria-label={TITLE} className={`flex w-full flex-col ${isMobile ? 'gap-4' : 'gap-6'}`}>
      <FormPageHeader
        variant={variant}
        title={TITLE}
        description={isMobile ? undefined : 'Tiêu chí tài chính, loại hình BĐS, mục đích mua và tiến độ giao dịch phục vụ chốt deal.'}
        badges={<CustomerBadges customer={customer} />}
        breadcrumbs={[
          { label: 'Quản lý khách hàng', to: buildCrmPath('customers') },
          { label: customer.name, to: buildCrmPath('customer_detail', customer.id) },
          { label: 'Cập nhật Thông tin đầu tư' },
        ]}
        onBack={form.cancel}
      />
      <InvestmentFormBody form={form} variant={variant} />
      <FormActionBar
        variant={variant}
        submitLabel="Lưu thông tin đầu tư"
        onCancel={form.cancel}
        info="Thay đổi được áp dụng ngay vào hồ sơ khách hàng."
      />
    </form>
  );
};

interface EditInvestmentFormProps {
  variant: 'desktop' | 'mobile';
}

/** Màn sửa thông tin đầu tư: lấy khách theo URL; `key` reset form khi đổi khách. */
export const EditInvestmentForm = ({ variant }: EditInvestmentFormProps) => {
  // `useSelectedCustomer` = khách theo id trên URL; null khi id không tồn tại (không rơi về khách khác).
  const customer = useSelectedCustomer();
  if (!customer) return <CustomerNotFound variant={variant} title={TITLE} />;
  return <InvestmentForm key={customer.id} customer={customer} variant={variant} />;
};
