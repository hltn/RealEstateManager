import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

// Prototype thiết kế: KHÔNG có backend/proxy — mọi request axios đi qua mock adapter (src/mocks).
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    svgr({
      svgrOptions: {
        icon: true,
      },
    }),
  ],
  resolve: {
    alias: {
      // Module CRM: `@crm/store` -> src/modules/crm/store (code Admin chép sang dùng import tương đối).
      '@crm': fileURLToPath(new URL('./src/modules/crm', import.meta.url)),
    },
  },
})
