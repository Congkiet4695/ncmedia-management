import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * EncryptionService — mã hoá đối xứng AES-256-GCM cho secret Account (docs/account.md D-01).
 *
 * - Khoá 32 byte lấy từ ENV `ACCOUNT_ENCRYPTION_KEY` (base64) — không hardcode (ADR-020).
 * - Ciphertext định dạng: `v1.<iv_b64>.<tag_b64>.<data_b64>` (có thể giải lại để đăng nhập).
 * - KHÔNG hash (cần lấy lại), KHÔNG lưu plaintext.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const b64 = config.getOrThrow<string>('account.encryptionKey');
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) {
      throw new Error('ACCOUNT_ENCRYPTION_KEY phải là base64 của đúng 32 byte (AES-256)');
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
