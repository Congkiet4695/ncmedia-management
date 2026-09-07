import { PodFlashSaleProductLevel } from '@prisma/client';
import { PodFlashSaleTemplateConfigInvalidException } from '../exceptions/pod-flash-sale.exceptions';
import { FLASH_SALE_MAX_ITEMS } from '../constants/pod-flash-sale.constants';

/**
 * Hình dạng của `pod_flash_sale_templates.config`.
 *
 * 🔴 Đây là **hợp đồng** giữa hai thời điểm cách nhau hàng tháng: lúc lưu template và lúc
 * áp nó cho một đợt sale mới. Cột JSON không có schema ở tầng database, nên nó phải có
 * schema ở tầng code — `parseTemplateConfig` là cửa DUY NHẤT đọc cột này, và mọi bản ghi
 * hỏng (do sửa tay, do đổi phiên bản) bị chặn ngay với thông điệp nói rõ chỗ sai.
 *
 * 🔴 **Không có `startAt` / `endAt` / `status` / `providerFlashSaleId`** — theo đúng yêu
 * cầu sprint. Nếu một trường thời gian xuất hiện ở đây, template đã hết là template.
 */

/** Một dòng sản phẩm được template ghi nhớ. */
export interface PodFlashSaleTemplateItem {
  /** `pod_products.id`. Sản phẩm có thể đã bị xoá khi áp lại — lúc đó dòng bị bỏ qua. */
  productId: string;
  /** `pod_product_variants.id`. NULL ở mức PRODUCT. */
  variantId: string | null;
  /** `seller_sku` — dùng để nhận lại đúng biến thể khi áp template sang shop khác. */
  skuId: string | null;
  providerProductId: string | null;
  providerVariantId: string | null;

  /** Bản chụp tên để hiển thị template mà không phải join sang bảng sản phẩm. */
  productTitle: string | null;
  variantName: string | null;

  /**
   * % giảm — **cái được lưu chính thức**.
   *
   * 🔴 Template lưu % chứ không lưu giá deal tuyệt đối, vì giá gốc của sản phẩm thay đổi
   * theo thời gian: "giảm 30%" áp lại sau ba tháng vẫn đúng ý định, còn "bán 20.99" thì có
   * thể đã thành bán dưới giá vốn.
   */
  discountPercent: string;

  /**
   * Giá deal đã chốt tại thời điểm lưu — CHỈ để tham chiếu và hiển thị.
   *
   * Lúc áp template, giá được TÍNH LẠI từ `discountPercent` và giá gốc hiện hành; con số
   * này không bao giờ được dùng làm giá gửi lên sàn.
   */
  flashSalePrice: string | null;

  totalPurchaseLimit: number;
  customerPurchaseLimit: number;
}

/** Toàn bộ nội dung cột `config`. */
export interface PodFlashSaleTemplateConfig {
  /** Phiên bản hình dạng — đổi cấu trúc sau này thì đọc được cả bản cũ. */
  version: 1;
  productLevel: PodFlashSaleProductLevel;
  items: PodFlashSaleTemplateItem[];
}

/** Phiên bản hiện hành. */
export const FLASH_SALE_TEMPLATE_CONFIG_VERSION = 1 as const;

/**
 * Đọc và kiểm cột `config`.
 *
 * Ném `PodFlashSaleTemplateConfigInvalidException` thay vì trả `null`: một template hỏng
 * mà im lặng trả về danh sách rỗng sẽ tạo ra một đợt sale trống trơn và không ai biết vì sao.
 */
export function parseTemplateConfig(raw: unknown): PodFlashSaleTemplateConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PodFlashSaleTemplateConfigInvalidException('config không phải một object');
  }

  const config = raw as Record<string, unknown>;

  if (config.version !== FLASH_SALE_TEMPLATE_CONFIG_VERSION) {
    throw new PodFlashSaleTemplateConfigInvalidException(
      `version không được hỗ trợ (nhận ${String(config.version)}, cần ${FLASH_SALE_TEMPLATE_CONFIG_VERSION})`,
    );
  }

  const productLevel = config.productLevel;
  if (
    productLevel !== PodFlashSaleProductLevel.PRODUCT &&
    productLevel !== PodFlashSaleProductLevel.VARIATION
  ) {
    throw new PodFlashSaleTemplateConfigInvalidException(
      `productLevel không hợp lệ (nhận ${String(productLevel)})`,
    );
  }

  if (!Array.isArray(config.items)) {
    throw new PodFlashSaleTemplateConfigInvalidException('items không phải một mảng');
  }
  if (config.items.length > FLASH_SALE_MAX_ITEMS) {
    throw new PodFlashSaleTemplateConfigInvalidException(
      `items vượt trần ${FLASH_SALE_MAX_ITEMS} dòng`,
    );
  }

  return {
    version: FLASH_SALE_TEMPLATE_CONFIG_VERSION,
    productLevel,
    items: config.items.map((item, index) => parseTemplateItem(item, index)),
  };
}

function parseTemplateItem(raw: unknown, index: number): PodFlashSaleTemplateItem {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PodFlashSaleTemplateConfigInvalidException(`items[${index}] không phải một object`);
  }
  const item = raw as Record<string, unknown>;

  if (typeof item.productId !== 'string' || item.productId.length === 0) {
    throw new PodFlashSaleTemplateConfigInvalidException(`items[${index}].productId thiếu`);
  }
  if (typeof item.discountPercent !== 'string') {
    throw new PodFlashSaleTemplateConfigInvalidException(`items[${index}].discountPercent thiếu`);
  }

  return {
    productId: item.productId,
    variantId: asNullableString(item.variantId),
    skuId: asNullableString(item.skuId),
    providerProductId: asNullableString(item.providerProductId),
    providerVariantId: asNullableString(item.providerVariantId),
    productTitle: asNullableString(item.productTitle),
    variantName: asNullableString(item.variantName),
    discountPercent: item.discountPercent,
    flashSalePrice: asNullableString(item.flashSalePrice),
    totalPurchaseLimit: asLimit(item.totalPurchaseLimit),
    customerPurchaseLimit: asLimit(item.customerPurchaseLimit),
  };
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Giới hạn mua đọc từ JSON — giá trị lạ quy về `-1` (không giới hạn), không ném lỗi. */
function asLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : -1;
}
