# Claude Prompt Caching — Cơ chế & Chi phí

> Nguồn: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
> Ngày tạo: 2026-08-14

---

## 1. Nguyên lý & Cơ chế

Prompt caching cho phép Anthropic cache **prefix** (đầu chuỗi tokens) của prompt. Khi request mới có cùng prefix → đọc từ cache thay vì xử lý lại → nhanh hơn và rẻ hơn.

### 1.1. Multi-turn conversation

```
Turn 1: system + tools + [msg1]
        └────────────────────┘
         Gửi lên → cache WRITE (lần đầu, 1.25x)

Turn 2: system + tools + [msg1 + msg2 + msg3]
        └────────────────────┘  └──────────┘
         Prefix giống turn 1    → CACHE HIT (0.1x)
                                  Phần mới → WRITE mới

Turn 3: system + tools + [msg1 + msg2 + msg3 + msg4 + msg5]
        └────────────────────┘  └───────────────────────┘
         Vẫn giống prefix cũ   → CACHE HIT (0.1x)
                                  Phần mới → WRITE mới
```

**Điều này có nghĩa:**
- Turn 1 đắt nhất — phải process toàn bộ (system + tools + msg đầu tiên)
- Turn 2+: phần system + tools + history cũ → **đọc từ cache (0.1x giá)**, chỉ phần message mới phải write (1.25x)
- Càng nhiều turns → tỷ lệ cache read càng cao → giá trung bình mỗi turn càng thấp

### 1.2. Khi nào cache MISS?

Cache bị phá vỡ (miss toàn bộ) khi:

1. **Sửa memory mid-session** → system prompt thay đổi → prefix thay đổi → phải re-process toàn bộ
2. **Bật/tắt tool mid-session** → tool definitions thay đổi → prefix thay đổi
3. **Thay đổi skill index** → thay đổi trong system prompt → prefix thay đổi
4. **Context compression** (auto-compact) → tóm tắt lại conversation → prefix thay đổi hoàn toàn

**Lưu ý quan trọng:** Context compression là **ngoại lệ duy nhất** được phép phá vỡ cache, vì nó cần thiết để tránh vượt context window.

### 1.3. Ví dụ chi phí mô phỏng

Giả sử system prompt + tools = 25,000 tokens, mỗi turn thêm ~2,000 tokens dialogue:

| Turn | Tokens cache WRITE (1.25x) | Tokens cache READ (0.1x) | Tổng tokens | Chi phí tương đối |
|---|---|---|---|---|
| 1 | 25,000 | 0 | 25,000 | **1.0x** (đắt nhất) |
| 2 | 2,000 | 25,000 | 27,000 | **0.30x** |
| 3 | 4,000 | 27,000 | 31,000 | **0.34x** |
| 4 | 6,000 | 29,000 | 35,000 | **0.37x** |
| 5 | 8,000 | 31,000 | 39,000 | **0.39x** |

→ Từ turn 2 trở đi, chi phí trung bình chỉ khoảng **30-40%** so với turn đầu tiên, nhờ phần lớn tokens được đọc từ cache.

---

## 2. Điều kiện cache hit

- Prefix **phải giống byte-for-byte** — nếu sửa 1 chữ ở giữa (ví dụ update memory) → prefix thay đổi → toàn bộ phải re-process → cache miss toàn bộ
- **Minimum token threshold** — prompt phải đủ dài mới cache được:
  - Haiku: 1,024 tokens
  - Sonnet / Opus: 2,048 tokens
  - Prompt ngắn hơn threshold → không cache, xử lý bình thường

---

## 3. Parameter nào được cache?

Prompt caching áp dụng cho các block content trong 3 parameter:

| Parameter | Cache được? | Ghi chú |
|---|---|---|
| `system` | ✓ | Thường là block lớn nhất (system prompt, identity, rules) |
| `tools` | ✓ | Tool definitions — JSON schema các tool |
| `messages` | ✓ | Lịch sử conversation (growing prefix) |
| Tool output (tool_result) | ✓ | Kết quả trả về từ tool call — có thể cache được |

**Với Hermes:** system prompt + tool definitions + skill index chiếm rất nhiều tokens ở đầu request → đây là phần được cache, các turn tiếp theo chỉ phải "đọc cache" thay vì xử lý lại.

---

## 4. Giá token — Phân biệt Read vs Write

| Loại | Hệ số giá | Ý nghĩa |
|---|---|---|
| **Cache Write** (5-min TTL) | **1.25x** base input | Lần đầu tạo cache — đắt hơn 25% |
| **Cache Read** | **0.1x** base input | Đọc từ cache — **rẻ gấp 10 lần** input thường |
| **Cache Write** (1-hour TTL) | **2x** base input | Cache dài hạn — đắt gấp đôi |

### Ví dụ với Claude Opus (input: $15 / MTok)

| Loại token | Giá thực tế |
|---|---|
| Input thường (không cache) | $15.00 / MTok |
| Cache Write (5min) | $18.75 / MTok |
| Cache Read | $1.50 / MTok |
| **Tiết kiệm khi cache hit** | **90%** |

### Ví dụ với Claude Sonnet (input: $3 / MTok)

| Loại token | Giá thực tế |
|---|---|
| Input thường | $3.00 / MTok |
| Cache Write (5min) | $3.75 / MTok |
| Cache Read | $0.30 / MTok |
| **Tiết kiệm khi cache hit** | **90%** |

---

## 5. Hai cách bật caching

### 5.1. Automatic caching (khuyến nghị)

Đặt `cache_control` ở top level của request:

```json
{
  "model": "claude-opus-5",
  "max_tokens": 1024,
  "cache_control": {"type": "ephemeral"},
  "system": "...",
  "tools": [...],
  "messages": [...]
}
```

- Hệ thống tự áp dụng cache breakpoint vào **block cacheable cuối cùng** và di chuyển nó về phía trước khi conversation phát triển
- Phù hợp cho multi-turn conversation — history growing tự động được cache

### 5.2. Explicit cache breakpoints

Gắn `cache_control` trực tiếp trên từng content block:

```json
{
  "system": [
    {
      "type": "text",
      "text": "...",
      "cache_control": {"type": "ephemeral"}
    }
  ]
}
```

- Kiểm soát chính xác block nào được cache
- Phù hợp khi cần cache block cụ thể (ví dụ: system prompt lớn + tool definitions)

---

## 6. TTL (Time-to-Live)

| TTL | Phù hợp khi |
|---|---|
| **5 phút** | Multi-turn conversation ngắn, chat session |
| **1 giờ** | Session dài (vapor agents, IDE integration), background tasks |

Hermes sử dụng default (5 phút) cho các conversation CLI.

---

## 7. Kiểm tra cache status

Trong response, Anthropic trả về các field usage:

```json
{
  "usage": {
    "input_tokens": 100,
    "output_tokens": 50,
    "cache_creation_input_tokens": 20000,
    "cache_read_input_tokens": 15000
  }
}
```

| Field | Ý nghĩa |
|---|---|
| `cache_creation_input_tokens` | Số tokens mới được cache trong request này (write) |
| `cache_read_input_tokens` | Số tokens đọc từ cache (hit) |
| `input_tokens` | Tokens không cache (process thường) |
| Cả hai = 0 | Prompt quá ngắn, không đủ threshold để cache |

---

## 8. Áp dụng thực tế với Hermes Agent

### Thành phần chính trong mỗi request Hermes

| Component | Ước lượng tokens | Cache behavior |
|---|---|---|
| System prompt (memory, identity, rules) | ~5,000-8,000 | Luôn cache (prefix cố định) |
| Tool definitions (JSON schema) | ~14,000-15,000 | Cache (không thay đổi giữa turns) |
| Skill index (danh sách skill) | ~2,000-3,000 | Cache |
| Conversation history | Phát triển theo thời gian | Cache prefix growing |
| Tool output (file, search...) | Rất lớn | Có thể cache nếu có `cache_control` |

### Chi phí mô phỏng (Claude Sonnet, 150K context)

| Turn | Tokens process (write) | Tokens read cache | Chi phí ước tính |
|---|---|---|---|
| Turn 1 | ~25,000 | 0 | 25K × $3.75 = **$0.094** |
| Turn 2 | ~5,000 | ~25,000 | 5K × $3.75 + 25K × $0.30 = **$0.094** |
| Turn 3 | ~8,000 | ~28,000 | 8K × $3.75 + 28K × $0.30 = **$0.038** |

→ **Turn 1 đắt, turn 2+ rẻ hơn nhiều** nhờ cache hit trên prefix cố định.

### Cách tối ưu cache trong Hermes

1. **Không thay đổi system prompt mid-conversation** — sửa system prompt = phá vỡ prefix = cache miss toàn bộ
2. **Không thay đổi toolset mid-conversation** — bật/tắt tool = thay đổi tool definitions = cache miss
3. **Giữ memory compact** — memory nằm trong system prompt, memory thay đổi = prefix thay đổi
4. **Cân nhắc tắt toolset không dùng** — mỗi toolset thêm ~500-3,000 tokens vào cache write
5. **Micro-compact** có thể pruned tool output trước khi turn tiếp → giảm tokens cần cache

---

## 9. Hard Invariant từ Hermes

> **"Never break prompt caching — don't change past context, toolsets, or the system prompt mid-conversation. The only exception is context compression."**

Violation ví dụ:
- Sửa memory mid-session → system prompt thay đổi → cache miss
- Bật/tắt tool mid-session → tool definitions thay đổi → cache miss
- Thêm/xóa skill mid-session → skill index thay đổi → cache miss

---

## 10. So sánh với các provider khác

| Provider | Prompt caching | Hệ số read | Hệ số write |
|---|---|---|---|
| **Anthropic (Claude)** | ✓ Automatic + Explicit | 0.1x | 1.25x (5min) / 2x (1hr) |
| **OpenAI** | ✓ Automatic (10K+ tokens) | 0.5x | 1.25x |
| **Google (Gemini)** | ✓ Context caching (API) | 0.25x | Giá full |

Anthropic có hệ số cache read **rẻ nhất** (0.1x) → tiết kiệm nhất khi cache hit.

---

## 11. Context Window — Input + Output

> Nguồn: https://platform.claude.com/docs/en/build-with-claude/context-windows

### 11.1. Định nghĩa

**Context window** là toàn bộ văn bản mà model có thể tham khảo khi tạo response, **bao gồm cả chính response đó**. Đây là "bộ nhớ làm việc" (working memory) của model, khác với dữ liệu training.

> *"The context window refers to all the text a language model can reference when generating a response, including the response itself."*
> — Anthropic Docs

### 11.2. Cấu trúc Context Window

```
┌─────────────────────── Context Window ──────────────────────┐
│                                                              │
│   INPUT tokens                          │  OUTPUT tokens     │
│   (nhận vào)                             │  (tạo ra)          │
│                                          │                    │
│  ┌────────────────────────────────────┐  │  ┌──────────────┐  │
│  │ 1. System prompt                   │  │  │              │  │
│  │ 2. Tool definitions                │  │  │  Response    │  │
│  │ 3. Conversation history            │  │  │  (text,      │  │
│  │ 4. Message mới nhất (user)         │  │  │   tool calls) │  │
│  └────────────────────────────────────┘  │  └──────────────┘  │
│                                          │                    │
│   ≤ context_length                      │  ≤ max_tokens      │
└──────────────────────────────────────────┴────────────────────┘
```

Tổng input + output **không được vượt** context window size.

### 11.3. Context Window theo model

| Model | Context Window | Input tối đa | Output tối đa | Ghi chú |
|---|---|---|---|---|
| Claude Opus 4 / 4.6 | 200K | ~168K | ~32K | Flagship, reasoning mạnh |
| Claude Sonnet 4 | 200K | ~168K | ~32K | Balance cost/performance |
| Claude Haiku 3.5 | 200K | ~180K | ~20K | Nhanh, rẻ, output nhỏ hơn |

**Lưu ý:** Các con số "tối đa" ở trên là ước lượng — Anthropic không công bố chính xác input limit, chỉ nói tổng ≤ 200K. Output tối đa phụ thuộc vào `max_tokens` parameter.

### 11.4. Progressive Token Accumulation

Trong multi-turn conversation, context window tích lũy dần:

```
Turn 1: [system + tools + msg1] + [response1]
         ────────────────────────────────────
         Tổng = input1 + output1

Turn 2: [system + tools + msg1 + response1 + msg2] + [response2]
         ─────────────────────────────────────────────────────────
         Tổng = input2 (lớn hơn) + output2

Turn 3: [system + tools + msg1 + resp1 + msg2 + resp2 + msg3] + [response3]
         ──────────────────────────────────────────────────────────────────────
         Tổng = input3 (lớn hơn nữa) + output3

...

Turn N: [system + tools + ... toàn bộ history ... + msgN] + [responseN]
         ─────────────────────────────────────────────────────────────────
         Khi total approach context_length → CẦN COMPACT
```

**Điều này có nghĩa:** Càng nhiều turns → input tokens càng lớn → càng gần ngưỡng context window → phải compact để tránh vượt.

### 11.5. Context Rot — Khi nào context quá dài

Anthropic cảnh báo về **"context rot"** — khi token count tăng, accuracy và recall bị giảm dần:

- Context ngắn → model tập trung vào nội dung quan trọng
- Context dài → model phải xử lý nhiều thông tin hơn → một số chi tiết bị "quên" hoặc giảm độ chính xác

→ **Curating (lọc, tóm tắt) context quan trọng bằng cách tăng context length.**

### 11.6. Ảnh hưởng đến Prompt Caching

Prompt cache hoạt động trên **input tokens** — cache prefix của system + tools + history. Output tokens **không được cache** (vì chúng là kết quả của model, thay đổi mỗi turn).

| Thành phần | Cache? | Token type |
|---|---|---|
| System prompt | ✓ | Input |
| Tool definitions | ✓ | Input |
| Conversation history | ✓ (prefix growing) | Input |
| User message mới | ✓ (nếu là prefix) | Input |
| Model response | ✗ | Output |
| Tool output | Có thể (nếu có `cache_control`) | Input |

→ **Output tokens luôn tính full giá** (không cache), chỉ input tokens mới được hưởng cache discount.

### 11.7. Ảnh hưởng đến Compression (Auto-compact)

Hermes `compression.threshold` kiểm tra **input tokens** so với `context_length`:

```
compression.threshold = 0.8
context_length = 200,000

Auto-compact trigger khi: input_tokens >= 200,000 × 0.8 = 160,000 tokens
Sau compact: input_tokens ≈ 200,000 × 0.2 = 40,000 tokens (target_ratio)
```

**Lưu ý:** Compression chỉ tóm tắt lại input context. Output tokens không bị ảnh hưởng — model vẫn có thể generate response dài bất kể đã compact.

### 11.8. Practical Tips

1. **Monitor input tokens** — đây là phần cần quản lý, output tokens ít ảnh hưởng đến context window
2. **Compact sớm hơn** —Giảm threshold (ví dụ 0.7) thay vì chờ 0.8 → tránh context rot ngoài ý muốn
3. **Tắt toolset không dùng** — mỗi toolset giảm ~500-3,000 tokens input
4. **Giữ memory compact** — memory nằm trong system prompt, memory dài = input tokens lớn
5. **Không load skill không cần** — mỗi skill load thêm tokens vào context
6. **Khi cần context dài** — cân nhắc increase context_length (nếu model hỗ trợ) thay vì giữ nguyên và compact quá sớm


---

## 12. Context Compression & Coding — Ảnh hưởng khi đang code

Khi agent đang viết code mà context quá dài → Hermes tự compact (compression). Câu hỏi: code có bị ảnh hưởng không?

### 12.1. Code đã ghi ra file → KHÔNG BỊ ĐỤNG

Compression chỉ tóm tắt **nội dung conversation trong context memory** — nó KHÔNG undo, KHÔNG sửa, KHÔNG xóa bất kỳ file nào đã được `write_file` / `patch` / `terminal` ghi lên disk. Code vẫn nguyên vẹn 100%.

```
Compression:
  ✗ Code trên disk         → KHÔNG ĐỤNG
  ✓ Context conversation   → BỊ TÓM TẮT
  ✓ Agent memory           → BỊ GIẢM
```

### 12.2. Agent bị "mất trí nhớ" — Đây là ảnh hưởng chính

Sau compression, agent mất chi tiết về những gì nó vừa làm:

```
Trước compact:
  Agent nhớ: "Ta vừa tạo EmbeddingService ở src/modules/news-fire-crawl-manager/
              services/embedding.service.ts, dùng text-embedding-3-small,
              function createEmbedding(), đã test OK, đã patch 3 files..."

Sau compact (summary):
  Agent nhớ: "Đã tạo EmbeddingService cho module news-fire-crawl-manager.
              Đang triển khai content dedup."
  → MẤT: tên function cụ thể, tham số, test cases, 3 files đã patch...
```

### 12.3. Hậu quả cụ thể khi đang code

| Tình huống | Trước compact | Sau compact |
|---|---|---|
| Vừa tạo file mới | Nhớ đường dẫn, nội dung | Phải đọc lại file để biết mình viết gì |
| Vừa fix bug | Nhớ root cause + fix | Có thể re-introduce bug nếu không verify |
| Đang viết batch nhiều files | Nhớ files đã patch | Có thể patch lại file đã patch → duplicate work |
| Test đang viết dở | Nhớ test cases | Có thể viết lại test trùng hoặc thiếu |
| Đang implement theo design doc | Nhớ đã implement đến đâu | Mất progress, cần check lại |

### 12.4. Hermes có mitigations

Config compression hiện tại:

```yaml
compression:
  protect_last_n: 20    # Giữ nguyên 20 message cuối
  protect_first_n: 3    # Giữ nguyên 3 message đầu (identity/rules)
  target_ratio: 0.2     # Sau compact giữ lại 20% context
```

- **20 message cuối** được giữ nguyên → agent vẫn nhớ context gần nhất (đang làm gì, vừa xong gì)
- **3 message đầu** giữ nguyên → identity/rules không mất
- **Summary** sẽ chứa key decisions và file paths quan trọng từ phần bị compact

### 12.5. Practical tips để giảm ảnh hưởng khi coding

1. **Checkpoint thường xuyên** — sau khi hoàn thành 1 bước quan trọng (tạo file, fix bug, merge), agent nên confirm status. Điều này giúp summary từ compact đầy đủ hơn.

2. **Re-read files sau compact** — agent nên gọi `read_file` lại các file đang thao tác sau khi compact xảy ra để re-establish context.

3. **Dùng todo list** — ghi progress vào `todo` tool, vì todo state có thể được preserve trong summary.

4. **Tránh session quá dài** — thay vì 1 session code cả ngày, chia thành nhiều session nhỏ.

5. **Lower threshold nếu cần** — nếu thấy compact xảy ra quá sớm hoặc quá muễm, điều chỉnh `compression.threshold`.

6. **Khi delegate coder-agent** — coder child có timeout riêng (`max_turns: 150`), thường hoàn thành trước khi cần compact. Nếu task quá dài → chia thành nhiều subtask.

7. **Sau compact, re-establish context** — đọc lại files liên quan, check todo list, verify git status trước khi tiếp tục code.

### 12.6. Tóm tắt

Compression là **necessary evil** — cần thiết để tránh vượt context window, nhưng đi kèm là agent mất chi tiết.

Đối với coding workflow:
- **Code trên disk an toàn** — không bị mất
- **Agent memory bị giảm** — cần re-establish context sau compact
- **Cách tốt nhất**: chia task nhỏ hơn + checkpoint thường xuyên + re-read files sau compact
