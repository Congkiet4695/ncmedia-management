import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { PodProductService } from './services/pod-product.service';

/**
 * PodProductController — màn hình **POD → Products**.
 *
 * 🔴 Sprint 2 CHỈ ĐỌC + ĐỒNG BỘ. Không có endpoint tạo/sửa/xoá/publish sản phẩm trên
 * TikTok — đó là phạm vi của Sprint sau (Listing), và cũng là điều đã cam kết với
 * TikTok App Review cho tới khi PRD được cập nhật.
 *
 * Tenant-scoped (organizationId từ JWT) + RBAC `pod.product.*`.
 */
@ApiTags('POD - Products')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/products')
export class PodProductController {
  constructor(private readonly service: PodProductService) {}

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
    @Query() query: PodProductQueryDto,
  ): Promise<PaginatedPodProductResponseDto> {
    return this.service.findAll(user.organizationId, query);
  }

  /** Đặt TRƯỚC `:id` — nếu không, "filters" và "sync-history" bị route `:id` bắt nhầm. */
  @Get('filters')
  @RequirePermissions('pod.product.read')
  @ApiOperation({
    summary: 'Giá trị cho bộ lọc (danh mục / thương hiệu / trạng thái / shop)',
    description: 'Chỉ trả những giá trị ĐANG có sản phẩm — dropdown không bao giờ cho 0 kết quả.',
  })
  findFilters(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findFilterOptions(user.organizationId);
  }

  @Get('sync-history')
  @RequirePermissions('pod.product.read')
  @ApiOperation({ summary: 'Lịch sử các lượt đồng bộ sản phẩm' })
  @ApiOkResponse({ type: PaginatedPodProductSyncHistoryDto })
  findSyncHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodProductSyncHistoryQueryDto,
  ): Promise<PaginatedPodProductSyncHistoryDto> {
    return this.service.findSyncHistories(user.organizationId, query);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Đồng bộ sản phẩm từ TikTok (Sync Now)',
    description:
      'Mặc định đồng bộ TĂNG DẦN (chỉ sản phẩm đổi sau lần đồng bộ trước). `full = true` ' +
      'quét lại toàn bộ — tốn quota TikTok, chỉ dùng khi cần đối soát. ' +
      '`includeCatalog = true` đồng bộ luôn cây danh mục + thương hiệu của shop.',
  })
  @ApiOkResponse({ type: PodProductSyncResultDto })
  triggerSync(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TriggerProductSyncDto,
  ): Promise<PodProductSyncResultDto> {
    return this.service.triggerSync(user.organizationId, user.userId, dto);
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
    @CurrentUser() user: AuthenticatedUser,
    @Query('shopId') shopId?: string,
    @Query('search') search?: string,
    @Query('leafOnly') leafOnly?: string,
    @Query('tiktokCategoryId') tiktokCategoryId?: string,
  ) {
    return this.service.findCategories(user.organizationId, {
      shopId,
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
      'mã TikTok, nên mở ra sửa là nạp được thuộc tính ngay mà không cần tra ngược.',
  })
  findCategoryAttributes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId') categoryId: string,
  ) {
    return this.service.findCategoryAttributes(user.organizationId, categoryId);
  }

  @Get('brands')
  @RequirePermissions('pod.product.read')
  @ApiOperation({
    summary: 'Thương hiệu TikTok đã đồng bộ (có phân trang + tìm kiếm)',
    description:
      'Bộ chọn brand tìm kiếm phía SERVER: một shop có thể có hàng chục nghìn thương hiệu, ' +
      'tải hết về máy là không tưởng. `keyword` tìm theo tên hoặc `brand_id`. ' +
      '🔴 "No brand" luôn đứng đầu danh sách.',
  })
  findBrands(
    @CurrentUser() user: AuthenticatedUser,
    @Query('shopId') shopId?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.findBrands(user.organizationId, {
      shopId,
      keyword,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('pod.product.read')
  @ApiOperation({ summary: 'Chi tiết sản phẩm (biến thể, ảnh, video, thuộc tính)' })
  @ApiOkResponse({ type: PodProductDetailDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy sản phẩm (POD_PRODUCT_NOT_FOUND)' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodProductDetailDto> {
    return this.service.findOne(user.organizationId, id);
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
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodProductDetailDto> {
    return this.service.resyncOne(user.organizationId, user.userId, id);
  }
}
