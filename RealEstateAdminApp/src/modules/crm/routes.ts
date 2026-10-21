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
  ai_config: `${CRM_BASE_PATH}/ai-config`,
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
  aiConfig: 'ai-config',
} as const;
