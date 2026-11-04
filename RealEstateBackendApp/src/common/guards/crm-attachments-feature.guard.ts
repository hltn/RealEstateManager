import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../shared/feature-flags/feature-flag.service';

/**
 * Cổng tính năng ảnh đính kèm nhật ký: `FEATURE_CRM_ATTACHMENTS` tắt thì route upload/gỡ ảnh trả 404
 * (giống route không tồn tại). Dùng kèm `CrmFeatureGuard` (cờ CRM tổng).
 */
@Injectable()
export class CrmAttachmentsFeatureGuard implements CanActivate {
  constructor(private readonly featureFlags: FeatureFlagService) {}

  canActivate(): boolean {
    if (!this.featureFlags.isEnabled(FeatureFlag.CRM_ATTACHMENTS)) {
      throw new NotFoundException('Not Found');
    }
    return true;
  }
}
