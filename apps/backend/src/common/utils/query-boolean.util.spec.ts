import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toBool } from './query-boolean.util';

/**
 * Hồi quy cho TOÀN BỘ DTO nhận qua `@Query()`: quét controller để không phụ thuộc vào danh sách viết tay, nên DTO thêm sau
 * này cũng được kiểm. Chạy qua ĐÚNG cấu hình `ValidationPipe` của `main.ts`, vì lỗi chỉ xuất hiện khi có
 * `enableImplicitConversion`.
 */
const SRC = join(__dirname, '..', '..');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

const sources = filesUnder(SRC);
const queryClassNames = new Set(
  sources
    .filter((file) => file.endsWith('.controller.ts'))
    .flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/@Query\(\s*\)\s*\w+\??:\s*(\w+)/g)].map((match) => match[1]),
    ),
);

/** Lớp theo tên, chỉ nạp file có khai báo lớp đó. */
function loadQueryClasses(): Array<new () => object> {
  const classes: Array<new () => object> = [];
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    const declared = [...text.matchAll(/export class (\w+)/g)].map((match) => match[1]);
    const wanted = declared.filter((name) => queryClassNames.has(name));
    if (wanted.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(file) as Record<string, new () => object>;
    for (const name of wanted) classes.push(loaded[name]);
  }
  return classes;
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const queryClasses = loadQueryClasses();
const booleanFields = queryClasses.flatMap((target) =>
  getMetadataStorage()
    .getTargetValidationMetadatas(target, '', false, false)
    .filter((metadata) => metadata.name === 'isBoolean' || metadata.constraintCls?.name === 'IsBoolean')
    .map((metadata) => ({ target, field: metadata.propertyName })),
);
const cases = [...new Map(booleanFields.map((c) => [`${c.target.name}.${c.field}`, c])).entries()];

/** Validate MỘT field: lỗi của các field bắt buộc khác không liên quan tới phép kiểm này. */
async function parse(target: new () => object, field: string, raw?: string): Promise<unknown> {
  try {
    const dto = (await pipe.transform(raw === undefined ? {} : { [field]: raw }, {
      type: 'query',
      metatype: target,
    })) as Record<string, unknown>;
    return dto[field];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const messages = (error.getResponse() as { message: string[] }).message;
    const own = messages.filter((message) => message.startsWith(`${field} `) || message.includes(`${field} must`));
    if (own.length > 0) return 'REJECTED';
    // Chỉ các field bắt buộc khác hỏng: dựng lại bằng transform thuần để đọc đúng field này.
    const { plainToInstance } = await import('class-transformer');
    return (plainToInstance(target, raw === undefined ? {} : { [field]: raw }, { enableImplicitConversion: true }) as Record<string, unknown>)[field];
  }
}

describe('Boolean trên @Query DTO', () => {
  it('quét được các DTO đã biết', () => {
    const names = cases.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        'PodOrderQueryDto.pushedToFulfillment',
        'PodOrderQueryDto.hasDesign',
        'PodOrderQueryDto.hasPodItem',
        'PodTemplateQueryDto.activeOnly',
        'PodTemplateQueryDto.defaultOnly',
        'PodListingPayloadQueryDto.publishable',
        'PodProductQueryDto.includeInactive',
        'PodProductFilterOptionsQueryDto.activeShopsOnly',
        'PodDashboardSellerQueryDto.activeOnly',
        'BaseCostImportQueryDto.dryRun',
      ]),
    );
  });

  describe.each(cases)('%s', (_name, { target, field }) => {
    it('🔴 ?x=false là false', async () => {
      expect(await parse(target, field, 'false')).toBe(false);
    });
    it('?x=true là true', async () => {
      expect(await parse(target, field, 'true')).toBe(true);
    });
    it('giá trị khác ⇒ bị từ chối, không âm thầm thành true/false', async () => {
      expect(await parse(target, field, 'abc')).toBe('REJECTED');
    });
    it('không gửi ⇒ không thành true', async () => {
      expect(await parse(target, field)).not.toBe(true);
    });
  });
});

describe('toBool', () => {
  it('đọc giá trị gốc, không đọc giá trị đã bị đổi', () => {
    expect(toBool({ obj: { flag: 'false' }, key: 'flag', value: true })).toBe(false);
  });
  it('boolean JSON giữ nguyên (body)', () => {
    expect(toBool({ obj: { flag: false }, key: 'flag', value: false })).toBe(false);
    expect(toBool({ obj: { flag: true }, key: 'flag', value: true })).toBe(true);
  });
  it('chuỗi rỗng ⇒ coi như không gửi', () => {
    expect(toBool({ obj: { flag: '' }, key: 'flag', value: false })).toBeUndefined();
  });
  it('gọi trực tiếp chỉ có value', () => {
    expect(toBool({ value: 'false' })).toBe(false);
  });
});
