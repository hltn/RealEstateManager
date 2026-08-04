import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * @Public() — đánh dấu route KHÔNG cần JwtAuthGuard.
 * Áp dụng cho login, refresh, health probes, swagger docs.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
