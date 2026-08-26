import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider } from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { FulfillmentAccountNotFoundException } from '../exceptions/fulfillment.exceptions';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import type { PodAccessScopeService } from '../../pod-tiktok/services/pod-access-scope.service';
import { PrismaService } from '../../../database/prisma.service';
import { ProductDesignMapper } from '../mappers/product-design.mapper';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';
import { FulfillmentService } from './fulfillment.service';

const PLAIN_KEY = 'mango-live-key-ABCD';

/** Mã hoá giả lập — tiền tố cho thấy giá trị đã đi qua bước mã hoá. */
const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

function account(over: Record<string, unknown> = {}) {
  return {
    id: 'prov-1',
    organizationId: 'org-1',
    provider: FulfillmentProvider.MANGO,
    name: 'Mango US',
    apiKeyEnc: `enc:${PLAIN_KEY}`,
    apiKeyHint: PLAIN_KEY.slice(-4),
    baseUrlOverride: 'https://v3.mangoteeprints.com/api/public/v1',
    isActive: true,
    isDefault: true,
    defaultProductionLine: null,
    defaultShippingMethod: 'standard',
    defaultFacility: null,
    webhookSecretEnc: 'enc:secret',
    providerWebhookId: null,
    lastUsedAt: null,
    lastErrorAt: null,
    lastErrorMsg: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  };
}

function build(repoOverrides: Record<string, jest.Mock> = {}) {
  const repo = {
    listAccounts: jest.fn().mockResolvedValue([account()]),
    countTiktokAccountsGroupedByProvider: jest.fn().mockResolvedValue(new Map([['prov-1', 3]])),
    createAccount: jest
      .fn()
      .mockImplementation((data: Record<string, unknown>) => Promise.resolve(account(data))),
    findAccountById: jest.fn().mockResolvedValue(account()),
    countTiktokAccountsByProvider: jest.fn().mockResolvedValue(2),
    countOrdersByAccount: jest.fn().mockResolvedValue(7),
    softDeleteAccount: jest.fn().mockResolvedValue(account({ isActive: false })),
    ...repoOverrides,
  } as unknown as FulfillmentRepository;

  const service = new FulfillmentService(
    { get: (_key: string, fallback?: string) => fallback ?? '' } as unknown as ConfigService,
    // Năm phụ thuộc dưới đây không tham gia luồng quản lý nhà cung cấp.
    {} as unknown as PrismaService,
    repo,
    {} as unknown as PodOrderRepository,
    {} as unknown as FulfillmentReadinessService,
    {} as unknown as ProductDesignMapper,
    encryption,
    {} as unknown as PodAccessScopeService,
  );
  return { service, repo: repo as unknown as Record<string, jest.Mock> };
}

describe('FulfillmentService — quản lý nhà cung cấp', () => {
  describe('createAccount', () => {
    it('MÃ HOÁ API key trước khi lưu — giá trị thô không chạm tới database', async () => {
      const { service, repo } = build();

      await service.createAccount('org-1', 'user-1', {
        provider: FulfillmentProvider.MANGO,
        name: 'Mango US',
        apiKey: PLAIN_KEY,
        baseUrl: 'https://v3.mangoteeprints.com/api/public/v1',
      });

      const data = callArg<{ apiKeyEnc: string; apiKeyHint: string }>(repo.createAccount, 0, 0);
      expect(data.apiKeyEnc).toBe(`enc:${PLAIN_KEY}`);
      expect(data.apiKeyEnc).not.toBe(PLAIN_KEY);
      // Gợi ý chỉ 4 ký tự cuối: đủ để đối chiếu, không đủ để dùng lại.
      expect(data.apiKeyHint).toBe('ABCD');
    });

    it('KHÔNG trả API key về client', async () => {
      const { service } = build();

      const dto = await service.createAccount('org-1', 'user-1', {
        provider: FulfillmentProvider.MANGO,
        name: 'Mango US',
        apiKey: PLAIN_KEY,
      });

      expect(JSON.stringify(dto)).not.toContain(PLAIN_KEY);
      expect(dto).not.toHaveProperty('apiKey');
      expect(dto).not.toHaveProperty('apiKeyEnc');
      expect(dto.apiKeyHint).toBe('ABCD');
    });
  });

  describe('listAccounts', () => {
    it('không chứa API key ở bất kỳ dạng nào và có status đọc được', async () => {
      const { service } = build();

      const [dto] = await service.listAccounts('org-1');

      expect(JSON.stringify(dto)).not.toContain(PLAIN_KEY);
      expect(JSON.stringify(dto)).not.toContain('enc:');
      expect(dto.status).toBe('ACTIVE');
      expect(dto.linkedTiktokAccounts).toBe(3);
    });

    it('đếm kết nối TikTok bằng MỘT truy vấn gom nhóm (không N+1)', async () => {
      const { service, repo } = build();

      await service.listAccounts('org-1');

      expect(repo.countTiktokAccountsGroupedByProvider).toHaveBeenCalledTimes(1);
    });

    it('nhà cung cấp bị tắt hiện status INACTIVE', async () => {
      const { service } = build({
        listAccounts: jest.fn().mockResolvedValue([account({ isActive: false })]),
      });

      const [dto] = await service.listAccounts('org-1');

      expect(dto.status).toBe('INACTIVE');
    });
  });

  describe('listProviderOptions', () => {
    it('chỉ trả nhà cung cấp ACTIVE, và chỉ id/tên/loại', async () => {
      const { service } = build({
        listAccounts: jest
          .fn()
          .mockResolvedValue([account(), account({ id: 'prov-2', isActive: false })]),
      });

      const options = await service.listProviderOptions('org-1');

      expect(options).toEqual([
        { id: 'prov-1', name: 'Mango US', provider: FulfillmentProvider.MANGO },
      ]);
    });
  });

  describe('deleteAccount', () => {
    it('xoá mềm và báo rõ số kết nối bị gỡ + số đơn lịch sử', async () => {
      const { service, repo } = build();

      const result = await service.deleteAccount('org-1', 'user-1', 'prov-1');

      expect(repo.softDeleteAccount).toHaveBeenCalledWith('prov-1', 'user-1');
      expect(result).toEqual({ id: 'prov-1', unlinkedTiktokAccounts: 2, submittedOrders: 7 });
    });

    it('báo lỗi khi nhà cung cấp không tồn tại', async () => {
      const { service } = build({ findAccountById: jest.fn().mockResolvedValue(null) });

      await expect(service.deleteAccount('org-1', 'user-1', 'missing')).rejects.toBeInstanceOf(
        FulfillmentAccountNotFoundException,
      );
    });

    it('không xoá gì khi bản ghi không thuộc tổ chức', async () => {
      const { service, repo } = build({ findAccountById: jest.fn().mockResolvedValue(null) });

      await service.deleteAccount('org-1', 'user-1', 'prov-1').catch(() => undefined);

      expect(repo.softDeleteAccount).not.toHaveBeenCalled();
    });
  });
});
