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
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { PodScope } from '../pod-tiktok/decorators/pod-scope.decorator';
import { PodScopeGuard } from '../pod-tiktok/guards/pod-scope.guard';
import type { PodAccessScope } from '../pod-tiktok/services/pod-access-scope.service';
import { FLASH_SALE_PERMISSIONS } from './constants/pod-flash-sale.constants';
import {
  ApplyFlashSaleTemplateDto,
  PodFlashSaleTemplateQueryDto,
  UpdateFlashSaleTemplateDto,
} from './dto/pod-flash-sale.dto';
import {
  PaginatedPodFlashSaleTemplateDto,
  PodFlashSaleDetailDto,
  PodFlashSaleTemplateDto,
} from './dto/pod-flash-sale-response.dto';
import { PodFlashSaleTemplateService } from './services/pod-flash-sale-template.service';
import { PodFlashSaleService } from './services/pod-flash-sale.service';

/**
 * PodFlashSaleTemplateController — cấu hình Flash Sale dùng lại cho mọi ngày.
 *
 * Đường tạo template KHÔNG nằm ở đây mà ở `POST /pod/flash-sales/:id/save-as-template`:
 * template luôn được chụp từ một đợt sale có thật, không dựng tay từ số không. Nhờ vậy
 * không tồn tại đường nào tạo ra template với dữ liệu chưa từng qua validator.
 */
@ApiTags('POD - Flash Sale Templates')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN) hoặc shop ngoài phạm vi' })
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('pod/flash-sale-templates')
export class PodFlashSaleTemplateController {
  constructor(
    private readonly service: PodFlashSaleTemplateService,
    private readonly flashSales: PodFlashSaleService,
  ) {}

  @Get()
  @RequirePermissions(FLASH_SALE_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Danh sách Flash Sale Template' })
  @ApiOkResponse({ type: PaginatedPodFlashSaleTemplateDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodFlashSaleTemplateQueryDto,
  ): Promise<PaginatedPodFlashSaleTemplateDto> {
    return this.service.list(user.organizationId, query, scope);
  }

  @Get(':id')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Chi tiết template (danh sách sản phẩm + % giảm + giới hạn)' })
  @ApiOkResponse({ type: PodFlashSaleTemplateDto })
  @ApiNotFoundResponse({ description: 'POD_FLASH_SALE_TEMPLATE_NOT_FOUND' })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodFlashSaleTemplateDto> {
    return this.service.getDetail(user.organizationId, id, scope);
  }

  @Patch(':id')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({
    summary: 'Đổi tên / mô tả template',
    description: 'Nội dung sản phẩm chỉ đổi bằng cách lưu lại từ một đợt Flash Sale.',
  })
  @ApiOkResponse({ type: PodFlashSaleTemplateDto })
  @ApiConflictResponse({ description: 'Tên đã tồn tại (POD_FLASH_SALE_NAME_TAKEN)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFlashSaleTemplateDto,
  ): Promise<PodFlashSaleTemplateDto> {
    return this.service.update(user.organizationId, user.userId, id, dto, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({ summary: 'Xoá template (xoá mềm)' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(user.organizationId, user.userId, id, scope);
  }

  @Post(':id/apply')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.WRITE)
  @ApiOperation({
    summary: 'Tạo Flash Sale mới từ template',
    description:
      'Người dùng chỉ nhập tên và khung giờ. 🔴 Giá deal được TÍNH LẠI từ % đã lưu và giá ' +
      'gốc hiện hành, không dùng lại con số cũ. Dòng không còn khả dụng bị bỏ qua và ghi log.',
  })
  @ApiOkResponse({ type: PodFlashSaleDetailDto })
  async apply(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyFlashSaleTemplateDto,
  ): Promise<PodFlashSaleDetailDto> {
    const flashSaleId = await this.service.apply(
      user.organizationId,
      user.userId,
      id,
      dto,
      scope,
    );
    return this.flashSales.getDetail(user.organizationId, flashSaleId, scope);
  }
}
