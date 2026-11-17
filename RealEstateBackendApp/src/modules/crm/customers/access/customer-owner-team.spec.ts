import { Types } from 'mongoose';
import {
  isCreator,
  isOwnerManager,
  ownerTeamIdsOf,
} from './customer-owner-team';

const id = () => new Types.ObjectId();

describe('customer-owner-team (FR-30, FR-32)', () => {
  describe('ownerTeamIdsOf', () => {
    it('FR-30: nhóm chủ = nhóm của người tạo (teamIds hợp teamId, khử trùng), bỏ qua customer.teamIds', () => {
      const [t1, t2, other] = [id(), id(), id()];
      const customer = { createdBy: id(), teamIds: [other] };
      expect(
        ownerTeamIdsOf(customer, { teamId: t1, teamIds: [t1, t2] }).map(String),
      ).toEqual([String(t1), String(t2)]);
    });

    it('FR-30: nhóm chủ cố định theo người tạo: customer.teamIds đổi (do đổi PRIMARY) không làm đổi kết quả', () => {
      const t1 = id();
      const creator = { teamId: t1, teamIds: [t1] };
      const createdBy = id();
      const before = ownerTeamIdsOf({ createdBy, teamIds: [t1] }, creator);
      const after = ownerTeamIdsOf(
        { createdBy, teamIds: [id(), id()] },
        creator,
      );
      expect(after).toEqual(before);
    });

    it('FR-30: người tạo không thuộc nhóm (Admin thuần) thì KHÔNG có nhóm chủ, không dự phòng sang customer.teamIds', () => {
      expect(
        ownerTeamIdsOf(
          { createdBy: id(), teamIds: [id()] },
          { teamId: null, teamIds: [] },
        ),
      ).toEqual([]);
    });

    it('FR-30: khách cũ thiếu createdBy dự phòng customer.teamIds (khử trùng)', () => {
      const t = id();
      expect(
        ownerTeamIdsOf({ createdBy: null, teamIds: [t, t] }, null).map(String),
      ).toEqual([String(t)]);
      expect(ownerTeamIdsOf({ teamIds: [t] }, null).map(String)).toEqual([
        String(t),
      ]);
    });

    it('FR-30: có createdBy nhưng không tìm thấy user thì dự phòng customer.teamIds', () => {
      const t = id();
      expect(
        ownerTeamIdsOf({ createdBy: id(), teamIds: [t] }, null).map(String),
      ).toEqual([String(t)]);
    });

    it('FR-30: biên - thiếu cả createdBy và teamIds thì rỗng', () => {
      expect(ownerTeamIdsOf({}, null)).toEqual([]);
    });
  });

  describe('isCreator', () => {
    it('FR-30: so theo createdBy, đúng/sai/thiếu createdBy', () => {
      const [u, other] = [id(), id()];
      expect(isCreator({ createdBy: u }, u)).toBe(true);
      expect(isCreator({ createdBy: u }, other)).toBe(false);
      expect(isCreator({ createdBy: null }, u)).toBe(false);
      expect(isCreator({}, u)).toBe(false);
    });
  });

  describe('isOwnerManager', () => {
    it('FR-30: có/không trong danh sách Manager nhóm chủ, danh sách rỗng', () => {
      const [m1, m2, other] = [id(), id(), id()];
      expect(isOwnerManager([m1, m2], m2)).toBe(true);
      expect(isOwnerManager([m1, m2], other)).toBe(false);
      expect(isOwnerManager([], m1)).toBe(false);
    });
  });
});
