import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App.tsx'
import './index.css'
import { AppWrapper } from './components/common/PageMeta.tsx'
import { ThemeProvider } from './context/ThemeContext.tsx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import apiAxios from './api/axios'
import { useAuthStore } from './stores/auth.store'
import { mockAdapter } from './mocks/mockAdapter'
import { MOCK_ACCESS_TOKEN, MOCK_USER } from './mocks/mockUser'

// [Prototype] Không có backend: mọi request axios đi qua mock adapter (src/mocks).
apiAxios.defaults.adapter = mockAdapter

// [Prototype] Seed phiên đăng nhập trước khi render để vào thẳng app (bỏ qua /login).
useAuthStore.setState({ accessToken: MOCK_ACCESS_TOKEN, user: MOCK_USER, isInitialized: true })

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppWrapper>
          <App />
          {/* Toast toàn cục cho UX lỗi 401/403 (WI-16) */}
          <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
        </AppWrapper>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
