import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import {
  NotificationPreferencesResponseDto,
  UpdateNotificationPreferencesDto,
} from './dtos/notification-preference.dto';
import { NotificationType } from './notification.constants';
import {
  isValidQuietHours,
  resolveTypePreferences,
  TypePreference,
} from './notification-preference.rules';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';

const invalid = (message: string, field: string): BusinessException =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.BAD_REQUEST,
    { field },
  );

/**
 * Cài đặt thông báo của chính người gọi (`/notification-preferences/me`). Chỉ lưu loại người dùng gửi lên; GET
 * trả đủ mọi loại (loại chưa lưu = mặc định bật). Duy nhất theo `userId` (upsert, đua tạo lần đầu thử lại một lần).
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectModel(NotificationPreference.name)
    private readonly preferenceModel: Model<NotificationPreferenceDocument>,
  ) {}

  async get(userId: string): Promise<NotificationPreferencesResponseDto> {
    const stored = await this.preferenceModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    return this.toResponse(stored);
  }

  async update(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponseDto> {
    const changes = this.validateTypes(dto.types);
    if (dto.quietHours && !isValidQuietHours(dto.quietHours)) {
      throw invalid(
        'Giờ yên lặng không hợp lệ (start phải khác end)',
        'quietHours',
      );
    }

    const set: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(changes).map(([type, value]) => [
          `types.${type}`,
          value,
        ]),
      ),
    };
    if (dto.quietHours !== undefined) {
      set.quietHours = dto.quietHours
        ? { start: dto.quietHours.start, end: dto.quietHours.end }
        : null;
    }
    if (Object.keys(set).length === 0) return this.get(userId);

    const filter = { userId: new Types.ObjectId(userId) };
    const run = () =>
      this.preferenceModel
        .findOneAndUpdate(
          filter,
          { $set: set },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        )
        .lean()
        .exec();
    try {
      return this.toResponse(await run());
    } catch (error) {
      // Hai yêu cầu đầu tiên đồng thời: một bên thua unique index `userId`; bản ghi đã có nên thử lại là cập nhật thường.
      if (isDuplicateKeyError(error)) return this.toResponse(await run());
      throw error;
    }
  }

  private validateTypes(
    input: Record<string, unknown>,
  ): Record<string, TypePreference> {
    const known = new Set<string>(Object.values(NotificationType));
    const result: Record<string, TypePreference> = {};
    for (const [type, value] of Object.entries(input)) {
      if (!known.has(type)) {
        throw invalid(`Loại thông báo không hợp lệ: ${type}`, `types.${type}`);
      }
      const pref = value as Partial<TypePreference> | null;
      if (
        typeof pref !== 'object' ||
        pref === null ||
        typeof pref.push !== 'boolean' ||
        typeof pref.inApp !== 'boolean' ||
        Object.keys(pref).length !== 2
      ) {
        throw invalid(
          'Mỗi loại phải có đúng hai giá trị true/false: push và inApp',
          `types.${type}`,
        );
      }
      result[type] = { push: pref.push, inApp: pref.inApp };
    }
    return result;
  }

  private toResponse(
    stored: {
      types?: Record<string, Partial<TypePreference>>;
      quietHours?: { start: string; end: string } | null;
    } | null,
  ): NotificationPreferencesResponseDto {
    return {
      types: resolveTypePreferences(stored?.types),
      quietHours: stored?.quietHours
        ? { start: stored.quietHours.start, end: stored.quietHours.end }
        : null,
    };
  }
}
