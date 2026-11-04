import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App.tsx'
import './index.css'
import { AppWrapper } from './components/common/PageMeta.tsx'
import { ThemeProvider } from './context/ThemeContext.tsx'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import PwaUpdatePrompt from './pwa/PwaUpdatePrompt.tsx'
import ChunkLoadErrorNotifier from './pwa/ChunkLoadErrorNotifier.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppWrapper>
          <App />
          {/* Toast toàn cục cho UX lỗi 401/403 (WI-16) */}
          {/* containerStyle: chừa vùng an toàn (tai thỏ/status bar) khi chạy PWA trên iPhone */}
          <Toaster
            position="top-right"
            toastOptions={{ duration: 4000 }}
            containerStyle={{ top: 'max(1rem, env(safe-area-inset-top))', right: 'max(1rem, env(safe-area-inset-right))' }}
          />
          {/* PWA: đăng ký service worker (chỉ production) + toast "Có phiên bản mới" */}
          <PwaUpdatePrompt />
          {/* Chunk lazy lỗi sau deploy (vite:preloadError): toast nhắc tải lại, không tự reload */}
          <ChunkLoadErrorNotifier />
        </AppWrapper>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
