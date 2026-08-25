import { Injectable } from '@nestjs/common';
import {
  POD_LISTING_BLOCKER_CODES,
  POD_LISTING_MAX_IMAGES,
} from '../constants/pod-listing.constants';
import type { ResolvedListing } from './pod-listing-resolver.service';

/** Một lý do khiến listing không được phép gửi lên TikTok. */
export interface ListingBlocker {
  code: string;
  field: string;
  message: string;
}

/** Kết quả kiểm tra trước khi gửi. `ok = false` ⇒ item chuyển SKIPPED, không gọi TikTok. */
export interface ListingValidation {
  ok: boolean;
  blockers: ListingBlocker[];
  /** Vấn đề không chặn (vd bộ ảnh nhiều hơn 9 tấm sẽ bị cắt). */
  warnings: ListingBlocker[];
}

/**
 * PodListingValidatorService — **cổng chặn** trước khi chạm TikTok.
 *
 * 🔴 Lý do tồn tại: một request Create Product hỏng không chỉ tốn một lượt gọi. Nó tiêu
 * quota, ghi một bản lỗi vào Seller Center, và với hàng nghìn sản phẩm thì lỗi lặp lại hàng
 * nghìn lần trước khi ai đó kịp nhìn. Thiếu dữ liệu là chuyện BIẾT TRƯỚC được — biết trước
 * thì chặn tại đây, đừng để TikTok trả lời hộ.
 *
 * Danh sách cổng chặn đúng theo yêu cầu sprint: Category · Brand · Warehouse · Attribute ·
 * Images · SKU · Price · Stock (kèm Title/Description/Package vì thiếu là TikTok từ chối
 * chắc chắn).
 *
 * Hàm thuần, không chạm database — dùng chung cho cả preview (báo trước cho người dùng) lẫn
 * lúc chạy job, nên những gì màn hình cảnh báo đúng bằng những gì engine chặn.
 */
@Injectable()
export class PodListingValidatorService {
  validate(payload: ResolvedListing): ListingValidation {
    const blockers: ListingBlocker[] = [];
    const warnings: ListingBlocker[] = [];

    if (!payload.title?.trim()) {
      blockers.push(this.blocker('MISSING_TITLE', 'title', 'Listing chưa có tiêu đề'));
    }
    if (!payload.description?.trim()) {
      blockers.push(this.blocker('MISSING_DESCRIPTION', 'description', 'Listing chưa có mô tả'));
    }
    if (!payload.category.tiktokCategoryId) {
      blockers.push(this.blocker('MISSING_CATEGORY', 'category', 'Chưa chọn danh mục TikTok'));
    }
    if (!payload.brand.tiktokBrandId) {
      blockers.push(
        this.blocker(
          'MISSING_BRAND',
          'brand',
          'Chưa chọn thương hiệu — đặt ở Category Template hoặc Listing Template',
        ),
      );
    }
    // 🔴 KHÔNG kiểm kho ở đây. Kho là dữ liệu CỦA SHOP: cùng một Draft Product đăng lên ba
    // shop là ba kho khác nhau, nên bắt Draft phải có kho là chặn nhầm — và chặn luôn cả
    // mục tiêu "một Draft dùng cho nhiều shop". Kho được quyết ở bước Publish, theo từng
    // shop (`PodListingPublisherService.resolveWarehouse`), và chỉ item của shop thiếu cấu
    // hình mới hỏng.
    if (!payload.package.weight) {
      blockers.push(this.blocker('MISSING_PACKAGE', 'package', 'Chưa có khối lượng kiện hàng'));
    }

    // Thuộc tính BẮT BUỘC của danh mục: TikTok từ chối cả sản phẩm nếu thiếu, và thông điệp
    // trả về chỉ ghi id thuộc tính — nên phải nêu tên tại đây cho người vận hành sửa được.
    for (const attribute of payload.attributes) {
      if (!attribute.isRequired) continue;
      const hasValue = attribute.values.length > 0 || attribute.customValues.length > 0;
      if (!hasValue) {
        blockers.push(
          this.blocker(
            'MISSING_ATTRIBUTE',
            `attribute.${attribute.tiktokAttributeId}`,
            `Thuộc tính bắt buộc "${attribute.name ?? attribute.tiktokAttributeId}" chưa có giá trị`,
          ),
        );
      }
    }

    this.validateImages(payload, blockers, warnings);
    this.validateVariants(payload, blockers);

    return { ok: blockers.length === 0, blockers, warnings };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private validateImages(
    payload: ResolvedListing,
    blockers: ListingBlocker[],
    warnings: ListingBlocker[],
  ): void {
    if (payload.images.length === 0) {
      blockers.push(this.blocker('MISSING_IMAGE', 'images', 'Bộ ảnh chưa có tấm nào'));
      return;
    }

    if (payload.images.length > POD_LISTING_MAX_IMAGES) {
      warnings.push(
        this.blocker(
          'MISSING_IMAGE',
          'images',
          `Bộ ảnh có ${payload.images.length} tấm — TikTok chỉ nhận ${POD_LISTING_MAX_IMAGES}, ` +
            'các tấm sau sẽ bị bỏ theo đúng thứ tự đã sắp',
        ),
      );
    }

    // Ảnh không có URL thì không tải về được để đẩy lên TikTok — hỏng dữ liệu, không phải
    // thiếu cấu hình, nhưng hậu quả giống nhau nên chặn cùng một chỗ.
    const broken = payload.images.filter((image) => !image.url && !image.tiktokImageUri);
    for (const image of broken) {
      blockers.push(
        this.blocker('MISSING_IMAGE', 'images', `Ảnh "${image.title}" không có file để tải lên`),
      );
    }
  }

  private validateVariants(payload: ResolvedListing, blockers: ListingBlocker[]): void {
    if (payload.variants.length === 0) {
      blockers.push(this.blocker('MISSING_SKU', 'variants', 'Listing chưa có biến thể nào'));
      return;
    }

    for (const variant of payload.variants) {
      if (!variant.salePrice || Number(variant.salePrice) <= 0) {
        blockers.push(
          this.blocker(
            'MISSING_PRICE',
            `variant.${variant.sellerSku}`,
            `Biến thể "${variant.variantName}" chưa có giá bán hợp lệ`,
          ),
        );
      }
      // Tồn kho 0 ⇒ TikTok nhận nhưng sản phẩm không bán được. Với bulk listing thì đó là
      // hàng nghìn sản phẩm chết lặng trên sàn, nên coi là lỗi chặn.
      if (variant.quantity <= 0) {
        blockers.push(
          this.blocker(
            'MISSING_STOCK',
            `variant.${variant.sellerSku}`,
            `Biến thể "${variant.variantName}" có tồn kho bằng 0`,
          ),
        );
      }
      if (!variant.sellerSku?.trim()) {
        blockers.push(
          this.blocker('MISSING_SKU', 'variants', `Biến thể "${variant.variantName}" chưa có mã SKU`),
        );
      }
    }
  }

  private blocker(
    code: keyof typeof POD_LISTING_BLOCKER_CODES,
    field: string,
    message: string,
  ): ListingBlocker {
    return { code: POD_LISTING_BLOCKER_CODES[code], field, message };
  }
}
