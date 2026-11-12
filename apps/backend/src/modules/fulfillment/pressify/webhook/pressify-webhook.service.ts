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
import { PressifyOrderMapper } from '../mappers/pressify-order.mapper';
import { PressifyCredentialService } from '../services/pressify-credential.service';
import { PressifyFulfillmentService } from '../services/pressify-fulfillment.service';
import type { PressifyWebhookPayload } from '../types/pressify-api.types';

const PROVIDER = FulfillmentProvider.PRESSIFY;

export interface PressifyWebhookResult {
  accepted: boolean;
  duplicate: boolean;
  logId: string | null;
  message: string;
}

/**
 * PressifyWebhookService — nhận cập nhật đơn Pressify (tài liệu "Webhooks").
 *
 * Tài liệu: Pressify POST `{ data: { id, ref_id, status, tracking, carrier_code, tracking_url, label_url,
 * api_key, … } }` khi đơn chuyển bước; phải trả 2xx trong 10 giây. URL cài ở Dashboard → Profile → Details →
 * Webhook url — MỘT URL cho mọi store của tài khoản Pressify.
 *
 * 🔴 Xác thực hai lớp (tài liệu không có chữ ký payload):
 *   1. `secret` trên đường dẫn — sinh riêng cho từng tài khoản NCMedia (giống Mango / Sellerwix);
 *   2. `data.api_key` phải TRÙNG Store API key của chính tài khoản đó (so sánh thời gian hằng). Một store khác
 *      của cùng tài khoản Pressify gửi tới URL này ⇒ không áp.
 *
 * 🔴 Không có thời điểm sự kiện trong payload ⇒ không xếp thứ tự được. Webhook chỉ là TÍN HIỆU: hệ thống ĐỌC
 * LẠI đơn (GET /order/{id}) và áp trạng thái thật — sự kiện tới trễ / lộn thứ tự không làm lùi trạng thái.
 * `tracking_url` / `carrier_code` / `label_url` (chỉ có ở webhook) được ghép thêm.
 *
 * Payload lưu vào `fulfillment_webhook_logs` đã bỏ `api_key`.
 */
@Injectable()
export class PressifyWebhookService {
  private readonly logger = new Logger(PressifyWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly repo: FulfillmentRepository,
    private readonly fulfillment: PressifyFulfillmentService,
    private readonly mapper: PressifyOrderMapper,
    private readonly credentials: PressifyCredentialService,
    private readonly encryption: TiktokEncryptionService,
  ) {}

  async receive(
    secret: string | undefined,
    payload: PressifyWebhookPayload,
    headers: Record<string, string>,
  ): Promise<PressifyWebhookResult> {
    const account = await this.resolveAccountBySecret(secret);
    const data = payload?.data;
    const status = data?.status?.trim().toLowerCase() || 'unknown';
    const keyMatches = account ? this.keyMatches(account, data?.api_key) : false;
    const verified = Boolean(account) && keyMatches;

    let logId: string;
    try {
      const log = await this.repo.createWebhookLog({
        provider: PROVIDER,
        eventType: status.slice(0, 64),
        externalOrderId: data?.ref_id?.slice(0, 64) ?? null,
        payload: this.mapper.maskWebhookForStorage(payload) as unknown as Prisma.InputJsonValue,
        headers: this.safeHeaders(headers),
        verified,
        organizationId: verified ? (account?.organizationId ?? null) : null,
        accountId: verified ? (account?.id ?? null) : null,
        // Khoá chống trùng: cùng đơn + cùng trạng thái + cùng tracking ⇒ cùng một bước. Nguồn không xác
        // thực không được chiếm khoá của sự kiện thật.
        providerEventId: verified ? this.eventKey(payload) : null,
        providerEventAt: null,
      });
      logId = log.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return {
          accepted: true,
          duplicate: true,
          logId: null,
          message: 'Sự kiện đã được nhận trước đó',
        };
      }
      throw error;
    }

    if (!account || !keyMatches) {
      const reason = !account
        ? 'Secret không hợp lệ'
        : 'data.api_key không khớp Store API key của tài khoản';
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: reason,
        deadLetter: true,
      });
      this.logger.warn({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'webhook',
        logId,
        msg: `Webhook Pressify không xác thực được (${reason}) — đã lưu nhưng KHÔNG xử lý`,
      });
      return { accepted: false, duplicate: false, logId, message: reason };
    }

    await this.process(logId, account, payload);
    return { accepted: true, duplicate: false, logId, message: 'Đã tiếp nhận' };
  }

  /** Thử lại webhook tồn đọng (scheduler gọi). Payload đã lưu không còn api_key — đã xác thực lúc nhận. */
  async retryPending(): Promise<{ retried: number; succeeded: number }> {
    const maxAttempts = this.config.get<number>('fulfillment.webhook.maxAttempts', 5);
    const batch = this.config.get<number>('fulfillment.webhook.retryBatch', 50);
    const pending = await this.repo.findPendingWebhooks(PROVIDER, batch, maxAttempts);
    let succeeded = 0;
    for (const log of pending) {
      if (!log.accountId || !log.organizationId) continue;
      const account = await this.repo.findAccountById(log.organizationId, log.accountId);
      if (!account) continue;
      if (await this.process(log.id, account, log.payload as unknown as PressifyWebhookPayload))
        succeeded += 1;
    }
    return { retried: pending.length, succeeded };
  }

  private async process(
    logId: string,
    account: FulfillmentAccount,
    payload: PressifyWebhookPayload,
  ): Promise<boolean> {
    const data = payload?.data;
    if (!data || (data.id === undefined && !data.ref_id)) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: 'Payload thiếu data.id / data.ref_id',
        deadLetter: true,
      });
      return false;
    }

    const record = await this.repo.findForProviderEvent({
      provider: PROVIDER,
      accountId: account.id,
      providerOrderId: data.id !== undefined && data.id !== null ? String(data.id) : null,
      externalOrderId: data.ref_id ?? null,
    });
    if (!record) {
      await this.repo.markWebhookProcessed(logId, {
        processed: false,
        errorMessage: 'Không tìm thấy đơn fulfillment tương ứng (đơn không do NCMedia gửi?)',
        deadLetter: true,
      });
      return false;
    }

    await this.repo.addHistory({
      organizationId: record.organizationId,
      fulfillmentOrderId: record.id,
      eventType: FulfillmentEventType.WEBHOOK_RECEIVED,
      trigger: FulfillmentTrigger.WEBHOOK,
      message: `Nhận webhook Pressify (${data.status ?? 'không rõ trạng thái'})`,
      payload: { status: data.status ?? null, hasTracking: Boolean(data.tracking) },
    });

    try {
      await this.fulfillment.refreshFromWebhook(record, account, {
        trackingUrl: data.tracking_url ?? null,
        carrier: data.carrier_code ?? null,
        labelUrl: data.label_url ?? null,
      });
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
        msg: `Xử lý webhook thất bại (scheduler sẽ thử lại): ${(error as Error).message}`,
      });
      return false;
    }
  }

  private eventKey(payload: PressifyWebhookPayload): string | null {
    const data = payload?.data;
    if (!data || data.id === undefined || data.id === null) return null;
    return [String(data.id), data.status?.trim() ?? '', data.tracking?.trim() ?? '']
      .join('|')
      .slice(0, 255);
  }

  private keyMatches(account: FulfillmentAccount, provided: string | undefined): boolean {
    const expected = this.credentials.decryptKey(account);
    if (!expected || !provided) return false;
    return this.safeEqual(expected, provided.trim());
  }

  private async resolveAccountBySecret(secret?: string): Promise<FulfillmentAccount | null> {
    if (!secret) return null;
    const accounts = await this.repo.findAccountsWithWebhookSecret(PROVIDER);
    for (const account of accounts) {
      if (!account.webhookSecretEnc) continue;
      try {
        if (this.safeEqual(this.encryption.decrypt(account.webhookSecretEnc), secret))
          return account;
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
}
