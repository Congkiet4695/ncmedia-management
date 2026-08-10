import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { PodSyncStatus, PodSyncTrigger } from '@prisma/client';
import { TIKTOK_ORDER_STATUSES } from '../constants/tiktok.constants';
import { POD_DATE_PRESETS, type PodDatePreset } from '../utils/date-range.util';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBool = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/** Trường sắp xếp cho danh sách đơn (whitelist — chống inject qua orderBy). */
export const POD_ORDER_SORT_FIELDS = [
  'orderedAt',
  'tiktokUpdatedAt',
  'totalAmount',
  'status',
  'lastSyncedAt',
] as const;
export type PodOrderSortField = (typeof POD_ORDER_SORT_FIELDS)[number];

export class PodOrderQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo Order ID / Tracking / Email / Nickname người mua' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({
    enum: TIKTOK_ORDER_STATUSES,
    description: 'Trạng thái đơn TikTok',
  })
  @IsOptional()
  @IsIn(TIKTOK_ORDER_STATUSES, { message: 'Trạng thái đơn không hợp lệ' })
  status?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Lọc theo TikTok Shop đã link' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Lọc theo kết nối (account)' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    description: 'Loại đơn: NORMAL | MADE_TO_ORDER | PRE_ORDER | BACK_ORDER | ...',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  orderType?: string;

  @ApiPropertyOptional({ description: 'Chỉ đơn có sản phẩm tuỳ biến POD' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  hasPodItem?: boolean;

  @ApiPropertyOptional({
    enum: POD_DATE_PRESETS,
    description:
      'Bộ lọc nhanh theo Ngày đặt đơn. Backend tự quy đổi theo múi giờ vận hành ' +
      '(APP_TIMEZONE_OFFSET_MINUTES). Chọn CUSTOM thì dùng kèm orderedFrom/orderedTo.',
  })
  @IsOptional()
  @IsIn(POD_DATE_PRESETS, { message: 'Khoảng thời gian không hợp lệ' })
  datePreset?: PodDatePreset;

  @ApiPropertyOptional({ description: 'Đơn đặt từ ngày (ISO date) — dùng với preset CUSTOM' })
  @IsOptional()
  @IsISO8601()
  orderedFrom?: string;

  @ApiPropertyOptional({
    description: 'Đơn đặt đến ngày (ISO date) — dùng với preset CUSTOM. Bao gồm TRỌN ngày này.',
  })
  @IsOptional()
  @IsISO8601()
  orderedTo?: string;

  @ApiPropertyOptional({ enum: POD_ORDER_SORT_FIELDS, default: 'orderedAt' })
  @IsOptional()
  @IsIn(POD_ORDER_SORT_FIELDS)
  sortBy?: PodOrderSortField = 'orderedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

/** Query nhật ký đồng bộ. */
export class PodSyncLogQueryDto {
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

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ enum: PodSyncStatus })
  @IsOptional()
  @IsEnum(PodSyncStatus)
  status?: PodSyncStatus;

  @ApiPropertyOptional({ enum: PodSyncTrigger })
  @IsOptional()
  @IsEnum(PodSyncTrigger)
  trigger?: PodSyncTrigger;
}

/** Body của trigger đồng bộ thủ công. */
export class TriggerSyncDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Chỉ đồng bộ một shop. Bỏ trống = đồng bộ toàn bộ shop của tổ chức.',
  })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 43200,
    description: 'Quét lùi bao nhiêu phút so với hiện tại (mặc định dùng watermark đã lưu).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(43200)
  lookbackMinutes?: number;

  @ApiPropertyOptional({
    description: 'Bỏ qua so sánh và ghi đè toàn bộ (dùng khi sửa mapping).',
    default: false,
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    description:
      'Kéo lại TOÀN BỘ lịch sử đơn theo `create_time` (pha BACKFILL). Dùng khi shop mới ' +
      'liên kết hoặc nghi ngờ thiếu đơn cũ. An toàn để chạy lại: đơn đã có sẽ được bỏ qua ' +
      'hoặc cập nhật, không tạo bản ghi trùng. Bỏ qua `lookbackMinutes` khi bật.',
    default: false,
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  backfill?: boolean;
}
