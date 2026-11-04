/**
 * Store toàn cục của module CRM dùng Zustand (skill: state toàn cục bắt buộc Zustand/React Query).
 * Reducer thuần (`crmReducer`) vẫn là nơi duy nhất đổi state; Zustand giữ state + `dispatch` và cho phép
 * cả phần ngoài `/crm` (vd menu `AppSidebar`) đọc vai trò người dùng hiện tại để ẩn mục không đủ quyền.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { buildSeedData } from '@crm/data/mockData';
import { DEFAULT_CURRENT_USER_ID, DEFAULT_SETTINGS, SEED_CATALOGS, SEED_TEAMS, SEED_USERS } from '@crm/data/seedCatalogs';
import { seedNationalIds } from '@crm/lib/nationalIdVault';
import { createInitialState, crmReducer, type CrmAction, type CrmDataState, type CrmSession, type CrmState } from './crmReducer';
import { loadCrmData, loadCrmSession, saveCrmData, saveCrmSession } from './crmStorage';

export interface CrmStoreShape {
  state: CrmState;
  dispatch: (action: CrmAction) => void;
}

export type CrmStore = StoreApi<CrmStoreShape>;

/** Dữ liệu mẫu đầy đủ (danh mục + người dùng + khách/nhật ký/lịch hẹn) dựng theo thời điểm `now`. */
export const createSeedDataState = (now: Date = new Date()): CrmDataState => {
  const seed = buildSeedData(now);
  seedNationalIds(seed.nationalIds);
  return {
    users: SEED_USERS.map((user) => ({ ...user })),
    teams: SEED_TEAMS.map((team) => ({ ...team, managerIds: [...team.managerIds] })),
    catalogs: structuredClone(SEED_CATALOGS),
    settings: { ...DEFAULT_SETTINGS },
    customers: seed.customers,
    careLogs: seed.careLogs,
    appointments: seed.appointments,
    changeLogs: [],
    nationalIdViews: [],
    careTeamRequests: [],
    auditLogs: [],
  };
};

/** Dữ liệu rỗng: store chỉ giữ trạng thái giao diện (bộ lọc, modal) khi không bật mock nào. */
export const createEmptyDataState = (): CrmDataState => ({
  users: [],
  teams: [],
  catalogs: { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] },
  settings: { ...DEFAULT_SETTINGS },
  customers: [],
  careLogs: [],
  appointments: [],
  changeLogs: [],
  nationalIdViews: [],
  careTeamRequests: [],
  auditLogs: [],
});

/** Có tính năng nào còn chạy trên dữ liệu mẫu (Báo cáo/nhập-xuất, M8) không. */
const isMockDataNeeded = (): boolean => CRM_FEATURE_FLAGS.isMockReportsEnabled || CRM_FEATURE_FLAGS.isMockImportExportEnabled;

export interface CreateCrmStoreOptions {
  initialData?: CrmDataState;
  initialSession?: CrmSession;
  /** Lưu localStorage (mặc định true). Test truyền false. */
  shouldPersist?: boolean;
  /** Gọi khi không ghi được localStorage (hết dung lượng...). */
  onPersistError?: (reason: 'QUOTA' | 'UNAVAILABLE') => void;
}

type PersistErrorListener = (reason: 'QUOTA' | 'UNAVAILABLE') => void;
const persistErrorListeners = new Set<PersistErrorListener>();

/** Đăng ký nhận lỗi ghi localStorage của MỌI store (UI dùng để hiện toast). Trả hàm huỷ đăng ký. */
export const subscribePersistError = (listener: PersistErrorListener): (() => void) => {
  persistErrorListeners.add(listener);
  return () => persistErrorListeners.delete(listener);
};

const pickData = (state: CrmState): CrmDataState => ({
  users: state.users,
  teams: state.teams,
  catalogs: state.catalogs,
  settings: state.settings,
  customers: state.customers,
  careLogs: state.careLogs,
  appointments: state.appointments,
  changeLogs: state.changeLogs,
  nationalIdViews: state.nationalIdViews,
  careTeamRequests: state.careTeamRequests,
  auditLogs: state.auditLogs,
});

export const createCrmStore = ({ initialData, initialSession, shouldPersist: shouldPersistOption = true, onPersistError }: CreateCrmStoreOptions = {}): CrmStore => {
  // Không có dữ liệu mẫu nào cần dùng: không dựng/không lưu dữ liệu mẫu vào localStorage.
  const isMock = Boolean(initialData) || isMockDataNeeded();
  const shouldPersist = shouldPersistOption && isMock;
  const data = initialData ?? (isMock ? ((shouldPersist ? loadCrmData() : null) ?? createSeedDataState()) : createEmptyDataState());
  const storedSession = initialSession ?? (shouldPersist ? loadCrmSession() : null);
  const session: CrmSession =
    storedSession && data.users.some((user) => user.id === storedSession.currentUserId)
      ? storedSession
      : { currentUserId: data.users.some((user) => user.id === DEFAULT_CURRENT_USER_ID) ? DEFAULT_CURRENT_USER_ID : (data.users[0]?.id ?? '') };

  const store = createStore<CrmStoreShape>()((set, get) => ({
    state: createInitialState(data, session),
    dispatch: (action) => set({ state: crmReducer(get().state, action) }),
  }));

  if (shouldPersist) {
    const persist = () => {
      const result = saveCrmData(pickData(store.getState().state));
      if (!result.ok) {
        onPersistError?.(result.reason);
        persistErrorListeners.forEach((listener) => listener(result.reason));
      }
    };
    persist();
    store.subscribe(({ state }, { state: previous }) => {
      // Chỉ ghi khi phần dữ liệu nghiệp vụ đổi tham chiếu (bộ lọc/modal không cần lưu).
      const hasDataChanged = (Object.keys(pickData(state)) as (keyof CrmDataState)[]).some((key) => state[key] !== previous[key]);
      if (hasDataChanged) persist();
      if (state.session !== previous.session) saveCrmSession(state.session);
    });
  }
  return store;
};

let defaultStore: CrmStore | null = null;

/** Store dùng chung của ứng dụng (tạo lần đầu khi cần). */
export const getDefaultCrmStore = (): CrmStore => {
  defaultStore ??= createCrmStore();
  return defaultStore;
};
