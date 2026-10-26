/**
 * State + hành vi form "Tạo lịch hẹn mới" dùng chung desktop/mobile.
 * Luồng: sửa trường -> (sau lần bấm lưu đầu) validate ngay -> `POST /crm/appointments` (cập nhật `nextAppointmentAt` của khách)
 * -> về nơi bắt đầu. Không hợp lệ: toast lỗi + focus trường lỗi đầu tiên.
 *
 * Ngữ cảnh khách: mở từ chi tiết khách thì URL mang `?customerId=<id>` -> khách được chọn sẵn và BỊ KHÓA (không đổi được khách,
 * vì người dùng đang thao tác trên khách đó), lưu/hủy xong về chi tiết khách đó. Khách trong query không xem được (404/403/lỗi)
 * thì mở khóa, form về "chưa chọn khách". Mở từ danh sách Lịch hẹn (không có query) thì form trống, chọn khách tự do và lưu/hủy về danh sách lịch hẹn. Form không có bản nháp lưu trữ:
 * state chỉ sống trong màn (màn được `key` theo khách nên đổi khách ở URL sẽ dựng form mới, không rò dữ liệu khách cũ).
 *
 * Dự án của lịch (tuỳ chọn): thứ tự ưu tiên = lựa chọn tay của người dùng (kể cả "Không chọn") > dự án mang sang qua `?projectId=`
 * (màn Dự án; bỏ qua nếu không còn hoạt động) > gợi ý theo khách (khách quan tâm đúng một dự án). Đổi khách/loại lịch KHÔNG ghi đè lựa chọn tay.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useCatalogs, useCrmApi, useCustomerDetail, useCustomerList, type CustomerDetail, type CustomerListItem } from '@crm/api';
import { useDebouncedValue } from '@crm/hooks/useDebouncedValue';
import { getVnTodayKey } from '@crm/lib/dateTime';
import { buildCrmPath, hasInvalidCreateAppointmentCustomerId, parseCreateAppointmentCustomerId, parseCreateAppointmentProjectId } from '@crm/routes';
import { useCrmActions, useCurrentUser } from '@crm/store';
import type { Project } from '@crm/types/crm';
import {
  CALL_LOCATION,
  createInitialValues,
  FIELD_ORDER,
  getDefaultAssigneeId,
  getFieldId,
  getSuggestedProjectId,
  hasUnsavedChanges,
  listSelectableProjects,
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
  /** Dự án đang hoạt động, chọn được cho lịch (danh sách ô "Dự án"). */
  selectableProjects: Project[];
  /** Đang tải thông tin khách đã chọn sẵn (để hiện "đang tải" thay vì "chưa chọn khách"). */
  isCustomerLoading: boolean;
  /**
   * Khách của màn chi tiết đã mở form này (null = mở từ danh sách Lịch hẹn, hoặc khách không xem được). Khác null thì trường khách
   * BỊ KHÓA (`changeCustomer` không làm gì) và lưu/hủy sẽ về chi tiết khách này.
   */
  originCustomer: { id: string; name: string } | null;
  pendingRequiredCount: number;
  setField: <K extends keyof AppointmentFormValues>(field: K, value: AppointmentFormValues[K]) => void;
  changeCustomer: (customerId: string) => void;
  handleSubmit: (event?: FormEvent) => Promise<void>;
  isSubmitting: boolean;
  /** Hủy bỏ: form có thay đổi chưa lưu thì mở hộp xác nhận (`isConfirmingDiscard`) thay vì bỏ ngay. */
  cancel: () => void;
  isConfirmingDiscard: boolean;
  /** Xác nhận bỏ dữ liệu đã nhập và rời form. */
  confirmDiscard: () => void;
  /** Đóng hộp xác nhận, ở lại form. */
  keepEditing: () => void;
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
  const [initialValues] = useState<AppointmentFormValues>(() => createInitialValues(originCustomerId ?? '', getVnTodayKey()));
  const [draft, setValues] = useState<AppointmentFormValues>(initialValues);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const { catalogs } = useCatalogs();
  const selectableProjects = useMemo(() => listSelectableProjects(catalogs.projects), [catalogs.projects]);
  const originProjectId = parseCreateAppointmentProjectId(search);
  // null = người dùng chưa tự chọn dự án (dùng dự án mang sang / gợi ý); '' = chủ động "Không chọn".
  const [manualProjectId, setManualProjectId] = useState<string | null>(null);
  // Lỗi 400 của trường dự án do máy chủ trả về (`details.field = projectId`).
  // Gắn kèm dự án lúc lỗi: dự án đổi (tay hoặc do gợi ý khi đổi khách) thì lỗi cũ tự hết hiệu lực.
  const [projectServerError, setProjectServerError] = useState<{ message: string; projectId: string } | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const customerId = isOriginUnavailable && draft.customerId === originCustomerId ? '' : draft.customerId;
  const { data: selectedCustomer, isLoading: isCustomerLoading } = useCustomerDetail(customerId);

  // Báo nhẹ đúng một lần khi không mở được khách đã chọn sẵn (không xem được / lỗi tải / mã khách trên URL sai định dạng).
  const unavailableMessage = originError
    ? originError.statusCode === 404 || originError.statusCode === 403
      ? 'Khách không tồn tại hoặc bạn không có quyền xem. Vui lòng chọn khách khác.'
      : 'Không tải được thông tin khách. Vui lòng chọn khách.'
    : hasInvalidCreateAppointmentCustomerId(search)
      ? 'Mã khách trên đường dẫn không hợp lệ. Vui lòng chọn khách.'
      : null;
  const hasNotifiedRef = useRef(false);
  useEffect(() => {
    if (!unavailableMessage || hasNotifiedRef.current) return;
    hasNotifiedRef.current = true;
    showToast({ type: 'warning', title: 'Chưa chọn sẵn được khách hàng', message: unavailableMessage });
  }, [unavailableMessage, showToast]);

  // Đổi khách thì người thực hiện về mặc định theo nhóm chăm sóc của khách mới (assigneeId '' = chưa chọn tay).
  const linkedProjectId = originProjectId && selectableProjects.some((project) => project.id === originProjectId) ? originProjectId : '';
  const projectId = manualProjectId ?? (linkedProjectId || getSuggestedProjectId(selectedCustomer, selectableProjects));
  const values = useMemo(
    () => ({ ...draft, customerId, projectId, assigneeId: draft.assigneeId || getDefaultAssigneeId(selectedCustomer, currentUser.id) }),
    [draft, customerId, projectId, selectedCustomer, currentUser.id],
  );
  // Khóa chỉ khi khách gốc dùng được VÀ form vẫn đang giữ đúng khách gốc. Đã mở khóa (khách gốc lỗi thoáng qua) rồi chọn khách khác thì
  // khách gốc tự tải lại thành công cũng KHÔNG khóa lại trên khách khác (khóa là một chiều trong phiên form này).
  const originCustomer = originCustomerId && !isOriginUnavailable && draft.customerId === originCustomerId ? { id: originCustomerId, name: originDetail?.fullName ?? '' } : null;

  const currentErrors = useMemo(() => validateAppointmentForm(values, selectedCustomer), [values, selectedCustomer]);
  // Chỉ hiện lỗi sau lần bấm lưu đầu tiên.
  const errors: AppointmentFormErrors = { ...(hasSubmitted ? currentErrors : {}), ...(projectServerError && projectServerError.projectId === projectId ? { projectId: projectServerError.message } : {}) };

  const setField: CreateAppointmentForm['setField'] = (field, value) => {
    if (field === 'projectId') {
      // Ghi nhận lựa chọn tay (kể cả "Không chọn") để gợi ý/dự án mang sang không ghi đè.
      setManualProjectId(value as string);
      return;
    }
    setValues((previous) => {
      const next = { ...previous, [field]: value };
      // Chọn "Nhắc gọi lại" khi chưa có địa điểm -> điền sẵn kênh gọi.
      if (field === 'type' && value === 'CALLBACK' && !previous.location.trim()) next.location = CALL_LOCATION;
      return next;
    });
  };

  const leaveForm = () => (originCustomer ? goBackTo(buildCrmPath('customer_detail', originCustomer.id)) : goBack());

  return {
    values,
    errors,
    customers: customerPage.data,
    customerTotal: customerPage.meta.total,
    setCustomerSearch,
    selectedCustomer,
    selectableProjects,
    isCustomerLoading,
    originCustomer,
    pendingRequiredCount: Object.keys(currentErrors).length,
    setField,
    // Khách gốc bị khóa: giữ bất biến ngay trong hook, không chỉ ẩn nút ở giao diện.
    changeCustomer: (nextCustomerId) => {
      if (originCustomer) return;
      setValues((previous) => ({ ...previous, customerId: nextCustomerId, assigneeId: '' }));
    },
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
        // Lỗi gắn với dự án (dự án không còn hoạt động...): hiện cạnh ô dự án; lỗi khác: toast.
        if (result.error.details?.field === 'projectId') {
          setProjectServerError({ message: result.error.message, projectId: values.projectId });
          document.getElementById(getFieldId('projectId'))?.focus();
          return;
        }
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      showToast({ title: 'Tạo lịch hẹn thành công', message: `Lịch hẹn với ${selectedCustomer?.fullName ?? 'khách'} đã được lưu.` });
      // Mở từ chi tiết khách (khách bị khóa nên lịch luôn của khách đó) -> về chi tiết khách; mở từ danh sách Lịch hẹn -> về danh sách (thay lịch sử: Back không quay lại form).
      if (originCustomer) selectCustomer(originCustomer.id, { shouldReplace: true });
      else navigate('appointments', { shouldReplace: true });
    },
    // Hủy: có thay đổi chưa lưu thì hỏi xác nhận trước; sau đó còn lịch sử trong app thì lùi 1 mục (đúng chi tiết khách đã mở form, Back không bị trùng mục);
    // mở thẳng URL thì thay bằng chi tiết khách.
    cancel: () => {
      if (hasUnsavedChanges(draft, initialValues, manualProjectId !== null)) setIsConfirmingDiscard(true);
      else leaveForm();
    },
    isConfirmingDiscard,
    confirmDiscard: () => {
      setIsConfirmingDiscard(false);
      leaveForm();
    },
    keepEditing: () => setIsConfirmingDiscard(false),
  };
};
