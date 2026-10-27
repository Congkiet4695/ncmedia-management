import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodReturnStatusGroup, PodShopSyncType, Prisma } from '@prisma/client';
import { PodShopSyncStatusListDto } from '../../pod-tiktok/dto/pod-shop-sync-status.dto';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { PodShopSyncStatusService } from '../../pod-tiktok/services/pod-shop-sync-status.service';
import { DEFAULT_BUSINESS_TIMEZONE } from '../../../common/time/business-time';
import { resolveDateRange } from '../../pod-tiktok/utils/date-range.util';
import { TiktokReturnRefundApiService } from '../../tiktok-sdk/tiktok-return-refund-api.service';
import { POD_RETURN_HISTORY_FRESH_MS } from '../constants/pod-return.constants';
import type { PodReturnFilterDto, PodReturnQueryDto } from '../dto/pod-return-query.dto';
import type {
  PaginatedPodReturnResponseDto,
  PodReturnDetailDto,
  PodReturnHistoryDto,
  PodReturnItemGroupDto,
  PodReturnResponseDto,
  PodReturnSummaryDto,
  PodReturnSyncResultDto,
} from '../dto/pod-return-response.dto';
import { PodReturnNotFoundException } from '../exceptions/pod-return.exceptions';
import { mapReturnRecords, type ReturnHistoryEntry } from '../mappers/pod-return.mapper';
import { PodReturnRepository, type PodReturnFilterParams, type ReturnRow } from '../repositories/pod-return.repository';
import { describeSyncError, PodReturnSyncService } from './pod-return-sync.service';

const money = (value: Prisma.Decimal | null | undefined): string | null =>
  value === null || value === undefined ? null : new Prisma.Decimal(value).toFixed(2);

/**
 * PodReturnService — đọc Return Orders đã đồng bộ + đồng bộ thủ công + lịch sử.
 *
 * Phạm vi: Admin (`pod.shop.all`) thấy cả tổ chức; Seller chỉ thấy shop của kết nối được gán. Mọi
 * đường đọc theo id đều kiểm phạm vi ⇒ đoán id của shop khác nhận 404 (không lộ sự tồn tại).
 */
@Injectable()
export class PodReturnService {
  private readonly logger = new Logger(PodReturnService.name);

  constructor(
    private readonly repo: PodReturnRepository,
    private readonly config: ConfigService,
    private readonly accessScope: PodAccessScopeService,
    private readonly syncStatus: PodShopSyncStatusService,
    private readonly sync: PodReturnSyncService,
    private readonly api: TiktokReturnRefundApiService,
  ) {}

  async findAll(
    organizationId: string,
    query: PodReturnQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodReturnResponseDto> {
    const params = this.params(query, scope);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.repo.findPage(organizationId, params, {
      page,
      limit,
      sortBy: query.sortBy ?? 'requestedAt',
      sortOrder: query.sortOrder ?? 'desc',
    });
    const settled = await this.repo.settledRefundByOrder(
      organizationId,
      items.map((row) => row.tiktokOrderId),
    );
    return {
      items: items.map((row) => this.toDto(row, settled.get(row.tiktokOrderId) ?? null)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async summary(
    organizationId: string,
    query: PodReturnFilterDto,
    scope: PodAccessScope,
  ): Promise<PodReturnSummaryDto> {
    const result = await this.repo.summary(organizationId, this.params(query, scope));
    const byGroup = Object.fromEntries(
      Object.values(PodReturnStatusGroup).map((group) => [
        group,
        result.groups.find((row) => row.group === group)?.count ?? 0,
      ]),
    ) as Record<PodReturnStatusGroup, number>;
    return {
      totalRequests: result.groups.reduce((sum, row) => sum + row.count, 0),
      byGroup,
      orders: result.orders,
      refundedOrders: result.refundedOrders,
      itemQuantity: result.itemQuantity,
      amounts: result.amounts.map((row) => ({
        currency: row.currency,
        requestedRefund: money(row.requested) ?? '0.00',
        refundedByRequest: money(row.refunded) ?? '0.00',
        settledRefund: money(row.settled) ?? '0.00',
      })),
    };
  }

  async filterOptions(organizationId: string, scope: PodAccessScope) {
    return this.repo.filterOptions(organizationId, scope.allShops ? undefined : scope.shopIds);
  }

  async findOne(organizationId: string, id: string, scope: PodAccessScope): Promise<PodReturnDetailDto> {
    const row = await this.getAllowed(organizationId, id, scope);
    const settled = await this.repo.settledRefundByOrder(organizationId, [row.tiktokOrderId]);
    return {
      ...this.toDto(row, settled.get(row.tiktokOrderId) ?? null),
      returnProviderName: row.returnProviderName,
      items: row.items.map((item) => ({
        returnLineItemId: item.returnLineItemId,
        orderLineItemId: item.orderLineItemId,
        productName: item.productName,
        skuId: item.skuId,
        skuName: item.skuName,
        sellerSku: item.sellerSku,
        productImageUrl: item.productImageUrl,
        currency: item.currency,
        refundTotal: money(item.refundTotal),
        paidAmount: money(item.paidAmount),
      })),
    };
  }

  /**
   * Lịch sử của MỘT yêu cầu — đọc từ TikTok (GetReturnRecords) khi bản lưu đã cũ (yêu cầu đổi
   * `update_time`, hoặc quá `POD_RETURN_HISTORY_FRESH_MS`). TikTok lỗi ⇒ trả bản đã lưu kèm mã lỗi,
   * KHÔNG dựng lịch sử giả.
   */
  async history(organizationId: string, id: string, scope: PodAccessScope): Promise<PodReturnHistoryDto> {
    const row = await this.getAllowed(organizationId, id, scope);
    const stored = Array.isArray(row.history) ? (row.history as unknown as ReturnHistoryEntry[]) : null;
    const fresh =
      stored !== null &&
      row.historyUpdateTime === row.tiktokUpdateTime &&
      row.historySyncedAt !== null &&
      Date.now() - row.historySyncedAt.getTime() < POD_RETURN_HISTORY_FRESH_MS;
    if (fresh) {
      return { entries: stored, syncedAt: row.historySyncedAt?.toISOString() ?? null, live: false, errorCode: null };
    }

    try {
      const ctx = await this.sync.resolveContext(organizationId, row.shopId);
      const { data } = await this.api.getReturnRecords(ctx, row.tiktokReturnId);
      const entries = mapReturnRecords(data);
      const now = new Date();
      await this.repo.saveHistory(row.id, organizationId, entries as unknown as Prisma.InputJsonValue, row.tiktokUpdateTime, now);
      return { entries, syncedAt: now.toISOString(), live: true, errorCode: null };
    } catch (error) {
      const described = describeSyncError(error);
      this.logger.warn({
        module: 'pod-return',
        operation: 'return.history',
        organizationId,
        shopId: row.shopId,
        tiktokReturnId: row.tiktokReturnId,
        errorCode: described.code,
        tiktokRequestId: described.requestId,
        msg: `Không đọc được lịch sử từ TikTok: ${described.message}`,
      });
      return {
        entries: stored ?? [],
        syncedAt: row.historySyncedAt?.toISOString() ?? null,
        live: false,
        errorCode: described.code,
      };
    }
  }

  /** Đồng bộ thủ công trong phạm vi người dùng (một shop hoặc mọi shop được phép). */
  async triggerSync(
    organizationId: string,
    userId: string,
    scope: PodAccessScope,
    shopId?: string,
  ): Promise<PodReturnSyncResultDto> {
    this.accessScope.assertShopAllowed(scope, shopId);
    const shopIds = shopId ? [shopId] : scope.allShops ? undefined : scope.shopIds;
    const results = await this.sync.runForShops(organizationId, shopIds, userId);
    return {
      shops: results.map((result) => ({
        shopId: result.shopId,
        shopName: result.shopName,
        status: result.status,
        fetched: result.fetched,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        failed: result.failed,
        notified: result.notified,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      })),
    };
  }

  syncStatuses(organizationId: string, scope: PodAccessScope, shopId?: string): Promise<PodShopSyncStatusListDto> {
    return this.syncStatus.findLatest(organizationId, PodShopSyncType.RETURN, scope, shopId);
  }

  // ---------------------------------------------------------------------------

  private async getAllowed(organizationId: string, id: string, scope: PodAccessScope): Promise<ReturnRow> {
    const row = await this.repo.findById(organizationId, id);
    if (!row || (!scope.allShops && !scope.shopIds.includes(row.shopId))) throw new PodReturnNotFoundException();
    return row;
  }

  private params(query: PodReturnFilterDto, scope: PodAccessScope): PodReturnFilterParams {
    // Lọc shop / kết nối ngoài phạm vi ⇒ 403 rõ ràng (như mọi API POD), không âm thầm rỗng.
    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);
    const range = resolveDateRange(
      query.datePreset,
      this.config.get<string>('businessTimeZone', DEFAULT_BUSINESS_TIMEZONE),
      query.from,
      query.to,
    );
    return {
      shopScope: scope.allShops ? undefined : scope.shopIds,
      shopId: query.shopId,
      accountId: query.accountId,
      search: query.search || undefined,
      returnType: query.returnType,
      statusGroup: query.statusGroup,
      returnStatus: query.returnStatus,
      reason: query.reason,
      dateField: query.dateField ?? 'requestedAt',
      from: range.from,
      before: range.before,
    };
  }

  private toDto(row: ReturnRow, orderSettledRefund: Prisma.Decimal | null): PodReturnResponseDto {
    return {
      id: row.id,
      tiktokReturnId: row.tiktokReturnId,
      tiktokOrderId: row.tiktokOrderId,
      orderId: row.orderId,
      shopId: row.shopId,
      shopName: row.shop?.name ?? null,
      accountId: row.accountId,
      accountName: row.account?.accountName ?? null,
      returnType: row.returnType,
      returnStatus: row.returnStatus,
      statusGroup: row.statusGroup,
      refundCompleted: row.refundCompleted,
      reasonCode: row.returnReason,
      reasonText: row.returnReasonText,
      role: row.role,
      arbitrationStatus: row.arbitrationStatus,
      sellerProposedReturnType: row.sellerProposedReturnType,
      partialRefundAmount: money(row.partialRefundAmount),
      currency: row.currency,
      paidAmount: money(row.paidAmount),
      requestedRefund: money(row.refundTotal),
      refundSubtotal: money(row.refundSubtotal),
      refundShippingFee: money(row.refundShippingFee),
      refundTax: money(row.refundTax),
      orderSettledRefund: money(orderSettledRefund),
      itemQuantity: row.itemQuantity,
      itemGroups: groupItems(row.items),
      returnTrackingNumber: row.returnTrackingNumber,
      requestedAt: row.requestedAt.toISOString(),
      tiktokUpdatedAt: row.tiktokUpdatedAt.toISOString(),
      lastSyncedAt: row.lastSyncedAt.toISOString(),
    };
  }
}

/** Gộp dòng hàng theo SKU (TikTok tách mỗi đơn vị thành một dòng) ⇒ cột "Item" kèm số lượng. */
export function groupItems(items: ReturnRow['items']): PodReturnItemGroupDto[] {
  const groups = new Map<string, PodReturnItemGroupDto>();
  for (const item of items) {
    const key = item.skuId ?? `${item.sellerSku ?? ''}|${item.productName ?? ''}|${item.skuName ?? ''}`;
    const group = groups.get(key);
    if (group) {
      group.quantity += 1;
      continue;
    }
    groups.set(key, {
      productName: item.productName,
      sellerSku: item.sellerSku,
      skuName: item.skuName,
      productImageUrl: item.productImageUrl,
      quantity: 1,
    });
  }
  return [...groups.values()];
}
