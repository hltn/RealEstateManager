import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
} from 'class-validator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { APPOINTMENT_MAX_ASSIGNEES } from '../appointment.constants';

/**
 * Trường `assigneeIds` của request lịch hẹn (FR-30): 1..20 id, khử trùng GIỮ THỨ TỰ trước khi validate (gửi trùng
 * không bị lỗi). Có cả `assigneeId` cũ (deprecated) thì `assigneeIds` thắng (nơi gọi xử lý, xem
 * `requestedAssigneeIds`).
 */
export const AssigneeIdsField = (): PropertyDecorator =>
  applyDecorators(
    ApiPropertyOptional({
      type: [String],
      minItems: 1,
      maxItems: APPOINTMENT_MAX_ASSIGNEES,
      description:
        'Người thực hiện (1..20 người, khử trùng giữ thứ tự), phải thuộc tập hợp lệ của khách: thành viên nhóm chăm sóc, Quản lý nhóm chủ, hoặc người tạo khách. Có cả `assigneeId` (deprecated) thì `assigneeIds` thắng. Mặc định: người đặt lịch nếu thuộc tập, không thì phụ trách chính',
    }),
    OptionalNotNull(),
    Transform(({ value }: { value: unknown }) =>
      Array.isArray(value) ? [...new Set(value as unknown[])] : value,
    ),
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(APPOINTMENT_MAX_ASSIGNEES),
    IsMongoId({ each: true }),
  );
