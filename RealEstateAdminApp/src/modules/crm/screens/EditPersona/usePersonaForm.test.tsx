/** Form sửa khách: số đầy đủ KHÔNG nằm sẵn trong form; chỉ lấy khi bấm "Sửa số" (createPhoneView -> 1 log), chưa lấy thì không gửi SĐT. */
import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useCustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { usePersonaForm } from './usePersonaForm';

const setup = (userId: string) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <MemoryRouter>
        <CrmProvider store={store}>{children}</CrmProvider>
      </MemoryRouter>
    </StrictMode>
  );
  const { result } = renderHook(
    () => {
      const { data } = useCustomerDetail('CUST-001');
      return usePersonaForm(data!, { groupCodes: ['PERSONAL'], hasBasicInfo: true, successToastTitle: 'Đã lưu' });
    },
    { wrapper },
  );
  const customer = () => store.getState().state.customers.find((item) => item.id === 'CUST-001')!;
  const phoneLogs = () => store.getState().state.changeLogs.filter((log) => log.action === 'PHONE_VIEWED');
  return { result, customer, phoneLogs };
};

describe('usePersonaForm — SĐT', () => {
  it('ban đầu khoá, chỉ có số đã che, ô SĐT của form rỗng', () => {
    const { result, phoneLogs } = setup('hanh');
    expect(result.current.isPhoneLocked).toBe(true);
    expect(result.current.phoneMasked).toBe('0912 345 •••');
    expect(result.current.basic.phone).toBe('');
    expect(phoneLogs()).toHaveLength(0);
  });

  it('lưu khi chưa bấm "Sửa số": không kiểm/không gửi SĐT -> số không đổi, không log xem số', () => {
    const { result, customer, phoneLogs } = setup('hanh');
    act(() => result.current.setBasicField('fullName', 'Nguyễn Văn An (sửa)'));
    let isSaved = false;
    act(() => {
      isSaved = result.current.submit() as boolean;
    });
    expect(isSaved).toBe(true);
    expect(customer().fullName).toBe('Nguyễn Văn An (sửa)');
    expect(customer().phone).toBe('+84912345678');
    expect(phoneLogs()).toHaveLength(0);
  });

  it('"Sửa số": lấy số đầy đủ qua createPhoneView, ghi ĐÚNG 1 log (StrictMode), mở khoá; đổi số rồi lưu thì cập nhật', () => {
    const { result, customer, phoneLogs } = setup('thao');
    act(() => result.current.revealPhone());
    expect(phoneLogs()).toHaveLength(1);
    expect(phoneLogs()[0]).toMatchObject({ actorId: 'thao', customerId: 'CUST-001' });
    expect(result.current.isPhoneLocked).toBe(false);
    expect(result.current.basic.phone).toBe('0912 345 678');
    act(() => result.current.setBasicField('phone', '0912 345 679'));
    act(() => {
      result.current.submit();
    });
    expect(customer().phone).toBe('+84912345679');
  });

  it('sau khi mở khoá, SĐT sai định dạng bị chặn và không lưu', () => {
    const { result, customer } = setup('hanh');
    act(() => result.current.revealPhone());
    act(() => result.current.setBasicField('phone', 'abc'));
    let isSaved = true;
    act(() => {
      isSaved = result.current.submit() as boolean;
    });
    expect(isSaved).toBe(false);
    expect(result.current.basicErrors.phone).toBeDefined();
    expect(customer().phone).toBe('+84912345678');
  });
});

describe('usePersonaForm — đổi khách', () => {
  it('đã mở khoá SĐT của khách A, đổi sang khách B -> ô SĐT khoá lại, chỉ có số che của B, lưu không gửi SĐT', () => {
    const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: 'hanh' }, shouldPersist: false });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <MemoryRouter>
          <CrmProvider store={store}>{children}</CrmProvider>
        </MemoryRouter>
      </StrictMode>
    );
    const { result, rerender } = renderHook(
      ({ customerId }: { customerId: string }) => {
        const { data } = useCustomerDetail(customerId);
        return usePersonaForm(data!, { groupCodes: ['PERSONAL'], hasBasicInfo: true, successToastTitle: 'Đã lưu' });
      },
      { wrapper, initialProps: { customerId: 'CUST-001' } },
    );
    act(() => result.current.revealPhone());
    expect(result.current.isPhoneLocked).toBe(false);
    rerender({ customerId: 'CUST-004' });
    expect(result.current.isPhoneLocked).toBe(true);
    expect(result.current.phoneMasked).toBe('0977 555 •••');
    act(() => {
      result.current.submit();
    });
    const customer004 = store.getState().state.customers.find((item) => item.id === 'CUST-004')!;
    expect(customer004.phone).toBe('+84977555562');
    const phoneLogs = store.getState().state.changeLogs.filter((log) => log.action === 'PHONE_VIEWED');
    expect(phoneLogs.map((log) => log.customerId)).toEqual(['CUST-001']);
  });
});
