import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { FulfillmentProvider, FulfillmentTrigger, PodDesignPlacement } from '@prisma/client';
import { PodDesignDto } from '../../pod-tiktok/dto/pod-design.dto';
import { ProductDesignService } from '../services/product-design.service';
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
  ProductDesignKeyDto,
  CatalogueDto,
  CatalogProductQueryDto,
  CatalogStatusDto,
  CatalogSyncResultDto,
  AutoMapResultDto,
  PaginatedCatalogProductDto,
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
import { FulfillmentCatalogQueryService } from '../services/fulfillment-catalog-query.service';
import { FulfillmentCatalogSyncService } from '../services/fulfillment-catalog-sync.service';
import { ProductMappingAutoService } from '../services/product-mapping-auto.service';
import { MangoFulfillmentService } from '../mango/services/mango-fulfillment.service';
import { FulfillmentSyncService } from '../services/fulfillment-sync.service';
import { PodScope } from '../../pod-tiktok/decorators/pod-scope.decorator';
import { PodScopeGuard } from '../../pod-tiktok/guards/pod-scope.guard';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
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
// 🔴 `PodScopeGuard` nạp phạm vi shop: Seller chỉ đụng được đơn của shop được gán.
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('fulfillment')
export class FulfillmentController {
  constructor(
    private readonly service: FulfillmentService,
    private readonly mangoService: MangoFulfillmentService,
    private readonly syncService: FulfillmentSyncService,
    private readonly catalogQuery: FulfillmentCatalogQueryService,
    private readonly catalogSync: FulfillmentCatalogSyncService,
    private readonly autoMap: ProductMappingAutoService,
    private readonly productDesigns: ProductDesignService,
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
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({
    summary: 'Danh sách ánh xạ sản phẩm TikTok ⇄ nhà cung cấp',
    description:
      'Ánh xạ được xác định bởi cặp khoá **Product ID + Seller SKU**. Không dùng Title, ' +
      'Variant Name, Image hay TikTok SKU ID để ghép.',
  })
  @ApiOkResponse({ type: ProductMappingDto, isArray: true })
  listMappings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('provider') provider?: FulfillmentProvider,
  ): Promise<ProductMappingDto[]> {
    return this.service.listMappings(user.organizationId, provider ?? FulfillmentProvider.MANGO);
  }

  @Get('mappings/paged')
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({
    summary: 'Danh sách ánh xạ có lọc + phân trang',
    description:
      'Dùng cho màn hình Product Mapping. Trả kèm **Design và tình trạng design** của từng ' +
      'sản phẩm (một truy vấn cho cả trang, không N+1). Lọc theo nhà cung cấp, trạng thái, ' +
      'tình trạng design và từ khoá (tìm đồng thời trong Product ID, Seller SKU, ' +
      'Fulfillment SKU và tên sản phẩm nhà cung cấp).\n\n' +
      '⚠️ `meta.total` là tổng TRƯỚC khi lọc `designStatus`, nên trang cuối có thể ngắn hơn ' +
      '`limit` khi dùng bộ lọc đó.',
  })
  @ApiOkResponse({ type: PaginatedProductMappingDto })
  listMappingsPaged(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProductMappingQueryDto,
  ): Promise<PaginatedProductMappingDto> {
    return this.service.listMappingsPaged(user.organizationId, query);
  }

  @Get('mappings/tiktok-products')
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({
    summary: 'Sản phẩm/SKU TikTok có thể ánh xạ',
    description:
      'Lấy từ các dòng hàng ĐÃ ĐỒNG BỘ về (hệ thống không đồng bộ catalog sản phẩm TikTok). ' +
      'Gom theo cặp khoá (Product ID + Seller SKU) — mỗi sản phẩm xuất hiện đúng một lần. ' +
      'Dòng hàng thiếu một trong hai khoá không thể ánh xạ nên bị loại. Cờ `mapped` được đo ' +
      'bằng ĐÚNG cặp khoá đó, để không có cảnh "đã ánh xạ" mà đơn vẫn báo thiếu ánh xạ.',
  })
  @ApiOkResponse({ type: TiktokProductOptionDto, isArray: true })
  listTiktokProductOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('accountId', ParseUUIDPipe) accountId: string,
    @Query('search') search?: string,
  ): Promise<TiktokProductOptionDto[]> {
    return this.service.listTiktokProductOptions(user.organizationId, accountId, search);
  }

  // ---------------------------------------------------------------------------
  // Danh mục nhà cung cấp — ĐỌC TỪ DATABASE
  //
  // 🔴 Ba endpoint dưới đây KHÔNG gọi nhà cung cấp. Chúng đọc bản sao mà
  // `FulfillmentCatalogSyncService` ghi xuống. Trước đây mỗi lần mở màn hình ánh xạ là một
  // loạt lời gọi thẳng sang Mango: chậm, phụ thuộc mạng, và hỏng hoàn toàn khi nhà cung cấp
  // lỗi. Muốn dữ liệu mới thì gọi endpoint đồng bộ bên dưới.
  // ---------------------------------------------------------------------------

  @Get('accounts/:id/catalog/catalogues')
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({
    summary: 'Danh mục (nhóm sản phẩm) của nhà cung cấp',
    description:
      'Đọc từ Database. `lastSyncedAt` cho biết dữ liệu cũ tới đâu — NULL nghĩa là tài ' +
      'khoản này chưa đồng bộ danh mục lần nào.',
  })
  @ApiOkResponse({ type: CatalogueDto, isArray: true })
  listCatalogues(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogueDto[]> {
    return this.catalogQuery.listCatalogues(user.organizationId, id);
  }

  @Get('accounts/:id/catalog/products')
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({
    summary: 'Sản phẩm trong danh mục nhà cung cấp',
    description:
      'Đọc từ Database, có tìm kiếm và PHÂN TRANG phía server. `id` trả về là khoá NỘI BỘ ' +
      '(uuid) — dùng chính nó để lấy biến thể; `externalProductId` mới là id phía nhà cung cấp.',
  })
  @ApiOkResponse({ type: PaginatedCatalogProductDto })
  listCatalogProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CatalogProductQueryDto,
  ): Promise<PaginatedCatalogProductDto> {
    return this.catalogQuery.listProducts(user.organizationId, id, {
      catalogueId: query.catalogueId,
      search: query.search,
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    });
  }

  @Get('accounts/:id/catalog/products/:productId/variations')
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({
    summary: 'Biến thể của một sản phẩm nhà cung cấp',
    description:
      'Đọc từ Database. `productId` là khoá NỘI BỘ (uuid) lấy từ endpoint sản phẩm ở trên. ' +
      '`sku` trả về chính là giá trị sẽ gửi trong `items[].sku` khi tạo đơn — đây là lý do ' +
      'phải ánh xạ trước khi gửi.',
  })
  @ApiOkResponse({ type: ProviderCatalogVariationDto, isArray: true })
  listCatalogVariations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) _accountId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProviderCatalogVariationDto[]> {
    return this.catalogQuery.listVariations(user.organizationId, productId);
  }

  @Get('accounts/:id/catalog/status')
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({
    summary: 'Tình trạng bản sao danh mục',
    description: 'Số danh mục/sản phẩm/biến thể đang có và thời điểm đồng bộ gần nhất.',
  })
  @ApiOkResponse({ type: CatalogStatusDto })
  catalogStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogStatusDto> {
    return this.catalogQuery.status(user.organizationId, id);
  }

  @Post('accounts/:id/catalog/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.config')
  @ApiOperation({
    summary: 'Đồng bộ danh mục nhà cung cấp về Database (thủ công)',
    description:
      'Kéo Catalogue → Product → Variant từ nhà cung cấp và ghi vào Database (đã có thì ' +
      'UPDATE, chưa có thì INSERT — không sinh bản ghi trùng). Chạy xong sẽ rà lại ánh xạ ' +
      'tự động cho những sản phẩm trước đó chưa tìm được.\n\n' +
      '⚠️ Với danh mục lớn đây là một tác vụ DÀI (hàng nghìn lời gọi API, tự giới hạn ' +
      '10 request/giây theo quy định của nhà cung cấp).\n\n' +
      '`complete = false` nghĩa là có lượt đọc bị cụt; khi đó bước đánh dấu ngừng bán bị BỎ ' +
      'QUA để không xoá nhầm danh mục khỏi các ô chọn — xem `warnings`.',
  })
  @ApiOkResponse({ type: CatalogSyncResultDto })
  async syncCatalog(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogSyncResultDto> {
    const result = await this.catalogSync.syncAccount(
      user.organizationId,
      id,
      FulfillmentTrigger.MANUAL,
      user.userId,
    );
    // Danh mục vừa đổi ⇒ những sản phẩm chưa ánh xạ được có thể đã ánh xạ được.
    await this.autoMap.resolveOrganization(user.organizationId, {
      accountFilter: id,
      actorUserId: user.userId,
    });
    return result;
  }

  @Post('mappings/auto-resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({
    summary: 'Rà ánh xạ tự động cho mọi sản phẩm chưa ánh xạ',
    description:
      'Tìm theo thứ tự **Seller SKU → Product Title → Variant → Catalogue** trong bản sao ' +
      'danh mục. Tìm được DUY NHẤT một kết quả thì tạo ánh xạ; nhiều kết quả thì KHÔNG tạo ' +
      'và đánh dấu "cần chọn tay" (ánh xạ sai còn tệ hơn không ánh xạ).',
  })
  @ApiOkResponse({ type: AutoMapResultDto })
  autoResolveMappings(@CurrentUser() user: AuthenticatedUser): Promise<AutoMapResultDto> {
    return this.autoMap.resolveOrganization(user.organizationId, {
      actorUserId: user.userId,
    });
  }

  @Post('mappings')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({ summary: 'Tạo ánh xạ sản phẩm' })
  @ApiOkResponse({ type: ProductMappingDto })
  @ApiConflictResponse({ description: 'FULFILLMENT_MAPPING_CONFLICT' })
  createMapping(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Body() dto: UpsertProductMappingDto,
    @Query('provider') provider?: FulfillmentProvider,
  ): Promise<ProductMappingDto> {
    return this.service.createMapping(
      user.organizationId,
      user.userId,
      provider ?? FulfillmentProvider.MANGO,
      dto,
      scope,
    );
  }

  @Patch('mappings/:id')
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({ summary: 'Cập nhật ánh xạ sản phẩm' })
  @ApiOkResponse({ type: ProductMappingDto })
  @ApiNotFoundResponse({ description: 'FULFILLMENT_MAPPING_NOT_FOUND' })
  updateMapping(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertProductMappingDto,
  ): Promise<ProductMappingDto> {
    return this.service.updateMapping(user.organizationId, user.userId, id, dto, scope);
  }

  @Delete('mappings/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.mapping')
  @ApiOperation({ summary: 'Xoá ánh xạ sản phẩm' })
  @ApiOkResponse({ description: 'Đã xoá; data = null' })
  deleteMapping(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.deleteMapping(user.organizationId, user.userId, id, scope);
  }

  // ---------------------------------------------------------------------------
  // Design của SẢN PHẨM — ĐƯỜNG GHI DUY NHẤT của design trong hệ thống
  //
  // 🔴 Khoá là (Product ID + Seller SKU) và **ĐỘC LẬP với Product Mapping**. Trước đây design
  // treo vào `mappingId` nên phải khai ánh xạ xong mới upload được — sai về nghiệp vụ:
  //   · Design  trả lời "in cái gì"  → chỉ cần Product ID + Seller SKU
  //   · Mapping trả lời "in ở đâu"   → chỉ cần khi Fulfill
  // Hai việc không phụ thuộc nhau, làm theo thứ tự nào cũng được.
  //
  // 🔴 Upload MỘT lần là mọi đơn cùng cặp khoá — kể cả đơn ngày mai mới đồng bộ về — đều dùng
  // được, không sao chép dữ liệu, không sinh thêm bản ghi. Mỗi vị trí in (FRONT/BACK/…) độc
  // lập: thay FRONT không đụng BACK.
  //
  // Quyền dùng lại `pod.tiktok.design.*` đang có: người làm việc này vẫn là nhân viên POD,
  // và thêm permission mới chỉ để đổi chỗ lưu là bắt mọi tổ chức phải seed lại quyền.
  // ---------------------------------------------------------------------------

  @Get('product-designs')
  @RequirePermissions('fulfillment.read')
  @ApiOperation({
    summary: 'Design đang hiệu lực của một sản phẩm',
    description: 'Khoá là cặp (Product ID + Seller SKU). KHÔNG cần sản phẩm đã được ánh xạ.',
  })
  @ApiOkResponse({ type: PodDesignDto, isArray: true })
  @ApiBadRequestResponse({
    description: 'POD_DESIGN_KEY_INVALID — thiếu Product ID hoặc Seller SKU',
  })
  listProductDesigns(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() key: ProductDesignKeyDto,
  ): Promise<PodDesignDto[]> {
    return this.productDesigns.findByProduct(user.organizationId, key, scope);
  }

  @Post('product-designs/:placement')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.design.upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload / thay thế design tại MỘT vị trí in',
    description:
      '🔴 KHÔNG đòi hỏi sản phẩm đã có Product Mapping — Design và Mapping là hai nghiệp vụ ' +
      'độc lập.\n\n' +
      'Đã có design ở vị trí này thì ghi đè và tăng `version`; file cũ bị xoá khỏi kho lưu ' +
      'trữ. Vị trí in khác KHÔNG bị ảnh hưởng.\n\n' +
      '🔴 Tác động: MỌI đơn mang cùng (Product ID + Seller SKU) và **chưa gửi sản xuất** đọc ' +
      'được file mới ngay lần tải kế tiếp — không có bước sao chép sang đơn. Đơn ĐÃ gửi sản ' +
      'xuất không đổi: file đã gửi được chụp lại ở `fulfillment_order_items.print_files`.',
  })
  @ApiOkResponse({ type: PodDesignDto })
  @ApiBadRequestResponse({
    description: 'POD_DESIGN_KEY_INVALID / POD_DESIGN_FILE_MISSING / POD_DESIGN_FORMAT_INVALID',
  })
  uploadProductDesign(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('placement', new ParseEnumPipe(PodDesignPlacement)) placement: PodDesignPlacement,
    @Query() key: ProductDesignKeyDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<PodDesignDto> {
    return this.productDesigns.upload(
      user.organizationId,
      user.userId,
      key,
      placement,
      file,
      scope,
    );
  }

  @Delete('product-designs/:placement')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.design.delete')
  @ApiOperation({
    summary: 'Xoá design tại MỘT vị trí in',
    description:
      'KHÔNG đụng tới Product Mapping, KHÔNG đụng tới đơn hàng — chỉ gỡ file in. Sau khi xoá, ' +
      'sản phẩm quay về trạng thái thiếu design và upload lại được.\n\n' +
      '🔴 Tác động: MỌI đơn chưa gửi sản xuất mang cùng cặp khoá chuyển sang **Design ' +
      'Missing** ngay. Đơn đã gửi giữ nguyên ảnh chụp file đã gửi.',
  })
  @ApiOkResponse({ description: 'Đã xoá; data = null' })
  @ApiNotFoundResponse({ description: 'FULFILLMENT_DESIGN_NOT_FOUND' })
  deleteProductDesign(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('placement', new ParseEnumPipe(PodDesignPlacement)) placement: PodDesignPlacement,
    @Query() key: ProductDesignKeyDto,
  ): Promise<void> {
    return this.productDesigns.remove(user.organizationId, user.userId, key, placement, scope);
  }

  // ---------------------------------------------------------------------------
  // ⚠️ TƯƠNG THÍCH NGƯỢC — design theo Product Mapping (CŨ, sắp gỡ)
  //
  // Ba route dưới đây giữ nguyên đường dẫn cũ để client đang chạy không gãy. Chúng chỉ tra
  // cặp khoá (Product ID + Seller SKU) của ánh xạ rồi gọi CHÍNH service ở trên — không có
  // bản sao logic nào, nên không thể trôi lệch so với route mới.
  //
  // Hạn chế cố hữu: ánh xạ thiếu khoá thì không quy đổi được. Đó cũng là lý do route mới
  // tồn tại — hãy chuyển sang `/fulfillment/product-designs`.
  // ---------------------------------------------------------------------------

  @Get('mappings/:id/designs')
  @RequirePermissions('fulfillment.read')
  @ApiOperation({
    deprecated: true,
    summary: '[CŨ] Design theo Product Mapping — dùng `GET /fulfillment/product-designs`',
  })
  @ApiOkResponse({ type: PodDesignDto, isArray: true })
  @ApiNotFoundResponse({ description: 'FULFILLMENT_MAPPING_NOT_FOUND' })
  async listMappingDesigns(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodDesignDto[]> {
    const key = await this.service.requireMappingProductKey(user.organizationId, id);
    return this.productDesigns.findByProduct(user.organizationId, key, scope);
  }

  @Post('mappings/:id/designs/:placement')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.design.upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    deprecated: true,
    summary:
      '[CŨ] Upload design theo Product Mapping — dùng `POST /fulfillment/product-designs/{placement}`',
  })
  @ApiOkResponse({ type: PodDesignDto })
  @ApiBadRequestResponse({ description: 'POD_DESIGN_FILE_MISSING / POD_DESIGN_FORMAT_INVALID' })
  async uploadMappingDesign(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('placement', new ParseEnumPipe(PodDesignPlacement)) placement: PodDesignPlacement,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<PodDesignDto> {
    const key = await this.service.requireMappingProductKey(user.organizationId, id);
    return this.productDesigns.upload(
      user.organizationId,
      user.userId,
      key,
      placement,
      file,
      scope,
    );
  }

  @Delete('mappings/:id/designs/:placement')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.design.delete')
  @ApiOperation({
    deprecated: true,
    summary:
      '[CŨ] Xoá design theo Product Mapping — dùng `DELETE /fulfillment/product-designs/{placement}`',
  })
  @ApiOkResponse({ description: 'Đã xoá; data = null' })
  @ApiNotFoundResponse({ description: 'FULFILLMENT_DESIGN_NOT_FOUND' })
  async deleteMappingDesign(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('placement', new ParseEnumPipe(PodDesignPlacement)) placement: PodDesignPlacement,
  ): Promise<void> {
    const key = await this.service.requireMappingProductKey(user.organizationId, id);
    return this.productDesigns.remove(user.organizationId, user.userId, key, placement, scope);
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
    @PodScope() scope: PodAccessScope,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentStateDto> {
    return this.service.getState(user.organizationId, podOrderId, scope);
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
    @PodScope() scope: PodAccessScope,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentOrderDto> {
    await this.service.assertPodOrderInScope(user.organizationId, podOrderId, scope);
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
    @PodScope() scope: PodAccessScope,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentHistoryDto[]> {
    return this.service.listHistory(user.organizationId, podOrderId, scope);
  }

  @Get('orders/:podOrderId/errors')
  @RequirePermissions('fulfillment.read')
  @ApiOperation({ summary: 'Chi tiết lỗi gần đây (HTTP status, code, validation)' })
  @ApiOkResponse({ type: FulfillmentErrorDto, isArray: true })
  listErrors(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('podOrderId', ParseUUIDPipe) podOrderId: string,
  ): Promise<FulfillmentErrorDto[]> {
    return this.service.listErrors(user.organizationId, podOrderId, scope);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  // 🔴 `fulfillment.create` chứ không phải `fulfillment.read`: đây là lời gọi HÀNG LOẠT tới
  // nhà cung cấp cho MỌI đơn của tổ chức — không lọc theo shop được vì bản chất nó là thao
  // tác vận hành cấp tổ chức. Seller không có quyền này (§7), Admin thì có sẵn.
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Đồng bộ trạng thái toàn bộ đơn đang chạy',
    description: 'Chỉ trong phạm vi tổ chức của người gọi. Thao tác cấp tổ chức — chỉ Admin.',
  })
  @ApiOkResponse({ type: FulfillmentSyncResultDto })
  triggerSync(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: TriggerFulfillmentSyncDto,
  ): Promise<FulfillmentSyncResultDto> {
    return this.syncService.runAll(FulfillmentTrigger.MANUAL, user.organizationId, user.userId);
  }
}
