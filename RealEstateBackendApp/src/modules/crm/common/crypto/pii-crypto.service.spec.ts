import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from '../../../../shared/feature-flags/feature-flag.service';
import { EncryptedPayload, PiiCryptoService } from './pii-crypto.service';

const NATIONAL_ID = '079123456789';

const newKeyBase64 = () => randomBytes(32).toString('base64');

function createService(env: Record<string, string | undefined> = {}) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new PiiCryptoService(config, new FeatureFlagService(config));
}

/** Đổi 1 ký tự của chuỗi base64 để mô phỏng dữ liệu bị sửa. */
function flipFirstByte(base64: string): string {
  const buffer = Buffer.from(base64, 'base64');
  buffer[0] ^= 0xff;
  return buffer.toString('base64');
}

describe('PiiCryptoService', () => {
  let key: string;
  let service: PiiCryptoService;

  beforeEach(() => {
    key = newKeyBase64();
    service = createService({ CRM_PII_ENCRYPTION_KEY: key });
  });

  describe('mã hóa / giải mã', () => {
    it('round-trip: giải mã trả đúng bản rõ (kể cả ký tự Unicode)', () => {
      expect(service.decrypt(service.encrypt(NATIONAL_ID))).toBe(NATIONAL_ID);
      expect(service.decrypt(service.encrypt('Nguyễn Văn Á'))).toBe(
        'Nguyễn Văn Á',
      );
    });

    it('bản mã không chứa bản rõ và có keyVersion hiện hành', () => {
      const payload = service.encrypt(NATIONAL_ID);

      expect(JSON.stringify(payload)).not.toContain(NATIONAL_ID);
      expect(payload.keyVersion).toBe(1);
      expect(Buffer.from(payload.iv, 'base64')).toHaveLength(12);
      expect(Buffer.from(payload.authTag, 'base64')).toHaveLength(16);
    });

    it('mỗi lần mã hóa dùng IV ngẫu nhiên: cùng đầu vào cho IV và bản mã khác nhau', () => {
      const a = service.encrypt(NATIONAL_ID);
      const b = service.encrypt(NATIONAL_ID);

      expect(a.iv).not.toBe(b.iv);
      expect(a.cipherText).not.toBe(b.cipherText);
      expect(service.decrypt(a)).toBe(service.decrypt(b));
    });
  });

  describe('phát hiện sai khóa / dữ liệu bị sửa', () => {
    it('giải mã bằng khóa khác thì lỗi', () => {
      const payload = service.encrypt(NATIONAL_ID);
      const other = createService({ CRM_PII_ENCRYPTION_KEY: newKeyBase64() });

      expect(() => other.decrypt(payload)).toThrow('Giải mã PII thất bại');
    });

    it.each<keyof EncryptedPayload>(['cipherText', 'authTag', 'iv'])(
      'sửa trường %s thì giải mã lỗi (GCM xác thực toàn vẹn)',
      (field) => {
        const payload = service.encrypt(NATIONAL_ID);
        const tampered = {
          ...payload,
          [field]: flipFirstByte(payload[field] as string),
        };

        expect(() => service.decrypt(tampered)).toThrow('Giải mã PII thất bại');
      },
    );

    it('IV/authTag sai độ dài thì lỗi', () => {
      const payload = service.encrypt(NATIONAL_ID);

      expect(() => service.decrypt({ ...payload, iv: 'AAAA' })).toThrow(
        'Giải mã PII thất bại',
      );
      expect(() => service.decrypt({ ...payload, authTag: 'AAAA' })).toThrow(
        'Giải mã PII thất bại',
      );
    });

    it('thông báo lỗi không lộ bản rõ hay khóa', () => {
      const payload = service.encrypt(NATIONAL_ID);
      const other = createService({ CRM_PII_ENCRYPTION_KEY: newKeyBase64() });

      let message = '';
      try {
        other.decrypt(payload);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain(NATIONAL_ID);
      expect(message).not.toContain(key);
    });
  });

  describe('AAD (gắn bản mã với bản ghi)', () => {
    it('giải mã đúng khi truyền cùng aad', () => {
      const payload = service.encrypt(NATIONAL_ID, 'customer-1:nationalId');

      expect(service.decrypt(payload, 'customer-1:nationalId')).toBe(
        NATIONAL_ID,
      );
    });

    it('hoán vị bản mã giữa 2 bản ghi bị từ chối (chép CCCD của khách A sang khách B)', () => {
      const ofCustomerA = service.encrypt(NATIONAL_ID, 'customer-A:nationalId');
      const ofCustomerB = service.encrypt(
        '079000000000',
        'customer-B:nationalId',
      );

      // Kẻ có quyền ghi DB chép payload của A vào bản ghi B: giải mã theo ngữ cảnh B phải lỗi.
      expect(() =>
        service.decrypt(ofCustomerA, 'customer-B:nationalId'),
      ).toThrow('Giải mã PII thất bại');
      expect(() =>
        service.decrypt(ofCustomerB, 'customer-A:nationalId'),
      ).toThrow('Giải mã PII thất bại');
    });

    it('mã hóa có aad mà giải mã không truyền aad (hoặc ngược lại) thì lỗi', () => {
      const withAad = service.encrypt(NATIONAL_ID, 'customer-1:nationalId');
      const withoutAad = service.encrypt(NATIONAL_ID);

      expect(() => service.decrypt(withAad)).toThrow('Giải mã PII thất bại');
      expect(() =>
        service.decrypt(withoutAad, 'customer-1:nationalId'),
      ).toThrow('Giải mã PII thất bại');
    });
  });

  describe('xác thực khóa (fail-fast)', () => {
    it.each([
      ['quá ngắn (16 byte)', randomBytes(16).toString('base64')],
      ['quá dài (33 byte)', randomBytes(33).toString('base64')],
      ['không phải base64/hex hợp lệ', 'not-a-key'],
    ])('khóa %s thì ném lỗi ngay khi khởi tạo', (_label, badKey) => {
      expect(() => createService({ CRM_PII_ENCRYPTION_KEY: badKey })).toThrow(
        /CRM_PII_ENCRYPTION_KEY không hợp lệ/,
      );
    });

    it('chấp nhận khóa dạng hex 64 ký tự', () => {
      const hexKey = randomBytes(32).toString('hex');
      const hexService = createService({ CRM_PII_ENCRYPTION_KEY: hexKey });

      expect(hexService.decrypt(hexService.encrypt(NATIONAL_ID))).toBe(
        NATIONAL_ID,
      );
    });

    it.each(['0', 'abc', '1.5'])(
      'CRM_PII_KEY_VERSION=%p không hợp lệ thì ném lỗi',
      (version) => {
        expect(() =>
          createService({
            CRM_PII_ENCRYPTION_KEY: key,
            CRM_PII_KEY_VERSION: version,
          }),
        ).toThrow('CRM_PII_KEY_VERSION');
      },
    );

    it('thiếu khóa khi FEATURE_CRM_ENABLED=true thì ném lỗi (không để CRM chạy không mã hóa)', () => {
      expect(() => createService({ FEATURE_CRM_ENABLED: 'true' })).toThrow(
        'Thiếu CRM_PII_ENCRYPTION_KEY',
      );
    });

    it('thiếu khóa khi CRM tắt thì khởi tạo được (không phá module cũ) nhưng encrypt/decrypt ném lỗi', () => {
      const noKey = createService({});

      expect(() => noKey.encrypt(NATIONAL_ID)).toThrow(
        'Chưa cấu hình khóa mã hóa PII',
      );
      expect(() => noKey.decrypt(service.encrypt(NATIONAL_ID))).toThrow(
        'Chưa cấu hình khóa mã hóa PII',
      );
    });
  });

  describe('xoay khóa (keyVersion)', () => {
    it('sau khi xoay: dữ liệu cũ (v1) vẫn giải mã được nhờ CRM_PII_ENCRYPTION_KEY_V1, dữ liệu mới mã bằng v2', () => {
      const oldPayload = service.encrypt(NATIONAL_ID);
      const rotated = createService({
        CRM_PII_ENCRYPTION_KEY: newKeyBase64(),
        CRM_PII_KEY_VERSION: '2',
        CRM_PII_ENCRYPTION_KEY_V1: key,
      });

      expect(rotated.getCurrentKeyVersion()).toBe(2);
      expect(rotated.decrypt(oldPayload)).toBe(NATIONAL_ID);
      expect(rotated.encrypt(NATIONAL_ID).keyVersion).toBe(2);
    });

    it('bản mã có keyVersion không còn khóa thì lỗi rõ ràng chỉ ra version thiếu', () => {
      const oldPayload = service.encrypt(NATIONAL_ID);
      const rotatedWithoutOldKey = createService({
        CRM_PII_ENCRYPTION_KEY: newKeyBase64(),
        CRM_PII_KEY_VERSION: '2',
      });

      expect(() => rotatedWithoutOldKey.decrypt(oldPayload)).toThrow(
        'keyVersion=1',
      );
    });

    it('khóa cũ sai độ dài cũng bị chặn ngay lúc khởi tạo', () => {
      expect(() =>
        createService({
          CRM_PII_ENCRYPTION_KEY: newKeyBase64(),
          CRM_PII_KEY_VERSION: '2',
          CRM_PII_ENCRYPTION_KEY_V1: 'short',
        }),
      ).toThrow('CRM_PII_ENCRYPTION_KEY_V1');
    });
  });
});
