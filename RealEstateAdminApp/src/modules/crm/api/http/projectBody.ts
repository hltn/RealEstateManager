/**
 * Dự án (UI) -> body `POST/PATCH /crm/projects` (05 §2.8). Backend dùng `forbidNonWhitelisted`: chỉ gửi trường nó nhận
 * (không có tên đầy đủ, đơn vị giá, phân khúc). `isActive` chỉ có ở PATCH. Chuỗi rỗng -> `null` (xóa giá trị).
 */
import type { Project } from '@crm/types/crm';
import { refParam } from './catalogIds';
import type { ProjectBody } from './adminApi';

/**
 * - `isCreate`: POST (có `code`, không có `isActive`; luôn gửi `propertyTypeCodes`).
 * - Sửa (PATCH): KHÔNG gửi `code` (Q1: mã bất biến; gửi lại có thể đổi hoa/thường ngoài ý muốn).
 * - `shouldSendPropertyTypes`: chỉ gửi `propertyTypeCodes` khi người dùng đã đụng tới ô Loại hình, vì backend thay toàn bộ loại hình
 *   và XÓA `unmappedPropertyTypes` mỗi khi nhận mảng này (FR-46).
 */
export const toProjectBody = (project: Project, options: { isCreate?: boolean; shouldSendPropertyTypes?: boolean } = {}): ProjectBody => ({
  name: project.name.trim(),
  ...(options.isCreate ? { code: project.code.trim() } : {}),
  developer: project.developer.trim() || null,
  location: project.location.trim() || null,
  // FR-40: `areaId` của UI = `code` khu vực -> `areaCode` (ObjectId cũ vẫn gửi `areaId`).
  ...refParam('areaCode', 'areaId', project.areaId),
  // FR-46: gửi MÃ lựa chọn (không gửi nhãn) nên đổi tên lựa chọn không làm hỏng dự án.
  ...(options.isCreate || options.shouldSendPropertyTypes ? { propertyTypeCodes: project.propertyTypeCodes ?? [] } : {}),
  priceFrom: project.priceFrom,
  priceTo: project.priceTo,
  ...(project.status ? { status: project.status } : {}),
  ...(options.isCreate ? {} : { isActive: project.isActive }),
});
