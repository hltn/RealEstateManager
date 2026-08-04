import { Injectable, NestMiddleware } from '@nestjs/common';
import { IncomingMessage, ServerResponse } from 'http';
import { requestContextStorage } from '../services/request-context.service';

/**
 * Middleware gắn X-Request-ID vào mỗi request để hỗ trợ trace xuyên service.
 *
 * Luồng xử lý:
 * 1. Đọc header 'x-request-id' từ incoming request.
 * 2. Nếu không có → sinh UUID mới bằng crypto.randomUUID() (Node.js built-in, không cần thư viện).
 * 3. Lưu requestId vào AsyncLocalStorage để mọi service trong cùng async context đều đọc được.
 * 4. Set header 'x-request-id' vào response để FE/caller nhận lại ID.
 *
 * Ghi chú: dùng IncomingMessage/ServerResponse thay vì FastifyRequest/FastifyReply
 * vì NestJS middleware configure() chạy ở tầng Node.js core (không qua Fastify adapter).
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    // Đọc header từ request — header name luôn lowercase ở Node.js HTTP
    const incomingId = req.headers['x-request-id'] as string | undefined;

    // Nếu FE/caller không gửi thì tự sinh UUID mới
    const requestId = incomingId ?? crypto.randomUUID();

    // Đính requestId vào response header để caller có thể trace ngược lại
    res.setHeader('x-request-id', requestId);

    // Chạy toàn bộ async chain (handlers, services...) trong cùng một ALS context
    requestContextStorage.run({ requestId }, () => next());
  }
}
