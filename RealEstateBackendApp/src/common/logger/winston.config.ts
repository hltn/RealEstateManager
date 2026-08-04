import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/**
 * Cấu hình logger file (daily rotation) cho backend.
 *
 * Triết lý:
 * - Console output vẫn do `CustomLogger extends ConsoleLogger` đảm nhiệm
 *   (giữ feature `[file:line]` caller + không phá test spy trên
 *   `ConsoleLogger.prototype.*`).
 * - Winston logger tạo tại đây CHỈ chứa transport file (không console)
 *  → tránh double-log ra stdout. Mọi dòng log đã được CustomLogger
 *   prepend caller info trước khi forward xuống winston.
 * - Daily rotation: 1 file/ngày, nén gzip file cũ, retention theo env.
 *
 * Đọc config từ `process.env` (lazy init tại lần log đầu tiên, sau khi
 * `@nestjs/config` đã load `.env` vào process.env). Default an toàn cho dev.
 */
export interface AppLoggerOptions {
  /** Level ngưỡng cho winston logger (vd: 'info' | 'debug' | 'error'). */
  level: string;
  /** Thư mục lưu file log (tạo runtime bởi daily-rotate-file). */
  logDir: string;
  /** Số ngày giữ file log (retention). */
  retentionDays: number;
}

export const DEFAULT_LOG_LEVEL = 'info';
export const DEFAULT_LOG_DIR = 'logs';
export const DEFAULT_LOG_RETENTION_DAYS = 14;

/**
 * Lựa chọn config logger từ env với default hợp lý.
 * Ưu tiên `process.env.LOG_*`, fallback default dev-friendly.
 */
export function resolveLoggerOptions(): AppLoggerOptions {
  const retentionRaw = Number(process.env.LOG_RETENTION_DAYS);
  return {
    level: process.env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    logDir: process.env.LOG_DIR ?? DEFAULT_LOG_DIR,
    // NaN/negative → fallback default (tránh crash app do config sai).
    retentionDays:
      Number.isFinite(retentionRaw) && retentionRaw > 0
        ? retentionRaw
        : DEFAULT_LOG_RETENTION_DAYS,
  };
}

/**
 * Tạo winston logger CHỈ ghi file (daily rotation + error-only).
 * Trả về instance winston.Logger đã cấu hình sẵn transport.
 *
 * Lưu ý: KHÔNG thêm console transport ở đây — console do CustomLogger
 * (extends ConsoleLogger) đảm nhiệm, tránh trùng lặp stdout.
 */
export function createAppFileLogger(opts: AppLoggerOptions): winston.Logger {
  // Format thống nhất: `[ISO timestamp] [LEVEL] message`
  // message đã chứa prefix caller `[file:line]` do CustomLogger prepend.
  const lineFormat = winston.format.combine(
    winston.format.timestamp({ format: () => new Date().toISOString() }),
    winston.format.printf(
      ({ timestamp, level, message }) =>
        `[${timestamp}] [${level.toUpperCase()}] ${message ?? ''}`,
    ),
  );

  // Transport file tổng hợp: level >= info (info/warn/error).
  // debug/verbose KHÔNG ghi file (chỉ console) → tránh file phình.
  const appFileTransport = new DailyRotateFile({
    dirname: opts.logDir,
    filename: 'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: `${opts.retentionDays}d`,
    zippedArchive: true,
    level: 'info',
  });

  // Transport file error-only (riêng biệt) → truy vết sự cố nhanh.
  const errorFileTransport = new DailyRotateFile({
    dirname: opts.logDir,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: `${opts.retentionDays}d`,
    zippedArchive: true,
    level: 'error',
  });

  return winston.createLogger({
    level: opts.level,
    format: lineFormat,
    transports: [appFileTransport, errorFileTransport],
  });
}
