import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CrmActor } from '../common/access/crm-actor';
import {
  assertAttachmentCount,
  assertCanModifyCareLog,
  assertOccurredAtNotFuture,
  canModifyCareLog,
  diffAttachmentIds,
} from './care-log.rules';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-23T12:00:00Z');
const actorOf = (role: UserRole, userId = new Types.ObjectId()): CrmActor => ({
  userId,
  role,
  displayName: 'x',
  teamId: null,
  managedTeamIds: [],
});
const logBy = (authorId: Types.ObjectId, hoursAgo: number) => ({
  authorId,
  createdAt: new Date(NOW.getTime() - hoursAgo * HOUR),
});

describe('care-log.rules', () => {
  describe('sửa/xóa nhật ký (ma trận 4.2)', () => {
    it('Nhân viên tác giả: được trong 24 giờ, đúng mốc 24 giờ vẫn được, quá mốc => CARE_LOG_EDIT_WINDOW_EXPIRED', () => {
      const staff = actorOf(UserRole.STAFF);

      expect(canModifyCareLog(staff, logBy(staff.userId, 23.9), NOW)).toBe(
        true,
      );
      expect(canModifyCareLog(staff, logBy(staff.userId, 24), NOW)).toBe(true);
      expect(() =>
        assertCanModifyCareLog(staff, logBy(staff.userId, 24.1), NOW),
      ).toThrow(
        expect.objectContaining({ errorCode: 'CARE_LOG_EDIT_WINDOW_EXPIRED' }),
      );
    });

    it('Nhân viên không phải tác giả: 403 dù nhật ký còn mới', () => {
      const staff = actorOf(UserRole.STAFF);
      expect(() =>
        assertCanModifyCareLog(staff, logBy(new Types.ObjectId(), 1), NOW),
      ).toThrow(expect.objectContaining({ status: 403 }));
    });

    it('Quản trị và Quản lý sửa mọi nhật ký, mọi lúc', () => {
      const old = logBy(new Types.ObjectId(), 24 * 90);
      expect(canModifyCareLog(actorOf(UserRole.ADMIN), old, NOW)).toBe(true);
      expect(canModifyCareLog(actorOf(UserRole.MANAGER), old, NOW)).toBe(true);
    });
  });

  it('occurredAt cho lệch đồng hồ 5 phút nhưng không được ở tương lai xa', () => {
    expect(() =>
      assertOccurredAtNotFuture(new Date(NOW.getTime() + 4 * 60_000), NOW),
    ).not.toThrow();
    expect(() =>
      assertOccurredAtNotFuture(new Date(NOW.getTime() + 6 * 60_000), NOW),
    ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
  });

  it('tối đa 5 ảnh/ghi chú, vượt => ATTACHMENT_LIMIT_EXCEEDED {max:5}', () => {
    expect(() => assertAttachmentCount(5)).not.toThrow();
    expect(() => assertAttachmentCount(6)).toThrow(
      expect.objectContaining({
        errorCode: 'ATTACHMENT_LIMIT_EXCEEDED',
        details: { max: 5 },
      }),
    );
  });

  it('diffAttachmentIds: ảnh mới cần gắn, ảnh vắng mặt cần gỡ, trùng id chỉ tính một lần', () => {
    const [a, b, c] = [1, 2, 3].map(() => new Types.ObjectId());

    const { toAttach, toDetach } = diffAttachmentIds([a, b], [b, c, c]);

    expect(toAttach.map(String)).toEqual([String(c)]);
    expect(toDetach.map(String)).toEqual([String(a)]);
  });
});
