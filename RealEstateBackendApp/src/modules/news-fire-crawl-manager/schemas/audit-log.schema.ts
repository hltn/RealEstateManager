import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum AuditAction {
  DELETE = 'DELETE',
  BULK_DELETE = 'BULK_DELETE',
  BULK_MOVE = 'BULK_MOVE',
  PUBLISH = 'PUBLISH',
  BULK_PUBLISH = 'BULK_PUBLISH',
  /**
   * Admin trigger phân tích thị trường bulk (chạy nền).
   * Backward compatible: chỉ thêm giá trị enum mới, document cũ không bị ảnh hưởng.
   */
  MARKET_ANALYSIS_BULK = 'MARKET_ANALYSIS_BULK',
  /**
   * Admin trigger thu thập thủ công (chạy nền). Backward compatible: chỉ thêm
   * giá trị enum mới, document cũ không bị ảnh hưởng.
   */
  MANUAL_CRAWL = 'MANUAL_CRAWL',
  /**
   * Workflow phân tích thị trường end-to-end (5 bước, chạy nền). Backward
   * compatible: chỉ thêm giá trị enum mới, document cũ không bị ảnh hưởng.
   */
  WORKFLOW_MARKET_ANALYSIS = 'WORKFLOW_MARKET_ANALYSIS',
  /**
   * Knowledge Articles — publish to WordPress.
   */
  KNOWLEDGE_PUBLISH = 'KNOWLEDGE_PUBLISH',
  /**
   * Knowledge Articles — republish (update) WordPress post.
   */
  KNOWLEDGE_REPUBLISH = 'KNOWLEDGE_REPUBLISH',
  /**
   * Knowledge Articles — bulk publish to WordPress.
   */
  KNOWLEDGE_BULK_PUBLISH = 'KNOWLEDGE_BULK_PUBLISH',
  /**
   * Knowledge Articles — soft delete.
   */
  KNOWLEDGE_DELETE = 'KNOWLEDGE_DELETE',
  /**
   * Knowledge Articles — bulk soft delete.
   */
  KNOWLEDGE_BULK_DELETE = 'KNOWLEDGE_BULK_DELETE',
}

/**
 * Schema lưu audit trail cho các thao tác rủi ro cao:
 * DELETE, BULK_DELETE, BULK_MOVE, PUBLISH, BULK_PUBLISH.
 * Chỉ có createdAt (không cần updatedAt vì log không bao giờ bị sửa).
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog extends Document {
  @Prop({ required: true, enum: AuditAction, index: true })
  action: AuditAction;

  /** Tên collection bị tác động: 'raw_articles' | 'news_articles' */
  @Prop({ required: true, index: true })
  collectionName: string;

  /** Danh sách document ID bị tác động (hỗ trợ cả single và bulk) */
  @Prop({ type: [String], required: true })
  documentIds: string[];

  /** Người thực hiện — hiện tại dùng 'system' vì chưa có auth */
  @Prop({ required: true, default: 'system' })
  actor: string;

  /** Dữ liệu mở rộng: count xóa, wpPostId sau publish, v.v. */
  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, collectionName: 1, createdAt: -1 });
