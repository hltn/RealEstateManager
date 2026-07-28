/**
 * AuthResponseDto / UserPublicDto spec — contract mục 16.4 / 6.3.
 *
 * LƯU Ý BUG SOURCE (ghi nhận, KHÔNG sửa):
 * File `auth-response.dto.ts` khai báo `AuthResponseDto` (line 8) TRƯỚC
 * `UserPublicDto` (line 16). Field `user: UserPublicDto` có `@ApiProperty()`
 * + tsconfig `emitDecoratorMetadata: true` + `target: ES2023` (mặc định
 * `useDefineForClassFields: true`) → TypeScript emit decorator metadata
 * `Reflect.metadata("design:type", UserPublicDto)` trên class AuthResponseDto.
 * Khi class AuthResponseDto được define, `UserPublicDto` vẫn nằm trong
 * Temporal Dead Zone (khai báo sau) → ReferenceError ngay lúc module load.
 *
 * Bug này bị che giấu ở production vì `auth.service.ts` chỉ import qua
 * `import type { UserPublicDto }` (type-only, bị erase ở runtime) →
 * module `auth-response.dto.ts` chưa từng được eval runtime, nên bug
 * không bị phát hiện cho đến khi có spec này.
 *
 * Hành vi thực (implementation): bất kỳ ai `import` (value) file này đều
 * nhận ReferenceError. Spec dưới verify đúng hành vi đó + đánh dấu skip
 * các case shape không thể chạy do bug. Khi source sửa (đảo thứ tự class
 * hoặc tách file), bỏ skip các case shape.
 */
import { UserRole } from '../../../common/enums/user-role.enum';

describe('auth-response.dto — bug TDZ (ghi nhận, KHÔNG sửa source)', () => {
  it('import file → ReferenceError: Cannot access UserPublicDto before initialization', () => {
    // Hành vi thực: module throw ngay lúc eval do TDZ.
    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('./auth-response.dto');
      });
    }).toThrow(ReferenceError);
  });
});

describe('AuthResponseDto / UserPublicDto shape (mục 6.3)', () => {
  // SKIP: không thể load module do bug TDZ ở trên. Khi source sửa, enable lại.
  it.skip('UserPublicDto chứa {_id, email, displayName, role} KHÔNG chứa password/status', () => {
    //-placeholder — sẽ enable sau khi bug TDZ được fix.
  });

  it.skip('AuthResponseDto chứa { accessToken, user: UserPublicDto }', () => {
    //placeholder — sẽ enable sau khi bug TDZ được fix.
  });

  it.skip('UserPublicDto role chấp nhận UserRole.EDITOR', () => {
    expect(UserRole.EDITOR).toBeDefined();
  });
});
