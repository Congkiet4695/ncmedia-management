'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@/i18n/config';

/** Ký tự thay cho giá trị rỗng — dùng thống nhất toàn hệ thống. */
const EMPTY = '—';

export interface LocaleFormatters {
  /** ISO → dd/MM/yyyy (hoặc MM/dd/yyyy tuỳ ngôn ngữ). */
  formatDate: (iso: string | null | undefined) => string;
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

  return useMemo(() => {
    const dateFormatter = new Intl.DateTimeFormat(tag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const dateTimeFormatter = new Intl.DateTimeFormat(tag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
  }, [tag]);
}
