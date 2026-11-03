import { FulfillmentProvider } from '@prisma/client';

/** Tên hiển thị của nhà cung cấp — dùng trong thông báo lỗi/nhật ký cho người vận hành. */
export const FULFILLMENT_PROVIDER_LABELS: Readonly<Record<FulfillmentProvider, string>> = {
  MANGO: 'MangoTeePrints',
  SELLERWIX: 'Sellerwix',
  PRINTIFY: 'Printify',
  PRINTFUL: 'Printful',
  CUSTOM: 'Custom',
};

/**
 * Nhãn nhà cung cấp của MỘT bản ghi — bản ghi nhập tay (Import Excel) của kết nối chưa gán nhà cung cấp có `provider = null`.
 */
export function providerLabelOf(provider: FulfillmentProvider | null): string {
  return provider ? FULFILLMENT_PROVIDER_LABELS[provider] : 'Nhập tay (Excel)';
}

/**
 * Đoạn đường dẫn webhook của từng nhà cung cấp ĐÃ tích hợp:
 * `{FULFILLMENT_WEBHOOK_BASE_URL}/api/v1/fulfillment/webhooks/{path}/{secret}`.
 * Nhà cung cấp chưa tích hợp ⇒ không có URL webhook.
 */
export const FULFILLMENT_WEBHOOK_PATHS: Readonly<Partial<Record<FulfillmentProvider, string>>> = {
  MANGO: 'mango',
  SELLERWIX: 'sellerwix',
};
