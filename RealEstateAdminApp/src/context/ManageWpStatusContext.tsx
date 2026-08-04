import { createContext, useCallback, useContext, useState, type FC, type ReactNode } from "react";

export type OpStatus = "idle" | "pending" | "done" | "error";

interface ManageWpStatusContextValue {
  crawlStatus: OpStatus;
  crawlError: string | null;
  marketAnalysisStatus: OpStatus;
  marketAnalysisError: string | null;
  setCrawlStatus: (status: OpStatus, error?: string) => void;
  setMarketAnalysisStatus: (status: OpStatus, error?: string) => void;
  clearCrawlStatus: () => void;
  clearMarketAnalysisStatus: () => void;
}

const ManageWpStatusContext = createContext<ManageWpStatusContextValue | undefined>(undefined);

export const useManageWpStatus = () => {
  const context = useContext(ManageWpStatusContext);
  if (!context) {
    throw new Error("useManageWpStatus must be used within a ManageWpStatusProvider");
  }
  return context;
};

export const ManageWpStatusProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [crawlStatus, setCrawlStatusState] = useState<OpStatus>("idle");
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [marketAnalysisStatus, setMarketAnalysisStatusState] = useState<OpStatus>("idle");
  const [marketAnalysisError, setMarketAnalysisError] = useState<string | null>(null);

  const setCrawlStatus = useCallback((status: OpStatus, error?: string) => {
    setCrawlStatusState(status);
    setCrawlError(error ?? null);
  }, []);

  const setMarketAnalysisStatus = useCallback((status: OpStatus, error?: string) => {
    setMarketAnalysisStatusState(status);
    setMarketAnalysisError(error ?? null);
  }, []);

  const clearCrawlStatus = useCallback(() => {
    setCrawlStatusState("idle");
    setCrawlError(null);
  }, []);

  const clearMarketAnalysisStatus = useCallback(() => {
    setMarketAnalysisStatusState("idle");
    setMarketAnalysisError(null);
  }, []);

  return (
    <ManageWpStatusContext.Provider
      value={{
        crawlStatus,
        crawlError,
        marketAnalysisStatus,
        marketAnalysisError,
        setCrawlStatus,
        setMarketAnalysisStatus,
        clearCrawlStatus,
        clearMarketAnalysisStatus,
      }}
    >
      {children}
    </ManageWpStatusContext.Provider>
  );
};
