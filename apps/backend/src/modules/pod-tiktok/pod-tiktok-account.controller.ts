import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { AuthorizeUrlQueryDto, LinkTiktokAccountDto } from './dto/link-account.dto';
import {
  AssignPodSellerDto,
  PodSellerOptionQueryDto,
  PodTiktokAccountQueryDto,
} from './dto/pod-tiktok-query.dto';
import {
  PaginatedPodTiktokAccountResponseDto,
  PodSellerOptionDto,
  PodTiktokAccountResponseDto,
  PodTiktokAuthorizeUrlDto,
} from './dto/pod-tiktok-response.dto';
import { PodTiktokAccountService } from './services/pod-tiktok-account.service';

/**
 * PodTiktokAccountController — Link/quản lý TikTok Shop Account (Module POD, Sprint 1).
 *
 * Tenant-scoped (organizationId lấy từ JWT — ADR-004) + RBAC permission `pod.tiktok.*`.
 * ⚠️ Không endpoint nào trả về access_token / refresh_token / shop_cipher.
 */
@ApiTags('POD - TikTok Accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/tiktok/accounts')
export class PodTiktokAccountController {
  constructor(private readonly service: PodTiktokAccountService) {}

  @Get('authorize-url')
  @RequirePermissions('pod.tiktok.account.create')
  @ApiOperation({
    summary: 'Lấy Authorization URL để Seller uỷ quyền',
    description:
      'Trả về link uỷ quyền theo thị trường (US mặc định). Seller mở link, đăng nhập TikTok, ' +
      'Approve rồi copy tham số `code` trên URL callback để dán vào form Link Account.',
  })
  @ApiOkResponse({ type: PodTiktokAuthorizeUrlDto })
  authorizeUrl(@Query() query: AuthorizeUrlQueryDto): PodTiktokAuthorizeUrlDto {
    return this.service.buildAuthorizeUrl(query.region);
  }

  @Post('link')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.tiktok.account.create')
  @ApiOperation({
    summary: 'Link TikTok Shop Account bằng Authorization Code',
    description:
      'Đổi Authorization Code lấy Access/Refresh Token, sau đó gọi Get Authorized Shops ' +
      'để lấy toàn bộ shop (có thể nhiều shop) và lưu vào hệ thống. ' +
      'Authorization Code chỉ dùng được MỘT LẦN và hết hạn sau 30 phút.',
  })
  @ApiCreatedResponse({ type: PodTiktokAccountResponseDto })
  @ApiBadRequestResponse({ description: 'Authorization Code không hợp lệ / hết hạn / sai loại tài khoản' })
  @ApiConflictResponse({ description: 'Shop hoặc tài khoản Seller đã được liên kết' })
  link(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkTiktokAccountDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<PodTiktokAccountResponseDto> {
    return this.service.link(user.organizationId, user.userId, dto, {
      ipAddress: ip,
      userAgent,
    });
  }

  @Get()
  @RequirePermissions('pod.tiktok.account.read')
  @ApiOperation({ summary: 'Danh sách TikTok Shop Account đã liên kết' })
  @ApiOkResponse({ type: PaginatedPodTiktokAccountResponseDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodTiktokAccountQueryDto,
  ): Promise<PaginatedPodTiktokAccountResponseDto> {
    return this.service.findAll(user.organizationId, query);
  }

  /** Đặt TRƯỚC `:id` — nếu không, "sellers" sẽ bị route `:id` bắt nhầm. */
  @Get('sellers')
  @RequirePermissions('pod.tiktok.account.read')
  @ApiOperation({
    summary: 'Danh sách Seller có thể phân công (đổ vào dropdown)',
    description:
      'Chỉ trả Employee đang ACTIVE và có Role EMPLOYEE trong cùng tổ chức. ' +
      'Admin và Fulfillment KHÔNG xuất hiện vì không phải seller.',
  })
  @ApiOkResponse({ type: PodSellerOptionDto, isArray: true })
  findSellerOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodSellerOptionQueryDto,
  ): Promise<PodSellerOptionDto[]> {
    return this.service.findSellerOptions(user.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('pod.tiktok.account.read')
  @ApiOperation({ summary: 'Chi tiết kết nối TikTok Shop (kèm danh sách shop)' })
  @ApiOkResponse({ type: PodTiktokAccountResponseDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodTiktokAccountResponseDto> {
    return this.service.findOne(user.organizationId, id);
  }

  @Patch(':id/seller')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.account.update')
  @ApiOperation({
    summary: 'Phân công / bỏ phân công Seller phụ trách',
    description:
      '`sellerId` là ID **Employee** (ACTIVE + Role EMPLOYEE, cùng tổ chức). ' +
      'Truyền `sellerId: null` để bỏ phân công. ' +
      'Đây là nguồn duy nhất xác định Seller cho POD Orders, Payout Report và Dashboard — ' +
      'đổi người phụ trách là toàn hệ thống đổi theo ngay, không có dữ liệu lệch.',
  })
  @ApiOkResponse({ type: PodTiktokAccountResponseDto })
  @ApiBadRequestResponse({
    description:
      'Seller không hợp lệ: khác tổ chức, không ACTIVE, hoặc Role không phải EMPLOYEE ' +
      '(POD_TIKTOK_SELLER_INVALID)',
  })
  @ApiNotFoundResponse({ description: 'Không tìm thấy kết nối (POD_TIKTOK_ACCOUNT_NOT_FOUND)' })
  assignSeller(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPodSellerDto,
  ): Promise<PodTiktokAccountResponseDto> {
    return this.service.assignSeller(user.organizationId, user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.account.delete')
  @ApiOperation({
    summary: 'Unlink kết nối TikTok Shop (ngắt kết nối phía NCMedia)',
    description:
      'Xoá mềm kết nối + shop và xoá quyền sử dụng token phía hệ thống. ' +
      'Lưu ý: TikTok KHÔNG có API cho developer thu hồi uỷ quyền — muốn thu hồi hoàn toàn, ' +
      'Seller phải vào Seller Center → App Store → My apps and incidents.',
  })
  @ApiOkResponse({ description: 'Đã ngắt kết nối; data = null' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    return this.service.unlink(user.organizationId, user.userId, id, {
      ipAddress: ip,
      userAgent,
    });
  }
}
