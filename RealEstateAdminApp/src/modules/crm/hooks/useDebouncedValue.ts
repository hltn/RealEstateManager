import { useDebouncedValue as useBaseDebouncedValue } from '../../../hooks/useDebouncedValue';

/** Độ trễ mặc định của ô tìm kiếm CRM (ms). Ngoài CRM dùng 400ms của hook gốc. */
export const CRM_DEBOUNCE_MS = 250;

/**
 * Wrapper mỏng của hook gốc `src/hooks/useDebouncedValue`: chỉ đổi độ trễ mặc định sang 250ms cho CRM.
 * Logic debounce nằm ở một nơi duy nhất (hook gốc); ai truyền `delayMs` thì vẫn được tôn trọng.
 */
export const useDebouncedValue = <T,>(value: T, delayMs: number = CRM_DEBOUNCE_MS): T =>
  useBaseDebouncedValue(value, delayMs);
