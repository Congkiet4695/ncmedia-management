import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { PodFlashSaleController } from './pod-flash-sale.controller';
import { PodFlashSaleTemplateController } from './pod-flash-sale-template.controller';
import { PodFlashSaleSyncJob } from './schedulers/pod-flash-sale-sync.job';
import { PodFlashSaleItemService } from './services/pod-flash-sale-item.service';
import { PodFlashSalePublisherService } from './services/pod-flash-sale-publisher.service';
import { PodFlashSaleSyncService } from './services/pod-flash-sale-sync.service';
import { PodFlashSaleTemplateService } from './services/pod-flash-sale-template.service';
import { PodFlashSaleValidatorService } from './services/pod-flash-sale-validator.service';
import { PodFlashSaleService } from './services/pod-flash-sale.service';

/**
 * PodFlashSaleModule — quản lý khuyến mãi giới hạn thời gian trên TikTok Shop.
 *
 * Phạm vi: tạo đợt sale, chọn sản phẩm, đặt giá deal, đẩy lên sàn, theo dõi trạng thái,
 * lưu template và nhân bản cho ngày khác. **Chưa làm Promotion** (Coupon, Buy-X-Get-Y,
 * Shipping Discount) — đó là sprint sau, và lớp bọc SDK đã sẵn sàng cho nó.
 *
 * Phụ thuộc MỘT CHIỀU:
 * ```
 *   PodFlashSaleModule ──▶ PodTiktokModule   (phạm vi shop, token, giải mã shop_cipher)
 *                      ──▶ TikTokSdkModule   (@Global — không cần khai báo imports)
 * ```
 * Không có chiều ngược lại: hai module kia không biết gì về Flash Sale. Sản phẩm được đọc
 * thẳng qua `PrismaService` (chỉ hai bảng `pod_products` / `pod_product_variants`, chỉ
 * ĐỌC), nên module này không phải phụ thuộc vào `PodProductModule` chỉ để lấy vài cột.
 *
 * 🔴 Toàn bộ lời gọi tới TikTok đi qua đúng MỘT lớp: `PodFlashSalePublisherService`
 * → `TiktokPromotionApiService` → SDK. Không có HTTP thủ công, không có endpoint hardcode.
 */
@Module({
  // `ScheduleModule.forRoot()` khai báo tại chính module có scheduler — cùng khuôn với
  // PodProduct / PodListing / Fulfillment. Module này là global nên gọi nhiều lần vô hại.
  imports: [AuthModule, PodTiktokModule, ScheduleModule.forRoot()],
  controllers: [PodFlashSaleController, PodFlashSaleTemplateController],
  providers: [
    PodFlashSaleService,
    PodFlashSaleItemService,
    PodFlashSaleValidatorService,
    PodFlashSalePublisherService,
    PodFlashSaleTemplateService,
    PodFlashSaleSyncService,
    PodFlashSaleSyncJob,
  ],
  exports: [
    // Sprint Promotion (sau này) dùng lại đúng hai thứ: bộ kiểm tra và cửa ra sàn.
    PodFlashSaleValidatorService,
    PodFlashSalePublisherService,
  ],
})
export class PodFlashSaleModule {}
