/**
 * Hàm thuần cho màn "Dự án" (catalog — đọc CHUNG danh mục `catalogs.projects` với form khách/Cài đặt).
 */
import type { BreakdownItem } from '@crm/api';
import type { Project } from '@crm/types/crm';

export const ALL_SEGMENTS = 'all';

/** Phân khúc lấy từ dữ liệu (giữ thứ tự xuất hiện, bỏ trống). */
export const getProjectSegments = (projects: readonly Project[]): string[] =>
  Array.from(new Set(projects.map((project) => project.segment.trim()).filter(Boolean)));

export const filterProjectsBySegment = (projects: readonly Project[], segment: string): Project[] =>
  segment === ALL_SEGMENTS ? [...projects] : projects.filter((project) => project.segment.trim() === segment);

export type ProjectStatusTone = 'success' | 'warning' | 'neutral';

/** "Đang mở bán…" -> success, "Sắp…" -> warning, còn lại (vận hành, bàn giao, trống…) -> neutral. */
export const getProjectStatusTone = (statusLabel: string): ProjectStatusTone => {
  const normalized = statusLabel.trim().toLowerCase();
  // "Sắp mở bán" cũng chứa "mở bán" -> xét "sắp" trước.
  if (normalized.startsWith('sắp')) return 'warning';
  if (normalized.includes('mở bán')) return 'success';
  return 'neutral';
};

/** Số khách đang quan tâm theo id dự án — lấy từ phân bổ dashboard theo dự án (đã áp phạm vi quyền). */
export const toInterestedCounts = (byProject: readonly BreakdownItem[]): Map<string, number> =>
  new Map(byProject.map((item) => [item.key.id, item.count]));
