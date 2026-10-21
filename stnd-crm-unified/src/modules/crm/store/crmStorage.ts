import type { CrmDataState } from './crmReducer';

/**
 * Khoá localStorage riêng cho app hợp nhất (có version) - KHÔNG dùng lại
 * 'stnd_customers' / 'stnd_appointments' của bản Mobile vì khác cấu trúc dữ liệu.
 */
export const CRM_STORAGE_KEY = 'stnd_crm_unified_v2';

const isBrowserStorageAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};

const isCrmDataState = (value: unknown): value is CrmDataState => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.customers) &&
    Array.isArray(candidate.careLogs) &&
    Array.isArray(candidate.appointments) &&
    Array.isArray(candidate.tasks)
  );
};

/** Đọc dữ liệu đã lưu; trả null nếu chưa có, JSON hỏng hoặc sai cấu trúc. */
export const loadCrmData = (): CrmDataState | null => {
  if (!isBrowserStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(CRM_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCrmDataState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const saveCrmData = (data: CrmDataState): void => {
  if (!isBrowserStorageAvailable()) return;
  try {
    window.localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Bỏ qua lỗi quota / private mode: dữ liệu vẫn còn trong bộ nhớ phiên hiện tại.
  }
};

export const clearCrmData = (): void => {
  if (!isBrowserStorageAvailable()) return;
  try {
    window.localStorage.removeItem(CRM_STORAGE_KEY);
  } catch {
    // Bỏ qua.
  }
};
