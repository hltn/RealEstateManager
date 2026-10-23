import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Khóa của bản ghi cấu hình duy nhất (singleton). */
export const CRM_SETTINGS_KEY = 'default';

/**
 * Cấu hình CRM (`crm_settings`, tài liệu 04 mục 3.7) — singleton: đúng 1 bản ghi `key = 'default'`.
 * Bản ghi chỉ chứa field Quản trị đã đổi; field thiếu được suy ra từ giá trị mặc định trong service,
 * nên thêm field cấu hình mới không cần migration.
 */
@Schema({ timestamps: true, collection: 'crm_settings' })
export class CrmSettings {
  @Prop({ required: true })
  key: string;

  @Prop({ type: Number })
  staleCustomerDays?: number;

  @Prop({ type: String })
  staleCheckTime?: string;

  @Prop({ type: String })
  occasionNotifyTime?: string;

  // `default: undefined`: mảng của Mongoose mặc định là [], upsert sẽ ghi [] và che mất giá trị mặc định.
  @Prop({ type: [Number], default: undefined })
  occasionLeadDays?: number[];

  @Prop({ type: [Number], default: undefined })
  defaultAppointmentReminderMinutes?: number[];

  @Prop({ type: Number })
  careLogEditWindowHours?: number;

  @Prop({ type: Number })
  careLogNotifyDebounceMinutes?: number;

  @Prop({ type: Number })
  phoneViewAlertPerHour?: number;

  updatedAt: Date;
}

export type CrmSettingsDocument = HydratedDocument<CrmSettings>;

export const CrmSettingsSchema = SchemaFactory.createForClass(CrmSettings);

CrmSettingsSchema.index({ key: 1 }, { unique: true });
