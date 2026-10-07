import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { addSheet, workbookToBuffer } from '../../../common/excel/excel.util';
import type {
  EmployeeWorkAccountDto,
  EmployeeWorkFilterOptionsDto,
  EmployeeWorkPageDto,
  EmployeeWorkQueryDto,
  EmployeeWorkRowDto,
  EmployeeWorkSummaryDto,
} from '../dto/pod-employee-work.dto';
import { PodDashboardRepository } from '../repositories/pod-dashboard.repository';
import {
  PodEmployeeWorkRepository,
  type EmployeeWorkPairRow,
  type EmployeeWorkUserRow,
} from '../repositories/pod-employee-work.repository';
import { resolveDayRange, type DashboardDayRange } from '../shared/dashboard-metrics';
import { labelCostOf } from '../shared/label-cost';

const money = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Math.round(value.toNumber() * 100) / 100;

/** Σ lợi nhuận theo Decimal (không cộng float) — `null` khi không có giá trị nào. */
function sumProfit(values: Array<string | null>): Prisma.Decimal | null {
  const present = values.filter((value): value is string => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
}

/**
 * PodEmployeeWorkService — "Thống kê công việc nhân viên" (Admin).
 *
 * Mọi con số do `PodEmployeeWorkRepository` tổng hợp ở DB trong MỘT truy vấn; lớp này chỉ dựng khoảng ngày
 * (giờ vận hành `APP_TIMEZONE_OFFSET_MINUTES`, CÙNG hàm với Dashboard / Orders), gom cặp (người × shop) theo
 * người, sắp xếp, phân trang, và tính tổng.
 *
 * 🔴 Tổng ĐƠN / LỢI NHUẬN của phần tóm tắt cộng theo SHOP DUY NHẤT: một shop có thể xuất hiện dưới hai người
 * (người phụ trách + người listing). Cộng theo dòng nhân viên sẽ đếm đơn của shop đó hai lần.
 */
@Injectable()
export class PodEmployeeWorkService {
  constructor(
    private readonly repo: PodEmployeeWorkRepository,
    private readonly dashboard: PodDashboardRepository,
    private readonly config: ConfigService,
  ) {}

  async filterOptions(organizationId: string): Promise<EmployeeWorkFilterOptionsDto> {
    const [currencies, actorIds, shops] = await Promise.all([
      this.dashboard.currencies(organizationId),
      this.repo.listingActorIds(organizationId),
      this.repo.shops(organizationId),
    ]);
    const users = await this.repo.users(organizationId, actorIds);
    return {
      currencies,
      users: users
        .map((user) => ({ id: user.userId, name: user.name, isEmployee: user.isEmployee, active: user.active }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      shops: shops.map((shop) => ({
        id: shop.id,
        name: shop.name,
        accountName: shop.account.accountName,
        region: shop.region,
      })),
    };
  }

  async page(organizationId: string, query: EmployeeWorkQueryDto): Promise<EmployeeWorkPageDto> {
    const { range, currency, rows } = await this.compute(organizationId, query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return {
      from: range.fromDay,
      to: range.toDay,
      currency: currency || null,
      timezoneOffsetMinutes: this.offset(),
      summary: this.summaryOf(rows.pairs),
      items: rows.employees.slice((page - 1) * limit, page * limit),
      meta: { total: rows.employees.length, page, limit, totalPages: Math.ceil(rows.employees.length / limit) },
    };
  }

  /** Xuất Excel (2 sheet: theo nhân viên · theo shop) — cùng bộ lọc, không phân trang. */
  async export(organizationId: string, query: EmployeeWorkQueryDto): Promise<{ buffer: Buffer; filename: string }> {
    const { range, currency, rows } = await this.compute(organizationId, query);
    const workbook = new ExcelJS.Workbook();
    const profitCell = (value: number | null) => (value === null ? '—' : value);
    addSheet(
      workbook,
      'Nhân viên',
      [
        { header: 'Nhân viên', key: 'name' },
        { header: 'Email', key: 'email' },
        { header: 'Số shop', key: 'accounts' },
        { header: 'Listing', key: 'listings' },
        { header: 'Đơn hàng', key: 'orders' },
        { header: 'Đơn tính được lợi nhuận', key: 'profitOrders' },
        { header: `Lợi nhuận (${currency || '—'})`, key: 'profit' },
        { header: 'Lợi nhuận / đơn', key: 'profitPerOrder' },
      ],
      rows.employees.map((row) => ({
        ...row,
        profit: profitCell(row.profit),
        profitPerOrder: profitCell(row.profitPerOrder),
      })),
    );
    addSheet(
      workbook,
      'Chi tiết shop',
      [
        { header: 'Nhân viên', key: 'name' },
        { header: 'Shop', key: 'shopName' },
        { header: 'TikTok Account', key: 'accountName' },
        { header: 'Phụ trách', key: 'assigned' },
        { header: 'Listing', key: 'listings' },
        { header: 'Đơn hàng (của shop)', key: 'orders' },
        { header: `Lợi nhuận (${currency || '—'})`, key: 'profit' },
      ],
      rows.employees.flatMap((row) =>
        row.accountDetails.map((account) => ({
          name: row.name,
          ...account,
          assigned: account.assigned ? 'Có' : '',
          profit: profitCell(account.profit),
        })),
      ),
    );
    return {
      buffer: await workbookToBuffer(workbook),
      filename: `employee-work-${range.fromDay}${range.toDay === range.fromDay ? '' : `_${range.toDay}`}.xlsx`,
    };
  }

  // ---------------------------------------------------------------------------

  private async compute(organizationId: string, query: EmployeeWorkQueryDto) {
    const range = this.range(query);
    const currency = query.currency ?? (await this.dashboard.currencies(organizationId))[0] ?? '';
    const pairs = (
      await this.repo.pairs({
        organizationId,
        currency,
        from: range.from,
        to: range.to,
        shopId: query.shopId,
        label: labelCostOf(this.config),
      })
    ).filter((pair) => !query.userId || pair.userId === query.userId);

    const users = await this.repo.users(organizationId, [...new Set(pairs.map((pair) => pair.userId))]);
    const byUser = new Map<string, EmployeeWorkPairRow[]>();
    for (const pair of pairs) byUser.set(pair.userId, [...(byUser.get(pair.userId) ?? []), pair]);

    const employees = users
      // Lọc theo shop / người ⇒ chỉ người có liên quan; không lọc ⇒ mọi nhân viên đang hoạt động (kể cả 0 listing).
      .filter((user) => {
        if (query.userId) return user.userId === query.userId;
        if (query.shopId) return byUser.has(user.userId);
        return byUser.has(user.userId) || (user.isEmployee && user.active);
      })
      .map((user) => this.rowOf(user, byUser.get(user.userId) ?? []));
    this.sort(employees, query);
    return { range, currency, rows: { pairs, employees } };
  }

  private rowOf(user: EmployeeWorkUserRow, pairs: EmployeeWorkPairRow[]): EmployeeWorkRowDto {
    const accountDetails: EmployeeWorkAccountDto[] = pairs
      .map((pair) => ({
        shopId: pair.shopId,
        shopName: pair.shopName,
        accountName: pair.accountName,
        assigned: pair.assigned,
        listings: pair.listings,
        orders: pair.orders,
        profitOrders: pair.profitOrders,
        profit: money(pair.profit === null ? null : new Prisma.Decimal(pair.profit)),
      }))
      .sort((left, right) => right.listings - left.listings || left.shopName.localeCompare(right.shopName));
    const profit = sumProfit(pairs.map((pair) => pair.profit));
    const profitOrders = pairs.reduce((sum, pair) => sum + pair.profitOrders, 0);
    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      isEmployee: user.isEmployee,
      active: user.active,
      accounts: pairs.length,
      listings: pairs.reduce((sum, pair) => sum + pair.listings, 0),
      orders: pairs.reduce((sum, pair) => sum + pair.orders, 0),
      profitOrders,
      profit: money(profit),
      profitPerOrder: profit && profitOrders > 0 ? money(profit.div(profitOrders)) : null,
      accountDetails,
    };
  }

  /** Tóm tắt — đơn / lợi nhuận cộng theo SHOP DUY NHẤT (không đếm hai lần shop có hai người liên quan). */
  private summaryOf(pairs: EmployeeWorkPairRow[]): EmployeeWorkSummaryDto {
    const shops = new Map(pairs.map((pair) => [pair.shopId, pair]));
    const listed = pairs.filter((pair) => pair.listings > 0);
    const profit = sumProfit([...shops.values()].map((shop) => shop.profit));
    const profitOrders = [...shops.values()].reduce((sum, shop) => sum + shop.profitOrders, 0);
    return {
      activeEmployees: new Set(listed.map((pair) => pair.userId)).size,
      accountsListed: new Set(listed.map((pair) => pair.shopId)).size,
      productsListed: listed.reduce((sum, pair) => sum + pair.listings, 0),
      orders: [...shops.values()].reduce((sum, shop) => sum + shop.orders, 0),
      profitOrders,
      profit: money(profit),
      profitPerOrder: profit && profitOrders > 0 ? money(profit.div(profitOrders)) : null,
    };
  }

  private sort(rows: EmployeeWorkRowDto[], query: EmployeeWorkQueryDto): void {
    const field = query.sort ?? 'listings';
    const direction = (query.order ?? (field === 'name' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
    const valueOf = (row: EmployeeWorkRowDto): number => (field === 'profit' ? (row.profit ?? Number.NEGATIVE_INFINITY) : field === 'orders' ? row.orders : row.listings);
    rows.sort((left, right) => {
      if (field === 'name') return direction * left.name.localeCompare(right.name);
      return direction * (valueOf(left) - valueOf(right)) || left.name.localeCompare(right.name);
    });
  }

  private range(query: EmployeeWorkQueryDto): DashboardDayRange {
    const offset = this.offset();
    try {
      // Mặc định HÔM NAY (giờ vận hành) — cùng hàm với Dashboard / Orders.
      const today = resolveDayRange(undefined, undefined, offset).toDay;
      return resolveDayRange(query.from ?? query.to ?? today, query.to ?? query.from ?? today, offset);
    } catch (error) {
      throw new BadRequestException({ code: 'EMPLOYEE_WORK_RANGE_INVALID', message: (error as Error).message });
    }
  }

  private offset(): number {
    return this.config.get<number>('timezoneOffsetMinutes', 420);
  }
}
