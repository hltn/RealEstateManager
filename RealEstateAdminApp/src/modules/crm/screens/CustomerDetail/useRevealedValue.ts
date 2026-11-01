import { useCallback, useState } from 'react';

/**
 * Giá trị nhạy cảm đã "hiện" (SĐT/CCCD đầy đủ) GẮN VỚI 1 KHÁCH: khi đổi sang khách khác (cùng component, `customerId` đổi)
 * giá trị của khách cũ tự mất hiệu lực — không bao giờ hiển thị số của khách A trên hồ sơ khách B.
 */
export const useRevealedValue = (customerId: string) => {
  const [state, setState] = useState<{ customerId: string; value: string } | null>(null);
  const value = state?.customerId === customerId ? state.value : null;
  const setValue = useCallback((next: string | null) => setState(next === null ? null : { customerId, value: next }), [customerId]);
  return [value, setValue] as const;
};
