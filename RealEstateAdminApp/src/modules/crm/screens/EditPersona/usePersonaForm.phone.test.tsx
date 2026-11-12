/** usePersonaForm: SĐT tùy chọn (FR-02) — khách chưa có SĐT mở sẵn ô; xóa trống ô = gửi null; không gọi createPhoneView khi chưa có số. */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail, CustomerPersonaView } from '@crm/api';
import { usePersonaForm } from './usePersonaForm';

const saveCustomerProfile = vi.fn();
const createPhoneView = vi.fn();
const showToast = vi.fn();
const goBack = vi.fn();

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({ saveCustomerProfile, createPhoneView }), useCatalogs: () => ({ personaFields: [] }) };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ goBack, showToast }) }));

const customerOf = (phoneMasked: string | null) =>
  ({
    id: 'c1',
    version: 3,
    fullName: 'Nguyễn Văn An',
    email: '',
    phoneMasked,
    hasNationalId: false,
    area: null,
    source: null,
    projects: [],
    tags: [],
  }) as unknown as CustomerDetail;
const persona = { values: [] } as unknown as CustomerPersonaView;
const OPTIONS = { groupCodes: [], hasBasicInfo: true, successToastTitle: 'Đã lưu' } as const;

beforeEach(() => {
  saveCustomerProfile.mockReset().mockResolvedValue({ ok: true, data: {} });
  createPhoneView.mockReset();
  showToast.mockReset();
  goBack.mockReset();
});

describe('khách CHƯA có SĐT (phoneMasked null)', () => {
  it('ô SĐT mở sẵn (không khóa), hasPhone=false, không cần "Sửa số"', () => {
    const { result } = renderHook(() => usePersonaForm(customerOf(null), persona, OPTIONS));
    expect(result.current.hasPhone).toBe(false);
    expect(result.current.isPhoneLocked).toBe(false);
    expect(result.current.phoneMasked).toBe('');
  });

  it('bỏ trống SĐT, không đổi gì khác -> "Chưa có thay đổi", KHÔNG gọi API', async () => {
    const { result } = renderHook(() => usePersonaForm(customerOf(null), persona, OPTIONS));
    let ok = true;
    await act(async () => {
      ok = await result.current.submit();
    });
    expect(ok).toBe(false);
    expect(saveCustomerProfile).not.toHaveBeenCalled();
    expect(createPhoneView).not.toHaveBeenCalled();
  });

  it('thêm SĐT hợp lệ -> gửi profile.phone; quay lại chi tiết sau lưu', async () => {
    const { result } = renderHook(() => usePersonaForm(customerOf(null), persona, OPTIONS));
    act(() => result.current.setBasicField('phone', '0988 111 222'));
    let ok = false;
    await act(async () => {
      ok = await result.current.submit();
    });
    expect(ok).toBe(true);
    expect(saveCustomerProfile).toHaveBeenCalledWith('c1', expect.objectContaining({ version: 3, profile: { phone: '0988 111 222' } }));
    expect(goBack).toHaveBeenCalled();
  });

  it('SĐT nhập sai định dạng -> chặn lưu, báo lỗi ở trường phone', async () => {
    const { result } = renderHook(() => usePersonaForm(customerOf(null), persona, OPTIONS));
    act(() => result.current.setBasicField('phone', '123'));
    await act(async () => {
      await result.current.submit();
    });
    expect(saveCustomerProfile).not.toHaveBeenCalled();
    expect(result.current.basicErrors.phone).toMatch(/không hợp lệ/);
  });
});

describe('khách ĐÃ có SĐT', () => {
  it('ban đầu khóa (hiện số che); chưa bấm "Sửa số" thì không gửi/không kiểm SĐT', async () => {
    const { result } = renderHook(() => usePersonaForm(customerOf('0912 ••• 678'), persona, OPTIONS));
    expect(result.current.hasPhone).toBe(true);
    expect(result.current.isPhoneLocked).toBe(true);
    expect(result.current.phoneMasked).toBe('0912 ••• 678');
    act(() => result.current.setBasicField('fullName', 'An B'));
    await act(async () => {
      await result.current.submit();
    });
    expect(saveCustomerProfile).toHaveBeenCalledWith('c1', expect.objectContaining({ profile: { fullName: 'An B' } }));
  });

  it('Sửa số -> mở khóa -> xóa trống ô -> lưu gửi phone: null', async () => {
    createPhoneView.mockResolvedValue({ ok: true, data: { phone: '+84912345678' } });
    const { result } = renderHook(() => usePersonaForm(customerOf('0912 ••• 678'), persona, OPTIONS));
    await act(async () => {
      await result.current.revealPhone();
    });
    expect(createPhoneView).toHaveBeenCalledWith('c1', 'VIEW');
    expect(result.current.isPhoneLocked).toBe(false);
    expect(result.current.basic.phone).toBe('0912 345 678');

    act(() => result.current.setBasicField('phone', ''));
    await act(async () => {
      await result.current.submit();
    });
    expect(saveCustomerProfile).toHaveBeenCalledWith('c1', expect.objectContaining({ profile: { phone: null } }));
  });

  it('Sửa số rồi giữ nguyên số -> không gửi phone (không ghi thừa)', async () => {
    createPhoneView.mockResolvedValue({ ok: true, data: { phone: '+84912345678' } });
    const { result } = renderHook(() => usePersonaForm(customerOf('0912 ••• 678'), persona, OPTIONS));
    await act(async () => {
      await result.current.revealPhone();
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(saveCustomerProfile).not.toHaveBeenCalled();
  });
});
