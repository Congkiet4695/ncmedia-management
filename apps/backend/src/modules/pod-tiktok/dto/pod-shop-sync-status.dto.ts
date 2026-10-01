import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PodShopSyncType, PodSyncStatus, PodSyncTrigger } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';

/** Query "Latest Sync Status" — không phân trang: tối đa một dòng mỗi shop. */
export class PodShopSyncStatusQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Chỉ xem một shop (phải nằm trong phạm vi)' })
  @IsOptional()
  @IsUUID()
  shopId?: string;
}

/** Trạng thái lần đồng bộ GẦN NHẤT của một shop cho một loại đồng bộ. */
export class PodShopSyncStatusDto {
  @ApiProperty() shopId!: string;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Tên kết nối TikTok' })
  accountName!: string | null;
  @ApiProperty({ enum: PodShopSyncType }) syncType!: PodShopSyncType;
  @ApiProperty({ enum: PodSyncTrigger, description: 'CRON = lịch tự động · MANUAL = Sync Now' })
  trigger!: PodSyncTrigger;
  @ApiProperty({ enum: PodSyncStatus }) status!: PodSyncStatus;
  @ApiProperty() startedAt!: string;
  @ApiProperty({ nullable: true, type: String }) finishedAt!: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Thời lượng (ms)' })
  durationMs!: number | null;
  @ApiProperty({ description: 'ORDER: số đơn đã xử lý · PRODUCT: số sản phẩm đã lấy về' })
  total!: number;
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
  @ApiProperty({
    nullable: true,
    type: Object,
    description: 'Chỉ số chẩn đoán riêng từng loại (phase, cửa sổ, số trang, số lần gọi API, …)',
  })
  details!: Record<string, unknown> | null;
  @ApiProperty({ description: 'Lần cuối dòng trạng thái được ghi' }) updatedAt!: string;
}

export class PodShopSyncStatusListDto {
  @ApiProperty({ type: PodShopSyncStatusDto, isArray: true }) items!: PodShopSyncStatusDto[];
}
