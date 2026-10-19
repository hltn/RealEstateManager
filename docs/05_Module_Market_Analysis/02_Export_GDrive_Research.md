# Export Market Analysis to Google Drive — Feasibility Research

**Date:** 2026-08-15
**Author:** Architect Agent
**Status:** Research Complete

---

## Table of Contents

1. [PHƯƠNG ÁN 1 — Export into single DOCX](#1-export-vào-1-file-docx-duy-nhất)
2. [PHƯƠNG ÁN 2 — Export into configured folder](#2-export-vào-folder-cấu-hình)
3. [OAuth2 User Flow trong NestJS](#3-oauth2-user-flow-trong-nestjs)
4. [Google APIs Scopes](#4-google-apis-scopes)
5. [Thực tế Check — npm packages & API limits](#5-thực-tế-check)
6. [Feasibility Assessment & Recommendation](#6-feasibility-assessment--recommendation)

---

## 1. Export vào 1 file DOCX duy nhất

### Google Docs API — Append vào file hiện có?

**CÓ THỂ.** Google Docs API (`docs.googleapis.com`) hỗ trợ `documents.batchUpdate` với nhiều request types, bao gồm:

- **`insertText`** — Chèn text tại một `index` cụ thể trong document
- **`insertPageBreak`** — Chèn page break tại index
- **`insertSectionBreak`** — Chèn section break
- **`updateParagraphStyle`** — Thay đổi heading style, alignment
- **`createParagraphBullets`** — Tạo bullet/numbered list
- **`updateTextStyle`** — Bold, italic, font size, color

**Request body shape:**
```json
{
  "requests": [
    {
      "insertText": {
        "location": { "index": -1 },
        "text": "Nội dung phân tích..."
      }
    },
    {
      "insertPageBreak": {
        "location": { "index": -1 }
      }
    }
  ]
}
```

`index: -1` = cuối document (end of content). Index-based system — mỗi ký tự trong document có 1 index.

### Approach khả thi nhất

**APPROACH A (Recommended): Tạo Google Doc mới mỗi lần export**

```
User trigger export
  → Backend tạo Google Doc mới (docs.documents.create)
  → Viết nội dung markdown → Google Doc (batchUpdate)
  → Di chuyển vào folder (Drive API files.update)
  → Trả về doc URL cho user
```

Lý do:
- Market Analysis history là **snapshot** — mỗi lần phân tích là 1 bản ghi mới, không phải append vào cùng 1 file
- Schema hiện tại (`MarketAnalysisHistory`) lưu content markdown + articleIds — mỗi record là 1 analysis riêng biệt
- Tạo mới đơn giản hơn nhiều so với download → modify → upload

**APPROACH B (Phức tạp hơn): Append vào file DOCX hiện có**

```
Download file từ Drive → Chỉnh sửa bằng docx npm → Upload lại
```

Google Docs API KHÔNG hỗ trợ import/export DOCX trực tiếp. Chỉ làm việc với Google Docs format. Để làm việc với DOCX:
- Dùng npm `docx` hoặc `docxtemplater` để tạo/sửa DOCX
- Upload lại bằng Drive API (`files.create` với `uploadType=multipart`, MIME type `application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
- Hạn chế: file upload sẽ thay thế hoàn toàn nội dung cũ (không merge)

**→ APPROACH A được recommend vì phù hợp với use case snapshot analysis.**

### Chuyển đổi markdown → Google Doc

Google Docs API không nhận markdown trực tiếp. Cần convert:

| Markdown | Google Docs API Request |
|----------|------------------------|
| `# Heading 1` | `insertText` + `updateParagraphStyle(HEADING_1)` |
| `## Heading 2` | `insertText` + `updateParagraphStyle(HEADING_2)` |
| `**bold**` | `insertText` + `updateTextStyle(BOLD)` |
| `\n\n` (paragraph) | `insertText` với newline character |
| `- bullet` | `insertText` + `createParagraphBullets(UNORDERED_LIST)` |
| `1. numbered` | `insertText` + `createParagraphBullets(ORDERED_LIST)` |
| Page break | `insertPageBreak` |

**npm package hỗ trợ:** `marked` (markdown parser) để tokenize, rồi map từng token sang Docs API requests.

---

## 2. Export vào folder cấu hình

### Drive API — Tạo file Google Docs trong folder cụ thể

**CÓ THỂ.** Hai bước:

**Bước 1: Tạo Google Doc (Docs API)**
```
POST https://docs.googleapis.com/v1/documents
{
  "title": "Market Analysis - 2026-08-15"
}
→ Response: { "documentId": "abc123", "title": "..." }
```

**Bước 2: Di chuyển vào folder (Drive API)**
```
PATCH https://www.googleapis.com/drive/v3/files/{documentId}
{
  "addParents": "folder_id_from_user"
}
→ File giờ nằm trong folder user chọn
```

**HOẶC** — Tạo trực tiếp trong folder bằng Drive API `files.create`:
```
POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
{
  "name": "Market Analysis - 2026-08-15",
  "mimeType": "application/vnd.google-apps.document",
  "parents": ["folder_id"]
}
```

### MIME type cho Google Docs native file

| Format | MIME Type |
|--------|-----------|
| Google Docs | `application/vnd.google-apps.document` |
| Google Sheets | `application/vnd.google-apps.spreadsheet` |
| DOCX upload | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

### Scopes cần thiết

- **`drive.file`** (non-sensitive): Đủ cho tạo file mới và di chuyển vào folder đã share
- **`drive`** (restricted): Cần thiết nếu cần truy cập folder bất kỳ mà không cần user share

→ Xem chi tiết ở Section 4.

---

## 3. OAuth2 User Flow trong NestJS

### googleapis npm package — Hỗ trợ OAuth2

**Package:** `googleapis` (npm) — official Google API client cho Node.js.
**Dependent:** `google-auth-library` — library auth mà `googleapis` dùng bên trong.

**googleapis hỗ trợ đầy đủ OAuth2 User Flow:**
- `google.auth.OAuth2` class — tạo auth URL, exchange code, manage tokens
- `oauth2Client.setCredentials({ access_token, refresh_token })` — auto-refresh khi token hết hạn
- Hoạt động hoàn toàn server-side, không cần browser SDK

### Có cần passport-google-oauth20 không?

**KHÔNG CẦN.** `googleapis` + `google-auth-library` xử lý toàn bộ flow:

| | googleapis (recommended) | passport-google-oauth20 |
|---|---|---|
| Auth URL generation | `oauth2Client.generateAuthUrl()` | Passport redirect |
| Code exchange | `oauth2Client.getToken(code)` | Passport callback |
| Token storage | Manual (lưu vào DB) | Passport session/profile |
| Auto refresh | `oauth2Client.setCredentials()` + auto | Manual hoặc middleware |
| NestJS integration | Native (injectable service) | Requires PassportModule + Strategy |
| Dependencies | `googleapis` (already needed) | Additional `passport-google-oauth20` |

→ Dùng `googleapis` trực tiếp: ít dependencies hơn, control tốt hơn, phù hợp NestJS DI.

### Flow chi tiết trong NestJS

```
1. User click "Connect Google Drive" trên FE
   → GET /api/v1/google/auth/url

2. Backend tạo auth URL:
   const oauth2Client = new google.auth.OAuth2(
     GOOGLE_CLIENT_ID,
     GOOGLE_CLIENT_SECRET,
     'https://your-app.com/api/v1/google/auth/callback'
   );
   const url = oauth2Client.generateAuthUrl({
     access_type: 'offline',    // Lấy refresh token
     prompt: 'consent',         // Luôn hiện consent screen
     scope: [
       'https://www.googleapis.com/auth/drive.file',
     ],
   });
   → Redirect user đến url

3. User đồng ý trên Google Consent Screen
   → Google redirect về callback URL với ?code=xxx

4. Backend exchange code:
   const { tokens } = await oauth2Client.getToken(code);
   // tokens.access_token, tokens.refresh_token, tokens.expiry_date

5. Lưu token vào MongoDB:
   {
     userId: ObjectId,
     accessToken: tokens.access_token,
     refreshToken: tokens.refresh_token,
     expiryDate: new Date(tokens.expiry_date),
     scope: tokens.scope,
   }

6. Export operation:
   oauth2Client.setCredentials({
     access_token: stored.accessToken,
     refresh_token: stored.refreshToken,
   });
   // googleapis auto-refresh khi access_token hết hạn
```

### Token Storage — MongoDB

**Schema đề xuất:**
```typescript
@Schema({ timestamps: true })
export class GoogleDriveToken {
  @Prop({ required: true, unique: true })
  userId: string;  // Liên kết với user hiện tại

  @Prop({ required: true })
  accessToken: string;

  @Prop({ required: true })
  refreshToken: string;

  @Prop({ required: true })
  expiryDate: Date;

  @Prop()
  scope: string;

  @Prop()
  tokenType: string;
}
```

### Auto Token Refresh

`google-auth-library` xử lý tự động:
```typescript
oauth2Client.setCredentials({
  access_token: stored.accessToken,
  refresh_token: stored.refreshToken,
});

// Khi access_token hết hạn, googleapis tự động dùng refresh_token
// để lấy access_token mới. Không cần code manual refresh.
// Sự kiện 'tokens' được emit khi refresh thành công:
oauth2Client.on('tokens', (tokens) => {
  // Cập nhật lại DB
  await updateTokenInDB(userId, tokens);
});
```

---

## 4. Google APIs Scopes

### drive.file vs drive

| Aspect | `drive.file` | `drive` |
|--------|-------------|---------|
| **Classification** | Non-sensitive | Restricted |
| **Access** | Chỉ file/folder user explicit share với app | Toàn bộ Drive |
| **Verification** | Basic (dễ) | Full security assessment (khó) |
| **Server storage** | Không hạn chế | Cần pass security assessment |
| **Works with** | Drive API + Docs API | Drive API + Docs API |
| **Consent screen** | Hiển thị rõ ràng | Hiển thị rõ ràng |

### Scopes cần thiết cho use case

| Operation | Minimum Scope |
|-----------|--------------|
| Tạo Google Doc mới | `drive.file` hoặc `documents` |
| Viết content vào Doc | `drive.file` hoặc `documents` |
| Di chuyển file vào folder | `drive.file` (chỉ folder đã share) hoặc `drive` (bất kỳ folder) |

### Drive.file + Google Picker (Recommended)

Với `drive.file` scope:
- User cần **explicitly share folder** với app trước khi app có thể tạo file trong đó
- Dùng Google Picker API để user chọn folder (tự động grant quyền cho app)

Với `drive` scope:
- App có quyền tạo file trong BẤT KỲ folder nào user sở hữu
- **Nhưng:** cần full security assessment từ Google

### Recommendation

```
Scope: https://www.googleapis.com/auth/drive.file
```

- Non-sensitive → dễ verification
- Đủ cho create doc + write content + move to folder
- User chọn folder qua Google Picker hoặc FE input folder URL
- Không cần `drive` full access

---

## 5. Thực tế Check

### googleapis npm package

- **Package:** `googleapis` (https://www.npmjs.com/package/googleapis)
- **Latest:** v144+ (constantly updated)
- **Size:** ~12MB (includes all Google API clients)
- **Dependencies:** `google-auth-library` (included)
- **Docs:** https://github.com/googleapis/google-api-nodejs-client

**OAuth2 example:**
```typescript
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

// Exchange code
const { tokens } = await oauth2Client.getToken(code);
oauth2Client.setCredentials(tokens);

// Use Drive API
const drive = google.drive({ version: 'v3', auth: oauth2Client });
const res = await drive.files.create({
  requestBody: {
    name: 'Market Analysis',
    mimeType: 'application/vnd.google-apps.document',
    parents: ['folder_id'],
  },
});

// Use Docs API
const docs = google.docs({ version: 'v1', auth: oauth2Client });
await docs.documents.batchUpdate({
  documentId: res.data.id,
  requestBody: {
    requests: [
      {
        insertText: {
          location: { index: 1 },
          text: 'Hello World',
        },
      },
    ],
  },
});
```

### Google Drive API — File Creation Limits

- **Max file size upload:** 5,120 GB
- **Rate limits:** 20,000 queries/100 seconds/user (per project)
- **Quota:** Free tier sufficient for this use case

### Google Docs API — batchUpdate Limits

- **Max requests per batchUpdate:** 500 requests per call
- **Rate limits:** 300 requests per minute per project
- **Max document size:** 10 million characters

### Google OAuth2 — Token Limits

- **Max refresh tokens per user per client:** 100 (excess → oldest revoked)
- **Refresh token expiry:** Never (unless unused for 6 months)
- **Access token lifetime:** 1 hour (auto-refresh via refresh_token)

---

## 6. Feasibility Assessment & Recommendation

### Overall Verdict: ✅ FULLY FEASIBLE

Semua requirements đều khả thi với Google APIs hiện tại.

### Approach Recommendation

#### Core Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React)                                   │
│  - "Export to Google Drive" button                   │
│  - Google OAuth consent redirect flow                │
│  - Show exported doc link                            │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│  Backend (NestJS) — New Module: google-drive-export  │
│                                                     │
│  1. GoogleAuthController                             │
│     - GET /auth/url → redirect to Google             │
│     - GET /auth/callback → save tokens               │
│     - GET /auth/status → check if connected          │
│                                                     │
│  2. GoogleDriveService                               │
│     - createDoc(title, content, folderId?)           │
│     - markdownToDocRequests(markdown) → Request[]    │
│     - moveFileToFolder(fileId, folderId)             │
│                                                     │
│  3. TokenService (Mongoose)                          │
│     - saveTokens(userId, tokens)                     │
│     - getTokens(userId) → OAuth2Client configured    │
│     - auto-refresh via google-auth-library           │
│                                                     │
│  4. ExportController                                 │
│     - POST /export/market-analysis/:id → create Doc  │
│     - Response: { docUrl, docId }                    │
└─────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│  Google APIs                                         │
│  - Docs API: documents.create + batchUpdate          │
│  - Drive API: files.update (move to folder)          │
│  - OAuth2: googleapis auth                           │
└─────────────────────────────────────────────────────┘
```

#### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Export strategy** | Tạo Google Doc mới mỗi lần | Market Analysis là snapshot; append không phù hợp |
| **OAuth2 library** | googleapis trực tiếp | Ít dependencies, auto-refresh, NestJS DI-friendly |
| **Scope** | `drive.file` | Non-sensitive, đủ cho use case, dễ verification |
| **Content format** | Google Docs native (không DOCX) | Hỗ trợ formatting đầy đủ, không cần convert qua DOCX |
| **Markdown conversion** | Custom parser (marked + batchUpdate) | Convert markdown tokens → Docs API requests |
| **Token storage** | MongoDB (new collection) | Consistent với existing stack |
| **Folder selection** | User input folder URL/ID from FE | Đơn giản, không cần Google Picker cho MVP |

#### npm Dependencies cần thêm

```
googleapis          — Google API client (bao gồm google-auth-library)
marked              — Markdown parser (nếu chưa có)
```

#### New Files (Backend)

| File | Purpose |
|------|---------|
| `src/modules/google-drive-export/google-drive-export.module.ts` | NestJS module |
| `src/modules/google-drive-export/controllers/google-auth.controller.ts` | OAuth2 flow endpoints |
| `src/modules/google-drive-export/controllers/export.controller.ts` | Export endpoints |
| `src/modules/google-drive-export/services/google-drive.service.ts` | Drive/Docs API operations |
| `src/modules/google-drive-export/services/token.service.ts` | Token CRUD + refresh |
| `src/modules/google-drive-export/services/markdown-converter.service.ts` | Markdown → Docs API requests |
| `src/modules/google-drive-export/schemas/google-drive-token.schema.ts` | MongoDB schema |
| `src/modules/google-drive-export/dtos/export-market-analysis.dto.ts` | Request DTOs |

#### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/google/auth/url` | Get OAuth2 authorization URL |
| `GET` | `/api/v1/google/auth/callback` | OAuth2 callback — exchange code, save tokens |
| `GET` | `/api/v1/google/auth/status` | Check if user has connected Google Drive |
| `DELETE` | `/api/v1/google/auth/disconnect` | Revoke tokens, disconnect |
| `POST` | `/api/v1/google/export/market-analysis/:historyId` | Export analysis to Google Doc |
| `GET` | `/api/v1/google/folders/:folderId/validate` | Validate folder access |

#### Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Token expired + refresh failed | Return 401, prompt re-auth |
| User revoke access | Catch API error, mark token invalid, return 401 |
| Folder not found / no permission | Return 400 with clear message |
| Google API quota exceeded | Return 429, retry-after header |
| Markdown too large (>10M chars) | Return 400, suggest shorter analysis |
| Network timeout during export | Retry with exponential backoff (max 3) |

### Next Steps

1. **Backend Coder Agent:** Implement the google-drive-export module following the architecture above
2. **Frontend Coder Agent:** Implement Google auth flow + export button on Market Analysis screen
3. **Manual Testing:** Test OAuth2 flow with real Google account
4. **Google Cloud Console:** Create OAuth2 credentials, configure consent screen

---

*Research conducted using Google Workspace API documentation (developers.google.com) and codebase analysis of existing RealEstateBackendApp.*
