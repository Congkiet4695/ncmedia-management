import { FulfillmentProvider } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Shop TikTok đã liên kết.
 * ⚠️ KHÔNG chứa `shop_cipher` — đây là credential, không bao giờ expose ra API.
 */
export class PodTiktokShopDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'TikTok Shop ID', example: '7000714532876273420' })
  tiktokShopId!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Mã shop ở Seller Center' })
  shopCode!: string | null;
  @ApiProperty({ example: 'Maomao beauty shop' }) name!: string;
  @ApiProperty({ example: 'US' }) region!: string;
  @ApiProperty({ example: 'LOCAL', description: 'LOCAL | CROSS_BORDER' }) sellerType!: string;
  @ApiProperty({ description: 'Bật/tắt đồng bộ đơn (dùng từ Sprint Sync Orders)' })
  syncEnabled!: boolean;
  @ApiProperty({ nullable: true, type: String }) lastOrderSyncAt!: string | null;
  @ApiProperty() createdAt!: string;
}

/**
 * Chi tiết kết nối TikTok Shop.
 * ⚠️ KHÔNG chứa access_token / refresh_token — chỉ trả metadata về thời hạn.
 */
export class PodTiktokAccountResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'NCMedia US Store' }) accountName!: string;
  @ApiProperty({ description: 'open_id đã che bớt (audit/diagnostics)', example: '70107360***5637' })
  openIdMasked!: string;
  @ApiProperty({ nullable: true, type: String }) sellerName!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'ID Employee phụ trách kết nối (Seller). NULL = chưa phân công. ' +
      'Đây là nguồn duy nhất xác định Seller cho Order/Payout/Dashboard.',
  })
  sellerId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Họ tên Seller phụ trách' })
  sellerFullName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Email Seller phụ trách' })
  sellerEmail!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  fulfillmentAccountId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Tên nhà cung cấp fulfillment.' })
  fulfillmentProviderName!: string | null;
  @ApiProperty({ nullable: true, enum: FulfillmentProvider })
  fulfillmentProviderType!: FulfillmentProvider | null;
  @ApiProperty({ nullable: true, type: Boolean, description: 'Nhà cung cấp đang ACTIVE?' })
  fulfillmentProviderActive!: boolean | null;

  @ApiProperty({ nullable: true, type: String, example: 'US' }) sellerBaseRegion!: string | null;
  @ApiProperty({ example: 0, description: '0=Seller, 4/5=Global Selling seller' })
  userType!: number;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;

  @ApiProperty({ description: 'Thời điểm hết hạn Access Token' })
  accessTokenExpiresAt!: string;
  @ApiProperty({ description: 'Thời điểm hết hạn Refresh Token (= hạn uỷ quyền của Seller)' })
  refreshTokenExpiresAt!: string;
  @ApiProperty({ description: 'Access Token đã hết hạn hay chưa (tính runtime)' })
  accessTokenExpired!: boolean;
  @ApiProperty({
    description: 'Số ngày còn lại trước khi phải uỷ quyền lại (tính runtime, có thể âm)',
  })
  daysUntilReauthorize!: number;

  @ApiProperty({ type: String, isArray: true, description: 'Scope thực tế TikTok đã cấp' })
  grantedScopes!: string[];

  @ApiProperty({ nullable: true, type: String }) lastRefreshedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Mã lỗi TikTok gần nhất' })
  lastErrorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastErrorMessage!: string | null;

  @ApiProperty({ type: PodTiktokShopDto, isArray: true }) shops!: PodTiktokShopDto[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/** Hàng danh sách — mỗi kết nối kèm shop chính (shop đầu tiên) để hiển thị nhanh. */
export class PodTiktokAccountListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() accountName!: string;
  @ApiProperty({ nullable: true, type: String }) sellerName!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'ID Employee phụ trách kết nối (Seller). NULL = chưa phân công. ' +
      'Đây là nguồn duy nhất xác định Seller cho Order/Payout/Dashboard.',
  })
  sellerId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Họ tên Seller phụ trách' })
  sellerFullName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Email Seller phụ trách' })
  sellerEmail!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  fulfillmentAccountId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Tên nhà cung cấp fulfillment.' })
  fulfillmentProviderName!: string | null;
  @ApiProperty({ nullable: true, enum: FulfillmentProvider })
  fulfillmentProviderType!: FulfillmentProvider | null;
  @ApiProperty({ nullable: true, type: Boolean, description: 'Nhà cung cấp đang ACTIVE?' })
  fulfillmentProviderActive!: boolean | null;

  @ApiProperty({ nullable: true, type: String, description: 'Tên shop (shop đầu tiên)' })
  shopName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'TikTok Shop ID (shop đầu tiên)' })
  tiktokShopId!: string | null;
  @ApiProperty({ nullable: true, type: String }) region!: string | null;
  @ApiProperty({ description: 'Tổng số shop thuộc kết nối này' }) shopCount!: number;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
  @ApiProperty() accessTokenExpiresAt!: string;
  @ApiProperty() refreshTokenExpiresAt!: string;
  @ApiProperty() accessTokenExpired!: boolean;
  @ApiProperty() daysUntilReauthorize!: number;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class PodTiktokPaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedPodTiktokAccountResponseDto {
  @ApiProperty({ type: PodTiktokAccountListItemDto, isArray: true })
  items!: PodTiktokAccountListItemDto[];
  @ApiProperty({ type: PodTiktokPaginationMetaDto }) meta!: PodTiktokPaginationMetaDto;
}

/** Link uỷ quyền để Seller mở trên trình duyệt. */
export class PodTiktokAuthorizeUrlDto {
  @ApiProperty({
    example: 'https://services.us.tiktokshop.com/open/authorize?service_id=xxx',
    description: 'Mở link này, đăng nhập TikTok và Approve để nhận Authorization Code',
  })
  authorizeUrl!: string;

  @ApiProperty({ example: 'US', description: 'Thị trường dùng để dựng link' })
  region!: string;
}

/**
 * Một lựa chọn trong dropdown "Seller phụ trách".
 * Chỉ gồm Employee đang ACTIVE và có Role `EMPLOYEE` — Admin/Fulfillment không xuất hiện.
 */
export class PodSellerOptionDto {
  @ApiProperty({ description: 'ID Employee — giá trị gửi lên khi phân công' })
  id!: string;
  @ApiProperty({ example: 'Nguyễn Văn A' }) fullName!: string;
  @ApiProperty({ example: 'nva@gmail.com' }) email!: string;
}
