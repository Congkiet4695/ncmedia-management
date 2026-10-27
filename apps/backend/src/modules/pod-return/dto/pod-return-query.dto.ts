import { ApiPropertyOptional } from '@nestjs/swagger';
import { PodReturnStatusGroup } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { POD_DATE_PRESETS, type PodDatePreset } from '../../pod-tiktok/utils/date-range.util';
import { POD_RETURN_SORT_FIELDS, type PodReturnSortField } from '../constants/pod-return.constants';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Mã TikTok (return_type / return_status / return_reason): chữ hoa, số, gạch dưới, chấm. */
const TIKTOK_CODE = /^[A-Za-z0-9_.-]+$/;

/** Bộ lọc dùng chung của danh sách và thẻ tổng quan — hai nơi PHẢI trả lời cùng một tập yêu cầu. */
export class PodReturnFilterDto {
  @ApiPropertyOptional({ description: 'Tìm theo TikTok Order ID hoặc Return ID (khớp một phần)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Lọc theo TikTok Shop' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Lọc theo kết nối TikTok (account)' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: '`return_type` nguyên văn (REFUND, RETURN_AND_REFUND …)' })
  @IsOptional()
  @Transform(trim)
  @Matches(TIKTOK_CODE)
  @MaxLength(40)
  returnType?: string;

  @ApiPropertyOptional({ enum: PodReturnStatusGroup, description: 'Nhóm trạng thái nội bộ' })
  @IsOptional()
  @IsEnum(PodReturnStatusGroup)
  statusGroup?: PodReturnStatusGroup;

  @ApiPropertyOptional({ description: '`return_status` nguyên văn của TikTok' })
  @IsOptional()
  @Transform(trim)
  @Matches(TIKTOK_CODE)
  @MaxLength(64)
  returnStatus?: string;

  @ApiPropertyOptional({ description: '`return_reason` (mã lý do) nguyên văn của TikTok' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    enum: ['requestedAt', 'updatedAt'],
    default: 'requestedAt',
    description: 'Trục thời gian của bộ lọc ngày: thời điểm tạo yêu cầu hoặc cập nhật gần nhất (TikTok).',
  })
  @IsOptional()
  @IsIn(['requestedAt', 'updatedAt'])
  dateField?: 'requestedAt' | 'updatedAt' = 'requestedAt';

  @ApiPropertyOptional({ enum: POD_DATE_PRESETS, description: 'Quy đổi ở backend theo múi giờ nghiệp vụ (APP_BUSINESS_TIMEZONE)' })
  @IsOptional()
  @IsIn(POD_DATE_PRESETS)
  datePreset?: PodDatePreset;

  @ApiPropertyOptional({ description: 'Từ ngày (ISO) — dùng với preset CUSTOM' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Đến ngày (ISO) — dùng với preset CUSTOM, gồm TRỌN ngày này' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class PodReturnQueryDto extends PodReturnFilterDto {
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

  @ApiPropertyOptional({ enum: POD_RETURN_SORT_FIELDS, default: 'requestedAt' })
  @IsOptional()
  @IsIn(POD_RETURN_SORT_FIELDS)
  sortBy?: PodReturnSortField = 'requestedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

/** Đồng bộ thủ công: một shop, hoặc mọi shop trong phạm vi người dùng. */
export class TriggerReturnSyncDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Bỏ trống ⇒ mọi shop người dùng được phép xem' })
  @IsOptional()
  @IsUUID()
  shopId?: string;
}
