import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv, UTF8_BOM } from './csv';

describe('toCsv', () => {
  it('có BOM, bọc ô chứa dấu phẩy/ngoặc kép', () => {
    expect(toCsv([['a,b', 'x"y']])).toBe(`${UTF8_BOM}"a,b","x""y"`);
  });

  it.each([['=HYPERLINK("http://x")'], ['+SUM(A1)'], ['-2+3'], ['@cmd'], ['\tTAB'], ['\rCR']])(
    'N2 hồi quy: chặn formula injection %j bằng tiền tố nháy đơn',
    (value) => {
      const raw = toCsv([[value]]).slice(1); // bỏ BOM
      expect(raw.replace(/^"/, '').startsWith("'")).toBe(true); // file thô có tiền tố nháy đơn
      expect(parseCsv(toCsv([[value]]))[0][0]).toBe(value); // nhập lại: bỏ tiền tố, khứ hồi nguyên vẹn
    },
  );

  it('ô bình thường giữ nguyên', () => {
    expect(toCsv([['Nguyễn Văn A', '0912 345 678']])).toBe(`${UTF8_BOM}Nguyễn Văn A,0912 345 678`);
  });
});

describe('parseCsv', () => {
  it('giữ khoảng trắng bên trong ô có ngoặc kép, trim ô không ngoặc', () => {
    expect(parseCsv('  a  ," b "\r\n')).toEqual([['a', ' b ']]);
  });
});
