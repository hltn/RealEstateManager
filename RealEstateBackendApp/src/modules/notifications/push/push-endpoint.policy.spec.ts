import {
  buildPushAuthAad,
  checkPushEndpoint,
  checkPushKeys,
  computePushEndpointHash,
  DEFAULT_PUSH_ENDPOINT_HOST_ALLOWLIST,
  parseHostAllowlist,
  resolveHostAllowlist,
  shortEndpointHash,
} from './push-endpoint.policy';

/** p256dh hợp lệ: 65 byte bắt đầu 0x04 -> base64url 87 ký tự; auth: 16 byte -> 22 ký tự. */
const validP256dh = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.alloc(64, 7),
]).toString('base64url');
const validAuth = Buffer.alloc(16, 9).toString('base64url');

const allowlist = resolveHostAllowlist(undefined);
const check = (endpoint: string, list: readonly string[] = allowlist) =>
  checkPushEndpoint(endpoint, list);

describe('push-endpoint.policy: checkPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://FCM.GoogleAPIs.com/fcm/send/x',
    'https://fcm.googleapis.com./fcm/send/x',
  ])('FR-01: chấp nhận endpoint của FCM/Mozilla/Apple/WNS: %s', (endpoint) => {
    expect(check(endpoint).valid).toBe(true);
  });

  it.each([
    ['http không phải https', 'http://fcm.googleapis.com/fcm/send/x'],
    ['giao thức khác', 'ftp://fcm.googleapis.com/x'],
    ['host nội bộ', 'https://localhost/x'],
    ['IP nội bộ', 'https://127.0.0.1/x'],
    ['metadata đám mây', 'https://169.254.169.254/latest/meta-data'],
    ['host lạ', 'https://evil.example.com/x'],
    ['hậu tố giả', 'https://fcm.googleapis.com.evil.com/x'],
    ['tiền tố giả', 'https://evilfcm.googleapis.com/x'],
    ['tên miền gốc không khớp *.', 'https://push.apple.com/x'],
    ['hậu tố giả của apple', 'https://evilpush.apple.com/x'],
    ['lách bằng @', 'https://fcm.googleapis.com@evil.com/x'],
    ['có username', 'https://user:pw@fcm.googleapis.com/x'],
    ['cổng khác 443', 'https://fcm.googleapis.com:8443/x'],
    ['không phải URL', 'không-phải-url'],
    ['rỗng', ''],
  ])('FR-01: từ chối %s', (_name, endpoint) => {
    expect(check(endpoint).valid).toBe(false);
  });

  it('FR-01: độ dài đúng 1024 còn hợp lệ, 1025 bị từ chối', () => {
    const prefix = 'https://fcm.googleapis.com/';
    const ok = prefix + 'a'.repeat(1024 - prefix.length);
    expect(ok).toHaveLength(1024);
    expect(check(ok).valid).toBe(true);
    expect(check(ok + 'a').valid).toBe(false);
  });

  it('FR-01: thông điệp từ chối không chứa nguyên URL (không lộ capability vào lỗi/log)', () => {
    const endpoint = 'https://evil.example.com/secret-token-123';
    const result = check(endpoint);
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret-token-123');
  });

  it('FR-01: PUSH_ENDPOINT_HOST_ALLOWLIST bổ sung host mới nhưng không bỏ danh sách mặc định', () => {
    const extended = resolveHostAllowlist(
      ' push.newvendor.example , *.edge.newvendor.example ,, ',
    );
    expect(check('https://push.newvendor.example/x', extended).valid).toBe(
      true,
    );
    expect(check('https://a.edge.newvendor.example/x', extended).valid).toBe(
      true,
    );
    expect(check('https://edge.newvendor.example/x', extended).valid).toBe(
      false,
    );
    expect(check('https://fcm.googleapis.com/x', extended).valid).toBe(true);
    expect(extended).toEqual(
      expect.arrayContaining([...DEFAULT_PUSH_ENDPOINT_HOST_ALLOWLIST]),
    );
  });

  it('FR-01: parseHostAllowlist chuẩn hóa chữ thường, bỏ rỗng và trùng', () => {
    expect(parseHostAllowlist(' A.com,a.com,, B.COM ')).toEqual([
      'a.com',
      'b.com',
    ]);
    expect(parseHostAllowlist(undefined)).toEqual([]);
    expect(parseHostAllowlist('')).toEqual([]);
  });
});

describe('push-endpoint.policy: checkPushKeys', () => {
  it('FR-01: khóa đúng độ dài hợp lệ', () => {
    expect(validP256dh).toHaveLength(87);
    expect(validAuth).toHaveLength(22);
    expect(checkPushKeys(validP256dh, validAuth)).toEqual({ valid: true });
  });

  it('FR-01: p256dh sai độ dài, sai ký tự hoặc không bắt đầu 0x04 bị từ chối', () => {
    expect(checkPushKeys(validP256dh.slice(0, 86), validAuth).valid).toBe(
      false,
    );
    expect(checkPushKeys(validP256dh + 'A', validAuth).valid).toBe(false);
    expect(checkPushKeys('+'.repeat(87), validAuth).valid).toBe(false);
    const notUncompressed = Buffer.concat([
      Buffer.from([0x02]),
      Buffer.alloc(64, 7),
    ]).toString('base64url');
    expect(checkPushKeys(notUncompressed, validAuth).valid).toBe(false);
  });

  it('FR-01: auth sai độ dài hoặc sai ký tự bị từ chối', () => {
    expect(checkPushKeys(validP256dh, validAuth.slice(0, 21)).valid).toBe(
      false,
    );
    expect(checkPushKeys(validP256dh, validAuth + 'AA').valid).toBe(false);
    expect(checkPushKeys(validP256dh, '='.repeat(22)).valid).toBe(false);
  });
});

describe('push-endpoint.policy: hash và AAD', () => {
  it('FR-01: hash là SHA-256 hex 64 ký tự, ổn định và không chứa endpoint', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    const hash = computePushEndpointHash(endpoint);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computePushEndpointHash(endpoint)).toBe(hash);
    expect(computePushEndpointHash(endpoint + '1')).not.toBe(hash);
    expect(shortEndpointHash(hash)).toBe(hash.slice(0, 12));
  });

  it('FR-01: AAD theo định dạng userId:endpointHash:push', () => {
    expect(buildPushAuthAad('u1', 'h1')).toBe('u1:h1:push');
  });
});
