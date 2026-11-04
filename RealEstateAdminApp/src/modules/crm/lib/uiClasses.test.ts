import { describe, expect, it } from 'vitest';
import { getInputClass, getSelectClass, NATIVE_CONTROL_RESET_CLASS, SELECT_WITH_ICON_CLASS, INPUT_ICON_PAD_CLASS } from './uiClasses';

/** Tách chuỗi lớp thành tập token để so khớp CHÍNH XÁC (tránh `pl-1` khớp nhầm `pl-10`). */
const tokens = (className: string) => new Set(className.split(/\s+/).filter(Boolean));

describe('getInputClass: ô nhập có icon trái (PT-026)', () => {
  it('có icon: dùng đúng 1 lớp padding trái dùng chung, không còn pl-4', () => {
    const result = tokens(getInputClass({ hasLeftIcon: true }));
    expect(result.has(INPUT_ICON_PAD_CLASS)).toBe(true);
    expect(result.has('pl-4')).toBe(false);
  });

  it('không icon: giữ pl-4 và không có padding icon', () => {
    const result = tokens(getInputClass());
    expect(result.has('pl-4')).toBe(true);
    expect(result.has(INPUT_ICON_PAD_CLASS)).toBe(false);
  });

  it('luôn reset kiểu gốc của trình duyệt (ô time/date của Safari iOS bỏ qua padding nếu không reset)', () => {
    for (const className of [getInputClass(), getInputClass({ hasLeftIcon: true, hasRightAddon: true })]) {
      const result = tokens(className);
      for (const token of tokens(NATIVE_CONTROL_RESET_CLASS)) expect(result.has(token)).toBe(true);
    }
    expect(NATIVE_CONTROL_RESET_CLASS).toContain('appearance-none');
    expect(NATIVE_CONTROL_RESET_CLASS).toContain('[-webkit-appearance:none]');
    expect(NATIVE_CONTROL_RESET_CLASS).toContain('[&::-webkit-date-and-time-value]:text-left');
  });

  it('chừa chỗ bên phải khi có addon (pr-10) và pr-4 khi không', () => {
    expect(tokens(getInputClass({ hasRightAddon: true })).has('pr-10')).toBe(true);
    expect(tokens(getInputClass()).has('pr-4')).toBe(true);
  });
});

describe('getSelectClass: select có icon trái (PT-026)', () => {
  it('có icon: padding icon + appearance none + chừa chỗ mũi tên tự vẽ bên phải', () => {
    const result = tokens(getSelectClass({ hasLeftIcon: true }));
    expect(result.has(INPUT_ICON_PAD_CLASS)).toBe(true);
    expect(result.has('pl-4')).toBe(false);
    for (const token of tokens(SELECT_WITH_ICON_CLASS)) expect(result.has(token)).toBe(true);
    expect(result.has('appearance-none')).toBe(true);
    expect(result.has('pr-10')).toBe(true);
    expect(result.has('pr-4')).toBe(false);
  });

  it('không icon: giữ mũi tên gốc của trình duyệt (không appearance-none), pl-4/pr-4', () => {
    const result = tokens(getSelectClass());
    expect(result.has('appearance-none')).toBe(false);
    expect(result.has('pl-4')).toBe(true);
    expect(result.has('pr-4')).toBe(true);
  });

  it('báo lỗi: viền đỏ ở cả hai biến thể', () => {
    expect(getSelectClass({ hasError: true, hasLeftIcon: true })).toContain('border-error-500');
    expect(getInputClass({ hasError: true })).toContain('border-error-500');
  });
});
