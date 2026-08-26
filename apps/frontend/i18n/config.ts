/**
 * Cấu hình đa ngôn ngữ — NGUỒN SỰ THẬT DUY NHẤT.
 *
 * Thêm một ngôn ngữ mới CHỈ cần 2 bước:
 *   1. Tạo thư mục `i18n/locales/<mã>/` với đủ các file namespace (copy từ `en/`).
 *   2. Thêm một dòng vào `LOCALES` bên dưới và import bundle trong `i18n/resources.ts`.
 * Không phải sửa component, provider hay switcher.
 */

/** Mã ngôn ngữ được hỗ trợ. */
export const LOCALES = [
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳', intl: 'vi-VN' },
  { code: 'en', label: 'English', flag: '🇺🇸', intl: 'en-US' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

/** Ngôn ngữ mặc định khi người dùng chưa từng chọn và trình duyệt không khớp. */
export const DEFAULT_LOCALE: Locale = 'vi';

/**
 * Namespace = một file JSON trong mỗi thư mục ngôn ngữ.
 * Tách theo miền nghiệp vụ để không có file nào phình quá lớn và để dịch song song được.
 */
export const NAMESPACES = [
  'common',
  'menu',
  'auth',
  'validation',
  'employee',
  'account',
  'order',
  'report',
  'pod',
  'fulfillment',
  'profile',
  'superAdmin',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** Namespace mặc định khi gọi `useTranslation()` không tham số. */
export const DEFAULT_NAMESPACE: Namespace = 'common';

/** Khoá localStorage ghi nhớ lựa chọn ngôn ngữ (cùng tiền tố với theme). */
export const LOCALE_STORAGE_KEY = 'ncmedia-locale';

/** Kiểm tra một chuỗi bất kỳ có phải mã ngôn ngữ hợp lệ không. */
export function isSupportedLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale.code === value);
}

/**
 * Thẻ BCP 47 dùng cho `Intl.*` (định dạng ngày, số, tiền tệ).
 *
 * Tách khỏi mã ngôn ngữ vì `Intl` cần cả vùng lãnh thổ (`vi-VN`, `en-US`) mới cho ra
 * đúng thứ tự ngày/tháng và dấu phân cách nghìn.
 */
export function getIntlLocale(locale: string | undefined): string {
  return LOCALES.find((item) => item.code === locale)?.intl ?? LOCALES[0].intl;
}
