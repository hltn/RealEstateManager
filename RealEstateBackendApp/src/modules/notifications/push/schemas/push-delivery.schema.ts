import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Trạng thái gửi tới MỘT thiết bị. Chỉ `SENT`/`GONE` là "đã xong" (không gửi lại). */
export enum PushDeliveryStatus {
  SENDING = 'SENDING',
  SENT = 'SENT',
  GONE = 'GONE',
  FAILED = 'FAILED',
}

/** Dữ liệu kỹ thuật `push_deliveries` tự xóa sau 30 ngày (ngắn hơn 180 ngày của `notifications`). */
export const PUSH_DELIVERY_RETENTION_SECONDS = 30 * 24 * 60 * 60;

/**
 * Sổ gửi push theo cặp (thông báo, thiết bị) (`push_deliveries`, Architecture 3.2, FR-03): unique
 * `{notificationId, subscriptionId}` quyết định ai đã gửi xong nên retry/restart/hai instance không gửi trùng.
 * KHÔNG lưu payload hay thân phản hồi của dịch vụ push, chỉ mã lỗi. Collection MỚI nên index khai báo tại schema.
 */
@Schema({ collection: 'push_deliveries', timestamps: false })
export class PushDelivery {
  @Prop({ type: Types.ObjectId, required: true })
  notificationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  subscriptionId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(PushDeliveryStatus),
    required: true,
    default: PushDeliveryStatus.SENDING,
  })
  status: PushDeliveryStatus;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  /** Chỉ mã (HTTP status, `TIMEOUT`, `NETWORK`), không lưu thân phản hồi. */
  @Prop({ type: String, default: null })
  lastErrorCode: string | null;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt: Date;
}

export type PushDeliveryDocument = HydratedDocument<PushDelivery>;

export const PushDeliverySchema = SchemaFactory.createForClass(PushDelivery);

PushDeliverySchema.index(
  { notificationId: 1, subscriptionId: 1 },
  { unique: true },
);
PushDeliverySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: PUSH_DELIVERY_RETENTION_SECONDS },
);
