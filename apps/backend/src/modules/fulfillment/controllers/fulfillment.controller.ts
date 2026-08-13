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
  DeleteFulfillmentAccountResultDto,
  PaginatedProductMappingDto,
  ProductMappingQueryDto,
  ProviderCatalogProductDto,
  ProviderCatalogVariationDto,
  TiktokProductOptionDto,
  FulfillmentAccountDto,
  FulfillmentProviderOptionDto,
  FulfillmentErrorDto,
  FulfillmentHistoryDto,
  FulfillmentOrderDto,
  FulfillmentStateDto,
  FulfillmentSyncResultDto,
  ProductMappingDto,
  TriggerFulfillmentSyncDto,
  UpdateFulfillmentAccountDto,
  TestConnectionResultDto,
  UpsertProductMappingDto,
} from '../dto/fulfillment.dto';
import { MangoCatalogService } from '../mango/services/mango-catalog.service';
import { MangoFulfillmentService } from '../mango/services/mango-fulfillment.service';
import { FulfillmentSyncService } from '../services/fulfillment-sync.service';
import { FulfillmentService } from '../services/fulfillment.service';

/**
 * FulfillmentController — API gửi đơn sang xưởng in.
 *
 * Tenant-scoped (organizationId từ JWT — ADR-004) + RBAC `fulfillment.*`.
 *
 * 🔴 Hiện chỉ MangoTeePrints được implement. Tham số `provider` để sẵn cho nhà cung cấp
 * sau này — mặc định MANGO nên client hiện tại không cần truyền.
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
    private readonly catalog: MangoCatalogService,
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

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Xoá nhà cung cấp fulfillment',
    description:
      'Xoá MỀM. Lịch sử đơn đã gửi được giữ nguyên để tra cứu; mọi kết nối TikTok đang trỏ ' +
      'tới nhà cung cấp này bị gỡ liên kết và sẽ cần chọn lại trước khi gửi đơn.',
  })
  @ApiOkResponse({ type: DeleteFulfillmentAccountResultDto })
  deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeleteFulfillmentAccountResultDto> {
    return this.service.deleteAccount(user.organizationId, user.userId, id);
  }

  @Post('accounts/:id/test-connection')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Kiểm tra kết nối tới nhà cung cấp',
    description:
      'Gọi `GET /production-lines` của nhà cung cấp — endpoint chỉ đọc, cần xác thực, không ' +
      'tạo dữ liệu. Thành công ⇒ `connected: true`. Thất bại ⇒ trả NGUYÊN VĂN thông báo lỗi ' +
      'của nhà cung cấp (HTTP vẫn 200 vì đây là kết quả chẩn đoán, không phải lỗi hệ thống).',
  })
  @ApiOkResponse({ type: TestConnectionResultDto })
  async testConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TestConnectionResultDto> {
    const account = await this.service.requireAccountById(user.organizationId, id);
    return this.mangoService.testConnection(account);
  }

  @Get('provider-options')
  @RequirePermissions('fulfillment.read')
  @ApiOperation({
    summary: 'Danh sách nhà cung cấp ACTIVE cho dropdown',
    description:
      'Dùng ở màn hình TikTok Account để chọn nhà cung cấp. Chỉ trả id/tên/loại — ' +
      'KHÔNG có API key dưới bất kỳ hình thức nào.',
  })
  @ApiOkResponse({ type: FulfillmentProviderOptionDto, isArray: true })
  listProviderOptions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FulfillmentProviderOptionDto[]> {
    return this.service.listProviderOptions(user.organizationId);
  }

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
      provider ?? FulfillmentProvider.MANGO,
    );
  }

  @Get('mappings/paged')
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Danh sách ánh xạ có lọc + phân trang',
    description:
      'Lọc theo nhà cung cấp, trạng thái và từ khoá (tìm đồng thời trong tên sản phẩm ' +
      'nhà cung cấp, Seller SKU và Provider SKU). Dùng cho màn hình Product Mapping.',
  })
  @ApiOkResponse({ type: PaginatedProductMappingDto })
  listMappingsPaged(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProductMappingQueryDto,
  ): Promise<PaginatedProductMappingDto> {
    return this.service.listMappingsPaged(user.organizationId, query);
  }

  @Get('mappings/tiktok-products')
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Sản phẩm/SKU TikTok có thể ánh xạ',
    description:
      'Lấy từ các dòng hàng ĐÃ ĐỒNG BỘ về (hệ thống không đồng bộ catalog sản phẩm TikTok). ' +
      'Kèm cờ `mapped` để giao diện làm nổi SKU chưa được ánh xạ.',
  })
  @ApiOkResponse({ type: TiktokProductOptionDto, isArray: true })
  listTiktokProductOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('accountId', ParseUUIDPipe) accountId: string,
    @Query('search') search?: string,
  ): Promise<TiktokProductOptionDto[]> {
    return this.service.listTiktokProductOptions(user.organizationId, accountId, search);
  }

  @Get('accounts/:id/catalog/products')
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Danh mục sản phẩm của nhà cung cấp',
    description:
      'Đọc TRỰC TIẾP từ `GET /products` của nhà cung cấp — không hardcode sản phẩm nào. ' +
      'Kết quả được cache 5 phút theo tài khoản để giảm số lần gọi API.',
  })
  @ApiOkResponse({ type: ProviderCatalogProductDto, isArray: true })
  async listCatalogProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('search') search?: string,
  ): Promise<ProviderCatalogProductDto[]> {
    const account = await this.service.requireAccountById(user.organizationId, id);
    return this.catalog.listProducts(account, search);
  }

  @Get('accounts/:id/catalog/products/:productId/variations')
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Biến thể của một sản phẩm nhà cung cấp',
    description:
      'Đọc TRỰC TIẾP từ `GET /products/{id}/variations`. `sku` trả về chính là giá trị sẽ ' +
      'gửi trong `items[].sku` khi tạo đơn — đây là lý do phải ánh xạ trước khi gửi.',
  })
  @ApiOkResponse({ type: ProviderCatalogVariationDto, isArray: true })
  async listCatalogVariations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId') productId: string,
  ): Promise<ProviderCatalogVariationDto[]> {
    const account = await this.service.requireAccountById(user.organizationId, id);
    return this.catalog.listVariations(account, productId);
  }

  @Post('accounts/:id/catalog/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.config')
  @ApiOperation({ summary: 'Xoá cache danh mục để đọc lại từ nhà cung cấp' })
  @ApiOkResponse({ description: 'Đã xoá cache; data = null' })
  async refreshCatalog(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.requireAccountById(user.organizationId, id);
    await this.catalog.invalidate(id);
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
      provider ?? FulfillmentProvider.MANGO,
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
