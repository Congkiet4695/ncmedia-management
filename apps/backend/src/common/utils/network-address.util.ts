import { isIP } from 'node:net';

/**
 * Phân loại địa chỉ mạng — MỘT nguồn cho mọi hàng rào "chỉ địa chỉ công khai" (chống SSRF).
 *
 * 🔴 Dùng chung cho cả kiểm HÌNH THỨC lúc nhập (hostname / IP viết trong URL) lẫn kiểm lúc KẾT NỐI
 * (IP thật mà DNS trả về — xem `safe-remote-fetch.ts`). Hai bản danh sách dải IP là hai bản sẽ lệch
 * nhau ở lần vá đầu tiên.
 */

/** IP (v4/v6) có thể định tuyến trên Internet công cộng. Chuỗi không phải IP ⇒ `false`. */
export function isPublicIpAddress(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(ip);
  if (version === 4) return !isPrivateIpv4(ip);
  if (version === 6) return !isPrivateIpv6(ip);
  return false;
}

/**
 * Hostname trong URL trỏ ra Internet: IP công khai, hoặc tên miền có TLD và không thuộc hậu tố nội
 * bộ. Chỉ là kiểm hình thức — tên miền công khai vẫn có thể phân giải về IP nội bộ, nên nơi THỰC SỰ
 * kết nối phải kiểm lại IP (xem `safe-remote-fetch.ts`).
 */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (isIP(host)) return isPublicIpAddress(host);
  if (host === 'localhost' || !host.includes('.')) return false;
  return !/\.(local|localhost|internal|lan|home|corp|intranet)$/.test(host);
}

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // 198.18.0.0/15 — dải benchmark, hay bị dùng cho mạng nội bộ.
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  // IPv4 nhúng trong IPv6 (`::ffff:127.0.0.1`) ⇒ phân loại theo IPv4 bên trong.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return (
    ip === '::' ||
    ip === '::1' ||
    ip.startsWith('::ffff:') ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    ip.startsWith('fe80') ||
    ip.startsWith('ff')
  );
}
