import { SidebarProvider, useSidebar } from "../context/SidebarContext";
import { AnalyzeJobProvider } from "../context/AnalyzeJobContext";
import { MarketAnalysisJobProvider } from "../context/MarketAnalysisJobContext";
import { MarketAnalysisWorkflowJobProvider } from "../context/MarketAnalysisWorkflowJobContext";
import { ManageWpStatusProvider } from "../context/ManageWpStatusContext";
import { BulkCrawlJobProvider } from "../context/BulkCrawlJobContext";
import { ManualCrawlJobProvider } from "../context/ManualCrawlJobContext";
import { GoogleDriveAuthProvider } from "../context/GoogleDriveAuthContext";
import { Outlet, useLocation } from "react-router-dom";
import AppHeader from "./AppHeader";
import Backdrop from "./Backdrop";
import AppSidebar from "./AppSidebar";
import IosInstallHint from "../pwa/IosInstallHint";
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
