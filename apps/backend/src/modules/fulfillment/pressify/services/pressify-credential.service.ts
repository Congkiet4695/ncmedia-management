import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import {
  FulfillmentProviderInactiveException,
  FulfillmentProviderMisconfiguredException,
} from '../../exceptions/fulfillment.exceptions';

/**
 * Cấu hình KHÔNG bí mật của một tài khoản Pressify — `fulfillment_accounts.provider_config`.
 *
 * - `tierId` — bậc giá của store trên Pressify (vd "13" = Platinum). TUỲ CHỌN. API Pressify không cho
 *   biết store ở bậc nào; người dùng khai để giá biến thể (giá vốn dự kiến) theo đúng bậc của họ. Bỏ
 *   trống ⇒ không có giá dự kiến, giá vốn lấy từ số Pressify thực trừ khi đơn được thanh toán.
 */
export interface PressifyProviderConfig {
  tierId: string;
}

/** Tài khoản tối thiểu cần để dựng ngữ cảnh gọi API. */
export interface PressifyAccountCredentialRef {
  id: string;
  name: string;
  isActive: boolean;
  /** Store API key (Dashboard → Stores). Đã mã hoá. */
  apiKeyEnc: string | null;
  providerConfig: Prisma.JsonValue | null;
  baseUrlOverride: string | null;
}

/** Ngữ cảnh gọi API — CHỈ sống trong bộ nhớ, không bao giờ ghi log / lưu DB. */
export interface PressifyCallContext {
  accountId: string;
  accountName: string;
  /** Store API key. Pressify nhận key trên query string (GET) hoặc trong body JSON (POST). */
  apiKey: string;
  /** NULL ⇒ dùng cấu hình hệ thống `fulfillment.pressify.baseUrl`. */
  baseUrl: string | null;
}

/**
 * PressifyCredentialService — nơi DUY NHẤT giải mã thông tin xác thực Pressify.
 *
 * Pressify có HAI loại key (tài liệu "Authentication"): Store API key (đơn hàng, phụ kiện) và User API key
 * (tạo / liệt kê store). Tích hợp này CHỈ dùng Store API key — đúng loại key mọi endpoint đơn hàng cần.
 */
@Injectable()
export class PressifyCredentialService {
  constructor(private readonly encryption: TiktokEncryptionService) {}

  /**
   * @throws FulfillmentProviderInactiveException tài khoản đang INACTIVE
   * @throws FulfillmentProviderMisconfiguredException thiếu Store API key
   */
  buildContext(account: PressifyAccountCredentialRef): PressifyCallContext {
    if (!account.isActive) throw new FulfillmentProviderInactiveException(account.name);

    const apiKey = account.apiKeyEnc ? this.encryption.decrypt(account.apiKeyEnc).trim() : '';
    if (!apiKey) throw new FulfillmentProviderMisconfiguredException(account.name, 'Store API Key');

    return {
      accountId: account.id,
      accountName: account.name,
      apiKey,
      baseUrl: account.baseUrlOverride?.trim() || null,
    };
  }

  /** Giải mã key để so khớp (webhook) — KHÔNG kiểm trạng thái tài khoản. Lỗi giải mã ⇒ chuỗi rỗng. */
  decryptKey(account: Pick<PressifyAccountCredentialRef, 'apiKeyEnc'>): string {
    if (!account.apiKeyEnc) return '';
    try {
      return this.encryption.decrypt(account.apiKeyEnc).trim();
    } catch {
      return '';
    }
  }

  /** Đọc `provider_config` — giá trị lạ / thiếu ⇒ chuỗi rỗng. */
  static readConfig(value: Prisma.JsonValue | null | undefined): PressifyProviderConfig {
    const source =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const tier = source.tierId;
    return {
      tierId: typeof tier === 'string' ? tier.trim() : typeof tier === 'number' ? String(tier) : '',
    };
  }
}
