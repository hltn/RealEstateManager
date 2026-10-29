import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { RefDto, UserRefDto } from '../../../../common/dto/ref.dto';
import { CatalogPaginationQueryDto } from '../../catalogs/dtos/catalog-common.dto';

export class ListAssignableUsersQueryDto extends CatalogPaginationQueryDto {
  @ApiPropertyOptional({ description: 'Tìm theo tên hiển thị', maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Chỉ lấy người thuộc nhóm này (phải nằm trong phạm vi của người gọi)',
  })
  @IsOptional()
  @IsMongoId()
  teamId?: string;
}

export class AssignableUserResponseDto extends UserRefDto {
  @ApiProperty({
    enum: [UserRole.MANAGER, UserRole.STAFF],
    description:
      'Role cao nhất trong các role được phân chăm sóc (MANAGER/STAFF)',
  })
  role: UserRole;

  @ApiProperty({ enum: UserRole, isArray: true })
  roles: UserRole[];

  @ApiProperty({
    nullable: true,
    type: RefDto,
    description: 'Nhóm chính (phần tử đầu của teams)',
  })
  team: RefDto | null;

  @ApiProperty({ type: [String] })
  teamIds: string[];

  @ApiProperty({ type: [RefDto] })
  teams: RefDto[];
}
