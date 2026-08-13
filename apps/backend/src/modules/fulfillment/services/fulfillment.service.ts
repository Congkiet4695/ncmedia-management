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
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
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
import {
  FulfillmentOrderWithRelations,
  FulfillmentRepository,
} from '../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';

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
    private readonly repo: FulfillmentRepository,
    private readonly podOrderRepo: PodOrderRepository,
    private readonly readiness: FulfillmentReadinessService,
    private readonly encryption: TiktokEncryptionService,
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
   * Danh sách ánh xạ có lọc + phân trang cho màn hình quản trị.
   *
   * Tên nhà cung cấp được nạp bằng MỘT truy vấn cho cả trang rồi ghép trong bộ nhớ —
   * tra từng dòng sẽ thành N+1.
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
      isActive:
        query.status === undefined ? undefined : query.status === 'ACTIVE',
      keyword: query.search,
      page,
      limit,
    });

    const accounts = await this.repo.listAccounts(organizationId);
    const nameById = new Map(accounts.map((account) => [account.id, account.name]));

    return {
      items: items.map((mapping) =>
        this.toMappingDto(mapping, nameById.get(mapping.accountId) ?? null),
      ),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
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
      this.repo.listMappings(organizationId, accountId),
    ]);

    // Khớp theo đúng thứ tự ưu tiên lúc gửi đơn: TikTok SKU ID → Seller SKU → Product ID.
    const bySkuId = new Set(mappings.map((mapping) => mapping.tiktokSkuId).filter(Boolean));
    const bySellerSku = new Set(mappings.map((mapping) => mapping.sellerSku).filter(Boolean));
    const byProductId = new Set(mappings.map((mapping) => mapping.tiktokProductId).filter(Boolean));

    return items.map((item) => ({
      tiktokProductId: item.productId,
      tiktokSkuId: item.skuId,
      sellerSku: item.sellerSku,
      productName: item.productName,
      skuName: item.skuName,
      productCategory: item.productCategory,
      skuImage: item.skuImage,
      mapped:
        (item.skuId !== null && bySkuId.has(item.skuId)) ||
        (item.sellerSku !== null && bySellerSku.has(item.sellerSku)) ||
        (item.productId !== null && byProductId.has(item.productId)),
    }));
  }

  async createMapping(
    organizationId: string,
    actorUserId: string,
    provider: FulfillmentProvider,
    dto: UpsertProductMappingDto,
  ): Promise<ProductMappingDto> {
    const account = await this.requireAccount(organizationId, provider);
    await this.assertNoConflict(organizationId, account.id, dto);

    const mapping = await this.repo.createMapping({
      organizationId,
      accountId: account.id,
      provider,
      tiktokProductId: dto.tiktokProductId ?? null,
      tiktokSkuId: dto.tiktokSkuId ?? null,
      sellerSku: dto.sellerSku ?? null,
      providerSku: dto.providerSku,
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
    return this.toMappingDto(mapping);
  }

  async updateMapping(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpsertProductMappingDto,
  ): Promise<ProductMappingDto> {
    const existing = await this.repo.findMappingById(organizationId, id);
    if (!existing) throw new FulfillmentMappingNotFoundException();
    await this.assertNoConflict(organizationId, existing.accountId, dto, id);

    const mapping = await this.repo.updateMapping(id, {
      tiktokProductId: dto.tiktokProductId ?? null,
      tiktokSkuId: dto.tiktokSkuId ?? null,
      sellerSku: dto.sellerSku ?? null,
      providerSku: dto.providerSku,
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
    return this.toMappingDto(mapping);
  }

  async deleteMapping(organizationId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.repo.findMappingById(organizationId, id);
    if (!existing) throw new FulfillmentMappingNotFoundException();
    await this.repo.softDeleteMapping(id, actorUserId);
  }

  // ---------------------------------------------------------------------------
  // Trạng thái cho UI
  // ---------------------------------------------------------------------------

  /**
   * Trạng thái fulfillment của MỘT đơn POD, kèm đánh giá đủ điều kiện gửi hay chưa.
   * Dùng chung đúng một bộ kiểm tra với luồng gửi thật ⇒ UI và backend không bao giờ lệch.
   */
  async getState(
    organizationId: string,
    podOrderId: string,
    provider: FulfillmentProvider = FulfillmentProvider.MANGO,
  ): Promise<FulfillmentStateDto> {
    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();

    const record = await this.repo.findByPodOrder(organizationId, podOrderId, provider);

    // Nhà cung cấp lấy TỪ TIKTOK ACCOUNT của đơn — cùng một nguồn với luồng gửi thật,
    // nên màn hình không bao giờ báo "sẵn sàng" cho một đơn mà submit sẽ từ chối.
    const assignedId = order.account?.fulfillmentAccountId ?? null;
    const account = assignedId
      ? await this.repo.findAccountById(organizationId, assignedId)
      : null;

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

    const mappings = await this.repo.listMappings(organizationId, account.id);
    const check = this.readiness.check(order, mappings, this.publicBaseUrl());
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
    provider: FulfillmentProvider = FulfillmentProvider.MANGO,
  ): Promise<FulfillmentHistoryDto[]> {
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
    provider: FulfillmentProvider = FulfillmentProvider.MANGO,
  ): Promise<FulfillmentErrorDto[]> {
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

  /** Chặn hai ánh xạ cùng trỏ về một khoá TikTok (sẽ gây nhập nhằng khi khớp). */
  private async assertNoConflict(
    organizationId: string,
    accountId: string,
    dto: UpsertProductMappingDto,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await this.repo.findConflictingMapping(
      organizationId,
      accountId,
      {
        tiktokSkuId: dto.tiktokSkuId,
        sellerSku: dto.sellerSku,
        tiktokProductId: dto.tiktokProductId,
      },
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

  private toMappingDto(mapping: {
    id: string;
    tiktokProductId: string | null;
    tiktokSkuId: string | null;
    sellerSku: string | null;
    providerSku: string;
    providerProductName: string | null;
    providerColor: string | null;
    providerSize: string | null;
    productionConfig: string | null;
    placementMap: unknown;
    isActive: boolean;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    providerProductId: string | null;
    providerVariantId: string | null;
    providerVariantName: string | null;
  }, providerName: string | null = null): ProductMappingDto {
    return {
      id: mapping.id,
      tiktokProductId: mapping.tiktokProductId,
      tiktokSkuId: mapping.tiktokSkuId,
      sellerSku: mapping.sellerSku,
      providerSku: mapping.providerSku,
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

  toOrderDto(record: FulfillmentOrderWithRelations | (FulfillmentOrder & { items: [] })): FulfillmentOrderDto {
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
