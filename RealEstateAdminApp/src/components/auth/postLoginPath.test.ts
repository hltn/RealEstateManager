import { describe, expect, it } from 'vitest';
import { UserRole } from '../../types/user';
import { isSafeReturnTo, resolvePostLoginPath } from './postLoginPath';

const base = { isCrmEnabled: true, crmDefaultPath: '/crm/today' };

describe('isSafeReturnTo', () => {
  it.each(['/crm/customers', '/crm/customers/abc?tab=1#x', '/manage-wp'])('chấp nhận đường dẫn nội bộ %s', (value) => {
    expect(isSafeReturnTo(value)).toBe(true);
  });

  it.each([
    ['URL tuyệt đối', 'https://evil.test/x'],
    ['protocol-relative', '//evil.test/x'],
    ['backslash', '/\\evil.test'],
    ['không bắt đầu bằng /', 'crm/customers'],
    ['ký tự điều khiển', '/crm/\r\nSet-Cookie'],
    ['quay lại /login', '/login?x=1'],
    ['rỗng', ''],
    ['không phải chuỗi', { pathname: '/crm' }],
  ])('từ chối %s', (_label, value) => {
    expect(isSafeReturnTo(value)).toBe(false);
  });
});

describe('resolvePostLoginPath', () => {
  it('quay lại trang đang định vào khi an toàn', () => {
    expect(resolvePostLoginPath({ ...base, roles: [UserRole.STAFF], returnTo: '/crm/customers' })).toBe('/crm/customers');
  });

  it('returnTo không an toàn hoặc chỉ là "/" thì về màn mặc định theo vai trò', () => {
    expect(resolvePostLoginPath({ ...base, roles: [UserRole.ADMIN], returnTo: '//evil.test' })).toBe('/crm/today');
    expect(resolvePostLoginPath({ ...base, roles: [UserRole.MANAGER], returnTo: '/' })).toBe('/crm/today');
  });

  it('nhiều role: có BẤT KỲ role CRM (vd STAFF+EDITOR) thì vào thẳng CRM', () => {
    expect(resolvePostLoginPath({ ...base, roles: [UserRole.STAFF, UserRole.EDITOR], returnTo: undefined })).toBe('/crm/today');
  });

  it('ADMIN vào thẳng CRM; EDITOR hoặc CRM tắt thì ở "/"', () => {
    expect(resolvePostLoginPath({ ...base, roles: [UserRole.ADMIN], returnTo: undefined })).toBe('/crm/today');
    expect(resolvePostLoginPath({ ...base, roles: [UserRole.EDITOR], returnTo: undefined })).toBe('/');
    expect(resolvePostLoginPath({ ...base, isCrmEnabled: false, roles: [UserRole.ADMIN], returnTo: undefined })).toBe('/');
  });
});
