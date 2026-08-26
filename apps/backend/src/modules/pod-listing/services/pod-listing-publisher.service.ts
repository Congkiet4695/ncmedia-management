import { Injectable } from '@nestjs/common';
import { PodListingLogLevel, PodListingStep } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { StorageService } from '../../storage/storage.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import {
  TIKTOK_IMAGE_USE_CASE,
  TIKTOK_PRODUCT_SAVE_MODE,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import type {
  TiktokCreateProductRequest,
  TiktokCreateProductSku,
} from '../../tiktok-sdk/types/tiktok-product.types';
import {
  POD_IMAGE_FETCH_MAX_BYTES,
  POD_IMAGE_FETCH_TIMEOUT_MS,
  POD_LISTING_MAX_IMAGES,
  POD_PRIVATE_HOST_PATTERN,
} from '../constants/pod-listing.constants';
import type { ResolvedListing } from './pod-listing-resolver.service';

/** Ghi một dòng nhật ký cho item đang chạy. */
export type ListingLogger = (
  level: PodListingLogLevel,
  step: PodListingStep,
  message: string,
  payload?: Record<string, unknown>,
) => Promise<void>;

/** Kết quả đẩy MỘT listing lên TikTok. */
export interface PublishOutcome {
  remoteProductId: string;
  /** `sku_id` do TikTok cấp, khớp theo `seller_sku` để ghi ngược vào draft item. */
  skuIds: Array<{ sellerSku: string; tiktokSkuId: string }>;
  /** Cảnh báo TikTok trả kèm (sản phẩm vẫn được tạo). */
  warnings: string[];
  imagesUploaded: number;
  imagesReused: number;
}

/**
 * Kết quả PUBLISH một listing — khác `PublishOutcome` ở ba thứ mà Publish History cần:
 * đã đi đường nào, đã gửi gì, TikTok trả gì.
 */
export interface PublishListingOutcome extends PublishOutcome {
  /**
   * `EDIT` — sửa Draft đã có (`save_mode = LISTING`). `CREATE` — listing chưa từng lên sàn
   * nên tạo thẳng ở chế độ đăng bán. 🔴 Không bao giờ có đường thứ ba, và `EDIT` không tạo
   * bản ghi mới trên shop.
   */
  mode: 'EDIT' | 'CREATE';
  /** Thân request đã gửi — lưu vào `pod_listing_payloads.publish_request`. */
  request: TiktokCreateProductRequest;
  /** Response TikTok trả về — lưu vào `pod_listing_payloads.publish_response`. */
  response: Record<string, unknown>;
  /** `audit.status` ngay sau khi publish (nếu TikTok trả kèm). */
  auditStatus: string | null;
  /** `request_id` của TikTok — thứ đầu tiên TikTok Support hỏi khi có sự cố. */
  tiktokRequestId: string | null;
}

/**
 * Listing được yêu cầu publish nhưng KHÔNG còn dữ liệu để gửi (payload rỗng/hỏng).
 *
 * Là lỗi dữ liệu, không phải lỗi tạm thời ⇒ hàng đợi đánh dấu hỏng vĩnh viễn thay vì thử lại
 * ba lần với cùng một payload rỗng.
 */
export class PodPublishPayloadException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PodPublishPayloadException';
  }
}

/** Không lấy được token/shop_cipher của shop — item hỏng trước khi chạm TikTok. */
export class PodShopContextException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PodShopContextException';
  }
}

/**
 * Không xác định được kho để đăng lên MỘT shop cụ thể.
 *
 * 🔴 Đây là lỗi CẤU HÌNH, không phải lỗi tạm thời: thử lại 3 lần vẫn thiếu kho y hệt. Ném
 * riêng một lớp để hàng đợi đánh dấu là lỗi vĩnh viễn và **chỉ item của shop đó** hỏng —
 * các shop khác trong cùng lượt chạy vẫn đăng bình thường.
 */
export class PodWarehouseResolutionException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PodWarehouseResolutionException';
  }
}

/**
 * PodListingPublisherService — **nơi duy nhất** đưa một listing lên TikTok.
 *
 * Hai pipeline, dùng chung mọi bước chuẩn bị:
 * ```
 *   publishDraft()    ResolvedListing → Upload Image → Create Product (AS_DRAFT) → draft id
 *   publishListing()  ResolvedListing → Upload Image → Edit Product  (LISTING)  → chờ duyệt
 * ```
 *
 * 🔴 Ranh giới giữa hai việc nằm đúng ở `save_mode`, và không có đường nào khác đặt giá trị
 * đó: `createProduct()` mặc định `AS_DRAFT`, `publishProduct()` luôn ép `LISTING`.
 *
 * 🔴 `publishListing()` KHÔNG tạo sản phẩm mới khi Draft đã có trên sàn — xem chú thích của
 * chính hàm đó. Đây là điểm khiến "publish 500 draft" không biến thành "500 sản phẩm trùng".
 *
 * 🔴 Ảnh mockup được upload MỘT lần cho cả hệ thống: `uri` TikTok trả về được ghi vào
 * `pod_image_template_items.tiktok_image_uri`, nên listing thứ hai trở đi dùng lại. Một bộ 5
 * mockup × 1.000 sản phẩm là 5 lần upload, không phải 5.000 — đây là điểm khiến bulk listing
 * chạy được trong thực tế.
 */
@Injectable()
export class PodListingPublisherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productApi: TiktokProductApiService,
    private readonly storage: StorageService,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
  ) {}

  /**
   * Lấy ngữ cảnh gọi API của một shop (access token + `shop_cipher` đã giải mã).
   *
   * Gọi một lần cho mỗi shop trong một lượt job rồi dùng lại: refresh token 500 lần cho 500
   * sản phẩm cùng shop là tự tạo ra một cơn bão request không cần thiết.
   */
  async shopContext(organizationId: string, shopId: string): Promise<TiktokShopContext> {
    const shop = await this.prisma.podTiktokShop.findFirst({
      where: { id: shopId, organizationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        shopCipherEnc: true,
        account: {
          select: {
            id: true,
            organizationId: true,
            accountName: true,
            accessTokenEnc: true,
            accessTokenExpiresAt: true,
            refreshTokenEnc: true,
            refreshTokenExpiresAt: true,
          },
        },
      },
    });
    if (!shop) throw new PodShopContextException('Shop không tồn tại trong tổ chức này');

    const token = await this.tokenService.ensureValidAccessToken(shop.account);
    if (!token.ok) {
      throw new PodShopContextException(
        `Không lấy được access token của shop (${token.reason}): ${token.message}`,
      );
    }

    return {
      accessToken: token.accessToken,
      shopCipher: this.encryption.decrypt(shop.shopCipherEnc),
      shopId: shop.id,
      organizationId: shop.organizationId,
    };
  }

  /**
   * Upload ảnh (nếu cần) rồi tạo Draft Product.
   *
   * 🔴 `imageUriCache` sống theo LƯỢT JOB và chứa **Promise**, không phải chuỗi. Với hàng đợi
   * 5 luồng, năm sản phẩm dùng chung một bộ ảnh khởi động gần như cùng lúc: nếu cache chỉ ghi
   * kết quả thì cả năm đều thấy cache rỗng và cùng upload một tấm ảnh — 5 lần thay vì 1.
   * Ghi promise vào cache ngay khi BẮT ĐẦU upload thì bốn luồng còn lại chờ đúng promise đó.
   */
  async publishDraft(params: {
    organizationId: string;
    ctx: TiktokShopContext;
    payload: ResolvedListing;
    payloadHash: string;
    imageUriCache: Map<string, Promise<string>>;
    log: ListingLogger;
  }): Promise<PublishOutcome> {
    const { payload, ctx, log, imageUriCache } = params;

    const images = await this.ensureImageUris(
      params.organizationId,
      ctx,
      payload,
      imageUriCache,
      log,
    );
    // 🔴 Kho được quyết Ở ĐÂY — theo shop đang đăng, không phải theo Draft Product.
    const warehouse = await this.resolveWarehouse(params.organizationId, ctx, payload, log);
    const request = this.buildCreateRequest(
      payload,
      params.payloadHash,
      images.uris,
      images.variantUris,
      warehouse.tiktokWarehouseId,
    );

    await log(
      PodListingLogLevel.INFO,
      PodListingStep.CREATE_DRAFT,
      'Gửi Create Product (AS_DRAFT)',
      {
        categoryId: request.categoryId,
        brandId: request.brandId,
        warehouseId: warehouse.tiktokWarehouseId,
        warehouseSource: warehouse.source,
        skus: request.skus?.length ?? 0,
        images: request.mainImages?.length ?? 0,
      },
    );

    const { data, requestId } = await this.productApi.createProduct(ctx, request);
    const remoteProductId = data.productId;
    if (!remoteProductId) {
      // TikTok trả code 0 nhưng không kèm product_id: coi là thất bại thay vì ghi một item
      // "thành công" mà không tra lại được trên Seller Center.
      throw new Error('TikTok không trả về product_id cho Draft Product vừa tạo');
    }

    const warnings = (data.warnings ?? [])
      .map((warning) => warning.message)
      .filter((message): message is string => Boolean(message));

    await log(PodListingLogLevel.INFO, PodListingStep.SAVE_REMOTE_ID, 'Đã tạo Draft Product', {
      remoteProductId,
      tiktokRequestId: requestId,
      warnings,
    });

    return {
      remoteProductId,
      skuIds: (data.skus ?? [])
        .filter((sku) => sku.id && sku.sellerSku)
        .map((sku) => ({ sellerSku: sku.sellerSku as string, tiktokSkuId: sku.id as string })),
      warnings,
      imagesUploaded: images.uploaded,
      imagesReused: images.reused,
    };
  }

  /**
   * **PUBLISH** — đưa một listing vào hàng chờ duyệt của TikTok.
   *
   * ```
   *   có tiktokDraftId  →  Edit Product (save_mode = LISTING)   ← KHÔNG tạo bản ghi mới
   *   chưa có           →  Create Product (save_mode = LISTING) ← tạo đúng MỘT lần
   * ```
   *
   * 🔴 Đây là hàng rào chống trùng sản phẩm của cả sprint. Draft đã tồn tại trên sàn thì
   * TUYỆT ĐỐI không gọi Create Product lần nữa — TikTok sẽ đẻ ra một sản phẩm thứ hai giống
   * hệt, và không có cách nào gộp lại. Nhánh `CREATE` chỉ dành cho listing CHƯA từng chạm
   * sàn, và vẫn gửi kèm `idempotencyKey` (hash payload) để lần thử lại sau lỗi mạng nhận về
   * đúng sản phẩm cũ.
   *
   * 🔴 Edit Product là **full edit**: gửi thiếu trường nào là TikTok xoá trắng trường đó.
   * Vì thế request được dựng lại từ ĐÚNG payload đã tạo ra Draft (`buildCreateRequest`),
   * không phải một tập con "chỉ những gì thay đổi".
   *
   * Ảnh: đi qua đúng `ensureImageUris` của đường tạo Draft, nên `uri` đã lưu trong database
   * được dùng lại — publish 1.000 listing không upload lại tấm ảnh nào.
   */
  async publishListing(params: {
    organizationId: string;
    ctx: TiktokShopContext;
    payload: ResolvedListing;
    payloadHash: string;
    /** Id Draft trên TikTok. Có giá trị ⇒ đi nhánh Edit; `null` ⇒ tạo mới ở chế độ LISTING. */
    tiktokDraftId: string | null;
    imageUriCache: Map<string, Promise<string>>;
    log: ListingLogger;
  }): Promise<PublishListingOutcome> {
    const { payload, ctx, log, imageUriCache, tiktokDraftId } = params;

    if (payload.variants.length === 0) {
      throw new PodPublishPayloadException(
        'Payload của listing không còn biến thể nào — sinh lại Draft trước khi publish.',
      );
    }

    const images = await this.ensureImageUris(
      params.organizationId,
      ctx,
      payload,
      imageUriCache,
      log,
    );
    // Kho vẫn được quyết theo SHOP, y như lúc tạo Draft — yêu cầu sprint nói rõ: không
    // validate kho ở cổng trước, kho được resolve tại thời điểm publish.
    const warehouse = await this.resolveWarehouse(params.organizationId, ctx, payload, log);
    const request = this.buildCreateRequest(
      payload,
      params.payloadHash,
      images.uris,
      images.variantUris,
      warehouse.tiktokWarehouseId,
    );

    const mode: 'EDIT' | 'CREATE' = tiktokDraftId ? 'EDIT' : 'CREATE';

    await log(
      PodListingLogLevel.INFO,
      PodListingStep.PUBLISH,
      'Gửi Publish (save_mode = LISTING)',
      {
        mode,
        tiktokDraftId,
        warehouseId: warehouse.tiktokWarehouseId,
        warehouseSource: warehouse.source,
        skus: request.skus?.length ?? 0,
        images: request.mainImages?.length ?? 0,
      },
    );

    // `idempotencyKey` chỉ có nghĩa lúc TẠO (chống tạo trùng); Edit Product không nhận nó,
    // nên bỏ ra thay vì gửi kèm một trường TikTok không hiểu.
    const editRequest: TiktokCreateProductRequest = { ...request };
    delete editRequest.idempotencyKey;

    const { data, requestId } =
      mode === 'EDIT'
        ? await this.productApi.publishProduct(ctx, tiktokDraftId as string, editRequest)
        : await this.productApi.createProduct(ctx, {
            ...request,
            saveMode: TIKTOK_PRODUCT_SAVE_MODE.LISTING,
          });

    // Nhánh EDIT: TikTok trả lại chính id đã gửi. Nhận `undefined` thì dùng lại id cũ thay
    // vì coi là thất bại — sản phẩm ĐÃ được cập nhật, báo hỏng chỉ khiến người dùng bấm
    // Publish thêm lần nữa.
    const remoteProductId = data.productId ?? tiktokDraftId;
    if (!remoteProductId) {
      throw new Error('TikTok không trả về product_id sau khi publish');
    }
    if (tiktokDraftId && data.productId && data.productId !== tiktokDraftId) {
      // Không bao giờ nên xảy ra với Edit Product. Nếu xảy ra thì shop vừa có thêm một sản
      // phẩm trùng — phải hét lên ngay, đừng ghi đè im lặng.
      await log(
        PodListingLogLevel.ERROR,
        PodListingStep.PUBLISH,
        'TikTok trả về product_id KHÁC với Draft đã gửi — kiểm tra sản phẩm trùng trên shop',
        { sent: tiktokDraftId, received: data.productId },
      );
    }

    const warnings = (data.warnings ?? [])
      .map((warning) => warning.message)
      .filter((message): message is string => Boolean(message));

    const auditStatus =
      mode === 'EDIT' ? ((data as { audit?: { status?: string } }).audit?.status ?? null) : null;

    await log(PodListingLogLevel.INFO, PodListingStep.PUBLISH, 'TikTok đã nhận — chờ duyệt', {
      remoteProductId,
      mode,
      auditStatus,
      tiktokRequestId: requestId,
      warnings,
    });

    return {
      remoteProductId,
      mode,
      request,
      response: data as unknown as Record<string, unknown>,
      auditStatus,
      tiktokRequestId: requestId ?? null,
      skuIds: (data.skus ?? [])
        .filter((sku) => sku.id && sku.sellerSku)
        .map((sku) => ({ sellerSku: sku.sellerSku as string, tiktokSkuId: sku.id as string })),
      warnings,
      imagesUploaded: images.uploaded,
      imagesReused: images.reused,
    };
  }

  /**
   * Chọn kho để đăng lên **một shop cụ thể**.
   *
   * ```
   *   1. Kho của Category/Listing Template — CHỈ khi kho đó thuộc chính shop này
   *   2. Warehouse Mapping của shop (pod_tiktok_shops.default_warehouse_id)
   *   3. Shop chỉ có đúng MỘT kho  → dùng luôn
   *   4. Shop có nhiều kho         → kho TikTok đánh dấu mặc định (nếu duy nhất)
   *   5. Không xác định được       → chỉ item của shop này hỏng
   * ```
   *
   * 🔴 Bước 1 phải kiểm quyền sở hữu: `warehouse_id` là mã RIÊNG của từng shop. Gửi kho của
   * shop A sang shop B thì TikTok từ chối cả sản phẩm — mà thông điệp lỗi của họ không nói
   * ra điều đó, nên chặn tại đây là cách duy nhất để người vận hành hiểu chuyện gì xảy ra.
   */
  private async resolveWarehouse(
    organizationId: string,
    ctx: TiktokShopContext,
    payload: ResolvedListing,
    log: ListingLogger,
  ): Promise<{ tiktokWarehouseId: string; source: string }> {
    const shop = await this.prisma.podTiktokShop.findFirst({
      where: { id: ctx.shopId, organizationId, deletedAt: null },
      select: {
        name: true,
        defaultWarehouse: { select: { id: true, tiktokWarehouseId: true, name: true } },
        warehouses: {
          where: { deletedAt: null },
          select: { id: true, tiktokWarehouseId: true, name: true, isDefault: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!shop) throw new PodShopContextException('Shop đã bị xoá khỏi hệ thống');

    // 1. Kho của template — chỉ dùng khi chính shop này sở hữu.
    const fromTemplate = payload.warehouse.id
      ? shop.warehouses.find((warehouse) => warehouse.id === payload.warehouse.id)
      : undefined;
    if (fromTemplate) {
      return { tiktokWarehouseId: fromTemplate.tiktokWarehouseId, source: 'TEMPLATE' };
    }
    if (payload.warehouse.id) {
      await log(
        PodListingLogLevel.WARN,
        PodListingStep.MERGE,
        `Kho của template không thuộc shop "${shop.name}" — dùng cấu hình kho của shop`,
        { templateWarehouseId: payload.warehouse.tiktokWarehouseId },
      );
    }

    // 2. Warehouse Mapping của shop.
    if (shop.defaultWarehouse) {
      return {
        tiktokWarehouseId: shop.defaultWarehouse.tiktokWarehouseId,
        source: 'SHOP_MAPPING',
      };
    }

    // 3. Shop chỉ có đúng một kho.
    if (shop.warehouses.length === 1) {
      return { tiktokWarehouseId: shop.warehouses[0].tiktokWarehouseId, source: 'ONLY_WAREHOUSE' };
    }

    // 4. Kho TikTok đánh dấu mặc định — chỉ nhận khi DUY NHẤT một kho được đánh dấu.
    const defaults = shop.warehouses.filter((warehouse) => warehouse.isDefault);
    if (defaults.length === 1) {
      return { tiktokWarehouseId: defaults[0].tiktokWarehouseId, source: 'TIKTOK_DEFAULT' };
    }

    // 5. Bó tay — nói rõ phải làm gì, và chỉ shop này hỏng.
    throw new PodWarehouseResolutionException(
      shop.warehouses.length === 0
        ? `Shop "${shop.name}" chưa có kho nào trong hệ thống — đồng bộ kho ở màn hình Resources trước.`
        : `Shop "${shop.name}" có ${shop.warehouses.length} kho và chưa chọn kho mặc định — ` +
            'đặt kho mặc định trong phần cài đặt của shop.',
    );
  }

  /** Xoá Draft Product khỏi TikTok (dọn dẹp sau khi tạo nhầm). */
  async deleteRemoteProducts(ctx: TiktokShopContext, productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    await this.productApi.deleteProducts(ctx, productIds);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Bảo đảm mọi ảnh của listing đều có `uri` phía TikTok.
   *
   * Thứ tự tra: cache của lượt job → `tiktok_image_uri` trong database → mới upload thật.
   * Upload xong thì ghi ngược vào **mọi dòng dùng chung file đó** (clone bộ ảnh dùng chung
   * `file_id`), nên nhân bản bộ ảnh không sinh thêm lần upload nào.
   */
  private async ensureImageUris(
    organizationId: string,
    ctx: TiktokShopContext,
    payload: ResolvedListing,
    cache: Map<string, Promise<string>>,
    log: ListingLogger,
  ): Promise<{
    uris: string[];
    variantUris: Map<string, string>;
    uploaded: number;
    reused: number;
  }> {
    const selected = [...payload.images]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .slice(0, POD_LISTING_MAX_IMAGES);
    const variantFileIds = [
      ...new Set(
        payload.variants
          .map((variant) => variant.imageFileId)
          .filter((fileId): fileId is string => Boolean(fileId)),
      ),
    ];

    await this.seedCacheFromDatabase(organizationId, cache, selected, variantFileIds);

    let uploaded = 0;
    let reused = 0;

    /**
     * Lấy `uri` của một file, upload đúng MỘT lần cho cả lượt job.
     *
     * Promise được đặt vào cache TRƯỚC khi upload xong; luồng nào tới sau chỉ chờ nó. Upload
     * hỏng thì gỡ promise ra để lần thử lại còn cơ hội — giữ lại một promise đã reject là
     * biến một lỗi mạng thoáng qua thành lỗi vĩnh viễn của cả lượt.
     */
    const uriOf = async (
      source: { fileId?: string | null; url?: string | null },
      label: string,
      persist: (uri: string) => Promise<unknown>,
    ): Promise<string> => {
      // Khoá cache: file id nếu ảnh nằm trong Storage, còn lại là chính URL — hai draft dùng
      // chung một URL ảnh thì cũng chỉ upload một lần.
      const key = source.fileId || source.url || '';
      const pending = cache.get(key);
      if (pending) {
        reused += 1;
        return pending;
      }

      uploaded += 1;
      const promise = this.uploadFile(organizationId, ctx, source, label).then(async (uri) => {
        await persist(uri);
        return uri;
      });
      cache.set(key, promise);

      try {
        return await promise;
      } catch (error) {
        cache.delete(key);
        throw error;
      }
    };

    const uris = await Promise.all(
      selected.map((image) =>
        uriOf({ fileId: image.fileId, url: image.url }, image.title, (uri) =>
          image.fileId
            ? this.prisma.podImageTemplateItem.updateMany({
                where: { organizationId, fileId: image.fileId },
                data: { tiktokImageUri: uri, uploadedAt: new Date() },
              })
            : // Ảnh của Draft Product (URL ngoài): ghi `remote_uri` để lần sau khỏi tải lại.
              this.prisma.podListingSessionProductImage.updateMany({
                where: { organizationId, imageUrl: image.url },
                data: { remoteUri: uri, uploadedAt: new Date() },
              }),
        ),
      ),
    );

    const variantUris = new Map<string, string>(
      await Promise.all(
        variantFileIds.map(async (fileId): Promise<[string, string]> => [
          fileId,
          await uriOf({ fileId }, 'ảnh biến thể', (uri) =>
            this.prisma.podSkuTemplateItem.updateMany({
              where: { organizationId, imageFileId: fileId },
              data: { tiktokImageUri: uri, imageUploadedAt: new Date() },
            }),
          ),
        ]),
      ),
    );

    await log(PodListingLogLevel.INFO, PodListingStep.UPLOAD_IMAGE, 'Đã chuẩn bị ảnh cho listing', {
      total: uris.length,
      uploaded,
      reused,
    });

    return { uris, variantUris, uploaded, reused };
  }

  /**
   * Nạp `uri` đã có sẵn trong database vào cache của lượt job.
   *
   * Payload của draft là ảnh chụp lúc sinh — có thể cũ hơn lần upload gần nhất, nên phải hỏi
   * lại bảng thay vì tin vào `payload.images[].tiktokImageUri`.
   */
  private async seedCacheFromDatabase(
    organizationId: string,
    cache: Map<string, Promise<string>>,
    images: ResolvedListing['images'],
    variantFileIds: string[],
  ): Promise<void> {
    const missingImages = images.filter((image) => image.fileId && !cache.has(image.fileId));
    // Ảnh của draft đã từng upload thì `remote_uri` đã có sẵn trong payload (resolver chép
    // sang `tiktokImageUri`), nên chỉ cần nạp trước phần ảnh của bộ mẫu.
    for (const image of images) {
      if (!image.fileId && image.url && image.tiktokImageUri && !cache.has(image.url)) {
        cache.set(image.url, Promise.resolve(image.tiktokImageUri));
      }
    }
    const missingVariants = variantFileIds.filter((fileId) => !cache.has(fileId));

    const [imageRows, variantRows] = await Promise.all([
      missingImages.length === 0
        ? Promise.resolve([])
        : this.prisma.podImageTemplateItem.findMany({
            where: {
              organizationId,
              fileId: { in: missingImages.map((image) => image.fileId) },
              tiktokImageUri: { not: null },
            },
            select: { fileId: true, tiktokImageUri: true },
          }),
      missingVariants.length === 0
        ? Promise.resolve([])
        : this.prisma.podSkuTemplateItem.findMany({
            where: {
              organizationId,
              imageFileId: { in: missingVariants },
              tiktokImageUri: { not: null },
            },
            select: { imageFileId: true, tiktokImageUri: true },
          }),
    ]);

    for (const row of imageRows) {
      if (row.tiktokImageUri) cache.set(row.fileId, Promise.resolve(row.tiktokImageUri));
    }
    for (const row of variantRows) {
      if (row.imageFileId && row.tiktokImageUri) {
        cache.set(row.imageFileId, Promise.resolve(row.tiktokImageUri));
      }
    }
  }

  /** Tải file từ Storage rồi đẩy lên TikTok, trả về `uri`. */
  private async uploadFile(
    organizationId: string,
    ctx: TiktokShopContext,
    source: { fileId?: string | null; url?: string | null },
    label: string,
  ): Promise<string> {
    // Hai nguồn ảnh: file trong Storage Module (bộ ảnh mẫu, ảnh người dùng tải lên) hoặc
    // **URL ngoài** ghi trong file import. Cả hai đều quy về một buffer rồi đẩy lên sàn.
    const image = source.fileId
      ? await this.readStorageFile(organizationId, source.fileId)
      : await this.fetchRemoteImage(source.url ?? '', label);

    const { data } = await this.productApi.uploadImage(
      ctx,
      image,
      TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE,
    );

    if (!data.uri) throw new Error(`TikTok không trả về uri cho ${label}`);
    return data.uri;
  }

  private async readStorageFile(
    organizationId: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const { file, body } = await this.storage.download(organizationId, fileId);
    return {
      buffer: body,
      fileName: file.originalName || `${fileId}.png`,
      contentType: file.mimeType,
    };
  }

  /**
   * Tải ảnh từ URL ngoài (ảnh trong file import thường nằm trên CDN của xưởng in).
   *
   * 🔴 URL do người dùng nhập mà server tự đi gọi ⇒ **SSRF**. Chỉ cho http/https và chặn
   * mọi địa chỉ nội bộ: không có hàng rào này thì một dòng Excel trỏ tới
   * `http://169.254.169.254/...` là đủ để đọc metadata của máy chủ.
   */
  private async fetchRemoteImage(
    url: string,
    label: string,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const target = this.assertPublicHttpUrl(url, label);

    const response = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(POD_IMAGE_FETCH_TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new Error(
        `Không tải được ảnh ${label} (${target.hostname}): ${
          error instanceof Error ? error.message : 'lỗi mạng'
        }`,
      );
    });

    if (!response.ok) {
      throw new Error(`Không tải được ảnh ${label}: máy chủ trả về ${response.status}`);
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!contentType.startsWith('image/')) {
      throw new Error(`URL ảnh ${label} trả về "${contentType || 'không rõ'}", không phải ảnh.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > POD_IMAGE_FETCH_MAX_BYTES) {
      throw new Error(`Ảnh ${label} nặng hơn giới hạn ${POD_IMAGE_FETCH_MAX_BYTES} byte.`);
    }

    const fileName = decodeURIComponent(target.pathname.split('/').pop() || 'image') || 'image';
    return { buffer, fileName, contentType };
  }

  /** Chỉ chấp nhận http/https trỏ ra ngoài — chặn localhost và dải IP nội bộ. */
  private assertPublicHttpUrl(raw: string, label: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`URL ảnh ${label} không hợp lệ: "${raw}"`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`URL ảnh ${label} phải dùng http/https.`);
    }
    if (POD_PRIVATE_HOST_PATTERN.test(url.hostname)) {
      throw new Error(`URL ảnh ${label} trỏ vào địa chỉ nội bộ — không được phép.`);
    }
    return url;
  }

  /**
   * `ResolvedListing` ⇒ thân request Create Product.
   *
   * Chỗ dễ sai nhất là **hai nhóm thuộc tính**: `SALES_PROPERTY` (Color/Size — thuộc về từng
   * biến thể) đi vào `skus[].sales_attributes`, phần còn lại đi vào `product_attributes`.
   * Trộn lẫn hai nhóm là TikTok từ chối cả sản phẩm.
   */
  private buildCreateRequest(
    payload: ResolvedListing,
    payloadHash: string,
    imageUris: string[],
    uriByFileId: Map<string, string>,
    /** Kho ĐÃ ĐƯỢC quyết theo shop — không lấy lại từ payload. */
    warehouseId: string,
  ): TiktokCreateProductRequest {
    // Giá trị chính thức đi kèm `id`; giá trị tự nhập chỉ có `name` — TikTok nhận cả hai
    // trong cùng một mảng và KHÔNG cần biết cái nào do người dùng gõ.
    const productAttributes = payload.attributes
      .filter((attribute) => attribute.type !== 'SALES_PROPERTY')
      .map((attribute) => ({
        id: attribute.tiktokAttributeId,
        values: [
          ...attribute.values.map((value) => ({ id: value.id, name: value.name })),
          ...attribute.customValues.map((value) => ({ name: value })),
        ],
      }))
      .filter((attribute) => attribute.values.length > 0);

    return {
      title: payload.title.trim().slice(0, 255),
      description: payload.description,
      categoryId: payload.category.tiktokCategoryId ?? undefined,
      brandId: payload.brand.tiktokBrandId ?? undefined,
      // Cùng một payload gửi lại (retry sau lỗi mạng) ⇒ TikTok trả về đúng sản phẩm cũ thay
      // vì tạo bản trùng trên shop thật.
      idempotencyKey: payloadHash,
      mainImages: imageUris.map((uri) => ({ uri })),
      packageWeight: payload.package.weight
        ? { value: payload.package.weight, unit: payload.package.weightUnit ?? undefined }
        : undefined,
      packageDimensions:
        payload.package.length && payload.package.width && payload.package.height
          ? {
              length: payload.package.length,
              width: payload.package.width,
              height: payload.package.height,
              unit: payload.package.dimensionUnit ?? undefined,
            }
          : undefined,
      productAttributes,
      skus: payload.variants.map((variant) =>
        this.buildSku(payload, variant, uriByFileId, warehouseId),
      ),
    };
  }

  private buildSku(
    payload: ResolvedListing,
    variant: ResolvedListing['variants'][number],
    uriByFileId: Map<string, string>,
    warehouseId: string,
  ): TiktokCreateProductSku {
    const currency = variant.currency ?? payload.pricing?.currency ?? undefined;
    // Ảnh biến thể gắn vào TRỤC ĐẦU TIÊN (thường là Color) — TikTok chỉ hiển thị ảnh của
    // một trục, gắn vào cả hai trục là ảnh nhảy loạn khi người mua đổi size.
    const variantUri = variant.imageFileId ? uriByFileId.get(variant.imageFileId) : undefined;

    return {
      sellerSku: variant.sellerSku,
      price: {
        amount: variant.salePrice ?? undefined,
        currency,
      },
      // Giá gạch ngang chỉ gửi khi CAO HƠN giá bán — bằng hoặc thấp hơn thì TikTok từ chối,
      // mà đó cũng là một khuyến mãi vô nghĩa.
      listPrice:
        variant.retailPrice && Number(variant.retailPrice) > Number(variant.salePrice ?? 0)
          ? { amount: variant.retailPrice, currency }
          : undefined,
      inventory: [{ warehouseId, quantity: variant.quantity }],
      salesAttributes: variant.optionValues.map((option, index) => ({
        name: option.name,
        valueName: option.value,
        ...(index === 0 && variantUri ? { skuImg: { uri: variantUri } } : {}),
      })),
    };
  }
}
