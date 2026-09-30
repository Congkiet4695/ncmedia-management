import { FulfillmentProvider, type FulfillmentAccount } from '@prisma/client';
import type { MangoCatalogService } from '../mango/services/mango-catalog.service';
import { FulfillmentOptionsService } from './fulfillment-options.service';

/**
 * **Mỗi nhà cung cấp một bộ ô cấu hình riêng** — giao diện Fulfill/Cấu hình sản phẩm hiện ô theo
 * `capabilities` ở đây, nên đây là nơi chặn chuyện "Sellerwix dùng nguyên giao diện Mango".
 */
function service() {
  const fetchProductionLines = jest.fn().mockResolvedValue([{ id: 'line-1', name: 'TikTok line' }]);
  const catalog = { fetchProductionLines } as unknown as MangoCatalogService;
  return { options: new FulfillmentOptionsService(catalog), fetchProductionLines };
}

const account = (provider: FulfillmentProvider) =>
  ({ id: `acc-${provider}`, provider, name: provider }) as unknown as FulfillmentAccount;

describe('FulfillmentOptionsService — ô cấu hình theo nhà cung cấp', () => {
  it('Sellerwix: CHỈ rush service + phương thức vận chuyển theo đơn; KHÔNG có ô nào của Mango', async () => {
    const { options, fetchProductionLines } = service();

    const result = await options.forAccount(account(FulfillmentProvider.SELLERWIX));

    expect(result.capabilities).toEqual({
      productionLine: false,
      productionConfig: false,
      facility: false,
      speedType: false,
      preferredCarrier: false,
      scanLabel: false,
      rushService: true,
      shippingMethodsByOrder: true,
      updateAfterSubmit: false,
    });
    // Không có danh sách cố định nào mượn của Mango.
    expect(result.shippingMethods).toEqual([]);
    expect(result.facilities).toEqual([]);
    expect(result.speedTypes).toEqual([]);
    expect(result.preferredCarriers).toEqual([]);
    expect(result.productionConfigs).toEqual([]);
    expect(result.productionLines).toEqual([]);
    // Không gọi API Mango với tài khoản Sellerwix.
    expect(fetchProductionLines).not.toHaveBeenCalled();
  });

  it('Mango (không đổi): shipping/facility/speed/carrier/scan label/production config/line', async () => {
    const { options } = service();

    const result = await options.forAccount(account(FulfillmentProvider.MANGO));

    expect(result.capabilities).toMatchObject({
      productionLine: true,
      productionConfig: true,
      facility: true,
      speedType: true,
      preferredCarrier: true,
      scanLabel: true,
      rushService: false,
      shippingMethodsByOrder: false,
    });
    expect(result.shippingMethods.length).toBeGreaterThan(0);
    expect(result.productionLines).toEqual([{ value: 'line-1', label: 'TikTok line' }]);
  });
});
