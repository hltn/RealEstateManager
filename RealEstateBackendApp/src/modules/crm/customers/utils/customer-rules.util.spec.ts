import { Types } from 'mongoose';
import {
  computeProgress,
  mergeCriteria,
  NATIONAL_ID_PATTERN,
  nationalIdAad,
} from './customer-rules.util';

describe('computeProgress', () => {
  it('mỗi tiêu chí hoàn thành = 25%', () => {
    expect(computeProgress({})).toBe(0);
    expect(computeProgress({ demand: { isDone: true } })).toBe(25);
    expect(
      computeProgress({
        demand: { isDone: true },
        finance: { isDone: true },
        timing: { isDone: true },
      }),
    ).toBe(75);
    expect(
      computeProgress({
        demand: { isDone: true },
        motivation: { isDone: true },
        finance: { isDone: true },
        timing: { isDone: true },
      }),
    ).toBe(100);
  });
});

describe('mergeCriteria', () => {
  const actor = new Types.ObjectId();
  const now = new Date('2026-10-23T00:00:00Z');

  it('chỉ tiêu chí THỰC SỰ đổi mới được ghi người/ngày cập nhật', () => {
    const earlier = new Date('2026-01-01T00:00:00Z');
    const other = new Types.ObjectId();
    const { next, changedKeys } = mergeCriteria(
      {
        demand: {
          isDone: true,
          description: 'cũ',
          updatedBy: other,
          updatedAt: earlier,
        },
      },
      {
        demand: { isDone: true, description: 'cũ' },
        finance: { isDone: true },
      },
      actor,
      now,
    );
    expect(changedKeys).toEqual(['finance']);
    expect(next.demand.updatedBy).toBe(other);
    expect(next.demand.updatedAt).toBe(earlier);
    expect(next.finance).toMatchObject({
      isDone: true,
      updatedBy: actor,
      updatedAt: now,
    });
  });

  it('gửi lại đúng giá trị cũ là no-op', () => {
    const { changedKeys } = mergeCriteria(
      { timing: { isDone: false, description: '' } },
      { timing: { isDone: false } },
      actor,
      now,
    );
    expect(changedKeys).toEqual([]);
  });

  it('chỉ sửa mô tả không làm đổi isDone', () => {
    const { next, changedKeys } = mergeCriteria(
      { motivation: { isDone: true, description: 'a' } },
      { motivation: { description: 'b' } },
      actor,
      now,
    );
    expect(changedKeys).toEqual(['motivation']);
    expect(next.motivation).toMatchObject({ isDone: true, description: 'b' });
  });
});

describe('CCCD', () => {
  it('chỉ nhận 9 hoặc 12 chữ số', () => {
    expect(NATIONAL_ID_PATTERN.test('012345678901')).toBe(true);
    expect(NATIONAL_ID_PATTERN.test('012345678')).toBe(true);
    expect(NATIONAL_ID_PATTERN.test('0123456789')).toBe(false);
    expect(NATIONAL_ID_PATTERN.test('01234567890a')).toBe(false);
  });

  it('AAD gắn bản mã với đúng khách và đúng trường', () => {
    expect(nationalIdAad('abc')).toBe('abc:nationalId');
  });
});
