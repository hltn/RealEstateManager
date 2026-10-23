/**
 * GlobalExceptionFilter unit spec — chuẩn lỗi tài liệu 05 mục 1.3.
 *
 * Bao phủ:
 * - 4 trường bắt buộc { statusCode, message, timestamp, path }; errorCode/details chỉ có khi áp dụng.
 * - BusinessException: errorCode + details + status + message tiếng Việt được giữ nguyên.
 * - Dịch message mặc định tiếng Anh của Nest sang tiếng Việt; message tự viết giữ nguyên.
 * - errorCode suy ra từ status cho exception thường (VALIDATION_FAILED, UNAUTHORIZED...).
 * - Lỗi không lường trước: 500 + thông báo chung, KHÔNG lộ message/stack gốc; stack chỉ vào log.
 * - Lỗi 4xx của Fastify (JSON hỏng, body quá lớn) không bị nuốt thành 500.
 */
import {
  ArgumentsHost,
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode } from '../exceptions/error-codes';
import { GlobalExceptionFilter } from './global-exception.filter';

function run(exception: unknown, url = '/api/v1/items') {
  const send = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  const reply = { status, send } as unknown as FastifyReply;
  const request = { url, method: 'POST' } as unknown as FastifyRequest;
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  new GlobalExceptionFilter().catch(exception, host);

  return {
    statusCode: status.mock.calls[0][0] as number,
    body: send.mock.calls[0][0] as Record<string, unknown>,
  };
}

describe('GlobalExceptionFilter', () => {
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('BusinessException', () => {
    it('trả errorCode, details, status và message tiếng Việt đúng như khai báo', () => {
      const { statusCode, body } = run(
        new BusinessException(
          ErrorCode.PROJECT_IN_USE,
          'Dự án đang có khách hàng tham chiếu, không thể xóa',
          HttpStatus.CONFLICT,
          { customerCount: 12 },
        ),
        '/api/v1/crm/projects/1',
      );

      expect(statusCode).toBe(409);
      expect(body).toMatchObject({
        statusCode: 409,
        message: 'Dự án đang có khách hàng tham chiếu, không thể xóa',
        path: '/api/v1/crm/projects/1',
        errorCode: 'PROJECT_IN_USE',
        details: { customerCount: 12 },
      });
      expect(new Date(body.timestamp as string).getTime()).not.toBeNaN();
    });

    it('không có details thì response không có khóa details (tương thích ngược)', () => {
      const { body } = run(
        new BusinessException(
          ErrorCode.INVALID_PHONE,
          'Số điện thoại không hợp lệ',
        ),
      );

      expect(body.statusCode).toBe(400);
      expect(body.errorCode).toBe('INVALID_PHONE');
      expect(body).not.toHaveProperty('details');
    });
  });

  describe('HttpException thường', () => {
    it('message tự viết giữ nguyên, status đúng', () => {
      const { statusCode, body } = run(
        new ConflictException('Đã có khách này'),
      );

      expect(statusCode).toBe(409);
      expect(body.message).toBe('Đã có khách này');
      expect(body).not.toHaveProperty('errorCode');
    });

    it.each([
      [
        new UnauthorizedException(),
        'Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn',
        'UNAUTHORIZED',
      ],
      [
        new ForbiddenException('Insufficient role'),
        'Bạn không có quyền thực hiện thao tác này',
        'INSUFFICIENT_ROLE',
      ],
      [
        new NotFoundException(),
        'Không tìm thấy dữ liệu yêu cầu',
        'RESOURCE_NOT_FOUND',
      ],
    ])(
      'message mặc định tiếng Anh của Nest được dịch + gắn errorCode (%#)',
      (exception, message, errorCode) => {
        const { body } = run(exception);

        expect(body.message).toBe(message);
        expect(body.errorCode).toBe(errorCode);
      },
    );

    it('lỗi validate (message là mảng) giữ nguyên mảng và gắn VALIDATION_FAILED', () => {
      const messages = ['name must be a string', 'age must be positive'];
      const { statusCode, body } = run(new BadRequestException(messages));

      expect(statusCode).toBe(400);
      expect(body.message).toEqual(messages);
      expect(body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('BadRequest message chuỗi tự viết không bị gắn VALIDATION_FAILED', () => {
      const { body } = run(new BadRequestException('Ngày không hợp lệ'));
      expect(body).not.toHaveProperty('errorCode');
    });
  });

  describe('503 từ health check (Terminus)', () => {
    it('dịch message, gắn SERVICE_UNAVAILABLE và đưa trạng thái từng thành phần vào details', () => {
      const { statusCode, body } = run(
        new ServiceUnavailableException({
          status: 'error',
          error: {
            redis: { status: 'down', message: 'Không kết nối được Redis' },
          },
          message: 'Service Unavailable Exception',
        }),
        '/api/v1/health/readiness',
      );

      expect(statusCode).toBe(503);
      expect(body.errorCode).toBe('SERVICE_UNAVAILABLE');
      expect(body.message).toBe(
        'Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau',
      );
      expect(body.details).toEqual({
        redis: { status: 'down', message: 'Không kết nối được Redis' },
      });
    });

    it('503 thường (không phải health check) không có details', () => {
      const { body } = run(new ServiceUnavailableException());
      expect(body.errorCode).toBe('SERVICE_UNAVAILABLE');
      expect(body).not.toHaveProperty('details');
    });
  });

  describe('HttpException 5xx do code nghiệp vụ ném', () => {
    it.each([
      [new InternalServerErrorException('AI API failed: sk-live-123'), 500],
      [new BadGatewayException('upstream said key=abc'), 502],
    ])(
      'che message gốc bằng thông báo chung + INTERNAL_ERROR, message gốc chỉ vào log (%#)',
      (exception, status) => {
        const { statusCode, body } = run(exception);

        expect(statusCode).toBe(status);
        expect(body.message).toBe(
          'Hệ thống đang gặp sự cố, vui lòng thử lại sau',
        );
        expect(body.errorCode).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(body)).not.toMatch(/sk-live|key=abc/);
        expect(loggerError).toHaveBeenCalledWith(
          expect.stringMatching(/sk-live-123|key=abc/),
          expect.anything(),
        );
      },
    );
  });

  describe('query string không được lộ', () => {
    it('path trong body lỗi và dòng log 5xx đều bỏ query string (PII như ?phone=)', () => {
      const url = '/api/v1/crm/customers?phone=0912345678&email=a@b.vn';

      const clientError = run(new NotFoundException('x'), url);
      const serverError = run(new Error('boom'), url);

      expect(clientError.body.path).toBe('/api/v1/crm/customers');
      expect(serverError.body.path).toBe('/api/v1/crm/customers');
      const logged = loggerError.mock.calls
        .map((call) => String(call[0]))
        .join('\n');
      expect(logged).toContain('/api/v1/crm/customers');
      expect(logged).not.toMatch(/0912345678|a@b\.vn/);
    });
  });

  describe('lỗi không lường trước', () => {
    it('Error thuần: 500 + thông báo chung, KHÔNG lộ message gốc, có INTERNAL_ERROR', () => {
      const { statusCode, body } = run(
        new Error('E11000 duplicate key at mongodb://user:secret@db:27017'),
      );

      expect(statusCode).toBe(500);
      expect(body.errorCode).toBe('INTERNAL_ERROR');
      expect(body.message).toBe(
        'Hệ thống đang gặp sự cố, vui lòng thử lại sau',
      );
      expect(JSON.stringify(body)).not.toMatch(
        /secret|E11000|stack|mongodb:\/\//,
      );
    });

    it('stack chỉ ghi vào log máy chủ (kèm method + url), không có trong response', () => {
      const error = new Error('boom');

      const { body } = run(error, '/api/v1/crm/customers');

      expect(body).not.toHaveProperty('stack');
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('POST /api/v1/crm/customers -> 500'),
        error.stack,
      );
    });

    it('throw literal (không phải Error) vẫn trả 500, không crash', () => {
      const { statusCode, body } = run('a raw string');

      expect(statusCode).toBe(500);
      expect(body.errorCode).toBe('INTERNAL_ERROR');
    });

    it('lỗi 4xx thường không ghi log lỗi (tránh nhiễu log)', () => {
      run(new NotFoundException('x'));
      expect(loggerError).not.toHaveBeenCalled();
    });
  });

  describe('lỗi 4xx do Fastify ném', () => {
    it('body quá lớn (FST_ERR_CTP_BODY_TOO_LARGE, 413) giữ mã 413 với thông báo tiếng Việt', () => {
      const { statusCode, body } = run(
        Object.assign(new Error('Request body is too large'), {
          code: 'FST_ERR_CTP_BODY_TOO_LARGE',
          statusCode: 413,
        }),
      );

      expect(statusCode).toBe(413);
      expect(body.message).toBe('Dữ liệu gửi lên quá lớn');
    });

    it('JSON hỏng (400) giữ mã 400, không thành 500', () => {
      const { statusCode } = run(
        Object.assign(new SyntaxError('Unexpected token'), {
          code: 'FST_ERR_CTP_INVALID_JSON_BODY',
          statusCode: 400,
        }),
      );

      expect(statusCode).toBe(400);
    });

    it('object có statusCode 4xx nhưng không phải lỗi Fastify (code không phải FST_*) vẫn là 500', () => {
      const { statusCode } = run(
        Object.assign(new Error('x'), { statusCode: 418 }),
      );
      expect(statusCode).toBe(500);
    });
  });
});
