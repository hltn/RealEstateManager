# EXPORT GOOGLE DRIVE — Kiến trúc Chi tiết

> Tài liệu này được viết dựa trên `EXPORT_GDRIVE_RESEARCH.md`, `docs/intent/export-market-analysis-google-drive.md`, audit codebase thực tế, và skill `nodejs-react-mongo-coding-guidelines`.
>
> Đây là **input bắt buộc** cho `coder-backend-agent` và `coder-frontend-agent`.

---

## 1. Tổng quan Kiến trúc

Tính năng cho phép Admin/Editor export báo cáo phân tích thị trường (Market Analysis) lên Google Drive cá nhân qua OAuth2 User Flow.

### Quyết định Kiến trúc

| Hạng mục | Chọn | Lý do |
|----------|------|-------|
| Module | Mới: `google-drive-export` (standalone) | NewsFireCrawlManagerModule đã 1600+ dòng controller; Google Drive là tính năng riêng biệt |
| Export strategy | Tạo Google Doc mới mỗi lần | Market Analysis là snapshot — mỗi lần phân tích là bản ghi riêng, append không phù hợp |
| OAuth library | `googleapis` trực tiếp | Ít dependencies, auto-refresh token, NestJS DI-friendly, KHÔNG cần passport |
| Scope | `drive.file` (non-sensitive) | Đủ cho create doc + write content + move to folder; dễ verification |
| Content format | Google Docs native (không DOCX) | Hỗ trợ formatting đầy đủ qua Docs API batchUpdate |
| Markdown conversion | Custom parser (`marked` + Docs API batchUpdate) | Convert markdown tokens sang Docs API requests |
| Token storage | MongoDB `google_drive_tokens` collection | Consistent với existing stack |
| Folder selection | User input Google Drive folder URL (MVP) | Đơn giản; Google Picker là phase sau |
| Token ownership | Per-user (userId unique) | Mỗi user connect Drive riêng |

### Flow tổng quan

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React)                                   │
│  - Google Drive tab (Settings hoặc section riêng)   │
│  - Export button trên History row + Detail screen    │
│  - States: connected/disconnected, export states    │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│  Backend — google-drive-export module                │
│                                                     │
│  GoogleDriveController                              │
│    OAuth: GET /google-drive/auth/url                 │
│           GET /google-drive/auth/callback            │
│           GET /google-drive/status                   │
│           DELETE /google-drive/disconnect            │
│    Export: POST /google-drive/export/:historyId      │
│    Folder: POST /google-drive/folder/validate        │
│                                                     │
│  GoogleDriveOAuthService                            │
│    generateAuthUrl, exchangeCode, refreshToken,      │
│    getOAuth2Client, revokeToken                      │
│                                                     │
│  GoogleDriveExportService                           │
│    exportAnalysis → createDoc → batchUpdate → link   │
│                                                     │
│  MarkdownToGoogleDocsConverter                      │
│    markdown → Docs API Request[]                    │
│                                                     │
│  TokenSchema (Mongoose)                             │
│    userId, accessToken, refreshToken, expiresAt      │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│  Google APIs                                        │
│  - OAuth2: googleapis auth                          │
│  - Docs API: documents.create + batchUpdate          │
│  - Drive API: files.update (move to folder)          │
└─────────────────────────────────────────────────────┘
```

---

## 2. Dependencies cần thêm

### Backend (`RealEstateBackendApp/package.json`)

```bash
npm install googleapis marked
npm install -D @types/marked
```

`googleapis` bao gồm `google-auth-library` bên trong — KHÔNG cần cài riêng.

### Frontend

Không cần thêm dependency mới. Dùng `axios` + `@tanstack/react-query` + `lucide-react` icons hiện có.

---

## 3. Module Structure

### Backend

```
src/modules/google-drive-export/
├── google-drive-export.module.ts
├── google-drive.controller.ts        # OAuth + Export + Folder endpoints
├── services/
│   ├── google-drive-oauth.service.ts # OAuth2 flow: auth URL, code exchange, token refresh
│   ├── google-drive-export.service.ts # Export logic: create doc, batchUpdate, move to folder
│   └── markdown-to-docs.converter.ts  # Markdown → Google Docs API Request[]
├── schemas/
│   └── google-drive-token.schema.ts   # MongoDB schema cho OAuth tokens
└── dtos/
    ├── export-analysis.dto.ts         # Request DTO cho export endpoint
    └── folder-validate.dto.ts         # Request DTO cho folder validate
```

### Frontend

```
src/
├── api/
│   └── google-drive.api.ts           # API functions: getAuthUrl, getStatus, export, disconnect, validateFolder
├── context/
│   └── GoogleDriveAuthContext.tsx     # React Context cho Google Drive connection state
├── components/
│   └── google-drive/
│       ├── GoogleDriveStatusBadge.tsx  # Badge hiển thị connected/disconnected
│       ├── ExportButton.tsx            # Button export với state management
│       └── FolderInput.tsx             # Input field cho folder URL
└── screens/
    └── (modify) MarketAnalysisWorkflowScreen.tsx  # Thêm Export button vào history rows
```

---

## 4. Data Model

### Collection: `google_drive_tokens`

| Field | Type | Constraint | Ghi chú |
|-------|------|------------|---------|
| `_id` | ObjectId | PK | |
| `userId` | ObjectId | required, ref: User, unique | 1 user = 1 token doc (upsert) |
| `accessToken` | String | required | Access token từ Google OAuth2 |
| `refreshToken` | String | required | Refresh token — lưu để auto-refresh |
| `expiresAt` | Date | required | Thời điểm access token hết hạn |
| `scope` | String | nullable | Scope đã cấp (audit/debug) |
| `createdAt` | Date | auto | timestamps: true |
| `updatedAt` | Date | auto | timestamps: true |

**Indexes:**

- `{ userId: 1 }` — unique — lookup token theo user
- `{ expiresAt: 1 }` — TTL index (`expireAfterSeconds: 0`) — MongoDB tự xóa token hết hạn + revoked

### MarketAnalysisHistory — KHÔNG thay đổi

Schema hiện tại giữ nguyên: `{ content, articleIds, timestamps }`. File ID Google Drive lưu trong response khi export, không lưu vào schema. Nếu user muốn re-export thì export lại (idempotent — tạo Google Doc mới).

> **Lý do không thêm `googleDriveFileId`:** Mỗi export là snapshot mới. Nếu lưu file ID, cần logic update/overwrite phức tạp hơn. MVP: mỗi lần export = 1 Google Doc mới.

---

## 5. API Contract

### 5.1 Google Drive Auth endpoints

#### `GET /api/v1/google-drive/auth/url`

Trả về URL để frontend redirect user sang Google consent screen.

- **Guard:** JwtAuthGuard (user phải login)
- **Response 200:**

```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

#### `GET /api/v1/google-drive/auth/callback`

Google redirect về đây sau khi user đồng ý. Backend exchange code → lưu token → redirect về frontend.

- **Guard:** `@Public()` (Google redirect không có JWT)
- **Query params:** `code` (Google auth code), `state` (optional)
- **Action:** Exchange code → save token to DB → redirect về frontend
- **Redirect:** `{FRONTEND_URL}/market-analysis-workflow?gdrive=connected` (thành công) hoặc `{FRONTEND_URL}/market-analysis-workflow?gdrive=error&message=...` (thất bại)
- **Errors:** Redirect với query `gdrive=error` nếu code invalid hoặc exchange fail

> **Lưu ý:** Endpoint này KHÔNG trả JSON — redirect HTTP 302 về frontend. Frontend detect `?gdrive=connected` query param để hiển thị toast success.

#### `GET /api/v1/google-drive/status`

Kiểm tra user đã kết nối Google Drive chưa.

- **Guard:** JwtAuthGuard
- **Response 200 (connected):**

```json
{
  "connected": true,
  "email": "user@gmail.com",
  "connectedAt": "2026-08-15T10:30:00.000Z"
}
```

- **Response 200 (not connected):**

```json
{
  "connected": false
}
```

#### `DELETE /api/v1/google-drive/disconnect`

Ngắt kết nối Google Drive — xóa token khỏi DB, revoke trên Google.

- **Guard:** JwtAuthGuard
- **Response 200:**

```json
{
  "message": "Google Drive disconnected successfully"
}
```

**Error:** `404` nếu chưa connect.

---

### 5.2 Export endpoints

#### `POST /api/v1/google-drive/export/:historyId`

Export 1 Market Analysis History record lên Google Drive.

- **Guard:** JwtAuthGuard + `@Roles(UserRole.ADMIN, UserRole.EDITOR)`
- **Params:** `historyId` — ObjectId của MarketAnalysisHistory
- **Request body:**

```json
{
  "folderUrl": "https://drive.google.com/drive/folders/abc123"
}
```

`folderUrl` là optional. Nếu không truyền → tạo Google Doc ở root Drive (My Drive). Nếu truyền → parse folder ID, validate access, move doc vào folder.

- **Response 200:**

```json
{
  "message": "Export successful",
  "data": {
    "documentId": "abc123def",
    "documentUrl": "https://docs.google.com/document/d/abc123def/edit",
    "title": "Báo cáo phân tích thị trường - 15/08/2026 10:30:00",
    "folderUrl": "https://drive.google.com/drive/folders/xyz789"
  }
}
```

**Errors:**

| Status | Message | Nguyên nhân |
|--------|---------|-------------|
| `401` | `"Google Drive not connected. Please connect first."` | User chưa authorize |
| `404` | `"Market analysis history not found"` | historyId không tồn tại |
| `400` | `"Invalid Google Drive folder URL"` | folderUrl format sai |
| `400` | `"Cannot access folder. Make sure you shared it with the app."` | Folder không accessible |
| `401` | `"Google token expired. Please reconnect Google Drive."` | Refresh token fail → cần re-auth |
| `500` | `"Failed to export to Google Drive. Please try again."` | Google API error |

#### `POST /api/v1/google-drive/folder/validate`

Validate folder URL — kiểm tra user có quyền truy cập folder không.

- **Guard:** JwtAuthGuard
- **Request body:**

```json
{
  "folderUrl": "https://drive.google.com/drive/folders/abc123"
}
```

- **Response 200 (valid):**

```json
{
  "valid": true,
  "folderName": "Market Analysis Reports",
  "folderId": "abc123"
}
```

- **Response 200 (invalid):**

```json
{
  "valid": false,
  "message": "Folder not found or not accessible"
}
```

---

### 5.3 Error Response Format

Mọi lỗi đi qua `GlobalExceptionFilter` và trả theo chuẩn:

```json
{
  "statusCode": 400,
  "message": "Invalid Google Drive folder URL",
  "timestamp": "2026-08-15T10:30:00.000Z",
  "path": "/api/v1/google-drive/export/abc123"
}
```

---

## 6. Service Design

### 6.1 GoogleDriveOAuthService

```
@Injectable()
class GoogleDriveOAuthService {
  // Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
  // Deps: ConfigService, @InjectModel(GoogleDriveToken)

  generateAuthUrl(userId: string): string
    // Tạo OAuth2 URL với scope: drive.file
    // state param = userId (dùng cho callback phân biệt user)
    // access_type: 'offline', prompt: 'consent'

  async exchangeCode(code: string): Promise<{ userId, email, accessToken, refreshToken, expiresAt }>
    // oauth2Client.getToken(code) → extract tokens
    // Get user email from Google People API hoặc userinfo endpoint
    // Upsert token into DB (findOneAndUpdate with upsert)
    // Return token info

  async getOAuth2Client(userId: string): Promise<OAuth2Client>
    // Load token from DB
    // Create OAuth2Client, setCredentials
    // Listen to 'tokens' event → auto-save to DB on refresh
    // Throw UnauthorizedException if no token found

  async revokeAndDelete(userId: string): Promise<void>
    // Load token from DB
    // Revoke on Google: oauth2Client.revokeCredentials() hoặc drive.files.revoke
    // Delete from DB
    // Handle case token already revoked (idempotent)

  async getTokenInfo(userId: string): Promise<{ connected: boolean, email?: string, connectedAt?: Date } | null>
    // Lookup token in DB, return status
}
```

**Auto-refresh flow:** `google-auth-library` xử lý tự động khi gọi API. Khi token refresh thành công, event `tokens` emit → save new tokens vào DB.

```typescript
oauth2Client.on('tokens', async (tokens) => {
  if (tokens.refresh_token) {
    // Only on initial consent — refresh token không trả lại mỗi lần
    await this.tokenModel.findOneAndUpdate(
      { userId },
      { $set: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: new Date(tokens.expiry_date) } },
    );
  } else {
    await this.tokenModel.findOneAndUpdate(
      { userId },
      { $set: { accessToken: tokens.access_token, expiresAt: new Date(tokens.expiry_date) } },
    );
  }
});
```

### 6.2 GoogleDriveExportService

```
@Injectable()
class GoogleDriveExportService {
  // Deps: GoogleDriveOAuthService, @InjectModel(MarketAnalysisHistory)

  async exportAnalysis(userId: string, historyId: string, folderUrl?: string): Promise<ExportResult>
    // 1. Load MarketAnalysisHistory by ID → throw NotFoundException nếu không tồn tại
    // 2. Get OAuth2Client from OAuthService → throw nếu chưa connect
    // 3. Parse folder URL → extract folderId (optional)
    // 4. Validate folder access (nếu có folderId) → throw nếu không accessible
    // 5. Generate title: "Báo cáo phân tích thị trường - {date formatted}"
    // 6. Create Google Doc: docs.documents.create({ title })
    // 7. Convert markdown → batchUpdate requests: MarkdownToGoogleDocsConverter.convert(content)
    // 8. Execute batchUpdate: docs.documents.batchUpdate({ documentId, requestBody: { requests } })
    // 9. Move to folder (nếu có folderId): drive.files.update({ fileId, addParents })
    // 10. Return { documentId, documentUrl, title, folderUrl }

  async validateFolder(userId: string, folderUrl: string): Promise<FolderValidation>
    // 1. Get OAuth2Client
    // 2. Parse folder ID from URL
    // 3. drive.files.get({ fileId, fields: 'name,mimeType' }) → verify it's a folder
    // 4. Return { valid, folderName, folderId }
}
```

**Export flow chi tiết:**

```
Client                    GoogleDriveController        GoogleDriveExportService        Google APIs
  |                              |                              |                          |
  |-- POST /export/:id --------->|                              |                          |
  |   { folderUrl? }             |-- exportAnalysis() --------->|                          |
  |                              |                              |-- getHistoryById() ----->MongoDB
  |                              |                              |<-- MarketAnalysisHistory-|
  |                              |                              |-- getOAuth2Client() ---->MongoDB
  |                              |                              |<-- OAuth2Client ---------|
  |                              |                              |-- parseFolderUrl() ------|
  |                              |                              |-- validateFolder() ----->Google Drive API
  |                              |                              |-- docs.create() -------->Google Docs API
  |                              |                              |<-- documentId -----------|
  |                              |                              |-- convert(markdown) -----|
  |                              |                              |-- batchUpdate() -------->Google Docs API
  |                              |                              |-- files.update() ------->Google Drive API
  |                              |<-- { documentUrl } ---------|                          |
  |<-- 200 + data ---------------|                              |                          |
```

### 6.3 MarkdownToGoogleDocsConverter

Pure utility — không injectable, static methods.

```typescript
class MarkdownToGoogleDocsConverter {
  static convert(markdown: string): DocRequest[]
    // Parse markdown bằng `marked` lexer
    // Map từng token sang Docs API requests:
    //   - Heading (#, ##, ###) → insertText + updateParagraphStyle(HEADING_N)
    //   - Bold (**) → insertText + updateTextStyle(BOLD)
    //   - Italic (*) → insertText + updateTextStyle(ITALIC)
    //   - Code blocks → insertText + updateTextStyle(MONOSPACE) hoặc fixed-width
    //   - Lists (-, 1.) → insertText + createParagraphBullets
    //   - Paragraphs → insertText với newline
    //   - Page breaks → insertPageBreak
    // Track index position: mỗi insertText tăng index theo length text
    // Return sorted array of requests
}
```

**Conversion mapping chi tiết:**

| Markdown | Google Docs API Request |
|----------|------------------------|
| `# Heading` | `insertText` + `updateParagraphStyle(headingType: HEADING_1)` |
| `## Heading` | `insertText` + `updateParagraphStyle(headingType: HEADING_2)` |
| `### Heading` | `insertText` + `updateParagraphStyle(headingType: HEADING_3)` |
| `**bold**` | `insertText(text: "bold")` + `updateTextStyle(textStyle: { bold: true })` |
| `*italic*` | `insertText(text: "italic")` + `updateTextStyle(textStyle: { italic: true })` |
| `` `code` `` | `insertText(text: "code")` + `updateTextStyle(textStyle: { fontFamily: "MONOSPACE" })` |
| `- item` | `insertText` + `createParagraphBullets(bulletPreset: UNORDERED_LIST)` |
| `1. item` | `insertText` + `createParagraphBullets(bulletPreset: ORDERED_LIST)` |
| `\n\n` | `insertText(text: "\n")` (paragraph break) |
| Page break | `insertPageBreak` |

---

## 7. Luồng xử lý

### 7.1 OAuth Flow (Initial Connection)

```
FE: User click "Connect Google Drive"
  → GET /api/v1/google-drive/auth/url
  → BE: generateAuthUrl(userId)
  → FE: window.location.href = url (redirect to Google)

Google Consent Screen → User approves
  → Google redirect: GET /api/v1/google-drive/auth/callback?code=xxx

  → BE: exchangeCode(code)
      → oauth2Client.getToken(code)
      → Get user email from Google
      → Upsert token into DB
      → Redirect 302: {FRONTEND_URL}/market-analysis-workflow?gdrive=connected

  → FE: Detect ?gdrive=connected on mount → refetchStatus() → show success toast
```

### 7.2 Export Flow

```
FE: User click "Export to Google Drive" on a history record
  → Show loading state (button spinner)
  → POST /api/v1/google-drive/export/{historyId} { folderUrl }

  → BE: exportAnalysis(userId, historyId, folderUrl)
      → Load MarketAnalysisHistory
      → Load OAuth2Client (auto-refresh if expired)
      → Parse + validate folder (if provided)
      → Create Google Doc (docs.documents.create)
      → Convert markdown → batchUpdate requests
      → Execute batchUpdate
      → Move to folder (if provided)
      → Return { documentUrl, title }

  → FE: Show success toast with clickable link
  → Button returns to idle state
```

### 7.3 Token Refresh (Transparent)

```
Backend export request
  → OAuth2Client.setCredentials({ accessToken, refreshToken })
  → Call Google API (e.g., docs.documents.create)
  → If access token expired:
      → google-auth-library auto-uses refresh_token
      → Gets new access_token (+ new refresh_token occasionally)
      → Emits 'tokens' event
      → GoogleDriveOAuthService listens → save new tokens to DB
  → API call succeeds
```

### 7.4 Disconnect Flow

```
FE: User click "Disconnect Google Drive"
  → Confirm dialog
  → DELETE /api/v1/google-drive/disconnect

  → BE: revokeAndDelete(userId)
      → Load token from DB
      → Revoke on Google (revokeCredentials)
      → Delete from DB
      → Return success

  → FE: Refetch status → show disconnected state
```

---

## 8. RBAC Matrix

| Endpoint | Public | EDITOR | ADMIN |
|----------|:------:|:------:|:-----:|
| `GET /google-drive/auth/url` | ❌ | ✅ | ✅ |
| `GET /google-drive/auth/callback` | ✅ | ✅ | ✅ |
| `GET /google-drive/status` | ❌ | ✅ | ✅ |
| `DELETE /google-drive/disconnect` | ❌ | ✅ | ✅ |
| `POST /google-drive/export/:historyId` | ❌ | ✅ | ✅ |
| `POST /google-drive/folder/validate` | ❌ | ✅ | ✅ |

> Callback cần `@Public()` vì Google redirect không gửi JWT.

---

## 9. Environment Variables cần thêm

### Backend (`.env`)

```env
# Google OAuth2 (Google Cloud Console → Credentials → OAuth 2.0 Client IDs)
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/google-drive/auth/callback
```

### Frontend

Không cần env mới. `FRONTEND_URL` đã có sẵn trong backend env.

---

## 10. Frontend Design (Tổng quan)

### 10.1 GoogleDriveAuthContext

React Context quản lý trạng thái kết nối Google Drive:

```typescript
interface GoogleDriveAuthState {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  isLoading: boolean;
  checkStatus: () => Promise<void>;
  getAuthUrl: () => Promise<string>;
  disconnect: () => Promise<void>;
}

// Dùng useQuery(['google-drive', 'status']) để cache status
// Query refetchOnWindowFocus: true (luôn check khi user quay lại tab)
```

### 10.2 Export Button

Component hiển thị trên MarketAnalysisWorkflowScreen:

```
┌────────────────────────────────────────────┐
│  Báo cáo phân tích thị trường - 15/08/2026│
│  Articles: 5                               │
│  Created: 15/08/2026 10:30:00              │
│                                            │
│  [👁 Xem]  [📤 Export to Google Drive]     │
└────────────────────────────────────────────┘
```

**States của Export Button:**

| State | Hiển thị | Hành động |
|-------|----------|-----------|
| Disconnected | Disabled, gray, tooltip: "Connect Google Drive first" | Click → redirect to Google Drive tab/settings |
| Idle (connected) | Blue button "Export to Google Drive" | Click → show folder URL input (optional) → call API |
| Exporting | Button spinner + "Exporting..." | Disable click |
| Success | Green button + "Exported!" → link to Google Doc | Click link opens doc |
| Error | Red toast + button returns to idle | Retry |

### 10.3 Folder Input

Optional input field khi user click Export:

```
┌─ Export to Google Drive ──────────────────────┐
│                                               │
│  Folder URL (optional):                        │
│  ┌──────────────────────────────────────────┐  │
│  │ https://drive.google.com/drive/folders/...│  │
│  └──────────────────────────────────────────┘  │
│  ✓ Folder validated: "Reports"                │
│                                               │
│           [Cancel]  [Export]                   │
└───────────────────────────────────────────────┘
```

- Validate folder URL onBlur hoặc khi paste
- Hiển thị tên folder nếu valid
- Hiển thị error nếu invalid

### 10.4 Google Drive Status Tab

Đặt trong `MarketAnalysisWorkflowScreen` (hoặc section riêng):

```
┌─ Google Drive ────────────────────────────────┐
│                                               │
│  Connected as: user@gmail.com                 │
│  Connected: 15/08/2026 10:30:00               │
│                                               │
│  [Disconnect]                                 │
└───────────────────────────────────────────────┘
```

Hoặc khi chưa connect:

```
┌─ Google Drive ────────────────────────────────┐
│                                               │
│  ⚠️ Not connected                             │
│                                               │
│  Connect your Google Drive to export reports. │
│                                               │
│  [Connect Google Drive]                       │
└───────────────────────────────────────────────┘
```

### 10.5 Route & Sidebar

Không thêm route mới. Google Drive status đặt trong `MarketAnalysisWorkflowScreen` (đã có route `/market-analysis-workflow`). Export button đặt trực tiếp trên history rows.

---

## 11. Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| User chưa connect Drive → click Export | Button disabled + tooltip. Nếu API call lỗi → 401 → show toast: "Please connect Google Drive first" |
| Token expired + refresh fail | Return 401 + message "Google token expired. Please reconnect Google Drive." → Frontend show reconnect prompt |
| User revoke access trên Google | Google API error during export → Catch → delete token from DB → return 401 |
| Folder URL invalid format | Return 400: "Invalid Google Drive folder URL" |
| Folder không accessible | Return 400: "Cannot access folder. Make sure you shared it with the app." |
| Google API quota exceeded | Return 429: "Google API rate limit exceeded. Please try again later." |
| Markdown content quá lớn (>10M chars) | Return 400: "Content too large for Google Docs (max 10 million characters)." |
| Network timeout during export | Retry with exponential backoff (max 3 attempts). If all fail → return 500. |
| User click Export nhiều lần (idempotency) | Mỗi click = 1 Google Doc mới. Không có dedup — chấp nhận (snapshot model). |
| Google OAuth consent revoked + old tokens still in DB | Token refresh sẽ fail → delete from DB → return 401 |

---

## 12. File Manifest

### Backend — NEW files

| File | Purpose |
|------|---------|
| `src/modules/google-drive-export/google-drive-export.module.ts` | NestJS module registration |
| `src/modules/google-drive-export/google-drive.controller.ts` | OAuth + Export + Folder endpoints (1 controller) |
| `src/modules/google-drive-export/services/google-drive-oauth.service.ts` | OAuth2 flow management |
| `src/modules/google-drive-export/services/google-drive-export.service.ts` | Export logic (create doc, batchUpdate, move) |
| `src/modules/google-drive-export/services/markdown-to-docs.converter.ts` | Markdown → Docs API requests converter |
| `src/modules/google-drive-export/schemas/google-drive-token.schema.ts` | Mongoose schema for OAuth tokens |
| `src/modules/google-drive-export/dtos/export-analysis.dto.ts` | Export + Folder validate DTOs |

### Backend — EDIT files

| File | Change |
|------|--------|
| `src/app.module.ts` | Import `GoogleDriveExportModule` |

### Frontend — NEW files

| File | Purpose |
|------|---------|
| `src/api/google-drive.api.ts` | API functions (getAuthUrl, getStatus, export, disconnect, validateFolder) |
| `src/context/GoogleDriveAuthContext.tsx` | React Context + useQuery for Google Drive connection state |
| `src/components/google-drive/GoogleDriveStatusBadge.tsx` | Connected/disconnected status display |
| `src/components/google-drive/ExportButton.tsx` | Export button with full state management |
| `src/components/google-drive/FolderInput.tsx` | Optional folder URL input with validation |

### Frontend — EDIT files

| File | Change |
|------|--------|
| `src/screens/MarketAnalysisWorkflowScreen.tsx` | Add Export button to history rows + Google Drive status section |

---

## 13. Open Questions — Answered

| Question | Decision | Rationale |
|----------|----------|-----------|
| Module mới hay tích hợp vào news-fire-crawl-manager? | **Module mới** | news-fire-crawl-manager đã quá lớn (1600+ dòng controller, 15+ services); Google Drive là tính năng riêng biệt, không liên quan trực tiếp đến crawl/publish pipeline |
| Schema MarketAnalysisHistory cần thêm `googleDriveFileId`? | **KHÔNG** | Mỗi export = Google Doc mới (snapshot model). Lưu file ID gây coupling và cần logic update/overwrite phức tạp |
| Dùng passport-google-oauth20 hay googleapis trực tiếp? | **googleapis trực tiếp** | Ít dependencies hơn, auto-refresh built-in, NestJS DI-friendly |
| Scope `drive` hay `drive.file`? | **drive.file** | Non-sensitive, đủ cho use case, dễ verification hơn nhiều so với `drive` restricted scope |
| Folder selection: Google Picker hay manual URL? | **Manual URL (MVP)** | Google Picker cần thêm JavaScript client library và iframe integration. MVP dùng input URL đơn giản |
| Export sync hay fire-and-forget? | **Sync (chờ response)** | Export nhanh (<5s thường), user cần biết kết quả ngay. Không cần background job cho MVP |
| Bao nhiêu controller? | **1 controller** | OAuth + Export + Folder endpoints đều liên quan đến Google Drive. 6 endpoints đủ nhỏ cho 1 controller |

---

## 14. Implementation Phases

### Phase 1 — Backend Core

1. Install `googleapis` + `marked`
2. Create `GoogleDriveToken` schema
3. Implement `GoogleDriveOAuthService`
4. Implement `GoogleDriveExportService` + `MarkdownToGoogleDocsConverter`
5. Create `GoogleDriveController` with all endpoints
6. Register module in `AppModule`
7. Unit tests cho services

### Phase 2 — Frontend Integration

1. Create `google-drive.api.ts`
2. Create `GoogleDriveAuthContext`
3. Create UI components (StatusBadge, ExportButton, FolderInput)
4. Modify `MarketAnalysisWorkflowScreen` — add Export + Status
5. Handle OAuth callback redirect
6. QA tests

---

*Architecture spec written by Architect Agent, 2026-08-15.*
*Based on: EXPORT_GDRIVE_RESEARCH.md, docs/intent/export-market-analysis-google-drive.md, codebase audit.*
