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
