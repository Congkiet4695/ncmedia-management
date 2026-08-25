import {
  PodListingSessionProductStatus,
  PodListingSessionStatus,
  PodListingSessionTemplateType,
} from '@prisma/client';
import { POD_SESSION_VALIDATION_CODES } from '../constants/pod-listing-session.constants';
import { PodListingSessionService } from './pod-listing-session.service';

/**
 * Cổng Validate của Listing Session.
 *
 * 🔴 Đây là thứ đứng giữa "một file Excel nhập vội" và "hàng trăm sản phẩm hỏng trên shop
 * thật", nên mỗi luật được kiểm bằng một test lấy đi ĐÚNG MỘT thứ.
 *
 * Không dùng database: `validate()` chỉ đọc session + sản phẩm rồi ghi kết quả, nên một
 * Prisma giả đủ để kiểm toàn bộ luật — và test chạy trong vài mili giây.
 */

type ProductRow = {
  id: string;
  title: string;
  status: PodListingSessionProductStatus;
  /** 🔴 Draft Product chỉ mang tiêu đề + ảnh gốc (URL1 → URL10). */
  images: Array<{ imageUrl: string }>;
};

function buildProduct(over: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'product-1',
    title: 'Vintage Sunset Poster',
    status: PodListingSessionProductStatus.DRAFT,
    images: [{ imageUrl: 'https://cdn.example/front.jpg' }],
    ...over,
  };
}

/** Session đủ điều kiện — mỗi test chỉ bỏ đi một mảnh để xem cổng nào bật. */
function buildSession(over: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    organizationId: 'org-1',
    name: 'Lô Halloween',
    market: 'US',
    status: PodListingSessionStatus.DRAFT,
    deletedAt: null,
    shops: [{ shopId: 'shop-1', shop: { id: 'shop-1', name: 'Playmaker', region: 'US' } }],
    templates: [
      templateRow(PodListingSessionTemplateType.CATEGORY, 'cat-1'),
      templateRow(PodListingSessionTemplateType.SKU, 'sku-1'),
    ],
    ...over,
  };
}

function templateRow(type: PodListingSessionTemplateType, id: string) {
  return {
    templateType: type,
    categoryTemplateId: type === PodListingSessionTemplateType.CATEGORY ? id : null,
    skuTemplateId: type === PodListingSessionTemplateType.SKU ? id : null,
    descriptionTemplateId: type === PodListingSessionTemplateType.DESCRIPTION ? id : null,
    imageTemplateId: type === PodListingSessionTemplateType.IMAGE ? id : null,
    pricingStrategyId: type === PodListingSessionTemplateType.PRICING ? id : null,
  };
}

/** Dựng service với Prisma giả; trả kèm những gì đã được ghi xuống để kiểm tra. */
function buildService(session: ReturnType<typeof buildSession>, products: ProductRow[]) {
  const productUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const sessionUpdates: Array<Record<string, unknown>> = [];

  const prisma = {
    podListingSession: {
      findFirst: jest.fn().mockResolvedValue(session),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        sessionUpdates.push(data);
        return Promise.resolve(session);
      }),
    },
    podListingSessionProduct: {
      findMany: jest.fn().mockResolvedValue(products),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        productUpdates.push({ id: where.id, data });
        return Promise.resolve({});
      }),
    },
  };

  const resolver = {
    resolveFromContext: jest.fn().mockReturnValue({ payload: {}, issues: [], payloadHash: 'hash' }),
  };
  const validator = { validate: jest.fn().mockReturnValue({ ok: true, blockers: [], warnings: [] }) };
  const templates = { getForSession: jest.fn().mockResolvedValue({ id: '', name: 'x' }) };
  const jobs = { createFromSession: jest.fn() };

  const service = new PodListingSessionService(
    prisma as never,
    resolver as never,
    validator as never,
    templates as never,
    jobs as never,
  );

  return { service, productUpdates, sessionUpdates, resolver, validator };
}

describe('PodListingSessionService — cổng Validate', () => {
  it('lượt đăng đủ dữ liệu ⇒ sản phẩm READY và session READY', async () => {
    const { service, productUpdates, sessionUpdates } = buildService(buildSession(), [
      buildProduct(),
    ]);

    const result = await service.validate('org-1', 'session-1');

    expect(result.ok).toBe(true);
    expect(result.readyProducts).toBe(1);
    expect(productUpdates[0].data.status).toBe(PodListingSessionProductStatus.READY);
    expect(sessionUpdates[0].status).toBe(PodListingSessionStatus.READY);
  });

  it('chưa chọn shop ⇒ chặn cả lượt', async () => {
    const { service } = buildService(buildSession({ shops: [] }), [buildProduct()]);

    const result = await service.validate('org-1', 'session-1');

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      POD_SESSION_VALIDATION_CODES.NO_SHOP,
    );
  });

  it('chưa chọn Category Template ⇒ chặn cả lượt', async () => {
    const { service } = buildService(buildSession({ templates: [] }), [buildProduct()]);

    const result = await service.validate('org-1', 'session-1');

    expect(result.issues.map((issue) => issue.code)).toContain(
      POD_SESSION_VALIDATION_CODES.NO_CATEGORY_TEMPLATE,
    );
  });

  it('chưa import sản phẩm nào ⇒ chặn cả lượt', async () => {
    const { service } = buildService(buildSession(), []);

    const result = await service.validate('org-1', 'session-1');

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      POD_SESSION_VALIDATION_CODES.NO_PRODUCT,
    );
  });

  it('sản phẩm không ảnh và lượt đăng không có Image Template ⇒ báo thiếu ảnh', async () => {
    const { service } = buildService(buildSession(), [buildProduct({ images: [] })]);

    const result = await service.validate('org-1', 'session-1');

    expect(result.products[0].issues.map((issue) => issue.code)).toContain(
      POD_SESSION_VALIDATION_CODES.MISSING_IMAGE,
    );
  });

  it('sản phẩm không ảnh nhưng lượt đăng có Image Template ⇒ vẫn qua', async () => {
    const session = buildSession({
      templates: [
        templateRow(PodListingSessionTemplateType.CATEGORY, 'cat-1'),
        templateRow(PodListingSessionTemplateType.SKU, 'sku-1'),
        templateRow(PodListingSessionTemplateType.IMAGE, 'img-1'),
      ],
    });
    const { service } = buildService(session, [buildProduct({ images: [] })]);

    const result = await service.validate('org-1', 'session-1');

    expect(result.ok).toBe(true);
  });

  it('chưa chọn SKU Template ⇒ chặn (file import không mang biến thể nào)', async () => {
    const session = buildSession({
      templates: [templateRow(PodListingSessionTemplateType.CATEGORY, 'cat-1')],
    });
    const { service } = buildService(session, [buildProduct()]);

    const result = await service.validate('org-1', 'session-1');

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      POD_SESSION_VALIDATION_CODES.NO_SKU_TEMPLATE,
    );
  });

  it('sản phẩm ĐÃ lên sàn không bị hạ trạng thái khi kiểm lại', async () => {
    const { service, productUpdates } = buildService(buildSession(), [
      buildProduct({ status: PodListingSessionProductStatus.UPLOADED, images: [] }),
    ]);

    await service.validate('org-1', 'session-1');

    // Có ghi lại danh sách lỗi, nhưng KHÔNG đụng tới `status` — đó là sự thật lịch sử.
    expect(productUpdates[0].data).not.toHaveProperty('status');
    expect(productUpdates[0].data.errorCount).toBe(1);
  });

  it('lỗi từ Bulk Listing Engine cũng chặn — hai bên dùng chung một bộ luật', async () => {
    const { service, validator } = buildService(buildSession(), [buildProduct()]);
    validator.validate.mockReturnValue({
      ok: false,
      blockers: [{ code: 'LISTING_MISSING_CATEGORY', field: 'category', message: 'Thiếu danh mục' }],
      warnings: [],
    });

    const result = await service.validate('org-1', 'session-1');

    expect(result.ok).toBe(false);
    expect(result.products[0].issues[0].code).toBe('LISTING_MISSING_CATEGORY');
  });
});
