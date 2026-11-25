import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsMongoId,
  IsOptional,
} from 'class-validator';
import { UserRefDto } from '../../../../common/dto/ref.dto';
import { CareTeamMemberDto } from '../../customers/dtos/customer-response.dto';
import { MAX_MEMBERS_PER_ADD } from '../care-team.constants';

export class AddCareTeamMembersDto {
  @ApiProperty({
    type: [String],
    description:
      'Người được mời (MANAGER/STAFF đang hoạt động, không giới hạn theo nhóm); tối đa 10 thành viên phụ mỗi khách',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEMBERS_PER_ADD)
  @ArrayUnique()
  @IsMongoId({ each: true })
  userIds: string[];

  @ApiPropertyOptional({
    description:
      'Chỉ hợp lệ khi nhóm đang rỗng và người gọi là Quản trị/Quản lý (đặt phụ trách chính lần đầu cho khách cũ); PRIMARY đã khóa nên nhóm đã có người thì 400 VALIDATION_FAILED',
  })
  @IsOptional()
  @IsMongoId()
  primaryUserId?: string;
}

export class CareTeamResponseDto {
  @ApiProperty({ type: [CareTeamMemberDto] }) members: CareTeamMemberDto[];
  @ApiProperty({ nullable: true, type: UserRefDto })
  primary: UserRefDto | null;
}
