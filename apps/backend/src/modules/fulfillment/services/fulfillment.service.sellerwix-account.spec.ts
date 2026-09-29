import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../../database/prisma.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import { PodAccessScopeService } from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { CreateFulfillmentAccountDto } from '../dto/fulfillment.dto';
import { ProductDesignMapper } from '../mappers/product-design.mapper';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import type { FulfillmentProviderGateway } from './fulfillment-provider.gateway';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';
import { FulfillmentService } from './fulfillment.service';

/**
 * **CASE 1 — cấu hình nhà cung cấp Sellerwix: CHỈ API Key.**
 *
 * API Key được MÃ HOÁ khi lưu và KHÔNG BAO GIỜ đi ra API (chỉ 4 ký tự cuối). Store ID tuỳ chọn.
 * Public Key ID / Private Key là trường CŨ: được nhận nhưng bỏ qua — không bắt buộc, không kiểm,
 * không lưu, không chặn Save. Trường vô nghĩa với Sellerwix (của Mango) vẫn bị từ chối.
 */

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

const API_KEY_ONLY = {
  provider: FulfillmentProvider.SELLERWIX,
  name: 'Sellerwix',
  apiKey: 'sw-api-key-1234',
};
const LEGACY = {
  privateKey: '-----BEGIN PRIVATE KEY-----\nnot-even-a-real-key\n-----END PRIVATE KEY-----',
  publicKeyId: '91cabfd5-78fb-4bbd-9000-a4c0fa258c20',
};

async function dtoErrors(dto: object): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateFulfillmentAccountDto, dto));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('FulfillmentService.createAccount — Sellerwix (API Key only)', () => {
  it('Sellerwix + API Key only ⇒ SUCCESS; mã hoá API Key, không lưu gì khác; DTO không chứa bí mật', async () => {
    const { service, created } = build();

    const dto = await service.createAccount('org-1', 'user-1', API_KEY_ONLY);

    expect(created[0]).toMatchObject({
      provider: FulfillmentProvider.SELLERWIX,
      apiKeyEnc: 'enc:sw-api-key-1234',
      apiKeyHint: '1234',
      secretEnc: null,
      providerConfig: { storeId: '' },
      // Sellerwix không có mặc định vận chuyển chung (phụ thuộc biến thể).
      defaultShippingMethod: '',
    });
    expect(JSON.stringify(dto)).not.toContain('sw-api-key-1234');
    expect(dto).toMatchObject({ apiKeyHint: '1234', storeId: null });
    expect(dto).not.toHaveProperty('publicKeyId');
    expect(dto).not.toHaveProperty('privateKeyConfigured');
    // URL webhook Sellerwix (hiện MỘT lần) trỏ đúng controller Sellerwix.
    expect(dto.webhookUrl).toMatch(
      /^https:\/\/api\.ncmedia\.vn\/api\/v1\/fulfillment\/webhooks\/sellerwix\/[0-9a-f]{48}$/,
    );
  });

  it('không có Public Key ID / Store ID / Private Key ⇒ vẫn SUCCESS (DTO + service)', async () => {
    const { service } = build();
    expect(await dtoErrors(API_KEY_ONLY)).toEqual([]);
    await expect(service.createAccount('org-1', 'user-1', API_KEY_ONLY)).resolves.toBeDefined();
  });

  it('API Key + trường CŨ (kể cả private key không hợp lệ) ⇒ SUCCESS, trường cũ bị bỏ qua, không lưu', async () => {
    const { service, created } = build();

    await service.createAccount('org-1', 'user-1', { ...API_KEY_ONLY, ...LEGACY, storeId: 'store-9' });

    expect(created[0]).toMatchObject({ secretEnc: null, providerConfig: { storeId: 'store-9' } });
    expect(JSON.stringify(created[0])).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(created[0])).not.toContain(LEGACY.publicKeyId);
  });

  it('API Key rỗng ⇒ lỗi validation "Sellerwix API Key is required."', async () => {
    expect(await dtoErrors({ ...API_KEY_ONLY, apiKey: '' })).toContain('Sellerwix API Key is required.');
    expect(await dtoErrors({ ...API_KEY_ONLY, apiKey: '   ' })).toContain('Sellerwix API Key is required.');
  });

  it('không có lỗi nào nhắc tới Public Key ID / Store ID / Private key', async () => {
    const messages = await dtoErrors({ provider: FulfillmentProvider.SELLERWIX, name: 'x', apiKey: '' });
    expect(messages.join(' ')).not.toMatch(/public key|store id|private key/i);
  });

  it('trường chỉ của Mango (production line / facility) bị từ chối cho Sellerwix', async () => {
    const { service } = build();
    await expect(
      service.createAccount('org-1', 'user-1', { ...API_KEY_ONLY, defaultProductionLine: 'TIKTOK' }),
    ).rejects.toThrow(/defaultProductionLine/);
  });

  it('Mango KHÔNG đổi: trường của Sellerwix vẫn bị từ chối cho Mango', async () => {
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
  it('tài khoản CŨ: đổi Store ID giữ nguyên mọi khoá cũ trong provider_config; không đụng private key đã lưu', async () => {
    const { service, repo } = build();
    repo.findOwnedAccountById.mockResolvedValue({
      id: 'acc-swx',
      provider: FulfillmentProvider.SELLERWIX,
      providerConfig: { storeId: 'old-store', publicKeyId: 'kid-1' },
      secretEnc: 'enc:old-private-key',
    });

    await service.updateAccount('org-1', 'user-1', 'acc-swx', { storeId: 'new-store' });

    const data = repo.updateAccount.mock.calls[0][1];
    expect(data.providerConfig).toEqual({ storeId: 'new-store', publicKeyId: 'kid-1' });
    expect(data).not.toHaveProperty('secretEnc');
  });

  it('sửa tài khoản CŨ không cần nhập lại trường cũ; gửi trường cũ cũng không bị chặn, không bị lưu', async () => {
    const { service, repo } = build();
    repo.findOwnedAccountById.mockResolvedValue({
      id: 'acc-swx',
      provider: FulfillmentProvider.SELLERWIX,
      providerConfig: { storeId: 's', publicKeyId: 'kid-1' },
    });

    await service.updateAccount('org-1', 'user-1', 'acc-swx', { name: 'Sellerwix 2' });
    await service.updateAccount('org-1', 'user-1', 'acc-swx', { ...LEGACY });

    expect(repo.updateAccount.mock.calls[0][1]).toMatchObject({ name: 'Sellerwix 2' });
    expect(repo.updateAccount.mock.calls[1][1]).not.toHaveProperty('secretEnc');
    expect(repo.updateAccount.mock.calls[1][1]).not.toHaveProperty('providerConfig');
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
