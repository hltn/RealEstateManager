import { BusinessException } from '../../common/exceptions/business.exception';
import {
  ATTACHMENT_IMAGE_POLICY,
  IMPORT_FILE_POLICY,
  assertFileAllowed,
  assertSafeKey,
  extensionForMime,
} from './file-validation';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP'),
]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

function expectRejected(fn: () => void, status: number, errorCode: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).getStatus()).toBe(status);
    expect((error as BusinessException).errorCode).toBe(errorCode);
    return;
  }
  throw new Error('Kỳ vọng assertFileAllowed ném lỗi nhưng không ném');
}

describe('assertFileAllowed', () => {
  describe('ảnh đính kèm (jpeg/png/webp, ≤ 5 MB)', () => {
    it.each([
      ['image/jpeg', JPEG],
      ['image/png', PNG],
      ['image/webp', WEBP],
    ])('chấp nhận %s có magic bytes đúng', (mimeType, buffer) => {
      expect(() =>
        assertFileAllowed(ATTACHMENT_IMAGE_POLICY, {
          mimeType,
          size: buffer.length,
          buffer,
        }),
      ).not.toThrow();
    });

    it('MIME kèm tham số và khác hoa/thường vẫn được chuẩn hóa', () => {
      expect(() =>
        assertFileAllowed(ATTACHMENT_IMAGE_POLICY, {
          mimeType: 'IMAGE/JPEG; charset=binary',
          size: JPEG.length,
          buffer: JPEG,
        }),
      ).not.toThrow();
    });

    it.each(['image/gif', 'application/pdf', 'text/html', 'image/svg+xml'])(
      'từ chối MIME %s bằng 415 ATTACHMENT_TYPE_INVALID',
      (mimeType) => {
        expectRejected(
          () =>
            assertFileAllowed(ATTACHMENT_IMAGE_POLICY, { mimeType, size: 100 }),
          415,
          'ATTACHMENT_TYPE_INVALID',
        );
      },
    );

    it('từ chối file giả mạo: khai báo image/png nhưng nội dung là jpeg', () => {
      expectRejected(
        () =>
          assertFileAllowed(ATTACHMENT_IMAGE_POLICY, {
            mimeType: 'image/png',
            size: JPEG.length,
            buffer: JPEG,
          }),
        415,
        'ATTACHMENT_TYPE_INVALID',
      );
    });

    it('từ chối script đội lốt ảnh (đuôi/MIME ảnh, nội dung HTML)', () => {
      const html = Buffer.from('<script>alert(1)</script>');
      expectRejected(
        () =>
          assertFileAllowed(ATTACHMENT_IMAGE_POLICY, {
            mimeType: 'image/jpeg',
            size: html.length,
            buffer: html,
          }),
        415,
        'ATTACHMENT_TYPE_INVALID',
      );
    });

    it('biên dung lượng: đúng 5 MB được, 5 MB + 1 byte bị 413 kèm maxBytes', () => {
      const max = ATTACHMENT_IMAGE_POLICY.maxSizeBytes;
      expect(() =>
        assertFileAllowed(ATTACHMENT_IMAGE_POLICY, {
          mimeType: 'image/jpeg',
          size: max,
        }),
      ).not.toThrow();

      try {
        assertFileAllowed(ATTACHMENT_IMAGE_POLICY, {
          mimeType: 'image/jpeg',
          size: max + 1,
        });
        throw new Error('phải ném lỗi');
      } catch (error) {
        const exception = error as BusinessException;
        expect(exception.getStatus()).toBe(413);
        expect(exception.errorCode).toBe('FILE_TOO_LARGE');
        expect(exception.details).toEqual({ maxBytes: max });
      }
    });

    it('file rỗng bị từ chối như sai loại', () => {
      expectRejected(
        () =>
          assertFileAllowed(ATTACHMENT_IMAGE_POLICY, {
            mimeType: 'image/png',
            size: 0,
          }),
        415,
        'ATTACHMENT_TYPE_INVALID',
      );
    });
  });

  describe('file import (csv/xlsx, ≤ 10 MB)', () => {
    const XLSX =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    it('chấp nhận xlsx đúng chữ ký ZIP và csv dạng văn bản', () => {
      expect(() =>
        assertFileAllowed(IMPORT_FILE_POLICY, {
          mimeType: XLSX,
          size: ZIP.length,
          buffer: ZIP,
        }),
      ).not.toThrow();
      const csv = Buffer.from('ten,sdt\nA,0912345678\n');
      expect(() =>
        assertFileAllowed(IMPORT_FILE_POLICY, {
          mimeType: 'text/csv',
          size: csv.length,
          buffer: csv,
        }),
      ).not.toThrow();
    });

    it('từ chối "csv" thực chất là nhị phân (có byte NUL) bằng IMPORT_FILE_TYPE_INVALID', () => {
      const binary = Buffer.from([0x4d, 0x5a, 0x00, 0x03]);
      expectRejected(
        () =>
          assertFileAllowed(IMPORT_FILE_POLICY, {
            mimeType: 'text/csv',
            size: binary.length,
            buffer: binary,
          }),
        415,
        'IMPORT_FILE_TYPE_INVALID',
      );
    });

    it('từ chối xlsx không có chữ ký ZIP', () => {
      const fake = Buffer.from('not a zip');
      expectRejected(
        () =>
          assertFileAllowed(IMPORT_FILE_POLICY, {
            mimeType: XLSX,
            size: fake.length,
            buffer: fake,
          }),
        415,
        'IMPORT_FILE_TYPE_INVALID',
      );
    });
  });
});

describe('extensionForMime', () => {
  it('suy phần mở rộng từ MIME đã kiểm; MIME lạ thì .bin (không bao giờ dùng tên file client)', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('IMAGE/WEBP; x=y')).toBe('webp');
    expect(extensionForMime('application/x-evil')).toBe('bin');
  });
});

describe('assertSafeKey', () => {
  it.each([
    'a.jpg',
    'customers/c1/3f2b8c1e-aaaa-bbbb-cccc-0123456789ab.jpg',
    'exports/2026-10/file_1.csv',
    'a..b.jpg', // ".." nằm trong tên chứ không phải cả segment thì hợp lệ
  ])('chấp nhận khóa hợp lệ %p', (key) => {
    expect(() => assertSafeKey(key)).not.toThrow();
  });

  it.each([
    ['path traversal', '../secret.jpg'],
    ['traversal giữa đường dẫn', 'customers/../../etc/passwd'],
    ['segment dấu chấm', 'customers/./x.jpg'],
    ['bắt đầu bằng /', '/etc/passwd'],
    ['hai dấu // liên tiếp', 'customers//x.jpg'],
    ['kết thúc bằng /', 'customers/'],
    ['rỗng', ''],
    ['bắt đầu bằng dấu chấm (file ẩn)', '.env'],
    ['ký tự điều khiển/xuống dòng', 'a\nb.jpg'],
    ['khoảng trắng', 'a b.jpg'],
    ['backslash kiểu Windows', 'a\\b.jpg'],
    ['ký tự %2e đã mã hóa', 'a/%2e%2e/b.jpg'],
    ['quá dài (> 1024)', 'a'.repeat(1025)],
  ])('từ chối khóa nguy hiểm: %s', (_label, key) => {
    expect(() => assertSafeKey(key)).toThrow(
      'Khóa object lưu trữ không hợp lệ',
    );
  });

  it('giá trị không phải chuỗi cũng bị từ chối', () => {
    expect(() => assertSafeKey(undefined as unknown as string)).toThrow(
      'Khóa object lưu trữ không hợp lệ',
    );
  });
});
