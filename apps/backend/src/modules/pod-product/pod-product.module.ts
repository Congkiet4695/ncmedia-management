import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { StorageModule } from '../storage/storage.module';
import { PodProductController } from './pod-product.controller';
import { PodProductMapper } from './mappers/pod-product.mapper';
import { PodProductResponseMapper } from './mappers/pod-product-response.mapper';
import { PodProductRepository } from './repositories/pod-product.repository';
import { PodProductSyncRepository } from './repositories/pod-product-sync.repository';
import { PodProductSyncJob } from './schedulers/pod-product-sync.job';
import { PodProductCatalogService } from './services/pod-product-catalog.service';
import { PodProductEditService } from './services/pod-product-edit.service';
import { PodProductLifecycleService } from './services/pod-product-lifecycle.service';
import { PodDescriptionImageService } from './services/pod-description-image.service';
import { PodProductMediaService } from './services/pod-product-media.service';
import { PodProductService } from './services/pod-product.service';
import { PodProductSyncQueue } from './services/pod-product-sync.queue';
import { PodProductSyncService } from './services/pod-product-sync.service';

/**
 * PodProductModule — Sprint 2: **Product Synchronization** (TikTok → NCMedia).
 *
 * Phạm vi: ĐỌC + ĐỒNG BỘ + **SỬA** sản phẩm đã có trên sàn.
 *
 * 🔴 Ghi chú "chỉ đọc" của Sprint 2 đã HẾT hiệu lực: `PodProductEditService` gọi Partial Edit
 * Product trên shop thật (`pod.product.update`); `PodProductLifecycleService` ngừng bán / xoá
 * trên sàn (`pod.product.deactivate` / `pod.product.delete`). Vẫn KHÔNG có tạo mới ở đây —
 * nhân bản sản phẩm sang shop khác là việc của module Listing (`PodProductCloneController`).
 *
 * Phụ thuộc (một chiều):
 *  - `TikTokSdkModule` (@Global) — cửa duy nhất ra SDK TikTok.
 *  - `PodTiktokModule` — dùng lại vòng đời token, giải mã credential, khoá phân tán.
 *    KHÔNG có chiều ngược lại: module POD TikTok không biết gì về Product.
 *
 * Phân lớp giữ đúng khuôn của module POD hiện có:
 *   controller → service → repository, mapper là ACL, scheduler chỉ kích hoạt.
 */
@Module({
  imports: [AuthModule, PodTiktokModule, StorageModule, ScheduleModule.forRoot()],
  controllers: [PodProductController],
  providers: [
    PodProductService,
    PodProductSyncService,
    PodProductSyncQueue,
    PodProductCatalogService,
    PodProductEditService,
    PodProductLifecycleService,
    PodProductMediaService,
    PodDescriptionImageService,
    PodProductRepository,
    PodProductSyncRepository,
    PodProductMapper,
    PodProductResponseMapper,
    PodProductSyncJob,
  ],
  exports: [
    // Sprint 3 (Template) và Sprint Listing sẽ đọc lại dữ liệu sản phẩm từ đây.
    PodProductRepository,
    PodProductService,
    // PodWarehouseService (module pod-listing) dùng lại đúng cách chọn shop hợp lệ để
    // gọi TikTok — không nhân bản logic lọc shop/token sang module khác.
    PodProductSyncRepository,
    // `PodProductSyncBridgeModule` gắn service này vào token `PRODUCT_SYNC_TRIGGER` để
    // luồng liên kết TikTok kích hoạt được đồng bộ mà không tạo vòng phụ thuộc module.
    PodProductSyncService,
    // Màn hình Resources gọi từng lệnh đồng bộ danh mục / thương hiệu / thuộc tính riêng lẻ.
    PodProductCatalogService,
    // Ảnh trong MÔ TẢ upload với use_case DESCRIPTION_IMAGE — Bulk Listing (module pod-listing)
    // và Edit Product dùng CHUNG một đường, không mỗi nơi một cách đổi src.
    PodDescriptionImageService,
  ],
})
export class PodProductModule {}
