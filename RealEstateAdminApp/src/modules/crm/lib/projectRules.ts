/**
 * Quy tắc thuần của "Dự án" (04 §3.3, 05 §2.8): dựng mục rỗng, chuẩn hoá, kiểm hợp lệ theo từng trường, định dạng giá,
 * sinh mã gợi ý, nhãn dự án dùng chung và chuyển dữ liệu cũ (giá dạng chữ, trạng thái dạng chữ). Dùng chung dialog Thêm/Sửa ở
 * màn Dự án, tab Dự án của Cài đặt, bộ lọc, migration localStorage và lớp dữ liệu (mock API) — không phụ thuộc React/store.
 */
import { formatBudgetRange } from '@crm/lib/customerRules';
import { normalizeVietnamese, toSlug } from '@crm/lib/text';
import type { CrmCatalogs, FieldChange, Project, ProjectPriceUnit, ProjectStatus } from '@crm/types/crm';

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_CODE_MAX_LENGTH = 20;
export const PROJECT_FIELD_MAX_LENGTH = 200;
export const PROJECT_TYPES_MAX_COUNT = 10;
/** Nhãn khi dự án không còn trong danh mục (đã xoá cứng/không tìm thấy). */
export const UNKNOWN_PROJECT_LABEL = 'Dự án đã ngừng';

/** Mã dự án theo doc 04/05: `^[A-Za-z0-9_-]{1,20}$` (lưu viết hoa; so trùng không phân biệt hoa thường). */
const PROJECT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

export const isValidProjectCode = (code: string): boolean => PROJECT_CODE_PATTERN.test(code.trim());

export type ProjectField = 'name' | 'code' | 'developer' | 'location' | 'propertyTypes' | 'priceFrom' | 'priceTo';

export type ProjectErrors = Partial<Record<ProjectField, string>>;

/** Thứ tự trường để lấy "lỗi đầu tiên". */
export const PROJECT_FIELD_ORDER: readonly ProjectField[] = ['name', 'code', 'developer', 'location', 'propertyTypes', 'priceFrom', 'priceTo'];

/** Nhãn tiếng Việt của enum trạng thái bán hàng (04 §3.3: UPCOMING | SELLING | SOLD_OUT). */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  UPCOMING: 'Sắp mở bán',
  SELLING: 'Đang mở bán',
  SOLD_OUT: 'Hết hàng',
};

export const PROJECT_STATUS_OPTIONS = (Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((value) => ({ value, label: PROJECT_STATUS_LABELS[value] }));

export const PROJECT_PRICE_UNIT_LABELS: Record<ProjectPriceUnit, string> = {
  TOTAL: 'Giá cả căn / lô',
  PER_SQM: 'Giá mỗi m²',
};

export const PROJECT_PRICE_UNIT_OPTIONS = (Object.keys(PROJECT_PRICE_UNIT_LABELS) as ProjectPriceUnit[]).map((value) => ({ value, label: PROJECT_PRICE_UNIT_LABELS[value] }));

export const isProjectDeleted = (project: Pick<Project, 'deletedAt'>): boolean => Boolean(project.deletedAt);

/** Mục rỗng cho nút "Thêm dự án". */
export const createEmptyProject = (id: string): Project => ({
  id,
  code: '',
  name: '',
  fullName: '',
  developer: '',
  location: '',
  areaId: null,
  propertyTypes: [],
  priceFrom: null,
  priceTo: null,
  priceUnit: 'TOTAL',
  status: null,
  segment: '',
  isActive: true,
  deletedAt: null,
});

const toPriceOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
/** Chuỗi an toàn: dữ liệu sai kiểu (null/số) coi như rỗng — API trả 400 thay vì ném TypeError. */
const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Loại hình: bỏ phần tử rỗng/sai kiểu/trùng (không phân biệt hoa thường), giữ thứ tự. */
export const normalizePropertyTypes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const text = toText(item);
    const key = normalizeVietnamese(text);
    if (!text || seen.has(key)) return [];
    seen.add(key);
    return [text];
  });
};

/** Chuẩn hoá trước khi lưu: cắt khoảng trắng, mã viết hoa, tên đầy đủ mặc định = tên ngắn, giá không hợp lệ -> null. */
export const normalizeProject = (project: Project): Project => {
  const name = toText(project.name);
  return {
    ...project,
    name,
    code: toText(project.code).toUpperCase(),
    fullName: toText(project.fullName) || name,
    developer: toText(project.developer),
    location: toText(project.location),
    propertyTypes: normalizePropertyTypes(project.propertyTypes),
    priceFrom: toPriceOrNull(project.priceFrom),
    priceTo: toPriceOrNull(project.priceTo),
    segment: toText(project.segment),
    deletedAt: project.deletedAt ?? null,
  };
};

/** Mã đã có ở dự án KHÁC (so không phân biệt hoa thường, tính cả dự án ngừng/xoá mềm) — API trả 409 `PROJECT_CODE_DUPLICATED`. */
export const isProjectCodeTaken = (existing: readonly Project[], project: Pick<Project, 'id' | 'code'>): boolean => {
  const code = project.code.trim().toUpperCase();
  return Boolean(code) && existing.some((item) => item.id !== project.id && item.code.trim().toUpperCase() === code);
};

/**
 * Lỗi theo trường (rỗng = hợp lệ). Bắt buộc: tên + mã. Tên/mã không trùng dự án khác (tên so không dấu, không phân biệt hoa thường;
 * mã so không phân biệt hoa thường) — tính cả dự án đã ngừng hoạt động hoặc đã xoá mềm vì mã là duy nhất kể cả dự án đã xoá.
 * Giá: không âm; khi có cả hai thì "từ" <= "đến".
 */
export const getProjectErrors = (existing: readonly Project[], project: Project): ProjectErrors => {
  const errors: ProjectErrors = {};
  const name = project.name.trim();
  const code = project.code.trim().toUpperCase();
  const others = existing.filter((item) => item.id !== project.id);
  if (!name) errors.name = 'Vui lòng nhập tên dự án.';
  else if (name.length > PROJECT_NAME_MAX_LENGTH) errors.name = `Tên tối đa ${PROJECT_NAME_MAX_LENGTH} ký tự.`;
  else if (others.some((item) => normalizeVietnamese(item.name) === normalizeVietnamese(name))) errors.name = `Đã có dự án tên "${name}".`;
  if (!code) errors.code = 'Vui lòng nhập mã dự án.';
  else if (code.length > PROJECT_CODE_MAX_LENGTH) errors.code = `Mã tối đa ${PROJECT_CODE_MAX_LENGTH} ký tự.`;
  else if (!PROJECT_CODE_PATTERN.test(code)) errors.code = 'Mã chỉ gồm chữ không dấu, số, gạch ngang hoặc gạch dưới.';
  else if (isProjectCodeTaken(existing, project)) errors.code = `Mã dự án "${code}" đã tồn tại.`;
  (['developer', 'location'] as const).forEach((field) => {
    if (project[field].trim().length > PROJECT_FIELD_MAX_LENGTH) errors[field] = `Tối đa ${PROJECT_FIELD_MAX_LENGTH} ký tự.`;
  });
  if (project.propertyTypes.length > PROJECT_TYPES_MAX_COUNT) errors.propertyTypes = `Tối đa ${PROJECT_TYPES_MAX_COUNT} loại hình.`;
  else if (project.propertyTypes.some((type) => type.length > PROJECT_FIELD_MAX_LENGTH)) errors.propertyTypes = `Mỗi loại hình tối đa ${PROJECT_FIELD_MAX_LENGTH} ký tự.`;
  const { priceFrom, priceTo } = project;
  if (priceFrom !== null && !(priceFrom >= 0)) errors.priceFrom = 'Giá không được âm.';
  if (priceTo !== null && !(priceTo >= 0)) errors.priceTo = 'Giá không được âm.';
  if (!errors.priceFrom && !errors.priceTo && priceFrom !== null && priceTo !== null && priceFrom > priceTo) errors.priceTo = 'Giá "đến" phải lớn hơn hoặc bằng giá "từ".';
  return errors;
};

/** Lỗi đầu tiên (theo thứ tự trường) để hiện toast / trả API; null = hợp lệ. */
export const getFirstProjectError = (errors: ProjectErrors): string | null =>
  PROJECT_FIELD_ORDER.map((field) => errors[field]).find((message): message is string => Boolean(message)) ?? null;

/** Mã gợi ý từ tên ("Sky Park" -> "SKY_PARK"), không trùng `takenCodes` (so không phân biệt hoa thường), luôn hợp lệ theo mẫu. */
export const suggestProjectCode = (name: string, takenCodes: Iterable<string>): string => {
  const taken = new Set([...takenCodes].map((code) => code.trim().toUpperCase()));
  const base = toSlug(name).toUpperCase().slice(0, PROJECT_CODE_MAX_LENGTH).replace(/^[_-]+|[_-]+$/g, '') || 'DUAN';
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) {
    const tail = `-${suffix}`;
    candidate = `${base.slice(0, PROJECT_CODE_MAX_LENGTH - tail.length)}${tail}`;
  }
  return candidate;
};

// ---------------------------------------------------------------------------
// Nhãn + lựa chọn dự án dùng chung (queries, dashboard, việc hôm nay, xuất CSV, bộ lọc)
// ---------------------------------------------------------------------------

/** MỘT cách gọi tên dự án trong mọi response: tên ngắn; không còn trong danh mục -> "Dự án đã ngừng". */
export const toProjectLabel = (projects: CrmCatalogs['projects'], projectId: string): string =>
  projects.find((project) => project.id === projectId)?.name ?? UNKNOWN_PROJECT_LABEL;

export interface ProjectFilterOption {
  value: string;
  label: string;
  /** Chuỗi để lọc theo gõ chữ (tên ngắn + tên đầy đủ). */
  searchText: string;
}

/**
 * Lựa chọn cho ô lọc theo dự án: dự án đang hoạt động + dự án ĐÃ NGỪNG nhưng còn khách gắn (đánh dấu "ngừng") để vẫn lọc được;
 * dự án xoá mềm không xuất hiện.
 */
export const listProjectFilterOptions = (projects: CrmCatalogs['projects'], referencedProjectIds: ReadonlySet<string>): ProjectFilterOption[] =>
  projects
    .filter((project) => !project.deletedAt && (project.isActive || referencedProjectIds.has(project.id)))
    .map((project) => ({ value: project.id, label: project.isActive ? project.name : `${project.name} (ngừng)`, searchText: `${project.name} ${project.fullName}` }));

// ---------------------------------------------------------------------------
// Giá + trạng thái: hiển thị và chuyển dữ liệu cũ
// ---------------------------------------------------------------------------

/** "95 triệu – 130 triệu/m²", "từ 3,5 tỷ", "" khi chưa nhập. */
export const formatProjectPrice = (project: Pick<Project, 'priceFrom' | 'priceTo' | 'priceUnit'>): string => {
  const range = formatBudgetRange(project.priceFrom ?? 0, project.priceTo ?? 0);
  return range && project.priceUnit === 'PER_SQM' ? `${range}/m²` : range;
};

/** Số kèm đơn vị tuỳ chọn: "1.200" (hàng nghìn kiểu VN) | "3,5" | "95" + "tỷ|triệu|tr". */
const PRICE_TOKEN = /(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(tỷ|tỉ|ty|triệu|trieu|tr)?(?!\p{L})/giu;

const unitMultiplier = (unit: string): number => (/^t[ỷỉy]/i.test(unit) ? 1_000_000_000 : 1_000_000);

/**
 * Chuyển khoảng giá dạng chữ của dữ liệu cũ sang số VNĐ. Đơn vị tính THEO TỪNG SỐ ("800 triệu - 2 tỷ"); số không kèm đơn vị
 * mượn đơn vị của số liền sau ("95 - 130 triệu"). "1.200 triệu" = dấu chấm hàng nghìn kiểu VN. Không chắc (không đơn vị,
 * không có số, > 2 số) -> để trống thay vì đoán sai.
 */
export const parseLegacyPriceText = (text: unknown): { priceFrom: number | null; priceTo: number | null; priceUnit: ProjectPriceUnit } => {
  const empty = { priceFrom: null, priceTo: null, priceUnit: 'TOTAL' as const };
  if (typeof text !== 'string') return empty;
  const tokens = [...text.matchAll(PRICE_TOKEN)].map((match): { value: number; unit: string | null } => ({
    value: /^\d{1,3}(\.\d{3})+$/.test(match[1]) ? Number(match[1].replace(/\./g, '')) : Number(match[1].replace(',', '.')),
    unit: match[2] ?? null,
  }));
  if (tokens.length === 0 || tokens.length > 2) return empty;
  let carryUnit: string | null = null;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].unit) carryUnit = tokens[index].unit;
    else tokens[index].unit = carryUnit;
  }
  if (tokens.some((token) => !token.unit || !Number.isFinite(token.value))) return empty;
  const amounts = tokens.map((token) => Math.round(token.value * unitMultiplier(token.unit as string)));
  const priceUnit: ProjectPriceUnit = /\/\s*m/i.test(text) ? 'PER_SQM' : 'TOTAL';
  if (amounts.length === 2) return { priceFrom: Math.min(...amounts), priceTo: Math.max(...amounts), priceUnit };
  if (/(?:^|\s)(?:đến|dưới|tối đa)(?:\s|$)/iu.test(text)) return { priceFrom: null, priceTo: amounts[0], priceUnit };
  if (/(?:^|\s)(?:từ|trên|tối thiểu)(?:\s|$)/iu.test(text)) return { priceFrom: amounts[0], priceTo: null, priceUnit };
  return { priceFrom: amounts[0], priceTo: amounts[0], priceUnit };
};

/**
 * Trạng thái dạng chữ của dữ liệu cũ -> enum. Bắt PHỦ ĐỊNH trước ("chưa mở bán" = UPCOMING, "tạm ngừng/ngừng mở bán" = SOLD_OUT);
 * "sắp bàn giao / đang vận hành / đã nhận nhà / hết hàng" = SOLD_OUT; không nhận ra hoặc mơ hồ -> null.
 */
export const parseLegacyProjectStatus = (label: unknown): ProjectStatus | null => {
  if (typeof label !== 'string') return null;
  const text = normalizeVietnamese(label);
  if (!text) return null;
  if (text.includes('chua mo ban') || (text.startsWith('sap') && text.includes('mo ban'))) return 'UPCOMING';
  if (text.includes('ngung mo ban') || text.includes('ngung ban') || text.includes('tam ngung') || text.includes('het hang')) return 'SOLD_OUT';
  if (text.includes('mo ban')) return 'SELLING';
  if (text.includes('chua')) return null;
  if (text.includes('ban giao') || text.includes('nhan nha') || text.includes('van hanh')) return 'SOLD_OUT';
  return null;
};

// ---------------------------------------------------------------------------
// Nhật ký thay đổi dự án
// ---------------------------------------------------------------------------

const orDash = (value: string): string => (value.trim() ? value : '(trống)');

/** Các trường thay đổi giữa 2 phiên bản dự án (cho audit log); rỗng nếu không đổi. */
export const diffProject = (before: Project, after: Project, areas: CrmCatalogs['areas']): FieldChange[] => {
  const changes: FieldChange[] = [];
  const push = (field: string, from: string, to: string) => {
    if (from !== to) changes.push({ field, from, to });
  };
  const areaName = (areaId: string | null) => areas.find((area) => area.id === areaId)?.name ?? '(trống)';
  push('Tên dự án', orDash(before.name), orDash(after.name));
  push('Mã dự án', orDash(before.code), orDash(after.code));
  push('Tên đầy đủ', orDash(before.fullName), orDash(after.fullName));
  push('Chủ đầu tư', orDash(before.developer), orDash(after.developer));
  push('Vị trí', orDash(before.location), orDash(after.location));
  push('Khu vực', areaName(before.areaId), areaName(after.areaId));
  push('Loại hình', orDash(before.propertyTypes.join(', ')), orDash(after.propertyTypes.join(', ')));
  push('Khoảng giá', orDash(formatProjectPrice(before)), orDash(formatProjectPrice(after)));
  push('Trạng thái bán hàng', before.status ? PROJECT_STATUS_LABELS[before.status] : '(trống)', after.status ? PROJECT_STATUS_LABELS[after.status] : '(trống)');
  push('Phân khúc', orDash(before.segment), orDash(after.segment));
  push('Đang hoạt động', before.isActive ? 'Có' : 'Không', after.isActive ? 'Có' : 'Không');
  return changes;
};
