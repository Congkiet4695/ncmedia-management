/**
 * Mask email (PII) trước khi ghi log — Decision-018 / ADR-024.
 * Ví dụ: "admin@ncmedia.com" -> "a***@ncmedia.com". Không log email đầy đủ ở mức info.
 */
export function maskEmail(email: string): string {
  if (typeof email !== 'string' || email.length === 0) return '***';
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}
