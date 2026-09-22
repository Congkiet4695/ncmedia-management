import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { PodScope } from '../pod-tiktok/decorators/pod-scope.decorator';
import { PodScopeGuard } from '../pod-tiktok/guards/pod-scope.guard';
import type { PodAccessScope } from '../pod-tiktok/services/pod-access-scope.service';
import { PodProductCloneQueryDto } from './dto/pod-product-clone-history.dto';
import { PodProductCloneHistoryService } from './services/pod-product-clone-history.service';

/**
 * PodProductCloneHistoryController — màn hình **Clone Products / Clone History**.
 *
 * ```
 *   GET  /pod/product-clones                     danh sách lượt nhân bản (batch) + tiến độ
 *   GET  /pod/product-clones/:id                 chi tiết: từng shop đích, TikTok id, lỗi
 *   POST /pod/product-clones/:id/retry           chạy lại MỌI shop FAILED của lượt
 *   POST /pod/product-clones/:id/items/:itemId/retry   chạy lại MỘT shop FAILED
 * ```
 *
 * Tạo lượt vẫn là `POST /pod/products/:id/clone` (`PodProductCloneController`). Cùng quyền
 * `pod.product.clone` — ai được nhân bản thì được xem / chạy lại lượt của mình; Seller chỉ thấy
 * lượt do chính mình tạo, Admin (`pod.shop.all`) thấy cả tổ chức.
 */
@ApiTags('POD - Products')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission hoặc shop ngoài phạm vi' })
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('pod/product-clones')
export class PodProductCloneHistoryController {
  constructor(private readonly history: PodProductCloneHistoryService) {}

  @Get()
  @RequirePermissions('pod.product.clone')
  @ApiOperation({
    summary: 'Danh sách lượt nhân bản sản phẩm (Clone Products)',
    description:
      'Mỗi dòng là một lượt (1 sản phẩm nguồn → N shop đích) kèm trạng thái tổng ' +
      '(PENDING / PROCESSING / SUCCESS / PARTIAL / FAILED), tiến độ và kết quả từng shop. ' +
      'Seller chỉ thấy lượt của mình; Admin thấy toàn bộ và lọc được theo người tạo.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodProductCloneQueryDto,
  ) {
    return this.history.list(user.organizationId, user.userId, query, scope);
  }

  @Get(':id')
  @RequirePermissions('pod.product.clone')
  @ApiOperation({ summary: 'Chi tiết lượt nhân bản: từng shop đích, TikTok Product/Draft ID, lỗi' })
  @ApiNotFoundResponse({ description: 'POD_PRODUCT_CLONE_NOT_FOUND' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.history.get(user.organizationId, user.userId, id, scope);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.clone')
  @ApiOperation({
    summary: 'Chạy lại các shop FAILED của lượt',
    description: 'CHỈ shop FAILED. Shop SUCCESS / SKIPPED không bị chạy lại (không tạo sản phẩm trùng).',
  })
  retryFailed(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.history.retryFailed(user.organizationId, user.userId, id, scope);
  }

  @Post(':id/items/:itemId/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.clone')
  @ApiOperation({ summary: 'Chạy lại MỘT shop FAILED của lượt' })
  retryItem(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.history.retryFailed(user.organizationId, user.userId, id, scope, itemId);
  }
}
