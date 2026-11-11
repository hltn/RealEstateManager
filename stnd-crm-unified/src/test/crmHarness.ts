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
