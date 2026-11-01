import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { UserRefDto } from '../../../../common/dto/ref.dto';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { CareTeamMemberDto } from '../../customers/dtos/customer-response.dto';
import {
  CareTeamRequestBox,
  CareTeamRequestStatus,
  JOIN_MESSAGE_MAX_LENGTH,
  MAX_MEMBERS_PER_ADD,
  RESOLUTION_NOTE_MAX_LENGTH,
} from '../care-team.constants';

export class AddCareTeamMembersDto {
  @ApiProperty({
    type: [String],
    description: 'Người được thêm (MANAGER/STAFF đang hoạt động)',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEMBERS_PER_ADD)
  @ArrayUnique()
  @IsMongoId({ each: true })
  userIds: string[];

  @ApiPropertyOptional({
    description:
      'Bắt buộc ở lần phân đầu tiên (nhóm đang rỗng); nhóm đã có người thì dùng PUT primary',
  })
  @IsOptional()
  @IsMongoId()
  primaryUserId?: string;
}

export class RemoveCareTeamMemberQueryDto {
  @ApiPropertyOptional({
    description: 'Bắt buộc khi gỡ phụ trách chính: người thay thế',
  })
  @IsOptional()
  @IsMongoId()
  newPrimaryUserId?: string;
}

export class ChangePrimaryDto {
  @ApiProperty({ description: 'Người làm phụ trách chính mới' })
  @IsMongoId()
  userId: string;
}

export class CareTeamResponseDto {
  @ApiProperty({ type: [CareTeamMemberDto] }) members: CareTeamMemberDto[];
  @ApiProperty({ nullable: true, type: UserRefDto })
  primary: UserRefDto | null;
}

export class CreateCareTeamRequestDto {
  @ApiProperty({
    description:
      '`customerRef` lấy từ kết quả phone-lookups / lỗi 409 trùng SĐT',
  })
  @IsMongoId()
  customerRef: string;

  @ApiPropertyOptional({ maxLength: JOIN_MESSAGE_MAX_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(JOIN_MESSAGE_MAX_LENGTH)
  message?: string;
}

export class ListCareTeamRequestsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    enum: CareTeamRequestBox,
    description: '`mine` = mình gửi; `to-review` = mình có quyền duyệt',
  })
  @IsEnum(CareTeamRequestBox)
  box: CareTeamRequestBox;

  @ApiPropertyOptional({ enum: CareTeamRequestStatus })
  @IsOptional()
  @IsEnum(CareTeamRequestStatus)
  status?: CareTeamRequestStatus;
}

export class ResolveCareTeamRequestDto {
  @ApiProperty({
    enum: [
      CareTeamRequestStatus.APPROVED,
      CareTeamRequestStatus.REJECTED,
      CareTeamRequestStatus.CANCELED,
    ],
    description: 'Người duyệt: APPROVED/REJECTED; người gửi: CANCELED',
  })
  @IsIn([
    CareTeamRequestStatus.APPROVED,
    CareTeamRequestStatus.REJECTED,
    CareTeamRequestStatus.CANCELED,
  ])
  status:
    | CareTeamRequestStatus.APPROVED
    | CareTeamRequestStatus.REJECTED
    | CareTeamRequestStatus.CANCELED;

  @ApiPropertyOptional({ maxLength: RESOLUTION_NOTE_MAX_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(RESOLUTION_NOTE_MAX_LENGTH)
  resolutionNote?: string;
}

export class CreateCareTeamRequestResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: [CareTeamRequestStatus.PENDING] })
  status: CareTeamRequestStatus.PENDING;
  @ApiProperty() createdAt: string;
}

export class CareTeamRequestCustomerDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ description: 'Chỉ người duyệt thấy' })
  fullName?: string;
}

export class CareTeamRequestItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: CareTeamRequestCustomerDto })
  customer: CareTeamRequestCustomerDto;
  @ApiProperty({ type: UserRefDto }) requester: UserRefDto;
  @ApiProperty({ nullable: true, type: String }) message: string | null;
  @ApiProperty({ enum: CareTeamRequestStatus }) status: CareTeamRequestStatus;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true, type: UserRefDto })
  resolvedBy: UserRefDto | null;
  @ApiProperty({ nullable: true, type: String }) resolvedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) resolutionNote: string | null;
}
