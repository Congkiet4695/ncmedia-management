import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentAccount,
  FulfillmentEventType,
  FulfillmentProvider,
  FulfillmentTrigger,
  Prisma,
} from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { SELLERWIX_WEBHOOK_EVENTS } from '../constants/sellerwix.constants';
import { SellerwixOrderMapper } from '../mappers/sellerwix-order.mapper';
import { SellerwixCredentialService } from '../services/sellerwix-credential.service';
import { SellerwixFulfillmentService } from '../services/sellerwix-fulfillment.service';
import type { SellerwixWebhookPayload } from '../types/sellerwix-api.types';

const PROVIDER = FulfillmentProvider.SELLERWIX;

/** Kết quả tiếp nhận — controller luôn trả 200, chi tiết nằm ở `fulfillment_webhook_logs`. */
export interface SellerwixWebhookResult {
  accepted: boolean;
  duplicate: boolean;
  logId: string | null;
  message: string;
}

/**
 * SellerwixWebhookService — nhận sự kiện `order:updated` / `order:shipment`.
 *
 * Tài liệu (Hook → Webhooks): Sellerwix POST `{ event: { id, type, created_at }, data }` với `data`
 * "match the response object given in /order/{id}". Webhook được tạo THỦ CÔNG trong Sellerwix
 * (Settings → Public API → Hook) — không có API đăng ký.
 *
 * 🔴 Bảo mật: tài liệu KHÔNG mô tả chữ ký payload (không secret, không header ký). Giống Mango, URL
 * đăng ký mang `webhookSecret` do NCMedia sinh; request sai secret được LƯU (để điều tra) nhưng KHÔNG
 * xử lý. Thêm hai phép kiểm chống áp nhầm: `data.store_id` phải là Store ID của tài khoản, và đơn phải
 * thuộc chính tài khoản đó.
 *
 * 🔴 Trùng lặp: khoá sự kiện = `event.id` + `event.type` + `event.created_at`, UNIQUE ở DB. Ghép cả ba
 * vì ví dụ trong tài liệu có `event.id` TRÙNG với id đơn — nếu chỉ dùng `event.id` mà thực tế nó là
 * id đơn thì mọi sự kiện sau của cùng đơn sẽ bị coi là trùng và bị bỏ.
 *
 * 🔴 Thứ tự: sự kiện CŨ hơn sự kiện đã áp (theo `event.created_at`) được ghi nhận nhưng không áp.
 *
 * Áp thẳng `data` (không gọi lại Get order details): tài liệu nói `data` chính là object đơn đầy đủ,
 * còn Get order details bị giới hạn 15 request/phút — gọi lại cho mỗi webhook sẽ chạm trần.
 */
@Injectable()
export class SellerwixWebhookService {
  private readonly logger = new Logger(SellerwixWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly repo: FulfillmentRepository,
    private readonly fulfillment: SellerwixFulfillmentService,
    private readonly mapper: SellerwixOrderMapper,
    private readonly encryption: TiktokEncryptionService,
  ) {}

  async receive(
    secret: string | undefined,
    payload: SellerwixWebhookPayload,
    headers: Record<string, string>,
  ): Promise<SellerwixWebhookResult> {
    const account = await this.resolveAccountBySecret(secret);
    const eventType = payload?.event?.type?.trim() || 'unknown';
    const eventAt = this.parseDate(payload?.event?.created_at);
    const eventKey = this.eventKey(payload);

    let logId: string;
    try {
      const log = await this.repo.createWebhookLog({
        provider: PROVIDER,
        eventType: eventType.slice(0, 64),
        externalOrderId: payload?.data?.reference_id?.slice(0, 64) ?? null,
        // `data` mang địa chỉ người nhận đầy đủ ⇒ che trước khi lưu.
        payload: {
          event: payload?.event ?? null,
          data: payload?.data ? this.mapper.maskOrderForStorage(payload.data) : null,
        } as unknown as Prisma.InputJsonValue,
        headers: this.safeHeaders(headers),
        verified: Boolean(account),
        organizationId: account?.organizationId ?? null,
        accountId: account?.id ?? null,
        // Sự kiện từ nguồn KHÔNG xác thực không được chiếm khoá chống trùng của sự kiện thật.
        providerEventId: account ? eventKey : null,
        providerEventAt: eventAt,
      });
      logId = log.id;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.log({
          module: 'fulfillment',
          provider: PROVIDER,
          operation: 'webhook',
          eventType,
          msg: 'Sự kiện webhook trùng — đã nhận trước đó, bỏ qua',
        });
        return {
          accepted: true,
          duplicate: true,
          logId: null,
          message: 'Sự kiện đã được nhận trước đó',
        };
      }
      throw error;
    }

    if (!account) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: 'Secret không hợp lệ',
        deadLetter: true,
      });
      this.logger.warn({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'webhook',
        logId,
        msg: 'Webhook Sellerwix không kèm secret hợp lệ — đã lưu nhưng KHÔNG xử lý',
      });
      return { accepted: false, duplicate: false, logId, message: 'Secret không hợp lệ' };
    }

    await this.process(logId, account, payload, eventAt);
    return { accepted: true, duplicate: false, logId, message: 'Đã tiếp nhận' };
  }

  /** Thử lại webhook tồn đọng của Sellerwix (scheduler gọi). */
  async retryPending(): Promise<{ retried: number; succeeded: number }> {
    const maxAttempts = this.config.get<number>('fulfillment.webhook.maxAttempts', 5);
    const batch = this.config.get<number>('fulfillment.webhook.retryBatch', 50);
    const pending = await this.repo.findPendingWebhooks(PROVIDER, batch, maxAttempts);

    let succeeded = 0;
    for (const log of pending) {
      if (!log.accountId || !log.organizationId) continue;
      const account = await this.repo.findAccountById(log.organizationId, log.accountId);
      if (!account) continue;
      // Payload đã lưu bị che PII — không ảnh hưởng: chỉ trạng thái/tracking/chi phí được áp.
      const ok = await this.process(
        log.id,
        account,
        log.payload as unknown as SellerwixWebhookPayload,
        log.providerEventAt,
      );
      if (ok) succeeded += 1;
    }
    return { retried: pending.length, succeeded };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async process(
    logId: string,
    account: FulfillmentAccount,
    payload: SellerwixWebhookPayload,
    eventAt: Date | null,
  ): Promise<boolean> {
    const eventType = payload?.event?.type?.trim() ?? '';
    const data = payload?.data;

    if (!(SELLERWIX_WEBHOOK_EVENTS as readonly string[]).includes(eventType)) {
      // New Order hook (đơn marketplace đổ về Sellerwix) không thuộc luồng fulfillment của NCMedia.
      await this.repo.markWebhookProcessed(logId, {
        processed: true,
        errorMessage: `Bỏ qua sự kiện "${eventType || 'unknown'}" — không thuộc luồng fulfillment`,
      });
      return true;
    }
    if (!data || (!data.id && !data.reference_id)) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: 'Payload thiếu data.id / data.reference_id',
        deadLetter: true,
      });
      return false;
    }

    const storeId = SellerwixCredentialService.readConfig(account.providerConfig).storeId;
    if (data.store_id && storeId && data.store_id !== storeId) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: 'data.store_id khác Store ID của tài khoản — không áp',
        deadLetter: true,
      });
      return false;
    }

    const record = await this.repo.findForProviderEvent({
      provider: PROVIDER,
      accountId: account.id,
      providerOrderId: data.id ? String(data.id) : null,
      externalOrderId: data.reference_id ?? null,
    });
    if (!record) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: 'Không tìm thấy đơn fulfillment tương ứng (đơn không do NCMedia gửi?)',
        deadLetter: true,
      });
      return false;
    }

    if (eventAt && (await this.repo.hasNewerProcessedEvent(record.id, eventAt, logId))) {
      await this.repo.markWebhookProcessed(logId, {
        processed: true,
        fulfillmentOrderId: record.id,
        organizationId: record.organizationId,
        errorMessage: 'Sự kiện cũ hơn sự kiện đã áp — ghi nhận, không áp',
      });
      return true;
    }

    await this.repo.addHistory({
      organizationId: record.organizationId,
      fulfillmentOrderId: record.id,
      eventType: FulfillmentEventType.WEBHOOK_RECEIVED,
      trigger: FulfillmentTrigger.WEBHOOK,
      message: `Nhận webhook ${eventType}`,
      payload: {
        eventType,
        eventId: payload.event?.id ?? null,
        eventAt: eventAt?.toISOString() ?? null,
      },
    });

    try {
      await this.fulfillment.applyProviderState(record, data, FulfillmentTrigger.WEBHOOK);
      await this.repo.markWebhookProcessed(logId, {
        processed: true,
        fulfillmentOrderId: record.id,
        organizationId: record.organizationId,
      });
      return true;
    } catch (error) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        fulfillmentOrderId: record.id,
        organizationId: record.organizationId,
        errorMessage: (error as Error).message,
      });
      this.logger.error({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'webhook.process',
        fulfillmentOrderId: record.id,
        msg: `Xử lý webhook thất bại: ${(error as Error).message}`,
      });
      return false;
    }
  }

  /** Khoá chống trùng — `null` khi Sellerwix không gửi `event.id` (không chống trùng được). */
  private eventKey(payload: SellerwixWebhookPayload): string | null {
    const id = payload?.event?.id?.trim();
    if (!id) return null;
    return [id, payload.event?.type?.trim() ?? '', payload.event?.created_at?.trim() ?? '']
      .join('|')
      .slice(0, 255);
  }

  private async resolveAccountBySecret(secret?: string): Promise<FulfillmentAccount | null> {
    if (!secret) return null;
    const accounts = await this.repo.findAccountsWithWebhookSecret(PROVIDER);
    for (const account of accounts) {
      if (!account.webhookSecretEnc) continue;
      try {
        if (this.safeEqual(this.encryption.decrypt(account.webhookSecretEnc), secret)) {
          return account;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }

  private safeHeaders(headers: Record<string, string>): Record<string, string> {
    const allowed = ['user-agent', 'content-type', 'x-request-id', 'x-forwarded-for'];
    return Object.fromEntries(
      Object.entries(headers ?? {}).filter(([key]) => allowed.includes(key.toLowerCase())),
    );
  }

  private parseDate(value: string | undefined): Date | null {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time) : null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
