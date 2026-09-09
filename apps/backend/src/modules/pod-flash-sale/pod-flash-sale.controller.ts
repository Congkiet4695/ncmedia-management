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
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { PodScope } from '../pod-tiktok/decorators/pod-scope.decorator';
import { PodScopeGuard } from '../pod-tiktok/guards/pod-scope.guard';
import type { PodAccessScope } from '../pod-tiktok/services/pod-access-scope.service';
import { FLASH_SALE_PERMISSIONS } from './constants/pod-flash-sale.constants';
import {
  AddFlashSaleItemsDto,
  BatchUpdateFlashSaleItemsDto,
  CreateFlashSaleDto,
  DeleteFlashSaleItemsDto,
  DuplicateFlashSaleDto,
  PodFlashSaleLogQueryDto,
  PodFlashSaleQueryDto,
  PublishFlashSaleDto,
  SaveFlashSaleTemplateDto,
  UpdateFlashSaleDto,
  UpdateFlashSaleItemDto,
} from './dto/pod-flash-sale.dto';
import {
  PodFlashSalePublishStatusDto,
  PaginatedPodFlashSaleDto,
  PaginatedPodFlashSaleLogDto,
  PodFlashSaleDetailDto,
  PodFlashSalePublishResultDto,
  PodFlashSaleTemplateDto,
  PodFlashSaleValidationDto,
} from './dto/pod-flash-sale-response.dto';
import { PodFlashSaleItemService } from './services/pod-flash-sale-item.service';
import { PodFlashSalePublisherService } from './services/pod-flash-sale-publisher.service';
import { PodFlashSaleSyncService } from './services/pod-flash-sale-sync.service';
import { PodFlashSaleTemplateService } from './services/pod-flash-sale-template.service';
import { PodFlashSaleService } from './services/pod-flash-sale.service';

/**
 * PodFlashSaleController — màn hình **POD → Flash Sales**.
 *
 * Ba mức quyền, tách nhau có chủ ý (xem catalog permission trong `prisma/seed.ts`):
 *  - `pod.flashsale.read`    — xem danh sách, chi tiết, nhật ký.
 *  - `pod.flashsale.write`   — tạo, sửa, xoá, thêm/sửa sản phẩm, nhân bản, lưu template.
 *  - `pod.flashsale.publish` — 🔴 ĐẨY LÊN SÀN THẬT, retry và huỷ. Không gộp chung với
 *    `write`: soạn một đợt sale không ảnh hưởng gì tới shop, còn publish thì đổi giá bán
 *    thật cho người mua thật.
 *
 * Tenant-scoped (`organizationId` từ JWT) + phạm vi shop (`PodScopeGuard`) cho MỌI route,
 * kể cả route thêm sau này.
 */
@ApiTags('POD - Flash Sales')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN) hoặc shop ngoài phạm vi' })
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('pod/flash-sales')
export class PodFlashSaleController {
  constructor(
    private readonly service: PodFlashSaleService,
    private readonly items: PodFlashSaleItemService,
    private readonly publisher: PodFlashSalePublisherService,
    private readonly templates: PodFlashSaleTemplateService,
    private readonly sync: PodFlashSaleSyncService,
  ) {}

  // ---------------------------------------------------------------------------
  // Danh sách & chi tiết
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(FLASH_SALE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Danh sách Flash Sale',
    description:
      'CHỈ đọc database — không gọi TikTok. Lọc theo trạng thái, shop, TikTok Account và ' +
      'khoảng thời gian bắt đầu; ô tìm kiếm khớp Tên · activity_id.',
  })
  @ApiOkResponse({ type: PaginatedPodFlashSaleDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodFlashSaleQueryDto,
  ): Promise<PaginatedPodFlashSaleDto> {
    return this.service.list(user.organizationId, query, scope);
  }

  @Get(':id')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Chi tiết Flash Sale',
    description: 'Kèm danh sách sản phẩm, kết quả kiểm tra và các nút được phép bấm.',
  })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodFlashSaleDetailDto> {
    return this.service.getDetail(user.organizationId, id, scope);
  }

  @Get(':id/validate')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Kiểm tra trước khi Publish',
    description: 'Cùng bộ luật mà đường Publish dùng — giao diện và API không bao giờ lệch nhau.',
  })
  @ApiOkResponse({ type: PodFlashSaleValidationDto })
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodFlashSaleValidationDto> {
    return this.service.validate(user.organizationId, id, scope);
  }

  @Get(':id/publish-status')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Tiến độ lượt publish (dùng cho polling)',
    description:
      'Payload NHẸ — không kèm danh sách dòng. Publish trả về ngay sau khi tạo hoạt động ' +
      'khuyến mãi, các lô sản phẩm được gửi nền; đây là chỗ giao diện đọc "đang ở lô 12/34". ' +
      'Hỏi lại khi `live = true`, dừng khi `live = false`.',
  })
  @ApiOkResponse({ type: PodFlashSalePublishStatusDto })
  publishStatus(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodFlashSalePublishStatusDto> {
    return this.service.getPublishStatus(user.organizationId, id, scope);
  }

  @Get(':id/logs')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Nhật ký (History) — request, response và mã lỗi TikTok',
  })
  @ApiOkResponse({ type: PaginatedPodFlashSaleLogDto })
  logs(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PodFlashSaleLogQueryDto,
  ): Promise<PaginatedPodFlashSaleLogDto> {
    return this.service.listLogs(user.organizationId, id, query, scope);
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({
    summary: 'Tạo Flash Sale',
    description: 'Gửi kèm `templateId` để nạp sẵn sản phẩm, giá deal và giới hạn từ template.',
  })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  @ApiConflictResponse({ description: 'Tên đã tồn tại trong shop (POD_FLASH_SALE_NAME_TAKEN)' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Body() dto: CreateFlashSaleDto,
  ): Promise<PodFlashSaleDetailDto> {
    const created = await this.service.create(user.organizationId, user.userId, dto, scope);
    if (dto.templateId) {
      await this.templates.applyToExisting(
        user.organizationId,
        user.userId,
        dto.templateId,
        created,
        scope,
      );
    }
    return this.service.getDetail(user.organizationId, created.id, scope);
  }

  @Patch(':id')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({ summary: 'Sửa Flash Sale (tên, mô tả, khung giờ, mức áp dụng)' })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  @ApiConflictResponse({ description: 'Trạng thái không cho phép sửa (POD_FLASH_SALE_INVALID_STATE)' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFlashSaleDto,
  ): Promise<PodFlashSaleDetailDto> {
    const updated = await this.service.update(user.organizationId, user.userId, id, dto, scope);
    return this.service.toDetail(updated);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({
    summary: 'Xoá Flash Sale (xoá mềm)',
    description: 'Đợt đang RUNNING/PUBLISHING phải Cancel trước — xoá thẳng sẽ để lại khuyến mãi mồ côi trên sàn.',
  })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(user.organizationId, user.userId, id, scope);
  }

  @Post(':id/duplicate')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({
    summary: 'Nhân bản Flash Sale',
    description:
      'Sao chép toàn bộ sản phẩm, giá deal và giới hạn sang một đợt DRAFT mới. Không sao ' +
      'chép activity_id, trạng thái hay nhật ký.',
  })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  async duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DuplicateFlashSaleDto,
  ): Promise<PodFlashSaleDetailDto> {
    const created = await this.service.duplicate(user.organizationId, user.userId, id, dto, scope);
    return this.service.toDetail(created);
  }

  // ---------------------------------------------------------------------------
  // Sản phẩm trong đợt sale
  // ---------------------------------------------------------------------------

  @Post(':id/items')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({
    summary: 'Thêm sản phẩm (dialog Add Products)',
    description:
      'Ở mức VARIATION, một mục không kèm `variantId` được bung ra thành mọi biến thể của ' +
      'sản phẩm. Thêm lại dòng đã có là thao tác rỗng, không lỗi.',
  })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  async addItems(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddFlashSaleItemsDto,
  ): Promise<PodFlashSaleDetailDto> {
    const updated = await this.items.addItems(
      user.organizationId,
      user.userId,
      id,
      dto.items,
      scope,
    );
    return this.service.toDetail(updated);
  }

  @Patch(':id/items/batch')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({
    summary: 'Batch Action — áp giá / % giảm / giới hạn cho nhiều dòng',
    description:
      '`discountPercent` được tính lại trên giá gốc RIÊNG của từng dòng; `flashSalePrice` ' +
      'đặt cùng một con số cho mọi dòng.',
  })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  async batchUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BatchUpdateFlashSaleItemsDto,
  ): Promise<PodFlashSaleDetailDto> {
    const updated = await this.items.batchUpdate(user.organizationId, user.userId, id, dto, scope);
    return this.service.toDetail(updated);
  }

  /**
   * 🔴 Đặt SAU `:id/items/batch`. Đảo thứ tự thì "batch" bị `:itemId` bắt nhầm và request
   * chết ở `ParseUUIDPipe` với một thông điệp không liên quan gì tới việc đang làm.
   */
  @Patch(':id/items/:itemId')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({ summary: 'Sửa một dòng sản phẩm' })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateFlashSaleItemDto,
  ): Promise<PodFlashSaleDetailDto> {
    const updated = await this.items.updateItem(
      user.organizationId,
      user.userId,
      id,
      itemId,
      dto,
      scope,
    );
    return this.service.toDetail(updated);
  }

  @Delete(':id/items')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({ summary: 'Xoá một hoặc nhiều dòng sản phẩm' })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  async deleteItems(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteFlashSaleItemsDto,
  ): Promise<PodFlashSaleDetailDto> {
    const updated = await this.items.deleteItems(
      user.organizationId,
      user.userId,
      id,
      dto.itemIds,
      scope,
    );
    return this.service.toDetail(updated);
  }

  // ---------------------------------------------------------------------------
  // Đưa lên sàn
  // ---------------------------------------------------------------------------

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(FLASH_SALE_PERMISSIONS.PUBLISH)
  @ApiOperation({
    summary: 'Publish Flash Sale lên TikTok',
    description:
      'Create Activity → Update Activity Products. Đợt đã có `activity_id` đi nhánh Update ' +
      'thay vì tạo hoạt động thứ hai.',
  })
  @ApiOkResponse({ type: PodFlashSalePublishResultDto })
  @ApiBadGatewayResponse({ description: 'TikTok từ chối (POD_FLASH_SALE_PROVIDER_ERROR)' })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishFlashSaleDto,
  ): Promise<PodFlashSalePublishResultDto> {
    return this.publisher.publish(user.organizationId, user.userId, id, dto, scope);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(FLASH_SALE_PERMISSIONS.PUBLISH)
  @ApiOperation({
    summary: 'Retry Publish',
    description: 'Chỉ dùng được khi đợt sale đang FAILED. Đi lại đúng đường của Publish.',
  })
  @ApiOkResponse({ type: PodFlashSalePublishResultDto })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishFlashSaleDto,
  ): Promise<PodFlashSalePublishResultDto> {
    return this.publisher.retry(user.organizationId, user.userId, id, dto, scope);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(FLASH_SALE_PERMISSIONS.PUBLISH)
  @ApiOperation({
    summary: 'Huỷ Flash Sale',
    description: 'Đã lên sàn ⇒ gọi Deactivate Activity trước, rồi mới đổi trạng thái nội bộ.',
  })
  @ApiOkResponse({ type: PodFlashSalePublishResultDto })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodFlashSalePublishResultDto> {
    return this.publisher.cancel(user.organizationId, user.userId, id, scope);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(FLASH_SALE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Đọc lại trạng thái từ TikTok (nút Refresh)',
    description:
      '🔴 Đây là endpoint DUY NHẤT của màn hình có gọi TikTok. Nhịp tự làm mới 30 giây ' +
      'của danh sách KHÔNG dùng endpoint này — nó chỉ đọc database.',
  })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  syncOne(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodFlashSaleDetailDto> {
    return this.sync.syncOne(user.organizationId, id, scope);
  }

  // ---------------------------------------------------------------------------
  // Template
  // ---------------------------------------------------------------------------

  @Post(':id/save-as-template')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({
    summary: 'Save as Template',
    description:
      'Chụp lại sản phẩm, % giảm và giới hạn mua. KHÔNG lưu ngày giờ, trạng thái hay activity_id.',
  })
  @ApiOkResponse({ type: PodFlashSaleTemplateDto })
  saveAsTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveFlashSaleTemplateDto,
  ): Promise<PodFlashSaleTemplateDto> {
    return this.templates.saveFromFlashSale(user.organizationId, user.userId, id, dto, scope);
  }
}
