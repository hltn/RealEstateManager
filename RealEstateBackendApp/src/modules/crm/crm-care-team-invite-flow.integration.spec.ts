/**
 * INTEGRATION — v1.0.5 T-33: nhóm chăm sóc theo luồng MỜI qua HTTP thật (Fastify + ValidationPipe + GlobalExceptionFilter
 * + JwtAuthGuard/RolesGuard + CrmFeatureGuard) trên MongoDB Replica Set thật (mongodb-memory-server) và Redis THẬT
 * (rate limit `CARE_TEAM_INVITE`; khóa có tiền tố riêng mỗi lần chạy).
 *
 * Phủ các quy tắc FR-10/11/13/16/17/18/19 mà các spec M3 chỉ phủ một phần:
 *  - Admin tạo khách là PRIMARY nên `teamIds` rỗng; mời người nhóm khác thì `teamIds` mở rộng.
 *  - Khách cũ chưa có PRIMARY: Quản trị/Quản lý đặt đúng MỘT lần rồi khóa (409 PRIMARY_LOCKED, route PUT primary 404).
 *  - Nhân viên PRIMARY mời người NHÓM KHÁC; Quản lý nhóm của người được mời thấy khách; thành viên phụ không tự rời.
 *  - Người BLOCKED / chỉ-Quản-trị / EDITOR / đã xóa mềm / không tồn tại bị từ chối (cả lô, không ghi dở).
 *  - Giới hạn 10 MEMBER (PRIMARY không tính; lô vượt bị từ chối cả lô; khách cũ >10 chỉ chặn thêm, vẫn gỡ được).
 *  - Bulk ASSIGN chỉ thêm MEMBER.
 *  - `CUSTOMER_ASSIGNED` không gửi cho người BLOCKED (kể cả khi lớp kiểm tra mời bị vô hiệu: phòng thủ chiều sâu).
 *  - Việc hằng ngày hiện cho MEMBER khi PRIMARY bị BLOCKED hoặc chưa có PRIMARY.
 *
 * Các `it` trong cùng `describe` chạy THEO THỨ TỰ và dùng chung dữ liệu dựng ở bước trước.
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
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
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CareTeamAssigneesService } from './care-teams/care-team-assignees.service';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(300_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);
const DAY_MS = 86_400_000;
/** Số thành viên phụ tối đa của một khách (FR-17). */
const MEMBER_LIMIT = 10;

interface Res {
  status: number;
  body: any;
}

describe('CRM v1.0.5 T-33 — nhóm chăm sóc theo luồng mời (khóa PRIMARY, giới hạn 10, BLOCKED, việc hằng ngày)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  /** Người dùng phụ dùng cho các ca giới hạn 10 (đủ để mời 11 người). */
  const extraKeys = Array.from({ length: 12 }, (_, index) => `extra${index}`);

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    as: string | null,
    body?: unknown,
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: as ? { authorization: `Bearer ${tokens[as]}` } : {},
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
  /** SĐT VN hợp lệ, duy nhất theo thứ tự gọi (đầu 094 để không đụng spec khác). */
  const nextPhone = () => `094${String(1_000_000 + ++phoneSeq)}`;

  /** Tạo khách qua API: người gọi luôn là PRIMARY (FR-10/FR-11). */
  const createCustomer = async (as: string): Promise<string> => {
    const phone = nextPhone();
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách ${phone}`,
      phone,
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const customers = () => connection.collection('customers');
  const customerDoc = (id: string) =>
    customers().findOne({ _id: new Types.ObjectId(id) });
  const careTeamOf = async (id: string) =>
    ((await customerDoc(id))!.careTeam as Array<{
      userId: Types.ObjectId;
      role: string;
    }>).map((member) => ({
      userId: String(member.userId),
      role: member.role,
    }));
  const teamIdsOf = async (id: string) =>
    ((await customerDoc(id))!.teamIds as Types.ObjectId[]).map(String).sort();
  const sorted = (values: string[]) => [...values].sort();
  const auditOf = (customerId: string, action: string) =>
    connection
      .collection('crm_audit_logs')
      .find({ customerId: new Types.ObjectId(customerId), action })
      .toArray();
  const assignedNotifications = (customerId: string, userKey: string) =>
    connection
      .collection('notifications')
      .find({
        userId: new Types.ObjectId(ids[userKey]),
        type: 'CUSTOMER_ASSIGNED',
        'data.customerId': new Types.ObjectId(customerId),
      })
      .toArray();

  const invite = (
    customerId: string,
    as: string,
    userKeys: string[],
    extra: Record<string, unknown> = {},
  ) =>
    call('POST', `/crm/customers/${customerId}/care-team/members`, as, {
      userIds: userKeys.map((key) => ids[key]),
      ...extra,
    });

  /** Dựng KHÁCH CŨ (trước v1.0.5) chưa có nhóm chăm sóc: người tạo mới luôn là PRIMARY nên chỉnh thẳng DB. */
  const makeLegacyWithoutPrimary = async (
    customerId: string,
    teamKeys: string[],
  ) => {
    await customers().updateOne(
      { _id: new Types.ObjectId(customerId) },
      {
        $set: {
          careTeam: [],
          primaryAssigneeId: null,
          teamIds: teamKeys.map((key) => new Types.ObjectId(ids[key])),
        },
      },
    );
  };

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-invite-${RUN_ID}:`;
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
    // Chỉ có role ADMIN: không có role Manager/Staff nên không được mời vào nhóm chăm sóc.
    await createUser('adminOnly', UserRole.ADMIN);
    await createUser('editor', UserRole.EDITOR);
    await createUser('manager1', UserRole.MANAGER);
    await createUser('manager2', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    await createUser('staffC', UserRole.STAFF);
    await createUser('staffD', UserRole.STAFF);
    await createUser('blockedStaff', UserRole.STAFF, {
      status: UserStatus.BLOCKED,
    });
    await createUser('deletedStaff', UserRole.STAFF, {
      deletedAt: new Date(),
    });
    for (const key of extraKeys) await createUser(key, UserRole.STAFF);

    ids.teamA = (
      await call('POST', '/teams', 'admin', {
        name: 'Nhóm A',
        code: 'TEAMA',
        managerIds: [ids.manager1],
      })
    ).body.data.id;
    ids.teamB = (
      await call('POST', '/teams', 'admin', {
        name: 'Nhóm B',
        code: 'TEAMB',
        managerIds: [ids.manager2],
      })
    ).body.data.id;
    for (const [user, team] of [
      ['manager1', 'teamA'],
      ['staffA', 'teamA'],
      ['staffB', 'teamA'],
      ['manager2', 'teamB'],
      ['staffC', 'teamB'],
    ]) {
      const res = await call('PATCH', `/users/${ids[user]}/team`, 'admin', {
        teamId: ids[team],
      });
      expect(res.status).toBe(200);
    }
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------------------------
  describe('Quản trị tạo khách: là PRIMARY nên teamIds rỗng; mời người nhóm khác thì teamIds mở rộng (FR-10, FR-13)', () => {
    let customerId: string;

    it('Quản trị tạo khách: careTeam = [Quản trị PRIMARY], primaryAssigneeId = Quản trị, teamIds = [] (Quản trị không thuộc nhóm nào)', async () => {
      customerId = await createCustomer('admin');
      expect(await careTeamOf(customerId)).toEqual([
        { userId: ids.admin, role: 'PRIMARY' },
      ]);
      expect(String((await customerDoc(customerId))!.primaryAssigneeId)).toBe(
        ids.admin,
      );
      expect(await teamIdsOf(customerId)).toEqual([]);
      // Chưa có ai thuộc nhóm nào => Quản lý không thấy khách (chỉ Quản trị thấy).
      expect(
        (await call('GET', `/crm/customers/${customerId}`, 'manager1')).status,
      ).toBe(404);
      expect(
        (await call('GET', `/crm/customers/${customerId}`, 'admin')).status,
      ).toBe(200);
    });

    it('Quản trị (PRIMARY) mời Nhân viên nhóm A: teamIds = [A] (PRIMARY Quản trị không đóng góp nhóm), Quản lý A thấy, Quản lý B không', async () => {
      const res = await invite(customerId, 'admin', ['staffA']);
      expect(res.status).toBe(201);
      expect(await teamIdsOf(customerId)).toEqual([ids.teamA]);
      expect(
        (await call('GET', `/crm/customers/${customerId}`, 'manager1')).status,
      ).toBe(200);
      expect(
        (await call('GET', `/crm/customers/${customerId}`, 'manager2')).status,
      ).toBe(404);
      expect(await careTeamOf(customerId)).toEqual([
        { userId: ids.admin, role: 'PRIMARY' },
        { userId: ids.staffA, role: 'MEMBER' },
      ]);
    });

    it('gỡ MEMBER duy nhất thuộc nhóm => teamIds về [] và Quản lý A mất quyền ngay; PRIMARY Quản trị vẫn bị khóa (409 PRIMARY_LOCKED)', async () => {
      const removed = await call(
        'DELETE',
        `/crm/customers/${customerId}/care-team/members/${ids.staffA}`,
        'admin',
      );
      expect(removed.status).toBe(200);
      expect(await teamIdsOf(customerId)).toEqual([]);
      expect(
        (await call('GET', `/crm/customers/${customerId}`, 'manager1')).status,
      ).toBe(404);

      const locked = await call(
        'DELETE',
        `/crm/customers/${customerId}/care-team/members/${ids.admin}`,
        'admin',
      );
      expect([locked.status, locked.body.errorCode]).toEqual([
        409,
        'PRIMARY_LOCKED',
      ]);
      expect(await careTeamOf(customerId)).toEqual([
        { userId: ids.admin, role: 'PRIMARY' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Khách cũ chưa có PRIMARY: Quản trị/Quản lý đặt đúng MỘT lần rồi khóa (FR-11)', () => {
    it('Quản trị: thiếu primaryUserId => 400 PRIMARY_REQUIRED; primaryUserId không hợp lệ => 400 USER_NOT_ASSIGNABLE; không ghi gì', async () => {
      const id = await createCustomer('staffA');
      await makeLegacyWithoutPrimary(id, ['teamA']);

      const missing = await invite(id, 'admin', ['staffB']);
      expect([missing.status, missing.body.errorCode]).toEqual([
        400,
        'PRIMARY_REQUIRED',
      ]);
      // `userIds` luôn phải có ít nhất 1 người (DTO): không gửi được lời mời rỗng chỉ để đặt PRIMARY.
      const emptyInvite = await invite(id, 'admin', [], {
        primaryUserId: ids.staffB,
      });
      expect([emptyInvite.status, emptyInvite.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      for (const key of ['blockedStaff', 'adminOnly', 'editor']) {
        const bad = await invite(id, 'admin', ['staffC'], {
          primaryUserId: ids[key],
        });
        expect([key, bad.status, bad.body.errorCode]).toEqual([
          key,
          400,
          'USER_NOT_ASSIGNABLE',
        ]);
      }
      expect(await careTeamOf(id)).toEqual([]);
      expect((await customerDoc(id))!.primaryAssigneeId).toBeNull();
    });

    it('Quản trị đặt PRIMARY lần đầu => 201 và primaryAssigneeId khớp; sau đó khóa: đặt lại 400, gỡ 409 PRIMARY_LOCKED, PUT primary 404', async () => {
      const id = await createCustomer('staffA');
      await makeLegacyWithoutPrimary(id, ['teamA']);

      const first = await invite(id, 'admin', ['staffC'], {
        primaryUserId: ids.staffB,
      });
      expect(first.status).toBe(201);
      expect(first.body.data.primary.id).toBe(ids.staffB);
      expect(await careTeamOf(id)).toEqual(
        expect.arrayContaining([
          { userId: ids.staffB, role: 'PRIMARY' },
          { userId: ids.staffC, role: 'MEMBER' },
        ]),
      );
      expect(String((await customerDoc(id))!.primaryAssigneeId)).toBe(
        ids.staffB,
      );

      // Đã có PRIMARY: không đặt/đổi nữa (kể cả Quản trị).
      const again = await invite(id, 'admin', ['staffD'], {
        primaryUserId: ids.staffD,
      });
      expect([again.status, again.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      for (const who of ['admin', 'manager1', 'staffB']) {
        const removed = await call(
          'DELETE',
          `/crm/customers/${id}/care-team/members/${ids.staffB}`,
          who,
        );
        expect([who, removed.status, removed.body.errorCode]).toEqual([
          who,
          409,
          'PRIMARY_LOCKED',
        ]);
      }
      const put = await call(
        'PUT',
        `/crm/customers/${id}/care-team/primary`,
        'admin',
        { userId: ids.staffC },
      );
      expect(put.status).toBe(404);
      expect(String((await customerDoc(id))!.primaryAssigneeId)).toBe(
        ids.staffB,
      );
      // Chỉ đúng MỘT audit PRIMARY_CHANGED (lần đặt đầu tiên null -> staffB); các thao tác bị khóa không ghi thêm.
      const primaryAudits = await auditOf(id, 'PRIMARY_CHANGED');
      expect(primaryAudits).toHaveLength(1);
      expect(primaryAudits[0].changes).toEqual([
        { field: 'primaryAssignee', from: null, to: 'staffB' },
      ]);
    });

    it('Quản lý nhóm A (khách thuộc nhóm A) đặt PRIMARY lần đầu => 201; Quản lý nhóm B không thấy khách => 404; Nhân viên không thấy khách chưa có nhóm => 404', async () => {
      const id = await createCustomer('staffA');
      await makeLegacyWithoutPrimary(id, ['teamA']);

      expect(
        (
          await invite(id, 'manager2', ['staffC'], {
            primaryUserId: ids.staffC,
          })
        ).status,
      ).toBe(404);
      expect((await invite(id, 'staffB', ['staffD'])).status).toBe(404);

      const set = await invite(id, 'manager1', ['staffB'], {
        primaryUserId: ids.staffA,
      });
      expect(set.status).toBe(201);
      expect(await careTeamOf(id)).toEqual(
        expect.arrayContaining([
          { userId: ids.staffA, role: 'PRIMARY' },
          { userId: ids.staffB, role: 'MEMBER' },
        ]),
      );
      const locked = await call(
        'DELETE',
        `/crm/customers/${id}/care-team/members/${ids.staffA}`,
        'manager1',
      );
      expect([locked.status, locked.body.errorCode]).toEqual([
        409,
        'PRIMARY_LOCKED',
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Mời người ngoài nhóm; thành viên phụ không tự rời (FR-13, FR-16)', () => {
    let customerId: string;

    it('Nhân viên PRIMARY (nhóm A) mời Nhân viên nhóm B => 201, người được mời là MEMBER, teamIds = {A, B}', async () => {
      customerId = await createCustomer('staffA');
      expect(await teamIdsOf(customerId)).toEqual([ids.teamA]);

      const res = await invite(customerId, 'staffA', ['staffC']);
      expect(res.status).toBe(201);
      expect(res.body.data.primary.id).toBe(ids.staffA);
      expect(await careTeamOf(customerId)).toEqual([
        { userId: ids.staffA, role: 'PRIMARY' },
        { userId: ids.staffC, role: 'MEMBER' },
      ]);
      expect(await teamIdsOf(customerId)).toEqual(
        sorted([ids.teamA, ids.teamB]),
      );
    });

    it('Quản lý nhóm của người được mời (B) thấy khách ở chi tiết, nhóm chăm sóc và danh sách; Quản lý nhóm A vẫn thấy', async () => {
      expect(
        (await call('GET', `/crm/customers/${customerId}`, 'manager2')).status,
      ).toBe(200);
      expect(
        (await call('GET', `/crm/customers/${customerId}/care-team`, 'manager2'))
          .status,
      ).toBe(200);
      const list = await call('GET', '/crm/customers?limit=100', 'manager2');
      expect(list.body.data.map((item: any) => item.id)).toContain(customerId);
      expect(
        (await call('GET', `/crm/customers/${customerId}`, 'manager1')).status,
      ).toBe(200);
    });

    it('mời người chưa thuộc nhóm nào (staffD) => 201 và teamIds KHÔNG đổi', async () => {
      const before = await teamIdsOf(customerId);
      const res = await invite(customerId, 'staffA', ['staffD']);
      expect(res.status).toBe(201);
      expect(await teamIdsOf(customerId)).toEqual(before);
    });

    it('thành viên phụ (staffC) xem được khách nhưng không mời được ai (403) và không tự rời (403); vẫn còn trong nhóm, không có audit gỡ', async () => {
      expect(
        (await call('GET', `/crm/customers/${customerId}`, 'staffC')).status,
      ).toBe(200);
      const inviteByMember = await invite(customerId, 'staffC', ['staffB']);
      expect([inviteByMember.status, inviteByMember.body.errorCode]).toEqual([
        403,
        'CARE_TEAM_ACTION_FORBIDDEN',
      ]);
      const selfRemove = await call(
        'DELETE',
        `/crm/customers/${customerId}/care-team/members/${ids.staffC}`,
        'staffC',
      );
      expect([selfRemove.status, selfRemove.body.errorCode]).toEqual([
        403,
        'CARE_TEAM_ACTION_FORBIDDEN',
      ]);
      expect((await careTeamOf(customerId)).map((m) => m.userId)).toContain(
        ids.staffC,
      );
      expect(await auditOf(customerId, 'CARE_TEAM_MEMBER_REMOVED')).toHaveLength(
        0,
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Người không được mời: BLOCKED, chỉ-Quản-trị, EDITOR, đã xóa mềm, không tồn tại => 400 USER_NOT_ASSIGNABLE (cả lô)', () => {
    it('từng loại bị từ chối; lô trộn người hợp lệ + không hợp lệ bị từ chối cả lô (không ai được thêm, không audit, không thông báo)', async () => {
      const id = await createCustomer('staffA');
      const ghost = new Types.ObjectId().toHexString();
      for (const key of [
        'blockedStaff',
        'adminOnly',
        'editor',
        'deletedStaff',
      ]) {
        const res = await invite(id, 'staffA', [key]);
        expect([key, res.status, res.body.errorCode]).toEqual([
          key,
          400,
          'USER_NOT_ASSIGNABLE',
        ]);
      }
      const unknown = await call(
        'POST',
        `/crm/customers/${id}/care-team/members`,
        'staffA',
        { userIds: [ghost] },
      );
      expect([unknown.status, unknown.body.errorCode]).toEqual([
        400,
        'USER_NOT_ASSIGNABLE',
      ]);

      const mixed = await invite(id, 'staffA', ['staffB', 'blockedStaff']);
      expect([mixed.status, mixed.body.errorCode]).toEqual([
        400,
        'USER_NOT_ASSIGNABLE',
      ]);
      expect(await careTeamOf(id)).toEqual([
        { userId: ids.staffA, role: 'PRIMARY' },
      ]);
      expect(await auditOf(id, 'CARE_TEAM_MEMBER_ADDED')).toHaveLength(0);
      expect(await assignedNotifications(id, 'staffB')).toHaveLength(0);
    });

    it('bulk ASSIGN cũng từ chối người BLOCKED/chỉ-Quản-trị theo từng khách (USER_NOT_ASSIGNABLE) và không ghi', async () => {
      const id = await createCustomer('staffA');
      for (const key of ['blockedStaff', 'adminOnly']) {
        const res = await call('POST', '/crm/customer-bulk-operations', 'admin', {
          type: 'ASSIGN',
          customerIds: [id],
          payload: { memberIds: [ids[key]] },
        });
        expect([key, res.status]).toEqual([key, 200]);
        expect(res.body.data.failed).toEqual([
          { customerId: id, errorCode: 'USER_NOT_ASSIGNABLE' },
        ]);
      }
      expect(await careTeamOf(id)).toEqual([
        { userId: ids.staffA, role: 'PRIMARY' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Giới hạn 10 thành viên phụ (FR-17)', () => {
    const firstTen = extraKeys.slice(0, MEMBER_LIMIT);

    it('mời đủ 10 MEMBER (PRIMARY không tính) => 201; người thứ 11 => 409 CARE_TEAM_LIMIT_EXCEEDED và nhóm không đổi', async () => {
      const id = await createCustomer('staffA');
      const ok = await invite(id, 'staffA', firstTen);
      expect(ok.status).toBe(201);
      const team = await careTeamOf(id);
      expect(team).toHaveLength(MEMBER_LIMIT + 1);
      expect(team.filter((member) => member.role === 'PRIMARY')).toHaveLength(1);

      const over = await invite(id, 'staffA', [extraKeys[MEMBER_LIMIT]]);
      expect([over.status, over.body.errorCode]).toEqual([
        409,
        'CARE_TEAM_LIMIT_EXCEEDED',
      ]);
      expect(await careTeamOf(id)).toHaveLength(MEMBER_LIMIT + 1);

      // Gỡ một MEMBER thì mời lại được (giới hạn tính trên số hiện có).
      const removed = await call(
        'DELETE',
        `/crm/customers/${id}/care-team/members/${ids[firstTen[0]]}`,
        'admin',
      );
      expect(removed.status).toBe(200);
      expect(
        (await invite(id, 'staffA', [extraKeys[MEMBER_LIMIT]])).status,
      ).toBe(201);
    });

    it('lô vượt giới hạn bị từ chối cả lô: nhóm đang 9 MEMBER, mời 2 người => 409 và không ai được thêm', async () => {
      const id = await createCustomer('staffA');
      expect(
        (await invite(id, 'staffA', extraKeys.slice(0, MEMBER_LIMIT - 1))).status,
      ).toBe(201);
      const batch = await invite(id, 'staffA', [
        extraKeys[MEMBER_LIMIT - 1],
        extraKeys[MEMBER_LIMIT],
      ]);
      expect([batch.status, batch.body.errorCode]).toEqual([
        409,
        'CARE_TEAM_LIMIT_EXCEEDED',
      ]);
      expect(await careTeamOf(id)).toHaveLength(MEMBER_LIMIT);
    });

    it('khách cũ đã quá 10 MEMBER (dữ liệu trước v1.0.5): chặn thêm (409) nhưng vẫn gỡ được, không bị ép cắt', async () => {
      const id = await createCustomer('staffA');
      const now = new Date();
      const legacyMembers = extraKeys.slice(0, MEMBER_LIMIT + 1).map((key) => ({
        userId: new Types.ObjectId(ids[key]),
        role: 'MEMBER',
        addedBy: new Types.ObjectId(ids.staffA),
        addedAt: now,
      }));
      await customers().updateOne(
        { _id: new Types.ObjectId(id) },
        { $push: { careTeam: { $each: legacyMembers } } as never },
      );
      expect(await careTeamOf(id)).toHaveLength(MEMBER_LIMIT + 2);

      const add = await invite(id, 'admin', ['staffB']);
      expect([add.status, add.body.errorCode]).toEqual([
        409,
        'CARE_TEAM_LIMIT_EXCEEDED',
      ]);
      const remove = await call(
        'DELETE',
        `/crm/customers/${id}/care-team/members/${ids[extraKeys[0]]}`,
        'admin',
      );
      expect(remove.status).toBe(200);
      // Vẫn còn đúng số còn lại (không ép cắt về 10).
      expect(await careTeamOf(id)).toHaveLength(MEMBER_LIMIT + 1);
    });

    it('bulk ASSIGN áp giới hạn 10 TỪNG khách (khách đầy báo CARE_TEAM_LIMIT_EXCEEDED, khách còn chỗ vẫn thành công)', async () => {
      const full = await createCustomer('staffA');
      const roomy = await createCustomer('staffA');
      expect((await invite(full, 'staffA', firstTen)).status).toBe(201);

      const res = await call('POST', '/crm/customer-bulk-operations', 'admin', {
        type: 'ASSIGN',
        customerIds: [full, roomy],
        payload: { memberIds: [ids.staffB] },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual([roomy]);
      expect(res.body.data.failed).toEqual([
        { customerId: full, errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Bulk ASSIGN chỉ thêm MEMBER (FR-11)', () => {
    it('người được thêm là MEMBER, PRIMARY giữ nguyên; truyền primaryUserId => 400 cả lô; khách cũ chưa có PRIMARY báo PRIMARY_REQUIRED riêng khách đó', async () => {
      const normal = await createCustomer('staffA');
      const legacy = await createCustomer('staffA');
      await makeLegacyWithoutPrimary(legacy, ['teamA']);

      const res = await call('POST', '/crm/customer-bulk-operations', 'admin', {
        type: 'ASSIGN',
        customerIds: [normal, legacy],
        payload: { memberIds: [ids.staffB] },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual([normal]);
      expect(res.body.data.failed).toEqual([
        { customerId: legacy, errorCode: 'PRIMARY_REQUIRED' },
      ]);
      expect(await careTeamOf(normal)).toEqual([
        { userId: ids.staffA, role: 'PRIMARY' },
        { userId: ids.staffB, role: 'MEMBER' },
      ]);
      expect(await careTeamOf(legacy)).toEqual([]);

      const withPrimary = await call(
        'POST',
        '/crm/customer-bulk-operations',
        'admin',
        {
          type: 'ASSIGN',
          customerIds: [normal],
          payload: { memberIds: [ids.staffC], primaryUserId: ids.staffC },
        },
      );
      expect([withPrimary.status, withPrimary.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect(String((await customerDoc(normal))!.primaryAssigneeId)).toBe(
        ids.staffA,
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Thông báo CUSTOMER_ASSIGNED: người được mời nhận, người mời và người BLOCKED không nhận (FR-16, FR-18)', () => {
    it('mời staffB: đúng 1 thông báo cho staffB (MEMBER, ưu tiên NORMAL, deepLink tới khách), người mời staffA không nhận', async () => {
      const id = await createCustomer('staffA');
      expect((await invite(id, 'staffA', ['staffB'])).status).toBe(201);
      const toB = await assignedNotifications(id, 'staffB');
      expect(toB).toHaveLength(1);
      expect(toB[0]).toMatchObject({
        priority: 'NORMAL',
        readAt: null,
        data: { deepLink: `/crm/customers/${id}` },
      });
      expect(await assignedNotifications(id, 'staffA')).toHaveLength(0);
    });

    it('người BLOCKED không nhận CUSTOMER_ASSIGNED ngay cả khi lớp kiểm tra mời bị vô hiệu (lọc ACTIVE ở điểm gửi thông báo chung); người ACTIVE cùng lô vẫn nhận', async () => {
      const id = await createCustomer('staffA');
      const spy = jest
        .spyOn(app.get(CareTeamAssigneesService), 'assertAssignable')
        .mockImplementation(() => undefined);
      try {
        const res = await invite(id, 'staffA', ['staffC', 'blockedStaff']);
        expect(res.status).toBe(201);
      } finally {
        spy.mockRestore();
      }
      expect(await assignedNotifications(id, 'staffC')).toHaveLength(1);
      expect(await assignedNotifications(id, 'blockedStaff')).toHaveLength(0);
      expect(
        await connection.collection('notifications').countDocuments({
          userId: new Types.ObjectId(ids.blockedStaff),
          'data.customerId': new Types.ObjectId(id),
        }),
      ).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Việc hằng ngày hiện cho MEMBER khi PRIMARY bị BLOCKED hoặc chưa có PRIMARY (FR-19)', () => {
    const tasksOf = async (as: string, customerId: string) => {
      const res = await call(
        'GET',
        '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
        as,
      );
      expect(res.status).toBe(200);
      return res.body.data.filter((task: any) => task.customer.id === customerId);
    };

    it('PRIMARY (staffA) bị BLOCKED: MEMBER (staffB) vẫn thấy lịch hẹn của khách, isPrimary = false', async () => {
      const id = await createCustomer('staffA');
      expect((await invite(id, 'staffA', ['staffB'])).status).toBe(201);
      const created = await call('POST', '/crm/appointments', 'staffA', {
        customerId: id,
        type: 'SITE_VISIT',
        startAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
      });
      expect(created.status).toBe(201);

      await userModel.updateOne(
        { _id: ids.staffA },
        { $set: { status: UserStatus.BLOCKED } },
      );
      try {
        const tasks = await tasksOf('staffB', id);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
          kind: 'APPOINTMENT',
          appointmentId: created.body.data.id,
          isPrimary: false,
        });
      } finally {
        await userModel.updateOne(
          { _id: ids.staffA },
          { $set: { status: UserStatus.ACTIVE } },
        );
      }
    });

    it('khách cũ chưa có PRIMARY (primaryAssigneeId = null, chỉ có MEMBER): MEMBER vẫn thấy lịch hẹn; người ngoài nhóm không thấy', async () => {
      const id = await createCustomer('staffA');
      expect((await invite(id, 'staffA', ['staffB'])).status).toBe(201);
      const created = await call('POST', '/crm/appointments', 'staffB', {
        customerId: id,
        type: 'SITE_VISIT',
        startAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
      });
      expect(created.status).toBe(201);
      // Bỏ PRIMARY bằng DB (chỉ khách cũ mới có dạng này): còn đúng một MEMBER.
      await customers().updateOne(
        { _id: new Types.ObjectId(id) },
        {
          $set: { primaryAssigneeId: null },
          $pull: { careTeam: { userId: new Types.ObjectId(ids.staffA) } } as never,
        },
      );
      expect(await careTeamOf(id)).toEqual([
        { userId: ids.staffB, role: 'MEMBER' },
      ]);

      const mine = await tasksOf('staffB', id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        appointmentId: created.body.data.id,
        isPrimary: false,
      });
      expect(await tasksOf('staffD', id)).toEqual([]);
    });
  });
});
