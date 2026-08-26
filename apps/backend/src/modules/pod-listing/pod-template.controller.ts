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
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { requireXlsx, xlsxFile, xlsxUploadOptions } from '../../common/excel/excel.http';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  POD_IMAGE_TEMPLATE_MAX_UPLOAD,
  POD_TEMPLATE_TOKENS,
} from './constants/pod-listing.constants';
import { imageUploadOptions } from './pod-image-upload.options';
import {
  BulkUpdateSkuItemsDto,
  ClonePodTemplateDto,
  CreateCategoryTemplateDto,
  CreateDescriptionTemplateDto,
  CreateImageTemplateDto,
  CreatePricingStrategyDto,
  CreateSkuTemplateDto,
  GenerateSkuItemsDto,
  PodTemplateQueryDto,
  PreviewDescriptionDto,
  UpdateCategoryTemplateDto,
  UpdateDescriptionTemplateDto,
  SortImageItemsDto,
  UpdateImageItemDto,
  UpdateImageTemplateDto,
  UploadImageItemsDto,
  UpdatePricingStrategyDto,
  UpdateSkuItemDto,
  UpdateSkuTemplateDto,
} from './dto/pod-template.dto';
import { ImportTemplateBundleDto } from './dto/pod-template-transfer.dto';
import { PodSkuExcelService } from './services/pod-sku-excel.service';
import { PodImageTemplateService } from './services/pod-image-template.service';
import { PodTemplateService } from './services/pod-template.service';
import { PodTemplateTransferService } from './services/pod-template-transfer.service';
import { POD_SYSTEM_TOKENS } from './services/pod-token.engine';

/**
 * PodTemplateController — 5 nhóm template nhỏ dùng để ghép thành Listing Template.
 *
 * Gom vào MỘT controller theo đúng cách người dùng nhìn hệ thống: menu "Templates" có
 * 6 tab, năm trong số đó nằm ở đây (tab thứ sáu — Listing Template — ở `PodListingController`
 * vì nó còn kéo theo kho và preview).
 *
 * Mỗi loại đều có cùng bộ thao tác: List (search / filter / sort / phân trang) · Detail ·
 * Create · Update · Clone · Delete · Export · Import.
 *
 * 🔴 Không endpoint nào ở đây chạm tới TikTok. Template chỉ là dữ liệu cấu hình nội bộ.
 */
@ApiTags('POD - Listing Templates')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/templates')
export class PodTemplateController {
  constructor(
    private readonly service: PodTemplateService,
    private readonly images: PodImageTemplateService,
    private readonly transfer: PodTemplateTransferService,
    private readonly skuExcel: PodSkuExcelService,
  ) {}

  // ------------------------------- Metadata -------------------------------

  @Get('tokens')
  @RequirePermissions('pod.template.read')
  @ApiOperation({
    summary: 'Danh sách token hệ thống của Description Template',
    description:
      'Nguồn cho bảng token trên trình soạn thảo. Token do người dùng tự đặt nằm ở chính ' +
      'Description Template, không có ở đây.',
  })
  listSystemTokens() {
    return { tokens: POD_SYSTEM_TOKENS, codes: POD_TEMPLATE_TOKENS };
  }

  // ------------------------------- Category -------------------------------

  @Get('categories')
  @RequirePermissions('pod.template.read')
  @ApiOperation({
    summary: 'Danh sách Category Template',
    description:
      'Mỗi template gắn với MỘT danh mục TikTok + Sales Market, kèm giá trị thuộc tính, ' +
      'brand, kho, size chart, video và kích thước kiện. Danh sách thuộc tính lấy từ dữ ' +
      'liệu đã đồng bộ, không hardcode.',
  })
  listCategoryTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodTemplateQueryDto,
  ) {
    return this.service.listCategoryTemplates(user.organizationId, query);
  }

  @Get('categories/export')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Export Category Template ra gói JSON (dùng lại ở tổ chức khác)' })
  exportCategoryTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodTemplateQueryDto,
  ) {
    return this.transfer.export(user.organizationId, 'CATEGORY', query);
  }

  @Get('categories/:id')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Chi tiết Category Template' })
  getCategoryTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getCategoryTemplate(user.organizationId, id);
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Tạo Category Template' })
  createCategoryTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCategoryTemplateDto,
  ) {
    return this.service.createCategoryTemplate(user.organizationId, user.userId, dto);
  }

  @Post('categories/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Import Category Template từ gói JSON đã export' })
  importCategoryTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportTemplateBundleDto,
  ) {
    return this.transfer.import(user.organizationId, user.userId, 'CATEGORY', dto);
  }

  @Post('categories/:id/clone')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Nhân bản Category Template (kèm toàn bộ giá trị thuộc tính)' })
  cloneCategoryTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClonePodTemplateDto,
  ) {
    return this.service.cloneCategoryTemplate(user.organizationId, user.userId, id, dto?.name);
  }

  @Patch('categories/:id')
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Cập nhật Category Template',
    description: 'Bộ thuộc tính được ghi đè trọn vẹn — đổi danh mục là đổi cả bộ thuộc tính.',
  })
  updateCategoryTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryTemplateDto,
  ) {
    return this.service.updateCategoryTemplate(user.organizationId, user.userId, id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Xoá Category Template (chặn nếu đang được Listing Template dùng)' })
  removeCategoryTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removeCategoryTemplate(user.organizationId, user.userId, id);
  }

  // --------------------------------- SKU ----------------------------------

  @Get('skus')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Danh sách SKU Template' })
  listSkuTemplates(@CurrentUser() user: AuthenticatedUser, @Query() query: PodTemplateQueryDto) {
    return this.service.listSkuTemplates(user.organizationId, query);
  }

  @Get('skus/export')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Export SKU Template ra gói JSON' })
  exportSkuTemplates(@CurrentUser() user: AuthenticatedUser, @Query() query: PodTemplateQueryDto) {
    return this.transfer.export(user.organizationId, 'SKU', query);
  }

  @Get('skus/:id')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Chi tiết SKU Template (trục biến thể + toàn bộ SKU đã sinh)' })
  getSkuTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getSkuTemplate(user.organizationId, id);
  }

  @Post('skus')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Tạo SKU Template',
    description:
      'Khai báo các trục (Color, Size, Style… — không giới hạn ở hai trục) và hệ thống ' +
      'sinh TOÀN BỘ tổ hợp.',
  })
  createSkuTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSkuTemplateDto) {
    return this.service.createSkuTemplate(user.organizationId, user.userId, dto);
  }

  @Post('skus/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Import SKU Template từ gói JSON đã export' })
  importSkuTemplates(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportTemplateBundleDto) {
    return this.transfer.import(user.organizationId, user.userId, 'SKU', dto);
  }

  @Post('skus/:id/clone')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Nhân bản SKU Template (giữ nguyên giá / tồn / barcode từng dòng)' })
  cloneSkuTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClonePodTemplateDto,
  ) {
    return this.service.cloneSkuTemplate(user.organizationId, user.userId, id, dto?.name);
  }

  @Patch('skus/:id')
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Cập nhật SKU Template (chỉ trục biến thể + giá trị mặc định)',
    description:
      '🔴 KHÔNG sinh lại bảng SKU. Đổi trục chỉ đánh dấu template là "cần tạo lại SKU" ' +
      '(`isStale = true`); bảng SKU giữ nguyên cho tới khi người dùng bấm Tạo SKU.',
  })
  updateSkuTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkuTemplateDto,
  ) {
    return this.service.updateSkuTemplate(user.organizationId, user.userId, id, dto);
  }

  @Post('skus/:id/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Tạo SKU — sinh toàn bộ tổ hợp từ trục biến thể',
    description:
      'Nơi DUY NHẤT ghi vào bảng SKU. Mặc định giữ giá / tồn / barcode / ảnh của tổ hợp trùng ' +
      'tên; `resetEdits = true` mới dựng lại từ giá trị mặc định.',
  })
  generateSkuItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateSkuItemsDto,
  ) {
    return this.service.generateSkuItems(user.organizationId, user.userId, id, dto ?? {});
  }

  @Delete('skus/:id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Xoá MỘT dòng SKU',
    description: 'Chỉ xoá tổ hợp đó. Trục biến thể giữ nguyên.',
  })
  removeSkuItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.service.removeSkuItem(user.organizationId, id, itemId);
  }

  @Patch('skus/:id/items/:itemId')
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Sửa một SKU (giá, tồn kho, barcode, ảnh, mã SKU, bật/tắt)' })
  updateSkuItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateSkuItemDto,
  ) {
    return this.service.updateSkuItem(user.organizationId, id, itemId, dto);
  }

  @Patch('skus/:id/items')
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Bulk Update SKU',
    description:
      'Chọn dòng theo `itemIds` và/hoặc `filters` (giá trị trục: cùng trục = HOẶC, khác trục ' +
      '= VÀ). Không truyền gì = áp cho TẤT CẢ. Kèm `skuPrefix` / `barcodePrefix` để đánh lại mã.',
  })
  bulkUpdateSkuItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkUpdateSkuItemsDto,
  ) {
    return this.service.bulkUpdateSkuItems(user.organizationId, id, dto);
  }

  @Get('skus/:id/items/export')
  @RequirePermissions('pod.template.read')
  @ApiOperation({
    summary: 'Export bảng SKU ra Excel (.xlsx)',
    description: 'Sửa giá / tồn / barcode hàng loạt trong Excel rồi nạp lại bằng Import.',
  })
  exportSkuItems(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.skuExcel
      .export(user.organizationId, id)
      .then((file) => xlsxFile(file.buffer, file.filename));
  }

  @Post('skus/:id/items/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @UseInterceptors(FileInterceptor('file', xlsxUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary: 'Import bảng SKU từ Excel (.xlsx)',
    description:
      'Đối chiếu theo cột Variant. Kiểm tra toàn bộ file trước; chỉ cần một dòng lỗi là ' +
      'KHÔNG dòng nào được ghi.',
  })
  importSkuItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.skuExcel.import(user.organizationId, id, requireXlsx(file));
  }

  @Delete('skus/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Xoá SKU Template' })
  removeSkuTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removeSkuTemplate(user.organizationId, user.userId, id);
  }

  // ----------------------------- Description ------------------------------

  @Get('descriptions')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Danh sách Description Template' })
  listDescriptionTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodTemplateQueryDto,
  ) {
    return this.service.listDescriptionTemplates(user.organizationId, query);
  }

  @Get('descriptions/export')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Export Description Template ra gói JSON' })
  exportDescriptionTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodTemplateQueryDto,
  ) {
    return this.transfer.export(user.organizationId, 'DESCRIPTION', query);
  }

  @Post('descriptions/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.read')
  @ApiOperation({
    summary: 'Xem trước mô tả sau khi thay token',
    description:
      'Trả HTML đã thay token + danh sách token KHÔNG nhận ra (gõ sai). **Không ghi database.**',
  })
  previewDescription(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreviewDescriptionDto) {
    return this.service.previewDescription(user.organizationId, dto);
  }

  @Get('descriptions/:id')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Chi tiết Description Template (kèm token tự đặt)' })
  getDescriptionTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getDescriptionTemplate(user.organizationId, id);
  }

  @Post('descriptions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Tạo Description Template (HTML + token)' })
  createDescriptionTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDescriptionTemplateDto,
  ) {
    return this.service.createDescriptionTemplate(user.organizationId, user.userId, dto);
  }

  @Post('descriptions/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Import Description Template từ gói JSON đã export' })
  importDescriptionTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportTemplateBundleDto,
  ) {
    return this.transfer.import(user.organizationId, user.userId, 'DESCRIPTION', dto);
  }

  @Post('descriptions/:id/clone')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Nhân bản Description Template' })
  cloneDescriptionTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClonePodTemplateDto,
  ) {
    return this.service.cloneDescriptionTemplate(user.organizationId, user.userId, id, dto?.name);
  }

  @Patch('descriptions/:id')
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Cập nhật Description Template' })
  updateDescriptionTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDescriptionTemplateDto,
  ) {
    return this.service.updateDescriptionTemplate(user.organizationId, user.userId, id, dto);
  }

  @Delete('descriptions/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Xoá Description Template' })
  removeDescriptionTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removeDescriptionTemplate(user.organizationId, user.userId, id);
  }

  // -------------------------------- Image ---------------------------------

  @Get('images')
  @RequirePermissions('pod.template.read')
  @ApiOperation({
    summary: 'Danh sách bộ ảnh mẫu',
    description:
      'Mỗi bộ là một thư viện ảnh CỐ ĐỊNH của phôi (mockup, lifestyle, size chart…), dùng ' +
      'lại cho hàng nghìn listing. Không phải ảnh sản phẩm.',
  })
  listImageTemplates(@CurrentUser() user: AuthenticatedUser, @Query() query: PodTemplateQueryDto) {
    return this.images.list(user.organizationId, query);
  }

  @Get('images/export')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Export Image Template ra gói JSON (tham chiếu file trên R2)' })
  exportImageTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodTemplateQueryDto,
  ) {
    return this.transfer.export(user.organizationId, 'IMAGE', query);
  }

  @Get('images/:id')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Chi tiết bộ ảnh (kèm toàn bộ ảnh theo thứ tự hiển thị)' })
  getImageTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.images.get(user.organizationId, id);
  }

  @Post('images')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Tạo bộ ảnh mẫu',
    description: 'Tạo bộ rỗng trước, rồi tải ảnh lên qua `POST /images/:id/items`.',
  })
  createImageTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateImageTemplateDto) {
    return this.images.create(user.organizationId, user.userId, dto);
  }

  @Post('images/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Import Image Template từ gói JSON đã export' })
  importImageTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportTemplateBundleDto,
  ) {
    return this.transfer.import(user.organizationId, user.userId, 'IMAGE', dto);
  }

  @Post('images/:id/clone')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Nhân bản bộ ảnh',
    description: 'Dùng lại chính file trên R2, không upload lại.',
  })
  cloneImageTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClonePodTemplateDto,
  ) {
    return this.images.clone(user.organizationId, user.userId, id, dto?.name);
  }

  @Post('images/:id/default')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Đặt làm bộ ảnh mặc định' })
  setDefaultImageTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.images.setDefault(user.organizationId, user.userId, id);
  }

  @Patch('images/:id')
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Cập nhật thông tin bộ ảnh (tên, mô tả, thứ tự, mặc định)' })
  updateImageTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateImageTemplateDto,
  ) {
    return this.images.update(user.organizationId, user.userId, id, dto);
  }

  @Delete('images/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Xoá bộ ảnh (chặn nếu Listing Template đang dùng)' })
  removeImageTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.images.remove(user.organizationId, user.userId, id);
  }

  // ------------------------ Ảnh trong bộ (gallery) ------------------------

  @Post('images/:id/items')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @UseInterceptors(FilesInterceptor('files', POD_IMAGE_TEMPLATE_MAX_UPLOAD, imageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        assetType: { type: 'string' },
        assetTypes: { type: 'array', items: { type: 'string' } },
        titles: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiOperation({
    summary: 'Tải NHIỀU ảnh vào bộ (bulk upload)',
    description:
      'Đẩy thẳng lên Cloudflare R2 qua Storage Module, lưu URL / key / kích thước / dung ' +
      'lượng / content-type. Tiêu đề mặc định lấy từ tên file.',
  })
  uploadImageItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadImageItemsDto,
  ) {
    return this.images.uploadItems(user.organizationId, user.userId, id, files, dto ?? {});
  }

  /** Đặt TRƯỚC `items/:itemId` — nếu không, "sort" bị route `:itemId` bắt nhầm. */
  @Patch('images/:id/items/sort')
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Sắp xếp lại ảnh (kéo thả)',
    description: 'Gửi TRỌN danh sách id theo thứ tự mới.',
  })
  sortImageItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SortImageItemsDto,
  ) {
    return this.images.sortItems(user.organizationId, id, dto);
  }

  @Patch('images/:id/items/:itemId')
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Sửa tiêu đề / loại / cờ bắt buộc của một ảnh' })
  updateImageItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateImageItemDto,
  ) {
    return this.images.updateItem(user.organizationId, id, itemId, dto);
  }

  @Put('images/:id/items/:itemId/file')
  @RequirePermissions('pod.template.write')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary: 'Thay ảnh của một dòng',
    description: 'Giữ nguyên tiêu đề, loại và vị trí; file cũ được dọn nếu không bộ nào dùng.',
  })
  replaceImageItemFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.images.replaceItemFile(user.organizationId, user.userId, id, itemId, file);
  }

  @Delete('images/:id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Xoá một ảnh khỏi bộ' })
  removeImageItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.images.removeItem(user.organizationId, user.userId, id, itemId);
  }

  // ------------------------------- Pricing --------------------------------

  @Get('pricing')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Danh sách Pricing Strategy' })
  listPricingStrategies(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodTemplateQueryDto,
  ) {
    return this.service.listPricingStrategies(user.organizationId, query);
  }

  @Get('pricing/export')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Export Pricing Strategy ra gói JSON' })
  exportPricingStrategies(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodTemplateQueryDto,
  ) {
    return this.transfer.export(user.organizationId, 'PRICING', query);
  }

  @Get('pricing/:id')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Chi tiết Pricing Strategy' })
  getPricingStrategy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getPricingStrategy(user.organizationId, id);
  }

  @Post('pricing')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Tạo Pricing Strategy',
    description:
      'Cost + Shipping + Markup (Percentage / Fixed / Formula) ⇒ Sale Price ⇒ Retail Price ' +
      '⇒ Discount. Không hardcode con số nào.',
  })
  createPricingStrategy(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePricingStrategyDto,
  ) {
    return this.service.createPricingStrategy(user.organizationId, user.userId, dto);
  }

  @Post('pricing/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Import Pricing Strategy từ gói JSON đã export' })
  importPricingStrategies(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportTemplateBundleDto,
  ) {
    return this.transfer.import(user.organizationId, user.userId, 'PRICING', dto);
  }

  @Post('pricing/:id/clone')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Nhân bản Pricing Strategy' })
  clonePricingStrategy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClonePodTemplateDto,
  ) {
    return this.service.clonePricingStrategy(user.organizationId, user.userId, id, dto?.name);
  }

  @Patch('pricing/:id')
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Cập nhật Pricing Strategy' })
  updatePricingStrategy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePricingStrategyDto,
  ) {
    return this.service.updatePricingStrategy(user.organizationId, user.userId, id, dto);
  }

  @Delete('pricing/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Xoá Pricing Strategy' })
  removePricingStrategy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removePricingStrategy(user.organizationId, user.userId, id);
  }
}
