/**
 * CSV theo RFC 4180 — tự viết, KHÔNG dùng `exceljs.csv`.
 *
 * Vì sao không dùng ExcelJS cho CSV: nó tự "đoán kiểu" từng ô (`"00123"` → số 123, `"1-2"` → ngày),
 * làm hỏng mã SKU / tên template khi đọc lại. Ở đây mọi ô là CHUỖI; ép kiểu là việc của nơi gọi,
 * theo schema cột của nó.
 */

/** BOM UTF-8 — Excel trên Windows cần nó để đọc đúng tiếng Việt / Unicode. */
export const CSV_BOM = '﻿';

/** Một ô: bọc nháy kép khi có dấu phẩy, nháy kép, xuống dòng hoặc khoảng trắng đầu/cuối; nháy kép nhân đôi. */
export function csvCell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Dựng file CSV: BOM + dòng tiêu đề + dữ liệu, ngắt dòng CRLF (chuẩn RFC 4180). */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

export class CsvParseError extends Error {}

/**
 * Đọc CSV thành mảng dòng × ô (chuỗi thô).
 *
 * - Bỏ BOM đầu file; nhận cả CRLF, LF.
 * - Ô có nháy kép được chứa dấu phẩy / xuống dòng; `""` trong ô = một dấu nháy.
 * - Bỏ các dòng trống hoàn toàn (thường là dòng cuối file).
 * - Nháy kép không đóng ⇒ `CsvParseError` (file hỏng, không đoán).
 */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(CSV_BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;

  const endRow = () => {
    row.push(cell);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    cell = '';
  };

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += char;
      }
      index += 1;
      continue;
    }

    if (char === '"' && cell === '') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && text[index + 1] === '\n') {
      endRow();
      index += 1;
    } else if (char === '\n' || char === '\r') endRow();
    else cell += char;
    index += 1;
  }

  if (quoted) throw new CsvParseError('File CSV hỏng: có ô mở dấu nháy kép mà không đóng.');
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
