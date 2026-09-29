import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import {
  FulfillmentProviderInactiveException,
  FulfillmentProviderMisconfiguredException,
} from '../../exceptions/fulfillment.exceptions';

/**
 * Cấu hình KHÔNG bí mật của một tài khoản Sellerwix — lưu ở `fulfillment_accounts.provider_config`.
 *
 * - `storeId` — "Sellerwix Store ID", field BẮT BUỘC `store_id` của Fulfill order (và của tra đơn
 *   theo `reference_id`). TUỲ CHỌN khi lưu tài khoản; chỉ bắt buộc ở các đường đơn hàng.
 *
 * Dữ liệu cũ có thể còn `publicKeyId` (thời xác thực OAuth2 + JWT) — được GIỮ NGUYÊN trong JSON,
 * nhưng không còn được đọc.
 */
export interface SellerwixProviderConfig {
  storeId: string;
}

/** Tài khoản tối thiểu cần để dựng ngữ cảnh gọi API. */
export interface SellerwixAccountCredentialRef {
  id: string;
  name: string;
  isActive: boolean;
  /** API Key (Settings → Public API → Generate API Key). Đã mã hoá. */
  apiKeyEnc: string | null;
  providerConfig: Prisma.JsonValue | null;
  baseUrlOverride: string | null;
}

/** Ngữ cảnh gọi API — CHỈ sống trong bộ nhớ, không bao giờ ghi log/lưu DB. */
export interface SellerwixCallContext {
  accountId: string;
  accountName: string;
  apiKey: string;
  /** NULL ⇒ chưa cấu hình — chỉ các đường ĐƠN HÀNG cần (xem `requireStoreId`). */
  storeId: string | null;
  /** NULL ⇒ dùng cấu hình hệ thống `fulfillment.sellerwix.baseUrl`. */
  baseUrl: string | null;
}

/**
 * SellerwixCredentialService — nơi DUY NHẤT giải mã thông tin xác thực Sellerwix.
 *
 * 🔴 Sellerwix trong hệ thống này xác thực CHỈ bằng API Key (header `X-Api-Key` — xem
 * `SELLERWIX_API_KEY_HEADER`). Không đòi Public Key ID / Private Key; Store ID chỉ cần khi tạo/tra đơn.
 */
@Injectable()
export class SellerwixCredentialService {
  constructor(private readonly encryption: TiktokEncryptionService) {}

  /**
   * Ngữ cảnh cho MỌI lời gọi (danh mục, sản phẩm, biến thể, vận chuyển, đơn hàng, Test connection).
   *
   * @throws FulfillmentProviderInactiveException tài khoản đang INACTIVE
   * @throws FulfillmentProviderMisconfiguredException thiếu API Key
   */
  buildContext(account: SellerwixAccountCredentialRef): SellerwixCallContext {
    if (!account.isActive) throw new FulfillmentProviderInactiveException(account.name);

    const apiKey = account.apiKeyEnc ? this.encryption.decrypt(account.apiKeyEnc).trim() : '';
    if (!apiKey) throw new FulfillmentProviderMisconfiguredException(account.name, 'API Key');

    const storeId = SellerwixCredentialService.readConfig(account.providerConfig).storeId;
    return {
      accountId: account.id,
      accountName: account.name,
      apiKey,
      storeId: storeId || null,
      baseUrl: account.baseUrlOverride?.trim() || null,
    };
  }

  /**
   * Store ID cho các đường ĐƠN HÀNG (tạo đơn, tra đơn theo `reference_id`) — tài liệu Sellerwix
   * đánh dấu `store_id` là field bắt buộc. Thiếu ⇒ báo NGAY, trước khi gọi Sellerwix.
   */
  requireStoreId(ctx: SellerwixCallContext): string {
    if (!ctx.storeId) {
      throw new FulfillmentProviderMisconfiguredException(
        ctx.accountName,
        'Store ID (bắt buộc khi tạo/tra đơn Sellerwix)',
      );
    }
    return ctx.storeId;
  }

  /** Đọc `provider_config` — giá trị lạ/thiếu ⇒ chuỗi rỗng. */
  static readConfig(value: Prisma.JsonValue | null | undefined): SellerwixProviderConfig {
    const source =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return { storeId: typeof source.storeId === 'string' ? source.storeId.trim() : '' };
  }
}
