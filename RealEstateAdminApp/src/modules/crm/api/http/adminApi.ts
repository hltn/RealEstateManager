/**
 * API quản trị (chỉ Quản trị): người dùng, nhóm, danh mục, dự án, thẻ, cài đặt (05 §2.2, §2.7, §2.8, §2.14).
 */
import type { AccountRole, AdminUser, CrmSettings, Project, TeamMember } from '@crm/types/crm';
import type { Paginated } from '../types';
import type { CrmSettingsDto, ProjectDto, TeamMemberDto, UserDto } from './dto';
import { crmHttp } from './crmHttp';
import { toCrmSettings, toProject, toTeamMember, userDtoToUser } from './catalogMappers';
import { fetchAllPages } from './catalogApi';

export type CatalogEndpoint = 'customer-statuses' | 'lead-sources' | 'contact-results' | 'areas';

export const createCatalogItem = (endpoint: CatalogEndpoint, body: Record<string, unknown>): Promise<unknown> => crmHttp.post(`/crm/${endpoint}`, body);
export const updateCatalogItem = (endpoint: CatalogEndpoint, id: string, body: Record<string, unknown>): Promise<unknown> => crmHttp.patch(`/crm/${endpoint}/${encodeURIComponent(id)}`, body);
export const deleteCatalogItem = (endpoint: CatalogEndpoint, id: string): Promise<void> => crmHttp.del(`/crm/${endpoint}/${encodeURIComponent(id)}`);

export const createTag = (body: { name: string; category: string }): Promise<{ id: string; label: string; category: string }> => crmHttp.post('/crm/tags', body);

// --- Dự án --------------------------------------------------------------------------------------------------------------

export type ProjectBody = Partial<{
  name: string;
  code: string;
  developer: string | null;
  location: string | null;
  areaId: string | null;
  propertyTypes: string[];
  priceFrom: number | null;
  priceTo: number | null;
  status: 'UPCOMING' | 'SELLING' | 'SOLD_OUT';
  description: string | null;
  isActive: boolean;
}>;

export const postProject = async (body: ProjectBody): Promise<Project> => toProject(await crmHttp.post<ProjectDto>('/crm/projects', body));
export const patchProject = async (id: string, body: ProjectBody): Promise<Project> => toProject(await crmHttp.patch<ProjectDto>(`/crm/projects/${encodeURIComponent(id)}`, body));
export const deleteProject = (id: string): Promise<void> => crmHttp.del(`/crm/projects/${encodeURIComponent(id)}`);
export const postProjectRestoration = async (projectId: string): Promise<Project> => toProject(await crmHttp.post<ProjectDto>('/crm/project-restorations', { projectId }));

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
