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

    it('FR-21: chỉ áp cho pha pre-up (post-up và all không bị từ chối)', () => {
      const pending = [post('011_x'), pre('012_y')];
      expect(findPhaseOrderViolation(pending, 'post-up')).toBeNull();
      expect(findPhaseOrderViolation(pending, 'all')).toBeNull();
    });

    it('FR-21: danh sách rỗng hợp lệ', () => {
      expect(findPhaseOrderViolation([], 'pre-up')).toBeNull();
    });
  });
});
