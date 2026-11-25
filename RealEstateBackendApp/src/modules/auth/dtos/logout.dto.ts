import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body tùy chọn của `POST /auth/logout`. Sai kiểu (không phải chuỗi), field lạ hoặc JSON hỏng thì 400. Chuỗi hợp lệ
 * nhưng không phải ObjectId/không tồn tại/của người khác thì bỏ qua im lặng (không dùng `@IsMongoId`) để đăng xuất
 * không thất bại vì thiết bị push và không lộ sự tồn tại của thiết bị người khác.
 */
export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Id thiết bị push (từ `POST /push-subscriptions`) cần thu hồi khi đăng xuất (lý do LOGOUT). Chỉ có hiệu lực nếu thuộc về chính người đăng xuất; id hợp lệ nhưng lạ/của người khác bị bỏ qua im lặng (phản hồi như nhau); sai kiểu JSON thì 400',
    example: '665f1c2e8b3a4d0012ab34cd',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  pushSubscriptionId?: string;
}
