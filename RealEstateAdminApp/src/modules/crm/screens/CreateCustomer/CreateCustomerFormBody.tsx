/**
 * Thân form "Thêm khách hàng mới" dùng chung 2 biến thể (desktop/tablet + mobile) — C1.
 * Chỉ Họ tên + SĐT bắt buộc; danh mục (khu vực, nguồn, dự án, tình trạng, người dùng) đọc từ store (X7).
 * Bố cục: desktop >= 1280px chia 8/4 cột; hẹp hơn xếp 1 cột.
 */
import { Building2, CircleCheck, IdCard, Lock, Mail, MapPin, Megaphone, Phone, RefreshCw, Target, TriangleAlert, User, UserCheck, UserRound, Users } from 'lucide-react';
import { useAssignableUsers, useCatalogs } from '@crm/api';
import { ChipMultiSelect, ChoiceGroup, type ChoiceOption } from '@crm/components/form/ChoiceGroup';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { MaskedIdInput } from '@crm/components/form/MaskedIdInput';
import { SectionCard } from '@crm/components/form/SectionCard';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { STATUS_TONE_STYLES } from '@crm/components/statusToneStyles';
import { isValidPhone } from '@crm/lib/phone';
import { CHIP_SMALL_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import { DuplicatePhoneBanner } from './components/DuplicatePhoneBanner';
import type { CreateCustomerFormApi } from './useCreateCustomerForm';

const REQUIRED_CHIP = <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Bắt buộc: họ tên, SĐT</span>;

const PhoneStatusChip = ({ isDuplicate, isReady }: { isDuplicate: boolean; isReady: boolean }) => {
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
        Chưa có, tạo được
      </span>
    );
  }
  return (
    <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>
      <RefreshCw size={12} aria-hidden="true" />
      Nhập để kiểm tra trùng…
    </span>
  );
};

interface CreateCustomerFormBodyProps {
  form: CreateCustomerFormApi;
  variant: 'desktop' | 'mobile';
}

export const CreateCustomerFormBody = ({ form, variant }: CreateCustomerFormBodyProps) => {
  const { values, errors, phoneLookup, isPrimaryLocked, setField, toggleProject, toggleMember, requestJoin } = form;
  const { catalogs, users } = useCatalogs();
  const { data: assignableUsers } = useAssignableUsers();
  const isDesktop = variant === 'desktop';
  const isDuplicate = Boolean(phoneLookup?.exists);
  const fieldId = (name: string) => `cc-${variant}-${name}`;

  const statusChoices: ChoiceOption<string>[] = catalogs.statuses
    .filter((status) => status.isActive)
    .sort((a, b) => a.order - b.order)
    .map((status) => ({ value: status.id, label: status.label, dotClass: STATUS_TONE_STYLES[status.tone].dotClass }));
  const primaryOptions = isPrimaryLocked
    ? users.filter((user) => user.id === values.primaryUserId).map((user) => ({ value: user.id, label: user.fullName }))
    : assignableUsers.map((user) => ({ value: user.id, label: `${user.fullName}${user.team ? ` — ${user.team.label}` : ''}` }));

  const basicInfoSection = (
    <SectionCard icon={UserRound} title="Thông tin cơ bản" description="Định danh và liên lạc" aside={REQUIRED_CHIP}>
      <FormField inputId={fieldId('name')} label="Họ và tên khách hàng" isRequired error={errors.fullName}>
        <TextInput
          id={fieldId('name')}
          icon={User}
          autoComplete="off"
          maxLength={150}
          value={values.fullName}
          onChange={(event) => setField('fullName', event.target.value)}
          placeholder="Ví dụ: Nguyễn Văn A"
          hasError={Boolean(errors.fullName)}
          {...getFieldA11yProps(getErrorId(fieldId('name')), errors.fullName)}
        />
      </FormField>

      <FormField
        inputId={fieldId('phone')}
        label="Số điện thoại"
        isRequired
        error={errors.phone}
        hint="Di động 10 số, máy bàn 02x, hoặc số nước ngoài dạng +..."
        labelAddon={<PhoneStatusChip isDuplicate={isDuplicate} isReady={!isDuplicate && isValidPhone(values.phone)} />}
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
          hasError={Boolean(errors.phone) || isDuplicate}
          className="font-mono"
          {...getFieldA11yProps(getErrorId(fieldId('phone')), errors.phone)}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField inputId={fieldId('email')} label="Email" error={errors.email}>
          <TextInput
            id={fieldId('email')}
            type="email"
            icon={Mail}
            value={values.email}
            onChange={(event) => setField('email', event.target.value)}
            placeholder="Không bắt buộc"
            hasError={Boolean(errors.email)}
            {...getFieldA11yProps(getErrorId(fieldId('email')), errors.email)}
          />
        </FormField>
        <FormField
          inputId={fieldId('national-id')}
          label="Số CCCD"
          error={errors.nationalId}
          labelAddon={
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              <Lock size={12} aria-hidden="true" />
              Chỉ lưu hiển thị 4 số cuối
            </span>
          }
        >
          <MaskedIdInput
            id={fieldId('national-id')}
            icon={IdCard}
            value={values.nationalId}
            onValueChange={(value) => setField('nationalId', value)}
            placeholder="12 số (không bắt buộc)"
            hasError={Boolean(errors.nationalId)}
            {...getFieldA11yProps(getErrorId(fieldId('national-id')), errors.nationalId)}
          />
        </FormField>
      </div>

      <FormField inputId={fieldId('area')} label="Khu vực (nơi khách đang ở)">
        <SelectInput
          id={fieldId('area')}
          icon={MapPin}
          emptyLabel="Chọn khu vực"
          options={catalogs.areas.filter((area) => area.isActive).map((area) => ({ value: area.id, label: area.name }))}
          value={values.areaId}
          onChange={(event) => setField('areaId', event.target.value)}
        />
      </FormField>
    </SectionCard>
  );

  const demandSection = (
    <SectionCard icon={Target} title="Dự án & Tình trạng" description="Phân loại ban đầu">
      <ChipMultiSelect
        legend="Dự án quan tâm (chọn được nhiều)"
        icon={Building2}
        options={catalogs.projects.filter((project) => project.isActive).map((project) => ({ value: project.id, label: project.name }))}
        selected={values.interestedProjectIds}
        onToggle={toggleProject}
      />
      <ChoiceGroup legend="Tình trạng" options={statusChoices} value={values.statusId} onChange={(statusId) => setField('statusId', statusId)} gridClass="grid-cols-2 sm:grid-cols-4" />
      <FormField inputId={fieldId('source')} label="Nguồn khách">
        <SelectInput
          id={fieldId('source')}
          icon={Megaphone}
          emptyLabel="Chọn nguồn khách"
          options={catalogs.leadSources.filter((source) => source.isActive).map((source) => ({ value: source.id, label: source.label }))}
          value={values.sourceId}
          onChange={(event) => setField('sourceId', event.target.value)}
        />
      </FormField>
    </SectionCard>
  );

  const staffSection = (
    <SectionCard icon={Users} title="Nhóm chăm sóc" description="Người phụ trách chính và người cùng chăm sóc">
      <FormField
        inputId={fieldId('primary')}
        label="Người phụ trách chính"
        error={errors.primaryUserId}
        hint={isPrimaryLocked ? 'Nhân viên tạo khách thì tự là người phụ trách chính.' : 'Để "Chưa phân" nếu chưa giao cho ai.'}
      >
        <SelectInput
          id={fieldId('primary')}
          icon={UserCheck}
          disabled={isPrimaryLocked}
          emptyLabel={isPrimaryLocked ? undefined : 'Chưa phân'}
          options={primaryOptions}
          value={values.primaryUserId}
          onChange={(event) => setField('primaryUserId', event.target.value)}
          hasError={Boolean(errors.primaryUserId)}
        />
      </FormField>
      <ChipMultiSelect
        legend="Người cùng chăm sóc (tuỳ chọn)"
        options={assignableUsers.filter((user) => user.id !== values.primaryUserId).map((user) => ({ value: user.id, label: user.displayName }))}
        selected={values.memberIds}
        onToggle={toggleMember}
      />
    </SectionCard>
  );

  const banner = <DuplicatePhoneBanner lookup={phoneLookup} onRequestJoin={requestJoin} variant={variant} />;

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
