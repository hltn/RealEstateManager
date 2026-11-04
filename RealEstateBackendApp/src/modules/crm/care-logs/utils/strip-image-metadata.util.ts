/** Ảnh hỏng/không phân tích được cấu trúc: không được lưu (vì không chắc đã bỏ hết metadata). */
export class InvalidImageError extends Error {}

const JPEG_MARKER_PREFIX = 0xff;
const JPEG_SOI = 0xd8;
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;
const JPEG_APP0 = 0xe0;
const JPEG_APP2 = 0xe2;
const JPEG_APP14 = 0xee;
/** DQT, DHT, SOF0-3/5-7/9-11/13-15, DAC, DRI, DNL: các đoạn cần để giải mã điểm ảnh. */
const JPEG_STRUCTURAL_MARKERS = new Set([
  0xdb, 0xc4, 0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcc,
  0xcd, 0xce, 0xcf, 0xdd, 0xdc,
]);

const startsWithAscii = (
  buffer: Buffer,
  start: number,
  text: string,
): boolean => buffer.toString('latin1', start, start + text.length) === text;

/** Danh sách cho phép: APPn chỉ giữ JFIF, ICC (APP2 "ICC_PROFILE") và Adobe; mọi đoạn khác bị bỏ. */
const isAllowedJpegSegment = (
  marker: number,
  input: Buffer,
  payload: number,
): boolean => {
  if (JPEG_STRUCTURAL_MARKERS.has(marker)) return true;
  if (marker === JPEG_APP0) return startsWithAscii(input, payload, 'JFIF\0');
  if (marker === JPEG_APP2) {
    return startsWithAscii(input, payload, 'ICC_PROFILE\0');
  }
  if (marker === JPEG_APP14) return startsWithAscii(input, payload, 'Adobe');
  return false;
};

/** Tìm marker kế tiếp sau dữ liệu quét (bỏ qua FF00, RSTn và byte đệm FF). */
const findNextMarker = (input: Buffer, from: number): number => {
  for (let index = from; index + 1 < input.length; index += 1) {
    if (input[index] !== JPEG_MARKER_PREFIX) continue;
    const next = input[index + 1];
    if (
      next === 0x00 ||
      next === JPEG_MARKER_PREFIX ||
      (next >= 0xd0 && next <= 0xd7)
    ) {
      continue;
    }
    return index;
  }
  return -1;
};

/**
 * JPEG: danh sách cho phép (SOI, JFIF, ICC, Adobe, bảng/khung/quét); dữ liệu quét giữ nguyên từng byte;
 * cắt ngay sau EOI đầu tiên (bỏ trailer, ảnh phụ MPF).
 */
const stripJpeg = (input: Buffer): Buffer => {
  if (input[0] !== JPEG_MARKER_PREFIX || input[1] !== JPEG_SOI) {
    throw new InvalidImageError('JPEG thiếu SOI');
  }
  const parts: Buffer[] = [input.subarray(0, 2)];
  let offset = 2;
  while (offset < input.length) {
    if (input[offset] !== JPEG_MARKER_PREFIX) {
      throw new InvalidImageError('JPEG sai cấu trúc đoạn');
    }
    const marker = input[offset + 1];
    if (marker === JPEG_MARKER_PREFIX) {
      offset += 1;
      continue;
    }
    if (marker === JPEG_EOI) {
      parts.push(input.subarray(offset, offset + 2));
      return Buffer.concat(parts);
    }
    // Marker không có độ dài (RST, TEM) ngoài dữ liệu quét: bỏ.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (offset + 4 > input.length) throw new InvalidImageError('JPEG bị cắt');
    const length = input.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > input.length) {
      throw new InvalidImageError('JPEG sai độ dài đoạn');
    }
    if (marker === JPEG_SOS) {
      const next = findNextMarker(input, end);
      if (next < 0) throw new InvalidImageError('JPEG thiếu EOI');
      parts.push(input.subarray(offset, next));
      offset = next;
      continue;
    }
    if (isAllowedJpegSegment(marker, input, offset + 4)) {
      parts.push(input.subarray(offset, end));
    }
    offset = end;
  }
  throw new InvalidImageError('JPEG thiếu EOI');
};

const PNG_SIGNATURE_LENGTH = 8;
/** Danh sách cho phép: chunk ảnh, màu, kích thước vật lý và APNG. Mọi chunk khác (eXIf, tEXt, caBX...) bị bỏ. */
const PNG_KEEP_CHUNKS = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'pHYs',
  'bKGD',
  'sBIT',
  'acTL',
  'fcTL',
  'fdAT',
]);

/** PNG: chỉ giữ chunk trong danh sách cho phép (kể cả CRC), dừng sau IEND. */
const stripPng = (input: Buffer): Buffer => {
  const parts: Buffer[] = [input.subarray(0, PNG_SIGNATURE_LENGTH)];
  let offset = PNG_SIGNATURE_LENGTH;
  let sawEnd = false;
  while (offset < input.length) {
    if (offset + 12 > input.length) throw new InvalidImageError('PNG bị cắt');
    const length = input.readUInt32BE(offset);
    const type = input.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > input.length) throw new InvalidImageError('PNG sai độ dài chunk');
    if (PNG_KEEP_CHUNKS.has(type)) parts.push(input.subarray(offset, end));
    offset = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new InvalidImageError('PNG thiếu IEND');
  return Buffer.concat(parts);
};

const WEBP_KEEP_CHUNKS = new Set([
  'VP8 ',
  'VP8L',
  'VP8X',
  'ALPH',
  'ANIM',
  'ANMF',
  'ICCP',
]);
/** Chunk con được phép bên trong ANMF (khung hình). */
const WEBP_FRAME_CHUNKS = new Set(['VP8 ', 'VP8L', 'ALPH']);
const WEBP_VP8X_EXIF_FLAG = 0x08;
const WEBP_VP8X_XMP_FLAG = 0x04;
const WEBP_ANMF_HEADER_LENGTH = 16;

const buildWebpChunk = (fourcc: string, payload: Buffer): Buffer => {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, 'latin1');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, Buffer.alloc(payload.length % 2)]);
};

/** Duyệt các chunk RIFF trong `input[start, limit)`; chỉ dựng lại chunk thuộc `allowed`. */
const collectWebpChunks = (
  input: Buffer,
  start: number,
  limit: number,
  allowed: Set<string>,
  rebuildAnmf: boolean,
): Buffer[] => {
  const chunks: Buffer[] = [];
  let offset = start;
  while (offset < limit) {
    if (offset + 8 > limit) throw new InvalidImageError('WebP bị cắt');
    const fourcc = input.toString('latin1', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    if (payloadStart + size > limit) {
      throw new InvalidImageError('WebP sai độ dài chunk');
    }
    if (allowed.has(fourcc)) {
      let payload = Buffer.from(
        input.subarray(payloadStart, payloadStart + size),
      );
      if (fourcc === 'VP8X' && size >= 1) {
        payload[0] &= ~(WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG);
      } else if (fourcc === 'ANMF' && rebuildAnmf) {
        if (size < WEBP_ANMF_HEADER_LENGTH) {
          throw new InvalidImageError('WebP ANMF quá ngắn');
        }
        const frame = collectWebpChunks(
          payload,
          WEBP_ANMF_HEADER_LENGTH,
          payload.length,
          WEBP_FRAME_CHUNKS,
          false,
        );
        payload = Buffer.concat([
          payload.subarray(0, WEBP_ANMF_HEADER_LENGTH),
          ...frame,
        ]);
      }
      chunks.push(buildWebpChunk(fourcc, payload));
    }
    offset = payloadStart + size + (size % 2);
  }
  return chunks;
};

/** WebP: chỉ giữ chunk ảnh/màu/hoạt ảnh, xóa cờ EXIF/XMP trong VP8X và tính lại kích thước RIFF. */
const stripWebp = (input: Buffer): Buffer => {
  if (
    input.length < 12 ||
    !startsWithAscii(input, 0, 'RIFF') ||
    !startsWithAscii(input, 8, 'WEBP')
  ) {
    throw new InvalidImageError('WebP sai header RIFF');
  }
  const chunks = collectWebpChunks(
    input,
    12,
    input.length,
    WEBP_KEEP_CHUNKS,
    true,
  );
  const body = Buffer.concat(chunks);
  const header = Buffer.from(input.subarray(0, 12));
  header.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([header, body]);
};

/**
 * Bỏ metadata (Exif/GPS, XMP, IPTC, chú thích) khỏi ảnh jpeg/png/webp mà KHÔNG giải mã lại điểm ảnh (không mất
 * chất lượng, không cần thư viện native). Chỉ giữ theo DANH SÁCH CHO PHÉP; điểm ảnh và bảng màu ICC được giữ nguyên.
 * Cấu trúc hỏng ⇒ ném `InvalidImageError` để từ chối thay vì lưu ảnh chưa chắc đã sạch metadata.
 */
export const stripImageMetadata = (input: Buffer, mimeType: string): Buffer => {
  switch (mimeType) {
    case 'image/jpeg':
      return stripJpeg(input);
    case 'image/png':
      return stripPng(input);
    case 'image/webp':
      return stripWebp(input);
    default:
      throw new InvalidImageError(`Không hỗ trợ ${mimeType}`);
  }
};
