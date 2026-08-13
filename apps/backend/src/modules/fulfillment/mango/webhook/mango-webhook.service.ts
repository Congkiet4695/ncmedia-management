import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, FulfillmentTrigger, Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { MangoApiClient } from '../clients/mango-api.client';
import { MangoCredentialService } from '../services/mango-credential.service';
import { MangoFulfillmentService } from '../services/mango-fulfillment.service';
import type { MangoWebhookPayload } from '../types/mango-api.types';

/** Kết quả xử lý một webhook — controller chỉ cần biết đã nhận hay chưa. */
export interface WebhookProcessResult {
  accepted: boolean;
  logId: string;
  message: string;
}

/**
 * MangoWebhookService — nhận và xử lý webhook của MangoTeePrints.
 *
 * 🔴 **Ghi chú quan trọng về bảo mật:** tài liệu Mango (mục Webhooks và schema
 * `WebhookCreate`) **KHÔNG mô tả cơ chế ký payload** — không có secret, không có header
 * chữ ký. Vì vậy hệ thống KHÔNG thể xác minh chữ ký theo chuẩn nhà cung cấp.
 * Biện pháp thay thế: mỗi tài khoản có một `webhookSecret` do NCMedia sinh, nhúng vào
 * chính URL đăng ký với Mango; request không mang đúng secret sẽ bị từ chối.
 * Xem docs/fulfillment/README.md §Webhook để biết hạn chế và hướng nâng cấp.
 *
 * Nguyên tắc xử lý:
 *  1. LƯU RAW TRƯỚC, xử lý sau — không bao giờ mất sự kiện dù xử lý lỗi.
 *  2. Trả 2xx ngay khi đã lưu, để Mango không retry vô ích (Mango tự tắt webhook
 *     sau 10 lần lỗi liên tiếp — mất webhook còn tệ hơn xử lý chậm).
 *  3. Sự kiện xử lý lỗi nằm lại hàng đợi, scheduler thử lại; quá ngưỡng ⇒ dead letter.
 */
@Injectable()
export class MangoWebhookService {
  private readonly logger = new Logger(MangoWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly repo: FulfillmentRepository,
    private readonly fulfillmentService: MangoFulfillmentService,
    private readonly client: MangoApiClient,
    private readonly encryption: TiktokEncryptionService,
    private readonly credentials: MangoCredentialService,
  ) {}

  /**
   * Tiếp nhận một webhook.
   *
   * @param secret Secret lấy từ URL (do NCMedia sinh khi đăng ký webhook).
   */
  async receive(
    secret: string | undefined,
    payload: MangoWebhookPayload,
    headers: Record<string, string>,
  ): Promise<WebhookProcessResult> {
    const externalOrderId = payload.order_id ?? null;

    // Tìm tài khoản khớp secret TRƯỚC khi tin payload — biết được sự kiện thuộc tổ chức nào.
    const account = await this.resolveAccountBySecret(secret);

    const log = await this.repo.createWebhookLog({
      provider: FulfillmentProvider.MANGO,
      eventType: payload.event ?? 'unknown',
      externalOrderId,
      payload: payload as unknown as Prisma.InputJsonValue,
      headers: this.safeHeaders(headers),
      verified: Boolean(account),
      organizationId: account?.organizationId ?? null,
      accountId: account?.id ?? null,
    });

    if (!account) {
      this.logger.warn({
        module: 'fulfillment',
        provider: 'MANGO',
        operation: 'webhook',
        externalOrderId,
        msg: 'Webhook không kèm secret hợp lệ — đã lưu nhưng KHÔNG xử lý',
      });
      await this.repo.markWebhookProcessed(log.id, {
        processed: false,
        errorMessage: 'Secret không hợp lệ',
        deadLetter: true,
      });
      return { accepted: false, logId: log.id, message: 'Secret không hợp lệ' };
    }

    // Xử lý ngay; lỗi thì để lại hàng đợi cho scheduler thử lại.
    await this.process(log.id, payload);
    return { accepted: true, logId: log.id, message: 'Đã tiếp nhận' };
  }

  /**
   * Xử lý một bản ghi webhook (dùng cho cả lần đầu lẫn khi retry).
   * Trả `true` nếu xử lý xong.
   */
  async process(logId: string, payload: MangoWebhookPayload): Promise<boolean> {
    const externalOrderId = payload.order_id;
    if (!externalOrderId) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: 'Payload thiếu order_id',
        deadLetter: true,
      });
      return false;
    }

    const record = await this.repo.findByExternalOrderId(externalOrderId);
    if (!record) {
      // Đơn không thuộc hệ thống này (hoặc đã bị xoá) ⇒ không có gì để làm, không retry.
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: `Không tìm thấy đơn fulfillment với order_id=${externalOrderId}`,
        deadLetter: true,
      });
      return false;
    }

    const account = await this.repo.findAccountById(record.organizationId, record.accountId);
    if (!account) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        fulfillmentOrderId: record.id,
        organizationId: record.organizationId,
        errorMessage: 'Tài khoản fulfillment không còn tồn tại',
        deadLetter: true,
      });
      return false;
    }

    await this.repo.addHistory({
      organizationId: record.organizationId,
      fulfillmentOrderId: record.id,
      eventType: 'WEBHOOK_RECEIVED',
      trigger: FulfillmentTrigger.WEBHOOK,
      providerStatus:
        payload.event === 'order.status' ? (payload.current_status ?? null) : null,
      message: `Nhận webhook ${payload.event}`,
      payload: payload as unknown as Prisma.InputJsonValue,
    });

    try {
      /**
       * 🔴 Webhook chỉ mang trạng thái/tracking, KHÔNG mang đủ dữ liệu đơn (phí, item...).
       * Vì vậy dùng webhook làm TÍN HIỆU rồi gọi Get Order Detail để lấy trạng thái đầy đủ
       * — vừa chính xác, vừa dùng chung đúng một đường cập nhật với scheduler.
       */
      const result = await this.client.getOrder(
        this.credentials.buildContext(account),
        record.externalOrderId,
      );
      await this.fulfillmentService.applyProviderState(
        record,
        result.data,
        FulfillmentTrigger.WEBHOOK,
        { durationMs: result.durationMs, requestId: result.requestId },
      );

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
        provider: 'MANGO',
        operation: 'webhook.process',
        fulfillmentOrderId: record.id,
        msg: `Xử lý webhook thất bại: ${(error as Error).message}`,
      });
      return false;
    }
  }

  /**
   * Thử lại các webhook chưa xử lý được (gọi từ scheduler).
   * Vượt ngưỡng số lần thử ⇒ bản ghi ở lại dead letter để người vận hành xem.
   */
  async retryPending(): Promise<{ retried: number; succeeded: number }> {
    const maxAttempts = this.config.get<number>('fulfillment.webhook.maxAttempts', 5);
    const batch = this.config.get<number>('fulfillment.webhook.retryBatch', 50);
    const pending = await this.repo.findPendingWebhooks(batch, maxAttempts);

    let succeeded = 0;
    for (const log of pending) {
      const ok = await this.process(log.id, log.payload as unknown as MangoWebhookPayload);
      if (ok) succeeded += 1;
    }

    if (pending.length > 0) {
      this.logger.log({
        module: 'fulfillment',
        operation: 'webhook.retry',
        retried: pending.length,
        succeeded,
        msg: 'Đã thử lại webhook tồn đọng',
      });
    }
    return { retried: pending.length, succeeded };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Tìm tài khoản có `webhookSecret` khớp — so sánh chống tấn công thời gian. */
  private async resolveAccountBySecret(secret?: string) {
    if (!secret) return null;
    const accounts = await this.repo.findAccountsWithWebhookSecret();
    for (const account of accounts) {
      if (!account.webhookSecretEnc) continue;
      try {
        if (this.safeEqual(this.encryption.decrypt(account.webhookSecretEnc), secret)) {
          return account;
        }
      } catch {
        // Secret hỏng/không giải mã được ⇒ bỏ qua tài khoản đó, không làm sập luồng.
        continue;
      }
    }
    return null;
  }

  /** So sánh chuỗi thời gian hằng định (chống dò secret qua thời gian phản hồi). */
  private safeEqual(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }

  /** Chỉ giữ header hữu ích cho truy vết, bỏ mọi thứ có thể chứa bí mật. */
  private safeHeaders(headers: Record<string, string>): Record<string, string> {
    const allowed = ['user-agent', 'content-type', 'x-request-id', 'x-forwarded-for'];
    return Object.fromEntries(
      Object.entries(headers).filter(([key]) => allowed.includes(key.toLowerCase())),
    );
  }
}
