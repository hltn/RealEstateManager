import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * TEST KIẾN TRÚC (T-36, FR-44): chốt chặn để mọi thông báo đều đi qua `NotificationDispatcher`.
 * Rà mã nguồn thật (không chạy ứng dụng): file ngoài `modules/notifications` KHÔNG được
 * - gọi `createMany` (đường ghi thông báo cũ đã xóa ở T-34/T-35, không được quay lại),
 * - dùng token `notifyAdmins` dưới bất kỳ hình thức nào (destructuring, `.call`, `['notifyAdmins']`,
 *   `(x as any).notifyAdmins`, gán lại...) ngoài lời gọi trực tiếp `<receiver>.notifyAdmins(` trên receiver được khai
 *   báo kiểu `NotificationDispatcher` (hoặc phương thức riêng cùng tên của chính lớp, như `CrmAbuseMonitorService`),
 * - `@InjectModel(Notification.name)` / `getModelToken(Notification.name)` (trừ 2 file xóa/ẩn danh hóa hợp lệ),
 * - ghi trực tiếp vào collection `notifications` (`create`/`insertOne`/`insertMany`/`bulkWrite`/`new Model`),
 *   bất kể đặt tên biến gì (tên suy ra từ kiểu `Model<Notification | NotificationDocument>`).
 * Việc xóa/ẩn danh hóa (`deleteMany`, `updateMany` của `customer-purge`, `customer-scheduling-anonymizer`) là bảo vệ
 * dữ liệu, không tạo thông báo nên không bị cấm.
 * Bộ quét là hàm thuần (`findViolations`) nên có test "đỏ" bằng mã giả lập mà không phải sửa file thật.
 */

interface SourceFile {
  /** Đường dẫn tương đối tính từ `src`, dùng `/`. */
  path: string;
  content: string;
}

const NOTIFICATIONS_DIR = 'modules/notifications/';
const DISPATCHER_FILE =
  'modules/notifications/notification-dispatcher.service.ts';

/**
 * File ngoài module được phép `@InjectModel(Notification.name)`/`getModelToken(Notification.name)`:
 * chỉ để xóa/ẩn danh hóa dữ liệu thông báo (bảo vệ dữ liệu), không tạo thông báo.
 */
const NOTIFICATION_MODEL_ALLOW_LIST = [
  'modules/crm/customers/customer-purge.service.ts',
  'modules/crm/customers/customer-scheduling-anonymizer.service.ts',
];

const WRITE_METHODS = '(create|insertMany|insertOne|bulkWrite|save)';

/** Biên "từ" kiểu lookaround (không dùng `\b` vì `$` cũng là ký tự định danh). */
const WORD_START = '(?<![\\w$])';
const WORD_END = '(?![\\w$])';

/** Bỏ chú thích khối và chú thích dòng (chú thích có nhắc `createMany` là hợp lệ). */
const stripComments = (content: string): string =>
  content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const isOutsideNotifications = (path: string): boolean =>
  !path.startsWith(NOTIFICATIONS_DIR);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Quy tắc 2: mọi lần xuất hiện token `notifyAdmins` ngoài module notifications phải thuộc 1 trong 3 dạng hợp lệ:
 *   a. `<receiver>.notifyAdmins(` với receiver (có thể có `this.`) khai báo kiểu `NotificationDispatcher`;
 *   b. `this.notifyAdmins(` gọi phương thức riêng của chính lớp;
 *   c. khai báo phương thức `private|protected|public [async] notifyAdmins(`.
 * Mọi dạng khác (destructuring, `.call`, `['notifyAdmins']`, `(x as any).notifyAdmins`, gán lại) là vi phạm.
 */
const countIllegalNotifyAdminsUses = (code: string): number => {
  let illegal = 0;
  const token = new RegExp(`${WORD_START}notifyAdmins${WORD_END}`, 'g');
  for (const match of code.matchAll(token)) {
    const before = code.slice(0, match.index);
    const after = code.slice(match.index + match[0].length);
    const isCall = /^\s*\(/.test(after);
    const isOwnDefinition =
      isCall &&
      new RegExp(
        `${WORD_START}(private|protected|public)\\s+(async\\s+)?$`,
      ).test(before);
    const isOwnCall =
      isCall && new RegExp(`${WORD_START}this\\s*\\??\\.\\s*$`).test(before);
    const receiver = /(\w+)\s*\??\.\s*$/.exec(before)?.[1];
    const isDispatcherCall =
      isCall &&
      receiver !== undefined &&
      receiver !== 'this' &&
      new RegExp(
        `${WORD_START}${escapeRegExp(receiver)}\\s*:\\s*NotificationDispatcher${WORD_END}`,
      ).test(code);
    if (!isOwnDefinition && !isOwnCall && !isDispatcherCall) illegal += 1;
  }
  return illegal;
};

/** Quy tắc 3b: có ghi (tạo) trực tiếp vào model/collection thông báo hay không. */
const hasDirectNotificationWrite = (code: string): boolean => {
  if (
    /collection\(\s*['"`]notifications['"`]\s*\)\s*\.\s*(insertOne|insertMany|bulkWrite)/.test(
      code,
    )
  ) {
    return true;
  }
  // Tên biến suy ra từ kiểu `Model<Notification|NotificationDocument>`, cộng thêm tên quen thuộc `notificationModel`.
  const modelNames = new Set<string>(['notificationModel']);
  for (const m of code.matchAll(
    /(\w+)\s*:\s*Model<\s*Notification(Document)?\s*>/g,
  )) {
    modelNames.add(m[1]);
  }
  for (const name of modelNames) {
    const n = escapeRegExp(name);
    if (
      new RegExp(
        `${WORD_START}${n}\\s*\\??\\.\\s*${WRITE_METHODS}${WORD_END}`,
      ).test(code) ||
      new RegExp(`new\\s+(this\\.)?${n}${WORD_END}`).test(code)
    ) {
      return true;
    }
  }
  return false;
};

/** Rà một danh sách file nguồn không phải spec, trả về danh sách vi phạm dạng `đường-dẫn: lý do`. */
const findViolations = (files: SourceFile[]): string[] => {
  const violations: string[] = [];
  for (const file of files) {
    const code = stripComments(file.content);
    const outside = isOutsideNotifications(file.path);

    // Quy tắc 1: `createMany` không còn tồn tại ở bất kỳ đâu (định nghĩa lẫn nơi gọi).
    if (new RegExp(`${WORD_START}createMany${WORD_END}`).test(code)) {
      violations.push(`${file.path}: còn dùng createMany`);
    }

    if (outside) {
      // Quy tắc 2: xem `countIllegalNotifyAdminsUses`.
      if (countIllegalNotifyAdminsUses(code) > 0) {
        violations.push(
          `${file.path}: dùng notifyAdmins không qua lời gọi trực tiếp trên NotificationDispatcher`,
        );
      }

      // Quy tắc 3a: không inject/lấy token model Notification ngoài danh sách cho phép (không phụ thuộc tên biến).
      if (
        !NOTIFICATION_MODEL_ALLOW_LIST.includes(file.path) &&
        new RegExp(
          `${WORD_START}(InjectModel|getModelToken)\\s*\\(\\s*(Notification\\.name|['"\`]Notification['"\`])`,
        ).test(code)
      ) {
        violations.push(
          `${file.path}: inject/lấy token model Notification ngoài danh sách cho phép`,
        );
      }

      // Quy tắc 3b: không ghi (tạo) thông báo trực tiếp, kể cả ở file thuộc danh sách cho phép.
      if (hasDirectNotificationWrite(code)) {
        violations.push(
          `${file.path}: ghi thẳng vào collection notifications, phải qua NotificationDispatcher`,
        );
      }
    }

    // Quy tắc 4: bên trong module, `notifyAdmins` chỉ được xuất hiện ở Dispatcher.
    if (
      !outside &&
      file.path !== DISPATCHER_FILE &&
      new RegExp(`${WORD_START}notifyAdmins${WORD_END}`).test(code)
    ) {
      violations.push(
        `${file.path}: notifyAdmins chỉ được nằm ở notification-dispatcher.service.ts`,
      );
    }
  }
  return violations;
};

/** Đọc đệ quy mọi file `.ts` không phải spec dưới `src`. */
const collectSourceFiles = (srcRoot: string): SourceFile[] => {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        files.push({
          path: relative(srcRoot, full).split(sep).join('/'),
          content: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(srcRoot);
  return files;
};

describe('Kiến trúc thông báo: mọi thông báo đi qua NotificationDispatcher (T-36)', () => {
  const srcRoot = join(__dirname, '..', '..');

  it('mã nguồn thật không có đường ghi thông báo ngoài Dispatcher', () => {
    const files = collectSourceFiles(srcRoot);
    // Bảo đảm bộ quét thực sự thấy file (tránh xanh giả khi sai đường dẫn).
    const paths = files.map((f) => f.path);
    expect(paths).toContain(DISPATCHER_FILE);
    expect(paths).toContain(
      'modules/crm/common/security/crm-abuse-monitor.service.ts',
    );
    for (const allowed of NOTIFICATION_MODEL_ALLOW_LIST) {
      expect(paths).toContain(allowed);
    }
    expect(findViolations(files)).toEqual([]);
  });

  describe('bộ quét bắt được vi phạm (test đỏ giả lập)', () => {
    const crmFile = (content: string): SourceFile => ({
      path: 'modules/crm/foo/foo.service.ts',
      content,
    });
    const dispatcherClass = (body: string): string =>
      `class A { constructor(private readonly notifications: NotificationDispatcher) {} run() { ${body} } }`;

    it('gọi createMany trực tiếp', () => {
      const violations = findViolations([
        crmFile(
          'class A { constructor(private readonly n: NotificationsService) {} run() { return this.n.createMany([]); } }',
        ),
      ]);
      expect(violations).toEqual([
        'modules/crm/foo/foo.service.ts: còn dùng createMany',
      ]);
    });

    it('createMany nằm cả trong module notifications cũng bị bắt (đường cũ không được quay lại)', () => {
      expect(
        findViolations([
          {
            path: 'modules/notifications/notifications.service.ts',
            content: 'async createMany() {}',
          },
        ]),
      ).toHaveLength(1);
    });

    it('notifyAdmins trên đối tượng không phải NotificationDispatcher', () => {
      const violations = findViolations([
        crmFile(
          'class A { constructor(private readonly notifications: NotificationsService) {} run() { return this.notifications.notifyAdmins({}); } }',
        ),
      ]);
      expect(violations).toEqual([
        'modules/crm/foo/foo.service.ts: dùng notifyAdmins không qua lời gọi trực tiếp trên NotificationDispatcher',
      ]);
    });

    it('notifyAdmins qua NotificationDispatcher thì hợp lệ (gọi trực tiếp, có hoặc không có optional chaining)', () => {
      for (const body of [
        'return this.notifications.notifyAdmins({});',
        'return this.notifications?.notifyAdmins({});',
        'return this.notifications\n  .notifyAdmins({});',
      ]) {
        expect(findViolations([crmFile(dispatcherClass(body))])).toEqual([]);
      }
    });

    it.each([
      [
        'destructuring',
        'const { notifyAdmins } = this.notifications; return notifyAdmins({});',
      ],
      [
        '.call',
        'return this.notifications.notifyAdmins.call(this.notifications, {});',
      ],
      ['.apply', 'return this.notifications.notifyAdmins.apply(null, []);'],
      ["['notifyAdmins']", "return this.notifications['notifyAdmins']({});"],
      [
        '(n as any).notifyAdmins',
        'return (this.notifications as any).notifyAdmins({});',
      ],
      [
        'gán lại hàm',
        'const send = this.notifications.notifyAdmins; return send({});',
      ],
      [
        'qua biến cục bộ không khai báo kiểu Dispatcher',
        'const n = other(); return n.notifyAdmins({});',
      ],
    ])(
      'dùng notifyAdmins dạng %s dù file có khai báo NotificationDispatcher',
      (_name, body) => {
        expect(
          findViolations([crmFile(dispatcherClass(body))]).length,
        ).toBeGreaterThan(0);
      },
    );

    it('phương thức riêng tên notifyAdmins của lớp ngoài module (khai báo và this.notifyAdmins) không bị coi là vi phạm', () => {
      expect(
        findViolations([
          crmFile(
            'class A { run() { return this.notifyAdmins(); } private async notifyAdmins() {} }',
          ),
        ]),
      ).toEqual([]);
    });

    it('ghi thẳng collection notifications bằng model hoặc driver', () => {
      for (const code of [
        'await this.notificationModel.create({});',
        'await this.notificationModel.insertMany([]);',
        'await this.notificationModel.bulkWrite([]);',
        'const doc = new this.notificationModel({});',
        "await connection.collection('notifications').insertOne({});",
      ]) {
        expect(findViolations([crmFile(code)])).toHaveLength(1);
      }
    });

    it('ghi thẳng collection notifications dù đặt tên biến khác notificationModel (suy từ kiểu Model<...>)', () => {
      for (const code of [
        'class A { constructor(private readonly notifs: Model<NotificationDocument>) {} run() { return this.notifs.create({}); } }',
        'class A { constructor(private readonly store: Model<Notification>) {} run() { return this.store.insertMany([]); } }',
        'class A { constructor(readonly m: Model<NotificationDocument>) {} run() { return new this.m({}); } }',
      ]) {
        expect(findViolations([crmFile(code)])).toHaveLength(1);
      }
    });

    it('@InjectModel(Notification.name) ngoài module notifications bị cấm, không phụ thuộc tên biến', () => {
      const violations = findViolations([
        crmFile(
          'class A { constructor(@InjectModel(Notification.name) private readonly anything: Model<NotificationDocument>) {} }',
        ),
      ]);
      expect(violations).toEqual([
        'modules/crm/foo/foo.service.ts: inject/lấy token model Notification ngoài danh sách cho phép',
      ]);
    });

    it('getModelToken(Notification.name) ngoài module notifications bị cấm', () => {
      for (const code of [
        'const model = moduleRef.get(getModelToken(Notification.name));',
        "const model = moduleRef.get(getModelToken('Notification'));",
        "class A { constructor(@InjectModel('Notification') m: unknown) {} }",
      ]) {
        expect(findViolations([crmFile(code)])).toEqual([
          'modules/crm/foo/foo.service.ts: inject/lấy token model Notification ngoài danh sách cho phép',
        ]);
      }
    });

    it('2 file xóa/ẩn danh hóa trong allow-list được @InjectModel(Notification.name) nhưng vẫn không được ghi', () => {
      for (const path of NOTIFICATION_MODEL_ALLOW_LIST) {
        const inject =
          'class A { constructor(@InjectModel(Notification.name) private readonly notifs: Model<NotificationDocument>) {} async run() { await this.notifs.updateMany({}, {}); await this.notifs.deleteMany({}); } }';
        expect(findViolations([{ path, content: inject }])).toEqual([]);
        expect(
          findViolations([
            {
              path,
              content: `${inject} class B { constructor(private readonly notifs: Model<NotificationDocument>) {} run() { return this.notifs.create({}); } }`,
            },
          ]),
        ).toHaveLength(1);
      }
    });

    it('module notifications được inject model Notification và ghi thông báo', () => {
      expect(
        findViolations([
          {
            path: 'modules/notifications/notifications.service.ts',
            content:
              'class A { constructor(@InjectModel(Notification.name) private readonly m: Model<NotificationDocument>) {} run() { return this.m.create({}); } }',
          },
        ]),
      ).toEqual([]);
    });

    it('xóa/ẩn danh hóa notifications (deleteMany/updateMany) không bị cấm', () => {
      expect(
        findViolations([
          crmFile(
            'await this.notificationModel.updateMany({}, {}); await deleteMany(this.notificationModel, {});',
          ),
        ]),
      ).toEqual([]);
    });

    it('nhắc tên trong chú thích không bị tính', () => {
      expect(
        findViolations([
          crmFile(
            '// trước đây gọi createMany và notificationModel.create\n/* this.n.notifyAdmins(x) */\nconst a = 1;',
          ),
        ]),
      ).toEqual([]);
    });

    it('notifyAdmins định nghĩa ngoài Dispatcher trong module notifications', () => {
      expect(
        findViolations([
          {
            path: 'modules/notifications/notifications.service.ts',
            content: 'async notifyAdmins() {}',
          },
        ]),
      ).toHaveLength(1);
      expect(
        findViolations([
          { path: DISPATCHER_FILE, content: 'async notifyAdmins() {}' },
        ]),
      ).toEqual([]);
    });
  });
});
