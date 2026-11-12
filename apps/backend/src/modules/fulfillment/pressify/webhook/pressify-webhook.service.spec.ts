import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, Prisma } from '@prisma/client';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { PressifyOrderMapper } from '../mappers/pressify-order.mapper';
import { PressifyCredentialService } from '../services/pressify-credential.service';
import { PressifyFulfillmentService } from '../services/pressify-fulfillment.service';
import { PressifyWebhookService } from './pressify-webhook.service';

/**
 * **Webhook Pressify — xác thực hai lớp (secret đường dẫn + `data.api_key`), webhook chỉ là TÍN HIỆU.**
 */

const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

const ACCOUNT = {
  id: 'acc-psf',
  organizationId: 'org-1',
  provider: FulfillmentProvider.PRESSIFY,
  name: 'Pressify',
  isActive: true,
  apiKeyEnc: 'enc:STORE-KEY-1',
  webhookSecretEnc: 'enc:secret-abc',
};

const RECORD = {
  id: 'ful-1',
  organizationId: 'org-1',
  accountId: 'acc-psf',
  providerOrderId: '2885109',
};

function payload(over: Record<string, unknown> = {}) {
  return {
    data: {
      id: 2885109,
      ref_id: '576000000000000001',
      status: 'shipped',
      tracking: '9400111899223344556677',
      carrier_code: 'usps',
      tracking_url:
        'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=9400111899223344556677',
      label_url: null,
      api_key: 'STORE-KEY-1',
      ...over,
    },
  };
}

function build(options: { duplicate?: boolean; noRecord?: boolean } = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const repo = {
    findAccountsWithWebhookSecret: jest.fn().mockResolvedValue([ACCOUNT]),
    createWebhookLog: jest.fn((data: Record<string, unknown>) => {
      if (options.duplicate) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
        );
      }
      logs.push(data);
      return Promise.resolve({ id: 'log-1' });
    }),
    markWebhookProcessed: jest.fn().mockResolvedValue(undefined),
    findForProviderEvent: jest.fn().mockResolvedValue(options.noRecord ? null : RECORD),
    addHistory: jest.fn().mockResolvedValue(undefined),
  } as unknown as FulfillmentRepository;
  const refreshFromWebhook = jest.fn().mockResolvedValue(true);
  const fulfillment = { refreshFromWebhook } as unknown as PressifyFulfillmentService;
  const service = new PressifyWebhookService(
    { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService,
    repo,
    fulfillment,
    new PressifyOrderMapper(),
    new PressifyCredentialService(encryption),
    encryption,
  );
  return { service, repo: repo as unknown as Record<string, jest.Mock>, logs, refreshFromWebhook };
}

describe('PressifyWebhookService', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('Secret + api_key đúng ⇒ đọc lại đơn (GET) và ghép tracking_url / hãng từ webhook', async () => {
    const { service, refreshFromWebhook, repo } = build();

    const result = await service.receive('secret-abc', payload(), { 'user-agent': 'Pressify' });

    expect(result).toMatchObject({ accepted: true, duplicate: false });
    expect(refreshFromWebhook).toHaveBeenCalledWith(RECORD, ACCOUNT, {
      trackingUrl:
        'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=9400111899223344556677',
      carrier: 'usps',
      labelUrl: null,
    });
    expect(repo.markWebhookProcessed).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ processed: true }),
    );
  });

  it('Payload lưu xuống KHÔNG còn api_key', async () => {
    const { service, logs } = build();
    await service.receive('secret-abc', payload(), {});
    expect(JSON.stringify(logs[0].payload)).not.toContain('STORE-KEY-1');
    expect(logs[0].verified).toBe(true);
  });

  it('Secret sai ⇒ lưu (để điều tra) nhưng KHÔNG xử lý', async () => {
    const { service, refreshFromWebhook } = build();
    const result = await service.receive('wrong', payload(), {});
    expect(result.accepted).toBe(false);
    expect(refreshFromWebhook).not.toHaveBeenCalled();
  });

  it('Secret đúng nhưng api_key của store KHÁC ⇒ dead letter, KHÔNG xử lý', async () => {
    const { service, refreshFromWebhook, repo } = build();
    const result = await service.receive('secret-abc', payload({ api_key: 'OTHER-STORE-KEY' }), {});
    expect(result.accepted).toBe(false);
    expect(refreshFromWebhook).not.toHaveBeenCalled();
    expect(repo.markWebhookProcessed).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ deadLetter: true }),
    );
  });

  it('Thiếu api_key ⇒ không xác thực được ⇒ không xử lý', async () => {
    const { service, refreshFromWebhook } = build();
    await service.receive('secret-abc', payload({ api_key: undefined }), {});
    expect(refreshFromWebhook).not.toHaveBeenCalled();
  });

  it('Sự kiện trùng (cùng đơn + trạng thái + tracking) ⇒ bỏ qua', async () => {
    const { service, refreshFromWebhook } = build({ duplicate: true });
    const result = await service.receive('secret-abc', payload(), {});
    expect(result.duplicate).toBe(true);
    expect(refreshFromWebhook).not.toHaveBeenCalled();
  });

  it('Đơn không do NCMedia gửi ⇒ dead letter', async () => {
    const { service, refreshFromWebhook, repo } = build({ noRecord: true });
    await service.receive('secret-abc', payload(), {});
    expect(refreshFromWebhook).not.toHaveBeenCalled();
    expect(repo.markWebhookProcessed).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ deadLetter: true }),
    );
  });
});
