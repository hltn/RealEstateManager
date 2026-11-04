import {
  MAX_ERROR_MESSAGE_LENGTH,
  sanitizeErrorMessage,
} from './migration-error.util';

describe('sanitizeErrorMessage', () => {
  it('lọc chuỗi kết nối mongodb:// (kể cả user:password)', () => {
    const message = sanitizeErrorMessage(
      new Error('connect mongodb://admin:s3cret@mongo:27017/db?x=1 failed'),
    );
    expect(message).not.toContain('s3cret');
    expect(message).not.toContain('admin');
    expect(message).not.toContain('mongodb://admin');
  });

  it('lọc cả mongodb+srv:// và không phân biệt hoa thường', () => {
    const message = sanitizeErrorMessage(
      'bad MongoDB+SRV://u:pw@cluster.example.net/db',
    );
    expect(message).not.toContain('pw@');
    expect(message).not.toContain('cluster.example.net');
  });

  it(`cắt còn tối đa ${MAX_ERROR_MESSAGE_LENGTH} ký tự`, () => {
    expect(sanitizeErrorMessage(new Error('x'.repeat(2000)))).toHaveLength(
      MAX_ERROR_MESSAGE_LENGTH,
    );
  });

  it('lọc TRƯỚC khi cắt: mật khẩu nằm sát điểm cắt không bị lộ', () => {
    const message = sanitizeErrorMessage(
      `${'a'.repeat(480)} mongodb://user:topsecretpassword@host/db`,
    );
    expect(message).not.toContain('topsecret');
    expect(message).not.toContain('user:');
  });

  it('lọc user:password@ ngay cả khi không còn tiền tố mongodb://', () => {
    const message = sanitizeErrorMessage(
      new Error('auth failed for qauser:Sup3rS3cret@mongo:27017 (admin)'),
    );
    expect(message).not.toContain('Sup3rS3cret');
    expect(message).not.toContain('qauser');
    expect(message).toContain('mongo:27017');
  });

  it('không làm hỏng thông điệp thường có dấu hai chấm (không có @)', () => {
    expect(sanitizeErrorMessage(new Error('E11000 duplicate key: a:b'))).toBe(
      'E11000 duplicate key: a:b',
    );
  });

  it('xử lý giá trị không phải Error', () => {
    expect(sanitizeErrorMessage('lỗi chuỗi')).toBe('lỗi chuỗi');
    expect(sanitizeErrorMessage(undefined)).toBe('Lỗi không xác định');
  });
});
