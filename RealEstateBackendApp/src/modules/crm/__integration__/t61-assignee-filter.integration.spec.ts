/**
 * INTEGRATION — T-61 (FR-30): lọc lịch hẹn theo người thực hiện (`assigneeFilter`) ở HAI nơi (danh sách lịch hẹn
 * `GET /crm/appointments?assigneeIds=` và việc hằng ngày `GET /crm/daily-tasks?scope=mine`) trên dữ liệu ba kiểu:
 *  (a) lịch CŨ chưa backfill 012 (chỉ có `assigneeId`, không có khóa `assigneeIds`),
 *  (b) lịch đã backfill / do BE mới ghi kép (`assigneeIds` + `assigneeId` = phần tử đầu),
 *  (c) lịch có `assigneeIds` KHÔNG chứa người lọc nhưng `assigneeId` cũ lại trùng người lọc => KHÔNG được trả
 *      (`assigneeIds` đã có thì là nguồn thật, nhánh `$exists:false` không được khớp).
 * Cộng thêm: lọc nhiều id kết hợp `projectCode` ($and với bộ lọc dự án vì cùng dùng khóa `$or`), và hai index mới
 * (`appointments { assigneeIds:1, startAt:1 }`, `customers { createdBy:1, deletedAt:1, lastUpdatedAt:-1 }`) có THẬT trên DB.
 * MongoDB Replica Set GIẢ của mongodb-memory-server (không phải MongoDB thật).
 *
 * Chạy: npx jest --testPathIgnorePatterns "/node_modules/" --testRegex "t61-assignee-filter.integration.spec.ts$" --runInBand
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

interface Res {
  status: number;
  body: any;
}

describe('CRM T-61 — lọc lịch hẹn theo người thực hiện (assigneeFilter) và index mới (FR-30)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const col = (name: string) => connection.collection(name);
  const oid = (value: string) => new Types.ObjectId(value);
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
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };

  const createUser = async (key: string, role: UserRole) => {
    const user = await userModel.create({
      email: `${key}@test.vn`,
      password: 'hash',
      displayName: key,
      role,
      status: UserStatus.ACTIVE,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({ sub: ids[key], email: user.email, role });
  };

  let seq = 0;
  /** Khách có careTeam gồm staffA (PRIMARY), staffB, staffC (MEMBER) để cả ba được giao lịch hợp lệ. */
  const createCustomer = async (): Promise<string> => {
    const phone = `097${String(1_000_000 + ++seq)}`;
    const res = await call('POST', '/crm/customers', 'admin', {
      fullName: `Khách T61F ${phone}`,
      phone,
    });
    expect([res.status, res.body?.message]).toEqual([201, undefined]);
    // Dựng thẳng careTeam: staffA PRIMARY, staffB và staffC MEMBER (đường API chỉ thêm MEMBER, không đặt PRIMARY ban đầu cho Admin ở đây).
    const members: Array<[string, 'PRIMARY' | 'MEMBER']> = [
      ['staffA', 'PRIMARY'],
      ['staffB', 'MEMBER'],
      ['staffC', 'MEMBER'],
    ];
    await col('customers').updateOne(
      { _id: oid(String(res.body.data.id)) },
      {
        $set: {
          careTeam: members.map(([key, role]) => ({
            userId: oid(ids[key]),
            role,
            addedAt: new Date(),
            addedBy: oid(ids.admin),
          })),
          primaryAssigneeId: oid(ids.staffA),
        },
      },
    );
    return res.body.data.id;
  };

  const create = async (
    customerId: string,
    assigneeKeys: string[],
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await call('POST', '/crm/appointments', 'admin', {
      customerId,
      type: 'SITE_VISIT',
      startAt: inDays(1),
      assigneeIds: assigneeKeys.map((key) => ids[key]),
      ...extra,
    });
    expect([res.status, res.body?.message]).toEqual([201, undefined]);
    return res.body.data.id;
  };

  const range = () =>
    `from=${inDays(-1).slice(0, 10)}&to=${inDays(10).slice(0, 10)}&limit=100`;
  const listIds = async (query: string, as = 'admin') => {
    const res = await call('GET', `/crm/appointments?${range()}&${query}`, as);
    expect([as, query, res.status]).toEqual([as, query, 200]);
    return (res.body.data as Array<{ id: string }>).map((row) => row.id).sort();
  };
  const sorted = (...values: string[]) => [...values].sort();
  const keys = (...users: string[]) => users.map((u) => ids[u]).join(',');

  beforeAll(async () => {
    process.env.CRM_ENABLED = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-t61-filter-${RUN_ID}:`;
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
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
    await createUser('staffC', UserRole.STAFF);
    await createUser('staffD', UserRole.STAFF);
  });

  afterAll(async () => {
    delete process.env.CRM_ENABLED;
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  describe('index mới có THẬT trên DB (autoIndex)', () => {
    it('appointments { assigneeIds:1, startAt:1 } và customers { createdBy:1, deletedAt:1, lastUpdatedAt:-1 }; index cũ { assigneeId, startAt } còn', async () => {
      const appointments = (await col('appointments').indexes()).map(
        (index) => index.key,
      );
      expect(appointments).toContainEqual({ assigneeIds: 1, startAt: 1 });
      expect(appointments).toContainEqual({ assigneeId: 1, startAt: 1 });
      expect(
        (await col('customers').indexes()).map((index) => index.key),
      ).toContainEqual({
        createdBy: 1,
        deletedAt: 1,
        lastUpdatedAt: -1,
      });
    });
  });

  describe('danh sách lịch hẹn: assigneeFilter trên dữ liệu chưa backfill, đã backfill và lệch', () => {
    let customerId: string;
    let unbackfilledA: string;
    let unbackfilledB: string;
    let backfilledAB: string;
    let backfilledC: string;
    let mismatch: string;
    let unassignedLegacy: string;

    beforeAll(async () => {
      customerId = await createCustomer();
      // (b) đã ghi kép
      backfilledAB = await create(customerId, ['staffA', 'staffB']);
      backfilledC = await create(customerId, ['staffC']);
      // (a) lịch cũ: bỏ hẳn khóa assigneeIds (chỉ còn assigneeId)
      unbackfilledA = await create(customerId, ['staffA']);
      unbackfilledB = await create(customerId, ['staffB']);
      await col('appointments').updateMany(
        { _id: { $in: [oid(unbackfilledA), oid(unbackfilledB)] } },
        { $unset: { assigneeIds: '' } },
      );
      // (c) assigneeIds = [staffB] nhưng assigneeId cũ = staffA (lệch): nguồn thật là assigneeIds
      mismatch = await create(customerId, ['staffB']);
      await col('appointments').updateOne(
        { _id: oid(mismatch) },
        { $set: { assigneeId: oid(ids.staffA) } },
      );
      // lịch cũ không có người thực hiện nào
      unassignedLegacy = await create(customerId, ['staffC']);
      await col('appointments').updateOne(
        { _id: oid(unassignedLegacy) },
        { $unset: { assigneeIds: '', assigneeId: '' } },
      );
    });

    it('xác nhận dữ liệu dựng: lịch cũ chưa có khóa assigneeIds, lịch mới ghi kép assigneeId = phần tử đầu', async () => {
      const legacy = await col('appointments').findOne({
        _id: oid(unbackfilledA),
      });
      expect('assigneeIds' in legacy!).toBe(false);
      expect(String(legacy!.assigneeId)).toBe(ids.staffA);
      const dual = await col('appointments').findOne({
        _id: oid(backfilledAB),
      });
      expect(dual!.assigneeIds.map(String)).toEqual([ids.staffA, ids.staffB]);
      expect(String(dual!.assigneeId)).toBe(ids.staffA);
    });

    it('(a)(b) một id: trả cả lịch cũ chưa backfill lẫn lịch đã backfill; (c) lịch lệch KHÔNG trả khi người lọc chỉ trùng assigneeId cũ', async () => {
      expect(await listIds(`assigneeIds=${ids.staffA}`)).toEqual(
        sorted(backfilledAB, unbackfilledA),
      );
      expect(await listIds(`assigneeIds=${ids.staffA}`)).not.toContain(
        mismatch,
      );
    });

    it('(b)(c) một id khác: lịch lệch trả theo assigneeIds (staffB), lịch cũ của staffB vẫn trả', async () => {
      expect(await listIds(`assigneeIds=${ids.staffB}`)).toEqual(
        sorted(backfilledAB, unbackfilledB, mismatch),
      );
    });

    it('(a) nhiều id (phẩy): hợp của các tập, mỗi lịch một lần (không lặp)', async () => {
      const result = await listIds(`assigneeIds=${keys('staffA', 'staffB')}`);
      expect(result).toEqual(
        sorted(backfilledAB, unbackfilledA, unbackfilledB, mismatch),
      );
      expect(new Set(result).size).toBe(result.length);
      expect(await listIds(`assigneeIds=${keys('staffC')}`)).toEqual(
        sorted(backfilledC),
      );
    });

    it('người không có lịch nào: danh sách rỗng; lịch không người thực hiện không khớp bất kỳ ai', async () => {
      expect(await listIds(`assigneeIds=${ids.staffD}`)).toEqual([]);
      for (const user of ['staffA', 'staffB', 'staffC']) {
        expect(await listIds(`assigneeIds=${ids[user]}`)).not.toContain(
          unassignedLegacy,
        );
      }
    });

    it('không lọc assigneeIds: trả mọi lịch (kể cả lịch cũ chưa backfill và lịch không người thực hiện), tổng khớp meta.total', async () => {
      const res = await call('GET', `/crm/appointments?${range()}`, 'admin');
      expect(res.status).toBe(200);
      expect(
        (res.body.data as Array<{ id: string }>).map((row) => row.id).sort(),
      ).toEqual(
        sorted(
          backfilledAB,
          backfilledC,
          unbackfilledA,
          unbackfilledB,
          mismatch,
          unassignedLegacy,
        ),
      );
      expect(res.body.meta.total).toBe(6);
    });

    it('(d) nhiều assigneeIds + projectCode: giao của hai điều kiện (cả hai cùng dùng khóa $or, gộp bằng $and), kể cả lịch cũ chưa backfill', async () => {
      const projectRes = await call('POST', '/crm/projects', 'admin', {
        name: 'Dự án lọc T61',
        code: 'T61FILTER',
      });
      expect(projectRes.status).toBe(201);
      const inProject = await create(customerId, ['staffA', 'staffC'], {
        projectCode: 'T61FILTER',
      });
      const legacyInProject = await create(customerId, ['staffB'], {
        projectCode: 'T61FILTER',
      });
      await col('appointments').updateOne(
        { _id: oid(legacyInProject) },
        { $unset: { assigneeIds: '' } },
      );
      const otherAssigneeInProject = await create(customerId, ['staffC'], {
        projectCode: 'T61FILTER',
      });

      const both = await listIds(
        `assigneeIds=${keys('staffA', 'staffB')}&projectCode=t61filter`,
      );
      // staffA|staffB trong dự án: inProject (staffA), legacyInProject (staffB cũ). Lịch staffC-only trong dự án KHÔNG khớp;
      // lịch staffA/staffB ngoài dự án KHÔNG khớp.
      expect(both).toEqual(sorted(inProject, legacyInProject));
      expect(both).not.toContain(otherAssigneeInProject);
      expect(both).not.toContain(backfilledAB);
      expect(await listIds('projectCode=T61FILTER')).toEqual(
        sorted(inProject, legacyInProject, otherAssigneeInProject),
      );
    });
  });

  describe('việc hằng ngày (scope=mine): cùng assigneeFilter, lịch cũ chưa backfill vẫn của người thực hiện', () => {
    it('staffD không phải thành viên careTeam: chỉ thấy lịch mình là người thực hiện (đã backfill hoặc lịch cũ); không thấy lịch lệch assigneeIds', async () => {
      // careTeam = staffA/B/C, staffD CHỈ là người thực hiện qua dữ liệu dựng tay (không qua kiểm tập hợp lệ).
      const customerId = await createCustomer();
      const dual = await create(customerId, ['staffA']);
      const legacy = await create(customerId, ['staffA']);
      const mismatch = await create(customerId, ['staffA']);
      await col('appointments').updateOne(
        { _id: oid(dual) },
        {
          $set: { assigneeIds: [oid(ids.staffD)], assigneeId: oid(ids.staffD) },
        },
      );
      await col('appointments').updateOne(
        { _id: oid(legacy) },
        { $unset: { assigneeIds: '' }, $set: { assigneeId: oid(ids.staffD) } },
      );
      // assigneeIds=[staffA], assigneeId cũ = staffD (lệch): staffD KHÔNG phải người thực hiện
      await col('appointments').updateOne(
        { _id: oid(mismatch) },
        { $set: { assigneeId: oid(ids.staffD) } },
      );
      // Khách của staffD: Admin đặt staffD vào careTeam sẽ làm staffD "nhóm chăm sóc"; vì vậy gỡ staffD khỏi careTeam
      // của khách này (staffD chưa từng vào) và cấp cho staffD quyền xem khách qua createdBy để qua customerScope.
      await col('customers').updateOne(
        { _id: oid(customerId) },
        { $set: { createdBy: oid(ids.staffD) } },
      );

      const res = await call(
        'GET',
        '/crm/daily-tasks?kinds=APPOINTMENT&limit=100',
        'staffD',
      );
      expect(res.status).toBe(200);
      const appointmentIds = (
        res.body.data as Array<{ appointmentId?: string }>
      )
        .map((row) => row.appointmentId)
        .filter((value): value is string => Boolean(value))
        .sort();
      expect(appointmentIds).toEqual(sorted(dual, legacy));
      expect(appointmentIds).not.toContain(mismatch);
    });
  });
});
