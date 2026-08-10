import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PodPayoutStatus } from '@prisma/client';
import { POD_DATE_PRESETS, type PodDatePreset } from '../utils/date-range.util';
import { PAYOUT_SORT_FIELDS, type PayoutSortField } from '../repositories/pod-payout-report.repository';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBool = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Bộ lọc dùng chung cho cả 3 API báo cáo payout.
 *
 * Preset thời gian được quy đổi tại BACKEND theo múi giờ vận hành
 * (`APP_TIMEZONE_OFFSET_MINUTES`) — frontend KHÔNG tự lọc.
 */
export class PodPayoutFilterDto {
  @ApiPropertyOptional({
    enum: POD_DATE_PRESETS,
    description:
      'Khoảng thời gian dựng sẵn. CUSTOM (hoặc bỏ trống) thì dùng fromDate/toDate. ' +
      'Lọc trên thời điểm TikTok khởi tạo chi trả (`payment_create_time`).',
    default: 'LAST_30_DAYS',
  })
  @IsOptional()
  @IsIn(POD_DATE_PRESETS, { message: 'Khoảng thời gian không hợp lệ' })
  datePreset?: PodDatePreset;

  @ApiPropertyOptional({ description: 'Ngày bắt đầu (ISO). Dùng với datePreset=CUSTOM.' })
  @IsOptional()
  @IsISO8601({}, { message: 'fromDate phải là ngày hợp lệ (ISO 8601)' })
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Ngày kết thúc (ISO) — bao gồm TRỌN ngày này.' })
  @IsOptional()
  @IsISO8601({}, { message: 'toDate phải là ngày hợp lệ (ISO 8601)' })
  toDate?: string;

  @ApiPropertyOptional({
    enum: PodPayoutStatus,
    description:
      'Trạng thái chi trả. Bỏ trống = tất cả. ' +
      '🔴 TikTok chỉ trả PROCESSING | PAID | FAILED — KHÔNG có CANCELLED.',
  })
  @IsOptional()
  @IsEnum(PodPayoutStatus, { message: 'Trạng thái payout không hợp lệ' })
  payoutStatus?: PodPayoutStatus;

  @ApiPropertyOptional({ description: 'Tìm theo tên Account, email hoặc tên Seller.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;
}

/** Bộ lọc + phân trang + sắp xếp cho hai bảng breakdown. */
export class PodPayoutBreakdownQueryDto extends PodPayoutFilterDto {
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
  pageSize?: number = 20;

  @ApiPropertyOptional({
    enum: PAYOUT_SORT_FIELDS,
    default: 'totalPayout',
    description: 'Mặc định sắp xếp giảm dần theo Payout.',
  })
  @IsOptional()
  @IsIn(PAYOUT_SORT_FIELDS, { message: 'Trường sắp xếp không hợp lệ' })
  sortField?: PayoutSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'Thứ tự sắp xếp không hợp lệ' })
  sortOrder?: 'asc' | 'desc';
}

/** Body kích hoạt đồng bộ payout thủ công. */
export class TriggerPayoutSyncDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Chỉ đồng bộ một shop. Bỏ trống = mọi shop.' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({
    description:
      'Kéo lại TOÀN BỘ lịch sử payout thay vì cửa sổ cuốn chiếu. An toàn khi chạy lại.',
    default: false,
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  full?: boolean;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** Khoảng thời gian đã được backend quy đổi — trả về để FE hiển thị đúng thứ đã lọc. */
export class PodPayoutRangeDto {
  @ApiProperty({ nullable: true, type: String }) from!: string | null;
  @ApiProperty({ nullable: true, type: String }) to!: string | null;
}

export class PodPayoutSummaryDto {
  @ApiProperty({
    description: 'Tổng Payout của toàn bộ Account trong khoảng lọc. Chuỗi để không mất độ chính xác.',
    example: '1102.9300',
  })
  totalPayout!: string;

  @ApiProperty({ nullable: true, type: String, example: 'USD' })
  currency!: string | null;

  @ApiProperty({ description: 'Số lần chi trả' }) paymentCount!: number;
  @ApiProperty({ description: 'Số Account có payout' }) accountCount!: number;
  @ApiProperty({ description: 'Số Seller có payout' }) sellerCount!: number;
  @ApiProperty({ description: 'Số đơn đã đối soát thuộc các payout này' }) orderCount!: number;

  @ApiProperty({ type: PodPayoutRangeDto }) range!: PodPayoutRangeDto;

  @ApiProperty({
    type: String,
    isArray: true,
    description:
      'Các đơn vị tiền tệ xuất hiện. Nhiều hơn một ⇒ tổng ở trên là phép cộng KHÔNG hợp lệ, ' +
      'FE phải cảnh báo thay vì hiển thị như bình thường.',
  })
  currencies!: string[];
}

export class PodPayoutSellerDto {
  @ApiProperty({ nullable: true, type: String, description: 'ID Employee phụ trách. NULL = chưa phân công.' })
  sellerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerEmail!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerName!: string | null;
  @ApiProperty() accountCount!: number;
  @ApiProperty() orderCount!: number;
  @ApiProperty({ example: '431.2500' }) totalPayout!: string;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
}

export class PodPayoutAccountDto {
  @ApiProperty() accountId!: string;
  @ApiProperty() accountName!: string;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'ID Employee phụ trách. NULL = chưa phân công.' })
  sellerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerEmail!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerName!: string | null;
  @ApiProperty() orderCount!: number;
  @ApiProperty({ example: '210.0000' }) totalPayout!: string;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
}

/** Metadata phân trang chuẩn ADR-023 (`page`/`limit`) — dùng chung toàn hệ thống. */
export class PodPayoutMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty({ description: 'Số dòng mỗi trang (nhận từ tham số `pageSize`)' })
  limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedPodPayoutSellerDto {
  @ApiProperty({ type: PodPayoutSellerDto, isArray: true }) items!: PodPayoutSellerDto[];
  @ApiProperty({ type: PodPayoutMetaDto }) meta!: PodPayoutMetaDto;
}

export class PaginatedPodPayoutAccountDto {
  @ApiProperty({ type: PodPayoutAccountDto, isArray: true }) items!: PodPayoutAccountDto[];
  @ApiProperty({ type: PodPayoutMetaDto }) meta!: PodPayoutMetaDto;
}

export class PodPayoutSyncResultDto {
  @ApiProperty() shopsTotal!: number;
  @ApiProperty() shopsSucceeded!: number;
  @ApiProperty() shopsFailed!: number;
  @ApiProperty() paymentsCreated!: number;
  @ApiProperty() paymentsUpdated!: number;
  @ApiProperty() statementsCreated!: number;
  @ApiProperty() statementsUpdated!: number;
  @ApiProperty({ description: 'Số statement đã kéo giao dịch cấp đơn trong lượt này' })
  statementsWithTransactions!: number;
  @ApiProperty() apiCalls!: number;
  @ApiProperty() durationMs!: number;
}
