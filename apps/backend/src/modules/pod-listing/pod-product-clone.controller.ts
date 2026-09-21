import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import { CloneProductDto } from './dto/pod-product-clone.dto';
import { PodListingJobService } from './services/pod-listing-job.service';

/**
 * PodProductCloneController — **Nhân bản sản phẩm** (Products → chọn 1 sản phẩm → nhiều shop).
 *
 * Đường dẫn nằm dưới `/pod/products/:id` để đúng với màn hình gọi nó, nhưng controller thuộc
 * **module Listing**: nhân bản là TẠO SẢN PHẨM MỚI trên từng shop đích qua Bulk Listing Engine
 * (job / queue / retry / log / Publish History dùng chung). Đặt ở `PodProductModule` là kéo
 * cả engine vào module Product và tạo vòng phụ thuộc — module Product không được biết gì về
 * Listing.
 *
 * Kết quả trả về là một Listing Job (`type = CLONE`); màn hình theo dõi tiến độ từng shop qua
 * `GET /pod/listing-jobs/:id` và `GET /pod/listing-jobs/:id/items` như mọi lượt chạy khác.
 */
@ApiTags('POD - Products')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission hoặc shop ngoài phạm vi (AUTH_FORBIDDEN / POD_SHOP_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('pod/products')
export class PodProductCloneController {
  constructor(private readonly jobs: PodListingJobService) {}

  @Post(':id/clone')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.product.clone')
  @ApiOperation({
    summary: 'Nhân bản MỘT sản phẩm sang NHIỀU shop TikTok',
    description:
      'Tạo lượt chạy `type = CLONE`: mỗi shop đích là một item độc lập (SUCCESS / SKIPPED / FAILED), ' +
      'một shop hỏng không làm hỏng các shop khác. Nội dung (tiêu đề, mô tả, danh mục, thương hiệu, ' +
      'thuộc tính, ảnh, bảng size, video, biến thể/SKU/giá/tồn, kiện hàng) lấy từ sản phẩm nguồn; ' +
      'KHÔNG chép TikTok Product ID / SKU ID / uri ảnh / kho của shop nguồn. Ảnh và ảnh mô tả được ' +
      'upload lại cho shop đích; Create Product `save_mode = LISTING` (chờ TikTok duyệt). ' +
      '🔴 Shop đích phải nằm trong phạm vi của người gọi — một shop lạ ⇒ 403 cả request. ' +
      '🔴 Shop đích đã có sản phẩm này (Seller SKU trùng / đã nhân bản trước) ⇒ SKIPPED, không ghi đè. ' +
      '🔴 Bấm hai lần liên tiếp ⇒ 409 POD_PRODUCT_CLONE_BUSY hoặc item IN_PROGRESS bị bỏ qua.',
  })
  @ApiNotFoundResponse({ description: 'POD_PRODUCT_NOT_FOUND' })
  clone(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloneProductDto,
  ) {
    return this.jobs.createCloneJob(user.organizationId, user.userId, id, dto, scope);
  }
}
