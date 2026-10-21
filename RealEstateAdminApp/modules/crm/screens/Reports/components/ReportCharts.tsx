/**
 * Biểu đồ của màn Báo cáo — SVG/CSS thuần (Admin App chưa cài thư viện biểu đồ), bố cục theo Stitch,
 * màu token Admin + cặp `dark:`. SVG dùng `stroke="currentColor"` + lớp `text-*` để đổi màu theo chế độ.
 */
import type { LeadSourceStat, StatusSegment } from '../reportStats';

const formatPercent = (percent: number): string => `${percent.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

/** Thanh phễu nhiều đoạn (tỷ trọng trạng thái). */
interface SegmentedBarProps {
  segments: StatusSegment[];
}

export const SegmentedBar = ({ segments }: SegmentedBarProps) => (
  <div
    role="img"
    aria-label={segments.map((segment) => `${segment.label} ${formatPercent(segment.percent)}`).join(', ')}
    className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
  >
    {segments
      .filter((segment) => segment.count > 0)
      .map((segment) => (
        <div
          key={segment.status}
          className={`h-full transition-[width] duration-700 ${segment.fillClass}`}
          style={{ width: `${segment.percent}%` }}
          title={`${segment.label}: ${formatPercent(segment.percent)}`}
        />
      ))}
  </div>
);

const DONUT_RADIUS = 50;
const DONUT_STROKE = 14;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

interface StatusDonutProps {
  segments: StatusSegment[];
  total: number;
  /** Lớp kích thước khung (mặc định 160px). */
  sizeClass?: string;
}

/** Donut: mỗi đoạn là 1 vòng tròn với `strokeDasharray` = độ dài cung, `strokeDashoffset` = tổng các cung trước. */
export const StatusDonut = ({ segments, total, sizeClass = 'h-40 w-40' }: StatusDonutProps) => {
  // Cộng dồn độ dài cung để đoạn sau bắt đầu ngay sau đoạn trước.
  const arcs = segments
    .filter((segment) => segment.count > 0)
    .reduce<{ segment: StatusSegment; arcLength: number; offset: number }[]>((result, segment) => {
      const previous = result[result.length - 1];
      const offset = previous ? previous.offset + previous.arcLength : 0;
      return [...result, { segment, arcLength: (segment.percent / 100) * DONUT_CIRCUMFERENCE, offset }];
    }, []);

  return (
    <div className={`relative flex shrink-0 items-center justify-center ${sizeClass}`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={`Phân bổ ${total} khách theo tình trạng`}>
        <circle cx="60" cy="60" r={DONUT_RADIUS} fill="none" stroke="currentColor" strokeWidth={DONUT_STROKE} className="text-gray-100 dark:text-gray-800" />
        {arcs.map(({ segment, arcLength, offset }) => (
          <circle
            key={segment.status}
            cx="60"
            cy="60"
            r={DONUT_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={DONUT_STROKE}
            strokeDasharray={`${arcLength} ${DONUT_CIRCUMFERENCE}`}
            strokeDashoffset={-offset}
            className={segment.strokeClass}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold leading-tight text-gray-800 dark:text-white/90">{total}</span>
        <span className="text-theme-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Hồ sơ</span>
      </div>
    </div>
  );
};

interface StatusLegendProps {
  segments: StatusSegment[];
  /** `boxed` = mỗi dòng 1 ô viền (desktop), `plain` = danh sách gọn (mobile). */
  variant: 'boxed' | 'plain';
}

export const StatusLegend = ({ segments, variant }: StatusLegendProps) => (
  <ul className={variant === 'boxed' ? 'w-full space-y-2.5' : 'w-full space-y-3'}>
    {segments.map((segment) => (
      <li
        key={segment.status}
        className={`flex items-center justify-between gap-3 ${
          variant === 'boxed' ? 'rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/[0.05] dark:bg-white/[0.02]' : ''
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${segment.fillClass}`} />
          <span className="truncate text-theme-sm font-medium text-gray-700 dark:text-gray-300">{segment.label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{segment.count} khách</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${segment.chipClass}`}>{formatPercent(segment.percent)}</span>
        </span>
      </li>
    ))}
  </ul>
);

/** Thanh xếp hạng nguồn khách. */
interface LeadSourceBarsProps {
  sources: LeadSourceStat[];
}

export const LeadSourceBars = ({ sources }: LeadSourceBarsProps) => (
  <ul className="space-y-4">
    {sources.map((source) => (
      <li key={source.key}>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-theme-sm">
          <span className="flex min-w-0 items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${source.fillClass}`} />
            <span className="truncate">{source.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="font-semibold text-gray-800 dark:text-white/90">{source.count} khách</span>
            <span className={`text-theme-xs font-medium ${source.textClass}`}>({formatPercent(source.percent)})</span>
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={source.label}
          aria-valuenow={source.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
        >
          <div className={`h-full rounded-full transition-[width] duration-700 ${source.fillClass}`} style={{ width: `${source.percent}%` }} />
        </div>
      </li>
    ))}
  </ul>
);
