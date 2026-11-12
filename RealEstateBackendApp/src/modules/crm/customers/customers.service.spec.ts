import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CrmActor } from '../common/access/crm-actor';
import { CareRole } from './customer.constants';
import { COUNTER_KEY } from './customer-code.constants';
import { CustomersService } from './customers.service';
import type { CustomerLean } from './customers.repository';
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './dtos/customer-request.dto';

// Transaction giả: chạy `work` đúng một lần với session giả (không retry), lỗi ném lại nguyên vẹn như bản thật.
const SESSION = { id: 'tx-session' };
jest.mock('../../../shared/database/with-transaction.util', () => ({
  withTransaction: jest.fn(
    (_connection: unknown, work: (s: unknown) => unknown) => work(SESSION),
  ),
}));

const oid = () => new Types.ObjectId();
const jwt = { sub: 'u1' } as unknown as JwtPayload;
const PHONE_E164 = '+84912345678';

const emptyRefMaps = () => ({
  statuses: new Map(),
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
});

const makeActor = (
  role: UserRole,
  overrides: Partial<CrmActor> = {},
): CrmActor => ({
  userId: oid(),
  role,
  roles: [role],
  displayName: 'Người tạo',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
  ...overrides,
});

interface Harness {
  service: CustomersService;
  actor: CrmActor;
  inserted: Array<Record<string, unknown>>;
  calls: {
    insert: jest.Mock;
    counterNext: jest.Mock;
    auditRecord: jest.Mock;
    dispatch: jest.Mock;
    updateMany: jest.Mock;
    userFindOne: jest.Mock;
    applyDelta: jest.Mock;
    lockAndAssert: jest.Mock;
    updateOne: jest.Mock;
    repoFindOne: jest.Mock;
  };
}

interface HarnessOptions {
  actor?: CrmActor;
  /** Nhóm của người tạo trong DB (đọc lại trong session). `null` = không tìm thấy người dùng. */
  creatorTeamIds?: Types.ObjectId[] | null;
  nextSeq?: () => Promise<number>;
  insertImpl?: () => Promise<void>;
  before?: Partial<CustomerLean>;
}

const build = (options: HarnessOptions = {}): Harness => {
  const actor = options.actor ?? makeActor(UserRole.STAFF);
  const inserted: Array<Record<string, unknown>> = [];
  let seq = 0;

  const insert = jest.fn((doc: Record<string, unknown>) => {
    if (options.insertImpl) return options.insertImpl();
    inserted.push(doc);
    return Promise.resolve();
  });
  const counterNext = jest.fn(async () => {
    const value = options.nextSeq ? await options.nextSeq() : ++seq;
    return { first: value, last: value };
  });
  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const dispatch = jest.fn().mockResolvedValue(undefined);
  const applyDelta = jest.fn().mockResolvedValue(undefined);
  const lockAndAssert = jest.fn().mockResolvedValue(undefined);

  const updateMany = jest.fn(() => ({ exec: () => Promise.resolve({}) }));
  const creatorTeamIds =
    options.creatorTeamIds === undefined ? [] : options.creatorTeamIds;
  const userFindOne = jest.fn(() => {
    const query = {
      select: () => query,
      session: () => query,
      lean: () => query,
      exec: () =>
        Promise.resolve(
          creatorTeamIds === null
            ? null
            : { _id: actor.userId, teamIds: creatorTeamIds },
        ),
    };
    return query;
  });
  const userModel = { updateMany, findOne: userFindOne };

  const before = {
    _id: oid(),
    fullName: 'Khách Cũ',
    phone: PHONE_E164,
    email: null,
    sourceId: null,
    areaId: null,
    interestedProjectIds: [],
    tagIds: [],
    __v: 4,
    ...options.before,
  } as unknown as CustomerLean;
  const repoFindOne = jest.fn().mockResolvedValue(before);
  const updateOne = jest.fn().mockResolvedValue(true);
  const repo = { insert, findOne: repoFindOne, updateOne };

  const access = {
    resolve: jest.fn().mockResolvedValue({ actor, scope: {} }),
  };
  const refs = {
    resolveSingleInput: jest
      .fn()
      .mockResolvedValue({ provided: false, ref: null }),
    resolveListInput: jest
      .fn()
      .mockResolvedValue({ provided: false, refs: [] }),
    findDefaultStatusRef: jest
      .fn()
      .mockResolvedValue({ id: oid(), code: 'NEW', label: 'Chưa tiếp cận' }),
    lockAndAssert,
    resolve: jest.fn().mockImplementation(() => emptyRefMaps()),
  };
  const pii = { encrypt: jest.fn() };
  const tags = { applyDelta };

  const service = new CustomersService(
    {} as never,
    userModel as never,
    repo as never,
    access as never,
    refs as never,
    { record: auditRecord } as never,
    pii as never,
    tags as never,
    { dispatch } as never,
    { next: counterNext } as never,
  );
  // Dựng DTO phản hồi thuộc mapper (đã có spec riêng): ở đây chỉ cần đối chiếu bản ghi được ghi xuống DB.
  jest
    .spyOn(service, 'toDetailDto')
    .mockImplementation((doc) => Promise.resolve(doc as never));

  return {
    service,
    actor,
    inserted,
    calls: {
      insert,
      counterNext,
      auditRecord,
      dispatch,
      updateMany,
      userFindOne,
      applyDelta,
      lockAndAssert,
      updateOne,
      repoFindOne,
    },
  };
};

const createDto = (
  extra: Partial<CreateCustomerDto> = {},
): CreateCustomerDto => ({ fullName: 'Nguyễn Văn A', ...extra });

const auditChanges = (h: Harness): Array<Record<string, unknown>> =>
  (h.calls.auditRecord.mock.calls[0][0] as { changes: never[] }).changes;

describe('CustomersService.create', () => {
  describe('phone tùy chọn (FR-01)', () => {
    it('FR-01: có phone => chuẩn hóa E.164, searchText đủ 3 phần chứa các dạng số', async () => {
      const h = build();
      await h.service.create(jwt, createDto({ phone: '0912 345 678' }));
      const doc = h.inserted[0];
      expect(doc.phone).toBe(PHONE_E164);
      expect(doc.searchText).toBe('nguyen van a\n\n0912345678 84912345678');
    });

    it.each([
      ['vắng mặt', undefined],
      ['null', null],
      ['chuỗi rỗng', ''],
      ['chỉ khoảng trắng', '   '],
    ])(
      'FR-01: phone %s => lưu null, searchText vẫn 3 phần',
      async (_n, phone) => {
        const h = build();
        await h.service.create(jwt, createDto({ phone: phone }));
        const doc = h.inserted[0];
        expect(doc.phone).toBeNull();
        expect((doc.searchText as string).split('\n')).toHaveLength(3);
        expect(doc.searchText).toBe('nguyen van a\n\n');
      },
    );

    it('FR-01: phone null => audit CUSTOMER_CREATED không có dòng đổi `phone` (null -> null)', async () => {
      const h = build();
      await h.service.create(jwt, createDto({ phone: null }));
      expect(
        auditChanges(h).find((change) => change.field === 'phone'),
      ).toBeUndefined();
    });

    it('FR-01: phone có giá trị => audit che số (không ghi số đầy đủ lúc tạo)', async () => {
      const h = build();
      await h.service.create(jwt, createDto({ phone: PHONE_E164 }));
      const change = auditChanges(h).find((c) => c.field === 'phone');
      expect(change).toMatchObject({ from: null });
      expect(change?.to).not.toBe(PHONE_E164);
    });

    it('FR-01: phone sai định dạng => 400 INVALID_PHONE, không mở transaction, không cấp mã', async () => {
      const h = build();
      await expect(
        h.service.create(jwt, createDto({ phone: 'abc' })),
      ).rejects.toMatchObject({
        response: { errorCode: ErrorCode.INVALID_PHONE },
      });
      expect(h.calls.counterNext).not.toHaveBeenCalled();
      expect(h.calls.insert).not.toHaveBeenCalled();
    });
  });

  describe('không còn kiểm trùng SĐT (FR-02)', () => {
    it('FR-02: hai khách cùng SĐT đều tạo được, mỗi khách một customerCode riêng', async () => {
      const h = build();
      await h.service.create(jwt, createDto({ phone: '0912345678' }));
      await h.service.create(jwt, createDto({ phone: '+84 912 345 678' }));
      expect(h.inserted).toHaveLength(2);
      expect(h.inserted[0].phone).toBe(h.inserted[1].phone);
      expect(h.inserted[0].customerCode).not.toBe(h.inserted[1].customerCode);
    });

    it('FR-02: lỗi từ DB (kể cả E11000) KHÔNG còn bị đổi thành 409 CUSTOMER_PHONE_DUPLICATED, ném nguyên vẹn', async () => {
      const dup = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      });
      const h = build({ insertImpl: () => Promise.reject(dup) });
      await expect(
        h.service.create(jwt, createDto({ phone: '0912345678' })),
      ).rejects.toBe(dup);
    });

    it('FR-02: mã lỗi CUSTOMER_PHONE_DUPLICATED đã bị gỡ khỏi ErrorCode', () => {
      expect(Object.values(ErrorCode)).not.toContain(
        'CUSTOMER_PHONE_DUPLICATED',
      );
    });
  });

  describe('người tạo luôn là PRIMARY (FR-10)', () => {
    it.each([
      [UserRole.ADMIN, []],
      [UserRole.MANAGER, [oid()]],
      [UserRole.STAFF, [oid(), oid()]],
    ])(
      'FR-10: %s tạo khách => careTeam chỉ gồm chính họ là PRIMARY, primaryAssigneeId = họ',
      async (role, teams) => {
        const h = build({
          actor: makeActor(role, { teamIds: teams }),
          creatorTeamIds: teams,
        });
        await h.service.create(jwt, createDto());
        const doc = h.inserted[0];
        const careTeam = doc.careTeam as Array<Record<string, unknown>>;
        expect(careTeam).toHaveLength(1);
        expect(careTeam[0]).toMatchObject({
          userId: h.actor.userId,
          role: CareRole.PRIMARY,
          addedBy: h.actor.userId,
        });
        expect(doc.primaryAssigneeId).toBe(h.actor.userId);
        expect(doc.createdBy).toBe(h.actor.userId);
      },
    );

    it('FR-06: Admin thuần không thuộc nhóm nào => teamIds = [] (khách vẫn tạo được)', async () => {
      const h = build({
        actor: makeActor(UserRole.ADMIN),
        creatorTeamIds: [],
      });
      await h.service.create(jwt, createDto());
      expect(h.inserted[0].teamIds).toEqual([]);
    });

    it('FR-06: teamIds = nhóm HIỆN TẠI của người tạo đọc lại trong session, không dùng managedTeamIds', async () => {
      const own = oid();
      const managed = oid();
      const h = build({
        actor: makeActor(UserRole.MANAGER, {
          teamIds: [oid()], // snapshot cũ trong actor
          managedTeamIds: [managed],
        }),
        creatorTeamIds: [own],
      });
      await h.service.create(jwt, createDto());
      expect(h.inserted[0].teamIds).toEqual([own]);
      expect(h.inserted[0].teamIds).not.toContainEqual(managed);
    });

    it('FR-06: chạm user rồi mới đọc lại nhóm, cả hai trong cùng session (chống write-skew)', async () => {
      const h = build({ actor: makeActor(UserRole.STAFF) });
      await h.service.create(jwt, createDto());
      const { updateMany, userFindOne } = h.calls;
      expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        userFindOne.mock.invocationCallOrder[0],
      );
      expect(updateMany).toHaveBeenCalledWith(
        { _id: { $in: [h.actor.userId] } },
        { $currentDate: { updatedAt: true } },
        { session: SESSION, timestamps: false },
      );
    });

    it('FR-06: không đọc được người tạo (vừa bị xóa) => dùng nhóm trong actor, không ném lỗi', async () => {
      const team = oid();
      const h = build({
        actor: makeActor(UserRole.STAFF, { teamIds: [team] }),
        creatorTeamIds: null,
      });
      await h.service.create(jwt, createDto());
      expect(h.inserted[0].teamIds).toEqual([team]);
    });

    it('FR-10: role không được làm PRIMARY (EDITOR) => 403 CARE_TEAM_ACTION_FORBIDDEN, không cấp mã, không ghi', async () => {
      const h = build({ actor: makeActor(UserRole.EDITOR) });
      const error = await h.service
        .create(jwt, createDto())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getStatus()).toBe(403);
      expect(
        (error as BusinessException).getResponse() as Record<string, unknown>,
      ).toMatchObject({ errorCode: ErrorCode.CARE_TEAM_ACTION_FORBIDDEN });
      expect(h.calls.counterNext).not.toHaveBeenCalled();
      expect(h.calls.insert).not.toHaveBeenCalled();
    });

    it('FR-10: tài khoản nhiều role (EDITOR + STAFF) vẫn làm được PRIMARY', async () => {
      const h = build({
        actor: makeActor(UserRole.STAFF, {
          roles: [UserRole.STAFF, UserRole.EDITOR],
        }),
      });
      await h.service.create(jwt, createDto());
      expect(h.inserted).toHaveLength(1);
    });

    it('FR-10: người tạo là người duy nhất trong careTeam => thông báo gửi đi là danh sách rỗng', async () => {
      const h = build({ actor: makeActor(UserRole.ADMIN) });
      await h.service.create(jwt, createDto());
      expect(h.calls.dispatch).toHaveBeenCalledWith([], SESSION);
    });
  });

  describe('cấp customerCode trong transaction tạo (FR-07)', () => {
    it('FR-07: customerCode = KH- + số do counter cấp, cấp đúng 1 mã bằng session của transaction', async () => {
      const h = build({ nextSeq: () => Promise.resolve(42) });
      await h.service.create(jwt, createDto());
      expect(h.inserted[0].customerCode).toBe('KH-000042');
      expect(h.calls.counterNext).toHaveBeenCalledTimes(1);
      expect(h.calls.counterNext).toHaveBeenCalledWith(COUNTER_KEY, 1, SESSION);
    });

    it('FR-07: $inc counter chạy SAU mọi đọc/kiểm tra và ngay TRƯỚC insert (giữ khóa counter ngắn nhất)', async () => {
      const h = build();
      await h.service.create(jwt, createDto());
      const next = h.calls.counterNext.mock.invocationCallOrder[0];
      expect(next).toBeGreaterThan(
        h.calls.lockAndAssert.mock.invocationCallOrder[0],
      );
      expect(next).toBeGreaterThan(
        h.calls.applyDelta.mock.invocationCallOrder[0],
      );
      expect(next).toBeGreaterThan(
        h.calls.userFindOne.mock.invocationCallOrder[0],
      );
      expect(next).toBeLessThan(h.calls.insert.mock.invocationCallOrder[0]);
    });

    it('FR-07: audit CUSTOMER_CREATED ghi customerCode (field customerCode, null -> mã)', async () => {
      const h = build({ nextSeq: () => Promise.resolve(7) });
      await h.service.create(jwt, createDto());
      expect(h.calls.auditRecord.mock.calls[0][0]).toMatchObject({
        action: 'CUSTOMER_CREATED',
      });
      expect(auditChanges(h)).toContainEqual({
        field: 'customerCode',
        from: null,
        to: 'KH-000007',
      });
    });

    it('FR-07: counter lỗi => không insert, không audit, lỗi ném nguyên vẹn (transaction rollback)', async () => {
      const boom = new Error('counter down');
      const h = build({ nextSeq: () => Promise.reject(boom) });
      await expect(h.service.create(jwt, createDto())).rejects.toBe(boom);
      expect(h.calls.insert).not.toHaveBeenCalled();
      expect(h.calls.auditRecord).not.toHaveBeenCalled();
    });

    it('FR-07: 25 lần tạo đồng thời (counter nguyên tử giả lập) => 25 mã khác nhau, liên tục KH-000001..KH-000025', async () => {
      // Counter giả lập đúng ngữ nghĩa $inc nguyên tử: mỗi lần gọi nhận số kế tiếp, nhưng nhả luồng giữa chừng
      // để các lần tạo xen kẽ nhau.
      let counter = 0;
      const atomicInc = async () => {
        await new Promise((resolve) => setImmediate(resolve));
        counter += 1;
        return counter;
      };
      const h = build({
        actor: makeActor(UserRole.ADMIN),
        nextSeq: atomicInc,
      });
      const total = 25;
      await Promise.all(
        Array.from({ length: total }, (_unused, index) =>
          h.service.create(jwt, createDto({ fullName: `Khách ${index}` })),
        ),
      );
      const codes = h.inserted.map((doc) => doc.customerCode as string);
      expect(new Set(codes).size).toBe(total);
      expect([...codes].sort()).toEqual(
        Array.from(
          { length: total },
          (_unused, index) => `KH-${String(index + 1).padStart(6, '0')}`,
        ),
      );
    });
  });

  it('FR-10: DTO tạo không còn mang careTeam; doc ghi xuống không chứa thành viên nào ngoài người tạo', async () => {
    const h = build({ actor: makeActor(UserRole.MANAGER) });
    await h.service.create(
      jwt,
      // Client cũ có thể còn gửi careTeam; ValidationPipe đã chặn ở biên, service cũng không đọc trường này.
      createDto({
        careTeam: { memberIds: [String(oid())], primaryUserId: String(oid()) },
      } as unknown as Partial<CreateCustomerDto>),
    );
    expect(h.inserted[0].careTeam as unknown[]).toHaveLength(1);
  });
});

describe('CustomersService.update', () => {
  const updateDto = (extra: Partial<UpdateCustomerDto>): UpdateCustomerDto => ({
    version: 4,
    ...extra,
  });
  const setOf = (h: Harness): Record<string, unknown> =>
    (h.calls.updateOne.mock.calls[0][3] as { $set: Record<string, unknown> })
      .$set;

  it('FR-01: không gửi phone (undefined) => giữ nguyên số cũ, searchText vẫn có số', async () => {
    const h = build();
    await h.service.update(jwt, 'c1', updateDto({ fullName: 'Tên Mới' }));
    expect(setOf(h).phone).toBe(PHONE_E164);
    expect(setOf(h).searchText).toBe('ten moi\n\n0912345678 84912345678');
  });

  it.each([
    ['null', null],
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng', '  '],
  ])(
    'FR-01: phone %s => xóa SĐT (lưu null), searchText 3 phần, audit from=số cũ to=null',
    async (_n, phone) => {
      const h = build();
      await h.service.update(jwt, 'c1', updateDto({ phone: phone }));
      expect(setOf(h).phone).toBeNull();
      expect(setOf(h).searchText).toBe('khach cu\n\n');
      const changes = (
        h.calls.auditRecord.mock.calls[0][0] as {
          changes: Array<Record<string, unknown>>;
        }
      ).changes;
      expect(changes).toEqual([{ field: 'phone', from: PHONE_E164, to: null }]);
    },
  );

  it('FR-01: khách chưa có SĐT, sửa tên không gửi phone => phone vẫn null, không ném lỗi', async () => {
    const h = build({ before: { phone: null } });
    await h.service.update(jwt, 'c1', updateDto({ fullName: 'Tên Mới' }));
    expect(setOf(h).phone).toBeNull();
    expect(setOf(h).searchText).toBe('ten moi\n\n');
  });

  it('FR-01: khách chưa có SĐT, thêm SĐT => chuẩn hóa E.164, audit from=null', async () => {
    const h = build({ before: { phone: null } });
    await h.service.update(jwt, 'c1', updateDto({ phone: '0912 345 678' }));
    expect(setOf(h).phone).toBe(PHONE_E164);
    const changes = (
      h.calls.auditRecord.mock.calls[0][0] as {
        changes: Array<Record<string, unknown>>;
      }
    ).changes;
    expect(changes).toEqual([{ field: 'phone', from: null, to: PHONE_E164 }]);
  });

  it('FR-01: khách chưa có SĐT và gửi phone null/rỗng => không đổi gì: không ghi, không audit', async () => {
    const h = build({ before: { phone: null } });
    await h.service.update(jwt, 'c1', updateDto({ phone: null }));
    await h.service.update(jwt, 'c1', updateDto({ phone: '' }));
    expect(h.calls.updateOne).not.toHaveBeenCalled();
    expect(h.calls.auditRecord).not.toHaveBeenCalled();
  });

  it('FR-02: đổi sang số đã có ở khách khác không bị chặn; lỗi DB ném nguyên vẹn, không đổi thành 409 trùng SĐT', async () => {
    const h = build();
    await h.service.update(jwt, 'c1', updateDto({ phone: '0987654321' }));
    expect(setOf(h).phone).toBe('+84987654321');

    const dup = Object.assign(new Error('E11000'), { code: 11000 });
    const h2 = build();
    h2.calls.updateOne.mockRejectedValueOnce(dup);
    await expect(
      h2.service.update(jwt, 'c1', updateDto({ phone: '0987654321' })),
    ).rejects.toBe(dup);
  });

  it('FR-01: phone sai định dạng => 400 INVALID_PHONE trước khi mở transaction', async () => {
    const h = build();
    await expect(
      h.service.update(jwt, 'c1', updateDto({ phone: 'xyz' })),
    ).rejects.toMatchObject({
      response: { errorCode: ErrorCode.INVALID_PHONE },
    });
    expect(h.calls.repoFindOne).not.toHaveBeenCalled();
  });
});
