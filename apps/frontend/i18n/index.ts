/**
 * Khởi tạo i18next dùng chung cho toàn ứng dụng.
 *
 * Vì sao khởi tạo bằng `DEFAULT_LOCALE` chứ không đọc localStorage ngay tại đây:
 * module này chạy CẢ trên server (SSR) lẫn client. Nếu client khởi tạo bằng ngôn ngữ
 * khác server, React sẽ báo hydration mismatch. Do đó lần render đầu luôn dùng ngôn ngữ
 * mặc định, rồi `I18nProvider` đổi sang ngôn ngữ đã lưu TRƯỚC khi trình duyệt vẽ
 * (useLayoutEffect) — người dùng không thấy nhấp nháy.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, DEFAULT_NAMESPACE, NAMESPACES, type Locale } from './config';
import { resources } from './resources';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    // Thiếu khoá ⇒ rơi về ngôn ngữ mặc định thay vì hiện khoá trống.
    fallbackNS: DEFAULT_NAMESPACE,
    interpolation: {
      // React đã tự escape, i18next escape thêm sẽ làm hỏng ký tự tiếng Việt/ký hiệu.
      escapeValue: false,
    },
    react: {
      // Không dùng Suspense: mọi bản dịch đã nằm sẵn trong bundle, không có gì để chờ.
      useSuspense: false,
    },
    // Chỉ cảnh báo khi phát triển, tránh làm ồn log production.
    debug: false,
    returnNull: false,
  });
}

/** Đổi ngôn ngữ hiện hành. Trả về ngôn ngữ đang áp dụng sau khi đổi. */
export async function changeLocale(locale: Locale): Promise<Locale> {
  await i18n.changeLanguage(locale);
  return locale;
}

export default i18n;
