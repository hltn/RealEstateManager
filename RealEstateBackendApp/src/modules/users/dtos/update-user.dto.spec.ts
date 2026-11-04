/**
 * UpdateUserDto unit spec — rule displayName/email khớp CreateUserDto, cả hai field đều tùy chọn.
 * "Ít nhất một trường" và email trùng kiểm ở UsersService.updateProfile (xem users.service.spec.ts).
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

const check = (body: Record<string, unknown>) =>
  validate(plainToInstance(UpdateUserDto, body));

describe('UpdateUserDto', () => {
  it('chỉ displayName, chỉ email, hoặc cả hai → pass', async () => {
    expect(await check({ displayName: 'New Name' })).toHaveLength(0);
    expect(await check({ email: 'new@example.com' })).toHaveLength(0);
    expect(
      await check({ displayName: 'New Name', email: 'new@example.com' }),
    ).toHaveLength(0);
  });

  it('displayName ngoài khoảng 2..50 ký tự (sau trim) → fail', async () => {
    expect(await check({ displayName: 'A' })).not.toHaveLength(0);
    expect(await check({ displayName: ' A ' })).not.toHaveLength(0);
    expect(await check({ displayName: 'A'.repeat(51) })).not.toHaveLength(0);
    expect(await check({ displayName: 'A'.repeat(50) })).toHaveLength(0);
  });

  it('email sai format → fail; email có khoảng trắng hai đầu được trim rồi pass', async () => {
    expect(await check({ email: 'not-email' })).not.toHaveLength(0);
    expect(await check({ email: '  new@example.com ' })).toHaveLength(0);
  });
});
