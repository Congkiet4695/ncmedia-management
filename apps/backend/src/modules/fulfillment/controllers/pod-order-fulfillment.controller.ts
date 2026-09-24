import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { FulfillmentTrigger } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  FulfillPodOrderDto,
  FulfillmentOrderDto,
  UpdateFulfillmentOrderDto,
} from '../dto/fulfillment.dto';
import { MangoFulfillmentService } from '../mango/services/mango-fulfillment.service';
import { FulfillmentService } from '../services/fulfillment.service';

/**
 * Cùng một hành động "gửi đơn POD đi sản xuất", đặt dưới đường dẫn theo góc nhìn ĐƠN HÀNG.
 *
 * `/fulfillment/orders/:podOrderId/fulfill` nhìn từ phía module fulfillment (kèm cấu hình,
 * ánh xạ sản phẩm, lịch sử, webhook). `/pod/orders/:id/fulfill` nhìn từ phía đơn POD — đây là
 * đường dẫn tự nhiên cho ai đang thao tác trên một đơn cụ thể.
 *
 * Cả hai gọi ĐÚNG một service, cùng permission, cùng validate, cùng chống gửi trùng — không có
 * nhánh xử lý thứ hai nào được tạo ra.
 */
@ApiTags('POD Orders — Fulfillment')
@ApiBearerAuth()
@Controller('pod/orders')
export class PodOrderFulfillmentController {
  constructor(
    private readonly service: FulfillmentService,
    private readonly mangoService: MangoFulfillmentService,
  ) {}

  @Post(':id/fulfill')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Gửi đơn POD sang xưởng in',
    description:
      'Bí danh của `POST /fulfillment/orders/{podOrderId}/fulfill`. ' +
      'Validate đơn/tài khoản/địa chỉ/design/ánh xạ biến thể → gọi API nhà cung cấp → lưu ' +
      'request, response, trạng thái và thời điểm gửi. Đơn đã gửi thành công KHÔNG gửi lại được.',
  })
  @ApiOkResponse({ type: FulfillmentOrderDto })
  @ApiUnprocessableEntityResponse({
    description: 'FULFILLMENT_NOT_READY (kèm danh sách lý do) · FULFILLMENT_CONFIG_MISSING',
  })
  @ApiConflictResponse({ description: 'FULFILLMENT_ALREADY_SUBMITTED' })
  @ApiBadRequestResponse({ description: 'FULFILLMENT_PROVIDER_VALIDATION' })
  async fulfill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: FulfillPodOrderDto,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.mangoService.fulfill(
      user.organizationId,
      user.userId,
      podOrderId,
      FulfillmentTrigger.MANUAL,
      dto ?? {},
    );
    return this.service.toOrderDto(record);
  }

  @Patch(':id/fulfillment')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Sửa đơn đã gửi (nhãn · ghi chú · phương thức vận chuyển)',
    description:
      'Gọi Update Order của nhà cung cấp. Chỉ dùng được khi đơn CHƯA vào sản xuất. Sửa nhãn ' +
      'hoặc phương thức vận chuyển khiến nhà cung cấp TÍNH LẠI chi phí — giá vốn mới được áp ' +
      'ngay vào đơn.',
  })
  @ApiOkResponse({ type: FulfillmentOrderDto })
  @ApiConflictResponse({ description: 'FULFILLMENT_CANNOT_UPDATE' })
  async updateFulfillment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: UpdateFulfillmentOrderDto,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.mangoService.updateAtProvider(
      user.organizationId,
      user.userId,
      podOrderId,
      {
        labelUrl: dto.labelUrl,
        note: dto.note,
        shippingMethod: dto.shippingMethod,
      },
    );
    return this.service.toOrderDto(record);
  }
}
