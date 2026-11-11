#!/usr/bin/env node
/**
 * Import dữ liệu chăm sóc khách hàng (file JSON do `crm-care-import.json` sinh ra) qua API CRM:
 *   POST /crm/customers                       (tạo khách)
 *   POST /crm/customers/:id/care-logs         (ghi từng nhật ký chăm sóc)
 *
 * Không cần cài thêm thư viện (Node >= 18, dùng fetch có sẵn). Mật khẩu chỉ đọc từ biến môi trường, không ghi vào file.
 *
 * Ví dụ (chạy thử, không ghi gì):
 *   IMPORT_EMAIL=stnd.sieuthinhadat@gmail.com IMPORT_PASSWORD=... \
 *     node scripts/import-care-data.mjs --file "<đường dẫn>/crm-care-import.json" --dry-run
 *
 * Ghi thật: bỏ `--dry-run`. Chạy lại an toàn: tiến độ lưu ở `<file>.import-state.json`, khách/nhật ký đã nhập được bỏ qua.
 *
 * Chống tạo trùng khi chạy lại (từ v1.0.5): API KHÔNG còn kiểm trùng SĐT (không còn 409 trùng SĐT, hai khách được phép cùng
 * SĐT, SĐT có thể để trống) nên script không dò theo SĐT. Tính idempotent nằm trong chính script: mỗi khách khóa theo
 * `sheetRow` trong file tiến độ (ghi ngay sau khi tạo thành công) + header `X-Idempotency-Key` cố định theo `sheetRow`
 * (chặn trùng khi tiến trình chết giữa lúc API đã tạo khách và lúc ghi file tiến độ, trong cửa sổ TTL của khóa, mặc định 5 phút).
 * Khóa idempotency phía API chỉ gắn theo tài khoản + route, KHÔNG gắn file nguồn; nên khóa script gửi lên có thêm mã băm
 * 8 ký tự của NỘI DUNG file nguồn: `care-import-<hash8>-customer-<sheetRow>`. Nhờ vậy chạy file/sheet B bằng cùng tài khoản
 * ngay sau file A (trùng `sheetRow`) không bị API trả lại response đã lưu của khách A (mất dữ liệu im lặng). Hệ quả: sửa nội
 * dung file giữa hai lần chạy thì khóa đổi, mất lớp chặn trùng 5 phút nói trên (file tiến độ vẫn là lớp chặn chính).
 * Giới hạn: API không báo "response lặp" (không có header/flag replay) nên script không phân biệt được khách vừa tạo với khách
 * lấy lại từ khóa; script chỉ đối chiếu tên khách trong response với tên trong file để bắt trường hợp lấy nhầm khách khác.
 * Mỗi request có timeout (mặc định 30 giây, đổi bằng `--timeout-ms`); lỗi mạng/timeout của một dòng được ghi vào mục LỖI và
 * script chạy tiếp các dòng sau (dòng lỗi mạng khi tạo khách: chạy lại trong 5 phút để khóa idempotency chặn trùng).
 * ĐỪNG xóa file tiến độ rồi chạy lại trên dữ liệu đã nhập: sẽ tạo khách trùng. Muốn nhập lại một dòng: dùng `--only-rows`
 * sau khi chủ động xóa mục của dòng đó khỏi file tiến độ.
 *
 * Quy tắc phân quyền của API quyết định cách nhập:
 * - Tác giả nhật ký = tài khoản đang gọi API (API không nhận authorId) => khách của ai thì phải đăng nhập bằng tài khoản
 *   người đó. Tài khoản phụ truyền qua IMPORT_ACCOUNTS='{"email":"mật khẩu"}'. Khách của người chưa có tài khoản bị BỎ QUA
 *   (báo trong tổng kết), không bao giờ gán nhầm sang người khác.
 * - Nhân viên (STAFF) tạo khách thì tự là phụ trách chính (không được gửi careTeam); Quản lý/Quản trị phải gửi careTeam
 *   và Quản lý chỉ phân được cho chính mình (hoặc người trong nhóm mình quản lý).
 * - Khách chưa có Sale trong sheet: mặc định BỎ QUA; `--unassigned=me` gán cho tài khoản chính (Quản trị thì để trống).
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';

const args = parseArgs(process.argv.slice(2));
const BASE_URL = (
  args['base-url'] ||
  process.env.IMPORT_BASE_URL ||
  'http://localhost:3000/api/v1'
).replace(/\/$/, '');
const DRY_RUN = Boolean(args['dry-run']);
const UNASSIGNED = args.unassigned || 'skip'; // skip | me
const DELAY_MS = Number(args['delay-ms'] || 0);
const ONLY_ROWS = args['only-rows']
  ? new Set(String(args['only-rows']).split(',').map((n) => Number(n.trim())))
  : null;
const MAX_RETRY_429 = 3;
const TIMEOUT_MS = Number(args['timeout-ms'] || 30_000);

if (!args.file) fail('Thiếu --file <đường dẫn crm-care-import.json>');
if (!['skip', 'me'].includes(UNASSIGNED)) fail('--unassigned chỉ nhận skip | me');
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS < 1) fail('--timeout-ms phải là số dương (mili giây)');
const STATE_PATH = args.state || `${args.file}.import-state.json`;

const PRIMARY_EMAIL = (process.env.IMPORT_EMAIL || '').trim().toLowerCase();
const PRIMARY_PASSWORD = process.env.IMPORT_PASSWORD || '';
if (!PRIMARY_EMAIL || !PRIMARY_PASSWORD) {
  fail('Thiếu biến môi trường IMPORT_EMAIL / IMPORT_PASSWORD (tài khoản chính)');
}
const EXTRA_ACCOUNTS = parseJsonEnv('IMPORT_ACCOUNTS');

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gọi API; trả `{status, body}` (không ném lỗi theo HTTP status). 401 => đăng nhập lại 1 lần; 429 => chờ rồi thử lại.
 * Lỗi mạng/timeout KHÔNG ném: trả `{status: 0, networkError}` để dòng đang xử lý được ghi vào mục LỖI mà script vẫn chạy tiếp.
 */
async function call(session, method, path, { body, headers = {}, query } = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  for (let attempt = 0, relogged = false; ; attempt++) {
    let res;
    let text;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await res.text();
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      const reason = timedOut ? `quá ${TIMEOUT_MS} ms không phản hồi` : e?.cause?.code || e?.message || String(e);
      return { status: 0, body: null, networkError: `${method} ${path}: ${reason}` };
    }
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (res.status === 401 && session && !relogged && session.email) {
      relogged = true;
      try {
        await login(session);
      } catch (e) {
        return { status: 401, body: { message: e.message } };
      }
      continue;
    }
    if (res.status === 429 && attempt < MAX_RETRY_429) {
      console.log('  … bị giới hạn tốc độ, chờ 61 giây rồi thử lại');
      await sleep(61_000);
      continue;
    }
    return { status: res.status, body: parsed };
  }
}

async function login(session) {
  const res = await call(null, 'POST', '/auth/login', {
    body: { email: session.email, password: session.password },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Đăng nhập ${session.email} thất bại (${errText(res)})`);
  }
  session.token = res.body.accessToken;
  session.user = res.body.user;
  return session;
}

const errText = (res) =>
  res.networkError
    ? `lỗi mạng (${res.networkError})`
    : `HTTP ${res.status} ${res.body?.error?.code || res.body?.code || ''} ${
        res.body?.error?.message || res.body?.message || ''
      }`.trim();

// ---------------------------------------------------------------------------
// Danh mục để đổi "$loại:khóa" thành ObjectId
// ---------------------------------------------------------------------------

async function listAll(session, path) {
  const out = [];
  for (let page = 1; ; page++) {
    const res = await call(session, 'GET', path, { query: { page, limit: 100 } });
    if (res.status !== 200) throw new Error(`GET ${path} thất bại: ${errText(res)}`);
    out.push(...res.body.data);
    if (page >= (res.body.meta?.totalPages || 1)) return out;
  }
}

async function loadCatalogs(session) {
  const [statuses, sources, results, projects, areas] = await Promise.all([
    listAll(session, '/crm/customer-statuses'),
    listAll(session, '/crm/lead-sources'),
    listAll(session, '/crm/contact-results'),
    listAll(session, '/crm/projects'),
    listAll(session, '/crm/areas'),
  ]);
  const byCode = (items) => new Map(items.map((i) => [i.code, i.id]));
  return {
    status: byCode(statuses),
    source: byCode(sources),
    contactResult: byCode(results),
    project: byCode(projects),
    area: new Map(areas.map((a) => [a.name.trim().toLowerCase(), a.id])),
  };
}

/** Đổi một giá trị `$loại:khóa`; trả `undefined` nếu không tìm thấy (ghi cảnh báo). */
function resolveRef(token, catalogs, warnings) {
  const m = /^\$(status|source|contactResult|project|area):(.+)$/.exec(token);
  if (!m) return token;
  const [, kind, key] = m;
  const id = catalogs[kind].get(kind === 'area' ? key.trim().toLowerCase() : key);
  if (!id) warnings.push(`không có ${kind} "${key}" trong hệ thống`);
  return id;
}

// ---------------------------------------------------------------------------
// Tiến độ (resume)
// ---------------------------------------------------------------------------

async function loadState() {
  try {
    await access(STATE_PATH);
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    return { customers: {} };
  }
}
const saveState = (state) =>
  DRY_RUN ? Promise.resolve() : writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rawSource = await readFile(args.file, 'utf8');
const data = JSON.parse(rawSource);
// Mã băm nội dung file nguồn gắn vào mọi khóa idempotency (API chỉ gắn khóa theo tài khoản + route, không theo file).
const SOURCE_TAG = createHash('sha256').update(rawSource).digest('hex').slice(0, 8);
const state = await loadState();
console.log(`Tiến độ: ${STATE_PATH} (${Object.keys(state.customers).length} khách đã ghi nhận)`);

const sessions = new Map(); // email -> session
const primary = await login({ email: PRIMARY_EMAIL, password: PRIMARY_PASSWORD });
sessions.set(PRIMARY_EMAIL, primary);
for (const [email, password] of Object.entries(EXTRA_ACCOUNTS)) {
  const key = email.trim().toLowerCase();
  if (key === PRIMARY_EMAIL) continue;
  try {
    sessions.set(key, await login({ email: key, password }));
  } catch (e) {
    console.log(`! ${e.message} — khách của tài khoản này sẽ bị bỏ qua`);
  }
}
console.log(
  `API ${BASE_URL} ${DRY_RUN ? '[DRY-RUN]' : '[GHI THẬT]'} — tài khoản: ` +
    [...sessions.values()].map((s) => `${s.email} (${s.user.role})`).join(', '),
);

const catalogs = await loadCatalogs(primary);
const summary = { created: 0, logs: 0, skipped: [], failed: [], warnings: [] };

for (const item of data.customers) {
  if (ONLY_ROWS && !ONLY_ROWS.has(item.sheetRow)) continue;
  const label = `#${item.sheetRow} ${item.createCustomer.fullName}`;
  const done = state.customers[item.sheetRow];
  if (done?.status === 'done') continue;

  // Xác định tài khoản gọi API
  const ownerToken = item.createCustomer.careTeam?.primaryUserId; // "$user:<email>"
  let session;
  if (ownerToken) {
    const email = ownerToken.replace(/^\$user:/, '').toLowerCase();
    session = sessions.get(email);
    if (!session) {
      summary.skipped.push(`${label}: chưa có mật khẩu của ${email}`);
      continue;
    }
  } else if (UNASSIGNED === 'me') {
    session = primary;
  } else {
    summary.skipped.push(`${label}: chưa có Sale (dùng --unassigned=me để gán cho tài khoản chính)`);
    continue;
  }

  // Dựng body theo đúng hợp đồng CreateCustomerDto
  const warnings = [];
  const body = { ...item.createCustomer };
  for (const key of ['statusId', 'sourceId', 'areaId']) {
    if (body[key] === undefined) continue;
    const id = resolveRef(body[key], catalogs, warnings);
    if (id) body[key] = id;
    else delete body[key];
  }
  if (body.interestedProjectIds) {
    body.interestedProjectIds = body.interestedProjectIds
      .map((t) => resolveRef(t, catalogs, warnings))
      .filter(Boolean);
  }
  delete body.careTeam;
  if (session.user.role !== 'STAFF') {
    // Quản lý/Quản trị: gửi careTeam tự phân cho chính mình (Quản trị + khách chưa có Sale thì để trống)
    if (ownerToken || session.user.role === 'MANAGER') {
      body.careTeam = { memberIds: [session.user._id], primaryUserId: session.user._id };
    }
  }
  summary.warnings.push(...warnings.map((w) => `${label}: ${w}`));

  const logs = item.careLogs.map((l) => {
    const w = [];
    const req = { content: l.content, contactChannel: l.contactChannel, occurredAt: l.occurredAt };
    if (l.contactResultId) {
      const id = resolveRef(l.contactResultId, catalogs, w);
      if (id) req.contactResultId = id;
    }
    summary.warnings.push(...w.map((x) => `${label}: ${x}`));
    return req;
  });

  if (DRY_RUN) {
    console.log(`  ${label} → ${session.email} (${session.user.role}), ${logs.length} nhật ký`);
    continue;
  }

  // Tạo khách (hoặc dùng lại khách đã tạo ở lần chạy trước). Không dò trùng theo SĐT: API cho phép trùng/không có SĐT;
  // HTTP 409 ở đây chỉ có thể là xung đột khóa idempotency (yêu cầu cùng khóa đang chạy) => tính là lỗi, chạy lại sau.
  let customerId = done?.customerId;
  if (!customerId) {
    const res = await call(session, 'POST', '/crm/customers', {
      body,
      headers: { 'X-Idempotency-Key': `care-import-${SOURCE_TAG}-customer-${item.sheetRow}` },
    });
    if (res.status === 201 || res.status === 200) {
      const returned = res.body?.data;
      // Phòng thủ: response (có thể là bản lưu theo khóa idempotency) phải đúng là khách của dòng này, không thì KHÔNG ghi done.
      if (!returned?.id || (returned.fullName !== undefined && !sameName(returned.fullName, body.fullName))) {
        summary.failed.push(
          `${label}: response tạo khách không khớp dòng này (nhận "${returned?.fullName ?? '?'}"), không ghi tiến độ`,
        );
        continue;
      }
      customerId = returned.id;
      summary.created++;
    } else {
      summary.failed.push(
        `${label}: tạo khách ${errText(res)}` +
          (res.networkError ? ' — chưa rõ API đã tạo khách chưa: chạy lại trong 5 phút (khóa idempotency chặn trùng), quá 5 phút thì kiểm tra tay' : ''),
      );
      continue;
    }
    state.customers[item.sheetRow] = { status: 'partial', customerId, logsDone: 0 };
    await saveState(state);
  }

  // Ghi nhật ký theo thứ tự thời gian
  let ok = true;
  for (let i = state.customers[item.sheetRow].logsDone || 0; i < logs.length; i++) {
    const res = await call(session, 'POST', `/crm/customers/${customerId}/care-logs`, {
      body: logs[i],
      headers: { 'X-Idempotency-Key': `care-import-${SOURCE_TAG}-log-${item.sheetRow}-${i}` },
    });
    if (res.status !== 201 && res.status !== 200) {
      summary.failed.push(`${label}: nhật ký ${i + 1}/${logs.length} ${errText(res)}`);
      ok = false;
      break;
    }
    state.customers[item.sheetRow].logsDone = i + 1;
    summary.logs++;
    await saveState(state);
    if (DELAY_MS) await sleep(DELAY_MS);
  }
  if (ok) state.customers[item.sheetRow].status = 'done';
  await saveState(state);
  console.log(`  ${ok ? 'OK ' : 'LỖI'} ${label} (${logs.length} nhật ký)`);
  if (DELAY_MS) await sleep(DELAY_MS);
}

console.log('\n===== TỔNG KẾT =====');
console.log(`Khách tạo mới: ${summary.created} | nhật ký đã ghi: ${summary.logs}`);
console.log(
  '(Lưu ý: API không báo "response lặp" nên con số khách tạo mới có thể gồm khách lấy lại từ khóa idempotency khi chạy lại trong 5 phút.)',
);
for (const [title, list] of [
  ['Bỏ qua', summary.skipped],
  ['Cảnh báo', summary.warnings],
  ['LỖI', summary.failed],
]) {
  if (!list.length) continue;
  console.log(`\n${title} (${list.length}):`);
  for (const line of list) console.log(`  - ${line}`);
}
if (summary.failed.length) process.exitCode = 1;

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

/** So tên khách bỏ khác biệt khoảng trắng đầu/cuối/lặp (API có thể chuẩn hóa khoảng trắng). */
function sameName(a, b) {
  const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
  return norm(a) === norm(b);
}

function parseJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return fail(`${name} phải là JSON dạng {"email":"mật khẩu"}`);
  }
}

function fail(message) {
  console.error(`Lỗi: ${message}`);
  process.exit(2);
}
