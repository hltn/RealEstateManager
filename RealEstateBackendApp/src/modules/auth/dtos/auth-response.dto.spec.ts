/**
 * AuthResponseDto / UserPublicDto spec — contract mục 16.4 / 6.3.
 *
 * Sau khi fix bug TDZ (đảo thứ tự class: UserPublicDto trước AuthResponseDto),
 * module load bình thường — các case shape được enable lại.
 */
import { UserRole } from '../../../common/enums/user-role.enum';
import { AuthResponseDto, UserPublicDto } from './auth-response.dto';

describe('auth-response.dto — load module không throw TDZ', () => {
  it('import file thành công (KHÔNG còn ReferenceError sau khi đảo class)', () => {
    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('./auth-response.dto');
      });
    }).not.toThrow();
  });
});

describe('AuthResponseDto / UserPublicDto shape (mục 6.3)', () => {
  it('UserPublicDto chứa {_id, email, displayName, role} KHÔNG chứa password/status', () => {
    const instance: UserPublicDto = {
      _id: 'u1',
      email: 'a@b.com',
      displayName: 'User A',
      role: UserRole.EDITOR,
    };
    expect(instance).toEqual({
      _id: 'u1',
      email: 'a@b.com',
      displayName: 'User A',
      role: UserRole.EDITOR,
    });
    // Đảm bảo shape KHÔNG có password/status.
    expect((instance as unknown as Record<string, unknown>).password).toBeUndefined();
    expect((instance as unknown as Record<string, unknown>).status).toBeUndefined();
  });

  it('AuthResponseDto chứa { accessToken, user: UserPublicDto }', () => {
    const dto: AuthResponseDto = {
      accessToken: 'tok',
      user: {
        _id: 'u1',
        email: 'a@b.com',
        displayName: 'User A',
        role: UserRole.ADMIN,
      },
    };
    expect(dto.accessToken).toBe('tok');
    expect(dto.user).toEqual({
      _id: 'u1',
      email: 'a@b.com',
      displayName: 'User A',
      role: UserRole.ADMIN,
    });
  });

  it('UserPublicDto role chấp nhận UserRole.EDITOR', () => {
    expect(UserRole.EDITOR).toBeDefined();
    const dto: UserPublicDto = {
      _id: 'u2',
      email: 'e@f.com',
      displayName: 'Editor',
      role: UserRole.EDITOR,
    };
    expect(dto.role).toBe(UserRole.EDITOR);
  });
});
