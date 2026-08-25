import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { PodProductModule } from '../pod-product/pod-product.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { PodListingController } from './pod-listing.controller';
import { PodListingJobController } from './pod-listing-job.controller';
import { PodTemplateController } from './pod-template.controller';
import { PodListingPayloadService } from './services/pod-listing-payload.service';
import { PodListingJobService } from './services/pod-listing-job.service';
import { PodListingReviewService } from './services/pod-listing-review.service';
import { PodListingReviewJob } from './schedulers/pod-listing-review.job';
import { PodListingPublisherService } from './services/pod-listing-publisher.service';
import { PodListingValidatorService } from './services/pod-listing-validator.service';
import { PodListingResolverService } from './services/pod-listing-resolver.service';
import { PodImageTemplateService } from './services/pod-image-template.service';
import { PodListingTemplateService } from './services/pod-listing-template.service';
import { PodSkuExcelService } from './services/pod-sku-excel.service';
import { PodTemplateScopeService } from './services/pod-template-scope.service';
import { PodTemplateService } from './services/pod-template.service';
import { PodTemplateTransferService } from './services/pod-template-transfer.service';
import { PodWarehouseService } from './services/pod-warehouse.service';

/**
 * PodListingModule — Template Engine (Sprint 3) + **Bulk Listing Engine** (Sprint 4)
 * + **Publish Engine & Review Tracker** (Sprint 5).
 *
 * Phạm vi: quản lý template (Category / SKU / Description / Image / Listing / Pricing),
 * đồng bộ kho, xem trước listing, sinh Draft Listing vào database, **đẩy hàng loạt lên
 * TikTok dưới dạng Draft Product**, và **Publish Draft** vào hàng chờ duyệt — tất cả qua
 * cùng một hàng đợi có retry.
 *
 * 🔴 Toàn bộ lời gọi ghi tới TikTok đi qua `TiktokProductApiService`, không có HTTP thủ công:
 * Upload Product Image · Create Product (`AS_DRAFT` hoặc `LISTING`) · Edit Product
 * (`LISTING` — đường publish duy nhất) · Delete Products (dọn dẹp). Lời gọi ĐỌC duy nhất của
 * sprint Publish là Get Product, dùng cho scheduler đọc trạng thái duyệt 5 phút/lần.
 *
 * Phụ thuộc một chiều:
 *   `PodListingModule → PodProductModule` (đọc sản phẩm, tái dùng bộ chọn shop đồng bộ)
 *   `PodListingModule → PodTiktokModule`  (token, giải mã shop_cipher)
 *   `TikTokSdkModule` là @Global — không cần khai báo imports.
 * Không có chiều ngược lại: hai module kia không biết gì về Listing Template.
 */
@Module({
  // `ScheduleModule.forRoot()` khai báo tại chính module có scheduler — cùng khuôn với
  // PodProduct / PodTiktok / Fulfillment. Module này là global nên gọi nhiều lần vô hại.
  imports: [AuthModule, PodTiktokModule, PodProductModule, ScheduleModule.forRoot()],
  controllers: [PodTemplateController, PodListingController, PodListingJobController],
  providers: [
    PodTemplateService,
    PodListingValidatorService,
    PodListingPublisherService,
    PodListingJobService,
    PodListingReviewService,
    PodListingReviewJob,
    PodImageTemplateService,
    PodTemplateTransferService,
    PodTemplateScopeService,
    PodSkuExcelService,
    PodListingTemplateService,
    PodListingResolverService,
    PodListingPayloadService,
    PodWarehouseService,
  ],
  exports: [
    // Sprint sau (Generate Draft + Bulk Publish) đọc ba thứ này và KHÔNG cần gì thêm:
    // scope cho biết áp cho sản phẩm nào, resolver dựng nội dung, draft service lưu lại.
    PodTemplateScopeService,
    PodListingResolverService,
    PodListingPayloadService,
    // Draft Listing Engine (module riêng) cần: giải template, kiểm tra trước khi gửi,
    // dựng template từ mảnh rời, và tạo Listing Job.
    PodListingValidatorService,
    PodListingTemplateService,
    PodListingJobService,
    PodListingReviewService,
    // Màn hình Resources đồng bộ kho qua đây.
    PodWarehouseService,
  ],
})
export class PodListingModule {}
