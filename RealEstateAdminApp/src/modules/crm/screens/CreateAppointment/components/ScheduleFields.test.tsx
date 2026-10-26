import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { ScheduleFields } from './AppointmentFormFields';

const PROJECT = { id: 'pa', name: "Q'Terra", fullName: "Q'Terra", location: 'Hưng Yên', isActive: true, deletedAt: null };

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCatalogs: () => ({ catalogs: { projects: [PROJECT] } }) };
});

const makeForm = (projectId: string, setField = vi.fn()): CreateAppointmentForm =>
  ({
    values: { date: '2026-10-26', time: '09:00', type: 'SITE_VISIT', location: '', projectId },
    errors: {},
    selectedCustomer: { projects: [{ id: 'pa', label: "Q'Terra" }] },
    selectableProjects: [PROJECT],
    setField,
  }) as unknown as CreateAppointmentForm;

describe('ô Địa điểm: nút định vị chỉ dùng dự án ĐÃ CHỌN cho lịch (G7)', () => {
  it('đã chọn dự án (kể cả chọn sẵn theo gợi ý): nút dùng được và điền văn phòng của dự án đó', () => {
    const setField = vi.fn();
    render(<ScheduleFields form={makeForm('pa', setField)} />);
    const button = screen.getByRole('button', { name: /Dùng địa chỉ văn phòng/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(setField).toHaveBeenCalledWith('location', expect.stringContaining("Q'Terra"));
  });

  it('chưa chọn dự án (dù khách có dự án quan tâm): nút vô hiệu, không rơi về dự án khách quan tâm', () => {
    render(<ScheduleFields form={makeForm('')} />);
    expect(screen.getByRole('button', { name: /Dùng địa chỉ văn phòng/ })).toBeDisabled();
  });
});

describe('nhãn truy cập của ô ngày (U-A11Y-01)', () => {
  it('nhãn "Ngày diễn ra" gắn vào ô nhập ngày', () => {
    render(<ScheduleFields form={makeForm('')} />);
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue('2026-10-26');
  });
});
