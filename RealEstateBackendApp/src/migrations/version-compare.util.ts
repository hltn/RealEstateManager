/** Kết quả so sánh: -1 (a < b), 0 (bằng), 1 (a > b). */
export type VersionOrder = -1 | 0 | 1;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Các mục của phần pre-release (`1.0.3-rc.1` => `['rc', '1']`); rỗng nếu là bản chính thức. */
  prerelease: string[];
}

const IDENTIFIER = '[0-9A-Za-z-]+';
/** Số ở phần lõi: không có số 0 đứng đầu (đúng semver: `1.0.03` là sai). */
const CORE_NUMBER = '0|[1-9]\\d*';
const SEMVER_PATTERN = new RegExp(
  `^(${CORE_NUMBER})\\.(${CORE_NUMBER})\\.(${CORE_NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+${IDENTIFIER}(?:\\.${IDENTIFIER})*)?$`,
);
const NUMERIC_IDENTIFIER = /^\d+$/;

/** Tách `x.y.z[-pre][+build]`; `null` nếu sai định dạng. Phần build (`+...`) bị bỏ qua khi so sánh (đúng semver). */
export const parseVersion = (value: string): ParsedVersion | null => {
  const match = SEMVER_PATTERN.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
};

export const isValidVersion = (value: string): boolean =>
  parseVersion(value) !== null;

const compareNumbers = (a: number, b: number): VersionOrder =>
  a === b ? 0 : a < b ? -1 : 1;

/** So sánh từng mục pre-release: số < chữ; số so theo giá trị số, chữ so theo thứ tự ASCII. */
const compareIdentifier = (a: string, b: string): VersionOrder => {
  const aNumeric = NUMERIC_IDENTIFIER.test(a);
  const bNumeric = NUMERIC_IDENTIFIER.test(b);
  if (aNumeric && bNumeric) return compareNumbers(Number(a), Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
};

/**
 * So sánh hai phiên bản semver (không dùng thư viện ngoài). Quy tắc: so major, minor, patch; bản pre-release THẤP hơn
 * bản chính thức cùng số (`1.0.3-rc.1 < 1.0.3`); hai pre-release so từng mục, nhiều mục hơn (khi các mục đầu bằng nhau)
 * thì cao hơn. Ném lỗi nếu một trong hai sai định dạng — nơi gọi quyết định từ chối.
 */
export const compareVersions = (a: string, b: string): VersionOrder => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left) throw new Error(`Phiên bản sai định dạng semver: "${a}"`);
  if (!right) throw new Error(`Phiên bản sai định dạng semver: "${b}"`);

  const core =
    compareNumbers(left.major, right.major) ||
    compareNumbers(left.minor, right.minor) ||
    compareNumbers(left.patch, right.patch);
  if (core !== 0) return core;

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const order = compareIdentifier(
      left.prerelease[index],
      right.prerelease[index],
    );
    if (order !== 0) return order;
  }
  return compareNumbers(left.prerelease.length, right.prerelease.length);
};
