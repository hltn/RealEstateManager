import { Types } from 'mongoose';
import { CrmActor } from '../common/access/crm-actor';
import { toRef, toUserRef } from '../customers/customer-refs.service';
import type { RefMaps } from '../customers/customer-refs.service';
import { canModifyCareLog } from './care-log.rules';
import { CareLogResponseDto } from './dtos/care-log.dto';
import { CareLog } from './schemas/care-log.schema';

export type CareLogLean = CareLog & { _id: Types.ObjectId };

/** Chữ ký ảnh theo `attachmentId` (đã ký trước, bất đồng bộ) để mapper giữ thuần đồng bộ. */
export type AttachmentUrls = Map<string, string>;

export const toCareLogResponse = (
  log: CareLogLean,
  actor: CrmActor,
  now: Date,
  maps: Pick<RefMaps, 'users' | 'contactResults'>,
  urls: AttachmentUrls,
): CareLogResponseDto => ({
  id: String(log._id),
  customerId: String(log.customerId),
  // Tên người viết: ưu tiên tên hiện tại, thiếu thì dùng bản chụp lúc ghi.
  author: toUserRef(log.authorId, maps.users) ?? {
    id: String(log.authorId),
    displayName: log.authorName,
  },
  occurredAt: log.occurredAt.toISOString(),
  content: log.content,
  attachments: (log.attachments ?? []).map((attachment) => {
    const url = urls.get(String(attachment.attachmentId)) ?? '';
    return {
      id: String(attachment.attachmentId),
      thumbUrl: url,
      url,
      mimeType: attachment.mimeType,
      size: attachment.size,
    };
  }),
  contactChannel: log.contactChannel,
  contactResult: toRef(log.contactResultId, maps.contactResults),
  nextAction: log.nextAction
    ? {
        suggestion: log.nextAction.suggestion ?? null,
        dueAt: log.nextAction.dueAt
          ? new Date(log.nextAction.dueAt).toISOString()
          : null,
        appointmentId: log.nextAction.appointmentId
          ? String(log.nextAction.appointmentId)
          : null,
      }
    : null,
  source: log.source,
  editedAt: log.editedAt ? log.editedAt.toISOString() : null,
  canEdit: canModifyCareLog(actor, log, now),
});
