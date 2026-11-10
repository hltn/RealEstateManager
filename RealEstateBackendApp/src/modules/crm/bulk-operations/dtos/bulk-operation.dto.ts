import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsDefined,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CatalogCode } from '../../../../common/decorators/catalog-code.decorator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { HasVisibleChar } from '../../../../common/decorators/has-visible-char.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { CUSTOMER_REASON_MAX_LENGTH } from '../../customers/customer.constants';

/** Tối đa 200 khách mỗi lần (tài liệu 05 mục 2.3), xử lý đồng bộ. */
export const BULK_MAX_CUSTOMERS = 200;
const MAX_TAGS = 50;
const MAX_MEMBERS = 20;

export enum BulkOperationType {
  CHANGE_STATUS = 'CHANGE_STATUS',
  /** Gắn thẻ (M4): bỏ qua khách đã có thẻ. */
  ADD_TAGS = 'ADD_TAGS',
  /** Gỡ thẻ (M4): bỏ qua khách chưa có thẻ. */
  REMOVE_TAGS = 'REMOVE_TAGS',
  ASSIGN = 'ASSIGN',
  /** Xóa mềm hàng loạt (v1.0.2 mục D): chỉ khách thuộc nhóm "Bỏ", kiểm quyền từng khách, cần `payload.reason`. */
  DELETE = 'DELETE',
}

export class BulkOperationPayloadDto {
  @ApiPropertyOptional({
    description:
      'CHANGE_STATUS: tình trạng đích. Deprecated: dùng `statusCode`; phải gửi một trong hai',
  })
  @IsOptional()
  @IsMongoId()
  statusId?: string;

  @ApiPropertyOptional({
    description:
      'CHANGE_STATUS: mã tình trạng đích (gửi cùng `statusId` mà không cùng bản ghi: 400)',
  })
  @OptionalNotNull()
  @CatalogCode()
  statusCode?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'ADD_TAGS/REMOVE_TAGS: thẻ cần gắn/gỡ (bắt buộc, tối đa 50)',
  })
  @OptionalNotNull()
  @ArrayMaxSize(MAX_TAGS)
  @ArrayUnique()
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'ASSIGN: người được thêm vào nhóm chăm sóc (đã có thì bỏ qua; không giới hạn theo nhóm; khách đã đủ 10 thành viên phụ báo CARE_TEAM_LIMIT_EXCEEDED riêng từng khách)',
  })
  @OptionalNotNull()
  @ArrayMaxSize(MAX_MEMBERS)
  @ArrayUnique()
  @IsMongoId({ each: true })
  memberIds?: string[];

  @ApiPropertyOptional({
    description:
      'ASSIGN: KHÔNG được truyền (400 VALIDATION_FAILED) — PRIMARY đã khóa, hàng loạt chỉ thêm MEMBER; khách chưa có nhóm báo PRIMARY_REQUIRED riêng từng khách',
  })
  @IsOptional()
  @IsMongoId()
  primaryUserId?: string;

  @ApiPropertyOptional({
    maxLength: CUSTOMER_REASON_MAX_LENGTH,
    description:
      'DELETE: lý do xóa chung cho cả lô (bắt buộc, ghi vào audit CUSTOMER_DELETED của từng khách)',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(CUSTOMER_REASON_MAX_LENGTH)
  @HasVisibleChar()
  reason?: string;
}

export class BulkOperationDto {
  @ApiProperty({ enum: BulkOperationType })
  @IsEnum(BulkOperationType)
  type: BulkOperationType;

  @ApiProperty({ type: [String], maxItems: BULK_MAX_CUSTOMERS })
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX_CUSTOMERS)
  @ArrayUnique()
  @IsMongoId({ each: true })
  customerIds: string[];

  @ApiProperty({
    type: BulkOperationPayloadDto,
    description:
      'Bắt buộc có (kể cả `{}`): mọi loại thao tác đều đọc payload; thiếu thì 400 thay vì lỗi 500',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => BulkOperationPayloadDto)
  payload: BulkOperationPayloadDto;
}

export class BulkFailureDto {
  @ApiProperty() customerId: string;
  @ApiProperty({
    description:
      'Mã lỗi nghiệp vụ; `CUSTOMER_NOT_FOUND` gồm cả khách ngoài phạm vi của người gọi',
  })
  errorCode: string;
}

export class BulkOperationResponseDto {
  @ApiProperty({ type: [String] }) succeeded: string[];
  @ApiProperty({ type: [BulkFailureDto] }) failed: BulkFailureDto[];
}
