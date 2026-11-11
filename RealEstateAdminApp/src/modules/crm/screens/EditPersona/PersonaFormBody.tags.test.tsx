import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import type { CrmCatalogs } from '@crm/types/crm';
import { PersonaFormBody } from './PersonaFormBody';
import type { PersonaFormApi } from './usePersonaForm';

const catalogs: CrmCatalogs = {
  statuses: [],
  leadSources: [],
  areas: [],
  projects: [],
  tags: [
    { id: 't-golf', name: 'Golf', category: 'INTEREST', isActive: true },
    { id: 't-vip', name: 'Khách VIP', category: 'OTHER', isActive: true },
    { id: 't-old', name: 'Thẻ đã tắt', category: 'OTHER', isActive: false },
    // Nhóm máy chủ thêm mà FE chưa biết: phải còn ở form (xếp vào "Thẻ khác"), khớp `groupTagsByCategory`.
    { id: 't-future', name: 'Thẻ nhóm lạ', category: 'FUTURE_GROUP' as never, isActive: true },
  ],
  contactResults: [],
};

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...actual, useCatalogs: () => ({ catalogs, users: [] }) };
});

/** Form giả tối thiểu: chỉ phần PersonaFormBody đọc khi `fields` rỗng (không kiểm hook `usePersonaForm` ở đây). */
const makeForm = () =>
  ({
    basic: { fullName: '', phone: '', email: '', nationalId: '', areaId: '', sourceId: '', interestedProjectIds: [], tagIds: [] },
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

describe('PersonaFormBody: thẻ nhóm Khác (FR-48)', () => {
  it('có đủ ba nhóm thẻ; thẻ OTHER đang bật hiện ở nhóm "Thẻ khác" và bấm được để gắn', () => {
    const form = makeForm();
    renderBody(form);
    expect(screen.getByRole('group', { name: 'Thẻ sở thích' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Thẻ nghề nghiệp' })).toBeInTheDocument();
    const other = screen.getByRole('group', { name: 'Thẻ khác' });
    expect(within(other).queryByText('Thẻ đã tắt')).not.toBeInTheDocument();
    fireEvent.click(within(other).getByLabelText(/Khách VIP/));
    expect(form.toggleTag).toHaveBeenCalledWith('t-vip');
  });

  it('thẻ có nhóm lạ hiện ở "Thẻ khác" (không biến mất) và không lọt vào nhóm khác', () => {
    const form = makeForm();
    renderBody(form);
    const other = screen.getByRole('group', { name: 'Thẻ khác' });
    fireEvent.click(within(other).getByLabelText(/Thẻ nhóm lạ/));
    expect(form.toggleTag).toHaveBeenCalledWith('t-future');
    expect(within(screen.getByRole('group', { name: 'Thẻ sở thích' })).queryByText('Thẻ nhóm lạ')).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Thẻ nghề nghiệp' })).queryByText('Thẻ nhóm lạ')).not.toBeInTheDocument();
  });

  it('gắn nhanh thẻ mới ở nhóm "Thẻ khác": tạo thẻ với category OTHER', () => {
    const form = makeForm();
    renderBody(form);
    fireEvent.change(screen.getByLabelText('Thêm thẻ khác mới'), { target: { value: 'Khách quen' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Thêm/ })[2]);
    expect(form.addNewTag).toHaveBeenCalledWith('Khách quen', 'OTHER');
  });

  it('gắn nhanh bằng Enter ở nhóm Sở thích tạo đúng nhóm INTEREST; tên trống không tạo', () => {
    const form = makeForm();
    renderBody(form);
    const input = screen.getByLabelText('Thêm thẻ sở thích mới');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(form.addNewTag).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Câu cá' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(form.addNewTag).toHaveBeenCalledWith('Câu cá', 'INTEREST');
  });
});
