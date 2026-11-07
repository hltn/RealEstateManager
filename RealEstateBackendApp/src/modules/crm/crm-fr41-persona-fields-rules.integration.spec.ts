/**
 * INTEGRATION FR-41 (T-62) — quy tắc BE của `/crm/persona-fields` mà màn "Trường chân dung" (T-63, T-64) dựa vào, qua
 * HTTP thật (Fastify + guard toàn cục + ValidationPipe + GlobalExceptionFilter + MongoDB Replica Set in-memory):
 * - `PERSONA_FIELD_SYSTEM`: trường hệ thống không xóa được (kể cả khi có dữ liệu) và không đổi kiểu được, nhưng vẫn
 *   sửa nhãn/lựa chọn/tắt được;
 * - `PERSONA_FIELD_TYPE_LOCKED`: đã có dữ liệu khách thì không đổi kiểu (ưu tiên hơn `PERSONA_FIELD_SYSTEM`);
 * - lựa chọn vắng mặt trong `options` bị TẮT (không xóa), đổi nhãn không đổi `value`, bật lại được;
 * - `PUT /order`: đổi thứ tự/nhóm, trả lại toàn bộ danh sách theo thứ tự mới.
 * Phần đã có test ở `crm-m4.integration.spec.ts` (quyền, trùng key, dữ liệu cũ không mất) không lặp lại ở đây.
 * Chạy bằng `npm run test:integration`.
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
import { CrmModule } from './crm.module';
import { PersonaSeedService } from './persona/persona-seed.service';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);

interface Res {
  status: number;
  body: any;
}

interface OptionView {
  value: string;
  label: string;
  isActive: boolean;
}

describe('FR-41 (T-62) — quy tắc BE của /crm/persona-fields (HTTP + MongoDB Replica Set)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let adminToken: string;

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    body?: unknown,
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };

  const fieldDoc = (key: string) =>
    connection.collection('persona_fields').findOne({ key });
  const fieldId = async (key: string) => String((await fieldDoc(key))!._id);

  /** Khách tối thiểu có giá trị chân dung của `fieldKey` (chỉ để `valueCount` > 0; đủ cho phép đếm của BE). */
  const insertCustomerWithValue = (fieldKey: string) =>
    connection.collection('customers').insertOne({
      _id: new Types.ObjectId(),
      // `phone` có unique index: mỗi khách một số riêng để không đụng `{ phone: null }`.
      phone: `fr41-${randomUUID()}`,
      persona: [{ fieldKey, valueOptions: ['A'], source: 'STAFF_OBSERVED' }],
    });

  const createField = async (body: Record<string, unknown>) => {
    const res = await call('POST', '/crm/persona-fields', body);
    expect(res.status).toBe(201);
    return res.body.data as { id: string; options: OptionView[] };
  };

  const listAll = async () => {
    const res = await call('GET', '/crm/persona-fields?limit=100');
    expect(res.status).toBe(200);
    return res.body as {
      data: Array<{
        id: string;
        key: string;
        order: number;
        groupCode: string;
        options: OptionView[];
      }>;
      meta: { total: number };
    };
  };

  const optionsOf = (res: Res): Record<string, OptionView> =>
    Object.fromEntries(
      (res.body.data.options as OptionView[]).map((option) => [
        option.value,
        option,
      ]),
    );

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-fr41-${RUN_ID}:`;
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
    await app.get(PersonaSeedService).seedAll();

    const admin = await userModel.create({
      email: `fr41-${RUN_ID}@test.vn`,
      password: 'hash',
      displayName: 'fr41-admin',
      roles: [UserRole.ADMIN],
      status: UserStatus.ACTIVE,
    });
    adminToken = jwt.sign({
      sub: String(admin._id),
      email: admin.email,
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN],
    });
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  describe('PERSONA_FIELD_SYSTEM', () => {
    it('xóa trường hệ thống => 409 PERSONA_FIELD_SYSTEM kèm valueCount THẬT (có dữ liệu khách), body lỗi đúng chuẩn, trường còn nguyên', async () => {
      await insertCustomerWithValue('budget');
      await insertCustomerWithValue('budget');

      const res = await call(
        'DELETE',
        `/crm/persona-fields/${await fieldId('budget')}`,
      );

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409,
        message: expect.any(String) as unknown,
        timestamp: expect.any(String) as unknown,
        path: expect.stringMatching(/^\/api\/v1\/crm\/persona-fields\/.+/),
        errorCode: 'PERSONA_FIELD_SYSTEM',
        details: { valueCount: 2 },
      });
      expect((await fieldDoc('budget'))!.deletedAt ?? null).toBeNull();
    });

    it('đổi kiểu trường hệ thống CHƯA có dữ liệu => 409 PERSONA_FIELD_SYSTEM (details.field = type); kiểu và lựa chọn không đổi', async () => {
      const before = (await fieldDoc('property_type'))!;

      const res = await call(
        'PATCH',
        `/crm/persona-fields/${await fieldId('property_type')}`,
        { type: 'TEXT' },
      );

      expect([res.status, res.body.errorCode, res.body.details]).toEqual([
        409,
        'PERSONA_FIELD_SYSTEM',
        { field: 'type' },
      ]);
      const after = (await fieldDoc('property_type'))!;
      expect(after.type).toBe(before.type);
      expect(after.options).toEqual(before.options);
    });

    it('đổi kiểu trường hệ thống ĐÃ có dữ liệu => PERSONA_FIELD_TYPE_LOCKED (mã cụ thể hơn, ưu tiên) kèm valueCount', async () => {
      await insertCustomerWithValue('hobbies');

      const res = await call(
        'PATCH',
        `/crm/persona-fields/${await fieldId('hobbies')}`,
        { type: 'NUMBER' },
      );

      expect([res.status, res.body.errorCode, res.body.details]).toEqual([
        409,
        'PERSONA_FIELD_TYPE_LOCKED',
        { valueCount: 1 },
      ]);
    });

    it('trường hệ thống vẫn sửa nhãn, tắt/bật được; gửi lại đúng kiểu hiện tại không bị chặn; xóa vẫn 409 sau khi tắt', async () => {
      const id = await fieldId('bedroom_type');
      const current = (await fieldDoc('bedroom_type'))!;

      const renamed = await call('PATCH', `/crm/persona-fields/${id}`, {
        label: 'Số phòng ngủ',
        type: current.type,
        isActive: false,
      });

      expect(renamed.status).toBe(200);
      expect(renamed.body.data).toMatchObject({
        label: 'Số phòng ngủ',
        isActive: false,
        isSystem: true,
        type: current.type,
      });
      const del = await call('DELETE', `/crm/persona-fields/${id}`);
      expect([del.status, del.body.errorCode]).toEqual([
        409,
        'PERSONA_FIELD_SYSTEM',
      ]);
      const reEnabled = await call('PATCH', `/crm/persona-fields/${id}`, {
        isActive: true,
      });
      expect(reEnabled.body.data.isActive).toBe(true);
    });

    it('trường thường (không phải hệ thống) chưa có dữ liệu vẫn đổi kiểu được; xóa mềm được (204)', async () => {
      const created = await createField({
        key: `tu_do_${RUN_ID}`,
        label: 'Tự do',
        groupCode: 'PERSONAL',
        type: 'TEXT',
      });

      const changed = await call('PATCH', `/crm/persona-fields/${created.id}`, {
        type: 'NUMBER',
      });

      expect([changed.status, changed.body.data.type]).toEqual([200, 'NUMBER']);
      expect(
        (await call('DELETE', `/crm/persona-fields/${created.id}`)).status,
      ).toBe(204);
    });
  });

  describe('lựa chọn vắng mặt bị tắt, không xóa', () => {
    it.each(['SELECT', 'MULTI_SELECT'])(
      '%s: PATCH options chỉ còn 1 lựa chọn => 2 lựa chọn kia isActive=false (còn trong GET), đổi nhãn giữ nguyên value, gửi lại thì bật lại',
      async (type) => {
        const created = await createField({
          key: `chon_${type.toLowerCase()}_${RUN_ID}`,
          label: 'Chọn',
          groupCode: 'LIFESTYLE',
          type,
          options: [
            { value: 'A', label: 'Lựa chọn A' },
            { value: 'B', label: 'Lựa chọn B' },
            { value: 'C', label: 'Lựa chọn C' },
          ],
        });

        const trimmed = await call(
          'PATCH',
          `/crm/persona-fields/${created.id}`,
          { options: [{ value: 'A', label: 'A đổi nhãn' }] },
        );

        expect(trimmed.status).toBe(200);
        expect(optionsOf(trimmed)).toEqual({
          A: { value: 'A', label: 'A đổi nhãn', isActive: true },
          B: { value: 'B', label: 'Lựa chọn B', isActive: false },
          C: { value: 'C', label: 'Lựa chọn C', isActive: false },
        });
        // Lựa chọn đã tắt vẫn được trả trong danh sách (FE hiện cho khách đang dùng).
        const listed = (await listAll()).data.find(
          (field) => field.id === created.id,
        )!;
        expect(listed.options.map((option) => option.value).sort()).toEqual([
          'A',
          'B',
          'C',
        ]);

        const restored = await call(
          'PATCH',
          `/crm/persona-fields/${created.id}`,
          {
            options: [
              { value: 'A', label: 'A đổi nhãn' },
              { value: 'B', label: 'Lựa chọn B' },
            ],
          },
        );
        expect(optionsOf(restored)).toMatchObject({
          A: { isActive: true },
          B: { isActive: true },
          C: { isActive: false },
        });
      },
    );

    it('options gửi isActive=false tường minh được giữ tắt; PATCH không gửi options thì lựa chọn không đổi', async () => {
      const created = await createField({
        key: `tat_${RUN_ID}`,
        label: 'Tắt',
        groupCode: 'LIFESTYLE',
        type: 'SELECT',
        options: [
          { value: 'A', label: 'A' },
          { value: 'B', label: 'B' },
        ],
      });

      const off = await call('PATCH', `/crm/persona-fields/${created.id}`, {
        options: [
          { value: 'A', label: 'A' },
          { value: 'B', label: 'B', isActive: false },
        ],
      });
      expect(optionsOf(off).B.isActive).toBe(false);

      const labelOnly = await call(
        'PATCH',
        `/crm/persona-fields/${created.id}`,
        { label: 'Tắt 2' },
      );
      expect(optionsOf(labelOnly)).toEqual(optionsOf(off));
    });

    it('tắt hết lựa chọn hoặc trùng value (sau chuẩn hóa) => 400 VALIDATION_FAILED, không ghi gì', async () => {
      const created = await createField({
        key: `bien_${RUN_ID}`,
        label: 'Biên',
        groupCode: 'LIFESTYLE',
        type: 'SELECT',
        options: [{ value: 'A', label: 'A' }],
      });
      const before = (await fieldDoc(`bien_${RUN_ID}`))!.options;

      const allOff = await call('PATCH', `/crm/persona-fields/${created.id}`, {
        options: [{ value: 'A', label: 'A', isActive: false }],
      });
      const duplicated = await call(
        'PATCH',
        `/crm/persona-fields/${created.id}`,
        {
          options: [
            { value: 'a b', label: 'X' },
            { value: 'A_B', label: 'Y' },
          ],
        },
      );

      for (const res of [allOff, duplicated]) {
        expect([res.status, res.body.errorCode]).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect((await fieldDoc(`bien_${RUN_ID}`))!.options).toEqual(before);
    });

    it('trần 100 lựa chọn TÍNH CẢ lựa chọn đã tắt: 1 + 50 mới (A bị tắt) = 51 ok; thêm 50 nữa = 101 => 400, danh sách không đổi', async () => {
      const created = await createField({
        key: `tran_${RUN_ID}`,
        label: 'Trần',
        groupCode: 'LIFESTYLE',
        type: 'SELECT',
        options: [{ value: 'A', label: 'A' }],
      });
      const batch = (prefix: string) =>
        Array.from({ length: 50 }, (_, index) => ({
          value: `${prefix}${index}`,
          label: `${prefix}${index}`,
        }));

      const first = await call('PATCH', `/crm/persona-fields/${created.id}`, {
        options: batch('p'),
      });
      const second = await call('PATCH', `/crm/persona-fields/${created.id}`, {
        options: batch('q'),
      });

      expect(first.status).toBe(200);
      expect(first.body.data.options).toHaveLength(51);
      expect([second.status, second.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect((await fieldDoc(`tran_${RUN_ID}`))!.options).toHaveLength(51);
    });
  });

  describe('PUT /crm/persona-fields/order', () => {
    it('đổi thứ tự và chuyển nhóm: trả TOÀN BỘ trường chưa xóa theo thứ tự mới, GET thấy ngay; gửi lại đúng thứ tự hiện tại là no-op (không audit)', async () => {
      const before = await listAll();
      const [first, second] = before.data;
      const maxOrder = Math.max(...before.data.map((field) => field.order));

      const res = await call('PUT', '/crm/persona-fields/order', {
        items: [
          { id: first.id, order: maxOrder + 2 },
          { id: second.id, order: maxOrder + 1, groupCode: 'REAL_ESTATE' },
        ],
      });

      expect(res.status).toBe(200);
      const keys = (res.body.data as Array<{ key: string }>).map(
        (field) => field.key,
      );
      expect(keys).toHaveLength(before.meta.total);
      expect(keys.slice(-2)).toEqual([second.key, first.key]);
      const after = await listAll();
      expect(after.data.map((field) => field.key)).toEqual(keys);
      expect(
        after.data.find((field) => field.id === second.id)!.groupCode,
      ).toBe('REAL_ESTATE');
      const countAudit = () =>
        connection
          .collection('crm_audit_logs')
          .countDocuments({ action: 'PERSONA_FIELDS_REORDERED' });
      const auditBefore = await countAudit();

      const noop = await call('PUT', '/crm/persona-fields/order', {
        items: [{ id: first.id, order: maxOrder + 2 }],
      });

      expect(noop.status).toBe(200);
      expect(await countAudit()).toBe(auditBefore);
    });

    it('lỗi: nhóm không tồn tại 400 VALIDATION_FAILED, trường đã xóa 404, id trùng 400; không đổi gì', async () => {
      const [first] = (await listAll()).data;
      const removable = await createField({
        key: `xoa_${RUN_ID}`,
        label: 'Xóa',
        groupCode: 'PERSONAL',
        type: 'TEXT',
      });
      await call('DELETE', `/crm/persona-fields/${removable.id}`);
      const orderBefore = (await fieldDoc(first.key))!.order;

      const badGroup = await call('PUT', '/crm/persona-fields/order', {
        items: [{ id: first.id, order: 999, groupCode: 'KHONG_CO' }],
      });
      const deleted = await call('PUT', '/crm/persona-fields/order', {
        items: [
          { id: first.id, order: 999 },
          { id: removable.id, order: 1000 },
        ],
      });
      const duplicate = await call('PUT', '/crm/persona-fields/order', {
        items: [
          { id: first.id, order: 1 },
          { id: first.id, order: 2 },
        ],
      });

      expect([badGroup.status, badGroup.body.errorCode]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect(deleted.status).toBe(404);
      expect(duplicate.status).toBe(400);
      expect((await fieldDoc(first.key))!.order).toBe(orderBefore);
    });
  });
});
