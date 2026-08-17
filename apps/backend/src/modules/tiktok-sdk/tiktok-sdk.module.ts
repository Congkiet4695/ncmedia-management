import { Global, Module } from '@nestjs/common';
import { TiktokProductApiService } from './tiktok-product-api.service';
import { TikTokSdkService } from './tiktok-sdk.service';

/**
 * TikTokSdkModule — module ĐỘC LẬP bọc SDK Node.js chính thức của TikTok Shop.
 *
 * Chuỗi phụ thuộc bắt buộc (yêu cầu Sprint 1):
 *
 * ```
 *   ProductSyncService  →  TiktokProductApiService  →  TikTokSdkService  →  SDK  →  TikTok API
 * ```
 *
 * 🔴 Ràng buộc: gói `@tiktok-shop/nodejs-sdk` **chỉ được import bên trong thư mục này**.
 * Module khác import SDK trực tiếp là phá vỡ mục tiêu "SDK đổi thì chỉ sửa wrapper".
 *
 * SDK nằm ở `vendor/tiktok-shop-sdk` (bản sinh tự động, build riêng bằng tsconfig nới lỏng
 * — xem `vendor/tiktok-shop-sdk/tsconfig.json`), backend tiêu thụ qua dependency `file:`.
 *
 * `@Global()` vì đây là hạ tầng dùng chung; module nghiệp vụ không cần khai báo `imports`
 * lặp lại — cùng cách `PrismaModule`/`RedisModule` đang làm.
 */
@Global()
@Module({
  providers: [TikTokSdkService, TiktokProductApiService],
  exports: [TikTokSdkService, TiktokProductApiService],
})
export class TikTokSdkModule {}
