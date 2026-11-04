import type { Db } from 'mongodb';
import { generateUrlHash } from '../../common/utils/url-hash.util';
import type { BaselineProbe, ProbeResult } from './probe.types';

export const PROBE_002_ID = '002_recompute_urlhash_sha256';

const ARTICLE_COLLECTIONS = ['raw_articles', 'news_articles'] as const;
const SCAN_BATCH_SIZE = 500;

/**
 * Trần quét: vượt trần thì probe KHÔNG ĐẠT với lý do "không xác minh được" (dừng mã 4, không bỏ qua âm thầm) để người
 * vận hành kiểm tay. Số doc tính TRÊN MỖI collection (tập hash được giải phóng giữa hai collection); thời gian tính
 * cho cả probe. Với ~70 byte/mục trong tập hash, 1.000.000 doc xấp xỉ 70 MB.
 */
export const PROBE_002_MAX_DOCS_PER_COLLECTION = 1_000_000;
export const PROBE_002_MAX_DURATION_MS = 5 * 60 * 1000;

export interface Probe002Limits {
  maxDocsPerCollection: number;
  maxDurationMs: number;
}

interface ScanCounts {
  scanned: number;
  mismatched: number;
  duplicateUrls: number;
  missingUrl: number;
  /** Lý do dừng sớm vì chạm trần; `null` nếu quét hết. */
  abortedBy: 'docs' | 'time' | null;
}

/**
 * Khóa gọn để phát hiện trùng: 16 byte đầu của SHA-256 (128 bit, xác suất va chạm bỏ qua được) dạng chuỗi latin1 phẳng
 * 16 ký tự, thay vì giữ chuỗi hex 64 ký tự (chuỗi cắt từ hex gốc còn giữ nguyên chuỗi cha trong bộ nhớ).
 */
const compactHashKey = (hexHash: string): string =>
  Buffer.from(hexHash, 'hex').toString('latin1', 0, 16);

/**
 * Quét một collection bài viết bằng cursor (projection `url`, `urlHash`; băm trong bộ nhớ): đếm doc có `urlHash`
 * khác SHA-256 của url (MD5 cũ hoặc thiếu) và số url trùng nhau. Doc thiếu url chỉ đếm, không chặn (script 002 gốc cũng
 * bỏ qua). Dừng sớm (`abortedBy`) khi chạm trần số doc hoặc thời gian.
 */
const scanCollection = async (
  db: Db,
  name: string,
  limits: Probe002Limits,
  deadline: number,
  now: () => number,
): Promise<ScanCounts> => {
  const counts: ScanCounts = {
    scanned: 0,
    mismatched: 0,
    duplicateUrls: 0,
    missingUrl: 0,
    abortedBy: null,
  };
  const seenKeys = new Set<string>();
  const cursor = db
    .collection<{ url?: unknown; urlHash?: unknown }>(name)
    .find({}, { projection: { _id: 0, url: 1, urlHash: 1 } })
    .batchSize(SCAN_BATCH_SIZE);
  try {
    for await (const doc of cursor) {
      if (counts.scanned >= limits.maxDocsPerCollection) {
        counts.abortedBy = 'docs';
        break;
      }
      if (now() > deadline) {
        counts.abortedBy = 'time';
        break;
      }
      counts.scanned += 1;
      if (typeof doc.url !== 'string' || doc.url.trim().length === 0) {
        counts.missingUrl += 1;
        continue;
      }
      const expected = generateUrlHash(doc.url);
      if (doc.urlHash !== expected) counts.mismatched += 1;
      const key = compactHashKey(expected);
      if (seenKeys.has(key)) counts.duplicateUrls += 1;
      seenKeys.add(key);
    }
  } finally {
    await cursor.close();
  }
  return counts;
};

/**
 * Probe 002: `raw_articles` và `news_articles` đã rehash SHA-256 và không còn url trùng. Collection chưa tồn tại
 * hoặc rỗng = đạt (không có gì để rehash). Chạm trần quét => KHÔNG ĐẠT ("không xác minh được").
 */
export const createProbe002UrlHash = (
  limits: Probe002Limits = {
    maxDocsPerCollection: PROBE_002_MAX_DOCS_PER_COLLECTION,
    maxDurationMs: PROBE_002_MAX_DURATION_MS,
  },
  /** Đồng hồ (ms) — chỉ test thay thế để chứng minh đơn vị của trần thời gian. */
  now: () => number = Date.now,
): BaselineProbe => ({
  id: PROBE_002_ID,
  run: async (db: Db): Promise<ProbeResult> => {
    const counts: Record<string, number> = {};
    const warnings: string[] = [];
    const deadline = now() + limits.maxDurationMs;
    let passed = true;
    let reason: string | undefined;
    for (const name of ARTICLE_COLLECTIONS) {
      const scan = await scanCollection(db, name, limits, deadline, now);
      counts[`${name}_scanned`] = scan.scanned;
      counts[`${name}_hashMismatch`] = scan.mismatched;
      counts[`${name}_duplicateUrls`] = scan.duplicateUrls;
      counts[`${name}_missingUrl`] = scan.missingUrl;
      if (scan.mismatched > 0 || scan.duplicateUrls > 0) passed = false;
      if (scan.missingUrl > 0) {
        warnings.push(`${name}: ${scan.missingUrl} doc thiếu url (bỏ qua).`);
      }
      if (scan.abortedBy) {
        passed = false;
        counts.unverifiable = 1;
        reason ??= `không xác minh được: ${name} vượt trần quét (${
          scan.abortedBy === 'docs'
            ? `${limits.maxDocsPerCollection} doc/collection`
            : `${limits.maxDurationMs} ms`
        }); kiểm tay bằng dry-run script 002 rồi dùng baseline thủ công.`;
        break;
      }
    }
    return { id: PROBE_002_ID, passed, counts, warnings, reason };
  },
});

export const probe002UrlHash: BaselineProbe = createProbe002UrlHash();
