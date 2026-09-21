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

/**
 * Tiến độ của lượt ĐANG chạy — chỉ có khi tài nguyên ở trạng thái RUNNING.
 *
 * 🔴 Quét thương hiệu là hàng chục nghìn lời gọi TikTok kéo dài hàng giờ. Không có con số
 * này, người vận hành nhìn badge RUNNING suốt hai tiếng sẽ tưởng lượt đã treo và bấm lại.
 */
export class MasterDataSyncProgressDto {
  @ApiProperty() jobId!: string;
  @ApiProperty({ enum: PodResourceType }) resource!: PodResourceType;
  @ApiProperty({ description: 'Số lời gọi TikTok đã thực hiện' }) apiCalls!: number;
  @ApiProperty({ description: 'Số bản ghi thô đã nhận từ TikTok' }) fetched!: number;
  @ApiProperty({ description: 'Số bản ghi MỚI đã ghi vào database' }) records!: number;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Vị trí đang xử lý, vd prefix thương hiệu đang quét và số prefix còn chờ',
  })
  detail!: string | null;
  @ApiProperty({ type: String }) updatedAt!: Date;
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

  @ApiPropertyOptional({
    type: MasterDataSyncProgressDto,
    nullable: true,
    description: 'Tiến độ lượt đang chạy — chỉ khác null khi `status = RUNNING`',
  })
  progress!: MasterDataSyncProgressDto | null;
}

/**
 * Xác nhận đã NHẬN lượt đồng bộ (HTTP 202).
 *
 * 🔴 `POST /sync` không còn đợi lượt chạy xong: quét thương hiệu kéo dài hàng giờ, không
 * HTTP request nào sống được tới lúc đó (Nginx, trình duyệt, lock TTL đều cắt trước). Client
 * theo dõi qua `GET /status` (polling khi còn RUNNING) và đọc kết quả ở `GET /logs?jobId=`.
 */
export class MasterDataSyncStartedDto {
  @ApiProperty({ description: 'Mã lượt chạy — dùng để đối chiếu `status.jobId` và mở nhật ký' })
  jobId!: string;

  @ApiProperty({ enum: PodResourceSyncStatus, description: 'Luôn là RUNNING tại thời điểm trả về' })
  status!: PodResourceSyncStatus;

  @ApiProperty({ enum: PodResourceType, isArray: true, description: 'Tài nguyên sẽ chạy, đúng thứ tự' })
  resources!: PodResourceType[];

  @ApiProperty({ description: 'Shop đã mượn token để gọi TikTok' })
  sourceShopId!: string;

  @ApiProperty({ type: String })
  startedAt!: Date;
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
