/**
 * Màn "Quản lý dự án" dùng chung 2 biến thể:
 * - desktop/tablet: đầu trang Admin có nút + lưới thẻ 1/2/3 cột (md / xl).
 * - mobile: không có nguồn Stitch -> tự thiết kế: tiêu đề trong nội dung, chip phân khúc cuộn ngang, thẻ xếp dọc.
 *   Màn này có CrmBottomNav (CrmLayout đã chừa `pb-20`) nên không đặt gì `fixed bottom-0`.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus, Plus, Settings2 } from 'lucide-react';
import { canManageProjects, useCatalogs, useCatalogUsage, useCrmActor, useCrmApi, useDashboardReport } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { useCrmActions } from '@crm/store';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_LG_CLASS, OPTION_ACTIVE_CLASS, OPTION_IDLE_CLASS } from '@crm/lib/uiClasses';
import type { Project } from '@crm/types/crm';
import { ProjectCard } from './ProjectCard';
import { ProjectFormDialog } from './ProjectFormDialog';
import { ALL_SEGMENTS, filterProjectsBySegment, getProjectSegments, toInterestedCounts } from './projectCatalog';

const EMPTY_QUERY = {};

interface ProjectsViewProps {
  variant: 'desktop' | 'mobile';
}

export const ProjectsView = ({ variant }: ProjectsViewProps) => {
  const { catalogs } = useCatalogs();
  const { data: report } = useDashboardReport(EMPTY_QUERY);
  const { navigate, showToast } = useCrmActions();
  const api = useCrmApi();
  const actor = useCrmActor();
  const { data: usage } = useCatalogUsage('projects');
  const canManage = canManageProjects(actor.role);
  const [selectedSegment, setSelectedSegment] = useState<string>(ALL_SEGMENTS);
  const [shouldShowInactive, setShouldShowInactive] = useState(false);
  const [shouldShowDeleted, setShouldShowDeleted] = useState(false);
  /** `undefined` = đóng; `null` = thêm mới; Project = sửa. */
  const [formTarget, setFormTarget] = useState<Project | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const isMobile = variant === 'mobile';

  // Mặc định chỉ dự án đang hoạt động; Quản trị có thể bật xem cả dự án đã ngừng để sửa/dùng lại.
  const inactiveCount = useMemo(() => catalogs.projects.filter((project) => !project.isActive && !project.deletedAt).length, [catalogs.projects]);
  const deletedCount = useMemo(() => catalogs.projects.filter((project) => project.deletedAt).length, [catalogs.projects]);
  const activeProjects = useMemo(
    () =>
      catalogs.projects.filter((project) => {
        if (project.deletedAt) return canManage && shouldShowDeleted;
        return project.isActive || (canManage && shouldShowInactive);
      }),
    [catalogs.projects, canManage, shouldShowInactive, shouldShowDeleted],
  );
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
  const deleteUsage = deleteTarget ? (usage.get(deleteTarget.id) ?? 0) : 0;

  /**
   * Xác nhận trong hộp thoại: dự án còn khách -> không xoá được (409 PROJECT_IN_USE), gợi ý "Ngừng hoạt động" = `updateProject(isActive:false)`;
   * dự án đã ngừng sẵn thì chỉ báo; dự án không ai dùng -> xoá mềm.
   */
  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteUsage > 0 && !deleteTarget.isActive) {
      setDeleteTarget(null);
      return;
    }
    if (deleteUsage > 0) {
      const result = api.updateProject(deleteTarget.id, { isActive: false });
      showToast(
        result.ok
          ? { type: 'warning', title: `Đã chuyển "${deleteTarget.name}" sang ngừng hoạt động`, message: `Dự án đang được ${deleteUsage} khách quan tâm nên không xoá.` }
          : { type: 'error', title: result.error.message },
      );
      setDeleteTarget(null);
      return;
    }
    const result = api.deleteProject(deleteTarget.id);
    if (!result.ok) showToast({ type: 'error', title: result.error.message });
    else showToast({ title: `Đã xoá dự án "${deleteTarget.name}"`, message: 'Có thể khôi phục trong mục "Hiện dự án đã xoá".' });
    setDeleteTarget(null);
  };

  const restoreProject = (project: Project) => {
    const result = api.restoreProject(project.id);
    showToast(result.ok ? { title: `Đã khôi phục dự án "${project.name}"` } : { type: 'error', title: result.error.message });
  };
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
          {canManage && (
            <button type="button" onClick={() => setFormTarget(null)} className={`${BUTTON_PRIMARY_LG_CLASS} ${isMobile ? 'h-11 w-full' : ''}`}>
              <Plus size={18} aria-hidden="true" />
              Thêm dự án
            </button>
          )}
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

      {canManage && inactiveCount > 0 && (
        <label className="flex items-center gap-2 text-theme-sm text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={shouldShowInactive} onChange={(event) => setShouldShowInactive(event.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Hiện cả dự án ngừng hoạt động ({inactiveCount})
        </label>
      )}

      {canManage && deletedCount > 0 && (
        <label className="flex items-center gap-2 text-theme-sm text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={shouldShowDeleted} onChange={(event) => setShouldShowDeleted(event.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Hiện dự án đã xoá ({deletedCount})
        </label>
      )}

      <p className="sr-only" aria-live="polite">
        Đang hiển thị {visibleProjects.length} dự án
      </p>

      {visibleProjects.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-theme-sm text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
          {canManage ? 'Chưa có dự án nào. Bấm "Thêm dự án" để tạo dự án đầu tiên.' : 'Chưa có dự án nào.'}
        </p>
      )}

      <div className={isMobile ? 'space-y-4' : 'grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3'}>
        {visibleProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            interestedCount={interestedCounts.get(project.id) ?? 0}
            onBookVisit={bookVisit}
            onEdit={canManage ? setFormTarget : undefined}
            onDelete={canManage ? setDeleteTarget : undefined}
            onRestore={canManage ? restoreProject : undefined}
          />
        ))}
      </div>

      {formTarget !== undefined && <ProjectFormDialog project={formTarget} onClose={() => setFormTarget(undefined)} />}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={deleteUsage > 0 ? (deleteTarget?.isActive ? `Ngừng hoạt động "${deleteTarget?.name ?? ''}"?` : `Không thể xoá "${deleteTarget?.name ?? ''}"`) : `Xoá dự án "${deleteTarget?.name ?? ''}"?`}
        description={
          deleteUsage > 0
            ? deleteTarget?.isActive
              ? `Dự án đang được ${deleteUsage} khách quan tâm nên KHÔNG thể xoá. Bạn có thể chuyển sang ngừng hoạt động: ẩn khỏi lựa chọn mới, khách đã gắn vẫn giữ tham chiếu; bật lại bằng nút Sửa.`
              : `Dự án đã ngừng hoạt động sẵn và còn ${deleteUsage} khách tham chiếu nên không thể xoá.`
            : 'Dự án chưa có khách nào quan tâm nên sẽ được xoá (xoá mềm). Quản trị có thể khôi phục lại trong mục "Hiện dự án đã xoá".'
        }
        confirmLabel={deleteUsage > 0 ? (deleteTarget?.isActive ? 'Ngừng hoạt động' : 'Đã hiểu') : 'Xoá dự án'}
        tone="danger"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
};
