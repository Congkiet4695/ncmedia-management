import { ConfigService } from '@nestjs/config';
import { FulfillmentStatus } from '@prisma/client';
import {
  FulfillmentProviderInactiveException,
  FulfillmentProviderMisconfiguredException,
  FulfillmentProviderNotAssignedException,
} from '../../exceptions/fulfillment.exceptions';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from '../../services/fulfillment-readiness.service';
import { PodOrderRepository } from '../../../pod-tiktok/repositories/pod-order.repository';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import type { PodOrderWithRelations } from '../../../pod-tiktok/types/pod-order-with-relations.type';
import { MangoApiClient } from '../clients/mango-api.client';
import { MangoOrderMapper } from '../mappers/mango-order.mapper';
import { MangoCredentialService } from './mango-credential.service';
import { MangoFulfillmentService } from './mango-fulfillment.service';

/**
 * Mục 6 + Mục 7: nhà cung cấp phải được suy ra TỪ TIKTOK ACCOUNT của đơn, và bốn điều kiện
 * chặn submit phải hỏng TRƯỚC khi bất kỳ request nào rời khỏi hệ thống.
 */
const encryption = {
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

function buildService(overrides: {
  findAccountById?: jest.Mock;
  order?: Partial<PodOrderWithRelations>;
}) {
  const findByPodOrder = jest.fn().mockResolvedValue(null);
  const findAccountById = overrides.findAccountById ?? jest.fn().mockResolvedValue(null);
  const createOrder = jest.fn();

  const repo = { findByPodOrder, findAccountById, createOrder } as unknown as FulfillmentRepository;

  const order = {
    id: 'order-1',
    account: { id: 'tt-1', accountName: 'NCMedia US', fulfillmentAccountId: null },
    ...overrides.order,
  } as unknown as PodOrderWithRelations;

  const podOrderRepo = {
    findById: jest.fn().mockResolvedValue(order),
  } as unknown as PodOrderRepository;

  const service = new MangoFulfillmentService(
    { get: () => undefined } as unknown as ConfigService,
    repo,
    podOrderRepo,
    {} as unknown as FulfillmentReadinessService,
    {} as unknown as MangoApiClient,
    new MangoOrderMapper(),
    new MangoCredentialService(encryption),
  );

  return { service, findAccountById, createOrder };
}

function providerRecord(over: Record<string, unknown> = {}) {
  return {
    id: 'prov-1',
    organizationId: 'org-1',
    name: 'Mango US',
    isActive: true,
    apiKeyEnc: 'enc:live-key-123456',
    baseUrlOverride: 'https://v3.mangoteeprints.com/api/public/v1',
    ...over,
  };
}

describe('MangoFulfillmentService.fulfill — chọn nhà cung cấp', () => {
  it('chặn khi TikTok Account chưa được gán nhà cung cấp', async () => {
    const { service, createOrder } = buildService({});

    await expect(service.fulfill('org-1', 'user-1', 'order-1')).rejects.toBeInstanceOf(
      FulfillmentProviderNotAssignedException,
    );
    // Quan trọng hơn cả loại lỗi: KHÔNG có bản ghi nào được tạo ra.
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('thông báo nêu đúng tên kết nối TikTok cần cấu hình', async () => {
    const { service } = buildService({});

    await service.fulfill('org-1', 'user-1', 'order-1').catch((error: unknown) => {
      const body = (error as FulfillmentProviderNotAssignedException).getResponse() as {
        code: string;
        message: string;
      };
      expect(body.code).toBe('FULFILLMENT_PROVIDER_NOT_ASSIGNED');
      expect(body.message).toContain('NCMedia US');
    });
  });

  it('chặn khi nhà cung cấp đã bị xoá sau lúc gán', async () => {
    const { service } = buildService({
      order: {
        account: { id: 'tt-1', accountName: 'NCMedia US', fulfillmentAccountId: 'prov-1' },
      } as unknown as Partial<PodOrderWithRelations>,
      findAccountById: jest.fn().mockResolvedValue(null),
    });

    await expect(service.fulfill('org-1', 'user-1', 'order-1')).rejects.toBeInstanceOf(
      FulfillmentProviderNotAssignedException,
    );
  });

  it('chặn khi nhà cung cấp đang INACTIVE', async () => {
    const { service } = buildService({
      order: {
        account: { id: 'tt-1', accountName: 'NCMedia US', fulfillmentAccountId: 'prov-1' },
      } as unknown as Partial<PodOrderWithRelations>,
      findAccountById: jest.fn().mockResolvedValue(providerRecord({ isActive: false })),
    });

    await expect(service.fulfill('org-1', 'user-1', 'order-1')).rejects.toBeInstanceOf(
      FulfillmentProviderInactiveException,
    );
  });

  it('chặn khi nhà cung cấp thiếu API Key', async () => {
    const { service } = buildService({
      order: {
        account: { id: 'tt-1', accountName: 'NCMedia US', fulfillmentAccountId: 'prov-1' },
      } as unknown as Partial<PodOrderWithRelations>,
      findAccountById: jest.fn().mockResolvedValue(providerRecord({ apiKeyEnc: null })),
    });

    await expect(service.fulfill('org-1', 'user-1', 'order-1')).rejects.toBeInstanceOf(
      FulfillmentProviderMisconfiguredException,
    );
  });

  it('chặn khi nhà cung cấp thiếu Base URL', async () => {
    const { service } = buildService({
      order: {
        account: { id: 'tt-1', accountName: 'NCMedia US', fulfillmentAccountId: 'prov-1' },
      } as unknown as Partial<PodOrderWithRelations>,
      findAccountById: jest.fn().mockResolvedValue(providerRecord({ baseUrlOverride: null })),
    });

    await expect(service.fulfill('org-1', 'user-1', 'order-1')).rejects.toBeInstanceOf(
      FulfillmentProviderMisconfiguredException,
    );
  });

  it('tra cứu nhà cung cấp theo ĐÚNG id gán trên TikTok Account', async () => {
    const findAccountById = jest.fn().mockResolvedValue(providerRecord({ isActive: false }));
    const { service } = buildService({
      order: {
        account: { id: 'tt-1', accountName: 'NCMedia US', fulfillmentAccountId: 'prov-9' },
      } as unknown as Partial<PodOrderWithRelations>,
      findAccountById,
    });

    await service.fulfill('org-1', 'user-1', 'order-1').catch(() => undefined);

    expect(findAccountById).toHaveBeenCalledWith('org-1', 'prov-9');
  });
});

describe('MangoFulfillmentService.fulfill — chống gửi trùng', () => {
  it('không đụng tới nhà cung cấp nếu đơn đã gửi thành công', async () => {
    const findAccountById = jest.fn();
    const findByPodOrder = jest.fn().mockResolvedValue({
      id: 'ff-1',
      status: FulfillmentStatus.IN_PRODUCTION,
    });
    const repo = { findByPodOrder, findAccountById } as unknown as FulfillmentRepository;

    const service = new MangoFulfillmentService(
      { get: () => undefined } as unknown as ConfigService,
      repo,
      { findById: jest.fn() } as unknown as PodOrderRepository,
      {} as unknown as FulfillmentReadinessService,
      {} as unknown as MangoApiClient,
      new MangoOrderMapper(),
      new MangoCredentialService(encryption),
    );

    await expect(service.fulfill('org-1', 'user-1', 'order-1')).rejects.toThrow();
    expect(findAccountById).not.toHaveBeenCalled();
  });
});
