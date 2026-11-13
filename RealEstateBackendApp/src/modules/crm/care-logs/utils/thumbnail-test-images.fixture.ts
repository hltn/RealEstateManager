import { crc32, deflateSync } from 'zlib';
import sharp from 'sharp';

/** Ảnh mẫu THẬT, nhỏ, dùng chung cho test thumbnail (FR-26): không dùng ảnh giả vì `sharp` phải giải mã được. */
export const sampleImage = (
  format: 'jpeg' | 'png' | 'webp',
  width = 800,
  height = 400,
): Promise<Buffer> => {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 80, b: 40 },
    },
  });
  return image[format]().toBuffer();
};

/** JPEG mang Exif Orientation = 6 (xoay 90 độ) và Copyright: để test xoay/đổi chỗ rộng-cao và bỏ metadata. */
export const jpegWithExif = (width = 800, height = 400): Promise<Buffer> =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 120, b: 200 },
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Copyright: 'khong-duoc-ro-ri' } })
    .toBuffer();

const pngChunk = (typeName: string, data: Buffer): Buffer => {
  const type = Buffer.from(typeName, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
};

/**
 * PNG chỉ khai báo kích thước khổng lồ trong IHDR, dữ liệu điểm ảnh gần như rỗng: `sharp` từ chối ngay ở bước đọc
 * header vì vượt trần điểm ảnh, nên test chạy tức thì mà không phải dựng ảnh thật hàng trăm MB.
 */
export const pngClaimingHugeDimensions = (side = 10_000): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.alloc(1))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
