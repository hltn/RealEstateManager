/**
 * Nhập khách từ CSV (X8): map cột -> kiểm từng dòng -> dữ liệu sẵn sàng gọi `importCustomers`.
 * Preset DSKH / DSKH_DROP / DSKH_NET là cột theo mẫu tạm (tài liệu 04 §9.3), cần đối chiếu file thật để chốt.
 * Hàm thuần (không đọc store) -> test trực tiếp.
 */
import type { CrmCatalogs, CrmUser, SystemStatusCode } from '@crm/types/crm';
import { normalizePhone } from './phone';
import { normalizeVietnamese } from './text';

/** Giới hạn nhập (chống file quá lớn làm treo trình duyệt / ghi đầy localStorage). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

/** Lỗi giới hạn file/số dòng; null = trong giới hạn. */
export const checkImportLimits = (byteSize: number, rowCount: number): string | null => {
  if (byteSize > MAX_IMPORT_BYTES) return `File quá lớn (${(byteSize / 1024 / 1024).toFixed(1)} MB). Tối đa ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`;
  if (rowCount > MAX_IMPORT_ROWS) return `File có ${rowCount} dòng. Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập — hãy chia nhỏ file.`;
  return null;
};

export type ImportTarget = 'fullName' | 'phone' | 'status' | 'source' | 'projects' | 'area' | 'primaryAssignee' | 'notes';

export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  fullName: 'Họ tên *',
  phone: 'Số điện thoại *',
  status: 'Tình trạng',
  source: 'Nguồn khách',
  projects: 'Dự án quan tâm (phân cách ; hoặc ,)',
  area: 'Khu vực',
  primaryAssignee: 'NV phụ trách chính',
  notes: 'Ghi chú',
};

export const IMPORT_TARGETS = Object.keys(IMPORT_TARGET_LABELS) as ImportTarget[];

/** target -> chỉ số cột trong file (-1 = không map). */
export type ImportMapping = Record<ImportTarget, number>;

export interface ImportPreset {
  code: 'DSKH' | 'DSKH_DROP' | 'DSKH_NET' | 'CUSTOM';
  name: string;
  /** Tình trạng mặc định khi file không có cột tình trạng (hoặc ô trống). */
  defaultStatusCode: SystemStatusCode;
  /** Tên cột có thể gặp (so không dấu). */
  aliases: Record<ImportTarget, string[]>;
  /** true = cột giả định, chưa đối chiếu file thật. */
  isAssumed: boolean;
}

const COMMON_ALIASES: Record<ImportTarget, string[]> = {
  fullName: ['ho ten', 'ho va ten', 'ten khach', 'ten khach hang', 'khach hang', 'name'],
  phone: ['sdt', 'so dien thoai', 'dien thoai', 'phone', 'so dt'],
  status: ['tinh trang', 'trang thai', 'status'],
  source: ['nguon', 'nguon khach', 'kenh'],
  projects: ['du an', 'du an quan tam', 'project'],
  area: ['khu vuc', 'noi o', 'dia chi'],
  primaryAssignee: ['nv cham soc', 'nhan vien cham soc', 'nhan vien', 'phu trach', 'nv phu trach', 'sale'],
  notes: ['ghi chu', 'note', 'notes'],
};

export const IMPORT_PRESETS: ImportPreset[] = [
  { code: 'DSKH', name: 'DSKH (danh sách chính)', defaultStatusCode: 'NOT_CONTACTED', aliases: COMMON_ALIASES, isAssumed: true },
  { code: 'DSKH_NET', name: 'DSKH_NET (khách net)', defaultStatusCode: 'NET', aliases: COMMON_ALIASES, isAssumed: true },
  { code: 'DSKH_DROP', name: 'DSKH_DROP (khách bỏ)', defaultStatusCode: 'DROPPED', aliases: COMMON_ALIASES, isAssumed: true },
  { code: 'CUSTOM', name: 'Tự map cột', defaultStatusCode: 'NOT_CONTACTED', aliases: COMMON_ALIASES, isAssumed: false },
];

/** Tự map cột theo tên tiêu đề (không dấu, không phân biệt hoa thường). */
export const autoMapColumns = (headers: readonly string[], preset: ImportPreset): ImportMapping => {
  const normalizedHeaders = headers.map((header) => normalizeVietnamese(header));
  return Object.fromEntries(
    IMPORT_TARGETS.map((target) => [target, normalizedHeaders.findIndex((header) => preset.aliases[target].includes(header))]),
  ) as ImportMapping;
};

export interface ImportRowData {
  fullName: string;
  phone: string;
  statusId: string;
  sourceId: string | null;
  interestedProjectIds: string[];
  areaId: string | null;
  primaryUserId: string | null;
  notes: string;
}

export interface ImportRowResult {
  /** Số dòng trong file (dòng tiêu đề = 1). */
  rowNumber: number;
  data: ImportRowData | null;
  errors: string[];
}

interface ValidationContext {
  catalogs: CrmCatalogs;
  users: readonly CrmUser[];
  /** SĐT (E.164) đã có trong hệ thống. */
  /** SĐT (đã chuẩn hoá E.164) đã có trong hệ thống? Do lớp dữ liệu trả lời (không đưa danh sách SĐT khách ra UI). */
  isPhoneTaken: (normalizedPhone: string) => boolean;
  preset: ImportPreset;
}

const matchesLabel = <T>(item: T, normalized: string, getLabels: (item: T) => string[]): boolean =>
  getLabels(item).some((label) => normalizeVietnamese(label) === normalized);

type Lookup<T> = { item: T } | { error: string };

/** Tìm mục theo nhãn: chỉ khớp mục ĐANG DÙNG; mục đã ẩn -> lỗi riêng; trùng nhiều mục -> lỗi mơ hồ. */
const lookupActive = <T extends { isActive: boolean }>(items: readonly T[], value: string, kindLabel: string, getLabels: (item: T) => string[]): Lookup<T> => {
  const normalized = normalizeVietnamese(value);
  const matches = items.filter((item) => matchesLabel(item, normalized, getLabels));
  const active = matches.filter((item) => item.isActive);
  if (active.length === 1) return { item: active[0] };
  if (active.length > 1) return { error: `${kindLabel} "${value}" trùng nhiều mục trong danh mục` };
  return { error: matches.length > 0 ? `${kindLabel} đã ngừng dùng: "${value}"` : `${kindLabel} chưa có trong danh mục: "${value}"` };
};

/**
 * Kiểm từng dòng: thiếu tên/SĐT, SĐT sai, SĐT trùng hệ thống, trùng trong file, giá trị danh mục chưa có
 * (tình trạng, nguồn, dự án, khu vực, nhân viên). Dòng có lỗi -> `data = null` (không nhập).
 */
export const validateImportRows = (rows: readonly (readonly string[])[], mapping: ImportMapping, context: ValidationContext): ImportRowResult[] => {
  const { catalogs, users, isPhoneTaken, preset } = context;
  const seenPhones = new Map<string, number>();
  const defaultStatus = catalogs.statuses.find((status) => status.code === preset.defaultStatusCode && status.isActive);
  const cell = (row: readonly string[], target: ImportTarget): string => (mapping[target] >= 0 ? (row[mapping[target]] ?? '').trim() : '');

  return rows.map((row, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const fullName = cell(row, 'fullName');
    const rawPhone = cell(row, 'phone');
    if (!fullName) errors.push('Thiếu họ tên');
    let phone = '';
    if (!rawPhone) errors.push('Thiếu số điện thoại');
    else {
      const normalized = normalizePhone(rawPhone);
      if (!normalized) errors.push(`SĐT không hợp lệ: "${rawPhone}"`);
      else {
        phone = normalized;
        if (isPhoneTaken(normalized)) errors.push('SĐT đã có trong hệ thống (trùng)');
        const firstRow = seenPhones.get(normalized);
        if (firstRow) errors.push(`SĐT trùng với dòng ${firstRow} trong file`);
        else seenPhones.set(normalized, rowNumber);
      }
    }

    const statusText = cell(row, 'status');
    let status = defaultStatus;
    if (statusText) {
      const found = lookupActive(catalogs.statuses, statusText, 'Tình trạng', (item) => [item.label, item.code]);
      if ('error' in found) errors.push(found.error);
      else status = found.item;
    }
    if (!status && !statusText) errors.push('Không xác định được tình trạng mặc định');

    const sourceText = cell(row, 'source');
    let source: { id: string } | undefined;
    if (sourceText) {
      const found = lookupActive(catalogs.leadSources, sourceText, 'Nguồn khách', (item) => [item.label]);
      if ('error' in found) errors.push(found.error);
      else source = found.item;
    }

    const areaText = cell(row, 'area');
    let area: { id: string } | undefined;
    if (areaText) {
      const found = lookupActive(catalogs.areas, areaText, 'Khu vực', (item) => [item.name]);
      if ('error' in found) errors.push(found.error);
      else area = found.item;
    }

    const projectNames = cell(row, 'projects').split(/[;,]/).map((name) => name.trim()).filter(Boolean);
    const projectIds = projectNames.flatMap((name) => {
      const found = lookupActive(catalogs.projects, name, 'Dự án', (item) => [item.name, item.fullName, item.code]);
      if ('error' in found) {
        errors.push(found.error);
        return [];
      }
      return [found.item.id];
    });

    const assigneeText = cell(row, 'primaryAssignee');
    let assignee: { id: string } | undefined;
    if (assigneeText) {
      const normalized = normalizeVietnamese(assigneeText);
      const matches = users.filter((user) => matchesLabel(user, normalized, (item) => [item.fullName, item.displayName]));
      const assignable = matches.filter((user) => user.isActive && user.role !== 'ADMIN');
      if (assignable.length === 1) assignee = assignable[0];
      else if (assignable.length > 1) errors.push(`Tên nhân viên "${assigneeText}" trùng nhiều người — dùng họ tên đầy đủ`);
      else errors.push(matches.length > 0 ? `Nhân viên không thể phân chăm sóc (đã khoá hoặc là Quản trị): "${assigneeText}"` : `Nhân viên chưa có trong hệ thống: "${assigneeText}"`);
    }

    return {
      rowNumber,
      errors,
      data:
        errors.length === 0 && status
          ? {
              fullName,
              phone,
              statusId: status.id,
              sourceId: source?.id ?? null,
              interestedProjectIds: projectIds,
              areaId: area?.id ?? null,
              primaryUserId: assignee?.id ?? null,
              notes: cell(row, 'notes'),
            }
          : null,
    };
  });
};
