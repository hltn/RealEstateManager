import { describe, expect, it } from 'vitest';
import { getScaledSize, isAcceptedPhotoFile, MAX_ATTACHED_PHOTOS, MAX_PHOTO_BYTES, MAX_PHOTO_DIMENSION } from './useAttachedPhotos';

describe('C7 giới hạn ảnh đính kèm', () => {
  it('tối đa 4 ảnh/nhật ký (giảm từ 6 để không vượt quota localStorage)', () => {
    expect(MAX_ATTACHED_PHOTOS).toBe(4);
  });

  it('ảnh lớn được thu nhỏ giữ tỉ lệ, ảnh nhỏ không bị phóng to', () => {
    expect(getScaledSize(4000, 3000)).toEqual({ width: MAX_PHOTO_DIMENSION, height: 960 });
    expect(getScaledSize(3000, 4000)).toEqual({ width: 960, height: MAX_PHOTO_DIMENSION });
    expect(getScaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(getScaledSize(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it('chỉ nhận file ảnh trong giới hạn dung lượng gốc', () => {
    expect(isAcceptedPhotoFile({ type: 'image/png', size: MAX_PHOTO_BYTES })).toBe(true);
    expect(isAcceptedPhotoFile({ type: 'image/png', size: MAX_PHOTO_BYTES + 1 })).toBe(false);
    expect(isAcceptedPhotoFile({ type: 'application/pdf', size: 10 })).toBe(false);
  });
});

describe('Th8 hook ảnh đính kèm', () => {
  const makeFile = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
  const three = () => [makeFile('a.png'), makeFile('b.png'), makeFile('c.png')];

  it('chọn file hai lần liên tiếp không vượt giới hạn và số file bị bỏ qua tính đúng', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useAttachedPhotos } = await import('./useAttachedPhotos');
    const { result } = renderHook(() => useAttachedPhotos());
    const add = result.current.addFiles; // cùng một callback (closure cũ) gọi hai lần liên tiếp
    const skipped: number[] = [];
    await act(async () => {
      skipped.push(await add(three()));
      skipped.push(await add(three()));
    });
    expect(result.current.photos).toHaveLength(MAX_ATTACHED_PHOTOS);
    expect(skipped).toEqual([0, 2]); // lần 2 chỉ còn 1 chỗ trống -> bỏ 2 file
  });

  it('nén canvas: tô nền trắng TRƯỚC khi vẽ (PNG trong suốt không thành nền đen), xuất JPEG', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useAttachedPhotos } = await import('./useAttachedPhotos');
    const calls: string[] = [];
    const context = {
      fillStyle: '',
      fillRect: () => calls.push(`fillRect:${context.fillStyle}`),
      drawImage: () => calls.push('drawImage'),
    };
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
    const OriginalImage = globalThis.Image;
    HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof originalGetContext;
    HTMLCanvasElement.prototype.toDataURL = ((type: string) => `data:${type};base64,xx`) as typeof originalToDataUrl;
    globalThis.Image = class {
      naturalWidth = 4000;
      naturalHeight = 3000;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    } as unknown as typeof Image;
    try {
      const { result } = renderHook(() => useAttachedPhotos());
      await act(async () => {
        await result.current.addFiles([makeFile('trong-suot.png')]);
      });
      expect(calls).toEqual(['fillRect:#ffffff', 'drawImage']);
      expect(result.current.photos[0].src.startsWith('data:image/jpeg')).toBe(true);
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      HTMLCanvasElement.prototype.toDataURL = originalToDataUrl;
      globalThis.Image = OriginalImage;
    }
  });
});
