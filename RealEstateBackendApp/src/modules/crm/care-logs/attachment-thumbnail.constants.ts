/** Tên job trong queue `crm-image` (`QueueNames.CRM_IMAGE`). */
export const AttachmentThumbnailJobNames = {
  /** Tạo thumbnail cho MỘT ảnh đính kèm (`{ attachmentId }`, FR-26). */
  THUMBNAIL: 'attachment.thumbnail',
} as const;

/**
 * `jobId` của job `attachment.thumbnail`: cùng ảnh thì cùng `jobId` nên BullMQ không xếp job thứ hai. Dùng `-` thay
 * vì `:` như Architecture 5.9.1 ghi (`thumb:{id}`): BullMQ 6.x ném `Custom Id cannot contain :` (giống `pushSendJobId`).
 */
export const attachmentThumbnailJobId = (attachmentId: string): string =>
  `thumb-${attachmentId}`;
