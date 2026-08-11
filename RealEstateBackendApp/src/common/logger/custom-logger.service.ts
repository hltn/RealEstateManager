import { ConsoleLogger, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import {
  createAppFileLogger,
  resolveLoggerOptions,
} from './winston.config';

/**
 * Logger tuỳ chỉnh kế thừa ConsoleLogger của NestJS.
 * Mục đích: đính kèm `[<file-caller>:<dong>]` vào mọi dòng log, trong đó
 * file:dòng là vị trí của CODE GỌI log (caller thật), không phải vị trí
 * bên trong file logger này.
 *
 * Ghi ra console (stdout/stderr) bằng `super.*` và ghi thêm vào một file
 * theo ngày: `app-YYYY-MM-DD.log`.
 * Không dùng daily-rotate-file nên không sinh `*-audit.json`.
 */
@Injectable()
export class CustomLogger extends ConsoleLogger {
  /**
   * Trích xuất thông tin `[file:dòng]` của caller thật từ call stack.
   *
   * Nguyên lý: duyệt stack từ trong ra ngoài, bỏ qua các frame nội bộ:
   * - Frame của chính CustomLogger (getCallerInfo / prependCallerInfo / log / error...).
   * - Frame nằm trong node_modules (NestJS core, third-party, decorator wrapper...).
   * - Frame nội bộ của Node.js (node:internal).
   * - Frame không chứa đường dẫn file (Array.forEach, async Promise.all...).
   * Frame đầu tiên còn lại chính là code caller trong ứng dụng.
   *
   * Lưu ý: dùng basename của file (token sau dấu `/` hoặc `\`) để so khớp
   * separator-agnostic, vì Windows dùng `\` còn nhiều đường dẫn build/ts-node
   * dùng `/`. Việc match cả dòng bằng `includes` rất dễ miss do khác biệt path.
   */
  private getCallerInfo(): string {
    const stackLines = new Error().stack?.split('\n') ?? [];

    for (let i = 1; i < stackLines.length; i++) {
      const line = stackLines[i];

      // Chuẩn hoá dấu ngăn cách path: Windows dùng backslash và V8 in path
      // trong stack dạng `...\@nestjs\common\services\logger\logger.service.js`,
      // nhưng các pattern kiểm tra bên dưới dùng forward slash. Nếu không đồng
      // nhất, `@nestjs/common/services/logger` (forward slash) sẽ KHÔNG match
      // `@nestjs\common\services\logger` (backslash) -> frame wrapper NestJS
      // bị lấy nhầm làm caller (triệu chứng `[logger.service.js:57]`).
      const norm = line.replace(/\\/g, '/');

      // Bắt cặp `<filePath>:<line>:<column>)` ở cuối dòng stack.
      // Capture group 1 = đường dẫn file, group 2 = số dòng.
      const match = norm.match(/\(?([^()\s]+):(\d+):\d+\)?$/);
      if (!match) {
        // Dòng không có file:dòng (vd: "at Array.forEach (<anonymous>)") -> bỏ qua.
        continue;
      }

      const filePath = match[1];
      // Lấy basename file (token cuối sau `/` đã chuẩn hoá) để hiển thị gọn.
      const fileName = filePath.split('/').pop() ?? filePath;

      // Bỏ qua các frame nội bộ:
      // - Chính file logger này (cả .ts và .js khi chạy qua dist/ts-node).
      // - Wrapper/logger của NestJS (`@nestjs/common` bao hàm cả logger.service
      //   và console-logger, bất kể subpath) và `@nestjs/core`.
      // - Phụ thuộc third-party trong node_modules (trường hợp bundle có thể
      //   path không còn chữ node_modules, nên vẫn check cả `@nestjs/*` nữa).
      // - Frame nội bộ của Node.js (`node:internal`, `(node:`).
      if (
        fileName.startsWith('custom-logger.service') ||
        norm.includes('node_modules') ||
        norm.includes('@nestjs/common') ||
        norm.includes('@nestjs/core') ||
        norm.includes('node:internal') ||
        norm.includes('(node:')
      ) {
        continue;
      }

      return `[${fileName}:${match[2]}] `;
    }

    return '';
  }

  private prependCallerInfo(message: unknown): string {
    const callerInfo = this.getCallerInfo();

    if (typeof message === 'string') {
      return `${callerInfo}${message}`;
    }

    // Với message không phải chuỗi (object/array), serialize sạch để dễ đọc log.
    if (typeof message === 'object' && message !== null) {
      try {
        return `${callerInfo}${JSON.stringify(message)}`;
      } catch {
        return `${callerInfo}[Object]`;
      }
    }

    return `${callerInfo}${String(message)}`;
  }

  private fileLogger: Logger | null | undefined;

  private getFileLogger(): Logger | null {
    if (this.fileLogger !== undefined) return this.fileLogger;
    try {
      if (process.env.NODE_ENV === 'test') {
        this.fileLogger = null;
        return null;
      }
      this.fileLogger = createAppFileLogger(resolveLoggerOptions());
      return this.fileLogger;
    } catch {
      this.fileLogger = null;
      return null;
    }
  }

  private forwardToFile(
    level: 'log' | 'error' | 'warn' | 'debug' | 'verbose',
    message: string,
  ): void {
    const logger = this.getFileLogger();
    if (!logger) return;
    try {
      logger.log(level === 'log' ? 'info' : level, message);
    } catch {
      // File logging must not interrupt the application.
    }
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const prepended = this.prependCallerInfo(message);
    super.log(prepended, ...optionalParams);
    this.forwardToFile('log', prepended);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const prepended = this.prependCallerInfo(message);
    super.error(prepended, ...optionalParams);
    this.forwardToFile('error', prepended);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const prepended = this.prependCallerInfo(message);
    super.warn(prepended, ...optionalParams);
    this.forwardToFile('warn', prepended);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const prepended = this.prependCallerInfo(message);
    super.debug(prepended, ...optionalParams);
    this.forwardToFile('debug', prepended);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const prepended = this.prependCallerInfo(message);
    super.verbose(prepended, ...optionalParams);
    this.forwardToFile('verbose', prepended);
  }
}
