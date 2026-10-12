import {
  capLogPayload,
  FLASH_SALE_LOG_PAYLOAD_MAX_BYTES,
  summarizeActivity,
} from './pod-flash-sale-log-payload';

describe('capLogPayload — trần kích thước JSON của log Flash Sale', () => {
  it('payload nhỏ (log thao tác thật, ~5 KB) ⇒ giữ NGUYÊN', () => {
    const request = { products: Array.from({ length: 40 }, (_v, i) => ({ id: `P-${i}`, price: '9.99' })) };
    expect(capLogPayload(request)).toBe(request);
  });

  it('🔴 payload vượt trần ⇒ thay bằng mô tả có cấu trúc (kích thước gốc, khoá, đoạn đầu)', () => {
    const huge = { status: 'ONGOING', products: Array.from({ length: 2_000 }, (_v, i) => ({ id: `TT-P-${i}`, skus: [{ id: `S-${i}` }] })) };

    const capped = capLogPayload(huge) as Record<string, unknown>;

    expect(capped).toMatchObject({ truncated: true, maxBytes: FLASH_SALE_LOG_PAYLOAD_MAX_BYTES, topLevelKeys: ['status', 'products'] });
    expect(capped.originalBytes).toBeGreaterThan(FLASH_SALE_LOG_PAYLOAD_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(capped))).toBeLessThan(FLASH_SALE_LOG_PAYLOAD_MAX_BYTES);
  });

  it('undefined ⇒ undefined (không tạo trường JSON rỗng)', () => {
    expect(capLogPayload(undefined)).toBeUndefined();
  });
});

describe('summarizeActivity', () => {
  it('chỉ giữ trường trạng thái + số lượng, không chép danh sách sản phẩm', () => {
    const summary = summarizeActivity({
      activityId: 'A',
      status: 'ONGOING',
      products: [{ id: 'P1', skus: [{ id: 'S1' }, { id: 'S2' }] }, { id: 'P2' }],
    });

    expect(summary).toEqual({
      activityId: 'A',
      status: 'ONGOING',
      productLevel: null,
      beginTime: null,
      endTime: null,
      updateTime: null,
      activityCommands: [],
      productCount: 2,
      skuCount: 2,
    });
  });
});
