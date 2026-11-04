import {
  compareVersions,
  isValidVersion,
  parseVersion,
} from './version-compare.util';

describe('parseVersion / isValidVersion', () => {
  it('tách đúng major/minor/patch và pre-release', () => {
    expect(parseVersion('1.0.3')).toEqual({
      major: 1,
      minor: 0,
      patch: 3,
      prerelease: [],
    });
    expect(parseVersion('2.10.0-rc.1+build.5')).toEqual({
      major: 2,
      minor: 10,
      patch: 0,
      prerelease: ['rc', '1'],
    });
  });

  it.each([
    '',
    '1.0',
    '1.0.3.4',
    'v1.0.3',
    '1.0.x',
    '1.0.3-',
    '1.0.3+',
    'abc',
    '1.0.03',
    '01.0.0',
    '1.00.0',
    '1.0.3-rc..1',
    '1.0.3-rc.',
    '1.0.3+b.',
    '1.0.3-.',
  ])('từ chối định dạng sai "%s"', (value) => {
    expect(parseVersion(value)).toBeNull();
    expect(isValidVersion(value)).toBe(false);
  });
});

describe('compareVersions', () => {
  it('bằng nhau', () => {
    expect(compareVersions('1.0.3', '1.0.3')).toBe(0);
  });

  it('so theo số, không theo chuỗi (1.0.10 > 1.0.9, 1.10.0 > 1.9.0)', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('nhỏ hơn / lớn hơn theo từng cấp', () => {
    expect(compareVersions('1.0.2', '1.0.3')).toBe(-1);
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1);
  });

  it('pre-release thấp hơn bản chính thức cùng số', () => {
    expect(compareVersions('1.0.3-rc.1', '1.0.3')).toBe(-1);
    expect(compareVersions('1.0.3', '1.0.3-rc.1')).toBe(1);
    // Nhưng vẫn cao hơn bản chính thức nhỏ hơn.
    expect(compareVersions('1.0.3-rc.1', '1.0.2')).toBe(1);
  });

  it('so hai pre-release theo từng mục (số < chữ, nhiều mục hơn thì cao hơn)', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
  });

  it('bỏ qua phần build metadata', () => {
    expect(compareVersions('1.0.3+abc', '1.0.3+xyz')).toBe(0);
    expect(compareVersions('1.0.3+abc', '1.0.3')).toBe(0);
  });

  it('ném lỗi khi sai định dạng ở một trong hai phía', () => {
    expect(() => compareVersions('abc', '1.0.0')).toThrow('abc');
    expect(() => compareVersions('1.0.0', '1.0')).toThrow('1.0');
  });
});
