import { Injectable } from '@nestjs/common';
import { FulfillmentProductMapping } from '@prisma/client';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import type { TiktokRecipientAddress } from '../../pod-tiktok/types/tiktok-order.types';
import {
  MangoOrderMapper,
  NormalizedAddress,
  ResolvedItem,
} from '../mango/mappers/mango-order.mapper';
import type { MangoPrintFile } from '../mango/types/mango-api.types';

/** Một lý do khiến đơn chưa gửi được — `code` để FE dịch/nhóm, `message` để hiển thị. */
export interface ReadinessIssue {
  code: string;
  message: string;
  /** Line item liên quan (nếu lỗi thuộc về một sản phẩm cụ thể). */
  podOrderItemId?: string;
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
    mappings: FulfillmentProductMapping[],
    publicBaseUrl?: string,
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
    const items = this.resolveItems(order, mappings, publicBaseUrl, issues);

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
    mappings: FulfillmentProductMapping[],
    publicBaseUrl: string | undefined,
    issues: ReadinessIssue[],
  ): ResolvedItem[] {
    const resolved: ResolvedItem[] = [];

    for (const item of order.items) {
      const mapping = this.findMapping(item, mappings);
      if (!mapping) {
        issues.push({
          code: READINESS_CODES.MAPPING_MISSING,
          podOrderItemId: item.id,
          message:
            `Chưa khai báo ánh xạ sản phẩm cho "${item.productName ?? item.sellerSku ?? item.id}"` +
            `${item.sellerSku ? ` (Seller SKU: ${item.sellerSku})` : ''}. ` +
            'Vào màn hình Ánh xạ sản phẩm để chọn SKU tương ứng bên xưởng in.',
        });
        continue;
      }

      const printFiles = this.resolvePrintFiles(item, mapping, publicBaseUrl, issues);
      if (printFiles.length === 0) continue;

      resolved.push({
        podOrderItemId: item.id,
        providerSku: mapping.providerSku,
        // TikTok trả 1 line item = 1 đơn vị sản phẩm (Order API overview).
        quantity: 1,
        productionConfig: mapping.productionConfig,
        printFiles,
      });
    }

    return resolved;
  }

  /**
   * Tìm ánh xạ theo thứ tự ưu tiên: SKU biến thể → Seller SKU → Product ID.
   * Càng cụ thể càng được ưu tiên, để một sản phẩm có thể khai chung rồi ghi đè theo biến thể.
   */
  private findMapping(
    item: PodOrderWithRelations['items'][number],
    mappings: FulfillmentProductMapping[],
  ): FulfillmentProductMapping | null {
    const active = mappings.filter((mapping) => mapping.isActive);
    return (
      (item.skuId && active.find((m) => m.tiktokSkuId === item.skuId)) ||
      (item.sellerSku && active.find((m) => m.sellerSku === item.sellerSku)) ||
      (item.productId && active.find((m) => m.tiktokProductId === item.productId)) ||
      null
    );
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
    mapping: FulfillmentProductMapping,
    publicBaseUrl: string | undefined,
    issues: ReadinessIssue[],
  ): MangoPrintFile[] {
    if (item.designs.length === 0) {
      issues.push({
        code: READINESS_CODES.DESIGN_MISSING,
        podOrderItemId: item.id,
        message: `Sản phẩm "${item.productName ?? item.id}" chưa có file design.`,
      });
      return [];
    }

    const files: MangoPrintFile[] = [];
    for (const design of item.designs) {
      const key = this.mapper.resolvePlacement(
        design.placement,
        mapping.placementMap,
      );
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
