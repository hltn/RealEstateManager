/**
 * Action creator của store CRM: gộp toàn bộ handler của 2 App.tsx (Admin + Mobile).
 * Tách khỏi React: nhận `dispatch` + `getState` + cầu nối router + các phụ thuộc thời gian.
 * - Điều hướng: `navigate(view)` -> `router.navigateTo(buildCrmPath(view, ...))` (react-router, xem CrmProvider).
 * - Toast: `react-hot-toast` (Toaster toàn cục ở main.tsx), không giữ toast trong store.
 */
import toast from 'react-hot-toast';
import { CURRENT_USER } from '@crm/data/mockData';
import {
  createTaskFromAppointment,
  getAppointmentCustomerSnapshot,
} from '@crm/lib/appointmentAdapters';
import { getNextCustomerCode } from '@crm/lib/customerFactory';
import { getCurrentStamp } from '@crm/lib/dateTime';
import { createId } from '@crm/lib/id';
import { buildCrmPath } from '@crm/routes';
import type { ActiveModal, ToastInput, ViewId } from '@crm/types/app';
import type { Appointment, CareLog, Customer, FilterOptions, GalleryImage } from '@crm/types/crm';
import type { CrmAction, CrmDataState, CrmState, CustomerChanges } from './crmReducer';
import { selectCustomerById } from './selectors';

export const TOAST_DURATION_MS = 3500;

/** Cầu nối tới react-router — CrmProvider tạo từ `useNavigate()`. */
export interface CrmNavigateOptions {
  /** Thay mục lịch sử hiện tại (dùng sau khi lưu form: nút Back không quay về form trống). */
  shouldReplace?: boolean;
}

export interface CrmRouterBridge {
  /** Chuyển tới URL tuyệt đối (vd `/crm/customers/CUST-1`). */
  navigateTo: (path: string, options?: CrmNavigateOptions) => void;
  /** Quay lại: lùi lịch sử trình duyệt nếu có, nếu không thì về màn cha. */
  goBack: () => void;
}

/** Nhật ký mới: bắt buộc customerId + content; tác giả/thời gian mặc định = người dùng hiện tại/bây giờ. */
export type NewCareLogInput = Pick<CareLog, 'customerId' | 'content'> &
  Partial<Omit<CareLog, 'id' | 'customerId' | 'content'>>;

/** Khách mới: id và code tự sinh nếu không truyền. */
export type NewCustomerInput = Omit<Customer, 'id' | 'code'> & Partial<Pick<Customer, 'id' | 'code'>>;

/** Lịch hẹn mới: snapshot tên/SĐT/tag khách tự lấy từ hồ sơ nếu không truyền. */
export type NewAppointmentInput = Omit<
  Appointment,
  'id' | 'isCompleted' | 'customerName' | 'customerPhone' | 'customerTag'
> &
  Partial<Pick<Appointment, 'customerName' | 'customerPhone' | 'customerTag' | 'isCompleted'>>;

export interface QuickNoteInput {
  customerId: string;
  content: string;
  /** Tình trạng phản hồi, vd "Khách quan tâm giá / Cần gửi bảng tính". */
  responseStatus?: string;
  /** Lịch nhắc lại, vd "Hẹn chiều mai (15:00)". */
  reminder?: string;
}

export interface CallResultInput {
  customerId: string;
  note: string;
  callOutcome: string;
}

export interface ZaloMessageInput {
  customerId: string;
  message: string;
}

export interface UpdateCustomerOptions {
  /** Tiêu đề toast thành công; bỏ trống = không hiện toast. */
  toastTitle?: string;
}

export interface CrmActions {
  // ----- Điều hướng -----
  navigate: (view: ViewId) => void;
  goBack: () => void;
  /** Chọn khách; mặc định mở luôn màn chi tiết (`shouldOpenDetail: true`). */
  selectCustomer: (customerId: string, options?: { shouldOpenDetail?: boolean } & CrmNavigateOptions) => void;

  // ----- Khách hàng -----
  addCustomer: (input: NewCustomerInput) => Customer;
  updateCustomer: (customerId: string, changes: CustomerChanges, options?: UpdateCustomerOptions) => void;

  // ----- Nhật ký chăm sóc -----
  addCareLog: (input: NewCareLogInput, options?: { toastTitle?: string }) => CareLog;
  saveQuickNote: (input: QuickNoteInput) => void;
  logCallResult: (input: CallResultInput) => void;
  logZaloMessage: (input: ZaloMessageInput) => void;

  // ----- Lịch hẹn -----
  addAppointment: (input: NewAppointmentInput) => Appointment;
  toggleAppointmentCompleted: (appointmentId: string) => void;

  // ----- Bộ lọc / dữ liệu -----
  setFilters: (changes: Partial<FilterOptions>) => void;
  resetAdvancedFilters: () => void;
  resetData: () => void;
  exportReport: () => void;
  logout: () => void;

  // ----- Toast (react-hot-toast) -----
  showToast: (input: ToastInput) => string;
  dismissToast: (toastId: string) => void;

  // ----- Modal toàn cục -----
  openModal: (modal: ActiveModal) => void;
  openCallModal: (customerId: string) => void;
  openZaloModal: (customerId: string) => void;
  openQuickNote: (customerId: string) => void;
  openLightbox: (images: GalleryImage[], startIndex?: number, title?: string) => void;
  openAdvancedFilter: () => void;
  closeModal: () => void;
}

export interface CrmActionDependencies {
  dispatch: (action: CrmAction) => void;
  getState: () => CrmState;
  /** Dữ liệu mẫu dùng khi "Khôi phục dữ liệu mẫu". */
  createSeedData: () => CrmDataState;
  /** Xoá dữ liệu đã lưu (localStorage). */
  clearPersistedData?: () => void;
  router: CrmRouterBridge;
  now?: () => Date;
  generateId?: (prefix: string) => string;
}

export const createCrmActions = ({
  dispatch,
  getState,
  createSeedData,
  clearPersistedData,
  router,
  now = () => new Date(),
  generateId = createId,
}: CrmActionDependencies): CrmActions => {
  const getCustomerName = (customerId: string): string =>
    selectCustomerById(getState(), customerId)?.name ?? 'khách hàng';

  /** Hiển thị toast qua react-hot-toast; `message` (nếu có) xuống dòng dưới `title`. */
  const showToast: CrmActions['showToast'] = ({ type = 'success', title, message }) => {
    const content = message ? `${title}
${message}` : title;
    const options = { duration: TOAST_DURATION_MS, style: { whiteSpace: 'pre-line' as const } };
    if (type === 'success') return toast.success(content, options);
    if (type === 'error') return toast.error(content, options);
    return toast(content, options);
  };

  const navigateToView = (view: ViewId, options?: CrmNavigateOptions) =>
    router.navigateTo(buildCrmPath(view, getState().selectedCustomerId), options);

  const navigate: CrmActions['navigate'] = (view) => navigateToView(view);

  /** Chọn khách rồi (mặc định) mở `/crm/customers/:id` — id đi thẳng vào URL, không chờ state cập nhật. */
  const selectCustomer: CrmActions['selectCustomer'] = (customerId, options) => {
    dispatch({ type: 'customers/select', customerId });
    if (options?.shouldOpenDetail ?? true) {
      router.navigateTo(buildCrmPath('customer_detail', customerId), { shouldReplace: options?.shouldReplace });
    }
  };

  const addCareLog: CrmActions['addCareLog'] = (input, options) => {
    const stamp = getCurrentStamp(now());
    const careLog: CareLog = {
      author: CURRENT_USER.displayName,
      authorRole: CURRENT_USER.role,
      date: stamp.date,
      time: stamp.time,
      ...input,
      id: generateId('LOG'),
    };
    dispatch({ type: 'careLogs/add', careLog });
    if (options?.toastTitle) showToast({ title: options.toastTitle });
    return careLog;
  };

  const openModal: CrmActions['openModal'] = (modal) => dispatch({ type: 'modal/open', modal });

  return {
    navigate,
    goBack: router.goBack,
    selectCustomer,

    addCustomer: (input) => {
      const customer: Customer = {
        ...input,
        id: input.id ?? generateId('CUST'),
        code: input.code || getNextCustomerCode(getState().customers),
      };
      dispatch({ type: 'customers/add', customer });
      // `replace`: thay URL form bằng trang chi tiết -> Back không quay về form trống.
      selectCustomer(customer.id, { shouldReplace: true });
      showToast({ title: 'Thêm khách hàng thành công!', message: `${customer.name} đã được thêm vào hệ thống.` });
      return customer;
    },

    updateCustomer: (customerId, changes, options) => {
      dispatch({ type: 'customers/update', customerId, changes });
      if (options?.toastTitle) showToast({ title: options.toastTitle });
    },

    addCareLog,

    saveQuickNote: ({ customerId, content, responseStatus, reminder }) => {
      // Gộp nội dung theo định dạng Mobile: "<tình trạng>: <nội dung>. (<nhắc lại>)"
      const prefix = responseStatus ? `${responseStatus}: ` : '';
      const suffix = reminder ? `. (${reminder})` : '';
      addCareLog({ customerId, content: `${prefix}${content}${suffix}`, tag: 'Ghi chú nhanh' });
      dispatch({ type: 'customers/update', customerId, changes: { notesSummary: content } });
      showToast({ title: `Đã ghi nhận tương tác cho ${getCustomerName(customerId)}!` });
    },

    logCallResult: ({ customerId, note, callOutcome }) => {
      addCareLog(
        { customerId, content: note, contactMethod: 'Điện thoại', callResult: callOutcome, tag: 'Cuộc gọi vừa xong' },
        { toastTitle: 'Đã lưu cuộc gọi vào nhật ký chăm sóc!' },
      );
    },

    logZaloMessage: ({ customerId, message }) => {
      addCareLog(
        { customerId, content: `[Zalo ZNS đã gửi]: "${message}"`, contactMethod: 'Nhắn Zalo', tag: 'Đã đọc tin' },
        { toastTitle: `Đã gửi Zalo cho ${getCustomerName(customerId)}!` },
      );
    },

    addAppointment: (input) => {
      const customer = selectCustomerById(getState(), input.customerId);
      const snapshot = customer
        ? getAppointmentCustomerSnapshot(customer)
        : { customerId: input.customerId, customerName: '', customerPhone: '', customerTag: '' };
      const appointment: Appointment = {
        isCompleted: false,
        ...snapshot,
        ...input,
        id: generateId('APT'),
      };
      const task = createTaskFromAppointment(appointment, generateId('TASK'), customer ?? undefined);
      dispatch({ type: 'appointments/add', appointment, task });
      // `replace`: thay URL form bằng danh sách lịch hẹn -> Back không quay về form trống.
      navigateToView('appointments', { shouldReplace: true });
      showToast({ title: 'Tạo lịch hẹn thành công!', message: `Lịch hẹn với ${appointment.customerName} đã được lưu.` });
      return appointment;
    },

    toggleAppointmentCompleted: (appointmentId) => {
      dispatch({ type: 'appointments/toggleCompleted', appointmentId });
      showToast({ title: 'Đã cập nhật trạng thái lịch hẹn!' });
    },

    setFilters: (changes) => dispatch({ type: 'filters/set', changes }),
    resetAdvancedFilters: () => dispatch({ type: 'filters/resetAdvanced' }),

    resetData: () => {
      clearPersistedData?.();
      dispatch({ type: 'data/reset', data: createSeedData() });
      showToast({ title: 'Đã khôi phục dữ liệu mẫu ban đầu!', type: 'info' });
    },

    exportReport: () => {
      showToast({ title: 'Đang xuất báo cáo STND...', message: 'File Excel/PDF đang được tạo tải xuống.', type: 'info' });
    },

    logout: () => {
      showToast({ title: 'Đã đăng xuất tài khoản an toàn.', type: 'info' });
    },

    showToast,
    dismissToast: (toastId) => toast.dismiss(toastId),

    openModal,
    openCallModal: (customerId) => openModal({ kind: 'call', customerId }),
    openZaloModal: (customerId) => openModal({ kind: 'zalo', customerId }),
    openQuickNote: (customerId) => openModal({ kind: 'quick_note', customerId }),
    openLightbox: (images, startIndex = 0, title) => {
      if (images.length === 0) return;
      openModal({ kind: 'lightbox', images, startIndex, title });
    },
    openAdvancedFilter: () => openModal({ kind: 'advanced_filter' }),
    closeModal: () => dispatch({ type: 'modal/close' }),
  };
};
