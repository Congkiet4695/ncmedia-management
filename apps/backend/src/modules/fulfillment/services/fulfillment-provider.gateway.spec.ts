import { FulfillmentProvider, FulfillmentStatus, FulfillmentTrigger } from '@prisma/client';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import {
  PodAccessScopeService,
  PodShopForbiddenException,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import {
  FulfillmentOperationNotSupportedException,
  FulfillmentOrderNotFoundException,
  FulfillmentProviderNotSelectedException,
  FulfillmentProviderNotSupportedException,
} from '../exceptions/fulfillment.exceptions';
import { MangoFulfillmentService } from '../mango/services/mango-fulfillment.service';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { SellerwixFulfillmentService } from '../sellerwix/services/sellerwix-fulfillment.service';
import { FulfillmentProviderGateway } from './fulfillment-provider.gateway';

/**
 * **Gateway chọn adapter theo `account.provider`.**
 * Chọn Sellerwix ⇒ TOÀN BỘ request đi qua Sellerwix, không bao giờ lấy cấu hình Mango.
 */

const MANGO = {
  id: 'acc-mango',
  provider: FulfillmentProvider.MANGO,
  isActive: true,
  name: 'Mango',
};
const SELLERWIX = {
  id: 'acc-swx',
  provider: FulfillmentProvider.SELLERWIX,
  isActive: true,
  name: 'Sellerwix',
};
const PRINTIFY = {
  id: 'acc-pf',
  provider: FulfillmentProvider.PRINTIFY,
  isActive: true,
  name: 'Printify',
};

/** Admin: mọi shop. */
const ALL: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
/** Seller được gán đúng shop của đơn. */
const OWN_SELLER: PodAccessScope = { allShops: false, accountIds: ['tt-acc-1'], shopIds: ['shop-1'] };
/** Seller của shop KHÁC. */
const OTHER_SELLER: PodAccessScope = { allShops: false, accountIds: ['tt-acc-2'], shopIds: ['shop-2'] };

function build(options: { accounts?: unknown[]; current?: unknown; orderMissing?: boolean } = {}) {
  const accounts = (options.accounts ?? [MANGO, SELLERWIX]) as Array<{ id: string }>;
  const repo = {
    findAccountById: jest.fn((_org: string, id: string) =>
      Promise.resolve(accounts.find((account) => account.id === id) ?? null),
    ),
    findCurrentByPodOrder: jest.fn().mockResolvedValue(options.current ?? null),
    listAccounts: jest.fn().mockResolvedValue(accounts),
  } as unknown as FulfillmentRepository;
  const podOrderRepo = {
    findById: jest.fn().mockResolvedValue(
      options.orderMissing ? null : { id: 'pod-1', shopId: 'shop-1', account: { fulfillmentAccountId: null } },
    ),
  } as unknown as PodOrderRepository;
  const mango = {
    fulfill: jest.fn().mockResolvedValue({ provider: 'MANGO' }),
    cancel: jest.fn().mockResolvedValue({}),
    updateAtProvider: jest.fn().mockResolvedValue({}),
  };
  const sellerwix = {
    fulfill: jest.fn().mockResolvedValue({ provider: 'SELLERWIX' }),
    cancel: jest.fn().mockResolvedValue({}),
  };
  const gateway = new FulfillmentProviderGateway(
    repo,
    podOrderRepo,
    { provider: FulfillmentProvider.MANGO, ...mango } as unknown as MangoFulfillmentService,
    {
      provider: FulfillmentProvider.SELLERWIX,
      ...sellerwix,
    } as unknown as SellerwixFulfillmentService,
    // `assertShopAllowed` là phép so thuần — không cần database.
    new PodAccessScopeService({} as never),
  );
  return { gateway, mango, sellerwix };
}

describe('FulfillmentProviderGateway', () => {
  it('CASE 12 — chọn tài khoản Sellerwix ⇒ đi qua adapter Sellerwix, Mango không được gọi', async () => {
    const { gateway, mango, sellerwix } = build();

    await gateway.fulfill('org', 'user', 'pod-1', FulfillmentTrigger.MANUAL, {
      fulfillmentAccountId: 'acc-swx',
      shippingMethod: 'US Standard',
    }, ALL);

    expect(sellerwix.fulfill).toHaveBeenCalledWith(
      'org',
      'user',
      'pod-1',
      FulfillmentTrigger.MANUAL,
      {
        fulfillmentAccountId: 'acc-swx',
        shippingMethod: 'US Standard',
      },
    );
    expect(mango.fulfill).not.toHaveBeenCalled();
  });

  it('Retry không chọn lại ⇒ dùng đúng nhà cung cấp của bản ghi hiện hành', async () => {
    const { gateway, sellerwix } = build({
      current: {
        accountId: 'acc-swx',
        provider: FulfillmentProvider.SELLERWIX,
        status: FulfillmentStatus.FAILED,
      },
    });

    await gateway.fulfill('org', 'user', 'pod-1', FulfillmentTrigger.RETRY, {}, ALL);

    expect(sellerwix.fulfill).toHaveBeenCalledWith(
      'org',
      'user',
      'pod-1',
      FulfillmentTrigger.RETRY,
      expect.objectContaining({ fulfillmentAccountId: 'acc-swx' }),
    );
  });

  it('nhiều nhà cung cấp mà không chọn ⇒ hỏi thẳng, không tự đoán', async () => {
    const { gateway } = build();
    await expect(
      gateway.fulfill('org', 'user', 'pod-1', FulfillmentTrigger.MANUAL, {}, ALL),
    ).rejects.toBeInstanceOf(FulfillmentProviderNotSelectedException);
  });

  it('nhà cung cấp chưa tích hợp ⇒ không được đếm là "khả dụng" và không có adapter', async () => {
    const { gateway, sellerwix } = build({ accounts: [SELLERWIX, PRINTIFY] });

    await gateway.fulfill('org', 'user', 'pod-1', FulfillmentTrigger.MANUAL, {}, ALL);
    expect(sellerwix.fulfill).toHaveBeenCalled();
    expect(() => gateway.adapterFor(FulfillmentProvider.PRINTIFY)).toThrow(
      FulfillmentProviderNotSupportedException,
    );
  });

  it('huỷ đi tới nhà cung cấp của bản ghi hiện hành', async () => {
    const { gateway, sellerwix, mango } = build({
      current: { accountId: 'acc-swx', provider: FulfillmentProvider.SELLERWIX },
    });

    await gateway.cancel('org', 'user', 'pod-1', ALL, 'khách đổi ý');

    expect(sellerwix.cancel).toHaveBeenCalledWith('org', 'user', 'pod-1', 'khách đổi ý');
    expect(mango.cancel).not.toHaveBeenCalled();
  });

  it('sửa đơn đã gửi: Sellerwix không có API ⇒ báo rõ, không gọi nhầm Mango', async () => {
    const { gateway, mango } = build({
      current: { accountId: 'acc-swx', provider: FulfillmentProvider.SELLERWIX },
    });

    await expect(
      gateway.updateAtProvider('org', 'user', 'pod-1', { note: 'x' }, ALL),
    ).rejects.toBeInstanceOf(FulfillmentOperationNotSupportedException);
    expect(mango.updateAtProvider).not.toHaveBeenCalled();
  });
});

describe('FulfillmentProviderGateway — phạm vi shop (Seller)', () => {
  it('Seller fulfill đơn của CHÍNH shop mình ⇒ đi tiếp tới nhà cung cấp', async () => {
    const { gateway, sellerwix } = build();

    await gateway.fulfill('org', 'seller', 'pod-1', FulfillmentTrigger.MANUAL, { fulfillmentAccountId: 'acc-swx' }, OWN_SELLER);

    expect(sellerwix.fulfill).toHaveBeenCalledTimes(1);
  });

  it('🔴 Seller gọi thẳng API với ID đơn của shop KHÁC ⇒ 403, KHÔNG gọi nhà cung cấp nào', async () => {
    const { gateway, sellerwix, mango } = build();

    await expect(
      gateway.fulfill('org', 'seller', 'pod-1', FulfillmentTrigger.MANUAL, { fulfillmentAccountId: 'acc-swx' }, OTHER_SELLER),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);
    expect(sellerwix.fulfill).not.toHaveBeenCalled();
    expect(mango.fulfill).not.toHaveBeenCalled();
  });

  it('Retry đơn của shop khác ⇒ 403', async () => {
    const { gateway, sellerwix } = build({
      current: { accountId: 'acc-swx', provider: FulfillmentProvider.SELLERWIX, status: FulfillmentStatus.FAILED },
    });

    await expect(
      gateway.fulfill('org', 'seller', 'pod-1', FulfillmentTrigger.RETRY, {}, OTHER_SELLER),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);
    expect(sellerwix.fulfill).not.toHaveBeenCalled();
  });

  it('đơn của TỔ CHỨC khác (không tìm thấy trong tổ chức) ⇒ 404, kể cả với Admin', async () => {
    const { gateway, mango, sellerwix } = build({ orderMissing: true });

    await expect(
      gateway.fulfill('org', 'admin', 'pod-x', FulfillmentTrigger.MANUAL, { fulfillmentAccountId: 'acc-mango' }, ALL),
    ).rejects.toBeInstanceOf(FulfillmentOrderNotFoundException);
    expect(mango.fulfill).not.toHaveBeenCalled();
    expect(sellerwix.fulfill).not.toHaveBeenCalled();
  });

  it('huỷ / sửa đơn của shop khác ⇒ 403, nhà cung cấp không bị gọi', async () => {
    const { gateway, mango, sellerwix } = build({
      current: { accountId: 'acc-mango', provider: FulfillmentProvider.MANGO },
    });

    await expect(gateway.cancel('org', 'seller', 'pod-1', OTHER_SELLER, 'x')).rejects.toBeInstanceOf(PodShopForbiddenException);
    await expect(gateway.updateAtProvider('org', 'seller', 'pod-1', { note: 'x' }, OTHER_SELLER)).rejects.toBeInstanceOf(PodShopForbiddenException);
    expect(mango.cancel).not.toHaveBeenCalled();
    expect(mango.updateAtProvider).not.toHaveBeenCalled();
    expect(sellerwix.cancel).not.toHaveBeenCalled();
  });

  it('Seller chọn nhà cung cấp KHÔNG thuộc tổ chức (id đoán được) ⇒ bị từ chối, không gửi', async () => {
    const { gateway, mango, sellerwix } = build();

    await expect(
      gateway.fulfill('org', 'seller', 'pod-1', FulfillmentTrigger.MANUAL, { fulfillmentAccountId: 'acc-of-other-org' }, OWN_SELLER),
    ).rejects.toMatchObject({ status: 404 });
    expect(mango.fulfill).not.toHaveBeenCalled();
    expect(sellerwix.fulfill).not.toHaveBeenCalled();
  });
});
