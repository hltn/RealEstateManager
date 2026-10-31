import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
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
import { useAuth } from './hooks/useAuth';
import { hasCrmRole } from './utils/userRoles';
import { UserRole } from './types/user';
import HomeIndex from './components/auth/HomeIndex';
// [Prototype] Module Quản lý khách hàng (CRM) — xem src/modules/crm
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { buildCrmRoute, buildNotificationsRoute } from '@crm/crmRoute';
import { CRM_DEFAULT_PATH } from '@crm/routes';

/**
 * [Prototype] `/` mở thẳng màn CRM mặc định cho tài khoản có role CRM (app chính: Quản trị/Biên tập vào Raw Articles, chỉ MANAGER/STAFF
 * mới chuyển sang CRM). Tài khoản chỉ có EDITOR vẫn vào Raw Articles như app chính; Quản trị xem Raw Articles ở `/raw-articles`.
 */
const PrototypeHome = () => {
  const { user } = useAuth();
  return hasCrmRole(user) ? <Navigate to={CRM_DEFAULT_PATH} replace /> : <HomeIndex />;
};

/** Chặn route tin tức theo vai trò (EDITOR/ADMIN); vai trò CRM chuyển về /crm/today. */
const NewsGuard = ({ children }: { children: ReactNode }) => (
  <RoleGuard allowedRoles={[UserRole.ADMIN, UserRole.EDITOR]} fallback={<div className="flex min-h-[60vh] items-center justify-center text-gray-500">Bạn không có quyền truy cập trang này.</div>}>
    {children}
  </RoleGuard>
);

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
            {/* [Prototype] Mặc định mở CRM (xem PrototypeHome); Raw Articles có thêm đường dẫn riêng /raw-articles */}
            <Route index element={<PrototypeHome />} />
            <Route path="raw-articles" element={<NewsGuard><RawArticlesScreen /></NewsGuard>} />

            {/* [Prototype] Module Quản lý khách hàng — CrmLayout bọc CrmProvider + bottom nav mobile */}
            {buildCrmRoute(CRM_FEATURE_FLAGS.isPrototypeEnabled)}
            {buildNotificationsRoute(CRM_FEATURE_FLAGS.isPrototypeEnabled)}

            {/* Nhóm tin tức: ADMIN/EDITOR; MANAGER/STAFF bị chuyển về CRM (RoleGuard) */}
            <Route path="manage-wp" element={<NewsGuard><ManageWpScreen /></NewsGuard>} />
            <Route path="market-analysis-workflow" element={<NewsGuard><MarketAnalysisWorkflowScreen /></NewsGuard>} />
            <Route path="news-detail/:id" element={<NewsGuard><NewsDetailScreen /></NewsGuard>} />
            <Route path="sources" element={<NewsGuard><ManageSourcesScreen /></NewsGuard>} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthInitializer>
    </BrowserRouter>
  );
}

export default App;
