import { Types } from 'mongoose';
import { CareTeamService } from '../care-teams/care-team.service';
import { ListGroup } from '../catalogs/catalog.enums';
import {
  buildAccess,
  buildCustomer,
  buildCustomerWithOtherPrimary,
  buildScopedRepo,
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
 * T-54 (FR-31): KHÓA HIỆN TRẠNG quyền ở thao tác hàng loạt bằng `buildCustomerScope` + `CustomersRepository` THẬT,
 * qua `BulkOperationsService` + `CustomerDeletionService` + `CareTeamService` THẬT.
 * - Xóa hàng loạt (e): mỗi khách đi qua `applyDelete` với `requireDropped: true`, lỗi báo trong `failed[].errorCode`.
 * - Phân hàng loạt `ASSIGN` (e2): hiện chỉ kiểm "Admin/Manager" MỘT LẦN cho cả lô, KHÔNG kiểm quyền mời trên từng
 *   khách (`authorize: () => undefined`).
 * Hậu tố `[đảo ở T-56]` = hành vi hiện tại sẽ đổi ở T-56; test không hậu tố phải xanh đến hết T-61.
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
  );
  const deletion = new CustomerDeletionService(
    fakeConnection() as never,
    repo,
    access as never,
    refs as never,
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
  describe('khách thuộc nhóm "Bỏ"', () => {
    it.each(['MANAGER_OUT', 'STAFF_OUT'] as UserKey[])(
      'FR-31 (a, c): %s ngoài phạm vi => failed CUSTOMER_NOT_FOUND, không xóa',
      async (key) => {
        const customer = droppedCustomer();
        const h = build([customer]);
        await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
          succeeded: [],
          failed: [failure(customer, 'CUSTOMER_NOT_FOUND')],
        });
        expect(h.updates).toHaveLength(0);
      },
    );

    it.each(['ADMIN', 'STAFF_PRIMARY'] as UserKey[])(
      'FR-31 (e): %s (Admin; người tạo kiêm PRIMARY) xóa được khách "Bỏ" (giữ ở T-56)',
      async (key) => {
        const customer = droppedCustomer();
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

    it.each(['MANAGER_OWNER', 'MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
      'FR-31 (e): %s (Manager có nhóm giao với khách, không phải người tạo) hiện xóa được khách "Bỏ" [đảo ở T-56]',
      async (key) => {
        const customer = droppedCustomer();
        const h = build([customer]);
        await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
          succeeded: ids([customer]),
          failed: [],
        });
      },
    );

    it('FR-31 (e): PRIMARY không phải người tạo hiện xóa được khách "Bỏ" [đảo ở T-56]', async () => {
      const customer = droppedCustomer({
        ...buildCustomerWithOtherPrimary(),
        statusId: DROPPED_STATUS_ID,
      });
      const h = build([customer]);
      await expect(bulkDelete(h, 'STAFF_MEMBER', [customer])).resolves.toEqual({
        succeeded: ids([customer]),
        failed: [],
      });
    });

    it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
      'FR-31 (e): %s (MEMBER) => failed INSUFFICIENT_ROLE, không xóa (giữ ở T-56)',
      async (key) => {
        const customer = droppedCustomer();
        const h = build([customer]);
        await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
          succeeded: [],
          failed: [failure(customer, 'INSUFFICIENT_ROLE')],
        });
        expect(h.updates).toHaveLength(0);
      },
    );
  });

  describe('khách KHÔNG thuộc nhóm "Bỏ" (hàng loạt hiện đòi "Bỏ" với mọi người, kể cả Admin)', () => {
    it.each(['ADMIN', 'STAFF_PRIMARY', 'MANAGER_OWNER'] as UserKey[])(
      'FR-31 (e): %s có quyền xóa nhưng khách chưa "Bỏ" => failed CUSTOMER_NOT_DROPPED [đảo ở T-56]',
      async (key) => {
        const customer = normalCustomer();
        const h = build([customer]);
        await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
          succeeded: [],
          failed: [failure(customer, 'CUSTOMER_NOT_DROPPED')],
        });
        expect(h.updates).toHaveLength(0);
      },
    );

    it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
      'FR-31 (e): %s (MEMBER) => failed INSUFFICIENT_ROLE (quyền được xét trước tình trạng) (giữ ở T-56)',
      async (key) => {
        const customer = normalCustomer();
        const h = build([customer]);
        await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
          succeeded: [],
          failed: [failure(customer, 'INSUFFICIENT_ROLE')],
        });
      },
    );

    it.each(['MANAGER_OUT', 'STAFF_OUT'] as UserKey[])(
      'FR-31 (a, c): %s ngoài phạm vi => failed CUSTOMER_NOT_FOUND (không lộ tình trạng khách) (giữ ở T-56)',
      async (key) => {
        const customer = normalCustomer();
        const h = build([customer]);
        await expect(bulkDelete(h, key, [customer])).resolves.toEqual({
          succeeded: [],
          failed: [failure(customer, 'CUSTOMER_NOT_FOUND')],
        });
      },
    );
  });

  it('FR-31 (e): mỗi khách một transaction riêng, báo từng khách (khách lỗi không kéo khách khác rollback) (giữ ở T-56)', async () => {
    const dropped = droppedCustomer();
    const outOfScope = droppedCustomer({
      careTeam: [],
      teamIds: [new Types.ObjectId()],
      createdBy: new Types.ObjectId(),
      primaryAssigneeId: null,
    });
    const h = build([dropped, outOfScope]);
    await expect(
      bulkDelete(h, 'STAFF_PRIMARY', [dropped, outOfScope]),
    ).resolves.toEqual({
      succeeded: ids([dropped]),
      failed: [failure(outOfScope, 'CUSTOMER_NOT_FOUND')],
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
    'FR-31 (e2): %s (Staff) bị chặn cả lô => 403 Insufficient role, không đụng khách nào (giữ ở T-56)',
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
    'FR-31 (e2): %s (Manager trong phạm vi, không có quyền mời trên khách này) hiện vẫn phân được vì KHÔNG kiểm từng khách [đảo ở T-56]',
    async (key) => {
      const customer = normalCustomer();
      const h = build([customer]);
      await expect(bulkAssign(h, key, [customer])).resolves.toEqual({
        succeeded: ids([customer]),
        failed: [],
      });
      expect(h.updates).toHaveLength(1);
    },
  );

  it('FR-31 (e2): MANAGER_R8 phân cả lô nhiều khách, không khách nào bị từ chối quyền mời (không kiểm từng khách) [đảo ở T-56]', async () => {
    // MANAGER_R8 không có quyền chủ khách trên cả hai khách; hiện không có khách nào bị từ chối quyền mời.
    const first = normalCustomer();
    const second = normalCustomer();
    const h = build([first, second]);
    const result = await bulkAssign(h, 'MANAGER_R8', [first, second]);
    expect(result.succeeded).toEqual(ids([first, second]));
    expect(result.failed).toEqual([]);
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
