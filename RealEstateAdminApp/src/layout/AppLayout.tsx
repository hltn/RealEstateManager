import { SidebarProvider, useSidebar } from "../context/SidebarContext";
import { AnalyzeJobProvider } from "../context/AnalyzeJobContext";
import { MarketAnalysisJobProvider } from "../context/MarketAnalysisJobContext";
import { MarketAnalysisWorkflowJobProvider } from "../context/MarketAnalysisWorkflowJobContext";
import { ManageWpStatusProvider } from "../context/ManageWpStatusContext";
import { BulkCrawlJobProvider } from "../context/BulkCrawlJobContext";
import { ManualCrawlJobProvider } from "../context/ManualCrawlJobContext";
import { GoogleDriveAuthProvider } from "../context/GoogleDriveAuthContext";
import { Outlet } from "react-router-dom";
import AppHeader from "./AppHeader";
import Backdrop from "./Backdrop";
import AppSidebar from "./AppSidebar";

const LayoutContent: React.FC = () => {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  return (
    <div className="min-h-screen xl:flex">
      <div>
        <AppSidebar />
        <Backdrop />
      </div>
      <div
        className={`flex-1 transition-all duration-300 ease-in-out ${
          isExpanded || isHovered ? "lg:ml-[290px]" : "lg:ml-[90px]"
        } ${isMobileOpen ? "ml-0" : ""}`}
      >
        <AppHeader />
        <div className="p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6">
          <Outlet />
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
