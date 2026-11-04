import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../shared/feature-flags/feature-flag.service';

/**
 * Cổng tính năng CRM: khi `FEATURE_CRM_ENABLED` tắt thì mọi route gắn guard này trả 404
 * (giống route không tồn tại) để code CRM merge/deploy an toàn mà không lộ ra Production.
 *
 * - Chạy SAU guard toàn cục (Throttler → JWT → Roles): chưa đăng nhập vẫn là 401, sai role vẫn là 403.
 * - Đọc cờ tại thời điểm gọi (không cache) theo thiết kế của `FeatureFlagService`.
 * - Chỉ gắn cho endpoint MỚI của CRM; endpoint cũ (`/auth/*`, `/users` hiện có) không bị ảnh hưởng.
 */
@Injectable()
export class CrmFeatureGuard implements CanActivate {
  constructor(private readonly featureFlags: FeatureFlagService) {}

  canActivate(): boolean {
    if (!this.featureFlags.isEnabled(FeatureFlag.CRM_ENABLED)) {
      throw new NotFoundException('Not Found');
    }
    return true;
  }
}
