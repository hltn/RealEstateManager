import { Types } from 'mongoose';
import { ListGroup } from '../catalogs/catalog.enums';
import {
  buildAccess,
  buildCustomer,
  buildCustomerCreatorOutsideCareTeam,
  buildCustomerWithOtherPrimary,
  buildScopedRepo,
  buildUserDirectory,
  fakeConnection,
  IN_SCOPE_KEYS,
  jwtOf,
  OUT_OF_SCOPE_KEYS,
  REJECTS,
  TEAM_A,
  TEAM_B,
  USERS,
  type UserKey,
} from './access/customer-rights.fixture';
import { toDetail } from './customer.mapper';
import { CustomerCriteriaService } from './customer-criteria.service';
import { CustomerDeletionService } from './customer-deletion.service';
import { CustomerNationalIdService } from './customer-national-id.service';
import { CustomerStatusChangeService } from './customer-status-change.service';
import type { RefMaps } from './customer-refs.service';
import type { CustomerLean } from './customers.repository';
import { CustomersService } from './customers.service';

/**
 * T-54 (FR-31) khóa quyền ở cấp khách (xem, sửa, đổi trạng thái, tiêu chí, xóa đơn, xem CMND/CCCD) bằng
 * `buildCustomerScope` + `CustomersRepository` THẬT trên model giả (xem `customer-rights.fixture.ts`).
 * Ma trận đích: docs/06_Module_Customer_Management/13_Ma_Tran_Phan_Quyen_CRM.md.
 *
 * T-56 đã ĐẢO các test nhãn `[đảo ở T-56]` sang luật mới (xóa chỉ Admin hoặc người tạo; CMND và quản lý nhóm
 * chỉ người tạo, Admin, Manager nhóm chủ; scope có nhánh `createdBy`). Test không nhãn giữ nguyên (xanh đến hết T-61).
 * Ô ma trận được ghi bằng mã `Rn.Am`.
 */

const SESSION_STATUS_ID = new Types.ObjectId();
const DROPPED_STATUS_ID = new Types.ObjectId();

const statuses = new Map<string, unknown>([
  [
    String(SESSION_STATUS_ID),
    {
      id: String(SESSION_STATUS_ID),
      code: 'NEW',
      label: 'Mới',
      listGroup: ListGroup.NOT_CONTACTED,
    },
  ],
  [
    String(DROPPED_STATUS_ID),
    {
      id: String(DROPPED_STATUS_ID),
      code: 'DROPPED',
      label: 'Bỏ',
      listGroup: ListGroup.DROPPED,
    },
  ],
]);

const emptyMaps = (): RefMaps =>
  ({
    statuses,
    sources: new Map(),
    areas: new Map(),
    projects: new Map(),
    contactResults: new Map(),
    tags: new Map(),
    users: new Map(),
    codes: {
      sources: new Map(),
      areas: new Map(),
      projects: new Map(),
      contactResults: new Map(),
    },
  }) as unknown as RefMaps;

const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) });

const refsMock = () => ({
  resolve: jest.fn().mockImplementation(() => Promise.resolve(emptyMaps())),
  resolveSingleInput: jest
    .fn()
    .mockResolvedValue({ provided: false, ref: null }),
  resolveListInput: jest.fn().mockResolvedValue({ provided: false, refs: [] }),
  lockAndAssert: jest.fn().mockResolvedValue(undefined),
});

// ============================================================================================
// A1 Xem khách: getById
// ============================================================================================
describe('CustomersService.getById: phạm vi xem (FR-31 a, b, c)', () => {
  const build = (customer = buildCustomer()) => {
    const { repo } = buildScopedRepo([customer]);
    const service = new CustomersService(
      fakeConnection() as never,
      {} as never,
      repo,
      buildAccess() as never,
      refsMock() as never,
      audit() as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // CustomerOwnerTeamService: toDetailDto được giả lập nên không dùng (FR-30)
    );
    jest
      .spyOn(service, 'toDetailDto')
      .mockImplementation((doc) => Promise.resolve(doc as never));
    return { service, customer };
  };

  it.each(IN_SCOPE_KEYS)(
    'FR-31 (b): %s xem được khách trong phạm vi',
    async (key) => {
      const { service, customer } = build();
      await expect(
        service.getById(jwtOf(key), String(customer._id)),
      ).resolves.toMatchObject({ _id: customer._id });
    },
  );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND (không lộ sự tồn tại)',
    async (key) => {
      const { service, customer } = build();
      await expect(
        service.getById(jwtOf(key), String(customer._id)),
      ).rejects.toMatchObject(REJECTS.CUSTOMER_NOT_FOUND);
    },
  );

  it('FR-31 (b) [đảo ở T-56, nhánh createdBy]: người tạo không còn trong careTeam vẫn xem được khách của mình', async () => {
    const { service, customer } = build(buildCustomerCreatorOutsideCareTeam());
    await expect(
      service.getById(jwtOf('STAFF_PRIMARY'), String(customer._id)),
    ).resolves.toMatchObject({ _id: customer._id });
  });

  it('FR-31 (a, c): nhánh createdBy chỉ mở cho người tạo: Staff ngoài careTeam và không phải người tạo vẫn 404', async () => {
    const { service, customer } = build(buildCustomerCreatorOutsideCareTeam());
    await expect(
      service.getById(jwtOf('STAFF_OUT'), String(customer._id)),
    ).rejects.toMatchObject(REJECTS.CUSTOMER_NOT_FOUND);
  });

  it('FR-31: khách cũ thiếu createdBy không khớp ai qua nhánh createdBy (Staff ngoài careTeam vẫn 404)', async () => {
    const { service, customer } = build(
      buildCustomerCreatorOutsideCareTeam({ createdBy: null }),
    );
    await expect(
      service.getById(jwtOf('STAFF_PRIMARY'), String(customer._id)),
    ).rejects.toMatchObject(REJECTS.CUSTOMER_NOT_FOUND);
  });
});

// ============================================================================================
// A2 Sửa thông tin: CustomersService.update (giữ nguyên theo Q-43 = A)
// ============================================================================================
describe('CustomersService.update: sửa thông tin (FR-31 a, b, c; FR-32 giữ, Q-43 = A)', () => {
  const build = () => {
    const customer = buildCustomer();
    const { repo, updates } = buildScopedRepo([customer]);
    const service = new CustomersService(
      fakeConnection() as never,
      {} as never,
      repo,
      buildAccess() as never,
      refsMock() as never,
      audit() as never,
      {} as never,
      { applyDelta: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never, // CustomerOwnerTeamService: toDetailDto được giả lập nên không dùng (FR-30)
    );
    jest
      .spyOn(service, 'toDetailDto')
      .mockImplementation((doc) => Promise.resolve(doc as never));
    return { service, customer, updates };
  };

  it.each(IN_SCOPE_KEYS)(
    'FR-31 (b) FR-32: %s trong phạm vi sửa được hồ sơ (giữ ở T-56)',
    async (key) => {
      const { service, customer, updates } = build();
      await service.update(jwtOf(key), String(customer._id), {
        version: 1,
        fullName: 'Tên mới',
      });
      expect(updates).toHaveLength(1);
      expect(updates[0].matched).toBe(true);
    },
  );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không ghi',
    async (key) => {
      const { service, customer, updates } = build();
      await expect(
        service.update(jwtOf(key), String(customer._id), {
          version: 1,
          fullName: 'Tên mới',
        }),
      ).rejects.toMatchObject(REJECTS.CUSTOMER_NOT_FOUND);
      expect(updates).toHaveLength(0);
    },
  );
});

// ============================================================================================
// A2 Đổi tình trạng + tiêu chí (giữ nguyên theo Q-43 = A)
// ============================================================================================
describe('CustomerStatusChangeService.change: đổi tình trạng (FR-31 a, b, c; FR-32 giữ)', () => {
  const build = () => {
    const customer = buildCustomer({ statusId: SESSION_STATUS_ID });
    const { repo, updates } = buildScopedRepo([customer]);
    const refs = refsMock();
    const service = new CustomerStatusChangeService(
      fakeConnection() as never,
      repo,
      buildAccess() as never,
      refs as never,
      audit() as never,
    );
    return { service, customer, updates };
  };
  const dto = (customerStatus = DROPPED_STATUS_ID) => ({
    statusId: String(customerStatus),
    version: 1,
  });

  it.each(IN_SCOPE_KEYS)(
    'FR-31 (b) FR-32: %s trong phạm vi đổi được tình trạng (giữ ở T-56)',
    async (key) => {
      const { service, customer, updates } = build();
      const result = await service.change(
        jwtOf(key),
        String(customer._id),
        dto(),
      );
      expect(result.version).toBe(2);
      expect(updates).toHaveLength(1);
    },
  );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không ghi',
    async (key) => {
      const { service, customer, updates } = build();
      await expect(
        service.change(jwtOf(key), String(customer._id), dto()),
      ).rejects.toMatchObject(REJECTS.CUSTOMER_NOT_FOUND);
      expect(updates).toHaveLength(0);
    },
  );
});

describe('CustomerCriteriaService.updateCriteria: cập nhật tiêu chí (FR-31 a, b, c; FR-32 giữ)', () => {
  const build = () => {
    const customer = buildCustomer({ progress: 0, criteria: {} });
    const { repo, updates } = buildScopedRepo([customer]);
    const refs = refsMock();
    const service = new CustomerCriteriaService(
      fakeConnection() as never,
      repo,
      buildAccess() as never,
      refs as never,
      audit() as never,
      {} as never,
      {} as never,
    );
    return { service, customer, updates };
  };
  const dto = { version: 1, demand: { isDone: true, description: 'Cần 2PN' } };

  it.each(IN_SCOPE_KEYS)(
    'FR-31 (b) FR-32: %s trong phạm vi cập nhật được tiêu chí (giữ ở T-56)',
    async (key) => {
      const { service, customer, updates } = build();
      const result = await service.updateCriteria(
        jwtOf(key),
        String(customer._id),
        dto,
      );
      expect(result.progress).toBe(25);
      expect(updates).toHaveLength(1);
    },
  );

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không ghi',
    async (key) => {
      const { service, customer, updates } = build();
      await expect(
        service.updateCriteria(jwtOf(key), String(customer._id), dto as never),
      ).rejects.toMatchObject(REJECTS.CUSTOMER_NOT_FOUND);
      expect(updates).toHaveLength(0);
    },
  );
});

// ============================================================================================
// A3 Xóa khách (đơn): CustomerDeletionService.softDelete
// ============================================================================================
describe('CustomerDeletionService.softDelete: xóa khách đơn (FR-31 a, c, e; ô A3)', () => {
  const build = (customer: Record<string, unknown>) => {
    const { repo, updates } = buildScopedRepo([customer]);
    const reminders = {
      cancelForCustomer: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CustomerDeletionService(
      fakeConnection() as never,
      repo,
      buildAccess() as never,
      audit() as never,
      reminders as never,
    );
    return { service, updates, reminders };
  };
  const remove = (
    h: ReturnType<typeof build>,
    key: UserKey,
    customer: Record<string, unknown> & { _id: Types.ObjectId },
  ) => h.service.softDelete(jwtOf(key), String(customer._id), 'Dọn dẹp');

  const statusCases: Array<[string, Types.ObjectId]> = [
    ['thường (không "Bỏ")', SESSION_STATUS_ID],
    ['"Bỏ"', DROPPED_STATUS_ID],
  ];

  describe.each(statusCases)(
    'khách ở tình trạng %s (D9: tình trạng không ảnh hưởng quyền xóa)',
    (_label, statusId) => {
      const make = (over: Record<string, unknown> = {}) =>
        buildCustomer({ statusId, ...over });

      it.each(OUT_OF_SCOPE_KEYS)(
        'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không xóa',
        async (key) => {
          const c = make();
          const h = build(c);
          await expect(remove(h, key, c)).rejects.toMatchObject(
            REJECTS.CUSTOMER_NOT_FOUND,
          );
          expect(h.updates).toHaveLength(0);
        },
      );

      it('FR-31 (e) R1.A3: Admin xóa được mọi khách (giữ ở T-56)', async () => {
        const c = make();
        const h = build(c);
        await remove(h, 'ADMIN', c);
        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].update).toMatchObject({
          $set: { deletedBy: USERS.ADMIN.userId },
        });
      });

      it('FR-31 (e) R2.A3 [đảo ở T-56]: người tạo (Staff, kiêm PRIMARY) xóa được khách của mình, KHÔNG cần khách "Bỏ"', async () => {
        const c = make();
        const h = build(c);
        await remove(h, 'STAFF_PRIMARY', c);
        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].update).toMatchObject({
          $set: { deletedBy: USERS.STAFF_PRIMARY.userId },
        });
        expect(h.reminders.cancelForCustomer).toHaveBeenCalled();
      });

      it('FR-31 (e) R2.A3: người tạo chỉ là MEMBER (PRIMARY là người khác) vẫn xóa được khách của mình', async () => {
        const c = buildCustomerWithOtherPrimary({ statusId });
        const h = build(c);
        await remove(h, 'STAFF_PRIMARY', c);
        expect(h.updates).toHaveLength(1);
      });

      it('FR-31 (e) R2.A3: người tạo không còn trong careTeam vẫn thấy (nhánh createdBy của scope) và xóa được', async () => {
        const c = buildCustomerCreatorOutsideCareTeam({ statusId });
        const h = build(c);
        await remove(h, 'STAFF_PRIMARY', c);
        expect(h.updates).toHaveLength(1);
      });

      it.each(['MANAGER_OWNER', 'MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
        'FR-31 (e) R4/R8.A3 [đảo ở T-56]: %s (Manager, kể cả nhóm chủ; không phải người tạo) => 403 INSUFFICIENT_ROLE, không xóa',
        async (key) => {
          const c = make();
          const h = build(c);
          await expect(remove(h, key, c)).rejects.toMatchObject(
            REJECTS.INSUFFICIENT_ROLE,
          );
          expect(h.updates).toHaveLength(0);
          expect(h.reminders.cancelForCustomer).not.toHaveBeenCalled();
        },
      );

      it('FR-31 (e) R5.A3 [đảo ở T-56]: PRIMARY KHÔNG phải người tạo => 403 INSUFFICIENT_ROLE, không xóa', async () => {
        const c = buildCustomerWithOtherPrimary({ statusId });
        const h = build(c);
        await expect(remove(h, 'STAFF_MEMBER', c)).rejects.toMatchObject(
          REJECTS.INSUFFICIENT_ROLE,
        );
        expect(h.updates).toHaveLength(0);
      });

      it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
        'FR-31 (e) R5.A3: %s (MEMBER trong careTeam) xóa khách => 403 INSUFFICIENT_ROLE, không xóa (giữ ở T-56)',
        async (key) => {
          const c = make();
          const h = build(c);
          await expect(remove(h, key, c)).rejects.toMatchObject(
            REJECTS.INSUFFICIENT_ROLE,
          );
          expect(h.updates).toHaveLength(0);
        },
      );
    },
  );

  it('FR-31: Manager là người tạo xóa được khách của mình; Manager nhóm chủ khác thì không', async () => {
    const make = () =>
      buildCustomerCreatorOutsideCareTeam({
        createdBy: USERS.MANAGER_R8.userId,
        teamIds: [TEAM_A, TEAM_B],
      });
    const own = make();
    const ownHarness = build(own);
    await remove(ownHarness, 'MANAGER_R8', own);
    expect(ownHarness.updates).toHaveLength(1);

    const other = make();
    const otherHarness = build(other);
    await expect(
      remove(otherHarness, 'MANAGER_OWNER', other),
    ).rejects.toMatchObject(REJECTS.INSUFFICIENT_ROLE);
    expect(otherHarness.updates).toHaveLength(0);
  });

  it('FR-31: khách cũ thiếu createdBy: PRIMARY không xóa được (không ai là người tạo), Admin vẫn xóa được', async () => {
    const c = buildCustomer({ createdBy: null });
    const denied = build(c);
    await expect(remove(denied, 'STAFF_PRIMARY', c)).rejects.toMatchObject(
      REJECTS.INSUFFICIENT_ROLE,
    );
    expect(denied.updates).toHaveLength(0);
    const allowed = build(c);
    await remove(allowed, 'ADMIN', c);
    expect(allowed.updates).toHaveLength(1);
  });
});

// ============================================================================================
// A11 Xem CMND/CCCD
// ============================================================================================
describe('CustomerNationalIdService.view: xem CMND/CCCD (FR-31 a, c, e; ô A11)', () => {
  const build = (customer: Record<string, unknown>) => {
    const { repo } = buildScopedRepo([customer]);
    const abuse = {
      trackNationalIdView: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CustomerNationalIdService(
      fakeConnection() as never,
      {} as never,
      repo,
      buildAccess() as never,
      { decrypt: jest.fn().mockReturnValue('012345678901') } as never,
      { consume: jest.fn().mockResolvedValue(undefined) } as never,
      abuse as never,
      audit() as never,
      buildUserDirectory().ownerTeam,
    );
    return { service, abuse };
  };
  const view = (
    h: ReturnType<typeof build>,
    key: UserKey,
    customer: { _id: Types.ObjectId },
  ) =>
    h.service.view(jwtOf(key), String(customer._id), { purpose: 'kiểm tra' });

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND',
    async (key) => {
      const c = buildCustomer();
      await expect(view(build(c), key, c)).rejects.toMatchObject(
        REJECTS.CUSTOMER_NOT_FOUND,
      );
    },
  );

  it.each(['ADMIN', 'MANAGER_OWNER'] as UserKey[])(
    'FR-31 (e) R1/R4.A11: %s (Admin, Manager nhóm chủ chưa trong careTeam) xem được CMND (giữ ở T-56)',
    async (key) => {
      const c = buildCustomer();
      await expect(view(build(c), key, c)).resolves.toMatchObject({
        nationalId: '012345678901',
      });
    },
  );

  it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e) R5/R8.A11 [đảo ở T-56]: %s (Manager nhóm khác hoặc Manager được mời, không phải nhóm chủ) => 403 NATIONAL_ID_FORBIDDEN',
    async (key) => {
      const c = buildCustomer();
      const h = build(c);
      await expect(view(h, key, c)).rejects.toMatchObject(
        REJECTS.NATIONAL_ID_FORBIDDEN,
      );
      expect(h.abuse.trackNationalIdView).not.toHaveBeenCalled();
    },
  );

  it('FR-31 (e) R2.A11: người tạo là PRIMARY xem được CMND (giữ ở T-56)', async () => {
    const c = buildCustomer();
    await expect(view(build(c), 'STAFF_PRIMARY', c)).resolves.toMatchObject({
      nationalId: '012345678901',
    });
  });

  it('FR-31 (e) R5.A11 [đảo ở T-56]: PRIMARY KHÔNG phải người tạo => 403 NATIONAL_ID_FORBIDDEN', async () => {
    const c = buildCustomerWithOtherPrimary();
    await expect(view(build(c), 'STAFF_MEMBER', c)).rejects.toMatchObject(
      REJECTS.NATIONAL_ID_FORBIDDEN,
    );
  });

  it('FR-31 (e) M2 R5.A11 [đảo ở T-56, đóng D4]: người tạo chỉ là MEMBER (PRIMARY là người khác) xem được CMND', async () => {
    const c = buildCustomerWithOtherPrimary();
    await expect(view(build(c), 'STAFF_PRIMARY', c)).resolves.toMatchObject({
      nationalId: '012345678901',
    });
  });

  it('FR-31 (e) R2.A11: người tạo không còn trong careTeam vẫn xem được CMND (nhánh createdBy của scope)', async () => {
    const c = buildCustomerCreatorOutsideCareTeam();
    await expect(view(build(c), 'STAFF_PRIMARY', c)).resolves.toMatchObject({
      nationalId: '012345678901',
    });
  });

  it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
    'FR-31 (e) R5.A11: %s (MEMBER, không phải người tạo) => 403 NATIONAL_ID_FORBIDDEN (giữ ở T-56)',
    async (key) => {
      const c = buildCustomer();
      await expect(view(build(c), key, c)).rejects.toMatchObject(
        REJECTS.NATIONAL_ID_FORBIDDEN,
      );
    },
  );
});

// ============================================================================================
// A11 Nhật ký các lần xem CMND/CCCD: listViews (Architecture 5.13.2 hàng 10: cùng điều kiện với `view`)
// ============================================================================================
describe('CustomerNationalIdService.listViews: nhật ký xem CMND/CCCD (FR-31 a, c, e; ô A11)', () => {
  type Factory = () => Record<string, unknown> & { _id: Types.ObjectId };

  /** Chuỗi `find().select().sort().skip().limit().lean().exec()` của model audit giả. */
  const findChain = () => {
    const query: Record<string, jest.Mock> = {};
    for (const name of ['select', 'sort', 'skip', 'limit', 'lean']) {
      query[name] = jest.fn(() => query);
    }
    query.exec = jest.fn(() => Promise.resolve([]));
    return query;
  };
  const build = (customer: Record<string, unknown>) => {
    const { repo } = buildScopedRepo([customer]);
    const auditModel = {
      find: jest.fn(() => findChain()),
      countDocuments: jest.fn(() => ({ exec: () => Promise.resolve(0) })),
    };
    const service = new CustomerNationalIdService(
      fakeConnection() as never,
      auditModel as never,
      repo,
      buildAccess() as never,
      {} as never,
      {} as never,
      {} as never,
      audit() as never,
      buildUserDirectory().ownerTeam,
    );
    return { service, auditModel };
  };
  const list = (
    h: ReturnType<typeof build>,
    key: UserKey,
    customer: { _id: Types.ObjectId },
  ) => h.service.listViews(jwtOf(key), String(customer._id), {});

  it.each(['ADMIN', 'MANAGER_OWNER'] as UserKey[])(
    'FR-31 (e) M3 R1/R4.A11: %s (Admin, Manager nhóm chủ) xem được nhật ký xem CMND của khách, lọc đúng customerId (giữ ở T-56)',
    async (key) => {
      const c = buildCustomer();
      const h = build(c);
      await expect(list(h, key, c)).resolves.toMatchObject({
        data: [],
        meta: { total: 0 },
      });
      expect(h.auditModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: c._id }),
      );
    },
  );

  it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e) M3 R5/R8.A11 [đảo ở T-56]: %s (Manager nhóm khác hoặc Manager được mời, không phải nhóm chủ) => 403 NATIONAL_ID_FORBIDDEN, không truy vấn nhật ký',
    async (key) => {
      const c = buildCustomer();
      const h = build(c);
      await expect(list(h, key, c)).rejects.toMatchObject(
        REJECTS.NATIONAL_ID_FORBIDDEN,
      );
      expect(h.auditModel.find).not.toHaveBeenCalled();
    },
  );

  it('FR-31 (e) M3 R2.A11 [đảo ở T-56]: người tạo khách (Staff, PRIMARY) xem được nhật ký xem CMND, lọc đúng customerId', async () => {
    const c = buildCustomer();
    const h = build(c);
    await expect(list(h, 'STAFF_PRIMARY', c)).resolves.toMatchObject({
      data: [],
    });
    expect(h.auditModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: c._id }),
    );
  });

  it('FR-31 (e) M3 R2.A11: người tạo không còn trong careTeam vẫn xem được nhật ký (nhánh createdBy của scope)', async () => {
    const c = buildCustomerCreatorOutsideCareTeam();
    await expect(list(build(c), 'STAFF_PRIMARY', c)).resolves.toMatchObject({
      data: [],
    });
  });

  it.each([
    ['MEMBER thường STAFF_MEMBER', 'STAFF_MEMBER', buildCustomer],
    ['MEMBER thường STAFF_INVITED', 'STAFF_INVITED', buildCustomer],
    [
      'PRIMARY không phải người tạo (STAFF_MEMBER)',
      'STAFF_MEMBER',
      buildCustomerWithOtherPrimary,
    ],
  ] as Array<[string, UserKey, Factory]>)(
    'FR-31 (e) M3 R5.A11: %s => 403 NATIONAL_ID_FORBIDDEN và không truy vấn nhật ký',
    async (_label, key, factory) => {
      const c = factory();
      const h = build(c);
      await expect(list(h, key, c)).rejects.toMatchObject(
        REJECTS.NATIONAL_ID_FORBIDDEN,
      );
      expect(h.auditModel.find).not.toHaveBeenCalled();
    },
  );

  it('FR-31 (a, c) M3: Manager ngoài phạm vi => 404 CUSTOMER_NOT_FOUND (không lộ sự tồn tại), không truy vấn nhật ký', async () => {
    const c = buildCustomer();
    const h = build(c);
    await expect(list(h, 'MANAGER_OUT', c)).rejects.toMatchObject(
      REJECTS.CUSTOMER_NOT_FOUND,
    );
    expect(h.auditModel.find).not.toHaveBeenCalled();
  });

  it('FR-31 (a, c) M3 [đảo ở T-56]: Staff ngoài careTeam => 404 CUSTOMER_NOT_FOUND (phạm vi xét trước vai trò, không lộ sự tồn tại), không truy vấn nhật ký', async () => {
    const c = buildCustomer();
    const h = build(c);
    await expect(list(h, 'STAFF_OUT', c)).rejects.toMatchObject(
      REJECTS.CUSTOMER_NOT_FOUND,
    );
    expect(h.auditModel.find).not.toHaveBeenCalled();
  });
});

// ============================================================================================
// Cờ quyền trả cho FE (customer.mapper)
// ============================================================================================
describe('toDetail.permissions: cờ quyền (FR-31 e)', () => {
  const doc = (customer: Record<string, unknown>): CustomerLean =>
    ({
      ...customer,
      interestedProjectIds: [],
      dataConsent: {},
      searchText: '',
      createdAt: new Date(),
    }) as unknown as CustomerLean;
  /** `managerIds` do `CustomerOwnerTeamService` THẬT nạp (nhóm của người tạo) như ở `CustomersService.toDetailDto`. */
  const flagsOf = async (key: UserKey, customer: Record<string, unknown>) => {
    const lean = doc(customer);
    const ownerTeam = await buildUserDirectory().ownerTeam.buildOwnerRefs(lean);
    const detail = toDetail(lean, emptyMaps(), USERS[key], ownerTeam);
    return {
      canRevealNationalId: detail.canRevealNationalId,
      canManageCareTeam: detail.permissions.canManageCareTeam,
      canSetInitialPrimary: detail.permissions.canSetInitialPrimary,
      canDelete: detail.permissions.canDelete,
      canEdit: detail.permissions.canEdit,
    };
  };

  const normal = () => buildCustomer({ statusId: SESSION_STATUS_ID });

  it('FR-31 (e) R1: Admin có đủ cờ (giữ ở T-56); canSetInitialPrimary = false vì khách đã có PRIMARY', async () => {
    await expect(flagsOf('ADMIN', normal())).resolves.toEqual({
      canRevealNationalId: true,
      canManageCareTeam: true,
      canSetInitialPrimary: false,
      canDelete: true,
      canEdit: true,
    });
  });

  it('FR-31 (e) R4 [đảo ở T-56]: Manager nhóm chủ: CMND và quản lý nhóm true; canDelete = false', async () => {
    await expect(flagsOf('MANAGER_OWNER', normal())).resolves.toEqual({
      canRevealNationalId: true,
      canManageCareTeam: true,
      canSetInitialPrimary: false,
      canDelete: false,
      canEdit: true,
    });
  });

  it('FR-31 (e) R8 [đảo ở T-56]: Manager nhóm khác (không trong careTeam): canRevealNationalId, canManageCareTeam, canDelete đều false', async () => {
    await expect(flagsOf('MANAGER_R8', normal())).resolves.toEqual({
      canRevealNationalId: false,
      canManageCareTeam: false,
      canSetInitialPrimary: false,
      canDelete: false,
      canEdit: true,
    });
  });

  it('FR-31 (e) R2 [đảo ở T-56]: người tạo (Staff, PRIMARY) trên khách chưa "Bỏ": canDelete = true; CMND và quản lý nhóm giữ', async () => {
    await expect(flagsOf('STAFF_PRIMARY', normal())).resolves.toEqual({
      canRevealNationalId: true,
      canManageCareTeam: true,
      canSetInitialPrimary: false,
      canDelete: true,
      canEdit: true,
    });
  });

  it('FR-31 (e) R5: thành viên MEMBER: không CMND, không quản lý nhóm, không xóa; vẫn sửa được (giữ ở T-56)', async () => {
    await expect(flagsOf('STAFF_MEMBER', normal())).resolves.toEqual({
      canRevealNationalId: false,
      canManageCareTeam: false,
      canSetInitialPrimary: false,
      canDelete: false,
      canEdit: true,
    });
  });

  it('FR-31 (e) M2 R5 [đảo ở T-56]: người tạo khách chỉ là MEMBER (PRIMARY là người khác): canRevealNationalId, canManageCareTeam, canDelete đều true', async () => {
    const c = buildCustomerWithOtherPrimary({ statusId: SESSION_STATUS_ID });
    await expect(flagsOf('STAFF_PRIMARY', c)).resolves.toMatchObject({
      canRevealNationalId: true,
      canManageCareTeam: true,
      canDelete: true,
    });
  });

  it('FR-31 (e) R5 [đảo ở T-56]: PRIMARY không phải người tạo: canRevealNationalId, canManageCareTeam, canDelete đều false', async () => {
    const c = buildCustomerWithOtherPrimary({ statusId: SESSION_STATUS_ID });
    await expect(flagsOf('STAFF_MEMBER', c)).resolves.toMatchObject({
      canRevealNationalId: false,
      canManageCareTeam: false,
      canDelete: false,
    });
  });

  it('FR-31 (e) R5 [đảo ở T-56]: khách "Bỏ": canDelete chỉ theo người tạo/Admin, PRIMARY không phải người tạo và MEMBER đều false', async () => {
    const c = buildCustomerWithOtherPrimary({ statusId: DROPPED_STATUS_ID });
    expect((await flagsOf('STAFF_MEMBER', c)).canDelete).toBe(false);
    expect((await flagsOf('STAFF_INVITED', c)).canDelete).toBe(false);
    expect((await flagsOf('STAFF_PRIMARY', c)).canDelete).toBe(true);
  });

  it('FR-31: canSetInitialPrimary chỉ true khi khách CHƯA có careTeam VÀ người gọi là Admin/Manager CÓ quyền chủ khách (Manager nhóm chủ true, Manager nhóm khác false)', async () => {
    const empty = () =>
      buildCustomer({
        statusId: SESSION_STATUS_ID,
        careTeam: [],
        primaryAssigneeId: null,
        teamIds: [TEAM_A, TEAM_B],
      });
    expect((await flagsOf('ADMIN', empty())).canSetInitialPrimary).toBe(true);
    expect((await flagsOf('MANAGER_OWNER', empty())).canSetInitialPrimary).toBe(
      true,
    );
    expect((await flagsOf('MANAGER_R8', empty())).canSetInitialPrimary).toBe(
      false,
    );
  });

  it('FR-31: khách thiếu createdBy: chỉ Admin có cờ xóa; không ai khác là người tạo', async () => {
    const c = buildCustomer({
      statusId: SESSION_STATUS_ID,
      createdBy: null,
    });
    expect((await flagsOf('ADMIN', c)).canDelete).toBe(true);
    expect((await flagsOf('STAFF_PRIMARY', c)).canDelete).toBe(false);
  });
});
