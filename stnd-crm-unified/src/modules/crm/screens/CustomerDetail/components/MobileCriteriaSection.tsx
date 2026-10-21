// Thẻ "4 Tiêu chí chốt Deal (C4)" của biến thể Mobile (đọc qua adapter `toDealCriteria`).
// Thanh tiến độ + danh sách tiêu chí: Admin chưa có -> vẽ theo Stitch bằng token success/gray/brand của Admin.
import { Circle, CircleCheck, ListChecks, Pencil } from 'lucide-react';
import { getC4AchievedPercent, toDealCriteria } from '@crm/lib/customerAdapters';
import type { C4CriterionKey, Customer, DealCriterionKey } from '@crm/types/crm';
import { C4_ACHIEVED_LABEL_PERCENT, C4_CRITERIA_ITEMS } from '../customerDetailUtils';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { C4ProgressBar } from './DetailParts';
import { CHIP_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import { MOBILE_CARD_CLASS, MobileSectionHeader } from './MobileSectionParts';

interface MobileCriteriaSectionProps {
  customer: Customer;
}

/** Khoá C4 chuẩn -> khoá `dealCriteria` kiểu Mobile (chỉ khác ở "timing" / "timeline"). */
const DEAL_KEY_BY_C4_KEY: Record<C4CriterionKey, DealCriterionKey> = {
  demand: 'demand',
  motivation: 'motivation',
  finance: 'finance',
  timing: 'timeline',
};

const CRITERION_MET_CLASS = 'border-success-200 bg-success-50/60 dark:border-success-500/20 dark:bg-success-500/[0.08]';
const CRITERION_PENDING_CLASS = 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900';

export const MobileCriteriaSection = ({ customer }: MobileCriteriaSectionProps) => {
  const { toggleCriterion } = useCustomerDetailActions(customer.id);
  const dealCriteria = toDealCriteria(customer.c4Criteria);
  const progressPercent = getC4AchievedPercent(customer.c4Criteria);

  return (
    <section aria-label="4 Tiêu chí chốt Deal" className={MOBILE_CARD_CLASS}>
      <MobileSectionHeader
        icon={ListChecks}
        title="4 Tiêu chí chốt Deal (C4)"
        trailing={<span className={`${CHIP_CLASS} shrink-0 ${CHIP_TONE_CLASS.brand}`}>{progressPercent}% hoàn thành</span>}
      />

      <C4ProgressBar percent={progressPercent} />

      <ul className="space-y-2">
        {C4_CRITERIA_ITEMS.map(({ key, label }) => {
          const criterion = dealCriteria[DEAL_KEY_BY_C4_KEY[key]];
          const isMet = criterion.met;
          const StateIcon = isMet ? CircleCheck : Circle;
          return (
            <li key={key}>
              <button
                type="button"
                aria-pressed={isMet}
                onClick={() => toggleCriterion(customer.c4Criteria, key)}
                className={`flex w-full items-start justify-between gap-2 rounded-xl border p-3 text-left transition-colors active:scale-[0.99] ${
                  isMet ? CRITERION_MET_CLASS : CRITERION_PENDING_CLASS
                }`}
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <StateIcon
                    size={20}
                    aria-hidden="true"
                    className={`mt-0.5 shrink-0 ${isMet ? 'text-success-500' : 'text-gray-400 dark:text-gray-500'}`}
                  />
                  <span className="block min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-white/90">{label}</span>
                      <span className={`${CHIP_CLASS} px-2 py-0.5 ${isMet ? CHIP_TONE_CLASS.success : CHIP_TONE_CLASS.gray}`}>
                        {isMet ? `${C4_ACHIEVED_LABEL_PERCENT}% · Đạt` : 'Chưa đạt'}
                      </span>
                    </span>
                    {criterion.text && (
                      <span className="mt-1 block text-theme-xs leading-relaxed text-gray-600 dark:text-gray-400">{criterion.text}</span>
                    )}
                  </span>
                </span>
                <Pencil size={14} aria-hidden="true" className="mt-1 shrink-0 text-gray-400" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
