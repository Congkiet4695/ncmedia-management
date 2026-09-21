import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PodProductSyncTrigger } from '@prisma/client';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import type { PodProductDetailDto } from '../dto/pod-product-response.dto';
import { PodProductResponseMapper } from '../mappers/pod-product-response.mapper';
import { PodProductRepository } from '../repositories/pod-product.repository';
import {
  PodProductSyncRepository,
  type ProductSyncTarget,
} from '../repositories/pod-product-sync.repository';
import { PodProductCatalogService } from './pod-product-catalog.service';
import { PodProductSyncService } from './pod-product-sync.service';

/** Khoá theo sản phẩm — đủ cho một lượt gọi TikTok + đồng bộ lại. Cùng con số với Edit. */
const LIFECYCLE_LOCK_MS = 60_000;

/** Kết quả xoá — `id` để màn hình gỡ đúng dòng khỏi bảng. */
export interface PodProductDeleteResultDto {
  id: string;
  tiktokProductId: string;
  /** Đã gọi Delete Products trên TikTok và sàn chấp nhận. */
  deletedOnTiktok: boolean;
}

export class PodProductLifecycleNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_PRODUCT_NOT_FOUND', message: 'Không tìm thấy sản phẩm' });
  }
}

/** Đang có một thao tác khác (sửa / ngừng bán / xoá) chạy trên đúng sản phẩm này. */
export class PodProductLifecycleBusyException extends ConflictException {
  constructor() {
    super({
      code: 'POD_PRODUCT_BUSY',
      message: 'Sản phẩm này đang được xử lý ở một yêu cầu khác. Chờ xong rồi thử lại.',
    });
  }
}

/** Kết nối TikTok của shop sở hữu sản phẩm không dùng được. */
export class PodProductShopUnavailableException extends BadRequestException {
  constructor() {
    super({
      code: 'POD_PRODUCT_SHOP_UNAVAILABLE',
      message:
        'Kết nối TikTok của shop này không dùng được (chưa uỷ quyền, đã tắt đồng bộ, hoặc token hỏng).',
    });
  }
}

/** TikTok từ chối — giữ NGUYÊN VĂN thông điệp để người vận hành sửa được. */
export class PodProductLifecycleRejectedException extends BadRequestException {
  constructor(action: 'DEACTIVATE' | 'DELETE', message: string, code: string | null) {
    super({
      code: action === 'DEACTIVATE' ? 'POD_PRODUCT_DEACTIVATE_REJECTED' : 'POD_PRODUCT_DELETE_REJECTED',
      message: `TikTok từ chối ${action === 'DEACTIVATE' ? 'ngừng bán' : 'xoá'} sản phẩm: ${message}`,
      tiktokCode: code,
    });
  }
}

/**
 * PodProductLifecycleService — **ngừng bán** và **xoá** sản phẩm đang có trên shop thật.
 *
 * ```
 *   Deactivate:  kiểm scope → Deactivate Products (TikTok) → đồng bộ lại 1 sản phẩm → deactivated_at
 *   Delete:      kiểm scope → Delete Products (TikTok)     → xoá mềm bản ghi (deleted_at)
 * ```
 *
 * 🔴 **Sàn trước, database sau** — cùng nguyên tắc với `PodProductEditService`: TikTok từ chối
 * thì database KHÔNG đổi gì. Ghi trước rồi sàn từ chối là màn hình hiện "đã ngừng bán" trong
 * khi hàng vẫn đang bán trên shop.
 *
 * 🔴 **Hai việc khác nhau, hai quyền khác nhau.** Deactivate đảo ngược được (Activate trên
 * Seller Center), Delete thì TikTok giữ 30 ngày rồi mất hẳn. Không gộp vào một endpoint có cờ.
 *
 * 🔴 Phạm vi tính theo **shop của chính bản ghi**, không theo bất kỳ `shopId` nào client gửi.
 * Seller chỉ ngừng bán / xoá được hàng của shop Admin đã gán.
 *
 * 🔴 Xoá là XOÁ MỀM — `pod_product_mappings`, Draft Listing, Listing Job Item và đơn hàng cũ
 * còn trỏ vào bản ghi (xem `PodProductRepository.softDelete`).
 */
@Injectable()
export class PodProductLifecycleService {
  private readonly logger = new Logger(PodProductLifecycleService.name);

  constructor(
    private readonly repo: PodProductRepository,
    private readonly syncRepo: PodProductSyncRepository,
    private readonly syncService: PodProductSyncService,
    private readonly catalog: PodProductCatalogService,
    private readonly productApi: TiktokProductApiService,
    private readonly accessScope: PodAccessScopeService,
    private readonly lock: DistributedLockService,
    private readonly mapper: PodProductResponseMapper,
  ) {}

  /** Ngừng bán trên TikTok rồi đồng bộ lại — trả về sản phẩm đúng như sàn đang có. */
  async deactivate(
    organizationId: string,
    userId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodProductDetailDto> {
    const { product, target, ctx } = await this.prepare(organizationId, id, scope);

    const result = await this.lock.withLock(
      this.lockKey(id),
      LIFECYCLE_LOCK_MS,
      async () => {
        await this.callTiktok('DEACTIVATE', organizationId, product, () =>
          this.productApi.deactivateProducts(ctx, [product.tiktokProductId]),
        );

        // Sàn đã nhận ⇒ đọc lại chính sản phẩm đó để `status` là chuỗi TikTok trả về
        // (`SELLER_DEACTIVATED`), không phải giá trị ta đoán. Đồng bộ đơn lẻ có thể hỏng vì
        // lý do tạm thời — không vì thế mà mất dấu ngừng bán: `markDeactivated` chạy sau
        // cùng, bất kể lượt đồng bộ ra sao.
        try {
          await this.syncService.syncShop(target, {
            trigger: PodProductSyncTrigger.MANUAL,
            triggeredBy: userId,
            tiktokProductId: product.tiktokProductId,
          });
        } catch (error) {
          this.logger.warn({
            module: 'pod-product',
            operation: 'product.deactivate.resync.fail',
            organizationId,
            productId: id,
            msg: error instanceof Error ? error.message : String(error),
          });
        }
        await this.repo.markDeactivated(organizationId, id, userId);
        return true;
      },
    );
    if (result === null) throw new PodProductLifecycleBusyException();

    const fresh = await this.repo.findById(organizationId, id);
    if (!fresh) throw new PodProductLifecycleNotFoundException();
    return this.mapper.toDetail(fresh);
  }

  /** Xoá trên TikTok rồi xoá mềm bản ghi. */
  async remove(
    organizationId: string,
    userId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodProductDeleteResultDto> {
    const { product, ctx } = await this.prepare(organizationId, id, scope);

    const result = await this.lock.withLock(
      this.lockKey(id),
      LIFECYCLE_LOCK_MS,
      async () => {
        await this.callTiktok('DELETE', organizationId, product, () =>
          this.productApi.deleteProducts(ctx, [product.tiktokProductId]),
        );
        await this.repo.softDelete(organizationId, id, userId);
        return true;
      },
    );
    if (result === null) throw new PodProductLifecycleBusyException();

    return { id, tiktokProductId: product.tiktokProductId, deletedOnTiktok: true };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Nạp sản phẩm, kiểm phạm vi theo shop CỦA BẢN GHI, dựng ngữ cảnh gọi TikTok. */
  private async prepare(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<{
    product: { id: string; shopId: string; tiktokProductId: string };
    target: ProductSyncTarget;
    ctx: TiktokShopContext;
  }> {
    const product = await this.repo.findById(organizationId, id);
    if (!product) throw new PodProductLifecycleNotFoundException();
    this.accessScope.assertShopAllowed(scope, product.shopId);

    const [target] = await this.syncRepo.findSyncTargets({ organizationId, shopId: product.shopId });
    if (!target) throw new PodProductShopUnavailableException();

    let ctx: TiktokShopContext;
    try {
      ctx = await this.catalog.buildContext(target);
    } catch {
      throw new PodProductShopUnavailableException();
    }

    return {
      product: { id: product.id, shopId: product.shopId, tiktokProductId: product.tiktokProductId },
      target,
      ctx,
    };
  }

  /**
   * Gọi TikTok và diễn giải kết quả.
   *
   * 🔴 Hai kiểu từ chối: (1) lỗi HTTP/code ≠ 0 — SDK ném `TiktokClientError`; (2) code 0 nhưng
   * `errors[]` có phần tử — TikTok trả lỗi THEO TỪNG sản phẩm (vd sản phẩm đang trong đợt
   * khuyến mãi không được xoá). Cả hai đều là "sàn không nhận" ⇒ không ghi database.
   */
  private async callTiktok(
    action: 'DEACTIVATE' | 'DELETE',
    organizationId: string,
    product: { id: string; tiktokProductId: string },
    invoke: () => Promise<{ data: { errors?: Array<{ code?: number; message?: string }> } }>,
  ): Promise<void> {
    this.logger.log({
      module: 'pod-product',
      operation: `product.${action.toLowerCase()}.send`,
      organizationId,
      productId: product.id,
      tiktokProductId: product.tiktokProductId,
      msg: action === 'DEACTIVATE' ? 'Gửi Deactivate Products' : 'Gửi Delete Products',
    });

    let errors: Array<{ code?: number; message?: string }>;
    try {
      const { data } = await invoke();
      errors = data?.errors ?? [];
    } catch (error) {
      const detail = this.describe(error);
      this.logger.error({
        module: 'pod-product',
        operation: `product.${action.toLowerCase()}.fail`,
        organizationId,
        productId: product.id,
        tiktokProductId: product.tiktokProductId,
        tiktokCode: detail.code,
        msg: detail.message,
      });
      throw new PodProductLifecycleRejectedException(action, detail.message, detail.code);
    }

    if (errors.length > 0) {
      const first = errors[0];
      const message = errors
        .map((item) => item.message)
        .filter((message): message is string => Boolean(message))
        .join(' · ');
      this.logger.error({
        module: 'pod-product',
        operation: `product.${action.toLowerCase()}.rejected`,
        organizationId,
        productId: product.id,
        tiktokProductId: product.tiktokProductId,
        tiktokCode: first.code ?? null,
        msg: message,
      });
      throw new PodProductLifecycleRejectedException(
        action,
        message || 'Lỗi không xác định',
        first.code != null ? String(first.code) : null,
      );
    }
  }

  private lockKey(productId: string): string {
    // Cùng khoá với Edit Product — ba thao tác ghi lên sàn cho một sản phẩm không được
    // chạy chồng lên nhau.
    return `pod:product-edit:${productId}`;
  }

  private describe(error: unknown): { message: string; code: string | null } {
    const candidate = error as { tiktokMessage?: string; tiktokCode?: number; message?: string };
    return {
      message: candidate?.tiktokMessage ?? candidate?.message ?? 'Lỗi không xác định',
      code: candidate?.tiktokCode != null ? String(candidate.tiktokCode) : null,
    };
  }
}
