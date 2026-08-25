import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PodListingSessionProductStatus,
  PodListingSessionStatus,
  PodListingSessionTemplateType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodListingJobService } from '../../pod-listing/services/pod-listing-job.service';
import {
  PodListingResolverService,
  toJson,
} from '../../pod-listing/services/pod-listing-resolver.service';
import {
  PodListingTemplateService,
  type ListingTemplateFull,
} from '../../pod-listing/services/pod-listing-template.service';
import { PodListingValidatorService } from '../../pod-listing/services/pod-listing-validator.service';
import {
  POD_DEFAULT_PLATFORM_CODE,
  POD_SESSION_VALIDATION_CODES,
} from '../constants/pod-listing-session.constants';
import type {
  CreateListingSessionDto,
  PodListingSessionQueryDto,
  SessionTemplatesDto,
  StartSessionListingDto,
  UpdateListingSessionDto,
} from '../dto/pod-listing-session.dto';

export class PodListingSessionNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_LISTING_SESSION_NOT_FOUND', message: 'Không tìm thấy Listing Session' });
  }
}

/** Một lý do khiến lượt đăng chưa được phép chạy. */
export interface SessionIssue {
  level: 'ERROR' | 'WARNING';
  code: string;
  field: string;
  message: string;
}

/** Kết quả kiểm tra cả một lượt đăng. */
export interface SessionValidation {
  sessionId: string;
  ok: boolean;
  /** Lỗi của CẤU HÌNH (thiếu shop, thiếu Category Template…). */
  issues: SessionIssue[];
  /** Lỗi của từng Draft Product. */
  products: Array<{ id: string; title: string; ok: boolean; issues: SessionIssue[] }>;
  readyProducts: number;
}

/** Include đầy đủ cho màn hình session. */
export const SESSION_INCLUDE = {
  platform: { select: { id: true, code: true, name: true } },
  shops: {
    include: { shop: { select: { id: true, name: true, region: true } } },
    orderBy: { createdAt: 'asc' },
  },
  templates: { orderBy: { templateType: 'asc' } },
} satisfies Prisma.PodListingSessionInclude;

export type SessionFull = Prisma.PodListingSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

/** Cột khoá ngoại tương ứng với mỗi loại template — dùng cho cả ghi lẫn đọc. */
const TEMPLATE_COLUMN = {
  [PodListingSessionTemplateType.CATEGORY]: 'categoryTemplateId',
  [PodListingSessionTemplateType.SKU]: 'skuTemplateId',
  [PodListingSessionTemplateType.DESCRIPTION]: 'descriptionTemplateId',
  [PodListingSessionTemplateType.IMAGE]: 'imageTemplateId',
  [PodListingSessionTemplateType.PRICING]: 'pricingStrategyId',
} as const satisfies Record<PodListingSessionTemplateType, keyof SessionTemplatesDto>;

/** Trạng thái mà người dùng còn được phép sửa session. */
const EDITABLE_STATUSES: PodListingSessionStatus[] = [
  PodListingSessionStatus.DRAFT,
  PodListingSessionStatus.READY,
  PodListingSessionStatus.COMPLETED,
  PodListingSessionStatus.COMPLETED_WITH_ERRORS,
  PodListingSessionStatus.FAILED,
  PodListingSessionStatus.CANCELLED,
];

/**
 * PodListingSessionService — vòng đời MỘT LƯỢT ĐĂNG HÀNG.
 *
 * ```
 *   New Listing → Market → Shops → 5 Template → Import → Review → Start Listing
 * ```
 *
 * 🔴 Không hàm nào ở đây chạm tới sàn. `startListing` chỉ kiểm tra lần cuối rồi tạo một
 * Listing Job; Bulk Listing Engine (hàng đợi, retry, log, upload ảnh, Create Product
 * `AS_DRAFT`) mới là nơi gọi SDK. Một đường duy nhất ra ngoài.
 *
 * 🔴 Nhiều sàn: session trỏ `platformId` sang bảng global `platforms`. Nội dung Draft Product
 * là dữ liệu trung lập; thêm eBay/Amazon/Etsy chỉ cần một publisher mới và bộ template của
 * sàn đó — bảng session không phải đổi.
 */
@Injectable()
export class PodListingSessionService {
  private readonly logger = new Logger(PodListingSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PodListingResolverService,
    private readonly validator: PodListingValidatorService,
    private readonly listingTemplates: PodListingTemplateService,
    private readonly jobs: PodListingJobService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  async list(organizationId: string, query: PodListingSessionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PodListingSessionWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.market ? { market: query.market } : {}),
      ...(query.shopId ? { shops: { some: { shopId: query.shopId } } } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [sessions, total] = await this.prisma.$transaction([
      this.prisma.podListingSession.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingSession.count({ where }),
    ]);

    const counts = await this.productCounts(sessions.map((session) => session.id));

    return {
      items: sessions.map((session) => ({
        ...session,
        counts: counts.get(session.id) ?? emptyCounts(),
      })),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async get(organizationId: string, id: string): Promise<SessionFull> {
    const session = await this.prisma.podListingSession.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new PodListingSessionNotFoundException();
    return session;
  }

  /** Chi tiết + số đếm sản phẩm + lượt chạy gần nhất. */
  async getDetail(organizationId: string, id: string) {
    const session = await this.get(organizationId, id);
    const [counts, lastJob] = await Promise.all([
      this.productCounts([id]),
      this.prisma.podListingJob.findFirst({
        where: { sessionId: id, organizationId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          totalItems: true,
          successItems: true,
          failedItems: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          lastError: true,
        },
      }),
    ]);

    return { ...session, counts: counts.get(id) ?? emptyCounts(), lastJob };
  }

  // ---------------------------------------------------------------------------
  // Cấu hình
  // ---------------------------------------------------------------------------

  async create(organizationId: string, userId: string, dto: CreateListingSessionDto) {
    const platform = await this.prisma.platform.findFirst({
      where: { code: POD_DEFAULT_PLATFORM_CODE },
      select: { id: true },
    });
    if (!platform) {
      throw new BadRequestException({
        code: 'POD_SESSION_NO_PLATFORM',
        message: 'Chưa có sàn TikTok Shop trong dữ liệu hệ thống — hãy chạy seed.',
      });
    }

    const shopIds = dto.shopIds ?? [];
    await this.assertShopsBelongToOrg(organizationId, shopIds);
    const templates = await this.resolveTemplateRefs(organizationId, dto.market, dto.templates);

    const session = await this.prisma.podListingSession.create({
      data: {
        organizationId,
        platformId: platform.id,
        name: dto.name,
        market: dto.market,
        note: dto.note ?? null,
        createdBy: userId,
        shops: { create: shopIds.map((shopId) => ({ organizationId, shopId })) },
        templates: {
          create: templates.map((row) => ({
            organizationId,
            templateType: row.templateType,
            templateName: row.name,
            [row.column]: row.id,
          })),
        },
      },
      select: { id: true },
    });

    this.logger.log({
      module: 'pod-listing-session',
      operation: 'session.create',
      organizationId,
      sessionId: session.id,
      market: dto.market,
      shops: shopIds.length,
      templates: templates.length,
      msg: 'Đã tạo Listing Session',
    });

    return this.getDetail(organizationId, session.id);
  }

  /**
   * Sửa cấu hình lượt đăng.
   *
   * `shopIds` và `templates` gửi lên là **thay trọn bộ** — merge từng phần tử sẽ để lại rác
   * của lần chọn trước mà người dùng tưởng đã gỡ ra.
   */
  async update(organizationId: string, userId: string, id: string, dto: UpdateListingSessionDto) {
    const session = await this.get(organizationId, id);
    this.assertEditable(session);

    const market = dto.market ?? session.market;
    if (dto.shopIds) await this.assertShopsBelongToOrg(organizationId, dto.shopIds);
    const templates = dto.templates
      ? await this.resolveTemplateRefs(organizationId, market, dto.templates)
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.podListingSession.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.market === undefined ? {} : { market: dto.market }),
          ...(dto.note === undefined ? {} : { note: dto.note }),
          // Cấu hình đổi ⇒ kết quả validate cũ hết giá trị. Giữ lại màu xanh của lần trước
          // là cách chắc chắn để một lượt thiếu dữ liệu vẫn bấm được Start Listing.
          status: PodListingSessionStatus.DRAFT,
          updatedBy: userId,
        },
      });

      if (dto.shopIds) {
        await tx.podListingSessionShop.deleteMany({ where: { sessionId: id } });
        if (dto.shopIds.length > 0) {
          await tx.podListingSessionShop.createMany({
            data: dto.shopIds.map((shopId) => ({ organizationId, sessionId: id, shopId })),
          });
        }
      }

      if (templates) {
        await tx.podListingSessionTemplate.deleteMany({ where: { sessionId: id } });
        for (const row of templates) {
          await tx.podListingSessionTemplate.create({
            data: {
              organizationId,
              sessionId: id,
              templateType: row.templateType,
              templateName: row.name,
              [row.column]: row.id,
            },
          });
        }
      }

      // Sửa cấu hình ⇒ mọi Draft Product phải kiểm lại. Sản phẩm đã lên sàn giữ nguyên
      // trạng thái: đó là sự thật lịch sử, không phải thứ để tính lại.
      await tx.podListingSessionProduct.updateMany({
        where: { sessionId: id, status: PodListingSessionProductStatus.READY },
        data: { status: PodListingSessionProductStatus.DRAFT },
      });
    });

    return this.getDetail(organizationId, id);
  }

  /** Xoá mềm cả lượt đăng (Draft Product con đi theo — chúng không sống một mình). */
  async remove(organizationId: string, userId: string, id: string): Promise<void> {
    const session = await this.get(organizationId, id);
    this.assertEditable(session);

    await this.prisma.$transaction([
      this.prisma.podListingSession.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId },
      }),
      this.prisma.podListingSessionProduct.updateMany({
        where: { sessionId: id, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: userId },
      }),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Validate
  // ---------------------------------------------------------------------------

  /**
   * Kiểm tra cả lượt đăng: cấu hình + từng Draft Product.
   *
   * Hai tầng: (1) những gì kiểm được ngay trên dữ liệu (thiếu shop, thiếu template, sản phẩm
   * không có ảnh/biến thể/giá); (2) áp template rồi kiểm tiếp bằng **đúng bộ luật** mà Bulk
   * Listing Engine dùng — nhờ vậy "màn hình bảo xanh" và "engine chịu chạy" không lệch nhau.
   */
  async validate(organizationId: string, id: string): Promise<SessionValidation> {
    const session = await this.get(organizationId, id);
    const issues = this.checkConfig(session);

    const products = await this.prisma.podListingSessionProduct.findMany({
      where: { sessionId: id, deletedAt: null },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { importOrder: 'asc' },
    });

    if (products.length === 0) {
      issues.push(
        this.issue('NO_PRODUCT', 'products', 'Chưa import sản phẩm nào vào lượt đăng này.'),
      );
    }

    // Template và shop nạp MỘT LẦN cho cả lượt: chúng dùng chung, và mỗi Draft Product mà
    // đọc lại một lần thì 500 sản phẩm thành 500 lần đọc y hệt nhau.
    const shop = session.shops[0]?.shop ?? null;
    let template: ListingTemplateFull | null = null;
    if (issues.length === 0 && shop) {
      try {
        template = await this.listingTemplates.getForSession(organizationId, id);
      } catch (error) {
        issues.push(
          this.issue(
            'NO_CATEGORY_TEMPLATE',
            'templates',
            error instanceof Error ? error.message : 'Không ghép được template của lượt đăng',
          ),
        );
      }
    }

    const results: SessionValidation['products'] = [];
    let readyProducts = 0;

    for (const product of products) {
      const productIssues = this.checkProduct(session, product);

      if (productIssues.length === 0 && template && shop) {
        const resolved = this.resolver.resolveFromContext({
          template,
          product: null,
          sessionProduct: product,
          shop,
        });
        for (const blocker of this.validator.validate(resolved.payload).blockers) {
          productIssues.push({
            level: 'ERROR',
            code: blocker.code,
            field: blocker.field,
            message: blocker.message,
          });
        }
        for (const issue of resolved.issues) {
          if (issue.level === 'ERROR' && !productIssues.some((item) => item.code === issue.code)) {
            productIssues.push({
              level: 'ERROR',
              code: issue.code,
              field: issue.field,
              message: issue.message,
            });
          }
        }
      }

      const errorCount = productIssues.filter((issue) => issue.level === 'ERROR').length;
      const ok = errorCount === 0 && issues.length === 0;
      if (ok) readyProducts += 1;

      await this.prisma.podListingSessionProduct.update({
        where: { id: product.id },
        data: {
          issues: toJson(productIssues),
          errorCount,
          // Sản phẩm đã lên sàn hoặc đang trong hàng đợi giữ nguyên trạng thái — đó là sự
          // thật lịch sử, không phải kết luận của lần kiểm tra này.
          ...(product.status === PodListingSessionProductStatus.UPLOADED ||
          product.status === PodListingSessionProductStatus.QUEUED
            ? {}
            : {
                status: ok
                  ? PodListingSessionProductStatus.READY
                  : PodListingSessionProductStatus.DRAFT,
              }),
        },
      });

      results.push({ id: product.id, title: product.title, ok, issues: productIssues });
    }

    const ok = issues.length === 0 && readyProducts > 0 && results.every((item) => item.ok);

    if (session.status !== PodListingSessionStatus.LISTING) {
      await this.prisma.podListingSession.update({
        where: { id },
        data: { status: ok ? PodListingSessionStatus.READY : PodListingSessionStatus.DRAFT },
      });
    }

    return { sessionId: id, ok, issues, products: results, readyProducts };
  }

  // ---------------------------------------------------------------------------
  // Start Listing
  // ---------------------------------------------------------------------------

  /**
   * Đưa toàn bộ Draft Product của lượt đăng lên sàn dưới dạng **Draft Product của sàn**.
   *
   * 🔴 Hàm này KHÔNG gọi SDK. Nó kiểm tra lần cuối rồi tạo một Listing Job — hàng đợi
   * (5 luồng), retry (3 lần, backoff), log từng bước và upload ảnh đã có sẵn ở Bulk Listing
   * Engine. Viết lại lần nữa ở đây là tự tạo ra hai đường đi khác nhau tới cùng một API.
   */
  async startListing(
    organizationId: string,
    userId: string,
    id: string,
    dto: StartSessionListingDto,
  ) {
    const session = await this.get(organizationId, id);
    if (session.status === PodListingSessionStatus.LISTING) {
      throw new BadRequestException({
        code: 'POD_SESSION_ALREADY_LISTING',
        message: 'Lượt đăng đang chạy — chờ xong rồi chạy tiếp.',
      });
    }

    const validation = await this.validate(organizationId, id);
    const ready = validation.products.filter((product) => product.ok);
    if (ready.length === 0) {
      const first = validation.issues[0] ?? validation.products.find((p) => !p.ok)?.issues[0];
      throw new BadRequestException({
        code: 'POD_SESSION_NOT_READY',
        message: `Không sản phẩm nào đủ điều kiện. Ví dụ: ${first?.message ?? 'thiếu dữ liệu'}`,
      });
    }

    // Mỗi sản phẩm × mỗi shop của lượt = một lần đăng.
    const targets = ready.flatMap((product) =>
      session.shops.map((link) => ({ sessionProductId: product.id, shopId: link.shopId })),
    );

    const job = await this.jobs.createFromSession(organizationId, userId, {
      sessionId: id,
      name: dto.name?.trim() || session.name,
      market: session.market,
      targets,
      products: ready.length,
    });

    await this.prisma.$transaction([
      this.prisma.podListingSessionProduct.updateMany({
        where: { id: { in: ready.map((product) => product.id) } },
        data: { status: PodListingSessionProductStatus.QUEUED, uploadError: null },
      }),
      this.prisma.podListingSession.update({
        where: { id },
        data: {
          status: PodListingSessionStatus.LISTING,
          startedAt: new Date(),
          finishedAt: null,
          lastError: null,
          updatedBy: userId,
        },
      }),
    ]);

    this.logger.log({
      module: 'pod-listing-session',
      operation: 'session.startListing',
      organizationId,
      sessionId: id,
      jobId: job.id,
      products: ready.length,
      targets: targets.length,
      msg: 'Đã đưa Listing Session vào hàng đợi',
    });

    return { job, started: ready.length, targets: targets.length, validation };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Số Draft Product theo trạng thái cho từng session (một truy vấn cho cả trang). */
  private async productCounts(
    sessionIds: string[],
  ): Promise<Map<string, Record<PodListingSessionProductStatus | 'TOTAL', number>>> {
    const map = new Map<string, Record<PodListingSessionProductStatus | 'TOTAL', number>>();
    if (sessionIds.length === 0) return map;

    const rows = await this.prisma.podListingSessionProduct.groupBy({
      by: ['sessionId', 'status'],
      where: { sessionId: { in: sessionIds }, deletedAt: null },
      _count: { _all: true },
    });

    for (const row of rows) {
      const entry = map.get(row.sessionId) ?? emptyCounts();
      entry[row.status] = row._count._all;
      entry.TOTAL += row._count._all;
      map.set(row.sessionId, entry);
    }
    return map;
  }

  /** Lỗi thuộc về CẤU HÌNH của lượt đăng (không phụ thuộc sản phẩm nào). */
  private checkConfig(session: SessionFull): SessionIssue[] {
    const issues: SessionIssue[] = [];
    if (session.shops.length === 0) {
      issues.push(this.issue('NO_SHOP', 'shops', 'Lượt đăng chưa chọn shop nào.'));
    }
    if (!this.templateId(session, PodListingSessionTemplateType.CATEGORY)) {
      issues.push(
        this.issue(
          'NO_CATEGORY_TEMPLATE',
          'templates',
          'Chưa chọn Category Template ⇒ không biết đăng vào danh mục nào.',
        ),
      );
    }
    // 🔴 File import không mang biến thể nào, nên SKU Template là NGUỒN DUY NHẤT sinh ra
    // SKU/giá/tồn. Thiếu nó thì mọi sản phẩm đều bị chặn ở bước sau với thông điệp khó hiểu
    // ("listing chưa có biến thể"); nói thẳng ở đây để người dùng sửa đúng chỗ.
    if (!this.templateId(session, PodListingSessionTemplateType.SKU)) {
      issues.push(
        this.issue(
          'NO_SKU_TEMPLATE',
          'templates',
          'Chưa chọn SKU Template ⇒ không có biến thể, giá và tồn kho để đăng.',
        ),
      );
    }
    return issues;
  }

  /**
   * Lỗi thuộc về MỘT Draft Product, kiểm được ngay không cần áp template.
   *
   * Draft Product chỉ mang tiêu đề + ảnh gốc, nên chỉ có đúng hai thứ để kiểm ở đây. Biến
   * thể, giá và tồn đến từ SKU/Pricing Template — chúng được kiểm ở tầng cấu hình và ở
   * chính bộ luật của Bulk Listing Engine sau khi áp template.
   */
  private checkProduct(
    session: SessionFull,
    product: { title: string; images: Array<unknown> },
  ): SessionIssue[] {
    const issues: SessionIssue[] = [];

    if (!product.title.trim()) {
      issues.push(this.issue('MISSING_TITLE', 'title', 'Sản phẩm chưa có tiêu đề.'));
    }
    if (
      product.images.length === 0 &&
      !this.templateId(session, PodListingSessionTemplateType.IMAGE)
    ) {
      issues.push(
        this.issue(
          'MISSING_IMAGE',
          'images',
          'Sản phẩm chưa có ảnh gốc và lượt đăng cũng chưa chọn Image Template.',
        ),
      );
    }

    return issues;
  }

  private templateId(session: SessionFull, type: PodListingSessionTemplateType): string | null {
    const row = session.templates.find((item) => item.templateType === type);
    return row ? ((row[TEMPLATE_COLUMN[type]]) ?? null) : null;
  }

  private issue(
    code: keyof typeof POD_SESSION_VALIDATION_CODES,
    field: string,
    message: string,
  ): SessionIssue {
    return { level: 'ERROR', code: POD_SESSION_VALIDATION_CODES[code], field, message };
  }

  private assertEditable(session: SessionFull): void {
    if (!EDITABLE_STATUSES.includes(session.status)) {
      throw new BadRequestException({
        code: 'POD_SESSION_IN_PROGRESS',
        message: 'Lượt đăng đang chạy — chờ chạy xong rồi sửa.',
      });
    }
  }

  private async assertShopsBelongToOrg(organizationId: string, shopIds: string[]): Promise<void> {
    if (shopIds.length === 0) return;
    const count = await this.prisma.podTiktokShop.count({
      where: { id: { in: shopIds }, organizationId, deletedAt: null },
    });
    if (count !== new Set(shopIds).size) {
      throw new BadRequestException({
        code: 'POD_SESSION_INVALID_SHOP',
        message: 'Có shop không tồn tại hoặc không thuộc tổ chức này.',
      });
    }
  }

  /**
   * Kiểm tra từng template rồi trả về đúng bộ dòng sẽ ghi vào `pod_listing_session_templates`.
   *
   * 🔴 Mọi template phải thuộc CÙNG tổ chức — không kiểm là mở đường cho một tenant mượn
   * template của tenant khác qua ID. Category Template còn phải cùng THỊ TRƯỜNG với lượt
   * đăng: danh mục US không dùng được cho listing UK, và phát hiện lúc lưu tốt hơn nhiều so
   * với lúc TikTok từ chối cả lô.
   */
  private async resolveTemplateRefs(
    organizationId: string,
    market: SessionFull['market'],
    templates?: SessionTemplatesDto,
  ): Promise<
    Array<{
      templateType: PodListingSessionTemplateType;
      column: (typeof TEMPLATE_COLUMN)[PodListingSessionTemplateType];
      id: string;
      name: string;
    }>
  > {
    if (!templates) return [];

    const rows: Array<{
      templateType: PodListingSessionTemplateType;
      column: (typeof TEMPLATE_COLUMN)[PodListingSessionTemplateType];
      id: string;
      name: string;
    }> = [];

    const push = (
      templateType: PodListingSessionTemplateType,
      id: string,
      name: string,
    ): void => {
      rows.push({ templateType, column: TEMPLATE_COLUMN[templateType], id, name });
    };

    if (templates.categoryTemplateId) {
      const found = await this.prisma.podCategoryTemplate.findFirst({
        where: { id: templates.categoryTemplateId, organizationId, deletedAt: null },
        select: { id: true, name: true, market: true },
      });
      if (!found) throw this.invalidTemplate('Category Template');
      if (found.market !== market) {
        throw new BadRequestException({
          code: 'POD_SESSION_TEMPLATE_MARKET_MISMATCH',
          message: `Category Template thuộc thị trường ${found.market}, không phải ${market}.`,
        });
      }
      push(PodListingSessionTemplateType.CATEGORY, found.id, found.name);
    }

    if (templates.skuTemplateId) {
      const found = await this.prisma.podSkuTemplate.findFirst({
        where: { id: templates.skuTemplateId, organizationId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!found) throw this.invalidTemplate('SKU Template');
      push(PodListingSessionTemplateType.SKU, found.id, found.name);
    }

    if (templates.descriptionTemplateId) {
      const found = await this.prisma.podDescriptionTemplate.findFirst({
        where: { id: templates.descriptionTemplateId, organizationId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!found) throw this.invalidTemplate('Description Template');
      push(PodListingSessionTemplateType.DESCRIPTION, found.id, found.name);
    }

    if (templates.imageTemplateId) {
      const found = await this.prisma.podImageTemplate.findFirst({
        where: { id: templates.imageTemplateId, organizationId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!found) throw this.invalidTemplate('Image Template');
      push(PodListingSessionTemplateType.IMAGE, found.id, found.name);
    }

    if (templates.pricingStrategyId) {
      const found = await this.prisma.podPricingStrategy.findFirst({
        where: { id: templates.pricingStrategyId, organizationId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!found) throw this.invalidTemplate('Pricing Template');
      push(PodListingSessionTemplateType.PRICING, found.id, found.name);
    }

    return rows;
  }

  private invalidTemplate(label: string): BadRequestException {
    return new BadRequestException({
      code: 'POD_SESSION_INVALID_TEMPLATE',
      message: `${label} không tồn tại hoặc không thuộc tổ chức này.`,
    });
  }
}

/** Khung số đếm — mọi trạng thái đều có mặt để màn hình không phải kiểm `undefined`. */
function emptyCounts(): Record<PodListingSessionProductStatus | 'TOTAL', number> {
  return {
    TOTAL: 0,
    DRAFT: 0,
    READY: 0,
    QUEUED: 0,
    UPLOADED: 0,
    PUBLISHED: 0,
    FAILED: 0,
    SKIPPED: 0,
  };
}
