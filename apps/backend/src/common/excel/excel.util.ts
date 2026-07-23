import ExcelJS from 'exceljs';

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

/** Sheet đã đọc: header + các dòng (map theo header) + số dòng Excel thật (để báo lỗi). */
export interface ParsedSheet {
  headers: string[];
  rows: Array<Record<string, string>>;
  /** rowNumbers[i] = số dòng Excel (1-based, header là 1) của rows[i]. */
  rowNumbers: number[];
}

const HEADER_FILL = 'FF2F5597';

/** Thêm 1 worksheet có header đậm + màu + freeze + auto width. */
export function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: ExcelColumn[],
  rows: Array<Record<string, unknown>>,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(12, c.header.length + 4),
  }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 20;

  for (const r of rows) ws.addRow(r);

  // Auto width theo nội dung (tiếng Việt UTF-8 an toàn).
  ws.columns.forEach((col) => {
    let max = col.header ? String(col.header).length : 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = cellToString(cell.value).length;
      if (len > max) max = len;
    });
    col.width = Math.min(60, Math.max(12, max + 2));
  });

  return ws;
}

/** Workbook → Buffer (.xlsx). */
export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data);
}

/** Buffer (.xlsx) → Workbook. */
export async function bufferToWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  return wb;
}

/** Stringify an toàn cho primitive (object → ''), tránh '[object Object]'. */
function prim(x: unknown): string {
  if (x === null || x === undefined) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean' || typeof x === 'bigint') return String(x);
  return '';
}

/** Chuyển giá trị cell (có thể là richtext/hyperlink/formula/date) về chuỗi trim. */
export function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('').trim();
    }
    if ('text' in o) return prim(o.text).trim();
    if ('result' in o) return prim(o.result).trim();
    if ('hyperlink' in o) return (prim(o.text) || prim(o.hyperlink)).trim();
    return '';
  }
  return prim(v).trim();
}

/** Đọc 1 worksheet → header + rows (bỏ dòng trống hoàn toàn). */
export function readSheet(ws: ExcelJS.Worksheet): ParsedSheet {
  const colToHeader: Record<number, string> = {};
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const h = cellToString(cell.value);
    if (h) {
      colToHeader[col] = h;
      headers.push(h);
    }
  });

  const rows: Array<Record<string, string>> = [];
  const rowNumbers: number[] = [];
  const lastRow = ws.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, string> = {};
    let hasAny = false;
    for (const [colStr, header] of Object.entries(colToHeader)) {
      const val = cellToString(row.getCell(Number(colStr)).value);
      obj[header] = val;
      if (val) hasAny = true;
    }
    if (hasAny) {
      rows.push(obj);
      rowNumbers.push(r);
    }
  }
  return { headers, rows, rowNumbers };
}

/** Kiểm tra header thiếu so với danh sách bắt buộc. Trả về danh sách cột thiếu. */
export function missingHeaders(actual: string[], required: string[]): string[] {
  const set = new Set(actual.map((h) => h.trim().toLowerCase()));
  return required.filter((h) => !set.has(h.trim().toLowerCase()));
}
