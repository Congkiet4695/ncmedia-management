import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MangoWebhookService } from './mango-webhook.service';
import type { MangoWebhookPayload } from '../types/mango-api.types';

/**
 * MangoWebhookController — điểm nhận webhook của MangoTeePrints.
 *
 * 🔴 KHÔNG có JwtAuthGuard: nhà cung cấp gọi vào từ bên ngoài, không có token của hệ thống.
 * Xác thực bằng `secret` trên đường dẫn — giá trị này do NCMedia sinh khi tạo tài khoản và
 * chỉ hiện MỘT LẦN. Tài liệu Mango không mô tả chữ ký payload nên đây là biện pháp khả dụng
 * duy nhất (xem docs/fulfillment/README.md §Webhook).
 *
 * Luôn trả 200 sau khi đã LƯU sự kiện: Mango tự vô hiệu hoá webhook sau 10 lần lỗi liên tiếp,
 * nên trả lỗi vì một sự cố xử lý nội bộ sẽ khiến mất webhook — tệ hơn nhiều so với xử lý trễ.
 */
@ApiTags('Fulfillment')
@Controller('fulfillment/webhooks/mango')
export class MangoWebhookController {
  constructor(private readonly webhookService: MangoWebhookService) {}

  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Nhận webhook order.status / order.shipment từ MangoTeePrints' })
  async receive(
    @Param('secret') secret: string,
    @Body() payload: MangoWebhookPayload,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    await this.webhookService.receive(secret, payload, headers);
    // Luôn báo đã nhận — chi tiết thành/bại nằm ở `fulfillment_webhook_logs`.
    return { received: true };
  }
}
