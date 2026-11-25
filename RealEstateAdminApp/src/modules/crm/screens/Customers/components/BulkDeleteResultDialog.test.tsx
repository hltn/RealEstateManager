/** FR-31 (T-59): xóa hàng loạt báo khách không đủ quyền (INSUFFICIENT_ROLE) trong failed[] bằng đúng câu "chỉ Quản trị hoặc người tạo". */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BulkDeleteResultDialog } from './BulkDeleteResultDialog';

describe('BulkDeleteResultDialog - INSUFFICIENT_ROLE (FR-31)', () => {
  it('khách INSUFFICIENT_ROLE hiện tên + lý do đúng nguyên văn, không nhắc khách "Bỏ", Quản lý hay phụ trách chính', () => {
    render(
      <BulkDeleteResultDialog
        result={{ succeeded: ['c-1'], failed: [{ customerId: 'c-2', errorCode: 'INSUFFICIENT_ROLE' }] }}
        getCustomerName={(id) => `Khách ${id}`}
        onClose={vi.fn()}
      />,
    );
    const failedList = screen.getByRole('region', { name: 'Khách không xóa được' });
    expect(within(failedList).getByText(/Khách c-2/)).toBeInTheDocument();
    expect(failedList).toHaveTextContent('bạn không có quyền xóa khách này (chỉ Quản trị hoặc người tạo khách mới xóa được)');
    expect(failedList.textContent).not.toMatch(/Bỏ|Quản lý|phụ trách chính/);
  });
});
