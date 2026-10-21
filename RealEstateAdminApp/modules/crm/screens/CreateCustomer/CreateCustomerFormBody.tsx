/**
 * Thân form "Thêm khách hàng mới" dùng chung cho 2 biến thể (desktop/tablet + mobile).
 * Bố cục: desktop >= 1280px chia 8/4 cột; hẹp hơn xếp 1 cột, trường đôi co về 2 cột từ `sm`.
 */
import {
  Building2,
  CircleCheck,
  IdCard,
  Lock,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  RefreshCw,
  Target,
  TriangleAlert,
  User,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import type { CustomerStatus } from '@crm/types/crm';
import {
  CREATE_FORM_PROJECTS,
  INITIAL_STATUS_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  RESIDENCE_OPTIONS,
  STAFF_OPTIONS,
} from './createCustomerForm';
import { isValidVnPhone, withCurrentOption } from './customerFormRules';
import type { CreateCustomerFormApi } from './useCreateCustomerForm';
import { BudgetRangeInput } from '@crm/components/form/BudgetRangeInput';
import { ChipMultiSelect, ChoiceGroup, type ChoiceOption } from '@crm/components/form/ChoiceGroup';
import { DuplicatePhoneBanner } from './components/DuplicatePhoneBanner';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { MaskedIdInput } from '@crm/components/form/MaskedIdInput';
import { SectionCard } from '@crm/components/form/SectionCard';
import { CUSTOMER_STATUS_STYLE } from '@crm/components/CustomerStatusChip';
import { SelectInput } from '@crm/components/form/SelectInput';
import { CHIP_SMALL_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import { TextInput } from '@crm/components/form/TextInput';

const STATUS_CHOICES: ChoiceOption<CustomerStatus>[] = INITIAL_STATUS_OPTIONS.map((status) => ({
  value: status,
  label: status,
  dotClass: CUSTOMER_STATUS_STYLE[status].dotClassName,
}));

const SUPPORT_STAFF_OPTIONS = [{ value: '', label: '— Không chọn cộng sự —' }, ...STAFF_OPTIONS];

const REQUIRED_CHIP = (
  <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Bắt buộc</span>
);

interface PhoneStatusChipProps {
  isDuplicate: boolean;
  isReady: boolean;
}

/** Chip trạng thái đối soát SĐT cạnh nhãn (mẫu chip trạng thái Admin). */
const PhoneStatusChip = ({ isDuplicate, isReady }: PhoneStatusChipProps) => {
  if (isDuplicate) {
    return (
      <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.error}`}>
        <TriangleAlert size={12} aria-hidden="true" />
        Đã có trên hệ thống
      </span>
    );
  }
  if (isReady) {
    return (
      <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.success}`}>
        <CircleCheck size={12} aria-hidden="true" />
        Sẵn sàng tiếp nhận
      </span>
    );
  }
  return (
    <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>
      <RefreshCw size={12} aria-hidden="true" />
      Nhập để đối soát…
    </span>
  );
};

interface CreateCustomerFormBodyProps {
  form: CreateCustomerFormApi;
  variant: 'desktop' | 'mobile';
}

export const CreateCustomerFormBody = ({ form, variant }: CreateCustomerFormBodyProps) => {
  const { values, errors, duplicateCustomer, setField, toggleProject, openDuplicateCustomer } = form;
  const isDesktop = variant === 'desktop';
  const isPhoneReady = !duplicateCustomer && isValidVnPhone(values.phone);
  const idPrefix = `cc-${variant}`;
  const fieldId = (name: string) => `${idPrefix}-${name}`;

  const basicInfoSection = (
    <SectionCard icon={UserRound} title="Thông tin cơ bản" description="Định danh và thông tin liên lạc" aside={REQUIRED_CHIP}>
      <FormField inputId={fieldId('name')} label="Họ và tên khách hàng" isRequired error={errors.name}>
        <TextInput
          id={fieldId('name')}
          icon={User}
          autoComplete="off"
          value={values.name}
          onChange={(event) => setField('name', event.target.value)}
          placeholder="Ví dụ: Nguyễn Văn A"
          hasError={Boolean(errors.name)}
          {...getFieldA11yProps(getErrorId(fieldId('name')), errors.name)}
        />
      </FormField>

      <FormField
        inputId={fieldId('phone')}
        label="Số điện thoại"
        isRequired
        error={errors.phone}
        hint="Di động 10 số (03/05/07/08/09) hoặc máy bàn 02x."
        labelAddon={<PhoneStatusChip isDuplicate={Boolean(duplicateCustomer)} isReady={isPhoneReady} />}
      >
        <TextInput
          id={fieldId('phone')}
          type="tel"
          inputMode="tel"
          icon={Phone}
          autoComplete="off"
          value={values.phone}
          onChange={(event) => setField('phone', event.target.value)}
          placeholder="0912 345 678"
          hasError={Boolean(errors.phone) || Boolean(duplicateCustomer)}
          className="font-mono"
          {...getFieldA11yProps(getErrorId(fieldId('phone')), errors.phone)}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField inputId={fieldId('email')} label="Email cá nhân" error={errors.email}>
          <TextInput
            id={fieldId('email')}
            type="email"
            icon={Mail}
            value={values.email}
            onChange={(event) => setField('email', event.target.value)}
            placeholder="khachhang@stnd.vn (tùy chọn)"
            hasError={Boolean(errors.email)}
            {...getFieldA11yProps(getErrorId(fieldId('email')), errors.email)}
          />
        </FormField>

        <FormField
          inputId={fieldId('id-number')}
          label="Số CCCD / Định danh"
          error={errors.idNumber}
          labelAddon={
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              <Lock size={12} aria-hidden="true" />
              Che khi không sửa
            </span>
          }
        >
          <MaskedIdInput
            id={fieldId('id-number')}
            icon={IdCard}
            value={values.idNumber}
            onValueChange={(value) => setField('idNumber', value)}
            placeholder="12 số (dùng cho hợp đồng cọc)"
            hasError={Boolean(errors.idNumber)}
            {...getFieldA11yProps(getErrorId(fieldId('id-number')), errors.idNumber)}
          />
        </FormField>
      </div>

      <FormField inputId={fieldId('residence')} label="Khu vực nơi ở / Địa chỉ">
        <SelectInput
          id={fieldId('residence')}
          icon={MapPin}
          options={withCurrentOption(RESIDENCE_OPTIONS, values.currentResidence)}
          value={values.currentResidence}
          onChange={(event) => setField('currentResidence', event.target.value)}
        />
      </FormField>
    </SectionCard>
  );

  const demandSection = (
    <SectionCard icon={Target} title="Nhu cầu & Dự án quan tâm" description="Khảo sát ban đầu để phân loại khách">
      <ChipMultiSelect
        legend="Dự án quan tâm"
        icon={Building2}
        options={CREATE_FORM_PROJECTS}
        selected={values.interestedProjects}
        onToggle={toggleProject}
      />

      <ChoiceGroup
        legend="Tình trạng ban đầu"
        options={STATUS_CHOICES}
        value={values.status}
        onChange={(status) => setField('status', status)}
        gridClass="grid-cols-1 min-[420px]:grid-cols-3"
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField inputId={fieldId('source')} label="Nguồn khách">
          <SelectInput
            id={fieldId('source')}
            icon={Megaphone}
            options={withCurrentOption(LEAD_SOURCE_OPTIONS, values.leadSource)}
            value={values.leadSource}
            onChange={(event) => setField('leadSource', event.target.value)}
          />
        </FormField>

        <BudgetRangeInput
          idPrefix={idPrefix}
          budgetMin={values.budgetMin}
          budgetMax={values.budgetMax}
          onChangeMin={(value) => setField('budgetMin', value)}
          onChangeMax={(value) => setField('budgetMax', value)}
          errorMin={errors.budgetMin}
          errorMax={errors.budgetMax}
        />
      </div>
    </SectionCard>
  );

  const staffSection = (
    <SectionCard icon={Users} title="Phân bổ nhân sự" description="Người chịu trách nhiệm chăm sóc">
      <FormField inputId={fieldId('staff-lead')} label="Nhân viên phụ trách chính" isRequired error={errors.staffLead}>
        <SelectInput
          id={fieldId('staff-lead')}
          icon={UserCheck}
          options={STAFF_OPTIONS}
          value={values.staffLead}
          onChange={(event) => setField('staffLead', event.target.value)}
          hasError={Boolean(errors.staffLead)}
        />
      </FormField>
      <FormField inputId={fieldId('staff-support')} label="Nhân viên hỗ trợ" hint="Tùy chọn — cộng sự chăm sóc chéo.">
        <SelectInput
          id={fieldId('staff-support')}
          icon={UserPlus}
          options={SUPPORT_STAFF_OPTIONS.filter((option) => option.value !== values.staffLead)}
          value={values.staffSupport}
          onChange={(event) => setField('staffSupport', event.target.value)}
        />
      </FormField>
    </SectionCard>
  );

  const banner = (
    <DuplicatePhoneBanner duplicateCustomer={duplicateCustomer} onOpenDuplicate={openDuplicateCustomer} variant={variant} />
  );

  if (!isDesktop) {
    return (
      <div className="space-y-4">
        {banner}
        {basicInfoSection}
        {demandSection}
        {staffSection}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <div className="min-w-0 space-y-6 xl:col-span-8">
        {banner}
        {basicInfoSection}
        {demandSection}
      </div>
      <div className="min-w-0 space-y-6 xl:col-span-4">{staffSection}</div>
    </div>
  );
};
