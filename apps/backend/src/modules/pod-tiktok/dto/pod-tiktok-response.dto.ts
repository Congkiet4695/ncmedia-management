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

/**
 * Link uỷ quyền để người dùng copy (hoặc mở trực tiếp).
 * ⚠️ KHÔNG trả `state` thành trường riêng: nó là bí mật phía server, chỉ đi kèm trong `authorizeUrl`.
 */
export class PodTiktokAuthorizeUrlDto {
  @ApiProperty({
    example: 'https://services.us.tiktokshop.com/open/authorize?service_id=xxx&state=yyy',
    description:
      'Authorization URL đầy đủ (đã kèm service_id + state). Sau khi Seller Approve, TikTok ' +
      'gọi callback và hệ thống tự hoàn tất việc liên kết — người dùng KHÔNG phải xử lý auth_code.',
  })
  authorizeUrl!: string;

  @ApiProperty({
    example: 'NCMedia US Store',
    description: 'Tên kết nối người dùng đã nhập — sẽ được gán khi callback hoàn tất',
  })
  accountName!: string;

  @ApiProperty({ example: 'US', description: 'Thị trường dùng để dựng link' })
  region!: string;

  @ApiProperty({
    description: 'Thời điểm phiên uỷ quyền hết hạn (ISO-8601). Quá hạn phải bắt đầu lại.',
  })
  expiresAt!: string;
}

/**
 * Kết quả `POST /tiktok/oauth/complete` — trang kết quả dựng giao diện từ đúng object này.
 *
 * 🔴 Chỉ chứa dữ liệu hiển thị được. KHÔNG có `code`, `access_token`, `refresh_token`,
 * `shop_cipher`. Thất bại cũng trả HTTP 200 với `success = false`: trang cần hiển thị
 * nguyên nhân thân thiện chứ không phải một lỗi mạng.
 */
export class PodTiktokOAuthCompleteDto {
  @ApiProperty({ description: 'Đã liên kết thành công hay chưa' })
  success!: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'NCMedia US Store' })
  accountName!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Maomao beauty shop' })
  shopName!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'US' })
  region!: string | null;
  @ApiProperty({ description: 'Số shop đã liên kết trong phiên này' })
  shopCount!: number;
  @ApiProperty({ nullable: true, type: String, description: 'Thời điểm liên kết (ISO-8601)' })
  linkedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'POD_TIKTOK_INVALID_STATE',
    description: 'Mã lỗi nghiệp vụ khi thất bại — frontend dịch sang thông điệp người dùng',
  })
  errorCode!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Thông điệp thân thiện kèm theo (dự phòng khi frontend chưa có bản dịch)',
  })
  message!: string | null;
}

/**
 * Kết quả một phiên uỷ quyền — đọc bằng vé một lần ở trang công khai
 * `/tiktok/link-success` và `/tiktok/link-failed`.
 *
 * 🔴 Chỉ chứa dữ liệu hiển thị được. KHÔNG có auth_code, access_token, refresh_token,
 * shop_cipher hay bất kỳ định danh nội bộ nào của tổ chức.
 */
export class PodTiktokLinkResultDto {
  @ApiProperty({ description: 'Phiên uỷ quyền đã hoàn tất thành công hay chưa' })
  success!: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'NCMedia US Store' })
  accountName!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerName!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Maomao beauty shop' })
  shopName!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'US' }) region!: string | null;
  @ApiProperty({ description: 'Số shop đã liên kết trong phiên này' }) shopCount!: number;
  @ApiProperty({ nullable: true, type: String, description: 'Thời điểm liên kết (ISO-8601)' })
  linkedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'POD_TIKTOK_INVALID_AUTH_CODE',
    description: 'Mã lỗi nghiệp vụ khi thất bại — frontend dịch sang thông điệp người dùng',
  })
  errorCode!: string | null;
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
