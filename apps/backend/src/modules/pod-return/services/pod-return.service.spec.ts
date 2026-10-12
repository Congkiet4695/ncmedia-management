import { PodReturnStatusGroup, Prisma } from '@prisma/client';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { PodAccessScopeService, PodShopForbiddenException } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodReturnNotFoundException } from '../exceptions/pod-return.exceptions';
import { PodReturnService } from './pod-return.service';

const ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const SELLER_A = { allShops: false, accountIds: ['acc-a'], shopIds: ['shop-a'] };

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    organizationId: 'org-1',
    accountId: 'acc-b',
    shopId: 'shop-b',
    orderId: null,
    tiktokReturnId: 'r1',
    tiktokOrderId: 'o1',
    returnType: 'RETURN_AND_REFUND',
    returnStatus: 'AWAITING_BUYER_SHIP',
    statusGroup: PodReturnStatusGroup.PROCESSING,
    refundCompleted: false,
    returnReason: 'code',
    returnReasonText: 'Wrong size',
    role: 'BUYER',
    arbitrationStatus: null,
    sellerProposedReturnType: null,
    partialRefundAmount: null,
    currency: 'USD',
    refundTotal: new Prisma.Decimal('15'),
    refundSubtotal: new Prisma.Decimal('15'),
    refundShippingFee: null,
    refundTax: null,
    paidAmount: new Prisma.Decimal('20'),
    itemQuantity: 2,
    returnTrackingNumber: null,
    returnProviderName: null,
    tiktokUpdateTime: BigInt(200),
    requestedAt: new Date('2026-10-01T00:00:00Z'),
    tiktokUpdatedAt: new Date('2026-10-02T00:00:00Z'),
    lastSyncedAt: new Date('2026-10-02T00:00:00Z'),
    history: null,
    historySyncedAt: null,
    historyUpdateTime: null,
    shop: { name: 'Shop B' },
    account: { accountName: 'Acc B' },
    items: [
      { returnLineItemId: 'l1', orderLineItemId: 'ol1', productName: 'Tee', skuId: 's1', skuName: 'M', sellerSku: 'T-M', productImageUrl: null, currency: 'USD', refundTotal: new Prisma.Decimal('7.5'), paidAmount: new Prisma.Decimal('10') },
      { returnLineItemId: 'l2', orderLineItemId: 'ol2', productName: 'Tee', skuId: 's1', skuName: 'M', sellerSku: 'T-M', productImageUrl: null, currency: 'USD', refundTotal: new Prisma.Decimal('7.5'), paidAmount: new Prisma.Decimal('10') },
    ],
    ...over,
  };
}

function build(found = row()) {
  const repo = {
    findById: jest.fn(() => Promise.resolve(found)),
    findPage: jest.fn(() => Promise.resolve({ items: [found], total: 1 })),
    settledRefundByOrder: jest.fn(() => Promise.resolve(new Map([['o1', new Prisma.Decimal('11.6')]]))),
    saveHistory: jest.fn(() => Promise.resolve()),
    summary: jest.fn(),
  };
  const api = { getReturnRecords: jest.fn() };
  const sync = {
    resolveContext: jest.fn(() => Promise.resolve({ accessToken: 't', shopCipher: 'c' })),
    runForShops: jest.fn(() => Promise.resolve([])),
  };
  const config = { get: jest.fn((_k: string, d: unknown) => d) };
  const service = new PodReturnService(
    repo as never,
    config as never,
    new PodAccessScopeService({} as never),
    {} as never,
    sync as never,
    api as never,
  );
  return { service, repo, api, sync };
}

describe('PodReturnService — phân quyền', () => {
  it('Seller KHÔNG đọc được yêu cầu của shop khác (đoán id ⇒ 404, không lộ sự tồn tại)', async () => {
    const h = build();
    await expect(h.service.findOne('org-1', 'req-1', SELLER_A)).rejects.toBeInstanceOf(PodReturnNotFoundException);
    await expect(h.service.history('org-1', 'req-1', SELLER_A)).rejects.toBeInstanceOf(PodReturnNotFoundException);
    expect(h.api.getReturnRecords).not.toHaveBeenCalled();
  });

  it('Admin đọc được; truy vấn luôn kèm organizationId của người dùng', async () => {
    const h = build();
    const detail = await h.service.findOne('org-1', 'req-1', ADMIN);
    expect(h.repo.findById).toHaveBeenCalledWith('org-1', 'req-1');
    expect(detail).toMatchObject({ returnType: 'RETURN_AND_REFUND', reasonText: 'Wrong size', paidAmount: '20.00', requestedRefund: '15.00' });
  });

  it('Seller lọc theo shop ngoài phạm vi ⇒ 403 (không âm thầm trả rỗng)', async () => {
    const h = build();
    await expect(h.service.findAll('org-1', { shopId: 'shop-b' }, SELLER_A)).rejects.toBeInstanceOf(
      PodShopForbiddenException,
    );
  });

  it('Seller xem danh sách ⇒ phạm vi shop được truyền xuống WHERE', async () => {
    const h = build(row({ shopId: 'shop-a' }));
    await h.service.findAll('org-1', {}, SELLER_A);
    expect(h.repo.findPage).toHaveBeenCalledWith('org-1', expect.objectContaining({ shopScope: ['shop-a'] }), expect.anything());
  });

  it('Seller đồng bộ thủ công shop ngoài phạm vi ⇒ 403, không chạy đồng bộ', async () => {
    const h = build();
    await expect(h.service.triggerSync('org-1', 'u', SELLER_A, 'shop-b')).rejects.toBeInstanceOf(PodShopForbiddenException);
    expect(h.sync.runForShops).not.toHaveBeenCalled();
  });

  it('Seller đồng bộ "tất cả" ⇒ chỉ các shop được gán', async () => {
    const h = build();
    await h.service.triggerSync('org-1', 'u', SELLER_A);
    expect(h.sync.runForShops).toHaveBeenCalledWith('org-1', ['shop-a'], 'u');
  });
});

describe('PodReturnService — hiển thị', () => {
  it('Paid Amount và Refund Amount tách bạch; tiền quyết toán là cấp ĐƠN; dòng gộp theo SKU kèm số lượng', async () => {
    const h = build();
    const page = await h.service.findAll('org-1', {}, ADMIN);
    expect(page.items[0]).toMatchObject({
      paidAmount: '20.00',
      requestedRefund: '15.00',
      orderSettledRefund: '11.60',
      refundCompleted: false,
      itemGroups: [{ productName: 'Tee', sellerSku: 'T-M', quantity: 2 }],
    });
  });
});

describe('PodReturnService.history', () => {
  it('đọc từ TikTok, lưu lại, trả đúng các mục TikTok trả', async () => {
    const h = build(row({ shopId: 'shop-a' }));
    h.api.getReturnRecords.mockResolvedValue({ data: [{ createTime: 100, event: 'BUYER_CREATE', role: 'BUYER' }] });
    const result = await h.service.history('org-1', 'req-1', SELLER_A);
    expect(result).toMatchObject({ live: true, errorCode: null });
    expect(result.entries).toEqual([
      expect.objectContaining({ event: 'BUYER_CREATE', role: 'BUYER', time: new Date(100_000).toISOString() }),
    ]);
    expect(h.repo.saveHistory).toHaveBeenCalled();
  });

  it('TikTok lỗi (thiếu scope) ⇒ trả bản đã lưu (rỗng) + mã lỗi, KHÔNG dựng lịch sử', async () => {
    const h = build(row({ shopId: 'shop-a' }));
    h.api.getReturnRecords.mockRejectedValue(new TiktokClientError(TiktokErrorClass.AUTH, 105005, 'scope', 200));
    const result = await h.service.history('org-1', 'req-1', SELLER_A);
    expect(result).toEqual({ entries: [], syncedAt: null, live: false, errorCode: 'RETURN_SCOPE_MISSING' });
  });

  it('bản lưu còn mới và yêu cầu chưa đổi ⇒ không gọi lại TikTok', async () => {
    const stored = [{ time: null, event: 'X', role: null, description: null, note: null, reason: null, attachments: 0 }];
    const h = build(row({ shopId: 'shop-a', history: stored, historySyncedAt: new Date(), historyUpdateTime: BigInt(200) }));
    const result = await h.service.history('org-1', 'req-1', SELLER_A);
    expect(result).toMatchObject({ live: false, entries: stored });
    expect(h.api.getReturnRecords).not.toHaveBeenCalled();
  });
});
