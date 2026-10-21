/**
 * Thân form "Cập nhật Thông tin đầu tư" dùng chung desktop/tablet + mobile.
 * Desktop >= 1280px: 2 cột bằng nhau như nguồn Admin; hẹp hơn xếp 1 cột.
 */
import {
  Building2,
  CalendarDays,
  Flag,
  House,
  Landmark,
  MapPin,
  MapPinned,
  Megaphone,
  Search,
  Wallet,
} from 'lucide-react';
import { LEAD_SOURCE_OPTIONS } from '../CreateCustomer/createCustomerForm';
import { withCurrentOption } from '../CreateCustomer/customerFormRules';
import { BudgetRangeInput } from '@crm/components/form/BudgetRangeInput';
import { ChoiceGroup, type ChoiceOption } from '@crm/components/form/ChoiceGroup';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { CHECKBOX_CLASS } from '@crm/lib/uiClasses';
import { SectionCard } from '@crm/components/form/SectionCard';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TagInput } from '@crm/components/form/TagInput';
import { TextInput } from '@crm/components/form/TextInput';
import {
  BEDROOM_OPTIONS,
  EQUITY_RATIO_OPTIONS,
  PRIORITY_SUGGESTIONS,
  PROJECT_OPTIONS,
  PROJECT_QUICK_SUGGESTIONS,
  PROPERTY_TYPE_OPTIONS,
  PURPOSE_SUGGESTIONS,
  SEARCH_AREA_OPTIONS,
  TARGET_TIME_OPTIONS,
  withCurrentChoice,
} from './investmentForm';
import type { InvestmentFormApi } from './useInvestmentForm';

const toChoices = (options: readonly string[]): ChoiceOption<string>[] => options.map((value) => ({ value, label: value }));

interface InvestmentFormBodyProps {
  form: InvestmentFormApi;
  variant: 'desktop' | 'mobile';
}

export const InvestmentFormBody = ({ form, variant }: InvestmentFormBodyProps) => {
  const { values, errors, setField, addItem, removeItem } = form;
  const fieldId = (name: string) => `investment-${variant}-${name}`;
  const equityChoices: ChoiceOption<string>[] = [
    ...EQUITY_RATIO_OPTIONS.map(({ value, description }) => ({ value, label: value, description })),
    ...(values.equityRatio && !EQUITY_RATIO_OPTIONS.some((option) => option.value === values.equityRatio)
      ? [{ value: values.equityRatio, label: values.equityRatio }]
      : []),
  ];

  const projectSection = (
    <SectionCard
      icon={Building2}
      title="Dự án quan tâm"
      description="Các dự án và phân khu khách đang theo dõi"
      aside={
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {values.interestedProjects.length} dự án
        </span>
      }
    >
      <TagInput
        inputId={fieldId('project')}
        label="Dự án ưu tiên hiện tại"
        isRequired
        tags={values.interestedProjects}
        onAdd={(value) => addItem('interestedProjects', value)}
        onRemove={(value) => removeItem('interestedProjects', value)}
        tagIcon={Building2}
        inputIcon={Search}
        placeholder="Tìm và thêm dự án (Masteri, Lumiere…)"
        autocompleteOptions={PROJECT_OPTIONS}
        suggestions={PROJECT_QUICK_SUGGESTIONS}
        suggestionLabel="Gợi ý nhanh:"
        emptyText="Chưa chọn dự án nào."
        error={<FieldError id={`${fieldId('project')}-error`} message={errors.interestedProjects} />}
      />
    </SectionCard>
  );

  const financeSection = (
    <SectionCard icon={Wallet} title="Tài chính & Nguồn vốn" description="Khung ngân sách và cơ cấu vay ngân hàng">
      <BudgetRangeInput
        idPrefix={fieldId('finance')}
        isRequired
        budgetMin={values.budgetMin}
        budgetMax={values.budgetMax}
        onChangeMin={(value) => setField('budgetMin', value)}
        onChangeMax={(value) => setField('budgetMax', value)}
        errorMin={errors.budgetMin}
        errorMax={errors.budgetMax}
        hint="Khung tài chính phổ biến của phân khúc căn hộ cao cấp."
      />
      <ChoiceGroup
        legend="Tỷ lệ vốn tự có"
        appearance="card"
        options={equityChoices}
        value={values.equityRatio}
        onChange={(value) => setField('equityRatio', value)}
        gridClass="grid-cols-1 min-[420px]:grid-cols-2"
      />
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 p-4 dark:border-brand-500/25 dark:bg-brand-500/15">
        <input
          type="checkbox"
          checked={values.loanIncentive}
          onChange={(event) => setField('loanIncentive', event.target.checked)}
          className={`${CHECKBOX_CLASS} mt-0.5`}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-400">
            <Landmark size={16} aria-hidden="true" />
            Cần gói hỗ trợ lãi suất / ân hạn nợ gốc
          </span>
          <span className="mt-0.5 block text-theme-sm text-gray-600 dark:text-gray-300">
            Ưu tiên ngân hàng liên kết dự án (Vietcombank, MB, Techcombank).
          </span>
        </span>
      </label>
    </SectionCard>
  );

  const demandSection = (
    <SectionCard icon={House} title="Nhu cầu & Tiêu chí BĐS" description="Mục đích sử dụng, công năng và tiêu chí ưu tiên">
      <ChoiceGroup
        legend="Loại hình bất động sản"
        options={toChoices(withCurrentChoice(PROPERTY_TYPE_OPTIONS, values.propertyType))}
        value={values.propertyType}
        onChange={(value) => setField('propertyType', value)}
        gridClass="grid-cols-2"
      />
      <ChoiceGroup
        legend="Số phòng ngủ / Diện tích"
        options={toChoices(withCurrentChoice(BEDROOM_OPTIONS, values.bedroomType))}
        value={values.bedroomType}
        onChange={(value) => setField('bedroomType', value)}
        gridClass="grid-cols-2 sm:grid-cols-3"
      />
      <div className="border-t border-gray-100 pt-5 dark:border-white/[0.05]">
        <TagInput
          inputId={fieldId('purpose')}
          label="Mục đích mua"
          tags={values.purchasePurposes}
          onAdd={(value) => addItem('purchasePurposes', value)}
          onRemove={(value) => removeItem('purchasePurposes', value)}
          placeholder="Nhập mục đích mua, nhấn Enter…"
          suggestions={PURPOSE_SUGGESTIONS}
          emptyText="Chưa có mục đích nào."
        />
      </div>
      <div className="border-t border-gray-100 pt-5 dark:border-white/[0.05]">
        <TagInput
          inputId={fieldId('priority')}
          label="Tiêu chí ưu tiên"
          tags={values.criteriaPriorities}
          onAdd={(value) => addItem('criteriaPriorities', value)}
          onRemove={(value) => removeItem('criteriaPriorities', value)}
          placeholder="Nhập tiêu chí ưu tiên, nhấn Enter…"
          suggestions={PRIORITY_SUGGESTIONS}
          emptyText="Chưa có tiêu chí nào."
        />
      </div>
    </SectionCard>
  );

  const areaSection = (
    <SectionCard icon={MapPinned} title="Khu vực & Địa bàn tìm kiếm" description="Phạm vi địa lý thuận tiện di chuyển">
      <FormField inputId={fieldId('area')} label="Khu vực tìm kiếm / Nơi ở hiện tại">
        <SelectInput
          id={fieldId('area')}
          icon={MapPin}
          options={withCurrentOption(SEARCH_AREA_OPTIONS, values.searchArea)}
          value={values.searchArea}
          emptyLabel="— Chưa chọn —"
          onChange={(event) => setField('searchArea', event.target.value)}
        />
      </FormField>
      <FormField inputId={fieldId('location')} label="Bán kính / Vị trí cụ thể">
        <TextInput
          id={fieldId('location')}
          icon={MapPinned}
          value={values.specificLocation}
          onChange={(event) => setField('specificLocation', event.target.value)}
          placeholder="Ví dụ: Phú Mỹ Hưng, ven sông Nam Sài Gòn"
        />
      </FormField>
    </SectionCard>
  );

  const planSection = (
    <SectionCard icon={Flag} title="Nguồn khách & Kế hoạch" description="Kênh tiếp cận và thời điểm dự kiến chốt">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-1">
        <FormField inputId={fieldId('source')} label="Nguồn khách">
          <SelectInput
            id={fieldId('source')}
            icon={Megaphone}
            options={withCurrentOption(LEAD_SOURCE_OPTIONS, values.leadSource)}
            value={values.leadSource}
            emptyLabel="— Chưa chọn —"
            onChange={(event) => setField('leadSource', event.target.value)}
          />
        </FormField>
        <FormField inputId={fieldId('target-time')} label="Thời điểm dự kiến mua / chốt deal">
          <SelectInput
            id={fieldId('target-time')}
            icon={CalendarDays}
            options={withCurrentOption(TARGET_TIME_OPTIONS, values.targetPurchaseTime)}
            value={values.targetPurchaseTime}
            emptyLabel="— Chưa chọn —"
            onChange={(event) => setField('targetPurchaseTime', event.target.value)}
          />
        </FormField>
      </div>
    </SectionCard>
  );

  if (variant === 'mobile') {
    return (
      <div className="space-y-4">
        {projectSection}
        {financeSection}
        {demandSection}
        {areaSection}
        {planSection}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-6">
        {projectSection}
        {financeSection}
      </div>
      <div className="min-w-0 space-y-6">
        {demandSection}
        {areaSection}
        {planSection}
      </div>
    </div>
  );
};
