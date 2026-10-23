import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsEnum,
  IsMongoId,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';

/** Tối đa 200 khách mỗi lần (tài liệu 05 mục 2.3), xử lý đồng bộ. */
export const BULK_MAX_CUSTOMERS = 200;
const MAX_TAGS = 50;
const MAX_MEMBERS = 20;

export enum BulkOperationType {
  CHANGE_STATUS = 'CHANGE_STATUS',
  /** Thuộc M4 (thẻ): chưa khả dụng, gửi lên sẽ nhận 400. */
  ADD_TAGS = 'ADD_TAGS',
  /** Thuộc M4 (thẻ): chưa khả dụng, gửi lên sẽ nhận 400. */
  REMOVE_TAGS = 'REMOVE_TAGS',
  ASSIGN = 'ASSIGN',
}

export class BulkOperationPayloadDto {
  @ApiPropertyOptional({ description: 'CHANGE_STATUS: tình trạng đích' })
  @IsOptional()
  @IsMongoId()
  statusId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'ADD_TAGS/REMOVE_TAGS (M4, chưa khả dụng)',
  })
  @OptionalNotNull()
  @ArrayMaxSize(MAX_TAGS)
  @ArrayUnique()
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'ASSIGN: người được thêm vào nhóm chăm sóc (đã có thì bỏ qua)',
  })
  @OptionalNotNull()
  @ArrayMaxSize(MAX_MEMBERS)
  @ArrayUnique()
  @IsMongoId({ each: true })
  memberIds?: string[];

  @ApiPropertyOptional({
    description:
      'ASSIGN: phụ trách chính. Bắt buộc với khách chưa có nhóm; khách đã có nhóm thì đổi phụ trách chính sang người này',
  })
  @IsOptional()
  @IsMongoId()
  primaryUserId?: string;
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

  @ApiProperty({ type: BulkOperationPayloadDto })
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
