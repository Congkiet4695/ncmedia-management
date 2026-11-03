import { CSV_BOM, CsvParseError, parseCsv, toCsv } from './csv.util';

describe('csv.util — RFC 4180', () => {
  it('Unicode, dấu phẩy, nháy kép, xuống dòng, ô rỗng: ghi rồi đọc lại y nguyên', () => {
    const header = ['name', 'note', 'json'];
    const rows = [
      ['Áo thun “Halloween”, size XL', 'dòng 1\r\ndòng 2\nhết', '[{"a":"x,y","b":"\\"q\\""}]'],
      ['', '  khoảng trắng đầu', '🎃 emoji & 中文'],
      ['00123', '1-2', '=SUM(A1)'],
    ];
    const csv = toCsv(header, rows);

    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(parseCsv(csv)).toEqual([header, ...rows]);
  });

  it('mọi ô là CHUỖI — không đoán kiểu (mã "00123" giữ nguyên số 0 đầu)', () => {
    expect(parseCsv('a,b\n00123,1-2\n')).toEqual([
      ['a', 'b'],
      ['00123', '1-2'],
    ]);
  });

  it('nhận LF lẫn CRLF, bỏ BOM, bỏ dòng trống cuối file', () => {
    expect(parseCsv(`${CSV_BOM}a,b\r\n1,2\n\n`)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('ô trống cuối dòng vẫn được giữ', () => {
    expect(parseCsv('a,b,c\n1,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });

  it('nháy kép không đóng ⇒ CsvParseError (không đoán)', () => {
    expect(() => parseCsv('a,b\n"1,2\n')).toThrow(CsvParseError);
  });
});
