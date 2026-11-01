/**
 * Tab "Dự án" của Cài đặt: danh sách + thêm/sửa/ngừng hoạt động dự án (Quản trị). Dùng chung hộp thoại và API với màn Dự án
 * (`POST/PATCH /crm/projects`); xóa mềm/khôi phục làm ở màn Dự án.
 */
import { useState } from 'react';
import { EyeOff, Pencil, Plus } from 'lucide-react';
import { useCatalogs, useCrmApi, useProjectsWithCounts } from '@crm/api';
import { PROJECT_STATUS_LABELS } from '@crm/lib/projectRules';
import { BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { Project } from '@crm/types/crm';
import { ProjectFormDialog } from '../../Projects/ProjectFormDialog';

export const ProjectsCatalogSection = () => {
  const { catalogs } = useCatalogs();
  const { data: counts } = useProjectsWithCounts();
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  /** `undefined` = đóng; `null` = thêm mới; Project = sửa. */
  const [formTarget, setFormTarget] = useState<Project | null | undefined>(undefined);
  const projects = [...catalogs.projects].sort((first, second) => Number(second.isActive) - Number(first.isActive) || first.name.localeCompare(second.name, 'vi'));

  const toggleActive = async (project: Project) => {
    const result = await api.updateProject(project.id, { isActive: !project.isActive });
    showToast(result.ok ? { title: project.isActive ? `Đã ngừng hoạt động "${project.name}"` : `Đã dùng lại "${project.name}"` } : { type: 'error', title: result.error.message });
  };

  return (
    <section className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>Danh mục dự án dùng chung cho hồ sơ khách, lịch hẹn và màn Dự án. Dự án còn khách chỉ được ngừng hoạt động, không xoá.</p>
        <button type="button" onClick={() => setFormTarget(null)} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start`}>
          <Plus size={16} aria-hidden="true" />
          Thêm
        </button>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
        {projects.map((project) => (
          <li key={project.id} className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${project.isActive ? '' : 'opacity-60'}`}>
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800 dark:text-white/90">
                {project.name}
                {!project.isActive && (
                  <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>
                    <EyeOff size={12} aria-hidden="true" />
                    Đã ngừng
                  </span>
                )}
              </p>
              <span className="text-theme-xs text-gray-500 dark:text-gray-400">{[project.code, project.status ? PROJECT_STATUS_LABELS[project.status] : ''].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">{counts.get(project.id) ?? 0} khách</span>
              <button type="button" onClick={() => void toggleActive(project)} className={BUTTON_SOFT_SM_CLASS} aria-label={`${project.isActive ? 'Ngừng' : 'Dùng lại'} ${project.name}`}>
                {project.isActive ? 'Ngừng' : 'Dùng lại'}
              </button>
              <button type="button" onClick={() => setFormTarget(project)} className={BUTTON_SOFT_SM_CLASS} aria-label={`Sửa ${project.name}`}>
                <Pencil size={12} aria-hidden="true" />
                Sửa
              </button>
            </div>
          </li>
        ))}
      </ul>
      {formTarget !== undefined && <ProjectFormDialog project={formTarget} onClose={() => setFormTarget(undefined)} />}
    </section>
  );
};
