// "Tiến độ" + 4 tiêu chí tương tác (C4, C5): mỗi tiêu chí có dấu hoàn thành + mô tả sửa được.
// Tiến độ = số tiêu chí đạt / 4 do lớp dữ liệu tính (không lưu, không tự đánh dấu khi chọn dự án).
import { useState } from 'react';
import { Circle, CircleCheck, ListChecks, Pencil } from 'lucide-react';
import type { CustomerDetail } from '@crm/api';
import { ProgressDots } from '@crm/components/ProgressDots';
import { formatVnDate } from '@crm/lib/dateTime';
import { BUTTON_LINK_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_OUTLINE_CLASS, CARD_CLASS, TEXTAREA_CLASS } from '@crm/lib/uiClasses';
import type { CriterionKey } from '@crm/types/crm';
import { CRITERIA_ITEMS } from '../customerDetailUtils';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { CardHeading } from './DetailParts';

const MAX_DESCRIPTION_LENGTH = 1000;

const DONE_CLASS = 'border-success-200 bg-success-50/60 dark:border-success-500/20 dark:bg-success-500/[0.08]';
const PENDING_CLASS = 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900';

interface CriterionRowProps {
  customer: CustomerDetail;
  criterionKey: CriterionKey;
  label: string;
}

const CriterionRow = ({ customer, criterionKey, label }: CriterionRowProps) => {
  const { toggleCriterion, saveCriterionDescription } = useCustomerDetailActions(customer);
  const criterion = customer.criteria[criterionKey];
  const [draft, setDraft] = useState<string | null>(null);
  const StateIcon = criterion.isDone ? CircleCheck : Circle;
  const isEditing = draft !== null;

  return (
    <li className={`rounded-xl border p-3 ${criterion.isDone ? DONE_CLASS : PENDING_CLASS}`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={criterion.isDone}
          onClick={() => toggleCriterion(criterionKey)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <StateIcon size={20} aria-hidden="true" className={criterion.isDone ? 'shrink-0 text-success-500' : 'shrink-0 text-gray-400 dark:text-gray-500'} />
          <span className="text-sm font-semibold text-gray-800 dark:text-white/90">{label}</span>
          <span className={`text-theme-xs font-medium ${criterion.isDone ? 'text-success-600 dark:text-success-500' : 'text-gray-500 dark:text-gray-400'}`}>
            {criterion.isDone ? 'Đạt' : 'Chưa đạt'}
          </span>
        </button>
        {!isEditing && (
          <button type="button" onClick={() => setDraft(criterion.description)} className={BUTTON_LINK_CLASS} aria-label={`Sửa mô tả ${label}`}>
            <Pencil size={12} aria-hidden="true" />
            Mô tả
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="mt-2 space-y-2 pl-7">
          <textarea
            rows={3}
            value={draft}
            maxLength={MAX_DESCRIPTION_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={`Mô tả ${label}`}
            placeholder="VD: Căn 2PN, view sông, để ở"
            className={TEXTAREA_CLASS}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className={`${BUTTON_OUTLINE_CLASS} px-3 py-1.5 text-xs`}>
              Huỷ
            </button>
            <button
              type="button"
              onClick={() => {
                if (saveCriterionDescription(criterionKey, draft)) setDraft(null);
              }}
              className={`${BUTTON_PRIMARY_CLASS} px-3 py-1.5 text-xs`}
            >
              Lưu
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 pl-7">
          {criterion.description ? (
            <p className="text-theme-sm leading-relaxed text-gray-600 dark:text-gray-400">{criterion.description}</p>
          ) : (
            <p className="text-theme-xs italic text-gray-400 dark:text-gray-500">Chưa có mô tả.</p>
          )}
          {criterion.updatedBy && (
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              Cập nhật {formatVnDate(criterion.updatedAt)} · {criterion.updatedBy.displayName}
            </p>
          )}
        </div>
      )}
    </li>
  );
};

interface CriteriaBoardProps {
  customer: CustomerDetail;
}

export const CriteriaBoard = ({ customer }: CriteriaBoardProps) => (
  <section aria-label="Tiến độ tương tác" className={`${CARD_CLASS} space-y-4 p-5`}>
    <CardHeading
      icon={ListChecks}
      title="Tiến độ"
      description="4 tiêu chí tương tác — mỗi tiêu chí đạt = 25%"
      trailing={<ProgressDots progress={customer.progress} criteriaDone={customer.criteriaDone} isCompact />}
    />
    <ul className="space-y-2">
      {CRITERIA_ITEMS.map(({ key, label }) => (
        <CriterionRow key={key} customer={customer} criterionKey={key} label={label} />
      ))}
    </ul>
  </section>
);
