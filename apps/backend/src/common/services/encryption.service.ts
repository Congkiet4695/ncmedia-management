import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AesGcmCipher — mã hoá đối xứng AES-256-GCM dùng chung (DRY).
 *
 * - Khoá 32 byte (base64) truyền qua constructor — không hardcode (ADR-020).
 * - Ciphertext định dạng: `v1.<iv_b64>.<tag_b64>.<data_b64>` (giải lại được khi cần dùng).
 * - KHÔNG hash (cần lấy lại giá trị gốc), KHÔNG lưu plaintext.
 *
 * Mỗi miền dữ liệu dùng MỘT khoá riêng (key separation): lộ khoá của miền này
 * không kéo theo lộ dữ liệu của miền khác.
 */
export abstract class AesGcmCipher {
  private readonly key: Buffer;

  protected constructor(keyBase64: string, envName: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) {
      throw new Error(`${envName} phải là base64 của đúng 32 byte (AES-256)`);
    }
    this.key = key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Ciphertext không đúng định dạng');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Mã hoá optional: undefined/null/'' → null. */
  encryptOptional(value?: string | null): string | null {
    return value ? this.encrypt(value) : null;
  }

  /** Giải mã optional: null → null. */
  decryptOptional(value?: string | null): string | null {
    return value ? this.decrypt(value) : null;
  }
}

/**
 * EncryptionService — mã hoá secret của Account/ShopAccount (docs/account.md D-01).
 * Khoá: ENV `ACCOUNT_ENCRYPTION_KEY`.
 */
@Injectable()
export class EncryptionService extends AesGcmCipher {
  constructor(config: ConfigService) {
    super(config.getOrThrow<string>('account.encryptionKey'), 'ACCOUNT_ENCRYPTION_KEY');
  }
}
