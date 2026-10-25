// Khối "Chân dung khách hàng" (C10, C12, C13) + "Nhu cầu BĐS": đọc `GET /crm/customers/:id/persona`.
// Mỗi giá trị hiện nguồn + người/ngày cập nhật khi rê chuột (QT9). Độ đầy đủ + 3–5 thông tin nên hỏi tiếp (C12).
import { Building2, CircleUserRound, MessageCircleQuestion, Pencil } from 'lucide-react';
import { useCustomerPersona, usePersonaFieldMap, type CustomerDetail, type PersonaFieldValueView } from '@crm/api';
import { describePersonaValue } from '@crm/lib/changeTracking';
import { CRITERION_LABELS } from '@crm/lib/customerRules';
import { formatVnDate } from '@crm/lib/dateTime';
import { BUTTON_SOFT_SM_CLASS, CAPTION_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INFO_LABEL_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { PersonaSource } from '@crm/types/crm';
import { CardHeading, ProgressBar } from './DetailParts';

const SOURCE_LABELS: Record<PersonaSource, string> = {
  CUSTOMER_SHARED: 'Khách tự chia sẻ',
  STAFF_OBSERVED: 'Nhân viên quan sát',
  IMPORTED: 'Nhập từ dữ liệu cũ',
};

/** 1 dòng giá trị chân dung; tooltip = nguồn · người · ngày cập nhật. */
const PersonaValueRow = ({ field }: { field: PersonaFieldValueView }) => {
  const linkedCriterion = usePersonaFieldMap().get(field.fieldKey)?.linkedCriterion;
  const metaText = field.value
    ? `${field.source ? SOURCE_LABELS[field.source] : ''} · ${field.updatedBy?.displayName ?? ''} · ${formatVnDate(field.updatedAt)}`
    : '';
  return (
    <div className="flex items-start justify-between gap-3 py-1.5" title={metaText}>
      <span className={`${INFO_LABEL_CLASS} shrink-0`}>
        {field.label}
        {linkedCriterion && <span className="ml-1 text-gray-400">({CRITERION_LABELS[linkedCriterion]})</span>}
      </span>
      <span className="text-right text-theme-sm font-medium text-gray-800 dark:text-white/90">{describePersonaValue(field.value ?? undefined)}</span>
    </div>
  );
};

interface PersonaCardProps {
  customer: CustomerDetail;
}

export const PersonaCard = ({ customer }: PersonaCardProps) => {
  const { navigate } = useCrmActions();
  const { data: persona } = useCustomerPersona(customer.id);
  if (!persona) return null;
  const groups = persona.groups.filter((group) => group.code !== 'REAL_ESTATE');

  return (
    <section aria-label="Chân dung khách hàng" className={`${CARD_CLASS} space-y-4 p-5`}>
      <CardHeading
        icon={CircleUserRound}
        title="Chân dung khách hàng"
        trailing={
          <button type="button" onClick={() => navigate('edit_persona')} aria-label="Sửa chân dung khách hàng" className={BUTTON_SOFT_SM_CLASS}>
            <Pencil size={14} aria-hidden="true" />
            Sửa
          </button>
        }
      />

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-theme-sm font-medium text-gray-700 dark:text-gray-300">Độ đầy đủ chân dung</span>
          <span className="text-sm font-semibold text-brand-500 dark:text-brand-400">{persona.completeness}%</span>
        </div>
        <ProgressBar percent={persona.completeness} label="Độ đầy đủ chân dung" />
      </div>

      {persona.missingSuggestions.length > 0 && (
        <div className="rounded-lg border border-warning-100 bg-warning-50 p-3 dark:border-warning-500/20 dark:bg-warning-500/10">
          <p className="flex items-center gap-1.5 text-theme-xs font-semibold text-warning-700 dark:text-warning-400">
            <MessageCircleQuestion size={14} aria-hidden="true" />
            Nên hỏi ở lần chăm sóc tới
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {persona.missingSuggestions.map((item) => (
              <li key={item.fieldKey} className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.warning}`}>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((group) => {
        const filled = group.fields.filter((field) => field.value);
        return (
          <div key={group.code} className="space-y-1">
            <div className={CAPTION_CLASS}>{group.label}</div>
            {filled.length === 0 ? (
              <p className={MUTED_TEXT_CLASS}>Chưa có thông tin.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {filled.map((field) => (
                  <PersonaValueRow key={field.fieldKey} field={field} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};

export const RealEstateNeedsCard = ({ customer }: PersonaCardProps) => {
  const { navigate } = useCrmActions();
  const { data: persona } = useCustomerPersona(customer.id);
  const needs = persona?.groups.find((group) => group.code === 'REAL_ESTATE');
  const filled = needs?.fields.filter((field) => field.value) ?? [];

  return (
    <section aria-label="Nhu cầu BĐS" className={`${CARD_CLASS} space-y-3 p-5`}>
      <CardHeading
        icon={Building2}
        title="Nhu cầu BĐS"
        trailing={
          <button type="button" onClick={() => navigate('edit_investment')} aria-label="Sửa nhu cầu BĐS" className={BUTTON_SOFT_SM_CLASS}>
            <Pencil size={14} aria-hidden="true" />
            Sửa
          </button>
        }
      />
      {filled.length === 0 ? (
        <p className={MUTED_TEXT_CLASS}>Chưa có thông tin nhu cầu.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {filled.map((field) => (
            <PersonaValueRow key={field.fieldKey} field={field} />
          ))}
        </div>
      )}
    </section>
  );
};
