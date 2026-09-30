import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AesGcmCipher } from '../../../common/services/encryption.service';
import { NotificationEncryptionKeyMissingException } from '../exceptions/notification.exceptions';

/** AES-256-GCM với khoá của miền Notification (tái sử dụng `AesGcmCipher` — không viết lại crypto). */
class NotificationCipher extends AesGcmCipher {
  constructor(keyBase64: string) {
    super(keyBase64, 'NOTIFICATION_ENCRYPTION_KEY');
  }
}

/**
 * NotificationEncryptionService — mã hoá Bot Token Telegram at-rest.
 *
 * Khoá RIÊNG `NOTIFICATION_ENCRYPTION_KEY` (key separation với ACCOUNT / TIKTOK): lộ khoá miền này
 * không kéo theo lộ secret của miền khác.
 *
 * 🔴 KHÔNG fail-fast lúc khởi động (khác Account/TikTok): thiếu hoặc sai khoá chỉ làm tính năng
 * Telegram báo lỗi cấu hình rõ ràng (`NOTIFICATION_ENCRYPTION_KEY_MISSING`) — đồng bộ đơn, fulfill
 * và mọi module khác vẫn chạy bình thường.
 */
@Injectable()
export class NotificationEncryptionService {
  private readonly cipher: NotificationCipher | null;

  constructor(config: ConfigService) {
    const key = config.get<string>('notification.encryptionKey', '');
    let cipher: NotificationCipher | null = null;
    try {
      cipher = key ? new NotificationCipher(key) : null;
    } catch {
      // Khoá sai độ dài ⇒ coi như chưa cấu hình; thông điệp lỗi nói rõ cách sửa.
      cipher = null;
    }
    this.cipher = cipher;
  }

  isConfigured(): boolean {
    return this.cipher !== null;
  }

  encrypt(plain: string): string {
    return this.require().encrypt(plain);
  }

  decrypt(payload: string): string {
    return this.require().decrypt(payload);
  }

  private require(): NotificationCipher {
    if (!this.cipher) throw new NotificationEncryptionKeyMissingException();
    return this.cipher;
  }
}
