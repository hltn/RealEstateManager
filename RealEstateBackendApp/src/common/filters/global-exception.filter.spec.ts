/**
 * GlobalExceptionFilter unit spec — contract mục 2 (Global Error Format).
 *
 * Bao phủ:
 * - HttpException với string response → trả nguyên string làm message.
 * - HttpException với object { message: string } → lấy field `message`.
 * - HttpException với object { message: string[] } (validation) → giữ nguyên array.
 * - Non-HttpException (Error, throw literal...) → 500 + "Internal server error".
 * - Format response chuẩn: { statusCode, message, timestamp, path }.
 * - path lấy từ request.url, status set vào FastifyReply.
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * Tự build một ArgumentsHost HTTP-mode tối giản thay vì dùng ExecutionContextHost
 * (class nội bộ @nestjs/core không export public, không đáng tin cậy cho unit test).
 */
function createHost(reply: FastifyReply, request: FastifyRequest) {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as import('@nestjs/common').ArgumentsHost;
}

function mockReply(): {
  reply: FastifyReply;
  statusSpy: jest.Mock;
  sendSpy: jest.Mock;
} {
  const statusSpy = jest.fn().mockReturnThis();
  const sendSpy = jest.fn().mockReturnThis();
  const reply = {
    status: statusSpy,
    send: sendSpy,
  } as unknown as FastifyReply;
  return { reply, statusSpy, sendSpy };
}

function mockRequest(url = '/api/v1/items'): FastifyRequest {
  return { url } as unknown as FastifyRequest;
}

describe('GlobalExceptionFilter (contract mục 2 — Global Error Format)', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  it('HttpException với string response → message giữ nguyên string', () => {
    const { reply, statusSpy, sendSpy } = mockReply();
    const host = createHost(reply, mockRequest('/api/v1/foo'));

    filter.catch(new NotFoundException('Resource not found'), host);

    expect(statusSpy).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Resource not found',
        path: '/api/v1/foo',
      }),
    );
    expect(typeof sendSpy.mock.calls[0][0].timestamp).toBe('string');
    expect(new Date(sendSpy.mock.calls[0][0].timestamp).getTime()).not.toBeNaN();
  });

  it('HttpException với object { message: "..." } → lấy field message', () => {
    const { reply, statusSpy, sendSpy } = mockReply();
    const host = createHost(reply, mockRequest('/x'));

    filter.catch(new UnauthorizedException('Token expired'), host);

    expect(statusSpy).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(sendSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Token expired',
        path: '/x',
      }),
    );
  });

  it('HttpException với object { message: string[] } (validation) → message giữ nguyên array', () => {
    const { reply, sendSpy } = mockReply();
    const host = createHost(reply, mockRequest('/y'));

    // BadRequestException khi throw với mảng message → response.message là array.
    filter.catch(
      new BadRequestException(['field1 must be a string', 'field2 is required']),
      host,
    );

    const payload = sendSpy.mock.calls[0][0];
    expect(payload.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(payload.message).toEqual([
      'field1 must be a string',
      'field2 is required',
    ]);
    expect(payload.path).toBe('/y');
  });

  it('HttpException subclass (ForbiddenException) → map đúng status 403', () => {
    const { reply, statusSpy, sendSpy } = mockReply();
    const host = createHost(reply, mockRequest('/forbidden'));

    filter.catch(new ForbiddenException('no access'), host);

    expect(statusSpy).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(sendSpy.mock.calls[0][0].message).toBe('no access');
  });

  it('Non-HttpException (Error thuần) → 500 + "Internal server error"', () => {
    const { reply, statusSpy, sendSpy } = mockReply();
    const host = createHost(reply, mockRequest('/boom'));

    filter.catch(new Error('something exploded internally'), host);

    expect(statusSpy).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const payload = sendSpy.mock.calls[0][0];
    expect(payload.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(payload.message).toBe('Internal server error');
    expect(payload.path).toBe('/boom');
  });

  it('throw literal (không phải Error instance) → vẫn 500, không crash', () => {
    const { reply, sendSpy } = mockReply();
    const host = createHost(reply, mockRequest('/literal'));

    // Người dùng có thể `throw "string"` — filter không được ném lỗi.
    expect(() => filter.catch('a raw string' as unknown, host)).not.toThrow();
    const payload = sendSpy.mock.calls[0][0];
    expect(payload.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(payload.message).toBe('Internal server error');
  });

  it('Luôn trả đủ 4 field { statusCode, message, timestamp, path } (mục 2)', () => {
    const { reply, sendSpy } = mockReply();
    const host = createHost(reply, mockRequest('/contract'));

    filter.catch(new NotFoundException('x'), host);

    const payload = sendSpy.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(
      ['message', 'path', 'statusCode', 'timestamp'].sort(),
    );
  });
});
