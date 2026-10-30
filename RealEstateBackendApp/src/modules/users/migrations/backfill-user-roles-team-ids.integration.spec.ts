/**
 * INTEGRATION — migration 005 (`users.roles[]` + `users.teamIds[]`) trên MongoDB in-memory (DB tạm, không đụng DB dev).
 */
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { backfillUserRolesTeamIds } from './backfill-user-roles-team-ids';

jest.setTimeout(120_000);

describe('backfillUserRolesTeamIds', () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  const teamId = new ObjectId();
  const otherTeamId = new ObjectId();

  const users = () => client.db('migration_005').collection('users');
  const byEmail = (email: string) => users().findOne({ email });

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { launchTimeout: 120_000 },
    });
    client = await new MongoClient(server.getUri()).connect();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  beforeEach(async () => {
    await users().deleteMany({});
    await users().insertMany([
      { email: 'admin', role: 'ADMIN', teamId: null, status: 'ACTIVE' },
      { email: 'manager', role: 'MANAGER', teamId, status: 'ACTIVE' },
      { email: 'staff-no-team-field', role: 'STAFF', status: 'ACTIVE' },
      {
        // Đã migrate một phần/đã sửa tay: roles/teamIds không rỗng phải được GIỮ NGUYÊN.
        email: 'already',
        role: 'MANAGER',
        roles: ['MANAGER', 'STAFF'],
        teamId,
        teamIds: [teamId, otherTeamId],
        status: 'ACTIVE',
      },
      // Có roles nhưng thiếu teamIds: chỉ bổ sung teamIds.
      {
        email: 'roles-only',
        role: 'MANAGER',
        roles: ['MANAGER', 'EDITOR'],
        teamId,
        status: 'ACTIVE',
      },
    ]);
  });

  it('dry-run chỉ đếm, không ghi gì (kể cả index)', async () => {
    const result = await backfillUserRolesTeamIds(
      client.db('migration_005'),
      false,
    );

    expect(result).toMatchObject({ pendingBefore: 4, updated: 0 });
    expect(result.roleCounts).toEqual({ ADMIN: 1, MANAGER: 3, STAFF: 1 });
    expect(await byEmail('admin')).not.toHaveProperty('roles');
    const indexes = (await users().indexes()).map((index) => index.name);
    expect(indexes).toEqual(['_id_']);
  });

  it('apply: roles=[role], teamIds=[teamId]|[] cho bản ghi cũ; giữ nguyên role/teamId và dữ liệu đã có', async () => {
    const result = await backfillUserRolesTeamIds(
      client.db('migration_005'),
      true,
    );

    expect(result).toMatchObject({ pendingBefore: 4, updated: 4 });
    expect(await byEmail('admin')).toMatchObject({
      role: 'ADMIN',
      roles: ['ADMIN'],
      teamId: null,
      teamIds: [],
    });
    expect(await byEmail('manager')).toMatchObject({
      role: 'MANAGER',
      roles: ['MANAGER'],
      teamId,
      teamIds: [teamId],
    });
    // Thiếu cả field teamId lẫn teamIds → [].
    expect(await byEmail('staff-no-team-field')).toMatchObject({
      roles: ['STAFF'],
      teamIds: [],
    });
    expect(await byEmail('roles-only')).toMatchObject({
      roles: ['MANAGER', 'EDITOR'],
      teamIds: [teamId],
    });
    expect(await byEmail('already')).toMatchObject({
      roles: ['MANAGER', 'STAFF'],
      teamIds: [teamId, otherTeamId],
    });

    const indexes = (await users().indexes()).map((index) => index.name);
    expect(indexes).toEqual(
      expect.arrayContaining(['teamIds_1_status_1', 'roles_1_status_1']),
    );
  });

  describe('lệch cặp suy ra (role/teamId đơn bị pod cũ ghi lệch so với roles/teamIds)', () => {
    const db = () => client.db('migration_005');

    beforeEach(async () => {
      await users().deleteMany({});
      await users().insertMany([
        {
          // role lệch: pod cũ đặt role=STAFF nhưng roles vẫn [MANAGER, STAFF]
          email: 'role-drift',
          role: 'STAFF',
          roles: ['MANAGER', 'STAFF'],
          teamId,
          teamIds: [teamId],
        },
        {
          // teamId lệch: pod cũ đổi sang nhóm khác, teamIds vẫn [A, B]
          email: 'team-drift',
          role: 'MANAGER',
          roles: ['MANAGER', 'STAFF'],
          teamId: otherTeamId,
          teamIds: [teamId, otherTeamId],
        },
        {
          // pod cũ hạ xuống ADMIN và xóa teamId, teamIds còn nhóm cũ
          email: 'cleared-drift',
          role: 'ADMIN',
          roles: ['STAFF'],
          teamId: null,
          teamIds: [teamId],
        },
        {
          // đa role/đa nhóm HỢP LỆ (role = cao nhất, teamId = teamIds[0]): không được đụng tới
          email: 'consistent',
          role: 'MANAGER',
          roles: ['STAFF', 'MANAGER'],
          teamId,
          teamIds: [teamId, otherTeamId],
        },
        // chưa migrate: thuộc phần backfill, không tính là lệch
        { email: 'legacy', role: 'STAFF', teamId },
      ]);
    });

    const snapshot = () => users().find({}).sort({ email: 1 }).toArray();

    it('dry-run (kể cả --reconcile không có --apply) chỉ ĐẾM số lệch ở cả hai chiều, không ghi gì', async () => {
      const before = await snapshot();

      const plain = await backfillUserRolesTeamIds(db(), false);
      const withReconcile = await backfillUserRolesTeamIds(db(), false, {
        reconcile: true,
      });

      for (const result of [plain, withReconcile]) {
        expect(result).toMatchObject({
          driftBefore: 3,
          reconciled: 0,
          updated: 0,
          pendingBefore: 1,
        });
        expect(result.driftIds).toHaveLength(3);
      }
      expect(await snapshot()).toEqual(before);
    });

    it('--apply không có --reconcile: backfill bản ghi cũ nhưng KHÔNG sửa bản ghi lệch', async () => {
      const result = await backfillUserRolesTeamIds(db(), true);

      expect(result).toMatchObject({
        driftBefore: 3,
        reconciled: 0,
        updated: 1,
      });
      expect(await byEmail('role-drift')).toMatchObject({
        role: 'STAFF',
        roles: ['MANAGER', 'STAFF'],
      });
      expect(await byEmail('team-drift')).toMatchObject({
        teamId: otherTeamId,
        teamIds: [teamId, otherTeamId],
      });
    });

    it('--apply --reconcile: nguồn đúng là role/teamId đơn (thu gọn); bản ghi nhất quán giữ nguyên', async () => {
      const consistentBefore = await byEmail('consistent');

      const result = await backfillUserRolesTeamIds(db(), true, {
        reconcile: true,
      });

      expect(result).toMatchObject({ driftBefore: 3, reconciled: 3 });
      expect(await byEmail('role-drift')).toMatchObject({
        role: 'STAFF',
        roles: ['STAFF'],
        teamId,
        teamIds: [teamId],
      });
      expect(await byEmail('team-drift')).toMatchObject({
        role: 'MANAGER',
        roles: ['MANAGER'],
        teamId: otherTeamId,
        teamIds: [otherTeamId],
      });
      expect(await byEmail('cleared-drift')).toMatchObject({
        role: 'ADMIN',
        roles: ['ADMIN'],
        teamId: null,
        teamIds: [],
      });
      expect(await byEmail('consistent')).toEqual(consistentBefore);
      expect(await byEmail('legacy')).toMatchObject({
        roles: ['STAFF'],
        teamIds: [teamId],
      });
    });

    it('role: null (kèm roles hợp lệ) không bị coi là lệch và không bị reconcile ghi thành roles:[null]', async () => {
      await users().insertOne({
        email: 'null-role',
        role: null,
        roles: ['STAFF'],
        teamId: null,
        teamIds: [teamId],
      });
      const before = await byEmail('null-role');

      const result = await backfillUserRolesTeamIds(db(), true, {
        reconcile: true,
      });

      expect(result.driftIds).not.toContain(String(before?._id));
      expect(await byEmail('null-role')).toEqual(before);
    });

    it('idempotent: sau reconcile chạy lại không còn lệch, không ghi thêm', async () => {
      await backfillUserRolesTeamIds(db(), true, { reconcile: true });
      const done = await snapshot();

      const again = await backfillUserRolesTeamIds(db(), true, {
        reconcile: true,
      });

      expect(again).toMatchObject({
        driftBefore: 0,
        reconciled: 0,
        updated: 0,
        pendingBefore: 0,
      });
      expect(await snapshot()).toEqual(done);
    });
  });

  /**
   * REGRESSION — lỗi thật trên DB dev: mọi user CHƯA có field `roles` làm `$in: [role, '$roles']` ném
   * "$in requires an array as a second argument, found: missing" (query planner không đảm bảo `roles: {$exists:true}`
   * được áp trước `$expr`). Đây chính là trạng thái dữ liệu mà migration 005 phục vụ.
   */
  describe('tài khoản CHƯA migrate (thiếu roles/teamIds, roles rỗng/null/không phải mảng, role null)', () => {
    const db = () => client.db('migration_005');
    const snapshot = () => users().find({}).sort({ email: 1 }).toArray();

    beforeEach(async () => {
      await users().deleteMany({});
      // Các test trước có thể đã tạo index; xóa để kiểm "dry-run không tạo index" chính xác.
      await users().dropIndexes();
      await users().insertMany([
        // CHỈ có `role` (không roles, không teamIds, không teamId): trường hợp gây lỗi.
        { email: 'legacy-only-role', role: 'MANAGER', status: 'ACTIVE' },
        { email: 'legacy-with-team', role: 'STAFF', teamId, status: 'ACTIVE' },
        // đã migrate đầy đủ, nhất quán.
        {
          email: 'migrated',
          role: 'MANAGER',
          roles: ['MANAGER', 'STAFF'],
          teamId,
          teamIds: [teamId, otherTeamId],
          status: 'ACTIVE',
        },
        // roles rỗng + teamIds rỗng: coi là chưa migrate.
        {
          email: 'empty-roles',
          role: 'STAFF',
          roles: [],
          teamId: null,
          teamIds: [],
          status: 'ACTIVE',
        },
        // role null, không roles: mặc định EDITOR như schema.
        { email: 'null-role', role: null, teamId: null, status: 'ACTIVE' },
        // roles null / không phải mảng (dữ liệu bẩn): không được làm vỡ aggregation.
        {
          email: 'null-roles',
          role: 'ADMIN',
          roles: null,
          teamId: null,
          teamIds: null,
          status: 'ACTIVE',
        },
        {
          email: 'scalar-roles',
          role: 'STAFF',
          roles: 'STAFF',
          teamId: null,
          teamIds: [],
          status: 'ACTIVE',
        },
      ]);
    });

    it('dry-run chỉ với user THIẾU field roles (đúng tình huống dev: 6/6 user chưa có roles): không ném "found: missing"', async () => {
      await users().deleteMany({});
      // Lỗi dev CHỈ tái hiện khi collection có index như UserSchema (planner thử nhiều plan, đánh giá `$expr` trước
      // `roles: {$exists:true}`); không có index → COLLSCAN và code cũ vô tình chạy được.
      await users().createIndexes([
        { key: { status: 1 } },
        { key: { teamId: 1, status: 1 } },
        { key: { teamIds: 1, status: 1 } },
        { key: { roles: 1, status: 1 } },
      ]);
      await users().insertMany([
        { email: 'a', role: 'ADMIN', teamId: null, status: 'ACTIVE' },
        { email: 'b', role: 'MANAGER', teamId, status: 'ACTIVE' },
        { email: 'c', role: 'STAFF', teamId, status: 'ACTIVE' },
      ]);

      const result = await backfillUserRolesTeamIds(db(), false);

      expect(result).toMatchObject({
        pendingBefore: 3,
        driftBefore: 0,
        updated: 0,
      });
    });

    it('dry-run: không ném lỗi, đếm đúng pending/drift, không ghi gì', async () => {
      const before = await snapshot();

      const result = await backfillUserRolesTeamIds(db(), false);
      const withReconcile = await backfillUserRolesTeamIds(db(), false, {
        reconcile: true,
      });

      for (const r of [result, withReconcile]) {
        // Tất cả trừ `migrated` đều chưa đủ roles (mảng không rỗng) + teamIds (mảng).
        expect(r).toMatchObject({
          pendingBefore: 6,
          updated: 0,
          driftBefore: 0,
          reconciled: 0,
        });
        expect(r.driftIds).toEqual([]);
      }
      expect(await snapshot()).toEqual(before);
      expect((await users().indexes()).map((i) => i.name)).toEqual(['_id_']);
    });

    it('apply (+reconcile): không ném lỗi, backfill đúng, giữ nguyên bản ghi đã migrate', async () => {
      const migratedBefore = await byEmail('migrated');

      const result = await backfillUserRolesTeamIds(db(), true, {
        reconcile: true,
      });

      expect(result).toMatchObject({
        pendingBefore: 6,
        updated: 6,
        driftBefore: 0,
      });
      expect(await byEmail('legacy-only-role')).toMatchObject({
        role: 'MANAGER',
        roles: ['MANAGER'],
        teamIds: [],
      });
      expect(await byEmail('legacy-with-team')).toMatchObject({
        roles: ['STAFF'],
        teamIds: [teamId],
      });
      expect(await byEmail('empty-roles')).toMatchObject({
        roles: ['STAFF'],
        teamIds: [],
      });
      expect(await byEmail('null-role')).toMatchObject({
        roles: ['EDITOR'],
        teamIds: [],
      });
      expect(await byEmail('null-roles')).toMatchObject({
        roles: ['ADMIN'],
        teamIds: [],
      });
      expect(await byEmail('scalar-roles')).toMatchObject({
        roles: ['STAFF'],
        teamIds: [],
      });
      expect(await byEmail('migrated')).toEqual(migratedBefore);
    });

    it('idempotent: chạy lại sau apply không lỗi, không còn pending/drift, không ghi thêm', async () => {
      await backfillUserRolesTeamIds(db(), true);
      const done = await snapshot();

      const again = await backfillUserRolesTeamIds(db(), true, {
        reconcile: true,
      });

      expect(again).toMatchObject({
        pendingBefore: 0,
        updated: 0,
        driftBefore: 0,
        reconciled: 0,
      });
      expect(await snapshot()).toEqual(done);
    });

    it('drift lẫn bản ghi chưa migrate: chỉ đếm bản ghi lệch thật, không lỗi', async () => {
      await users().insertOne({
        email: 'role-drift',
        role: 'STAFF',
        roles: ['MANAGER', 'STAFF'],
        teamId,
        teamIds: [teamId],
      });

      const dry = await backfillUserRolesTeamIds(db(), false);

      expect(dry).toMatchObject({ pendingBefore: 6, driftBefore: 1 });
    });
  });

  it('idempotent: chạy lại là no-op và không đổi dữ liệu', async () => {
    await backfillUserRolesTeamIds(client.db('migration_005'), true);
    const snapshot = await users().find({}).sort({ email: 1 }).toArray();

    const again = await backfillUserRolesTeamIds(
      client.db('migration_005'),
      true,
    );

    expect(again).toMatchObject({ pendingBefore: 0, updated: 0 });
    expect(await users().find({}).sort({ email: 1 }).toArray()).toEqual(
      snapshot,
    );
  });
});
