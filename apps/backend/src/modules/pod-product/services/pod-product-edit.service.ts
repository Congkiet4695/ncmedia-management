import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PodProductSyncTrigger } from '@prisma/client';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodAccessScopeService, type PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { PodProductDetailDto } from '../dto/pod-product-response.dto';
import type { UpdatePodProductDto } from '../dto/pod-product-update.dto';
import { PodProductCatalogService } from './pod-product-catalog.service';
import { PodProductSyncService } from './pod-product-sync.service';
import { buildPartialEditPayload, type ProductEditInput, type ProductSnapshot } from './pod-product-edit.payload';
import { PodProductMediaService } from './pod-product-media.service';
import {
  PodDescriptionImageException,
  PodDescriptionImageService,
  knownDescriptionImageUrls,
} from './pod-description-image.service';
import { PodProductResponseMapper } from '../mappers/pod-product-response.mapper';
import { PodProductRepository } from '../repositories/pod-product.repository';
import { PodProductSyncRepository } from '../repositories/pod-product-sync.repository';

/** Khoá chống bấm Lưu hai lần. Đủ dài cho một lượt gọi TikTok + đồng bộ lại. */
const EDIT_LOCK_MS = 60_000;

/** Không có gì thay đổi — chặn TRƯỚC khi gọi TikTok. */
export class PodProductNoChangeException extends BadRequestException {
  constructor() {
    super({
      code: 'POD_PRODUCT_NO_CHANGE',
      message: 'Không có thay đổi nào để lưu.',
    });
  }
}

/** Đang có một lượt sửa khác chạy trên đúng sản phẩm này. */
export class PodProductEditBusyException extends ConflictException {
  constructor() {
    super({
      code: 'POD_PRODUCT_EDIT_BUSY',
      message: 'Sản phẩm này đang được lưu ở một yêu cầu khác. Chờ xong rồi thử lại.',
    });
  }
}

/** TikTok từ chối thay đổi — giữ NGUYÊN VĂN để người vận hành sửa được. */
export class PodProductEditRejectedException extends BadRequestException {
  constructor(message: string, code: string | null) {
    super({
      code: 'POD_PRODUCT_EDIT_REJECTED',
      message: `TikTok từ chối thay đổi: ${message}`,
      tiktokCode: code,
    });
  }
}

/**
 * PodProductEditService — sửa sản phẩm **đang bán trên shop thật**.
 *
 * ```
 *   form  →  diff với ảnh chụp hiện tại  →  Partial Edit Product (chỉ trường đã đổi)
 *                                              ↓ thành công
 *                                        ĐỒNG BỘ LẠI sản phẩm từ TikTok
 *                                              ↓
 *                                        database = đúng thứ sàn đang có
 * ```
 *
 * 🔴 **Không ghi database trước khi TikTok xác nhận.** Yêu cầu §13 nói rõ, và lý do rất thực
 * tế: ghi trước rồi TikTok từ chối thì màn hình hiện một sản phẩm mà trên sàn không tồn tại.
 * Ở đây thứ tự là gọi sàn → sàn OK → **đồng bộ lại từ sàn**. Đồng bộ lại thay vì tự ghi giá
 * trị mình vừa gửi: TikTok có thể chuẩn hoá (làm tròn giá, cắt tiêu đề), và nguồn sự thật
 * phải là sàn chứ không phải thứ ta hy vọng đã gửi thành công.
 *
 * 🔴 **Partial Edit, không phải PUT.** `publishProduct` (PUT) thay TOÀN BỘ sản phẩm — sửa mỗi
 * tiêu đề bằng nó là xoá sạch mô tả, ảnh và bảng giá của một sản phẩm đang bán.
 */
@Injectable()
export class PodProductEditService {
  private readonly logger = new Logger(PodProductEditService.name);

  constructor(
    private readonly repo: PodProductRepository,
    private readonly syncRepo: PodProductSyncRepository,
    private readonly syncService: PodProductSyncService,
    private readonly catalog: PodProductCatalogService,
    private readonly productApi: TiktokProductApiService,
    private readonly media: PodProductMediaService,
    private readonly descriptionImages: PodDescriptionImageService,
    private readonly accessScope: PodAccessScopeService,
    private readonly lock: DistributedLockService,
    private readonly mapper: PodProductResponseMapper,
  ) {}

  async update(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdatePodProductDto,
    scope: PodAccessScope,
  ): Promise<PodProductDetailDto> {
    const product = await this.repo.findById(organizationId, id);
    if (!product) {
      throw new BadRequestException({
        code: 'POD_PRODUCT_NOT_FOUND',
        message: 'Không tìm thấy sản phẩm',
      });
    }

    // 🔴 Phạm vi tính theo SHOP CỦA CHÍNH SẢN PHẨM, không theo shop người dùng gửi lên.
    // Tin `shopId` từ client là để Seller sửa hàng của shop người khác.
    this.accessScope.assertShopAllowed(scope, product.shopId);

    /**
     * 🔴 Ảnh/video phải lên TikTok TRƯỚC, vì `partial_edit` chỉ nhận `uri` / `id` của sàn.
     *
     * Bước này cần token nên phải giải quyết shop trước cả phép diff. Đổi lại, một tấm ảnh
     * hỏng sẽ dừng cả lượt lưu ở đây — lúc sản phẩm trên sàn còn nguyên vẹn.
     */
    const target = await this.resolveShopTarget(organizationId, product.shopId);
    const ctx = await this.catalog.buildContext(target);
    const resolved = await this.resolveMedia(organizationId, ctx, dto, product.description);

    const plan = buildPartialEditPayload(resolved, this.toSnapshot(product));
    // Không có gì đổi thì KHÔNG gọi TikTok — mỗi request thừa là một lần tiêu hạn mức và
    // một cơ hội để sàn từ chối vì lý do không liên quan.
    if (plan.isEmpty) throw new PodProductNoChangeException();

    /**
     * 🔴 Khoá theo SẢN PHẨM, ở tầng server.
     *
     * Disable nút ở trình duyệt không phải chống trùng: hai tab, hai lần bấm nhanh, hay một
     * lần thử lại của mạng đều tạo hai request thật. Hai lượt Partial Edit chạy song song
     * trên cùng sản phẩm thì thứ tự ghi trên sàn là ngẫu nhiên.
     */
    const result = await this.lock.withLock(`pod:product-edit:${id}`, EDIT_LOCK_MS, async () => {
      this.logger.log({
        module: 'pod-product',
        operation: 'product.edit.send',
        organizationId,
        productId: id,
        shopId: product.shopId,
        tiktokProductId: product.tiktokProductId,
        changedFields: plan.changedFields,
        changedSkus: plan.changedSkus,
        msg: 'Gửi Partial Edit Product',
      });

      try {
        await this.productApi.partialEditProduct(ctx, product.tiktokProductId, plan.body);
      } catch (error) {
        const detail = this.describe(error);
        this.logger.error({
          module: 'pod-product',
          operation: 'product.edit.fail',
          organizationId,
          productId: id,
          tiktokProductId: product.tiktokProductId,
          tiktokCode: detail.code,
          msg: detail.message,
        });
        // 🔴 KHÔNG đụng vào database: sàn từ chối nghĩa là sản phẩm vẫn như cũ.
        throw new PodProductEditRejectedException(detail.message, detail.code);
      }

      // Sàn đã nhận ⇒ kéo lại chính sản phẩm đó để database phản ánh đúng thứ sàn đang có.
      await this.syncService.syncShop(target, {
        trigger: PodProductSyncTrigger.MANUAL,
        triggeredBy: userId,
        tiktokProductId: product.tiktokProductId,
      });

      return true;
    });

    if (result === null) throw new PodProductEditBusyException();

    // Đọc LẠI sau khi đồng bộ — trả về đúng thứ sàn đang có, không phải thứ vừa gửi đi.
    const fresh = await this.repo.findById(organizationId, id);
    if (!fresh) {
      throw new BadRequestException({
        code: 'POD_PRODUCT_NOT_FOUND',
        message: 'Không tìm thấy sản phẩm',
      });
    }
    return this.mapper.toDetail(fresh);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Ảnh chụp hiện tại để so — đọc từ dữ liệu ĐÃ ĐỒNG BỘ, không phải từ request. */
  private toSnapshot(product: Awaited<ReturnType<PodProductRepository['findById']>>): ProductSnapshot {
    if (!product) throw new PodProductNoChangeException();
    return {
      title: product.title,
      description: product.description,
      tiktokBrandId: product.tiktokBrandId,
      packageWeight: product.packageWeight,
      weightUnit: product.weightUnit,
      packageLength: product.packageLength,
      packageWidth: product.packageWidth,
      packageHeight: product.packageHeight,
      dimensionUnit: product.dimensionUnit,
      searchTerms: toStringList(product.searchTerms),
      keyProductFeatures: toStringList(product.keyProductFeatures),
      // 🔴 Chỉ ảnh SẢN PHẨM (`variantId === null`); ảnh của biến thể là `sales_attributes`,
      // trộn vào `main_images` là đăng ảnh biến thể thành ảnh gian hàng.
      mainImageUris: product.images
        .filter((image) => image.variantId === null && image.uri)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((image) => image.uri as string),
      sizeChartUri: product.sizeChartUri,
      sizeChartTemplateId: product.sizeChartTemplateId,
      videoId: product.videos[0]?.tiktokVideoId ?? null,
      variants: product.variants.map((variant) => ({
        tiktokSkuId: variant.tiktokSkuId,
        sellerSku: variant.sellerSku,
        salePrice: variant.salePrice?.toString() ?? null,
        listPrice: variant.listPrice?.toString() ?? null,
        inventoryTotal: variant.inventoryTotal,
        currency: variant.currency,
      })),
    };
  }

  /**
   * Quy mọi thứ người dùng gửi lên về dạng TikTok hiểu: ảnh → `uri`, video → `id`.
   *
   * 🔴 Chỉ đụng tới phần người dùng CÓ gửi. Không gửi `mainImages` thì không upload gì và
   * cũng không sinh ra mảng ảnh rỗng — mảng rỗng đi tới `buildPartialEditPayload` sẽ bị hiểu
   * là "bộ ảnh mới", tức xoá sạch ảnh của một sản phẩm đang bán.
   */
  private async resolveMedia(
    organizationId: string,
    ctx: Awaited<ReturnType<PodProductCatalogService['buildContext']>>,
    dto: UpdatePodProductDto,
    /** Mô tả ĐANG có trên sàn — ảnh trong đó là ảnh TikTok hợp lệ, giữ nguyên. */
    currentDescription: string | null,
  ): Promise<ProductEditInput> {
    const input: ProductEditInput = { ...dto, mainImageUris: undefined, sizeChart: undefined };

    /**
     * 🔴 Ảnh trong MÔ TẢ: TikTok chỉ nhận URL do Upload Product Image (`DESCRIPTION_IMAGE`) trả
     * về (`12052340`). Ảnh người dùng vừa chèn nằm ở Storage của ta ⇒ upload + đổi src TRƯỚC khi
     * diff. Ảnh đã có trên mô tả hiện tại của sản phẩm (do TikTok trả về lúc đồng bộ) giữ nguyên
     * — không upload lại thứ sàn đã có. KHÔNG dùng MAIN_IMAGE cho ảnh mô tả.
     */
    if (dto.description !== undefined) {
      try {
        const { html } = await this.descriptionImages.normalize(organizationId, ctx, dto.description, {
          knownTiktokUrls: knownDescriptionImageUrls(currentDescription),
          label: 'mô tả',
        });
        input.description = html;
      } catch (error) {
        if (error instanceof PodDescriptionImageException) {
          throw new BadRequestException({
            code: 'POD_PRODUCT_DESCRIPTION_IMAGE_FAILED',
            message: error.message,
            problems: error.problems,
          });
        }
        throw error;
      }
    }

    if (dto.mainImages !== undefined) {
      input.mainImageUris = await this.media.resolveImages(organizationId, ctx, dto.mainImages);
    }

    if (dto.sizeChart) {
      input.sizeChart = dto.sizeChart.templateId
        ? { templateId: dto.sizeChart.templateId }
        : { uri: await this.media.resolveSizeChart(organizationId, ctx, dto.sizeChart) };
    }

    if (dto.video?.fileId) {
      input.videoId = await this.media.resolveVideo(organizationId, ctx, dto.video.fileId);
    }

    return input;
  }

  /** Shop nguồn để mượn token — đúng shop SỞ HỮU sản phẩm. */
  private async resolveShopTarget(organizationId: string, shopId: string) {
    const [target] = await this.syncRepo.findSyncTargets({ organizationId, shopId });
    if (!target) {
      throw new BadRequestException({
        code: 'POD_PRODUCT_SHOP_UNAVAILABLE',
        message:
          'Kết nối TikTok của shop này không dùng được (chưa uỷ quyền, đã tắt đồng bộ, hoặc token hỏng).',
      });
    }
    return target;
  }

  /** Bóc thông điệp lỗi TikTok, giữ nguyên văn để người vận hành còn sửa được. */
  private describe(error: unknown): { message: string; code: string | null } {
    const candidate = error as { tiktokMessage?: string; tiktokCode?: number; message?: string };
    return {
      message: candidate?.tiktokMessage ?? candidate?.message ?? 'Lỗi không xác định',
      code: candidate?.tiktokCode != null ? String(candidate.tiktokCode) : null,
    };
  }
}

/** Cột JSON đọc ra phải kiểm kiểu — dữ liệu cũ có thể là bất cứ thứ gì. */
function toStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}
