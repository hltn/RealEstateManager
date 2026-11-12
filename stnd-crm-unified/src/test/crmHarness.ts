/**
 * Bộ dựng dùng chung cho unit test CRM: store riêng (không ghi localStorage) + `CrmApi` không trễ + actor theo `userId`.
 * Dữ liệu mẫu: hanh = MANAGER team-1, thao/tuan/trang = STAFF team-1, minh = MANAGER team-2, admin = ADMIN.
 */
import { buildActor, type CrmActor } from '@crm/api/access';
import { createCrmWriteApi, type CrmApi } from '@crm/api/crmWriteApi';
import { createCrmStore, createSeedDataState, type CrmDataState, type CrmStore } from '@crm/store';

export interface CrmHarness {
  store: CrmStore;
  api: CrmApi;
  state: () => CrmDataState;
  actor: () => CrmActor;
  /** Đổi người thao tác (không cần đăng nhập thật). */
  actAs: (userId: string) => void;
}

interface HarnessOptions {
  actAs?: string;
  /** Biến đổi dữ liệu mẫu trước khi dựng store (vd để một khách có nhóm chăm sóc rỗng). */
  mutate?: (data: CrmDataState) => CrmDataState;
}

export const createHarness = ({ actAs = 'hanh', mutate }: HarnessOptions = {}): CrmHarness => {
  const seed = createSeedDataState(new Date('2026-11-11T05:00:00Z'));
  const store = createCrmStore({ initialData: mutate ? mutate(seed) : seed, shouldPersist: false });
  let currentUserId = actAs;
  const state = (): CrmDataState => store.getState().state;
  const actor = (): CrmActor => {
    const { users, teams } = state();
    const user = users.find((item) => item.id === currentUserId);
    if (!user) throw new Error(`Không có người dùng mẫu ${currentUserId}`);
    return buildActor(user, teams);
  };
  const api = createCrmWriteApi({
    getState: () => store.getState().state,
    dispatch: (action) => store.getState().dispatch(action),
    getActor: actor,
    delayMs: 0,
  });
  return {
    store,
    api,
    state,
    actor,
    actAs: (userId) => {
      currentUserId = userId;
    },
  };
};

/** Xóa nhóm chăm sóc của một khách mẫu (mô phỏng khách cũ chưa có phụ trách chính). */
export const withEmptyCareTeam =
  (customerId: string) =>
  (data: CrmDataState): CrmDataState => ({
    ...data,
    customers: data.customers.map((customer) => (customer.id === customerId ? { ...customer, careTeam: [], primaryAssigneeId: null } : customer)),
  });

/** Bỏ SĐT của một khách mẫu (mô phỏng khách chưa có số, v1.0.5). */
export const withoutPhone =
  (customerId: string) =>
  (data: CrmDataState): CrmDataState => ({
    ...data,
    customers: data.customers.map((customer) => (customer.id === customerId ? { ...customer, phone: null } : customer)),
  });

/** Khóa tài khoản một người dùng mẫu (`isActive = false`) để kiểm nhãn "đã khóa". */
export const withLockedUser =
  (userId: string) =>
  (data: CrmDataState): CrmDataState => ({
    ...data,
    users: data.users.map((user) => (user.id === userId ? { ...user, isActive: false } : user)),
  });

/** Áp nhiều biến đổi dữ liệu mẫu theo thứ tự. */
export const composeMutations =
  (...mutations: ((data: CrmDataState) => CrmDataState)[]) =>
  (data: CrmDataState): CrmDataState =>
    mutations.reduce((current, mutation) => mutation(current), data);

/** Thêm `count` nhân viên (nhóm 1, đang hoạt động) tên "Thử 01…" để có nhiều hơn một trang người để mời (mỗi trang tối đa 20). */
export const withExtraStaff =
  (count: number) =>
  (data: CrmDataState): CrmDataState => {
    const template = data.users.find((user) => user.id === 'tuan');
    if (!template) throw new Error('Không có người dùng mẫu tuan');
    const extras = Array.from({ length: count }, (_, index) => {
      const suffix = String(index + 1).padStart(2, '0');
      return { ...template, id: `extra-${suffix}`, fullName: `Người Thử ${suffix}`, displayName: `Thử ${suffix}` };
    });
    return { ...data, users: [...data.users, ...extras] };
  };

/** Đặt nhóm chăm sóc của khách = giữ PRIMARY cũ + đúng `count` thành viên phụ (người thử "Thử 01…" được thêm kèm) — để dựng nhóm đầy 10/10. */
export const withCareTeamMembers =
  (customerId: string, count: number) =>
  (data: CrmDataState): CrmDataState => {
    const withStaff = withExtraStaff(count)(data);
    return {
      ...withStaff,
      customers: withStaff.customers.map((customer) => {
        if (customer.id !== customerId) return customer;
        const primary = customer.careTeam.filter((member) => member.role === 'PRIMARY');
        const members = Array.from({ length: count }, (_, index) => ({
          userId: `extra-${String(index + 1).padStart(2, '0')}`,
          role: 'MEMBER' as const,
          addedBy: primary[0]?.userId ?? 'admin',
          addedAt: '2026-11-01T00:00:00.000Z',
        }));
        return { ...customer, careTeam: [...primary, ...members] };
      }),
    };
  };
