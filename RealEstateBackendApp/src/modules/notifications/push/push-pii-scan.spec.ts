/**
 * T-38 (1/3) — Quét PII CẢ 4 MẪU push bằng bộ dữ liệu "bẫy" (FR-06, FR-12; Architecture 5.7).
 *
 * Khác `push-content.renderer.spec.ts` (kiểm từng hành vi riêng lẻ): ở đây là MA TRẬN đầy đủ
 * 4 loại × mọi biến cho phép của loại × mọi kiểu bẫy (SĐT nhiều định dạng, CCCD/CMND, email, bẫy
 * nằm sau chỗ bị cắt, bẫy bị chèn ký tự điều khiển), và kiểm bất biến trên KẾT QUẢ CUỐI (không chứa
 * dấu vết bẫy trong title/body/url, `redactPii` không đổi gì, đúng chuỗi dự phòng).
 *
 * Bẫy được kiểm bằng chuỗi gốc (không dùng chính `redactPii` làm "đáp án") để test không lặp lại
 * implementation: kết quả phải KHÔNG chứa chuỗi bẫy và KHÔNG chứa dãy chữ số của bẫy.
 */
import { redactPii } from '../../../common/logger/pii-redactor.util';
import { NotificationType } from '../notification.constants';
import {
  PUSH_ALLOWED_VARS,
  PUSH_CATALOG,
  PUSH_FALLBACK_BODY,
  PUSH_FALLBACK_TITLE,
  PushVarName,
} from './push-catalog';
import {
  PUSH_BODY_MAX_LENGTH,
  PUSH_TITLE_MAX_LENGTH,
  renderPushContent,
  PushRenderError,
} from './push-content.renderer';

const CUSTOMER_ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const EXPECTED_URL = `/crm/customers/${CUSTOMER_ID}`;

/** Giá trị sạch cho từng biến (để biết biến nào đang bị "bẫy" thay thế). */
const CLEAN: Record<PushVarName, string> = {
  customerName: 'Nguyễn Văn Minh',
  actorName: 'Trần Thị Lan',
  appointmentTypeLabel: 'Xem nhà',
  appointmentTimeLabel: '09:30 07/11',
  newStatusLabel: 'Đã đặt cọc',
};

interface Trap {
  name: string;
  /** Giá trị đưa vào biến. */
  value: string;
  /** Các mảnh PHẢI biến mất khỏi kết quả (chuỗi gốc hoặc dãy chữ số). */
  mustNotAppear: string[];
}

const phoneTrap = (name: string, value: string, digits: string): Trap => ({
  name,
  value,
  mustNotAppear: [value, digits],
});

const TRAPS: Trap[] = [
  phoneTrap('SĐT 10 số liền', 'Lan 0912345678', '0912345678'),
  phoneTrap('SĐT +84 có cách', 'An +84 912 345 678', '912 345 678'),
  phoneTrap('SĐT 84xxxxxxxxx', 'Bình 84912345678', '84912345678'),
  phoneTrap('SĐT 0084', 'Cường 0084912345678', '0084912345678'),
  phoneTrap('SĐT dấu chấm', 'Dung 091.234.5678', '091.234.5678'),
  phoneTrap('SĐT dấu gạch', 'Em 091-234-5678', '091-234-5678'),
  phoneTrap('SĐT chèn xuống dòng', 'Giang 0912\n345678', '0912'),
  phoneTrap('SĐT chỉ có SĐT', '0912345678', '0912345678'),
  {
    name: 'CCCD 12 số',
    value: 'Hà 012345678901',
    mustNotAppear: ['012345678901'],
  },
  {
    name: 'CMND 9 số',
    value: 'Khánh 123456789',
    mustNotAppear: ['123456789'],
  },
  {
    name: 'email',
    value: 'Linh linh.nguyen+crm@gmail.com',
    mustNotAppear: ['linh.nguyen+crm@gmail.com', '@gmail.com'],
  },
  {
    name: 'email là cả tên',
    value: 'khach@example.vn',
    mustNotAppear: ['khach@example.vn', '@example.vn'],
  },
  {
    // Bẫy nằm SAU vị trí cắt 30 ký tự của biến: phải quét giá trị đầy đủ trước khi cắt.
    name: 'SĐT nằm sau chỗ bị cắt',
    value: `${'Nguyễn Thị Hoàng Thanh Thảo '.repeat(2)}0912345678`,
    mustNotAppear: ['0912345678'],
  },
  {
    name: 'email nằm sau chỗ bị cắt',
    value: `${'Phạm Lê Hoàng Anh Tuấn Kiệt '.repeat(2)}a@b.vn`,
    mustNotAppear: ['a@b.vn'],
  },
];

describe('T-38 quét PII 4 mẫu push (FR-06)', () => {
  const logger = { error: jest.fn() };

  beforeEach(() => logger.error.mockClear());

  const render = (
    type: string,
    overrides: Partial<Record<PushVarName, string>> = {},
    extra: { deepLink?: string } = {},
  ) => {
    const entry = PUSH_CATALOG.find((e) => (e.type as string) === type);
    const vars: Record<string, string> = {};
    for (const name of entry?.allowedVars ?? []) {
      vars[name] = overrides[name] ?? CLEAN[name];
    }
    return renderPushContent(
      { type, vars, customerId: CUSTOMER_ID, ...extra },
      { logger },
    );
  };

  const serialize = (r: ReturnType<typeof render>) =>
    JSON.stringify({ title: r.title, body: r.body, url: r.url });

  describe('đường chuẩn: dữ liệu sạch dùng ĐÚNG mẫu (đối chứng, tránh test xanh vì mọi thứ rơi về dự phòng)', () => {
    it.each(PUSH_CATALOG.map((e) => [e.type] as const))(
      '%s: không dùng dự phòng, không có log lỗi, url theo id khách',
      (type) => {
        const result = render(type);
        expect(result.usedFallback).toBe(false);
        expect(result.title).not.toBe(PUSH_FALLBACK_TITLE);
        expect(result.url).toBe(EXPECTED_URL);
        expect(logger.error).not.toHaveBeenCalled();
      },
    );

    it('giờ hẹn dạng HH:mm dd/MM và tên có chữ số thường (Lan 2) KHÔNG bị coi là PII', () => {
      const result = render(
        NotificationType.APPOINTMENT_DUE,
        { appointmentTimeLabel: '09:30 07/11', customerName: 'Lan 2' },
        {},
      );
      expect(result.usedFallback).toBe(false);
      expect(result.body).toBe('Xem nhà với khách Lan 2 lúc 09:30 07/11.');
    });
  });

  describe('ma trận: loại × biến × bẫy', () => {
    const cases = PUSH_CATALOG.flatMap((entry) =>
      entry.allowedVars.flatMap((varName) =>
        TRAPS.map((trap) => ({ type: entry.type, varName, trap })),
      ),
    );

    it('ma trận đủ 4 loại và có nhiều hơn 100 tổ hợp (không bị thu hẹp ngầm)', () => {
      expect(new Set(cases.map((c) => c.type)).size).toBe(4);
      expect(cases.length).toBeGreaterThan(100);
    });

    it.each(cases.map((c) => [c.type, c.varName, c.trap.name, c] as const))(
      '%s / biến %s / bẫy %s: rơi về nội dung chung, không lộ bẫy',
      (...args) => {
        const { type, varName, trap } = args[3];
        const result = render(type, { [varName]: trap.value });

        expect(result.usedFallback).toBe(true);
        expect(result.title).toBe(PUSH_FALLBACK_TITLE);
        expect(result.body).toBe(PUSH_FALLBACK_BODY);
        expect(result.url).toBe(EXPECTED_URL);
        expect(result.type).toBe(type);

        const output = serialize(result);
        for (const piece of trap.mustNotAppear) {
          expect(output).not.toContain(piece);
        }
        // Log lỗi có nhưng KHÔNG kèm nội dung bẫy.
        expect(logger.error).toHaveBeenCalledTimes(1);
        const logged = String(logger.error.mock.calls[0][0]);
        for (const piece of trap.mustNotAppear) {
          expect(logged).not.toContain(piece);
        }
      },
    );
  });

  describe('bẫy ở nhiều biến cùng lúc và bẫy cố tình lách', () => {
    it.each(PUSH_CATALOG.map((e) => [e.type] as const))(
      '%s: tất cả biến đều là bẫy thì vẫn chỉ ra nội dung chung',
      (type) => {
        const result = render(type, {
          customerName: '0912345678',
          actorName: 'lan@gmail.com',
          appointmentTypeLabel: '012345678901',
          appointmentTimeLabel: '+84 912 345 678',
          newStatusLabel: '123456789',
        });
        expect(result.usedFallback).toBe(true);
        expect(serialize(result)).not.toMatch(/\d{9}|@/);
      },
    );

    it('giá trị có ký tự điều khiển/ngoặc nhọn không tạo ra SĐT/email ngoài tầm quét', () => {
      const result = render(NotificationType.CARE_LOG_ADDED, {
        customerName: '09{1}2\t3\r\n4{5}6\u00007 8',
      });
      // Sau khi làm sạch thành "09 1 2 3 4 5 6 7 8" (chữ số cách nhau bởi khoảng trắng) hoặc giữ nguyên:
      // dù thế nào thì KHÔNG được lộ đủ 9 chữ số của dãy ban đầu.
      expect(result.body.replace(/\D/g, '').length).toBeLessThan(9);
    });
  });

  describe('url không mang PII (deep link do nơi gọi truyền vào)', () => {
    it.each([
      ['email trong query', '/crm/customers/abc?email=lan@gmail.com'],
      ['SĐT trong query', '/crm/customers/abc?phone=0912345678'],
      ['CCCD trong đường dẫn', '/crm/customers/012345678901'],
      ['SĐT trong fragment', '/crm/customers/abc#0912345678'],
    ])('%s: bỏ deepLink, rơi về mẫu + id khách', (_name, deepLink) => {
      const result = render(NotificationType.CARE_LOG_ADDED, {}, { deepLink });
      expect(result.url).toBe(EXPECTED_URL);
      expect(serialize(result)).not.toMatch(/0912345678|012345678901|@/);
    });

    it('url ngoài (scheme, //, \\) không bao giờ được dùng làm url push', () => {
      for (const deepLink of [
        'https://evil.example/x',
        '//evil.example/x',
        '/\\evil.example',
        'javascript:alert(1)',
      ]) {
        const result = render(
          NotificationType.CARE_LOG_ADDED,
          {},
          { deepLink },
        );
        expect(result.url).toBe(EXPECTED_URL);
      }
    });
  });

  describe('lớp thứ nhất: danh sách biến đóng, không có nguồn PII nghiệp vụ', () => {
    it('danh sách biến cho phép là đúng 5 biến của Plan, không biến nào mang SĐT/CCCD/email/nội dung', () => {
      expect([...PUSH_ALLOWED_VARS].sort()).toEqual(
        [
          'actorName',
          'appointmentTimeLabel',
          'appointmentTypeLabel',
          'customerName',
          'newStatusLabel',
        ].sort(),
      );
      for (const name of PUSH_ALLOWED_VARS) {
        expect(name).not.toMatch(
          /phone|cccd|email|note|log|message|content|body|title|address|location|result/i,
        );
      }
    });

    it('chỉ customerName mang dữ liệu khách; mẫu của 4 loại chỉ dùng biến đã khai báo trong allowedVars', () => {
      for (const entry of PUSH_CATALOG) {
        for (const template of [entry.titleTemplate, entry.bodyTemplate]) {
          const used = [...template.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
          for (const name of used) {
            expect(entry.allowedVars as readonly string[]).toContain(name);
          }
        }
      }
    });

    it('mẫu cố định (chưa điền biến) tự nó không chứa SĐT/CCCD/email', () => {
      for (const entry of PUSH_CATALOG) {
        for (const template of [entry.titleTemplate, entry.bodyTemplate]) {
          const bare = template.replace(/\{[^{}]*\}/g, 'X');
          expect(redactPii(bare)).toBe(bare);
        }
      }
    });

    it.each([
      'customerPhone',
      'phone',
      'email',
      'cccd',
      'careLogContent',
      'note',
      'message',
      'resultNote',
      'title',
      'location',
    ])(
      'biến lạ "%s" bị từ chối (ném PushRenderError), không lọt vào nội dung',
      (name) => {
        expect(() =>
          renderPushContent(
            {
              type: NotificationType.CARE_LOG_ADDED,
              vars: { ...CLEAN, [name]: 'Khách SĐT 0912345678' },
              customerId: CUSTOMER_ID,
            },
            { logger },
          ),
        ).toThrow(PushRenderError);
      },
    );

    it('lỗi biến lạ không kèm giá trị biến (không rò PII qua thông báo lỗi)', () => {
      try {
        renderPushContent(
          {
            type: NotificationType.CARE_LOG_ADDED,
            vars: { note: 'SĐT 0912345678 lan@gmail.com' },
          },
          { logger },
        );
        throw new Error('phải ném PushRenderError');
      } catch (error) {
        expect((error as Error).message).not.toMatch(/0912345678|@gmail/);
      }
    });
  });

  describe('giới hạn độ dài vẫn giữ khi bẫy không kích hoạt', () => {
    it.each(PUSH_CATALOG.map((e) => [e.type] as const))(
      '%s: tên rất dài (không PII) bị cắt, title ≤ 50 và body ≤ 120 ký tự',
      (type) => {
        const long = 'Nguyễn Thị Hoàng Thanh Thảo Phạm Lê '.repeat(6).trim();
        const result = render(type, {
          customerName: long,
          actorName: long,
          newStatusLabel: long,
          appointmentTypeLabel: long,
        });
        expect(Array.from(result.title).length).toBeLessThanOrEqual(
          PUSH_TITLE_MAX_LENGTH,
        );
        expect(Array.from(result.body).length).toBeLessThanOrEqual(
          PUSH_BODY_MAX_LENGTH,
        );
      },
    );
  });

  /**
   * Kiến trúc 5.7: dãy 9–12 chữ số liền (CCCD/CMND/SĐT bàn) phải bị chặn cả ở log lẫn push.
   * (Trước đây 10–11 chữ số không bắt đầu bằng 0/84 lọt qua; đã vá trong `redactPii`.)
   */
  describe('dãy 10–11 chữ số liền và fullwidth (Architecture 5.7: 9–12)', () => {
    it.each([
      ['10 số không bắt đầu bằng 0/84', 'Minh 1234567890', '1234567890'],
      ['11 số', 'Minh 12345678901', '12345678901'],
      ['SĐT bàn 11 số', 'Minh 02838123456', '02838123456'],
    ])('%s bị chặn', (_name, value, digits) => {
      const result = render(NotificationType.CARE_LOG_ADDED, {
        customerName: value,
      });
      expect(result.usedFallback).toBe(true);
      expect(serialize(result)).not.toContain(digits);
    });

    it.each([
      ['SĐT 10 số fullwidth', '0912345678'],
      ['10 số fullwidth không bắt đầu 0/84', '1234567890'],
      ['CCCD 12 số fullwidth', '012345678901'],
    ])('%s: không qua mặt được bằng chữ số fullwidth', (_name, digits) => {
      const fullwidth = digits.replace(/\d/g, (d) =>
        String.fromCharCode(0xff10 + Number(d)),
      );
      const result = render(NotificationType.CARE_LOG_ADDED, {
        customerName: `Minh ${fullwidth}`,
      });
      expect(result.usedFallback).toBe(true);
      const output = serialize(result);
      expect(output).not.toContain(digits);
      expect(output).not.toContain(fullwidth);
    });
  });
});
