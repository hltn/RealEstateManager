import {
  findPhaseOrderViolation,
  getMigrationPhase,
  matchesPhase,
} from './migration-phase';
import type { PendingPhaseInfo } from './migration-phase';

const pre = (id: string): PendingPhaseInfo => ({ id, phase: 'pre-up' });
const post = (id: string): PendingPhaseInfo => ({ id, phase: 'post-up' });

describe('migration-phase (FR-21)', () => {
  it('FR-21: getMigrationPhase mặc định pre-up, giữ post-up khi khai báo', () => {
    expect(getMigrationPhase({})).toBe('pre-up');
    expect(getMigrationPhase({ phase: 'post-up' })).toBe('post-up');
  });

  it('FR-21: matchesPhase - all nhận mọi pha, còn lại chỉ nhận đúng pha', () => {
    expect(matchesPhase('pre-up', 'all')).toBe(true);
    expect(matchesPhase('post-up', 'all')).toBe(true);
    expect(matchesPhase('pre-up', 'pre-up')).toBe(true);
    expect(matchesPhase('post-up', 'pre-up')).toBe(false);
    expect(matchesPhase('pre-up', 'post-up')).toBe(false);
  });

  describe('findPhaseOrderViolation', () => {
    it('FR-21: từ chối khi chạy pre-up mà post-up chờ nhỏ hơn pre-up chờ, thông báo "--phase post-up"', () => {
      const message = findPhaseOrderViolation(
        [post('011_x'), pre('012_y')],
        'pre-up',
      );
      expect(message).toContain('011_x');
      expect(message).toContain('012_y');
      expect(message).toContain('--phase post-up');
    });

    it('FR-21: không từ chối khi post-up chờ LỚN hơn mọi pre-up chờ (kịch bản deploy 010 + 011)', () => {
      expect(
        findPhaseOrderViolation([pre('010_a'), post('011_b')], 'pre-up'),
      ).toBeNull();
    });

    it('FR-21: biên - post-up nhỏ hơn nhưng không còn pre-up nào chờ thì hợp lệ', () => {
      expect(findPhaseOrderViolation([post('011_b')], 'pre-up')).toBeNull();
    });

    it('FR-21: pre-up chờ chen giữa hai post-up: chỉ cần một post-up nhỏ hơn là từ chối', () => {
      expect(
        findPhaseOrderViolation(
          [post('010_a'), pre('011_b'), post('012_c')],
          'pre-up',
        ),
      ).toContain('010_a');
    });

    it('FR-21: pha all không bao giờ bị từ chối (chạy theo thứ tự số), kể cả khi cả hai chiều đều lệch', () => {
      expect(
        findPhaseOrderViolation([post('011_x'), pre('012_y')], 'all'),
      ).toBeNull();
      expect(
        findPhaseOrderViolation([pre('010_x'), post('011_y')], 'all'),
      ).toBeNull();
      expect(
        findPhaseOrderViolation(
          [pre('010_a'), post('011_b'), pre('012_c')],
          'all',
        ),
      ).toBeNull();
    });

    it('FR-21: chiều post-up - từ chối khi còn pre-up chờ nhỏ hơn post-up chờ (010 chưa chạy mà chạy 011), nêu "--phase pre-up"', () => {
      const message = findPhaseOrderViolation(
        [pre('010_a'), post('011_b')],
        'post-up',
      );
      expect(message).toContain('010_a');
      expect(message).toContain('011_b');
      expect(message).toContain('--phase pre-up');
      expect(message).toContain('lỗ hổng sổ');
    });

    it('FR-21: chiều post-up - hợp lệ khi mọi pre-up chờ LỚN hơn post-up chờ (post-up chạy trước)', () => {
      expect(
        findPhaseOrderViolation([post('011_b'), pre('012_c')], 'post-up'),
      ).toBeNull();
    });

    it('FR-21: chiều post-up - hợp lệ khi không còn pre-up nào chờ (deploy: 010 đã ghi sổ rồi mới chạy 011)', () => {
      expect(findPhaseOrderViolation([post('011_b')], 'post-up')).toBeNull();
    });

    it('FR-21: chiều post-up - pre-up nhỏ nhất bị nêu tên dù có nhiều pre-up chờ, và lệnh khuyên chạy trước là pre-up', () => {
      const message = findPhaseOrderViolation(
        [pre('009_z'), pre('007_a'), post('011_b')],
        'post-up',
      );
      expect(message).toContain('007_a');
      expect(message).not.toContain('009_z');
      expect(message).toContain('chạy `--phase pre-up` trước');
    });

    it('FR-21: pha pre-up hết việc (chỉ còn post-up) hoặc post-up hết việc (chỉ còn pre-up) thì không từ chối', () => {
      expect(findPhaseOrderViolation([post('009_a')], 'pre-up')).toBeNull();
      expect(findPhaseOrderViolation([pre('012_a')], 'post-up')).toBeNull();
    });

    it('FR-21: không có migration chờ thì hợp lệ ở cả ba pha', () => {
      expect(findPhaseOrderViolation([], 'pre-up')).toBeNull();
      expect(findPhaseOrderViolation([], 'post-up')).toBeNull();
      expect(findPhaseOrderViolation([], 'all')).toBeNull();
    });
  });
});
