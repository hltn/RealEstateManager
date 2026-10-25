/**
 * Gọi API chăm sóc: nhóm chăm sóc, đề nghị tham gia, nhật ký + ảnh đính kèm, thao tác hàng loạt (05 §2.3, §2.5, §2.6).
 */
import type { BulkOperation, CareLogView, CareTeamRequestView, CreateCareLogInput, Paginated } from '../types';
import type { CareLogDto, CareTeamDto, CareTeamRequestDto } from './dto';
import apiAxios from '../../../../api/axios';
import { crmHttp } from './crmHttp';
import { CrmApiException, normalizeApiError } from './crmErrors';
import { toCareLog, toCareTeamRequest } from './customerMappers';

const customerPath = (customerId: string): string => `/crm/customers/${encodeURIComponent(customerId)}`;

// --- Nhóm chăm sóc ------------------------------------------------------------------------------------------------------

export const postCareTeamMembers = (customerId: string, body: { userIds: string[]; primaryUserId?: string }): Promise<CareTeamDto> =>
  crmHttp.post<CareTeamDto>(`${customerPath(customerId)}/care-team/members`, body);

export const deleteCareTeamMember = (customerId: string, userId: string, newPrimaryUserId?: string): Promise<CareTeamDto> =>
  crmHttp.raw<{ data: CareTeamDto }>('delete', `${customerPath(customerId)}/care-team/members/${encodeURIComponent(userId)}`, undefined, { params: { newPrimaryUserId } }).then((response) => response.data);

export const putPrimary = (customerId: string, userId: string): Promise<CareTeamDto> => crmHttp.put<CareTeamDto>(`${customerPath(customerId)}/care-team/primary`, { userId });

// --- Đề nghị tham gia ---------------------------------------------------------------------------------------------------

export const postCareTeamRequest = (body: { customerRef: string; message?: string }): Promise<{ id: string; status: 'PENDING'; createdAt: string }> =>
  crmHttp.post('/crm/care-team-requests', body);

export const fetchCareTeamRequests = async (box: 'mine' | 'to-review', signal?: AbortSignal): Promise<{ items: CareTeamRequestView[]; customerIds: Map<string, string> }> => {
  const result = await crmHttp.list<CareTeamRequestDto>('/crm/care-team-requests', { params: { box, status: 'PENDING', limit: 100 }, signal });
  return { items: result.data.map(toCareTeamRequest), customerIds: new Map(result.data.map((item) => [item.id, item.customer.id])) };
};

export const patchCareTeamRequest = (requestId: string, body: { status: 'APPROVED' | 'REJECTED' | 'CANCELED'; resolutionNote?: string }): Promise<{ id: string; status: string }> =>
  crmHttp.patch(`/crm/care-team-requests/${encodeURIComponent(requestId)}`, body);

// --- Nhật ký ------------------------------------------------------------------------------------------------------------

/** Body `POST care-logs`: bỏ trường rỗng (backend `forbidNonWhitelisted` + `@OptionalNotNull`). */
export const buildCareLogBody = (input: CreateCareLogInput): Record<string, unknown> => {
  const nextAction = input.nextAction;
  const hasNextAction = Boolean(nextAction && (nextAction.suggestion?.trim() || nextAction.dueAt));
  return {
    content: input.content,
    contactChannel: input.contactChannel,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    ...(input.contactResultId ? { contactResultId: input.contactResultId } : {}),
    ...(input.attachmentIds && input.attachmentIds.length > 0 ? { attachmentIds: input.attachmentIds } : {}),
    ...(hasNextAction && nextAction
      ? {
          nextAction: {
            ...(nextAction.suggestion?.trim() ? { suggestion: nextAction.suggestion.trim() } : {}),
            ...(nextAction.dueAt ? { dueAt: nextAction.dueAt } : {}),
            ...(nextAction.appointment ? { appointment: nextAction.appointment } : {}),
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
): Promise<CareLogView> => toCareLog(await crmHttp.patch<CareLogDto>(`${customerPath(customerId)}/care-logs/${encodeURIComponent(logId)}`, body), primaryUserId);

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
      ? { statusId: operation.statusId }
      : operation.type === 'ASSIGN'
        ? { memberIds: operation.memberIds, ...(operation.primaryUserId ? { primaryUserId: operation.primaryUserId } : {}) }
        : { tagIds: operation.tagIds };
  return crmHttp.post<BulkResult>('/crm/customer-bulk-operations', { type, customerIds, payload }, { isIdempotent: true });
};

export type { Paginated };
