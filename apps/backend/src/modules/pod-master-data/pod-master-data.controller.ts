import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  MasterDataLogQueryDto,
  MasterDataStatusDto,
  MasterDataSyncResultDto,
  SyncMasterDataDto,
} from './dto/pod-master-data.dto';
import { PodMasterDataSyncService } from './services/pod-master-data-sync.service';

/**
 * PodMasterDataController — **TikTok Master Data TOÀN CỤC**.
 *
 * 🔴 Ranh giới quyền của module này là điểm mấu chốt của sprint, và nó KHÔNG đối xứng:
 *
 *   - `GET  /pod/master-data/status` → `pod.product.read` **HOẶC** `platform.masterdata.read`.
 *     Admin tổ chức cần nhìn thấy hệ thống đang có bao nhiêu danh mục và đồng bộ lần cuối
 *     lúc nào; giấu đi chỉ khiến họ tưởng dữ liệu trống và đi tìm nút Sync không còn tồn tại.
 *     Super Admin đọc bằng quyền `platform.*` của mình — xem ghi chú tại chính route đó.
 *   - `POST /pod/master-data/sync`   → **chỉ Super Admin nền tảng**. Dữ liệu này dùng chung
 *     cho MỌI tổ chức, nên một Admin tổ chức bấm Sync là ghi đè dữ liệu của tất cả những
 *     người còn lại.
 *
 * Hai lớp guard cho đường ghi, đúng khuôn của `SuperAdminController`: `SuperAdminGuard`
 * chốt "đúng người" (role SUPER_ADMIN **và** Organization `is_platform`), còn
 * `@RequirePermissions('platform.masterdata.sync')` chốt "đúng việc". Quyền `platform.*`
 * bị loại khỏi catalog cấp cho org admin nên không tổ chức nào tự cấp được cho mình.
 */
@ApiTags('POD - Master Data')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@Controller('pod/master-data')
export class PodMasterDataController {
  constructor(private readonly service: PodMasterDataSyncService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  // 🔴 HOẶC, không phải VÀ. Hai loại người dùng khác hẳn nhau cùng phải xem được màn hình
  // này và họ KHÔNG chung quyền nào: Admin tổ chức đọc bằng `pod.product.read`, còn Super
  // Admin nền tảng — người duy nhất chạy được đồng bộ — không thuộc tổ chức nghiệp vụ nào
  // nên không có quyền `pod.*`. Cấp thêm `pod.product.read` cho Super Admin sẽ làm nhoè
  // đúng ranh giới nền tảng / tổ chức mà `SuperAdminGuard` dựng lên.
  @RequireAnyPermission('pod.product.read', 'platform.masterdata.read')
  @ApiOperation({
    summary: 'Trạng thái TikTok Master Data toàn cục',
    description:
      'Số bản ghi đang có (đếm thật), lần đồng bộ thành công gần nhất, trạng thái và lỗi cuối. ' +
      '`canSync` cho biết người gọi có được chạy đồng bộ hay không — giao diện ẩn nút Sync theo cờ này.',
  })
  @ApiOkResponse({ type: MasterDataStatusDto })
  status(@CurrentUser() user: AuthenticatedUser): Promise<MasterDataStatusDto> {
    // `canSync` suy ra từ permission đã nằm sẵn trong request — không hardcode tên role
    // (Role là động, ADR-009).
    return this.service.status(user.permissions?.includes('platform.masterdata.sync') ?? false);
  }

  @Get('logs')
  @UseGuards(JwtAuthGuard, SuperAdminGuard, PermissionsGuard)
  @RequirePermissions('platform.masterdata.read')
  @ApiOperation({
    summary: 'Nhật ký đồng bộ Master Data (Super Admin)',
    description: 'Lọc theo tài nguyên hoặc theo `jobId` để xem đúng một lượt chạy.',
  })
  logs(@Query() query: MasterDataLogQueryDto) {
    return this.service.logs(query);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, SuperAdminGuard, PermissionsGuard)
  @RequirePermissions('platform.masterdata.sync')
  @ApiOperation({
    summary: 'Đồng bộ TikTok Master Data toàn cục (CHỈ Super Admin)',
    description:
      'Chạy CATEGORY → BRAND → CATEGORY_ATTRIBUTE vào bộ dữ liệu dùng chung cho mọi Organization. ' +
      'Idempotent (upsert theo id TikTok) và chỉ một lượt được chạy tại một thời điểm. ' +
      'Lượt hỏng KHÔNG xoá dữ liệu đang có.',
  })
  @ApiOkResponse({ type: MasterDataSyncResultDto })
  @ApiConflictResponse({
    description: 'Đang có lượt đồng bộ khác chạy (POD_MASTER_DATA_SYNC_IN_PROGRESS)',
  })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SyncMasterDataDto,
  ): Promise<MasterDataSyncResultDto> {
    // Controller chỉ điều hướng — không chứa business logic (CLAUDE.md Mục 8).
    return this.service.sync(user.userId, dto ?? {});
  }
}
