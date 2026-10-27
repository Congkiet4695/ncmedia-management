import { Injectable } from '@nestjs/common';
import { PodDesignPlacement, Prisma } from '@prisma/client';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import type { TiktokRecipientAddress } from '../../pod-tiktok/types/tiktok-order.types';
import {
  MangoOrderMapper,
  NormalizedAddress,
  ResolvedItem,
  type ResolvedPrintFile,
} from '../mango/mappers/mango-order.mapper';
import { PRODUCT_KEY_ISSUE_MESSAGE } from '../../pod-tiktok/shared/order-item-product-key';
import { createMappingIndex, findMappingInIndex, mappingKeyOf } from '../shared/mapping-match';
import {
  FulfillmentShippingLabelService,
  type ShippingLabelState,
} from './fulfillment-shipping-label.service';

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
  /** URL công khai nhập trực tiếp (nguồn URL). Có thì dùng NGUYÊN VĂN — không upload lại. */
  sourceUrl: string | null;
  /** File upload (nguồn UPLOAD). NULL khi design là nguồn URL. */
  storageFile: { publicUrl: string | null } | null;
}

/**
 * Design của cả tổ chức, tra theo khoá `mappingKeyOf(productId, sellerSku)`.
 *
 * 🔴 Truyền vào thay vì để `check()` tự truy vấn: `check()` là hàm ĐỒNG BỘ và được gọi cho
 * hàng loạt đơn trong một vòng lặp; cho nó tự query là mở đường cho N+1.
 */
export type DesignsByProductKey = Map<string, ReadinessDesign[]>;

/**
 * Khoá vị trí in PHÍA NHÀ CUNG CẤP cho một design của một ánh xạ — `null` = không in được ở đó.
 *
 * 🔴 Mỗi nhà cung cấp một luật: Mango dùng danh sách `print_files[].key` cố định trong tài liệu;
 * Sellerwix dùng `print_areas[].key` của CHÍNH biến thể (khác nhau theo sản phẩm). Nơi gọi truyền
 * luật của nhà cung cấp đang xét; bỏ trống ⇒ luật Mango (hành vi cũ).
 */
export type PlacementResolver = (
  placement: PodDesignPlacement,
  mapping: MappingWithDesigns,
) => string | null;

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
  /**
   * Cảnh báo KHÔNG chặn gửi — hiện chỉ có `PROMOTION_GIFT_NOT_SENT` (quà tặng khuyến mãi không
   * được gửi sang nhà cung cấp). Luôn có mặt (mảng rỗng khi không có gì).
   */
  warnings: ReadinessIssue[];
  address?: NormalizedAddress;
  items?: ResolvedItem[];
  /**
   * Line sản xuất thống nhất của cả đơn (id nhà cung cấp) — suy từ ánh xạ của các dòng hàng.
   * `null` = không dòng nào khai ⇒ dùng mặc định của tài khoản.
   */
  productionLine?: string | null;
  /**
   * Cách đơn này ra khỏi kho:
   *
   * ```
   *   ADDRESS  — có địa chỉ người nhận đọc được ⇒ nhà cung cấp tự mua nhãn như thường lệ
   *   LABEL    — KHÔNG đọc được địa chỉ, nhưng đã có nhãn vận chuyển hợp lệ ⇒ gửi theo nhãn
   * ```
   */
  shippingMode?: 'ADDRESS' | 'LABEL';
  /** Nhãn vận chuyển đang gắn với đơn (nếu có) — nguồn: database, không phải form. */
  shippingLabel?: ShippingLabelState | null;
}

/** Mã lỗi chuẩn — dùng chung BE/FE, không rải chuỗi tự do khắp nơi. */
export const READINESS_CODES = {
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  NO_ITEMS: 'NO_ITEMS',
  /**
   * Đơn CÓ dòng hàng nhưng không còn dòng nào để gửi nhà cung cấp — mọi dòng đều là quà tặng
   * khuyến mãi chưa cấu hình sản xuất. Gửi một đơn rỗng sang xưởng là vô nghĩa ⇒ chặn.
   */
  NO_FULFILLABLE_ITEMS: 'NO_FULFILLABLE_ITEMS',
  /**
   * CẢNH BÁO (không chặn): dòng hàng là quà tặng khuyến mãi (`line_items[].is_gift = true` của
   * TikTok) chưa có Product Mapping ⇒ KHÔNG gửi sang nhà cung cấp. Quà vẫn nằm trong đơn/gói
   * TikTok; người bán phải tự lo phần giao quà. Chỉ nằm trong `ReadinessResult.warnings`.
   */
  PROMOTION_GIFT_NOT_SENT: 'PROMOTION_GIFT_NOT_SENT',
  ADDRESS_MISSING: 'ADDRESS_MISSING',
  ADDRESS_MASKED: 'ADDRESS_MASKED',
  ADDRESS_INCOMPLETE: 'ADDRESS_INCOMPLETE',
  /**
   * Không đọc được địa chỉ người nhận VÀ đơn chưa có nhãn vận chuyển.
   *
   * 🔴 Đây là mã thay thế cho việc dùng `ADDRESS_MASKED` làm rào chặn tuyệt đối. Địa chỉ bị
   * che KHÔNG tự nó là lý do cấm gửi sản xuất: TikTok che địa chỉ thì chính TikTok cấp nhãn
   * vận chuyển, và xưởng in chỉ cần nhãn đó. Chỉ khi không có CẢ HAI mới thật sự bế tắc.
   */
  TIKTOK_SHIPPING_LABEL_REQUIRED: 'TIKTOK_SHIPPING_LABEL_REQUIRED',
  MAPPING_MISSING: 'MAPPING_MISSING',
  /**
   * Dòng đơn KHÔNG có khoá sản phẩm (TikTok Product ID + Seller SKU) — kể cả sau khi đã thử lấy Seller SKU từ danh
   * mục Products. Tách khỏi `MAPPING_MISSING`: không khai ánh xạ được cho tới khi có khoá, nên câu "vào Product
   * Mapping khai đi" là sai hướng. `message` nói đúng lý do và chỗ phải sửa (`order-item-product-key.ts`).
   */
  MAPPING_KEY_MISSING: 'MAPPING_KEY_MISSING',
  /**
   * Sản phẩm ĐÃ có ánh xạ, nhưng ánh xạ đó khai cho một nhà cung cấp KHÁC với nhà cung cấp
   * mà kết nối TikTok của đơn đang dùng.
   *
   * 🔴 Tách khỏi `MAPPING_MISSING` vì hai lỗi này sửa khác nhau hoàn toàn: một cái là "khai
   * ánh xạ đi", cái này là "ánh xạ có rồi nhưng bạn đang gửi nhầm xưởng". Gửi bừa SKU của
   * xưởng A sang xưởng B là in ra một sản phẩm khác hẳn.
   */
  MAPPING_PROVIDER_MISMATCH: 'MAPPING_PROVIDER_MISMATCH',
  /**
   * Các dòng hàng của đơn khai HAI line sản xuất khác nhau.
   *
   * 🔴 Tài liệu MangoTeePrints: một đơn chỉ thuộc MỘT xưởng (tên sản phẩm mang tên xưởng).
   * Trộn hai xưởng thì nhà cung cấp từ chối cả đơn — chặn ở đây để không tốn một lời gọi và
   * để người vận hành biết phải sửa ánh xạ nào.
   */
  PRODUCTION_LINE_CONFLICT: 'PRODUCTION_LINE_CONFLICT',
  DESIGN_MISSING: 'DESIGN_MISSING',
  DESIGN_NOT_PUBLIC: 'DESIGN_NOT_PUBLIC',
  PLACEMENT_UNSUPPORTED: 'PLACEMENT_UNSUPPORTED',
} as const;

/**
 * Khu vực trên màn hình Fulfill mà mỗi lỗi THUỘC VỀ.
 *
 * 🔴 Backend quyết định, không phải giao diện. Màn hình Fulfill hiện lỗi NGAY TẠI khối cần sửa
 * (Nhà cung cấp · Địa chỉ · Ánh xạ sản phẩm · Design), nên nếu để frontend tự đoán theo mã thì
 * mỗi lần thêm mã lỗi mới là một lần giao diện âm thầm dồn nó vào nhóm "khác".
 */
export const FULFILLMENT_ISSUE_SECTIONS = [
  'ORDER',
  'PROVIDER',
  'ADDRESS',
  // Khối "Thiết lập Fulfill" — nơi có ô nhãn vận chuyển và nút lấy nhãn từ TikTok.
  'SHIPPING',
  'MAPPING',
  'DESIGN',
] as const;
export type FulfillmentIssueSection = (typeof FULFILLMENT_ISSUE_SECTIONS)[number];

const SECTION_BY_CODE: Readonly<Record<string, FulfillmentIssueSection>> = {
  ORDER_NOT_FOUND: 'ORDER',
  ORDER_CANCELLED: 'ORDER',
  NO_ITEMS: 'ORDER',
  NO_FULFILLABLE_ITEMS: 'ORDER',
  PROMOTION_GIFT_NOT_SENT: 'MAPPING',
  ACCOUNT_MISSING: 'PROVIDER',
  PROVIDER_NOT_ASSIGNED: 'PROVIDER',
  PROVIDER_INACTIVE: 'PROVIDER',
  ADDRESS_MISSING: 'ADDRESS',
  ADDRESS_MASKED: 'ADDRESS',
  ADDRESS_INCOMPLETE: 'ADDRESS',
  TIKTOK_SHIPPING_LABEL_REQUIRED: 'SHIPPING',
  MAPPING_MISSING: 'MAPPING',
  MAPPING_KEY_MISSING: 'MAPPING',
  MAPPING_PROVIDER_MISMATCH: 'MAPPING',
  PRODUCTION_LINE_CONFLICT: 'MAPPING',
  DESIGN_MISSING: 'DESIGN',
  DESIGN_NOT_PUBLIC: 'DESIGN',
  PLACEMENT_UNSUPPORTED: 'DESIGN',
};

/** Khu vực của một mã lỗi; mã lạ ⇒ `ORDER` (khối chung đầu màn hình, không bị giấu đi). */
export function issueSectionOf(code: string): FulfillmentIssueSection {
  return SECTION_BY_CODE[code] ?? 'ORDER';
}

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
    /** Luật vị trí in của nhà cung cấp — xem `PlacementResolver`. */
    placementResolver?: PlacementResolver,
  ): ReadinessResult {
    const issues: ReadinessIssue[] = [];
    const warnings: ReadinessIssue[] = [];
    const resolvePlacement: PlacementResolver =
      placementResolver ??
      ((placement, mapping) => this.mapper.resolvePlacement(placement, mapping.placementMap));

    if (UNFULFILLABLE_TIKTOK_STATUSES.has(order.status)) {
      issues.push({
        code: READINESS_CODES.ORDER_CANCELLED,
        message: `Đơn TikTok đang ở trạng thái ${order.status} — không thể sản xuất.`,
      });
    }

    if (order.items.length === 0) {
      issues.push({ code: READINESS_CODES.NO_ITEMS, message: 'Đơn không có sản phẩm nào.' });
    }

    // 🔴 Địa chỉ và nhãn được xét CÙNG NHAU, không phải hai luật rời nhau: đơn chỉ bế tắc khi
    // KHÔNG đọc được địa chỉ VÀ cũng không có nhãn vận chuyển.
    const shippingLabel = FulfillmentShippingLabelService.labelOf(order);
    const resolved = this.resolveAddress(order, issues, Boolean(shippingLabel));
    // Không đọc được địa chỉ nhưng CÓ nhãn ⇒ đơn vẫn đi được: địa chỉ thật nằm trên nhãn, và
    // phần gửi cho nhà cung cấp chỉ còn là những gì TikTok cho phép đọc (xem mapper).
    const address =
      resolved.address ??
      (shippingLabel
        ? this.mapper.buildLabelShippingAddress({
            recipient: resolved.recipient,
            regionCode: order.recipientRegionCode,
            postalCode: order.recipientPostalCode,
          })
        : null);
    const items = this.resolveItems(
      order,
      mappings,
      designsByKey,
      publicBaseUrl,
      issues,
      warnings,
      resolvePlacement,
      expectedAccountId,
    );

    // Mọi dòng đều là quà tặng không gửi đi ⇒ không còn gì cho xưởng sản xuất. Chỉ xét khi đơn
    // không có lý do chặn nào khác — lý do khác đã giải thích vì sao danh sách gửi rỗng.
    if (order.items.length > 0 && items.length === 0 && issues.length === 0) {
      issues.push({
        code: READINESS_CODES.NO_FULFILLABLE_ITEMS,
        message:
          'Đơn chỉ gồm quà tặng khuyến mãi chưa cấu hình sản xuất — không có sản phẩm nào để gửi ' +
          'sang nhà cung cấp. Khai Product Mapping cho quà tặng nếu xưởng cần sản xuất nó.',
      });
    }

    // Một đơn = một xưởng. Hai dòng khai hai line khác nhau ⇒ chặn tại đây, nói rõ hai giá trị.
    const lines = [...new Set(items.map((item) => item.productionLine).filter(Boolean))] as string[];
    if (lines.length > 1) {
      issues.push({
        code: READINESS_CODES.PRODUCTION_LINE_CONFLICT,
        message:
          `Các sản phẩm trong đơn đang khai hai line sản xuất khác nhau (${lines.join(' · ')}). ` +
          'Nhà cung cấp chỉ nhận đơn thuộc MỘT xưởng — sửa Cấu hình sản phẩm cho khớp rồi gửi lại.',
      });
    }

    return {
      ready: issues.length === 0,
      issues,
      warnings,
      address: address ?? undefined,
      items: items.length > 0 ? items : undefined,
      productionLine: lines.length === 1 ? lines[0] : null,
      shippingMode: resolved.address ? 'ADDRESS' : 'LABEL',
      shippingLabel,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Địa chỉ giao hàng dùng được, hoặc `null` kèm lý do.
   *
   * 🔴 **Quyết theo DỮ LIỆU, không theo cờ `recipient_masked`.** Cờ đó chỉ nói "lần đồng bộ gần
   * đây TikTok trả về bản đã che"; nhờ quy tắc masking-safe write, `recipient_enc` vẫn giữ bản
   * THẬT chụp trước đó. Chặn theo cờ là chặn nhầm hàng loạt đơn mà hệ thống có đủ địa chỉ để
   * giao — đúng lỗi đang gặp trên màn hình Fulfill.
   *
   * 🔴 **Không đọc được địa chỉ cũng chưa chắc là bế tắc.** Có nhãn vận chuyển (TikTok cấp
   * hoặc người vận hành dán vào) thì xưởng in chỉ cần in nhãn — địa chỉ thật nằm trên nhãn.
   * Vì thế `hasShippingLabel` được truyền vào đây: nó quyết định lý do ghi ra là
   * "cần lấy nhãn" hay "không có gì để ghi cả".
   */
  private resolveAddress(
    order: PodOrderWithRelations,
    issues: ReadinessIssue[],
    hasShippingLabel: boolean,
  ): { address: NormalizedAddress | null; recipient: TiktokRecipientAddress | null } {
    let decoded: TiktokRecipientAddress | null = null;
    const fail = (
      code: string,
      message: string,
    ): { address: null; recipient: TiktokRecipientAddress | null } => {
      // Đã có nhãn ⇒ đơn vẫn gửi được, không ghi lý do chặn nào.
      if (!hasShippingLabel) issues.push({ code, message });
      return { address: null, recipient: decoded };
    };

    if (!order.recipientEnc) {
      return fail(
        READINESS_CODES.TIKTOK_SHIPPING_LABEL_REQUIRED,
        'Đơn chưa có địa chỉ người nhận. Hãy đồng bộ lại đơn từ TikTok, hoặc lấy nhãn vận ' +
          'chuyển của TikTok cho đơn này rồi gửi sản xuất theo nhãn.',
      );
    }

    let recipient: TiktokRecipientAddress;
    try {
      recipient = JSON.parse(this.encryption.decrypt(order.recipientEnc)) as TiktokRecipientAddress;
      decoded = recipient;
    } catch {
      return fail(
        READINESS_CODES.TIKTOK_SHIPPING_LABEL_REQUIRED,
        'Không đọc được địa chỉ người nhận đã lưu. Hãy đồng bộ lại đơn từ TikTok, hoặc lấy ' +
          'nhãn vận chuyển của TikTok rồi gửi sản xuất theo nhãn.',
      );
    }

    const normalized = this.mapper.normalizeAddress(recipient);
    if (!normalized) {
      return fail(
        READINESS_CODES.TIKTOK_SHIPPING_LABEL_REQUIRED,
        order.recipientMasked
          ? 'TikTok đã che thông tin người nhận của đơn này (đơn 4PL hoặc đơn quá hạn hiển ' +
              'thị). Lấy nhãn vận chuyển của TikTok cho đơn này — xưởng in sẽ in đúng nhãn đó ' +
              '— hoặc dán URL nhãn bạn đã có vào ô "Nhãn vận chuyển".'
          : 'Địa chỉ người nhận thiếu thông tin bắt buộc (tên, địa chỉ, thành phố, bang, quốc ' +
              'gia hoặc mã bưu chính). Đồng bộ lại đơn, hoặc gửi sản xuất theo nhãn vận chuyển.',
      );
    }
    return { address: normalized, recipient };
  }

  /**
   * Ghép từng line item với ánh xạ SKU và design tương ứng.
   *
   * 🔴 **Quà tặng khuyến mãi** — CHỈ khi TikTok trả `line_items[].is_gift = true` (cột
   * `pod_order_items.is_gift`, ghi bởi đồng bộ đơn; không bao giờ lấy từ request của giao diện,
   * không đoán theo tên hay giá 0):
   *  - CHƯA có Product Mapping (hoặc không có khoá) ⇒ không đòi cấu hình, KHÔNG gửi sang nhà
   *    cung cấp (không có SKU xưởng để gửi — tự chế SKU là in sai hàng), ghi CẢNH BÁO để người
   *    vận hành biết quà phải được giao theo cách khác.
   *  - ĐÃ có Product Mapping ⇒ người bán đã chọn cho xưởng sản xuất quà ⇒ kiểm như dòng thường
   *    (thiếu design / lệch nhà cung cấp vẫn CHẶN — không âm thầm bỏ quà khỏi đơn đã cấu hình).
   * Dòng `is_gift = false` hoặc không rõ (TikTok không trả field) luôn đi luồng thường.
   */
  private resolveItems(
    order: PodOrderWithRelations,
    mappings: MappingWithDesigns[],
    designsByKey: DesignsByProductKey,
    publicBaseUrl: string | undefined,
    issues: ReadinessIssue[],
    warnings: ReadinessIssue[],
    resolvePlacement: PlacementResolver,
    expectedAccountId?: string,
  ): ResolvedItem[] {
    const resolved: ResolvedItem[] = [];
    // Dựng chỉ mục MỘT lần cho cả đơn — tra O(1) thay vì quét lại danh sách cho mỗi dòng.
    const index = createMappingIndex(mappings);

    for (const item of order.items) {
      if (item.isGift === true && !findMappingInIndex(item, index)) {
        warnings.push({
          code: READINESS_CODES.PROMOTION_GIFT_NOT_SENT,
          podOrderItemId: item.id,
          tiktokProductId: item.productId,
          tiktokSkuId: item.skuId,
          sellerSku: item.sellerSku,
          productName: item.productName,
          skuName: item.skuName,
          productCategory: item.productCategory,
          message:
            `"${item.productName ?? item.id}"${item.skuName ? ` (${item.skuName})` : ''} là quà tặng ` +
            'khuyến mãi của TikTok — không yêu cầu Product Configuration và KHÔNG được gửi sang nhà ' +
            'cung cấp. Quà vẫn thuộc đơn TikTok: hãy đảm bảo quà được giao cho người mua.',
        });
        continue;
      }

      // 🔴 Không có khoá ⇒ không thể có ánh xạ lẫn design: báo ĐÚNG MỘT lỗi kèm lý do, thay vì cặp "chưa khai ánh
      // xạ" + "chưa có design" (cả hai đều không sửa được khi chưa có khoá).
      if (!mappingKeyOf(item.productId, item.sellerSku)) {
        const reason =
          item.productKeyIssue ?? (item.productId?.trim() ? 'SELLER_SKU_EMPTY_ON_TIKTOK' : 'NO_PRODUCT_ID');
        issues.push({
          code: READINESS_CODES.MAPPING_KEY_MISSING,
          podOrderItemId: item.id,
          tiktokProductId: item.productId,
          tiktokSkuId: item.skuId,
          sellerSku: null,
          productName: item.productName,
          skuName: item.skuName,
          productCategory: item.productCategory,
          message:
            `"${item.productName ?? item.id}"${item.skuName ? ` (${item.skuName})` : ''} — ` +
            `${PRODUCT_KEY_ISSUE_MESSAGE[reason]} (Product ID: ${item.productId ?? '—'} · SKU ID: ${item.skuId ?? '—'})`,
        });
        continue;
      }

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

      const printFiles = this.resolvePrintFiles(
        item,
        mapping,
        designsByKey,
        publicBaseUrl,
        issues,
        resolvePlacement,
      );
      if (printFiles.length === 0) continue;

      resolved.push({
        podOrderItemId: item.id,
        tiktokLineItemId: item.tiktokLineItemId,
        providerSku: mapping.providerSku,
        // TikTok trả 1 line item = 1 đơn vị sản phẩm (Order API overview).
        quantity: 1,
        productionConfig: mapping.productionConfig,
        // Giá vốn khai ở Product Mapping — chép làm ảnh chụp lúc gửi, xem `replaceItems`.
        baseCost: mapping.baseCost === null ? null : Number(mapping.baseCost),
        productionLine: mapping.productionLine ?? null,
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
    resolvePlacement: PlacementResolver,
  ): ResolvedPrintFile[] {
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

    const files: ResolvedPrintFile[] = [];
    for (const design of designs) {
      const key = resolvePlacement(design.placement, mapping);
      if (!key) {
        issues.push({
          code: READINESS_CODES.PLACEMENT_UNSUPPORTED,
          podOrderItemId: item.id,
          message: `Vị trí in "${design.placement}" chưa có ánh xạ sang nhà cung cấp.`,
        });
        continue;
      }

      // Nguồn URL: URL người vận hành nhập đã được kiểm HTTPS + host công khai lúc lưu.
      const url =
        design.sourceUrl ?? this.publicUrlOf(design.storageFile?.publicUrl ?? null, publicBaseUrl);
      if (!url) {
        issues.push({
          code: READINESS_CODES.DESIGN_NOT_PUBLIC,
          podOrderItemId: item.id,
          message:
            `File design vị trí "${design.placement}" không có URL công khai. ` +
            'Xưởng in cần tải được file — hãy bật chế độ công khai cho bucket lưu trữ (R2_PUBLIC_URL) ' +
            'hoặc nhập URL công khai (HTTPS) cho vị trí này.',
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
