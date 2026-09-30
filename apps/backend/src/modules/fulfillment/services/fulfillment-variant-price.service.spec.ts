import { FulfillmentCatalogItemStatus } from '@prisma/client';
import { FulfillmentVariantPriceUnavailableException } from '../exceptions/fulfillment.exceptions';
import type { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import {
  FulfillmentVariantPriceService,
  parseProviderPrice,
} from './fulfillment-variant-price.service';

/**
 * **Giá vốn của biến thể nhà cung cấp** — nguồn duy nhất của Base Cost.
 *
 * Giá đọc từ ĐÚNG bản ghi biến thể đã đồng bộ (Mango `price` / Sellerwix `cost`), không bao giờ từ
 * frontend, không bao giờ mặc định 0.
 */

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'var-1',
    externalVariantId: 'ext-1',
    sku: 'SKU-1',
    price: '23.89',
    status: FulfillmentCatalogItemStatus.ACTIVE,
    syncedAt: new Date('2026-09-30T01:00:00.000Z'),
    product: { currency: 'USD' },
    ...over,
  };
}

function build(rows: unknown[]) {
  const findVariantsForPrice = jest.fn().mockResolvedValue(rows);
  const service = new FulfillmentVariantPriceService({
    findVariantsForPrice,
  } as unknown as FulfillmentCatalogRepository);
  return { service, findVariantsForPrice };
}

describe('parseProviderPrice', () => {
  it.each([
    ['23.89', 23.89],
    ['9.99', 9.99],
    ['0', 0],
    [' 12.5 ', 12.5],
    ['1.123456', 1.1235],
  ])('"%s" ⇒ %s', (raw, expected) => {
    expect(parseProviderPrice(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['  '], ['-1'], ['$12'], ['12,5'], ['abc'], ['1e3']])(
    '"%s" ⇒ null (không đoán, không thành 0)',
    (raw) => {
      expect(parseProviderPrice(raw)).toBeNull();
    },
  );
});

describe('FulfillmentVariantPriceService', () => {
  it('biến thể có giá ⇒ trả đúng giá + nguồn + thời điểm đồng bộ, tra theo tổ chức + tài khoản', async () => {
    const { service, findVariantsForPrice } = build([row()]);

    const price = await service.require('org-1', 'acc-1', { id: 'var-1' });

    expect(findVariantsForPrice).toHaveBeenCalledWith('org-1', 'acc-1', { id: 'var-1' });
    expect(price).toEqual({
      accountId: 'acc-1',
      variantId: 'var-1',
      externalVariantId: 'ext-1',
      sku: 'SKU-1',
      price: 23.89,
      currency: 'USD',
      source: 'PROVIDER_CATALOG',
      syncedAt: '2026-09-30T01:00:00.000Z',
    });
  });

  it('không có biến thể (sai tài khoản / tổ chức khác / chưa đồng bộ) ⇒ 422 VARIANT_NOT_FOUND', async () => {
    const { service } = build([]);

    const error = (await service
      .require('org-1', 'acc-1', { id: 'var-x' })
      .catch((caught: unknown) => caught)) as FulfillmentVariantPriceUnavailableException;

    expect(error).toBeInstanceOf(FulfillmentVariantPriceUnavailableException);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({
      code: 'FULFILLMENT_VARIANT_PRICE_UNAVAILABLE',
      details: { reason: 'VARIANT_NOT_FOUND' },
    });
  });

  it('biến thể đã ngừng bán ⇒ VARIANT_INACTIVE', async () => {
    const { service } = build([row({ status: FulfillmentCatalogItemStatus.INACTIVE })]);
    await expect(service.lookup('org-1', 'acc-1', { sku: 'SKU-1' })).resolves.toMatchObject({
      ok: false,
      reason: 'VARIANT_INACTIVE',
    });
  });

  it('nhà cung cấp không trả giá ⇒ PRICE_MISSING (không phải 0)', async () => {
    const { service } = build([row({ price: null })]);
    await expect(service.lookup('org-1', 'acc-1', { sku: 'SKU-1' })).resolves.toMatchObject({
      ok: false,
      reason: 'PRICE_MISSING',
    });
  });

  it('giá sai định dạng ⇒ PRICE_INVALID, nêu nguyên văn', async () => {
    const { service } = build([row({ price: 'N/A' })]);
    const result = await service.lookup('org-1', 'acc-1', { sku: 'SKU-1' });
    expect(result).toMatchObject({ ok: false, reason: 'PRICE_INVALID' });
    expect(result.ok ? '' : result.message).toContain('N/A');
  });

  it('cùng khoá mà hai bản ghi hai giá khác nhau ⇒ AMBIGUOUS (không đoán)', async () => {
    const { service } = build([row(), row({ id: 'var-2', price: '19.00' })]);
    await expect(service.lookup('org-1', 'acc-1', { sku: 'SKU-1' })).resolves.toMatchObject({
      ok: false,
      reason: 'AMBIGUOUS',
    });
  });

  it('nhiều bản ghi CÙNG giá ⇒ dùng được', async () => {
    const { service } = build([row(), row({ id: 'var-2', price: '23.890' })]);
    const result = await service.lookup('org-1', 'acc-1', { sku: 'SKU-1' });
    expect(result).toMatchObject({ ok: true, price: { price: 23.89 } });
  });
});
