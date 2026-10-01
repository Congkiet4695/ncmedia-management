import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentAccount,
  FulfillmentOrder,
  FulfillmentProvider,
  FulfillmentTrigger,
  FulfillmentStatus,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
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
  FulfillmentCancellationDto,
  FulfillmentStateDto,
  FulfillmentStateItemDto,
  PaginatedProductMappingDto,
  ProductMappingDto,
  ProductMappingQueryDto,
  TiktokProductOptionDto,
  UpdateFulfillmentAccountDto,
  UpsertProductMappingDto,
} from '../dto/fulfillment.dto';
import {
  FULFILLMENT_PROVIDER_LABELS,
  FULFILLMENT_WEBHOOK_PATHS,
} from '../constants/fulfillment-provider.constants';
import {
  FulfillmentAccountNotFoundException,
  FulfillmentMappingConflictException,
  FulfillmentMappingNotFoundException,
  FulfillmentOrderNotFoundException,
  FulfillmentValidationException,
} from '../exceptions/fulfillment.exceptions';
import { MANGO_SHIPPING_METHODS } from '../mango/constants/mango.constants';
import { SellerwixCredentialService } from '../sellerwix/services/sellerwix-credential.service';
import { FulfillmentProviderGateway } from './fulfillment-provider.gateway';
import { FulfillmentVariantPriceService } from './fulfillment-variant-price.service';
import { FulfillmentCatalogSyncService } from './fulfillment-catalog-sync.service';
import { ProductMappingAutoService } from './product-mapping-auto.service';
import { ProductDesignMapper, type DesignForDto } from '../mappers/product-design.mapper';
import {
  FulfillmentOrderWithRelations,
  FulfillmentRepository,
} from '../repositories/fulfillment.repository';
import { createMappingIndex, findMappingInIndex, mappingKeyOf } from '../shared/mapping-match';
import {
  FulfillmentReadinessService,
  MappingWithDesigns,
  issueSectionOf,
} from './fulfillment-readiness.service';
import { FulfillmentShippingLabelService } from './fulfillment-shipping-label.service';
import {
  CANCELLABLE_FULFILLMENT_STATUSES,
  NON_BLOCKING_FULFILLMENT_STATUSES,
  SUBMITTABLE_FULFILLMENT_STATUSES,
} from '../shared/fulfillment-lifecycle';
import { productCostOf } from '../shared/product-cost';


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
    private readonly gateway: FulfillmentProviderGateway,
    private readonly variantPrice: FulfillmentVariantPriceService,
    private readonly catalogSync?: FulfillmentCatalogSyncService,
    private readonly autoMap?: ProductMappingAutoService,
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
    // Secret webhook sinh ngay lúc tạo: Mango lẫn Sellerwix đều không ký payload nên đây là lớp
    // xác thực duy nhất cho request gọi về (xem docs/fulfillment/README.md §Webhook).
    const webhookSecret = randomBytes(24).toString('hex');
    this.assertProviderFields(dto.provider, dto);

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
      // Sellerwix: phương thức vận chuyển phụ thuộc TỪNG biến thể ⇒ không có mặc định chung
      // (chuỗi rỗng = "chọn ở màn hình Fulfill"). Mango giữ mặc định cũ.
      defaultShippingMethod:
        dto.defaultShippingMethod ??
        (dto.provider === FulfillmentProvider.SELLERWIX ? '' : 'standard'),
      defaultFacility: dto.defaultFacility ?? null,
      // Sellerwix xác thực CHỈ bằng API Key — `privateKey`/`publicKeyId` (cũ) không còn được lưu.
      secretEnc: null,
      providerConfig:
        dto.provider === FulfillmentProvider.SELLERWIX ? { storeId: dto.storeId ?? '' } : Prisma.JsonNull,
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

    this.startInitialCatalogSync(organizationId, actorUserId, account.id);
    return this.toAccountDto(account, webhookSecret);
  }

  /**
   * Nhà cung cấp vừa được thêm ⇒ đồng bộ danh mục NGAY (chạy nền).
   *
   * 🔴 Không có bước này, danh mục của nhà cung cấp mới trống cho tới khi ai đó nhớ bấm "Đồng bộ
   * danh mục" (lịch đồng bộ mặc định tắt): ô Provider Product rỗng ⇒ không lưu được cấu hình sản
   * phẩm ⇒ Sellerwix không có SKU biến thể để hỏi phương thức vận chuyển — chính là lỗi "Shipping
   * method trống". Lỗi ở đây KHÔNG làm hỏng việc thêm nhà cung cấp (chỉ ghi log; người dùng vẫn
   * đồng bộ tay được).
   */
  private startInitialCatalogSync(organizationId: string, actorUserId: string, accountId: string): void {
    if (!this.catalogSync) return;
    this.catalogSync
      .startSync(organizationId, accountId, FulfillmentTrigger.MANUAL, actorUserId, () =>
        this.autoMap
          ? this.autoMap.resolveOrganization(organizationId, { accountFilter: accountId, actorUserId })
          : Promise.resolve(),
      )
      .catch((error: unknown) =>
        this.logger.warn({
          module: 'fulfillment',
          operation: 'account.create.catalog-sync',
          organizationId,
          accountId,
          msg: `Không khởi động được đồng bộ danh mục cho nhà cung cấp mới: ${(error as Error).message}`,
        }),
      );
  }

  async updateAccount(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdateFulfillmentAccountDto,
  ): Promise<FulfillmentAccountDto> {
    // 🔴 Đường GHI dùng `findOwnedAccountById`: tài khoản DÙNG CHUNG (`is_global`) chỉ Super
    // Admin mới được sửa. Tổ chức đọc được nó, nhưng không được đổi khoá API hay tắt nó đi
    // cho tất cả những tổ chức còn lại.
    const existing = await this.repo.findOwnedAccountById(organizationId, id);
    if (!existing) throw new FulfillmentAccountNotFoundException();
    this.assertProviderFields(existing.provider, dto);

    // Giữ NGUYÊN mọi khoá cũ trong `provider_config` (vd `publicKeyId` của tài khoản tạo trước khi
    // chuyển sang xác thực API Key) — chỉ ghi đè `storeId` khi người dùng gửi.
    const currentConfig =
      existing.providerConfig && typeof existing.providerConfig === 'object' && !Array.isArray(existing.providerConfig)
        ? (existing.providerConfig)
        : {};

    const account = await this.repo.updateAccount(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.baseUrl !== undefined ? { baseUrlOverride: dto.baseUrl || null } : {}),
      ...(existing.provider === FulfillmentProvider.SELLERWIX && dto.storeId !== undefined
        ? { providerConfig: { ...currentConfig, storeId: dto.storeId } }
        : {}),
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
    // Xoá cũng là đường ghi — xem chú thích ở `updateAccount`.
    const existing = await this.repo.findOwnedAccountById(organizationId, id);
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
      .filter((account) => account.isActive && this.gateway.isSupported(account.provider))
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
      // `total === 0 ⇒ totalPages = 0` — cùng công thức với mọi service khác trong hệ
      // thống. `Math.max(1, …)` sẽ trả về 1 cho danh sách RỖNG, và giao diện hiện
      // "Trang 1 / 1" bên dưới một cái bảng không có dòng nào.
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
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
    const pricing = await this.resolveMappingBaseCost(organizationId, account.id, dto, null);

    const mapping = await this.repo.createMapping({
      organizationId,
      accountId: account.id,
      provider: account.provider,
      tiktokProductId: dto.tiktokProductId,
      tiktokSkuId: dto.tiktokSkuId ?? null,
      sellerSku: dto.sellerSku,
      providerSku: dto.providerSku,
      baseCost: pricing.baseCost,
      providerProductId: dto.providerProductId ?? null,
      providerVariantId: dto.providerVariantId ?? null,
      providerProductName: dto.providerProductName ?? null,
      providerVariantName: dto.providerVariantName ?? null,
      providerColor: dto.providerColor ?? null,
      providerSize: dto.providerSize ?? null,
      productionConfig: dto.productionConfig ?? null,
      productionLine: dto.productionLine ?? null,
      placementMap: (dto.placementMap ?? null) as Prisma.InputJsonValue,
      isActive: dto.isActive ?? true,
      note: dto.note ?? null,
      createdBy: actorUserId,
    });
    return {
      ...this.toMappingDto(mapping, null, null, await this.loadDesignsFor(mapping)),
      baseCostStatus: pricing.status,
      baseCostMessage: pricing.message,
    };
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
    // 🔴 Đổi nhà cung cấp của sản phẩm (vd Mango → Sellerwix) là một thao tác SỬA ánh xạ: danh tính
    // (Product ID + Seller SKU) giữ nguyên, chỉ tài khoản/SKU nhà cung cấp đổi. Bỏ qua `accountId`
    // ở đây thì ánh xạ kẹt ở nhà cung cấp cũ và đơn bị MAPPING_PROVIDER_MISMATCH mãi.
    const account = dto.accountId
      ? await this.resolveMappingAccount(organizationId, existing.provider, dto.accountId)
      : null;
    const pricing = await this.resolveMappingBaseCost(
      organizationId,
      account?.id ?? existing.accountId,
      dto,
      existing,
    );

    const mapping = await this.repo.updateMapping(id, {
      ...(account ? { accountId: account.id, provider: account.provider } : {}),
      tiktokProductId: dto.tiktokProductId,
      tiktokSkuId: dto.tiktokSkuId ?? null,
      sellerSku: dto.sellerSku,
      providerSku: dto.providerSku,
      baseCost: pricing.baseCost,
      providerProductId: dto.providerProductId ?? null,
      providerVariantId: dto.providerVariantId ?? null,
      providerProductName: dto.providerProductName ?? null,
      providerVariantName: dto.providerVariantName ?? null,
      providerColor: dto.providerColor ?? null,
      providerSize: dto.providerSize ?? null,
      productionConfig: dto.productionConfig ?? null,
      productionLine: dto.productionLine ?? null,
      placementMap: (dto.placementMap ?? null) as Prisma.InputJsonValue,
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      note: dto.note ?? null,
      updatedBy: actorUserId,
    });
    return {
      ...this.toMappingDto(mapping, null, null, await this.loadDesignsFor(mapping)),
      baseCostStatus: pricing.status,
      baseCostMessage: pricing.message,
    };
  }

  /**
   * Base Cost của một ánh xạ — **backend tự lấy** từ giá của ĐÚNG biến thể nhà cung cấp đã chọn
   * (`providerVariantId` + `providerSku` trong tài khoản của ánh xạ). `dto.baseCost` bị bỏ qua: không
   * nhận giá từ frontend.
   *
   * Không lấy được giá:
   *  - vẫn là biến thể cũ ⇒ GIỮ Base Cost đang có (không ghi đè bằng null/0);
   *  - biến thể KHÁC ⇒ để trống: giá cũ là của một SKU khác, giữ lại là sai số liệu lợi nhuận.
   * Lỗi database khi tra giá ⇒ ném ra, cả thao tác lưu thất bại (không ghi gì).
   */
  private async resolveMappingBaseCost(
    organizationId: string,
    accountId: string,
    dto: UpsertProductMappingDto,
    existing: { accountId: string; providerSku: string; providerVariantId: string | null; baseCost: Prisma.Decimal | null } | null,
  ): Promise<{
    baseCost: number | null;
    status: 'PROVIDER_PRICE' | 'UNCHANGED' | 'PRICE_NOT_FOUND';
    message: string | null;
  }> {
    const result = await this.variantPrice.lookup(organizationId, accountId, {
      externalVariantId: dto.providerVariantId ?? null,
      sku: dto.providerSku,
    });
    if (result.ok) return { baseCost: result.price.price, status: 'PROVIDER_PRICE', message: null };

    const sameVariant =
      existing !== null &&
      existing.accountId === accountId &&
      existing.providerSku === dto.providerSku &&
      (existing.providerVariantId ?? null) === (dto.providerVariantId ?? null);
    if (sameVariant) {
      return {
        baseCost: existing.baseCost === null ? null : Number(existing.baseCost),
        status: 'UNCHANGED',
        message: result.message,
      };
    }
    return { baseCost: null, status: 'PRICE_NOT_FOUND', message: result.message };
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

  /**
   * Trạng thái fulfillment của MỘT đơn.
   *
   * 🔴 `selectedAccountId` là nhà cung cấp người dùng đang chọn trên màn hình. Trạng thái phải
   * được tính theo ĐÚNG nhà cung cấp đó (ánh xạ sản phẩm khai cho nhà cung cấp khác sẽ bị
   * `MAPPING_PROVIDER_MISMATCH` chặn), nếu không thì màn hình báo sẵn sàng cho một nhà cung
   * cấp mà lúc gửi lại dùng nhà cung cấp khác.
   */
  async getState(
    organizationId: string,
    podOrderId: string,
    scope: PodAccessScope,
    selectedAccountId?: string,
  ): Promise<FulfillmentStateDto> {
    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();
    // 🔴 Seller chỉ xem được trạng thái fulfillment của đơn thuộc shop mình được gán.
    this.accessScope.assertShopAllowed(scope, order.shopId);

    // Bản ghi HIỆN HÀNH bất kể nhà cung cấp — đơn đã gửi Sellerwix mở ra phải thấy Sellerwix.
    const current = await this.repo.findCurrentByPodOrder(organizationId, podOrderId);

    // 🔴 Thứ tự chọn nhà cung cấp GIỐNG HỆT `FulfillmentProviderGateway.resolveAccountForFulfill`:
    // người dùng chọn → bản ghi hiện hành → nhà cung cấp gán cho kết nối TikTok → nhà cung cấp
    // DUY NHẤT khả dụng. Hai nơi lệch nhau là màn hình đánh giá một nhà cung cấp còn luồng gửi
    // dùng nhà cung cấp khác. Danh sách gồm MỌI nhà cung cấp đã tích hợp (Mango, Sellerwix…).
    const assignedId = order.account?.fulfillmentAccountId ?? null;
    const usable = (await this.repo.listAccounts(organizationId)).filter(
      (entry) => entry.isActive && this.gateway.isSupported(entry.provider),
    );
    const availableProviders = usable.map((entry) => ({
      id: entry.id,
      name: entry.name,
      provider: entry.provider,
      isActive: entry.isActive,
      isGlobal: entry.isGlobal,
      isAssignedToAccount: entry.id === assignedId,
    }));

    const selected = selectedAccountId?.trim();
    const single = usable.length === 1 ? usable[0] : null;
    const fallbackId = current?.accountId ?? assignedId;
    const account = selected
      ? await this.repo.findAccountById(organizationId, selected)
      : fallbackId
        ? ((await this.repo.findAccountById(organizationId, fallbackId)) ?? single)
        : single;
    const record = account
      ? await this.repo.findByPodOrder(organizationId, podOrderId, account.provider)
      : current;

    // Chưa cấu hình nhà cung cấp ⇒ không thể kiểm tra ánh xạ, báo rõ thay vì báo "thiếu design".
    if (!account || !account.isActive) {
      return {
        fulfillment: record ? this.toOrderDto(record) : null,
        ready: false,
        issues: [
          {
            section: 'PROVIDER' as const,
            code: account ? 'PROVIDER_INACTIVE' : 'PROVIDER_NOT_SELECTED',
            message: account
              ? `Nhà cung cấp "${account.name}" đang INACTIVE.`
              : availableProviders.length > 1
                ? 'Đơn này có nhiều nhà cung cấp fulfillment dùng được — chọn một cái ở ô ' +
                  '"Nhà cung cấp" rồi gửi.'
                : 'Chưa có nhà cung cấp fulfillment nào dùng được. Thêm nhà cung cấp ở POD → ' +
                  'Fulfillment Providers, hoặc nhờ Super Admin bật nhà cung cấp dùng chung.',
            podOrderItemId: null,
          },
        ],
        canFulfill: false,
        canCancel: false,
        cancellation: await this.cancellationOf(organizationId, record),
        provider: account
          ? { id: account.id, name: account.name, type: account.provider, isActive: false }
          : null,
        availableProviders,
        // Chưa có nhà cung cấp thì chưa tra ánh xạ được, nhưng danh sách dòng hàng vẫn phải
        // có — giao diện dựng khối cấu hình theo đúng mảng này.
        items: order.items.map((item) => ({
          podOrderItemId: item.id,
          tiktokProductId: item.productId,
          sellerSku: item.sellerSku,
          mapping: null,
        })),
        shippingLabel: FulfillmentShippingLabelService.labelOf(order),
        shippingMode: 'ADDRESS' as const,
        recipientMasked: order.recipientMasked,
      };
    }

    // 🔴 Phạm vi TỔ CHỨC, không phải tài khoản: danh tính của ánh xạ là
    // (organization, Product ID, Seller SKU) và DB có UNIQUE đúng bộ ba đó. Lọc thêm theo
    // tài khoản sẽ khiến màn hình đơn (tra org-wide) và luồng gửi đơn nhìn thấy hai kết quả
    // khác nhau — đúng triệu chứng "danh sách báo đã ánh xạ mà bấm Fulfill lại bảo thiếu".
    // Ánh xạ khai cho nhà cung cấp khác được `check()` báo bằng MAPPING_PROVIDER_MISMATCH.
    const mappings = await this.repo.listMappingsForOrganization(organizationId);
    const designsByKey = await this.loadDesignsByKey(organizationId);
    // Luật vị trí in của ĐÚNG nhà cung cấp đang chọn (Sellerwix: `print_areas` của biến thể).
    const check = this.readiness.check(
      order,
      mappings,
      designsByKey,
      this.publicBaseUrl(),
      account.id,
      await this.gateway.placementResolver(account, mappings),
    );
    const status = record?.status ?? FulfillmentStatus.DRAFT;
    // Đơn đang ở xưởng của nhà cung cấp KHÁC ⇒ không cho gửi thêm (sản xuất hai lần).
    const blocking = await this.repo.findBlockingRecordOfOtherProvider(
      organizationId,
      podOrderId,
      account.provider,
    );
    const blockingIssue = blocking
      ? [
          {
            section: 'PROVIDER' as const,
            code: 'SUBMITTED_TO_OTHER_PROVIDER',
            message:
              `Đơn đã được gửi sang ${FULFILLMENT_PROVIDER_LABELS[blocking.provider]} ` +
              `(${blocking.status}). Huỷ ở đó trước khi gửi sang nhà cung cấp khác.`,
            podOrderItemId: null,
          },
        ]
      : [];

    return {
      fulfillment: record ? this.toOrderDto(record) : null,
      ready: check.ready && !blocking,
      issues: [
        ...blockingIssue,
        ...check.issues.map((issue) => ({
        section: issueSectionOf(issue.code),
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
      ],
      // CANCELLED (nhà cung cấp đã xác nhận huỷ) ⇒ fulfill lại được, như một lần thử mới.
      canFulfill: check.ready && !blocking && SUBMITTABLE_FULFILLMENT_STATUSES.includes(status),
      canCancel: Boolean(record) && CANCELLABLE_FULFILLMENT_STATUSES.includes(status),
      cancellation: await this.cancellationOf(organizationId, record),
      provider: { id: account.id, name: account.name, type: account.provider, isActive: true },
      // 🔴 Ghép bằng ĐÚNG chỉ mục mà `readiness.check()` vừa dùng ở trên: màn hình và luồng
      // gửi không thể nhìn thấy hai ánh xạ khác nhau cho cùng một dòng hàng.
      items: this.toStateItems(order, mappings, designsByKey, account.name),
      // Nhãn và cách gửi đều do `check()` quyết — giao diện không tự suy luận lại.
      shippingLabel: check.shippingLabel ?? null,
      shippingMode: check.shippingMode ?? 'ADDRESS',
      recipientMasked: order.recipientMasked,
      availableProviders,
    };
  }

  /**
   * Từng dòng hàng kèm ánh xạ ĐÃ GHÉP.
   *
   * 🔴 Không truy vấn thêm: `mappings` và `designsByKey` đã được nạp một lần ở `getState`.
   * Giao diện nhờ đó không phải tự tải danh sách ánh xạ rồi tự ghép lại — việc mà nó chỉ làm
   * đúng khi ánh xạ tình cờ nằm trong trang nó tải về.
   */
  private toStateItems(
    order: PodOrderWithRelations,
    mappings: MappingWithDesigns[],
    designsByKey: Map<string, DesignForDto[]>,
    providerName: string,
  ): FulfillmentStateItemDto[] {
    const index = createMappingIndex(mappings);
    return order.items.map((item) => {
      const mapping = findMappingInIndex(item, index);
      const key = mappingKeyOf(item.productId, item.sellerSku);
      return {
        podOrderItemId: item.id,
        tiktokProductId: item.productId,
        sellerSku: item.sellerSku,
        mapping: mapping
          ? this.toMappingDto(
              mapping,
              providerName,
              null,
              (key ? designsByKey.get(key) : undefined) ?? [],
            )
          : null,
      };
    });
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
  ): Promise<FulfillmentHistoryDto[]> {
    await this.assertPodOrderInScope(organizationId, podOrderId, scope);
    // 🔴 MỌI lần thử của đơn, kể cả lần đã huỷ rồi được lưu trữ khi fulfill lại — lịch sử của
    // lần gửi trước không được biến mất chỉ vì đơn đã được gửi lại.
    const attempts = await this.repo.listAttemptIds(organizationId, podOrderId);
    if (attempts.length === 0) throw new FulfillmentOrderNotFoundException();
    const histories = await this.repo.listHistory(
      organizationId,
      attempts.map((attempt) => attempt.id),
    );
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
  ): Promise<FulfillmentErrorDto[]> {
    await this.assertPodOrderInScope(organizationId, podOrderId, scope);
    const attempts = await this.repo.listAttemptIds(organizationId, podOrderId);
    if (attempts.length === 0) throw new FulfillmentOrderNotFoundException();
    const errors = await this.repo.listErrors(
      organizationId,
      attempts.map((attempt) => attempt.id),
    );
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

  /**
   * Trường cấu hình nào thuộc nhà cung cấp nào — từ chối trường KHÔNG có ý nghĩa với nhà cung cấp
   * (vd Private Key cho Mango, production line cho Sellerwix) thay vì lưu một giá trị không ai dùng.
   */
  private assertProviderFields(
    provider: FulfillmentProvider,
    dto: {
      privateKey?: string;
      storeId?: string;
      publicKeyId?: string;
      defaultProductionLine?: string;
      defaultFacility?: string;
      defaultShippingMethod?: string;
    },
  ): void {
    const errors: Array<{ field: string; message: string }> = [];
    const label = FULFILLMENT_PROVIDER_LABELS[provider];
    const notFor = (field: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') {
        errors.push({ field, message: `${label} không dùng trường này.` });
      }
    };

    if (provider === FulfillmentProvider.SELLERWIX) {
      notFor('defaultProductionLine', dto.defaultProductionLine);
      notFor('defaultFacility', dto.defaultFacility);
      // 🔴 Sellerwix chỉ cần API Key (DTO đã bắt buộc). `privateKey` / `publicKeyId` là trường CŨ:
      // được nhận để client cũ không vỡ, nhưng bị BỎ QUA — không kiểm, không chặn, không lưu.
      // Store ID tuỳ chọn ở đây; chỉ bắt buộc khi tạo/tra đơn (`requireStoreId`).
    } else {
      notFor('privateKey', dto.privateKey);
      notFor('storeId', dto.storeId);
      notFor('publicKeyId', dto.publicKeyId);
      if (
        provider === FulfillmentProvider.MANGO &&
        dto.defaultShippingMethod &&
        !(MANGO_SHIPPING_METHODS as readonly string[]).includes(dto.defaultShippingMethod)
      ) {
        errors.push({
          field: 'defaultShippingMethod',
          message: `Phải thuộc: ${MANGO_SHIPPING_METHODS.join(', ')}.`,
        });
      }
    }

    if (errors.length === 0) return;
    throw new FulfillmentValidationException(
      `Cấu hình ${label} chưa hợp lệ: ${errors.map((error) => `${error.field} — ${error.message}`).join(' · ')}`,
      errors,
    );
  }

  private publicBaseUrl(): string | undefined {
    return this.config.get<string>('storage.local.publicBaseUrl') || undefined;
  }

  /** DTO tài khoản — KHÔNG BAO GIỜ trả API key hay secret đã lưu. */
  /**
   * `public` vì khu vực quản trị NỀN TẢNG (`PlatformFulfillmentService`) trả về cùng một
   * hình dạng DTO — dựng bản sao thứ hai là mở đường cho hai hình dạng trôi khỏi nhau.
   */
  toAccountDto(
    account: FulfillmentAccount,
    /** Secret vừa sinh: chỉ hiện MỘT LẦN ngay sau khi tạo để người dùng đăng ký webhook. */
    plainWebhookSecret?: string,
    /** Số kết nối TikTok đang dùng nhà cung cấp này (chỉ có ở màn hình danh sách). */
    linkedTiktokAccounts = 0,
  ): FulfillmentAccountDto {
    const base = this.config.get<string>('fulfillment.webhookBaseUrl', '');
    const webhookPath = FULFILLMENT_WEBHOOK_PATHS[account.provider];
    const sellerwix =
      account.provider === FulfillmentProvider.SELLERWIX
        ? SellerwixCredentialService.readConfig(account.providerConfig)
        : null;
    return {
      id: account.id,
      provider: account.provider,
      name: account.name,
      apiKeyHint: account.apiKeyHint,
      isActive: account.isActive,
      isDefault: account.isDefault,
      isGlobal: account.isGlobal,
      defaultProductionLine: account.defaultProductionLine,
      defaultShippingMethod: account.defaultShippingMethod,
      defaultFacility: account.defaultFacility,
      webhookUrl:
        plainWebhookSecret && base && webhookPath
          ? `${base.replace(/\/+$/, '')}/api/v1/fulfillment/webhooks/${webhookPath}/${plainWebhookSecret}`
          : null,
      // Cấu hình KHÔNG bí mật của Sellerwix — được phép hiển thị để người dùng đối chiếu.
      storeId: sellerwix?.storeId || null,
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
      productionLine: mapping.productionLine,
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

  /**
   * Thông tin huỷ của bản ghi ĐÃ HUỶ: thời điểm (`cancelled_at`), người bấm + lý do (nhật ký
   * CANCEL_REQUEST). Nhật ký cũ không có `payload.reason` ⇒ đọc từ câu "Yêu cầu huỷ: …".
   */
  private async cancellationOf(
    organizationId: string,
    record: FulfillmentOrder | null,
  ): Promise<FulfillmentCancellationDto | null> {
    if (!record || record.status !== FulfillmentStatus.CANCELLED) return null;
    const request = await this.repo.findLatestCancelRequest(organizationId, record.id);
    const payloadReason =
      request?.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)
        ? (request.payload as { reason?: unknown }).reason
        : undefined;
    const messageReason = request?.message?.startsWith('Yêu cầu huỷ: ')
      ? request.message.slice('Yêu cầu huỷ: '.length)
      : null;
    return {
      cancelledAt: (record.cancelledAt ?? request?.createdAt)?.toISOString() ?? null,
      cancelledBy: request?.performedBy
        ? await this.repo.findUserDisplayName(organizationId, request.performedBy)
        : null,
      reason: typeof payloadReason === 'string' && payloadReason ? payloadReason : messageReason,
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
      facility: record.facility,
      speedType: record.speedType,
      subtotal: record.subtotal === null ? null : Number(record.subtotal),
      shippingFee: record.shippingFee === null ? null : Number(record.shippingFee),
      tax: record.tax === null ? null : Number(record.tax),
      total: record.total === null ? null : Number(record.total),
      currency: record.currency,
      // 🔴 "Fulfilled by" = nhà cung cấp THỰC SỰ nhận đơn này (tài khoản của CHÍNH bản ghi), không
      // phải nhà cung cấp mặc định của kết nối TikTok.
      fulfilledBy: 'account' in record && record.account ? record.account.name : null,
      // "Chờ báo giá" chỉ có nghĩa khi lần gửi còn giữ đơn ở xưởng — đơn đã huỷ / hỏng không chờ gì.
      ...productCostOf(
        record.submittedAt !== null && !NON_BLOCKING_FULFILLMENT_STATUSES.includes(record.status),
        record.items ?? [],
      ),
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
        baseCost: item.baseCost === null ? null : Number(item.baseCost),
        baseCostConfirmed: item.baseCostConfirmedAt !== null,
        providerItemId: item.providerItemId,
      })),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
