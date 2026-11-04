import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { ProjectField } from './ProjectField';

const project = (id: string, name: string) => ({ id, name, isActive: true, deletedAt: null });
const PROJECTS = [project('a', 'Alpha'), project('b', 'Beta'), project('c', "Q'Terra Thảo Điền"), project('d', 'Gamma')];

const makeForm = (overrides: Partial<CreateAppointmentForm> & { type?: string; projectId?: string } = {}): CreateAppointmentForm => {
  const { type = 'SITE_VISIT', projectId = '', ...rest } = overrides;
  return {
    values: { projectId, type },
    errors: {},
    selectedCustomer: null,
    selectableProjects: PROJECTS,
    setField: vi.fn(),
    ...rest,
  } as unknown as CreateAppointmentForm;
};

type HarnessProps = Partial<CreateAppointmentForm> & { initial?: string; onSetField?: (name: string, value: string) => void };

/** Giữ giá trị chọn như form thật: setField('projectId') cập nhật lại prop. */
const Harness = ({ initial = '', onSetField = vi.fn(), ...overrides }: HarnessProps) => {
  const [projectId, setProjectId] = useState(initial);
  const form = makeForm({
    ...overrides,
    projectId,
    setField: ((name: string, value: string) => {
      onSetField(name, value);
      setProjectId(value);
    }) as never,
  });
  return <ProjectField form={form} />;
};

const getInput = () => screen.getByRole('combobox', { name: /Dự án/ });
const optionLabels = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('ô "Dự án" của form tạo lịch hẹn (G7): ô chọn có tìm kiếm', () => {
  it('mở danh sách: "Không chọn" đứng đầu, rồi dự án khách quan tâm, rồi các dự án còn lại (giữ thứ tự gốc trong từng nhóm)', async () => {
    const user = userEvent.setup();
    const selectedCustomer = { projects: [{ id: 'd', label: 'Gamma' }, { id: 'a', label: 'Alpha' }] } as never;
    render(<Harness selectedCustomer={selectedCustomer} />);
    await user.click(getInput());
    expect(screen.getByRole('listbox', { name: 'Danh sách dự án' })).toBeVisible();
    expect(optionLabels()).toEqual(['Không chọn', 'Alpha', 'Gamma', 'Beta', "Q'Terra Thảo Điền"]);
  });

  it('khách chưa quan tâm dự án nào: giữ thứ tự gốc', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getInput());
    expect(optionLabels()).toEqual(['Không chọn', 'Alpha', 'Beta', "Q'Terra Thảo Điền", 'Gamma']);
  });

  it('gõ không dấu, không phân biệt hoa thường: "thao dien" khớp "Q\'Terra Thảo Điền"; không khớp thì báo không tìm thấy', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(getInput(), 'THAO dien');
    expect(optionLabels()).toEqual(["Q'Terra Thảo Điền"]);
    await user.clear(getInput());
    await user.type(getInput(), 'xyz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Không tìm thấy kết quả phù hợp.')).toBeVisible();
  });

  it('chọn bằng chuột: gọi setField("projectId", id), ô hiện tên dự án, danh sách đóng', async () => {
    const user = userEvent.setup();
    const onSetField = vi.fn();
    render(<Harness onSetField={onSetField} />);
    await user.click(getInput());
    await user.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onSetField).toHaveBeenCalledWith('projectId', 'b');
    expect(getInput()).toHaveValue('Beta');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('bàn phím: mũi tên xuống + Enter chọn dự án và KHÔNG gửi form', async () => {
    const user = userEvent.setup();
    const onSetField = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness onSetField={onSetField} />
      </form>,
    );
    await user.click(getInput());
    // Dòng 0 = "Không chọn"; xuống 2 lần -> Beta.
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(getInput()).toHaveAttribute('aria-activedescendant', 'appointment-projectId-option-2');
    await user.keyboard('{Enter}');
    expect(onSetField).toHaveBeenCalledWith('projectId', 'b');
    expect(getInput()).toHaveValue('Beta');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('gõ lọc rồi Enter chọn kết quả đầu; Escape đóng và giữ lựa chọn cũ', async () => {
    const user = userEvent.setup();
    const onSetField = vi.fn();
    render(<Harness onSetField={onSetField} initial="a" />);
    await user.click(getInput());
    await user.keyboard('gam{Enter}');
    expect(onSetField).toHaveBeenCalledWith('projectId', 'd');
    await user.click(getInput());
    await user.keyboard('be{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(getInput()).toHaveValue('Gamma');
    expect(onSetField).toHaveBeenCalledTimes(1);
  });

  it('"Không chọn": bỏ dự án đang chọn (setField "") và ô hiện gợi ý "Không chọn"', async () => {
    const user = userEvent.setup();
    const onSetField = vi.fn();
    render(<Harness onSetField={onSetField} initial="a" />);
    expect(getInput()).toHaveValue('Alpha');
    await user.click(getInput());
    await user.click(screen.getByRole('option', { name: 'Không chọn' }));
    expect(onSetField).toHaveBeenCalledWith('projectId', '');
    expect(getInput()).toHaveValue('');
    expect(getInput()).toHaveAttribute('placeholder', 'Không chọn');
  });

  it('"Không chọn" cũng chọn được bằng bàn phím (mũi tên lên tới dòng đầu rồi Enter)', async () => {
    const user = userEvent.setup();
    const onSetField = vi.fn();
    render(<Harness onSetField={onSetField} initial="b" />);
    await user.click(getInput());
    await user.keyboard('{ArrowUp}{ArrowUp}{Enter}');
    expect(onSetField).toHaveBeenCalledWith('projectId', '');
  });

  it('a11y: combobox gắn với listbox, dự án đang chọn có aria-selected', async () => {
    const user = userEvent.setup();
    render(<Harness initial="b" />);
    const input = getInput();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
  });

  it('Xem nhà mẫu / Ký cọc: nhãn "Nên chọn"; Gặp tư vấn / Nhắc gọi lại: vẫn hiện ô nhưng không nhấn mạnh', () => {
    const { rerender } = render(<ProjectField form={makeForm({ type: 'DEPOSIT_CONTRACT' })} />);
    expect(screen.getByText('Nên chọn')).toBeVisible();
    rerender(<ProjectField form={makeForm({ type: 'CALLBACK' })} />);
    expect(screen.queryByText('Nên chọn')).toBeNull();
    expect(getInput()).toBeEnabled();
  });

  it('lỗi từ máy chủ hiện ngay cạnh ô dự án và gắn vào ô qua aria-describedby', () => {
    const form = makeForm({ errors: { projectId: 'Dự án không tồn tại hoặc đã ngừng hoạt động' } });
    render(<ProjectField form={form} />);
    expect(getInput()).toHaveAccessibleDescription('Dự án không tồn tại hoặc đã ngừng hoạt động');
    expect(getInput()).toBeInvalid();
  });
});

describe('ô "Dự án": icon trái không đè chữ (PT-026), chữ 16px trên điện thoại', () => {
  it('ô nhập chừa padding trái cho icon, có mũi tên tự vẽ không bắt chuột, chữ text-base md:text-sm', () => {
    const { container } = render(<ProjectField form={makeForm()} />);
    const classes = getInput().className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['pl-11', 'pr-10', 'text-base', 'md:text-sm']));
    expect(classes).not.toContain('pl-4');
    expect(classes).not.toContain('text-sm');
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('svg.pointer-events-none.right-3')).not.toBeNull();
  });
});
