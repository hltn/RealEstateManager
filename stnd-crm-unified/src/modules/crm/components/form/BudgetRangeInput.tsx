import { FieldError, getFieldA11yProps } from './FieldError';
import { FORM_HINT_CLASS, FORM_LABEL_TEXT_CLASS } from '@crm/lib/uiClasses';
import { TextInput } from './TextInput';

interface BudgetRangeInputProps {
  idPrefix: string;
  /** Tỷ VNĐ; NaN = ô đang trống. */
  budgetMin: number;
  budgetMax: number;
  onChangeMin: (value: number) => void;
  onChangeMax: (value: number) => void;
  errorMin?: string;
  errorMax?: string;
  isRequired?: boolean;
  hint?: string;
}

const toInputValue = (value: number) => (Number.isFinite(value) ? value : '');

/** "Từ x tỷ — Đến y tỷ" (2 nguồn Stitch đều dùng ô số, không có thanh trượt) + khoảng dao động. */
export const BudgetRangeInput = ({
  idPrefix,
  budgetMin,
  budgetMax,
  onChangeMin,
  onChangeMax,
  errorMin,
  errorMax,
  isRequired = false,
  hint,
}: BudgetRangeInputProps) => {
  const minId = `${idPrefix}-budget-min`;
  const maxId = `${idPrefix}-budget-max`;
  const labelId = `${idPrefix}-budget-label`;
  const spread = budgetMax - budgetMin;
  const hasSpread = Number.isFinite(spread) && spread >= 0;
  const prefixClass = 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500';

  return (
    <div role="group" aria-labelledby={labelId} className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span id={labelId} className={FORM_LABEL_TEXT_CLASS}>
          Ngân sách dự kiến (tỷ VNĐ)
          {isRequired && <span className="ml-0.5 text-error-500">*</span>}
        </span>
        {hasSpread && (
          <span className="text-xs font-medium text-brand-600 dark:text-brand-400">
            Dao động {Number(spread.toFixed(2))} tỷ
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <span aria-hidden="true" className={prefixClass}>
            Từ
          </span>
          <TextInput
            id={minId}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            aria-label="Ngân sách tối thiểu (tỷ)"
            value={toInputValue(budgetMin)}
            onChange={(event) => onChangeMin(event.target.valueAsNumber)}
            hasError={Boolean(errorMin)}
            rightAddon="tỷ"
            className="pl-10! font-semibold"
            {...getFieldA11yProps(`${minId}-error`, errorMin)}
          />
        </div>
        <div className="relative">
          <span aria-hidden="true" className={prefixClass}>
            Đến
          </span>
          <TextInput
            id={maxId}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            aria-label="Ngân sách tối đa (tỷ)"
            value={toInputValue(budgetMax)}
            onChange={(event) => onChangeMax(event.target.valueAsNumber)}
            hasError={Boolean(errorMax)}
            rightAddon="tỷ"
            className="pl-11! font-semibold"
            {...getFieldA11yProps(`${maxId}-error`, errorMax)}
          />
        </div>
      </div>
      <FieldError id={`${minId}-error`} message={errorMin} />
      <FieldError id={`${maxId}-error`} message={errorMax} />
      {!errorMin && !errorMax && hint && <p className={FORM_HINT_CLASS}>{hint}</p>}
    </div>
  );
};
