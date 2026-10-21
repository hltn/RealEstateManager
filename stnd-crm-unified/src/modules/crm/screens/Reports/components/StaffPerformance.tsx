/**
 * Hiệu suất chăm sóc theo nhân sự.
 * - Desktop: bảng theo mẫu Admin (`ExternalLogsScreen.tsx:304-332`: thead gray-50/900, th text-theme-xs uppercase,
 *   tbody divide, hàng hover) — biến thể có nền nằm trong thẻ (`UserManagementScreen.tsx:226`).
 * - Mobile: danh sách xếp hạng Top 3 (Stitch).
 * Màu avatar/hạng quy về token Admin (bỏ `avatarBg` cyan/emerald của dữ liệu mẫu).
 */
import { Crown, Eye } from 'lucide-react';
import type { StaffPerformance } from '@crm/types/crm';
import { ICON_BUTTON_CLASS } from '@crm/lib/uiClasses';
import { getKpiBarClass } from '../reportStats';

const AVATAR_CLASSES = [
  'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400',
  'bg-blue-light-100 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-400',
  'bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-500',
  'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',
] as const;

const getAvatarClass = (index: number): string => AVATAR_CLASSES[index % AVATAR_CLASSES.length];

/** Huy hiệu thứ hạng theo vị trí hiển thị (1 vàng, 2 xám, còn lại cam nhạt). */
const getRankBadgeClass = (position: number): string => {
  if (position === 1) return 'bg-warning-100 text-warning-700 ring-2 ring-warning-300 dark:bg-warning-500/15 dark:text-warning-500 dark:ring-warning-500/40';
  if (position === 2) return 'bg-gray-100 text-gray-700 ring-1 ring-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600';
  return 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400';
};

const TH_CLASS = 'whitespace-nowrap px-5 py-3 text-theme-xs font-medium uppercase text-gray-500 dark:text-gray-400';

interface StaffPerformanceTableProps {
  rows: StaffPerformance[];
  onViewDetail: (staff: StaffPerformance) => void;
}

export const StaffPerformanceTable = ({ rows, onViewDetail }: StaffPerformanceTableProps) => (
  <div className="overflow-x-auto">
    <table className="min-w-[880px] w-full">
      <thead className="border-b border-gray-100 dark:border-white/[0.05]">
        <tr className="bg-gray-50 dark:bg-gray-900">
          <th scope="col" className={`${TH_CLASS} w-16 text-left`}>Hạng</th>
          <th scope="col" className={`${TH_CLASS} text-left`}>Chuyên viên tư vấn</th>
          <th scope="col" className={`${TH_CLASS} text-center`}>Khách phụ trách</th>
          <th scope="col" className={`${TH_CLASS} text-center`}>Khách net</th>
          <th scope="col" className={`${TH_CLASS} text-center`}>Lịch hẹn xong</th>
          <th scope="col" className={`${TH_CLASS} text-right`}>Doanh số / Cọc</th>
          <th scope="col" className={`${TH_CLASS} text-center`}>Tỷ lệ KPI</th>
          <th scope="col" className={`${TH_CLASS} w-20 text-center`}>Thao tác</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={8} className="px-5 py-16 text-center text-theme-sm text-gray-500 dark:text-gray-400">
              Chưa có số liệu hiệu suất cho nhân viên đã chọn.
            </td>
          </tr>
        ) : (
          rows.map((staff, index) => {
            const position = index + 1;
            return (
              <tr key={staff.name} className="transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                <td className="px-5 py-4">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${getRankBadgeClass(position)}`}>{position}</span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="relative">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${getAvatarClass(index)}`}>
                        {staff.avatarText}
                      </span>
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success-500 ring-2 ring-white dark:ring-gray-900"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                        {staff.name}
                        {position === 1 && <Crown size={16} aria-label="Dẫn đầu" className="text-warning-500" />}
                      </p>
                      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{staff.role}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 text-center text-theme-sm font-semibold text-gray-800 dark:text-white/90">{staff.customersHandled}</td>
                <td className="px-5 py-4 text-center">
                  <span className="whitespace-nowrap rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
                    {staff.hotLeads} khách
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-center text-theme-sm font-semibold text-gray-800 dark:text-white/90">{staff.appointmentsCompleted} hẹn</td>
                <td className="min-w-[180px] px-5 py-4 text-right">
                  <p className="text-theme-sm font-semibold text-success-600 dark:text-success-500">{staff.salesOrDeposits}</p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">{staff.projectName}</p>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-center gap-2">
                    <div
                      role="progressbar"
                      aria-label={`KPI ${staff.name}`}
                      aria-valuenow={staff.kpiRate}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-2 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                    >
                      <div className={`h-full rounded-full ${getKpiBarClass(staff.kpiRate)}`} style={{ width: `${Math.min(staff.kpiRate, 100)}%` }} />
                    </div>
                    <span className="w-10 text-xs font-semibold text-gray-800 dark:text-white/90">{staff.kpiRate}%</span>
                  </div>
                </td>
                <td className="px-5 py-4 text-center">
                  <button
                    type="button"
                    title="Xem phân tích chi tiết"
                    aria-label={`Xem phân tích KPI của ${staff.name}`}
                    onClick={() => onViewDetail(staff)}
                    className={ICON_BUTTON_CLASS}
                  >
                    <Eye size={18} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  </div>
);

interface StaffRankingListProps {
  rows: StaffPerformance[];
}

export const StaffRankingList = ({ rows }: StaffRankingListProps) =>
  rows.length === 0 ? (
    <p className="py-6 text-center text-theme-sm text-gray-500 dark:text-gray-400">Chưa có số liệu cho nhân viên đã chọn.</p>
  ) : (
    <ol className="space-y-3">
      {rows.map((staff, index) => {
        const position = index + 1;
        const isLeader = position === 1;
        return (
          <li
            key={staff.name}
            className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
              isLeader
                ? 'border-brand-100 bg-brand-25 dark:border-brand-500/25 dark:bg-brand-500/10'
                : 'border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.02]'
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isLeader ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {position}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-gray-800 dark:text-white/90">
                  {staff.name}
                  {isLeader && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-success-500" />}
                </p>
                <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">{staff.role}</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-semibold text-gray-800 dark:text-white/90">{staff.customersHandled} khách</p>
              <p className="mt-0.5 flex items-center justify-end gap-1.5 text-theme-xs">
                <span className="font-medium text-warning-700 dark:text-warning-500">{staff.hotLeads} net</span>
                <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">
                  •
                </span>
                <span className="font-medium text-brand-600 dark:text-brand-400">{staff.appointmentsCompleted} hẹn</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
