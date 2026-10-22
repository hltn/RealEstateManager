/**
 * Bản MOCK của lớp truy cập dữ liệu CRM: mỗi hàm ứng với 1 endpoint ghi của tài liệu 05 (tên + input + lỗi giống API thật),
 * chạy trên store Zustand trong trình duyệt. Khi có backend: viết `httpCrmApi` cùng interface `CrmApi` (axios + React Query),
 * đổi nơi khởi tạo trong `api/hooks.ts` — UI không phải sửa.
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
  getPrimaryUserId,
  isInCareTeam,
  isValidNationalId,
} from '@crm/lib/customerRules';
import { getVnTodayKey, toVnDateKey } from '@crm/lib/dateTime';
import { createId } from '@crm/lib/id';
import { createEmptyProject, diffProject, getFirstProjectError, getProjectErrors, isProjectCodeTaken, isValidProjectCode, normalizeProject } from '@crm/lib/projectRules';
import { INVALID_EMAIL_MESSAGE, isValidEmail } from '@crm/lib/email';
import { checkImportLimits } from '@crm/lib/importCustomers';
import { getNationalIdLast4, revealNationalId, storeNationalId } from '@crm/lib/nationalIdVault';
import { normalizePhone } from '@crm/lib/phone';
import { normalizeVietnamese } from '@crm/lib/text';
import type { CatalogKind, CrmAction, CrmState, CustomerPatch, MutationMeta } from '@crm/store/crmReducer';
import { selectCurrentUser } from '@crm/store/selectors';
import type {
  Appointment,
  AppointmentStatus,
  AuditAction,
  AuditLog,
  CareLog,
  CareTeamMember,
  CareTeamRequest,
  ChangeAction,
  CrmCatalogs,
  CrmSettings,
  CrmUser,
  Customer,
  FieldChange,
  NextAction,
  Project,
  Tag,
} from '@crm/types/crm';
import { assertAssignableUsers } from './assignable';
import { countCatalogUsage, validateCatalogItem, validateSettings, validateUser } from './catalogAdmin';
import { buildActor, canAccessCustomer, canBulkAssign, canExportCustomers, canImportCustomers, canManageProjects, getCustomerPermissions, type CrmActor } from './access';
import { buildCustomerExport, type CustomerExportFile } from './exports';
import { findAccessibleCustomer, getCustomer, listAssignableUsers, listCareLogs, lookupPhone, resolveJoinRef, toStatusRef } from './queries';
import type {
  ApiError,
  ApiResult,
  CareLogView,
  CreateAppointmentInput,
  CreateCareLogInput,
  CreateCustomerInput,
  CriteriaPatch,
  CustomerDetail,
  CustomerListQuery,
  PersonaValueInput,
  PhoneLookupResult,
  UpdateCustomerInput,
  UpdateStatusResult,
} from './types';

export interface MockCrmApiDependencies {
  getState: () => CrmState;
  dispatch: (action: CrmAction) => void;
  now?: () => Date;
  generateId?: (prefix: string) => string;
}

export type BulkOperation =
  | { type: 'CHANGE_STATUS'; customerIds: string[]; statusId: string }
  | { type: 'ADD_TAGS'; customerIds: string[]; tagIds: string[] }
  /** `primaryUserId` bắt buộc khi có khách chưa có phụ trách chính (không tự lấy người đầu làm PRIMARY). */
  | { type: 'ASSIGN'; customerIds: string[]; memberIds: string[]; primaryUserId?: string };

export interface ImportCustomerRow {
  fullName: string;
  phone: string;
  statusId?: string;
  sourceId?: string | null;
  interestedProjectIds?: string[];
  areaId?: string | null;
  primaryUserId?: string | null;
  notes?: string;
}

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = <T>(statusCode: number, errorCode: string, message: string, details?: Record<string, unknown>): ApiResult<T> => ({
  ok: false,
  error: { statusCode, errorCode, message, details } satisfies ApiError,
});

/** Lỗi `assertAssignableUsers` -> ApiResult thất bại. */
const rejectAssignment = <T>(error: NonNullable<ReturnType<typeof assertAssignableUsers>>): ApiResult<T> =>
  fail(error.statusCode, error.errorCode, error.message, error.details);

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

/** Trường nhập của dự án (không gồm id). */
export type ProjectInput = Omit<Project, 'id' | 'isActive' | 'deletedAt'> & { isActive?: boolean };

/** Khu vực của dự án (nếu chọn) phải tồn tại và đang dùng. */
const findInvalidProjectArea = (catalogs: CrmCatalogs, project: Project): string | null =>
  project.areaId && !catalogs.areas.some((area) => area.id === project.areaId && area.isActive) ? 'Khu vực không tồn tại hoặc đã ngừng dùng.' : null;

const NOT_FOUND = 'Không tìm thấy khách hàng hoặc bạn không có quyền xem khách này.';
const MAX_NAME_LENGTH = 150;
const MAX_CONTENT_LENGTH = 5000;
const MAX_BULK_SIZE = 200;

export const createMockCrmApi = ({ getState, dispatch, now = () => new Date(), generateId = createId }: MockCrmApiDependencies) => {
  const getActor = (): CrmActor => {
    const state = getState();
    return buildActor(selectCurrentUser(state), state.teams);
  };

  const meta = (reason?: string, source: MutationMeta['source'] = 'WEB'): MutationMeta => ({
    actorId: getActor().userId,
    now: now().toISOString(),
    changeLogId: generateId('CHG'),
    source,
    reason,
  });

  /** Lấy khách trong phạm vi + kiểm version (optimistic concurrency, 409 `VERSION_CONFLICT`). */
  const loadForUpdate = (customerId: string, version?: number): ApiResult<Customer> => {
    const state = getState();
    const customer = findAccessibleCustomer(state, getActor(), customerId);
    if (!customer) return fail(404, 'CUSTOMER_NOT_FOUND', NOT_FOUND);
    if (version !== undefined && version !== customer.version) {
      return fail(409, 'VERSION_CONFLICT', 'Hồ sơ vừa được người khác cập nhật. Vui lòng tải lại để xem thay đổi mới nhất.', {
        currentVersion: customer.version,
      });
    }
    return ok(customer);
  };

  const update = (customerId: string, patch: CustomerPatch, action: ChangeAction, reason?: string) =>
    dispatch({ type: 'customers/update', customerId, patch, action, meta: meta(reason) });

  const findRaw = (customerId: string): Customer | undefined => getState().customers.find((item) => item.id === customerId);

  const detailOf = (customerId: string): CustomerDetail => getCustomer(getState(), getActor(), customerId) as CustomerDetail;


  const duplicateError = <T>(lookup: PhoneLookupResult): ApiResult<T> =>
    fail(
      409,
      'CUSTOMER_PHONE_DUPLICATED',
      lookup.caredByName ? `Đã có khách hàng với số điện thoại này, do ${lookup.caredByName} chăm sóc.` : 'Đã có khách hàng với số điện thoại này.',
      { ...lookup },
    );

  const updateCareTeam = (customer: Customer, careTeam: CareTeamMember[], action: ChangeAction): ApiResult<CustomerDetail> => {
    update(customer.id, { careTeam }, action);
    return ok(detailOf(customer.id));
  };


  /** Ghi audit log cho thao tác không thuộc riêng 1 khách (dự án, xuất danh sách). */
  const audit = (action: AuditAction, entityType: AuditLog['entityType'], entityId: string | null, changes: FieldChange[], reason?: string) => {
    const actor = getActor();
    const user = getState().users.find((item) => item.id === actor.userId);
    dispatch({
      type: 'auditLogs/add',
      log: { id: generateId('AUD'), action, entityType, entityId, actorId: actor.userId, actorName: user?.displayName ?? 'Hệ thống', actorRole: actor.role, changes, reason, createdAt: now().toISOString() },
    });
  };

  // ------------------------------------------------------------------ Dự án (chỉ Quản trị)

  /** Bỏ key `undefined` của input (JSON không có undefined) để không đè giá trị hiện có bằng undefined rồi ném TypeError. */
  const withoutUndefined = <T extends object>(input: T | null | undefined): T =>
    Object.fromEntries(Object.entries(input ?? {}).filter(([, value]) => value !== undefined)) as T;

  /**
   * Kiểm dự án trước khi lưu: lỗi nhập -> 400 `VALIDATION_FAILED`; mã trùng dự án khác (kể cả đã ngừng/xoá mềm, không phân biệt hoa
   * thường) -> 409 `PROJECT_CODE_DUPLICATED` (05 §2.8). Lỗi nhập được báo trước lỗi trùng mã.
   */
  const rejectInvalidProject = <T,>(project: Project): ApiResult<T> | null => {
    const projects = getState().catalogs.projects;
    const errors = getProjectErrors(projects, project);
    const isCodeDuplicated = isValidProjectCode(project.code) && isProjectCodeTaken(projects, project);
    const { code: codeError, ...otherErrors } = errors;
    const firstError = getFirstProjectError(isCodeDuplicated ? otherErrors : errors);
    if (firstError) return fail(400, 'VALIDATION_FAILED', firstError);
    if (isCodeDuplicated) return fail(409, 'PROJECT_CODE_DUPLICATED', codeError ?? 'Mã dự án đã tồn tại.', { code: project.code });
    return null;
  };

  /** `POST /crm/projects` — tên + mã bắt buộc, mã không trùng (kể cả dự án đã ngừng hoặc đã xoá mềm). */
  const createProject = (rawInput: Partial<ProjectInput>): ApiResult<Project> => {
    if (!canManageProjects(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được thêm dự án.');
    // `id`/`deletedAt` luôn do hệ thống quyết định: bỏ giá trị client gửi (tránh ghi đè dự án có sẵn) và ép lại SAU khi gộp input.
    const { id: _clientId, deletedAt: _clientDeletedAt, ...safeInput } = withoutUndefined(rawInput as Partial<Project>);
    const id = generateId('proj');
    const project = normalizeProject({ ...createEmptyProject(id), ...safeInput, id, isActive: safeInput.isActive ?? true, deletedAt: null });
    const rejected = rejectInvalidProject<Project>(project);
    if (rejected) return rejected;
    const refError = findInvalidProjectArea(getState().catalogs, project);
    if (refError) return fail(400, 'INVALID_CATALOG_REF', refError);
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: project });
    audit('PROJECT_CREATED', 'PROJECT', id, [
      { field: 'Tên dự án', from: '', to: project.name },
      { field: 'Mã dự án', from: '', to: project.code },
    ]);
    return ok(project);
  };

  /** `PATCH /crm/projects/:id` — sửa từng phần; `isActive` để ngừng/dùng lại. Dự án đã xoá mềm = không tồn tại (khôi phục trước). */
  const updateProject = (projectId: string, rawInput: Partial<ProjectInput>): ApiResult<Project> => {
    if (!canManageProjects(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được sửa dự án.');
    const current = getState().catalogs.projects.find((item) => item.id === projectId);
    if (!current || current.deletedAt) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy dự án.');
    const { id: _clientId, deletedAt: _clientDeletedAt, ...safeInput } = withoutUndefined(rawInput as Partial<Project>);
    const project = normalizeProject({ ...current, ...safeInput, id: current.id, deletedAt: null });
    const rejected = rejectInvalidProject<Project>(project);
    if (rejected) return rejected;
    // Khu vực đã gắn từ trước (kể cả đã ẩn) được giữ nguyên; chỉ kiểm khu vực MỚI chọn.
    const refError = project.areaId !== current.areaId ? findInvalidProjectArea(getState().catalogs, project) : null;
    if (refError) return fail(400, 'INVALID_CATALOG_REF', refError);
    const changes = diffProject(current, project, getState().catalogs.areas);
    if (changes.length === 0) return ok(current);
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: project });
    audit(current.isActive && !project.isActive ? 'PROJECT_DEACTIVATED' : 'PROJECT_UPDATED', 'PROJECT', projectId, changes);
    return ok(project);
  };

  /**
   * `DELETE /crm/projects/:id` — XOÁ MỀM (`deletedAt`, khôi phục được). Dự án còn khách quan tâm KHÔNG xoá được:
   * 409 `PROJECT_IN_USE { customerCount }` — Quản trị chuyển sang ngừng hoạt động bằng `updateProject(id, { isActive: false })`.
   */
  const deleteProject = (projectId: string): ApiResult<{ id: string }> => {
    if (!canManageProjects(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được xoá dự án.');
    const state = getState();
    const project = state.catalogs.projects.find((item) => item.id === projectId);
    if (!project || project.deletedAt) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy dự án.');
    const customerCount = countCatalogUsage(state, 'projects', projectId);
    if (customerCount > 0) {
      return fail(409, 'PROJECT_IN_USE', `Dự án đang có ${customerCount} khách quan tâm nên không thể xoá. Hãy chuyển sang ngừng hoạt động.`, { customerCount });
    }
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: { ...project, isActive: false, deletedAt: now().toISOString() } });
    audit('PROJECT_DELETED', 'PROJECT', projectId, [{ field: 'Dự án', from: project.name, to: '(đã xoá)' }]);
    return ok({ id: projectId });
  };

  /** `POST /crm/project-restorations` — khôi phục dự án đã xoá mềm (đang hoạt động trở lại). */
  const restoreProject = (projectId: string, reason?: string): ApiResult<Project> => {
    if (!canManageProjects(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được khôi phục dự án.');
    const project = getState().catalogs.projects.find((item) => item.id === projectId);
    if (!project?.deletedAt) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy dự án đã xoá.');
    const restored: Project = { ...project, deletedAt: null, isActive: true };
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: restored });
    audit('PROJECT_RESTORED', 'PROJECT', projectId, [{ field: 'Dự án', from: '(đã xoá)', to: project.name }], reason);
    return ok(restored);
  };

  return {
    // ----------------------------------------------------------------- Khách hàng (05 §2.3)

    /** `POST /crm/customers/phone-lookups` */
    lookupPhone: (phone: string, excludeCustomerId?: string): ApiResult<PhoneLookupResult> => {
      const result = lookupPhone(getState(), getActor(), phone, excludeCustomerId);
      return result ? ok(result) : fail(400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.', { input: phone });
    },

    /** `POST /crm/customers` — NV tạo khách thì tự là phụ trách chính; trùng SĐT -> 409 (không lộ chi tiết). */
    createCustomer: (input: CreateCustomerInput): ApiResult<CustomerDetail> => {
      const state = getState();
      const actor = getActor();
      const fullName = input.fullName.trim();
      if (!fullName || fullName.length > MAX_NAME_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Vui lòng nhập họ tên (tối đa 150 ký tự).');
      const phone = normalizePhone(input.phone);
      if (!phone) return fail(400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.', { input: input.phone });
      const lookup = lookupPhone(state, actor, phone);
      if (lookup?.exists) return duplicateError(lookup);
      if (input.nationalId && !isValidNationalId(input.nationalId)) return fail(400, 'VALIDATION_FAILED', 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).');
      if (input.email !== undefined && !isValidEmail(input.email)) return fail(400, 'VALIDATION_FAILED', INVALID_EMAIL_MESSAGE);

      const memberIds = input.careTeam?.memberIds ?? [];
      const requestedPrimary = input.careTeam?.primaryUserId || null;
      // Nhân viên tạo -> luôn là phụ trách chính (04 §6.1). Quản lý/Quản trị có thể chỉ định hoặc để chưa phân.
      const primaryUserId = actor.role === 'STAFF' ? actor.userId : requestedPrimary;
      if (!primaryUserId && memberIds.length > 0) return fail(400, 'PRIMARY_REQUIRED', 'Vui lòng chọn người phụ trách chính khi phân người chăm sóc.');
      const notAssignable = assertAssignableUsers(state, [primaryUserId, ...memberIds]);
      if (notAssignable) return rejectAssignment(notAssignable);
      const invalidRef = findInvalidCatalogRef(state.catalogs, { sourceId: input.sourceId, areaId: input.areaId, projectIds: input.interestedProjectIds, tagIds: input.tagIds });
      if (invalidRef) return fail(400, 'INVALID_CATALOG_REF', invalidRef);

      const mutationMeta = meta(undefined, input.createdVia === 'IMPORT' ? 'IMPORT' : 'WEB');
      const id = generateId('CUST');
      const last4 = input.nationalId ? getNationalIdLast4(input.nationalId) : null;
      const status = (input.statusId && state.catalogs.statuses.find((item) => item.id === input.statusId && item.isActive)) || getDefaultStatus(state.catalogs.statuses);
      const careTeam = buildCareTeam(primaryUserId, memberIds, actor.userId, mutationMeta.now);
      const customer: Customer = {
        id,
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
        criteria: createEmptyCriteria(),
        careTeam,
        primaryAssigneeId: getPrimaryUserId(careTeam),
        persona: [],
        occasions: [],
        personaCompleteness: 0,
        shouldRemindOccasions: true,
        notes: input.notes?.trim() ?? '',
        lastCareLogAt: null,
        nextAppointmentAt: null,
        searchText: buildSearchText({ fullName, phone, email: input.email }),
        createdAt: mutationMeta.now,
        createdBy: actor.userId,
        createdVia: input.createdVia ?? 'WEB',
        lastUpdatedAt: mutationMeta.now,
        lastUpdatedBy: actor.userId,
        version: 1,
      };
      dispatch({ type: 'customers/create', customer, meta: mutationMeta, action: input.createdVia === 'IMPORT' ? 'CUSTOMER_IMPORTED' : 'CUSTOMER_CREATED' });
      if (!getState().customers.some((item) => item.id === id)) {
        return fail(409, 'CUSTOMER_NOT_CREATED', 'Không thể tạo khách hàng (dữ liệu không hợp lệ).');
      }
      // Kho CCCD đầy đủ chỉ ghi SAU khi reducer đã chấp nhận (tránh rác nếu bị từ chối).
      if (input.nationalId && last4) storeNationalId(id, input.nationalId);
      // Người tạo vừa nhập dữ liệu nên luôn nhận lại hồ sơ, kể cả khi đã phân cho người ngoài phạm vi xem của mình.
      return ok((getCustomer(getState(), actor, id) ?? getCustomer(getState(), { ...actor, role: 'ADMIN' }, id)) as CustomerDetail);
    },

    /** `PATCH /crm/customers/:id` */
    updateCustomer: (customerId: string, input: UpdateCustomerInput): ApiResult<CustomerDetail> => {
      const loaded = loadForUpdate(customerId, input.version);
      if (!loaded.ok) return loaded;
      const refError = findInvalidCatalogRef(getState().catalogs, { sourceId: input.sourceId, areaId: input.areaId, projectIds: input.interestedProjectIds, tagIds: input.tagIds }, loaded.data);
      if (refError) return fail(400, 'INVALID_CATALOG_REF', refError);
      const patch: CustomerPatch = {};
      if (input.fullName !== undefined) {
        const fullName = input.fullName.trim();
        if (!fullName || fullName.length > MAX_NAME_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Vui lòng nhập họ tên (tối đa 150 ký tự).');
        patch.fullName = fullName;
      }
      if (input.phone !== undefined) {
        const phone = normalizePhone(input.phone);
        if (!phone) return fail(400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.', { input: input.phone });
        const lookup = lookupPhone(getState(), getActor(), phone, customerId);
        if (lookup?.exists) return duplicateError(lookup);
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
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.shouldRemindOccasions !== undefined) patch.shouldRemindOccasions = input.shouldRemindOccasions;
      update(customerId, patch, 'CUSTOMER_UPDATED');
      return ok(detailOf(customerId));
    },

    /** `PATCH /crm/customers/:id/status` — dùng lại để Hoàn tác. */
    updateCustomerStatus: (customerId: string, body: { statusId: string; version?: number; reason?: string }): ApiResult<UpdateStatusResult> => {
      const loaded = loadForUpdate(customerId, body.version);
      if (!loaded.ok) return loaded;
      const state = getState();
      const status = state.catalogs.statuses.find((item) => item.id === body.statusId && item.isActive);
      if (!status) return fail(400, 'VALIDATION_FAILED', 'Tình trạng không hợp lệ.');
      const previousStatusId = loaded.data.statusId;
      update(customerId, { statusId: status.id }, 'STATUS_CHANGED', body.reason);
      const after = getState().customers.find((item) => item.id === customerId) as Customer;
      return ok({ status: toStatusRef(getState().catalogs, status.id), previousStatusId, version: after.version, lastUpdatedAt: after.lastUpdatedAt });
    },

    /** `PATCH /crm/customers/:id/criteria` — tiến độ do hệ thống tính, không nhận từ client. */
    updateCustomerCriteria: (customerId: string, body: { version?: number; criteria: CriteriaPatch }): ApiResult<CustomerDetail> => {
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
      return ok(detailOf(customerId));
    },

    /** `PATCH /crm/customers/:id/persona` — ghi người/ngày/nguồn cho từng giá trị thay đổi (QT9). */
    updateCustomerPersona: (customerId: string, body: { version?: number; values: PersonaValueInput[] }): ApiResult<CustomerDetail> => {
      const loaded = loadForUpdate(customerId, body.version);
      if (!loaded.ok) return loaded;
      const unknownKey = body.values.find((value) => !PERSONA_FIELDS.some((field) => field.key === value.fieldKey));
      if (unknownKey) return fail(400, 'PERSONA_VALUE_INVALID', `Trường chân dung không tồn tại: ${unknownKey.fieldKey}`, { fieldKey: unknownKey.fieldKey });
      const { persona, changedKeys } = applyPersonaUpdates(
        loaded.data.persona,
        body.values.map((value) => ({ fieldKey: value.fieldKey, value: value.value ? { ...value.value, fieldKey: value.fieldKey } : null, source: value.source })),
        getActor().userId,
        now().toISOString(),
      );
      if (changedKeys.length > 0) update(customerId, { persona }, 'PERSONA_UPDATED');
      return ok(detailOf(customerId));
    },

    // ----------------------------------------------------------------- CCCD (05 §2.4)

    /** `PUT /crm/customers/:id/national-id`. Hồ sơ cập nhật TRƯỚC; kho mô phỏng chỉ ghi sau khi reducer đã chấp nhận. */
    putNationalId: (customerId: string, nationalId: string): ApiResult<CustomerDetail> => {
      const loaded = loadForUpdate(customerId);
      if (!loaded.ok) return loaded;
      if (!isValidNationalId(nationalId)) return fail(400, 'VALIDATION_FAILED', 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).');
      const last4 = getNationalIdLast4(nationalId);
      const isSameNumber = revealNationalId(customerId) === nationalId.replace(/\s/g, '');
      update(
        customerId,
        { nationalIdLast4: last4, hasNationalId: Boolean(last4), ...(isSameNumber ? {} : { nationalIdUpdatedAt: now().toISOString() }) },
        'NATIONAL_ID_UPDATED',
      );
      if (findRaw(customerId)?.nationalIdLast4 === last4) storeNationalId(customerId, nationalId);
      return ok(detailOf(customerId));
    },

    /** `DELETE /crm/customers/:id/national-id` — xoá CCCD (kho + hồ sơ), ghi changeLog. */
    deleteNationalId: (customerId: string): ApiResult<CustomerDetail> => {
      const loaded = loadForUpdate(customerId);
      if (!loaded.ok) return loaded;
      if (!loaded.data.hasNationalId) return ok(detailOf(customerId));
      update(customerId, { nationalIdLast4: null, hasNationalId: false }, 'NATIONAL_ID_UPDATED', 'Xoá CCCD');
      storeNationalId(customerId, '');
      return ok(detailOf(customerId));
    },

    /**
     * `PATCH /crm/customers/:id/profile` — lưu hồ sơ + CCCD + chân dung trong MỘT mutation nguyên tử:
     * kiểm TẤT CẢ trước, rồi mới ghi (1 lần tăng version, 1 changeLog). Lỗi ở bất kỳ phần nào -> không ghi gì.
     */
    saveCustomerProfile: (
      customerId: string,
      input: { version?: number; profile?: Omit<UpdateCustomerInput, 'version'>; nationalId?: string; personaValues?: PersonaValueInput[] },
    ): ApiResult<CustomerDetail> => {
      const loaded = loadForUpdate(customerId, input.version);
      if (!loaded.ok) return loaded;
      const patch: CustomerPatch = {};
      const profile = input.profile ?? {};
      const profileRefError = findInvalidCatalogRef(
        getState().catalogs,
        { sourceId: profile.sourceId, areaId: profile.areaId, projectIds: profile.interestedProjectIds, tagIds: profile.tagIds },
        loaded.data,
      );
      if (profileRefError) return fail(400, 'INVALID_CATALOG_REF', profileRefError);
      if (profile.fullName !== undefined) {
        const fullName = profile.fullName.trim();
        if (!fullName || fullName.length > MAX_NAME_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Vui lòng nhập họ tên (tối đa 150 ký tự).');
        patch.fullName = fullName;
      }
      if (profile.phone !== undefined) {
        const phone = normalizePhone(profile.phone);
        if (!phone) return fail(400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.', { input: profile.phone });
        const lookup = lookupPhone(getState(), getActor(), phone, customerId);
        if (lookup?.exists) return duplicateError(lookup);
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
      if (profile.notes !== undefined) patch.notes = profile.notes;
      if (profile.shouldRemindOccasions !== undefined) patch.shouldRemindOccasions = profile.shouldRemindOccasions;

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
      const isOnlyNationalId = nationalId && Object.keys(patch).every((key) => key === 'nationalIdLast4' || key === 'hasNationalId' || key === 'nationalIdUpdatedAt');
      update(customerId, patch, isOnlyPersona ? 'PERSONA_UPDATED' : isOnlyNationalId ? 'NATIONAL_ID_UPDATED' : 'CUSTOMER_UPDATED');
      // Kho CCCD đầy đủ chỉ ghi SAU khi reducer đã chấp nhận hồ sơ.
      if (nationalId && findRaw(customerId)?.nationalIdLast4 === patch.nationalIdLast4) storeNationalId(customerId, nationalId);
      return ok(detailOf(customerId));
    },

    /**
     * `POST /crm/customers/:id/phone-views` — "Hiện số"/gọi/Zalo: mọi người xem được khách (kể cả thành viên nhóm) đều được xem số;
     * MỖI lần gọi ghi 1 log PHONE_VIEWED (như CCCD) rồi trả số đầy đủ. Khách ngoài phạm vi -> 404.
     */
    createPhoneView: (customerId: string): ApiResult<{ phone: string }> => {
      const loaded = loadForUpdate(customerId);
      if (!loaded.ok) return loaded;
      dispatch({ type: 'phones/viewed', customerId, meta: meta() });
      return ok({ phone: loaded.data.phone });
    },

    /** `POST /crm/customers/:id/national-id-views` — kiểm quyền, GHI LOG mỗi lần xem rồi mới trả số. */
    createNationalIdView: (customerId: string): ApiResult<{ nationalId: string; viewedAt: string }> => {
      const loaded = loadForUpdate(customerId);
      if (!loaded.ok) return loaded;
      if (!getCustomerPermissions(getActor(), loaded.data).canRevealNationalId) {
        return fail(403, 'NATIONAL_ID_FORBIDDEN', 'Bạn không có quyền xem CCCD đầy đủ của khách này.');
      }
      const nationalId = revealNationalId(customerId);
      if (!nationalId) return fail(404, 'RESOURCE_NOT_FOUND', 'Không còn bản CCCD đầy đủ trong kho mô phỏng (chỉ lưu 4 số cuối).');
      const mutationMeta = meta();
      dispatch({
        type: 'nationalIds/viewed',
        view: { id: generateId('NIDV'), customerId, viewerId: mutationMeta.actorId, viewedAt: mutationMeta.now },
        meta: mutationMeta,
      });
      return ok({ nationalId, viewedAt: mutationMeta.now });
    },

    // ----------------------------------------------------------------- Nhóm chăm sóc (05 §2.5)

    /** `POST /crm/customers/:id/care-team/members` — lần phân đầu bắt buộc `primaryUserId`. */
    addCareTeamMembers: (customerId: string, body: { userIds: string[]; primaryUserId?: string }): ApiResult<CustomerDetail> => {
      const loaded = loadForUpdate(customerId);
      if (!loaded.ok) return loaded;
      const customer = loaded.data;
      const actor = getActor();
      if (!getCustomerPermissions(actor, customer).canManageCareTeam) {
        return fail(403, 'CARE_TEAM_ACTION_FORBIDDEN', 'Chỉ Quản lý, Quản trị hoặc phụ trách chính được thêm người chăm sóc.');
      }
      const notAssignable = assertAssignableUsers(getState(), [...body.userIds, body.primaryUserId]);
      if (notAssignable) return rejectAssignment(notAssignable);
      const currentPrimary = getPrimaryUserId(customer.careTeam);
      if (!currentPrimary && !body.primaryUserId) return fail(400, 'PRIMARY_REQUIRED', 'Khách chưa có phụ trách chính: vui lòng chọn người phụ trách chính.');
      const stamp = now().toISOString();
      if (!currentPrimary) {
        return updateCareTeam(customer, buildCareTeam(body.primaryUserId ?? null, body.userIds, actor.userId, stamp), 'CARE_TEAM_MEMBER_ADDED');
      }
      const newMembers = body.userIds
        .filter((userId) => !isInCareTeam(customer.careTeam, userId))
        .map((userId) => ({ userId, role: 'MEMBER' as const, addedBy: actor.userId, addedAt: stamp }));
      if (newMembers.length === 0) return ok(detailOf(customerId));
      return updateCareTeam(customer, [...customer.careTeam, ...newMembers], 'CARE_TEAM_MEMBER_ADDED');
    },

    /** `DELETE /crm/customers/:id/care-team/members/:userId` — gỡ phụ trách chính bắt buộc chọn người thay (chỉ A/M). */
    removeCareTeamMember: (customerId: string, userId: string, newPrimaryUserId?: string): ApiResult<CustomerDetail> => {
      const loaded = loadForUpdate(customerId);
      if (!loaded.ok) return loaded;
      const customer = loaded.data;
      const permissions = getCustomerPermissions(getActor(), customer);
      const isRemovingPrimary = getPrimaryUserId(customer.careTeam) === userId;
      if (isRemovingPrimary) {
        if (!permissions.canChangePrimary) return fail(403, 'CARE_TEAM_ACTION_FORBIDDEN', 'Chỉ Quản lý/Quản trị được gỡ người phụ trách chính.');
        if (!newPrimaryUserId || newPrimaryUserId === userId) {
          return fail(400, 'PRIMARY_REPLACEMENT_REQUIRED', 'Gỡ người phụ trách chính thì phải chọn người thay thế.');
        }
        const notAssignable = assertAssignableUsers(getState(), [newPrimaryUserId]);
        if (notAssignable) return rejectAssignment(notAssignable);
      } else if (!permissions.canManageCareTeam) {
        return fail(403, 'CARE_TEAM_ACTION_FORBIDDEN', 'Bạn không có quyền gỡ người chăm sóc.');
      }
      const actorId = getActor().userId;
      const stamp = now().toISOString();
      const remaining = customer.careTeam.filter((member) => member.userId !== userId);
      if (!isRemovingPrimary) return updateCareTeam(customer, remaining, 'CARE_TEAM_MEMBER_REMOVED');
      const withReplacement = isInCareTeam(remaining, newPrimaryUserId as string)
        ? remaining.map((member) => ({ ...member, role: member.userId === newPrimaryUserId ? ('PRIMARY' as const) : ('MEMBER' as const) }))
        : [{ userId: newPrimaryUserId as string, role: 'PRIMARY' as const, addedBy: actorId, addedAt: stamp }, ...remaining.map((member) => ({ ...member, role: 'MEMBER' as const }))];
      return updateCareTeam(customer, withReplacement, 'PRIMARY_CHANGED');
    },

    /** `PUT /crm/customers/:id/care-team/primary` — người mới tự được thêm; người cũ thành MEMBER. */
    changePrimary: (customerId: string, userId: string): ApiResult<CustomerDetail> => {
      const loaded = loadForUpdate(customerId);
      if (!loaded.ok) return loaded;
      const customer = loaded.data;
      if (!getCustomerPermissions(getActor(), customer).canChangePrimary) {
        return fail(403, 'CARE_TEAM_ACTION_FORBIDDEN', 'Chỉ Quản lý/Quản trị được đổi người phụ trách chính.');
      }
      const notAssignable = assertAssignableUsers(getState(), [userId]);
      if (notAssignable) return rejectAssignment(notAssignable);
      if (getPrimaryUserId(customer.careTeam) === userId) return ok(detailOf(customerId));
      const stamp = now().toISOString();
      const demoted = customer.careTeam.map((member) => ({ ...member, role: member.userId === userId ? ('PRIMARY' as const) : ('MEMBER' as const) }));
      const careTeam = isInCareTeam(customer.careTeam, userId)
        ? demoted
        : [{ userId, role: 'PRIMARY' as const, addedBy: getActor().userId, addedAt: stamp }, ...demoted];
      return updateCareTeam(customer, careTeam, 'PRIMARY_CHANGED');
    },

    /** `POST /crm/care-team-requests` (X2) — người gửi không biết tên khách, chỉ có `customerRef`. */
    createCareTeamRequest: (body: { customerRef: string; message?: string }): ApiResult<{ id: string; status: 'PENDING'; createdAt: string }> => {
      const state = getState();
      const actor = getActor();
      // Chỉ nhận token mờ từ `lookupPhone`. Không tồn tại / đã xem được khách / Quản trị -> CÙNG một lỗi 404 (không lộ khác biệt).
      const customer = resolveJoinRef(state, actor.userId, body.customerRef);
      if (!customer || actor.role === 'ADMIN' || canAccessCustomer(actor, customer, state.users)) return fail(404, 'RESOURCE_NOT_FOUND', 'Không thể gửi đề nghị cho khách này.');
      if (state.careTeamRequests.some((request) => request.customerId === customer.id && request.requesterId === actor.userId && request.status === 'PENDING')) {
        return fail(409, 'JOIN_REQUEST_EXISTS', 'Bạn đã gửi đề nghị và đang chờ duyệt.');
      }
      const mutationMeta = meta();
      const request: CareTeamRequest = {
        id: generateId('CTR'),
        customerId: customer.id,
        requesterId: actor.userId,
        message: body.message?.trim() ?? '',
        status: 'PENDING',
        createdAt: mutationMeta.now,
        resolvedBy: null,
        resolvedAt: null,
      };
      dispatch({ type: 'careTeamRequests/add', request, meta: mutationMeta });
      return ok({ id: request.id, status: 'PENDING', createdAt: request.createdAt });
    },

    /** `PATCH /crm/care-team-requests/:id` — duyệt/từ chối (A, M-P, PR) hoặc huỷ (người gửi). Duyệt -> thêm MEMBER. */
    resolveCareTeamRequest: (requestId: string, status: 'APPROVED' | 'REJECTED' | 'CANCELED'): ApiResult<{ id: string; status: string }> => {
      const state = getState();
      const actor = getActor();
      const request = state.careTeamRequests.find((item) => item.id === requestId);
      if (!request) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy đề nghị.');
      if (request.status !== 'PENDING') return fail(409, 'JOIN_REQUEST_RESOLVED', 'Đề nghị đã được xử lý.');
      const customer = state.customers.find((item) => item.id === request.customerId);
      if (!customer) return fail(404, 'CUSTOMER_NOT_FOUND', NOT_FOUND);
      if (status === 'CANCELED') {
        if (request.requesterId !== actor.userId) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ người gửi được huỷ đề nghị.');
      } else if (!canAccessCustomer(actor, customer, state.users) || !getCustomerPermissions(actor, customer).canReviewJoinRequests) {
        return fail(403, 'INSUFFICIENT_ROLE', 'Bạn không có quyền duyệt đề nghị này.');
      }
      if (status === 'APPROVED') {
        const notAssignable = assertAssignableUsers(state, [request.requesterId]);
        if (notAssignable) return rejectAssignment(notAssignable);
      }
      dispatch({ type: 'careTeamRequests/resolve', requestId, status, meta: meta() });
      if (status === 'APPROVED' && !isInCareTeam(customer.careTeam, request.requesterId)) {
        const stamp = now().toISOString();
        const careTeam: CareTeamMember[] =
          customer.careTeam.length === 0
            ? [{ userId: request.requesterId, role: 'PRIMARY', addedBy: actor.userId, addedAt: stamp }]
            : [...customer.careTeam, { userId: request.requesterId, role: 'MEMBER', addedBy: actor.userId, addedAt: stamp }];
        update(customer.id, { careTeam }, 'CARE_TEAM_MEMBER_ADDED');
      }
      return ok({ id: requestId, status });
    },

    // ----------------------------------------------------------------- Nhật ký chăm sóc (05 §2.6)

    /**
     * `POST /crm/customers/:id/care-logs` — tác giả = người dùng hiện tại; cập nhật `lastCareLogAt`;
     * `nextAction` (có hạn) sinh việc "Bước tiếp theo"; tuỳ chọn tạo kèm lịch hẹn tại hạn đó (C3).
     */
    createCareLog: (customerId: string, input: CreateCareLogInput): ApiResult<CareLogView> => {
      const loaded = loadForUpdate(customerId);
      if (!loaded.ok) return loaded;
      const content = input.content.trim();
      if (!content || content.length > MAX_CONTENT_LENGTH) return fail(400, 'VALIDATION_FAILED', 'Nội dung nhật ký từ 1 đến 5000 ký tự.');
      const state = getState();
      const actor = getActor();
      const author = state.users.find((user) => user.id === actor.userId) as CrmUser;
      const mutationMeta = meta();
      const careLogId = generateId('LOG');
      const dueAt = input.nextAction?.dueAt || null;
      let appointmentId: string | null = null;

      if (dueAt && input.nextAction?.appointment) {
        appointmentId = generateId('APT');
        const appointment: Appointment = {
          id: appointmentId,
          customerId,
          type: input.nextAction.appointment.type,
          title: input.nextAction.suggestion?.trim() || 'Chăm sóc tiếp theo',
          startAt: dueAt,
          endAt: null,
          location: input.nextAction.appointment.location?.trim() ?? '',
          note: content.length > 200 ? `${content.slice(0, 200)}…` : content,
          assigneeId: isInCareTeam(loaded.data.careTeam, actor.userId) ? actor.userId : (getPrimaryUserId(loaded.data.careTeam) ?? actor.userId),
          remindBeforeMinutes: [60],
          status: 'SCHEDULED',
          completedAt: null,
          createdBy: actor.userId,
          sourceCareLogId: careLogId,
          smsZnsAuto: false,
          calendarSync: false,
        };
        dispatch({ type: 'appointments/add', appointment, meta: meta() });
      }

      const suggestion = input.nextAction?.suggestion?.trim() ?? '';
      const nextAction: NextAction | null = suggestion || dueAt ? { suggestion, dueAt, appointmentId, completedAt: null } : null;
      const careLog: CareLog = {
        id: careLogId,
        customerId,
        authorId: actor.userId,
        authorName: author?.displayName ?? 'Không rõ',
        occurredAt: input.occurredAt ?? mutationMeta.now,
        content,
        contactChannel: input.contactChannel,
        contactResultId: input.contactResultId ?? null,
        nextAction,
        source: 'MANUAL',
        images: input.images && input.images.length > 0 ? input.images : undefined,
      };
      dispatch({ type: 'careLogs/add', careLog, meta: mutationMeta });
      const view = listCareLogs(getState(), actor, customerId).find((item) => item.id === careLogId);
      return view ? ok(view) : fail(500, 'INTERNAL_ERROR', 'Không lưu được nhật ký.');
    },

    /** Đánh dấu đã xử lý "bước tiếp theo" (mở rộng prototype, backend: PATCH care-log `nextAction.completedAt`). */
    completeFollowUp: (careLogId: string): ApiResult<{ careLogId: string }> => {
      const state = getState();
      const log = state.careLogs.find((item) => item.id === careLogId);
      if (!log || !findAccessibleCustomer(state, getActor(), log.customerId)) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy việc.');
      dispatch({ type: 'followUps/complete', careLogId, meta: meta() });
      return ok({ careLogId });
    },

    // ----------------------------------------------------------------- Lịch hẹn (05 §2.9)

    /** `POST /crm/appointments` — người thực hiện phải thuộc nhóm chăm sóc; cập nhật `nextAppointmentAt` của khách. */
    createAppointment: (input: CreateAppointmentInput): ApiResult<{ id: string }> => {
      const loaded = loadForUpdate(input.customerId);
      if (!loaded.ok) return loaded;
      const actor = getActor();
      const careTeam = loaded.data.careTeam;
      const assigneeId = input.assigneeId ?? (isInCareTeam(careTeam, actor.userId) ? actor.userId : getPrimaryUserId(careTeam)) ?? actor.userId;
      // Người thực hiện phải tồn tại, đang hoạt động, không phải Quản trị (khách chưa có nhóm thì KHÔNG tự gán Quản trị).
      const notAssignable = assertAssignableUsers(getState(), [assigneeId]);
      if (notAssignable) return rejectAssignment(notAssignable);
      if (careTeam.length > 0 && !isInCareTeam(careTeam, assigneeId)) {
        return fail(400, 'USER_NOT_ASSIGNABLE', 'Người thực hiện phải thuộc nhóm chăm sóc của khách.', { userIds: [assigneeId] });
      }
      if (Number.isNaN(new Date(input.startAt).getTime())) return fail(400, 'VALIDATION_FAILED', 'Thời gian hẹn không hợp lệ.');
      if (toVnDateKey(input.startAt) < getVnTodayKey(now())) return fail(400, 'APPOINTMENT_IN_PAST', 'Ngày hẹn không được ở quá khứ.');
      const id = generateId('APT');
      const appointment: Appointment = {
        id,
        customerId: input.customerId,
        type: input.type,
        title: input.title?.trim() ?? '',
        startAt: input.startAt,
        endAt: null,
        location: input.location?.trim() ?? '',
        note: input.note?.trim() ?? '',
        assigneeId,
        remindBeforeMinutes: input.remindBeforeMinutes ?? [60],
        status: 'SCHEDULED',
        completedAt: null,
        createdBy: actor.userId,
        sourceCareLogId: input.sourceCareLogId ?? null,
        smsZnsAuto: input.smsZnsAuto ?? false,
        calendarSync: input.calendarSync ?? false,
      };
      dispatch({ type: 'appointments/add', appointment, meta: meta() });
      return ok({ id });
    },

    /** `PATCH /crm/appointments/:id/status` */
    updateAppointmentStatus: (appointmentId: string, status: AppointmentStatus): ApiResult<{ id: string; status: AppointmentStatus }> => {
      const state = getState();
      const appointment = state.appointments.find((item) => item.id === appointmentId);
      if (!appointment || !findAccessibleCustomer(state, getActor(), appointment.customerId)) return fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy lịch hẹn.');
      dispatch({ type: 'appointments/setStatus', appointmentId, status, meta: meta() });
      return ok({ id: appointmentId, status });
    },

    // ----------------------------------------------------------------- Hàng loạt, nhập (05 §2.3, §2.12)

    /** `POST /crm/customer-bulk-operations` (≤ 200 khách/lần). Nhân viên không được `ASSIGN`. */
    bulkOperation: (
      operation: BulkOperation,
    ): ApiResult<{ succeeded: string[]; unchanged: string[]; failed: { customerId: string; errorCode: string }[]; previousStatusIds: Record<string, string> }> => {
      if (operation.customerIds.length > MAX_BULK_SIZE) return fail(400, 'VALIDATION_FAILED', `Tối đa ${MAX_BULK_SIZE} khách mỗi lần.`);
      const actor = getActor();
      if (operation.type === 'ASSIGN') {
        if (!canBulkAssign(actor.role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản lý/Quản trị được phân người chăm sóc hàng loạt.');
        const notAssignable = assertAssignableUsers(getState(), [...operation.memberIds, operation.primaryUserId]);
        if (notAssignable) return rejectAssignment(notAssignable);
        // Quản lý chỉ phân người thuộc nhóm mình quản lý (không gán chéo nhóm).
        const allowed = new Set(listAssignableUsers(getState(), actor).map((user) => user.id));
        const outOfTeam = [...operation.memberIds, operation.primaryUserId].filter((id): id is string => Boolean(id) && !allowed.has(id as string));
        if (outOfTeam.length > 0) return fail(403, 'USER_OUT_OF_TEAM', 'Chỉ được phân người thuộc nhóm bạn quản lý.', { userIds: outOfTeam });
      }
      if (operation.type === 'ADD_TAGS') {
        const refError = findInvalidCatalogRef(getState().catalogs, { tagIds: operation.tagIds });
        if (refError) return fail(400, 'INVALID_CATALOG_REF', refError);
      }
      if (operation.type === 'CHANGE_STATUS' && !getState().catalogs.statuses.some((status) => status.id === operation.statusId && status.isActive)) {
        return fail(400, 'STATUS_NOT_FOUND', 'Tình trạng không tồn tại hoặc đã ngừng dùng.', { statusId: operation.statusId });
      }
      const succeeded: string[] = [];
      const unchanged: string[] = [];
      const previousStatusIds: Record<string, string> = {};
      const failed: { customerId: string; errorCode: string }[] = [];
      operation.customerIds.forEach((customerId) => {
        const customer = findAccessibleCustomer(getState(), actor, customerId);
        if (!customer) {
          failed.push({ customerId, errorCode: 'CUSTOMER_NOT_FOUND' });
          return;
        }
        const versionBefore = customer.version;
        if (operation.type === 'CHANGE_STATUS') {
          if (customer.statusId === operation.statusId) {
            unchanged.push(customerId);
            return;
          }
          previousStatusIds[customerId] = customer.statusId;
          update(customerId, { statusId: operation.statusId }, 'STATUS_CHANGED');
        }
        if (operation.type === 'ADD_TAGS') {
          const tagIds = [...new Set([...customer.tagIds, ...operation.tagIds])];
          if (tagIds.length === customer.tagIds.length) {
            unchanged.push(customerId);
            return;
          }
          update(customerId, { tagIds }, 'CUSTOMER_UPDATED');
        }
        if (operation.type === 'ASSIGN') {
          const stamp = now().toISOString();
          if (customer.careTeam.length === 0) {
            // Khách chưa có ai: bắt buộc chọn rõ PRIMARY, không tự lấy người đầu tiên.
            if (!operation.primaryUserId) {
              failed.push({ customerId, errorCode: 'PRIMARY_REQUIRED' });
              return;
            }
            update(customerId, { careTeam: buildCareTeam(operation.primaryUserId, operation.memberIds, actor.userId, stamp) }, 'CARE_TEAM_MEMBER_ADDED');
          } else {
            const additions = operation.memberIds.filter((userId) => !isInCareTeam(customer.careTeam, userId));
            if (additions.length === 0) {
              unchanged.push(customerId);
              return;
            }
            const careTeam: CareTeamMember[] = [...customer.careTeam, ...additions.map((userId) => ({ userId, role: 'MEMBER' as const, addedBy: actor.userId, addedAt: stamp }))];
            update(customerId, { careTeam }, 'CARE_TEAM_MEMBER_ADDED');
          }
        }
        // Chỉ tính thành công khi reducer THẬT SỰ đổi hồ sơ (version tăng); bị từ chối âm thầm thì báo lỗi.
        if (findRaw(customerId)?.version === versionBefore) {
          failed.push({ customerId, errorCode: 'NOT_APPLIED' });
          delete previousStatusIds[customerId];
          return;
        }
        succeeded.push(customerId);
      });
      return ok({ succeeded, unchanged, failed, previousStatusIds });
    },

    /** Nhập khách từ file đã xem trước + xác nhận (X8; backend: job `customer-imports` chạy nền). Chỉ Quản trị. */
    importCustomers: (rows: ImportCustomerRow[]): ApiResult<{ created: number; skipped: { row: number; message: string }[] }> => {
      if (!canImportCustomers(getActor().role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được nhập dữ liệu.');
      const limitError = checkImportLimits(0, rows.length);
      if (limitError) return fail(400, 'IMPORT_TOO_LARGE', limitError);
      const skipped: { row: number; message: string }[] = [];
      let created = 0;
      const api = createMockCrmApi({ getState, dispatch, now, generateId });
      rows.forEach((row, index) => {
        // Kiểm lại ở lớp dữ liệu (không tin dữ liệu xem trước): danh mục phải còn đang dùng.
        const { catalogs } = getState();
        const hidden =
          (row.statusId && !catalogs.statuses.some((item) => item.id === row.statusId && item.isActive)) ||
          (row.sourceId && !catalogs.leadSources.some((item) => item.id === row.sourceId && item.isActive)) ||
          (row.areaId && !catalogs.areas.some((item) => item.id === row.areaId && item.isActive)) ||
          (row.interestedProjectIds ?? []).some((id) => !catalogs.projects.some((item) => item.id === id && item.isActive));
        if (hidden) {
          skipped.push({ row: index + 1, message: 'Danh mục (tình trạng/nguồn/khu vực/dự án) không tồn tại hoặc đã ngừng dùng.' });
          return;
        }
        const result = api.createCustomer({
          fullName: row.fullName,
          phone: row.phone,
          statusId: row.statusId,
          sourceId: row.sourceId,
          interestedProjectIds: row.interestedProjectIds,
          areaId: row.areaId,
          notes: row.notes,
          careTeam: row.primaryUserId ? { primaryUserId: row.primaryUserId, memberIds: [] } : undefined,
          createdVia: 'IMPORT',
        });
        if (result.ok) created += 1;
        else skipped.push({ row: index + 1, message: result.error.message });
      });
      return ok({ created, skipped });
    },

    /** `POST /crm/tags` — mọi vai trò được tạo thẻ khi gắn; trùng tên (không dấu) -> trả thẻ có sẵn (C11). */
    createTag: (body: { name: string; category: Tag['category'] }): ApiResult<Tag> => {
      const name = body.name.replace(/^#+/, '').trim();
      if (!name || name.length > 50) return fail(400, 'VALIDATION_FAILED', 'Tên thẻ từ 1 đến 50 ký tự.');
      const existing = getState().catalogs.tags.find((tag) => tag.category === body.category && normalizeVietnamese(tag.name) === normalizeVietnamese(name));
      if (existing) return ok(existing);
      const tag: Tag = { id: generateId('TAG'), name, category: body.category, isActive: true };
      dispatch({ type: 'catalogs/upsert', kind: 'tags', item: tag });
      return ok(tag);
    },

    // ----------------------------------------------------------------- Danh mục, người dùng, cài đặt (05 §2.2, §2.8, §2.14) — chỉ Quản trị

    upsertCatalogItem: <K extends CatalogKind>(kind: K, item: CrmCatalogs[K][number]): ApiResult<CrmCatalogs[K][number]> => {
      if (getActor().role !== 'ADMIN') return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được sửa danh mục.');
      if (kind === 'projects') {
        // Dự án có luồng riêng (id do hệ thống sinh, audit log, trường mới) — Cài đặt và màn Dự án dùng chung.
        const project = item as Project;
        const isExisting = getState().catalogs.projects.some((candidate) => candidate.id === project.id && !candidate.deletedAt);
        return (isExisting ? updateProject(project.id, project) : createProject(project)) as ApiResult<CrmCatalogs[K][number]>;
      }
      const error = validateCatalogItem(getState().catalogs, kind, item);
      if (error) return fail(400, 'VALIDATION_FAILED', error);
      // Chỉ 1 tình trạng mặc định cho khách mới: đặt mặc định mới thì gỡ cờ ở tình trạng cũ.
      if (kind === 'statuses' && 'isDefault' in item && item.isDefault) {
        getState()
          .catalogs.statuses.filter((status) => status.isDefault && status.id !== item.id)
          .forEach((status) => dispatch({ type: 'catalogs/upsert', kind: 'statuses', item: { ...status, isDefault: false } }));
      }
      dispatch({ type: 'catalogs/upsert', kind, item });
      return ok(item);
    },

    // --- Dự án (05 §2.8 `POST/PATCH/DELETE /crm/projects`, `POST /crm/project-restorations`) — chỉ Quản trị

    createProject,
    updateProject,
    deleteProject,
    restoreProject,

    // --- Xuất danh sách khách (05 §2.12 `POST /crm/customer-exports`)

    /** Chỉ Quản trị/Quản lý (kiểm ở lớp dữ liệu, không chỉ ẩn nút); áp bộ lọc + phạm vi quyền; MỖI lần xuất ghi 1 audit `CUSTOMER_EXPORTED`. */
    createCustomerExport: (query: CustomerListQuery): ApiResult<CustomerExportFile> => {
      const actor = getActor();
      if (!canExportCustomers(actor.role)) return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị/Quản lý được xuất danh sách khách.');
      const file = buildCustomerExport(getState(), actor, query, now());
      audit('CUSTOMER_EXPORTED', 'CUSTOMER_EXPORT', null, [
        { field: 'Số khách xuất', from: '', to: String(file.rowCount) },
        { field: 'Tệp', from: '', to: file.fileName },
      ]);
      return ok(file);
    },

    upsertUser: (user: CrmUser): ApiResult<CrmUser> => {
      const actor = getActor();
      if (actor.role !== 'ADMIN') return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được quản lý người dùng.');
      const error = validateUser(getState(), user, actor.userId);
      if (error) return fail(400, 'VALIDATION_FAILED', error);
      const previous = getState().users.find((item) => item.id === user.id);
      const wasAssignable = Boolean(previous?.isActive && previous.role !== 'ADMIN');
      if (wasAssignable && (!user.isActive || user.role === 'ADMIN')) {
        // Khoá tài khoản hoặc đổi sang Quản trị: gỡ khỏi nhóm MEMBER của mọi khách (reducer tự chuyển lịch hẹn/bước tiếp theo sang PRIMARY + ghi changeLog).
        getState()
          .customers.filter((customer) => customer.careTeam.some((member) => member.userId === user.id && member.role === 'MEMBER'))
          .forEach((customer) => update(customer.id, { careTeam: customer.careTeam.filter((member) => member.userId !== user.id) }, 'CARE_TEAM_MEMBER_REMOVED', user.isActive ? 'Đổi sang Quản trị' : 'Khoá tài khoản'));
      }
      dispatch({ type: 'users/upsert', user });
      return ok(user);
    },

    updateSettings: (changes: Partial<CrmSettings>): ApiResult<CrmSettings> => {
      if (getActor().role !== 'ADMIN') return fail(403, 'INSUFFICIENT_ROLE', 'Chỉ Quản trị được sửa cài đặt.');
      const error = validateSettings(changes);
      if (error) return fail(400, 'VALIDATION_FAILED', error);
      dispatch({ type: 'settings/update', changes });
      return ok(getState().settings);
    },
  };
};

export type CrmApi = ReturnType<typeof createMockCrmApi>;
