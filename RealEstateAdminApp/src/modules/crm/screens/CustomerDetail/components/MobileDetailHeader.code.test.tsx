/** MobileDetailHeader: không còn mã khách ở hàng đầu (mã nằm ngay dưới tên trong CustomerHeader mobile, là chip sao chép). */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { MobileDetailHeader } from './MobileDetailHeader';

describe('MobileDetailHeader: không hiện mã khách', () => {
  it('chỉ có nút Quay lại + nhãn "Quản lý khách hàng"; không mã, không nút sao chép, không heading', () => {
    const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
    const { container } = render(
      <MemoryRouter>
        <CrmProvider store={store}>
          <MobileDetailHeader />
        </CrmProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
    expect(screen.getByText('Quản lý khách hàng')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/KH-|Mã khách/);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
