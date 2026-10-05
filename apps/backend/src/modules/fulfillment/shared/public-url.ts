import { BadRequestException } from '@nestjs/common';
import { isPublicHostname } from '../../../common/utils/network-address.util';

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
  return assertPublicUrl(raw, ['https:']);
}

/**
 * Kiểm một URL mà **chính hệ thống sẽ tải về** (design nhập bằng URL ⇒ tải về ⇒ lưu R2).
 *
 * Nhận cả `http:` (file được tải về server rồi lưu lại, nhà cung cấp chỉ thấy URL R2). Đây chỉ là
 * kiểm HÌNH THỨC lúc nhập — IP thật mà DNS trả về được kiểm lại ngay lúc kết nối, ở mọi bước
 * chuyển hướng (`common/http/safe-remote-fetch.ts`).
 */
export function assertPublicDownloadUrl(raw: string): string {
  return assertPublicUrl(raw, ['https:', 'http:']);
}

function assertPublicUrl(raw: string, protocols: readonly string[]): string {
  const value = (raw ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid('MALFORMED', 'URL design không đúng định dạng.');
  }

  if (!protocols.includes(parsed.protocol)) {
    throw protocols.includes('http:')
      ? invalid('UNSUPPORTED_PROTOCOL', 'URL design phải dùng http hoặc https.')
      : invalid('NOT_HTTPS', 'URL design phải dùng HTTPS để xưởng in tải được file.');
  }
  if (parsed.username || parsed.password) {
    throw invalid('CREDENTIALS_IN_URL', 'URL design không được chứa tài khoản/mật khẩu.');
  }
  if (!isPublicHostname(parsed.hostname)) {
    throw invalid(
      'NOT_PUBLIC',
      'URL design phải là địa chỉ CÔNG KHAI — không nhận localhost / mạng nội bộ.',
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
