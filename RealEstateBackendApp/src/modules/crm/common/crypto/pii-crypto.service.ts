import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../../shared/feature-flags/feature-flag.service';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
/** IV 12 byte là độ dài khuyến nghị của GCM (NIST SP 800-38D). */
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * Bản mã của một trường PII (lưu thẳng vào Mongo, khớp mô tả tài liệu 04 mục 3.2).
 * Mọi chuỗi đều là base64. `keyVersion` cho biết giải mã bằng khóa nào khi xoay khóa.
 */
export interface EncryptedPayload {
  cipherText: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/**
 * Mã hóa cấp trường cho dữ liệu cá nhân nhạy cảm (CCCD) bằng AES-256-GCM.
 *
 * Khóa (không nằm trong repo):
 * - `CRM_PII_ENCRYPTION_KEY`: khóa HIỆN HÀNH, 32 byte dạng base64 (44 ký tự) hoặc hex (64 ký tự).
 * - `CRM_PII_KEY_VERSION`: số hiệu của khóa hiện hành (mặc định 1) — được ghi vào mỗi bản mã.
 * - `CRM_PII_ENCRYPTION_KEY_V<n>`: các khóa CŨ còn cần để giải mã dữ liệu đã mã bằng version n
 *   (khi xoay khóa: đưa khóa cũ sang biến này, đặt khóa mới + tăng CRM_PII_KEY_VERSION).
 *
 * Fail-fast: khóa sai độ dài/định dạng ⇒ ném lỗi ngay lúc khởi tạo (app không lên được).
 * Khóa hiện hành bắt buộc khi `FEATURE_CRM_ENABLED=true`; khi CRM tắt và chưa cấu hình khóa,
 * service vẫn khởi tạo được nhưng encrypt/decrypt sẽ ném lỗi (không làm hỏng các module cũ).
 *
 * Mỗi lần mã hóa dùng IV ngẫu nhiên mới; authTag đảm bảo phát hiện dữ liệu bị sửa.
 * Lỗi giải mã KHÔNG kèm dữ liệu gốc/khóa (tránh lộ qua log).
 */
@Injectable()
export class PiiCryptoService {
  private readonly logger = new Logger(PiiCryptoService.name);
  private readonly keys = new Map<number, Buffer>();
  private readonly currentVersion: number;

  constructor(config: ConfigService, featureFlags: FeatureFlagService) {
    this.currentVersion = this.parseVersion(
      config.get<string>('CRM_PII_KEY_VERSION') ?? '1',
      'CRM_PII_KEY_VERSION',
    );

    const currentKey = config.get<string>('CRM_PII_ENCRYPTION_KEY')?.trim();
    if (currentKey) {
      this.keys.set(
        this.currentVersion,
        this.parseKey(currentKey, 'CRM_PII_ENCRYPTION_KEY'),
      );
    } else if (featureFlags.isEnabled(FeatureFlag.CRM_ENABLED)) {
      throw new Error(
        'Thiếu CRM_PII_ENCRYPTION_KEY: bắt buộc khi FEATURE_CRM_ENABLED=true (32 byte, base64 hoặc hex)',
      );
    } else {
      this.logger.warn(
        'CRM_PII_ENCRYPTION_KEY chưa cấu hình: mã hóa PII bị vô hiệu cho đến khi cấu hình khóa',
      );
    }

    this.loadOldKeys(config);
  }

  /**
   * Mã hóa chuỗi PII (ví dụ số CCCD). IV ngẫu nhiên mỗi lần ⇒ cùng đầu vào cho bản mã khác nhau.
   *
   * `aad` (Additional Authenticated Data) gắn bản mã với ngữ cảnh, ví dụ `${customerId}:nationalId`:
   * bản mã bị chép sang bản ghi/trường khác sẽ KHÔNG giải mã được dù cùng khóa. Không lưu trong payload,
   * nên lúc giải mã caller phải truyền ĐÚNG giá trị đã dùng khi mã hóa (không truyền = không có AAD).
   * Hiện chưa có dữ liệu PII nào được lưu, nên mọi bản mã CCCD ở M2 trở đi đều phải dùng aad.
   */
  encrypt(plainText: string, aad?: string): EncryptedPayload {
    const key = this.getKey(this.currentVersion);
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    return {
      cipherText: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.currentVersion,
    };
  }

  /**
   * Giải mã theo `keyVersion` ghi trong bản mã. Ném lỗi khi khóa không có, bản mã/IV/tag
   * bị sửa, sai khóa hoặc sai `aad` (GCM xác thực thất bại).
   */
  decrypt(payload: EncryptedPayload, aad?: string): string {
    const key = this.getKey(payload.keyVersion);
    try {
      const iv = Buffer.from(payload.iv, 'base64');
      const authTag = Buffer.from(payload.authTag, 'base64');
      if (
        iv.length !== IV_LENGTH_BYTES ||
        authTag.length !== AUTH_TAG_LENGTH_BYTES
      ) {
        throw new Error('invalid iv/authTag length');
      }
      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH_BYTES,
      });
      decipher.setAuthTag(authTag);
      if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload.cipherText, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error(
        'Giải mã PII thất bại: dữ liệu bị thay đổi hoặc sai khóa mã hóa',
      );
    }
  }

  /** Version khóa dùng để mã hóa mới — dùng cho job xoay khóa (tìm bản ghi có keyVersion cũ hơn). */
  getCurrentKeyVersion(): number {
    return this.currentVersion;
  }

  private getKey(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(
        `Chưa cấu hình khóa mã hóa PII cho keyVersion=${version} (CRM_PII_ENCRYPTION_KEY / CRM_PII_ENCRYPTION_KEY_V${version})`,
      );
    }
    return key;
  }

  /**
   * Nạp các khóa cũ `CRM_PII_ENCRYPTION_KEY_V<n>` (n < version hiện hành) để giải mã
   * dữ liệu đã mã trước khi xoay khóa.
   */
  private loadOldKeys(config: ConfigService): void {
    for (let version = 1; version < this.currentVersion; version++) {
      const envName = `CRM_PII_ENCRYPTION_KEY_V${version}`;
      const raw = config.get<string>(envName)?.trim();
      if (raw) this.keys.set(version, this.parseKey(raw, envName));
    }
  }

  /** Chấp nhận base64 hoặc hex, bắt buộc giải ra đúng 32 byte. */
  private parseKey(raw: string, envName: string): Buffer {
    const isHex = /^[0-9a-fA-F]{64}$/.test(raw);
    const key = Buffer.from(raw, isHex ? 'hex' : 'base64');
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `${envName} không hợp lệ: cần đúng ${KEY_LENGTH_BYTES} byte (base64 44 ký tự hoặc hex 64 ký tự), hiện ${key.length} byte`,
      );
    }
    return key;
  }

  private parseVersion(raw: string, envName: string): number {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`${envName} phải là số nguyên >= 1`);
    }
    return version;
  }
}
