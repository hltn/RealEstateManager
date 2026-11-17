import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Audit cấu trúc mã nguồn BE (spec v1.0.6, FR-05..FR-08): khóa lại các việc dọn file/dời thư mục để không
 * bị quay lại. Đọc mã tĩnh, không chạm DB hay mạng (cùng kiểu với role-coverage.audit.spec.ts).
 *
 * Phần không kiểm bằng jest (ghi trong báo cáo T-05..T-08): `skills-lock.json` ngoài git index (FR-05) và
 * `dist/` sau `npm run build` không chứa fixture (FR-07) là "kiểm chứng khác: lệnh git/find" vì cần git và
 * một lần build thật.
 */

const SRC_ROOT = path.resolve(__dirname, '..', '..');
const BE_ROOT = path.resolve(SRC_ROOT, '..');
const BUILD_TSCONFIG = path.join(BE_ROOT, 'tsconfig.build.json');

const readJson = (file: string): Record<string, any> => {
  const { config, error } = ts.readConfigFile(file, (f) => ts.sys.readFile(f));
  if (error) throw new Error(`Không đọc được ${file}`);
  return config;
};

/** Danh sách file TS mà `nest build` biên dịch (đã áp `exclude` của tsconfig.build.json). */
const getBuildFiles = (): string[] => {
  const parsed = ts.parseJsonConfigFileContent(
    readJson(BUILD_TSCONFIG),
    ts.sys,
    BE_ROOT,
  );
  return parsed.fileNames.map((f) => path.normalize(f));
};

const walk = (dir: string, acc: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
};

const isSpec = (file: string): boolean => /\.spec\.ts$/.test(file);
const rel = (file: string): string =>
  path.relative(BE_ROOT, file).split(path.sep).join('/');

describe('Cấu trúc BE (audit tĩnh)', () => {
  const srcFiles = walk(SRC_ROOT).filter((f) => f.endsWith('.ts'));
  const nonSpecSrc = srcFiles.filter((f) => !isSpec(f));

  describe('FR-05: file thừa gốc BE và mẫu Hello World', () => {
    it('FR-05: các file thừa ở gốc BE và thư mục test/ mẫu không còn tồn tại', () => {
      const removed = [
        'add_description.py',
        'add_query_param.py',
        'add_swagger.py',
        'fix_dto.py',
        'test-extractor.ts',
        'test-rss.js',
        'test',
        'src/app.controller.ts',
        'src/app.service.ts',
      ];
      const stillThere = removed.filter((p) =>
        fs.existsSync(path.join(BE_ROOT, p)),
      );
      expect(stillThere).toEqual([]);
    });

    it('FR-05: không file nguồn nào còn tham chiếu AppController/AppService', () => {
      const offenders = srcFiles
        .filter((f) => f !== __filename)
        .filter((f) =>
          /\bApp(Controller|Service)\b/.test(fs.readFileSync(f, 'utf8')),
        )
        .map(rel);
      expect(offenders).toEqual([]);
    });

    it('FR-05: tsconfig.build.json không còn exclude "test" và "test-extractor.ts"; package.json không còn script test:e2e', () => {
      const exclude: string[] = readJson(BUILD_TSCONFIG).exclude;
      expect(exclude).not.toContain('test');
      expect(exclude).not.toContain('test-extractor.ts');
      const pkg = readJson(path.join(BE_ROOT, 'package.json'));
      expect(pkg.scripts['test:e2e']).toBeUndefined();
    });

    it('FR-05: giữ nguyên gói @mendable/firecrawl-js và scripts/import-care-data.mjs', () => {
      const pkg = readJson(path.join(BE_ROOT, 'package.json'));
      expect(pkg.dependencies['@mendable/firecrawl-js']).toBeDefined();
      expect(
        fs.existsSync(path.join(BE_ROOT, 'scripts', 'import-care-data.mjs')),
      ).toBe(true);
    });
  });

  describe('FR-06: file chết trong src', () => {
    it('FR-06: news-article.dto và content-cleaner không còn, không ai import', () => {
      const removed = [
        'modules/news-fire-crawl-manager/dtos/news-article.dto.ts',
        'modules/news-fire-crawl-manager/dtos/news-article.dto.spec.ts',
        'utils/content-cleaner.ts',
        'utils/content-cleaner.spec.ts',
      ];
      expect(
        removed.filter((p) => fs.existsSync(path.join(SRC_ROOT, p))),
      ).toEqual([]);
      const offenders = srcFiles
        .filter((f) => f !== __filename)
        .filter((f) =>
          /news-article\.dto|content-cleaner/.test(fs.readFileSync(f, 'utf8')),
        )
        .map(rel);
      expect(offenders).toEqual([]);
    });

    it('FR-06: firecrawl.service.ts vẫn còn (Oniichan chọn giữ gói firecrawl)', () => {
      const found = srcFiles.filter((f) => /firecrawl\.service\.ts$/.test(f));
      expect(found.length).toBeGreaterThan(0);
    });
  });

  describe('FR-07: fixture test không vào build production', () => {
    const fixtureFiles = srcFiles.filter((f) => /\.fixture\.ts$/.test(f));

    it('FR-07: hai helper nằm ở dạng *.fixture.ts, tên cũ đã mất', () => {
      const names = fixtureFiles.map((f) => path.basename(f));
      expect(names).toEqual(
        expect.arrayContaining([
          'memory-replset.fixture.ts',
          'thumbnail-test-images.fixture.ts',
        ]),
      );
      expect(
        fs.existsSync(
          path.join(SRC_ROOT, 'shared/database/memory-replset.util.ts'),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(
            SRC_ROOT,
            'modules/crm/care-logs/utils/thumbnail-test-images.ts',
          ),
        ),
      ).toBe(false);
    });

    it('FR-07: nest-cli.json (builder swc) ignore *.fixture.ts, vì swc không đọc exclude của tsconfig', () => {
      const nestCli = readJson(path.join(BE_ROOT, 'nest-cli.json'));
      const builder = nestCli.compilerOptions.builder;
      expect(builder.type).toBe('swc');
      expect(builder.options.ignore).toEqual(
        expect.arrayContaining(['**/*.fixture.ts']),
      );
    });

    it('FR-07: tsconfig.build.json cũng exclude *.fixture.ts (nhánh tsc/IDE)', () => {
      const leaked = getBuildFiles().filter((f) => /\.fixture\.ts$/.test(f));
      expect(leaked.map(rel)).toEqual([]);
    });

    it('FR-07: không file non-spec nào import fixture hoặc mongodb-memory-server', () => {
      const offenders = nonSpecSrc
        .filter((f) => !/\.fixture\.ts$/.test(f))
        .filter((f) =>
          /\.fixture['"]|mongodb-memory-server/.test(
            fs.readFileSync(f, 'utf8'),
          ),
        )
        .map(rel);
      expect(offenders).toEqual([]);
    });

    it('FR-07: tập file build không import mongodb-memory-server (devDependency)', () => {
      const offenders = getBuildFiles()
        .filter((f) => /mongodb-memory-server/.test(fs.readFileSync(f, 'utf8')))
        .map(rel);
      expect(offenders).toEqual([]);
    });
  });

  describe('FR-08: cấu trúc thư mục BE', () => {
    const exists = (p: string): boolean =>
      fs.existsSync(path.join(SRC_ROOT, p));

    it('FR-08: health gom vào src/health/ (controller, module, spec, 2 indicator), chỗ cũ đã mất', () => {
      const expected = [
        'health/health.controller.ts',
        'health/health.controller.spec.ts',
        'health/health.module.ts',
        'health/health-indicators.spec.ts',
        'health/redis.health-indicator.ts',
        'health/storage.health-indicator.ts',
      ];
      expect(expected.filter((p) => !exists(p))).toEqual([]);
      const legacy = [
        'health.controller.ts',
        'health.controller.spec.ts',
        'health.module.ts',
        'health-indicators',
      ];
      expect(legacy.filter(exists)).toEqual([]);
    });

    it('FR-08: article-extractor và cosine-similarity nằm trong module news (utils/), không còn ở src/utils', () => {
      const dir = 'modules/news-fire-crawl-manager/utils';
      const names = [
        'article-extractor.util.ts',
        'article-extractor.util.spec.ts',
        'cosine-similarity.util.ts',
        'cosine-similarity.util.spec.ts',
      ];
      expect(names.filter((n) => !exists(`${dir}/${n}`))).toEqual([]);
      expect(names.filter((n) => exists(`utils/${n}`))).toEqual([]);
    });

    it('FR-08: 27 file crm-*.integration.spec.ts nằm hết ở modules/crm/__integration__/, gốc modules/crm/ không còn file nào', () => {
      const crmRoot = path.join(SRC_ROOT, 'modules/crm');
      const isCrmIntegration = (n: string): boolean =>
        /^crm-.*\.integration\.spec\.ts$/.test(n);
      const atRoot = fs.readdirSync(crmRoot).filter(isCrmIntegration);
      expect(atRoot).toEqual([]);
      const moved = fs
        .readdirSync(path.join(crmRoot, '__integration__'))
        .filter(isCrmIntegration);
      expect(moved).toHaveLength(27);
    });

    it('FR-08: 26 file __integration__ vào test:integration, riêng crm-m2-perf vào test:perf (đủ 27)', () => {
      const scripts = readJson(path.join(BE_ROOT, 'package.json'))
        .scripts as Record<string, string>;
      const regexOf = (script: string): RegExp => {
        const match = /--testRegex "([^"]+)"/.exec(script);
        if (!match) throw new Error(`Script thiếu --testRegex: ${script}`);
        return new RegExp(match[1]);
      };
      const integrationRegex = regexOf(scripts['test:integration']);
      const perfRegex = regexOf(scripts['test:perf']);
      const ignoreIntegration = /"crm-m2-perf"/.test(
        scripts['test:integration'],
      );
      const dir = path.join(SRC_ROOT, 'modules/crm/__integration__');
      const files = fs
        .readdirSync(dir)
        .filter((n) => /^crm-.*\.integration\.spec\.ts$/.test(n));
      const inIntegration = files.filter(
        (n) =>
          integrationRegex.test(n) &&
          !(ignoreIntegration && /crm-m2-perf/.test(n)),
      );
      const inPerf = files.filter((n) => perfRegex.test(n));
      expect(inIntegration).toHaveLength(26);
      expect(inPerf).toEqual(['crm-m2-perf.integration.spec.ts']);
      expect(inIntegration.length + inPerf.length).toBe(27);
    });

    it('FR-08: tsconfig.json và tsconfig.build.json của BE không còn exclude "client"', () => {
      for (const file of ['tsconfig.json', 'tsconfig.build.json']) {
        const exclude: string[] = readJson(path.join(BE_ROOT, file)).exclude;
        expect({ file, hasClient: exclude.includes('client') }).toEqual({
          file,
          hasClient: false,
        });
      }
    });
  });
});
