import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const EMPLOYEE_WORK_SORT_FIELDS = ['listings', 'orders', 'profit', 'name'] as const;
export type EmployeeWorkSortField = (typeof EMPLOYEE_WORK_SORT_FIELDS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Bộ lọc màn "Thống kê công việc nhân viên". Tổ chức luôn lấy từ JWT — không nhận từ client. */
export class EmployeeWorkQueryDto {
  @ApiPropertyOptional({ example: '2026-10-06', description: 'Từ ngày (giờ vận hành). Bỏ trống ⇒ hôm nay.' })
  @IsOptional()
  @Matches(DAY, { message: 'from phải có dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-06', description: 'Đến ngày, gồm trọn ngày. Bỏ trống ⇒ bằng `from`.' })
  @IsOptional()
  @Matches(DAY, { message: 'to phải có dạng YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ description: 'Chỉ một người (id người dùng — lấy từ /filters).' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ description: 'Chỉ một TikTok Shop (id — lấy từ /filters).' })
  @IsOptional()
  @IsUUID('4')
  shopId?: string;

  @ApiPropertyOptional({ example: 'USD', description: 'Đơn vị tiền. Bỏ trống ⇒ đơn vị phổ biến nhất (như Dashboard).' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ enum: EMPLOYEE_WORK_SORT_FIELDS, default: 'listings' })
  @IsOptional()
  @IsIn(EMPLOYEE_WORK_SORT_FIELDS)
  sort?: EmployeeWorkSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Mặc định: desc (tên: asc).' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class EmployeeWorkAccountDto {
  @ApiProperty() shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty() accountName!: string;
  @ApiProperty({
    enum: ['ACTIVE', 'INACTIVE', 'DEAUTHORIZED'],
    description: 'Trạng thái SHOP (pod_tiktok_shops.status): ACTIVE = Live, INACTIVE = Die, DEAUTHORIZED = mất uỷ quyền.',
  })
  shopStatus!: string;
  @ApiProperty({ description: 'Người này phụ trách shop (TikTok Account được gán cho họ)' }) assigned!: boolean;
  @ApiProperty({ description: 'Sản phẩm NGƯỜI NÀY đã đưa lên shop trong khoảng (không đếm trùng)' }) listings!: number;
  @ApiProperty({ description: 'Đơn của SHOP trong khoảng' }) orders!: number;
  @ApiProperty({ description: 'Đơn tính được lợi nhuận (đủ dữ kiện như màn Order)' }) profitOrders!: number;
  @ApiProperty({ nullable: true, type: Number, description: 'Σ lợi nhuận; null = chưa đơn nào tính được' })
  profit!: number | null;
}

export class EmployeeWorkRowDto {
  @ApiProperty({ description: 'Id người dùng — chỉ dùng làm khoá, giao diện không hiển thị' }) userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ description: 'Có hồ sơ Employee (Admin không có hồ sơ vẫn có thể có listing)' }) isEmployee!: boolean;
  @ApiProperty() active!: boolean;
  @ApiProperty() accounts!: number;
  @ApiProperty() listings!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() profitOrders!: number;
  @ApiProperty({ nullable: true, type: Number }) profit!: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Lợi nhuận / đơn tính được lợi nhuận' })
  profitPerOrder!: number | null;
  @ApiProperty({ type: [EmployeeWorkAccountDto] }) accountDetails!: EmployeeWorkAccountDto[];
}

export class EmployeeWorkSummaryDto {
  @ApiProperty({ description: 'Người có ít nhất một listing trong khoảng' }) activeEmployees!: number;
  @ApiProperty({ description: 'Shop có ít nhất một listing trong khoảng' }) accountsListed!: number;
  @ApiProperty() productsListed!: number;
  @ApiProperty({ description: 'Đơn của các shop thuộc phạm vi — MỖI shop tính MỘT lần' }) orders!: number;
  @ApiProperty() profitOrders!: number;
  @ApiProperty({ nullable: true, type: Number }) profit!: number | null;
  @ApiProperty({ nullable: true, type: Number }) profitPerOrder!: number | null;
}

export class EmployeeWorkPageDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty() timezoneOffsetMinutes!: number;
  @ApiProperty({ type: EmployeeWorkSummaryDto }) summary!: EmployeeWorkSummaryDto;
  @ApiProperty({ type: [EmployeeWorkRowDto] }) items!: EmployeeWorkRowDto[];
  @ApiProperty() meta!: { total: number; page: number; limit: number; totalPages: number };
}

export class EmployeeWorkListedEmployeeDto {
  @ApiProperty({ description: 'Id người dùng — chỉ dùng làm khoá' }) userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Phân biệt người trùng tên' }) email!: string;
  @ApiProperty() isEmployee!: boolean;
  @ApiProperty() active!: boolean;
  @ApiProperty({ description: 'Tài khoản đã bị xoá sau khi listing (listing vẫn được tính trong khoảng)' }) deleted!: boolean;
  @ApiProperty({ description: 'Số sản phẩm đã đưa lên sàn trong khoảng' }) listings!: number;
  @ApiProperty({ description: 'Số shop người này đã listing trong khoảng' }) shops!: number;
}

export class EmployeeWorkListedShopDto {
  @ApiProperty() shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty({ description: 'Tên kết nối (TikTok Account)' }) accountName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'DEAUTHORIZED'] }) shopStatus!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ description: 'Nhân viên thực hiện listing (người chạy lượt listing)' }) userName!: string;
  @ApiProperty() userEmail!: string;
  @ApiProperty() listings!: number;
}

export class EmployeeWorkListingDetailsDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({
    type: [EmployeeWorkListedEmployeeDto],
    description: 'Mỗi người MỘT dòng — số dòng = thẻ "Nhân viên có listing".',
  })
  employees!: EmployeeWorkListedEmployeeDto[];
  @ApiProperty({
    type: [EmployeeWorkListedShopDto],
    description: 'Mỗi cặp (shop × người listing) MỘT dòng — một shop có thể có nhiều dòng nếu nhiều người cùng listing.',
  })
  shops!: EmployeeWorkListedShopDto[];
  @ApiProperty({ description: 'Số shop DUY NHẤT = thẻ "Shop được listing" (không phải số dòng của `shops`).' })
  uniqueShops!: number;
}

export class EmployeeWorkFilterOptionsDto {
  @ApiProperty({ type: [String] }) currencies!: string[];
  @ApiProperty() users!: Array<{ id: string; name: string; isEmployee: boolean; active: boolean }>;
  @ApiProperty() shops!: Array<{ id: string; name: string; accountName: string; region: string }>;
}
