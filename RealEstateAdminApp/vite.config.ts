/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import { VitePWA } from 'vite-plugin-pwa'
import { createRuntimeConfigMiddleware } from './src/config/devRuntimeConfig.ts'

// Thư mục GỐC repo (cha của RealEstateAdminApp): nơi duy nhất đặt `.env` (một danh sách khóa cho mọi thành phần, FR-18).
const REPO_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))

/**
 * Cấu hình FE lúc chạy (FR-15) cho dev/preview: phục vụ `/env.js` từ `.env` ở GỐC repo + `process.env` (process.env thắng, e2e dùng đường này).
 * Production không qua plugin này: entrypoint nginx sinh cùng file từ env của container. Chỉ phát khóa allowlist của
 * `src/config/runtimeConfigSchema.ts` (không rò mật khẩu/secret trong `.env`), giá trị sai bị bỏ để FE dùng mặc định.
 * Đọc env MỖI request: sửa `.env` rồi tải lại trang là có hiệu lực (không cần build lại).
 */
const runtimeConfigPlugin = (): Plugin => {
  let mode = 'development'
  const middleware = createRuntimeConfigMiddleware(() => loadEnv(mode, REPO_ROOT_DIR, ''))
  return {
    name: 'stnd-runtime-config',
    configResolved: (config) => {
      mode = config.mode
    },
    configureServer: (server) => {
      server.middlewares.use(middleware)
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    runtimeConfigPlugin(),
    react(),
    tailwindcss(),
    svgr({
      svgrOptions: {
        icon: true,
      },
    }),
    // PWA cài được, KHÔNG offline dữ liệu (PT-030). Service worker tự viết ở src/pwa/sw.ts (injectManifest):
    // chỉ precache vỏ app (JS/CSS/icon/offline.html), điều hướng luôn đi mạng, mất mạng thì hiện offline.html,
    // `/api/*` không bao giờ qua service worker.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      // Chế độ prompt: bản mới chỉ kích hoạt khi người dùng bấm "Cập nhật" (tránh mất ghi chú đang gõ dở).
      registerType: 'prompt',
      // Đăng ký thủ công qua virtual:pwa-register ở src/pwa/registerServiceWorker.ts (chỉ production).
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      devOptions: { enabled: false },
      // Icon đã nằm trong public/ nên được glob ở injectManifest bên dưới; không cần plugin thêm lần nữa.
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'STND – Quản lý Bất động sản',
        short_name: 'STND',
        description: 'Ứng dụng quản lý khách hàng và bất động sản STND.',
        lang: 'vi',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // theme-color tĩnh theo giao diện sáng mặc định (header trắng); chế độ tối chọn trong app không đổi được màu này.
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Chỉ vỏ app. KHÔNG precache index.html: điều hướng luôn đi mạng (xem src/pwa/sw.ts), và precache
        // index.html sẽ làm Workbox trả bản cũ cho "/" (directoryIndex) kể cả khi online.
        // (Plugin luôn tự thêm manifest.webmanifest vào danh sách; sw.ts lọc nó ra, xem isPrecacheExcluded.)
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
        globIgnores: ['index.html'],
      },
    }),
  ],
  resolve: {
    alias: {
      // Alias module CRM (`@crm/*` trỏ tới src/modules/crm)
      '@crm': fileURLToPath(new URL('./src/modules/crm', import.meta.url)),
      // Alias module tin tức/crawl (`@news/*` trỏ tới src/modules/news)
      '@news': fileURLToPath(new URL('./src/modules/news', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Spec Playwright (e2e/specs, e2e/specs-mock) chạy bằng `npm run e2e`, không phải vitest; test đơn vị của e2e/env.ts thì chạy ở đây.
    exclude: [...configDefaults.exclude, 'e2e/specs/**', 'e2e/specs-mock/**'],
    pool: 'forks',
    // Màn hình nặng (ManageWp...) render chậm khi chạy song song cả suite; 5s mặc định gây flaky.
    testTimeout: 15_000,
  },
})
