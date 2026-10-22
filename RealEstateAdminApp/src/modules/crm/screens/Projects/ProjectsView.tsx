/**
 * Màn "Quản lý dự án" dùng chung 2 biến thể:
 * - desktop/tablet: đầu trang Admin có nút + lưới thẻ 1/2/3 cột (md / xl).
 * - mobile: không có nguồn Stitch -> tự thiết kế: tiêu đề trong nội dung, chip phân khúc cuộn ngang, thẻ xếp dọc.
 *   Màn này có CrmBottomNav (CrmLayout đã chừa `pb-20`) nên không đặt gì `fixed bottom-0`.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus, Settings2 } from 'lucide-react';
import { useCatalogs, useDashboardReport } from '@crm/api';
import { useCrmActions } from '@crm/store';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_LG_CLASS, OPTION_ACTIVE_CLASS, OPTION_IDLE_CLASS } from '@crm/lib/uiClasses';
import { ProjectCard } from './ProjectCard';
import { ALL_SEGMENTS, filterProjectsBySegment, getProjectSegments, toInterestedCounts } from './projectCatalog';

const EMPTY_QUERY = {};

interface ProjectsViewProps {
  variant: 'desktop' | 'mobile';
}

export const ProjectsView = ({ variant }: ProjectsViewProps) => {
  const { catalogs } = useCatalogs();
  const { data: report } = useDashboardReport(EMPTY_QUERY);
  const { navigate } = useCrmActions();
  const [selectedSegment, setSelectedSegment] = useState<string>(ALL_SEGMENTS);
  const isMobile = variant === 'mobile';

  // Chỉ dự án đang hiển thị; dự án đã ẩn quản lý ở Cài đặt CRM.
  const activeProjects = useMemo(() => catalogs.projects.filter((project) => project.isActive), [catalogs.projects]);
  const interestedCounts = useMemo(() => toInterestedCounts(report.byProject), [report.byProject]);
  const visibleProjects = filterProjectsBySegment(activeProjects, selectedSegment);
  const segmentItems = [
    { value: ALL_SEGMENTS, label: 'Tất cả phân khúc', count: activeProjects.length },
    ...getProjectSegments(activeProjects).map((segment) => ({
      value: segment,
      label: segment,
      count: activeProjects.filter((project) => project.segment.trim() === segment).length,
    })),
  ];

  const bookVisit = () => navigate('create_appointment');
  const bookButton = (
    <button type="button" onClick={bookVisit} className={`${BUTTON_PRIMARY_LG_CLASS} ${isMobile ? 'h-11 w-full' : ''}`}>
      <CalendarPlus size={18} aria-hidden="true" />
      Đặt lịch xem sa bàn
    </button>
  );

  return (
    <div className={`flex w-full flex-col ${isMobile ? 'gap-4' : 'gap-6'}`}>
      <header
        className={`flex flex-col gap-2 border-b border-gray-200 dark:border-white/[0.05] ${
          isMobile ? 'pb-4' : 'pb-6 md:flex-row md:items-end md:justify-between md:gap-6'
        }`}
      >
        <div className="min-w-0 space-y-2">
          <h2 className={`font-semibold text-gray-800 dark:text-white/90 ${isMobile ? 'text-xl' : 'text-title-sm'}`}>
            Quản lý dự án BĐS
          </h2>
          <p className="max-w-2xl text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Danh sách dự án có sẵn để chọn khi nhập hồ sơ khách, kèm số khách đang quan tâm.
          </p>
        </div>
        <div className={`flex flex-wrap gap-2 ${isMobile ? 'pt-2' : 'shrink-0'}`}>
          <button type="button" onClick={() => navigate('settings')} className={`${BUTTON_OUTLINE_CLASS} ${isMobile ? 'h-11 w-full justify-center' : ''}`}>
            <Settings2 size={18} aria-hidden="true" />
            Quản lý danh mục
          </button>
          {bookButton}
        </div>
      </header>

      {/* Lọc phân khúc: tab viên thuốc có số đếm (Admin chưa có — làm mới bằng token Admin) */}
      <div
        role="group"
        aria-label="Lọc theo phân khúc"
        className={`flex gap-2 overflow-x-auto pb-1 ${isMobile ? '-mx-4 px-4' : 'flex-wrap'}`}
      >
        {segmentItems.map((item) => {
          const isActive = item.value === selectedSegment;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => setSelectedSegment(item.value)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                isActive ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS
              }`}
            >
              {item.label}
              <span
                className={`rounded-full px-1.5 text-xs ${
                  isActive
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      <p className="sr-only" aria-live="polite">
        Đang hiển thị {visibleProjects.length} dự án
      </p>

      {visibleProjects.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-theme-sm text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
          Chưa có dự án nào. Thêm dự án ở Cài đặt CRM.
        </p>
      )}

      <div className={isMobile ? 'space-y-4' : 'grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3'}>
        {visibleProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            interestedCount={interestedCounts.get(project.id) ?? 0}
            onBookVisit={bookVisit}
          />
        ))}
      </div>
    </div>
  );
};
