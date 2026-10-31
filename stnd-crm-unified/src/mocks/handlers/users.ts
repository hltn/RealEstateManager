import { resolveActor } from '@crm/api/actor';
import { createCrmWriteApi, type CrmApi } from '@crm/api/crmWriteApi';
import { getDefaultCrmStore } from '@crm/store/crmStore';
import type { AccountRole, AdminUser } from '@crm/types/crm';
import { useAuthStore } from '../../stores/auth.store';
import type { UserListItem, UserRole } from '../../types/user';
import { highestRole, rolesOf } from '../../utils/userRoles';
import type { MockRoute, MockResponse } from '../types';
import { fail, filterBySearch, ok, paginate } from '../utils';
import { asRecord, readString } from './shared';

/**
 * [Prototype] `/users` — quản lý tài khoản (ADMIN). Dùng CHUNG dữ liệu với store CRM (`SEED_USERS`): vai trò/nhóm đổi ở đây hiện ngay ở
 * Cài đặt CRM và phạm vi dữ liệu, và ngược lại. Luật nghiệp vụ (Quản trị cuối cùng, tự khóa mình, nhóm theo vai trò, trùng email...)
 * nằm ở `crmWriteApi` (cùng nguồn với các thao tác của màn Cài đặt) — handler chỉ đổi kết quả sang JSON lỗi chuẩn của backend.
 */

const store = () => getDefaultCrmStore();

/** API ghi (không trễ) chạy với tài khoản đang đăng nhập làm người thao tác. */
const writeApi = (): CrmApi =>
  createCrmWriteApi({
    getState: () => store().getState().state,
    dispatch: (action) => store().getState().dispatch(action),
    getActor: () => resolveActor(useAuthStore.getState().user, store().getState().state.users, store().getState().state.teams),
    delayMs: 0,
  });

/** Hồ sơ trong store -> `UserListItem` của `GET /users` (`role` = role CAO NHẤT thật, kể cả EDITOR). */
const toListItem = (user: AdminUser): UserListItem => ({
  _id: user.id,
  email: user.email ?? '',
  displayName: user.displayName,
  role: (highestRole(user.roles) ?? 'STAFF') as UserRole,
  roles: rolesOf({ roles: user.roles }),
  teamIds: user.teamIds,
  status: user.isActive ? 'ACTIVE' : 'BLOCKED',
});

const findUser = (id: string): AdminUser | undefined => store().getState().state.users.find((user) => user.id === id);

/** Kết quả `ApiResult` của lớp ghi -> `MockResponse` (lỗi theo JSON chuẩn `{ statusCode, message, timestamp, path }` + `errorCode`). */
const respond = (result: Awaited<ReturnType<CrmApi['updateUserRoles']>>, path: string, status = 200): MockResponse => {
  if (result.ok) return { data: toListItem(result.data), status };
  const response = fail(result.error.statusCode, result.error.message, path);
  return { ...response, data: { ...(response.data as object), errorCode: result.error.errorCode } };
};

const isAccountRole = (value: unknown): value is AccountRole => value === 'ADMIN' || value === 'EDITOR' || value === 'MANAGER' || value === 'STAFF';

/** Danh sách `roles` hợp lệ từ body (mảng); không hợp lệ -> null. */
const readRoles = (body: unknown): AccountRole[] | null => {
  const roles = asRecord(body).roles;
  return Array.isArray(roles) && roles.length > 0 && roles.every(isAccountRole) ? roles : null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const usersRoutes: MockRoute[] = [
  {
    method: 'GET',
    pattern: /^\/users$/,
    handler: ({ query }) => ok(paginate(filterBySearch(store().getState().state.users.map(toListItem), query.get('search'), ['email', 'displayName']), query)),
  },
  {
    method: 'POST',
    pattern: /^\/users$/,
    handler: async ({ body, path }) => {
      const email = readString(body, 'email')?.trim().toLowerCase();
      const displayName = readString(body, 'displayName')?.trim();
      const password = readString(body, 'password') ?? '';
      const roles = readRoles(body);
      const teamIds = asRecord(body).teamIds;
      if (!email || !EMAIL_PATTERN.test(email) || !displayName) return fail(400, 'Email và tên hiển thị không được để trống', path);
      if (password.length < 8) return fail(400, 'Mật khẩu phải có ít nhất 8 ký tự', path);
      if (!roles) return fail(400, 'Role không hợp lệ', path);
      // Không lưu password — prototype chỉ cần tài khoản hiển thị trong bảng.
      return respond(await writeApi().createUser({ email, password, displayName, roles, teamIds: Array.isArray(teamIds) ? (teamIds as string[]) : undefined }), path, 201);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/users\/([^/]+)\/status$/,
    handler: async ({ params, body, path }) => {
      const status = readString(body, 'status');
      if (!findUser(params[0])) return fail(404, 'User not found', path);
      if (status !== 'ACTIVE' && status !== 'BLOCKED') return fail(400, 'Trạng thái không hợp lệ', path);
      return respond(await writeApi().updateUserStatus(params[0], status), path);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/users\/([^/]+)\/roles$/,
    handler: async ({ params, body, path }) => {
      if (!findUser(params[0])) return fail(404, 'User not found', path);
      const roles = readRoles(body);
      if (!roles) return fail(400, 'Cần ít nhất một vai trò hợp lệ', path);
      return respond(await writeApi().updateUserRoles(params[0], roles), path);
    },
  },
  {
    // Hợp đồng cũ: đặt roles = [role].
    method: 'PATCH',
    pattern: /^\/users\/([^/]+)\/role$/,
    handler: async ({ params, body, path }) => {
      const role = readString(body, 'role');
      if (!findUser(params[0])) return fail(404, 'User not found', path);
      if (!isAccountRole(role)) return fail(400, 'Role không hợp lệ', path);
      return respond(await writeApi().updateUserRoles(params[0], [role]), path);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/users\/([^/]+)\/teams$/,
    handler: async ({ params, body, path }) => {
      if (!findUser(params[0])) return fail(404, 'User not found', path);
      const teamIds = asRecord(body).teamIds;
      if (!Array.isArray(teamIds)) return fail(400, 'teamIds phải là mảng', path);
      const result = respond(await writeApi().updateUserTeams(params[0], teamIds as string[]), path);
      // `PATCH /users/:id/teams` trả `{ data: user }` (khác các route còn lại trả user trần).
      return result.status && result.status >= 400 ? result : { ...result, data: { data: result.data } };
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/users\/([^/]+)\/password$/,
    handler: ({ params, body, path }) => {
      if (!findUser(params[0])) return fail(404, 'User not found', path);
      if ((readString(body, 'newPassword') ?? '').length < 8) return fail(400, 'Mật khẩu phải có ít nhất 8 ký tự', path);
      return { data: null, status: 204 };
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/users\/([^/]+)$/,
    handler: ({ params, body, path }) => {
      const user = findUser(params[0]);
      if (!user) return fail(404, 'User not found', path);
      const displayName = readString(body, 'displayName')?.trim();
      const email = readString(body, 'email')?.trim().toLowerCase();
      if (displayName === undefined && email === undefined) return fail(400, 'Cần ít nhất một trường để cập nhật', path);
      if (displayName !== undefined && !displayName) return fail(400, 'Tên hiển thị không được để trống', path);
      if (email !== undefined && !EMAIL_PATTERN.test(email)) return fail(400, 'Email không hợp lệ', path);
      if (email && store().getState().state.users.some((other) => other.id !== user.id && (other.email ?? '').toLowerCase() === email)) return fail(409, 'Email đã tồn tại', path);
      const next: AdminUser = { ...user, ...(displayName ? { displayName } : {}), ...(email ? { email } : {}) };
      store().getState().dispatch({ type: 'users/upsert', user: next });
      return ok(toListItem(next));
    },
  },
];
