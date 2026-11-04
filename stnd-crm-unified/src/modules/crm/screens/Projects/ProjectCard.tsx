import { ArrowRight, Building2, MapPin, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { formatProjectPrice, PROJECT_STATUS_LABELS } from '@crm/lib/projectRules';
import type { Project } from '@crm/types/crm';
import { CARD_CLASS } from '@crm/lib/uiClasses';
import { getProjectStatusTone, type ProjectStatusTone } from './projectCatalog';

/** Chip trạng thái theo mẫu Admin (`UserManagementScreen.tsx:298-311`): nền nhạt + chấm màu, token success/warning/gray. */
const STATUS_CHIP_CLASS: Record<ProjectStatusTone, { chip: string; dot: string }> = {
  success: { chip: 'bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500', dot: 'bg-success-500' },
  warning: { chip: 'bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-500', dot: 'bg-warning-500' },
  neutral: { chip: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', dot: 'bg-gray-400' },
};

const CARD_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5';

interface ProjectCardProps {
  project: Project;
  interestedCount: number;
  onBookVisit: (project: Project) => void;
  /** Chỉ truyền khi người dùng được quản lý dự án (Quản trị). */
  onEdit?: (project: Project) => void;
  onDelete?: (project: Project) => void;
  /** Khôi phục dự án đã xoá mềm (Quản trị). */
  onRestore?: (project: Project) => void;
}

/** Thẻ dự án (Stitch dùng khối gradient slate/indigo; ở đây theo mẫu "Thẻ" Admin + ô số liệu). */
export const ProjectCard = ({ project, interestedCount, onBookVisit, onEdit, onDelete, onRestore }: ProjectCardProps) => {
  const status = STATUS_CHIP_CLASS[getProjectStatusTone(project.status)];

  return (
    <article className={`${CARD_CLASS} flex h-full flex-col p-4 transition-colors hover:border-brand-300 sm:p-5 dark:hover:border-brand-500/30`}>
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
          <Building2 size={24} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold leading-tight text-gray-800 dark:text-white/90">{project.name}</h3>
          <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
            {[project.code, project.developer].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 flex items-center gap-1 text-theme-sm text-gray-500 dark:text-gray-400">
            <MapPin size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{project.location || 'Chưa có địa chỉ'}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {project.deletedAt ? (
          <span className="inline-flex items-center rounded-full bg-error-50 px-2.5 py-1 text-xs font-medium text-error-600 dark:bg-error-500/10 dark:text-error-400">Đã xoá</span>
        ) : (
          !project.isActive && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              Ngừng hoạt động
            </span>
          )
        )}
        {project.propertyTypes.map((type) => (
          <span key={type} className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            {type}
          </span>
        ))}
        {project.segment && (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {project.segment}
          </span>
        )}
        {project.status && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${status.chip}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {PROJECT_STATUS_LABELS[project.status]}
          </span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
          <dt className="text-theme-xs text-gray-500 dark:text-gray-400">Khoảng giá</dt>
          <dd className="mt-0.5 text-sm font-semibold text-brand-600 dark:text-brand-400">{formatProjectPrice(project) || 'Chưa cập nhật'}</dd>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
          <dt className="text-theme-xs text-gray-500 dark:text-gray-400">Khách quan tâm</dt>
          <dd className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-white/90">{interestedCount} khách</dd>
        </div>
      </dl>

      {/* mt-auto: dồn hàng nút xuống đáy để các thẻ cùng hàng thẳng nhau */}
      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-4 dark:border-white/[0.05]">
          {project.deletedAt && onRestore && (
            <button type="button" onClick={() => onRestore(project)} aria-label={`Khôi phục dự án ${project.name}`} className={CARD_ACTION_CLASS}>
              <RotateCcw size={14} aria-hidden="true" />
              Khôi phục
            </button>
          )}
          {!project.deletedAt && onEdit && (
            <button type="button" onClick={() => onEdit(project)} aria-label={`Sửa dự án ${project.name}`} className={CARD_ACTION_CLASS}>
              <Pencil size={14} aria-hidden="true" />
              Sửa
            </button>
          )}
          {!project.deletedAt && onDelete && (
            <button type="button" onClick={() => onDelete(project)} aria-label={`Xoá dự án ${project.name}`} className={`${CARD_ACTION_CLASS} text-error-500 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10`}>
              <Trash2 size={14} aria-hidden="true" />
              Xoá
            </button>
          )}
          <button
            type="button"
            onClick={() => onBookVisit(project)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-brand-500 transition-colors hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
          >
            Dẫn khách xem
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
};
