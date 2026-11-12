/**
 * FR-21 (T-49) — route chỉ ADMIN NGOÀI CRM phải đọc role từ DB (`@AdminOnly()` = `@Roles(ADMIN)` + `ActiveAdminGuard`),
 * không tin bản chụp role trong JWT (sống tới 15 phút). Route `@Roles(ADMIN, EDITOR)` giữ nguyên, không thêm guard.
 *
 * Quét metadata THẬT của controller (Reflect) + nguồn `.ts` (không còn `@Roles(UserRole.ADMIN)` đơn lẻ) + module có
 * import `CrmCommonModule` (nếu thiếu, Nest không dựng được `ActiveAdminGuard` khi khởi động).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  GUARDS_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ExternalLogController } from '../../modules/external-log/controllers/external-log.controller';
import { ExternalLogModule } from '../../modules/external-log/external-log.module';
import { KnowledgeArticlesController } from '../../modules/knowledge-articles/knowledge-articles.controller';
import { KnowledgeArticlesModule } from '../../modules/knowledge-articles/knowledge-articles.module';
import { NewsFireCrawlManagerController } from '../../modules/news-fire-crawl-manager/news-fire-crawl-manager.controller';
import { NewsFireCrawlManagerModule } from '../../modules/news-fire-crawl-manager/news-fire-crawl-manager.module';
import { SettingsController } from '../../modules/settings/settings.controller';
import { SettingsModule } from '../../modules/settings/settings.module';
import { ActiveAdminGuard } from '../../modules/crm/common/access/active-admin.guard';
import { CrmCommonModule } from '../../modules/crm/common/crm-common.module';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';

// jsdom là ESM, Jest không parse được; không dùng tới trong test này (chỉ cần metadata).
jest.mock('jsdom', () => ({}));

type ControllerClass = { prototype: Record<string, object> };

/** Tên các handler HTTP (có metadata route) của một controller. */
const handlersOf = (controller: ControllerClass): string[] =>
  Object.getOwnPropertyNames(controller.prototype).filter(
    (name) =>
      name !== 'constructor' &&
      typeof controller.prototype[name] === 'function' &&
      Reflect.getMetadata(PATH_METADATA, controller.prototype[name]) !==
        undefined,
  );

/** Guard gắn trên handler hoặc class. */
const guardsOf = (controller: ControllerClass, handler: string): unknown[] => [
  ...(Reflect.getMetadata(GUARDS_METADATA, controller.prototype[handler]) ??
    []),
  ...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []),
];

const rolesOf = (controller: ControllerClass, handler: string): unknown =>
  Reflect.getMetadata(ROLES_KEY, controller.prototype[handler]) ??
  Reflect.getMetadata(ROLES_KEY, controller);

const importsOf = (module: unknown): unknown[] =>
  Reflect.getMetadata(MODULE_METADATA.IMPORTS, module as object) ?? [];

describe('FR-21 — route ADMIN-only ngoài CRM đọc role từ DB (@AdminOnly)', () => {
  describe.each([
    ['KnowledgeArticlesController', KnowledgeArticlesController],
    ['ExternalLogController', ExternalLogController],
    ['SettingsController', SettingsController],
  ])('%s: mọi handler là ADMIN-only', (_label, controller) => {
    const handlers = handlersOf(controller as unknown as ControllerClass);

    it('FR-21: có handler để kiểm (tránh test rỗng)', () => {
      expect(handlers.length).toBeGreaterThan(0);
    });

    it('FR-21: mọi handler có @Roles(ADMIN) + ActiveAdminGuard', () => {
      for (const handler of handlers) {
        const target = controller as unknown as ControllerClass;
        expect({ handler, roles: rolesOf(target, handler) }).toEqual({
          handler,
          roles: [UserRole.ADMIN],
        });
        expect({
          handler,
          hasGuard: guardsOf(target, handler).includes(ActiveAdminGuard),
        }).toEqual({ handler, hasGuard: true });
      }
    });
  });

  describe('NewsFireCrawlManagerController', () => {
    const target = NewsFireCrawlManagerController as unknown as ControllerClass;

    it.each(['getCronConfig', 'updateCronConfig'])(
      'FR-21: %s (cron) là ADMIN-only theo DB',
      (handler) => {
        expect(rolesOf(target, handler)).toEqual([UserRole.ADMIN]);
        expect(guardsOf(target, handler)).toContain(ActiveAdminGuard);
      },
    );

    it.each(['getPrompts', 'updatePrompts'])(
      'FR-21: %s (ADMIN, EDITOR) không đổi và KHÔNG thêm ActiveAdminGuard (EDITOR vẫn vào được)',
      (handler) => {
        expect(rolesOf(target, handler)).toEqual([
          UserRole.ADMIN,
          UserRole.EDITOR,
        ]);
        expect(guardsOf(target, handler)).not.toContain(ActiveAdminGuard);
      },
    );

    it('FR-21: các route còn lại (mặc định ADMIN/EDITOR) không bị thêm @Roles hay guard', () => {
      const special = [
        'getCronConfig',
        'updateCronConfig',
        'getPrompts',
        'updatePrompts',
      ];
      const others = handlersOf(target).filter(
        (handler) => !special.includes(handler),
      );
      expect(others.length).toBeGreaterThan(10);
      for (const handler of others) {
        expect({ handler, roles: rolesOf(target, handler) }).toEqual({
          handler,
          roles: undefined,
        });
        expect({
          handler,
          guards: guardsOf(target, handler).length,
        }).toEqual({ handler, guards: 0 });
      }
    });
  });

  it.each([
    ['KnowledgeArticlesModule', KnowledgeArticlesModule],
    ['ExternalLogModule', ExternalLogModule],
    ['SettingsModule', SettingsModule],
    ['NewsFireCrawlManagerModule', NewsFireCrawlManagerModule],
  ])(
    'FR-21: %s import CrmCommonModule (cung cấp CrmActorService cho ActiveAdminGuard)',
    (_label, module) => {
      expect(importsOf(module)).toContain(CrmCommonModule);
    },
  );

  it('FR-21: nguồn 4 controller không còn @Roles(UserRole.ADMIN) đơn lẻ (phải dùng @AdminOnly)', () => {
    const modulesRoot = path.resolve(__dirname, '..', '..', 'modules');
    const files = [
      'knowledge-articles/knowledge-articles.controller.ts',
      'external-log/controllers/external-log.controller.ts',
      'news-fire-crawl-manager/news-fire-crawl-manager.controller.ts',
      'settings/settings.controller.ts',
    ];
    for (const file of files) {
      const source = fs
        .readFileSync(path.join(modulesRoot, file), 'utf8')
        // Bỏ chú thích để JSDoc nhắc tên decorator không gây dương tính giả.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect({
        file,
        hit: /@Roles\(\s*UserRole\.ADMIN\s*\)/.test(source),
      }).toEqual({
        file,
        hit: false,
      });
    }
  });
});
