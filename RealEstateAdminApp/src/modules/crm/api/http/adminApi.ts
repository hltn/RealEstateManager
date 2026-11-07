/**
 * API quản trị (chỉ Quản trị): người dùng, nhóm, danh mục, dự án, thẻ, cài đặt (05 §2.2, §2.7, §2.8, §2.14).
 */
import type { AccountRole, AdminPersonaField, AdminTag, AdminUser, CrmSettings, PersonaFieldType, PersonaOptionItem, Project, TagCategory, TeamMember } from '@crm/types/crm';
import type { Paginated } from '../types';
import type { CrmSettingsDto, PersonaFieldDto, ProjectDto, TagDto, TeamMemberDto, UserDto } from './dto';
import { crmHttp } from './crmHttp';
import { toCrmSettings, toProject, toTeamMember, userDtoToUser } from './catalogMappers';
import { fetchAllPages } from './catalogApi';
import { requireServerCatalogId, type CatalogKind } from './catalogIds';

export type CatalogEndpoint = 'customer-statuses' | 'lead-sources' | 'contact-results' | 'areas';

const CATALOG_KINDS: Record<CatalogEndpoint, CatalogKind> = { 'customer-statuses': 'statuses', 'lead-sources': 'leadSources', 'contact-results': 'contactResults', areas: 'areas' };

/**
 * FR-40: id của UI là `code`, nhưng URL quản trị (`/crm/<danh mục>/:id`) và `parentId` của khu vực vẫn cần ObjectId -> đổi qua bảng tra
 * (bản ghi chưa migrate: id vốn đã là ObjectId nên giữ nguyên).
 */
const toCatalogBody = (endpoint: CatalogEndpoint, body: Record<string, unknown>): Record<string, unknown> =>
  endpoint === 'areas' && typeof body.parentId === 'string' && body.parentId ? { ...body, parentId: requireServerCatalogId('areas', body.parentId) } : body;

export const createCatalogItem = (endpoint: CatalogEndpoint, body: Record<string, unknown>): Promise<unknown> => crmHttp.post(`/crm/${endpoint}`, toCatalogBody(endpoint, body));
export const updateCatalogItem = (endpoint: CatalogEndpoint, id: string, body: Record<string, unknown>): Promise<unknown> =>
  crmHttp.patch(`/crm/${endpoint}/${encodeURIComponent(requireServerCatalogId(CATALOG_KINDS[endpoint], id))}`, toCatalogBody(endpoint, body));
export const deleteCatalogItem = (endpoint: CatalogEndpoint, id: string): Promise<void> => crmHttp.del(`/crm/${endpoint}/${encodeURIComponent(requireServerCatalogId(CATALOG_KINDS[endpoint], id))}`);

export const createTag = (body: { name: string; category: string }): Promise<{ id: string; label: string; category: string }> => crmHttp.post('/crm/tags', body);

// --- Thẻ (Quản trị, FR-42) ----------------------------------------------------------------------------------------------

const toAdminTag = (dto: TagDto): AdminTag => ({ id: dto.id, name: dto.label, category: dto.category, usageCount: dto.usageCount, color: dto.color ?? null });

/** `GET /crm/tags` (gom mọi trang, theo tên): có `usageCount` và `color` mà danh mục chung (`fetchTags`) không cần. */
export const fetchAdminTags = async (signal?: AbortSignal): Promise<AdminTag[]> => (await fetchAllPages<TagDto>('/crm/tags', { sort: 'name' }, signal)).map(toAdminTag);

/** Sửa thẻ: chỉ gửi field đổi. `color: null` = bỏ màu. Trùng tên trong cùng nhóm -> 409 `CATALOG_DUPLICATED`. */
export interface TagPatchBody {
  name?: string;
  category?: TagCategory;
  color?: string | null;
}

/** `PATCH /crm/tags/:id` (Quản trị). */
export const patchTag = async (id: string, body: TagPatchBody): Promise<AdminTag> => toAdminTag(await crmHttp.patch<TagDto>(`/crm/tags/${encodeURIComponent(id)}`, body));
/** `PATCH /crm/tags/:id` với `mergeIntoId` (không đi kèm field khác; chỉ gộp thẻ cùng nhóm). Trả thẻ đích. */
export const mergeTag = async (id: string, mergeIntoId: string): Promise<AdminTag> => toAdminTag(await crmHttp.patch<TagDto>(`/crm/tags/${encodeURIComponent(id)}`, { mergeIntoId }));
/** `DELETE /crm/tags/:id` (xóa mềm, gỡ thẻ khỏi mọi khách; 204). */
export const deleteTag = (id: string): Promise<void> => crmHttp.del(`/crm/tags/${encodeURIComponent(id)}`);

// --- Trường chân dung (Quản trị, FR-41) -----------------------------------------------------------------------------------

export const toAdminPersonaField = (dto: PersonaFieldDto): AdminPersonaField => ({
  id: dto.id,
  key: dto.key,
  label: dto.label,
  groupCode: dto.groupCode,
  type: dto.type,
  options: dto.options.map((option) => ({ value: option.value, label: option.label, isActive: option.isActive })),
  order: dto.order,
  isSystem: dto.isSystem,
  isActive: dto.isActive,
});

/** `GET /crm/persona-fields` (gom mọi trang, `limit` 100 là mức tối đa của máy chủ): có cả trường đã tắt, theo thứ tự `order`. */
export const fetchAdminPersonaFields = async (signal?: AbortSignal): Promise<AdminPersonaField[]> => (await fetchAllPages<PersonaFieldDto>('/crm/persona-fields', {}, signal)).map(toAdminPersonaField);

/**
 * Sửa trường: chỉ gửi phần đổi. `options` là DANH SÁCH MONG MUỐN: lựa chọn không có trong danh sách bị TẮT (không xóa); đổi nhãn giữ
 * `value`; tắt hết hoặc trùng `value` -> 400 `VALIDATION_FAILED`; tổng lựa chọn (kể cả đã tắt) tối đa 100, mỗi lần gửi tối đa 50.
 */
export interface PersonaFieldPatchBody {
  label?: string;
  options?: PersonaOptionItem[];
  isActive?: boolean;
}

/** `PATCH /crm/persona-fields/:id` (Quản trị). */
export const patchPersonaField = async (id: string, body: PersonaFieldPatchBody): Promise<AdminPersonaField> =>
  toAdminPersonaField(await crmHttp.patch<PersonaFieldDto>(`/crm/persona-fields/${encodeURIComponent(id)}`, body));

/**
 * Thêm trường (`POST /crm/persona-fields`, Quản trị): `key` bất biến sau khi tạo (`^[a-z][a-z0-9_]{0,39}$`, trùng kể cả trường đã xóa
 * -> 409 `CATALOG_DUPLICATED`); `order` do backend gán (cuối danh sách). SELECT/MULTI_SELECT bắt buộc `options`, kiểu khác không có.
 * `isFilterable` chỉ với TEXT/SELECT/MULTI_SELECT/BOOLEAN và không đi cùng `isSensitive` (400 `VALIDATION_FAILED`).
 */
export interface PersonaFieldCreateBody {
  key: string;
  label: string;
  groupCode: string;
  type: PersonaFieldType;
  options?: PersonaOptionItem[];
  weight?: number;
  isFilterable?: boolean;
  isSensitive?: boolean;
}

export const postPersonaField = async (body: PersonaFieldCreateBody): Promise<AdminPersonaField> => toAdminPersonaField(await crmHttp.post<PersonaFieldDto>('/crm/persona-fields', body));

/** `DELETE /crm/persona-fields/:id` (xóa mềm, 204). Trường hệ thống -> 409 `PERSONA_FIELD_SYSTEM`. */
export const deletePersonaField = (id: string): Promise<void> => crmHttp.del(`/crm/persona-fields/${encodeURIComponent(id)}`);

export interface PersonaFieldOrderItem {
  id: string;
  order: number;
  /** Chuyển sang nhóm khác (T-63 chưa dùng). */
  groupCode?: string;
}

/** `PUT /crm/persona-fields/order`: trả TOÀN BỘ trường theo thứ tự mới. */
export const putPersonaFieldOrder = async (items: PersonaFieldOrderItem[]): Promise<AdminPersonaField[]> =>
  (await crmHttp.put<PersonaFieldDto[]>('/crm/persona-fields/order', { items })).map(toAdminPersonaField);

// --- Dự án --------------------------------------------------------------------------------------------------------------

export type ProjectBody = Partial<{
  name: string;
  code: string;
  developer: string | null;
  location: string | null;
  /** Mã khu vực (FR-40, ưu tiên); `areaId` chỉ dùng cho ObjectId cũ. */
  areaCode: string | null;
  areaId: string | null;
  /** `value` lựa chọn trường `property_type` (FR-46). */
  propertyTypeCodes: string[];
  priceFrom: number | null;
  priceTo: number | null;
  status: 'UPCOMING' | 'SELLING' | 'SOLD_OUT';
  description: string | null;
  isActive: boolean;
}>;

export const postProject = async (body: ProjectBody): Promise<Project> => toProject(await crmHttp.post<ProjectDto>('/crm/projects', body));
export const patchProject = async (id: string, body: ProjectBody): Promise<Project> =>
  toProject(await crmHttp.patch<ProjectDto>(`/crm/projects/${encodeURIComponent(requireServerCatalogId('projects', id))}`, body));
export const deleteProject = (id: string): Promise<void> => crmHttp.del(`/crm/projects/${encodeURIComponent(requireServerCatalogId('projects', id))}`);
export const postProjectRestoration = async (projectId: string): Promise<Project> =>
  toProject(await crmHttp.post<ProjectDto>('/crm/project-restorations', { projectId: requireServerCatalogId('projects', projectId) }));

// --- Người dùng, nhóm ---------------------------------------------------------------------------------------------------

/** `GET /users` trả `{ data, meta }`. Bỏ tài khoản chỉ có EDITOR (không dùng CRM). */
export const fetchAllUsers = async (signal?: AbortSignal): Promise<AdminUser[]> => (await fetchAllPages<UserDto>('/users', {}, signal)).filter((user) => user.role !== 'EDITOR').map(userDtoToUser);

/**
 * Tạo tài khoản: gửi `roles[]` + `teamIds[]` (nhóm chọn đầu tiên = nhóm chính). Không gửi kèm `role`/`teamId` đơn để khỏi
 * lệch (role ≠ role cao nhất / teamId ≠ teamIds[0] -> 400 VALIDATION_FAILED).
 */
export const postUser = async (body: { email: string; password: string; displayName: string; roles: AccountRole[]; teamIds?: string[] }): Promise<AdminUser> =>
  userDtoToUser(await crmHttp.raw<UserDto>('post', '/users', body));
export const patchUserStatus = async (id: string, status: 'ACTIVE' | 'BLOCKED'): Promise<AdminUser> => userDtoToUser(await crmHttp.raw<UserDto>('patch', `/users/${encodeURIComponent(id)}/status`, { status }));
/** `PATCH /users/:id/roles` (ADMIN) trả user trần. Bỏ MANAGER/STAFF cuối cùng -> backend tự xóa nhóm; bỏ ADMIN cuối cùng -> 409. */
export const patchUserRoles = async (id: string, roles: AccountRole[]): Promise<AdminUser> => userDtoToUser(await crmHttp.raw<UserDto>('patch', `/users/${encodeURIComponent(id)}/roles`, { roles }));
/** `PATCH /users/:id/teams` (ADMIN) trả `{ data: user }`. Chỉ user có MANAGER/STAFF mới có nhóm (400 nếu không); `[]` = gỡ mọi nhóm. */
export const patchUserTeams = async (id: string, teamIds: string[]): Promise<AdminUser> => userDtoToUser((await crmHttp.raw<{ data: UserDto }>('patch', `/users/${encodeURIComponent(id)}/teams`, { teamIds })).data);

export const postTeam = (body: { name: string; code: string; managerIds?: string[] }): Promise<unknown> => crmHttp.post('/teams', body);
export const patchTeam = (id: string, body: { name?: string; managerIds?: string[]; isActive?: boolean }): Promise<unknown> => crmHttp.patch(`/teams/${encodeURIComponent(id)}`, body);
export const deleteTeam = (id: string): Promise<void> => crmHttp.del(`/teams/${encodeURIComponent(id)}`);

// --- Thành viên nhóm ----------------------------------------------------------------------------------------------------

export interface TeamMembersQuery {
  page: number;
  limit: number;
  q?: string;
}

/** `GET /teams/:id/members` -> `{ data, meta }`. Quản trị xem mọi nhóm; Quản lý chỉ nhóm mình quản lý (nhóm khác 403). */
export const fetchTeamMembers = async (teamId: string, query: TeamMembersQuery, signal?: AbortSignal): Promise<Paginated<TeamMember>> => {
  const result = await crmHttp.list<TeamMemberDto>(`/teams/${encodeURIComponent(teamId)}/members`, { params: { page: query.page, limit: query.limit, q: query.q?.trim() || undefined }, signal });
  return { data: result.data.map(toTeamMember), meta: result.meta };
};

/** `POST /teams/:id/members` (Quản trị; idempotent). 400 nếu user không có MANAGER/STAFF; 404 nếu nhóm không có/đã tắt hoặc user không có. */
export const postTeamMember = async (teamId: string, userId: string): Promise<TeamMember> => toTeamMember(await crmHttp.post<TeamMemberDto>(`/teams/${encodeURIComponent(teamId)}/members`, { userId }));

/** `DELETE /teams/:id/members/:userId` (Quản trị; idempotent, 204). KHÔNG đổi `managerIds` của nhóm. */
export const deleteTeamMember = (teamId: string, userId: string): Promise<void> => crmHttp.del(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);

export const patchCrmSettings = async (body: Partial<CrmSettings>): Promise<CrmSettings> => toCrmSettings(await crmHttp.patch<CrmSettingsDto>('/crm/settings', body));

export type { Paginated };
