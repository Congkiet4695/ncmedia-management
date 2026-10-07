import { Injectable } from '@nestjs/common';
import { PodFlashSaleItemStatus, Prisma } from '@prisma/client';
import {
  FLASH_SALE_ISSUE_CODES,
  FLASH_SALE_MAX_ITEMS,
  FLASH_SALE_MIN_DURATION_MINUTES,
  FLASH_SALE_MIN_LEAD_SECONDS,
} from '../constants/pod-flash-sale.constants';
import {
  TIKTOK_ACTIVITY_MAX_TITLE_LENGTH,
  TIKTOK_PRODUCT_STATUS,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type { PodFlashSaleIssueDto } from '../dto/pod-flash-sale-response.dto';
import { validatePricing, validateQuantityLimit } from './pod-flash-sale-pricing';

/** Hình dạng tối thiểu mà validator cần từ một đợt sale (không phụ thuộc `include`). */
export interface ValidatableFlashSale {
  id: string;
  /** Shop của đợt — có thì kiểm "sản phẩm thuộc đúng shop". */
  shopId?: string;
  name: string;
  startAt: Date;
  endAt: Date;
  items: ValidatableFlashSaleItem[];
}

export interface ValidatableFlashSaleItem {
  id: string;
  /** `pod_products.id` của dòng — đối chiếu với sản phẩm cha của biến thể hiện tại. */
  productId?: string;
  originalPrice: Prisma.Decimal;
  flashSalePrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  totalPurchaseLimit: number;
  customerPurchaseLimit: number;
  providerProductId: string | null;
  providerVariantId: string | null;
  variantId: string | null;
  currency: string | null;
  status: PodFlashSaleItemStatus;
  /**
   * Bản ghi sản phẩm / biến thể HIỆN TẠI (bảng mirror của TikTok). Có thì validator đối chiếu với
   * `provider_*_id` chụp lúc thêm dòng — bản chụp cũ là nguồn của lỗi 17029016 khi nhân bản đợt sale.
   */
  product?: ValidatableProduct | null;
  variant?: { tiktokSkuId: string; productId: string } | null;
}

export interface ValidatableProduct {
  tiktokProductId: string;
  shopId: string;
  /** `status` TikTok (ACTIVATE / SELLER_DEACTIVATED / FREEZE / DELETED …) — ảnh chụp lần đồng bộ cuối. */
  status: string | null;
  /** Lượt đồng bộ FULL không còn thấy sản phẩm trong tập đang bán. */
  deactivatedAt: Date | null;
  deletedAt: Date | null;
}

/** Kết quả kiểm tra một đợt sale. */
export interface FlashSaleValidationResult {
  ok: boolean;
  issues: PodFlashSaleIssueDto[];
  /** Id các dòng KHÔNG có lỗi mức ERROR — đây là tập được phép gửi lên sàn. */
  readyItemIds: string[];
}

/**
 * PodFlashSaleValidatorService — cổng kiểm tra DUY NHẤT trước khi chạm tới sàn.
 *
 * 🔴 Cùng một hàm được gọi ở ba nơi khác nhau và trả về CÙNG một kết quả:
 *  - màn hình chi tiết (hiển thị lỗi trước khi người dùng bấm gì),
 *  - đường Publish (chặn),
 *  - đường Retry (chặn lại lần nữa — dữ liệu có thể đã đổi giữa hai lần bấm).
 *
 * Viết ba bộ luật cho ba nơi là cách chắc chắn nhất để giao diện báo "hợp lệ" còn API báo
 * "không hợp lệ". Đó là lý do lớp này không giữ trạng thái và không tự đọc database:
 * nơi gọi nạp dữ liệu, nó chỉ phán xét.
 */
@Injectable()
export class PodFlashSaleValidatorService {
  /**
   * Kiểm tra toàn bộ một đợt sale.
   *
   * @param now Mốc "bây giờ" — TIÊM VÀO thay vì gọi `new Date()` bên trong, để unit test
   *            kiểm được ranh giới thời gian mà không phải giả lập đồng hồ hệ thống.
   */
  validate(flashSale: ValidatableFlashSale, now: Date = new Date()): FlashSaleValidationResult {
    const issues: PodFlashSaleIssueDto[] = [
      ...this.validateHeader(flashSale, now),
      ...this.validateItemCount(flashSale),
      ...this.validateCurrency(flashSale.items),
    ];

    const itemResult = this.validateItems(flashSale.items, flashSale.shopId);
    issues.push(...itemResult.issues);
    const readyItemIds = itemResult.readyItemIds;

    if (readyItemIds.length === 0) {
      issues.push({
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.NO_ITEMS,
        field: 'items',
        message: 'Flash Sale phải có ít nhất một sản phẩm hợp lệ.',
      });
    }

    return { ok: !issues.some((issue) => issue.level === 'ERROR'), issues, readyItemIds };
  }

  /**
   * Kiểm RIÊNG các dòng — không kiểm phần đầu (tên, khung giờ).
   *
   * Dùng khi thêm sản phẩm vào đợt ĐANG CHẠY: giờ bắt đầu đã qua là chuyện bình thường của
   * một đợt đang chạy, không phải lỗi; chỉ từng dòng mới cần hợp lệ trước khi gửi lên sàn.
   */
  validateItems(
    items: ValidatableFlashSaleItem[],
    shopId?: string,
  ): {
    issues: PodFlashSaleIssueDto[];
    readyItemIds: string[];
  } {
    const issues: PodFlashSaleIssueDto[] = [];
    const readyItemIds: string[] = [];
    // Khoá TikTok đã gặp — SKU (mức biến thể) hoặc sản phẩm (mức PRODUCT). Dòng sau trùng dòng trước là lỗi.
    const seen = new Set<string>();
    for (const item of items) {
      // Dòng đã bị gỡ khỏi sàn không còn tham gia đợt này — kiểm nó chỉ tạo nhiễu.
      if (item.status === PodFlashSaleItemStatus.REMOVED) continue;

      const itemIssues = [...this.validateItem(item), ...this.validateProviderIdentity(item, shopId)];
      // Khoá TikTok của dòng: SKU (mức biến thể) · sản phẩm (mức PRODUCT). Dòng biến thể thiếu SKU id đã
      // có lỗi riêng — không đem so trùng theo sản phẩm.
      const key = item.providerVariantId
        ? `sku:${item.providerVariantId}`
        : item.variantId || !item.providerProductId
          ? `item:${item.id}`
          : `product:${item.providerProductId}`;
      if (seen.has(key)) {
        itemIssues.push({
          level: 'ERROR',
          code: FLASH_SALE_ISSUE_CODES.DUPLICATE_SKU,
          field: 'providerVariantId',
          message: `${item.providerVariantId ? 'SKU' : 'Sản phẩm'} ${item.providerVariantId ?? item.providerProductId} xuất hiện hai lần trong đợt sale.`,
          itemId: item.id,
        });
      }
      seen.add(key);
      issues.push(...itemIssues);
      if (!itemIssues.some((issue) => issue.level === 'ERROR')) readyItemIds.push(item.id);
    }
    return { issues, readyItemIds };
  }

  /** Kiểm phần đầu: tên + khung giờ. */
  private validateHeader(flashSale: ValidatableFlashSale, now: Date): PodFlashSaleIssueDto[] {
    const issues: PodFlashSaleIssueDto[] = [];

    if (flashSale.name.length > TIKTOK_ACTIVITY_MAX_TITLE_LENGTH) {
      issues.push({
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.NAME_TOO_LONG,
        field: 'name',
        message: `Tên Flash Sale vượt quá ${TIKTOK_ACTIVITY_MAX_TITLE_LENGTH} ký tự mà TikTok cho phép.`,
      });
    }

    if (flashSale.endAt.getTime() <= flashSale.startAt.getTime()) {
      issues.push({
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.TIME_RANGE_INVALID,
        field: 'endAt',
        message: 'Giờ kết thúc phải sau giờ bắt đầu.',
      });
      // Khung giờ đảo ngược làm mọi phép kiểm thời lượng phía dưới vô nghĩa.
      return issues;
    }

    // TikTok đòi `begin_time` LỚN HƠN thời điểm hiện tại. Cộng thêm đệm để request không
    // đến nơi sau khi đợt đã bắt đầu — xem `FLASH_SALE_MIN_LEAD_SECONDS`.
    const earliestStart = now.getTime() + FLASH_SALE_MIN_LEAD_SECONDS * 1_000;
    if (flashSale.startAt.getTime() < earliestStart) {
      issues.push({
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.START_IN_PAST,
        field: 'startAt',
        message:
          `Giờ bắt đầu phải cách hiện tại ít nhất ${FLASH_SALE_MIN_LEAD_SECONDS} giây — ` +
          'TikTok từ chối hoạt động có giờ bắt đầu trong quá khứ.',
      });
    }

    const durationMinutes = (flashSale.endAt.getTime() - flashSale.startAt.getTime()) / 60_000;
    if (durationMinutes < FLASH_SALE_MIN_DURATION_MINUTES) {
      issues.push({
        level: 'WARNING',
        code: FLASH_SALE_ISSUE_CODES.DURATION_TOO_SHORT,
        field: 'endAt',
        message: `Đợt sale chỉ kéo dài ${Math.round(durationMinutes)} phút — hãy kiểm tra lại giờ kết thúc.`,
      });
    }

    return issues;
  }

  /**
   * Trần số dòng của MỘT đợt sale.
   *
   * 🔴 Đây là trần của HỆ THỐNG (`FLASH_SALE_MAX_ITEMS`), **không phải** trần 300 mục cho
   * mỗi lượt gọi của TikTok. Vượt 300 là hoàn toàn bình thường — bộ dựng payload chia thành
   * nhiều lượt gọi và gắn tất cả vào cùng một hoạt động. Thông điệp ở đây từng nói "của
   * TikTok" và chính câu đó là thứ khiến người đọc tin rằng 300 là giới hạn của sàn.
   */
  private validateItemCount(flashSale: ValidatableFlashSale): PodFlashSaleIssueDto[] {
    const active = flashSale.items.filter((item) => item.status !== PodFlashSaleItemStatus.REMOVED);
    if (active.length <= FLASH_SALE_MAX_ITEMS) return [];
    return [
      {
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.ITEM_LIMIT_EXCEEDED,
        field: 'items',
        message: `Flash Sale có ${active.length} dòng, vượt trần ${FLASH_SALE_MAX_ITEMS} dòng của một đợt.`,
      },
    ];
  }

  /** Kiểm MỘT dòng: giá, % giảm, giới hạn mua, và định danh phía sàn. */
  private validateItem(item: ValidatableFlashSaleItem): PodFlashSaleIssueDto[] {
    const issues: PodFlashSaleIssueDto[] = [];

    const pricingIssues = validatePricing({
      originalPrice: item.originalPrice,
      flashSalePrice: item.flashSalePrice,
      discountPercent: item.discountPercent,
    });
    issues.push(...pricingIssues.map((issue) => ({ ...issue, itemId: item.id })));

    for (const issue of validateQuantityLimit(item.totalPurchaseLimit, 'totalPurchaseLimit')) {
      issues.push({ ...issue, itemId: item.id });
    }
    for (const issue of validateQuantityLimit(item.customerPurchaseLimit, 'customerPurchaseLimit')) {
      issues.push({ ...issue, itemId: item.id });
    }

    // 🔴 Không có `tiktok_product_id` thì payload không có gì để trỏ tới. Xảy ra khi sản
    // phẩm được thêm từ một bản đồng bộ cũ đã mất dữ liệu — chặn ở đây thay vì để TikTok
    // trả về một lỗi mơ hồ ở giữa lượt gửi.
    if (!item.providerProductId) {
      issues.push({
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.MISSING_PROVIDER_ID,
        field: 'providerProductId',
        message: 'Dòng này thiếu TikTok Product ID — hãy đồng bộ lại sản phẩm rồi thêm lại.',
        itemId: item.id,
      });
    }

    // Dòng ở mức biến thể bắt buộc phải có `sku_id`; thiếu nó thì TikTok không biết áp giá
    // cho SKU nào.
    // 🔴 Dòng mức biến thể đã mất `variant_id` (FK SET NULL) nhưng còn `provider_variant_id`:
    // người bán đã XOÁ SKU này trên TikTok. Giữ dòng lại (FAILED ≠ DELETE) và nói rõ vì sao nó
    // không gửi được, thay vì để dòng biến mất trong im lặng như trước.
    if (!item.variantId && item.providerVariantId) {
      issues.push({
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.VARIANT_REMOVED,
        field: 'variantId',
        message:
          `SKU ${item.providerVariantId} không còn tồn tại trên TikTok (đã bị xoá khỏi sản phẩm) — ` +
          'xoá dòng này hoặc chọn SKU khác.',
        itemId: item.id,
      });
    }

    if (item.variantId && !item.providerVariantId) {
      issues.push({
        level: 'ERROR',
        code: FLASH_SALE_ISSUE_CODES.MISSING_PROVIDER_ID,
        field: 'providerVariantId',
        message: 'Dòng biến thể này thiếu TikTok SKU ID — hãy đồng bộ lại sản phẩm rồi thêm lại.',
        itemId: item.id,
      });
    }

    return issues;
  }

  /**
   * Pre-flight: SKU/sản phẩm mà dòng sẽ gửi lên có còn đúng là SKU của sản phẩm ĐANG BÁN, thuộc ĐÚNG
   * shop của đợt hay không — theo bảng mirror sản phẩm (không gọi TikTok).
   *
   * 🔴 Root cause của 17029016 "No SKU in the product matches" khi nhân bản đợt sale: dòng mang
   * `provider_product_id` / `provider_variant_id` CHỤP từ đợt gốc. Sản phẩm sau đó rời trạng thái
   * ACTIVATE (bị xoá, ngừng bán, đóng băng, trượt duyệt) — Get Product VẪN trả về sản phẩm và đủ SKU,
   * nên "SKU còn tồn tại", nhưng TikTok không cho SKU của sản phẩm không còn bán vào khuyến mãi và từ
   * chối CẢ request. Bảng mirror đã đánh dấu (`deactivated_at`) nhưng module Flash Sale chưa từng đọc nó.
   */
  private validateProviderIdentity(item: ValidatableFlashSaleItem, shopId?: string): PodFlashSaleIssueDto[] {
    const issues: PodFlashSaleIssueDto[] = [];
    const product = item.product;
    if (product) {
      const notLive =
        product.deletedAt !== null ||
        product.deactivatedAt !== null ||
        (product.status !== null && product.status !== TIKTOK_PRODUCT_STATUS.ACTIVATE);
      if (notLive) {
        issues.push({
          level: 'ERROR',
          code: FLASH_SALE_ISSUE_CODES.PRODUCT_NOT_ACTIVE,
          field: 'productId',
          message:
            `Sản phẩm ${product.tiktokProductId} không còn đang bán trên TikTok` +
            `${product.deletedAt || product.deactivatedAt ? '' : ` (trạng thái ${product.status})`} — ` +
            'TikTok không nhận SKU của sản phẩm này vào Flash Sale. Xoá dòng hoặc đồng bộ lại sản phẩm.',
          itemId: item.id,
        });
      }
      if (shopId && product.shopId !== shopId) {
        issues.push({
          level: 'ERROR',
          code: FLASH_SALE_ISSUE_CODES.PRODUCT_SHOP_MISMATCH,
          field: 'productId',
          message: `Sản phẩm ${product.tiktokProductId} không thuộc shop của đợt sale.`,
          itemId: item.id,
        });
      }
      if (item.providerProductId && product.tiktokProductId !== item.providerProductId) {
        issues.push({
          level: 'ERROR',
          code: FLASH_SALE_ISSUE_CODES.SKU_PRODUCT_MISMATCH,
          field: 'providerProductId',
          message:
            `Dòng trỏ tới sản phẩm TikTok ${item.providerProductId} nhưng sản phẩm hiện tại là ` +
            `${product.tiktokProductId} — bản chụp cũ, hãy thêm lại sản phẩm.`,
          itemId: item.id,
        });
      }
    }
    const variant = item.variant;
    if (variant && item.providerVariantId) {
      if (variant.tiktokSkuId !== item.providerVariantId ||
        (item.productId !== undefined && variant.productId !== item.productId)) {
        issues.push({
          level: 'ERROR',
          code: FLASH_SALE_ISSUE_CODES.SKU_PRODUCT_MISMATCH,
          field: 'providerVariantId',
          message:
            `SKU ${item.providerVariantId} không còn là SKU của sản phẩm này (SKU hiện tại: ` +
            `${variant.tiktokSkuId}) — bản chụp cũ, hãy thêm lại sản phẩm.`,
          itemId: item.id,
        });
      }
    }
    return issues;
  }

  /**
   * Kiểm tính đồng nhất tiền tệ của cả đợt (gọi từ `validate`).
   *
   * TikTok đặt giá khuyến mãi theo đúng loại tiền của sản phẩm; trộn hai loại tiền trong
   * một hoạt động là dấu hiệu đợt sale đang gom sản phẩm của hai thị trường khác nhau.
   * Mức WARNING (không chặn) vì shop bán đa vùng vẫn có thể có dữ liệu như vậy hợp lệ.
   */
  validateCurrency(items: ValidatableFlashSaleItem[]): PodFlashSaleIssueDto[] {
    const currencies = new Set(
      items
        .filter((item) => item.status !== PodFlashSaleItemStatus.REMOVED)
        .map((item) => item.currency)
        .filter((currency): currency is string => Boolean(currency)),
    );
    if (currencies.size <= 1) return [];
    return [
      {
        level: 'WARNING',
        code: FLASH_SALE_ISSUE_CODES.CURRENCY_MISMATCH,
        field: 'items',
        message: `Đợt sale đang trộn ${currencies.size} loại tiền tệ (${[...currencies].join(', ')}).`,
      },
    ];
  }
}
