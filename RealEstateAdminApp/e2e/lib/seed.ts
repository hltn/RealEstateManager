/**
 * Seed dữ liệu mồi cho stack E2E, đi qua REST API của backend (dùng nguyên service/validation thật, không viết lại logic):
 * - Admin do backend tự seed lúc khởi động (ADMIN_EMAIL/ADMIN_PASSWORD).
 * - Danh mục + dự án mẫu do CrmSeedService seed khi bật FEATURE_CRM_ENABLED.
 * - Ở đây thêm: 2 nhóm, mgr1/staff1/staff2, 2 dự án E2E (1 hoạt động, 1 ngừng), vài khách mẫu.
 *
 * Token: ký trực tiếp bằng JWT secret của stack E2E (cùng payload với AuthService.signAccessToken) thay vì gọi
 * /auth/login, vì login bị throttle 5 lần/phút/IP và refresh token xoay vòng 1 lần dùng (xem README).
 */
import fs from 'node:fs';
import { ACCOUNTS, PATHS, TEST_PASSWORD, URLS, assertIsolated, backendEnv, type RoleKey } from '../env';
import { lib } from './infra';

export interface SeedState {
  mongoUri: string;
  users: Record<RoleKey, { id: string; email: string; role: string; accessToken: string }>;
  teams: { team1: string; team2: string };
  projects: { active: { id: string; name: string; code: string }; inactive: { id: string; name: string; code: string } };
  customers: { staff1: Array<{ id: string; fullName: string; phone: string }>; staff2: Array<{ id: string; fullName: string; phone: string }> };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function signToken(secret: string, sub: string, email: string, role: string): string {
  const jwt = lib('jsonwebtoken');
  return jwt.sign({ sub, email, role }, secret, { expiresIn: '8h' });
}

async function api(token: string, method: string, path: string, body?: unknown): Promise<Json> {
  const res = await fetch(`${URLS.api}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[E2E seed] ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  const json = text ? (JSON.parse(text) as Json) : {};
  return (json.data ?? json) as Json;
}
const idOf = (o: Json): string => String(o.id ?? o._id);

export async function seed(mongoUri: string): Promise<SeedState> {
  assertIsolated({ mongoUri });
  const secret = backendEnv(mongoUri).JWT_SECRET as string;

  // Admin do backend seed lúc boot: lấy _id từ Mongo tạm.
  const { MongoClient } = lib('mongodb');
  const mc = new MongoClient(mongoUri);
  await mc.connect();
  let adminId: string;
  try {
    const admin = await mc.db('e2e').collection('users').findOne({ email: ACCOUNTS.admin.email });
    if (!admin) throw new Error('[E2E seed] backend chưa seed admin (kiểm tra ADMIN_EMAIL)');
    adminId = String(admin._id);
  } finally {
    await mc.close();
  }
  const adminToken = signToken(secret, adminId, ACCOUNTS.admin.email, 'ADMIN');

  const users = { admin: { id: adminId, email: ACCOUNTS.admin.email, role: 'ADMIN', accessToken: adminToken } } as SeedState['users'];
  for (const key of ['mgr1', 'staff1', 'staff2'] as const) {
    const a = ACCOUNTS[key];
    const created = await api(adminToken, 'POST', '/users', {
      email: a.email,
      password: TEST_PASSWORD,
      displayName: a.displayName,
      role: a.role,
    });
    const id = idOf(created);
    users[key] = { id, email: a.email, role: a.role, accessToken: signToken(secret, id, a.email, a.role) };
  }

  const team1 = idOf(await api(adminToken, 'POST', '/teams', { name: 'Nhóm E2E 1', code: 'E2E1', managerIds: [users.mgr1.id] }));
  const team2 = idOf(await api(adminToken, 'POST', '/teams', { name: 'Nhóm E2E 2', code: 'E2E2' }));
  await api(adminToken, 'PATCH', `/users/${users.mgr1.id}/team`, { teamId: team1 });
  await api(adminToken, 'PATCH', `/users/${users.staff1.id}/team`, { teamId: team1 });
  await api(adminToken, 'PATCH', `/users/${users.staff2.id}/team`, { teamId: team2 });

  const mkProject = async (name: string, code: string) => ({
    id: idOf(await api(adminToken, 'POST', '/crm/projects', { name, code, status: 'SELLING', propertyTypes: ['Căn hộ'] })),
    name,
    code,
  });
  const active = await mkProject('Dự án E2E Hoạt động', 'E2E-ACTIVE');
  const inactive = await mkProject('Dự án E2E Ngừng', 'E2E-OFF');
  await api(adminToken, 'PATCH', `/crm/projects/${inactive.id}`, { isActive: false });

  const mkCustomers = async (token: string, rows: Array<[string, string]>) => {
    const out = [];
    for (const [fullName, phone] of rows) {
      const c = await api(token, 'POST', '/crm/customers', { fullName, phone, interestedProjectIds: [active.id] });
      out.push({ id: idOf(c), fullName, phone });
    }
    return out;
  };
  const customers = {
    staff1: await mkCustomers(users.staff1.accessToken, [
      ['Khách E2E Alpha', '0912000001'],
      ['Khách E2E Beta', '0912000002'],
      ['Khách E2E Gamma', '0912000003'],
    ]),
    staff2: await mkCustomers(users.staff2.accessToken, [['Khách E2E Delta', '0912000004']]),
  };

  const state: SeedState = { mongoUri, users, teams: { team1, team2 }, projects: { active, inactive }, customers };
  fs.mkdirSync(PATHS.runtimeDir, { recursive: true });
  fs.writeFileSync(PATHS.stateFile, JSON.stringify(state, null, 2));
  return state;
}
