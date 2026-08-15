import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGoogleDriveStatus,
  getGoogleDriveAuthUrl,
  disconnectGoogleDrive,
} from "../api/google-drive.api";
import type { GoogleDriveStatus } from "../api/google-drive.api";

interface GoogleDriveAuthState {
  /** true nếu user đã kết nối Google Drive. */
  isConnected: boolean;
  /** Email của tài khoản Google đã kết nối. */
  email: string | null;
  /** Thời điểm kết nối. */
  connectedAt: string | null;
  /** true trong lúc đang fetch status lần đầu. */
  isLoading: boolean;
  /** Refetch trạng thái kết nối. */
  refetchStatus: () => void;
  /** Redirect user sang Google OAuth consent screen. */
  connect: () => Promise<void>;
  /** Ngắt kết nối Google Drive. */
  disconnect: () => Promise<void>;
  /** true trong lúc disconnect đang chạy. */
  isDisconnecting: boolean;
}

const GoogleDriveAuthContext = createContext<GoogleDriveAuthState | undefined>(
  undefined,
);

export const useGoogleDriveAuth = (): GoogleDriveAuthState => {
  const context = useContext(GoogleDriveAuthContext);
  if (!context) {
    throw new Error(
      "useGoogleDriveAuth must be used within a GoogleDriveAuthProvider",
    );
  }
  return context;
};

export const GoogleDriveAuthProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const queryClient = useQueryClient();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const { data: status, isLoading } = useQuery<GoogleDriveStatus>({
    queryKey: ["google-drive", "status"],
    queryFn: async ({ signal }) => {
      try {
        return await getGoogleDriveStatus(signal);
      } catch {
        return { connected: false };
      }
    },
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  // Handle OAuth callback redirect: detect ?gdrive=connected on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gdriveParam = params.get("gdrive");
    if (gdriveParam === "connected") {
      // Refetch status after OAuth callback
      void queryClient.invalidateQueries({
        queryKey: ["google-drive", "status"],
      });
      // Clean up URL params
      const url = new URL(window.location.href);
      url.searchParams.delete("gdrive");
      window.history.replaceState({}, "", url.toString());
    }
  }, [queryClient]);

  const refetchStatus = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["google-drive", "status"],
    });
  }, [queryClient]);

  const connect = useCallback(async () => {
    const url = await getGoogleDriveAuthUrl();
    window.location.href = url;
  }, []);

  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      await disconnectGoogleDrive();
      await queryClient.invalidateQueries({
        queryKey: ["google-drive", "status"],
      });
    } finally {
      setIsDisconnecting(false);
    }
  }, [queryClient]);

  return (
    <GoogleDriveAuthContext.Provider
      value={{
        isConnected: status?.connected ?? false,
        email: status?.email ?? null,
        connectedAt: status?.connectedAt ?? null,
        isLoading,
        refetchStatus,
        connect,
        disconnect,
        isDisconnecting,
      }}
    >
      {children}
    </GoogleDriveAuthContext.Provider>
  );
};
