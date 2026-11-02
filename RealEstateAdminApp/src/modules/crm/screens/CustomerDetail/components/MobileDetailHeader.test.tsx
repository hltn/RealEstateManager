import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { MobileDetailHeader } from './MobileDetailHeader';

const renderHeader = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <MobileDetailHeader />
      </CrmProvider>
    </MemoryRouter>,
  );
};

describe('MobileDetailHeader (PT-017): đầu màn chi tiết khách trên điện thoại', () => {
  it('chỉ còn nhãn "Quản lý khách hàng" + Quay lại + Chỉnh sửa, KHÔNG có tên khách (tên đã nằm ở thẻ tóm tắt hồ sơ)', () => {
    renderHeader();
    expect(screen.getByText('Quản lý khách hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Chỉnh sửa/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('bấm Quay lại không lỗi (gọi goBack của store)', () => {
    renderHeader();
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }))).not.toThrow();
  });
});
