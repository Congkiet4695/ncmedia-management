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
      // Ô của Pressify không xuất hiện với Sellerwix.
      handlingType: false,
      printMethod: false,
    });
    expect(result.handlingTypes).toEqual([]);
    expect(result.printMethods).toEqual([]);
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
      // Ô của Pressify không xuất hiện với Mango.
      handlingType: false,
      printMethod: false,
    });
    expect(result.handlingTypes).toEqual([]);
    expect(result.printMethods).toEqual([]);
    expect(result.shippingMethods.length).toBeGreaterThan(0);
    expect(result.productionLines).toEqual([{ value: 'line-1', label: 'TikTok line' }]);
  });

  it('Pressify: CHỈ kiểu xử lý đơn + phương thức in + vận chuyển standard/priority; KHÔNG ô Mango / Sellerwix', async () => {
    const { options, fetchProductionLines } = service();

    const result = await options.forAccount(account(FulfillmentProvider.PRESSIFY));

    expect(result.capabilities).toEqual({
      productionLine: false,
      productionConfig: false,
      facility: false,
      speedType: false,
      preferredCarrier: false,
      scanLabel: false,
      rushService: false,
      shippingMethodsByOrder: false,
      updateAfterSubmit: false,
      handlingType: true,
      printMethod: true,
    });
    // Đúng tập giá trị của tài liệu Pressify, phần tử đầu = mặc định.
    expect(result.handlingTypes.map((option) => option.value)).toEqual(['new_order', 'priority', 'express']);
    expect(result.printMethods.map((option) => option.value)).toEqual(['DTF', 'DTG']);
    expect(result.shippingMethods.map((option) => option.value)).toEqual(['standard', 'priority']);
    // Không mượn danh sách của Mango, không gọi API Mango.
    expect(result.facilities).toEqual([]);
    expect(result.speedTypes).toEqual([]);
    expect(result.preferredCarriers).toEqual([]);
    expect(result.productionConfigs).toEqual([]);
    expect(result.productionLines).toEqual([]);
    expect(fetchProductionLines).not.toHaveBeenCalled();
    // Nhãn cổ (LABEL) không có ở Pressify ⇒ không liệt kê; các vị trí còn lại đúng khoá tài liệu.
    expect(result.printLocations).toEqual([
      { placement: 'FRONT', providerKey: 'front' },
      { placement: 'BACK', providerKey: 'back' },
      { placement: 'LEFT', providerKey: 'sleeve_left' },
      { placement: 'RIGHT', providerKey: 'sleeve_right' },
      { placement: 'SLEEVE', providerKey: 'sleeve_left' },
    ]);
  });
});
