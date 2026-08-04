import * as crypto from 'crypto';

/**
 * Sinh urlHash SHA-256 (64 hex chars) cho một URL.
 *
 * Dùng chung cho cả RawArticle và NewsArticle để đảm bảo 2 collection
 * đồng bộ thuật toán hash (DRY). Trước đây RawArticle dùng MD5 (32 hex chars)
 * dễ gây trùng lặp khi collision — đã thống nhất sang SHA-256 khớp NewsArticle.
 *
 * @param url - URL gốc của bài viết (bắt buộc, không rỗng).
 * @returns chuỗi hex 64 ký tự đại diện SHA-256 của url.
 */
export function generateUrlHash(url: string): string {
  if (!url || url.trim().length === 0) {
    throw new Error('URL không được rỗng khi sinh urlHash');
  }
  return crypto.createHash('sha256').update(url).digest('hex');
}
