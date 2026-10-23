import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CsvList } from '../../../../common/decorators/csv-list.decorator';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { CrmAuditEntityType } from '../../audit-logs/crm-audit.constants';
import { CUSTOMER_LIST_TABS } from '../customer.constants';
import type { CustomerListTab } from '../customer.constants';

const MAX_FILTER_VALUES = 50;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Ngày phải theo định dạng YYYY-MM-DD (giờ Việt Nam)';

/**
 * Bộ lọc chung của danh sách khách và `list-counts` (tài liệu 05 mục 2.3). Lọc nhiều giá trị: chuỗi phân tách
 * dấu phẩy, tối đa 50. Bộ lọc theo thẻ/chân dung (`tagIds`, `occupation`, `personaFilters`) thuộc M4.
 */
export class CustomerFilterQueryDto {
  @ApiPropertyOptional({
    description:
      'Tìm theo tên (không dấu), email (có @) hoặc SĐT: toàn số < 4 chữ số không có kết quả, 4-5 số khớp đuôi, từ 6 số khớp chuỗi con',
    minLength: 2,
    maxLength: 100,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Id tình trạng, phân tách dấu phẩy',
  })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsMongoId({ each: true })
  statusIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsMongoId({ each: true })
  sourceIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsMongoId({ each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Gồm cả khu vực con' })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsMongoId({ each: true })
  areaIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Bất kỳ ai trong nhóm chăm sóc',
  })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsMongoId({ each: true })
  assigneeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsMongoId({ each: true })
  primaryAssigneeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsMongoId({ each: true })
  teamIds?: string[];

  @ApiPropertyOptional({
    type: [Number],
    description: '0,25,50,75,100 (nhiều giá trị)',
  })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(['0', '25', '50', '75', '100'], { each: true })
  progress?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progressMin?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progressMax?: number;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  updatedFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-21' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  updatedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  lastCareFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  lastCareTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  hasNationalId?: boolean;
}

/** Danh sách khách: bộ lọc + phân trang + tab + sắp xếp. */
export class ListCustomersQueryDto extends IntersectionType(
  PaginationQueryDto,
  CustomerFilterQueryDto,
) {
  @ApiPropertyOptional({ enum: CUSTOMER_LIST_TABS, default: 'ALL' })
  @IsOptional()
  @IsIn(CUSTOMER_LIST_TABS as readonly string[])
  listGroup?: CustomerListTab;

  @ApiPropertyOptional({
    description:
      'lastUpdatedAt | fullName | progress | createdAt | nextAppointmentAt | lastCareLogAt | personaCompleteness; tiền tố - = giảm dần',
    default: '-lastUpdatedAt',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sort?: string;
}

/** `list-counts` nhận đúng bộ lọc của danh sách (bỏ `page`, `limit`, `sort`, `listGroup`). */
export class ListCustomerCountsQueryDto extends CustomerFilterQueryDto {}

/** Danh sách khách đã xóa mềm (Quản trị). */
export class ListDeletedCustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  deletedFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-21' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  deletedTo?: string;
}

/** Lịch sử thay đổi của một khách. */
export class ListHistoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Lọc theo action, phân tách dấu phẩy',
  })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  actions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-21' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  to?: string;
}

/** Audit toàn CRM (Quản trị). */
export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CrmAuditEntityType })
  @IsOptional()
  @IsEnum(CrmAuditEntityType)
  entityType?: CrmAuditEntityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-21' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  to?: string;
}

/** Nhật ký xem CCCD (chỉ phân trang). */
export class ListNationalIdViewsQueryDto extends PaginationQueryDto {}
