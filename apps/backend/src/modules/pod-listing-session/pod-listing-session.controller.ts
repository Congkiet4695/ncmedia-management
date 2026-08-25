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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { POD_SESSION_IMPORT_OPTIONS } from './pod-session-import.options';
import {
  CreateListingSessionDto,
  DeleteSessionProductsDto,
  ImportSessionProductsDto,
  PodListingSessionQueryDto,
  PodSessionProductQueryDto,
  PreviewSessionProductDto,
  StartSessionListingDto,
  UpdateListingSessionDto,
  UpdateSessionProductDto,
} from './dto/pod-listing-session.dto';
import { PodListingSessionService } from './services/pod-listing-session.service';
import { PodSessionImportService } from './services/pod-session-import.service';
import { PodSessionProductService } from './services/pod-session-product.service';

/**
 * PodListingSessionController — MỘT LƯỢT ĐĂNG HÀNG từ đầu tới cuối.
 *
 * ```
 *   New Listing → Market → Shops → 5 Template → Import → Review → Start Listing
 * ```
 *
 * 🔴 Draft Product nằm dưới `/:id/products` chứ không có route gốc riêng: nó là dữ liệu CON
 * của một session, không phải một thực thể sống độc lập.
 *
 * 🔴 Chỉ MỘT endpoint ở đây dẫn tới sàn: `POST /:id/start`, và nó cũng chỉ *tạo Listing Job*.
 * Tạo session, import, sửa, validate, preview đều không chạm TikTok.
 */
@ApiTags('POD - Listing Session')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/listing-sessions')
export class PodListingSessionController {
  constructor(
    private readonly sessions: PodListingSessionService,
    private readonly products: PodSessionProductService,
    private readonly importer: PodSessionImportService,
  ) {}

  // ------------------------------ Session --------------------------------

  @Post()
  @RequirePermissions('pod.session.write')
  @ApiOperation({
    summary: 'New Listing — tạo một lượt đăng (Market + Shops + 5 Template)',
    description: 'Chưa có sản phẩm nào: import là bước tiếp theo.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateListingSessionDto) {
    return this.sessions.create(user.organizationId, user.userId, dto);
  }

  @Get()
  @RequirePermissions('pod.session.read')
  @ApiOperation({ summary: 'Danh sách lượt đăng (search · filter · sort · pagination)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PodListingSessionQueryDto) {
    return this.sessions.list(user.organizationId, query);
  }

  // 🔴 Phải đứng TRƯỚC `:id`: Nest so khớp theo thứ tự khai báo, để sau thì "import" bị
  // nuốt vào tham số `:id` và trả về lỗi UUID không hợp lệ.
  @Get('import/template')
  @RequirePermissions('pod.session.read')
  @ApiOperation({ summary: 'Tải file mẫu (.xlsx) đúng bộ cột hệ thống đọc được' })
  async downloadTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.importer.buildTemplateFile();
    res
      .status(HttpStatus.OK)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="listing-session-template.xlsx"')
      .send(buffer);
  }

  @Get(':id')
  @RequirePermissions('pod.session.read')
  @ApiOperation({ summary: 'Chi tiết lượt đăng: shop, template, số đếm sản phẩm, lượt chạy gần nhất' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.getDetail(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('pod.session.write')
  @ApiOperation({
    summary: 'Sửa cấu hình lượt đăng',
    description: '`shopIds` và `templates` gửi lên là THAY TOÀN BỘ.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingSessionDto,
  ) {
    return this.sessions.update(user.organizationId, user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.session.write')
  @ApiOperation({ summary: 'Xoá lượt đăng (xoá mềm, Draft Product con đi theo)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.remove(user.organizationId, user.userId, id);
  }

  // ------------------------------- Import --------------------------------

  @Post(':id/import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.session.import')
  @UseInterceptors(FileInterceptor('file', POD_SESSION_IMPORT_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        mode: { type: 'string', enum: ['APPEND', 'REPLACE'] },
      },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Import Product — nạp Draft Product vào lượt đăng từ Excel/CSV',
    description:
      'Mỗi dòng là MỘT biến thể; các dòng cùng `Handle` gộp thành một sản phẩm. ' +
      '`mode = REPLACE` là Re-import (xoá Draft Product cũ rồi nạp lại). ' +
      '🔴 KHÔNG gọi TikTok — chỉ đọc file, kiểm tra và ghi database.',
  })
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportSessionProductsDto,
  ) {
    return this.importer.import(user.organizationId, user.userId, id, file, dto ?? {});
  }

  // --------------------------- Draft Product -----------------------------

  @Get(':id/products')
  @RequirePermissions('pod.session.read')
  @ApiOperation({ summary: 'Danh sách Draft Product của lượt đăng (kèm kết quả từng shop)' })
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PodSessionProductQueryDto,
  ) {
    return this.products.list(user.organizationId, id, query);
  }

  @Post(':id/products/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.session.write')
  @ApiOperation({ summary: 'Xoá nhiều Draft Product' })
  async removeProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteSessionProductsDto,
  ) {
    return {
      deleted: await this.products.removeMany(user.organizationId, user.userId, id, dto.ids),
    };
  }

  @Delete(':id/products')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.session.write')
  @ApiOperation({
    summary: 'Xoá TOÀN BỘ Draft Product của lượt đăng',
    description: 'Xoá mềm; sản phẩm đang trong hàng đợi được giữ lại.',
  })
  async removeAllProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { deleted: await this.products.removeAll(user.organizationId, user.userId, id) };
  }

  @Get(':id/products/:productId')
  @RequirePermissions('pod.session.read')
  @ApiOperation({ summary: 'Chi tiết một Draft Product (ảnh, biến thể, lỗi validate)' })
  getProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.products.get(user.organizationId, id, productId);
  }

  @Patch(':id/products/:productId')
  @RequirePermissions('pod.session.write')
  @ApiOperation({
    summary: 'Sửa một Draft Product',
    description: '`images` và `variants` gửi lên là THAY TOÀN BỘ.',
  })
  updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateSessionProductDto,
  ) {
    return this.products.update(user.organizationId, user.userId, id, productId, dto);
  }

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.session.write')
  @ApiOperation({ summary: 'Xoá một Draft Product (xoá mềm)' })
  removeProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.products.remove(user.organizationId, user.userId, id, productId);
  }

  @Post(':id/products/:productId/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.session.read')
  @ApiOperation({
    summary: 'Xem trước payload sau khi áp template của lượt đăng',
    description: '🔴 KHÔNG upload gì lên sàn.',
  })
  previewProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: PreviewSessionProductDto,
  ) {
    return this.products.preview(user.organizationId, id, productId, dto ?? {});
  }

  // -------------------------- Validate & Start ---------------------------

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.session.read')
  @ApiOperation({
    summary: 'Kiểm tra cả lượt đăng: cấu hình + từng Draft Product',
    description: 'Dùng ĐÚNG bộ luật của Bulk Listing Engine — màn hình và engine không lệch nhau.',
  })
  validate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.validate(user.organizationId, id);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.listing.run')
  @ApiOperation({
    summary: 'Start Listing — đưa toàn bộ Draft Product của lượt đăng lên sàn dưới dạng Draft',
    description:
      'Kiểm tra lần cuối rồi tạo Listing Job. Hàng đợi (5 luồng · retry 3 · backoff) và mọi ' +
      'lời gọi SDK nằm ở Bulk Listing Engine. 🔴 `save_mode = AS_DRAFT`, KHÔNG publish.',
  })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartSessionListingDto,
  ) {
    return this.sessions.startListing(user.organizationId, user.userId, id, dto ?? {});
  }
}
