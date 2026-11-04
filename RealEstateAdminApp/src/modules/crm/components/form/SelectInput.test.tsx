import { render, screen } from '@testing-library/react';
import { Building2 } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { SelectInput } from './SelectInput';

const options = [{ value: 'a', label: 'Dự án A' }];

describe('SelectInput: mũi tên tự vẽ chỉ khi select đã bỏ giao diện gốc (PT-026)', () => {
  it('có icon trái: appearance-none + có mũi tên tự vẽ không bắt chuột (chạm vẫn mở danh sách)', () => {
    const { container } = render(<SelectInput aria-label="Dự án" icon={Building2} options={options} />);
    const select = screen.getByRole('combobox', { name: 'Dự án' });
    expect(select.className.split(/\s+/)).toEqual(expect.arrayContaining(['pl-11', 'pr-10', 'appearance-none']));
    const chevron = container.querySelector('svg.pointer-events-none.right-3');
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
  });

  it('không icon: giữ mũi tên gốc của trình duyệt, KHÔNG vẽ thêm mũi tên thứ hai', () => {
    const { container } = render(<SelectInput aria-label="Dự án" options={options} />);
    const select = screen.getByRole('combobox', { name: 'Dự án' });
    expect(select.className.split(/\s+/)).not.toContain('appearance-none');
    expect(select.className.split(/\s+/)).toContain('pl-4');
    expect(container.querySelector('svg.right-3')).toBeNull();
  });
});
