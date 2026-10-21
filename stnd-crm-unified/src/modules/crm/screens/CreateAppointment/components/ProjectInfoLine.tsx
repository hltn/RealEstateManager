/** Dòng tóm tắt dự án dưới ô chọn dự án (phân khúc • khoảng giá • trạng thái mở bán) - theo Admin Stitch. */
import { CHIP_SMALL_CLASS } from '@crm/lib/uiClasses';
import { findProject } from '../createAppointmentForm';

interface ProjectInfoLineProps {
  projectName: string;
}

export const ProjectInfoLine = ({ projectName }: ProjectInfoLineProps) => {
  const project = findProject(projectName);
  if (!project) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`${CHIP_SMALL_CLASS} bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300`}>{project.segment}</span>
      <span>Khoảng giá: {project.price}</span>
      <span aria-hidden="true">•</span>
      <span className="font-medium text-success-600 dark:text-success-500">{project.status}</span>
    </span>
  );
};
