import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerDetail, CustomerPersonaView, PersonaFieldValueView } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { PersonaCard } from './PersonaCards';

const personaState: { current: CustomerPersonaView | undefined } = { current: undefined };

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCustomerPersona: () => ({ data: personaState.current }),
    usePersonaFieldMap: () => new Map(),
  };
});

const field = (fieldKey: string, label: string, valueText?: string): PersonaFieldValueView => ({
  fieldKey,
  label,
  groupCode: 'PERSONAL',
  type: 'TEXT',
  value: valueText ? ({ fieldKey, valueText, source: 'STAFF_OBSERVED' } as PersonaFieldValueView['value']) : null,
  source: valueText ? 'STAFF_OBSERVED' : null,
  updatedAt: valueText ? '2026-10-20T03:00:00.000Z' : null,
  updatedBy: null,
});

const persona = (groups: CustomerPersonaView['groups']): CustomerPersonaView => ({ groups, completeness: 30, missingSuggestions: [], values: [], version: 1 });

const renderCard = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <PersonaCard customer={{ id: 'c1' } as CustomerDetail} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

describe('PersonaCard (PT-018): Chân dung khách hàng ẩn dữ liệu trống ở chế độ xem', () => {
  it('nhóm có dữ liệu: chỉ hiện trường đã có giá trị; trường trống bị ẩn', () => {
    personaState.current = persona([{ code: 'PERSONAL', label: 'Cá nhân', fields: [field('salutation', 'Xưng hô', 'Anh Nam'), field('hobby', 'Sở thích')] }]);
    renderCard();
    expect(screen.getByText('Cá nhân')).toBeInTheDocument();
    expect(screen.getByText('Xưng hô')).toBeInTheDocument();
    expect(screen.getByText('Anh Nam')).toBeInTheDocument();
    expect(screen.queryByText('Sở thích')).toBeNull();
  });

  it('giá trị "hợp lệ nhưng falsy" (Có/Không = false) KHÔNG bị coi là trống: vẫn hiện "Không"', () => {
    const noLoan: PersonaFieldValueView = {
      ...field('loan', 'Có vay ngân hàng'),
      type: 'BOOLEAN',
      value: { fieldKey: 'loan', valueBoolean: false, source: 'STAFF_OBSERVED' } as PersonaFieldValueView['value'],
      source: 'STAFF_OBSERVED',
    };
    personaState.current = persona([{ code: 'PERSONAL', label: 'Cá nhân', fields: [noLoan, field('hobby', 'Sở thích')] }]);
    renderCard();
    expect(screen.getByText('Có vay ngân hàng')).toBeInTheDocument();
    expect(screen.getByText('Không')).toBeInTheDocument();
    expect(screen.queryByText('Sở thích')).toBeNull();
  });

  it('nhóm KHÔNG có trường nào có dữ liệu: ẩn cả nhóm, không còn dòng "Chưa có thông tin."', () => {
    personaState.current = persona([
      { code: 'PERSONAL', label: 'Cá nhân', fields: [field('salutation', 'Xưng hô', 'Anh Nam')] },
      { code: 'OCCUPATION', label: 'Nghề nghiệp', fields: [field('job', 'Công việc')] },
    ]);
    renderCard();
    expect(screen.queryByText('Nghề nghiệp')).toBeNull();
    expect(screen.queryByText('Công việc')).toBeNull();
    expect(screen.queryByText(/Chưa có thông tin/)).toBeNull();
  });

  it('nhóm Nhu cầu BĐS không nằm trong thẻ này (có thẻ riêng)', () => {
    personaState.current = persona([{ code: 'REAL_ESTATE', label: 'Nhu cầu BĐS', fields: [field('budget', 'Ngân sách', '3 tỷ')] }]);
    renderCard();
    expect(screen.queryByText('Ngân sách')).toBeNull();
  });

  it('vẫn giữ độ đầy đủ chân dung và nút "Sửa chân dung khách hàng"', () => {
    personaState.current = persona([]);
    renderCard();
    expect(screen.getByRole('progressbar', { name: 'Độ đầy đủ chân dung' })).toHaveAttribute('aria-valuenow', '30');
    expect(screen.getByRole('button', { name: 'Sửa chân dung khách hàng' })).toBeInTheDocument();
  });
});
