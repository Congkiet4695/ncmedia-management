import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createPrivateKey } from 'node:crypto';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import {
  FulfillmentProviderInactiveException,
  FulfillmentProviderMisconfiguredException,
} from '../../exceptions/fulfillment.exceptions';

/**
 * Cấu hình KHÔNG bí mật của một tài khoản Sellerwix — lưu ở `fulfillment_accounts.provider_config`.
 *
 * - `storeId`      — "Sellerwix Store ID", field BẮT BUỘC `store_id` của Fulfill order.
 * - `publicKeyId`  — Key ID Sellerwix trả về khi upload public key; đi vào header `kid` của JWT.
 */
export interface SellerwixProviderConfig {
  storeId: string;
  publicKeyId: string;
}

/** Tài khoản tối thiểu cần để dựng ngữ cảnh gọi API. */
export interface SellerwixAccountCredentialRef {
  id: string;
  name: string;
  isActive: boolean;
  /** API Key (Settings → Public API → Generate API Key) — `iss` và `sub` của JWT. Đã mã hoá. */
  apiKeyEnc: string | null;
  /** Private key RSA 2048 (PEM) — dùng ký JWT RS256. Đã mã hoá. */
  secretEnc: string | null;
  providerConfig: Prisma.JsonValue | null;
  baseUrlOverride: string | null;
  /** Đổi thông tin xác thực ⇒ `updatedAt` đổi ⇒ access token cũ trong bộ nhớ bị bỏ. */
  updatedAt: Date;
}

/** Ngữ cảnh gọi API — CHỈ sống trong bộ nhớ, không bao giờ ghi log/lưu DB. */
export interface SellerwixCallContext {
  accountId: string;
  /** Khoá bộ nhớ đệm access token — đổi cấu hình là đổi khoá. */
  tokenCacheKey: string;
  apiKey: string;
  publicKeyId: string;
  privateKeyPem: string;
  storeId: string;
  /** NULL ⇒ dùng cấu hình hệ thống `fulfillment.sellerwix.baseUrl`. */
  baseUrl: string | null;
}

/**
 * SellerwixCredentialService — nơi DUY NHẤT giải mã thông tin xác thực Sellerwix.
 *
 * Tài liệu (Authentication, cập nhật 2026-06-03): OAuth 2.0 Client Credentials với JWT Bearer
 * Assertion ký RS256. Bốn thứ cần có: API Key, Public Key ID, private key RSA, và Store ID (bắt buộc
 * khi tạo đơn). Thiếu thứ nào thì báo NGAY, thay vì để Sellerwix trả 401 khó hiểu giữa luồng gửi đơn.
 */
@Injectable()
export class SellerwixCredentialService {
  constructor(private readonly encryption: TiktokEncryptionService) {}

  /**
   * @throws FulfillmentProviderInactiveException tài khoản đang INACTIVE
   * @throws FulfillmentProviderMisconfiguredException thiếu một trong bốn thông tin xác thực
   */
  buildContext(account: SellerwixAccountCredentialRef): SellerwixCallContext {
    if (!account.isActive) throw new FulfillmentProviderInactiveException(account.name);

    const config = SellerwixCredentialService.readConfig(account.providerConfig);
    if (!config.storeId) {
      throw new FulfillmentProviderMisconfiguredException(account.name, 'Store ID');
    }
    if (!config.publicKeyId) {
      throw new FulfillmentProviderMisconfiguredException(account.name, 'Public Key ID');
    }

    const apiKey = this.decryptRequired(account.apiKeyEnc, account.name, 'API Key');
    const privateKeyPem = this.decryptRequired(account.secretEnc, account.name, 'Private Key');

    return {
      accountId: account.id,
      tokenCacheKey: `${account.id}:${account.updatedAt.getTime()}`,
      apiKey,
      publicKeyId: config.publicKeyId,
      privateKeyPem,
      storeId: config.storeId,
      baseUrl: account.baseUrlOverride?.trim() || null,
    };
  }

  /** Đọc `provider_config` — giá trị lạ/thiếu ⇒ chuỗi rỗng (để `buildContext` báo đúng field). */
  static readConfig(value: Prisma.JsonValue | null | undefined): SellerwixProviderConfig {
    const source =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const text = (input: unknown): string => (typeof input === 'string' ? input.trim() : '');
    return { storeId: text(source.storeId), publicKeyId: text(source.publicKeyId) };
  }

  /**
   * Kiểm tra private key NGAY lúc lưu: dán thiếu dòng BEGIN/END hay dán nhầm public key là lỗi
   * phổ biến nhất, và nếu để tới lúc gửi đơn mới lộ ra thì thông báo sẽ là một lỗi ký JWT khó hiểu.
   *
   * @returns thông báo lỗi, hoặc `null` khi key dùng được để ký RS256.
   */
  static validatePrivateKey(pem: string): string | null {
    try {
      const key = createPrivateKey({ key: pem, format: 'pem' });
      if (key.asymmetricKeyType !== 'rsa') {
        return `Private key phải là khoá RSA (đang là ${key.asymmetricKeyType ?? 'không xác định'}).`;
      }
      return null;
    } catch {
      return 'Private key không đọc được — dán NGUYÊN nội dung file private_key.pem, gồm cả dòng BEGIN/END.';
    }
  }

  private decryptRequired(encrypted: string | null, accountName: string, field: string): string {
    if (!encrypted) throw new FulfillmentProviderMisconfiguredException(accountName, field);
    const value = this.encryption.decrypt(encrypted).trim();
    if (!value) throw new FulfillmentProviderMisconfiguredException(accountName, field);
    return value;
  }
}
