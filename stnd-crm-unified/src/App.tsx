import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import ManageWpScreen from './screens/ManageWpScreen';
import CronjobScreen from './screens/CronjobScreen';
import ExternalLogsScreen from './screens/ExternalLogsScreen';
import ManageSourcesScreen from './screens/ManageSourcesScreen';
import RawArticlesScreen from './screens/RawArticlesScreen';
import MarketAnalysisWorkflowScreen from './screens/MarketAnalysisWorkflowScreen';
import AiConfigScreen from './screens/AiConfigScreen';
import AiPromptConfigScreen from './screens/AiPromptConfigScreen';
import KnowledgeArticlesScreen from './screens/KnowledgeArticlesScreen';
import KnowledgeConfigScreen from './screens/KnowledgeConfigScreen';
import KnowledgeCronScreen from './screens/KnowledgeCronScreen';
import NewsDetailScreen from './screens/NewsDetailScreen';
import LoginScreen from './screens/LoginScreen';
import UserManagementScreen from './screens/UserManagementScreen';
import ProtectedRoute from './components/auth/ProtectedRoute';
import RoleGuard from './components/auth/RoleGuard';
import AuthInitializer from './components/auth/AuthInitializer';
import { UserRole } from './types/user';
// [Prototype] Module Quản lý khách hàng (CRM) — xem src/modules/crm và README.
import CrmLayout from '@crm/CrmLayout';
import { CRM_CHILD_ROUTES, CRM_DEFAULT_PATH } from '@crm/routes';
import { DailyTasksScreen } from '@crm/screens/DailyTasks';
import { CustomersScreen } from '@crm/screens/Customers';
import { CreateCustomerScreen } from '@crm/screens/CreateCustomer';
import { CustomerDetailScreen } from '@crm/screens/CustomerDetail';
import { EditPersonaScreen } from '@crm/screens/EditPersona';
import { EditInvestmentScreen } from '@crm/screens/EditInvestment';
import { AppointmentsScreen } from '@crm/screens/Appointments';
import { CreateAppointmentScreen } from '@crm/screens/CreateAppointment';
import { ReportsScreen } from '@crm/screens/Reports';
import { ProjectsScreen } from '@crm/screens/Projects';
import { CrmAiConfigScreen } from '@crm/screens/CrmAiConfig';

function App() {
  return (
    <BrowserRouter>
      {/* Bootstrap auth: gọi GET /auth/me đúng 1 lần khi mount, khôi phục phiên. */}
      <AuthInitializer>
        <Routes>
          {/* Public route — đăng nhập */}
          <Route path="/login" element={<LoginScreen />} />

          {/* Protected area — toàn bộ route quản trị nằm sau ProtectedRoute */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            {/* [Prototype] Mặc định mở vào module CRM; Raw Articles chuyển sang /raw-articles */}
            <Route index element={<Navigate to={CRM_DEFAULT_PATH} replace />} />
            <Route path="raw-articles" element={<RawArticlesScreen />} />

            {/* [Prototype] Module Quản lý khách hàng — CrmLayout bọc CrmProvider + bottom nav mobile */}
            <Route path="crm" element={<CrmLayout />}>
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
              <Route path={CRM_CHILD_ROUTES.aiConfig} element={<CrmAiConfigScreen />} />
              <Route path="*" element={<Navigate to={CRM_DEFAULT_PATH} replace />} />
            </Route>
            <Route path="manage-wp" element={<ManageWpScreen />} />
            <Route path="market-analysis-workflow" element={<MarketAnalysisWorkflowScreen />} />
            <Route path="news-detail/:id" element={<NewsDetailScreen />} />
            <Route path="sources" element={<ManageSourcesScreen />} />
            {/* ADMIN only — cấu hình hệ thống */}
            <Route
              path="ai-config"
              element={
                <RoleGuard
                  allowedRoles={[UserRole.ADMIN]}
                  fallback={
                    <div className="flex min-h-[60vh] items-center justify-center text-gray-500">
                      Bạn không có quyền truy cập trang này.
                    </div>
                  }
                >
                  <AiConfigScreen />
                </RoleGuard>
              }
            />
            <Route
              path="ai-prompt-config"
              element={
                <RoleGuard
                  allowedRoles={[UserRole.ADMIN, UserRole.EDITOR]}
                  fallback={
                    <div className="flex min-h-[60vh] items-center justify-center text-gray-500">
                      Bạn không có quyền truy cập trang này.
                    </div>
                  }
                >
                  <AiPromptConfigScreen />
                </RoleGuard>
              }
            />
            <Route
              path="cronjob"
              element={
                <RoleGuard
                  allowedRoles={[UserRole.ADMIN]}
                  fallback={
                    <div className="flex min-h-[60vh] items-center justify-center text-gray-500">
                      Bạn không có quyền truy cập trang này.
                    </div>
                  }
                >
                  <CronjobScreen />
                </RoleGuard>
              }
            />
            {/* Knowledge Articles — ADMIN only */}
            <Route
              path="knowledge-articles"
              element={
                <RoleGuard
                  allowedRoles={[UserRole.ADMIN]}
                  fallback={
                    <div className="flex min-h-[60vh] items-center justify-center text-gray-500">
                      Bạn không có quyền truy cập trang này.
                    </div>
                  }
                >
                  <KnowledgeArticlesScreen />
                </RoleGuard>
              }
            />
            <Route
              path="knowledge-config"
              element={
                <RoleGuard
                  allowedRoles={[UserRole.ADMIN]}
                  fallback={
                    <div className="flex min-h-[60vh] items-center justify-center text-gray-500">
                      Bạn không có quyền truy cập trang này.
                    </div>
                  }
                >
                  <KnowledgeConfigScreen />
                </RoleGuard>
              }
            />
            <Route
              path="knowledge-cron"
              element={
                <RoleGuard
                  allowedRoles={[UserRole.ADMIN]}
                  fallback={
                    <div className="flex min-h-[60vh] items-center justify-center text-gray-500">
                      Bạn không có quyền truy cập trang này.
                    </div>
                  }
                >
                  <KnowledgeCronScreen />
                </RoleGuard>
              }
            />
            {/* ADMIN only — request logs */}
            <Route
              path="external-logs"
              element={
                <RoleGuard
                  allowedRoles={[UserRole.ADMIN]}
                  fallback={
                    <div className="flex min-h-[60vh] items-center justify-center text-gray-500">
                      Bạn không có quyền truy cập trang này.
                    </div>
                  }
                >
                  <ExternalLogsScreen />
                </RoleGuard>
              }
            />
            {/* ADMIN only — quản lý tài khoản */}
            <Route
              path="users"
              element={
                <RoleGuard
                  allowedRoles={[UserRole.ADMIN]}
                  fallback={
                    <div className="flex min-h-[60vh] items-center justify-center text-gray-500">
                      Bạn không có quyền truy cập trang này.
                    </div>
                  }
                >
                  <UserManagementScreen />
                </RoleGuard>
              }
            />
          </Route>

          {/* Fallback — mọi route không khớp chuyển về vùng protected */}
          <Route path="*" element={<ProtectedRoute><AppLayout /></ProtectedRoute>} />
        </Routes>
      </AuthInitializer>
    </BrowserRouter>
  );
}

export default App;
