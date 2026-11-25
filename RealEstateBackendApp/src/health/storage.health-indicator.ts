import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { withTimeout } from '../common/utils/with-timeout.util';
import {
  FILE_STORAGE,
  type IFileStorage,
} from '../shared/storage/file-storage.interface';

const STORAGE_CHECK_TIMEOUT_MS = 4000;

/**
 * Readiness: S3/MinIO với tới được mọi bucket đã cấu hình (HeadBucket).
 * Chưa cấu hình bucket nào (môi trường chưa dùng CRM) thì báo `up` kèm `configured: false`
 * để không làm đỏ readiness của các deployment cũ.
 */
@Injectable()
export class StorageHealthIndicator {
  constructor(
    private readonly indicatorService: HealthIndicatorService,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.indicatorService.check(key);
    if (!this.storage.isConfigured()) {
      return indicator.up({ configured: false });
    }
    try {
      await withTimeout(this.storage.checkHealth(), STORAGE_CHECK_TIMEOUT_MS);
      return indicator.up();
    } catch {
      return indicator.down({ message: 'Không kết nối được S3/MinIO' });
    }
  }
}
