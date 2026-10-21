/**
 * Hàm thuần cho màn "Quản lý dự án": phân khúc, màu chip trạng thái, đếm khách quan tâm theo dự án.
 */
import type { Customer, Project } from '@crm/types/crm';

export const ALL_SEGMENTS = 'all';

/** Phân khúc lấy từ dữ liệu (giữ thứ tự xuất hiện) — nguồn Stitch liệt kê cứng và thiếu "Đô thị sinh thái". */
export const getProjectSegments = (projects: readonly Project[]): string[] =>
  Array.from(new Set(projects.map((project) => project.segment)));

export const filterProjectsBySegment = (projects: readonly Project[], segment: string): Project[] =>
  segment === ALL_SEGMENTS ? [...projects] : projects.filter((project) => project.segment === segment);

export type ProjectStatusTone = 'success' | 'warning' | 'neutral';

/** "Đang mở bán…" -> success, "Sắp…" -> warning, còn lại (vận hành, bàn giao…) -> neutral. */
export const getProjectStatusTone = (status: string): ProjectStatusTone => {
  const normalized = status.toLowerCase();
  if (normalized.includes('mở bán')) return 'success';
  if (normalized.startsWith('sắp')) return 'warning';
  return 'neutral';
};

/** Số khách đang quan tâm từng dự án (theo tên ngắn `Project.name`). */
export const countInterestedCustomers = (customers: readonly Pick<Customer, 'interestedProjects'>[]): Map<string, number> => {
  const counts = new Map<string, number>();
  customers.forEach((customer) =>
    customer.interestedProjects.forEach((projectName) => counts.set(projectName, (counts.get(projectName) ?? 0) + 1)),
  );
  return counts;
};
