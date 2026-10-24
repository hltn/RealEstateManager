/**
 * INTEGRATION (QA bổ sung, M4): hai lỗ hổng đã chứng minh (SF-1, SF-2; đã sửa nên là it thường) và một ca
 * biên thiếu của job tính lại chân dung (không đè khách vừa bị sửa). Cùng harness với crm-m4.integration.spec.ts
 * (MongoDB Replica Set trong bộ nhớ + Redis dev với tiền tố khóa riêng).
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
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import {
  FILE_STORAGE,
  IFileStorage,
} from '../../shared/storage/file-storage.interface';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { Customer, CustomerDocument } from './customers/schemas/customer.schema';
import {
  PersonaConfigService,
  toFieldDef,
} from './persona/persona-config.service';
import { PersonaRecomputeService } from './persona/persona-recompute.service';
import { PersonaSeedService } from './persona/persona-seed.service';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(300_000);

const FLAG = 'FEATURE_CRM_ENABLED';
const RUN_ID = randomUUID().slice(0, 8);

/** Chữ ký của hai hàm riêng tư của job mà ca kiểm thử cần gọi trực tiếp (mô phỏng một instance khác). */
interface RecomputeInternals {
  scan: (
    version: number,
    fields: ReturnType<typeof toFieldDef>[],
  ) => Promise<{ updated: number; skipped: number }>;
}

describe('CRM M4 — QA bổ sung', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let customerModel: Model<CustomerDocument>;
  let jwt: JwtService;
  let recompute: PersonaRecomputeService;
  let config: PersonaConfigService;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const call = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    as: string,
    body?: unknown,
  ) => {
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

  let phoneSeq = 0;
  const createCustomer = async (as: string): Promise<string> => {
    const phone = `095${String(1_000_000 + ++phoneSeq)}`;
    const res = await call('POST', '/crm/customers', as, {
      fullName: `Khách ${phone}`,
      phone,
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
  };

  const customerDoc = (id: string) =>
    connection.collection('customers').findOne({ _id: new Types.ObjectId(id) });

  const setOccupation = async (customerId: string, as: string) => {
    const version = (await call('GET', `/crm/customers/${customerId}/persona`, as))
      .body.data.version;
    const res = await call('PATCH', `/crm/customers/${customerId}/persona`, as, {
      version,
      values: [
        {
          fieldKey: 'occupation',
          value: { valueText: 'Kế toán' },
          source: 'STAFF_OBSERVED',
        },
      ],
    });
    expect(res.status).toBe(200);
  };

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-m4qa-${RUN_ID}:`;
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
    })
      .overrideProvider(FILE_STORAGE)
      .useValue({
        isConfigured: () => false,
        checkHealth: () => Promise.resolve(),
      } as unknown as IFileStorage)
      .compile();
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
    customerModel = app.get(getModelToken(Customer.name));
    jwt = app.get(JwtService);
    recompute = app.get(PersonaRecomputeService);
    config = app.get(PersonaConfigService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();
    await app.get(PersonaSeedService).seedAll();
    await createUser('admin', UserRole.ADMIN);
    await createUser('staff', UserRole.STAFF);
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  // ---------------------------------------------------------------------------------------------
  // SF-1: không có điều kiện đơn điệu theo phiên bản cấu hình => job chạy trên instance cũ ghi đè kết quả mới.
  it(
    'job tính lại với phiên bản cấu hình CŨ không được ghi đè khách đã tính theo phiên bản MỚI (nhiều instance)',
    async () => {
      const customer = await createCustomer('staff');
      await setOccupation(customer, 'staff');

      // Instance B bắt đầu quét với ảnh chụp cấu hình cũ...
      const staleVersion = await config.getVersion();
      const staleFields = (await config.loadActiveFields()).map(toFieldDef);

      // ...trong lúc instance A xử lý thay đổi cấu hình và tính lại xong.
      const occupation = await connection
        .collection('persona_fields')
        .findOne({ key: 'occupation' });
      const patched = await call(
        'PATCH',
        `/crm/persona-fields/${String(occupation!._id)}`,
        'admin',
        { weight: 7 },
      );
      expect(patched.status).toBe(200);
      await recompute.run();
      const fresh = await customerDoc(customer);
      const currentVersion = await config.getVersion();
      expect(fresh!.personaConfigVersion).toBe(currentVersion);

      await (recompute as unknown as RecomputeInternals).scan(
        staleVersion,
        staleFields,
      );

      const after = await customerDoc(customer);
      expect(after!.personaConfigVersion).toBe(currentVersion);
      expect(after!.personaCompleteness).toBe(fresh!.personaCompleteness);
    },
  );

  // ---------------------------------------------------------------------------------------------
  // SF-2: trường nhạy cảm vẫn đặt được isFilterable => giá trị nhạy cảm nằm thẳng (dạng slug) trong
  // `customers.personaFilterKeys` và dò được bằng `personaFilters`.
  it(
    'trường isSensitive không được đồng thời isFilterable (token lọc chứa giá trị nhạy cảm)',
    async () => {
      const res = await call('POST', '/crm/persona-fields', 'admin', {
        key: 'health_filterable',
        label: 'Sức khỏe (lọc được)',
        groupCode: 'PERSONAL',
        type: 'TEXT',
        isSensitive: true,
        isFilterable: true,
      });
      expect(res.status).toBe(400);
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Ca biên thiếu ở bộ test của coder: tài liệu 04 mục 3.2.2 khẳng định job "chỉ ghi vào khách khi khách chưa bị sửa
  // kể từ lúc đọc (`__v`)" nhưng không test nào bắt được nếu điều kiện `__v` bị bỏ.
  it('job không đè khách bị sửa giữa lúc đọc và lúc ghi (điều kiện __v), lượt sau mới tính lại', async () => {
    const customer = await createCustomer('staff');
    await setOccupation(customer, 'staff');
    const id = new Types.ObjectId(customer);
    await connection.collection('customers').updateOne(
      { _id: id },
      {
        $set: {
          personaConfigVersion: -1,
          personaFilterKeys: [],
          personaCompleteness: 99,
        },
      },
    );

    const originalBulkWrite = customerModel.bulkWrite.bind(customerModel);
    const spy = jest
      .spyOn(customerModel, 'bulkWrite')
      .mockImplementationOnce(async (...args: unknown[]) => {
        // Người dùng sửa chân dung đúng lúc job chuẩn bị ghi: `__v` tăng.
        await connection
          .collection('customers')
          .updateOne({ _id: id }, { $inc: { __v: 1 } });
        return (originalBulkWrite as (...a: unknown[]) => Promise<never>)(
          ...args,
        );
      });
    const fields = (await config.loadActiveFields()).map(toFieldDef);
    const version = await config.getVersion();
    const result = await (recompute as unknown as RecomputeInternals).scan(
      version,
      fields,
    );
    spy.mockRestore();

    expect(result.skipped).toBe(1);
    const untouched = await customerDoc(customer);
    expect(untouched!.personaConfigVersion).toBe(-1);
    expect(untouched!.personaCompleteness).toBe(99);

    await recompute.run();
    const fixed = await customerDoc(customer);
    expect(fixed!.personaConfigVersion).toBe(version);
    expect(fixed!.personaFilterKeys).toContain('occupation=ke_toan');
  });
});
