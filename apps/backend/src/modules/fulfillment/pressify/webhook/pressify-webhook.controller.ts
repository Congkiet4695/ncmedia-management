import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { PressifyWebhookPayload } from '../types/pressify-api.types';
import { PressifyWebhookService } from './pressify-webhook.service';

/**
 * Điểm nhận webhook Pressify.
 *
 * 🔴 KHÔNG có JwtAuthGuard: Pressify gọi từ bên ngoài. Xác thực bằng `secret` trên đường dẫn + `data.api_key`
 * (xem `PressifyWebhookService`). Cài URL THỦ CÔNG ở Pressify: Dashboard → Profile → Details → Webhook url.
 *
 * Luôn trả 200 sau khi đã LƯU sự kiện (tài liệu: trả 2xx trong 10 giây) — lỗi xử lý nằm ở
 * `fulfillment_webhook_logs` và được scheduler thử lại.
 */
@ApiTags('Fulfillment')
@Controller('fulfillment/webhooks/pressify')
export class PressifyWebhookController {
  constructor(private readonly webhookService: PressifyWebhookService) {}

  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receive(
    @Param('secret') secret: string,
    @Body() payload: PressifyWebhookPayload,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    await this.webhookService.receive(secret, payload, headers);
    return { received: true };
  }
}
