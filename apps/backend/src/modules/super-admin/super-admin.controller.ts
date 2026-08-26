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
  ApiBadRequestResponse,
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
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  RejectOrganizationDto,
  SuperAdminOrganizationQueryDto,
} from './dto/super-admin-organization.dto';
import { OrganizationReviewService } from './services/organization-review.service';

/**
 * SuperAdminController — quản trị NỀN TẢNG (§5 → §10).
 *
 * 🔴 **Ba lớp bảo vệ, cố ý chồng lên nhau**, vì đây là khu vực duy nhất trong hệ thống nhìn
 * thấy dữ liệu của mọi tổ chức:
 *   1. `JwtAuthGuard`     — phải đăng nhập.
 *   2. `SuperAdminGuard`  — role `SUPER_ADMIN` **và** Organization có `is_platform = true`.
 *   3. `PermissionsGuard` — quyền `platform.*`, vốn bị loại khỏi catalog cấp cho org admin.
 *
 * Bỏ bất kỳ lớp nào cũng vẫn "chạy được"; giữ cả ba là để một sai sót ở một chỗ không tự
 * động thành lỗ hổng xuyên tenant.
 */
@ApiTags('Super Admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Không phải Super Admin (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, SuperAdminGuard, PermissionsGuard)
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly review: OrganizationReviewService) {}

  @Get('dashboard')
  @RequirePermissions('platform.organization.read')
  @ApiOperation({
    summary: 'Super Admin Dashboard — số Organization theo trạng thái',
    description: 'Pending / Approved / Rejected / Total. Không tính Organization hệ thống.',
  })
  dashboard() {
    return this.review.dashboard();
  }

  @Get('organizations')
  @RequirePermissions('platform.organization.read')
  @ApiOperation({
    summary: 'Danh sách Organization đã đăng ký',
    description:
      'Lọc theo trạng thái (Pending / Active / Rejected) và tìm theo tên Organization, ' +
      'tên Owner hoặc email Owner.',
  })
  list(@Query() query: SuperAdminOrganizationQueryDto) {
    return this.review.list(query);
  }

  @Get('organizations/:id')
  @RequirePermissions('platform.organization.read')
  @ApiOperation({ summary: 'Chi tiết Organization + Owner + lịch sử duyệt' })
  @ApiNotFoundResponse({ description: 'PLATFORM_ORGANIZATION_NOT_FOUND' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.get(id);
  }

  @Post('organizations/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('platform.organization.approve')
  @ApiOperation({
    summary: 'Duyệt Organization',
    description:
      'Organization → ACTIVE, mở khoá tài khoản chủ Organization, ghi nhật ký và gửi email ' +
      '"Organization Approved". Chỉ áp dụng cho hồ sơ đang PENDING.',
  })
  @ApiBadRequestResponse({ description: 'PLATFORM_ORGANIZATION_NOT_PENDING' })
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.approve(user, id);
  }

  @Post('organizations/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('platform.organization.approve')
  @ApiOperation({
    summary: 'Từ chối Organization (bắt buộc nhập lý do)',
    description:
      'Organization → REJECTED, lưu lý do, ghi nhật ký và gửi email "Organization ' +
      'Registration Rejected" kèm lý do. Chỉ áp dụng cho hồ sơ đang PENDING.',
  })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR / PLATFORM_ORGANIZATION_NOT_PENDING' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrganizationDto,
  ) {
    return this.review.reject(user, id, dto);
  }
}
