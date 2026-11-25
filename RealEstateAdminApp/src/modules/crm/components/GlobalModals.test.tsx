/** FR-47: GlobalModals chuyển `code` Kết quả liên hệ của CallModal vào nhật ký (`contactResultId`), không còn ghép nhãn cứng vào nội dung. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { GlobalModals } from './GlobalModals';

const flags = vi.hoisted(() => ({ isInAppCallEnabled: true, isZaloZnsEnabled: false }));
vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: flags }));
vi.mock('@crm/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const createCareLog = vi.fn();
const catalogs = vi.hoisted(() => ({
  contactResults: [{ id: 'SITE_VISIT', label: 'Hẹn xem nhà', isActive: true, order: 1, suggestionText: '', suggestedFollowUpDays: null }],
}));
vi.mock('@crm/api', async () => ({
  ...(await vi.importActual<typeof import('@crm/api')>('@crm/api')),
  useCrmApi: () => ({ createCareLog }),
  useCustomerDetail: () => ({ data: { id: 'c1', fullName: 'Nguyễn Văn A', projects: [] } }),
  useCustomerPersona: () => ({ data: { values: [] } }),
  useCatalogs: () => ({ catalogs, isLoading: false, isError: false, refetch: vi.fn() }),
}));

const setup = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <GlobalModals />
      </CrmProvider>
    </MemoryRouter>,
  );
  act(() => store.getState().dispatch({ type: 'modal/open', modal: { kind: 'call', customerId: 'c1', phone: '0901234567' } }));
};

beforeEach(() => {
  flags.isInAppCallEnabled = true;
  createCareLog.mockReset();
  createCareLog.mockResolvedValue({ ok: true, data: { id: 'log-1' } });
});

describe('GlobalModals: CallModal ghi nhật ký theo code (FR-47)', () => {
  it('FR-47: lưu cuộc gọi -> createCareLog nhận contactResultId = code, content là ghi chú gốc', async () => {
    setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), { target: { value: 'SITE_VISIT' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Ghi chú nhanh/ }), { target: { value: 'Hẹn thứ bảy' } });
    fireEvent.click(screen.getByRole('button', { name: /Kết thúc cuộc gọi/ }));
    fireEvent.click(screen.getByRole('button', { name: /Lưu vào nhật ký/ }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(createCareLog).toHaveBeenCalledWith('c1', { content: 'Hẹn thứ bảy', contactChannel: 'CALL', contactResultId: 'SITE_VISIT' });
  });

  it('FR-47: không chọn kết quả -> không gửi contactResultId', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Kết thúc cuộc gọi/ }));
    fireEvent.click(screen.getByRole('button', { name: /Lưu vào nhật ký/ }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(createCareLog.mock.calls[0][1]).toEqual({ content: 'Cuộc gọi 00:00 với Nguyễn Văn A', contactChannel: 'CALL' });
  });

  it('FR-47: cờ isInAppCallEnabled tắt -> GlobalModals không dựng CallModal (hành vi cũ giữ nguyên)', () => {
    flags.isInAppCallEnabled = false;
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
