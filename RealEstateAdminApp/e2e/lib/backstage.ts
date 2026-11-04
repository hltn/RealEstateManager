/**
 * Đối chiếu "hậu trường" (ngoài UI) cho spec: Mongo tạm, MinIO bucket e2e-*, Redis db 15.
 * Chỉ ĐỌC (và dọn trong phạm vi stack E2E). Dùng qua fixture `backstage` (xem fixtures.ts).
 */
import fs from 'node:fs';
import { PATHS, S3, assertIsolated } from '../env';
import { lib, s3Client, withRedis } from './infra';
import type { SeedState } from './seed';

export function readState(): SeedState {
  if (!fs.existsSync(PATHS.stateFile)) throw new Error('[E2E] Thiếu state.json: globalSetup chưa chạy xong?');
  return JSON.parse(fs.readFileSync(PATHS.stateFile, 'utf8')) as SeedState;
}

export class Backstage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  readonly state = readState();

  /** Collection của DB tạm `e2e` (vd `customers`, `care_logs`, `crm_attachments`, `appointments`, `reminders`). */
  async collection(name: string) {
    if (!this.client) {
      assertIsolated({ mongoUri: this.state.mongoUri }); // chỉ kết nối Mongo tạm của E2E, không bao giờ DB dev
      const { MongoClient } = lib('mongodb');
      this.client = new MongoClient(this.state.mongoUri);
      await this.client.connect();
    }
    return this.client.db('e2e').collection(name);
  }

  async find(name: string, filter: Record<string, unknown> = {}): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return (await this.collection(name)).find(filter).toArray();
  }

  async findOne(name: string, filter: Record<string, unknown> = {}) {
    return (await this.collection(name)).findOne(filter);
  }

  async count(name: string, filter: Record<string, unknown> = {}): Promise<number> {
    return (await this.collection(name)).countDocuments(filter);
  }

  /** Danh sách key object trong bucket E2E (mặc định bucket ảnh đính kèm). */
  async s3Keys(bucket: string = S3.bucketAttachments, prefix = ''): Promise<string[]> {
    const { ListObjectsV2Command } = lib('@aws-sdk/client-s3');
    const res = await s3Client().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    return (res.Contents ?? []).map((o: { Key: string }) => o.Key);
  }

  async s3Has(key: string, bucket: string = S3.bucketAttachments): Promise<boolean> {
    const { HeadObjectCommand } = lib('@aws-sdk/client-s3');
    try {
      await s3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Kích thước (byte) đối tượng MinIO, -1 nếu không có. */
  async s3Size(key: string, bucket: string = S3.bucketAttachments): Promise<number> {
    const { HeadObjectCommand } = lib('@aws-sdk/client-s3');
    try {
      const res = await s3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return Number(res.ContentLength);
    } catch {
      return -1;
    }
  }

  /** Key Redis db 15 (đã gồm tiền tố `e2e:` của backend), khớp pattern glob. */
  redisKeys(pattern = '*'): Promise<string[]> {
    return withRedis((r) => r.keys(pattern));
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
  }
}
