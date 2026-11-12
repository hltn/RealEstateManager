import sharp from 'sharp';

/** Cạnh dài tối đa của thumbnail (px); ảnh nhỏ hơn giữ nguyên, không phóng to (FR-26, Architecture 5.9.1). */
export const THUMBNAIL_MAX_EDGE = 320;
/** Chất lượng WebP của thumbnail. */
export const THUMBNAIL_WEBP_QUALITY = 75;
/** MIME của thumbnail (luôn WebP, nằm trong `ATTACHMENT_IMAGE_POLICY`). */
export const THUMBNAIL_MIME_TYPE = 'image/webp';
/**
 * Trần số điểm ảnh của ảnh GỐC được phép giải mã (50 triệu, ví dụ 7000x7000): chống "bom giải nén" (file nhỏ
 * nhưng hàng trăm triệu điểm ảnh) làm tràn bộ nhớ worker. Mặc định của sharp là 268 triệu, quá lớn cho worker song song.
 */
export const THUMBNAIL_MAX_INPUT_PIXELS = 50_000_000;

// Cấu hình sharp (toàn tiến trình, chạy một lần khi nạp module): 1 luồng libvips và tắt cache để bộ nhớ
// của worker (concurrency 2) có trần dự đoán được (rủi ro R6).
sharp.concurrency(1);
sharp.cache(false);

/** Ảnh không giải mã/thu nhỏ được (hỏng, định dạng lạ, vượt trần điểm ảnh): lỗi xác định, retry không giúp ích. */
export class ThumbnailImageError extends Error {}

export interface ThumbnailResult {
  /** Ảnh WebP đã thu nhỏ, KHÔNG có metadata (Exif/GPS). */
  buffer: Buffer;
  /** Kích thước ảnh GỐC (sau khi xoay theo Exif nếu có), để lưu vào `crm_attachments`. */
  width: number;
  height: number;
}

/** Orientation Exif 5..8 là ảnh xoay 90 độ: chiều rộng/cao hiển thị bị đổi chỗ. */
const isQuarterTurn = (orientation: number | undefined): boolean =>
  orientation !== undefined && orientation >= 5 && orientation <= 8;

/**
 * Tạo thumbnail WebP cạnh dài tối đa `THUMBNAIL_MAX_EDGE` từ ảnh gốc (jpeg/png/webp). `sharp` mặc định không giữ
 * metadata nên đầu ra không còn Exif/GPS. Mọi lỗi giải mã bọc thành `ThumbnailImageError` để bên gọi phân biệt với
 * lỗi hạ tầng (mạng/kho lưu) và không retry vô ích.
 */
export async function createThumbnail(input: Buffer): Promise<ThumbnailResult> {
  try {
    const image = sharp(input, {
      limitInputPixels: THUMBNAIL_MAX_INPUT_PIXELS,
      failOn: 'error',
    }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height) {
      throw new Error('Không đọc được kích thước ảnh');
    }
    const buffer = await image
      .resize({
        width: THUMBNAIL_MAX_EDGE,
        height: THUMBNAIL_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: THUMBNAIL_WEBP_QUALITY })
      .toBuffer();
    const swap = isQuarterTurn(meta.orientation);
    return {
      buffer,
      width: swap ? meta.height : meta.width,
      height: swap ? meta.width : meta.height,
    };
  } catch (error) {
    throw new ThumbnailImageError((error as Error).message, { cause: error });
  }
}
