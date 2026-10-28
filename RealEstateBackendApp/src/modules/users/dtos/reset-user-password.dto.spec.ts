/** ResetUserPasswordDto unit spec — rule mật khẩu khớp CreateUserDto.password (string, tối thiểu 8 ký tự). */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetUserPasswordDto } from './reset-user-password.dto';

const check = (body: Record<string, unknown>) =>
  validate(plainToInstance(ResetUserPasswordDto, body));

describe('ResetUserPasswordDto', () => {
  it('newPassword từ 8 ký tự → pass; 7 ký tự → fail', async () => {
    expect(await check({ newPassword: '12345678' })).toHaveLength(0);
    expect(await check({ newPassword: '1234567' })).not.toHaveLength(0);
  });

  it('thiếu hoặc không phải chuỗi → fail', async () => {
    expect(await check({})).not.toHaveLength(0);
    expect(await check({ newPassword: 12345678 })).not.toHaveLength(0);
  });
});
