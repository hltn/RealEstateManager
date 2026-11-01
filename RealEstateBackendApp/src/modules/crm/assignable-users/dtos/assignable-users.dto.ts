import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { RefDto, UserRefDto } from '../../../../common/dto/ref.dto';
import { CatalogPaginationQueryDto } from '../../catalogs/dtos/catalog-common.dto';

/** Mục đích dùng danh sách: gán người chăm sóc (mặc định, chặt) hay nguồn cho ô lọc "Người phụ trách". */
export enum AssignableUsersPurpose {
  ASSIGN = 'assign',
  FILTER = 'filter',
}

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

  @ApiPropertyOptional({
    enum: AssignableUsersPurpose,
    default: AssignableUsersPurpose.ASSIGN,
    description:
      '"assign" (mặc định): người được phép gán. "filter": nguồn cho ô lọc Người phụ trách — với Quản lý là mọi người ' +
      'trong careTeam của các khách Quản lý được thấy; Quản trị/Nhân viên giữ hành vi của "assign"',
  })
  @IsOptional()
  @IsEnum(AssignableUsersPurpose)
  purpose?: AssignableUsersPurpose;
}

export class AssignableUserResponseDto extends UserRefDto {
  @ApiProperty({
    enum: UserRole,
    description:
      'Role cao nhất trong các role được phân chăm sóc (MANAGER/STAFF). Chỉ với purpose=filter của Quản lý có thể là ADMIN/EDITOR ' +
      '(người từng được phân nhưng đã đổi role)',
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
