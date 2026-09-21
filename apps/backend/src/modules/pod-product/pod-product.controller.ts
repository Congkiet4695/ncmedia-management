import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  PodProductQueryDto,
  PodProductSyncHistoryQueryDto,
  TriggerProductSyncDto,
} from './dto/pod-product-query.dto';
import {
  PaginatedPodProductResponseDto,
  PaginatedPodProductSyncHistoryDto,
  PodProductDetailDto,
  PodProductSyncResultDto,
} from './dto/pod-product-response.dto';
import { PodScope } from '../pod-tiktok/decorators/pod-scope.decorator';
import { PodScopeGuard } from '../pod-tiktok/guards/pod-scope.guard';
import type { PodAccessScope } from '../pod-tiktok/services/pod-access-scope.service';
import { PodProductEditService } from './services/pod-product-edit.service';
import {
  PodProductLifecycleService,
  type PodProductDeleteResultDto,
} from './services/pod-product-lifecycle.service';
import { PodProductService } from './services/pod-product.service';
import { UpdatePodProductDto } from './dto/pod-product-update.dto';

/**
 * PodProductController — màn hình **POD → Products**.
 *
 * 🔴 Ranh giới hiện tại: ĐỌC + ĐỒNG BỘ + **SỬA** (`PATCH /:id`, `pod.product.update`, Partial
 * Edit Product) + **NGỪNG BÁN** (`POST /:id/deactivate`, `pod.product.deactivate`) + **XOÁ**
 * (`DELETE /:id`, `pod.product.delete`) sản phẩm đã có trên sàn.
 *
 * VẪN KHÔNG có tạo mới ở đây. **Nhân bản sang shop khác** (`POST /:id/clone`) nằm ở
 * `PodProductCloneController` (module Listing) vì nó tạo sản phẩm MỚI qua Bulk Listing Engine.
 *
 * ⚠️ Ghi chú cũ nói module này "chỉ đọc theo cam kết với TikTok App Review". Cam kết đó
 * thuộc về phạm vi scope của app; khả năng GHI đã được dùng từ Sprint Listing (Create /
 * Edit Product). Nếu PRD gửi TikTok chưa phản ánh việc sửa sản phẩm từ màn hình Products,
 * cần cập nhật PRD — xem `TIKTOK_APP_REVIEW_PRD.md`.
 *
 * Tenant-scoped (organizationId từ JWT) + RBAC `pod.product.*`.
 */
@ApiTags('POD - Products')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
// 🔴 `PodScopeGuard` nạp phạm vi shop cho MỌI route trong controller này — kể cả route
// thêm sau này. Xem `PodAccessScopeService`.
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('pod/products')
export class PodProductController {
  constructor(
    private readonly service: PodProductService,
    private readonly editService: PodProductEditService,
    private readonly lifecycle: PodProductLifecycleService,
  ) {}

  @Get()
  @RequirePermissions('pod.product.read')
  @ApiOperation({
    summary: 'Danh sách sản phẩm đã đồng bộ',
    description:
      'Lọc theo TikTok Account, shop, trạng thái, danh mục, thương hiệu. Ô tìm kiếm khớp ' +
      'Tên sản phẩm · TikTok Product ID · Seller SKU.',
  })
  @ApiOkResponse({ type: PaginatedPodProductResponseDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodProductQueryDto,
  ): Promise<PaginatedPodProductResponseDto> {
    return this.service.findAll(user.organizationId, query, scope);
  }

  /** Đặt TRƯỚC `:id` — nếu không, "filters" và "sync-history" bị route `:id` bắt nhầm. */
  @Get('filters')
  @RequirePermissions('pod.product.read')
  @ApiOperation({
    summary: 'Giá trị cho bộ lọc (danh mục / thương hiệu / trạng thái / shop)',
    description: 'Chỉ trả những giá trị ĐANG có sản phẩm — dropdown không bao giờ cho 0 kết quả.',
  })
  findFilters(@CurrentUser() user: AuthenticatedUser, @PodScope() scope: PodAccessScope) {
    return this.service.findFilterOptions(user.organizationId, scope);
  }

  @Get('sync-history')
  @RequirePermissions('pod.product.read')
  @ApiOperation({ summary: 'Lịch sử các lượt đồng bộ sản phẩm' })
  @ApiOkResponse({ type: PaginatedPodProductSyncHistoryDto })
  findSyncHistory(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodProductSyncHistoryQueryDto,
  ): Promise<PaginatedPodProductSyncHistoryDto> {
    return this.service.findSyncHistories(user.organizationId, query, scope);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Đồng bộ sản phẩm từ TikTok (Sync Now)',
    description:
      'Mặc định đồng bộ TĂNG DẦN (chỉ sản phẩm đổi sau lần đồng bộ trước). `full = true` ' +
      'quét lại toàn bộ — tốn quota TikTok, chỉ dùng khi cần đối soát. ' +
      'Danh mục / thương hiệu KHÔNG đồng bộ ở đây — đó là dữ liệu master toàn cục do Super Admin chạy.',
  })
  @ApiOkResponse({ type: PodProductSyncResultDto })
  triggerSync(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Body() dto: TriggerProductSyncDto,
  ): Promise<PodProductSyncResultDto> {
    return this.service.triggerSync(user.organizationId, user.userId, dto, scope);
  }

  @Patch(':id')
  @RequirePermissions('pod.product.update')
  @ApiOperation({
    summary: 'Sửa sản phẩm trên TikTok Shop (Partial Edit)',
    description:
      'Chỉ gửi những trường THỰC SỰ đổi so với dữ liệu đã đồng bộ, qua ' +
      '`POST /product/202309/products/{id}/partial_edit`. ' +
      '🔴 Thứ tự: gọi TikTok TRƯỚC → sàn chấp nhận → đồng bộ lại sản phẩm → mới trả về. ' +
      'Sàn từ chối thì database KHÔNG đổi gì. ' +
      '🔴 KHÔNG đổi được danh mục: TikTok không hỗ trợ sửa `category_id` của sản phẩm đã tạo. ' +
      '🔴 Khoá theo sản phẩm ⇒ bấm Lưu hai lần chỉ chạy một lượt (409 POD_PRODUCT_EDIT_BUSY).',
  })
  @ApiOkResponse({ type: PodProductDetailDto })
  @ApiNotFoundResponse({ description: 'POD_PRODUCT_NOT_FOUND' })
  updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePodProductDto,
  ): Promise<PodProductDetailDto> {
    return this.editService.update(user.organizationId, user.userId, id, dto, scope);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.deactivate')
  @ApiOperation({
    summary: 'Ngừng bán sản phẩm trên TikTok Shop (Deactivate Products)',
    description:
      'Gọi `POST /product/202309/products/deactivate` cho đúng sản phẩm này. ' +
      '🔴 Sàn chấp nhận mới đồng bộ lại sản phẩm và ghi `deactivated_at`; sàn từ chối thì database KHÔNG đổi gì. ' +
      'Phạm vi kiểm theo shop CỦA SẢN PHẨM — Seller chỉ ngừng bán được hàng của shop đã gán. ' +
      'Đảo ngược được bằng Activate trên Seller Center.',
  })
  @ApiOkResponse({ type: PodProductDetailDto })
  @ApiNotFoundResponse({ description: 'POD_PRODUCT_NOT_FOUND' })
  deactivateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodProductDetailDto> {
    return this.lifecycle.deactivate(user.organizationId, user.userId, id, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.delete')
  @ApiOperation({
    summary: 'Xoá sản phẩm khỏi TikTok Shop và xoá mềm khỏi hệ thống',
    description:
      'Gọi `DELETE /product/202309/products` (TikTok giữ sản phẩm đã xoá 30 ngày — Recover Products). ' +
      '🔴 Sàn chấp nhận mới xoá mềm bản ghi (`deleted_at`); Draft Listing / Listing Job / đơn hàng ' +
      'đang tham chiếu sản phẩm được GIỮ NGUYÊN. Sàn từ chối ⇒ database không đổi gì.',
  })
  @ApiNotFoundResponse({ description: 'POD_PRODUCT_NOT_FOUND' })
  deleteProduct(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodProductDeleteResultDto> {
    return this.lifecycle.remove(user.organizationId, user.userId, id, scope);
  }

  @Get('categories')
  @RequirePermissions('pod.product.read')
  @ApiOperation({
    summary: 'Cây danh mục TikTok đã đồng bộ',
    description:
      'Dùng cho màn hình Categories và bộ chọn danh mục của Category Template. ' +
      '`leafOnly=true` chỉ trả danh mục lá (danh mục đăng bán được). ' +
      '`search` khớp tên · đường dẫn · `category_id`. ' +
      '`tiktokCategoryId` tra CHÍNH XÁC một danh mục — dùng khi mở lại template đã lưu.',
  })
  findCategories(
    @Query('search') search?: string,
    @Query('leafOnly') leafOnly?: string,
    @Query('tiktokCategoryId') tiktokCategoryId?: string,
  ) {
    // Không nhận `shopId` và không truyền `organizationId`: cây danh mục là dữ liệu master
    // TOÀN CỤC, mọi tổ chức đọc chung một bảng (xem PodMasterDataModule).
    return this.service.findCategories({
      search,
      leafOnly: leafOnly === 'true',
      tiktokCategoryId,
    });
  }

  @Get('categories/:categoryId/attributes')
  @RequirePermissions('pod.product.read')
  @ApiOperation({
    summary: 'Thuộc tính của một danh mục (đã đồng bộ từ TikTok)',
    description:
      'Category Template render form từ đây — bắt buộc/tuỳ chọn, kiểu, danh sách giá trị hợp lệ. ' +
      'KHÔNG hardcode thuộc tính nào ở frontend. ' +
      '🔴 `categoryId` nhận CẢ HAI: UUID nội bộ hoặc `category_id` của TikTok — template lưu ' +
      'mã TikTok, nên mở ra sửa là nạp được thuộc tính ngay mà không cần tra ngược. ' +
      '🔴 Danh mục chưa có thuộc tính trong kho ⇒ server TỰ hỏi TikTok ngay trong lời gọi này ' +
      'rồi lưu lại (dữ liệu master toàn cục). Người dùng không cần quyền đồng bộ master data.',
  })
  findCategoryAttributes(
    @Param('categoryId') categoryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // `organizationId` chỉ dùng để chọn shop MƯỢN TOKEN khi phải hỏi TikTok — bảng thuộc
    // tính vẫn là dữ liệu toàn cục, không lọc theo tổ chức.
    return this.service.findCategoryAttributes(categoryId, user.organizationId);
  }

  @Get('brands')
  @RequirePermissions('pod.product.read')
  @ApiOperation({
    summary: 'Thương hiệu TikTok đã đồng bộ (có phân trang + tìm kiếm)',
    description:
      'Bộ chọn brand tìm kiếm phía SERVER: TikTok có hàng chục nghìn thương hiệu, ' +
      'tải hết về máy là không tưởng. `keyword` tìm theo tên hoặc `brand_id`. ' +
      'Cỡ trang dùng `limit` (ADR-023); `pageSize` là tên cũ, vẫn nhận để tương thích ngược. ' +
      '🔴 "No brand" luôn đứng đầu danh sách.',
  })
  findBrands(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    // 🔴 `pageSize` là tên CŨ của tham số này — endpoint brands là chỗ duy nhất trong hệ
    // thống lệch khỏi ADR-023 (`page` + `limit`). Nhận cả hai để client cũ / URL đã lưu
    // không gãy; `limit` được ưu tiên.
    @Query('pageSize') pageSize?: string,
  ) {
    const size = limit ?? pageSize;
    return this.service.findBrands({
      keyword,
      page: page ? Number(page) : undefined,
      limit: size ? Number(size) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('pod.product.read')
  @ApiOperation({ summary: 'Chi tiết sản phẩm (biến thể, ảnh, video, thuộc tính)' })
  @ApiOkResponse({ type: PodProductDetailDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy sản phẩm (POD_PRODUCT_NOT_FOUND)' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodProductDetailDto> {
    return this.service.findOne(user.organizationId, id, scope);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Đồng bộ lại MỘT sản phẩm',
    description: 'Gọi Get Product cho đúng sản phẩm này và ghi đè dữ liệu đang lưu.',
  })
  @ApiOkResponse({ type: PodProductDetailDto })
  resyncOne(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodProductDetailDto> {
    return this.service.resyncOne(user.organizationId, user.userId, id, scope);
  }
}
