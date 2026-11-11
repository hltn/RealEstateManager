/**
 * Mã khách `KH-######` (v1.0.5, FR-04): tối thiểu 6 chữ số, quá 999.999 thì dài ra (`KH-1000000`). Dùng cho dữ liệu mẫu (mock) và
 * hiển thị; mã thật do backend cấp, FE không tự sinh cho dữ liệu thật.
 */
const CODE_PREFIX = 'KH-';
const MIN_DIGITS = 6;
const CODE_PATTERN = /^KH-(\d{6,})$/;

/** 1 -> "KH-000001"; 1_000_000 -> "KH-1000000". */
export const formatCustomerCode = (sequence: number): string => `${CODE_PREFIX}${String(Math.max(0, Math.trunc(sequence))).padStart(MIN_DIGITS, '0')}`;

/** "KH-000012" -> 12; sai định dạng -> null. */
export const parseCustomerCodeSequence = (code: string | null | undefined): number | null => {
  const match = code ? CODE_PATTERN.exec(code) : null;
  return match ? Number(match[1]) : null;
};

/** Mã kế tiếp trong tập khách hiện có (mock): lớn nhất + 1. */
export const getNextCustomerCode = (customers: readonly { customerCode: string | null }[]): string =>
  formatCustomerCode(customers.reduce((max, customer) => Math.max(max, parseCustomerCodeSequence(customer.customerCode) ?? 0), 0) + 1);
