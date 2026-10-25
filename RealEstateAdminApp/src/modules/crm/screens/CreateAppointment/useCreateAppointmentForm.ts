/**
 * State + hành vi form "Tạo lịch hẹn mới" dùng chung desktop/mobile.
 * Luồng: sửa trường -> (sau lần bấm lưu đầu) validate ngay -> `POST /crm/appointments` (cập nhật `nextAppointmentAt` của khách)
 * -> về danh sách lịch hẹn. Không hợp lệ: toast lỗi + focus trường lỗi đầu tiên.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useCrmApi, useCustomerDetail, useCustomerList, type CustomerDetail, type CustomerListItem } from '@crm/api';
import { useDebouncedValue } from '@crm/hooks/useDebouncedValue';
import { getVnTodayKey } from '@crm/lib/dateTime';
import { useCrmActions, useCrmState, useCurrentUser } from '@crm/store';
import {
  CALL_LOCATION,
  createInitialValues,
  FIELD_ORDER,
  getDefaultAssigneeId,
  getFieldId,
  toCreateAppointmentInput,
  validateAppointmentForm,
  type AppointmentFormErrors,
  type AppointmentFormValues,
} from './createAppointmentForm';

/** Số khách tối đa trả về mỗi lần tìm (thay giới hạn cứng 100 khách đầu tiên). */
export const CUSTOMER_PICKER_LIMIT = 50;

export interface CreateAppointmentForm {
  values: AppointmentFormValues;
  errors: AppointmentFormErrors;
  /** Kết quả tìm khách trong phạm vi quyền (tối đa `CUSTOMER_PICKER_LIMIT`; gõ từ khoá để thu hẹp). */
  customers: CustomerListItem[];
  /** Tổng số khách khớp từ khoá (để báo "còn N khách nữa"). */
  customerTotal: number;
  setCustomerSearch: (keyword: string) => void;
  selectedCustomer: CustomerDetail | null;
  pendingRequiredCount: number;
  setField: <K extends keyof AppointmentFormValues>(field: K, value: AppointmentFormValues[K]) => void;
  changeCustomer: (customerId: string) => void;
  handleSubmit: (event?: FormEvent) => Promise<void>;
  isSubmitting: boolean;
  cancel: () => void;
}

export const useCreateAppointmentForm = (): CreateAppointmentForm => {
  const api = useCrmApi();
  const currentUser = useCurrentUser();
  const { selectedCustomerId } = useCrmState();
  const { data: preselected } = useCustomerDetail(selectedCustomerId);
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedSearch = useDebouncedValue(customerSearch.trim(), 250);
  // Tìm qua lớp dữ liệu (không dấu, theo tên/SĐT) thay vì chỉ lọc 100 khách đầu tiên ở client.
  const { data: customerPage } = useCustomerList({ listGroup: 'ALL', q: debouncedSearch, limit: CUSTOMER_PICKER_LIMIT, sort: 'fullName' });
  const { navigate, goBack, showToast } = useCrmActions();
  const [draft, setValues] = useState<AppointmentFormValues>(() => createInitialValues(preselected, getVnTodayKey(), currentUser.id));
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: selectedCustomer } = useCustomerDetail(draft.customerId);
  // Đổi khách thì người thực hiện về mặc định theo nhóm chăm sóc của khách mới (assigneeId '' = chưa chọn tay).
  const values = useMemo(
    () => (draft.assigneeId ? draft : { ...draft, assigneeId: getDefaultAssigneeId(selectedCustomer, currentUser.id) }),
    [draft, selectedCustomer, currentUser.id],
  );

  const currentErrors = useMemo(() => validateAppointmentForm(values, selectedCustomer), [values, selectedCustomer]);
  // Chỉ hiện lỗi sau lần bấm lưu đầu tiên.
  const errors = hasSubmitted ? currentErrors : {};

  const setField: CreateAppointmentForm['setField'] = (field, value) =>
    setValues((previous) => {
      const next = { ...previous, [field]: value };
      // Chọn "Nhắc gọi lại" khi chưa có địa điểm -> điền sẵn kênh gọi.
      if (field === 'type' && value === 'CALLBACK' && !previous.location.trim()) next.location = CALL_LOCATION;
      return next;
    });

  return {
    values,
    errors,
    customers: customerPage.data,
    customerTotal: customerPage.meta.total,
    setCustomerSearch,
    selectedCustomer,
    pendingRequiredCount: Object.keys(currentErrors).length,
    setField,
    changeCustomer: (customerId) => setValues((previous) => ({ ...previous, customerId, assigneeId: '' })),
    isSubmitting,
    handleSubmit: async (event) => {
      event?.preventDefault();
      if (isSubmitting) return;
      setHasSubmitted(true);
      const firstInvalidField = FIELD_ORDER.find((field) => currentErrors[field]);
      if (firstInvalidField) {
        showToast({ title: 'Chưa thể tạo lịch hẹn', message: currentErrors[firstInvalidField], type: 'error' });
        document.getElementById(getFieldId(firstInvalidField))?.focus();
        return;
      }
      setIsSubmitting(true);
      const result = await api.createAppointment(toCreateAppointmentInput(values));
      setIsSubmitting(false);
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      showToast({ title: 'Tạo lịch hẹn thành công', message: `Lịch hẹn với ${selectedCustomer?.fullName ?? 'khách'} đã được lưu.` });
      navigate('appointments', { shouldReplace: true });
    },
    cancel: goBack,
  };
};
