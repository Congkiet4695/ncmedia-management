import type { PrismaService } from '../../../database/prisma.service';
import { PodOrderMapper } from '../mappers/pod-order.mapper';
import { PodOrderRepository } from '../repositories/pod-order.repository';
import type { TiktokEncryptionService } from './tiktok-encryption.service';
import type { TiktokOrder, TiktokOrderLineItem } from '../types/tiktok-order.types';

/**
 * Danh tính của line item đơn TikTok là `line_items[].id`. Fixture đại diện cho dữ liệu thật đã đối
 * chiếu: khách mua 2 cái cùng biến thể ⇒ TikTok trả 2 phần tử khác id, không có field số lượng, và ảnh
 * chỉ khác nhau ở host CDN.
 */
const lineItem = (id: string, over: Partial<TiktokOrderLineItem> = {}): TiktokOrderLineItem =>
  ({
    id,
    product_id: 'PRODUCT-A',
    product_name: 'Product A',
    sku_id: 'SKU-X',
    sku_name: 'Variant X',
    seller_sku: 'SELLER-X',
    sale_price: '20.49',
    package_id: 'PKG-1',
    ...over,
  });

const orderWith = (line_items: TiktokOrderLineItem[]): TiktokOrder =>
  ({ id: 'ORDER-1', status: 'AWAITING_COLLECTION', create_time: 1, update_time: 2, line_items });

const mapper = new PodOrderMapper({ encrypt: (value: string) => value } as unknown as TiktokEncryptionService);

describe('🔴 danh tính line item khi đồng bộ đơn TikTok', () => {
  it('2 line item cùng biến thể ⇒ giữ nguyên 2 bản ghi riêng, không gộp lúc ingest', () => {
    const mapped = mapper.map(
      orderWith([
        lineItem('LINE-1', { sku_image: 'https://p19-oec.ttcdn-us.com/tos/same.jpeg' }),
        lineItem('LINE-2', { sku_image: 'https://p16-oec.ttcdn-us.com/tos/same.jpeg' }),
      ]),
    );

    expect(mapped.items.map((item) => [item.tiktokLineItemId, item.data.productId, item.data.skuId])).toEqual([
      ['LINE-1', 'PRODUCT-A', 'SKU-X'],
      ['LINE-2', 'PRODUCT-A', 'SKU-X'],
    ]);
  });

  it('2 biến thể khác nhau ⇒ 2 bản ghi, giữ đúng SKU của từng dòng', () => {
    const mapped = mapper.map(
      orderWith([
        lineItem('LINE-1'),
        lineItem('LINE-2', { sku_id: 'SKU-Y', sku_name: 'Variant Y', seller_sku: 'SELLER-Y' }),
      ]),
    );

    expect(mapped.items.map((item) => [item.tiktokLineItemId, item.data.skuId, item.data.sellerSku])).toEqual([
      ['LINE-1', 'SKU-X', 'SELLER-X'],
      ['LINE-2', 'SKU-Y', 'SELLER-Y'],
    ]);
  });

  it('Case 4: đồng bộ lại cùng line item ⇒ upsert theo (order, line_items[].id), không tạo bản ghi mới', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const repository = new PodOrderRepository({} as PrismaService);
    const { data } = mapper.map(orderWith([lineItem('LINE-1')])).items[0];

    await repository.upsertItem({ podOrderItem: { upsert } } as never, 'org-1', 'order-1', data);
    await repository.upsertItem({ podOrderItem: { upsert } } as never, 'org-1', 'order-1', data);

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const [call] of upsert.mock.calls as Array<[{ where: unknown }]>) {
      expect(call.where).toEqual({
        orderId_tiktokLineItemId: { orderId: 'order-1', tiktokLineItemId: 'LINE-1' },
      });
    }
  });
});
