import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareLogView } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CareTimeline } from './CareTimeline';

const removeSavedCareLogAttachment = vi.fn();

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({ removeSavedCareLogAttachment }) };
});

const makeLog = (canEdit: boolean): CareLogView => ({
  id: 'l1',
  customerId: 'c1',
  author: { id: 'u1', displayName: 'Hạnh' },
  isPrimaryAuthor: true,
  occurredAt: '2026-10-26T02:00:00.000Z',
  content: 'Đã gọi tư vấn',
  contactChannel: 'CALL',
  contactResult: null,
  nextAction: null,
  source: 'MANUAL',
  images: [
    { src: 'https://s3.test/a.jpg', caption: 'Ảnh 1' },
    { src: 'https://s3.test/b.jpg', caption: 'Ảnh 2' },
  ],
  attachmentIds: ['att-1', 'att-2'],
  editedAt: null,
  canEdit,
});

const renderTimeline = (careLog: CareLogView) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CareTimeline careLogs={[careLog]} customerId="c1" />
      </CrmProvider>
    </MemoryRouter>,
  );
};

describe('CareTimeline: gỡ ảnh khỏi nhật ký đã lưu', () => {
  beforeEach(() => removeSavedCareLogAttachment.mockReset());

  it('chỉ hiện nút gỡ khi người xem còn quyền sửa nhật ký (canEdit)', () => {
    const { unmount } = renderTimeline(makeLog(false));
    expect(screen.queryAllByTestId('care-log-photo-remove')).toHaveLength(0);
    unmount();

    renderTimeline(makeLog(true));
    expect(screen.getAllByTestId('care-log-photo-remove')).toHaveLength(2);
  });

  it('xác nhận mới gọi API, đúng id ảnh được chọn (không nhầm ảnh khác); "Giữ ảnh" thì không gọi', async () => {
    removeSavedCareLogAttachment.mockResolvedValue({ ok: true, data: undefined });
    renderTimeline(makeLog(true));

    fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh 2 khỏi nhật ký' }));
    fireEvent.click(screen.getByRole('button', { name: 'Giữ ảnh' }));
    expect(removeSavedCareLogAttachment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh 2 khỏi nhật ký' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận gỡ ảnh' }));
    await waitFor(() => expect(removeSavedCareLogAttachment).toHaveBeenCalledTimes(1));
    expect(removeSavedCareLogAttachment).toHaveBeenCalledWith('c1', 'att-2');
  });
});
