import type { ConfigService } from '@nestjs/config';
import type { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import type { FulfillmentGlobalCatalogRepository } from '../repositories/fulfillment-global-catalog.repository';
import {
  FulfillmentCatalogReader,
  GLOBAL_CATALOG_READ_FLAG,
} from './fulfillment-catalog-reader.service';

const NOW = new Date('2026-11-10T00:00:00Z');

function build(options: {
  flag: boolean;
  projected?: boolean | Error;
  accountOfProduct?: string | null;
}) {
  const legacyPrice = [
    {
      id: 'v-legacy',
      externalVariantId: 'EV',
      sku: 'SKU',
      price: '9.00',
      status: 'ACTIVE',
      syncedAt: NOW,
      product: { currency: 'USD' },
    },
  ];
  const legacy = {
    findVariantsForPrice: jest.fn().mockResolvedValue(legacyPrice),
    listVariants: jest.fn().mockResolvedValue([{ id: 'legacy-variant' }]),
    findProductById: jest.fn().mockResolvedValue({ id: 'legacy-product' }),
    loadMatchIndexRows: jest.fn().mockResolvedValue([{ id: 'legacy-row' }]),
    lastSyncedAt: jest.fn().mockResolvedValue(NOW),
    countActive: jest.fn(),
    latestCatalogSync: jest.fn(),
    upsertCandidates: jest.fn(),
  };
  const global = {
    isAccountProjected: jest.fn(() =>
      options.projected instanceof Error
        ? Promise.reject(options.projected)
        : Promise.resolve(options.projected ?? true),
    ),
    accountOfProduct: jest.fn().mockResolvedValue(options.accountOfProduct ?? null),
    findVariantsForPrice: jest.fn().mockResolvedValue([
      {
        id: 'v-legacy',
        price: '5.80',
        currency: 'USD',
        status: 'ACTIVE',
        syncedAt: NOW,
        globalVariant: { externalVariantId: 'EV', sku: 'SKU' },
      },
    ]),
    listVariants: jest.fn().mockResolvedValue([]),
    findProductById: jest.fn().mockResolvedValue(null),
    loadMatchIndexRows: jest.fn().mockResolvedValue([]),
    catalogueNames: jest.fn().mockResolvedValue(new Map()),
  };
  const config = {
    get: (key: string) => (key === GLOBAL_CATALOG_READ_FLAG ? options.flag : undefined),
  } as unknown as ConfigService;
  const reader = new FulfillmentCatalogReader(
    legacy as unknown as FulfillmentCatalogRepository,
    global as unknown as FulfillmentGlobalCatalogRepository,
    config,
  );
  return { reader, legacy, global };
}

describe('FulfillmentCatalogReader — chọn nguồn đọc danh mục', () => {
  it('cờ TẮT ⇒ chỉ bảng cũ, KHÔNG chạm lớp mới (hành vi y như trước)', async () => {
    const { reader, legacy, global } = build({ flag: false });
    const rows = await reader.findVariantsForPrice('org', 'acc-A', { externalVariantId: 'EV' });
    expect(rows[0].price).toBe('9.00');
    expect(legacy.findVariantsForPrice).toHaveBeenCalledWith('org', 'acc-A', {
      externalVariantId: 'EV',
    });
    expect(global.isAccountProjected).not.toHaveBeenCalled();
    expect(global.findVariantsForPrice).not.toHaveBeenCalled();
  });

  it('không có ConfigService (dựng tay trong test cũ) ⇒ coi như cờ tắt', async () => {
    const legacy = { findVariantsForPrice: jest.fn().mockResolvedValue([]) };
    const reader = new FulfillmentCatalogReader(
      legacy as unknown as FulfillmentCatalogRepository,
      {} as FulfillmentGlobalCatalogRepository,
    );
    expect(reader.globalReadEnabled).toBe(false);
    await reader.findVariantsForPrice('org', 'acc', { sku: 'x' });
    expect(legacy.findVariantsForPrice).toHaveBeenCalled();
  });

  it('cờ BẬT + đã chiếu ⇒ giá ở lớp THEO TÀI KHOẢN, đúng accountId, đúng hình dạng cũ', async () => {
    const { reader, legacy, global } = build({ flag: true, projected: true });
    const rows = await reader.findVariantsForPrice('org', 'acc-B', {
      externalVariantId: 'EV',
      sku: 'SKU',
    });
    expect(global.isAccountProjected).toHaveBeenCalledWith('acc-B');
    expect(global.findVariantsForPrice).toHaveBeenCalledWith('org', 'acc-B', {
      externalVariantId: 'EV',
      sku: 'SKU',
    });
    expect(legacy.findVariantsForPrice).not.toHaveBeenCalled();
    expect(rows).toEqual([
      {
        id: 'v-legacy',
        externalVariantId: 'EV',
        sku: 'SKU',
        price: '5.80',
        status: 'ACTIVE',
        syncedAt: NOW,
        product: { currency: 'USD' },
      },
    ]);
  });

  it('cờ BẬT + tài khoản CHƯA chiếu xong ⇒ bảng cũ của CÙNG tài khoản', async () => {
    const { reader, legacy, global } = build({ flag: true, projected: false });
    await reader.findVariantsForPrice('org', 'acc-A', { sku: 'SKU' });
    expect(global.findVariantsForPrice).not.toHaveBeenCalled();
    expect(legacy.findVariantsForPrice).toHaveBeenCalledWith('org', 'acc-A', { sku: 'SKU' });
  });

  it('cờ BẬT + lớp mới không có dòng ⇒ bảng cũ của CÙNG tài khoản (không lấy tài khoản khác)', async () => {
    const { reader, legacy, global } = build({ flag: true, projected: true });
    global.findVariantsForPrice.mockResolvedValueOnce([]);
    const rows = await reader.findVariantsForPrice('org', 'acc-A', { sku: 'SKU' });
    expect(legacy.findVariantsForPrice).toHaveBeenCalledWith('org', 'acc-A', { sku: 'SKU' });
    expect(rows[0].price).toBe('9.00');
  });

  it('lớp mới lỗi (vd migration chưa chạy) ⇒ bảng cũ, không ném lỗi ra màn hình', async () => {
    const { reader, legacy } = build({
      flag: true,
      projected: new Error('relation "fulfillment_account_products" does not exist'),
    });
    await expect(reader.findVariantsForPrice('org', 'acc-A', { sku: 'SKU' })).resolves.toHaveLength(
      1,
    );
    expect(legacy.findVariantsForPrice).toHaveBeenCalled();
  });

  it('biến thể theo sản phẩm: sản phẩm không có ở lớp mới ⇒ bảng cũ', async () => {
    const { reader, legacy, global } = build({ flag: true, accountOfProduct: null });
    await expect(reader.listVariants('org', 'prod-1')).resolves.toEqual([{ id: 'legacy-variant' }]);
    expect(global.isAccountProjected).not.toHaveBeenCalled();
    expect(legacy.listVariants).toHaveBeenCalledWith('org', 'prod-1');
  });

  it('biến thể theo sản phẩm: rawData lấy ở lớp GLOBAL (vùng in / production line là metadata chuẩn)', async () => {
    const { reader, global } = build({ flag: true, projected: true, accountOfProduct: 'acc-A' });
    global.listVariants.mockResolvedValueOnce([
      {
        id: 'v1',
        organizationId: 'org',
        accountId: 'acc-A',
        provider: 'SELLERWIX',
        accountProductId: 'prod-1',
        price: '5.00',
        status: 'ACTIVE',
        syncedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        rawData: { cost: 5, print_areas: [{ key: 'ACCOUNT' }] },
        globalVariant: {
          externalVariantId: 'SW-1',
          sku: 'SW-1',
          name: 'Black / S',
          color: 'Black',
          size: 'S',
          rawData: { print_areas: [{ key: 'CF' }] },
        },
      },
    ]);
    const [row] = await reader.listVariants('org', 'prod-1');
    expect(row).toMatchObject({
      id: 'v1',
      productId: 'prod-1',
      externalVariantId: 'SW-1',
      price: '5.00',
      rawData: { print_areas: [{ key: 'CF' }] },
    });
  });

  it('sản phẩm theo id: lớp mới không thấy (tài khoản không dùng được) ⇒ bảng cũ quyết định (cùng luật tenant)', async () => {
    const { reader, legacy } = build({ flag: true, projected: true, accountOfProduct: 'acc-A' });
    await expect(reader.findProductById('org', 'prod-1')).resolves.toEqual({
      id: 'legacy-product',
    });
    expect(legacy.findProductById).toHaveBeenCalledWith('org', 'prod-1');
  });

  it('nhật ký đồng bộ luôn đọc bảng của nó (không phải dữ liệu danh mục)', async () => {
    const { reader, legacy, global } = build({ flag: true });
    await reader.latestCatalogSync('acc');
    expect(legacy.latestCatalogSync).toHaveBeenCalledWith('acc');
    expect(global.isAccountProjected).not.toHaveBeenCalled();
  });

  it('số liệu danh mục (lastSyncedAt) — cờ bật + đã chiếu ⇒ lớp mới', async () => {
    const { reader, legacy, global } = build({ flag: true, projected: true });
    const later = new Date('2026-11-11T00:00:00Z');
    (global as unknown as { lastSyncedAt: jest.Mock }).lastSyncedAt = jest
      .fn()
      .mockResolvedValue(later);
    await expect(reader.lastSyncedAt('acc')).resolves.toBe(later);
    expect(legacy.lastSyncedAt).not.toHaveBeenCalled();
  });

  describe('fallback KHÔNG âm thầm', () => {
    it('chưa chiếu ⇒ đếm NOT_PROJECTED và WARN MỘT lần cho nhiều lượt đọc (gộp)', async () => {
      const { reader } = build({ flag: true, projected: false });
      const warn = jest
        .spyOn(
          (reader as unknown as { logger: { warn: (message: unknown) => void } }).logger,
          'warn',
        )
        .mockImplementation();
      for (let i = 0; i < 5; i += 1)
        await reader.findVariantsForPrice('org', 'acc-A', { sku: 'SKU' });
      expect(reader.readStats().NOT_PROJECTED).toBe(5);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatchObject({
        fallbackReason: 'NOT_PROJECTED',
        accountId: 'acc-A',
      });
    });

    it('🔴 đã chiếu mà lớp mới THIẾU dòng bảng cũ có ⇒ WARN GLOBAL_LEGACY_DIVERGENCE mỗi lần', async () => {
      const { reader, global } = build({ flag: true, projected: true });
      global.findVariantsForPrice.mockResolvedValue([]);
      const warn = jest
        .spyOn(
          (reader as unknown as { logger: { warn: (message: unknown) => void } }).logger,
          'warn',
        )
        .mockImplementation();
      await reader.findVariantsForPrice('org', 'acc-A', { sku: 'SKU' });
      await reader.findVariantsForPrice('org', 'acc-A', { sku: 'SKU' });
      expect(reader.readStats().DIVERGENCE).toBe(2);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toMatchObject({ fallbackReason: 'GLOBAL_LEGACY_DIVERGENCE' });
    });

    it('không có ở CẢ HAI nơi (tra giá SKU không tồn tại) ⇒ chỉ đếm, không WARN', async () => {
      const { reader, legacy, global } = build({ flag: true, projected: true });
      global.findVariantsForPrice.mockResolvedValue([]);
      legacy.findVariantsForPrice.mockResolvedValue([]);
      const warn = jest
        .spyOn(
          (reader as unknown as { logger: { warn: (message: unknown) => void } }).logger,
          'warn',
        )
        .mockImplementation();
      await reader.findVariantsForPrice('org', 'acc-A', { sku: 'NOPE' });
      expect(reader.readStats().NOT_FOUND_BOTH).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('lớp mới lỗi ⇒ ERROR + đếm, vẫn trả dữ liệu bảng cũ', async () => {
      const { reader } = build({ flag: true, projected: new Error('boom') });
      const error = jest
        .spyOn(
          (reader as unknown as { logger: { error: (message: unknown) => void } }).logger,
          'error',
        )
        .mockImplementation();
      await expect(
        reader.findVariantsForPrice('org', 'acc-A', { sku: 'SKU' }),
      ).resolves.toHaveLength(1);
      expect(reader.readStats().ERROR).toBe(1);
      expect(error).toHaveBeenCalledTimes(1);
    });
  });
});
