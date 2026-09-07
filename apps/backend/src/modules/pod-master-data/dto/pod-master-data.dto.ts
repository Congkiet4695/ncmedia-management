import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PodResourceSyncStatus, PodResourceType } from '@prisma/client';
import {
  POD_MASTER_DATA_ATTRIBUTE_MAX_CATEGORIES,
  POD_MASTER_DATA_LOG_MAX_ITEMS,
} from '../constants/pod-master-data.constants';

/**
 * Yêu cầu đồng bộ Master Data toàn cục (Super Admin).
 *
 * Bỏ trống tất cả = chạy đủ ba tài nguyên với shop nguồn do hệ thống tự chọn — đúng hành vi
 * của nút "Sync Now".
 */
export class SyncMasterDataDto {
  @ApiPropertyOptional({
    description:
      'Shop dùng làm NGUỒN gọi TikTok. Bỏ trống ⇒ hệ thống tự chọn shop đủ điều kiện đầu tiên. ' +
      'API master data của TikTok bắt buộc có shop context nên luôn phải mượn token của một shop.',
  })
  @IsOptional()
  @IsUUID()
  sourceShopId?: string;

  @ApiPropertyOptional({
    enum: PodResourceType,
    isArray: true,
    description:
      'Chỉ chạy một số tài nguyên. Bỏ trống ⇒ CATEGORY → BRAND → CATEGORY_ATTRIBUTE (đúng thứ tự phụ thuộc).',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(PodResourceType, { each: true })
  resources?: PodResourceType[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Chỉ lấy thuộc tính của những danh mục này (id nội bộ). Bỏ trống ⇒ các danh mục lá lâu chưa đồng bộ nhất.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_MASTER_DATA_ATTRIBUTE_MAX_CATEGORIES)
  @IsUUID('4', { each: true })
  categoryIds?: string[];
}

/** Lọc nhật ký đồng bộ master data. */
export class MasterDataLogQueryDto {
  @ApiPropertyOptional({ enum: PodResourceType })
  @IsOptional()
  @IsEnum(PodResourceType)
  resource?: PodResourceType;

  @ApiPropertyOptional({ description: 'Chỉ lấy nhật ký của một lượt chạy' })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ default: 50, maximum: POD_MASTER_DATA_LOG_MAX_ITEMS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POD_MASTER_DATA_LOG_MAX_ITEMS)
  limit?: number;
}

/** Trạng thái MỘT tài nguyên master toàn cục. */
export class MasterDataResourceStatusDto {
  @ApiProperty({ enum: PodResourceType })
  resource!: PodResourceType;

  @ApiProperty({ description: 'Số bản ghi ĐANG CÓ trong database (đếm thật, không phải số lượt cuối)' })
  totalRecords!: number;

  @ApiProperty({ enum: PodResourceSyncStatus, description: 'IDLE · RUNNING · SUCCESS · PARTIAL · FAILED' })
  status!: PodResourceSyncStatus;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Lần đồng bộ THÀNH CÔNG gần nhất' })
  lastSyncAt!: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true }) startedAt!: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) completedAt!: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) failedAt!: Date | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) durationMs!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lastError!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) jobId!: string | null;

  @ApiProperty({ description: 'Tài nguyên phải có dữ liệu trước thì tài nguyên này mới chạy được' })
  dependsOn!: PodResourceType | null;

  @ApiProperty({ description: '`false` ⇒ khoá nút Sync vì phụ thuộc chưa có dữ liệu' })
  ready!: boolean;
}

/**
 * Toàn cảnh Master Data — dùng cho CẢ Super Admin lẫn Admin tổ chức.
 *
 * 🔴 Admin tổ chức ĐƯỢC xem màn hình này (số liệu, lần đồng bộ gần nhất, trạng thái) nhưng
 * KHÔNG có nút Sync. Giấu luôn thông tin chỉ khiến họ tưởng hệ thống trống rỗng và đi tìm
 * nút đồng bộ không tồn tại.
 */
export class MasterDataStatusDto {
  @ApiProperty({ description: 'Người gọi có quyền chạy đồng bộ hay không (Super Admin nền tảng)' })
  @IsBoolean()
  canSync!: boolean;

  @ApiProperty({ type: [MasterDataResourceStatusDto] })
  resources!: MasterDataResourceStatusDto[];
}

/** Kết quả một lượt bấm Sync. */
export class MasterDataSyncResultDto {
  @ApiProperty({ description: 'Mã lượt chạy — dùng để mở đúng nhật ký của lượt này' })
  jobId!: string;

  @ApiProperty({ enum: PodResourceSyncStatus })
  status!: PodResourceSyncStatus;

  @ApiProperty({ description: 'Tổng số bản ghi ghi được trong cả lượt' })
  totalRecords!: number;

  @ApiProperty({ description: 'Thời gian chạy cả lượt (ms)' })
  durationMs!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  sourceShopId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  error!: string | null;

  @ApiProperty({
    description: 'Kết quả từng tài nguyên',
    type: 'array',
    items: { type: 'object' },
  })
  details!: Array<{
    resource: PodResourceType;
    status: PodResourceSyncStatus;
    records: number;
    durationMs: number;
    error?: string;
  }>;
}
