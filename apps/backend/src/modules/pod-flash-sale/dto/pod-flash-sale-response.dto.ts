import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PodFlashSaleItemStatus,
  PodFlashSaleLogAction,
  PodFlashSaleLogLevel,
  PodFlashSaleProductLevel,
  PodFlashSaleStatus,
} from '@prisma/client';

/**
 * Hình dạng response của module Flash Sale.
 *
 * 🔴 Mọi giá tiền trả về dạng **CHUỖI**, không phải `number`. `Decimal` của Prisma vượt độ
 * chính xác của `number` trong JS; serialize thành số là đánh mất chữ số ở đúng chỗ không
 * được phép mất. Frontend hiển thị nguyên chuỗi và chỉ parse khi cần tính toán.
 */

/** Số đếm theo trạng thái dòng — màn hình danh sách và chi tiết đều dùng. */
export class PodFlashSaleItemCountsDto {
  @ApiProperty() TOTAL!: number;
  @ApiProperty() PENDING!: number;
  @ApiProperty() READY!: number;
  @ApiProperty() PUBLISHED!: number;
  @ApiProperty() FAILED!: number;
  @ApiProperty() REMOVED!: number;
}

/** Shop rút gọn — đủ để vẽ cột "Shop" mà không phải gọi thêm API. */
export class PodFlashSaleShopRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() region!: string;
}

export class PodFlashSaleUserRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
}

/** Hàng trong danh sách Flash Sale. */
export class PodFlashSaleListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: PodFlashSaleStatus }) status!: PodFlashSaleStatus;
  @ApiProperty({ enum: PodFlashSaleProductLevel }) productLevel!: PodFlashSaleProductLevel;
  @ApiProperty({ example: 'TIKTOK' }) provider!: string;

  @ApiProperty({ nullable: true, type: String, description: '`activity_id` phía TikTok' })
  providerFlashSaleId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerStatus!: string | null;

  @ApiProperty() startAt!: string;
  @ApiProperty() endAt!: string;
  @ApiProperty() timezone!: string;

  @ApiProperty({ description: 'Số dòng sản phẩm/biến thể' }) itemCount!: number;
  @ApiProperty({ type: PodFlashSaleShopRefDto }) shop!: PodFlashSaleShopRefDto;
  @ApiProperty() accountId!: string;
  @ApiProperty({ nullable: true, type: String }) accountName!: string | null;

  @ApiProperty({ nullable: true, type: PodFlashSaleUserRefDto })
  createdByUser!: PodFlashSaleUserRefDto | null;

  @ApiProperty({ nullable: true, type: String }) lastErrorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastErrorMessage!: string | null;
  @ApiProperty() retryCount!: number;

  @ApiProperty({ nullable: true, type: String }) publishedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  @ApiProperty({
    description:
      'Giao diện có phải tự làm mới đợt này không (PUBLISHING / RUNNING). Quyết định ở ' +
      'backend để frontend không tự đoán danh sách trạng thái.',
  })
  live!: boolean;
}

/** Một dòng sản phẩm trong đợt sale. */
export class PodFlashSaleItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() productId!: string;
  @ApiProperty({ nullable: true, type: String }) variantId!: string | null;

  @ApiProperty({ nullable: true, type: String }) productTitle!: string | null;
  @ApiProperty({ nullable: true, type: String }) variantName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Ảnh biến thể, không có thì ảnh sản phẩm' })
  imageUrl!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'seller_sku' }) skuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerVariantId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'SKU đã được TikTok xác nhận trong hoạt động' })
  providerSkuId!: string | null;

  @ApiProperty({ example: '29.99' }) originalPrice!: string;
  @ApiProperty({ example: '20.99' }) flashSalePrice!: string;
  @ApiProperty({ example: '30.0000' }) discountPercent!: string;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;

  @ApiProperty({ description: '-1 = không giới hạn' }) totalPurchaseLimit!: number;
  @ApiProperty({ description: '-1 = không giới hạn' }) customerPurchaseLimit!: number;

  @ApiProperty({ enum: PodFlashSaleItemStatus }) status!: PodFlashSaleItemStatus;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) error!: string | null;
  @ApiProperty() sortOrder!: number;
}

/** Một lý do khiến đợt sale chưa publish được. */
export class PodFlashSaleIssueDto {
  @ApiProperty({ enum: ['ERROR', 'WARNING'] }) level!: 'ERROR' | 'WARNING';
  @ApiProperty() code!: string;
  @ApiProperty() field!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Dòng gây lỗi (nếu có)' })
  itemId?: string | null;
}

/** Kết quả kiểm tra trước khi publish. */
export class PodFlashSaleValidationDto {
  @ApiProperty() flashSaleId!: string;
  @ApiProperty({ description: 'Không còn lỗi mức ERROR' }) ok!: boolean;
  @ApiProperty({ type: [PodFlashSaleIssueDto] }) issues!: PodFlashSaleIssueDto[];
  @ApiProperty({ description: 'Số dòng đủ điều kiện gửi lên sàn' }) readyItems!: number;
}

/** Một dòng nhật ký (màn hình Detail — tab History). */
export class PodFlashSaleLogDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PodFlashSaleLogAction }) action!: PodFlashSaleLogAction;
  @ApiProperty({ enum: PodFlashSaleLogLevel }) level!: PodFlashSaleLogLevel;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true, type: Object, description: 'Thân request đã gửi (đã lược token)' })
  request!: unknown;
  @ApiProperty({ nullable: true, type: Object }) response!: unknown;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '`request_id` của TikTok' })
  requestId!: string | null;
  @ApiProperty() attempt!: number;
  @ApiProperty() createdAt!: string;
}

/** Chi tiết một đợt sale (danh sách + dòng sản phẩm + kiểm tra + số đếm). */
export class PodFlashSaleDetailDto extends PodFlashSaleListItemDto {
  /**
   * 🔴 **KHÔNG còn trả về toàn bộ dòng sản phẩm.** Một đợt sale được phép chứa 10.000 SKU;
   * gửi kèm chúng ở đây nghĩa là mỗi lần tải màn hình — và mỗi lần ghi, vì mọi endpoint ghi
   * đều trả về bản chi tiết — đẩy đi vài MB mà giao diện chỉ hiển thị 20 dòng.
   *
   * Bảng sản phẩm đọc từ `GET /pod/flash-sales/:id/products` (phân trang theo SẢN PHẨM).
   * Ở đây chỉ còn hai thứ mà phần đầu màn hình thực sự cần.
   */
  @ApiProperty({
    type: [String],
    description:
      'Id các sản phẩm đã có trong đợt sale — bộ chọn dùng để đánh dấu "đã thêm" và chặn ' +
      'thêm trùng. Chỉ id, không kèm dòng: vài trăm chuỗi thay vì hàng nghìn bản ghi.',
  })
  productIds!: string[];

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Tiền tệ của đợt sale (mọi dòng cùng một shop nên cùng một loại tiền).',
  })
  currency!: string | null;

  @ApiProperty({ type: PodFlashSaleItemCountsDto }) counts!: PodFlashSaleItemCountsDto;
  @ApiProperty({ type: PodFlashSaleValidationDto }) validation!: PodFlashSaleValidationDto;
  @ApiProperty({ description: 'Còn được sửa tên / giờ / sản phẩm không' }) editable!: boolean;
  @ApiProperty({ description: 'Nút Publish có bật không' }) publishable!: boolean;
  @ApiProperty({ description: 'Nút Cancel có bật không' }) cancellable!: boolean;
}

export class PaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedPodFlashSaleDto {
  @ApiProperty({ type: [PodFlashSaleListItemDto] }) items!: PodFlashSaleListItemDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

export class PaginatedPodFlashSaleLogDto {
  @ApiProperty({ type: [PodFlashSaleLogDto] }) items!: PodFlashSaleLogDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

/** Một dòng đã lưu trong template. */
export class PodFlashSaleTemplateItemDto {
  @ApiProperty({ nullable: true, type: String }) productId!: string | null;
  @ApiProperty({ nullable: true, type: String }) variantId!: string | null;
  @ApiProperty({ nullable: true, type: String }) skuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerVariantId!: string | null;
  @ApiProperty({ nullable: true, type: String }) productTitle!: string | null;
  @ApiProperty({ nullable: true, type: String }) variantName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Giá deal đã chốt (nếu template khoá giá)' })
  flashSalePrice!: string | null;
  @ApiProperty({ example: '30.0000' }) discountPercent!: string;
  @ApiProperty() totalPurchaseLimit!: number;
  @ApiProperty() customerPurchaseLimit!: number;
}

export class PodFlashSaleTemplateDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() accountId!: string;
  @ApiProperty({ type: PodFlashSaleShopRefDto }) shop!: PodFlashSaleShopRefDto;
  @ApiProperty({ enum: PodFlashSaleProductLevel }) productLevel!: PodFlashSaleProductLevel;
  @ApiProperty({ description: 'Số dòng sản phẩm trong template' }) itemCount!: number;
  @ApiProperty({ type: [PodFlashSaleTemplateItemDto] }) items!: PodFlashSaleTemplateItemDto[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class PaginatedPodFlashSaleTemplateDto {
  @ApiProperty({ type: [PodFlashSaleTemplateDto] }) items!: PodFlashSaleTemplateDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

/** Kết quả một lần bấm Publish / Retry. */
export class PodFlashSalePublishResultDto {
  @ApiProperty() flashSaleId!: string;
  @ApiProperty({
    enum: PodFlashSaleStatus,
    description:
      'PUBLISHING = hoạt động đã tạo, các lô sản phẩm đang được gửi nền. Theo dõi tiến độ ' +
      'qua GET /pod/flash-sales/:id/publish-status.',
  })
  status!: PodFlashSaleStatus;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      '`activity_id` của TikTok. Có NGAY trong response này; MỌI lô sản phẩm đều được gắn ' +
      'vào đúng id này — không bao giờ tạo hoạt động thứ hai.',
  })
  providerFlashSaleId!: string | null;
  @ApiProperty({ description: 'Số dòng TikTok đã nhận tại thời điểm trả về' }) publishedItems!: number;
  @ApiProperty({ description: 'Số dòng bị bỏ qua vì không hợp lệ' }) skippedItems!: number;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;

  @ApiProperty({ description: 'Tổng số dòng lượt này phải gửi (đã trừ dòng đã lên sàn)' })
  totalItems!: number;
  @ApiProperty({ description: 'Tổng số lô — mỗi lô là MỘT request tới TikTok, tối đa 300 SKU' })
  totalBatches!: number;
  @ApiProperty({ description: 'Số lô đã gửi xong tại thời điểm trả về' })
  doneBatches!: number;
}

/**
 * Tiến độ của lượt publish — payload NHẸ, dành riêng cho polling.
 *
 * 🔴 Vì sao không dùng lại `GET /pod/flash-sales/:id`: endpoint đó trả về TOÀN BỘ danh sách
 * dòng. Với một đợt 10.000 SKU đó là vài MB cho mỗi lần hỏi — hỏi vài giây một lần trong
 * suốt lượt publish là tự tạo ra một vấn đề lớn hơn vấn đề đang giải.
 */
export class PodFlashSalePublishStatusDto {
  @ApiProperty() flashSaleId!: string;
  @ApiProperty({ enum: PodFlashSaleStatus }) status!: PodFlashSaleStatus;
  @ApiProperty({ nullable: true, type: String }) providerFlashSaleId!: string | null;
  @ApiProperty({ description: 'Còn đang chạy ⇒ giao diện tiếp tục hỏi lại' }) live!: boolean;

  @ApiProperty({ nullable: true, type: Number }) totalItems!: number | null;
  @ApiProperty({ nullable: true, type: Number }) totalBatches!: number | null;
  @ApiProperty({ nullable: true, type: Number }) doneBatches!: number | null;
  @ApiProperty({ nullable: true, type: Number }) currentBatch!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Lô đã thất bại. Khác null ⇒ đợt sale KHÔNG hoàn tất, còn lô chưa gửi.',
  })
  failedBatch!: number | null;

  @ApiProperty({ description: 'Số dòng TikTok đã xác nhận' }) publishedItems!: number;
  @ApiProperty({ description: 'Số dòng còn lại chưa lên sàn' }) pendingItems!: number;

  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorRequestId!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) startedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) finishedAt!: string | null;
}

/**
 * MỘT sản phẩm trong đợt sale, kèm các dòng SKU của nó.
 *
 * 🔴 Đây là ĐƠN VỊ PHÂN TRANG của màn hình Create/Edit Flash Sale. Sản phẩm là thứ người
 * vận hành thêm vào và gỡ ra; SKU chỉ là chi tiết nằm bên trong. Phân trang theo SKU sẽ cắt
 * đôi một sản phẩm giữa hai trang — "Black / S" ở trang 1 còn "Black / M" ở trang 2 — và
 * người dùng mất luôn khả năng nhìn một sản phẩm như một khối.
 */
export class PodFlashSaleProductGroupDto {
  @ApiProperty({ description: '`pod_products.id` — khoá của nhóm' })
  productId!: string;
  @ApiProperty({ nullable: true, type: String }) productTitle!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;

  @ApiProperty({
    type: [PodFlashSaleItemDto],
    description:
      'Mức VARIATION: mọi SKU của sản phẩm. Mức PRODUCT: đúng MỘT dòng (`variantId = null`).',
  })
  items!: PodFlashSaleItemDto[];

  @ApiProperty({ description: 'Số dòng của nhóm — giao diện hiển thị mà không phải đếm lại' })
  itemCount!: number;
}

export class PaginatedPodFlashSaleProductDto {
  @ApiProperty({ type: [PodFlashSaleProductGroupDto] })
  items!: PodFlashSaleProductGroupDto[];
  @ApiProperty({
    description: 'Phân trang theo SẢN PHẨM. `total` là số sản phẩm, KHÔNG phải số SKU.',
  })
  meta!: { total: number; page: number; limit: number; totalPages: number };
  @ApiProperty({ description: 'Tổng số dòng SKU của cả đợt sale (mọi trang)' })
  totalItems!: number;
}
