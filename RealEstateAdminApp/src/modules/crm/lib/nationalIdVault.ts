/**
 * MÔ PHỎNG kho CCCD đầy đủ (C9) — KHÔNG phải bảo mật thật.
 *
 * CHỈ MÔ PHỎNG CHO PROTOTYPE: CẤM nhập hoặc lưu CCCD/dữ liệu cá nhân THẬT vào đây (che nhẹ bằng XOR, không phải mã hoá).
 *
 * - Hồ sơ khách (state + localStorage chính) chỉ giữ `nationalIdLast4` + `hasNationalId`.
 * - Bản đầy đủ giữ trong bộ nhớ (Map) và một bản che nhẹ (XOR + base64) ở khoá localStorage riêng để demo xem lại
 *   sau khi tải lại trang. Đây chỉ là che mắt cho prototype; khi có backend, CCCD được mã hoá AES-256-GCM phía máy chủ
 *   (`select: false`) và chỉ trả qua `POST /crm/customers/:id/national-id-views` (có ghi log, `Cache-Control: no-store`).
 */

const VAULT_STORAGE_KEY = 'stnd_crm_pii_sim_v1';
/** Khoá che nhẹ cố định — KHÔNG dùng cho dữ liệu thật. */
const OBFUSCATION_KEY = 'stnd-prototype-only';

const memoryVault = new Map<string, string>();
let isHydrated = false;

const canUseStorage = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};

const xorText = (value: string): string =>
  Array.from(value, (char, index) => String.fromCharCode(char.charCodeAt(0) ^ OBFUSCATION_KEY.charCodeAt(index % OBFUSCATION_KEY.length))).join('');

const obfuscate = (value: string): string => btoa(xorText(value));
const deobfuscate = (value: string): string => xorText(atob(value));

const hydrate = (): void => {
  if (isHydrated) return;
  isHydrated = true;
  if (!canUseStorage()) return;
  try {
    const raw = window.localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Record<string, string>;
    Object.entries(entries).forEach(([customerId, masked]) => memoryVault.set(customerId, deobfuscate(masked)));
  } catch {
    // Dữ liệu hỏng -> bỏ qua (chỉ mất khả năng "Hiện" CCCD đầy đủ của bản demo).
  }
};

const persist = (): void => {
  if (!canUseStorage()) return;
  try {
    const entries = Object.fromEntries([...memoryVault.entries()].map(([customerId, value]) => [customerId, obfuscate(value)]));
    window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Bỏ qua lỗi quota/private mode.
  }
};

/** Chuẩn hoá: bỏ khoảng trắng. */
const compact = (nationalId: string): string => nationalId.replace(/\s/g, '');

/** 4 số cuối của CCCD (hàm thuần, không đụng kho) — dùng để cập nhật hồ sơ TRƯỚC khi ghi kho. */
export const getNationalIdLast4 = (nationalId: string): string | null => {
  const value = compact(nationalId);
  return value ? value.slice(-4) : null;
};

/** Lưu (hoặc xoá khi rỗng) CCCD đầy đủ; trả về 4 số cuối để lưu vào hồ sơ. */
export const storeNationalId = (customerId: string, nationalId: string): string | null => {
  hydrate();
  const value = compact(nationalId);
  if (!value) {
    memoryVault.delete(customerId);
    persist();
    return null;
  }
  memoryVault.set(customerId, value);
  persist();
  return value.slice(-4);
};

/** Đọc CCCD đầy đủ (chỉ gọi sau khi đã kiểm quyền + ghi log xem). null nếu không có trong kho mô phỏng. */
export const revealNationalId = (customerId: string): string | null => {
  hydrate();
  return memoryVault.get(customerId) ?? null;
};

/** Nạp CCCD của dữ liệu mẫu (chỉ khi kho chưa có giá trị cho khách đó). */
export const seedNationalIds = (entries: Record<string, string>): void => {
  hydrate();
  let hasChanged = false;
  Object.entries(entries).forEach(([customerId, value]) => {
    if (!memoryVault.has(customerId)) {
      memoryVault.set(customerId, compact(value));
      hasChanged = true;
    }
  });
  if (hasChanged) persist();
};

/** Dọn kho theo tập id khách còn sống (khi khách hỏng bị loại khỏi CSDL, không để lại CCCD mồ côi). */
export const pruneNationalIds = (aliveCustomerIds: ReadonlySet<string>): void => {
  hydrate();
  let hasChanged = false;
  [...memoryVault.keys()].forEach((customerId) => {
    if (!aliveCustomerIds.has(customerId)) {
      memoryVault.delete(customerId);
      hasChanged = true;
    }
  });
  if (hasChanged) persist();
};

/** Dùng trong test. */
export const resetNationalIdVaultForTest = (): void => {
  memoryVault.clear();
  isHydrated = true;
};
