import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PodProductQueryDto } from './pod-product-query.dto';

/** `?status=` của `GET /pod/products` — nhận nhóm hệ thống, nhiều giá trị, và `ALL`. */
function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(PodProductQueryDto, query);
  return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
}

describe('PodProductQueryDto.status', () => {
  it('một giá trị ⇒ mảng một phần tử', () => {
    const { dto, errors } = parse({ status: 'REVIEWING' });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['REVIEWING']);
  });

  it('`status=ACTIVE,REVIEWING` ⇒ hai nhóm, chuẩn hoá chữ hoa + bỏ trùng', () => {
    const { dto, errors } = parse({ status: 'active, REVIEWING,ACTIVE' });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['ACTIVE', 'REVIEWING']);
  });

  it('`status=A&status=B` (lặp tham số) cũng được', () => {
    const { dto, errors } = parse({ status: ['DEACTIVATED', 'NEEDS_ATTENTION'] });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['DEACTIVATED', 'NEEDS_ATTENTION']);
  });

  it('`ALL` hợp lệ', () => {
    expect(parse({ status: 'ALL' }).errors).toHaveLength(0);
  });

  it('🔴 chuỗi TikTok thô (ACTIVATE) hoặc giá trị lạ ⇒ 400, không âm thầm bỏ qua', () => {
    expect(parse({ status: 'ACTIVATE' }).errors).not.toHaveLength(0);
    expect(parse({ status: 'ACTIVE,FOO' }).errors).not.toHaveLength(0);
  });

  it('chuỗi rỗng ⇒ lỗi (không được hiểu thành "không lọc")', () => {
    expect(parse({ status: ',' }).errors).not.toHaveLength(0);
  });
});
