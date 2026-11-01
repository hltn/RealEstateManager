/**
 * Tiến độ 4 chấm = 4 tiêu chí tương tác (02 §5 "Thanh tiến độ 4 bước", thay thanh ký tự █░ của Sheets).
 * Chấm thứ i sáng khi tiêu chí thứ i (Nhu cầu, Động cơ, Tài chính, Thời gian) đạt; 100% = màu success.
 * Dùng CHUNG cho bảng desktop, thẻ mobile, chi tiết khách — số % luôn lấy từ `progress` của lớp dữ liệu.
 */
import { CRITERIA_KEYS, CRITERION_LABELS } from '@crm/lib/customerRules';
import type { CriterionKey } from '@crm/types/crm';

const COMPLETED_PERCENT = 100;

interface ProgressDotsProps {
  progress: number;
  criteriaDone: Record<CriterionKey, boolean>;
  /** Ẩn chữ "%" (chỉ chấm) — dùng ở đầu thẻ chi tiết. */
  isCompact?: boolean;
}

export const ProgressDots = ({ progress, criteriaDone, isCompact = false }: ProgressDotsProps) => {
  const isCompleted = progress >= COMPLETED_PERCENT;
  const doneLabels = CRITERIA_KEYS.filter((key) => criteriaDone[key]).map((key) => CRITERION_LABELS[key]);
  const label = `Tiến độ ${progress}%${doneLabels.length > 0 ? `: đạt ${doneLabels.join(', ')}` : ''}`;

  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="flex items-center gap-1" role="img" aria-label={label}>
        {CRITERIA_KEYS.map((key) => (
          <span
            key={key}
            className={`h-2.5 w-2.5 rounded-full ${criteriaDone[key] ? (isCompleted ? 'bg-success-500' : 'bg-brand-500') : 'bg-gray-200 dark:bg-gray-700'}`}
          />
        ))}
      </span>
      <span className={`text-theme-xs font-semibold ${isCompleted ? 'text-success-600 dark:text-success-500' : 'text-gray-700 dark:text-gray-300'}`}>
        {progress}%
      </span>
      {isCompact && <span className="sr-only">{label}</span>}
    </span>
  );
};
