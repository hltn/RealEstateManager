// Tab "Tiến độ & 4 Tiêu chí" (Admin CustomerDetailView, tab 2): bấm thẻ để đổi Đạt / Chưa đạt.
// Bố cục: xếp chồng (< xl) -> 3 vùng ở xl: cột trái (tổng quan + quy chuẩn) | 2 cột phải (4 thẻ tiêu chí).
// Thẻ tiêu chí + thanh tiến độ: Admin chưa có (tham khảo StepCard) -> vẽ theo Stitch bằng token success/gray của Admin.
import { Circle, CircleCheck, CircleHelp, ListChecks, ShieldCheck } from 'lucide-react';
import type { Customer } from '@crm/types/crm';
import { C4_ACHIEVED_LABEL_PERCENT, C4_CRITERIA_ITEMS, countAchievedC4 } from '../customerDetailUtils';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { C4ProgressBar, CardHeading } from './DetailParts';
import {
  BUTTON_OUTLINE_LG_CLASS,
  CARD_CLASS,
  CARD_TITLE_CLASS,
  CHIP_CLASS,
  CHIP_TONE_CLASS,
  MUTED_TEXT_CLASS,
} from '@crm/lib/uiClasses';

interface DesktopCriteriaPanelProps {
  customer: Customer;
}

/** Ngưỡng % C4 để khách đủ điều kiện ưu tiên (3/4 tiêu chí). */
const PRIORITY_THRESHOLD_PERCENT = 75;

const CRITERION_ACHIEVED_CLASS =
  'border-success-200 bg-success-50/60 hover:bg-success-50 dark:border-success-500/20 dark:bg-success-500/[0.08] dark:hover:bg-success-500/[0.12]';
const CRITERION_PENDING_CLASS =
  'border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-white/[0.03]';

export const DesktopCriteriaPanel = ({ customer }: DesktopCriteriaPanelProps) => {
  const { toggleCriterion, notify } = useCustomerDetailActions(customer.id);
  const achievedCount = countAchievedC4(customer.c4Criteria);
  const isPriorityCustomer = customer.progressPercentage >= PRIORITY_THRESHOLD_PERCENT;

  return (
    <div
      role="tabpanel"
      id="customer-detail-panel-criteria"
      aria-labelledby="customer-detail-tab-criteria"
      className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3"
    >
      {/* Cột trái: tổng quan tiến độ + quy chuẩn */}
      <div className="flex min-w-0 flex-col gap-6">
        <section className={`${CARD_CLASS} space-y-5 p-5 md:p-6`} aria-label="Mức độ đạt chuẩn C4">
          <CardHeading
            icon={ListChecks}
            title="4 Tiêu chí chốt Deal (C4)"
            description="Mô hình đánh giá chuẩn 4 tiêu chí sàng lọc khách hàng tiềm năng STND"
          />

          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mức độ đạt chuẩn</span>
              <span className="text-lg font-semibold text-brand-500 dark:text-brand-400">
                {customer.progressPercentage}% Đạt ({achievedCount}/4)
              </span>
            </div>
            <C4ProgressBar percent={customer.progressPercentage} className="h-2.5" />
            <p
              className={`rounded-lg px-3 py-2 text-theme-xs font-medium ${isPriorityCustomer ? CHIP_TONE_CLASS.success : CHIP_TONE_CLASS.warning}`}
            >
              {isPriorityCustomer
                ? 'Khách hàng đủ điều kiện ưu tiên hỗ trợ chọn căn tầng đẹp và chính sách chiết khấu cao!'
                : 'Khách hàng cần làm rõ thêm Động cơ và Thời gian chốt hợp đồng.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => notify('Bấm trực tiếp vào các thẻ tiêu chí để chuyển đổi trạng thái Đạt / Chưa đạt!')}
            className={`${BUTTON_OUTLINE_LG_CLASS} w-full`}
          >
            <CircleHelp size={16} aria-hidden="true" />
            Hướng dẫn đánh giá C4
          </button>
        </section>

        <section className={`${CARD_CLASS} space-y-2 p-5`} aria-label="Quy chuẩn đánh giá C4">
          <div className="flex items-center gap-2 text-brand-500 dark:text-brand-400">
            <ShieldCheck size={16} aria-hidden="true" />
            <span className="text-theme-xs font-medium uppercase tracking-wider">Quy chuẩn đánh giá C4 độc quyền STND</span>
          </div>
          <p className={`leading-relaxed ${MUTED_TEXT_CLASS}`}>
            Để nâng mức xếp hạng khách hàng từ <strong className="text-gray-800 dark:text-white/90">VIP Gold</strong> lên{' '}
            <strong className="text-gray-800 dark:text-white/90">VIP Diamond / Ký HĐMB</strong>, chuyên viên tư vấn cần đạt tối
            thiểu 75% tiêu chí C4 (3/4 đạt).
          </p>
        </section>
      </div>

      {/* Cột phải: 4 thẻ tiêu chí */}
      <section className={`${CARD_CLASS} @container min-w-0 space-y-4 p-5 md:p-6 xl:col-span-2`} aria-label="Đánh giá từng tiêu chí">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={CARD_TITLE_CLASS}>Đánh giá từng tiêu chí</h3>
          <span className="text-theme-xs text-gray-500 dark:text-gray-400">Bấm vào thẻ để đổi Đạt / Chưa đạt</span>
        </div>
        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
          {C4_CRITERIA_ITEMS.map(({ key, label }) => {
            const criterion = customer.c4Criteria[key];
            const isAchieved = criterion.achieved;
            const StateIcon = isAchieved ? CircleCheck : Circle;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isAchieved}
                onClick={() => toggleCriterion(customer.c4Criteria, key)}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${isAchieved ? CRITERION_ACHIEVED_CLASS : CRITERION_PENDING_CLASS}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <StateIcon
                      size={20}
                      aria-hidden="true"
                      className={isAchieved ? 'shrink-0 text-success-500' : 'shrink-0 text-gray-400 dark:text-gray-500'}
                    />
                    <span className="text-sm font-semibold text-gray-800 dark:text-white/90">{label}</span>
                  </span>
                  <span className={`${CHIP_CLASS} shrink-0 px-2 py-0.5 ${isAchieved ? CHIP_TONE_CLASS.success : CHIP_TONE_CLASS.gray}`}>
                    {isAchieved ? `${C4_ACHIEVED_LABEL_PERCENT}% • Đạt` : 'Chưa đạt'}
                  </span>
                </span>
                {criterion.text && (
                  <span className="mt-2 block pl-7 text-theme-sm leading-relaxed text-gray-600 dark:text-gray-400">{criterion.text}</span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
