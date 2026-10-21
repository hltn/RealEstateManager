/**
 * Thân form "Cập nhật Chân dung khách hàng" (C10/C11) dùng chung desktop/tablet + mobile.
 * Desktop >= 1280px: 7/5 cột như nguồn Admin; hẹp hơn xếp 1 cột, trường đôi co về 2 cột từ `sm`.
 */
import {
  Briefcase,
  Building,
  Cake,
  Clock,
  Crown,
  Heart,
  IdCard,
  Lock,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  StickyNote,
  User,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react';
import { toHashtag } from '@crm/lib/customerAdapters';
import type { ContactMethod, DecisionMaker } from '@crm/types/crm';
import { DatePicker } from '../../../../components/ui/DatePicker';
import { withCurrentOption } from '../CreateCustomer/customerFormRules';
import { ChoiceGroup, type ChoiceOption } from '@crm/components/form/ChoiceGroup';
import { DuplicatePhoneBanner } from '../CreateCustomer/components/DuplicatePhoneBanner';
import { FieldError, getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { CARD_CLASS, CHECKBOX_CLASS, FORM_LABEL_CLASS, TEXTAREA_CLASS, VIP_CHIP_CLASS } from '@crm/lib/uiClasses';
import { MaskedIdInput } from '@crm/components/form/MaskedIdInput';
import { SectionCard } from '@crm/components/form/SectionCard';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TagInput } from '@crm/components/form/TagInput';
import { TextInput } from '@crm/components/form/TextInput';
import { birthDateToIso, isoToBirthDate, LIFESTYLE_TAG_SUGGESTIONS, MARITAL_STATUS_OPTIONS } from './personaForm';
import type { PersonaFormApi } from './usePersonaForm';

const DECISION_MAKER_CHOICES: ChoiceOption<DecisionMaker>[] = [
  { value: 'Vợ chồng cùng duyệt', label: 'Vợ chồng cùng duyệt', description: 'Quyết định đồng thuận', icon: Users },
  { value: 'Khách tự quyết', label: 'Khách tự quyết', description: 'Chủ động dòng tiền', icon: User },
  { value: 'Tham khảo gia đình', label: 'Tham khảo gia đình', description: 'Bố mẹ / cố vấn', icon: UsersRound },
];

const CONTACT_METHOD_CHOICES: ChoiceOption<ContactMethod>[] = [
  { value: 'Zalo', label: 'Zalo' },
  { value: 'Điện thoại', label: 'Điện thoại' },
  { value: 'Gặp mặt', label: 'Gặp mặt' },
];

const NOTES_MAX_LENGTH = 1000;

interface PersonaFormBodyProps {
  form: PersonaFormApi;
  variant: 'desktop' | 'mobile';
}

export const PersonaFormBody = ({ form, variant }: PersonaFormBodyProps) => {
  const { values, errors, setField, addTag, removeTag, duplicateCustomer, openDuplicateCustomer } = form;
  const fieldId = (name: string) => `persona-${variant}-${name}`;
  const birthLabelId = fieldId('birth-label');

  const personalSection = (
    <SectionCard
      icon={UserRound}
      title="Thông tin cá nhân & Gia cảnh"
      description="Định danh, liên lạc và cấu trúc hộ gia đình"
    >
      {duplicateCustomer && (
        <DuplicatePhoneBanner duplicateCustomer={duplicateCustomer} onOpenDuplicate={openDuplicateCustomer} variant={variant} />
      )}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField inputId={fieldId('name')} label="Họ và tên" isRequired error={errors.name}>
          <TextInput
            id={fieldId('name')}
            icon={User}
            value={values.name}
            onChange={(event) => setField('name', event.target.value)}
            hasError={Boolean(errors.name)}
            {...getFieldA11yProps(getErrorId(fieldId('name')), errors.name)}
          />
        </FormField>
        <FormField inputId={fieldId('phone')} label="Số điện thoại" isRequired error={errors.phone}>
          <TextInput
            id={fieldId('phone')}
            type="tel"
            inputMode="tel"
            icon={Phone}
            value={values.phone}
            onChange={(event) => setField('phone', event.target.value)}
            hasError={Boolean(errors.phone) || Boolean(duplicateCustomer)}
            className="font-mono"
            {...getFieldA11yProps(getErrorId(fieldId('phone')), errors.phone)}
          />
        </FormField>
        <FormField inputId={fieldId('email')} label="Email" error={errors.email}>
          <TextInput
            id={fieldId('email')}
            type="email"
            icon={Mail}
            value={values.email}
            onChange={(event) => setField('email', event.target.value)}
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
            hasError={Boolean(errors.idNumber)}
            {...getFieldA11yProps(getErrorId(fieldId('id-number')), errors.idNumber)}
          />
        </FormField>
      </div>

      {/* Ngày sinh + nhắc sinh nhật: DatePicker (flatpickr) của Admin, lưu dạng dd/mm/yyyy */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/[0.05] dark:bg-white/[0.02]">
        <span id={birthLabelId} className={FORM_LABEL_CLASS}>
          Ngày sinh<span className="ml-0.5 text-error-500">*</span>
        </span>
        <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-2">
          <div role="group" aria-labelledby={birthLabelId}>
            <DatePicker
              value={birthDateToIso(values.birthDate)}
              onChange={(isoDate) => setField('birthDate', isoToBirthDate(isoDate))}
              placeholder="Chọn ngày sinh"
              inputClassName={`h-11 py-2.5 ${errors.birthDate ? 'border-error-500 dark:border-error-500' : ''}`}
            />
          </div>
          <label className="flex cursor-pointer select-none items-start gap-2.5">
            <input
              type="checkbox"
              checked={values.remindBirthday}
              onChange={(event) => setField('remindBirthday', event.target.checked)}
              className={`${CHECKBOX_CLASS} mt-0.5`}
            />
            <span className="text-theme-sm text-gray-700 dark:text-gray-300">
              <Cake size={14} aria-hidden="true" className="mr-1 inline text-brand-500 dark:text-brand-400" />
              Nhắc trước sinh nhật 3 ngày (tự tạo việc)
            </span>
          </label>
        </div>
        <FieldError id={getErrorId(fieldId('birth'))} message={errors.birthDate} />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField inputId={fieldId('hometown')} label="Quê quán">
          <TextInput
            id={fieldId('hometown')}
            icon={MapPin}
            value={values.hometown}
            onChange={(event) => setField('hometown', event.target.value)}
          />
        </FormField>
        <FormField inputId={fieldId('marital')} label="Tình trạng hôn nhân">
          <SelectInput
            id={fieldId('marital')}
            icon={Heart}
            options={withCurrentOption(MARITAL_STATUS_OPTIONS, values.maritalStatus)}
            value={values.maritalStatus}
            emptyLabel="— Chưa chọn —"
            onChange={(event) => setField('maritalStatus', event.target.value)}
          />
        </FormField>
      </div>
      <FormField inputId={fieldId('children')} label="Số người con / Gia cảnh">
        <TextInput
          id={fieldId('children')}
          icon={Users}
          value={values.children}
          onChange={(event) => setField('children', event.target.value)}
          placeholder="Ví dụ: 2 con (1 trai học lớp 5, 1 gái mầm non)"
        />
      </FormField>
    </SectionCard>
  );

  const careerSection = (
    <SectionCard icon={Briefcase} title="Nghề nghiệp & Vị thế" description="Môi trường làm việc và cơ chế ra quyết định tài chính">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField inputId={fieldId('occupation')} label="Nghề nghiệp / Chức vụ" isRequired error={errors.occupation}>
          <TextInput
            id={fieldId('occupation')}
            icon={Briefcase}
            value={values.occupation}
            onChange={(event) => setField('occupation', event.target.value)}
            hasError={Boolean(errors.occupation)}
            {...getFieldA11yProps(getErrorId(fieldId('occupation')), errors.occupation)}
          />
        </FormField>
        <FormField inputId={fieldId('business')} label="Lĩnh vực kinh doanh">
          <TextInput
            id={fieldId('business')}
            icon={Building}
            value={values.businessField}
            onChange={(event) => setField('businessField', event.target.value)}
          />
        </FormField>
      </div>
      <ChoiceGroup
        legend="Người ra quyết định chính"
        appearance="card"
        options={DECISION_MAKER_CHOICES}
        value={values.decisionMaker}
        onChange={(value) => setField('decisionMaker', value)}
        gridClass="grid-cols-1 sm:grid-cols-3"
      />
    </SectionCard>
  );

  const lifestyleSection = (
    <SectionCard
      icon={Sparkles}
      title="Sở thích & Phong cách sống"
      description="Định vị gu sống để gợi ý sản phẩm phù hợp"
      aside={
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {values.lifestyleTags.length} đã chọn
        </span>
      }
    >
      <TagInput
        inputId={fieldId('tag')}
        label="Tags đang áp dụng"
        tags={values.lifestyleTags}
        onAdd={addTag}
        onRemove={removeTag}
        formatTag={toHashtag}
        placeholder="Nhập sở thích mới, nhấn Enter…"
        suggestions={LIFESTYLE_TAG_SUGGESTIONS}
        suggestionLabel="Gợi ý phổ biến:"
        emptyText="Chưa có sở thích nào."
      />
    </SectionCard>
  );

  const vipCard = (
    <div className={`${CARD_CLASS} flex items-start justify-between gap-4 p-4 sm:p-5 xl:p-6`}>
      <div className="flex min-w-0 items-start gap-3">
        <input
          id={fieldId('vip')}
          type="checkbox"
          checked={values.isVip}
          onChange={(event) => setField('isVip', event.target.checked)}
          className={`${CHECKBOX_CLASS} mt-1`}
        />
        <div className="min-w-0">
          <label htmlFor={fieldId('vip')} className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white/90">
            Khách hàng VIP
            <span className={VIP_CHIP_CLASS}>
              <Crown size={12} aria-hidden="true" />
              VIP
            </span>
          </label>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            Hiển thị huy hiệu VIP và kích hoạt chính sách chăm sóc ưu tiên.
          </p>
        </div>
      </div>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500">
        <Crown size={20} aria-hidden="true" />
      </span>
    </div>
  );

  const contactSection = (
    <SectionCard icon={Clock} title="Kênh & Khung giờ ưu tiên" description="Tối ưu tỷ lệ tiếp cận và chuyển đổi">
      <ChoiceGroup
        legend="Kênh liên hệ ưu tiên"
        isRequired
        options={CONTACT_METHOD_CHOICES}
        value={values.preferredContactMethod}
        onChange={(value) => setField('preferredContactMethod', value)}
        gridClass="grid-cols-3"
      />
      <FormField inputId={fieldId('free-time')} label="Khung giờ rảnh thuận tiện">
        <TextInput
          id={fieldId('free-time')}
          icon={Clock}
          value={values.freeTimeSlot}
          onChange={(event) => setField('freeTimeSlot', event.target.value)}
          placeholder="Ví dụ: 19:00 - 20:30"
        />
      </FormField>
      <FormField
        inputId={fieldId('salutation')}
        label="Cách xưng hô ưa thích"
        hint="Dùng khi gửi SMS / tin nhắn Zalo tự động."
      >
        <TextInput
          id={fieldId('salutation')}
          icon={UserRound}
          value={values.preferredSalutation}
          onChange={(event) => setField('preferredSalutation', event.target.value)}
          placeholder="Ví dụ: Anh An"
        />
      </FormField>
    </SectionCard>
  );

  const notesSection = (
    <SectionCard icon={StickyNote} title="Ghi chú bổ sung" description="Lưu ý tinh tế của chuyên viên kinh doanh">
      <div>
        <label htmlFor={fieldId('notes')} className="sr-only">
          Ghi chú bổ sung
        </label>
        <textarea
          id={fieldId('notes')}
          rows={4}
          maxLength={NOTES_MAX_LENGTH}
          value={values.notes}
          onChange={(event) => setField('notes', event.target.value)}
          className={TEXTAREA_CLASS}
        />
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1">
            <Lock size={12} aria-hidden="true" />
            Chỉ hiển thị nội bộ kinh doanh
          </span>
          <span>
            {values.notes.length}/{NOTES_MAX_LENGTH}
          </span>
        </div>
      </div>
    </SectionCard>
  );

  if (variant === 'mobile') {
    return (
      <div className="space-y-4">
        {personalSection}
        {careerSection}
        {lifestyleSection}
        {vipCard}
        {contactSection}
        {notesSection}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
      <div className="min-w-0 space-y-6 xl:col-span-7">
        {personalSection}
        {careerSection}
      </div>
      <div className="min-w-0 space-y-6 xl:col-span-5">
        {lifestyleSection}
        {vipCard}
        {contactSection}
        {notesSection}
      </div>
    </div>
  );
};
