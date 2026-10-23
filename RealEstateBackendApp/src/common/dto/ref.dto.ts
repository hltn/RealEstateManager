import { ApiProperty } from '@nestjs/swagger';

/** `Ref` dùng chung trong response (tài liệu 05 mục 1.6): tham chiếu danh mục/dự án/nhóm. */
export class RefDto {
  @ApiProperty({ example: '66f1a2b3c4d5e6f708192a3b' })
  id: string;

  @ApiProperty({ example: 'Facebook Ads' })
  label: string;
}

/** `UserRef` dùng chung trong response: chỉ id + tên hiển thị (không lộ email/SĐT). */
export class UserRefDto {
  @ApiProperty({ example: '66f1a2b3c4d5e6f708192a3b' })
  id: string;

  @ApiProperty({ example: 'Hạnh' })
  displayName: string;
}
