import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ImportResultDto } from '../../common/excel/import-result.dto';
import { requireXlsx, xlsxFile, xlsxUploadOptions } from '../../common/excel/excel.http';
import { OrderExcelService } from './services/order-excel.service';
import { ADMIN_ROLE_CODE, FULFILLMENT_ROLE_CODE } from '../auth/constants/default-roles';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderItemFulfillmentDto } from './dto/fulfillment.dto';
import { CreateOrderNoteDto, OrderNoteDto, UpdateOrderNoteDto } from './dto/order-note.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import {
  OrderResponseDto,
  OrderSellerOptionDto,
  PaginatedOrderResponseDto,
} from './dto/order-response.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-status.dto';
import { OrderActor, OrderService } from './services/order.service';

/**
 * OrderController — CRUD Order (nhập tay) + Fulfillment workflow. Tenant-scoped + RBAC (`order.*`).
 *
 * Phạm vi xem (row-level):
 *  - ADMIN & FULFILLMENT: xem TẤT CẢ Order (Requirement 1).
 *  - EMPLOYEE (Seller): chỉ Order thuộc Account mình quản lý (account.sellerUserId === userId).
 *
 * Khoá sửa: sau khi đơn được Claim, chỉ Fulfillment đã claim (fulfillment endpoints) hoặc ADMIN
 * được chỉnh sửa; người khác → 409 (backend luôn kiểm tra — Requirement 3/11/14).
 */
@ApiTags('Orders')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly excel: OrderExcelService,
  ) {}

  /** Phạm vi ĐỌC: ADMIN/FULFILLMENT → undefined (toàn Org); EMPLOYEE → userId (đơn của mình). */
  private readScope(user: AuthenticatedUser): string | undefined {
    return user.role === ADMIN_ROLE_CODE || user.role === FULFILLMENT_ROLE_CODE
      ? undefined
      : user.userId;
  }

  /** Phạm vi SỬA thông tin bán hàng: ADMIN → undefined; khác → userId (EMPLOYEE chỉ đơn của mình). */
  private salesScope(user: AuthenticatedUser): string | undefined {
    return user.role === ADMIN_ROLE_CODE ? undefined : user.userId;
  }

  private actor(user: AuthenticatedUser): OrderActor {
    return { userId: user.userId, role: user.role };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('order.create')
  @ApiOperation({ summary: 'Tạo Order (kèm Order Items 1..N)' })
  @ApiCreatedResponse({ type: OrderResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.create(user.organizationId, user.userId, dto, this.salesScope(user));
  }

  @Get()
  @RequirePermissions('order.read')
  @ApiOperation({ summary: 'Danh sách Order (filter/search/sort/pagination)' })
  @ApiOkResponse({ type: PaginatedOrderResponseDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OrderQueryDto,
  ): Promise<PaginatedOrderResponseDto> {
    return this.orderService.findAll(user.organizationId, query, this.readScope(user));
  }

  @Get('sellers')
  @RequirePermissions('order.read')
  @ApiOperation({ summary: 'Danh sách Seller (quản lý Account) — filter Seller (ADMIN)' })
  @ApiOkResponse({ type: OrderSellerOptionDto, isArray: true })
  sellers(@CurrentUser() user: AuthenticatedUser): Promise<OrderSellerOptionDto[]> {
    return this.orderService.listSellers(user.organizationId);
  }

  // ---------- Import/Export Excel (Admin toàn bộ · Employee chỉ Account mình quản lý) ----------

  @Get('export/example')
  @RequirePermissions('order.read')
  @ApiOperation({ summary: 'Tải file Excel mẫu để Import Order (Admin/Employee)' })
  @ApiOkResponse({ description: 'File .xlsx (sheet: Orders + Order Items + Order Notes + Reference)' })
  async exportExample(): Promise<StreamableFile> {
    return xlsxFile(await this.excel.buildExample(), 'order-import-template.xlsx');
  }

  @Get('export')
  @RequirePermissions('order.read')
  @ApiOperation({ summary: 'Export Order + Order Items ra Excel (Admin all / Employee scoped)' })
  @ApiOkResponse({ description: 'File .xlsx' })
  async exportAll(@CurrentUser() user: AuthenticatedUser): Promise<StreamableFile> {
    return xlsxFile(await this.excel.exportAll(user.organizationId, this.salesScope(user)), 'orders-export.xlsx');
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('order.create')
  @UseInterceptors(FileInterceptor('file', xlsxUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Import Order từ Excel — tạo mới, bỏ qua trùng (Employee: Account mình quản lý)' })
  @ApiOkResponse({ type: ImportResultDto })
  importCreate(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ImportResultDto> {
    return this.excel.importCreate(user.organizationId, user.userId, requireXlsx(file), this.salesScope(user));
  }

  @Post('import/update')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('order.update')
  @UseInterceptors(FileInterceptor('file', xlsxUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Import file export để UPDATE theo ID (Employee: Account mình quản lý)' })
  @ApiOkResponse({ type: ImportResultDto })
  importUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ImportResultDto> {
    return this.excel.importUpdate(user.organizationId, user.userId, requireXlsx(file), this.salesScope(user));
  }

  // --- Fulfillment workflow ---

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('order.claim')
  @ApiOperation({ summary: 'Nhận xử lý (claim) Order — Fulfillment' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Đơn đang được Fulfillment khác xử lý (ORDER_LOCKED)' })
  claim(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.claim(
      user.organizationId,
      this.actor(user),
      id,
      this.readScope(user),
      { ipAddress: ip },
    );
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('order.release')
  @ApiOperation({ summary: 'Release Order đã claim (Admin) — về WAITING' })
  @ApiOkResponse({ type: OrderResponseDto })
  release(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.release(user.organizationId, this.actor(user), id, { ipAddress: ip });
  }

  @Put(':id/items/:itemId/fulfillment')
  @RequirePermissions('order.fulfill')
  @ApiOperation({ summary: 'Cập nhật Tracking + Fulfillment Status theo TỪNG Item (Fulfillment đã claim / Admin)' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Không phải người xử lý đơn (ORDER_LOCKED)' })
  updateItemFulfillment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateOrderItemFulfillmentDto,
    @Ip() ip: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.updateItemFulfillment(
      user.organizationId,
      this.actor(user),
      id,
      itemId,
      dto,
      this.readScope(user),
      { ipAddress: ip },
    );
  }

  @Put(':id/status')
  @RequirePermissions('order.fulfill')
  @ApiOperation({ summary: 'Đổi trạng thái đơn (Fulfillment) — ghi timeline' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Không phải người xử lý đơn (ORDER_LOCKED)' })
  fulfillStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Ip() ip: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.fulfillStatus(
      user.organizationId,
      this.actor(user),
      id,
      dto,
      this.readScope(user),
      { ipAddress: ip },
    );
  }

  // --- OrderNote (Seller / Warehouse) CRUD ---

  @Get(':id/notes')
  @RequirePermissions('order.read')
  @ApiOperation({ summary: 'Danh sách ghi chú (Seller/Warehouse) của Order' })
  @ApiOkResponse({ type: OrderNoteDto, isArray: true })
  listNotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderNoteDto[]> {
    return this.orderService.listNotes(user.organizationId, id, this.readScope(user));
  }

  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('order.note')
  @ApiOperation({ summary: 'Thêm ghi chú (SELLER/WAREHOUSE) cho Order' })
  @ApiCreatedResponse({ type: OrderNoteDto })
  createNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateOrderNoteDto,
  ): Promise<OrderNoteDto> {
    return this.orderService.createNote(
      user.organizationId,
      user.userId,
      id,
      dto,
      this.readScope(user),
    );
  }

  @Put('notes/:noteId')
  @RequirePermissions('order.note')
  @ApiOperation({ summary: 'Cập nhật ghi chú Order' })
  @ApiOkResponse({ type: OrderNoteDto })
  updateNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateOrderNoteDto,
  ): Promise<OrderNoteDto> {
    return this.orderService.updateNote(
      user.organizationId,
      user.userId,
      noteId,
      dto,
      this.readScope(user),
    );
  }

  @Delete('notes/:noteId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('order.note')
  @ApiOperation({ summary: 'Xóa mềm ghi chú Order' })
  @ApiOkResponse({ description: 'Đã xóa; data = null' })
  deleteNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<void> {
    return this.orderService.deleteNote(
      user.organizationId,
      user.userId,
      noteId,
      this.readScope(user),
    );
  }

  @Get(':id')
  @RequirePermissions('order.read')
  @ApiOperation({ summary: 'Chi tiết Order (kèm items + timeline trạng thái)' })
  @ApiOkResponse({ type: OrderResponseDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.findOne(user.organizationId, id, this.readScope(user));
  }

  @Patch(':id')
  @RequirePermissions('order.update')
  @ApiOperation({ summary: 'Cập nhật Order (thông tin bán hàng + items). Khoá nếu đã claim.' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Đơn đã được claim (ORDER_LOCKED)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.update(
      user.organizationId,
      user.userId,
      id,
      dto,
      this.salesScope(user),
      user.role,
    );
  }

  @Patch(':id/status')
  @RequirePermissions('order.update')
  @ApiOperation({ summary: 'Đổi trạng thái đơn (Sales — Admin/Employee). Khoá nếu đã claim.' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Đơn đã được claim (ORDER_LOCKED)' })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.updateStatus(
      user.organizationId,
      user.userId,
      id,
      dto,
      this.salesScope(user),
      user.role,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('order.delete')
  @ApiOperation({ summary: 'Xóa mềm Order. Khoá nếu đã claim (chỉ Admin).' })
  @ApiOkResponse({ description: 'Đã xóa mềm; data = null' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.orderService.remove(
      user.organizationId,
      user.userId,
      id,
      this.salesScope(user),
      user.role,
    );
  }
}
