import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaFieldDefinition } from '@crm/types/crm';
import type { PersonaDraftValue } from '../personaForm';
import { PersonaFieldInput } from './PersonaFieldInput';

const draftValue = (patch: Partial<PersonaDraftValue> = {}): PersonaDraftValue => ({ text: '', date: '', options: [], isOn: false, from: 0, to: 0, ...patch });

const field = (patch: Partial<PersonaFieldDefinition>): PersonaFieldDefinition =>
  ({
    key: 'k',
    label: 'Loại hình',
    groupCode: 'REAL_ESTATE',
    type: 'SELECT',
    options: ['Căn hộ', 'Biệt thự'],
    isActive: true,
    ...patch,
  }) as PersonaFieldDefinition;

describe('PersonaFieldInput: lựa chọn đã tắt vẫn hiện cho khách đang dùng (FR-41)', () => {
  it('SELECT: giá trị hiện tại đã bị tắt vẫn có trong ô chọn và đang được chọn', () => {
    render(<PersonaFieldInput field={field({})} value={draftValue({ text: 'Loại cũ' })} idPrefix="t" onChange={vi.fn()} />);
    const select = screen.getByLabelText('Loại hình') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['', 'Căn hộ', 'Biệt thự', 'Loại cũ']);
    expect(select.value).toBe('Loại cũ');
  });

  it('SELECT: khách chưa chọn hoặc đang chọn lựa chọn còn dùng thì không xuất hiện lựa chọn thừa', () => {
    render(<PersonaFieldInput field={field({})} value={draftValue({ text: 'Căn hộ' })} idPrefix="t" onChange={vi.fn()} />);
    const select = screen.getByLabelText('Loại hình') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['', 'Căn hộ', 'Biệt thự']);
  });

  it('MULTI_SELECT: giá trị đã tắt hiện dạng chip đang chọn và bỏ chọn được', () => {
    const onChange = vi.fn();
    render(<PersonaFieldInput field={field({ type: 'MULTI_SELECT' })} value={draftValue({ options: ['Căn hộ', 'Loại cũ'] })} idPrefix="t" onChange={onChange} />);
    const oldChip = screen.getByRole('checkbox', { name: 'Loại cũ' });
    expect(oldChip).toBeChecked();
    fireEvent.click(oldChip);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ options: ['Căn hộ'] }));
  });

  it('MULTI_SELECT: lựa chọn đã tắt mà khách không dùng thì không hiện', () => {
    render(<PersonaFieldInput field={field({ type: 'MULTI_SELECT' })} value={draftValue({ options: ['Căn hộ'] })} idPrefix="t" onChange={vi.fn()} />);
    expect(screen.queryByRole('checkbox', { name: 'Loại cũ' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});
