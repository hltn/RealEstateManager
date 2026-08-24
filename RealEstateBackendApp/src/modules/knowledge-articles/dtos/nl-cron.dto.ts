import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ParseNlDto {
  @ApiProperty({
    description: 'Natural language schedule description',
    example: 'Chạy hàng ngày lúc 8h sáng từ thứ 2 đến thứ 6',
  })
  @IsString()
  @IsNotEmpty()
  description: string;
}

export class PreviewScheduleDto {
  @ApiProperty({
    description: 'Cron expression to preview',
    example: '0 8 * * 1-5',
  })
  @IsString()
  @IsNotEmpty()
  cronExpression: string;
}

export class ActivateScheduleDto {
  @ApiProperty({
    description: 'Cron expression to activate',
    example: '0 8 * * 1-5',
  })
  @IsString()
  @IsNotEmpty()
  cronExpression: string;

  @ApiProperty({
    description: 'Original natural language description',
    example: 'Chạy hàng ngày 8h sáng từ T2-T6',
  })
  @IsString()
  @IsNotEmpty()
  nlDescription: string;
}
