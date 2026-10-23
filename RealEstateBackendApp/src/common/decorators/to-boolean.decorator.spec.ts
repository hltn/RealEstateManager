import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, validateSync } from 'class-validator';
import { ToBoolean } from './to-boolean.decorator';

class QueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

const parse = (raw: unknown) => plainToInstance(QueryDto, { isActive: raw });

describe('ToBoolean', () => {
  it('"false" thành false thật (không bị ép thành true như Boolean("false"))', () => {
    expect(parse('false').isActive).toBe(false);
    expect(parse('true').isActive).toBe(true);
  });

  it('giá trị lạ giữ nguyên nên IsBoolean báo lỗi; vắng mặt thì hợp lệ', () => {
    expect(validateSync(parse('yes'))).toHaveLength(1);
    expect(validateSync(plainToInstance(QueryDto, {}))).toHaveLength(0);
  });
});
