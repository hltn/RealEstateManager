import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CrmAuditChange, CrmAuditEntityType } from '../crm-audit.constants';

/**
 * Nhật ký audit CRM — chỉ ghi thêm, không có API sửa/xóa (tài liệu 04 mục 3.7). Chỉ có HAI thao tác nội bộ được ghi đè
 * giá trị nhạy cảm trong `changes`: ẩn danh hóa khách (`CustomerLifecycleService`) và xóa giá trị chân dung theo yêu cầu
 * (`redactPersonaFieldAudit` ở `audit-redaction.util.ts`); không thao tác nào khác sửa hay xóa bản ghi.
 * Lưu >= 2 năm (D11), vì vậy KHÔNG đặt TTL.
 *
 * Mỗi bản ghi được ghi trong CÙNG transaction với thay đổi nghiệp vụ.
 * `changes` lưu giá trị trường cũ -> mới; tuyệt đối không đưa CCCD vào đây.
 */
@Schema({
  collection: 'crm_audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class CrmAuditLog {
  @Prop({
    type: String,
    enum: Object.values(CrmAuditEntityType),
    required: true,
  })
  entityType: CrmAuditEntityType;

  @Prop({ type: Types.ObjectId, required: true })
  entityId: Types.ObjectId;

  /** Phân loại con của thực thể, vd `CUSTOMER_STATUS`/`LEAD_SOURCE`/`AREA` khi entityType = CATALOG. */
  @Prop({ type: String, default: null })
  entitySubtype: string | null;

  /** Chỉ có với bản ghi gắn với một khách (M2 trở đi). */
  @Prop({ type: Types.ObjectId, default: null })
  customerId: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  action: string;

  @Prop({ type: Types.ObjectId, required: true })
  actorId: Types.ObjectId;

  @Prop({ type: String, required: true })
  actorName: string;

  @Prop({ type: String, required: true })
  actorRole: string;

  @Prop({
    type: [{ _id: false, field: String, from: Object, to: Object }],
    default: [],
  })
  changes: CrmAuditChange[];

  @Prop({ type: String, default: null })
  reason: string | null;

  @Prop({
    type: String,
    enum: ['WEB', 'MOBILE', 'IMPORT', 'SYSTEM'],
    default: 'WEB',
  })
  source: string;

  @Prop({ type: String, default: 'unknown' })
  requestId: string;

  /** Địa chỉ IP và User-Agent của request gây ra thay đổi (tài liệu 04 mục 3.7); field mới, tùy chọn. */
  @Prop({ type: String, default: null })
  ip: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  createdAt: Date;
}

export type CrmAuditLogDocument = HydratedDocument<CrmAuditLog>;

export const CrmAuditLogSchema = SchemaFactory.createForClass(CrmAuditLog);

CrmAuditLogSchema.index({ customerId: 1, createdAt: -1 });
CrmAuditLogSchema.index({ actorId: 1, createdAt: -1 });
CrmAuditLogSchema.index({ action: 1, createdAt: -1 });
CrmAuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
