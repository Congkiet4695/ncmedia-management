import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
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
import { PodTiktokAccountStatus, PodTiktokShopStatus } from '@prisma/client';
import { POD_TIKTOK_SORT_FIELDS, type PodTiktokSortField } from '../constants/tiktok.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Giá trị `sellerId` để lọc kết nối CHƯA được phân công Seller (`seller_id IS NULL`). */
export const POD_UNASSIGNED_SELLER = 'UNASSIGNED';
const UUID_OR_UNASSIGNED =
  /^(UNASSIGNED|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Query danh sách kết nối TikTok Shop — pagination page/limit (ADR-023). */
export class PodTiktokAccountQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tên kết nối / tên seller / tên shop' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: PodTiktokAccountStatus })
  @IsOptional()
  @IsEnum(PodTiktokAccountStatus)
  status?: PodTiktokAccountStatus;

  @ApiPropertyOptional({
    enum: PodTiktokShopStatus,
    description:
      'Trạng thái SHOP phía TikTok (Sync Shops) — Active = ACTIVE, Inactive = INACTIVE (cùng định nghĩa Live / Die ' +
      'của Dashboard). Kết nối khớp khi có ít nhất MỘT shop ở trạng thái này. Bỏ trống = tất cả.',
  })
  @IsOptional()
  @IsEnum(PodTiktokShopStatus)
  shopStatus?: PodTiktokShopStatus;

  @ApiPropertyOptional({
    description:
      'Seller phụ trách: Employee id (`pod_tiktok_accounts.seller_id`) hoặc `UNASSIGNED` = chưa phân công. ' +
      'Bỏ trống = tất cả. Vẫn chỉ trong phạm vi người xem.',
  })
  @IsOptional()
  @Matches(UUID_OR_UNASSIGNED, { message: 'sellerId phải là UUID hoặc UNASSIGNED' })
  sellerId?: string;

  @ApiPropertyOptional({ enum: POD_TIKTOK_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(POD_TIKTOK_SORT_FIELDS)
  sortBy?: PodTiktokSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

/**
 * Phân công Seller phụ trách cho một kết nối TikTok.
 *
 * `sellerId` là ID **Employee** (không phải User): seller là vai trò nghiệp vụ nên
 * gắn với hồ sơ nhân sự. Chỉ Employee ACTIVE + Role `EMPLOYEE` được chấp nhận.
 */
export class AssignPodSellerDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'ID Employee phụ trách. Truyền null (hoặc bỏ trống) để BỎ PHÂN CÔNG.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'sellerId phải là UUID hợp lệ' })
  sellerId?: string | null;
}

/**
 * Đặt kho mặc định cho MỘT shop (Warehouse Mapping).
 *
 * 🔴 Kho là dữ liệu của shop, không phải của sản phẩm: cùng một Draft Product đăng lên ba
 * shop là ba kho khác nhau. Đây là chỗ khai báo lựa chọn của từng shop; để trống thì lúc
 * Publish hệ thống tự suy (shop chỉ có một kho, hoặc kho TikTok đánh dấu mặc định).
 */
export class SetShopWarehouseDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'ID kho đã đồng bộ của CHÍNH shop này. Truyền null để bỏ cấu hình.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'warehouseId phải là UUID hợp lệ' })
  warehouseId?: string | null;
}

/** Gán nhà cung cấp fulfillment cho một kết nối TikTok. */
export class AssignFulfillmentProviderDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'ID nhà cung cấp fulfillment. Truyền null (hoặc bỏ trống) để BỎ GÁN — ' +
      'khi đó kết nối không gửi đơn sản xuất được cho tới khi gán lại.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'fulfillmentAccountId phải là UUID hợp lệ' })
  fulfillmentAccountId?: string | null;
}

/** Tìm kiếm trong danh sách Seller có thể chọn. */
export class PodSellerOptionQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo họ tên hoặc email.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;
}

/**
 * "Sync Shops" — đối chiếu thông tin + trạng thái shop với TikTok.
 *
 * Bỏ trống ⇒ mọi kết nối trong PHẠM VI người bấm (Admin: cả tổ chức; Seller: kết nối được gán).
 * `accountId` chỉ THU HẸP phạm vi — kết nối ngoài phạm vi là 403, không phải "không lọc".
 */
export class SyncTiktokShopsDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Chỉ đồng bộ shop của một kết nối' })
  @IsOptional()
  @IsUUID('4', { message: 'accountId phải là UUID hợp lệ' })
  accountId?: string;
}
