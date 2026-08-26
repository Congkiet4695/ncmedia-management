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
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PodScope } from '../pod-tiktok/decorators/pod-scope.decorator';
import { PodScopeGuard } from '../pod-tiktok/guards/pod-scope.guard';
import type { PodAccessScope } from '../pod-tiktok/services/pod-access-scope.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  GenerateListingPayloadDto,
  PodListingPayloadQueryDto,
  PreviewListingPayloadDto,
} from './dto/pod-listing-payload.dto';
import { ImportTemplateBundleDto } from './dto/pod-template-transfer.dto';
import {
  ClonePodTemplateDto,
  CreateListingTemplateDto,
  ListingTemplateDryRunDto,
  ListingTemplateProductQueryDto,
  PodTemplateQueryDto,
  UpdateListingTemplateDto,
} from './dto/pod-template.dto';
import { PodListingPayloadService } from './services/pod-listing-payload.service';
import { PodListingTemplateService } from './services/pod-listing-template.service';
import { PodTemplateScopeService } from './services/pod-template-scope.service';
import { PodTemplateTransferService } from './services/pod-template-transfer.service';
import { PodWarehouseService } from './services/pod-warehouse.service';

/**
 * PodListingController — Listing Template, Warehouse, Preview và Draft Generator.
 *
 * 🔴 Ranh giới Sprint 3 (được thực thi bằng chính việc KHÔNG có endpoint nào khác):
 * không Create Product, không Submit, không Publish, không upload ảnh lên TikTok.
 * Endpoint duy nhất chạm TikTok ở đây là **đồng bộ kho** — một lời gọi CHỈ ĐỌC.
 */
@ApiTags('POD - Listing')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
// 🔴 PodScopeGuard nạp phạm vi shop cho MỌI route dưới đây — route thêm sau cũng
// được bảo vệ mà không phải nhớ gắn lại.
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('pod')
export class PodListingController {
  constructor(
    private readonly listingTemplates: PodListingTemplateService,
    private readonly drafts: PodListingPayloadService,
    private readonly warehouses: PodWarehouseService,
    private readonly transfer: PodTemplateTransferService,
    private readonly scopes: PodTemplateScopeService,
  ) {}

  // --------------------------- Listing Template ---------------------------

  @Get('listing-templates')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Danh sách Listing Template' })
  listTemplates(@CurrentUser() user: AuthenticatedUser, @Query() query: PodTemplateQueryDto) {
    return this.listingTemplates.list(user.organizationId, query);
  }

  @Get('listing-templates/export')
  @RequirePermissions('pod.template.read')
  @ApiOperation({
    summary: 'Export Listing Template ra gói JSON',
    description: 'Template con được tham chiếu theo TÊN để nạp lại được ở tổ chức khác.',
  })
  exportTemplates(@CurrentUser() user: AuthenticatedUser, @Query() query: PodTemplateQueryDto) {
    return this.transfer.export(user.organizationId, 'LISTING', query);
  }

  @Post('listing-templates/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Import Listing Template từ gói JSON',
    description:
      'Template con được tra theo tên trong tổ chức hiện tại; không tìm thấy thì để trống ' +
      'mảnh đó và ghi vào `warnings`.',
  })
  importTemplates(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportTemplateBundleDto) {
    return this.transfer.import(user.organizationId, user.userId, 'LISTING', dto);
  }

  @Get('listing-templates/:id')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Chi tiết Listing Template (đủ 5 mảnh đã ghép)' })
  getTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listingTemplates.get(user.organizationId, id);
  }

  @Post('listing-templates')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({
    summary: 'Tạo Listing Template',
    description:
      'Ghép Category + SKU + Description + Image + Pricing + Warehouse + Brand + Shipping. ' +
      'Category Template phải cùng thị trường với Listing Template.',
  })
  createTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateListingTemplateDto) {
    return this.listingTemplates.create(user.organizationId, user.userId, dto);
  }

  @Patch('listing-templates/:id')
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Cập nhật Listing Template' })
  updateTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingTemplateDto,
  ) {
    return this.listingTemplates.update(user.organizationId, user.userId, id, dto);
  }

  @Post('listing-templates/:id/clone')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Nhân bản Listing Template' })
  cloneTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClonePodTemplateDto,
  ) {
    return this.listingTemplates.clone(user.organizationId, user.userId, id, dto?.name);
  }

  @Delete('listing-templates/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.write')
  @ApiOperation({ summary: 'Xoá Listing Template (xoá mềm — draft đã sinh vẫn tra được nguồn)' })
  removeTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listingTemplates.remove(user.organizationId, user.userId, id);
  }

  // ------------------ Phạm vi áp dụng (Template → Product) -----------------

  @Get('listing-templates/:id/products')
  @RequirePermissions('pod.template.read')
  @ApiOperation({
    summary: 'Những sản phẩm mà Listing Template này đang bao phủ',
    description:
      'Kết quả của các quy tắc phạm vi (`scopes`). Đây là tập sản phẩm sẽ được sinh listing ' +
      'hàng loạt ở sprint sau — sản phẩm mới đồng bộ về tự động lọt vào đây, không cần gán tay.',
  })
  listMatchingProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListingTemplateProductQueryDto,
  ) {
    return this.scopes.listMatchingProducts(user.organizationId, id, query);
  }

  @Get('listing-templates/:id/products/count')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Đếm nhanh số sản phẩm Listing Template đang bao phủ' })
  async countMatchingProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { total: await this.scopes.countMatchingProducts(user.organizationId, id) };
  }

  @Post('listing-templates/:id/dry-run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.template.read')
  @ApiOperation({
    summary: 'Chạy thử template trên vài sản phẩm thật',
    description:
      'Giải template thành listing hoàn chỉnh cho từng sản phẩm và báo sản phẩm nào đã đủ dữ ' +
      'liệu. **KHÔNG ghi gì vào database, không gọi TikTok.** Dùng chung đúng hàm resolve mà ' +
      'sprint sau sẽ dùng để sinh draft.',
  })
  dryRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ListingTemplateDryRunDto,
  ) {
    return this.scopes.dryRun(user.organizationId, id, dto);
  }

  // ------------------------------- Warehouse ------------------------------

  @Get('warehouses')
  @RequirePermissions('pod.template.read')
  @ApiOperation({ summary: 'Danh sách kho đã đồng bộ từ TikTok' })
  listWarehouses(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query('shopId') shopId?: string,
  ) {
    return this.warehouses.list(user.organizationId, { shopId }, scope);
  }

  @Post('warehouses/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.product.sync')
  @ApiOperation({
    summary: 'Đồng bộ kho từ TikTok (Get Warehouse List)',
    description: 'Lời gọi CHỈ ĐỌC qua SDK — không ghi gì lên TikTok.',
  })
  syncWarehouses(@CurrentUser() user: AuthenticatedUser, @Body() body: { shopId?: string }) {
    return this.warehouses.sync({ organizationId: user.organizationId, shopId: body?.shopId });
  }

  // ----------------------- Preview & Draft Generator ----------------------

  @Post('listing-preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.draft.read')
  @ApiOperation({
    summary: 'Xem trước listing (Product + Template)',
    description:
      'Trả về đúng nội dung sẽ được lưu khi Generate: category, brand, mô tả, ảnh, biến thể, ' +
      'thuộc tính, kiện hàng, giá — kèm danh sách lỗi/cảnh báo. **KHÔNG tạo draft.**',
  })
  preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreviewListingPayloadDto) {
    return this.drafts.preview(user.organizationId, dto);
  }

  @Post('draft-listings/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.draft.generate')
  @ApiOperation({
    summary: 'Generate Draft Listing hàng loạt (N sản phẩm × M shop)',
    description:
      'Cho phép ghi đè Listing/Image Template theo từng sản phẩm. Draft chỉ nằm trong ' +
      'database — Sprint 4 mới publish lên TikTok.',
  })
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Body() dto: GenerateListingPayloadDto,
  ) {
    return this.drafts.generate(user.organizationId, user.userId, dto, scope);
  }

  @Get('draft-listings')
  @RequirePermissions('pod.draft.read')
  @ApiOperation({ summary: 'Danh sách Draft Listing' })
  listDrafts(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodListingPayloadQueryDto,
  ) {
    return this.drafts.list(user.organizationId, query, scope);
  }

  @Get('draft-listings/:id')
  @RequirePermissions('pod.draft.read')
  @ApiOperation({ summary: 'Chi tiết Draft Listing (payload + biến thể + lỗi)' })
  getDraft(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.drafts.get(user.organizationId, id, scope);
  }

  @Delete('draft-listings/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.draft.generate')
  @ApiOperation({
    summary: 'Bỏ một Draft Listing (xoá mềm)',
    description:
      '`?remote=true` xoá luôn Draft Product bên TikTok — không thì Seller Center còn lại ' +
      'một Draft mồ côi mà hệ thống không còn theo dõi.',
  })
  removeDraft(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('remote') remote?: string,
  ) {
    return this.drafts.remove(user.organizationId, user.userId, id, scope, {
      remote: remote === 'true',
    });
  }
}
