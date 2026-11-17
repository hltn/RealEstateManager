import { Types } from 'mongoose';
import { ListGroup } from '../catalogs/catalog.enums';
import {
  buildAccess,
  buildCustomer,
  buildCustomerWithOtherPrimary,
  buildScopedRepo,
  fakeConnection,
  IN_SCOPE_KEYS,
  jwtOf,
  OUT_OF_SCOPE_KEYS,
  REJECTS,
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
 * T-54 (FR-31): KHÓA HIỆN TRẠNG quyền ở cấp khách (xem, sửa, đổi trạng thái, tiêu chí, xóa đơn, xem CMND/CCCD)
 * bằng `buildCustomerScope` + `CustomersRepository` THẬT trên model giả (xem `customer-rights.fixture.ts`).
 * Ma trận đích: docs/06_Module_Customer_Management/13_Ma_Tran_Phan_Quyen_CRM.md.
 *
 * Quy ước tên: test có hậu tố `[đảo ở T-56]` mô tả hành vi HIỆN TẠI mà T-56 sẽ đổi (đảo kỳ vọng ở T-56);
 * test không có hậu tố phải XANH đến hết T-61. Ô ma trận được ghi bằng mã `Rn.Am`.
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
      refsMock() as never,
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

  describe('khách ở tình trạng thường (không "Bỏ")', () => {
    const customer = () => buildCustomer({ statusId: SESSION_STATUS_ID });

    it.each(OUT_OF_SCOPE_KEYS)(
      'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không xóa',
      async (key) => {
        const c = customer();
        const h = build(c);
        await expect(remove(h, key, c)).rejects.toMatchObject(
          REJECTS.CUSTOMER_NOT_FOUND,
        );
        expect(h.updates).toHaveLength(0);
      },
    );

    it('FR-31 (e) R1.A3: Admin xóa được mọi khách (giữ ở T-56)', async () => {
      const c = customer();
      const h = build(c);
      await remove(h, 'ADMIN', c);
      expect(h.updates).toHaveLength(1);
      expect(h.updates[0].update).toMatchObject({
        $set: { deletedBy: USERS.ADMIN.userId },
      });
    });

    it.each(['MANAGER_OWNER', 'MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
      'FR-31 (e) R4/R8.A3: %s (quản lý nhóm trong teamIds) xóa được khách không phải "Bỏ" [đảo ở T-56]',
      async (key) => {
        const c = customer();
        const h = build(c);
        await remove(h, key, c);
        expect(h.updates).toHaveLength(1);
        expect(h.reminders.cancelForCustomer).toHaveBeenCalled();
      },
    );

    it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
      'FR-31 (e) R5.A3: %s (MEMBER trong careTeam) xóa khách => 403 INSUFFICIENT_ROLE, không xóa (giữ ở T-56)',
      async (key) => {
        const c = customer();
        const h = build(c);
        await expect(remove(h, key, c)).rejects.toMatchObject(
          REJECTS.INSUFFICIENT_ROLE,
        );
        expect(h.updates).toHaveLength(0);
      },
    );

    it('FR-31 (e) R2.A3: người tạo (Staff, đang là PRIMARY) bị chặn 409 CUSTOMER_NOT_DROPPED khi khách chưa "Bỏ" [đảo ở T-56]', async () => {
      const c = customer();
      const h = build(c);
      await expect(remove(h, 'STAFF_PRIMARY', c)).rejects.toMatchObject(
        REJECTS.CUSTOMER_NOT_DROPPED,
      );
    });
  });

  describe('khách ở tình trạng "Bỏ"', () => {
    const dropped = () => buildCustomer({ statusId: DROPPED_STATUS_ID });

    it('FR-31 (e) R2.A3: người tạo là PRIMARY xóa được khách "Bỏ" (giữ ở T-56: người tạo xóa ở mọi tình trạng)', async () => {
      const c = dropped();
      const h = build(c);
      await remove(h, 'STAFF_PRIMARY', c);
      expect(h.updates).toHaveLength(1);
    });

    it('FR-31 (e) R5.A3: PRIMARY KHÔNG phải người tạo xóa được khách "Bỏ" [đảo ở T-56]', async () => {
      // Khách cũ: PRIMARY (STAFF_MEMBER) khác người tạo (STAFF_PRIMARY vẫn trong careTeam, là MEMBER).
      const c = buildCustomerWithOtherPrimary({ statusId: DROPPED_STATUS_ID });
      const h = build(c);
      await remove(h, 'STAFF_MEMBER', c);
      expect(h.updates).toHaveLength(1);
    });

    it('FR-31 (e) R5.A3: thành viên MEMBER thường không xóa được khách "Bỏ" => 403 INSUFFICIENT_ROLE (giữ ở T-56)', async () => {
      const c = dropped();
      const h = build(c);
      await expect(remove(h, 'STAFF_INVITED', c)).rejects.toMatchObject(
        REJECTS.INSUFFICIENT_ROLE,
      );
      expect(h.updates).toHaveLength(0);
    });

    it('FR-31 (e) R4.A3: Manager nhóm chủ xóa được khách "Bỏ" [đảo ở T-56]', async () => {
      const c = dropped();
      const h = build(c);
      await remove(h, 'MANAGER_OWNER', c);
      expect(h.updates).toHaveLength(1);
    });
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
    );
    return { service };
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
    'FR-31 (e) R1/R4.A11: %s (Admin, Manager nhóm chủ) xem được CMND (giữ ở T-56)',
    async (key) => {
      const c = buildCustomer();
      await expect(view(build(c), key, c)).resolves.toMatchObject({
        nationalId: '012345678901',
      });
    },
  );

  it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e) R5/R8.A11: %s (Manager nhóm khác hoặc Manager được mời, không phải nhóm chủ) xem được CMND [đảo ở T-56]',
    async (key) => {
      const c = buildCustomer();
      await expect(view(build(c), key, c)).resolves.toMatchObject({
        nationalId: '012345678901',
      });
    },
  );

  it('FR-31 (e) R2.A11: người tạo là PRIMARY xem được CMND (giữ ở T-56: người tạo vẫn xem được)', async () => {
    const c = buildCustomer();
    await expect(view(build(c), 'STAFF_PRIMARY', c)).resolves.toMatchObject({
      nationalId: '012345678901',
    });
  });

  it('FR-31 (e) R5.A11: PRIMARY KHÔNG phải người tạo xem được CMND [đảo ở T-56]', async () => {
    const c = buildCustomerWithOtherPrimary();
    await expect(view(build(c), 'STAFF_MEMBER', c)).resolves.toMatchObject({
      nationalId: '012345678901',
    });
  });

  it('FR-31 (e) M2 R5.A11: người tạo khách chỉ là MEMBER (PRIMARY là người khác) => 403 NATIONAL_ID_FORBIDDEN [đảo ở T-56: người tạo sẽ xem được, đóng D4]', async () => {
    // `buildCustomerWithOtherPrimary`: STAFF_PRIMARY là NGƯỜI TẠO nhưng chỉ là MEMBER; hiện luật chỉ nhìn PRIMARY.
    const c = buildCustomerWithOtherPrimary();
    await expect(view(build(c), 'STAFF_PRIMARY', c)).rejects.toMatchObject(
      REJECTS.NATIONAL_ID_FORBIDDEN,
    );
  });

  it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
    'FR-31 (e) R5.A11: %s (MEMBER, không phải PRIMARY) => 403 NATIONAL_ID_FORBIDDEN (giữ ở T-56)',
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
    'FR-31 (e) M3 R5/R8.A11: %s (Manager nhóm khác hoặc Manager được mời, không phải nhóm chủ) xem được nhật ký xem CMND [đảo ở T-56]',
    async (key) => {
      const c = buildCustomer();
      const h = build(c);
      await expect(list(h, key, c)).resolves.toMatchObject({ data: [] });
    },
  );

  it('FR-31 (e) M3 R2.A11: người tạo khách (Staff, PRIMARY) => 403 INSUFFICIENT_ROLE [đảo ở T-56: người tạo sẽ xem được nhật ký xem CMND]', async () => {
    const c = buildCustomer();
    await expect(list(build(c), 'STAFF_PRIMARY', c)).rejects.toMatchObject(
      REJECTS.INSUFFICIENT_ROLE,
    );
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
    'FR-31 (e) M3 R5.A11: %s => 403 và không truy vấn nhật ký (giữ ở T-56; mã lỗi đổi, xem ca kế)',
    async (_label, key, factory) => {
      const c = factory();
      const h = build(c);
      await expect(list(h, key, c)).rejects.toMatchObject({ status: 403 });
      expect(h.auditModel.find).not.toHaveBeenCalled();
    },
  );

  it('FR-31 (e) M3 R5.A11: Staff không có quyền chủ khách nhận mã INSUFFICIENT_ROLE [đảo ở T-56: đổi sang NATIONAL_ID_FORBIDDEN]', async () => {
    const c = buildCustomer();
    await expect(list(build(c), 'STAFF_MEMBER', c)).rejects.toMatchObject(
      REJECTS.INSUFFICIENT_ROLE,
    );
  });

  it('FR-31 (a, c) M3: Manager ngoài phạm vi => 404 CUSTOMER_NOT_FOUND (không lộ sự tồn tại), không truy vấn nhật ký', async () => {
    const c = buildCustomer();
    const h = build(c);
    await expect(list(h, 'MANAGER_OUT', c)).rejects.toMatchObject(
      REJECTS.CUSTOMER_NOT_FOUND,
    );
    expect(h.auditModel.find).not.toHaveBeenCalled();
  });

  it('FR-31 (a, c) M3: Staff ngoài careTeam => 403 INSUFFICIENT_ROLE vì hiện kiểm vai trò trước phạm vi [đảo ở T-56]', async () => {
    const c = buildCustomer();
    await expect(list(build(c), 'STAFF_OUT', c)).rejects.toMatchObject(
      REJECTS.INSUFFICIENT_ROLE,
    );
  });
});

// ============================================================================================
// Cờ quyền trả cho FE (customer.mapper) hiện tại
// ============================================================================================
describe('toDetail.permissions: cờ quyền hiện tại (FR-31 e)', () => {
  const doc = (customer: Record<string, unknown>): CustomerLean =>
    ({
      ...customer,
      interestedProjectIds: [],
      dataConsent: {},
      searchText: '',
      createdAt: new Date(),
    }) as unknown as CustomerLean;
  const flagsOf = (key: UserKey, customer: Record<string, unknown>) => {
    const detail = toDetail(doc(customer), emptyMaps(), USERS[key]);
    return {
      canRevealNationalId: detail.canRevealNationalId,
      canManageCareTeam: detail.permissions.canManageCareTeam,
      canDelete: detail.permissions.canDelete,
      canEdit: detail.permissions.canEdit,
    };
  };

  const normal = () => buildCustomer({ statusId: SESSION_STATUS_ID });

  it('FR-31 (e) R1: Admin có đủ cờ (giữ ở T-56)', () => {
    expect(flagsOf('ADMIN', normal())).toEqual({
      canRevealNationalId: true,
      canManageCareTeam: true,
      canDelete: true,
      canEdit: true,
    });
  });

  it('FR-31 (e) R4: Manager nhóm chủ: canRevealNationalId và canManageCareTeam giữ; canDelete = true [đảo ở T-56]', () => {
    expect(flagsOf('MANAGER_OWNER', normal())).toEqual({
      canRevealNationalId: true,
      canManageCareTeam: true,
      canDelete: true,
      canEdit: true,
    });
  });

  it('FR-31 (e) R8: Manager nhóm khác (không trong careTeam): canRevealNationalId, canManageCareTeam, canDelete đều true [đảo ở T-56]', () => {
    expect(flagsOf('MANAGER_R8', normal())).toEqual({
      canRevealNationalId: true,
      canManageCareTeam: true,
      canDelete: true,
      canEdit: true,
    });
  });

  it('FR-31 (e) R2: người tạo (Staff, PRIMARY) trên khách chưa "Bỏ": canDelete = false [đảo ở T-56]; CMND và quản lý nhóm giữ', () => {
    expect(flagsOf('STAFF_PRIMARY', normal())).toEqual({
      canRevealNationalId: true,
      canManageCareTeam: true,
      canDelete: false,
      canEdit: true,
    });
  });

  it('FR-31 (e) R5: thành viên MEMBER: không CMND, không quản lý nhóm, không xóa; vẫn sửa được (giữ ở T-56)', () => {
    expect(flagsOf('STAFF_MEMBER', normal())).toEqual({
      canRevealNationalId: false,
      canManageCareTeam: false,
      canDelete: false,
      canEdit: true,
    });
  });

  it('FR-31 (e) M2 R5: người tạo khách chỉ là MEMBER (PRIMARY là người khác): canRevealNationalId = false, canManageCareTeam = false [đảo ở T-56: người tạo có quyền chủ khách]', () => {
    const c = buildCustomerWithOtherPrimary({ statusId: SESSION_STATUS_ID });
    expect(flagsOf('STAFF_PRIMARY', c)).toMatchObject({
      canRevealNationalId: false,
      canManageCareTeam: false,
    });
  });

  it('FR-31 (e) R5: PRIMARY không phải người tạo: canRevealNationalId và canManageCareTeam = true [đảo ở T-56]', () => {
    const c = buildCustomerWithOtherPrimary({ statusId: SESSION_STATUS_ID });
    expect(flagsOf('STAFF_MEMBER', c)).toMatchObject({
      canRevealNationalId: true,
      canManageCareTeam: true,
    });
  });

  it('FR-31 (e) R5: PRIMARY không phải người tạo trên khách "Bỏ": canDelete = true [đảo ở T-56]; MEMBER thì false (giữ)', () => {
    const c = buildCustomerWithOtherPrimary({ statusId: DROPPED_STATUS_ID });
    expect(flagsOf('STAFF_MEMBER', c).canDelete).toBe(true);
    expect(flagsOf('STAFF_INVITED', c).canDelete).toBe(false);
  });
});
