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
import { StartTiktokAuthorizationDto } from './dto/tiktok-oauth.dto';
import {
  AssignFulfillmentProviderDto,
  AssignPodSellerDto,
  PodSellerOptionQueryDto,
  SetShopWarehouseDto,
  PodTiktokAccountQueryDto,
} from './dto/pod-tiktok-query.dto';
import {
  PaginatedPodTiktokAccountResponseDto,
  PodSellerOptionDto,
  PodTiktokAccountResponseDto,
  PodTiktokAuthorizeUrlDto,
} from './dto/pod-tiktok-response.dto';
import { PodTiktokAccountService } from './services/pod-tiktok-account.service';
import { PodTiktokOAuthService } from './services/pod-tiktok-oauth.service';

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
  constructor(
    private readonly service: PodTiktokAccountService,
    private readonly oauthService: PodTiktokOAuthService,
  ) {}

  @Post('authorize-url')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.tiktok.account.create')
  @ApiOperation({
    summary: 'Tạo Authorization URL cho một phiên uỷ quyền TikTok',
    description:
      'Nhận `accountName` (tên kết nối), sinh `state` một lần (lưu server-side kèm tên đó, có ' +
      'hạn) và trả về Authorization URL đầy đủ để người dùng copy. Sau khi Seller Approve, ' +
      'TikTok gọi callback và hệ thống TỰ ĐỘNG đổi token, lấy shop, lưu kết nối với đúng tên ' +
      'đã nhập — người dùng KHÔNG phải copy hay dán Authorization Code.',
  })
  @ApiCreatedResponse({ type: PodTiktokAuthorizeUrlDto })
  @ApiBadRequestResponse({ description: 'Thiếu hoặc sai Account Name' })
  startAuthorization(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartTiktokAuthorizationDto,
  ): Promise<PodTiktokAuthorizeUrlDto> {
    return this.oauthService.startAuthorization(
      user.organizationId,
      user.userId,
      dto.accountName,
      dto.region,
    );
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

  @Patch(':id/fulfillment-provider')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.account.update')
  @ApiOperation({
    summary: 'Gán / bỏ gán nhà cung cấp fulfillment',
    description:
      'Mọi đơn của kết nối này sẽ được gửi tới nhà cung cấp đã chọn. ' +
      'Truyền `fulfillmentAccountId: null` để bỏ gán — khi đó kết nối KHÔNG gửi đơn sản xuất ' +
      'được cho tới khi gán lại. Chỉ chấp nhận nhà cung cấp cùng tổ chức và đang ACTIVE.',
  })
  @ApiOkResponse({ type: PodTiktokAccountResponseDto })
  @ApiBadRequestResponse({
    description: 'Nhà cung cấp không hợp lệ (POD_TIKTOK_FULFILLMENT_PROVIDER_INVALID)',
  })
  @ApiNotFoundResponse({ description: 'Không tìm thấy kết nối (POD_TIKTOK_ACCOUNT_NOT_FOUND)' })
  assignFulfillmentProvider(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignFulfillmentProviderDto,
  ): Promise<PodTiktokAccountResponseDto> {
    return this.service.assignFulfillmentAccount(user.organizationId, user.userId, id, dto);
  }

  @Patch(':id/shops/:shopId/warehouse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.account.update')
  @ApiOperation({
    summary: 'Đặt kho mặc định cho MỘT shop (Warehouse Mapping)',
    description:
      '🔴 Kho là dữ liệu CỦA SHOP, không phải của sản phẩm: cùng một Draft Product đăng lên ' +
      'ba shop là ba kho khác nhau. Draft không gắn kho và cổng validate cũng không đòi kho; ' +
      'kho chỉ được quyết lúc Publish. Truyền `warehouseId: null` để bỏ cấu hình — khi đó hệ ' +
      'thống tự suy (kho của Category Template nếu thuộc shop này → shop chỉ có một kho → ' +
      'kho TikTok đánh dấu mặc định).',
  })
  @ApiOkResponse({ type: PodTiktokAccountResponseDto })
  @ApiBadRequestResponse({ description: 'Kho không thuộc shop này (POD_TIKTOK_WAREHOUSE_INVALID)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy kết nối hoặc shop (POD_TIKTOK_ACCOUNT_NOT_FOUND)' })
  setShopWarehouse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: SetShopWarehouseDto,
  ): Promise<PodTiktokAccountResponseDto> {
    return this.service.setShopWarehouse(user.organizationId, user.userId, id, shopId, dto);
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
