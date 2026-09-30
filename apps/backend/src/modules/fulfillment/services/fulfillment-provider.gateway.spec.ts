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
import { FulfillmentNotificationService } from './fulfillment-notification.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { FulfillmentOperationInProgressException } from '../exceptions/fulfillment.exceptions';

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
  // Khoá trong bộ nhớ: giữ đúng ngữ nghĩa "đang có người giữ ⇒ null" của DistributedLockService.
  const held = new Set<string>();
  const lock = {
    withLock: jest.fn(async (key: string, _ttl: number, task: () => Promise<unknown>) => {
      if (held.has(key)) return null;
      held.add(key);
      try {
        return await task();
      } finally {
        held.delete(key);
      }
    }),
  };
  const notifications = {
    fulfilled: jest.fn().mockResolvedValue(undefined),
    cancelled: jest.fn().mockResolvedValue(undefined),
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
    notifications as unknown as FulfillmentNotificationService,
    lock as unknown as DistributedLockService,
  );
  return { gateway, mango, sellerwix, notifications, lock };
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

    expect(sellerwix.cancel).toHaveBeenCalledWith('org', 'user', 'pod-1', 'khách đổi ý', undefined);
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

describe('FulfillmentProviderGateway — thông báo Telegram', () => {
  it('TEST 12 — fulfill thành công ⇒ phát thông báo với ĐÚNG bản ghi adapter trả về', async () => {
    const { gateway, mango, notifications } = build();
    const record = { id: 'fo-1', provider: 'MANGO', status: 'SUBMITTED' };
    mango.fulfill.mockResolvedValueOnce(record);

    await gateway.fulfill('org', 'admin', 'pod-1', FulfillmentTrigger.MANUAL, { fulfillmentAccountId: 'acc-mango' }, ALL);

    expect(notifications.fulfilled).toHaveBeenCalledWith(record, 'admin', FulfillmentTrigger.MANUAL);
  });

  it('TEST 13 — nhà cung cấp lỗi (adapter ném) ⇒ KHÔNG phát thông báo thành công, lỗi giữ nguyên', async () => {
    const { gateway, mango, notifications } = build();
    mango.fulfill.mockRejectedValueOnce(new Error('provider rejected'));

    await expect(
      gateway.fulfill('org', 'admin', 'pod-1', FulfillmentTrigger.MANUAL, { fulfillmentAccountId: 'acc-mango' }, ALL),
    ).rejects.toThrow('provider rejected');
    expect(notifications.fulfilled).not.toHaveBeenCalled();
  });

  it('TEST 14 — huỷ xong ⇒ chuyển bản ghi + lý do cho bộ phát thông báo', async () => {
    const { gateway, mango, notifications } = build({
      current: { accountId: 'acc-mango', provider: FulfillmentProvider.MANGO },
    });
    const record = { id: 'fo-1', status: 'CANCELLED' };
    mango.cancel.mockResolvedValueOnce(record);

    await gateway.cancel('org', 'admin', 'pod-1', ALL, 'khách huỷ');

    expect(notifications.cancelled).toHaveBeenCalledWith(record, 'admin', 'khách huỷ');
  });

  it('TEST 15 — huỷ thất bại (adapter ném) ⇒ KHÔNG phát thông báo huỷ', async () => {
    const { gateway, mango, notifications } = build({
      current: { accountId: 'acc-mango', provider: FulfillmentProvider.MANGO },
    });
    mango.cancel.mockRejectedValueOnce(new Error('already shipped'));

    await expect(gateway.cancel('org', 'admin', 'pod-1', ALL)).rejects.toThrow('already shipped');
    expect(notifications.cancelled).not.toHaveBeenCalled();
  });
});

describe('FulfillmentProviderGateway — Seller huỷ fulfillment', () => {
  const CURRENT = { accountId: 'acc-mango', provider: FulfillmentProvider.MANGO };

  it('Seller huỷ đơn thuộc shop được gán ⇒ đi qua adapter của bản ghi, ghi kèm role để audit', async () => {
    const { gateway, mango, notifications } = build({ current: CURRENT });
    const record = { id: 'fo-1', status: 'CANCELLED' };
    mango.cancel.mockResolvedValueOnce(record);

    await expect(gateway.cancel('org', 'seller-1', 'pod-1', OWN_SELLER, 'sai size', 'EMPLOYEE')).resolves.toBe(record);

    expect(mango.cancel).toHaveBeenCalledWith('org', 'seller-1', 'pod-1', 'sai size', 'EMPLOYEE');
    expect(notifications.cancelled).toHaveBeenCalledWith(record, 'seller-1', 'sai size');
  });

  it('Sellerwix: huỷ đi adapter Sellerwix, Mango không bị gọi (không hard-code Mango)', async () => {
    const { gateway, mango, sellerwix } = build({
      current: { accountId: 'acc-swx', provider: FulfillmentProvider.SELLERWIX },
    });
    await gateway.cancel('org', 'seller-1', 'pod-1', OWN_SELLER, undefined, 'EMPLOYEE');
    expect(sellerwix.cancel).toHaveBeenCalledTimes(1);
    expect(mango.cancel).not.toHaveBeenCalled();
  });

  it('Seller huỷ đơn của tổ chức khác (không tìm thấy trong tổ chức) ⇒ 404, nhà cung cấp không bị gọi', async () => {
    const { gateway, mango } = build({ current: CURRENT, orderMissing: true });
    await expect(gateway.cancel('org', 'seller-1', 'pod-x', OWN_SELLER)).rejects.toBeInstanceOf(
      FulfillmentOrderNotFoundException,
    );
    expect(mango.cancel).not.toHaveBeenCalled();
  });

  it('đơn chưa từng fulfill ⇒ 404', async () => {
    const { gateway } = build({ current: null });
    await expect(gateway.cancel('org', 'admin', 'pod-1', ALL)).rejects.toBeInstanceOf(
      FulfillmentOrderNotFoundException,
    );
  });

  it('huỷ ĐỒNG THỜI (Admin + Seller cùng bấm) ⇒ chỉ một lần gọi nhà cung cấp, bên sau nhận 409', async () => {
    const { gateway, mango } = build({ current: CURRENT });
    let release!: (value: unknown) => void;
    mango.cancel.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const first = gateway.cancel('org', 'admin', 'pod-1', ALL);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(gateway.cancel('org', 'seller-1', 'pod-1', OWN_SELLER)).rejects.toBeInstanceOf(
      FulfillmentOperationInProgressException,
    );
    release({ id: 'fo-1', status: 'CANCELLED' });
    await first;

    expect(mango.cancel).toHaveBeenCalledTimes(1);
  });

  it('huỷ dùng CHUNG khoá với gửi đơn (không huỷ chồng lên một lượt Fulfill đang chạy)', async () => {
    const { gateway, lock } = build({ current: CURRENT });
    await gateway.cancel('org', 'admin', 'pod-1', ALL);
    expect(lock.withLock).toHaveBeenCalledWith('fulfillment:fulfill:pod-1', expect.any(Number), expect.any(Function));
  });
});
