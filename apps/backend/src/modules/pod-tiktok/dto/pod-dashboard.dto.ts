import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SELLER_SORT_FIELDS,
  SHOP_STATUSES,
  type SellerSortField,
  type ShopStatus,
} from '../repositories/pod-dashboard.repository';
import { ORDER_STATUS_GROUP_KEYS, type OrderStatusGroup } from '../shared/order-status-groups';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** Bộ lọc chung của Dashboard. Tổ chức + phạm vi seller lấy từ JWT, KHÔNG từ query. */
export class PodDashboardFilterDto {
  @ApiPropertyOptional({ description: 'Đơn vị tiền (mặc định: đơn vị phổ biến nhất của tổ chức).', example: 'USD' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency phải là mã ISO 4217 (vd USD)' })
  currency?: string;

  @ApiPropertyOptional({ description: 'Lọc một shop.' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ description: 'Lọc một seller (Employee id).' })
  @IsOptional()
  @IsUUID()
  sellerId?: string;
}

/**
 * Bộ lọc + khoảng ngày (theo giờ vận hành, gồm trọn hai ngày mút). Bỏ trống ⇒ tháng hiện tại.
 * `allTime=true` ⇒ "Tất cả thời gian": bỏ qua from / to, không giới hạn số ngày.
 */
export class PodDashboardRangeDto extends PodDashboardFilterDto {
  @ApiPropertyOptional({
    description:
      'Tất cả thời gian: bỏ qua from / to và giới hạn 366 ngày — khoảng = từ ngày có dữ liệu sớm nhất (đơn / payout / ' +
      'statement) trong phạm vi người xem đến hôm nay (giờ vận hành).',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  allTime?: boolean = false;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DAY, { message: 'from phải có dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(DAY, { message: 'to phải có dạng YYYY-MM-DD' })
  to?: string;
}

/** Phân trang cho popup của thẻ tổng quan (bộ lọc chung + trang). */
export class PodDashboardPageQueryDto extends PodDashboardFilterDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class PodDashboardShopListQueryDto extends PodDashboardPageQueryDto {
  @ApiProperty({ enum: SHOP_STATUSES, description: 'ACTIVE = Live, INACTIVE = Die, DEAUTHORIZED = Mất uỷ quyền.' })
  @IsIn(SHOP_STATUSES)
  status!: ShopStatus;
}

export class PodDashboardSellerQueryDto extends PodDashboardRangeDto {
  @ApiPropertyOptional({ description: 'Chỉ nhân viên đang hoạt động (employee + user ACTIVE).', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  activeOnly?: boolean = false;

  @ApiPropertyOptional({ description: 'Tìm theo họ tên / email seller.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: SELLER_SORT_FIELDS, default: 'orders' })
  @IsOptional()
  @IsIn(SELLER_SORT_FIELDS)
  sort?: SellerSortField = 'orders';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export class DashboardHoldDto {
  @ApiPropertyOptional({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty() amount!: number;
  @ApiProperty({ description: 'Số shop có khoản tiền TikTok chưa quyết toán.' }) shopCount!: number;
  @ApiProperty({
    type: Object,
    isArray: true,
    description: 'Hold của các đơn vị tiền KHÁC (không quy đổi — hệ thống không có nguồn tỷ giá).',
  })
  otherCurrencies!: Array<{ currency: string; amount: number; shopCount: number }>;
}

export class DashboardPageMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

/**
 * Seller Employee phụ trách shop — Employee được gán ở TikTok Account của shop (`pod_tiktok_accounts.seller_id`,
 * người phụ trách HIỆN TẠI). Chưa gán ⇒ NULL (giao diện hiện "—").
 */
export class DashboardShopSellerDto {
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Employee id của Seller Employee.' })
  sellerId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Họ tên Seller Employee (thiếu ⇒ email).' })
  sellerName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerEmail!: string | null;
}

export class DashboardHoldShopDto extends DashboardShopSellerDto {
  @ApiProperty() shopId!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Tên shop TikTok.' }) shopName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Tên kết nối TikTok (TikTok Account).' })
  accountName!: string | null;
  @ApiProperty({ description: 'Σ est_settlement_amount chưa quyết toán của shop, đơn vị `currency`.' }) amount!: number;
}

export class DashboardHoldShopPageDto {
  @ApiPropertyOptional({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ description: 'Σ hold của MỌI shop (mọi trang) — bằng số trên thẻ cùng đơn vị tiền.' })
  totalAmount!: number;
  @ApiProperty({ type: DashboardHoldShopDto, isArray: true }) items!: DashboardHoldShopDto[];
  @ApiProperty({ type: DashboardPageMetaDto, description: 'meta.total = số shop trên thẻ.' }) meta!: DashboardPageMetaDto;
}

export class DashboardShopListItemDto extends DashboardShopSellerDto {
  @ApiProperty() shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) accountName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) region!: string | null;
}

export class DashboardShopListPageDto {
  @ApiProperty({ enum: SHOP_STATUSES }) status!: ShopStatus;
  @ApiProperty({ type: DashboardShopListItemDto, isArray: true }) items!: DashboardShopListItemDto[];
  @ApiProperty({ type: DashboardPageMetaDto }) meta!: DashboardPageMetaDto;
}

export class DashboardHoldSellerDto {
  @ApiPropertyOptional({ nullable: true, type: String, description: 'NULL = account chưa gán seller.' })
  sellerId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerName!: string | null;
  @ApiProperty() shopCount!: number;
  @ApiProperty() amount!: number;
}

export class DashboardShopStatusDto {
  @ApiProperty({ description: 'Shop ACTIVE.' }) live!: number;
  @ApiProperty({ description: 'Shop INACTIVE (TikTok báo không hoạt động).' }) inactive!: number;
  @ApiProperty({ description: 'Shop DEAUTHORIZED (mất uỷ quyền).' }) deauthorized!: number;
  @ApiProperty() total!: number;
}

export class DashboardPeriodDto {
  @ApiProperty() orders!: number;
  @ApiProperty({ description: 'Tiền thu về của các đơn đặt trong kỳ.' }) estRevenue!: number;
  @ApiProperty({ description: 'Tiền TikTok đã chi (PAID) trong kỳ.' }) payout!: number;
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: '% thay đổi số đơn so với kỳ liền trước; NULL khi kỳ trước = 0.',
  })
  orderChange!: number | null;
}

export class DashboardPeriodsDto {
  @ApiProperty({ type: DashboardPeriodDto }) today!: DashboardPeriodDto;
  @ApiProperty({ type: DashboardPeriodDto }) yesterday!: DashboardPeriodDto;
  @ApiProperty({ type: DashboardPeriodDto }) thisMonth!: DashboardPeriodDto;
  @ApiProperty({ type: DashboardPeriodDto }) lastMonth!: DashboardPeriodDto;
}

export class DashboardOverviewDto {
  @ApiPropertyOptional({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ type: String, isArray: true }) currencies!: string[];
  @ApiProperty({ type: DashboardHoldDto }) hold!: DashboardHoldDto;
  @ApiProperty({ type: DashboardHoldSellerDto, isArray: true }) holdBySeller!: DashboardHoldSellerDto[];
  @ApiProperty({ type: DashboardShopStatusDto }) shopStatus!: DashboardShopStatusDto;
  @ApiProperty({ type: DashboardPeriodsDto }) periods!: DashboardPeriodsDto;
  @ApiProperty({ description: 'Múi giờ dùng để tính "Hôm nay / Tháng này" (phút so với UTC).' })
  timezoneOffsetMinutes!: number;
}

export class DashboardOrderGroupDto {
  @ApiProperty({ enum: ORDER_STATUS_GROUP_KEYS }) group!: OrderStatusGroup;
  @ApiProperty() count!: number;
  @ApiProperty({ description: 'Σ tổng tiền khách trả (total_amount) của nhóm.' }) amount!: number;
}

export class DashboardSummaryDto {
  @ApiPropertyOptional({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: Object }) finance!: { paid: number; processing: number };
  @ApiProperty({ type: Object })
  orders!: {
    total: number;
    delivered: number;
    /** delivered / total × 100; NULL khi total = 0. */
    deliveredRate: number | null;
    groups: DashboardOrderGroupDto[];
  };
  @ApiProperty({ description: 'false: chưa shop nào trong phạm vi đồng bộ TikTok Return & Refund thành công.' })
  returnsAvailable!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    type: Object,
    description:
      'Return/Refund của các đơn trong khoảng. requests = số YÊU CẦU; returnedOrders = số đơn có yêu cầu còn hiệu lực; ' +
      'refundedOrders = số đơn TikTok xác nhận đã hoàn; settledRefund = doanh thu bị trừ lại trong statement đã quyết toán ' +
      '(ĐÃ nằm trong Est. Revenue / Profit — không trừ lần hai). NULL khi returnsAvailable = false.',
  })
  returns!: { requests: number; returnedOrders: number; refundedOrders: number; settledRefund: number } | null;
}

export class DashboardSellerRowDto {
  @ApiPropertyOptional({ nullable: true, type: String }) sellerId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerEmail!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() orders!: number;
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Số đơn có yêu cầu Return/Refund còn hiệu lực. NULL: chưa shop nào trong phạm vi đồng bộ Return/Refund.',
  })
  returns!: number | null;
  @ApiProperty({
    description:
      'Doanh thu = Σ tiền thu về TỪNG đơn: đã quyết toán (settlement) nếu có, ngược lại ước tính (est_settlement) — ' +
      'mỗi đơn MỘT giá trị, không cộng cả hai.',
  })
  revenue!: number;
  @ApiProperty({ description: 'Số đơn có tiền thu về; đơn còn lại chưa có dữ liệu tài chính (không coi là 0).' })
  revenueOrders!: number;
  @ApiProperty({ description: 'Σ giá vốn đã xác nhận của lần fulfill đang giữ đơn (CÙNG nguồn màn Order).' })
  baseCost!: number;
  @ApiProperty({ description: 'Số đơn có giá vốn đầy đủ & đã xác nhận.' }) baseCostOrders!: number;
  @ApiProperty({
    description:
      'Shipping Fee = Σ phí ship Seller TỪNG đơn (CÙNG nguồn màn Order — gồm cả phần TikTok đã trừ trong tiền thu về), ' +
      'mỗi đơn MỘT giá trị. Đơn chưa xác định được phí ship không cộng (xem shippingFeeOrders).',
  })
  shippingFee!: number;
  @ApiProperty({ description: 'Số đơn đã xác định được phí ship Seller.' }) shippingFeeOrders!: number;
  @ApiProperty({
    description:
      'Phần của Shipping Fee ĐÃ nằm trong Doanh thu (TikTok đã trừ trong settlement / est_settlement) — Profit Dự kiến ' +
      'không trừ lần hai phần này.',
  })
  shippingIncluded!: number;
  @ApiProperty({ description: 'Số đơn đã fulfill (có lần fulfill đang giữ đơn).' }) fulfilledOrders!: number;
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Label = số đơn đã fulfill × label/đơn (ORDER_LABEL_COST). NULL khi label khác đơn vị tiền đang xem.',
  })
  label!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Profit Dự kiến (Est. profit) = Revenue − Base Cost − Shipping Fee − Label trên các tổng của dòng ' +
      '(quyết định PO 2026-10-14), KHÔNG trừ hai lần phí ship: trừ (shippingFee − shippingIncluded). ' +
      'NULL khi label khác đơn vị tiền đang xem.',
  })
  profit!: number | null;
  @ApiProperty({ description: 'Số đơn tính được lợi nhuận TỪNG ĐƠN đủ dữ kiện (công thức màn Order) — tham khảo.' })
  profitOrders!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Current Profit = Paid − Base Cost − Label − Shipping Fee (tổng theo seller, công thức nguyên văn). ' +
      'NULL khi label khác đơn vị tiền đang xem.',
  })
  currentProfit!: number | null;
  @ApiProperty() paid!: number;
  @ApiProperty() processing!: number;
  @ApiProperty() hold!: number;
}

export class DashboardSellerPageDto {
  @ApiPropertyOptional({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ type: DashboardSellerRowDto, isArray: true }) items!: DashboardSellerRowDto[];
  @ApiProperty({ type: Object }) meta!: { total: number; page: number; limit: number; totalPages: number };
}

export class DashboardFilterOptionsDto {
  @ApiProperty({ type: String, isArray: true, description: 'Đơn vị tiền có dữ liệu, phổ biến nhất trước.' })
  currencies!: string[];
  @ApiProperty({ type: Object, isArray: true }) shops!: Array<{ id: string; name: string; region: string | null }>;
  @ApiProperty({ type: Object, isArray: true }) sellers!: Array<{ id: string; name: string }>;
}

export class DashboardTrendsDto {
  @ApiPropertyOptional({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: Object, isArray: true })
  finance!: Array<{ day: string; paid: number; processing: number }>;
  @ApiProperty({ type: Object, isArray: true })
  orders!: Array<{ day: string; total: number; delivered: number; inProgress: number; cancelled: number }>;
}
