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

const NOW = new Date('2026-10-23T12:00:00Z');
const DAY = 86_400_000;
const actorOf = (role: UserRole, userId = new Types.ObjectId()): CrmActor => ({
  userId,
  role,
  roles: [role],
  displayName: 'x',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
});
const logBy = (authorId: Types.ObjectId, daysAgo: number) => ({
  authorId,
  createdAt: new Date(NOW.getTime() - daysAgo * DAY),
});

describe('care-log.rules', () => {
  describe('sửa/xóa nhật ký (ma trận 4.2)', () => {
    it('Nhân viên tác giả: luôn được, kể cả nhật ký rất cũ (PT-022: không còn cửa sổ 24 giờ)', () => {
      const staff = actorOf(UserRole.STAFF);

      for (const daysAgo of [0, 1, 1.1, 30, 365 * 3]) {
        const log = logBy(staff.userId, daysAgo);
        expect(canModifyCareLog(staff, log)).toBe(true);
        expect(() => assertCanModifyCareLog(staff, log)).not.toThrow();
      }
    });

    it('Nhân viên không phải tác giả: 403, mới hay cũ đều vậy', () => {
      const staff = actorOf(UserRole.STAFF);

      for (const daysAgo of [0, 1, 365]) {
        const log = logBy(new Types.ObjectId(), daysAgo);
        expect(canModifyCareLog(staff, log)).toBe(false);
        expect(() => assertCanModifyCareLog(staff, log)).toThrow(
          expect.objectContaining({ status: 403 }),
        );
      }
    });

    it('Quản trị và Quản lý sửa mọi nhật ký, mọi lúc', () => {
      const old = logBy(new Types.ObjectId(), 90);
      for (const role of [UserRole.ADMIN, UserRole.MANAGER]) {
        const actor = actorOf(role);
        expect(canModifyCareLog(actor, old)).toBe(true);
        expect(() => assertCanModifyCareLog(actor, old)).not.toThrow();
      }
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
