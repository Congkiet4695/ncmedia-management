import {
  Body,
  Controller,
  Delete,
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
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PodListingJobItemStatus, PodListingJobType } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  CreateListingJobDto,
  CreatePublishJobDto,
  PodListingJobItemQueryDto,
  PodListingJobQueryDto,
  PodListingLogQueryDto,
  RetryListingJobDto,
} from './dto/pod-listing-job.dto';
import { PodListingJobService } from './services/pod-listing-job.service';
import { PodListingReviewService } from './services/pod-listing-review.service';

/**
 * PodListingJobController — Bulk Listing Engine (tạo Draft) **và** Publish Engine (gửi duyệt).
 *
 * Hai lối vào, một cỗ máy:
 * ```
 *   POST /pod/listing-jobs          → type = CREATE_DRAFT  → Create Product (AS_DRAFT)
 *   POST /pod/listing-jobs/publish  → type = PUBLISH       → Edit Product  (LISTING)
 * ```
 *
 * 🔴 Hai quyền TÁCH RIÊNG: `pod.listing.run` chỉ tạo Draft (không ảnh hưởng shop thật),
 * `pod.listing.publish` mới được đưa hàng lên sàn. Gộp chung là để một người chỉ được giao
 * việc dựng listing vô tình đẩy cả lô ra chợ.
 *
 * Tiến độ, log, retry, huỷ dùng CHUNG endpoint cho cả hai loại lượt chạy.
 */
@ApiTags('POD - Bulk Listing')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/listing-jobs')
export class PodListingJobController {
  constructor(
    private readonly jobs: PodListingJobService,
    private readonly review: PodListingReviewService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.listing.run')
  @ApiOperation({
    summary: 'Tạo lượt Bulk Listing (Products × Shops × Template)',
    description:
      'Tạo job + item rồi CHẠY NGAY ở nền: mỗi item đi qua Merge → Validate → Upload Images → ' +
      'Create Product (AS_DRAFT). Trả về job để màn hình theo dõi tiến độ.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateListingJobDto) {
    return this.jobs.create(user.organizationId, user.userId, dto);
  }

  @Get()
  @RequirePermissions('pod.listing.read')
  @ApiOperation({ summary: 'Danh sách lượt chạy' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PodListingJobQueryDto) {
    return this.jobs.list(user.organizationId, query);
  }

  @Post('publish')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.listing.publish')
  @ApiOperation({
    summary: 'Publish Draft lên TikTok (Publish Selected / Publish All)',
    description:
      'Đưa Draft ĐÃ CÓ vào hàng chờ duyệt bằng Edit Product (`save_mode = LISTING`). ' +
      'KHÔNG gọi Create Product cho Draft đã tồn tại trên sàn ⇒ không sinh sản phẩm trùng. ' +
      'Chạy nền với concurrency 5 và retry 3 lần; trả về job để màn hình theo dõi tiến độ, ' +
      'kèm `skipped` là các Draft bị bỏ qua và lý do.',
  })
  publish(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePublishJobDto) {
    return this.jobs.createPublishJob(user.organizationId, user.userId, dto ?? {});
  }

  @Post('review-sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.listing.publish')
  @ApiOperation({
    summary: 'Đọc lại trạng thái duyệt ngay (không đợi scheduler 5 phút)',
    description:
      'Lời gọi CHỈ ĐỌC (Get Product) cho các listing đã publish của tổ chức hiện tại. ' +
      'Không sửa gì trên shop.',
  })
  reviewSync(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { draftIds?: string[]; limit?: number },
  ) {
    return this.review.sync({
      organizationId: user.organizationId,
      draftIds: body?.draftIds,
      limit: body?.limit,
    });
  }

  @Get('review-summary')
  @RequirePermissions('pod.listing.read')
  @ApiOperation({ summary: 'Đếm listing theo trạng thái duyệt (thẻ tổng quan Draft Listing)' })
  reviewSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.review.summary(user.organizationId);
  }

  @Get('history')
  @RequirePermissions('pod.listing.read')
  @ApiOperation({
    summary: 'Publish History — lịch sử từng listing đã đẩy lên TikTok',
    description: 'Mỗi dòng là một lần thử thật: kết quả, thời lượng, mã lỗi, remote product id.',
  })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: PodListingJobItemStatus,
    @Query('shopId') shopId?: string,
    @Query('type') type?: PodListingJobType,
  ) {
    return this.jobs.history(user.organizationId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
      shopId,
      type,
    });
  }

  @Get(':id')
  @RequirePermissions('pod.listing.read')
  @ApiOperation({ summary: 'Chi tiết lượt chạy + số item theo trạng thái (thanh tiến độ)' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.get(user.organizationId, id);
  }

  @Get(':id/items')
  @RequirePermissions('pod.listing.read')
  @ApiOperation({ summary: 'Danh sách sản phẩm trong lượt chạy (Job Detail)' })
  listItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PodListingJobItemQueryDto,
  ) {
    return this.jobs.listItems(user.organizationId, id, query);
  }

  @Get(':id/logs')
  @RequirePermissions('pod.listing.read')
  @ApiOperation({ summary: 'Nhật ký của lượt chạy (lọc theo item để xem log riêng từng sản phẩm)' })
  listLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PodListingLogQueryDto,
  ) {
    return this.jobs.listLogs(user.organizationId, id, query);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.listing.run')
  @ApiOperation({
    summary: 'Chạy lại phần thất bại',
    description: 'Mặc định chạy lại mọi item FAILED / SKIPPED / CANCELLED của lượt.',
  })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetryListingJobDto,
  ) {
    return this.jobs.retry(user.organizationId, user.userId, id, dto ?? {});
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.listing.run')
  @ApiOperation({
    summary: 'Huỷ lượt chạy',
    description:
      'Item chưa chạy chuyển CANCELLED. Item đang gửi TikTok vẫn chạy nốt — không có cách nào ' +
      'thu hồi một request đã đi.',
  })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.cancel(user.organizationId, user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.listing.run')
  @ApiOperation({ summary: 'Xoá lượt chạy (xoá mềm — không đụng sản phẩm đã tạo trên TikTok)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.remove(user.organizationId, user.userId, id);
  }
}
