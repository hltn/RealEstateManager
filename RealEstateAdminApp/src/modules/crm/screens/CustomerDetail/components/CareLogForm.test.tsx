import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CareLogForm } from './CareLogForm';

// Cờ đọc lúc render nên đổi được giữa các ca; mặc định TẮT như production.
const flags = vi.hoisted(() => ({ isAttachmentsEnabled: false }));
vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: flags }));

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({}),
    useCatalogs: () => ({ catalogs: { contactResults: [] } }),
  };
});

const customer = { id: '6add87b88f689f6e6cd96833', version: 1, status: { id: 's', label: 'Mới' }, criteria: {}, careTeam: [] } as unknown as CustomerDetail;

const renderForm = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CareLogForm customer={customer} variant="desktop" />
      </CrmProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  flags.isAttachmentsEnabled = false;
});

describe('G1: khung tải ảnh trong form ghi nhật ký theo cờ VITE_FEATURE_CRM_ATTACHMENTS', () => {
  it('cờ bật: thấy nút "Thêm ảnh" (ô chọn file chỉ nhận jpeg/png/webp) và dòng giới hạn 5 MB / 5 ảnh', () => {
    flags.isAttachmentsEnabled = true;
    renderForm();
    expect(screen.getByText('Thêm ảnh')).toBeVisible();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(screen.getByText(/JPEG, PNG hoặc WebP, tối đa 5 MB mỗi ảnh, tối đa 5 ảnh/)).toBeVisible();
  });

  it('cờ tắt: ẩn hoàn toàn khung tải ảnh như cũ', () => {
    renderForm();
    expect(screen.queryByText('Thêm ảnh')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
