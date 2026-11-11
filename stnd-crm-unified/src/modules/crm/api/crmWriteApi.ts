/**
 * [Prototype] Hàm GHI của lớp truy cập dữ liệu CRM chạy trên store mock — thay `httpCrmApi.ts` của app chính (gọi API thật).
 * CÙNG tên hàm, chữ ký và kiểu trả về `Promise<ApiResult<T>>` như app chính nên màn chép từ app chính chạy nguyên; mỗi hàm mô phỏng
 * đúng luật của backend (phạm vi quyền, mã lỗi + thông điệp tiếng Việt, khóa lạc quan `version`, bất biến nhóm chăm sóc...).
 * Có trễ ngắn (`MOCK_WRITE_DELAY_MS`) để thấy trạng thái "Đang lưu…" như khi gọi mạng.
 *
 * Quy ước kết quả: `{ ok: true, data }` hoặc `{ ok: false, error: { statusCode, errorCode, message, details } }` (05 §1.3, §5).
 */
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import {
  applyPersonaUpdates,
  buildCareTeam,
  buildSearchText,
  CRITERIA_KEYS,
  createEmptyCriteria,
  getDefaultStatus,
  getListGroupOfStatus,
  getPrimaryUserId,
  getProgressPercent,
  isInCareTeam,
  isValidNationalId,
  maskNationalId,
} from '@crm/lib/customerRules';
import { DELETE_REASON_MAX_LENGTH, hasVisibleChar } from '@crm/lib/customerDeletion';
import { getVnTodayKey, toVnDateKey } from '@crm/lib/dateTime';
import { INVALID_EMAIL_MESSAGE, isValidEmail } from '@crm/lib/email';
import { createId } from '@crm/lib/id';
import { getNationalIdLast4, revealNationalId, storeNationalId } from '@crm/lib/nationalIdVault';
import { normalizePhone } from '@crm/lib/phone';
import { nextCustomerCode } from '@crm/lib/customerCode';
import { createEmptyProject, diffProject, getFirstProjectError, getProjectErrors, isProjectCodeTaken, isValidProjectCode, normalizeProject } from '@crm/lib/projectRules';
import { hasTeamRole, normalizeRoles, highestRole } from '../../../utils/userRoles';
import { normalizeVietnamese } from '@crm/lib/text';
import type { CatalogKind, CrmAction, CrmState, CustomerPatch, MutationMeta } from '@crm/store/crmReducer';
import type {
  AccountRole,
  AdminUser,
  Appointment,
  AppointmentStatus,
  Area,
  AuditAction,
  AuditLog,
  CareLog,
  CareTeamMember,
  CatalogItem,
  ChangeAction,
  ContactResult,
  CrmCatalogs,
  CrmSettings,
  Customer,
  CustomerStatusItem,
  FieldChange,
  NextAction,
  Project,
  StoredNotification,
  Tag,
  Team,
  TeamMember,
} from '@crm/types/crm';
import { assertAssignableUsers } from './assignable';
import { buildActor, canBulkAssign, canManageProjects, getCustomerPermissions, getDeleteDenial, teamIdsOfUser, type CrmActor } from './access';
import { countCatalogUsage, validateCatalogItem, validateSettings } from './catalogAdmin';
import {
  countTeamMembers,
  findAccessibleCustomer,
  getCustomer,
  listCareLogs,
  toAppointmentView,
  toStatusRef,
} from './queries';
import type {
  ApiError,
  ApiResult,
  AppointmentView,
  BulkOperation,
  CareLogView,
  CreateAppointmentInput,
  CreateCareLogInput,
  CreateCustomerInput,
  CriteriaPatch,
  CustomerDetail,
  PersonaValueInput,
  PurgeResult,
  UpdateCustomerInput,
  UpdateStatusResult,
} from './types';

export interface BulkResult {
  succeeded: string[];
  failed: { customerId: string; errorCode: string }[];
}

/** Trường nhập của dự án trong body `POST/PATCH /crm/projects` (không có tên đầy đủ/đơn vị giá/phân khúc — giống backend). */
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

export type CatalogEndpoint = 'customer-statuses' | 'lead-sources' | 'contact-results' | 'areas';

export interface SaveProfileInput {
  version: number;
  profile?: Omit<UpdateCustomerInput, 'version'>;
  nationalId?: string;
  personaValues?: PersonaValueInput[];
}

export interface CrmWriteDependencies {
  getState: () => CrmState;
  dispatch: (action: CrmAction) => void;
  /** Người đang đăng nhập (tài khoản mẫu). */
  getActor: () => CrmActor;
  now?: () => Date;
  generateId?: (prefix: string) => string;
}

/** Ảnh đính kèm nhật ký (cờ `isAttachmentsEnabled` TẮT ở prototype như app chính mặc định): hằng số giữ cho màn dùng. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ATTACHMENT_MAX_PER_NOTE = 5;

/** Trễ giả của hàm ghi (ms) — để thấy trạng thái đang lưu. */
export const MOCK_WRITE_DELAY_MS = 180;

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = <T>(statusCode: number, errorCode: string, message: string, details?: Record<string, unknown>): ApiResult<T> => ({
  ok: false,
  error: { statusCode, errorCode, message, details } satisfies ApiError,
});

const FORBIDDEN_MESSAGE = 'Bạn không có quyền thực hiện thao tác này.';
const NOT_FOUND = 'Không tìm thấy khách hàng hoặc bạn không có quyền xem khách này.';
const MAX_NAME_LENGTH = 150;
const MAX_CONTENT_LENGTH = 5000;
const MAX_BULK_SIZE = 200;
/** Tối đa 10 MEMBER mỗi khách (không tính PRIMARY) — khớp backend `CARE_TEAM_LIMIT_EXCEEDED`. */
const MAX_CARE_TEAM_MEMBERS = 10;
const PHONE_NOT_SET_MESSAGE = 'Khách chưa có số điện thoại';

/** Số MEMBER (không tính PRIMARY) của nhóm chăm sóc. */
const countMembers = (careTeam: readonly CareTeamMember[]): number => careTeam.filter((member) => member.role === 'MEMBER').length;

/**
 * SĐT nhập vào -> giá trị lưu. `null`/rỗng = chưa có số (hợp lệ, lưu `null`); có giá trị thì phải chuẩn hóa được, sai -> `undefined`.
 * Phân biệt 3 trạng thái: `null` (xóa/không có), chuỗi (hợp lệ), `undefined` (không hợp lệ).
 */
const parseOptionalPhone = (input: string | null | undefined): string | null | undefined => {
  if (input === null || input === undefined || input.trim() === '') return null;
  return normalizePhone(input) || undefined;
};

/** Lỗi `assertAssignableUsers` -> ApiResult thất bại. */
const rejectAssignment = <T>(error: NonNullable<ReturnType<typeof assertAssignableUsers>>): ApiResult<T> => fail(error.statusCode, error.errorCode, error.message, error.details);

/**
 * Nguồn/khu vực/dự án/thẻ phải tồn tại và ĐANG DÙNG. `existing` = khách đang sửa: giá trị đã gắn từ trước (kể cả đã ẩn)
 * được giữ nguyên, chỉ giá trị MỚI thêm vào mới bị kiểm.
 */
const findInvalidCatalogRef = (
  catalogs: CrmCatalogs,
  refs: { sourceId?: string | null; areaId?: string | null; projectIds?: readonly string[]; tagIds?: readonly string[] },
  existing?: Pick<Customer, 'sourceId' | 'areaId' | 'interestedProjectIds' | 'tagIds'>,
): string | null => {
  const isUsable = (items: readonly { id: string; isActive: boolean }[], id: string) => items.some((item) => item.id === id && item.isActive);
  if (refs.sourceId && refs.sourceId !== existing?.sourceId && !isUsable(catalogs.leadSources, refs.sourceId)) return 'Nguồn khách không tồn tại hoặc đã ngừng dùng.';
  if (refs.areaId && refs.areaId !== existing?.areaId && !isUsable(catalogs.areas, refs.areaId)) return 'Khu vực không tồn tại hoặc đã ngừng dùng.';
  if ((refs.projectIds ?? []).some((id) => !existing?.interestedProjectIds.includes(id) && !isUsable(catalogs.projects, id))) return 'Dự án không tồn tại hoặc đã ngừng dùng.';
  if ((refs.tagIds ?? []).some((id) => !existing?.tagIds.includes(id) && !isUsable(catalogs.tags, id))) return 'Thẻ không tồn tại hoặc đã ngừng dùng.';
  return null;
};

/** Khu vực của dự án (nếu chọn) phải tồn tại và đang dùng. */
const findInvalidProjectArea = (catalogs: CrmCatalogs, project: Project): string | null =>
  project.areaId && !catalogs.areas.some((area) => area.id === project.areaId && area.isActive) ? 'Khu vực không tồn tại hoặc đã ngừng dùng.' : null;

/** Bỏ key `undefined` của input (JSON không có undefined) để không đè giá trị hiện có bằng undefined. */
const withoutUndefined = <T extends object>(input: T | null | undefined): T => Object.fromEntries(Object.entries(input ?? {}).filter(([, value]) => value !== undefined)) as T;

const createCore = ({ getState, dispatch, getActor, now = () => new Date(), generateId = createId }: CrmWriteDependencies) => {
  const stateOf = () => getState();

  const meta = (reason?: string, source: MutationMeta['source'] = 'WEB'): MutationMeta => ({
    actorId: getActor().userId,
    now: now().toISOString(),
    changeLogId: generateId('CHG'),
    source,
    reason,
  });

  const nameOf = (userId: string): string => stateOf().users.find((user) => user.id === userId)?.displayName ?? 'Không rõ';

  /** Gửi 1 thông báo trong app cho người nhận (không gửi cho chính người thao tác). */
  const notify = (userId: string, input: { type: string; title: string; body: string; customerId?: string; appointmentId?: string; deepLink: string }) => {
    if (userId === getActor().userId || !stateOf().users.some((user) => user.id === userId)) return;
    const item: StoredNotification = { id: generateId('NTF'), userId, priority: 'NORMAL', isRead: false, createdAt: now().toISOString(), ...input };
    dispatch({ type: 'notifications/add', item });
  };

  /** Lấy khách trong phạm vi + kiểm version (optimistic concurrency, 409 `VERSION_CONFLICT`). */
  const loadForUpdate = (customerId: string, version?: number): ApiResult<Customer> => {
    const customer = findAccessibleCustomer(stateOf(), getActor(), customerId);
    if (!customer) return fail(404, 'CUSTOMER_NOT_FOUND', NOT_FOUND);
    if (version !== undefined && version !== customer.version) {
      return fail(409, 'VERSION_CONFLICT', 'Hồ sơ vừa được người khác cập nhật. Vui lòng tải lại để xem thay đổi mới nhất.', { currentVersion: customer.version });
    }
    return ok(customer);
  };

  const update = (customerId: string, patch: CustomerPatch, action: ChangeAction, reason?: string) =>
    dispatch({ type: 'customers/update', customerId, patch, action, meta: meta(reason) });

  const findRaw = (customerId: string): Customer | undefined => stateOf().customers.find((item) => item.id === customerId);

  const detailOf = (customerId: string): CustomerDetail => getCustomer(stateOf(), getActor(), customerId) as CustomerDetail;

  const updateCareTeam = (customer: Customer, careTeam: CareTeamMember[], action: ChangeAction): ApiResult<{ primaryUserId: string | null }> => {
    update(customer.id, { careTeam }, action);
    return ok({ primaryUserId: getPrimaryUserId(findRaw(customer.id)?.careTeam ?? careTeam) });
  };

  /** Ghi audit log cho thao tác không thuộc riêng 1 khách (dự án, xuất danh sách). */
  const audit = (action: AuditAction, entityType: AuditLog['entityType'], entityId: string | null, changes: FieldChange[], reason?: string) => {
    const actor = getActor();
    dispatch({
      type: 'auditLogs/add',
      log: { id: generateId('AUD'), action, entityType, entityId, actorId: actor.userId, actorName: nameOf(actor.userId), actorRole: actor.role, changes, reason, createdAt: now().toISOString() },
    });
  };

  const requireAdmin = <T>(message = FORBIDDEN_MESSAGE): ApiResult<T> | null => (getActor().role === 'ADMIN' ? null : fail(403, 'INSUFFICIENT_ROLE', message));

  // ------------------------------------------------------------------ Dự án (chỉ Quản trị)

  const rejectInvalidProject = <T,>(project: Project): ApiResult<T> | null => {
    const projects = stateOf().catalogs.projects;
    const errors = getProjectErrors(projects, project);
    const isCodeDuplicated = isValidProjectCode(project.code) && isProjectCodeTaken(projects, project);
    const { code: codeError, ...otherErrors } = errors;
    const firstError = getFirstProjectError(isCodeDuplicated ? otherErrors : errors);
    if (firstError) return fail(400, 'VALIDATION_FAILED', firstError);
    if (isCodeDuplicated) return fail(409, 'PROJECT_CODE_DUPLICATED', codeError ?? 'Mã dự án đã tồn tại.', { code: project.code });
    return null;
  };

  /** Body dự án của UI -> trường của `Project` (tên đầy đủ = tên ngắn, như mapper `toProject` của app chính). */
  const fromProjectBody = (body: ProjectBody): Partial<Project> => {
    const { description: _description, name, developer, location, ...rest } = withoutUndefined(body);
    return {
      ...rest,
      ...(name !== undefined ? { name, fullName: name } : {}),
      ...(developer !== undefined ? { developer: developer ?? '' } : {}),
      ...(location !== undefined ? { location: location ?? '' } : {}),
    } as Partial<Project>;
  };

  const createProject = (body: ProjectBody): ApiResult<Project> => {
    if (!canManageProjects(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được thêm dự án.');
    const id = generateId('proj');
    const project = normalizeProject({ ...createEmptyProject(id), ...fromProjectBody(body), id, isActive: body.isActive ?? true, deletedAt: null });
    const rejected = rejectInvalidProject<Project>(project);
    if (rejected) return rejected;
    const refError = findInvalidProjectArea(stateOf().catalogs, project);
    if (refError) return fail(400, 'INVALID_CATALOG_REF', refError);
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: project });
    audit('PROJECT_CREATED', 'PROJECT', id, [
      { field: 'Tên dự án', from: '', to: project.name },
      { field: 'Mã dự án', from: '', to: project.code },
    ]);
    return ok(project);
  };

  const updateProject = (projectId: string, body: ProjectBody): ApiResult<Project> => {
    if (!canManageProjects(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được sửa dự án.');
    const current = stateOf().catalogs.projects.find((item) => item.id === projectId);
    if (!current || current.deletedAt) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy dự án.');
    const project = normalizeProject({ ...current, ...fromProjectBody(body), id: current.id, deletedAt: null });
    const rejected = rejectInvalidProject<Project>(project);
    if (rejected) return rejected;
    const refError = project.areaId !== current.areaId ? findInvalidProjectArea(stateOf().catalogs, project) : null;
    if (refError) return fail(400, 'INVALID_CATALOG_REF', refError);
    const changes = diffProject(current, project, stateOf().catalogs.areas);
    if (changes.length === 0) return ok(current);
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: project });
    audit(current.isActive && !project.isActive ? 'PROJECT_DEACTIVATED' : 'PROJECT_UPDATED', 'PROJECT', projectId, changes);
    return ok(project);
  };

  const deleteProject = (projectId: string): ApiResult<void> => {
    if (!canManageProjects(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được xoá dự án.');
    const state = stateOf();
    const project = state.catalogs.projects.find((item) => item.id === projectId);
    if (!project || project.deletedAt) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy dự án.');
    const customerCount = countCatalogUsage(state, 'projects', projectId);
    if (customerCount > 0) {
      return fail(409, 'PROJECT_IN_USE', `Dự án đang có ${customerCount} khách quan tâm nên không thể xoá. Hãy chuyển sang ngừng hoạt động.`, { customerCount });
    }
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: { ...project, isActive: false, deletedAt: now().toISOString() } });
    audit('PROJECT_DELETED', 'PROJECT', projectId, [{ field: 'Dự án', from: project.name, to: '(đã xoá)' }]);
    return ok(undefined);
  };

  const restoreProject = (projectId: string): ApiResult<Project> => {
    if (!canManageProjects(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được khôi phục dự án.');
    const project = stateOf().catalogs.projects.find((item) => item.id === projectId);
    if (!project?.deletedAt) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy dự án đã xoá.');
    const restored: Project = { ...project, deletedAt: null, isActive: true };
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: restored });
    audit('PROJECT_RESTORED', 'PROJECT', projectId, [{ field: 'Dự án', from: '(đã xoá)', to: project.name }]);
    return ok(restored);
  };

  // ------------------------------------------------------------------ Danh mục (chỉ Quản trị)

  const CATALOG_KIND_BY_ENDPOINT: Record<CatalogEndpoint, Extract<CatalogKind, 'statuses' | 'leadSources' | 'contactResults' | 'areas'>> = {
    'customer-statuses': 'statuses',
    'lead-sources': 'leadSources',
    'contact-results': 'contactResults',
    areas: 'areas',
  };

  const rejectCatalog = <T,>(kind: CatalogKind, item: CatalogItem | CustomerStatusItem | ContactResult | Area): ApiResult<T> | null => {
    const error = validateCatalogItem(stateOf().catalogs, kind, item);
    if (!error) return null;
    return error.isDuplicate ? fail(409, 'CATALOG_DUPLICATED', error.message) : fail(400, 'VALIDATION_FAILED', error.message);
  };

  /** Chỉ 1 tình trạng mặc định cho khách mới: đặt mặc định mới thì gỡ cờ ở tình trạng cũ. */
  const clearOtherDefaultStatuses = (keepId: string) =>
    stateOf()
      .catalogs.statuses.filter((status) => status.isDefault && status.id !== keepId)
      .forEach((status) => dispatch({ type: 'catalogs/upsert', kind: 'statuses', item: { ...status, isDefault: false } }));

  const buildArea = (body: Record<string, unknown>, existing?: Area): Area => {
    const areas = stateOf().catalogs.areas;
    const rawName = String(body.name ?? existing?.rawName ?? existing?.name ?? '').trim();
    const parentId = body.parentId === undefined ? (existing?.parentId ?? null) : ((body.parentId as string | null) || null);
    const parent = parentId ? areas.find((area) => area.id === parentId) : undefined;
    return {
      id: existing?.id ?? generateId('area'),
      name: parent ? `${rawName} · ${parent.rawName ?? parent.name}` : rawName,
      rawName,
      type: String(body.type ?? existing?.type ?? 'PROVINCE'),
      parentId,
      order: Number(body.order ?? existing?.order ?? areas.length + 1),
      isActive: body.isActive === undefined ? (existing?.isActive ?? true) : Boolean(body.isActive),
    };
  };

  const createCatalogItem = (endpoint: CatalogEndpoint, body: Record<string, unknown>): ApiResult<unknown> => {
    const denied = requireAdmin<unknown>('Chỉ Quản trị được sửa danh mục.');
    if (denied) return denied;
    const kind = CATALOG_KIND_BY_ENDPOINT[endpoint];
    const catalogs = stateOf().catalogs;
    if (kind === 'areas') {
      const area = buildArea(body);
      const rejected = rejectCatalog<unknown>('areas', { ...area, name: area.rawName ?? area.name });
      if (rejected) return rejected;
      dispatch({ type: 'catalogs/upsert', kind, item: area });
      return ok(area);
    }
    if (kind === 'statuses') {
      const status: CustomerStatusItem = {
        id: generateId('st'),
        code: String(body.code ?? ''),
        label: String(body.label ?? '').trim(),
        listGroup: body.listGroup as CustomerStatusItem['listGroup'],
        tone: (body.color as CustomerStatusItem['tone']) ?? 'gray',
        order: Number(body.order ?? catalogs.statuses.length + 1),
        isDefault: false,
        isSystem: false,
        isActive: true,
      };
      if (catalogs.statuses.some((item) => item.code === status.code)) return fail(409, 'CATALOG_DUPLICATED', `Mã "${status.code}" đã tồn tại.`);
      const rejected = rejectCatalog<unknown>(kind, status);
      if (rejected) return rejected;
      dispatch({ type: 'catalogs/upsert', kind, item: status });
      return ok(status);
    }
    if (kind === 'contactResults') {
      const result: ContactResult = {
        id: generateId('cr'),
        label: String(body.label ?? '').trim(),
        suggestedFollowUpDays: (body.suggestedFollowUpDays as number | null | undefined) ?? null,
        suggestionText: String(body.suggestionText ?? ''),
        order: Number(body.order ?? catalogs.contactResults.length + 1),
        isActive: true,
      };
      const rejected = rejectCatalog<unknown>(kind, result);
      if (rejected) return rejected;
      dispatch({ type: 'catalogs/upsert', kind, item: result });
      return ok(result);
    }
    const source: CatalogItem = { id: generateId('src'), code: String(body.code ?? ''), label: String(body.label ?? '').trim(), order: Number(body.order ?? catalogs.leadSources.length + 1), isActive: true };
    if (catalogs.leadSources.some((item) => item.code && item.code === source.code)) return fail(409, 'CATALOG_DUPLICATED', `Mã "${source.code}" đã tồn tại.`);
    const rejected = rejectCatalog<unknown>(kind, source);
    if (rejected) return rejected;
    dispatch({ type: 'catalogs/upsert', kind, item: source });
    return ok(source);
  };

  const updateCatalogItem = (endpoint: CatalogEndpoint, id: string, body: Record<string, unknown>): ApiResult<unknown> => {
    const denied = requireAdmin<unknown>('Chỉ Quản trị được sửa danh mục.');
    if (denied) return denied;
    const kind = CATALOG_KIND_BY_ENDPOINT[endpoint];
    const catalogs = stateOf().catalogs;
    if (kind === 'areas') {
      const existing = catalogs.areas.find((area) => area.id === id);
      if (!existing) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy mục danh mục.');
      const area = buildArea(body, existing);
      const rejected = rejectCatalog<unknown>('areas', { ...area, name: area.rawName ?? area.name });
      if (rejected) return rejected;
      dispatch({ type: 'catalogs/upsert', kind, item: area });
      return ok(area);
    }
    if (kind === 'statuses') {
      const existing = catalogs.statuses.find((status) => status.id === id);
      if (!existing) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy mục danh mục.');
      const status: CustomerStatusItem = {
        ...existing,
        label: body.label === undefined ? existing.label : String(body.label).trim(),
        tone: (body.color as CustomerStatusItem['tone'] | undefined) ?? existing.tone,
        order: body.order === undefined ? existing.order : Number(body.order),
        isActive: body.isActive === undefined ? existing.isActive : Boolean(body.isActive),
        isDefault: body.isDefault === undefined ? existing.isDefault : Boolean(body.isDefault),
        // Tình trạng hệ thống không đổi được nhóm danh sách.
        listGroup: existing.isSystem ? existing.listGroup : ((body.listGroup as CustomerStatusItem['listGroup'] | undefined) ?? existing.listGroup),
      };
      const rejected = rejectCatalog<unknown>(kind, status);
      if (rejected) return rejected;
      if (status.isDefault) clearOtherDefaultStatuses(status.id);
      dispatch({ type: 'catalogs/upsert', kind, item: status });
      return ok(status);
    }
    if (kind === 'contactResults') {
      const existing = catalogs.contactResults.find((item) => item.id === id);
      if (!existing) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy mục danh mục.');
      const result: ContactResult = { ...existing, ...withoutUndefined(body as Partial<ContactResult>) };
      const rejected = rejectCatalog<unknown>(kind, result);
      if (rejected) return rejected;
      dispatch({ type: 'catalogs/upsert', kind, item: result });
      return ok(result);
    }
    const existing = catalogs.leadSources.find((item) => item.id === id);
    if (!existing) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy mục danh mục.');
    const source: CatalogItem = {
      ...existing,
      label: body.label === undefined ? existing.label : String(body.label).trim(),
      order: body.order === undefined ? existing.order : Number(body.order),
      isActive: body.isActive === undefined ? existing.isActive : Boolean(body.isActive),
    };
    const rejected = rejectCatalog<unknown>(kind, source);
    if (rejected) return rejected;
    dispatch({ type: 'catalogs/upsert', kind, item: source });
    return ok(source);
  };

  /** Không xoá cứng: mục đang dùng không xoá được (409), chưa dùng thì ẩn. */
  const deleteCatalogItem = (endpoint: CatalogEndpoint, id: string): ApiResult<void> => {
    const denied = requireAdmin<void>('Chỉ Quản trị được sửa danh mục.');
    if (denied) return denied;
    const kind = CATALOG_KIND_BY_ENDPOINT[endpoint];
    const usage = countCatalogUsage(stateOf(), kind, id);
    if (usage > 0) return fail(409, 'CATALOG_IN_USE', `Mục này đang được ${usage} khách dùng nên không thể xoá. Hãy ẩn mục.`, { usage });
    const item = (stateOf().catalogs[kind] as readonly { id: string; isActive: boolean }[]).find((candidate) => candidate.id === id);
    if (!item) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy mục danh mục.');
    dispatch({ type: 'catalogs/upsert', kind, item: { ...item, isActive: false } as never });
    return ok(undefined);
  };

  // ------------------------------------------------------------------ Tài khoản, nhóm (chỉ Quản trị)

  /** Quản trị đang hoạt động CÒN LẠI nếu bỏ `exceptUserId` (chặn bỏ/khóa Quản trị cuối cùng — 409 `LAST_ADMIN_REQUIRED`). */
  const hasAnotherActiveAdmin = (exceptUserId: string): boolean => stateOf().users.some((user) => user.id !== exceptUserId && user.isActive && user.roles.includes('ADMIN'));

  const LAST_ADMIN_MESSAGE = 'Phải còn ít nhất một tài khoản Quản trị đang hoạt động.';

  /** Chuẩn hoá hồ sơ tài khoản: `roles` đã sắp, `role` = cao nhất (EDITOR thuần -> STAFF), `teamId` = nhóm chính, người không còn Quản lý/Nhân viên thì mất nhóm. */
  const normalizeUser = (user: AdminUser): AdminUser => {
    const roles = normalizeRoles(user.roles) as AccountRole[];
    const teamIds = hasTeamRole(roles) ? [...new Set(user.teamIds)] : [];
    const top = highestRole(roles);
    return { ...user, roles, role: top === 'ADMIN' || top === 'MANAGER' ? top : 'STAFF', teamIds, teamId: teamIds[0] ?? null };
  };

  /** Người không còn được phân chăm sóc (khóa/mất role Quản lý, Nhân viên): gỡ khỏi nhóm MEMBER của mọi khách (phụ trách chính giữ nguyên như backend). */
  const detachAsMember = (user: AdminUser, reason: string) => {
    stateOf()
      .customers.filter((customer) => !customer.deletedAt && customer.careTeam.some((member) => member.userId === user.id && member.role === 'MEMBER'))
      .forEach((customer) => update(customer.id, { careTeam: customer.careTeam.filter((member) => member.userId !== user.id) }, 'CARE_TEAM_MEMBER_REMOVED', reason));
  };

  const saveUser = (before: AdminUser, next: AdminUser): AdminUser => {
    const saved = normalizeUser(next);
    const wasAssignable = before.isActive && hasTeamRole(before.roles);
    const isAssignable = saved.isActive && hasTeamRole(saved.roles);
    if (wasAssignable && !isAssignable) detachAsMember(saved, saved.isActive ? 'Đổi vai trò' : 'Khoá tài khoản');
    dispatch({ type: 'users/upsert', user: saved });
    return saved;
  };

  const findUser = (userId: string): AdminUser | undefined => stateOf().users.find((user) => user.id === userId);

  const createUser = (body: { email: string; password: string; displayName: string; roles: AccountRole[]; teamIds?: string[] }): ApiResult<AdminUser> => {
    const denied = requireAdmin<AdminUser>('Chỉ Quản trị được tạo tài khoản.');
    if (denied) return denied;
    const email = body.email.trim().toLowerCase();
    if (stateOf().users.some((user) => (user.email ?? '').toLowerCase() === email)) return fail(409, 'USER_EMAIL_DUPLICATED', 'Email đã tồn tại.');
    const roles = normalizeRoles(body.roles) as AccountRole[];
    if (roles.length === 0) return fail(400, 'VALIDATION_FAILED', 'Cần ít nhất một vai trò hợp lệ');
    const teamIds = body.teamIds ?? [];
    if (teamIds.length > 0 && !hasTeamRole(roles)) return fail(400, 'VALIDATION_FAILED', 'Chỉ Quản lý/Nhân viên mới thuộc nhóm.');
    if (hasTeamRole(roles) && teamIds.length === 0) return fail(400, 'VALIDATION_FAILED', 'Quản lý/Nhân viên phải thuộc ít nhất một nhóm.');
    const invalidTeam = teamIds.find((teamId) => !stateOf().teams.some((team) => team.id === teamId && team.isActive));
    if (invalidTeam) return fail(404, 'RESOURCE_NOT_FOUND', 'Nhóm không tồn tại hoặc đã ngừng hoạt động.');
    const displayName = body.displayName.trim();
    const user = normalizeUser({ id: generateId('usr'), email, fullName: displayName, displayName, role: 'STAFF', roles, jobTitle: '', teamId: null, teamIds, isActive: true });
    dispatch({ type: 'users/upsert', user });
    return ok(user);
  };

  const updateUserStatus = (userId: string, status: 'ACTIVE' | 'BLOCKED'): ApiResult<AdminUser> => {
    const denied = requireAdmin<AdminUser>('Chỉ Quản trị được khóa/mở khóa tài khoản.');
    if (denied) return denied;
    const user = findUser(userId);
    if (!user) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy người dùng.');
    const isActive = status === 'ACTIVE';
    if (isActive === user.isActive) return ok(user);
    if (!isActive && user.id === getActor().userId) return fail(403, 'INSUFFICIENT_ROLE', 'Bạn không thể tự khóa tài khoản của chính mình.');
    if (!isActive && user.roles.includes('ADMIN') && !hasAnotherActiveAdmin(user.id)) return fail(409, 'LAST_ADMIN_REQUIRED', LAST_ADMIN_MESSAGE);
    return ok(saveUser(user, { ...user, isActive }));
  };

  const updateUserRoles = (userId: string, rolesInput: AccountRole[]): ApiResult<AdminUser> => {
    const denied = requireAdmin<AdminUser>('Chỉ Quản trị được đổi vai trò.');
    if (denied) return denied;
    const user = findUser(userId);
    if (!user) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy người dùng.');
    const roles = normalizeRoles(rolesInput) as AccountRole[];
    if (roles.length === 0) return fail(400, 'VALIDATION_FAILED', 'Cần ít nhất một vai trò hợp lệ');
    if (roles.length === user.roles.length && roles.every((role, index) => role === user.roles[index])) return ok(user);
    if (!roles.includes('ADMIN') && user.isActive && user.roles.includes('ADMIN') && !hasAnotherActiveAdmin(user.id)) return fail(409, 'LAST_ADMIN_REQUIRED', LAST_ADMIN_MESSAGE);
    return ok(saveUser(user, { ...user, roles }));
  };

  const updateUserTeams = (userId: string, teamIds: string[]): ApiResult<AdminUser> => {
    const denied = requireAdmin<AdminUser>('Chỉ Quản trị được gán nhóm.');
    if (denied) return denied;
    const user = findUser(userId);
    if (!user) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy người dùng.');
    if (teamIds.length > 0 && !hasTeamRole(user.roles)) return fail(400, 'VALIDATION_FAILED', 'Chỉ Quản lý/Nhân viên mới thuộc nhóm.');
    // Nhóm MỚI thêm phải còn hoạt động; nhóm đã có từ trước (kể cả đã ngừng) được giữ để còn gỡ được.
    const invalidTeam = teamIds.find((teamId) => !user.teamIds.includes(teamId) && !stateOf().teams.some((team) => team.id === teamId && team.isActive));
    if (invalidTeam) return fail(404, 'RESOURCE_NOT_FOUND', 'Nhóm không tồn tại hoặc đã ngừng hoạt động.');
    return ok(saveUser(user, { ...user, teamIds }));
  };

  const createTeam = (body: { name: string; code: string; managerIds?: string[] }): ApiResult<Team> => {
    const denied = requireAdmin<Team>('Chỉ Quản trị được tạo nhóm.');
    if (denied) return denied;
    const code = body.code.trim();
    if (stateOf().teams.some((team) => team.code.toLowerCase() === code.toLowerCase())) return fail(409, 'TEAM_CODE_DUPLICATED', `Mã nhóm "${code}" đã tồn tại.`);
    const managerIds = [...new Set(body.managerIds ?? [])];
    const invalidManager = managerIds.find((id) => !findUser(id)?.roles.includes('MANAGER') || !findUser(id)?.isActive);
    if (invalidManager) return fail(400, 'VALIDATION_FAILED', 'Quản lý của nhóm phải là tài khoản Quản lý đang hoạt động.');
    const team: Team = { id: generateId('team'), code, name: body.name.trim(), managerIds, isActive: true };
    dispatch({ type: 'teams/upsert', team });
    return ok(team);
  };

  const updateTeam = (teamId: string, body: { name?: string; managerIds?: string[]; isActive?: boolean }): ApiResult<Team> => {
    const denied = requireAdmin<Team>('Chỉ Quản trị được sửa nhóm.');
    if (denied) return denied;
    const team = stateOf().teams.find((item) => item.id === teamId);
    if (!team) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy nhóm.');
    const managerIds = body.managerIds ? [...new Set(body.managerIds)] : team.managerIds;
    const invalidManager = managerIds.filter((id) => !team.managerIds.includes(id)).find((id) => !findUser(id)?.roles.includes('MANAGER') || !findUser(id)?.isActive);
    if (invalidManager) return fail(400, 'VALIDATION_FAILED', 'Quản lý của nhóm phải là tài khoản Quản lý đang hoạt động.');
    const next: Team = { ...team, name: body.name?.trim() || team.name, managerIds, isActive: body.isActive ?? team.isActive };
    dispatch({ type: 'teams/upsert', team: next });
    return ok(next);
  };

  const deleteTeam = (teamId: string): ApiResult<void> => {
    const denied = requireAdmin<void>('Chỉ Quản trị được xóa nhóm.');
    if (denied) return denied;
    const team = stateOf().teams.find((item) => item.id === teamId);
    if (!team) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy nhóm.');
    const memberCount = countTeamMembers(stateOf().users, teamId);
    if (memberCount > 0) return fail(409, 'TEAM_NOT_EMPTY', `Nhóm còn ${memberCount} thành viên nên chưa xóa được. Hãy chuyển họ sang nhóm khác trước.`, { memberCount });
    dispatch({ type: 'teams/remove', teamId });
    return ok(undefined);
  };

  const toTeamMember = (user: AdminUser, team: Team): TeamMember => ({
    id: user.id,
    displayName: user.displayName,
    role: user.roles[0] ?? user.role,
    roles: user.roles,
    isActive: user.isActive,
    isManager: team.managerIds.includes(user.id),
  });

  const addTeamMember = (teamId: string, userId: string): ApiResult<TeamMember> => {
    const denied = requireAdmin<TeamMember>('Chỉ Quản trị được thêm thành viên nhóm.');
    if (denied) return denied;
    const team = stateOf().teams.find((item) => item.id === teamId);
    if (!team || !team.isActive) return fail(404, 'RESOURCE_NOT_FOUND', 'Nhóm không tồn tại hoặc đã ngừng hoạt động.');
    const user = findUser(userId);
    if (!user) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy người dùng.');
    if (!hasTeamRole(user.roles)) return fail(400, 'VALIDATION_FAILED', 'Chỉ Quản lý/Nhân viên mới thuộc nhóm.');
    if (teamIdsOfUser(user).includes(teamId)) return ok(toTeamMember(user, team));
    const saved = saveUser(user, { ...user, teamIds: [...teamIdsOfUser(user), teamId] });
    return ok(toTeamMember(saved, team));
  };

  /** Idempotent, KHÔNG đổi `managerIds` của nhóm. */
  const removeTeamMember = (teamId: string, userId: string): ApiResult<void> => {
    const denied = requireAdmin<void>('Chỉ Quản trị được gỡ thành viên nhóm.');
    if (denied) return denied;
    const team = stateOf().teams.find((item) => item.id === teamId);
    if (!team) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy nhóm.');
    const user = findUser(userId);
    if (user && teamIdsOfUser(user).includes(teamId)) saveUser(user, { ...user, teamIds: teamIdsOfUser(user).filter((id) => id !== teamId) });
    return ok(undefined);
  };

  const updateSettings = (changes: Partial<CrmSettings>): ApiResult<CrmSettings> => {
    const denied = requireAdmin<CrmSettings>('Chỉ Quản trị được sửa cài đặt.');
    if (denied) return denied;
    const error = validateSettings(changes);
    if (error) return fail(400, 'VALIDATION_FAILED', error);
    dispatch({ type: 'settings/update', changes });
    return ok(stateOf().settings);
  };

  // ------------------------------------------------------------------ Thẻ

  /** `POST /crm/tags` — mọi vai trò được tạo thẻ khi gắn; trùng tên (không dấu) -> trả thẻ có sẵn (C11). */
  const createTag = (body: { name: string; category: string }): ApiResult<{ id: string; label: string; category: string }> => {
    const name = body.name.replace(/^#+/, '').trim();
    if (!name || name.length > 50) return fail(400, 'VALIDATION_FAILED', 'Tên thẻ từ 1 đến 50 ký tự.');
    const category = body.category as Tag['category'];
    const existing = stateOf().catalogs.tags.find((tag) => tag.category === category && normalizeVietnamese(tag.name) === normalizeVietnamese(name));
    if (existing) return ok({ id: existing.id, label: existing.name, category: existing.category });
    const tag: Tag = { id: generateId('TAG'), name, category, isActive: true };
    dispatch({ type: 'catalogs/upsert', kind: 'tags', item: tag });
    return ok({ id: tag.id, label: tag.name, category: tag.category });
  };

  // ------------------------------------------------------------------ Khách hàng (05 §2.3)

  const createCustomer = (input: CreateCustomerInput): ApiResult<CustomerDetail> => {
    const state = stateOf();
    const actor = getActor();
    const fullName = input.fullName.trim();
    if (!fullName || fullName.length > MAX_NAME_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Vui lòng nhập họ tên (tối đa 150 ký tự).');
    // v1.0.5: SĐT tùy chọn; có thì phải hợp lệ; cho phép trùng SĐT với khách khác (không còn tra cứu/chặn trùng).
    const phone = parseOptionalPhone(input.phone);
    if (phone === undefined) return fail(400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.', { input: input.phone });
    if (input.nationalId && !isValidNationalId(input.nationalId)) return fail(400, 'VALIDATION_FAILED', 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).');
    if (input.email !== undefined && !isValidEmail(input.email)) return fail(400, 'VALIDATION_FAILED', INVALID_EMAIL_MESSAGE);

    const invalidRef = findInvalidCatalogRef(state.catalogs, { sourceId: input.sourceId, areaId: input.areaId, projectIds: input.interestedProjectIds, tagIds: input.tagIds });
    if (invalidRef) return fail(400, 'INVALID_CATALOG_REF', invalidRef);

    const mutationMeta = meta();
    const id = generateId('CUST');
    const last4 = input.nationalId ? getNationalIdLast4(input.nationalId) : null;
    const status = (input.statusId && state.catalogs.statuses.find((item) => item.id === input.statusId && item.isActive)) || getDefaultStatus(state.catalogs.statuses);
    // v1.0.5: người tạo LUÔN là PRIMARY (mọi vai trò, kể cả Quản trị); không nhận `careTeam` từ client.
    const careTeam = buildCareTeam(actor.userId, [], actor.userId, mutationMeta.now);
    const customerCode = nextCustomerCode(state.customers.map((item) => item.customerCode));
    const criteria = createEmptyCriteria();
    CRITERIA_KEYS.forEach((key) => {
      const change = input.criteria?.[key];
      if (!change) return;
      const description = change.description?.trim() ?? '';
      const isDone = change.isDone ?? false;
      if (isDone || description) criteria[key] = { isDone, description, updatedAt: mutationMeta.now, updatedBy: actor.userId };
    });
    const customer: Customer = {
      id,
      customerCode,
      fullName,
      phone,
      email: input.email?.trim() ?? '',
      statusId: status?.id ?? '',
      statusChangedAt: mutationMeta.now,
      sourceId: input.sourceId ?? null,
      interestedProjectIds: [...new Set(input.interestedProjectIds ?? [])],
      areaId: input.areaId ?? null,
      tagIds: [...new Set(input.tagIds ?? [])],
      nationalIdLast4: last4,
      hasNationalId: Boolean(last4),
      criteria,
      careTeam,
      primaryAssigneeId: getPrimaryUserId(careTeam),
      persona: [],
      occasions: [],
      personaCompleteness: 0,
      shouldRemindOccasions: true,
      notes: '',
      lastCareLogAt: null,
      nextAppointmentAt: null,
      searchText: buildSearchText({ fullName, phone, email: input.email, customerCode }),
      createdAt: mutationMeta.now,
      createdBy: actor.userId,
      createdVia: 'WEB',
      lastUpdatedAt: mutationMeta.now,
      lastUpdatedBy: actor.userId,
      version: 1,
    };
    dispatch({ type: 'customers/create', customer, meta: mutationMeta, action: 'CUSTOMER_CREATED' });
    if (!stateOf().customers.some((item) => item.id === id)) return fail(409, 'CUSTOMER_NOT_CREATED', 'Không thể tạo khách hàng (dữ liệu không hợp lệ).');
    // Kho CCCD đầy đủ chỉ ghi SAU khi reducer đã chấp nhận (tránh rác nếu bị từ chối).
    if (input.nationalId && last4) storeNationalId(id, input.nationalId);
    // Người tạo vừa nhập dữ liệu và là PRIMARY nên luôn nhận lại hồ sơ.
    return ok((getCustomer(stateOf(), actor, id) ?? getCustomer(stateOf(), { ...actor, role: 'ADMIN' }, id)) as CustomerDetail);
  };

  const updateCustomer = (customerId: string, input: UpdateCustomerInput): ApiResult<CustomerDetail> => {
    const loaded = loadForUpdate(customerId, input.version);
    if (!loaded.ok) return loaded;
    const refError = findInvalidCatalogRef(stateOf().catalogs, { sourceId: input.sourceId, areaId: input.areaId, projectIds: input.interestedProjectIds, tagIds: input.tagIds }, loaded.data);
    if (refError) return fail(400, 'INVALID_CATALOG_REF', refError);
    const patch: CustomerPatch = {};
    if (input.fullName !== undefined) {
      const fullName = input.fullName.trim();
      if (!fullName || fullName.length > MAX_NAME_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Vui lòng nhập họ tên (tối đa 150 ký tự).');
      patch.fullName = fullName;
    }
    if (input.phone !== undefined) {
      // null hoặc "" = xóa số; cho phép trùng SĐT (v1.0.5).
      const phone = parseOptionalPhone(input.phone);
      if (phone === undefined) return fail(400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.', { input: input.phone });
      patch.phone = phone;
    }
    if (input.email !== undefined) {
      if (!isValidEmail(input.email)) return fail(400, 'VALIDATION_FAILED', INVALID_EMAIL_MESSAGE);
      patch.email = input.email.trim();
    }
    if (input.sourceId !== undefined) patch.sourceId = input.sourceId;
    if (input.interestedProjectIds !== undefined) patch.interestedProjectIds = [...new Set(input.interestedProjectIds)];
    if (input.areaId !== undefined) patch.areaId = input.areaId;
    if (input.tagIds !== undefined) patch.tagIds = [...new Set(input.tagIds)];
    update(customerId, patch, 'CUSTOMER_UPDATED');
    return ok(detailOf(customerId));
  };

  /** `PATCH /crm/customers/:id/status` — dùng lại để Hoàn tác. */
  const updateCustomerStatus = (customerId: string, body: { statusId: string; version: number; reason?: string }): ApiResult<UpdateStatusResult> => {
    const loaded = loadForUpdate(customerId, body.version);
    if (!loaded.ok) return loaded;
    const status = stateOf().catalogs.statuses.find((item) => item.id === body.statusId && item.isActive);
    if (!status) return fail(400, 'STATUS_NOT_FOUND', 'Tình trạng không tồn tại hoặc đã ngừng dùng.', { statusId: body.statusId });
    const previousStatusId = loaded.data.statusId;
    update(customerId, { statusId: status.id }, 'STATUS_CHANGED', body.reason);
    const after = findRaw(customerId) as Customer;
    return ok({ status: toStatusRef(stateOf().catalogs, status.id), previousStatusId, version: after.version, lastUpdatedAt: after.lastUpdatedAt });
  };

  /** `PATCH /crm/customers/:id/criteria` — tiến độ do hệ thống tính, không nhận từ client. */
  const updateCustomerCriteria = (customerId: string, body: { version: number; criteria: CriteriaPatch }): ApiResult<{ progress: number; version: number; lastUpdatedAt: string }> => {
    const loaded = loadForUpdate(customerId, body.version);
    if (!loaded.ok) return loaded;
    const actorId = getActor().userId;
    const stamp = now().toISOString();
    const criteria = { ...loaded.data.criteria };
    for (const key of CRITERIA_KEYS) {
      const change = body.criteria[key];
      if (!change) continue;
      const description = change.description !== undefined ? change.description.trim() : criteria[key].description;
      if (description.length > 1000) return fail(400, 'VALIDATION_FAILED', 'Mô tả tiêu chí tối đa 1000 ký tự.');
      const isDone = change.isDone ?? criteria[key].isDone;
      if (isDone === criteria[key].isDone && description === criteria[key].description) continue;
      criteria[key] = { isDone, description, updatedAt: stamp, updatedBy: actorId };
    }
    update(customerId, { criteria }, 'CRITERIA_UPDATED');
    const after = findRaw(customerId) as Customer;
    return ok({ progress: getProgressPercent(after.criteria), version: after.version, lastUpdatedAt: after.lastUpdatedAt });
  };

  const putNationalId = (customerId: string, nationalId: string): ApiResult<{ hasNationalId: boolean; nationalIdMasked: string | null }> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    if (!isValidNationalId(nationalId)) return fail(400, 'VALIDATION_FAILED', 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).');
    const last4 = getNationalIdLast4(nationalId);
    const isSameNumber = revealNationalId(customerId) === nationalId.replace(/\s/g, '');
    update(customerId, { nationalIdLast4: last4, hasNationalId: Boolean(last4), ...(isSameNumber ? {} : { nationalIdUpdatedAt: now().toISOString() }) }, 'NATIONAL_ID_UPDATED');
    if (findRaw(customerId)?.nationalIdLast4 === last4) storeNationalId(customerId, nationalId);
    return ok({ hasNationalId: Boolean(last4), nationalIdMasked: last4 ? maskNationalId(last4) : null });
  };

  const deleteNationalId = (customerId: string): ApiResult<void> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    if (!loaded.data.hasNationalId) return ok(undefined);
    update(customerId, { nationalIdLast4: null, hasNationalId: false }, 'NATIONAL_ID_UPDATED', 'Xoá CCCD');
    storeNationalId(customerId, '');
    return ok(undefined);
  };

  /**
   * Lưu hồ sơ + CCCD + chân dung trong MỘT mutation nguyên tử (kiểm TẤT CẢ trước rồi mới ghi: 1 lần tăng version, 1 changeLog).
   * [Prototype] App chính gọi tuần tự 3 API; prototype nguyên tử nên không có trạng thái "lưu một phần".
   */
  const saveCustomerProfile = (customerId: string, input: SaveProfileInput): ApiResult<{ version: number }> => {
    const loaded = loadForUpdate(customerId, input.version);
    if (!loaded.ok) return loaded;
    const patch: CustomerPatch = {};
    const profile = input.profile ?? {};
    const profileRefError = findInvalidCatalogRef(stateOf().catalogs, { sourceId: profile.sourceId, areaId: profile.areaId, projectIds: profile.interestedProjectIds, tagIds: profile.tagIds }, loaded.data);
    if (profileRefError) return fail(400, 'INVALID_CATALOG_REF', profileRefError);
    if (profile.fullName !== undefined) {
      const fullName = profile.fullName.trim();
      if (!fullName || fullName.length > MAX_NAME_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Vui lòng nhập họ tên (tối đa 150 ký tự).');
      patch.fullName = fullName;
    }
    if (profile.phone !== undefined) {
      const phone = parseOptionalPhone(profile.phone);
      if (phone === undefined) return fail(400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.', { input: profile.phone });
      patch.phone = phone;
    }
    if (profile.email !== undefined) {
      if (!isValidEmail(profile.email)) return fail(400, 'VALIDATION_FAILED', INVALID_EMAIL_MESSAGE);
      patch.email = profile.email.trim();
    }
    if (profile.sourceId !== undefined) patch.sourceId = profile.sourceId;
    if (profile.interestedProjectIds !== undefined) patch.interestedProjectIds = [...new Set(profile.interestedProjectIds)];
    if (profile.areaId !== undefined) patch.areaId = profile.areaId;
    if (profile.tagIds !== undefined) patch.tagIds = [...new Set(profile.tagIds)];

    const nationalId = input.nationalId?.trim();
    if (nationalId) {
      if (!isValidNationalId(nationalId)) return fail(400, 'VALIDATION_FAILED', 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).');
      patch.nationalIdLast4 = getNationalIdLast4(nationalId);
      patch.hasNationalId = true;
      if (revealNationalId(customerId) !== nationalId.replace(/\s/g, '')) patch.nationalIdUpdatedAt = now().toISOString();
    }
    const values = input.personaValues ?? [];
    const unknownKey = values.find((value) => !PERSONA_FIELDS.some((field) => field.key === value.fieldKey));
    if (unknownKey) return fail(400, 'PERSONA_VALUE_INVALID', `Trường chân dung không tồn tại: ${unknownKey.fieldKey}`, { fieldKey: unknownKey.fieldKey });
    const personaResult = applyPersonaUpdates(
      loaded.data.persona,
      values.map((value) => ({ fieldKey: value.fieldKey, value: value.value ? { ...value.value, fieldKey: value.fieldKey } : null, source: value.source })),
      getActor().userId,
      now().toISOString(),
    );
    if (personaResult.changedKeys.length > 0) patch.persona = personaResult.persona;

    const isOnlyPersona = Object.keys(patch).length === 1 && patch.persona !== undefined;
    const isOnlyNationalId = Boolean(nationalId) && Object.keys(patch).every((key) => key === 'nationalIdLast4' || key === 'hasNationalId' || key === 'nationalIdUpdatedAt');
    update(customerId, patch, isOnlyPersona ? 'PERSONA_UPDATED' : isOnlyNationalId ? 'NATIONAL_ID_UPDATED' : 'CUSTOMER_UPDATED');
    // Kho CCCD đầy đủ chỉ ghi SAU khi reducer đã chấp nhận hồ sơ.
    if (nationalId && findRaw(customerId)?.nationalIdLast4 === patch.nationalIdLast4) storeNationalId(customerId, nationalId);
    return ok({ version: findRaw(customerId)?.version ?? loaded.data.version });
  };

  /** "Hiện số"/gọi/Zalo: MỖI lần gọi ghi 1 log PHONE_VIEWED rồi trả số đầy đủ. Khách ngoài phạm vi -> 404; chưa có SĐT -> 409 `CUSTOMER_PHONE_NOT_SET`. */
  const createPhoneView = (customerId: string, _purpose: 'VIEW' | 'CALL' | 'COPY' = 'VIEW'): ApiResult<{ phone: string; viewedAt: string }> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    // v1.0.5: khách chưa có SĐT -> 409, KHÔNG ghi log PHONE_VIEWED.
    if (!loaded.data.phone) return fail(409, 'CUSTOMER_PHONE_NOT_SET', PHONE_NOT_SET_MESSAGE);
    const mutationMeta = meta();
    dispatch({ type: 'phones/viewed', customerId, meta: mutationMeta });
    return ok({ phone: loaded.data.phone, viewedAt: mutationMeta.now });
  };

  /** `POST /crm/customers/:id/national-id-views` — kiểm quyền, GHI LOG mỗi lần xem rồi mới trả số. */
  const createNationalIdView = (customerId: string): ApiResult<{ nationalId: string; viewedAt: string }> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    if (!getCustomerPermissions(getActor(), loaded.data).canRevealNationalId) {
      return fail(403, 'NATIONAL_ID_FORBIDDEN', 'Bạn không có quyền xem CCCD đầy đủ của khách này.');
    }
    const nationalId = revealNationalId(customerId);
    if (!nationalId) return fail(404, 'RESOURCE_NOT_FOUND', 'Không còn bản CCCD đầy đủ trong kho mô phỏng (chỉ lưu 4 số cuối).');
    const mutationMeta = meta();
    dispatch({ type: 'nationalIds/viewed', view: { id: generateId('NIDV'), customerId, viewerId: mutationMeta.actorId, viewedAt: mutationMeta.now }, meta: mutationMeta });
    return ok({ nationalId, viewedAt: mutationMeta.now });
  };

  // ------------------------------------------------------------------ Xóa / khôi phục / xóa vĩnh viễn (Sửa đổi D)

  /** Thông báo lỗi từ chối xóa theo `getDeleteDenial`. */
  const rejectDelete = <T,>(denial: ReturnType<typeof getDeleteDenial>): ApiResult<T> | null => {
    if (denial === 'FORBIDDEN') return fail(403, 'INSUFFICIENT_ROLE', FORBIDDEN_MESSAGE);
    if (denial === 'NOT_DROPPED') return fail(409, 'CUSTOMER_NOT_DROPPED', 'Khách chưa thuộc danh sách Bỏ nên chưa thể xóa.');
    return null;
  };

  const validateReason = (reason: string): ApiResult<never> | null => {
    if (!hasVisibleChar(reason)) return fail(400, 'VALIDATION_FAILED', 'payload.reason phải có ít nhất một ký tự nhìn thấy được');
    if (reason.trim().length > DELETE_REASON_MAX_LENGTH) return fail(400, 'VALIDATION_FAILED', `Lý do tối đa ${DELETE_REASON_MAX_LENGTH} ký tự.`);
    return null;
  };

  /** Xóa mềm 1 khách (đơn hoặc trong lô). `requireDropped`: lô luôn đòi khách "Bỏ". Trả mã lỗi nếu bị từ chối. */
  const applyDelete = (customerId: string, reason: string, requireDropped: boolean): ApiResult<void> => {
    const state = stateOf();
    const actor = getActor();
    const customer = findAccessibleCustomer(state, actor, customerId);
    if (!customer) return fail(404, 'CUSTOMER_NOT_FOUND', NOT_FOUND);
    const isDropped = getListGroupOfStatus(state.catalogs.statuses, customer.statusId) === 'DROPPED';
    const rejected = rejectDelete<void>(getDeleteDenial(actor, customer, state.users, { isDropped, requireDropped }));
    if (rejected) return rejected;
    dispatch({ type: 'customers/softDelete', customerId, reason: reason.trim(), meta: meta(reason.trim()) });
    return ok(undefined);
  };

  const deleteCustomer = (customerId: string, reason: string): ApiResult<void> => {
    const invalidReason = validateReason(reason);
    if (invalidReason) return invalidReason;
    return applyDelete(customerId, reason, false);
  };

  const restoreCustomer = (customerId: string): ApiResult<{ id: string }> => {
    const denied = requireAdmin<{ id: string }>('Chỉ Quản trị được khôi phục khách.');
    if (denied) return denied;
    const customer = findRaw(customerId);
    if (!customer?.deletedAt) return fail(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách đã xóa.');
    if (customer.anonymizedAt) return fail(409, 'CUSTOMER_ANONYMIZED', 'Khách này đã bị ẩn danh hóa nên không khôi phục được.');
    if (customer.isPurgeInProgress) return fail(409, 'CUSTOMER_PURGE_IN_PROGRESS', 'Khách này đang được xóa vĩnh viễn dở dang nên không khôi phục được nữa.');
    dispatch({ type: 'customers/restore', customerId, meta: meta() });
    return ok({ id: customerId });
  };

  const purgeDeletedCustomer = (customerId: string): ApiResult<PurgeResult> => {
    const denied = requireAdmin<PurgeResult>('Chỉ Quản trị mới được xóa vĩnh viễn.');
    if (denied) return denied;
    const state = stateOf();
    const customer = state.customers.find((item) => item.id === customerId);
    if (!customer) return fail(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách đã xóa.');
    if (!customer.deletedAt) return fail(409, 'CUSTOMER_NOT_DELETED', 'Khách này chưa ở trạng thái đã xóa (có thể vừa được khôi phục).');
    const purged = {
      careLogs: state.careLogs.filter((log) => log.customerId === customerId).length,
      attachments: 0,
      files: 0,
      appointments: state.appointments.filter((appointment) => appointment.customerId === customerId).length,
      careTeamRequests: state.careTeamRequests.filter((request) => request.customerId === customerId).length,
      reminders: 0,
      notifications: state.notifications.filter((item) => item.customerId === customerId).length,
      auditLogs: state.changeLogs.filter((log) => log.customerId === customerId).length,
    };
    dispatch({ type: 'customers/purge', customerId });
    storeNationalId(customerId, '');
    // Lịch sử của khách bị xóa hết; chỉ còn ĐÚNG MỘT dòng ghi nhận (ai, lúc nào, mã khách) — KHÔNG chứa tên/SĐT/email (khớp lời hứa ở hộp thoại).
    audit('CUSTOMER_PURGED', 'CUSTOMER', customerId, []);
    return ok({ customerId, purged });
  };

  // ------------------------------------------------------------------ Nhóm chăm sóc (05 §2.5)

  const notifyAssigned = (userIds: readonly string[], customer: Customer) =>
    userIds.forEach((userId) =>
      notify(userId, {
        type: 'CUSTOMER_ASSIGNED',
        title: 'Bạn được phân khách mới',
        body: `${customer.fullName} đã được thêm vào nhóm chăm sóc của bạn.`,
        customerId: customer.id,
        deepLink: `/crm/customers/${customer.id}`,
      }),
    );

  /**
   * `POST /crm/customers/:id/care-team-members` (v1.0.5). Quản trị/Quản lý/PRIMARY được mời, KHÔNG giới hạn theo nhóm của người gọi.
   * - Nhóm RỖNG: bắt buộc `primaryUserId` (400 `PRIMARY_REQUIRED`) và chỉ Quản trị/Quản lý được chọn (403 `CARE_TEAM_ACTION_FORBIDDEN`).
   * - Nhóm CÓ người: chỉ thêm MEMBER; gửi `primaryUserId` -> 400 `VALIDATION_FAILED`.
   * - Đã trong nhóm -> 409 `ALREADY_IN_CARE_TEAM`; vượt 10 MEMBER -> 409 `CARE_TEAM_LIMIT_EXCEEDED`.
   */
  const addCareTeamMembers = (customerId: string, body: { userIds: string[]; primaryUserId?: string }): ApiResult<{ primaryUserId: string | null }> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    const customer = loaded.data;
    const actor = getActor();
    const permissions = getCustomerPermissions(actor, customer);
    if (!permissions.canManageCareTeam) {
      return fail(403, 'CARE_TEAM_ACTION_FORBIDDEN', 'Chỉ Quản lý, Quản trị hoặc phụ trách chính được thêm người chăm sóc.');
    }
    const currentPrimary = getPrimaryUserId(customer.careTeam);
    if (!currentPrimary) {
      if (!body.primaryUserId) return fail(400, 'PRIMARY_REQUIRED', 'Khách chưa có phụ trách chính: vui lòng chọn người phụ trách chính.');
      if (!permissions.canSetInitialPrimary) return fail(403, 'CARE_TEAM_ACTION_FORBIDDEN', 'Chỉ Quản lý/Quản trị được chọn người phụ trách chính ban đầu.');
    } else if (body.primaryUserId) {
      return fail(400, 'VALIDATION_FAILED', 'Khách đã có phụ trách chính: chỉ được thêm người chăm sóc (MEMBER).');
    }
    const notAssignable = assertAssignableUsers(stateOf(), [...body.userIds, body.primaryUserId]);
    if (notAssignable) return rejectAssignment(notAssignable);
    const alreadyIn = body.userIds.filter((userId) => isInCareTeam(customer.careTeam, userId));
    if (alreadyIn.length > 0) return fail(409, 'ALREADY_IN_CARE_TEAM', 'Người này đã có trong nhóm chăm sóc.', { userIds: alreadyIn });
    const stamp = now().toISOString();
    if (!currentPrimary) {
      const team = buildCareTeam(body.primaryUserId ?? null, body.userIds, actor.userId, stamp);
      if (countMembers(team) > MAX_CARE_TEAM_MEMBERS) return fail(409, 'CARE_TEAM_LIMIT_EXCEEDED', `Mỗi khách tối đa ${MAX_CARE_TEAM_MEMBERS} người chăm sóc (không tính phụ trách chính).`);
      notifyAssigned(team.map((member) => member.userId), customer);
      return updateCareTeam(customer, team, 'CARE_TEAM_MEMBER_ADDED');
    }
    const newIds = [...new Set(body.userIds)];
    if (newIds.length === 0) return ok({ primaryUserId: currentPrimary });
    if (countMembers(customer.careTeam) + newIds.length > MAX_CARE_TEAM_MEMBERS) {
      return fail(409, 'CARE_TEAM_LIMIT_EXCEEDED', `Mỗi khách tối đa ${MAX_CARE_TEAM_MEMBERS} người chăm sóc (không tính phụ trách chính).`);
    }
    const newMembers = newIds.map((userId) => ({ userId, role: 'MEMBER' as const, addedBy: actor.userId, addedAt: stamp }));
    notifyAssigned(newIds, customer);
    return updateCareTeam(customer, [...customer.careTeam, ...newMembers], 'CARE_TEAM_MEMBER_ADDED');
  };

  /** `DELETE /crm/customers/:id/care-team-members/:userId` (v1.0.5): gỡ PRIMARY luôn bị từ chối 409 `PRIMARY_LOCKED`. */
  const removeCareTeamMember = (customerId: string, userId: string): ApiResult<{ primaryUserId: string | null }> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    const customer = loaded.data;
    if (!getCustomerPermissions(getActor(), customer).canManageCareTeam) {
      return fail(403, 'CARE_TEAM_ACTION_FORBIDDEN', 'Bạn không có quyền gỡ người chăm sóc.');
    }
    if (getPrimaryUserId(customer.careTeam) === userId) {
      return fail(409, 'PRIMARY_LOCKED', 'Không thể gỡ hay đổi người phụ trách chính.');
    }
    return updateCareTeam(customer, customer.careTeam.filter((member) => member.userId !== userId), 'CARE_TEAM_MEMBER_REMOVED');
  };

  /**
   * Chọn PRIMARY ban đầu khi nhóm RỖNG (khách cũ chưa ai phụ trách). Chỉ Quản trị/Quản lý (403 nếu khác); nhóm đã có người ->
   * 409 `PRIMARY_LOCKED` (đã khóa, không đổi được nữa). Thay `changePrimary` (backend đã gỡ `PUT care-team/primary`).
   */
  const setInitialPrimary = (customerId: string, userId: string): ApiResult<{ primaryUserId: string | null }> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    const customer = loaded.data;
    if (customer.careTeam.length > 0) return fail(409, 'PRIMARY_LOCKED', 'Không thể gỡ hay đổi người phụ trách chính.');
    if (!getCustomerPermissions(getActor(), customer).canSetInitialPrimary) {
      return fail(403, 'CARE_TEAM_ACTION_FORBIDDEN', 'Chỉ Quản lý/Quản trị được chọn người phụ trách chính ban đầu.');
    }
    const notAssignable = assertAssignableUsers(stateOf(), [userId]);
    if (notAssignable) return rejectAssignment(notAssignable);
    notifyAssigned([userId], customer);
    return updateCareTeam(customer, buildCareTeam(userId, [], getActor().userId, now().toISOString()), 'CARE_TEAM_MEMBER_ADDED');
  };

  // ------------------------------------------------------------------ Nhật ký chăm sóc (05 §2.6)

  const careLogViewOf = (customerId: string, careLogId: string): CareLogView | undefined => listCareLogs(stateOf(), getActor(), customerId, now()).find((item) => item.id === careLogId);

  const createCareLog = (customerId: string, input: CreateCareLogInput, _primaryUserId: string | null = null): ApiResult<CareLogView> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    const content = input.content.trim();
    if (!content || content.length > MAX_CONTENT_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Nội dung nhật ký từ 1 đến 5000 ký tự.');
    const actor = getActor();
    const mutationMeta = meta();
    const careLogId = generateId('LOG');
    const dueAt = input.nextAction?.dueAt || null;
    let appointmentId: string | null = null;

    if (dueAt && input.nextAction?.appointment) {
      const appointmentInput = input.nextAction.appointment;
      if (appointmentInput.projectId && !stateOf().catalogs.projects.some((project) => project.id === appointmentInput.projectId && project.isActive && !project.deletedAt)) {
        return fail(400, 'INVALID_CATALOG_REF', 'Dự án không tồn tại hoặc đã ngừng hoạt động.');
      }
      appointmentId = generateId('APT');
      const appointment: Appointment = {
        id: appointmentId,
        customerId,
        type: appointmentInput.type,
        title: input.nextAction.suggestion?.trim() || 'Chăm sóc tiếp theo',
        startAt: dueAt,
        endAt: null,
        location: appointmentInput.location?.trim() ?? '',
        note: content.length > 200 ? `${content.slice(0, 200)}…` : content,
        assigneeId: isInCareTeam(loaded.data.careTeam, actor.userId) ? actor.userId : (getPrimaryUserId(loaded.data.careTeam) ?? actor.userId),
        remindBeforeMinutes: appointmentInput.remindBeforeMinutes ?? [60],
        status: 'SCHEDULED',
        completedAt: null,
        createdBy: actor.userId,
        sourceCareLogId: careLogId,
        smsZnsAuto: false,
        calendarSync: false,
        projectId: appointmentInput.projectId ?? null,
        version: 1,
      };
      dispatch({ type: 'appointments/add', appointment, meta: meta() });
    }

    const suggestion = input.nextAction?.suggestion?.trim() ?? '';
    const nextAction: NextAction | null = suggestion || dueAt ? { suggestion, dueAt, appointmentId, completedAt: null } : null;
    const careLog: CareLog = {
      id: careLogId,
      customerId,
      authorId: actor.userId,
      authorName: nameOf(actor.userId),
      occurredAt: input.occurredAt ?? mutationMeta.now,
      createdAt: mutationMeta.now,
      content,
      contactChannel: input.contactChannel,
      contactResultId: input.contactResultId ?? null,
      nextAction,
      source: 'MANUAL',
    };
    dispatch({ type: 'careLogs/add', careLog, meta: mutationMeta });
    const view = careLogViewOf(customerId, careLogId);
    return view ? ok(view) : fail(500, 'INTERNAL_ERROR', 'Không lưu được nhật ký.');
  };

  /** Sửa/xóa nhật ký: tác giả trong `careLogEditWindowHours` giờ, Quản trị, Quản lý (trong phạm vi). */
  const loadCareLogForEdit = (customerId: string, logId: string): ApiResult<CareLog> => {
    const loaded = loadForUpdate(customerId);
    if (!loaded.ok) return loaded;
    const log = stateOf().careLogs.find((item) => item.id === logId && item.customerId === customerId);
    if (!log) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy nhật ký.');
    if (!careLogViewOf(customerId, logId)?.canEdit) return fail(403, 'INSUFFICIENT_ROLE', 'Bạn chỉ sửa/xóa được nhật ký của mình trong thời hạn cho phép.');
    return ok(log);
  };

  const updateCareLog = (customerId: string, logId: string, body: { content?: string; contactChannel?: string; contactResultId?: string | null; occurredAt?: string; attachmentIds?: string[] }, _primaryUserId: string | null = null): ApiResult<CareLogView> => {
    const loaded = loadCareLogForEdit(customerId, logId);
    if (!loaded.ok) return loaded;
    const patch: Partial<Pick<CareLog, 'content' | 'contactChannel' | 'contactResultId' | 'occurredAt'>> = {};
    if (body.content !== undefined) {
      const content = body.content.trim();
      if (!content || content.length > MAX_CONTENT_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Nội dung nhật ký từ 1 đến 5000 ký tự.');
      patch.content = content;
    }
    if (body.contactChannel !== undefined) patch.contactChannel = body.contactChannel as CareLog['contactChannel'];
    if (body.contactResultId !== undefined) patch.contactResultId = body.contactResultId;
    if (body.occurredAt !== undefined) patch.occurredAt = body.occurredAt;
    dispatch({ type: 'careLogs/update', careLogId: logId, patch, meta: meta() });
    const view = careLogViewOf(customerId, logId);
    return view ? ok(view) : fail(500, 'INTERNAL_ERROR', 'Không lưu được nhật ký.');
  };

  const deleteCareLog = (customerId: string, logId: string, _reason?: string): ApiResult<void> => {
    const loaded = loadCareLogForEdit(customerId, logId);
    if (!loaded.ok) return loaded;
    dispatch({ type: 'careLogs/delete', careLogId: logId, meta: meta() });
    return ok(undefined);
  };

  /** Ảnh đính kèm TẮT (cờ `isAttachmentsEnabled`): backend tắt thì API upload trả 404. */
  const uploadCareLogAttachment = (_customerId: string, _file: File): ApiResult<{ id: string; status: 'READY' }> => fail(404, 'RESOURCE_NOT_FOUND', 'Tính năng ảnh đính kèm chưa được bật.');
  const deleteCareLogAttachment = (_customerId: string, _attachmentId: string): ApiResult<void> => fail(404, 'RESOURCE_NOT_FOUND', 'Tính năng ảnh đính kèm chưa được bật.');
  const removeSavedCareLogAttachment = deleteCareLogAttachment;

  /** Đánh dấu đã xử lý "bước tiếp theo" (backend: PATCH care-log `nextAction.completedAt`). */
  const completeFollowUp = (careLogId: string): ApiResult<{ careLogId: string }> => {
    const state = stateOf();
    const log = state.careLogs.find((item) => item.id === careLogId);
    if (!log || !findAccessibleCustomer(state, getActor(), log.customerId)) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy việc.');
    dispatch({ type: 'followUps/complete', careLogId, meta: meta() });
    return ok({ careLogId });
  };

  // ------------------------------------------------------------------ Lịch hẹn (05 §2.9)

  const appointmentViewOf = (appointmentId: string): AppointmentView | undefined => {
    const state = stateOf();
    const appointment = state.appointments.find((item) => item.id === appointmentId);
    const customer = appointment ? findAccessibleCustomer(state, getActor(), appointment.customerId) : null;
    return appointment && customer ? toAppointmentView(state, getActor(), appointment, customer) : undefined;
  };

  const loadAppointment = (appointmentId: string, version?: number): ApiResult<Appointment> => {
    const state = stateOf();
    const appointment = state.appointments.find((item) => item.id === appointmentId);
    if (!appointment || !findAccessibleCustomer(state, getActor(), appointment.customerId)) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy lịch hẹn.');
    if (version !== undefined && version !== (appointment.version ?? 1)) {
      return fail(409, 'VERSION_CONFLICT', 'Lịch hẹn vừa được người khác cập nhật. Vui lòng tải lại để xem thay đổi mới nhất.', { currentVersion: appointment.version ?? 1 });
    }
    return ok(appointment);
  };

  /** `POST /crm/appointments` — người thực hiện phải thuộc nhóm chăm sóc; cập nhật `nextAppointmentAt` của khách. */
  const createAppointment = (input: CreateAppointmentInput): ApiResult<AppointmentView> => {
    const loaded = loadForUpdate(input.customerId);
    if (!loaded.ok) return loaded;
    const actor = getActor();
    const careTeam = loaded.data.careTeam;
    const assigneeId = input.assigneeId ?? (isInCareTeam(careTeam, actor.userId) ? actor.userId : getPrimaryUserId(careTeam)) ?? actor.userId;
    // Người thực hiện phải tồn tại, đang hoạt động, có role Quản lý/Nhân viên (khách chưa có nhóm thì KHÔNG tự gán Quản trị).
    const notAssignable = assertAssignableUsers(stateOf(), [assigneeId]);
    if (notAssignable) return rejectAssignment(notAssignable);
    if (careTeam.length > 0 && !isInCareTeam(careTeam, assigneeId)) return fail(400, 'USER_NOT_ASSIGNABLE', 'Người thực hiện phải thuộc nhóm chăm sóc của khách.', { userIds: [assigneeId] });
    if (Number.isNaN(new Date(input.startAt).getTime())) return fail(400, 'VALIDATION_FAILED', 'Thời gian hẹn không hợp lệ.');
    if (toVnDateKey(input.startAt) < getVnTodayKey(now())) return fail(400, 'APPOINTMENT_IN_PAST', 'Ngày hẹn không được ở quá khứ.');
    if (input.projectId && !stateOf().catalogs.projects.some((project) => project.id === input.projectId && project.isActive && !project.deletedAt)) {
      return fail(400, 'INVALID_CATALOG_REF', 'Dự án không tồn tại hoặc đã ngừng hoạt động.');
    }
    const id = generateId('APT');
    const appointment: Appointment = {
      id,
      customerId: input.customerId,
      type: input.type,
      title: input.title?.trim() ?? '',
      startAt: input.startAt,
      endAt: input.endAt ?? null,
      location: input.location?.trim() ?? '',
      note: input.note?.trim() ?? '',
      assigneeId,
      remindBeforeMinutes: input.remindBeforeMinutes ?? [60],
      status: 'SCHEDULED',
      completedAt: null,
      createdBy: actor.userId,
      sourceCareLogId: null,
      smsZnsAuto: false,
      calendarSync: false,
      projectId: input.projectId ?? null,
      outcome: null,
      version: 1,
    };
    dispatch({ type: 'appointments/add', appointment, meta: meta() });
    notify(assigneeId, { type: 'APPOINTMENT_DUE', title: 'Bạn có lịch hẹn mới', body: `${appointment.title || 'Lịch hẹn'} với khách ${loaded.data.fullName}.`, customerId: input.customerId, appointmentId: id, deepLink: '/crm/appointments' });
    const view = appointmentViewOf(id);
    return view ? ok(view) : fail(500, 'INTERNAL_ERROR', 'Không tạo được lịch hẹn.');
  };

  /** `PATCH /crm/appointments/:id` — dời giờ lịch đang chờ (version chống ghi đè). */
  const updateAppointment = (appointmentId: string, body: { version?: number; startAt?: string; endAt?: string | null }): ApiResult<AppointmentView> => {
    const loaded = loadAppointment(appointmentId, body.version);
    if (!loaded.ok) return loaded;
    if (loaded.data.status !== 'SCHEDULED') return fail(409, 'APPOINTMENT_NOT_SCHEDULED', 'Chỉ dời được lịch đang chờ thực hiện.');
    if (body.startAt !== undefined) {
      if (Number.isNaN(new Date(body.startAt).getTime())) return fail(400, 'VALIDATION_FAILED', 'Thời gian hẹn không hợp lệ.');
      if (toVnDateKey(body.startAt) < getVnTodayKey(now())) return fail(400, 'APPOINTMENT_IN_PAST', 'Ngày hẹn không được ở quá khứ.');
    }
    dispatch({ type: 'appointments/update', appointmentId, patch: { ...(body.startAt !== undefined ? { startAt: body.startAt } : {}), ...(body.endAt !== undefined ? { endAt: body.endAt } : {}) }, meta: meta() });
    const view = appointmentViewOf(appointmentId);
    return view ? ok(view) : fail(500, 'INTERNAL_ERROR', 'Không lưu được lịch hẹn.');
  };

  const updateAppointmentStatus = (
    appointmentId: string,
    status: AppointmentStatus,
    extras: { version?: number; outcome?: string; createCareLog?: boolean } = {},
  ): ApiResult<{ appointment: AppointmentView; careLog: CareLogView | null }> => {
    const loaded = loadAppointment(appointmentId, extras.version);
    if (!loaded.ok) return loaded;
    dispatch({ type: 'appointments/setStatus', appointmentId, status, outcome: extras.outcome?.trim() || null, meta: meta() });
    const appointment = appointmentViewOf(appointmentId);
    if (!appointment) return fail(500, 'INTERNAL_ERROR', 'Không lưu được lịch hẹn.');
    // Ghi kết quả buổi hẹn thành nhật ký chăm sóc khi người dùng chọn.
    let careLog: CareLogView | null = null;
    if (extras.createCareLog && extras.outcome?.trim()) {
      const created = createCareLog(loaded.data.customerId, { content: extras.outcome.trim(), contactChannel: 'MEETING' });
      careLog = created.ok ? created.data : null;
    }
    return ok({ appointment, careLog });
  };

  const deleteAppointment = (appointmentId: string): ApiResult<void> => {
    const loaded = loadAppointment(appointmentId);
    if (!loaded.ok) return loaded;
    const view = appointmentViewOf(appointmentId);
    if (!view?.canDelete) return fail(403, 'INSUFFICIENT_ROLE', FORBIDDEN_MESSAGE);
    dispatch({ type: 'appointments/delete', appointmentId, meta: meta() });
    return ok(undefined);
  };

  // ------------------------------------------------------------------ Hàng loạt (05 §2.3)

  /** `POST /crm/customer-bulk-operations` (≤ 200 khách/lần). Nhân viên không được `ASSIGN`; `ASSIGN` chỉ thêm MEMBER (v1.0.5). */
  const bulkOperation = (operation: BulkOperation): ApiResult<BulkResult> => {
    if (operation.customerIds.length > MAX_BULK_SIZE) return fail(400, 'VALIDATION_FAILED', `Tối đa ${MAX_BULK_SIZE} khách mỗi lần.`);
    const actor = getActor();
    if (operation.type === 'ASSIGN') {
      if (!canBulkAssign(actor.role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản lý/Quản trị được phân người chăm sóc hàng loạt.');
      const notAssignable = assertAssignableUsers(stateOf(), operation.memberIds);
      if (notAssignable) return rejectAssignment(notAssignable);
      // v1.0.5: mời KHÔNG giới hạn theo nhóm của người gọi (khác trước) nên không còn kiểm USER_OUT_OF_TEAM.
    }
    if (operation.type === 'ADD_TAGS') {
      const refError = findInvalidCatalogRef(stateOf().catalogs, { tagIds: operation.tagIds });
      if (refError) return fail(400, 'INVALID_CATALOG_REF', refError);
    }
    if (operation.type === 'CHANGE_STATUS' && !stateOf().catalogs.statuses.some((status) => status.id === operation.statusId && status.isActive)) {
      return fail(400, 'STATUS_NOT_FOUND', 'Tình trạng không tồn tại hoặc đã ngừng dùng.', { statusId: operation.statusId });
    }
    if (operation.type === 'DELETE') {
      const invalidReason = validateReason(operation.reason);
      if (invalidReason) return invalidReason;
    }
    const succeeded: string[] = [];
    const failed: { customerId: string; errorCode: string }[] = [];
    operation.customerIds.forEach((customerId) => {
      if (operation.type === 'DELETE') {
        const result = applyDelete(customerId, operation.reason, true);
        if (result.ok) succeeded.push(customerId);
        else failed.push({ customerId, errorCode: result.error.errorCode });
        return;
      }
      const customer = findAccessibleCustomer(stateOf(), actor, customerId);
      if (!customer) {
        failed.push({ customerId, errorCode: 'CUSTOMER_NOT_FOUND' });
        return;
      }
      const versionBefore = customer.version;
      if (operation.type === 'CHANGE_STATUS') {
        if (customer.statusId === operation.statusId) {
          succeeded.push(customerId);
          return;
        }
        update(customerId, { statusId: operation.statusId }, 'STATUS_CHANGED');
      }
      if (operation.type === 'ADD_TAGS') {
        const tagIds = [...new Set([...customer.tagIds, ...operation.tagIds])];
        if (tagIds.length === customer.tagIds.length) {
          succeeded.push(customerId);
          return;
        }
        update(customerId, { tagIds }, 'CUSTOMER_UPDATED');
      }
      if (operation.type === 'REMOVE_TAGS') {
        const tagIds = customer.tagIds.filter((id) => !operation.tagIds.includes(id));
        if (tagIds.length === customer.tagIds.length) {
          succeeded.push(customerId);
          return;
        }
        update(customerId, { tagIds }, 'CUSTOMER_UPDATED');
      }
      if (operation.type === 'ASSIGN') {
        const stamp = now().toISOString();
        if (customer.careTeam.length === 0) {
          // Khách chưa có PRIMARY: bulk chỉ thêm MEMBER nên không tự chọn PRIMARY được.
          failed.push({ customerId, errorCode: 'PRIMARY_REQUIRED' });
          return;
        }
        const additions = [...new Set(operation.memberIds)].filter((userId) => !isInCareTeam(customer.careTeam, userId));
        if (additions.length === 0) {
          succeeded.push(customerId);
          return;
        }
        if (countMembers(customer.careTeam) + additions.length > MAX_CARE_TEAM_MEMBERS) {
          failed.push({ customerId, errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' });
          return;
        }
        update(customerId, { careTeam: [...customer.careTeam, ...additions.map((userId) => ({ userId, role: 'MEMBER' as const, addedBy: actor.userId, addedAt: stamp }))] }, 'CARE_TEAM_MEMBER_ADDED');
      }
      // Chỉ tính thành công khi reducer THẬT SỰ đổi hồ sơ (version tăng); bị từ chối âm thầm thì báo lỗi.
      if (findRaw(customerId)?.version === versionBefore) failed.push({ customerId, errorCode: 'NOT_APPLIED' });
      else succeeded.push(customerId);
    });
    return ok({ succeeded, failed });
  };

  return {
    // Khách
    createCustomer,
    updateCustomer,
    updateCustomerStatus,
    updateCustomerCriteria,
    putNationalId,
    deleteNationalId,
    createPhoneView,
    createNationalIdView,
    saveCustomerProfile,
    deleteCustomer,
    restoreCustomer,
    purgeDeletedCustomer,
    // Nhóm chăm sóc
    addCareTeamMembers,
    removeCareTeamMember,
    setInitialPrimary,
    // Nhật ký
    createCareLog,
    updateCareLog,
    deleteCareLog,
    uploadCareLogAttachment,
    deleteCareLogAttachment,
    removeSavedCareLogAttachment,
    completeFollowUp,
    // Lịch hẹn
    createAppointment,
    updateAppointment,
    updateAppointmentStatus,
    deleteAppointment,
    // Hàng loạt, thẻ
    bulkOperation,
    createTag,
    // Quản trị
    createProject,
    updateProject,
    deleteProject,
    restoreProject,
    createCatalogItem,
    updateCatalogItem,
    deleteCatalogItem,
    createUser,
    updateUserStatus,
    updateUserRoles,
    updateUserTeams,
    addTeamMember,
    removeTeamMember,
    createTeam,
    updateTeam,
    deleteTeam,
    updateSettings,
  };
};

type Core = ReturnType<typeof createCore>;

/** Hàm ghi như app chính: bất đồng bộ, trả `Promise<ApiResult<T>>`. */
export type CrmApi = { [K in keyof Core]: Core[K] extends (...args: infer Args) => infer Result ? (...args: Args) => Promise<Result> : never } & {
  /** Chỉ để test/suy ra phụ trách chính từ nhóm chăm sóc. */
  primaryOf: (members: { user: { id: string }; role: string }[]) => string | null;
};

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const createCrmWriteApi = (dependencies: CrmWriteDependencies & { delayMs?: number }): CrmApi => {
  const core = createCore(dependencies);
  const delayMs = dependencies.delayMs ?? MOCK_WRITE_DELAY_MS;
  const wrapped = Object.fromEntries(
    Object.entries(core).map(([name, run]) => [
      name,
      async (...args: unknown[]) => {
        if (delayMs > 0) await delay(delayMs);
        return (run as (...input: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as Omit<CrmApi, 'primaryOf'>;
  return { ...wrapped, primaryOf: (members) => members.find((member) => member.role === 'PRIMARY')?.user.id ?? null };
};

export { buildActor };
