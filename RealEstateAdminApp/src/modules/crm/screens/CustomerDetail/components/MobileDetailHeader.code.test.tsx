/** MobileDetailHeader: mã khách ở hàng đầu chi tiết trên điện thoại (FR-04). */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { MobileDetailHeader } from './MobileDetailHeader';

const renderWithCode = (code?: string | null) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <MobileDetailHeader customerCode={code} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

describe('MobileDetailHeader: mã khách', () => {
  it('có mã: hiện mã (kèm chữ ẩn "Mã khách"), vẫn chỉ có nút Quay lại, không heading', () => {
    renderWithCode('KH-000123');
    expect(screen.getByText('KH-000123')).toHaveTextContent('KH-000123');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('mã null hoặc không truyền: không hiện gì thêm', () => {
    const { unmount } = renderWithCode(null);
    expect(screen.queryByText(/Mã khách/)).not.toBeInTheDocument();
    unmount();
    renderWithCode();
    expect(screen.queryByText(/Mã khách/)).not.toBeInTheDocument();
  });
});
