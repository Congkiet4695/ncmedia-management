import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, FulfillmentStatus, Prisma } from '@prisma/client';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { SellerwixOrderMapper } from '../mappers/sellerwix-order.mapper';
import { SellerwixFulfillmentService } from '../services/sellerwix-fulfillment.service';
import type { SellerwixWebhookPayload } from '../types/sellerwix-api.types';
import { SellerwixWebhookService } from './sellerwix-webhook.service';

const ACCOUNT = {
  id: 'acc-swx',
  organizationId: 'org-1',
  provider: FulfillmentProvider.SELLERWIX,
  webhookSecretEnc: 'enc:s3cret',
  providerConfig: { storeId: 'store-1', publicKeyId: 'kid' },
};
const RECORD = {
  id: 'ful-1',
  organizationId: 'org-1',
  accountId: 'acc-swx',
  providerOrderId: 'swx-1',
  status: FulfillmentStatus.SUBMITTED,
};

function payload(over: Partial<SellerwixWebhookPayload> = {}): SellerwixWebhookPayload {
  return {
    event: { id: 'evt-1', type: 'order:shipment', created_at: '2026-09-20T10:00:00.000Z' },
    data: {
      id: 'swx-1',
      reference_id: '576000000000000001',
      store_id: 'store-1',
      address: { name: 'John Doe', address1: '123 Main St', city: 'Tampa' },
      fulfillments: [{ status: 'shipped', trackings: [{ tracking_number: 'AG1' }] }],
    },
    ...over,
  };
}

function build(options: { duplicate?: boolean; newer?: boolean; record?: unknown } = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const marks: Array<Record<string, unknown>> = [];
  const findForProviderEvent = jest
    .fn()
    .mockResolvedValue(options.record === undefined ? RECORD : options.record);
  const repo = {
    findAccountsWithWebhookSecret: jest.fn().mockResolvedValue([ACCOUNT]),
    createWebhookLog: jest.fn((data: Record<string, unknown>) => {
      if (options.duplicate) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
        );
      }
      logs.push(data);
      return Promise.resolve({ id: `log-${logs.length}` });
    }),
    markWebhookProcessed: jest.fn((_id: string, data: Record<string, unknown>) => {
      marks.push(data);
      return Promise.resolve();
    }),
    findForProviderEvent,
    hasNewerProcessedEvent: jest.fn().mockResolvedValue(options.newer ?? false),
    addHistory: jest.fn().mockResolvedValue(undefined),
  } as unknown as FulfillmentRepository;
  const applyProviderState = jest.fn().mockResolvedValue(true);

  const service = new SellerwixWebhookService(
    { get: (_k: string, fallback: unknown) => fallback } as unknown as ConfigService,
    repo,
    { applyProviderState } as unknown as SellerwixFulfillmentService,
    new SellerwixOrderMapper(),
    { decrypt: (v: string) => v.replace(/^enc:/, '') } as unknown as TiktokEncryptionService,
  );
  return { service, applyProviderState, findForProviderEvent, logs, marks };
}

describe('SellerwixWebhookService.receive', () => {
  it('đúng secret ⇒ lưu (PII đã che) rồi áp `data` vào đúng đơn của đúng tài khoản', async () => {
    const h = build();

    const result = await h.service.receive('s3cret', payload(), {
      'user-agent': 'sw',
      authorization: 'x',
    });

    expect(result).toMatchObject({ accepted: true, duplicate: false });
    expect(h.logs[0]).toMatchObject({
      provider: FulfillmentProvider.SELLERWIX,
      verified: true,
      providerEventId: 'evt-1|order:shipment|2026-09-20T10:00:00.000Z',
      headers: { 'user-agent': 'sw' },
    });
    expect(JSON.stringify(h.logs[0].payload)).not.toContain('123 Main St');
    expect(h.findForProviderEvent).toHaveBeenCalledWith({
      provider: FulfillmentProvider.SELLERWIX,
      accountId: 'acc-swx',
      providerOrderId: 'swx-1',
      externalOrderId: '576000000000000001',
    });
    expect(h.applyProviderState).toHaveBeenCalledTimes(1);
    expect(h.marks.at(-1)).toMatchObject({ processed: true, fulfillmentOrderId: 'ful-1' });
  });

  it('sai secret ⇒ lưu để điều tra, KHÔNG áp, không chiếm khoá chống trùng', async () => {
    const h = build();

    const result = await h.service.receive('wrong', payload(), {});

    expect(result.accepted).toBe(false);
    expect(h.logs[0]).toMatchObject({ verified: false, providerEventId: null });
    expect(h.applyProviderState).not.toHaveBeenCalled();
  });

  it('🔴 cùng sự kiện gửi lại (UNIQUE provider_event_id) ⇒ không xử lý lần hai', async () => {
    const h = build({ duplicate: true });

    const result = await h.service.receive('s3cret', payload(), {});

    expect(result).toMatchObject({ accepted: true, duplicate: true });
    expect(h.applyProviderState).not.toHaveBeenCalled();
  });

  it('sự kiện CŨ hơn sự kiện đã áp ⇒ ghi nhận, không áp', async () => {
    const h = build({ newer: true });

    await h.service.receive('s3cret', payload(), {});

    expect(h.applyProviderState).not.toHaveBeenCalled();
    expect(h.marks.at(-1)).toMatchObject({ processed: true });
  });

  it('data.store_id khác Store ID của tài khoản ⇒ không áp', async () => {
    const h = build();

    await h.service.receive(
      's3cret',
      payload({ data: { ...payload().data, store_id: 'other-store' } }),
      {},
    );

    expect(h.applyProviderState).not.toHaveBeenCalled();
    expect(h.marks.at(-1)).toMatchObject({ processed: false, deadLetter: true });
  });

  it('đơn không do NCMedia gửi ⇒ dead letter, không áp', async () => {
    const h = build({ record: null });

    await h.service.receive('s3cret', payload(), {});

    expect(h.applyProviderState).not.toHaveBeenCalled();
    expect(h.marks.at(-1)).toMatchObject({ deadLetter: true });
  });

  it('sự kiện ngoài order:updated / order:shipment (vd New Order) ⇒ bỏ qua có ghi lý do', async () => {
    const h = build();

    await h.service.receive(
      's3cret',
      payload({ event: { id: 'e2', type: 'order:created', created_at: '2026-09-20T10:00:00Z' } }),
      {},
    );

    expect(h.applyProviderState).not.toHaveBeenCalled();
    expect(h.marks.at(-1)).toMatchObject({ processed: true });
  });
});
