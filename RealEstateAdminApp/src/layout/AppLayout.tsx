import { SidebarProvider, useSidebar } from "../context/SidebarContext";
import { AnalyzeJobProvider } from "@news/context/AnalyzeJobContext";
import { MarketAnalysisJobProvider } from "@news/context/MarketAnalysisJobContext";
import { MarketAnalysisWorkflowJobProvider } from "@news/context/MarketAnalysisWorkflowJobContext";
import { ManageWpStatusProvider } from "@news/context/ManageWpStatusContext";
import { BulkCrawlJobProvider } from "@news/context/BulkCrawlJobContext";
import { ManualCrawlJobProvider } from "@news/context/ManualCrawlJobContext";
import { GoogleDriveAuthProvider } from "@news/context/GoogleDriveAuthContext";
import { Outlet, useLocation } from "react-router-dom";
import AppHeader from "./AppHeader";
import Backdrop from "./Backdrop";
import AppSidebar from "./AppSidebar";
import IosInstallHint from "../pwa/IosInstallHint";
import PushOptInDialog from "../pwa/PushOptInDialog";
import { RouteErrorBoundary } from "../pwa/RouteErrorBoundary";

const LayoutContent: React.FC = () => {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen xl:flex">
      <div>
        <AppSidebar />
        <Backdrop />
      </div>
      <div
        className={`min-w-0 flex-1 transition-all duration-300 ease-in-out ${
          isExpanded || isHovered ? "lg:ml-[290px]" : "lg:ml-[90px]"
        } ${isMobileOpen ? "ml-0" : ""}`}
      >
        {/* PWA: gợi ý cài lên Màn hình chính (chỉ iPhone/iPad Safari, chưa cài, chưa tắt) */}
        <IosInstallHint />
        {/* PWA: mời bật thông báo một lần (chỉ khi đã cài app, đã đăng nhập, máy chủ bật push) */}
        <PushOptInDialog />
        <AppHeader />
        <div className="p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6">
          {/* Lỗi vẽ trang (vd chunk lazy không tải được sau deploy) chỉ hiện ở vùng này, header/sidebar vẫn dùng được */}
          <RouteErrorBoundary resetKey={pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </div>
      </div>
    </div>
  );
};

const AppLayout: React.FC = () => {
  return (
    <SidebarProvider>
      <AnalyzeJobProvider>
        <ManageWpStatusProvider>
          <MarketAnalysisJobProvider>
            <MarketAnalysisWorkflowJobProvider>
              <BulkCrawlJobProvider>
                <ManualCrawlJobProvider>
                  <GoogleDriveAuthProvider>
                    <LayoutContent />
                  </GoogleDriveAuthProvider>
                </ManualCrawlJobProvider>
              </BulkCrawlJobProvider>
            </MarketAnalysisWorkflowJobProvider>
          </MarketAnalysisJobProvider>
        </ManageWpStatusProvider>
      </AnalyzeJobProvider>
    </SidebarProvider>
  );
};

export default AppLayout;
