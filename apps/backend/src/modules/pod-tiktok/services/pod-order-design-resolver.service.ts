import { Injectable } from '@nestjs/common';
import type { FulfillmentAutoMapStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { StorageMapper } from '../../storage/storage.mapper';
import {
  createMappingIndex,
  findMappingInIndex,
  mappingKeyOf,
} from '../../fulfillment/shared/mapping-match';
import { PodDesignDto } from '../dto/pod-design.dto';
import type { PodOrderWithRelations } from '../types/pod-order-with-relations.type';

/** Ánh xạ, đúng những trường dùng để ghép. */
interface MappingRow {
  id: string;
  tiktokProductId: string | null;
  sellerSku: string | null;
  isActive: boolean;
}

/** Design của một sản phẩm, đúng những trường cần để hiển thị. */
interface DesignRow {
  id: string;
  placement: PodDesignDto['placement'];
  version: number;
  tiktokProductId: string | null;
  sellerSku: string | null;
  storageFile: {
    id: string;
    publicUrl: string | null;
    originalName: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: Date;
    uploader: { fullName: string } | null;
  };
}

/**
 * Tình trạng ánh xạ của một line item — bốn trạng thái dẫn tới bốn hành động khác nhau.
 *
 * `MAPPED`        — đã có Product Mapping, không phải làm gì.
 * `NEED_MANUAL`   — ánh xạ tự động tìm được NHIỀU ứng viên nên không dám tự chọn.
 *                   Người dùng bấm "Map Product", danh sách đã lọc sẵn.
 * `MISSING`       — đã rà và không tìm thấy gì, hoặc chưa rà bao giờ. Phải khai tay.
 * `NO_PROVIDER`   — kết nối TikTok chưa gán nhà cung cấp, hoặc danh mục chưa đồng bộ lần nào.
 *                   Sửa ở màn hình cấu hình nhà cung cấp, KHÔNG phải ở đây.
 *
 * 🔴 Gộp bốn thứ này thành một chữ "thiếu ánh xạ" chính là lý do người dùng bấm mãi một nút
 * không giải quyết được vấn đề của họ.
 *
 * ⚠️ Trạng thái này KHÔNG liên quan tới design. Sản phẩm chưa ánh xạ vẫn upload design được.
 */
export type ItemMappingStatus = 'MAPPED' | 'NEED_MANUAL' | 'MISSING' | 'NO_PROVIDER';

/** Một ứng viên mà ánh xạ tự động tìm được — để dialog Map Product mở ra đã lọc sẵn. */
export interface ItemMappingCandidate {
  productId: string;
  externalProductId: string;
  productName: string;
  variantId: string;
  externalVariantId: string;
  sku: string;
  variantName: string;
  catalogueId: string | null;
  catalogueName: string | null;
}

/**
 * Design + tình trạng ánh xạ của MỘT line item.
 *
 * 🔴 `designs` và `mappingId` được giải quyết ĐỘC LẬP với nhau:
 *   - `designs`   tra theo (Product ID + Seller SKU) — có ngay cả khi chưa ánh xạ.
 *   - `mappingId` tra theo cùng cặp khoá nhưng trong bảng ánh xạ — `null` nghĩa là chưa khai.
 * Một dòng hàng hoàn toàn có thể có design mà chưa có ánh xạ, và ngược lại.
 */
export interface ResolvedItemDesigns {
  mappingId: string | null;
  mappingStatus: ItemMappingStatus;
  designs: PodDesignDto[];
  /** Chỉ có với `NEED_MANUAL` — tối đa vài chục ứng viên hàng đầu. */
  candidates: ItemMappingCandidate[];
}

/**
 * PodOrderDesignResolver — trả lời "line item này có design nào, và đã ánh xạ chưa?".
 *
 * ```
 *   line item ──(Product ID + Seller SKU)──┬──▶ fulfillment_product_designs   → design
 *                                          └──▶ fulfillment_product_mappings  → ánh xạ
 * ```
 *
 * 🔴 **Hai nhánh độc lập, cùng một cặp khoá.** Trước đây design được đọc QUA ánh xạ
 * (`mapping.designs`), nên sản phẩm chưa ánh xạ thì mãi mãi không có design để hiển thị — kể
 * cả khi người dùng đã upload. Đó là biểu hiện phía đọc của cùng một ràng buộc sai mà sprint
 * này gỡ bỏ ở phía ghi.
 *
 * 🔴 **Đơn hàng chỉ ĐỌC design, không sở hữu design.** Nguồn sự thật là
 * `fulfillment_product_designs`. Hệ quả của việc đọc-xuyên-suốt thay vì sao chép:
 *   - Upload / Replace ⇒ mọi đơn cùng cặp khoá hiển thị file mới ngay lần đọc kế tiếp.
 *   - Delete           ⇒ mọi đơn cùng cặp khoá quay về "Design Missing" ngay lập tức.
 *   - Đơn MỚI đồng bộ về ⇒ tự nhận design đã có, không cần upload lại lần nào.
 *
 * 🔴 Vì sao đọc thẳng bảng của module Fulfillment thay vì import `FulfillmentModule`:
 * quan hệ phụ thuộc giữa hai module là MỘT CHIỀU `Fulfillment → PodTiktok` (xem
 * `fulfillment.module.ts`). Import ngược lại là tạo vòng phụ thuộc Nest. Đây là một lượt đọc
 * **chỉ-đọc**, và luật ghép dùng chung hàm thuần `mapping-match.ts` nên không thể trôi lệch.
 *
 * 🔴 BA truy vấn cho cả trang (design · ánh xạ · kết quả rà tự động), ghép trong bộ nhớ. Tra
 * theo từng line item sẽ là N+1 trên một màn hình 20 đơn × nhiều sản phẩm.
 */
@Injectable()
export class PodOrderDesignResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageMapper: StorageMapper,
  ) {}

  /**
   * Design + tình trạng ánh xạ theo `orderItemId` cho một tập đơn.
   *
   * Trả `Map` rỗng khi không có đơn nào — màn hình hiển thị đúng sự thật thay vì lỗi.
   */
  async resolveForOrders(
    organizationId: string,
    orders: PodOrderWithRelations[],
  ): Promise<Map<string, ResolvedItemDesigns>> {
    const result = new Map<string, ResolvedItemDesigns>();
    if (orders.length === 0) return result;

    const [designRows, mappings, candidateRows] = await Promise.all([
      // 🔴 Design tra THẲNG theo cặp khoá sản phẩm — không đi qua ánh xạ.
      this.prisma.fulfillmentProductDesign.findMany({
        where: {
          organizationId,
          deletedAt: null,
          tiktokProductId: { not: null },
          sellerSku: { not: null },
        },
        orderBy: { placement: 'asc' },
        select: {
          id: true,
          placement: true,
          version: true,
          tiktokProductId: true,
          sellerSku: true,
          storageFile: {
            select: {
              id: true,
              publicUrl: true,
              originalName: true,
              mimeType: true,
              fileSize: true,
              uploadedAt: true,
              uploader: { select: { fullName: true } },
            },
          },
        },
      }),
      this.prisma.fulfillmentProductMapping.findMany({
        where: {
          organizationId,
          deletedAt: null,
          isActive: true,
          // Thiếu khoá ⇒ không ghép được với đơn nào; lọc ngay ở DB cho khỏi tải về vô ích.
          tiktokProductId: { not: null },
          sellerSku: { not: null },
        },
        select: { id: true, tiktokProductId: true, sellerSku: true, isActive: true },
      }),
      // Kết quả rà ánh xạ tự động gần nhất. Không có bản ghi ⇒ chưa rà bao giờ ⇒ `MISSING`.
      this.prisma.fulfillmentMappingCandidate.findMany({
        where: { organizationId },
        select: { tiktokProductId: true, sellerSku: true, status: true, candidates: true },
      }),
    ]);

    const designsByKey = this.groupDesigns(designRows);
    const mappingIndex = createMappingIndex(mappings as MappingRow[]);
    const candidateByKey = new Map(
      candidateRows
        .map((row) => [mappingKeyOf(row.tiktokProductId, row.sellerSku), row] as const)
        .filter((entry): entry is [string, (typeof candidateRows)[number]] => entry[0] !== null),
    );

    for (const order of orders) {
      for (const item of order.items) {
        const key = mappingKeyOf(item.productId, item.sellerSku);
        const mapping = findMappingInIndex(item, mappingIndex);
        const candidate = key ? candidateByKey.get(key) : undefined;

        result.set(item.id, {
          mappingId: mapping?.id ?? null,
          mappingStatus: mapping ? 'MAPPED' : this.toStatus(candidate?.status),
          // 🔴 Design KHÔNG phụ thuộc `mapping`: sản phẩm chưa ánh xạ vẫn hiển thị đủ file in.
          designs: key ? (designsByKey.get(key) ?? []) : [],
          candidates:
            !mapping && candidate?.status === 'NEED_MANUAL'
              ? ((candidate.candidates ?? []) as unknown as ItemMappingCandidate[])
              : [],
        });
      }
    }

    return result;
  }

  /** Gom design theo cặp khoá, dựng DTO đúng MỘT lần cho mỗi sản phẩm. */
  private groupDesigns(rows: DesignRow[]): Map<string, PodDesignDto[]> {
    const byKey = new Map<string, PodDesignDto[]>();
    for (const row of rows) {
      const key = mappingKeyOf(row.tiktokProductId, row.sellerSku);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(this.toDto(row));
      byKey.set(key, list);
    }
    return byKey;
  }

  /**
   * Kết quả rà tự động → trạng thái hiển thị.
   *
   * Chưa rà bao giờ (`undefined`) được xếp vào `MISSING` chứ không tạo thêm trạng thái thứ
   * năm: với người dùng, "chưa rà" và "rà rồi không thấy" dẫn tới cùng một việc phải làm —
   * khai tay. Phân biệt thêm chỉ làm giao diện rối mà không đổi hành động.
   */
  private toStatus(status: FulfillmentAutoMapStatus | undefined): ItemMappingStatus {
    if (status === 'NEED_MANUAL') return 'NEED_MANUAL';
    if (status === 'SKIPPED') return 'NO_PROVIDER';
    return 'MISSING';
  }

  private toDto(design: DesignRow): PodDesignDto {
    const file = design.storageFile;
    return {
      id: design.id,
      placement: design.placement,
      // Bucket private ⇒ không có URL công khai, dùng đường tải qua API (có kiểm quyền).
      fileUrl: file.publicUrl ?? this.storageMapper.buildDownloadUrl(file.id),
      fileName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      version: design.version,
      uploadedAt: file.uploadedAt.toISOString(),
      uploadedByName: file.uploader?.fullName ?? null,
    };
  }
}
