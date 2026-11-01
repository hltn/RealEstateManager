import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { createS3Client } from './s3.config';
import { FILE_STORAGE } from './file-storage.interface';
import { FileStorageService } from './file-storage.service';
import { S3_CLIENT, S3_PRESIGN_CLIENT } from './storage.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createS3Client(config),
    },
    {
      // Có S3_PUBLIC_ENDPOINT thì ký URL bằng host công khai; không thì dùng chung client nội bộ.
      provide: S3_PRESIGN_CLIENT,
      inject: [ConfigService, S3_CLIENT],
      useFactory: (config: ConfigService, internal: S3Client): S3Client =>
        config.get<string>('S3_PUBLIC_ENDPOINT')?.trim()
          ? createS3Client(config, 'S3_PUBLIC_ENDPOINT')
          : internal,
    },
    FileStorageService,
    { provide: FILE_STORAGE, useExisting: FileStorageService },
  ],
  exports: [FILE_STORAGE, FileStorageService],
})
export class StorageModule {}
