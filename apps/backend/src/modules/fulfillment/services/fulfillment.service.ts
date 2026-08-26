import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentAccount,
  FulfillmentOrder,
  FulfillmentProvider,
  FulfillmentStatus,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import {
  PodAccessScopeService,
  PodShopForbiddenException,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import {
  CreateFulfillmentAccountDto,
  FulfillmentAccountDto,
  FulfillmentProviderOptionDto,
  FulfillmentErrorDto,
  FulfillmentHistoryDto,
  FulfillmentOrderDto,
  FulfillmentStateDto,
  PaginatedProductMappingDto,
  ProductMappingDto,
  ProductMappingQueryDto,
  TiktokProductOptionDto,
  UpdateFulfillmentAccountDto,
  UpsertProductMappingDto,
} from '../dto/fulfillment.dto';
import {
  FulfillmentAccountNotFoundException,
  FulfillmentMappingConflictException,
  FulfillmentMappingNotFoundException,
  FulfillmentOrderNotFoundException,
} from '../exceptions/fulfillment.exceptions';
import { ProductDesignMapper, type DesignForDto } from '../mappers/product-design.mapper';
import {
  FulfillmentOrderWithRelations,
  FulfillmentRepository,
} from '../repositories/fulfillment.repository';
import { mappingKeyOf } from '../shared/mapping-match';
import { FulfillmentReadinessService, MappingWithDesigns } from './fulfillment-readiness.service';

/** Trạng thái cho phép bấm Fulfill (chưa gửi hoặc gửi hỏng). */
const FULFILLABLE_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.DRAFT,
  FulfillmentStatus.FAILED,
];

/** Trạng thái cho phép huỷ ở xưởng in. */
const CANCELLABLE_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.SUBMITTED,
  FulfillmentStatus.ON_HOLD,
];

/**
 * FulfillmentService — nghiệp vụ KHÔNG phụ thuộc nhà cung cấp.
 *
 * Quản lý cấu hình tài khoản, ánh xạ sản phẩm, và tổng hợp trạng thái cho UI.
 * Việc gọi API cụ thể do service của từng nhà cung cấp đảm nhiệm
 * (`MangoFulfillmentService`) — thêm nhà cung cấp mới không phải sửa file này.
 */
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly repo: FulfillmentRepository,
    private readonly podOrderRepo: PodOrderRepository,
    private readonly readiness: FulfillmentReadinessService,
    private readonly designMapper: ProductDesignMapper,
    private readonly encryption: TiktokEncryptionService,
    private readonly accessScope: PodAccessScopeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Tài khoản
  // ---------------------------------------------------------------------------

  async listAccounts(organizationId: string): Promise<FulfillmentAccountDto[]> {
    const accounts = await this.repo.listAccounts(organizationId);
    // Đếm gộp MỘT truy vấn cho tất cả nhà cung cấp — không đếm lặp trong vòng lặp.
    const linkCounts = await this.repo.countTiktokAccountsGroupedByProvider(organizationId);
    return accounts.map((account) =>
      this.toAccountDto(account, undefined, linkCounts.get(account.id) ?? 0),
    );
  }

  async createAccount(
    organizationId: string,
    actorUserId: string,
    dto: CreateFulfillmentAccountDto,
  ): Promise<FulfillmentAccountDto> {
    // Secret webhook sinh ngay lúc tạo: Mango không ký payload nên đây là lớp xác thực
    // duy nhất cho request gọi về (xem docs/fulfillment/README.md §Webhook).
    const webhookSecret = randomBytes(24).toString('hex');

    const account = await this.repo.createAccount({
      organizationId,
      provider: dto.provider,
      name: dto.name,
      // Mã hoá NGAY tại điểm nhận — giá trị thô không đi xa hơn dòng này.
      apiKeyEnc: this.encryption.encrypt(dto.apiKey),
      // Chỉ 4 ký tự cuối được lưu để hiển thị; đủ để đối chiếu, không đủ để dùng.
      apiKeyHint: dto.apiKey.slice(-4),
      baseUrlOverride: dto.baseUrl ?? null,
      defaultProductionLine: dto.defaultProductionLine ?? null,
      defaultShippingMethod: dto.defaultShippingMethod ?? 'standard',
      defaultFacility: dto.defaultFacility ?? null,
      webhookSecretEnc: this.encryption.encrypt(webhookSecret),
      isDefault: dto.isDefault ?? true,
      createdBy: actorUserId,
    });

    this.logger.log({
      module: 'fulfillment',
      operation: 'account.create',
      organizationId,
      provider: dto.provider,
      accountId: account.id,
      msg: 'Đã thêm tài khoản nhà cung cấp fulfillment',
    });

    return this.toAccountDto(account, webhookSecret);
  }

  async updateAccount(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdateFulfillmentAccountDto,
  ): Promise<FulfillmentAccountDto> {
    const existing = await this.repo.findAccountById(organizationId, id);
    if (!existing) throw new FulfillmentAccountNotFoundException();

    const account = await this.repo.updateAccount(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      // Chỉ đổi khoá khi người dùng thực sự gửi khoá mới.
      ...(dto.apiKey
        ? { apiKeyEnc: this.encryption.encrypt(dto.apiKey), apiKeyHint: dto.apiKey.slice(-4) }
        : {}),
      ...(dto.defaultProductionLine !== undefined
        ? { defaultProductionLine: dto.defaultProductionLine }
        : {}),
      ...(dto.defaultShippingMethod !== undefined
        ? { defaultShippingMethod: dto.defaultShippingMethod }
        : {}),
      ...(dto.defaultFacility !== undefined ? { defaultFacility: dto.defaultFacility } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      updatedBy: actorUserId,
    });

    return this.toAccountDto(account);
  }

  /**
   * Xoá mềm nhà cung cấp và gỡ liên kết khỏi mọi TikTok Account đang trỏ tới nó.
   *
   * Trả về số kết nối bị gỡ để giao diện nói rõ hệ quả, thay vì để người dùng phát hiện
   * sau đó bằng một lỗi "chưa gán nhà cung cấp" không rõ nguyên nhân.
   */
  async deleteAccount(
    organizationId: string,
    actorUserId: string,
    id: string,
  ): Promise<{ id: string; unlinkedTiktokAccounts: number; submittedOrders: number }> {
    const existing = await this.repo.findAccountById(organizationId, id);
    if (!existing) throw new FulfillmentAccountNotFoundException();

    const unlinkedTiktokAccounts = await this.repo.countTiktokAccountsByProvider(
      organizationId,
      id,
    );
    const submittedOrders = await this.repo.countOrdersByAccount(organizationId, id);

    await this.repo.softDeleteAccount(id, actorUserId);

    this.logger.log({
      module: 'fulfillment',
      operation: 'account.delete',
      organizationId,
      accountId: id,
      unlinkedTiktokAccounts,
      submittedOrders,
      msg: 'Đã xoá nhà cung cấp fulfillment (xoá mềm)',
    });

    return { id, unlinkedTiktokAccounts, submittedOrders };
  }

  /**
   * Lấy bản ghi nhà cung cấp (thực thể Prisma, KHÔNG phải DTO) để tầng gọi API dùng.
   * Public vì controller Test Connection cần bản ghi gốc mới có `apiKeyEnc` để giải mã.
   */
  async requireAccountById(organizationId: string, id: string): Promise<FulfillmentAccount> {
    const account = await this.repo.findAccountById(organizationId, id);
    if (!account) throw new FulfillmentAccountNotFoundException();
    return account;
  }

  /** Danh sách rút gọn cho dropdown "Fulfillment Provider" ở màn hình TikTok Account. */
  async listProviderOptions(organizationId: string): Promise<FulfillmentProviderOptionDto[]> {
    const accounts = await this.repo.listAccounts(organizationId);
    return accounts
      .filter((account) => account.isActive)
      .map((account) => ({
        id: account.id,
        name: account.name,
        provider: account.provider,
      }));
  }

  // ---------------------------------------------------------------------------
  // Ánh xạ sản phẩm
  // ---------------------------------------------------------------------------

  async listMappings(
    organizationId: string,
    provider: FulfillmentProvider,
  ): Promise<ProductMappingDto[]> {
    const account = await this.requireAccount(organizationId, provider);
    const mappings = await this.repo.listMappings(organizationId, account.id);
    return mappings.map((mapping) => this.toMappingDto(mapping));
  }

  /**
   * Danh sách ánh xạ có lọc + phân trang cho màn hình Product Mapping.
   *
   * Tên nhà cung cấp và tên người sửa gần nhất được nạp bằng MỘT truy vấn cho cả trang rồi
   * ghép trong bộ nhớ — tra từng dòng sẽ thành N+1.
   */
  async listMappingsPaged(
    organizationId: string,
    query: ProductMappingQueryDto,
  ): Promise<PaginatedProductMappingDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.repo.listMappingsPaged({
      organizationId,
      accountId: query.accountId,
      provider: query.provider,
      isActive: query.status === undefined ? undefined : query.status === 'ACTIVE',
      keyword: query.search,
      page,
      limit,
    });

    const [accounts, editorNames, designsByKey] = await Promise.all([
      this.repo.listAccounts(organizationId),
      this.resolveEditorNames(organizationId, items),
      // MỘT truy vấn design cho cả trang, ghép theo cặp khoá — không N+1.
      this.loadDesignsByKey(organizationId),
    ]);
    const nameById = new Map(accounts.map((account) => [account.id, account.name]));

    const dtos = items.map((mapping) =>
      this.toMappingDto(
        mapping,
        nameById.get(mapping.accountId) ?? null,
        editorNames.get(mapping.updatedBy ?? '') ?? null,
        designsByKey.get(mappingKeyOf(mapping.tiktokProductId, mapping.sellerSku) ?? '') ?? [],
      ),
    );

    // 🔴 Lọc theo tình trạng design chạy SAU khi dựng DTO, không phải trong câu truy vấn:
    // "READY" nghĩa là có mặt trước, mà luật đó nằm ở `ProductDesignMapper.statusOf` — nơi
    // duy nhất định nghĩa nó. Viết lại luật ấy thành điều kiện SQL là tạo bản sao thứ hai,
    // và bản sao sẽ trôi lệch ngay lần đầu ai đó bật thêm một vị trí in bắt buộc.
    //
    // Đánh đổi đã biết: `meta.total` là tổng TRƯỚC lọc, nên trang cuối có thể ngắn hơn
    // `limit`. Chấp nhận được với bộ lọc phụ trợ này; giải pháp đúng khi dữ liệu lớn là một
    // cột trạng thái tính sẵn, và đó là việc của sprint khác.
    const filtered =
      query.designStatus === undefined
        ? dtos
        : dtos.filter((dto) =>
            query.designStatus === 'READY'
              ? dto.designStatus === 'READY'
              : dto.designStatus !== 'READY',
          );

    return {
      items: filtered,
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * Design của ĐÚNG một sản phẩm.
   *
   * Dùng khi trả DTO cho một ánh xạ vừa tạo/sửa. Nạp cả tổ chức ở đây là lãng phí — nhưng
   * BỎ QUA thì DTO trả về sẽ báo "chưa có design" cho một sản phẩm đã có file, và giao diện
   * hiển thị sai ngay sau khi người dùng bấm Lưu.
   */
  private async loadDesignsFor(mapping: {
    organizationId: string;
    tiktokProductId: string | null;
    sellerSku: string | null;
  }): Promise<DesignForDto[]> {
    if (!mapping.tiktokProductId || !mapping.sellerSku) return [];
    return this.repo.listProductDesigns(mapping.organizationId, [
      { tiktokProductId: mapping.tiktokProductId, sellerSku: mapping.sellerSku },
    ]);
  }

  /**
   * Design của cả tổ chức, tra theo `mappingKeyOf(productId, sellerSku)`.
   *
   * 🔴 Nạp MỘT lần rồi ghép trong bộ nhớ. Design đã tách khỏi ánh xạ nên không `include`
   * được nữa; đọc theo từng dòng sẽ là N+1 trên cả màn hình ánh xạ lẫn luồng kiểm tra đơn.
   */
  private async loadDesignsByKey(organizationId: string): Promise<Map<string, DesignForDto[]>> {
    const rows = await this.repo.listProductDesigns(organizationId);
    const byKey = new Map<string, DesignForDto[]>();
    for (const row of rows) {
      const key = mappingKeyOf(row.tiktokProductId, row.sellerSku);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
    return byKey;
  }

  /** Tên người sửa gần nhất cho cả trang — MỘT truy vấn, không tra từng dòng. */
  private async resolveEditorNames(
    organizationId: string,
    mappings: Array<{ updatedBy: string | null }>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(mappings.map((m) => m.updatedBy).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }

  /**
   * Sản phẩm/SKU TikTok có thể ánh xạ — lấy từ CÁC ĐƠN ĐÃ ĐỒNG BỘ.
   *
   * Hệ thống không đồng bộ catalog sản phẩm TikTok (chỉ đồng bộ đơn), nên nguồn đáng tin
   * duy nhất về "SKU nào thực sự bán được" chính là các dòng hàng đã xuất hiện trong đơn.
   * Cách này còn có lợi thế: chỉ hiện những SKU thật sự cần ánh xạ.
   */
  async listTiktokProductOptions(
    organizationId: string,
    accountId: string,
    search?: string,
  ): Promise<TiktokProductOptionDto[]> {
    const [items, mappings] = await Promise.all([
      this.repo.listDistinctTiktokSkus(organizationId, search),
      // Phạm vi TỔ CHỨC: một sản phẩm chỉ được ánh xạ MỘT lần cho toàn tổ chức, nên "đã ánh
      // xạ" không phụ thuộc người dùng đang chọn nhà cung cấp nào.
      this.repo.listMappingsForOrganization(organizationId),
    ]);

    // 🔴 Đã ánh xạ hay chưa được đo bằng ĐÚNG khoá nghiệp vụ (Product ID + Seller SKU) —
    // cùng một hàm mà luồng gửi đơn dùng. Đo bằng luật khác sẽ có cảnh "đã ánh xạ" nhưng
    // đơn vẫn báo thiếu ánh xạ.
    const mappedKeys = new Set(
      mappings
        .map((mapping) => mappingKeyOf(mapping.tiktokProductId, mapping.sellerSku))
        .filter((key): key is string => key !== null),
    );

    return items.map((item) => {
      const key = mappingKeyOf(item.productId, item.sellerSku);
      return {
        tiktokProductId: item.productId,
        tiktokSkuId: item.skuId,
        sellerSku: item.sellerSku,
        productName: item.productName,
        skuName: item.skuName,
        productCategory: item.productCategory,
        skuImage: item.skuImage,
        mapped: key !== null && mappedKeys.has(key),
      };
    });
  }

  async createMapping(
    organizationId: string,
    actorUserId: string,
    provider: FulfillmentProvider,
    dto: UpsertProductMappingDto,
    scope: PodAccessScope,
  ): Promise<ProductMappingDto> {
    await this.assertMappingKeyInScope(organizationId, dto.tiktokProductId, scope);
    const account = await this.resolveMappingAccount(organizationId, provider, dto.accountId);
    await this.assertNoConflict(organizationId, dto);

    const mapping = await this.repo.createMapping({
      organizationId,
      accountId: account.id,
      provider: account.provider,
      tiktokProductId: dto.tiktokProductId,
      tiktokSkuId: dto.tiktokSkuId ?? null,
      sellerSku: dto.sellerSku,
      providerSku: dto.providerSku,
      baseCost: dto.baseCost ?? null,
      providerProductId: dto.providerProductId ?? null,
      providerVariantId: dto.providerVariantId ?? null,
      providerProductName: dto.providerProductName ?? null,
      providerVariantName: dto.providerVariantName ?? null,
      providerColor: dto.providerColor ?? null,
      providerSize: dto.providerSize ?? null,
      productionConfig: dto.productionConfig ?? null,
      placementMap: (dto.placementMap ?? null) as Prisma.InputJsonValue,
      isActive: dto.isActive ?? true,
      note: dto.note ?? null,
      createdBy: actorUserId,
    });
    return this.toMappingDto(mapping, null, null, await this.loadDesignsFor(mapping));
  }

  async updateMapping(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpsertProductMappingDto,
    scope: PodAccessScope,
  ): Promise<ProductMappingDto> {
    const existing = await this.repo.findMappingById(organizationId, id);
    if (!existing) throw new FulfillmentMappingNotFoundException();
    // Kiểm CẢ khoá cũ lẫn khoá mới: sửa một ánh xạ mình được phép thành khoá của shop khác
    // cũng là một đường ghi vào dữ liệu shop khác.
    await this.assertMappingKeyInScope(organizationId, existing.tiktokProductId, scope);
    await this.assertMappingKeyInScope(organizationId, dto.tiktokProductId, scope);
    await this.assertNoConflict(organizationId, dto, id);

    const mapping = await this.repo.updateMapping(id, {
      tiktokProductId: dto.tiktokProductId,
      tiktokSkuId: dto.tiktokSkuId ?? null,
      sellerSku: dto.sellerSku,
      providerSku: dto.providerSku,
      baseCost: dto.baseCost ?? null,
      providerProductId: dto.providerProductId ?? null,
      providerVariantId: dto.providerVariantId ?? null,
      providerProductName: dto.providerProductName ?? null,
      providerVariantName: dto.providerVariantName ?? null,
      providerColor: dto.providerColor ?? null,
      providerSize: dto.providerSize ?? null,
      productionConfig: dto.productionConfig ?? null,
      placementMap: (dto.placementMap ?? null) as Prisma.InputJsonValue,
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      note: dto.note ?? null,
      updatedBy: actorUserId,
    });
    return this.toMappingDto(mapping, null, null, await this.loadDesignsFor(mapping));
  }

  /**
   * Cặp khoá (Product ID + Seller SKU) của một ánh xạ.
   *
   * ⚠️ Chỉ phục vụ ba route design theo `mappingId` còn giữ lại cho tương thích ngược. Ánh xạ
   * thiếu khoá thì không quy đổi được — đó là hạn chế cố hữu của đường dẫn cũ, và cũng là lý
   * do route mới khoá thẳng theo sản phẩm.
   */
  async requireMappingProductKey(
    organizationId: string,
    mappingId: string,
  ): Promise<{ tiktokProductId: string; sellerSku: string }> {
    const mapping = await this.repo.findMappingById(organizationId, mappingId);
    if (!mapping) throw new FulfillmentMappingNotFoundException();
    if (!mapping.tiktokProductId || !mapping.sellerSku) {
      throw new FulfillmentMappingNotFoundException();
    }
    return { tiktokProductId: mapping.tiktokProductId, sellerSku: mapping.sellerSku };
  }

  async deleteMapping(
    organizationId: string,
    actorUserId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<void> {
    const existing = await this.repo.findMappingById(organizationId, id);
    if (!existing) throw new FulfillmentMappingNotFoundException();
    await this.assertMappingKeyInScope(organizationId, existing.tiktokProductId, scope);
    await this.repo.softDeleteMapping(id, actorUserId);
  }

  /**
   * Sản phẩm TikTok của ánh xạ này có xuất hiện trong shop của người dùng không.
   *
   * 🔴 Chỉ áp cho đường GHI (tạo/sửa/xoá). Bảng ánh xạ cố ý KHÔNG mang `shop_id` — nó là
   * bảng tra cứu dùng chung của cả tổ chức (TikTok Product ⇄ SKU nhà cung cấp), và một cặp
   * khoá có thể xuất hiện ở nhiều shop. Chặn ĐỌC sẽ phải nối bảng bằng một `IN` không giới
   * hạn (hàng nghìn `tiktok_product_id`) — đắt và vẫn không chính xác. Chặn GHI thì chỉ tốn
   * một truy vấn điểm, và đó mới là chỗ mất dữ liệu thật sự xảy ra.
   */
  private async assertMappingKeyInScope(
    organizationId: string,
    tiktokProductId: string | null | undefined,
    scope: PodAccessScope,
  ): Promise<void> {
    if (scope.allShops || !tiktokProductId) return;
    if (scope.shopIds.length === 0) throw new PodShopForbiddenException();

    const [fromProduct, fromOrder] = await Promise.all([
      this.prisma.podProduct.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          tiktokProductId,
          shopId: { in: scope.shopIds },
        },
        select: { id: true },
      }),
      this.prisma.podOrderItem.findFirst({
        where: {
          organizationId,
          productId: tiktokProductId,
          order: { organizationId, deletedAt: null, shopId: { in: scope.shopIds } },
        },
        select: { id: true },
      }),
    ]);
    if (!fromProduct && !fromOrder) throw new PodShopForbiddenException();
  }

  // ---------------------------------------------------------------------------
  // Trạng thái cho UI
  // ---------------------------------------------------------------------------

  /**
   * Trạng thái fulfillment của MỘT đơn POD, kèm đánh giá đủ điều kiện gửi hay chưa.
   * Dùng chung đúng một bộ kiểm tra với luồng gửi thật ⇒ UI và backend không bao giờ lệch.
   */
  /**
   * Đơn POD này có thuộc shop của người dùng không.
   *
   * 🔴 Công khai vì có một đường KHÔNG đi qua service này: `POST /orders/{id}/sync` gọi thẳng
   * `MangoFulfillmentService`. Thà để controller gọi một phép kiểm CÓ TÊN còn hơn để nó tự
   * viết lại phép so sánh `shopId` — bản sao thứ hai là bản sẽ quên cập nhật.
   */
  async assertPodOrderInScope(
    organizationId: string,
    podOrderId: string,
    scope: PodAccessScope,
  ): Promise<void> {
    if (scope.allShops) return;
    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();
    this.accessScope.assertShopAllowed(scope, order.shopId);
  }

  async getState(
    organizationId: string,
    podOrderId: string,
    scope: PodAccessScope,
    provider: FulfillmentProvider = FulfillmentProvider.MANGO,
  ): Promise<FulfillmentStateDto> {
    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();
    // 🔴 Seller chỉ xem được trạng thái fulfillment của đơn thuộc shop mình được gán.
    this.accessScope.assertShopAllowed(scope, order.shopId);

    const record = await this.repo.findByPodOrder(organizationId, podOrderId, provider);

    // Nhà cung cấp lấy TỪ TIKTOK ACCOUNT của đơn — cùng một nguồn với luồng gửi thật,
    // nên màn hình không bao giờ báo "sẵn sàng" cho một đơn mà submit sẽ từ chối.
    const assignedId = order.account?.fulfillmentAccountId ?? null;
    const account = assignedId ? await this.repo.findAccountById(organizationId, assignedId) : null;

    // Chưa cấu hình nhà cung cấp ⇒ không thể kiểm tra ánh xạ, báo rõ thay vì báo "thiếu design".
    if (!account || !account.isActive) {
      return {
        fulfillment: record ? this.toOrderDto(record) : null,
        ready: false,
        issues: [
          {
            code: account ? 'PROVIDER_INACTIVE' : 'PROVIDER_NOT_ASSIGNED',
            message: account
              ? `Nhà cung cấp "${account.name}" đang INACTIVE.`
              : 'Kết nối TikTok của đơn này chưa được gán nhà cung cấp fulfillment.',
            podOrderItemId: null,
          },
        ],
        canFulfill: false,
        canCancel: false,
        provider: account
          ? { id: account.id, name: account.name, type: account.provider, isActive: false }
          : null,
      };
    }

    // 🔴 Phạm vi TỔ CHỨC, không phải tài khoản: danh tính của ánh xạ là
    // (organization, Product ID, Seller SKU) và DB có UNIQUE đúng bộ ba đó. Lọc thêm theo
    // tài khoản sẽ khiến màn hình đơn (tra org-wide) và luồng gửi đơn nhìn thấy hai kết quả
    // khác nhau — đúng triệu chứng "danh sách báo đã ánh xạ mà bấm Fulfill lại bảo thiếu".
    // Ánh xạ khai cho nhà cung cấp khác được `check()` báo bằng MAPPING_PROVIDER_MISMATCH.
    const mappings = await this.repo.listMappingsForOrganization(organizationId);
    const designsByKey = await this.loadDesignsByKey(organizationId);
    const check = this.readiness.check(
      order,
      mappings,
      designsByKey,
      this.publicBaseUrl(),
      account.id,
    );
    const status = record?.status ?? FulfillmentStatus.DRAFT;

    return {
      fulfillment: record ? this.toOrderDto(record) : null,
      ready: check.ready,
      issues: check.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        podOrderItemId: issue.podOrderItemId ?? null,
        // Ngữ cảnh để giao diện mở dialog ánh xạ nhanh (chỉ có với MAPPING_MISSING).
        tiktokProductId: issue.tiktokProductId ?? null,
        tiktokSkuId: issue.tiktokSkuId ?? null,
        sellerSku: issue.sellerSku ?? null,
        productName: issue.productName ?? null,
        skuName: issue.skuName ?? null,
        productCategory: issue.productCategory ?? null,
      })),
      canFulfill: check.ready && FULFILLABLE_STATUSES.includes(status),
      canCancel: Boolean(record) && CANCELLABLE_STATUSES.includes(status),
      provider: { id: account.id, name: account.name, type: account.provider, isActive: true },
    };
  }

  /**
   * Trạng thái fulfillment của NHIỀU đơn — cho màn hình danh sách.
   * MỘT truy vấn cho cả trang (không N+1); chỉ trả trạng thái, không kiểm tra readiness
   * (readiness cần đọc design/ánh xạ, quá nặng cho danh sách).
   */
  async getStatesByPodOrderIds(
    organizationId: string,
    podOrderIds: string[],
  ): Promise<Map<string, FulfillmentOrderDto>> {
    const records = await this.repo.findByPodOrderIds(organizationId, podOrderIds);
    return new Map(
      records.map((record) => [record.podOrderId, this.toOrderDto({ ...record, items: [] })]),
    );
  }

  async listHistory(
    organizationId: string,
    podOrderId: string,
    scope: PodAccessScope,
    provider: FulfillmentProvider = FulfillmentProvider.MANGO,
  ): Promise<FulfillmentHistoryDto[]> {
    await this.assertPodOrderInScope(organizationId, podOrderId, scope);
    const record = await this.repo.findByPodOrder(organizationId, podOrderId, provider);
    if (!record) throw new FulfillmentOrderNotFoundException();
    const histories = await this.repo.listHistory(organizationId, record.id);
    return histories.map((history) => ({
      id: history.id,
      eventType: history.eventType,
      trigger: history.trigger,
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      providerStatus: history.providerStatus,
      success: history.success,
      message: history.message,
      payload: history.payload,
      durationMs: history.durationMs,
      requestId: history.requestId,
      createdAt: history.createdAt.toISOString(),
    }));
  }

  async listErrors(
    organizationId: string,
    podOrderId: string,
    scope: PodAccessScope,
    provider: FulfillmentProvider = FulfillmentProvider.MANGO,
  ): Promise<FulfillmentErrorDto[]> {
    await this.assertPodOrderInScope(organizationId, podOrderId, scope);
    const record = await this.repo.findByPodOrder(organizationId, podOrderId, provider);
    if (!record) throw new FulfillmentOrderNotFoundException();
    const errors = await this.repo.listErrors(organizationId, record.id);
    return errors.map((error) => ({
      id: error.id,
      operation: error.operation,
      errorClass: error.errorClass,
      httpStatus: error.httpStatus,
      providerCode: error.providerCode,
      message: error.message,
      validationErrors: error.validationErrors,
      retryable: error.retryable,
      requestId: error.requestId,
      createdAt: error.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async requireAccount(
    organizationId: string,
    provider: FulfillmentProvider,
  ): Promise<FulfillmentAccount> {
    const account = await this.repo.findActiveAccount(organizationId, provider);
    if (!account) throw new FulfillmentAccountNotFoundException();
    return account;
  }

  /**
   * Tài khoản nhà cung cấp cho một ánh xạ sắp tạo.
   *
   * 🔴 Ưu tiên `accountId` người dùng CHỌN. Trước đây service luôn suy từ `provider` rồi lấy
   * tài khoản mặc định — nghĩa là tổ chức có hai tài khoản MANGO thì dialog cho chọn tài
   * khoản nào cũng vô nghĩa, ánh xạ vẫn gắn vào tài khoản mặc định. Đơn thuộc tài khoản còn
   * lại sẽ báo "ánh xạ khai cho nhà cung cấp khác" mà người dùng không hiểu vì sao.
   *
   * Bỏ trống ⇒ giữ hành vi cũ (tài khoản mặc định của nhà cung cấp) để không phá client cũ.
   */
  private async resolveMappingAccount(
    organizationId: string,
    provider: FulfillmentProvider,
    accountId?: string,
  ): Promise<FulfillmentAccount> {
    if (!accountId) return this.requireAccount(organizationId, provider);

    const account = await this.repo.findAccountById(organizationId, accountId);
    if (!account) throw new FulfillmentAccountNotFoundException();
    return account;
  }

  /**
   * Chặn ánh xạ thứ hai cho cùng một (Product ID + Seller SKU).
   *
   * 🔴 Đây là điều kiện "một Product ID + Seller SKU chỉ có MỘT bộ Design". DB cũng có UNIQUE
   * index cho việc này (hàng rào cuối, chống chạy đua giữa hai request); kiểm ở đây để người
   * dùng nhận thông báo nghiệp vụ thay vì lỗi ràng buộc thô.
   */
  private async assertNoConflict(
    organizationId: string,
    dto: UpsertProductMappingDto,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await this.repo.findConflictingMapping(
      organizationId,
      { tiktokProductId: dto.tiktokProductId, sellerSku: dto.sellerSku },
      excludeId,
    );
    if (conflict) throw new FulfillmentMappingConflictException();
  }

  private publicBaseUrl(): string | undefined {
    return this.config.get<string>('storage.local.publicBaseUrl') || undefined;
  }

  /** DTO tài khoản — KHÔNG BAO GIỜ trả API key hay secret đã lưu. */
  private toAccountDto(
    account: FulfillmentAccount,
    /** Secret vừa sinh: chỉ hiện MỘT LẦN ngay sau khi tạo để người dùng đăng ký webhook. */
    plainWebhookSecret?: string,
    /** Số kết nối TikTok đang dùng nhà cung cấp này (chỉ có ở màn hình danh sách). */
    linkedTiktokAccounts = 0,
  ): FulfillmentAccountDto {
    const base = this.config.get<string>('fulfillment.webhookBaseUrl', '');
    return {
      id: account.id,
      provider: account.provider,
      name: account.name,
      apiKeyHint: account.apiKeyHint,
      isActive: account.isActive,
      isDefault: account.isDefault,
      defaultProductionLine: account.defaultProductionLine,
      defaultShippingMethod: account.defaultShippingMethod,
      defaultFacility: account.defaultFacility,
      webhookUrl:
        plainWebhookSecret && base
          ? `${base.replace(/\/+$/, '')}/api/v1/fulfillment/webhooks/mango/${plainWebhookSecret}`
          : null,
      providerWebhookId: account.providerWebhookId,
      lastUsedAt: account.lastUsedAt?.toISOString() ?? null,
      lastErrorMsg: account.lastErrorMsg,
      updatedAt: account.updatedAt.toISOString(),
      // `status` là dạng đọc được của `isActive` — KHÔNG thêm cột thứ hai để tránh hai
      // nguồn sự thật cho cùng một khái niệm.
      status: account.isActive ? 'ACTIVE' : 'INACTIVE',
      baseUrl: account.baseUrlOverride,
      linkedTiktokAccounts,
      createdAt: account.createdAt.toISOString(),
    };
  }

  /**
   * Ánh xạ → DTO.
   *
   * Nhận `MappingWithDesigns` (không phải bản ghi trần) vì màn hình Product Mapping LÀ nơi
   * quản trị design: danh sách phải trả kèm file in và tình trạng, nếu không giao diện lại
   * phải gọi thêm N lượt cho N dòng.
   */
  private toMappingDto(
    mapping: MappingWithDesigns,
    providerName: string | null = null,
    updatedByName: string | null = null,
    /**
     * Design của SẢN PHẨM này, do nơi gọi nạp sẵn.
     *
     * 🔴 Không đọc từ `mapping.designs` được nữa: design đã tách khỏi ánh xạ và khoá theo
     * (Product ID + Seller SKU). Nhận từ ngoài vào giữ cho hàm này thuần và ép nơi gọi phải
     * nạp một lần cho cả trang thay vì mỗi dòng một truy vấn.
     */
    designRows: DesignForDto[] = [],
  ): ProductMappingDto {
    const designs = this.designMapper.toDtoList(designRows);
    return {
      id: mapping.id,
      tiktokProductId: mapping.tiktokProductId,
      tiktokSkuId: mapping.tiktokSkuId,
      sellerSku: mapping.sellerSku,
      providerSku: mapping.providerSku,
      baseCost: mapping.baseCost === null ? null : Number(mapping.baseCost),
      designs,
      designStatus: this.designMapper.statusOf(designRows),
      updatedByName,
      providerProductId: mapping.providerProductId,
      providerVariantId: mapping.providerVariantId,
      providerProductName: mapping.providerProductName,
      providerVariantName: mapping.providerVariantName,
      providerColor: mapping.providerColor,
      providerSize: mapping.providerSize,
      productionConfig: mapping.productionConfig,
      placementMap: mapping.placementMap,
      isActive: mapping.isActive,
      // `status` là dạng đọc được của `isActive` — không thêm cột thứ hai cho cùng khái niệm.
      status: mapping.isActive ? 'ACTIVE' : 'INACTIVE',
      providerName,
      note: mapping.note,
      createdAt: mapping.createdAt.toISOString(),
      updatedAt: mapping.updatedAt.toISOString(),
    };
  }

  toOrderDto(
    record: FulfillmentOrderWithRelations | (FulfillmentOrder & { items: [] }),
  ): FulfillmentOrderDto {
    return {
      id: record.id,
      podOrderId: record.podOrderId,
      provider: record.provider,
      status: record.status,
      providerStatus: record.providerStatus,
      externalOrderId: record.externalOrderId,
      providerOrderId: record.providerOrderId,
      providerFulfillId: record.providerFulfillId,
      trackingNumber: record.trackingNumber,
      trackingStatus: record.trackingStatus,
      trackingUrl: record.trackingUrl,
      carrier: record.carrier,
      labelUrl: record.labelUrl,
      shippingMethod: record.shippingMethod,
      productionLine: record.productionLine,
      total: record.total === null ? null : Number(record.total),
      currency: record.currency,
      attemptCount: record.attemptCount,
      lastErrorCode: record.lastErrorCode,
      lastErrorMessage: record.lastErrorMessage,
      submittedAt: record.submittedAt?.toISOString() ?? null,
      lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
      cancelledAt: record.cancelledAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      items: (record.items ?? []).map((item) => ({
        id: item.id,
        podOrderItemId: item.podOrderItemId,
        providerSku: item.providerSku,
        quantity: item.quantity,
        printFiles: item.printFiles,
        color: item.color,
        size: item.size,
      })),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
