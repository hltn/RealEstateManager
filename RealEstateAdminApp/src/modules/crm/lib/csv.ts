/**
 * CSV thuần (không thư viện ngoài) cho nhập/xuất khách (X8).
 * - Xuất: UTF-8 CÓ BOM để Excel mở đúng tiếng Việt; trường chứa dấu phẩy/ngoặc kép/xuống dòng được bọc "..." (RFC 4180).
 * - Nhập: tự nhận dấu phân cách `,` hoặc `;` (Excel tiếng Việt hay xuất `;`), bỏ BOM, hỗ trợ ô có xuống dòng trong ngoặc kép.
 * Không dùng gói `xlsx` trên npm (bản npm cũ có lỗ hổng) — file .xlsx cần chuyển sang CSV trước khi nhập.
 */

export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Ô bắt đầu bằng = + - @ tab CR LF bị Excel hiểu là công thức (CSV injection) -> thêm tiền tố nháy đơn. */
const FORMULA_TRIGGER = /^[=+\-@\t\r\n]/;

/** Nhập lại: bỏ đúng 1 nháy đơn do `toCsv` thêm (chỉ khi ký tự kế tiếp là ký tự công thức). */
const unescapeFormula = (value: string): string => (value.startsWith("'") && FORMULA_TRIGGER.test(value.slice(1)) ? value.slice(1) : value);

const escapeCell = (raw: string): string => {
  const value = FORMULA_TRIGGER.test(raw) ? `'${raw}` : raw;
  return /[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

/** Mảng hàng -> nội dung CSV (có BOM, xuống dòng CRLF như Excel). */
export const toCsv = (rows: readonly (readonly string[])[]): string => UTF8_BOM + rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');

/** Đoán dấu phân cách theo dòng đầu (ngoài ngoặc kép). */
const detectDelimiter = (text: string): ',' | ';' => {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let commas = 0;
  let semicolons = 0;
  let isQuoted = false;
  for (const char of firstLine) {
    if (char === '"') isQuoted = !isQuoted;
    else if (!isQuoted && char === ',') commas += 1;
    else if (!isQuoted && char === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
};

/**
 * Phân tích CSV -> mảng hàng (mảng ô đã trim). Bỏ dòng trống hoàn toàn.
 * Duyệt từng ký tự theo trạng thái "trong ngoặc kép" để xử lý đúng `""` và xuống dòng trong ô.
 */
export const parseCsv = (input: string): string[][] => {
  const text = input.startsWith(UTF8_BOM) ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let isQuoted = false;
  let wasQuoted = false;

  const pushCell = () => {
    row.push(unescapeFormula(wasQuoted ? cell : cell.trim()));
    cell = '';
    wasQuoted = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (isQuoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        isQuoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      isQuoted = true;
      wasQuoted = true;
    } else if (char === delimiter) pushCell();
    else if (char === '\n') pushRow();
    else if (char !== '\r') cell += char;
  }
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
};

/** Tải nội dung CSV xuống máy người dùng (tên file an toàn). */
export const downloadCsv = (fileName: string, content: string): void => {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.replace(/[^\w.-]+/g, '_');
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Thu hồi sau một tick để trình duyệt kịp bắt đầu tải.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
