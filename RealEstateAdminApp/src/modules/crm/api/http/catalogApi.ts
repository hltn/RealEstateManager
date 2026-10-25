/**
 * Gọi API danh mục, người dùng, nhóm, cài đặt (05 §2.2, §2.7, §2.8, §2.14). Trả về kiểu UI (đã qua mapper).
 * Danh mục nhỏ tải 1 lần (04 §7.6): gom nhiều trang (mỗi trang tối đa 100) tới giới hạn an toàn.
 */
import type { Area, CatalogItem, ContactResult, CrmSettings, CrmUser, CustomerStatusItem, PersonaFieldDefinition, Project, Tag, Team } from '@crm/types/crm';
import type { AreaDto, AssignableUserDto, ContactResultDto, CrmSettingsDto, CustomerStatusDto, LeadSourceDto, PersonaFieldDto, ProjectDto, TagDto, TeamDto } from './dto';
import { crmHttp, type QueryParams } from './crmHttp';
import { assignableToUser, toArea, toCatalogItem, toContactResult, toCrmSettings, toPersonaField, toProject, toStatusItem, toTag, toTeam } from './catalogMappers';

const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

/** Gom tất cả trang của một danh sách (dừng khi hết trang hoặc chạm giới hạn an toàn). */
export const fetchAllPages = async <T>(url: string, params: QueryParams = {}, signal?: AbortSignal): Promise<T[]> => {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await crmHttp.list<T>(url, { params: { ...params, page, limit: PAGE_LIMIT }, signal });
    items.push(...result.data);
    if (page >= result.meta.totalPages) break;
  }
  return items;
};

export const fetchStatuses = async (signal?: AbortSignal): Promise<CustomerStatusItem[]> => (await fetchAllPages<CustomerStatusDto>('/crm/customer-statuses', {}, signal)).map(toStatusItem);
export const fetchLeadSources = async (signal?: AbortSignal): Promise<CatalogItem[]> => (await fetchAllPages<LeadSourceDto>('/crm/lead-sources', {}, signal)).map(toCatalogItem);
export const fetchContactResults = async (signal?: AbortSignal): Promise<ContactResult[]> => (await fetchAllPages<ContactResultDto>('/crm/contact-results', {}, signal)).map(toContactResult);
export const fetchAreas = async (signal?: AbortSignal): Promise<Area[]> => (await fetchAllPages<AreaDto>('/crm/areas', {}, signal)).map(toArea);
/** `isDeleted` chỉ Quản trị (xem dự án đã xóa mềm). */
export const fetchProjects = async (options: { isDeleted?: boolean } = {}, signal?: AbortSignal): Promise<Project[]> =>
  (await fetchAllPages<ProjectDto>('/crm/projects', { isDeleted: options.isDeleted, sort: 'name' }, signal)).map(toProject);
export const fetchTags = async (signal?: AbortSignal): Promise<Tag[]> => (await fetchAllPages<TagDto>('/crm/tags', { sort: '-usageCount' }, signal)).map(toTag);
export const fetchPersonaFields = async (signal?: AbortSignal): Promise<PersonaFieldDefinition[]> =>
  (await fetchAllPages<PersonaFieldDto>('/crm/persona-fields', {}, signal)).map(toPersonaField);

/** Người có thể phân chăm sóc (Quản trị: tất cả; Quản lý/Nhân viên: trong phạm vi nhóm). */
export const fetchAssignableUsers = async (signal?: AbortSignal): Promise<CrmUser[]> => (await fetchAllPages<AssignableUserDto>('/crm/assignable-users', {}, signal)).map(assignableToUser);

/** Nhóm: Quản trị và Quản lý (Nhân viên không gọi — 403). */
export const fetchTeams = async (signal?: AbortSignal): Promise<(Team & { code: string; memberCount: number; isActive: boolean })[]> =>
  (await fetchAllPages<TeamDto>('/teams', {}, signal)).map(toTeam);

/** Quản trị, Quản lý đọc được. */
export const fetchCrmSettings = async (signal?: AbortSignal): Promise<CrmSettings> => toCrmSettings(await crmHttp.get<CrmSettingsDto>('/crm/settings', { signal }));
