import type { Db } from 'mongodb';

/**
 * Kết quả một probe baseline. `counts` CHỈ chứa số đếm (không PII, không giá trị dữ liệu) vì nó được ghi vào sổ
 * `system` làm bằng chứng (`evidence`) và in ra log deploy.
 */
export interface ProbeResult {
  /** Id migration cũ mà probe này chứng minh "không còn việc" (002..006). */
  id: string;
  passed: boolean;
  counts: Record<string, number>;
  /** Cảnh báo không chặn (ví dụ thiếu index sẽ được autoIndex bù). Không ghi vào sổ. */
  warnings: string[];
  /** Lý do không đạt (tiếng Việt, không PII) khi `passed` = false và cần giải thích ngoài số đếm. */
  reason?: string;
}

/**
 * Probe CHỈ ĐỌC: kiểm dữ liệu hiện tại không còn việc cho migration cũ. Tuyệt đối không ghi (kể cả tạo
 * collection/index). Lỗi hạ tầng (mất kết nối...) cứ ném lên, không nuốt thành "passed".
 */
export interface BaselineProbe {
  id: string;
  run: (db: Db) => Promise<ProbeResult>;
}
