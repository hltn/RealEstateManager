/**
 * FR-11, FR-12 (Thống nhất môi trường, v1.0.6): module tin tức/crawl tách khỏi gốc `src/` sang `modules/news`
 * (ngang hàng `modules/crm`, alias `@news`). Test tĩnh kiểm cây thư mục, luật biên (`news` không import `layout`)
 * và không còn import nào trỏ về đường dẫn cũ. Không đổi hành vi runtime nên không có test render mới.
 * Kiểm chứng khác (FR-12): `npx tsc -b`, `npx vite build`, `npm run typecheck:e2e`; e2e chạy lại ở bước QA.
 */
import { describe, expect, it } from 'vitest';

// Toàn bộ mã nguồn dưới src/ (đường dẫn gốc dự án, dạng `/src/...`) để quét import.
const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
const configs = {
  vite: Object.values(import.meta.glob<string>('/vite.config.ts', { query: '?raw', import: 'default', eager: true }))[0],
  tsconfigApp: Object.values(import.meta.glob<string>('/tsconfig.app.json', { query: '?raw', import: 'default', eager: true }))[0],
};

const SELF = '/src/modules/news/moduleBoundary.test.ts';
const files = Object.keys(sources).filter((path) => path !== SELF);

const NEWS_SCREENS = [
  'AiConfigScreen',
  'AiPromptConfigScreen',
  'CronjobScreen',
  'ExternalLogsScreen',
  'KnowledgeArticlesScreen',
  'KnowledgeConfigScreen',
  'KnowledgeCronScreen',
  'ManageSourcesScreen',
  'ManageWpScreen',
  'MarketAnalysisWorkflowScreen',
  'NewsDetailScreen',
  'RawArticlesScreen',
];
const NEWS_API = ['google-drive.api', 'knowledge-articles.api', 'news-manager.api', 'settings.api'];
const NEWS_CONTEXT = [
  'AnalyzeJobContext',
  'BulkCrawlJobContext',
  'GoogleDriveAuthContext',
  'ManageWpStatusContext',
  'ManualCrawlJobContext',
  'MarketAnalysisJobContext',
  'MarketAnalysisWorkflowJobContext',
];
const NEWS_GOOGLE_DRIVE_COMPONENTS = ['ExportButton', 'GoogleDriveStatusBadge'];

/** Đường dẫn (bỏ đuôi) của 26 file cũ ở gốc `src/` đã dời sang `modules/news` (không tính test đi kèm). */
const OLD_STEMS = [
  ...NEWS_SCREENS.map((name) => `/src/screens/${name}`),
  ...NEWS_API.map((name) => `/src/api/${name}`),
  ...NEWS_CONTEXT.map((name) => `/src/context/${name}`),
  ...NEWS_GOOGLE_DRIVE_COMPONENTS.map((name) => `/src/components/google-drive/${name}`),
  '/src/hooks/useHeaderStatusReset',
];

const stripExt = (path: string) => path.replace(/\.(test\.)?(ts|tsx)$/, '').replace(/\.test$/, '');
const hasFile = (path: string) => files.includes(path);

// Bắt chuỗi đường dẫn trong `from '...'`, `import('...')`, `import '...'`, `vi.mock('...')`, `vi.importActual('...')`.
const SPECIFIER_RE = /(?:from\s+|import\s*\(\s*|vi\.(?:mock|importActual|doMock|unmock)(?:<[^>]*>)?\(\s*|import\s+)(['"])([^'"]+)\1/g;

/** Đưa import tương đối/alias về dạng `/src/...` (bỏ đuôi file); trả null nếu là package ngoài. */
const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
  if (specifier.startsWith('@news/')) return `/src/modules/news/${specifier.slice('@news/'.length)}`;
  if (specifier.startsWith('@crm/')) return `/src/modules/crm/${specifier.slice('@crm/'.length)}`;
  if (!specifier.startsWith('.')) return null;
  const parts = fromFile.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
};

const specifiersOf = (path: string): { raw: string; resolved: string }[] =>
  [...sources[path].matchAll(SPECIFIER_RE)]
    .map((match) => ({ raw: match[2], resolved: resolveSpecifier(path, match[2]) }))
    .filter((item): item is { raw: string; resolved: string } => item.resolved !== null);

describe('FR-11: cây thư mục modules/news', () => {
  it('FR-11: quét được ít nhất các file đã dời và file của shell (không quét rỗng)', () => {
    const newsFiles = files.filter((path) => path.startsWith('/src/modules/news/'));
    expect(newsFiles.length).toBeGreaterThanOrEqual(OLD_STEMS.length);
    expect(hasFile('/src/App.tsx')).toBe(true);
    expect(hasFile('/src/layout/AppLayout.tsx')).toBe(true);
  });

  it.each(NEWS_SCREENS)('FR-11: màn %s nằm ở modules/news/screens, không còn ở gốc screens/', (name) => {
    expect(hasFile(`/src/modules/news/screens/${name}.tsx`)).toBe(true);
    expect(hasFile(`/src/screens/${name}.tsx`)).toBe(false);
    expect(hasFile(`/src/screens/${name}.test.tsx`)).toBe(false);
  });

  it.each(NEWS_API)('FR-11: api %s nằm ở modules/news/api, không còn ở gốc api/', (name) => {
    expect(hasFile(`/src/modules/news/api/${name}.ts`)).toBe(true);
    expect(hasFile(`/src/api/${name}.ts`)).toBe(false);
  });

  it.each(NEWS_CONTEXT)('FR-11: context %s nằm ở modules/news/context, không còn ở gốc context/', (name) => {
    expect(hasFile(`/src/modules/news/context/${name}.tsx`)).toBe(true);
    expect(hasFile(`/src/context/${name}.tsx`)).toBe(false);
  });

  it.each(NEWS_GOOGLE_DRIVE_COMPONENTS)('FR-11: component google-drive %s nằm ở modules/news/components', (name) => {
    expect(hasFile(`/src/modules/news/components/google-drive/${name}.tsx`)).toBe(true);
    expect(hasFile(`/src/components/google-drive/${name}.tsx`)).toBe(false);
  });

  it('FR-11: useHeaderStatusReset nằm ở modules/news/hooks, không còn ở gốc hooks/', () => {
    expect(hasFile('/src/modules/news/hooks/useHeaderStatusReset.ts')).toBe(true);
    expect(hasFile('/src/hooks/useHeaderStatusReset.ts')).toBe(false);
  });

  it('FR-11: gốc screens/, api/, context/ chỉ còn phần của shell', () => {
    // Gộp file chính và file test đi kèm về cùng một tên.
    const under = (dir: string) =>
      [
        ...new Set(
          files
            .filter((path) => path.startsWith(dir) && !path.slice(dir.length).includes('/'))
            .map((path) => stripExt(path.slice(dir.length))),
        ),
      ].sort();
    expect(under('/src/screens/')).toEqual(['LoginScreen', 'UserManagementScreen']);
    expect(under('/src/api/')).toEqual(['auth.api', 'axios', 'users.api']);
    expect(under('/src/context/')).toEqual(['SidebarContext', 'ThemeContext']);
    expect(files.filter((path) => path.startsWith('/src/components/google-drive/'))).toEqual([]);
  });

  it('FR-11: alias @news có trong vite.config.ts và tsconfig.app.json, trỏ tới src/modules/news', () => {
    expect(configs.vite).toMatch(/'@news':\s*fileURLToPath\(new URL\('\.\/src\/modules\/news'/);
    expect(configs.tsconfigApp).toMatch(/"@news\/\*":\s*\["\.\/src\/modules\/news\/\*"\]/);
  });

  it('FR-11: luật biên, mã trong modules/news không import layout/', () => {
    const offenders = files
      .filter((path) => path.startsWith('/src/modules/news/'))
      .flatMap((path) =>
        specifiersOf(path)
          .filter((item) => item.resolved.startsWith('/src/layout/') || item.resolved === '/src/layout')
          .map((item) => `${path} -> ${item.raw}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe('FR-12: tham chiếu sau khi tách', () => {
  it('FR-12: không còn import/vi.mock nào trỏ về đường dẫn cũ của màn, api, context, hook, component đã dời', () => {
    const offenders = files.flatMap((path) =>
      specifiersOf(path)
        .filter((item) => OLD_STEMS.includes(item.resolved))
        .map((item) => `${path} -> ${item.raw}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each(['/src/App.tsx', '/src/layout/AppLayout.tsx', '/src/layout/AppHeader.tsx'])(
    'FR-12: shell %s import phần tin tức qua alias @news',
    (path) => {
      expect(sources[path]).toMatch(/['"]@news\//);
    },
  );

  it('FR-12: AppLayout vẫn bọc đủ Provider job/Drive của tin tức', () => {
    const providers = ['AnalyzeJobProvider', 'MarketAnalysisJobProvider', 'MarketAnalysisWorkflowJobProvider', 'ManageWpStatusProvider', 'BulkCrawlJobProvider', 'ManualCrawlJobProvider', 'GoogleDriveAuthProvider'];
    for (const provider of providers) {
      expect(sources['/src/layout/AppLayout.tsx']).toContain(`<${provider}`);
    }
  });

  it('FR-12: comment CRM không còn nhắc PageBreadCrumb (component đã xóa ở FR-09)', () => {
    const offenders = files.filter((path) => path.startsWith('/src/modules/crm/') && sources[path].includes('PageBreadCrumb'));
    expect(offenders).toEqual([]);
  });
});
