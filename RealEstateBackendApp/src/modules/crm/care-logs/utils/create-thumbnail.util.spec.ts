import sharp from 'sharp';
import {
  createThumbnail,
  THUMBNAIL_MAX_EDGE,
  ThumbnailImageError,
} from './create-thumbnail.util';
import {
  jpegWithExif,
  pngClaimingHugeDimensions,
  sampleImage,
} from './thumbnail-test-images';

describe('createThumbnail (FR-26)', () => {
  it('FR-26: ảnh ngang lớn thu về cạnh dài 320px, giữ tỉ lệ, xuất WebP và trả kích thước ảnh gốc', async () => {
    const result = await createThumbnail(await sampleImage('jpeg', 1200, 600));

    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(THUMBNAIL_MAX_EDGE);
    expect(meta.height).toBe(160);
    expect(result).toMatchObject({ width: 1200, height: 600 });
  });

  it('FR-26: ảnh dọc thu theo cạnh cao; hỗ trợ cả PNG và WebP đầu vào', async () => {
    for (const format of ['png', 'webp'] as const) {
      const result = await createThumbnail(await sampleImage(format, 300, 900));
      const meta = await sharp(result.buffer).metadata();
      expect([meta.width, meta.height]).toEqual([107, THUMBNAIL_MAX_EDGE]);
      expect(result).toMatchObject({ width: 300, height: 900 });
    }
  });

  it('FR-26: ảnh nhỏ hơn 320px giữ nguyên kích thước (không phóng to)', async () => {
    const result = await createThumbnail(await sampleImage('png', 100, 50));

    const meta = await sharp(result.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([100, 50]);
  });

  it('FR-26: ảnh cạnh đúng 320px giữ nguyên (biên)', async () => {
    const result = await createThumbnail(await sampleImage('jpeg', 320, 200));

    const meta = await sharp(result.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([320, 200]);
  });

  it('FR-26: thumbnail KHÔNG giữ metadata (Exif/Copyright) của ảnh gốc', async () => {
    const source = await jpegWithExif(800, 400);
    expect((await sharp(source).metadata()).exif).toBeDefined(); // chứng minh ảnh mẫu có Exif thật

    const result = await createThumbnail(source);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(result.buffer.includes(Buffer.from('khong-duoc-ro-ri'))).toBe(false);
  });

  it('FR-26: Exif Orientation 6 được xoay đúng chiều và rộng/cao của ảnh gốc được đổi chỗ', async () => {
    const result = await createThumbnail(await jpegWithExif(800, 400));

    const meta = await sharp(result.buffer).metadata();
    // 800x400 xoay 90 độ => 400x800, thu về cạnh dài 320 => 160x320.
    expect([meta.width, meta.height]).toEqual([160, THUMBNAIL_MAX_EDGE]);
    expect(result).toMatchObject({ width: 400, height: 800 });
  });

  it('FR-26: dữ liệu không phải ảnh => ThumbnailImageError (lỗi xác định, không retry)', async () => {
    await expect(
      createThumbnail(Buffer.from('khong phai anh')),
    ).rejects.toBeInstanceOf(ThumbnailImageError);
    await expect(createThumbnail(Buffer.alloc(0))).rejects.toBeInstanceOf(
      ThumbnailImageError,
    );
  });

  it('FR-26: ảnh hỏng giữa chừng => ThumbnailImageError', async () => {
    const full = await sampleImage('png', 400, 400);
    const truncated = full.subarray(0, Math.floor(full.length / 2));

    await expect(createThumbnail(truncated)).rejects.toBeInstanceOf(
      ThumbnailImageError,
    );
  });

  it('FR-26: ảnh khai báo vượt trần điểm ảnh (limitInputPixels) bị từ chối trước khi giải mã', async () => {
    await expect(
      createThumbnail(pngClaimingHugeDimensions(10_000)),
    ).rejects.toThrow(/pixel limit/i);
    await expect(
      createThumbnail(pngClaimingHugeDimensions(10_000)),
    ).rejects.toBeInstanceOf(ThumbnailImageError);
  });

  it('FR-26: cấu hình sharp an toàn bộ nhớ: concurrency(1)', () => {
    // `sharp.cache()` không có getter an toàn (gọi không đối số sẽ BẬT lại cache) nên chỉ kiểm concurrency.
    expect(sharp.concurrency()).toBe(1);
  });
});
