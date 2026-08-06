import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import ManageWpScreen from './screens/ManageWpScreen';
import CronjobScreen from './screens/CronjobScreen';
import ExternalLogsScreen from './screens/ExternalLogsScreen';
import ManageSourcesScreen from './screens/ManageSourcesScreen';
import RawArticlesScreen from './screens/RawArticlesScreen';
import MarketAnalysisWorkflowScreen from './screens/MarketAnalysisWorkflowScreen';
import AiConfigScreen from './screens/AiConfigScreen';
import AiPromptConfigScreen from './screens/AiPromptConfigScreen';
import NewsDetailScreen from './screens/NewsDetailScreen';
import LoginScreen from './screens/LoginScreen';
import UserManagementScreen from './screens/UserManagementScreen';
import ProtectedRoute from './components/auth/ProtectedRoute';
import RoleGuard from './components/auth/RoleGuard';
import AuthInitializer from './components/auth/AuthInitializer';
import { UserRole } from './types/user';

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
            <Route index element={<RawArticlesScreen />} />
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
                  allowedRoles={[UserRole.ADMIN]}
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
