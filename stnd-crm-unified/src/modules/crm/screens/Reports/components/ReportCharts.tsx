/**
 * Biểu đồ của màn Báo cáo — SVG/CSS thuần (Admin App chưa cài thư viện biểu đồ), bố cục theo Stitch,
 * màu token Admin + cặp `dark:`. SVG dùng `stroke="currentColor"` + lớp `text-*` để đổi màu theo chế độ.
 */
import type { BreakdownRow, StatusSegment } from '../reportStats';

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
          key={segment.key}
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
            key={segment.key}
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
        key={segment.key}
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

/** Thanh xếp hạng theo một chiều (nguồn khách, dự án...). */
interface BreakdownBarsProps {
  rows: BreakdownRow[];
  /** Thông báo khi chưa có dữ liệu. */
  emptyText?: string;
}

export const BreakdownBars = ({ rows, emptyText = 'Chưa có dữ liệu.' }: BreakdownBarsProps) =>
  rows.length === 0 ? (
    <p className="text-theme-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
  ) : (
    <ul className="space-y-4">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="mb-1.5 flex items-center justify-between gap-2 text-theme-sm">
            <span className="truncate font-medium text-gray-700 dark:text-gray-300">{row.label}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-semibold text-gray-800 dark:text-white/90">{row.count} khách</span>
              <span className="text-theme-xs font-medium text-brand-600 dark:text-brand-400">({formatPercent(row.percent)})</span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={row.label}
            aria-valuenow={row.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
          >
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-700" style={{ width: `${Math.min(row.percent, 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
