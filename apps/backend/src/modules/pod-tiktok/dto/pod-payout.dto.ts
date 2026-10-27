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
import {
  PAYOUT_SORT_FIELDS,
  type PayoutSortField,
} from '../repositories/pod-payout-report.repository';

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
 * Preset thời gian được quy đổi tại BACKEND theo múi giờ nghiệp vụ IANA
 * (`APP_BUSINESS_TIMEZONE`, mặc định America/Los_Angeles) — frontend KHÔNG tự lọc.
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

  @ApiPropertyOptional({ description: 'Ngày bắt đầu `YYYY-MM-DD` — ngày lịch theo múi giờ nghiệp vụ. Dùng với datePreset=CUSTOM.' })
  @IsOptional()
  @IsISO8601({}, { message: 'fromDate phải là ngày hợp lệ (ISO 8601)' })
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Ngày kết thúc `YYYY-MM-DD` (múi giờ nghiệp vụ) — bao gồm TRỌN ngày này.' })
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

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20, description: 'Số dòng mỗi trang (ADR-023).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /**
   * Tên CŨ của `limit` ở riêng nhóm endpoint Payout.
   *
   * 🔴 Giữ lại để client cũ / URL đã lưu không gãy. `limit` luôn được ưu tiên; khi cả hai
   * cùng vắng thì mặc định 20. Không đặt `= 20` ở đây, nếu không `limit` sẽ không bao giờ
   * thắng được giá trị mặc định của tham số cũ.
   */
  @ApiPropertyOptional({ minimum: 1, maximum: 100, deprecated: true, description: 'Tên cũ của `limit`.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

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
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Chỉ đồng bộ một shop. Bỏ trống = mọi shop.',
  })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({
    description: 'Kéo lại TOÀN BỘ lịch sử payout thay vì cửa sổ cuốn chiếu. An toàn khi chạy lại.',
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
  @ApiProperty({ nullable: true, type: String, description: 'Thời điểm đầu (UTC, bao gồm).' })
  from!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Thời điểm cuối (UTC, bao gồm) = 1 ms trước 00:00 ngày kế tiếp.' })
  to!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-01',
    description: 'Ngày đầu theo múi giờ nghiệp vụ (APP_BUSINESS_TIMEZONE) — dùng để HIỂN THỊ.',
  })
  fromDay!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '2026-10-27', description: 'Ngày cuối (gồm trọn ngày).' })
  toDay!: string | null;
}

export class PodPayoutSummaryDto {
  @ApiProperty({
    description:
      'Tổng Payout của toàn bộ Account trong khoảng lọc. Chuỗi để không mất độ chính xác.',
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
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ID Employee phụ trách. NULL = chưa phân công.',
  })
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
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ID Employee phụ trách. NULL = chưa phân công.',
  })
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
