/**
 * Dữ liệu dựng sẵn cho test CRM (chỉ import trong *.test.ts).
 * Thời điểm cố định 22/10/2026 10:00 giờ VN để kết quả "Quá hạn / Hôm nay / Sắp tới" ổn định.
 */
import { createMockCrmApi } from '@crm/api/mockCrmApi';
import { createInitialState, crmReducer, type CrmAction, type CrmState } from '@crm/store/crmReducer';
import { createSeedDataState } from '@crm/store/crmStore';

export const FIXED_NOW = new Date('2026-10-22T03:00:00.000Z');

export const createTestState = (currentUserId = 'hanh'): CrmState => createInitialState(createSeedDataState(FIXED_NOW), { currentUserId });

/** Store tối giản (state + dispatch qua reducer thật) + API mock gắn vào nó. */
export const createTestHarness = (currentUserId = 'hanh') => {
  let state = createTestState(currentUserId);
  let sequence = 0;
  const dispatch = (action: CrmAction) => {
    state = crmReducer(state, action);
  };
  const api = createMockCrmApi({
    getState: () => state,
    dispatch,
    now: () => FIXED_NOW,
    generateId: (prefix) => {
      sequence += 1;
      return `${prefix}-T${sequence}`;
    },
  });
  return {
    api,
    dispatch,
    getState: () => state,
    switchUser: (userId: string) => dispatch({ type: 'session/setUser', userId }),
  };
};
