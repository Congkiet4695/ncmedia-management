import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DashboardFilterOptionsDto,
  DashboardHoldShopPageDto,
  DashboardOverviewDto,
  DashboardPeriodDto,
  DashboardSellerPageDto,
  DashboardShopListPageDto,
  DashboardSummaryDto,
  DashboardTrendsDto,
  PodDashboardFilterDto,
  PodDashboardPageQueryDto,
  PodDashboardRangeDto,
  PodDashboardSellerQueryDto,
  PodDashboardShopListQueryDto,
} from '../dto/pod-dashboard.dto';
import {
  DashboardFilter,
  PodDashboardRepository,
  type PeriodRow,
  type Window,
} from '../repositories/pod-dashboard.repository';
import {
  percentChange,
  resolveAllTimeRange,
  resolveDayRange,
  sellerCurrentProfit,
  sellerEstProfit,
  type DashboardDayRange,
} from '../shared/dashboard-metrics';
import { labelCostOf } from '../shared/label-cost';
import { ORDER_STATUS_GROUP_KEYS } from '../shared/order-status-groups';
import { resolveDateRange } from '../utils/date-range.util';
import type { PodAccessScope } from './pod-access-scope.service';

const money = (value: string): number => Math.round(Number(value) * 100) / 100;

/**
 * PodDashboardService — Dashboard quản trị (Hold · trạng thái shop · đơn theo kỳ · tài chính · seller ·
 * xu hướng). Mọi con số do `PodDashboardRepository` tổng hợp ở DB; lớp này chỉ dựng phạm vi, khoảng
 * thời gian (giờ vận hành `APP_TIMEZONE_OFFSET_MINUTES`) và định dạng response.
 */
@Injectable()
export class PodDashboardService {
  constructor(
    private readonly repo: PodDashboardRepository,
    private readonly config: ConfigService,
  ) {}

  /** Lựa chọn cho bộ lọc (đơn vị tiền · shop · seller) — trong phạm vi người xem. */
  async filterOptions(
    organizationId: string,
    scope: PodAccessScope,
  ): Promise<DashboardFilterOptionsDto> {
    const [currencies, options] = await Promise.all([
      this.repo.currencies(organizationId),
      this.repo.filterOptions(organizationId, scope.allShops ? null : scope.accountIds),
    ]);
    return { currencies, ...options };
  }

  async overview(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardFilterDto,
    now: Date = new Date(),
  ): Promise<DashboardOverviewDto> {
    const { filter, currencies } = await this.filterOf(organizationId, scope, query);
    const offset = this.offset();
    const windows = (['TODAY', 'YESTERDAY', 'THIS_MONTH', 'LAST_MONTH'] as const).map((preset) => {
      const range = resolveDateRange(preset, offset, undefined, undefined, now);
      return { from: range.from as Date, to: range.to as Date };
    });

    const [holdRows, holdBySeller, shopRows, periodRows] = await Promise.all([
      this.repo.holdTotals(filter),
      this.repo.holdBySeller(filter),
      this.repo.shopStatuses(filter),
      this.repo.periods(filter, windows),
    ]);

    const selected = holdRows.find((row) => row.currency === filter.currency);
    const count = (status: string) => shopRows.find((row) => row.status === status)?.count ?? 0;
    const [today, yesterday, thisMonth, lastMonth] = periodRows;
    const period = (current: PeriodRow, previous?: PeriodRow): DashboardPeriodDto => ({
      orders: current.orders,
      estRevenue: money(current.estRevenue),
      payout: money(current.payout),
      orderChange: previous ? percentChange(current.orders, previous.orders) : null,
    });

    return {
      currency: filter.currency || null,
      currencies,
      hold: {
        currency: filter.currency || null,
        amount: money(selected?.amount ?? '0'),
        shopCount: selected?.shopCount ?? 0,
        otherCurrencies: holdRows
          .filter((row) => row.currency !== filter.currency)
          .map((row) => ({
            currency: row.currency,
            amount: money(row.amount),
            shopCount: row.shopCount,
          })),
      },
      holdBySeller: holdBySeller.map((row) => ({ ...row, amount: money(row.amount) })),
      shopStatus: {
        live: count('ACTIVE'),
        inactive: count('INACTIVE'),
        deauthorized: count('DEAUTHORIZED'),
        total: shopRows.reduce((sum, row) => sum + row.count, 0),
      },
      periods: {
        today: period(today, yesterday),
        yesterday: period(yesterday),
        thisMonth: period(thisMonth, lastMonth),
        lastMonth: period(lastMonth),
      },
      timezoneOffsetMinutes: offset,
    };
  }

  /** Popup "Tổng tiền đang hold": hold theo shop — cùng nguồn / phạm vi / đơn vị tiền với thẻ. */
  async holdShops(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardPageQueryDto,
  ): Promise<DashboardHoldShopPageDto> {
    const { filter } = await this.filterOf(organizationId, scope, query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const result = await this.repo.holdShops(filter, { page, limit });
    return {
      currency: filter.currency || null,
      totalAmount: money(result.totalAmount),
      items: result.items.map((row) => ({ ...row, amount: money(row.amount) })),
      meta: { total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) },
    };
  }

  /** Popup "Trạng thái shop": các shop Live / Die / Mất uỷ quyền — cùng điều kiện với thẻ. */
  async shopsByStatus(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardShopListQueryDto,
  ): Promise<DashboardShopListPageDto> {
    const { filter } = await this.filterOf(organizationId, scope, query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const result = await this.repo.shopsByStatus(filter, query.status, { page, limit });
    return {
      status: query.status,
      items: result.items,
      meta: { total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) },
    };
  }

  async summary(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardRangeDto,
  ): Promise<DashboardSummaryDto> {
    const { filter } = await this.filterOf(organizationId, scope, query);
    const range = await this.range(query, filter);
    const window = this.window(range);
    const [finance, groups, returnsAvailable, returnStats] = await Promise.all([
      this.repo.finance(filter, window),
      this.repo.orderGroups(filter, window),
      this.repo.returnsAvailable(filter),
      this.repo.returnStats(filter, window),
    ]);
    const total = groups.reduce((sum, row) => sum + row.count, 0);
    const delivered = groups.find((row) => row.group === 'DELIVERED')?.count ?? 0;
    return {
      currency: filter.currency || null,
      from: range.fromDay,
      to: range.toDay,
      finance: { paid: money(finance.paid), processing: money(finance.processing) },
      orders: {
        total,
        delivered,
        deliveredRate: total > 0 ? Math.round((delivered / total) * 10_000) / 100 : null,
        // Đủ mọi nhóm (kể cả 0) theo thứ tự cố định — giao diện không phải đoán nhóm nào thiếu.
        groups: ORDER_STATUS_GROUP_KEYS.map((group) => {
          const row = groups.find((entry) => entry.group === group);
          return { group, count: row?.count ?? 0, amount: money(row?.amount ?? '0') };
        }),
      },
      returnsAvailable,
      returns: returnsAvailable
        ? {
            requests: returnStats.requests,
            returnedOrders: returnStats.returnedOrders,
            refundedOrders: returnStats.refundedOrders,
            settledRefund: money(returnStats.settledRefund),
          }
        : null,
    };
  }

  async sellers(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardSellerQueryDto,
  ): Promise<DashboardSellerPageDto> {
    const { filter } = await this.filterOf(organizationId, scope, query);
    const range = await this.range(query, filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [returnsAvailable, result] = await Promise.all([
      this.repo.returnsAvailable(filter),
      this.repo.sellerStats(filter, this.window(range), {
        activeOnly: query.activeOnly ?? false,
        search: query.search,
        sort: query.sort ?? 'orders',
        order: query.order ?? 'desc',
        page,
        limit,
        label: labelCostOf(this.config),
      }),
    ]);
    return {
      currency: filter.currency || null,
      items: result.items.map((row) => {
        const currentProfit = sellerCurrentProfit(row);
        const profit = sellerEstProfit(row);
        return {
          ...row,
          // Chưa shop nào trong phạm vi đồng bộ Return/Refund ⇒ NULL ("chưa có dữ liệu"), không phải 0.
          returns: returnsAvailable ? row.returns : null,
          revenue: money(row.revenue),
          baseCost: money(row.baseCost),
          shippingFee: money(row.shippingFee),
          label: row.label === null ? null : money(row.label),
          designAmount: row.designAmount === null ? null : money(row.designAmount),
          shippingIncluded: money(row.shippingIncluded),
          profit: profit === null ? null : money(profit),
          currentProfit: currentProfit === null ? null : money(currentProfit),
          paid: money(row.paid),
          processing: money(row.processing),
          hold: money(row.hold),
        };
      }),
      meta: { total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) },
    };
  }

  async trends(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardRangeDto,
  ): Promise<DashboardTrendsDto> {
    const { filter } = await this.filterOf(organizationId, scope, query);
    const range = await this.range(query, filter);
    const window = this.window(range);
    const offset = this.offset();
    const [finance, orders] = await Promise.all([
      this.repo.financeTrend(filter, window, range, offset),
      this.repo.orderTrend(filter, window, range, offset),
    ]);
    return {
      currency: filter.currency || null,
      from: range.fromDay,
      to: range.toDay,
      finance: finance.map((row) => ({
        day: row.day,
        paid: money(row.paid),
        processing: money(row.processing),
      })),
      orders,
    };
  }

  // ---------------------------------------------------------------------------

  /**
   * Phạm vi dữ liệu: Admin (`pod.shop.all`) ⇒ toàn tổ chức; người khác ⇒ CHỈ TikTok Account được
   * gán cho họ. Đơn vị tiền: theo yêu cầu, không có thì đơn vị phổ biến nhất trong dữ liệu.
   */
  private async filterOf(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardFilterDto,
  ): Promise<{ filter: DashboardFilter; currencies: string[] }> {
    const currencies = await this.repo.currencies(organizationId);
    return {
      currencies,
      filter: {
        organizationId,
        // Chưa có dữ liệu nào ⇒ chuỗi rỗng: mọi truy vấn trả 0 thay vì đoán một đơn vị tiền.
        currency: query.currency ?? currencies[0] ?? '',
        accountIds: scope.allShops ? null : scope.accountIds,
        shopId: query.shopId,
        sellerId: query.sellerId,
      },
    };
  }

  /**
   * Khoảng ngày của truy vấn. `allTime` ⇒ từ ngày có dữ liệu sớm nhất trong phạm vi đến hôm nay (không giới hạn
   * số ngày — xu hướng vẫn đủ mọi ngày); ngược lại from / to như cũ (tối đa `DASHBOARD_MAX_RANGE_DAYS`).
   */
  private async range(
    query: PodDashboardRangeDto,
    filter: DashboardFilter,
  ): Promise<DashboardDayRange> {
    if (query.allTime) {
      const offset = this.offset();
      return resolveAllTimeRange(await this.repo.earliestActivityDay(filter, offset), offset);
    }
    try {
      return resolveDayRange(query.from, query.to, this.offset());
    } catch (error) {
      throw new BadRequestException({
        code: 'DASHBOARD_RANGE_INVALID',
        message: (error as Error).message,
      });
    }
  }

  private window(range: DashboardDayRange): Window {
    return { from: range.from, to: range.to };
  }

  private offset(): number {
    return this.config.get<number>('timezoneOffsetMinutes', 420);
  }
}
