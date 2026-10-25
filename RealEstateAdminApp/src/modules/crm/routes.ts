/**
 * Ánh xạ 2 chiều ViewId <-> URL của module CRM (react-router).
 * - Store CRM gọi `buildCrmPath(view, customerId)` khi `navigate(view)`.
 * - `matchCrmPath(pathname)` suy ra màn hiện tại + khách đang xem từ URL (nguồn sự thật duy nhất).
 */
import { matchPath } from 'react-router-dom';
import type { ViewId } from '@crm/types/app';

export const CRM_BASE_PATH = '/crm';
/** Màn mặc định khi mở app / vào `/crm`. */
export const CRM_DEFAULT_PATH = `${CRM_BASE_PATH}/today`;

/** Màn cần id khách trong URL. */
type CustomerScopedView = 'customer_detail' | 'edit_persona' | 'edit_investment';

const CUSTOMER_SCOPED_SUFFIX: Record<CustomerScopedView, string> = {
  customer_detail: '',
  edit_persona: '/persona',
  edit_investment: '/investment',
};

const STATIC_PATH_BY_VIEW: Record<Exclude<ViewId, CustomerScopedView>, string> = {
  today: `${CRM_BASE_PATH}/today`,
  customers: `${CRM_BASE_PATH}/customers`,
  create_customer: `${CRM_BASE_PATH}/customers/new`,
  appointments: `${CRM_BASE_PATH}/appointments`,
  create_appointment: `${CRM_BASE_PATH}/appointments/new`,
  reports: `${CRM_BASE_PATH}/reports`,
  projects: `${CRM_BASE_PATH}/projects`,
  settings: `${CRM_BASE_PATH}/settings`,
};

const isCustomerScopedView = (view: ViewId): view is CustomerScopedView => view in CUSTOMER_SCOPED_SUFFIX;

/**
 * URL của một màn CRM. Màn theo khách (chi tiết / sửa chân dung / sửa đầu tư) cần `customerId`;
 * thiếu id thì rơi về danh sách khách.
 */
export const buildCrmPath = (view: ViewId, customerId?: string | null): string => {
  if (!isCustomerScopedView(view)) return STATIC_PATH_BY_VIEW[view];
  if (!customerId) return STATIC_PATH_BY_VIEW.customers;
  return `${CRM_BASE_PATH}/customers/${encodeURIComponent(customerId)}${CUSTOMER_SCOPED_SUFFIX[view]}`;
};

/** Tên tham số query mang khách / dự án sang màn "Tạo lịch hẹn mới" (`/crm/appointments/new?customerId=<id>&projectId=<id>`). */
export const CREATE_APPOINTMENT_CUSTOMER_PARAM = 'customerId';
export const CREATE_APPOINTMENT_PROJECT_PARAM = 'projectId';

/** Id hợp lệ = ObjectId 24 ký tự hex (chặn rác trước khi gọi API). */
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
export const isValidCustomerId = (value: string | null | undefined): value is string => typeof value === 'string' && OBJECT_ID_PATTERN.test(value);

export interface CreateAppointmentLink {
  customerId?: string | null;
  projectId?: string | null;
}

/**
 * URL màn tạo lịch hẹn. Có `customerId` hợp lệ thì khách đó được chọn sẵn; có `projectId` hợp lệ thì dự án đó được chọn sẵn
 * (giữ được khi tải lại trang). Id sai định dạng bị bỏ khỏi URL.
 */
export const buildCreateAppointmentPath = ({ customerId, projectId }: CreateAppointmentLink = {}): string => {
  const params = new URLSearchParams();
  if (isValidCustomerId(customerId)) params.set(CREATE_APPOINTMENT_CUSTOMER_PARAM, customerId);
  if (isValidCustomerId(projectId)) params.set(CREATE_APPOINTMENT_PROJECT_PARAM, projectId);
  const query = params.toString();
  return query ? `${STATIC_PATH_BY_VIEW.create_appointment}?${query}` : STATIC_PATH_BY_VIEW.create_appointment;
};

const readIdParam = (search: string, name: string): string | null => {
  const value = new URLSearchParams(search).get(name);
  return isValidCustomerId(value) ? value : null;
};

/** Khách mang theo ở query của màn tạo lịch hẹn; `null` nếu không có hoặc sai định dạng. */
export const parseCreateAppointmentCustomerId = (search: string): string | null => readIdParam(search, CREATE_APPOINTMENT_CUSTOMER_PARAM);

/** Dự án mang theo ở query của màn tạo lịch hẹn; `null` nếu không có hoặc sai định dạng. */
export const parseCreateAppointmentProjectId = (search: string): string | null => readIdParam(search, CREATE_APPOINTMENT_PROJECT_PARAM);

export interface CrmRouteMatch {
  view: ViewId;
  customerId: string | null;
}

/** Mẫu route theo thứ tự ưu tiên (route tĩnh như `/customers/new` phải đứng trước `/customers/:id`). */
const ROUTE_PATTERNS: { pattern: string; view: ViewId }[] = [
  ...(Object.entries(STATIC_PATH_BY_VIEW) as [ViewId, string][]).map(([view, pattern]) => ({ view, pattern })),
  { pattern: `${CRM_BASE_PATH}/customers/:customerId/persona`, view: 'edit_persona' },
  { pattern: `${CRM_BASE_PATH}/customers/:customerId/investment`, view: 'edit_investment' },
  { pattern: `${CRM_BASE_PATH}/customers/:customerId`, view: 'customer_detail' },
];

/** Suy ra màn CRM + id khách từ pathname; `null` nếu không phải route CRM. */
export const matchCrmPath = (pathname: string): CrmRouteMatch | null => {
  for (const { pattern, view } of ROUTE_PATTERNS) {
    const match = matchPath({ path: pattern, end: true }, pathname);
    if (match) {
      const customerId = match.params.customerId ? decodeURIComponent(match.params.customerId) : null;
      return { view, customerId };
    }
  }
  return null;
};

/** Đường dẫn con (tương đối với `/crm`) để khai báo `<Route>` trong App.tsx. */
export const CRM_CHILD_ROUTES = {
  today: 'today',
  customers: 'customers',
  createCustomer: 'customers/new',
  customerDetail: 'customers/:customerId',
  editPersona: 'customers/:customerId/persona',
  editInvestment: 'customers/:customerId/investment',
  appointments: 'appointments',
  createAppointment: 'appointments/new',
  reports: 'reports',
  projects: 'projects',
  settings: 'settings',
} as const;
