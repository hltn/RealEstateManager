import { NotificationType } from '../notification.constants';
import { redactPii } from '../../../common/logger/pii-redactor.util';
import {
  getPushCatalogEntry,
  PUSH_ALLOWED_VARS,
  PUSH_CATALOG,
  PUSH_FALLBACK_BODY,
  PUSH_FALLBACK_TITLE,
  PushContext,
  shouldSendPush,
} from './push-catalog';

const placeholders = (template: string): string[] =>
  [...template.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);

const fillTemplate = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{([^{}]*)\}/g, (_m, name: string) => vars[name] ?? '');

describe('push-catalog', () => {
  describe('danh sách đóng 4 loại (FR-43)', () => {
    it('FR-43: đúng 4 loại theo thứ tự của Plan', () => {
      expect(PUSH_CATALOG.map((e) => e.type)).toEqual([
        NotificationType.CUSTOMER_ASSIGNED,
        NotificationType.CARE_LOG_ADDED,
        NotificationType.APPOINTMENT_DUE,
        NotificationType.CUSTOMER_STATUS_AUTO_CHANGED,
      ]);
    });

    it('FR-43: STALE_CUSTOMER, SECURITY_ALERT và loại ngoài danh sách bị từ chối (không có push)', () => {
      for (const type of [
        NotificationType.STALE_CUSTOMER,
        NotificationType.SECURITY_ALERT,
        NotificationType.FOLLOW_UP_DUE,
        NotificationType.CUSTOMER_OCCASION,
        NotificationType.CARE_TEAM_JOIN_REQUESTED,
        NotificationType.CARE_TEAM_JOIN_RESOLVED,
        'UNKNOWN_TYPE',
        '',
        '__proto__',
        'constructor',
      ]) {
        expect(getPushCatalogEntry(type)).toBeUndefined();
        expect(shouldSendPush(type, { careRole: 'MEMBER' })).toBe(false);
      }
    });

    it('FR-43: mã loại duy nhất, đủ trường, mặc định bật và cho phép tắt', () => {
      const types = PUSH_CATALOG.map((e) => e.type);
      expect(new Set(types).size).toBe(types.length);
      for (const entry of PUSH_CATALOG) {
        expect(entry.label).not.toHaveLength(0);
        expect(entry.description).not.toHaveLength(0);
        expect(entry.titleTemplate).not.toHaveLength(0);
        expect(entry.bodyTemplate).not.toHaveLength(0);
        expect(entry.defaultEnabled).toBe(true);
        expect(entry.canDisable).toBe(true);
        expect(entry.ttlSeconds).toBeGreaterThan(0);
        expect(typeof entry.pushWhen).toBe('function');
      }
    });

    it('FR-43: không có mẫu gộp (groupedBodyTemplate) và danh mục bị đóng băng', () => {
      for (const entry of PUSH_CATALOG) {
        expect(entry).not.toHaveProperty('groupedBodyTemplate');
      }
      expect(Object.isFrozen(PUSH_CATALOG)).toBe(true);
    });

    it('FR-43: urgency và TTL đúng Architecture', () => {
      const pick = (t: NotificationType) => getPushCatalogEntry(t);
      expect(pick(NotificationType.APPOINTMENT_DUE)).toMatchObject({
        urgency: 'high',
        ttlSeconds: 3600,
      });
      for (const t of [
        NotificationType.CUSTOMER_ASSIGNED,
        NotificationType.CARE_LOG_ADDED,
        NotificationType.CUSTOMER_STATUS_AUTO_CHANGED,
      ]) {
        expect(pick(t)).toMatchObject({ urgency: 'normal', ttlSeconds: 86400 });
      }
    });

    it('FR-43: mẫu tiêu đề/nội dung đúng Plan 2.1.1', () => {
      expect(
        getPushCatalogEntry(NotificationType.CUSTOMER_ASSIGNED),
      ).toMatchObject({
        titleTemplate: 'Bạn được mời cùng phụ trách một khách',
        bodyTemplate:
          '{actorName} đã thêm bạn vào nhóm chăm sóc khách {customerName}.',
      });
      expect(
        getPushCatalogEntry(NotificationType.CARE_LOG_ADDED),
      ).toMatchObject({
        titleTemplate: 'Có nhật ký chăm sóc mới',
        bodyTemplate: '{actorName} vừa ghi nhật ký cho khách {customerName}.',
      });
      expect(
        getPushCatalogEntry(NotificationType.APPOINTMENT_DUE),
      ).toMatchObject({
        titleTemplate: 'Sắp đến lịch hẹn',
        bodyTemplate:
          '{appointmentTypeLabel} với khách {customerName} lúc {appointmentTimeLabel}.',
      });
      expect(
        getPushCatalogEntry(NotificationType.CUSTOMER_STATUS_AUTO_CHANGED),
      ).toMatchObject({
        titleTemplate: 'Tình trạng khách tự thay đổi',
        bodyTemplate:
          'Khách {customerName} đã chuyển sang "{newStatusLabel}" theo tiến độ.',
      });
    });
  });

  describe('biến cho phép (FR-06)', () => {
    it('FR-06: danh sách biến đóng đúng 5 tên của Plan', () => {
      expect([...PUSH_ALLOWED_VARS]).toEqual([
        'customerName',
        'actorName',
        'appointmentTypeLabel',
        'appointmentTimeLabel',
        'newStatusLabel',
      ]);
    });

    it('FR-06: mọi biến trong mẫu thuộc allowedVars của loại, và allowedVars thuộc danh sách đóng', () => {
      for (const entry of PUSH_CATALOG) {
        for (const name of [
          ...placeholders(entry.titleTemplate),
          ...placeholders(entry.bodyTemplate),
        ]) {
          expect(entry.allowedVars).toContain(name);
        }
        for (const name of entry.allowedVars) {
          expect(PUSH_ALLOWED_VARS).toContain(name);
        }
      }
    });

    it('FR-06: tiêu đề không chứa biến nào, mọi nội dung chỉ có tên khách là dữ liệu khách', () => {
      for (const entry of PUSH_CATALOG) {
        expect(placeholders(entry.titleTemplate)).toEqual([]);
        expect(placeholders(entry.bodyTemplate)).toContain('customerName');
        expect(entry.allowedVars).not.toContain('phone');
        expect(entry.allowedVars).not.toContain('note');
      }
    });
  });

  describe('nội dung không chứa PII (FR-06)', () => {
    const clean: Record<string, string> = {
      customerName: 'Nguyen Van A',
      actorName: 'Tran B',
      appointmentTypeLabel: 'Xem nhà',
      appointmentTimeLabel: '09:30 05/11',
      newStatusLabel: 'Khách net',
    };

    it('FR-06: mẫu đã điền dữ liệu sạch không bị bộ che PII thay đổi', () => {
      for (const entry of PUSH_CATALOG) {
        for (const tpl of [entry.titleTemplate, entry.bodyTemplate]) {
          const out = fillTemplate(tpl, clean);
          expect(redactPii(out)).toBe(out);
        }
      }
    });

    it('FR-06: phần cố định của mẫu không chứa email hay dãy 9 chữ số liền', () => {
      for (const entry of PUSH_CATALOG) {
        for (const tpl of [entry.titleTemplate, entry.bodyTemplate]) {
          const fixedText = tpl.replace(/\{[^{}]*\}/g, '');
          expect(fixedText).not.toMatch(/@/);
          expect(fixedText).not.toMatch(/\d{9}/);
        }
      }
    });

    it('FR-06: dữ liệu bẫy (SĐT, email, 12 số) trong tên khách bị bộ che PII phát hiện ở cả 4 mẫu', () => {
      for (const bad of ['Lan 0912345678', 'a.b@mail.com', '012345678901']) {
        for (const entry of PUSH_CATALOG) {
          const out = fillTemplate(entry.bodyTemplate, {
            ...clean,
            customerName: bad,
          });
          expect(redactPii(out)).not.toBe(out);
        }
      }
    });

    it('FR-06: chuỗi dự phòng là lưới an toàn, không thuộc danh mục và không chứa PII', () => {
      expect(PUSH_FALLBACK_TITLE).toBe('Bạn có thông báo mới');
      expect(PUSH_FALLBACK_BODY).toBe('Bạn có thông báo mới');
      expect(redactPii(PUSH_FALLBACK_BODY)).toBe(PUSH_FALLBACK_BODY);
      for (const entry of PUSH_CATALOG) {
        expect(entry.titleTemplate).not.toBe(PUSH_FALLBACK_TITLE);
        expect(entry.bodyTemplate).not.toBe(PUSH_FALLBACK_BODY);
      }
    });
  });

  describe('deep link (FR-06)', () => {
    it('FR-06: đường dẫn nội bộ bắt đầu bằng "/", không phải "//" hay URL tuyệt đối', () => {
      for (const entry of PUSH_CATALOG) {
        expect(entry.deepLinkTemplate.startsWith('/')).toBe(true);
        expect(entry.deepLinkTemplate.startsWith('//')).toBe(false);
        expect(entry.deepLinkTemplate).not.toMatch(/:\/\//);
        expect(entry.deepLinkTemplate).toBe('/crm/customers/:id');
      }
    });
  });

  describe('pushWhen của CUSTOMER_ASSIGNED (FR-43)', () => {
    const send = (ctx: PushContext) =>
      shouldSendPush(NotificationType.CUSTOMER_ASSIGNED, ctx);

    it.each([
      ['thêm người cùng phụ trách (TEAM_ADD)', 'TEAM_ADD'],
      ['duyệt đề nghị (REQUEST_APPROVED)', 'REQUEST_APPROVED'],
      ['thêm hàng loạt (BULK_ADD)', 'BULK_ADD'],
    ] as const)('FR-43: %s có push', (_name, origin) => {
      expect(send({ careRole: 'MEMBER', origin })).toBe(true);
    });

    it('FR-43: người cùng phụ trách, chưa rõ origin vẫn có push', () => {
      expect(send({ careRole: 'MEMBER' })).toBe(true);
    });

    it('FR-43: tạo khách có phân người (CUSTOMER_CREATED) không push dù là MEMBER', () => {
      expect(send({ careRole: 'MEMBER', origin: 'CUSTOMER_CREATED' })).toBe(
        false,
      );
    });

    it.each(['TEAM_ADD', 'BULK_ADD', 'CUSTOMER_CREATED'] as const)(
      'FR-43: phụ trách chính (PRIMARY, origin %s) không push',
      (origin) => {
        expect(send({ careRole: 'PRIMARY', origin })).toBe(false);
      },
    );

    it('FR-43: thiếu careRole, context rỗng hoặc vai trò lạ thì không push (an toàn mặc định)', () => {
      expect(send({})).toBe(false);
      expect(send({ origin: 'TEAM_ADD' })).toBe(false);
      expect(
        send({ careRole: 'OTHER' as unknown as 'MEMBER', origin: 'TEAM_ADD' }),
      ).toBe(false);
    });

    it('FR-43: 3 loại còn lại luôn có push', () => {
      for (const t of [
        NotificationType.CARE_LOG_ADDED,
        NotificationType.APPOINTMENT_DUE,
        NotificationType.CUSTOMER_STATUS_AUTO_CHANGED,
      ]) {
        expect(shouldSendPush(t)).toBe(true);
        expect(shouldSendPush(t, { careRole: 'PRIMARY' })).toBe(true);
      }
    });
  });
});
