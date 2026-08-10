'use client';

import { create } from 'zustand';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isSupportedLocale,
  type Locale,
} from '@/i18n/config';
import { changeLocale } from '@/i18n';

/** Ghi lựa chọn xuống localStorage và cập nhật `<html lang>` cho SEO / trình đọc màn hình. */
function persist(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // bỏ qua lỗi storage (chế độ ẩn danh, quota…)
  }
}

/** Đọc ngôn ngữ đã lưu; chưa từng chọn thì suy từ trình duyệt, cuối cùng mới về mặc định. */
function resolveInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // bỏ qua
  }
  const browser = window.navigator.language?.split('-')[0];
  return isSupportedLocale(browser) ? browser : DEFAULT_LOCALE;
}

interface LocaleState {
  locale: Locale;
  /** Đổi ngôn ngữ ngay lập tức, không reload trang. */
  setLocale: (locale: Locale) => void;
  /** Khôi phục lựa chọn đã lưu khi app khởi động. */
  init: () => void;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: DEFAULT_LOCALE,
  setLocale: (locale) => {
    if (get().locale === locale) return;
    persist(locale);
    void changeLocale(locale);
    set({ locale });
  },
  init: () => {
    const locale = resolveInitialLocale();
    persist(locale);
    // Luôn gọi để i18next khớp với store, kể cả khi trùng ngôn ngữ mặc định.
    void changeLocale(locale);
    set({ locale });
  },
}));
