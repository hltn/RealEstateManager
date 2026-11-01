# Thiết kế Content Deduplication — Phát hiện bài viết trùng lặp nội dung

> Ngày tạo: 2026-08-14
> Module: news-fire-crawl-manager
> Trạng thái: Draft

---

## 1. Bối cảnh & Vấn đề

### 1.1. Hiện trạng

Hệ thống crawl tin tức bất động sản từ nhiều nguồn báo. Flow hiện tại:

```
Crawl → RawArticle (dedup bằng urlHash)
  → AI Filter (AIFilterService.filterRawArticles)
    → Save (NewsArticleService.saveArticles) → NewsArticle (dedup bằng urlHash)
```

Dedup hiện tại chỉ dựa trên `urlHash` (SHA-256 hash của URL) → **chỉ chặn được bài trùng URL**, không phát hiện được bài cùng nội dung từ nguồn khác nhau.

### 1.2. Vấn đề cần giải quyết

Cùng 1 sự kiện/chủ đề có thể được đăng bởi 2-3 báo khác nhau:

- **Tiêu đề gần giống** nhưng không identical (viết lại, paraphrase)
- **Nội dung có thể khác** (đăng chéo nguyên văn hoặc viết lại)
- **Ngày đăng khác nhau** → không dùng timestamp làm key
- URL hoàn toàn khác nhau → `urlHash` không bắt được

Ví dụ:
| Nguồn | Tiêu đề |
|---|---|
| VnExpress | "Giá chung cư Hà Nội tăng 15% trong quý 3" |
| Thanh Niên | "Chung cư tại Hà Nội tăng giá mạnh 15% quý III/2026" |
| Dân Trí | "Giá nhà chung cư Hà Nội tiếp tục leo thang, tăng 15%" |

→ 3 URL khác nhau, 3 `urlHash` khác nhau, nhưng cùng 1 sự kiện.

---

## 2. Phương án: Embedding Similarity

### 2.1. Nguyên lý

Dùng **embedding model** để chuyển text (title + phần đầu nội dung) thành vector số nhiều chiều. Hai bài có nội dung ngữ nghĩa gần nhau sẽ có vector gần nhau → đo bằng **cosine similarity**.

```
Bài A: "Giá chung cư Hà Nội tăng 15% trong quý 3"
  → vector A: [0.012, -0.034, 0.056, ...]

Bài B: "Chung cư tại Hà Nội tăng giá mạnh 15% quý III/2026"
  → vector B: [0.014, -0.031, 0.052, ...]

cosine(A, B) = 0.93 → DUPLICATE ✓

Bài C: "Thời tiết Hà Nội hôm nay nắng nóng"
  → vector C: [0.089, 0.045, -0.067, ...]

cosine(A, C) = 0.31 → KHÔNG trùng ✓
```

### 2.2. Lựa chọn infrastructure

- **MongoDB self-hosted** (không có Atlas Vector Search) → lưu vector như array trong document, tính cosine ở **application layer** (NestJS)
- **Embedding API** dùng AI API hiện có (OpenRouter hoặc Must1c)

---

## 3. Chọn Embedding Model

### 3.1. Các lựa chọn qua OpenRouter

| Model | Số chiều | Giá (per 1M tokens) | Đa ngôn ngữ | Ghi chú |
|---|---|---|---|---|
| `openai/text-embedding-3-small` | 1536 | ~$0.02 | Tốt | Nhẹ, giá rẻ, chất lượng tốt |
| `openai/text-embedding-3-large` | 3072 | ~$0.13 | Rất tốt | Chính xác hơn, nặng hơn |
| `openai/text-embedding-ada-002` | 1536 | ~$0.10 | Tốt | Legacy, không khuyến nghị |

### 3.2. Qua Must1c (htmustc.id.vn)

Must1c proxy hiện hỗ trợ chat completions. Nếu có endpoint `/v1/embeddings` tương thích OpenAI, có thể dùng trực tiếp. Cần kiểm tra khả dụng.

### 3.3. Khuyến nghị

**`openai/text-embedding-3-small`** qua OpenRouter:
- 1536 chiều — đủ chính xác cho bài viết tiếng Việt
- Giá rẻ nhất: ~$0.02/1M tokens (~200 ký tự title+desc ≈ ~50-80 tokens → chi phí rất thấp)
- Hỗ trợ tốt tiếng Việt
- Có thể reduce dimensions xuống 512 hoặc 256 nếu muốn tiết kiệm storage (OpenAI hỗ trợ `dimensions` parameter)

**Lựa chọn thay thế tiết kiệm hơn:** dùng `dimensions: 512` khi gọi `text-embedding-3-small` → giảm storage 3x mà vẫn giữ 95%+ accuracy cho bài toán dedup.

---

## 4. Thiết kế Schema

### 4.1. Schema thiết kế mới

#### RawArticle — Bổ sung field dedup

Bài duplicate **KHÔNG lưu vào bảng chính**, mà được giữ nguyên tại RawArticle kèm flag + link tới bài đích:

```typescript
@Schema({ timestamps: true })
export class RawArticle extends Document {
  // ... các field hiện tại giữ nguyên ...

  // === DEDUP FIELDS ===

  /** Đánh dấu bài này là duplicate của bài đã lưu trong NewsArticle */
  @Prop({ default: false })
  isDuplicate: boolean;

  /** Link tới bài gốc đã tồn tại trong NewsArticle (nếu isDuplicate: true) */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'NewsArticle', default: null })
  duplicateOfArticleId: mongoose.Types.ObjectId | null;

  /** Cosine similarity score với bài đích */
  @Prop({ type: Number, default: null })
  duplicateScore: number | null;

  /** Vector embedding của title + summary (dùng cho semantic dedup) */
  @Prop({ type: [Number], default: null })
  contentEmbedding: number[] | null;

  /** Text đã dùng để tạo embedding (dùng để debug/re-embed) */
  @Prop({ required: false })
  embeddingInput: string;

  /** Model đã dùng để tạo embedding */
  @Prop({ required: false })
  embeddingModel: string;

  /** ObjectId của NewsArticle đã được tạo từ bản ghi này (nếu không phải duplicate) */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'NewsArticle', default: null })
  savedArticleId: mongoose.Types.ObjectId | null;
}
```

#### NewsArticle — Bổ sung embedding field

NewsArticle chỉ cần `contentEmbedding` để làm candidate cho dedup. **Không có** `isDuplicate` / `duplicateOf` — vì bài duplicate không được lưu vào đây:

```typescript
@Schema({ timestamps: true })
export class NewsArticle extends Document {
  // ... các field hiện tại giữ nguyên ...

  // === DEDUP FIELDS ===

  /** Vector embedding của title + summary (dùng làm candidate khi so sánh) */
  @Prop({ type: [Number], default: null })
  contentEmbedding: number[] | null;

  /** Text đã dùng để tạo embedding */
  @Prop({ required: false })
  embeddingInput: string;

  /** Model đã dùng để tạo embedding */
  @Prop({ required: false })
  embeddingModel: string;
}
```

**Nguyên tắc thiết kế:** RawArticle là "bản ghi gốc" — mọi dữ liệu crawl đều nằm ở đây. NewsArticle là "bản ghi đã xử lý" — chỉ chứa bài không trùng. Link từ Raw → News qua `savedArticleId`, link từ Raw duplicate → News bài đích qua `duplicateOfArticleId`.

### 4.2. Index strategy (self-hosted MongoDB)

```javascript
// === NewsArticle indexes (candidates cho dedup) ===
db.newsarticles.createIndex({ "publishDate": -1 });
db.newsarticles.createIndex({ "contentEmbedding": 1 }, { sparse: true });

// Compound index tối ưu cho query candidates
db.newsarticles.createIndex({
  "publishDate": -1,
  "contentEmbedding": 1
}, { sparse: true });

// === RawArticle indexes (dedup tracking) ===
db.rawarticles.createIndex({ "isDuplicate": 1 });
db.rawarticles.createIndex({ "contentEmbedding": 1 }, { sparse: true });
db.rawarticles.createIndex({ "savedArticleId": 1 }, { sparse: true });

// Compound index cho raw articles list screen
db.rawarticles.createIndex({
  "isDuplicate": 1,
  "createdAt": -1
});
```

**Lưu ý:** Với self-hosted MongoDB, KHÔNG tạo index trên array `contentEmbedding` kiểu multikey — index multikey trên mảng 1536 phần tử sẽ rất lớn và chậm. Index `{ "contentEmbedding": 1 }` với `sparse: true` chỉ dùng để filter `$exists` (bài nào đã có embedding), KHÔNG dùng cho vector search.

---

## 5. Flow xử lý Dedup chi tiết

### 5.1. Vị trí trong pipeline

Dedup được chèn vào **bước 3 — `saveArticles()`**, sau khi AI Filter đã lọc bài relevant:

```
1. Crawl → lưu RawArticle (dedup URL bằng urlHash — giữ nguyên)
2. AI Filter → lọc bài relevant
3. saveArticles() → [MỚI] tính embedding + so sánh dedup
                     │
                     ├─ Bài KHÔNG trùng → lưu vào NewsArticle
                     │   + cập nhật RawArticle.savedArticleId
                     │   + lưu contentEmbedding vào cả 2 bảng
                     │
                     └─ Bài TRÙNG → KHÔNG lưu vào NewsArticle
                         + cập nhật RawArticle.isDuplicate: true
                         + cập nhật RawArticle.duplicateOfArticleId
                         + cập nhật RawArticle.duplicateScore
```

### 5.2. Flow chi tiết trong saveArticles()

```
Với mỗi article trong batch:
│
├─ 1. Kiểm tra urlHash trùng (giữ logic hiện tại)
│     └─ Trùng urlHash → skip (duplicates++)
│
├─ 2. Tạo embedding input text
│     └─ input = `${article.title}. ${(article.summary || article.description || article.content?.substring(0, 300)) || ''}`
│
├─ 3. Gọi Embedding API (qua AI platform đang active — OpenRouter hoặc Must1c)
│     └─ Gửi text input → nhận về vector embedding (mảng số, số chiều tùy model)
│
├─ 4. Query candidates từ DB (NewsArticle)
│     └─ Lấy các bài trong N ngày gần nhất (mặc định 30, admin cấu hình qua env/DB config)
│     └─ Chỉ lấy bài có contentEmbedding != null
│     └─ Projection: chỉ lấy { _id, contentEmbedding, title }
│
├─ 5. Tính cosine similarity với từng candidate
│     └─ Tìm bài có score cao nhất
│
├─ 6. Quyết định
│     │
│     ├─ Score >= 0.90 (TRÙNG) → KHÔNG lưu vào NewsArticle
│     │   └─ Cập nhật RawArticle:
│     │       isDuplicate: true
│     │       duplicateOfArticleId: candidate._id
│     │       duplicateScore: score
│     │       contentEmbedding: vector (giữ lại để debug/re-embed)
│     │
│     └─ Score < 0.90 (KHÔNG TRÙNG) → Lưu vào NewsArticle
│         └─ Cập nhật RawArticle:
│             savedArticleId: newArticle._id
│             contentEmbedding: vector
```

### 5.3. Threshold

| Khoảng cosine | Ý nghĩa | Hành động |
|---|---|---|
| >= 0.95 | Gần như chắc chắn trùng (đăng chéo nguyên văn) | Bài KHÔNG vào bảng chính |
| 0.90 - 0.95 | Rất có thể trùng (cùng sự kiện, viết lại) | Bài KHÔNG vào bảng chính |
| 0.85 - 0.90 | Có thể liên quan nhưng không chắc trùng | Lưu bình thường, log warning |
| < 0.85 | Không liên quan | Lưu bình thường |

**Khuyến nghị threshold: 0.90** — cân bằng giữa false positive (đánh nhầm bài khác thành trùng) và false negative (bỏ sót bài trùng). Có thể điều chỉnh sau khi có dữ liệu thực tế.

### 5.4. Xử lý khi phát hiện duplicate

Khi phát hiện bài duplicate (cosine >= threshold):

**Bài KHÔNG được lưu vào NewsArticle** — chỉ cập nhật RawArticle:

```typescript
await this.rawArticleModel.updateOne(
  { _id: rawArticleId },
  {
    $set: {
      isDuplicate: true,
      duplicateOfArticleId: matchedArticle._id,  // ObjectId bài đích trong NewsArticle
      duplicateScore: matchedScore,
      contentEmbedding: newEmbedding,  // giữ vector để debug/re-embed
    },
  },
);
```

**Nguyên tắc:** Dữ liệu crawl luôn được giữ nguyên trong RawArticle. Bảng chính NewsArticle chỉ chứa bài đã qua bộ lọc — sạch duplicate. Admin có thể xem dữ liệu crawl gốc, kiểm tra flag duplicate, và click link để xem bài đích trực tiếp từ màn hình Raw Articles.

### 5.5. Giao diện hiển thị Duplicate trên Raw Articles Screen

Màn hình danh sách Raw Articles cần bổ sung:

**Cột/Tag hiển thị:**
- Bài duplicate hiện **tag màu đỏ** "Trùng lặp" hoặc icon ⚠️
- Bài đã lưu (không trùng) hiện **tag màu xanh** "Đã lưu" kèm link tới bài trong NewsArticle
- Bài chờ xử lý hiện tag màu xám "Chờ xử lý"

**Nút hành động cho bài duplicate:**
- Nút **"Xem bài gốc"** (hoặc icon 👁️) — khi click, mở modal/panel hiển thị nội dung bài đích trong NewsArticle (tóm tắt, tiêu đề, nguồn, link gốc)

**Mockup Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│  Raw Articles                                      [Lọc] [Tìm] │
├──────────────────────────────────────────────────────────────────┤
│ ☐ │ Nguồn      │ Tiêu đề                  │ Trạng thái          │
├───┼────────────┼──────────────────────────┼─────────────────────┤
│ ☐ │ VnExpress  │ Giá chung cư Hà Nội...  │ 🟢 Đã lưu           │
│ ☐ │ Thanh Niên │ Chung cư tại Hà Nội...  │ 🔴 Trùng lặp       │
│   │            │                          │ ⚠️ Giống bài "Giá  │
│   │            │                          │    chung cư HN..."  │
│   │            │                          │ (score: 0.93)      │
│   │            │                          │ [👁️ Xem bài gốc]   │
│ ☐ │ Dân Trí    │ Thị trường bất động...  │ 🟢 Đã lưu           │
│ ☐ │ CafeF      │ Đầu tư căn hộ...        │ ⚪ Chờ xử lý       │
└───┴────────────┴──────────────────────────┴─────────────────────┘

Khi click "Xem bài gốc":
┌──────────────────────────────────────────┐
│  📄 Bài gốc (NewsArticle)         [✕]  │
├──────────────────────────────────────────┤
│  Tiêu đề: Giá chung cư Hà Nội tăng     │
│           15% trong quý 3               │
│  Nguồn: VnExpress                       │
│  Ngày: 2026-08-10                       │
│  Tóm tắt: ...                           │
│  Link: https://vnexpress.net/...         │
│                                          │
│  [Đi tới bài viết]                      │
└──────────────────────────────────────────┘
```

---

## 6. Thuật toán Cosine Similarity

### 6.1. Hàm tính cosine

```typescript
/**
 * Tính cosine similarity giữa 2 vector.
 * Trả về giá trị từ -1 đến 1 (1 = hoàn toàn giống, 0 = không liên quan).
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
```

### 6.2. Query candidates từ MongoDB

```typescript
async findDuplicateCandidates(
  publishDate: string,
  windowDays: number = 30, // Mặc định 30 ngày, admin cấu hình qua DEDUP_WINDOW_DAYS
): Promise<{ _id: ObjectId; contentEmbedding: number[]; title: string }[]> {
  const refDate = new Date(publishDate);
  const startDate = new Date(refDate);
  startDate.setDate(startDate.getDate() - windowDays);

  return this.newsArticleModel
    .find({
      isDuplicate: false,
      contentEmbedding: { $ne: null },
      publishDate: {
        $gte: startDate.toISOString(),
        $lte: refDate.toISOString(),
      },
    })
    .select('_id contentEmbedding title')
    .lean()
    .exec();
}
```

### 6.3. Tìm bài trùng lặp

```typescript
interface DuplicateResult {
  isDuplicate: boolean;
  duplicateOf: ObjectId | null;
  duplicateScore: number | null;
}

async checkDuplicate(
  embedding: number[],
  publishDate: string,
  threshold: number = 0.90,
): Promise<DuplicateResult> {
  const candidates = await this.findDuplicateCandidates(publishDate);

  if (candidates.length === 0) {
    return { isDuplicate: false, duplicateOf: null, duplicateScore: null };
  }

  let bestMatch: { id: ObjectId; score: number; title: string } | null = null;

  for (const candidate of candidates) {
    const score = cosineSimilarity(embedding, candidate.contentEmbedding);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { id: candidate._id, score, title: candidate.title };
    }
  }

  if (bestMatch && bestMatch.score >= threshold) {
    return {
      isDuplicate: true,
      duplicateOf: bestMatch.id,
      duplicateScore: bestMatch.score,
    };
  }

  return { isDuplicate: false, duplicateOf: null, duplicateScore: null };
}
```

### 6.4. Tối ưu performance

**Vấn đề:** Nếu có 2000 bài trong 30 ngày, mỗi bài mới phải so cosine 2000 lần. Với vector 512 chiều → 2000 × 512 phép nhân = ~1M phép tính. Trên Node.js, đây vẫn nhanh (< 100ms).

**Tối ưu nếu cần (khi scale lên):**

1. **Thu hẹp window**: Giảm `DEDUP_WINDOW_DAYS` xuống 14 hoặc 7 → giảm candidates tương ứng
2. **Pre-filter bằng source**: Không so bài cùng nguồn (cùng nguồn đã dedup bằng urlHash)
3. **Batch embedding**: Gọi API embedding 1 lần cho cả batch thay vì từng bài
4. **Cache candidates**: Cache embedding của bài gốc trong 30 ngày gần nhất vào memory (LRU cache)
5. **Reduce dimensions**: Dùng `dimensions: 256` thay vì 512 → giảm 50% storage + tính toán

**Benchmark ước lượng (Node.js, 512 chiều):**
| Số candidates | Thời gian cosine | RAM cho embeddings |
|---|---|---|
| 100 | < 5ms | ~200 KB |
| 500 | < 20ms | ~1 MB |
| 1000 | < 50ms | ~2 MB |
| 5000 | < 250ms | ~10 MB |

---

## 7. Gọi Embedding API

### 7.1. Service mới: EmbeddingService

```typescript
// Pseudo-code cho EmbeddingService

@Injectable()
export class EmbeddingService {
  /**
   * Tạo embedding cho 1 đoạn text.
   * Ưu tiên dùng OpenRouter → fallback Must1c nếu có.
   */
  async createEmbedding(text: string): Promise<number[]> {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text,
        dimensions: 512,  // reduce từ 1536 → 512 để tiết kiệm
      }),
    });

    const data = await response.json();
    return data.data[0].embedding;  // number[512]
  }

  /**
   * Batch embedding cho nhiều text cùng lúc.
   * OpenAI embeddings API hỗ trợ input là array.
   */
  async createEmbeddingBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: texts,
        dimensions: 512,
      }),
    });

    const data = await response.json();
    return data.data.map((d: any) => d.embedding);
  }

  /**
   * Chuẩn bị text input cho embedding.
   * Kết hợp title + summary/description, giới hạn độ dài.
   */
  prepareEmbeddingInput(article: {
    title: string;
    summary?: string;
    description?: string;
    content?: string;
  }): string {
    const secondary = article.summary
      || article.description
      || article.content?.substring(0, 300)
      || '';

    const input = `${article.title}. ${secondary}`.trim();

    // Giới hạn ~500 ký tự (~120-150 tokens) — đủ ngữ nghĩa, tiết kiệm token
    return input.substring(0, 500);
  }
}
```

### 7.2. Tích hợp vào saveArticles()

```typescript
// Pseudo-code thay đổi trong saveArticles()

async saveArticles(articles: any[]): Promise<SaveResult> {
  // ... giữ nguyên logic hiện tại ...

  for (const article of articles) {
    // 1. Kiểm tra urlHash (giữ nguyên)
    const existing = await this.newsArticleModel.findOne({ urlHash });
    if (existing) { duplicates++; continue; }

    // 2. [MỚI] Tính embedding
    let contentEmbedding: number[] | null = null;
    let embeddingInput: string = '';
    let isDuplicate = false;
    let duplicateOfArticleId: ObjectId | null = null;
    let duplicateScore: number | null = null;

    try {
      embeddingInput = this.embeddingService.prepareEmbeddingInput(article);
      contentEmbedding = await this.embeddingService.createEmbedding(embeddingInput);

      // 3. [MỚI] Kiểm tra duplicate
      const checkResult = await this.checkDuplicate(
        contentEmbedding,
        finalPublishDate,
      );

      isDuplicate = checkResult.isDuplicate;
      duplicateOfArticleId = checkResult.duplicateOf;
      duplicateScore = checkResult.duplicateScore;

      if (isDuplicate) {
        this.logger.warn(
          `Duplicate detected: "${article.title}" ≈ existing article ` +
          `(score: ${duplicateScore?.toFixed(3)}, ref: ${duplicateOfArticleId})`
        );
      }
    } catch (embeddingError) {
      // Embedding fail → bài được xử lý như bình thường (không dedup)
      this.logger.error(`Embedding failed for "${article.title}": ${embeddingError.message}`);
    }

    if (isDuplicate) {
      // 4a. TRÙNG → KHÔNG lưu vào NewsArticle, cập nhật RawArticle
      await this.rawArticleModel.updateOne(
        { _id: rawArticle._id },
        {
          $set: {
            isDuplicate: true,
            duplicateOfArticleId,
            duplicateScore,
            contentEmbedding,
            embeddingInput,
            embeddingModel: embeddingModelName,
          },
        },
      );
    } else {
      // 4b. KHÔNG TRÙNG → lưu vào NewsArticle
      const newArticle = new this.newsArticleModel({
        ...mappedArticle,
        urlHash,
        contentEmbedding,
        embeddingInput,
        embeddingModel: embeddingModelName,
      });
      await newArticle.save();

      // Cập nhật RawArticle với link tới bài đã lưu
      await this.rawArticleModel.updateOne(
        { _id: rawArticle._id },
        {
          $set: {
            savedArticleId: newArticle._id,
            contentEmbedding,
            embeddingInput,
            embeddingModel: embeddingModelName,
          },
        },
      );

      savedCount++;
    }
  }
}
```

---

## 8. Xử lý Edge Cases

### 8.1. Bài đầu tiên (chưa có gì để so)

`findDuplicateCandidates()` trả về mảng rỗng → `checkDuplicate()` return `isDuplicate: false` → lưu bình thường vào NewsArticle. Không cần xử lý đặc biệt.

### 8.2. Batch lớn (nhiều bài cùng lúc)

Vấn đề: 10 bài trong cùng batch, bài thứ 5 trùng bài thứ 2 nhưng bài thứ 2 vừa được lưu vào NewsArticle và chưa có embedding trong candidates.

Giải pháp: Duy trì **in-memory buffer** các embedding đã tính trong batch hiện tại:

```typescript
// Trong saveArticles(), trước vòng for:
const batchEmbeddings: { embedding: number[]; id: string; title: string }[] = [];

// Trong vòng for, sau khi tính embedding:
// So sánh với cả DB candidates VÀ batchEmbeddings
for (const prev of batchEmbeddings) {
  const score = cosineSimilarity(contentEmbedding, prev.embedding);
  if (score >= threshold && score > bestMatch.score) {
    // Trùng với bài trước trong cùng batch
    bestMatch = { id: prev.id, score, title: prev.title };
  }
}

// Sau khi lưu bài (nếu không phải duplicate):
if (!isDuplicate) {
  batchEmbeddings.push({
    embedding: contentEmbedding,
    id: newArticle._id.toString(),
    title: article.title,
  });
}
```

### 8.3. Bài cũ chưa có embedding

Bài lưu trước khi triển khai tính năng dedup sẽ có `contentEmbedding: null`. Các bài này:
- **Không bị đánh dấu duplicate** (vì chưa có embedding để so)
- **Không tham gia làm candidate** cho dedup (query filter `contentEmbedding: { $ne: null }`)
- Cần **migration backfill** (xem mục 9)

### 8.4. Embedding API fail giữa chừng

- **Fail cho 1 bài**: bài đó được xử lý như bình thường (không dedup check) → lưu vào NewsArticle. Bài sẽ có `contentEmbedding: null`. Có thể backfill sau.
- **Fail toàn bộ API (network/quota)**: tất cả bài trong batch được lưu bình thường không dedup. Hệ thống vẫn hoạt động (graceful degradation), chỉ mất khả năng dedup tạm thời.
- **Retry logic**: không retry inline (tránh block pipeline). Backfill job sẽ xử lý các bài thiếu embedding.

### 8.5. Bài bị đánh nhầm là duplicate (false positive)

Admin cần khả năng **override** trên màn hình Raw Articles:
- Nút "Bỏ đánh dấu trùng lặp" → set `isDuplicate: false`, xóa `duplicateOfArticleId`
- Có thể thêm endpoint API hoặc xử lý qua MongoDB trực tiếp trong giai đoạn đầu
- Sau khi override, bài có thể được xử lý lại (re-process) để lưu vào NewsArticle nếu cần

---

## 9. Migration Plan — Backfill Embedding

### 9.1. Script backfill

Tạo script/endpoint chạy 1 lần (hoặc cronjob) để backfill embedding cho các bài cũ:

```typescript
async backfillEmbeddings(batchSize: number = 50): Promise<{
  processed: number;
  failed: number;
}> {
  let processed = 0;
  let failed = 0;

  // Lấy bài chưa có embedding, sắp theo ngày mới nhất
  const articlesWithoutEmbedding = await this.newsArticleModel
    .find({ contentEmbedding: null })
    .sort({ publishDate: -1 })
    .limit(batchSize)
    .exec();

  for (const article of articlesWithoutEmbedding) {
    try {
      const input = this.embeddingService.prepareEmbeddingInput(article);
      const embedding = await this.embeddingService.createEmbedding(input);

      await this.newsArticleModel.updateOne(
        { _id: article._id },
        {
          $set: {
            contentEmbedding: embedding,
            embeddingInput: input,
            embeddingModel: 'openai/text-embedding-3-small',
          },
        },
      );
      processed++;
    } catch (error) {
      failed++;
      this.logger.error(`Backfill failed for ${article._id}: ${error.message}`);
    }

    // Rate limiting: chờ 100ms giữa mỗi request
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { processed, failed };
}
```

### 9.2. Kế hoạch triển khai backfill

1. **Giai đoạn 1**: Deploy code mới — bài mới được tính embedding tự động
2. **Giai đoạn 2**: Chạy backfill cho bài cũ (batch 50 bài/lần, rate limit 100ms)
3. **Giai đoạn 3**: Sau khi backfill xong, chạy dedup scan trên toàn bộ bài đã có embedding → đánh dấu duplicate retroactively

### 9.3. Retroactive dedup scan (sau backfill)

```typescript
async retroactiveDedupScan(): Promise<{ duplicatesFound: number }> {
  let duplicatesFound = 0;

  // Lấy tất cả bài có embedding, chưa bị đánh dấu duplicate, sắp theo ngày
  const articles = await this.newsArticleModel
    .find({ contentEmbedding: { $ne: null }, isDuplicate: false })
    .sort({ publishDate: 1 })  // xử lý từ cũ → mới (bài cũ hơn = bài gốc)
    .exec();

  for (let i = 1; i < articles.length; i++) {
    const current = articles[i];

    // So với tất cả bài trước đó (trong window 14 ngày)
    for (let j = i - 1; j >= 0; j--) {
      const candidate = articles[j];

      // Giới hạn window (mặc định 30 ngày, lấy từ config)
      const daysDiff = (new Date(current.publishDate).getTime() -
        new Date(candidate.publishDate).getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > windowDays) break;

      if (candidate.isDuplicate) continue;  // skip bài đã là duplicate

      const score = cosineSimilarity(
        current.contentEmbedding,
        candidate.contentEmbedding,
      );

      if (score >= 0.90) {
        await this.newsArticleModel.updateOne(
          { _id: current._id },
          { $set: { isDuplicate: true, duplicateOf: candidate._id, duplicateScore: score } },
        );
        duplicatesFound++;
        break;  // đã tìm thấy duplicate, không cần so tiếp
      }
    }
  }

  return { duplicatesFound };
}
```

---

## 10. Ước lượng Chi phí

### 10.1. Storage overhead

| Cấu hình | Kích thước/bài | 1000 bài | 10,000 bài |
|---|---|---|---|
| 1536 chiều (float64) | ~12.3 KB | ~12 MB | ~120 MB |
| 512 chiều (float64, khuyến nghị) | ~4.1 KB | ~4 MB | ~40 MB |
| 256 chiều (float64) | ~2.0 KB | ~2 MB | ~20 MB |

**Khuyến nghị 512 chiều**: với 10,000 bài → ~40 MB thêm vào MongoDB. Không đáng kể so với content bài viết.

Overhead thêm các field khác: `embeddingInput` (~500 bytes), `embeddingModel` (~30 bytes), `isDuplicate` + `duplicateOf` + `duplicateScore` (~50 bytes) → ~580 bytes/bài → ~5.8 MB/10K bài.

**Tổng storage overhead ước lượng: ~46 MB / 10,000 bài** (512 chiều).

### 10.2. API cost cho embedding

| Kịch bản | Tokens/bài | Bài/ngày | Cost/ngày | Cost/tháng |
|---|---|---|---|---|
| Crawl bình thường | ~100-150 | 30-50 | ~$0.0001 | ~$0.003 |
| Crawl nhiều nguồn | ~100-150 | 100-200 | ~$0.0003 | ~$0.01 |
| Backfill 5000 bài cũ | ~100-150 | one-time | ~$0.01 | - |

**Chi phí rất thấp** — `text-embedding-3-small` giá $0.02/1M tokens. Với 200 bài/ngày × 150 tokens = 30,000 tokens/ngày = $0.0006/ngày ≈ **$0.02/tháng**.

### 10.3. Compute cost (application layer)

- Cosine similarity: 500 candidates × 512 chiều = ~256K phép nhân → < 20ms trên Node.js
- Không cần thêm infrastructure (chạy trên app server hiện tại)
- RAM overhead: ~2 MB cho cache 500 embeddings (có thể bỏ qua)

---

## 11. Tóm tắt quyết định

| Hạng mục | Quyết định |
|---|---|
| Embedding model | `openai/text-embedding-3-small` qua OpenRouter |
| Số chiều vector | 512 (reduce từ 1536) |
| Lưu trữ embedding | NewsArticle (candidates) + RawArticle (tracking) |
| Tính cosine | Application layer (NestJS) |
| Threshold | 0.90 |
| Xử lý duplicate | Bài KHÔNG lưu vào NewsArticle, flag trong RawArticle (`isDuplicate`, `duplicateOfArticleId`, `duplicateScore`) |
| Link Raw → News | `savedArticleId` (bài đã lưu), `duplicateOfArticleId` (bài trùng trỏ tới bài đích) |
| Vị trí trong pipeline | Trong `saveArticles()`, sau urlHash check |
| Window so sánh | 30 ngày gần nhất (admin cấu hình được qua env `DEDUP_WINDOW_DAYS`) |
| Fallback khi API fail | Bài được xử lý như bình thường (không dedup), backfill embedding sau |
| UI hiển thị | Tag trạng thái trên Raw Articles screen + nút "Xem bài gốc" cho bài duplicate |
| Chi phí ước tính | ~$0.02/tháng (embedding) + ~46MB storage/10K bài |

---

## 12. Các bước tiếp theo (Implementation)

### Backend
1. [ ] Tạo `EmbeddingService` trong module `news-fire-crawl-manager`
2. [ ] Bổ sung fields dedup vào `RawArticle` schema (`isDuplicate`, `duplicateOfArticleId`, `duplicateScore`, `contentEmbedding`, `embeddingInput`, `embeddingModel`, `savedArticleId`)
3. [ ] Bổ sung `contentEmbedding`, `embeddingInput`, `embeddingModel` vào `NewsArticle` schema
4. [ ] Tạo indexes mới cho RawArticle và NewsArticle
5. [ ] Tích hợp dedup logic vào `saveArticles()` — bài trùng KHÔNG lưu NewsArticle, cập nhật RawArticle
6. [ ] Tạo endpoint API xem bài gốc cho UI (`GET /news-articles/:id`)
7. [ ] Tạo endpoint/script backfill embedding cho bài cũ
8. [ ] Tạo migration script để retroactive dedup scan sau backfill

### Frontend
9. [ ] Thêm cột "Trạng thái" vào Raw Articles screen (tag: Đã lưu / Trùng lặp / Chờ xử lý)
10. [ ] Thêm nút "Xem bài gốc" cho bài duplicate (modal hiển thị nội dung bài đích)
11. [ ] Thêm nút "Bỏ đánh dấu trùng lặp" cho false positive override

### Testing & Calibration
12. [ ] Test với dữ liệu thực tế và calibrate threshold
13. [ ] Triển khai backfill embedding cho bài cũ
14. [ ] Chạy retroactive dedup scan
