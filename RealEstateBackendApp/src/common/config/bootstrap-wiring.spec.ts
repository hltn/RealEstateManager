import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Test dây khởi động: những chỗ `main.ts` / `AppModule` phải nối đúng cấu hình. Là test tĩnh vì import AppModule/
 * main.ts kéo theo ESM (jsdom...) mà jest unit không nạp được và main.ts tự chạy `bootstrap()`.
 */
describe('bootstrap wiring (FR-18)', () => {
  const srcDir = join(__dirname, '..', '..');
  const readSrc = (name: string): string =>
    readFileSync(join(srcDir, name), 'utf8');

  it('AppModule truyền ENV_FILE_PATHS (import từ env-files.config) vào ConfigModule.forRoot({ envFilePath })', () => {
    const appModule = readSrc('app.module.ts');

    expect(appModule).toMatch(
      /import\s*\{[^}]*\bENV_FILE_PATHS\b[^}]*\}\s*from\s*'\.\/common\/config\/env-files\.config'/,
    );
    expect(appModule).toMatch(
      /ConfigModule\.forRoot\(\{[^}]*envFilePath:\s*\[\.\.\.ENV_FILE_PATHS\]/,
    );
  });

  it('main.ts import load-env ĐẦU TIÊN (trước NestFactory/AppModule) để env sẵn trước DI', () => {
    const imports = readSrc('main.ts')
      .split(/\r?\n/)
      .filter((line) => /^import\b/.test(line));

    expect(imports[0]).toContain("'./common/config/load-env'");
  });

  it('main.ts đọc cờ Swagger qua setupSwaggerFromConfig(app, configService)', () => {
    expect(readSrc('main.ts')).toMatch(
      /setupSwaggerFromConfig\(\s*app,\s*configService/,
    );
  });
});
