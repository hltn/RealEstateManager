jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(function (this: any, frequency: string, callback: () => Promise<void>) {
    this.frequency = frequency;
    this.callback = callback;
    this.start = jest.fn();
    return this;
  }),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronjobService } from './cronjob.service';

/**
 * Test lưu/đọc cấu hình cron qua CRON_CONFIG_FILE bằng file thật trong thư mục tạm
 * (không mock fs) để bắt lỗi đường dẫn, thư mục cha thiếu, file hỏng/rỗng.
 */
describe('CronjobService - lưu trữ qua CRON_CONFIG_FILE', () => {
  let tmpRoot: string;
  let registry: { deleteCronJob: jest.Mock; addCronJob: jest.Mock };

  const buildService = (env: Record<string, string | undefined>): CronjobService => {
    const configService = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
    return new CronjobService(registry as unknown as SchedulerRegistry, configService);
  };

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cronjob-spec-'));
    registry = { deleteCronJob: jest.fn(), addCronJob: jest.fn() };
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('file chưa tồn tại: rơi về DAILY_CRAWLER_ACTIVE/FREQUENCY của env và không crash', () => {
    const cronFile = path.join(tmpRoot, 'state', 'cron.env');
    const service = buildService({
      CRON_CONFIG_FILE: cronFile,
      DAILY_CRAWLER_ACTIVE: 'true',
      DAILY_CRAWLER_FREQUENCY: '30 7 * * *',
    });

    expect(() => service.onApplicationBootstrap()).not.toThrow();

    expect(service.getConfig()).toEqual({ isActive: true, frequency: '30 7 * * *' });
    expect(registry.addCronJob).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(cronFile)).toBe(false);
  });

  it('updateConfig tạo thư mục cha còn thiếu và ghi đúng file CRON_CONFIG_FILE', () => {
    const cronFile = path.join(tmpRoot, 'a', 'b', 'cron.env');
    const service = buildService({ CRON_CONFIG_FILE: cronFile });

    service.updateConfig(true, '0 6 * * *');

    expect(fs.readFileSync(cronFile, 'utf8')).toBe('DAILY_CRAWLER_ACTIVE=true\nDAILY_CRAWLER_FREQUENCY=0 6 * * *\n');
  });

  it('ghi rồi khởi động lại (instance mới) đọc lại đúng giá trị, ưu tiên file hơn env', () => {
    const cronFile = path.join(tmpRoot, 'state', 'cron.env');
    buildService({ CRON_CONFIG_FILE: cronFile }).updateConfig(true, '15 9 * * *');

    const restarted = buildService({
      CRON_CONFIG_FILE: cronFile,
      DAILY_CRAWLER_ACTIVE: 'false',
      DAILY_CRAWLER_FREQUENCY: '0 1 * * *',
    });
    restarted.onApplicationBootstrap();

    expect(restarted.getConfig()).toEqual({ isActive: true, frequency: '15 9 * * *' });
  });

  it('đường dẫn lấy từ CRON_CONFIG_FILE, không ghi vào cwd/.env', () => {
    const cronFile = path.join(tmpRoot, 'custom.env');
    const cwdEnv = path.resolve(process.cwd(), '.env');
    const cwdEnvBefore = fs.existsSync(cwdEnv) ? fs.readFileSync(cwdEnv, 'utf8') : null;

    buildService({ CRON_CONFIG_FILE: cronFile }).updateConfig(false, '0 5 * * *');

    expect(fs.existsSync(cronFile)).toBe(true);
    const cwdEnvAfter = fs.existsSync(cwdEnv) ? fs.readFileSync(cwdEnv, 'utf8') : null;
    expect(cwdEnvAfter).toBe(cwdEnvBefore);
  });

  it('giữ nguyên các dòng khác trong file khi cập nhật', () => {
    const cronFile = path.join(tmpRoot, 'cron.env');
    fs.writeFileSync(cronFile, 'KEEP=1\nDAILY_CRAWLER_ACTIVE=false\n', 'utf8');

    buildService({ CRON_CONFIG_FILE: cronFile }).updateConfig(true, '0 4 * * *');

    expect(fs.readFileSync(cronFile, 'utf8')).toBe('KEEP=1\nDAILY_CRAWLER_ACTIVE=true\nDAILY_CRAWLER_FREQUENCY=0 4 * * *\n');
  });

  it('file rỗng: rơi về env, không crash', () => {
    const cronFile = path.join(tmpRoot, 'cron.env');
    fs.writeFileSync(cronFile, '', 'utf8');
    const service = buildService({
      CRON_CONFIG_FILE: cronFile,
      DAILY_CRAWLER_ACTIVE: 'true',
      DAILY_CRAWLER_FREQUENCY: '0 3 * * *',
    });

    expect(() => service.onApplicationBootstrap()).not.toThrow();

    expect(service.getConfig()).toEqual({ isActive: true, frequency: '0 3 * * *' });
  });

  it('file hỏng (rác, khóa rỗng): rơi về env cho khóa không dùng được, không crash', () => {
    const cronFile = path.join(tmpRoot, 'cron.env');
    fs.writeFileSync(cronFile, '\u0000\u0001garbage\nDAILY_CRAWLER_ACTIVE=\nDAILY_CRAWLER_FREQUENCY=\n', 'utf8');
    const service = buildService({
      CRON_CONFIG_FILE: cronFile,
      DAILY_CRAWLER_ACTIVE: 'true',
      DAILY_CRAWLER_FREQUENCY: '0 2 * * *',
    });

    expect(() => service.onApplicationBootstrap()).not.toThrow();

    expect(service.getConfig()).toEqual({ isActive: true, frequency: '0 2 * * *' });
  });

  it('CRON_CONFIG_FILE trỏ vào đường dẫn không ghi được: updateConfig không ném lỗi, cấu hình trong bộ nhớ vẫn đổi', () => {
    // Thư mục cha là một file thường => mkdirSync/writeFileSync chắc chắn lỗi.
    const blocker = path.join(tmpRoot, 'blocker');
    fs.writeFileSync(blocker, 'x', 'utf8');
    const service = buildService({ CRON_CONFIG_FILE: path.join(blocker, 'cron.env') });

    let result: { isActive: boolean; frequency: string } | undefined;
    expect(() => {
      result = service.updateConfig(true, '0 6 * * *');
    }).not.toThrow();

    expect(result).toEqual({ isActive: true, frequency: '0 6 * * *' });
  });
});
