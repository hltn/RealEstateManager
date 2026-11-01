import {
  InvalidImageError,
  stripImageMetadata,
} from './strip-image-metadata.util';

const jpegSegment = (marker: number, payload: Buffer): Buffer => {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
};
const GPS = Buffer.from('Exif\0\0GPSLatitude=10.77;GPSLongitude=106.69');
const ICC = Buffer.from('ICC_PROFILE\0colors');
// SOS + dữ liệu nén có byte đệm 0xFF 0x00 (không được coi là marker) + EOI.
const SCAN = Buffer.concat([
  jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd9]),
]);

const png = (...chunks: Array<[string, Buffer]>): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks.map(([type, data]) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      return Buffer.concat([
        length,
        Buffer.from(type, 'ascii'),
        data,
        Buffer.alloc(4, 7), // CRC giả: bộ lọc không tính lại CRC nên phải giữ nguyên chunk
      ]);
    }),
  ]);

const webp = (...chunks: Array<[string, Buffer]>): Buffer => {
  const body = Buffer.concat(
    chunks.map(([fourcc, data]) => {
      const header = Buffer.alloc(8);
      header.write(fourcc, 0, 'ascii');
      header.writeUInt32LE(data.length, 4);
      return Buffer.concat([
        header,
        data,
        data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
      ]);
    }),
  );
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, body]);
};

describe('stripImageMetadata', () => {
  it('JPEG: bỏ APP1 (Exif/GPS), APP13, COM; giữ ICC và dữ liệu ảnh sau SOS nguyên vẹn', () => {
    const input = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe1, GPS),
      jpegSegment(0xe2, ICC),
      jpegSegment(0xed, Buffer.from('8BIM iptc')),
      jpegSegment(0xfe, Buffer.from('chú thích')),
      jpegSegment(0xdb, Buffer.alloc(65, 1)),
      SCAN,
    ]);

    const output = stripImageMetadata(input, 'image/jpeg');

    expect(output.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(output.includes(Buffer.from('iptc'))).toBe(false);
    expect(output.includes(Buffer.from('chú thích'))).toBe(false);
    expect(output.includes(ICC)).toBe(true);
    expect(output.subarray(output.length - SCAN.length).equals(SCAN)).toBe(
      true,
    );
    expect(output.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('JPEG hỏng (cắt giữa đoạn, thiếu SOS, không phải JPEG) bị từ chối', () => {
    const truncated = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe1, GPS),
    ]).subarray(0, 10);
    expect(() => stripImageMetadata(truncated, 'image/jpeg')).toThrow(
      InvalidImageError,
    );
    expect(() =>
      stripImageMetadata(
        Buffer.concat([
          Buffer.from([0xff, 0xd8]),
          jpegSegment(0xdb, Buffer.alloc(4)),
        ]),
        'image/jpeg',
      ),
    ).toThrow(InvalidImageError);
    expect(() =>
      stripImageMetadata(Buffer.from('not a jpeg'), 'image/jpeg'),
    ).toThrow(InvalidImageError);
  });

  it('PNG: bỏ eXIf/tEXt/iTXt/tIME, giữ IHDR/IDAT/IEND và CRC', () => {
    const keep: Array<[string, Buffer]> = [
      ['IHDR', Buffer.alloc(13, 2)],
      ['IDAT', Buffer.from('pixels')],
    ];
    const input = png(
      keep[0],
      ['eXIf', GPS],
      ['tEXt', Buffer.from('Comment\0GPS here')],
      ['iTXt', Buffer.from('XML:com.adobe.xmp')],
      ['tIME', Buffer.alloc(7)],
      keep[1],
      ['IEND', Buffer.alloc(0)],
    );

    const output = stripImageMetadata(input, 'image/png');

    expect(
      output.equals(png(keep[0], keep[1], ['IEND', Buffer.alloc(0)])),
    ).toBe(true);
  });

  it('PNG thiếu IEND bị từ chối', () => {
    expect(() =>
      stripImageMetadata(png(['IHDR', Buffer.alloc(13)]), 'image/png'),
    ).toThrow(InvalidImageError);
  });

  it('WebP: bỏ EXIF/XMP, xóa cờ trong VP8X và sửa kích thước RIFF', () => {
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04 | 0x10; // Exif + XMP + ICC
    const keepData = Buffer.from('bitstream!!');
    const input = webp(
      ['VP8X', vp8x],
      ['VP8 ', keepData],
      ['EXIF', GPS],
      ['XMP ', Buffer.from('<x:xmpmeta/>')],
    );

    const output = stripImageMetadata(input, 'image/webp');

    expect(output.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(output.includes(Buffer.from('xmpmeta'))).toBe(false);
    expect(output.includes(keepData)).toBe(true);
    expect(output.readUInt32LE(4)).toBe(output.length - 8);
    // byte cờ VP8X nằm ngay sau header chunk (12 + 8).
    expect(output[20]).toBe(0x10);
  });

  it('loại ảnh khác jpeg/png/webp bị từ chối', () => {
    expect(() => stripImageMetadata(Buffer.alloc(20), 'image/gif')).toThrow(
      InvalidImageError,
    );
  });
});
