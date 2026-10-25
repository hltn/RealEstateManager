/**
 * Hàm GHI của lớp truy cập dữ liệu CRM gọi API thật (thay `mockCrmApi` cho các màn đã nối).
 * Tên hàm bám endpoint tài liệu 05; mỗi hàm trả `Promise<ApiResult<T>>` (`ok` hoặc `error` đã chuẩn hóa tiếng Việt).
 * Sau mỗi thao tác ghi thành công: làm mới dữ liệu đang hiển thị (`invalidate`). Backend là nguồn sự thật về quyền.
 */
import type { PersonaFieldDefinition } from '@crm/types/crm';
import * as admin from './http/adminApi';
import * as care from './http/careApi';
import type { BulkResult } from './http/careApi';
import { toResult } from './http/crmHttp';
import { toApiError } from './http/crmErrors';
import type { DetailMappingContext } from './http/customerMappers';
import * as customerApi from './http/customerApi';
import * as scheduling from './http/schedulingApi';
import type {
  ApiResult,
  BulkOperation,
  CareLogView,
  CreateAppointmentInput,
  CreateCareLogInput,
  CreateCustomerInput,
  CriteriaPatch,
  CustomerDetail,
  PersonaValueInput,
  UpdateCustomerInput,
  UpdateStatusResult,
  AppointmentView,
} from './types';

export interface HttpCrmApiDependencies {
  /** Làm mới dữ liệu đang hiển thị sau khi ghi. */
  invalidate: (options: { shouldIncludeCatalogs?: boolean }) => Promise<void> | void;
  getContext: () => DetailMappingContext;
  getPersonaFields: () => ReadonlyMap<string, PersonaFieldDefinition>;
}

export interface SaveProfileInput {
  version: number;
  profile?: Omit<UpdateCustomerInput, 'version'>;
  nationalId?: string;
  personaValues?: PersonaValueInput[];
}

export const createHttpCrmApi = ({ invalidate, getContext, getPersonaFields }: HttpCrmApiDependencies) => {
  /**
   * Bọc một thao tác ghi: kết quả `ApiResult`. LUÔN làm mới dữ liệu sau khi ghi (kể cả lỗi): 409 `VERSION_CONFLICT` cần version mới,
   * và thao tác nhiều bước (`saveCustomerProfile`) có thể đã ghi một phần trước khi lỗi. Làm mới KHÔNG reset form đang nhập
   * (form giữ state riêng, chỉ dữ liệu hiển thị/`version` được tải lại).
   */
  const write = async <T>(run: () => Promise<T>, options: { shouldIncludeCatalogs?: boolean } = {}): Promise<ApiResult<T>> => {
    const result = await toResult(run);
    await invalidate(options);
    return result;
  };

  const primaryOf = (members: { user: { id: string }; role: string }[]): string | null => members.find((member) => member.role === 'PRIMARY')?.user.id ?? null;

  return {
    // --- Khách ----------------------------------------------------------------------------------------------------
    createCustomer: (input: CreateCustomerInput) => write(() => customerApi.postCustomer(input, getContext())),
    updateCustomer: (customerId: string, input: UpdateCustomerInput) => write(() => customerApi.patchCustomer(customerId, input, getContext())),
    updateCustomerStatus: (customerId: string, body: { statusId: string; version: number; reason?: string }): Promise<ApiResult<UpdateStatusResult>> => write(() => customerApi.patchStatus(customerId, body)),
    updateCustomerCriteria: (customerId: string, body: { version: number; criteria: CriteriaPatch }) => write(() => customerApi.patchCriteria(customerId, body.version, body.criteria)),
    putNationalId: (customerId: string, nationalId: string) => write(() => customerApi.putNationalIdValue(customerId, nationalId)),
    deleteNationalId: (customerId: string) => write(() => customerApi.deleteNationalIdValue(customerId)),
    /** Lấy số đầy đủ: server kiểm phạm vi + ghi audit `PHONE_VIEWED` (không lưu số). Không làm mới danh sách. */
    createPhoneView: (customerId: string, purpose: 'VIEW' | 'CALL' | 'COPY' = 'VIEW') => toResult(() => customerApi.postPhoneView(customerId, purpose)),
    createNationalIdView: (customerId: string) => toResult(() => customerApi.postNationalIdView(customerId)),

    /**
     * Lưu hồ sơ + chân dung theo thứ tự hồ sơ -> chân dung -> CCCD (mỗi bước cần/đổi version riêng nên KHÔNG nguyên tử như mock).
     * Dừng ở bước lỗi đầu tiên và báo lỗi; các bước trước đó đã được lưu nên dữ liệu luôn được làm mới (xem `write`).
     */
    saveCustomerProfile: (customerId: string, input: SaveProfileInput) =>
      write(async () => {
        let version = input.version;
        if (input.profile) {
          const detail = await customerApi.patchCustomer(customerId, { ...input.profile, version }, getContext());
          version = detail.version;
        }
        if (input.personaValues && input.personaValues.length > 0) {
          const result = await customerApi.patchPersona(customerId, version, input.personaValues, getPersonaFields());
          version = result.version;
        }
        if (input.nationalId?.trim()) await customerApi.putNationalIdValue(customerId, input.nationalId.trim());
        return { version };
      }),

    // --- Nhóm chăm sóc ----------------------------------------------------------------------------------------------
    addCareTeamMembers: (customerId: string, body: { userIds: string[]; primaryUserId?: string }) => write(() => care.postCareTeamMembers(customerId, body)),
    removeCareTeamMember: (customerId: string, userId: string, newPrimaryUserId?: string) => write(() => care.deleteCareTeamMember(customerId, userId, newPrimaryUserId)),
    changePrimary: (customerId: string, userId: string) => write(() => care.putPrimary(customerId, userId)),
    createCareTeamRequest: (body: { customerRef: string; message?: string }) => write(() => care.postCareTeamRequest(body)),
    resolveCareTeamRequest: (requestId: string, status: 'APPROVED' | 'REJECTED' | 'CANCELED') => write(() => care.patchCareTeamRequest(requestId, { status })),

    // --- Nhật ký + ảnh ----------------------------------------------------------------------------------------------
    createCareLog: (customerId: string, input: CreateCareLogInput, primaryUserId: string | null = null): Promise<ApiResult<CareLogView>> => write(() => care.postCareLog(customerId, input, primaryUserId)),
    updateCareLog: (customerId: string, logId: string, body: Parameters<typeof care.patchCareLog>[2], primaryUserId: string | null = null) => write(() => care.patchCareLog(customerId, logId, body, primaryUserId)),
    deleteCareLog: (customerId: string, logId: string, reason?: string) => write(() => care.deleteCareLog(customerId, logId, reason)),
    /** Tải ảnh lên trước khi lưu ghi chú. Không làm mới danh sách (ảnh chưa gắn). */
    uploadCareLogAttachment: (customerId: string, file: File, signal?: AbortSignal) => toResult(() => care.uploadCareLogAttachment(customerId, file, signal)),
    deleteCareLogAttachment: (customerId: string, attachmentId: string) => toResult(() => care.deleteCareLogAttachment(customerId, attachmentId)),

    // --- Lịch hẹn ----------------------------------------------------------------------------------------------------
    createAppointment: (input: CreateAppointmentInput): Promise<ApiResult<AppointmentView>> => write(() => scheduling.postAppointment(input)),
    updateAppointmentStatus: (appointmentId: string, status: 'DONE' | 'CANCELED' | 'SCHEDULED', extras: { version?: number; outcome?: string; createCareLog?: boolean } = {}) =>
      write(() => scheduling.patchAppointmentStatus(appointmentId, { status, ...extras })),
    deleteAppointment: (appointmentId: string) => write(() => scheduling.deleteAppointment(appointmentId)),

    // --- Hàng loạt, thẻ ----------------------------------------------------------------------------------------------
    bulkOperation: (operation: BulkOperation): Promise<ApiResult<BulkResult>> => write(() => care.postBulkOperation(operation)),
    createTag: (body: { name: string; category: string }) => write(() => admin.createTag(body), { shouldIncludeCatalogs: true }),

    // --- Quản trị -----------------------------------------------------------------------------------------------------
    createProject: (body: admin.ProjectBody) => write(() => admin.postProject(body), { shouldIncludeCatalogs: true }),
    updateProject: (id: string, body: admin.ProjectBody) => write(() => admin.patchProject(id, body), { shouldIncludeCatalogs: true }),
    deleteProject: (id: string) => write(() => admin.deleteProject(id), { shouldIncludeCatalogs: true }),
    restoreProject: (id: string) => write(() => admin.postProjectRestoration(id), { shouldIncludeCatalogs: true }),
    createCatalogItem: (endpoint: admin.CatalogEndpoint, body: Record<string, unknown>) => write(() => admin.createCatalogItem(endpoint, body), { shouldIncludeCatalogs: true }),
    updateCatalogItem: (endpoint: admin.CatalogEndpoint, id: string, body: Record<string, unknown>) => write(() => admin.updateCatalogItem(endpoint, id, body), { shouldIncludeCatalogs: true }),
    deleteCatalogItem: (endpoint: admin.CatalogEndpoint, id: string) => write(() => admin.deleteCatalogItem(endpoint, id), { shouldIncludeCatalogs: true }),
    createUser: (body: Parameters<typeof admin.postUser>[0]) => write(() => admin.postUser(body), { shouldIncludeCatalogs: true }),
    updateUserStatus: (id: string, status: 'ACTIVE' | 'BLOCKED') => write(() => admin.patchUserStatus(id, status), { shouldIncludeCatalogs: true }),
    updateUserRole: (id: string, role: string) => write(() => admin.patchUserRole(id, role), { shouldIncludeCatalogs: true }),
    updateUserTeam: (id: string, teamId: string | null) => write(() => admin.patchUserTeam(id, teamId), { shouldIncludeCatalogs: true }),
    createTeam: (body: Parameters<typeof admin.postTeam>[0]) => write(() => admin.postTeam(body), { shouldIncludeCatalogs: true }),
    updateTeam: (id: string, body: Parameters<typeof admin.patchTeam>[1]) => write(() => admin.patchTeam(id, body), { shouldIncludeCatalogs: true }),
    deleteTeam: (id: string) => write(() => admin.deleteTeam(id), { shouldIncludeCatalogs: true }),
    updateSettings: (body: Parameters<typeof admin.patchCrmSettings>[0]) => write(() => admin.patchCrmSettings(body), { shouldIncludeCatalogs: true }),

    /** Chỉ để test/suy ra phụ trách chính từ nhóm chăm sóc trả về. */
    primaryOf,
  };
};

export type CrmApi = ReturnType<typeof createHttpCrmApi>;
export { toApiError };
export type { CustomerDetail };
