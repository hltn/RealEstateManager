import { useCustomerDetail, type CustomerDetail } from '@crm/api';
import { CustomerNotFound } from '@crm/components/CustomerNotFound';
import { FormActionBar } from '@crm/components/form/FormActionBar';
import { FormPageHeader } from '@crm/components/form/FormPageHeader';
import { buildCrmPath } from '@crm/routes';
import { useCrmState } from '@crm/store';
import type { PersonaGroupCode } from '@crm/types/crm';
import { CustomerBadges } from './components/CustomerBadges';
import { PersonaFormBody } from './PersonaFormBody';
import { usePersonaForm } from './usePersonaForm';

export interface PersonaScreenConfig {
  title: string;
  breadcrumbLabel: string;
  description: string;
  groupCodes: readonly PersonaGroupCode[];
  hasBasicInfo: boolean;
  submitLabel: string;
  successToastTitle: string;
}

/** Màn "Chân dung khách hàng": thông tin cơ bản + thẻ + các nhóm chân dung (trừ Nhu cầu BĐS). */
const PERSONA_SCREEN: PersonaScreenConfig = {
  title: 'Cập nhật Chân dung khách hàng',
  breadcrumbLabel: 'Cập nhật chân dung',
  description: 'Thông tin giúp hiểu khách để chăm sóc đúng người, đúng cách, đúng thời điểm. Chỉ họ tên và SĐT là bắt buộc.',
  groupCodes: ['PERSONAL', 'OCCUPATION', 'LIFESTYLE', 'FAMILY', 'CONTACT', 'OCCASION'],
  hasBasicInfo: true,
  submitLabel: 'Lưu chân dung',
  successToastTitle: 'Đã cập nhật chân dung khách hàng',
};

interface PersonaFormProps {
  customer: CustomerDetail;
  variant: 'desktop' | 'mobile';
  config: PersonaScreenConfig;
}

const PersonaForm = ({ customer, variant, config }: PersonaFormProps) => {
  const form = usePersonaForm(customer, config);
  const isMobile = variant === 'mobile';

  return (
    <form onSubmit={form.submit} noValidate aria-label={config.title} className={`flex w-full flex-col ${isMobile ? 'gap-4' : 'gap-6'}`}>
      <FormPageHeader
        variant={variant}
        title={config.title}
        description={isMobile ? undefined : config.description}
        badges={<CustomerBadges customer={{ name: customer.fullName }} />}
        breadcrumbs={[
          { label: 'Quản lý khách hàng', to: buildCrmPath('customers') },
          { label: customer.fullName, to: buildCrmPath('customer_detail', customer.id) },
          { label: config.breadcrumbLabel },
        ]}
        onBack={form.cancel}
      />
      <PersonaFormBody form={form} variant={variant} hasBasicInfo={config.hasBasicInfo} />
      <FormActionBar variant={variant} submitLabel={config.submitLabel} onCancel={form.cancel} info="Ngày cập nhật cuối được hệ thống tự ghi khi lưu." />
    </form>
  );
};

interface EditPersonaFormProps {
  variant: 'desktop' | 'mobile';
  config?: PersonaScreenConfig;
}

/** Màn sửa chân dung/nhu cầu: lấy khách theo URL (trong phạm vi quyền); `key` reset form khi đổi khách. */
export const EditPersonaForm = ({ variant, config = PERSONA_SCREEN }: EditPersonaFormProps) => {
  const { selectedCustomerId } = useCrmState();
  const { data: customer } = useCustomerDetail(selectedCustomerId);
  if (!customer) return <CustomerNotFound variant={variant} title={config.title} />;
  return <PersonaForm key={customer.id} customer={customer} variant={variant} config={config} />;
};
