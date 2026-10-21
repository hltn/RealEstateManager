/**
 * State + hành vi form "Tạo lịch hẹn mới" dùng chung cho desktop/mobile.
 * Luồng: sửa trường -> (nếu đã bấm lưu 1 lần) validate lại ngay -> submit hợp lệ gọi `addAppointment`
 * (store tự điều hướng về /crm/appointments + toast). Không hợp lệ: toast lỗi + focus trường lỗi đầu tiên.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { toIsoDate } from '@crm/lib/dateTime';
import { useCrmActions, useCrmState, useSelectedCustomer } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import {
  CALL_LOCATION,
  createInitialValues,
  FIELD_ORDER,
  getDefaultProjectName,
  getFieldId,
  toNewAppointmentInput,
  validateAppointmentForm,
  type AppointmentFormErrors,
  type AppointmentFormValues,
} from './createAppointmentForm';

export interface CreateAppointmentForm {
  values: AppointmentFormValues;
  errors: AppointmentFormErrors;
  customers: Customer[];
  selectedCustomer: Customer | null;
  /** Số trường bắt buộc còn lỗi (hiển thị ở thanh hành động). */
  pendingRequiredCount: number;
  setField: <K extends keyof AppointmentFormValues>(field: K, value: AppointmentFormValues[K]) => void;
  /** Đổi khách -> tự đổi dự án theo dự án quan tâm đầu tiên của khách. */
  changeCustomer: (customerId: string) => void;
  handleSubmit: (event?: FormEvent) => void;
  cancel: () => void;
}

export const useCreateAppointmentForm = (): CreateAppointmentForm => {
  const { customers } = useCrmState();
  const preselectedCustomer = useSelectedCustomer();
  const { addAppointment, goBack, showToast } = useCrmActions();
  const [values, setValues] = useState<AppointmentFormValues>(() =>
    createInitialValues(preselectedCustomer, toIsoDate(new Date())),
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const currentErrors = useMemo(() => validateAppointmentForm(values, customers), [values, customers]);
  // Chỉ hiện lỗi sau lần bấm lưu đầu tiên để không "mắng" người dùng khi vừa mở form.
  const errors = hasSubmitted ? currentErrors : {};
  const selectedCustomer = customers.find((customer) => customer.id === values.customerId) ?? null;

  const setField: CreateAppointmentForm['setField'] = (field, value) =>
    setValues((previous) => {
      const next = { ...previous, [field]: value };
      // Chọn "Nhắc gọi" khi chưa có địa điểm -> điền sẵn kênh gọi (lịch không gặp mặt).
      if (field === 'type' && value === 'nhac_goi' && !previous.location.trim()) next.location = CALL_LOCATION;
      return next;
    });

  const changeCustomer = (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId) ?? null;
    setValues((previous) => ({ ...previous, customerId, projectName: getDefaultProjectName(customer) }));
  };

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    setHasSubmitted(true);
    const firstInvalidField = FIELD_ORDER.find((field) => currentErrors[field]);
    if (firstInvalidField) {
      showToast({ title: 'Chưa thể tạo lịch hẹn', message: 'Vui lòng kiểm tra các trường được đánh dấu.', type: 'error' });
      document.getElementById(getFieldId(firstInvalidField))?.focus();
      return;
    }
    addAppointment(toNewAppointmentInput(values));
  };

  return {
    values,
    errors,
    customers,
    selectedCustomer,
    pendingRequiredCount: Object.keys(currentErrors).length,
    setField,
    changeCustomer,
    handleSubmit,
    cancel: goBack,
  };
};
