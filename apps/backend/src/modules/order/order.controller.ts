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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ADMIN_ROLE_CODE, FULFILLMENT_ROLE_CODE } from '../auth/constants/default-roles';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateTrackingDto, UpdateWarehouseNoteDto } from './dto/fulfillment.dto';
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
  constructor(private readonly orderService: OrderService) {}

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

  @Put(':id/tracking')
  @RequirePermissions('order.fulfill')
  @ApiOperation({ summary: 'Cập nhật Tracking (Fulfillment đã claim / Admin)' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Không phải người xử lý đơn (ORDER_LOCKED)' })
  updateTracking(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrackingDto,
    @Ip() ip: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.updateTracking(
      user.organizationId,
      this.actor(user),
      id,
      dto,
      this.readScope(user),
      { ipAddress: ip },
    );
  }

  @Put(':id/status')
  @RequirePermissions('order.fulfill')
  @ApiOperation({ summary: 'Đổi trạng thái (Fulfillment) — ghi timeline. SHIPPED cần Tracking.' })
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

  @Put(':id/warehouse-note')
  @RequirePermissions('order.fulfill')
  @ApiOperation({ summary: 'Cập nhật Warehouse Note / Note 2 (Fulfillment đã claim / Admin)' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Không phải người xử lý đơn (ORDER_LOCKED)' })
  updateWarehouseNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseNoteDto,
    @Ip() ip: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.updateWarehouseNote(
      user.organizationId,
      this.actor(user),
      id,
      dto,
      this.readScope(user),
      { ipAddress: ip },
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
