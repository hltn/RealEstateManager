/** PersonaFormBody: ô SĐT tùy chọn (FR-02) — không dấu *, khách chưa có SĐT thì ô mở sẵn và không có nút "Sửa số". */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import type { CrmCatalogs } from '@crm/types/crm';
import { PersonaFormBody } from './PersonaFormBody';
import type { PersonaFormApi } from './usePersonaForm';

const catalogs: CrmCatalogs = { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] };

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...actual, useCatalogs: () => ({ catalogs }) };
});

const makeForm = (overrides: Partial<PersonaFormApi>) =>
  ({
    basic: { fullName: 'An', phone: '', email: '', nationalId: '', areaId: '', sourceId: '', interestedProjectIds: [], tagIds: [] },
    basicErrors: {},
    fields: [],
    personaErrors: {},
    hasPhone: true,
    isPhoneLocked: false,
    phoneMasked: '',
    hasNationalId: false,
    source: 'STAFF_OBSERVED',
    setSource: vi.fn(),
    setBasicField: vi.fn(),
    toggleTag: vi.fn(),
    toggleProject: vi.fn(),
    addNewTag: vi.fn(),
    revealPhone: vi.fn(),
    ...overrides,
  }) as unknown as PersonaFormApi;

const renderBody = (form: PersonaFormApi) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: 'admin' }, shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <PersonaFormBody form={form} variant="desktop" hasBasicInfo />
      </CrmProvider>
    </MemoryRouter>,
  );
};

describe('ô SĐT ở form sửa hồ sơ', () => {
  it('chỉ họ tên bắt buộc: mô tả khối + nhãn SĐT không có dấu *', () => {
    renderBody(makeForm({}));
    expect(screen.getByText('Chỉ họ tên là bắt buộc')).toBeInTheDocument();
    expect(screen.getByText('Số điện thoại').parentElement?.textContent).not.toContain('*');
    expect(screen.getByText('Họ và tên').parentElement?.textContent).toContain('*');
  });

  it('khách chưa có SĐT: ô mở sẵn (không readonly), có gợi ý, KHÔNG có nút "Sửa số"', () => {
    renderBody(makeForm({ hasPhone: false, isPhoneLocked: false }));
    expect(screen.getByLabelText(/Số điện thoại/)).not.toHaveAttribute('readonly');
    expect(screen.getByText(/Khách chưa có số điện thoại/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa số' })).not.toBeInTheDocument();
  });

  it('khách có SĐT, đang khóa: ô chỉ đọc hiện số che + nút "Sửa số"', () => {
    renderBody(makeForm({ hasPhone: true, isPhoneLocked: true, phoneMasked: '0912 ••• 678' }));
    expect(screen.getByLabelText(/Số điện thoại/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/Số điện thoại/)).toHaveValue('0912 ••• 678');
    expect(screen.getByRole('button', { name: 'Sửa số' })).toBeInTheDocument();
  });

  it('khách có SĐT, đã mở khóa: gợi ý "để trống ô này nếu muốn xóa số"', () => {
    renderBody(makeForm({ hasPhone: true, isPhoneLocked: false }));
    expect(screen.getByText(/Để trống ô này nếu muốn xóa số điện thoại/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa số' })).not.toBeInTheDocument();
  });
});
