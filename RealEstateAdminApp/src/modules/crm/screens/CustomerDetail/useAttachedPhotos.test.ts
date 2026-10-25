import { describe, expect, it } from 'vitest';
import { isAcceptedPhotoFile, MAX_ATTACHED_PHOTOS, MAX_PHOTO_BYTES, pickAcceptedFiles } from './useAttachedPhotos';

const makeFile = (name: string, type = 'image/png', size = 3): File => new File([new Uint8Array(size)], name, { type });

describe('ảnh đính kèm nhật ký (05 §2.6)', () => {
  it('tối đa 5 ảnh mỗi ghi chú như backend (ATTACHMENT_LIMIT_EXCEEDED)', () => {
    expect(MAX_ATTACHED_PHOTOS).toBe(5);
  });

  it('chỉ nhận jpeg/png/webp trong giới hạn 5 MB (gif/pdf/file rỗng bị bỏ)', () => {
    expect(isAcceptedPhotoFile({ type: 'image/jpeg', size: MAX_PHOTO_BYTES })).toBe(true);
    expect(isAcceptedPhotoFile({ type: 'image/webp', size: 10 })).toBe(true);
    expect(isAcceptedPhotoFile({ type: 'image/png', size: MAX_PHOTO_BYTES + 1 })).toBe(false);
    expect(isAcceptedPhotoFile({ type: 'image/gif', size: 10 })).toBe(false);
    expect(isAcceptedPhotoFile({ type: 'application/pdf', size: 10 })).toBe(false);
    expect(isAcceptedPhotoFile({ type: 'image/png', size: 0 })).toBe(false);
  });

  it('chia file theo chỗ trống và đếm đúng số file bị bỏ qua (sai loại + quá số lượng)', () => {
    const files = [makeFile('a.png'), makeFile('b.gif', 'image/gif'), makeFile('c.png'), makeFile('d.png')];
    const result = pickAcceptedFiles(files, 2);
    expect(result.accepted.map((file) => file.name)).toEqual(['a.png', 'c.png']);
    expect(result.skippedCount).toBe(2);
    expect(pickAcceptedFiles(files, 0)).toEqual({ accepted: [], skippedCount: 4 });
    expect(pickAcceptedFiles(files, -1).accepted).toHaveLength(0);
  });
});
