/**
 * Màn "Quản lý dự án" dùng chung 2 biến thể:
 * - desktop/tablet: đầu trang Admin có nút + lưới thẻ 1/2/3 cột (md / xl).
 * - mobile: không có nguồn Stitch -> tự thiết kế: tiêu đề trong nội dung, chip phân khúc cuộn ngang, thẻ xếp dọc.
 *   Màn này có CrmBottomNav (CrmLayout đã chừa `pb-20`) nên không đặt gì `fixed bottom-0`.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { PROJECTS } from '@crm/data/mockData';
import { useCrmActions, useCrmState } from '@crm/store';
import type { Project } from '@crm/types/crm';
import { BUTTON_PRIMARY_LG_CLASS, OPTION_ACTIVE_CLASS, OPTION_IDLE_CLASS } from '@crm/lib/uiClasses';
import { ProjectCard } from './ProjectCard';
import { ALL_SEGMENTS, countInterestedCustomers, filterProjectsBySegment, getProjectSegments } from './projectCatalog';

const SEGMENTS = getProjectSegments(PROJECTS);

interface ProjectsViewProps {
  variant: 'desktop' | 'mobile';
}

export const ProjectsView = ({ variant }: ProjectsViewProps) => {
  const { customers } = useCrmState();
  const { navigate, showToast } = useCrmActions();
  const [selectedSegment, setSelectedSegment] = useState<string>(ALL_SEGMENTS);
  const isMobile = variant === 'mobile';

  const interestedCounts = useMemo(() => countInterestedCustomers(customers), [customers]);
  const visibleProjects = filterProjectsBySegment(PROJECTS, selectedSegment);
  const segmentItems = [
    { value: ALL_SEGMENTS, label: 'Tất cả phân khúc', count: PROJECTS.length },
    ...SEGMENTS.map((segment) => ({
      value: segment,
      label: segment,
      count: PROJECTS.filter((project) => project.segment === segment).length,
    })),
  ];

  const bookVisit = () => navigate('create_appointment');
  // TODO(đề xuất): thay toast bằng tải file thật khi có API tài liệu dự án.
  const downloadBrochure = (project: Project) =>
    showToast({
      type: 'info',
      title: `Đang chuẩn bị tài liệu ${project.fullName}`,
      message: 'Brochure & bảng giá sẽ tự tải xuống khi sẵn sàng.',
    });

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
            Danh mục dự án phân phối độc quyền và liên kết F1 trong hệ thống STND.
          </p>
        </div>
        <div className={isMobile ? 'pt-2' : 'shrink-0'}>{bookButton}</div>
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

      <div className={isMobile ? 'space-y-4' : 'grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3'}>
        {visibleProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            interestedCount={interestedCounts.get(project.name) ?? 0}
            onDownloadBrochure={downloadBrochure}
            onBookVisit={bookVisit}
          />
        ))}
      </div>
    </div>
  );
};
