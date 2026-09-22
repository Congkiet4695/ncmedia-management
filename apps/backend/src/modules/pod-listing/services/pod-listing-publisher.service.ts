import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  PodBrandMode, PodListingLogLevel, PodListingSessionImageType, PodListingStep } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { StorageService } from '../../storage/storage.service';
import { PodDescriptionImageService } from '../../pod-product/services/pod-description-image.service';
import { fetchRemoteImage, fetchRemoteVideo } from '../../pod-product/services/remote-image.fetch';
import { extractDescriptionImages, hostnameOf } from '../../pod-product/services/description-images';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import {
  TIKTOK_IMAGE_USE_CASE,
  TIKTOK_PRODUCT_SAVE_MODE,
  type TiktokImageUseCase,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import type {
  TiktokCategoryRules,
  TiktokCreateProductRequest,
  TiktokCreateProductSku,
} from '../../tiktok-sdk/types/tiktok-product.types';
import {
  POD_CATEGORY_RULES_CACHE_MS,
  POD_LISTING_MAX_IMAGES,
} from '../constants/pod-listing.constants';
import { POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID } from '../../pod-product/constants/pod-product.constants';
import type { ResolvedListing } from './pod-listing-resolver.service';

/** Ghi một dòng nhật ký cho item đang chạy. */
export type ListingLogger = (
  level: PodListingLogLevel,
  step: PodListingStep,
  message: string,
  payload?: Record<string, unknown>,
) => Promise<void>;

/**
 * Sinh `idempotency_key` — thứ TikTok gọi là **external_id** trong thông báo lỗi.
 *
 * 🔴 Giá trị này phải **DUY NHẤT TRONG SHOP CHO MỖI REQUEST** (tài liệu TikTok: *"Ensure this
 * key is unique within the shop for each request"*, khuyến nghị UUID v4, tối đa 128 ký tự).
 * Gửi lại một key đã từng dùng ⇒ TikTok trả `12052996 Precondition Required — This operation
 * requires a unique external_id` và **KHÔNG** tạo sản phẩm.
 *
 * 🔴 Vì thế key TUYỆT ĐỐI không được dẫn xuất từ nội dung payload, TikTok Product ID, Draft
 * ID, Listing ID hay SKU — những giá trị đó lặp lại y hệt ở lần thử thứ hai. Trước đây key
 * chính là `payloadHash` (sha256 của payload): cùng một listing luôn cho cùng một key, nên
 * Retry và nhánh Create-sau-khi-đã-tạo-Draft chết vĩnh viễn ở đúng lỗi trên.
 *
 * Phần định danh chỉ để **tra cứu** khi TikTok Support hỏi (log/publish_request đều ghi lại);
 * tính duy nhất do `randomUUID()` (v4) + timestamp bảo đảm, không do phần định danh đó.
 *
 * Định dạng: `<listingTemplate8>-<product8>-<ts36>-<uuidv4>` (~60 ký tự, luôn < 128).
 *
 * ⚠️ Đánh đổi có chủ ý: key mới mỗi lần gọi ⇒ `idempotency_key` KHÔNG còn chống trùng khi
 * retry sau lỗi mạng. Hàng rào chống trùng thật sự nằm ở chỗ khác và vẫn nguyên vẹn:
 * `tiktokDraftId` có giá trị ⇒ đi Edit Product, và payload `PUBLISHED` ⇒ không gọi TikTok.
 */
/**
 * Những `brand_id` TUYỆT ĐỐI không được gửi lên TikTok.
 *
 * `7082427311584347905` từng được `ensureNoBrand()` tự bịa ra và gán tên "No brand", rồi
 * người dùng chọn nó và template lưu lại. TikTok nhận id này lại phân giải thành thương hiệu
 * THẬT sở hữu nó phía họ — đó là lý do sản phẩm lên sàn mang tên một thương hiệu không ai
 * chọn. Chi tiết: `POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID`.
 */
const LEGACY_FAKE_BRAND_IDS: ReadonlySet<string> = new Set([POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID]);

/**
 * `brand_id` cuối cùng gửi lên TikTok — **cổng chặn cuối cùng** của luồng thương hiệu.
 *
 * 🔴 Vì sao phép kiểm này nằm ở đây chứ không chỉ ở template: payload đã được ĐÓNG BĂNG vào
 * `pod_listing_payloads.payload` lúc sinh draft. Mọi draft tạo ra TRƯỚC khi sửa lỗi vẫn mang
 * nguyên `tiktokBrandId` giả trong ảnh chụp đó, và publish/retry đọc lại chính ảnh chụp ấy.
 * Sửa template thôi thì những draft cũ vẫn đăng sai. Đây là chỗ duy nhất mọi đường publish
 * đều đi qua.
 *
 * `brandId` là optional trong Create Product API của TikTok, nên bỏ hẳn field là cách biểu
 * diễn hợp lệ của "không có thương hiệu".
 */
export function resolveTiktokBrandId(brand: ResolvedListing['brand']): string | undefined {
  if (brand.mode === PodBrandMode.NONE) return undefined;
  const id = brand.tiktokBrandId?.trim();
  if (!id) return undefined;
  // Payload cũ: `mode` không có, nhưng id giả thì vẫn phải chặn.
  if (LEGACY_FAKE_BRAND_IDS.has(id)) return undefined;
  return id;
}

export function buildTiktokExternalId(payload: ResolvedListing): string {
  const tail = (value: string | null | undefined): string =>
    (value ?? '').replace(/-/g, '').slice(-8);

  const trace = [tail(payload.source.listingTemplateId), tail(payload.source.productId ?? payload.source.sessionProductId)]
    .filter((part) => part.length > 0)
    .join('-');
  const stamp = Date.now().toString(36);
  const unique = randomUUID().replace(/-/g, '');

  return [trace, stamp, unique].filter((part) => part.length > 0).join('-').slice(0, 128);
}

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

/**
 * Một ảnh KHÔNG đưa lên TikTok được — item hỏng TRƯỚC khi gọi Create/Edit Product.
 *
 * 🔴 Không có chuyện gửi Create Product với ảnh thiếu: bộ ảnh / ảnh biến thể / bảng size là
 * mảng THAY TOÀN BỘ phía TikTok, gửi thiếu một tấm là đăng một sản phẩm khác thứ người dùng
 * đã cấu hình. Thông điệp nêu rõ ảnh nào (`ảnh biến thể Color=Black`, `bảng size`, `ảnh sản
 * phẩm #2`) và vì sao; lỗi gốc giữ ở `cause` để hàng đợi quyết định thử lại hay bỏ cuộc theo
 * đúng mã lỗi TikTok.
 */
export class PodImageUploadException extends Error {
  constructor(
    /** `ảnh biến thể Color=Black` · `bảng size` · `ảnh sản phẩm "Front" (#1)`. */
    readonly imageLabel: string,
    readonly imageUseCase: TiktokImageUseCase,
    readonly cause: unknown,
  ) {
    super(`Không tải được ${imageLabel} lên TikTok: ${describeUploadError(cause)}`);
    this.name = 'PodImageUploadException';
  }
}

/** Câu lỗi TikTok (có mã) nếu là lỗi sàn, còn lại là message thường. */
function describeUploadError(error: unknown): string {
  const candidate = error as { tiktokMessage?: string; tiktokCode?: number; message?: string };
  if (candidate?.tiktokMessage) return `${candidate.tiktokMessage} (TikTok ${candidate.tiktokCode ?? '?'})`;
  return candidate?.message ?? String(error);
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
 * Listing vi phạm LUẬT DANH MỤC của TikTok (Get Category Rules) — vd danh mục bắt buộc bảng size
 * mà listing không có. Lỗi cấu hình/nội dung: thử lại vẫn y hệt ⇒ hàng đợi coi là vĩnh viễn.
 */
export class PodCategoryRuleException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PodCategoryRuleException';
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
  /** Luật danh mục theo (shop, danh mục) — Promise để 5 luồng cùng lượt không hỏi TikTok 5 lần. */
  private readonly categoryRulesCache = new Map<string, { at: number; rules: Promise<TiktokCategoryRules | null> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly productApi: TiktokProductApiService,
    private readonly storage: StorageService,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
    private readonly descriptionImages: PodDescriptionImageService,
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
    imageUriCache: Map<string, Promise<string>>;
    log: ListingLogger;
  }): Promise<PublishOutcome> {
    const { ctx, log, imageUriCache } = params;

    // 🔴 Ảnh trong MÔ TẢ đi trước cả bộ ảnh sản phẩm: đây là bước hay hỏng nhất (tải URL ngoài,
    // upload từng tấm) và nếu hỏng thì KHÔNG được tốn lượt upload ảnh sản phẩm rồi mới biết.
    const payload = await this.applyCategoryRules(
      ctx,
      await this.ensureDescriptionImages(params.organizationId, ctx, params.payload, log),
      log,
    );

    const images = await this.ensureImageUris(
      params.organizationId,
      ctx,
      payload,
      imageUriCache,
      log,
    );
    // 🔴 Kho được quyết Ở ĐÂY — theo shop đang đăng, không phải theo Draft Product.
    const warehouse = await this.resolveWarehouse(params.organizationId, ctx, payload, log);
    // 🔴 Sinh MỚI ở đây, mỗi lần gọi — kể cả khi hàng đợi chạy lại đúng item này.
    const externalId = buildTiktokExternalId(payload);
    const request = this.buildCreateRequest(
      payload,
      externalId,
      images.uris,
      images.variantUris,
      warehouse.tiktokWarehouseId,
      images.sizeChartUri,
      images.videoId,
    );

    await log(
      PodListingLogLevel.INFO,
      PodListingStep.CREATE_DRAFT,
      'Gửi Create Product (AS_DRAFT)',
      {
        externalId,
        categoryId: request.categoryId,
        // Ghi cả HAI: ý định của template và giá trị thật sự gửi đi. Đây là cặp số liệu
        // duy nhất trả lời được "vì sao sản phẩm này lên sàn mang thương hiệu đó".
        brandMode: payload.brand.mode ?? 'LEGACY_PAYLOAD',
        brandId: request.brandId ?? 'OMITTED',
        warehouseId: warehouse.tiktokWarehouseId,
        warehouseSource: warehouse.source,
        market: payload.market,
        currency: summarizeCurrencies(request),
        skus: request.skus?.length ?? 0,
        skuSummary: summarizeSkus(request),
        images: request.mainImages?.length ?? 0,
        descriptionImages: summarizeDescriptionImages(request.description ?? ''),
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
   * sàn, và gửi kèm `idempotencyKey` được sinh MỚI ở mỗi lần gọi (`buildTiktokExternalId`) —
   * TikTok từ chối key đã dùng bằng lỗi `12052996 requires a unique external_id`.
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
    /** Id Draft trên TikTok. Có giá trị ⇒ đi nhánh Edit; `null` ⇒ tạo mới ở chế độ LISTING. */
    tiktokDraftId: string | null;
    imageUriCache: Map<string, Promise<string>>;
    log: ListingLogger;
  }): Promise<PublishListingOutcome> {
    const { ctx, log, imageUriCache, tiktokDraftId } = params;

    if (params.payload.variants.length === 0) {
      throw new PodPublishPayloadException(
        'Payload của listing không còn biến thể nào — sinh lại Draft trước khi publish.',
      );
    }

    // Edit Product là full edit ⇒ mô tả gửi lại toàn bộ, nên ảnh mô tả cũng phải là URL
    // DESCRIPTION_IMAGE. Ảnh đã upload ở lượt tạo Draft nằm sẵn trong bảng mapping ⇒ dùng lại.
    const payload = await this.applyCategoryRules(
      ctx,
      await this.ensureDescriptionImages(params.organizationId, ctx, params.payload, log),
      log,
    );

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
    // 🔴 Sinh MỚI cho MỖI lần publish. Bấm Retry ⇒ chạy lại đúng dòng này ⇒ key khác hẳn
    // lần trước. Publish All ⇒ mỗi listing gọi hàm này một lần nên mỗi sản phẩm một key.
    const externalId = buildTiktokExternalId(payload);
    const request = this.buildCreateRequest(
      payload,
      externalId,
      images.uris,
      images.variantUris,
      warehouse.tiktokWarehouseId,
      images.sizeChartUri,
      images.videoId,
    );

    const mode: 'EDIT' | 'CREATE' = tiktokDraftId ? 'EDIT' : 'CREATE';

    await log(
      PodListingLogLevel.INFO,
      PodListingStep.PUBLISH,
      'Gửi Publish (save_mode = LISTING)',
      {
        mode,
        // Nhánh EDIT không gửi key này đi (Edit Product không nhận) — ghi `null` cho đúng.
        externalId: mode === 'CREATE' ? externalId : null,
        tiktokDraftId,
        warehouseId: warehouse.tiktokWarehouseId,
        warehouseSource: warehouse.source,
        market: payload.market,
        currency: summarizeCurrencies(request),
        skus: request.skus?.length ?? 0,
        skuSummary: summarizeSkus(request),
        images: request.mainImages?.length ?? 0,
        descriptionImages: summarizeDescriptionImages(request.description ?? ''),
      },
    );

    // `idempotencyKey` chỉ có nghĩa lúc TẠO; Edit Product không nhận nó, nên bỏ ra thay vì
    // gửi kèm một trường TikTok không hiểu.
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
   * Đưa ảnh trong MÔ TẢ lên TikTok (`use_case = DESCRIPTION_IMAGE`) và thay `src` bằng URL sàn
   * trả về, kèm `width`/`height`. Trả về payload MỚI với mô tả đã chuẩn hoá.
   *
   * 🔴 Không có ảnh thì không đụng gì (mô tả chỉ chữ đi thẳng). Hỏng ⇒ ném
   * `PodDescriptionImageException` — nơi gọi không được gửi Create/Edit Product.
   */
  private async ensureDescriptionImages(
    organizationId: string,
    ctx: TiktokShopContext,
    payload: ResolvedListing,
    log: ListingLogger,
  ): Promise<ResolvedListing> {
    const { html, stats, images } = await this.descriptionImages.normalize(
      organizationId,
      ctx,
      payload.description,
      { label: `mô tả · ${payload.title.slice(0, 60)}` },
    );
    if (stats.total > 0) {
      // Từng ảnh: nguồn (STORAGE/EXTERNAL/TIKTOK/PRODUCT) → hành động → host kết quả. Không log URL
      // đầy đủ: query string của TikTok mang khoá ký, và HTML đầy đủ không cần cho việc truy vết.
      await log(PodListingLogLevel.INFO, PodListingStep.UPLOAD_IMAGE, 'Đã chuẩn bị ảnh trong mô tả', {
        descriptionImageCount: stats.total,
        uploadedCount: stats.uploaded,
        reusedCount: stats.reused,
        failedCount: stats.failed,
        finalDescriptionImageCount: stats.finalCount,
        useCase: 'DESCRIPTION_IMAGE',
        images: images.map((image) => ({
          index: image.index,
          sourceType: image.sourceType,
          sourceHost: image.sourceHost,
          action: image.action,
          normalized: image.action !== 'KEPT',
          useCase: image.useCase,
          resultHost: image.resultHost,
          width: image.width,
          height: image.height,
        })),
      });
    }
    return html === payload.description ? payload : { ...payload, description: html };
  }

  /**
   * Bảo đảm mọi ảnh của listing đều có `uri` phía TikTok.
   *
   * Thứ tự tra: cache của lượt job → `tiktok_image_uri` trong database → mới upload thật.
   * Upload xong thì ghi ngược vào **mọi dòng dùng chung file đó** (clone bộ ảnh dùng chung
   * `file_id`), nên nhân bản bộ ảnh không sinh thêm lần upload nào.
   */
  /**
   * Áp **luật danh mục** (Get Category Rules) lên listing TRƯỚC khi upload ảnh / gửi request.
   *
   * Bảng size:
   *   - `isSupported = false` ⇒ BỎ `size_chart` (TikTok: "even if you provide a size chart…
   *     the size chart will not be saved") và không tốn một lượt upload vô ích — log WARN để
   *     người vận hành biết vì sao sản phẩm lên sàn không có bảng size dù template có.
   *   - `isRequired = true` mà listing không có ⇒ lỗi VĨNH VIỄN với câu chỉ rõ phải cấu hình bảng
   *     size ở Category Template / form — không gửi để TikTok từ chối bằng mã khó hiểu.
   *
   * 🔴 Không lấy được luật (mạng, quota) ⇒ giữ nguyên listing và log WARN: luật chỉ là bộ lọc
   * phụ, TikTok vẫn là trọng tài cuối cùng; chặn cả lượt đăng vì một lời gọi phụ hỏng là sai.
   */
  private async applyCategoryRules(
    ctx: TiktokShopContext,
    payload: ResolvedListing,
    log: ListingLogger,
  ): Promise<ResolvedListing> {
    const categoryId = payload.category.tiktokCategoryId;
    if (!categoryId) return payload;
    const rules = await this.categoryRules(ctx, categoryId, log);
    const sizeChart = rules?.sizeChart;
    if (!sizeChart) return payload;

    if (!sizeChart.isSupported && payload.sizeChart) {
      await log(
        PodListingLogLevel.WARN,
        PodListingStep.VALIDATE,
        `Danh mục ${categoryId} không hỗ trợ bảng size — bỏ qua bảng size của listing (TikTok sẽ không lưu)`,
        { categoryId, sizeChartSupported: false },
      );
      return { ...payload, sizeChart: null };
    }
    if (sizeChart.isRequired && !payload.sizeChart) {
      throw new PodCategoryRuleException(
        `Danh mục ${payload.category.name ?? categoryId} bắt buộc có bảng size (size chart) — thêm ảnh bảng size vào ` +
          'Category Template hoặc mục Media của listing rồi chạy lại.',
      );
    }
    return payload;
  }

  /** Luật danh mục theo (shop, danh mục), nhớ `POD_CATEGORY_RULES_CACHE_MS`; lỗi ⇒ `null` + WARN. */
  private categoryRules(
    ctx: TiktokShopContext,
    categoryId: string,
    log: ListingLogger,
  ): Promise<TiktokCategoryRules | null> {
    const key = `${ctx.shopId ?? 'shop'}:${categoryId}`;
    const cached = this.categoryRulesCache.get(key);
    if (cached && Date.now() - cached.at < POD_CATEGORY_RULES_CACHE_MS) return cached.rules;

    const rules = Promise.resolve()
      .then(() => this.productApi.getCategoryRules(ctx, categoryId))
      .then((result) => result.data)
      .catch(async (error: unknown) => {
        // Không nhớ kết quả hỏng: lượt sau hỏi lại.
        this.categoryRulesCache.delete(key);
        const detail = error as { tiktokCode?: number; requestId?: string };
        await log(
          PodListingLogLevel.WARN,
          PodListingStep.VALIDATE,
          `Không lấy được luật danh mục ${categoryId} — gửi listing như cấu hình, TikTok tự kiểm`,
          {
            categoryId,
            tiktokCode: detail?.tiktokCode ?? null,
            tiktokRequestId: detail?.requestId ?? null,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return null;
      });
    this.categoryRulesCache.set(key, { at: Date.now(), rules });
    return rules;
  }

  private async ensureImageUris(
    organizationId: string,
    ctx: TiktokShopContext,
    payload: ResolvedListing,
    cache: Map<string, Promise<string>>,
    log: ListingLogger,
  ): Promise<{
    uris: string[];
    /** Khoá là `imageFileId` (Storage) hoặc `imageUrl` (URL ngoài — lượt nhân bản). */
    variantUris: Map<string, string>;
    /** `uri` bảng size đã upload — `null` khi không có, hoặc upload hỏng (không chặn listing). */
    sizeChartUri: string | null;
    /** ID video phía TikTok — `null` khi không có, hoặc upload hỏng (không chặn listing). */
    videoId: string | null;
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
    // Ảnh biến thể theo URL ngoài (nhân bản sản phẩm): chỉ những biến thể KHÔNG có file Storage.
    const variantUrls = [
      ...new Set(
        payload.variants
          .filter((variant) => !variant.imageFileId)
          .map((variant) => variant.imageUrl)
          .filter((url): url is string => Boolean(url)),
      ),
    ];

    await this.seedCacheFromDatabase(organizationId, cache, selected, variantFileIds, payload.sizeChart?.fileId ?? null);
    // Bảng size của Draft Product đã từng upload (`remote_uri`) ⇒ nạp sẵn theo ĐÚNG use case
    // SIZE_CHART_IMAGE; không nạp thì mỗi lượt / mỗi shop lại upload cùng một tấm.
    if (payload.sizeChart?.tiktokImageUri) {
      const key = this.cacheKey(TIKTOK_IMAGE_USE_CASE.SIZE_CHART_IMAGE, payload.sizeChart);
      if (!cache.has(key)) cache.set(key, Promise.resolve(payload.sizeChart.tiktokImageUri));
    }

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
      useCase: TiktokImageUseCase = TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE,
    ): Promise<string> => {
      // Khoá cache: file id nếu ảnh nằm trong Storage, còn lại là chính URL — hai draft dùng
      // chung một URL ảnh thì cũng chỉ upload một lần. Xem `cacheKey`.
      const key = this.cacheKey(useCase, source);
      const pending = cache.get(key);
      if (pending) {
        reused += 1;
        return pending;
      }

      uploaded += 1;
      const promise = this.uploadFile(organizationId, ctx, source, label, useCase).then(async (uri) => {
        await persist(uri);
        return uri;
      });
      cache.set(key, promise);

      try {
        return await promise;
      } catch (error) {
        cache.delete(key);
        // 🔴 Ghi log ĐỦ ngữ cảnh để tra: loại ảnh, nhãn (giá trị biến thể), file, mã TikTok.
        // Không log URL đầy đủ (query TikTok mang khoá ký) và không bao giờ log token.
        const detail = error as { tiktokCode?: number; requestId?: string };
        await log(PodListingLogLevel.ERROR, PodListingStep.UPLOAD_IMAGE, `Không tải được ${label} lên TikTok`, {
          imageType: useCase,
          label,
          fileId: source.fileId ?? null,
          sourceHost: source.url ? hostnameOf(source.url) : null,
          shopId: ctx.shopId ?? null,
          tiktokCode: detail?.tiktokCode ?? null,
          tiktokRequestId: detail?.requestId ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new PodImageUploadException(label, useCase, error);
      }
    };

    // Nhãn ảnh biến thể theo giá trị của trục ĐẦU (Color=Black) — người dùng biết ảnh nào hỏng.
    const variantLabelOf = (matcher: (variant: ResolvedListing['variants'][number]) => boolean): string => {
      const option = payload.variants.find(matcher)?.optionValues[0];
      return option ? `ảnh biến thể ${option.name}=${option.value}` : 'ảnh biến thể';
    };

    const uris = await Promise.all(
      selected.map((image, index) =>
        uriOf({ fileId: image.fileId, url: image.url }, `ảnh sản phẩm "${image.title}" (#${index + 1})`, (uri) =>
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

    /**
     * Ảnh biến thể (`sku_img`) — upload với `use_case = ATTRIBUTE_IMAGE`, KHÔNG phải MAIN_IMAGE.
     *
     * 🔴 Hợp đồng Create Product của TikTok (SDK `CreateProductRequestBodySkusSalesAttributesSkuImg`):
     * "Obtain this URI by uploading the images through the Upload Product Image API with
     * `use_case=ATTRIBUTE_IMAGE`". Cùng một file ⇒ một `uri` cho cả lượt (cache theo use case +
     * file), nên Black/S · Black/M · Black/L dùng chung đúng một lần upload. `uri` được ghi ngược
     * vào CẢ ảnh riêng của tổ hợp lẫn ảnh mặc định của giá trị trục để listing sau khỏi upload lại.
     */
    const attribute = TIKTOK_IMAGE_USE_CASE.ATTRIBUTE_IMAGE;
    const variantUris = new Map<string, string>(
      await Promise.all([
        ...variantFileIds.map(async (fileId): Promise<[string, string]> => [
          fileId,
          await uriOf(
            { fileId },
            variantLabelOf((variant) => variant.imageFileId === fileId),
            (uri) => this.persistVariantImageUri(organizationId, fileId, uri),
            attribute,
          ),
        ]),
        // URL ngoài không có bảng nào để ghi ngược `uri` — cache của lượt job là đủ: một ảnh
        // biến thể của sản phẩm nguồn chỉ upload một lần cho cả N shop đích.
        ...variantUrls.map(async (url): Promise<[string, string]> => [
          url,
          await uriOf(
            { url },
            variantLabelOf((variant) => !variant.imageFileId && variant.imageUrl === url),
            () => Promise.resolve(),
            attribute,
          ),
        ]),
      ]),
    );

    /**
     * Bảng size — upload với `useCase = SIZE_CHART_IMAGE`, KHÔNG phải MAIN_IMAGE.
     *
     * 🔴 Dùng nhầm use case thì TikTok xếp tấm ảnh vào sai chỗ và bảng size không hiện ở mục
     * "Size guide" của trang sản phẩm. Đi qua `uriOf` nên vẫn chỉ upload một lần cho cả lượt.
     *
     * 🔴 Upload hỏng ⇒ item HỎNG với lý do rõ (`PodImageUploadException`), KHÔNG âm thầm đăng
     * sản phẩm thiếu bảng size. Trước đây chỗ này "fail-soft": TikTok từ chối tấm bảng size
     * (vd ảnh nhỏ hơn 1024px cạnh ngắn) thì listing vẫn xanh và không ai biết vì sao sản
     * phẩm lên sàn không có bảng size — đúng lỗi người dùng đã báo.
     */
    const sizeChartUri = payload.sizeChart
      ? await uriOf(
          { fileId: payload.sizeChart.fileId, url: payload.sizeChart.url },
          'bảng size',
          (uri) => this.persistSizeChartUri(organizationId, payload.sizeChart, uri),
          TIKTOK_IMAGE_USE_CASE.SIZE_CHART_IMAGE,
        )
      : null;

    /**
     * Video sản phẩm — API KHÁC hẳn ảnh: `POST /product/202309/files/upload`, trả về **ID**.
     *
     * 🔴 Dùng chung `cache` của lượt job nên một video chỉ upload MỘT lần dù đăng lên 8 shop
     * (file có thể tới 100 MB — upload lại mỗi shop là tám lần tải lên vô ích).
     *
     * 🔴 Fail-soft như bảng size: video là thứ làm listing đẹp hơn, không phải thứ khiến sản
     * phẩm không bán được. Hỏng thì cảnh báo và đăng tiếp.
     */
    let videoId: string | null = null;
    // Hai nguồn: file trong Storage (nhập tay) hoặc URL ngoài (video của sản phẩm nguồn khi
    // nhân bản). Cùng một cache của lượt job, cùng fail-soft.
    const videoSource = payload.video?.fileId
      ? { key: `VIDEO:${payload.video.fileId}`, fileId: payload.video.fileId, url: null }
      : payload.video?.url
        ? { key: `VIDEO:${payload.video.url}`, fileId: null, url: payload.video.url }
        : null;
    if (videoSource) {
      const key = videoSource.key;
      try {
        const pending = cache.get(key);
        if (pending) {
          videoId = await pending;
          reused += 1;
        } else {
          uploaded += 1;
          const promise = videoSource.fileId
            ? this.uploadVideo(organizationId, ctx, videoSource.fileId)
            : this.uploadRemoteVideo(ctx, videoSource.url ?? '');
          cache.set(key, promise);
          try {
            videoId = await promise;
          } catch (error) {
            cache.delete(key);
            throw error;
          }
        }
      } catch (error) {
        await log(
          PodListingLogLevel.WARN,
          PodListingStep.UPLOAD_IMAGE,
          'Không tải được video — bỏ qua, sản phẩm vẫn được đăng',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    await log(PodListingLogLevel.INFO, PodListingStep.UPLOAD_IMAGE, 'Đã chuẩn bị ảnh cho listing', {
      total: uris.length,
      uploaded,
      reused,
      sizeChart: sizeChartUri ? 'OK' : 'NONE',
      video: videoId ? 'OK' : 'NONE',
    });

    return { uris, variantUris, sizeChartUri, videoId, uploaded, reused };
  }

  /**
   * Khoá cache của một file đã upload lên TikTok.
   *
   * 🔴 Gồm CẢ `useCase`: cùng một tấm ảnh dùng làm ảnh sản phẩm và làm bảng size là HAI `uri`
   * khác nhau phía TikTok. Bỏ `useCase` ra khỏi khoá thì bảng size sẽ nhận nhầm uri của ảnh
   * sản phẩm và hiện ra giữa bộ ảnh.
   *
   * 🔴 MỘT định nghĩa duy nhất, dùng cho cả lúc GHI (`uriOf`) lẫn lúc NẠP SẴN
   * (`seedCacheFromDatabase`). Hai công thức khoá lệch nhau nghĩa là phần nạp sẵn không bao
   * giờ trúng, và mọi ảnh đã upload từ trước sẽ bị upload lại — âm thầm, chỉ lộ ra ở hoá đơn
   * băng thông và ở hạn mức API.
   */
  private cacheKey(useCase: TiktokImageUseCase, source: { fileId?: string | null; url?: string | null }): string {
    return `${useCase}:${source.fileId || source.url || ''}`;
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
    /** File bảng size (Storage) — nạp `uri` SIZE_CHART_IMAGE đã ghi ở Category Template / Draft Product. */
    sizeChartFileId: string | null = null,
  ): Promise<void> {
    // Bộ ảnh sản phẩm ⇒ MAIN_IMAGE; ảnh biến thể ⇒ ATTRIBUTE_IMAGE (uri KHÁC nhau phía TikTok).
    const main = TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE;
    const attribute = TIKTOK_IMAGE_USE_CASE.ATTRIBUTE_IMAGE;
    const missingImages = images.filter(
      (image) => image.fileId && !cache.has(this.cacheKey(main, { fileId: image.fileId })),
    );
    // Ảnh của draft đã từng upload thì `remote_uri` đã có sẵn trong payload (resolver chép
    // sang `tiktokImageUri`), nên chỉ cần nạp trước phần ảnh của bộ mẫu.
    for (const image of images) {
      const key = this.cacheKey(main, { url: image.url });
      if (!image.fileId && image.url && image.tiktokImageUri && !cache.has(key)) {
        cache.set(key, Promise.resolve(image.tiktokImageUri));
      }
    }
    const missingVariants = variantFileIds.filter(
      (fileId) => !cache.has(this.cacheKey(attribute, { fileId })),
    );

    const sizeChartKey = sizeChartFileId
      ? this.cacheKey(TIKTOK_IMAGE_USE_CASE.SIZE_CHART_IMAGE, { fileId: sizeChartFileId })
      : null;

    const [imageRows, variantRows, valueRows, sizeChartRows] = await Promise.all([
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
      // Ảnh mặc định của GIÁ TRỊ trục (Color = Black) — nguồn thứ hai của `uri` đã upload.
      missingVariants.length === 0
        ? Promise.resolve([])
        : this.prisma.podSkuTemplateVariantValue.findMany({
            where: {
              organizationId,
              imageFileId: { in: missingVariants },
              tiktokImageUri: { not: null },
            },
            select: { imageFileId: true, tiktokImageUri: true },
          }),
      // Bảng size đã upload cho file này (Category Template hoặc Draft Product) ⇒ dùng lại.
      !sizeChartFileId || !sizeChartKey || cache.has(sizeChartKey)
        ? Promise.resolve([] as Array<{ uri: string | null }>)
        : Promise.all([
            this.prisma.podCategoryTemplate.findFirst({
              where: { organizationId, sizeChartFileId, sizeChartTiktokImageUri: { not: null } },
              select: { sizeChartTiktokImageUri: true },
            }),
            this.prisma.podListingSessionProductImage.findFirst({
              where: {
                organizationId,
                fileId: sizeChartFileId,
                imageType: PodListingSessionImageType.SIZE_CHART,
                remoteUri: { not: null },
              },
              select: { remoteUri: true },
            }),
          ]).then(([template, image]) => [
            { uri: template?.sizeChartTiktokImageUri ?? image?.remoteUri ?? null },
          ]),
    ]);

    for (const row of sizeChartRows) {
      if (row.uri && sizeChartKey) cache.set(sizeChartKey, Promise.resolve(row.uri));
    }
    for (const row of imageRows) {
      if (row.tiktokImageUri) {
        cache.set(this.cacheKey(main, { fileId: row.fileId }), Promise.resolve(row.tiktokImageUri));
      }
    }
    for (const row of [...variantRows, ...valueRows]) {
      if (row.imageFileId && row.tiktokImageUri) {
        cache.set(
          this.cacheKey(attribute, { fileId: row.imageFileId }),
          Promise.resolve(row.tiktokImageUri),
        );
      }
    }
  }

  /**
   * Ghi `uri` SIZE_CHART_IMAGE ngược vào MỌI chỗ đang trỏ tới tấm bảng size đó: ảnh SIZE_CHART của
   * Draft Product (`remote_uri`) và **Category Template** (`size_chart_tiktok_image_uri`) — lần
   * listing sau (kể cả Auto Listing chỉ có template, không có Draft Product) dùng lại, không
   * upload lại. Bảng size theo URL ngoài (nhân bản sản phẩm) chỉ có cache của lượt job.
   */
  private async persistSizeChartUri(
    organizationId: string,
    sizeChart: ResolvedListing['sizeChart'],
    uri: string,
  ): Promise<void> {
    if (!sizeChart) return;
    const uploadedAt = new Date();
    await Promise.all([
      this.prisma.podListingSessionProductImage.updateMany({
        where: {
          organizationId,
          imageType: PodListingSessionImageType.SIZE_CHART,
          ...(sizeChart.fileId ? { fileId: sizeChart.fileId } : { imageUrl: sizeChart.url ?? '' }),
        },
        data: { remoteUri: uri, uploadedAt },
      }),
      sizeChart.fileId
        ? this.prisma.podCategoryTemplate.updateMany({
            where: { organizationId, sizeChartFileId: sizeChart.fileId },
            data: { sizeChartTiktokImageUri: uri, sizeChartImageUploadedAt: uploadedAt },
          })
        : Promise.resolve(),
    ]);
  }

  /** Ghi `uri` ATTRIBUTE_IMAGE ngược vào mọi dòng dùng chung file — tổ hợp lẫn giá trị trục. */
  private async persistVariantImageUri(
    organizationId: string,
    fileId: string,
    uri: string,
  ): Promise<void> {
    const data = { tiktokImageUri: uri, imageUploadedAt: new Date() };
    await Promise.all([
      this.prisma.podSkuTemplateItem.updateMany({
        where: { organizationId, imageFileId: fileId },
        data,
      }),
      this.prisma.podSkuTemplateVariantValue.updateMany({
        where: { organizationId, imageFileId: fileId },
        data,
      }),
    ]);
  }

  /** Tải file từ Storage rồi đẩy lên TikTok, trả về `uri`. */
  private async uploadFile(
    organizationId: string,
    ctx: TiktokShopContext,
    source: { fileId?: string | null; url?: string | null },
    label: string,
    /** Vai trò của ảnh phía TikTok. Bảng size PHẢI dùng `SIZE_CHART_IMAGE`. */
    useCase: TiktokImageUseCase = TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE,
  ): Promise<string> {
    // Hai nguồn ảnh: file trong Storage Module (bộ ảnh mẫu, ảnh người dùng tải lên) hoặc
    // **URL ngoài** ghi trong file import. Cả hai đều quy về một buffer rồi đẩy lên sàn.
    const image = source.fileId
      ? await this.readStorageFile(organizationId, source.fileId)
      : await fetchRemoteImage(source.url ?? '', label);

    const { data } = await this.productApi.uploadImage(ctx, image, useCase);

    if (!data.uri) throw new Error(`TikTok không trả về uri cho ${label}`);
    return data.uri;
  }

  /**
   * Đưa video từ Storage Module lên TikTok, trả về **ID** của họ.
   *
   * Chỉ nhận video đã nằm trong Storage (có `fileId`): video là file lớn, tải từ một URL
   * ngoài về rồi đẩy lên là hai lần truyền không kiểm soát được kích thước.
   */
  private async uploadVideo(
    organizationId: string,
    ctx: TiktokShopContext,
    fileId: string,
  ): Promise<string> {
    const file = await this.readStorageFile(organizationId, fileId);
    const { data } = await this.productApi.uploadFile(ctx, {
      buffer: file.buffer,
      fileName: file.fileName,
    });
    if (!data.id) throw new Error('TikTok không trả về id cho video');
    return data.id;
  }

  /** Video của sản phẩm nguồn (URL TikTok CDN) → tải về → Upload Product File → **ID** mới. */
  private async uploadRemoteVideo(ctx: TiktokShopContext, url: string): Promise<string> {
    const file = await fetchRemoteVideo(url, 'sản phẩm nguồn');
    const { data } = await this.productApi.uploadFile(ctx, {
      buffer: file.buffer,
      fileName: file.fileName,
    });
    if (!data.id) throw new Error('TikTok không trả về id cho video');
    return data.id;
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
   * `ResolvedListing` ⇒ thân request Create Product.
   *
   * Chỗ dễ sai nhất là **hai nhóm thuộc tính**: `SALES_PROPERTY` (Color/Size — thuộc về từng
   * biến thể) đi vào `skus[].sales_attributes`, phần còn lại đi vào `product_attributes`.
   * Trộn lẫn hai nhóm là TikTok từ chối cả sản phẩm.
   */
  private buildCreateRequest(
    payload: ResolvedListing,
    /** `idempotency_key` — sinh MỚI cho mỗi lần gọi, xem `buildTiktokExternalId`. */
    externalId: string,
    imageUris: string[],
    uriByFileId: Map<string, string>,
    /** Kho ĐÃ ĐƯỢC quyết theo shop — không lấy lại từ payload. */
    warehouseId: string,
    /** `uri` bảng size đã upload. `null` = không có, hoặc upload hỏng ⇒ bỏ trường này. */
    sizeChartUri: string | null,
    /** ID video phía TikTok. `null` ⇒ bỏ trường này. */
    videoId: string | null,
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
      // Chỉ gửi khi người dùng THỰC SỰ nhập (Custom Listing). Mảng rỗng cũng bỏ: TikTok không
      // cần một trường `[]` và draft từ template chưa bao giờ có trường này.
      ...(payload.searchTerms?.length ? { searchTerms: payload.searchTerms } : {}),
      ...(payload.highlights?.length ? { keyProductFeatures: payload.highlights } : {}),
      categoryId: payload.category.tiktokCategoryId ?? undefined,
      brandId: resolveTiktokBrandId(payload.brand),
      // 🔴 DUY NHẤT cho mỗi request. Không phải hash payload — xem `buildTiktokExternalId`.
      idempotencyKey: externalId,
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
      // 🔴 Trường RIÊNG của TikTok — bảng size KHÔNG nằm trong `main_images`.
      ...(sizeChartUri ? { sizeChart: { image: { uri: sizeChartUri } } } : {}),
      // Video nhận **ID** (không phải uri/URL) do `POST /product/202309/files/upload` cấp.
      ...(videoId ? { video: { id: videoId } } : {}),
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
    // 🔴 Hàng rào cuối cùng: giá không kèm tiền tệ là TikTok trả `36009004` sau khi đã tốn
    // cả lượt upload ảnh. Validator đã chặn từ trước; tới đây mà vẫn thiếu là payload cũ đóng
    // băng trước khi có luật — hỏng ngay tại chỗ với thông điệp rõ, không gửi.
    if ((variant.salePrice || variant.retailPrice) && !currency) {
      throw new PodPublishPayloadException(
        `Biến thể "${variant.sellerSku}" có giá nhưng thiếu tiền tệ — kiểm tra Market/Shop của lượt đăng rồi tạo lại nháp.`,
      );
    }
    // Ảnh biến thể gắn vào TRỤC ĐẦU TIÊN (thường là Color) — TikTok chỉ hiển thị ảnh của
    // một trục, gắn vào cả hai trục là ảnh nhảy loạn khi người mua đổi size.
    const variantUri = variant.imageFileId
      ? uriByFileId.get(variant.imageFileId)
      : variant.imageUrl
        ? uriByFileId.get(variant.imageUrl)
        : undefined;

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

/**
 * Tóm tắt SKU cho log — `seller_sku → giá tiền tệ → tồn`. Chỉ dữ liệu nghiệp vụ, không token.
 * Cắt ở 20 dòng: log là để đọc, một sản phẩm 600 SKU thì 20 dòng đầu đủ để thấy sai ở đâu.
 */
function summarizeSkus(request: TiktokCreateProductRequest): string[] {
  const skus = request.skus ?? [];
  const lines = skus
    .slice(0, 20)
    .map(
      (sku) =>
        `${sku.sellerSku ?? '?'} -> ${sku.price?.amount ?? '?'} ${sku.price?.currency ?? 'NO_CURRENCY'} -> qty ${sku.inventory?.[0]?.quantity ?? '?'}`,
    );
  return skus.length > 20 ? [...lines, `… (+${skus.length - 20} SKU)`] : lines;
}

/** Tiền tệ đang gửi — một mã, hoặc danh sách nếu (sai) có nhiều mã, hoặc `NONE`. */
function summarizeCurrencies(request: TiktokCreateProductRequest): string {
  const codes = new Set(
    (request.skus ?? []).map((sku) => sku.price?.currency ?? 'NONE'),
  );
  return codes.size === 0 ? 'NONE' : [...codes].join(',');
}

/**
 * Ảnh trong mô tả CỦA REQUEST sắp gửi — số lượng + host, KHÔNG có URL đầy đủ. Đây là bằng chứng
 * cuối cùng trước SDK: mọi host phải là host TikTok, không còn host Storage/CDN của ta.
 */
function summarizeDescriptionImages(description: string): { count: number; hosts: string[] } {
  const refs = extractDescriptionImages(description);
  return { count: refs.length, hosts: [...new Set(refs.map((ref) => hostnameOf(ref.src)))] };
}
