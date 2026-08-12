import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';

export interface AppLoggerOptions {
  level: string;
  logDir: string;
}

export const DEFAULT_LOG_LEVEL = 'info';
export const DEFAULT_LOG_DIR = 'logs';

export function resolveLoggerOptions(): AppLoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    logDir: process.env.LOG_DIR ?? DEFAULT_LOG_DIR,
  };
}

function currentDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Tạo logger ghi app theo ngày bằng Winston File transport thuần.
 * Không dùng winston-daily-rotate-file nên không sinh *.audit.json.
 */
export function createAppFileLogger(opts: AppLoggerOptions): winston.Logger {
  const logDir = path.resolve(opts.logDir);
  fs.mkdirSync(logDir, { recursive: true });
  const dateKey = currentDateKey();
  const lineFormat = winston.format.combine(
    winston.format.timestamp({ format: () => new Date().toISOString() }),
    winston.format.printf(
      ({ timestamp, level, message }) =>
        `[${timestamp}] [${level.toUpperCase()}] ${message ?? ''}`,
    ),
  );

  return winston.createLogger({
    level: opts.level,
    format: lineFormat,
    transports: [
      new winston.transports.File({
        filename: path.join(logDir, `app-${dateKey}.log`),
      }),
    ],
  });
}

export function getLoggerDateKey(): string {
  return currentDateKey();
}
