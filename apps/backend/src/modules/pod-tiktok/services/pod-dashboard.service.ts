import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DashboardFilterOptionsDto,
  DashboardOverviewDto,
  DashboardPeriodDto,
  DashboardSellerPageDto,
  DashboardSummaryDto,
  DashboardTrendsDto,
  PodDashboardFilterDto,
  PodDashboardRangeDto,
  PodDashboardSellerQueryDto,
} from '../dto/pod-dashboard.dto';
import {
  DashboardFilter,
  PodDashboardRepository,
  type PeriodRow,
  type Window,
} from '../repositories/pod-dashboard.repository';
import { percentChange, resolveDayRange, type DashboardDayRange } from '../shared/dashboard-metrics';
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
  async filterOptions(organizationId: string, scope: PodAccessScope): Promise<DashboardFilterOptionsDto> {
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
          .map((row) => ({ currency: row.currency, amount: money(row.amount), shopCount: row.shopCount })),
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

  async summary(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardRangeDto,
  ): Promise<DashboardSummaryDto> {
    const range = this.range(query);
    const { filter } = await this.filterOf(organizationId, scope, query);
    const window = this.window(range);
    const [finance, groups] = await Promise.all([
      this.repo.finance(filter, window),
      this.repo.orderGroups(filter, window),
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
      returnsAvailable: false,
    };
  }

  async sellers(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardSellerQueryDto,
  ): Promise<DashboardSellerPageDto> {
    const range = this.range(query);
    const { filter } = await this.filterOf(organizationId, scope, query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const result = await this.repo.sellerStats(filter, this.window(range), {
      activeOnly: query.activeOnly ?? false,
      search: query.search,
      sort: query.sort ?? 'orders',
      order: query.order ?? 'desc',
      page,
      limit,
      label: labelCostOf(this.config),
    });
    return {
      currency: filter.currency || null,
      items: result.items.map((row) => ({
        ...row,
        returns: null,
        estRevenue: money(row.estRevenue),
        revenue: money(row.revenue),
        baseCost: money(row.baseCost),
        profit: row.profit === null ? null : money(row.profit),
        paid: money(row.paid),
        processing: money(row.processing),
        hold: money(row.hold),
      })),
      meta: { total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) },
    };
  }

  async trends(
    organizationId: string,
    scope: PodAccessScope,
    query: PodDashboardRangeDto,
  ): Promise<DashboardTrendsDto> {
    const range = this.range(query);
    const { filter } = await this.filterOf(organizationId, scope, query);
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
      finance: finance.map((row) => ({ day: row.day, paid: money(row.paid), processing: money(row.processing) })),
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

  private range(query: PodDashboardRangeDto): DashboardDayRange {
    try {
      return resolveDayRange(query.from, query.to, this.offset());
    } catch (error) {
      throw new BadRequestException({ code: 'DASHBOARD_RANGE_INVALID', message: (error as Error).message });
    }
  }

  private window(range: DashboardDayRange): Window {
    return { from: range.from, to: range.to };
  }

  private offset(): number {
    return this.config.get<number>('timezoneOffsetMinutes', 420);
  }
}
