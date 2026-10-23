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
  @ApiProperty({ enum: [UserRole.MANAGER, UserRole.STAFF] })
  role: UserRole;

  @ApiProperty({ nullable: true, type: RefDto })
  team: RefDto | null;
}
