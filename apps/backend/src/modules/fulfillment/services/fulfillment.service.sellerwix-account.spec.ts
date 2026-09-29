import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import { PodAccessScopeService } from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { FulfillmentValidationException } from '../exceptions/fulfillment.exceptions';
import { ProductDesignMapper } from '../mappers/product-design.mapper';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import type { FulfillmentProviderGateway } from './fulfillment-provider.gateway';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';
import { FulfillmentService } from './fulfillment.service';

/**
 * **CASE 1 — cấu hình nhà cung cấp Sellerwix.**
 *
 * Bí mật (API Key, Private Key) được MÃ HOÁ khi lưu và KHÔNG BAO GIỜ đi ra API; cấu hình không bí
 * mật (Store ID, Public Key ID) lưu ở `provider_config`; trường vô nghĩa với Sellerwix bị từ chối.
 */

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function build() {
  const created: Array<Record<string, unknown>> = [];
  const repo = {
    createAccount: jest.fn((data: Record<string, unknown>) => {
      created.push(data);
      return Promise.resolve({
        id: 'acc-swx',
        isActive: true,
        isDefault: true,
        isGlobal: false,
        defaultProductionLine: null,
        defaultFacility: null,
        providerWebhookId: null,
        lastUsedAt: null,
        lastErrorMsg: null,
        baseUrlOverride: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      });
    }),
    findOwnedAccountById: jest.fn(),
    updateAccount: jest.fn((_id: string, data: Record<string, unknown>) =>
      Promise.resolve({
        id: 'acc-swx',
        provider: FulfillmentProvider.SELLERWIX,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }),
    ),
  };
  const service = new FulfillmentService(
    {
      get: (key: string, fallback?: string) =>
        key === 'fulfillment.webhookBaseUrl' ? 'https://api.ncmedia.vn' : (fallback ?? ''),
    } as unknown as ConfigService,
    {} as unknown as PrismaService,
    repo as unknown as FulfillmentRepository,
    {} as unknown as PodOrderRepository,
    {} as unknown as FulfillmentReadinessService,
    {} as unknown as ProductDesignMapper,
    { encrypt: (value: string) => `enc:${value}` } as unknown as TiktokEncryptionService,
    {} as unknown as PodAccessScopeService,
    { isSupported: () => true } as unknown as FulfillmentProviderGateway,
  );
  return { service, repo, created };
}

const VALID = {
  provider: FulfillmentProvider.SELLERWIX,
  name: 'Sellerwix US',
  apiKey: 'sw-api-key-1234',
  privateKey,
  storeId: '01c1cb78-9a2f-4d7e-bf5f-fee3c3cb7d2b',
  publicKeyId: '91cabfd5-78fb-4bbd-9000-a4c0fa258c20',
};

describe('FulfillmentService.createAccount — Sellerwix', () => {
  it('mã hoá API Key + Private Key, lưu Store ID/Public Key ID; DTO KHÔNG chứa bí mật', async () => {
    const { service, created } = build();

    const dto = await service.createAccount('org-1', 'user-1', VALID);

    expect(created[0]).toMatchObject({
      provider: FulfillmentProvider.SELLERWIX,
      apiKeyEnc: 'enc:sw-api-key-1234',
      apiKeyHint: '1234',
      secretEnc: `enc:${privateKey}`,
      providerConfig: { storeId: VALID.storeId, publicKeyId: VALID.publicKeyId },
      // Sellerwix không có mặc định vận chuyển chung (phụ thuộc biến thể).
      defaultShippingMethod: '',
    });
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('PRIVATE KEY');
    expect(serialized).not.toContain('sw-api-key-1234');
    expect(dto).toMatchObject({
      storeId: VALID.storeId,
      publicKeyId: VALID.publicKeyId,
      privateKeyConfigured: true,
      apiKeyHint: '1234',
    });
    // URL webhook Sellerwix (hiện MỘT lần) trỏ đúng controller Sellerwix.
    expect(dto.webhookUrl).toMatch(
      /^https:\/\/api\.ncmedia\.vn\/api\/v1\/fulfillment\/webhooks\/sellerwix\/[0-9a-f]{48}$/,
    );
  });

  it('thiếu Private Key / Store ID / Public Key ID ⇒ từ chối, nêu đủ các field', async () => {
    const { service } = build();

    const error = await service
      .createAccount('org-1', 'user-1', {
        provider: FulfillmentProvider.SELLERWIX,
        name: 'x',
        apiKey: 'sw-api-key-1234',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FulfillmentValidationException);
    const fields = (
      (error as FulfillmentValidationException).getResponse() as {
        errors: Array<{ field: string }>;
      }
    ).errors.map((entry) => entry.field);
    expect(fields).toEqual(['privateKey', 'storeId', 'publicKeyId']);
  });

  it('private key không phải PEM RSA ⇒ từ chối NGAY lúc lưu', async () => {
    const { service } = build();
    await expect(
      service.createAccount('org-1', 'user-1', { ...VALID, privateKey: 'not-a-key' }),
    ).rejects.toThrow(/Private key không đọc được/);
  });

  it('trường chỉ của Mango (production line / facility) bị từ chối cho Sellerwix', async () => {
    const { service } = build();
    await expect(
      service.createAccount('org-1', 'user-1', { ...VALID, defaultProductionLine: 'TIKTOK' }),
    ).rejects.toThrow(/defaultProductionLine/);
  });

  it('trường của Sellerwix bị từ chối cho Mango', async () => {
    const { service } = build();
    await expect(
      service.createAccount('org-1', 'user-1', {
        provider: FulfillmentProvider.MANGO,
        name: 'Mango',
        apiKey: 'mango-key-123',
        storeId: 'x',
      }),
    ).rejects.toThrow(/storeId/);
  });
});

describe('FulfillmentService.updateAccount — Sellerwix', () => {
  it('đổi Store ID giữ nguyên Public Key ID; không gửi private key ⇒ không đổi key', async () => {
    const { service, repo } = build();
    repo.findOwnedAccountById.mockResolvedValue({
      id: 'acc-swx',
      provider: FulfillmentProvider.SELLERWIX,
      providerConfig: { storeId: 'old-store', publicKeyId: 'kid-1' },
    });

    await service.updateAccount('org-1', 'user-1', 'acc-swx', { storeId: 'new-store' });

    const data = repo.updateAccount.mock.calls[0][1];
    expect(data.providerConfig).toEqual({ storeId: 'new-store', publicKeyId: 'kid-1' });
    expect(data).not.toHaveProperty('secretEnc');
  });
});

describe('FulfillmentService.updateMapping — đổi nhà cung cấp của sản phẩm', () => {
  it('🔴 ánh xạ đang ở Mango, lưu lại với tài khoản Sellerwix ⇒ ánh xạ chuyển sang Sellerwix', async () => {
    const existing = {
      id: 'map-1',
      organizationId: 'org-1',
      accountId: 'acc-mango',
      provider: FulfillmentProvider.MANGO,
      tiktokProductId: 'TT-P1',
      sellerSku: 'SELLER-1',
    };
    const updateMapping = jest.fn((_id: string, data: Record<string, unknown>) =>
      Promise.resolve({
        ...existing,
        ...data,
        baseCost: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    const repo = {
      findMappingById: jest.fn().mockResolvedValue(existing),
      findConflictingMapping: jest.fn().mockResolvedValue(null),
      findAccountById: jest.fn().mockResolvedValue({
        id: 'acc-swx',
        provider: FulfillmentProvider.SELLERWIX,
      }),
      listProductDesigns: jest.fn().mockResolvedValue([]),
      updateMapping,
    };
    const service = new FulfillmentService(
      { get: () => '' } as unknown as ConfigService,
      {} as unknown as PrismaService,
      repo as unknown as FulfillmentRepository,
      {} as unknown as PodOrderRepository,
      {} as unknown as FulfillmentReadinessService,
      { toDtoList: () => [], statusOf: () => 'MISSING_ALL' } as unknown as ProductDesignMapper,
      {} as unknown as TiktokEncryptionService,
      {} as unknown as PodAccessScopeService,
      { isSupported: () => true } as unknown as FulfillmentProviderGateway,
    );

    await service.updateMapping(
      'org-1',
      'user-1',
      'map-1',
      {
        accountId: 'acc-swx',
        tiktokProductId: 'TT-P1',
        sellerSku: 'SELLER-1',
        providerSku: 'SW-MD-MPTG-BL-XL',
        placementMap: { FRONT: 'CF' },
      },
      { allShops: true, shopIds: [] } as never,
    );

    expect(updateMapping.mock.calls[0][1]).toMatchObject({
      accountId: 'acc-swx',
      provider: FulfillmentProvider.SELLERWIX,
      providerSku: 'SW-MD-MPTG-BL-XL',
      placementMap: { FRONT: 'CF' },
    });
  });
});
