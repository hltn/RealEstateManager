/* oxlint-disable react/only-export-components -- file khai báo route (hàm dựng route + các màn nạp lười), không phải component dùng lại */
/**
 * Khai báo route `/crm/*` của module CRM prototype, nạp LƯỜI (React.lazy): khi cờ `VITE_CRM_PROTOTYPE` tắt,
 * không tạo route và không có mã module CRM trong bundle khởi động (mỗi màn là một chunk riêng, chỉ tải khi vào route).
 * Trả `null` khi tắt -> `/crm/*` rơi vào route `*` của ứng dụng (không lộ prototype có vai trò giả ở production).
 */
import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, Route } from 'react-router-dom';
import RoleGuard from '../../components/auth/RoleGuard';
import { UserRole } from '../../types/user';
import { CRM_CHILD_ROUTES, CRM_DEFAULT_PATH } from './routes';

const CrmLayout = lazy(() => import('./CrmLayout'));
const DailyTasksScreen = lazy(() => import('./screens/DailyTasks'));
const CustomersScreen = lazy(() => import('./screens/Customers'));
const CreateCustomerScreen = lazy(() => import('./screens/CreateCustomer'));
const CustomerDetailScreen = lazy(() => import('./screens/CustomerDetail'));
const EditPersonaScreen = lazy(() => import('./screens/EditPersona'));
const EditInvestmentScreen = lazy(() => import('./screens/EditInvestment'));
const AppointmentsScreen = lazy(() => import('./screens/Appointments'));
const CreateAppointmentScreen = lazy(() => import('./screens/CreateAppointment'));
const ReportsScreen = lazy(() => import('./screens/Reports'));
const ProjectsScreen = lazy(() => import('./screens/Projects'));
const SettingsScreen = lazy(() => import('./screens/Settings'));
const NotificationsScreen = lazy(() => import('./screens/Notifications'));

const LoadingFallback = () => <div role="status" className="p-6 text-theme-sm text-gray-500 dark:text-gray-400">Đang tải…</div>;

/** Route `crm` (layout + các màn con) hoặc `null` khi module tắt. Dùng trực tiếp làm con của `<Routes>`. */
export const buildCrmRoute = (isEnabled: boolean): ReactElement | null =>
  isEnabled ? (
    <Route
      path="crm"
      element={
        <Suspense fallback={<LoadingFallback />}>
          <CrmLayout />
        </Suspense>
      }
    >
      <Route index element={<Navigate to={CRM_DEFAULT_PATH} replace />} />
      <Route path={CRM_CHILD_ROUTES.today} element={<DailyTasksScreen />} />
      <Route path={CRM_CHILD_ROUTES.customers} element={<CustomersScreen />} />
      <Route path={CRM_CHILD_ROUTES.createCustomer} element={<CreateCustomerScreen />} />
      <Route path={CRM_CHILD_ROUTES.customerDetail} element={<CustomerDetailScreen />} />
      <Route path={CRM_CHILD_ROUTES.editPersona} element={<EditPersonaScreen />} />
      <Route path={CRM_CHILD_ROUTES.editInvestment} element={<EditInvestmentScreen />} />
      <Route path={CRM_CHILD_ROUTES.appointments} element={<AppointmentsScreen />} />
      <Route path={CRM_CHILD_ROUTES.createAppointment} element={<CreateAppointmentScreen />} />
      <Route path={CRM_CHILD_ROUTES.reports} element={<ReportsScreen />} />
      <Route path={CRM_CHILD_ROUTES.projects} element={<ProjectsScreen />} />
      <Route path={CRM_CHILD_ROUTES.settings} element={<SettingsScreen />} />
      <Route path="*" element={<Navigate to={CRM_DEFAULT_PATH} replace />} />
    </Route>
  ) : null;

/** Route `/notifications` (hộp thông báo trong app, 05 §2.10) — cùng cờ module CRM; nằm ngoài `/crm` nên không bọc CrmProvider. */
export const buildNotificationsRoute = (isEnabled: boolean): ReactElement | null =>
  isEnabled ? (
    <Route
      path="notifications"
      element={
        // Hộp thông báo là của vai trò CRM; EDITOR bị backend chặn 403 nên chặn sớm ở giao diện.
        <RoleGuard allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF]} fallback={<Navigate to="/" replace />}>
          <Suspense fallback={<LoadingFallback />}>
            <NotificationsScreen />
          </Suspense>
        </RoleGuard>
      }
    />
  ) : null;
