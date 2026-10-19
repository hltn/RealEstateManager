# Kế hoạch: Export Báo Cáo Phân Tích Thị Trường lên Google Drive

> Ngày tạo: 2026-08-15
> Module: news-fire-crawl-manager
> Trạng thái: Draft
> Author: Neptune (PM)

---

## 1. Bối cảnh & Vấn đề

### 1.1. Hiện trạng

Hệ thống đã có tính năng phân tích thị trường bất động sản:
- **analyzeMarketTrendsByAI()** — Gọi AI phân tích trend, trả về markdown content
- **MarketAnalysisHistory** — Lưu kết quả phân tích vào MongoDB (content markdown + articleIds)
- **API endpoints** — `GET /market-analysis-history`, `GET /market-analysis-history/:id`

**Vấn đề:** Báo cáo chỉ lưu trong database, không có cách export ra file để chia sẻ với team, khách hàng, hoặc lưu trữ bên ngoài.

### 1.2. Yêu cầu

- Export báo cáo phân tích thị trường (markdown) lên Google Drive
- File được tạo dưới dạng Google Doc hoặc file text
- Lưu vào folder được cấu hình sẵn
- Hiển thị link tới file trên UI sau khi export
- Không cần user login — chạy server-side bằng Service Account

---

## 2. Kiến trúc đề xuất

### 2.1. Lựa chọn Authentication

| Phương án | Ưu điểm | Nhược điểm | Khuyến nghị |
|-----------|---------|-----------|-------------|
| **Service Account** | Không cần user login, chạy server-side, đơn giản | Cần share folder với service account email | ✅ **Chọn** |
| OAuth2 User Flow | User tự xác thực | Phức tạp hơn, cần refresh token, UI thêm bước login | ❌ |

### 2.2. Lựa chọn File Format

| Format | Ưu điểm | Nhược điểm | Khuyến nghị |
|--------|---------|-----------|-------------|
| **Google Doc** | Native trên Drive, dễ chia sẻ, format đẹp | Cần convert markdown → Google Doc | ✅ **Chọn** |
| Plain Text (.txt) | Đơn giản nhất | Mất formatting markdown | ❌ |
| PDF | Portable, cố định format | Cần thêm library convert | ❌ |

### 2.3. Flow tổng quát

```
User click "Export lên Google Drive"
        │
        ▼
Frontend gọi API:
  POST /market-analysis-history/:id/export/google-drive
        │
        ▼
Backend:
  1. Query MarketAnalysisHistory theo id
  2. Lấy content (markdown)
  3. Gọi GoogleDriveService.uploadReport(id, content)
  4. Google Drive API tạo Google Doc trong folder cấu hình
  5. Lưu googleDriveFileId + googleDriveLink vào MarketAnalysisHistory
  6. Trả về { fileId, webViewLink }
        │
        ▼
Frontend hiển thị link
```

### 2.4. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                         │
│  MarketAnalysisWorkflowScreen                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ History List │  │ View Detail  │  │ Export Button    │   │
│  │ (GET list)   │  │ (GET by id)  │  │ (POST export)    │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  Backend (NestJS)                           │
│  NewsFireCrawlManagerController                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ POST /market-analysis-history/:id/export/google-drive │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │                                │
│  NewsArticleService         │                                │
│  ┌──────────────────────────▼───────────────────────────┐   │
│  │ exportToGoogleDrive(id)                               │   │
│  │ 1. Query MarketAnalysisHistory by id                  │   │
│  │ 2. Call GoogleDriveService.uploadReport()             │   │
│  │ 3. Update MarketAnalysisHistory with drive link       │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │                                │
│  GoogleDriveService (MỚI)   │                                │
│  ┌──────────────────────────▼───────────────────────────┐   │
│  │ - uploadReport(id, content) → { fileId, webViewLink } │   │
│  │ - createDriveFolder(name) → folderId                   │   │
│  │ - Uses googleapis npm package                          │   │
│  │ - Auth: Service Account (GOOGLE_SERVICE_ACCOUNT_KEY)   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Google Drive API                               │
│  Files: create (Google Doc)                                 │
│  Permissions: Service Account key                           │
│  Folder: REPORT_FOLDER_ID (env config)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Schema Design

### 3.1. MarketAnalysisHistory — Bổ sung Google Drive fields

```typescript
@Schema({ timestamps: true })
export class MarketAnalysisHistory {
  @Prop({ required: true })
  content: string;

  @Prop({ type: [{ type: String }], required: true })
  articleIds: string[];

  // === GOOGLE DRIVE FIELDS ===

  /** Google Drive file ID (null nếu chưa export) */
  @Prop({ default: null })
  googleDriveFileId: string | null;

  /** Google Drive web view link */
  @Prop({ default: null })
  googleDriveLink: string | null;

  /** Thời gian export lên Google Drive */
  @Prop({ default: null })
  exportedAt: Date | null;
}
```

### 3.2. Indexes

```javascript
// Không cần thêm index mới — query vẫn theo _id hoặc createdAt
```

---

## 4. API Design

### 4.1. Export to Google Drive

```
POST /market-analysis-history/:id/export/google-drive
Authorization: Bearer <token> (nếu có auth middleware)

Response 200:
{
  "status": "exported",
  "fileId": "1abc...",
  "webViewLink": "https://drive.google.com/file/d/1abc/view",
  "exportedAt": "2026-08-15T10:00:00.000Z"
}

Response 404:
{
  "statusCode": 404,
  "message": "Market Analysis History with ID xxx not found"
}

Response 500:
{
  "statusCode": 500,
  "message": "Failed to export to Google Drive: <error>"
}
```

### 4.2. Re-export (update file đã có)

Nếu `googleDriveFileId` đã tồn tại → overwrite nội dung file thay vì tạo mới.

```
POST /market-analysis-history/:id/export/google-drive

Logic:
  if (existing.googleDriveFileId) {
    // Update nội dung file cũ
    await drive.files.update({ fileId, requestBody: { name, content } });
  } else {
    // Tạo file mới
    await drive.files.create({ requestBody: { name, mimeType, parents } });
  }
```

---

## 5. Service Design

### 5.1. GoogleDriveService (Mới)

```typescript
@Injectable()
export class GoogleDriveService {
  private readonly drive: drive_v3.Drive;
  private readonly folderId: string;

  constructor(private readonly configService: ConfigService) {
    const serviceAccountKey = JSON.parse(
      this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_KEY')
    );
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    this.drive = google.drive({ version: 'v3', auth });
    this.folderId = this.configService.get<string>('GOOGLE_DRIVE_REPORT_FOLDER_ID');
  }

  /**
   * Upload markdown report as Google Doc.
   * Returns { fileId, webViewLink }.
   */
  async uploadReport(
    title: string,
    content: string,
  ): Promise<{ fileId: string; webViewLink: string }> {
    const fileMetadata = {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      parents: [this.folderId],
    };

    // Google Drive API automatically converts markdown-like content
    // to Google Doc format when mimeType is set
    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: 'text/plain',
        body: content,
      },
      fields: 'id, webViewLink',
    });

    return {
      fileId: response.data.id,
      webViewLink: response.data.webViewLink,
    };
  }

  /**
   * Update existing Google Doc content.
   */
  async updateReport(
    fileId: string,
    title: string,
    content: string,
  ): Promise<{ fileId: string; webViewLink: string }> {
    await this.drive.files.update({
      fileId,
      requestBody: { name: title },
      media: {
        mimeType: 'text/plain',
        body: content,
      },
    });

    const file = await this.drive.files.get({
      fileId,
      fields: 'id, webViewLink',
    });

    return {
      fileId: file.data.id,
      webViewLink: file.data.webViewLink,
    };
  }
}
```

### 5.2. Tích hợp vào NewsArticleService

```typescript
async exportMarketAnalysisToGoogleDrive(
  id: string,
): Promise<{ fileId: string; webViewLink: string; exportedAt: Date }> {
  const record = await this.marketAnalysisHistoryModel.findById(id).exec();
  if (!record) {
    throw new NotFoundException(`Market Analysis History with ID ${id} not found`);
  }

  const title = `Bao cao phan tich thi truong - ${new Date(record.createdAt).toLocaleDateString('vi-VN')}`;

  let result;
  if (record.googleDriveFileId) {
    // Re-export: update file cũ
    result = await this.googleDriveService.updateReport(
      record.googleDriveFileId,
      title,
      record.content,
    );
  } else {
    // Export lần đầu
    result = await this.googleDriveService.uploadReport(title, record.content);
  }

  const exportedAt = new Date();
  await this.marketAnalysisHistoryModel.updateOne(
    { _id: id },
    {
      $set: {
        googleDriveFileId: result.fileId,
        googleDriveLink: result.webViewLink,
        exportedAt,
      },
    },
  );

  return { fileId: result.fileId, webViewLink: result.webViewLink, exportedAt };
}
```

---

## 6. Configuration

### 6.1. Environment Variables (mới)

```env
# Google Service Account — JSON string (hoặc path đến file)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}

# Google Drive Folder ID — folder chứa reports
GOOGLE_DRIVE_REPORT_FOLDER_ID=1abc123...
```

### 6.2. Google Cloud Setup (cần Oniichan thực hiện)

1. Tạo project trên [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Google Drive API** trên [API Library](https://console.cloud.google.com/apis/library)
3. Tạo **Service Account** trên [IAM](https://console.cloud.google.com/iam-admin/serviceaccounts):
   - Tên: `realestate-export-service`
   - Role: không cần (chỉ dùng Drive API)
   - Tạo **JSON key** → download file
4. Tạo folder trên Google Drive → share với email service account (Editor)
5. Copy Folder ID từ URL: `https://drive.google.com/drive/folders/FOLDER_ID`
6. Đặt cả 2 env vars vào `.env` của backend

---

## 7. Frontend Design

### 7.1. UI Components

**Market Analysis History List** — Thêm cột "Export":

| Báo cáo | Ngày tạo | Trạng thái Export | Hành động |
|---------|----------|-------------------|-----------|
| Phân tích Q3/2026 | 15/08/2026 | 🟢 Đã export | [🔗 Xem trên Drive] [📤 Export lại] |
| Phân tích 08/2026 | 08/08/2026 | ⚪ Chưa export | [📤 Export] |
| Phân tích 01/08/2026 | 01/08/2026 | ⏳ Đang export... | — |

**Export Button States:**
- `idle` → Hiển thị "📤 Export"
- `exporting` → Hiển thị spinner + "Đang export..."
- `exported` → Hiển thị link tới Google Drive

### 7.2. Modal Export Result

```
┌──────────────────────────────────────────┐
│  📤 Export thành công!              [✕]  │
├──────────────────────────────────────────┤
│  Báo cáo đã được export lên Google Drive │
│                                          │
│  📄 Bao cao phan tich thi truong       │
│     15/08/2026                           │
│                                          │
│  [🔗 Mở trên Google Drive]              │
│                                          │
│  [Export lại] [Đóng]                    │
└──────────────────────────────────────────┘
```

---

## 8. Testing Plan

### 8.1. Unit Tests

**GoogleDriveService:**
- `uploadReport()` — Mock Google Drive API, verify create called with correct params
- `updateReport()` — Mock Google Drive API, verify update called with correct params
- Constructor — verify throws if GOOGLE_SERVICE_ACCOUNT_KEY missing

**NewsArticleService.exportMarketAnalysisToGoogleDrive():**
- Export lần đầu → uploadReport called, fields updated
- Re-export → updateReport called, fields updated
- Record không tồn tại → NotFoundException

### 8.2. Integration Tests

- Export endpoint respond 200 với valid id
- Export endpoint respond 404 với invalid id
- Export endpoint respond 500 khi Google Drive API fail

### 8.3. Frontend Tests

- Button render đúng state theo exportedAt
- Click Export → gọi API, show loading, show success
- Click "Mở trên Google Drive" → mở link mới

---

## 9. Dependency & Impact Analysis

### 9.1. Files cần tạo mới

| File | Mô tả |
|------|-------|
| `services/google-drive.service.ts` | Google Drive integration service |
| `services/google-drive.service.spec.ts` | Unit tests |
| `dto/export-google-drive.dto.ts` | Response DTO (nếu cần) |

### 9.2. Files cần sửa

| File | Thay đổi |
|------|---------|
| `schemas/market-analysis-history.schema.ts` | Thêm 3 fields: googleDriveFileId, googleDriveLink, exportedAt |
| `services/news-article.service.ts` | Thêm method exportMarketAnalysisToGoogleDrive() |
| `news-fire-crawl-manager.controller.ts` | Thêm endpoint POST /:id/export/google-drive |
| `news-fire-crawl-manager.module.ts` | Đăng ký GoogleDriveService |
| `RealEstateAdminApp/src/screens/MarketAnalysisWorkflowScreen.tsx` | Thêm Export button + modal |

### 9.3. Packages cần cài

```bash
npm install googleapis
```

### 9.4. Impact Scope

- **KHÔNG** ảnh hưởng đến flow crawl/analyze hiện tại
- **KHÔNG** thay đổi API response format hiện tại
- Schema mới có default null → backward compatible
- Google Drive service tách riêng → loose coupling

---

## 10. Cards Implementation

| # | Card | Agent | Phụ thuộc | Ước lượng |
|---|------|-------|-----------|-----------|
| 1 | **Install googleapis + GoogleDriveService** | coder-backend | — | 20 phút |
| 2 | **Export Endpoint + Integration** | coder-backend | Card 1 | 30 phút |
| 3 | **Frontend Export UI** | coder-frontend | Card 2 | 25 phút |
| 4 | **QA Review** | qa-agent | Card 2 + Card 3 | 15 phút |

### Chi tiết từng card

**Card 1: Install googleapis + GoogleDriveService**
- `npm install googleapis` trong RealEstateBackendApp
- Tạo `services/google-drive.service.ts` với `uploadReport()`, `updateReport()`
- Bổ sung schema fields vào `market-analysis-history.schema.ts`
- Đăng ký GoogleDriveService vào module
- Viết unit test cho GoogleDriveService (mock googleapis)
- Env vars: `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_DRIVE_REPORT_FOLDER_ID`

**Card 2: Export Endpoint + Integration**
- Thêm method `exportMarketAnalysisToGoogleDrive()` vào NewsArticleService
- Thêm endpoint `POST /market-analysis-history/:id/export/google-drive` vào Controller
- Thêm unit test cho method mới
- Chạy full test suite

**Card 3: Frontend Export UI**
- Thêm Export button vào MarketAnalysisWorkflowScreen
- Thêm loading/success/error states
- Thêm modal hiển thị link Google Drive sau export
- Hiển thị "Đã export" badge nếu exportedAt != null
- Viết unit test

**Card 4: QA Review**
- Review code Backend + Frontend
- Kiểm tra test coverage
- Kiểm tra error handling
- Kiểm tra security (service account key không leak)
- Chạy full test suite

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Google Drive API quota | Export fail khi quota hết | Graceful error, retry logic, log quota remaining |
| Service Account key leak | Bảo mật | Env vars only, KHÔNG commit key, .gitignore |
| Folder permission | Export fail | Setup instruction rõ ràng, verify permission trong test |
| Large report content | Google Doc size limit (10MB) | Validate content size trước khi upload |

---

## 12. Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Card 1: Service + Schema | 20 phút | GoogleDriveService + unit tests |
| Card 2: Endpoint + Integration | 30 phút | Export API + integration tests |
| Card 3: Frontend UI | 25 phút | Export button + modal + tests |
| Card 4: QA Review | 15 phút | QA report |
| **Tổng** | **~90 phút** | **Feature hoàn chỉnh** |

---

## 13. Next Steps

1. ✅ Oniichan tạo Google Cloud Project + Service Account + Download JSON key
2. ✅ Oniichan cung cấp env vars (GOOGLE_SERVICE_ACCOUNT_KEY + GOOGLE_DRIVE_REPORT_FOLDER_ID)
3. ✅ Neptune dispatch coder-backend bắt đầu Card 1
4. ✅ Pipeline: Card 1 → Card 2 → Card 3 → Card 4 (QA)
