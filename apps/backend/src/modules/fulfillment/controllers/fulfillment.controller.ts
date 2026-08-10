import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { FulfillmentProvider, FulfillmentTrigger } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  CancelFulfillmentDto,
  CreateFulfillmentAccountDto,
  FulfillmentAccountDto,
  FulfillmentErrorDto,
  FulfillmentHistoryDto,
  FulfillmentOrderDto,
  FulfillmentStateDto,
  FulfillmentSyncResultDto,
  ProductMappingDto,
  TriggerFulfillmentSyncDto,
  UpdateFulfillmentAccountDto,
  UpsertProductMappingDto,
} from '../dto/fulfillment.dto';
import { MangoFulfillmentService } from '../mango/services/mango-fulfillment.service';
import { FulfillmentSyncService } from '../services/fulfillment-sync.service';
import { FulfillmentService } from '../services/fulfillment.service';

/**
 * FulfillmentController — API gửi đơn sang xưởng in.
 *
 * Tenant-scoped (organizationId từ JWT — ADR-004) + RBAC `fulfillment.*`.
 *
 * 🔴 Hiện chỉ MangoTeePrints được implement. Tham số `provider` để sẵn cho nhà cung cấp
 * sau này — mặc định MANGOTEE nên client hiện tại không cần truyền.
 */
@ApiTags('Fulfillment')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fulfillment')
export class FulfillmentController {
  constructor(
    private readonly service: FulfillmentService,
    private readonly mangoService: MangoFulfillmentService,
    private readonly syncService: FulfillmentSyncService,
  ) {}

  // ---------------------------------------------------------------------------
  // Cấu hình tài khoản
  // ---------------------------------------------------------------------------

  @Get('accounts')
  @RequirePermissions('fulfillment.config')
  @ApiOperation({ summary: 'Danh sách tài khoản nhà cung cấp fulfillment' })
  @ApiOkResponse({ type: FulfillmentAccountDto, isArray: true })
  listAccounts(@CurrentUser() user: AuthenticatedUser): Promise<FulfillmentAccountDto[]> {
    return this.service.listAccounts(user.organizationId);
  }

  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Thêm tài khoản nhà cung cấp',
    description:
      'API key được mã hoá trước khi lưu và KHÔNG BAO GIỜ trả lại. ' +
      'Response trả kèm `webhookUrl` (chứa secret) — chỉ hiện MỘT LẦN, hãy đăng ký URL này với nhà cung cấp.',
  })
  @ApiOkResponse({ type: FulfillmentAccountDto })
  createAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFulfillmentAccountDto,
  ): Promise<FulfillmentAccountDto> {
    return this.service.createAccount(user.organizationId, user.userId, dto);
  }

  @Patch('accounts/:id')
  @RequirePermissions('fulfillment.config')
  @ApiOperation({ summary: 'Cập nhật tài khoản nhà cung cấp' })
  @ApiOkResponse({ type: FulfillmentAccountDto })
  @ApiNotFoundResponse({ description: 'FULFILLMENT_ACCOUNT_NOT_FOUND' })
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFulfillmentAccountDto,
  ): Promise<FulfillmentAccountDto> {
    return this.service.updateAccount(user.organizationId, user.userId, id, dto);
  }

  // ---------------------------------------------------------------------------
  // Ánh xạ sản phẩm
  // ---------------------------------------------------------------------------

  @Get('mappings')
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Danh sách ánh xạ sản phẩm TikTok ⇄ nhà cung cấp',
    description: 'Thứ tự khớp khi gửi đơn: TikTok SKU ID → Seller SKU → TikTok Product ID.',
  })
  @ApiOkResponse({ type: ProductMappingDto, isArray: true })
  listMappings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('provider') provider?: FulfillmentProvider,
  ): Promise<ProductMappingDto[]> {
    return this.service.listMappings(
      user.organizationId,
      provider ?? FulfillmentProvider.MANGOTEE,
    );
  }

  @Post('mappings')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('fulfillment.config')
  @ApiOperation({ summary: 'Tạo ánh xạ sản phẩm' })
  @ApiOkResponse({ type: ProductMappingDto })
  @ApiConflictResponse({ description: 'FULFILLMENT_MAPPING_CONFLICT' })
  createMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertProductMappingDto,
    @Query('provider') provider?: FulfillmentProvider,
  ): Promise<ProductMappingDto> {
    return this.service.createMapping(
      user.organizationId,
      user.userId,
      provider ?? FulfillmentProvider.MANGOTEE,
      dto,
    );
  }

  @Patch('mappings/:id')
  @RequirePermissions('fulfillment.config')
  @ApiOperation({ summary: 'Cập nhật ánh xạ sản phẩm' })
  @ApiOkResponse({ type: ProductMappingDto })
  @ApiNotFoundResponse({ description: 'FULFILLMENT_MAPPING_NOT_FOUND' })
  updateMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertProductMappingDto,
  ): Promise<ProductMappingDto> {
    return this.service.updateMapping(user.organizationId, user.userId, id, dto);
  }

  @Delete('mappings/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.config')
  @ApiOperation({ summary: 'Xoá ánh xạ sản phẩm' })
  @ApiOkResponse({ description: 'Đã xoá; data = null' })
  deleteMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.deleteMapping(user.organizationId, user.userId, id);
  }

  // ---------------------------------------------------------------------------
  // Fulfillment theo đơn POD
  // ---------------------------------------------------------------------------

  @Get('orders/:podOrderId')
  @RequirePermissions('fulfillment.read')
  @ApiOperation({
    summary: 'Trạng thái fulfillment của một đơn POD',
    description:
      'Trả kèm `ready` + `issues`: đơn chưa gửi được thì `issues` liệt kê CHÍNH XÁC ' +
      'thiếu gì (design, ánh xạ sản phẩm, địa chỉ...). `canFulfill`/`canCancel` để UI bật/tắt nút.',
  })
  @ApiOkResponse({ type: FulfillmentStateDto })
  getState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentStateDto> {
    return this.service.getState(user.organizationId, podOrderId);
  }

  @Post('orders/:podOrderId/fulfill')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Gửi đơn sang xưởng in',
    description:
      'Validate → ánh xạ sản phẩm/biến thể → gắn design (URL trên R2) → gọi API nhà cung cấp. ' +
      'Đơn đã gửi thành công KHÔNG gửi lại được (chặn sản xuất trùng); đơn lỗi thì bấm lại = retry.',
  })
  @ApiOkResponse({ type: FulfillmentOrderDto })
  @ApiUnprocessableEntityResponse({ description: 'FULFILLMENT_NOT_READY — kèm danh sách lý do' })
  @ApiConflictResponse({ description: 'FULFILLMENT_ALREADY_SUBMITTED' })
  @ApiBadRequestResponse({ description: 'FULFILLMENT_PROVIDER_VALIDATION' })
  async fulfill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.mangoService.fulfill(
      user.organizationId,
      user.userId,
      podOrderId,
      FulfillmentTrigger.MANUAL,
    );
    return this.service.toOrderDto(record);
  }

  @Post('orders/:podOrderId/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Gửi lại đơn đã thất bại',
    description:
      'Dùng lại đúng `order_id` cũ nên nếu lần trước thực ra đã tới nơi, nhà cung cấp sẽ báo ' +
      'trùng thay vì tạo đơn thứ hai — không bao giờ sản xuất lặp.',
  })
  @ApiOkResponse({ type: FulfillmentOrderDto })
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.mangoService.fulfill(
      user.organizationId,
      user.userId,
      podOrderId,
      FulfillmentTrigger.RETRY,
    );
    return this.service.toOrderDto(record);
  }

  @Post('orders/:podOrderId/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.read')
  @ApiOperation({ summary: 'Đồng bộ trạng thái đơn từ nhà cung cấp' })
  @ApiOkResponse({ type: FulfillmentOrderDto })
  async syncOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.mangoService.syncByPodOrder(
      user.organizationId,
      user.userId,
      podOrderId,
    );
    return this.service.toOrderDto(record);
  }

  @Post('orders/:podOrderId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.cancel')
  @ApiOperation({
    summary: 'Huỷ đơn ở xưởng in',
    description: 'Nhà cung cấp chỉ cho huỷ khi đơn chưa vào sản xuất (NEW_ORDER hoặc ON_HOLD).',
  })
  @ApiOkResponse({ type: FulfillmentOrderDto })
  @ApiConflictResponse({ description: 'FULFILLMENT_CANNOT_CANCEL' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
    @Body() dto: CancelFulfillmentDto,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.mangoService.cancel(
      user.organizationId,
      user.userId,
      podOrderId,
      dto.reason,
    );
    return this.service.toOrderDto(record);
  }

  @Get('orders/:podOrderId/history')
  @RequirePermissions('fulfillment.read')
  @ApiOperation({
    summary: 'Lịch sử fulfillment (append-only)',
    description: 'Toàn bộ request/response/retry/webhook/chuyển trạng thái — không ghi đè.',
  })
  @ApiOkResponse({ type: FulfillmentHistoryDto, isArray: true })
  listHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentHistoryDto[]> {
    return this.service.listHistory(user.organizationId, podOrderId);
  }

  @Get('orders/:podOrderId/errors')
  @RequirePermissions('fulfillment.read')
  @ApiOperation({ summary: 'Chi tiết lỗi gần đây (HTTP status, code, validation)' })
  @ApiOkResponse({ type: FulfillmentErrorDto, isArray: true })
  listErrors(
    @CurrentUser() user: AuthenticatedUser,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentErrorDto[]> {
    return this.service.listErrors(user.organizationId, podOrderId);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.read')
  @ApiOperation({
    summary: 'Đồng bộ trạng thái toàn bộ đơn đang chạy',
    description: 'Chỉ trong phạm vi tổ chức của người gọi.',
  })
  @ApiOkResponse({ type: FulfillmentSyncResultDto })
  triggerSync(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: TriggerFulfillmentSyncDto,
  ): Promise<FulfillmentSyncResultDto> {
    return this.syncService.runAll(
      FulfillmentTrigger.MANUAL,
      user.organizationId,
      user.userId,
    );
  }
}
