import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, ValidateIf } from 'class-validator';

/** DTO gán nhóm cho người dùng; `teamId = null` nghĩa là gỡ khỏi nhóm. */
export class UpdateUserTeamDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '66f1a2b3c4d5e6f708192a3b',
    description: 'Id nhóm, hoặc null để gỡ khỏi nhóm',
  })
  @ValidateIf((_obj, value) => value !== null)
  @IsMongoId()
  teamId: string | null;
}
