/**
 * Khối nhỏ dùng chung của màn Báo cáo: thẻ KPI (bento Stitch trên vỏ thẻ Admin), điều khiển phân đoạn
 * Tuần/Tháng/Quý/Năm (Admin không có) và tiêu đề thẻ biểu đồ.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FilterTimeRange } from '@crm/types/crm';
import { CAPTION_CLASS, CARD_CLASS } from '@crm/lib/uiClasses';
import { TIME_RANGE_OPTIONS } from '../reportStats';

interface ReportKpiCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  iconBoxClass: string;
  /** Lớp màu số liệu (mặc định xám đậm). */
  valueClass?: string;
  badge?: ReactNode;
  footnote: string;
  density?: 'default' | 'compact';
}

export const ReportKpiCard = ({
  label,
  value,
  icon: Icon,
  iconBoxClass,
  valueClass = 'text-gray-800 dark:text-white/90',
  badge,
  footnote,
  density = 'default',
}: ReportKpiCardProps) => {
  const isCompact = density === 'compact';
  return (
    <div className={`${CARD_CLASS} flex flex-col justify-between ${isCompact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${CAPTION_CLASS} ${isCompact ? 'truncate' : ''}`}>{label}</span>
        <span className={`flex shrink-0 items-center justify-center ${isCompact ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl'} ${iconBoxClass}`}>
          <Icon size={isCompact ? 16 : 20} aria-hidden="true" />
        </span>
      </div>
      <div className={`flex flex-wrap items-baseline gap-2 ${isCompact ? 'mt-2' : 'mt-3'}`}>
        <span className={`${isCompact ? 'text-2xl' : 'text-3xl'} font-semibold leading-none tracking-tight ${valueClass}`}>{value}</span>
        {badge}
      </div>
      <p className={`mt-2 text-theme-xs text-gray-500 dark:text-gray-400 ${isCompact ? 'line-clamp-2' : 'truncate'}`}>{footnote}</p>
    </div>
  );
};

interface TimeRangeSegmentedProps {
  value: FilterTimeRange;
  onChange: (value: FilterTimeRange) => void;
}

export const TimeRangeSegmented = ({ value, onChange }: TimeRangeSegmentedProps) => (
  <div role="group" aria-label="Khoảng thời gian" className="inline-flex rounded-lg bg-gray-100 p-1 text-xs dark:bg-gray-900">
    {TIME_RANGE_OPTIONS.map((option) => {
      const isActive = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          aria-pressed={isActive}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            isActive
              ? 'bg-white text-brand-600 shadow-theme-xs dark:bg-gray-800 dark:text-brand-400'
              : 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

interface ChartCardHeaderProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}

/** Đầu thẻ biểu đồ: mẫu "thẻ tiêu đề khối" Admin (icon brand 20px + h3 text-lg font-semibold). */
export const ChartCardHeader = ({ icon: Icon, title, subtitle, aside }: ChartCardHeaderProps) => (
  <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4 dark:border-white/[0.05]">
    <div className="min-w-0">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white/90">
        {Icon && <Icon size={20} aria-hidden="true" className="shrink-0 text-brand-500 dark:text-brand-400" />}
        {title}
      </h3>
      {subtitle && <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
    </div>
    {aside}
  </div>
);
