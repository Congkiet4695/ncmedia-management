import {
  POD_PRODUCT_UPSERT_TX_MAX_WAIT_MS,
  POD_PRODUCT_UPSERT_TX_TIMEOUT_MS,
} from '../constants/pod-product.constants';
import type { MappedProduct } from '../mappers/pod-product.mapper';
import { PodProductRepository } from './pod-product.repository';

/**
 * Transaction ghi MỘT sản phẩm (`upsertAggregate`).
 *
 * 🔴 Root cause của các lượt Partial (docs/pod-product/07-product-sync-partial-fix.md): transaction chạy
 * với timeout MẶC ĐỊNH 5 s của Prisma, trong khi xoá biến thể (người bán bớt SKU) mất hàng chục giây ⇒
 * Prisma rollback ⇒ sản phẩm FAILED ở mọi lượt. Kiểm đúng tham số gửi xuống `$transaction`.
 */
describe('PodProductRepository.upsertAggregate — giới hạn transaction', () => {
  it('truyền timeout / maxWait riêng thay vì mặc định 5 s / 2 s của Prisma', async () => {
    const tx = {
      podProduct: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p-1' }),
        update: jest.fn().mockResolvedValue({ id: 'p-1' }),
      },
      podProductImage: { deleteMany: jest.fn(), createMany: jest.fn() },
      podProductVideo: { deleteMany: jest.fn(), createMany: jest.fn() },
      podProductAttribute: { deleteMany: jest.fn(), createMany: jest.fn() },
      podProductVariant: {
        findMany: jest.fn().mockResolvedValue([{ id: 'v-old', tiktokSkuId: 'sku-old' }]),
        deleteMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      podProductCategory: { findFirst: jest.fn().mockResolvedValue(null) },
      podProductBrand: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const $transaction = jest.fn(
      (fn: (client: typeof tx) => Promise<unknown>, _options: unknown) => fn(tx),
    );
    const repo = new PodProductRepository({ $transaction } as never);
    jest
      .spyOn(repo as unknown as { linkCatalogReferences: () => Promise<void> }, 'linkCatalogReferences')
      .mockResolvedValue(undefined);

    const mapped = {
      product: { tiktokProductId: 't-1', payloadHash: 'h' },
      variants: [],
      images: [],
      videos: [],
      attributes: [],
    } as unknown as MappedProduct;

    await expect(repo.upsertAggregate('org', 'acc', 'shop', mapped, null)).resolves.toEqual({
      id: 'p-1',
      created: false,
    });
    expect($transaction.mock.calls[0][1]).toEqual({
      timeout: POD_PRODUCT_UPSERT_TX_TIMEOUT_MS,
      maxWait: POD_PRODUCT_UPSERT_TX_MAX_WAIT_MS,
    });
    expect(POD_PRODUCT_UPSERT_TX_TIMEOUT_MS).toBeGreaterThan(5_000);
    // 🔴 TC3 "Last synced" (`last_synced_at`) được ghi CÙNG câu lệnh ghi dữ liệu sản phẩm, TRONG
    // transaction ⇒ chỉ đổi khi ghi thành công; transaction rollback thì giữ giá trị cũ.
    const updateData = (tx.podProduct.update.mock.calls[0] as [{ data: { lastSyncedAt: unknown } }])[0].data;
    expect(updateData.lastSyncedAt).toBeInstanceOf(Date);
    // SKU người bán đã bỏ trên TikTok vẫn bị xoá (hành vi cũ) — chính câu lệnh cần index FK.
    expect(tx.podProductVariant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['v-old'] } } });
  });
});
