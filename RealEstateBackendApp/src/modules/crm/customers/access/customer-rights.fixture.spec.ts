import { Types } from 'mongoose';
import {
  buildCustomer,
  buildScopedRepo,
  ctxOf,
  IN_SCOPE_KEYS,
  matchesFilter,
  OUT_OF_SCOPE_KEYS,
  TEAM_A,
  TEAM_B,
  type UserKey,
} from './customer-rights.fixture';

/**
 * T-54 (FR-31): (1) kiểm bộ đánh giá bộ lọc của fixture (nếu nó sai thì mọi test khóa hiện trạng đều vô nghĩa);
 * (2) khóa PHẠM VI XEM khách hiện tại bằng `buildCustomerScope` THẬT qua `CustomersRepository` THẬT:
 * mọi test "ngoài phạm vi" ở các spec khác dựa vào đây. Các test phạm vi dưới đây KHÔNG đảo ở T-56 vì
 * Manager/Staff ngoài phạm vi vẫn 404; T-55 sẽ THÊM nhánh `createdBy` (người tạo luôn thấy), không bớt ai.
 */
describe('fixture: matchesFilter', () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();
  const doc = {
    _id: a,
    teamIds: [a],
    careTeam: [{ userId: a }, { userId: b }],
    deletedAt: null,
    __v: 2,
  };

  it('so ObjectId theo giá trị, đường dẫn chấm trải phẳng mảng', () => {
    expect(
      matchesFilter(doc, { 'careTeam.userId': new Types.ObjectId(a) }),
    ).toBe(true);
    expect(
      matchesFilter(doc, { 'careTeam.userId': new Types.ObjectId() }),
    ).toBe(false);
  });

  it('$in, $ne, $and, $or', () => {
    expect(matchesFilter(doc, { teamIds: { $in: [b, a] } })).toBe(true);
    expect(matchesFilter(doc, { teamIds: { $in: [] } })).toBe(false);
    expect(matchesFilter(doc, { deletedAt: { $ne: null } })).toBe(false);
    expect(
      matchesFilter(doc, { $and: [{ __v: 2 }, { deletedAt: null }] }),
    ).toBe(true);
    expect(
      matchesFilter(doc, { $or: [{ __v: 9 }, { teamIds: { $in: [a] } }] }),
    ).toBe(true);
    expect(matchesFilter(doc, { $or: [{ __v: 9 }, { __v: 8 }] })).toBe(false);
  });

  it('toán tử chưa hỗ trợ => ném lỗi (không khớp nhầm khi scope đổi cú pháp)', () => {
    expect(() => matchesFilter(doc, { __v: { $gt: 1 } })).toThrow(
      /chưa hỗ trợ/,
    );
    expect(() => matchesFilter(doc, { $nor: [] })).toThrow(/chưa hỗ trợ/);
  });
});

describe('phạm vi xem khách hiện tại (FR-31 a, b, c)', () => {
  const find = async (key: UserKey, customer = buildCustomer()) => {
    const { repo } = buildScopedRepo([customer]);
    return repo.findOne(ctxOf(key).scope, customer._id);
  };

  it.each(IN_SCOPE_KEYS)(
    'FR-31 (b): %s trong phạm vi => thấy khách',
    async (key) => {
      await expect(find(key)).resolves.toMatchObject({ fullName: 'Khách thử' });
    },
  );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi (không giao nhóm, không trong careTeam, không phải người tạo) => không thấy',
    async (key) => {
      await expect(find(key)).resolves.toBeNull();
    },
  );

  it('Manager thấy qua teamIds khi không trong careTeam (nhóm chủ và nhóm khác, ô R4 và R8)', async () => {
    await expect(find('MANAGER_OWNER')).resolves.not.toBeNull();
    await expect(find('MANAGER_R8')).resolves.not.toBeNull();
  });

  it('FR-31 (b): Manager nằm trong careTeam thấy khách qua nhánh careTeam dù teamIds KHÔNG giao nhóm mình quản lý; bị gỡ khỏi careTeam thì mất quyền xem', async () => {
    // `MANAGER_INCARE` quản lý TEAM_D; khách chỉ gắn TEAM_A, TEAM_B nên nhánh `teamIds` không khớp.
    const customer = buildCustomer({ teamIds: [TEAM_A, TEAM_B] });
    const without = {
      ...customer,
      careTeam: (customer.careTeam as Array<{ userId: Types.ObjectId }>).filter(
        (member) => !member.userId.equals(ctxOf('MANAGER_INCARE').actor.userId),
      ),
    };
    await expect(find('MANAGER_INCARE', customer)).resolves.not.toBeNull();
    await expect(find('MANAGER_INCARE', without)).resolves.toBeNull();
  });

  it('Staff chỉ thấy khi nằm trong careTeam: bỏ khỏi careTeam thì mất quyền xem ngay', async () => {
    const customer = buildCustomer();
    const without = {
      ...customer,
      careTeam: (customer.careTeam as Array<{ userId: Types.ObjectId }>).filter(
        (member) => !member.userId.equals(ctxOf('STAFF_MEMBER').actor.userId),
      ),
    };
    await expect(find('STAFF_MEMBER', customer)).resolves.not.toBeNull();
    await expect(find('STAFF_MEMBER', without)).resolves.toBeNull();
  });

  it('khách đã xóa mềm không ai thấy, kể cả Admin', async () => {
    const deleted = buildCustomer({ deletedAt: new Date() });
    await expect(find('ADMIN', deleted)).resolves.toBeNull();
  });
});
