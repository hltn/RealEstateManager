/**
 * Reducer thuần của store CRM dùng chung (desktop + mobile).
 * - Không giữ state điều hướng: màn hiện tại suy ra từ URL (react-router), xem `modules/crm/routes.ts`.
 * - Không side effect (id, thời gian, toast, điều hướng... nằm ở action creator trong CrmProvider).
 * - Mỗi action làm đúng 1 việc; luồng nhiều bước (thêm khách -> chọn -> mở chi tiết)
 *   được ghép ở action creator để dễ test và tái sử dụng.
 */
import {
  DEFAULT_FILTERS,
  INITIAL_APPOINTMENTS,
  INITIAL_CARE_LOGS,
  INITIAL_CUSTOMERS,
  INITIAL_DAILY_TASKS,
} from '@crm/data/mockData';
import type { ActiveModal } from '@crm/types/app';
import type { Appointment, CareLog, Customer, DailyTask, FilterOptions } from '@crm/types/crm';

/** Phần dữ liệu nghiệp vụ được lưu localStorage. */
export interface CrmDataState {
  customers: Customer[];
  careLogs: CareLog[];
  appointments: Appointment[];
  tasks: DailyTask[];
}

export interface CrmState extends CrmDataState {
  filters: FilterOptions;
  /**
   * Khách đang chọn. Trên route `/crm/customers/:customerId/*`, CrmProvider ghi đè giá trị này bằng id trong URL
   * (URL là nguồn sự thật); ngoài các route đó giữ khách chọn gần nhất.
   */
  selectedCustomerId: string | null;
  activeModal: ActiveModal | null;
}

export type CustomerChanges = Partial<Omit<Customer, 'id'>>;

export type CrmAction =
  | { type: 'customers/select'; customerId: string }
  | { type: 'customers/add'; customer: Customer }
  | { type: 'customers/update'; customerId: string; changes: CustomerChanges }
  | { type: 'careLogs/add'; careLog: CareLog }
  | { type: 'appointments/add'; appointment: Appointment; task?: DailyTask }
  | { type: 'appointments/toggleCompleted'; appointmentId: string }
  | { type: 'filters/set'; changes: Partial<FilterOptions> }
  | { type: 'filters/resetAdvanced' }
  | { type: 'data/reset'; data: CrmDataState }
  | { type: 'modal/open'; modal: ActiveModal }
  | { type: 'modal/close' };

/** Dữ liệu mẫu ban đầu (bản sao nông để tránh sửa nhầm hằng số mock). */
export const createSeedData = (): CrmDataState => ({
  customers: [...INITIAL_CUSTOMERS],
  careLogs: [...INITIAL_CARE_LOGS],
  appointments: [...INITIAL_APPOINTMENTS],
  tasks: [...INITIAL_DAILY_TASKS],
});

export const createInitialState = (data: CrmDataState = createSeedData()): CrmState => ({
  ...data,
  filters: DEFAULT_FILTERS,
  selectedCustomerId: data.customers[0]?.id ?? null,
  activeModal: null,
});

const updateCustomer = (state: CrmState, customerId: string, changes: CustomerChanges): CrmState => {
  const hasCustomer = state.customers.some((customer) => customer.id === customerId);
  if (!hasCustomer) return state;
  return {
    ...state,
    customers: state.customers.map((customer) =>
      customer.id === customerId ? { ...customer, ...changes, id: customer.id } : customer,
    ),
  };
};

export const crmReducer = (state: CrmState, action: CrmAction): CrmState => {
  switch (action.type) {
    case 'customers/select':
      return state.customers.some((customer) => customer.id === action.customerId)
        ? { ...state, selectedCustomerId: action.customerId }
        : state;

    case 'customers/add':
      return { ...state, customers: [action.customer, ...state.customers] };

    case 'customers/update':
      return updateCustomer(state, action.customerId, action.changes);

    case 'careLogs/add':
      return { ...state, careLogs: [action.careLog, ...state.careLogs] };

    case 'appointments/add':
      return {
        ...state,
        appointments: [action.appointment, ...state.appointments],
        tasks: action.task ? [action.task, ...state.tasks] : state.tasks,
      };

    case 'appointments/toggleCompleted':
      return {
        ...state,
        appointments: state.appointments.map((appointment) =>
          appointment.id === action.appointmentId
            ? { ...appointment, isCompleted: !appointment.isCompleted }
            : appointment,
        ),
      };

    case 'filters/set':
      return { ...state, filters: { ...state.filters, ...action.changes } };

    case 'filters/resetAdvanced':
      // Giữ từ khoá & trạng thái, chỉ xoá phần bộ lọc nâng cao (như bản Mobile).
      return {
        ...state,
        filters: { ...state.filters, projectsSelected: [], project: 'all', staff: 'all', timeRange: 'month' },
      };

    case 'data/reset':
      return {
        ...state,
        ...action.data,
        selectedCustomerId: action.data.customers[0]?.id ?? null,
        activeModal: null,
      };

    case 'modal/open':
      return { ...state, activeModal: action.modal };

    case 'modal/close':
      return state.activeModal === null ? state : { ...state, activeModal: null };

    default:
      return state;
  }
};
