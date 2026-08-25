import { PrismaService } from '../../../database/prisma.service';
import { PodTemplateService } from './pod-template.service';

/**
 * Quy tắc thuần của SKU Generator — sinh tổ hợp, so trục, chuẩn hoá.
 *
 * Không chạm database: đây là phần logic quyết định "bấm Tạo SKU thì ra bao nhiêu dòng, tên
 * gì" và "trục có thật sự đổi không" — hai câu hỏi mà cả màn hình lẫn engine đều dựa vào.
 */
describe('PodTemplateService — SKU Generator', () => {
  const service = new PodTemplateService({} as PrismaService);
  // Các hàm dưới là `private` theo thiết kế; test gọi qua chỉ mục để không phải nới quyền
  // truy cập chỉ vì mục đích kiểm thử.
  const call = service as unknown as {
    normalizeVariants: (variants: unknown) => Array<{ name: string; values: unknown[] }>;
    buildCombinations: (variants: unknown) => Array<{ variantName: string; skuCode: string }>;
    sameAxes: (current: unknown, next: unknown) => boolean;
  };

  const axes = [
    { name: 'Color', values: [{ value: 'Black' }, { value: 'White' }, { value: 'Red' }] },
    { name: 'Size', values: [{ value: 'S' }, { value: 'M' }] },
  ];

  describe('sinh tổ hợp', () => {
    it('nhân đủ mọi tổ hợp theo đúng thứ tự trục', () => {
      const combos = call.buildCombinations(call.normalizeVariants(axes));

      expect(combos).toHaveLength(6);
      expect(combos.map((combo) => combo.variantName)).toEqual([
        'Black / S',
        'Black / M',
        'White / S',
        'White / M',
        'Red / S',
        'Red / M',
      ]);
    });

    it('mã SKU ghép từ mã rút gọn của từng giá trị', () => {
      const combos = call.buildCombinations(call.normalizeVariants(axes));
      expect(combos[0].skuCode).toBe('BLACK-S');
    });

    it('một trục cũng sinh được (không bắt buộc phải hai trục)', () => {
      const combos = call.buildCombinations(
        call.normalizeVariants([{ name: 'Size', values: [{ value: '8x12' }, { value: '12x18' }] }]),
      );
      expect(combos.map((combo) => combo.variantName)).toEqual(['8x12', '12x18']);
    });
  });

  describe('validation — chặn ngay, không im lặng bỏ qua', () => {
    it('không có trục nào ⇒ lỗi', () => {
      expect(() => call.normalizeVariants([])).toThrow(/ít nhất một trục/i);
    });

    it('trục trùng tên (không phân biệt hoa thường) ⇒ lỗi', () => {
      expect(() =>
        call.normalizeVariants([
          { name: 'Color', values: [{ value: 'Black' }] },
          { name: 'COLOR', values: [{ value: 'White' }] },
        ]),
      ).toThrow(/hai lần/i);
    });

    it('tên trục rỗng ⇒ lỗi', () => {
      expect(() =>
        call.normalizeVariants([{ name: '   ', values: [{ value: 'Black' }] }]),
      ).toThrow(/chưa có tên/i);
    });

    it('trục không có giá trị nào ⇒ lỗi', () => {
      expect(() => call.normalizeVariants([{ name: 'Color', values: [] }])).toThrow(
        /chưa có giá trị/i,
      );
    });

    it('giá trị trùng trong cùng một trục ⇒ lỗi', () => {
      expect(() =>
        call.normalizeVariants([
          { name: 'Color', values: [{ value: 'Black' }, { value: ' black ' }] },
        ]),
      ).toThrow(/lặp lại/i);
    });

    it('giá trị rỗng ⇒ lỗi', () => {
      expect(() =>
        call.normalizeVariants([{ name: 'Color', values: [{ value: 'Black' }, { value: '  ' }] }]),
      ).toThrow(/để trống/i);
    });
  });

  describe('so trục — quyết định có cảnh báo "cần tạo lại SKU" hay không', () => {
    const saved = [
      { name: 'Color', values: [{ value: 'Black', code: 'BLACK' }, { value: 'White', code: 'WHITE' }] },
    ];

    it('trục y hệt ⇒ không đổi', () => {
      const next = call.normalizeVariants([
        { name: 'Color', values: [{ value: 'Black' }, { value: 'White' }] },
      ]);
      expect(call.sameAxes(saved, next)).toBe(true);
    });

    it('thêm một giá trị ⇒ có đổi', () => {
      const next = call.normalizeVariants([
        { name: 'Color', values: [{ value: 'Black' }, { value: 'White' }, { value: 'Red' }] },
      ]);
      expect(call.sameAxes(saved, next)).toBe(false);
    });

    it('đổi tên trục ⇒ có đổi', () => {
      const next = call.normalizeVariants([
        { name: 'Colour', values: [{ value: 'Black' }, { value: 'White' }] },
      ]);
      expect(call.sameAxes(saved, next)).toBe(false);
    });

    it('đảo thứ tự giá trị ⇒ có đổi (thứ tự quyết định thứ tự SKU sinh ra)', () => {
      const next = call.normalizeVariants([
        { name: 'Color', values: [{ value: 'White' }, { value: 'Black' }] },
      ]);
      expect(call.sameAxes(saved, next)).toBe(false);
    });
  });
});
