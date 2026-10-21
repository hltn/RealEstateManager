// Cột tóm tắt bên phải của tab "Thông tin & Chân dung" — chỉ hiện ở xl (>= 1280px) để màn có bố cục 3 vùng.
// Không có trong bản Stitch: chỉ TÓM TẮT dữ liệu sẵn có (tiến độ C4, tương tác gần nhất, gợi ý AI) và dẫn sang tab chi tiết.
import { ArrowRight, Circle, CircleCheck, History, ListChecks, type LucideIcon } from 'lucide-react';
import { formatCareLogStamp } from '@crm/lib/customerAdapters';
import { formatCareLogDate } from '@crm/lib/dateTime';
import type { CareLog, Customer } from '@crm/types/crm';
import { C4_CRITERIA_ITEMS, countAchievedC4, DEFAULT_AI_SUGGESTION } from '../customerDetailUtils';
import { AiSuggestionNotice, C4ProgressBar } from './DetailParts';
import type { DesktopDetailTab } from './DesktopDetailTabs';
import {
  BUTTON_LINK_CLASS,
  CARD_CLASS,
  CARD_TITLE_CLASS,
  CHIP_CLASS,
  CHIP_TONE_CLASS,
  MUTED_TEXT_CLASS,
} from '@crm/lib/uiClasses';

interface DesktopOverviewRailProps {
  customer: Customer;
  careLogs: CareLog[];
  onOpenTab: (tab: DesktopDetailTab) => void;
}

const RAIL_CARD_CLASS = `${CARD_CLASS} space-y-4 p-5`;

interface RailHeadingProps {
  icon: LucideIcon;
  title: string;
  actionLabel: string;
  onAction: () => void;
}

const RailHeading = ({ icon: Icon, title, actionLabel, onAction }: RailHeadingProps) => (
  <div className="flex items-center justify-between gap-2">
    <h3 className={`flex items-center gap-2 ${CARD_TITLE_CLASS}`}>
      <Icon size={18} aria-hidden="true" className="text-brand-500 dark:text-brand-400" />
      {title}
    </h3>
    <button type="button" onClick={onAction} className={BUTTON_LINK_CLASS} aria-label={actionLabel}>
      Xem
      <ArrowRight size={14} aria-hidden="true" />
    </button>
  </div>
);

export const DesktopOverviewRail = ({ customer, careLogs, onOpenTab }: DesktopOverviewRailProps) => {
  const achievedCount = countAchievedC4(customer.c4Criteria);
  const latestLog = careLogs[0];

  return (
    <aside aria-label="Tóm tắt chăm sóc" className="hidden min-w-0 flex-col gap-6 xl:flex">
      {/* Tóm tắt tiến độ C4 */}
      <section className={RAIL_CARD_CLASS}>
        <RailHeading icon={ListChecks} title="Tiến độ C4" actionLabel="Xem tiến độ 4 tiêu chí" onAction={() => onOpenTab('criteria')} />
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold text-gray-800 dark:text-white/90">{customer.progressPercentage}%</span>
            <span className="text-theme-xs text-gray-500 dark:text-gray-400">{achievedCount}/4 tiêu chí đạt</span>
          </div>
          <C4ProgressBar percent={customer.progressPercentage} />
        </div>
        <ul className="space-y-2">
          {C4_CRITERIA_ITEMS.map(({ key, label }) => {
            const isAchieved = customer.c4Criteria[key].achieved;
            const StateIcon = isAchieved ? CircleCheck : Circle;
            return (
              <li key={key} className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                <StateIcon
                  size={16}
                  aria-hidden="true"
                  className={isAchieved ? 'shrink-0 text-success-500' : 'shrink-0 text-gray-300 dark:text-gray-600'}
                />
                <span className="flex-1 truncate">{label}</span>
                <span className="sr-only">{isAchieved ? 'Đạt' : 'Chưa đạt'}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Tương tác gần nhất + gợi ý AI */}
      <section className={RAIL_CARD_CLASS}>
        <RailHeading icon={History} title="Tương tác gần nhất" actionLabel="Xem nhật ký chăm sóc" onAction={() => onOpenTab('logs')} />
        {latestLog ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                {formatCareLogStamp({ date: formatCareLogDate(latestLog.date), time: latestLog.time })}
              </span>
              <span className={`${CHIP_CLASS} px-2 py-0.5 ${CHIP_TONE_CLASS.gray}`}>{latestLog.author}</span>
            </div>
            <p className={`line-clamp-4 ${MUTED_TEXT_CLASS}`}>{latestLog.content}</p>
          </div>
        ) : (
          <p className={MUTED_TEXT_CLASS}>Chưa có nhật ký chăm sóc nào.</p>
        )}
        <AiSuggestionNotice suggestion={customer.aiSuggestion || DEFAULT_AI_SUGGESTION} />
      </section>
    </aside>
  );
};
