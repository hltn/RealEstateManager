import { describe, expect, it } from 'vitest';
import { DEFAULT_PUSH_URL, FALLBACK_PUSH_TITLE, normalizeInternalUrl, parsePushPayload } from './pushPayload';

describe('parsePushPayload (FR-09)', () => {
  it('FR-09: payload đúng hợp đồng 4.1 được giữ nguyên title, body, url, tag, type', () => {
    const raw = JSON.stringify({ title: 'Lịch hẹn mới', body: 'Nguyễn Văn A lúc 09:00', url: '/crm/appointments/66b1', tag: 'noti-123', type: 'APPOINTMENT_ASSIGNED' });

    expect(parsePushPayload(raw)).toEqual({
      title: 'Lịch hẹn mới',
      body: 'Nguyễn Văn A lúc 09:00',
      url: '/crm/appointments/66b1',
      tag: 'noti-123',
      type: 'APPOINTMENT_ASSIGNED',
    });
  });

  it.each([
    ['null (push không kèm dữ liệu)', null],
    ['undefined', undefined],
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng', '   '],
    ['không phải JSON', 'xin chào, đây không phải json'],
    ['JSON cụt', '{"title": "Lịch hẹn'],
    ['JSON null', 'null'],
    ['JSON mảng', '[{"title":"x"}]'],
    ['JSON chuỗi', '"chuỗi trần"'],
    ['JSON số', '42'],
  ])('FR-09: sai định dạng (%s) thì dùng nội dung chung "Bạn có thông báo mới" và url "/"', (_label, raw) => {
    expect(parsePushPayload(raw)).toEqual({ title: FALLBACK_PUSH_TITLE, body: '', url: DEFAULT_PUSH_URL, tag: undefined, type: undefined });
    expect(FALLBACK_PUSH_TITLE).toBe('Bạn có thông báo mới');
  });

  it.each([
    ['thiếu title', { body: 'Nội dung', url: '/crm/today' }],
    ['title rỗng', { title: '  ', body: 'Nội dung', url: '/crm/today' }],
    ['title không phải chuỗi', { title: 123, body: 'Nội dung', url: '/crm/today' }],
  ])('FR-09: %s thì dùng tiêu đề chung nhưng giữ body và url hợp lệ', (_label, payload) => {
    expect(parsePushPayload(JSON.stringify(payload))).toMatchObject({ title: FALLBACK_PUSH_TITLE, body: 'Nội dung', url: '/crm/today' });
  });

  it('FR-09: body/tag/type sai kiểu bị bỏ (body thành chuỗi rỗng, tag và type thành undefined), không ném lỗi', () => {
    const parsed = parsePushPayload(JSON.stringify({ title: 'T', body: { a: 1 }, tag: 5, type: ['x'] }));

    expect(parsed).toEqual({ title: 'T', body: '', url: '/', tag: undefined, type: undefined });
  });

  it('FR-09: url nguy hiểm trong payload bị thay bằng "/" ngay khi parse', () => {
    expect(parsePushPayload(JSON.stringify({ title: 'T', url: 'https://evil.example/phish' })).url).toBe('/');
    expect(parsePushPayload(JSON.stringify({ title: 'T', url: '//evil.example' })).url).toBe('/');
  });

  it('FR-09: tag quá dài bị bỏ để không làm hỏng showNotification', () => {
    expect(parsePushPayload(JSON.stringify({ title: 'T', tag: 'x'.repeat(300) })).tag).toBeUndefined();
  });
});

describe('normalizeInternalUrl (FR-09)', () => {
  it.each([
    ['/'],
    ['/crm/today'],
    ['/crm/customers/66b1c2?tab=care#log'],
    ['/notifications'],
    ['/apiary'],
  ])('FR-09: giữ nguyên đường dẫn nội bộ hợp lệ %s', (url) => {
    expect(normalizeInternalUrl(url)).toBe(url);
  });

  it('FR-09: cắt khoảng trắng hai đầu rồi mới kiểm', () => {
    expect(normalizeInternalUrl('  /crm/today  ')).toBe('/crm/today');
  });

  it.each([
    ['URL tuyệt đối https', 'https://evil.example/x'],
    ['URL tuyệt đối http', 'http://evil.example'],
    ['protocol-relative', '//evil.example/x'],
    ['backslash đầu', '/\\evil.example'],
    ['backslash giữa', '/crm\\..\\x'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['đường dẫn tương đối', 'crm/today'],
    ['rỗng', ''],
    ['chỉ khoảng trắng', '   '],
    ['chứa khoảng trắng giữa', '/crm/to day'],
    ['chứa xuống dòng', '/crm/today\n/x'],
    ['chứa tab', '/\t/evil.example'],
    ['ký tự điều khiển', '/crm/\u0000today'],
    ['/api', '/api'],
    ['/api/v1/auth/me', '/api/v1/auth/me'],
    ['/api?x=1', '/api?x=1'],
    ['quá dài', `/${'a'.repeat(2100)}`],
  ])('FR-09: %s bị thay bằng "/"', (_label, url) => {
    expect(normalizeInternalUrl(url)).toBe(DEFAULT_PUSH_URL);
  });

  it.each([[undefined], [null], [123], [{ url: '/x' }], [['/x']], [true]])('FR-09: giá trị không phải chuỗi (%j) bị thay bằng "/"', (value) => {
    expect(normalizeInternalUrl(value)).toBe(DEFAULT_PUSH_URL);
  });
});
