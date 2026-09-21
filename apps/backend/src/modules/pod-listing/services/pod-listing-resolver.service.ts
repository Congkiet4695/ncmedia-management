import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PodBrandMode,
  PodImageAssetType,
  PodListingSessionImageType,
  PodPriceAdjustmentType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { POD_TIKTOK_NO_BRAND_NAME } from '../../pod-product/constants/pod-product.constants';
import { POD_DRAFT_ISSUE_CODES, POD_LISTING_MAX_IMAGES } from '../constants/pod-listing.constants';
import { calculatePricing } from './pod-pricing.calculator';
import { resolveSkuItemPrice } from './pod-sku-price';
import { applyTokens } from './pod-token.engine';
import { IMAGE_TEMPLATE_INCLUDE } from './pod-image-template.service';
import { applyManualOverride, parseManualOverride } from './pod-manual-listing';
import { resolveListingCurrency } from './pod-market-currency';
import type { ListingTemplateFull } from './pod-listing-template.service';

/** Lỗi/cảnh báo phát hiện khi giải template. ERROR ⇒ draft chưa thể publish ở Sprint 4. */
export interface ResolveIssue {
  level: 'ERROR' | 'WARNING';
  field: string;
  code: string;
  message: string;
}

/** Một biến thể (SKU) trong listing đã giải. */
export interface ResolvedVariant {
  variantName: string;
  sellerSku: string;
  barcode: string | null;
  optionValues: Array<{ name: string; value: string }>;
  /** Giá bán thực tế (TikTok `sale_price`). */
  salePrice: string | null;
  /** Giá gốc hiển thị gạch ngang (TikTok `original_price`). */
  retailPrice: string | null;
  currency: string | null;
  quantity: number;
  imageFileId: string | null;
  sortOrder: number;
}

/**
 * **Hợp đồng với Sprint 4.**
 *
 * Toàn bộ nội dung một listing sau khi áp template, ở dạng trung lập với đầu ra:
 * Sprint 4 chỉ việc ánh xạ sang payload của Create Product rồi gọi SDK — không cần
 * đọc lại template, không cần sửa schema.
 */
export interface ResolvedListing {
  market: string;
  title: string;
  description: string;
  /**
   * Từ khoá tìm kiếm (TikTok `search_terms`) và Product Highlights (`key_product_features`).
   *
   * 🔴 Optional, KHÔNG phải `[]`: chúng chỉ đến từ dữ liệu nhập tay (Custom Listing), còn
   * payload đã đóng băng của các draft cũ không có trường này — thêm vào với giá trị mặc định
   * sẽ đổi `payloadHash` của mọi draft và hệ thống tưởng tất cả đều vừa thay đổi nội dung.
   */
  searchTerms?: string[];
  highlights?: string[];

  category: { tiktokCategoryId: string | null; name: string | null; path: string | null };
  /**
   * Thương hiệu đã quyết. `mode` là câu trả lời, `tiktokBrandId` chỉ có nghĩa khi
   * `mode = SPECIFIC`.
   *
   * 🔴 `mode` là optional vì payload đã ĐÓNG BĂNG trước khi sửa lỗi không có trường này.
   * Nơi đọc phải coi `undefined` là "payload cũ" và suy ra ý định từ `tiktokBrandId` —
   * xem `PodListingPublisherService.resolveBrandId`.
   */
  brand: { mode?: PodBrandMode; tiktokBrandId: string | null; name: string | null };
  attributes: Array<{
    tiktokAttributeId: string;
    name: string | null;
    /** PRODUCT_PROPERTY / SALES_PROPERTY — Sprint 4 cần để xếp đúng nhánh payload. */
    type: string | null;
    isRequired: boolean;
    values: Array<{ id?: string; name?: string }>;
    /**
     * Giá trị người dùng tự nhập. Với TikTok chúng cũng chỉ là `{ name }` không kèm `id` —
     * bộ dựng payload KHÔNG phân biệt official hay custom, đúng như yêu cầu.
     */
    customValues: string[];
  }>;

  /**
   * Bộ ảnh lấy NGUYÊN từ Image Template — ảnh mockup cố định của phôi, không phải ảnh
   * sản phẩm và không cần upload lại cho từng listing.
   */
  images: Array<{
    title: string;
    assetType: PodImageAssetType;
    fileId: string;
    url: string;
    imageKey: string;
    width: number | null;
    height: number | null;
    isRequired: boolean;
    /** `uri` phía TikTok sau lần upload đầu — hàng nghìn listing sau dùng lại. */
    tiktokImageUri: string | null;
    sortOrder: number;
  }>;

  /**
   * Bảng size — TikTok nhận ở trường RIÊNG (`size_chart.image.uri`), KHÔNG phải ảnh sản phẩm.
   *
   * 🔴 Tách khỏi `images` là bắt buộc: `ensureImageUris` đẩy nguyên mảng `images` thành
   * `main_images`, nên để lẫn vào đó là bảng size xuất hiện giữa bộ ảnh sản phẩm trên trang
   * bán hàng — người mua thấy một tấm bảng số đo ở vị trí ảnh thứ hai.
   */
  sizeChart: { fileId: string | null; url: string | null; tiktokImageUri: string | null } | null;

  /**
   * Video sản phẩm. TikTok nhận `video: { id }` — **ID do TikTok cấp** sau khi upload file,
   * không phải URL. Xem `TiktokProductApiService.uploadFile`.
   */
  video: { fileId: string | null; url: string | null; tiktokVideoId: string | null } | null;

  package: {
    weight: string | null;
    weightUnit: string | null;
    length: string | null;
    width: string | null;
    height: string | null;
    dimensionUnit: string | null;
  };

  /**
   * Kho **gợi ý mặc định** từ Listing/Category Template — có thể NULL.
   *
   * 🔴 Không phải kho cuối cùng: `PodListingPublisherService` quyết kho theo từng shop ngay
   * trước khi gọi Create Product. Kho là dữ liệu của shop, không phải của sản phẩm.
   */
  warehouse: { id: string | null; tiktokWarehouseId: string | null; name: string | null };
  shipping: { shippingTemplateId: string | null; handlingDays: number | null };

  pricing: {
    strategyId: string | null;
    strategyName: string | null;
    currency: string | null;
    /** Giá bán thực tế tính từ chiến lược giá. */
    salePrice: string | null;
    /** Giá gốc gạch ngang. */
    retailPrice: string | null;
    /** Giá sau khuyến mãi mặc định của chiến lược. */
    finalPrice: string | null;
  } | null;

  variants: ResolvedVariant[];

  source: {
    productId: string | null;
    /** Draft Product của Listing Session đã sinh ra listing này (nếu nguồn là import). */
    sessionProductId: string | null;
    tiktokProductId: string | null;
    shopId: string;
    listingTemplateId: string;
    imageTemplateId: string | null;
  };
}

/** Kết quả giải template — payload + danh sách vấn đề. */
export interface ResolveResult {
  payload: ResolvedListing;
  issues: ResolveIssue[];
  payloadHash: string;
}

/** Ngữ cảnh đầu vào (đã nạp sẵn để hàm resolve là hàm thuần, dễ test). */
export interface ResolveContext {
  template: ListingTemplateFull;
  /** Image Template ghi đè (Auto Listing). NULL = dùng của Listing Template. */
  imageTemplateOverride?: ListingTemplateFull['imageTemplate'];
  product: {
    id: string;
    tiktokProductId: string;
    title: string | null;
    description: string | null;
    categoryName: string | null;
    brandName: string | null;
    variants: Array<{ sellerSku: string | null; imageUrl: string | null }>;
    /** Ảnh chính của sản phẩm (`variantId = null`), đã sắp theo `sortOrder`. */
    images: Array<{ uri: string | null; url: string | null }>;
    videos: Array<{ url: string | null }>;
  } | null;
  /**
   * Draft Product trong Listing Session dùng làm nguồn nội dung (import từ Excel/CSV).
   *
   * 🔴 Nó chỉ mang **tiêu đề + ảnh gốc** — đúng hai thứ mà template không thể biết. Và đúng
   * hai thứ đó THẮNG: có ảnh riêng thì dùng ảnh riêng, bộ mockup của Image Template chỉ là
   * phương án dự bị. Mọi phần còn lại (mô tả, biến thể, giá, tồn, danh mục) đến từ template.
   */
  sessionProduct?: SessionProductSource | null;
  shop: { id: string; name: string; region: string };
}

/** Phần dữ liệu của Draft Product mà resolver cần. */
export type SessionProductSource = Prisma.PodListingSessionProductGetPayload<{
  include: typeof SESSION_PRODUCT_SOURCE_INCLUDE;
}>;

/** Ảnh gốc của Draft Product, đã sắp đúng thứ tự URL1 → URL10. */
export const SESSION_PRODUCT_SOURCE_INCLUDE = {
  images: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.PodListingSessionProductInclude;

/**
 * PodListingResolverService — Product + Listing Template ⇒ `ResolvedListing`.
 *
 * Đây là NƠI DUY NHẤT biết cách ghép template thành listing: cả **Preview** (không ghi DB)
 * lẫn **Generate Draft** (ghi DB) đều gọi hàm này ⇒ những gì người dùng xem trước đúng
 * bằng những gì được lưu, không có hai nhánh logic lệch nhau.
 *
 * Thay token trong tiêu đề/mô tả theo **danh sách trắng** — không eval, không cho phép
 * biểu thức tuỳ ý (dữ liệu người dùng nhập, chạy trên server đa tenant).
 */
@Injectable()
export class PodListingResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nạp dữ liệu cần thiết rồi giải. */
  async resolve(
    organizationId: string,
    params: {
      template: ListingTemplateFull;
      /** Nguồn 1: sản phẩm đã đồng bộ từ sàn. */
      productId: string | null;
      /** Nguồn 2: Draft Product của Listing Session. Đúng một trong hai. */
      sessionProductId?: string | null;
      shopId: string;
      imageTemplateId?: string | null;
    },
  ): Promise<ResolveResult> {
    const [product, sessionProduct, shop, imageOverride] = await Promise.all([
      params.productId
        ? this.prisma.podProduct.findFirst({
            where: { id: params.productId, organizationId, deletedAt: null },
            select: {
              id: true,
              tiktokProductId: true,
              title: true,
              description: true,
              categoryName: true,
              brandName: true,
              variants: {
                select: { sellerSku: true, imageUrl: true },
                orderBy: { createdAt: 'asc' },
              },
              // Ảnh CHÍNH của sản phẩm — dùng cho token mô tả, KHÔNG dùng cho bộ ảnh
              // (bộ ảnh listing lấy từ Image Template, là ảnh mockup của phôi).
              images: {
                where: { variantId: null },
                select: { uri: true, url: true },
                orderBy: { sortOrder: 'asc' },
              },
              videos: { select: { url: true }, orderBy: { createdAt: 'asc' } },
            },
          })
        : Promise.resolve(null),
      params.sessionProductId
        ? this.prisma.podListingSessionProduct.findFirst({
            where: { id: params.sessionProductId, organizationId, deletedAt: null },
            include: SESSION_PRODUCT_SOURCE_INCLUDE,
          })
        : Promise.resolve(null),
      this.prisma.podTiktokShop.findFirst({
        where: { id: params.shopId, organizationId, deletedAt: null },
        select: { id: true, name: true, region: true },
      }),
      params.imageTemplateId
        ? this.prisma.podImageTemplate.findFirst({
            where: { id: params.imageTemplateId, organizationId, deletedAt: null },
            include: IMAGE_TEMPLATE_INCLUDE,
          })
        : Promise.resolve(null),
    ]);

    if (!shop) {
      throw new Error('Shop không tồn tại trong tổ chức này');
    }

    return this.resolveFromContext({
      template: params.template,
      imageTemplateOverride: imageOverride,
      product,
      sessionProduct,
      shop,
    });
  }

  /** Giải từ ngữ cảnh đã nạp — tách riêng để unit test không cần database. */
  resolveFromContext(ctx: ResolveContext): ResolveResult {
    const issues: ResolveIssue[] = [];
    const { template, product, sessionProduct, shop } = ctx;

    const category = template.categoryTemplate;
    const imageTemplate = ctx.imageTemplateOverride ?? template.imageTemplate;

    // 🔴 Thứ tự ưu tiên nội dung: DRAFT PRODUCT (người dùng gõ) → Template → Product đã đồng bộ.
    const tokens = this.buildTokenValues(ctx);
    const title = applyTokens(sessionProduct?.title ?? product?.title ?? template.name, tokens);
    // Mô tả CHỈ đến từ Description Template (hoặc sản phẩm đã đồng bộ, với nguồn kia):
    // file import 11 cột không mang mô tả nào.
    const description = applyTokens(
      template.descriptionTemplate?.contentHtml || product?.description || '',
      tokens,
    );

    // --- Kiểm tra dữ liệu bắt buộc để Sprint 4 publish được ---
    if (!category?.tiktokCategoryId) {
      issues.push(
        this.error('category', POD_DRAFT_ISSUE_CODES.MISSING_CATEGORY, 'Chưa chọn danh mục TikTok'),
      );
    }
    if (!description.trim()) {
      issues.push(
        this.error(
          'description',
          POD_DRAFT_ISSUE_CODES.MISSING_DESCRIPTION,
          'Listing chưa có mô tả',
        ),
      );
    }
    for (const attribute of category?.attributes ?? []) {
      const hasValue = attribute.values.length > 0 || attribute.customValues.length > 0;
      if (attribute.isRequired && !hasValue) {
        issues.push(
          this.error(
            `attribute.${attribute.tiktokAttributeId}`,
            POD_DRAFT_ISSUE_CODES.MISSING_REQUIRED_ATTRIBUTE,
            `Thuộc tính bắt buộc "${attribute.attributeName ?? attribute.tiktokAttributeId}" chưa có giá trị`,
          ),
        );
      }
    }

    const images = this.resolveImages(imageTemplate, sessionProduct ?? null, issues);

    const pricing = this.resolvePricing(template);
    const variants = this.resolveVariants(ctx, pricing, issues);

    // Kho: Listing Template ghi đè Category Template — cùng một danh mục vẫn có thể xuất từ
    // hai kho khác nhau.
    //
    // 🔴 Đây chỉ là kho **GỢI Ý MẶC ĐỊNH**, và để trống là chuyện bình thường: kho thuộc về
    // SHOP chứ không thuộc về sản phẩm. Cùng một Draft đăng lên ba shop là ba kho khác nhau,
    // nên kho thật được quyết ở bước Publish theo từng shop. KHÔNG cảnh báo gì ở đây.
    const warehouse = template.warehouse ?? category?.warehouse ?? null;
    // Kiện hàng: Listing Template ghi đè Category Template. Cùng một danh mục nhưng phôi
    // khác nhau (tee vs hoodie) nặng khác nhau — ghi đè ở đây thay vì nhân bản Category
    // Template chỉ để đổi một con số.
    const packageInfo = {
      weight: template.packageWeight ?? category?.packageWeight ?? null,
      weightUnit: template.weightUnit ?? category?.weightUnit ?? null,
      length: template.packageLength ?? category?.packageLength ?? null,
      width: template.packageWidth ?? category?.packageWidth ?? null,
      height: template.packageHeight ?? category?.packageHeight ?? null,
      dimensionUnit: template.dimensionUnit ?? category?.dimensionUnit ?? null,
    };
    if (!packageInfo.weight) {
      issues.push(
        this.error(
          'package',
          POD_DRAFT_ISSUE_CODES.MISSING_PACKAGE,
          'Chưa có khối lượng kiện hàng',
        ),
      );
    }

    const payload: ResolvedListing = {
      market: template.market,
      title,
      description,
      category: {
        tiktokCategoryId: category?.tiktokCategoryId ?? null,
        name: category?.categoryName ?? null,
        path: category?.categoryPath ?? null,
      },
      brand: this.resolveBrand(template, category),
      attributes: (category?.attributes ?? []).map((attribute) => ({
        tiktokAttributeId: attribute.tiktokAttributeId,
        name: attribute.attributeName,
        type: attribute.attributeType,
        isRequired: attribute.isRequired,
        values: attribute.values.map((value) => ({
          id: value.tiktokValueId,
          name: value.valueName ?? undefined,
        })),
        customValues: attribute.customValues.map((custom) => custom.value),
      })),
      images,
      sizeChart: this.resolveSizeChart(sessionProduct ?? null, category, imageTemplate),
      // Video chỉ đến từ dữ liệu NHẬP TAY (xem `applyManualOverride`): template chưa có khái
      // niệm video, còn sản phẩm đã đồng bộ thì video thuộc về shop nguồn, không mang sang.
      video: null,
      package: packageInfo,
      warehouse: {
        id: warehouse?.id ?? null,
        tiktokWarehouseId: warehouse?.tiktokWarehouseId ?? null,
        name: warehouse?.name ?? null,
      },
      shipping: {
        shippingTemplateId: template.shippingTemplateId,
        handlingDays: template.handlingDays,
      },
      pricing: pricing
        ? {
            strategyId: template.pricingStrategy?.id ?? null,
            strategyName: template.pricingStrategy?.name ?? null,
            currency: pricing.currency,
            salePrice: pricing.salePrice.toString(),
            retailPrice: pricing.retailPrice.toString(),
            finalPrice: pricing.finalPrice.toString(),
          }
        : null,
      variants,
      source: {
        productId: product?.id ?? null,
        sessionProductId: sessionProduct?.id ?? null,
        tiktokProductId: product?.tiktokProductId ?? null,
        shopId: shop.id,
        listingTemplateId: template.id,
        imageTemplateId: imageTemplate?.id ?? null,
      },
    };

    // 🔴 Dữ liệu NHẬP TAY áp SAU CÙNG — nó là bậc cao nhất của đúng thứ tự ưu tiên đã ghi ở
    // đầu hàm (Draft Product → Template → Product đã đồng bộ). Áp ở đây chứ không rải vào
    // từng nhánh phía trên vì hai lý do:
    //
    //   1. Mọi thứ đi sau điểm này (validate, dựng payload, publish theo từng shop, retry)
    //      chỉ nhìn thấy `ResolvedListing` — nên nhập tay tự động chảy qua TOÀN BỘ Bulk
    //      Listing Engine mà không phải sửa một dòng nào ở đó.
    //   2. Luật "nhập tay thắng template" nằm gọn trong MỘT hàm thuần, kiểm được bằng unit
    //      test không cần database.
    const manual = applyManualOverride(
      payload,
      parseManualOverride(sessionProduct?.manualData ?? null),
      issues,
    );

    // 🔴 Tiền tệ chốt SAU CÙNG, theo SHOP đích (rồi thị trường). Đây là bước làm cho giá nhập
    // tay — vốn không đi qua Pricing/SKU Template nên không mang tiền tệ — có được
    // `price.currency` mà TikTok bắt buộc. Cũng là bước bảo đảm mẫu USD dùng nhầm cho shop UK
    // vẫn gửi GBP: tiền tệ là của shop, không phải của mẫu.
    const final = this.applyCurrency(manual, ctx, issues);

    // Hash tính trên payload CUỐI CÙNG: nó là khoá "nội dung có đổi không" của cả đường
    // publish. Băm bản trước khi áp nhập tay nghĩa là sửa giá xong hệ thống tưởng không có
    // gì thay đổi và bỏ qua lần gửi lại.
    return { payload: final, issues, payloadHash: this.hash(final) };
  }

  /**
   * Gán tiền tệ cho mọi giá trong listing: `variants[].currency` và `pricing.currency`.
   *
   * Thứ tự: region của shop → market của lượt → currency của mẫu (chỉ khi hai nguồn trên không
   * tra được). Mẫu khai tiền tệ KHÁC tiền tệ của shop ⇒ vẫn dùng của shop và cảnh báo — gửi
   * GBP lên shop US là TikTok từ chối, không phải "tôn trọng cấu hình".
   */
  private applyCurrency(
    payload: ResolvedListing,
    ctx: ResolveContext,
    issues: ResolveIssue[],
  ): ResolvedListing {
    const templateCurrency =
      payload.pricing?.currency ?? ctx.template.skuTemplate?.currency ?? null;
    const resolved = resolveListingCurrency({
      shopRegion: ctx.shop.region,
      market: ctx.template.market,
      fallback: templateCurrency,
    });

    if (!resolved.currency) {
      if (payload.variants.some((variant) => variant.salePrice || variant.retailPrice)) {
        issues.push(
          this.error(
            'variants.currency',
            POD_DRAFT_ISSUE_CODES.MISSING_CURRENCY,
            `Không xác định được tiền tệ cho shop "${ctx.shop.name}" (vùng ${ctx.shop.region}, thị trường ${ctx.template.market}).`,
          ),
        );
      }
      return payload;
    }

    const mismatched = new Set(
      [templateCurrency, ...payload.variants.map((variant) => variant.currency)]
        .filter((currency): currency is string => Boolean(currency))
        .map((currency) => currency.toUpperCase())
        .filter((currency) => currency !== resolved.currency),
    );
    if (mismatched.size > 0) {
      issues.push(
        this.warning(
          'variants.currency',
          POD_DRAFT_ISSUE_CODES.CURRENCY_MISMATCH,
          `Mẫu khai tiền tệ ${[...mismatched].join(', ')} nhưng shop "${ctx.shop.name}" dùng ${resolved.currency} — listing sẽ gửi ${resolved.currency}.`,
        ),
      );
    }

    return {
      ...payload,
      pricing: payload.pricing ? { ...payload.pricing, currency: resolved.currency } : null,
      variants: payload.variants.map((variant) => ({ ...variant, currency: resolved.currency })),
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Lấy bộ ảnh của Image Template.
   *
   * 🔴 Ảnh mockup là ảnh CỐ ĐỊNH của phôi: cùng một bộ dùng cho hàng nghìn listing, không
   * lấy từ ảnh sản phẩm và không phải upload lại cho từng listing. Ở đây chỉ việc chép
   * nguyên bộ theo đúng thứ tự người dùng đã kéo thả.
   */
  /**
   * Chốt thương hiệu cho listing: **Listing Template thắng Category Template**.
   *
   * 🔴 "Thắng" ở đây tính theo `brandMode`, KHÔNG tính theo `tiktokBrandId` có null hay
   * không. Đó là điểm khác biệt quan trọng: một Listing Template chọn "No brand" có
   * `tiktokBrandId = NULL`, và nếu vẫn dùng `??` như trước thì nó sẽ rơi xuống lấy brand của
   * Category Template — đúng kiểu bug âm thầm gán một thương hiệu người dùng không chọn.
   *
   * `UNSET` = "tôi không ý kiến" ⇒ nhường cho Category Template.
   */
  private resolveBrand(
    template: { brandMode: PodBrandMode; tiktokBrandId: string | null; brandName: string | null },
    category: { brandMode: PodBrandMode; tiktokBrandId: string | null; brandName: string | null } | null | undefined,
  ): ResolvedListing['brand'] {
    const source =
      template.brandMode !== PodBrandMode.UNSET ? template : (category ?? template);

    if (source.brandMode === PodBrandMode.NONE) {
      return { mode: PodBrandMode.NONE, tiktokBrandId: null, name: POD_TIKTOK_NO_BRAND_NAME };
    }
    if (source.brandMode === PodBrandMode.SPECIFIC && source.tiktokBrandId) {
      return {
        mode: PodBrandMode.SPECIFIC,
        tiktokBrandId: source.tiktokBrandId,
        name: source.brandName ?? null,
      };
    }
    return { mode: PodBrandMode.UNSET, tiktokBrandId: null, name: null };
  }

  /**
   * Bộ ảnh sản phẩm = ảnh RIÊNG của Draft Product (giữ nguyên thứ tự) + ảnh của Image Template
   * **bổ sung vào sau** cho đủ `POD_LISTING_MAX_IMAGES`.
   *
   * 🔴 Trước đây là "hoặc/hoặc": có một tấm ảnh riêng là bộ mockup bị bỏ hẳn, sản phẩm nhập
   * từ file với 3 ảnh lên sàn với đúng 3 ảnh dù người vận hành đã dựng sẵn bộ 6 mockup. Nay:
   *
   *   - Ảnh người dùng đưa lên KHÔNG bao giờ bị ghi đè hay đổi chỗ — chúng đứng đầu.
   *   - Chỉ lấy đúng số ảnh mẫu còn thiếu; đủ `POD_LISTING_MAX_IMAGES` thì không thêm gì.
   *   - Một tấm đã có (cùng `fileId` hoặc cùng URL) không được đưa vào lần hai — Custom
   *     Listing đã dán sẵn bộ mockup vào ảnh sản phẩm nên bước này phải idempotent.
   *   - Bảng size và ảnh trong mô tả KHÔNG thuộc bộ ảnh (`main_images`): tấm `SIZE_CHART` của
   *     Image Template đi sang `resolveSizeChart`, không chen vào giữa bộ ảnh bán hàng.
   *
   * Ảnh riêng KHÔNG bị cắt ở đây (validator vẫn cảnh báo "quá 9 tấm" và publisher cắt đúng
   * thứ tự) — chỉ phần bổ sung là được tính cho vừa chỗ trống.
   */
  private resolveImages(
    imageTemplate: ListingTemplateFull['imageTemplate'],
    sessionProduct: SessionProductSource | null,
    issues: ResolveIssue[],
  ): ResolvedListing['images'] {
    const ownImages = (sessionProduct?.images ?? [])
      .filter((image) => image.imageUrl && !NON_GALLERY_IMAGE_TYPES.has(image.imageType))
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .map((image, index) => ({
        title: `${image.imageType} #${index + 1}`,
        assetType: SESSION_IMAGE_ASSET_TYPE[image.imageType],
        fileId: image.fileId ?? '',
        url: image.imageUrl,
        imageKey: '',
        width: null,
        height: null,
        isRequired: index === 0,
        tiktokImageUri: image.remoteUri,
        sortOrder: index,
      }));

    const templateImages = (imageTemplate?.items ?? [])
      .filter((item) => item.assetType !== PodImageAssetType.SIZE_CHART)
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((item) => ({
        title: item.title,
        assetType: item.assetType,
        fileId: item.fileId,
        url: item.imageUrl,
        imageKey: item.imageKey,
        width: item.width,
        height: item.height,
        isRequired: item.isRequired,
        tiktokImageUri: item.tiktokImageUri,
        sortOrder: 0,
      }));

    const seen = new Set<string>();
    const images: ResolvedListing['images'] = [];
    const remember = (image: { fileId: string; url: string }) => {
      if (image.fileId) seen.add(`file:${image.fileId}`);
      if (image.url) seen.add(`url:${canonicalImageUrl(image.url)}`);
    };
    const isDuplicate = (image: { fileId: string; url: string }) =>
      (image.fileId !== '' && seen.has(`file:${image.fileId}`)) ||
      (image.url !== '' && seen.has(`url:${canonicalImageUrl(image.url)}`));

    for (const image of ownImages) {
      // Ảnh riêng trùng nhau (người dùng dán hai lần) cũng chỉ giữ một — TikTok không nhận
      // hai tấm giống hệt và đó cũng không phải điều người dùng muốn.
      if (isDuplicate(image)) continue;
      remember(image);
      images.push(image);
    }

    for (const image of templateImages) {
      if (images.length >= POD_LISTING_MAX_IMAGES) break;
      if (isDuplicate(image)) continue;
      remember(image);
      images.push(image);
    }

    if (images.length === 0) {
      issues.push(
        this.error('images', POD_DRAFT_ISSUE_CODES.MISSING_IMAGE, 'Bộ ảnh chưa có tấm nào'),
      );
      return [];
    }

    // Đánh lại thứ tự liên tiếp: ảnh riêng giữ nguyên thứ tự người dùng, ảnh mẫu nối tiếp sau.
    return images.map((image, index) => ({ ...image, sortOrder: index, isRequired: index === 0 }));
  }

  /** Giá từ Pricing Strategy. Không có strategy ⇒ dùng giá nhập tay ở SKU Template. */
  private resolvePricing(template: ListingTemplateFull) {
    const strategy = template.pricingStrategy;
    if (!strategy) return null;

    return calculatePricing({
      cost: strategy.cost,
      shippingCost: strategy.shippingCost,
      markupType: strategy.markupType,
      markupValue: strategy.markupValue,
      formula: strategy.formula,
      retailPriceMultiplier: strategy.retailPriceMultiplier,
      discountPercent: strategy.discountPercent,
      roundingIncrement: strategy.roundingIncrement,
      currency: strategy.currency,
    });
  }

  /**
   * Sinh biến thể (SKU) cho listing từ các tổ hợp của SKU Template.
   *
   * Thứ tự ưu tiên giá, từ mạnh xuống yếu:
   *
   * 1. **Giá tuyệt đối** của tổ hợp (nếu người dùng cố tình đặt cứng)
   * 2. **Giá của Pricing Template** rồi cộng **điều chỉnh theo biến thể** (`+2.00`, `+10%`)
   * 3. Giá mặc định của SKU Template
   *
   * Bước 2 là thứ làm SKU Template dùng chung được: quy tắc "XXL cộng thêm 2" đúng với mọi
   * sản phẩm, còn "XXL giá 26.99" thì chỉ đúng với đúng một sản phẩm.
   */
  /**
   * Bảng size — TikTok nhận ĐÚNG MỘT tấm, ở trường riêng `size_chart.image.uri`.
   *
   * Thứ tự ưu tiên (dữ liệu cụ thể hơn thắng):
   *   1. Tấm `SIZE_CHART` của chính Draft Product (Custom Listing chọn tay / file import).
   *   2. `sizeChartFileId` của Category Template — chỗ người vận hành cấu hình bảng size cho
   *      cả danh mục. 🔴 Trước đây trường này được LƯU nhưng không ai ĐỌC: Auto Listing từ
   *      CSV/XLSX (chỉ có ảnh `MAIN`) lên sàn mà không có bảng size dù template có.
   *   3. Tấm `SIZE_CHART` trong Image Template (mockup kèm bảng size của phôi).
   *
   * Nhiều hơn một tấm ở cùng một nguồn ⇒ lấy tấm đầu; phần sau là dữ liệu thừa, không phải sai.
   */
  private resolveSizeChart(
    sessionProduct: SessionProductSource | null,
    category: ListingTemplateFull['categoryTemplate'],
    imageTemplate: ListingTemplateFull['imageTemplate'],
  ): ResolvedListing['sizeChart'] {
    const own = (sessionProduct?.images ?? []).find(
      (image) => image.imageType === PodListingSessionImageType.SIZE_CHART && image.imageUrl,
    );
    if (own) return { fileId: own.fileId, url: own.imageUrl, tiktokImageUri: own.remoteUri };

    if (category?.sizeChartFileId) {
      // File nằm trong Storage Module: publisher tải bytes theo `fileId`, không cần URL.
      return { fileId: category.sizeChartFileId, url: null, tiktokImageUri: null };
    }

    const templateChart = (imageTemplate?.items ?? [])
      .filter((item) => item.assetType === PodImageAssetType.SIZE_CHART)
      .sort((left, right) => left.displayOrder - right.displayOrder)[0];
    if (templateChart) {
      // `tiktokImageUri` của item là uri theo use case MAIN_IMAGE — KHÔNG dùng được cho bảng
      // size (khác use case ⇒ khác uri). Để null cho publisher upload đúng SIZE_CHART_IMAGE.
      return { fileId: templateChart.fileId, url: templateChart.imageUrl, tiktokImageUri: null };
    }

    return null;
  }

  private resolveVariants(
    ctx: ResolveContext,
    pricing: ReturnType<typeof calculatePricing> | null,
    issues: ResolveIssue[],
  ): ResolvedVariant[] {
    const skuTemplate = ctx.template.skuTemplate;
    const active = (skuTemplate?.items ?? []).filter((item) => item.isActive);

    if (active.length === 0) {
      issues.push(
        this.error(
          'variants',
          POD_DRAFT_ISSUE_CODES.MISSING_VARIANT,
          'Listing chưa có biến thể nào',
        ),
      );
      return [];
    }

    const prefix = skuTemplate?.skuPrefix?.trim() ?? '';
    const suffix = skuTemplate?.skuSuffix?.trim() ?? '';
    const productKey = ctx.product?.tiktokProductId ?? ctx.template.name;

    const variants = active.map((item, index) => {
      // 🔴 Giá của TỔ HỢP thắng trước: `salePrice` khai tường minh, hoặc `retailPrice` (±
      // `discount`). Quy tắc nằm ở MỘT chỗ duy nhất — `resolveSkuItemPrice` — để lưới SKU,
      // cổng validate và payload gửi TikTok không bao giờ nói ba con số khác nhau.
      //
      // Ô giá để trống trên lưới từng được ghi xuống `0`; hàm đó coi `0` là CHƯA ĐẶT nên
      // những dòng như "Retail 19.99, giảm 30%" ra đúng 13.99 thay vì bị chặn vì "giá 0".
      const own = resolveSkuItemPrice(item);
      const fallbackSale = this.adjust(
        pricing?.salePrice ?? skuTemplate?.defaultSalePrice ?? null,
        item,
      );
      const fallbackRetail = this.adjust(
        pricing?.retailPrice ?? skuTemplate?.defaultRetailPrice ?? null,
        item,
      );

      const sale = own.salePrice ?? fallbackSale;
      const retail = own.salePrice ? own.retailPrice : fallbackRetail;

      if (sale === null) {
        issues.push(
          this.error(
            `variant.${item.variantName}`,
            POD_DRAFT_ISSUE_CODES.MISSING_PRICE,
            `Biến thể "${item.variantName}" chưa có giá bán`,
          ),
        );
      }

      return {
        variantName: item.variantName,
        // Mã SKU: {prefix}-{mã sản phẩm}-{mã tổ hợp}{-suffix} — bỏ đoạn rỗng để không có "--".
        sellerSku: [prefix, this.slug(productKey), item.skuCode ?? this.slug(item.variantName)]
          .filter(Boolean)
          .join('-')
          .concat(suffix ? `-${suffix}` : ''),
        barcode: item.barcode,
        // Giá trị trục đọc từ BẢNG NỐI, sắp theo đúng thứ tự trục người dùng đã đặt.
        optionValues: [...item.values]
          .sort((a, b) => a.variantValue.variant.sortOrder - b.variantValue.variant.sortOrder)
          .map((link) => ({
            name: link.variantValue.variant.name,
            value: link.variantValue.value,
          })),
        salePrice: sale?.toString() ?? null,
        retailPrice: retail?.toString() ?? null,
        currency: pricing?.currency ?? skuTemplate?.currency ?? null,
        quantity: item.quantity,
        imageFileId: item.imageFileId,
        sortOrder: item.sortOrder ?? index,
      };
    });

    // Mã SKU trùng nhau sẽ bị TikTok từ chối cả sản phẩm ⇒ bắt tại đây cho rõ nguyên nhân.
    const duplicates = variants
      .map((variant) => variant.sellerSku)
      .filter((sku, index, all) => all.indexOf(sku) !== index);
    for (const sku of new Set(duplicates)) {
      issues.push(
        this.error('variants', POD_DRAFT_ISSUE_CODES.MISSING_VARIANT, `Mã SKU bị trùng: ${sku}`),
      );
    }

    return variants;
  }

  /**
   * Giá trị cho token: token HỆ THỐNG (danh sách trắng, lấy từ sản phẩm/shop/template)
   * cộng với token NGƯỜI DÙNG tự đặt trong Description Template.
   *
   * Token người dùng đứng sau nên không đè được lên token hệ thống — mà việc đó cũng đã
   * bị chặn từ lúc lưu template.
   */
  private buildTokenValues(ctx: ResolveContext): Record<string, string> {
    const custom = Object.fromEntries(
      (ctx.template.descriptionTemplate?.tokens ?? []).map((token) => [token.code, token.value]),
    );

    return {
      ...custom,
      'PRODUCT.TITLE': ctx.sessionProduct?.title ?? ctx.product?.title ?? '',
      'PRODUCT.DESCRIPTION': ctx.product?.description ?? '',
      'PRODUCT.SELLER_SKU': ctx.product?.variants?.[0]?.sellerSku ?? '',
      'PRODUCT.CATEGORY': ctx.product?.categoryName ?? '',
      'PRODUCT.BRAND': ctx.product?.brandName ?? '',
      'SHOP.NAME': ctx.shop.name,
      'TEMPLATE.NAME': ctx.template.name,
      'VARIANT.NAME': '',
    };
  }

  /**
   * Áp điều chỉnh giá của một biến thể lên giá do Pricing Template tính ra.
   *
   * Không cho ra giá âm: một quy tắc giảm quá tay (vd `-50` trên giá 20) mà sinh giá âm thì
   * TikTok từ chối cả sản phẩm, còn ở đây kẹp về 0 để lỗi hiện ra ở bước kiểm tra giá.
   */
  private adjust(
    base: Prisma.Decimal | null,
    item: { priceAdjustmentType: PodPriceAdjustmentType; priceAdjustmentValue: Prisma.Decimal },
  ): Prisma.Decimal | null {
    if (base === null || item.priceAdjustmentType === PodPriceAdjustmentType.NONE) return base;

    const adjusted =
      item.priceAdjustmentType === PodPriceAdjustmentType.AMOUNT
        ? base.plus(item.priceAdjustmentValue)
        : base.times(new Prisma.Decimal(1).plus(item.priceAdjustmentValue.dividedBy(100)));

    const clamped = adjusted.lessThan(0) ? new Prisma.Decimal(0) : adjusted;
    return new Prisma.Decimal(clamped.toFixed(2));
  }

  private slug(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .slice(0, 24)
      .toUpperCase();
  }

  private error(field: string, code: string, message: string): ResolveIssue {
    return { level: 'ERROR', field, code, message };
  }

  private warning(field: string, code: string, message: string): ResolveIssue {
    return { level: 'WARNING', field, code, message };
  }

  private hash(payload: ResolvedListing): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}

/**
 * Loại ảnh KHÔNG thuộc bộ ảnh sản phẩm (`main_images`).
 *
 * Bảng size có trường riêng của TikTok; ảnh chèn trong mô tả đã nằm sẵn trong HTML mô tả nên
 * đưa lại vào bộ ảnh là hiển thị trùng.
 */
const NON_GALLERY_IMAGE_TYPES = new Set<PodListingSessionImageType>([
  PodListingSessionImageType.SIZE_CHART,
  PodListingSessionImageType.DESCRIPTION,
]);

/**
 * Khoá so trùng theo URL: bỏ khoảng trắng thừa và phân mảnh (`#…`) — hai URL chỉ khác vậy là
 * cùng một tấm. KHÔNG hạ chữ thường phần đường dẫn: object key trên R2 phân biệt hoa/thường.
 */
function canonicalImageUrl(url: string): string {
  const trimmed = url.trim();
  const hashIndex = trimmed.indexOf('#');
  return hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
}

/** Ảnh của Draft Product ánh xạ sang vai trò ảnh của listing. */
const SESSION_IMAGE_ASSET_TYPE: Record<PodListingSessionImageType, PodImageAssetType> = {
  MAIN: PodImageAssetType.MAIN_FRONT,
  VARIANT: PodImageAssetType.DETAIL,
  DESCRIPTION: PodImageAssetType.LIFESTYLE,
  SIZE_CHART: PodImageAssetType.SIZE_CHART,
};

/** Kiểu Json cho Prisma khi lưu payload/issues. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
