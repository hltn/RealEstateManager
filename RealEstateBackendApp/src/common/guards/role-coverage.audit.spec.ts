/**
 * AUDIT (QA + coder, CRM M1) — "default-deny" cho vai trò mới MANAGER/STAFF.
 *
 * Trước đây `RolesGuard` cho qua mọi route KHÔNG có `@Roles(...)` miễn là đã đăng nhập. Từ M1, `POST /users` tạo được
 * MANAGER/STAFF nên các route cũ (tin tức, nguồn tin, Google Drive...) sẽ lộ cho nhân viên CRM. Cách chữa: RolesGuard
 * thành DEFAULT-DENY — route không khai báo quyền chỉ cho ADMIN/EDITOR; route cho mọi user phải ghi `@AnyRole()`.
 *
 * Test quét NGUỒN của mọi `*.controller.ts` (không import để tránh kéo jsdom/ESM) và chứng minh:
 *  1. `@AnyRole()` chỉ xuất hiện ở danh sách cho phép (không ai lén mở route cho MANAGER/STAFF);
 *  2. RolesGuard được đăng ký toàn cục (APP_GUARD) — nếu mất, default-deny không có hiệu lực;
 *  3. mọi controller CRM đều khai báo quyền tường minh trên từng handler;
 *  4. RolesGuard THẬT + Reflector THẬT từ chối MANAGER/STAFF trên handler không khai báo, và cho ADMIN/EDITOR.
 * Heuristic dựa vào format Prettier của repo (thụt 2 dấu cách).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AnyRole } from '../decorators/any-role.decorator';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';
import { RolesGuard } from './roles.guard';

/** Route dành cho mọi người dùng đã đăng nhập, có chủ đích (không phải lỗ hổng). */
const ANY_ROLE_ALLOWLIST = [
  'AppController.getHello',
  'AuthController.logout',
  'AuthController.me',
];

const SRC_ROOT = path.resolve(__dirname, '..', '..');
const HTTP_DECORATOR = /@(Get|Post|Put|Patch|Delete)\(/;
const METHOD_SIGNATURE = /^ {2}(?:async\s+)?([A-Za-z_]\w*)\s*[(<]/;

interface HandlerInfo {
  label: string;
  hasRoles: boolean;
  hasPublic: boolean;
  hasAnyRole: boolean;
  /** `@ActiveCrmUser()` (FR-21): `@Roles(...CRM_ROLES)` + kiểm lại status/role theo DB. */
  hasActiveCrmUser: boolean;
}

const findControllerFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findControllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });

const collectHandlers = (): HandlerInfo[] => {
  const handlers: HandlerInfo[] = [];
  for (const file of findControllerFiles(SRC_ROOT)) {
    // Bỏ chú thích (JSDoc có thể nhắc "@Public()") nhưng giữ nguyên số dòng.
    const lines = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
      .replace(/\/\/.*$/gm, '')
      .split(/\r?\n/);
    const classLine = lines.findIndex((line) => /^export class \w+/.test(line));
    if (classLine < 0) continue;
    const className = /^export class (\w+)/.exec(lines[classLine])![1];
    const classHeader = lines.slice(0, classLine + 1).join('\n');
    const classLevel = {
      hasRoles: /@(Roles|AdminOnly|ActiveCrmUser)\(/.test(classHeader),
      hasPublic: /@Public\(/.test(classHeader),
      hasAnyRole: /@AnyRole\(/.test(classHeader),
      hasActiveCrmUser: /@ActiveCrmUser\(/.test(classHeader),
    };

    let current = { ...classLevel };
    let hasHttp = false;
    for (let index = classLine + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (HTTP_DECORATOR.test(line)) hasHttp = true;
      if (/@(Roles|AdminOnly|ActiveCrmUser)\(/.test(line)) {
        current.hasRoles = true;
      }
      if (/@ActiveCrmUser\(/.test(line)) current.hasActiveCrmUser = true;
      if (/@Public\(/.test(line)) current.hasPublic = true;
      if (/@AnyRole\(/.test(line)) current.hasAnyRole = true;
      const signature = METHOD_SIGNATURE.exec(line);
      if (signature && !line.trimStart().startsWith('@')) {
        if (hasHttp) {
          handlers.push({ label: `${className}.${signature[1]}`, ...current });
        }
        hasHttp = false;
        current = { ...classLevel };
      }
    }
  }
  return handlers;
};

describe('RolesGuard default-deny — vai trò MANAGER/STAFF không lọt vào route cũ', () => {
  const handlers = collectHandlers();

  it('quét được controller (tránh test rỗng làm hàng rào giả)', () => {
    expect(handlers.length).toBeGreaterThan(60);
  });

  it('@AnyRole() chỉ dùng ở danh sách cho phép (không ai lén mở route cho MANAGER/STAFF)', () => {
    const anyRole = handlers
      .filter((handler) => handler.hasAnyRole)
      .map((handler) => handler.label)
      .sort();
    expect(anyRole).toEqual(ANY_ROLE_ALLOWLIST);
  });

  it('RolesGuard được đăng ký toàn cục qua APP_GUARD (nếu mất, default-deny vô hiệu)', () => {
    const authModule = fs.readFileSync(
      path.join(SRC_ROOT, 'modules', 'auth', 'auth.module.ts'),
      'utf8',
    );
    expect(authModule).toMatch(
      /provide:\s*APP_GUARD,\s*useClass:\s*RolesGuard/,
    );
  });

  it('các controller CRM/nhóm/người dùng đều khai báo @Roles (hoặc @Public/@AnyRole) tường minh trên mọi handler', () => {
    const offenders = handlers
      .filter((handler) =>
        /^(Teams|Areas|LeadSources|ContactResults|CustomerStatuses|Projects|CrmSettings|Users|Customers|CustomerAssignees|CustomerSensitiveData|CustomerLifecycle|CustomerHistories)Controller\./.test(
          handler.label,
        ),
      )
      .filter(
        (handler) =>
          !handler.hasRoles && !handler.hasPublic && !handler.hasAnyRole,
      )
      .map((handler) => handler.label);
    expect(offenders).toEqual([]);
  });

  it('FR-21 (Q8): 8 GET danh mục CRM (tình trạng, nguồn, kết quả liên hệ, khu vực, dự án x2, thẻ, trường chân dung) dùng @ActiveCrmUser()', () => {
    const expected = [
      'AreasController.list',
      'ContactResultsController.list',
      'CustomerStatusesController.list',
      'LeadSourcesController.list',
      'PersonaFieldsController.list',
      'ProjectsController.getById',
      'ProjectsController.list',
      'TagsController.list',
    ];
    const actual = handlers
      .filter((handler) => handler.hasActiveCrmUser)
      .map((handler) => handler.label)
      .sort();
    expect(actual).toEqual(expected);
  });

  it('FR-21 (Q8): GET danh mục CRM không còn @Roles(...CRM_ROLES) trần (tin JWT) trong nguồn controller', () => {
    const files = [
      'catalogs/areas.controller.ts',
      'catalogs/contact-results.controller.ts',
      'catalogs/customer-statuses.controller.ts',
      'catalogs/lead-sources.controller.ts',
      'projects/projects.controller.ts',
      'persona/persona-fields.controller.ts',
      'tags/tags.controller.ts',
    ];
    for (const file of files) {
      const lines = fs
        .readFileSync(path.join(SRC_ROOT, 'modules', 'crm', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
        .replace(/\/\/.*$/gm, '')
        .split(/\r?\n/);
      // Với mỗi @Get(...) thì decorator quyền ngay sau đó phải là @ActiveCrmUser(), không phải @Roles(...).
      lines.forEach((line, index) => {
        if (!/^\s*@Get\(/.test(line)) return;
        const block = lines.slice(index, index + 4).join(' ');
        expect({ file, line: index + 1, hit: /@Roles\(/.test(block) }).toEqual({
          file,
          line: index + 1,
          hit: false,
        });
        expect({
          file,
          line: index + 1,
          active: /@ActiveCrmUser\(/.test(block),
        }).toEqual({ file, line: index + 1, active: true });
      });
    }
  });

  describe('RolesGuard thật + Reflector thật trên handler thật', () => {
    class FakeController {
      @Roles(UserRole.ADMIN)
      adminOnly() {}

      @AnyRole()
      anyRole() {}

      @Public()
      publicRoute() {}

      bare() {}
    }

    const guard = new RolesGuard(new Reflector());
    const run = (handlerName: keyof FakeController, role?: string) =>
      guard.canActivate({
        getHandler: () => FakeController.prototype[handlerName],
        getClass: () => FakeController,
        switchToHttp: () => ({
          getRequest: () => ({ user: role ? { sub: 'u', role } : undefined }),
        }),
      } as unknown as ExecutionContext);

    it.each([UserRole.MANAGER, UserRole.STAFF])(
      'handler không khai báo quyền: %s bị 403',
      (role) => {
        expect(() => run('bare', role)).toThrow(ForbiddenException);
      },
    );

    it.each([UserRole.ADMIN, UserRole.EDITOR])(
      'handler không khai báo quyền: %s vẫn vào được (tương thích route cũ)',
      (role) => {
        expect(run('bare', role)).toBe(true);
      },
    );

    it('handler không khai báo quyền và chưa đăng nhập (không có user) bị 403', () => {
      expect(() => run('bare')).toThrow(ForbiddenException);
    });

    it('@AnyRole cho mọi vai trò; @Public cho cả khi không có user; @Roles(ADMIN) chặn EDITOR/STAFF', () => {
      expect(run('anyRole', UserRole.STAFF)).toBe(true);
      expect(run('publicRoute')).toBe(true);
      expect(run('adminOnly', UserRole.ADMIN)).toBe(true);
      expect(() => run('adminOnly', UserRole.EDITOR)).toThrow(
        ForbiddenException,
      );
      expect(() => run('adminOnly', UserRole.STAFF)).toThrow(
        ForbiddenException,
      );
    });
  });
});
