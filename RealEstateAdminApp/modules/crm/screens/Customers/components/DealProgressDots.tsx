/**
 * Tiến độ chốt deal 4 bước (mỗi bước 25%) + % + nhãn bước — bố cục Stitch (Admin bảng khách / Mobile thẻ khách).
 * Admin chưa có (tài liệu 03 mục 10: "Tiến độ 4 bước … Làm component mới") → chấm tròn bằng token:
 * đạt = brand (hoặc warning cho khách net trên app), xong 100% = success, chưa đạt = gray-200/gray-700.
 */
import { C4_CRITERION_PERCENT, PROGRESS_STEP_COUNT } from '@crm/lib/customerAdapters';

const COMPLETED_PERCENT = 100;
const PROGRESS_STEPS = Array.from({ length: PROGRESS_STEP_COUNT }, (_, index) => index + 1);

interface DealProgressDotsProps {
  progressPercentage: number;
  /** Nhãn bước hiện tại; bỏ trống = chỉ hiện chấm + %. */
  progressStep?: string;
  /** Tô chấm màu warning thay vì brand (khách net — theo thẻ khách Mobile). */
  isHighlighted?: boolean;
}

export const DealProgressDots = ({ progressPercentage, progressStep, isHighlighted = false }: DealProgressDotsProps) => {
  const isCompleted = progressPercentage >= COMPLETED_PERCENT;
  // Như Admin Stitch: chấm thứ n sáng khi đạt n × 25% (0% = chưa chấm nào).
  const reachedStepCount = Math.min(PROGRESS_STEP_COUNT, Math.floor(progressPercentage / C4_CRITERION_PERCENT));
  const reachedDotClass = isCompleted ? 'bg-success-500' : isHighlighted ? 'bg-warning-500' : 'bg-brand-500';

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1" role="img" aria-label={`Tiến độ chốt deal ${progressPercentage}%`}>
          {PROGRESS_STEPS.map((step) => (
            <span
              key={step}
              className={`h-2.5 w-2.5 rounded-full ${step <= reachedStepCount ? reachedDotClass : 'bg-gray-200 dark:bg-gray-700'}`}
            />
          ))}
        </span>
        <span
          className={`text-theme-xs font-semibold ${
            isCompleted ? 'text-success-600 dark:text-success-500' : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {progressPercentage}%
        </span>
      </div>
      {progressStep && (
        <p
          className={`mt-0.5 text-theme-xs ${
            isCompleted ? 'font-medium text-success-600 dark:text-success-500' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {progressStep}
        </p>
      )}
    </div>
  );
};
