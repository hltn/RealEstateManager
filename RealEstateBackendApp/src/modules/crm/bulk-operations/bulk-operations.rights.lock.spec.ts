import { Types } from 'mongoose';
import { CareTeamService } from '../care-teams/care-team.service';
import { ListGroup } from '../catalogs/catalog.enums';
import {
  buildAccess,
  buildCustomer,
  buildCustomerCreatorOutsideCareTeam,
  buildCustomerWithOtherPrimary,
  buildScopedRepo,
  buildUserDirectory,
  fakeConnection,
  jwtOf,
  USERS,
  type UserKey,
} from '../customers/access/customer-rights.fixture';
import { CareRole } from '../customers/customer.constants';
import { CustomerDeletionService } from '../customers/customer-deletion.service';
import { BulkOperationsService } from './bulk-operations.service';
import { BulkOperationType } from './dtos/bulk-operation.dto';

/**
 * Quyền ở thao tác hàng loạt bằng `buildCustomerScope` + `CustomersRepository` THẬT, qua `BulkOperationsService` +
 * `CustomerDeletionService` + `CareTeamService` + `CustomerOwnerTeamService` THẬT (T-54 khóa hiện trạng; T-56 đảo theo FR-31).
 * - Xóa hàng loạt (e): mỗi khách đi qua `applyDelete`; CHỈ Admin hoặc NGƯỜI TẠO xóa được, KHÔNG điều kiện trạng thái
 *   "Bỏ" (D9); lỗi báo trong `failed[].errorCode` (`INSUFFICIENT_ROLE`).
 * - Phân hàng loạt `ASSIGN` (e2): chặn Staff cả lô (một lần), rồi KIỂM QUYỀN CHỦ KHÁCH TỪNG KHÁCH (Admin, người tạo,
 *   Manager nhóm chủ); khách không đủ quyền vào `failed[]` với `INSUFFICIENT_ROLE`.
 * Các test từng mang nhãn `[đảo ở T-56]` ở T-54 đã được đảo theo luật mới (nhãn đã bỏ khỏi tiêu đề ở T-57); test cũ giữ nguyên ý có hậu tố `(giữ ở T-56)`.
 */

const DROPPED_STATUS_ID = new Types.ObjectId();
const NORMAL_STATUS_ID = new Types.ObjectId();

const droppedCustomer = (overrides: Record<string, unknown> = {}) =>
  buildCustomer({ statusId: DROPPED_STATUS_ID, ...overrides });
const normalCustomer = (overrides: Record<string, unknown> = {}) =>
  buildCustomer({ statusId: NORMAL_STATUS_ID, ...overrides });

const usersById = () =>
  new Map(
    Object.values(USERS).map((actor) => [
      String(actor.userId),
      { _id: actor.userId, teamIds: actor.teamIds },
    ]),
  );

const build = (customers: Array<Record<string, unknown>>) => {
  const { repo, updates } = buildScopedRepo(customers);
  const access = buildAccess();
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const refs = {
    resolve: jest.fn(
      (input: { statusIds?: Types.ObjectId[]; userIds?: Types.ObjectId[] }) =>
        Promise.resolve({
          users: new Map(),
          statuses: new Map(
            (input.statusIds ?? []).map((id) => [
              String(id),
              {
                listGroup: id.equals(DROPPED_STATUS_ID)
                  ? ListGroup.DROPPED
                  : ListGroup.NOT_CONTACTED,
              },
            ]),
          ),
        }),
    ),
  };
  const careTeam = new CareTeamService(
    fakeConnection() as never,
    repo,
    access as never,
    refs as never,
    {
      load: jest.fn().mockResolvedValue(usersById()),
      // CÓ CHỦ Ý mock `assertAssignable` (không ném lỗi): T-54 chỉ khóa quyền theo phạm vi khách ở bulk `ASSIGN`.
      // Việc xác thực NGƯỜI ĐƯỢC PHÂN (tập hợp lệ, `USER_NOT_ASSIGNABLE`) thuộc T-55/T-56 và sẽ có test riêng ở đó.
      assertAssignable: jest.fn(),
      lock: jest.fn().mockResolvedValue(undefined),
    } as never,
    audit as never,
    { dispatch: jest.fn().mockResolvedValue(undefined) } as never,
    { consume: jest.fn().mockResolvedValue(undefined) } as never,
    buildUserDirectory().ownerTeam,
  );
  const deletion = new CustomerDeletionService(
    fakeConnection() as never,
    repo,
    access as never,
    audit as never,
    { cancelForCustomer: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const service = new BulkOperationsService(
    fakeConnection() as never,
    access as never,
    {} as never,
    careTeam,
    {} as never,
    deletion,
    { consume: jest.fn().mockResolvedValue(undefined) } as never,
    buildUserDirectory().ownerTeam,
  );
  return { service, updates };
};

type Harness = ReturnType<typeof build>;

const ids = (customers: Array<{ _id: Types.ObjectId }>) =>
  customers.map((customer) => String(customer._id));

const bulkDelete = (
  h: Harness,
  key: UserKey,
  customers: Array<{ _id: Types.ObjectId }>,
) =>
  h.service.run(jwtOf(key), {
    type: BulkOperationType.DELETE,
    customerIds: ids(customers),
    payload: { reason: 'Dọn dẹp' },
  });

const bulkAssign = (
  h: Harness,
  key: UserKey,
  customers: Array<{ _id: Types.ObjectId }>,
  member: UserKey = 'STAFF_OUT',
) =>
  h.service.run(jwtOf(key), {
    type: BulkOperationType.ASSIGN,
    customerIds: ids(customers),
    payload: { memberIds: [String(USERS[member].userId)] },
  });

const failure = (customer: { _id: Types.ObjectId }, errorCode: string) => ({
  customerId: String(customer._id),
  errorCode,
});

// ============================================================================================
// A4 Xóa khách hàng loạt (e)
// ============================================================================================
describe('BulkOperationsService DELETE: xóa khách hàng loạt (FR-31 a, c, e; ô A4)', () => {
  const statuses: Array<[string, typeof normalCustomer]> = [
    ['"Bỏ"', droppedCustomer],
    ['chưa "Bỏ"', normalCustomer],
  ];

  describe.each(statuses)(
    'khách %s (D9: tình trạng không ảnh hưởng quyền xóa)',
    (_label, make) => {
      it.each(['MANAGER_OUT', 'STAFF_OUT'] as UserKey[])(
        'FR-31 (a, c): %s ngoài phạm vi => failed CUSTOMER_NOT_FOUND, không xóa',
        async (key) => {
          const customer = make();
          const h = build([customer]);
          await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
            succeeded: [],
            failed: [failure(customer, 'CUSTOMER_NOT_FOUND')],
          });
          expect(h.updates).toHaveLength(0);
        },
      );

      it.each(['ADMIN', 'STAFF_PRIMARY'] as UserKey[])(
        'FR-31 (e): %s (Admin; người tạo kiêm PRIMARY) xóa được, KHÔNG cần khách "Bỏ"',
        async (key) => {
          const customer = make();
          const h = build([customer]);
          await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
            succeeded: ids([customer]),
            failed: [],
          });
          expect(h.updates).toHaveLength(1);
          expect(h.updates[0].update.$set).toMatchObject({
            deletedBy: USERS[key].userId,
          });
        },
      );

      it.each([
        'MANAGER_OWNER',
        'MANAGER_R8',
        'MANAGER_INCARE',
        'STAFF_MEMBER',
        'STAFF_INVITED',
      ] as UserKey[])(
        'FR-31 (e): %s (không phải người tạo, kể cả Manager nhóm chủ) => failed INSUFFICIENT_ROLE, không xóa',
        async (key) => {
          const customer = make();
          const h = build([customer]);
          await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
            succeeded: [],
            failed: [failure(customer, 'INSUFFICIENT_ROLE')],
          });
          expect(h.updates).toHaveLength(0);
        },
      );

      it('FR-31 (e): PRIMARY không phải người tạo => failed INSUFFICIENT_ROLE', async () => {
        const customer = make(buildCustomerWithOtherPrimary());
        const h = build([customer]);
        await expect(
          bulkDelete(h, 'STAFF_MEMBER', [customer]),
        ).resolves.toEqual({
          succeeded: [],
          failed: [failure(customer, 'INSUFFICIENT_ROLE')],
        });
        expect(h.updates).toHaveLength(0);
      });
    },
  );

  it('FR-31: người tạo KHÔNG còn trong careTeam vẫn thấy và xóa được khách của mình (đi qua nhánh createdBy của scope)', async () => {
    const customer = buildCustomerCreatorOutsideCareTeam();
    const h = build([customer]);
    await expect(bulkDelete(h, 'STAFF_PRIMARY', [customer])).resolves.toEqual({
      succeeded: ids([customer]),
      failed: [],
    });
    expect(h.updates).toHaveLength(1);
  });

  it('FR-31: Manager là người tạo xóa được khách của mình dù không trong careTeam; Manager nhóm chủ khác thì không', async () => {
    const customer = buildCustomer({
      createdBy: USERS.MANAGER_R8.userId,
      careTeam: [],
      teamIds: [USERS.MANAGER_R8.teamId, USERS.MANAGER_OWNER.teamId],
      primaryAssigneeId: null,
    });
    const own = build([customer]);
    await expect(bulkDelete(own, 'MANAGER_R8', [customer])).resolves.toEqual({
      succeeded: ids([customer]),
      failed: [],
    });
    const other = build([customer]);
    await expect(
      bulkDelete(other, 'MANAGER_OWNER', [customer]),
    ).resolves.toEqual({
      succeeded: [],
      failed: [failure(customer, 'INSUFFICIENT_ROLE')],
    });
  });

  it('FR-31: khách cũ thiếu createdBy: chỉ Admin xóa được, PRIMARY bị INSUFFICIENT_ROLE (không ai là người tạo)', async () => {
    const customer = buildCustomer({ createdBy: null });
    const denied = build([customer]);
    await expect(
      bulkDelete(denied, 'STAFF_PRIMARY', [customer]),
    ).resolves.toEqual({
      succeeded: [],
      failed: [failure(customer, 'INSUFFICIENT_ROLE')],
    });
    const allowed = build([customer]);
    await expect(bulkDelete(allowed, 'ADMIN', [customer])).resolves.toEqual({
      succeeded: ids([customer]),
      failed: [],
    });
  });

  it('FR-31 (e): mỗi khách một transaction riêng, báo từng khách (khách lỗi không kéo khách khác rollback) (giữ ở T-56)', async () => {
    const dropped = droppedCustomer();
    const outOfScope = droppedCustomer({
      careTeam: [],
      teamIds: [new Types.ObjectId()],
      createdBy: new Types.ObjectId(),
      primaryAssigneeId: null,
    });
    const notMine = normalCustomer({ createdBy: USERS.STAFF_MEMBER.userId });
    const h = build([dropped, outOfScope, notMine]);
    await expect(
      bulkDelete(h, 'STAFF_PRIMARY', [dropped, outOfScope, notMine]),
    ).resolves.toEqual({
      succeeded: ids([dropped]),
      failed: [
        failure(outOfScope, 'CUSTOMER_NOT_FOUND'),
        failure(notMine, 'INSUFFICIENT_ROLE'),
      ],
    });
    expect(h.updates).toHaveLength(1);
  });
});

// ============================================================================================
// A12 Phân hàng loạt ASSIGN (e2)
// ============================================================================================
describe('BulkOperationsService ASSIGN: phân chăm sóc hàng loạt (FR-31 a, c, e2)', () => {
  const careTeamWritten = (h: Harness) =>
    (
      h.updates[0].update.$set as {
        careTeam: Array<{ userId: Types.ObjectId; role: CareRole }>;
      }
    ).careTeam;

  it.each(['STAFF_PRIMARY', 'STAFF_MEMBER', 'STAFF_OUT'] as UserKey[])(
    'FR-31 (e2): %s (Staff, kể cả người tạo) bị chặn cả lô => 403 Insufficient role, không đụng khách nào (giữ ở T-56)',
    async (key) => {
      const customer = normalCustomer();
      const h = build([customer]);
      await expect(bulkAssign(h, key, [customer])).rejects.toMatchObject({
        status: 403,
        message: 'Insufficient role',
      });
      expect(h.updates).toHaveLength(0);
    },
  );

  it('FR-31 (a, e2): MANAGER_OUT ngoài phạm vi => failed CUSTOMER_NOT_FOUND, không ghi (giữ ở T-56)', async () => {
    const customer = normalCustomer();
    const h = build([customer]);
    await expect(bulkAssign(h, 'MANAGER_OUT', [customer])).resolves.toEqual({
      succeeded: [],
      failed: [failure(customer, 'CUSTOMER_NOT_FOUND')],
    });
    expect(h.updates).toHaveLength(0);
  });

  it.each(['ADMIN', 'MANAGER_OWNER'] as UserKey[])(
    'FR-31 (e2): %s (Admin; Manager nhóm chủ) phân được; người mới vào làm MEMBER, PRIMARY không đổi (giữ ở T-56)',
    async (key) => {
      const customer = normalCustomer();
      const h = build([customer]);
      await expect(bulkAssign(h, key, [customer])).resolves.toEqual({
        succeeded: ids([customer]),
        failed: [],
      });
      const team = careTeamWritten(h);
      expect(
        team.find((m) => m.userId.equals(USERS.STAFF_OUT.userId)),
      ).toMatchObject({ role: CareRole.MEMBER });
      expect(team.find((m) => m.role === CareRole.PRIMARY)?.userId).toEqual(
        USERS.STAFF_PRIMARY.userId,
      );
    },
  );

  it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e2): %s (Manager trong phạm vi nhưng không phải Manager nhóm chủ/người tạo) => failed INSUFFICIENT_ROLE, không ghi',
    async (key) => {
      const customer = normalCustomer();
      const h = build([customer]);
      await expect(bulkAssign(h, key, [customer])).resolves.toEqual({
        succeeded: [],
        failed: [failure(customer, 'INSUFFICIENT_ROLE')],
      });
      expect(h.updates).toHaveLength(0);
    },
  );

  it('FR-31 (e2): lô hỗn hợp, quyền xét TỪNG khách: Manager nhóm chủ phân khách nhóm mình, bị từ chối khách nhóm khác', async () => {
    const mine = normalCustomer();
    // Khách do STAFF_INVITED (nhóm B) tạo: MANAGER_OWNER thấy qua teamIds nhưng KHÔNG là Manager nhóm chủ.
    const theirs = normalCustomer({
      createdBy: USERS.STAFF_INVITED.userId,
      careTeam: [],
      teamIds: [USERS.MANAGER_OWNER.teamId, USERS.STAFF_INVITED.teamId],
      primaryAssigneeId: null,
    });
    const h = build([mine, theirs]);
    await expect(
      bulkAssign(h, 'MANAGER_OWNER', [mine, theirs]),
    ).resolves.toEqual({
      succeeded: ids([mine]),
      failed: [failure(theirs, 'INSUFFICIENT_ROLE')],
    });
    expect(h.updates).toHaveLength(1);
  });

  it('FR-31 (e2): Manager là người tạo phân được khách mình tạo dù không trong careTeam (hasOwnerRights nhánh người tạo)', async () => {
    const customer = buildCustomerCreatorOutsideCareTeam({
      createdBy: USERS.MANAGER_R8.userId,
      teamIds: [USERS.MANAGER_R8.teamId],
    });
    const h = build([customer]);
    await expect(bulkAssign(h, 'MANAGER_R8', [customer])).resolves.toEqual({
      succeeded: ids([customer]),
      failed: [],
    });
  });

  it('FR-31 (e2) FR-11: ASSIGN không đặt PRIMARY hàng loạt => 400 VALIDATION_FAILED cho cả lô (giữ ở T-56)', async () => {
    const customer = normalCustomer();
    const h = build([customer]);
    await expect(
      h.service.run(jwtOf('ADMIN'), {
        type: BulkOperationType.ASSIGN,
        customerIds: ids([customer]),
        payload: {
          memberIds: [String(USERS.STAFF_OUT.userId)],
          primaryUserId: String(USERS.STAFF_OUT.userId),
        },
      }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
    expect(h.updates).toHaveLength(0);
  });

  it('FR-31 (e2): người đã có trong nhóm được bỏ qua, không báo lỗi, không ghi (giữ ở T-56)', async () => {
    const customer = normalCustomer();
    const h = build([customer]);
    await expect(
      bulkAssign(h, 'ADMIN', [customer], 'STAFF_INVITED'),
    ).resolves.toEqual({ succeeded: ids([customer]), failed: [] });
    expect(h.updates).toHaveLength(0);
  });
});
