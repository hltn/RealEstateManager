/**
 * Thân form sửa hồ sơ + chân dung, dùng chung desktop/tablet + mobile và 2 màn:
 * "Chân dung khách hàng" (có phần thông tin cơ bản + thẻ) và "Nhu cầu BĐS" (chỉ nhóm Nhu cầu BĐS).
 * Chỉ họ tên bắt buộc (SĐT tùy chọn, bỏ trống = xóa SĐT). Mọi trường chân dung không bắt buộc; ghi kèm nguồn thông tin (khách tự chia sẻ / nhân viên quan sát) — QT9.
 */
import { useState } from 'react';
import { Briefcase, Building2, Hash, IdCard, Mail, MapPin, Megaphone, Phone, Plus, Sparkles, StickyNote, User, UserRound } from 'lucide-react';
import { useCatalogs } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { PERSONA_GROUP_LABELS } from '@crm/data/personaFields';
import { ChipMultiSelect, ChoiceGroup } from '@crm/components/form/ChoiceGroup';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { MaskedIdInput } from '@crm/components/form/MaskedIdInput';
import { SectionCard } from '@crm/components/form/SectionCard';
import { getAreaSearchTerms } from '@crm/lib/areaMatch';
import { SearchableMultiSelect } from '@crm/components/form/SearchableMultiSelect';
import { SearchableSelect } from '@crm/components/form/SearchableSelect';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { TAG_CATEGORY_ORDER, TAG_GROUP_TITLES, isTagInCategory } from '@crm/lib/tagCategories';
import { BUTTON_SOFT_SM_CLASS, FORM_HINT_CLASS, MODAL_INPUT_CLASS } from '@crm/lib/uiClasses';
import type { PersonaGroupCode, TagCategory } from '@crm/types/crm';
import { PersonaFieldInput } from './components/PersonaFieldInput';
import type { PersonaFormApi } from './usePersonaForm';

const GROUP_ICONS: Record<PersonaGroupCode, typeof User> = {
  PERSONAL: UserRound,
  OCCUPATION: Briefcase,
  LIFESTYLE: Sparkles,
  OCCASION: Sparkles,
  FAMILY: UserRound,
  CONTACT: Phone,
  REAL_ESTATE: Building2,
};

/** Đủ 3 nhóm (kể cả "Khác", FR-48): mỗi nhóm có ô "Gắn nhanh thẻ mới" tạo thẻ đúng nhóm đó. */
const TAG_GROUPS: { category: TagCategory; label: string }[] = TAG_CATEGORY_ORDER.map((category) => ({ category, label: TAG_GROUP_TITLES[category] }));

/** Nhóm thẻ: chọn thẻ có sẵn + gắn nhanh thẻ mới (C11). */
const TagPicker = ({ form, category, label }: { form: PersonaFormApi; category: TagCategory; label: string }) => {
  const { catalogs } = useCatalogs();
  const [draftName, setDraftName] = useState('');
  const tags = catalogs.tags.filter((tag) => tag.isActive && isTagInCategory(tag, category));
  const add = () => {
    if (!draftName.trim()) return;
    form.addNewTag(draftName, category);
    setDraftName('');
  };
  return (
    <div className="space-y-2">
      <ChipMultiSelect legend={label} icon={Hash} options={tags.map((tag) => ({ value: tag.id, label: tag.name }))} selected={form.basic.tagIds} onToggle={form.toggleTag} />
      <div className="flex gap-2">
        <input
          type="text"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          aria-label={`Thêm ${label.toLowerCase()} mới`}
          placeholder="Gắn nhanh thẻ mới…"
          className={MODAL_INPUT_CLASS}
        />
        <button type="button" onClick={add} className={BUTTON_SOFT_SM_CLASS}>
          <Plus size={14} aria-hidden="true" />
          Thêm
        </button>
      </div>
    </div>
  );
};

interface PersonaFormBodyProps {
  form: PersonaFormApi;
  variant: 'desktop' | 'mobile';
  hasBasicInfo: boolean;
}

export const PersonaFormBody = ({ form, variant, hasBasicInfo }: PersonaFormBodyProps) => {
  const { catalogs } = useCatalogs();
  const { basic, basicErrors, fields, personaErrors } = form;
  const [isConfirmingDeleteId, setIsConfirmingDeleteId] = useState(false);
  const idPrefix = `persona-${variant}`;
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const groupCodes = [...new Set(fields.map((field) => field.groupCode))];

  // Khách chưa có SĐT: ô mở sẵn (thêm số, không có "Sửa số"); đã mở khóa: bỏ trống ô = xóa SĐT của khách.
  const phoneHint = form.isPhoneLocked ? undefined : form.hasPhone ? 'Để trống ô này nếu muốn xóa số điện thoại của khách.' : 'Khách chưa có số điện thoại. Không bắt buộc.';
  const basicSection = hasBasicInfo && (
    <SectionCard icon={IdCard} title="Thông tin cơ bản" description="Chỉ họ tên là bắt buộc">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField inputId={fieldId('name')} label="Họ và tên" isRequired error={basicErrors.fullName}>
          <TextInput id={fieldId('name')} icon={User} maxLength={150} value={basic.fullName} onChange={(event) => form.setBasicField('fullName', event.target.value)} hasError={Boolean(basicErrors.fullName)} {...getFieldA11yProps(getErrorId(fieldId('name')), basicErrors.fullName)} />
        </FormField>
        <FormField inputId={fieldId('phone')} label="Số điện thoại" error={basicErrors.phone} hint={phoneHint}>
          {form.isPhoneLocked ? (
            <div className="flex items-center gap-2">
              <TextInput id={fieldId('phone')} type="tel" icon={Phone} value={form.phoneMasked} readOnly className="font-mono" wrapperClassName="flex-1" />
              <button type="button" onClick={form.revealPhone} title="Lần xem số đầy đủ sẽ được ghi lại" className={`${BUTTON_SOFT_SM_CLASS} shrink-0`}>
                Sửa số
              </button>
            </div>
          ) : (
            <TextInput id={fieldId('phone')} type="tel" icon={Phone} value={basic.phone} onChange={(event) => form.setBasicField('phone', event.target.value)} hasError={Boolean(basicErrors.phone)} className="font-mono" {...getFieldA11yProps(getErrorId(fieldId('phone')), basicErrors.phone)} />
          )}
        </FormField>
        <FormField inputId={fieldId('email')} label="Email" error={basicErrors.email}>
          <TextInput id={fieldId('email')} type="email" icon={Mail} value={basic.email} onChange={(event) => form.setBasicField('email', event.target.value)} hasError={Boolean(basicErrors.email)} />
        </FormField>
        <FormField
          inputId={fieldId('national-id')}
          label="CCCD mới (bỏ trống = giữ nguyên)"
          error={basicErrors.nationalId}
          labelAddon={
            form.hasNationalId ? (
              <button type="button" onClick={() => setIsConfirmingDeleteId(true)} className="text-theme-xs font-medium text-error-600 hover:underline dark:text-error-400">
                Xoá CCCD đã lưu
              </button>
            ) : undefined
          }
        >
          <MaskedIdInput id={fieldId('national-id')} icon={IdCard} value={basic.nationalId} onValueChange={(value) => form.setBasicField('nationalId', value)} placeholder="12 số" hasError={Boolean(basicErrors.nationalId)} />
        </FormField>
        <ConfirmDialog
          isOpen={isConfirmingDeleteId}
          tone="danger"
          title="Xoá CCCD đã lưu?"
          description="CCCD đầy đủ sẽ bị xoá khỏi hồ sơ khách và được ghi vào lịch sử thay đổi. Thao tác này không hoàn tác được."
          confirmLabel="Xoá CCCD"
          onCancel={() => setIsConfirmingDeleteId(false)}
          onConfirm={() => {
            setIsConfirmingDeleteId(false);
            form.deleteNationalId();
          }}
        />
        <FormField inputId={fieldId('area')} label="Khu vực (nơi khách đang ở)">
          <SearchableSelect id={fieldId('area')} icon={MapPin} emptyLabel="Chưa rõ" listLabel="Danh sách khu vực" getSearchTerms={getAreaSearchTerms} options={catalogs.areas.filter((area) => area.isActive || area.id === basic.areaId).map((area) => ({ value: area.id, label: area.name }))} value={basic.areaId} onChange={(areaId) => form.setBasicField('areaId', areaId)} />
        </FormField>
        <FormField inputId={fieldId('source')} label="Nguồn khách">
          <SelectInput id={fieldId('source')} icon={Megaphone} emptyLabel="Chưa rõ" options={catalogs.leadSources.filter((source) => source.isActive || source.id === basic.sourceId).map((source) => ({ value: source.id, label: source.label }))} value={basic.sourceId} onChange={(event) => form.setBasicField('sourceId', event.target.value)} />
        </FormField>
      </div>
      <SearchableMultiSelect
        id={fieldId('projects')}
        legend="Dự án quan tâm (chọn được nhiều)"
        icon={Building2}
        listLabel="Danh sách dự án"
        placeholder="Gõ để tìm dự án…"
        options={catalogs.projects.filter((project) => project.isActive || basic.interestedProjectIds.includes(project.id)).map((project) => ({ value: project.id, label: project.name }))}
        selected={basic.interestedProjectIds}
        onToggle={form.toggleProject}
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {TAG_GROUPS.map((group) => (
          <TagPicker key={group.category} form={form} category={group.category} label={group.label} />
        ))}
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-6">
      {basicSection}

      {groupCodes.map((code) => (
        <SectionCard key={code} icon={GROUP_ICONS[code]} title={PERSONA_GROUP_LABELS[code]} description="Không bắt buộc — điền dần qua các lần chăm sóc">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {fields
              .filter((field) => field.groupCode === code)
              .map((field) => (
                <div key={field.key} className={field.type === 'MULTI_SELECT' || field.type === 'NUMBER_RANGE' || field.type === 'TEXTAREA' ? 'sm:col-span-2' : ''}>
                  <PersonaFieldInput field={field} value={form.getValue(field.key)} idPrefix={idPrefix} error={personaErrors[field.key]} onChange={(value) => form.setValue(field.key, value)} />
                </div>
              ))}
          </div>
        </SectionCard>
      ))}

      <SectionCard icon={StickyNote} title="Nguồn thông tin">
        <ChoiceGroup
          legend="Thông tin chân dung vừa sửa do"
          options={[
            { value: 'CUSTOMER_SHARED', label: 'Khách tự chia sẻ' },
            { value: 'STAFF_OBSERVED', label: 'Nhân viên quan sát' },
          ]}
          value={form.source}
          onChange={(value) => form.setSource(value as 'CUSTOMER_SHARED' | 'STAFF_OBSERVED')}
          gridClass="grid-cols-1 sm:grid-cols-2"
        />
        <p className={FORM_HINT_CLASS}>Không ghi nội dung nhạy cảm (tôn giáo, chính trị, sức khoẻ, đời sống riêng tư) trừ khi khách tự chia sẻ và thật cần cho việc chăm sóc.</p>
      </SectionCard>
    </div>
  );
};
