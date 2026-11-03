import { Prisma } from '@prisma/client';
import {
  PodProductCloneResolverService,
  type CloneSourceProduct,
} from './pod-product-clone-resolver.service';

/**
 * **Danh tính sản phẩm khi nhân bản** — "shop đích đã có sản phẩm này?" dựa trên NGUỒN GỐC đã lưu (payload clone /
 * Draft Product của Listing Session), KHÔNG dựa trên một Seller SKU trùng: POD dùng chung Seller SKU của phôi cho mọi
 * design, nên trùng Seller SKU với sản phẩm khác của shop đích là chuyện thường và không được bỏ qua oan
 * (lỗi thật: `CLONE_SKIPPED: Shop đã có sản phẩm mang cùng Seller SKU …`).
 */

type Where = Record<string, unknown>;

interface PayloadRow {
  shopId: string;
  tiktokProductId: string | null;
  productId: string | null;
  sessionProductId: string | null;
  listingTemplateId: string | null;
}

interface ProductRow {
  id: string;
  shopId: string;
  tiktokProductId: string;
  title: string | null;
  deactivatedAt?: Date | null;
  skus: string[];
}

function buildProduct(skus: string[] = ['HAL-S', 'HAL-M']): CloneSourceProduct {
  return {
    id: 'prod-1',
    organizationId: 'org-1',
    shopId: 'shop-src',
    tiktokProductId: 'TT-PRODUCT-SRC',
    title: 'Halloween Tee',
    description: '<p>Soft cotton</p>',
    status: 'ACTIVATE',
    deactivatedAt: null,
    tiktokBrandId: null,
    brandName: null,
    tiktokCategoryId: '600001',
    categoryName: 'T-Shirts',
    categoryPath: 'Apparel > Tops > T-Shirts',
    packageLength: '10',
    packageWidth: '8',
    packageHeight: '1',
    dimensionUnit: 'INCH',
    packageWeight: '0.5',
    weightUnit: 'POUND',
    searchTerms: [],
    keyProductFeatures: [],
    sizeChartUri: null,
    sizeChartUrl: null,
    sizeChartTemplateId: null,
    currency: 'USD',
    shop: { id: 'shop-src', name: 'Source Shop', region: 'US' },
    variants: skus.map((sellerSku, index) => ({
      id: `v-${index}`,
      tiktokSkuId: `TT-SKU-${index}`,
      sellerSku,
      variantName: sellerSku,
      salesAttributes: [],
      salePrice: new Prisma.Decimal('19.99'),
      listPrice: null,
      currency: 'USD',
      inventoryTotal: 1,
      imageUrl: null,
    })),
    images: [],
    videos: [],
    attributes: [],
  };
}

const inList = (value: unknown, cond: unknown): boolean =>
  cond !== null && typeof cond === 'object' && 'in' in cond
    ? (cond as { in: unknown[] }).in.includes(value)
    : value === cond;

function payloadMatches(row: PayloadRow, where: Where): boolean {
  const tiktokProductId = where.tiktokProductId;
  return (
    (where.shopId === undefined || row.shopId === where.shopId) &&
    (tiktokProductId === undefined ||
      (typeof tiktokProductId === 'object' ? row.tiktokProductId !== null : row.tiktokProductId === tiktokProductId)) &&
    (where.productId === undefined || inList(row.productId, where.productId)) &&
    (where.sessionProductId === undefined || inList(row.sessionProductId, where.sessionProductId)) &&
    (where.listingTemplateId === undefined || row.listingTemplateId === where.listingTemplateId) &&
    (!Array.isArray(where.OR) || (where.OR as Where[]).some((branch) => payloadMatches(row, branch)))
  );
}

function productMatches(row: ProductRow, where: Where): boolean {
  const title = where.title as { equals: string } | undefined;
  return (
    (where.id === undefined || inList(row.id, where.id)) &&
    (where.shopId === undefined || row.shopId === where.shopId) &&
    (where.deactivatedAt === undefined || !row.deactivatedAt) &&
    (title === undefined || (row.title ?? '').toLowerCase() === title.equals.toLowerCase())
  );
}

/** Prisma giả lập đủ các `where` mà `findSkipReason` dùng — dữ liệu khai bằng bảng nhỏ. */
function build(payloads: PayloadRow[], products: ProductRow[]) {
  const toProduct = (row: ProductRow) => ({
    shopId: row.shopId,
    tiktokProductId: row.tiktokProductId,
    title: row.title,
    variants: row.skus.map((sellerSku) => ({ sellerSku })),
  });
  const prisma = {
    podListingPayload: {
      findFirst: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(payloads.find((row) => payloadMatches(row, where)) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(payloads.filter((row) => payloadMatches(row, where))),
      ),
    },
    podProduct: {
      findFirst: jest.fn(({ where }: { where: Where }) => {
        const row = products.find((candidate) => productMatches(candidate, where));
        return Promise.resolve(row ? toProduct(row) : null);
      }),
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(products.filter((row) => productMatches(row, where)).map(toProduct)),
      ),
    },
    podListingJobItem: { findFirst: jest.fn(), findUnique: jest.fn() },
  };
  return { service: new PodProductCloneResolverService(prisma as never), prisma };
}

const payload = (overrides: Partial<PayloadRow>): PayloadRow => ({
  shopId: 'shop-x',
  tiktokProductId: null,
  productId: null,
  sessionProductId: null,
  listingTemplateId: null,
  ...overrides,
});

describe('PodProductCloneResolverService.findSkipReason — danh tính theo nguồn gốc, không theo Seller SKU', () => {
  it('🔴 CASE 8: shop đích có sản phẩm KHÁC (khác tiêu đề) dùng chung Seller SKU ⇒ KHÔNG bỏ qua — vẫn nhân bản', async () => {
    const { service } = build(
      [],
      [{ id: 'other', shopId: 'shop-b', tiktokProductId: 'TT-OTHER', title: 'Christmas Tee', skus: ['HAL-S', 'HAL-M'] }],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toBeNull();
  });

  it('cùng tiêu đề nhưng KHÁC bộ Seller SKU (chỉ trùng một phần) ⇒ không đủ dấu hiệu, không bỏ qua', async () => {
    const { service } = build(
      [],
      [{ id: 'other', shopId: 'shop-b', tiktokProductId: 'TT-OTHER', title: 'halloween tee', skus: ['HAL-S', 'HAL-L'] }],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toBeNull();
  });

  it('bản chép y hệt không qua hệ thống (cùng tiêu đề, cùng nguyên bộ Seller SKU) ⇒ ALREADY_EXISTS', async () => {
    const { service } = build(
      [],
      [{ id: 'copy', shopId: 'shop-b', tiktokProductId: 'TT-COPY', title: 'HALLOWEEN TEE', skus: ['HAL-M', 'HAL-S'] }],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toMatchObject({
      code: 'ALREADY_EXISTS',
      message: expect.stringContaining('TT-COPY') as unknown,
    });
  });

  it('bản chép y hệt nhưng đã ngừng bán ⇒ không tính (chỉ sản phẩm đang bán)', async () => {
    const { service } = build(
      [],
      [
        {
          id: 'copy',
          shopId: 'shop-b',
          tiktokProductId: 'TT-COPY',
          title: 'Halloween Tee',
          deactivatedAt: new Date(),
          skus: ['HAL-S', 'HAL-M'],
        },
      ],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toBeNull();
  });

  it('sản phẩm nguồn không có Seller SKU ⇒ không dùng dấu hiệu "bản chép y hệt"', async () => {
    const { service, prisma } = build(
      [],
      [{ id: 'copy', shopId: 'shop-b', tiktokProductId: 'TT-COPY', title: 'Halloween Tee', skus: [] }],
    );
    await expect(service.findSkipReason('org-1', buildProduct(['', '  ']), 'shop-b')).resolves.toBeNull();
    expect(prisma.podProduct.findMany).not.toHaveBeenCalled();
  });

  it('CASE 7: nguồn là bản sao của P, shop đích đã có bản sao khác của P ⇒ ALREADY_EXISTS (cùng sản phẩm gốc)', async () => {
    const { service } = build(
      [
        // Payload đã tạo ra sản phẩm nguồn: clone từ P.
        payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', productId: 'prod-p' }),
        // P cũng đã được nhân bản sang shop B.
        payload({ shopId: 'shop-b', tiktokProductId: 'TT-B-COPY', productId: 'prod-p' }),
      ],
      [{ id: 'prod-p', shopId: 'shop-c', tiktokProductId: 'TT-P', title: 'Halloween Tee', skus: ['HAL-S', 'HAL-M'] }],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toMatchObject({
      code: 'ALREADY_EXISTS',
      message: expect.stringContaining('TT-B-COPY') as unknown,
    });
    // Shop D chưa có gì của P ⇒ nhân bản bình thường.
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-d')).resolves.toBeNull();
  });

  it('nguồn là bản sao từ sản phẩm CỦA shop đích ⇒ ALREADY_EXISTS (không nhân bản ngược về)', async () => {
    const { service } = build(
      [payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', productId: 'prod-p' })],
      [{ id: 'prod-p', shopId: 'shop-b', tiktokProductId: 'TT-P', title: 'Renamed later', skus: ['X'] }],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toMatchObject({
      code: 'ALREADY_EXISTS',
      message: expect.stringContaining('TT-P') as unknown,
    });
  });

  it('lần ngược nhiều tầng: Q (shop B) → P (shop C) → nguồn (shop A) ⇒ nhân bản về shop B là trùng', async () => {
    const { service } = build(
      [
        payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', productId: 'prod-p' }),
        payload({ shopId: 'shop-c', tiktokProductId: 'TT-P', productId: 'prod-q' }),
      ],
      [
        { id: 'prod-p', shopId: 'shop-c', tiktokProductId: 'TT-P', title: 'P', skus: [] },
        { id: 'prod-q', shopId: 'shop-b', tiktokProductId: 'TT-Q', title: 'Q', skus: [] },
      ],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
  });

  it('dữ liệu vòng (P là bản sao của nguồn, nguồn là bản sao của P) ⇒ không lặp vô hạn', async () => {
    const { service } = build(
      [
        payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', productId: 'prod-p' }),
        payload({ shopId: 'shop-c', tiktokProductId: 'TT-P', productId: 'prod-1' }),
      ],
      [
        { id: 'prod-p', shopId: 'shop-c', tiktokProductId: 'TT-P', title: 'P', skus: [] },
        { id: 'prod-1', shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', title: 'Halloween Tee', skus: [] },
      ],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-d')).resolves.toBeNull();
  });

  it('cùng Draft Product của Listing Session đã đăng lên shop đích ⇒ ALREADY_EXISTS', async () => {
    const { service } = build(
      [
        payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', sessionProductId: 'sp-1', listingTemplateId: 'tpl-1' }),
        payload({ shopId: 'shop-b', tiktokProductId: 'TT-B-SESSION', sessionProductId: 'sp-1', listingTemplateId: 'tpl-1' }),
      ],
      [],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toMatchObject({
      code: 'ALREADY_EXISTS',
      message: expect.stringContaining('TT-B-SESSION') as unknown,
    });
  });

  it('Draft Product đó ở shop đích CHƯA đăng xong (không có tiktokProductId) ⇒ chưa có, không bỏ qua', async () => {
    const { service } = build(
      [
        payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', sessionProductId: 'sp-1', listingTemplateId: 'tpl-1' }),
        payload({ shopId: 'shop-b', tiktokProductId: null, sessionProductId: 'sp-1', listingTemplateId: 'tpl-1' }),
      ],
      [],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toBeNull();
  });

  it('payload TEMPLATE dùng sản phẩm khác làm nguồn nội dung KHÔNG phải quan hệ bản sao', async () => {
    const { service } = build(
      [
        payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', productId: 'prod-p', listingTemplateId: 'tpl-1' }),
        payload({ shopId: 'shop-b', tiktokProductId: 'TT-B', productId: 'prod-p', listingTemplateId: 'tpl-2' }),
      ],
      [{ id: 'prod-p', shopId: 'shop-b', tiktokProductId: 'TT-P', title: 'P', skus: [] }],
    );
    await expect(service.findSkipReason('org-1', buildProduct(), 'shop-b')).resolves.toBeNull();
  });

  it('một sản phẩm × nhiều shop đích (cùng object) ⇒ lần nguồn gốc MỘT lần', async () => {
    const { service, prisma } = build(
      [payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', productId: 'prod-p' })],
      [{ id: 'prod-p', shopId: 'shop-c', tiktokProductId: 'TT-P', title: 'P', skus: [] }],
    );
    const product = buildProduct();
    await service.findSkipReason('org-1', product, 'shop-b');
    const lineageQueries = prisma.podListingPayload.findMany.mock.calls.length;
    await service.findSkipReason('org-1', product, 'shop-d');
    await service.findSkipReason('org-1', product, 'shop-e');
    expect(prisma.podListingPayload.findMany).toHaveBeenCalledTimes(lineageQueries);
  });

  it('mọi truy vấn đều khoá theo tổ chức', async () => {
    const { service, prisma } = build(
      [payload({ shopId: 'shop-src', tiktokProductId: 'TT-PRODUCT-SRC', productId: 'prod-p' })],
      [{ id: 'prod-p', shopId: 'shop-c', tiktokProductId: 'TT-P', title: 'P', skus: [] }],
    );
    await service.findSkipReason('org-1', buildProduct(), 'shop-b');
    const calls = [
      ...prisma.podListingPayload.findFirst.mock.calls,
      ...prisma.podListingPayload.findMany.mock.calls,
      ...prisma.podProduct.findFirst.mock.calls,
      ...prisma.podProduct.findMany.mock.calls,
    ] as unknown as Array<[{ where: Where }]>;
    expect(calls.length).toBeGreaterThan(3);
    for (const [args] of calls) expect(args.where.organizationId).toBe('org-1');
  });
});
