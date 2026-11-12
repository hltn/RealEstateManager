import { MAX_REDACT_LENGTH, redactPii } from './pii-redactor.util';

describe('redactPii (FR-15)', () => {
  it.each([
    ['0901234567', '[PHONE]'],
    ['+84901234567', '[PHONE]'],
    ['84901234567', '[PHONE]'],
    ['0084901234567', '[PHONE]'],
    ['090 123 4567', '[PHONE]'],
    ['090.123.4567', '[PHONE]'],
    ['090-123-4567', '[PHONE]'],
    ['+84 90 123 4567', '[PHONE]'],
    ['SĐT: 0901234567, gọi lại', 'SĐT: [PHONE], gọi lại'],
  ])('FR-15 che SĐT %p', (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it.each([
    ['a.b+c@gmail.com', '[EMAIL]'],
    [
      'lỗi gửi tới nguyen.van@mail.example.com.vn thất bại',
      'lỗi gửi tới [EMAIL] thất bại',
    ],
  ])('FR-15 che email %p', (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it.each([
    ['079123456789', '[NATIONAL_ID]'],
    ['cccd=079123456789;', 'cccd=[NATIONAL_ID];'],
    ['CMND 123456789', 'CMND [NATIONAL_ID]'],
  ])('FR-15 che CCCD/CMND %p', (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it('FR-15 che khối dup key của E11000 thật (không lộ SĐT/email trong khối)', () => {
    const msg =
      'MongoServerError: E11000 duplicate key error collection: crm.customers index: phone_1 dup key: { phone: "0901234567", email: "a@b.com" }';
    const out = redactPii(msg);
    expect(out).toBe(
      'MongoServerError: E11000 duplicate key error collection: crm.customers index: phone_1 dup key: {[REDACTED]}',
    );
    expect(out).not.toContain('0901234567');
  });

  it('FR-15 che E11000 có dấu nháy thoát trong chuỗi JSON', () => {
    const out = redactPii('{"m":"dup key: { phone: \\"0901234567\\" }"}');
    expect(out).not.toContain('0901234567');
    expect(out).toContain('dup key: {[REDACTED]}');
  });

  it('FR-15 che PII trong stack có Caused by', () => {
    const stack =
      'Error: lỗi khách 0901234567\n    at X.y (a.ts:1:1)\nCaused by: Error: mail a@b.com cccd 079123456789';
    const out = redactPii(stack);
    expect(out).toBe(
      'Error: lỗi khách [PHONE]\n    at X.y (a.ts:1:1)\nCaused by: Error: mail [EMAIL] cccd [NATIONAL_ID]',
    );
  });

  it('FR-15 che PII trong object JSON đã stringify', () => {
    const json = JSON.stringify({
      phone: '0901234567',
      email: 'a@b.com',
      id: '079123456789',
    });
    expect(redactPii(json)).toBe(
      '{"phone":"[PHONE]","email":"[EMAIL]","id":"[NATIONAL_ID]"}',
    );
  });

  it('FR-15 KHÔNG che ObjectId 24 hex', () => {
    const ids = [
      '507f1f77bcf86cd799439011',
      '665012345678901234567890',
      '000000000000000000000001',
    ];
    for (const id of ids) {
      expect(redactPii(`customerId=${id}`)).toBe(`customerId=${id}`);
    }
  });

  it('FR-15 KHÔNG che timestamp 13 số, số dài hơn 12 hoặc mã ngắn', () => {
    expect(redactPii('ts=1730000000000')).toBe('ts=1730000000000');
    expect(redactPii('ts=1730000000000 id=12345678')).toBe(
      'ts=1730000000000 id=12345678',
    );
    expect(redactPii('1234567890123456')).toBe('1234567890123456');
  });

  it.each([
    ['1234567890', '[NATIONAL_ID]'],
    ['12345678901', '[NATIONAL_ID]'],
    ['02838123456', '[NATIONAL_ID]'],
    ['1234567890 và 12345678901', '[NATIONAL_ID] và [NATIONAL_ID]'],
    ['id=1234567890;', 'id=[NATIONAL_ID];'],
  ])(
    'FR-15 che mọi dãy 9-12 chữ số liền (Architecture 5.7) %p',
    (input, expected) => {
      expect(redactPii(input)).toBe(expected);
    },
  );

  it('FR-15 che đủ biên 9..12 chữ số, KHÔNG che 8 hoặc 13 chữ số', () => {
    for (let n = 9; n <= 12; n++) {
      expect(redactPii('1'.repeat(n))).toBe('[NATIONAL_ID]');
    }
    expect(redactPii('1'.repeat(8))).toBe('1'.repeat(8));
    expect(redactPii('1'.repeat(13))).toBe('1'.repeat(13));
  });

  it('FR-15 KHÔNG che số tiền có dấu phân cách, ngày giờ hay số ngắn', () => {
    expect(redactPii('giá 1.500.000.000 đ')).toBe('giá 1.500.000.000 đ');
    expect(redactPii('09:30 07/11/2026')).toBe('09:30 07/11/2026');
    expect(redactPii('2026-11-07T09:30:00.000Z')).toBe(
      '2026-11-07T09:30:00.000Z',
    );
  });

  it('FR-15 chuẩn hóa chữ số fullwidth trước khi quét (không qua mặt)', () => {
    const fw = (s: string) =>
      s.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
    expect(redactPii(fw('0901234567'))).toBe('[PHONE]');
    expect(redactPii(fw('079123456789'))).toBe('[NATIONAL_ID]');
    expect(redactPii(fw('1234567890'))).toBe('[NATIONAL_ID]');
    expect(redactPii(fw('12345678901'))).toBe('[NATIONAL_ID]');
    expect(redactPii('CMND ' + fw('123456789') + ' ok')).toBe(
      'CMND [NATIONAL_ID] ok',
    );
    // Trộn fullwidth với ASCII trong cùng một dãy.
    expect(redactPii('０９０1234567')).toBe('[PHONE]');
  });

  it('FR-15 chữ số fullwidth ngắn (không phải PII) chỉ được chuẩn hóa về ASCII', () => {
    expect(redactPii('mã １２３')).toBe('mã 123');
  });

  it('FR-15 chuỗi rỗng và chuỗi không có PII giữ nguyên', () => {
    expect(redactPii('')).toBe('');
    expect(redactPii('[news.service.ts:42] khởi động xong')).toBe(
      '[news.service.ts:42] khởi động xong',
    );
  });

  it('FR-15 ghi nhận: số đứng riêng đúng 9 hoặc 12 chữ số luôn bị che dù là mã khác', () => {
    expect(redactPii('orderCode=123456789')).toBe('orderCode=[NATIONAL_ID]');
    expect(redactPii('ref 998877665544 ok')).toBe('ref [NATIONAL_ID] ok');
  });

  it('FR-15 ghi nhận giới hạn: 84 + 9 số đứng riêng bị coi là SĐT', () => {
    expect(redactPii('order 84123456789 x')).toBe('order [PHONE] x');
  });

  it('FR-15 che SĐT có ngoặc quanh đầu số', () => {
    expect(redactPii('+84 (90) 123 4567')).toBe('[PHONE]');
    expect(redactPii('(090) 123 4567 gọi')).not.toContain('123 4567');
  });

  it('FR-15 chuỗi quá dài bị cắt có đánh dấu, không lộ PII ở phần giữ lại', () => {
    const out = redactPii(`0901234567 ${'x'.repeat(MAX_REDACT_LENGTH)}`);
    expect(out.startsWith('[PHONE]')).toBe(true);
    expect(out).toMatch(/\[TRUNCATED \d+\]$/);
  });

  describe('FR-15 hiệu năng (chống ReDoS)', () => {
    const units = [
      'a',
      '0',
      'a-',
      '0 ',
      '@',
      '.',
      '+84',
      'dup key: {',
      'a@',
      '0.',
    ];
    it.each(units)(
      'FR-15 chuỗi 200k ký tự lặp %p xử lý dưới 250 ms',
      (unit) => {
        const input = unit
          .repeat(Math.ceil(200_000 / unit.length))
          .slice(0, 200_000);
        const start = performance.now();
        redactPii(input);
        const elapsed = performance.now() - start;
        console.info(
          `FR-15 perf ${JSON.stringify(unit)}: ${elapsed.toFixed(1)} ms`,
        );
        expect(elapsed).toBeLessThan(250);
      },
    );
  });
});
