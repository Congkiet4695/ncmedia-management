import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PodListingSessionProductStatus, PodListingSessionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import {
  PodListingResolverService,
  toJson,
  type ResolveResult,
} from '../../pod-listing/services/pod-listing-resolver.service';
import { PodListingTemplateService } from '../../pod-listing/services/pod-listing-template.service';
import { POD_SESSION_VALIDATION_CODES } from '../constants/pod-listing-session.constants';
import type {
  PodSessionProductQueryDto,
  PreviewSessionProductDto,
  CreateCustomListingDto,
  CreateSessionProductDto,
  UpdateSessionProductDto,
} from '../dto/pod-listing-session.dto';
import { PodListingSessionService } from './pod-listing-session.service';

export class PodSessionProductNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_SESSION_PRODUCT_NOT_FOUND', message: 'Không tìm thấy Draft Product' });
  }
}

/** Ảnh gốc đã sắp đúng thứ tự URL1 → URL10 — hình dạng mà màn hình Review cần. */
export const SESSION_PRODUCT_INCLUDE = {
  images: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.PodListingSessionProductInclude;

export type SessionProductFull = Prisma.PodListingSessionProductGetPayload<{
  include: typeof SESSION_PRODUCT_INCLUDE;
}>;

/**
 * PodSessionProductService — Draft Product **bên trong** một Listing Session.
 *
 * 🔴 Mọi hàm đều nhận `sessionId` và ràng buộc theo nó. Draft Product không có vòng đời
 * riêng: không sửa được nếu không nói rõ nó thuộc lượt đăng nào, và xoá session là mất theo.
 *
 * 🔴 Không hàm nào ở đây chạm tới sàn — kể cả `preview`, vốn chỉ giải template trong bộ nhớ.
 */
@Injectable()
export class PodSessionProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: PodListingSessionService,
    private readonly resolver: PodListingResolverService,
    private readonly listingTemplates: PodListingTemplateService,
  ) {}

  async list(
    organizationId: string,
    sessionId: string,
    query: PodSessionProductQueryDto,
    scope: PodAccessScope,
  ) {
    await this.sessions.get(organizationId, sessionId, scope);

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.PodListingSessionProductWhereInput = {
      organizationId,
      sessionId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podListingSessionProduct.findMany({
        where,
        include: SESSION_PRODUCT_INCLUDE,
        orderBy: { [query.sortBy ?? 'importOrder']: query.sortOrder ?? 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingSessionProduct.count({ where }),
    ]);

    // Kết quả lên sàn nằm ở job item (một dòng cho mỗi cặp sản phẩm × shop) — nạp kèm để
    // màn hình Review hiển thị id sản phẩm phía sàn mà không phải gọi thêm API.
    const results = await this.prisma.podListingJobItem.findMany({
      where: { sessionProductId: { in: items.map((item) => item.id) } },
      select: {
        sessionProductId: true,
        shopId: true,
        status: true,
        remoteProductId: true,
        error: true,
        shop: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const byProduct = new Map<string, typeof results>();
    for (const row of results) {
      const key = row.sessionProductId as string;
      byProduct.set(key, [...(byProduct.get(key) ?? []), row]);
    }

    return {
      items: items.map((item) => ({ ...item, results: byProduct.get(item.id) ?? [] })),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async get(
    organizationId: string,
    sessionId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<SessionProductFull> {
    // 🔴 Phải qua `sessions.get` trước: Draft Product không mang `shop_id`, phạm vi của nó
    // chính là phạm vi của lượt đăng chứa nó. Truy thẳng bảng con là bỏ qua phép kiểm đó.
    await this.sessions.get(organizationId, sessionId, scope);

    const product = await this.prisma.podListingSessionProduct.findFirst({
      where: { id, sessionId, organizationId, deletedAt: null },
      include: SESSION_PRODUCT_INCLUDE,
    });
    if (!product) throw new PodSessionProductNotFoundException();
    return product;
  }

  /**
   * Sửa một Draft Product: **tiêu đề và danh sách ảnh gốc**, không gì khác.
   *
   * `images` gửi lên là **thay trọn bộ** — merge từng phần tử sẽ để lại rác của lần nhập
   * trước mà người dùng tưởng đã xoá.
   */
  /**
   * **Add Custom Listing** — lượt đăng một sản phẩm nhập tay, tạo trong MỘT lời gọi.
   *
   * ```
   *   form  →  session (market + N shop + template tuỳ chọn)
   *              └─ 1 Draft Product (+ manualData)
   *                     ↓ Start Listing (endpoint sẵn có)
   *                 fan-out 1 sản phẩm × N shop → Bulk Listing Engine
   * ```
   *
   * 🔴 Dùng lại `create()` chứ không viết đường tạo session thứ hai: mọi phép kiểm ở đó
   * (shop thuộc tổ chức, shop trong phạm vi của người dùng, template hợp lệ) là thứ Custom
   * Listing cần y hệt. Một bản sao là một bản sẽ quên cập nhật.
   *
   * 🔴 KHÔNG tự chạy listing: hàm này chỉ dựng dữ liệu. "Lưu nháp" dừng ở đây, "Đăng sản
   * phẩm" gọi tiếp `startListing`. Gộp hai việc lại là lấy mất nút Lưu nháp.
   */
  async createCustom(
    organizationId: string,
    userId: string,
    dto: CreateCustomListingDto,
    scope: PodAccessScope,
  ) {
    const session = await this.sessions.create(
      organizationId,
      userId,
      {
        // Lượt đăng một sản phẩm thì tên lượt = tên sản phẩm là thứ dễ tìm lại nhất.
        name: dto.name?.trim() || dto.product.title,
        market: dto.market,
        shopIds: dto.shopIds,
        templates: dto.templates,
      },
      scope,
    );

    await this.create(organizationId, userId, session.id, dto.product, scope);
    return this.sessions.getDetail(organizationId, session.id, scope);
  }

  /**
   * Tạo MỘT Draft Product nhập tay.
   *
   * 🔴 Vì sao không dùng lại đường Import: import đọc file nhiều dòng và ghi theo lô, còn
   * đây là một sản phẩm người dùng vừa gõ xong trên form. Điểm chung duy nhất là bảng đích,
   * và cả hai đều đi qua `PodListingSessionService.get()` nên phạm vi shop được kiểm y hệt.
   *
   * `importOrder` nối tiếp số lớn nhất đang có — sản phẩm nhập tay đứng cuối danh sách, đúng
   * thứ tự người dùng thêm vào, và không giẫm lên số thứ tự của các lô import trước.
   */
  async create(
    organizationId: string,
    userId: string,
    sessionId: string,
    dto: CreateSessionProductDto,
    scope: PodAccessScope,
  ): Promise<SessionProductFull> {
    const session = await this.sessions.get(organizationId, sessionId, scope);
    // Lượt đang chạy thì không được thêm hàng vào giữa chừng.
    this.assertEditable(session.status, PodListingSessionProductStatus.DRAFT);

    const last = await this.prisma.podListingSessionProduct.findFirst({
      where: { sessionId, deletedAt: null },
      orderBy: { importOrder: 'desc' },
      select: { importOrder: true },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const product = await tx.podListingSessionProduct.create({
        data: {
          organizationId,
          sessionId,
          title: dto.title,
          importOrder: (last?.importOrder ?? -1) + 1,
          ...(dto.manualData
            ? { manualData: dto.manualData as unknown as Prisma.InputJsonValue }
            : {}),
          createdBy: userId,
        },
        select: { id: true },
      });

      if (dto.images?.length) {
        await tx.podListingSessionProductImage.createMany({
          data: dto.images.map((image, index) => ({
            organizationId,
            sessionProductId: product.id,
            imageUrl: image.imageUrl,
            ...(image.imageType ? { imageType: image.imageType } : {}),
            fileId: image.fileId ?? null,
            sortOrder: image.sortOrder ?? index,
          })),
        });
      }

      // Thêm hàng vào lượt ⇒ kết quả validate của cả lượt hết giá trị.
      await tx.podListingSession.updateMany({
        where: { id: sessionId, status: { not: PodListingSessionStatus.LISTING } },
        data: { status: PodListingSessionStatus.DRAFT },
      });

      return product;
    });

    return this.get(organizationId, sessionId, created.id, scope);
  }

  async update(
    organizationId: string,
    userId: string,
    sessionId: string,
    id: string,
    dto: UpdateSessionProductDto,
    scope: PodAccessScope,
  ): Promise<SessionProductFull> {
    const session = await this.sessions.get(organizationId, sessionId, scope);
    const product = await this.get(organizationId, sessionId, id, scope);
    this.assertEditable(session.status, product.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.podListingSessionProduct.update({
        where: { id },
        data: {
          ...(dto.title === undefined ? {} : { title: dto.title }),
          // Gửi `manualData` là THAY TOÀN BỘ phần nhập tay; bỏ trống là giữ nguyên. Không
          // có đường "xoá từng trường" ở đây — giao diện luôn gửi lên trạng thái đầy đủ của
          // các section đang ở chế độ Nhập tay.
          ...(dto.manualData === undefined
            ? {}
            : { manualData: dto.manualData as unknown as Prisma.InputJsonValue }),
          // Sửa nội dung ⇒ kết quả validate cũ hết giá trị; xoá đi để không ai nhìn nhầm
          // trạng thái xanh của lần trước.
          status: PodListingSessionProductStatus.DRAFT,
          issues: Prisma.DbNull,
          errorCount: 0,
          uploadError: null,
          updatedBy: userId,
        },
      });

      if (dto.images) {
        await tx.podListingSessionProductImage.deleteMany({ where: { sessionProductId: id } });
        if (dto.images.length > 0) {
          await tx.podListingSessionProductImage.createMany({
            data: dto.images.map((image, index) => ({
              organizationId,
              sessionProductId: id,
              imageUrl: image.imageUrl,
              ...(image.imageType ? { imageType: image.imageType } : {}),
              fileId: image.fileId ?? null,
              sortOrder: image.sortOrder ?? index,
            })),
          });
        }
      }

      // Lượt đăng có sản phẩm vừa đổi ⇒ phải kiểm lại trước khi chạy.
      await tx.podListingSession.updateMany({
        where: { id: sessionId, status: { not: PodListingSessionStatus.LISTING } },
        data: { status: PodListingSessionStatus.DRAFT },
      });
    });

    return this.get(organizationId, sessionId, id, scope);
  }

  /** Xoá mềm một Draft Product khỏi lượt đăng. */
  async remove(
    organizationId: string,
    userId: string,
    sessionId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<void> {
    const session = await this.sessions.get(organizationId, sessionId, scope);
    const product = await this.get(organizationId, sessionId, id, scope);
    this.assertEditable(session.status, product.status);

    await this.prisma.podListingSessionProduct.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
  }

  /** Xoá nhiều — trả về số dòng thật sự xoá được (bỏ qua sản phẩm đang trong hàng đợi). */
  async removeMany(
    organizationId: string,
    userId: string,
    sessionId: string,
    ids: string[],
    scope: PodAccessScope,
  ): Promise<number> {
    const session = await this.sessions.get(organizationId, sessionId, scope);
    this.assertEditable(session.status, PodListingSessionProductStatus.DRAFT);

    const result = await this.prisma.podListingSessionProduct.updateMany({
      where: {
        id: { in: ids },
        sessionId,
        organizationId,
        deletedAt: null,
        status: { not: PodListingSessionProductStatus.QUEUED },
      },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    return result.count;
  }

  /**
   * Xoá **toàn bộ** Draft Product của lượt đăng — nút "dọn sạch để nhập lại từ đầu".
   *
   * Vẫn là xoá mềm, và vẫn bỏ qua sản phẩm đang trong hàng đợi: một lượt chạy đang đọc dở
   * danh sách thì không được rút bản ghi khỏi tay nó.
   */
  async removeAll(
    organizationId: string,
    userId: string,
    sessionId: string,
    scope: PodAccessScope,
  ): Promise<number> {
    const session = await this.sessions.get(organizationId, sessionId, scope);
    this.assertEditable(session.status, PodListingSessionProductStatus.DRAFT);

    const result = await this.prisma.podListingSessionProduct.updateMany({
      where: {
        sessionId,
        organizationId,
        deletedAt: null,
        status: { not: PodListingSessionProductStatus.QUEUED },
      },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    return result.count;
  }

  /**
   * Xem trước payload sau khi áp template của lượt đăng.
   *
   * 🔴 KHÔNG ghi payload, KHÔNG gọi sàn. Chỉ lưu lại ảnh chụp để mở lại nhanh.
   */
  async preview(
    organizationId: string,
    sessionId: string,
    id: string,
    dto: PreviewSessionProductDto,
    scope: PodAccessScope,
  ): Promise<ResolveResult> {
    const session = await this.sessions.get(organizationId, sessionId, scope);
    await this.get(organizationId, sessionId, id, scope);

    const shopId = dto.shopId ?? session.shops[0]?.shopId;
    if (!shopId) {
      throw new BadRequestException({
        code: POD_SESSION_VALIDATION_CODES.NO_SHOP,
        message: 'Lượt đăng chưa chọn shop nào — không biết xem trước cho shop nào.',
      });
    }
    if (dto.shopId && !session.shops.some((link) => link.shopId === dto.shopId)) {
      throw new BadRequestException({
        code: 'POD_SESSION_INVALID_SHOP',
        message: 'Shop không thuộc lượt đăng này.',
      });
    }

    const template = await this.listingTemplates.getForSession(organizationId, sessionId);
    const resolved = await this.resolver.resolve(organizationId, {
      template,
      productId: null,
      sessionProductId: id,
      shopId,
    });

    await this.prisma.podListingSessionProduct.update({
      where: { id },
      data: { previewData: toJson(resolved.payload) },
    });

    return resolved;
  }

  /**
   * Sản phẩm đang trong hàng đợi thì không cho đụng vào: sửa một bản ghi mà engine đang đọc
   * dở là cách chắc chắn để thứ lên sàn khác thứ trên màn hình.
   */
  private assertEditable(
    sessionStatus: PodListingSessionStatus,
    productStatus: PodListingSessionProductStatus,
  ): void {
    if (sessionStatus === PodListingSessionStatus.LISTING) {
      throw new BadRequestException({
        code: 'POD_SESSION_IN_PROGRESS',
        message: 'Lượt đăng đang chạy — chờ chạy xong rồi sửa.',
      });
    }
    if (productStatus === PodListingSessionProductStatus.QUEUED) {
      throw new BadRequestException({
        code: 'POD_SESSION_PRODUCT_IN_QUEUE',
        message: 'Sản phẩm đang trong hàng đợi — chờ chạy xong rồi sửa.',
      });
    }
  }
}
