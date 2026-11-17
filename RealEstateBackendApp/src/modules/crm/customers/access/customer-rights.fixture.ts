/**
 * Fixture dùng chung cho các test "khóa hiện trạng quyền CRM" (T-54, FR-31). KHÔNG đi vào bản build
 * (`tsconfig.build` loại `*.fixture.ts`).
 *
 * Ý tưởng: dựng `CustomersRepository` THẬT trên một model Mongoose giả tự đánh giá bộ lọc trong bộ nhớ và dùng
 * `buildCustomerScope` THẬT, nên "ngoài phạm vi" trong test là hành vi thật (khách không tìm thấy => 404) chứ
 * không phải mock `findOne`. Nới/siết điều kiện trong `buildCustomerScope` sẽ làm test đổi màu.
 *
 * Bộ lọc hỗ trợ: `$and`, `$or`, khóa phẳng/đường dẫn chấm (`'careTeam.userId'`), so sánh bằng (ObjectId theo giá trị),
 * `$in`, `$ne`. Toán tử khác sẽ ném lỗi để fixture không "khớp nhầm" khi scope đổi sang cú pháp mới.
 */
import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import type { JwtPayload } from '../../../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../../../common/exceptions/error-codes';
import type { CrmActor } from '../../common/access/crm-actor';
import { CareRole } from '../customer.constants';
import { CustomersRepository } from '../customers.repository';
import type { AccessContext } from './customer-access.service';
import { buildCustomerScope } from './customer-scope';

type Doc = Record<string, unknown>;

const oid = (): Types.ObjectId => new Types.ObjectId();

/** Chuỗi query Mongoose giả: `.session().lean().sort().select().exec()` cùng trả một kết quả. */
export const chain = <T>(result: T) => {
  const query: Record<string, jest.Mock> = {};
  for (const name of ['session', 'lean', 'sort', 'select']) {
    query[name] = jest.fn(() => query);
  }
  query.exec = jest.fn(() => Promise.resolve(result));
  return query;
};

// --------------------------------------------------------------------------------------------
// Bộ đánh giá bộ lọc Mongo tối thiểu
// --------------------------------------------------------------------------------------------

const isId = (value: unknown): value is Types.ObjectId =>
  value instanceof Types.ObjectId;

const sameValue = (left: unknown, right: unknown): boolean => {
  if (isId(left) && isId(right)) return left.equals(right);
  return (left ?? null) === (right ?? null);
};

/** Mọi giá trị tại đường dẫn chấm; mảng được trải phẳng (như Mongo so khớp phần tử mảng). */
const valuesAt = (doc: Doc, path: string): unknown[] => {
  let current: unknown[] = [doc];
  for (const key of path.split('.')) {
    current = current.flatMap((item) => {
      if (item === null || typeof item !== 'object') return [];
      const value = (item as Doc)[key];
      return Array.isArray(value) ? value : [value];
    });
  }
  return current.map((value) => value ?? null);
};

const matchesCondition = (values: unknown[], condition: unknown): boolean => {
  const isOperator =
    condition !== null &&
    typeof condition === 'object' &&
    !isId(condition) &&
    !(condition instanceof Date);
  if (!isOperator) return values.some((value) => sameValue(value, condition));
  return Object.entries(condition as Doc).every(([operator, argument]) => {
    switch (operator) {
      case '$in':
        return values.some((value) =>
          (argument as unknown[]).some((item) => sameValue(value, item)),
        );
      case '$ne':
        return !values.some((value) => sameValue(value, argument));
      default:
        throw new Error(`Fixture chưa hỗ trợ toán tử ${operator}`);
    }
  });
};

export const matchesFilter = (doc: Doc, filter: Doc): boolean =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') {
      return (condition as Doc[]).every((part) => matchesFilter(doc, part));
    }
    if (key === '$or') {
      return (condition as Doc[]).some((part) => matchesFilter(doc, part));
    }
    if (key.startsWith('$')) {
      throw new Error(`Fixture chưa hỗ trợ toán tử cấp cao ${key}`);
    }
    return matchesCondition(valuesAt(doc, key), condition);
  });

// --------------------------------------------------------------------------------------------
// Thế giới thử nghiệm: nhóm, người dùng, khách
// --------------------------------------------------------------------------------------------

export const TEAM_A = oid(); // nhóm của người tạo (nhóm "chủ" của khách)
export const TEAM_B = oid(); // nhóm của người được mời (staff)
export const TEAM_C = oid(); // nhóm không liên quan
export const TEAM_D = oid(); // nhóm của Quản lý được mời chéo

const makeActor = (
  role: UserRole,
  displayName: string,
  teamIds: Types.ObjectId[],
  managedTeamIds: Types.ObjectId[] = [],
): CrmActor => ({
  userId: oid(),
  role,
  roles: [role],
  displayName,
  teamId: teamIds[0] ?? null,
  teamIds,
  managedTeamIds,
});

/**
 * Các vai trong bài toán. Quan hệ với khách `buildCustomer()`:
 * - `STAFF_PRIMARY`: người tạo, PRIMARY (người tạo LUÔN nằm trong careTeam, không dùng "người tạo ngoài careTeam").
 * - `STAFF_MEMBER`, `STAFF_INVITED`, `MANAGER_INCARE`: MEMBER trong careTeam (INVITED/INCARE thuộc nhóm khác).
 * - `MANAGER_OWNER`: Quản lý nhóm chủ (TEAM_A), thấy khách qua `teamIds`, KHÔNG trong careTeam, KHÔNG phải người tạo.
 * - `MANAGER_R8`: Quản lý nhóm của người được mời (TEAM_B), thấy khách qua `teamIds` (ô R8 của ma trận), không trong careTeam.
 * - `MANAGER_OUT` / `STAFF_OUT`: ngoài phạm vi (không giao nhóm, không trong careTeam, không phải người tạo).
 */
export const USERS = {
  ADMIN: makeActor(UserRole.ADMIN, 'Admin', []),
  MANAGER_OWNER: makeActor(
    UserRole.MANAGER,
    'Quản lý nhóm chủ',
    [TEAM_A],
    [TEAM_A],
  ),
  MANAGER_R8: makeActor(
    UserRole.MANAGER,
    'Quản lý nhóm khác (R8)',
    [TEAM_B],
    [TEAM_B],
  ),
  MANAGER_INCARE: makeActor(
    UserRole.MANAGER,
    'Quản lý được mời chéo',
    [TEAM_D],
    [TEAM_D],
  ),
  MANAGER_OUT: makeActor(
    UserRole.MANAGER,
    'Quản lý ngoài phạm vi',
    [TEAM_C],
    [TEAM_C],
  ),
  STAFF_PRIMARY: makeActor(UserRole.STAFF, 'Nhân viên tạo (PRIMARY)', [TEAM_A]),
  STAFF_MEMBER: makeActor(UserRole.STAFF, 'Nhân viên cùng chăm sóc', [TEAM_A]),
  STAFF_INVITED: makeActor(UserRole.STAFF, 'Nhân viên được mời', [TEAM_B]),
  STAFF_OUT: makeActor(UserRole.STAFF, 'Nhân viên ngoài careTeam', [TEAM_C]),
} as const;

export type UserKey = keyof typeof USERS;

/** Người trong phạm vi của khách mặc định (b) và người ngoài phạm vi (a, c). */
export const IN_SCOPE_KEYS: UserKey[] = [
  'ADMIN',
  'MANAGER_OWNER',
  'MANAGER_R8',
  'MANAGER_INCARE',
  'STAFF_PRIMARY',
  'STAFF_MEMBER',
  'STAFF_INVITED',
];
export const OUT_OF_SCOPE_KEYS: UserKey[] = ['MANAGER_OUT', 'STAFF_OUT'];

const entry = (actor: CrmActor, role: CareRole) => ({
  userId: actor.userId,
  role,
  addedBy: USERS.STAFF_PRIMARY.userId,
  addedAt: new Date('2026-01-01T00:00:00Z'),
});

export const defaultCareTeam = () => [
  entry(USERS.STAFF_PRIMARY, CareRole.PRIMARY),
  entry(USERS.STAFF_MEMBER, CareRole.MEMBER),
  entry(USERS.STAFF_INVITED, CareRole.MEMBER),
  entry(USERS.MANAGER_INCARE, CareRole.MEMBER),
];

/** Khách mặc định: tạo bởi `STAFF_PRIMARY` (đang là PRIMARY), `teamIds` = hợp nhóm các thành viên. */
export const buildCustomer = (
  overrides: Doc = {},
): Doc & { _id: Types.ObjectId } => ({
  _id: oid(),
  fullName: 'Khách thử',
  statusId: oid(),
  careTeam: defaultCareTeam(),
  teamIds: [TEAM_A, TEAM_B, TEAM_D],
  primaryAssigneeId: USERS.STAFF_PRIMARY.userId,
  createdBy: USERS.STAFF_PRIMARY.userId,
  hasNationalId: true,
  nationalId: { cipherText: 'c', iv: 'i', authTag: 't', keyVersion: 1 },
  criteria: {},
  progress: 0,
  lastUpdatedAt: new Date('2026-01-02T00:00:00Z'),
  deletedAt: null,
  __v: 1,
  ...overrides,
});

/**
 * Khách cũ: người tạo (`STAFF_PRIMARY`) chỉ là MEMBER còn PRIMARY là `STAFF_MEMBER` (PRIMARY KHÁC người tạo).
 * Dùng cho các ô "PRIMARY không phải người tạo" và "gỡ người tạo là MEMBER".
 */
export const buildCustomerWithOtherPrimary = (
  overrides: Doc = {},
): Doc & { _id: Types.ObjectId } =>
  buildCustomer({
    careTeam: defaultCareTeam().map((member) => ({
      ...member,
      role: member.userId.equals(USERS.STAFF_MEMBER.userId)
        ? CareRole.PRIMARY
        : CareRole.MEMBER,
    })),
    primaryAssigneeId: USERS.STAFF_MEMBER.userId,
    ...overrides,
  });

// --------------------------------------------------------------------------------------------
// Repository thật trên model giả + AccessService giả dùng scope thật
// --------------------------------------------------------------------------------------------

export interface RecordedUpdate {
  filter: Doc;
  update: Doc;
  matched: boolean;
}

export const buildScopedRepo = (customers: Doc[]) => {
  const updates: RecordedUpdate[] = [];
  const find = (filter: Doc): Doc | null =>
    customers.find((doc) => matchesFilter(doc, filter)) ?? null;
  const model = {
    findOne: jest.fn((filter: Doc) => {
      const hit = find(filter);
      return chain(hit ? { ...hit } : null);
    }),
    updateOne: jest.fn((filter: Doc, update: Doc) => {
      const hit = find(filter);
      updates.push({ filter, update, matched: !!hit });
      return chain({ matchedCount: hit ? 1 : 0 });
    }),
  };
  const repo = new CustomersRepository(model as never);
  return { repo, model, updates };
};

/** `CustomerAccessService` giả: `jwt.sub` chọn người dùng, scope do `buildCustomerScope` THẬT dựng. */
export const buildAccess = () => {
  const byId = new Map(
    Object.values(USERS).map((actor) => [String(actor.userId), actor]),
  );
  return {
    resolve: jest.fn((jwt: JwtPayload): Promise<AccessContext> => {
      const actor = byId.get(jwt.sub);
      if (!actor) return Promise.reject(new Error(`Không có actor ${jwt.sub}`));
      return Promise.resolve({ actor, scope: buildCustomerScope(actor) });
    }),
  };
};

/** JWT đầy đủ kiểu `JwtPayload` của vai fixture (`sub` chọn người dùng, email/role theo vai). */
export const jwtOf = (key: UserKey): JwtPayload => ({
  sub: String(USERS[key].userId),
  email: `${key.toLowerCase()}@fixture.test`,
  role: USERS[key].role,
  roles: [...USERS[key].roles],
});

export const ctxOf = (key: UserKey): AccessContext => ({
  actor: USERS[key],
  scope: buildCustomerScope(USERS[key]),
});

/** Kết nối giả cho `withTransaction` thật: chạy `work` đúng một lần với session giả. */
export const fakeConnection = () => ({
  transaction: jest.fn((work: (session: unknown) => Promise<unknown>) =>
    work({ id: 'tx-session' }),
  ),
});

/** Hình dạng lỗi hiện tại cho `rejects.toMatchObject(...)` (mã lỗi + HTTP status). */
export const REJECTS = {
  CUSTOMER_NOT_FOUND: { errorCode: ErrorCode.CUSTOMER_NOT_FOUND, status: 404 },
  RESOURCE_NOT_FOUND: { errorCode: ErrorCode.RESOURCE_NOT_FOUND, status: 404 },
  INSUFFICIENT_ROLE: { status: 403, message: 'Insufficient role' },
  CUSTOMER_NOT_DROPPED: {
    errorCode: ErrorCode.CUSTOMER_NOT_DROPPED,
    status: 409,
  },
  NATIONAL_ID_FORBIDDEN: {
    errorCode: ErrorCode.NATIONAL_ID_FORBIDDEN,
    status: 403,
  },
  CARE_TEAM_ACTION_FORBIDDEN: {
    errorCode: ErrorCode.CARE_TEAM_ACTION_FORBIDDEN,
    status: 403,
  },
  PRIMARY_LOCKED: { errorCode: ErrorCode.PRIMARY_LOCKED, status: 409 },
  USER_NOT_ASSIGNABLE: {
    errorCode: ErrorCode.USER_NOT_ASSIGNABLE,
    status: 400,
  },
} as const;
