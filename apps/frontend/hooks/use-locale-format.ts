'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@/i18n/config';
import { BUSINESS_TIME_ZONE } from '@/utils/business-time';

/** Ký tự thay cho giá trị rỗng — dùng thống nhất toàn hệ thống. */
const EMPTY = '—';

export interface LocaleFormatters {
  /** ISO → dd/MM/yyyy (hoặc MM/dd/yyyy tuỳ ngôn ngữ). */
  formatDate: (iso: string | null | undefined) => string;
  /**
   * Ngày LỊCH `YYYY-MM-DD` (ngày nghiệp vụ backend trả) → dd/MM/yyyy theo ngôn ngữ.
   * 🔴 Không đi qua múi giờ trình duyệt: `formatDate('2026-10-01')` ở máy UTC−7 sẽ ra 30/09.
   */
  formatCalendarDay: (day: string | null | undefined) => string;
  /** ISO → ngày + giờ:phút. */
  formatDateTime: (iso: string | null | undefined) => string;
  /** Số nguyên/thập phân theo quy ước phân cách của ngôn ngữ. */
  formatNumber: (value: number | null | undefined) => string;
  /**
   * Số tiền kèm đơn vị tiền tệ.
   *
   * Nhận CẢ chuỗi thập phân vì backend trả `Decimal` dưới dạng chuỗi để không mất
   * độ chính xác — chỉ đổi sang số ở đúng bước hiển thị cuối cùng, không dùng để tính toán.
   * Mã tiền tệ lạ (`Intl` không biết) vẫn hiển thị được thay vì làm vỡ giao diện.
   */
  formatCurrency: (value: string | number | null | undefined, currency: string | null) => string;
}

/**
 * Bộ định dạng ngày/số theo ngôn ngữ đang chọn.
 *
 * Trước đây mỗi màn hình tự gọi `new Intl.DateTimeFormat('vi-VN', …)` nên đổi ngôn ngữ
 * xong ngày tháng vẫn ở định dạng Việt Nam. Gom về một hook để định dạng đi theo
 * ngôn ngữ, và thêm ngôn ngữ mới không phải sửa từng màn hình.
 */
export function useLocaleFormat(): LocaleFormatters {
  const { i18n } = useTranslation();
  const tag = getIntlLocale(i18n.language);
  return useMemo(() => createLocaleFormatters(tag), [tag]);
}

/**
 * Cùng bộ định dạng (cùng format ngày / giờ theo ngôn ngữ), nhưng giờ hiển thị theo **múi giờ nghiệp vụ US**
 * (`BUSINESS_TIME_ZONE` — America/Los_Angeles, tự PST/PDT) thay vì giờ máy người xem.
 *
 * 🔴 Dùng cho Orders / TikTok Payout / Dashboard và popup liên quan — nơi người xem phải thấy CÙNG một giờ
 * dù ngồi ở Việt Nam hay ở Mỹ, khớp với bộ lọc ngày của backend. Màn khác giữ `useLocaleFormat` như cũ.
 */
export function useBusinessLocaleFormat(): LocaleFormatters {
  const { i18n } = useTranslation();
  const tag = getIntlLocale(i18n.language);
  return useMemo(() => createLocaleFormatters(tag, BUSINESS_TIME_ZONE), [tag]);
}

/** `timeZone` bỏ trống ⇒ giờ của trình duyệt (hành vi cũ của `useLocaleFormat`). */
function createLocaleFormatters(tag: string, timeZone?: string): LocaleFormatters {
  const zone = timeZone ? { timeZone } : {};
  const dateFormatter = new Intl.DateTimeFormat(tag, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...zone,
  });
  // Ngày lịch được neo 00:00 UTC rồi định dạng ĐÚNG ở UTC ⇒ không lệch ngày ở bất kỳ múi giờ nào.
  const calendarDayFormatter = new Intl.DateTimeFormat(tag, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dateTimeFormatter = new Intl.DateTimeFormat(tag, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...zone,
  });
  const numberFormatter = new Intl.NumberFormat(tag);

  const toDate = (iso: string | null | undefined): Date | null => {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  return {
    formatDate: (iso) => {
      const date = toDate(iso);
      return date ? dateFormatter.format(date) : EMPTY;
    },
    formatCalendarDay: (day) => {
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return EMPTY;
      const date = new Date(`${day}T00:00:00.000Z`);
      return Number.isNaN(date.getTime()) ? EMPTY : calendarDayFormatter.format(date);
    },
    formatDateTime: (iso) => {
      const date = toDate(iso);
      return date ? dateTimeFormatter.format(date) : EMPTY;
    },
    formatNumber: (value) =>
      value === null || value === undefined ? EMPTY : numberFormatter.format(value),
    formatCurrency: (value, currency) => {
      if (value === null || value === undefined || value === '') return EMPTY;
      const amount = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(amount)) return `${value} ${currency ?? ''}`.trim();
      try {
        return new Intl.NumberFormat(tag, {
          style: 'currency',
          currency: currency ?? 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount);
      } catch {
        return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
      }
    },
  };
}
