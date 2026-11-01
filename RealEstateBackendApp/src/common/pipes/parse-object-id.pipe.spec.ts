import { BadRequestException } from '@nestjs/common';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();

  it('trả nguyên ObjectId hợp lệ', () => {
    expect(pipe.transform('65e1f0a1b2c3d4e5f6a7b8c9')).toBe(
      '65e1f0a1b2c3d4e5f6a7b8c9',
    );
  });

  it.each(['abc', '65e1f0a1b2c3d4e5f6a7b8c', '12 chars str', '$ne', ''])(
    'từ chối %p bằng 400 (không để lọt xuống thành lỗi 500 của BSON)',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});
