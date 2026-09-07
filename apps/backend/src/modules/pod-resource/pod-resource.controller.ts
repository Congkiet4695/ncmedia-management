import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
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
  SyncResourceDto,
} from './dto/pod-resource.dto';
import { PodResourceSyncService } from './services/pod-resource-sync.service';

/**
 * PodResourceController — **POD → Resources**: tài nguyên TikTok **của tổ chức**.
 *
 * 🔴 Ba endpoint `categories/sync`, `brands/sync`, `attributes/sync` đã bị **GỠ BỎ**. Danh
 * mục / thương hiệu / thuộc tính là dữ liệu master toàn cục, chỉ Super Admin đồng bộ:
 * `POST /pod/master-data/sync` (xem `PodMasterDataController`). Giữ lại bản sao theo tổ
 * chức nghĩa là mỗi Organization vẫn tự ghi đè được dữ liệu dùng chung của mọi tổ chức khác.
 *
 * Còn lại đúng **kho hàng** — thứ thật sự thuộc về từng shop.
 *
 * Quyền: đọc trạng thái và chạy đồng bộ đều dùng `pod.product.sync` — đây là bảng điều
 * khiển của JOB đồng bộ, không phải màn hình duyệt sản phẩm (Seller không có Sync/Refresh).
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
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Trạng thái tài nguyên của tổ chức',
    description:
      'Số bản ghi đang có trong cache (đếm thật), lần đồng bộ gần nhất, thời gian chạy, ' +
      'trạng thái và lỗi cuối cùng. Danh mục / thương hiệu / thuộc tính xem tại ' +
      '`GET /pod/master-data/status` (dữ liệu toàn cục).',
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

  @Post('warehouses/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Đồng bộ kho hàng từ TikTok',
    description: 'Chỉ ĐỌC từ TikTok rồi ghi vào cache. Không gửi gì lên TikTok.',
  })
  @ApiOkResponse({ type: ResourceSyncResultDto })
  syncWarehouses(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncResourceDto) {
    return this.service.syncWarehouses(user.organizationId, user.userId, dto ?? {});
  }
}
