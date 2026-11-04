import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsMongoId } from 'class-validator';

/** DTO đặt toàn bộ nhóm của người dùng (`PATCH /users/:id/teams`); mảng rỗng = gỡ khỏi mọi nhóm. */
export class UpdateUserTeamsDto {
  @ApiProperty({
    type: [String],
    example: ['66f1a2b3c4d5e6f708192a3b'],
    description: 'Id các nhóm, rỗng để gỡ khỏi mọi nhóm',
  })
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  teamIds: string[];
}
