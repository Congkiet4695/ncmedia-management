import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';

/**
 * Kiểm một URL mà **nhà cung cấp fulfillment sẽ tự tải về** (design nguồn URL).
 *
 * 🔴 Không gửi request tới URL: kiểm ở đây là kiểm HÌNH THỨC + tính "công khai" của host. Xưởng
 * in nằm ngoài mạng của hệ thống, nên `localhost`, IP nội bộ, tên miền nội bộ không bao giờ tải
 * được — chặn ngay lúc nhập với lỗi rõ ràng thay vì để đơn hỏng ở phía nhà cung cấp.
 *
 * Trả về URL đã chuẩn hoá (cắt khoảng trắng). Lỗi ⇒ 400 `FULFILLMENT_DESIGN_URL_INVALID`
 * kèm `details.reason` để giao diện nói đúng lỗi nằm ở URL (không phải upload / nhà cung cấp).
 */
export function assertPublicHttpsUrl(raw: string): string {
  const value = (raw ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid('MALFORMED', 'URL design không đúng định dạng.');
  }

  if (parsed.protocol !== 'https:') {
    throw invalid('NOT_HTTPS', 'URL design phải dùng HTTPS để xưởng in tải được file.');
  }
  if (parsed.username || parsed.password) {
    throw invalid('CREDENTIALS_IN_URL', 'URL design không được chứa tài khoản/mật khẩu.');
  }
  if (!isPublicHost(parsed.hostname)) {
    throw invalid(
      'NOT_PUBLIC',
      'URL design phải là địa chỉ CÔNG KHAI — xưởng in không truy cập được localhost / mạng nội bộ.',
    );
  }
  return value;
}

function invalid(reason: string, message: string): BadRequestException {
  return new BadRequestException({
    code: 'FULFILLMENT_DESIGN_URL_INVALID',
    message,
    details: { reason },
  });
}

/** Host có thể truy cập từ Internet: có TLD, không phải IP nội bộ / loopback / link-local. */
function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return !isPrivateIpv4(host);
  if (ipVersion === 6) return !isPrivateIpv6(host);

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
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  return (
    ip === '::' ||
    ip === '::1' ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    ip.startsWith('fe80') ||
    ip.startsWith('::ffff:')
  );
}
