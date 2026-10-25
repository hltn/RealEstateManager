import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { ProjectField } from './ProjectField';

const project = (id: string, name: string) => ({ id, name, isActive: true, deletedAt: null });
const PROJECTS = [project('a', 'Alpha'), project('b', 'Beta'), project('c', 'Gamma')];

const makeForm = (overrides: Partial<CreateAppointmentForm> & { type?: string } = {}): CreateAppointmentForm => {
  const { type = 'SITE_VISIT', ...rest } = overrides;
  return {
    values: { projectId: '', type },
    errors: {},
    selectedCustomer: null,
    selectableProjects: PROJECTS,
    setField: vi.fn(),
    ...rest,
  } as unknown as CreateAppointmentForm;
};

describe('ô "Dự án" của form tạo lịch hẹn (G7)', () => {
  it('có "Không chọn"; khách quan tâm nhiều dự án: nhóm "Khách quan tâm" đứng trước nhóm "Dự án khác"', () => {
    const form = makeForm({ selectedCustomer: { projects: [{ id: 'c', label: 'Gamma' }, { id: 'a', label: 'Alpha' }] } as never });
    render(<ProjectField form={form} />);
    const select = screen.getByRole('combobox', { name: /Dự án/ });
    expect(within(select).getByRole('option', { name: 'Không chọn' })).toBeInTheDocument();
    const groups = within(select).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('label'))).toEqual(['Khách quan tâm', 'Dự án khác']);
    expect(within(groups[0]).getAllByRole('option').map((option) => option.textContent)).toEqual(['Alpha', 'Gamma']);
    expect(within(groups[1]).getAllByRole('option').map((option) => option.textContent)).toEqual(['Beta']);
  });

  it('khách chưa quan tâm dự án nào: danh sách phẳng, không có nhóm', () => {
    render(<ProjectField form={makeForm()} />);
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Không chọn', 'Alpha', 'Beta', 'Gamma']);
  });

  it('Xem nhà mẫu / Ký cọc: nhãn "Nên chọn"; Gặp tư vấn / Nhắc gọi lại: vẫn hiện ô nhưng không nhấn mạnh', () => {
    const { rerender } = render(<ProjectField form={makeForm({ type: 'DEPOSIT_CONTRACT' })} />);
    expect(screen.getByText('Nên chọn')).toBeVisible();
    rerender(<ProjectField form={makeForm({ type: 'CALLBACK' })} />);
    expect(screen.queryByText('Nên chọn')).toBeNull();
    expect(screen.getByRole('combobox', { name: /Dự án/ })).toBeEnabled();
  });

  it('lỗi từ máy chủ hiện ngay cạnh ô dự án và gắn vào ô qua aria-describedby', () => {
    const form = makeForm({ errors: { projectId: 'Dự án không tồn tại hoặc đã ngừng hoạt động' } });
    render(<ProjectField form={form} />);
    const select = screen.getByRole('combobox', { name: /Dự án/ });
    expect(select).toHaveAccessibleDescription('Dự án không tồn tại hoặc đã ngừng hoạt động');
    expect(select).toBeInvalid();
  });
});
