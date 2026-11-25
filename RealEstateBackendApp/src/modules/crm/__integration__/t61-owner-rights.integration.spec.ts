/**
 * INTEGRATION — T-61 (QA Đợt 7 v1.0.6, FR-30..FR-33): luật "chủ khách" qua HTTP thật (Fastify + ValidationPipe +
 * GlobalExceptionFilter + JwtAuthGuard/RolesGuard) trên MongoDB Replica Set GIẢ của mongodb-memory-server (không phải
 * MongoDB thật) và Redis thật (rate limit mời nhóm). Phủ các khoảng trống mà spec M2/M5/invite-flow chưa có:
 *  - chi tiết khách: `ownerManagers` / `creator` (định dạng, thứ tự, lọc ACTIVE, loại trùng careTeam, người tạo là Manager,
 *    người tạo bị khóa/xóa mềm/đổi nhóm, nhóm xóa mềm, khách cũ thiếu `createdBy`), endpoint `assignee-candidates` cũ trả 404;
 *  - Admin là người tạo khách nhưng ngoài careTeam giao lịch cho CHÍNH MÌNH (tạo trực tiếp, qua nhật ký, qua PATCH);
 *    Admin KHÁC (không phải người tạo, ngoài careTeam) bị chặn cả ba đường;
 *  - thông điệp ĐÚNG CHỮ của ba lý do USER_NOT_ASSIGNABLE ở cả hai đường (lịch trực tiếp, nhật ký kèm lịch);
 *  - MỘT lần đọc `users` ở bước kiểm người thực hiện (PATCH và nhật ký kèm lịch hẹn);
 *  - khóa người tạo (409 PRIMARY_LOCKED + details.reason = CREATOR_LOCKED) cấp endpoint, ma trận người gỡ x vị trí của người tạo;
 *  - bulk ASSIGN không bao giờ gỡ người tạo; Staff là người tạo khách cũ ngoài careTeam vẫn mời/gỡ/xem CMND được;
 *  - cờ quyền `permissions.*` ở chi tiết khớp hành vi thật.
 *
 * Các `it` trong cùng `describe` dùng dữ liệu dựng riêng mỗi ca (không phụ thuộc thứ tự).
 * Chạy: npx jest --testPathIgnorePatterns "/node_modules/" --testRegex "t61-owner-rights.integration.spec.ts$" --runInBand
 */
import { randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.fixture';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { TeamsModule } from '../../teams/teams.module';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { UsersModule } from '../../users/users.module';
import { CrmModule } from '.././crm.module';
import { CrmSeedService } from '.././seed/crm-seed.service';

jest.setTimeout(300_000);

const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);
const DAY_MS = 86_400_000;
const NATIONAL_ID = '012345678901';

/** Thông điệp ĐÚNG CHỮ (Architecture 5.13.3). */
const MESSAGE = {
  NOT_IN_CARE_TEAM:
    'Người thực hiện phải là thành viên nhóm chăm sóc, người tạo khách hoặc Quản lý của nhóm chủ khách; nhờ thành viên có quyền mời đưa người đó vào nhóm trước',
  NOT_ACTIVE:
    'Người thực hiện không còn hoạt động (tài khoản bị khóa hoặc đã xóa)',
  NOT_CRM_ROLE:
    'Người thực hiện không có vai trò CRM (cần là Quản trị, Quản lý hoặc Nhân viên)',
} as const;

interface Res {
  status: number;
  body: any;
}

describe('CRM T-61 — chủ khách, người tạo, tập người thực hiện (FR-30..FR-33) qua HTTP', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const oid = (key: string) => new Types.ObjectId(ids[key]);
  const col = (name: string) => connection.collection(name);
  const customers = () => col('customers');
  const inDays = (days: number) =>
    new Date(Date.now() + days * DAY_MS).toISOString();

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    as: string,
    body?: unknown,
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${tokens[as]}` },
      payload: body as never,
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed };
  };

  const createUser = async (
    key: string,
    role: UserRole,
    extra: Record<string, unknown> = {},
  ) => {
    const user = await userModel.create({
      email: `${key}@test.vn`,
      password: 'hash',
      displayName: key,
      role,
      status: UserStatus.ACTIVE,
      ...extra,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({ sub: ids[key], email: user.email, role });
  };

  let phoneSeq = 0;
  const createCustomer = async (as: string): Promise<string> => {
    const phone = `096${String(1_000_000 + ++phoneSeq)}`;
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách T61 ${phone}`,
      phone,
    });
    expect([as, res.status]).toEqual([as, 201]);
    return res.body.data.id as string;
  };

  /** Dựng tay careTeam (API cấm gỡ người tạo nên các ca "người tạo ngoài careTeam" phải chỉnh thẳng DB). */
  const setCareTeam = async (
    customerId: string,
    members: Array<[string, 'PRIMARY' | 'MEMBER']>,
    extra: Record<string, unknown> = {},
  ) => {
    const primary = members.find(([, role]) => role === 'PRIMARY');
    await customers().updateOne(
      { _id: new Types.ObjectId(customerId) },
      {
        $set: {
          careTeam: members.map(([key, role]) => ({
            userId: oid(key),
            role,
            addedAt: new Date(),
            addedBy: oid('admin'),
          })),
          primaryAssigneeId: primary ? oid(primary[0]) : null,
          ...extra,
        },
      },
    );
  };

  const careTeamOf = async (customerId: string) =>
    (
      (await customers().findOne({ _id: new Types.ObjectId(customerId) }))!
        .careTeam as Array<{ userId: Types.ObjectId; role: string }>
    ).map((member) => [String(member.userId), member.role]);

  const detail = async (customerId: string, as = 'admin') => {
    const res = await call('GET', `/crm/customers/${customerId}`, as);
    expect([as, res.status]).toEqual([as, 200]);
    return res.body.data;
  };

  const ref = (key: string, role: string) => ({
    userId: ids[key],
    fullName: key,
    role,
  });

  const appointmentBody = (assigneeIds: string[], customerId: string) => ({
    customerId,
    type: 'SITE_VISIT',
    startAt: inDays(3),
    assigneeIds,
    remindBeforeMinutes: [60],
  });
  const viaDirect = (as: string, customerId: string, assigneeKeys: string[]) =>
    call(
      'POST',
      '/crm/appointments',
      as,
      appointmentBody(
        assigneeKeys.map((key) => ids[key]),
        customerId,
      ),
    );
  const viaCareLog = (as: string, customerId: string, assigneeKeys: string[]) =>
    call('POST', `/crm/customers/${customerId}/care-logs`, as, {
      content: 'Gọi tư vấn T61',
      contactChannel: 'CALL',
      nextAction: {
        dueAt: inDays(3),
        appointment: {
          type: 'MEETING',
          assigneeIds: assigneeKeys.map((key) => ids[key]),
        },
      },
    });

  const expectRejected = (
    res: Res,
    reason: keyof typeof MESSAGE,
    userKeys: string[],
  ) => {
    expect([res.status, res.body.errorCode]).toEqual([
      400,
      'USER_NOT_ASSIGNABLE',
    ]);
    expect(res.body.message).toBe(MESSAGE[reason]);
    expect(res.body.details).toEqual({
      userIds: userKeys.map((key) => ids[key]),
      reason,
    });
  };

  const setUser = (key: string, set: Record<string, unknown>) =>
    userModel.updateOne({ _id: ids[key] }, { $set: set }).exec();

  beforeAll(async () => {
    process.env.CRM_ENABLED = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-t61-owner-${RUN_ID}:`;
    replSet = await createMemoryReplSet();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: JWT_SECRET }),
        FeatureFlagModule,
        UsersModule,
        TeamsModule,
        CrmModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    connection = app.get<Connection>(getConnectionToken());
    userModel = app.get(getModelToken(User.name));
    jwt = app.get(JwtService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();

    await createUser('admin', UserRole.ADMIN);
    await createUser('admin2', UserRole.ADMIN);
    // Tên hiển thị khác nhau để kiểm thứ tự "sắp theo fullName" (An < Bình theo collation vi).
    await createUser('mgrA1', UserRole.MANAGER);
    await createUser('mgrA2', UserRole.MANAGER);
    await createUser('mgrB', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffA2', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    await createUser('staffC', UserRole.STAFF);
    await createUser('editorA', UserRole.EDITOR);

    ids.teamA = (
      await call('POST', '/teams', 'admin', {
        name: 'Nhóm A T61',
        code: 'T61A',
        managerIds: [ids.mgrA1, ids.mgrA2],
      })
    ).body.data.id;
    ids.teamB = (
      await call('POST', '/teams', 'admin', {
        name: 'Nhóm B T61',
        code: 'T61B',
        managerIds: [ids.mgrB],
      })
    ).body.data.id;
    for (const [user, team] of [
      ['mgrA1', 'teamA'],
      ['mgrA2', 'teamA'],
      ['staffA', 'teamA'],
      ['staffA2', 'teamA'],
      ['mgrB', 'teamB'],
      ['staffB', 'teamB'],
    ]) {
      const res = await call('PATCH', `/users/${ids[user]}/team`, 'admin', {
        teamId: ids[team],
      });
      expect([user, res.status]).toEqual([user, 200]);
    }
  });

  afterAll(async () => {
    delete process.env.CRM_ENABLED;
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------------------------
  describe('chi tiết khách: ownerManagers và creator (FR-30)', () => {
    it('người tạo nằm trong careTeam: ownerManagers = Manager ACTIVE nhóm chủ, định dạng { userId, fullName, role }, sắp theo fullName; creator = null; endpoint assignee-candidates cũ trả 404', async () => {
      const id = await createCustomer('staffA');
      const body = await detail(id, 'staffA');
      expect(body.ownerManagers).toEqual([
        ref('mgrA1', 'MANAGER'),
        ref('mgrA2', 'MANAGER'),
      ]);
      expect(body.creator).toBeNull();
      for (const who of ['admin', 'staffA', 'mgrA1']) {
        const res = await call(
          'GET',
          `/crm/customers/${id}/assignee-candidates`,
          who,
        );
        expect([who, res.status]).toEqual([who, 404]);
      }
    });

    it('fullName của ownerManagers/creator là TÊN HIỂN THỊ thật của tài khoản (không rỗng) và thứ tự theo tên (collation vi)', async () => {
      await setUser('mgrA1', { displayName: 'Bình Quản lý' });
      await setUser('mgrA2', { displayName: 'An Quản lý' });
      await setUser('staffA', { displayName: 'Chi Nhân viên' });
      try {
        const id = await createCustomer('staffA');
        await setCareTeam(id, [['staffA2', 'PRIMARY']]);
        const body = await detail(id);
        expect(
          body.ownerManagers.map(
            (owner: { fullName: string }) => owner.fullName,
          ),
        ).toEqual(['An Quản lý', 'Bình Quản lý']);
        expect(body.creator).toEqual({
          userId: ids.staffA,
          fullName: 'Chi Nhân viên',
          role: 'STAFF',
        });
      } finally {
        await setUser('mgrA1', { displayName: 'mgrA1' });
        await setUser('mgrA2', { displayName: 'mgrA2' });
        await setUser('staffA', { displayName: 'staffA' });
      }
    });

    it('người tạo ngoài careTeam (Staff): creator = { userId, fullName, role }, không trùng ownerManagers', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [['staffA2', 'PRIMARY']]);
      const body = await detail(id);
      expect(body.creator).toEqual(ref('staffA', 'STAFF'));
      expect(body.ownerManagers).toEqual([
        ref('mgrA1', 'MANAGER'),
        ref('mgrA2', 'MANAGER'),
      ]);
    });

    it('Manager đã trong careTeam không lặp ở ownerManagers; Manager bị khóa không có ở ownerManagers', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA2', 'PRIMARY'],
        ['mgrA2', 'MEMBER'],
      ]);
      expect((await detail(id)).ownerManagers).toEqual([
        ref('mgrA1', 'MANAGER'),
      ]);
      await setCareTeam(id, [['staffA2', 'PRIMARY']]);
      await setUser('mgrA2', { status: UserStatus.BLOCKED });
      try {
        expect((await detail(id)).ownerManagers).toEqual([
          ref('mgrA1', 'MANAGER'),
        ]);
      } finally {
        await setUser('mgrA2', { status: UserStatus.ACTIVE });
      }
    });

    it('người tạo là Manager nhóm chủ ngoài careTeam: nằm ở ownerManagers, creator = null (không lặp)', async () => {
      const id = await createCustomer('mgrA1');
      await setCareTeam(id, [['staffA2', 'PRIMARY']]);
      const body = await detail(id);
      expect(body.ownerManagers).toEqual([
        ref('mgrA1', 'MANAGER'),
        ref('mgrA2', 'MANAGER'),
      ]);
      expect(body.creator).toBeNull();
    });

    it('người tạo là Admin (không nhóm): không có Manager nhóm chủ; creator = Admin (vai trò ADMIN)', async () => {
      const id = await createCustomer('admin');
      await setCareTeam(id, [['staffA2', 'PRIMARY']]);
      const body = await detail(id);
      expect(body.ownerManagers).toEqual([]);
      expect(body.creator).toEqual(ref('admin', 'ADMIN'));
    });

    it('người tạo bị khóa hoặc xóa mềm: creator = null; Manager nhóm chủ vẫn còn', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [['staffA2', 'PRIMARY']]);
      await setUser('staffA', { status: UserStatus.BLOCKED });
      try {
        const blocked = await detail(id);
        expect(blocked.creator).toBeNull();
        expect(blocked.ownerManagers).toHaveLength(2);
      } finally {
        await setUser('staffA', { status: UserStatus.ACTIVE });
      }
      await setUser('staffA', { deletedAt: new Date() });
      try {
        expect((await detail(id)).creator).toBeNull();
      } finally {
        await setUser('staffA', { deletedAt: null });
      }
    });

    it('người tạo đổi nhóm: nhóm chủ theo nhóm HIỆN TẠI của người tạo; nhóm chủ xóa mềm thì không có Manager nhóm chủ', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [['staffA2', 'PRIMARY']]);
      const move = await call('PATCH', `/users/${ids.staffA}/team`, 'admin', {
        teamId: ids.teamB,
      });
      expect(move.status).toBe(200);
      try {
        expect((await detail(id)).ownerManagers).toEqual([
          ref('mgrB', 'MANAGER'),
        ]);
      } finally {
        await call('PATCH', `/users/${ids.staffA}/team`, 'admin', {
          teamId: ids.teamA,
        });
      }
      expect((await detail(id)).ownerManagers).toHaveLength(2);
      await col('teams').updateOne(
        { _id: new Types.ObjectId(ids.teamA) },
        { $set: { deletedAt: new Date() } },
      );
      try {
        expect((await detail(id)).ownerManagers).toEqual([]);
      } finally {
        await col('teams').updateOne(
          { _id: new Types.ObjectId(ids.teamA) },
          { $set: { deletedAt: null } },
        );
      }
    });

    it('khách cũ thiếu createdBy: nhóm chủ dự phòng theo customer.teamIds; creator = null; Manager nhóm đó vẫn thấy khách', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [['staffA2', 'PRIMARY']], {
        createdBy: null,
        teamIds: [oid('teamA')],
      });
      const body = await detail(id);
      expect(body.ownerManagers).toEqual([
        ref('mgrA1', 'MANAGER'),
        ref('mgrA2', 'MANAGER'),
      ]);
      expect(body.creator).toBeNull();
      expect((await call('GET', `/crm/customers/${id}`, 'mgrA1')).status).toBe(
        200,
      );
      expect((await call('GET', `/crm/customers/${id}`, 'mgrB')).status).toBe(
        404,
      );
    });

    it('cờ quyền permissions khớp luật: Admin, người tạo, Manager nhóm chủ có canManageCareTeam/canRevealNationalId; PRIMARY không phải người tạo thì không; canDelete chỉ Admin hoặc người tạo', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA2', 'PRIMARY'],
        ['staffA', 'MEMBER'],
      ]);
      const flags = async (who: string) => {
        const { permissions, canRevealNationalId } = await detail(id, who);
        return {
          canManageCareTeam: permissions.canManageCareTeam,
          canDelete: permissions.canDelete,
          canRevealNationalId,
        };
      };
      const all = {
        canManageCareTeam: true,
        canDelete: true,
        canRevealNationalId: true,
      };
      const manage = {
        canManageCareTeam: true,
        canDelete: false,
        canRevealNationalId: true,
      };
      const none = {
        canManageCareTeam: false,
        canDelete: false,
        canRevealNationalId: false,
      };
      expect(await flags('admin')).toEqual(all);
      expect(await flags('staffA')).toEqual(all);
      expect(await flags('mgrA1')).toEqual(manage);
      expect(await flags('staffA2')).toEqual(none);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Admin là người tạo khách ngoài careTeam giao lịch cho chính mình; Admin khác bị chặn (FR-30)', () => {
    let id: string;
    beforeAll(async () => {
      id = await createCustomer('admin');
      // Dựng tay: careTeam không còn Admin (API không cho gỡ người tạo).
      await setCareTeam(id, [['staffA2', 'PRIMARY']], {
        teamIds: [oid('teamA')],
      });
    });

    it('đường lịch trực tiếp: người tạo Admin tự giao cho mình => 201', async () => {
      const res = await viaDirect('admin', id, ['admin']);
      expect([res.status, res.body.message]).toEqual([201, undefined]);
      expect(res.body.data.assignees.map((a: { id: string }) => a.id)).toEqual([
        ids.admin,
      ]);
    });

    it('đường nhật ký kèm lịch hẹn (nextAction.appointment): người tạo Admin tự giao cho mình => 201', async () => {
      const res = await viaCareLog('admin', id, ['admin']);
      expect([res.status, res.body.message]).toEqual([201, undefined]);
      const appointmentId = res.body.data.nextAction.appointmentId as string;
      const appointment = (
        await call('GET', `/crm/appointments/${appointmentId}`, 'admin')
      ).body.data;
      expect(appointment.assignees.map((a: { id: string }) => a.id)).toEqual([
        ids.admin,
      ]);
    });

    it('đường PATCH: thêm người tạo Admin vào danh sách => 200', async () => {
      const created = await viaDirect('admin', id, ['staffA2']);
      expect(created.status).toBe(201);
      const patched = await call(
        'PATCH',
        `/crm/appointments/${created.body.data.id}`,
        'admin',
        {
          version: created.body.data.version,
          assigneeIds: [ids.staffA2, ids.admin],
        },
      );
      expect([patched.status, patched.body.message]).toEqual([200, undefined]);
      expect(
        patched.body.data.assignees.map((a: { id: string }) => a.id),
      ).toEqual([ids.staffA2, ids.admin]);
    });

    it('Admin KHÁC (không phải người tạo, ngoài careTeam) tự giao cho mình: 400 NOT_IN_CARE_TEAM cả ba đường, đúng thông điệp; không ghi lịch', async () => {
      const before = await col('appointments').countDocuments({
        customerId: new Types.ObjectId(id),
      });
      expectRejected(
        await viaDirect('admin2', id, ['admin2']),
        'NOT_IN_CARE_TEAM',
        ['admin2'],
      );
      expectRejected(
        await viaCareLog('admin2', id, ['admin2']),
        'NOT_IN_CARE_TEAM',
        ['admin2'],
      );
      const base = await viaDirect('admin', id, ['staffA2']);
      const patched = await call(
        'PATCH',
        `/crm/appointments/${base.body.data.id}`,
        'admin2',
        {
          version: base.body.data.version,
          assigneeIds: [ids.staffA2, ids.admin2],
        },
      );
      expectRejected(patched, 'NOT_IN_CARE_TEAM', ['admin2']);
      // chỉ có lịch `base` vừa tạo, không có lịch nào của admin2 / nhật ký của admin2.
      expect(
        await col('appointments').countDocuments({
          customerId: new Types.ObjectId(id),
        }),
      ).toBe(before + 1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('USER_NOT_ASSIGNABLE: thông điệp ĐÚNG CHỮ và người tạo bị khóa (FR-33)', () => {
    it('người tạo INACTIVE (ngoài careTeam) không có trong creator và bị chặn NOT_ACTIVE: lịch trực tiếp và nhật ký kèm lịch', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [['staffA2', 'PRIMARY']]);
      await setUser('staffA', { status: UserStatus.BLOCKED });
      try {
        expect((await detail(id)).creator).toBeNull();
        expectRejected(await viaDirect('admin', id, ['staffA']), 'NOT_ACTIVE', [
          'staffA',
        ]);
        expectRejected(
          await viaCareLog('admin', id, ['staffA']),
          'NOT_ACTIVE',
          ['staffA'],
        );
      } finally {
        await setUser('staffA', { status: UserStatus.ACTIVE });
      }
    });

    it('ba thông điệp đúng chữ ở lịch trực tiếp, nhật ký kèm lịch và PATCH: NOT_IN_CARE_TEAM (staffC), NOT_ACTIVE (thành viên bị khóa), NOT_CRM_ROLE (thành viên chỉ EDITOR)', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA', 'PRIMARY'],
        ['staffA2', 'MEMBER'],
        ['editorA', 'MEMBER'],
      ]);
      expectRejected(
        await viaDirect('staffA', id, ['staffC']),
        'NOT_IN_CARE_TEAM',
        ['staffC'],
      );
      expectRejected(
        await viaCareLog('staffA', id, ['staffC']),
        'NOT_IN_CARE_TEAM',
        ['staffC'],
      );
      expectRejected(
        await viaDirect('staffA', id, ['editorA']),
        'NOT_CRM_ROLE',
        ['editorA'],
      );
      expectRejected(
        await viaCareLog('staffA', id, ['editorA']),
        'NOT_CRM_ROLE',
        ['editorA'],
      );
      await setUser('staffA2', { status: UserStatus.BLOCKED });
      try {
        expectRejected(
          await viaDirect('staffA', id, ['staffA2']),
          'NOT_ACTIVE',
          ['staffA2'],
        );
        expectRejected(
          await viaCareLog('staffA', id, ['staffA2']),
          'NOT_ACTIVE',
          ['staffA2'],
        );
      } finally {
        await setUser('staffA2', { status: UserStatus.ACTIVE });
      }
      const base = await viaDirect('staffA', id, ['staffA']);
      expect(base.status).toBe(201);
      const patch = (key: string) =>
        call('PATCH', `/crm/appointments/${base.body.data.id}`, 'staffA', {
          version: base.body.data.version,
          assigneeIds: [ids.staffA, ids[key]],
        });
      expectRejected(await patch('staffC'), 'NOT_IN_CARE_TEAM', ['staffC']);
      expectRejected(await patch('editorA'), 'NOT_CRM_ROLE', ['editorA']);
    });

    it('thông điệp lỗi không lộ tên hay số điện thoại khách', async () => {
      const id = await createCustomer('staffA');
      const res = await viaDirect('admin2', id, ['staffC']);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/Khách T61|096\d{7}|\+84/);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('MỘT lần đọc users ở bước kiểm người thực hiện (FR-30, Architecture 5.13.2)', () => {
    /** Đếm các lần đọc `users` ĐÚNG hình dạng của bước kiểm (`.select('roles status deletedAt')`). */
    const countCheckReads = async (run: () => Promise<Res>) => {
      const original = userModel.find.bind(userModel) as (
        ...a: unknown[]
      ) => any;
      let reads = 0;
      const spy = jest.spyOn(userModel, 'find').mockImplementation(((
        ...args: unknown[]
      ) => {
        const query = original(...args);
        const select = query.select.bind(query);
        query.select = (fields: unknown) => {
          if (fields === 'roles status deletedAt') reads += 1;
          return select(fields);
        };
        return query;
      }) as never);
      try {
        const res = await run();
        return { reads, res };
      } finally {
        spy.mockRestore();
      }
    };

    it('PATCH thêm nhiều người mới: đúng 1 lần đọc users (không N lần)', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA', 'PRIMARY'],
        ['staffA2', 'MEMBER'],
        ['staffB', 'MEMBER'],
      ]);
      const base = await viaDirect('staffA', id, ['staffA']);
      expect(base.status).toBe(201);
      const { reads, res } = await countCheckReads(() =>
        call('PATCH', `/crm/appointments/${base.body.data.id}`, 'staffA', {
          version: base.body.data.version,
          assigneeIds: [ids.staffA, ids.staffA2, ids.staffB, ids.mgrA1],
        }),
      );
      expect([res.status, res.body.message]).toEqual([200, undefined]);
      expect(reads).toBe(1);
    });

    it('nhật ký kèm lịch hẹn với nhiều người thực hiện: đúng 1 lần đọc users', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA', 'PRIMARY'],
        ['staffA2', 'MEMBER'],
        ['staffB', 'MEMBER'],
      ]);
      const { reads, res } = await countCheckReads(() =>
        viaCareLog('staffA', id, ['staffA', 'staffA2', 'staffB', 'mgrA1']),
      );
      expect([res.status, res.body.message]).toEqual([201, undefined]);
      expect(reads).toBe(1);
    });

    it('lịch trực tiếp: đúng 1 lần đọc users', async () => {
      const id = await createCustomer('staffA');
      const { reads, res } = await countCheckReads(() =>
        viaDirect('staffA', id, ['staffA', 'mgrA1', 'mgrA2']),
      );
      expect([res.status, res.body.message]).toEqual([201, undefined]);
      expect(reads).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('khóa người tạo cấp endpoint: 409 PRIMARY_LOCKED + details.reason = CREATOR_LOCKED (FR-31)', () => {
    const remove = (customerId: string, as: string, target: string) =>
      call(
        'DELETE',
        `/crm/customers/${customerId}/care-team/members/${ids[target]}`,
        as,
      );

    it('người tạo là MEMBER: Admin, Manager nhóm chủ và chính người tạo gỡ đều 409 CREATOR_LOCKED; nhóm không đổi', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA2', 'PRIMARY'],
        ['staffA', 'MEMBER'],
      ]);
      const before = await careTeamOf(id);
      for (const who of ['admin', 'mgrA1', 'staffA']) {
        const res = await remove(id, who, 'staffA');
        expect([
          who,
          res.status,
          res.body.errorCode,
          res.body.details?.reason,
        ]).toEqual([who, 409, 'PRIMARY_LOCKED', 'CREATOR_LOCKED']);
      }
      expect(await careTeamOf(id)).toEqual(before);
    });

    it('người tạo là PRIMARY: Admin, Manager nhóm chủ và chính người tạo gỡ đều 409 CREATOR_LOCKED', async () => {
      const id = await createCustomer('staffA');
      for (const who of ['admin', 'mgrA1', 'staffA']) {
        const res = await remove(id, who, 'staffA');
        expect([
          who,
          res.status,
          res.body.errorCode,
          res.body.details?.reason,
        ]).toEqual([who, 409, 'PRIMARY_LOCKED', 'CREATOR_LOCKED']);
      }
      expect(await careTeamOf(id)).toEqual([[ids.staffA, 'PRIMARY']]);
    });

    it('người KHÔNG có quyền chủ khách (PRIMARY không phải người tạo, MEMBER) gỡ người tạo: 403 CARE_TEAM_ACTION_FORBIDDEN (chưa tới bước khóa)', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA2', 'PRIMARY'],
        ['staffA', 'MEMBER'],
        ['staffB', 'MEMBER'],
      ]);
      for (const who of ['staffA2', 'staffB']) {
        const res = await remove(id, who, 'staffA');
        expect([who, res.status, res.body.errorCode]).toEqual([
          who,
          403,
          'CARE_TEAM_ACTION_FORBIDDEN',
        ]);
      }
    });

    it('gỡ PRIMARY không phải người tạo: 409 PRIMARY_LOCKED KHÔNG kèm reason; gỡ thành viên khác: 200', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA2', 'PRIMARY'],
        ['staffA', 'MEMBER'],
        ['staffB', 'MEMBER'],
      ]);
      const primary = await remove(id, 'admin', 'staffA2');
      expect([primary.status, primary.body.errorCode]).toEqual([
        409,
        'PRIMARY_LOCKED',
      ]);
      expect(primary.body.details?.reason).toBeUndefined();
      const member = await remove(id, 'mgrA1', 'staffB');
      expect(member.status).toBe(200);
      expect(await careTeamOf(id)).toEqual([
        [ids.staffA2, 'PRIMARY'],
        [ids.staffA, 'MEMBER'],
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('bulk ASSIGN không bao giờ gỡ người tạo; người tạo (Staff) khách cũ ngoài careTeam mời/gỡ/xem CMND (FR-31)', () => {
    it('bulk ASSIGN: người tạo (MEMBER) và PRIMARY còn nguyên, chỉ thêm MEMBER mới; khách người gọi không có quyền chủ vào failed[] INSUFFICIENT_ROLE', async () => {
      const owned = await createCustomer('staffA');
      await setCareTeam(owned, [
        ['staffA2', 'PRIMARY'],
        ['staffA', 'MEMBER'],
      ]);
      const foreign = await createCustomer('staffB');
      // mgrA1 (nhóm A) là MEMBER của khách nhóm B: thấy khách nhưng KHÔNG phải chủ khách.
      await setCareTeam(foreign, [
        ['staffB', 'PRIMARY'],
        ['mgrA1', 'MEMBER'],
      ]);
      const res = await call('POST', '/crm/customer-bulk-operations', 'mgrA1', {
        type: 'ASSIGN',
        customerIds: [owned, foreign],
        payload: { memberIds: [ids.staffC] },
      });
      expect([res.status, res.body.message]).toEqual([200, undefined]);
      expect(res.body.data.succeeded).toEqual([owned]);
      expect(res.body.data.failed).toEqual([
        { customerId: foreign, errorCode: 'INSUFFICIENT_ROLE' },
      ]);
      expect(
        (await careTeamOf(foreign)).map(([userId]) => userId),
      ).not.toContain(ids.staffC);
      expect(await careTeamOf(owned)).toEqual([
        [ids.staffA2, 'PRIMARY'],
        [ids.staffA, 'MEMBER'],
        [ids.staffC, 'MEMBER'],
      ]);
      // Admin: thêm lần nữa (đã có thì bỏ qua), người tạo vẫn còn.
      const again = await call(
        'POST',
        '/crm/customer-bulk-operations',
        'admin',
        {
          type: 'ASSIGN',
          customerIds: [owned],
          payload: { memberIds: [ids.staffC, ids.staffB] },
        },
      );
      expect(again.status).toBe(200);
      const team = (await careTeamOf(owned)).map(([userId]) => userId);
      expect(team).toContain(ids.staffA);
      expect(team).toContain(ids.staffA2);
    });

    it('Staff là người tạo, careTeam không còn họ: thấy khách, mời được, gỡ được thành viên (không phải người tạo), xem CMND 201; PRIMARY không phải người tạo xem CMND 403 NATIONAL_ID_FORBIDDEN', async () => {
      const id = await createCustomer('staffA');
      const put = await call(
        'PUT',
        `/crm/customers/${id}/national-id`,
        'admin',
        {
          nationalId: NATIONAL_ID,
        },
      );
      expect(put.status).toBe(200);
      await setCareTeam(id, [['staffA2', 'PRIMARY']]);

      expect((await call('GET', `/crm/customers/${id}`, 'staffA')).status).toBe(
        200,
      );
      const invite = await call(
        'POST',
        `/crm/customers/${id}/care-team/members`,
        'staffA',
        {
          userIds: [ids.staffC],
        },
      );
      expect([invite.status, invite.body.message]).toEqual([201, undefined]);
      const removed = await call(
        'DELETE',
        `/crm/customers/${id}/care-team/members/${ids.staffC}`,
        'staffA',
      );
      expect(removed.status).toBe(200);

      const own = await call(
        'POST',
        `/crm/customers/${id}/national-id-views`,
        'staffA',
        {},
      );
      expect([own.status, own.body.data?.nationalId]).toEqual([
        201,
        NATIONAL_ID,
      ]);
      const ownerManager = await call(
        'POST',
        `/crm/customers/${id}/national-id-views`,
        'mgrA1',
        {},
      );
      expect(ownerManager.status).toBe(201);
      const primary = await call(
        'POST',
        `/crm/customers/${id}/national-id-views`,
        'staffA2',
        {},
      );
      expect([primary.status, primary.body.errorCode]).toEqual([
        403,
        'NATIONAL_ID_FORBIDDEN',
      ]);
      const otherTeamManager = await call(
        'POST',
        `/crm/customers/${id}/national-id-views`,
        'mgrB',
        {},
      );
      expect(otherTeamManager.status).toBe(404);
    });

    it('mời/gỡ: PRIMARY và MEMBER không phải người tạo bị 403; Manager nhóm khác không thấy khách (404)', async () => {
      const id = await createCustomer('staffA');
      await setCareTeam(id, [
        ['staffA2', 'PRIMARY'],
        ['staffA', 'MEMBER'],
        ['staffB', 'MEMBER'],
      ]);
      for (const who of ['staffA2', 'staffB']) {
        const res = await call(
          'POST',
          `/crm/customers/${id}/care-team/members`,
          who,
          {
            userIds: [ids.staffC],
          },
        );
        expect([who, res.status, res.body.errorCode]).toEqual([
          who,
          403,
          'CARE_TEAM_ACTION_FORBIDDEN',
        ]);
      }
      const invite = await call(
        'POST',
        `/crm/customers/${id}/care-team/members`,
        'mgrB',
        {
          userIds: [ids.staffC],
        },
      );
      expect([invite.status, invite.body.errorCode]).toEqual([
        404,
        'CUSTOMER_NOT_FOUND',
      ]);
    });
  });
});
