/**
 * QA bổ sung cho `stripImageMetadata`: fuzz (không crash, không treo) và các đường lọt metadata mà bộ test gốc chưa phủ.
 * Các ca từng là lỗi đã xác nhận ở review QA M3, nay đã sửa.
 */
import {
  InvalidImageError,
  stripImageMetadata,
} from './strip-image-metadata.util';

const SECRET = Buffer.from('GPSLatitude=10.77;GPSLongitude=106.70');
const contains = (out: Buffer, needle: Buffer) => out.includes(needle);

const segment = (marker: number, payload: Buffer): Buffer => {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
};

const jpeg = (opts: {
  before?: Buffer[];
  scan?: Buffer;
  trailer?: Buffer;
}): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...(opts.before ?? []),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    opts.scan ?? Buffer.from([0x12, 0x34, 0x56]),
    Buffer.from([0xff, 0xd9]),
    opts.trailer ?? Buffer.alloc(0),
  ]);

const chunk = (type: string, data: Buffer): Buffer => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  return out;
};

const png = (extra: Buffer[] = [], trailer = Buffer.alloc(0)): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    ...extra,
    chunk('IDAT', Buffer.from([1, 2, 3])),
    chunk('IEND', Buffer.alloc(0)),
    trailer,
  ]);

const webpChunk = (fourcc: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'ascii');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([
    head,
    data,
    data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
};

const webp = (chunks: Buffer[]): Buffer => {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};

const SEEDS: Array<[string, Buffer]> = [
  ['image/jpeg', jpeg({ before: [segment(0xe1, SECRET)] })],
  ['image/png', png([chunk('tEXt', SECRET)])],
  [
    'image/webp',
    webp([
      webpChunk('VP8X', Buffer.alloc(10, 0x0c)),
      webpChunk('EXIF', SECRET),
      webpChunk('VP8 ', Buffer.alloc(20, 7)),
    ]),
  ],
];

/** PRNG có hạt giống để lần chạy lặp lại được. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('stripImageMetadata — fuzz', () => {
  it.each(SEEDS)(
    '%s: 3000 biến thể hỏng/đột biến chỉ trả Buffer hoặc InvalidImageError, không ném lỗi khác, không treo',
    (mime, seed) => {
      const random = rng(mime.length * 7919);
      const started = Date.now();
      for (let index = 0; index < 3000; index += 1) {
        const data = Buffer.from(seed);
        const flips = 1 + Math.floor(random() * 6);
        for (let flip = 0; flip < flips; flip += 1) {
          data[Math.floor(random() * data.length)] = Math.floor(random() * 256);
        }
        const cut =
          random() < 0.2
            ? 12 + Math.floor(random() * (data.length - 12))
            : data.length;
        try {
          const out = stripImageMetadata(data.subarray(0, cut), mime);
          expect(Buffer.isBuffer(out)).toBe(true);
          expect(out.length).toBeLessThanOrEqual(data.length + 16);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidImageError);
        }
      }
      expect(Date.now() - started).toBeLessThan(10_000);
    },
  );

  it('độ dài khai báo cực lớn (0xFFFFFFFF / 0xFFFF) bị từ chối, không cấp phát bộ nhớ', () => {
    const hugePng = png();
    hugePng.writeUInt32BE(0xffffffff, 8);
    expect(() => stripImageMetadata(hugePng, 'image/png')).toThrow(
      InvalidImageError,
    );
    const hugeWebp = webp([webpChunk('VP8 ', Buffer.alloc(8))]);
    hugeWebp.writeUInt32LE(0xffffffff, 16);
    expect(() => stripImageMetadata(hugeWebp, 'image/webp')).toThrow(
      InvalidImageError,
    );
    const hugeJpeg = jpeg({ before: [segment(0xe1, Buffer.alloc(4))] });
    hugeJpeg.writeUInt16BE(0xffff, 2 + 18 + 2);
    expect(() => stripImageMetadata(hugeJpeg, 'image/jpeg')).toThrow(
      InvalidImageError,
    );
  });
});

describe('stripImageMetadata — metadata còn lọt', () => {
  it('PNG: dữ liệu thừa sau IEND bị bỏ', () => {
    expect(
      contains(stripImageMetadata(png([], SECRET), 'image/png'), SECRET),
    ).toBe(false);
  });

  it('JPEG: dữ liệu/Exif đính thêm SAU EOI (trailer, ảnh phụ MPF) phải bị cắt bỏ', () => {
    const out = stripImageMetadata(
      jpeg({
        trailer: Buffer.concat([
          Buffer.from([0xff, 0xd8]),
          segment(0xe1, SECRET),
          Buffer.from([0xff, 0xd9]),
        ]),
      }),
      'image/jpeg',
    );
    expect(contains(out, SECRET)).toBe(false);
  });

  it('JPEG: các đoạn APPn khác chứa metadata (APP3 Meta, APP11 JUMBF/C2PA) phải bị bỏ (danh sách cho phép, không phải danh sách chặn)', () => {
    const out = stripImageMetadata(
      jpeg({ before: [segment(0xe3, SECRET), segment(0xeb, SECRET)] }),
      'image/jpeg',
    );
    expect(contains(out, SECRET)).toBe(false);
  });

  it('PNG: chunk phụ không biết (private/ancillary như caBX C2PA, prVW) phải bị bỏ', () => {
    const out = stripImageMetadata(
      png([chunk('caBX', SECRET), chunk('prVW', SECRET)]),
      'image/png',
    );
    expect(contains(out, SECRET)).toBe(false);
  });

  it('WebP: chunk không biết phải bị bỏ (chỉ giữ VP8/VP8L/VP8X/ALPH/ANIM/ANMF/ICCP)', () => {
    const out = stripImageMetadata(
      webp([
        webpChunk('VP8X', Buffer.alloc(10)),
        webpChunk('XYZW', SECRET),
        webpChunk('VP8 ', Buffer.alloc(8)),
      ]),
      'image/webp',
    );
    expect(contains(out, SECRET)).toBe(false);
  });

  it('JPEG chuẩn: APP1/APP13/COM bị bỏ và kết quả vẫn là JPEG hợp lệ (SOI ... EOI)', () => {
    const out = stripImageMetadata(
      jpeg({
        before: [
          segment(0xe1, SECRET),
          segment(0xed, SECRET),
          segment(0xfe, SECRET),
        ],
      }),
      'image/jpeg',
    );
    expect(contains(out, SECRET)).toBe(false);
    expect([out[0], out[1], out[out.length - 2], out[out.length - 1]]).toEqual([
      0xff, 0xd8, 0xff, 0xd9,
    ]);
  });
});

describe('stripImageMetadata — danh sách cho phép', () => {
  it('WebP ngắn hơn 8 byte ném InvalidImageError (không RangeError)', () => {
    for (const length of [0, 3, 7, 11]) {
      expect(() =>
        stripImageMetadata(Buffer.alloc(length), 'image/webp'),
      ).toThrow(InvalidImageError);
    }
  });

  it('JPEG: APP2 MPF bị bỏ, APP2 ICC được giữ', () => {
    const icc = segment(
      0xe2,
      Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([1, 1])]),
    );
    const mpf = segment(0xe2, Buffer.concat([Buffer.from('MPF\0'), SECRET]));
    const out = stripImageMetadata(jpeg({ before: [mpf, icc] }), 'image/jpeg');
    expect(contains(out, SECRET)).toBe(false);
    expect(contains(out, Buffer.from('ICC_PROFILE\0'))).toBe(true);
  });

  it('JPEG nhiều lần quét (progressive): giữ DHT/SOS thứ hai trước EOI, cắt trailer', () => {
    const second = Buffer.concat([
      segment(0xc4, Buffer.from([0, 1, 2])),
      segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
      Buffer.from([0xff, 0x00, 0x99]),
    ]);
    const base = jpeg({
      scan: Buffer.concat([
        Buffer.from([0x12, 0xff, 0x00, 0xff, 0xd0, 0x34]),
        second,
      ]),
      trailer: SECRET,
    });
    const out = stripImageMetadata(base, 'image/jpeg');
    expect(contains(out, SECRET)).toBe(false);
    expect(contains(out, Buffer.from([0x99, 0xff, 0xd9]))).toBe(true);
    expect(contains(out, Buffer.from([0xff, 0xc4]))).toBe(true);
  });

  it('WebP: bỏ cờ EXIF/XMP, chunk lạ trong ANMF bị bỏ và RIFF size khớp', () => {
    const anmfPayload = Buffer.concat([
      Buffer.alloc(16),
      webpChunk('VP8 ', Buffer.alloc(8, 5)),
      webpChunk('EXIF', SECRET),
    ]);
    const input = webp([
      webpChunk('VP8X', Buffer.alloc(10, 0xff)),
      webpChunk('EXIF', SECRET),
      webpChunk('ANMF', anmfPayload),
    ]);
    const out = stripImageMetadata(input, 'image/webp');
    expect(contains(out, SECRET)).toBe(false);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out[20] & 0x0c).toBe(0);
    expect(out[20] & 0x02).toBe(0x02);
  });
});
