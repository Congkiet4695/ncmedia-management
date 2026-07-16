import { randomBytes } from 'node:crypto';

/**
 * Sinh mật khẩu tạm thời ngẫu nhiên, entropy cao (auto-generate cho Employee).
 * Base64url của 18 byte (~24 ký tự) + đảm bảo có ít nhất 1 chữ và 1 số.
 * KHÔNG lưu plaintext ở đâu — chỉ trả về một lần khi tạo.
 */
export function generateTemporaryPassword(): string {
  const random = randomBytes(18).toString('base64url');
  return `${random}A9`;
}
