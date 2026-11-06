import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PodOrderQueryDto } from './pod-order-query.dto';

/**
 * Chạy qua ĐÚNG cấu hình `ValidationPipe` của `main.ts`. `enableImplicitConversion` đổi chuỗi "false" thành `true` trước
 * khi `@Transform` chạy, nên chip "Not sent to Fulfillment" từng trả về đúng những đơn ĐÃ gửi. Unit test của repository
 * không thấy được lỗi này vì nó nhận sẵn boolean.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const parse = (query: Record<string, string>): Promise<PodOrderQueryDto> =>
  pipe.transform(query, { type: 'query', metatype: PodOrderQueryDto }) as Promise<PodOrderQueryDto>;

describe.each(['pushedToFulfillment', 'hasDesign', 'hasPodItem'] as const)('PodOrderQueryDto.%s', (field) => {
  it('🔴 chuỗi "false" là false, không bị đảo thành true', async () => {
    expect((await parse({ [field]: 'false' }))[field]).toBe(false);
  });

  it('chuỗi "true" là true', async () => {
    expect((await parse({ [field]: 'true' }))[field]).toBe(true);
  });

  it('không gửi ⇒ không lọc', async () => {
    expect((await parse({}))[field]).toBeUndefined();
  });

  it('giá trị khác true/false ⇒ 400, không âm thầm thành true', async () => {
    await expect(parse({ [field]: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
