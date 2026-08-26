import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PodListingPayloadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { shopScopeFilter } from '../../pod-tiktok/shared/shop-scope';
import { POD_PUBLISHABLE_PAYLOAD_STATUSES } from '../constants/pod-listing.constants';
import { PodListingPublisherService } from './pod-listing-publisher.service';
import type {
  GenerateListingPayloadDto,
  PodListingPayloadQueryDto,
  PreviewListingPayloadDto,
} from '../dto/pod-listing-payload.dto';
import {
  PodListingResolverService,
  toJson,
  type ResolveIssue,
  type ResolveResult,
} from './pod-listing-resolver.service';
import {
  PodListingTemplateService,
  type ListingTemplateFull,
} from './pod-listing-template.service';

export class PodListingPayloadNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_LISTING_PAYLOAD_NOT_FOUND', message: 'Không tìm thấy Draft Listing' });
  }
}

/** Kết quả một lần sinh hàng loạt. */
export interface GeneratePayloadResult {
  created: number;
  updated: number;
  failed: number;
  /** Số draft còn lỗi ERROR ⇒ Sprint 4 chưa publish được. */
  withErrors: number;
  drafts: Array<{
    draftId: string | null;
    productId: string;
    shopId: string;
    status: PodListingPayloadStatus | 'FAILED_TO_GENERATE';
    errorCount: number;
    message?: string;
  }>;
}

/**
 * PodListingPayloadService — Draft Generator.
 *
 * ```
 *   Products × Shops × Listing Template  ─▶  ResolvedListing  ─▶  pod_draft_listings
 * ```
 *
 * 🔴 Sprint 3 KHÔNG publish: không gọi Create Product, không upload ảnh lên TikTok.
 * Draft nằm yên trong DB; Sprint 4 đọc `payload` để dựng request TikTok.
 *
 * Sinh lại cùng (shop, product, template) là **ghi đè** bản cũ (unique key) — người dùng
 * sửa template rồi generate lại sẽ không tạo ra hàng loạt bản trùng.
 */
@Injectable()
export class PodListingPayloadService {
  private readonly logger = new Logger(PodListingPayloadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PodListingResolverService,
    private readonly listingTemplates: PodListingTemplateService,
    /** Chỉ dùng cho "xoá luôn Draft trên TikTok" — không có vòng phụ thuộc: publisher không
     * biết gì về service này. */
    private readonly publisher: PodListingPublisherService,
    private readonly accessScope: PodAccessScopeService,
  ) {}

  /** Xem trước — KHÔNG ghi bất cứ thứ gì vào database. */
  async preview(organizationId: string, dto: PreviewListingPayloadDto): Promise<ResolveResult> {
    const template = await this.listingTemplates.get(organizationId, dto.listingTemplateId);
    return this.resolver.resolve(organizationId, {
      template,
      productId: dto.productId,
      shopId: dto.shopId,
      imageTemplateId: dto.imageTemplateId,
    });
  }

  /** Sinh draft cho N sản phẩm × M shop. */
  async generate(
    organizationId: string,
    userId: string,
    dto: GenerateListingPayloadDto,
    scope: PodAccessScope,
  ): Promise<GeneratePayloadResult> {
    // 🔴 Chặn TRƯỚC khi sinh draft: dropdown shop ở giao diện đã lọc, nhưng client tự gửi
    // `shopIds` thì chỉ chỗ này chặn được.
    for (const shopId of dto.shopIds) this.accessScope.assertShopAllowed(scope, shopId);
    const baseTemplate = await this.listingTemplates.get(organizationId, dto.listingTemplateId);

    // Nạp trước các shop hợp lệ: shop lạ trong danh sách phải bị chặn NGAY,
    // không để lọt vào vòng lặp rồi sinh draft cho tenant khác.
    const shops = await this.prisma.podTiktokShop.findMany({
      where: { id: { in: dto.shopIds }, organizationId, deletedAt: null },
      select: { id: true, accountId: true, name: true },
    });
    if (shops.length !== dto.shopIds.length) {
      throw new BadRequestException({
        code: 'POD_PAYLOAD_INVALID_SHOP',
        message: 'Có shop không tồn tại hoặc không thuộc tổ chức này.',
      });
    }

    const products = await this.prisma.podProduct.findMany({
      where: { id: { in: dto.productIds }, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (products.length !== dto.productIds.length) {
      throw new BadRequestException({
        code: 'POD_PAYLOAD_INVALID_PRODUCT',
        message: 'Có sản phẩm không tồn tại hoặc không thuộc tổ chức này.',
      });
    }

    const overrides = new Map(dto.overrides?.map((item) => [item.productId, item]) ?? []);
    const result: GeneratePayloadResult = {
      created: 0,
      updated: 0,
      failed: 0,
      withErrors: 0,
      drafts: [],
    };

    for (const productId of dto.productIds) {
      const override = overrides.get(productId);
      // Template ghi đè theo sản phẩm (Auto Listing) — nạp một lần cho mọi shop.
      const template = override?.listingTemplateId
        ? await this.listingTemplates.get(organizationId, override.listingTemplateId)
        : baseTemplate;
      const imageTemplateId = override?.imageTemplateId ?? dto.imageTemplateId ?? null;

      for (const shop of shops) {
        try {
          const saved = await this.generateOne(organizationId, userId, {
            productId,
            shop,
            template,
            imageTemplateId,
          });

          if (saved.created) result.created += 1;
          else result.updated += 1;
          if (saved.errorCount > 0) result.withErrors += 1;

          result.drafts.push({
            draftId: saved.id,
            productId,
            shopId: shop.id,
            status: saved.status,
            errorCount: saved.errorCount,
          });
        } catch (error) {
          // Fail-soft: một cặp (sản phẩm, shop) hỏng không được làm hỏng cả lô.
          result.failed += 1;
          result.drafts.push({
            draftId: null,
            productId,
            shopId: shop.id,
            status: 'FAILED_TO_GENERATE',
            errorCount: 1,
            message: error instanceof Error ? error.message : 'Lỗi không xác định',
          });
          this.logger.error({
            module: 'pod-listing',
            operation: 'draft.generate.fail',
            organizationId,
            productId,
            shopId: shop.id,
            msg: error instanceof Error ? error.message : 'Lỗi không xác định',
          });
        }
      }
    }

    this.logger.log({
      module: 'pod-listing',
      operation: 'draft.generate',
      organizationId,
      listingTemplateId: dto.listingTemplateId,
      products: dto.productIds.length,
      shops: shops.length,
      created: result.created,
      updated: result.updated,
      withErrors: result.withErrors,
      failed: result.failed,
      msg: 'Đã sinh Draft Listing',
    });

    return result;
  }

  /**
   * Giải template rồi lưu draft cho MỘT cặp (sản phẩm × shop).
   *
   * Là đơn vị dùng chung của cả hai đường vào: nút "Generate" sinh hàng loạt tại chỗ, và
   * Bulk Listing Engine gọi cho từng item của job. Một đường code duy nhất ⇒ draft do job
   * tạo giống hệt draft do người dùng tạo tay.
   */
  async generateOne(
    organizationId: string,
    /** `null` khi chạy nền và người tạo job đã bị xoá — cột `created_by` cho phép trống. */
    userId: string | null,
    params: {
      /** Nguồn 1: sản phẩm đã đồng bộ từ sàn. */
      productId?: string | null;
      /** Nguồn 2: Draft Product trong Listing Session. Đúng một trong hai. */
      sessionProductId?: string | null;
      shop: { id: string; accountId: string };
      template: ListingTemplateFull;
      imageTemplateId: string | null;
    },
  ): Promise<{
    id: string;
    created: boolean;
    errorCount: number;
    status: PodListingPayloadStatus;
    resolved: ResolveResult;
  }> {
    const resolved = await this.resolver.resolve(organizationId, {
      template: params.template,
      productId: params.productId ?? null,
      sessionProductId: params.sessionProductId ?? null,
      shopId: params.shop.id,
      imageTemplateId: params.imageTemplateId,
    });

    const saved = await this.persist(organizationId, userId, {
      productId: params.productId ?? null,
      sessionProductId: params.sessionProductId ?? null,
      shop: params.shop,
      template: params.template,
      imageTemplateId: params.imageTemplateId,
      resolved,
    });

    return { ...saved, resolved };
  }

  async list(organizationId: string, query: PodListingPayloadQueryDto, scope: PodAccessScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PodListingPayloadWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      // 🔴 GIAO của phạm vi và bộ lọc người dùng chọn. Gán rồi ghi đè (`...scope` xong
      // `...query.shopId`) là lỗ hổng: `?shopId=<shop người khác>` sẽ thắng.
      shopId: shopScopeFilter(this.accessScope.shopFilter(scope)?.in, query.shopId),
      ...(query.listingTemplateId ? { listingTemplateId: query.listingTemplateId } : {}),
      ...(query.market ? { market: query.market } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.sessionId ? { sessionProduct: { sessionId: query.sessionId } } : {}),
      // "Chỉ hiện cái publish được" — dùng ĐÚNG bộ điều kiện mà `createPublishJob` dùng, nên
      // những gì màn hình cho chọn đúng bằng những gì server nhận. Hai danh sách lệch nhau
      // là cách chắc chắn nhất để nút Publish báo lỗi ngay sau khi người dùng bấm.
      ...(query.publishable
        ? { status: { in: [...POD_PUBLISHABLE_PAYLOAD_STATUSES] }, errorCount: 0 }
        : {}),
      ...(query.tiktokProductId ? { tiktokProductId: query.tiktokProductId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podListingPayload.findMany({
        where,
        include: {
          shop: { select: { id: true, name: true } },
          listingTemplate: { select: { id: true, name: true } },
          product: { select: { id: true, title: true, tiktokProductId: true } },
          // Thumbnail của màn hình Draft Listing = ảnh đầu tiên của Draft Product nguồn.
          sessionProduct: {
            select: {
              id: true,
              title: true,
              status: true,
              sessionId: true,
              images: {
                select: { imageUrl: true },
                orderBy: { sortOrder: 'asc' },
                take: 1,
              },
            },
          },
          _count: { select: { items: true } },
        },
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingPayload.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /**
   * Nạp một Draft Listing, ĐÃ kiểm phạm vi shop.
   *
   * 🔴 Cửa vào duy nhất — `remove` cũng đi qua đây, nên không có đường nào chạm tới draft
   * của shop khác mà bỏ qua phép kiểm này.
   */
  async get(organizationId: string, id: string, scope: PodAccessScope) {
    const draft = await this.prisma.podListingPayload.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        shop: { select: { id: true, name: true, region: true } },
        listingTemplate: { select: { id: true, name: true, market: true } },
        product: { select: { id: true, title: true, tiktokProductId: true } },
        sessionProduct: {
          select: {
            id: true,
            title: true,
            status: true,
            sessionId: true,
            images: { select: { imageUrl: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!draft) throw new PodListingPayloadNotFoundException();
    this.accessScope.assertShopAllowed(scope, draft.shopId);
    return draft;
  }

  /**
   * Xoá một Draft Listing.
   *
   * Mặc định chỉ xoá mềm bản ghi trong hệ thống. `remote = true` thì xoá **cả Draft trên
   * TikTok** — nếu không thì Seller Center còn lại một Draft mồ côi mà hệ thống không còn
   * biết tới, và người vận hành phải vào xoá tay từng cái.
   *
   * 🔴 Draft đang PUBLISHING không xoá được: nó đang ở giữa một lượt gửi. Draft đã PUBLISHED
   * cũng không — đó là bản ghi lịch sử của hàng đã lên sàn, còn việc gỡ hàng khỏi shop là
   * một hành động khác hẳn (Deactivate/Delete Product) và không nấp sau nút "bỏ draft".
   */
  async remove(
    organizationId: string,
    userId: string,
    id: string,
    scope: PodAccessScope,
    options: { remote?: boolean } = {},
  ): Promise<{ removedRemote: boolean }> {
    const draft = await this.get(organizationId, id, scope);
    if (draft.status === PodListingPayloadStatus.PUBLISHED) {
      throw new BadRequestException({
        code: 'POD_PAYLOAD_ALREADY_PUBLISHED',
        message: 'Draft đã publish lên TikTok — không xoá được bản ghi lịch sử này.',
      });
    }
    if (draft.status === PodListingPayloadStatus.PUBLISHING) {
      throw new BadRequestException({
        code: 'POD_PAYLOAD_PUBLISHING',
        message: 'Draft đang trong một lượt publish — chờ xong hoặc huỷ lượt chạy trước.',
      });
    }

    let removedRemote = false;
    if (options.remote && draft.tiktokDraftId) {
      // Xoá trên sàn TRƯỚC: xoá mềm ở hệ thống trước rồi TikTok từ chối là mất luôn đường
      // tìm lại Draft mồ côi đó.
      const ctx = await this.publisher.shopContext(organizationId, draft.shopId);
      await this.publisher.deleteRemoteProducts(ctx, [draft.tiktokDraftId]);
      removedRemote = true;
    }

    await this.prisma.podListingPayload.update({
      where: { id },
      data: { deletedAt: new Date(), status: PodListingPayloadStatus.ARCHIVED, updatedBy: userId },
    });

    return { removedRemote };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Ghi draft + biến thể trong MỘT transaction (upsert theo shop × product × template). */
  private async persist(
    organizationId: string,
    userId: string | null,
    input: {
      productId: string | null;
      sessionProductId: string | null;
      shop: { id: string; accountId: string };
      /// Chỉ cần `id`: thị trường lấy từ payload đã giải, không đọc lại template.
      /// `id` rỗng = template ghép trong bộ nhớ từ 5 mảnh của session (không có bản ghi thật).
      template: { id: string };
      imageTemplateId: string | null;
      resolved: ResolveResult;
    },
  ): Promise<{
    id: string;
    created: boolean;
    errorCount: number;
    status: PodListingPayloadStatus;
  }> {
    const { resolved } = input;
    const errorCount = resolved.issues.filter(
      (issue: ResolveIssue) => issue.level === 'ERROR',
    ).length;
    // Còn lỗi ⇒ giữ DRAFT. READY là tín hiệu cho Sprint 4 "được phép publish".
    const status = errorCount > 0 ? PodListingPayloadStatus.DRAFT : PodListingPayloadStatus.READY;

    // Template ghép trong bộ nhớ không có bản ghi thật ⇒ khoá ngoại phải để trống.
    const listingTemplateId = input.template.id || null;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.podListingPayload.findFirst({
        where: {
          shopId: input.shop.id,
          // Cùng nguồn + cùng shop ⇒ ghi đè bản cũ thay vì đẻ thêm bản trùng. Với nguồn là
          // sản phẩm đã đồng bộ, template cũng tham gia khoá: một sản phẩm có thể có nhiều
          // listing khác nhau trên cùng shop. Draft Product thì không — nó CHỈ thuộc về một
          // session, và session đã cố định bộ template rồi.
          ...(input.sessionProductId
            ? { sessionProductId: input.sessionProductId }
            : { productId: input.productId, listingTemplateId }),
        },
        select: { id: true },
      });

      const data = {
        market: resolved.payload.market as never,
        status,
        payload: toJson(resolved.payload),
        payloadHash: resolved.payloadHash,
        issues: toJson(resolved.issues),
        errorCount,
        title: resolved.payload.title.slice(0, 1024),
        variantCount: resolved.payload.variants.length,
        imageTemplateId: input.imageTemplateId,
      };

      const payload = existing
        ? await tx.podListingPayload.update({
            where: { id: existing.id },
            data: { ...data, deletedAt: null, updatedBy: userId },
            select: { id: true },
          })
        : await tx.podListingPayload.create({
            data: {
              ...data,
              organizationId,
              productId: input.productId,
              sessionProductId: input.sessionProductId,
              shopId: input.shop.id,
              accountId: input.shop.accountId,
              listingTemplateId,
              createdBy: userId,
            },
            select: { id: true },
          });

      // Biến thể: ghi lại trọn bộ — template đổi thì tập biến thể đổi hoàn toàn.
      await tx.podListingPayloadItem.deleteMany({ where: { payloadId: payload.id } });
      if (resolved.payload.variants.length > 0) {
        await tx.podListingPayloadItem.createMany({
          data: resolved.payload.variants.map((variant) => ({
            organizationId,
            payloadId: payload.id,
            variantName: variant.variantName,
            sellerSku: variant.sellerSku,
            optionValues: toJson(variant.optionValues),
            // Cột `retail_price` của draft là GIÁ BÁN, `list_price` là giá gốc gạch ngang —
            // đúng như từ Sprint 3 đầu tiên. SKU Template gọi hai thứ đó là `salePrice`
            // và `retailPrice` (theo cách TikTok đặt tên), nên phải đổi chỗ ở đây.
            retailPrice: variant.salePrice ? new Prisma.Decimal(variant.salePrice) : null,
            listPrice: variant.retailPrice ? new Prisma.Decimal(variant.retailPrice) : null,
            currency: variant.currency,
            quantity: variant.quantity,
            imageFileId: variant.imageFileId,
            sortOrder: variant.sortOrder,
          })),
        });
      }

      return { id: payload.id, created: !existing, errorCount, status };
    });
  }
}
