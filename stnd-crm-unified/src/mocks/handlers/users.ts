import type { UserListItem, UserRole, UserStatus } from '../../types/user';
import { MOCK_USER } from '../mockUser';
import type { MockRoute } from '../types';
import { fail, filterBySearch, mockObjectId, ok, paginate } from '../utils';
import { readString } from './shared';

const ROLES: readonly UserRole[] = ['ADMIN', 'EDITOR'];
const STATUSES: readonly UserStatus[] = ['ACTIVE', 'BLOCKED'];

const isRole = (value: string | undefined): value is UserRole => ROLES.includes(value as UserRole);
const isStatus = (value: string | undefined): value is UserStatus => STATUSES.includes(value as UserStatus);

/** Danh sách user — phần tử đầu là tài khoản đang đăng nhập (MOCK_USER). */
const users: UserListItem[] = [
  {
    _id: MOCK_USER._id,
    email: MOCK_USER.email,
    displayName: MOCK_USER.displayName,
    role: MOCK_USER.role,
    status: MOCK_USER.status ?? 'ACTIVE',
  },
  ...(
    [
      ['tran.minh.khoa@stnd.vn', 'Trần Minh Khoa', 'ADMIN', 'ACTIVE'],
      ['le.thu.ha@stnd.vn', 'Lê Thu Hà', 'EDITOR', 'ACTIVE'],
      ['pham.quoc.bao@stnd.vn', 'Phạm Quốc Bảo', 'EDITOR', 'ACTIVE'],
      ['vo.ngoc.anh@stnd.vn', 'Võ Ngọc Anh', 'EDITOR', 'BLOCKED'],
      ['hoang.duc.thinh@stnd.vn', 'Hoàng Đức Thịnh', 'EDITOR', 'ACTIVE'],
      ['dang.thanh.truc@stnd.vn', 'Đặng Thanh Trúc', 'EDITOR', 'ACTIVE'],
      ['bui.gia.huy@stnd.vn', 'Bùi Gia Huy', 'ADMIN', 'ACTIVE'],
      ['ngo.my.linh@stnd.vn', 'Ngô Mỹ Linh', 'EDITOR', 'BLOCKED'],
      ['do.van.tai@stnd.vn', 'Đỗ Văn Tài', 'EDITOR', 'ACTIVE'],
      ['huynh.kim.ngan@stnd.vn', 'Huỳnh Kim Ngân', 'EDITOR', 'ACTIVE'],
      ['phan.nhat.nam@stnd.vn', 'Phan Nhật Nam', 'EDITOR', 'ACTIVE'],
    ] as const
  ).map(([email, displayName, role, status], index) => ({
    _id: `6650a1f0c0ffee00000000${(index + 2).toString(16).padStart(2, '0')}`,
    email,
    displayName,
    role,
    status,
  })),
];

const findUser = (id: string): UserListItem | undefined => users.find((user) => user._id === id);

/** `/users` — quản lý tài khoản (ADMIN). Danh sách trả `{ data, meta }`, các thao tác ghi trả user trực tiếp. */
export const usersRoutes: MockRoute[] = [
  {
    method: 'GET',
    pattern: /^\/users$/,
    handler: ({ query }) => ok(paginate(filterBySearch(users, query.get('search'), ['email', 'displayName']), query)),
  },
  {
    method: 'POST',
    pattern: /^\/users$/,
    handler: ({ body, path }) => {
      const email = readString(body, 'email')?.trim().toLowerCase();
      const displayName = readString(body, 'displayName')?.trim();
      const role = readString(body, 'role');
      const password = readString(body, 'password') ?? '';
      if (!email || !displayName) return fail(400, 'Email và tên hiển thị không được để trống', path);
      if (password.length < 8) return fail(400, 'Mật khẩu phải có ít nhất 8 ký tự', path);
      if (!isRole(role)) return fail(400, 'Role không hợp lệ', path);
      if (users.some((user) => user.email === email)) return fail(409, 'Email đã tồn tại', path);
      // Không lưu password — prototype chỉ cần user hiển thị trong bảng.
      const created: UserListItem = { _id: mockObjectId(), email, displayName, role, status: 'ACTIVE' };
      users.push(created);
      return { data: created, status: 201 };
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/users\/([^/]+)\/status$/,
    handler: ({ params, body, path }) => {
      const user = findUser(params[0]);
      const status = readString(body, 'status');
      if (!user) return fail(404, 'Không tìm thấy người dùng', path);
      if (!isStatus(status)) return fail(400, 'Trạng thái không hợp lệ', path);
      if (user._id === MOCK_USER._id && status === 'BLOCKED') {
        return fail(400, 'Không thể tự khoá tài khoản của chính mình', path);
      }
      user.status = status;
      return ok(user);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/users\/([^/]+)\/role$/,
    handler: ({ params, body, path }) => {
      const user = findUser(params[0]);
      const role = readString(body, 'role');
      if (!user) return fail(404, 'Không tìm thấy người dùng', path);
      if (!isRole(role)) return fail(400, 'Role không hợp lệ', path);
      user.role = role;
      return ok(user);
    },
  },
];
