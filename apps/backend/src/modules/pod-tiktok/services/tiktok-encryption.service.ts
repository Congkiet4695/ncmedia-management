import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AesGcmCipher } from '../../../common/services/encryption.service';

/**
 * TiktokEncryptionService — mã hoá at-rest cho credential TikTok:
 * `access_token`, `refresh_token`, `shop_cipher`.
 *
 * Dùng KHOÁ RIÊNG `TIKTOK_ENCRYPTION_KEY` (key separation với `ACCOUNT_ENCRYPTION_KEY`):
 * lộ khoá của module Account KHÔNG kéo theo lộ token TikTok.
 *
 * Thuật toán AES-256-GCM tái sử dụng từ `AesGcmCipher` (DRY — không viết lại crypto).
 */
@Injectable()
export class TiktokEncryptionService extends AesGcmCipher {
  constructor(config: ConfigService) {
    super(config.getOrThrow<string>('tiktok.encryptionKey'), 'TIKTOK_ENCRYPTION_KEY');
  }
}
