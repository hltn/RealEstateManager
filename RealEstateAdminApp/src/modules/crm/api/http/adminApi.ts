/**
 * API quản trị (chỉ Quản trị): người dùng, nhóm, danh mục, dự án, thẻ, cài đặt (05 §2.2, §2.7, §2.8, §2.14).
 */
import type { CrmSettings, CrmUser, Project } from '@crm/types/crm';
import type { Paginated } from '../types';
import type { CrmSettingsDto, ProjectDto, UserDto } from './dto';
import { crmHttp } from './crmHttp';
import { toCrmSettings, toProject, userDtoToUser } from './catalogMappers';
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

/** `GET /users` trả `{ data, meta }`. */
export const fetchAllUsers = async (signal?: AbortSignal): Promise<CrmUser[]> => (await fetchAllPages<UserDto>('/users', {}, signal)).filter((user) => user.role !== 'EDITOR').map(userDtoToUser);

export const postUser = async (body: { email: string; password: string; displayName: string; role: 'MANAGER' | 'STAFF' | 'ADMIN'; teamId?: string }): Promise<CrmUser> =>
  userDtoToUser(await crmHttp.raw<UserDto>('post', '/users', body));
export const patchUserStatus = async (id: string, status: 'ACTIVE' | 'BLOCKED'): Promise<CrmUser> => userDtoToUser(await crmHttp.raw<UserDto>('patch', `/users/${encodeURIComponent(id)}/status`, { status }));
export const patchUserRole = async (id: string, role: string): Promise<CrmUser> => userDtoToUser(await crmHttp.raw<UserDto>('patch', `/users/${encodeURIComponent(id)}/role`, { role }));
export const patchUserTeam = async (id: string, teamId: string | null): Promise<CrmUser> => userDtoToUser((await crmHttp.raw<{ data: UserDto }>('patch', `/users/${encodeURIComponent(id)}/team`, { teamId })).data);

export const postTeam = (body: { name: string; code: string; managerIds?: string[] }): Promise<unknown> => crmHttp.post('/teams', body);
export const patchTeam = (id: string, body: { name?: string; managerIds?: string[]; isActive?: boolean }): Promise<unknown> => crmHttp.patch(`/teams/${encodeURIComponent(id)}`, body);
export const deleteTeam = (id: string): Promise<void> => crmHttp.del(`/teams/${encodeURIComponent(id)}`);

export const patchCrmSettings = async (body: Partial<CrmSettings>): Promise<CrmSettings> => toCrmSettings(await crmHttp.patch<CrmSettingsDto>('/crm/settings', body));

export type { Paginated };
