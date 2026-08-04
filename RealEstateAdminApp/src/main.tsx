import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App.tsx'
import './index.css'
import { AppWrapper } from './components/common/PageMeta.tsx'
import { ThemeProvider } from './context/ThemeContext.tsx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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
