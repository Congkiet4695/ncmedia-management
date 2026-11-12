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
import { FulfillmentVariantPriceService } from './fulfillment-variant-price.service';

/**
 * **Tài khoản Pressify: CHỈ Store API key (+ bậc giá tuỳ chọn).** Key mã hoá khi lưu, không bao giờ đi ra API;
 * trường của Mango / Sellerwix bị từ chối; bậc giá là cấu hình riêng của Pressify.
 */

function build() {
  const created: Array<Record<string, unknown>> = [];
  const repo = {
    createAccount: jest.fn((data: Record<string, unknown>) => {
      created.push(data);
      return Promise.resolve({
        id: 'acc-psf',
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
        id: 'acc-psf',
        provider: FulfillmentProvider.PRESSIFY,
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
    {
      lookup: jest
        .fn()
        .mockResolvedValue({ ok: false, reason: 'VARIANT_NOT_FOUND', message: 'none' }),
    } as unknown as FulfillmentVariantPriceService,
  );
  return { service, repo, created };
}

const PRESSIFY = {
  provider: FulfillmentProvider.PRESSIFY,
  name: 'Pressify US',
  apiKey: 'pressify-store-key-9876',
};

async function dtoErrors(dto: object): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateFulfillmentAccountDto, dto));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('FulfillmentService.createAccount — Pressify', () => {
  it('Store API key ⇒ mã hoá khi lưu; DTO chỉ có 4 ký tự cuối; URL webhook trỏ controller Pressify', async () => {
    const { service, created } = build();

    const dto = await service.createAccount('org-1', 'user-1', { ...PRESSIFY, tierId: '13' });

    expect(created[0]).toMatchObject({
      provider: FulfillmentProvider.PRESSIFY,
      apiKeyEnc: 'enc:pressify-store-key-9876',
      apiKeyHint: '9876',
      secretEnc: null,
      providerConfig: { tierId: '13' },
      defaultShippingMethod: 'standard',
    });
    expect(JSON.stringify(dto)).not.toContain('pressify-store-key-9876');
    expect(dto).toMatchObject({ apiKeyHint: '9876', tierId: '13', storeId: null });
    expect(dto.webhookUrl).toMatch(
      /^https:\/\/api\.ncmedia\.vn\/api\/v1\/fulfillment\/webhooks\/pressify\/[0-9a-f]{48}$/,
    );
  });

  it('Không khai bậc giá ⇒ vẫn tạo được (bậc là tuỳ chọn)', async () => {
    const { service, created } = build();
    const dto = await service.createAccount('org-1', 'user-1', PRESSIFY);
    expect(created[0]).toMatchObject({ providerConfig: { tierId: '' } });
    expect(dto.tierId).toBeNull();
  });

  it.each([
    ['storeId (Sellerwix)', { storeId: 'store-1' }],
    ['defaultProductionLine (Mango)', { defaultProductionLine: 'TIKTOK' }],
    ['defaultFacility (Mango)', { defaultFacility: 'US' }],
    ['privateKey', { privateKey: 'x' }],
    ['defaultShippingMethod của Mango', { defaultShippingMethod: 'express' }],
  ])('Trường không thuộc Pressify bị từ chối: %s', async (_label, extra) => {
    const { service } = build();
    await expect(
      service.createAccount('org-1', 'user-1', { ...PRESSIFY, ...extra }),
    ).rejects.toThrow();
  });

  it('Bậc giá chỉ dành cho Pressify — Mango / Sellerwix gửi tierId bị từ chối', async () => {
    const { service } = build();
    await expect(
      service.createAccount('org-1', 'user-1', {
        provider: FulfillmentProvider.MANGO,
        name: 'M',
        apiKey: 'mango-key-123',
        tierId: '13',
      }),
    ).rejects.toThrow(/tierId/);
    await expect(
      service.createAccount('org-1', 'user-1', {
        provider: FulfillmentProvider.SELLERWIX,
        name: 'S',
        apiKey: 'swx-key-1234',
        tierId: '13',
      }),
    ).rejects.toThrow(/tierId/);
  });

  it('DTO: bậc giá phải là id số; key rỗng bị chặn', async () => {
    expect(await dtoErrors({ ...PRESSIFY, tierId: 'Diamond' })).toContain(
      'Bậc giá Pressify là id số (vd 13).',
    );
    expect(await dtoErrors({ ...PRESSIFY, tierId: '14' })).toEqual([]);
    expect((await dtoErrors({ ...PRESSIFY, apiKey: '' })).length).toBeGreaterThan(0);
  });
});

describe('FulfillmentService.updateAccount — Pressify', () => {
  it('Đổi bậc giá giữ nguyên các khoá khác của provider_config; không gửi key ⇒ không đổi key', async () => {
    const { service, repo } = build();
    repo.findOwnedAccountById.mockResolvedValue({
      id: 'acc-psf',
      provider: FulfillmentProvider.PRESSIFY,
      providerConfig: { tierId: '11', note: 'giữ' },
    });

    await service.updateAccount('org-1', 'user-1', 'acc-psf', { tierId: '14' });

    const data = repo.updateAccount.mock.calls[0][1];
    expect(data.providerConfig).toEqual({ tierId: '14', note: 'giữ' });
    expect(data).not.toHaveProperty('apiKeyEnc');
  });
});
