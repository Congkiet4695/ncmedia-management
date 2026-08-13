import { Injectable, Logger } from '@nestjs/common';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import {
  FulfillmentProviderInactiveException,
  FulfillmentProviderMisconfiguredException,
} from '../../exceptions/fulfillment.exceptions';
import type { MangoCallContext } from '../clients/mango-api.client';

/** Tài khoản tối thiểu cần để dựng ngữ cảnh gọi API. */
export interface MangoAccountCredentialRef {
  id: string;
  organizationId: string;
  name: string;
  isActive: boolean;
  /** API key đã mã hoá. Bắt buộc phải có — không còn nguồn dự phòng nào khác. */
  apiKeyEnc: string | null;
  baseUrlOverride: string | null;
}

/**
 * MangoCredentialService — nơi DUY NHẤT lấy thông tin xác thực cho một lần gọi Mango.
 *
 * 🔴 API key CHỈ đến từ bản ghi nhà cung cấp trong database (đã mã hoá AES-256-GCM).
 * KHÔNG đọc biến môi trường, KHÔNG có giá trị mặc định trong source. Nhờ vậy mỗi TikTok
 * Account có thể trỏ tới một tài khoản Mango khác nhau, và không tồn tại đường nào để một
 * key "toàn cục" bị dùng nhầm cho tổ chức khác.
 *
 * Ba điều kiện dưới đây được kiểm TRƯỚC khi gọi API, để lỗi cấu hình hiện ra dưới dạng
 * thông báo đọc được thay vì HTTP 401 từ nhà cung cấp:
 *   1. Nhà cung cấp đang ACTIVE.
 *   2. API key không rỗng.
 *   3. Base URL không rỗng.
 */
@Injectable()
export class MangoCredentialService {
  private readonly logger = new Logger(MangoCredentialService.name);

  constructor(private readonly encryption: TiktokEncryptionService) {}

  /**
   * Dựng ngữ cảnh gọi API cho một nhà cung cấp.
   *
   * @throws FulfillmentProviderInactiveException nhà cung cấp đang INACTIVE
   * @throws FulfillmentProviderMisconfiguredException thiếu API key hoặc base URL
   */
  buildContext(account: MangoAccountCredentialRef): MangoCallContext {
    if (!account.isActive) {
      throw new FulfillmentProviderInactiveException(account.name);
    }

    const baseUrl = account.baseUrlOverride?.trim();
    if (!baseUrl) {
      throw new FulfillmentProviderMisconfiguredException(account.name, 'API Base URL');
    }

    const apiKey = this.decryptApiKey(account);

    this.logger.debug({
      module: 'fulfillment',
      provider: 'MANGO',
      accountId: account.id,
      msg: 'Dựng ngữ cảnh gọi MangoTeePrints',
    });

    return { apiKey, baseUrl };
  }

  /**
   * Giải mã API key của nhà cung cấp.
   *
   * Tách riêng để kiểm thử được điều kiện "key rỗng" mà không cần dựng cả ngữ cảnh,
   * và để chỉ có ĐÚNG MỘT chỗ trong toàn hệ thống chạm vào giá trị key sau giải mã.
   */
  decryptApiKey(account: MangoAccountCredentialRef): string {
    if (!account.apiKeyEnc) {
      throw new FulfillmentProviderMisconfiguredException(account.name, 'API Key');
    }

    const apiKey = this.encryption.decrypt(account.apiKeyEnc).trim();
    if (!apiKey) {
      throw new FulfillmentProviderMisconfiguredException(account.name, 'API Key');
    }
    return apiKey;
  }
}
