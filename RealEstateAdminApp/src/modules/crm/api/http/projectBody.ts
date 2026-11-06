/**
 * Dự án (UI) -> body `POST/PATCH /crm/projects` (05 §2.8). Backend dùng `forbidNonWhitelisted`: chỉ gửi trường nó nhận
 * (không có tên đầy đủ, đơn vị giá, phân khúc). `isActive` chỉ có ở PATCH. Chuỗi rỗng -> `null` (xóa giá trị).
 */
import type { Project } from '@crm/types/crm';
import { refParam } from './catalogIds';
import type { ProjectBody } from './adminApi';

export const toProjectBody = (project: Project, options: { isCreate?: boolean } = {}): ProjectBody => ({
  name: project.name.trim(),
  code: project.code.trim(),
  developer: project.developer.trim() || null,
  location: project.location.trim() || null,
  // FR-40: `areaId` của UI = `code` khu vực -> `areaCode` (ObjectId cũ vẫn gửi `areaId`).
  ...refParam('areaCode', 'areaId', project.areaId),
  // FR-46 (làm ở form loại hình): hiện vẫn gửi NHÃN, backend tự ánh xạ sang `propertyTypeCodes`.
  propertyTypes: project.propertyTypes,
  priceFrom: project.priceFrom,
  priceTo: project.priceTo,
  ...(project.status ? { status: project.status } : {}),
  ...(options.isCreate ? {} : { isActive: project.isActive }),
});
