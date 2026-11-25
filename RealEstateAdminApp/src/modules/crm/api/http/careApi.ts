/**
 * Gọi API chăm sóc: nhóm chăm sóc, người được mời, nhật ký + ảnh đính kèm, thao tác hàng loạt (05 §2.3, §2.5, §2.6).
 */
import type { BulkOperation, CareLogView, CareTeamInvitee, CareTeamInviteeQuery, CreateCareLogInput, Paginated } from '../types';
import type { CareLogDto, CareTeamDto, CareTeamInviteeDto } from './dto';
import apiAxios from '../../../../api/axios';
import { refParam, requireServerCatalogId } from './catalogIds';
import { crmHttp } from './crmHttp';
import { CrmApiException, normalizeApiError } from './crmErrors';
import { toCareLog } from './customerMappers';

const INVITEE_PAGE_LIMIT = 20;

const customerPath = (customerId: string): string => `/crm/customers/${encodeURIComponent(customerId)}`;

// --- Nhóm chăm sóc ------------------------------------------------------------------------------------------------------

export const postCareTeamMembers = (customerId: string, body: { userIds: string[]; primaryUserId?: string }): Promise<CareTeamDto> =>
  crmHttp.post<CareTeamDto>(`${customerPath(customerId)}/care-team/members`, body);

/** Chỉ gỡ MEMBER; gỡ PRIMARY -> 409 `PRIMARY_LOCKED` (v1.0.5 bỏ `newPrimaryUserId`). */
export const deleteCareTeamMember = (customerId: string, userId: string): Promise<CareTeamDto> =>
  crmHttp.raw<{ data: CareTeamDto }>('delete', `${customerPath(customerId)}/care-team/members/${encodeURIComponent(userId)}`).then((response) => response.data);

// --- Người được mời -----------------------------------------------------------------------------------------------------

/**
 * `GET /crm/care-team-invitees` (FR-14): có `customerId` = mời vào khách đó (loại người đã trong nhóm); không có = thao tác hàng loạt.
 * Trả tên + tên nhóm, phân trang; không email/SĐT/vai trò.
 */
export const fetchCareTeamInvitees = async (query: CareTeamInviteeQuery, signal?: AbortSignal): Promise<Paginated<CareTeamInvitee>> => {
  const result = await crmHttp.list<CareTeamInviteeDto>('/crm/care-team-invitees', {
    params: { customerId: query.customerId, q: query.q?.trim() || undefined, page: query.page ?? 1, limit: query.limit ?? INVITEE_PAGE_LIMIT },
    signal,
  });
  return { data: result.data.map((item) => ({ id: item.id, displayName: item.displayName, teamNames: item.teamNames ?? [] })), meta: result.meta };
};

// --- Nhật ký ------------------------------------------------------------------------------------------------------------

/**
 * Lịch hẹn lồng trong `nextAction`: hợp đồng chưa có `projectCode` ở đây nên đổi `code` của UI về id thật (bảng tra `catalogIds`).
 */
const toAppointmentBody = <T extends { projectId?: string | null }>(appointment: T): T =>
  appointment.projectId ? { ...appointment, projectId: requireServerCatalogId('projects', appointment.projectId) } : appointment;

/** Body `POST care-logs`: bỏ trường rỗng (backend `forbidNonWhitelisted` + `@OptionalNotNull`). */
export const buildCareLogBody = (input: CreateCareLogInput): Record<string, unknown> => {
  const nextAction = input.nextAction;
  const hasNextAction = Boolean(nextAction && (nextAction.suggestion?.trim() || nextAction.dueAt));
  return {
    content: input.content,
    contactChannel: input.contactChannel,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    ...(input.contactResultId ? refParam('contactResultCode', 'contactResultId', input.contactResultId) : {}),
    ...(input.attachmentIds && input.attachmentIds.length > 0 ? { attachmentIds: input.attachmentIds } : {}),
    ...(hasNextAction && nextAction
      ? {
          nextAction: {
            ...(nextAction.suggestion?.trim() ? { suggestion: nextAction.suggestion.trim() } : {}),
            ...(nextAction.dueAt ? { dueAt: nextAction.dueAt } : {}),
            ...(nextAction.appointment ? { appointment: toAppointmentBody(nextAction.appointment) } : {}),
          },
        }
      : {}),
  };
};

export const postCareLog = async (customerId: string, input: CreateCareLogInput, primaryUserId: string | null): Promise<CareLogView> =>
  toCareLog(await crmHttp.post<CareLogDto>(`${customerPath(customerId)}/care-logs`, buildCareLogBody(input), { isIdempotent: true }), primaryUserId);

export const patchCareLog = async (
  customerId: string,
  logId: string,
  body: { content?: string; contactChannel?: string; contactResultId?: string | null; occurredAt?: string; attachmentIds?: string[] },
  primaryUserId: string | null,
): Promise<CareLogView> => {
  const { contactResultId, ...rest } = body;
  return toCareLog(
    await crmHttp.patch<CareLogDto>(`${customerPath(customerId)}/care-logs/${encodeURIComponent(logId)}`, { ...rest, ...refParam('contactResultCode', 'contactResultId', contactResultId) }),
    primaryUserId,
  );
};

export const deleteCareLog = (customerId: string, logId: string, reason?: string): Promise<void> =>
  crmHttp.del(`${customerPath(customerId)}/care-logs/${encodeURIComponent(logId)}`, { params: { reason } });

// --- Ảnh đính kèm -------------------------------------------------------------------------------------------------------

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ATTACHMENT_MAX_PER_NOTE = 5;

/** `POST care-log-attachments` (multipart `file`). Backend kiểm magic bytes, bỏ EXIF/GPS, đổi tên UUID. */
export const uploadCareLogAttachment = async (customerId: string, file: File, signal?: AbortSignal): Promise<{ id: string; status: 'READY' }> => {
  const form = new FormData();
  form.append('file', file);
  try {
    const response = await apiAxios.post<{ data: { id: string; status: 'READY' } }>(`${customerPath(customerId)}/care-log-attachments`, form, { signal });
    return response.data.data;
  } catch (error) {
    throw new CrmApiException(normalizeApiError(error));
  }
};

export const deleteCareLogAttachment = (customerId: string, attachmentId: string): Promise<void> =>
  crmHttp.del(`${customerPath(customerId)}/care-log-attachments/${encodeURIComponent(attachmentId)}`);

// --- Hàng loạt ----------------------------------------------------------------------------------------------------------

export interface BulkResult {
  succeeded: string[];
  failed: { customerId: string; errorCode: string }[];
}

export const postBulkOperation = (operation: BulkOperation): Promise<BulkResult> => {
  const { type, customerIds } = operation;
  const payload =
    operation.type === 'CHANGE_STATUS'
      ? refParam('statusCode', 'statusId', operation.statusId)
      : operation.type === 'ASSIGN'
        ? { memberIds: operation.memberIds }
        : operation.type === 'DELETE'
          ? { reason: operation.reason }
          : { tagIds: operation.tagIds };
  return crmHttp.post<BulkResult>('/crm/customer-bulk-operations', { type, customerIds, payload }, { isIdempotent: true });
};

export type { Paginated };
