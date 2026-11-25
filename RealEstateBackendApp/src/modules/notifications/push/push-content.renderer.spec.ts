import { NotificationType } from '../notification.constants';
import {
  PUSH_FALLBACK_BODY,
  PUSH_FALLBACK_TITLE,
  PushCatalogEntry,
  PUSH_CATALOG,
} from './push-catalog';
import {
  isInternalPath,
  PUSH_BODY_MAX_LENGTH,
  PUSH_TITLE_MAX_LENGTH,
  PushRenderError,
  renderPushContent,
} from './push-content.renderer';

const CUSTOMER_ID = '64b7f0c2a1b2c3d4e5f60718';

const goodVars: Record<NotificationType | string, Record<string, string>> = {
  [NotificationType.CUSTOMER_ASSIGNED]: {
    actorName: 'Tran B',
    customerName: 'Nguyen Van A',
  },
  [NotificationType.CARE_LOG_ADDED]: {
    actorName: 'Tran B',
    customerName: 'Nguyen Van A',
  },
  [NotificationType.APPOINTMENT_DUE]: {
    appointmentTypeLabel: 'Xem nhà',
    customerName: 'Nguyen Van A',
    appointmentTimeLabel: '09:30 05/11',
  },
  [NotificationType.CUSTOMER_STATUS_AUTO_CHANGED]: {
    customerName: 'Nguyen Van A',
    newStatusLabel: 'Khách net',
  },
};

const logger = () => ({ error: jest.fn() });

describe('push-content.renderer', () => {
  it('FR-06: điền đúng mẫu của cả 4 loại, không dùng dự phòng, url nội bộ theo id khách', () => {
    for (const entry of PUSH_CATALOG) {
      const log = logger();
      const out = renderPushContent(
        {
          type: entry.type,
          vars: goodVars[entry.type],
          customerId: CUSTOMER_ID,
        },
        { logger: log },
      );
      expect(out.usedFallback).toBe(false);
      expect(out.type).toBe(entry.type);
      expect(out.title).toBe(entry.titleTemplate);
      expect(out.body).not.toMatch(/[{}]/);
      expect(out.url).toBe(`/crm/customers/${CUSTOMER_ID}`);
      expect(log.error).not.toHaveBeenCalled();
    }
  });

  it('FR-06: nội dung cụ thể của APPOINTMENT_DUE và CUSTOMER_STATUS_AUTO_CHANGED', () => {
    expect(
      renderPushContent({
        type: NotificationType.APPOINTMENT_DUE,
        vars: goodVars[NotificationType.APPOINTMENT_DUE],
      }).body,
    ).toBe('Xem nhà với khách Nguyen Van A lúc 09:30 05/11.');
    expect(
      renderPushContent({
        type: NotificationType.CUSTOMER_STATUS_AUTO_CHANGED,
        vars: goodVars[NotificationType.CUSTOMER_STATUS_AUTO_CHANGED],
      }).body,
    ).toBe('Khách Nguyen Van A đã chuyển sang "Khách net" theo tiến độ.');
  });

  describe('dữ liệu bẫy rơi về nội dung chung (FR-06)', () => {
    const traps = [
      'Lan 0912345678',
      'Lan +84 912 345 678',
      'lan.nguyen@mail.com',
      '012345678901',
      '123456789',
    ];

    it.each(traps)(
      'FR-06: tên khách "%s" ở cả 4 mẫu rơi về chuỗi dự phòng và ghi log ERROR không kèm nội dung',
      (bad) => {
        for (const entry of PUSH_CATALOG) {
          const log = logger();
          const out = renderPushContent(
            {
              type: entry.type,
              vars: { ...goodVars[entry.type], customerName: bad },
              customerId: CUSTOMER_ID,
            },
            { logger: log },
          );
          expect(out.usedFallback).toBe(true);
          expect(out.title).toBe(PUSH_FALLBACK_TITLE);
          expect(out.body).toBe(PUSH_FALLBACK_BODY);
          expect(out.url).toBe(`/crm/customers/${CUSTOMER_ID}`);
          expect(log.error).toHaveBeenCalledTimes(1);
          const msg = String(log.error.mock.calls[0][0]);
          expect(msg).not.toContain(bad);
          expect(msg).not.toMatch(/\d{9}/);
        }
      },
    );

    it('FR-06: PII nằm ở biến khác (tên người thực hiện) cũng bị chặn', () => {
      const out = renderPushContent(
        {
          type: NotificationType.CARE_LOG_ADDED,
          vars: { actorName: 'a@b.com', customerName: 'A' },
        },
        { logger: logger() },
      );
      expect(out.usedFallback).toBe(true);
    });

    it('FR-06: SĐT nằm sau phần bị cắt (tên rất dài) vẫn bị phát hiện trước khi cắt', () => {
      const out = renderPushContent(
        {
          type: NotificationType.CARE_LOG_ADDED,
          vars: {
            actorName: 'Tran B',
            customerName: `${'A'.repeat(40)} 0912345678`,
          },
        },
        { logger: logger() },
      );
      expect(out.usedFallback).toBe(true);
    });

    it('FR-06: thiếu biến bắt buộc thì rơi về dự phòng', () => {
      const log = logger();
      const out = renderPushContent(
        {
          type: NotificationType.CARE_LOG_ADDED,
          vars: { actorName: 'Tran B' },
        },
        { logger: log },
      );
      expect(out.usedFallback).toBe(true);
      expect(log.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('loại ngoài danh sách và biến lạ', () => {
    it.each([
      NotificationType.STALE_CUSTOMER,
      NotificationType.SECURITY_ALERT,
      'UNKNOWN',
    ])('FR-43: loại "%s" ngoài danh mục rơi về chuỗi dự phòng', (type) => {
      const out = renderPushContent({
        type,
        vars: { customerName: 'A' },
        customerId: CUSTOMER_ID,
      });
      expect(out).toMatchObject({
        title: PUSH_FALLBACK_TITLE,
        body: PUSH_FALLBACK_BODY,
        usedFallback: true,
        type,
        url: '/',
      });
    });

    it('FR-06: biến ngoài danh sách đóng bị từ chối, không lọt vào nội dung', () => {
      for (const bad of ['phone', 'note', 'title', '__proto__']) {
        expect(() =>
          renderPushContent({
            type: NotificationType.CARE_LOG_ADDED,
            vars: { ...goodVars[NotificationType.CARE_LOG_ADDED], [bad]: 'x' },
          }),
        ).toThrow(PushRenderError);
      }
    });

    it('FR-06: biến thuộc danh sách chung nhưng không thuộc loại này cũng bị từ chối', () => {
      expect(() =>
        renderPushContent({
          type: NotificationType.CARE_LOG_ADDED,
          vars: {
            ...goodVars[NotificationType.CARE_LOG_ADDED],
            newStatusLabel: 'x',
          },
        }),
      ).toThrow(PushRenderError);
    });

    it('FR-06: thông báo lỗi không chứa giá trị biến', () => {
      const act = () =>
        renderPushContent({
          type: NotificationType.CARE_LOG_ADDED,
          vars: { phone: '0912345678' },
        });
      expect(act).toThrow(PushRenderError);
      expect(act).toThrow(/phone/);
      expect(act).not.toThrow(/0912345678/);
    });

    it('FR-06: cắt biến làm lộ đúng 12 chữ số đứng riêng (CCCD) thì rơi về dự phòng (quét sau khi cắt)', () => {
      // 16 chữ số không khớp CCCD khi quét đầy đủ; cắt còn 29 ký tự + "…" thành 12 số đứng riêng.
      const log = logger();
      const out = renderPushContent(
        {
          type: NotificationType.CARE_LOG_ADDED,
          vars: {
            actorName: 'Tran B',
            customerName: 'Abcdefghijklmnop 1234567890123456',
          },
        },
        { logger: log },
      );
      expect(out.usedFallback).toBe(true);
      expect(out.body).toBe(PUSH_FALLBACK_BODY);
      expect(log.error).toHaveBeenCalledTimes(1);
    });

    it('FR-06: giá trị biến không thể chèn mẫu hay ngoặc nhọn (injection)', () => {
      const out = renderPushContent({
        type: NotificationType.CARE_LOG_ADDED,
        vars: { actorName: '{customerName}', customerName: 'A{b}\n\tC' },
      });
      expect(out.body).not.toMatch(/[{}\n\t]/);
      expect(out.body).toBe('customerName vừa ghi nhật ký cho khách A b C.');
    });

    it('FR-43: thêm một loại thử vào danh mục thì renderer dùng được không sửa mã', () => {
      const extra: PushCatalogEntry = {
        ...PUSH_CATALOG[1],
        type: NotificationType.STALE_CUSTOMER,
        titleTemplate: 'Thử',
        bodyTemplate: 'Khách {customerName}.',
        allowedVars: ['customerName'],
      };
      const out = renderPushContent(
        {
          type: NotificationType.STALE_CUSTOMER,
          vars: { customerName: 'A' },
          customerId: CUSTOMER_ID,
        },
        { catalog: [...PUSH_CATALOG, extra] },
      );
      expect(out).toMatchObject({
        title: 'Thử',
        body: 'Khách A.',
        usedFallback: false,
      });
    });
  });

  describe('cắt độ dài (FR-06)', () => {
    it('FR-06: tên rất dài bị cắt thêm "…", nội dung ≤ 120 và tiêu đề ≤ 50', () => {
      const out = renderPushContent({
        type: NotificationType.APPOINTMENT_DUE,
        vars: {
          appointmentTypeLabel: 'Ký cọc / HĐMB'.repeat(10),
          customerName: 'Nguyễn Thị Rất Dài '.repeat(20),
          appointmentTimeLabel: '09:30 05/11',
        },
      });
      expect(out.usedFallback).toBe(false);
      expect(Array.from(out.body).length).toBeLessThanOrEqual(
        PUSH_BODY_MAX_LENGTH,
      );
      expect(Array.from(out.title).length).toBeLessThanOrEqual(
        PUSH_TITLE_MAX_LENGTH,
      );
      expect(out.body).toContain('…');
    });

    it('FR-06: tiêu đề mẫu dài nhất của danh mục không vượt 50, nội dung đủ biến dài nhất không vượt 120', () => {
      for (const entry of PUSH_CATALOG) {
        expect(Array.from(entry.titleTemplate).length).toBeLessThanOrEqual(
          PUSH_TITLE_MAX_LENGTH,
        );
        const vars = Object.fromEntries(
          entry.allowedVars.map((v) => [v, 'Ắ'.repeat(100)]),
        );
        const out = renderPushContent({ type: entry.type, vars });
        expect(Array.from(out.body).length).toBeLessThanOrEqual(
          PUSH_BODY_MAX_LENGTH,
        );
      }
    });

    it('FR-06: tên ngắn không bị cắt, không thêm "…"', () => {
      const out = renderPushContent({
        type: NotificationType.CARE_LOG_ADDED,
        vars: goodVars[NotificationType.CARE_LOG_ADDED],
      });
      expect(out.body).not.toContain('…');
    });
  });

  describe('url nội bộ (FR-06)', () => {
    const vars = goodVars[NotificationType.CARE_LOG_ADDED];
    const render = (extra: { customerId?: string; deepLink?: string }) =>
      renderPushContent({
        type: NotificationType.CARE_LOG_ADDED,
        vars,
        ...extra,
      }).url;

    it('FR-06: dùng data.deepLink khi là đường dẫn nội bộ hợp lệ', () => {
      expect(render({ deepLink: `/crm/customers/${CUSTOMER_ID}` })).toBe(
        `/crm/customers/${CUSTOMER_ID}`,
      );
    });

    it.each([
      '//evil.com',
      'https://evil.com/x',
      'javascript:alert(1)',
      '/\\evil.com',
      '/a b',
      '/a\nb',
      '/x://y',
      '',
    ])('FR-06: deepLink không hợp lệ "%s" bị bỏ, rơi về "/"', (deepLink) => {
      expect(render({ deepLink })).toBe('/');
    });

    it('FR-06: customerId không phải ObjectId thì rơi về "/"', () => {
      expect(render({ customerId: '../../etc' })).toBe('/');
      expect(render({ customerId: 'abc' })).toBe('/');
      expect(render({})).toBe('/');
    });

    it.each([
      '/crm/customers?email=a@b.com',
      '/crm/customers?phone=0912345678',
      '/crm/customers?cccd=012345678901',
    ])(
      'FR-06: deepLink chứa PII trong query "%s" bị bỏ, rơi về mẫu + id',
      (deepLink) => {
        expect(render({ deepLink, customerId: CUSTOMER_ID })).toBe(
          `/crm/customers/${CUSTOMER_ID}`,
        );
        expect(render({ deepLink })).toBe('/');
      },
    );

    it('FR-06: isInternalPath chặn url quá dài', () => {
      expect(isInternalPath(`/${'a'.repeat(300)}`)).toBe(false);
      expect(isInternalPath('/crm')).toBe(true);
      expect(isInternalPath(undefined)).toBe(false);
    });
  });
});
