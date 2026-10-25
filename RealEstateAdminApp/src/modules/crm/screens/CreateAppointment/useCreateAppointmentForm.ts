/**
 * State + hành vi form "Tạo lịch hẹn mới" dùng chung desktop/mobile.
 * Luồng: sửa trường -> (sau lần bấm lưu đầu) validate ngay -> `POST /crm/appointments` (cập nhật `nextAppointmentAt` của khách)
 * -> về nơi bắt đầu. Không hợp lệ: toast lỗi + focus trường lỗi đầu tiên.
 *
 * Ngữ cảnh khách: mở từ chi tiết khách thì URL mang `?customerId=<id>` -> khách được chọn sẵn, lưu/hủy xong về chi tiết khách đó.
 * Mở từ danh sách Lịch hẹn (không có query) thì form trống và lưu/hủy về danh sách lịch hẹn. Form không có bản nháp lưu trữ:
 * state chỉ sống trong màn (màn được `key` theo khách nên đổi khách ở URL sẽ dựng form mới, không rò dữ liệu khách cũ).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useCrmApi, useCustomerDetail, useCustomerList, type CustomerDetail, type CustomerListItem } from '@crm/api';
import { useDebouncedValue } from '@crm/hooks/useDebouncedValue';
import { getVnTodayKey } from '@crm/lib/dateTime';
import { buildCrmPath, parseCreateAppointmentCustomerId } from '@crm/routes';
import { useCrmActions, useCurrentUser } from '@crm/store';
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
  /** Đang tải thông tin khách đã chọn sẵn (để hiện "đang tải" thay vì "chưa chọn khách"). */
  isCustomerLoading: boolean;
  /** Khách của màn chi tiết đã mở form này (null = mở từ danh sách Lịch hẹn, hoặc khách không xem được). Lưu/hủy sẽ về chi tiết khách này. */
  originCustomer: { id: string; name: string } | null;
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
  const { search } = useLocation();
  // Khách mang sang qua query (đã kiểm định dạng ObjectId); null nếu không có hoặc sai định dạng.
  const originCustomerId = parseCreateAppointmentCustomerId(search);
  const { data: originDetail, error: originError } = useCustomerDetail(originCustomerId);
  // Khách không tồn tại / không có quyền xem / lỗi tải -> rơi về "chưa chọn khách", không crash.
  const isOriginUnavailable = Boolean(originError);
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedSearch = useDebouncedValue(customerSearch.trim(), 250);
  // Tìm qua lớp dữ liệu (không dấu, theo tên/SĐT) thay vì chỉ lọc 100 khách đầu tiên ở client.
  const { data: customerPage } = useCustomerList({ listGroup: 'ALL', q: debouncedSearch, limit: CUSTOMER_PICKER_LIMIT, sort: 'fullName' });
  const { selectCustomer, navigate, goBack, goBackTo, showToast } = useCrmActions();
  const [draft, setValues] = useState<AppointmentFormValues>(() => createInitialValues(originCustomerId ?? '', getVnTodayKey()));
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const customerId = isOriginUnavailable && draft.customerId === originCustomerId ? '' : draft.customerId;
  const { data: selectedCustomer, isLoading: isCustomerLoading } = useCustomerDetail(customerId);

  // Báo nhẹ đúng một lần khi không mở được khách đã chọn sẵn.
  const hasNotifiedRef = useRef(false);
  useEffect(() => {
    if (!originError || hasNotifiedRef.current) return;
    hasNotifiedRef.current = true;
    const isNotAccessible = originError.statusCode === 404 || originError.statusCode === 403;
    showToast({
      type: 'warning',
      title: 'Chưa chọn sẵn được khách hàng',
      message: isNotAccessible ? 'Khách không tồn tại hoặc bạn không có quyền xem. Vui lòng chọn khách khác.' : 'Không tải được thông tin khách. Vui lòng chọn khách.',
    });
  }, [originError, showToast]);

  // Đổi khách thì người thực hiện về mặc định theo nhóm chăm sóc của khách mới (assigneeId '' = chưa chọn tay).
  const values = useMemo(
    () => ({ ...draft, customerId, assigneeId: draft.assigneeId || getDefaultAssigneeId(selectedCustomer, currentUser.id) }),
    [draft, customerId, selectedCustomer, currentUser.id],
  );
  const originCustomer = originCustomerId && !isOriginUnavailable ? { id: originCustomerId, name: originDetail?.fullName ?? '' } : null;

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
    isCustomerLoading,
    originCustomer,
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
      // Mở từ chi tiết khách -> về chi tiết khách của lịch vừa tạo; mở từ danh sách Lịch hẹn -> về danh sách (thay lịch sử: Back không quay lại form).
      if (originCustomer) selectCustomer(values.customerId, { shouldReplace: true });
      else navigate('appointments', { shouldReplace: true });
    },
    // Hủy: còn lịch sử trong app thì lùi 1 mục (đúng chi tiết khách đã mở form, Back không bị trùng mục); mở thẳng URL thì thay bằng chi tiết khách.
    cancel: () => (originCustomer ? goBackTo(buildCrmPath('customer_detail', originCustomer.id)) : goBack()),
  };
};
