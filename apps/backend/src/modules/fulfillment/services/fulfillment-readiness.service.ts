import { Injectable } from '@nestjs/common';
import { PodDesignPlacement, Prisma } from '@prisma/client';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import type { TiktokRecipientAddress } from '../../pod-tiktok/types/tiktok-order.types';
import {
  MangoOrderMapper,
  NormalizedAddress,
  ResolvedItem,
} from '../mango/mappers/mango-order.mapper';
import type { MangoPrintFile } from '../mango/types/mango-api.types';
import { createMappingIndex, findMappingInIndex, mappingKeyOf } from '../shared/mapping-match';

/**
 * Product Mapping — chỉ còn phần "in ở đâu".
 *
 * ⚠️ KHÔNG còn quan hệ `designs`. Design tách hẳn khỏi ánh xạ và được tra riêng theo
 * (Product ID + Seller SKU) — xem `DesignsByProductKey`. Giữ alias này để mọi nơi gọi không
 * phải đổi kiểu, nhưng tên vẫn nói đúng nội dung mới.
 */
export type MappingWithDesigns = Prisma.FulfillmentProductMappingGetPayload<object>;

/**
 * Design ĐANG HIỆU LỰC, đúng những trường mà việc dựng `print_files` cần.
 *
 * 🔴 Hợp đồng: nơi gọi chỉ đưa vào design chưa bị xoá mềm (`deleted_at IS NULL` đã nằm trong
 * truy vấn). Lọc lại ở đây là dựng bản sao thứ hai của luật "design nào còn sống" — và bản
 * sao thứ hai luôn là bản trôi lệch.
 */
export interface ReadinessDesign {
  placement: PodDesignPlacement;
  storageFile: { publicUrl: string | null };
}

/**
 * Design của cả tổ chức, tra theo khoá `mappingKeyOf(productId, sellerSku)`.
 *
 * 🔴 Truyền vào thay vì để `check()` tự truy vấn: `check()` là hàm ĐỒNG BỘ và được gọi cho
 * hàng loạt đơn trong một vòng lặp; cho nó tự query là mở đường cho N+1.
 */
export type DesignsByProductKey = Map<string, ReadinessDesign[]>;

/** Một lý do khiến đơn chưa gửi được — `code` để FE dịch/nhóm, `message` để hiển thị. */
export interface ReadinessIssue {
  code: string;
  message: string;
  /** Line item liên quan (nếu lỗi thuộc về một sản phẩm cụ thể). */
  podOrderItemId?: string;
  /**
   * Ngữ cảnh đủ để SỬA lỗi ngay tại chỗ — chỉ có với `MAPPING_MISSING`.
   * Nhờ nó, màn hình đơn mở được dialog ánh xạ với SKU điền sẵn, người dùng không phải
   * rời đơn đi tìm lại đúng dòng hàng ở màn hình Product Mapping.
   */
  tiktokProductId?: string | null;
  tiktokSkuId?: string | null;
  sellerSku?: string | null;
  productName?: string | null;
  skuName?: string | null;
  productCategory?: string | null;
}

/** Kết quả kiểm tra: hoặc sẵn sàng (kèm dữ liệu đã ghép), hoặc kèm danh sách lý do. */
export interface ReadinessResult {
  ready: boolean;
  issues: ReadinessIssue[];
  address?: NormalizedAddress;
  items?: ResolvedItem[];
}

/** Mã lỗi chuẩn — dùng chung BE/FE, không rải chuỗi tự do khắp nơi. */
export const READINESS_CODES = {
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  NO_ITEMS: 'NO_ITEMS',
  ADDRESS_MISSING: 'ADDRESS_MISSING',
  ADDRESS_MASKED: 'ADDRESS_MASKED',
  ADDRESS_INCOMPLETE: 'ADDRESS_INCOMPLETE',
  MAPPING_MISSING: 'MAPPING_MISSING',
  /**
   * Sản phẩm ĐÃ có ánh xạ, nhưng ánh xạ đó khai cho một nhà cung cấp KHÁC với nhà cung cấp
   * mà kết nối TikTok của đơn đang dùng.
   *
   * 🔴 Tách khỏi `MAPPING_MISSING` vì hai lỗi này sửa khác nhau hoàn toàn: một cái là "khai
   * ánh xạ đi", cái này là "ánh xạ có rồi nhưng bạn đang gửi nhầm xưởng". Gửi bừa SKU của
   * xưởng A sang xưởng B là in ra một sản phẩm khác hẳn.
   */
  MAPPING_PROVIDER_MISMATCH: 'MAPPING_PROVIDER_MISMATCH',
  DESIGN_MISSING: 'DESIGN_MISSING',
  DESIGN_NOT_PUBLIC: 'DESIGN_NOT_PUBLIC',
  PLACEMENT_UNSUPPORTED: 'PLACEMENT_UNSUPPORTED',
} as const;

/** Trạng thái đơn TikTok không còn ý nghĩa để sản xuất. */
const UNFULFILLABLE_TIKTOK_STATUSES = new Set(['CANCELLED', 'UNPAID']);

/**
 * FulfillmentReadinessService — trả lời đúng một câu hỏi:
 * "Đơn này đã đủ dữ liệu để gửi sang xưởng in chưa, nếu chưa thì THIẾU CHÍNH XÁC cái gì?"
 *
 * Tách riêng khỏi service tạo đơn để:
 *  - Màn hình danh sách gọi được để hiển thị nút Fulfill mờ/sáng mà không gọi API xưởng in.
 *  - Luồng tạo đơn dùng LẠI chính hàm này ⇒ không thể có chuyện UI báo sẵn sàng
 *    nhưng backend lại từ chối (một nguồn sự thật duy nhất).
 *
 * Điều kiện (theo yêu cầu nghiệp vụ):
 *  ✓ Có đơn TikTok       ✓ Có địa chỉ giao hàng đầy đủ (không bị TikTok che)
 *  ✓ Có Design           ✓ Có ánh xạ Product/Variant
 *  ✓ Chưa fulfill        (kiểm ở tầng service — cần trạng thái bản ghi fulfillment)
 */
@Injectable()
export class FulfillmentReadinessService {
  constructor(
    private readonly encryption: TiktokEncryptionService,
    private readonly mapper: MangoOrderMapper,
  ) {}

  /**
   * Kiểm tra một đơn.
   *
   * @param order    Đơn POD kèm items + designs + account (đã nạp sẵn — không query thêm).
   * @param mappings Toàn bộ ánh xạ sản phẩm của tổ chức (đã nạp MỘT lần ở service gọi
   *                 ⇒ kiểm hàng loạt đơn cũng không phát sinh N+1).
   * @param publicBaseUrl Base URL public để dựng link design khi bucket không công khai.
   */
  check(
    order: PodOrderWithRelations,
    mappings: MappingWithDesigns[],
    /** Design của tổ chức, tra theo (Product ID + Seller SKU). Rỗng = chưa upload gì. */
    designsByKey: DesignsByProductKey,
    publicBaseUrl?: string,
    /**
     * Tài khoản nhà cung cấp sẽ nhận đơn này. Truyền vào để phát hiện ánh xạ khai cho nhà
     * cung cấp khác; bỏ trống thì bỏ qua phép kiểm đó.
     */
    expectedAccountId?: string,
  ): ReadinessResult {
    const issues: ReadinessIssue[] = [];

    if (UNFULFILLABLE_TIKTOK_STATUSES.has(order.status)) {
      issues.push({
        code: READINESS_CODES.ORDER_CANCELLED,
        message: `Đơn TikTok đang ở trạng thái ${order.status} — không thể sản xuất.`,
      });
    }

    if (order.items.length === 0) {
      issues.push({ code: READINESS_CODES.NO_ITEMS, message: 'Đơn không có sản phẩm nào.' });
    }

    const address = this.resolveAddress(order, issues);
    const items = this.resolveItems(
      order,
      mappings,
      designsByKey,
      publicBaseUrl,
      issues,
      expectedAccountId,
    );

    return {
      ready: issues.length === 0,
      issues,
      address: address ?? undefined,
      items: items.length > 0 ? items : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Giải mã và chuẩn hoá địa chỉ; ghi lý do cụ thể nếu không dùng được. */
  private resolveAddress(
    order: PodOrderWithRelations,
    issues: ReadinessIssue[],
  ): NormalizedAddress | null {
    if (!order.recipientEnc) {
      issues.push({
        code: READINESS_CODES.ADDRESS_MISSING,
        message: 'Đơn chưa có địa chỉ người nhận. Hãy đồng bộ lại đơn từ TikTok.',
      });
      return null;
    }

    // 🔴 TikTok che địa chỉ với đơn 4PL US và đơn cũ (>30 ngày sau COMPLETED).
    // Địa chỉ đã che thì KHÔNG thể giao hàng — phải chặn ngay, không gửi rác sang xưởng in.
    if (order.recipientMasked) {
      issues.push({
        code: READINESS_CODES.ADDRESS_MASKED,
        message:
          'TikTok đã che thông tin người nhận của đơn này (đơn 4PL hoặc đơn quá hạn hiển thị). ' +
          'Không thể tự gửi sản xuất — cần dùng nhãn vận chuyển do TikTok cấp.',
      });
      return null;
    }

    let recipient: TiktokRecipientAddress;
    try {
      recipient = JSON.parse(this.encryption.decrypt(order.recipientEnc)) as TiktokRecipientAddress;
    } catch {
      issues.push({
        code: READINESS_CODES.ADDRESS_MISSING,
        message: 'Không đọc được địa chỉ người nhận đã lưu. Hãy đồng bộ lại đơn từ TikTok.',
      });
      return null;
    }

    const normalized = this.mapper.normalizeAddress(recipient);
    if (!normalized) {
      issues.push({
        code: READINESS_CODES.ADDRESS_INCOMPLETE,
        message:
          'Địa chỉ người nhận thiếu thông tin bắt buộc (tên, địa chỉ, thành phố, bang, quốc gia hoặc mã bưu chính).',
      });
      return null;
    }
    return normalized;
  }

  /** Ghép từng line item với ánh xạ SKU và design tương ứng. */
  private resolveItems(
    order: PodOrderWithRelations,
    mappings: MappingWithDesigns[],
    designsByKey: DesignsByProductKey,
    publicBaseUrl: string | undefined,
    issues: ReadinessIssue[],
    expectedAccountId?: string,
  ): ResolvedItem[] {
    const resolved: ResolvedItem[] = [];
    // Dựng chỉ mục MỘT lần cho cả đơn — tra O(1) thay vì quét lại danh sách cho mỗi dòng.
    const index = createMappingIndex(mappings);

    for (const item of order.items) {
      const mapping = findMappingInIndex(item, index);
      if (!mapping) {
        issues.push({
          code: READINESS_CODES.MAPPING_MISSING,
          podOrderItemId: item.id,
          tiktokProductId: item.productId,
          tiktokSkuId: item.skuId,
          sellerSku: item.sellerSku,
          productName: item.productName,
          skuName: item.skuName,
          productCategory: item.productCategory,
          message:
            `Chưa khai báo ánh xạ sản phẩm cho "${item.productName ?? item.sellerSku ?? item.id}"` +
            ` (Product ID: ${item.productId ?? '—'} · Seller SKU: ${item.sellerSku ?? '—'}). ` +
            'Vào màn hình Ánh xạ sản phẩm để khai cặp khoá này — khai một lần là mọi đơn ' +
            'cùng sản phẩm đều dùng được.',
        });
        continue;
      }

      // 🔴 Ánh xạ được tra ở phạm vi TỔ CHỨC (đúng như danh tính của nó), nên có thể gặp bản
      // ghi khai cho nhà cung cấp khác. Nói thẳng ra thay vì im lặng gửi SKU của xưởng này
      // sang xưởng kia.
      if (expectedAccountId && mapping.accountId !== expectedAccountId) {
        issues.push({
          code: READINESS_CODES.MAPPING_PROVIDER_MISMATCH,
          podOrderItemId: item.id,
          tiktokProductId: item.productId,
          tiktokSkuId: item.skuId,
          sellerSku: item.sellerSku,
          productName: item.productName,
          skuName: item.skuName,
          productCategory: item.productCategory,
          message:
            `Sản phẩm "${item.productName ?? item.sellerSku ?? item.id}" đã có ánh xạ, nhưng ` +
            'ánh xạ đó khai cho một nhà cung cấp KHÁC với nhà cung cấp gán cho kết nối TikTok ' +
            'của đơn này. Sửa ánh xạ, hoặc đổi nhà cung cấp của kết nối TikTok cho khớp.',
        });
        continue;
      }

      const printFiles = this.resolvePrintFiles(item, mapping, designsByKey, publicBaseUrl, issues);
      if (printFiles.length === 0) continue;

      resolved.push({
        podOrderItemId: item.id,
        providerSku: mapping.providerSku,
        // TikTok trả 1 line item = 1 đơn vị sản phẩm (Order API overview).
        quantity: 1,
        productionConfig: mapping.productionConfig,
        // Giá vốn khai ở Product Mapping — chép làm ảnh chụp lúc gửi, xem `replaceItems`.
        baseCost: mapping.baseCost === null ? null : Number(mapping.baseCost),
        printFiles,
      });
    }

    return resolved;
  }

  /**
   * Dựng danh sách file in từ design đã upload.
   *
   * 🔴 KHÔNG upload lại file: design đã nằm trên Cloudflare R2, chỉ truyền URL.
   * Mango tải file từ URL này nên URL BẮT BUỘC phải truy cập công khai — bucket private
   * (không có `publicUrl`) sẽ bị chặn tại đây kèm hướng dẫn xử lý.
   */
  private resolvePrintFiles(
    item: PodOrderWithRelations['items'][number],
    mapping: MappingWithDesigns,
    designsByKey: DesignsByProductKey,
    publicBaseUrl: string | undefined,
    issues: ReadinessIssue[],
  ): MangoPrintFile[] {
    // 🔴 Design tra theo (Product ID + Seller SKU) của CHÍNH line item, KHÔNG qua ánh xạ.
    // Design và ánh xạ là hai nghiệp vụ độc lập: đơn có thể đã có design từ trước khi ai đó
    // khai ánh xạ, và đổi ánh xạ sang nhà cung cấp khác không được làm mất file in.
    const key = mappingKeyOf(item.productId, item.sellerSku);
    const designs = key ? (designsByKey.get(key) ?? []) : [];

    if (designs.length === 0) {
      issues.push({
        code: READINESS_CODES.DESIGN_MISSING,
        podOrderItemId: item.id,
        // Nêu đúng chỗ phải sửa: design giờ khai ở Product Mapping, không khai ở đơn.
        message:
          `Sản phẩm "${item.productName ?? item.id}" chưa có file design. ` +
          'Upload design ở Product Mapping tương ứng — một lần là dùng cho mọi đơn cùng ' +
          'Product ID + Seller SKU, kể cả đơn đồng bộ về sau này.',
      });
      return [];
    }

    const files: MangoPrintFile[] = [];
    for (const design of designs) {
      const key = this.mapper.resolvePlacement(design.placement, mapping.placementMap);
      if (!key) {
        issues.push({
          code: READINESS_CODES.PLACEMENT_UNSUPPORTED,
          podOrderItemId: item.id,
          message: `Vị trí in "${design.placement}" chưa có ánh xạ sang nhà cung cấp.`,
        });
        continue;
      }

      const url = this.publicUrlOf(design.storageFile.publicUrl, publicBaseUrl);
      if (!url) {
        issues.push({
          code: READINESS_CODES.DESIGN_NOT_PUBLIC,
          podOrderItemId: item.id,
          message:
            `File design vị trí "${design.placement}" không có URL công khai. ` +
            'Xưởng in cần tải được file — hãy bật chế độ công khai cho bucket lưu trữ (R2_PUBLIC_URL).',
        });
        continue;
      }

      files.push({ key, url });
    }

    return files;
  }

  /**
   * URL công khai của design. Bucket private ⇒ không có `publicUrl` ⇒ trả null
   * (đường tải qua API cần token nên nhà cung cấp không dùng được).
   */
  private publicUrlOf(publicUrl: string | null, publicBaseUrl?: string): string | null {
    if (!publicUrl) return null;
    if (/^https?:\/\//i.test(publicUrl)) return publicUrl;
    // Lưu trữ đĩa cục bộ trả đường dẫn tương đối — cần ghép base URL công khai.
    if (!publicBaseUrl) return null;
    return `${publicBaseUrl.replace(/\/+$/, '')}${publicUrl}`;
  }

  /** Tiện ích cho UI: gom lý do theo line item. */
  static groupIssuesByItem(issues: ReadinessIssue[]): Map<string, ReadinessIssue[]> {
    const grouped = new Map<string, ReadinessIssue[]>();
    for (const issue of issues) {
      if (!issue.podOrderItemId) continue;
      const list = grouped.get(issue.podOrderItemId) ?? [];
      list.push(issue);
      grouped.set(issue.podOrderItemId, list);
    }
    return grouped;
  }
}
