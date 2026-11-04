import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toExistingPhotos, useAttachedPhotos } from './useAttachedPhotos';

const uploadCareLogAttachment = vi.fn();
const deleteCareLogAttachment = vi.fn();

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({ uploadCareLogAttachment, deleteCareLogAttachment }) };
});

const log = {
  images: [
    { src: 'https://s3.test/a.jpg', caption: 'Ảnh 1' },
    { src: 'https://s3.test/b.jpg', caption: 'Ảnh 2' },
  ],
  attachmentIds: ['att-1', 'att-2'],
};

beforeEach(() => {
  uploadCareLogAttachment.mockReset();
  deleteCareLogAttachment.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:new');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

describe('toExistingPhotos (PT-022): ảnh đã lưu -> danh sách ban đầu của form sửa', () => {
  it('ghép ảnh với attachmentId song song, đánh dấu isExisting và status ready', () => {
    expect(toExistingPhotos(log)).toEqual([
      { key: 'saved-att-1', name: 'Ảnh 1', previewUrl: 'https://s3.test/a.jpg', status: 'ready', attachmentId: 'att-1', isExisting: true },
      { key: 'saved-att-2', name: 'Ảnh 2', previewUrl: 'https://s3.test/b.jpg', status: 'ready', attachmentId: 'att-2', isExisting: true },
    ]);
  });

  it('bỏ qua ảnh không có attachmentId tương ứng (dữ liệu lệch)', () => {
    expect(toExistingPhotos({ images: log.images, attachmentIds: ['att-1'] })).toHaveLength(1);
  });
});

describe('useAttachedPhotos với ảnh có sẵn (sửa nhật ký)', () => {
  it('khởi tạo từ ảnh sẵn có; attachmentIds gồm các ảnh đó', () => {
    const { result } = renderHook(() => useAttachedPhotos('c1', toExistingPhotos(log)));
    expect(result.current.photos).toHaveLength(2);
    expect(result.current.attachmentIds).toEqual(['att-1', 'att-2']);
    expect(result.current.isUploading).toBe(false);
  });

  it('gỡ ảnh ĐÃ LƯU chỉ bỏ khỏi danh sách, KHÔNG xóa ở kho và KHÔNG thu hồi object URL', () => {
    const { result } = renderHook(() => useAttachedPhotos('c1', toExistingPhotos(log)));
    act(() => result.current.removePhoto(0));
    expect(result.current.attachmentIds).toEqual(['att-2']);
    expect(deleteCareLogAttachment).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('thêm ảnh mới cạnh ảnh cũ: tính vào giới hạn 5 ảnh; gỡ ảnh MỚI thì xóa ở kho', async () => {
    uploadCareLogAttachment.mockResolvedValue({ ok: true, data: { id: 'att-new' } });
    const { result } = renderHook(() => useAttachedPhotos('c1', toExistingPhotos(log)));
    const files = Array.from({ length: 4 }, (_, index) => new File([new Uint8Array(3)], `n${index}.png`, { type: 'image/png' }));
    let skipped = -1;
    await act(async () => {
      skipped = await result.current.addFiles(files);
    });
    // Còn 3 chỗ (5 - 2 ảnh cũ): nhận 3, bỏ qua 1.
    expect(skipped).toBe(1);
    expect(result.current.photos).toHaveLength(5);
    await waitFor(() => expect(result.current.isUploading).toBe(false));
    act(() => result.current.removePhoto(2));
    expect(deleteCareLogAttachment).toHaveBeenCalledWith('c1', 'att-new');
  });

  it('discardPhotos (Hủy): xóa ở kho CHỈ ảnh mới đã tải lên; ảnh đã lưu giữ nguyên', async () => {
    uploadCareLogAttachment.mockResolvedValue({ ok: true, data: { id: 'att-new' } });
    const { result } = renderHook(() => useAttachedPhotos('c1', toExistingPhotos(log)));
    await act(async () => {
      await result.current.addFiles([new File([new Uint8Array(3)], 'n.png', { type: 'image/png' })]);
    });
    await waitFor(() => expect(result.current.attachmentIds).toContain('att-new'));
    act(() => result.current.discardPhotos());
    expect(deleteCareLogAttachment).toHaveBeenCalledTimes(1);
    expect(deleteCareLogAttachment).toHaveBeenCalledWith('c1', 'att-new');
    expect(result.current.photos).toEqual([]);
  });
});

describe('useAttachedPhotos: dọn ảnh mồ côi khi form bị gỡ (bản nháp bị bỏ)', () => {
  const pngFile = () => new File([new Uint8Array(3)], 'n.png', { type: 'image/png' });

  it('gỡ form khi còn ảnh MỚI đã tải lên mà chưa lưu: xóa ở kho + thu hồi object URL; ảnh đã lưu của nhật ký giữ nguyên', async () => {
    uploadCareLogAttachment.mockResolvedValue({ ok: true, data: { id: 'att-new' } });
    const { result, unmount } = renderHook(() => useAttachedPhotos('c1', toExistingPhotos(log)));
    await act(async () => {
      await result.current.addFiles([pngFile()]);
    });
    await waitFor(() => expect(result.current.attachmentIds).toContain('att-new'));
    unmount();
    expect(deleteCareLogAttachment).toHaveBeenCalledTimes(1);
    expect(deleteCareLogAttachment).toHaveBeenCalledWith('c1', 'att-new');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:new');
  });

  it('đã lưu xong (clearPhotos) rồi mới gỡ form: KHÔNG xóa ảnh vừa gắn vào nhật ký', async () => {
    uploadCareLogAttachment.mockResolvedValue({ ok: true, data: { id: 'att-new' } });
    const { result, unmount } = renderHook(() => useAttachedPhotos('c1'));
    await act(async () => {
      await result.current.addFiles([pngFile()]);
    });
    await waitFor(() => expect(result.current.attachmentIds).toEqual(['att-new']));
    act(() => result.current.clearPhotos());
    unmount();
    expect(deleteCareLogAttachment).not.toHaveBeenCalled();
  });

  it('chỉ có ảnh đã lưu (sửa nhật ký, không thêm ảnh) rồi gỡ form: không gọi xóa nào', () => {
    const { unmount } = renderHook(() => useAttachedPhotos('c1', toExistingPhotos(log)));
    unmount();
    expect(deleteCareLogAttachment).not.toHaveBeenCalled();
  });

  it('form bị gỡ lúc ảnh còn đang tải lên: tải xong thì xóa luôn ảnh đó, không cập nhật state', async () => {
    let finishUpload: (value: unknown) => void = () => undefined;
    uploadCareLogAttachment.mockReturnValue(new Promise((resolve) => (finishUpload = resolve)));
    const { result, unmount } = renderHook(() => useAttachedPhotos('c1'));
    let pending: Promise<number> = Promise.resolve(0);
    act(() => {
      pending = result.current.addFiles([pngFile()]);
    });
    expect(result.current.isUploading).toBe(true);
    unmount();
    expect(deleteCareLogAttachment).not.toHaveBeenCalled();
    await act(async () => {
      finishUpload({ ok: true, data: { id: 'att-late' } });
      await pending;
    });
    expect(deleteCareLogAttachment).toHaveBeenCalledWith('c1', 'att-late');
  });
});
