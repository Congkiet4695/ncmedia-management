import { FulfillmentProvider, FulfillmentStatus, FulfillmentTrigger } from '@prisma/client';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import {
  FulfillmentOperationNotSupportedException,
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

function build(options: { accounts?: unknown[]; current?: unknown } = {}) {
  const accounts = (options.accounts ?? [MANGO, SELLERWIX]) as Array<{ id: string }>;
  const repo = {
    findAccountById: jest.fn((_org: string, id: string) =>
      Promise.resolve(accounts.find((account) => account.id === id) ?? null),
    ),
    findCurrentByPodOrder: jest.fn().mockResolvedValue(options.current ?? null),
    listAccounts: jest.fn().mockResolvedValue(accounts),
  } as unknown as FulfillmentRepository;
  const podOrderRepo = {
    findById: jest.fn().mockResolvedValue({ id: 'pod-1', account: { fulfillmentAccountId: null } }),
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
  );
  return { gateway, mango, sellerwix };
}

describe('FulfillmentProviderGateway', () => {
  it('CASE 12 — chọn tài khoản Sellerwix ⇒ đi qua adapter Sellerwix, Mango không được gọi', async () => {
    const { gateway, mango, sellerwix } = build();

    await gateway.fulfill('org', 'user', 'pod-1', FulfillmentTrigger.MANUAL, {
      fulfillmentAccountId: 'acc-swx',
      shippingMethod: 'US Standard',
    });

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

    await gateway.fulfill('org', 'user', 'pod-1', FulfillmentTrigger.RETRY, {});

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
      gateway.fulfill('org', 'user', 'pod-1', FulfillmentTrigger.MANUAL, {}),
    ).rejects.toBeInstanceOf(FulfillmentProviderNotSelectedException);
  });

  it('nhà cung cấp chưa tích hợp ⇒ không được đếm là "khả dụng" và không có adapter', async () => {
    const { gateway, sellerwix } = build({ accounts: [SELLERWIX, PRINTIFY] });

    await gateway.fulfill('org', 'user', 'pod-1', FulfillmentTrigger.MANUAL, {});
    expect(sellerwix.fulfill).toHaveBeenCalled();
    expect(() => gateway.adapterFor(FulfillmentProvider.PRINTIFY)).toThrow(
      FulfillmentProviderNotSupportedException,
    );
  });

  it('huỷ đi tới nhà cung cấp của bản ghi hiện hành', async () => {
    const { gateway, sellerwix, mango } = build({
      current: { accountId: 'acc-swx', provider: FulfillmentProvider.SELLERWIX },
    });

    await gateway.cancel('org', 'user', 'pod-1', 'khách đổi ý');

    expect(sellerwix.cancel).toHaveBeenCalledWith('org', 'user', 'pod-1', 'khách đổi ý');
    expect(mango.cancel).not.toHaveBeenCalled();
  });

  it('sửa đơn đã gửi: Sellerwix không có API ⇒ báo rõ, không gọi nhầm Mango', async () => {
    const { gateway, mango } = build({
      current: { accountId: 'acc-swx', provider: FulfillmentProvider.SELLERWIX },
    });

    await expect(
      gateway.updateAtProvider('org', 'user', 'pod-1', { note: 'x' }),
    ).rejects.toBeInstanceOf(FulfillmentOperationNotSupportedException);
    expect(mango.updateAtProvider).not.toHaveBeenCalled();
  });
});
