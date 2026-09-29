import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { SellerwixWebhookPayload } from '../types/sellerwix-api.types';
import { SellerwixWebhookService } from './sellerwix-webhook.service';

/**
 * Điểm nhận webhook Sellerwix (`order:updated` / `order:shipment`).
 *
 * 🔴 KHÔNG có JwtAuthGuard: Sellerwix gọi từ bên ngoài. Xác thực bằng `secret` trên đường dẫn (tài
 * liệu không định nghĩa chữ ký payload). Đăng ký URL này THỦ CÔNG trong Sellerwix: Settings → Public
 * API → mở rộng dòng API → (+) Create Webhook → URL (POST) + Event Type.
 *
 * Luôn trả 200 sau khi đã LƯU sự kiện — lỗi xử lý nội bộ nằm ở `fulfillment_webhook_logs` và được
 * scheduler thử lại, không đẩy ngược về Sellerwix.
 */
@ApiTags('Fulfillment')
@Controller('fulfillment/webhooks/sellerwix')
export class SellerwixWebhookController {
  constructor(private readonly webhookService: SellerwixWebhookService) {}

  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receive(
    @Param('secret') secret: string,
    @Body() payload: SellerwixWebhookPayload,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    await this.webhookService.receive(secret, payload, headers);
    return { received: true };
  }
}
