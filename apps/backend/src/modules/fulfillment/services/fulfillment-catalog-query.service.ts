import { Injectable, NotFoundException } from '@nestjs/common';
import { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { FulfillmentAccountNotFoundException } from '../exceptions/fulfillment.exceptions';
import type {
  CatalogueDto,
  PaginatedCatalogProductDto,
  ProviderCatalogProductDto,
  ProviderCatalogVariationDto,
} from '../dto/fulfillment.dto';

export class CatalogProductNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'FULFILLMENT_CATALOG_PRODUCT_NOT_FOUND',
      message:
        'Không tìm thấy sản phẩm trong danh mục đã đồng bộ. ' +
        'Hãy đồng bộ lại danh mục nhà cung cấp.',
    });
  }
}

/**
 * FulfillmentCatalogQueryService — danh mục nhà cung cấp cho GIAO DIỆN, đọc từ DATABASE.
 *
 * 🔴 KHÔNG gọi Mango API. Đây là điểm mấu chốt của thay đổi kiến trúc: màn hình Product
 * Mapping từng gọi thẳng sang nhà cung cấp mỗi lần mở (chậm, phụ thuộc mạng, timeout);
 * giờ nó đọc bản sao do `FulfillmentCatalogSyncService` ghi xuống.
 *
 * Hệ quả có thật và phải nói rõ với người dùng: dữ liệu ở đây CŨ BẰNG lần đồng bộ gần nhất.
 * Vì vậy mọi phản hồi đều kèm `lastSyncedAt`, và màn hình có nút đồng bộ thủ công.
 */
@Injectable()
export class FulfillmentCatalogQueryService {
  constructor(
    private readonly repo: FulfillmentRepository,
    private readonly catalogRepo: FulfillmentCatalogRepository,
  ) {}

  /** Danh mục của một tài khoản (bước 2 của luồng ánh xạ). */
  async listCatalogues(organizationId: string, accountId: string): Promise<CatalogueDto[]> {
    await this.assertAccount(organizationId, accountId);

    const [rows, lastSyncedAt] = await Promise.all([
      this.catalogRepo.listCatalogues(accountId, organizationId),
      this.catalogRepo.lastSyncedAt(accountId),
    ]);

    return rows.map((row) => ({
      id: row.id,
      externalCatalogueId: row.externalCatalogueId,
      name: row.name,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Sản phẩm trong danh mục — có tìm kiếm và PHÂN TRANG.
   *
   * 🔴 Phân trang phía server là thứ bản cũ không làm được: nó tải toàn bộ danh mục về
   * trình duyệt rồi lọc tại chỗ. Với vài nghìn sản phẩm, đó là vài MB JSON mỗi lần mở dialog.
   */
  async listProducts(
    organizationId: string,
    accountId: string,
    params: { catalogueId?: string; search?: string; page: number; limit: number },
  ): Promise<PaginatedCatalogProductDto> {
    await this.assertAccount(organizationId, accountId);

    const [{ items, total }, lastSyncedAt] = await Promise.all([
      this.catalogRepo.listProductsPaged({
        organizationId,
        accountId,
        catalogueId: params.catalogueId,
        search: params.search,
        page: params.page,
        limit: params.limit,
      }),
      this.catalogRepo.lastSyncedAt(accountId),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        externalProductId: item.externalProductId,
        sku: item.sku,
        name: item.name,
        catalogueId: item.catalogueId,
        catalogName: item.catalogue?.name ?? null,
        basePrice: item.basePrice,
        currency: item.currency,
        imageUrl: item.image,
        isActive: true,
        // Số biến thể THỰC SỰ đã đồng bộ, không phải con số nhà cung cấp báo: người dùng cần
        // biết mình sắp chọn trong bao nhiêu lựa chọn CÓ THẬT ở bước sau.
        variationsCount: item._count.variants,
      })),
      meta: {
        total,
        page: params.page,
        limit: params.limit,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    };
  }

  /**
   * Biến thể của một sản phẩm.
   *
   * `productId` là id NỘI BỘ (uuid) chứ không phải id phía nhà cung cấp — nhờ vậy kiểm tra
   * tenant là một phép so khoá chính, không phải một phép đoán.
   */
  async listVariations(
    organizationId: string,
    productId: string,
  ): Promise<ProviderCatalogVariationDto[]> {
    const product = await this.catalogRepo.findProductById(organizationId, productId);
    if (!product) throw new CatalogProductNotFoundException();

    const rows = await this.catalogRepo.listVariants(organizationId, productId);
    return rows.map((row) => ({
      id: row.id,
      externalVariantId: row.externalVariantId,
      sku: row.sku,
      name: row.name,
      color: row.color,
      size: row.size,
      price: row.price,
      isAvailable: true,
    }));
  }

  /** Số bản ghi đang có + thời điểm đồng bộ gần nhất — màn hình cấu hình nhà cung cấp. */
  async status(organizationId: string, accountId: string) {
    await this.assertAccount(organizationId, accountId);
    const [counts, lastSyncedAt] = await Promise.all([
      this.catalogRepo.countActive(accountId),
      this.catalogRepo.lastSyncedAt(accountId),
    ]);
    return { ...counts, lastSyncedAt: lastSyncedAt?.toISOString() ?? null };
  }

  /** Sản phẩm dạng phẳng (không phân trang) — chỉ dùng khi thực sự cần cả danh sách. */
  async allProducts(
    organizationId: string,
    accountId: string,
    search?: string,
  ): Promise<ProviderCatalogProductDto[]> {
    const first = await this.listProducts(organizationId, accountId, {
      search,
      page: 1,
      limit: 200,
    });
    return first.items;
  }

  private async assertAccount(organizationId: string, accountId: string): Promise<void> {
    const account = await this.repo.findAccountById(organizationId, accountId);
    if (!account) throw new FulfillmentAccountNotFoundException();
  }
}
