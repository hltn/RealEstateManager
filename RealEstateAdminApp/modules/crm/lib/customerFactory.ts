import type { C4Criteria, Customer } from '@crm/types/crm';
import { C4_CRITERION_PERCENT } from './customerAdapters';

/** Bộ tiêu chí C4 rỗng (chưa đạt tiêu chí nào). */
export const createEmptyC4Criteria = (): C4Criteria => ({
  demand: { achieved: false, text: '', percent: C4_CRITERION_PERCENT },
  motivation: { achieved: false, text: '', percent: C4_CRITERION_PERCENT },
  finance: { achieved: false, text: '', percent: C4_CRITERION_PERCENT },
  timing: { achieved: false, text: '', percent: C4_CRITERION_PERCENT },
});

/**
 * Tạo Customer đầy đủ trường với giá trị mặc định an toàn.
 * Dùng cho form "Thêm khách hàng" và mock data (chỉ cần truyền trường khác mặc định).
 */
export const createEmptyCustomer = (overrides: Partial<Customer> & Pick<Customer, 'id'>): Customer => ({
  code: '',
  name: '',
  phone: '',
  email: '',
  idNumber: '',
  isVip: false,
  status: 'Chưa tiếp cận',
  progressPercentage: 25,
  progressStep: 'Mới tiếp nhận',
  currentResidence: '',
  hometown: '',
  birthDate: '',
  remindBirthday: false,
  maritalStatus: '',
  children: '',
  occupation: '',
  businessField: '',
  decisionMaker: 'Khách tự quyết',
  lifestyleTags: [],
  freeTimeSlot: '',
  preferredContactMethod: 'Điện thoại',
  preferredSalutation: '',
  staffLead: '',
  staffSupport: [],
  teamGroup: '',
  interestedProjects: [],
  budgetMin: 0,
  budgetMax: 0,
  equityRatio: '',
  loanIncentive: false,
  propertyType: 'Căn hộ chung cư',
  bedroomType: '',
  purchasePurposes: [],
  criteriaPriorities: [],
  searchArea: '',
  specificLocation: '',
  leadSource: '',
  targetPurchaseTime: '',
  notes: '',
  c4Criteria: createEmptyC4Criteria(),
  ...overrides,
});

/** Mã hiển thị tiếp theo, vd 11 khách -> "#12". */
export const getNextCustomerCode = (customers: Pick<Customer, 'code'>[]): string => {
  const maxCode = customers.reduce((max, customer) => {
    const numeric = Number(customer.code.replace(/\D/g, ''));
    return Number.isFinite(numeric) && numeric > max ? numeric : max;
  }, 0);
  return `#${String(maxCode + 1).padStart(2, '0')}`;
};
