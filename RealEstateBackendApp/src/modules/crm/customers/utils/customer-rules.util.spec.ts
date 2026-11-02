import { Types } from 'mongoose';
import { ListGroup } from '../../catalogs/catalog.enums';
import {
  computeProgress,
  crossesAutoStatusThreshold,
  decideAutoStatus,
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

describe('decideAutoStatus (PT-023)', () => {
  const decide = (
    prevProgress: number,
    nextProgress: number,
    over: Partial<{
      currentGroup: ListGroup;
      currentCode: string;
      isAutoSet: boolean;
    }> = {},
  ) =>
    decideAutoStatus({
      prevProgress,
      nextProgress,
      currentGroup: ListGroup.INTERESTED,
      currentCode: 'INTERESTED',
      isAutoSet: false,
      ...over,
    });

  describe('vượt lên đúng 3/4 (75)', () => {
    it.each([
      [ListGroup.NOT_CONTACTED, 'NOT_CONTACTED'],
      [ListGroup.INTERESTED, 'INTERESTED'],
    ])('từ nhóm %s -> NET', (currentGroup, currentCode) => {
      expect(decide(50, 75, { currentGroup, currentCode })).toBe('NET');
    });

    it.each([0, 25, 50])('từ %i lên 75 -> NET', (prev) => {
      expect(decide(prev, 75)).toBe('NET');
    });

    it('NET (đổi tay) / DROPPED -> null', () => {
      expect(
        decide(50, 75, { currentGroup: ListGroup.NET, currentCode: 'NET' }),
      ).toBeNull();
      expect(
        decide(50, 75, {
          currentGroup: ListGroup.DROPPED,
          currentCode: 'DROPPED',
        }),
      ).toBeNull();
    });

    it('tình trạng tùy biến thuộc nhóm NET/DROPPED cũng không bị đè', () => {
      expect(
        decide(50, 75, { currentGroup: ListGroup.NET, currentCode: 'HOT_NET' }),
      ).toBeNull();
    });

    it('50->100 và 0->100 (4/4) -> null', () => {
      expect(decide(50, 100)).toBeNull();
      expect(decide(0, 100)).toBeNull();
    });

    it('100->75 (đang ở 4/4 rồi hạ) -> null, không đè tình trạng đã đổi tay', () => {
      expect(decide(100, 75)).toBeNull();
    });

    it('tiến độ không đổi ở 75 (sửa mô tả) -> null', () => {
      expect(decide(75, 75)).toBeNull();
    });
  });

  describe('xuống dưới 3/4', () => {
    const autoNet = {
      currentGroup: ListGroup.NET,
      currentCode: 'NET',
      isAutoSet: true,
    };

    it.each([
      [75, 50],
      [75, 25],
      [75, 0],
      [100, 50],
    ])('%i -> %i với NET tự đặt -> INTERESTED', (prev, next) => {
      expect(decide(prev, next, autoNet)).toBe('INTERESTED');
    });

    it('cùng ca nhưng NET đổi tay (isAutoSet=false) -> null', () => {
      expect(decide(75, 50, { ...autoNet, isAutoSet: false })).toBeNull();
    });

    it('khách NET sẵn có (không marker) hạ xuống -> null', () => {
      expect(decide(100, 25, { ...autoNet, isAutoSet: false })).toBeNull();
    });

    it('DROPPED hạ tiêu chí -> null (kể cả isAutoSet còn sót)', () => {
      expect(
        decide(75, 50, {
          currentGroup: ListGroup.DROPPED,
          currentCode: 'DROPPED',
          isAutoSet: true,
        }),
      ).toBeNull();
    });

    it('NET tự đặt nhưng hạ từ dưới 75 (không qua mốc) -> null', () => {
      expect(decide(50, 25, autoNet)).toBeNull();
    });
  });

  it('tiến độ tăng/giảm trong vùng dưới 75 (25->50, 50->25) -> null', () => {
    expect(decide(25, 50)).toBeNull();
    expect(decide(50, 25)).toBeNull();
  });
});

describe('decideAutoStatus — ma trận đầy đủ prev x next x nhóm x marker (PT-023)', () => {
  const STEPS = [0, 25, 50, 75, 100] as const;
  const GROUPS = [
    [ListGroup.NOT_CONTACTED, 'NOT_CONTACTED'],
    [ListGroup.INTERESTED, 'INTERESTED'],
    [ListGroup.NET, 'NET'],
    [ListGroup.DROPPED, 'DROPPED'],
  ] as const;

  // Kỳ vọng viết tay (KHÔNG suy ra từ chính hàm): chỉ 3 cặp lên 75 và 4 cặp xuống dưới 75 là có tự chuyển.
  const UP = new Set(['0>75', '25>75', '50>75']);
  const DOWN = new Set(['75>0', '75>25', '75>50', '100>0', '100>25', '100>50']);

  it.each(
    STEPS.flatMap((prev) =>
      STEPS.flatMap((next) =>
        GROUPS.flatMap(([group, code]) =>
          [false, true].map(
            (isAutoSet) => [prev, next, group, code, isAutoSet] as const,
          ),
        ),
      ),
    ),
  )(
    '%i -> %i, nhóm %s (%s), tự đặt=%s',
    (prev, next, group, code, isAutoSet) => {
      const pair = `${prev}>${next}`;
      let expected: 'NET' | 'INTERESTED' | null = null;
      if (
        UP.has(pair) &&
        (group === ListGroup.NOT_CONTACTED || group === ListGroup.INTERESTED)
      ) {
        expected = 'NET';
      } else if (DOWN.has(pair) && group === ListGroup.NET && isAutoSet) {
        expected = 'INTERESTED';
      }
      expect(
        decideAutoStatus({
          prevProgress: prev,
          nextProgress: next,
          currentGroup: group,
          currentCode: code,
          isAutoSet,
        }),
      ).toBe(expected);
    },
  );

  it('NET tự đặt nhưng mã khác NET (tình trạng tùy biến nhóm NET) -> không lùi', () => {
    expect(
      decideAutoStatus({
        prevProgress: 75,
        nextProgress: 50,
        currentGroup: ListGroup.NET,
        currentCode: 'HOT_NET',
        isAutoSet: true,
      }),
    ).toBeNull();
  });
});

describe('crossesAutoStatusThreshold (PT-023)', () => {
  it.each([
    [0, 75, true],
    [25, 75, true],
    [50, 75, true],
    [75, 50, true],
    [75, 0, true],
    [100, 50, true],
    [0, 25, false],
    [25, 50, false],
    [50, 25, false],
    [75, 75, false],
    [75, 100, false],
    [100, 75, false],
    [0, 100, false],
    [50, 100, false],
  ])('%i -> %i = %s', (prev, next, expected) => {
    expect(crossesAutoStatusThreshold(prev, next)).toBe(expected);
  });
});
