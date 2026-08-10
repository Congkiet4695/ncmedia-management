import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ADMIN_ROLE_CODE } from '../auth/constants/default-roles';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  PaginatedPodPayoutAccountDto,
  PaginatedPodPayoutSellerDto,
  PodPayoutBreakdownQueryDto,
  PodPayoutFilterDto,
  PodPayoutSummaryDto,
  PodPayoutSyncResultDto,
  TriggerPayoutSyncDto,
} from './dto/pod-payout.dto';
import { PodPayoutService } from './services/pod-payout.service';

/**
 * PodPayoutController — Báo cáo Payout TikTok (chỉ THỐNG KÊ, không sửa dữ liệu tài chính).
 *
 * Nguồn số liệu: Finance API của TikTok (Get Payments / Get Statements /
 * Get Transactions by Statement) đã được đồng bộ về DB. Xem docs/pod-tiktok/10-payout-report.md.
 *
 * Phân quyền hai lớp:
 *  1. RBAC — `pod.tiktok.payout.read` (xem) / `pod.tiktok.payout.sync` (đồng bộ thủ công).
 *  2. Row-level — Admin thấy toàn Organization; người khác chỉ thấy Account mình quản lý
 *     (`pod_tiktok_accounts.seller_id` → Employee của chính họ).
 *
 * Ba endpoint dùng CHUNG một bộ lọc: datePreset/fromDate/toDate, payoutStatus, search.
 */
@ApiTags('POD - TikTok Payout')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/tiktok/payout')
export class PodPayoutController {
  constructor(private readonly service: PodPayoutService) {}

  /**
   * Phạm vi dữ liệu theo hàng.
   * Admin ⇒ `undefined` (toàn Organization). Còn lại ⇒ chỉ account do chính họ quản lý.
   * Cùng quy ước với `AccountController.scope` để hành vi nhất quán toàn hệ thống.
   */
  private scope(user: AuthenticatedUser): string | undefined {
    return user.role === ADMIN_ROLE_CODE ? undefined : user.userId;
  }

  @Get('summary')
  @RequirePermissions('pod.tiktok.payout.read')
  @ApiOperation({
    summary: 'Report Card — tổng Payout của toàn bộ Account trong khoảng lọc',
    description:
      'Payout = SUM(số tiền TikTok thực chi, `payments.amount`). Lọc theo thời điểm khởi tạo ' +
      'chi trả. Trả kèm `currencies`: nhiều hơn một đơn vị tiền tệ thì tổng KHÔNG có ý nghĩa ' +
      'tài chính và FE phải cảnh báo.',
  })
  @ApiOkResponse({ type: PodPayoutSummaryDto })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodPayoutFilterDto,
  ): Promise<PodPayoutSummaryDto> {
    return this.service.summary(user.organizationId, query, this.scope(user));
  }

  @Get('sellers')
  @RequirePermissions('pod.tiktok.payout.read')
  @ApiOperation({
    summary: 'Thống kê Payout theo Seller',
    description:
      'Gom theo `pod_tiktok_accounts.seller_id` (Employee phụ trách). Account chưa phân công ' +
      'gom vào một nhóm riêng (`sellerId = null`). Mặc định sắp xếp giảm dần theo Payout.',
  })
  @ApiOkResponse({ type: PaginatedPodPayoutSellerDto })
  sellers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodPayoutBreakdownQueryDto,
  ): Promise<PaginatedPodPayoutSellerDto> {
    return this.service.sellerBreakdown(user.organizationId, query, this.scope(user));
  }

  @Get('accounts')
  @RequirePermissions('pod.tiktok.payout.read')
  @ApiOperation({
    summary: 'Thống kê Payout theo Account',
    description: 'Mặc định sắp xếp giảm dần theo Payout. Hỗ trợ search theo Account/Seller.',
  })
  @ApiOkResponse({ type: PaginatedPodPayoutAccountDto })
  accounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodPayoutBreakdownQueryDto,
  ): Promise<PaginatedPodPayoutAccountDto> {
    return this.service.accountBreakdown(user.organizationId, query, this.scope(user));
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.payout.sync')
  @ApiOperation({
    summary: 'Đồng bộ dữ liệu Payout từ TikTok Finance API',
    description:
      'Kéo Payments → Statements → Transactions cấp đơn. `full=true` để lấy lại toàn bộ lịch sử. ' +
      'An toàn khi chạy lại: ghi idempotent theo ID của TikTok, không tạo bản ghi trùng.',
  })
  @ApiOkResponse({ type: PodPayoutSyncResultDto })
  triggerSync(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TriggerPayoutSyncDto,
  ): Promise<PodPayoutSyncResultDto> {
    return this.service.triggerSync(user.organizationId, dto);
  }
}
