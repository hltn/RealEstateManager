import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { CsvList } from '../../../../common/decorators/csv-list.decorator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { RefDto, UserRefDto } from '../../../../common/dto/ref.dto';
import { StatusRefDto } from '../../customers/dtos/customer-response.dto';
import {
  DailyTaskGroup,
  DailyTaskKind,
  DEFAULT_UPCOMING_DAYS,
  MAX_UPCOMING_DAYS,
} from '../daily-task.rules';

export const DAILY_TASK_SCOPES = ['mine', 'team'] as const;
export type DailyTaskScope = (typeof DAILY_TASK_SCOPES)[number];

export class DailyTaskSummaryQueryDto {
  @ApiPropertyOptional({
    enum: DAILY_TASK_SCOPES,
    default: 'mine',
    description:
      '`team` chỉ dành cho Quản trị/Quản lý (mọi khách trong phạm vi)',
  })
  @IsOptional()
  @IsIn(DAILY_TASK_SCOPES as readonly string[])
  scope?: DailyTaskScope;

  @ApiPropertyOptional({
    default: DEFAULT_UPCOMING_DAYS,
    minimum: 1,
    maximum: MAX_UPCOMING_DAYS,
    description: 'Cửa sổ "Sắp tới" (ngày)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_UPCOMING_DAYS)
  upcomingDays?: number;
}

export class ListDailyTasksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: DailyTaskGroup,
    description: 'Bỏ trống = cả 3 nhóm (chế độ Kanban)',
  })
  @IsOptional()
  @IsEnum(DailyTaskGroup)
  group?: DailyTaskGroup;

  @ApiPropertyOptional({ enum: DAILY_TASK_SCOPES, default: 'mine' })
  @IsOptional()
  @IsIn(DAILY_TASK_SCOPES as readonly string[])
  scope?: DailyTaskScope;

  @ApiPropertyOptional({
    enum: DailyTaskKind,
    isArray: true,
    description: 'Phân tách bằng dấu phẩy',
  })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(DailyTaskKind, { each: true })
  kinds?: DailyTaskKind[];

  @ApiPropertyOptional({
    default: DEFAULT_UPCOMING_DAYS,
    minimum: 1,
    maximum: MAX_UPCOMING_DAYS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_UPCOMING_DAYS)
  upcomingDays?: number;
}

export class DailyTaskCustomerDto {
  @ApiProperty() id: string;
  @ApiProperty() fullName: string;
  @ApiProperty({
    example: '0912 ••• 678',
    description:
      'SĐT khách đã che (cùng quy ước `phoneMasked` ở danh sách khách); không bao giờ trả số đầy đủ',
  })
  phoneMasked: string;
  @ApiProperty({ type: StatusRefDto }) status: StatusRefDto;
  @ApiProperty({ type: [RefDto] }) projects: RefDto[];
}

export class DailyTaskLastCareLogDto {
  @ApiProperty() occurredAt: string;
  @ApiProperty() excerpt: string;
}

export class DailyTaskResponseDto {
  @ApiProperty({ example: 'APPOINTMENT:66f1a2b3c4d5e6f708192a3b' })
  id: string;
  @ApiProperty({ enum: DailyTaskKind }) kind: DailyTaskKind;
  @ApiProperty() dueAt: string;
  @ApiProperty({ enum: DailyTaskGroup }) group: DailyTaskGroup;
  @ApiProperty({ type: DailyTaskCustomerDto }) customer: DailyTaskCustomerDto;
  @ApiProperty() title: string;
  @ApiProperty({
    type: RefDto,
    nullable: true,
    description:
      'Dự án của buổi hẹn: chỉ việc kiểu APPOINTMENT có lịch gắn dự án (vẫn trả tên khi dự án đã ngừng/ẩn); các việc khác và lịch chưa gắn dự án = null. Không ảnh hưởng `customer.projects` (luôn là dự án khách quan tâm)',
  })
  project: RefDto | null;
  @ApiProperty({ nullable: true, type: DailyTaskLastCareLogDto })
  lastCareLog: DailyTaskLastCareLogDto | null;
  @ApiProperty() suggestion: string;
  @ApiPropertyOptional() appointmentId?: string;
  @ApiPropertyOptional() careLogId?: string;
  @ApiProperty({ nullable: true, type: UserRefDto })
  assignee: UserRefDto | null;
  @ApiProperty({ description: 'Người gọi là phụ trách chính của khách' })
  isPrimary: boolean;
}

export class DailyTaskSummaryDto {
  @ApiProperty() overdue: number;
  @ApiProperty() today: number;
  @ApiProperty() upcoming: number;
}
