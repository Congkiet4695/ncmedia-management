import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
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

/** Dạng ngày lịch `YYYY-MM-DD` (ngày có thật hay không — kiểm ở `parseCalendarDay`). */
const CALENDAR_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Email: bỏ khoảng trắng + chữ thường; chuỗi rỗng ⇒ `null` (xoá). */
const normalizeEmail = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  return normalized === '' ? null : normalized;
};

/**
 * Secret (password / 2FA): chuỗi rỗng ⇒ `undefined` = GIỮ NGUYÊN giá trị đã lưu. Xoá phải gửi `null` tường minh —
 * một ô để trống không bao giờ vô tình xoá mật khẩu.
 */
const blankSecretUnchanged = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** 2FA: như secret, thêm bỏ khoảng trắng đầu/cuối (khoá 2FA không có khoảng trắng có nghĩa ở hai đầu). */
const blankSecretUnchangedTrimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? (value.trim() === '' ? undefined : value.trim()) : value;

/** Ngày: chuỗi rỗng ⇒ `null` (xoá). */
const blankDateToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

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
/**
 * PATCH /pod/tiktok/accounts/:id/login-info — thông tin nhập tay của kết nối, MỘT request cho cả form.
 *
 * Quy ước mọi trường: bỏ qua (`undefined`) = KHÔNG đổi · `null` = xoá · giá trị = đặt mới.
 * 🔴 Password / 2FA: chuỗi rỗng cũng = không đổi (ô password để trống khi sửa trường khác).
 */
export class UpdatePodTiktokAccountLoginInfoDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 255, example: 'shop.us@gmail.com', description: 'Tiktok mail' })
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Tiktok mail không đúng định dạng email' })
  @MaxLength(255)
  tiktokMail?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 256,
    format: 'password',
    description: 'Password tiktok — lưu MÃ HOÁ, không bao giờ được trả lại ở API list/detail.',
  })
  @IsOptional()
  @Transform(blankSecretUnchanged)
  @IsString()
  @MaxLength(256)
  tiktokPassword?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 256,
    format: 'password',
    description: '2FA Code — khoá/secret 2FA của tài khoản TikTok; lưu MÃ HOÁ như password.',
  })
  @IsOptional()
  @Transform(blankSecretUnchangedTrimmed)
  @IsString()
  @MaxLength(256)
  tiktokTwoFactorCode?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-11-05', description: 'Ngày về tiền (ngày lịch YYYY-MM-DD)' })
  @IsOptional()
  @Transform(blankDateToNull)
  @IsString()
  @Matches(CALENDAR_DAY, { message: 'Ngày về tiền phải có dạng YYYY-MM-DD' })
  moneyReturnDate?: string | null;
}

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
