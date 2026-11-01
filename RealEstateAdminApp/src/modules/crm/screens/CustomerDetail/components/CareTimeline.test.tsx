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

/** Nhật ký có `count` ảnh (id att-1..att-N) để thử nhóm "+N" khi vượt 3 thumbnail. */
const withPhotos = (log: CareLogView, count: number): CareLogView => ({
  ...log,
  images: Array.from({ length: count }, (_, index) => ({ src: `https://s3.test/${index + 1}.jpg`, caption: `Ảnh ${index + 1}` })),
  attachmentIds: Array.from({ length: count }, (_, index) => `att-${index + 1}`),
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

  it('nhật ký > 3 ảnh: "+N" mở rộng để gỡ được cả ảnh trong nhóm ẩn (đúng id), "Thu gọn" ẩn lại', async () => {
    removeSavedCareLogAttachment.mockResolvedValue({ ok: true, data: undefined });
    renderTimeline(withPhotos(makeLog(true), 5));
    expect(screen.getAllByTestId('care-log-photo-remove')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Hiện thêm 2 ảnh' }));
    expect(screen.getAllByTestId('care-log-photo')).toHaveLength(5);
    expect(screen.getAllByTestId('care-log-photo-remove')).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh 5 khỏi nhật ký' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận gỡ ảnh' }));
    await waitFor(() => expect(removeSavedCareLogAttachment).toHaveBeenCalledWith('c1', 'att-5'));

    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn' }));
    expect(screen.getAllByTestId('care-log-photo')).toHaveLength(3);
  });

  it('người chỉ xem (không canEdit): "+N" vẫn là lối mở lightbox, không mở rộng, không có nút gỡ', () => {
    renderTimeline(withPhotos(makeLog(false), 5));
    expect(screen.getByRole('button', { name: 'Xem tất cả 5 ảnh' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hiện thêm/ })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('care-log-photo')).toHaveLength(3);
    expect(screen.queryAllByTestId('care-log-photo-remove')).toHaveLength(0);
  });
});
