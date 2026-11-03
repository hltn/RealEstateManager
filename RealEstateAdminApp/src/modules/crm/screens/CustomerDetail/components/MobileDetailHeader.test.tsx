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

describe('MobileDetailHeader (PT-017, PT-029): đầu màn chi tiết khách trên điện thoại', () => {
  it('chỉ còn nhãn "Quản lý khách hàng" + Quay lại, KHÔNG có tên khách (tên đã nằm ở thẻ tóm tắt hồ sơ)', () => {
    renderHeader();
    expect(screen.getByText('Quản lý khách hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('PT-029: KHÔNG còn nút "Chỉnh sửa" ở hàng tiêu đề; nút duy nhất là Quay lại', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /Chỉnh sửa/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('bấm Quay lại không lỗi (gọi goBack của store)', () => {
    renderHeader();
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }))).not.toThrow();
  });
});
