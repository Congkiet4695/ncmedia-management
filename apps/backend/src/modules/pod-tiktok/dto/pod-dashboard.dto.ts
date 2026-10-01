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
import { SELLER_SORT_FIELDS, type SellerSortField } from '../repositories/pod-dashboard.repository';
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

/** Bộ lọc + khoảng ngày (theo giờ vận hành, gồm trọn hai ngày mút). Bỏ trống ⇒ tháng hiện tại. */
export class PodDashboardRangeDto extends PodDashboardFilterDto {
  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DAY, { message: 'from phải có dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(DAY, { message: 'to phải có dạng YYYY-MM-DD' })
  to?: string;
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
  @ApiProperty({ description: 'false: hệ thống chưa đồng bộ TikTok Return & Refund — không có số đơn hoàn.' })
  returnsAvailable!: boolean;
}

export class DashboardSellerRowDto {
  @ApiPropertyOptional({ nullable: true, type: String }) sellerId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerEmail!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() orders!: number;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'NULL: chưa có dữ liệu hoàn hàng.' })
  returns!: number | null;
  @ApiProperty() estRevenue!: number;
  @ApiProperty() revenue!: number;
  @ApiProperty() baseCost!: number;
  @ApiProperty({ description: 'PF = Est. Revenue − Basecost.' }) profit!: number;
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
