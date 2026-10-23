/**
 * KIỂM TẢI SƠ BỘ — CRM M2: seed 10.000 khách vào MongoDB Replica Set (mongodb-memory-server, KHÔNG đụng DB thật)
 * rồi đo độ trễ HTTP (Fastify inject, cả guard + ValidationPipe + truy vấn + dựng response) của danh sách / đếm tab /
 * chi tiết theo 3 vai trò (Quản trị thấy 10k, Quản lý ~vài nghìn, Nhân viên ~vài trăm).
 *
 * Ngưỡng tài liệu 04 mục 7.1: danh sách p95 < 300 ms, list-counts p95 < 150 ms, chi tiết p95 < 200 ms.
 * Kết quả được in ra bảng ở cuối để đưa vào báo cáo milestone. Chạy bằng `npm run test:integration`.
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
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type Redis from 'ioredis';
import { Connection, Model, Types } from 'mongoose';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { buildSearchText } from './customers/utils/customer-search.util';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(600_000);

const TOTAL_CUSTOMERS = 10_000;
const TEAM_COUNT = 5;
const STAFF_PER_TEAM = 10;
const SAMPLES = 60;
/**
 * Tìm theo 4 số cuối đổi từ khóa mỗi lần nên chạm rate limit 30 lần/phút/người (đúng thiết kế). Để lấy đủ mẫu
 * (p95 của quá ít mẫu suy biến thành max), test xóa bộ đếm rate limit của chính người đó trước mỗi mẫu.
 */
const SEARCH_SAMPLES = 40;
/**
 * Mục tiêu trong tài liệu (300/150/200 ms) đo trên máy rảnh. Test chạy Mongo in-memory cùng CPU với các suite khác
 * nên ngưỡng ASSERT nới gấp đôi để không đỏ giả khi máy tải; bảng báo cáo vẫn in mục tiêu thật để so sánh.
 */
const ASSERT_FACTOR = Number(process.env.PERF_ASSERT_FACTOR ?? 1);

const FIRST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Đặng', 'Đỗ', 'Vũ'];
const MIDDLE = ['Văn', 'Thị', 'Minh', 'Quốc', 'Hữu', 'Ngọc', 'Thanh', 'Đức'];
const LAST = [
  'An',
  'Bình',
  'Cường',
  'Dũng',
  'Hà',
  'Hạnh',
  'Khoa',
  'Lan',
  'Mai',
];

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};

describe('CRM M2 — kiểm tải sơ bộ danh sách trên 10.000 khách', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const report: Array<Record<string, string | number>> = [];
  let sampleCustomerIds: Record<string, string> = {};

  const timed = async (url: string, as: string): Promise<number> => {
    const start = process.hrtime.bigint();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${tokens[as]}` },
    });
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    expect(res.statusCode).toBe(200);
    return elapsed;
  };

  const measure = async (
    name: string,
    urlFor: (as: string, index: number) => string,
    roles: string[],
    thresholdMs: number,
    sampleCount = SAMPLES,
    resetSearchLimit = false,
  ) => {
    for (const role of roles) {
      await timed(urlFor(role, 0), role); // làm nóng
      const samples: number[] = [];
      for (let i = 0; i < sampleCount; i += 1) {
        if (resetSearchLimit) {
          await app
            .get<Redis>(REDIS_CLIENT)
            .del(`crm:rl:CUSTOMER_SEARCH:${userIds[role]}`);
        }
        samples.push(await timed(urlFor(role, i), role));
      }
      const p95 = percentile(samples, 0.95);
      report.push({
        'Kịch bản': name,
        'Vai trò': role,
        'p50 (ms)': Math.round(percentile(samples, 0.5)),
        'p95 (ms)': Math.round(p95),
        'max (ms)': Math.round(Math.max(...samples)),
        'Ngưỡng p95 (ms)': thresholdMs,
      });
      expect([name, role, p95 < thresholdMs * ASSERT_FACTOR]).toEqual([
        name,
        role,
        true,
      ]);
    }
  };

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-perf-${randomUUID().slice(0, 8)}:`;
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: 'integration-secret' }),
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

    // --- Người dùng + nhóm ---
    const mkUser = (key: string, role: UserRole, teamId?: Types.ObjectId) => ({
      _id: new Types.ObjectId(),
      email: `${key}@perf.vn`,
      password: 'x',
      displayName: key,
      role,
      status: UserStatus.ACTIVE,
      teamId: teamId ?? null,
      deletedAt: null,
    });
    const teamIds = Array.from(
      { length: TEAM_COUNT },
      () => new Types.ObjectId(),
    );
    const admin = mkUser('admin', UserRole.ADMIN);
    const managers = teamIds.map((teamId, index) =>
      mkUser(`manager${index}`, UserRole.MANAGER, teamId),
    );
    const staff = teamIds.flatMap((teamId, teamIndex) =>
      Array.from({ length: STAFF_PER_TEAM }, (_, index) =>
        mkUser(`staff${teamIndex}_${index}`, UserRole.STAFF, teamId),
      ),
    );
    await userModel.collection.insertMany([admin, ...managers, ...staff]);
    await connection.collection('teams').insertMany(
      teamIds.map((_id, index) => ({
        _id,
        name: `Nhóm ${index}`,
        code: `PERF${index}`,
        managerIds: [managers[index]._id],
        isActive: true,
        deletedAt: null,
        revision: 0,
      })),
    );
    for (const user of [admin, managers[0], staff[0]]) {
      userIds[user.displayName] = String(user._id);
      tokens[user.displayName] = jwt.sign({
        sub: String(user._id),
        email: user.email,
        role: user.role,
      });
    }

    // --- 10.000 khách ---
    const statuses = await connection
      .collection('customer_statuses')
      .find({})
      .toArray();
    const sources = await connection
      .collection('catalog_items')
      .find({ type: 'LEAD_SOURCE' })
      .toArray();
    const projects = await connection.collection('projects').find({}).toArray();
    const staffByTeam = teamIds.map((_, teamIndex) =>
      staff.filter(
        (user) => String(user.teamId) === String(teamIds[teamIndex]),
      ),
    );
    const pick = <T>(items: T[], n: number): T => items[n % items.length];
    const now = Date.now();
    const docs = Array.from({ length: TOTAL_CUSTOMERS }, (_, n) => {
      const teamIndex = n % TEAM_COUNT;
      const members = [pick(staffByTeam[teamIndex], n)];
      if (n % 4 === 0)
        members.push(pick(staffByTeam[(teamIndex + 1) % TEAM_COUNT], n));
      const fullName = `${pick(FIRST, n)} ${pick(MIDDLE, n * 7)} ${pick(LAST, n * 13)}`;
      const phone = `+8490${String(1_000_000 + n)}`;
      const lastUpdatedAt = new Date(now - n * 60_000);
      return {
        _id: new Types.ObjectId(),
        fullName,
        phone,
        email: n % 3 === 0 ? `kh${n}@mail.vn` : null,
        statusId: pick(statuses, n)._id,
        statusChangedAt: lastUpdatedAt,
        sourceId: pick(sources, n)._id,
        interestedProjectIds: [pick(projects, n)._id],
        areaId: null,
        tagIds: [],
        nationalId: null,
        nationalIdLast4: null,
        hasNationalId: false,
        criteria: {},
        progress: (n % 5) * 25,
        careTeam: members.map((user, index) => ({
          userId: user._id,
          role: index === 0 ? 'PRIMARY' : 'MEMBER',
          addedBy: admin._id,
          addedAt: lastUpdatedAt,
        })),
        primaryAssigneeId: members[0]._id,
        teamIds: [...new Set(members.map((user) => String(user.teamId)))].map(
          (id) => new Types.ObjectId(id),
        ),
        personaCompleteness: 0,
        dataConsent: { status: 'UNKNOWN' },
        lastUpdatedAt,
        lastUpdatedBy: admin._id,
        lastCareLogAt: null,
        nextAppointmentAt: null,
        searchText: buildSearchText({ fullName, email: null, phone }),
        createdVia: 'WEB',
        createdBy: admin._id,
        deletedAt: null,
        deletedBy: null,
        anonymizedAt: null,
        createdAt: lastUpdatedAt,
        updatedAt: lastUpdatedAt,
        __v: 0,
      };
    });
    for (let index = 0; index < docs.length; index += 2000) {
      await connection
        .collection('customers')
        .insertMany(docs.slice(index, index + 2000));
    }
    sampleCustomerIds = {
      admin: String(docs[1]._id),
      manager0: String(docs[0]._id),
      staff0_0: String(docs[0]._id),
    };
  });

  afterAll(async () => {
    console.table(report);
    delete process.env.FEATURE_CRM_ENABLED;
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  const ROLES = ['admin', 'manager0', 'staff0_0'];

  it('đủ 10.000 khách và mỗi vai trò thấy đúng phạm vi', async () => {
    expect(await connection.collection('customers').countDocuments()).toBe(
      TOTAL_CUSTOMERS,
    );
    const totals: Record<string, number> = {};
    for (const role of ROLES) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm/customers?limit=1',
        headers: { authorization: `Bearer ${tokens[role]}` },
      });
      totals[role] = JSON.parse(res.body).meta.total;
    }
    expect(totals.admin).toBe(TOTAL_CUSTOMERS);
    expect(totals.manager0).toBeGreaterThan(1000);
    expect(totals.manager0).toBeLessThan(totals.admin);
    expect(totals.staff0_0).toBeGreaterThan(50);
    expect(totals.staff0_0).toBeLessThan(totals.manager0);
  });

  it('mọi phạm vi (Quản trị / Quản lý / Nhân viên) dùng index, không quét toàn bộ collection (COLLSCAN)', async () => {
    const manager = (await userModel.findOne({ email: 'manager0@perf.vn' }))!;
    const staff = (await userModel.findOne({ email: 'staff0_0@perf.vn' }))!;
    const scopes: Record<string, Record<string, unknown>> = {
      admin: { deletedAt: null },
      manager: {
        $and: [
          {
            $or: [
              { teamIds: { $in: [manager.teamId] } },
              { 'careTeam.userId': manager._id },
            ],
          },
          { deletedAt: null },
        ],
      },
      staff: { $and: [{ 'careTeam.userId': staff._id }, { deletedAt: null }] },
    };
    for (const [name, filter] of Object.entries(scopes)) {
      const plan = await connection
        .collection('customers')
        .find(filter)
        .sort({ lastUpdatedAt: -1, _id: -1 })
        .limit(20)
        .explain('queryPlanner');
      expect([name, JSON.stringify(plan.queryPlanner.winningPlan)]).toEqual([
        name,
        expect.not.stringContaining('COLLSCAN'),
      ]);
    }
  });

  it('danh sách mặc định (tab Tất cả, sort -lastUpdatedAt): p95 < 300 ms', async () => {
    await measure(
      'Danh sách tab Tất cả (limit 20, trang đầu)',
      () => '/crm/customers?limit=20',
      ROLES,
      300,
    );
  });

  it('danh sách có phân trang sâu, lọc tình trạng + nguồn + tiến độ: p95 < 300 ms', async () => {
    await measure(
      'Danh sách trang 40 (limit 20)',
      () => '/crm/customers?limit=20&page=40',
      ROLES,
      300,
    );
    await measure(
      'Danh sách lọc tab INTERESTED + progress',
      (_, i) => `/crm/customers?listGroup=INTERESTED&progress=${(i % 5) * 25}`,
      ROLES,
      300,
    );
  });

  it('sort theo tên (collation vi) và tìm kiếm tên không dấu / đuôi số: p95 < 300 ms', async () => {
    await measure(
      'Danh sách sort fullName',
      () => '/crm/customers?sort=fullName&limit=20',
      ROLES,
      300,
    );
    await measure(
      'Tìm tên không dấu (q=nguyen van)',
      // Cùng từ khóa trong 5 giây chỉ tốn 1 lượt rate limit nên lấy đủ mẫu.
      () => '/crm/customers?q=nguyen%20van&limit=20',
      ROLES,
      300,
    );
    await measure(
      'Tìm theo 4 số cuối SĐT',
      (_, i) => `/crm/customers?q=${String(1000 + i).padStart(4, '0')}`,
      ROLES,
      300,
      SEARCH_SAMPLES,
      true,
    );
  });

  it('list-counts 5 tab: p95 < 150 ms', async () => {
    await measure(
      'list-counts (5 tab)',
      () => '/crm/customers/list-counts',
      ROLES,
      150,
    );
  });

  it('chi tiết khách: p95 < 200 ms', async () => {
    await measure(
      'Chi tiết khách',
      (role) => `/crm/customers/${sampleCustomerIds[role]}`,
      ROLES,
      200,
    );
  });
});
