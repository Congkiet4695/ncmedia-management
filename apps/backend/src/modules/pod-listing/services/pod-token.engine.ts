import {
  POD_TEMPLATE_TOKENS,
  POD_TEMPLATE_TOKEN_CODE_PATTERN,
  type PodTemplateToken,
} from '../constants/pod-listing.constants';

/** Cú pháp token: `{{CODE}}`, cho phép khoảng trắng thừa bên trong. */
const TOKEN_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g;

/** Một token hiển thị trên trình soạn thảo. */
export interface PodTokenDefinition {
  code: string;
  label: string;
  /** SYSTEM = lấy từ sản phẩm/shop lúc sinh listing · CUSTOM = người dùng tự đặt giá trị. */
  source: 'SYSTEM' | 'CUSTOM';
}

/**
 * Token Engine của Description Template.
 *
 * Hai nguồn token, cố ý tách bạch:
 *
 * | Nguồn  | Ở đâu | Ai đặt | Ví dụ |
 * |---|---|---|---|
 * | SYSTEM | danh sách trắng trong mã | lập trình viên | `{{PRODUCT.TITLE}}`, `{{SHOP.NAME}}` |
 * | CUSTOM | bảng `pod_description_template_tokens` | người dùng | `{{MATERIAL}}`, `{{CARE}}` |
 *
 * 🔴 Đây là lý do engine "mở rộng được" mà vẫn an toàn: thêm token mới là thêm một DÒNG
 * DỮ LIỆU, không phải sửa mã và cũng không phải mở cửa cho biểu thức tuỳ ý. Không có
 * `eval`, không có lời gọi hàm — chỉ thay chuỗi.
 *
 * Token không nhận ra thì **giữ nguyên**: người dùng nhìn thấy `{{MATERAIL}}` viết sai
 * còn hơn nhận về chuỗi rỗng mà không hiểu vì sao.
 */
export const POD_SYSTEM_TOKENS: PodTokenDefinition[] = POD_TEMPLATE_TOKENS.map((code) => ({
  code,
  label: code,
  source: 'SYSTEM' as const,
}));

/** Thay token trong một chuỗi HTML/văn bản. */
export function applyTokens(input: string, values: Record<string, string>): string {
  if (!input) return '';
  return input.replace(TOKEN_PATTERN, (match, rawCode: string) => {
    const code = rawCode.toUpperCase();
    return code in values ? values[code] : match;
  });
}

/** Danh sách mã token XUẤT HIỆN trong nội dung (đã chuẩn hoá về CHỮ IN, không trùng lặp). */
export function extractTokens(input: string): string[] {
  const found = new Set<string>();
  for (const match of input.matchAll(TOKEN_PATTERN)) {
    found.add(match[1].toUpperCase());
  }
  return [...found];
}

/**
 * Token có trong nội dung nhưng KHÔNG có nguồn giá trị nào.
 * Dùng để cảnh báo ngay trên form soạn thảo thay vì phát hiện lúc listing đã sinh.
 */
export function findUnknownTokens(input: string, customCodes: string[]): string[] {
  const known = new Set<string>([
    ...(POD_TEMPLATE_TOKENS as readonly string[]),
    ...customCodes.map((code) => code.toUpperCase()),
  ]);
  return extractTokens(input).filter((code) => !known.has(code));
}

/** Mã token do người dùng đặt có hợp lệ không (CHỮ IN, số, gạch dưới). */
export function isValidTokenCode(code: string): boolean {
  return POD_TEMPLATE_TOKEN_CODE_PATTERN.test(code);
}

/** Mã token hệ thống — dùng để chặn người dùng ghi đè token của hệ thống. */
export function isSystemToken(code: string): code is PodTemplateToken {
  return (POD_TEMPLATE_TOKENS as readonly string[]).includes(code.toUpperCase());
}
