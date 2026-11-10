import { FulfillmentProvider, FulfillmentStatus } from '@prisma/client';
import { MangoOrderMapper } from '../mango/mappers/mango-order.mapper';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';
import { FulfillmentService } from './fulfillment.service';

/**
 * `getStates` (danh sách đơn) phải ra ĐÚNG kết quả của `getState` (từng đơn): hai đường dùng chung hàm dựng, chỉ khác cách
 * nạp dữ liệu. Bộ test chạy cả hai trên cùng một kho giả và so sánh.
 */
const ORG = 'org-1';
const ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const RECIPIENT = {
  first_name: 'John',
  last_name: 'Doe',
  phone_number: '5551234567',
  address_line1: '123 Main St',
  postal_code: '33602',
  region_code: 'US',
  district_info: [
    { address_level: 'L1', address_name: 'Florida' },
    { address_level: 'L2', address_name: 'Tampa' },
  ],
};
const ACCOUNT_A = { id: 'acc-a', name: 'Mango', provider: FulfillmentProvider.MANGO, isActive: true, isGlobal: false };
const ACCOUNT_B = { id: 'acc-b', name: 'Sellerwix', provider: FulfillmentProvider.SELLERWIX, isActive: true, isGlobal: false };

const line = (id: string, skuId: string, over: Record<string, unknown> = {}) => ({
  id,
  tiktokLineItemId: `tt-${id}`,
  productId: 'P',
  skuId,
  sellerSku: `S-${skuId}`,
  productName: 'Tee',
  isGift: false,
  ...over,
});
const order = (id: string, items: unknown[], over: Record<string, unknown> = {}) => ({
  id,
  shopId: 'shop-1',
  status: 'AWAITING_SHIPMENT',
  recipientEnc: 'enc',
  recipientMasked: false,
  recipientRegionCode: 'US',
  recipientPostalCode: '33602',
  shippingLabelUrl: null,
  shippingLabelSource: null,
  shippingLabelPackageId: null,
  shippingLabelTrackingNumber: null,
  shippingLabelAt: null,
  packages: [],
  items,
  account: { fulfillmentAccountId: 'acc-a' },
  ...over,
});
const record = (
  podOrderId: string,
  status: FulfillmentStatus,
  account: { id: string; provider: FulfillmentProvider } = ACCOUNT_A,
) => ({
  id: `rec-${podOrderId}-${account.id}`,
  podOrderId,
  accountId: account.id,
  provider: account.provider,
  status,
  source: 'PROVIDER',
  items: [],
  subtotal: null,
  shippingFee: null,
  tax: null,
  total: null,
  currency: 'USD',
  submittedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});
const mapping = (skuId: string) => ({
  id: `map-${skuId}`,
  isActive: true,
  accountId: 'acc-a',
  provider: FulfillmentProvider.MANGO,
  tiktokProductId: 'P',
  tiktokSkuId: skuId,
  sellerSku: `S-${skuId}`,
  legacySharedKey: false,
  providerSku: `M-${skuId}`,
  baseCost: null,
  productionConfig: null,
  productionLine: null,
  placementMap: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

function build(orders: Array<ReturnType<typeof order>>, records: Array<ReturnType<typeof record>>) {
  const recordsOf = (id: string) => records.filter((entry) => entry.podOrderId === id);
  const repo = {
    listAccounts: jest.fn().mockResolvedValue([ACCOUNT_A, ACCOUNT_B]),
    findAccountById: jest.fn((_org: string, id: string) =>
      Promise.resolve([ACCOUNT_A, ACCOUNT_B].find((account) => account.id === id) ?? null),
    ),
    findCurrentByPodOrder: jest.fn((_org: string, id: string) => {
      const list = recordsOf(id);
      return Promise.resolve(
        list.find((entry) => !['DRAFT', 'FAILED', 'CANCELLED', 'REJECTED'].includes(entry.status)) ?? list[0] ?? null,
      );
    }),
    findByPodOrder: jest.fn((_org: string, id: string, provider: FulfillmentProvider) =>
      Promise.resolve(recordsOf(id).find((entry) => entry.provider === provider) ?? null),
    ),
    findBlockingRecordOfOtherProvider: jest.fn((_org: string, id: string, provider: FulfillmentProvider) =>
      Promise.resolve(
        recordsOf(id).find(
          (entry) => entry.provider !== provider && !['DRAFT', 'FAILED', 'CANCELLED', 'REJECTED'].includes(entry.status),
        ) ?? null,
      ),
    ),
    listRecordsByPodOrders: jest.fn((_org: string, ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, recordsOf(id)]))),
    ),
    listMappingsForProducts: jest.fn().mockResolvedValue([mapping('V1')]),
    listProductDesignsForProducts: jest.fn().mockResolvedValue([
      { tiktokProductId: 'P', tiktokSkuId: 'V1', sellerSku: 'S-V1', legacySharedKey: false, placement: 'FRONT', sourceUrl: 'https://cdn/a.png', storageFile: null, id: 'd', version: 1, updatedAt: new Date(0) },
    ]),
    findLatestCancelRequest: jest.fn().mockResolvedValue(null),
    findLatestCancelEvents: jest.fn().mockResolvedValue(new Map()),
  };
  const podOrderRepo = {
    findById: jest.fn((_org: string, id: string) => Promise.resolve(orders.find((entry) => entry.id === id) ?? null)),
    findManyByIds: jest.fn((_org: string, ids: string[]) => Promise.resolve(orders.filter((entry) => ids.includes(entry.id)))),
  };
  const gateway = { isSupported: () => true, placementResolver: jest.fn().mockResolvedValue(undefined) };
  const readiness = new FulfillmentReadinessService(
    { decrypt: () => JSON.stringify(RECIPIENT) } as never,
    new MangoOrderMapper(),
  );
  const designMapper = { toDtoList: (rows: unknown[]) => rows, statusOf: () => 'READY' };
  const service = new FulfillmentService(
    { get: (_key: string, fallback?: string) => fallback ?? '' } as never,
    {} as never,
    repo as never,
    podOrderRepo as never,
    readiness,
    designMapper as never,
    {} as never,
    { assertShopAllowed: jest.fn() } as never,
    gateway as never,
    {} as never,
  );
  return { service, repo, gateway, podOrderRepo };
}

const ORDERS = [
  order('ready', [line('l1', 'V1')]),
  order('no-mapping', [line('l2', 'V9')]),
  order('gift-only', [line('l3', 'G1', { isGift: true, sellerSku: null })]),
  order('held', [line('l4', 'V1')]),
  order('other-provider', [line('l5', 'V1')]),
  order('no-provider', [line('l6', 'V1')], { account: { fulfillmentAccountId: null } }),
];
const RECORDS = [
  record('held', FulfillmentStatus.SHIPPED),
  record('other-provider', FulfillmentStatus.SHIPPED, ACCOUNT_B),
];

describe('FulfillmentService.getStates — trạng thái theo lô cho danh sách đơn', () => {
  it('🔴 ra đúng kết quả của getState cho từng đơn', async () => {
    const { service } = build(ORDERS, RECORDS);
    const batch = await service.getStates(ORG, ORDERS.map((entry) => entry.id), ADMIN);
    for (const entry of ORDERS) {
      expect(batch[entry.id]).toEqual(await service.getState(ORG, entry.id, ADMIN));
    }
    // Bộ dữ liệu thật sự phủ các nhánh khác nhau.
    expect(batch.ready.canFulfill).toBe(true);
    expect(batch['no-mapping'].issues.map((issue) => issue.code)).toContain('MAPPING_MISSING');
    expect(batch['gift-only'].warnings.map((warning) => warning.code)).toContain('PROMOTION_GIFT_NOT_SENT');
    expect(batch.held.fulfillment?.status).toBe('SHIPPED');
    expect(batch['no-provider'].fulfillment).toBeNull();
  });

  it('nạp dữ liệu dùng chung MỘT lần cho cả trang, không theo từng đơn', async () => {
    const { service, repo, gateway, podOrderRepo } = build(ORDERS, RECORDS);
    await service.getStates(ORG, ORDERS.map((entry) => entry.id), ADMIN);
    expect(podOrderRepo.findManyByIds).toHaveBeenCalledTimes(1);
    expect(podOrderRepo.findById).not.toHaveBeenCalled();
    expect(repo.listAccounts).toHaveBeenCalledTimes(1);
    expect(repo.listRecordsByPodOrders).toHaveBeenCalledTimes(1);
    expect(repo.listMappingsForProducts).toHaveBeenCalledTimes(1);
    expect(repo.listProductDesignsForProducts).toHaveBeenCalledTimes(1);
    expect(repo.findCurrentByPodOrder).not.toHaveBeenCalled();
    expect(repo.findByPodOrder).not.toHaveBeenCalled();
    expect(repo.findBlockingRecordOfOtherProvider).not.toHaveBeenCalled();
    // Mỗi tài khoản một lần, dù nhiều đơn dùng chung.
    expect(repo.findAccountById.mock.calls.filter(([, id]) => id === 'acc-a')).toHaveLength(1);
    expect(gateway.placementResolver.mock.calls.filter(([account]) => (account as { id: string }).id === 'acc-a')).toHaveLength(1);
  });

  it('đơn ngoài phạm vi shop hoặc không tồn tại không có trong kết quả', async () => {
    const { service } = build(ORDERS, RECORDS);
    const seller = { allShops: false, accountIds: [], shopIds: ['shop-khac'] };
    await expect(service.getStates(ORG, ['ready'], seller)).resolves.toEqual({});
    const mixed = await service.getStates(ORG, ['ready', 'khong-co'], ADMIN);
    expect(Object.keys(mixed)).toEqual(['ready']);
  });

  it('danh sách rỗng ⇒ không truy vấn gì thêm', async () => {
    const { service, repo } = build([], []);
    await expect(service.getStates(ORG, [], ADMIN)).resolves.toEqual({});
    expect(repo.listAccounts).not.toHaveBeenCalled();
  });
});

describe('FulfillmentService state — đang chờ nhà cung cấp xác nhận huỷ', () => {
  const PENDING_ORDERS = [order('pending', [line('lp', 'V1')]), order('plain', [line('lq', 'V1')])];
  const PENDING_RECORDS = [
    { ...record('pending', FulfillmentStatus.ON_HOLD), providerStatus: 'error' },
    record('plain', FulfillmentStatus.SUBMITTED),
  ];

  it('🔴 CANCEL_SUCCESS gần đây ⇒ cancelPending = true, canCancel = false (getState và getStates giống nhau)', async () => {
    const { service, repo } = build(PENDING_ORDERS, PENDING_RECORDS);
    repo.findLatestCancelEvents.mockImplementation((_org: string, ids: string[]) =>
      Promise.resolve(
        new Map(
          ids
            .filter((id) => id === 'rec-pending-acc-a')
            .map((id) => [id, { eventType: 'CANCEL_SUCCESS', createdAt: new Date(Date.now() - 60_000) }]),
        ),
      ),
    );

    const batch = await service.getStates(ORG, ['pending', 'plain'], ADMIN);
    expect(batch.pending).toMatchObject({ cancelPending: true, canCancel: false });
    expect(batch.plain).toMatchObject({ cancelPending: false, canCancel: true });
    expect(await service.getState(ORG, 'pending', ADMIN)).toMatchObject({ cancelPending: true, canCancel: false });
    // Cả trang: MỘT truy vấn nhật ký huỷ (không theo từng đơn).
    repo.findLatestCancelEvents.mockClear();
    await service.getStates(ORG, ['pending', 'plain'], ADMIN);
    expect(repo.findLatestCancelEvents).toHaveBeenCalledTimes(1);
  });
});
