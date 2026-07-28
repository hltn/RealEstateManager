# AUTH MODULE — Tài liệu Kiến trúc (Architect Agent Output)

  

> Tài liệu này được viết dựa trên `AUTH_MODULE_PLAN.md` (pm-agent), audit codebase thực tế, và skill `nodejs-react-mongo-coding-guidelines`.  

> Đây là **Milestone 0** — input bắt buộc cho `coder-backend-agent` và `coder-frontend-agent`.

  

---

  

## 1. Tổng quan kiến trúc

  

Hệ thống Auth sử dụng mô hình **stateless JWT** với 2 loại token:


| Token                       | Lưu ở                               | TTL     | Mục đích                                         |
| --------------------------- | ----------------------------------- | ------- | ------------------------------------------------ |
| Access Token (JWT)          | Frontend RAM (Zustand store)        | 15 phút | Xác thực mỗi request qua `Authorization: Bearer` |
| Refresh Token (opaque UUID) | httpOnly Cookie (`SameSite=Strict`) | 7 ngày  | Cấp mới Access Token khi hết hạn                 |
  

Refresh Token được **hash SHA-256** trước khi lưu DB — không bao giờ lưu raw token.

  

---

  

## 2. Quyết định Công nghệ

  

| Hạng mục            | Chọn                                       | Lý do                                                                  |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| JWT                 | `@nestjs/jwt` (không dùng Passport)        | Đủ dùng, ít dependency, dễ kiểm soát guard                             |
| Password Hash       | `argon2`                                   | Bền hơn bcrypt trước GPU attack, chuẩn OWASP 2024                      |
| Cookie              | `@fastify/cookie`                          | Backend dùng Fastify (không phải Express)                              |
| Rate Limit          | `@nestjs/throttler` (in-memory)            | Single instance hiện tại, nâng Redis sau nếu cần                       |
| Refresh Token store | MongoDB `refresh_tokens` collection        | Không thêm Redis ở MVP, TTL index tự dọn                               |
| Frontend HTTP       | `axios`                                    | Hỗ trợ interceptor cho auto-refresh (fetch không có)                   |
| Frontend State      | `zustand`                                  | Quy chuẩn project cho global state                                     |
| Frontend Form       | `react-hook-form` + `zod`                  | Validate login form, type-safe schema                                  |
| Guard pattern       | Global `APP_GUARD` + `@Public()` decorator | Secure-by-default: mọi route đều cần auth trừ khi đánh dấu `@Public()` |
  

---

  

## 3. Dependencies cần thêm

  

### Backend (`RealEstateBackendApp/package.json`)

  

```bash

npm install @nestjs/jwt @nestjs/throttler @fastify/cookie argon2

npm install -D @types/argon2

```

  

### Frontend (`RealEstateAdminApp/package.json`)

  

```bash

npm install axios zustand react-hook-form zod @hookform/resolvers

```

  

---

  

## 4. Module Structure

  

### Backend

  

```

src/

├── common/

│   ├── decorators/

│   │   ├── public.decorator.ts          # @Public() — bỏ qua JwtAuthGuard

│   │   ├── roles.decorator.ts           # @Roles(UserRole.ADMIN)

│   │   └── current-user.decorator.ts   # @CurrentUser() — inject user từ request

│   ├── guards/

│   │   ├── jwt-auth.guard.ts           # Validate Bearer token, attach user vào request

│   │   └── roles.guard.ts              # Kiểm tra role từ metadata

│   └── enums/

│       ├── user-role.enum.ts           # ADMIN | EDITOR

│       └── user-status.enum.ts         # ACTIVE | BLOCKED

│

├── modules/

│   ├── auth/

│   │   ├── auth.module.ts

│   │   ├── auth.controller.ts          # /auth/login, /auth/refresh, /auth/logout, /auth/me

│   │   ├── auth.service.ts             # login, refresh, logout, validateUser

│   │   ├── schemas/

│   │   │   └── refresh-token.schema.ts

│   │   └── dtos/

│   │       ├── login.dto.ts

│   │       └── auth-response.dto.ts

│   │

│   └── users/

│       ├── users.module.ts

│       ├── users.controller.ts         # /users (ADMIN only)

│       ├── users.service.ts

│       ├── schemas/

│       │   └── user.schema.ts

│       └── dtos/

│           ├── create-user.dto.ts

│           ├── update-user-status.dto.ts

│           └── update-user-role.dto.ts

```

  

### Frontend

  

```

src/

├── api/

│   ├── axios.ts                        # Axios instance + interceptors

│   └── auth.api.ts                     # login, refresh, logout, getMe

│

├── stores/

│   └── auth.store.ts                   # Zustand: accessToken, user, setAuth, clearAuth

│

├── hooks/

│   └── useAuth.ts                      # Wrapper hook cho auth store

│

├── components/

│   └── auth/

│       ├── ProtectedRoute.tsx          # Redirect về /login nếu chưa auth

│       └── RoleGuard.tsx               # Ẩn/hiện element theo role

│

└── screens/

    ├── LoginScreen.tsx                 # Form email/password

    └── UserManagementScreen.tsx        # Quản lý tài khoản (ADMIN only)

```

  

---

  

## 5. Data Model

  

### Collection: `users`

  

| Field         | Type     | Constraint                             | Ghi chú                          |
| ------------- | -------- | -------------------------------------- | -------------------------------- |
| `_id`         | ObjectId | PK                                     |                                  |
| `email`       | String   | required, unique, lowercase            | Index                            |
| `password`    | String   | required, select: false                | Hash Argon2, KHÔNG trả ra API    |
| `displayName` | String   | required                               | Tên hiển thị                     |
| `role`        | Enum     | `ADMIN \| EDITOR`, default: `EDITOR`   |                                  |
| `status`      | Enum     | `ACTIVE \| BLOCKED`, default: `ACTIVE` |                                  |
| `lastLoginAt` | Date     | nullable                               | Cập nhật khi login thành công    |
| `deletedAt`   | Date     | nullable, default: null                | Soft delete — quy chuẩn bắt buộc |
| `createdAt`   | Date     | auto                                   | timestamps: true                 |
| `updatedAt`   | Date     | auto                                   | timestamps: true                 |
  

**Indexes:**

- `{ email: 1, deletedAt: 1 }` — unique compound (hỗ trợ soft delete)

- `{ status: 1 }` — filter user active/blocked

  

### Collection: `refresh_tokens`

  

| Field                 | Type     | Constraint          | Ghi chú                                    |
| --------------------- | -------- | ------------------- | ------------------------------------------ |
| `_id`                 | ObjectId | PK                  |                                            |
| `tokenHash`           | String   | required, index     | SHA-256 của raw token                      |
| `userId`              | ObjectId | required, ref: User |                                            |
| `familyId`            | String   | required, index     | UUID — nhóm các token trong cùng 1 phiên   |
| `isRevoked`           | Boolean  | default: false      |                                            |
| `replacedByTokenHash` | String   | nullable            | Trỏ tới token kế tiếp (audit trail)        |
| `expiresAt`           | Date     | required            | TTL index — MongoDB tự xóa sau khi hết hạn |
| `createdAt`           | Date     | auto                |                                            |

  

**Indexes:**

- `{ tokenHash: 1 }` — lookup khi refresh/logout

- `{ userId: 1 }` — revoke theo user

- `{ familyId: 1 }` — revoke cả family khi phát hiện reuse

- `{ expiresAt: 1 }` — TTL index (`expireAfterSeconds: 0`)

  

---

  

## 6. API Contract

  

### 6.1 Auth endpoints

  

#### `POST /api/v1/auth/login`

- **Guard:** `@Public()` + `@Throttle({ default: { limit: 5, ttl: 60000 } })`

- **Request body:**

  ```json

  { "email": "admin@example.com", "password": "password123" }

  ```

- **Response 200:**

  ```json

  {

    "accessToken": "<JWT>",

    "user": { "_id": "...", "email": "...", "displayName": "...", "role": "ADMIN" }

  }

  ```

- **Set-Cookie:** `refreshToken=<uuid>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh; Max-Age=604800`

- **Errors:** `401` sai email/pass, `403` tài khoản bị khóa, `429` quá rate limit

  

#### `POST /api/v1/auth/refresh`

- **Guard:** `@Public()` (đọc cookie, không cần Bearer)

- **Cookie required:** `refreshToken`

- **Response 200:**

  ```json

  { "accessToken": "<JWT_mới>" }

  ```

- **Set-Cookie:** refresh token mới (rotation)

- **Errors:** `401` token không tồn tại / đã revoke / hết hạn

  

#### `POST /api/v1/auth/logout`

- **Guard:** `JwtAuthGuard`

- **Cookie required:** `refreshToken`

- **Response 200:** `{ "message": "Logged out successfully" }`

- **Action:** revoke token trong DB + clear cookie

  

#### `GET /api/v1/auth/me`

- **Guard:** `JwtAuthGuard`

- **Response 200:**

  ```json

  { "_id": "...", "email": "...", "displayName": "...", "role": "ADMIN", "status": "ACTIVE" }

  ```

  

### 6.2 User Management endpoints (ADMIN only)

  

#### `GET /api/v1/users`

- **Guard:** `JwtAuthGuard` + `@Roles(UserRole.ADMIN)`

- **Query params:** `page=1&limit=20`

- **Response 200:**

  ```json

  {

    "data": [{ "_id": "...", "email": "...", "displayName": "...", "role": "EDITOR", "status": "ACTIVE" }],

    "meta": { "total": 10, "page": 1, "limit": 20, "totalPages": 1 }

  }

  ```

  

#### `POST /api/v1/users`

- **Guard:** `JwtAuthGuard` + `@Roles(UserRole.ADMIN)`

- **Request body:** `{ "email": "...", "password": "...", "displayName": "...", "role": "EDITOR" }`

- **Response 201:** User object (không có `password`)

  

#### `PATCH /api/v1/users/:id/status`

- **Guard:** `JwtAuthGuard` + `@Roles(UserRole.ADMIN)`

- **Request body:** `{ "status": "BLOCKED" | "ACTIVE" }`

- **Constraint:** Không được block chính mình

- **Response 200:** User object đã cập nhật

  

#### `PATCH /api/v1/users/:id/role`

- **Guard:** `JwtAuthGuard` + `@Roles(UserRole.ADMIN)`

- **Request body:** `{ "role": "ADMIN" | "EDITOR" }`

- **Response 200:** User object đã cập nhật

  

---

  

## 7. Luồng xử lý chính

  

### 7.1 Login Flow

  

```

Client                    AuthController           AuthService              MongoDB

  |                            |                       |                       |

  |-- POST /auth/login ------->|                       |                       |

  |   { email, password }      |-- validateUser() ---->|                       |

  |                            |                       |-- findOne(email) ---->|

  |                            |                       |<-- User doc ----------|

  |                            |                       |-- argon2.verify() ----|

  |                            |                       |-- check status ACTIVE-|

  |                            |                       |-- sign accessToken ---|

  |                            |                       |-- generate UUID ------|

  |                            |                       |-- hash SHA-256 -------|

  |                            |                       |-- save RefreshToken ->|

  |                            |<-- { accessToken, user, cookie } ------------|

  |<-- 200 + Set-Cookie -------|                       |                       |

```

  

### 7.2 Token Refresh Flow (Rotation + Reuse Detection)

  

```

Client                    AuthController           AuthService              MongoDB

  |                            |                       |                       |

  |-- POST /auth/refresh ------>|                       |                       |

  |   Cookie: refreshToken      |-- refresh(token) ---->|                       |

  |                            |                       |-- hash token ---------|

  |                            |                       |-- findOne(tokenHash)->|

  |                            |                       |<-- RefreshToken doc --|

  |                            |                       |                       |

  |                            |  [Nếu isRevoked=true: phát hiện token reuse!] |

  |                            |                       |-- revokeFamily() ---->|

  |                            |<-- 401 UnauthorizedException -----------------|

  |                            |                       |                       |

  |                            |  [Nếu hợp lệ:]        |                       |

  |                            |                       |-- mark old isRevoked->|

  |                            |                       |-- create new token -->|

  |                            |                       |-- sign new accessToken|

  |<-- 200 + new Set-Cookie ----|                       |                       |

```

  

### 7.3 Guard Flow (mỗi request)

  

```

Request -> FastifyPlugin (@fastify/cookie parse cookies)

        -> JwtAuthGuard:

             if @Public() → skip

             extract "Bearer <token>" from Authorization header

             jwt.verify(token, secret) → payload

             attach payload to request.user

        -> RolesGuard:

             if no @Roles() metadata → allow (authenticated là đủ)

             if request.user.role in allowedRoles → allow

             else → throw ForbiddenException (403)

        -> Controller method

```

  

### 7.4 Admin Seed (khởi động lần đầu)

  

Khi `AuthModule` khởi tạo (`onModuleInit`), `AuthService` kiểm tra:

- Nếu `users` collection rỗng → tạo tài khoản Admin từ env vars:

  - `ADMIN_EMAIL` (default: `admin@example.com`)

  - `ADMIN_PASSWORD` (default: `Admin@123456`)

  - `ADMIN_DISPLAY_NAME` (default: `System Admin`)

- Log cảnh báo nếu dùng credentials mặc định.

  

---

  

## 8. Guards & Decorators

  

### `JwtAuthGuard` (`src/common/guards/jwt-auth.guard.ts`)

  

- Implement `CanActivate`

- Đọc `Authorization: Bearer <token>` header từ FastifyRequest

- Dùng `JwtService.verify()` để validate

- Nếu route có `IS_PUBLIC_KEY` metadata → bypass

- Nếu token invalid/expired → `UnauthorizedException(401)`

- Attach decoded payload vào `request.user`

  

### `RolesGuard` (`src/common/guards/roles.guard.ts`)

  

- Implement `CanActivate`

- Đọc `ROLES_KEY` metadata từ handler và class

- Nếu không có metadata → pass (chỉ cần authenticated)

- Nếu `request.user.role` không nằm trong `allowedRoles` → `ForbiddenException(403)`

  

### Decorators

  

```typescript

// @Public() — route không cần JWT

export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

  

// @Roles(...roles) — chỉ cho phép role cụ thể

export const ROLES_KEY = 'roles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

  

// @CurrentUser() — inject user từ request vào param

export const CurrentUser = createParamDecorator(

  (data: unknown, ctx: ExecutionContext) => {

    const request = ctx.switchToHttp().getRequest();

    return request.user;

  },

);

```

  

### Đăng ký global guards trong `AppModule`

  

```typescript

providers: [

  { provide: APP_GUARD, useClass: JwtAuthGuard },

  { provide: APP_GUARD, useClass: RolesGuard },

]

```

  

---

  

## 9. Cấu hình `main.ts` — thay đổi cần thiết

  

```typescript

// Thêm @fastify/cookie

await app.register(fastifyCookie, {

  secret: configService.get('COOKIE_SECRET'),

});

  

// CORS: cần credentials=true cho cookie cross-origin (dev)

app.enableCors({

  origin: configService.get('FRONTEND_URL') || 'http://localhost:5173',

  credentials: true,

});

```

  

---

  

## 10. Cấu hình `AuthModule`

  

```typescript

@Module({

  imports: [

    MongooseModule.forFeature([

      { name: User.name, schema: UserSchema },           // từ UsersModule

      { name: RefreshToken.name, schema: RefreshTokenSchema },

    ]),

    JwtModule.registerAsync({

      inject: [ConfigService],

      useFactory: (config: ConfigService) => ({

        secret: config.get('JWT_SECRET'),

        signOptions: { expiresIn: '15m' },

      }),

    }),

    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

  ],

  ...

})

```

  

### Login endpoint throttle riêng:

```typescript

@Throttle({ default: { limit: 5, ttl: 60000 } })

@Post('login')

```

  

---

  

## 11. RBAC Matrix

  

| Endpoint                       | Public | EDITOR | ADMIN |
| ------------------------------ | :----: | :----: | :---: |
| `POST /auth/login`             |   ✅    |   ✅    |   ✅   |
| `POST /auth/refresh`           |   ✅    |   ✅    |   ✅   |
| `POST /auth/logout`            |   ❌    |   ✅    |   ✅   |
| `GET /auth/me`                 |   ❌    |   ✅    |   ✅   |
| `GET /users`                   |   ❌    |   ❌    |   ✅   |
| `POST /users`                  |   ❌    |   ❌    |   ✅   |
| `PATCH /users/:id/status`      |   ❌    |   ❌    |   ✅   |
| `PATCH /users/:id/role`        |   ❌    |   ❌    |   ✅   |
| `GET /articles` (News)         |   ❌    |   ✅    |   ✅   |
| `POST /crawl`                  |   ❌    |   ❌    |   ✅   |
| `POST /articles/:id/publish`   |   ❌    |   ❌    |   ✅   |
| `DELETE /articles` (bulk)      |   ❌    |   ❌    |   ✅   |
| `POST /raw-articles/move-bulk` |   ❌    |   ❌    |   ✅   |
| `GET /raw-articles`            |   ❌    |   ✅    |   ✅   |
| `GET /health/*`                |   ✅    |   ✅    |   ✅   |
| `GET /api/v1/docs` (Swagger)   |   ✅    |   ✅    |   ✅   |

  

> **Nguyên tắc:** EDITOR chỉ đọc dữ liệu, không được thực hiện write/delete/publish. Mọi action ghi dữ liệu thuộc ADMIN. Có thể mở rộng quyền EDITOR ở Milestone sau nếu nghiệp vụ yêu cầu.

  

---

  

## 12. Frontend Architecture

  

### Axios Instance (`src/api/axios.ts`)

  

- `baseURL`: từ env `VITE_API_URL` (default `http://localhost:3000/api/v1`)

- `withCredentials: true` — gửi cookie tự động

- **Request interceptor:** đính `Authorization: Bearer <accessToken>` từ Zustand store

- **Response interceptor:**

  - Nếu `401` và chưa retry: gọi `POST /auth/refresh` lấy token mới, lưu vào store, retry request gốc

  - Nếu refresh fail: `clearAuth()` + redirect về `/login`

  

### Zustand Auth Store (`src/stores/auth.store.ts`)

  

```typescript

interface AuthState {

  accessToken: string | null;

  user: { _id: string; email: string; displayName: string; role: UserRole } | null;

  setAuth: (token: string, user: AuthState['user']) => void;

  clearAuth: () => void;

}

```

  

### App Routing (`src/App.tsx`) — cấu trúc mới

  

```tsx

<BrowserRouter>

  <Routes>

    <Route path="/login" element={<LoginScreen />} />

    <Route path="/" element={

      <ProtectedRoute>        {/* redirect → /login nếu chưa auth */}

        <AppLayout />

      </ProtectedRoute>

    }>

      <Route index element={<RawArticlesScreen />} />

      <Route path="manage-wp" element={<ManageWpScreen />} />

      <Route path="news-detail/:id" element={<NewsDetailScreen />} />

      <Route path="sources" element={<ManageSourcesScreen />} />

      <Route path="ai-config" element={<AiConfigScreen />} />

      <Route path="ai-prompt-config" element={<AiPromptConfigScreen />} />

      <Route path="cronjob" element={<CronjobScreen />} />

      <Route path="users" element={

        <RoleGuard allowedRoles={[UserRole.ADMIN]}>

          <UserManagementScreen />

        </RoleGuard>

      } />

    </Route>

  </Routes>

</BrowserRouter>

```

  

### App Init — kiểm tra session khi tải trang

  

Khi `App` mount, gọi `GET /auth/me`:

- Thành công → `setAuth(token, user)` (browser vẫn còn refresh cookie)

- Thất bại → `clearAuth()`, user thấy `/login`

  

---

  

## 13. Environment Variables cần thêm

  

### Backend (`.env`)

  

```env

JWT_SECRET=<random-256-bit-string>

JWT_ACCESS_EXPIRES_IN=15m

JWT_REFRESH_EXPIRES_IN=7d

COOKIE_SECRET=<random-256-bit-string>

FRONTEND_URL=http://localhost:5173

  

# Seed admin đầu tiên (thay đổi trước khi deploy production!)

ADMIN_EMAIL=admin@example.com

ADMIN_PASSWORD=Admin@123456

ADMIN_DISPLAY_NAME=System Admin

```

  

### Frontend (`.env`)

  

```env

VITE_API_URL=http://localhost:3000/api/v1

```

  

---

  

## 14. Impact Analysis — Module hiện có

  

### WI-07: Bảo vệ endpoint News/Crawler

  

Vì dùng global guard, **toàn bộ endpoint hiện tại sẽ tự động được bảo vệ** sau khi `AuthModule` được đăng ký vào `AppModule`. Không cần sửa từng controller của News module.

  

Chỉ cần thêm `@Public()` vào `/health/liveness` và `/health/readiness` để không ảnh hưởng Kubernetes probe.

  

**Rủi ro triển khai:** Sau khi bật Auth, mọi frontend request không có token sẽ nhận `401`. Cần deploy backend + frontend **đồng thời** sau khi WI-06, WI-12, WI-13 hoàn tất.

  

### Backward compatibility

  

- Không thay đổi schema hiện có (`news_articles`, `raw_articles`, `news_sources`)

- Thêm 2 collection mới: `users`, `refresh_tokens`

- Không ảnh hưởng `SettingsModule`, `HealthModule`

  

---

  

## 15. Checklist triển khai cho coder-agents

  

### `coder-backend-agent` (theo thứ tự)

  

- [ ] Cài packages: `@nestjs/jwt`, `@nestjs/throttler`, `@fastify/cookie`, `argon2`

- [ ] Tạo `UserRole` và `UserStatus` enum tại `src/common/enums/`

- [ ] Tạo `User` schema và `UsersModule` (WI-01)

- [ ] Tạo `RefreshToken` schema trong `AuthModule` (WI-01)

- [ ] Tạo `JwtAuthGuard`, `RolesGuard`, decorators tại `src/common/` (WI-03)

- [ ] Đăng ký global guards vào `AppModule`

- [ ] Đánh dấu `@Public()` cho `/health/liveness`, `/health/readiness`

- [ ] Implement `AuthService.login()`, `AuthService.refresh()`, `AuthService.logout()` (WI-06, WI-09)

- [ ] Implement `AuthController` với 4 endpoints (WI-02, WI-06)

- [ ] Implement Admin seed `onModuleInit` (WI-06)

- [ ] Cập nhật `main.ts`: đăng ký `@fastify/cookie`, cập nhật CORS (WI-04)

- [ ] Implement `UsersController` với 4 endpoints (WI-08)

- [ ] Thêm `@Throttle` riêng cho `POST /auth/login` (WI-10)

  

### `coder-frontend-agent` (theo thứ tự)

  

- [ ] Cài packages: `axios`, `zustand`, `react-hook-form`, `zod`, `@hookform/resolvers`

- [ ] Tạo Axios instance với interceptors tại `src/api/axios.ts` (WI-13)

- [ ] Tạo auth API functions tại `src/api/auth.api.ts` (WI-13)

- [ ] Tạo Zustand auth store tại `src/stores/auth.store.ts` (WI-04)

- [ ] Implement App init check (gọi `/auth/me` khi mount) (WI-13)

- [ ] Tạo `ProtectedRoute` và `RoleGuard` components (WI-14)

- [ ] Tái cấu trúc `App.tsx` routing với ProtectedRoute (WI-14)

- [ ] Implement `LoginScreen` với react-hook-form + zod (WI-12)

- [ ] Implement `UserManagementScreen` (WI-15)

- [ ] Thêm menu item "Quản lý tài khoản" vào `AppLayout` (chỉ hiển thị nếu role=ADMIN) (WI-14)

  

---

  

*Tài liệu này hoàn tất Milestone 0 — `coder-backend-agent` và `coder-frontend-agent` có thể bắt đầu implement.*