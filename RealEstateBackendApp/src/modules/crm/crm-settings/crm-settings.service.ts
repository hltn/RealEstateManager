import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { diffFields } from '../audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import {
  CrmSettingsResponseDto,
  DEFAULT_CRM_SETTINGS,
  UpdateCrmSettingsDto,
} from './dtos/crm-settings.dto';
import {
  CRM_SETTINGS_KEY,
  CrmSettings,
  CrmSettingsDocument,
} from './schemas/crm-settings.schema';

const SETTING_FIELDS = Object.keys(DEFAULT_CRM_SETTINGS) as Array<
  keyof typeof DEFAULT_CRM_SETTINGS
>;

/** Trộn giá trị đã lưu với mặc định; field chưa từng được đổi lấy mặc định. Hàm thuần. */
export const mergeWithDefaults = (
  stored: Partial<CrmSettings> | null,
): CrmSettingsResponseDto => {
  const merged = { ...DEFAULT_CRM_SETTINGS } as Record<string, unknown>;
  for (const field of SETTING_FIELDS) {
    const value = stored?.[field];
    if (value !== undefined && value !== null) merged[field] = value;
  }
  return {
    ...(merged as unknown as CrmSettingsResponseDto),
    occasionLeadDays: [...(merged.occasionLeadDays as number[])],
    defaultAppointmentReminderMinutes: [
      ...(merged.defaultAppointmentReminderMinutes as number[]),
    ],
  };
};

/**
 * Cấu hình CRM (`/crm/settings`): singleton. Scheduler (M5) đọc lại ở mỗi lần chạy nên không cần cache.
 */
@Injectable()
export class CrmSettingsService {
  constructor(
    @InjectModel(CrmSettings.name)
    private readonly settingsModel: Model<CrmSettingsDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly audit: CrmAuditLogService,
  ) {}

  async get(): Promise<CrmSettingsResponseDto> {
    const stored = await this.settingsModel
      .findOne({ key: CRM_SETTINGS_KEY })
      .lean()
      .exec();
    return mergeWithDefaults(stored);
  }

  /** Chỉ ghi các field được gửi; ghi audit SETTINGS_UPDATED (giá trị cũ → mới) cùng transaction. */
  async update(
    jwt: JwtPayload,
    dto: UpdateCrmSettingsDto,
  ): Promise<CrmSettingsResponseDto> {
    const patch: Record<string, unknown> = {};
    for (const field of SETTING_FIELDS) {
      if (dto[field] !== undefined) patch[field] = dto[field];
    }
    if (Object.keys(patch).length === 0) return this.get();

    try {
      return await this.applyPatch(jwt, patch);
    } catch (error) {
      // Hai ADMIN upsert đồng thời lần đầu: một bên thua unique index `key` (E11000). Bản ghi giờ đã có nên
      // thử lại MỘT lần sẽ đi nhánh cập nhật bình thường.
      if (isDuplicateKeyError(error)) return this.applyPatch(jwt, patch);
      throw error;
    }
  }

  private applyPatch(
    jwt: JwtPayload,
    patch: Record<string, unknown>,
  ): Promise<CrmSettingsResponseDto> {
    return withTransaction(this.connection, async (session) => {
      const beforeDoc = await this.settingsModel
        .findOne({ key: CRM_SETTINGS_KEY })
        .session(session)
        .lean()
        .exec();
      const afterDoc = await this.settingsModel
        .findOneAndUpdate(
          { key: CRM_SETTINGS_KEY },
          { $set: patch },
          { upsert: true, returnDocument: 'after', session },
        )
        .lean()
        .exec();

      const before = mergeWithDefaults(beforeDoc);
      const after = mergeWithDefaults(afterDoc);
      const changes = diffFields(before, after, SETTING_FIELDS);
      if (changes.length > 0) {
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.SETTINGS,
            entityId: afterDoc._id,
            action: CrmAuditAction.SETTINGS_UPDATED,
            actor: jwt,
            changes,
          },
          session,
        );
      }
      return after;
    });
  }
}
