/**
 * Luật hiển thị của **"Lấy nhãn từ TikTok"** — thuần, không React ⇒ kiểm được bằng
 * `npm run test:fulfill-config`.
 *
 * 🔴 Backend trả MÃ lỗi riêng cho từng nguyên nhân (xác thực, đơn không hợp lệ, không có dịch vụ,
 * tạo gói thất bại, chưa có nhãn, rate limit, mất kết nối…). Giao diện dịch theo mã — không hiện
 * câu chung "Internal server error" — và chỉ chèn thông điệp AN TOÀN của TikTok (`providerMessage`).
 */

import { providerErrorBody, providerErrorTrace } from './provider-error';

/** Một dịch vụ vận chuyển TikTok cho phép — backend gửi kèm khi cần người vận hành chọn. */
export interface TiktokShippingServiceChoice {
  id: string;
  name: string | null;
  shippingProviderName: string | null;
}

/** Các mã lỗi của luồng lấy nhãn mà giao diện có bản dịch riêng. */
export const TIKTOK_LABEL_ERROR_CODES = [
  'SHIPPING_LABEL_BUSY',
  'SHIPPING_LABEL_INTERNAL_ERROR',
  'TIKTOK_SCOPE_MISSING',
  'TIKTOK_SHOP_CONTEXT_UNAVAILABLE',
  'TIKTOK_RATE_LIMITED',
  'TIKTOK_UNREACHABLE',
  'TIKTOK_ORDER_NOT_FOUND',
  'TIKTOK_ORDER_NOT_PACKABLE',
  'TIKTOK_LABEL_NOT_TIKTOK_SHIPPING',
  'TIKTOK_NO_ELIGIBLE_SHIPPING_SERVICE',
  'TIKTOK_SHIPPING_SERVICE_SELECTION_REQUIRED',
  'TIKTOK_SHIPPING_SERVICE_INVALID',
  'TIKTOK_PACKAGE_CREATE_FAILED',
  'TIKTOK_SHIPPING_DOCUMENT_UNAVAILABLE',
  'TIKTOK_SHIPPING_LABEL_UNAVAILABLE',
] as const;
export type TiktokLabelErrorCode = (typeof TIKTOK_LABEL_ERROR_CODES)[number];

/** Cách hiển thị một lỗi lấy nhãn. `key = null` ⇒ lỗi lạ, dùng thông điệp chung của hệ thống. */
export interface TiktokLabelErrorView {
  code: string | null;
  /** Khoá i18n (namespace `fulfillment`), vd `fulfill.label.error.TIKTOK_UNREACHABLE`. */
  key: string | null;
  /** Tham số cho bản dịch: `message` (lý do an toàn của TikTok), `reference` (mã tham chiếu). */
  params: { message: string; reference: string };
  /** `TIKTOK · CREATE_PACKAGE · 21011024 · req-…` — để đối soát; rỗng khi không có. */
  trace: string;
  /** Dịch vụ để người vận hành chọn (chỉ có khi TikTok trả nhiều dịch vụ mà không có mặc định). */
  services: TiktokShippingServiceChoice[];
}

interface LabelErrorDetails {
  provider?: string;
  operation?: string;
  providerCode?: string | null;
  requestId?: string | null;
  providerMessage?: string | null;
  referenceId?: string | null;
  shippingServices?: TiktokShippingServiceChoice[];
}

const isKnownCode = (code: string | undefined): code is TiktokLabelErrorCode =>
  Boolean(code) && (TIKTOK_LABEL_ERROR_CODES as readonly string[]).includes(code as string);

/** Đọc một lỗi của "Lấy nhãn từ TikTok" thành thứ giao diện hiển thị được. */
export function tiktokLabelErrorView(error: unknown): TiktokLabelErrorView {
  const body = providerErrorBody(error);
  const details = (body?.details ?? null) as LabelErrorDetails | null;
  const code = body?.code ?? null;
  const services = Array.isArray(details?.shippingServices)
    ? details.shippingServices.filter((entry) => Boolean(entry?.id))
    : [];

  return {
    code,
    key: isKnownCode(code ?? undefined) ? `fulfill.label.error.${code}` : null,
    params: {
      message: details?.providerMessage?.trim() || body?.message?.trim() || '',
      reference: details?.referenceId?.trim() || '',
    },
    // Lỗi hệ thống: mã tham chiếu đã nằm trong câu dịch — không lặp thêm "TIKTOK · INTERNAL".
    trace: code === 'SHIPPING_LABEL_INTERNAL_ERROR' ? '' : providerErrorTrace(details),
    services,
  };
}

/** Nhãn hiển thị của một dịch vụ vận chuyển: tên · hãng (không bao giờ chỉ là id khi có tên). */
export function shippingServiceLabel(service: TiktokShippingServiceChoice): string {
  const name = service.name?.trim() || service.id;
  const provider = service.shippingProviderName?.trim();
  return provider && !name.toLowerCase().includes(provider.toLowerCase()) ? `${name} · ${provider}` : name;
}

/** Phương thức vận chuyển "By TikTok" của Mango — xưởng in giao bằng nhãn TikTok. */
export const BY_TIKTOK_SHIPPING_METHOD = 'by_tiktok';

/**
 * "By TikTok" mà đơn chưa có nhãn ⇒ không được gửi. Nhãn đang gõ dở trong ô cũng tính (nó được lưu
 * ngay trước khi gửi); backend kiểm lại lần nữa (kể cả khi phương thức đến từ mặc định tài khoản).
 */
export function tiktokLabelRequired(params: {
  shippingMethod: string | null | undefined;
  hasSavedLabel: boolean;
  labelInput: string;
}): boolean {
  return (
    params.shippingMethod === BY_TIKTOK_SHIPPING_METHOD &&
    !params.hasSavedLabel &&
    params.labelInput.trim().length === 0
  );
}
