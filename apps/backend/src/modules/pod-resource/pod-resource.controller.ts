import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
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
  ResourceLogQueryDto,
  ResourceSyncResultDto,
  SyncAttributesDto,
  SyncResourceDto,
} from './dto/pod-resource.dto';
import { PodResourceSyncService } from './services/pod-resource-sync.service';

/**
 * PodResourceController — **POD → Resources**: kéo dữ liệu dùng chung của TikTok về cache.
 *
 * Đây là **cửa duy nhất** để cache Category / Brand / Attribute / Warehouse thay đổi.
 * Mọi màn hình khác (Categories, Brands, Warehouses, Template) chỉ ĐỌC những bảng này —
 * không màn hình nào gọi TikTok khi mở dropdown.
 *
 * Quyền: đọc trạng thái dùng `pod.product.read`, chạy đồng bộ dùng `pod.product.sync` —
 * đúng bộ quyền đã có cho việc kéo dữ liệu từ TikTok, không sinh thêm permission mới.
 */
@ApiTags('POD - Resources')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/resources')
export class PodResourceController {
  constructor(private readonly service: PodResourceSyncService) {}

  @Get('status')
  // 🔴 `pod.product.sync` chứ không phải `pod.product.read`: đây là bảng điều khiển của JOB
  // đồng bộ danh mục (§2 — Seller không có Sync/Refresh), không phải màn hình duyệt sản phẩm.
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Trạng thái mọi tài nguyên',
    description:
      'Số bản ghi đang có trong cache (đếm thật), lần đồng bộ gần nhất, thời gian chạy, ' +
      'trạng thái và lỗi cuối cùng. `ready = false` nghĩa là phải sync tài nguyên phụ thuộc trước.',
  })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.service.status(user.organizationId);
  }

  @Get('logs')
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Nhật ký đồng bộ',
    description: 'Lọc theo tài nguyên hoặc theo `jobId` để xem đúng một lượt chạy.',
  })
  logs(@CurrentUser() user: AuthenticatedUser, @Query() query: ResourceLogQueryDto) {
    return this.service.logs(user.organizationId, query);
  }

  @Post('categories/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Đồng bộ cây danh mục từ TikTok',
    description: 'Chỉ ĐỌC từ TikTok rồi ghi vào cache. Không gửi gì lên TikTok.',
  })
  @ApiOkResponse({ type: ResourceSyncResultDto })
  syncCategories(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncResourceDto) {
    return this.service.syncCategories(user.organizationId, user.userId, dto ?? {});
  }

  @Post('brands/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({ summary: 'Đồng bộ thương hiệu từ TikTok' })
  @ApiOkResponse({ type: ResourceSyncResultDto })
  syncBrands(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncResourceDto) {
    return this.service.syncBrands(user.organizationId, user.userId, dto ?? {});
  }

  @Post('warehouses/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({ summary: 'Đồng bộ kho hàng từ TikTok' })
  @ApiOkResponse({ type: ResourceSyncResultDto })
  syncWarehouses(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncResourceDto) {
    return this.service.syncWarehouses(user.organizationId, user.userId, dto ?? {});
  }

  @Post('attributes/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Đồng bộ định nghĩa thuộc tính theo danh mục',
    description:
      'Bỏ trống `categoryIds` = lấy cho các danh mục lá đang có sản phẩm. Truyền `categoryIds` ' +
      'khi cần thuộc tính của đúng danh mục vừa chọn trong Category Template.',
  })
  @ApiOkResponse({ type: ResourceSyncResultDto })
  syncAttributes(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncAttributesDto) {
    return this.service.syncAttributes(user.organizationId, user.userId, dto ?? {});
  }
}
