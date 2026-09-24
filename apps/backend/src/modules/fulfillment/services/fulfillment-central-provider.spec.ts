import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, FulfillmentStatus, FulfillmentTrigger } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import { POD_SCOPE_SYSTEM, type PodAccessScopeService } from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import { StorageMapper } from '../../storage/storage.mapper';
import {
  FulfillmentAccountNotFoundException,
  FulfillmentProviderNotSelectedException,
} from '../exceptions/fulfillment.exceptions';
import { MangoApiClient } from '../mango/clients/mango-api.client';
import { MangoOrderMapper } from '../mango/mappers/mango-order.mapper';
import { MangoCredentialService } from '../mango/services/mango-credential.service';
import { MangoFulfillmentService } from '../mango/services/mango-fulfillment.service';
import { ProductDesignMapper } from '../mappers/product-design.mapper';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { FulfillmentOptionsService } from './fulfillment-options.service';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';
import { FulfillmentService } from './fulfillment.service';

/**
 * **Nhà cung cấp DÙNG CHUNG + chọn nhà cung cấp khi gửi đơn.**
 *
 * ```
 *   Super Admin ──▶ tài khoản is_global = true ──▶ MỘT bản danh mục
 *                                                     ↑
 *                Organization A · B · C  đọc cùng bản đó, và CHỌN nhà cung cấp khi gửi
 * ```
 *
 * Hai luật được khoá lại ở đây:
 *  1. Phạm vi truy cập = tài khoản của CHÍNH tổ chức **hoặc** tài khoản dùng chung.
 *  2. Nhà cung cấp dùng để gửi = thứ NGƯỜI DÙNG CHỌN, không phải thứ suy ra từ TikTok Account.
 */

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const OWN_ACCOUNT = {
  id: 'acc-own',
  organizationId: ORG_A,
  name: 'Mango riêng của A',
  provider: FulfillmentProvider.MANGO,
  isActive: true,
  isGlobal: false,
  apiKeyEnc: 'enc:key-a',
  baseUrlOverride: 'https://v3.mangoteeprints.com/api/public/v1',
  defaultProductionLine: null,
  defaultShippingMethod: 'standard',
  defaultFacility: null,
};

const GLOBAL_ACCOUNT = {
  ...OWN_ACCOUNT,
  id: 'acc-global',
  organizationId: 'org-platform',
  name: 'MangoTeePrints (dùng chung)',
  isGlobal: true,
  apiKeyEnc: 'enc:key-platform',
};

// ---------------------------------------------------------------------------
// 1. Phạm vi: tài khoản dùng chung mở cho MỌI tổ chức
// ---------------------------------------------------------------------------

describe('FulfillmentRepository.usableAccountWhere', () => {
  it('🔴 gồm tài khoản của CHÍNH tổ chức và tài khoản DÙNG CHUNG — không gồm tài khoản riêng của tổ chức khác', () => {
    const where = FulfillmentRepository.usableAccountWhere(ORG_A);

    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual([{ organizationId: ORG_A }, { isGlobal: true }]);
  });

  it('tổ chức khác nhau ⇒ vế "của chính tổ chức" đổi theo, vế dùng chung giữ nguyên', () => {
    expect(FulfillmentRepository.usableAccountWhere(ORG_B).OR).toEqual([
      { organizationId: ORG_B },
      { isGlobal: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. `getState`: danh sách nhà cung cấp + nhà cung cấp hiệu lực
// ---------------------------------------------------------------------------

function buildStateService(
  accounts: Array<Record<string, unknown>>,
  options: { assignedAccountId?: string | null } = {},
) {
  const order = {
    id: 'order-1',
    shopId: 'shop-1',
    status: 'AWAITING_SHIPMENT',
    recipientMasked: false,
    shippingLabelUrl: null,
    shippingLabelSource: null,
    shippingLabelPackageId: null,
    shippingLabelTrackingNumber: null,
    shippingLabelAt: null,
    packages: [],
    account: {
      fulfillmentAccountId:
        options.assignedAccountId === undefined ? null : options.assignedAccountId,
    },
    items: [{ id: 'item-1', productId: 'TT-P1', sellerSku: 'SELLER-1', skuId: 'TT-S1' }],
  } as unknown as PodOrderWithRelations;

  const repo = {
    findByPodOrder: jest.fn().mockResolvedValue(null),
    findAccountById: jest.fn((_org: string, id: string) =>
      Promise.resolve(accounts.find((entry) => entry.id === id) ?? null),
    ),
    listAccounts: jest.fn().mockResolvedValue(accounts),
    listMappingsForOrganization: jest.fn().mockResolvedValue([]),
    listProductDesigns: jest.fn().mockResolvedValue([]),
  } as unknown as FulfillmentRepository;

  const service = new FulfillmentService(
    { get: (_key: string, fallback?: string) => fallback ?? '' } as unknown as ConfigService,
    { user: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService,
    repo,
    { findById: jest.fn().mockResolvedValue(order) } as unknown as PodOrderRepository,
    { check: jest.fn().mockReturnValue({ ready: true, issues: [] }) } as unknown as FulfillmentReadinessService,
    new ProductDesignMapper({
      buildDownloadUrl: (id: string) => `/api/v1/storage/${id}/download`,
    } as unknown as StorageMapper),
    { encrypt: (v: string) => v, decrypt: (v: string) => v } as unknown as TiktokEncryptionService,
    { assertShopAllowed: jest.fn() } as unknown as PodAccessScopeService,
  );

  return { service, repo: repo as unknown as Record<string, jest.Mock> };
}

describe('FulfillmentService.getState — chọn nhà cung cấp', () => {
  it('CASE 7/8/9 — tổ chức nào cũng thấy tài khoản DÙNG CHUNG trong danh sách chọn', async () => {
    const { service } = buildStateService([GLOBAL_ACCOUNT]);

    const state = await service.getState(ORG_B, 'order-1', POD_SCOPE_SYSTEM);

    expect(state.availableProviders).toHaveLength(1);
    expect(state.availableProviders[0]).toMatchObject({
      id: 'acc-global',
      name: 'MangoTeePrints (dùng chung)',
      isGlobal: true,
    });
    // Chỉ có MỘT nhà cung cấp ⇒ dùng luôn, không bắt gán vào TikTok Account.
    expect(state.provider?.id).toBe('acc-global');
  });

  it('🔴 người dùng CHỌN nhà cung cấp ⇒ trạng thái tính theo đúng nhà cung cấp đó', async () => {
    const { service } = buildStateService([OWN_ACCOUNT, GLOBAL_ACCOUNT], {
      assignedAccountId: 'acc-own',
    });

    const state = await service.getState(ORG_A, 'order-1', POD_SCOPE_SYSTEM, FulfillmentProvider.MANGO, 'acc-global');

    expect(state.provider?.id).toBe('acc-global');
    expect(state.availableProviders.map((entry) => entry.id)).toEqual(['acc-own', 'acc-global']);
  });

  it('không chọn gì + có nhà cung cấp gán sẵn ở TikTok Account ⇒ vẫn dùng nhà cung cấp cũ (tương thích ngược)', async () => {
    const { service } = buildStateService([OWN_ACCOUNT, GLOBAL_ACCOUNT], {
      assignedAccountId: 'acc-own',
    });

    const state = await service.getState(ORG_A, 'order-1', POD_SCOPE_SYSTEM);

    expect(state.provider?.id).toBe('acc-own');
    expect(
      state.availableProviders.find((entry) => entry.id === 'acc-own')?.isAssignedToAccount,
    ).toBe(true);
  });

  it('nhiều nhà cung cấp mà không chọn ⇒ nói thẳng "chọn đi", KHÔNG tự đoán', async () => {
    const { service } = buildStateService([OWN_ACCOUNT, GLOBAL_ACCOUNT]);

    const state = await service.getState(ORG_A, 'order-1', POD_SCOPE_SYSTEM);

    expect(state.canFulfill).toBe(false);
    expect(state.issues[0]).toMatchObject({ section: 'PROVIDER', code: 'PROVIDER_NOT_SELECTED' });
    expect(state.availableProviders).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Gửi đơn: nhà cung cấp lấy từ lựa chọn của người dùng
// ---------------------------------------------------------------------------

function buildFulfillService(
  accounts: Array<Record<string, unknown>>,
  options: { assignedAccountId?: string | null } = {},
) {
  const record = {
    id: 'ful-1',
    organizationId: ORG_A,
    accountId: 'acc-own',
    podOrderId: 'order-1',
    externalOrderId: 'NC-TT-1',
    status: FulfillmentStatus.DRAFT,
    items: [{ id: 'fi-1', podOrderItemId: 'poi-1', providerSku: 'SKU-A', quantity: 1 }],
  };

  const createDraft = jest.fn().mockResolvedValue(record);
  const repo = {
    findByPodOrder: jest.fn().mockResolvedValue(null),
    findAccountById: jest.fn((_org: string, id: string) =>
      Promise.resolve(accounts.find((entry) => entry.id === id) ?? null),
    ),
    listAccounts: jest.fn().mockResolvedValue(accounts),
    createDraft,
    findById: jest.fn().mockResolvedValue(record),
    replaceItems: jest.fn().mockResolvedValue(record.items),
    listItems: jest.fn().mockResolvedValue(record.items),
    applyProviderItemCosts: jest.fn().mockResolvedValue(0),
    updateOrder: jest.fn().mockResolvedValue(record),
    addHistory: jest.fn().mockResolvedValue(undefined),
    addErrorLog: jest.fn().mockResolvedValue(undefined),
    touchAccountUsed: jest.fn().mockResolvedValue(undefined),
    listMappingsForOrganization: jest.fn().mockResolvedValue([]),
    listProductDesigns: jest.fn().mockResolvedValue([]),
  } as unknown as FulfillmentRepository;

  const order = {
    id: 'order-1',
    tiktokOrderId: 'TT-1',
    sellerNote: null,
    buyerEmail: null,
    shippingLabelUrl: null,
    shop: { name: 'Shop A' },
    account: {
      id: 'tt-1',
      accountName: 'NCMedia US',
      fulfillmentAccountId:
        options.assignedAccountId === undefined ? null : options.assignedAccountId,
    },
    items: [],
  } as unknown as PodOrderWithRelations;

  const createOrder = jest
    .fn()
    .mockResolvedValue({ data: {}, requestId: 'req-1', durationMs: 4 });

  const service = new MangoFulfillmentService(
    { get: () => undefined } as unknown as ConfigService,
    repo,
    { findById: jest.fn().mockResolvedValue(order) } as unknown as PodOrderRepository,
    {
      check: jest.fn().mockReturnValue({
        ready: true,
        issues: [],
        address: {
          first_name: 'John',
          last_name: null,
          phone: null,
          address_line_1: '1 Main St',
          address_line_2: null,
          city: 'Austin',
          state: 'TX',
          country: 'US',
          zip: '78701',
        },
        items: [
          {
            podOrderItemId: 'poi-1',
            providerSku: 'SKU-A',
            quantity: 1,
            productionConfig: null,
            baseCost: null,
            productionLine: null,
            printFiles: [{ key: 'front' as const, url: 'https://cdn.ncmedia/a.png' }],
          },
        ],
      }),
    } as unknown as FulfillmentReadinessService,
    { createOrder, getOrder: jest.fn().mockResolvedValue({ data: {}, requestId: 'r', durationMs: 1 }) } as unknown as MangoApiClient,
    new MangoOrderMapper(),
    new MangoCredentialService({
      decrypt: (value: string) => value.replace(/^enc:/, ''),
    } as unknown as TiktokEncryptionService),
    { withLock: <T,>(_k: string, _t: number, task: () => Promise<T>) => task() } as unknown as DistributedLockService,
    { forAccount: () => Promise.resolve({ productionLines: [] }) } as unknown as FulfillmentOptionsService,
  );

  return { service, createDraft, repo: repo as unknown as Record<string, jest.Mock> };
}

describe('MangoFulfillmentService — nhà cung cấp dùng để gửi', () => {
  it('CASE 11 — người dùng chọn nhà cung cấp DÙNG CHUNG ⇒ đơn đi qua đúng tài khoản đó', async () => {
    const { service, createDraft } = buildFulfillService([OWN_ACCOUNT, GLOBAL_ACCOUNT], {
      assignedAccountId: 'acc-own',
    });

    await service.fulfill(ORG_A, 'user-1', 'order-1', FulfillmentTrigger.MANUAL, {
      fulfillmentAccountId: 'acc-global',
    });

    expect((createDraft.mock.calls[0] as unknown[])[0]).toMatchObject({ accountId: 'acc-global' });
  });

  it('CASE 12/13 — accountId không thuộc phạm vi tổ chức ⇒ 404, KHÔNG gửi gì', async () => {
    const { service } = buildFulfillService([OWN_ACCOUNT]);

    await expect(
      service.fulfill(ORG_A, 'user-1', 'order-1', FulfillmentTrigger.MANUAL, {
        fulfillmentAccountId: 'acc-cua-to-chuc-khac',
      }),
    ).rejects.toBeInstanceOf(FulfillmentAccountNotFoundException);
  });

  it('CASE 14 — KHÔNG cần gán nhà cung cấp cho TikTok Account: chỉ có một nhà cung cấp ⇒ gửi được', async () => {
    const { service, createDraft } = buildFulfillService([GLOBAL_ACCOUNT], {
      assignedAccountId: null,
    });

    await service.fulfill(ORG_A, 'user-1', 'order-1', FulfillmentTrigger.MANUAL, {});

    expect((createDraft.mock.calls[0] as unknown[])[0]).toMatchObject({ accountId: 'acc-global' });
  });

  it('CASE 15 — đơn cũ đã gán nhà cung cấp ở TikTok Account ⇒ vẫn chạy y như trước', async () => {
    const { service, createDraft } = buildFulfillService([OWN_ACCOUNT, GLOBAL_ACCOUNT], {
      assignedAccountId: 'acc-own',
    });

    await service.fulfill(ORG_A, 'user-1', 'order-1', FulfillmentTrigger.MANUAL, {});

    expect((createDraft.mock.calls[0] as unknown[])[0]).toMatchObject({ accountId: 'acc-own' });
  });

  it('🔴 nhiều nhà cung cấp mà không chọn ⇒ từ chối kèm danh sách, không tự đoán hộ', async () => {
    const { service } = buildFulfillService([OWN_ACCOUNT, GLOBAL_ACCOUNT]);

    await expect(
      service.fulfill(ORG_A, 'user-1', 'order-1', FulfillmentTrigger.MANUAL, {}),
    ).rejects.toBeInstanceOf(FulfillmentProviderNotSelectedException);
  });
});
